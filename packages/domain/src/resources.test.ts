import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommands, CommandError, invertCommands, RESOURCE_COMMANDS } from "./commands.ts";
import type { Project } from "./model.ts";

const base: Project = {
  id: "p01",
  name: "Launch",
  start: "2026-11-02T09:00:00.000Z",
  rootId: "n01",
  nodes: [{ id: "n01", title: "Root", workTime: "2d", labels: [], description: "", links: [] }],
  edges: [],
};
const res = (id: string, name = "", available = "") => ({ id, name, available });
const withDevs = applyCommands(base, [
  { type: "addResourceType", name: "Developer" },
  { type: "addResource", typeName: "Developer", resource: res("r1", "Ann", "40h") },
  { type: "addResource", typeName: "Developer", resource: res("r2", "Bob") },
]);

describe("resource pool commands", () => {
  it("defines a resource type", () => {
    const next = applyCommands(base, [{ type: "addResourceType", name: "  Developer " }]);
    assert.deepEqual(next.resourceTypes, [{ name: "Developer", resources: [] }]);
    assert.equal(base.resourceTypes, undefined);
  });

  it("needs a type name, and no two types share one (ignoring case)", () => {
    assert.throws(() => applyCommands(base, [{ type: "addResourceType", name: "  " }]), CommandError);
    assert.throws(() => applyCommands(withDevs, [{ type: "addResourceType", name: "developer" }]), /already/);
  });

  it("adds an instance; name and available time are both optional", () => {
    assert.deepEqual(withDevs.resourceTypes![0]!.resources, [res("r1", "Ann", "40h"), res("r2", "Bob", "")]);
    const bare = applyCommands(withDevs, [{ type: "addResource", typeName: "Developer", resource: res("r3") }]);
    assert.deepEqual(bare.resourceTypes![0]!.resources.at(-1), res("r3", "", ""));
  });

  it("puts an instance at the given place in the list", () => {
    const next = applyCommands(withDevs, [{ type: "addResource", typeName: "Developer", resource: res("r3", "Cy"), index: 1 }]);
    assert.deepEqual(next.resourceTypes![0]!.resources.map((r) => r.id), ["r1", "r3", "r2"]);
  });

  it("rejects an available time that isn't a duration, an unknown type and a repeated id", () => {
    assert.throws(() => applyCommands(withDevs, [{ type: "addResource", typeName: "Developer", resource: res("r3", "x", "lots") }]), /Available time/);
    assert.throws(() => applyCommands(withDevs, [{ type: "addResource", typeName: "Tester", resource: res("r3") }]), /No resource type/);
    assert.throws(() => applyCommands(withDevs, [{ type: "addResource", typeName: "Developer", resource: res("r1") }]), /already exists/);
  });

  it("removes an instance, and a whole type", () => {
    const one = applyCommands(withDevs, [{ type: "removeResource", typeName: "Developer", id: "r1" }]);
    assert.deepEqual(one.resourceTypes![0]!.resources.map((r) => r.id), ["r2"]);
    assert.deepEqual(applyCommands(withDevs, [{ type: "removeResourceType", name: "Developer" }]).resourceTypes, []);
    assert.throws(() => applyCommands(withDevs, [{ type: "removeResource", typeName: "Developer", id: "zz" }]), CommandError);
  });

  it("undoes each of them", () => {
    const batches = [
      [{ type: "addResourceType", name: "Tester" }],
      [{ type: "addResource", typeName: "Developer", resource: res("r3", "Cy", "2d"), index: 0 }],
      [{ type: "removeResource", typeName: "Developer", id: "r1" }],
      [{ type: "removeResourceType", name: "Developer" }],
    ] as const;
    for (const commands of batches) {
      const after = applyCommands(withDevs, [...commands]);
      assert.deepEqual(applyCommands(after, invertCommands(withDevs, [...commands])), withDevs, commands[0].type);
    }
  });

  it("lists which commands belong to the feature", () => {
    assert.deepEqual([...RESOURCE_COMMANDS].sort(), ["addResource", "addResourceType", "removeResource", "removeResourceType"]);
  });
});
