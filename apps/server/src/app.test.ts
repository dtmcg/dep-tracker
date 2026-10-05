import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { csvAdapter } from "@dep-tracker/adapter-csv";
import { createApp } from "./app.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.resolve(here, "../../../fixtures/sample-project");

let base = "";
let close: () => Promise<void>;
let staticDir = "";

before(async () => {
  staticDir = await mkdtemp(path.join(tmpdir(), "dep-tracker-web-"));
  await writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>dep-tracker</title>");
  await writeFile(path.join(staticDir, "app.js"), "console.log('hi')");
  const server = createApp({ adapters: { csv: csvAdapter }, staticDir });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});

after(() => close());

const post = (url: string, body: unknown) =>
  fetch(base + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("API", () => {
  it("GET /api/health reports ok", async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it("POST /api/projects/open returns the project, its schedule and version", async () => {
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
    const res = await post("/api/projects/open", { storage: { kind: "excel", path: "x.xlsx" } });
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /excel/);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await fetch(`${base}/api/projects/open`, { method: "POST", body: "{nope" });
    assert.equal(res.status, 400);
  });

  it("returns 404 for unknown API routes", async () => {
    assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
  });
});

describe("static web app", () => {
  it("serves index.html at /", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await res.text(), /dep-tracker/);
  });

  it("serves assets with a matching content type", async () => {
    const res = await fetch(`${base}/app.js`);
    assert.match(res.headers.get("content-type") ?? "", /javascript/);
  });

  it("does not serve files outside the static folder", async () => {
    const res = await fetch(`${base}/..%2F..%2Fpackage.json`);
    assert.equal(res.status, 404);
  });
});
