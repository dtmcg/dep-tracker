import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createLibrary } from "./library.ts";

async function file() {
  return path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-lib-")), "data", "projects.json");
}

const csv = (p: string) => ({ kind: "csv", path: p }) as const;

describe("library of known projects", () => {
  it("starts empty when there is no file yet", async () => {
    assert.deepEqual(await createLibrary(await file()).list(), []);
  });

  it("remembers a project across restarts, creating the folder for its file", async () => {
    const f = await file();
    await createLibrary(f).record(csv("/plans/a"), "Alpha");
    const again = await createLibrary(f).list();
    assert.equal(again.length, 1);
    assert.deepEqual({ name: again[0]!.name, storage: again[0]!.storage }, { name: "Alpha", storage: csv("/plans/a") });
    assert.ok(Date.parse(again[0]!.lastOpened) > 0);
  });

  it("lists the most recently used first", async () => {
    let t = 1_000;
    const dated = createLibrary(await file(), () => new Date((t += 1000)));
    await dated.record(csv("/plans/a"), "Alpha");
    await dated.record(csv("/plans/b"), "Beta");
    await dated.record(csv("/plans/a"), "Alpha");
    assert.deepEqual((await dated.list()).map((p) => p.name), ["Alpha", "Beta"]);
  });

  it("keeps one entry per store however the path was typed, and picks up a rename", async () => {
    const lib = createLibrary(await file());
    await lib.record(csv("/plans/a"), "Alpha");
    await lib.record(csv("/plans/a/"), "Alpha renamed");
    const list = await lib.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.name, "Alpha renamed");
  });

  it("is human readable JSON", async () => {
    const f = await file();
    await createLibrary(f).record(csv("/plans/a"), "Alpha");
    const parsed = JSON.parse(await readFile(f, "utf8"));
    assert.equal(parsed.projects[0].name, "Alpha");
  });

  it("carries on with an empty list if the file is damaged, and repairs it on the next record", async () => {
    const f = await file();
    const lib = createLibrary(f);
    await lib.record(csv("/plans/a"), "Alpha");
    await writeFile(f, "{ not json");
    assert.deepEqual(await lib.list(), []);
    await lib.record(csv("/plans/b"), "Beta");
    assert.deepEqual((await lib.list()).map((p) => p.name), ["Beta"]);
  });

  it("never throws when the file can't be written", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dep-tracker-lib-"));
    const blocker = path.join(dir, "blocker");
    await writeFile(blocker, "a file where a folder should be");
    await assert.doesNotReject(createLibrary(path.join(blocker, "projects.json")).record(csv("/a"), "A"));
  });

  it("forgets a project on request without touching the others", async () => {
    const lib = createLibrary(await file());
    await lib.record(csv("/plans/a"), "Alpha");
    await lib.record(csv("/plans/b"), "Beta");
    await lib.forget(csv("/plans/a"));
    assert.deepEqual((await lib.list()).map((p) => p.name), ["Beta"]);
  });
});
