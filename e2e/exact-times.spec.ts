import { expect, test } from "playwright/test";
import { addDependency, bar, newProject, openFromList } from "./helpers.ts";

// Dates show only the day unless "Exact times" is switched on. In node view each box also shows its earliest
// start and its work time, and is square.
test("exact times: off by default, togglable, remembered", async ({ page }) => {
  const folder = await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Short", "1d");
  await page.getByRole("button", { name: "Close details" }).click();

  const toggle = page.getByLabel("Exact times");
  await expect(toggle).not.toBeChecked();
  await expect(bar(page, "Short").getByTestId("completion")).toHaveText("Tue 3 Nov 2026");
  await toggle.check();
  await expect(bar(page, "Short").getByTestId("completion")).toHaveText("Tue 3 Nov 2026, 09:00");

  await openFromList(page, folder);
  await expect(page.getByLabel("Exact times")).toBeChecked();
  await page.getByLabel("Exact times").uncheck();
  await expect(bar(page, "Short").getByTestId("completion")).toHaveText("Tue 3 Nov 2026");
});

test("node view: square boxes showing start, work time and completion", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Short", "1d");
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "Node view" }).click();

  const short = bar(page, "Short");
  await expect(short.getByTestId("node-start")).toHaveText("2 Nov 2026");
  await expect(short.getByTestId("node-work")).toHaveText("1d");
  await expect(short.getByTestId("completion")).toHaveText("3 Nov 2026");
  await expect(bar(page, "Release").getByTestId("node-start")).toHaveText("3 Nov 2026");
  await expect(bar(page, "Release").getByTestId("node-work")).toHaveText("2d");

  for (const title of ["Short", "Release"]) {
    const b = (await bar(page, title).getByTestId("bar").boundingBox())!;
    expect(Math.abs(b.width - b.height)).toBeLessThan(2);
    // nothing spills out of the box
    const overflow = await bar(page, title).getByTestId("bar").evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeLessThanOrEqual(1);
  }

  await page.getByLabel("Exact times").check();
  await expect(short.getByTestId("node-start")).toHaveText("2 Nov 2026, 09:00");
  const b = await short.getByTestId("bar").evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(b).toBeLessThanOrEqual(1);
});
