// localStorage ラッパ(データ形式 v2)。壊れたデータ・使えない環境でも例外を出さない。
// v1(キー pi-kakezan:v1、成績とベストタイムのみ)は読み込み時に v2 へ引き継ぐ。v1 のキーは消さない。
import { RANGES, emptyStats } from './logic.js';
import { defaultProgress, ACHIEVEMENTS } from './progress.js';

export const KEY = 'pi-kakezan:v2';
export const LEGACY_KEY = 'pi-kakezan:v1';
export const VERSION = 2;

function defaults() {
  return { version: VERSION, settings: { range: 'basic', sound: true }, stats: emptyStats(), records: {}, progress: defaultProgress() };
}

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function sanitizeStats(raw, out) {
  const byDan = raw?.stats?.byDan;
  if (isObj(byDan)) {
    for (const [k, v] of Object.entries(byDan)) {
      const n = Number(k);
      if (Number.isInteger(n) && n > 0 && v && isCount(v.correct) && isCount(v.total) && v.correct <= v.total) {
        out.stats.byDan[n] = { correct: v.correct, total: v.total };
      }
    }
  }
  if (Array.isArray(raw?.stats?.recentMistakes)) {
    out.stats.recentMistakes = raw.stats.recentMistakes
      .filter((m) => m && Number.isInteger(m.n) && m.n > 0 && Number.isFinite(m.at))
      .slice(0, 20)
      .map((m) => ({ n: m.n, at: m.at }));
  }
  if (isObj(raw?.records)) {
    for (const [k, v] of Object.entries(raw.records)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out.records[k] = v;
    }
  }
}

function sanitizeProgress(raw, out) {
  if (!isObj(raw)) return;
  const p = out.progress;
  for (const k of ['xp', 'totalCorrect', 'totalAnswered', 'bestCombo']) if (isCount(raw[k])) p[k] = raw[k];
  if (isObj(raw.modePlays)) for (const k of Object.keys(p.modePlays)) if (isCount(raw.modePlays[k])) p.modePlays[k] = raw.modePlays[k];
  if (isObj(raw.perfect)) for (const k of Object.keys(p.perfect)) if (raw.perfect[k] === true) p.perfect[k] = true;
  if (isObj(raw.unlocked)) {
    const known = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const [k, v] of Object.entries(raw.unlocked)) if (known.has(k) && Number.isFinite(v)) p.unlocked[k] = v;
  }
  if (isObj(raw.streak)) {
    if (typeof raw.streak.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.streak.last)) p.streak.last = raw.streak.last;
    if (isCount(raw.streak.count)) p.streak.count = raw.streak.count;
    if (isCount(raw.streak.best)) p.streak.best = raw.streak.best;
  }
  if (isObj(raw.flags)) for (const k of Object.keys(p.flags)) if (raw.flags[k] === true) p.flags[k] = true;
  if (Number.isFinite(raw.cleared)) p.cleared = raw.cleared;
}

function sanitizeV2(raw) {
  const d = defaults();
  if (!isObj(raw)) return d;
  if (RANGES.includes(raw.settings?.range)) d.settings.range = raw.settings.range;
  if (typeof raw.settings?.sound === 'boolean') d.settings.sound = raw.settings.sound;
  sanitizeStats(raw, d);
  sanitizeProgress(raw.progress, d);
  return d;
}

/** v1 → v2。成績・ベストタイム・範囲を引き継ぎ、過去の正解ぶんの XP(1問 10)を与える。 */
function migrateV1(raw) {
  const d = defaults();
  if (!isObj(raw)) return d;
  if (RANGES.includes(raw.settings?.range)) d.settings.range = raw.settings.range;
  sanitizeStats(raw, d);
  let correct = 0; let total = 0;
  for (const v of Object.values(d.stats.byDan)) { correct += v.correct; total += v.total; }
  d.progress.totalCorrect = correct;
  d.progress.totalAnswered = total;
  d.progress.xp = correct * 10;
  return d;
}

function parse(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export function createStorage(ls = globalThis.localStorage ?? null) {
  function load() {
    try {
      const v2 = parse(ls?.getItem(KEY));
      if (isObj(v2)) return sanitizeV2(v2);
      const v1 = parse(ls?.getItem(LEGACY_KEY));
      return isObj(v1) ? migrateV1(v1) : defaults();
    } catch {
      return defaults();
    }
  }
  function save(data) {
    try {
      ls?.setItem(KEY, JSON.stringify({ ...data, version: VERSION }));
      return true;
    } catch {
      return false;
    }
  }
  /** 成績・ベストタイム・レベル・実績をすべて消す。出題範囲と音の設定は残す。 */
  function reset() {
    const next = defaults();
    next.settings = load().settings;
    save(next);
    return next;
  }
  return { load, save, reset };
}
