import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { schedule, type Project } from "@dep-tracker/domain";
import { applyLocally, dependencyCommands, displayOrder } from "./projectState.ts";

const project: Project = {
  id: "p1",
  name: "Launch",
  start: "2026-11-02T09:00:00.000Z",
  rootId: "n01",
  nodes: [
    { id: "n01", title: "Root", workTime: "2d", labels: [], description: "", links: [] },
    { id: "n02", title: "Early", workTime: "1d", labels: [], description: "", links: [] },
    { id: "n03", title: "Late", workTime: "3d", labels: [], description: "", links: [] },
  ],
  edges: [
    { dependentId: "n01", dependencyId: "n02" },
    { dependentId: "n01", dependencyId: "n03" },
  ],
};

describe("dependencyCommands", () => {
  it("creates the node and the edge from the dependent to it", () => {
    const commands = dependencyCommands("n01", { title: " Payments ", workTime: "3d" }, "nNEW");
    assert.deepEqual(commands, [
      { type: "addNode", node: { id: "nNEW", title: "Payments", workTime: "3d", labels: [], description: "", links: [] } },
      { type: "addEdge", dependentId: "n01", dependencyId: "nNEW" },
    ]);
  });
});

describe("applyLocally", () => {
  it("returns the updated project and its recomputed schedule", () => {
    const opened = { project, schedule: schedule(project) };
    const next = applyLocally(opened, dependencyCommands("n02", { title: "Prep", workTime: "5d" }, "n04"));
    assert.equal(next.project.nodes.length, 4);
    assert.equal(next.schedule.nodes.n01?.completion, "2026-11-10T09:00:00.000Z");
    assert.equal(opened.project.nodes.length, 3);
  });
});

describe("displayOrder", () => {
  it("puts the success criteria first, then the rest by completion", () => {
    const order = displayOrder(project, schedule(project)).map((n) => n.title);
    assert.deepEqual(order, ["Root", "Early", "Late"]);
  });

  it("puts untimed nodes last", () => {
    const withBad: Project = {
      ...project,
      nodes: [...project.nodes, { id: "n00", title: "Bad", workTime: "?", labels: [], description: "", links: [] }],
    };
    assert.equal(displayOrder(withBad, schedule(withBad)).at(-1)?.title, "Bad");
  });
});
