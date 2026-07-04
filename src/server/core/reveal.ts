/**
 * The Reveal pipeline (§5) — idempotent, step-guarded, safe to re-run after a
 * crash at any point. LAW 1: this module is the ONLY place tallies and the
 * Read histogram are ever serialized, and only after status flips to revealed.
 */
import type { RevealPayload, Rank } from '../../shared/types';
import { revealCommentText } from '../../shared/copy';
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
  type Multipliers,
} from './scoring';
import {
  K,
  getQuestion,
  scanEntries,
  type Store,
  type StoredEntry,
} from './store';

export type RevealDeps = {
  store: Store;
  now: () => number;
  /** Posts + pins the reveal comment; returns the comment id or null. */
  postPinnedComment: (postId: string, text: string) => Promise<string | null>;
  /** Batch flair write; returns true when applied. */
  setFlairs: (rows: { username: string; text: string }[]) => Promise<boolean>;
};

const STEPS = [
  'freeze',
  'score',
  'prophet',
  'boards',
  'ranks',
  'payload',
  'comment',
] as const;
type Step = (typeof STEPS)[number];

async function stepDone(
  store: Store,
  day: number,
  step: Step
): Promise<boolean> {
  return (await store.hGet(K.revealSteps(day), step)) === '1';
}
async function markStep(store: Store, day: number, step: Step): Promise<void> {
  await store.hSet(K.revealSteps(day), { [step]: '1' });
}

const RANK_MARKS: Record<Rank, string> = {
  'Weekly #1': '👑 Weekly #1',
  Oracle: '🔮 Oracle',
  Mentalist: '🧠 Mentalist',
  Empath: '💛 Empath',
  Reader: '📈 Reader',
  Hatchling: '🐣 Hatchling',
};

function streakMark(streak: number): string {
  if (streak >= 30) return ' · 🏮30';
  if (streak >= 14) return ' · ⚡14';
  if (streak >= 7) return ' · 🔥7';
  if (streak >= 3) return ' · 🔥3';
  return '';
}

export type RevealOutcome =
  | { status: 'done'; payload: RevealPayload }
  | { status: 'busy' }
  | { status: 'missing' };

