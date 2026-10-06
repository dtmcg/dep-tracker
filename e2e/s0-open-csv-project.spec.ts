import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "playwright/test";
import { openFromList, showOpenForm } from "./helpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleProject = path.resolve(here, "../fixtures/sample-project");

// Slice S0 acceptance: given a CSV folder with one root node, opening it shows
// the root title and completion = project start + work time.
test("S0: open a CSV project and see its root node with its completion time", async ({ page }) => {
  await page.goto("/");
  await showOpenForm(page);

  await page.getByLabel("Project folder").fill(sampleProject);
  await page.getByRole("button", { name: "Open" }).click();

  await expect(page.getByRole("heading", { name: "Mobile relaunch" })).toBeVisible();

  const root = page.getByRole("article", { name: "Public beta live" });
  await expect(root).toBeVisible();
  await expect(root).toHaveAttribute("data-root", "true");
  // Start 2026-11-02 09:00 UTC + 2d work time
  await expect(root.getByTestId("completion")).toHaveAttribute("datetime", "2026-11-04T09:00:00.000Z");
  await expect(root.getByTestId("completion")).toHaveText("Wed 4 Nov 2026, 09:00");
});

test("S0: opening a folder that is not a project shows a clear error", async ({ page }) => {
  await page.goto("/");
  await showOpenForm(page);

  await page.getByLabel("Project folder").fill(path.resolve(here, "does-not-exist"));
  await page.getByRole("button", { name: "Open" }).click();

  await expect(page.getByRole("alert")).toContainText("project.csv");
});
