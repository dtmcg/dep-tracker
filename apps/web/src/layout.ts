import type { Project, Schedule } from "@dep-tracker/domain";

/** Layout of the graph-based Gantt chart: pure and deterministic (NFR-9). */

export const DAY_MS = 86_400_000;
export const ROW_HEIGHT = 40;
export const BAR_HEIGHT = 26;
const PAD_MS = DAY_MS / 2;
const EDGE_STUB = 8;

export const ZOOM_LEVELS = [
  { name: "Hours", pxPerDay: 960 },
  { name: "Days", pxPerDay: 96 },
  { name: "Weeks", pxPerDay: 24 },
  { name: "Months", pxPerDay: 6 },
  { name: "Quarters", pxPerDay: 2 },
] as const;

export interface Bar {
  id: string;
  row: number;
  x: number;
  width: number;
  /** False for nodes that could not be scheduled; they sit in the bottom band. */
  timed: boolean;
}

export interface Edge {
  dependentId: string;
  dependencyId: string;
  /** Polyline from the dependency's end to the dependent's start. */
  points: [number, number][];
}

export interface GanttLayout {
  origin: number;
  /** Time covered, origin to end, in ms (independent of zoom). */
  spanMs: number;
  width: number;
  height: number;
  bars: Bar[];
  edges: Edge[];
  /** First row of the band of nodes that could not be scheduled. */
  untimedFromRow: number;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function layoutGantt(project: Project, sched: Schedule, { pxPerDay }: { pxPerDay: number }): GanttLayout {
  const ids = project.nodes.map((n) => n.id).sort(byId);
  const timed = (id: string) => sched.nodes[id] !== undefined;
  const startOf = (id: string) => Date.parse(sched.nodes[id]!.start);
  const endOf = (id: string) => Date.parse(sched.nodes[id]!.completion);

  const deps = new Map<string, string[]>(ids.map((id) => [id, []]));
  const hasDependent = new Set<string>();
  for (const e of project.edges) {
    deps.get(e.dependentId)?.push(e.dependencyId);
    hasDependent.add(e.dependencyId);
  }
  // Visit dependencies in time order so chains cascade down and to the right.
  const visitOrder = (list: string[]) =>
    [...list].sort((a, b) => (timed(a) && timed(b) ? startOf(a) - startOf(b) || byId(a, b) : timed(a) ? -1 : timed(b) ? 1 : byId(a, b)));

  // Rows: dependencies before their dependents (post-order from the root), then the rest.
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !deps.has(id)) return;
    seen.add(id);
    for (const d of visitOrder(deps.get(id)!)) visit(d);
    order.push(id);
  };
  visit(project.rootId);
  for (const id of visitOrder(ids.filter((id) => !hasDependent.has(id)))) visit(id);
  for (const id of ids) visit(id);

  const timedIds = order.filter(timed);
  const untimedIds = order.filter((id) => !timed(id)).sort(byId);

  const starts = timedIds.map(startOf);
  const ends = timedIds.map(endOf);
  const projectStart = Date.parse(project.start);
  const origin = (starts.length ? Math.min(...starts) : projectStart) - PAD_MS;
  const end = (ends.length ? Math.max(...ends) : projectStart + DAY_MS) + PAD_MS;
  const px = (ms: number) => (ms / DAY_MS) * pxPerDay;

  const bars: Bar[] = [
    ...timedIds.map((id, row) => ({ id, row, x: px(startOf(id) - origin), width: px(endOf(id) - startOf(id)), timed: true })),
    ...untimedIds.map((id, i) => ({ id, row: timedIds.length + i, x: px(PAD_MS), width: px(DAY_MS), timed: false })),
  ];
  const barOf = new Map(bars.map((b) => [b.id, b]));
  const mid = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

  const crossings = (x: number, fromRow: number, toRow: number) =>
    bars.filter((b) => b.row > Math.min(fromRow, toRow) && b.row < Math.max(fromRow, toRow) && x > b.x && x < b.x + b.width).length;

  const edges: Edge[] = [...project.edges]
    .sort((a, b) => byId(a.dependencyId, b.dependencyId) || byId(a.dependentId, b.dependentId))
    .flatMap((e) => {
      const from = barOf.get(e.dependencyId);
      const to = barOf.get(e.dependentId);
      if (!from || !to) return [];
      const x0 = from.x + from.width;
      const y0 = mid(from.row);
      const x1 = to.x;
      const y1 = mid(to.row);
      if (y0 === y1) return [{ dependentId: e.dependentId, dependencyId: e.dependencyId, points: [[x0, y0], [x1, y1]] }];
      let points: [number, number][];
      if (x1 - x0 >= 2 * EDGE_STUB) {
        // Room between the bars: drop just after the dependency ends, then run along the dependent's row,
        // which is clear to the left of its start; labels sit to the right of bars. Move the drop next to
        // the dependent instead only when that crosses fewer bars (FR-3).
        const candidates = [x0 + EDGE_STUB, x1 - EDGE_STUB];
        const xv = candidates.reduce((best, x) => (crossings(x, from.row, to.row) < crossings(best, from.row, to.row) ? x : best));
        points = [
          [x0, y0],
          [xv, y0],
          [xv, y1],
          [x1, y1],
        ];
      } else {
        // Bars (nearly) touch: drop from under the dependency's end, then run into the dependent's start.
        const xv = Math.max(from.x, Math.min(x0, x1) - EDGE_STUB);
        const below = y1 > y0;
        points = [
          [xv, y0 + (below ? BAR_HEIGHT / 2 : -BAR_HEIGHT / 2)],
          [xv, y1],
          [x1, y1],
        ];
      }
      return [{ dependentId: e.dependentId, dependencyId: e.dependencyId, points }];
    });

  return {
    origin,
    spanMs: end - origin,
    width: px(end - origin),
    height: bars.length * ROW_HEIGHT,
    bars,
    edges,
    untimedFromRow: timedIds.length,
  };
}

