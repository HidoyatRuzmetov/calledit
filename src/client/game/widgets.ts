/** Small canvas-drawn UI pieces: chips, pills, panels, countdown ring. */
import Phaser from 'phaser';
import { C, DPR, HEX, UI, DISPLAY } from './theme';

export type Chip = {
  root: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  setText: (t: string) => void;
  width: () => number;
};

export function chip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: {
    color?: string;
    solid?: boolean;
    px?: number;
    pad?: number;
    onTap?: () => void;
  } = {}
): Chip {
  const px = opts.px ?? 13;
  const pad = opts.pad ?? 10;
  const label = scene.add
    .text(0, 0, text, {
      fontFamily: UI,
      fontStyle: '700',
      fontSize: `${px}px`,
      color: opts.color ?? HEX.dim,
      resolution: DPR,
    })
    .setOrigin(0.5);
  const bg = scene.add.graphics();
  const draw = () => {
    const w = label.width + pad * 2;
    const h = Math.max(30, label.height + 12);
    bg.clear();
    if (opts.solid) {
      bg.fillStyle(C.panel, 0.92);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    }
    bg.lineStyle(1.5, 0xffffff, opts.solid ? 0.14 : 0.1);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  };
  draw();
  const root = scene.add.container(x, y, [bg, label]);
  root.setSize(label.width + pad * 2, Math.max(30, label.height + 12));
  if (opts.onTap) {
    root.setInteractive({ useHandCursor: true });
    root.on('pointerdown', () => {
      scene.tweens.add({
        targets: root,
        scale: 0.92,
        duration: 60,
        yoyo: true,
      });
      opts.onTap!();
    });
  }
  return {
    root,
    label,
    setText: (t: string) => {
      label.setText(t);
      draw();
      root.setSize(label.width + pad * 2, Math.max(30, label.height + 12));
      if (opts.onTap && root.input) {
        root.input.hitArea.setSize(root.width, root.height);
      }
    },
    width: () => label.width + pad * 2,
  };
}

export type Pill = {
  root: Phaser.GameObjects.Container;
  setPicked: (on: boolean) => void;
  setEnabled: (on: boolean) => void;
  redraw: (w: number, h: number) => void;
};

/** Big rounded action button with glow states. */
export function pill(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  opts: {
    sub?: string;
    color?: number;
    textColor?: string;
    onTap?: () => void;
    px?: number;
  } = {}
): Pill {
  const color = opts.color ?? C.gold;
  const bg = scene.add.graphics();
  const glow = scene.add
    .image(0, 0, 'mote')
    .setBlendMode(Phaser.BlendModes.ADD)
    .setTint(color)
    .setAlpha(0)
    .setScale(w / 20, h / 16);
  const label = scene.add
    .text(0, opts.sub ? -7 : 0, text, {
      fontFamily: UI,
      fontStyle: '700',
      fontSize: `${opts.px ?? 18}px`,
      color: opts.textColor ?? HEX.ink,
      resolution: DPR,
    })
    .setOrigin(0.5);
  const sub = scene.add
    .text(0, 13, opts.sub ?? '', {
      fontFamily: UI,
      fontStyle: '500',
      fontSize: '11px',
      color: HEX.dim,
      resolution: DPR,
    })
    .setOrigin(0.5);
  let picked = false;
  let cw = w;
  let ch = h;
  const draw = () => {
    bg.clear();
    bg.fillStyle(picked ? color : C.panel, picked ? 1 : 0.88);
    bg.fillRoundedRect(-cw / 2, -ch / 2, cw, ch, ch / 2);
    bg.lineStyle(1.5, picked ? color : 0xffffff, picked ? 1 : 0.12);
    bg.strokeRoundedRect(-cw / 2, -ch / 2, cw, ch, ch / 2);
  };
  draw();
  const root = scene.add.container(x, y, [glow, bg, label, sub]);
  root.setSize(w, h).setInteractive({ useHandCursor: true });
  root.on('pointerdown', () => {
    scene.tweens.add({
      targets: root,
      scale: 0.94,
      duration: 70,
      yoyo: true,
      ease: 'Quad.out',
    });
    opts.onTap?.();
  });
  root.on('pointerover', () => {
    if (!picked)
      scene.tweens.add({ targets: glow, alpha: 0.08, duration: 140 });
  });
  root.on('pointerout', () => {
    if (!picked) scene.tweens.add({ targets: glow, alpha: 0, duration: 140 });
  });
  return {
    root,
    setPicked: (on: boolean) => {
      picked = on;
      label.setColor(on ? '#141021' : (opts.textColor ?? HEX.ink));
      sub.setColor(on ? '#3d3010' : HEX.dim);
      glow.setAlpha(on ? 0.16 : 0);
      draw();
    },
    setEnabled: (on: boolean) => {
      root.setAlpha(on ? 1 : 0.35);
      if (on) root.setInteractive({ useHandCursor: true });
      else root.disableInteractive();
    },
    redraw: (nw: number, nh: number) => {
      cw = nw;
      ch = nh;
      draw();
      root.setSize(nw, nh);
      if (root.input) root.input.hitArea.setSize(nw, nh);
    },
  };
}

