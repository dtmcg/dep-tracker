import { expect, test } from "playwright/test";
import { addDependency, bar, details, newProject, openFromList } from "./helpers.ts";

const box = async (page: import("playwright/test").Page, title: string) => (await bar(page, title).getByTestId("bar").boundingBox())!;

// The node view draws the same data as uniform rounded boxes (title and completion date), each ending where the
// node is estimated to complete. Everything else about the graph stays the same.
test("node view: uniform boxes at their completion, same interactions, remembered choice", async ({ page }) => {
  const folder = await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Short", "1d");
  await addDependency(page, "Release", "Long", "5d");
  await page.getByRole("button", { name: "Close details" }).click();

  // Time line view first: bar widths follow work time
  await expect(page.getByRole("button", { name: "Time line view" })).toHaveAttribute("aria-pressed", "true");
  const shortBar = await box(page, "Short");
  const longBar = await box(page, "Long");
  expect(longBar.width / shortBar.width).toBeCloseTo(5, 0);

  await page.getByRole("button", { name: "Node view" }).click();
  await expect(page.getByRole("button", { name: "Node view" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page, "Short")).toHaveAttribute("data-view", "nodes");

  // Same size and shape whatever the work time, and tall enough for title and date
  const [s, l, r] = [await box(page, "Short"), await box(page, "Long"), await box(page, "Release")];
  expect(Math.abs(s.width - l.width)).toBeLessThan(1);
  expect(Math.abs(s.width - r.width)).toBeLessThan(1);
  expect(Math.abs(s.height - l.height)).toBeLessThan(1);
  expect(s.height).toBeGreaterThan(36);
  const radius = await bar(page, "Short").getByTestId("bar").evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
  expect(radius).toBeGreaterThanOrEqual(8);

  // Title and completion date inside the box
  await expect(bar(page, "Short").getByTestId("bar")).toContainText("Short");
  await expect(bar(page, "Short").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-03T09:00:00.000Z");
  await expect(bar(page, "Short").getByTestId("bar")).toContainText("3 Nov 2026");

  // Boxes end at their completion: Long (5d) ends later than Short (1d), by 4 days of axis
  const shortEnd = s.x + s.width;
  const longEnd = l.x + l.width;
  expect(longEnd).toBeGreaterThan(shortEnd);

  // The same interactions: select highlights dependencies, edges animate, details open
  const panel = await details(page, "Release");
  await expect(panel.getByTestId("detail-completion")).toBeVisible();
  await expect(bar(page, "Long")).toHaveAttribute("data-highlight", "upstream");
  await expect(page.locator('[data-edge-dependency="Long"][data-edge-dependent="Release"]')).toHaveAttribute("data-highlight", "upstream");

  // The choice is remembered when the project is opened again
  await openFromList(page, folder);
  await expect(page.getByRole("button", { name: "Node view" })).toHaveAttribute("aria-pressed", "true");
});

test("node view: switching back restores the bars", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Short", "1d");
  await addDependency(page, "Release", "Long", "5d");
  await page.getByRole("button", { name: "Node view" }).click();
  await page.getByRole("button", { name: "Time line view" }).click();
  const [s, l] = [await box(page, "Short"), await box(page, "Long")];
  expect(l.width / s.width).toBeCloseTo(5, 0);
  await expect(bar(page, "Short")).toHaveAttribute("data-view", "timeline");
});