export async function runReveal(
  deps: RevealDeps,
  day: number
): Promise<RevealOutcome> {
  const { store } = deps;
  const q = await getQuestion(store, day);
  if (!q) return { status: 'missing' };

  // Already fully revealed → return the stored payload.
  if (q.status === 'revealed' && (await stepDone(store, day, 'comment'))) {
    const raw = await store.get(K.revealPayload(day));
    if (raw)
      return { status: 'done', payload: JSON.parse(raw) as RevealPayload };
  }

  // Single-runner lock with a stale takeover so a killed run cannot wedge the day.
  const lockKey = K.revealLock(day);
  const nowMs = deps.now();
  const claims = await store.incrBy(`${lockKey}:n`, 1);
  if (claims !== 1) {
    const heldSince = await store.get(lockKey);
    if (heldSince && nowMs - parseInt(heldSince, 10) < 90_000) {
      return { status: 'busy' };
    }
    // The previous runner went quiet mid-pipeline — take over.
  }
  await store.set(lockKey, String(nowMs));

  try {
    const mult: Multipliers = q.doubleStakes
      ? DOUBLE_MULTIPLIERS
      : BASE_MULTIPLIERS;

    // ── Step 2: freeze the tally, compute Split / σ / windows, flip status ──
    if (!(await stepDone(store, day, 'freeze'))) {
      const tally = await store.hGetAll(K.tally(day));
      const n = parseInt(tally['total'] ?? '0', 10);
      const yes = parseInt(tally['yes'] ?? '0', 10);
      const split = n > 0 ? computeSplit(yes, n) : null;
      const sigma = split === null ? 0 : computeSigma(split, n);
      const { wBold, wAllin } = computeWindows(sigma);
      const readRows = await store.zRange(K.reads(day), 0, -1, { by: 'rank' });
      const median = computeMedian(readRows.map((r) => r.score));
      await store.hSet(K.q(day), {
        status: 'revealed',
        split: split === null ? '' : String(split),
        nEntries: String(n),
        yesCount: String(yes),
        sigma: String(sigma),
        wBold: String(wBold),
        wAllin: String(wAllin),
        median: median === null ? '' : String(median),
        chaos: split === null ? '' : String(computeChaos(split)),
      });
      await markStep(store, day, 'freeze');
    }

    const frozen = await store.hGetAll(K.q(day));
    const split = frozen['split'] ? parseFloat(frozen['split']) : null;
    const wBold = parseFloat(frozen['wBold'] ?? '10');
    const wAllin = parseFloat(frozen['wAllin'] ?? '5');
    const median = frozen['median'] ? parseFloat(frozen['median']) : null;

    // ── Step 3: score every entry ──
    if (!(await stepDone(store, day, 'score'))) {
      if (split !== null) {
        const entries = await scanEntries(store, day);
        let hits = 0;
        let wipes = 0;
        let allinWipes = 0;
        let allinSurvived = 0;
        const zbatch: { member: string; score: number }[] = [];
        for (const [userId, e] of entries) {
          const b = scoreEntry({
            read: e.read,
            stakes: e.stakes,
            split,
            wBold,
            wAllin,
            median,
            multipliers: mult,
          });
          zbatch.push({ member: userId, score: b.dayScore });
          if (b.hit) hits++;
          if (b.wiped) wipes++;
          if (b.wiped && e.stakes === 'allin') allinWipes++;
          if (b.hit && e.stakes === 'allin') allinSurvived++;
        }
        for (let i = 0; i < zbatch.length; i += 100) {
          const chunk = zbatch.slice(i, i + 100);
          if (chunk.length) await store.zAdd(K.score(day), ...chunk);
        }
        await store.hSet(K.q(day), {
          hits: String(hits),
          wipes: String(wipes),
          allinWipes: String(allinWipes),
          allinSurvived: String(allinSurvived),
        });
      }
      await markStep(store, day, 'score');
    }

    // ── Step 4: crown the Prophet from the on-record book ──
    if (!(await stepDone(store, day, 'prophet'))) {
      if (split !== null) {
        const book = await store.hGetAll(K.onRecord(day));
        let best: {
          userId: string;
          read: number;
          ts: number;
          username: string;
        } | null = null;
        for (const [userId, raw] of Object.entries(book)) {
          try {
            const rec = JSON.parse(raw) as {
              read: number;
              ts: number;
              username: string;
            };
            if (
              !best ||
              Math.abs(rec.read - split) < Math.abs(best.read - split) ||
              (Math.abs(rec.read - split) === Math.abs(best.read - split) &&
                rec.ts < best.ts)
            ) {
              best = { userId, ...rec };
            }
          } catch {
            // ignore malformed rows
          }
        }
        if (best) {
          await store.hSet(K.q(day), {
            prophetUsername: best.username,
            prophetRead: String(best.read),
          });
          await store.hIncrBy(K.user(best.userId), 'prophetCount', 1);
        }
      }
      await markStep(store, day, 'prophet');
    }

    // ── Step 5: streaks, career sums, weekly + all-time boards ──
    if (!(await stepDone(store, day, 'boards'))) {
      const entries = await scanEntries(store, day);
      for (const [userId, e] of entries) {
        const u = await store.hGetAll(K.user(userId));
        const lastDay = parseInt(u['lastDay'] ?? '0', 10);
        if (lastDay === day) continue; // re-run safety: already applied
        const prevStreak = parseInt(u['streak'] ?? '0', 10);
        const streak = lastDay === day - 1 ? prevStreak + 1 : 1;
        const score = (await store.zScore(K.score(day), userId)) ?? 0;
        const bestScore = parseInt(u['bestScore'] ?? '-1', 10);
        const patch: Record<string, string> = {
          username: e.username,
          streak: String(streak),
          lastDay: String(day),
          daysPlayed: String(parseInt(u['daysPlayed'] ?? '0', 10) + 1),
        };
        if (score > bestScore) {
          patch['bestScore'] = String(score);
          patch['bestDay'] = String(day);
        }
        await store.hSet(K.user(userId), patch);
        const at = (await store.hGet(K.lbAlltime, userId)) ?? '0|0';
        const [sumRaw, daysRaw] = at.split('|');
        const sum = parseFloat(sumRaw ?? '0') + score;
        const days = parseInt(daysRaw ?? '0', 10) + 1;
        await store.hSet(K.lbAlltime, { [userId]: `${sum}|${days}` });
        if (days >= 10) {
          await store.zAdd(K.lbAlltimeZ, { member: userId, score: sum / days });
        }
      }
      // Weekly: mean of scored days in the last 7, needs ≥3 scored days.
      const acc = new Map<string, { sum: number; cnt: number }>();
      for (let d = Math.max(1, day - 6); d <= day; d++) {
        const rows = await store.zRange(K.score(d), 0, -1, { by: 'rank' });
        for (const r of rows) {
          const a = acc.get(r.member) ?? { sum: 0, cnt: 0 };
          a.sum += r.score;
          a.cnt += 1;
          acc.set(r.member, a);
        }
      }
      await store.del(K.lbWeekly);
      const weekly: { member: string; score: number }[] = [];
      for (const [userId, a] of acc) {
        if (a.cnt >= 3) weekly.push({ member: userId, score: a.sum / a.cnt });
      }
      for (let i = 0; i < weekly.length; i += 100) {
        const chunk = weekly.slice(i, i + 100);
        if (chunk.length) await store.zAdd(K.lbWeekly, ...chunk);
      }
      // Featured author: credit Chaos (R7). Cosmetic-only, never points.
      const authorId = frozen['authorId'];
      const chaos = frozen['chaos'] ? parseFloat(frozen['chaos']) : null;
      if (authorId && chaos !== null && frozen['author'] !== 'house') {
        const prevBest = await store.zScore(K.authors, authorId);
        if (prevBest === undefined || chaos > prevBest) {
          await store.zAdd(K.authors, { member: authorId, score: chaos });
          await store.hSet(K.user(authorId), { authorBest: String(chaos) });
        }
        await store.hIncrBy(K.user(authorId), 'authorCount', 1);
        await store.hSet(K.user(authorId), {
          username: frozen['author'] ?? '',
        });
      }
      await markStep(store, day, 'boards');
    }

    // ── Step 6: ranks → flair (decoration; on failure defer, never block) ──
    if (!(await stepDone(store, day, 'ranks'))) {
      const weeklyDesc = await store.zRange(K.lbWeekly, 0, -1, {
        by: 'rank',
        reverse: true,
      });
      const w = weeklyDesc.length;
      const rankOf = new Map<string, Rank>();
      weeklyDesc.forEach((row, i) => {
        let rank: Rank;
        if (i === 0) rank = 'Weekly #1';
        else if (i + 1 <= Math.max(1, Math.ceil(w * 0.03))) rank = 'Oracle';
        else if (i + 1 <= Math.ceil(w * 0.1)) rank = 'Mentalist';
        else if (i + 1 <= Math.ceil(w * 0.25)) rank = 'Empath';
        else if (i + 1 <= Math.ceil(w * 0.5)) rank = 'Reader';
        else rank = 'Hatchling';
        rankOf.set(row.member, rank);
      });
      const hivemind = weeklyDesc[0]?.member;
      if (hivemind) {
        const name = await store.hGet(K.user(hivemind), 'username');
        await store.hSet(K.q(day), { hivemind: name ?? '[departed]' });
      }
      const entries = await scanEntries(store, day);
      const flairRows: { username: string; text: string }[] = [];
      for (const [userId, e] of entries) {
        const rank: Rank = rankOf.get(userId) ?? 'Hatchling';
        const u = await store.hGetAll(K.user(userId));
        const prevRank = u['rank'] ?? '';
        const streak = parseInt(u['streak'] ?? '0', 10);
        const milestone =
          streak === 3 || streak === 7 || streak === 14 || streak === 30;
        if (prevRank !== rank || milestone) {
          await store.hSet(K.user(userId), {
            rank,
            rankPrev: prevRank || 'Hatchling',
          });
          flairRows.push({
            username: e.username,
            text: `${RANK_MARKS[rank]}${streakMark(streak)}`,
          });
        }
      }
      if (flairRows.length) {
        const applied = await deps.setFlairs(flairRows).catch(() => false);
        if (!applied) {
          // Defer: flair is decoration, scores are truth.
          for (const row of flairRows) {
            await store.zAdd(K.flairRetry, {
              member: JSON.stringify(row),
              score: deps.now(),
            });
          }
        }
      }
      await markStep(store, day, 'ranks');
    }

    // ── Step 7: build + store the public payload (single serialization point) ──
    if (!(await stepDone(store, day, 'payload'))) {
      const payload = await buildPayload(store, day);
      await store.set(K.revealPayload(day), JSON.stringify(payload));
      await markStep(store, day, 'payload');
    }

    // ── Step 8: post + pin the reveal comment ──
    if (!(await stepDone(store, day, 'comment'))) {
      const fresh = await store.hGetAll(K.q(day));
      const text = revealCommentText({
        day,
        split: fresh['split'] ? parseFloat(fresh['split']) : null,
        n: parseInt(fresh['nEntries'] ?? '0', 10),
        ...(fresh['yesLabel'] ? { yesLabel: fresh['yesLabel'] } : {}),
        ...(fresh['noLabel'] ? { noLabel: fresh['noLabel'] } : {}),
        ...(fresh['prophetUsername']
          ? {
              prophet: {
                username: fresh['prophetUsername']!,
                read: parseInt(fresh['prophetRead'] ?? '0', 10),
              },
            }
          : {}),
        hits: parseInt(fresh['hits'] ?? '0', 10),
        wipes: parseInt(fresh['wipes'] ?? '0', 10),
        allinWipes: parseInt(fresh['allinWipes'] ?? '0', 10),
        ...(fresh['hivemind'] ? { hivemind: fresh['hivemind'] } : {}),
        ...(fresh['isRerun'] === '1' && fresh['oldSplit'] && fresh['split']
          ? {
              drift: {
                oldDay: parseInt(fresh['rerunOfDay'] ?? '0', 10),
                oldSplit: parseFloat(fresh['oldSplit']),
              },
            }
          : {}),
      });
      const postId = frozen['postId'] ?? '';
      if (postId) {
        const commentId = await deps
          .postPinnedComment(postId, text)
          .catch(() => null);
        if (commentId)
          await store.hSet(K.q(day), { revealCommentId: commentId });
      }
      await markStep(store, day, 'comment');
    }

    const raw = await store.get(K.revealPayload(day));
    return { status: 'done', payload: JSON.parse(raw!) as RevealPayload };
  } finally {
    await store.del(lockKey, `${lockKey}:n`);
  }
}

