import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "@dep-tracker/xlsx";
import { csvAdapter } from "@dep-tracker/adapter-csv";
import { ExcelAdapterError, excelAdapter, TASK_COLUMNS } from "./adapter.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const handEdited = path.resolve(here, "../fixtures/hand-edited.xlsx");
const sampleCsv = path.resolve(here, "../../../fixtures/sample-project");

async function copyOf(file: string): Promise<string> {
  const dest = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-xlsx-")), "plan.xlsx");
  await copyFile(file, dest);
  return dest;
}

describe("excelAdapter: a workbook written by hand in a spreadsheet app", () => {
  it("opens, matching dependencies by title and giving rows without an ID one", async () => {
    const { project } = await excelAdapter.load({ kind: "excel", path: handEdited });
    assert.equal(project.name, "Hand-made plan");
    assert.equal(project.start, new Date(2026, 10, 2, 9, 0).toISOString());
    const titles = project.nodes.map((n) => n.title);
    assert.deepEqual(titles, ["Launch", "Build", "Design", "Docs"]);
    const id = (title: string) => project.nodes.find((n) => n.title === title)!.id;
    assert.equal(project.rootId, id("Launch"));
    assert.ok(id("Design"), "rows with no ID get one");
    const edges = project.edges.map((e) => `${e.dependentId}>${e.dependencyId}`).sort();
    assert.deepEqual(edges, [`${id("Build")}>${id("Design")}`, `${id("Docs")}>${id("Design")}`, `${id("Launch")}>${id("Build")}`, `${id("Launch")}>${id("Docs")}`].sort());
    const build = project.nodes.find((n) => n.title === "Build")!;
    assert.equal(build.notBefore, new Date(2026, 10, 3, 9, 0).toISOString());
    assert.deepEqual(build.labels, ["team:web", "risk"]);
    assert.deepEqual(build.links, ["https://example.com/build"]);
    assert.deepEqual(project.labelColours, { risk: "#c62828" });
  });

  it("keeps the user's extra columns and sheets, and writes IDs for new rows, when saving", async () => {
    const file = await copyOf(handEdited);
    const { project, version } = await excelAdapter.load({ kind: "excel", path: file });
    const renamed = { ...project, nodes: project.nodes.map((n) => (n.title === "Docs" ? { ...n, title: "Docs site" } : n)) };
    await excelAdapter.save({ kind: "excel", path: file }, renamed, version);

    const wb = readWorkbook(await readFile(file));
    assert.deepEqual(wb.sheets.map((s) => s.name), ["Project", "Tasks", "Labels", "Notes"]);
    const tasks = wb.sheets[1]!.rows;
    const header = tasks[0]!;
    const owner = header.indexOf("Owner");
    assert.ok(owner >= 0, "Owner column kept");
    const row = (title: string) => tasks.find((r) => r[header.indexOf("Title")] === title)!;
    assert.equal(row("Build")[owner], "Brian");
    assert.equal(row("Design")[owner], "Ciara");
    assert.match(String(row("Design")[header.indexOf("ID")]), /\S/);
    assert.equal(row("Launch")[header.indexOf("Depends on")], "Build; Docs site");
    assert.equal(wb.sheets[3]!.rows[0]![0], "Meeting notes the app must not touch");

    const reloaded = await excelAdapter.load({ kind: "excel", path: file });
    assert.deepEqual(reloaded.project.edges.length, project.edges.length);
  });
});

