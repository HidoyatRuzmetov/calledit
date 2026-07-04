/** Daily post creation (R1) — runs from the scheduler, a mod menu, or install. */
import { context, reddit, redis } from '@devvit/web/server';
import { pickQuestionForDay, seedBankIfEmpty } from './bank';
import { K, getCurrentDay, getQuestion } from './store';
import { lockAtMsFor } from './time';

export type OpenOutcome =
  | { status: 'created'; day: number; postId: string; url: string }
  | { status: 'already-open'; day: number }
  | { status: 'busy' };

export async function openNextDay(force: boolean): Promise<OpenOutcome> {
  await seedBankIfEmpty(redis);
  const nowMs = Date.now();
  const current = await getCurrentDay(redis);

  if (current > 0 && !force) {
    const q = await getQuestion(redis, current);
    if (q && q.status === 'open') {
      // A day is still open — the scheduler never double-opens.
      return { status: 'already-open', day: current };
    }
  }

  const day = current + 1;
  // Atomic first-caller-wins guard: only the caller that flips 0→1 proceeds.
  const claims = await redis.incrBy(K.openLock(day), 1);
  if (claims !== 1) return { status: 'busy' };

  const picked = await pickQuestionForDay(redis, day, nowMs);
  const lockAtMs = lockAtMsFor(nowMs);

  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title: `CALLEDIT #${day} — ${picked.text}`,
    entry: 'default',
    postData: {
      day,
      text: picked.text,
      category: picked.category,
      author: picked.author,
      isRerun: picked.isRerun,
    },
    textFallback: {
      text: `CALLEDIT #${day} — ${picked.text}\n\nAnswer, guess what everyone else picked, and lock it in. Results at 11:00 UTC.`,
    },
  });

  await redis.hSet(K.q(day), {
    text: picked.text,
    category: picked.category,
    author: picked.author,
    ...(picked.authorId ? { authorId: picked.authorId } : {}),
    ...(picked.yesLabel ? { yesLabel: picked.yesLabel } : {}),
    ...(picked.noLabel ? { noLabel: picked.noLabel } : {}),
    status: 'open',
    postId: post.id,
    openAtMs: String(nowMs),
    lockAtMs: String(lockAtMs),
    isRerun: picked.isRerun ? '1' : '0',
    ...(picked.rerunOfDay ? { rerunOfDay: String(picked.rerunOfDay) } : {}),
    ...(picked.oldSplit !== undefined
      ? { oldSplit: String(picked.oldSplit) }
      : {}),
    doubleStakes: (await isDoubleStakesDay(nowMs)) ? '1' : '0',
  });
  await redis.hSet(K.postDay, { [post.id]: String(day) });
  await redis.set(K.dayCurrent, String(day));

  return {
    status: 'created',
    day,
    postId: post.id,
    url: `https://reddit.com/r/${context.subredditName}/comments/${post.id.replace('t3_', '')}`,
  };
}

async function isDoubleStakesDay(nowMs: number): Promise<boolean> {
  const flag = await redis.hGet(K.cfg, 'doubleStakesFriday');
  if (flag === '0') return false;
  return new Date(nowMs).getUTCDay() === 5;
}
