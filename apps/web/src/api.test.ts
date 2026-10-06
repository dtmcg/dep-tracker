import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, createApi } from "./api.ts";

type Call = { url: string; init?: RequestInit };

function recorder(status = 200, body: unknown = {}) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const opened = { project: { id: "p1", name: "P" }, schedule: { nodes: {}, errors: {} }, version: "v1" };

describe("api client", () => {
  it("sends the per-launch token on every call", async () => {
    const { calls, fetchFn } = recorder(200, opened);
    await createApi("tok", fetchFn).openProject({ kind: "csv", path: "C:\\plans\\beta" });
    assert.equal(new Headers(calls[0]?.init?.headers).get("x-dep-tracker-token"), "tok");
  });

  it("opens a project by posting its storage descriptor", async () => {
    const { calls, fetchFn } = recorder(200, opened);
    const result = await createApi("tok", fetchFn).openProject({ kind: "csv", path: "C:\\plans\\beta" });
    assert.equal(calls[0]?.url, "/api/projects/open");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { storage: { kind: "csv", path: "C:\\plans\\beta" } });
    assert.equal(result.project.name, "P");
  });

  it("creates a project", async () => {
    const { calls, fetchFn } = recorder(201, opened);
    await createApi("tok", fetchFn).createProject({
      storage: { kind: "csv", path: "x" },
      name: "Launch",
      start: "2026-11-02T09:00:00.000Z",
      root: { title: "Done", workTime: "1d" },
    });
    assert.equal(calls[0]?.url, "/api/projects");
    assert.equal(JSON.parse(String(calls[0]?.init?.body)).root.title, "Done");
  });

  it("sends commands with the expected version", async () => {
    const { calls, fetchFn } = recorder(200, opened);
    await createApi("tok", fetchFn).sendCommands("p 1", "v1", [{ type: "addEdge", dependentId: "a", dependencyId: "b" }]);
    assert.equal(calls[0]?.url, "/api/projects/p%201/commands");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)).expectedVersion, "v1");
  });

  it("reads the current version", async () => {
    const { calls, fetchFn } = recorder(200, { version: "v9", referencesVersion: "r2" });
    assert.deepEqual(await createApi("tok", fetchFn).version("p1"), { version: "v9", referencesVersion: "r2" });
    assert.equal(calls[0]?.url, "/api/projects/p1/version");
  });

  it("throws the server's error message and status", async () => {
    const { fetchFn } = recorder(409, { error: "changed on disk" });
    await assert.rejects(
      createApi("tok", fetchFn).sendCommands("p1", "v1", []),
      (e: unknown) => e instanceof ApiError && e.message === "changed on disk" && e.status === 409,
    );
  });

  it("explains when the server cannot be reached", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(createApi("tok", down).openProject({ kind: "csv", path: "x" }), /server/i);
  });

  it("imports a project from one store into another", async () => {
    const { calls, fetchFn } = recorder(201, opened);
    await createApi("tok", fetchFn).importProject({ kind: "csv", path: "a" }, { kind: "excel", path: "b.xlsx" });
    assert.equal(calls[0]?.url, "/api/projects/import");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { source: { kind: "csv", path: "a" }, target: { kind: "excel", path: "b.xlsx" } });
  });

  it("exports an open project", async () => {
    const { calls, fetchFn } = recorder(201, { storage: { kind: "csv", path: "out" }, version: "v" });
    await createApi("tok", fetchFn).exportProject("p1", { kind: "csv", path: "out" });
    assert.equal(calls[0]?.url, "/api/projects/p1/export");
  });

  it("checks and starts Google sign-in", async () => {
    const { calls, fetchFn } = recorder(200, { url: "https://accounts.example/auth" });
    const api = createApi("tok", fetchFn);
    assert.equal(await api.googleStart(), "https://accounts.example/auth");
    assert.equal(calls[0]?.url, "/api/auth/google/start");
    assert.equal(calls[0]?.init?.method, "POST");
    await api.googleStatus();
    assert.equal(calls[1]?.url, "/api/auth/google/status");
  });
});
