// XP・レベル・コンボ・実績・連続日数・クリア判定。DOM にも localStorage にも触れない純粋関数。
// 日付・現在時刻は引数で受け取る(テストしやすくするため)。
import { BASIC_DANS, ADVANCED_DANS } from './logic.js';

const ALL_DANS = [...BASIC_DANS, ...ADVANCED_DANS];

export const RARITIES = ['bronze', 'silver', 'gold', 'rainbow'];
export const RARITY_LABELS = { bronze: 'ブロンズ', silver: 'シルバー', gold: 'ゴールド', rainbow: 'レインボー' };
export const RARITY_BONUS_XP = { bronze: 20, silver: 50, gold: 100, rainbow: 300 };

/** マスター条件: 累計正解 5 回以上 かつ 正答率 80% 以上。 */
export const MASTER_MIN_CORRECT = 5;
export const MASTER_MIN_ACCURACY = 0.8;
/** クリア条件の「タイムアタック」: 基本9問を 40 秒以内(ms)。 */
export const CLEAR_TIME_MS = 40000;
export const TIME_ATTACK_KEY = 'time-attack';

// ---------- XP とレベル ----------

export function xpForAnswer({ correct, combo, ms }) {
  if (!correct) return { total: 0, base: 0, comboBonus: 0, speedBonus: 0 };
  const base = 10;
  const comboBonus = Math.min(Math.max(combo - 1, 0), 10);
  const speedBonus = Number.isFinite(ms) ? (ms <= 2000 ? 5 : ms <= 4000 ? 2 : 0) : 0;
  return { total: base + comboBonus + speedBonus, base, comboBonus, speedBonus };
}

/** level から level+1 に上がるのに必要な XP。 */
export function xpNeeded(level) {
  return 50 + 25 * (level - 1);
}

/** そのレベルに到達する累計 XP。 */
export function xpForLevel(level) {
  const m = level - 1;
  return 50 * m + (25 * m * (m - 1)) / 2;
}

export function levelInfo(xp) {
  const x = Number.isFinite(xp) && xp > 0 ? xp : 0;
  let level = 1;
  while (xpForLevel(level + 1) <= x) level++;
  const into = x - xpForLevel(level);
  const need = xpNeeded(level);
  return { level, into, need, ratio: into / need };
}

// ---------- コンボ ----------

const TIERS = [
  { at: 20, tier: 4, text: 'でんせつ!!!' },
  { at: 10, tier: 3, text: '天才!?' },
  { at: 5, tier: 2, text: 'すごすぎ!' },
  { at: 3, tier: 1, text: 'コンボ!' },
];

/** 連続正解数に応じた段階(0〜4)と煽り文言。 */
export function comboTier(combo) {
  const t = TIERS.find((x) => combo >= x.at);
  return t ? { tier: t.tier, text: t.text } : { tier: 0, text: '' };
}

/** ちょうど段階に届いた瞬間だけその段階、それ以外は 0。 */
export function comboMilestone(combo) {
  const t = TIERS.find((x) => x.at === combo);
  return t ? t.tier : 0;
}

// ---------- 進捗データ ----------

export function defaultProgress() {
  return {
    xp: 0,
    totalCorrect: 0,
    totalAnswered: 0,
    bestCombo: 0,
    modePlays: { flash: 0, choice: 0, twotap: 0, reverse: 0, time: 0 },
    perfect: { choice: false, twotap: false, reverse: false },
    unlocked: {},
    streak: { last: null, count: 0, best: 0 },
    flags: { early: false, comeback: false },
    cleared: null,
  };
}

function levelUpBetween(beforeXp, afterXp) {
  const from = levelInfo(beforeXp).level;
  const to = levelInfo(afterXp).level;
  return to > from ? { from, to } : null;
}

export function addXp(progress, amount) {
  const xp = progress.xp + amount;
  return { progress: { ...progress, xp }, levelUp: levelUpBetween(progress.xp, xp) };
}

/** 1問の結果を反映。combo はこの回答のあとの連続正解数(不正解なら 0)。 */
export function applyAnswer(progress, { correct, combo, ms }) {
  const gained = xpForAnswer({ correct, combo, ms });
  const xp = progress.xp + gained.total;
  return {
    progress: {
      ...progress,
      xp,
      totalCorrect: progress.totalCorrect + (correct ? 1 : 0),
      totalAnswered: progress.totalAnswered + 1,
      bestCombo: Math.max(progress.bestCombo, combo),
    },
    xp: gained,
    levelUp: levelUpBetween(progress.xp, xp),
  };
}

// ---------- 日付(連続プレイ) ----------

