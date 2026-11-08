// 画面とDOM。計算・判定・出題は logic.js、XP・実績は progress.js、保存は storage.js、演出は fx.js / sound.js。
import {
  dansForRange, answerText, questionText, answerParts, partsText, isCorrectTwoTap,
  makeChoices, makeReverseQuestion, makeIntChoices, makeFracChoices, buildQueue,
  recordAnswer, accuracy, bestTime, updateBestTime,
} from './logic.js';
import {
  ACHIEVEMENTS, RARITY_LABELS, RARITY_BONUS_XP, CLEAR_TIME_MS, TIME_ATTACK_KEY,
  levelInfo, applyAnswer, addXp, touchDay, dateKey, finishSession,
  masteredDans, isMastered, isTimeCleared, achievementStatus, evaluateAchievements,
} from './progress.js';
import { createStorage } from './storage.js';
import { createSound } from './sound.js';
import { createFx } from './fx.js';
import { createComboFx } from './combofx.js';
import { comboStage, flameCount, comboEffects, effectsForMode, comboBreak } from './combo.js';

const rng = Math.random;
const app = document.getElementById('app');

let ls = null;
try { ls = window.localStorage; } catch { ls = null; }
const store = createStorage(ls);
let data = store.load();
const sound = createSound(data.settings.sound);
const osReduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** えんしゅつ「ひかえめ」、または OS の「動きを減らす」のとき true */
const isCalm = () => osReduced() || data.settings.fx === 'calm';
const fx = createFx(isCalm);
const comboFx = createComboFx({ fx, sound, isCalm });
document.addEventListener('pointerdown', () => sound.unlock(), true); // iOS: 最初のタップで AudioContext を resume

const RANGE_LABELS = { basic: 'きほん', both: 'きほん＋ はってん', advanced: 'はってん' };
const QUIZ_LENGTH = 10;
const ADVANCE_MS = 900;
const MODE_TITLES = { choice: '4たくクイズ', twotap: '2タップ', reverse: 'ぎゃくびき', time: 'タイムアタック', flash: 'フラッシュカード' };

/** 連続正解(コンボ)は、まちがえるまでセッションをまたいで続く(リロードで 0)。20 以上のフィーバーに届くために必要。 */
let comboCarry = 0;
let session = null;
let sessionSeq = 0;
let timerId = null;
let advanceTimer = null;

// ---------- DOM ヘルパー ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function clearAdvance() {
  if (advanceTimer !== null) { clearTimeout(advanceTimer); advanceTimer = null; }
}
function stopTimer() {
  if (timerId !== null) { clearInterval(timerId); timerId = null; }
}
function mount(...nodes) {
  stopTimer();
  clearAdvance();
  if (!session) comboFx.stopAll(); // クイズ中以外では、コンボ演出(外周の光・フィーバー・ビート)を止める
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}
function persist() { store.save(data); }
const lv = () => levelInfo(data.progress.xp);
const centerOf = (el) => {
  const r = el?.getBoundingClientRect?.();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
};

