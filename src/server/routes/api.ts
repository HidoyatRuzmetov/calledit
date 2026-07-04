import { Hono } from 'hono';
import { context, reddit, redis, realtime } from '@devvit/web/server';
import type {
  EntryRequest,
  EntryResponse,
  ErrResponse,
  HiveMessage,
  LeaderboardResponse,
  LeaderboardRow,
  LeaderboardScope,
  OkResponse,
  ProfileResponse,
  QuestionSubmission,
  RevealPayload,
  StateResponse,
} from '../../shared/types';
import { COPY } from '../../shared/copy';
import { validateCategory, validateQuestionText } from '../../shared/validate';
import { enqueueSubmission } from '../core/bank';
import {
  personalRevealBlock,
  readRevealPayload,
  runReveal,
  type RevealDeps,
} from '../core/reveal';
import { buildState } from '../core/state';
import {
  K,
  getCurrentDay,
  getEntry,
  getHiveSize,
  getQuestion,
  upsertEntry,
} from '../core/store';
import { formatCountdown } from '../core/time';

export const api = new Hono();

function err(code: string, message: string): ErrResponse {
  return { ok: false, code, message };
}

function isT3(id: string): id is `t3_${string}` {
  return id.startsWith('t3_');
}

export function makeRevealDeps(): RevealDeps {
  return {
    store: redis,
    now: () => Date.now(),
    postPinnedComment: async (postId, text) => {
      if (!isT3(postId)) return null;
      const comment = await reddit.submitComment({
        id: postId,
        text,
        runAs: 'APP',
      });
      await comment.distinguish(true).catch(() => undefined);
      return comment.id;
    },
    setFlairs: async (rows) => {
      const sub = context.subredditName;
      for (let i = 0; i < rows.length; i += 100) {
        await reddit.setUserFlairBatch(
          sub,
          rows
            .slice(i, i + 100)
            .map((r) => ({ username: r.username, text: r.text }))
        );
      }
      return true;
    },
  };
}

/** Reveal the day if it is overdue — idempotent, first caller wins. */
async function kickRevealIfOverdue(nowMs: number): Promise<void> {
  const day = await getCurrentDay(redis);
  if (day === 0) return;
  const q = await getQuestion(redis, day);
  if (!q || q.status !== 'open') return;
  if (nowMs < q.lockAtMs + 30_000) return;
  await runReveal(makeRevealDeps(), day).catch((e) =>
    console.error(`reveal kick failed for day ${day}`, e)
  );
}

api.get('/state', async (c) => {
  const nowMs = Date.now();
  await kickRevealIfOverdue(nowMs);
  const state: StateResponse | null = await buildState({
    store: redis,
    postId: context.postId,
    userId: context.userId,
    username: context.username ?? (await reddit.getCurrentUsername()),
    nowMs,
  });
  if (!state)
    return c.json(err('no-day', 'No question yet — check back soon.'), 404);
  return c.json(state);
});

