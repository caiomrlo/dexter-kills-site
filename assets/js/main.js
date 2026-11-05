/**
 * Main Application Entry Point — Dexter's Blood Slide Trophy Box (WebGPU)
 * Integrates GSAP ScrollSmoother, ScrollTrigger, and SplitText across 4 sections
 * with 7 free-floating blood slides in Section 1 that smoothly travel down the page
 * and slot into the open 3D WebGPU Trophy Box in Section 4.
 */

import { TrophyBoxRenderer } from './renderer.js';
import { BOX_SPECS, getSlideSlotZ } from './geometry.js';
import { Mat4, createRayFromCamera, intersectRayOBB } from './math.js';
import { KILLS } from './kills.js';
import { KillPanel } from './kill-panel.js';
import { VictimList, LIST_ICON } from './victim-list.js';
import { initBloodCursor } from './blood-cursor.js';

// Camera framing when the box is OPEN (closer framing filling more vertical viewport)
const OPEN_VIEW = { yaw: 0.0, pitch: 0.42, distance: 9.1, center: [0.0, 1.58, -0.20] };
// Camera framing when the box is CLOSED
const CLOSED_VIEW = { yaw: 0.0, pitch: 0.27, distance: 8.6, center: [0.0, 0.22, 0.0] };

// Kill reveal: where the focused slide floats in camera space (landscape / portrait screens)
const FOCUS_POSE = {
  // Close-up: the slide is allowed to run off the top-right edge of the screen
  wide: { ndcX: 0.56, ndcY: 0.04, depth: 1.75, roll: 0.58, tiltX: -0.34, tiltY: -0.42 },
  tall: { ndcX: 0.18, ndcY: 0.55, depth: 1.9, roll: 0.55, tiltX: -0.3, tiltY: -0.3 }
};
// Camera pulls back and up so the open box sinks into the dark behind the dossier
// centerX < 0 shifts the box to the right of the screen, away from the dossier text
const REVEAL_CAM = { distance: 2.4, centerX: -2.1, centerY: 0.9, yaw: -0.3, pitch: 0.1 };

/**
 * 7 Blood Slides (all with blood specimens, indices < 13) that start arranged around
 * the page in Section 1 matching the reference composition, and smoothly glide into
 * their respective slots inside the open Trophy Box as the user scrolls to Section 4.
 */
const FLOATING_SLIDE_CONFIGS = [
  // 1. Top-Left (framing top-left corner, blood specimen visible inside viewport edge)
  {
    slotIndex: 0,
    ndcX: -0.86,
    ndcY: 0.78,
    depth: 6.4,
    rollZ: 0.58,
    tiltX: -0.34,
    tiltY: 0.42,
    driftX: 0.16,
    driftY: -0.12,
    spinZ: -0.16,
    phase: 0.0
  },
  // 2. Mid-Left (further in background, near outer left border, clear of center text)
  {
    slotIndex: 2,
    ndcX: -0.92,
    ndcY: 0.14,
    depth: 10.2,
    rollZ: -0.44,
    tiltX: 0.32,
    tiltY: 0.36,
    driftX: 0.18,
    driftY: -0.06,
    spinZ: 0.14,
    phase: 1.15
  },
  // 3. Bottom-Left (close macro foreground slide tucked at bottom-left edge)
  {
    slotIndex: 4,
    ndcX: -0.84,
    ndcY: -0.78,
    depth: 4.6,
    rollZ: -0.48,
    tiltX: -0.30,
    tiltY: 0.38,
    driftX: 0.16,
    driftY: 0.14,
    spinZ: 0.18,
    phase: 2.35
  },
  // 4. Top-Center-Left (high near top viewport border, stays well above headline text)
  {
    slotIndex: 6,
    ndcX: -0.24,
    ndcY: 0.90,
    depth: 9.0,
    rollZ: 0.62,
    tiltX: -0.36,
    tiltY: -0.28,
    driftX: 0.06,
    driftY: -0.16,
    spinZ: -0.14,
    phase: 3.50
  },
  // 5. Top-Right (framing upper-right corner, blood specimen visible)
  {
    slotIndex: 8,
    ndcX: 0.86,
    ndcY: 0.80,
    depth: 6.2,
    rollZ: 0.60,
    tiltX: -0.34,
    tiltY: -0.40,
    driftX: -0.16,
    driftY: -0.14,
    spinZ: -0.16,
    phase: 4.65
  },
  // 6. Mid-Right (hero foreground slide on far right edge, creeps inward without touching text)
  {
    slotIndex: 10,
    ndcX: 0.85,
    ndcY: -0.22,
    depth: 4.85,
    rollZ: 0.64,
    tiltX: -0.32,
    tiltY: -0.44,
    driftX: -0.18,
    driftY: 0.08,
    spinZ: -0.18,
    phase: 5.45
  },
  // 7. Bottom-Right (deeper background tucked at bottom-right viewport corner)
  {
    slotIndex: 12,
    ndcX: 0.90,
    ndcY: -0.82,
    depth: 8.6,
    rollZ: -0.40,
    tiltX: 0.28,
    tiltY: -0.34,
    driftX: -0.16,
    driftY: 0.14,
    spinZ: 0.15,
    phase: 6.20
  }
];

const smoothstep01 = (t) => t * t * (3.0 - 2.0 * t);

