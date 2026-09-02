/**
 * Web Audio API Synthesizer for Neon Game FX & UI Sounds
 */
class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private enabled: boolean = true;

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx) {
      if (!this.compressor) {
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-24, this.ctx.currentTime);
        this.compressor.knee.setValueAtTime(30, this.ctx.currentTime);
        this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
        this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
        this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);
        this.compressor.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }
    return this.ctx;
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private getOutputNode() {
    return this.compressor || this.ctx!.destination;
  }

  // Neon Orb Collection sound
  public playOrbPickup(value: number = 1) {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const freq = Math.min(880, 360 + value * 25);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.08);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc.connect(gain);
      gain.connect(this.getOutputNode());

      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now);
      osc.stop(now + 0.1);
    } catch {
      // Ignored
    }
  }

  // Turbo Boost sound
  public playBoost() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.15);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(this.getOutputNode());

      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now);
      osc.stop(now + 0.16);
    } catch {
      // Ignored
    }
  }

  // Wall hit / Death explosion
  public playDeathWall() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      // White noise explosion + low thump
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.35);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      osc.connect(gain);
      gain.connect(this.getOutputNode());

      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now);
      osc.stop(now + 0.4);
    } catch {
      // Ignored
    }
  }

  // Player kill / Elimination sound
  public playPlayerKill() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      [440, 660, 880].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + i * 0.05);
        gain.gain.setValueAtTime(0.12, now + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (i + 1) * 0.08);

        osc.connect(gain);
        gain.connect(this.getOutputNode());

        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
        osc.start(now + i * 0.05);
        osc.stop(now + (i + 1) * 0.09);
      });
    } catch {
      // Ignored
    }
  }

  // Danger Zone shrink siren
  public playShrinkAlert() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.linearRampToValueAtTime(300, now + 0.25);
      osc.frequency.linearRampToValueAtTime(600, now + 0.5);

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.5);

      osc.connect(gain);
      gain.connect(this.getOutputNode());

      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now);
      osc.stop(now + 0.55);
    } catch {
      // Ignored
    }
  }

  // Victory Fanfare when winning 80% pot
  public playVictoryFanfare() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      const now = ctx.currentTime;

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + idx * 0.12;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.18, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

        osc.connect(gain);
        gain.connect(this.getOutputNode());

        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
        osc.start(startTime);
        osc.stop(startTime + 0.4);
      });
    } catch {
      // Ignored
    }
  }

  // Cash / Coin transaction sound
  public playCashCoin() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(987.77, now); // B5
      osc2.frequency.setValueAtTime(1318.51, now + 0.08); // E6

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.getOutputNode());

      const cleanup = () => {
        osc1.disconnect();
        osc2.disconnect();
        gain.disconnect();
      };
      osc1.onended = cleanup;
      osc2.onended = cleanup;
      osc1.start(now);
      osc1.stop(now + 0.08);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.25);
    } catch {
      // Ignored
    }
  }

  // Notification Ping
  public playNotificationPing() {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(750, now);
      osc.frequency.exponentialRampToValueAtTime(1100, now + 0.12);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(this.getOutputNode());

      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now);
      osc.stop(now + 0.22);
    } catch {
      // Ignored
    }
  }
}

export const soundFx = new SoundSynthesizer();
