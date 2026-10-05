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
});
