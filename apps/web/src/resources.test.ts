import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommands } from "@dep-tracker/domain";
import { canChange, changeCount, setLimits, addInstance, cloneInstance, removeInstance, requireType, resourceLabel } from "./resources.ts";

const dev = { name: "Developer", resources: [{ id: "r1", name: "Ann", available: "40h" }, { id: "r2", name: "", available: "" }] };
const project = { id: "p", name: "P", start: "2026-11-02T09:00:00.000Z", rootId: "n", nodes: [], edges: [], resourceTypes: [dev] };

describe("resource commands for the UI", () => {
  it("adds an instance from a form with nothing filled in", () => {
    assert.deepEqual(addInstance("Developer", { name: "", available: "" }, "x"), {
      type: "addResource",
      typeName: "Developer",
      resource: { id: "x", name: "", available: "" },
    });
  });

  it("trims what was typed and rejects an available time that isn't a duration", () => {
    assert.deepEqual(addInstance("Developer", { name: " Cy ", available: " 3d " }, "x"), {
      type: "addResource",
      typeName: "Developer",
      resource: { id: "x", name: "Cy", available: "3d" },
    });
    assert.throws(() => addInstance("Developer", { name: "", available: "lots" }), /Available time/);
  });

  it("clones an instance with the same details and a new id, right after the original", () => {
    const command = cloneInstance(dev, dev.resources[0]!, "copy");
    const next = applyCommands(project, [command]).resourceTypes![0]!.resources;
    assert.deepEqual(next.map((r) => r.id), ["r1", "copy", "r2"]);
    assert.deepEqual(next[1], { id: "copy", name: "Ann", available: "40h" });
  });

  it("gives every clone its own id", () => {
    const a = cloneInstance(dev, dev.resources[0]!);
    const b = cloneInstance(dev, dev.resources[0]!);
    assert.notEqual((a as { resource: { id: string } }).resource.id, (b as { resource: { id: string } }).resource.id);
  });

  it("removes an instance", () => {
    const next = applyCommands(project, [removeInstance(dev, dev.resources[0]!)]).resourceTypes![0]!.resources;
    assert.deepEqual(next.map((r) => r.id), ["r2"]);
  });

  it("labels an unnamed instance by its type", () => {
    assert.equal(resourceLabel(dev, dev.resources[0]!), "Ann");
    assert.equal(resourceLabel(dev, dev.resources[1]!), "Unnamed developer");
  });
});

describe("requirements for the UI", () => {
  const node = { id: "n", title: "Build", workTime: "1d", labels: [], description: "", links: [] };
  const apply = (n: typeof node & { resources?: { typeName: string; count: number }[] }, commands: ReturnType<typeof requireType>) =>
    applyCommands({ ...project, nodes: [n], rootId: "n" }, commands);

  it("picks an existing type, needing 1 to start", () => {
    const next = apply(node, requireType(node, [dev], "developer"));
    assert.deepEqual(next.nodes[0]!.resources, [{ typeName: "Developer", count: 1 }]);
  });

  it("creates a new type and picks it in one go", () => {
    const commands = requireType(node, [dev], " Designer ");
    assert.equal(commands[0]!.type, "addResourceType");
    const next = apply(node, commands);
    assert.deepEqual(next.resourceTypes!.map((t) => t.name), ["Developer", "Designer"]);
    assert.deepEqual(next.nodes[0]!.resources, [{ typeName: "Designer", count: 1 }]);
  });

  it("won't pick the same type twice, or nothing", () => {
    const needing = { ...node, resources: [{ typeName: "Developer", count: 1 }] };
    assert.throws(() => requireType(needing, [dev], "Developer"), /already required/);
    assert.throws(() => requireType(node, [dev], "  "), /Choose/);
  });

  it("raises and lowers the number needed; below 1 the requirement goes", () => {
    const two = { ...node, resources: [{ typeName: "Developer", count: 2 }] };
    assert.deepEqual(apply(two, [changeCount(two, "Developer", 1)]).nodes[0]!.resources, [{ typeName: "Developer", count: 3 }]);
    assert.deepEqual(apply(two, [changeCount(two, "Developer", -1)]).nodes[0]!.resources, [{ typeName: "Developer", count: 1 }]);
    const one = { ...node, resources: [{ typeName: "Developer", count: 1 }] };
    assert.equal("resources" in apply(one, [changeCount(one, "Developer", -1)]).nodes[0]!, false);
  });
});

describe("limits for the UI", () => {
  const node = { id: "n", title: "Build", workTime: "1d", labels: [], description: "", links: [], resources: [{ typeName: "Developer", count: 2, min: 1, max: 3 }] };
  const run = (c: ReturnType<typeof setLimits>) => applyCommands({ ...project, nodes: [node], rootId: "n" }, [c]).nodes[0]!.resources;

  it("stops + at the maximum and − at the minimum", () => {
    assert.equal(canChange({ count: 3, max: 3 }, 1), false);
    assert.equal(canChange({ count: 2, max: 3 }, 1), true);
    assert.equal(canChange({ count: 1, min: 1 }, -1), false);
    assert.equal(canChange({ count: 1 }, -1), true, "with no minimum, − at 1 removes the requirement");
    const atMax = { ...node, resources: [{ typeName: "Developer", count: 3, min: 1, max: 3 }] };
    assert.throws(() => changeCount(atMax, "Developer", 1), /maximum of 3/);
    const atMin = { ...node, resources: [{ typeName: "Developer", count: 1, min: 1, max: 3 }] };
    assert.throws(() => changeCount(atMin, "Developer", -1), /minimum of 1/);
  });

  it("keeps the limits when the number changes", () => {
    const next = applyCommands({ ...project, nodes: [node], rootId: "n" }, [changeCount(node, "Developer", 1)]).nodes[0]!.resources;
    assert.deepEqual(next, [{ typeName: "Developer", count: 3, min: 1, max: 3 }]);
  });

  it("sets, changes and clears limits; blank means none", () => {
    assert.deepEqual(run(setLimits(node, "Developer", { min: "2", max: "" })), [{ typeName: "Developer", count: 2, min: 2 }]);
    assert.deepEqual(run(setLimits(node, "Developer", { min: "", max: "" })), [{ typeName: "Developer", count: 2 }]);
  });

  it("moves the number allocated into the new range", () => {
    assert.equal(run(setLimits(node, "Developer", { min: "4", max: "6" }))![0]!.count, 4);
    assert.equal(run(setLimits(node, "Developer", { min: "", max: "1" }))![0]!.count, 1);
  });

  it("rejects limits that make no sense", () => {
    assert.throws(() => setLimits(node, "Developer", { min: "3", max: "2" }), /can't be less/);
    assert.throws(() => setLimits(node, "Developer", { min: "0", max: "" }), /whole number/);
    assert.throws(() => setLimits(node, "Developer", { min: "", max: "x" }), /whole number/);
  });
});
