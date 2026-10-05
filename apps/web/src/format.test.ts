import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDateTime } from "./format.ts";

describe("formatDateTime", () => {
  it("formats a wall-clock completion time with weekday, date and 24h time", () => {
    assert.equal(formatDateTime("2026-11-04T09:00:00.000Z", "en-GB", "UTC"), "Wed 4 Nov 2026, 09:00");
  });

  it("renders in the requested time zone", () => {
    assert.equal(formatDateTime("2026-11-04T09:00:00.000Z", "en-GB", "Asia/Tokyo"), "Wed 4 Nov 2026, 18:00");
  });
});
