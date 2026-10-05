import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Project } from "@dep-tracker/domain";
import { ObsidianAdapterError, obsidianAdapter } from "./adapter.ts";
import { parseNote } from "./frontmatter.ts";

const plan = (): Project => ({
  id: "p1",
  name: "Mobile relaunch",
  start: "2026-11-02T09:00:00.000Z",
  rootId: "r",
  nodes: [
    { id: "r", title: "Public beta live", workTime: "2d", labels: ["risk"], description: "Beta open to everyone.\n", links: ["https://example.com/beta"] },
    { id: "p", title: "Payments integration", workTime: "1w", notBefore: "2026-11-03T09:00:00.000Z", labels: ["team:platform"], description: "", links: [] },
    { id: "c", title: "API contract agreed", workTime: "4h", labels: [], description: "", links: [] },
  ],
  edges: [
    { dependentId: "r", dependencyId: "p" },
    { dependentId: "p", dependencyId: "c" },
  ],
  labelColours: { risk: "#c62828" },
});

async function vault(project = plan()) {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-vault-")), "Mobile relaunch");
  const d = { kind: "obsidian" as const, path: folder };
  await obsidianAdapter.create(d, project);
  return { d, folder, note: (name: string) => readFile(path.join(folder, `${name}.md`), "utf8") };
}

describe("obsidianAdapter: the notes it writes", () => {
  it("writes one note per task, named by title, with wikilinks and tags", async () => {
    const { folder, note } = await vault();
    const files = (await readdir(folder)).filter((f) => f.endsWith(".md")).sort();
    assert.deepEqual(files, ["API contract agreed.md", "Mobile relaunch (project).md", "Payments integration.md", "Public beta live.md"]);
    const payments = parseNote(await note("Payments integration"));
    assert.equal(payments.data.id, "p");
    assert.equal(payments.data.work_time, "1w");
    assert.deepEqual(payments.data.depends_on, ["[[API contract agreed]]"]);
    assert.deepEqual(payments.data.tags, ["team/platform"]);
    assert.equal(typeof payments.data.not_before, "string");
    const root = parseNote(await note("Public beta live"));
    assert.equal(root.body, "Beta open to everyone.\n");
    assert.deepEqual(root.data.links, ["https://example.com/beta"]);
  });

  it("keeps project settings in a project note", async () => {
    const { note } = await vault();
    const project = parseNote(await note("Mobile relaunch (project)"));
    assert.equal(project.data.dep_tracker, "project");
    assert.equal(project.data.success_criteria, "[[Public beta live]]");
    assert.deepEqual(project.data.label_colours, { risk: "#c62828" });
  });
});

