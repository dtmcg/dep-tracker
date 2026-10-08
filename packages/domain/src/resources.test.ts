import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommands, type Command, CommandError, invertCommands, RESOURCE_COMMANDS } from "./commands.ts";
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

describe("resource requirements on work items", () => {
  const need = (typeName: string, count: number) => ({ typeName, count });
  const set = (project: Project, resources: { typeName: string; count: number }[]) =>
    applyCommands(project, [{ type: "updateNode", id: "n01", changes: { resources } }]);

  it("lets a work item need a number of resources of a type, e.g. Developer x 2", () => {
    const next = set(withDevs, [need("Developer", 2)]);
    assert.deepEqual(next.nodes[0]!.resources, [need("Developer", 2)]);
    assert.equal(withDevs.nodes[0]!.resources, undefined);
  });

  it("matches the type ignoring case and stores it as the pool names it", () => {
    assert.deepEqual(set(withDevs, [need(" developer ", 1)]).nodes[0]!.resources, [need("Developer", 1)]);
  });

  it("can create the type and require it in one batch", () => {
    const next = applyCommands(base, [
      { type: "addResourceType", name: "Tester" },
      { type: "updateNode", id: "n01", changes: { resources: [need("Tester", 3)] } },
    ]);
    assert.deepEqual(next.nodes[0]!.resources, [need("Tester", 3)]);
  });

  it("rejects a type that isn't in the pool, a count that isn't a whole number of at least 1, and a repeated type", () => {
    assert.throws(() => set(withDevs, [need("Tester", 1)]), /not a resource type/);
    for (const count of [0, -1, 1.5, Number.NaN]) assert.throws(() => set(withDevs, [need("Developer", count)]), /whole number/);
    assert.throws(() => set(withDevs, [need("Developer", 1), need("developer", 2)]), /twice/);
  });

  it("clears the requirement with an empty list", () => {
    const next = set(set(withDevs, [need("Developer", 2)]), []);
    assert.equal("resources" in next.nodes[0]!, false);
  });

  it("refuses resources on a reference to another project", () => {
    const withRef = applyCommands(withDevs, [
      { type: "addNode", node: { id: "ref", title: "Other", workTime: "0m", labels: [], description: "", links: [], ref: { storage: { kind: "csv", path: "/x" } } } },
    ]);
    assert.throws(() => applyCommands(withRef, [{ type: "updateNode", id: "ref", changes: { resources: [need("Developer", 1)] } }]), /reference/);
  });

  it("drops a type's requirements from work items when the type is removed, and undo brings them back", () => {
    const needing = set(withDevs, [need("Developer", 2)]);
    const commands = [{ type: "removeResourceType", name: "Developer" }] as const;
    const removed = applyCommands(needing, [...commands]);
    assert.equal("resources" in removed.nodes[0]!, false);
    assert.deepEqual(applyCommands(removed, invertCommands(needing, [...commands])), needing);
  });

  it("undoes a change of requirement, including setting the first one", () => {
    const first: Command[] = [{ type: "updateNode", id: "n01", changes: { resources: [need("Developer", 1)] } }];
    const after = applyCommands(withDevs, first);
    const undo = invertCommands(withDevs, first);
    assert.deepEqual(JSON.parse(JSON.stringify(undo)), undo, "survives being sent as JSON");
    assert.deepEqual(applyCommands(after, undo).nodes[0]!.resources ?? [], []);
  });
});

describe("resources and the schedule", () => {
  it("never change a work item's duration: allocating more resources leaves every date as it was", async () => {
    const { schedule } = await import("./schedule.ts");
    const plain = applyCommands(withDevs, [{ type: "updateNode", id: "n01", changes: { workTime: "3d" } }]);
    const many = applyCommands(plain, [{ type: "updateNode", id: "n01", changes: { resources: [{ typeName: "Developer", count: 2 }] } }]);
    const more = applyCommands(many, [{ type: "updateNode", id: "n01", changes: { resources: [{ typeName: "Developer", count: 9 }] } }]);
    assert.deepEqual(schedule(many).nodes, schedule(plain).nodes);
    assert.deepEqual(schedule(more).nodes, schedule(plain).nodes);
  });
});