class DexterBoxApp {
  constructor() {
    this.canvas = document.getElementById('webgpu-canvas');
    this.renderer = new TrophyBoxRenderer(this.canvas);

    // Global scroll progress from top of Section 1 (0.0) to top of Section 4 (1.0)
    this.pageScrollProgress = 0.0;
    this.smoothScrollProgress = 0.0;
    this.rafId = null;

    // Outro (Section 5) progress: 0 = box open & centered, 1 = closed & on the right
    this.outroProgress = 0.0;
    this.smoothOutro = 0.0;
    this.outroUnlocked = false; // true once the user opened the box by clicking the clasp
    this.claspHintEl = document.querySelector('.clasp-hint');
    this.killsHeadlineWrap = document.querySelector('.kills-headline-wrap');
    this.killsHeadlineFade = -1;
    this.finaleProgress = 0; // 0..1 while Section 6 slides up over the box
    // Page atmosphere strength (drawn by the renderer's last pass; fades out on the closed-box stage)
    this.backdropFx = { opacity: 1 };
    // Camera basis reused every frame (world space)
    this.camForward = [0, 0, -1];
    this.camRight = [1, 0, 0];
    this.camUp = [0, 1, 0];
    this.focusPos = [0, 0, 0];

    // Kill reveal (after the clasp opens the box): one slide flies to the camera, dossier shows.
    // The user then steps through KILLS with the button, wheel, touch swipe or arrow keys.
    this.killIndex = 0;
    this.navLocked = false;      // page scroll paused while the dossier owns the wheel
    this.wheelConsumed = false;  // one step per wheel gesture (trackpad inertia is ignored)
    this.lastWheelTime = 0;
    this.touchStartY = null;
    this.revealProgress = 0.0; // linear 0..1
    this.revealEase = 0.0;
    this.revealBlur = 0.0; // depth-of-field strength on the background box
    const panelEl = document.getElementById('kill-panel');
    this.killPanel = panelEl ? new KillPanel(panelEl) : null;
    this.pendingKill = null; // victim picked from the list while a slide is still travelling

    // Victims archive: opened from the button under the shut box or from the dossier nav
    this.victimList = new VictimList();
    this.listBtn = document.createElement('button');
    this.listBtn.type = 'button';
    this.listBtn.className = 'victim-list-trigger';
    this.listBtn.innerHTML = `${LIST_ICON}<span>Ver lista de vítimas</span>`;
    document.body.appendChild(this.listBtn);
    this.listBtnShown = -1;

    // Box State (Starts OPEN as requested)
    this.isOpen = true;
    this.openTimeline = 1.0; // 0.0 = fully closed & locked, 1.0 = fully open
    this.lidOpenProgress = 1.0;
    this.claspOpenProgress = 1.0;

    // Camera Orbit State (initialized for the open box + Section 1 scroll lift)
    this.camera = {
      yaw: OPEN_VIEW.yaw,
      pitch: 0.16,
      distance: OPEN_VIEW.distance,
      target: [OPEN_VIEW.center[0], OPEN_VIEW.center[1] + 20.0, OPEN_VIEW.center[2]],
      targetYaw: OPEN_VIEW.yaw,
      targetPitch: OPEN_VIEW.pitch,
      targetDistance: OPEN_VIEW.distance,
      targetCenter: [...OPEN_VIEW.center],
      pos: [0, 24, 10]
    };

    // Slide Interaction State
    this.hoveredSlide = -1;
    this.selectedSlide = -1;
    this.isHoveringBoxTrigger = false;

    // Map floating config by slide index
    this.floatingMap = new Map();
    FLOATING_SLIDE_CONFIGS.forEach((cfg, orderIdx) => {
      this.floatingMap.set(cfg.slotIndex, { ...cfg, orderIdx });
    });

    this.slides = [];
    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const slotZ = getSlideSlotZ(i);
      const floatCfg = this.floatingMap.get(i) || null;
      this.slides.push({
        index: i,
        slotZ,
        isFloating: floatCfg !== null,
        floatCfg,
        hoverProgress: 0.0,
        selectProgress: 0.0,
        focusLinear: 0.0,   // kill reveal: 0 = in its slot, 1 = held up in front of the camera
        focusProgress: 0.0, // eased focusLinear (read by the renderer)
        focusDetached: false,
        worldPos: [0, 0.34, slotZ],
        modelMatrix: Mat4.create(),
        invModelMatrix: Mat4.create()
      });
    }

    // Matrices
    this.projMatrix = Mat4.create();
    this.viewMatrix = Mat4.create();
    this.viewProjMatrix = Mat4.create();
    this.invViewProjMatrix = Mat4.create();

    this.baseMatrix = Mat4.create();
    this.invBaseMatrix = Mat4.create();
    this.lidMatrix = Mat4.create();
    this.invLidMatrix = Mat4.create();
    this.claspMatrix = Mat4.create();

    // Pointer / Drag Tracking
    this.isDragging = false;
    this.pointerDownPos = [0, 0];
    this.lastPointerPos = [0, 0];
    this.dragDistance = 0;

