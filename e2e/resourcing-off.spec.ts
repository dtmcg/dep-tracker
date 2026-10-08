import { expect, test } from "playwright/test";
import { newProject } from "./helpers.ts";

// The default backend is started without --resourcing: the feature is invisible and refused.
test("resourcing is off unless the backend is started with --resourcing", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await expect(page.getByRole("region", { name: "Resource pool" })).toHaveCount(0);
  const token = await page.locator('meta[name="dep-tracker-token"]').getAttribute("content");
  const config = await page.request.get("/api/config", { headers: { "x-dep-tracker-token": token ?? "" } });
  expect((await config.json()).resourcing).toBe(false);
});
