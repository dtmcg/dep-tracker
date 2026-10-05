import { expect, type Page, test } from "playwright/test";
import { addDependency, bar, newProject } from "./helpers.ts";

const edge = (page: Page, dependency: string, dependent: string) =>
  page.locator(`[data-edge-dependency="${dependency}"][data-edge-dependent="${dependent}"]`);
const style = (page: Page, dependency: string, dependent: string, prop: string) =>
  edge(page, dependency, dependent).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

// Slice S5 acceptance: selecting a node highlights its dependencies and all
// dependents in distinct colours and dims the rest; dashes flow toward the
// dependent at a speed scaled to work time; reduced motion gives static dashes.
test.describe("S5: selection and animation", () => {
  test.beforeEach(async ({ page }) => {
    await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
    await addDependency(page, "Release", "Payments", "1w");
    await addDependency(page, "Payments", "Contract", "1d");
    await addDependency(page, "Release", "Docs", "2d");
    await page.getByRole("button", { name: "Close details" }).click();
    await page.getByRole("button", { name: "Fit" }).click();
  });

  test("highlights dependencies and dependents in distinct colours and dims the rest", async ({ page }) => {
    await bar(page, "Payments").getByRole("button", { name: "Payments", exact: true }).click();

    await expect(bar(page, "Payments")).toHaveAttribute("data-highlight", "selected");
    await expect(bar(page, "Contract")).toHaveAttribute("data-highlight", "upstream");
    await expect(bar(page, "Release")).toHaveAttribute("data-highlight", "downstream");
    await expect(bar(page, "Docs")).toHaveAttribute("data-highlight", "dimmed");
    await expect(edge(page, "Contract", "Payments")).toHaveAttribute("data-highlight", "upstream");
    await expect(edge(page, "Payments", "Release")).toHaveAttribute("data-highlight", "downstream");
    await expect(edge(page, "Docs", "Release")).toHaveAttribute("data-highlight", "dimmed");

    expect(await style(page, "Contract", "Payments", "stroke")).not.toEqual(await style(page, "Payments", "Release", "stroke"));
    const dimmed = await bar(page, "Docs").evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(dimmed).toBeLessThan(0.6);

    // Deselecting clears the highlight
    await page.keyboard.press("Escape");
    await expect(bar(page, "Docs")).not.toHaveAttribute("data-highlight", "dimmed");
  });

  test("dashes flow toward the dependent, slower for longer work", async ({ page }) => {
    await bar(page, "Payments").getByRole("button", { name: "Payments", exact: true }).click();
    expect(await style(page, "Payments", "Release", "animation-name")).toBe("dash-flow");
    expect(await style(page, "Payments", "Release", "stroke-dasharray")).not.toBe("none");
    const seconds = (v: string) => parseFloat(v);
    const oneWeek = seconds(await style(page, "Payments", "Release", "animation-duration"));
    const oneDay = seconds(await style(page, "Contract", "Payments", "animation-duration"));
    expect(oneWeek).toBeGreaterThan(oneDay);
    // Unselected chains do not animate
    expect(await style(page, "Docs", "Release", "animation-name")).toBe("none");
  });

  test("reduced motion shows static dashes", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await bar(page, "Payments").getByRole("button", { name: "Payments", exact: true }).click();
    expect(await style(page, "Payments", "Release", "animation-name")).toBe("none");
    expect(await style(page, "Payments", "Release", "stroke-dasharray")).not.toBe("none");
  });

  test("emphasises the critical chain into the selected node (FR-16)", async ({ page }) => {
    await bar(page, "Release").getByRole("button", { name: "Release", exact: true }).click();
    // Payments (1w after Contract) finishes after Docs, so it drives Release
    await expect(edge(page, "Payments", "Release")).toHaveAttribute("data-critical", "true");
    await expect(edge(page, "Contract", "Payments")).toHaveAttribute("data-critical", "true");
    await expect(edge(page, "Docs", "Release")).toHaveAttribute("data-critical", "false");
    const critical = parseFloat(await style(page, "Payments", "Release", "stroke-width"));
    const other = parseFloat(await style(page, "Docs", "Release", "stroke-width"));
    expect(critical).toBeGreaterThan(other);
  });
});