/** LAW 1 gate: the ONLY reader of tallies. Throws unless status is revealed. */
export async function readRevealPayload(
  store: Store,
  day: number
): Promise<RevealPayload | null> {
  const q = await getQuestion(store, day);
  if (!q || q.status !== 'revealed') return null;
  const raw = await store.get(K.revealPayload(day));
  if (!raw) return null;
  return JSON.parse(raw) as RevealPayload;
}

async function buildPayload(store: Store, day: number): Promise<RevealPayload> {
  const h = await store.hGetAll(K.q(day));
  if (h['status'] !== 'revealed') {
    throw new Error('LAW 1: refusing to serialize before the Reveal');
  }
  const n = parseInt(h['nEntries'] ?? '0', 10);
  const split = h['split'] ? parseFloat(h['split']) : null;
  const yes = parseInt(h['yesCount'] ?? '0', 10);
  const readRows = await store.zRange(K.reads(day), 0, -1, { by: 'rank' });
  const histogram = computeHistogram(readRows.map((r) => r.score));
  const doubleStakes = h['doubleStakes'] === '1';
  return {
    day,
    question: {
      day,
      text: h['text'] ?? '',
      category: (h['category'] ??
        'HOT TAKES') as RevealPayload['question']['category'],
      author: h['author'] ?? 'house',
      ...(h['yesLabel'] ? { yesLabel: h['yesLabel'] } : {}),
      ...(h['noLabel'] ? { noLabel: h['noLabel'] } : {}),
      isRerun: h['isRerun'] === '1',
      doubleStakes,
    },
    n,
    split,
    yes,
    no: n - yes,
    sigma: parseFloat(h['sigma'] ?? '0'),
    wBold: parseFloat(h['wBold'] ?? '10'),
    wAllin: parseFloat(h['wAllin'] ?? '5'),
    adaptive: parseFloat(h['wBold'] ?? '10') > 10,
    median: h['median'] ? parseFloat(h['median']) : null,
    histogram,
    aggregates: {
      hits: parseInt(h['hits'] ?? '0', 10),
      wipes: parseInt(h['wipes'] ?? '0', 10),
      allinWipes: parseInt(h['allinWipes'] ?? '0', 10),
      survived: parseInt(h['allinSurvived'] ?? '0', 10),
    },
    ...(h['prophetUsername']
      ? {
          prophet: {
            username: h['prophetUsername']!,
            read: parseInt(h['prophetRead'] ?? '0', 10),
          },
        }
      : {}),
    ...(h['hivemind'] ? { hivemind: h['hivemind'] } : {}),
    ...(h['isRerun'] === '1' && h['oldSplit']
      ? {
          drift: {
            oldDay: parseInt(h['rerunOfDay'] ?? '0', 10),
            oldSplit: parseFloat(h['oldSplit']),
          },
        }
      : {}),
    chaos: h['chaos'] ? parseFloat(h['chaos']) : null,
    multipliers: doubleStakes ? DOUBLE_MULTIPLIERS : BASE_MULTIPLIERS,
  };
}

