import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "playwright/test";
import { details } from "./helpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// Slice S1 acceptance: adding a 3d dependency to a 2d root moves the root's
// completion out by 3d on screen and in nodes.csv/edges.csv; reload shows the same.
// Also covers FR-23 "New": creating a CSV project from the start screen.
test("S1: create a project, add a dependency, and see dates update and persist", async ({ page }) => {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-e2e-")), "launch-plan");

  await page.goto("/");
  await page.getByRole("tab", { name: "New project" }).click();
  await page.getByLabel("Folder").fill(folder);
  await page.getByLabel("Project name").fill("Launch");
  await page.getByLabel("Start").fill("2026-11-02T09:00");
  await page.getByLabel("Success criteria").fill("Public beta live");
  await page.getByLabel("Work time").fill("2d");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: "Launch" })).toBeVisible();
  const root = page.getByRole("article", { name: "Public beta live" });
  await expect(root.getByTestId("completion")).toHaveAttribute("datetime", "2026-11-04T09:00:00.000Z");

  await (await details(page, "Public beta live")).getByRole("button", { name: "Add dependency" }).click();
  const form = page.getByRole("form", { name: "New dependency of Public beta live" });
  await form.getByLabel("Title").fill("Payments integration");
  await form.getByLabel("Work time").fill("3d");
  await form.getByRole("button", { name: "Add" }).click();

  // Root moves out by 3d; the dependency finishes 3d after the start.
  await expect(root.getByTestId("completion")).toHaveAttribute("datetime", "2026-11-07T09:00:00.000Z");
  const dep = page.getByRole("article", { name: "Payments integration" });
  await expect(dep.getByTestId("completion")).toHaveAttribute("datetime", "2026-11-05T09:00:00.000Z");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");

  const nodesCsv = await readFile(path.join(folder, "nodes.csv"), "utf8");
  const edgesCsv = await readFile(path.join(folder, "edges.csv"), "utf8");
  expect(nodesCsv).toContain("Payments integration,3d");
  const depId = /^(\S+?),Payments integration,/m.exec(nodesCsv)?.[1];
  expect(depId).toBeTruthy();
  expect(edgesCsv).toMatch(new RegExp(`^n\\w*,${depId}$`, "m"));

  // Reload and reopen from disk
  await page.reload();
  await page.getByLabel("Project folder").fill(folder);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(
    page.getByRole("article", { name: "Public beta live" }).getByTestId("completion"),
  ).toHaveAttribute("datetime", "2026-11-07T09:00:00.000Z");
});

test("S1: creating a project in a folder that already holds one is refused", async ({ page }) => {
  const sample = path.resolve(here, "../fixtures/sample-project");
  await page.goto("/");
  await page.getByRole("tab", { name: "New project" }).click();
  await page.getByLabel("Folder").fill(sample);
  await page.getByLabel("Project name").fill("Dup");
  await page.getByLabel("Start").fill("2026-11-02T09:00");
  await page.getByLabel("Success criteria").fill("Done");
  await page.getByLabel("Work time").fill("1d");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("alert")).toContainText("already");
});

test("S1: edits made to the CSV files outside the app are picked up (FR-26)", async ({ page }) => {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-e2e-")), "plan");
  await cp(path.resolve(here, "../fixtures/sample-project"), folder, { recursive: true });
  await page.goto("/");
  await page.getByLabel("Project folder").fill(folder);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("article", { name: "Public beta live" })).toBeVisible();

  const nodes = path.join(folder, "nodes.csv");
  await writeFile(nodes, (await readFile(nodes, "utf8")).replace("Public beta live", "Public beta open"));

  await expect(page.getByRole("article", { name: "Public beta open" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("note")).toContainText("changed on disk");
});
