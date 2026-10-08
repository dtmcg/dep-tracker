import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { csvAdapter } from "@dep-tracker/adapter-csv";
import type { Project, ProjectNode, StorageAdapter, StorageDescriptor } from "@dep-tracker/domain";
import { resolveReferences } from "./references.ts";

const node = (id: string, title: string, workTime: string, extra: Partial<ProjectNode> = {}): ProjectNode => ({
  id,
  title,
  workTime,
  labels: [],
  description: "",
  links: [],
  ...extra,
});

const csv = csvAdapter as unknown as StorageAdapter;

async function folder(): Promise<StorageDescriptor> {
  return { kind: "csv", path: path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-ref-")), "plan") };
}

const adapterFor = (d: StorageDescriptor) => (d.kind === "csv" ? csv : undefined);

async function store(descriptor: StorageDescriptor, name: string, nodes: ProjectNode[], edges: Project["edges"] = []) {
  const project: Project = { id: `p-${name}`, name, start: "2026-11-02T09:00:00.000Z", rootId: "root", nodes, edges };
  await csv.create(descriptor, project);
  return project;
}

const ref = (id: string, title: string, storage: StorageDescriptor) => node(id, title, "0m", { ref: { storage } });

describe("resolveReferences", () => {
  it("gives a reference the completion of the other project's success criteria", async () => {
    const partner = await folder();
    await store(partner, "Partner", [node("root", "Partner ready", "3d")]);
    const mine = await folder();
    const project = await store(mine, "Mine", [node("root", "Release", "1d"), ref("ext", "Partner API", partner)], [
      { dependentId: "root", dependencyId: "ext" },
    ]);
    const { externals } = await resolveReferences(project, mine, adapterFor);
    assert.deepEqual(externals.ext, { completion: "2026-11-05T09:00:00.000Z" });
  });

  it("follows chains of references", async () => {
    const c = await folder();
    await store(c, "C", [node("root", "C done", "2d")]);
    const b = await folder();
    await store(b, "B", [node("root", "B done", "1d"), ref("x", "C", c)], [{ dependentId: "root", dependencyId: "x" }]);
    const mine = await folder();
    const project = await store(mine, "A", [node("root", "A done", "0m"), ref("ext", "B", b)], [{ dependentId: "root", dependencyId: "ext" }]);
    const { externals } = await resolveReferences(project, mine, adapterFor);
    assert.deepEqual(externals.ext, { completion: "2026-11-05T09:00:00.000Z" });
  });

  it("reports why a project couldn't be read", async () => {
    const missing = await folder();
    const mine = await folder();
    const project = await store(mine, "Mine", [node("root", "Release", "1d"), ref("ext", "Gone", missing)], [
      { dependentId: "root", dependencyId: "ext" },
    ]);
    const { externals } = await resolveReferences(project, mine, adapterFor);
    assert.match((externals.ext as { error: string }).error, /No project\.csv found/);
  });

  it("reports a reference to a storage kind the app can't open", async () => {
    const mine = await folder();
    const project = await store(mine, "Mine", [node("root", "Release", "1d"), ref("ext", "Odd", { kind: "excel", path: "/v" } as never)]);
    const { externals } = await resolveReferences(project, mine, adapterFor);
    assert.match((externals.ext as { error: string }).error, /excel/);
  });

  it("spots a loop of projects and names it", async () => {
    const a = await folder();
    const b = await folder();
    await store(a, "Alpha", [node("root", "Alpha done", "1d"), ref("x", "Beta", b)], [{ dependentId: "root", dependencyId: "x" }]);
    await store(b, "Beta", [node("root", "Beta done", "1d"), ref("y", "Alpha", a)], [{ dependentId: "root", dependencyId: "y" }]);
    const alpha = (await csv.load(a)).project;
    const { externals } = await resolveReferences(alpha, a, adapterFor);
    assert.deepEqual(externals.x, { error: "cycle", cycle: ["Alpha", "Beta", "Alpha"] });
  });

  it("treats a project referencing itself as a loop", async () => {
    const a = await folder();
    const project = await store(a, "Solo", [node("root", "Done", "1d"), ref("x", "Me", a)], [{ dependentId: "root", dependencyId: "x" }]);
    const { externals } = await resolveReferences(project, a, adapterFor);
    assert.deepEqual(externals.x, { error: "cycle", cycle: ["Solo", "Solo"] });
  });

  it("changes referencesVersion when a referenced project changes, and only then", async () => {
    const partner = await folder();
    await store(partner, "Partner", [node("root", "Partner ready", "3d")]);
    const mine = await folder();
    const project = await store(mine, "Mine", [node("root", "Release", "1d"), ref("ext", "Partner API", partner)], [
      { dependentId: "root", dependencyId: "ext" },
    ]);
    const first = (await resolveReferences(project, mine, adapterFor)).referencesVersion;
    assert.equal((await resolveReferences(project, mine, adapterFor)).referencesVersion, first);
    const loaded = await csv.load(partner);
    await csv.save(partner, { ...loaded.project, nodes: [node("root", "Partner ready", "4d")] }, loaded.version);
    assert.notEqual((await resolveReferences(project, mine, adapterFor)).referencesVersion, first);
  });

  it("has an empty, stable referencesVersion when there are no references", async () => {
    const mine = await folder();
    const project = await store(mine, "Mine", [node("root", "Release", "1d")]);
    const result = await resolveReferences(project, mine, adapterFor);
    assert.deepEqual(result.externals, {});
    assert.equal(result.referencesVersion, "");
  });
});
