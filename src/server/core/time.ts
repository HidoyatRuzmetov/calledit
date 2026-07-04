/** Daily cycle math (R1) — all UTC, all decided server-side. */

export const OPEN_HOUR_UTC = 15;
export const LOCK_HOUR_UTC = 11;

/** Next 15:00 UTC strictly after `nowMs`. */
export function nextOpenAtMs(nowMs: number): number {
  const d = new Date(nowMs);
  const candidate = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    OPEN_HOUR_UTC,
    0,
    0
  );
  return candidate > nowMs ? candidate : candidate + 24 * 3600_000;
}

/**
 * The lock for a day that opens at `openAtMs`: the next 11:00 UTC at least
 * four hours away, so a manually created post still gets a fair window.
 */
export function lockAtMsFor(openAtMs: number): number {
  const d = new Date(openAtMs);
  let candidate = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    LOCK_HOUR_UTC,
    0,
    0
  );
  while (candidate < openAtMs + 4 * 3600_000) candidate += 24 * 3600_000;
  return candidate;
}

/** UTC weekday of a timestamp: 0=Sunday … 5=Friday, 6=Saturday. */
export function utcWeekday(ms: number): number {
  return new Date(ms).getUTCDay();
}

export function isSundayUtc(ms: number): boolean {
  return utcWeekday(ms) === 0;
}

export function isFridayUtc(ms: number): boolean {
  return utcWeekday(ms) === 5;
}

/** HH:MM:SS. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
