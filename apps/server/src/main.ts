import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csvAdapter } from "@dep-tracker/adapter-csv";
import { createApp } from "./app.ts";
import { defaultProjectsDir, resourcingEnabled } from "./config.ts";
import { createLibrary } from "./library.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4317);
// Local-only by design (NFR-5): never bind to a public interface, and require a per-launch token.
const host = "127.0.0.1";
const token = randomBytes(24).toString("hex");

const server = createApp({
  // One adapter per kind of store; another store is another entry here.
  adapters: { csv: csvAdapter },
  // The app's list of known projects lives with the code (data/ is git-ignored); nobody needs to edit it.
  library: createLibrary(process.env.DEP_TRACKER_LIBRARY_FILE ?? path.resolve(here, "../../../data/projects.json")),
  projectsDir: defaultProjectsDir(homedir(), process.platform, process.env.DEP_TRACKER_PROJECTS_DIR),
  resourcing: resourcingEnabled(process.argv),
  staticDir: path.resolve(here, "../../web/dist"),
  token,
});

server.listen(port, host, () => {
  console.log(`dep-tracker running at http://${host}:${port}`);
  if (resourcingEnabled(process.argv)) console.log("Resourcing feature: on");
});