/** Slide-up glass panel; returns container + close fn. Content added by caller. */
export function glassPanel(
  scene: Phaser.Scene,
  title: string,
  heightFrac = 0.72,
  onClose?: () => void
): {
  root: Phaser.GameObjects.Container;
  inner: Phaser.GameObjects.Container;
  close: () => void;
  panelW: number;
  panelH: number;
} {
  const w = scene.scale.width / DPR;
  const h = scene.scale.height / DPR;
  const pw = Math.min(w - 24, 720);
  const ph = Math.min(h * heightFrac, 620);

  const dim = scene.add
    .rectangle(w / 2, h / 2, w, h, 0x05060f, 0.66)
    .setInteractive()
    .setDepth(90);
  const g = scene.add.graphics().setDepth(91);
  g.fillStyle(C.panel, 0.97);
  g.fillRoundedRect(-pw / 2, -ph / 2, pw, ph, 22);
  g.lineStyle(1.5, 0xffffff, 0.12);
  g.strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, 22);
  const titleText = scene.add
    .text(0, -ph / 2 + 30, title, {
      fontFamily: DISPLAY,
      fontStyle: '800',
      fontSize: '20px',
      color: HEX.ink,
      resolution: DPR,
    })
    .setOrigin(0.5);
  const closeBtn = scene.add
    .text(pw / 2 - 28, -ph / 2 + 30, '✕', {
      fontFamily: UI,
      fontSize: '18px',
      color: HEX.dim,
      resolution: DPR,
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  const inner = scene.add.container(0, 0);
  const root = scene.add
    .container(w / 2, h / 2 + 40, [g, titleText, closeBtn, inner])
    .setDepth(92)
    .setAlpha(0);
  scene.tweens.add({
    targets: root,
    alpha: 1,
    y: h / 2,
    duration: 240,
    ease: 'Cubic.out',
  });

  const close = () => {
    scene.tweens.add({
      targets: root,
      alpha: 0,
      y: h / 2 + 40,
      duration: 180,
      ease: 'Cubic.in',
      onComplete: () => {
        root.destroy();
        dim.destroy();
        onClose?.();
      },
    });
  };
  closeBtn.on('pointerdown', close);
  dim.on('pointerdown', close);
  return { root, inner, close, panelW: pw, panelH: ph };
}

/** Circular countdown ring with live label. Caller updates via setProgress/setLabel. */
export function countdownRing(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number
): {
  root: Phaser.GameObjects.Container;
  setProgress: (p: number) => void;
  setLabel: (top: string, bottom: string) => void;
} {
  const g = scene.add.graphics();
  const top = scene.add
    .text(0, -8, '', {
      fontFamily: DISPLAY,
      fontStyle: '800',
      fontSize: `${Math.round(radius * 0.42)}px`,
      color: HEX.ink,
      resolution: DPR,
    })
    .setOrigin(0.5);
  const bottom = scene.add
    .text(0, radius * 0.34, '', {
      fontFamily: UI,
      fontStyle: '500',
      fontSize: `${Math.max(11, Math.round(radius * 0.14))}px`,
      color: HEX.dim,
      resolution: DPR,
    })
    .setOrigin(0.5);
  const root = scene.add.container(x, y, [g, top, bottom]);
  let progress = 0;
  const draw = () => {
    g.clear();
    g.lineStyle(4, 0xffffff, 0.08);
    g.strokeCircle(0, 0, radius);
    g.lineStyle(5, C.gold, 0.95);
    g.beginPath();
    g.arc(
      0,
      0,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress,
      false
    );
    g.strokePath();
  };
  draw();
  return {
    root,
    setProgress: (p: number) => {
      progress = Math.max(0, Math.min(1, p));
      draw();
    },
    setLabel: (t: string, b: string) => {
      top.setText(t);
      bottom.setText(b);
    },
  };
}

/** Screen shake + flash for the big beats. */
export function slam(
  scene: Phaser.Scene,
  intensity = 0.008,
  flashAlpha = 0.18
): void {
  scene.cameras.main.shake(140, intensity);
  const w = scene.scale.width / DPR;
  const h = scene.scale.height / DPR;
  const flash = scene.add
    .rectangle(w / 2, h / 2, w, h, 0xffffff, flashAlpha)
    .setDepth(200);
  scene.tweens.add({
    targets: flash,
    alpha: 0,
    duration: 220,
    onComplete: () => flash.destroy(),
  });
}