api.post('/entry', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json(err('login', COPY.login_gate), 401);

  const day = await postDayOrCurrent();
  const q = await getQuestion(redis, day);
  if (!q) return c.json(err('no-day', 'No question yet.'), 404);
  const nowMs = Date.now();
  if (q.status !== 'open' || nowMs >= q.lockAtMs) {
    return c.json(
      err('locked', COPY.err_locked(formatCountdown(q.lockAtMs - nowMs))),
      409
    );
  }

  let body: EntryRequest;
  try {
    body = await c.req.json<EntryRequest>();
  } catch {
    return c.json(err('bad-entry', 'Malformed entry.'), 400);
  }
  if (body.call !== 'yes' && body.call !== 'no')
    return c.json(err('bad-call', COPY.call_required), 400);
  const read = Number(body.read);
  if (!Number.isInteger(read) || read < 0 || read > 100)
    return c.json(
      err('bad-read', 'Your Read must be a whole number 0–100.'),
      400
    );
  if (
    body.stakes !== 'safe' &&
    body.stakes !== 'bold' &&
    body.stakes !== 'allin'
  )
    return c.json(err('bad-stakes', 'Pick your Stakes.'), 400);

  const username =
    context.username ?? (await reddit.getCurrentUsername()) ?? '[departed]';
  const { isNew } = await upsertEntry(redis, day, userId, {
    call: body.call,
    read,
    stakes: body.stakes,
    ts: nowMs,
    edited: false,
    username,
  });
  await redis.hSet(K.user(userId), { username });

  const hiveSize = await getHiveSize(redis, day);
  if (isNew) {
    // Throttled hive-size publish (≥2 s); the client also refreshes on a timer.
    const last = await redis.get(K.rtLast(day));
    if (!last || nowMs - parseInt(last, 10) >= 2000) {
      await redis.set(K.rtLast(day), String(nowMs));
      const msg: HiveMessage = { hiveSize, day };
      try {
        await realtime.send(`hive_${day}`, msg);
      } catch {
        // realtime is best-effort; the periodic refresh covers it
      }
    }
  }

  const onRecord = !!(await redis.hGet(K.onRecord(day), userId));
  const res: EntryResponse = {
    ok: true,
    entry: {
      call: body.call,
      read,
      stakes: body.stakes,
      tsMs: nowMs,
      edited: !isNew,
      onRecord,
      celebrated: false,
    },
    hiveSize,
  };
  return c.json(res);
});

api.post('/on-record', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json(err('login', COPY.login_gate), 401);
  const day = await postDayOrCurrent();
  const q = await getQuestion(redis, day);
  const nowMs = Date.now();
  if (!q || q.status !== 'open' || nowMs >= q.lockAtMs)
    return c.json(err('locked', 'The record is closed for today.'), 409);
  const entry = await getEntry(redis, day, userId);
  if (!entry)
    return c.json(
      err('no-entry', 'Lock In first — then go on the record.'),
      400
    );
  const already = await redis.hGet(K.onRecord(day), userId);
  if (already)
    return c.json(err('once', 'You are already on the record today.'), 409);

  // The stored read is "% picking YES"; the comment speaks in the player's side.
  const text = COPY.on_record_body(
    entry.call === 'yes' ? entry.read : 100 - entry.read,
    entry.call === 'yes' ? (q.yesLabel ?? 'YES') : (q.noLabel ?? 'NO')
  );
  let commentId = '';
  if (isT3(q.postId)) {
    try {
      const comment = await reddit.submitComment({
        id: q.postId,
        text,
        runAs: 'USER',
      });
      commentId = comment.id;
    } catch {
      try {
        const comment = await reddit.submitComment({
          id: q.postId,
          text: `u/${entry.username} goes on the record:\n\n${text}`,
          runAs: 'APP',
        });
        commentId = comment.id;
      } catch {
        return c.json(err('comment-failed', COPY.err_network), 502);
      }
    }
  }
  await redis.hSet(K.onRecord(day), {
    [userId]: JSON.stringify({
      read: entry.read,
      ts: nowMs,
      username: entry.username,
      commentId,
    }),
  });
  const res: OkResponse = { ok: true, message: 'On the record.' };
  return c.json(res);
});

// LAW 1 gate — 403 while the day is open, no exceptions.
api.get('/reveal/:day', async (c) => {
  const day = parseInt(c.req.param('day'), 10);
  if (!Number.isInteger(day) || day < 1)
    return c.json(err('bad-day', 'No such day.'), 400);
  const payload = await readRevealPayload(redis, day);
  if (!payload) {
    return c.json(
      err('sealed', 'Results aren’t out yet.'),
      403
    );
  }
  const userId = context.userId;
  const you = userId
    ? await personalRevealBlock(redis, day, userId)
    : undefined;
  const out: RevealPayload = { ...payload, ...(you ? { you } : {}) };
  return c.json(out);
});

