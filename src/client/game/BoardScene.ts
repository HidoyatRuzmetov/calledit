/**
 * Board — the revealed day: split duel bar, mote histogram, one-line facts,
 * archive dots, next-question countdown. Doubles as the intermission screen.
 */
import Phaser from 'phaser';
import { navigateTo } from '@devvit/web/client';
import type { RevealPayload, StateResponse } from '../../shared/types';
import { COPY } from '../../shared/copy';
import { api, ApiError, countdown, oneDp, serverNow } from './api';
import { Swarm } from './swarm';
import { openBoardPanel, openComposer, openHow, toast } from './panels';
import { C, HEX, backdrop, display, ensureTextures, layout, restartOnResize, ui } from './theme';
import { chip, pill } from './widgets';

type BoardOpts = { day: number; autoCeremony: boolean };

export class BoardScene extends Phaser.Scene {
  private st!: StateResponse;
  private p: RevealPayload | null = null;
  private opts!: BoardOpts;

  constructor() {
    super('Board');
  }

  init(opts: BoardOpts): void {
    this.opts = opts;
    this.p = null;
  }

  create(): void {
    this.st = this.registry.get('state') as StateResponse;
    backdrop(this);
    ensureTextures(this);
    const L = layout(this);
    const loading = ui(this, L.cx, L.cy, 'loading…', 14 * L.f);
    api
      .reveal(this.opts.day)
      .then((payload) => {
        loading.destroy();
        this.p = payload;
        if (
          this.opts.autoCeremony &&
          this.st.yourEntry &&
          !this.st.yourEntry.celebrated &&
          this.st.day === payload.day &&
          this.st.isToday
        ) {
          this.scene.start('Reveal', { payload });
          return;
        }
        this.render();
      })
      .catch((e) => {
        loading.setText(e instanceof ApiError ? e.message : COPY.err_network);
        this.time.delayedCall(2200, () => {
          if (this.st.phase === 'open') this.scene.start('Play');
        });
      });

    restartOnResize(this);
  }

