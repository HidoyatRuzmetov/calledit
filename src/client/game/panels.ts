/** Slide-up panels: how-it-works, standings, composer. Plus toasts. */
import Phaser from 'phaser';
import type {
  LeaderboardResponse,
  LeaderboardScope,
  QuestionCategory,
} from '../../shared/types';
import { CATEGORIES } from '../../shared/types';
import { COPY } from '../../shared/copy';
import { validateQuestionText } from '../../shared/validate';
import { api, ApiError } from './api';
import { C, DISPLAY, DPR, HEX, UI, layout } from './theme';
import { chip, glassPanel, pill } from './widgets';

export function toast(scene: Phaser.Scene, msg: string, bad = false): void {
  const L = layout(scene);
  const t = scene.add
    .text(L.cx, L.h - 120, msg, {
      fontFamily: UI,
      fontStyle: '500',
      fontSize: '13px',
      color: bad ? HEX.red : HEX.ink,
      backgroundColor: '#181D3DF2',
      padding: { x: 16, y: 10 },
      align: 'center',
      wordWrap: { width: L.cw - 40 },
      resolution: DPR,
    })
    .setOrigin(0.5)
    .setDepth(300)
    .setAlpha(0);
  scene.tweens.add({ targets: t, alpha: 1, y: L.h - 132, duration: 200 });
  scene.time.delayedCall(2800, () =>
    scene.tweens.add({
      targets: t,
      alpha: 0,
      duration: 250,
      onComplete: () => t.destroy(),
    })
  );
}

// ── How it works (first visit + the ? chip) ──────────────────────────────────

export function openHow(scene: Phaser.Scene, onFirstClose?: () => void): void {
  const panel = glassPanel(scene, 'HOW TO PLAY', 0.78, onFirstClose);
  const { inner, panelW, panelH, close } = panel;
  const left = -panelW / 2 + 28;

  const rows: [string, string, string][] = [
    ['1', 'Answer the question', 'Pick YES or NO.'],
    [
      '2',
      'Guess the crowd',
      'Out of 100 players, how many picked YES? Set your guess.',
    ],
    [
      '3',
      'Pick a bonus',
      'SAFE always scores. BOLD ×2 if your guess is within 10. ALL-IN ×3 if within 5 — but 0 if you miss.',
    ],
  ];
  let y = -panelH / 2 + 86;
  for (const [n, head, body] of rows) {
    const num = scene.add
      .text(left, y, n, {
        fontFamily: DISPLAY,
        fontStyle: '800',
        fontSize: '34px',
        color: HEX.gold,
        resolution: DPR,
      })
      .setOrigin(0, 0.5);
    const h = scene.add
      .text(left + 44, y - 12, head, {
        fontFamily: UI,
        fontStyle: '700',
        fontSize: '16px',
        color: HEX.ink,
        resolution: DPR,
      })
      .setOrigin(0, 0.5);
    const b = scene.add
      .text(left + 44, y + 2, body, {
        fontFamily: UI,
        fontStyle: '500',
        fontSize: '13px',
        color: HEX.dim,
        wordWrap: { width: panelW - 96 },
        lineSpacing: 4,
        resolution: DPR,
      })
      .setOrigin(0, 0);
    inner.add([num, h, b]);
    y += Math.max(78, b.height + 44);
  }

  const fine = scene.add
    .text(
      0,
      y + 6,
      'The closer your guess, the more points you get.\nResults come out every morning, then a new question starts.',
      {
        fontFamily: UI,
        fontStyle: '500',
        fontSize: '12px',
        color: HEX.dim,
        align: 'center',
        lineSpacing: 6,
        resolution: DPR,
      }
    )
    .setOrigin(0.5, 0);
  inner.add(fine);

  const play = pill(
    scene,
    0,
    panelH / 2 - 46,
    Math.min(panelW - 56, 320),
    50,
    'GOT IT',
    {
      color: C.gold,
      onTap: close,
    }
  );
  play.setPicked(true);
  inner.add(play.root);
}

// ── Standings ────────────────────────────────────────────────────────────────

