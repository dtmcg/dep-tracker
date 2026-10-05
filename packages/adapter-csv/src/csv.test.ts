import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsvSyntaxError, parseCsv, readRecords, stringifyCsv } from "./csv.ts";

describe("parseCsv", () => {
  it("splits rows and fields", () => {
    assert.deepEqual(parseCsv("a,b\n1,2\n"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quoted fields containing commas, quotes and newlines", () => {
    assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n'), [
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });

  it("accepts CRLF line endings and a UTF-8 BOM, as written by Excel on Windows", () => {
    assert.deepEqual(parseCsv("﻿a,b\r\n1,2\r\n"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty trailing fields and ignores blank lines", () => {
    assert.deepEqual(parseCsv("a,b,c\n1,,\n\n"), [
      ["a", "b", "c"],
      ["1", "", ""],
    ]);
  });

  it("rejects an unterminated quote with its line number", () => {
    assert.throws(() => parseCsv('a,b\n1,"oops\n'), (e: unknown) => e instanceof CsvSyntaxError && e.line === 2);
  });
});

describe("readRecords", () => {
  it("maps rows to records by header, matching headers case-insensitively", () => {
    const { records } = readRecords("ID, Title \nn01,Root\n", "nodes.csv", ["id", "title"]);
    assert.deepEqual(records, [{ line: 2, values: { id: "n01", title: "Root" } }]);
  });

  it("fills missing optional columns with empty strings", () => {
    const { records } = readRecords("id\nn01\n", "nodes.csv", ["id"], ["notes"]);
    assert.equal(records[0]?.values.notes, "");
  });

  it("names the file and column when a required column is missing", () => {
    assert.throws(() => readRecords("id\nn01\n", "nodes.csv", ["id", "title"]), /nodes\.csv.*"title"/);
  });
});

describe("stringifyCsv", () => {
  it("quotes only fields that need it and round-trips through parseCsv", () => {
    const rows = [
      ["id", "title", "description"],
      ["n01", "Plain", 'Has, comma and "quotes"\nand a newline'],
      ["n02", " padded ", ""],
    ];
    const text = stringifyCsv(rows);
    assert.equal(text.split("\n")[0], "id,title,description");
    assert.ok(text.includes('"Has, comma and ""quotes""'));
    assert.ok(text.endsWith("\n"));
    assert.deepEqual(parseCsv(text), rows);
  });
});
