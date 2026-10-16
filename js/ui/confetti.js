// =============================================================
// confetti.js — Comemoração ao bater uma meta (sem biblioteca)
// -------------------------------------------------------------
// Um canvas por cima da tela, ~1,5 s, com as cores da marca. Não
// aparece com "reduzir movimento" (sistema) ou efeitos desligados.
// =============================================================

import { motionReduced } from '../core/theme.js';

const COLORS = ['#86EF6F', '#2DD4BF', '#1E7BE8', '#F7C14B', '#F472B6', '#A78BFA'];

export function confetti({ count = 140, duration = 1600 } = {}) {
  if (motionReduced() || !globalThis.document) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 12,
    vy: -Math.random() * 11 - 4,
    size: 5 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / duration);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}
