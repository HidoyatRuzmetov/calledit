/** /api/state builder — hiveSize (a count) is the only crowd number exposed. */
import type { StateResponse, YourEntry } from '../../shared/types';
import {
  K,
  getCurrentDay,
  getEntry,
  getHiveSize,
  getQuestion,
  type Store,
} from './store';
import { nextOpenAtMs } from './time';

export async function buildState(args: {
  store: Store;
  postId: string | undefined;
  userId: string | undefined;
  username: string | undefined;
  nowMs: number;
}): Promise<StateResponse | null> {
  const { store, nowMs } = args;
  const today = await getCurrentDay(store);
  if (today === 0) return null;

  let day = today;
  if (args.postId) {
    const mapped = await store.hGet(K.postDay, args.postId);
    if (mapped) day = parseInt(mapped, 10);
  }

  const q = await getQuestion(store, day);
  if (!q) return null;

  const phase =
    q.status === 'revealed'
      ? 'revealed'
      : nowMs >= q.lockAtMs
        ? 'revealing'
        : 'open';

  let yourEntry: YourEntry | undefined;
  let streak = 0;
  let yourRank: string | undefined;
  let seenHow = false;
  if (args.userId) {
    const e = await getEntry(store, day, args.userId);
    if (e) {
      const onRecord = !!(await store.hGet(K.onRecord(day), args.userId));
      const celebrated = !!(await store.hGet(K.celebrated(day), args.userId));
      yourEntry = {
        call: e.call,
        read: e.read,
        stakes: e.stakes,
        tsMs: e.ts,
        edited: e.edited,
        onRecord,
        celebrated,
      };
    }
    const u = await store.hGetAll(K.user(args.userId));
    streak = parseInt(u['streak'] ?? '0', 10);
    if (u['rank']) yourRank = u['rank'];
    seenHow = u['seenHow'] === '1';
  }

  const archive: { day: number }[] = [];
  for (let d = day - 1; d >= Math.max(1, day - 7); d--) {
    const status = await store.hGet(K.q(d), 'status');
    if (status === 'revealed') archive.push({ day: d });
  }

  const yesterdayDay = day - 1;
  const yesterdayStatus =
    yesterdayDay >= 1
      ? await store.hGet(K.q(yesterdayDay), 'status')
      : undefined;

  const todayPostId =
    day !== today ? await store.hGet(K.q(today), 'postId') : undefined;

  return {
    serverNowMs: nowMs,
    today,
    day,
    isToday: day === today,
    phase,
    question: {
      day,
      text: q.text,
      category: q.category,
      author: q.author,
      ...(q.yesLabel ? { yesLabel: q.yesLabel } : {}),
      ...(q.noLabel ? { noLabel: q.noLabel } : {}),
      isRerun: q.isRerun,
      doubleStakes: q.doubleStakes,
    },
    hiveSize: await getHiveSize(store, day),
    lockAtMs: q.lockAtMs,
    nextOpenAtMs: nextOpenAtMs(nowMs),
    you: {
      loggedIn: !!args.userId,
      ...(args.username ? { username: args.username } : {}),
      seenHow,
    },
    ...(yourEntry ? { yourEntry } : {}),
    streak,
    ...(yourRank ? { yourRank } : {}),
    ...(yesterdayDay >= 1
      ? {
          yesterday: {
            day: yesterdayDay,
            revealed: yesterdayStatus === 'revealed',
          },
        }
      : {}),
    archive,
    ...(todayPostId ? { todayPostId } : {}),
  };
}
