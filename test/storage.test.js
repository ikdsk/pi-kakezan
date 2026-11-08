import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, KEY } from '../js/storage.js';

function fakeLocalStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

test('初期状態', () => {
  const st = createStorage(fakeLocalStorage());
  const d = st.load();
  assert.equal(d.settings.range, 'basic');
  assert.deepEqual(d.stats.byDan, {});
  assert.deepEqual(d.stats.recentMistakes, []);
  assert.deepEqual(d.records, {});
});

test('保存して読み戻せる', () => {
  const ls = fakeLocalStorage();
  const st = createStorage(ls);
  const d = st.load();
  d.settings.range = 'both';
  d.stats.byDan[7] = { correct: 2, total: 3 };
  d.records['time-attack'] = 41000;
  st.save(d);
  const d2 = createStorage(ls).load();
  assert.equal(d2.settings.range, 'both');
  assert.deepEqual(d2.stats.byDan[7], { correct: 2, total: 3 });
  assert.equal(d2.records['time-attack'], 41000);
});

test('壊れた JSON でも初期値に戻る', () => {
  for (const bad of ['{oops', 'null', '[]', '"x"', '123']) {
    const st = createStorage(fakeLocalStorage({ [KEY]: bad }));
    assert.doesNotThrow(() => st.load());
    assert.equal(st.load().settings.range, 'basic');
  }
});

test('形の崩れた値は取り除く', () => {
  const bad = JSON.stringify({
    settings: { range: 'nope' },
    stats: { byDan: { 7: { correct: 'a', total: 3 }, 8: { correct: 5, total: 2 }, 9: { correct: 1, total: 2 } }, recentMistakes: 'x' },
    records: { 'time-attack': -5, foo: 'bar' },
  });
  const d = createStorage(fakeLocalStorage({ [KEY]: bad })).load();
  assert.equal(d.settings.range, 'basic');
  assert.equal(d.stats.byDan[7], undefined);
  assert.equal(d.stats.byDan[8], undefined);
  assert.deepEqual(d.stats.byDan[9], { correct: 1, total: 2 });
  assert.deepEqual(d.stats.recentMistakes, []);
  assert.deepEqual(d.records, {});
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

test('リセット', () => {
  const ls = fakeLocalStorage();
  const st = createStorage(ls);
  const d = st.load();
  d.settings.range = 'advanced';
  d.stats.byDan[7] = { correct: 1, total: 1 };
  st.save(d);
  const after = st.reset();
  assert.deepEqual(after.stats.byDan, {});
  assert.deepEqual(st.load().stats.byDan, {});
  // 設定(出題範囲)は残す
  assert.equal(st.load().settings.range, 'advanced');
});
