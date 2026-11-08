// 画面演出: 紙吹雪(canvas)・フラッシュ・シェイク・ポップアップ・バナー・トースト・全画面オーバーレイ。
// 外部ライブラリなし。prefers-reduced-motion のときは動きを弱める(フラッシュ・シェイクなし、紙吹雪は少なめ)。
const COLORS = ['#ff3d81', '#ffd400', '#2ec4ff', '#3ddc84', '#a066ff', '#ff8a00'];
const MAX_PARTICLES = 320;

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function createFx() {
  // ---------- 紙吹雪 ----------
  let canvas = null;
  let cx = null;
  let particles = [];
  let raf = 0;

  function ensureCanvas() {
    if (!canvas) {
      canvas = el('canvas', 'fx-canvas');
      canvas.setAttribute('aria-hidden', 'true');
      document.body.append(canvas);
      cx = canvas.getContext('2d');
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth; const h = window.innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame() {
    const w = window.innerWidth; const h = window.innerHeight;
    cx.clearRect(0, 0, w, h);
    particles = particles.filter((p) => p.life > 0 && p.y < h + 30);
    for (const p of particles) {
      p.vy += 0.28; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 1;
      cx.save();
      cx.globalAlpha = Math.min(1, p.life / 20);
      cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillStyle = p.color;
      if (p.round) { cx.beginPath(); cx.arc(0, 0, p.size / 2, 0, 6.3); cx.fill(); } else cx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      cx.restore();
    }
    raf = particles.length ? requestAnimationFrame(frame) : 0;
    if (!particles.length) cx.clearRect(0, 0, w, h);
  }

  /** x, y(画面座標)から紙吹雪。power は個数と勢いの目安。 */
  function confetti(x, y, count = 24, power = 1) {
    const n = reduced() ? Math.min(8, Math.ceil(count / 8)) : count;
    ensureCanvas();
    for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const v = (4 + Math.random() * 7) * power;
      particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        size: 6 + Math.random() * 8, color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 70 + Math.random() * 40, round: Math.random() < 0.3,
      });
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function rain(count = 60) { // 上から降らせる(レベルアップ・クリア用)
    const n = reduced() ? 10 : count;
    ensureCanvas();
    for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
      particles.push({
        x: Math.random() * window.innerWidth, y: -10 - Math.random() * 80, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 3,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, size: 7 + Math.random() * 8,
        color: COLORS[(Math.random() * COLORS.length) | 0], life: 140 + Math.random() * 60, round: Math.random() < 0.3,
      });
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  // ---------- 画面フラッシュ・シェイク ----------
  function flash(color = 'rgba(255,255,255,0.45)') {
    if (reduced()) return;
    const f = el('div', 'fx-flash');
    f.style.background = color;
    document.body.append(f);
    setTimeout(() => f.remove(), 400);
  }

  function shake() {
    if (reduced()) return;
    const app = document.getElementById('app');
    if (!app) return;
    app.classList.remove('shake');
    void app.offsetWidth; // アニメーションを最初から
    app.classList.add('shake');
    setTimeout(() => app.classList.remove('shake'), 450);
  }

  // ---------- ポップアップ(+10 など)・バナー ----------
  function popup(text, x, y, cls = '') {
    const p = el('div', `fx-pop ${cls}`, text);
    p.setAttribute('aria-hidden', 'true');
    p.style.left = `${Math.min(Math.max(x, 90), window.innerWidth - 90)}px`; p.style.top = `${y}px`;
    document.body.append(p);
    setTimeout(() => p.remove(), 1000);
  }

  function banner(text, tier = 1) {
    const b = el('div', `fx-banner tier-${tier}`, text);
    b.setAttribute('aria-hidden', 'true');
    document.body.append(b);
    setTimeout(() => b.remove(), 1000);
  }

  // ---------- トースト(実績解除) ----------
  let toastBox = null;
  const toastQueue = [];
  let toastBusy = false;

  function toast(node, ms = 2600) {
    toastQueue.push({ node, ms });
    if (!toastBusy) nextToast();
  }
  function nextToast() {
    const item = toastQueue.shift();
    if (!item) { toastBusy = false; return; }
    toastBusy = true;
    if (!toastBox) {
      toastBox = el('div', 'fx-toasts');
      toastBox.setAttribute('role', 'status');
      toastBox.setAttribute('aria-live', 'polite');
      document.body.append(toastBox);
    }
    const t = el('div', 'fx-toast');
    t.append(item.node);
    if (toastQueue.length) item.ms = Math.min(item.ms, 1700); // 続けて出るときは短く
    toastBox.append(t);
    let done = false;
    const close = () => {
      if (done) return; done = true;
      t.classList.add('out');
      setTimeout(() => { t.remove(); nextToast(); }, 250);
    };
    t.addEventListener('click', close);
    setTimeout(close, item.ms);
  }

  // ---------- 全画面オーバーレイ(レベルアップ・エンディング) ----------
  const overlayQueue = [];
  let overlayOpen = false;
  const idleCallbacks = [];

  function flushIdle() {
    if (overlayOpen || overlayQueue.length) return;
    while (idleCallbacks.length) idleCallbacks.shift()();
  }

  /** build(close) で中身の node を返す。autoMs=0 なら自動で閉じない。タップで閉じるのは dismissible のとき。 */
  function overlay({ build, cls = '', autoMs = 2600, dismissible = true, onOpen }) {
    overlayQueue.push({ build, cls, autoMs, dismissible, onOpen });
    if (!overlayOpen) nextOverlay();
  }
  function nextOverlay() {
    const item = overlayQueue.shift();
    if (!item) { overlayOpen = false; flushIdle(); return; }
    overlayOpen = true;
    const o = el('div', `fx-overlay ${item.cls}`);
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.tabIndex = -1;
    let closed = false; let timer = 0;
    const close = () => {
      if (closed) return; closed = true; clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      o.classList.add('out');
      setTimeout(() => { o.remove(); nextOverlay(); }, 200);
    };
    const onKey = (e) => { if (item.dismissible && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); close(); } };
    o.append(item.build(close));
    if (item.dismissible) o.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.append(o);
    o.focus({ preventScroll: true });
    if (item.autoMs) timer = setTimeout(close, item.autoMs);
    item.onOpen?.();
  }

  return {
    confetti, rain, flash, shake, popup, banner, toast, overlay,
    isOverlayOpen: () => overlayOpen || overlayQueue.length > 0,
    /** オーバーレイが無くなったら cb を呼ぶ(いま無ければ即時)。 */
    whenIdle(cb) { if (overlayOpen || overlayQueue.length) idleCallbacks.push(cb); else cb(); },
  };
}