function formatTime(ms) {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}びょう`;
  const m = Math.floor(sec / 60);
  return `${m}ふん ${(sec - m * 60).toFixed(1)}びょう`;
}

// ---------- 音の切り替え ----------
function soundButton() {
  const b = h('button', { type: 'button', class: 'sound-btn', onclick: () => {
    const next = !sound.isEnabled();
    sound.setEnabled(next);
    data.settings.sound = next;
    persist();
    document.querySelectorAll('.sound-btn').forEach(paintSound);
    if (next) sound.tap();
  } });
  paintSound(b);
  return b;
}
function paintSound(b) {
  const on = sound.isEnabled();
  b.textContent = on ? '🔊' : '🔇';
  b.setAttribute('aria-label', on ? 'こうかおん: オン(タップでオフ)' : 'こうかおん: オフ(タップでオン)');
  b.setAttribute('aria-pressed', String(on));
}

function topbar(title, meta) {
  return h('div', { class: 'topbar' },
    h('button', { type: 'button', onclick: () => { session = null; showHome(); }, 'aria-label': 'ホームにもどる' }, h('span', { 'aria-hidden': 'true' }, '← '), h('span', { class: 'bkt' }, 'もどる')),
    h('span', { class: 'title' }, title),
    h('span', { class: 'meta' }, meta ?? ''),
    soundButton());
}

// ---------- 実績・レベルの反映と演出 ----------
function achievementNode(a) {
  return h('div', { class: 'toast-ach' },
    h('span', { class: 'ico' }, a.icon),
    h('div', {}, h('div', { class: 'tt' }, `じっせき かいじょ! (${RARITY_LABELS[a.rarity]})`), h('div', { class: 'nm' }, a.name)),
    h('span', { class: 'bonus' }, `+${RARITY_BONUS_XP[a.rarity]}XP`));
}

function presentUnlocks(unlocked) {
  if (!unlocked.length) return;
  for (const a of unlocked) fx.toast(achievementNode(a), 2600);
  setTimeout(() => sound.achievement(), 250);
  if (unlocked.some((a) => a.rarity === 'rainbow' || a.rarity === 'gold')) fx.rain(40);
}

function showLevelUp(from, to) {
  sound.levelUp();
  fx.overlay({
    cls: 'levelup',
    autoMs: 2800,
    build: () => h('div', { class: 'inner' },
      h('div', { class: 'huge' }, 'LEVEL UP!'),
      h('div', { class: 'lvnum' }, `Lv ${to}`),
      h('div', { class: 'sub' }, `Lv ${from} → Lv ${to}`),
      h('div', { class: 'sub' }, 'どんどん つよくなってる! 🚀'),
      h('p', { class: 'skip' }, 'タップで とじる')),
    onOpen: () => {
      fx.rain(90);
      setTimeout(() => fx.confetti(window.innerWidth * 0.2, window.innerHeight * 0.7, 80, 1.5), 250);
      setTimeout(() => fx.confetti(window.innerWidth * 0.8, window.innerHeight * 0.7, 80, 1.5), 450);
    },
  });
}

function endingSummary() {
  const p = data.progress;
  const acc = p.totalAnswered ? Math.round((p.totalCorrect / p.totalAnswered) * 100) : 0;
  const best = bestTime(data.records, TIME_ATTACK_KEY);
  const items = [
    ['レベル', `Lv ${lv().level}`],
    ['せいかい', `${p.totalCorrect}もん`],
    ['せいかいりつ', `${acc}%`],
    ['さいこうコンボ', `${p.bestCombo}れんぞく`],
    ['ベストタイム', best ? formatTime(best) : '—'],
    ['じっせき', `${Object.keys(p.unlocked).length} / ${ACHIEVEMENTS.length}`],
  ];
  return h('div', { class: 'sumgrid' }, items.map(([k, v]) => h('div', {}, k, h('b', {}, v))));
}

function showEnding() {
  sound.clear();
  let burst = 0;
  fx.overlay({
    cls: 'ending',
    autoMs: 0,
    dismissible: false,
    build: (close) => h('div', { class: 'inner' },
      h('div', { class: 'badge' }, '🏆'),
      h('div', { class: 'huge' }, 'おめでとう!'),
      h('div', { class: 'sub' }, 'えんしゅうりつ マスター クリア!'),
      h('p', { class: 'sub' }, '19この だんを ぜんぶ マスター。もう 3.14の かけざんは むてき!'),
      endingSummary(),
      h('p', { class: 'sub' }, '👑 クリアバッジを ゲットしたよ'),
      h('button', { type: 'button', class: 'wide', onclick: () => { clearInterval(burst); close(); } }, 'つづける'),
      h('p', { class: 'skip' }, 'これからも レインボーの じっせきを あつめよう')),
    onOpen: () => {
      fx.rain(100);
      burst = setInterval(() => {
        fx.confetti(Math.random() * window.innerWidth, window.innerHeight * 0.8, 60, 1.4);
        fx.rain(40);
      }, 900);
    },
  });
}

/** 実績判定・レベルアップ・クリアを一括で処理して保存する。levelBefore は処理前のレベル。 */
function settle(levelBefore) {
  const ev = evaluateAchievements(data.progress, data.stats, data.records, Date.now());
  data.progress = ev.progress;
  persist();
  const levelAfter = lv().level;
  const levelUp = levelAfter > levelBefore ? { from: levelBefore, to: levelAfter } : null;
  if (levelUp) showLevelUp(levelUp.from, levelUp.to);
  presentUnlocks(ev.unlocked);
  if (ev.justCleared) showEnding();
  return { levelUp, unlocked: ev.unlocked };
}

function touchToday() {
  const now = new Date();
  const lb = lv().level;
  data.progress = touchDay(data.progress, dateKey(now), now.getHours());
  settle(lb);
}

// ---------- ホーム ----------
function masterCount() { return masteredDans(data.stats).length; }

function statusCard() {
  const li = lv();
  const best = bestTime(data.records, TIME_ATTACK_KEY);
  const timeOk = isTimeCleared(data.records);
  const m = masterCount();
  const cleared = data.progress.cleared !== null;
  const timeText = timeOk ? `✔ タイム ${CLEAR_TIME_MS / 1000}びょうぎり!`
    : best ? `タイム ベスト ${formatTime(best)} (${CLEAR_TIME_MS / 1000}びょうぎりで クリア)` : `タイム ${CLEAR_TIME_MS / 1000}びょうぎりで クリア`;
  const fill = h('i', { style: 'width:0%' });
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${li.ratio * 100}%`; }));
  const mfill = h('i', { style: `width:${(m / 19) * 100}%` });
  return h('section', { class: 'status', 'aria-label': 'レベルと クリアまでの しんちょく' },
    h('div', { class: 'lv' },
      h('span', { class: 'lvbadge' }, `Lv ${li.level}`),
      h('span', { class: 'xptext' }, `XP ${data.progress.xp} ・ つぎの レベルまで あと ${li.need - li.into}`)),
    h('div', { class: 'xpbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(li.need), 'aria-valuenow': String(li.into), 'aria-label': 'けいけんち' }, fill),
    h('div', { class: 'clearline' },
      h('span', {}, cleared ? '🏆 クリア ずみ!' : '👑 えんしゅうりつ マスターまで'),
      h('span', {}, `マスター段 ${m}/19`),
      h('div', { class: 'mini-progress', 'aria-hidden': 'true' }, mfill)),
    h('div', { class: 'clearline' }, h('span', { class: timeOk ? 'ok' : '' }, timeText)));
}

function showHome() {
  session = null;
  const range = data.settings.range;
  const unlockedCount = Object.keys(data.progress.unlocked).length;
  const menuItem = (cls, title, desc, onclick) =>
    h('button', { type: 'button', class: cls, onclick }, h('span', { class: 't' }, title), h('span', { class: 'd' }, desc));

  mount(
    h('div', { class: 'hero' }, h('h1', {}, '3.14 の かけざん'), soundButton()),
    h('p', { class: 'lead' }, 'こたえて、レベルを あげよう!'),
    statusCard(),
    h('section', { class: 'panel' },
      h('h2', {}, 'れんしゅうする はんい'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'れんしゅうする はんい' },
        Object.entries(RANGE_LABELS).map(([key, label]) =>
          h('button', {
            type: 'button', 'aria-pressed': String(range === key),
            onclick: () => { data.settings.range = key; persist(); showHome(); },
          }, label)))),
    h('section', { class: 'panel' },
      h('h2', {}, 'えんしゅつ'),
      h('div', { class: 'seg two', role: 'group', 'aria-label': 'えんしゅつ' },
        [['flashy', 'はで'], ['calm', 'ひかえめ']].map(([key, label]) =>
          h('button', {
            type: 'button', 'aria-pressed': String(data.settings.fx === key),
            onclick: () => { data.settings.fx = key; persist(); showHome(); },
          }, label))),
      osReduced() ? h('p', { class: 'muted', style: 'margin:8px 0 0;font-size:.8rem' }, 'この たんまつは「うごきを へらす」せっていなので、ひかえめで うごくよ') : null),
    h('nav', { class: 'menu' },
      menuItem('m1', 'ひょう', 'こたえを かくして おぼえる', showTable),
      menuItem('m2', 'フラッシュカード', 'めくって たしかめる', startFlash),
      menuItem('m3', '4たくクイズ', '10もん ・ えらぶ', () => startQuiz('choice')),
      menuItem('m4', '2タップ チャレンジ', 'てんの まえと あとを えらぶ', () => startQuiz('twotap')),
      menuItem('m5', 'ぎゃくびき', '「? × 3.14 = ◯」の ?', () => startQuiz('reverse')),
      menuItem('m6', 'タイムアタック', 'きほん 9もん ・ はやさ しょうぶ', () => startQuiz('time')),
      menuItem('m7', '🏆 じっせき', `${unlockedCount} / ${ACHIEVEMENTS.length} ゲット`, showAchievements),
      menuItem('m8', 'きろく', 'せいかい と ベストタイム', showRecords)));
}

