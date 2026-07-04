/** CALLEDIT v2 — “The Swarm”. One organism, one focal element per beat. */
import Phaser from 'phaser';

/**
 * Device pixel ratio the canvas renders at. The canvas holds physical pixels
 * while every scene works in CSS pixels (layout() divides, the camera zooms).
 * Without this the browser upscales a CSS-sized canvas and everything is soft.
 */
export const DPR: number = Math.min(
  2.5,
  Math.max(1, globalThis.devicePixelRatio ?? 1)
);

export const C = {
  bgTop: 0x0a0c1a,
  bgBot: 0x151a3a,
  gold: 0xffc94d,
  goldDeep: 0xe8940a,
  blue: 0x6f8dff,
  ink: 0xf4f2ec,
  dim: 0x7b82a3,
  red: 0xff5a5f,
  panel: 0x181d3d,
} as const;

export const HEX = {
  gold: '#FFC94D',
  goldDeep: '#E8940A',
  blue: '#6F8DFF',
  ink: '#F4F2EC',
  dim: '#7B82A3',
  red: '#FF5A5F',
} as const;

export const DISPLAY = '"Bricolage Grotesque", Georgia, sans-serif';
export const UI = '"Space Grotesk", ui-sans-serif, system-ui, sans-serif';

/** Responsive layout: everything derives from these numbers. */
export type Layout = {
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** content width (column) */
  cw: number;
  /** type scale factor: 1 on phones, up to 1.75 on desktop */
  f: number;
  /** groove (slider) width */
  gw: number;
  left: number;
  right: number;
  desktop: boolean;
};

export function layout(scene: Phaser.Scene): Layout {
  const w = scene.scale.width / DPR;
  const h = scene.scale.height / DPR;
  const f = Math.max(1, Math.min(1.75, Math.min(w / 420, h / 720)));
  const cw = Math.min(w - 40, 860);
  const gw = Math.min(w - 88, 680);
  return {
    w,
    h,
    cx: w / 2,
    cy: h / 2,
    cw,
    f,
    gw,
    left: (w - cw) / 2,
    right: (w + cw) / 2,
    desktop: w >= 900,
  };
}

export function display(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  px: number,
  color: string = HEX.ink
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontFamily: DISPLAY,
      fontStyle: '800',
      fontSize: `${Math.round(px)}px`,
      color,
      align: 'center',
      resolution: DPR,
    })
    .setOrigin(0.5);
}

export function ui(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  px: number,
  color: string = HEX.dim
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontFamily: UI,
      fontStyle: '500',
      fontSize: `${Math.round(px)}px`,
      color,
      align: 'center',
      resolution: DPR,
    })
    .setOrigin(0.5);
}

/**
 * Full-bleed vertical gradient + vignette. Call first in every scene.
 * Also aims the camera: the scene draws in CSS pixels, the camera zooms by
 * DPR onto the physical-pixel canvas so everything renders pin-sharp.
 */
export function backdrop(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(-100);
  const paint = () => {
    const w = scene.scale.width / DPR;
    const h = scene.scale.height / DPR;
    const cam = scene.cameras.main;
    cam.setZoom(DPR);
    cam.centerOn(w / 2, h / 2);
    g.clear();
    g.fillGradientStyle(C.bgTop, C.bgTop, C.bgBot, C.bgBot, 1);
    g.fillRect(0, 0, w, h);
    g.fillStyle(0x000000, 0.22);
    g.fillEllipse(w / 2, -h * 0.28, w * 2.2, h * 0.8);
    g.fillEllipse(w / 2, h * 1.28, w * 2.2, h * 0.8);
  };
  paint();
  scene.scale.on('resize', paint);
  scene.events.once('shutdown', () => scene.scale.off('resize', paint));
  return g;
}

/** Soft additive glow dot + ring textures, generated once. */
export function ensureTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists('mote')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    for (let i = 8; i >= 1; i--) {
      g.fillStyle(0xffffff, i === 1 ? 1 : 0.055 * (9 - i));
      g.fillCircle(16, 16, (16 * i) / 8);
    }
    g.generateTexture('mote', 32, 32);
    g.destroy();
  }
  if (!scene.textures.exists('ring')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.lineStyle(6, 0xffffff, 1);
    g.strokeCircle(64, 64, 58);
    g.generateTexture('ring', 128, 128);
    g.destroy();
  }
  if (!scene.textures.exists('spark')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 6, 6);
    g.generateTexture('spark', 6, 6);
    g.destroy();
  }
}

/** Restart the scene when the viewport changes (debounced via wall clock). */
export function restartOnResize(scene: Phaser.Scene): void {
  let t: ReturnType<typeof setTimeout> | null = null;
  let alive = true;
  const onResize = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      if (alive) scene.scene.restart();
    }, 200);
  };
  scene.scale.on('resize', onResize);
  scene.events.once('shutdown', () => {
    alive = false;
    scene.scale.off('resize', onResize);
    if (t) clearTimeout(t);
  });
}
