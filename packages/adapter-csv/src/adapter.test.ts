import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CsvAdapterError, csvAdapter } from "./adapter.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.resolve(here, "../../../fixtures/sample-project");

async function copyOfSample(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "dep-tracker-csv-"));
  await cp(sample, dir, { recursive: true });
  return dir;
}

describe("csvAdapter.load", () => {
  it("loads the project, nodes and edges from a folder", async () => {
    const { project } = await csvAdapter.load({ kind: "csv", path: sample });
    assert.equal(project.id, "p01");
    assert.equal(project.name, "Mobile relaunch");
    assert.equal(project.start, "2026-11-02T09:00:00.000Z");
    assert.equal(project.rootId, "n01");
    assert.deepEqual(project.nodes, [
      {
        id: "n01",
        title: "Public beta live",
        workTime: "2d",
        labels: ["risk", "team:web"],
        description: "Beta open to all sign-ups, with feedback widget",
        links: ["https://example.com/beta"],
      },
    ]);
    assert.deepEqual(project.edges, []);
  });

  it("reads edges and not-before dates", async () => {
    const dir = await copyOfSample();
    await writeFile(
      path.join(dir, "nodes.csv"),
      "id,title,work_time,not_before,labels,description,links\n" +
        "n01,Root,2d,,,,\n" +
        "n02,Payments,1w,2026-11-03T00:00:00Z,,,\n",
    );
    await writeFile(path.join(dir, "edges.csv"), "dependent_id,dependency_id\nn01,n02\n");
    const { project } = await csvAdapter.load({ kind: "csv", path: dir });
    assert.equal(project.nodes[1]?.notBefore, "2026-11-03T00:00:00.000Z");
    assert.deepEqual(project.edges, [{ dependentId: "n01", dependencyId: "n02" }]);
  });

  it("returns a version that changes when any file changes", async () => {
    const dir = await copyOfSample();
    const before = await csvAdapter.load({ kind: "csv", path: dir });
    const nodes = path.join(dir, "nodes.csv");
    await writeFile(nodes, (await readFile(nodes, "utf8")).replace("Public beta live", "Public beta open"));
    const after = await csvAdapter.load({ kind: "csv", path: dir });
    assert.notEqual(before.version, after.version);
    assert.equal((await csvAdapter.load({ kind: "csv", path: dir })).version, after.version);
  });

  it("explains a folder with no project.csv", async () => {
    await assert.rejects(
      csvAdapter.load({ kind: "csv", path: path.join(here, "nope") }),
      (e: unknown) => e instanceof CsvAdapterError && /project\.csv/.test(e.message),
    );
  });

  it("treats a missing edges.csv as no dependencies", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dep-tracker-csv-"));
    await cp(path.join(sample, "project.csv"), path.join(dir, "project.csv"));
    await cp(path.join(sample, "nodes.csv"), path.join(dir, "nodes.csv"));
    const { project } = await csvAdapter.load({ kind: "csv", path: dir });
    assert.deepEqual(project.edges, []);
  });

  it("rejects a root id that is not in nodes.csv", async () => {
    const dir = await copyOfSample();
    await writeFile(path.join(dir, "project.csv"), "id,name,start,root_id\np01,X,2026-11-02T09:00:00Z,n99\n");
    await assert.rejects(csvAdapter.load({ kind: "csv", path: dir }), /root_id "n99"/);
  });

  it("rejects an invalid start date, naming the file", async () => {
    const dir = await copyOfSample();
    await writeFile(path.join(dir, "project.csv"), "id,name,start,root_id\np01,X,next week,n01\n");
    await assert.rejects(csvAdapter.load({ kind: "csv", path: dir }), /project\.csv.*"next week"/);
  });

  it("rejects a duplicate node id with its line number", async () => {
    const dir = await copyOfSample();
    await writeFile(path.join(dir, "nodes.csv"), "id,title,work_time\nn01,A,1d\nn01,B,1d\n");
    await assert.rejects(csvAdapter.load({ kind: "csv", path: dir }), /nodes\.csv line 3.*"n01"/);
  });
});

