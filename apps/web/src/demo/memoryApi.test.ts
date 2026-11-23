import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCommands } from "@dep-tracker/domain";
import { ApiError } from "../api.ts";
import { EXAMPLES } from "./examples.ts";
import { createMemoryBackend } from "./memoryApi.ts";

const backend = (resourcing = true) => createMemoryBackend(EXAMPLES, { resourcing });
const open = (b: ReturnType<typeof backend>, path: string) => b.openProject({ kind: "csv", path });

describe("every example", () => {
  for (const example of EXAMPLES) {
    it(`${example.name}: is valid, schedules without cycles, and has no unreachable items`, async () => {
      const b = backend();
      const opened = b.loadExample(example.id);
      const { project, schedule } = opened;
      assert.deepEqual(schedule.cycles, []);
      assert.deepEqual(schedule.projectCycles, []);
      assert.ok(schedule.nodes[project.rootId]?.completion, "the root has a completion date");
      const orphans = Object.entries(schedule.flags).filter(([, f]) => f.includes("orphan"));
      assert.deepEqual(orphans, []);
      // every requirement refers to a pool type and sits within its limits: re-applying them proves it
      for (const n of project.nodes) {
        assert.doesNotThrow(() => applyCommands(project, [{ type: "updateNode", id: n.id, changes: { resources: n.resources ?? [] } }]), n.id);
      }
    });
  }

  it("has a unique id and a one-line blurb for each", () => {
    assert.equal(new Set(EXAMPLES.map((e) => e.id)).size, EXAMPLES.length);
    for (const e of EXAMPLES) assert.ok(e.blurb.length > 10, e.id);
  });

  it("offers at least five examples, with the two pharma lines among the rich ones", () => {
    assert.ok(EXAMPLES.length >= 5);
    for (const id of ["tablet-line", "fill-finish"]) assert.equal(EXAMPLES.find((e) => e.id === id)?.rich, true, id);
  });
});

describe("the rich examples show every feature", () => {
  for (const id of ["tablet-line", "fill-finish"]) {
    it(`${id}: resource pool, min/max limits, a not-before or long chain, an unestimated item, a resolved reference`, async () => {
      const opened = backend().loadExample(id);
      const { project, schedule, externals } = opened;
      assert.ok((project.resourceTypes ?? []).length >= 4);
      assert.ok(project.nodes.some((n) => n.resources?.some((r) => r.min !== undefined && r.max !== undefined)), "limits");
      assert.ok(project.nodes.some((n) => n.workTime === ""), "an unestimated item");
      assert.ok(Object.values(schedule.flags).some((f) => f.includes("unestimated")));
      const ref = project.nodes.find((n) => n.ref);
      assert.ok(ref, "a reference node");
      assert.ok(externals && "completion" in externals[ref!.id]!, "the reference resolves to a completion date");
      assert.ok(project.nodes.some((n) => (n.labels ?? []).length), "labels");
      assert.ok(Object.keys(project.labelColours ?? {}).length >= 5, "label colours");
    });
  }

  it("tablet line: the reference's date feeds the chart, and its project opens", async () => {
    const b = backend();
    const opened = b.loadExample("tablet-line");
    const ref = opened.project.nodes.find((n) => n.ref)!;
    const other = await b.openProject(ref.ref!.storage);
    assert.equal(other.project.name, "Cleanroom HVAC upgrade");
    assert.equal(opened.externals![ref.id] && "completion" in opened.externals![ref.id]! && opened.externals![ref.id]!.completion, other.schedule.nodes[other.project.rootId]!.completion);
  });

  it("a change to the referenced project changes the referencing project's dates and references version", async () => {
    const b = backend();
    const main = b.loadExample("tablet-line");
    const hvac = await open(b, "cleanroom-hvac");
    await b.sendCommands(hvac.project.id, hvac.version, [{ type: "updateNode", id: "ahu-order", changes: { workTime: "120d" } }]);
    const after = await b.getProject(main.project.id);
    assert.notEqual(after.referencesVersion, main.referencesVersion);
    assert.ok(after.schedule.nodes[after.project.rootId]!.completion > main.schedule.nodes[main.project.rootId]!.completion);
    assert.notEqual((await b.version(main.project.id)).referencesVersion, main.referencesVersion);
  });
});

