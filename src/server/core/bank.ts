/** Question bank + author queue (R7). */
import type { QuestionCategory } from '../../shared/types';
import { HOUSE_QUESTIONS } from './questions';
import { K, type Store } from './store';
import { isSundayUtc } from './time';

export type BankItem = {
  text: string;
  category: QuestionCategory;
  author: string;
  authorId?: string;
  yesLabel?: string;
  noLabel?: string;
};

export type PickedQuestion = BankItem & {
  isRerun: boolean;
  rerunOfDay?: number;
  oldSplit?: number;
};

export async function seedBankIfEmpty(store: Store): Promise<boolean> {
  const existing = await store.get(K.bankJson);
  if (existing) return false;
  await rebuildBank(store);
  return true;
}

/** Rebuild = house list + approved community questions, pointer preserved. */
export async function rebuildBank(store: Store): Promise<number> {
  const house: BankItem[] = HOUSE_QUESTIONS.map((q) => ({
    text: q.text,
    category: q.category,
    author: 'house',
    ...(q.yesLabel ? { yesLabel: q.yesLabel } : {}),
    ...(q.noLabel ? { noLabel: q.noLabel } : {}),
  }));
  await store.set(K.bankJson, JSON.stringify(house));
  const ptr = await store.get(K.bankPtr);
  if (!ptr) await store.set(K.bankPtr, '0');
  return house.length;
}

export type QueueItem = {
  id: string;
  text: string;
  category: QuestionCategory;
  authorId: string;
  author: string;
  ts: number;
};

export async function enqueueSubmission(
  store: Store,
  item: Omit<QueueItem, 'id' | 'ts'>,
  nowMs: number
): Promise<QueueItem> {
  const id = `${nowMs}-${item.authorId}`;
  const full: QueueItem = { ...item, id, ts: nowMs };
  await store.hSet(K.queueItem(id), {
    text: full.text,
    category: full.category,
    authorId: full.authorId,
    author: full.author,
    ts: String(nowMs),
  });
  await store.zAdd(K.queue, { member: id, score: nowMs });
  return full;
}

export async function nextPendingSubmission(
  store: Store
): Promise<QueueItem | null> {
  const rows = await store.zRange(K.queue, 0, 0, { by: 'rank' });
  const first = rows[0];
  if (!first) return null;
  const h = await store.hGetAll(K.queueItem(first.member));
  if (!h['text']) {
    await store.zRem(K.queue, [first.member]);
    return null;
  }
  return {
    id: first.member,
    text: h['text']!,
    category: (h['category'] ?? 'HOT TAKES') as QuestionCategory,
    authorId: h['authorId'] ?? '',
    author: h['author'] ?? '[departed]',
    ts: parseInt(h['ts'] ?? '0', 10),
  };
}

export async function resolveSubmission(
  store: Store,
  id: string,
  approved: boolean
): Promise<void> {
  await store.zRem(K.queue, [id]);
  if (approved) {
    const h = await store.hGetAll(K.queueItem(id));
    if (h['text']) {
      await store.zAdd(K.bankUgc, {
        member: id,
        score: parseInt(h['ts'] ?? '0', 10),
      });
      return; // keep the item hash; it is consumed when featured
    }
  }
  await store.del(K.queueItem(id));
}

/**
 * Pick the question for a new day.
 * Sunday → Blind Rerun (first Sunday re-asks day 1). Otherwise an approved
 * community question is featured first (one author per day), else the next
 * house question.
 */
export async function pickQuestionForDay(
  store: Store,
  day: number,
  openAtMs: number
): Promise<PickedQuestion> {
  if (isSundayUtc(openAtMs) && day > 1) {
    const rerun = await pickRerun(store, day);
    if (rerun) return rerun;
  }
  const ugc = await store.zRange(K.bankUgc, 0, 0, { by: 'rank' });
  const first = ugc[0];
  if (first) {
    const h = await store.hGetAll(K.queueItem(first.member));
    await store.zRem(K.bankUgc, [first.member]);
    if (h['text']) {
      await store.del(K.queueItem(first.member));
      return {
        text: h['text']!,
        category: (h['category'] ?? 'HOT TAKES') as QuestionCategory,
        author: h['author'] ?? '[departed]',
        ...(h['authorId'] ? { authorId: h['authorId'] } : {}),
        isRerun: false,
      };
    }
  }
  const bank = JSON.parse((await store.get(K.bankJson)) ?? '[]') as BankItem[];
  const ptrRaw = await store.get(K.bankPtr);
  const ptr = ptrRaw ? parseInt(ptrRaw, 10) : 0;
  const item = bank[ptr % Math.max(1, bank.length)] ?? {
    text: 'Is the majority usually right?',
    category: 'META' as QuestionCategory,
    author: 'house',
  };
  await store.set(K.bankPtr, String(ptr + 1));
  return { ...item, isRerun: false };
}

async function pickRerun(
  store: Store,
  day: number
): Promise<PickedQuestion | null> {
  const doneRaw = await store.get('rerun:done');
  const done = new Set<number>(
    doneRaw ? (JSON.parse(doneRaw) as number[]) : []
  );
  for (let d = 1; d < day; d++) {
    if (done.has(d)) continue;
    const h = await store.hGetAll(K.q(d));
    if (!h['text'] || h['status'] !== 'revealed') continue;
    if (h['isRerun'] === '1') continue;
    if (!h['split']) continue; // a silent day cannot drift
    done.add(d);
    await store.set('rerun:done', JSON.stringify([...done]));
    return {
      text: h['text']!,
      category: (h['category'] ?? 'HOT TAKES') as QuestionCategory,
      author: h['author'] ?? 'house',
      ...(h['yesLabel'] ? { yesLabel: h['yesLabel'] } : {}),
      ...(h['noLabel'] ? { noLabel: h['noLabel'] } : {}),
      isRerun: true,
      rerunOfDay: d,
      oldSplit: parseFloat(h['split']!),
    };
  }
  return null;
}
