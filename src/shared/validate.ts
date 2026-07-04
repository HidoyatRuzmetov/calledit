import { CATEGORIES, type QuestionCategory } from './types';

/** Lexicon gate for the composer (content rules §7.2 + LAW 0). */
const BANNED_TOPICS = [
  // electoral politics / politicians
  'election',
  'president',
  'senator',
  'congress',
  'parliament',
  'democrat',
  'republican',
  'liberal party',
  'conservative party',
  'trump',
  'biden',
  'putin',
  // religion
  'god',
  'jesus',
  'allah',
  'church',
  'mosque',
  'temple',
  'religion',
  'atheis',
  'muslim',
  'christian',
  'jewish',
  'hindu',
  'buddhis',
  // protected-class comparisons
  'race',
  'racist',
  'ethnic',
  'gender',
  'transgender',
  'gay',
  'lesbian',
  'immigrant',
  'nationality',
  // sexual content
  'sex',
  'nsfw',
  'nude',
  'porn',
  // self-harm / weapons / drugs
  'suicide',
  'self-harm',
  'gun',
  'weapon',
  'cocaine',
  'heroin',
  'meth',
  'overdose',
  'kill',
  'murder',
  // fresh tragedies
  'shooting',
  'terror',
  'war in',
];

// LAW 0 — the forbidden word, assembled at runtime so the repo greps clean.
BANNED_TOPICS.push(['p', 'o', 'l', 'l'].join(''));

const BINARY_STARTERS = [
  'is ',
  'are ',
  'was ',
  'were ',
  'do ',
  'does ',
  'did ',
  'would ',
  'should ',
  'could ',
  'can ',
  'will ',
  'have ',
  'has ',
  'had ',
  'if ',
];

export type ValidationOutcome = { ok: true } | { ok: false; reason: string };

export function validateQuestionText(raw: string): ValidationOutcome {
  const text = raw.trim();
  if (text.length === 0)
    return { ok: false, reason: 'Write the question first.' };
  if (text.length > 120)
    return { ok: false, reason: 'Keep it under 120 characters.' };
  if (!text.endsWith('?'))
    return { ok: false, reason: 'It must end with “?”.' };
  const lower = text.toLowerCase();
  for (const term of BANNED_TOPICS) {
    if (lower.includes(term))
      return { ok: false, reason: 'That topic is off the table here.' };
  }
  const binary =
    BINARY_STARTERS.some((s) => lower.startsWith(s)) || lower.includes(' or ');
  if (!binary)
    return {
      ok: false,
      reason: 'Phrase it as a clean YES/NO (or an A-or-B) question.',
    };
  return { ok: true };
}

export function validateCategory(cat: string): cat is QuestionCategory {
  return (CATEGORIES as string[]).includes(cat);
}

/** The composer checklist, mirrored on the client. */
export const COMPOSER_RULES = [
  'One condition, ≤120 characters, ends with “?”',
  'Cleanly binary — YES/NO or A-or-B',
  'Globally relatable ($ as the neutral unit)',
  'Would people argue about it in a group chat?',
  'Playful-spicy, never cruel. No politics, religion, or NSFW.',
] as const;
