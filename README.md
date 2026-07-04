# CALLEDIT

**A daily game about guessing the crowd.**

Every day, one arguable question drops — _"Is it ever OK to recline an economy
seat?"_, _"Would you take $500K right now, or a coin flip at $5M?"_ — and the
game is never the question itself. You win by predicting how everyone else
answers, not by being right.

Built for Reddit's **Games with a Hook** hackathon on **Devvit Web**, running
entirely as an Interactive Post.

---

## The loop (15 seconds a day)

1. **Answer the question.** YES or NO (some days: option A or option B). Your
   answer counts toward the result everyone is trying to guess.
2. **Guess the crowd.** Slide to the number: out of 100 players, how many pick
   your side? This is the skill. This is the whole game.
3. **Pick a bonus.**
   - `SAFE — always scores`
   - `BOLD — ×2 if your guess is within 10`
   - `ALL-IN — ×3 if within 5, or 0 if you miss`
4. **LOCK IN.** Answers stay hidden until results at 11:00 UTC, when the real
   number drops and everyone is scored on how close they got.

Miss the range on Bold or All-In and you score 0 for the day. A new question
starts at 15:00 UTC.

## Scoring, in plain language

```
result = the real % that picked YES (one decimal)
miss   = how far your guess was from the result
base   = max(0, 100 − 3×miss)        → a perfect guess = 100
SAFE   = base        BOLD = 2×base within its range, else 0
ALL-IN = 3×base within a tighter range, else 0
```

- **Fair on quiet days.** When only a few people play, the bonus ranges widen
  automatically (never below ±10 / ±5), and the results screen says so.
- **+25 bonus** for going against the crowd and still landing within 3.
- **Friday = double bonus day.** ×2 / ×4 / ×6 for one day.
- Only guess accuracy produces points — streaks, authorship, and participation
  are flair, never score.

## The hooks

- **📜 Post my guess.** Once a day, before lock, post your guess into the
  thread as a real comment. At results time the closest posted guess is
  crowned in the pinned comment. Public bragging, public accountability.
- **👑 Weekly #1.** Exactly one player wears the crown in user flair until
  someone does better. Ranks below it (Oracle, Mentalist, Empath, Reader,
  Hatchling) are written to Reddit flair at every results run.
- **🔥 Streaks.** 3 / 7 / 14 / 30-day marks on your flair. Miss a day, back to
  zero. Cosmetic only, painful anyway.
- **Player questions.** Anyone can submit a question from inside the app.
  One featured author per day, credited on the card. Author questions are
  ranked by how evenly they split the crowd — a perfect 50/50 tops the board.
- **Repeat Sundays.** A past question returns word-for-word; the results show
  how the crowd's answer moved since the first asking.
- **Campaigning is legal.** Your answer counts toward the result, and talking
  it up in the comments is part of the game.
- **The archive.** Every past day stays open forever in its revealed state,
  with the results ceremony replayable.

## The results ceremony

Six seconds, once a day, and it gets the entire motion budget: the dots gather
into a sweeping beam, the real number snaps into place, a marker measures your
miss, the bonus stinger hits (or the red miss does), your score counts up, and
the percentile stamp lands. Skippable with a tap, replayable forever,
instant-render under `prefers-reduced-motion`.

Cold visitors get `▸ yesterday's results` at any hour — and on Day 1, a
clearly labeled DEMO.

## Design — "The Swarm"

The crowd is drawn as a living thing: a field of glowing gold dots that drifts
while you think, streams toward the slider while you set your guess, spreads
back out when you lock in, and rains down when a bonus misses. Deep indigo
night, gold for the crowd, cool blue for you, huge Bricolage Grotesque type,
and one focal element per step — the loop plays as three almost wordless
beats, with the rules behind a small `?` (shown once, automatically, on first
visit).

The whole client is **native Phaser 4** — every screen is a scene, every
transition a tween. The canvas renders at full device resolution (high-DPI
aware), so text stays sharp at any Windows/macOS display scale. No DOM UI
except one input in the composer. Textures are generated at boot (zero raster
art, zero external requests); fonts ship as subset WOFF2 (OFL). Fully
responsive: phone-first, full-bleed on desktop.