  private render(): void {
    const p = this.p!;
    const L = layout(this);
    const swarm = new Swarm(this, 24);

    // header — day left; submit / trophy / help right
    const day = chip(this, 0, 30, `#${p.day}`, { color: HEX.ink, solid: true });
    day.root.setX(L.left + day.width() / 2);
    const help = chip(this, 0, 30, '?', {
      pad: 13,
      onTap: () => openHow(this),
    });
    help.root.setX(L.right - help.width() / 2);
    const lb = chip(this, 0, 30, '🏆', {
      pad: 9,
      onTap: () => openBoardPanel(this),
    });
    lb.root.setX(help.root.x - help.width() / 2 - lb.width() / 2 - 6);
    const ask = chip(this, 0, 30, '✍️ submit a question', {
      color: HEX.gold,
      onTap: () => openComposer(this),
    });
    ask.root.setX(lb.root.x - lb.width() / 2 - ask.width() / 2 - 8);

    // question — top-aligned and measured, so nothing below can collide
    const q = ui(this, L.cx, 58, p.question.text, 14 * L.f, HEX.ink)
      .setWordWrapWidth(L.cw)
      .setOrigin(0.5, 0);
    const yTop = 58 + q.height;

    if (p.split === null) {
      display(this, L.cx, L.h * 0.4, COPY.silent_hive, 22 * L.f);
      swarm.setMode({ kind: 'ambient' });
      this.footer(L);
      return;
    }

    // result bar — % that picked each side
    const bh = Math.max(46, 40 * L.f);
    const by = yTop + 32 + bh / 2;
    const bw = L.cw;
    const splitFrac = p.split / 100;
    const bar = this.add.graphics();
    const prog = { t: 0 };
    const yl = p.question.yesLabel ?? 'YES';
    const nl = p.question.noLabel ?? 'NO';
    const yesPct = display(
      this,
      0,
      by,
      `${oneDp(p.split)}%`,
      24 * L.f,
      '#141021'
    ).setDepth(3);
    const noPct = display(
      this,
      0,
      by,
      `${oneDp(100 - p.split)}%`,
      24 * L.f,
      '#0e1228'
    ).setDepth(3);
    const yesLab = ui(
      this,
      L.left + 8,
      by - bh / 2 - 14,
      yl,
      12 * L.f,
      HEX.gold
    ).setOrigin(0, 0.5);
    const noLab = ui(
      this,
      L.right - 8,
      by - bh / 2 - 14,
      nl,
      12 * L.f,
      HEX.blue
    ).setOrigin(1, 0.5);
    yesLab.setAlpha(0.9);
    noLab.setAlpha(0.9);
    this.tweens.add({
      targets: prog,
      t: 1,
      duration: 900,
      ease: 'Cubic.out',
      onUpdate: () => {
        const meet = L.left + bw * splitFrac * prog.t;
        const rightStart = L.right - bw * (1 - splitFrac) * prog.t;
        bar.clear();
        bar.fillStyle(C.gold, 1);
        bar.fillRoundedRect(
          L.left,
          by - bh / 2,
          Math.max(8, meet - L.left),
          bh,
          12
        );
        bar.fillStyle(C.blue, 1);
        bar.fillRoundedRect(
          rightStart,
          by - bh / 2,
          Math.max(8, L.right - rightStart),
          bh,
          12
        );
        yesPct.setX(Math.max(L.left + 44 * L.f, meet - 46 * L.f));
        noPct.setX(Math.min(L.right - 44 * L.f, rightStart + 46 * L.f));
      },
      onComplete: () => {
        const mark = this.add.rectangle(
          L.left + bw * splitFrac,
          by,
          3,
          bh + 14,
          0xffffff,
          0.95
        );
        mark.setDepth(4);
        swarm.burst(L.left + bw * splitFrac, by, 260);
      },
    });

    // histogram of guesses — height adapts to the space that's actually left
    const factLines =
      1 + (p.you ? 1 : 0) + (p.prophet ? 1 : 0) + (p.question.author !== 'house' ? 1 : 0);
    const footerTop = L.h - 150;
    const histTop = by + bh / 2 + 26;
    const avail = footerTop - histTop - 20 - factLines * 24 - 30;
    const hh = Math.max(48, Math.min(150 * L.f, L.h * 0.22, avail));
    const hy = histTop + hh;
    const buckets = p.histogram;
    const maxB = Math.max(1, ...buckets);
    const colW = L.cw / buckets.length;
    const hg = this.add.graphics();
    buckets.forEach((v, i) => {
      const x = L.left + colW * i + colW / 2;
      const barH = v === 0 ? 2 : Math.max(4, (hh * v) / maxB);
      const isYou = p.you && Math.min(20, Math.floor(p.you.read / 5)) === i;
      hg.fillStyle(isYou ? C.blue : C.gold, isYou ? 1 : 0.4);
      hg.fillRoundedRect(x - colW * 0.32, hy, colW * 0.64, 0, 3);
      this.tweens.addCounter({
        from: 0,
        to: barH,
        duration: 600,
        delay: 200 + i * 24,
        ease: 'Cubic.out',
        onUpdate: (tw) => {
          const val = tw.getValue() ?? 0;
          hg.fillStyle(isYou ? C.blue : C.gold, isYou ? 1 : 0.42);
          hg.fillRoundedRect(x - colW * 0.32, hy - val, colW * 0.64, val, 3);
        },
      });
    });
    ui(this, L.cx, hy + 18, 'where everyone put their guess (0–100)', 11.5 * L.f);
    const truthX = L.left + L.cw * splitFrac;
    const tline = this.add.rectangle(
      truthX,
      hy - hh / 2,
      2,
      hh + 26,
      0xffffff,
      0.85
    );
    tline.setAlpha(0);
    this.tweens.add({ targets: tline, alpha: 1, duration: 400, delay: 900 });

    // fact lines — short and few
    let fy = hy + 44;
    const fact = (text: string, color: string = HEX.dim) => {
      ui(this, L.cx, fy, text, 12.5 * L.f, color);
      fy += 24;
    };
    if (p.you) {
      const sideRead = p.you.call === 'yes' ? p.you.read : 100 - p.you.read;
      const sideLabel = p.you.call === 'yes' ? yl : nl;
      fact(
        `your guess: ${sideRead} pick ${sideLabel} · ${COPY.reveal_miss(oneDp(p.you.e))} · ${p.you.wiped ? (p.you.stakes === 'allin' ? COPY.wiped_allin : COPY.wiped_bold) : `+${p.you.score}`} · top ${p.you.percentile}%`,
        p.you.wiped ? HEX.red : HEX.ink
      );
    }
    if (p.prophet)
      fact(COPY.prophet_crown(p.prophet.username, p.prophet.read), HEX.gold);
    fact(
      `⚡ ${p.aggregates.hits} bonus hits · 💀 ${p.aggregates.wipes} bonus misses`
    );
    if (p.question.author !== 'house') {
      fact(`✍️ asked by u/${p.question.author}`, HEX.gold);
    }

    this.footer(L);
  }

