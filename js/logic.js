// 円周率の掛け算(3.14 × n)の純粋関数群。DOM・localStorage には触れない。
// 小数は使わず、「100倍した整数(hundredths)」で計算する。

export const BASIC_DANS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const ADVANCED_DANS = [12, 15, 16, 18, 24, 25, 36, 49, 64, 81];
export const RANGES = ['basic', 'both', 'advanced'];
export const WEAK_THRESHOLD = 0.8;
export const MAX_RECENT_MISTAKES = 20;

export function dansForRange(range) {
  if (range === 'advanced') return [...ADVANCED_DANS];
  if (range === 'both') return [...BASIC_DANS, ...ADVANCED_DANS];
  return [...BASIC_DANS];
}

// ---------- 計算と整形 ----------

/** 3.14 × n を 100 倍した整数(314 × n)。 */
export function productHundredths(n) {
  return 314 * n;
}

/** 100倍した整数を、末尾の0を省いた受験式の文字列にする。 2198→"21.98", 3140→"31.4", 15700→"157" */
export function formatHundredths(h) {
  const int = Math.floor(h / 100);
  const frac = String(h % 100).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : String(int);
}

export function answerText(n) {
  return formatHundredths(productHundredths(n));
}

export function questionText(n) {
  return `3.14 × ${n}`;
}

// ---------- 入力の正規化と判定 ----------

/** 入力文字列を受験式の正規形("31.40"→"31.4")にする。数として成り立たなければ null。 */
export function normalizeInput(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFKC').trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const intPart = m[1] ?? '';
  const fracPart = m[2] ?? '';
  if (intPart === '' && fracPart === '') return null; // "" や "." だけ
  const int = intPart.replace(/^0+(?=\d)/, '') || '0';
  const frac = fracPart.replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

export function isCorrectInput(n, raw) {
  const v = normalizeInput(raw);
  return v !== null && v === answerText(n);
}

// ---------- 乱数ヘルパー ----------

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function neighborsInPool(n, pool) {
  const sorted = [...new Set(pool)].sort((a, b) => a - b);
  const i = sorted.indexOf(n);
  const out = [];
  if (i > 0) out.push(sorted[i - 1]);
  if (i >= 0 && i < sorted.length - 1) out.push(sorted[i + 1]);
  return out;
}

/** 小数点の位置を動かした文字列。"21.98" を k=+1 で "219.8"、k=-1 で "2.198"。 */
function shiftDecimal(text, k) {
  const [i, f = ''] = text.split('.');
  const digits = i + f;
  const pos = i.length + k;
  if (pos <= 0) return `0.${'0'.repeat(-pos)}${digits}`.replace(/0+$/, '');
  if (pos >= digits.length) return digits + '0'.repeat(pos - digits.length);
  return `${digits.slice(0, pos)}.${digits.slice(pos)}`.replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m));
}

function swapDigits(text) {
  const out = [];
  const chars = text.split('');
  for (let i = 0; i < chars.length - 1; i++) {
    if (chars[i] === '.' || chars[i + 1] === '.' || chars[i] === chars[i + 1]) continue;
    const c = [...chars];
    [c[i], c[i + 1]] = [c[i + 1], c[i]];
    if (c[0] === '0' && c[1] !== '.') continue;
    out.push(c.join(''));
  }
  return out;
}

// ---------- 4択(こたえを選ぶ) ----------

/** 3.14×n の4択(文字列4つ・重複なし・正解を必ず含む)。 */
export function makeChoices(n, rng, pool = BASIC_DANS) {
  const correct = answerText(n);
  const h = productHundredths(n);
  const valid = (t) => typeof t === 'string' && t !== correct && /^\d+(\.\d+)?$/.test(t) && Number(t) > 0;

  const near = [...neighborsInPool(n, pool), n - 1, n + 1].filter((m) => m > 0 && m !== n).map(answerText);
  const shifted = [shiftDecimal(correct, 1), shiftDecimal(correct, -1), shiftDecimal(correct, 2)];
  const typo = [...swapDigits(correct), formatHundredths(h + 1), formatHundredths(h - 1), formatHundredths(h + 10), formatHundredths(h - 10)];

  const groups = [near, shifted, typo].map((g) => shuffle(g.filter(valid), rng));
  const picked = [];
  const add = (t) => { if (valid(t) && !picked.includes(t)) picked.push(t); };
  for (const g of groups) { if (g.length) add(g[0]); }
  for (const t of shuffle(groups.flat(), rng)) { if (picked.length < 3) add(t); }
  for (let k = 1; picked.length < 3; k++) add(formatHundredths(h + 7 * k)); // 念のための穴埋め
  return shuffle([correct, ...picked.slice(0, 3)], rng);
}