const SCOPES: { id: LeaderboardScope; label: string }[] = [
  { id: 'daily', label: 'Today' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'alltime', label: 'All-time' },
  { id: 'authors', label: 'Authors' },
];

export function openBoardPanel(scene: Phaser.Scene): void {
  const panel = glassPanel(scene, 'LEADERBOARD', 0.84);
  const { inner, panelW, panelH } = panel;
  let scope: LeaderboardScope = 'weekly';
  const listY = -panelH / 2 + 118;
  const list = scene.add.container(0, 0);
  inner.add(list);

  const tabs = SCOPES.map((s, i) => {
    const t = chip(
      scene,
      (i - 1.5) * (panelW / 4 - 6),
      -panelH / 2 + 66,
      s.label,
      {
        color: HEX.dim,
        onTap: () => {
          scope = s.id;
          tabs.forEach((q, j) =>
            q.label.setColor(SCOPES[j]!.id === scope ? HEX.gold : HEX.dim)
          );
          void load();
        },
      }
    );
    inner.add(t.root);
    return t;
  });
  tabs[1]!.label.setColor(HEX.gold);

  const load = async () => {
    list.removeAll(true);
    const note = scene.add
      .text(0, listY + 30, '…', {
        fontFamily: UI,
        fontSize: '13px',
        color: HEX.dim,
        resolution: DPR,
      })
      .setOrigin(0.5);
    list.add(note);
    let data: LeaderboardResponse;
    try {
      data = await api.leaderboard(scope);
    } catch (e) {
      note.setText(e instanceof ApiError ? e.message : COPY.err_network);
      return;
    }
    list.removeAll(true);
    let y = listY;
    if (scope === 'weekly' && data.hivemind) {
      const throne = scene.add
        .text(0, y, `👑 #1 this week — u/${data.hivemind}`, {
          fontFamily: UI,
          fontStyle: '700',
          fontSize: '14px',
          color: HEX.gold,
          resolution: DPR,
        })
        .setOrigin(0.5);
      list.add(throne);
      y += 34;
    }
    if (data.rows.length === 0) {
      const empty = scene.add
        .text(0, y + 20, emptyLine(scope), {
          fontFamily: UI,
          fontSize: '13px',
          color: HEX.dim,
          align: 'center',
          wordWrap: { width: panelW - 80 },
          resolution: DPR,
        })
        .setOrigin(0.5);
      list.add(empty);
    }
    const maxRows = Math.floor((panelH / 2 - 70 - y) / 30);
    for (const r of data.rows.slice(0, Math.max(5, maxRows))) {
      const isYou =
        data.you &&
        r.place === data.you.place &&
        r.username === data.you.username;
      const line = scene.add
        .text(
          -panelW / 2 + 30,
          y,
          `${String(r.place).padStart(2, ' ')}  u/${r.username}${r.extra ? `  · ${r.extra}` : ''}`,
          {
            fontFamily: UI,
            fontStyle: isYou ? '700' : '500',
            fontSize: '14px',
            color: isYou ? HEX.gold : HEX.ink,
            resolution: DPR,
          }
        )
        .setOrigin(0, 0.5);
      const pts = scene.add
        .text(panelW / 2 - 30, y, String(r.value), {
          fontFamily: UI,
          fontStyle: '700',
          fontSize: '14px',
          color: HEX.gold,
          resolution: DPR,
        })
        .setOrigin(1, 0.5);
      list.add([line, pts]);
      y += 30;
    }
    if (
      data.you &&
      !data.rows.slice(0, 12).some((r) => r.place === data.you!.place)
    ) {
      y += 6;
      const yours = scene.add
        .text(
          -panelW / 2 + 30,
          y,
          `${data.you.place}  u/${data.you.username}  (you)`,
          {
            fontFamily: UI,
            fontStyle: '700',
            fontSize: '14px',
            color: HEX.gold,
            resolution: DPR,
          }
        )
        .setOrigin(0, 0.5);
      const pts = scene.add
        .text(panelW / 2 - 30, y, String(data.you.value), {
          fontFamily: UI,
          fontStyle: '700',
          fontSize: '14px',
          color: HEX.gold,
          resolution: DPR,
        })
        .setOrigin(1, 0.5);
      list.add([yours, pts]);
    }
  };
  void load();

  // your one-line career footer
  api
    .profile()
    .then((p) => {
      const foot = scene.add
        .text(
          0,
          panelH / 2 - 30,
          `you: ${p.rank} · weekly avg ${p.weeklyMean ?? '—'} · streak ${p.streak} · best +${p.bestScore ?? 0}`,
          {
            fontFamily: UI,
            fontStyle: '500',
            fontSize: '12px',
            color: HEX.dim,
            resolution: DPR,
          }
        )
        .setOrigin(0.5);
      inner.add(foot);
    })
    .catch(() => undefined);
}

