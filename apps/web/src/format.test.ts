import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDateTime, formatMoment } from "./format.ts";

describe("formatDateTime", () => {
  it("formats a wall-clock completion time with weekday, date and 24h time", () => {
    assert.equal(formatDateTime("2026-11-04T09:00:00.000Z", "en-GB", "UTC"), "Wed 4 Nov 2026, 09:00");
  });

  it("renders in the requested time zone", () => {
    assert.equal(formatDateTime("2026-11-04T09:00:00.000Z", "en-GB", "Asia/Tokyo"), "Wed 4 Nov 2026, 18:00");
  });
});

describe("formatMoment", () => {
  it("leaves out the hours and minutes unless asked", () => {
    assert.equal(formatMoment("2026-11-04T09:30:00.000Z", { time: false }, "en-GB", "UTC"), "Wed 4 Nov 2026");
    assert.equal(formatMoment("2026-11-04T09:30:00.000Z", { time: true }, "en-GB", "UTC"), "Wed 4 Nov 2026, 09:30");
  });

  it("can also leave out the weekday", () => {
    assert.equal(formatMoment("2026-11-04T09:30:00.000Z", { time: false, weekday: false }, "en-GB", "UTC"), "4 Nov 2026");
    assert.equal(formatMoment("2026-11-04T09:30:00.000Z", { time: true, weekday: false }, "en-GB", "UTC"), "4 Nov 2026, 09:30");
  });
});
