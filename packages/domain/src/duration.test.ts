import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DurationError, parseDuration } from "./duration.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe("parseDuration", () => {
  it("parses single units", () => {
    assert.equal(parseDuration("2d"), 2 * DAY);
    assert.equal(parseDuration("4h"), 4 * HOUR);
    assert.equal(parseDuration("90m"), 90 * MINUTE);
    assert.equal(parseDuration("1w"), WEEK);
  });

  it("parses combined units with or without spaces", () => {
    assert.equal(parseDuration("1w 2d"), WEEK + 2 * DAY);
    assert.equal(parseDuration("1d4h30m"), DAY + 4 * HOUR + 30 * MINUTE);
  });

  it("is case-insensitive and trims whitespace", () => {
    assert.equal(parseDuration("  3D "), 3 * DAY);
  });

  it("accepts a zero duration", () => {
    assert.equal(parseDuration("0d"), 0);
  });

  for (const bad of ["", "   ", "2", "2x", "d2", "1.5d", "-1d", "2d 2d"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => parseDuration(bad), DurationError);
    });
  }

  it("names the bad input in the error", () => {
    assert.throws(() => parseDuration("2x"), /"2x"/);
  });
});
