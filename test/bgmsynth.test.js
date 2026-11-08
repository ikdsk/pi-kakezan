import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBgmEngine } from '../js/bgmsynth.js';
import { bgmTarget, stepSeconds, BPM_NORMAL, BPM_TIME } from '../js/bgm.js';

// 最小の AudioContext モック。stop 時刻を過ぎたノードに onended を返す(実機と同じ寿命管理を再現)。
function mockCtx() {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const ctx = {
    currentTime: 0, sampleRate: 44100, destination: { name: 'dest' }, all: [], sources: [],
    node(extra = {}) { const n = { connect(x) { return x; }, disconnect() { this.disconnected = true; }, ...extra }; ctx.all.push(n); return n; },
    createGain() { return ctx.node({ gain: param() }); },
    createBiquadFilter() { return ctx.node({ frequency: param(), Q: param(), type: '' }); },
    createDynamicsCompressor() { return ctx.node({ threshold: param(), ratio: param(), knee: param(), attack: param(), release: param() }); },
    createBuffer() { return { getChannelData: () => new Float32Array(8) }; },
    createOscillator() { const n = ctx.node({ type: '', frequency: param(), detune: param(), start(t) { this.startT = t; }, stop(t) { this.stopT = t; }, onended: null }); ctx.sources.push(n); return n; },
    createBufferSource() { const n = ctx.node({ buffer: null, playbackRate: param(), start(t) { this.startT = t; }, stop(t) { this.stopT = t; }, onended: null }); ctx.sources.push(n); return n; },
    advance(t) {
      ctx.currentTime = t;
      for (const s of ctx.sources) if (s.stopT !== undefined && s.stopT <= t && !s.ended) { s.ended = true; s.onended?.(); }
      ctx.sources = ctx.sources.filter((s) => !s.ended);
    },
  };
  return ctx;
}
const quiz = bgmTarget({ mode: 'quiz', combo: 0 });
const menu = bgmTarget({ mode: 'menu' });
const run = (eng, ctx, from, to, tick = 0.025) => { for (let t = from; t < to; t += tick) { ctx.advance(t); eng.advanceTo(t + 0.12); } };

test('メニュー: ベースとキックだけ鳴る', () => {
  const ctx = mockCtx();
  const eng = createBgmEngine(ctx);
  eng.start(0, menu);
  run(eng, ctx, 0, 8);
  const h = eng.stats().hits;
  assert.ok(h.bass > 0 && h.kick > 0);
  for (const k of ['clap', 'hat', 'hat16', 'chords', 'arp', 'arp16', 'lead', 'fever']) assert.equal(h[k] ?? 0, 0, k);
});

test('メニュー→クイズは小節頭でレイヤーが入る(ブツ切れにしない)', () => {
  const ctx = mockCtx();
  const eng = createBgmEngine(ctx);
  const steps = [];
  eng.onStep = (i) => steps.push(i);
  const first = {};
  eng.onHit = (layer, info) => { if (!(layer in first)) first[layer] = info; };
  eng.start(0, menu);
  const sec = stepSeconds(BPM_NORMAL);
  run(eng, ctx, 0, 7 * sec);                 // 7 ステップ目(小節の途中)
  eng.setTarget(quiz, 16);
  run(eng, ctx, 7 * sec, 6);
  // 小節頭に音があるパートは、ちょうど次の小節頭(16)から入る
  for (const k of ['hat', 'chords', 'arp']) {
    assert.ok(first[k], `${k} が入った`);
    assert.equal(first[k].stepIndex, 16, `${k} は次の小節頭(16)から`);
  }
  // クラップは 2・4 拍(小節の 4・12 ステップ目)だけなので、その小節の 20 が最初
  assert.equal(first.clap.stepIndex, 20);
  assert.ok(first.clap.stepIndex >= 16, '小節頭より前には入らない');
  assert.ok(first.bass.stepIndex === 0, 'ベースは最初から途切れず鳴っている');
  // ステップは連続(欠け・重複なし)
  for (let i = 1; i < steps.length; i++) assert.equal(steps[i], steps[i - 1] + 1);
});

test('コンボ連動のレイヤーは拍頭で入る', () => {
  const ctx = mockCtx();
  const eng = createBgmEngine(ctx);
  const first = {};
  eng.onHit = (layer, info) => { if (!(layer in first)) first[layer] = info; };
  eng.start(0, quiz);
  const sec = stepSeconds(BPM_NORMAL);
  run(eng, ctx, 0, 21.5 * sec);
  eng.setTarget(bgmTarget({ mode: 'quiz', combo: 5 }), 4);
  run(eng, ctx, 21.5 * sec, 8);
  assert.equal(first.lead.stepIndex % 4, 0);
  assert.equal(first.lead.stepIndex, 24, '次の拍頭(24)からリードが入る');
  assert.equal(first.hat16.stepIndex, 25, '16 分ハイハットは奇数ステップなので 24 の次');
  run(eng, ctx, 8, 9);
  eng.setTarget(bgmTarget({ mode: 'quiz', combo: 20 }), 4);
  run(eng, ctx, 9, 14);
  assert.ok(eng.stats().hits.fever > 0, 'フィーバーのレイヤー(BGM と一体)');
});

