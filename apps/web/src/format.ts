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
