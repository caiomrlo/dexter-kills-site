/**
 * Blood cursor — a drop of blood that trails the mouse arrow with a soft lag.
 *
 * Two fixed layers move together (see .blood-cursor in style.css):
 *  - tint:  mix-blend-mode multiply, so whatever is behind the drop turns red
 *  - shine: normal blending, gives the drop body and a highlight so it still reads on black
 * They must be separate elements: a transformed wrapper would isolate the blend mode.
 *
 * Only runs on devices with a fine pointer (mouse / trackpad).
 */

const FOLLOW = 9;          // catch-up speed (higher = less lag)
const MAX_STRETCH = 0.35;  // how much the drop stretches when moving fast
const PRESS_SCALE = 0.75;  // drop shrinks while the mouse button is held

export function initBloodCursor() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (typeof gsap === 'undefined') return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const layers = ['tint', 'shine'].map((name) => {
    const el = document.createElement('div');
    el.className = `blood-cursor blood-cursor--${name}`;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  });

  const target = { x: innerWidth / 2, y: innerHeight / 2 };
  const pos = { ...target };
  let angle = 0;
  let stretch = 0;
  let press = 1;
  let pressTarget = 1;
  let visible = false;

  const setVisible = (on) => {
    visible = on;
    layers.forEach((el) => el.classList.toggle('is-visible', on));
  };

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    target.x = e.clientX;
    target.y = e.clientY;
    if (!visible) {
      // Coming back in: start at the arrow instead of flying in from where it left
      pos.x = target.x;
      pos.y = target.y;
      setVisible(true);
    }
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', () => setVisible(false));
  window.addEventListener('pointerdown', () => { pressTarget = PRESS_SCALE; });
  window.addEventListener('pointerup', () => { pressTarget = 1; });

  gsap.ticker.add((time, deltaMs) => {
    const dt = Math.min(deltaMs, 50) / 1000;
    // Frame-rate independent easing toward the arrow
    const k = reduceMotion ? 1 : 1 - Math.exp(-FOLLOW * dt);
    const dx = (target.x - pos.x) * k;
    const dy = (target.y - pos.y) * k;
    pos.x += dx;
    pos.y += dy;

    // Liquid feel: stretch along the direction of travel, based on speed (px per second)
    const speed = Math.hypot(dx, dy) / Math.max(dt, 0.001);
    if (!reduceMotion) {
      if (speed > 20) angle = Math.atan2(dy, dx);
      const want = Math.min(speed / 2500, 1) * MAX_STRETCH;
      stretch += (want - stretch) * (1 - Math.exp(-12 * dt));
    }
    press += (pressTarget - press) * (1 - Math.exp(-14 * dt));

    const transform =
      `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%) ` +
      `rotate(${angle}rad) scale(${(1 + stretch) * press}, ${(1 - stretch * 0.6) * press})`;
    for (const el of layers) el.style.transform = transform;
  });
}
