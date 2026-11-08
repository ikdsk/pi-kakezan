import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BPM_NORMAL, BPM_TIME, STEPS_PER_BAR, LOOP_STEPS, BEAT_STEPS, C_MAJOR, LAYER_KEYS,
  midiToHz, stepSeconds, barSeconds, patternAt, screenMode, bgmTarget, sceneKey,
  transitionGrid, isBoundary, stepsUntil, secondsUntilBoundary,
} from '../js/bgm.js';

const pc = (m) => ((m % 12) + 12) % 12;
const loop = Array.from({ length: LOOP_STEPS }, (_, i) => patternAt(i));
const base = { mode: 'quiz', combo: 0, time: false, calm: false };
const on = (layers) => LAYER_KEYS.filter((k) => layers[k] > 0);

test('テンポと周波数', () => {
  assert.equal(BPM_NORMAL, 132);
  assert.equal(BPM_TIME, 140);
  assert.ok(BPM_NORMAL >= 128 && BPM_NORMAL <= 140 && BPM_TIME >= 128 && BPM_TIME <= 140);
  assert.equal(STEPS_PER_BAR, 16);
  assert.equal(LOOP_STEPS, 64);
  assert.ok(Math.abs(stepSeconds(132) - 60 / 132 / 4) < 1e-12);
  assert.ok(Math.abs(barSeconds(132) - 16 * stepSeconds(132)) < 1e-12);
  assert.ok(stepSeconds(140) < stepSeconds(132), '140 のほうが速い');
  assert.equal(midiToHz(69), 440);
  assert.ok(Math.abs(midiToHz(60) - 261.6256) < 0.001);
});

test('パターンは 4 小節でループする', () => {
  for (let i = 0; i < 300; i++) assert.deepEqual(patternAt(i), patternAt(i + LOOP_STEPS), `step ${i}`);
  assert.deepEqual(patternAt(-1), patternAt(LOOP_STEPS - 1));
  assert.equal(patternAt(0).bar, 0);
  assert.equal(patternAt(17).bar, 1);
  assert.equal(patternAt(17).step, 1);
  assert.equal(patternAt(63).bar, 3);
});

test('すべての音が C メジャー(ドレミファソラシ)の音で、音域に収まる', () => {
  for (const p of loop) {
    if (p.bass) { assert.ok(C_MAJOR.includes(pc(p.bass.midi)), `bass ${p.bass.midi}`); assert.ok(p.bass.midi >= 36 && p.bass.midi <= 62); }
    for (const m of p.chord) { assert.ok(C_MAJOR.includes(pc(m)), `chord ${m}`); assert.ok(m >= 55 && m <= 72); }
    for (const a of [p.arp, p.arp16]) if (a != null) { assert.ok(C_MAJOR.includes(pc(a)), `arp ${a}`); assert.ok(a >= 55 && a <= 84); }
    if (p.lead) { assert.ok(C_MAJOR.includes(pc(p.lead.midi)), `lead ${p.lead.midi}`); assert.ok(p.lead.midi >= 72 && p.lead.midi <= 88); assert.ok(p.lead.len >= 1); }
  }
});

test('コード進行 C → G → Am → F(+G)', () => {
  const rootAt = (bar, step) => patternAt(bar * 16 + step).chordRoot;
  assert.deepEqual([0, 1, 2, 3].map((b) => rootAt(b, 0)), [48, 43, 45, 41]);
  assert.equal(rootAt(3, 8), 43, '最後の小節の後半は G');
  assert.deepEqual(patternAt(0).chord.map(pc), [0, 4, 7]); // C E G
  assert.deepEqual(patternAt(16).chord.map(pc).sort((a, b) => a - b), [2, 7, 11]); // D G B
  assert.deepEqual(patternAt(32).chord.map(pc).sort((a, b) => a - b), [0, 4, 9]); // A C E
  assert.deepEqual(patternAt(48).chord.map(pc).sort((a, b) => a - b), [0, 5, 9]); // F A C
});

