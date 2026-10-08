import type { Project, Schedule } from "@dep-tracker/domain";
import type { ViewMode } from "./viewMode.ts";

/** Layout of the graph-based Gantt chart: pure and deterministic (NFR-9). */

export const DAY_MS = 86_400_000;
export const ROW_HEIGHT = 40;
export const BAR_HEIGHT = 26;
/** Node view: every node is a square box of this size, wherever it sits and however long its work takes. */
export const NODE_WIDTH = 156;
export const NODE_HEIGHT = 156;
export const NODE_ROW_HEIGHT = 172;
const NODE_GAP = 8;
/** Node view without a time scale: boxes sit in columns by dependency depth, this far apart (room for connectors). */
export const COLUMN_GAP = 64;
const PAD_MS = DAY_MS / 2;
const EDGE_STUB = 8;
/** Bars may touch end to start on a row (a dependency feeding straight into its dependent); the first one's label is shortened to fit. */
const TOUCH_TOLERANCE = 0.5;

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
  /** Width available for the label to the right of the bar before the next bar on its row; null if unlimited. */
  labelMax: number | null;
}

export interface Edge {
  dependentId: string;
  dependencyId: string;
  /** Polyline from the dependency's end to the dependent's start. */
  points: [number, number][];
}

export interface GanttLayout {
  /** Height of one row, and of a bar or node box in it. */
  rowHeight: number;
  barHeight: number;
  /** Pixels added to every time position so boxes that end at a time can start left of it (node view; 0 otherwise). */
  axisOffset: number;
  /** False when boxes are spaced evenly by dependency depth instead of by time: there is no time axis to draw. */
  timeScaled: boolean;
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

export function layoutGantt(
  project: Project,
  sched: Schedule,
  { pxPerDay, view = "timeline", timeScale = true }: { pxPerDay: number; view?: ViewMode; timeScale?: boolean },
): GanttLayout {
  const nodesView = view === "nodes";
  // Node view with the time scale off: columns by dependency depth, every step the same width.
  const even = nodesView && !timeScale;
  const ROW_H = nodesView ? NODE_ROW_HEIGHT : ROW_HEIGHT;
  const BAR_H = nodesView ? NODE_HEIGHT : BAR_HEIGHT;
  const axisOffset = nodesView && !even ? NODE_WIDTH : 0;
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
  // Visit dependencies in time order so the same project always lays out the same way.
  const visitOrder = (list: string[]) =>
    [...list].sort((a, b) => (timed(a) && timed(b) ? startOf(a) - startOf(b) || byId(a, b) : timed(a) ? -1 : timed(b) ? 1 : byId(a, b)));

  const timedIds = ids.filter(timed);
  const untimedIds = ids.filter((id) => !timed(id));

  const starts = timedIds.map(startOf);
  const ends = timedIds.map(endOf);
  const projectStart = Date.parse(project.start);
  // The node view positions boxes by when they complete, so the axis starts at the earliest completion.
  const origin = (nodesView ? (ends.length ? Math.min(...ends) : projectStart) : starts.length ? Math.min(...starts) : projectStart) - PAD_MS;
  const end = (ends.length ? Math.max(...ends) : projectStart + DAY_MS) + PAD_MS;
  const px = (ms: number) => (ms / DAY_MS) * pxPerDay;

  // Balanced rows. Working up from the leaves, each node sits on the row at the midpoint of its dependencies'
  // rows (so the root ends up in the middle of the chart); leaves take consecutive rows. A dependency shared
  // by several nodes is placed once, under whichever is visited first. A bar never shares a row with another
  // bar it would overlap in time, so a node is moved to the nearest free row.
  // Time line: a bar spans its work, and may touch the next one. Node view: a fixed box ending at the completion
  // time, with a small gap to its neighbours.
  // Even spacing: a node's column is the longest chain of dependencies beneath it, so every dependency is to its left.
  const depths = new Map<string, number>();
  const depthOf = (id: string, path: Set<string>): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (path.has(id)) return 0;
    path.add(id);
    const d = deps.get(id)!.filter(timed).reduce((most, k) => Math.max(most, depthOf(k, path) + 1), 0);
    path.delete(id);
    depths.set(id, d);
    return d;
  };
  const columnX = (id: string) => depthOf(id, new Set()) * (NODE_WIDTH + COLUMN_GAP);
  const xOf = (id: string) => (even ? columnX(id) : nodesView ? px(endOf(id) - origin) : px(startOf(id) - origin));
  const wOf = (id: string) => (nodesView ? NODE_WIDTH : Math.max(px(endOf(id) - startOf(id)), 2));
  const reach = (id: string) => xOf(id) + wOf(id) + (nodesView ? NODE_GAP : -TOUCH_TOLERANCE);
  const taken = new Map<number, string[]>();
  const rowOf = new Map<string, number>();
  const fits = (id: string, row: number) =>
    (taken.get(row) ?? []).every((other) => reach(other) <= xOf(id) || reach(id) <= xOf(other));
  const timedDeps = (id: string) => visitOrder(deps.get(id)!.filter(timed));
  let nextLeaf = 0;
  const place = (id: string, path: Set<string>) => {
    if (rowOf.has(id) || path.has(id)) return;
    path.add(id);
    const kids = timedDeps(id);
    for (const k of kids) place(k, path);
    path.delete(id);
    const rows = kids.map((k) => rowOf.get(k)).filter((r): r is number => r !== undefined);
    let row: number;
    if (rows.length) {
      const want = Math.round((Math.min(...rows) + Math.max(...rows)) / 2);
      row = want;
      for (let step = 1; !fits(id, row); step++) row = step % 2 ? want + Math.ceil(step / 2) : want - step / 2;
    } else {
      row = nextLeaf;
      while (!fits(id, row)) row++;
      nextLeaf = row + 1;
    }
    rowOf.set(id, row);
    taken.set(row, [...(taken.get(row) ?? []), id]);
  };
  // The root's tree first, then whatever isn't reachable from it, below.
  const tops = [
    ...(timed(project.rootId) ? [project.rootId] : []),
    ...visitOrder(timedIds.filter((id) => id !== project.rootId && !hasDependent.has(id))),
    ...timedIds,
  ];
  for (const top of tops) {
    // Anything not reachable from the root goes below the root's tree, never beside it.
    if (rowOf.size) nextLeaf = Math.max(nextLeaf, Math.max(...rowOf.values()) + 1);
    place(top, new Set());
  }
  const top = timedIds.length ? Math.min(...rowOf.values()) : 0;
  const rows = timedIds.length ? Math.max(...rowOf.values()) - top + 1 : 0;

