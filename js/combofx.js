// コンボ演出の実行(シェイク・フラッシュ・スラム・カットイン・外周の光・フィーバー・ガラス割れ)。
// 何を出すかは combo.js の comboEffects が決める。ここは「出す」だけ。
// 作った DOM ノードとタイマーはすべて記録し、終わったら必ず掃除する(stopAll で全部消せる)。
import { allowFlash, recordFlash, TINT_DELAY_MS } from './combo.js';

const RAINBOW = 'linear-gradient(135deg, rgba(255,90,220,.5), rgba(255,230,60,.5), rgba(80,230,140,.5), rgba(60,210,255,.5), rgba(160,100,255,.5))';
const SHARD_CLIPS = [
  'polygon(0 0, 100% 8%, 82% 100%, 6% 88%)',
  'polygon(10% 0, 100% 0, 92% 92%, 0 100%)',
  'polygon(0 12%, 90% 0, 100% 100%, 14% 90%)',
  'polygon(6% 6%, 96% 0, 88% 100%, 0 94%)',
];

export function createComboFx({ fx, sound, isCalm }) {
  const timers = new Set();
  const nodes = new Set();
  let flashHistory = [];
  let rimEl = null;
  let feverBg = null;
  let feverTimer = null;
  let feverOn = false;
  let shakeCls = '';
  const maskOk = !!(window.CSS?.supports?.('mask-composite', 'exclude') || window.CSS?.supports?.('-webkit-mask-composite', 'xor'));

  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const el = (cls, text) => {
    const e = document.createElement('div');
    e.className = cls;
    e.setAttribute('aria-hidden', 'true');
    if (text != null) e.textContent = text;
    return e;
  };
  /** body に置いて ms 後に必ず消す。 */
  function layer(node, ms) {
    document.body.append(node);
    nodes.add(node);
    later(() => { node.remove(); nodes.delete(node); }, ms);
    return node;
  }

  // ---------- シェイク・ズーム ----------
  function shake(kind, zoom) {
    const app = document.getElementById('app');
    if (!app) return;
    for (const c of ['fxs-small', 'fxs-medium', 'fxs-strong', 'fxs-huge', 'fxz']) app.classList.remove(c);
    void app.offsetWidth;
    shakeCls = [kind !== 'none' ? `fxs-${kind}` : '', zoom ? 'fxz' : ''].filter(Boolean).join(' ');
    if (shakeCls) app.classList.add(...shakeCls.split(' '));
    later(clearShake, kind === 'huge' ? 700 : 480);
  }
  function clearShake() {
    const app = document.getElementById('app');
    if (app) for (const c of ['fxs-small', 'fxs-medium', 'fxs-strong', 'fxs-huge', 'fxz']) app.classList.remove(c);
  }

  // ---------- フラッシュ(頻度制限つき) ----------
  function fullFlash(cls, background, ms) {
    const now = performance.now();
    if (!allowFlash(flashHistory, now)) return false;
    flashHistory = recordFlash(flashHistory, now);
    const f = el(cls);
    f.style.background = background;
    layer(f, ms);
    return true;
  }

  // ---------- 文字・カットイン ----------
  function slam(label, afterimage) {
    layer(el(`fx-slam${afterimage ? ' ghosty' : ''}`, label), 850);
  }
  function textCut(text, sub, ms = 800) {
    const t = el('fx-ctext', text);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; t.append(s); }
    layer(t, ms);
  }
  function band(e) {
    const wrap = el('fx-band-wrap');
    if (e.speedLines) wrap.append(el('fx-speed'));
    const b = el('fx-band');
    const bt = document.createElement('span'); bt.className = 'bt'; bt.textContent = e.cutText;
    const bl = document.createElement('span'); bl.className = 'bl'; bl.textContent = e.label;
    b.append(bt, bl);
    wrap.append(b);
    layer(wrap, 850);
  }
  function fullNode(e, ms) {
    const root = el(`fx-full ${e.fever ? 'fever' : ''}`);
    root.style.setProperty('--d', `${ms}ms`);
    root.append(el('dim'));
    if (e.sunburst) { const w = el('sb-wrap'); w.append(el('sunburst')); root.append(w); }
    if (e.speedLines) root.append(el('fx-speed'));
    const a = el('band a'); const b = el('band b');
    for (const x of [a, b]) { x.append(el('stripe')); root.append(x); }
    root.append(el('lab', 'COMBO'));
    root.append(el(`num${e.afterimage ? ' ghosty' : ''}`, String(e.combo)));
    root.append(el(`txt${e.afterimage ? ' ghosty' : ''}`, e.cutText));
    return root;
  }
  function fullCut(e) { layer(fullNode(e, e.durationMs), e.durationMs + 80); }
  /** キリ番: 最大 2 秒。タップでスキップ。overlay キューに載せるので、終わるまで自動送りは待つ。 */
  function bigCut(e) {
    fx.overlay({
      cls: 'fx-bigcut',
      autoMs: e.durationMs,
      dismissible: true,
      build: () => {
        const root = fullNode(e, e.durationMs);
        root.classList.add('big');
        const hint = document.createElement('div');
        hint.className = 'skiphint';
        hint.textContent = 'タップで スキップ';
        root.append(hint);
        return root;
      },
      onOpen: () => {
        for (const [x, y] of [[0.2, 0.75], [0.8, 0.75], [0.5, 0.9]]) fx.confetti(window.innerWidth * x, window.innerHeight * y, 80, 1.5);
      },
    });
  }

  // ---------- 外周の光(コンボ 5 以上、切れるまで続く) ----------
  function setRim(kind) {
    const want = kind === 'rainbow' && !maskOk ? 'glow' : kind;
    if (!want) { if (rimEl) { rimEl.remove(); nodes.delete(rimEl); rimEl = null; } return; }
    if (rimEl && rimEl.dataset.kind === want) return;
    if (rimEl) { rimEl.remove(); nodes.delete(rimEl); }
    rimEl = el(`fx-rim ${want}`);
    rimEl.dataset.kind = want;
    if (want === 'rainbow') rimEl.append(el('spin'));
    document.body.append(rimEl);
    nodes.add(rimEl);
  }

  // ---------- フィーバー(コンボ 20 以上: 虹の背景・パーティクル。ビートは BGM のフィーバーレイヤーが鳴らす) ----------
  function startFever() {
    if (feverOn) return;
    feverOn = true;
    feverBg = el('fx-fever-bg');
    feverBg.append(el('wave'));
    document.body.append(feverBg);
    nodes.add(feverBg);
    feverTimer = setInterval(() => {
      if (!feverOn) return;
      fx.confetti(Math.random() * window.innerWidth, window.innerHeight * (0.55 + Math.random() * 0.4), 5, 0.9);
    }, 320);
  }
  function stopFever() {
    if (!feverOn && !feverBg) return;
    feverOn = false;
    if (feverTimer !== null) { clearInterval(feverTimer); feverTimer = null; }
    if (feverBg) { feverBg.remove(); nodes.delete(feverBg); feverBg = null; }
  }

  // ---------- 1問ぶんの演出 ----------
  /** effects は effectsForMode 済みのもの。where は押したボタンの中心(画面座標)。 */
  function play(e, where) {
    sound.comboHit(e.sound, e.combo);
    if (e.slam) sound.thump();
    if (e.shake !== 'none' || e.zoom) shake(e.shake, e.zoom);
    if (e.confetti) {
      fx.confetti(where.x, where.y, e.confetti, 1 + e.stage * 0.1);
      if (e.stage >= 3) {
        fx.confetti(window.innerWidth * 0.12, window.innerHeight * 0.8, Math.round(e.confetti / 3), 1.3);
        fx.confetti(window.innerWidth * 0.88, window.innerHeight * 0.8, Math.round(e.confetti / 3), 1.3);
      }
    }
    if (e.flash) fullFlash('fx-flash', e.flash.kind === 'rainbow' ? RAINBOW : e.flash.color, 320);
    if (e.tint) later(() => fullFlash('fx-tint', e.tint, 680), TINT_DELAY_MS);
    if (e.slam) slam(e.label, e.afterimage);
    if (e.cutin === 'text') textCut(e.cutText);
    else if (e.cutin === 'band') band(e);
    else if (e.cutin === 'full' || e.cutin === 'fever') (e.big ? bigCut : fullCut)(e);
    sustain(e);
  }

  /** 外周の光・フィーバーなど、コンボが続くあいだ出しっぱなしの演出。 */
  function sustain(e) {
    setRim(e.rim);
    if (e.ambient) startFever(); else stopFever();
  }

  // ---------- 不正解(コンボ 3 未満)・コンボ切れ ----------
  /** 軽いシェイクだけ(ひかえめでは何も動かさない)。 */
  function miss() {
    if (!isCalm()) shake('small', false);
  }

  /** コンボ 3 以上から切れたとき: ガラスが割れて「コンボ ストップ…」+ 最高コンボ。 */
  function breakGlass(br, where) {
    setRim(null);
    stopFever();
    if (isCalm()) { textCut(br.text, br.sub, 1600); return; }
    shake('medium', false);
    sound.glass();
    const root = el('fx-glass');
    const cols = 4; const rows = 6;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = el('shard');
        s.style.gridColumn = String(c + 1);
        s.style.gridRow = String(r + 1);
        s.style.clipPath = SHARD_CLIPS[(r * cols + c) % SHARD_CLIPS.length];
        s.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 120)}px`);
        s.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 140)}deg`);
        s.style.setProperty('--dl', `${Math.round(Math.random() * 260)}ms`);
        root.append(s);
      }
    }
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'crack');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const cx = (where.x / window.innerWidth) * 100; const cy = (where.y / window.innerHeight) * 100;
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + Math.random() * 0.4;
      const len = 30 + Math.random() * 50;
      const l = document.createElementNS(NS, 'polyline');
      l.setAttribute('points', `${cx},${cy} ${cx + Math.cos(a) * len * 0.5 + (Math.random() - 0.5) * 6},${cy + Math.sin(a) * len * 0.5 + (Math.random() - 0.5) * 6} ${cx + Math.cos(a) * len},${cy + Math.sin(a) * len}`);
      svg.append(l);
    }
    root.append(svg);
    const tx = el('gtext', br.text);
    const sub = document.createElement('small'); sub.textContent = br.sub;
    tx.append(sub);
    root.append(tx);
    layer(root, 1500);
  }

  /** 画面から出ているコンボ演出をすべて消し、タイマーも止める(画面遷移・セッション終了時)。 */
  function stopAll() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const n of nodes) n.remove();
    nodes.clear();
    rimEl = null; feverBg = null;
    if (feverTimer !== null) { clearInterval(feverTimer); feverTimer = null; }
    feverOn = false;
    clearShake();
  }

  return {
    play, sustain, miss, breakGlass, setRim, stopFever, stopAll,
    /** 計測用: 残っている演出ノード数・タイマー数。 */
    stats: () => ({ nodes: nodes.size, timers: timers.size, fever: feverOn }),
  };
}