describe("csvAdapter.save", () => {
  it("keeps columns it does not own, matched to their node by id", async () => {
    const dir = await copyOfSample();
    await writeFile(
      path.join(dir, "nodes.csv"),
      "id,title,work_time,owner,not_before,labels,description,links\n" + "n01,Public beta live,2d,Aoife,,,,\n",
    );
    const { project, version } = await csvAdapter.load({ kind: "csv", path: dir });
    const renamed = { ...project, nodes: project.nodes.map((n) => ({ ...n, title: "Beta live" })) };
    await csvAdapter.save({ kind: "csv", path: dir }, renamed, version);
    const text = await readFile(path.join(dir, "nodes.csv"), "utf8");
    assert.match(text.split("\n")[0] ?? "", /owner/);
    assert.match(text, /n01,Beta live,2d,.*Aoife/);
  });

  it("keeps the previous files as .bak and leaves no temporary files behind", async () => {
    const dir = await copyOfSample();
    const before = await readFile(path.join(dir, "nodes.csv"), "utf8");
    const { project, version } = await csvAdapter.load({ kind: "csv", path: dir });
    await csvAdapter.save({ kind: "csv", path: dir }, { ...project, name: "Renamed" }, version);
    assert.equal(await readFile(path.join(dir, "nodes.csv.bak"), "utf8"), before);
    const files = await readdir(dir);
    assert.deepEqual(files.filter((f) => f.includes(".tmp")), []);
  });
});

describe("csvAdapter resource pool", () => {
  const withPool = (project: Awaited<ReturnType<typeof csvAdapter.load>>["project"]) => ({
    ...project,
    resourceTypes: [
      { name: "Developer", resources: [{ id: "r1", name: "Ann", available: "40h" }, { id: "r2", name: "", available: "" }] },
      { name: "Test rig", resources: [] },
    ],
  });

  it("writes no resource files, and loads no pool, for a project without one", async () => {
    const dir = await copyOfSample();
    const { project, version } = await csvAdapter.load({ kind: "csv", path: dir });
    assert.equal(project.resourceTypes, undefined);
    await csvAdapter.save({ kind: "csv", path: dir }, { ...project, name: "Renamed" }, version);
    const files = await readdir(dir);
    assert.deepEqual(files.filter((f) => f.startsWith("resource")), []);
  });

  it("saves the pool in two plain CSV files and loads it back, empty types and unnamed instances included", async () => {
    const dir = await copyOfSample();
    const { project, version } = await csvAdapter.load({ kind: "csv", path: dir });
    await csvAdapter.save({ kind: "csv", path: dir }, withPool(project), version);
    assert.equal(await readFile(path.join(dir, "resource_types.csv"), "utf8"), "type\nDeveloper\nTest rig\n");
    assert.match(await readFile(path.join(dir, "resources.csv"), "utf8"), /^type,id,name,available\nDeveloper,r1,Ann,40h\nDeveloper,r2,,\n/);
    assert.deepEqual((await csvAdapter.load({ kind: "csv", path: dir })).project.resourceTypes, withPool(project).resourceTypes);
  });

  it("changes the version when only the pool changes", async () => {
    const dir = await copyOfSample();
    const d = { kind: "csv", path: dir } as const;
    const { project, version } = await csvAdapter.load(d);
    const saved = await csvAdapter.save(d, withPool(project), version);
    assert.notEqual(saved, version);
    assert.equal(await csvAdapter.version(d), saved);
  });

  it("reads a pool written by hand: a type only named in resources.csv, a blank id, a blank name", async () => {
    const dir = await copyOfSample();
    await writeFile(path.join(dir, "resources.csv"), "type,name,available\nDeveloper,Ann,2d\nDeveloper,,\n");
    const { project } = await csvAdapter.load({ kind: "csv", path: dir });
    assert.deepEqual(project.resourceTypes, [
      { name: "Developer", resources: [{ id: "r2", name: "Ann", available: "2d" }, { id: "r3", name: "", available: "" }] },
    ]);
  });

  it("rejects an available time that isn't a duration, naming the file and line", async () => {
    const dir = await copyOfSample();
    await writeFile(path.join(dir, "resources.csv"), "type,id,name,available\nDeveloper,r1,Ann,plenty\n");
    await assert.rejects(csvAdapter.load({ kind: "csv", path: dir }), /resources\.csv line 2.*available/);
  });

  it("keeps an emptied pool's files so the pool stays empty, not absent", async () => {
    const dir = await copyOfSample();
    const d = { kind: "csv", path: dir } as const;
    const first = await csvAdapter.load(d);
    const v = await csvAdapter.save(d, withPool(first.project), first.version);
    await csvAdapter.save(d, { ...first.project, resourceTypes: [] }, v);
    assert.deepEqual((await csvAdapter.load(d)).project.resourceTypes, []);
  });
});

