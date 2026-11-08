// コンボに応じた演出の「設計表」と判定。DOM にも Web Audio にも触れない純粋関数。
// 演出の強さ・色・文言・時間は、ここの定数表(STAGES など)を書き換えるだけで調整できる。

/** 各段階が始まるコンボ数。stage 0 = コンボなし。 */
export const STAGE_FROM = [0, 1, 3, 5, 10, 20];
/** キリ番(特大演出)。100 以降は 100 の倍数。 */
export const BIG_COMBOS = [10, 20, 30, 50, 100];
/** シェイクの強さの順(弱→強)。 */
export const SHAKE_RANK = ['none', 'small', 'medium', 'strong', 'huge'];
/** 光過敏への配慮: 全画面フラッシュは 1 秒に 3 回まで、間隔 340ms 以上。 */
export const FLASH_LIMIT = { maxPerSec: 3, minGapMs: 340 };
/** 通常の演出は自動送り(0.9 秒)に収める / キリ番だけ最大 2 秒。 */
export const NORMAL_MS = 800;
export const BIG_MS = 2000;

// 赤一色は避ける(R が高くて G・B が低い色は使わない)。
const COLOR_FLASH = [
  'rgba(255,230,60,0.45)', // 黄
  'rgba(80,230,140,0.42)', // 緑
  'rgba(60,210,255,0.42)', // 水色
  'rgba(255,90,220,0.40)', // ピンク
  'rgba(255,165,40,0.42)', // だいだい
];
const WHITE_FLASH = 'rgba(255,255,255,0.55)';
const TINTS = ['rgba(255,220,90,0.30)', 'rgba(90,200,255,0.30)'];

const CUT_TEXT = {
  3: ['COMBO!'],
  5: ['すごい!!', 'とまらない!!', 'きてる きてる!!', 'いいぞ いいぞ!!', 'ノリノリ!!'],
  10: ['ばくはつ!!', 'むてき!!', 'てんさい かも!?', 'まだまだ いける!!'],
  20: ['FEVER!!', 'かみ!!', 'えんしゅうりつの かみさま', 'とまらない!!!'],
};
const BIG_TEXT = { 10: '天才!?', 20: 'FEVER!!', 30: 'かみ!!', 50: 'えんしゅうりつの かみさま', 100: 'でんせつ!!!!' };

/** 段階ごとの演出セット。 */
const STAGES = [
  { stage: 0, shake: 'none', flashKind: null, tint: false, slam: false, cutin: null, zoom: false, speedLines: false, sunburst: false, afterimage: false, rim: null, ambient: false, confetti: 0, sound: 'pop', durationMs: 0 },
  { stage: 1, shake: 'small', flashKind: null, tint: false, slam: false, cutin: null, zoom: false, speedLines: false, sunburst: false, afterimage: false, rim: null, ambient: false, confetti: 22, sound: 'pop', durationMs: 500 },
  { stage: 2, shake: 'medium', flashKind: 'white', tint: true, slam: true, cutin: null, zoom: false, speedLines: false, sunburst: false, afterimage: false, rim: null, ambient: false, confetti: 50, sound: 'pop', durationMs: 750 },
  { stage: 3, shake: 'strong', flashKind: 'color', tint: false, slam: false, cutin: 'band', zoom: false, speedLines: true, sunburst: false, afterimage: false, rim: 'glow', ambient: false, confetti: 100, sound: 'chord', durationMs: 780 },
  { stage: 4, shake: 'strong', flashKind: 'rainbow', tint: false, slam: false, cutin: 'full', zoom: true, speedLines: true, sunburst: true, afterimage: true, rim: 'glow', ambient: false, confetti: 160, sound: 'boom', durationMs: NORMAL_MS },
  { stage: 5, shake: 'strong', flashKind: 'rainbow', tint: false, slam: false, cutin: 'fever', zoom: true, speedLines: true, sunburst: true, afterimage: true, rim: 'rainbow', ambient: true, confetti: 200, sound: 'fever', durationMs: NORMAL_MS },
];

const num = (c) => (Number.isFinite(c) ? Math.floor(c) : 0);

export function comboStage(combo) {
  const c = num(combo);
  let s = 0;
  for (let i = 0; i < STAGE_FROM.length; i++) if (c >= STAGE_FROM[i]) s = i;
  return c <= 0 ? 0 : s;
}