test('ドラムとベースのグルーヴ', () => {
  for (let bar = 0; bar < 4; bar++) {
    const s = (n) => patternAt(bar * 16 + n);
    for (const n of [0, 4, 8, 12]) assert.ok(s(n).kick > 0, `kick ${bar}:${n}`);
    assert.deepEqual([...Array(16).keys()].filter((n) => s(n).clap).sort((a, b) => a - b), [4, 12], 'クラップは 2・4 拍');
    assert.ok(s(0).bass, '小節頭にベース');
    assert.ok([...Array(16).keys()].filter((n) => s(n).bass).length >= 5, 'ベースは動く');
    for (const n of [2, 6, 10, 14]) assert.ok(s(n).hat > 0, '裏拍のハイハット');
    for (const n of [1, 3, 5, 7]) assert.equal(s(n).hat, 0, '8分ハイハットは偶数ステップのみ');
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      assert.equal(typeof s(n).hat16, 'number');
    }
    assert.ok([1, 3, 5, 7, 9, 11, 13, 15].every((n) => s(n).hat16 > 0), '16 分ハイハットは奇数ステップ');
    assert.ok([0, 2, 4].every((n) => s(n).arp != null), '8 分のアルペジオ');
    assert.ok(s(1).arp == null && s(1).arp16 != null, '16 分アルペジオは奇数ステップ');
  }
  assert.ok(loop.filter((p) => p.stab).length >= 8, 'コードのスタブがある');
  assert.ok(loop.some((p) => p.lead) && loop.some((p) => !p.lead), 'リードは休符を含む');
  assert.ok(loop.filter((p) => p.lead).length >= 20);
});

test('画面 → メニュー / クイズ', () => {
  for (const s of ['home', 'table', 'achievements', 'records', 'result', 'nonsense', undefined]) assert.equal(screenMode(s), 'menu', String(s));
  for (const s of ['flash', 'choice', 'twotap', 'reverse', 'time']) assert.equal(screenMode(s), 'quiz', s);
});

test('メニュー: ベース+ごく薄いキックだけ(音量控えめ)', () => {
  const t = bgmTarget({ mode: 'menu' });
  assert.deepEqual(on(t.layers).sort(), ['bass', 'filter', 'kick'].sort());
  assert.ok(t.layers.kick > 0 && t.layers.kick <= 0.4);
  assert.ok(t.layers.bass > 0 && t.layers.bass < bgmTarget(base).layers.bass, 'メニューのベースはクイズより控えめ');
  for (const k of ['clap', 'hat', 'hat16', 'chords', 'arp', 'arp16', 'lead', 'leadOct', 'fever']) assert.equal(t.layers[k], 0, k);
});

test('クイズ: ドラム・コード・アルペジオが加わる / テンポとキーは同じ', () => {
  const m = bgmTarget({ mode: 'menu' });
  const q = bgmTarget(base);
  for (const k of ['bass', 'kick', 'clap', 'hat', 'chords', 'arp']) assert.ok(q.layers[k] > 0, k);
  for (const k of ['hat16', 'lead', 'leadOct', 'arp16', 'fever']) assert.equal(q.layers[k], 0, `基本のクイズに ${k} はまだ無い`);
  assert.equal(q.bpm, m.bpm, 'メニュー→クイズでテンポは同じ');
  assert.equal(q.bpm, BPM_NORMAL);
  for (const k of LAYER_KEYS) assert.ok(q.layers[k] >= m.layers[k] || k === 'filter', `${k} は抜けない`);
});

test('コンボ連動: 5〜でハイハット16分+リード、10〜でフィルター全開+オクターブ、20〜フィーバー', () => {
  for (const c of [0, 1, 2, 3, 4]) assert.deepEqual(bgmTarget({ ...base, combo: c }), bgmTarget(base), `combo ${c} は変わらない`);
  const c5 = bgmTarget({ ...base, combo: 5 }).layers;
  assert.ok(c5.hat16 > 0 && c5.lead > 0);
  assert.equal(c5.leadOct, 0);
  assert.ok(c5.filter > bgmTarget(base).layers.filter);
  const c10 = bgmTarget({ ...base, combo: 10 }).layers;
  assert.ok(c10.leadOct > 0 && c10.arp16 > 0);
  assert.equal(c10.filter, 1);
  assert.equal(c10.fever, 0);
  const c20 = bgmTarget({ ...base, combo: 20 }).layers;
  assert.ok(c20.fever > 0);
  // 段階が上がるほどレイヤーは増えるだけで、抜けない
  let prev = bgmTarget(base).layers;
  for (const c of [5, 10, 20, 35]) {
    const cur = bgmTarget({ ...base, combo: c }).layers;
    for (const k of LAYER_KEYS) assert.ok(cur[k] >= prev[k], `${k} at ${c}`);
    prev = cur;
  }
  for (const c of [0, 5, 10, 20]) assert.equal(bgmTarget({ ...base, combo: c }).bpm, BPM_NORMAL, 'コンボでテンポは変えない');
});

