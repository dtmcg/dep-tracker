import { expect, type Locator, type Page, test } from "playwright/test";
import { addDependency, bar, details, newProject } from "./helpers.ts";

const box = async (l: Locator) => (await l.boundingBox())!;
const barBox = (page: Page, title: string) => box(bar(page, title).getByTestId("bar"));

// Slice S3 acceptance: bars span start to completion; edges run dependency to
// dependent; zoom, pan, fit and the today marker work; layout is deterministic.
test.describe("S3: graph-based Gantt", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"));
    await newProject(page, { start: "2026-11-02T09:00", root: "Release", work: "2d" });
    await addDependency(page, "Release", "Docs", "2d");
    await addDependency(page, "Release", "Payments", "1w");
  });

  test("bars span start to completion on one time scale", async ({ page }) => {
    const docs = await barBox(page, "Docs");
    const payments = await barBox(page, "Payments");
    const release = await barBox(page, "Release");
    // 1w vs 2d: widths in proportion 7:2, both starting at the project start
    expect(payments.width / docs.width).toBeCloseTo(3.5, 1);
    expect(Math.abs(payments.x - docs.x)).toBeLessThan(1);
    // The root starts when its latest dependency completes
    expect(Math.abs(release.x - (payments.x + payments.width))).toBeLessThan(1.5);
    // Dependencies sit above their dependent; the root is last
    expect(release.y).toBeGreaterThan(payments.y);
    expect(release.y).toBeGreaterThan(docs.y);
  });

  test("edges run from each dependency's end to its dependent's start", async ({ page }) => {
    const edges = page.locator("[data-edge]");
    await expect(edges).toHaveCount(2);
    // The path's own start and end points, in page coordinates
    const [start, end] = await page
      .locator('[data-edge-dependency="Payments"][data-edge-dependent="Release"]')
      .evaluate((el) => {
        const path = el as SVGPathElement;
        const m = path.getScreenCTM()!;
        const at = (len: number) => {
          const p = path.getPointAtLength(len);
          return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
        };
        return [at(0), at(path.getTotalLength())];
      });
    const payments = await barBox(page, "Payments");
    const release = await barBox(page, "Release");
    // Starts at the end of the dependency (from under it when the bars touch) and ends at the dependent's start
    expect(start.x).toBeGreaterThan(payments.x + payments.width - 12);
    expect(start.x).toBeLessThanOrEqual(payments.x + payments.width + 1);
    expect(Math.abs(end.x - release.x)).toBeLessThan(1);
    expect(Math.abs(end.y - (release.y + release.height / 2))).toBeLessThan(1);
  });

  test("zoom in, zoom out and fit change the scale", async ({ page }) => {
    const before = (await barBox(page, "Payments")).width;
    await page.getByRole("button", { name: "Fit" }).click();
    const fitted = (await barBox(page, "Payments")).width;
    const zoom = page.getByLabel("Zoom level");
    await zoom.selectOption("Days");
    const days = (await barBox(page, "Payments")).width;
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoom).toHaveValue("Hours");
    const hours = (await barBox(page, "Payments")).width;
    expect(hours / days).toBeCloseTo(10, 0);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(zoom).toHaveValue("Weeks");
    // Fit makes the whole plan visible without scrolling
    await page.getByRole("button", { name: "Fit" }).click();
    const timeline = page.getByRole("group", { name: "Timeline" });
    const { scrollWidth, clientWidth } = await timeline.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    expect(fitted).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });

  test("the today marker sits at the current time", async ({ page }) => {
    const marker = page.getByTestId("today-marker");
    await expect(marker).toBeVisible();
    const docs = await barBox(page, "Docs"); // 2 Nov 09:00 → 4 Nov 09:00; today is 3 Nov 12:00
    const x = (await box(marker)).x;
    expect(x).toBeGreaterThan(docs.x);
    expect(x).toBeLessThan(docs.x + docs.width);
  });

  test("dragging the background pans the timeline", async ({ page }) => {
    await page.getByLabel("Zoom level").selectOption("Hours");
    const timeline = page.getByRole("group", { name: "Timeline" });
    const start = await timeline.evaluate((el) => el.scrollLeft);
    const area = await box(timeline);
    await page.mouse.move(area.x + area.width - 40, area.y + area.height - 20);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width - 340, area.y + area.height - 20, { steps: 5 });
    await page.mouse.up();
    expect(await timeline.evaluate((el) => el.scrollLeft)).toBeGreaterThan(start + 200);
  });

  test("connect existing nodes from the details panel, and remove the dependency again", async ({ page }) => {
    const panel = await details(page, "Payments");
    await panel.getByLabel("Add existing dependency").selectOption({ label: "Docs" });
    await panel.getByRole("button", { name: "Connect" }).click();
    await expect(page.locator('[data-edge-dependency="Docs"][data-edge-dependent="Payments"]')).toHaveCount(1);
    const docs = await barBox(page, "Docs");
    expect(Math.abs((await barBox(page, "Payments")).x - (docs.x + docs.width))).toBeLessThan(1.5);

    await panel.getByRole("button", { name: "Remove dependency on Docs" }).click();
    await expect(page.locator('[data-edge-dependency="Docs"][data-edge-dependent="Payments"]')).toHaveCount(0);
  });

  test("connect existing nodes by dragging from one bar's handle to another bar (FR-10)", async ({ page }) => {
    const connector = bar(page, "Docs").getByTestId("connector");
    await connector.scrollIntoViewIfNeeded();
    await bar(page, "Docs").hover();
    const handle = await box(connector);
    const target = await barBox(page, "Payments");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    // Drop on a visible part of the Payments bar (it runs 7 days from the same start as Docs)
    await page.mouse.move(Math.max(target.x, handle.x - 120), target.y + target.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('[data-edge-dependency="Docs"][data-edge-dependent="Payments"]')).toHaveCount(1);
  });

  test("clicking a bar anywhere, including its connector handle, selects the node", async ({ page }) => {
    await page.getByRole("button", { name: "Close details" }).click();
    const connector = bar(page, "Docs").getByTestId("connector");
    await connector.scrollIntoViewIfNeeded();
    await bar(page, "Docs").hover();
    const handle = await box(connector);
    await page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await expect(page.getByRole("complementary", { name: "Details of Docs" })).toBeVisible();
  });
});
