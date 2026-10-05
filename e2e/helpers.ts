import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page } from "playwright/test";

/** Create a CSV project from the start screen; returns its folder. */
export async function newProject(page: Page, opts: { name?: string; start: string; root: string; work: string }) {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-e2e-")), "plan");
  await page.goto("/");
  await page.getByRole("tab", { name: "New project" }).click();
  await page.getByLabel("Folder").fill(folder);
  await page.getByLabel("Project name").fill(opts.name ?? "Release plan");
  await page.getByLabel("Start").fill(opts.start);
  await page.getByLabel("Success criteria").fill(opts.root);
  await page.getByLabel("Work time").fill(opts.work);
  await page.getByRole("button", { name: "Create project" }).click();
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