// ---------- ひょう(暗記シート) ----------
function showTable() {
  const dans = dansForRange(data.settings.range);
  const hidden = new Set();
  const cells = new Map();

  function paint(n) {
    const c = cells.get(n);
    const isHidden = hidden.has(n);
    c.className = 'cell' + (isHidden ? ' hidden' : '');
    c.setAttribute('aria-pressed', String(isHidden));
    c.setAttribute('aria-label', isHidden ? `3.14×${n} のこたえ(かくれています)` : `3.14×${n} = ${answerText(n)}`);
    c.textContent = answerText(n);
  }

  const rows = [];
  let lastGroup = null;
  for (const n of dans) {
    const group = n <= 9 ? 'きほん (1〜9)' : 'はってん';
    if (group !== lastGroup && data.settings.range === 'both') {
      rows.push(h('tr', {}, h('td', { class: 'group-h', colspan: '2' }, group)));
    }
    lastGroup = group;
    const cell = h('button', {
      type: 'button',
      onclick: () => { hidden.has(n) ? hidden.delete(n) : hidden.add(n); paint(n); },
    });
    cells.set(n, cell);
    paint(n);
    rows.push(h('tr', {}, h('td', { class: 'q' }, questionText(n) + ' ='), h('td', { class: 'a' }, cell)));
  }

  const setAll = (hide) => { for (const n of dans) { hide ? hidden.add(n) : hidden.delete(n); paint(n); } };
  mount(
    topbar('ひょう'),
    h('div', { class: 'row2' },
      h('button', { type: 'button', class: 'primary', onclick: () => setAll(true) }, 'ぜんぶ かくす'),
      h('button', { type: 'button', onclick: () => setAll(false) }, 'ぜんぶ みせる')),
    h('p', { class: 'muted center' }, 'こたえを タップすると かくれたり あらわれたり するよ'),
    h('section', { class: 'panel' }, h('table', { class: 'list' }, h('tbody', {}, rows))));
}