describe("obsidianAdapter: working with a vault edited in Obsidian", () => {
  it("follows a note renamed in Obsidian (file renamed, links updated) and keeps its id", async () => {
    const { d, folder } = await vault();
    await rename(path.join(folder, "API contract agreed.md"), path.join(folder, "Contract signed.md"));
    const payments = path.join(folder, "Payments integration.md");
    await writeFile(payments, (await readFile(payments, "utf8")).replace("[[API contract agreed]]", "[[Contract signed]]"));
    const { project } = await obsidianAdapter.load(d);
    const renamed = project.nodes.find((n) => n.id === "c")!;
    assert.equal(renamed.title, "Contract signed");
    assert.ok(project.edges.some((e) => e.dependentId === "p" && e.dependencyId === "c"));
  });

  it("keeps note bodies and frontmatter keys it doesn't own when saving", async () => {
    const { d, folder } = await vault();
    const file = path.join(folder, "Payments integration.md");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace("---\n", "---\nstatus: draft\n").replace(/---\n$/, "---\nNotes from the vendor call.\n"));
    const { project, version } = await obsidianAdapter.load(d);
    const changed = { ...project, nodes: project.nodes.map((n) => (n.id === "p" ? { ...n, workTime: "2w" } : n)) };
    await obsidianAdapter.save(d, changed, version);
    const after = await readFile(file, "utf8");
    assert.match(after, /^status: draft$/m);
    assert.match(after, /^work_time: 2w$/m);
    assert.match(after, /Notes from the vendor call\./);
  });

  it("treats a hand-made note with a work_time as a task, gives it an id on save, and ignores other notes", async () => {
    const { d, folder } = await vault();
    await writeFile(path.join(folder, "Load testing.md"), "---\nwork_time: 3d\ndepends_on:\n  - \"[[API contract agreed]]\"\n---\nRun k6.\n");
    await writeFile(path.join(folder, "Meeting notes.md"), "Just some notes, not a task.\n");
    const { project, version } = await obsidianAdapter.load(d);
    assert.deepEqual(project.nodes.map((n) => n.title).sort(), ["API contract agreed", "Load testing", "Payments integration", "Public beta live"]);
    const load = project.nodes.find((n) => n.title === "Load testing")!;
    assert.equal(load.description, "Run k6.\n");
    await obsidianAdapter.save(d, project, version);
    assert.equal(parseNote(await readFile(path.join(folder, "Load testing.md"), "utf8")).data.id, load.id);
    assert.equal(await readFile(path.join(folder, "Meeting notes.md"), "utf8"), "Just some notes, not a task.\n");
  });

  it("resolves links with an alias or a heading", async () => {
    const { d, folder } = await vault();
    const payments = path.join(folder, "Payments integration.md");
    await writeFile(payments, (await readFile(payments, "utf8")).replace("[[API contract agreed]]", "[[API contract agreed#Scope|the contract]]"));
    const { project } = await obsidianAdapter.load(d);
    assert.ok(project.edges.some((e) => e.dependentId === "p" && e.dependencyId === "c"));
  });

  it("names the note and the link it cannot resolve", async () => {
    const { d, folder } = await vault();
    const payments = path.join(folder, "Payments integration.md");
    await writeFile(payments, (await readFile(payments, "utf8")).replace("[[API contract agreed]]", "[[Nowhere]]"));
    await assert.rejects(obsidianAdapter.load(d), (e: unknown) => e instanceof ObsidianAdapterError && /Payments integration\.md.*\[\[Nowhere\]\]/.test(e.message));
  });
});

describe("obsidianAdapter: changes made in the app", () => {
  it("renames the note and updates links when a task is renamed", async () => {
    const { d, folder } = await vault();
    const { project, version } = await obsidianAdapter.load(d);
    const renamed = { ...project, nodes: project.nodes.map((n) => (n.id === "c" ? { ...n, title: "Contract signed" } : n)) };
    await obsidianAdapter.save(d, renamed, version);
    const files = await readdir(folder);
    assert.ok(files.includes("Contract signed.md"));
    assert.ok(!files.includes("API contract agreed.md"));
    assert.match(await readFile(path.join(folder, "Payments integration.md"), "utf8"), /\[\[Contract signed\]\]/);
  });

  it("moves a deleted task's note to .trash instead of deleting it", async () => {
    const { d, folder } = await vault();
    const { project, version } = await obsidianAdapter.load(d);
    const fewer = { ...project, nodes: project.nodes.filter((n) => n.id !== "c"), edges: project.edges.filter((e) => e.dependencyId !== "c") };
    await obsidianAdapter.save(d, fewer, version);
    assert.ok(!(await readdir(folder)).includes("API contract agreed.md"));
    assert.ok((await readdir(path.join(folder, ".trash"))).some((f) => f.startsWith("API contract agreed")));
  });

  it("keeps titles that are not valid file names in the note's frontmatter", async () => {
    const p = plan();
    p.nodes[2]!.title = "API: v2/contract?";
    const { d, folder } = await vault(p);
    const files = await readdir(folder);
    const name = files.find((f) => f.startsWith("API"))!;
    assert.doesNotMatch(name, /[:/?]/);
    assert.equal(parseNote(await readFile(path.join(folder, name), "utf8")).data.title, "API: v2/contract?");
    const { project } = await obsidianAdapter.load(d);
    assert.equal(project.nodes.find((n) => n.id === "c")!.title, "API: v2/contract?");
  });
});
