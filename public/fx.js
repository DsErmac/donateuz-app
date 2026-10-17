/* =========================================================
   DonateUZ visual effects — confetti, haptics, cursor glow,
   scroll progress, staggered reveals. All self-contained,
   no dependencies, and every effect defers to reduced-motion.
   ========================================================= */
(function () {
  'use strict';

  const FX = {};

  function motionReduced() {
    return document.body.classList.contains('reduce-motion') ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------- Confetti canvas ---------- */
  let canvas = null;
  let cctx = null;
  let rafId = null;
  let particles = [];

  function confettiColors() {
    const s = getComputedStyle(document.body);
    return ['--terra', '--gold', '--teal', '--primary']
      .map(v => s.getPropertyValue(v).trim())
      .filter(Boolean)
      .concat(['#ffffff']);
  }

  function ensureCanvas() {
    if (canvas) return true;
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
    (document.getElementById('app') || document.body).appendChild(canvas);
    cctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return true;
  }

  function resizeCanvas() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawHeart(size) {
    cctx.beginPath();
    const s = size / 16;
    cctx.moveTo(0, 5 * s);
    cctx.bezierCurveTo(-9 * s, -3 * s, -2 * s, -8 * s, 0, -3 * s);
    cctx.bezierCurveTo(2 * s, -8 * s, 9 * s, -3 * s, 0, 5 * s);
    cctx.closePath();
    cctx.fill();
  }

  FX.confetti = function (opts) {
    opts = opts || {};
    if (motionReduced()) return;
    if (!ensureCanvas()) return;
    const colors = confettiColors();
    const count = opts.count || 150;
    const cx = opts.x != null ? opts.x : window.innerWidth / 2;
    const cy = opts.y != null ? opts.y : window.innerHeight * 0.35;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 9;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.8),
        vy: Math.sin(angle) * speed - 6,
        size: 5 + Math.random() * 7,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[(Math.random() * colors.length) | 0],
        shape: Math.random() < 0.2 ? 'heart' : (Math.random() < 0.5 ? 'rect' : 'circle'),
        life: 0,
        ttl: 110 + Math.random() * 70,
        wob: Math.random() * Math.PI * 2
      });
    }
    if (!rafId) tick();
  };

  function tick() {
    rafId = requestAnimationFrame(tick);
    cctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    particles = particles.filter(p => p.life < p.ttl && p.y < window.innerHeight + 40);
    if (!particles.length) {
      cancelAnimationFrame(rafId);
      rafId = null;
      return;
    }
    for (const p of particles) {
      p.life++;
      p.wob += 0.1;
      p.vy += 0.16;
      p.vx *= 0.985;
      p.vy *= 0.99;
      p.x += p.vx + Math.sin(p.wob) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      const alpha = p.life > p.ttl - 30 ? Math.max(0, (p.ttl - p.life) / 30) : 1;
      cctx.save();
      cctx.globalAlpha = alpha;
      cctx.translate(p.x, p.y);
      cctx.rotate(p.rot);
      cctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        cctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.shape === 'circle') {
        cctx.beginPath();
        cctx.arc(0, 0, p.size / 2.4, 0, 7);
        cctx.fill();
      } else {
        drawHeart(p.size * 0.9);
      }
      cctx.restore();
    }
  }

  /* ---------- Haptics (mobile) ---------- */
  FX.haptic = function (ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms == null ? 12 : ms);
    } catch (e) { /* vibration unsupported */ }
  };

  /* ---------- Cursor glow on cards (pointer devices) ---------- */
  FX.initGlow = function () {
    if (!window.matchMedia || !window.matchMedia('(pointer:fine)').matches) return;
    let raf = 0;
    let pending = null;
    document.addEventListener('pointermove', function (e) {
      const card = e.target && e.target.closest ? e.target.closest('.glow-card') : null;
      pending = { card: card, x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(applyGlow);
    }, { passive: true });

    function applyGlow() {
      raf = 0;
      if (!pending) return;
      const hit = pending.card;
      document.querySelectorAll('.glow-card').forEach(function (el) {
        if (el !== hit) {
          el.style.removeProperty('--gx');
          el.style.removeProperty('--gy');
        }
      });
      if (hit) {
        const r = hit.getBoundingClientRect();
        hit.style.setProperty('--gx', (pending.x - r.left) + 'px');
        hit.style.setProperty('--gy', (pending.y - r.top) + 'px');
      }
    }
  };

  /* ---------- Scroll progress bar ---------- */
  FX.initScrollProgress = function () {
    const bar = document.getElementById('scroll-progress');
    const scroller = document.querySelector('.main-content');
    if (!bar || !scroller) return;
    scroller.addEventListener('scroll', function () {
      const max = scroller.scrollHeight - scroller.clientHeight;
      bar.style.width = max > 0 ? (scroller.scrollTop / max * 100) + '%' : '0%';
    }, { passive: true });
  };

  /* ---------- Staggered reveal delays ---------- */
  FX.stagger = function (root) {
    (root || document).querySelectorAll('.reveal:not([style*="--reveal-delay"])').forEach(function (el, i) {
      el.style.setProperty('--reveal-delay', Math.min(i * 0.05, 0.4).toFixed(2) + 's');
    });
  };

  window.FX = FX;
})();
