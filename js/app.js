// 画面とDOM。計算・判定・出題は logic.js、保存は storage.js に任せる。
import {
  dansForRange, answerText, questionText, isCorrectInput,
  makeChoices, makeReverseQuestion, buildQueue, buildWeakQueue,
  recordAnswer, accuracy, weakDans, bestTime, updateBestTime,
} from './logic.js';
import { createStorage } from './storage.js';

const rng = Math.random;
const app = document.getElementById('app');

let ls = null;
try { ls = window.localStorage; } catch { ls = null; }
const store = createStorage(ls);
let data = store.load();

const RANGE_LABELS = { basic: 'きほんだけ', both: 'きほん＋はってん', advanced: 'はってんだけ' };
const QUIZ_LENGTH = 10;
const TIME_ATTACK_KEY = 'time-attack';

let session = null;
let timerId = null;

// ---------- 小さな DOM ヘルパー ----------
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

function mount(...nodes) {
  stopTimer();
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function stopTimer() {
  if (timerId !== null) { clearInterval(timerId); timerId = null; }
}

function persist() { store.save(data); }

function formatTime(ms) {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}びょう`;
  const m = Math.floor(sec / 60);
  return `${m}ふん ${(sec - m * 60).toFixed(1)}びょう`;
}

function topbar(title, meta) {
  return h('div', { class: 'topbar' },
    h('button', { type: 'button', onclick: () => { session = null; showHome(); }, 'aria-label': 'ホームにもどる' }, '← もどる'),
    h('span', { class: 'title' }, title),
    h('span', { class: 'meta' }, meta ?? ''));
}

// ---------- ホーム ----------
function showHome() {
  session = null;
  const range = data.settings.range;
  const dans = dansForRange(range);
  const weak = weakDans(data.stats, dans);

  const menuItem = (cls, title, desc, onclick) =>
    h('button', { type: 'button', class: cls, onclick }, h('span', { class: 't' }, title), h('span', { class: 'd' }, desc));

  mount(
    h('h1', {}, '3.14 の かけざん'),
    h('p', { class: 'lead' }, 'まいにち すこしずつ おぼえよう'),
    h('section', { class: 'panel' },
      h('h2', {}, 'れんしゅうする はんい'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'れんしゅうする はんい' },
        Object.entries(RANGE_LABELS).map(([key, label]) =>
          h('button', {
            type: 'button', 'aria-pressed': String(range === key),
            onclick: () => { data.settings.range = key; persist(); showHome(); },
          }, label)))),
    h('nav', { class: 'menu' },
      menuItem('', 'ひょう', 'こたえを かくして おぼえる', showTable),
      menuItem('', 'フラッシュカード', 'めくって たしかめる', startFlash),
      menuItem('', '4たくクイズ', '10もん・えらぶ', () => startQuiz('choice')),
      menuItem('', 'にゅうりょくクイズ', '10もん・じぶんで うつ', () => startQuiz('input')),
      menuItem('', 'ぎゃくびき', '「? × 3.14 = ◯」の ? をえらぶ', () => startQuiz('reverse')),
      menuItem('', 'タイムアタック', 'きほん 9もん・はやさに ちょうせん', () => startQuiz('time')),
      menuItem('weak', 'にがて れんしゅう',
        weak.length ? `まちがえやすい だん: ${weak.map((n) => '×' + n).join(' ')}` : 'まちがえると ここに でてくるよ',
        startWeak),
      menuItem('', 'きろく', 'せいかいの かず・ベストタイム', showRecords)));
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

// ---------- フラッシュカード ----------
function startFlash() {
  const queue = buildQueue(dansForRange(data.settings.range), QUIZ_LENGTH, rng);
  session = { mode: 'flash', queue, i: 0, correct: 0, flipped: false };
  renderFlash();
}

function renderFlash() {
  const s = session;
  const n = s.queue[s.i];
  const card = h('button', {
    type: 'button', class: 'flash' + (s.flipped ? ' open' : ''),
    onclick: () => { s.flipped = !s.flipped; renderFlash(); },
  }, questionText(n) + ' = ?',
  s.flipped ? h('span', {}, answerText(n)) : h('small', {}, 'タップして めくる'));
  const grade = (ok) => {
    data.stats = recordAnswer(data.stats, n, ok);
    persist();
    if (ok) s.correct++;
    s.i++; s.flipped = false;
    s.i >= s.queue.length ? showResult() : renderFlash();
  };
  mount(
    topbar('フラッシュカード', `${s.i + 1} / ${s.queue.length}`),
    progress(s),
    card,
    s.flipped
      ? h('div', { class: 'row2' },
        h('button', { type: 'button', class: 'primary', onclick: () => grade(true) }, '✔ おぼえた'),
        h('button', { type: 'button', onclick: () => grade(false) }, 'まだ'))
      : h('p', { class: 'muted center' }, 'こたえを おもいだしてから めくろう'));
}

function progress(s) {
  return h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { style: `width:${(s.i / s.queue.length) * 100}%` }));
}

// ---------- クイズ共通 ----------
function startQuiz(mode) {
  const dans = mode === 'time' ? dansForRange('basic') : dansForRange(data.settings.range);
  const queue = buildQueue(dans, mode === 'time' ? 9 : QUIZ_LENGTH, rng);
  beginSession(mode, queue, dans);
}

function startWeak() {
  const dans = dansForRange(data.settings.range);
  const queue = buildWeakQueue(data.stats, dans, QUIZ_LENGTH, rng);
  if (queue.length === 0) {
    mount(
      topbar('にがて れんしゅう'),
      h('section', { class: 'panel center' },
        h('h2', {}, 'まだ にがてな だんは ないよ'),
        h('p', { class: 'muted' }, 'クイズで まちがえた だんが ここで れんしゅうできるよ。'),
        h('button', { type: 'button', class: 'primary wide', onclick: showHome }, 'ホームへ')));
    return;
  }
  beginSession('input', queue, dans, { weak: true });
}

function beginSession(mode, queue, pool, extra = {}) {
  session = { mode, queue, pool, i: 0, correct: 0, mistakes: 0, input: '', answered: false, last: null, current: null, segStart: null, elapsed: 0, ...extra };
  prepareQuestion();
  if (mode === 'time') session.segStart = performance.now();
  renderQuiz();
}

function prepareQuestion() {
  const s = session;
  const n = s.queue[s.i];
  s.input = ''; s.answered = false; s.last = null;
  s.current = { n };
  if (s.mode === 'choice') s.current.choices = makeChoices(n, rng, s.pool);
  if (s.mode === 'reverse') s.current.choices = makeReverseQuestion(n, rng, s.pool).choices;
}

function quizTitle() {
  const s = session;
  if (s.weak) return 'にがて れんしゅう';
  return { choice: '4たくクイズ', input: 'にゅうりょくクイズ', reverse: 'ぎゃくびき', time: 'タイムアタック' }[s.mode];
}

function renderQuiz() {
  const s = session;
  const n = s.current.n;
  const isLast = s.i + 1 >= s.queue.length;
  const meta = s.mode === 'time' ? h('span', { class: 'timer', id: 'timer' }, formatTime(currentElapsed())) : `${s.i + 1} / ${s.queue.length}`;
  const nodes = [topbar(quizTitle(), meta), progress(s)];
  if (s.mode === 'time') nodes.push(h('p', { class: 'muted center', style: 'margin:0' }, `${s.i + 1} / ${s.queue.length} もんめ`));

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
      }
      return h('button', { type: 'button', class: cls, disabled: s.answered, onclick: () => answerChoice(text, rightText) }, text);
    })));
  } else {
    const cls = s.answered ? (s.last.ok ? ' ok' : ' ng') : '';
    nodes.push(h('div', { class: 'display' + cls, id: 'display', 'aria-label': 'にゅうりょくした こたえ' },
      s.input ? s.input : h('span', { class: 'ph' }, 'こたえを うってね')));
    if (!s.answered) nodes.push(keypad());
  }

  if (s.answered) {
    nodes.push(feedbackBox(n));
    nodes.push(h('button', { type: 'button', class: 'primary wide', id: 'next', onclick: nextQuestion },
      isLast ? 'けっかを みる' : 'つぎへ'));
  }
  mount(...nodes);
  if (s.mode === 'time' && !s.answered) {
    timerId = setInterval(tickTimer, 100);
  }
  if (s.answered) document.getElementById('next')?.focus({ preventScroll: true });
}

function feedbackBox(n) {
  const ok = session.last.ok;
  return h('div', { class: 'feedback ' + (ok ? 'ok' : 'ng'), role: 'status' },
    ok ? '✔ せいかい!' : '✘ ざんねん…',
    h('div', { class: 'ans' }, session.mode === 'reverse' ? `こたえは ${n}  (${questionText(n)} = ${answerText(n)})` : `${questionText(n)} = ${answerText(n)}`));
}

function currentElapsed() {
  const s = session;
  if (s.segStart === null) return 0;
  return s.answered ? s.elapsed : s.elapsed + (performance.now() - s.segStart);
}

function tickTimer() {
  const el = document.getElementById('timer');
  if (el && session) el.textContent = formatTime(currentElapsed());
}

function recordResult(n, ok) {
  data.stats = recordAnswer(data.stats, n, ok);
  persist();
  const s = session;
  if (ok) s.correct++; else s.mistakes++;
}

function answerChoice(picked, rightText) {
  const s = session;
  if (s.answered) return;
  const ok = picked === rightText;
  s.answered = true;
  s.last = { ok, picked };
  recordResult(s.current.n, ok);
  renderQuiz();
}

function submitInput() {
  const s = session;
  if (s.answered || !s.input) return;
  const ok = isCorrectInput(s.current.n, s.input);
  s.answered = true;
  s.last = { ok, picked: s.input };
  if (s.mode === 'time') s.elapsed += performance.now() - s.segStart; // 結果表示中は止める
  recordResult(s.current.n, ok);
  renderQuiz();
}

function nextQuestion() {
  const s = session;
  s.i++;
  if (s.i >= s.queue.length) { showResult(); return; }
  prepareQuestion();
  if (s.mode === 'time') s.segStart = performance.now();
  renderQuiz();
}

// ---------- テンキー ----------
function pressKey(k) {
  const s = session;
  if (!s || s.answered || !['input', 'time'].includes(s.mode)) return;
  if (k === 'del') s.input = s.input.slice(0, -1);
  else if (k === 'submit') { submitInput(); return; }
  else if (k === '.') { if (!s.input.includes('.') && s.input.length < 7) s.input += s.input ? '.' : '0.'; }
  else if (s.input.length < 7) s.input += k;
  const d = document.getElementById('display');
  if (d) d.replaceChildren(s.input ? document.createTextNode(s.input) : h('span', { class: 'ph' }, 'こたえを うってね'));
}

function keypad() {
  const key = (label, k, cls = '') => h('button', { type: 'button', class: cls, onclick: () => pressKey(k), 'aria-label': k === 'del' ? 'ひとつけす' : undefined }, label);
  return h('div', { class: 'keypad' },
    ['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((d) => key(d, d)),
    key('.', '.'), key('0', '0'), key('けす', 'del', 'del'),
    key('こたえる', 'submit', 'primary submit'));
}

document.addEventListener('keydown', (e) => {
  const s = session;
  if (!s || e.metaKey || e.ctrlKey || e.altKey) return;
  if (s.answered && e.key === 'Enter' && ['choice', 'reverse', 'input', 'time'].includes(s.mode)) {
    // フォーカス中のボタンの click と二重にならないよう、ここでは何もしない
    return;
  }
  if (!['input', 'time'].includes(s.mode) || s.answered) return;
  if (/^[0-9.]$/.test(e.key)) pressKey(e.key);
  else if (e.key === 'Backspace') pressKey('del');
  else if (e.key === 'Enter') { e.preventDefault(); pressKey('submit'); }
});

// ---------- けっか ----------
function showResult() {
  const s = session;
  const total = s.queue.length;
  const again = () => (s.mode === 'flash' ? startFlash() : s.weak ? startWeak() : startQuiz(s.mode));
  const nodes = [topbar('けっか')];

  if (s.mode === 'time') {
    const ms = s.elapsed;
    const allCorrect = s.correct === total;
    let line;
    if (!allCorrect) line = 'ぜんぶ せいかいで ベストタイムに のるよ';
    else {
      const { records, result } = updateBestTime(data.records, TIME_ATTACK_KEY, ms);
      data.records = records; persist();
      line = result.isBest ? '🎉 ベストタイム こうしん!' : `ベストタイムは ${formatTime(bestTime(data.records, TIME_ATTACK_KEY))}`;
    }
    nodes.push(
      h('section', { class: 'panel center' },
        h('p', { class: 'muted' }, 'タイム'),
        h('div', { class: 'big timer' }, formatTime(ms)),
        h('p', {}, `せいかい ${s.correct} / ${total}`),
        h('p', { class: 'muted' }, line)));
  } else {
    const msg = s.correct === total ? 'ぜんぶ せいかい! すごい!' : s.correct >= total * 0.7 ? 'よくできました!' : 'もういちど やってみよう';
    nodes.push(
      h('section', { class: 'panel center' },
        h('div', { class: 'big' }, `${s.correct} / ${total}`),
        h('p', {}, s.mode === 'flash' ? 'おぼえた かず' : 'せいかい'),
        h('p', { class: 'muted' }, msg)));
  }
  nodes.push(
    h('button', { type: 'button', class: 'primary wide', style: 'margin-bottom:12px', onclick: again }, 'もういちど'),
    h('button', { type: 'button', class: 'wide', onclick: showHome }, 'ホームへ'));
  mount(...nodes);
  session = { ...s, finished: true };
}

// ---------- きろく ----------
function showRecords() {
  const dans = dansForRange('both');
  const stats = data.stats;
  const weak = new Set(weakDans(stats, dans));
  const best = bestTime(data.records, TIME_ATTACK_KEY);

  const rows = dans.map((n) => {
    const d = stats.byDan[n];
    const acc = accuracy(stats, n);
    return h('tr', { class: weak.has(n) ? 'stat-weak' : '' },
      h('td', { class: 'q' }, `× ${n}`),
      h('td', {}, d ? `${d.correct} / ${d.total}` : '—'),
      h('td', {}, acc === null ? '—' : h('span', {}, h('span', { class: 'bar', style: `width:${Math.round(acc * 60)}px` }), ` ${Math.round(acc * 100)}%`)),
      h('td', {}, weak.has(n) ? 'にがて' : ''));
  });

  const mistakes = stats.recentMistakes.slice(0, 10);
  mount(
    topbar('きろく'),
    h('section', { class: 'panel' },
      h('h2', {}, 'タイムアタック ベスト'),
      h('p', { class: 'big', id: 'best' }, best ? formatTime(best) : 'まだ きろくなし')),
    h('section', { class: 'panel' },
      h('h2', {}, 'だんごとの せいせき'),
      h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}, 'だん'), h('th', {}, 'せいかい / もんだい'), h('th', {}, 'せいかいりつ'), h('th', {}, ''))),
        h('tbody', {}, rows))),
    h('section', { class: 'panel' },
      h('h2', {}, 'さいきん まちがえた もんだい'),
      mistakes.length
        ? h('div', { class: 'chips' }, mistakes.map((m) => h('span', { class: 'chip' }, questionText(m.n))))
        : h('p', { class: 'muted' }, 'まちがいは ありません')),
    h('button', { type: 'button', class: 'wide danger', id: 'reset', onclick: resetRecords }, 'きろくを ぜんぶ けす'));
}

function resetRecords() {
  if (!window.confirm('きろくを ぜんぶ けします。もとに もどせません。いいですか?')) return;
  data = store.reset();
  showRecords();
}

showHome();
