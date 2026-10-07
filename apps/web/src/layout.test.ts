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

  it("keeps the root in the middle of its dependencies, and shared ones above and below it", () => {
    const l = layoutOf(project());
    const row = (id: string) => l.bars.find((b) => b.id === id)!.row;
    const mid = (row("a") + row("b")) / 2;
    assert.ok(Math.abs(row("r") - mid) <= 1, `root row ${row("r")} vs middle of its dependencies ${mid}`);
    assert.ok(row("a") !== row("b"));
    // Orphans (not reachable from the root) sit after the root's tree
    assert.ok(row("o") > Math.max(row("r"), row("a"), row("b"), row("c")));
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


describe("balanced layout", () => {
  const n = (id: string, workTime = "1d") => ({ id, title: id, workTime, labels: [], description: "", links: [] });
  const proj = (nodes: string[], edges: [string, string][]): Project => ({
    id: "p",
    name: "P",
    start: "2026-11-02T09:00:00.000Z",
    rootId: "r",
    nodes: nodes.map((id) => n(id)),
    edges: edges.map(([dependentId, dependencyId]) => ({ dependentId, dependencyId })),
  });
  const rowsOf = (p: Project) => {
    const l = layoutOf(p);
    return (id: string) => l.bars.find((b) => b.id === id)!.row;
  };

  it("centres the root among four dependencies", () => {
    const p = proj(["r", "a", "b", "c", "d"], [["r", "a"], ["r", "b"], ["r", "c"], ["r", "d"]]);
    const row = rowsOf(p);
    const rows = [row("a"), row("b"), row("c"), row("d")];
    assert.ok(Math.abs(row("r") - (Math.min(...rows) + Math.max(...rows)) / 2) <= 1);
    assert.equal(new Set(rows).size, 4);
  });

  it("re-balances when a dependency is added", () => {
    const three = proj(["r", "a", "b", "c"], [["r", "a"], ["r", "b"], ["r", "c"]]);
    const five = proj(["r", "a", "b", "c", "d", "e"], [["r", "a"], ["r", "b"], ["r", "c"], ["r", "d"], ["r", "e"]]);
    for (const p of [three, five]) {
      const row = rowsOf(p);
      const deps = p.nodes.filter((x) => x.id !== "r").map((x) => row(x.id));
      assert.ok(Math.abs(row("r") - (Math.min(...deps) + Math.max(...deps)) / 2) <= 1);
    }
    assert.ok(rowsOf(five)("r") > rowsOf(three)("r"), "the root moves down as there are more dependencies above and below it");
  });

  it("centres every node among its own dependencies, recursively", () => {
    // r needs x and y; x needs x1, x2, x3; y needs y1
    const p = proj(
      ["r", "x", "y", "x1", "x2", "x3", "y1"],
      [["r", "x"], ["r", "y"], ["x", "x1"], ["x", "x2"], ["x", "x3"], ["y", "y1"]],
    );
    const row = rowsOf(p);
    const near = (parent: string, kids: string[]) => {
      const rs = kids.map(row);
      return Math.abs(row(parent) - (Math.min(...rs) + Math.max(...rs)) / 2);
    };
    assert.ok(near("x", ["x1", "x2", "x3"]) <= 1);
    assert.ok(near("y", ["y1"]) <= 1);
    assert.ok(near("r", ["x", "y"]) <= 1.5);
    // The root is roughly in the middle of the whole chart
    const l = layoutOf(p);
    const last = Math.max(...l.bars.map((b) => b.row));
    assert.ok(Math.abs(row("r") - last / 2) <= 1.5, `root ${row("r")} of 0..${last}`);
  });

  it("never lets two bars overlap on one row, though they may touch end to start", () => {
    const p = proj(
      ["r", "x", "y", "x1", "x2", "x3", "y1", "y2"],
      [["r", "x"], ["r", "y"], ["x", "x1"], ["x", "x2"], ["x", "x3"], ["y", "y1"], ["y", "y2"]],
    );
    for (const pxPerDay of [6, 24, 96, 960]) {
      const l = layoutOf(p, pxPerDay);
      for (const a of l.bars) {
        for (const b of l.bars) {
          if (a.id >= b.id || a.row !== b.row) continue;
          const [first, second] = a.x <= b.x ? [a, b] : [b, a];
          assert.ok(first.x + first.width <= second.x + 0.5, `${a.id} and ${b.id} overlap at ${pxPerDay}px/day`);
        }
      }
    }
  });

  it("starts at row zero and has no empty rows above the first bar", () => {
    const l = layoutOf(proj(["r", "a", "b"], [["r", "a"], ["r", "b"]]));
    assert.equal(Math.min(...l.bars.map((b) => b.row)), 0);
    assert.equal(l.height, (Math.max(...l.bars.map((b) => b.row)) + 1) * ROW_HEIGHT);
  });
});

describe("node view layout", () => {
  const n = (id: string, workTime: string) => ({ id, title: id, workTime, labels: [], description: "", links: [] });
  const proj = (): Project => ({
    id: "p",
    name: "P",
    start: "2026-11-02T09:00:00.000Z",
    rootId: "r",
    nodes: [n("r", "2d"), n("a", "1h"), n("b", "3w"), n("c", "1d"), n("d", "2d")],
    edges: [
      { dependentId: "r", dependencyId: "a" },
      { dependentId: "r", dependencyId: "b" },
      { dependentId: "b", dependencyId: "c" },
      { dependentId: "b", dependencyId: "d" },
    ],
  });
  const nodeLayout = (p: Project, pxPerDay = 100) => layoutGantt(p, schedule(p), { pxPerDay, view: "nodes" });

  it("gives every node the same size whatever its work time", () => {
    const l = nodeLayout(proj());
    assert.equal(new Set(l.bars.map((b) => b.width)).size, 1);
    assert.equal(l.barHeight > BAR_HEIGHT, true, "tall enough for a title and a date");
    assert.ok(l.rowHeight > l.barHeight);
  });

  it("ends each node's box at the position on the time axis where it is estimated to complete", () => {
    const p = proj();
    const s = schedule(p);
    const l = nodeLayout(p, 100);
    for (const bar of l.bars.filter((b) => b.timed)) {
      const done = Date.parse(s.nodes[bar.id]!.completion);
      assert.ok(Math.abs(bar.x + bar.width - (l.axisOffset + ((done - l.origin) / DAY) * 100)) < 1e-6, bar.id);
    }
    // Nothing is cut off at the left edge
    assert.ok(Math.min(...l.bars.map((b) => b.x)) >= 0);
  });

  it("keeps the time-line view as it was", () => {
    const p = proj();
    assert.deepEqual(layoutGantt(p, schedule(p), { pxPerDay: 100 }), layoutGantt(p, schedule(p), { pxPerDay: 100, view: "timeline" }));
    assert.equal(layoutOf(p).axisOffset, 0);
  });

  it("never lets two boxes overlap on a row, at any zoom", () => {
    for (const pxPerDay of [2, 6, 24, 96, 960]) {
      const l = nodeLayout(proj(), pxPerDay);
      for (const a of l.bars) {
        for (const b of l.bars) {
          if (a.id >= b.id || a.row !== b.row) continue;
          const [first, second] = a.x <= b.x ? [a, b] : [b, a];
          assert.ok(first.x + first.width < second.x, `${a.id} and ${b.id} overlap at ${pxPerDay}px/day`);
        }
      }
    }
  });

  it("keeps the root centred on its dependencies", () => {
    const l = nodeLayout(proj());
    const row = (id: string) => l.bars.find((b) => b.id === id)!.row;
    assert.ok(Math.abs(row("r") - (row("a") + row("b")) / 2) <= 1);
    assert.ok(Math.abs(row("b") - (row("c") + row("d")) / 2) <= 1);
  });

  it("runs each edge from the right of the dependency's box to the left of the dependent's box", () => {
    const l = nodeLayout(proj());
    const mid = (row: number) => row * l.rowHeight + l.rowHeight / 2;
    for (const e of l.edges) {
      const from = l.bars.find((b) => b.id === e.dependencyId)!;
      const to = l.bars.find((b) => b.id === e.dependentId)!;
      assert.deepEqual(e.points[0], [from.x + from.width, mid(from.row)]);
      assert.deepEqual(e.points.at(-1), [to.x, mid(to.row)]);
    }
  });

  it("still puts nodes that can't be scheduled in a band at the bottom", () => {
    const p = proj();
    p.nodes.push(n("bad", "?"));
    p.edges.push({ dependentId: "r", dependencyId: "bad" });
    const l = nodeLayout(p);
    const lastTimed = Math.max(...l.bars.filter((b) => b.timed).map((b) => b.row));
    for (const b of l.bars.filter((x) => !x.timed)) assert.ok(b.row > lastTimed);
    assert.equal(l.height, (Math.max(...l.bars.map((b) => b.row)) + 1) * l.rowHeight);
  });

  it("is deterministic whatever order the project lists things in", () => {
    const p = proj();
    const shuffled: Project = { ...p, nodes: [...p.nodes].reverse(), edges: [...p.edges].reverse() };
    assert.deepEqual(nodeLayout(shuffled), nodeLayout(p));
  });
});

describe("edges avoid other nodes", () => {
  const n = (id: string, workTime: string) => ({ id, title: id, workTime, labels: [], description: "", links: [] });
  const proj = (): Project => ({
    id: "p",
    name: "P",
    start: "2026-11-02T09:00:00.000Z",
    rootId: "r",
    nodes: [n("r", "2d"), n("design", "2d"), n("build", "3d"), n("test", "1d"), n("api", "1d"), n("ui", "2d"), n("data", "1d"), n("fixtures", "1d")],
    edges: [
      ["r", "design"], ["r", "build"], ["r", "test"], ["build", "api"], ["build", "ui"], ["build", "data"], ["test", "fixtures"],
    ].map(([dependentId, dependencyId]) => ({ dependentId: dependentId!, dependencyId: dependencyId! })),
  });

  for (const view of ["timeline", "nodes"] as const) {
    it(`does not run an edge through a box that isn't one of its ends (${view})`, () => {
      const p = proj();
      const l = layoutGantt(p, schedule(p), { pxPerDay: 96, view });
      for (const e of l.edges) {
        for (let i = 1; i < e.points.length; i++) {
          const [xa, ya] = e.points[i - 1]!;
          const [xb, yb] = e.points[i]!;
          for (const b of l.bars) {
            if (b.id === e.dependencyId || b.id === e.dependentId) continue;
            const top = b.row * l.rowHeight + (l.rowHeight - l.barHeight) / 2;
            const hits =
              Math.max(xa, xb) > b.x + 1 && Math.min(xa, xb) < b.x + b.width - 1 && Math.max(ya, yb) > top + 1 && Math.min(ya, yb) < top + l.barHeight - 1;
            assert.ok(!hits, `${e.dependencyId}→${e.dependentId} runs through ${b.id}`);
          }
        }
      }
    });
  }
});