// ---------- ぎゃくびき(? × 3.14 = X) ----------

/** こたえ(段の数)の4択。数値4つ・重複なし・正解を含む。 */
export function makeReverseChoices(n, rng, pool = BASIC_DANS) {
  const valid = (m) => Number.isInteger(m) && m > 0 && m !== n;
  const near = [...neighborsInPool(n, pool), n - 1, n + 1].filter(valid);
  const others = [n - 2, n + 2, n + 10, n * 2].filter(valid);
  const picked = [];
  const add = (m) => { if (valid(m) && !picked.includes(m)) picked.push(m); };
  for (const m of shuffle(near, rng)) add(m);
  for (const m of shuffle(others, rng)) { if (picked.length < 3) add(m); }
  for (let k = 1; picked.length < 3; k++) add(n + 2 + k);
  return shuffle([n, ...picked.slice(0, 3)], rng);
}

export function makeReverseQuestion(n, rng, pool = BASIC_DANS) {
  return { n, productText: answerText(n), choices: makeReverseChoices(n, rng, pool) };
}

// ---------- 出題キュー ----------

/** dans から count 問。全段を一巡してから次の巡へ。連続で同じ段は出さない。 */
export function buildQueue(dans, count, rng) {
  const base = [...new Set(dans)];
  if (base.length === 0 || count <= 0) return [];
  const out = [];
  while (out.length < count) {
    const bag = shuffle(base, rng);
    if (bag.length > 1 && out.length && bag[0] === out[out.length - 1]) {
      const j = 1 + Math.floor(rng() * (bag.length - 1));
      [bag[0], bag[j]] = [bag[j], bag[0]];
    }
    for (const n of bag) { if (out.length < count) out.push(n); }
  }
  return out;
}

// ---------- 記録 ----------

export function emptyStats() {
  return { byDan: {}, recentMistakes: [] };
}

/** 1問ぶんの結果を足した新しい stats を返す(元は変更しない)。 */
export function recordAnswer(stats, n, correct, now = Date.now()) {
  const prev = stats.byDan[n] ?? { correct: 0, total: 0 };
  const byDan = { ...stats.byDan, [n]: { correct: prev.correct + (correct ? 1 : 0), total: prev.total + 1 } };
  const recentMistakes = correct
    ? stats.recentMistakes
    : [{ n, at: now }, ...stats.recentMistakes].slice(0, MAX_RECENT_MISTAKES);
  return { byDan, recentMistakes };
}

export function accuracy(stats, n) {
  const d = stats.byDan[n];
  return d && d.total > 0 ? d.correct / d.total : null;
}

/** 正答率が低い順の「にがて」な段(しきい値未満、まだ解いていない段は含めない)。 */
export function weakDans(stats, dans) {
  return dans
    .map((n) => ({ n, acc: accuracy(stats, n), total: stats.byDan[n]?.total ?? 0 }))
    .filter((x) => x.acc !== null && x.acc < WEAK_THRESHOLD)
    .sort((a, b) => a.acc - b.acc || b.total - a.total || a.n - b.n)
    .map((x) => x.n);
}

export function buildWeakQueue(stats, dans, count, rng) {
  return buildQueue(weakDans(stats, dans), count, rng);
}

// ---------- ベストタイム ----------

export function bestTime(records, key = 'time-attack') {
  const v = records?.[key];
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function updateBestTime(records, key, ms) {
  const previous = bestTime(records, key);
  const isBest = previous === null || ms < previous;
  return {
    records: isBest ? { ...records, [key]: ms } : { ...records },
    result: { isBest, previous },
  };
}
