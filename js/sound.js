// 効果音: Web Audio API で合成する(音声ファイル・外部通信なし)。
// iOS は最初のタップの中で AudioContext を作って resume しないと鳴らない。
export function createSound(enabled = true) {
  let on = !!enabled;
  let ctx = null;

  function ensure() {
    if (!on) return null;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    } catch {
      return null;
    }
  }

  // 1音。freq→slideTo へ滑らせることもできる。
  function tone(freq, at, dur, { type = 'square', gain = 0.12, slideTo = null } = {}) {
    const c = ensure();
    if (!c) return;
    try {
      const t0 = c.currentTime + at;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch { /* 音が出なくてもアプリは止めない */ }
  }

  const note = (semi) => 523.25 * 2 ** (semi / 12); // ド(C5)からの半音
  const arp = (semis, step, dur, opts) => semis.forEach((s, i) => tone(note(s), i * step, dur, opts));

  return {
    isEnabled: () => on,
    setEnabled(v) { on = !!v; if (on) ensure(); },
    /** ユーザーのタップの中で呼ぶ(iOS 対策)。 */
    unlock() { ensure(); },
    tap() { tone(note(7), 0, 0.05, { type: 'triangle', gain: 0.08 }); },
    correct(combo = 0) {
      const up = Math.min(combo, 12);
      tone(note(up), 0, 0.09, { gain: 0.11 });
      tone(note(up + 4), 0.07, 0.14, { gain: 0.11 });
    },
    wrong() { tone(260, 0, 0.22, { type: 'triangle', gain: 0.14, slideTo: 150 }); },
    combo(tier = 1) {
      const seqs = { 1: [0, 4, 7], 2: [0, 4, 7, 12], 3: [0, 4, 7, 12, 16], 4: [0, 4, 7, 12, 16, 19, 24] };
      arp(seqs[Math.min(Math.max(tier, 1), 4)], 0.07, 0.12, { gain: 0.11 });
    },
    levelUp() {
      arp([0, 4, 7, 12, 7, 12, 16, 19], 0.09, 0.2, { gain: 0.12 });
      tone(note(24), 0.8, 0.5, { type: 'triangle', gain: 0.12 });
    },
    achievement() {
      tone(note(12), 0, 0.12, { type: 'triangle', gain: 0.13 });
      tone(note(19), 0.1, 0.12, { type: 'triangle', gain: 0.13 });
      tone(note(24), 0.2, 0.35, { type: 'triangle', gain: 0.13 });
      arp([28, 31, 36], 0.4, 0.08, { type: 'sine', gain: 0.07 });
    },
    clear() {
      arp([0, 4, 7, 12, 16, 19, 24, 19, 24, 28], 0.11, 0.25, { gain: 0.12 });
      tone(note(31), 1.2, 0.9, { type: 'triangle', gain: 0.13 });
    },
  };
}
