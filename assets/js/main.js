/**
 * Main Application Entry Point — Dexter's Blood Slide Trophy Box (WebGPU)
 * Integrates GSAP ScrollSmoother, ScrollTrigger, and SplitText across 4 sections
 * with 7 free-floating blood slides in Section 1 that smoothly travel down the page
 * and slot into the open 3D WebGPU Trophy Box in Section 4.
 */

import { TrophyBoxRenderer } from './renderer.js';
import { BOX_SPECS, getSlideSlotZ } from './geometry.js';
import { Mat4, createRayFromCamera, intersectRayOBB } from './math.js';

// Camera framing when the box is OPEN (closer framing filling more vertical viewport)
const OPEN_VIEW = { yaw: 0.0, pitch: 0.42, distance: 9.1, center: [0.0, 1.58, -0.20] };
// Camera framing when the box is CLOSED
const CLOSED_VIEW = { yaw: 0.0, pitch: 0.27, distance: 8.6, center: [0.0, 0.22, 0.0] };

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

  async start() {
    this._initScrollAndTypography();

    try {
      await this.renderer.init();
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

      // Section 5 (outro): box closes & moves right, headline reveals on the left
      const outroSection = document.getElementById('outro-section');
      const outroPin = outroSection?.querySelector('.outro-pin');
      const outroHeadline = outroSection?.querySelector('[data-split-outro]');
      if (outroSection && outroPin && outroHeadline) {
        ScrollTrigger.create({
          trigger: outroSection,
          start: 'top bottom',
          end: 'top top',
          scrub: true,
          onUpdate: (self) => {
            this.outroProgress = self.progress;
          }
        });

        ScrollTrigger.create({
          trigger: outroSection,
          start: 'top top',
          end: 'bottom bottom',
          pin: outroPin,
          pinSpacing: false,
          anticipatePin: 1
        });

        const split = SplitText.create(outroHeadline, { type: 'lines,words', linesClass: 'outro-line' });
        gsap.set(outroHeadline, { visibility: 'visible' });
        gsap.set(split.words, { opacity: 0, x: -60, force3D: true });
        gsap.to(split.words, {
          opacity: 1,
          x: 0,
          force3D: true,
          ease: 'power3.out',
          stagger: 0.12,
          scrollTrigger: {
            trigger: outroSection,
            start: 'top 55%',
            end: 'top 5%',
            scrub: 0.4
          }
        });

        const cta = outroSection.querySelector('.outro-cta');
        if (cta) {
          gsap.fromTo(cta, { opacity: 0, y: 20 }, {
            opacity: 1,
            y: 0,
            ease: 'power2.out',
            scrollTrigger: { trigger: outroSection, start: 'top 20%', end: 'top 5%', scrub: 0.4 }
          });
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
      this.isDragging = true;
      this.dragDistance = 0;
      this.pointerDownPos = [e.clientX, e.clientY];
      this.lastPointerPos = [e.clientX, e.clientY];
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.pageScrollProgress <= 0.84) return;
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
    const hit = this._raycastScene(clientX, clientY);

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
    const camMix = this.isOpen ? outroEase : 0.0;

    const effectiveTargetYaw = this.camera.targetYaw + yawOffset + 0.62 * camMix;
    const effectiveTargetPitch = Math.max(
      0.08,
      Math.min(1.48, this.camera.targetPitch + pitchOffset + (CLOSED_VIEW.pitch - OPEN_VIEW.pitch) * camMix)
    );
    const effectiveTargetDist = this.camera.targetDistance + (CLOSED_VIEW.distance - 1.7 - OPEN_VIEW.distance) * camMix;
    const effectiveTargetCenterY =
      this.camera.targetCenter[1] + scrollLiftY + (CLOSED_VIEW.center[1] - OPEN_VIEW.center[1]) * camMix;

    // 1. Smoothly damp camera orbit
    const camSmooth = 1.0 - Math.exp(-10.0 * dt);
    this.camera.yaw += (effectiveTargetYaw - this.camera.yaw) * camSmooth;
    this.camera.pitch += (effectiveTargetPitch - this.camera.pitch) * camSmooth;
    this.camera.distance += (effectiveTargetDist - this.camera.distance) * camSmooth;

    this.camera.target[0] += (this.camera.targetCenter[0] - this.camera.target[0]) * camSmooth;
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
    // Shift the whole scene to the right in screen space (clip.x += offset * clip.w)
    this.projMatrix[8] = -0.5 * outroEase;
    this.screenShiftX = 0.5 * outroEase;
    Mat4.lookAt(this.viewMatrix, this.camera.pos, this.camera.target, [0, 1, 0]);
    Mat4.multiply(this.viewProjMatrix, this.projMatrix, this.viewMatrix);
    Mat4.invert(this.invViewProjMatrix, this.viewProjMatrix);

    // Camera basis vectors in world space for positioning the 7 floating slides in camera frustum space
    // Forward vector from camera.pos toward camera.target:
    const camForward = [-cosP * sinY, -sinP, -cosP * cosY];
    // Right vector:
    const camRight = [cosY, 0.0, -sinY];
    // Up vector = Right x Forward:
    const camUp = [-sinP * sinY, cosP, -sinP * cosY];
    const tanHalfFov = Math.tan(fovy * 0.5);

    // 2. Box Open/Close Two-Stage Animation Timeline
    const targetTimeline = this.isOpen ? 1.0 : 0.0;
    const timelineSpeed = 1.35;
    if (this.openTimeline < targetTimeline) {
      this.openTimeline = Math.min(1.0, this.openTimeline + dt * timelineSpeed);
    } else if (this.openTimeline > targetTimeline) {
      this.openTimeline = Math.max(0.0, this.openTimeline - dt * timelineSpeed);
    }

    // Scroll-driven closing: box shuts during the first part of the outro
    if (this.isOpen && this.outroProgress > 0.001) {
      const closeT = Math.min(1.0, this.outroProgress / 0.55);
      this.openTimeline = Math.min(this.openTimeline, 1.0 - closeT);
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
  }

  _loop(now) {
    const dt = Math.min(0.05, (now - this.lastFrameTime) * 0.001);
    this.lastFrameTime = now;
    const timeSec = now * 0.001;

    this._updateKinematics(dt, timeSec);

    // Only draw the Trophy Box and stationary slides once approaching Section 4
    const boxVisible = this.smoothScrollProgress > 0.62;

    this.renderer.render({
      viewMatrix: this.viewMatrix,
      projMatrix: this.projMatrix,
      viewProjMatrix: this.viewProjMatrix,
      cameraPos: this.camera.pos,
      lidOpenProgress: this.lidOpenProgress,
      time: timeSec,
      screenShiftX: this.screenShiftX || 0,
      hoveredSlide: this.hoveredSlide,
      selectedSlide: this.selectedSlide,
      baseMatrix: this.baseMatrix,
      lidMatrix: this.lidMatrix,
      claspMatrix: this.claspMatrix,
      slides: this.slides,
      boxVisible
    });

    this.rafId = requestAnimationFrame((t) => this._loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new DexterBoxApp();
  window.__dexterApp = app;
  app.start();
});
