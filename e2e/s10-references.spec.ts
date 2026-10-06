import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { addDependency, bar, details, newProject } from "./helpers.ts";

async function addReference(page: import("playwright/test").Page, of: string, title: string, folder: string) {
  const panel = await details(page, of);
  await panel.getByRole("button", { name: "Add reference to another project" }).click();
  const form = page.getByRole("form", { name: `New reference needed by ${of}` });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Stored in").selectOption("csv");
  await form.getByLabel("Location").fill(folder);
  await form.getByRole("button", { name: "Add" }).click();
  await expect(bar(page, title)).toBeVisible();
}

// Slice S10 acceptance: a node can stand in for another project's success criteria, takes its
// completion from there, shows it as a reference, and opens that project on request.
test("S10: a reference takes its date from the other project and can be opened", async ({ page }) => {
  const partner = await newProject(page, { name: "Partner plan", start: "2026-11-02T09:00", root: "Partner ready", work: "3d" });
  await page.getByRole("button", { name: "Close" }).click();
  await newProject(page, { name: "Mobile", start: "2026-11-02T09:00", root: "Release", work: "2d" });

  await addReference(page, "Release", "Partner API", partner);
  await expect(bar(page, "Partner API")).toHaveAttribute("data-reference", "true");
  await expect(bar(page, "Partner API").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-05T09:00:00.000Z");
  // Release waits for the partner (3d) and then needs its own 2d
  await expect(bar(page, "Release").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-07T09:00:00.000Z");

  const panel = await details(page, "Partner API");
  await expect(panel.getByTestId("detail-reference")).toContainText(partner);
  await expect(panel.getByRole("button", { name: "Add dependency" })).toHaveCount(0);

  await panel.getByRole("button", { name: "Open that project" }).click();
  await expect(page.getByRole("heading", { name: "Partner plan" })).toBeVisible();
});

test("S10: an unreadable reference is flagged and blocks what depends on it", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Own work", "1d");
  await addReference(page, "Release", "Gone", path.join("/nonexistent", "dep-tracker-e2e", "plan"));

  await expect(bar(page, "Gone")).toHaveAttribute("data-state", "unresolved");
  await expect(bar(page, "Release")).toHaveAttribute("data-state", "blocked-reference");
  await expect(bar(page, "Own work").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-03T09:00:00.000Z");
  const panel = await details(page, "Gone");
  await expect(panel.getByTestId("detail-completion")).toHaveText("Not scheduled");
});

test("S10: projects that reference each other are reported as a loop", async ({ page }) => {
  const alpha = await newProject(page, { name: "Alpha", start: "2026-11-02T09:00", root: "Alpha done", work: "1d" });
  await page.getByRole("button", { name: "Close" }).click();
  const beta = await newProject(page, { name: "Beta", start: "2026-11-02T09:00", root: "Beta done", work: "1d" });
  await addReference(page, "Beta done", "Alpha plan", alpha);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Open Alpha and point it back at Beta
  await page.getByRole("tab", { name: "Open project" }).click();
  await page.getByLabel("Folder").fill(alpha);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  await addReference(page, "Alpha done", "Beta plan", beta);

  const banner = page.getByRole("region", { name: "Project cycles" });
  await expect(banner).toContainText("Alpha → Beta → Alpha");
  await expect(bar(page, "Beta plan")).toHaveAttribute("data-state", "cyclic");
  await expect(bar(page, "Alpha done")).toHaveAttribute("data-state", "blocked");
});

test("S10: edits to the other project show up without reopening", async ({ page }) => {
  const partner = await newProject(page, { name: "Partner plan", start: "2026-11-02T09:00", root: "Partner ready", work: "3d" });
  await page.getByRole("button", { name: "Close" }).click();
  await newProject(page, { name: "Mobile", start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addReference(page, "Release", "Partner API", partner);
  await expect(bar(page, "Partner API").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-05T09:00:00.000Z");

  // Someone changes the partner's work time in its nodes.csv
  const nodes = path.join(partner, "nodes.csv");
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(nodes, "utf8");
  await writeFile(nodes, text.replace("3d", "5d"));
  await expect(bar(page, "Partner API").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-07T09:00:00.000Z", { timeout: 15000 });
});
