import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { expect, test } from "playwright/test";
import { addDependency, bar, details } from "./helpers.ts";

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

test("the demo opens the Mobile relaunch sample with no backend, and edits stay in memory", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) apiCalls.push(r.url());
  });
  await page.goto(url);

  await expect(page.getByRole("heading", { name: "Mobile relaunch" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Online demo");
  await expect(bar(page, "QA sign-off")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export to CSV" })).toHaveCount(0);

  await addDependency(page, "QA sign-off", "Test plan", "1d");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");

  await page.getByRole("button", { name: "Reset example" }).click();
  await expect(bar(page, "Test plan")).toHaveCount(0);

  await addDependency(page, "QA sign-off", "Another", "1d");
  await page.reload();
  await expect(bar(page, "Another")).toHaveCount(0);

  expect(apiCalls).toEqual([]);
});

test("the example picker swaps in each example and drops edits to the last one", async ({ page }) => {
  await page.goto(url);
  const picker = page.getByLabel("Example project");
  await expect(picker.locator("option")).toHaveCount(6);

  await picker.selectOption({ label: "Annual conference" });
  await expect(page.getByRole("heading", { name: "Annual conference" })).toBeVisible();
  await expect(bar(page, "Venue booked and confirmed")).toBeVisible();
  await expect(bar(page, "QA sign-off")).toHaveCount(0);

  await picker.selectOption({ label: "Pharma: tablet manufacturing line" });
  await expect(page.getByRole("heading", { name: "Install and qualify a tablet manufacturing line" })).toBeVisible();
  await expect(bar(page, "Line qualified and releasing GMP batches")).toBeVisible();
  await expect(page.getByText("Validation Engineer").first()).toBeVisible();

  await picker.selectOption({ label: "Pharma: sterile fill-finish line" });
  await expect(page.getByRole("heading", { name: "Install and qualify a fill-finish line" })).toBeVisible();
});

test("a pharma example's reference opens the other project, and Reset example brings back the picked one", async ({ page }) => {
  await page.goto(url);
  await page.getByLabel("Example project").selectOption({ label: "Pharma: tablet manufacturing line" });
  const panel = await details(page, "Cleanroom HVAC upgrade");
  await panel.getByRole("button", { name: "Open that project" }).click();
  await expect(page.getByRole("heading", { name: "Cleanroom HVAC upgrade" })).toBeVisible();
  await expect(bar(page, "HVAC qualified and handed over")).toBeVisible();

  await page.getByRole("button", { name: "Reset example" }).click();
  await expect(page.getByRole("heading", { name: "Install and qualify a tablet manufacturing line" })).toBeVisible();
});

test("Start new gives a project with only its success criteria node, which can be built up", async ({ page }) => {
  await page.goto(url);
  await page.getByRole("button", { name: "Start new" }).click();
  const form = page.getByRole("form", { name: "Start a new project" });
  await form.getByLabel("Project name").fill("Office move");
  await form.getByLabel("Success criteria").fill("Everyone working from the new office");
  await form.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("heading", { name: "Office move" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(bar(page, "Everyone working from the new office")).toBeVisible();

  await addDependency(page, "Everyone working from the new office", "Sign lease", "3d");
  await expect(page.getByRole("article")).toHaveCount(2);

  // Reset returns the blank project, not the example that was open before
  await page.getByRole("button", { name: "Reset example" }).click();
  await expect(page.getByRole("heading", { name: "Office move" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
});
