import { expect, test } from "playwright/test";
import { bar, newProject } from "./helpers.ts";

const colour = (page: import("playwright/test").Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

// Slice S11 acceptance: four styles, switchable at any time, remembered between visits.
test("S11: switch between four styles and keep the choice", async ({ page }) => {
  await page.goto("/");
  const picker = page.getByLabel("Style");
  await expect(picker.locator("option")).toHaveText(["Light", "Dark", "High contrast", "Blueprint"]);

  const seen = new Set<string>();
  for (const name of ["Light", "Dark", "High contrast", "Blueprint"]) {
    await picker.selectOption({ label: name });
    seen.add(await colour(page));
  }
  expect(seen.size).toBeGreaterThanOrEqual(3); // Light and High contrast may share a white page
  await expect(page.locator("html")).toHaveAttribute("data-theme", "blueprint");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "blueprint");
  await expect(page.getByLabel("Style")).toHaveValue("blueprint");
});

test("S11: a project looks right in every style, and selecting a node still works", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  for (const name of ["Dark", "High contrast", "Blueprint", "Light"]) {
    await page.getByLabel("Style").selectOption({ label: name });
    await expect(bar(page, "Release").getByTestId("completion")).toBeVisible();
    await bar(page, "Release").getByRole("button", { name: "Release", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Details of Release" })).toBeVisible();
    await page.getByRole("button", { name: "Close details" }).click();
  }
});

test("S11: follows the system until a style is chosen", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await context.close();
});
