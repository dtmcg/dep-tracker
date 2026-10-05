import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Project, schedule } from "@dep-tracker/domain";
import { BAR_HEIGHT, fitPxPerDay, layoutGantt, ROW_HEIGHT, timeTicks, ZOOM_LEVELS } from "./layout.ts";

const DAY = 86_400_000;

function project(): Project {
  return {
    id: "p1",
    name: "Launch",
    start: "2026-11-02T09:00:00.000Z",
    rootId: "r",
    nodes: [
      { id: "r", title: "Release", workTime: "2d", labels: [], description: "", links: [] },
      { id: "a", title: "Docs", workTime: "2d", labels: [], description: "", links: [] },
      { id: "b", title: "Payments", workTime: "1w", labels: [], description: "", links: [] },
      { id: "c", title: "Contract", workTime: "1d", labels: [], description: "", links: [] },
      { id: "o", title: "Orphan", workTime: "1d", labels: [], description: "", links: [] },
    ],
    edges: [
      { dependentId: "r", dependencyId: "a" },
      { dependentId: "r", dependencyId: "b" },
      { dependentId: "b", dependencyId: "c" },
      { dependentId: "a", dependencyId: "c" },
    ],
  };
}

const layoutOf = (p: Project, pxPerDay = 100) => layoutGantt(p, schedule(p), { pxPerDay });

describe("layoutGantt", () => {
  it("spans each bar from start to completion on the time axis (FR-1)", () => {
    const l = layoutOf(project());
    const s = schedule(project());
    for (const bar of l.bars.filter((b) => b.timed)) {
      const times = s.nodes[bar.id]!;
      assert.equal(bar.x, ((Date.parse(times.start) - l.origin) / DAY) * 100);
      assert.equal(bar.width, ((Date.parse(times.completion) - Date.parse(times.start)) / DAY) * 100);
    }
    const payments = l.bars.find((b) => b.id === "b")!;
    assert.equal(payments.width, 700);
  });

  it("gives every node its own row, dependencies above their dependents and the root last", () => {
    const l = layoutOf(project());
    const row = (id: string) => l.bars.find((b) => b.id === id)!.row;
    assert.equal(new Set(l.bars.map((b) => b.row)).size, l.bars.length);
    assert.ok(row("c") < row("a") && row("c") < row("b"));
    assert.ok(row("a") < row("r") && row("b") < row("r"));
    // Orphans (not reachable from the root) sit after the root's tree
    assert.ok(row("o") > row("r"));
  });

  it("draws one edge per dependency, ending at the dependent's start and never doubling back (FR-3)", () => {
    const l = layoutOf(project());
    assert.equal(l.edges.length, 4);
    for (const e of l.edges) {
      const from = l.bars.find((b) => b.id === e.dependencyId)!;
      const to = l.bars.find((b) => b.id === e.dependentId)!;
      assert.deepEqual(e.points.at(-1), [to.x, to.row * ROW_HEIGHT + ROW_HEIGHT / 2]);
      const [x0] = e.points[0]!;
      assert.ok(x0 <= from.x + from.width && x0 >= from.x, "starts at the end of the dependency");
      for (let i = 1; i < e.points.length; i++) assert.ok(e.points[i]![0] >= e.points[i - 1]![0], "x never decreases");
    }
  });

  it("leaves a gap edge from the dependency's end, and a touching edge from under its end", () => {
    const p = project();
    p.nodes.find((n) => n.id === "r")!.notBefore = "2026-11-20T00:00:00.000Z"; // gap after a and b
    const l = layoutOf(p);
    const mid = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;
    const b = l.bars.find((x) => x.id === "b")!;
    const gap = l.edges.find((e) => e.dependencyId === "b" && e.dependentId === "r")!;
    assert.deepEqual(gap.points[0], [b.x + b.width, mid(b.row)]);
    // c ends exactly when b starts: leave from the bottom of c, just before its end
    const c = l.bars.find((x) => x.id === "c")!;
    const touching = l.edges.find((e) => e.dependencyId === "c" && e.dependentId === "b")!;
    assert.equal(touching.points[0]![1], mid(c.row) + BAR_HEIGHT / 2);
    assert.ok(touching.points[0]![0] < c.x + c.width);
  });

  it("puts untimed nodes in a separate band at the bottom (FR-5)", () => {
    const p = project();
    p.nodes.push({ id: "bad", title: "Bad", workTime: "?", labels: [], description: "", links: [] });
    p.edges.push({ dependentId: "r", dependencyId: "bad" });
    const l = layoutOf(p);
    const untimed = l.bars.filter((b) => !b.timed).map((b) => b.id).sort();
    assert.deepEqual(untimed, ["bad", "r"]);
    const lastTimedRow = Math.max(...l.bars.filter((b) => b.timed).map((b) => b.row));
    for (const b of l.bars.filter((x) => !x.timed)) assert.ok(b.row > lastTimedRow);
    assert.ok(l.untimedFromRow > lastTimedRow);
  });

  it("is deterministic: the same project in any order gives the same layout (NFR-9)", () => {
    const p = project();
    const shuffled: Project = { ...p, nodes: [...p.nodes].reverse(), edges: [...p.edges].reverse() };
    assert.deepEqual(layoutOf(shuffled), layoutOf(p));
  });

  it("scales with zoom", () => {
    const narrow = layoutOf(project(), 10);
    const wide = layoutOf(project(), 20);
    assert.equal(wide.width, narrow.width * 2);
  });
});

describe("zoom", () => {
  it("offers hours to quarters, finest first", () => {
    assert.deepEqual(
      ZOOM_LEVELS.map((z) => z.name),
      ["Hours", "Days", "Weeks", "Months", "Quarters"],
    );
    for (let i = 1; i < ZOOM_LEVELS.length; i++) assert.ok(ZOOM_LEVELS[i]!.pxPerDay < ZOOM_LEVELS[i - 1]!.pxPerDay);
  });

  it("fits a span into a width", () => {
    assert.equal(fitPxPerDay(10 * DAY, 1000), 100);
  });
});

describe("timeTicks", () => {
  it("labels days at day zoom", () => {
    // Local midnight so the test holds in any time zone
    const start = new Date(2026, 10, 2).getTime();
    const ticks = timeTicks(start, new Date(2026, 10, 5).getTime(), 96);
    assert.deepEqual(
      ticks.map((t) => t.label),
      ["Mon 2", "Tue 3", "Wed 4", "Thu 5"],
    );
  });

  it("labels months at month zoom", () => {
    const ticks = timeTicks(new Date(2026, 9, 15).getTime(), new Date(2027, 0, 3).getTime(), 4);
    assert.deepEqual(
      ticks.map((t) => t.label),
      ["Nov 2026", "Dec 2026", "Jan 2027"],
    );
  });
});
