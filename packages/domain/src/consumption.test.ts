import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeConsumption, nodeConsumption, projectConsumption } from "./consumption.ts";
import type { Project, ProjectNode } from "./model.ts";

const node = (id: string, workTime: string, resources?: ProjectNode["resources"]): ProjectNode => ({
  id,
  title: id,
  workTime,
  labels: [],
  description: "",
  links: [],
  ...(resources ? { resources } : {}),
});
const DAY = 86_400_000;

describe("resource consumption", () => {
  it("is the full work time for each allocated resource, whatever the number allocated", () => {
    const [one] = nodeConsumption(node("a", "3d", [{ typeName: "Developer", count: 1 }]));
    const [two] = nodeConsumption(node("a", "3d", [{ typeName: "Developer", count: 2 }]));
    assert.deepEqual(one, { typeName: "Developer", count: 1, eachMs: 3 * DAY, totalMs: 3 * DAY });
    assert.deepEqual(two, { typeName: "Developer", count: 2, eachMs: 3 * DAY, totalMs: 6 * DAY });
  });

  it("has nothing to count for an item without a work time yet", () => {
    const [c] = nodeConsumption(node("a", "", [{ typeName: "Developer", count: 2 }]));
    assert.deepEqual(c, { typeName: "Developer", count: 2, eachMs: null, totalMs: null });
  });

  it("is empty for an item that needs nothing", () => {
    assert.deepEqual(nodeConsumption(node("a", "3d")), []);
  });

  it("adds up per type across the project, including types nobody needs", () => {
    const project: Project = {
      id: "p",
      name: "P",
      start: "2026-11-02T09:00:00.000Z",
      rootId: "a",
      nodes: [
        node("a", "3d", [{ typeName: "Developer", count: 2 }]),
        node("b", "1d", [{ typeName: "Developer", count: 1 }, { typeName: "Tester", count: 3 }]),
        node("c", "", [{ typeName: "Developer", count: 1 }]),
        node("d", "5d"),
      ],
      edges: [],
      resourceTypes: [
        { name: "Developer", resources: [] },
        { name: "Tester", resources: [] },
        { name: "Designer", resources: [] },
      ],
    };
    assert.deepEqual(projectConsumption(project), [
      { typeName: "Developer", totalMs: 7 * DAY, items: 3, unestimated: 1 },
      { typeName: "Tester", totalMs: 3 * DAY, items: 1, unestimated: 0 },
      { typeName: "Designer", totalMs: 0, items: 0, unestimated: 0 },
    ]);
  });

  it("describes it in words", () => {
    const d = (count: number, workTime: string) => describeConsumption(nodeConsumption(node("a", workTime, [{ typeName: "Developer", count }]))[0]!);
    assert.equal(d(2, "3d"), "3d each, 6d in all");
    assert.equal(d(1, "3d"), "3d");
    assert.equal(d(2, ""), "no work time yet");
  });
});

describe("resource availability", () => {
  it("is continuously available (no limit) when no available time is given", async () => {
    const { availableMs, describeAvailability } = await import("./consumption.ts");
    const blank = { id: "r", name: "Ann", available: "" };
    assert.equal(availableMs(blank), null);
    assert.equal(availableMs({ ...blank, available: "  " }), null);
    assert.equal(describeAvailability(blank), "always available");
  });

  it("is the given time otherwise", async () => {
    const { availableMs, describeAvailability } = await import("./consumption.ts");
    const forty = { id: "r", name: "Ann", available: "40h" };
    assert.equal(availableMs(forty), 40 * 3_600_000);
    assert.equal(describeAvailability(forty), "40h");
  });
});
