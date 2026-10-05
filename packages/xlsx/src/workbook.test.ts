import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readWorkbook, writeWorkbook } from "./workbook.ts";
import { readZip } from "./zip.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const fixture = (name: string) => readFile(path.join(fixtures, name));
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

for (const name of ["openpyxl.xlsx", "libreoffice.xlsx"]) {
  describe(`readWorkbook: ${name}`, () => {
    it("lists sheets in order", async () => {
      const wb = readWorkbook(await fixture(name));
      assert.deepEqual(
        wb.sheets.map((s) => s.name),
        ["Tasks", "Notes"],
      );
    });

    it("reads strings, numbers, booleans and dates by position", async () => {
      const rows = readWorkbook(await fixture(name)).sheets[0]!.rows;
      assert.deepEqual(rows[0], ["ID", "Title", "Work time", "Not before", "Done", "Score"]);
      assert.deepEqual(rows[1], ["n01", "Public beta live", "2d", null, false, 1.5]);
      assert.equal(rows[2]![1], 'Payments, "v2"');
      assert.deepEqual(rows[2]![3], local(2026, 11, 3, 9, 30));
      assert.equal(rows[2]![4], true);
    });

    it("joins rich-text runs and keeps sparse cells in place", async () => {
      const rows = readWorkbook(await fixture(name)).sheets[0]!.rows;
      assert.equal(rows[3]![1], "Rich text cell");
      assert.equal(rows[4], undefined);
      assert.equal(rows[5]![7], "far away");
    });

    it("reads a date-only cell", async () => {
      const notes = readWorkbook(await fixture(name)).sheets[1]!.rows;
      assert.equal(notes[0]![0], "Kept by the user");
      assert.deepEqual(notes[1]![1], local(2026, 12, 25));
    });
  });
}

describe("writeWorkbook (new)", () => {
  const sheets = [
    {
      name: "Tasks",
      widths: [10, 30],
      rows: [
        [{ value: "ID", style: "header" as const }, { value: "Title", style: "header" as const }],
        ["n01", "Ampersand & <angle> \"quotes\""],
        ["n02", "  padded  "],
        [{ value: local(2026, 11, 2, 9, 0), style: "date" as const }, 3.25, true],
      ],
    },
    { name: "Labels", rows: [["risk", { value: "#cc0000", style: "fill:#cc0000" as const }]] },
  ];

  it("round-trips values through readWorkbook", () => {
    const wb = readWorkbook(writeWorkbook(sheets));
    assert.deepEqual(
      wb.sheets.map((s) => s.name),
      ["Tasks", "Labels"],
    );
    const rows = wb.sheets[0]!.rows;
    assert.deepEqual(rows[0], ["ID", "Title"]);
    assert.equal(rows[1]![1], 'Ampersand & <angle> "quotes"');
    assert.equal(rows[2]![1], "  padded  ");
    assert.deepEqual(rows[3], [local(2026, 11, 2, 9, 0), 3.25, true]);
    assert.deepEqual(wb.sheets[1]!.rows[0], ["risk", "#cc0000"]);
  });

  it("is deterministic", () => {
    assert.deepEqual(writeWorkbook(sheets), writeWorkbook(sheets));
  });

  it("produces the parts Excel expects", () => {
    const parts = readZip(writeWorkbook(sheets));
    for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml"]) {
      assert.ok(parts.has(part), part);
    }
    assert.match(parts.get("xl/styles.xml")!.toString(), /<fgColor rgb="FFCC0000"\/>/);
  });
});

describe("writeWorkbook (over an existing workbook)", () => {
  it("replaces its own sheets and keeps the user's other sheets untouched", async () => {
    const base = await fixture("libreoffice.xlsx");
    const out = writeWorkbook([{ name: "Tasks", rows: [["ID"], ["n09"]] }, { name: "Labels", rows: [["x", "#123456"]] }], base);
    const wb = readWorkbook(out);
    assert.deepEqual(
      wb.sheets.map((s) => s.name),
      ["Tasks", "Notes", "Labels"],
    );
    assert.deepEqual(wb.sheets[0]!.rows, [["ID"], ["n09"]]);
    assert.equal(wb.sheets[1]!.rows[0]![0], "Kept by the user");
    assert.deepEqual(wb.sheets[1]!.rows[1]![1], local(2026, 12, 25));
    const before = readZip(base);
    const after = readZip(out);
    assert.deepEqual(after.get("xl/worksheets/sheet2.xml"), before.get("xl/worksheets/sheet2.xml"));
  });

  it("does not grow the styles on repeated saves", async () => {
    const spec = [{ name: "Tasks", rows: [[{ value: "ID", style: "header" as const }, { value: local(2026, 1, 1), style: "date" as const }]] }];
    const once = writeWorkbook(spec, await fixture("libreoffice.xlsx"));
    const twice = writeWorkbook(spec, once);
    assert.equal(readZip(twice).get("xl/styles.xml")!.length, readZip(once).get("xl/styles.xml")!.length);
  });
});
