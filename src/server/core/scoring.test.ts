import { describe, expect, it } from 'vitest';
import {
  BASE_MULTIPLIERS,
  DOUBLE_MULTIPLIERS,
  computeChaos,
  computeHistogram,
  computeMedian,
  computeSigma,
  computeSplit,
  computeWindows,
  scoreEntry,
} from './scoring';

/** Spec §3 fixtures — Split = 61.0, default windows ±10 / ±5. */
describe('scoring fixtures (Split 61.0, W=10/5)', () => {
  const split = 61.0;
  const wBold = 10;
  const wAllin = 5;

  it('Read 63 All-In → e 2.0, base 94, 282', () => {
    const b = scoreEntry({
      read: 63,
      stakes: 'allin',
      split,
      wBold,
      wAllin,
      median: 61,
    });
    expect(b.e).toBeCloseTo(2.0, 10);
    expect(b.base).toBeCloseTo(94, 10);
    expect(b.dayScore).toBe(282);
    expect(b.hit).toBe(true);
  });

  it('Read 63 All-In gains +25 when the median sits at or beyond 53/73', () => {
    const low = scoreEntry({
      read: 63,
      stakes: 'allin',
      split,
      wBold,
      wAllin,
      median: 53,
    });
    expect(low.contrarian).toBe(true);
    expect(low.dayScore).toBe(307);
    const high = scoreEntry({
      read: 63,
      stakes: 'allin',
      split,
      wBold,
      wAllin,
      median: 73,
    });
    expect(high.dayScore).toBe(307);
    const near = scoreEntry({
      read: 63,
      stakes: 'allin',
      split,
      wBold,
      wAllin,
      median: 60,
    });
    expect(near.dayScore).toBe(282);
  });

  it('Read 63 Safe → 94', () => {
    const b = scoreEntry({
      read: 63,
      stakes: 'safe',
      split,
      wBold,
      wAllin,
      median: 61,
    });
    expect(b.dayScore).toBe(94);
  });

  it('Read 70 Bold → e 9.0, base 73, 146', () => {
    const b = scoreEntry({
      read: 70,
      stakes: 'bold',
      split,
      wBold,
      wAllin,
      median: 61,
    });
    expect(b.e).toBeCloseTo(9.0, 10);
    expect(b.dayScore).toBe(146);
    expect(b.hit).toBe(true);
  });

  it('Read 72 Bold → wiped by 1.0', () => {
    const b = scoreEntry({
      read: 72,
      stakes: 'bold',
      split,
      wBold,
      wAllin,
      median: 61,
    });
    expect(b.e).toBeCloseTo(11.0, 10);
    expect(b.dayScore).toBe(0);
    expect(b.wiped).toBe(true);
  });

  it('Read 50 Safe → 67', () => {
    const b = scoreEntry({
      read: 50,
      stakes: 'safe',
      split,
      wBold,
      wAllin,
      median: 61,
    });
    expect(b.dayScore).toBe(67);
  });

  it('Read 61 All-In → perfect 300', () => {
    const b = scoreEntry({
      read: 61,
      stakes: 'allin',
      split,
      wBold,
      wAllin,
      median: 61,
    });
    expect(b.e).toBe(0);
    expect(b.dayScore).toBe(300);
  });

  it('rounds once, at the final step only', () => {
    // Split 61.7, Read 63 → e = 1.3 → base = 96.1 → ×3 = 288.3 → 288.
    // Rounding the base early would give 3·96 = 288 too, so also check ×2:
    // 2·96.1 = 192.2 → 192, while a mid-pipeline round of 96.1→96 gives 192 as well;
    // the distinguishing case is e = 1.1 (base 96.7): ×3 = 290.1 → 290, early-round 291.
    const b = scoreEntry({
      read: 63,
      stakes: 'allin',
      split: 61.9,
      wBold: 10,
      wAllin: 5,
      median: 61,
    });
    expect(b.e).toBeCloseTo(1.1, 10);
    expect(b.dayScore).toBe(290);
  });
});

describe('double stakes multipliers (R8)', () => {
  it('doubles every tier on Fridays', () => {
    const safe = scoreEntry({
      read: 61,
      stakes: 'safe',
      split: 61,
      wBold: 10,
      wAllin: 5,
      median: 61,
      multipliers: DOUBLE_MULTIPLIERS,
    });
    expect(safe.dayScore).toBe(200);
    const allin = scoreEntry({
      read: 61,
      stakes: 'allin',
      split: 61,
      wBold: 10,
      wAllin: 5,
      median: 61,
      multipliers: DOUBLE_MULTIPLIERS,
    });
    expect(allin.dayScore).toBe(600);
    expect(BASE_MULTIPLIERS.allin).toBe(3);
  });
});

describe('adaptive windows', () => {
  it('N=54, s=61 → σ≈6.6 → windows widen to ±13.3', () => {
    const sigma = computeSigma(61, 54);
    expect(sigma).toBeCloseTo(6.637, 2);
    const { wBold, wAllin } = computeWindows(sigma);
    expect(wBold).toBeCloseTo(13.27, 1);
    expect(wAllin).toBeCloseTo(13.27, 1);
    expect(Math.round(wBold * 10) / 10).toBe(13.3);
  });

  it('a Bold miss of 11 survives inside the widened window', () => {
    const { wBold, wAllin } = computeWindows(computeSigma(61, 54));
    const b = scoreEntry({
      read: 72,
      stakes: 'bold',
      split: 61,
      wBold,
      wAllin,
      median: 61,
    });
    expect(b.wiped).toBe(false);
    expect(b.dayScore).toBe(134);
  });

  it('large hives keep the floor windows ±10/±5', () => {
    const { wBold, wAllin } = computeWindows(computeSigma(61, 10_000));
    expect(wBold).toBe(10);
    expect(wAllin).toBe(5);
  });

  it('a unanimous hive is valid (Split 0/100, σ=0)', () => {
    expect(computeSplit(0, 40)).toBe(0);
    expect(computeSplit(40, 40)).toBe(100);
    expect(computeSigma(100, 40)).toBe(0);
    const { wBold, wAllin } = computeWindows(0);
    expect(wBold).toBe(10);
    expect(wAllin).toBe(5);
  });
});

describe('helpers', () => {
  it('computes the Split to one decimal', () => {
    expect(computeSplit(37, 60)).toBe(61.7);
    expect(computeSplit(1, 3)).toBe(33.3);
  });

  it('median: odd, even, empty', () => {
    expect(computeMedian([10, 50, 90])).toBe(50);
    expect(computeMedian([10, 50, 60, 90])).toBe(55);
    expect(computeMedian([])).toBeNull();
  });

  it('chaos peaks at a perfect 50/50', () => {
    expect(computeChaos(50)).toBe(100);
    expect(computeChaos(61.7)).toBe(76.6);
    expect(computeChaos(0)).toBe(0);
  });

  it('histogram has 21 buckets and catches 100', () => {
    const h = computeHistogram([0, 4, 5, 99, 100, 100]);
    expect(h).toHaveLength(21);
    expect(h[0]).toBe(2);
    expect(h[1]).toBe(1);
    expect(h[19]).toBe(1);
    expect(h[20]).toBe(2);
  });
});
