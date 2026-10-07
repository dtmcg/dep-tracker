import { expect, test } from "playwright/test";
import { addDependency, bar, newProject, openFromList } from "./helpers.ts";

const box = async (page: import("playwright/test").Page, title: string) => (await bar(page, title).getByTestId("bar").boundingBox())!;

// In node view the time scale can be switched off: boxes then sit in evenly spaced columns by dependency depth.
test("node view: the time scale toggle evens out the spacing, only in node view, and is remembered", async ({ page }) => {
  const folder = await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Quick", "1h");
  await addDependency(page, "Release", "Slow", "30d");
  await page.getByRole("button", { name: "Close details" }).click();

  // Not offered in the time line view
  await expect(page.getByLabel("Time scale")).toHaveCount(0);

  await page.getByRole("button", { name: "Node view" }).click();
  const toggle = page.getByLabel("Time scale");
  await expect(toggle).toBeChecked();
  const [q0, s0] = [await box(page, "Quick"), await box(page, "Slow")];
  expect(s0.x - q0.x).toBeGreaterThan(300); // 30 days apart on the time axis

  await toggle.uncheck();
  const [q, s, r] = [await box(page, "Quick"), await box(page, "Slow"), await box(page, "Release")];
  expect(Math.abs(q.x - s.x)).toBeLessThan(1); // both dependencies are one step from the root
  expect(r.x).toBeGreaterThan(q.x + q.width); // dependent to the right, with room for the connector
  await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
  await expect(page.getByTestId("today-marker")).toHaveCount(0);
  await expect(page.locator(".gantt-axis .tick")).toHaveCount(0);
  await expect(bar(page, "Quick").getByTestId("completion")).toBeVisible();

  // Remembered, and the time line view is unaffected
  await openFromList(page, folder);
  await expect(page.getByLabel("Time scale")).not.toBeChecked();
  await page.getByRole("button", { name: "Time line view" }).click();
  await expect(page.getByLabel("Time scale")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await page.getByRole("button", { name: "Node view" }).click();
  await page.getByLabel("Time scale").check();
  const [q2, s2] = [await box(page, "Quick"), await box(page, "Slow")];
  expect(s2.x - q2.x).toBeGreaterThan(300);
});
