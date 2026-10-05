/**
 * Frontmatter for Obsidian notes: the small YAML subset Obsidian's properties
 * use — strings, lists (block or [flow]) and one level of map. Everything is
 * read as text. Keys the app doesn't own are written back exactly as found.
 */
export type Value = string | null | string[] | Record<string, string>;
export type Data = Record<string, Value>;

/** One top-level key and the exact lines it occupied, for writing it back untouched. */
export interface RawEntry {
  key: string;
  lines: string[];
}

export interface Note {
  data: Data;
  body: string;
  raw: RawEntry[];
}

const KEY_LINE = /^([^\s#-][^:]*?|"[^"]*"|'[^']*'):(?:[ \t]+(.*)|[ \t]*)$/;

function unquoteKey(key: string): string {
  return /^".*"$|^'.*'$/.test(key) ? parseScalar(key) : key.trim();
}

export function parseScalar(input: string): string {
  const s = input.trim();
  if (s.startsWith('"')) {
    const end = findClosingQuote(s, '"');
    const quoted = s.slice(0, end + 1);
    try {
      return JSON.parse(quoted) as string;
    } catch {
      return quoted.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  if (s.startsWith("'")) {
    const end = findClosingQuote(s, "'");
    return s.slice(1, end).replace(/''/g, "'");
  }
  // Plain scalar: a comment starts at " #"
  const comment = s.search(/\s#/);
  return (comment >= 0 ? s.slice(0, comment) : s).trim();
}

function findClosingQuote(s: string, q: string): number {
  for (let i = 1; i < s.length; i++) {
    if (q === '"' && s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") {
        i++;
        continue;
      }
      return i;
    }
  }
  return s.length - 1;
}

/** Split a [flow, "list"] respecting quotes. */
function parseFlowList(s: string): string[] {
  const inner = s.trim().replace(/^\[/, "").replace(/\]\s*(#.*)?$/, "");
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"') current += inner[++i] ?? "";
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(current);
  return items.map(parseScalar).filter((x) => x !== "");
}

function parseValue(inline: string | undefined, continuation: string[]): Value {
  const value = inline?.trim() ?? "";
  if (value) {
    if (value.startsWith("[")) return parseFlowList(value);
    if (/^\{\s*\}/.test(value)) return {};
    const scalar = parseScalar(value);
    return scalar === "" || scalar === "~" || scalar === "null" ? null : scalar;
  }
  const lines = continuation.filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines.length === 0) return null;
  if (lines[0]!.trim().startsWith("-")) {
    return lines.filter((l) => l.trim().startsWith("-")).map((l) => parseScalar(l.trim().replace(/^-\s?/, "")));
  }
  const map: Record<string, string> = {};
  for (const line of lines) {
    const m = KEY_LINE.exec(line.trim());
    if (m) map[unquoteKey(m[1]!)] = parseScalar(m[2] ?? "");
  }
  return map;
}

export function parseNote(text: string): Note {
  const open = /^---\r?\n/.exec(text);
  if (!open) return { data: {}, body: text, raw: [] };
  const rest = text.slice(open[0].length);
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!close) return { data: {}, body: text, raw: [] };
  const block = rest.slice(0, close.index).replace(/\r?\n$/, "");
  const body = rest.slice(close.index + close[0].length);

  const raw: RawEntry[] = [];
  for (const line of block.length ? block.split(/\r?\n/) : []) {
    const m = /^\s/.test(line) || line.trim().startsWith("- ") || line.trim() === "-" ? null : KEY_LINE.exec(line);
    if (m) raw.push({ key: unquoteKey(m[1]!), lines: [line] });
    else if (raw.length) raw.at(-1)!.lines.push(line);
    else raw.push({ key: "", lines: [line] }); // leading comment
  }
  const data: Data = {};
  for (const entry of raw) {
    if (!entry.key) continue;
    const m = KEY_LINE.exec(entry.lines[0]!)!;
    data[entry.key] = parseValue(m[2], entry.lines.slice(1));
  }
  return { data, body, raw };
}

const PLAIN = /^[A-Za-z0-9_.\/@+\-]([A-Za-z0-9_ .\/@+\-:]*[A-Za-z0-9_.\/@+\-])?$/;

export function formatScalar(s: string, isKey = false): string {
  if (isKey && s.includes(":")) return JSON.stringify(s);
  return PLAIN.test(s) && !/:\s|:$/.test(s) && !/^(null|~|true|false|yes|no)$/i.test(s) ? s : JSON.stringify(s);
}

function formatEntry(key: string, value: Value): string[] {
  const k = formatScalar(key, true);
  if (value === null) return [`${k}:`];
  if (typeof value === "string") return [`${k}: ${formatScalar(value)}`];
  if (Array.isArray(value)) return value.length ? [`${k}:`, ...value.map((v) => `  - ${formatScalar(v)}`)] : [`${k}: []`];
  const entries = Object.entries(value);
  return entries.length ? [`${k}:`, ...entries.map(([mk, mv]) => `  ${formatScalar(mk, true)}: ${formatScalar(mv)}`)] : [`${k}: {}`];
}

/**
 * Write a note. With `raw` (the note as it was), keys not in `data` are kept as
 * written, in place — except those in `owned`, which are the app's and dropped.
 * Keys in `data` replace their old lines in place; new keys go at the end.
 */
export function writeNote(data: Data, body: string, raw: RawEntry[] = [], owned: Set<string> = new Set()): string {
  const lines: string[] = [];
  const written = new Set<string>();
  for (const entry of raw) {
    if (entry.key && entry.key in data) {
      lines.push(...formatEntry(entry.key, data[entry.key]!));
      written.add(entry.key);
    } else if (!entry.key || !owned.has(entry.key)) {
      lines.push(...entry.lines);
    }
  }
  for (const [key, value] of Object.entries(data)) if (!written.has(key)) lines.push(...formatEntry(key, value));
  return `---\n${lines.join("\n")}${lines.length ? "\n" : ""}---\n${body}`;
}