// ---------- フラッシュカード(じぶんで さいてん。せいせきには いれない) ----------
function startFlash() {
  comboFx.stopAll();
  touchToday();
  const queue = buildQueue(dansForRange(data.settings.range), QUIZ_LENGTH, rng);
  session = { id: ++sessionSeq, mode: 'flash', queue, i: 0, correct: 0, xpGained: 0, bestCombo: 0, flipped: false };
  renderFlash();
}

function renderFlash() {
  const s = session;
  const n = s.queue[s.i];
  const card = h('button', {
    type: 'button', class: 'flash' + (s.flipped ? ' open' : ''),
    onclick: () => { s.flipped = !s.flipped; sound.tap(); renderFlash(); },
  }, questionText(n) + ' = ?',
  s.flipped ? h('span', {}, answerText(n)) : h('small', {}, 'タップして めくる'));
  const grade = (ok, ev) => {
    const where = centerOf(ev.currentTarget);
    if (ok) {
      const lb = lv().level;
      data.progress = addXp(data.progress, 3).progress;
      s.correct++; s.xpGained += 3;
      sound.correct(0);
      fx.confetti(where.x, where.y, 18, 0.9);
      fx.popup('+3', where.x, where.y - 20);
      settle(lb);
    } else {
      sound.tap();
    }
    s.i++; s.flipped = false;
    s.i >= s.queue.length ? endSession() : renderFlash();
  };
  mount(
    topbar('フラッシュカード', `${s.i + 1} / ${s.queue.length}`),
    progressBar(s),
    card,
    s.flipped
      ? h('div', { class: 'row2' },
        h('button', { type: 'button', class: 'primary', onclick: (e) => grade(true, e) }, '✔ おぼえた'),
        h('button', { type: 'button', onclick: (e) => grade(false, e) }, 'まだ'))
      : h('p', { class: 'muted center' }, 'こたえを おもいだしてから めくろう'));
}

function progressBar(s) {
  return h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { style: `width:${(s.i / s.queue.length) * 100}%` }));
}

// ---------- クイズ共通 ----------
function startQuiz(mode) {
  comboFx.stopAll();
  touchToday();
  const dans = mode === 'time' ? dansForRange('basic') : dansForRange(data.settings.range);
  const queue = buildQueue(dans, mode === 'time' ? 9 : QUIZ_LENGTH, rng);
  session = {
    id: ++sessionSeq, mode, queue, pool: dans, i: 0, correct: 0, combo: comboCarry, bestCombo: comboCarry, xpGained: 0,
    answered: false, advanced: false, last: null, current: null, qStart: 0, elapsed: 0,
    pickedInt: null, pickedFrac: null, shownRatio: lv().ratio, shownLevel: lv().level, bump: false,
  };
  prepareQuestion();
  renderQuiz();
  if (comboCarry >= 5) comboFx.sustain(effectsForMode(comboEffects(comboCarry), isCalm() ? 'calm' : 'flashy')); // つづきのコンボなら外周の光・フィーバーを再開
}

