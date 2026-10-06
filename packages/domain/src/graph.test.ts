import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criticalEdges, dependenciesOf, dependentsOf } from "./graph.ts";
import type { Project } from "./model.ts";
import { schedule } from "./schedule.ts";

const n = (id: string, workTime: string, notBefore?: string) => ({
  id,
  title: id,
  workTime,
  labels: [],
  description: "",
  links: [],
  ...(notBefore ? { notBefore } : {}),
});

// r ← p ← c, r ← d, p ← s (s is short, so c drives p)
const project: Project = {
  id: "x",
  name: "X",
  start: "2026-11-02T09:00:00.000Z",
  rootId: "r",
  nodes: [n("r", "2d"), n("p", "1w"), n("c", "2d"), n("s", "1d"), n("d", "2d"), n("z", "1d")],
  edges: [
    { dependentId: "r", dependencyId: "p" },
    { dependentId: "p", dependencyId: "c" },
    { dependentId: "p", dependencyId: "s" },
    { dependentId: "r", dependencyId: "d" },
  ],
};

describe("dependenciesOf / dependentsOf", () => {
  it("collect everything upstream and downstream, transitively", () => {
    assert.deepEqual([...dependenciesOf(project, "r")].sort(), ["c", "d", "p", "s"]);
    assert.deepEqual([...dependenciesOf(project, "p")].sort(), ["c", "s"]);
    assert.deepEqual([...dependentsOf(project, "c")].sort(), ["p", "r"]);
    assert.deepEqual([...dependentsOf(project, "z")], []);
  });

  it("terminate on cycles", () => {
    const loop: Project = { ...project, edges: [...project.edges, { dependentId: "c", dependencyId: "r" }] };
    assert.deepEqual([...dependenciesOf(loop, "c")].sort(), ["c", "d", "p", "r", "s"]);
  });
});

describe("criticalEdges", () => {
  it("follows the dependencies that set each node's start", () => {
    const edges = criticalEdges(project, schedule(project), "r");
    assert.deepEqual([...edges].sort(), ["c>p", "p>r"]);
  });

  it("keeps every dependency in a tie", () => {
    const tie: Project = { ...project, nodes: project.nodes.map((x) => (x.id === "s" ? { ...x, workTime: "2d" } : x)) };
    assert.deepEqual([...criticalEdges(tie, schedule(tie), "p")].sort(), ["c>p", "s>p"]);
  });

  it("stops where a not-before date, not a dependency, sets the start", () => {
    const pinned: Project = {
      ...project,
      nodes: project.nodes.map((x) => (x.id === "r" ? n("r", "2d", "2026-12-01T00:00:00.000Z") : x)),
    };
    assert.deepEqual([...criticalEdges(pinned, schedule(pinned), "r")], []);
  });
});

describe("criticalEdges with a node that has no work time", () => {
  it("never calls the edge from an unestimated node critical", () => {
    const p: Project = {
      id: "x",
      name: "X",
      start: "2026-11-02T09:00:00.000Z",
      rootId: "r",
      nodes: [n("r", "2d"), n("a", "1d"), n("u", "")],
      edges: [
        { dependentId: "r", dependencyId: "a" },
        { dependentId: "r", dependencyId: "u" },
      ],
    };
    assert.deepEqual([...criticalEdges(p, schedule(p), "r")], ["a>r"]);
  });
});
