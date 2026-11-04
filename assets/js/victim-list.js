import { KILLS, SERIES } from './kills.js';

/**
 * Victims archive: full-screen overlay listing every kill, grouped by series and season.
 * Picking a name calls onSelect(index) so the app can open that victim's dossier.
 */

export const CLOSE_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
  <path d="M6 6l12 12M18 6 6 18"/>
</svg>`;

const ARROW_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
</svg>`;

export const LIST_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <path d="M9 6h11M9 12h11M9 18h11"/>
  <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/>
  <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>
  <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>
</svg>`;

const pad2 = (n) => String(n).padStart(2, '0');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// { seriesKey: { seasonNumber: [{ kill, index }] } } in KILLS order
function groupKills() {
  const groups = new Map();
  KILLS.forEach((kill, index) => {
    if (!groups.has(kill.series)) groups.set(kill.series, new Map());
    const seasons = groups.get(kill.series);
    if (!seasons.has(kill.season)) seasons.set(kill.season, []);
    seasons.get(kill.season).push({ kill, index });
  });
  return groups;
}

export class VictimList {
  constructor() {
    this.isOpen = false;
    this.onSelect = null;
    this.onOpen = null;
    this.onClose = null;
    this.returnFocus = null;
    this.tl = null;

    this.root = document.createElement('div');
    this.root.className = 'victim-list';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Lista de vítimas');
    this.root.innerHTML = this._markup();
    document.body.appendChild(this.root);

    this.panel = this.root.querySelector('.victim-list-panel');
    this.scroller = this.root.querySelector('.victim-list-body');
    this.scrollTween = null;
    this.closeBtn = this.root.querySelector('.victim-list-close');
    this.items = [...this.root.querySelectorAll('.victim-item')];

    this.closeBtn.addEventListener('click', () => this.close());
    // Clicking the empty dark area around the list closes it
    this.panel.addEventListener('click', (e) => {
      if (e.target === this.panel || e.target === this.scroller || e.target.classList.contains('victim-series')) this.close();
    });
    // The archive scrolls sideways: any wheel over it glides the strip left / right
    // (and never reaches the page behind)
    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta) this._scrollBy(delta * (e.deltaMode === 1 ? 32 : 1));
    }, { passive: false });
    this.root.addEventListener('keydown', (e) => {
      const step = this.scroller.clientWidth * 0.6;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') this._scrollBy(e.key === 'PageDown' ? step : 160);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this._scrollBy(e.key === 'PageUp' ? -step : -160);
      else if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && !(e.key === ' ' && e.target === this.root)) return;
      e.preventDefault();
    });
    this.items.forEach((item) => {
      item.addEventListener('click', () => {
        const index = Number(item.dataset.index);
        this.close();
        if (this.onSelect) this.onSelect(index);
      });
    });
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  _scrollBy(delta) {
    const max = this.scroller.scrollWidth - this.scroller.clientWidth;
    const from = this.scrollTween ? this.scrollTarget : this.scroller.scrollLeft;
    this.scrollTarget = Math.max(0, Math.min(max, from + delta));
    const gsap = window.gsap;
    if (!gsap) {
      this.scroller.scrollLeft = this.scrollTarget;
      return;
    }
    if (this.scrollTween) this.scrollTween.kill();
    this.scrollTween = gsap.to(this.scroller, {
      scrollLeft: this.scrollTarget,
      duration: 0.7,
      ease: 'power3.out',
      onComplete: () => (this.scrollTween = null)
    });
  }

  _markup() {
    const columns = [...groupKills()].map(([seriesKey, seasons]) => {
      const series = SERIES[seriesKey] || { title: seriesKey, logo: '' };
      const count = [...seasons.values()].reduce((n, list) => n + list.length, 0);
      const seasonBlocks = [...seasons].map(([season, list]) => `
        <div class="victim-season">
          <h4 class="victim-season-title"><span>Temporada ${pad2(season)}</span><i></i><em>${list.length} ${list.length === 1 ? 'vítima' : 'vítimas'}</em></h4>
          <ol class="victim-items">
            ${list.map(({ kill, index }) => `
              <li>
                <button type="button" class="victim-item" data-index="${index}">
                  <span class="victim-num">${pad2(index + 1)}</span>
                  <span class="victim-thumb">${kill.photo
                    ? `<img src="${escapeHtml(kill.photo)}" alt="" loading="lazy" style="object-position:${escapeHtml(kill.photoPosition || '50% 30%')}" />`
                    : '<b>?</b>'}</span>
                  <span class="victim-text">
                    <span class="victim-name">${escapeHtml(kill.name)}</span>
                    <span class="victim-ep">${escapeHtml(kill.episode)}</span>
                  </span>
                  <span class="victim-go">${ARROW_ICON}</span>
                </button>
              </li>`).join('')}
          </ol>
        </div>`).join('');
      return `
        <section class="victim-series" data-series="${escapeHtml(seriesKey)}">
          <header class="victim-series-head">
            ${series.logo ? `<img class="victim-series-logo" src="${escapeHtml(series.logo)}" alt="${escapeHtml(series.title)}" />` : ''}
            <span class="victim-series-count">${pad2(count)}</span>
          </header>
          <div class="victim-seasons">${seasonBlocks}</div>
        </section>`;
    }).join('');

    return `
      <div class="victim-list-backdrop"></div>
      <div class="victim-list-panel">
        <header class="victim-list-head">
          <h3 class="victim-list-title"><span>As</span> <span class="accent">vítimas</span></h3>
        </header>
        <div class="victim-list-body">${columns}</div>
      </div>
      <button type="button" class="victim-list-close" aria-label="Fechar lista">${CLOSE_ICON}</button>`;
  }

  open(activeIndex = -1) {
    const gsap = window.gsap;
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnFocus = document.activeElement;
    this.items.forEach((item) => item.classList.toggle('is-active', Number(item.dataset.index) === activeIndex));
    this.root.classList.add('is-open');
    if (this.scrollTween) this.scrollTween.kill();
    this.scrollTween = null;
    this.scroller.scrollLeft = 0;
    if (this.onOpen) this.onOpen();

    if (gsap) {
      if (this.tl) this.tl.kill();
      const q = (sel) => this.root.querySelectorAll(sel);
      this.tl = gsap.timeline({ defaults: { ease: 'expo.out' } })
        .fromTo(this.root, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, 0)
        .fromTo(q('.victim-list-title'), { y: 40, opacity: 0, filter: 'blur(10px)' },
          { y: 0, opacity: 1, filter: 'blur(0px)', duration: 1.1, stagger: 0.08 }, 0.1)
        .fromTo(this.closeBtn, { opacity: 0, rotate: -90 }, { opacity: 1, rotate: 0, duration: 0.9 }, 0.3)
        .fromTo(q('.victim-series-head, .victim-season-title'), { y: 20, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.9, stagger: 0.06 }, 0.3)
        .fromTo(this.items, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 1.0, stagger: 0.04 }, 0.4);
    } else {
      this.root.style.visibility = 'visible';
      this.root.style.opacity = '1';
    }
    this.closeBtn.focus({ preventScroll: true });
  }

  close() {
    const gsap = window.gsap;
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.onClose) this.onClose();
    const done = () => this.root.classList.remove('is-open');
    if (gsap) {
      if (this.tl) this.tl.kill();
      this.tl = gsap.to(this.root, { autoAlpha: 0, duration: 0.45, ease: 'power2.inOut', onComplete: done });
    } else {
      this.root.style.visibility = 'hidden';
      done();
    }
    if (this.returnFocus && this.returnFocus.focus) this.returnFocus.focus({ preventScroll: true });
  }
}
