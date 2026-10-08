import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { details, newProject, openFromList } from "./helpers.ts";

// Resourcing runs behind a feature flag: this spec talks to a second backend started with --resourcing.
test.use({ baseURL: `http://127.0.0.1:${process.env.E2E_RESOURCING_PORT ?? 4320}` });

test("resource pool: define a type, add instances, copy and remove them, and keep them across a reload", async ({ page }) => {
  const folder = await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  const pool = page.getByRole("region", { name: "Resource pool" });
  await expect(pool).toBeVisible();

  // Define a type
  await pool.getByRole("button", { name: "Add resource type" }).click();
  await page.getByLabel("Resource type name").fill("Developer");
  await page.getByRole("button", { name: "Save" }).click();
  const toggle = pool.getByRole("button", { name: "Developer (0)" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // Add an instance with a name and available time via the +
  const panel = pool.getByRole("group", { name: "Developer resources" });
  await panel.getByRole("button", { name: "Add Developer" }).click();
  const form = page.getByRole("form", { name: "New Developer" });
  await form.getByLabel("Name").fill("Ann");
  await form.getByLabel("Available time").fill("40h");
  await form.getByRole("button", { name: "Save" }).click();
  const rows = panel.getByTestId("resource-instance");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Ann");
  await expect(rows.first().getByTestId("resource-available")).toHaveText("40h");
  // the + to add another stays available
  await expect(panel.getByRole("button", { name: "Add Developer" })).toBeVisible();

  // Nothing is required: save an empty one
  await panel.getByRole("button", { name: "Add Developer" }).click();
  await page.getByRole("form", { name: "New Developer" }).getByRole("button", { name: "Save" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Unnamed developer");

  // A bad available time is refused, and nothing is added
  await panel.getByRole("button", { name: "Add Developer" }).click();
  const bad = page.getByRole("form", { name: "New Developer" });
  await bad.getByLabel("Available time").fill("lots");
  await bad.getByRole("button", { name: "Save" }).click();
  await expect(bad.getByRole("alert")).toContainText("Available time");
  await bad.getByRole("button", { name: "Cancel" }).click();
  await expect(rows).toHaveCount(2);

  // + beside an instance copies it, − removes it
  await rows.first().getByRole("button", { name: "Add another like Ann" }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText("Ann");
  await expect(rows.nth(1).getByTestId("resource-available")).toHaveText("40h");
  await expect(pool.getByRole("button", { name: "Developer (3)" })).toBeVisible();
  await rows.nth(1).getByRole("button", { name: "Remove Ann" }).click();
  await expect(rows).toHaveCount(2);

  // Saved as plain CSV files next to the project
  await expect(async () => {
    expect(await readFile(path.join(folder, "resource_types.csv"), "utf8")).toBe("type\nDeveloper\n");
    expect(await readFile(path.join(folder, "resources.csv"), "utf8")).toMatch(/Developer,[^,]+,Ann,40h\nDeveloper,[^,]+,,\n$/);
  }).toPass();

  // Undo brings the removed copy back
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows).toHaveCount(3);

  // And it's all still there when the project is opened again
  await openFromList(page, folder);
  await page.getByRole("region", { name: "Resource pool" }).getByRole("button", { name: "Developer (3)" }).click();
  await expect(page.getByRole("group", { name: "Developer resources" }).getByTestId("resource-instance")).toHaveCount(3);
});

test("resource pool: a type can be removed", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  const pool = page.getByRole("region", { name: "Resource pool" });
  await pool.getByRole("button", { name: "Add resource type" }).click();
  await page.getByLabel("Resource type name").fill("Test rig");
  await page.getByRole("button", { name: "Save" }).click();
  await pool.getByRole("button", { name: "Remove type" }).click();
  await expect(pool.getByRole("button", { name: /Test rig/ })).toHaveCount(0);
});

test("resource pool: a type name is required and unique", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  const pool = page.getByRole("region", { name: "Resource pool" });
  await pool.getByRole("button", { name: "Add resource type" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("needs a name");
  await page.getByLabel("Resource type name").fill("Developer");
  await page.getByRole("button", { name: "Save" }).click();
  await pool.getByRole("button", { name: "Add resource type" }).click();
  await page.getByLabel("Resource type name").fill("developer");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("already");
});

test("work item requirements: pick or create a type, raise and lower the number, keep it across a reload", async ({ page }) => {
  const folder = await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  const pool = page.getByRole("region", { name: "Resource pool" });
  await pool.getByRole("button", { name: "Add resource type" }).click();
  await page.getByLabel("Resource type name").fill("Developer");
  await page.getByRole("button", { name: "Save" }).click();

  const panel = await details(page, "Release");
  const needs = panel.getByRole("region", { name: "Resources needed" });
  await expect(needs).toContainText("None yet");

  // Pick an existing type: needs 1 to begin with
  await needs.getByRole("button", { name: "Add resource requirement" }).click();
  await needs.getByLabel("Resource type").selectOption("Developer");
  await needs.getByRole("button", { name: "Add", exact: true }).click();
  const dev = needs.getByTestId("requirement").filter({ hasText: "Developer" });
  await expect(dev.getByTestId("requirement-count")).toHaveText("× 1");

  // + and − set the number
  await dev.getByRole("button", { name: "One more Developer" }).click();
  await expect(dev.getByTestId("requirement-count")).toHaveText("× 2");

  // Create a new type from here
  await needs.getByRole("button", { name: "Add resource requirement" }).click();
  await needs.getByLabel("Resource type").selectOption({ label: "New type…" });
  await needs.getByLabel("New type name").fill("Designer");
  await needs.getByRole("button", { name: "Add", exact: true }).click();
  await expect(needs.getByTestId("requirement").filter({ hasText: "Designer" }).getByTestId("requirement-count")).toHaveText("× 1");
  await expect(pool.getByRole("button", { name: "Designer (0)" })).toBeVisible(); // it joined the pool too

  // Already-picked types aren't offered again
  await needs.getByRole("button", { name: "Add resource requirement" }).click();
  await expect(needs.getByLabel("Resource type").locator("option")).toHaveText(["Choose…", "New type…"]);
  await needs.getByRole("button", { name: "Cancel" }).click();

  // Going below 1 drops the requirement
  await needs.getByRole("button", { name: "One fewer Designer" }).click();
  await expect(needs.getByTestId("requirement").filter({ hasText: "Designer" })).toHaveCount(0);

  // Plain text in nodes.csv, and it survives reopening
  await expect(async () => {
    expect(await readFile(path.join(folder, "nodes.csv"), "utf8")).toContain("Developer x 2");
  }).toPass();
  await openFromList(page, folder);
  const again = await details(page, "Release");
  await expect(again.getByTestId("requirement-count")).toHaveText("× 2");

  // Undo steps back through it
  await again.getByRole("button", { name: "One fewer Developer" }).click();
  await expect(again.getByTestId("requirement-count")).toHaveText("× 1");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(again.getByTestId("requirement-count")).toHaveText("× 2");
});

test("work item requirements: removing a type from the pool clears it from work items", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  const pool = page.getByRole("region", { name: "Resource pool" });
  await pool.getByRole("button", { name: "Add resource type" }).click();
  await page.getByLabel("Resource type name").fill("Developer");
  await page.getByRole("button", { name: "Save" }).click();
  const needs = (await details(page, "Release")).getByRole("region", { name: "Resources needed" });
  await needs.getByRole("button", { name: "Add resource requirement" }).click();
  await needs.getByLabel("Resource type").selectOption("Developer");
  await needs.getByRole("button", { name: "Add", exact: true }).click();
  await expect(needs.getByTestId("requirement")).toHaveCount(1);
  await pool.getByRole("button", { name: "Remove type" }).click();
  await expect(needs.getByTestId("requirement")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(needs.getByTestId("requirement")).toHaveCount(1);
});

test("resource consumption: each allocated resource uses the full work time, and the pool adds it up", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "3d" });
  const pool = page.getByRole("region", { name: "Resource pool" });
  await pool.getByRole("button", { name: "Add resource type" }).click();
  await page.getByLabel("Resource type name").fill("Developer");
  await page.getByRole("button", { name: "Save" }).click();
  const completion = (await details(page, "Release")).getByTestId("detail-completion");
  const before = await completion.textContent();
  const needs = (await details(page, "Release")).getByRole("region", { name: "Resources needed" });
  await needs.getByRole("button", { name: "Add resource requirement" }).click();
  await needs.getByLabel("Resource type").selectOption("Developer");
  await needs.getByRole("button", { name: "Add", exact: true }).click();
  const use = needs.getByTestId("requirement-consumption");
  await expect(use).toHaveText("uses 3d");
  await needs.getByRole("button", { name: "One more Developer" }).click();
  await expect(use).toHaveText("uses 3d each, 6d in all");
  await needs.getByRole("button", { name: "One more Developer" }).click();
  await expect(use).toHaveText("uses 3d each, 1w 2d in all");
  await expect(pool.getByTestId("type-consumption")).toHaveText("Work items use 1w 2d of developer time across 1 item.");
  // more resources don't change the dates
  await expect(completion).toHaveText(before!);
});
