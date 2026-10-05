import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
