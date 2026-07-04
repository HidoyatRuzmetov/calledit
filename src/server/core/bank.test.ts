import { describe, expect, it } from 'vitest';
import { validateQuestionText } from '../../shared/validate';
import {
  enqueueSubmission,
  nextPendingSubmission,
  pickQuestionForDay,
  rebuildBank,
  resolveSubmission,
  seedBankIfEmpty,
} from './bank';
import { HOUSE_QUESTIONS } from './questions';
import { MemoryStore } from './memoryStore';
import { K } from './store';
import { formatCountdown, isFridayUtc, isSundayUtc, lockAtMsFor } from './time';

const MONDAY = Date.UTC(2026, 6, 6, 15, 0, 0); // 2026-07-06 is a Monday
const SUNDAY = Date.UTC(2026, 6, 5, 15, 0, 0);
const FRIDAY = Date.UTC(2026, 6, 3, 15, 0, 0);

describe('the question bank', () => {
  it('ships 40 house questions, each ≤150 chars, ending with ?, one week-2 Meta', () => {
    expect(HOUSE_QUESTIONS).toHaveLength(40);
    for (const q of HOUSE_QUESTIONS) {
      // House questions may run longer than the 120-char composer limit,
      // but must stay short enough to read comfortably on a phone.
      expect(q.text.length).toBeLessThanOrEqual(150);
      expect(q.text.endsWith('?')).toBe(true);
    }
    expect(HOUSE_QUESTIONS[9]?.category).toBe('META'); // day 10
  });

  it('seeds once and walks the pointer', async () => {
    const store = new MemoryStore();
    expect(await seedBankIfEmpty(store)).toBe(true);
    expect(await seedBankIfEmpty(store)).toBe(false);
    const d1 = await pickQuestionForDay(store, 1, MONDAY);
    expect(d1.text).toBe(HOUSE_QUESTIONS[0]!.text);
    expect(d1.yesLabel).toBe('TAKE $500K');
    const d2 = await pickQuestionForDay(store, 2, MONDAY + 86_400_000);
    expect(d2.text).toBe(HOUSE_QUESTIONS[1]!.text);
  });

  it('features an approved community question first, credited to its author', async () => {
    const store = new MemoryStore();
    await seedBankIfEmpty(store);
    const sub = await enqueueSubmission(
      store,
      {
        text: 'Is it OK to wear pajamas to the airport?',
        category: 'HOT TAKES',
        authorId: 't2_abc',
        author: 'sleepy_flyer',
      },
      1000
    );
    const pending = await nextPendingSubmission(store);
    expect(pending?.id).toBe(sub.id);
    await resolveSubmission(store, sub.id, true);
    expect(await nextPendingSubmission(store)).toBeNull();
    const picked = await pickQuestionForDay(store, 1, MONDAY);
    expect(picked.author).toBe('sleepy_flyer');
    expect(picked.text).toContain('pajamas');
    // Next day falls back to the house.
    const next = await pickQuestionForDay(store, 2, MONDAY + 86_400_000);
    expect(next.author).toBe('house');
  });

  it('rejected questions vanish', async () => {
    const store = new MemoryStore();
    const sub = await enqueueSubmission(
      store,
      {
        text: 'Is water wet?',
        category: 'HOT TAKES',
        authorId: 't2_x',
        author: 'damp',
      },
      1
    );
    await resolveSubmission(store, sub.id, false);
    expect(await nextPendingSubmission(store)).toBeNull();
    expect(await store.hGetAll(K.queueItem(sub.id))).toEqual({});
  });

  it('Sunday is a Blind Rerun of day 1 first, carrying the old Split', async () => {
    const store = new MemoryStore();
    await seedBankIfEmpty(store);
    await store.hSet(K.q(1), {
      text: HOUSE_QUESTIONS[0]!.text,
      category: 'MONEY',
      author: 'house',
      status: 'revealed',
      split: '58.3',
      isRerun: '0',
    });
    const picked = await pickQuestionForDay(store, 4, SUNDAY);
    expect(picked.isRerun).toBe(true);
    expect(picked.rerunOfDay).toBe(1);
    expect(picked.oldSplit).toBe(58.3);
    expect(picked.text).toBe(HOUSE_QUESTIONS[0]!.text);
    // A rerun never advances the bank pointer.
    expect(await store.get(K.bankPtr)).toBe('0');
    // The next Sunday picks the next revealed, never-rerun day.
    await store.hSet(K.q(2), {
      text: 'Is a hotdog a sandwich?',
      category: 'HOT TAKES',
      author: 'house',
      status: 'revealed',
      split: '44.0',
      isRerun: '0',
    });
    const again = await pickQuestionForDay(store, 11, SUNDAY + 7 * 86_400_000);
    expect(again.rerunOfDay).toBe(2);
  });

  it('reload keeps the pointer', async () => {
    const store = new MemoryStore();
    await seedBankIfEmpty(store);
    await pickQuestionForDay(store, 1, MONDAY);
    await rebuildBank(store);
    expect(await store.get(K.bankPtr)).toBe('1');
  });
});

describe('composer validation', () => {
  it('enforces the style rules', () => {
    expect(validateQuestionText('Is a hotdog a sandwich?').ok).toBe(true);
    expect(
      validateQuestionText('Would you skip dessert or coffee forever?').ok
    ).toBe(true);
    expect(validateQuestionText('Hotdogs are sandwiches.').ok).toBe(false);
    expect(validateQuestionText('Why do people like pizza?').ok).toBe(false);
    expect(validateQuestionText(`Is ${'x'.repeat(120)}?`).ok).toBe(false);
    expect(validateQuestionText('Is the election rigged?').ok).toBe(false);
    expect(validateQuestionText('Is a p' + 'oll a game?').ok).toBe(false);
    expect(validateQuestionText('').ok).toBe(false);
  });
});

describe('the clock', () => {
  it('locks a 15:00 open at 11:00 the next day', () => {
    const lock = lockAtMsFor(MONDAY);
    expect(lock - MONDAY).toBe(20 * 3600_000);
  });
  it('gives a manual 09:00 post the following 11:00 (≥4 h window)', () => {
    const nineAm = Date.UTC(2026, 6, 6, 9, 0, 0);
    const lock = lockAtMsFor(nineAm);
    expect(lock).toBe(Date.UTC(2026, 6, 7, 11, 0, 0));
  });
  it('knows its weekdays', () => {
    expect(isSundayUtc(SUNDAY)).toBe(true);
    expect(isFridayUtc(FRIDAY)).toBe(true);
    expect(isFridayUtc(MONDAY)).toBe(false);
  });
  it('formats the countdown', () => {
    expect(formatCountdown(7 * 3600_000 + 41 * 60_000 + 22_000)).toBe(
      '07:41:22'
    );
    expect(formatCountdown(-5)).toBe('00:00:00');
  });
});
