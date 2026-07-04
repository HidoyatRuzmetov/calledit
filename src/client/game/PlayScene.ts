/**
 * Play — the core loop as three beats, one focal element per beat:
 *   CALL → READ → STAKES → LOCK. Locked state = countdown ring.
 * Progressive disclosure keeps every beat almost wordless.
 */
import Phaser from 'phaser';
import { connectRealtime, showLoginPrompt } from '@devvit/web/client';
import type {
  CallSide,
  HiveMessage,
  Stakes,
  StateResponse,
} from '../../shared/types';
import { COPY } from '../../shared/copy';
import { api, ApiError, countdown, serverNow } from './api';
import { sfx, setSoundEnabled, soundEnabled } from './sound';
import { Swarm } from './swarm';
import { openHow, openBoardPanel, toast } from './panels';
import {
  C,
  DPR,
  HEX,
  backdrop,
  display,
  ensureTextures,
  layout,
  restartOnResize,
  ui,
  type Layout,
} from './theme';
import {
  chip,
  pill,
  countdownRing,
  slam,
  type Chip,
  type Pill,
} from './widgets';

type Step = 'call' | 'read' | 'stakes' | 'locked';

/** The first-visit card auto-opens once per session, never on restarts. */
let howAutoShown = false;

export class PlayScene extends Phaser.Scene {
  private st!: StateResponse;
  private swarm!: Swarm;
  private step: Step = 'call';
  private call: CallSide | null = null;
  private read = 50;
  private stakes: Stakes | null = null;
  private hiveChip!: Chip;
  private beat!: Phaser.GameObjects.Container;
  private beatTimers: Phaser.Time.TimerEvent[] = [];
  private question!: Phaser.GameObjects.Text;
  private busy = false;

  constructor() {
    super('Play');
  }

  create(): void {
    try {
      this.createInner();
    } catch (e) {
      console.error('play create failed', e);
      throw e;
    }
  }

  private createInner(): void {
    this.st = this.registry.get('state') as StateResponse;
    backdrop(this);
    ensureTextures(this);
    this.swarm = new Swarm(this, 48);
    this.swarm.setMode({ kind: 'ambient' });

    const entry = this.st.yourEntry;
    this.call = entry?.call ?? null;
    // The server stores the guess as "% picking the YES side"; on screen we
    // always show "% picking YOUR side", so flip when the entry says NO.
    this.read = entry ? (entry.call === 'yes' ? entry.read : 100 - entry.read) : 50;
    this.stakes = entry?.stakes ?? null;

    this.header();
    this.questionBlock();
    this.beat = this.add.container(0, 0);
    this.step = entry ? 'locked' : 'call';
    this.renderBeat(true);

    this.liveHive();
    this.watchLock();

    if (!this.st.you.seenHow && !howAutoShown) {
      howAutoShown = true;
      this.st = { ...this.st, you: { ...this.st.you, seenHow: true } };
      this.registry.set('state', this.st);
      openHow(this, () => api.seenHow().catch(() => undefined));
    }

    restartOnResize(this);
  }

  // ── chrome ────────────────────────────────────────────────────────────────

  private header(): void {
    const L = layout(this);
    const y = 30;
    // Left group: day + streak. The category lives in the question meta line,
    // so the two header groups can never collide.
    const day = chip(this, 0, y, `#${this.st.day}`, {
      color: HEX.ink,
      solid: true,
    });
    day.root.setX(L.left + day.width() / 2);
    if (this.st.streak > 0) {
      const streak = chip(this, 0, y, `🔥${this.st.streak}`, {
        color: HEX.gold,
      });
      streak.root.setX(day.root.x + day.width() / 2 + streak.width() / 2 + 8);
    }

    this.hiveChip = chip(this, 0, y, `👥 ${this.st.hiveSize}`, {
      color: HEX.gold,
      solid: true,
    });

    const help = chip(this, 0, y, '?', {
      color: HEX.dim,
      pad: 13,
      onTap: () => openHow(this),
    });
    const board = chip(this, 0, y, '🏆', {
      pad: 9,
      onTap: () => openBoardPanel(this),
    });
    const snd = chip(this, 0, y, soundEnabled() ? '♪' : '♪̸', {
      pad: 11,
      onTap: () => {
        setSoundEnabled(!soundEnabled());
        snd.setText(soundEnabled() ? '♪' : '♪̸');
      },
    });
    help.root.setX(L.right - help.width() / 2);
    board.root.setX(help.root.x - help.width() / 2 - board.width() / 2 - 6);
    snd.root.setX(board.root.x - board.width() / 2 - snd.width() / 2 - 6);
    this.hiveChip.root.setX(
      snd.root.x - snd.width() / 2 - this.hiveChip.width() / 2 - 6
    );
  }

