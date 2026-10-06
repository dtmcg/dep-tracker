import { mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "playwright/test";
import { addDependency, bar, details } from "./helpers.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const vaultFolder = async () => path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-vault-")), "Release plan");

async function newObsidianProject(page: Page, folder: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: "New project" }).click();
  await page.getByLabel("Store").selectOption("Obsidian vault folder");
  await page.getByLabel("Vault folder").fill(folder);
  await page.getByLabel("Project name").fill("Release plan");
  await page.getByLabel("Success criteria").fill("Release");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Release plan" })).toBeVisible();
}

// Slice S8 acceptance: the conformance suite passes (unit tests); dependencies
// appear as wikilinks; renaming a note in Obsidian keeps its edges; note body
// text survives a save.
test.describe("S8: Obsidian vault folders", () => {
  test("dependencies are written as wikilinks between task notes", async ({ page }) => {
    const folder = await vaultFolder();
    await newObsidianProject(page, folder);
    await addDependency(page, "Release", "Payments", "3d");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
    expect((await readdir(folder)).sort()).toEqual(expect.arrayContaining(["Payments.md", "Release.md", "Release plan (project).md"]));
    expect(await readFile(path.join(folder, "Release.md"), "utf8")).toContain('depends_on:\n  - "[[Payments]]"');
  });

  test("a note renamed in Obsidian keeps its edges, and the app picks up the change", async ({ page }) => {
    const folder = await vaultFolder();
    await newObsidianProject(page, folder);
    await addDependency(page, "Release", "Payments", "3d");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");

    // What Obsidian does on rename: move the file and update links to it
    await rename(path.join(folder, "Payments.md"), path.join(folder, "Payments integration.md"));
    const release = path.join(folder, "Release.md");
    await writeFile(release, (await readFile(release, "utf8")).replace("[[Payments]]", "[[Payments integration]]"));

    await expect(bar(page, "Payments integration")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-edge-dependency="Payments integration"][data-edge-dependent="Release"]')).toHaveCount(1);
    await expect(bar(page, "Release").getByTestId("completion")).toHaveAttribute("datetime", /.+/);
  });

  test("note body text and the user's own frontmatter survive edits in the app", async ({ page }) => {
    const folder = await vaultFolder();
    await newObsidianProject(page, folder);
    await addDependency(page, "Release", "Payments", "3d");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
    const payments = path.join(folder, "Payments.md");
    await writeFile(payments, (await readFile(payments, "utf8")).replace("---\n", "---\nstatus: in-progress\n") + "Notes from the vendor call.\n");
    await expect(page.getByRole("note")).toContainText("changed on disk", { timeout: 10_000 });

    const panel = await details(page, "Payments");
    await panel.getByRole("button", { name: "Edit" }).click();
    await panel.getByLabel("Work time").fill("1w");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");

    const text = await readFile(payments, "utf8");
    expect(text).toMatch(/^work_time: 1w$/m);
    expect(text).toMatch(/^status: in-progress$/m);
    expect(text).toContain("Notes from the vendor call.");
  });

  test("import a CSV project into a vault folder", async ({ page }) => {
    const folder = await vaultFolder();
    await page.goto("/");
    await page.getByRole("tab", { name: "Import" }).click();
    await page.getByLabel("From location").fill(path.resolve(here, "../fixtures/sample-project"));
    await page.getByLabel("To store").selectOption("Obsidian vault folder");
    await page.getByLabel("To location").fill(folder);
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByRole("heading", { name: "Mobile relaunch" })).toBeVisible();
    expect(await readdir(folder)).toEqual(expect.arrayContaining(["Public beta live.md", "Mobile relaunch (project).md"]));
    expect(await readFile(path.join(folder, "Public beta live.md"), "utf8")).toContain("  - team/web");
  });
});
