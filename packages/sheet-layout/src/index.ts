import {
  type Dependency,
  type Project,
  type ProjectNode,
  schedule,
} from "@dep-tracker/domain";
import type { CellSpec, CellValue, SheetSpec, Workbook } from "@dep-tracker/xlsx";

/**
 * The spreadsheet layout shared by the Excel and Google Sheets adapters
 * (PRD "Store formats"):
 *   Project — Field / Value rows: ID, Name, Start, Success criteria
 *   Tasks   — one row per node; "Depends on" lists dependency titles separated
 *             by semicolons (a duplicate title is written "Title [id]");
 *             Starts and Completes are computed, greyed and never read back
 *   Labels  — Label / Colour (#rrggbb, the cell filled in that colour)
 */
export type { CellSpec, CellValue, SheetSpec, Workbook };

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}

export interface LayoutOptions {
  dateFromNumber?: (serial: number) => Date;
  /**
   * Titles → ids from the last time this sheet was read. A task renamed by
   * hand keeps its ID, so a "Depends on" cell still naming its old title
   * resolves through this; the next save rewrites it with the new title.
   */
  knownTitles?: Map<string, string>;
}

/**
 * Title → id for remembering between reads (see LayoutOptions.knownTitles).
 * Merges into what was known: old titles keep pointing at their ids until a
 * save has rewritten every cell that used them; newer titles win.
 */
export function titleIndex(project: Project, known?: Map<string, string>): Map<string, string> {
  return new Map([...(known ?? []), ...project.nodes.map((n): [string, string] => [n.title, n.id])]);
}
export const TASK_COLUMNS = [
  "ID",
  "Title",
  "Work time",
  "Not before",
  "Depends on",
  "Labels",
  "Description",
  "Links",
  "Starts",
  "Completes",
] as const;
const TASK_WIDTHS: Record<string, number> = {
  ID: 12,
  Title: 32,
  "Work time": 10,
  "Not before": 17,
  "Depends on": 30,
  Labels: 18,
  Description: 40,
  Links: 30,
  Starts: 17,
  Completes: 17,
};
const OWN = new Set(TASK_COLUMNS.map((c) => c.toLowerCase()));

const key = (v: CellValue | undefined) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const text = (v: CellValue | undefined): string =>
  v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v).trim();
const isEmptyRow = (row: CellValue[] | undefined) => !row || row.every((c) => c === null || c === undefined || text(c) === "");

function sheet(wb: Workbook, name: string) {
  return wb.sheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
}

function toIso(value: CellValue | undefined, where: string, options: LayoutOptions): string | undefined {
  if (value === null || value === undefined || text(value) === "") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && options.dateFromNumber) return options.dateFromNumber(value).toISOString();
  const ms = Date.parse(String(value));
  if (Number.isNaN(ms)) throw new LayoutError(`${where}: "${text(value)}" is not a date and time`);
  return new Date(ms).toISOString();
}

interface ParsedTasks {
  nodes: ProjectNode[];
  edges: Dependency[];
  /** Header as written, and each node's sheet row, so a save can keep the user's own columns. */
  header: string[];
  rowOf: Map<string, CellValue[]>;
}

