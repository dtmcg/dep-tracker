import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csvAdapter } from "@dep-tracker/adapter-csv";
import { excelAdapter } from "@dep-tracker/adapter-excel";
import { createGoogleAuth, createGoogleSheetsAdapter, createSheetsClient, fileTokenStore } from "@dep-tracker/adapter-gsheets";
import { obsidianAdapter } from "@dep-tracker/adapter-obsidian";
import { createApp } from "./app.ts";
import { defaultProjectsDir } from "./config.ts";
import { createLibrary } from "./library.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4317);
// Local-only by design (NFR-5): never bind to a public interface, and require a per-launch token.
const host = "127.0.0.1";
const token = randomBytes(24).toString("hex");

// Google Sheets: your own OAuth client ("Desktop app") from Google Cloud; see the README.
const configDir = process.env.DEP_TRACKER_CONFIG_DIR ?? path.join(homedir(), ".dep-tracker");
const google = createGoogleAuth({
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  accountsUrl: process.env.DEP_TRACKER_GOOGLE_ACCOUNTS_URL,
  oauthUrl: process.env.DEP_TRACKER_GOOGLE_OAUTH_URL,
  store: fileTokenStore(path.join(configDir, "google-token.json")),
});
const gsheets = createGoogleSheetsAdapter(
  createSheetsClient({ baseUrl: process.env.DEP_TRACKER_GOOGLE_SHEETS_URL, accessToken: () => google.accessToken() }),
);

const server = createApp({
  adapters: { csv: csvAdapter, excel: excelAdapter, obsidian: obsidianAdapter, gsheets },
  google,
  // The app's list of known projects lives with the code (data/ is git-ignored); nobody needs to edit it.
  library: createLibrary(process.env.DEP_TRACKER_LIBRARY_FILE ?? path.resolve(here, "../../../data/projects.json")),
  projectsDir: defaultProjectsDir(homedir(), process.platform, process.env.DEP_TRACKER_PROJECTS_DIR),
  staticDir: path.resolve(here, "../../web/dist"),
  token,
});

server.listen(port, host, () => {
  console.log(`dep-tracker running at http://${host}:${port}`);
});
