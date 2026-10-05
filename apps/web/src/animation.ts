const DAY = 86_400_000;

/**
 * Seconds for one dash cycle on an edge, scaled to the dependency's work time
 * (FR-15: longer work, slower flow). Logarithmic so a quarter-long task is not
 * frozen next to an hour-long one; clamped to stay readable.
 */
export function dashSeconds(workMs: number): number {
  const days = Math.max(0, workMs) / DAY;
  return Math.min(6, 0.5 + 1.1 * Math.log2(1 + days * 2));
}
