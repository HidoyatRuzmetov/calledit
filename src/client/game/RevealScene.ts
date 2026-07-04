/**
 * The Reveal — the one moment that gets the whole motion budget.
 * Beam gathers → sweeps → SNAPS to the Split → your gap → stinger →
 * score count → percentile stamp. Tap to skip. Reduced motion → final state.
 */
import Phaser from 'phaser';
import type { RevealPayload, StateResponse } from '../../shared/types';
import { COPY } from '../../shared/copy';
import { api, oneDp } from './api';
import { sfx } from './sound';
import { Swarm } from './swarm';
import { toast } from './panels';
import { C, HEX, backdrop, display, ensureTextures, layout, ui } from './theme';
import { chip, pill, slam } from './widgets';

type RevealOpts = { payload?: RevealPayload; demo?: boolean; replay?: boolean };

const DEMO: RevealPayload = {
  day: 0,
  question: {
    day: 0,
    text: 'Would you take $500K right now, or a coin flip at $5M?',
    category: 'MONEY',
    author: 'house',
    yesLabel: 'TAKE $500K',
    noLabel: 'FLIP FOR $5M',
    isRerun: false,
    doubleStakes: false,
  },
  n: 128,
  split: 63.0,
  yes: 81,
  no: 47,
  sigma: 4.27,
  wBold: 10,
  wAllin: 5,
  adaptive: false,
  median: 58,
  histogram: [
    0, 0, 0, 1, 1, 2, 3, 4, 6, 9, 14, 18, 21, 17, 12, 8, 6, 3, 2, 1, 0,
  ],
  aggregates: { hits: 34, wipes: 21, allinWipes: 13, survived: 9 },
  chaos: 74,
  multipliers: { safe: 1, bold: 2, allin: 3 },
  you: {
    call: 'yes',
    read: 58,
    stakes: 'bold',
    e: 5,
    base: 85,
    score: 170,
    hit: true,
    wiped: false,
    contrarian: false,
    percentile: 18,
    rank: 'Hatchling',
    rankBefore: 'Hatchling',
    streak: 0,
  },
};

export class RevealScene extends Phaser.Scene {
  private p!: RevealPayload;
  private opts!: RevealOpts;
  private swarm!: Swarm;
  private finished = false;
  private timeline: Phaser.Time.TimerEvent[] = [];

  constructor() {
    super('Reveal');
  }

  init(opts: RevealOpts): void {
    this.opts = opts;
    this.p = opts.payload ?? DEMO;
    this.finished = false;
    this.timeline = [];
  }

  create(): void {
    backdrop(this);
    ensureTextures(this);
    const L = layout(this);
    this.swarm = new Swarm(this, 80);

    ui(this, L.cx - 55, 36, this.p.question.text, 13 * L.f).setWordWrapWidth(L.cw - 150);
    if (this.opts.demo) {
      chip(this, L.right - 42, 34, 'DEMO', { color: HEX.gold, solid: true });
    } else if (this.opts.replay) {
      chip(this, L.right - 56, 34, `REPLAY #${this.p.day}`, {
        color: HEX.dim,
        solid: true,
      });
    }

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.p.split === null) {
      this.silent(L);
      return;
    }
    if (reduced) {
      this.finale(L, true);
      return;
    }

    const reading = ui(
      this,
      L.cx,
      L.h * 0.16,
      COPY.reveal_reading(this.p.n),
      14 * L.f,
      HEX.gold
    );
    this.tweens.add({
      targets: reading,
      alpha: 0.35,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });

    const gx0 = L.cx - L.gw / 2;
    const axis = this.add.graphics().setDepth(1);
    axis.lineStyle(3, 0xffffff, 0.1);
    axis.lineBetween(gx0, L.h * 0.62, gx0 + L.gw, L.h * 0.62);
    ui(this, gx0, L.h * 0.62 + 22, '0', 11);
    ui(this, gx0 + L.gw, L.h * 0.62 + 22, '100', 11);

    const splitX = gx0 + (L.gw * this.p.split) / 100;

    // beat 1: gather into a beam at 0
    this.swarm.setMode(
      { kind: 'beam', x: gx0, topY: L.h * 0.34, botY: L.h * 0.86, width: 16 },
      1.1
    );

    // beat 2: sweep with overshoot
    this.at(1.0, () => {
      sfx.sweep();
      const pos = { x: gx0 };
      this.tweens.add({
        targets: pos,
        x: splitX,
        duration: 1500,
        ease: 'Back.out',
        onUpdate: () => {
          this.swarm.setMode(
            {
              kind: 'beam',
              x: pos.x,
              topY: L.h * 0.34,
              botY: L.h * 0.86,
              width: 14,
            },
            1.4
          );
        },
      });
    });