export function isBigCombo(combo) {
  const c = num(combo);
  return BIG_COMBOS.includes(c) || (c > 100 && c % 100 === 0);
}

export function isFever(combo) {
  return num(combo) >= STAGE_FROM[5];
}

/** コンボ表示の炎の数(0〜5)。 */
export function flameCount(combo) {
  const c = num(combo);
  if (c <= 0) return 0;
  if (c >= 30) return 5;
  if (c >= 20) return 4;
  if (c >= 10) return 3;
  if (c >= 5) return 2;
  return 1;
}

function pick(list, i) {
  return list[((i % list.length) + list.length) % list.length];
}

/** そのコンボ数に出す演出の内容(どの段階か・キリ番か・どの演出セットか)。 */
export function comboEffects(combo) {
  const c = num(combo);
  const st = STAGES[comboStage(c)];
  const big = c > 0 && isBigCombo(c);
  let flash = null;
  if (st.flashKind === 'white') flash = { kind: 'white', color: WHITE_FLASH };
  else if (st.flashKind === 'color') flash = { kind: 'color', color: pick(COLOR_FLASH, c - STAGE_FROM[3]) };
  else if (st.flashKind === 'rainbow') flash = { kind: 'rainbow', color: 'rainbow' };

  let cutText = null;
  if (st.cutin === 'band') cutText = pick(CUT_TEXT[5], c - STAGE_FROM[3]);
  if (st.cutin === 'full') cutText = BIG_TEXT[c] ?? pick(CUT_TEXT[10], c - STAGE_FROM[4]);
  if (st.cutin === 'fever') cutText = BIG_TEXT[c] ?? pick(CUT_TEXT[20], c - STAGE_FROM[5]);
  if (c > 100 && c % 100 === 0) cutText = BIG_TEXT[100];

  return {
    combo: c,
    stage: st.stage,
    big,
    fever: isFever(c),
    label: `${c} COMBO!`,
    cutin: st.cutin,
    cutText,
    shake: big ? 'huge' : st.shake,
    zoom: st.zoom,
    flash,
    tint: st.tint ? TINTS[(c - STAGE_FROM[2]) % TINTS.length] : null,
    slam: st.slam,
    speedLines: st.speedLines,
    sunburst: st.sunburst,
    afterimage: st.afterimage,
    rim: st.rim,
    ambient: st.ambient,
    confetti: big ? Math.round(st.confetti * 1.8) : st.confetti,
    sound: st.sound,
    durationMs: c <= 0 ? 0 : big ? BIG_MS : st.durationMs,
    skippable: big,
  };
}

/**
 * 演出モードに合わせる。'calm'(ひかえめ / prefers-reduced-motion)は
 * シェイク・フラッシュ・ズーム・サンバースト・紙吹雪などを止めて、文字カットインだけにする。
 */
export function effectsForMode(effects, mode) {
  if (mode !== 'calm') return effects;
  return {
    ...effects,
    shake: 'none',
    zoom: false,
    flash: null,
    tint: null,
    slam: false,
    speedLines: false,
    sunburst: false,
    afterimage: false,
    rim: null,
    ambient: false,
    confetti: 0,
    cutin: effects.cutin || effects.slam ? 'text' : null,
    cutText: effects.cutText ?? (effects.slam ? effects.label : null),
    durationMs: effects.cutin || effects.slam ? NORMAL_MS : 0,
    skippable: false,
  };
}

/** コンボが 3 以上から切れたときの「コンボ ストップ…」(凹ませすぎない言い方)。 */
export function comboBreak(prevCombo, bestCombo) {
  const prev = num(prevCombo);
  if (prev < STAGE_FROM[2]) return null;
  const best = Math.max(num(bestCombo), prev);
  return { text: 'コンボ ストップ…', best, sub: `さいこう ${best} れんぞく! つぎは もっと いける!` };
}

// ---------- フラッシュ頻度の制限 ----------

/** history: これまでに全画面フラッシュを出した時刻(ms)。いま出してよいか。 */
export function allowFlash(history, now, limit = FLASH_LIMIT) {
  const recent = history.filter((t) => now - t < 1000);
  if (recent.length >= limit.maxPerSec) return false;
  const last = recent.length ? Math.max(...recent) : -Infinity;
  return now - last >= limit.minGapMs;
}

/** 出した時刻を記録(1 秒より古いものは捨てる)。 */
export function recordFlash(history, now) {
  return [...history.filter((t) => now - t < 1000), now];
}
