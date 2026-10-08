import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommands } from "@dep-tracker/domain";
import { addInstance, cloneInstance, removeInstance, resourceLabel } from "./resources.ts";

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