test('えんしゅつ ひかえめ: コンボ連動の激しい変化は抑える', () => {
  const calm = (c) => bgmTarget({ ...base, combo: c, calm: true });
  for (const c of [5, 10, 20, 50]) assert.deepEqual(calm(c), calm(4), `calm combo ${c}`);
  const c20 = calm(20).layers;
  for (const k of ['hat16', 'lead', 'leadOct', 'arp16', 'fever']) assert.equal(c20[k], 0, k);
  assert.ok(c20.chords > 0 && c20.clap > 0, '基本のクイズ BGM は鳴る');
});

test('タイムアタック: テンポ速め+16分ハイハットで緊張感', () => {
  const t = bgmTarget({ ...base, time: true });
  assert.equal(t.bpm, BPM_TIME);
  assert.ok(t.layers.hat16 > 0);
  assert.ok(t.layers.clap > 0 && t.layers.chords > 0);
  assert.equal(bgmTarget({ mode: 'menu', time: true }).bpm, BPM_NORMAL, 'メニューは常に通常テンポ');
});

test('切り替えのタイミング: メニュー→クイズは小節頭、それ以外は拍頭', () => {
  const menu = { mode: 'menu' };
  const quiz = { ...base };
  assert.equal(transitionGrid(menu, quiz), 16);
  assert.equal(transitionGrid(quiz, menu), 4);
  assert.equal(transitionGrid(quiz, { ...quiz, combo: 5 }), 4);
  assert.equal(transitionGrid(quiz, { ...quiz, combo: 10 }), 4);
  assert.equal(transitionGrid(quiz, { ...quiz, time: true }), 16, 'テンポが変わるときは小節頭');
  assert.equal(transitionGrid(null, quiz), 0, '最初は即時');
  assert.equal(transitionGrid(quiz, { ...quiz }), 0, '変化なしは何もしない');
  assert.equal(transitionGrid(quiz, { ...quiz, combo: 2 }), 0, '同じレイヤーなら何もしない');
});

test('小節頭・拍頭までの待ち時間', () => {
  assert.equal(isBoundary(0, 16), true);
  assert.equal(isBoundary(16, 16), true);
  assert.equal(isBoundary(15, 16), false);
  assert.equal(isBoundary(8, 4), true);
  assert.equal(stepsUntil(0, 16), 0);
  assert.equal(stepsUntil(1, 16), 15);
  assert.equal(stepsUntil(16, 16), 0);
  assert.equal(stepsUntil(17, 16), 15);
  assert.equal(stepsUntil(5, 4), 3);
  assert.equal(stepsUntil(8, 4), 0);
  const sec = stepSeconds(132);
  const w = secondsUntilBoundary({ nextStepIndex: 5, nextStepTime: 10, now: 9.9, grid: 16, bpm: 132 });
  assert.ok(Math.abs(w - (0.1 + 11 * sec)) < 1e-9, String(w));
  assert.equal(secondsUntilBoundary({ nextStepIndex: 16, nextStepTime: 10, now: 10, grid: 16, bpm: 132 }), 0);
  assert.equal(secondsUntilBoundary({ nextStepIndex: 16, nextStepTime: 10, now: 10.5, grid: 16, bpm: 132 }), 0, '過ぎていたら 0');
  assert.ok(Math.abs(secondsUntilBoundary({ nextStepIndex: 3, nextStepTime: 1, now: 0.99, grid: 4, bpm: 140 }) - (0.01 + stepSeconds(140))) < 1e-9);
});

test('同じシーンは同じキー', () => {
  assert.equal(sceneKey({ ...base, combo: 6 }), sceneKey({ ...base, combo: 9 }), '同じレイヤーなら同じキー');
  assert.notEqual(sceneKey({ ...base, combo: 6 }), sceneKey({ ...base, combo: 10 }));
  assert.notEqual(sceneKey({ mode: 'menu' }), sceneKey(base));
  assert.equal(sceneKey({ ...base, combo: 3, calm: true }), sceneKey({ ...base, combo: 30, calm: true }));
});