  private questionBlock(): void {
    const L = layout(this);
    const qy = L.h * (this.step === 'call' ? 0.3 : 0.3);
    this.question = this.add
      .text(L.cx, qy, this.st.question.text, {
        fontFamily: '"Bricolage Grotesque", Georgia, sans-serif',
        fontStyle: '800',
        fontSize: `${Math.round(30 * L.f)}px`,
        color: HEX.ink,
        align: 'center',
        wordWrap: { width: L.cw },
        resolution: DPR,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({
      targets: this.question,
      alpha: 1,
      y: qy - 8,
      duration: 420,
      ease: 'Cubic.out',
    });
    const meta: string[] = [this.st.question.category];
    if (this.st.question.author !== 'house')
      meta.push(`by u/${this.st.question.author}`);
    if (this.st.question.isRerun) meta.push('REPEAT QUESTION');
    if (this.st.question.doubleStakes) meta.push('DOUBLE BONUS DAY');
    if (meta.length) {
      ui(
        this,
        L.cx,
        qy + this.question.height / 2 + 22,
        meta.join('  ·  '),
        12 * L.f,
        HEX.gold
      );
    }
  }

  // ── beats ─────────────────────────────────────────────────────────────────

  private renderBeat(first = false): void {
    for (const t of this.beatTimers) t.remove();
    this.beatTimers = [];
    this.beat.removeAll(true);
    const L = layout(this);
    if (this.step === 'call') this.beatCall(L);
    else if (this.step === 'read') this.beatRead(L);
    else if (this.step === 'stakes') this.beatStakes(L);
    else this.beatLocked(L);
    if (!first) {
      this.beat.setAlpha(0);
      this.tweens.add({
        targets: this.beat,
        alpha: 1,
        duration: 240,
        ease: 'Quad.out',
      });
    }
  }

  private stepCaption(L: Layout, text: string): void {
    const cap = ui(this, L.cx, L.h * 0.47, text, 13 * L.f).setAlpha(0);
    this.beat.add(cap);
    this.tweens.add({ targets: cap, alpha: 0.95, duration: 400, delay: 150 });
  }

  private beatCall(L: Layout): void {
    this.stepCaption(L, 'your answer');
    const yes = this.st.question.yesLabel ?? 'YES';
    const no = this.st.question.noLabel ?? 'NO';
    const bw = Math.min(L.cw / 2 - 10, 300);
    const bh = Math.max(72, 64 * L.f);
    const y = L.h * 0.6;
    const px = yes.length > 6 || no.length > 6 ? 15 * L.f : 22 * L.f;

    const mk = (side: CallSide, label: string, x: number, color: number) => {
      const p = pill(this, x, y + 30, bw, bh, label, {
        color,
        px,
        onTap: () => {
          this.call = side;
          sfx.choose();
          p.setPicked(true);
          this.swarm.burst(x, y, 200);
          this.time.delayedCall(240, () => {
            this.step = 'read';
            this.renderBeat();
          });
        },
      });
      p.root.setAlpha(0);
      this.tweens.add({
        targets: p.root,
        alpha: 1,
        y,
        duration: 380,
        ease: 'Back.out',
        delay: side === 'yes' ? 60 : 140,
      });
      this.beat.add(p.root);
      return p;
    };
    mk('yes', yes, L.cx - bw / 2 - 8, C.gold);
    mk('no', no, L.cx + bw / 2 + 8, C.blue);

    if (!this.st.you.loggedIn) {
      const gate = ui(
        this,
        L.cx,
        y + bh / 2 + 34,
        COPY.login_gate,
        12 * L.f,
        HEX.gold
      );
      this.beat.add(gate);
    }
    if (this.st.yesterday?.revealed || this.st.day === 1) {
      const replay = chip(this, L.cx, L.h - 34, '▸  yesterday’s results', {
        color: HEX.dim,
        onTap: () => this.playYesterday(),
      });
      this.beat.add(replay.root);
    }
  }

  private beatRead(L: Layout): void {
    const picked = this.call === 'yes';
    const yl = this.st.question.yesLabel ?? 'YES';
    const nl = this.st.question.noLabel ?? 'NO';
    const myLabel = picked ? yl : nl;
    const back = chip(this, 0, 0, `${myLabel} ✓`, {
      color: picked ? HEX.gold : HEX.blue,
      solid: true,
      onTap: () => {
        this.step = 'call';
        this.renderBeat();
      },
    });
    back.root.setPosition(L.cx, L.h * 0.47);
    this.beat.add(back.root);

    const y = L.h * 0.62;
    const big = display(
      this,
      L.cx,
      y - 60 * L.f,
      String(this.read),
      84 * L.f,
      HEX.gold
    );
    this.beat.add(big);
    const cap = ui(
      this,
      L.cx,
      y + 46,
      COPY.slider_caption_split(this.read, myLabel),
      12.5 * L.f
    );
    this.beat.add(cap);

    // groove
    const gy = y + 8;
    const gx0 = L.cx - L.gw / 2;
    const groove = this.add.graphics();
    groove.lineStyle(4, 0xffffff, 0.1);
    groove.lineBetween(gx0, gy, gx0 + L.gw, gy);
    for (let v = 0; v <= 100; v += 25) {
      groove.lineStyle(2, 0xffffff, 0.16);
      const tx = gx0 + (L.gw * v) / 100;
      groove.lineBetween(tx, gy - 5, tx, gy + 5);
    }
    this.beat.add(groove);

    const orb = this.add
      .image(gx0 + (L.gw * this.read) / 100, gy, 'mote')
      .setTint(C.gold)
      .setScale(1.7)
      .setBlendMode(Phaser.BlendModes.ADD);
    const knob = this.add
      .circle(orb.x, gy, 15, C.gold)
      .setStrokeStyle(3, 0xffffff, 0.85);
    this.beat.add(orb);
    this.beat.add(knob);
    this.swarm.setMode({ kind: 'attract', x: knob.x, y: gy, radius: 60 }, 0.65);

    const setRead = (clientX: number) => {
      const v = Math.round(((clientX - gx0) / L.gw) * 100);
      const nv = Math.max(0, Math.min(100, v));
      if (nv !== this.read) sfx.tick();
      this.read = nv;
      const kx = gx0 + (L.gw * nv) / 100;
      knob.setX(kx);
      orb.setX(kx);
      big.setText(String(nv));
      cap.setText(COPY.slider_caption_split(nv, myLabel));
      this.swarm.setMode({ kind: 'attract', x: kx, y: gy, radius: 60 }, 0.65);
    };

    const hit = this.add
      .rectangle(L.cx, gy, L.gw + 60, 96, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true, draggable: true });
    // worldX, not x: the camera zooms by DPR, raw pointer coords are physical.
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => setRead(p.worldX));
    hit.on('drag', (p: Phaser.Input.Pointer) => setRead(p.worldX));
    this.beat.add(hit);

    for (const [dx, delta, label] of [
      [-1, -1, '−'],
      [1, 1, '+'],
    ] as const) {
      const b = chip(this, L.cx + dx * (L.gw / 2 + 32), gy, label, {
        color: HEX.ink,
        pad: 14,
        onTap: () => setRead(gx0 + (L.gw * (this.read + delta)) / 100),
      });
      this.beat.add(b.root);
    }

    const next = pill(
      this,
      L.cx,
      L.h - 64,
      Math.min(L.cw, 380),
      56,
      'NEXT  →',
      {
        color: C.gold,
        onTap: () => {
          this.step = 'stakes';
          this.renderBeat();
        },
      }
    );
    next.setPicked(true);
    this.beat.add(next.root);
  }

