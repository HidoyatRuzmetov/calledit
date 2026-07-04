import Phaser from 'phaser';

// If anything throws before a scene can paint, show it instead of a black void.
function showFatal(msg: string): void {
  if (document.getElementById('fatal')) return;
  const el = document.createElement('div');
  el.id = 'fatal';
  el.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;gap:12px;' +
    'align-items:center;justify-content:center;background:#0A0C1A;color:#F4F2EC;' +
    'font-family:ui-sans-serif,system-ui;padding:24px;text-align:center;z-index:9';
  el.innerHTML =
    '<div style="font-size:18px;font-weight:700">Something went wrong.</div>' +
    '<div style="font-size:12px;color:#7B82A3;max-width:52ch;word-break:break-word">' +
    msg.replace(/</g, '&lt;') +
    '</div>' +
    '<button style="min-height:44px;padding:0 26px;border-radius:999px;border:0;' +
    'background:#FFC94D;color:#141021;font-weight:700" ' +
    'onclick="location.reload()">RELOAD</button>';
  document.body.appendChild(el);
}
window.addEventListener('error', (e) => showFatal(String(e.error ?? e.message)));
window.addEventListener('unhandledrejection', (e) => showFatal(String(e.reason)));


import { BootScene } from './game/BootScene';
import { PlayScene } from './game/PlayScene';
import { RevealScene } from './game/RevealScene';
import { BoardScene } from './game/BoardScene';
import { DPR } from './game/theme';

// The canvas holds physical pixels (CSS size × devicePixelRatio) so nothing
// is upscaled by the browser; scenes keep working in CSS pixels via layout().
function rootCssSize(): { w: number; h: number } {
  const r = document.getElementById('game-root')?.getBoundingClientRect();
  if (!r || r.width < 10 || r.height < 10) {
    return { w: window.innerWidth || 360, h: window.innerHeight || 640 };
  }
  return { w: r.width, h: r.height };
}

const boot = rootCssSize();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#0A0C1A',
  dom: { createContainer: true },
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: 1 / DPR,
    width: Math.round(boot.w * DPR),
    height: Math.round(boot.h * DPR),
  },
  scene: [BootScene, PlayScene, RevealScene, BoardScene],
});

// The expanded-post iframe can be laid out without ever firing a resize event
// inside it — so poll the real parent size and force a re-measure when it drifts.
setInterval(() => {
  const { w, h } = rootCssSize();
  const pw = Math.round(w * DPR);
  const ph = Math.round(h * DPR);
  if (
    Math.abs(game.scale.width - pw) > 8 * DPR ||
    Math.abs(game.scale.height - ph) > 8 * DPR
  ) {
    game.scale.resize(pw, ph);
  }
}, 500);

// TEMP: expose for live inspection
Object.assign(window, { __game: game });
