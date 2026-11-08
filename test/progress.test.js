import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASIC_DANS, ADVANCED_DANS, emptyStats } from '../js/logic.js';
import {
  xpForAnswer, xpNeeded, xpForLevel, levelInfo,
  defaultProgress, applyAnswer, addXp, touchDay, dateKey, finishSession,
  isMastered, masteredDans, isCleared, CLEAR_TIME_MS,
  ACHIEVEMENTS, achievementStatus, evaluateAchievements, RARITIES,
} from '../js/progress.js';

const ALL = [...BASIC_DANS, ...ADVANCED_DANS];
const statsWith = (dans, correct, total = correct) => {
  const s = emptyStats();
  for (const n of dans) s.byDan[n] = { correct, total };
  return s;
};
const ids = (r) => r.unlocked.map((a) => a.id);

test('XP: 正解の基本点・コンボ・速さ', () => {
  assert.deepEqual(xpForAnswer({ correct: true, combo: 1, ms: 5000 }), { total: 10, base: 10, comboBonus: 0, speedBonus: 0 });
  assert.equal(xpForAnswer({ correct: true, combo: 5, ms: 1500 }).total, 10 + 4 + 5);
  assert.equal(xpForAnswer({ correct: true, combo: 2, ms: 3000 }).speedBonus, 2);
  assert.equal(xpForAnswer({ correct: true, combo: 50, ms: null }).comboBonus, 10);
  assert.equal(xpForAnswer({ correct: true, combo: 50, ms: null }).speedBonus, 0);
  assert.equal(xpForAnswer({ correct: false, combo: 0, ms: 500 }).total, 0);
});

test('レベル計算', () => {
  assert.equal(xpNeeded(1), 50);
  assert.equal(xpNeeded(2), 75);
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 50);
  assert.equal(xpForLevel(3), 125);
  assert.equal(xpForLevel(5), 350);
  assert.deepEqual(levelInfo(0), { level: 1, into: 0, need: 50, ratio: 0 });
  assert.equal(levelInfo(49).level, 1);
  assert.equal(levelInfo(50).level, 2);
  assert.equal(levelInfo(124).level, 2);
  assert.equal(levelInfo(125).level, 3);
  const li = levelInfo(87);
  assert.deepEqual([li.level, li.into, li.need], [2, 37, 75]);
  assert.ok(Math.abs(li.ratio - 37 / 75) < 1e-9);
  assert.equal(levelInfo(-5).level, 1);
  assert.equal(levelInfo(NaN).level, 1);
});

test('回答の反映(正解・不正解・レベルアップ)', () => {
  const p0 = defaultProgress();
  const r = applyAnswer(p0, { correct: true, combo: 1, ms: 5000 });
  assert.equal(r.progress.totalCorrect, 1);
  assert.equal(r.progress.totalAnswered, 1);
  assert.equal(r.progress.xp, 10);
  assert.equal(r.progress.bestCombo, 1);
  assert.equal(r.levelUp, null);
  assert.equal(p0.xp, 0, '元は変更しない');

  const w = applyAnswer(r.progress, { correct: false, combo: 0, ms: 1000 });
  assert.equal(w.progress.totalCorrect, 1);
  assert.equal(w.progress.totalAnswered, 2);
  assert.equal(w.progress.xp, 10);
  assert.equal(w.progress.bestCombo, 1);

  const near = { ...defaultProgress(), xp: 45 };
  const up = applyAnswer(near, { correct: true, combo: 1, ms: 5000 });
  assert.deepEqual(up.levelUp, { from: 1, to: 2 });

  const best = applyAnswer({ ...defaultProgress(), bestCombo: 4 }, { correct: true, combo: 7, ms: null });
  assert.equal(best.progress.bestCombo, 7);
});

test('XP の加算(ボーナス)でもレベルアップを検出', () => {
  const r = addXp({ ...defaultProgress(), xp: 340 }, 20);
  assert.equal(r.progress.xp, 360);
  assert.deepEqual(r.levelUp, { from: 4, to: 5 });
  assert.equal(addXp(defaultProgress(), 3).levelUp, null);
});

