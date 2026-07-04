/**
 * Scoring math (§3) — pure functions, no platform imports.
 * Every fixture in the spec is unit-tested against this module.
 */
import type { Stakes } from '../../shared/types';

export type Multipliers = { safe: number; bold: number; allin: number };
export const BASE_MULTIPLIERS: Multipliers = { safe: 1, bold: 2, allin: 3 };
export const DOUBLE_MULTIPLIERS: Multipliers = { safe: 2, bold: 4, allin: 6 };

/** The Split: 100·Y/N, one decimal. */
export function computeSplit(yes: number, n: number): number {
  if (n <= 0) return 0;
  return Math.round((100 * yes * 10) / n) / 10;
}

/** Sampling noise σ = 100·sqrt((s/100)(1−s/100)/N). */
export function computeSigma(split: number, n: number): number {
  if (n <= 0) return 0;
  const p = split / 100;
  return 100 * Math.sqrt((p * (1 - p)) / n);
}

/** Adaptive windows, computed at the Reveal. */
export function computeWindows(sigma: number): {
  wBold: number;
  wAllin: number;
} {
  return { wBold: Math.max(10, 2 * sigma), wAllin: Math.max(5, 2 * sigma) };
}

export type ScoreBreakdown = {
  e: number;
  base: number;
  final: number;
  bonus: number;
  dayScore: number;
  hit: boolean;
  wiped: boolean;
  contrarian: boolean;
};

/**
 * Score one entry. `median` is the median of all Reads (null when unknown).
 * Rounds once, at the final step only.
 */
export function scoreEntry(args: {
  read: number;
  stakes: Stakes;
  split: number;
  wBold: number;
  wAllin: number;
  median: number | null;
  multipliers?: Multipliers;
}): ScoreBreakdown {
  const m = args.multipliers ?? BASE_MULTIPLIERS;
  const e = Math.abs(args.read - args.split);
  const base = Math.max(0, 100 - 3 * e);
  let final = 0;
  let hit = false;
  let wiped = false;
  if (args.stakes === 'safe') {
    final = m.safe * base;
  } else if (args.stakes === 'bold') {
    if (e <= args.wBold) {
      final = m.bold * base;
      hit = true;
    } else {
      wiped = true;
    }
  } else {
    if (e <= args.wAllin) {
      final = m.allin * base;
      hit = true;
    } else {
      wiped = true;
    }
  }
  const contrarian =
    args.median !== null && e <= 3 && Math.abs(args.read - args.median) >= 10;
  const bonus = contrarian ? 25 : 0;
  return {
    e,
    base,
    final,
    bonus,
    dayScore: Math.round(final + bonus),
    hit,
    wiped,
    contrarian,
  };
}

/** Median of integer Reads (sorted ascending input not required). */
export function computeMedian(reads: number[]): number | null {
  if (reads.length === 0) return null;
  const sorted = [...reads].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Chaos Rating = 100 − 2·|Split − 50|, one decimal. */
export function computeChaos(split: number): number {
  return Math.round((100 - 2 * Math.abs(split - 50)) * 10) / 10;
}

/** 21 buckets of Read counts: 0–4, 5–9, …, 95–99, 100. */
export function computeHistogram(reads: number[]): number[] {
  const buckets = new Array<number>(21).fill(0);
  for (const r of reads) {
    const i = Math.min(20, Math.floor(r / 5));
    buckets[i] = (buckets[i] ?? 0) + 1;
  }
  return buckets;
}

/** Percentile line for the ceremony: TOP p% OF n READERS. */
export function computePercentile(fromTopIndex: number, n: number): number {
  if (n <= 0) return 100;
  return Math.max(1, Math.ceil((100 * (fromTopIndex + 1)) / n));
}

/** One decimal, as a display string (61 → "61.0"). */
export function oneDecimal(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1);
}
