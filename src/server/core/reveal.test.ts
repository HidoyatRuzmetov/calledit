/**
 * Integration sim (§5 tests): 60 scripted entries → one Reveal.
 * Asserts the Split, adaptive windows, scores, wipes, Prophet, Chaos,
 * the pinned comment, streaks, ranks — and full idempotency after a crash.
 */
import { describe, expect, it } from 'vitest';
import type { RevealPayload } from '../../shared/types';
import { MemoryStore } from './memoryStore';
import {
  personalRevealBlock,
  readRevealPayload,
  runReveal,
  type RevealDeps,
} from './reveal';
import { K, upsertEntry } from './store';

const DAY = 3;

type World = {
  store: MemoryStore;
  comments: string[];
  flairs: { username: string; text: string }[];
  deps: RevealDeps;
};

async function buildWorld(): Promise<World> {
  const store = new MemoryStore();
  const comments: string[] = [];
  const flairs: { username: string; text: string }[] = [];
  const deps: RevealDeps = {
    store,
    now: () => 1_800_000_000_000,
    postPinnedComment: async (_postId, text) => {
      comments.push(text);
      return 't1_reveal';
    },
    setFlairs: async (rows) => {
      flairs.push(...rows);
      return true;
    },
  };

  await store.set(K.dayCurrent, String(DAY));
  await store.hSet(K.q(DAY), {
    text: 'Is a hotdog a sandwich?',
    category: 'HOT TAKES',
    author: 'house',
    status: 'open',
    postId: 't3_sim',
    openAtMs: '1',
    lockAtMs: '2',
    isRerun: '0',
    doubleStakes: '0',
  });

  // History for weekly board + streaks: u01, u02 and A played days 1–2.
  await store.zAdd(K.score(1), { member: 'A', score: 300 });
  await store.zAdd(K.score(2), { member: 'A', score: 300 });
  await store.zAdd(K.score(1), { member: 'u01', score: 200 });
  await store.zAdd(K.score(2), { member: 'u01', score: 200 });
  await store.zAdd(K.score(1), { member: 'u02', score: 100 });
  await store.zAdd(K.score(2), { member: 'u02', score: 100 });
  for (const id of ['A', 'u01', 'u02']) {
    await store.hSet(K.user(id), {
      lastDay: '2',
      streak: '2',
      username: `user_${id}`,
    });
  }
  // u03 played day 1 then missed day 2 → streak must reset to 1.
  await store.hSet(K.user('u03'), {
    lastDay: '1',
    streak: '1',
    username: 'user_u03',
  });

  // 60 entries → 37 YES → Split 61.7. Median engineered to 51.
  let yesBudgetLow = 15; // among the 30 low readers
  for (let i = 1; i <= 30; i++) {
    const id = `u${String(i).padStart(2, '0')}`;
    await upsertEntry(store, DAY, id, {
      call: yesBudgetLow-- > 0 ? 'yes' : 'no',
      read: 50,
      stakes: 'safe',
      ts: 100 + i,
      edited: false,
      username: `user_${id}`,
    });
  }
  let yesBudgetHigh = 18; // among the 26 mid readers
  for (let i = 31; i <= 56; i++) {
    const id = `u${String(i).padStart(2, '0')}`;
    await upsertEntry(store, DAY, id, {
      call: yesBudgetHigh-- > 0 ? 'yes' : 'no',
      read: 52,
      stakes: 'safe',
      ts: 100 + i,
      edited: false,
      username: `user_${id}`,
    });
  }
  const specials = [
    { id: 'A', read: 61, stakes: 'allin' as const }, // contrarian prophet
    { id: 'B', read: 72, stakes: 'bold' as const }, // saved by adaptive window
    { id: 'C', read: 75, stakes: 'allin' as const }, // wiped
    { id: 'D', read: 62, stakes: 'safe' as const },
  ];
  for (const s of specials) {
    await upsertEntry(store, DAY, s.id, {
      call: 'yes',
      read: s.read,
      stakes: s.stakes,
      ts: 999,
      edited: false,
      username: `user_${s.id}`,
    });
  }

  // On the record: u31 (read 52 — earlier) and A (read 61 — closer).
  await store.hSet(K.onRecord(DAY), {
    u31: JSON.stringify({ read: 52, ts: 500, username: 'user_u31' }),
    A: JSON.stringify({ read: 61, ts: 1000, username: 'user_A' }),
  });

  return { store, comments, flairs, deps };
}

