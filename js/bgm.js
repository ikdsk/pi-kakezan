// BGM の「中身」: 曲のパターン・画面/コンボ→レイヤーの対応・切り替えタイミングの計算。
// DOM にも Web Audio にも触れない純粋関数。音を鳴らすのは bgmsynth.js。
//
// 曲(オリジナル): C メジャー、132 BPM(タイムアタックは 140)、4 小節ループ
//   | C | G | Am | F → G |   (16 ステップ = 16 分音符 × 16 = 1 小節)
import { comboStage } from './combo.js';

export const BPM_NORMAL = 132;
export const BPM_TIME = 140;
export const STEPS_PER_BAR = 16;
export const BARS = 4;
export const LOOP_STEPS = STEPS_PER_BAR * BARS;
export const BEAT_STEPS = 4;
export const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** レイヤー(0〜1 の強さ)。filter はメロディ系の音色の明るさ(0 = こもる / 1 = 全開)。 */
export const LAYER_KEYS = ['bass', 'kick', 'clap', 'hat', 'hat16', 'chords', 'arp', 'arp16', 'lead', 'leadOct', 'fever', 'filter'];

export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
export const stepSeconds = (bpm) => 60 / bpm / 4;
export const barSeconds = (bpm) => stepSeconds(bpm) * STEPS_PER_BAR;

// ---------- パターン ----------
const BASS_ROOTS = [48, 43, 45, 41]; // C3 G2 A2 F2(スマホのスピーカーでも聞こえる高さ)
const CHORDS = {
  C: [60, 64, 67], G: [59, 62, 67], Am: [60, 64, 69], F: [60, 65, 69],
};
const BAR_CHORDS = [['C'], ['G'], ['Am'], ['F', 'G']]; // 最後の小節は F → G(前半・後半)
// ベース: [ステップ, ルートからの半音, 長さ(ステップ)]
const BASS_LINE = [[0, 0, 3], [3, 12, 1], [6, 0, 2], [8, 0, 2], [10, 7, 1], [12, 0, 2], [14, 12, 1]];
const STAB_STEPS = [0, 3, 6, 10, 13];
const ARP_SEQ = [0, 1, 2, 3, 2, 1, 2, 1, 0, 1, 2, 3, 2, 1, 2, 3]; // chord[0..2] と chord[0]+12
// リード: [ループ内ステップ, MIDI, 長さ]。ドレミの音だけの、オリジナルの 4 小節フレーズ。
const LEAD = [
  [0, 76, 3], [4, 79, 2], [6, 81, 2], [8, 79, 3], [12, 76, 2], [14, 74, 2],
  [16, 74, 3], [20, 79, 2], [22, 83, 2], [24, 81, 3], [28, 79, 4],
  [32, 81, 2], [34, 79, 2], [36, 76, 3], [40, 72, 2], [42, 76, 2], [44, 79, 4],
  [48, 77, 3], [52, 81, 2], [54, 79, 2], [56, 74, 2], [58, 79, 2], [60, 83, 4],
];

const TABLE = Array.from({ length: LOOP_STEPS }, (_, i) => {
  const bar = Math.floor(i / STEPS_PER_BAR);
  const step = i % STEPS_PER_BAR;
  const half = BAR_CHORDS[bar].length === 2 && step >= 8 ? 1 : 0;
  const chordName = BAR_CHORDS[bar][half];
  const chord = CHORDS[chordName];
  const chordRoot = chordName === 'G' && bar === 3 ? 43 : BASS_ROOTS[bar];
  const bassHit = BASS_LINE.find(([s]) => s === step);
  const arpNote = chord.concat(chord[0] + 12)[ARP_SEQ[step]];
  const leadHit = LEAD.find(([s]) => s === i);
  return {
    bar, step, chordRoot, chord,
    bass: bassHit ? { midi: chordRoot + bassHit[1], len: bassHit[2] } : null,
    kick: [0, 4, 8, 12].includes(step) ? 1 : step === 10 ? 0.45 : 0,
    clap: step === 4 || step === 12,
    hat: step % 2 === 0 ? (step % 4 === 2 ? 1 : 0.5) : 0,
    hat16: step % 2 === 1 ? 0.35 : 0,
    stab: STAB_STEPS.includes(step),
    arp: step % 2 === 0 ? arpNote : null,
    arp16: step % 2 === 1 ? arpNote : null,
    lead: leadHit ? { midi: leadHit[1], len: leadHit[2] } : null,
  };
});

