/**
 * Redis schema + data access. All game state lives here — never on the client.
 * Functions take a `Store` so tests can inject an in-memory twin.
 */
import type { CallSide, QuestionCategory, Stakes } from '../../shared/types';

export type ZMemberLike = { member: string; score: number };
export type ZRangeOptionsLike = {
  by: 'score' | 'lex' | 'rank';
  reverse?: boolean;
  limit?: { offset: number; count: number };
};

/** Structural subset of the Devvit redis client (test-injectable). */
export type Store = {
  get(key: string): Promise<string | undefined>;
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; xx?: boolean; expiration?: Date }
  ): Promise<string>;
  del(...keys: string[]): Promise<void>;
  incrBy(key: string, value: number): Promise<number>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<number>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hIncrBy(key: string, field: string, value: number): Promise<number>;
  hLen(key: string): Promise<number>;
  hDel(key: string, fields: string[]): Promise<number>;
  zAdd(key: string, ...members: ZMemberLike[]): Promise<number>;
  zCard(key: string): Promise<number>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zRank(key: string, member: string): Promise<number | undefined>;
  zRem(key: string, members: string[]): Promise<number>;
  zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: ZRangeOptionsLike
  ): Promise<{ member: string; score: number }[]>;
};

export const K = {
  dayCurrent: 'day:current',
  q: (n: number) => `q:${n}`,
  entries: (n: number) => `e:${n}`,
  tally: (n: number) => `tally:${n}`,
  reads: (n: number) => `reads:${n}`,
  score: (n: number) => `score:${n}`,
  celebrated: (n: number) => `celebrated:${n}`,
  onRecord: (n: number) => `onrecord:${n}`,
  revealSteps: (n: number) => `reveal:steps:${n}`,
  revealLock: (n: number) => `reveal:lock:${n}`,
  revealPayload: (n: number) => `reveal:payload:${n}`,
  openLock: (n: number) => `open:lock:${n}`,
  lbWeekly: 'lb:weekly',
  lbAlltime: 'lb:alltime',
  lbAlltimeZ: 'lb:alltime:z',
  user: (userId: string) => `u:${userId}`,
  authors: 'authors',
  queue: 'queue:q',
  queueItem: (id: string) => `queue:item:${id}`,
  bankJson: 'bank:json',
  bankPtr: 'bank:ptr',
  bankUgc: 'bank:ugc',
  postDay: 'postday',
  rtLast: (n: number) => `rt:last:${n}`,
  cfg: 'cfg',
  flairRetry: 'flair:retry',
} as const;

export type StoredEntry = {
  call: CallSide;
  read: number;
  stakes: Stakes;
  ts: number;
  edited: boolean;
  username: string;
};

export type StoredQuestion = {
  day: number;
  text: string;
  category: QuestionCategory;
  author: string;
  yesLabel?: string;
  noLabel?: string;
  status: 'open' | 'revealed';
  postId: string;
  openAtMs: number;
  lockAtMs: number;
  isRerun: boolean;
  rerunOfDay?: number;
  oldSplit?: number;
  doubleStakes: boolean;
  split?: number | null;
  nEntries?: number;
};

export async function getCurrentDay(store: Store): Promise<number> {
  const raw = await store.get(K.dayCurrent);
  return raw ? parseInt(raw, 10) : 0;
}

export async function getQuestion(
  store: Store,
  day: number
): Promise<StoredQuestion | null> {
  const h = await store.hGetAll(K.q(day));
  if (!h || !h['text']) return null;
  return {
    day,
    text: h['text']!,
    category: (h['category'] ?? 'HOT TAKES') as QuestionCategory,
    author: h['author'] ?? 'house',
    ...(h['yesLabel'] ? { yesLabel: h['yesLabel'] } : {}),
    ...(h['noLabel'] ? { noLabel: h['noLabel'] } : {}),
    status: h['status'] === 'revealed' ? 'revealed' : 'open',
    postId: h['postId'] ?? '',
    openAtMs: parseInt(h['openAtMs'] ?? '0', 10),
    lockAtMs: parseInt(h['lockAtMs'] ?? '0', 10),
    isRerun: h['isRerun'] === '1',
    ...(h['rerunOfDay'] ? { rerunOfDay: parseInt(h['rerunOfDay'], 10) } : {}),
    ...(h['oldSplit'] ? { oldSplit: parseFloat(h['oldSplit']) } : {}),
    doubleStakes: h['doubleStakes'] === '1',
    split:
      h['split'] === ''
        ? null
        : h['split']
          ? parseFloat(h['split'])
          : undefined,
    nEntries: h['nEntries'] ? parseInt(h['nEntries'], 10) : undefined,
  };
}

export async function getEntry(
  store: Store,
  day: number,
  userId: string
): Promise<StoredEntry | null> {
  const raw = await store.hGet(K.entries(day), userId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredEntry;
  } catch {
    return null;
  }
}

export async function getHiveSize(store: Store, day: number): Promise<number> {
  const raw = await store.hGet(K.tally(day), 'total');
  return raw ? parseInt(raw, 10) : 0;
}

/**
 * Upsert one entry (one per account per day; last write wins).
 * Adjusts tallies by delta only. Returns whether this was a brand-new lock-in.
 */
export async function upsertEntry(
  store: Store,
  day: number,
  userId: string,
  next: StoredEntry
): Promise<{ isNew: boolean }> {
  const prev = await getEntry(store, day, userId);
  const entry: StoredEntry = { ...next, edited: prev !== null };
  await store.hSet(K.entries(day), { [userId]: JSON.stringify(entry) });
  await store.zAdd(K.reads(day), { member: userId, score: entry.read });
  if (!prev) {
    await store.hIncrBy(K.tally(day), 'total', 1);
    if (entry.call === 'yes') await store.hIncrBy(K.tally(day), 'yes', 1);
    return { isNew: true };
  }
  if (prev.call !== entry.call) {
    await store.hIncrBy(K.tally(day), 'yes', entry.call === 'yes' ? 1 : -1);
  }
  return { isNew: false };
}

/** All entries of a day, streamed in hScan batches. */
export type ScanChunk = { field: string; value: string }[];
export async function scanEntries(
  store: Store & {
    hScan?: (
      key: string,
      cursor: number,
      pattern?: string,
      count?: number
    ) => Promise<{
      cursor: number;
      fieldValues: { field: string; value: string }[];
    }>;
  },
  day: number
): Promise<Map<string, StoredEntry>> {
  const out = new Map<string, StoredEntry>();
  if (store.hScan) {
    let cursor = 0;
    do {
      const res = await store.hScan(K.entries(day), cursor, undefined, 500);
      for (const fv of res.fieldValues) {
        try {
          out.set(fv.field, JSON.parse(fv.value) as StoredEntry);
        } catch {
          // skip malformed rows; scores are truth, one bad row must not stall the Reveal
        }
      }
      cursor = res.cursor;
    } while (cursor !== 0);
    return out;
  }
  const all = await store.hGetAll(K.entries(day));
  for (const [field, value] of Object.entries(all)) {
    try {
      out.set(field, JSON.parse(value) as StoredEntry);
    } catch {
      // skip malformed rows
    }
  }
  return out;
}

export async function getUserHash(
  store: Store,
  userId: string
): Promise<Record<string, string>> {
  return store.hGetAll(K.user(userId));
}