  private beatStakes(L: Layout): void {
    // Free the dots from the slider spot — spread them back across the page.
    this.swarm.setMode({ kind: 'disperse' }, 0.7);
    const back = chip(
      this,
      L.cx,
      L.h * 0.47,
      `${this.call === 'yes' ? (this.st.question.yesLabel ?? 'YES') : (this.st.question.noLabel ?? 'NO')} ✓  ·  ${this.read}`,
      {
        color: HEX.gold,
        solid: true,
        onTap: () => {
          this.step = 'read';
          this.renderBeat();
        },
      }
    );
    this.beat.add(back.root);
    this.stepCaption(L, '');

    const dbl = this.st.question.doubleStakes;
    const defs: { s: Stakes; big: string; sub: string; color: number }[] = [
      { s: 'safe', big: dbl ? '×2' : '×1', sub: 'SAFE · always', color: 0x8f96b8 },
      { s: 'bold', big: dbl ? '×4' : '×2', sub: 'BOLD · within 10', color: C.gold },
      { s: 'allin', big: dbl ? '×6' : '×3', sub: 'ALL-IN · within 5', color: C.red },
    ];
    const bw = Math.min((L.cw - 24) / 3, 180);
    const bh = Math.max(76, 66 * L.f);
    const y = L.h * 0.585;
    const pills: Pill[] = [];
    defs.forEach((d, i) => {
      const x = L.cx + (i - 1) * (bw + 12);
      const p = pill(this, x, y, bw, bh, d.big, {
        sub: d.sub,
        color: d.color,
        px: 22,
        onTap: () => {
          this.stakes = d.s;
          sfx.choose();
          pills.forEach((q, j) => q.setPicked(j === i));
          lockBtn.setEnabled(true);
        },
      });
      if (this.stakes === d.s) p.setPicked(true);
      this.beat.add(p.root);
      pills.push(p);
    });
    const hint = ui(
      this,
      L.cx,
      y + bh / 2 + 26,
      'Bigger bonus, smaller margin — miss it and you score 0.',
      12 * L.f
    );
    this.beat.add(hint);

    const lockBtn = pill(
      this,
      L.cx,
      L.h - 64,
      Math.min(L.cw, 380),
      58,
      COPY.lock_cta,
      {
        color: C.gold,
        px: 20,
        onTap: () => void this.lockIn(),
      }
    );
    lockBtn.setPicked(true);
    lockBtn.setEnabled(this.stakes !== null);
    this.beat.add(lockBtn.root);
  }

