import { expect, test } from "playwright/test";

// The start screen offers a default projects folder (…/Documents/pdm_projects, overridden here for tests).
test("new CSV projects default to their own folder under the projects folder", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "New project" }).click();
  const folder = page.getByLabel("Folder");
  await expect(folder).toHaveValue(/pdm_projects[\\/]$/);

  await page.getByLabel("Project name").fill("Mobile relaunch");
  await expect(folder).toHaveValue(/pdm_projects[\\/]Mobile relaunch$/);

  // Typing your own folder wins over the suggestion
  await folder.fill("/somewhere/else");
  await page.getByLabel("Project name").fill("Renamed");
  await expect(folder).toHaveValue("/somewhere/else");
});

test("the default folder works end to end: create with no folder typed, then reopen from the open tab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Default home");
  await page.getByLabel("Success criteria").fill("Done");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Default home" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByLabel("Project folder")).toHaveValue(/pdm_projects[\\/]$/);
  await page.getByLabel("Project folder").press("End");
  await page.getByLabel("Project folder").pressSequentially("Default home");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Default home" })).toBeVisible();
});
