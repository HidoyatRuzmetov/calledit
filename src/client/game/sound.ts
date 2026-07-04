/** WebAudio synth — no audio files shipped. Default OFF. */

let ctx: AudioContext | null = null;
let enabled = false;

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (on && !ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      enabled = false;
    }
  }
  if (on && ctx?.state === 'suspended') {
    ctx.resume().catch(() => undefined);
  }
}

function tone(
  freq: number,
  durMs: number,
  type: OscillatorType,
  gain = 0.12,
  slideTo?: number
): void {
  if (!enabled || !ctx) return;
  try {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, slideTo),
        t0 + durMs / 1000
      );
    }
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.02);
  } catch {
    // sound is decoration
  }
}

export const sfx = {
  tick(): void {
    tone(2200, 12, 'square', 0.03);
  },
  choose(): void {
    tone(420, 70, 'sine', 0.08, 640);
  },
  lock(): void {
    tone(150, 90, 'square', 0.1, 60);
    setTimeout(() => tone(90, 130, 'sine', 0.12, 45), 60);
  },
  sweep(): void {
    tone(180, 900, 'sine', 0.05, 720);
  },
  snap(): void {
    tone(95, 160, 'sine', 0.16, 40);
  },
  hit(): void {
    tone(520, 90, 'square', 0.07, 780);
    setTimeout(() => tone(780, 140, 'square', 0.07, 1180), 85);
  },
  wipe(): void {
    tone(300, 240, 'sawtooth', 0.09, 55);
  },
};
