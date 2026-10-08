import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatReference, parseReference, ReferenceError, storageKey } from "./reference.ts";

describe("formatReference / parseReference", () => {
  it("writes a reference as kind:path and reads it back", () => {
    const storage = { kind: "csv", path: "/plans/partner" } as const;
    assert.equal(formatReference(storage), "csv:/plans/partner");
    assert.deepEqual(parseReference("csv:/plans/partner"), storage);
  });

  it("keeps Windows drive letters and colons in the path", () => {
    assert.deepEqual(parseReference("csv:C:\\plans\\partner"), { kind: "csv", path: "C:\\plans\\partner" });
  });

  it("trims whitespace and accepts any case for the kind", () => {
    assert.deepEqual(parseReference("  CSV:/vault/partner  "), { kind: "csv", path: "/vault/partner" });
  });

  for (const bad of ["", "csv", "csv:", ":/plans", "word:/plans/x.docx", "excel:/plans/x.xlsx", "/plans/partner"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => parseReference(bad), ReferenceError);
    });
  }

  it("says what is wrong and what is allowed", () => {
    assert.throws(() => parseReference("word:/x"), /word.*csv/s);
  });
});

describe("storageKey", () => {
  it("is the same for the same store however it was typed", () => {
    assert.equal(storageKey({ kind: "csv", path: "/plans/a" }), storageKey({ kind: "csv", path: "/plans/a/" }));
    assert.equal(storageKey({ kind: "csv", path: "/plans/a" }), storageKey({ kind: "csv", path: "/plans/./a" }));
  });

  it("differs by path", () => {
    assert.notEqual(storageKey({ kind: "csv", path: "/plans/a" }), storageKey({ kind: "csv", path: "/plans/b" }));
  });

  it("ignores case and slash direction in Windows paths", () => {
    assert.equal(storageKey({ kind: "csv", path: "C:\\Plans\\A" }), storageKey({ kind: "csv", path: "c:/plans/a" }));
  });
});
