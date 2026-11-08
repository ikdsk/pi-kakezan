import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASIC_DANS, ADVANCED_DANS, dansForRange,
  productHundredths, formatHundredths, answerText, questionText,
  normalizeInput, isCorrectInput,
  makeChoices, makeReverseQuestion, makeReverseChoices,
  buildQueue, buildWeakQueue,
  emptyStats, recordAnswer, accuracy, weakDans, bestTime, updateBestTime,
} from '../js/logic.js';

// 決定的な乱数(線形合同法)
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ALL = [...BASIC_DANS, ...ADVANCED_DANS];

test('段の定義', () => {
  assert.deepEqual(BASIC_DANS, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(ADVANCED_DANS, [12, 15, 16, 18, 24, 25, 36, 49, 64, 81]);
  assert.deepEqual(dansForRange('basic'), BASIC_DANS);
  assert.deepEqual(dansForRange('advanced'), ADVANCED_DANS);
  assert.deepEqual(dansForRange('both'), ALL);
  assert.deepEqual(dansForRange('???'), BASIC_DANS);
});

test('全段の答えが正確(整数演算)', () => {
  const expected = {
    1: '3.14', 2: '6.28', 3: '9.42', 4: '12.56', 5: '15.7', 6: '18.84',
    7: '21.98', 8: '25.12', 9: '28.26',
    12: '37.68', 15: '47.1', 16: '50.24', 18: '56.52', 24: '75.36',
    25: '78.5', 36: '113.04', 49: '153.86', 64: '200.96', 81: '254.34',
  };
  for (const n of ALL) assert.equal(answerText(n), expected[n], `3.14×${n}`);
  assert.equal(answerText(10), '31.4');
  assert.equal(answerText(50), '157');
  assert.equal(answerText(100), '314');
  assert.equal(productHundredths(7), 2198);
});

test('整形: 末尾の0を省略', () => {
  assert.equal(formatHundredths(3140), '31.4');
  assert.equal(formatHundredths(15700), '157');
  assert.equal(formatHundredths(5), '0.05');
  assert.equal(formatHundredths(250), '2.5');
});

test('問題文', () => {
  assert.equal(questionText(7), '3.14 × 7');
});

test('入力の同値判定', () => {
  assert.equal(isCorrectInput(10, '31.40'), true);
  assert.equal(isCorrectInput(10, '31.4'), true);
  assert.equal(isCorrectInput(10, ' 31.4 '), true);
  assert.equal(isCorrectInput(10, '031.4'), true);
  assert.equal(isCorrectInput(50, '157'), true);
  assert.equal(isCorrectInput(50, '157.00'), true);
  assert.equal(isCorrectInput(50, '157.'), true);
  assert.equal(isCorrectInput(7, '21.98'), true);
  assert.equal(isCorrectInput(7, '21.9'), false);
  assert.equal(isCorrectInput(7, '2198'), false);
  assert.equal(isCorrectInput(25, '78.50'), true);
  assert.equal(isCorrectInput(25, '78.501'), false);
});

test('不正な入力は例外なしで不正解', () => {
  for (const bad of ['.', '', '  ', '..', '1.2.3', 'abc', '-3', null, undefined, 12]) {
    assert.doesNotThrow(() => isCorrectInput(7, bad));
    assert.equal(isCorrectInput(7, bad), false, String(bad));
  }
  assert.equal(normalizeInput('.'), null);
  assert.equal(normalizeInput(''), null);
  assert.equal(normalizeInput('31.40'), '31.4');
  assert.equal(normalizeInput('.5'), '0.5');
  assert.equal(normalizeInput('0'), '0');
  assert.equal(normalizeInput('0.0'), '0');
});

test('4択: 4つ・重複なし・正解を含む(全段、複数の乱数)', () => {
  for (const n of ALL) {
    for (let seed = 1; seed <= 30; seed++) {
      const choices = makeChoices(n, seeded(seed), ALL);
      assert.equal(choices.length, 4);
      assert.equal(new Set(choices).size, 4, `${n}: ${choices}`);
      assert.ok(choices.includes(answerText(n)), `${n}: ${choices}`);
      for (const c of choices) assert.match(c, /^\d+(\.\d+)?$/);
    }
  }
});

test('4択: 紛らわしい選択肢(隣の段・桁ずれ)を含みうる', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    for (const c of makeChoices(7, seeded(seed), BASIC_DANS)) seen.add(c);
  }
  assert.ok(seen.has('18.84') || seen.has('25.12'), '隣の段');
  assert.ok(seen.has('219.8') || seen.has('2.198'), '桁ずれ');
});

