import { expect, test } from "playwright/test";
import { addDependency, bar, details, newProject } from "./helpers.ts";

// A node can be added without a work time. It stays on the chart with its link, but adds nothing to the
// dates of what depends on it until a work time is entered.
test("a dependency without a work time keeps its edge but doesn't move the dates", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Design", "3d");
  await expect(bar(page, "Release").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-07T09:00:00.000Z");

  const panel = await details(page, "Release");
  await panel.getByRole("button", { name: "Add dependency" }).click();
  const form = page.getByRole("form", { name: "New dependency of Release" });
  await form.getByLabel("Title").fill("Sketch");
  await expect(form.getByLabel("Work time")).not.toHaveAttribute("required", /.*/);
  await form.getByRole("button", { name: "Add" }).click();

  await expect(bar(page, "Sketch")).toHaveAttribute("data-unestimated", "true");
  await expect(bar(page, "Sketch")).toContainText("no work time");
  await expect(page.locator('[data-edge-dependency="Sketch"][data-edge-dependent="Release"]')).toHaveAttribute("data-unestimated", "true");
  await expect(bar(page, "Release").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-07T09:00:00.000Z");

  // Give it a work time and it counts
  const sketch = await details(page, "Sketch");
  await expect(sketch.getByTestId("detail-work")).toHaveText("Not set");
  await sketch.getByRole("button", { name: "Edit" }).click();
  await sketch.getByLabel("Work time").fill("5d");
  await sketch.getByRole("button", { name: "Save" }).click();
  await expect(bar(page, "Sketch")).not.toHaveAttribute("data-unestimated", "true");
  await expect(bar(page, "Release").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-09T09:00:00.000Z");
});