describe("excelAdapter: documented layout (S7)", () => {
  it("imports a CSV project into the documented sheets and columns", async () => {
    const { project } = await csvAdapter.load({ kind: "csv", path: sampleCsv });
    const file = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-xlsx-")), "imported.xlsx");
    await excelAdapter.create({ kind: "excel", path: file }, project);
    const wb = readWorkbook(await readFile(file));
    assert.deepEqual(wb.sheets.map((s) => s.name), ["Project", "Tasks", "Labels"]);
    assert.deepEqual(wb.sheets[1]!.rows[0], [...TASK_COLUMNS]);
    assert.deepEqual(TASK_COLUMNS, ["ID", "Title", "Work time", "Not before", "Depends on", "Labels", "Description", "Links", "Starts", "Completes"]);
    const row = wb.sheets[1]!.rows[1]!;
    assert.equal(row[1], "Public beta live");
    // Computed columns are filled in for people reading the sheet
    assert.deepEqual(row[9], new Date(Date.parse("2026-11-04T09:00:00Z")));
    const projectSheet = Object.fromEntries(wb.sheets[0]!.rows.slice(1).map((r) => [r[0], r[1]]));
    assert.equal(projectSheet["Name"], "Mobile relaunch");
    assert.equal(projectSheet["Success criteria"], "Public beta live");
  });

  it("writes duplicate titles in Depends on with their ID so they stay unambiguous", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-xlsx-")), "dups.xlsx");
    await excelAdapter.create({ kind: "excel", path: file }, {
      id: "p", name: "Dups", start: "2026-11-02T09:00:00.000Z", rootId: "r",
      nodes: [
        { id: "r", title: "Root", workTime: "1d", labels: [], description: "", links: [] },
        { id: "a", title: "Same", workTime: "1d", labels: [], description: "", links: [] },
        { id: "b", title: "Same", workTime: "1d", labels: [], description: "", links: [] },
      ],
      edges: [{ dependentId: "r", dependencyId: "a" }, { dependentId: "r", dependencyId: "b" }],
    });
    const tasks = readWorkbook(await readFile(file)).sheets[1]!.rows;
    assert.equal(tasks[1]![4], "Same [a]; Same [b]");
    const { project } = await excelAdapter.load({ kind: "excel", path: file });
    assert.deepEqual(project.edges.map((e) => e.dependencyId).sort(), ["a", "b"]);
  });
});

describe("excelAdapter: errors name the sheet and row", () => {
  it("explains an unknown title in Depends on", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-xlsx-")), "bad.xlsx");
    const { writeWorkbook } = await import("@dep-tracker/xlsx");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, writeWorkbook([
      { name: "Project", rows: [["Field", "Value"], ["Name", "X"], ["Start", "2026-11-02T09:00:00Z"], ["Success criteria", "Root"]] },
      { name: "Tasks", rows: [["Title", "Work time", "Depends on"], ["Root", "1d", "Nowhere"]] },
    ]));
    await assert.rejects(excelAdapter.load({ kind: "excel", path: file }), (e: unknown) => e instanceof ExcelAdapterError && /Tasks row 2.*"Nowhere"/.test(e.message));
  });

  it("explains a missing workbook", async () => {
    await assert.rejects(excelAdapter.load({ kind: "excel", path: path.join(here, "nope.xlsx") }), /No workbook/);
  });
});

describe("excelAdapter: a task renamed in the spreadsheet app", () => {
  it("keeps the dependencies that still name it by its old title", async () => {
    const file = await copyOf(handEdited);
    await excelAdapter.load({ kind: "excel", path: file });
    const { writeWorkbook } = await import("@dep-tracker/xlsx");
    const { writeFile } = await import("node:fs/promises");
    const wb = readWorkbook(await readFile(file));
    const tasks = wb.sheets.find((s) => s.name === "Tasks")!;
    const row = tasks.rows.findIndex((r) => r[1] === "Build");
    tasks.rows[row]![1] = "Build v2"; // renamed; "Launch" still depends on "Build"
    // Keep date cells formatted as dates, as a spreadsheet app would
    const rows = tasks.rows.map((r) => (r ?? []).map((v) => (v instanceof Date ? { value: v, style: "date" as const } : v)));
    await writeFile(file, writeWorkbook([{ name: "Tasks", rows }], await readFile(file)));
    const { project } = await excelAdapter.load({ kind: "excel", path: file });
    const id = (t: string) => project.nodes.find((n) => n.title === t)!.id;
    assert.ok(project.edges.some((e) => e.dependentId === id("Launch") && e.dependencyId === id("Build v2")));
  });
});