api.post('/celebrated', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json(err('login', COPY.login_gate), 401);
  const body = await c.req.json<{ day: number }>().catch(() => ({ day: 0 }));
  const day = Number(body.day);
  if (Number.isInteger(day) && day >= 1) {
    await redis.hSet(K.celebrated(day), { [userId]: '1' });
  }
  return c.json({ ok: true } as OkResponse);
});

api.post('/seen-how', async (c) => {
  const userId = context.userId;
  if (userId) await redis.hSet(K.user(userId), { seenHow: '1' });
  return c.json({ ok: true } as OkResponse);
});

api.get('/leaderboard', async (c) => {
  const scopeRaw = c.req.query('scope') ?? 'weekly';
  const scope: LeaderboardScope =
    scopeRaw === 'daily' || scopeRaw === 'alltime' || scopeRaw === 'authors'
      ? scopeRaw
      : 'weekly';
  const out = await buildLeaderboard(scope, context.userId);
  return c.json(out);
});

async function nameOf(userId: string): Promise<string> {
  return (await redis.hGet(K.user(userId), 'username')) ?? '[departed]';
}

async function buildLeaderboard(
  scope: LeaderboardScope,
  userId: string | undefined
): Promise<LeaderboardResponse> {
  let key: string = K.lbWeekly;
  if (scope === 'daily') {
    const today = await getCurrentDay(redis);
    const q = await getQuestion(redis, today);
    const day = q && q.status === 'revealed' ? today : today - 1;
    key = K.score(Math.max(1, day));
  } else if (scope === 'alltime') key = K.lbAlltimeZ;
  else if (scope === 'authors') key = K.authors;

  const top = await redis.zRange(key, 0, 49, { by: 'rank', reverse: true });
  const rows: LeaderboardRow[] = [];
  for (let i = 0; i < top.length; i++) {
    const r = top[i]!;
    const row: LeaderboardRow = {
      place: i + 1,
      username: await nameOf(r.member),
      value: Math.round(r.score * 10) / 10,
    };
    if (scope === 'authors') {
      const cnt = await redis.hGet(K.user(r.member), 'authorCount');
      row.extra = `${cnt ?? '1'} featured`;
    }
    rows.push(row);
  }

  let you: LeaderboardRow | undefined;
  if (userId) {
    const score = await redis.zScore(key, userId);
    if (score !== undefined) {
      const asc = await redis.zRank(key, userId);
      const total = await redis.zCard(key);
      you = {
        place: asc === undefined ? total : total - asc,
        username: await nameOf(userId),
        value: Math.round(score * 10) / 10,
      };
    }
  }

  const first = top[0];
  return {
    scope,
    rows,
    ...(you ? { you } : {}),
    ...(scope === 'weekly' && first
      ? { hivemind: await nameOf(first.member) }
      : {}),
  };
}

api.get('/profile', async (c) => {
  const target = context.userId;
  if (!target) return c.json(err('login', COPY.login_gate), 401);
  return c.json(await buildProfile(target));
});

api.get('/profile/:userId', async (c) => {
  const target = c.req.param('userId');
  const u = await redis.hGetAll(K.user(target));
  if (!u['username'])
    return c.json(err('unknown', 'No trace of this reader.'), 404);
  return c.json(await buildProfile(target));
});

async function buildProfile(target: string): Promise<ProfileResponse> {
  const u = await redis.hGetAll(K.user(target));
  const weekly = await redis.zScore(K.lbWeekly, target);
  let careerPercentile: number | null = null;
  const days = parseInt(u['daysPlayed'] ?? '0', 10);
  if (days >= 10) {
    const asc = await redis.zRank(K.lbAlltimeZ, target);
    const total = await redis.zCard(K.lbAlltimeZ);
    if (asc !== undefined && total > 0) {
      careerPercentile = Math.max(1, Math.ceil((100 * (total - asc)) / total));
    }
  }
  return {
    username: u['username'] ?? '[departed]',
    rank: u['rank'] ?? 'Hatchling',
    weeklyMean: weekly === undefined ? null : Math.round(weekly * 10) / 10,
    careerPercentile,
    streak: parseInt(u['streak'] ?? '0', 10),
    prophetCount: parseInt(u['prophetCount'] ?? '0', 10),
    bestDay: u['bestDay'] ? parseInt(u['bestDay'], 10) : null,
    bestScore: u['bestScore'] ? parseInt(u['bestScore'], 10) : null,
    daysPlayed: days,
    authorBest: u['authorBest'] ? parseFloat(u['authorBest']) : null,
    authorCount: parseInt(u['authorCount'] ?? '0', 10),
  };
}

