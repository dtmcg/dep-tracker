import { appendFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describeStorageAdapter } from "@dep-tracker/storage-conformance";
import { obsidianAdapter } from "./adapter.ts";

describeStorageAdapter("obsidian", {
  adapter: obsidianAdapter,
  freshDescriptor: async () => ({
    kind: "obsidian",
    path: path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-vault-")), "Launch plan"),
  }),
  // A person adds a line to a task note in Obsidian
  editExternally: async (d) => {
    const note = (await readdir(d.path)).find((f) => f === "Payments integration.md")!;
    await appendFile(path.join(d.path, note), "Edited in Obsidian.\n");
  },
});