test('連続プレイ日数(日付は引数)', () => {
  assert.equal(dateKey(new Date(2026, 10, 8, 12)), '2026-11-08');
  assert.equal(dateKey(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
  let p = touchDay(defaultProgress(), '2026-11-08', 12);
  assert.deepEqual(p.streak, { last: '2026-11-08', count: 1, best: 1 });
  p = touchDay(p, '2026-11-08', 15);
  assert.equal(p.streak.count, 1);
  p = touchDay(p, '2026-11-09', 12);
  assert.deepEqual(p.streak, { last: '2026-11-09', count: 2, best: 2 });
  p = touchDay(p, '2026-11-10', 12);
  assert.equal(p.streak.count, 3);
  p = touchDay(p, '2026-11-13', 12); // 3日あいた
  assert.deepEqual(p.streak, { last: '2026-11-13', count: 1, best: 3 });
  assert.equal(p.flags.comeback, false);
  assert.equal(p.flags.early, false);
  // 月またぎ
  const m = touchDay(touchDay(defaultProgress(), '2026-10-31', 12), '2026-11-01', 12);
  assert.equal(m.streak.count, 2);
  // 7日以上あいたら「おかえり」
  const c = touchDay(touchDay(defaultProgress(), '2026-11-01', 12), '2026-11-08', 12);
  assert.equal(c.flags.comeback, true);
  // 朝のプレイ
  assert.equal(touchDay(defaultProgress(), '2026-11-08', 5).flags.early, true);
  assert.equal(touchDay(defaultProgress(), '2026-11-08', 6).flags.early, true);
  assert.equal(touchDay(defaultProgress(), '2026-11-08', 7).flags.early, false);
});

test('セッション終了の反映(モード別プレイ数・ぜんもん正解)', () => {
  let p = finishSession(defaultProgress(), { mode: 'choice', total: 10, correct: 10 });
  assert.equal(p.modePlays.choice, 1);
  assert.equal(p.perfect.choice, true);
  p = finishSession(p, { mode: 'twotap', total: 10, correct: 9 });
  assert.equal(p.modePlays.twotap, 1);
  assert.equal(p.perfect.twotap, false);
  p = finishSession(p, { mode: 'reverse', total: 10, correct: 10 });
  assert.equal(p.perfect.reverse, true);
  p = finishSession(p, { mode: 'time', total: 9, correct: 9 });
  assert.equal(p.modePlays.time, 1);
  p = finishSession(p, { mode: 'flash', total: 10, correct: 10 });
  assert.equal(p.modePlays.flash, 1);
  assert.equal(p.perfect.flash, undefined);
  assert.equal(finishSession(defaultProgress(), { mode: 'choice', total: 0, correct: 0 }).perfect.choice, false);
});

test('マスター判定とクリア判定', () => {
  assert.equal(isMastered({ correct: 5, total: 5 }), true);
  assert.equal(isMastered({ correct: 5, total: 7 }), false);
  assert.equal(isMastered({ correct: 4, total: 4 }), false);
  assert.equal(isMastered({ correct: 8, total: 10 }), true);
  assert.equal(isMastered(undefined), false);
  assert.deepEqual(masteredDans(statsWith([3, 81], 5)), [3, 81]);
  assert.equal(masteredDans(statsWith(ALL, 5)).length, 19);
  assert.equal(CLEAR_TIME_MS, 40000);
  assert.equal(isCleared(statsWith(ALL, 5), { 'time-attack': 39999 }), true);
  assert.equal(isCleared(statsWith(ALL, 5), { 'time-attack': 40000 }), true);
  assert.equal(isCleared(statsWith(ALL, 5), { 'time-attack': 40001 }), false);
  assert.equal(isCleared(statsWith(ALL, 5), {}), false);
  assert.equal(isCleared(statsWith(BASIC_DANS, 5), { 'time-attack': 20000 }), false);
});

test('実績の定義', () => {
  assert.ok(ACHIEVEMENTS.length >= 30 && ACHIEVEMENTS.length <= 40, String(ACHIEVEMENTS.length));
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) {
    assert.ok(RARITIES.includes(a.rarity), a.id);
    assert.ok(a.icon && a.name && a.desc, a.id);
    assert.equal(typeof a.hint, 'string', a.id);
  }
  for (const r of RARITIES) assert.ok(ACHIEVEMENTS.some((a) => a.rarity === r), r);
  assert.ok(ACHIEVEMENTS.filter((a) => a.hidden).length >= 3);
  assert.ok(ACHIEVEMENTS.find((a) => a.id === 'master-all').rarity === 'rainbow');
});

test('実績の進捗表示', () => {
  const a = ACHIEVEMENTS.find((x) => x.id === 'total-50');
  const st = achievementStatus(a, { ...defaultProgress(), totalCorrect: 23 }, emptyStats(), {});
  assert.deepEqual(st, { cur: 23, max: 50, done: false });
  const st2 = achievementStatus(a, { ...defaultProgress(), totalCorrect: 80 }, emptyStats(), {});
  assert.deepEqual(st2, { cur: 50, max: 50, done: true });
});

test('実績: 何もしなければ解除なし、1問正解で「はじめの いっぽ」', () => {
  const none = evaluateAchievements(defaultProgress(), emptyStats(), {}, 1000);
  assert.deepEqual(ids(none), []);
  const r = evaluateAchievements({ ...defaultProgress(), totalCorrect: 1, totalAnswered: 1 }, emptyStats(), {}, 1000);
  assert.deepEqual(ids(r), ['first-correct']);
  assert.equal(r.progress.unlocked['first-correct'], 1000);
  assert.equal(r.progress.xp, 20, 'ブロンズのボーナス');
  const again = evaluateAchievements(r.progress, emptyStats(), {}, 2000);
  assert.deepEqual(ids(again), []);
  assert.equal(again.progress.xp, 20);
});

test('実績: ボーナス XP でレベルが上がり、レベル実績も同時に解除', () => {
  const p = { ...defaultProgress(), totalCorrect: 1, xp: xpForLevel(5) - 10 };
  const r = evaluateAchievements(p, emptyStats(), {}, 5);
  assert.ok(ids(r).includes('first-correct'));
  assert.ok(ids(r).includes('lv-5'));
});

test('実績: コンボ・累計・タイム・連続日数・モード', () => {
  const p = { ...defaultProgress(), bestCombo: 12, totalCorrect: 120, streak: { last: 'x', count: 1, best: 3 },
    modePlays: { flash: 1, choice: 1, twotap: 0, reverse: 2, time: 1 }, perfect: { choice: true, twotap: false, reverse: false } };
  const r = evaluateAchievements(p, emptyStats(), { 'time-attack': 35000 }, 1);
  const got = ids(r);
  for (const id of ['combo-5', 'combo-10', 'total-50', 'total-100', 'time-60', 'time-40', 'streak-3',
    'first-flash', 'first-choice', 'first-reverse', 'first-time', 'perfect-choice', 'first-correct']) assert.ok(got.includes(id), id);
  for (const id of ['combo-20', 'total-300', 'time-30', 'streak-7', 'first-twotap', 'perfect-twotap']) assert.ok(!got.includes(id), id);
});

test('実績: タイムの段階', () => {
  assert.ok(ids(evaluateAchievements(defaultProgress(), emptyStats(), { 'time-attack': 59999 }, 1)).includes('time-60'));
  assert.ok(!ids(evaluateAchievements(defaultProgress(), emptyStats(), { 'time-attack': 61000 }, 1)).includes('time-60'));
  const fast = ids(evaluateAchievements(defaultProgress(), emptyStats(), { 'time-attack': 14999 }, 1));
  for (const id of ['time-60', 'time-40', 'time-30', 'time-20', 'time-15']) assert.ok(fast.includes(id), id);
});

test('実績: 隠し実績(314・朝・おかえり)', () => {
  const r = evaluateAchievements({ ...defaultProgress(), totalCorrect: 314, flags: { early: true, comeback: true } }, emptyStats(), {}, 1);
  for (const id of ['pi-314', 'early-bird', 'comeback']) assert.ok(ids(r).includes(id), id);
  assert.ok(!ids(evaluateAchievements({ ...defaultProgress(), totalCorrect: 313 }, emptyStats(), {}, 1)).includes('pi-314'));
});

test('実績: 段マスターとクリア', () => {
  const basicOnly = evaluateAchievements(defaultProgress(), statsWith(BASIC_DANS, 5), {}, 1);
  for (const id of ['master-5', 'master-basic']) assert.ok(ids(basicOnly).includes(id), id);
  assert.ok(!ids(basicOnly).includes('master-adv'));
  assert.equal(basicOnly.justCleared, false);

  const slow = evaluateAchievements(defaultProgress(), statsWith(ALL, 5), { 'time-attack': 41000 }, 1);
  assert.ok(ids(slow).includes('master-adv'));
  assert.ok(!ids(slow).includes('master-all'));
  assert.equal(slow.progress.cleared, null);

  const clear = evaluateAchievements(defaultProgress(), statsWith(ALL, 5), { 'time-attack': 39000 }, 777);
  assert.ok(ids(clear).includes('master-all'));
  assert.equal(clear.justCleared, true);
  assert.equal(clear.progress.cleared, 777);
  const after = evaluateAchievements(clear.progress, statsWith(ALL, 5), { 'time-attack': 39000 }, 888);
  assert.equal(after.justCleared, false);
  assert.equal(after.progress.cleared, 777);

  const adv = evaluateAchievements(defaultProgress(), statsWith(ADVANCED_DANS, 1), {}, 1);
  assert.ok(ids(adv).includes('adv-first'));
});

test('実績: 全部とるとコンプリート(クリア後のやり込み)', () => {
  const p = {
    ...defaultProgress(), totalCorrect: 5000, bestCombo: 40, xp: xpForLevel(25),
    streak: { last: 'x', count: 9, best: 9 }, flags: { early: true, comeback: true },
    modePlays: { flash: 3, choice: 3, twotap: 3, reverse: 3, time: 3 },
    perfect: { choice: true, twotap: true, reverse: true },
  };
  const r = evaluateAchievements(p, statsWith(ALL, 9), { 'time-attack': 12000 }, 1);
  assert.ok(ids(r).includes('complete'));
  assert.equal(Object.keys(r.progress.unlocked).length, ACHIEVEMENTS.length);
  const c = ACHIEVEMENTS.find((a) => a.id === 'complete');
  assert.equal(achievementStatus(c, defaultProgress(), emptyStats(), {}).max, ACHIEVEMENTS.length - 1);
});