/** Per-caller block appended to the payload after the LAW 1 gate passes. */
export async function personalRevealBlock(
  store: Store,
  day: number,
  userId: string
): Promise<RevealPayload['you'] | undefined> {
  const h = await store.hGetAll(K.q(day));
  if (h['status'] !== 'revealed' || !h['split']) return undefined;
  const raw = await store.hGet(K.entries(day), userId);
  if (!raw) return undefined;
  const e = JSON.parse(raw) as StoredEntry;
  const split = parseFloat(h['split']!);
  const mult =
    h['doubleStakes'] === '1' ? DOUBLE_MULTIPLIERS : BASE_MULTIPLIERS;
  const b = scoreEntry({
    read: e.read,
    stakes: e.stakes,
    split,
    wBold: parseFloat(h['wBold'] ?? '10'),
    wAllin: parseFloat(h['wAllin'] ?? '5'),
    median: h['median'] ? parseFloat(h['median']) : null,
    multipliers: mult,
  });
  const n = parseInt(h['nEntries'] ?? '0', 10);
  const asc = await store.zRank(K.score(day), userId);
  const fromTop = asc === undefined ? n - 1 : n - 1 - asc;
  const u = await store.hGetAll(K.user(userId));
  return {
    call: e.call,
    read: e.read,
    stakes: e.stakes,
    e: b.e,
    base: b.base,
    score: b.dayScore,
    hit: b.hit,
    wiped: b.wiped,
    contrarian: b.contrarian,
    percentile: Math.max(1, Math.ceil((100 * (fromTop + 1)) / Math.max(1, n))),
    rank: u['rank'] ?? 'Hatchling',
    rankBefore: u['rankPrev'] ?? 'Hatchling',
    streak: parseInt(u['streak'] ?? '0', 10),
  };
}