export function dateKey(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** その日のプレイを記録(連続日数・朝のプレイ・久しぶりのプレイ)。 */
export function touchDay(progress, today, hour) {
  const flags = { ...progress.flags };
  if (hour >= 4 && hour < 7) flags.early = true;
  const { last, count, best } = progress.streak;
  if (last === today) return { ...progress, flags };
  let next = 1;
  if (last) {
    const gap = dayNumber(today) - dayNumber(last);
    if (gap === 1) next = count + 1;
    if (gap >= 7) flags.comeback = true;
  }
  return { ...progress, flags, streak: { last: today, count: next, best: Math.max(best, next) } };
}

export function finishSession(progress, { mode, total, correct }) {
  const perfect = { ...progress.perfect };
  if (mode in perfect && total > 0 && correct === total) perfect[mode] = true;
  return {
    ...progress,
    perfect,
    modePlays: { ...progress.modePlays, [mode]: (progress.modePlays[mode] ?? 0) + 1 },
  };
}

// ---------- マスターとクリア ----------

export function isMastered(d) {
  return !!d && d.correct >= MASTER_MIN_CORRECT && d.total > 0 && d.correct / d.total >= MASTER_MIN_ACCURACY;
}

export function masteredDans(stats) {
  return ALL_DANS.filter((n) => isMastered(stats.byDan[n]));
}

function bestMs(records) {
  const v = records?.[TIME_ATTACK_KEY];
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function isTimeCleared(records) {
  const b = bestMs(records);
  return b !== null && b <= CLEAR_TIME_MS;
}

/** クリア = 全19段マスター かつ タイムアタック 40 秒以内。 */
export function isCleared(stats, records) {
  return masteredDans(stats).length === ALL_DANS.length && isTimeCleared(records);
}

// ---------- 実績 ----------

const count = (cur, max) => [Math.min(cur, max), max];
const flag = (v) => [v ? 1 : 0, 1];
const ach = (id, icon, rarity, name, desc, progressFn, extra = {}) =>
  ({ id, icon, rarity, name, desc, hint: extra.hint ?? desc, hidden: !!extra.hidden, progress: progressFn });

const mastered = (c, dans) => dans.filter((n) => isMastered(c.stats.byDan[n])).length;
const timeUnder = (sec) => (c) => flag(bestMs(c.records) !== null && bestMs(c.records) <= sec * 1000);

export const ACHIEVEMENTS = [
  // はじめて
  ach('first-correct', '🌱', 'bronze', 'はじめの いっぽ', 'はじめて せいかいする', (c) => count(c.progress.totalCorrect, 1)),
  ach('first-flash', '🃏', 'bronze', 'カードめくり', 'フラッシュカードを あそぶ', (c) => count(c.progress.modePlays.flash, 1)),
  ach('first-choice', '🎯', 'bronze', '4たくデビュー', '4たくクイズを あそぶ', (c) => count(c.progress.modePlays.choice, 1)),
  ach('first-twotap', '✌️', 'bronze', '2タップデビュー', '2タップ チャレンジを あそぶ', (c) => count(c.progress.modePlays.twotap, 1)),
  ach('first-reverse', '🔄', 'bronze', 'ぎゃくびきデビュー', 'ぎゃくびきを あそぶ', (c) => count(c.progress.modePlays.reverse, 1)),
  ach('first-time', '⏱️', 'bronze', 'よーい ドン!', 'タイムアタックを あそぶ', (c) => count(c.progress.modePlays.time, 1)),
  // 段マスター
  ach('adv-first', '🚀', 'silver', 'はってんの とびら', 'はってんの 10だんを ぜんぶ 1かいずつ せいかいする',
    (c) => count(ADVANCED_DANS.filter((n) => (c.stats.byDan[n]?.correct ?? 0) >= 1).length, 10)),
  ach('master-5', '⭐', 'silver', '5だん マスター', '5つの だんを マスターする', (c) => count(mastered(c, ALL_DANS), 5)),
  ach('master-basic', '🌟', 'gold', 'きほん マスター', 'きほんの 1〜9の だんを ぜんぶ マスターする', (c) => count(mastered(c, BASIC_DANS), 9)),
  ach('master-adv', '💫', 'gold', 'はってん マスター', 'はってんの 10だんを ぜんぶ マスターする', (c) => count(mastered(c, ADVANCED_DANS), 10)),
  ach('master-all', '👑', 'rainbow', 'えんしゅうりつ マスター', '19だんを ぜんぶ マスターして、タイムアタック 40びょうぎり',
    (c) => count(mastered(c, ALL_DANS) + (isTimeCleared(c.records) ? 1 : 0), 20)),
  // コンボ
  ach('combo-5', '🔥', 'bronze', '5れんぞく!', '5もん れんぞくで せいかいする', (c) => count(c.progress.bestCombo, 5)),
  ach('combo-10', '⚡', 'silver', '10れんぞく!!', '10もん れんぞくで せいかいする', (c) => count(c.progress.bestCombo, 10)),
  ach('combo-20', '🌪️', 'gold', '20れんぞく!!!', '20もん れんぞくで せいかいする', (c) => count(c.progress.bestCombo, 20)),
  ach('combo-30', '☄️', 'rainbow', '30れんぞく てんさい', '30もん れんぞくで せいかいする', (c) => count(c.progress.bestCombo, 30)),
  // タイムアタック
  ach('time-60', '🐢', 'bronze', 'のんびり ランナー', 'タイムアタックで 60びょうぎり', timeUnder(60)),
  ach('time-40', '🐇', 'silver', 'はやあし ウサギ', 'タイムアタックで 40びょうぎり', timeUnder(40)),
  ach('time-30', '🐆', 'gold', 'チーターなみ', 'タイムアタックで 30びょうぎり', timeUnder(30)),
  ach('time-20', '🚄', 'gold', 'しんかんせん', 'タイムアタックで 20びょうぎり', timeUnder(20)),
  ach('time-15', '🛸', 'rainbow', 'ひかりの はやさ', 'タイムアタックで 15びょうぎり', timeUnder(15)),
  // ぜんもん正解
  ach('perfect-choice', '💯', 'silver', '4たく パーフェクト', '4たくクイズで 10もん ぜんぶ せいかい', (c) => flag(c.progress.perfect.choice)),
  ach('perfect-twotap', '🏅', 'silver', '2タップ パーフェクト', '2タップ チャレンジで 10もん ぜんぶ せいかい', (c) => flag(c.progress.perfect.twotap)),
  ach('perfect-reverse', '🥇', 'silver', 'ぎゃくびき パーフェクト', 'ぎゃくびきで 10もん ぜんぶ せいかい', (c) => flag(c.progress.perfect.reverse)),
  // 累計せいかい
  ach('total-50', '📘', 'bronze', '50もん せいかい', 'ぜんぶで 50もん せいかいする', (c) => count(c.progress.totalCorrect, 50)),
  ach('total-100', '📗', 'silver', '100もん せいかい', 'ぜんぶで 100もん せいかいする', (c) => count(c.progress.totalCorrect, 100)),
  ach('total-300', '📙', 'gold', '300もん せいかい', 'ぜんぶで 300もん せいかいする', (c) => count(c.progress.totalCorrect, 300)),
  ach('total-1000', '📕', 'rainbow', '1000もん せいかい', 'ぜんぶで 1000もん せいかいする', (c) => count(c.progress.totalCorrect, 1000)),
  // レベル
  ach('lv-5', '🎈', 'bronze', 'レベル 5', 'レベル 5に なる', (c) => count(c.level, 5)),
  ach('lv-10', '🎊', 'silver', 'レベル 10', 'レベル 10に なる', (c) => count(c.level, 10)),
  ach('lv-20', '🎖️', 'gold', 'レベル 20', 'レベル 20に なる', (c) => count(c.level, 20)),
  // まいにち
  ach('streak-3', '📅', 'bronze', '3にち れんぞく', '3にち つづけて あそぶ', (c) => count(c.progress.streak.best, 3)),
  ach('streak-7', '🗓️', 'silver', '7にち れんぞく', '7にち つづけて あそぶ', (c) => count(c.progress.streak.best, 7)),
  // かくし
  ach('pi-314', '🥧', 'gold', 'パイ!', '???', (c) => count(c.progress.totalCorrect, 314),
    { hidden: true, hint: '???(ある かずを めざそう)' }),
  ach('early-bird', '🐓', 'bronze', 'あさの れんしゅう', '???', (c) => flag(c.progress.flags.early),
    { hidden: true, hint: '???(はやおきすると いいことが…)' }),
  ach('comeback', '🏠', 'silver', 'おかえり!', '???', (c) => flag(c.progress.flags.comeback),
    { hidden: true, hint: '???(しばらく あそばないでいると…)' }),
  // コンプリート(クリアしたあとの やりこみ)
  ach('complete', '🌈', 'rainbow', 'コンプリート', 'ほかの じっせきを ぜんぶ とる',
    (c) => count(Object.keys(c.progress.unlocked).filter((id) => id !== 'complete').length, ACHIEVEMENTS.length - 1)),
];

function contextOf(progress, stats, records) {
  return { progress, stats, records, level: levelInfo(progress.xp).level };
}

export function achievementStatus(a, progress, stats, records) {
  const [cur, max] = a.progress(contextOf(progress, stats, records));
  return { cur, max, done: cur >= max };
}

/** 条件を満たした実績を解除(ボーナス XP つき)。ボーナスでレベルが上がって別の実績が解ける連鎖も処理する。 */
export function evaluateAchievements(progress, stats, records, now) {
  let p = { ...progress, unlocked: { ...progress.unlocked } };
  const unlocked = [];
  let justCleared = false;
  for (let changed = true; changed;) {
    changed = false;
    for (const a of ACHIEVEMENTS) {
      if (p.unlocked[a.id] !== undefined) continue;
      if (!achievementStatus(a, p, stats, records).done) continue;
      p.unlocked[a.id] = now;
      p.xp += RARITY_BONUS_XP[a.rarity];
      unlocked.push(a);
      changed = true;
      if (a.id === 'master-all' && p.cleared === null) { p.cleared = now; justCleared = true; }
    }
  }
  return { progress: p, unlocked, justCleared };
}
