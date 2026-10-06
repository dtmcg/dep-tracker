import { expect, test } from "playwright/test";
import { addDependency, bar, newProject } from "./helpers.ts";

const centreY = async (page: import("playwright/test").Page, title: string) => {
  const box = (await bar(page, title).boundingBox())!;
  return box.y + box.height / 2;
};
const ROW = 40;

// Adding a dependency re-balances the chart: the root stays roughly centred on its dependencies, and so does
// every node on its own.
test("the root and every node stay centred on their dependencies as dependencies are added", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  const checkRoot = async (deps: string[]) => {
    const ys = await Promise.all(deps.map((d) => centreY(page, d)));
    const root = await centreY(page, "Release");
    expect(Math.abs(root - (Math.min(...ys) + Math.max(...ys)) / 2)).toBeLessThanOrEqual(ROW);
  };

  await addDependency(page, "Release", "Design", "2d");
  await addDependency(page, "Release", "Build", "3d");
  await checkRoot(["Design", "Build"]);
  await addDependency(page, "Release", "Test", "1d");
  await addDependency(page, "Release", "Docs", "1d");
  await checkRoot(["Design", "Build", "Test", "Docs"]);

  // A sub-tree under Build centres Build on its own dependencies, and the root re-centres on the taller chart
  await addDependency(page, "Build", "API", "1d");
  await addDependency(page, "Build", "UI", "1d");
  await addDependency(page, "Build", "Data", "1d");
  const kids = await Promise.all(["API", "UI", "Data"].map((d) => centreY(page, d)));
  expect(Math.abs((await centreY(page, "Build")) - (Math.min(...kids) + Math.max(...kids)) / 2)).toBeLessThanOrEqual(ROW);
  await checkRoot(["Design", "Build", "Test", "Docs"]);

  const all = await Promise.all(["Design", "Build", "Test", "Docs", "API", "UI", "Data", "Release"].map((t) => centreY(page, t)));
  const root = await centreY(page, "Release");
  expect(Math.abs(root - (Math.min(...all) + Math.max(...all)) / 2)).toBeLessThanOrEqual(1.5 * ROW);
});
