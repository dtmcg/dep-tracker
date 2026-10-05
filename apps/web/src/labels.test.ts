import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Project } from "@dep-tracker/domain";
import { activeLabels, labelColour, labelSummary, PALETTE } from "./labels.ts";

const project: Project = {
  id: "p",
  name: "P",
  start: "2026-11-02T09:00:00.000Z",
  rootId: "r",
  nodes: [
    { id: "r", title: "R", workTime: "1d", labels: ["risk"], description: "", links: [] },
    { id: "a", title: "A", workTime: "1d", labels: ["team:web", "risk"], description: "", links: [] },
    { id: "b", title: "B", workTime: "1d", labels: ["team:web"], description: "", links: [] },
  ],
  edges: [],
  labelColours: { "team:web": "#cc3399" },
};

describe("labelSummary", () => {
  it("lists every label with its node count and colour, sorted by name", () => {
    assert.deepEqual(labelSummary(project), [
      { label: "risk", count: 2, colour: labelColour(project, "risk") },
      { label: "team:web", count: 2, colour: "#cc3399" },
    ]);
  });

  it("keeps a coloured label in the key even when no node uses it", () => {
    const p = { ...project, labelColours: { ...project.labelColours, unused: "#123456" } };
    assert.deepEqual(labelSummary(p).find((l) => l.label === "unused"), { label: "unused", count: 0, colour: "#123456" });
  });
});

describe("labelColour", () => {
  it("uses the saved colour, otherwise a stable palette colour", () => {
    assert.equal(labelColour(project, "team:web"), "#cc3399");
    const fallback = labelColour(project, "risk");
    assert.ok(PALETTE.some((p) => p.hex === fallback));
    assert.equal(labelColour(project, "risk"), fallback);
  });
});

describe("activeLabels", () => {
  it("returns a node's labels that are switched on, in the key's order", () => {
    const node = project.nodes[1]!;
    assert.deepEqual(activeLabels(node, new Set(["team:web", "risk"])), ["risk", "team:web"]);
    assert.deepEqual(activeLabels(node, new Set(["nope"])), []);
  });
});