  private footer(L: ReturnType<typeof layout>): void {
    const p = this.p!;
    // Bottom-up rows with fixed clearances: replay pill (h−46),
    // countdown/today link (h−92), past-days row (h−126). No overlaps.

    // countdown to the next question (only on today's board)
    if (this.st.isToday && this.st.day === p.day) {
      const next = ui(this, L.cx, L.h - 92, '', 13 * L.f, HEX.ink);
      const tickFn = () => {
        next.setText(COPY.intermission(countdown(this.st.nextOpenAtMs)));
        if (serverNow() > this.st.nextOpenAtMs + 5000) this.scene.start('Boot');
      };
      tickFn();
      const ev = this.time.addEvent({
        delay: 1000,
        loop: true,
        callback: tickFn,
      });
      this.events.once('shutdown', () => ev.remove());
    } else if (this.st.todayPostId) {
      const t = chip(this, L.cx, L.h - 92, "today's question  →", {
        color: HEX.gold,
        solid: true,
        onTap: () =>
          navigateTo(
            `https://reddit.com/comments/${this.st.todayPostId!.replace('t3_', '')}`
          ),
      });
      t.root.setDepth(5);
    }

    const bw = Math.min(L.cw, 340);
    const replay = pill(this, L.cx, L.h - 46, bw, 50, '▸  REPLAY THE RESULTS', {
      color: C.gold,
      px: 15,
      onTap: () =>
        this.scene.start('Reveal', { payload: this.p!, replay: true }),
    });
    replay.setPicked(true);
    if (this.p!.you) {
      chip(this, L.cx + bw / 2 + 44, L.h - 46, '↗', {
        pad: 13,
        color: HEX.gold,
        onTap: () => {
          api
            .share(this.p!.day)
            .then((r) => toast(this, r.message ?? 'Card posted.'))
            .catch((e) =>
              toast(
                this,
                e instanceof ApiError ? e.message : COPY.err_network,
                true
              )
            );
        },
      });
    }

    // past days — only as many as fit the row
    if (this.st.archive.length) {
      const sorted = [...this.st.archive].sort((a, b) => b.day - a.day);
      const maxDots = Math.max(3, Math.floor((L.cw - 90) / 46));
      const shown = sorted.slice(0, maxDots);
      if (
        !shown.some((a) => a.day === p.day) &&
        sorted.some((a) => a.day === p.day)
      ) {
        shown[shown.length - 1] = { day: p.day };
      }
      const rowW = shown.length * 46;
      const dots = this.add.container(L.cx, L.h - 126);
      let x = -rowW / 2 + 23;
      for (const a of shown) {
        const d = chip(this, x, 0, `#${a.day}`, {
          color: a.day === p.day ? HEX.gold : HEX.dim,
          px: 11,
          onTap: () => this.scene.restart({ day: a.day, autoCeremony: false }),
        });
        dots.add(d.root);
        x += 46;
      }
    }
  }
}
