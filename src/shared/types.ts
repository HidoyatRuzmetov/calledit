/** Shared contracts between client and server. */

export type CallSide = 'yes' | 'no';
export type Stakes = 'safe' | 'bold' | 'allin';

/** Phase of a single day, as decided by the server clock. */
export type DayPhase = 'open' | 'revealing' | 'revealed';

export type QuestionCategory =
  | 'HOT TAKES'
  | 'MONEY'
  | 'MORALS'
  | 'HYPOTHETICALS'
  | 'CONFESSIONS'
  | 'META';

/** Question data that is safe to show at any time (never carries tallies). */
export type PublicQuestion = {
  day: number;
  text: string;
  category: QuestionCategory;
  /** 'house' or the featured author's username. */
  author: string;
  /** Optional custom labels for a two-option split question. */
  yesLabel?: string;
  noLabel?: string;
  isRerun: boolean;
  doubleStakes: boolean;
};

export type YourEntry = {
  call: CallSide;
  read: number;
  stakes: Stakes;
  tsMs: number;
  edited: boolean;
  onRecord: boolean;
  celebrated: boolean;
};

export type ArchiveChip = { day: number };

export type StateResponse = {
  serverNowMs: number;
  /** The newest day. */
  today: number;
  /** The day this post belongs to. */
  day: number;
  isToday: boolean;
  phase: DayPhase;
  question: PublicQuestion;
  /** Count of locked entries. Never the tally. */
  hiveSize: number;
  lockAtMs: number;
  nextOpenAtMs: number;
  you: { loggedIn: boolean; username?: string; seenHow: boolean };
  yourEntry?: YourEntry;
  streak: number;
  yourRank?: string;
  yesterday?: { day: number; revealed: boolean };
  archive: ArchiveChip[];
  /** Post id of today's post, for navigation from archived posts. */
  todayPostId?: string;
};

export type EntryRequest = { call: CallSide; read: number; stakes: Stakes };

export type EntryResponse = {
  ok: true;
  entry: YourEntry;
  hiveSize: number;
};

export type RevealAggregates = {
  hits: number;
  wipes: number;
  allinWipes: number;
  survived: number;
};

export type RevealYou = {
  call: CallSide;
  read: number;
  stakes: Stakes;
  e: number;
  base: number;
  score: number;
  hit: boolean;
  wiped: boolean;
  contrarian: boolean;
  percentile: number;
  rank: string;
  rankBefore: string;
  streak: number;
};

export type RevealPayload = {
  day: number;
  question: PublicQuestion;
  /** Locked entries at the Reveal. */
  n: number;
  /** The Split, 1 decimal. Null when the hive was silent. */
  split: number | null;
  yes: number;
  no: number;
  sigma: number;
  wBold: number;
  wAllin: number;
  /** True when the windows widened beyond the defaults. */
  adaptive: boolean;
  median: number | null;
  /** 21 buckets of Read counts (0–4, 5–9, … 100). */
  histogram: number[];
  aggregates: RevealAggregates;
  prophet?: { username: string; read: number };
  hivemind?: string;
  drift?: { oldDay: number; oldSplit: number };
  chaos: number | null;
  multipliers: { safe: number; bold: number; allin: number };
  you?: RevealYou;
};

export type LeaderboardScope = 'daily' | 'weekly' | 'alltime' | 'authors';

export type LeaderboardRow = {
  place: number;
  username: string;
  value: number;
  extra?: string;
};

export type LeaderboardResponse = {
  scope: LeaderboardScope;
  rows: LeaderboardRow[];
  you?: LeaderboardRow;
  hivemind?: string;
};

export type ProfileResponse = {
  username: string;
  rank: string;
  weeklyMean: number | null;
  careerPercentile: number | null;
  streak: number;
  prophetCount: number;
  bestDay: number | null;
  bestScore: number | null;
  daysPlayed: number;
  authorBest: number | null;
  authorCount: number;
};

export type QuestionSubmission = { text: string; category: QuestionCategory };

export type OkResponse = { ok: true; message?: string };
export type ErrResponse = { ok: false; code: string; message: string };

export type HiveMessage = { hiveSize: number; day: number };

export const RANKS = [
  'Weekly #1',
  'Oracle',
  'Mentalist',
  'Empath',
  'Reader',
  'Hatchling',
] as const;
export type Rank = (typeof RANKS)[number];

export const CATEGORIES: QuestionCategory[] = [
  'HOT TAKES',
  'MONEY',
  'MORALS',
  'HYPOTHETICALS',
  'CONFESSIONS',
  'META',
];
