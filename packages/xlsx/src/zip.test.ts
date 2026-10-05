import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, readZip, writeZip } from "./zip.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("crc32", () => {
  it("matches the standard check value", () => {
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });
});

describe("zip", () => {
  it("round-trips entries", () => {
    const entries = [
      { name: "a.txt", data: Buffer.from("alpha") },
      { name: "dir/b.xml", data: Buffer.from("<b>".repeat(500)) },
      { name: "empty", data: Buffer.alloc(0) },
    ];
    const out = readZip(writeZip(entries));
    assert.deepEqual([...out.keys()], ["a.txt", "dir/b.xml", "empty"]);
    assert.equal(out.get("dir/b.xml")?.toString(), "<b>".repeat(500));
    assert.equal(out.get("empty")?.length, 0);
  });

  it("writes the same bytes for the same entries", () => {
    const entries = [{ name: "a.txt", data: Buffer.from("alpha") }];
    assert.deepEqual(writeZip(entries), writeZip(entries));
  });

  it("reads a zip written by another tool (Python's zipfile)", async () => {
    const out = readZip(await readFile(path.join(fixtures, "python.zip")));
    assert.equal(out.get("stored.txt")?.toString(), "hello, stored");
    assert.equal(out.get("dir/deflated.txt")?.toString(), "hello, deflated ".repeat(50));
  });

  it("rejects data that is not a zip", () => {
    assert.throws(() => readZip(Buffer.from("not a zip at all")), /not a valid/i);
  });
});
