/**
 * Spreadsheet dates are serial numbers (days since 1899-12-30) holding a
 * wall-clock time in the spreadsheet's own time zone. These convert between
 * that and real instants using the platform's time-zone data (Intl).
 */
const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

/** Offset of a zone from UTC at an instant, in ms (positive east of Greenwich). */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(instant / 1000) * 1000;
}

/** Serial wall-clock time in `timeZone` → the instant it denotes. */
export function serialToDate(serial: number, timeZone: string): Date {
  const wall = Math.round((EPOCH + serial * DAY_MS) / 1000) * 1000; // wall clock, encoded as if UTC
  // Two passes settle the offset across DST changes.
  let instant = wall - offsetAt(wall, timeZone);
  instant = wall - offsetAt(instant, timeZone);
  return new Date(instant);
}

/** Instant → serial wall-clock time in `timeZone`. */
export function dateToSerial(date: Date, timeZone: string): number {
  const wall = date.getTime() + offsetAt(date.getTime(), timeZone);
  return (wall - EPOCH) / DAY_MS;
}
