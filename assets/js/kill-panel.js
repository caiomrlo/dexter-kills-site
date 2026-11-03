/**
 * Kill dossier panel (left side) shown while a blood slide is in focus.
 * Builds the markup from a KILLS entry and plays a GSAP entrance / exit.
 */

const KNIFE_ICON = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M41 5 18.5 27.5l3.9 3.9L44 9.8c1.4-1.4.6-4.2-3-4.8Z"/>
  <path d="m18.5 27.5-3.6 3.6m7.5.3-3.6 3.6"/>
  <path d="M14.9 31.1 6 40a2.8 2.8 0 0 0 4 4l8.9-8.9"/>
</svg>`;

const TV_ICON = `
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="5" y="13" width="38" height="27" rx="3"/>
  <path d="m17 5 7 8 7-8"/>
  <path d="M35 21v11"/>
</svg>`;

const PAPERCLIP = `
<svg class="kill-clip" viewBox="0 0 40 110" fill="none" aria-hidden="true">
  <path d="M27 30V14a9 9 0 0 0-18 0v66a12 12 0 0 0 24 0V24" stroke="url(#clipMetal)" stroke-width="3.4" stroke-linecap="round"/>
  <defs>
    <linearGradient id="clipMetal" x1="0" y1="0" x2="40" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7d7a76"/><stop offset=".45" stop-color="#f1eee8"/><stop offset="1" stop-color="#8c8984"/>
    </linearGradient>
  </defs>
</svg>`;

// Dried blood spatter painted over the bottom of the polaroid
const SPATTER = `
<svg class="kill-spatter" viewBox="0 0 200 120" aria-hidden="true">
  <g fill="#8e0b12">
    <path d="M38 70c9-6 22-3 24 7s-6 17-16 16-19-15-8-23Z" opacity=".85"/>
    <circle cx="70" cy="92" r="5"/><circle cx="20" cy="96" r="7" opacity=".8"/>
    <circle cx="88" cy="74" r="2.6"/><circle cx="12" cy="66" r="3"/><circle cx="52" cy="108" r="3.4"/>
    <circle cx="104" cy="98" r="1.8"/><circle cx="30" cy="52" r="2"/><circle cx="160" cy="104" r="2.4" opacity=".7"/>
    <circle cx="142" cy="88" r="1.6"/><circle cx="96" cy="112" r="2.2"/><circle cx="6" cy="84" r="1.8"/>
    <path d="M62 77l18-6-16 10Z" opacity=".7"/><path d="M28 80 4 74l23 10Z" opacity=".7"/>
  </g>
</svg>`;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "O *primeiro* da lista." -> accent span around the starred word(s)
function formatHeadline(text) {
  return escapeHtml(text).replace(/\*(.+?)\*/g, '<span class="accent">$1</span>');
}

const ARROW_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
</svg>`;

const pad2 = (n) => String(n).padStart(2, '0');

export class KillPanel {
  constructor(root) {
    this.root = root;
    this.scrim = document.querySelector('.kill-scrim');
    this.shown = false;
    this.tl = null;
    this.swapTween = null;
    this.onNext = null;

    // Persistent shell: swappable dossier content + navigation (counter, next button)
    this.root.innerHTML = `
      <div class="kill-content"></div>
      <nav class="kill-nav" aria-label="Navegação entre vítimas">
        <span class="kill-count"><b>01</b><span>/</span><em>01</em></span>
        <button type="button" class="kill-next">
          <span class="kill-next-label">Próxima vítima</span>${ARROW_ICON}
        </button>
        <span class="kill-scroll-hint">ou role</span>
      </nav>`;
    this.content = this.root.querySelector('.kill-content');
    this.nav = this.root.querySelector('.kill-nav');
    this.nextBtn = this.root.querySelector('.kill-next');
    this.nextBtn.addEventListener('click', () => {
      if (this.onNext) this.onNext();
    });
  }

  setKill(kill, index = 0, total = 1) {
    if (this.swapTween) this.swapTween.kill();
    this.content.innerHTML = `
      <div class="kill-top">
        <figure class="kill-polaroid">
          <div class="kill-photo">
            ${kill.photo
              ? `<img src="${escapeHtml(kill.photo)}" alt="${escapeHtml(kill.name)}"
                   style="object-position:${escapeHtml(kill.photoPosition || '50% 30%')};transform-origin:${escapeHtml(kill.photoPosition || '50% 30%')};scale:${Number(kill.photoZoom) || 1}" />`
              : '<span class="kill-photo-empty" aria-hidden="true">?</span>'}
          </div>
          <img class="kill-frame" src="assets/img/polaroid-frame.webp" alt="" />
          ${SPATTER}
          ${PAPERCLIP}
        </figure>
        <div class="kill-id">
          <p class="kill-label"><span>Vítima</span> <strong>${escapeHtml(kill.number)}</strong><i class="kill-rule"></i></p>
          <h3 class="kill-name">${escapeHtml(kill.name)}</h3>
          <p class="kill-method">${KNIFE_ICON}<span>${escapeHtml(kill.method)}</span></p>
        </div>
      </div>
      <h4 class="kill-headline">${formatHeadline(kill.headline)}</h4>
      <p class="kill-desc">${escapeHtml(kill.description)}</p>
      <div class="kill-episode">
        ${TV_ICON}<span class="kill-episode-label">Episódio</span><i></i><span class="kill-episode-value">${escapeHtml(kill.episode)}</span>
      </div>`;

    this.root.querySelector('.kill-count b').textContent = pad2(index + 1);
    this.root.querySelector('.kill-count em').textContent = pad2(total);
    const isLast = index >= total - 1;
    this.nextBtn.disabled = isLast;
    this.nav.classList.toggle('is-last', isLast);
    this.nav.classList.toggle('is-single', total <= 1);

    this._buildTimeline();
  }

