import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, openProject } from "./api.ts";

const json = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("openProject", () => {
  it("posts the storage descriptor and returns the opened project", async () => {
    let sent: { url: string; init?: RequestInit } | undefined;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ project: { name: "P" }, schedule: { nodes: {}, errors: {} }, version: "v1" }));
    }) as typeof fetch;

    const result = await openProject({ kind: "csv", path: "C:\\plans\\beta" }, fetchFn);

    assert.equal(sent?.url, "/api/projects/open");
    assert.equal(sent?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(sent?.init?.body)), { storage: { kind: "csv", path: "C:\\plans\\beta" } });
    assert.equal(result.project.name, "P");
  });

  it("throws the server's error message", async () => {
    await assert.rejects(
      openProject({ kind: "csv", path: "x" }, json(422, { error: "No project.csv found in x" })),
      (e: unknown) => e instanceof ApiError && e.message === "No project.csv found in x" && e.status === 422,
    );
  });

  it("explains when the server cannot be reached", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(openProject({ kind: "csv", path: "x" }, down), /server/i);
  });
});