function emptyLine(scope: LeaderboardScope): string {
  if (scope === 'weekly')
    return 'The weekly board starts after 3 days of scores.';
  if (scope === 'alltime')
    return 'The all-time board opens after 10 days played.';
  if (scope === 'authors')
    return 'No player questions featured yet — yours could be first.';
  return 'No scores yet today.';
}

// ── Composer ─────────────────────────────────────────────────────────────────

export function openComposer(scene: Phaser.Scene): void {
  const panel = glassPanel(scene, 'SUBMIT A QUESTION', 0.56);
  const { inner, panelW, panelH, close } = panel;

  const input = document.createElement('textarea');
  input.className = 'ask-input';
  input.maxLength = 120;
  input.placeholder = 'Is it ever OK to…?';
  // Size it BEFORE Phaser measures the element — otherwise the origin math
  // uses the default textarea width and the box lands off-centre.
  input.style.width = `${Math.min(panelW - 64, 560)}px`;
  const dom = scene.add.dom(0, -panelH / 2 + 120, input);
  dom.setOrigin(0.5);
  inner.add(dom);

  let cat: QuestionCategory = 'HOT TAKES';
  const catChip = chip(scene, 0, -panelH / 2 + 196, `◈ ${cat}`, {
    color: HEX.gold,
    solid: true,
    onTap: () => {
      const i = (CATEGORIES.indexOf(cat) + 1) % CATEGORIES.length;
      cat = CATEGORIES[i]!;
      catChip.setText(`◈ ${cat}`);
    },
  });
  inner.add(catChip.root);

  const RULES = 'A yes-or-no question, up to 120 characters, ending with “?”';
  const verdict = scene.add
    .text(0, -panelH / 2 + 236, RULES, {
      fontFamily: UI,
      fontStyle: '500',
      fontSize: '12px',
      color: HEX.dim,
      align: 'center',
      wordWrap: { width: panelW - 80 },
      resolution: DPR,
    })
    .setOrigin(0.5);
  inner.add(verdict);

  const send = pill(
    scene,
    0,
    panelH / 2 - 46,
    Math.min(panelW - 56, 320),
    50,
    'SEND IT',
    {
      color: C.gold,
      onTap: () => {
        const text = input.value.trim();
        const v = validateQuestionText(text);
        if (!v.ok) {
          verdict.setText(v.reason).setColor(HEX.red);
          return;
        }
        api
          .question({ text, category: cat })
          .then((r) => {
            close();
            toast(scene, r.message ?? COPY.author_ok);
          })
          .catch((e) => {
            verdict
              .setText(e instanceof ApiError ? e.message : COPY.err_network)
              .setColor(HEX.red);
          });
      },
    }
  );
  send.setPicked(true);
  inner.add(send.root);

  input.addEventListener('input', () => {
    const v = input.value.trim() ? validateQuestionText(input.value) : null;
    if (!v) {
      verdict.setText(RULES).setColor(HEX.dim);
    } else if (v.ok) {
      verdict
        .setText(`✓ Looks good  (${input.value.length}/120)`)
        .setColor(HEX.gold);
    } else {
      verdict.setText(v.reason).setColor(HEX.red);
    }
  });
}