describe("Start new", () => {
  it("gives a project with exactly one node, the success criteria, and nothing else", () => {
    const opened = backend().startNew("  My plan ", "Shipped");
    assert.equal(opened.project.name, "My plan");
    assert.equal(opened.project.nodes.length, 1);
    assert.equal(opened.project.nodes[0]!.title, "Shipped");
    assert.equal(opened.project.nodes[0]!.id, opened.project.rootId);
    assert.deepEqual(opened.project.edges, []);
  });

  it("can then be built up with commands, and reset returns the blank project", async () => {
    const b = backend();
    const blank = b.startNew("Plan", "Done");
    const next = await b.sendCommands(blank.project.id, blank.version, [
      { type: "addNode", node: { id: "x", title: "Step", workTime: "2d", labels: [], description: "", links: [] } },
      { type: "addEdge", dependentId: blank.project.rootId, dependencyId: "x" },
    ]);
    assert.equal(next.project.nodes.length, 2);
    assert.equal(b.reset().project.nodes.length, 1);
  });

  it("needs a name", () => {
    assert.throws(() => backend().startNew("   ", "x"), (e: ApiError) => e.status === 422);
  });
});

describe("the in-memory API", () => {
  it("applies commands with the shared engine and reschedules", async () => {
    const b = backend();
    const before = b.loadExample("mobile");
    const after = await b.sendCommands(before.project.id, before.version, [{ type: "updateNode", id: "qa", changes: { workTime: "10d" } }]);
    assert.notEqual(after.version, before.version);
    assert.ok(after.schedule.nodes.launch!.completion > before.schedule.nodes.launch!.completion);
  });

  it("refuses a stale version with 409 and a bad command with 422, changing nothing", async () => {
    const b = backend();
    const o = b.loadExample("mobile");
    await assert.rejects(b.sendCommands(o.project.id, "0", []), (e: ApiError) => e.status === 409);
    await assert.rejects(b.sendCommands(o.project.id, o.version, [{ type: "updateNode", id: "qa", changes: { workTime: "soon" } }]), (e: ApiError) => e.status === 422);
    assert.equal((await b.version(o.project.id)).version, o.version);
  });

  it("does not share state between a caller's copy and its own", async () => {
    const b = backend();
    const o = b.loadExample("mobile");
    o.project.name = "Changed outside";
    assert.equal((await b.getProject(o.project.id)).project.name, "Mobile relaunch");
  });

  it("switching example drops edits and the old session sees its project is gone", async () => {
    const b = backend();
    const o = b.loadExample("mobile");
    b.loadExample("conference");
    await assert.rejects(b.getProject(o.project.id), (e: ApiError) => e.status === 404);
  });

  it("reset puts the picked example back as it was", async () => {
    const b = backend();
    const o = b.loadExample("conference");
    await b.sendCommands(o.project.id, o.version, [{ type: "updateNode", id: "venue", changes: { title: "Edited" } }]);
    const fresh = b.reset();
    assert.equal(fresh.project.nodes.find((n) => n.id === "venue")!.title, "Venue booked and confirmed");
  });

  it("refuses resource commands unless resourcing is on, like the real server", async () => {
    const b = backend(false);
    const o = b.loadExample("mobile");
    await assert.rejects(b.sendCommands(o.project.id, o.version, [{ type: "addResourceType", name: "X" }]), (e: ApiError) => e.status === 403);
  });

  it("says plainly what the demo can't do, and 404s a project that isn't there", async () => {
    const b = backend();
    await assert.rejects(b.exportProject("x", { kind: "csv", path: "x" }), /online demo/);
    await assert.rejects(b.importProject({ kind: "csv", path: "a" }, { kind: "csv", path: "b" }), /online demo/);
    await assert.rejects(open(b, "nowhere"), (e: ApiError) => e.status === 404);
  });
});
