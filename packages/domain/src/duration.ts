/**
 * Durations are wall-clock (calendar) time, written as human strings such as
 * "3d", "4h" or "1w 2d". Units: w(eeks), d(ays), h(ours), m(inutes), each at
 * most once and in that order.
 */
export class DurationError extends Error {
  constructor(input: string) {
    super(`Invalid duration "${input}": use whole numbers with units w, d, h, m, e.g. "1w 2d" or "4h"`);
    this.name = "DurationError";
  }
}

const MINUTE_MS = 60_000;
const UNIT_MS = { w: 7 * 24 * 60 * MINUTE_MS, d: 24 * 60 * MINUTE_MS, h: 60 * MINUTE_MS, m: MINUTE_MS } as const;
const PATTERN = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/;

/** Parse a duration string into milliseconds. */
export function parseDuration(input: string): number {
  const compact = input.replace(/\s+/g, "").toLowerCase();
  const match = PATTERN.exec(compact);
  if (!compact || !match) throw new DurationError(input);
  const [, w, d, h, m] = match;
  return (
    Number(w ?? 0) * UNIT_MS.w + Number(d ?? 0) * UNIT_MS.d + Number(h ?? 0) * UNIT_MS.h + Number(m ?? 0) * UNIT_MS.m
  );
}
