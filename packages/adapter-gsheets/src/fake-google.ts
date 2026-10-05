import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * An in-process stand-in for Google's OAuth and Sheets v4 endpoints, used by
 * the tests (the PRD's "recorded fixtures in CI"). It keeps the real API's
 * shapes and quirks: values come back trimmed of trailing empty cells and
 * rows, dates are serial numbers, every call needs a bearer token, and
 * request types it doesn't know are rejected so mistakes surface.
 *
 * Admin endpoints under /__admin let tests act as a person editing a sheet.
 */

type Cell = string | number | boolean | null;

interface FakeSheet {
  sheetId: number;
  title: string;
  grid: Cell[][];
  frozenRows: number;
  formats: unknown[];
}

interface FakeSpreadsheet {
  id: string;
  title: string;
  timeZone: string;
  sheets: FakeSheet[];
}

export interface FakeGoogle {
  url: string;
  close(): Promise<void>;
  createSpreadsheet(title: string, timeZone?: string, sheets?: { title: string; values: Cell[][] }[]): string;
  spreadsheet(id: string): FakeSpreadsheet | undefined;
  setCell(id: string, sheetTitle: string, row: number, col: number, value: Cell): void;
  /** Every Sheets API request seen, for assertions. */
  requests: { method: string; path: string; body?: unknown }[];
  /** Make every token invalid, as if access was revoked. */
  revokeAll(): void;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
const googleError = (res: ServerResponse, code: number, status: string, message: string) => json(res, code, { error: { code, status, message } });

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** "'My sheet'!A1:B2" → { title, row, col } (row/col of the top-left, zero-based). */
function parseRange(range: string): { title: string; row: number; col: number } {
  const m = /^(?:'((?:[^']|'')*)'|([^!]+?))(?:!([A-Z]+)(\d+)(?::[A-Z]+\d+)?)?$/.exec(range.trim());
  if (!m) throw new Error(`Unable to parse range: ${range}`);
  const title = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]!;
  let col = 0;
  for (const ch of m[3] ?? "A") col = col * 26 + (ch.charCodeAt(0) - 64);
  return { title, row: Number(m[4] ?? 1) - 1, col: col - 1 };
}

function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Values as the API returns them: trailing empty cells and rows dropped. */
function trimmed(grid: Cell[][]): Cell[][] {
  const rows = grid.map((row) => {
    const r = row.map((c) => (c === null || c === undefined ? "" : c));
    while (r.length && r.at(-1) === "") r.pop();
    return r;
  });
  while (rows.length && rows.at(-1)!.length === 0) rows.pop();
  return rows;
}

