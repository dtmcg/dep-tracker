import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { criticalEdges, dependenciesOf, dependentsOf, parseDuration, type Project, type Schedule } from "@dep-tracker/domain";
import { dashSeconds } from "./animation.ts";
import { formatDateTime } from "./format.ts";
import { BAR_HEIGHT, DAY_MS, fitPxPerDay, layoutGantt, ROW_HEIGHT, timeTicks, ZOOM_LEVELS } from "./layout.ts";

/** Room to the right of the last bar for its title and date. */
const LABEL_SPACE = 240;
const AXIS_HEIGHT = 32;

interface GanttProps {
  project: Project;
  schedule: Schedule;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onConnect: (dependencyId: string, dependentId: string) => void;
}

type ZoomName = (typeof ZOOM_LEVELS)[number]["name"];

function nearestZoom(pxPerDay: number): ZoomName {
  return ZOOM_LEVELS.reduce((best, z) =>
    Math.abs(Math.log(z.pxPerDay / pxPerDay)) < Math.abs(Math.log(best.pxPerDay / pxPerDay)) ? z : best,
  ).name;
}

export function Gantt({ project, schedule, selectedId, onSelect, onConnect }: GanttProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pxPerDay, setPxPerDay] = useState<number>(ZOOM_LEVELS[1].pxPerDay);
  const layout = useMemo(() => layoutGantt(project, schedule, { pxPerDay }), [project, schedule, pxPerDay]);
  const titleOf = useMemo(() => new Map(project.nodes.map((n) => [n.id, n.title])), [project.nodes]);
  const nodeOf = useMemo(() => new Map(project.nodes.map((n) => [n.id, n])), [project.nodes]);
  // Selection: dependencies upstream, dependents downstream, the rest dimmed (FR-14, FR-16).
  const focus = useMemo(() => {
    if (!selectedId || !nodeOf.has(selectedId)) return null;
    return {
      up: dependenciesOf(project, selectedId),
      down: dependentsOf(project, selectedId),
      critical: criticalEdges(project, schedule, selectedId),
    };
  }, [project, schedule, selectedId, nodeOf]);
  const barHighlight = (id: string) =>
    !focus ? undefined : id === selectedId ? "selected" : focus.up.has(id) ? "upstream" : focus.down.has(id) ? "downstream" : "dimmed";
  const edgeHighlight = (dependencyId: string, dependentId: string) => {
    if (!focus) return undefined;
    if (focus.up.has(dependencyId) && (dependentId === selectedId || focus.up.has(dependentId))) return "upstream";
    if (focus.down.has(dependentId) && (dependencyId === selectedId || focus.down.has(dependencyId))) return "downstream";
    return "dimmed";
  };
  const dashDuration = (dependencyId: string) => {
    try {
      return `${dashSeconds(parseDuration(nodeOf.get(dependencyId)?.workTime ?? "")).toFixed(2)}s`;
    } catch {
      return "1s";
    }
  };
  const isCyclic = (id: string) => schedule.flags[id]?.includes("cyclic") ?? false;
  const stateOf = (id: string) =>
    isCyclic(id) ? "cyclic" : schedule.flags[id]?.includes("blockedByCycle") ? "blocked" : schedule.nodes[id] ? "ok" : "error";
  const xOf = useCallback((ms: number) => ((ms - layout.origin) / DAY_MS) * pxPerDay, [layout.origin, pxPerDay]);

  // "Fit" keeps the whole plan in view as nodes are added or the window changes, until you zoom by hand.
  const [fitMode, setFitMode] = useState(true);
  const [viewWidth, setViewWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (fitMode && viewWidth > 0) setPxPerDay(Math.max(0.5, fitPxPerDay(layout.spanMs, Math.max(200, viewWidth - LABEL_SPACE - 8))));
  }, [fitMode, viewWidth, layout.spanMs]);
  const fit = () => {
    setFitMode(true);
    const el = scroller.current;
    if (el) setPxPerDay(Math.max(0.5, fitPxPerDay(layout.spanMs, Math.max(200, el.clientWidth - LABEL_SPACE - 8))));
  };
  const setZoom = (value: number | ((p: number) => number)) => {
    setFitMode(false);
    setPxPerDay(value);
  };

  const zoomIndex = ZOOM_LEVELS.findIndex((z) => z.name === nearestZoom(pxPerDay));
  const zoomTo = (index: number) => {
    const level = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index))]!;
    setZoom(level.pxPerDay);
  };

  const now = Date.now();
  const todayX = xOf(now);
  const showToday = todayX >= 0 && todayX <= layout.width;
  const ticks = useMemo(
    () => timeTicks(layout.origin, layout.origin + (layout.width / pxPerDay) * DAY_MS, pxPerDay),
    [layout.origin, layout.width, pxPerDay],
  );

  // Ctrl/Cmd + wheel zooms around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setFitMode(false);
      setPxPerDay((p) => Math.min(4000, Math.max(0.5, p * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag on empty space pans; drag from a bar's handle connects (FR-10).
  const [link, setLink] = useState<{ from: string; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const el = scroller.current;
    if (!el || e.button !== 0) return;
    const body = el.querySelector<HTMLElement>(".gantt-body")!;
    const handle = target.closest<HTMLElement>("[data-connector-for]");
    if (handle) {
      e.preventDefault();
      const from = handle.dataset.connectorFor!;
      const origin = body.getBoundingClientRect();
      const r = handle.getBoundingClientRect();
      const x0 = r.left + r.width / 2 - origin.left;
      const y0 = r.top + r.height / 2 - origin.top;
      setLink({ from, x0, y0, x1: x0, y1: y0 });
      const move = (ev: PointerEvent) => {
        const o = body.getBoundingClientRect();
        setLink((l) => (l ? { ...l, x1: ev.clientX - o.left, y1: ev.clientY - o.top } : l));
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setLink(null);
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-node-id]");
        const to = over?.dataset.nodeId;
        if (to && to !== from) onConnect(from, to);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    if (target.closest("button, a, input, select, textarea")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const left = el.scrollLeft;
    const top = el.scrollTop;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
      el.scrollLeft = left - (ev.clientX - startX);
      el.scrollTop = top - (ev.clientY - startY);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.classList.remove("panning");
      if (!moved) onSelect(null);
    };
    el.classList.add("panning");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const scrollToToday = () => {
    const el = scroller.current;
    if (el && showToday) el.scrollLeft = Math.max(0, todayX - el.clientWidth / 2);
  };

  const width = layout.width + LABEL_SPACE;
  const barTop = (row: number) => row * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;

  return (
    <div className="gantt">
      <div className="gantt-toolbar" role="toolbar" aria-label="Timeline controls">
        <button className="ghost small" aria-label="Zoom out" onClick={() => zoomTo(zoomIndex + 1)} disabled={zoomIndex >= ZOOM_LEVELS.length - 1}>
          −
        </button>
        <select
          aria-label="Zoom level"
          value={nearestZoom(pxPerDay)}
          onChange={(e) => setZoom(ZOOM_LEVELS.find((z) => z.name === e.target.value)!.pxPerDay)}
        >
          {ZOOM_LEVELS.map((z) => (
            <option key={z.name} value={z.name}>
              {z.name}
            </option>
          ))}
        </select>
        <button className="ghost small" aria-label="Zoom in" onClick={() => zoomTo(zoomIndex - 1)} disabled={zoomIndex <= 0}>
          +
        </button>
        <button className="ghost small" onClick={fit} aria-pressed={fitMode}>
          Fit
        </button>
        <button className="ghost small" onClick={scrollToToday} disabled={!showToday}>
          Today
        </button>
      </div>

      <div className="gantt-scroll" ref={scroller} role="group" aria-label="Timeline" onPointerDown={onPointerDown}>
        <div className="gantt-axis" style={{ width, height: AXIS_HEIGHT }} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.ms} className="tick" style={{ left: xOf(t.ms) }}>
              {t.label}
            </span>
          ))}
        </div>
        <div className="gantt-body" style={{ width, height: Math.max(layout.height, ROW_HEIGHT) }}>
          <div className="gridlines" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t.ms} style={{ left: xOf(t.ms) }} />
            ))}
          </div>
          {layout.untimedFromRow < layout.bars.length && (
            <div className="untimed-band" style={{ top: layout.untimedFromRow * ROW_HEIGHT }} aria-hidden="true">
              <span>Can't be scheduled</span>
            </div>
          )}
          {showToday && <div className="today-marker" data-testid="today-marker" style={{ left: todayX }} title={`Now: ${formatDateTime(new Date(now).toISOString())}`} />}

          <svg className="edges" width={width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" className="arrowhead" />
              </marker>
              <marker id="arrow-up" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" className="arrowhead up" />
              </marker>
              <marker id="arrow-down" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" className="arrowhead down" />
              </marker>
            </defs>
            {layout.edges.map((e) => {
              const highlight = edgeHighlight(e.dependencyId, e.dependentId);
              const critical = focus ? focus.critical.has(`${e.dependencyId}>${e.dependentId}`) : undefined;
              return (
              <path
                data-cyclic={String(isCyclic(e.dependencyId) && isCyclic(e.dependentId))}
                data-highlight={highlight}
                data-critical={critical === undefined ? undefined : String(critical)}
                style={highlight === "upstream" || highlight === "downstream" ? ({ "--dash-duration": dashDuration(e.dependencyId) } as CSSProperties) : undefined}
                key={`${e.dependencyId}>${e.dependentId}`}
                data-edge={`${e.dependencyId}>${e.dependentId}`}
                data-edge-dependency={titleOf.get(e.dependencyId)}
                data-edge-dependent={titleOf.get(e.dependentId)}
                className={isCyclic(e.dependencyId) && isCyclic(e.dependentId) ? "edge cyclic" : "edge"}
                d={roundedPath(e.points)}
                markerEnd={`url(#arrow${highlight === "upstream" ? "-up" : highlight === "downstream" ? "-down" : ""})`}
              />
              );
            })}
            {link && <line className="edge linking" x1={link.x0} y1={link.y0} x2={link.x1} y2={link.y1} />}
          </svg>

          {layout.bars.map((b) => {
            const node = nodeOf.get(b.id)!;
            const times = schedule.nodes[b.id];
            const isRoot = b.id === project.rootId;
            return (
              <article
                key={b.id}
                aria-label={node.title}
                data-node-id={b.id}
                data-root={String(isRoot)}
                data-selected={selectedId === b.id}
                data-highlight={barHighlight(b.id)}
                data-timed={b.timed}
                data-state={stateOf(b.id)}
                data-orphan={schedule.flags[b.id]?.includes("orphan") ? "true" : undefined}
                className="bar-row"
                style={{ left: b.x, top: barTop(b.row), height: BAR_HEIGHT }}
              >
                <button
                  className="bar-button"
                  aria-label={node.title}
                  aria-pressed={selectedId === b.id}
                  onClick={() => onSelect(selectedId === b.id ? null : b.id)}
                >
                  <span className="bar" data-testid="bar" style={{ width: Math.max(b.width, 2) }} />
                  <span className="bar-label">
                    <span className="bar-title">{node.title}</span>
                    {times ? (
                      <time data-testid="completion" dateTime={times.completion}>
                        {formatDateTime(times.completion)}
                      </time>
                    ) : (
                      <span className="bar-note">
                        {stateOf(b.id) === "cyclic" ? "cycle" : stateOf(b.id) === "blocked" ? "blocked by a cycle" : "can't schedule"}
                      </span>
                    )}
                    {schedule.flags[b.id]?.includes("orphan") && <span className="bar-badge">not linked to the success criteria</span>}
                  </span>
                </button>
                <span
                  className="connector"
                  data-testid="connector"
                  data-connector-for={b.id}
                  style={{ left: Math.max(b.width, 2) - 5 }}
                  title="Drag onto another bar to make it depend on this one"
                />
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Polyline with softly rounded corners. */
function roundedPath(points: [number, number][]): string {
  if (points.length < 3) return points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const r = 6;
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]!;
    const [x, y] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const ax = x - ((x - px) / (inLen || 1)) * rr;
    const ay = y - ((y - py) / (inLen || 1)) * rr;
    const bx = x + ((nx - x) / (outLen || 1)) * rr;
    const by = y + ((ny - y) / (outLen || 1)) * rr;
    d += ` L${ax} ${ay} Q${x} ${y} ${bx} ${by}`;
  }
  const [lx, ly] = points.at(-1)!;
  return `${d} L${lx} ${ly}`;
}