/** Read the Tasks sheet. Rows without an ID get one ("row7") that the next save writes in. */
function parseTasks(rows: CellValue[][], options: LayoutOptions): ParsedTasks {
  const header = (rows[0] ?? []).map((h) => text(h));
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  for (const required of ["Title", "Work time"]) {
    if (col(required) < 0) throw new LayoutError(`Tasks sheet is missing the "${required}" column`);
  }
  const cell = (row: CellValue[], name: string) => (col(name) >= 0 ? row[col(name)] : undefined);

  const nodes: ProjectNode[] = [];
  const rowOf = new Map<string, CellValue[]>();
  const pending: { id: string; line: number; dependsOn: string }[] = [];
  const ids = new Set<string>();
  rows.forEach((row, r) => {
    if (r === 0 || isEmptyRow(row)) return;
    const line = r + 1;
    const title = text(cell(row, "Title"));
    if (!title) throw new LayoutError(`Tasks row ${line}: Title is empty`);
    let id = text(cell(row, "ID"));
    if (!id) {
      id = `row${line}`;
      while (ids.has(id)) id += "x";
    }
    if (ids.has(id)) throw new LayoutError(`Tasks row ${line}: duplicate ID "${id}"`);
    ids.add(id);
    const node: ProjectNode = {
      id,
      title,
      workTime: text(cell(row, "Work time")),
      labels: text(cell(row, "Labels"))
        .split(";")
        .map((l) => l.trim())
        .filter(Boolean),
      description: cell(row, "Description") === null || cell(row, "Description") === undefined ? "" : String(cell(row, "Description")),
      links: text(cell(row, "Links"))
        .split(/[\s;]+/)
        .filter(Boolean),
    };
    const notBefore = toIso(cell(row, "Not before"), `Tasks row ${line}, Not before`, options);
    if (notBefore) node.notBefore = notBefore;
    nodes.push(node);
    rowOf.set(id, row);
    pending.push({ id, line, dependsOn: text(cell(row, "Depends on")) });
  });

  const edges: Dependency[] = [];
  const seen = new Set<string>();
  for (const { id, line, dependsOn } of pending) {
    for (const token of dependsOn.split(";").map((t) => t.trim()).filter(Boolean)) {
      const tagged = /^(.*?)\s*\[([^\]]+)\]$/.exec(token);
      let dependencyId: string;
      if (tagged) {
        dependencyId = tagged[2]!.trim();
        if (!ids.has(dependencyId)) throw new LayoutError(`Tasks row ${line}: no task with ID "${dependencyId}" in Depends on`);
      } else {
        let matches = nodes.filter((n) => n.title === token);
        if (matches.length === 0) matches = nodes.filter((n) => n.title.toLowerCase() === token.toLowerCase());
        if (matches.length === 0) {
          const renamed = options.knownTitles?.get(token);
          matches = nodes.filter((n) => n.id === renamed);
        }
        if (matches.length === 0) throw new LayoutError(`Tasks row ${line}: no task called "${token}" in Depends on`);
        if (matches.length > 1) {
          throw new LayoutError(`Tasks row ${line}: several tasks are called "${token}"; write it with its ID, e.g. "${token} [${matches[0]!.id}]"`);
        }
        dependencyId = matches[0]!.id;
      }
      const edgeKey = `${id}>${dependencyId}`;
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      edges.push({ dependentId: id, dependencyId });
    }
  }
  return { nodes, edges, header, rowOf };
}

/**
 * Read a project from the Project / Tasks / Labels sheets. `fallbackName`
 * names the project when the sheet doesn't; `dateFromNumber` turns a number in
 * a date column into a date (spreadsheets store dates as serial numbers).
 */