export async function startFakeGoogle(options: { clientId: string; clientSecret: string; port?: number }): Promise<FakeGoogle> {
  const spreadsheets = new Map<string, FakeSpreadsheet>();
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  let accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const requests: FakeGoogle["requests"] = [];
  let nextSheetId = 1000;

  const createSpreadsheet: FakeGoogle["createSpreadsheet"] = (title, timeZone = "Europe/Dublin", sheets = [{ title: "Sheet1", values: [] }]) => {
    const id = `fake-${b64url(randomBytes(9))}`;
    spreadsheets.set(id, {
      id,
      title,
      timeZone,
      sheets: sheets.map((s) => ({ sheetId: nextSheetId++, title: s.title, grid: s.values.map((r) => [...r]), frozenRows: 0, formats: [] })),
    });
    return id;
  };

  const setCell: FakeGoogle["setCell"] = (id, sheetTitle, row, col, value) => {
    const sheet = spreadsheets.get(id)?.sheets.find((s) => s.title === sheetTitle);
    if (!sheet) throw new Error(`No sheet ${sheetTitle}`);
    while (sheet.grid.length <= row) sheet.grid.push([]);
    const r = sheet.grid[row]!;
    while (r.length <= col) r.push(null);
    r[col] = value;
  };

  async function sheetsApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !accessTokens.has(auth.slice(7))) {
      return googleError(res, 401, "UNAUTHENTICATED", "Request had invalid authentication credentials.");
    }
    const m = /^\/v4\/spreadsheets\/([^/:]+)(\/values:batchGet|\/values:batchUpdate|:batchUpdate)?$/.exec(url.pathname);
    const book = m ? spreadsheets.get(decodeURIComponent(m[1]!)) : undefined;
    const raw = req.method === "POST" ? await body(req) : "";
    requests.push({ method: req.method ?? "", path: url.pathname, body: raw ? JSON.parse(raw) : undefined });
    if (!m) return googleError(res, 404, "NOT_FOUND", "Not found");
    if (!book) return googleError(res, 404, "NOT_FOUND", "Requested entity was not found.");
    const find = (title: string) => book.sheets.find((s) => s.title === title);

    try {
      if (req.method === "GET" && !m[2]) {
        return json(res, 200, {
          spreadsheetId: book.id,
          properties: { title: book.title, timeZone: book.timeZone },
          sheets: book.sheets.map((s, index) => ({
            properties: {
              sheetId: s.sheetId,
              title: s.title,
              index,
              gridProperties: { rowCount: Math.max(1000, s.grid.length), columnCount: Math.max(26, ...s.grid.map((r) => r.length)), frozenRowCount: s.frozenRows || undefined },
            },
          })),
        });
      }
      if (req.method === "GET" && m[2] === "/values:batchGet") {
        if (url.searchParams.get("valueRenderOption") !== "UNFORMATTED_VALUE") throw new Error("fake supports valueRenderOption=UNFORMATTED_VALUE only");
        const valueRanges = url.searchParams.getAll("ranges").map((range) => {
          const { title } = parseRange(range);
          const sheet = find(title);
          if (!sheet) throw new Error(`Unable to parse range: ${range}`);
          const values = trimmed(sheet.grid);
          const width = Math.max(1, ...values.map((r) => r.length));
          const out: Record<string, unknown> = { range: `'${title}'!A1:${columnName(width - 1)}${Math.max(1, values.length)}`, majorDimension: "ROWS" };
          if (values.length) out.values = values;
          return out;
        });
        return json(res, 200, { spreadsheetId: book.id, valueRanges });
      }
      if (req.method === "POST" && m[2] === "/values:batchUpdate") {
        const { valueInputOption, data } = JSON.parse(raw) as { valueInputOption: string; data: { range: string; values: Cell[][] }[] };
        if (valueInputOption !== "RAW") throw new Error("fake expects valueInputOption=RAW");
        let cells = 0;
        for (const { range, values } of data) {
          const { title, row, col } = parseRange(range);
          if (!find(title)) throw new Error(`Unable to parse range: ${range}`);
          values.forEach((r, i) =>
            r.forEach((v, j) => {
              setCell(book.id, title, row + i, col + j, v === "" ? null : v);
              cells++;
            }),
          );
        }
        return json(res, 200, { spreadsheetId: book.id, totalUpdatedCells: cells });
      }
      if (req.method === "POST" && m[2] === ":batchUpdate") {
        const { requests: reqs } = JSON.parse(raw) as { requests: Record<string, any>[] };
        const replies: unknown[] = [];
        for (const r of reqs) {
          const [kind] = Object.keys(r);
          const args = r[kind!];
          const byId = (sheetId: number) => {
            const s = book.sheets.find((x) => x.sheetId === sheetId);
            if (!s) throw new Error(`No grid with id: ${sheetId}`);
            return s;
          };
          switch (kind) {
            case "addSheet": {
              const title = args.properties.title as string;
              if (find(title)) throw new Error(`A sheet with the name "${title}" already exists.`);
              const sheet: FakeSheet = { sheetId: nextSheetId++, title, grid: [], frozenRows: 0, formats: [] };
              book.sheets.push(sheet);
              replies.push({ addSheet: { properties: { sheetId: sheet.sheetId, title } } });
              break;
            }
            case "updateSheetProperties": {
              const sheet = byId(args.properties.sheetId);
              const fields = String(args.fields).split(",");
              if (fields.includes("title")) sheet.title = args.properties.title;
              if (fields.includes("gridProperties.frozenRowCount")) sheet.frozenRows = args.properties.gridProperties.frozenRowCount;
              replies.push({});
              break;
            }
            case "repeatCell":
            case "updateDimensionProperties": {
              byId((args.range ?? {}).sheetId);
              byId(args.range.sheetId).formats.push({ [kind]: args });
              replies.push({});
              break;
            }
            default:
              throw new Error(`Invalid requests[0]: unknown request ${kind}`);
          }
        }
        return json(res, 200, { spreadsheetId: book.id, replies });
      }
    } catch (error) {
      return googleError(res, 400, "INVALID_ARGUMENT", (error as Error).message);
    }
    return googleError(res, 404, "NOT_FOUND", "Not found");
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // OAuth: consent is automatic; redirect straight back with a code.
      if (req.method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
        const q = url.searchParams;
        if (q.get("client_id") !== options.clientId) return json(res, 400, { error: "invalid_client" });
        if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return json(res, 400, { error: "pkce_required" });
        const code = b64url(randomBytes(12));
        codes.set(code, { challenge: q.get("code_challenge")!, redirectUri: q.get("redirect_uri")! });
        const back = new URL(q.get("redirect_uri")!);
        back.searchParams.set("code", code);
        back.searchParams.set("state", q.get("state") ?? "");
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/token") {
        const form = new URLSearchParams(await body(req));
        if (form.get("client_id") !== options.clientId || form.get("client_secret") !== options.clientSecret) return json(res, 401, { error: "invalid_client" });
        const access = `at-${b64url(randomBytes(12))}`;
        if (form.get("grant_type") === "authorization_code") {
          const entry = codes.get(form.get("code") ?? "");
          codes.delete(form.get("code") ?? "");
          if (!entry || entry.redirectUri !== form.get("redirect_uri")) return json(res, 400, { error: "invalid_grant" });
          if (b64url(createHash("sha256").update(form.get("code_verifier") ?? "").digest()) !== entry.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
          const refresh = `rt-${b64url(randomBytes(12))}`;
          refreshTokens.add(refresh);
          accessTokens.add(access);
          return json(res, 200, { access_token: access, expires_in: 3599, refresh_token: refresh, token_type: "Bearer", scope: "https://www.googleapis.com/auth/spreadsheets" });
        }
        if (form.get("grant_type") === "refresh_token") {
          if (!refreshTokens.has(form.get("refresh_token") ?? "")) return json(res, 400, { error: "invalid_grant" });
          accessTokens.add(access);
          return json(res, 200, { access_token: access, expires_in: 3599, token_type: "Bearer" });
        }
        return json(res, 400, { error: "unsupported_grant_type" });
      }
      // Test helpers
      if (url.pathname === "/__admin/spreadsheets" && req.method === "POST") {
        const { title, timeZone, sheets } = JSON.parse(await body(req) || "{}");
        return json(res, 201, { id: createSpreadsheet(title ?? "Untitled spreadsheet", timeZone, sheets) });
      }
      const admin = /^\/__admin\/spreadsheets\/([^/]+)(\/cell)?$/.exec(url.pathname);
      if (admin) {
        const id = decodeURIComponent(admin[1]!);
        if (req.method === "GET") return json(res, spreadsheets.has(id) ? 200 : 404, spreadsheets.get(id) ?? {});
        if (req.method === "PUT" && admin[2]) {
          const { sheet, row, col, value } = JSON.parse(await body(req));
          setCell(id, sheet, row, col, value);
          return json(res, 200, {});
        }
      }
      if (url.pathname === "/__admin/tokens" && req.method === "GET") {
        // Mint a token without the browser dance, for API-level tests.
        const access = `at-${b64url(randomBytes(12))}`;
        accessTokens.add(access);
        return json(res, 200, { access_token: access });
      }
      if (url.pathname.startsWith("/v4/")) return await sheetsApi(req, res, url);
      json(res, 404, { error: "not found" });
    } catch (error) {
      json(res, 500, { error: (error as Error).message });
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    createSpreadsheet,
    spreadsheet: (id) => spreadsheets.get(id),
    setCell,
    requests,
    revokeAll: () => {
      accessTokens = new Set();
    },
  };
}
