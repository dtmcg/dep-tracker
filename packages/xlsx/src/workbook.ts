import path from "node:path";
import { decodeXml, elements, escapeXml, textContent } from "./xml.ts";
import { readZip, writeZip } from "./zip.ts";

/** Cell values as dep-tracker sees them. Dates are wall-clock times in the local time zone. */
export type CellValue = string | number | boolean | Date | null;

export interface Sheet {
  name: string;
  /** rows[r][c], zero-based from A1; missing rows and cells are undefined. */
  rows: CellValue[][];
}

export interface Workbook {
  sheets: Sheet[];
}

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORKSHEET_TYPE = `${REL_NS}/worksheet`;
const STYLES_TYPE = `${REL_NS}/styles`;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- dates

/** Excel serial (days since 1899-12-30, or 1904-01-01) → local wall-clock Date. */
function fromSerial(serial: number, date1904: boolean): Date {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  // Round to the second: spreadsheets store binary fractions of a day.
  const utc = new Date(Math.round((epoch + serial * DAY_MS) / 1000) * 1000);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds());
}

/** Local wall-clock Date → Excel serial (1900 date system). */
function toSerial(date: Date): number {
  const wall = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  return (wall - Date.UTC(1899, 11, 30)) / DAY_MS;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormat(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}

// ---------------------------------------------------------------- reading

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolveTarget(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(base), target));
}

function relationships(parts: Map<string, Buffer>, partName: string): Map<string, { type: string; target: string }> {
  const relsName = path.posix.join(path.posix.dirname(partName), "_rels", `${path.posix.basename(partName)}.rels`);
  const xml = parts.get(relsName)?.toString("utf8") ?? "";
  const out = new Map<string, { type: string; target: string }>();
  for (const { attrs } of elements(xml, "Relationship")) {
    out.set(attrs.Id ?? "", { type: attrs.Type ?? "", target: resolveTarget(partName, attrs.Target ?? "") });
  }
  return out;
}

function workbookPartName(parts: Map<string, Buffer>): string {
  const root = relationships(parts, "");
  for (const rel of root.values()) if (rel.type.endsWith("/officeDocument")) return rel.target;
  return "xl/workbook.xml";
}

