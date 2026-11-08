// BGM の発音エンジン(Web Audio)。曲の中身は bgm.js、ここは「どの時刻にどの音を鳴らすか」だけ。
// タイマーは持たない: advanceTo(時刻) を呼ぶと、その時刻までのステップを先読みでスケジュールする。
// → 実時間では sound.js の setInterval(25ms)、書き出しでは OfflineAudioContext から同じコードを呼べる。
// 音のノードは使い捨て: 鳴り終わったら必ず disconnect する(長時間でも増え続けない)。
import { patternAt, stepSeconds, isBoundary, midiToHz, LAYER_KEYS, STEPS_PER_BAR } from './bgm.js';

export const DEFAULT_LEVEL = 0.34; // BGM 全体の音量(効果音より控えめ)

export function createBgmEngine(ctx, { out = ctx.destination, level = DEFAULT_LEVEL } = {}) {
  // ---------- 常設のノード(数個だけ) ----------
  const master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3; comp.knee.value = 12; comp.attack.value = 0.005; comp.release.value = 0.12;
  master.connect(comp);
  comp.connect(out);
  const melodyFilter = ctx.createBiquadFilter(); // コード・アルペジオ・リード共通。コンボで開く
  melodyFilter.type = 'lowpass';
  melodyFilter.Q.value = 0.9;
  melodyFilter.frequency.value = 3000;
  melodyFilter.connect(master);

  let noiseBuf = null;
  const st = { created: 0, ended: 0, hits: Object.fromEntries(LAYER_KEYS.map((k) => [k, 0])) };
  let enabled = false;
  let masterLevel = level;
  let layers = Object.fromEntries(LAYER_KEYS.map((k) => [k, 0]));
  let bpm = 132;
  let desiredBpm = 132;
  let pending = null; // { target, grid }
  let stepIndex = 0;
  let nextTime = 0;
  let filterFreq = 3000;
  const eng = { onStep: null, onHit: null };

  const freqOfFilter = (v) => 450 + 9000 * v * v; // 0 → 450Hz(こもる)/ 1 → 9450Hz(全開)

  // ---------- 使い捨ての音 ----------
  function track(src, nodes) {
    st.created++;
    src.onended = () => {
      st.ended++;
      try { src.disconnect(); } catch { /* 切断済み */ }
      for (const n of nodes) { try { n.disconnect(); } catch { /* 切断済み */ } }
    };
  }

  /** 1 音(オシレーター)。gain は最大音量、dur は音の長さ、release は余韻。 */
  function osc(t, freq, dur, { type = 'sawtooth', gain = 0.1, dest, detune = 0, slideTo = null, attack = 0.004, release = 0.05, extra = [] } = {}) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    if (detune) o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + release + 0.02);
    track(o, [g, ...extra]);
    return o;
  }

  function noise(t, dur, { gain = 0.2, hp = 6000, lp = null, dest = master } = {}) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.7), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hpf);
    const nodes = [hpf, g];
    if (lp) {
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = lp;
      hpf.connect(lpf); lpf.connect(g);
      nodes.push(lpf);
    } else {
      hpf.connect(g);
    }
    g.connect(dest);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
    track(src, nodes);
  }

  // ---------- 各パート ----------
  const voices = {
    kick(t, v) {
      osc(t, 150, 0.14, { type: 'sine', gain: 0.95 * v, dest: master, slideTo: 42, attack: 0.002, release: 0.04 });
    },
    bass(t, midi, lenSteps, v, sec) {
      const f = midiToHz(midi);
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 900; lpf.Q.value = 2;
      lpf.connect(master);
      const dur = Math.max(0.08, lenSteps * sec * 0.9);
      osc(t, f, dur, { type: 'sawtooth', gain: 0.3 * v, dest: lpf, release: 0.05, extra: [lpf] });
      osc(t, f, dur, { type: 'sine', gain: 0.38 * v, dest: master, release: 0.05 });
    },
    clap(t, v) {
      for (const d of [0, 0.011, 0.024]) noise(t + d, d === 0.024 ? 0.13 : 0.03, { gain: 0.34 * v, hp: 900, lp: 5500 });
    },
    hat(t, v, open) {
      noise(t, open ? 0.16 : 0.035, { gain: (open ? 0.12 : 0.15) * v, hp: 7500 });
    },
    stab(t, chord, v, sec) {
      for (const m of chord) {
        osc(t, midiToHz(m), sec * 1.4, { type: 'sawtooth', gain: 0.055 * v, dest: melodyFilter, detune: m % 2 ? 7 : -7, attack: 0.006, release: 0.07 });
      }
    },
    arp(t, midi, v, sec, up) {
      osc(t, midiToHz(midi + (up ? 12 : 0)), sec * 0.9, { type: 'square', gain: 0.034 * v, dest: melodyFilter, attack: 0.003, release: 0.04 });
    },
    lead(t, midi, lenSteps, v, sec, oct) {
      const dur = Math.max(0.1, lenSteps * sec * 0.92);
      osc(t, midiToHz(midi), dur, { type: 'triangle', gain: 0.12 * v, dest: melodyFilter, attack: 0.01, release: 0.09 });
      osc(t, midiToHz(midi), dur, { type: 'square', gain: 0.03 * v, dest: melodyFilter, detune: 5, attack: 0.01, release: 0.09 });
      if (oct) osc(t, midiToHz(midi + 12), dur, { type: 'sine', gain: 0.07 * v, dest: melodyFilter, attack: 0.01, release: 0.09 });
    },
    crash(t, v) { noise(t, 0.7, { gain: 0.1 * v, hp: 5000 }); },
  };

  function hit(layer, t) {
    st.hits[layer]++;
    eng.onHit?.(layer, { stepIndex, time: t });
  }

  function scheduleStep(t, sec) {
    const p = patternAt(stepIndex);
    const L = layers;
    if (L.bass > 0 && p.bass) { voices.bass(t, p.bass.midi, p.bass.len, L.bass, sec); hit('bass', t); }
    if (L.kick > 0 && p.kick) { voices.kick(t, p.kick * L.kick); hit('kick', t); }
    if (L.clap > 0 && p.clap) { voices.clap(t, L.clap); hit('clap', t); }
    if (L.hat > 0 && p.hat) { voices.hat(t, p.hat * L.hat, false); hit('hat', t); }
    if (L.hat16 > 0 && p.hat16) { voices.hat(t, p.hat16 * L.hat16, false); hit('hat16', t); }
    if (L.chords > 0 && p.stab) { voices.stab(t, p.chord, L.chords, sec); hit('chords', t); }
    if (L.arp > 0 && p.arp != null) { voices.arp(t, p.arp, L.arp, sec, false); hit('arp', t); }
    if (L.arp16 > 0 && p.arp16 != null) { voices.arp(t, p.arp16, L.arp16, sec, L.leadOct > 0); hit('arp16', t); }
    if (L.lead > 0 && p.lead) { voices.lead(t, p.lead.midi, p.lead.len, L.lead, sec, L.leadOct > 0); hit('lead', t); }
    if (L.fever > 0) {
      // フィーバー: BGM と一体の 4 つ打ち強化・裏のオープンハイハット・小節頭のクラッシュ(別のビートは鳴らさない)
      if (p.step % 4 === 0) { voices.kick(t, 0.5 * L.fever); hit('fever', t); }
      if (p.step % 4 === 2) voices.hat(t, 0.9 * L.fever, true);
      if (p.step === 0) voices.crash(t, L.fever);
    }
  }

  function applyPending() {
    if (!pending || !isBoundary(stepIndex, pending.grid)) return;
    layers = { ...pending.target.layers };
    desiredBpm = pending.target.bpm;
    filterFreq = freqOfFilter(layers.filter);
    melodyFilter.frequency.setTargetAtTime(filterFreq, nextTime, 0.06);
    pending = null;
  }

  // ---------- 公開 API ----------
  Object.assign(eng, {
    /** time から再生開始。target はそのまま即時に適用。 */
    start(time, target) {
      layers = { ...target.layers };
      bpm = desiredBpm = target.bpm;
      pending = null;
      stepIndex = 0;
      nextTime = time;
      enabled = true;
      filterFreq = freqOfFilter(layers.filter);
      melodyFilter.frequency.setValueAtTime(filterFreq, time);
      master.gain.cancelScheduledValues(time);
      master.gain.setValueAtTime(0.0001, time);
      master.gain.setTargetAtTime(masterLevel, time, 0.03);
    },
    /** 切り替えを要求。grid ステップの格子点(小節頭=16 / 拍頭=4)で適用される。先に出ていた要求の格子は引き継ぐ。 */
    setTarget(target, grid) {
      if (!grid) return;
      pending = { target, grid: pending ? Math.max(pending.grid, grid) : grid };
    },
    /** until より前のステップをすべてスケジュール。 */
    advanceTo(until) {
      while (nextTime < until) {
        applyPending();
        if (isBoundary(stepIndex, STEPS_PER_BAR)) bpm = desiredBpm; // テンポは小節頭でだけ変える
        const sec = stepSeconds(bpm);
        eng.onStep?.(stepIndex, nextTime, bpm);
        if (enabled) scheduleStep(nextTime, sec);
        nextTime += sec;
        stepIndex++;
      }
    },
    /** 止まっていたあとの再開: 次の小節頭からそろえて鳴らす。 */
    restart(now) {
      stepIndex = Math.ceil(stepIndex / STEPS_PER_BAR) * STEPS_PER_BAR;
      nextTime = now + 0.08;
      enabled = true;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(masterLevel, now, 0.03);
    },
    position: () => ({ stepIndex, nextTime, bpm }),
    /** 効果音の音が埋もれないよう、BGM を一瞬だけ下げる。 */
    duck(t) {
      if (!enabled) return;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(masterLevel * 0.55, t, 0.015);
      master.gain.setTargetAtTime(masterLevel, t + 0.16, 0.12);
    },
    /** コンボ切れ: フィルターを一瞬閉じてから戻す。 */
    filterDip(t, dur = 0.45) {
      const f = melodyFilter.frequency;
      f.cancelScheduledValues(t);
      f.setTargetAtTime(500, t, 0.02);
      f.setTargetAtTime(filterFreq, t + dur, 0.15);
    },
    setMaster(v, t) {
      masterLevel = v;
      enabled = true;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(v, t, 0.03);
    },
    fadeOut(t) {
      enabled = false;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(0.0001, t, 0.04);
    },
    stats: () => ({ created: st.created, ended: st.ended, live: st.created - st.ended, hits: { ...st.hits } }),
  });
  return eng;
}