  const labelMax = (id: string): number | null => {
    if (nodesView) return null;
    const gaps = timedIds
      .filter((o) => o !== id && rowOf.get(o) === rowOf.get(id) && xOf(o) >= xOf(id))
      .map((o) => xOf(o) - (xOf(id) + wOf(id)) - 8);
    return gaps.length ? Math.max(0, Math.min(...gaps)) : null;
  };
  const bars: Bar[] = [
    ...timedIds.map((id) => ({
      id,
      row: rowOf.get(id)! - top,
      x: even ? xOf(id) : nodesView ? axisOffset + xOf(id) - NODE_WIDTH : xOf(id),
      width: nodesView ? NODE_WIDTH : px(endOf(id) - startOf(id)),
      timed: true,
      labelMax: labelMax(id),
    })),
    ...untimedIds.map((id, i) => ({
      id,
      row: rows + i,
      x: even ? NODE_GAP : px(PAD_MS),
      width: nodesView ? NODE_WIDTH : px(DAY_MS),
      timed: false,
      labelMax: null,
    })),
  ];
  const barOf = new Map(bars.map((b) => [b.id, b]));
  const mid = (row: number) => row * ROW_H + ROW_H / 2;

  /** Bars an edge would cut through: those on rows between, at the drop; and those on its own two rows along the runs. */
  const crossings = (x: number, from: Bar, to: Bar) => {
    const run = (row: number, xa: number, xb: number, skip: string[]) =>
      bars.filter((b) => b.row === row && !skip.includes(b.id) && b.x < Math.max(xa, xb) && b.x + b.width > Math.min(xa, xb)).length;
    const between = bars.filter((b) => b.row > Math.min(from.row, to.row) && b.row < Math.max(from.row, to.row) && x > b.x && x < b.x + b.width).length;
    return between + run(from.row, from.x + from.width, x, [from.id, to.id]) + run(to.row, x, to.x, [from.id, to.id]);
  };

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
      if (nodesView && x1 - x0 < 2 * EDGE_STUB) {
        // The dependent's box starts before the dependency's ends: leave the right side, run along the gap
        // between rows, and come into the dependent's left side.
        const channel = y1 > y0 ? y1 - ROW_H / 2 : y1 + ROW_H / 2;
        points = [
          [x0, y0],
          [x0 + EDGE_STUB, y0],
          [x0 + EDGE_STUB, channel],
          [x1 - EDGE_STUB, channel],
          [x1 - EDGE_STUB, y1],
          [x1, y1],
        ];
      } else if (x1 - x0 >= 2 * EDGE_STUB) {
        // Room between the bars: drop just after the dependency ends, then run along the dependent's row,
        // which is clear to the left of its start; labels sit to the right of bars. Move the drop next to
        // the dependent instead only when that crosses fewer bars (FR-3).
        const candidates = [x0 + EDGE_STUB, x1 - EDGE_STUB];
        const xv = candidates.reduce((best, x) => (crossings(x, from, to) < crossings(best, from, to) ? x : best));
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
          [xv, y0 + (below ? BAR_H / 2 : -BAR_H / 2)],
          [xv, y1],
          [x1, y1],
        ];
      }
      return [{ dependentId: e.dependentId, dependencyId: e.dependencyId, points }];
    });

  const evenWidth = timedIds.length ? Math.max(...timedIds.map((id) => xOf(id))) + NODE_WIDTH : NODE_WIDTH;
  return {
    rowHeight: ROW_H,
    barHeight: BAR_H,
    axisOffset,
    timeScaled: !even,
    origin,
    spanMs: end - origin,
    width: even ? evenWidth : axisOffset + px(end - origin),
    height: (rows + untimedIds.length) * ROW_H,
    bars,
    edges,
    untimedFromRow: rows,
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