  private async lockIn(): Promise<void> {
    if (this.busy || !this.call || !this.stakes) return;
    if (!this.st.you.loggedIn) {
      try {
        showLoginPrompt();
      } catch {
        toast(this, COPY.login_gate, true);
      }
      return;
    }
    this.busy = true;
    try {
      const res = await api.lockIn({
        call: this.call,
        // On screen the number means "% picking my side"; the server always
        // stores "% picking the YES side".
        read: this.call === 'yes' ? this.read : 100 - this.read,
        stakes: this.stakes,
      });
      this.st = { ...this.st, yourEntry: res.entry, hiveSize: res.hiveSize };
      this.registry.set('state', this.st);
      sfx.lock();
      slam(this);
      const L = layout(this);
      this.swarm.burst(L.cx, L.h * 0.6, 420);
      this.hiveChip.setText(`👥 ${res.hiveSize}`);
      this.step = 'locked';
      this.renderBeat();
    } catch (e) {
      toast(this, e instanceof ApiError ? e.message : COPY.err_network, true);
    } finally {
      this.busy = false;
    }
  }

  private beatLocked(L: Layout): void {
    const e = this.st.yourEntry!;
    const yl = this.st.question.yesLabel ?? 'YES';
    const nl = this.st.question.noLabel ?? 'NO';

    // Ring geometry first, so the LOCKED stamp can sit clear above it.
    const ringR = Math.min(96 * L.f, L.h * 0.14);
    const ringY = L.h * 0.63;
    const seal = display(
      this,
      L.cx,
      Math.min(L.h * 0.44, ringY - ringR - 30 * L.f),
      'LOCKED',
      20 * L.f,
      HEX.gold
    ).setAngle(-3);
    seal.setScale(2).setAlpha(0);
    this.tweens.add({
      targets: seal,
      scale: 1,
      alpha: 1,
      duration: 200,
      ease: 'Back.out',
    });
    this.beat.add(seal);

    const ring = countdownRing(this, L.cx, ringY, ringR);
    this.beat.add(ring.root);
    const total = this.st.lockAtMs - (this.st.lockAtMs - 20 * 3600_000);
    const tickFn = () => {
      const left = this.st.lockAtMs - serverNow();
      ring.setProgress(1 - Math.max(0, left) / total);
      ring.setLabel(countdown(this.st.lockAtMs), 'until results');
    };
    tickFn();
    this.beatTimers.push(
      this.time.addEvent({ delay: 1000, loop: true, callback: tickFn })
    );

    const summary = chip(
      this,
      L.cx,
      ringY + ringR + 30,
      `${e.call === 'yes' ? yl : nl}  ·  ${e.call === 'yes' ? e.read : 100 - e.read}  ·  ${e.stakes === 'safe' ? 'SAFE' : e.stakes === 'bold' ? 'BOLD' : 'ALL-IN'}`,
      { color: HEX.ink, solid: true }
    );
    this.beat.add(summary.root);

    const by = L.h - 52;
    const edit = chip(this, L.cx - 110, by, '✎ edit', {
      color: HEX.dim,
      onTap: () => {
        this.step = 'call';
        this.renderBeat();
      },
    });
    const rec = chip(
      this,
      L.cx,
      by,
      e.onRecord ? '📜 guess posted' : COPY.on_record_cta,
      {
        color: HEX.gold,
        onTap: () => void this.goOnRecord(),
      }
    );
    const replay = chip(this, L.cx + 128, by, '▸ yesterday', {
      color: HEX.dim,
      onTap: () => this.playYesterday(),
    });
    edit.root.setX(L.cx - rec.width() / 2 - edit.width() / 2 - 10);
    replay.root.setX(L.cx + rec.width() / 2 + replay.width() / 2 + 10);
    this.beat.add(edit.root);
    this.beat.add(rec.root);
    this.beat.add(replay.root);

    // Spread the dots page-wide — no huddling where the slider was.
    this.swarm.setMode({ kind: 'disperse' }, 0.7);
  }

