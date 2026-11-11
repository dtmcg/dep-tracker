import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../api.ts";
import { createMemoryApi } from "./memoryApi.ts";
import { sampleProject } from "./sample.ts";

const api = (resourcing = true) => createMemoryApi(sampleProject, { resourcing });

describe("the demo's sample project", () => {
  it("is a valid project that schedules cleanly, with a resource pool", async () => {
    const opened = await api().openProject({ kind: "csv", path: "" });
    assert.equal(opened.project.name, "Mobile relaunch");
    assert.deepEqual(opened.schedule.cycles, []);
    assert.ok(opened.schedule.nodes[opened.project.rootId]!.completion);
    assert.ok((opened.project.resourceTypes ?? []).length >= 3);
    // the item without a work time is flagged rather than breaking the dates
    assert.ok(opened.schedule.flags.legal?.includes("unestimated"));
  });

  it("only uses resource types that are in the pool, and keeps requirements within their limits", async () => {
    // applyCommands validates these; re-adding every requirement proves the sample is internally consistent.
    const { project } = await api().openProject({ kind: "csv", path: "" });
    const { applyCommands } = await import("@dep-tracker/domain");
    for (const n of project.nodes) assert.doesNotThrow(() => applyCommands(project, [{ type: "updateNode", id: n.id, changes: { resources: n.resources ?? [] } }]), n.id);
  });
});

describe("the in-memory API", () => {
  it("applies commands with the shared engine and reschedules", async () => {
    const a = api();
    const before = await a.openProject({ kind: "csv", path: "" });
    const after = await a.sendCommands("demo", before.version, [{ type: "updateNode", id: "qa", changes: { workTime: "10d" } }]);
    assert.notEqual(after.version, before.version);
    assert.ok(after.schedule.nodes.launch!.completion > before.schedule.nodes.launch!.completion);
    assert.equal((await a.getProject("demo")).project.nodes.find((n) => n.id === "qa")!.workTime, "10d");
  });

  it("refuses a stale version with a 409, and a bad command with a 422, changing nothing", async () => {
    const a = api();
    const opened = await a.openProject({ kind: "csv", path: "" });
    await assert.rejects(a.sendCommands("demo", "0", []), (e: ApiError) => e.status === 409);
    await assert.rejects(
      a.sendCommands("demo", opened.version, [{ type: "updateNode", id: "qa", changes: { workTime: "soon" } }]),
      (e: ApiError) => e.status === 422,
    );
    assert.equal((await a.version("demo")).version, opened.version);
  });

  it("does not share state between the caller's copy and its own", async () => {
    const a = api();
    const opened = await a.openProject({ kind: "csv", path: "" });
    opened.project.name = "Changed outside";
    assert.equal((await a.getProject("demo")).project.name, "Mobile relaunch");
  });

  it("starts again from the sample on reset", async () => {
    const a = api();
    const opened = await a.openProject({ kind: "csv", path: "" });
    await a.sendCommands("demo", opened.version, [{ type: "updateNode", id: "qa", changes: { title: "Edited" } }]);
    const fresh = a.reset();
    assert.equal(fresh.project.nodes.find((n) => n.id === "qa")!.title, "QA sign-off");
    // a session still holding the old version is told it is stale
    await assert.rejects(a.sendCommands("demo", opened.version, []), (e: ApiError) => e.status === 409);
  });

  it("refuses resource commands unless resourcing is on, like the real server", async () => {
    const a = api(false);
    const opened = await a.openProject({ kind: "csv", path: "" });
    await assert.rejects(a.sendCommands("demo", opened.version, [{ type: "addResourceType", name: "X" }]), (e: ApiError) => e.status === 403);
  });

  it("says plainly what the demo can't do", async () => {
    const a = api();
    await assert.rejects(a.createProject({ storage: { kind: "csv", path: "x" }, name: "n", root: { title: "t" } }), /online demo/);
    await assert.rejects(a.exportProject("demo", { kind: "csv", path: "x" }), /online demo/);
    await assert.rejects(a.importProject({ kind: "csv", path: "a" }, { kind: "csv", path: "b" }), /online demo/);
  });
});
