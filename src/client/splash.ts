/** S0 splash logic — paint instantly from postData, then fill in live data. */
import { context, requestExpandedMode } from '@devvit/web/client';

const dayEl = document.getElementById('dayno');
const qEl = document.getElementById('question');
const hiveEl = document.getElementById('hive');
const playBtn = document.getElementById('play');

type PostData = {
  day?: number;
  text?: string;
  author?: string;
  isRerun?: boolean;
};

function paintFromPostData(): void {
  const pd = (context.postData ?? {}) as PostData;
  if (dayEl && pd.day) dayEl.textContent = `CALLEDIT #${pd.day}`;
  if (qEl && pd.text) qEl.textContent = pd.text;
}

async function paintHive(): Promise<void> {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const s = (await res.json()) as {
      hiveSize?: number;
      day?: number;
      question?: { text?: string };
    };
    if (hiveEl && typeof s.hiveSize === 'number')
      hiveEl.textContent = `👥 ${s.hiveSize} playing`;
    if (dayEl && s.day && !dayEl.textContent)
      dayEl.textContent = `CALLEDIT #${s.day}`;
    if (
      qEl &&
      s.question?.text &&
      qEl.textContent === 'Loading today’s question…'
    ) {
      qEl.textContent = s.question.text;
    }
  } catch {
    // the splash stays calm without a network
  }
}

playBtn?.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

paintFromPostData();
void paintHive();
