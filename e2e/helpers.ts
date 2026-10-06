import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page } from "playwright/test";

/** Create a project through the API (the New project form no longer asks for a start or work time). */
export async function createProjectViaApi(
  page: Page,
  opts: { storage: { kind: string; path: string }; name?: string; start: string; root: string; work: string },
) {
  await page.goto("/");
  const token = await page.locator('meta[name="dep-tracker-token"]').getAttribute("content");
  const res = await page.request.post("/api/projects", {
    headers: { "x-dep-tracker-token": token ?? "" },
    data: { storage: opts.storage, name: opts.name ?? "Release plan", start: new Date(opts.start).toISOString(), root: { title: opts.root, workTime: opts.work } },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** On the Open tab: reveal the manual form if there are no known projects yet. */
export async function showOpenForm(page: Page) {
  const reveal = page.getByRole("button", { name: "Open one from a specific location…" });
  await reveal.or(page.getByLabel("Store")).first().waitFor();
  if (await reveal.isVisible()) await reveal.click();
}

/** Open a known project by picking it in the "Your projects" list. */
export async function openFromList(page: Page, location: string) {
  await page.goto("/");
  const list = page.getByLabel("Your projects");
  const option = list.locator("option", { hasText: location });
  await expect(option).toHaveCount(1);
  await list.selectOption({ label: (await option.textContent())! });
  await page.getByRole("button", { name: "Open", exact: true }).click();
}

/** Create a CSV project (with a fixed start, so dates are predictable) and open it; returns its folder. */
export async function newProject(page: Page, opts: { name?: string; start: string; root: string; work: string }) {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-e2e-")), "plan");
  await createProjectViaApi(page, { storage: { kind: "csv", path: folder }, ...opts });
  await openFromList(page, folder);
  await expect(page.getByRole("heading", { name: opts.name ?? "Release plan" })).toBeVisible();
  return folder;
}

/** The node's bar on the timeline. */
export const bar = (page: Page, title: string) => page.getByRole("article", { name: title, exact: true });

/** Select a node and return its details panel. */
export async function details(page: Page, title: string) {
  const panel = page.getByRole("complementary", { name: `Details of ${title}` });
  if (!(await panel.isVisible())) await bar(page, title).getByRole("button", { name: title, exact: true }).click();
  await expect(panel).toBeVisible();
  return panel;
}

export async function addDependency(page: Page, of: string, title: string, work: string) {
  const panel = await details(page, of);
  await panel.getByRole("button", { name: "Add dependency" }).click();
  const form = page.getByRole("form", { name: `New dependency of ${of}` });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Work time").fill(work);
  await form.getByRole("button", { name: "Add" }).click();
  await expect(bar(page, title)).toBeVisible();
}
