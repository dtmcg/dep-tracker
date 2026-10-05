import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newId } from "./ids.ts";

describe("newId", () => {
  it("makes short, CSV- and filename-safe ids", () => {
    assert.match(newId(), /^n[0-9a-z]{14}$/);
  });

  it("is unique across many calls", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId()));
    assert.equal(ids.size, 5000);
  });

  it("sorts by creation time", () => {
    const a = newId(1_000_000);
    const b = newId(2_000_000);
    assert.ok(a < b);
  });
});
