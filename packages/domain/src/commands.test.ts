import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommands, CommandError, invertCommands } from "./commands.ts";
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

  it("updates a node's fields, validating them", () => {
    const next = applyCommands(base, [
      { type: "updateNode", id: "n01", changes: { title: " Release ", notBefore: "2026-11-05T09:00:00.000Z", links: ["https://x.test"] } },
    ]);
    assert.equal(next.nodes[0]?.title, "Release");
    assert.equal(next.nodes[0]?.notBefore, "2026-11-05T09:00:00.000Z");
    assert.deepEqual(next.nodes[0]?.links, ["https://x.test"]);
    assert.throws(() => applyCommands(base, [{ type: "updateNode", id: "n01", changes: { workTime: "2x" } }]), CommandError);
    assert.throws(() => applyCommands(base, [{ type: "updateNode", id: "n01", changes: { notBefore: "someday" } }]), /not-before/i);
    assert.throws(() => applyCommands(base, [{ type: "updateNode", id: "n99", changes: {} }]), /n99/);
  });

  it("clears a not-before date when it is set to null", () => {
    const dated = applyCommands(base, [{ type: "updateNode", id: "n01", changes: { notBefore: "2026-11-05T09:00:00.000Z" } }]);
    const cleared = applyCommands(dated, [{ type: "updateNode", id: "n01", changes: { notBefore: null } }]);
    assert.equal("notBefore" in (cleared.nodes[0] ?? {}), false);
  });

  it("removes a node together with its edges, but never the root", () => {
    const withDep = applyCommands(base, [
      { type: "addNode", node: node("n02") },
      { type: "addEdge", dependentId: "n01", dependencyId: "n02" },
    ]);
    const next = applyCommands(withDep, [{ type: "removeNode", id: "n02" }]);
    assert.deepEqual(next.nodes.map((n) => n.id), ["n01"]);
    assert.deepEqual(next.edges, []);
    assert.throws(() => applyCommands(withDep, [{ type: "removeNode", id: "n01" }]), /success criteria/i);
  });

  it("removes an edge", () => {
    const withDep = applyCommands(base, [
      { type: "addNode", node: node("n02") },
      { type: "addEdge", dependentId: "n01", dependencyId: "n02" },
    ]);
    const next = applyCommands(withDep, [{ type: "removeEdge", dependentId: "n01", dependencyId: "n02" }]);
    assert.deepEqual(next.edges, []);
    assert.throws(() => applyCommands(next, [{ type: "removeEdge", dependentId: "n01", dependencyId: "n02" }]), /no such/i);
  });
});

describe("invertCommands", () => {
  const withDep = applyCommands(base, [
    { type: "addNode", node: node("n02") },
    { type: "addNode", node: node("n03") },
    { type: "addEdge", dependentId: "n01", dependencyId: "n02" },
    { type: "addEdge", dependentId: "n02", dependencyId: "n03" },
  ]);

  const cases: [string, Parameters<typeof applyCommands>[1]][] = [
    ["addNode + addEdge", [{ type: "addNode", node: node("n09") }, { type: "addEdge", dependentId: "n01", dependencyId: "n09" }]],
    ["updateNode", [{ type: "updateNode", id: "n02", changes: { title: "Renamed", notBefore: "2026-11-09T00:00:00.000Z" } }]],
    ["removeNode with edges", [{ type: "removeNode", id: "n02" }]],
    ["removeEdge", [{ type: "removeEdge", dependentId: "n02", dependencyId: "n03" }]],
  ];

  for (const [name, commands] of cases) {
    it(`undoes ${name}`, () => {
      const inverse = invertCommands(withDep, commands);
      const after = applyCommands(withDep, commands);
      const restored = applyCommands(after, inverse);
      const sort = <T>(xs: T[]) => [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      assert.deepEqual(sort(restored.nodes), sort(withDep.nodes));
      assert.deepEqual(sort(restored.edges), sort(withDep.edges));
    });
  }
});
