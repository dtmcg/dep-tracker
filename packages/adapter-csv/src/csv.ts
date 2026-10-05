/** Minimal RFC 4180 CSV reader, tolerant of Excel's BOM and CRLF line endings. */
export class CsvSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

export interface CsvRow {
  /** 1-based line number where the row starts. */
  line: number;
  fields: string[];
}

function parseRows(text: string): CsvRow[] {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;

  const endRow = () => {
    fields.push(field);
    const blank = fields.length === 1 && fields[0] === "";
    if (!blank) rows.push({ line: rowLine, fields });
    fields = [];
    field = "";
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      quoteLine = line;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else if (ch === "\r" && src[i + 1] === "\n") {
      // CRLF: handled by the \n branch on the next character
    } else if (ch === "\n") {
      endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }

  if (inQuotes) throw new CsvSyntaxError(`Unterminated quoted field starting on line ${quoteLine}`, quoteLine);
  if (field !== "" || fields.length > 0) endRow();
  return rows;
}

/** Parse CSV text into rows of fields. */
export function parseCsv(text: string): string[][] {
  return parseRows(text).map((row) => row.fields);
}

export interface CsvRecord {
  line: number;
  values: Record<string, string>;
}

/**
 * Read CSV text with a header row into records keyed by lower-case column name.
 * Required columns must be present; optional columns default to "".
 */
export function readRecords(
  text: string,
  fileName: string,
  required: string[],
  optional: string[] = [],
): { records: CsvRecord[] } {
  let rows: CsvRow[];
  try {
    rows = parseRows(text);
  } catch (error) {
    if (error instanceof CsvSyntaxError) throw new CsvSyntaxError(`${fileName}: ${error.message}`, error.line);
    throw error;
  }
  const [header, ...body] = rows;
  const columns = (header?.fields ?? []).map((name) => name.trim().toLowerCase());
  for (const name of required) {
    if (!columns.includes(name)) throw new Error(`${fileName} is missing the required column "${name}"`);
  }
  const wanted = [...required, ...optional];
  const records = body.map((row) => {
    const values: Record<string, string> = {};
    for (const name of wanted) {
      const index = columns.indexOf(name);
      values[name] = index >= 0 ? (row.fields[index] ?? "").trim() : "";
    }
    return { line: row.line, values };
  });
  return { records };
}
