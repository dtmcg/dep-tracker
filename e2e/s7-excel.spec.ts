import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "playwright/test";
import { readWorkbook } from "../packages/xlsx/src/index.ts";
import { addDependency, bar } from "./helpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = async (name: string) => path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-e2e-")), name);
const sheets = async (file: string) => readWorkbook(await readFile(file)).sheets;

// Slice S7 acceptance: the conformance suite passes (unit tests); a workbook
// edited by hand opens correctly; import from CSV to Excel produces the
// documented sheet layout; extra columns survive a save. Plus FR-27 export.
test.describe("S7: Excel workbooks", () => {
  test("create a project in a new Excel workbook and edit it", async ({ page }) => {
    const file = await tmp("plan.xlsx");
    await page.goto("/");
    await page.getByRole("tab", { name: "New project" }).click();
    await page.getByLabel("Store").selectOption("Excel workbook");
    await page.getByLabel("Workbook file").fill(file);
    await page.getByLabel("Project name").fill("Spreadsheet plan");
    await page.getByLabel("Start").fill("2026-11-02T09:00");
    await page.getByLabel("Success criteria").fill("Release");
    await page.getByLabel("Work time").fill("2d");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: "Spreadsheet plan" })).toBeVisible();

    await addDependency(page, "Release", "Payments", "3d");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
    const tasks = (await sheets(file)).find((s) => s.name === "Tasks")!.rows;
    const release = tasks.find((r) => r[1] === "Release")!;
    expect(release[4]).toBe("Payments");
  });

  test("import a CSV project into Excel with the documented layout", async ({ page }) => {
    const file = await tmp("imported.xlsx");
    await page.goto("/");
    await page.getByRole("tab", { name: "Import" }).click();
    await page.getByLabel("From store").selectOption("CSV folder");
    await page.getByLabel("From location").fill(path.resolve(here, "../fixtures/sample-project"));
    await page.getByLabel("To store").selectOption("Excel workbook");
    await page.getByLabel("To location").fill(file);
    await page.getByRole("button", { name: "Import" }).click();

    await expect(page.getByRole("heading", { name: "Mobile relaunch" })).toBeVisible();
    await expect(bar(page, "Public beta live").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-04T09:00:00.000Z");
    const wb = await sheets(file);
    expect(wb.map((s) => s.name)).toEqual(["Project", "Tasks", "Labels"]);
    expect(wb[1]!.rows[0]).toEqual(["ID", "Title", "Work time", "Not before", "Depends on", "Labels", "Description", "Links", "Starts", "Completes"]);
  });

  test("open a workbook written by hand; its extra columns and sheets survive a save", async ({ page }) => {
    const file = await tmp("hand.xlsx");
    await copyFile(path.resolve(here, "../packages/adapter-excel/fixtures/hand-edited.xlsx"), file);
    await page.goto("/");
    await page.getByLabel("Store").selectOption("Excel workbook");
    await page.getByLabel("Workbook file").fill(file);
    await page.getByRole("button", { name: "Open" }).click();

    await expect(page.getByRole("heading", { name: "Hand-made plan" })).toBeVisible();
    await expect(bar(page, "Launch")).toHaveAttribute("data-root", "true");
    await expect(page.locator('[data-edge-dependency="Design"][data-edge-dependent="Docs"]')).toHaveCount(1);

    await addDependency(page, "Docs", "Proofread", "1d");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
    const wb = await sheets(file);
    expect(wb.map((s) => s.name)).toContain("Notes");
    const tasks = wb.find((s) => s.name === "Tasks")!.rows;
    const owner = tasks[0]!.indexOf("Owner");
    expect(owner).toBeGreaterThan(0);
    expect(tasks.find((r) => r[1] === "Build")![owner]).toBe("Brian");
    expect(tasks.find((r) => r[1] === "Proofread")).toBeTruthy();
  });

  test("export any open project to CSV (FR-27)", async ({ page }) => {
    const file = await tmp("hand.xlsx");
    await copyFile(path.resolve(here, "../packages/adapter-excel/fixtures/hand-edited.xlsx"), file);
    const folder = await tmp("exported");
    await page.goto("/");
    await page.getByLabel("Store").selectOption("Excel workbook");
    await page.getByLabel("Workbook file").fill(file);
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.getByRole("heading", { name: "Hand-made plan" })).toBeVisible();

    await page.getByRole("button", { name: "Export to CSV" }).click();
    await page.getByLabel("CSV folder").fill(folder);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("note")).toContainText("Exported");
    expect(await readFile(path.join(folder, "nodes.csv"), "utf8")).toContain("Design,2d");
  });
});