describe('the Reveal — 60-entry integration sim', () => {
  it('computes the Split, windows, scores, Prophet, Chaos and comment', async () => {
    const w = await buildWorld();

    // LAW 1: sealed before the Reveal.
    expect(await readRevealPayload(w.store, DAY)).toBeNull();

    const outcome = await runReveal(w.deps, DAY);
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    const p = outcome.payload;

    expect(p.n).toBe(60);
    expect(p.yes).toBe(37);
    expect(p.split).toBe(61.7);
    expect(p.median).toBe(51);
    expect(p.adaptive).toBe(true);
    expect(p.wBold).toBeCloseTo(12.55, 1);
    expect(p.wAllin).toBeCloseTo(12.55, 1);
    expect(p.chaos).toBe(76.6);

    // Scores.
    expect(await w.store.zScore(K.score(DAY), 'A')).toBe(319); // 3·97.9 + 25
    expect(await w.store.zScore(K.score(DAY), 'B')).toBe(138); // 2·69.1, inside ±12.55
    expect(await w.store.zScore(K.score(DAY), 'C')).toBe(0); // wiped at e=13.3
    expect(await w.store.zScore(K.score(DAY), 'D')).toBe(124); // 99.1 + 25 contrarian
    expect(await w.store.zScore(K.score(DAY), 'u01')).toBe(65);

    expect(p.aggregates.hits).toBe(2);
    expect(p.aggregates.wipes).toBe(1);
    expect(p.aggregates.allinWipes).toBe(1);
    expect(p.aggregates.survived).toBe(1);

    // Prophet: A (0.7 off) beats u31 (9.7 off).
    expect(p.prophet).toEqual({ username: 'user_A', read: 61 });
    expect(await w.store.hGet(K.user('A'), 'prophetCount')).toBe('1');

    // Histogram: 30 at 50→bucket 10, 26 at 52→bucket 10 too, 61→12, 62→12, 72→14, 75→15.
    expect(p.histogram).toHaveLength(21);
    expect(p.histogram[10]).toBe(56);
    expect(p.histogram[12]).toBe(2);
    expect(p.histogram[14]).toBe(1);
    expect(p.histogram[15]).toBe(1);

    // Streaks: consecutive players reach 3; a missed day resets to 1.
    expect(await w.store.hGet(K.user('A'), 'streak')).toBe('3');
    expect(await w.store.hGet(K.user('u03'), 'streak')).toBe('1');

    // Weekly board (≥3 scored days): A, u01, u02 only. A is Weekly #1.
    expect(p.hivemind).toBe('user_A');
    expect(await w.store.hGet(K.user('A'), 'rank')).toBe('Weekly #1');
    expect(await w.store.hGet(K.user('u01'), 'rank')).toBe('Reader');
    expect(await w.store.hGet(K.user('u02'), 'rank')).toBe('Hatchling');
    const aFlair = w.flairs.find((f) => f.username === 'user_A');
    expect(aFlair?.text).toBe('👑 Weekly #1 · 🔥3');

    // The pinned comment.
    expect(w.comments).toHaveLength(1);
    const comment = w.comments[0]!;
    expect(comment).toContain('🧠 CALLEDIT #3 — THE RESULTS');
    expect(comment).toContain('61.7% said YES · 38.3% said NO · 60 players');
    expect(comment).toContain(
      '🔮 Closest guess: u/user_A — said 61'
    );
    expect(comment).toContain('⚡ 2 bonus hits · 💀 1 bonus misses (1 All-Ins)');
    expect(comment).toContain('👑 Top player this week: u/user_A');

    // Personal block for A.
    const you = await personalRevealBlock(w.store, DAY, 'A');
    expect(you?.score).toBe(319);
    expect(you?.contrarian).toBe(true);
    expect(you?.percentile).toBe(2); // top of 60 readers
    expect(you?.streak).toBe(3);

    // LAW 1 after: payload flows.
    expect(await readRevealPayload(w.store, DAY)).not.toBeNull();
  });

  it('is idempotent: a second run changes nothing and never re-comments', async () => {
    const w = await buildWorld();
    const first = await runReveal(w.deps, DAY);
    const second = await runReveal(w.deps, DAY);
    expect(second.status).toBe('done');
    if (first.status !== 'done' || second.status !== 'done') return;
    expect(second.payload).toEqual(first.payload);
    expect(w.comments).toHaveLength(1);
    expect(await w.store.hGet(K.user('A'), 'prophetCount')).toBe('1');
    expect(await w.store.hGet(K.user('A'), 'streak')).toBe('3');
  });

  it('recovers from a mid-pipeline crash with an identical outcome', async () => {
    const control = await buildWorld();
    const controlOutcome = await runReveal(control.deps, DAY);
    expect(controlOutcome.status).toBe('done');

    const crashed = await buildWorld();
    crashed.store.failAfterWrites = 40; // die somewhere inside scoring/boards
    await expect(runReveal(crashed.deps, DAY)).rejects.toThrow(
      'simulated crash'
    );
    crashed.store.failAfterWrites = null;
    // The lock is stale now; the retry takes over (now() advanced past 90 s).
    const retryDeps: RevealDeps = {
      ...crashed.deps,
      now: () => 1_800_000_000_000 + 120_000,
    };
    const retryOutcome = await runReveal(retryDeps, DAY);
    expect(retryOutcome.status).toBe('done');
    if (controlOutcome.status !== 'done' || retryOutcome.status !== 'done')
      return;
    expect(retryOutcome.payload).toEqual(controlOutcome.payload);
    expect(crashed.comments).toHaveLength(1);
    expect(await crashed.store.hGet(K.user('A'), 'streak')).toBe(
      await control.store.hGet(K.user('A'), 'streak')
    );
    expect(await crashed.store.hGet(K.user('A'), 'prophetCount')).toBe('1');
  });

  it('a silent hive skips scoring and speaks tomorrow', async () => {
    const store = new MemoryStore();
    const comments: string[] = [];
    await store.set(K.dayCurrent, '1');
    await store.hSet(K.q(1), {
      text: 'Is a hotdog a sandwich?',
      category: 'HOT TAKES',
      author: 'house',
      status: 'open',
      postId: 't3_quiet',
      openAtMs: '1',
      lockAtMs: '2',
      isRerun: '0',
      doubleStakes: '0',
    });
    const deps: RevealDeps = {
      store,
      now: () => 5_000,
      postPinnedComment: async (_id, text) => {
        comments.push(text);
        return 't1_x';
      },
      setFlairs: async () => true,
    };
    const outcome = await runReveal(deps, 1);
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.payload.split).toBeNull();
    expect(outcome.payload.n).toBe(0);
    expect(comments[0]).toContain('No answers came in yesterday. New question soon.');
  });

  it('tie on the record → the earliest wins the crown', async () => {
    const store = new MemoryStore();
    await store.set(K.dayCurrent, '1');
    await store.hSet(K.q(1), {
      text: 'Is cereal breakfast soup?',
      category: 'HOT TAKES',
      author: 'house',
      status: 'open',
      postId: 't3_tie',
      openAtMs: '1',
      lockAtMs: '2',
      isRerun: '0',
      doubleStakes: '0',
    });
    for (let i = 0; i < 10; i++) {
      await upsertEntry(store, 1, `p${i}`, {
        call: i < 5 ? 'yes' : 'no',
        read: 50,
        stakes: 'safe',
        ts: i,
        edited: false,
        username: `p${i}`,
      });
    }
    // Split = 50. Both are 10 off; late locked earlier.
    await store.hSet(K.onRecord(1), {
      early: JSON.stringify({ read: 60, ts: 100, username: 'early_bird' }),
      late: JSON.stringify({ read: 40, ts: 200, username: 'late_owl' }),
    });
    const deps: RevealDeps = {
      store,
      now: () => 5_000,
      postPinnedComment: async () => 't1_y',
      setFlairs: async () => true,
    };
    const outcome = await runReveal(deps, 1);
    if (outcome.status !== 'done') throw new Error('reveal failed');
    expect(outcome.payload.prophet?.username).toBe('early_bird');
  });

  it('upsert keeps one entry per account and adjusts the tally by delta', async () => {
    const store = new MemoryStore();
    const base = {
      read: 40,
      stakes: 'safe' as const,
      ts: 1,
      edited: false,
      username: 'flip',
    };
    await upsertEntry(store, 9, 'me', { ...base, call: 'yes' });
    await upsertEntry(store, 9, 'me', { ...base, call: 'yes', read: 55 });
    await upsertEntry(store, 9, 'me', { ...base, call: 'no', read: 60 });
    const tally = await store.hGetAll(K.tally(9));
    expect(tally['total']).toBe('1');
    expect(tally['yes']).toBe('0');
    const reads = await store.zRange(K.reads(9), 0, -1, { by: 'rank' });
    expect(reads).toEqual([{ member: 'me', score: 60 }]);
  });
});

