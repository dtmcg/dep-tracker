import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Project } from "./model.ts";
import { schedule } from "./schedule.ts";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p01",
    name: "Mobile relaunch",
    start: "2026-11-02T09:00:00.000Z",
    rootId: "n01",
    nodes: [{ id: "n01", title: "Public beta live", workTime: "2d", labels: [], description: "", links: [] }],
    edges: [],
    ...overrides,
  };
}

describe("schedule", () => {
  it("anchors a node with no dependencies at the project start", () => {
    const result = schedule(project());
    assert.deepEqual(result.nodes.n01, {
      start: "2026-11-02T09:00:00.000Z",
      completion: "2026-11-04T09:00:00.000Z",
    });
  });

  it("computes every node in the project", () => {
    const p = project({
      nodes: [
        { id: "n01", title: "Root", workTime: "1d", labels: [], description: "", links: [] },
        { id: "n02", title: "Orphan", workTime: "4h", labels: [], description: "", links: [] },
      ],
    });
    const result = schedule(p);
    assert.equal(result.nodes.n02?.completion, "2026-11-02T13:00:00.000Z");
  });

  it("reports an invalid work time against its node instead of throwing", () => {
    const p = project({
      nodes: [{ id: "n01", title: "Root", workTime: "soon", labels: [], description: "", links: [] }],
    });
    const result = schedule(p);
    assert.equal(result.nodes.n01, undefined);
    assert.match(result.errors.n01 ?? "", /"soon"/);
  });

  it("starts a dependent when its latest dependency completes", () => {
    const p = project({
      nodes: [
        { id: "n01", title: "Root", workTime: "2d", labels: [], description: "", links: [] },
        { id: "n02", title: "A", workTime: "3d", labels: [], description: "", links: [] },
        { id: "n03", title: "B", workTime: "1d", labels: [], description: "", links: [] },
      ],
      edges: [
        { dependentId: "n01", dependencyId: "n02" },
        { dependentId: "n01", dependencyId: "n03" },
      ],
    });
    const result = schedule(p);
    assert.deepEqual(result.nodes.n02, { start: "2026-11-02T09:00:00.000Z", completion: "2026-11-05T09:00:00.000Z" });
    assert.deepEqual(result.nodes.n01, {
      start: "2026-11-05T09:00:00.000Z",
      completion: "2026-11-07T09:00:00.000Z",
      dependencyTime: "2026-11-05T09:00:00.000Z",
    });
  });

  it("chains through several levels regardless of node order", () => {
    const nodes = [
      { id: "n03", title: "C", workTime: "1d", labels: [], description: "", links: [] },
      { id: "n01", title: "Root", workTime: "1d", labels: [], description: "", links: [] },
      { id: "n02", title: "B", workTime: "1d", labels: [], description: "", links: [] },
    ];
    const edges = [
      { dependentId: "n01", dependencyId: "n02" },
      { dependentId: "n02", dependencyId: "n03" },
    ];
    const forward = schedule(project({ nodes, edges }));
    const reversed = schedule(project({ nodes: [...nodes].reverse(), edges: [...edges].reverse() }));
    assert.equal(forward.nodes.n01?.completion, "2026-11-05T09:00:00.000Z");
    assert.deepEqual(forward, reversed);
  });

  it("leaves dependents of an untimeable node untimed and explains why", () => {
    const p = project({
      nodes: [
        { id: "n01", title: "Root", workTime: "1d", labels: [], description: "", links: [] },
        { id: "n02", title: "Bad", workTime: "soon", labels: [], description: "", links: [] },
      ],
      edges: [{ dependentId: "n01", dependencyId: "n02" }],
    });
    const result = schedule(p);
    assert.equal(result.nodes.n01, undefined);
    assert.match(result.errors.n01 ?? "", /Bad/);
  });

  it("passes the PRD's worked example: not-before 1 Nov, dependencies 30 Oct and 4 Nov, 2d → 6 Nov", () => {
    const p = project({
      start: "2026-10-28T09:00:00.000Z",
      nodes: [
        { id: "n01", title: "Release", workTime: "2d", notBefore: "2026-11-01T09:00:00.000Z", labels: [], description: "", links: [] },
        { id: "n02", title: "Docs", workTime: "2d", labels: [], description: "", links: [] },
        { id: "n03", title: "Payments", workTime: "1w", labels: [], description: "", links: [] },
      ],
      edges: [
        { dependentId: "n01", dependencyId: "n02" },
        { dependentId: "n01", dependencyId: "n03" },
      ],
    });
    const result = schedule(p);
    assert.equal(result.nodes.n02?.completion, "2026-10-30T09:00:00.000Z");
    assert.equal(result.nodes.n03?.completion, "2026-11-04T09:00:00.000Z");
    assert.equal(result.nodes.n01?.dependencyTime, "2026-11-04T09:00:00.000Z");
    assert.equal(result.nodes.n01?.completion, "2026-11-06T09:00:00.000Z");
  });

  it("uses a not-before date later than the dependency time", () => {
    const p = project({
      nodes: [{ id: "n01", title: "Root", workTime: "1d", notBefore: "2026-12-01T00:00:00.000Z", labels: [], description: "", links: [] }],
    });
    assert.deepEqual(schedule(p).nodes.n01, { start: "2026-12-01T00:00:00.000Z", completion: "2026-12-02T00:00:00.000Z" });
  });

  it("honours a not-before date even when it is earlier than the project start (project start applies only when neither is set)", () => {
    const p = project({
      nodes: [{ id: "n01", title: "Root", workTime: "1d", notBefore: "2026-10-01T00:00:00.000Z", labels: [], description: "", links: [] }],
    });
    assert.equal(schedule(p).nodes.n01?.start, "2026-10-01T00:00:00.000Z");
  });
});
