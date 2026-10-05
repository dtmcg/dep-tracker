import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "playwright/test";
import { addDependency, bar, details, newProject } from "./helpers.ts";

async function addLabel(page: Page, node: string, label: string) {
  const panel = await details(page, node);
  await panel.getByLabel("Add label").fill(label);
  await panel.getByLabel("Add label").press("Enter");
  await expect(panel.getByRole("listitem").filter({ hasText: label })).toBeVisible();
}

const legend = (page: Page) => page.getByRole("region", { name: "Label key" });
const entry = (page: Page, label: string) => legend(page).getByRole("button", { name: new RegExp(`^${label} \\(\\d+\\)$`) });

// Slice S6 acceptance: adding labels updates the legend counts; choosing a
// colour persists; toggling two labels highlights the union with both colours visible.
test("S6: labels, legend counts, colours that persist, and highlighting", async ({ page }) => {
  const folder = await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Alpha", "1d");
  await addDependency(page, "Release", "Beta", "1d");

  await addLabel(page, "Alpha", "risk");
  await addLabel(page, "Release", "risk");
  await addLabel(page, "Alpha", "team:web");
  await addLabel(page, "Beta", "team:web");

  await expect(entry(page, "risk")).toHaveText("risk (2)");
  await expect(entry(page, "team:web")).toHaveText("team:web (2)");

  // Autocomplete offers labels already in the project that the node doesn't have yet (FR-18)
  const panel = await details(page, "Beta");
  const options = await panel.locator("datalist option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(options).toEqual(["risk"]);

  // Choose a colour from the palette and with the picker; it is saved with the project
  await legend(page).getByRole("button", { name: "Colour for risk" }).click();
  await legend(page).getByRole("button", { name: "Use Teal for risk" }).click();
  await legend(page).getByRole("button", { name: "Colour for team:web" }).click();
  await legend(page).getByLabel("Custom colour for team:web").fill("#cc3399");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
  const labelsCsv = await readFile(path.join(folder, "labels.csv"), "utf8");
  expect(labelsCsv).toContain("team:web,#cc3399");
  expect(labelsCsv).toMatch(/^risk,#[0-9a-f]{6}$/m);

  // Toggle both labels: their nodes are highlighted, and Alpha shows both
  await entry(page, "risk").click();
  await entry(page, "team:web").click();
  await expect(entry(page, "risk")).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page, "Alpha")).toHaveAttribute("data-labels-active", "risk team:web");
  await expect(bar(page, "Release")).toHaveAttribute("data-labels-active", "risk");
  await expect(bar(page, "Beta")).toHaveAttribute("data-labels-active", "team:web");
  // Not colour alone: the active label names are shown on the bar (NFR-7)
  const chips = bar(page, "Alpha").getByTestId("active-label");
  await expect(chips).toHaveText(["risk", "team:web"]);
  const colours = await chips.evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue("--label-colour").trim()));
  expect(colours).toContain("#cc3399");
  expect(new Set(colours).size).toBe(2);

  // Turning one off leaves only the other
  await entry(page, "risk").click();
  await expect(bar(page, "Release")).not.toHaveAttribute("data-labels-active");
  await expect(bar(page, "Alpha")).toHaveAttribute("data-labels-active", "team:web");

  // Removing a label updates the count
  await (await details(page, "Release")).getByRole("button", { name: "Remove label risk" }).click();
  await expect(entry(page, "risk")).toHaveText("risk (1)");

  // Colours survive reopening the project
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Project folder").fill(folder);
  await page.getByRole("button", { name: "Open" }).click();
  await legend(page).getByRole("button", { name: "Colour for team:web" }).click();
  await expect(legend(page).getByLabel("Custom colour for team:web")).toHaveValue("#cc3399");
});