    // beat 3: SNAP
    this.at(2.6, () => {
      reading.destroy();
      sfx.snap();
      slam(this, 0.01, 0.25);
      const ringImg = this.add
        .image(splitX, L.h * 0.62, 'ring')
        .setTint(C.gold)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.3)
        .setAlpha(1);
      this.tweens.add({
        targets: ringImg,
        scale: 4,
        alpha: 0,
        duration: 700,
        ease: 'Cubic.out',
      });
      const big = display(
        this,
        L.cx,
        L.h * 0.31,
        `${oneDp(this.p.split!)}%`,
        74 * L.f,
        HEX.gold
      );
      big.setScale(2.4).setAlpha(0);
      this.tweens.add({
        targets: big,
        scale: 1,
        alpha: 1,
        duration: 340,
        ease: 'Back.out',
      });
      const cap = ui(
        this,
        L.cx,
        L.h * 0.31 + 52 * L.f,
        `picked ${this.p.question.yesLabel ?? 'YES'} — ${this.p.yes} vs ${this.p.no}`,
        13 * L.f
      );
      cap.setAlpha(0);
      this.tweens.add({ targets: cap, alpha: 1, duration: 300, delay: 150 });
    });

    // beat 4: your gap
    if (this.p.you) {
      this.at(3.6, () => {
        const you = this.p.you!;
        const yourX = gx0 + (L.gw * you.read) / 100;
        const marker = this.add
          .circle(yourX, L.h * 0.62, 11, C.blue)
          .setStrokeStyle(3, 0xffffff, 0.9);
        marker.setScale(0);
        this.tweens.add({
          targets: marker,
          scale: 1,
          duration: 260,
          ease: 'Back.out',
        });
        ui(this, yourX, L.h * 0.62 + 26, 'you', 12 * L.f, HEX.blue);
        const beam = this.add.graphics();
        beam.setDepth(2);
        const from = Math.min(yourX, splitX);
        const to = Math.max(yourX, splitX);
        const prog = { t: 0 };
        this.tweens.add({
          targets: prog,
          t: 1,
          duration: 420,
          ease: 'Cubic.out',
          onUpdate: () => {
            beam.clear();
            beam.lineStyle(5, C.blue, 0.8);
            beam.lineBetween(
              from,
              L.h * 0.62,
              from + (to - from) * prog.t,
              L.h * 0.62
            );
          },
        });
        const miss = chip(
          this,
          L.cx,
          L.h * 0.5,
          COPY.reveal_miss(oneDp(you.e)),
          {
            color: HEX.ink,
            solid: true,
          }
        );
        miss.root.setAlpha(0);
        this.tweens.add({
          targets: miss.root,
          alpha: 1,
          duration: 260,
          delay: 220,
        });
      });
    }

    // beat 5: stinger
    this.at(4.6, () => this.stinger(L, splitX));

    // beat 6: score + stamps
    this.at(5.6, () => this.score(L));

    // beat 7: buttons
    this.at(6.8, () => this.finale(L, false));

    // skip
    this.input.once('pointerdown', () => {
      if (this.finished) return;
      for (const ev of this.timeline) ev.remove();
      this.tweens.killAll();
      this.children.removeAll();
      backdrop(this);
      this.swarm = new Swarm(this, 60);
      this.finale(layout(this), true);
    });
  }

  private at(sec: number, fn: () => void): void {
    this.timeline.push(this.time.delayedCall(sec * 1000, fn));
  }

  private stinger(L: ReturnType<typeof layout>, splitX: number): void {
    const you = this.p.you;
    if (!you || you.stakes === 'safe') return;
    const dbl = this.p.multipliers.bold === 4;
    if (you.wiped) {
      sfx.wipe();
      slam(this, 0.012, 0.1);
      this.swarm.setTint(C.red);
      this.swarm.setMode({ kind: 'fall' });
      const t = display(
        this,
        L.cx,
        L.h * 0.44,
        you.stakes === 'allin' ? COPY.wiped_allin : COPY.wiped_bold,
        26 * L.f,
        HEX.red
      );
      this.tweens.add({
        targets: t,
        alpha: 0.2,
        duration: 90,
        yoyo: true,
        repeat: 3,
      });
    } else {
      sfx.hit();
      this.swarm.burst(splitX, L.h * 0.62, 500);
      const confetti = this.add.particles(splitX, L.h * 0.62, 'spark', {
        speed: { min: 160, max: 420 },
        angle: { min: 200, max: 340 },
        gravityY: 600,
        lifespan: 1400,
        quantity: 60,
        scale: { start: 1.4, end: 0.2 },
        tint: [C.gold, 0xffffff, C.goldDeep],
        emitting: false,
      });
      confetti.explode(70);
      const text =
        you.stakes === 'bold'
          ? dbl
            ? COPY.hit_bold_double
            : COPY.hit_bold
          : dbl
            ? COPY.hit_allin_double
            : COPY.hit_allin;
      const t = display(this, L.cx, L.h * 0.44, text, 26 * L.f, HEX.gold);
      t.setScale(0.4);
      this.tweens.add({
        targets: t,
        scale: 1,
        duration: 320,
        ease: 'Back.out',
      });
    }
  }

  private score(L: ReturnType<typeof layout>): void {
    const you = this.p.you;
    if (!you) return;
    const scoreText = display(this, L.cx, L.h * 0.76, '+0', 46 * L.f, HEX.ink);
    this.tweens.addCounter({
      from: 0,
      to: you.score,
      duration: 800,
      ease: 'Cubic.out',
      onUpdate: (tw) => scoreText.setText(`+${Math.round(tw.getValue() ?? 0)}`),
    });
    let yy = L.h * 0.76 + 40 * L.f;
    if (you.contrarian) {
      const c = chip(this, L.cx, yy, COPY.contrarian, {
        color: HEX.gold,
        px: 11,
      });
      c.root.setAlpha(0);
      this.tweens.add({ targets: c.root, alpha: 1, duration: 300, delay: 350 });
      yy += 34;
    }
    const stamp = chip(
      this,
      L.cx,
      yy,
      COPY.percentile(you.percentile, this.p.n),
      {
        color: HEX.ink,
        solid: true,
      }
    );
    stamp.root.setAngle(-2).setAlpha(0).setScale(1.6);
    this.tweens.add({
      targets: stamp.root,
      alpha: 1,
      scale: 1,
      duration: 260,
      delay: 500,
      ease: 'Back.out',
    });
  }

  private silent(L: ReturnType<typeof layout>): void {
    display(this, L.cx, L.h * 0.4, COPY.silent_hive, 24 * L.f);
    this.swarm.setMode(
      { kind: 'attract', x: L.cx, y: L.h * 0.6, radius: 90 },
      0.4
    );
    this.finale(L, true);
  }

  private finale(L: ReturnType<typeof layout>, instant: boolean): void {
    this.finished = true;
    if (instant && this.p.split !== null) {
      // ensure the end-state numbers exist (skip / reduced motion path)
      display(
        this,
        L.cx,
        L.h * 0.31,
        `${oneDp(this.p.split)}%`,
        74 * L.f,
        HEX.gold
      );
      const you = this.p.you;
      if (you) {
        const sideRead = you.call === 'yes' ? you.read : 100 - you.read;
        const sideLabel =
          you.call === 'yes'
            ? (this.p.question.yesLabel ?? 'YES')
            : (this.p.question.noLabel ?? 'NO');
        ui(
          this,
          L.cx,
          L.h * 0.31 + 52 * L.f,
          `your guess: ${sideRead} pick ${sideLabel} · ${COPY.reveal_miss(oneDp(you.e))} · +${you.score}`,
          14 * L.f
        );
        const stamp = chip(
          this,
          L.cx,
          L.h * 0.5,
          COPY.percentile(you.percentile, this.p.n),
          {
            color: HEX.ink,
            solid: true,
          }
        );
        stamp.root.setAngle(-2);
      }
      this.swarm.setMode(
        {
          kind: 'beam',
          x: L.cx - L.gw / 2 + (L.gw * this.p.split) / 100,
          topY: L.h * 0.58,
          botY: L.h * 0.86,
          width: 14,
        },
        0.8
      );
    }
    if (this.p.adaptive) {
      const a = chip(
        this,
        L.cx,
        L.h * 0.56,
        COPY.small_hive(this.p.n, oneDp(this.p.wBold)),
        {
          color: HEX.dim,
          px: 11,
        }
      );
      a.root.setAlpha(0.9);
    }
    if (this.p.drift) {
      chip(
        this,
        L.cx,
        L.h * 0.6,
        `📈 Same question on #${this.p.drift.oldDay}: was ${oneDp(this.p.drift.oldSplit)}% — now ${oneDp(this.p.split ?? 0)}%`,
        { color: HEX.gold, px: 11 }
      );
    }

    const by = L.h - 56;
    const cont = pill(
      this,
      L.cx,
      by,
      Math.min(L.cw, 360),
      54,
      this.opts.replay || this.opts.demo ? 'BACK' : 'CONTINUE  →',
      {
        color: C.gold,
        onTap: () => this.done(),
      }
    );
    cont.setPicked(true);
    if (!this.opts.demo && this.p.you && this.p.day > 0) {
      chip(this, L.cx - Math.min(L.cw, 360) / 2 - 46, by, '↗', {
        pad: 13,
        color: HEX.gold,
        onTap: () => {
          api
            .share(this.p.day)
            .then((r) => toast(this, r.message ?? 'Card posted.'))
            .catch((e) =>
              toast(
                this,
                e instanceof Error ? e.message : COPY.err_network,
                true
              )
            );
        },
      });
    }
    chip(this, L.cx + Math.min(L.cw, 360) / 2 + 46, by, '↻', {
      pad: 13,
      color: HEX.dim,
      onTap: () => this.scene.restart(this.opts),
    });
  }

  private done(): void {
    const st = this.registry.get('state') as StateResponse | undefined;
    if (this.opts.replay || this.opts.demo) {
      if (st && st.phase === 'open') this.scene.start('Play');
      else this.scene.start('Board', { day: this.p.day, autoCeremony: false });
      return;
    }
    if (st?.yourEntry && !st.yourEntry.celebrated) {
      api.celebrated(this.p.day).catch(() => undefined);
      this.registry.set('state', {
        ...st,
        yourEntry: { ...st.yourEntry, celebrated: true },
      });
    }
    this.scene.start('Board', { day: this.p.day, autoCeremony: false });
  }
}
