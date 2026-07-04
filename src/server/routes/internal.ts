/** Scheduler jobs, mod menu, review form, install trigger. */
import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import {
  nextPendingSubmission,
  rebuildBank,
  resolveSubmission,
} from '../core/bank';
import { openNextDay } from '../core/post';
import { runReveal } from '../core/reveal';
import { K, getCurrentDay, getQuestion } from '../core/store';
import { makeRevealDeps } from './api';

export const internal = new Hono();

// ── Scheduler ────────────────────────────────────────────────────────────────

internal.post('/jobs/daily-open', async (c) => {
  const outcome = await openNextDay(false);
  console.log('daily-open', JSON.stringify(outcome));
  return c.json({ status: 'ok', outcome });
});

internal.post('/jobs/daily-reveal', async (c) => {
  const day = await getCurrentDay(redis);
  if (day === 0) return c.json({ status: 'ok', note: 'no day yet' });
  const q = await getQuestion(redis, day);
  if (!q) return c.json({ status: 'ok', note: 'missing question' });
  if (q.status === 'revealed')
    return c.json({ status: 'ok', note: 'already revealed' });
  if (Date.now() < q.lockAtMs)
    return c.json({ status: 'ok', note: 'not locked yet' });
  const outcome = await runReveal(makeRevealDeps(), day);
  console.log('daily-reveal', day, outcome.status);
  return c.json({ status: 'ok', outcome: outcome.status });
});

// ── Mod menu ─────────────────────────────────────────────────────────────────

internal.post('/menu/post-now', async (c) => {
  try {
    const outcome = await openNextDay(true);
    if (outcome.status === 'created') {
      return c.json<UiResponse>({ navigateTo: outcome.url });
    }
    return c.json<UiResponse>({
      showToast:
        outcome.status === 'already-open'
          ? `Day #${outcome.day} is still open.`
          : 'Another creation is in flight.',
    });
  } catch (e) {
    console.error('post-now failed', e);
    return c.json<UiResponse>({ showToast: 'Could not create the post.' }, 400);
  }
});

internal.post('/menu/force-reveal', async (c) => {
  const day = await getCurrentDay(redis);
  if (day === 0) return c.json<UiResponse>({ showToast: 'No day to reveal.' });
  const q = await getQuestion(redis, day);
  if (!q) return c.json<UiResponse>({ showToast: 'Missing question.' });
  if (q.status === 'revealed')
    return c.json<UiResponse>({
      showToast: `Day #${day} is already revealed.`,
    });
  // Pull the lock forward so the pipeline treats the day as locked.
  await redis.hSet(K.q(day), { lockAtMs: String(Date.now() - 1000) });
  const outcome = await runReveal(makeRevealDeps(), day);
  return c.json<UiResponse>({
    showToast:
      outcome.status === 'done'
        ? `The Reveal fired for day #${day}.`
        : `Reveal status: ${outcome.status}`,
  });
});

internal.post('/menu/reload-bank', async (c) => {
  const count = await rebuildBank(redis);
  return c.json<UiResponse>({
    showToast: `Question bank reloaded — ${count} house questions in rotation.`,
  });
});

internal.post('/menu/review-queue', async (c) => {
  const pending = await nextPendingSubmission(redis);
  if (!pending) {
    return c.json<UiResponse>({
      showToast: 'The question queue is empty.',
    });
  }
  return c.json<UiResponse>({
    showForm: {
      name: 'reviewQueue',
      form: {
        title: 'Review question queue',
        description: `by u/${pending.author} · ${pending.category}`,
        acceptLabel: 'Apply',
        fields: [
          {
            type: 'string',
            name: 'text',
            label: 'Question',
            defaultValue: pending.text,
            disabled: true,
          },
          {
            type: 'select',
            name: 'verdict',
            label: 'Verdict',
            required: true,
            options: [
              { label: 'Approve — into the bank', value: 'approve' },
              { label: 'Reject — drop it', value: 'reject' },
            ],
            defaultValue: ['approve'],
          },
        ],
      },
      data: { id: pending.id },
    },
  });
});

internal.post('/form/review-queue', async (c) => {
  const body = await c.req
    .json<{ verdict?: string[]; id?: string }>()
    .catch(() => ({}) as { verdict?: string[]; id?: string });
  const id = body.id;
  const verdict = Array.isArray(body.verdict) ? body.verdict[0] : body.verdict;
  if (!id) return c.json<UiResponse>({ showToast: 'Nothing to review.' });
  await resolveSubmission(redis, id, verdict === 'approve');
  const remaining = await nextPendingSubmission(redis);
  return c.json<UiResponse>({
    showToast:
      (verdict === 'approve' ? 'Approved. ' : 'Rejected. ') +
      (remaining ? 'More in the queue — open Review again.' : 'Queue clear.'),
  });
});

// ── Triggers ─────────────────────────────────────────────────────────────────

internal.post('/triggers/on-app-install', async (c) => {
  try {
    await redis.hSet(K.cfg, { doubleStakesFriday: '1' });
    const outcome = await openNextDay(false);
    console.log(
      `installed in ${context.subredditName}`,
      JSON.stringify(outcome)
    );
    return c.json({ status: 'success' });
  } catch (e) {
    console.error('install failed', e);
    return c.json({ status: 'error' }, 400);
  }
});