export function patternAt(stepIndex) {
  return TABLE[((Math.floor(stepIndex) % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS];
}

// ---------- 画面・コンボ → レイヤー ----------
const QUIZ_SCREENS = ['flash', 'choice', 'twotap', 'reverse', 'time'];
/** メニュー系(ホーム・ひょう・じっせき・きろく・結果…)= 'menu' / クイズ系(フラッシュカード含む)= 'quiz' */
export function screenMode(screen) {
  return QUIZ_SCREENS.includes(screen) ? 'quiz' : 'menu';
}

const zero = () => Object.fromEntries(LAYER_KEYS.map((k) => [k, 0]));
const MENU = { ...zero(), bass: 0.7, kick: 0.3, filter: 0.4 };
const QUIZ = { ...zero(), bass: 1, kick: 1, clap: 1, hat: 1, chords: 1, arp: 1, filter: 0.55 };

/**
 * scene = { mode: 'menu'|'quiz', combo, time(タイムアタック), calm(えんしゅつ ひかえめ) }
 * → { bpm, layers }。コンボ段階は combo.js と同じ(5 / 10 / 20 で上がる)。
 */
export function bgmTarget({ mode = 'menu', combo = 0, time = false, calm = false } = {}) {
  if (mode !== 'quiz') return { bpm: BPM_NORMAL, layers: { ...MENU } };
  const layers = { ...QUIZ };
  const stage = calm ? Math.min(comboStage(combo), 2) : comboStage(combo); // ひかえめはコンボ連動の変化なし
  if (stage >= 3) Object.assign(layers, { hat16: 1, lead: 1, filter: 0.8 });
  if (stage >= 4) Object.assign(layers, { leadOct: 1, arp16: 1, filter: 1 });
  if (stage >= 5) layers.fever = 1;
  if (time) layers.hat16 = 1; // タイムアタックは緊張感のある 16 分ハイハット
  return { bpm: time ? BPM_TIME : BPM_NORMAL, layers };
}

/** 同じレイヤー・テンポなら同じキー(無駄な切り替え要求を捨てるため)。 */
export function sceneKey(scene) {
  const t = bgmTarget(scene);
  return JSON.stringify([t.bpm, LAYER_KEYS.map((k) => t.layers[k])]);
}

/**
 * 切り替えをどの格子に合わせるか(ステップ数)。0 = 変化なし。
 * メニュー→クイズ・テンポが変わるとき = 小節頭(16)、それ以外(クイズ→メニュー・コンボ連動)= 拍頭(4)。
 */
export function transitionGrid(prev, next) {
  if (!prev) return 0;
  if (sceneKey(prev) === sceneKey(next)) return 0;
  const a = bgmTarget(prev); const b = bgmTarget(next);
  if (a.bpm !== b.bpm) return STEPS_PER_BAR;
  if (prev.mode !== 'quiz' && next.mode === 'quiz') return STEPS_PER_BAR;
  return BEAT_STEPS;
}

// ---------- 小節頭・拍頭までの計算 ----------
export const isBoundary = (stepIndex, grid) => stepIndex % grid === 0;
/** stepIndex のステップから数えて、次の格子点までの(0 以上の)ステップ数。 */
export const stepsUntil = (stepIndex, grid) => (grid - (stepIndex % grid)) % grid;
/** 次に鳴らすステップ(nextStepIndex, nextStepTime)から見た、次の格子点までの待ち時間(秒)。 */
export function secondsUntilBoundary({ nextStepIndex, nextStepTime, now, grid, bpm }) {
  const at = nextStepTime + stepsUntil(nextStepIndex, grid) * stepSeconds(bpm);
  return Math.max(0, at - now);
}
