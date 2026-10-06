import { expect, test } from "playwright/test";
import { addDependency, bar, openFromList, showOpenForm } from "./helpers.ts";

const GOOGLE = `http://127.0.0.1:${process.env.E2E_GOOGLE_PORT ?? 4319}`;
const admin = async (path: string, init?: RequestInit) => (await fetch(`${GOOGLE}/__admin${path}`, init)).json();
const blankSpreadsheet = async (timeZone = "Europe/Dublin") =>
  ((await admin("/spreadsheets", { method: "POST", body: JSON.stringify({ title: "Plan", timeZone }) })) as { id: string }).id;
const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`;

// Slice S9 acceptance: the conformance suite passes against a stand-in for the
// Sheets API (unit tests); OAuth via loopback; external edits detected within 10 s.
test.describe.serial("S9: Google Sheets", () => {
  test("sign in with Google through the loopback redirect", async ({ page, context }) => {
    await page.goto("/");
    await showOpenForm(page);
    await page.getByLabel("Store").selectOption("Google Sheet");
    const connect = page.getByRole("button", { name: "Connect Google account" });
    await expect(connect).toBeVisible();
    const [popup] = await Promise.all([context.waitForEvent("page"), connect.click()]);
    await expect(popup.getByRole("heading", { name: "Signed in to Google" })).toBeVisible();
    await expect(page.getByText("Connected to Google")).toBeVisible({ timeout: 10_000 });
  });

  test("create a project in a blank Google Sheet, edit it, and pick up edits made in the browser", async ({ page }) => {
    const id = await blankSpreadsheet();
    await page.goto("/");
    await page.getByRole("tab", { name: "New project" }).click();
    await page.getByLabel("Store").selectOption("Google Sheet");
    await expect(page.getByText("Connected to Google")).toBeVisible();
    await page.getByLabel("Spreadsheet link").fill(sheetUrl(id));
    await page.getByLabel("Project name").fill("Sheet plan");
    await page.getByLabel("Success criteria").fill("Release");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: "Sheet plan" })).toBeVisible();

    await addDependency(page, "Release", "Payments", "3d");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
    const book = (await admin(`/spreadsheets/${id}`)) as { sheets: { title: string; grid: (string | number | null)[][] }[] };
    const tasks = book.sheets.find((s) => s.title === "Tasks")!.grid;
    expect(tasks.find((r) => r[1] === "Release")![4]).toBe("Payments");

    // Someone renames a task in the browser; the app shows it within 10 seconds
    const row = tasks.findIndex((r) => r[1] === "Payments");
    const started = Date.now();
    await admin(`/spreadsheets/${id}/cell`, { method: "PUT", body: JSON.stringify({ sheet: "Tasks", row, col: 1, value: "Payments integration" }) });
    await expect(bar(page, "Payments integration")).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test("open a project sheet laid out by hand", async ({ page }) => {
    const { id } = (await admin("/spreadsheets", {
      method: "POST",
      body: JSON.stringify({
        title: "Hand",
        timeZone: "Europe/Dublin",
        sheets: [
          // Start typed as a date: Sheets stores it as a serial number (2 Nov 2026 09:00)
          { title: "Project", values: [["Field", "Value"], ["Name", "Typed by hand"], ["Start", 46328.375], ["Success criteria", "Ship"]] },
          { title: "Tasks", values: [["Title", "Work time", "Depends on"], ["Ship", "1d", "Build"], ["Build", "2d"]] },
        ],
      }),
    })) as { id: string };
    await page.goto("/");
    await showOpenForm(page);
    await page.getByLabel("Store").selectOption("Google Sheet");
    await page.getByLabel("Spreadsheet link").fill(sheetUrl(id));
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.getByRole("heading", { name: "Typed by hand" })).toBeVisible();
    // 2 Nov 09:00 in Dublin, plus 2d for Build, then 1d for Ship
    await expect(bar(page, "Ship").getByTestId("completion")).toHaveAttribute("datetime", "2026-11-05T09:00:00.000Z");
  });
});
