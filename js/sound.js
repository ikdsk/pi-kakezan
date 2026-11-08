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

  // ノイズ(ガラス・ハイハット・ウーシュ用)
  let noiseBuf = null;
  function noise(at, dur, { gain = 0.1, hp = 2000, lpFrom = null, lpTo = null } = {}) {
    const c = ensure();
    if (!c) return;
    try {
      if (!noiseBuf) {
        noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = c.currentTime + at;
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      const hpf = c.createBiquadFilter();
      hpf.type = 'highpass'; hpf.frequency.value = hp;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let node = hpf;
      src.connect(hpf);
      if (lpFrom) {
        const lpf = c.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(lpFrom, t0);
        lpf.frequency.exponentialRampToValueAtTime(lpTo ?? lpFrom, t0 + dur);
        hpf.connect(lpf); node = lpf;
      }
      node.connect(g).connect(c.destination);
      src.start(t0);
      src.stop(t0 + dur + 0.03);
    } catch { /* 音が出なくてもアプリは止めない */ }
  }

  const note = (semi) => 523.25 * 2 ** (semi / 12); // ド(C5)からの半音

  // フィーバーのビート(120bpm 前後の 8 分音符。先読みスケジューラ)
  const BEAT = { id: null, next: 0, step: 0 };
  const BEAT_BASS = [65.4, 65.4, 49, 55];
  function beatStep(step, at) {
    const c = ensure();
    if (!c) return;
    const off = at - c.currentTime;
    if (step % 2 === 0) tone(150, off, 0.16, { type: 'sine', gain: 0.2, slideTo: 45 }); // キック
    else noise(off, 0.05, { gain: 0.05, hp: 7000 }); // ハイハット
    if (step % 4 === 0) tone(BEAT_BASS[(step / 4) % BEAT_BASS.length], off, 0.22, { type: 'triangle', gain: 0.09 });
    if (step % 8 === 6) tone(note(12 + (step % 3) * 4), off, 0.1, { type: 'square', gain: 0.04 });
  }
  function beatTick() {
    const c = ensure();
    if (!c) return;
    while (BEAT.next < c.currentTime + 0.25) {
      beatStep(BEAT.step, BEAT.next);
      BEAT.next += 60 / 130 / 2;
      BEAT.step++;
    }
  }
  function stopBeat() {
    if (BEAT.id !== null) { clearInterval(BEAT.id); BEAT.id = null; }
  }
  const arp = (semis, step, dur, opts) => semis.forEach((s, i) => tone(note(s), i * step, dur, opts));

  return {
    isEnabled: () => on,
    setEnabled(v) { on = !!v; if (on) ensure(); else stopBeat(); },
    /** ユーザーのタップの中で呼ぶ(iOS 対策)。 */
    unlock() { ensure(); },
    tap() { tone(note(7), 0, 0.05, { type: 'triangle', gain: 0.08 }); },
    correct(combo = 0) {
      const up = Math.min(combo, 12);
      tone(note(up), 0, 0.09, { gain: 0.11 });
      tone(note(up + 4), 0.07, 0.14, { gain: 0.11 });
    },
    /**
     * コンボ演出の音。kind: 'pop'(ふつう)/ 'chord'(和音・ピッチアップ)/ 'boom'(ドーン+ファンファーレ)/ 'fever'。
     * combo が増えるほど高くなる。
     */
    comboHit(kind, combo = 1) {
      const up = Math.min(Math.max(combo, 0), 12);
      if (kind === 'pop') { this.correct(combo); return; }
      if (kind === 'chord') {
        const r = Math.min(Math.max(combo - 5, 0), 7);
        noise(0, 0.25, { gain: 0.05, hp: 1500, lpFrom: 800, lpTo: 6000 }); // ウーシュ
        arp([r, r + 4, r + 7, r + 12], 0.0, 0.2, { gain: 0.08 });
        tone(note(r - 12), 0, 0.18, { type: 'triangle', gain: 0.14, slideTo: note(r - 24) });
        return;
      }
      const hi = kind === 'fever' ? 5 : 0;
      noise(0, 0.3, { gain: 0.06, hp: 1200, lpFrom: 600, lpTo: 8000 });
      tone(95, 0, 0.45, { type: 'sine', gain: 0.3, slideTo: 32 }); // 低音ドーン
      arp([0, 4, 7, 12, 16, 19].map((s) => s + hi), 0.06, 0.2, { gain: 0.1 });
      arp([12, 16, 19, 24].map((s) => s + hi), 0.0, 0.5, { type: 'triangle', gain: 0.08 });
      if (kind === 'fever') arp([24, 28, 31, 36], 0.5, 0.09, { type: 'sine', gain: 0.08 });
      void up;
    },
    /** 画面を叩きつける「ドン」。 */
    thump() { tone(130, 0, 0.14, { type: 'sine', gain: 0.22, slideTo: 48 }); },
    startBeat() {
      if (BEAT.id !== null || !ensure()) return;
      BEAT.next = ctx.currentTime + 0.05; BEAT.step = 0;
      BEAT.id = setInterval(beatTick, 100);
    },
    stopBeat,
    /** ガラスが割れる音(やさしめ)。 */
    glass() {
      noise(0, 0.35, { gain: 0.1, hp: 3500 });
      tone(1800, 0, 0.12, { type: 'triangle', gain: 0.06, slideTo: 900 });
      tone(420, 0.05, 0.4, { type: 'triangle', gain: 0.1, slideTo: 200 });
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
