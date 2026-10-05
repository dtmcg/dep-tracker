import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csvAdapter } from "@dep-tracker/adapter-csv";
import { excelAdapter } from "@dep-tracker/adapter-excel";
import { createApp } from "./app.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4317);
// Local-only by design (NFR-5): never bind to a public interface, and require a per-launch token.
const host = "127.0.0.1";
const token = randomBytes(24).toString("hex");

const server = createApp({
  adapters: { csv: csvAdapter, excel: excelAdapter },
  staticDir: path.resolve(here, "../../web/dist"),
  token,
});

server.listen(port, host, () => {
  console.log(`dep-tracker running at http://${host}:${port}`);
});
