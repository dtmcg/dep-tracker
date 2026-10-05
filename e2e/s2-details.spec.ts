import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "playwright/test";
import { addDependency, bar, details as openDetails, newProject } from "./helpers.ts";

// Slice S2 acceptance: clicking a node shows work time, not-before, dependency
// time, completion, rendered description and links; the PRD's worked example
// passes; edits to any field recompute instantly. Undo/redo (FR-13) included.
test("S2: node details, the worked example, live edits and undo/redo", async ({ page }) => {
  const folder = await newProject(page, { start: "2026-10-28T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Docs", "2d"); // finishes 30 Oct
  await addDependency(page, "Release", "Payments", "1w"); // finishes 4 Nov

  const details = await openDetails(page, "Release");
  await expect(details.getByTestId("detail-work")).toHaveText("2d");
  await expect(details.getByTestId("detail-not-before")).toHaveText("None");
  await expect(details.getByTestId("detail-dependency-time")).toHaveText("Wed 4 Nov 2026, 09:00");
  await expect(details.getByTestId("detail-completion")).toHaveText("Fri 6 Nov 2026, 09:00");

  // Worked example: not before 1 Nov, dependencies 30 Oct and 4 Nov, 2d → 6 Nov
  await details.getByRole("button", { name: "Edit" }).click();
  await details.getByLabel("Not before").fill("2026-11-01T09:00");
  await expect(details.getByTestId("preview-completion")).toHaveText("Fri 6 Nov 2026, 09:00");
  // A later not-before date wins over the dependency time, recomputed as you type
  await details.getByLabel("Not before").fill("2026-11-05T09:00");
  await expect(details.getByTestId("preview-completion")).toHaveText("Sat 7 Nov 2026, 09:00");
  await details.getByLabel("Description").fill("**Ship** the release to everyone.");
  await details.getByLabel("Links").fill("https://example.com/release");
  await details.getByLabel("Work time").fill("2x");
  await expect(details.getByText(/Invalid duration "2x"/)).toBeVisible();
  await expect(details.getByRole("button", { name: "Save" })).toBeDisabled();
  await details.getByLabel("Work time").fill("2d");
  await details.getByRole("button", { name: "Save" }).click();

  await expect(details.getByTestId("detail-completion")).toHaveText("Sat 7 Nov 2026, 09:00");
  await expect(details.locator("strong", { hasText: "Ship" })).toBeVisible();
  await expect(details.getByRole("link", { name: "https://example.com/release" })).toHaveAttribute(
    "href",
    "https://example.com/release",
  );
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
  expect(await readFile(path.join(folder, "nodes.csv"), "utf8")).toContain("2026-11-05T09:00:00.000Z");

  // Undo restores the previous values and dates; redo reapplies them
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(details.getByTestId("detail-completion")).toHaveText("Fri 6 Nov 2026, 09:00");
  await expect(details.locator("strong", { hasText: "Ship" })).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(details.getByTestId("detail-completion")).toHaveText("Sat 7 Nov 2026, 09:00");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
});

test("S2: deleting a dependency recomputes its dependents", async ({ page }) => {
  await newProject(page, { start: "2026-10-28T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Payments", "1w");
  const release = bar(page, "Release");
  await expect(release.getByTestId("completion")).toHaveAttribute("datetime", "2026-11-06T09:00:00.000Z");

  await (await openDetails(page, "Payments")).getByRole("button", { name: "Delete node" }).click();
  await expect(bar(page, "Payments")).toHaveCount(0);
  await expect(release.getByTestId("completion")).toHaveAttribute("datetime", "2026-10-30T09:00:00.000Z");
});
