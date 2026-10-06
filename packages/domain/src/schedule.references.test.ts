import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExternalTime, Project, ProjectNode } from "./model.ts";
import { schedule } from "./schedule.ts";

const node = (id: string, title: string, workTime: string, extra: Partial<ProjectNode> = {}): ProjectNode => ({
  id,
  title,
  workTime,
  labels: [],
  description: "",
  links: [],
  ...extra,
});
const reference = (id: string, title: string, extra: Partial<ProjectNode> = {}): ProjectNode =>
  node(id, title, "0m", { ref: { storage: { kind: "csv", path: `/plans/${id}` } }, ...extra });

/** Release (2d) depends on Partner API, a reference to another project's root. */
function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p01",
    name: "Mobile relaunch",
    start: "2026-11-02T09:00:00.000Z",
    rootId: "root",
    nodes: [node("root", "Release", "2d"), reference("ext", "Partner API")],
    edges: [{ dependentId: "root", dependencyId: "ext" }],
    ...overrides,
  };
}

const done = (completion: string): ExternalTime => ({ completion });

describe("schedule with reference nodes", () => {
  it("takes a reference's completion from the other project's root", () => {
    const result = schedule(project(), { ext: done("2026-11-10T12:00:00.000Z") });
    assert.deepEqual(result.nodes.ext, { start: "2026-11-10T12:00:00.000Z", completion: "2026-11-10T12:00:00.000Z" });
    assert.equal(result.errors.ext, undefined);
    assert.deepEqual(result.flags.ext, undefined);
  });

  it("uses that completion as the dependency time of whatever needs it", () => {
    const result = schedule(project(), { ext: done("2026-11-10T12:00:00.000Z") });
    assert.deepEqual(result.nodes.root, {
      start: "2026-11-10T12:00:00.000Z",
      completion: "2026-11-12T12:00:00.000Z",
      dependencyTime: "2026-11-10T12:00:00.000Z",
    });
  });

  it("lets a not-before date win over an earlier reference, as for any dependency", () => {
    const p = project({ nodes: [node("root", "Release", "2d", { notBefore: "2026-12-01T00:00:00.000Z" }), reference("ext", "Partner API")] });
    const result = schedule(p, { ext: done("2026-11-10T12:00:00.000Z") });
    assert.equal(result.nodes.root?.completion, "2026-12-03T00:00:00.000Z");
  });

  it("ignores a reference node's own work time, not-before date and dependencies", () => {
    const p = project({
      nodes: [
        node("root", "Release", "2d"),
        reference("ext", "Partner API", { workTime: "9d", notBefore: "2030-01-01T00:00:00.000Z" }),
        node("other", "Other", "5d"),
      ],
      edges: [
        { dependentId: "root", dependencyId: "ext" },
        { dependentId: "ext", dependencyId: "other" },
      ],
    });
    const result = schedule(p, { ext: done("2026-11-10T12:00:00.000Z") });
    assert.equal(result.nodes.ext?.completion, "2026-11-10T12:00:00.000Z");
    assert.equal(result.nodes.ext?.dependencyTime, undefined);
  });

  it("flags a reference whose project couldn't be read as unresolved, with the reason", () => {
    const result = schedule(project(), { ext: { error: 'No project.csv found in /plans/ext' } });
    assert.equal(result.nodes.ext, undefined);
    assert.deepEqual(result.flags.ext, ["unresolved"]);
    assert.match(result.errors.ext ?? "", /No project\.csv found in \/plans\/ext/);
  });

  it("treats a reference nobody has resolved yet as unresolved", () => {
    const result = schedule(project());
    assert.deepEqual(result.flags.ext, ["unresolved"]);
    assert.match(result.errors.ext ?? "", /not been resolved/i);
  });

  it("blocks dependents of an unresolved reference, directly and indirectly, like a cycle does", () => {
    const p = project({
      nodes: [node("root", "Release", "2d"), node("mid", "Middle", "1d"), reference("ext", "Partner API"), node("free", "Free", "1d")],
      edges: [
        { dependentId: "root", dependencyId: "mid" },
        { dependentId: "mid", dependencyId: "ext" },
        { dependentId: "root", dependencyId: "free" },
      ],
    });
    const result = schedule(p, { ext: { error: "gone" } });
    assert.deepEqual(result.flags.mid, ["blockedByReference"]);
    assert.deepEqual(result.flags.root, ["blockedByReference"]);
    assert.equal(result.nodes.root, undefined);
    assert.equal(result.nodes.mid, undefined);
    assert.match(result.errors.mid ?? "", /Partner API/);
    assert.equal(result.nodes.free?.completion, "2026-11-03T09:00:00.000Z"); // unrelated work is still dated
  });

  it("flags a reference in a loop of projects as cyclic and records the loop", () => {
    const result = schedule(project(), { ext: { error: "cycle", cycle: ["Mobile relaunch", "Partner", "Mobile relaunch"] } });
    assert.deepEqual(result.flags.ext, ["cyclic"]);
    assert.match(result.errors.ext ?? "", /Mobile relaunch → Partner → Mobile relaunch/);
    assert.deepEqual(result.projectCycles, [{ nodeId: "ext", path: ["Mobile relaunch", "Partner", "Mobile relaunch"] }]);
    // Whatever depends on it can't be timed, so the project's own root is flagged too.
    assert.deepEqual(result.flags.root, ["blockedByCycle"]);
    assert.equal(result.nodes.root, undefined);
  });

  it("has no project cycles when nothing references anything", () => {
    const result = schedule(project({ nodes: [node("root", "Release", "2d")], edges: [] }));
    assert.deepEqual(result.projectCycles, []);
  });

  it("still flags a reference that isn't reachable from the success criteria as an orphan", () => {
    const p = project({ edges: [] });
    const result = schedule(p, { ext: done("2026-11-10T12:00:00.000Z") });
    assert.deepEqual(result.flags.ext, ["orphan"]);
  });

  it("gives the same answer whatever order nodes are listed in", () => {
    const a = schedule(project(), { ext: done("2026-11-10T12:00:00.000Z") });
    const reordered = project();
    reordered.nodes.reverse();
    assert.deepEqual(schedule(reordered, { ext: done("2026-11-10T12:00:00.000Z") }), a);
  });
});
