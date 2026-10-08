import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { csvAdapter } from "@dep-tracker/adapter-csv";
import { createApp } from "./app.ts";
import { createLibrary } from "./library.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.resolve(here, "../../../fixtures/sample-project");
const TOKEN = "test-token";

let base = "";
let close: () => Promise<void>;
let staticDir = "";
let library: ReturnType<typeof createLibrary>;

before(async () => {
  library = createLibrary(path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-library-")), "projects.json"));
  staticDir = await mkdtemp(path.join(tmpdir(), "dep-tracker-web-"));
  await writeFile(path.join(staticDir, "index.html"), "<!doctype html><head><title>dep-tracker</title></head><body></body>");
  await writeFile(path.join(staticDir, "app.js"), "console.log('hi')");
  const server = createApp({ adapters: { csv: csvAdapter }, staticDir, token: TOKEN, projectsDir: "/home/me/Documents/pdm_projects", library });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});

after(async () => {
  await close();
});

const headers = { "content-type": "application/json", "x-dep-tracker-token": TOKEN };
const post = (url: string, body: unknown) => fetch(base + url, { method: "POST", headers, body: JSON.stringify(body) });
const get = (url: string) => fetch(base + url, { headers });

async function newFolder(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-api-")), "plan");
}

async function createProject(folder: string) {
  const res = await post("/api/projects", {
    storage: { kind: "csv", path: folder },
    name: "Launch",
    start: "2026-11-02T09:00:00.000Z",
    root: { title: "Public beta live", workTime: "2d" },
  });
  return { res, body: await res.json() };
}

describe("known projects (GET /api/library)", () => {
  const known = async () => ((await (await get("/api/library")).json()) as { projects: { name: string; storage: { kind: string; path: string } }[] }).projects;

  it("remembers projects that are created, opened and imported", async () => {
    const created = await newFolder();
    await createProject(created);
    assert.ok((await known()).some((p) => p.storage.path === created && p.name === "Launch"));

    const opened = await post("/api/projects/open", { storage: { kind: "csv", path: sample } });
    assert.equal(opened.status, 200);
    assert.ok((await known()).some((p) => p.storage.path === sample && p.name === "Mobile relaunch"));

    const target = await newFolder();
    await post("/api/projects/import", { source: { kind: "csv", path: sample }, target: { kind: "csv", path: target } });
    assert.ok((await known()).some((p) => p.storage.path === target));
  });

  it("does not remember a project that failed to open", async () => {
    const missing = path.join(here, "never-there");
    await post("/api/projects/open", { storage: { kind: "csv", path: missing } });
    assert.ok(!(await known()).some((p) => p.storage.path === missing));
  });

  it("forgets a project on request, leaving its files alone", async () => {
    const folder = await newFolder();
    await createProject(folder);
    assert.equal((await post("/api/library/forget", { storage: { kind: "csv", path: folder } })).status, 200);
    assert.ok(!(await known()).some((p) => p.storage.path === folder));
    assert.equal((await post("/api/projects/open", { storage: { kind: "csv", path: folder } })).status, 200);
  });

  it("needs the token", async () => {
    assert.equal((await fetch(`${base}/api/library`)).status, 401);
  });
});

describe("GET /api/config", () => {
  it("tells the web app the default projects folder", async () => {
    const res = await get("/api/config");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { projectsDir: "/home/me/Documents/pdm_projects", resourcing: false });
  });

  it("needs the token like any other call", async () => {
    assert.equal((await fetch(`${base}/api/config`)).status, 401);
  });
});

describe("API token (NFR-5)", () => {
  it("rejects API calls without the per-launch token", async () => {
    const res = await fetch(`${base}/api/projects/open`, { method: "POST", body: "{}" });
    assert.equal(res.status, 401);
  });

  it("leaves the health check open for launchers", async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it("hands the token to the web app inside index.html", async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<meta name="dep-tracker-token" content="test-token">/);
  });
});

describe("POST /api/projects/open", () => {
  it("returns the project, its schedule and version", async () => {
    const res = await post("/api/projects/open", { storage: { kind: "csv", path: sample } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.project.name, "Mobile relaunch");
    assert.equal(body.schedule.nodes.n01.completion, "2026-11-04T09:00:00.000Z");
    assert.match(body.version, /^[0-9a-f]{16}$/);
  });

  it("returns 422 with the adapter's message when the folder is not a project", async () => {
    const res = await post("/api/projects/open", { storage: { kind: "csv", path: path.join(here, "missing") } });
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /project\.csv/);
  });

  it("returns 422 for an unsupported storage kind", async () => {
    const res = await post("/api/projects/open", { storage: { kind: "tape", path: "x" } });
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /tape/);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await fetch(`${base}/api/projects/open`, { method: "POST", headers, body: "{nope" });
    assert.equal(res.status, 400);
  });
});

