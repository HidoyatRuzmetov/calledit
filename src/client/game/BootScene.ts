/** Boot: fonts → textures → state → title beat → route. */
import Phaser from 'phaser';
import type { StateResponse } from '../../shared/types';
import { api, syncClock } from './api';
import { Swarm } from './swarm';
import { backdrop, display, ensureTextures, HEX, layout, ui } from './theme';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    backdrop(this);
    ensureTextures(this);
    const L = layout(this);
    const swarm = new Swarm(this, 60);
    swarm.setMode({ kind: 'attract', x: L.cx, y: L.cy - 30, radius: 130 }, 0.9);

    const title = display(this, L.cx, L.cy - 30, 'CALLEDIT', 52 * L.f).setAlpha(
      0
    );
    const tag = ui(
      this,
      L.cx,
      L.cy + 14 + 26 * L.f,
      'guess what everyone says',
      15 * L.f
    ).setAlpha(0);

    this.tweens.add({ targets: title, alpha: 1, duration: 500, delay: 250 });
    this.tweens.add({ targets: tag, alpha: 0.9, duration: 500, delay: 500 });

    const ready = Promise.all([
      loadFonts(),
      api.state().catch(() => null),
      new Promise((r) => this.time.delayedCall(1050, r)),
    ]);

    void ready.then(([, state]) => {
      const L2 = layout(this);
      title.setPosition(L2.cx, L2.cy - 30);
      tag.setPosition(L2.cx, L2.cy + 14 + 26 * L2.f);
      title.setFontFamily('"Bricolage Grotesque", Georgia, sans-serif');
      tag.setFontFamily('"Space Grotesk", ui-sans-serif, sans-serif');
      if (!state) {
        // Cold start or hiccup — heal without asking anything of the player.
        ui(this, L2.cx, L2.cy + 90, 'Connection lost. Retrying…', 14)
          .setColor(HEX.red)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => this.scene.restart());
        this.time.delayedCall(1600, () => this.scene.restart());
        return;
      }
      syncClock(state.serverNowMs);
      this.registry.set('state', state);
      swarm.burst(L2.cx, L2.cy - 30, 420);
      this.tweens.add({
        targets: [title, tag],
        alpha: 0,
        duration: 260,
        delay: 120,
        onComplete: () => this.route(state),
      });
    });
  }

  private route(s: StateResponse): void {
    if (s.phase === 'open') this.scene.start('Play');
    else this.scene.start('Board', { day: s.day, autoCeremony: true });
  }
}

async function loadFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('800 40px "Bricolage Grotesque"'),
      document.fonts.load('400 20px "Bricolage Grotesque"'),
      document.fonts.load('500 16px "Space Grotesk"'),
      document.fonts.load('700 16px "Space Grotesk"'),
    ]);
  } catch {
    // system fallbacks carry it
  }
}
