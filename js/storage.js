// localStorage ラッパ。壊れたデータ・使えない環境でも例外を出さない。
import { RANGES, emptyStats } from './logic.js';

export const KEY = 'pi-kakezan:v1';

function defaults() {
  return { settings: { range: 'basic' }, stats: emptyStats(), records: {} };
}

const isCount = (v) => Number.isInteger(v) && v >= 0;

function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;

  if (RANGES.includes(raw.settings?.range)) d.settings.range = raw.settings.range;

  const byDan = raw.stats?.byDan;
  if (byDan && typeof byDan === 'object' && !Array.isArray(byDan)) {
    for (const [k, v] of Object.entries(byDan)) {
      const n = Number(k);
      if (Number.isInteger(n) && n > 0 && v && isCount(v.correct) && isCount(v.total) && v.correct <= v.total) {
        d.stats.byDan[n] = { correct: v.correct, total: v.total };
      }
    }
  }
  if (Array.isArray(raw.stats?.recentMistakes)) {
    d.stats.recentMistakes = raw.stats.recentMistakes
      .filter((m) => m && Number.isInteger(m.n) && m.n > 0 && Number.isFinite(m.at))
      .slice(0, 20)
      .map((m) => ({ n: m.n, at: m.at }));
  }
  if (raw.records && typeof raw.records === 'object' && !Array.isArray(raw.records)) {
    for (const [k, v] of Object.entries(raw.records)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) d.records[k] = v;
    }
  }
  return d;
}

export function createStorage(ls = globalThis.localStorage ?? null) {
  function load() {
    try {
      const text = ls?.getItem(KEY);
      return sanitize(text ? JSON.parse(text) : null);
    } catch {
      return defaults();
    }
  }
  function save(data) {
    try {
      ls?.setItem(KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }
  /** 記録(せいせき・ベストタイム)を消す。出題範囲の設定は残す。 */
  function reset() {
    const next = defaults();
    next.settings = load().settings;
    save(next);
    return next;
  }
  return { load, save, reset };
}
