import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readZip, writeZip } from "@dep-tracker/xlsx";
import { describeStorageAdapter } from "@dep-tracker/storage-conformance";
import { excelAdapter } from "./adapter.ts";

describeStorageAdapter("excel", {
  adapter: excelAdapter,
  freshDescriptor: async () => ({
    kind: "excel",
    path: path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-xlsx-")), "plan.xlsx"),
  }),
  // Edit a title inside the workbook, as a person would in a spreadsheet app
  editExternally: async (d) => {
    const parts = readZip(await readFile(d.path));
    const entries = [...parts].map(([name, data]) => ({
      name,
      data: name.startsWith("xl/worksheets/") ? Buffer.from(data.toString("utf8").replaceAll("Public beta live", "Public beta open")) : data,
    }));
    await writeFile(d.path, writeZip(entries));
  },
});
