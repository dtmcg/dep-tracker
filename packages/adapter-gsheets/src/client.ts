/** A small client for the Google Sheets v4 REST API, using fetch (no Google libraries). */

export class GoogleSheetsError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "GoogleSheetsError";
  }
}

export type SheetValue = string | number | boolean;

export interface SpreadsheetMeta {
  title: string;
  timeZone: string;
  sheets: { sheetId: number; title: string }[];
}

export interface SheetsClient {
  meta(id: string): Promise<SpreadsheetMeta>;
  /** Values of whole sheets, by title, unformatted (dates as serial numbers). */
  values(id: string, titles: string[]): Promise<SheetValue[][][]>;
  updateValues(id: string, data: { range: string; values: SheetValue[][] }[]): Promise<void>;
  batchUpdate(id: string, requests: object[]): Promise<{ replies?: Record<string, any>[] }>;
}

export interface ClientOptions {
  /** API origin; a function so tests can point at a server that starts later. */
  baseUrl?: string | (() => Promise<string>);
  accessToken: () => Promise<string>;
  fetchFn?: typeof fetch;
  /** Waits between retries of rate-limited or failed calls, in ms. */
  retryDelays?: number[];
}

export const quoteSheet = (title: string) => `'${title.replace(/'/g, "''")}'`;

export function createSheetsClient(options: ClientOptions): SheetsClient {
  const fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
  const delays = options.retryDelays ?? [500, 2000, 5000];
  const base = async () =>
    typeof options.baseUrl === "function" ? await options.baseUrl() : (options.baseUrl ?? "https://sheets.googleapis.com");

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${await options.accessToken()}`);
      if (init.body) headers.set("content-type", "application/json");
      let res: Response;
      try {
        res = await fetchFn(`${await base()}${path}`, { ...init, headers });
      } catch (error) {
        throw new GoogleSheetsError(`Could not reach Google Sheets: ${(error as Error).message}`);
      }
      if (res.ok) return (await res.json()) as T;
      // Back off on rate limits and server errors (PRD risk: quotas)
      if ((res.status === 429 || res.status >= 500) && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? res.statusText;
      if (res.status === 401) throw new GoogleSheetsError("Google rejected the sign-in. Sign in to Google again from the start screen.", 401);
      if (res.status === 403) throw new GoogleSheetsError("No access to this spreadsheet. Share it with the Google account you signed in with.", 403);
      if (res.status === 404) throw new GoogleSheetsError("Spreadsheet not found. Check the link, and that it's shared with you.", 404);
      if (res.status === 429) throw new GoogleSheetsError("Google's rate limit was reached. Wait a minute and try again.", 429);
      throw new GoogleSheetsError(`Google Sheets error: ${detail}`, res.status);
    }
  }

  const sheetUrl = (id: string) => `/v4/spreadsheets/${encodeURIComponent(id)}`;

  return {
    async meta(id) {
      const body = await call<{
        properties: { title: string; timeZone: string };
        sheets: { properties: { sheetId: number; title: string } }[];
      }>(`${sheetUrl(id)}?fields=properties(title,timeZone),sheets(properties(sheetId,title))`);
      return {
        title: body.properties.title,
        timeZone: body.properties.timeZone || "UTC",
        sheets: body.sheets.map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title })),
      };
    },
    async values(id, titles) {
      if (titles.length === 0) return [];
      const q = new URLSearchParams();
      for (const t of titles) q.append("ranges", quoteSheet(t));
      q.set("valueRenderOption", "UNFORMATTED_VALUE");
      q.set("dateTimeRenderOption", "SERIAL_NUMBER");
      q.set("majorDimension", "ROWS");
      const body = await call<{ valueRanges: { values?: SheetValue[][] }[] }>(`${sheetUrl(id)}/values:batchGet?${q}`);
      return body.valueRanges.map((r) => r.values ?? []);
    },
    async updateValues(id, data) {
      await call(`${sheetUrl(id)}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data }),
      });
    },
    async batchUpdate(id, requests) {
      return call(`${sheetUrl(id)}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
    },
  };
}
