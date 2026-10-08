import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { newProject, openFromList } from "./helpers.ts";

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
