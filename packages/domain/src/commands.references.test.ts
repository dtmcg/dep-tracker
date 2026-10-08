import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommands, CommandError, invertCommands } from "./commands.ts";
import type { Project, ProjectNode } from "./model.ts";

const base = (): Project => ({
  id: "p01",
  name: "Mobile relaunch",
  start: "2026-11-02T09:00:00.000Z",
  rootId: "root",
  nodes: [{ id: "root", title: "Release", workTime: "2d", labels: [], description: "", links: [] }],
  edges: [],
});

const refNode = (extra: Partial<ProjectNode> = {}): ProjectNode => ({
  id: "ext",
  title: "Partner API",
  workTime: "0m",
  labels: [],
  description: "",
  links: [],
  ref: { storage: { kind: "csv", path: "/plans/partner" } },
  ...extra,
});

describe("reference nodes in commands", () => {
  it("adds a reference node", () => {
    const p = applyCommands(base(), [{ type: "addNode", node: refNode() }]);
    assert.deepEqual(p.nodes[1]?.ref, { storage: { kind: "csv", path: "/plans/partner" } });
  });

  it("gives a reference a zero work time and no not-before date whatever was sent", () => {
    const p = applyCommands(base(), [{ type: "addNode", node: refNode({ workTime: "", notBefore: "2030-01-01T00:00:00.000Z" }) }]);
    assert.equal(p.nodes[1]?.workTime, "0m");
    assert.equal(p.nodes[1]?.notBefore, undefined);
  });

  it("trims the target path", () => {
    const p = applyCommands(base(), [{ type: "addNode", node: refNode({ ref: { storage: { kind: "csv", path: "  /plans/partner " } } }) }]);
    assert.deepEqual(p.nodes[1]?.ref, { storage: { kind: "csv", path: "/plans/partner" } });
  });

  it("rejects a reference to an unknown kind of store or an empty path", () => {
    assert.throws(
      () => applyCommands(base(), [{ type: "addNode", node: refNode({ ref: { storage: { kind: "word", path: "/x" } as never } }) }]),
      (e: unknown) => e instanceof CommandError && /word/.test(e.message),
    );
    assert.throws(
      () => applyCommands(base(), [{ type: "addNode", node: refNode({ ref: { storage: { kind: "csv", path: "  " } } }) }]),
      CommandError,
    );
  });

  it("lets other nodes depend on a reference", () => {
    const p = applyCommands(base(), [
      { type: "addNode", node: refNode() },
      { type: "addEdge", dependentId: "root", dependencyId: "ext" },
    ]);
    assert.equal(p.edges.length, 1);
  });

  it("refuses to make a reference depend on anything", () => {
    assert.throws(
      () =>
        applyCommands(base(), [
          { type: "addNode", node: refNode() },
          { type: "addEdge", dependentId: "ext", dependencyId: "root" },
        ]),
      (e: unknown) => e instanceof CommandError && /reference/i.test(e.message),
    );
  });

  it("refuses to change a reference's work time or not-before date", () => {
    const p = applyCommands(base(), [{ type: "addNode", node: refNode() }]);
    for (const changes of [{ workTime: "3d" }, { notBefore: "2026-12-01T00:00:00.000Z" }]) {
      assert.throws(
        () => applyCommands(p, [{ type: "updateNode", id: "ext", changes }]),
        (e: unknown) => e instanceof CommandError && /other project/i.test(e.message),
      );
    }
  });

  it("lets a reference be renamed, labelled and described", () => {
    const p = applyCommands(base(), [{ type: "addNode", node: refNode() }]);
    const next = applyCommands(p, [{ type: "updateNode", id: "ext", changes: { title: "Partner API v2", labels: ["risk"], description: "Owned by Acme" } }]);
    assert.equal(next.nodes[1]?.title, "Partner API v2");
    assert.deepEqual(next.nodes[1]?.labels, ["risk"]);
    assert.equal(next.nodes[1]?.workTime, "0m");
  });

  it("can point a reference at a different project", () => {
    const p = applyCommands(base(), [{ type: "addNode", node: refNode() }]);
    const next = applyCommands(p, [{ type: "updateNode", id: "ext", changes: { ref: { storage: { kind: "csv", path: "/vault/other" } } } }]);
    assert.deepEqual(next.nodes[1]?.ref, { storage: { kind: "csv", path: "/vault/other" } });
  });

  it("refuses to turn an ordinary node into a reference", () => {
    assert.throws(
      () => applyCommands(base(), [{ type: "updateNode", id: "root", changes: { ref: { storage: { kind: "csv", path: "/x" } } } }]),
      (e: unknown) => e instanceof CommandError && /new node/i.test(e.message),
    );
  });

  it("undoes removing a reference, edge and all", () => {
    const withRef = applyCommands(base(), [
      { type: "addNode", node: refNode() },
      { type: "addEdge", dependentId: "root", dependencyId: "ext" },
    ]);
    const remove = [{ type: "removeNode", id: "ext" } as const];
    const after = applyCommands(withRef, remove);
    assert.equal(after.nodes.length, 1);
    assert.deepEqual(applyCommands(after, invertCommands(withRef, remove)), withRef);
  });
});
