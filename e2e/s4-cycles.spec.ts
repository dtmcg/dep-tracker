import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "playwright/test";
import { addDependency, bar, details, newProject } from "./helpers.ts";

// Slice S4 acceptance: creating A→B→A marks both cyclic, marks their dependents
// blocked and leaves unrelated nodes dated; the banner lists the cycle; removing
// an edge restores the dates.
test("S4: a cycle is flagged, its dependents are blocked, and breaking it restores dates", async ({ page }) => {
  await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
  await addDependency(page, "Release", "Alpha", "1d");
  await addDependency(page, "Alpha", "Beta", "1d");
  await addDependency(page, "Release", "Copy", "1d"); // unrelated to the cycle

  // Close the loop: Beta depends on Alpha, which already depends on Beta
  const betaPanel = await details(page, "Beta");
  await betaPanel.getByLabel("Add existing dependency").selectOption({ label: "Alpha" });
  await betaPanel.getByRole("button", { name: "Connect" }).click();

  await expect(bar(page, "Alpha")).toHaveAttribute("data-state", "cyclic");
  await expect(bar(page, "Beta")).toHaveAttribute("data-state", "cyclic");
  await expect(bar(page, "Release")).toHaveAttribute("data-state", "blocked");
  await expect(bar(page, "Alpha").getByTestId("completion")).toHaveCount(0);
  await expect(bar(page, "Release").getByTestId("completion")).toHaveCount(0);
  await expect(bar(page, "Copy").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-03T09:00:00.000Z");
  await expect(page.locator('[data-edge-dependency="Alpha"][data-edge-dependent="Beta"]')).toHaveAttribute("data-cyclic", "true");

  const banner = page.getByRole("region", { name: "Dependency cycles" });
  await expect(banner).toContainText("Alpha → Beta → Alpha");
  // The banner links to the nodes in the cycle
  await banner.getByRole("button", { name: "Beta" }).click();
  const panel = page.getByRole("complementary", { name: "Details of Beta" });
  await expect(panel.getByTestId("detail-completion")).toHaveText("Not scheduled");
  await expect(panel).toContainText("cycle");

  // Break the cycle
  await panel.getByRole("button", { name: "Remove dependency on Alpha" }).click();
  await expect(banner).toHaveCount(0);
  await expect(bar(page, "Beta").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-03T09:00:00.000Z");
  await expect(bar(page, "Alpha").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-04T09:00:00.000Z");
  await expect(bar(page, "Release").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-06T09:00:00.000Z");
  await expect(bar(page, "Release")).toHaveAttribute("data-state", "ok");
});

test("S4: a node that depends on itself (from a hand-edited file) is flagged as a cycle", async ({ page }) => {
  const folder = await mkdtemp(path.join(tmpdir(), "dep-tracker-e2e-"));
  await writeFile(path.join(folder, "project.csv"), "id,name,start,root_id\np1,Loops,2026-11-02T09:00:00Z,r\n");
  await writeFile(path.join(folder, "nodes.csv"), "id,title,work_time\nr,Release,2d\nl,Loop,1d\n");
  await writeFile(path.join(folder, "edges.csv"), "dependent_id,dependency_id\nr,l\nl,l\n");
  await page.goto("/");
  await page.getByLabel("Project folder").fill(folder);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(bar(page, "Loop")).toHaveAttribute("data-state", "cyclic");
  await expect(bar(page, "Release")).toHaveAttribute("data-state", "blocked");
  await expect(page.getByRole("region", { name: "Dependency cycles" })).toContainText("Loop → Loop");
});