export function projectFromSheets(wb: Workbook, fallbackName: string, options: LayoutOptions = {}): Project {
  const projectSheet = sheet(wb, "Project");
  const tasksSheet = sheet(wb, "Tasks");
  if (!projectSheet || !tasksSheet) throw new LayoutError(`${fallbackName} needs a "Project" sheet and a "Tasks" sheet`);

  const fields = new Map<string, CellValue>();
  for (const row of projectSheet.rows.slice(1)) if (row && key(row[0])) fields.set(key(row[0]), row[1] ?? null);

  const { nodes, edges } = parseTasks(tasksSheet.rows, options);
  const start = toIso(fields.get("start"), "Project sheet, Start", options);
  if (!start) throw new LayoutError(`Project sheet: Start is empty`);

  const rootId = text(fields.get("success criteria id"));
  const rootTitle = text(fields.get("success criteria"));
  let root = rootId ? nodes.find((n) => n.id === rootId) : undefined;
  if (!root && rootTitle) {
    const matches = nodes.filter((n) => n.title === rootTitle);
    if (matches.length > 1) throw new LayoutError(`Project sheet: several tasks are called "${rootTitle}"; set "Success criteria ID"`);
    root = matches[0];
  }
  if (!root) throw new LayoutError(`Project sheet: set "Success criteria" to the title of the task that defines success`);

  const labelColours: Record<string, string> = {};
  const labels = sheet(wb, "Labels");
  for (const [i, row] of (labels?.rows ?? []).entries()) {
    if (i === 0 || isEmptyRow(row)) continue;
    const label = text(row[0]);
    const colour = text(row[1]).toLowerCase();
    if (!label || !colour) continue;
    if (!/^#[0-9a-f]{6}$/.test(colour)) throw new LayoutError(`Labels row ${i + 1}: "${text(row[1])}" is not a #rrggbb colour`);
    labelColours[label] = colour;
  }

  return {
    id: text(fields.get("id")) || fallbackName,
    name: text(fields.get("name")) || fallbackName,
    start,
    rootId: root.id,
    nodes,
    edges,
    labelColours,
  };
}

/** The sheets for a project. With `base` (the sheets as they are now), the user's own Tasks columns and column order are kept. */
export function sheetsForProject(project: Project, base: Workbook | undefined, options: LayoutOptions = {}): SheetSpec[] {
  const head = (v: string): CellSpec => ({ value: v, style: "header" });
  const sched = schedule(project);
  const titleOf = new Map(project.nodes.map((n) => [n.id, n.title]));
  const titleCount = new Map<string, number>();
  for (const n of project.nodes) titleCount.set(n.title, (titleCount.get(n.title) ?? 0) + 1);
  const root = project.nodes.find((n) => n.id === project.rootId);

  const projectSheet: SheetSpec = {
    name: "Project",
    widths: [20, 44],
    rows: [
      [head("Field"), head("Value")],
      ["ID", project.id],
      ["Name", project.name],
      ["Start", { value: new Date(project.start), style: "date" }],
      ["Success criteria", root?.title ?? ""],
      ["Success criteria ID", { value: project.rootId, style: "computed" }],
    ],
  };

  // Keep the user's column order and their own columns; add any of ours that are missing.
  const previous = base && sheet(base, "Tasks") ? parseTasks(sheet(base, "Tasks")!.rows, options) : undefined;
  const header = previous?.header.length ? [...previous.header] : [...TASK_COLUMNS];
  for (const c of TASK_COLUMNS) if (!header.some((h) => h.toLowerCase() === c.toLowerCase())) header.push(c);
  const canonical = header.map((h) => TASK_COLUMNS.find((c) => c.toLowerCase() === h.toLowerCase()) ?? h);

  const taskRows = project.nodes.map((node): (CellValue | CellSpec)[] => {
    const times = sched.nodes[node.id];
    const dependsOn = project.edges
      .filter((e) => e.dependentId === node.id)
      .map((e) => {
        const title = titleOf.get(e.dependencyId) ?? e.dependencyId;
        return (titleCount.get(title) ?? 0) > 1 ? `${title} [${e.dependencyId}]` : title;
      })
      .join("; ");
    const ours: Record<string, CellValue | CellSpec> = {
      ID: node.id,
      Title: node.title,
      "Work time": node.workTime,
      "Not before": node.notBefore ? { value: new Date(node.notBefore), style: "date" } : null,
      "Depends on": dependsOn,
      Labels: node.labels.join("; "),
      Description: node.description,
      Links: node.links.join("\n"),
      Starts: { value: times ? new Date(times.start) : null, style: "computedDate" },
      Completes: { value: times ? new Date(times.completion) : (sched.errors[node.id] ?? null), style: "computedDate" },
    };
    const old = previous?.rowOf.get(node.id);
    return canonical.map((c, i) => (OWN.has(c.toLowerCase()) ? (ours[c] ?? null) : (old?.[i] ?? null)));
  });

  const tasksSheet: SheetSpec = {
    name: "Tasks",
    freezeHeader: true,
    widths: canonical.map((c) => TASK_WIDTHS[c] ?? 16),
    rows: [canonical.map((c, i) => head(header[i] ?? c)), ...taskRows],
  };

  const labelsSheet: SheetSpec = {
    name: "Labels",
    widths: [24, 12],
    rows: [
      [head("Label"), head("Colour")],
      ...Object.entries(project.labelColours ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, colour]): (CellValue | CellSpec)[] => [label, { value: colour, style: `fill:${colour}` as `fill:#${string}` }]),
    ],
  };
  return [projectSheet, tasksSheet, labelsSheet];
}

