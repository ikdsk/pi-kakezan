import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, KEY, LEGACY_KEY } from '../js/storage.js';

function fakeLocalStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}

test('初期状態', () => {
  const d = createStorage(fakeLocalStorage()).load();
  assert.equal(d.version, 2);
  assert.equal(d.settings.range, 'basic');
  assert.equal(d.settings.sound, true);
  assert.equal(d.settings.fx, 'flashy', 'えんしゅつの既定は はで');
  assert.deepEqual(d.stats.byDan, {});
  assert.deepEqual(d.stats.recentMistakes, []);
  assert.deepEqual(d.records, {});
  assert.equal(d.progress.xp, 0);
  assert.deepEqual(d.progress.unlocked, {});
  assert.equal(d.progress.cleared, null);
});

test('保存して読み戻せる', () => {
  const ls = fakeLocalStorage();
  const st = createStorage(ls);
  const d = st.load();
  d.settings.range = 'both';
  d.settings.sound = false;
  d.settings.fx = 'calm';
  d.stats.byDan[7] = { correct: 2, total: 3 };
  d.records['time-attack'] = 41000;
  d.progress.xp = 123;
  d.progress.totalCorrect = 9;
  d.progress.unlocked['first-correct'] = 1700000000000;
  d.progress.streak = { last: '2026-11-08', count: 2, best: 4 };
  d.progress.flags.early = true;
  d.progress.cleared = 1700000000001;
  st.save(d);
  assert.ok(ls._m.has(KEY));
  const d2 = createStorage(ls).load();
  assert.equal(d2.settings.range, 'both');
  assert.equal(d2.settings.sound, false);
  assert.equal(d2.settings.fx, 'calm');
  assert.deepEqual(d2.stats.byDan[7], { correct: 2, total: 3 });
  assert.equal(d2.records['time-attack'], 41000);
  assert.equal(d2.progress.xp, 123);
  assert.equal(d2.progress.unlocked['first-correct'], 1700000000000);
  assert.deepEqual(d2.progress.streak, { last: '2026-11-08', count: 2, best: 4 });
  assert.equal(d2.progress.flags.early, true);
  assert.equal(d2.progress.cleared, 1700000000001);
});

test('v1 のデータを引き継ぐ(成績・ベストタイム・範囲)', () => {
  const v1 = JSON.stringify({
    settings: { range: 'both' },
    stats: { byDan: { 7: { correct: 8, total: 10 }, 3: { correct: 2, total: 2 } }, recentMistakes: [{ n: 7, at: 5 }] },
    records: { 'time-attack': 52000 },
  });
  const ls = fakeLocalStorage({ [LEGACY_KEY]: v1 });
  const d = createStorage(ls).load();
  assert.equal(d.version, 2);
  assert.equal(d.settings.range, 'both');
  assert.equal(d.settings.sound, true);
  assert.deepEqual(d.stats.byDan[7], { correct: 8, total: 10 });
  assert.deepEqual(d.stats.recentMistakes, [{ n: 7, at: 5 }]);
  assert.equal(d.records['time-attack'], 52000);
  assert.equal(d.progress.totalCorrect, 10);
  assert.equal(d.progress.totalAnswered, 12);
  assert.equal(d.progress.xp, 100, '過去の正解ぶんの XP');
  // v1 のキーは消さない(戻しても壊れない)
  assert.equal(ls._m.get(LEGACY_KEY), v1);
});

test('v2 があれば v1 は読まない', () => {
  const ls = fakeLocalStorage({ [LEGACY_KEY]: JSON.stringify({ stats: { byDan: { 7: { correct: 9, total: 9 } } } }) });
  const st = createStorage(ls);
  const d = st.load();
  d.stats.byDan = {};
  d.progress.xp = 5;
  st.save(d);
  const d2 = createStorage(ls).load();
  assert.deepEqual(d2.stats.byDan, {});
  assert.equal(d2.progress.xp, 5);
});

