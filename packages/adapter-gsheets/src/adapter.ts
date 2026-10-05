import { createHash } from "node:crypto";
import { type LoadedProject, type Project, ProjectExistsError, type StorageAdapter, VersionConflictError } from "@dep-tracker/domain";
import { type CellValue, LayoutError, projectFromSheets, type SheetSpec, sheetsForProject, titleIndex, type Workbook } from "@dep-tracker/sheet-layout";
import { GoogleSheetsError, quoteSheet, type SheetsClient, type SheetValue, type SpreadsheetMeta } from "./client.ts";
import { dateToSerial, serialToDate } from "./timezone.ts";

export { GoogleSheetsError } from "./client.ts";

/**
 * Google Sheets store: a spreadsheet in the shared Project / Tasks / Labels
 * layout (@dep-tracker/sheet-layout), the same as the Excel workbook. Values
 * are written RAW, so text that looks like a formula stays text. Dates are
 * serial numbers in the spreadsheet's own time zone. The user's other sheets
 * and extra Tasks columns are left alone.
 */
export type GsheetsDescriptor = { kind: "gsheets"; path: string };

const OUR_SHEETS = ["Project", "Tasks", "Labels"];

/** The spreadsheet id from a sheet's link, or a bare id. */
export function spreadsheetId(location: string): string {
  const trimmed = location.trim();
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(trimmed);
  if (fromUrl) return fromUrl[1]!;
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  throw new GoogleSheetsError(`"${location}" is not a Google Sheets spreadsheet link`);
}

interface State {
  meta: SpreadsheetMeta;
  /** Our sheets that exist, as rows of cells (blank cells as null). */
  workbook: Workbook;
  version: string;
}

async function readState(client: SheetsClient, id: string): Promise<State> {
  const meta = await client.meta(id);
  const present = OUR_SHEETS.filter((t) => meta.sheets.some((s) => s.title === t));
  const values = await client.values(id, present);
  const workbook: Workbook = {
    sheets: present.map((name, i) => ({
      name,
      rows: (values[i] ?? []).map((row) => row.map((v): CellValue => (v === "" ? null : v))),
    })),
  };
  const version = createHash("sha256")
    .update(JSON.stringify({ sheets: meta.sheets.map((s) => s.title), values, timeZone: meta.timeZone }))
    .digest("hex")
    .slice(0, 16);
  return { meta, workbook, version };
}

const asError = (error: unknown) => (error instanceof LayoutError ? new GoogleSheetsError(error.message) : error);

function parse(state: State, knownTitles?: Map<string, string>): Project {
  try {
    return projectFromSheets(state.workbook, state.meta.title, {
      dateFromNumber: (s) => serialToDate(s, state.meta.timeZone),
      knownTitles,
    });
  } catch (error) {
    throw asError(error);
  }
}

const rgb = (hex: string) => {
  const n = (i: number) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000;
  return { red: n(1), green: n(3), blue: n(5) };
};
const GREY = { red: 0.941, green: 0.937, blue: 0.918 };
const HEADER = { red: 0.929, green: 0.922, blue: 0.894 };
const DATE_TIME = { type: "DATE_TIME", pattern: "yyyy-mm-dd hh:mm" };

/** Formatting for a cell style, as a Sheets CellFormat. */
function formatFor(style: string): object | null {
  if (style === "date") return { numberFormat: DATE_TIME };
  if (style === "computed") return { backgroundColor: GREY, textFormat: { italic: true, foregroundColor: { red: 0.42, green: 0.416, blue: 0.392 } } };
  if (style === "computedDate") {
    return { numberFormat: DATE_TIME, backgroundColor: GREY, textFormat: { italic: true, foregroundColor: { red: 0.42, green: 0.416, blue: 0.392 } } };
  }
  if (style.startsWith("fill:")) return { backgroundColor: rgb(style.slice(5)) };
  return null;
}