  _buildTimeline() {
    const gsap = window.gsap;
    if (!gsap) return;
    const q = (sel) => this.content.querySelector(sel);
    const nameChars = this._splitChars(q('.kill-name'));

    if (this.tl) this.tl.kill();
    gsap.set(this.content, { opacity: 1, y: 0, filter: 'none' });

    this.tl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } })
      .fromTo(q('.kill-polaroid'),
        { y: -90, rotate: -14, opacity: 0, scale: 1.08 },
        { y: 0, rotate: -3, opacity: 1, scale: 1, duration: 1.3 }, 0.1)
      .fromTo(q('.kill-clip'), { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, 0.55)
      .fromTo(q('.kill-spatter'), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'power4.out' }, 0.7)
      .fromTo(q('.kill-label'), { x: -24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.9 }, 0.35)
      .fromTo(q('.kill-rule'), { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'power3.inOut' }, 0.5)
      .fromTo(nameChars,
        { yPercent: 110, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 1.0, stagger: 0.035 }, 0.5)
      .fromTo(q('.kill-method'), { x: -18, opacity: 0 }, { x: 0, opacity: 1, duration: 0.9 }, 0.95)
      .fromTo(q('.kill-headline'),
        { y: 40, opacity: 0, filter: 'blur(8px)' },
        { y: 0, opacity: 1, filter: 'blur(0px)', duration: 1.2 }, 1.05)
      .fromTo(q('.kill-desc'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 1.0 }, 1.25)
      .fromTo(q('.kill-episode'), { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9 }, 1.45);
  }

  _splitChars(el) {
    if (!el) return [];
    const text = el.textContent;
    el.textContent = '';
    el.setAttribute('aria-label', text);
    const chars = [];
    text.split(/\s+/).forEach((word, wi) => {
      if (wi > 0) el.appendChild(document.createTextNode(' '));
      const wordEl = document.createElement('span');
      wordEl.className = 'kill-word';
      wordEl.setAttribute('aria-hidden', 'true');
      for (const ch of word) {
        const mask = document.createElement('span');
        mask.className = 'kill-char-mask';
        const inner = document.createElement('span');
        inner.className = 'kill-char';
        inner.textContent = ch;
        mask.appendChild(inner);
        wordEl.appendChild(mask);
        chars.push(inner);
      }
      el.appendChild(wordEl);
    });
    return chars;
  }

  show() {
    const gsap = window.gsap;
    if (this.shown || !this.tl || !gsap) return;
    this.shown = true;
    gsap.killTweensOf([this.root, this.scrim, this.nav]);
    gsap.set(this.root, { autoAlpha: 1 });
    gsap.to(this.scrim, { opacity: 1, duration: 1.2, ease: 'power2.out' });
    gsap.fromTo(this.nav, { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, delay: 1.7, ease: 'expo.out' });
    this.tl.timeScale(1).play(0);
  }

  hide() {
    const gsap = window.gsap;
    if (!this.shown || !gsap) return;
    this.shown = false;
    if (this.swapTween) this.swapTween.kill();
    gsap.killTweensOf([this.root, this.scrim, this.nav]);
    gsap.to(this.nav, { autoAlpha: 0, duration: 0.3 });
    if (this.tl) this.tl.timeScale(2.2).reverse();
    gsap.to(this.scrim, { opacity: 0, duration: 1.0, delay: 0.3, ease: 'power2.inOut' });
    gsap.to(this.root, { autoAlpha: 0, duration: 0.4, delay: 0.7 });
  }

  /** Cross to another victim: current dossier drifts out, the next one plays its entrance. */
  switchTo(kill, index, total, dir = 1) {
    const gsap = window.gsap;
    if (!gsap || !this.shown) {
      this.setKill(kill, index, total);
      return;
    }
    if (this.swapTween) this.swapTween.kill();
    this.nextBtn.disabled = true;
    this.swapTween = gsap.to(this.content, {
      y: dir > 0 ? -36 : 36,
      opacity: 0,
      filter: 'blur(6px)',
      duration: 0.55,
      ease: 'power2.in',
      onComplete: () => {
        this.swapTween = null;
        this.setKill(kill, index, total);
        // Let the next slide get on its way before the dossier lands
        this.tl.timeScale(1).pause(0);
        this.swapTween = gsap.delayedCall(0.35, () => this.tl.play(0));
      }
    });
  }
}
