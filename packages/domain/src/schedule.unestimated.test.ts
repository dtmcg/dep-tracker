import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Project, ProjectNode } from "./model.ts";
import { schedule } from "./schedule.ts";

const node = (id: string, title: string, workTime: string, extra: Partial<ProjectNode> = {}): ProjectNode => ({
  id,
  title,
  workTime,
  labels: [],
  description: "",
  links: [],
  ...extra,
});

/** Release (2d) needs Design (3d) and Sketch (no work time yet). */
function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p01",
    name: "Plan",
    start: "2026-11-02T09:00:00.000Z",
    rootId: "root",
    nodes: [node("root", "Release", "2d"), node("design", "Design", "3d"), node("sketch", "Sketch", "")],
    edges: [
      { dependentId: "root", dependencyId: "design" },
      { dependentId: "root", dependencyId: "sketch" },
    ],
    ...overrides,
  };
}

describe("nodes without a work time", () => {
  it("flags them as unestimated and leaves them out of their dependents' dates", () => {
    const result = schedule(project());
    assert.deepEqual(result.flags.sketch, ["unestimated"]);
    // Release waits for Design only: 3d, then its own 2d
    assert.equal(result.nodes.root?.dependencyTime, "2026-11-05T09:00:00.000Z");
    assert.equal(result.nodes.root?.completion, "2026-11-07T09:00:00.000Z");
  });

  it("gives the node itself a placeholder date from when it could start", () => {
    const result = schedule(project());
    assert.deepEqual(result.nodes.sketch, { start: "2026-11-02T09:00:00.000Z", completion: "2026-11-02T09:00:00.000Z" });
  });

  it("treats whitespace as no work time", () => {
    assert.deepEqual(schedule(project({ nodes: [node("root", "Release", "2d"), node("design", "Design", "3d"), node("sketch", "Sketch", "  ")] })).flags.sketch, [
      "unestimated",
    ]);
  });

  it("lets a root with no work time complete when its dependencies do", () => {
    const p = project({ nodes: [node("root", "Release", ""), node("design", "Design", "3d")], edges: [{ dependentId: "root", dependencyId: "design" }] });
    const result = schedule(p);
    assert.equal(result.nodes.root?.completion, "2026-11-05T09:00:00.000Z");
    assert.deepEqual(result.flags.root, ["unestimated"]);
  });

  it("dates a lone root with no work time at the project start", () => {
    const result = schedule(project({ nodes: [node("root", "Release", "")], edges: [] }));
    assert.equal(result.nodes.root?.completion, "2026-11-02T09:00:00.000Z");
  });

  it("starts being counted as soon as a work time is entered", () => {
    const p = project();
    p.nodes = p.nodes.map((n) => (n.id === "sketch" ? { ...n, workTime: "5d" } : n));
    const result = schedule(p);
    assert.equal(result.flags.sketch, undefined);
    assert.equal(result.nodes.root?.completion, "2026-11-09T09:00:00.000Z");
  });

  it("still reports a work time that is written wrongly", () => {
    const result = schedule(project({ nodes: [node("root", "Release", "2d"), node("design", "Design", "soon")], edges: [{ dependentId: "root", dependencyId: "design" }] }));
    assert.match(result.errors.design ?? "", /"soon"/);
  });
});