async function write(client: SheetsClient, id: string, state: State, specs: SheetSpec[], renameFirst: boolean): Promise<void> {
  const tz = state.meta.timeZone;

  // Make sure our sheets exist (a blank spreadsheet's only sheet becomes "Project").
  const setup: object[] = [];
  const titles = new Set(state.meta.sheets.map((s) => s.title));
  for (const spec of specs) {
    if (titles.has(spec.name)) continue;
    if (renameFirst && setup.length === 0 && state.meta.sheets.length === 1) {
      setup.push({ updateSheetProperties: { properties: { sheetId: state.meta.sheets[0]!.sheetId, title: spec.name }, fields: "title" } });
    } else {
      setup.push({ addSheet: { properties: { title: spec.name } } });
    }
  }
  if (setup.length) await client.batchUpdate(id, setup);
  const meta = setup.length ? await client.meta(id) : state.meta;
  const sheetIdOf = (title: string) => meta.sheets.find((s) => s.title === title)!.sheetId;

  // Values, padded with blanks over the old extent so rows and columns that went away are cleared.
  const data = specs.map((spec) => {
    const before = state.workbook.sheets.find((s) => s.name === spec.name)?.rows ?? [];
    const width = Math.max(...spec.rows.map((r) => r.length), ...before.map((r) => r.length), 1);
    const height = Math.max(spec.rows.length, before.length);
    const values: SheetValue[][] = Array.from({ length: height }, (_, r) =>
      Array.from({ length: width }, (_, c) => {
        const cell = spec.rows[r]?.[c];
        const value = cell !== null && typeof cell === "object" && !(cell instanceof Date) ? cell.value : cell;
        if (value === null || value === undefined) return "";
        if (value instanceof Date) return dateToSerial(value, tz);
        return value;
      }),
    );
    return { range: `${quoteSheet(spec.name)}!A1`, values };
  });
  await client.updateValues(id, data);

  // Formatting for people reading the sheet.
  const requests: object[] = [];
  for (const spec of specs) {
    const sheetId = sheetIdOf(spec.name);
    const width = Math.max(...spec.rows.map((r) => r.length), 1);
    if (spec.freezeHeader) {
      requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
    }
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: HEADER } },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    });
    // Group runs of the same style down each column into one request.
    for (let c = 0; c < width; c++) {
      let runStart = 1;
      let runStyle: string | undefined;
      const flush = (end: number) => {
        const format = runStyle ? formatFor(runStyle) : null;
        if (format && end > runStart) {
          requests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: runStart, endRowIndex: end, startColumnIndex: c, endColumnIndex: c + 1 },
              cell: { userEnteredFormat: format },
              fields: `userEnteredFormat(${Object.keys(format).join(",")})`,
            },
          });
        }
      };
      for (let r = 1; r <= spec.rows.length; r++) {
        const cell = spec.rows[r]?.[c];
        const style = cell !== null && typeof cell === "object" && !(cell instanceof Date) ? cell.style : undefined;
        if (r === spec.rows.length || style !== runStyle) {
          flush(r);
          runStart = r;
          runStyle = style;
        }
      }
    }
    spec.widths?.forEach((chars, c) =>
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: "COLUMNS", startIndex: c, endIndex: c + 1 },
          properties: { pixelSize: Math.round(chars * 7 + 16) },
          fields: "pixelSize",
        },
      }),
    );
  }
  if (requests.length) await client.batchUpdate(id, requests);
}

export function createGoogleSheetsAdapter(client: SheetsClient): StorageAdapter<GsheetsDescriptor> {
  // Titles → ids from the last read of each spreadsheet, so renames made in the browser keep their links.
  const knownTitles = new Map<string, Map<string, string>>();
  return {
    kind: "gsheets",

    async load(descriptor) {
      const id = spreadsheetId(descriptor.path);
      const state = await readState(client, id);
      const project = parse(state, knownTitles.get(id));
      knownTitles.set(id, titleIndex(project, knownTitles.get(id)));
      return { project, version: state.version } satisfies LoadedProject;
    },

    async version(descriptor) {
      return (await readState(client, spreadsheetId(descriptor.path))).version;
    },

    async create(descriptor, project) {
      const id = spreadsheetId(descriptor.path);
      const state = await readState(client, id);
      const tasks = state.workbook.sheets.find((s) => s.name === "Tasks");
      if (tasks && tasks.rows.some((r) => r.some((v) => v !== null))) {
        throw new ProjectExistsError("That spreadsheet already has a Tasks sheet. Use a blank spreadsheet, or open it instead.");
      }
      const blank = state.workbook.sheets.length === 0 && (await client.values(id, [state.meta.sheets[0]?.title ?? ""]).catch(() => [[]]))[0]?.length === 0;
      await write(client, id, state, sheetsForProject(project, undefined), blank);
      knownTitles.set(id, titleIndex(project, knownTitles.get(id)));
      return (await readState(client, id)).version;
    },

    async save(descriptor, project, expectedVersion) {
      const id = spreadsheetId(descriptor.path);
      const state = await readState(client, id);
      if (state.version !== expectedVersion) throw new VersionConflictError();
      try {
        const options = { dateFromNumber: (n: number) => serialToDate(n, state.meta.timeZone), knownTitles: knownTitles.get(id) };
        await write(client, id, state, sheetsForProject(project, state.workbook, options), false);
        knownTitles.set(id, titleIndex(project, knownTitles.get(id)));
      } catch (error) {
        throw asError(error);
      }
      return (await readState(client, id)).version;
    },
  };
}