describe("POST /api/projects (create)", () => {
  it("creates a project with its success-criteria node and opens it", async () => {
    const folder = await newFolder();
    const { res, body } = await createProject(folder);
    assert.equal(res.status, 201);
    assert.equal(body.project.name, "Launch");
    const root = body.project.nodes.find((n: { id: string }) => n.id === body.project.rootId);
    assert.equal(root.title, "Public beta live");
    assert.equal(body.schedule.nodes[root.id].completion, "2026-11-04T09:00:00.000Z");
    assert.match(await readFile(path.join(folder, "nodes.csv"), "utf8"), /Public beta live/);
  });

  it("refuses to overwrite an existing project with 409", async () => {
    const folder = await newFolder();
    await createProject(folder);
    const { res, body } = await createProject(folder);
    assert.equal(res.status, 409);
    assert.match(body.error, /already/);
  });

  it("validates the root node", async () => {
    const res = await post("/api/projects", {
      storage: { kind: "csv", path: await newFolder() },
      name: "X",
      start: "2026-11-02T09:00:00.000Z",
      root: { title: "", workTime: "2d" },
    });
    assert.equal(res.status, 422);
  });
});

describe("POST /api/projects without a start or work time", () => {
  it("starts the project now and leaves the root unestimated", async () => {
    const before = Date.now();
    const res = await post("/api/projects", { storage: { kind: "csv", path: await newFolder() }, name: "Quick", root: { title: "Done" } });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(Math.abs(Date.parse(body.project.start) - before) < 60_000);
    assert.equal(body.project.nodes[0].workTime, "");
    assert.ok(body.schedule.nodes[body.project.rootId]);
    assert.deepEqual(body.schedule.flags[body.project.rootId], ["unestimated"]);
  });

  it("still rejects a start that isn't a date", async () => {
    const res = await post("/api/projects", { storage: { kind: "csv", path: await newFolder() }, name: "X", start: "someday", root: { title: "Done" } });
    assert.equal(res.status, 422);
  });
});