describe("csvAdapter resource requirements", () => {
  const d = (dir: string) => ({ kind: "csv", path: dir }) as const;

  it("adds no resources column unless a node needs resources", async () => {
    const dir = await copyOfSample();
    const { project, version } = await csvAdapter.load(d(dir));
    await csvAdapter.save(d(dir), { ...project, name: "Renamed" }, version);
    assert.doesNotMatch((await readFile(path.join(dir, "nodes.csv"), "utf8")).split("\n")[0]!, /resources/);
  });

  it("writes requirements in a readable column, 'Developer x 2; Tester', and reads them back", async () => {
    const dir = await copyOfSample();
    const { project, version } = await csvAdapter.load(d(dir));
    const first = project.nodes[0]!;
    const withNeeds = {
      ...project,
      resourceTypes: [{ name: "Developer", resources: [] }, { name: "Tester", resources: [] }],
      nodes: project.nodes.map((n) => (n === first ? { ...n, resources: [{ typeName: "Developer", count: 2 }, { typeName: "Tester", count: 1 }] } : n)),
    };
    await csvAdapter.save(d(dir), withNeeds, version);
    const text = await readFile(path.join(dir, "nodes.csv"), "utf8");
    assert.match(text.split("\n")[0]!, /resources/);
    assert.match(text, /Developer x 2; Tester/);
    const reloaded = (await csvAdapter.load(d(dir))).project;
    assert.deepEqual(reloaded.nodes.find((n) => n.id === first.id)!.resources, [{ typeName: "Developer", count: 2 }, { typeName: "Tester", count: 1 }]);
    assert.equal(reloaded.nodes.filter((n) => n.resources).length, 1);
  });

  it("reads hand-written requirements: a missing number means 1, × works too", async () => {
    const dir = await copyOfSample();
    await writeFile(path.join(dir, "nodes.csv"), 'id,title,work_time,resources\nn01,A,1d,"Developer×3; QA"\n');
    const { project } = await csvAdapter.load(d(dir));
    assert.deepEqual(project.nodes[0]!.resources, [{ typeName: "Developer", count: 3 }, { typeName: "QA", count: 1 }]);
  });

  it("rejects a requirement for zero", async () => {
    const dir = await copyOfSample();
    await writeFile(path.join(dir, "nodes.csv"), "id,title,work_time,resources\nn01,A,1d,Developer x 0\n");
    await assert.rejects(csvAdapter.load(d(dir)), /nodes\.csv line 2, resources.*at least 1/);
  });
});

describe("csvAdapter resource limits", () => {
  const d = (dir: string) => ({ kind: "csv", path: dir }) as const;
  const roundTrip = async (resources: { typeName: string; count: number; min?: number; max?: number }[]) => {
    const dir = await copyOfSample();
    const { project, version } = await csvAdapter.load(d(dir));
    const types = [...new Set(resources.map((r) => r.typeName))].map((name) => ({ name, resources: [] }));
    await csvAdapter.save(d(dir), { ...project, resourceTypes: types, nodes: project.nodes.map((n, i) => (i === 0 ? { ...n, resources } : n)) }, version);
    const text = await readFile(path.join(dir, "nodes.csv"), "utf8");
    return { text, back: (await csvAdapter.load(d(dir))).project.nodes[0]!.resources };
  };

  it("writes limits in brackets, readably, and reads them back", async () => {
    const { text, back } = await roundTrip([
      { typeName: "Developer", count: 2, min: 1, max: 3 },
      { typeName: "Tester", count: 1, max: 2 },
      { typeName: "Designer", count: 4 },
    ]);
    assert.match(text, /"Developer x 2 \(min 1, max 3\); Tester \(max 2\); Designer x 4"/);
    assert.deepEqual(back, [
      { typeName: "Developer", count: 2, min: 1, max: 3 },
      { typeName: "Tester", count: 1, max: 2 },
      { typeName: "Designer", count: 4 },
    ]);
  });

  it("reads hand-written limits; with no number, the count starts at the minimum", async () => {
    const dir = await copyOfSample();
    await writeFile(path.join(dir, "nodes.csv"), 'id,title,work_time,resources\nn01,A,1d,"Developer (min 2, max 4); QA (MAX 1)"\n');
    const { project } = await csvAdapter.load(d(dir));
    assert.deepEqual(project.nodes[0]!.resources, [{ typeName: "Developer", count: 2, min: 2, max: 4 }, { typeName: "QA", count: 1, max: 1 }]);
  });

  it("rejects a limit it can't read, or of zero", async () => {
    const dir = await copyOfSample();
    await writeFile(path.join(dir, "nodes.csv"), "id,title,work_time,resources\nn01,A,1d,Developer (lots)\n");
    await assert.rejects(csvAdapter.load(d(dir)), /nodes\.csv line 2, resources.*"min N" or "max N"/);
    await writeFile(path.join(dir, "nodes.csv"), "id,title,work_time,resources\nn01,A,1d,Developer (min 0)\n");
    await assert.rejects(csvAdapter.load(d(dir)), /at least 1/);
  });
});
