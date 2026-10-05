import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dashSeconds } from "./animation.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("dashSeconds", () => {
  it("is slower for longer work", () => {
    assert.ok(dashSeconds(DAY) > dashSeconds(4 * HOUR));
    assert.ok(dashSeconds(7 * DAY) > dashSeconds(DAY));
    assert.ok(dashSeconds(60 * DAY) > dashSeconds(7 * DAY));
  });

  it("stays within a readable range", () => {
    assert.ok(dashSeconds(0) >= 0.5);
    assert.ok(dashSeconds(10_000 * DAY) <= 6);
  });
});
