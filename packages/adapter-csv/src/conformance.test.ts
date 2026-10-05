import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describeStorageAdapter } from "@dep-tracker/storage-conformance";
import { csvAdapter } from "./adapter.ts";

describeStorageAdapter("csv", {
  adapter: csvAdapter,
  freshDescriptor: async () => ({
    kind: "csv",
    path: path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-conf-")), "project"),
  }),
  editExternally: async (d) => {
    const file = path.join(d.path, "nodes.csv");
    await writeFile(file, (await readFile(file, "utf8")).replace("Public beta live", "Public beta open"));
  },
});