  private async goOnRecord(): Promise<void> {
    if (this.busy || !this.st.yourEntry || this.st.yourEntry.onRecord) return;
    this.busy = true;
    try {
      await api.onRecord();
      this.st = {
        ...this.st,
        yourEntry: { ...this.st.yourEntry, onRecord: true },
      };
      this.registry.set('state', this.st);
      toast(this, '📜 Posted. Your guess is on the record in the comments.');
      this.renderBeat();
    } catch (e) {
      toast(this, e instanceof ApiError ? e.message : COPY.err_network, true);
    } finally {
      this.busy = false;
    }
  }

  private playYesterday(): void {
    const y = this.st.yesterday;
    if (!y || !y.revealed) {
      this.scene.start('Reveal', { demo: true });
      return;
    }
    api
      .reveal(y.day)
      .then((payload) => this.scene.start('Reveal', { payload, replay: true }))
      .catch((e) =>
        toast(this, e instanceof ApiError ? e.message : COPY.err_network, true)
      );
  }

  // ── live wiring ───────────────────────────────────────────────────────────

  private liveHive(): void {
    try {
      connectRealtime<HiveMessage>({
        channel: `hive_${this.st.day}`,
        onMessage: (msg) => {
          if (msg.day !== this.st.day || msg.hiveSize <= this.st.hiveSize)
            return;
          this.st = { ...this.st, hiveSize: msg.hiveSize };
          this.registry.set('state', this.st);
          this.hiveChip.setText(`👥 ${msg.hiveSize}`);
          this.tweens.add({
            targets: this.hiveChip.root,
            scale: 1.12,
            duration: 110,
            yoyo: true,
          });
        },
      });
    } catch {
      // periodic refresh below covers it
    }
    const ev = this.time.addEvent({
      delay: 30_000,
      loop: true,
      callback: () => {
        api
          .state()
          .then((s) => {
            if (s.phase !== 'open') {
              this.registry.set('state', s);
              this.scene.start('Boot');
              return;
            }
            if (s.hiveSize > this.st.hiveSize) {
              this.st = { ...this.st, hiveSize: s.hiveSize };
              this.hiveChip.setText(`👥 ${s.hiveSize}`);
            }
          })
          .catch(() => undefined);
      },
    });
    this.events.once('shutdown', () => ev.remove());
  }

  /** When the lock passes while watching, show the reading state then re-route. */
  private watchLock(): void {
    const ev = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (serverNow() < this.st.lockAtMs) return;
        ev.remove();
        for (const t of this.beatTimers) t.remove();
        this.beatTimers = [];
        const L = layout(this);
        this.beat.removeAll(true);
        const reading = display(
          this,
          L.cx,
          L.h * 0.6,
          'COUNTING ANSWERS',
          22 * L.f,
          HEX.gold
        );
        const sub = ui(
          this,
          L.cx,
          L.h * 0.6 + 40,
          `${this.st.hiveSize} players`,
          14 * L.f
        );
        this.beat.add(reading);
        this.beat.add(sub);
        this.tweens.add({
          targets: reading,
          alpha: 0.4,
          duration: 700,
          yoyo: true,
          repeat: -1,
        });
        this.swarm.setMode(
          {
            kind: 'beam',
            x: L.cx,
            topY: L.h * 0.35,
            botY: L.h * 0.8,
            width: 30,
          },
          1
        );
        const recheck = this.time.addEvent({
          delay: 2000,
          loop: true,
          callback: () => {
            api
              .state()
              .then((s) => {
                if (s.phase === 'revealed') {
                  recheck.remove();
                  this.registry.set('state', s);
                  this.scene.start('Board', { day: s.day, autoCeremony: true });
                }
              })
              .catch(() => undefined);
          },
        });
        this.events.once('shutdown', () => recheck.remove());
      },
    });
    this.events.once('shutdown', () => ev.remove());
  }
}