## Architecture

```
src/client   native Phaser 4 — Boot/Play/Reveal/Board scenes, swarm engine, panels
src/server   Hono on @devvit/web/server — routes, jobs, pure scoring engine
src/shared   contracts, copy deck, composer validation
devvit.json  post entrypoints, scheduler crons, mod menu, review form, permissions
```

- **All state in Redis** — an app update never touches an entry (nothing lives
  in browser storage).
- **No peeking:** tallies and the guess histogram are impossible to obtain
  before results. They are serialized in exactly one server function that
  asserts `status === 'revealed'`; `/api/reveal/{day}` returns 403 while open;
  `/api/state` exposes only the player count.
- **Scheduler:** `daily_open` (cron `0 15 * * *`) creates the post;
  `daily_reveal` (cron `0 11 * * *`) locks, scores, publishes. The results
  pipeline is idempotent — every step is flag-guarded, so a crash mid-run
  re-runs to an identical outcome (unit-proven). An overdue results run is
  also self-healing: the next `/api/state` call kicks it.
- **Realtime** player-count channel with a 30 s refresh fallback.
- **Flair is decoration, scores are truth:** flair writes are batched, and on
  rate-limit the remainder defers to a retry queue without blocking scoring.

## Mod tools (subreddit menu)

- **CalledIt — create today's post now**
- **CalledIt — review question queue** (approve / reject, one tap each)
- **CalledIt — force the Reveal (test)**
- **CalledIt — reload question bank** (re-seeds the house questions from the
  latest deployed code — run this after changing `questions.ts`)

## Run it

```bash
npm install
npm run login      # authenticate the Devvit CLI
npm run dev        # playtest: builds, uploads, and live-reloads on your test subreddit
```

`npm run dev` prints a playtest URL on your test subreddit. Install triggers
Day 1 automatically; use the mod menu to force results instead of waiting for
11:00 UTC.

No subreddit handy? Preview the full UI on a local mock:

```bash
npm run build && npm run preview:mock
# → http://localhost:4173/game.html  (the day locks 90 s after boot — stay for the ceremony)
```

### Verify

```bash
npm run type-check   # strict TS, project references
npm run lint         # eslint, zero warnings
npm test             # scoring fixtures, adaptive ranges, a 60-entry results
                     # sim, crash-recovery idempotency, Sunday repeats,
                     # double-bonus days, the composer validator
npm run build        # vite → dist/client + dist/server
```

### Deploy

```bash
npm run deploy       # type-check + lint + devvit upload (new real version)
npm run launch       # deploy + publish for review
```

### Troubleshooting (Windows)

- **`Vite requires Node.js 20.19+ or 22.12+` / `Cannot find native binding`
  (rolldown)** — upgrade Node to the 22 LTS, then do a clean install:

  ```bat
  winget install OpenJS.NodeJS.LTS   :: or grab 22.x from nodejs.org / nvm-windows
  rd /s /q node_modules
  del package-lock.json
  npm install
  ```

- **`You must be logged in to upload`** — the saved token expired; run
  `npm run login` again.
- **`EBADENGINE` warnings** — old Node; they vanish on 22.x.
- **npm audit noise** — all in dev-time tooling, nothing ships to Reddit.
  Don't run `npm audit fix --force` (it breaks vite).

## Content rules

House questions are arguable by design (target result 25–75), globally
relatable, playful-spicy, never cruel. The composer validator and the mod
queue both enforce: ≤120 characters, ends with `?`, cleanly yes-or-no, and no
electoral politics, religion, protected-class comparisons, NSFW, self-harm,
weapons, drugs, fresh tragedies, or identifiable private persons.

## Assets

`assets/icon.svg` (+ 256/1024 PNG) — the needle at 63 on a graticule; the
1024 PNG doubles as the app icon (`marketingAssets` in `devvit.json`).
`assets/wordmark.svg` (+ PNG).
Fonts: Bricolage Grotesque & Space Grotesk, SIL Open Font License, subset and
bundled locally.

---

_New question tomorrow. Think you can call it?_