/** px/day that fits a time span into a width. */
export function fitPxPerDay(spanMs: number, width: number): number {
  return width / (spanMs / DAY_MS);
}

export interface Tick {
  ms: number;
  label: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Axis ticks in local time, with the unit chosen by zoom (FR-5: hours to quarters). */
export function timeTicks(startMs: number, endMs: number, pxPerDay: number): Tick[] {
  type Unit = { first: (d: Date) => Date; next: (d: Date) => Date; label: (d: Date) => string };
  const hours = (step: number): Unit => ({
    first: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.ceil((d.getHours() + d.getMinutes() / 60) / step) * step),
    next: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + step),
    label: (d) => (d.getHours() === 0 ? `${WEEKDAYS[d.getDay()]} ${d.getDate()}` : `${pad(d.getHours())}:00`),
  });
  const ceilDay = (d: Date) => {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return day.getTime() < d.getTime() ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) : day;
  };
  const unit: Unit =
    pxPerDay >= 600
      ? hours(3)
      : pxPerDay >= 200
        ? hours(6)
        : pxPerDay >= 40
          ? {
              first: ceilDay,
              next: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
              label: (d) => `${WEEKDAYS[d.getDay()]} ${d.getDate()}`,
            }
          : pxPerDay >= 10
            ? {
                first: (d) => {
                  const day = ceilDay(d);
                  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + ((8 - day.getDay()) % 7));
                },
                next: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7),
                label: (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`,
              }
            : pxPerDay >= 2.5
              ? {
                  first: (d) => {
                    const m = new Date(d.getFullYear(), d.getMonth(), 1);
                    return m.getTime() < d.getTime() ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : m;
                  },
                  next: (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1),
                  label: (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
                }
              : {
                  first: (d) => {
                    const q = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
                    return q.getTime() < d.getTime() ? new Date(q.getFullYear(), q.getMonth() + 3, 1) : q;
                  },
                  next: (d) => new Date(d.getFullYear(), d.getMonth() + 3, 1),
                  label: (d) => `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`,
                };

  const ticks: Tick[] = [];
  for (let d = unit.first(new Date(startMs)); d.getTime() <= endMs && ticks.length < 2000; d = unit.next(d)) {
    ticks.push({ ms: d.getTime(), label: unit.label(d) });
  }
  return ticks;
}