api.post('/question', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json(err('login', COPY.login_gate), 401);
  const fallback: QuestionSubmission = { text: '', category: 'HOT TAKES' };
  const body = await c.req.json<QuestionSubmission>().catch(() => fallback);
  const verdict = validateQuestionText(body.text ?? '');
  if (!verdict.ok) return c.json(err('invalid', verdict.reason), 400);
  if (!validateCategory(body.category))
    return c.json(err('invalid', 'Pick a category.'), 400);
  const today = await getCurrentDay(redis);
  const sent = await redis.hIncrBy(K.user(userId), `qsub:${today}`, 1);
  if (sent > 3)
    return c.json(
      err('rate', 'Three a day keeps the mods sane. Try tomorrow.'),
      429
    );
  const username =
    context.username ?? (await reddit.getCurrentUsername()) ?? '[departed]';
  await enqueueSubmission(
    redis,
    {
      text: body.text.trim(),
      category: body.category,
      authorId: userId,
      author: username,
    },
    Date.now()
  );
  return c.json({ ok: true, message: COPY.author_ok } as OkResponse);
});

api.post('/share', async (c) => {
  const userId = context.userId;
  if (!userId) return c.json(err('login', COPY.login_gate), 401);
  const body = await c.req.json<{ day: number }>().catch(() => ({ day: 0 }));
  const day = Number(body.day);
  const payload = await readRevealPayload(redis, day);
  if (!payload || payload.split === null)
    return c.json(err('sealed', 'Share it after the Reveal.'), 403);
  const you = await personalRevealBlock(redis, day, userId);
  if (!you)
    return c.json(err('no-entry', 'No entry of yours on this day.'), 400);
  const stinger = you.wiped
    ? you.stakes === 'allin'
      ? COPY.wiped_allin
      : COPY.wiped_bold
    : you.stakes === 'safe'
      ? 'SAFE'
      : you.stakes === 'bold'
        ? COPY.hit_bold
        : COPY.hit_allin;
  // Guess and result are both shown for the side the player picked.
  const youPickedYes = you.call === 'yes';
  const text = COPY.share_card_text(
    day,
    youPickedYes ? you.read : 100 - you.read,
    youPickedYes
      ? (payload.question.yesLabel ?? 'YES')
      : (payload.question.noLabel ?? 'NO'),
    (youPickedYes ? payload.split : 100 - payload.split).toFixed(1),
    stinger,
    you.percentile
  );
  const q = await getQuestion(redis, day);
  if (!q || !isT3(q.postId))
    return c.json(err('no-post', 'This day has no post.'), 404);
  try {
    await reddit.submitComment({ id: q.postId, text, runAs: 'USER' });
  } catch {
    try {
      await reddit.submitComment({
        id: q.postId,
        text: `u/${(await reddit.getCurrentUsername()) ?? 'a reader'} posts their card:\n\n${text}`,
        runAs: 'APP',
      });
    } catch {
      return c.json(err('comment-failed', COPY.err_network), 502);
    }
  }
  return c.json({
    ok: true,
    message: 'Card posted to the thread.',
  } as OkResponse);
});

async function postDayOrCurrent(): Promise<number> {
  if (context.postId) {
    const mapped = await redis.hGet(K.postDay, context.postId);
    if (mapped) return parseInt(mapped, 10);
  }
  return getCurrentDay(redis);
}
