import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommands, CommandError } from "./commands.ts";
import type { Project } from "./model.ts";

const base: Project = {
  id: "p01",
  name: "Launch",
  start: "2026-11-02T09:00:00.000Z",
  rootId: "n01",
  nodes: [{ id: "n01", title: "Root", workTime: "2d", labels: [], description: "", links: [] }],
  edges: [],
};
const node = (id: string, title = id) => ({ id, title, workTime: "1d", labels: [], description: "", links: [] });

describe("applyCommands", () => {
  it("adds a node and an edge in one batch without mutating the input", () => {
    const next = applyCommands(base, [
      { type: "addNode", node: node("n02", "Payments") },
      { type: "addEdge", dependentId: "n01", dependencyId: "n02" },
    ]);
    assert.equal(next.nodes.length, 2);
    assert.deepEqual(next.edges, [{ dependentId: "n01", dependencyId: "n02" }]);
    assert.equal(base.nodes.length, 1);
    assert.equal(base.edges.length, 0);
  });

  it("rejects a duplicate node id", () => {
    assert.throws(() => applyCommands(base, [{ type: "addNode", node: node("n01") }]), CommandError);
  });

  it("rejects a node with an empty title or an invalid work time", () => {
    assert.throws(() => applyCommands(base, [{ type: "addNode", node: { ...node("n02"), title: "  " } }]), /title/i);
    assert.throws(() => applyCommands(base, [{ type: "addNode", node: { ...node("n02"), workTime: "later" } }]), /"later"/);
  });

  it("rejects an edge to a missing node", () => {
    assert.throws(
      () => applyCommands(base, [{ type: "addEdge", dependentId: "n01", dependencyId: "n99" }]),
      /n99/,
    );
  });

  it("rejects a duplicate edge", () => {
    const once = applyCommands(base, [
      { type: "addNode", node: node("n02") },
      { type: "addEdge", dependentId: "n01", dependencyId: "n02" },
    ]);
    assert.throws(() => applyCommands(once, [{ type: "addEdge", dependentId: "n01", dependencyId: "n02" }]), /already/);
  });

  it("applies all or nothing", () => {
    assert.throws(() =>
      applyCommands(base, [
        { type: "addNode", node: node("n02") },
        { type: "addEdge", dependentId: "n01", dependencyId: "n99" },
      ]),
    );
    assert.equal(base.nodes.length, 1);
  });

  it("trims titles", () => {
    const next = applyCommands(base, [{ type: "addNode", node: node("n02", "  Payments  ") }]);
    assert.equal(next.nodes[1]?.title, "Payments");
  });
});
