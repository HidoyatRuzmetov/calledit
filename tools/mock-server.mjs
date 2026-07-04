/**
 * Local preview harness — serves dist/client with an in-memory twin of the
 * /api contract so the whole loop (Lock In → Reveal ceremony → board) can be
 * played in a plain browser, no Reddit required. Never deployed.
 *
 *   npm run build && npm run preview:mock
 *   → http://localhost:4173/game.html   (the instrument)
 *   → http://localhost:4173/splash.html (the in-feed card)
 *
 * The day locks 90 seconds after boot so the "counting answers" tick and the
 * live ceremony can be watched end to end. Flags: ?phase=revealed to jump.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../dist/client', import.meta.url));
const PORT = 4173;
const BOOT = Date.now();
const LOCK_AT = BOOT + 90_000;
const NEXT_OPEN = BOOT + 4 * 3600_000;

const question = {
  day: 12,
  text: 'Is it ever OK to recline an economy seat?',
  category: 'HOT TAKES',
  author: 'house',
  isRerun: false,
  doubleStakes: false,
};

const hive = { size: 217, yes: 129 };
let entry = null;
let onRecord = false;
let celebrated = false;
let seenHow = false;

const yesterdayPayload = {
  day: 11,
  question: {
    day: 11,
    text: 'Would you take $500K right now, or a coin flip at $5M?',
    category: 'MONEY',
    author: 'poppy_seed_11',
    yesLabel: 'TAKE $500K',
    noLabel: 'FLIP FOR $5M',
    isRerun: false,
    doubleStakes: false,
  },
  n: 342,
  split: 58.5,
  yes: 200,
  no: 142,
  sigma: 2.66,
  wBold: 10,
  wAllin: 5,
  adaptive: false,
  median: 55,
  histogram: [
    0, 0, 1, 2, 3, 5, 8, 13, 21, 34, 45, 52, 48, 39, 28, 19, 12, 7, 3, 1, 1,
  ],
  aggregates: { hits: 96, wipes: 61, allinWipes: 38, survived: 21 },
  prophet: { username: 'graticule_ghost', read: 58 },
  hivemind: 'the_quiet_needle',
  chaos: 83,
  multipliers: { safe: 1, bold: 2, allin: 3 },
  you: entryToYou(58),
};

function entryToYou(read) {
  return {
    call: 'yes',
    read,
    stakes: 'bold',
    e: 0.5,
    base: 98.5,
    score: 197,
    hit: true,
    wiped: false,
    contrarian: false,
    percentile: 4,
    rank: 'Mentalist',
    rankBefore: 'Reader',
    streak: 6,
  };
}

function todayPayload() {
  const n = hive.size;
  const split = Math.round((1000 * hive.yes) / n) / 10;
  const e = entry ? Math.abs(entry.read - split) : 0;
  const base = Math.max(0, 100 - 3 * e);
  const mult = entry?.stakes === 'allin' ? 3 : entry?.stakes === 'bold' ? 2 : 1;
  const inWindow =
    entry?.stakes === 'safe' || e <= (entry?.stakes === 'bold' ? 10 : 5);
  return {
    day: question.day,
    question,
    n,
    split,
    yes: hive.yes,
    no: n - hive.yes,
    sigma: 3.3,
    wBold: 10,
    wAllin: 5,
    adaptive: false,
    median: 55,
    histogram: [
      0, 1, 1, 2, 4, 7, 11, 17, 26, 35, 41, 38, 29, 20, 13, 8, 5, 3, 1, 0, 0,
    ],
    aggregates: { hits: 71, wipes: 43, allinWipes: 25, survived: 14 },
    prophet:
      onRecord && entry
        ? { username: 'you_local', read: entry.read }
        : { username: 'amber_marker', read: 57 },
    hivemind: 'the_quiet_needle',
    chaos: Math.round((100 - 2 * Math.abs(split - 50)) * 10) / 10,
    multipliers: { safe: 1, bold: 2, allin: 3 },
    you: entry
      ? {
          call: entry.call,
          read: entry.read,
          stakes: entry.stakes,
          e,
          base,
          score: inWindow ? Math.round(mult * base) : 0,
          hit: entry.stakes !== 'safe' && inWindow,
          wiped: entry.stakes !== 'safe' && !inWindow,
          contrarian: e <= 3 && Math.abs(entry.read - 55) >= 10,
          percentile: 9,
          rank: 'Reader',
          rankBefore: 'Hatchling',
          streak: 3,
        }
      : undefined,
  };
}

function phase() {
  return Date.now() >= LOCK_AT + 8000
    ? 'revealed'
    : Date.now() >= LOCK_AT
      ? 'revealing'
      : 'open';
}

const rows = (base) =>
  Array.from({ length: 12 }, (_, i) => ({
    place: i + 1,
    username: [
      'the_quiet_needle',
      'graticule_ghost',
      'amber_marker',
      'phosphor_monk',
      'split_whisperer',
      'crt_cassandra',
      'hive_sommelier',
      'needle_nun',
      'gap_bracket',
      'truth_thunk',
      'sigma_wide',
      'you_local',
    ][i],
    value: Math.round((base - i * base * 0.06) * 10) / 10,
  }));

const api = {
  'GET /api/state': () => ({
    serverNowMs: Date.now(),
    today: question.day,
    day: question.day,
    isToday: true,
    phase: phase(),
    question,
    hiveSize: hive.size,
    lockAtMs: LOCK_AT,
    nextOpenAtMs: NEXT_OPEN,
    you: { loggedIn: true, username: 'you_local', seenHow },
    yourEntry: entry
      ? { ...entry, tsMs: entry.ts, edited: entry.edited, onRecord, celebrated }
      : undefined,
    streak: 3,
    yourRank: 'Reader',
    yesterday: { day: 11, revealed: true },
    archive: [{ day: 11 }, { day: 10 }, { day: 9 }, { day: 8 }],
  }),
  'POST /api/entry': (body) => {
    if (phase() !== 'open')
      return {
        status: 409,
        body: {
          ok: false,
          code: 'locked',
          message: 'Answers are closed. Results are coming.',
        },
      };
    const edited = entry !== null;
    if (!edited) {
      hive.size += 1;
      if (body.call === 'yes') hive.yes += 1;
    } else if (entry.call !== body.call) {
      hive.yes += body.call === 'yes' ? 1 : -1;
    }
    entry = {
      call: body.call,
      read: body.read,
      stakes: body.stakes,
      ts: Date.now(),
      edited,
    };
    return {
      ok: true,
      entry: { ...entry, tsMs: entry.ts, onRecord, celebrated: false },
      hiveSize: hive.size,
    };
  },
  'POST /api/seen-how': () => {
    seenHow = true;
    return { ok: true };
  },
  'POST /api/on-record': () => {
    onRecord = true;
    return { ok: true, message: 'On the record.' };
  },
  'GET /api/reveal/11': () => yesterdayPayload,
  'GET /api/reveal/12': () =>
    phase() === 'revealed'
      ? todayPayload()
      : {
          status: 403,
          body: {
            ok: false,
            code: 'sealed',
            message: 'Results aren’t out yet.',
          },
        },
  'GET /api/reveal/10': () => ({
    ...yesterdayPayload,
    day: 10,
    you: undefined,
    prophet: undefined,
  }),
  'GET /api/reveal/9': () => ({
    ...yesterdayPayload,
    day: 9,
    you: undefined,
    split: 22.4,
    yes: 77,
    no: 265,
    chaos: 44.8,
  }),
  'GET /api/reveal/8': () => ({ ...yesterdayPayload, day: 8, you: undefined }),
  'POST /api/celebrated': () => {
    celebrated = true;
    return { ok: true };
  },
  'GET /api/leaderboard': (q) => ({
    scope: q.get('scope') ?? 'weekly',
    rows: rows(q.get('scope') === 'daily' ? 280 : 240),
    you: { place: 12, username: 'you_local', value: 178.5 },
    hivemind: 'the_quiet_needle',
  }),
  'GET /api/profile': () => ({
    username: 'you_local',
    rank: 'Reader',
    weeklyMean: 178.5,
    careerPercentile: 22,
    streak: 3,
    prophetCount: 1,
    bestDay: 9,
    bestScore: 291,
    daysPlayed: 14,
    authorBest: 83,
    authorCount: 1,
  }),
  'POST /api/question': () => ({
    ok: true,
    message: 'Submitted! If your question gets picked, it runs for a day.',
  }),
  'POST /api/share': () => ({
    ok: true,
    message: 'Card posted to the thread. (mock)',
  }),
};

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = `${req.method} ${url.pathname}`;
  const handler =
    api[key] ?? (url.pathname.startsWith('/api/') ? null : undefined);
  if (handler) {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      } catch {
        body = {};
      }
    }
    const out = handler(req.method === 'POST' ? body : url.searchParams);
    const status = out?.status ?? 200;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out?.status ? out.body : out));
    return;
  }
  if (handler === null) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        code: 'unknown',
        message: 'No such route in the mock.',
      })
    );
    return;
  }
  const file = url.pathname === '/' ? '/game.html' : url.pathname;
  try {
    const data = await readFile(join(ROOT, file));
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`CalledIt mock preview → http://localhost:${PORT}/game.html`);
  console.log(
    `The day locks ${new Date(LOCK_AT).toLocaleTimeString()} (90 s) — watch the live Reveal.`
  );
});
