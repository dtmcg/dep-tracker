import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateToSerial, serialToDate } from "./timezone.ts";

// 46328 = 2026-11-02 in the 1899-12-30 serial system
describe("spreadsheet serial dates in the sheet's own time zone", () => {
  it("reads 09:00 on 2 Nov in Dublin (GMT in November) as 09:00Z", () => {
    assert.equal(serialToDate(46328.375, "Europe/Dublin").toISOString(), "2026-11-02T09:00:00.000Z");
  });

  it("reads 09:00 in New York as 14:00Z, and 09:00 in July Dublin (IST) as 08:00Z", () => {
    assert.equal(serialToDate(46328.375, "America/New_York").toISOString(), "2026-11-02T14:00:00.000Z");
    assert.equal(serialToDate(46211.375, "Europe/Dublin").toISOString(), "2026-07-08T08:00:00.000Z");
  });

  it("writes an instant as the wall-clock serial in the zone, round-tripping", () => {
    const instant = new Date("2026-11-02T14:00:00.000Z");
    assert.equal(dateToSerial(instant, "America/New_York"), 46328.375);
    for (const tz of ["UTC", "Europe/Dublin", "Asia/Kolkata", "Pacific/Auckland"]) {
      assert.equal(serialToDate(dateToSerial(instant, tz), tz).toISOString(), instant.toISOString());
    }
  });
});
