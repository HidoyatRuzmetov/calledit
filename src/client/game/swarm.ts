/**
 * The Swarm — a pool of glowing motes that IS the hive on every screen.
 * Modes: ambient drift · attracted to a point · beam (vertical line) · frozen.
 * Pure update loop, no physics engine.
 */
import Phaser from 'phaser';
import { C, DPR } from './theme';

type Mote = {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  seed: number;
  size: number;
  tx: number;
  ty: number;
};

export type SwarmMode =
  | { kind: 'ambient' }
  | { kind: 'attract'; x: number; y: number; radius: number }
  | { kind: 'beam'; x: number; topY: number; botY: number; width: number }
  /** Each mote heads to its own random spot — spreads the swarm page-wide. */
  | { kind: 'disperse' }
  | { kind: 'fall' };

export class Swarm {
  private motes: Mote[] = [];
  private mode: SwarmMode = { kind: 'ambient' };
  private strength = 1;

  constructor(
    private scene: Phaser.Scene,
    count: number,
    tint: number = C.gold
  ) {
    for (let i = 0; i < count; i++) {
      const size = 0.11 + Math.random() * 0.22;
      const img = scene.add
        .image(
          Math.random() * (scene.scale.width / DPR),
          Math.random() * (scene.scale.height / DPR),
          'mote'
        )
        .setTint(tint)
        .setScale(size)
        .setAlpha(0.3 + Math.random() * 0.25)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(-5);
      this.motes.push({
        img,
        x: img.x,
        y: img.y,
        vx: 0,
        vy: 0,
        seed: Math.random() * 1000,
        size,
        tx: img.x,
        ty: img.y,
      });
    }
    scene.events.on('update', this.update, this);
    scene.events.once('shutdown', () => {
      scene.events.off('update', this.update, this);
    });
  }

  setMode(mode: SwarmMode, strength = 1): void {
    this.mode = mode;
    this.strength = strength;
    if (mode.kind === 'disperse') {
      const w = this.scene.scale.width / DPR;
      const h = this.scene.scale.height / DPR;
      for (const m of this.motes) {
        m.tx = Math.random() * w;
        m.ty = Math.random() * h;
      }
    }
  }

  setDepth(d: number): void {
    for (const m of this.motes) m.img.setDepth(d);
  }

  setTint(tint: number): void {
    for (const m of this.motes) m.img.setTint(tint);
  }

  /** One-off radial burst from a point (celebrations, lock-in). */
  burst(x: number, y: number, power = 260): void {
    for (const m of this.motes) {
      const dx = m.x - x;
      const dy = m.y - y;
      const d = Math.max(20, Math.hypot(dx, dy));
      if (d < 260) {
        m.vx += (dx / d) * power * (0.4 + Math.random());
        m.vy += (dy / d) * power * (0.4 + Math.random());
      }
    }
  }

  private update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.05, deltaMs / 1000);
    const t = this.scene.time.now / 1000;
    const w = this.scene.scale.width / DPR;
    const h = this.scene.scale.height / DPR;
    for (const m of this.motes) {
      // gentle organic wander
      m.vx += Math.sin(t * 0.9 + m.seed) * 14 * dt;
      m.vy += Math.cos(t * 0.7 + m.seed * 1.7) * 14 * dt;

      const mo = this.mode;
      if (mo.kind === 'attract') {
        const dx = mo.x + Math.sin(t * 1.3 + m.seed) * mo.radius - m.x;
        const dy = mo.y + Math.cos(t * 1.1 + m.seed * 2.1) * mo.radius - m.y;
        m.vx += dx * 2.2 * this.strength * dt;
        m.vy += dy * 2.2 * this.strength * dt;
      } else if (mo.kind === 'beam') {
        const targetX = mo.x + Math.sin(t * 2 + m.seed) * mo.width;
        const targetY =
          mo.topY +
          ((Math.sin(m.seed * 12.9898) * 0.5 + 0.5) % 1) * (mo.botY - mo.topY);
        m.vx += (targetX - m.x) * 6 * this.strength * dt;
        m.vy += (targetY - m.y) * 3.4 * this.strength * dt;
      } else if (mo.kind === 'disperse') {
        const wobX = Math.sin(t * 1.1 + m.seed) * 30;
        const wobY = Math.cos(t * 0.9 + m.seed * 1.7) * 30;
        m.vx += (m.tx + wobX - m.x) * 2.4 * this.strength * dt;
        m.vy += (m.ty + wobY - m.y) * 2.4 * this.strength * dt;
      } else if (mo.kind === 'fall') {
        m.vy += 340 * dt;
      }

      // damping
      const damp = mo.kind === 'beam' ? 0.86 : 0.94;
      m.vx *= Math.pow(damp, dt * 60);
      m.vy *= Math.pow(damp, dt * 60);

      m.x += m.vx * dt;
      m.y += m.vy * dt;

      // soft wrap on ambient, clamp otherwise
      if (mo.kind === 'ambient') {
        if (m.x < -20) m.x = w + 20;
        if (m.x > w + 20) m.x = -20;
        if (m.y < -20) m.y = h + 20;
        if (m.y > h + 20) m.y = -20;
      }

      m.img.setPosition(m.x, m.y);
      m.img.setAlpha(
        0.22 + 0.22 * (Math.sin(t * 2.2 + m.seed * 3) * 0.5 + 0.5)
      );
    }
  }
}