describe('double stakes day', () => {
  it('applies ×2/×4/×6 to the whole hive', async () => {
    const store = new MemoryStore();
    await store.set(K.dayCurrent, '1');
    await store.hSet(K.q(1), {
      text: 'Is it ever OK to recline an economy seat?',
      category: 'HOT TAKES',
      author: 'house',
      status: 'open',
      postId: 't3_double',
      openAtMs: '1',
      lockAtMs: '2',
      isRerun: '0',
      doubleStakes: '1',
    });
    for (let i = 0; i < 10; i++) {
      await upsertEntry(store, 1, `p${i}`, {
        call: i < 5 ? 'yes' : 'no',
        read: 50,
        stakes: i === 0 ? 'allin' : 'safe',
        ts: i,
        edited: false,
        username: `p${i}`,
      });
    }
    const deps: RevealDeps = {
      store,
      now: () => 5_000,
      postPinnedComment: async () => 't1_z',
      setFlairs: async () => true,
    };
    const outcome = await runReveal(deps, 1);
    if (outcome.status !== 'done') throw new Error('reveal failed');
    // Split 50, perfect reads: Safe ×2 → 200, All-In ×6 → 600.
    expect(await store.zScore(K.score(1), 'p1')).toBe(200);
    expect(await store.zScore(K.score(1), 'p0')).toBe(600);
    const payload: RevealPayload = outcome.payload;
    expect(payload.multipliers).toEqual({
      safe: 2,
      bold: 4,
      allin: 6,
    });
  });
});
