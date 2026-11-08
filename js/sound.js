// 音: 効果音と BGM を Web Audio で合成する(音声ファイル・外部通信なし)。
// - 効果音(🔊)と BGM(🎵)は別々にオン/オフできる。
// - iOS は最初のタップの中で AudioContext を作って resume しないと鳴らない(unlock)。
// - BGM は lookahead 方式(setInterval 25ms + currentTime の先読み)で鳴らし、タブが隠れたら止める。
// - 効果音は BGM と同じ C メジャーの音にそろえ、鳴るときは BGM を一瞬だけ下げて埋もれないようにする。
import { createBgmEngine } from './bgmsynth.js';
import { bgmTarget, transitionGrid } from './bgm.js';

const TICK_MS = 25;
const LOOKAHEAD = 0.12; // 秒
const SFX_GAIN = 1.5; // 効果音の音量(BGM に埋もれないよう BGM より大きめ)
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // C メジャーペンタトニック(C5 からの半音)

/**
 * options: { sfx: 効果音, bgm: BGM }(boolean を渡すと効果音だけの指定)
 * env(書き出し用): { ctx: 既存の AudioContext / OfflineAudioContext, now: () => 基準時刻 }
 */
export function createSound(options = {}, env = {}) {
  const opt = typeof options === 'boolean' ? { sfx: options } : options;
  let on = opt.sfx ?? true;
  let bgmOn = opt.bgm ?? true;
  let ctx = env.ctx ?? null;
  const offline = !!env.ctx;
  const now = () => (env.now ? env.now() : ctx ? ctx.currentTime : 0);

  function getCtx() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (!offline && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
      return ctx;
    } catch {
      return null;
    }
  }
  const ensure = () => (on ? getCtx() : null);

  // 効果音と BGM の合流点(リミッター): 重なってもクリップ(音割れ)しないようにする
  let master = null;
  function getOut(c) {
    if (!master) {
      master = c.createDynamicsCompressor();
      master.threshold.value = -5; master.knee.value = 0; master.ratio.value = 20;
      master.attack.value = 0.002; master.release.value = 0.12;
      master.connect(c.destination);
    }
    return master;
  }

  // ---------- 効果音の部品(使い捨て。鳴り終わったら disconnect) ----------
  function release(src, nodes) {
    src.onended = () => {
      try { src.disconnect(); } catch { /* 切断済み */ }
      for (const n of nodes) { try { n.disconnect(); } catch { /* 切断済み */ } }
    };
  }

  function tone(freq, at, dur, { type = 'square', gain = 0.12, slideTo = null } = {}) {
    const c = ensure();
    if (!c) return;
    try {
      const t0 = now() + at;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.min(gain * SFX_GAIN, 0.45), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(getOut(c));
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
      release(osc, [g]);
    } catch { /* 音が出なくてもアプリは止めない */ }
  }

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
      const t0 = now() + at;
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      const hpf = c.createBiquadFilter();
      hpf.type = 'highpass'; hpf.frequency.value = hp;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.min(gain * SFX_GAIN, 0.45), t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const nodes = [hpf, g];
      let node = hpf;
      src.connect(hpf);
      if (lpFrom) {
        const lpf = c.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(lpFrom, t0);
        lpf.frequency.exponentialRampToValueAtTime(lpTo ?? lpFrom, t0 + dur);
        hpf.connect(lpf); node = lpf; nodes.push(lpf);
      }
      node.connect(g).connect(getOut(c));
      src.start(t0);
      src.stop(t0 + dur + 0.03);
      release(src, nodes);
    } catch { /* 音が出なくてもアプリは止めない */ }
  }

  const note = (semi) => 523.25 * 2 ** (semi / 12); // ド(C5)からの半音
  const arp = (semis, step, dur, opts) => semis.forEach((s, i) => tone(note(s), i * step, dur, opts));

  // ---------- BGM ----------
  let engine = null;
  let timer = null;
  let started = false;
  let paused = false;
  let scene = { mode: 'menu' };

  function getEngine() {
    const c = getCtx();
    if (!c) return null;
    if (!engine) engine = createBgmEngine(c, { out: getOut(c) });
    return engine;
  }
  function tick() {
    if (!engine || !ctx) return;
    const t = ctx.currentTime;
    if (engine.position().nextTime < t - 0.25) engine.restart(t); // 大きく遅れたら(メインスレッドが止まったなど)小節頭からそろえ直す
    engine.advanceTo(t + LOOKAHEAD);
  }
  function startTimer() {
    if (timer === null) timer = setInterval(tick, TICK_MS);
  }
  function stopTimer() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }
  function bgmStart() {
    if (!bgmOn || paused || (document.hidden && !offline)) return;
    const c = getCtx();
    const e = c && getEngine();
    if (!e) return;
    if (!started) { e.start(c.currentTime + 0.05, bgmTarget(scene)); started = true; }
    startTimer();
    tick();
  }
  function bgmStop() {
    stopTimer();
    started = false;
    if (engine && ctx) engine.fadeOut(ctx.currentTime);
  }
  // タブ/アプリが見えなくなったら止め、戻ったら小節頭から再開
  function onVisibility() {
    if (!ctx) return;
    if (document.hidden) {
      paused = true;
      stopTimer();
      if (engine) engine.fadeOut(ctx.currentTime);
      ctx.suspend?.().catch(() => {});
    } else {
      paused = false;
      Promise.resolve(ctx.resume?.()).catch(() => {}).then(() => {
        if (paused || !bgmOn || !engine || !started) return;
        engine.restart(ctx.currentTime);
        startTimer();
        tick();
      });
    }
  }
  if (!offline && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  const duck = () => { if (on && engine && ctx) engine.duck(now()); }; // 効果音が鳴るときだけ BGM を一瞬下げる

  return {
    // ----- 効果音(🔊)-----
    isEnabled: () => on,
    setEnabled(v) { on = !!v; if (on) getCtx(); },
    // ----- BGM(🎵)-----
    isBgmEnabled: () => bgmOn,
    setBgmEnabled(v) {
      bgmOn = !!v;
      if (bgmOn) { getCtx(); bgmStop(); bgmStart(); } else bgmStop();
    },
    /** 画面・コンボの状況を伝える。メニュー→クイズは小節頭、コンボ連動は拍頭で切り替わる。 */
    bgmScene(next) {
      const prev = scene;
      scene = next;
      if (!engine || !started) return;
      const grid = transitionGrid(prev, next);
      if (grid) engine.setTarget(bgmTarget(next), grid);
    },
    /** コンボ切れ: フィルターを一瞬閉じる。 */
    bgmDip() { if (engine && ctx && started) engine.filterDip(ctx.currentTime, 0.45); },
    bgmStats: () => ({ running: timer !== null, started, paused, ...(engine ? engine.stats() : { created: 0, ended: 0, live: 0, hits: {} }) }),
    /** 書き出し(OfflineAudioContext)用: BGM エンジンを直接動かすために取り出す。 */
    engine: getEngine,
    /** ユーザーのタップの中で呼ぶ(iOS 対策)。最初のタップで AudioContext を resume し、BGM を始める。 */
    unlock() {
      if (!on && !bgmOn) return;
      if (!getCtx()) return;
      if (bgmOn && !started && !paused) bgmStart();
    },
    tap() { tone(note(7), 0, 0.05, { type: 'triangle', gain: 0.08 }); },
    correct(combo = 0) {
      duck();
      const i = Math.min(Math.max(combo, 0), 6);
      tone(note(PENTA[i]), 0, 0.09, { gain: 0.12 });
      tone(note(PENTA[i + 2]), 0.07, 0.14, { gain: 0.12 });
    },
    /**
     * コンボ演出の音。kind: 'pop'(ふつう)/ 'chord'(和音・ピッチアップ)/ 'boom'(ドーン+ファンファーレ)/ 'fever'。
     * C メジャーの I・IV・V の和音を使い、コンボが増えると高くなる。
     */
    comboHit(kind, combo = 1) {
      if (kind === 'pop') { this.correct(combo); return; }
      duck();
      if (kind === 'chord') {
        const r = [0, 5, 7][Math.max(combo - 5, 0) % 3] + (combo >= 8 ? 12 : 0);
        noise(0, 0.25, { gain: 0.05, hp: 1500, lpFrom: 800, lpTo: 6000 }); // ウーシュ
        arp([r, r + 4, r + 7, r + 12], 0.0, 0.2, { gain: 0.09 });
        tone(note(r - 12), 0, 0.18, { type: 'triangle', gain: 0.14, slideTo: note(r - 24) });
        return;
      }
      const hi = kind === 'fever' ? 5 : 0;
      noise(0, 0.3, { gain: 0.06, hp: 1200, lpFrom: 600, lpTo: 8000 });
      tone(95, 0, 0.45, { type: 'sine', gain: 0.3, slideTo: 32 }); // 低音ドーン
      arp([0, 4, 7, 12, 16, 19].map((s) => s + hi), 0.06, 0.2, { gain: 0.1 });
      arp([12, 16, 19, 24].map((s) => s + hi), 0.0, 0.5, { type: 'triangle', gain: 0.08 });
      if (kind === 'fever') arp([24, 28, 31, 36].map((s) => s + hi), 0.5, 0.09, { type: 'sine', gain: 0.08 });
    },
    /** 画面を叩きつける「ドン」。 */
    thump() { tone(130, 0, 0.14, { type: 'sine', gain: 0.22, slideTo: 48 }); },
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
      duck();
      arp([0, 4, 7, 12, 7, 12, 16, 19], 0.09, 0.2, { gain: 0.12 });
      tone(note(24), 0.8, 0.5, { type: 'triangle', gain: 0.12 });
    },
    achievement() {
      duck();
      tone(note(12), 0, 0.12, { type: 'triangle', gain: 0.13 });
      tone(note(19), 0.1, 0.12, { type: 'triangle', gain: 0.13 });
      tone(note(24), 0.2, 0.35, { type: 'triangle', gain: 0.13 });
      arp([28, 31, 36], 0.4, 0.08, { type: 'sine', gain: 0.07 });
    },
    clear() {
      duck();
      arp([0, 4, 7, 12, 16, 19, 24, 19, 24, 28], 0.11, 0.25, { gain: 0.12 });
      tone(note(31), 1.2, 0.9, { type: 'triangle', gain: 0.13 });
    },
  };
}
