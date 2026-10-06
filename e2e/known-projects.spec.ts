import { expect, test } from "playwright/test";
import { newProject } from "./helpers.ts";

// Projects created here show up in a drop-down on the Open tab, so nobody has to remember folders.
test("a created project can be reopened from the list of your projects", async ({ page }) => {
  const name = `Remembered ${Date.now()}`;
  const folder = await newProject(page, { name, start: "2026-11-02T09:00", root: "Ship it", work: "2d" });
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const list = page.getByLabel("Your projects");
  await expect(list.locator("option", { hasText: name })).toHaveCount(1);
  const label = await list.locator("option", { hasText: name }).textContent();
  await list.selectOption({ label: label! });
  await expect(page.getByLabel("Project folder")).toHaveValue(folder);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("a project can be removed from the list without deleting it", async ({ page }) => {
  const name = `Forgettable ${Date.now()}`;
  await newProject(page, { name, start: "2026-11-02T09:00", root: "Ship it", work: "2d" });
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const list = page.getByLabel("Your projects");
  const label = await list.locator("option", { hasText: name }).textContent();
  await list.selectOption({ label: label! });
  await page.getByRole("button", { name: "Remove from list" }).click();
  await expect(list.locator("option", { hasText: name })).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel("Your projects").locator("option", { hasText: name })).toHaveCount(0);
});