describe("POST /api/projects/:id/commands", () => {
  it("applies commands, saves, and returns the new schedule and version", async () => {
    const { body: opened } = await createProject(await newFolder());
    const rootId = opened.project.rootId;
    const res = await post(`/api/projects/${opened.project.id}/commands`, {
      expectedVersion: opened.version,
      commands: [
        { type: "addNode", node: { id: "nAAA", title: "Payments", workTime: "3d", labels: [], description: "", links: [] } },
        { type: "addEdge", dependentId: rootId, dependencyId: "nAAA" },
      ],
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.notEqual(body.version, opened.version);
    assert.equal(body.schedule.nodes[rootId].completion, "2026-11-07T09:00:00.000Z");
  });

  it("returns 409 when the project changed since the client's version", async () => {
    const folder = await newFolder();
    const { body: opened } = await createProject(folder);
    const nodes = path.join(folder, "nodes.csv");
    await writeFile(nodes, (await readFile(nodes, "utf8")).replace("Public beta live", "Edited by hand"));
    const res = await post(`/api/projects/${opened.project.id}/commands`, {
      expectedVersion: opened.version,
      commands: [{ type: "addNode", node: { id: "nB", title: "B", workTime: "1d", labels: [], description: "", links: [] } }],
    });
    assert.equal(res.status, 409);
  });

  it("returns 422 for an invalid command and leaves the project unchanged", async () => {
    const folder = await newFolder();
    const { body: opened } = await createProject(folder);
    const res = await post(`/api/projects/${opened.project.id}/commands`, {
      expectedVersion: opened.version,
      commands: [{ type: "addEdge", dependentId: opened.project.rootId, dependencyId: "nope" }],
    });
    assert.equal(res.status, 422);
    const version = await (await get(`/api/projects/${opened.project.id}/version`)).json();
    assert.equal(version.version, opened.version);
  });

  it("returns 404 for a project that is not open", async () => {
    const res = await post("/api/projects/unknown/commands", { expectedVersion: "x", commands: [] });
    assert.equal(res.status, 404);
  });
});

describe("GET /api/projects/:id and /version", () => {
  it("reports a new version after an edit outside the app, and reloads it", async () => {
    const folder = await newFolder();
    const { body: opened } = await createProject(folder);
    const nodes = path.join(folder, "nodes.csv");
    await writeFile(nodes, (await readFile(nodes, "utf8")).replace("Public beta live", "Edited by hand"));
    const { version } = await (await get(`/api/projects/${opened.project.id}/version`)).json();
    assert.notEqual(version, opened.version);
    const reloaded = await (await get(`/api/projects/${opened.project.id}`)).json();
    assert.equal(reloaded.version, version);
    assert.ok(reloaded.project.nodes.some((n: { title: string }) => n.title === "Edited by hand"));
  });
});

describe("POST /api/projects/import (FR-25)", () => {
  it("copies a project from one store into another and opens the copy", async () => {
    const target = await newFolder();
    const res = await post("/api/projects/import", { source: { kind: "csv", path: sample }, target: { kind: "csv", path: target } });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.storage.path, target);
    assert.equal(body.project.name, "Mobile relaunch");
    const reread = await csvAdapter.load({ kind: "csv", path: target });
    assert.equal(reread.project.nodes[0]?.title, "Public beta live");
  });

  it("refuses to overwrite an existing target with 409", async () => {
    const res = await post("/api/projects/import", { source: { kind: "csv", path: sample }, target: { kind: "csv", path: sample } });
    assert.equal(res.status, 409);
  });
});

describe("POST /api/projects/:id/export (FR-27)", () => {
  it("writes a CSV copy of an open project", async () => {
    const { body: opened } = await createProject(await newFolder());
    const folder = await newFolder();
    const res = await post(`/api/projects/${opened.project.id}/export`, { storage: { kind: "csv", path: folder } });
    assert.equal(res.status, 201);
    assert.match(await readFile(path.join(folder, "nodes.csv"), "utf8"), /Public beta live,2d/);
  });
});

describe("reference nodes (S10)", () => {
  async function addReference(storage: { kind: string; path: string }, partnerFolder: string) {
    const { body } = await createProject(storage.path);
    const id = body.project.id as string;
    const rootId = body.project.rootId as string;
    const res = await post(`/api/projects/${id}/commands`, {
      expectedVersion: body.version,
      commands: [
        { type: "addNode", node: { id: "ext1", title: "Partner API", workTime: "0m", labels: [], description: "", links: [], ref: { storage: { kind: "csv", path: partnerFolder } } } },
        { type: "addEdge", dependentId: rootId, dependencyId: "ext1" },
      ],
    });
    return { id, rootId, res, body: await res.json() };
  }

  it("dates a reference from the other project and the root after it", async () => {
    const partner = await createProject(await newFolder());
    const mine = await newFolder();
    const { res, body, rootId } = await addReference({ kind: "csv", path: mine }, partner.body.storage.path);
    assert.equal(res.status, 200);
    assert.equal(body.externals.ext1.completion, partner.body.schedule.nodes[partner.body.project.rootId].completion);
    assert.equal(body.schedule.nodes[rootId].start, body.externals.ext1.completion);
    assert.match(body.referencesVersion, /^[0-9a-f]{16}$/);
  });

  it("reports an unreadable referenced project as unresolved instead of failing", async () => {
    const mine = await newFolder();
    const { res, body } = await addReference({ kind: "csv", path: mine }, path.join(here, "missing"));
    assert.equal(res.status, 200);
    assert.deepEqual(body.schedule.flags.ext1, ["unresolved"]);
    assert.match(body.schedule.errors.ext1, /project\.csv/);
  });

  it("changes referencesVersion on /version when the referenced project is edited", async () => {
    const partner = await createProject(await newFolder());
    const { id, body } = await addReference({ kind: "csv", path: await newFolder() }, partner.body.storage.path);
    const before = (await (await get(`/api/projects/${id}/version`)).json()).referencesVersion;
    assert.equal(before, body.referencesVersion);
    await post(`/api/projects/${partner.body.project.id}/commands`, {
      expectedVersion: partner.body.version,
      commands: [{ type: "updateNode", id: partner.body.project.rootId, changes: { workTime: "9d" } }],
    });
    const after = (await (await get(`/api/projects/${id}/version`)).json()).referencesVersion;
    assert.notEqual(after, before);
  });
});

describe("static web app", () => {
  it("serves assets with a matching content type", async () => {
    const res = await fetch(`${base}/app.js`);
    assert.match(res.headers.get("content-type") ?? "", /javascript/);
  });

  it("does not serve files outside the static folder", async () => {
    const res = await fetch(`${base}/..%2F..%2Fpackage.json`);
    assert.equal(res.status, 404);
  });

  it("returns 404 for unknown API routes", async () => {
    assert.equal((await get("/api/nothing")).status, 404);
  });
});

describe("Resourcing feature flag", () => {
  const resourceCommands = [
    { type: "addResourceType", name: "Developer" },
    { type: "addResource", typeName: "Developer", resource: { id: "r1", name: "Ann", available: "40h" } },
  ];

  it("is off unless the server was started with it, and says so in the config", async () => {
    const folder = await newFolder();
    const { body } = await createProject(folder);
    const res = await post(`/api/projects/${body.project.id}/commands`, { expectedVersion: body.version, commands: resourceCommands });
    assert.equal(res.status, 403);
    assert.match(((await res.json()) as { error: string }).error, /--resourcing/);
    // nothing was written
    assert.deepEqual((await (await get(`/api/projects/${body.project.id}`)).json()).project.resourceTypes, undefined);
  });

  it("also refuses a work item's resource requirements when off", async () => {
    const folder = await newFolder();
    const { body } = await createProject(folder);
    const res = await post(`/api/projects/${body.project.id}/commands`, {
      expectedVersion: body.version,
      commands: [{ type: "updateNode", id: body.project.rootId, changes: { resources: [] } }],
    });
    assert.equal(res.status, 403);
  });

  describe("when on", () => {
    let on = "";
    let stop: () => Promise<void>;
    before(async () => {
      const server = createApp({ adapters: { csv: csvAdapter }, staticDir, token: TOKEN, resourcing: true });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      on = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      stop = () => new Promise((resolve) => server.close(() => resolve()));
    });
    after(() => stop());
    const call = (url: string, body?: unknown) =>
      fetch(on + url, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });

    it("reports itself in the config", async () => {
      assert.equal(((await (await call("/api/config")).json()) as { resourcing: boolean }).resourcing, true);
    });

    it("saves the resource pool with the project and gives it back when it's reopened", async () => {
      const folder = await newFolder();
      const created = await (
        await call("/api/projects", { storage: { kind: "csv", path: folder }, name: "Launch", start: "2026-11-02T09:00:00.000Z", root: { title: "Done", workTime: "1d" } })
      ).json();
      const res = await call(`/api/projects/${created.project.id}/commands`, { expectedVersion: created.version, commands: resourceCommands });
      assert.equal(res.status, 200);
      const reopened = await (await call("/api/projects/open", { storage: { kind: "csv", path: folder } })).json();
      assert.deepEqual(reopened.project.resourceTypes, [{ name: "Developer", resources: [{ id: "r1", name: "Ann", available: "40h" }] }]);
    });

    it("saves a work item's requirement with the project", async () => {
      const folder = await newFolder();
      const created = await (
        await call("/api/projects", { storage: { kind: "csv", path: folder }, name: "Launch", start: "2026-11-02T09:00:00.000Z", root: { title: "Done", workTime: "1d" } })
      ).json();
      const res = await call(`/api/projects/${created.project.id}/commands`, {
        expectedVersion: created.version,
        commands: [
          { type: "addResourceType", name: "Developer" },
          { type: "updateNode", id: created.project.rootId, changes: { resources: [{ typeName: "Developer", count: 2 }] } },
        ],
      });
      assert.equal(res.status, 200);
      const reopened = await (await call("/api/projects/open", { storage: { kind: "csv", path: folder } })).json();
      assert.deepEqual(reopened.project.nodes[0].resources, [{ typeName: "Developer", count: 2 }]);
    });

    it("reports a bad available time as a 422", async () => {
      const folder = await newFolder();
      const created = await (
        await call("/api/projects", { storage: { kind: "csv", path: folder }, name: "Launch", start: "2026-11-02T09:00:00.000Z", root: { title: "Done", workTime: "1d" } })
      ).json();
      const res = await call(`/api/projects/${created.project.id}/commands`, {
        expectedVersion: created.version,
        commands: [resourceCommands[0], { type: "addResource", typeName: "Developer", resource: { id: "r1", name: "", available: "lots" } }],
      });
      assert.equal(res.status, 422);
    });
  });
});
