import path from "node:path";
import { fileURLToPath } from "node:url";
import { csvAdapter } from "@dep-tracker/adapter-csv";
import { createApp } from "./app.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4317);
// Local-only by design (NFR-5): never bind to a public interface.
const host = "127.0.0.1";

const server = createApp({
  adapters: { csv: csvAdapter },
  staticDir: path.resolve(here, "../../web/dist"),
});

server.listen(port, host, () => {
  console.log(`dep-tracker running at http://${host}:${port}`);
});
