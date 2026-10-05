import { after } from "node:test";
import { describeStorageAdapter } from "@dep-tracker/storage-conformance";
import { createGoogleSheetsAdapter } from "./adapter.ts";
import { createSheetsClient } from "./client.ts";
import { startFakeGoogle } from "./fake-google.ts";

const fake = startFakeGoogle({ clientId: "cid", clientSecret: "secret" });
after(async () => (await fake).close());

const adapter = createGoogleSheetsAdapter(
  createSheetsClient({
    baseUrl: async () => (await fake).url,
    accessToken: async () => {
      const res = await fetch(`${(await fake).url}/__admin/tokens`);
      return ((await res.json()) as { access_token: string }).access_token;
    },
  }),
);

describeStorageAdapter("gsheets", {
  adapter,
  freshDescriptor: async () => ({
    kind: "gsheets",
    path: `https://docs.google.com/spreadsheets/d/${(await fake).createSpreadsheet("Plan", "America/New_York")}/edit#gid=0`,
  }),
  // Someone edits a description in the browser
  editExternally: async (d) => {
    const g = await fake;
    const id = /\/d\/([^/]+)/.exec(d.path)![1]!;
    const tasks = g.spreadsheet(id)!.sheets.find((s) => s.title === "Tasks")!;
    const header = tasks.grid[0]!;
    const row = tasks.grid.findIndex((r) => r[header.indexOf("Title")] === "Public beta live");
    g.setCell(id, "Tasks", row, header.indexOf("Description"), "Edited in the browser");
  },
});