test('4択: 正解の位置がかたよらない', () => {
  const positions = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    positions.add(makeChoices(7, seeded(seed), BASIC_DANS).indexOf('21.98'));
  }
  assert.ok(positions.size >= 3);
});

test('ぎゃくびき: 問題生成', () => {
  const q = makeReverseQuestion(7, seeded(3), ALL);
  assert.equal(q.n, 7);
  assert.equal(q.productText, '21.98');
  assert.equal(q.choices.length, 4);
  assert.equal(new Set(q.choices).size, 4);
  assert.ok(q.choices.includes(7));
  for (const c of q.choices) assert.ok(Number.isInteger(c) && c > 0);
  for (const n of ALL) {
    for (let seed = 1; seed <= 20; seed++) {
      const choices = makeReverseChoices(n, seeded(seed), ALL);
      assert.equal(choices.length, 4);
      assert.equal(new Set(choices).size, 4);
      assert.ok(choices.includes(n));
    }
  }
});

test('出題キュー: 長さ・範囲・注入乱数で再現', () => {
  const a = buildQueue(BASIC_DANS, 10, seeded(5));
  const b = buildQueue(BASIC_DANS, 10, seeded(5));
  assert.deepEqual(a, b);
  assert.equal(a.length, 10);
  for (const n of a) assert.ok(BASIC_DANS.includes(n));
  // 9問 = 全段が1回ずつ
  const nine = buildQueue(BASIC_DANS, 9, seeded(2));
  assert.deepEqual([...nine].sort((x, y) => x - y), BASIC_DANS);
  // 連続して同じ段が出ない
  for (let seed = 1; seed <= 50; seed++) {
    const q = buildQueue(BASIC_DANS, 10, seeded(seed));
    for (let i = 1; i < q.length; i++) assert.notEqual(q[i], q[i - 1]);
  }
  assert.deepEqual(buildQueue([], 10, seeded(1)), []);
  assert.deepEqual(buildQueue([7], 3, seeded(1)), [7, 7, 7]);
});

test('記録の集計', () => {
  let s = emptyStats();
  s = recordAnswer(s, 7, true, 100);
  s = recordAnswer(s, 7, false, 200);
  s = recordAnswer(s, 8, false, 300);
  assert.deepEqual(s.byDan[7], { correct: 1, total: 2 });
  assert.deepEqual(s.byDan[8], { correct: 0, total: 1 });
  assert.equal(accuracy(s, 7), 0.5);
  assert.equal(accuracy(s, 9), null);
  assert.deepEqual(s.recentMistakes.map((m) => m.n), [8, 7]);
  // 元のオブジェクトは変更しない
  const s2 = recordAnswer(s, 9, true, 400);
  assert.equal(s.byDan[9], undefined);
  assert.equal(s2.byDan[9].total, 1);
});

test('直近の間違いは上限つき', () => {
  let s = emptyStats();
  for (let i = 0; i < 50; i++) s = recordAnswer(s, 7, false, i);
  assert.ok(s.recentMistakes.length <= 20);
});

test('にがて抽出', () => {
  let s = emptyStats();
  for (let i = 0; i < 4; i++) s = recordAnswer(s, 7, i === 0, i); // 25%
  for (let i = 0; i < 4; i++) s = recordAnswer(s, 8, i < 2, i);   // 50%
  for (let i = 0; i < 4; i++) s = recordAnswer(s, 9, true, i);    // 100%
  assert.deepEqual(weakDans(s, BASIC_DANS), [7, 8]);
  assert.deepEqual(weakDans(s, [8, 9]), [8]);
  assert.deepEqual(weakDans(emptyStats(), BASIC_DANS), []);
});

test('にがて優先キュー', () => {
  let s = emptyStats();
  for (let i = 0; i < 4; i++) s = recordAnswer(s, 7, false, i);
  const q = buildWeakQueue(s, BASIC_DANS, 10, seeded(1));
  assert.equal(q.length, 10);
  assert.ok(q.every((n) => n === 7));
  // にがてがなければ空
  assert.deepEqual(buildWeakQueue(emptyStats(), BASIC_DANS, 10, seeded(1)), []);
});

test('ベストタイム', () => {
  assert.equal(bestTime({}), null);
  let t = updateBestTime({}, 'time-attack', 52000);
  assert.deepEqual(t.result, { isBest: true, previous: null });
  t = updateBestTime(t.records, 'time-attack', 60000);
  assert.equal(t.result.isBest, false);
  assert.equal(bestTime(t.records, 'time-attack'), 52000);
  t = updateBestTime(t.records, 'time-attack', 40000);
  assert.equal(t.result.isBest, true);
  assert.equal(t.result.previous, 52000);
  assert.equal(bestTime(t.records, 'time-attack'), 40000);
});
