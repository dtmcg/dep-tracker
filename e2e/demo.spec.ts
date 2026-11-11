import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { expect, test } from "playwright/test";
import { addDependency, bar } from "./helpers.ts";

// The online demo is a static site (no backend), served by GitHub Pages under /dep-tracker/. Serve the built
// site the same way, with no /api at all, so the test proves it runs with nothing behind it.
const SITE = path.resolve("site");
const BASE = "/dep-tracker/";
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
let server: Server;
let url = "";

test.beforeAll(async () => {
  execFileSync("node", ["scripts/build-demo.mjs"], { stdio: "inherit" });
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    if (!pathname.startsWith(BASE)) return void res.writeHead(404).end();
    const file = pathname.slice(BASE.length) || "index.html";
    try {
      const body = await readFile(path.join(SITE, path.normalize(file).replace(/^(\.\.[/\\])+/, "")));
      res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  url = `http://127.0.0.1:${port}${BASE}`;
});
test.afterAll(() => server.close());

test("the demo opens the sample project with no backend, and edits stay in memory", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) apiCalls.push(r.url());
  });
  await page.goto(url);

  await expect(page.getByRole("heading", { name: "Mobile relaunch" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Online demo");
  await expect(bar(page, "Public beta live")).toBeVisible();
  await expect(bar(page, "QA sign-off")).toBeVisible();
  // storage-only actions are replaced
  await expect(page.getByRole("button", { name: "Export to CSV" })).toHaveCount(0);

  await addDependency(page, "QA sign-off", "Test plan", "1d");
  await expect(bar(page, "Test plan")).toBeVisible();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");

  // Reset puts the sample back
  await page.getByRole("button", { name: "Reset sample" }).click();
  await expect(bar(page, "QA sign-off")).toBeVisible();
  await expect(bar(page, "Test plan")).toHaveCount(0);

  // A reload starts from the sample too
  await addDependency(page, "QA sign-off", "Another", "1d");
  await page.reload();
  await expect(bar(page, "Another")).toHaveCount(0);

  expect(apiCalls).toEqual([]);
});

test("the demo has the resource pool switched on", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByText("Developer").first()).toBeVisible();
});