test('壊れた JSON でも初期値に戻る(v2・v1とも)', () => {
  for (const bad of ['{oops', 'null', '[]', '"x"', '123']) {
    for (const key of [KEY, LEGACY_KEY]) {
      const st = createStorage(fakeLocalStorage({ [key]: bad }));
      assert.doesNotThrow(() => st.load());
      const d = st.load();
      assert.equal(d.settings.range, 'basic');
      assert.equal(d.progress.xp, 0);
    }
  }
});

test('形の崩れた値は取り除く', () => {
  const bad = JSON.stringify({
    version: 2,
    settings: { range: 'nope', sound: 'yes', fx: 'extreme' },
    stats: { byDan: { 7: { correct: 'a', total: 3 }, 8: { correct: 5, total: 2 }, 9: { correct: 1, total: 2 } }, recentMistakes: 'x' },
    records: { 'time-attack': -5, foo: 'bar' },
    progress: { xp: -3, totalCorrect: 'a', bestCombo: 2.5, modePlays: { choice: -1, time: 3 }, unlocked: { 'first-correct': 'x', 'combo-5': 123 },
      streak: { last: 5, count: 'x', best: 2 }, flags: { early: 'yes' }, cleared: 'later' },
  });
  const d = createStorage(fakeLocalStorage({ [KEY]: bad })).load();
  assert.equal(d.settings.range, 'basic');
  assert.equal(d.settings.sound, true);
  assert.equal(d.settings.fx, 'flashy');
  assert.equal(d.stats.byDan[7], undefined);
  assert.equal(d.stats.byDan[8], undefined);
  assert.deepEqual(d.stats.byDan[9], { correct: 1, total: 2 });
  assert.deepEqual(d.stats.recentMistakes, []);
  assert.deepEqual(d.records, {});
  assert.equal(d.progress.xp, 0);
  assert.equal(d.progress.totalCorrect, 0);
  assert.equal(d.progress.bestCombo, 0);
  assert.equal(d.progress.modePlays.choice, 0);
  assert.equal(d.progress.modePlays.time, 3);
  assert.deepEqual(d.progress.unlocked, { 'combo-5': 123 });
  assert.equal(d.progress.streak.last, null);
  assert.equal(d.progress.streak.count, 0);
  assert.equal(d.progress.flags.early, false);
  assert.equal(d.progress.cleared, null);
});

test('localStorage が使えなくても落ちない', () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('denied'); },
  };
  const st = createStorage(broken);
  assert.doesNotThrow(() => st.load());
  assert.doesNotThrow(() => st.save(st.load()));
  assert.doesNotThrow(() => st.reset());
  const none = createStorage(null);
  assert.equal(none.load().settings.range, 'basic');
  assert.doesNotThrow(() => none.save(none.load()));
});

test('リセット: 成績・記録・レベル・実績を消し、設定は残す', () => {
  const ls = fakeLocalStorage();
  const st = createStorage(ls);
  const d = st.load();
  d.settings.range = 'advanced';
  d.settings.sound = false;
  d.settings.fx = 'calm';
  d.stats.byDan[7] = { correct: 1, total: 1 };
  d.progress.xp = 500;
  d.progress.unlocked['first-correct'] = 1;
  st.save(d);
  const after = st.reset();
  assert.deepEqual(after.stats.byDan, {});
  assert.equal(after.progress.xp, 0);
  const d2 = st.load();
  assert.deepEqual(d2.stats.byDan, {});
  assert.equal(d2.progress.xp, 0);
  assert.deepEqual(d2.progress.unlocked, {});
  assert.equal(d2.settings.range, 'advanced');
  assert.equal(d2.settings.sound, false);
  assert.equal(d2.settings.fx, 'calm');
});

test('リセットすると古い v1 データも復活しない', () => {
  const ls = fakeLocalStorage({ [LEGACY_KEY]: JSON.stringify({ stats: { byDan: { 7: { correct: 9, total: 9 } } } }) });
  const st = createStorage(ls);
  st.load();
  st.reset();
  assert.deepEqual(createStorage(ls).load().stats.byDan, {});
});
