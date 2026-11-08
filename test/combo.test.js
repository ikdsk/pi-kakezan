import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIG_COMBOS, STAGE_FROM, FLASH_LIMIT, TINT_DELAY_MS, SHAKE_RANK,
  comboStage, isBigCombo, isFever, flameCount, comboEffects, effectsForMode, comboBreak,
  allowFlash, recordFlash,
} from '../js/combo.js';

const rank = (e) => SHAKE_RANK.indexOf(e.shake);
const rgba = (s) => s.match(/rgba?\((\d+), ?(\d+), ?(\d+)/).slice(1).map(Number);

test('コンボ段階の境界', () => {
  assert.deepEqual(STAGE_FROM, [0, 1, 3, 5, 10, 20]);
  const cases = [[0, 0], [1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [9, 3], [10, 4], [19, 4], [20, 5], [99, 5], [500, 5]];
  for (const [c, s] of cases) assert.equal(comboStage(c), s, `combo ${c}`);
  assert.equal(comboStage(-3), 0);
  assert.equal(comboStage(NaN), 0);
});

test('キリ番とフィーバー', () => {
  assert.deepEqual(BIG_COMBOS, [10, 20, 30, 50, 100]);
  for (const c of [10, 20, 30, 50, 100, 200, 300]) assert.equal(isBigCombo(c), true, String(c));
  for (const c of [0, 1, 5, 9, 11, 15, 19, 21, 40, 99, 101, 150]) assert.equal(isBigCombo(c), false, String(c));
  assert.equal(isFever(19), false);
  assert.equal(isFever(20), true);
  assert.equal(isFever(77), true);
});

test('炎の数(コンボ表示)', () => {
  assert.deepEqual([0, 1, 4, 5, 9, 10, 19, 20, 29, 30, 99].map(flameCount), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});

test('1〜2: 小さなシェイク・紙吹雪のみ', () => {
  for (const c of [1, 2]) {
    const e = comboEffects(c);
    assert.equal(e.stage, 1);
    assert.equal(e.shake, 'small');
    assert.equal(e.flash, null);
    assert.equal(e.slam, false);
    assert.equal(e.cutin, null);
    assert.ok(e.confetti > 0);
    assert.equal(e.big, false);
  }
});

test('3〜4: フラッシュ・スラム・背景の色', () => {
  for (const c of [3, 4]) {
    const e = comboEffects(c);
    assert.equal(e.stage, 2);
    assert.equal(e.shake, 'medium');
    assert.equal(e.flash.kind, 'white');
    assert.equal(e.slam, true);
    assert.equal(e.label, `${c} COMBO!`);
    assert.ok(e.tint);
    assert.equal(e.cutin, null);
  }
  assert.notEqual(comboEffects(3).tint, comboEffects(4).tint);
});

test('5〜9: カットイン(帯)・集中線・色つきフラッシュ・外周の光', () => {
  const colors = new Set();
  for (let c = 5; c <= 9; c++) {
    const e = comboEffects(c);
    assert.equal(e.stage, 3);
    assert.equal(e.cutin, 'band');
    assert.equal(e.speedLines, true);
    assert.equal(e.shake, 'strong');
    assert.equal(e.flash.kind, 'color');
    assert.equal(e.rim, 'glow');
    assert.equal(e.sound, 'chord');
    assert.ok(e.cutText.length > 0);
    assert.ok(e.confetti > comboEffects(3).confetti);
    colors.add(e.flash.color);
  }
  assert.ok(colors.size >= 4, 'コンボで色が変わる');
});

test('10〜19: 全画面カットイン・サンバースト・ズーム・虹フラッシュ', () => {
  for (let c = 10; c <= 19; c++) {
    const e = comboEffects(c);
    assert.equal(e.stage, 4);
    assert.equal(e.cutin, 'full');
    assert.equal(e.sunburst, true);
    assert.equal(e.zoom, true);
    assert.equal(e.afterimage, true);
    assert.equal(e.flash.kind, 'rainbow');
    assert.equal(e.sound, 'boom');
    assert.ok(e.cutText.length > 0);
  }
  assert.equal(comboEffects(10).cutText, '天才!?');
  assert.equal(comboEffects(10).big, true);
  assert.equal(comboEffects(11).big, false);
});

test('20以上: 毎問フィーバー(背景・パーティクル・ビート)', () => {
  for (const c of [20, 21, 25, 30, 50, 100, 150]) {
    const e = comboEffects(c);
    assert.equal(e.stage, 5);
    assert.equal(e.fever, true);
    assert.equal(e.ambient, true);
    assert.equal(e.cutin, 'fever');
    assert.equal(e.rim, 'rainbow');
    assert.equal(e.sound, 'fever');
    assert.ok(e.cutText.length > 0);
  }
  assert.equal(comboEffects(19).fever, false);
  assert.equal(comboEffects(19).ambient, false);
  assert.match(comboEffects(20).cutText, /FEVER/);
  assert.equal(comboEffects(50).cutText, 'えんしゅうりつの かみさま');
  assert.ok(comboEffects(30).cutText.includes('かみ'));
  assert.ok(comboEffects(23).cutText.length > 0);
});

test('キリ番は特大(最大2秒・スキップ可)、通常は自動送り(0.9秒)に収まる', () => {
  for (let c = 0; c <= 250; c++) {
    const e = comboEffects(c);
    if (e.big) {
      assert.ok(e.durationMs > 900 && e.durationMs <= 2000, `big ${c}: ${e.durationMs}`);
      assert.equal(e.skippable, true);
      assert.equal(e.shake, 'huge');
    } else {
      assert.ok(e.durationMs <= 800, `${c}: ${e.durationMs}`);
      assert.equal(e.skippable, false);
    }
  }
  for (const c of BIG_COMBOS) assert.ok(comboEffects(c).confetti > comboEffects(c + 1).confetti, `big ${c} は紙吹雪も特大`);
});

test('段階が上がるほど演出が増える(シェイク・紙吹雪は単調)', () => {
  const reps = [1, 3, 5, 11, 21];
  for (let i = 1; i < reps.length; i++) {
    const a = comboEffects(reps[i - 1]); const b = comboEffects(reps[i]);
    assert.ok(rank(b) >= rank(a), `shake ${reps[i]}`);
    assert.ok(b.confetti >= a.confetti, `confetti ${reps[i]}`);
  }
});

test('赤一色のフラッシュ・色は使わない', () => {
  for (let c = 0; c <= 250; c++) {
    const e = comboEffects(c);
    for (const col of [e.flash?.color, e.tint]) {
      if (!col || col === 'rainbow') continue;
      const [r, g, b] = rgba(col);
      assert.ok(!(r > 200 && g < 110 && b < 110), `red-ish ${col} at combo ${c}`);
    }
  }
});

test('同じコンボは同じ演出(決定的)', () => {
  for (const c of [0, 1, 3, 7, 10, 14, 20, 33]) assert.deepEqual(comboEffects(c), comboEffects(c));
});

test('ひかえめ: シェイク・フラッシュ・ズームなし、文字カットインのみ', () => {
  for (let c = 0; c <= 120; c++) {
    const full = comboEffects(c);
    const e = effectsForMode(full, 'calm');
    assert.equal(e.shake, 'none');
    assert.equal(e.flash, null);
    assert.equal(e.tint, null);
    assert.equal(e.zoom, false);
    assert.equal(e.sunburst, false);
    assert.equal(e.speedLines, false);
    assert.equal(e.rim, null);
    assert.equal(e.ambient, false);
    assert.equal(e.slam, false);
    assert.equal(e.confetti, 0);
    assert.ok(e.durationMs <= 800);
    assert.equal(e.skippable, false);
    if (full.cutin || full.slam) assert.equal(e.cutin, 'text', `combo ${c}`);
    else assert.equal(e.cutin, null);
    if (e.cutin) assert.ok(e.cutText.length > 0);
  }
  const full = comboEffects(7);
  assert.deepEqual(effectsForMode(full, 'flashy'), full);
  assert.equal(comboEffects(7).shake, 'strong', '元のオブジェクトは変えない');
});

test('コンボ切れ(ガラス演出)', () => {
  assert.equal(comboBreak(0, 5), null);
  assert.equal(comboBreak(2, 5), null);
  const b = comboBreak(3, 7);
  assert.equal(b.text, 'コンボ ストップ…');
  assert.equal(b.best, 7);
  assert.ok(b.sub.includes('7'));
  assert.ok(b.sub.includes('つぎは もっと いける'));
  assert.equal(comboBreak(25, 25).best, 25);
  assert.equal(comboBreak(4, 2).best, 4, '最高コンボは今のコンボ以上');
});

test('フラッシュの頻度制限(1秒に2回まで・間隔を空ける)', () => {
  assert.deepEqual(FLASH_LIMIT, { maxPerSec: 2, minGapMs: 420 });
  assert.ok(FLASH_LIMIT.maxPerSec <= 3, '基準(1秒に3回以下)より厳しい');
  assert.ok(TINT_DELAY_MS >= FLASH_LIMIT.minGapMs, '同じ回答の 2 回目のフラッシュは間隔を満たす');
  assert.equal(allowFlash([], 0), true);
  assert.equal(allowFlash([0], 100), false);
  assert.equal(allowFlash([0], 419), false);
  assert.equal(allowFlash([0], 420), true);
  assert.equal(allowFlash([0, 440], 900), false, '1 秒に 2 回まで');
  assert.equal(allowFlash([0, 440], 1001), true);
  assert.deepEqual(recordFlash([0, 440], 1001), [440, 1001]);
  // どんなタイミングで要求しても、どの1秒でも上限以内
  for (const step of [7, 50, 120, 333, 421]) {
    let hist = []; const accepted = [];
    for (let t = 0; t < 20000; t += step) {
      if (allowFlash(hist, t)) { hist = recordFlash(hist, t); accepted.push(t); }
    }
    for (let i = 0; i < accepted.length; i++) {
      const inWin = accepted.filter((x) => x >= accepted[i] && x < accepted[i] + 1000).length;
      assert.ok(inWin <= FLASH_LIMIT.maxPerSec, `step ${step}: ${inWin} flashes in 1s`);
    }
  }
});