test('クイズ→メニューでレイヤーが抜けてベースに戻る', () => {
  const ctx = mockCtx();
  const eng = createBgmEngine(ctx);
  eng.start(0, quiz);
  run(eng, ctx, 0, 4);
  eng.setTarget(menu, 4);
  run(eng, ctx, 4, 4.6);
  const before = { ...eng.stats().hits };
  run(eng, ctx, 4.6, 12);
  const after = eng.stats().hits;
  for (const k of ['clap', 'hat', 'chords', 'arp', 'lead']) assert.equal(after[k] ?? 0, before[k] ?? 0, `${k} は止まった`);
  assert.ok(after.bass > before.bass && after.kick > before.kick, 'ベースとキックは続く');
});

test('テンポ変更(タイムアタック)は小節頭で切り替わる', () => {
  const ctx = mockCtx();
  const eng = createBgmEngine(ctx);
  const info = [];
  eng.onStep = (i, t, bpm) => info.push({ i, t, bpm });
  eng.start(0, quiz);
  run(eng, ctx, 0, 2);
  eng.setTarget(bgmTarget({ mode: 'quiz', time: true }), 16);
  run(eng, ctx, 2, 8);
  const bpmAt = (i) => info.find((x) => x.i === i).bpm;
  assert.equal(bpmAt(15), BPM_NORMAL);
  const change = info.find((x) => x.bpm === BPM_TIME);
  assert.equal(change.i % 16, 0, '小節頭からテンポが変わる');
  // 切り替え以降のステップ間隔は 140 BPM
  const k = info.findIndex((x) => x.bpm === BPM_TIME);
  assert.ok(Math.abs((info[k + 1].t - info[k].t) - stepSeconds(BPM_TIME)) < 1e-9);
  assert.ok(Math.abs((info[k].t - info[k - 1].t) - stepSeconds(BPM_NORMAL)) < 1e-9);
});

test('ノードは使い捨て: 鳴り終わったら disconnect され、生きているノード数が増え続けない', () => {
  const ctx = mockCtx();
  const eng = createBgmEngine(ctx);
  eng.start(0, bgmTarget({ mode: 'quiz', combo: 25 })); // いちばんノードが多いフィーバー編成
  run(eng, ctx, 0, 30);
  const s = eng.stats();
  assert.ok(s.created > 300, `created ${s.created}`);
  assert.ok(s.live < 80, `live ${s.live}`);
  assert.equal(s.created - s.ended, s.live);
  for (const n of ctx.all) if (n.ended) assert.equal(n.disconnected, true, '終わったノードは disconnect 済み');
});

test('30 分相当(25ms 間隔のスケジューラ)でノード数が増え続けない', () => {
  const ctx = mockCtx();
  const eng = createBgmEngine(ctx);
  eng.start(0, menu);
  let maxLive = 0; const samples = [];
  const scenes = [menu, quiz, bgmTarget({ mode: 'quiz', combo: 5 }), bgmTarget({ mode: 'quiz', combo: 10 }), bgmTarget({ mode: 'quiz', combo: 20 }), bgmTarget({ mode: 'quiz', time: true }), menu];
  const TOTAL = 1800;
  for (let t = 0, tick = 0; t < TOTAL; t += 0.025, tick++) {
    if (tick % 800 === 0) eng.setTarget(scenes[(tick / 800) % scenes.length], 4); // 20 秒ごとにシーン変更
    ctx.advance(t); eng.advanceTo(t + 0.12);
    maxLive = Math.max(maxLive, eng.stats().live);
    if (tick % 4000 === 0) samples.push(eng.stats().live);
  }
  const s = eng.stats();
  console.log(`  30分相当: created=${s.created} ended=${s.ended} live=${s.live} maxLive=${maxLive} ctxにぶら下がるノード=${ctx.sources.length}`);
  assert.ok(s.created > 30000, 'たくさん鳴らした');
  assert.ok(maxLive < 120, `maxLive ${maxLive}`);
  assert.ok(ctx.sources.length < 120);
  assert.ok(Math.max(...samples) < 120);
});

test('時計が止まっていた(タブが裏にいた)あとの再開は小節頭からそろえる', () => {
  const ctx = mockCtx();
  const eng = createBgmEngine(ctx);
  eng.start(0, quiz);
  run(eng, ctx, 0, 5);
  const idx = eng.position().stepIndex;
  eng.restart(30);
  const p = eng.position();
  assert.equal(p.stepIndex % 16, 0, '小節頭');
  assert.ok(p.stepIndex >= idx);
  assert.ok(p.nextTime >= 30);
});

test('ducking と フィルターを一瞬閉じる処理は例外を出さない', () => {
  const ctx = mockCtx();
  const eng = createBgmEngine(ctx);
  eng.start(0, quiz);
  assert.doesNotThrow(() => { eng.duck(0.5); eng.filterDip(0.6, 0.4); eng.setMaster(0.3, 1); eng.fadeOut(2); });
});
