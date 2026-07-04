/** Copy deck — exact strings on every surface. Plain language, no jargon. */

export const COPY = {
  slider_caption: (x: number) =>
    `You're saying ${x} out of 100 people pick YES.`,
  slider_caption_split: (x: number, label: string) =>
    `You're saying ${x} out of 100 people pick ${label}.`,
  call_required: `Pick your answer first.`,
  stakes_safe: `SAFE — always scores`,
  stakes_bold: (w: string) => `BOLD — ×2 if your guess is within ${w}`,
  stakes_allin: (w: string) => `ALL-IN — ×3 if within ${w}, or 0`,
  stakes_bold_double: (w: string) => `BOLD — ×4 if your guess is within ${w}`,
  stakes_allin_double: (w: string) => `ALL-IN — ×6 if within ${w}, or 0`,
  lock_cta: `LOCK IN`,
  locked_stamp: `LOCKED`,
  locked_sub: (countdown: string) => `Results at 11:00 UTC · ${countdown}`,
  edit_hint: `You can change your answer until time runs out.`,
  tease: (author: string, cat: string) =>
    `Tomorrow's question is by u/${author} — ${cat}.`,
  reveal_reading: (n: number) => `COUNTING ${n} ANSWERS`,
  reveal_truth: (s: string) => `THE RESULT: ${s}%`,
  reveal_miss: (e: string) => `off by ${e}`,
  hit_bold: `⚡ BOLD BONUS ×2`,
  hit_allin: `🎯 ALL-IN BONUS ×3`,
  hit_bold_double: `⚡ BOLD BONUS ×4`,
  hit_allin_double: `🎯 ALL-IN BONUS ×6`,
  wiped_allin: `ALL-IN MISSED — 0 points`,
  wiped_bold: `BOLD MISSED — 0 points`,
  contrarian: `+25 BONUS — you went against the crowd and got it right.`,
  percentile: (p: number, n: number) => `TOP ${p}% OF ${n} PLAYERS`,
  streak_up: (d: number) => `🔥 ${d}-day streak`,
  rank_up: (rank: string) => `RANK UP: ${rank}`,
  throne: `👑 #1 this week.`,
  on_record_cta: `📜 Post my guess`,
  on_record_body: (x: number, label: string) =>
    `📜 My guess is in: ${x} out of 100 pick ${label}. — via CalledIt`,
  prophet_crown: (name: string, x: number) =>
    `🔮 Closest guess: u/${name} said ${x}.`,
  intermission: (countdown: string) =>
    `That's it for today. Next question in ${countdown}.`,
  empty_day1: `Day one — no results yet. Watch a demo to see how it works.`,
  author_ok: `Submitted! If your question gets picked, it runs for a day.`,
  author_chaos: (_c: number, s: number) =>
    `Your question split people ${s}/${100 - s}.`,
  err_locked: (countdown: string) =>
    `Answers are closed. Results in ${countdown}.`,
  err_network: `Connection problem. Your answer is safe — try again.`,
  login_gate: `Log in to play.`,
  share_card_text: (
    n: number,
    x: number,
    label: string,
    s: string,
    stinger: string,
    p: number
  ) =>
    `🧠 CALLEDIT #${n} · my guess: ${x} pick ${label} · result ${s} · ${stinger} · top ${p}%`,
  silent_hive: `No answers came in yesterday. New question soon.`,
  influence_rule: `Your answer counts toward the result too.`,
  small_hive: (n: number, w: string) =>
    `Only ${n} players today, so the bonus ranges widened to ±${w}.`,
} as const;

/** The results comment, auto-posted and pinned when the day ends. */
export function revealCommentText(args: {
  day: number;
  split: number | null;
  n: number;
  yesLabel?: string;
  noLabel?: string;
  prophet?: { username: string; read: number };
  hits: number;
  wipes: number;
  allinWipes: number;
  hivemind?: string;
  drift?: { oldDay: number; oldSplit: number };
}): string {
  const lines: string[] = [`🧠 CALLEDIT #${args.day} — THE RESULTS`];
  if (args.split === null) {
    lines.push(COPY.silent_hive);
  } else {
    const a = args.yesLabel ?? 'YES';
    const b = args.noLabel ?? 'NO';
    const s = args.split;
    const inv = Math.round((100 - s) * 10) / 10;
    lines.push(`${s}% said ${a} · ${inv}% said ${b} · ${args.n} players`);
    if (args.prophet) {
      lines.push(
        `🔮 Closest guess: u/${args.prophet.username} — said ${args.prophet.read}`
      );
    }
    lines.push(
      `⚡ ${args.hits} bonus hits · 💀 ${args.wipes} bonus misses (${args.allinWipes} All-Ins)`
    );
    if (args.hivemind) lines.push(`👑 Top player this week: u/${args.hivemind}`);
    if (args.drift) {
      lines.push(
        `📈 Same question on #${args.drift.oldDay}: was ${args.drift.oldSplit}% — now ${s}%`
      );
    }
  }
  lines.push(`New question tomorrow. Think you can call it?`);
  return lines.join('\n\n');
}