    this.lastFrameTime = performance.now();
  }

  get focusSlotIndex() {
    return KILLS[this.killIndex]?.slotIndex ?? -1;
  }

  get anySlideOut() {
    for (const s of this.slides) if (s.focusLinear > 0.001) return true;
    return false;
  }

  // Interaction with the box is paused while a kill dossier is open
  get isRevealing() {
    return this.outroUnlocked || this.revealProgress > 0.001 || this.anySlideOut;
  }

  // True when the current slide is in place and no other slide is travelling
  get isRevealSettled() {
    const active = this.focusSlotIndex;
    return (
      this.outroUnlocked &&
      this.revealProgress >= 1.0 &&
      this.slides.every((s) => (s.index === active ? s.focusLinear > 0.85 : s.focusLinear < 0.05))
    );
  }

  /**
   * Step through the dossiers: +1 next victim, -1 previous.
   * Going back from the first victim puts the slide away and closes the box again.
   */
  stepKill(dir) {
    if (!this.isRevealSettled) return false;
    const next = this.killIndex + dir;
    if (next >= KILLS.length) return false;
    if (next < 0) {
      this.outroUnlocked = false;
      if (this.killPanel) this.killPanel.hide();
      return true;
    }
    this.killIndex = next;
    if (this.killPanel) this.killPanel.switchTo(KILLS[next], next, KILLS.length, dir);
    return true;
  }

  /** Leave the dossier: the slide goes home, the box shuts and the page scroll comes back. */
  closeDossier() {
    if (!this.outroUnlocked) return;
    this.pendingKill = null;
    this.outroUnlocked = false;
    if (this.killPanel) this.killPanel.hide();
  }

  /** Open a victim picked from the list: unlocks the shut box, or jumps from the current dossier. */
  openKill(index) {
    if (!KILLS[index]) return;
    if (!this.outroUnlocked) {
      if (this.isOpen && this.outroProgress > 0.55) this._unlockOutro(index);
      return;
    }
    if (index === this.killIndex) return;
    this.pendingKill = index;
    this._applyPendingKill();
  }

  _applyPendingKill() {
    if (this.pendingKill === null || !this.isRevealSettled) return;
    const next = this.pendingKill;
    this.pendingKill = null;
    if (next === this.killIndex) return;
    const dir = next > this.killIndex ? 1 : -1;
    this.killIndex = next;
    if (this.killPanel) this.killPanel.switchTo(KILLS[next], next, KILLS.length, dir);
  }

  // Box shut at the end of the outro -> open it and pull out the slide of KILLS[index]
  _unlockOutro(index = 0) {
    this.outroUnlocked = true;
    this.killIndex = index;
    this.pendingKill = null;
    if (this.killPanel) this.killPanel.setKill(KILLS[index], index, KILLS.length);
    this._setNavLock(true);
    this.wheelConsumed = true; // a click is not a wheel gesture; wait for a fresh one
    this.selectedSlide = -1;
    this.hoveredSlide = -1;
    this.canvas.classList.remove('pointer-interactive');
    // Frame the open box straight on before the slide leaves it
    this.camera.targetYaw = OPEN_VIEW.yaw;
    this.camera.targetPitch = OPEN_VIEW.pitch;
    this.camera.targetDistance = OPEN_VIEW.distance;
    this.camera.targetCenter = [...OPEN_VIEW.center];
  }

  _setNavLock(locked) {
    if (this.navLocked === locked) return;
    this.navLocked = locked;
    if (this.smoother) this.smoother.paused(locked);
  }

  async start() {
    this._initScrollAndTypography();
    if (this.killPanel && KILLS[this.killIndex]) {
      this.killPanel.setKill(KILLS[this.killIndex], this.killIndex, KILLS.length);
      this.killPanel.onNext = () => this.stepKill(1);
      this.killPanel.onPrev = () => this.stepKill(-1);
      this.killPanel.onList = () => this.victimList.open(this.killIndex);
      this.killPanel.onClose = () => this.closeDossier();
    }
    this.listBtn.addEventListener('click', () => this.victimList.open(-1));
    this.victimList.onSelect = (index) => this.openKill(index);
    // A paused ScrollSmoother swallows wheel events on anything that can't scroll vertically,
    // which would kill the archive's sideways scroll. The archive blocks page scroll itself instead.
    this.victimList.onOpen = () => {
      if (this.smoother) this.smoother.paused(false);
    };
    this.victimList.onClose = () => {
      if (this.smoother) this.smoother.paused(this.navLocked);
    };

    try {
      await this.renderer.init();
      // The renderer now draws the dark atmosphere itself; the CSS layer is the fallback only
      document.body.classList.add('webgl-backdrop');
      this._bindEvents();
      this._updateUI();
      this._startRenderLoop();
    } catch (err) {
      console.error('WebGPU initialization error:', err);
      const errOverlay = document.getElementById('webgpu-error');
      if (errOverlay) errOverlay.classList.remove('hidden');
    }
  }

  _initScrollAndTypography() {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    const ScrollSmoother = window.ScrollSmoother;
    const SplitText = window.SplitText;

    if (!gsap || !ScrollTrigger || !ScrollSmoother || !SplitText) {
      console.warn('GSAP plugins not found.');
      return;
    }

    gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);

    // Initialize ScrollSmoother for ultra-smooth inertial page scrolling
    this.smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      smooth: 2.2,
      effects: true,
      smoothTouch: 0.15,
      ignoreMobileResize: true
    });

    const setupSplits = () => {
      const headlines = document.querySelectorAll('[data-split-words]');

      headlines.forEach((headline) => {
        const section = headline.closest('.story-section');
        const sectionIdx = Number(section?.dataset.section || 0);

        const split = SplitText.create(headline, {
          type: 'words',
          wordsClass: 'split-word'
        });

        gsap.set(headline, { visibility: 'visible' });

        if (sectionIdx === 1) {
          // Section 1: "ESTA É A NOITE." — Entrance animation on load
          const indicator = section.querySelector('.scroll-indicator');

          gsap.set(split.words, {
            opacity: 0,
            yPercent: 110,
            rotateX: -45,
            scale: 0.92
          });

          if (indicator) {
            gsap.set(indicator, { opacity: 0, y: 14 });
          }

          const introTl = gsap.timeline({ delay: 0.15 });
          introTl.to(split.words, {
            opacity: 1,
            yPercent: 0,
            rotateX: 0,
            scale: 1,
            duration: 1.35,
            stagger: 0.14,
            ease: 'expo.out'
          });

          if (indicator) {
            introTl.to(
              indicator,
              {
                opacity: 0.72,
                y: 0,
                duration: 0.9,
                ease: 'power2.out'
              },
              '-=0.7'
            );

            gsap.to(indicator, {
              opacity: 0,
              y: 20,
              ease: 'none',
              scrollTrigger: {
                trigger: section,
                start: 'top top',
                end: '40% top',
                scrub: true
              }
            });
          }
        } else {
          // Section 2 & Section 3: Words appear progressively on scroll
          gsap.set(split.words, {
            opacity: 0,
            yPercent: 100,
            rotateX: -40,
            scale: 0.92
          });

          gsap.to(split.words, {
            opacity: 1,
            yPercent: 0,
            rotateX: 0,
            scale: 1,
            ease: 'power3.out',
            stagger: 0.15,
            scrollTrigger: {
              trigger: section,
              start: 'top 85%',
              end: 'center 42%',
              scrub: 1.1
            }
          });
        }
      });

      // Global scroll progress from top of Section 1 to top of Section 4 (Trophy Box)
      const smoothContent = document.getElementById('smooth-content');
      const trophySection = document.getElementById('trophy-section');
      if (smoothContent && trophySection) {
        ScrollTrigger.create({
          trigger: smoothContent,
          start: 'top top',
          endTrigger: trophySection,
          end: 'top top',
          scrub: true,
          onUpdate: (self) => {
            this.pageScrollProgress = self.progress;
            // Enable 3D pointer interaction once the user is arriving at Section 4
            if (this.pageScrollProgress > 0.84) {
              this.canvas.classList.add('canvas-interactive');
            } else {
              this.canvas.classList.remove('canvas-interactive', 'pointer-interactive');
              this.hoveredSlide = -1;
              // Ensure box is open if user scrolls back up above Section 4
              if (!this.isOpen && this.pageScrollProgress < 0.78) {
                this.isOpen = true;
                this.selectedSlide = -1;
                this.camera.targetYaw = OPEN_VIEW.yaw;
                this.camera.targetPitch = OPEN_VIEW.pitch;
                this.camera.targetDistance = OPEN_VIEW.distance;
                this.camera.targetCenter = [...OPEN_VIEW.center];
              }
            }
          }
        });
      }

      // Section 5 (outro): box closes while staying centered; user reopens it via the gold clasp
      const outroSection = document.getElementById('outro-section');
      if (outroSection) {
        ScrollTrigger.create({
          trigger: outroSection,
          start: 'top bottom',
          end: 'top top',
          scrub: true,
          onUpdate: (self) => {
            this.outroProgress = self.progress;
            // Scrolling back up re-arms the scroll-driven closing
            if (self.progress < 0.3) this.outroUnlocked = false;
          }
        });

        this._initKillsStage(gsap, outroSection);
      }

      // Section 6 (finale): slides up over the box like a curtain while the scene drifts up behind it
      const finaleSection = document.getElementById('finale-section');
      if (finaleSection) {
        const finaleScroll = { trigger: finaleSection, start: 'top bottom', end: 'top top', scrub: true };
        ScrollTrigger.create({
          ...finaleScroll,
          onUpdate: (self) => {
            this.finaleProgress = self.progress;
          }
        });
        gsap.to(['#webgpu-canvas', '.kills-stage'], { yPercent: -28, ease: 'none', scrollTrigger: finaleScroll });
        // "VÍTIMA" behind the headline: surfaces slowly from below, a bit slower than the page
        const ghost = finaleSection.querySelector('.finale-ghost');
        if (ghost) {
          gsap.fromTo(ghost,
            { yPercent: 18, opacity: 0, scale: 1.06 },
            { yPercent: -4, opacity: 1, scale: 1, ease: 'power1.out', scrollTrigger: { ...finaleScroll, scrub: 1.2 } });
        }
      }

      ScrollTrigger.refresh();
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(setupSplits);
    } else {
      setupSplits();
    }
  }

  _bindEvents() {
    // Pointer controls on canvas (active in Section 4)
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.pageScrollProgress <= 0.84) return;
      if (this.isRevealing) return;
      this.isDragging = true;
      this.dragDistance = 0;
      this.pointerDownPos = [e.clientX, e.clientY];
      this.lastPointerPos = [e.clientX, e.clientY];
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.pageScrollProgress <= 0.84) return;
      if (this.isRevealing) {
        this.hoveredSlide = -1;
        this.canvas.classList.remove('pointer-interactive');
        return;
      }
      const dx = e.clientX - this.lastPointerPos[0];
      const dy = e.clientY - this.lastPointerPos[1];
      this.lastPointerPos = [e.clientX, e.clientY];

      if (this.isDragging) {
        this.dragDistance += Math.hypot(dx, dy);
        this.camera.targetYaw -= dx * 0.0075;
        this.camera.targetPitch = Math.max(
          0.08,
          Math.min(1.48, this.camera.targetPitch + dy * 0.0075)
        );
      } else {
        this._handleHover(e.clientX, e.clientY);
      }
    });

    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.canvas.releasePointerCapture(e.pointerId);

      // If pointer barely moved, treat as a 3D click
      if (this.dragDistance < 6) {
        this._handleClick(e.clientX, e.clientY);
      }
    });

    // Only intercept wheel for camera zoom when holding Ctrl/Alt/Meta so normal wheel scrolls smoothly
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) return;
        e.preventDefault();
        const zoomSpeed = 0.0045;
        this.camera.targetDistance = Math.max(
          2.6,
          Math.min(18.0, this.camera.targetDistance + e.deltaY * zoomSpeed)
        );
      },
      { passive: false }
    );

    // Dossier navigation: wheel / swipe / keys step between victims instead of scrolling the page
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.navLocked || this.victimList.isOpen) return;
        e.preventDefault();
        const now = performance.now();
        if (now - this.lastWheelTime > 260) this.wheelConsumed = false;
        this.lastWheelTime = now;
        if (this.wheelConsumed || Math.abs(e.deltaY) < 6) return;
        this.wheelConsumed = true;
        this.stepKill(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    window.addEventListener('touchstart', (e) => {
      if (this.navLocked) this.touchStartY = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (this.navLocked && !this.victimList.isOpen) e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchend', (e) => {
      if (!this.navLocked || this.victimList.isOpen || this.touchStartY === null) return;
      const dy = this.touchStartY - e.changedTouches[0].clientY;
      this.touchStartY = null;
      if (Math.abs(dy) > 40) this.stepKill(dy > 0 ? 1 : -1);
    });

    window.addEventListener('keydown', (e) => {
      // Esc closes the dossier (the victims list handles its own Esc first)
      if (e.key === 'Escape' && !e.defaultPrevented && !this.victimList.isOpen && this.outroUnlocked) {
        e.preventDefault();
        this.closeDossier();
        return;
      }
      if (!this.navLocked || this.victimList.isOpen) return;
      const down = ['ArrowDown', 'PageDown', ' ', 'ArrowRight'];
      const up = ['ArrowUp', 'PageUp', 'ArrowLeft'];
      if (down.includes(e.key)) {
        e.preventDefault();
        this.stepKill(1);
      } else if (up.includes(e.key)) {
        e.preventDefault();
        this.stepKill(-1);
      }
    });

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.renderer.device) {
          this.renderer.resize();
        }
      });
      this.resizeObserver.observe(this.canvas);
    } else {
      window.addEventListener('resize', () => this.renderer.resize());
    }
  }

  _startRenderLoop() {
    if (this.rafId !== null || !this.renderer.device) return;
    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this._loop(t));
  }

  toggleBox() {
    this.isOpen = !this.isOpen;
    if (!this.isOpen) {
      this.selectedSlide = -1;
      this.hoveredSlide = -1;
      this.camera.targetCenter = [...CLOSED_VIEW.center];
      this.camera.targetDistance = CLOSED_VIEW.distance;
      this.camera.targetPitch = CLOSED_VIEW.pitch;
    } else {
      this.camera.targetCenter = [...OPEN_VIEW.center];
      this.camera.targetDistance = OPEN_VIEW.distance;
      this.camera.targetPitch = OPEN_VIEW.pitch;
    }
    this._updateUI();
  }

  resetCamera() {
    if (this.isOpen) {
      this.camera.targetYaw = OPEN_VIEW.yaw;
      this.camera.targetPitch = OPEN_VIEW.pitch;
      this.camera.targetDistance = OPEN_VIEW.distance;
      this.camera.targetCenter = [...OPEN_VIEW.center];
    } else {
      this.camera.targetYaw = CLOSED_VIEW.yaw;
      this.camera.targetPitch = CLOSED_VIEW.pitch;
      this.camera.targetDistance = CLOSED_VIEW.distance;
      this.camera.targetCenter = [...CLOSED_VIEW.center];
    }
  }

  selectSlide(index) {
    if (index === this.selectedSlide) {
      this.selectedSlide = -1;
    } else {
      this.selectedSlide = index;
    }
    this._updateUI();
  }

  _updateUI() {
    // Reserved for optional HUD indicators
  }

  _getRayFromPointer(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
    const ndcY = 1.0 - ((clientY - rect.top) / rect.height) * 2.0;
    return createRayFromCamera(ndcX, ndcY, this.invViewProjMatrix, this.camera.pos);
  }

  _raycastScene(clientX, clientY) {
    const ray = this._getRayFromPointer(clientX, clientY);
    const hw = BOX_SPECS.width / 2;
    const hl = BOX_SPECS.length / 2;

    // 1. If open, test intersection against all 24 glass slides first
    let closestSlide = -1;
    let minSlideT = Infinity;

    if (this.lidOpenProgress > 0.45) {
      const sW = BOX_SPECS.slideWidth / 2;
      const sH = BOX_SPECS.slideHeight / 2;
      const pickHalfThick = 0.042;
      const slideMin = [-sW, -sH, -pickHalfThick];
      const slideMax = [sW, sH, pickHalfThick];

      for (let i = 0; i < BOX_SPECS.numSlides; i++) {
        const s = this.slides[i];
        const t = intersectRayOBB(ray, s.invModelMatrix, slideMin, slideMax);
        if (t !== null && t < minSlideT) {
          minSlideT = t;
          closestSlide = i;
        }
      }
    }

    // 2. Test intersection with Lid (or front Brass Latch)
    const lidMin = [-hw - 0.05, -0.05, 0.0];
    const lidMax = [hw + 0.05, BOX_SPECS.lidHeight + 0.05, BOX_SPECS.length + 0.08];
    const tLid = intersectRayOBB(ray, this.invLidMatrix, lidMin, lidMax);

    // 3. Test intersection with front Lower Latch on the Base
    const latchMin = [-0.28, 0.05, hl - 0.05];
    const latchMax = [0.28, BOX_SPECS.baseHeight + 0.05, hl + 0.09];
    const tLatch = intersectRayOBB(ray, this.invBaseMatrix, latchMin, latchMax);

    return {
      slideIndex: closestSlide,
      slideT: minSlideT,
      hitLidOrLatch: tLid !== null || tLatch !== null
    };
  }

  _handleHover(clientX, clientY) {
    if (this.finaleProgress > 0.2) return; // box is behind the finale curtain
    const hit = this._raycastScene(clientX, clientY);
    const prevHovered = this.hoveredSlide;
    this.hoveredSlide = hit.slideIndex;
    this.isHoveringBoxTrigger = hit.slideIndex >= 0 || hit.hitLidOrLatch;

    if (this.isHoveringBoxTrigger) {
      this.canvas.classList.add('pointer-interactive');
    } else {
      this.canvas.classList.remove('pointer-interactive');
    }

    if (prevHovered !== this.hoveredSlide && this.selectedSlide === -1) {
      this._updateUI();
    }
  }

  _handleClick(clientX, clientY) {
    if (this.finaleProgress > 0.2) return;
    const hit = this._raycastScene(clientX, clientY);

    // Box shut by the outro scroll: clicking the lid/clasp reopens it
    if (this.isOpen && this.outroProgress > 0.55 && !this.outroUnlocked) {
      if (hit.hitLidOrLatch) this._unlockOutro(0);
      return;
    }

    if (!this.isOpen) {
      if (hit.hitLidOrLatch) {
        this.toggleBox();
      }
      return;
    }

    if (hit.slideIndex >= 0) {
      this.selectSlide(hit.slideIndex);
      return;
    }

    if (hit.hitLidOrLatch) {
      this.toggleBox();
    }
  }

  _updateKinematics(dt, timeSec) {
    // Smoothly track pageScrollProgress (0.0 at Section 1 -> 1.0 at Section 4)
    const scrollSmooth = 1.0 - Math.exp(-12.0 * dt);
    this.smoothScrollProgress += (this.pageScrollProgress - this.smoothScrollProgress) * scrollSmooth;
    const sProg = Math.min(1.0, Math.max(0.0, this.smoothScrollProgress));

    // Camera vertical lift & pitch transition across the 4 sections:
    // During Sections 1..3 (sProg 0.0 -> 0.72), the camera is high above the Trophy Box
    // so only the 7 floating blood slides are in view around the viewport periphery.
    // In the extended transition zone between Section 3 and Section 4 (sProg 0.72 -> 1.0),
    // the camera descends to frame the open Trophy Box as the slides rapidly converge and slot in.
    let scrollLiftY = 0.0;
    let pitchOffset = 0.0;
    let yawOffset = 0.0;

    if (sProg < 0.72) {
      const t13 = sProg / 0.72; // 0 -> 1 across Sections 1, 2, 3
      scrollLiftY = 20.0 - t13 * 8.5; // 20.0 -> 11.5
      pitchOffset = -0.26; // Looking nearly horizontal into the dark studio space
      yawOffset = 0.0;
    } else {
      const u4 = (sProg - 0.72) / 0.28; // 0 -> 1 in the space between Section 3 and Section 4
      const rem = 1.0 - Math.min(1.0, Math.max(0.0, u4));
      const easeRem = rem * rem * (0.65 + 0.35 * rem);
      scrollLiftY = 11.5 * easeRem;
      pitchOffset = -0.26 * easeRem;
      yawOffset = -0.26 * Math.sin(u4 * Math.PI) * (1.0 - u4 * 0.5);
    }

    // Outro (Section 5): box closes and slides to the right while the headline appears on the left
    const outro = Math.min(1.0, Math.max(0.0, this.outroProgress));
    this.smoothOutro += (outro - this.smoothOutro) * (1.0 - Math.exp(-8.0 * dt));
    const so = this.smoothOutro;
    const outroEase = so * so * (3.0 - 2.0 * so);
    // Camera blends towards the closed framing only while the box is still scroll-driven
    const camMix = this.isOpen && !this.outroUnlocked ? outroEase : 0.0;

    // Kill reveal starts once the box is (almost) fully open again after the clasp click
    const revealTarget = this.outroUnlocked && this.isOpen && this.openTimeline > 0.82 ? 1.0 : 0.0;
    const revealSpeed = revealTarget > this.revealProgress ? 1.0 / 2.4 : 1.0 / 1.1;
    if (this.revealProgress < revealTarget) {
      this.revealProgress = Math.min(revealTarget, this.revealProgress + dt * revealSpeed);
    } else if (this.revealProgress > revealTarget) {
      this.revealProgress = Math.max(revealTarget, this.revealProgress - dt * revealSpeed);
    }
    const rp = this.revealProgress;
    this.revealEase = rp * rp * (3.0 - 2.0 * rp);
    // Camera eases back a bit later than the slide lifts, so the lift reads first
    const camRevealRaw = Math.min(1.0, Math.max(0.0, (rp - 0.15) / 0.85));
    const camReveal = camRevealRaw * camRevealRaw * (3.0 - 2.0 * camRevealRaw);
    // Blur arms once a slide is clear of the box and stays on through victim swaps
    let anyDetached = false;
    for (const s of this.slides) if (s.focusDetached) anyDetached = true;
    if (anyDetached) this.blurArmed = true;
    else if (!this.outroUnlocked) this.blurArmed = false;
    this.revealBlur = this.blurArmed ? camReveal : 0.0;

    this._applyPendingKill();

    if (this.killPanel) {
      if (rp > 0.55 && revealTarget > 0.5) this.killPanel.show();
      else if (revealTarget < 0.5) this.killPanel.hide();
    }

    // Back at the clasp state (slide home, box shut): give the page scroll back
    if (this.navLocked && !this.outroUnlocked && !this.anySlideOut && this.openTimeline < 0.02) {
      this._setNavLock(false);
    }

    const effectiveTargetYaw = this.camera.targetYaw + yawOffset + REVEAL_CAM.yaw * camReveal;
    const effectiveTargetPitch = Math.max(
      0.08,
      Math.min(
        1.48,
        this.camera.targetPitch + pitchOffset + (CLOSED_VIEW.pitch - OPEN_VIEW.pitch) * camMix + REVEAL_CAM.pitch * camReveal
      )
    );
    const effectiveTargetDist =
      this.camera.targetDistance + (CLOSED_VIEW.distance - 1.7 - OPEN_VIEW.distance) * camMix + REVEAL_CAM.distance * camReveal;
    const effectiveTargetCenterY =
      this.camera.targetCenter[1] + scrollLiftY + (CLOSED_VIEW.center[1] - OPEN_VIEW.center[1]) * camMix +
      REVEAL_CAM.centerY * camReveal;

    // 1. Smoothly damp camera orbit
    const camSmooth = 1.0 - Math.exp(-10.0 * dt);
    this.camera.yaw += (effectiveTargetYaw - this.camera.yaw) * camSmooth;
    this.camera.pitch += (effectiveTargetPitch - this.camera.pitch) * camSmooth;
    this.camera.distance += (effectiveTargetDist - this.camera.distance) * camSmooth;

    const effectiveTargetCenterX = this.camera.targetCenter[0] + REVEAL_CAM.centerX * camReveal;
    this.camera.target[0] += (effectiveTargetCenterX - this.camera.target[0]) * camSmooth;
    this.camera.target[1] += (effectiveTargetCenterY - this.camera.target[1]) * camSmooth;
    this.camera.target[2] += (this.camera.targetCenter[2] - this.camera.target[2]) * camSmooth;

    const cosP = Math.cos(this.camera.pitch);
    const sinP = Math.sin(this.camera.pitch);
    const sinY = Math.sin(this.camera.yaw);
    const cosY = Math.cos(this.camera.yaw);

    this.camera.pos[0] = this.camera.target[0] + this.camera.distance * cosP * sinY;
    this.camera.pos[1] = this.camera.target[1] + this.camera.distance * sinP;
    this.camera.pos[2] = this.camera.target[2] + this.camera.distance * cosP * cosY;

    const aspect = Math.max(1, this.canvas.width) / Math.max(1, this.canvas.height);
    const fovy = (38 * Math.PI) / 180;
    Mat4.perspectiveZO(this.projMatrix, fovy, aspect, 0.1, 45.0);
    Mat4.lookAt(this.viewMatrix, this.camera.pos, this.camera.target, [0, 1, 0]);
    Mat4.multiply(this.viewProjMatrix, this.projMatrix, this.viewMatrix);
    Mat4.invert(this.invViewProjMatrix, this.viewProjMatrix);

    // Camera basis vectors in world space for positioning the 7 floating slides in camera frustum space
    // Forward vector from camera.pos toward camera.target:
    const camForward = this.camForward;
    camForward[0] = -cosP * sinY; camForward[1] = -sinP; camForward[2] = -cosP * cosY;
    // Right vector:
    const camRight = this.camRight;
    camRight[0] = cosY; camRight[1] = 0.0; camRight[2] = -sinY;
    // Up vector = Right x Forward:
    const camUp = this.camUp;
    camUp[0] = -sinP * sinY; camUp[1] = cosP; camUp[2] = -sinP * cosY;
    const tanHalfFov = Math.tan(fovy * 0.5);

    // 2. Box Open/Close Two-Stage Animation Timeline
    let targetTimeline = this.isOpen ? 1.0 : 0.0;

    // Scroll-driven closing: box shuts during the first part of the outro.
    // It waits for any slide still flying home, and eases shut (instead of following
    // the scroll) when the user leaves the dossier.
    if (this.isOpen && !this.outroUnlocked && this.outroProgress > 0.001 && !this.anySlideOut) {
      const cap = 1.0 - Math.min(1.0, this.outroProgress / 0.55);
      targetTimeline = Math.min(targetTimeline, cap);
      if (!this.navLocked) this.openTimeline = Math.min(this.openTimeline, cap);
    }

    const timelineSpeed = 1.35;
    if (this.openTimeline < targetTimeline) {
      this.openTimeline = Math.min(1.0, this.openTimeline + dt * timelineSpeed);
    } else if (this.openTimeline > targetTimeline) {
      this.openTimeline = Math.max(0.0, this.openTimeline - dt * timelineSpeed);
    }

    // Stage 1 (0.0 -> 0.22): Clasp loop unhooks
    const rawClasp = Math.min(1.0, Math.max(0.0, this.openTimeline / 0.22));
    this.claspOpenProgress = rawClasp * rawClasp * (3.0 - 2.0 * rawClasp);

    // Stage 2 (0.16 -> 1.0): Lid swings open to 105 degrees (-1.83 radians)
    const rawLid = Math.min(1.0, Math.max(0.0, (this.openTimeline - 0.16) / 0.84));
    this.lidOpenProgress = rawLid < 0.5
      ? 4.0 * rawLid * rawLid * rawLid
      : 1.0 - Math.pow(-2.0 * rawLid + 2.0, 3.0) / 2.0;

    // 3. Compute Base Matrix (Identity at world origin)
    Mat4.identity(this.baseMatrix);
    Mat4.invert(this.invBaseMatrix, this.baseMatrix);

    // 4. Compute Lid Matrix (pivots around back hinge at Y = 0.42, Z = -1.50)
    const maxLidAngle = -1.83;
    const lidAngle = this.lidOpenProgress * maxLidAngle;
    Mat4.fromTranslation(this.lidMatrix, [0.0, BOX_SPECS.hingeY, BOX_SPECS.hingeZ]);
    Mat4.rotateX(this.lidMatrix, this.lidMatrix, lidAngle);
    Mat4.invert(this.invLidMatrix, this.lidMatrix);

    // 5. Compute Swinging Brass Clasp Loop Matrix (attached to front of lid)
    Mat4.copy(this.claspMatrix, this.lidMatrix);
    Mat4.translate(this.claspMatrix, this.claspMatrix, [0.0, 0.08, BOX_SPECS.length + 0.025]);
    const claspSwingAngle = -Math.sin(this.claspOpenProgress * Math.PI * 0.5) * 0.95;
    Mat4.rotateX(this.claspMatrix, this.claspMatrix, claspSwingAngle);

    // 6. Update all 24 Glass Slides (including the 7 free-floating blood slides)
    const slideSmooth = 1.0 - Math.exp(-12.0 * dt);
    const travel = Math.min(1.0, sProg / 0.72);
    // Gentle ease-in-out so slides emerge very subtly from viewport edges across Sections 1-3
    const travelSmooth = travel * travel * (3.0 - 2.0 * travel);

    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const s = this.slides[i];
      const targetHover = (this.isOpen && this.hoveredSlide === i && this.selectedSlide !== i) ? 1.0 : 0.0;
      const targetSelect = (this.isOpen && this.selectedSlide === i) ? 1.0 : 0.0;

      s.hoverProgress += (targetHover - s.hoverProgress) * slideSmooth;
      s.selectProgress += (targetSelect - s.selectProgress) * slideSmooth;

      let neighborWave = 0.0;
      if (this.isOpen && this.hoveredSlide >= 0 && this.selectedSlide === -1) {
        const distSlots = Math.abs(i - this.hoveredSlide);
        if (distSlots > 0 && distSlots <= 3) {
          neighborWave = Math.max(0.0, (1.0 - distSlots / 3.5) * 0.055);
        }
      }

      const floatOsc = s.selectProgress > 0.01 ? Math.sin(timeSec * 2.6) * 0.025 * s.selectProgress : 0.0;
      const slotPosY = 0.34 + s.hoverProgress * 0.19 + neighborWave + s.selectProgress * 0.95 + floatOsc;
      const slotPosZ = s.slotZ + s.selectProgress * (0.35 - s.slotZ * 0.35);
      const slotPosX = 0.0;

      if (!s.isFloating) {
        // Stationary slide already inside the Trophy Box
        s.worldPos[0] = slotPosX;
        s.worldPos[1] = slotPosY;
        s.worldPos[2] = slotPosZ;

        Mat4.fromTranslation(s.modelMatrix, s.worldPos);
        if (s.selectProgress > 0.001) {
          Mat4.rotateY(s.modelMatrix, s.modelMatrix, s.selectProgress * 0.25);
          Mat4.rotateX(s.modelMatrix, s.modelMatrix, -s.selectProgress * 0.18);
        }
        Mat4.invert(s.invModelMatrix, s.modelMatrix);
        continue;
      }

      // One of the 7 free-floating blood slides:
      const cfg = s.floatCfg;
      const k = cfg.orderIdx; // 0..6

      // Rapid, decisive entry window occurs after Section 3 text has scrolled up,
      // inside the expanded transition space approaching Section 4 (Trophy Box)
      const entryStart = 0.70 + k * 0.022;
      const entryEnd = 0.88 + k * 0.018;
      const rawEntry = Math.min(1.0, Math.max(0.0, (sProg - entryStart) / (entryEnd - entryStart)));

      // Horizontal & angular alignment finishes by rawEntry = 0.78 so the slide is 100% aligned
      // directly above its slot before descending between the rack comb teeth
      const rawAlign = Math.min(1.0, rawEntry / 0.78);
      const alignT = rawAlign * rawAlign * (3.0 - 2.0 * rawAlign);
      const rotWeight = 1.0 - alignT;

      // Vertical drop into the slot finishes at rawEntry = 1.0
      const rawDrop = Math.min(1.0, Math.max(0.0, (rawEntry - 0.64) / 0.36));
      const dropT = rawDrop * rawDrop * (3.0 - 2.0 * rawDrop);

      // Idle zero-gravity floating oscillation (subtle, damps out as slide aligns with box)
      const idleX = Math.sin(timeSec * 1.05 + cfg.phase) * 0.012 * rotWeight;
      const idleY = Math.cos(timeSec * 1.25 + cfg.phase * 1.3) * 0.016 * rotWeight;
      const idleRoll = Math.sin(timeSec * 0.90 + cfg.phase) * 0.028 * rotWeight;
      const idleTilt = Math.cos(timeSec * 1.05 + cfg.phase) * 0.022 * rotWeight;

      // Peripheral screen-relative trajectory across Sections 1 -> 2 -> 3 (stays clear of central text)
      const swayX = Math.sin(sProg * Math.PI * 1.2 + cfg.phase) * 0.024 * travelSmooth;
      const swayY = Math.cos(sProg * Math.PI * 1.0 + cfg.phase) * 0.024 * travelSmooth;
      const curNdcX = cfg.ndcX + cfg.driftX * travelSmooth + swayX + idleX;
      const curNdcY = cfg.ndcY + cfg.driftY * travelSmooth + swayY + idleY;
      const curDepth = cfg.depth + (6.4 - cfg.depth) * travelSmooth * 0.28;

      const halfH = curDepth * tanHalfFov;
      const halfW = halfH * aspect;
      const rx = curNdcX * halfW;
      const uy = curNdcY * halfH;

      const floatPosX = this.camera.pos[0] + camForward[0] * curDepth + camRight[0] * rx + camUp[0] * uy;
      const floatPosY = this.camera.pos[1] + camForward[1] * curDepth + camRight[1] * rx + camUp[1] * uy;
      const floatPosZ = this.camera.pos[2] + camForward[2] * curDepth + camRight[2] * rx + camUp[2] * uy;

      // Blend from camera-floating position to overhead hover point, then vertically into slot
      const hoverAboveY = 1.26 + (6 - k) * 0.045;
      const arcLiftY = Math.sin(rawAlign * Math.PI) * 0.55;
      const approachY = floatPosY + (hoverAboveY - floatPosY) * alignT + arcLiftY;

      s.worldPos[0] = floatPosX * (1.0 - alignT) + slotPosX * alignT;
      s.worldPos[1] = approachY * (1.0 - dropT) + slotPosY * dropT;
      s.worldPos[2] = floatPosZ * (1.0 - alignT) + slotPosZ * alignT;

      Mat4.fromTranslation(s.modelMatrix, s.worldPos);

      if (rotWeight > 0.0001) {
        const curRollZ = (cfg.rollZ + cfg.spinZ * travelSmooth + idleRoll) * rotWeight;
        const curTiltX = (cfg.tiltX + 0.10 * travelSmooth + idleTilt) * rotWeight;
        const curTiltY = (cfg.tiltY * (1.0 - 0.30 * travelSmooth) + idleTilt * 0.8) * rotWeight;

        Mat4.rotateY(s.modelMatrix, s.modelMatrix, this.camera.yaw * rotWeight);
        Mat4.rotateX(s.modelMatrix, s.modelMatrix, -this.camera.pitch * rotWeight);
        Mat4.rotateZ(s.modelMatrix, s.modelMatrix, curRollZ);
        Mat4.rotateX(s.modelMatrix, s.modelMatrix, curTiltX);
        Mat4.rotateY(s.modelMatrix, s.modelMatrix, curTiltY);
      }

      if (s.selectProgress > 0.001) {
        Mat4.rotateY(s.modelMatrix, s.modelMatrix, s.selectProgress * 0.25);
        Mat4.rotateX(s.modelMatrix, s.modelMatrix, -s.selectProgress * 0.18);
      }

      Mat4.invert(s.invModelMatrix, s.modelMatrix);
    }

    this._updateFocusSlides(dt, timeSec, aspect, tanHalfFov, camForward, camRight, camUp);
  }

  /**
   * Advance every slide's focus progress. Only the active victim's slide is pulled out;
   * on a swap the previous one heads home first and the next one leaves once it is clear.
   */
  _updateFocusSlides(dt, timeSec, aspect, tanHalfFov, camForward, camRight, camUp) {
    const active = this.outroUnlocked && this.revealProgress > 0.0 ? this.focusSlotIndex : -1;
    let othersOut = false;
    for (const s of this.slides) if (s.index !== active && s.focusLinear > 0.55) othersOut = true;
    const firstReveal = this.revealProgress < 1.0;

    for (const s of this.slides) {
      const target = s.index === active && !othersOut ? 1.0 : 0.0;
      if (s.focusLinear < target) {
        const speed = firstReveal ? 1.0 / 2.4 : 1.0 / 1.9;
        s.focusLinear = Math.min(target, s.focusLinear + dt * speed);
      } else if (s.focusLinear > target) {
        const speed = this.outroUnlocked ? 1.0 / 1.6 : 1.0 / 1.9;
        s.focusLinear = Math.max(target, s.focusLinear - dt * speed);
      }
      const p = s.focusLinear;
      s.focusProgress = p * p * (3.0 - 2.0 * p);
      // Clear of the box walls once lifted, so it can be drawn on the sharp layer
      s.focusDetached = p > 0.3;
      if (p > 0.0001) this._applyFocusSlide(s, timeSec, aspect, tanHalfFov, camForward, camRight, camUp);
    }
  }

  /**
   * Kill reveal: the focused slide rises straight out of its slot, then glides to a
   * camera-relative hero pose (large, diagonal) and keeps a slow idle float.
   */
  _applyFocusSlide(s, timeSec, aspect, tanHalfFov, camForward, camRight, camUp) {
    const rp = s.focusLinear;

    const liftT = smoothstep01(Math.min(1.0, rp / 0.3));
    const flyRaw = Math.min(1.0, Math.max(0.0, (rp - 0.22) / 0.78));
    // easeInOutCubic for a weighty, cinematic glide
    const flyT = flyRaw < 0.5 ? 4.0 * flyRaw * flyRaw * flyRaw : 1.0 - Math.pow(-2.0 * flyRaw + 2.0, 3.0) / 2.0;

    const pose = aspect >= 1.0 ? FOCUS_POSE.wide : FOCUS_POSE.tall;
    const ndcX = pose.ndcX + Math.sin(timeSec * 0.55) * 0.012 * flyT;
    const ndcY = pose.ndcY + Math.cos(timeSec * 0.7) * 0.02 * flyT;
    // Narrow screens: push the slide back so its full length fits the width
    const baseDepth = aspect >= 1.0 ? pose.depth : Math.min(5.0, Math.max(pose.depth, 1.5 / aspect));
    const depth = baseDepth + Math.sin(timeSec * 0.4) * 0.05 * flyT;
    const halfH = depth * tanHalfFov;
    const rx = ndcX * halfH * aspect;
    const uy = ndcY * halfH;
    const cp = this.camera.pos;
    const focusPos = this.focusPos;
    focusPos[0] = cp[0] + camForward[0] * depth + camRight[0] * rx + camUp[0] * uy;
    focusPos[1] = cp[1] + camForward[1] * depth + camRight[1] * rx + camUp[1] * uy;
    focusPos[2] = cp[2] + camForward[2] * depth + camRight[2] * rx + camUp[2] * uy;

    // Phase 1: lift out of the rack; Phase 2: fly to the focus pose (with a slight arc)
    const fromY = 0.34 + 1.15 * liftT;
    const arc = Math.sin(flyT * Math.PI) * 0.35;
    s.worldPos[0] = focusPos[0] * flyT;
    s.worldPos[1] = fromY + (focusPos[1] - fromY) * flyT + arc;
    s.worldPos[2] = s.slotZ + (focusPos[2] - s.slotZ) * flyT;

    Mat4.fromTranslation(s.modelMatrix, s.worldPos);
    // Face the camera, then lay the slide diagonally like a specimen under a lamp
    Mat4.rotateY(s.modelMatrix, s.modelMatrix, this.camera.yaw * flyT);
    Mat4.rotateX(s.modelMatrix, s.modelMatrix, -this.camera.pitch * flyT);
    Mat4.rotateZ(s.modelMatrix, s.modelMatrix, (pose.roll + Math.sin(timeSec * 0.5) * 0.025) * flyT);
    Mat4.rotateX(s.modelMatrix, s.modelMatrix, (pose.tiltX + Math.cos(timeSec * 0.6) * 0.03) * flyT);
    Mat4.rotateY(s.modelMatrix, s.modelMatrix, pose.tiltY * flyT);
    Mat4.invert(s.invModelMatrix, s.modelMatrix);
  }

  /**
   * Closed-box stage: the red haze fades in with a slow parallax drift, and the
   * "DEXTER KILLS" title grows out of the dark behind the box as the outro scrolls.
   */
  _initKillsStage(gsap, outroSection) {
    const bg = document.querySelector('.kills-bg');
    const headline = document.querySelector('.kills-headline');
    if (!bg || !headline) return;

    gsap.set(bg, { opacity: 0, yPercent: 6, scale: 1.08 });
    // Starts stretched wide instead of wide letter-spacing: animating letter-spacing re-lays out
    // and repaints the giant gradient text every frame, scaleX stays on the compositor
    gsap.set(headline, {
      opacity: 0,
      y: () => innerHeight * 0.32,
      scaleX: 1.45,
      filter: 'blur(18px)'
    });

    const scroll = { trigger: outroSection, start: 'top 90%', end: 'bottom bottom', scrub: 1.4 };

    // Background: fade in early, then keep drifting for the whole outro (parallax)
    const bgTl = gsap.timeline({ scrollTrigger: scroll, defaults: { ease: 'none' } });
    bgTl
      .to(bg, { yPercent: -6, scale: 1.0, duration: 1 }, 0)
      .to(bg, { opacity: 1, duration: 0.35, ease: 'power1.inOut' }, 0)
      // The page-wide grey haze would wash out the red background, so it bows out here
      .to('.dark-backdrop', { opacity: 0, duration: 0.35, ease: 'power1.inOut' }, 0)
      .to(this.backdropFx, { opacity: 0, duration: 0.35, ease: 'power1.inOut' }, 0);

    // Headline: hidden below at full size, then rises out of the dark into place.
    // It lands with the camera's final push-in on the box, just after the clasp hint appears (top 10%).
    gsap.timeline({ scrollTrigger: { ...scroll, start: 'top 40%', end: 'top 5%', invalidateOnRefresh: true } }).to(headline, {
      opacity: 0.86,
      y: 0,
      scaleX: 1,
      filter: 'blur(0px)',
      ease: 'power2.out',
      duration: 1
    });
  }

  _updateHints() {
    // Kill reveal: the title steps back so the dossier reads cleanly
    if (this.killsHeadlineWrap) {
      const fade = Math.round((1 - Math.min(1, this.revealProgress * 2)) * 100) / 100;
      if (fade !== this.killsHeadlineFade) {
        this.killsHeadlineFade = fade;
        this.killsHeadlineWrap.style.opacity = String(fade);
      }
    }

    // Clasp cue: box shut at the end of the outro — ring tracks the clasp in screen space
    if (this.claspHintEl) {
      const shut = Math.max(0, Math.min(1, (this.outroProgress - 0.9) / 0.1)) * Math.max(0, 1 - this.openTimeline * 8);
      const visible = this.outroUnlocked ? 0 : shut * Math.max(0, 1 - this.finaleProgress * 3);
      if (visible > 0.01) {
        const m = this.claspMatrix;
        const x = m[12], y = m[13] - 0.05, z = m[14];
        const v = this.viewProjMatrix;
        const cw = v[3] * x + v[7] * y + v[11] * z + v[15];
        const nx = (v[0] * x + v[4] * y + v[8] * z + v[12]) / cw;
        const ny = (v[1] * x + v[5] * y + v[9] * z + v[13]) / cw;
        this.claspHintEl.style.transform =
          `translate(${((nx * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((0.5 - ny * 0.5) * innerHeight).toFixed(1)}px)`;
      }
      this.claspHintEl.style.opacity = String(visible);
    }

    // "Ver lista de vítimas" under the shut box: same timing as the clasp cue
    if (this.listBtn) {
      const shut = Math.max(0, Math.min(1, (this.outroProgress - 0.9) / 0.1)) * Math.max(0, 1 - this.openTimeline * 8);
      const shown = this.outroUnlocked || this.victimList.isOpen
        ? 0
        : Math.round(shut * Math.max(0, 1 - this.finaleProgress * 3) * 100) / 100;
      if (shown !== this.listBtnShown) {
        this.listBtnShown = shown;
        this.listBtn.style.opacity = String(shown);
        this.listBtn.style.transform = `translate(-50%, ${((1 - shown) * 18).toFixed(1)}px)`;
        this.listBtn.classList.toggle('is-live', shown > 0.6);
      }
    }
  }

  _loop(now) {
    const dt = Math.min(0.05, (now - this.lastFrameTime) * 0.001);
    this.lastFrameTime = now;
    const timeSec = now * 0.001;

    this._updateKinematics(dt, timeSec);

    // Only draw the Trophy Box and stationary slides once approaching Section 4
    const boxVisible = this.smoothScrollProgress > 0.62;

    this._updateHints();

    this.renderer.render({
      viewMatrix: this.viewMatrix,
      projMatrix: this.projMatrix,
      viewProjMatrix: this.viewProjMatrix,
      cameraPos: this.camera.pos,
      lidOpenProgress: this.lidOpenProgress,
      time: timeSec,
      hoveredSlide: this.hoveredSlide,
      selectedSlide: this.selectedSlide,
      baseMatrix: this.baseMatrix,
      lidMatrix: this.lidMatrix,
      claspMatrix: this.claspMatrix,
      slides: this.slides,
      boxVisible,
      backgroundBlur: this.revealBlur,
      backdropOpacity: this.backdropFx.opacity
    });

    this.rafId = requestAnimationFrame((t) => this._loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new DexterBoxApp();
  window.__dexterApp = app;
  app.start();
  initBloodCursor();
});
