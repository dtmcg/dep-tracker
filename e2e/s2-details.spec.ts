import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "playwright/test";

async function newProject(page: Page, start: string, root: string, work: string) {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-e2e-")), "plan");
  await page.goto("/");
  await page.getByRole("tab", { name: "New project" }).click();
  await page.getByLabel("Folder").fill(folder);
  await page.getByLabel("Project name").fill("Release plan");
  await page.getByLabel("Start").fill(start);
  await page.getByLabel("Success criteria").fill(root);
  await page.getByLabel("Work time").fill(work);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Release plan" })).toBeVisible();
  return folder;
}

async function addDependency(page: Page, of: string, title: string, work: string) {
  await page.getByRole("article", { name: of }).getByRole("button", { name: "Add dependency" }).click();
  const form = page.getByRole("form", { name: `New dependency of ${of}` });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Work time").fill(work);
  await form.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("article", { name: title })).toBeVisible();
}

// Slice S2 acceptance: clicking a node shows work time, not-before, dependency
// time, completion, rendered description and links; the PRD's worked example
// passes; edits to any field recompute instantly. Undo/redo (FR-13) included.
test("S2: node details, the worked example, live edits and undo/redo", async ({ page }) => {
  const folder = await newProject(page, "2026-10-28T09:00", "Release", "2d");
  await addDependency(page, "Release", "Docs", "2d"); // finishes 30 Oct
  await addDependency(page, "Release", "Payments", "1w"); // finishes 4 Nov

  const release = page.getByRole("article", { name: "Release" });
  await release.getByRole("button", { name: "Release", exact: true }).click();
  const details = release.getByRole("region", { name: "Details of Release" });
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
  await newProject(page, "2026-10-28T09:00", "Release", "2d");
  await addDependency(page, "Release", "Payments", "1w");
  const release = page.getByRole("article", { name: "Release" });
  await expect(release.getByTestId("completion")).toHaveAttribute("datetime", "2026-11-06T09:00:00.000Z");

  const payments = page.getByRole("article", { name: "Payments" });
  await payments.getByRole("button", { name: "Payments", exact: true }).click();
  await payments.getByRole("button", { name: "Delete node" }).click();
  await expect(page.getByRole("article", { name: "Payments" })).toHaveCount(0);
  await expect(release.getByTestId("completion")).toHaveAttribute("datetime", "2026-10-30T09:00:00.000Z");
});