export function readWorkbook(buf: Buffer): Workbook {
  const parts = readZip(buf);
  const workbookPart = workbookPartName(parts);
  const workbookXml = parts.get(workbookPart)?.toString("utf8");
  if (!workbookXml) throw new Error("This file is not a spreadsheet workbook");
  const rels = relationships(parts, workbookPart);
  const workbookPr = elements(workbookXml, "workbookPr")[0]?.attrs;
  const date1904 = workbookPr?.date1904 === "1" || workbookPr?.date1904 === "true";

  let sharedStrings: string[] = [];
  let stylesXml = "";
  for (const rel of rels.values()) {
    if (rel.type.endsWith("/sharedStrings")) {
      sharedStrings = elements(parts.get(rel.target)?.toString("utf8") ?? "", "si").map((si) => textContent(si.inner));
    }
    if (rel.type.endsWith("/styles")) stylesXml = parts.get(rel.target)?.toString("utf8") ?? "";
  }

  // Which cell styles are dates
  const customFormats = new Map(elements(stylesXml, "numFmt").map(({ attrs }) => [Number(attrs.numFmtId), attrs.formatCode ?? ""]));
  const cellXfs = elements(elements(stylesXml, "cellXfs")[0]?.inner ?? "", "xf");
  const dateStyle = cellXfs.map(({ attrs }) => {
    const id = Number(attrs.numFmtId ?? 0);
    return BUILTIN_DATE_FORMATS.has(id) || (customFormats.has(id) && isDateFormat(customFormats.get(id)!));
  });

  const sheets: Sheet[] = elements(elements(workbookXml, "sheets")[0]?.inner ?? "", "sheet").map(({ attrs }) => {
    const rel = rels.get(attrs.id ?? "");
    const xml = rel ? (parts.get(rel.target)?.toString("utf8") ?? "") : "";
    const rows: CellValue[][] = [];
    let rowCursor = 0;
    for (const row of elements(xml, "row")) {
      const r = row.attrs.r ? Number(row.attrs.r) - 1 : rowCursor;
      rowCursor = r + 1;
      const cells: CellValue[] = [];
      let colCursor = 0;
      for (const cell of elements(row.inner, "c")) {
        const c = cell.attrs.r ? columnIndex(cell.attrs.r) : colCursor;
        colCursor = c + 1;
        const v = elements(cell.inner, "v")[0];
        const raw = v ? decodeXml(v.inner) : "";
        let value: CellValue = null;
        switch (cell.attrs.t) {
          case "s":
            value = sharedStrings[Number(raw)] ?? "";
            break;
          case "inlineStr":
            value = textContent(elements(cell.inner, "is")[0]?.inner ?? "");
            break;
          case "str":
            value = raw;
            break;
          case "b":
            value = raw === "1" || raw.toLowerCase() === "true";
            break;
          case "e":
            value = raw || null;
            break;
          case "d":
            value = raw ? new Date(raw) : null;
            break;
          default:
            if (raw !== "") {
              const n = Number(raw);
              value = dateStyle[Number(cell.attrs.s ?? 0)] ? fromSerial(n, date1904) : n;
            }
        }
        if (value !== null && value !== "") cells[c] = value;
        else if (value === "") cells[c] = "";
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
      if (cells.length) rows[r] = cells;
    }
    return { name: attrs.name ?? "", rows };
  });
  return { sheets };
}

// ---------------------------------------------------------------- writing

export type StyleName = "header" | "date" | "computed" | "computedDate" | `fill:#${string}`;

export interface CellSpec {
  value: CellValue;
  style?: StyleName;
}

export interface SheetSpec {
  name: string;
  rows: (CellValue | CellSpec)[][];
  /** Column widths in characters, by index. */
  widths?: number[];
  /** Columns hidden from view, by index. */
  hidden?: number[];
  /** Keep the header row in view. */
  freezeHeader?: boolean;
}

function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const isSpec = (cell: CellValue | CellSpec): cell is CellSpec =>
  cell !== null && typeof cell === "object" && !(cell instanceof Date) && "value" in cell;

const DEFAULT_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN_NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Append an item to a counted collection (fonts, fills, cellXfs…), reusing an identical one. */
function addToCollection(xml: string, collection: string, item: string): { xml: string; index: number } {
  const re = new RegExp(`<${collection}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${collection}>)`);
  const match = re.exec(xml);
  if (!match) throw new Error(`styles.xml has no <${collection}>`);
  const childName = collection === "cellXfs" ? "xf" : collection.slice(0, -1);
  const inner = match[1] ?? "";
  const children = [...inner.matchAll(new RegExp(`<${childName}\\b[^>]*?(?:/>|>[\\s\\S]*?</${childName}>)`, "g"))].map((m) => m[0]);
  const existing = children.indexOf(item);
  if (existing >= 0) return { xml, index: existing };
  const replacement = `<${collection} count="${children.length + 1}">${inner}${item}</${collection}>`;
  return { xml: xml.slice(0, match.index) + replacement + xml.slice(match.index + match[0].length), index: children.length };
}

function addNumFmt(xml: string, code: string): { xml: string; id: number } {
  const existing = elements(xml, "numFmt").find((f) => f.attrs.formatCode === code);
  if (existing) return { xml, id: Number(existing.attrs.numFmtId) };
  const ids = elements(xml, "numFmt").map((f) => Number(f.attrs.numFmtId));
  const id = Math.max(163, ...ids) + 1;
  const item = `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`;
  if (/<numFmts\b/.test(xml)) return { xml: addToCollection(xml, "numFmts", item).xml, id };
  // numFmts must be the first child of styleSheet
  return { xml: xml.replace(/(<styleSheet\b[^>]*>)/, `$1<numFmts count="1">${item}</numFmts>`), id };
}

function argb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

/** Resolve the styles a sheet uses into cellXfs indexes, adding them to styles.xml as needed. */
function resolveStyles(stylesXml: string, names: Set<StyleName>): { xml: string; index: Map<StyleName, number> } {
  let xml = stylesXml;
  const index = new Map<StyleName, number>();
  const font = (item: string) => {
    const r = addToCollection(xml, "fonts", item);
    xml = r.xml;
    return r.index;
  };
  const fill = (rgb: string) => {
    const r = addToCollection(xml, "fills", `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`);
    xml = r.xml;
    return r.index;
  };
  const xf = (attrs: string) => {
    const r = addToCollection(xml, "cellXfs", `<xf ${attrs}/>`);
    xml = r.xml;
    return r.index;
  };
  const dateFormat = () => {
    const r = addNumFmt(xml, "yyyy-mm-dd hh:mm");
    xml = r.xml;
    return r.id;
  };
  for (const name of [...names].sort()) {
    if (name === "header") {
      const f = font(`<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>`);
      const fl = fill("FFEDEBE4");
      index.set(name, xf(`numFmtId="0" fontId="${f}" fillId="${fl}" borderId="0" xfId="0" applyFont="1" applyFill="1"`));
    } else if (name === "date") {
      index.set(name, xf(`numFmtId="${dateFormat()}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"`));
    } else if (name === "computed" || name === "computedDate") {
      const f = font(`<font><i/><sz val="11"/><color rgb="FF6B6A64"/><name val="Calibri"/><family val="2"/></font>`);
      const fl = fill("FFF0EFEA");
      const fmt = name === "computedDate" ? dateFormat() : 0;
      index.set(name, xf(`numFmtId="${fmt}" fontId="${f}" fillId="${fl}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"`));
    } else if (name.startsWith("fill:")) {
      const fl = fill(argb(name.slice(5)));
      index.set(name, xf(`numFmtId="0" fontId="0" fillId="${fl}" borderId="0" xfId="0" applyFill="1"`));
    }
  }
  return { xml, index };
}

function sheetXml(spec: SheetSpec, styleIndex: Map<StyleName, number>): string {
  const rows = spec.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const value = isSpec(cell) ? cell.value : cell;
          const style = isSpec(cell) && cell.style ? styleIndex.get(cell.style) : undefined;
          if (value === null || value === undefined) {
            return style === undefined ? "" : `<c r="${columnName(c)}${r + 1}" s="${style}"/>`;
          }
          const ref = `${columnName(c)}${r + 1}`;
          const s = style === undefined ? "" : ` s="${style}"`;
          if (value instanceof Date) return `<c r="${ref}"${s}><v>${toSerial(value)}</v></c>`;
          if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
          if (typeof value === "boolean") return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const hidden = new Set(spec.hidden ?? []);
  const widthCount = Math.max(spec.widths?.length ?? 0, ...[...hidden].map((h) => h + 1), 0);
  const cols = widthCount
    ? `<cols>${Array.from({ length: widthCount }, (_, i) => {
        const width = spec.widths?.[i] ?? 10;
        return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"${hidden.has(i) ? ' hidden="1"' : ""}/>`;
      }).join("")}</cols>`
    : "";
  const view = spec.freezeHeader
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

function contentTypes(overrides: Map<string, string>, defaults: Map<string, string>): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${[...defaults]
    .map(([ext, type]) => `<Default Extension="${escapeXml(ext)}" ContentType="${escapeXml(type)}"/>`)
    .join("")}${[...overrides].map(([part, type]) => `<Override PartName="${escapeXml(part)}" ContentType="${escapeXml(type)}"/>`).join("")}</Types>`;
}

