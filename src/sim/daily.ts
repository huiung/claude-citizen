// Pure daily-objective + login-streak logic. No THREE, no DOM. Tested in daily.test.ts.

/** UTC 'YYYY-MM-DD' for an epoch-ms timestamp. */
export function dayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}
