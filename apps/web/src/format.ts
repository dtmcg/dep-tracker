/**
 * Format an ISO date-time as e.g. "Wed 4 Nov 2026, 09:00" in the given locale
 * and zone. Words are localised; the layout is fixed so it doesn't drift with
 * the browser's ICU data.
 */
export function formatDateTime(iso: string, locale?: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")}`;
}

export interface DateStyle {
  /** Include the hours and minutes. */
  time: boolean;
  /** Include the weekday (default true). */
  weekday?: boolean;
}

/** Like formatDateTime, but the hours and minutes (and weekday) are optional: "Wed 4 Nov 2026", "4 Nov 2026, 09:00". */
export function formatMoment(iso: string, style: DateStyle, locale?: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${style.weekday === false ? "" : `${part("weekday")} `}${part("day")} ${part("month")} ${part("year")}`;
  return style.time ? `${date}, ${part("hour")}:${part("minute")}` : date;
}