const SHEET_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";

/**
 * Write a workbook. With `base` (the current file), sheets named in `sheets`
 * are replaced or added, and everything else — other sheets, their formatting,
 * shared strings, styles — is kept.
 */
export function writeWorkbook(sheets: SheetSpec[], base?: Buffer): Buffer {
  const usedStyles = new Set<StyleName>();
  for (const s of sheets) for (const row of s.rows) for (const cell of row) if (isSpec(cell) && cell.style) usedStyles.add(cell.style);

  const parts = base ? readZip(base) : new Map<string, Buffer>();
  const workbookPart = base ? workbookPartName(parts) : "xl/workbook.xml";
  const relsPart = path.posix.join(path.posix.dirname(workbookPart), "_rels", `${path.posix.basename(workbookPart)}.rels`);
  let workbookXml =
    parts.get(workbookPart)?.toString("utf8") ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets></sheets></workbook>`;
  let relsXml = parts.get(relsPart)?.toString("utf8") ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL_NS}"></Relationships>`;
  const rels = base ? relationships(parts, workbookPart) : new Map<string, { type: string; target: string }>();

  // Content types
  const ctXml = parts.get("[Content_Types].xml")?.toString("utf8") ?? "";
  const defaults = new Map(elements(ctXml, "Default").map(({ attrs }) => [attrs.Extension ?? "", attrs.ContentType ?? ""]));
  defaults.set("rels", "application/vnd.openxmlformats-package.relationships+xml");
  defaults.set("xml", defaults.get("xml") ?? "application/xml");
  const overrides = new Map(elements(ctXml, "Override").map(({ attrs }) => [attrs.PartName ?? "", attrs.ContentType ?? ""]));
  overrides.set(`/${workbookPart}`, overrides.get(`/${workbookPart}`) ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");

  // Styles
  let stylesPart = [...rels.values()].find((r) => r.type === STYLES_TYPE)?.target;
  let stylesXml = stylesPart ? (parts.get(stylesPart)?.toString("utf8") ?? DEFAULT_STYLES) : DEFAULT_STYLES;
  const relIds = () => elements(relsXml, "Relationship").map(({ attrs }) => attrs.Id ?? "");
  const nextRelId = () => {
    let n = 1;
    const used = new Set(relIds());
    while (used.has(`rId${n}`)) n++;
    return `rId${n}`;
  };
  if (!stylesPart) {
    stylesPart = path.posix.join(path.posix.dirname(workbookPart), "styles.xml");
    relsXml = relsXml.replace("</Relationships>", `<Relationship Id="${nextRelId()}" Type="${STYLES_TYPE}" Target="styles.xml"/></Relationships>`);
  }
  const resolved = resolveStyles(stylesXml, usedStyles);
  stylesXml = resolved.xml;
  parts.set(stylesPart, Buffer.from(stylesXml, "utf8"));
  overrides.set(`/${stylesPart}`, "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml");

  // Sheets: replace in place by name, or add at the end
  const existing = elements(elements(workbookXml, "sheets")[0]?.inner ?? "", "sheet");
  let maxSheetId = Math.max(0, ...existing.map((s) => Number(s.attrs.sheetId ?? 0)));
  for (const spec of sheets) {
    const xml = Buffer.from(sheetXml(spec, resolved.index), "utf8");
    const found = existing.find((s) => s.attrs.name === spec.name);
    const target = found ? rels.get(found.attrs.id ?? "")?.target : undefined;
    if (target) {
      parts.set(target, xml);
      overrides.set(`/${target}`, SHEET_CT);
      continue;
    }
    let n = 1;
    while (parts.has(`xl/worksheets/sheet${n}.xml`)) n++;
    const part = `xl/worksheets/sheet${n}.xml`;
    parts.set(part, xml);
    overrides.set(`/${part}`, SHEET_CT);
    const relId = nextRelId();
    const relTarget = path.posix.relative(path.posix.dirname(workbookPart), part);
    relsXml = relsXml.replace("</Relationships>", `<Relationship Id="${relId}" Type="${WORKSHEET_TYPE}" Target="${relTarget}"/></Relationships>`);
    const sheetTag = `<sheet name="${escapeXml(spec.name)}" sheetId="${++maxSheetId}" r:id="${relId}"/>`;
    workbookXml = /<sheets\s*\/>/.test(workbookXml)
      ? workbookXml.replace(/<sheets\s*\/>/, `<sheets>${sheetTag}</sheets>`)
      : workbookXml.replace(/<\/sheets>/, `${sheetTag}</sheets>`);
  }

  // The calculation chain may point at cells we rewrote; spreadsheet apps rebuild it.
  for (const [id, rel] of rels) {
    if (!rel.type.endsWith("/calcChain")) continue;
    parts.delete(rel.target);
    overrides.delete(`/${rel.target}`);
    relsXml = relsXml.replace(new RegExp(`<Relationship\\b[^>]*Id="${id}"[^>]*/>`), "");
  }

  parts.set(workbookPart, Buffer.from(workbookXml, "utf8"));
  parts.set(relsPart, Buffer.from(relsXml, "utf8"));
  if (!parts.has("_rels/.rels")) {
    parts.set(
      "_rels/.rels",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="${workbookPart}"/></Relationships>`,
        "utf8",
      ),
    );
  }
  parts.set("[Content_Types].xml", Buffer.from(contentTypes(overrides, defaults), "utf8"));

  // Stable part order: content types first, then the rest as found (new parts appended).
  const order = ["[Content_Types].xml", ...[...parts.keys()].filter((k) => k !== "[Content_Types].xml")];
  return writeZip(order.map((name) => ({ name, data: parts.get(name)! })));
}