function prepareQuestion() {
  const s = session;
  const n = s.queue[s.i];
  s.answered = false; s.advanced = false; s.last = null;
  s.pickedInt = null; s.pickedFrac = null;
  s.current = { n };
  if (s.mode === 'choice') s.current.choices = makeChoices(n, rng, s.pool);
  if (s.mode === 'reverse') s.current.choices = makeReverseQuestion(n, rng, s.pool).choices;
  if (s.mode === 'twotap' || s.mode === 'time') {
    s.current.ints = makeIntChoices(n, rng, s.pool);
    s.current.fracs = makeFracChoices(n, rng, s.pool);
  }
  s.qStart = performance.now();
}

const isTwoTap = (s) => s.mode === 'twotap' || s.mode === 'time';

function currentElapsed() {
  const s = session;
  return s.elapsed + (s.answered ? 0 : performance.now() - s.qStart);
}

function tickTimer() {
  const el = document.getElementById('timer');
  if (el && session) el.textContent = formatTime(currentElapsed());
}

function hud(s) {
  const li = lv();
  const flames = flameCount(s.combo);
  const combo = h('div', { class: `combo heat${comboStage(s.combo)}${s.bump ? ' bump' : ''}`, 'aria-label': `${s.combo} れんぞく` },
    flames ? h('span', { class: 'fl', 'aria-hidden': 'true' }, '🔥'.repeat(flames)) : null,
    h('span', { class: 'cn' }, String(s.combo)),
    h('span', { class: 'cl' }, 'COMBO'));
  const startRatio = s.shownLevel === li.level ? s.shownRatio : 0;
  const fill = h('i', { style: `width:${startRatio * 100}%` });
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${li.ratio * 100}%`; }));
  s.shownRatio = li.ratio; s.shownLevel = li.level;
  return h('div', { class: 'hud' }, combo,
    h('div', { class: 'lvchip' }, `Lv ${li.level}`, h('div', { class: 'xpbar', 'aria-hidden': 'true' }, fill)));
}

function renderQuiz() {
  const s = session;
  const n = s.current.n;
  const isLast = s.i + 1 >= s.queue.length;
  const meta = s.mode === 'time' ? h('span', { class: 'timer', id: 'timer' }, formatTime(currentElapsed())) : `${s.i + 1} / ${s.queue.length}`;
  const nodes = [topbar(MODE_TITLES[s.mode], meta), progressBar(s), hud(s)];
  s.bump = false;
  if (s.mode === 'time') nodes.push(h('p', { class: 'muted center', style: 'margin:0;font-weight:800' }, `${s.i + 1} / ${s.queue.length} もんめ`));

  if (s.mode === 'reverse') {
    nodes.push(h('div', { class: 'question' }, h('small', {}, '? に はいる かずは?'), `? × 3.14 = ${answerText(n)}`));
  } else {
    nodes.push(h('div', { class: 'question' }, questionText(n) + ' = ?'));
  }

  if (s.mode === 'choice' || s.mode === 'reverse') {
    const rightText = s.mode === 'choice' ? answerText(n) : String(n);
    nodes.push(h('div', { class: 'choices' }, s.current.choices.map((c) => {
      const text = String(c);
      let cls = '';
      if (s.answered) {
        if (text === rightText) cls = 'right';
        else if (text === s.last.picked) cls = 'wrong';
        if (text === s.last.picked) cls += ' pop';
      }
      return h('button', { type: 'button', class: cls.trim(), disabled: s.answered, onclick: (e) => answerChoice(text, rightText, e.currentTarget) }, text);
    })));
  } else {
    nodes.push(...twoTapNodes(s, n));
  }

  if (s.answered) {
    nodes.push(feedbackBox(n));
    // 正解は自動で進むのでボタンなし。不正解は答えを読んでから押して進む。
    if (!s.last.ok) nodes.push(h('button', { type: 'button', class: 'primary wide', id: 'next', onclick: nextQuestion }, isLast ? 'けっかを みる' : 'つぎへ'));
  }
  mount(...nodes);
  if (s.mode === 'time' && !s.answered) timerId = setInterval(tickTimer, 100);
  if (s.answered && !s.last.ok) document.getElementById('next')?.focus({ preventScroll: true });
}

// ---------- 2タップ ----------
function fracLabel(f) { return f ? `.${f}` : 'なし(.0)'; }

function twoTapNodes(s, n) {
  const right = answerParts(n);
  const intChosen = s.pickedInt !== null;
  let text;
  if (s.answered) text = partsText({ int: s.pickedInt, frac: s.pickedFrac });
  else text = `${intChosen ? s.pickedInt : '□□'}.□□`;
  const dcls = s.answered ? (s.last.ok ? ' ok' : ' ng') : '';
  const stateOf = (isPicked, isRight, otherPicked = false) => {
    if (!s.answered) return isPicked ? 'sel' : otherPicked ? 'dim' : '';
    return `${isRight ? 'right' : isPicked ? 'wrong' : 'dim'}${isPicked ? ' pop' : ''}`;
  };
  return [
    h('div', { class: 'display' + dcls, id: 'display', role: 'status', 'aria-label': 'いまの こたえ' }, text),
    h('div', { class: 'tt-label' }, h('b', {}, '1'), 'てんの まえは?'),
    h('div', { class: 'ttrow choices-int' }, s.current.ints.map((v) =>
      h('button', {
        type: 'button', class: stateOf(s.pickedInt === v, v === right.int, intChosen), 'aria-pressed': String(s.pickedInt === v), disabled: s.answered,
        onclick: (e) => tapInt(v, e.currentTarget),
      }, String(v)))),
    h('div', { class: 'tt-label' }, h('b', {}, '2'), intChosen || s.answered ? 'てんの あとは?' : 'てんの あとは?(1を えらんでね)'),
    h('div', { class: 'ttrow choices-frac' + (intChosen || s.answered ? '' : ' locked') }, s.current.fracs.map((f) =>
      h('button', {
        type: 'button', class: stateOf(s.pickedFrac === f, f === right.frac) + (f ? '' : ' none'), disabled: s.answered || !intChosen,
        onclick: (e) => tapFrac(f, e.currentTarget),
      }, fracLabel(f)))),
  ];
}

function tapInt(v, el) {
  const s = session;
  if (!s || s.answered) return;
  s.pickedInt = v;
  sound.tap();
  renderQuiz();
  document.querySelectorAll('.choices-int button').forEach((b) => { if (b.textContent === String(v)) b.classList.add('pop'); });
  void el;
}

function tapFrac(f, el) {
  const s = session;
  if (!s || s.answered || s.pickedInt === null) return;
  s.pickedFrac = f;
  const where = centerOf(el);
  const ok = isCorrectTwoTap(s.current.n, s.pickedInt, f);
  finishAnswer(ok, where, partsText({ int: s.pickedInt, frac: f }));
}

function answerChoice(picked, rightText, el) {
  const s = session;
  if (!s || s.answered) return;
  finishAnswer(picked === rightText, centerOf(el), picked);
}

// ---------- 回答の確定: 記録・XP・演出 ----------
function finishAnswer(ok, where, picked) {
  const s = session;
  const n = s.current.n;
  const ms = performance.now() - s.qStart;
  s.answered = true;
  s.last = { ok, picked, xp: 0 };
  s.elapsed += ms;
  const prevCombo = s.combo;
  s.combo = ok ? s.combo + 1 : 0;
  s.bestCombo = Math.max(s.bestCombo, s.combo);
  comboCarry = s.combo;
  if (ok) s.correct++;
  s.bump = ok;

  const lb = lv().level;
  data.stats = recordAnswer(data.stats, n, ok);
  const r = applyAnswer(data.progress, { correct: ok, combo: s.combo, ms });
  data.progress = r.progress;
  s.last.xp = r.xp.total;
  s.xpGained += r.xp.total;
  settle(lb); // 実績・レベルアップ・クリア(保存もここ)

  renderQuiz();
  celebrate(ok, r.xp, where, prevCombo);
  if (ok) {
    const tok = s.id;
    advanceTimer = setTimeout(() => {
      advanceTimer = null;
      fx.whenIdle(() => { if (session && session.id === tok) nextQuestion(); });
    }, ADVANCE_MS);
  }
}

function celebrate(ok, xp, where, prevCombo) {
  const s = session;
  if (!ok) {
    sound.wrong();
    comboFx.stopFever();
    comboFx.setRim(null);
    fx.popup('どんまい!', where.x, where.y - 10, 'bad');
    const br = comboBreak(prevCombo, s.bestCombo);
    if (br) comboFx.breakGlass(br, where); // 3 以上から切れたら「コンボ ストップ…」のガラス割れ
    else comboFx.miss();
    return;
  }
  fx.popup(`+${xp.total}`, where.x, where.y - 10);
  if (xp.speedBonus) fx.popup(`⚡ はやい! +${xp.speedBonus}`, where.x, where.y + 28, 'xp2');
  // どの演出を出すかは combo.js の設計表で決まる(ひかえめのときは文字カットインだけ)
  comboFx.play(effectsForMode(comboEffects(s.combo), isCalm() ? 'calm' : 'flashy'), where);
}

function feedbackBox(n) {
  const s = session;
  const ok = s.last.ok;
  const ansLine = s.mode === 'reverse' ? `こたえは ${n}  (${questionText(n)} = ${answerText(n)})` : `${questionText(n)} = ${answerText(n)}`;
  return h('div', { class: 'feedback ' + (ok ? 'ok' : 'ng'), role: 'status' },
    ok ? `✔ せいかい! ${s.combo >= 2 ? `${s.combo}れんぞく!` : ''}` : '✘ おしい! つぎは いけるよ!',
    h('div', { class: 'ans' }, ansLine),
    ok ? h('div', { class: 'gain' }, `+${s.last.xp} XP`) : null);
}

function nextQuestion() {
  const s = session;
  if (!s || !s.answered || s.advanced) return;
  s.advanced = true;
  clearAdvance();
  s.i++;
  if (s.i >= s.queue.length) { endSession(); return; }
  prepareQuestion();
  renderQuiz();
}

// ---------- けっか ----------
function endSession() {
  const s = session;
  const total = s.queue.length;
  const lb = lv().level;
  data.progress = finishSession(data.progress, { mode: s.mode, total, correct: s.correct });
  let timeInfo = null;
  if (s.mode === 'time' && s.correct === total) {
    const r = updateBestTime(data.records, TIME_ATTACK_KEY, s.elapsed);
    data.records = r.records;
    timeInfo = r.result;
  }
  settle(lb);
  showResult(s, timeInfo);
}

function showResult(s, timeInfo) {
  comboFx.stopAll();
  const total = s.queue.length;
  const again = () => (s.mode === 'flash' ? startFlash() : startQuiz(s.mode));
  const nodes = [topbar('けっか')];
  const perfect = s.correct === total;

  if (s.mode === 'time') {
    let line;
    if (!perfect) line = 'ぜんぶ せいかいで ベストタイムに のるよ';
    else line = timeInfo?.isBest ? '🎉 ベストタイム こうしん!' : `ベストタイムは ${formatTime(bestTime(data.records, TIME_ATTACK_KEY))}`;
    nodes.push(h('section', { class: 'panel center' },
      h('p', { class: 'muted' }, 'タイム'),
      h('div', { class: 'big timer' }, formatTime(s.elapsed)),
      h('p', {}, `せいかい ${s.correct} / ${total}`),
      h('p', { class: 'muted' }, line)));
  } else {
    const msg = perfect ? 'ぜんぶ せいかい! てんさい!' : s.correct >= total * 0.7 ? 'よくできました!' : 'もういちど やってみよう';
    nodes.push(h('section', { class: 'panel center' },
      h('div', { class: 'big' }, `${s.correct} / ${total}`),
      h('p', {}, s.mode === 'flash' ? 'おぼえた かず' : 'せいかい'),
      h('p', { class: 'muted' }, msg)));
  }
  nodes.push(h('section', { class: 'panel center' },
    h('p', { style: 'margin:0;font-weight:900' }, `かくとく +${s.xpGained} XP`),
    s.bestCombo >= 2 ? h('p', { style: 'margin:0' }, `🔥 さいこう ${s.bestCombo} れんぞく`) : null,
    h('p', { class: 'muted', style: 'margin:0' }, `Lv ${lv().level} ・ つぎの レベルまで あと ${lv().need - lv().into} XP`)));
  nodes.push(
    h('button', { type: 'button', class: 'primary wide', style: 'margin-bottom:14px', onclick: again }, 'もういちど'),
    h('button', { type: 'button', class: 'wide', onclick: showHome }, 'ホームへ'));
  mount(...nodes);
  session = null;
  if (perfect) { fx.confetti(window.innerWidth / 2, window.innerHeight * 0.3, 120, 1.3); sound.combo(3); }
}

// ---------- じっせき ----------
function showAchievements() {
  const p = data.progress;
  const total = ACHIEVEMENTS.length;
  const got = Object.keys(p.unlocked).length;
  const m = masterCount();
  const cleared = p.cleared !== null;

  const card = (a) => {
    const unlocked = p.unlocked[a.id] !== undefined;
    const st = achievementStatus(a, p, data.stats, data.records);
    const secret = a.hidden && !unlocked;
    return h('div', { class: `ach r-${a.rarity} ${unlocked ? 'done' : 'locked'}`, id: `ach-${a.id}` },
      h('div', { class: 'icon', 'aria-hidden': 'true' }, secret ? '❓' : a.icon),
      h('div', {},
        h('div', { class: 'nm' }, secret ? '???' : a.name, h('span', { class: 'rar' }, RARITY_LABELS[a.rarity])),
        h('div', { class: 'ds' }, unlocked ? `✔ ${a.desc}` : a.hint),
        !unlocked && st.max > 1 && !secret
          ? h('div', { class: 'pg' }, h('div', { class: 'mini-progress' }, h('i', { style: `width:${(st.cur / st.max) * 100}%` })), `${st.cur}/${st.max}`)
          : null));
  };

  mount(
    topbar('じっせき'),
    h('section', { class: 'panel ach-summary' },
      h('div', { class: 'big', id: 'ach-count' }, `${got} / ${total}`),
      h('p', { class: 'muted', style: 'margin:0' }, 'ゲットした じっせき')),
    h('section', { class: 'panel crownbox' },
      h('div', { class: 'crown' }, cleared ? '🏆' : '👑'),
      h('h2', {}, cleared ? 'えんしゅうりつ マスター クリア!' : 'クリアの じょうけん'),
      h('p', { class: 'muted', style: 'margin:0' }, `19この だんを ぜんぶ マスター (マスター段 ${m}/19)`),
      h('p', { class: 'muted', style: 'margin:0' }, 'マスター = その だんで 5かい せいかい、 せいかいりつ 80% いじょう'),
      h('p', { class: 'muted', style: 'margin:0' }, `タイムアタック ${CLEAR_TIME_MS / 1000}びょうぎり ${isTimeCleared(data.records) ? '✔' : '(まだ)'}`),
      cleared ? h('button', { type: 'button', class: 'primary', style: 'margin-top:10px', onclick: showEnding }, 'エンディングを もういちど') : null),
    h('div', { class: 'ach-list' }, ACHIEVEMENTS.map(card)));
}

// ---------- きろく ----------
function showRecords() {
  const dans = dansForRange('both');
  const stats = data.stats;
  const best = bestTime(data.records, TIME_ATTACK_KEY);

  const rows = dans.map((n) => {
    const d = stats.byDan[n];
    const acc = accuracy(stats, n);
    const mastered = isMastered(d);
    return h('tr', { class: mastered ? 'mastered' : '' },
      h('td', { class: 'q' }, `× ${n}`),
      h('td', {}, d ? `${d.correct} / ${d.total}` : '—'),
      h('td', {}, acc === null ? '—' : h('span', {}, h('span', { class: 'bar', style: `width:${Math.round(acc * 40)}px` }), ` ${Math.round(acc * 100)}%`)),
      h('td', { class: 'mst' }, mastered ? '★マスター' : ''));
  });

  const mistakes = stats.recentMistakes.slice(0, 10);
  mount(
    topbar('きろく'),
    h('section', { class: 'panel' },
      h('h2', {}, 'タイムアタック ベスト'),
      h('p', { class: 'big', id: 'best' }, best ? formatTime(best) : 'まだ きろくなし')),
    h('section', { class: 'panel' },
      h('h2', {}, `だんごとの せいせき (マスター ${masterCount()}/19)`),
      h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}, 'だん'), h('th', {}, 'せいかい'), h('th', {}, 'せいかい りつ'), h('th', {}, ''))),
        h('tbody', {}, rows))),
    h('section', { class: 'panel' },
      h('h2', {}, 'さいきん まちがえた もんだい'),
      mistakes.length
        ? h('div', { class: 'chips' }, mistakes.map((m) => h('span', { class: 'chip' }, questionText(m.n))))
        : h('p', { class: 'muted' }, 'まちがいは ありません')),
    h('button', { type: 'button', class: 'wide danger', id: 'reset', onclick: resetRecords }, 'きろくを ぜんぶ けす'));
}

function resetRecords() {
  if (!window.confirm('きろくを ぜんぶ けします。レベルや じっせきも きえて、もとに もどせません。いいですか?')) return;
  data = store.reset();
  showRecords();
}

showHome();
