/**
 * Main Application Entry Point — Dexter's Blood Slide Trophy Box (WebGPU)
 * Integrates GSAP ScrollSmoother, ScrollTrigger, and SplitText across 4 sections
 * with the interactive 3D WebGPU Trophy Box in the 4th section.
 */

import { TrophyBoxRenderer } from './renderer.js';
import { BOX_SPECS, getSlideSlotZ } from './geometry.js';
import { Mat4, createRayFromCamera, intersectRayOBB } from './math.js';

// Initial / closed camera framing: straight-on front view (yaw 0) slightly above the box
const CLOSED_VIEW = { yaw: 0.0, pitch: 0.27, distance: 8.6, center: [0.0, 0.22, 0.0] };
// Entrance framing when Section 4 starts entering the viewport from below
const INTRO_OFFSET = { yaw: -0.55, pitch: 0.32, distance: 2.8, centerY: -0.35 };

class DexterBoxApp {
  constructor() {
    this.canvas = document.getElementById('webgpu-canvas');
    this.renderer = new TrophyBoxRenderer(this.canvas);

    // Camera Orbit State
    this.camera = {
      yaw: CLOSED_VIEW.yaw + INTRO_OFFSET.yaw,
      pitch: CLOSED_VIEW.pitch + INTRO_OFFSET.pitch,
      distance: CLOSED_VIEW.distance + INTRO_OFFSET.distance,
      target: [CLOSED_VIEW.center[0], CLOSED_VIEW.center[1] + INTRO_OFFSET.centerY, CLOSED_VIEW.center[2]],
      targetYaw: CLOSED_VIEW.yaw,
      targetPitch: CLOSED_VIEW.pitch,
      targetDistance: CLOSED_VIEW.distance,
      targetCenter: [...CLOSED_VIEW.center],
      pos: [0, 3, 8]
    };

    // Scroll-driven entrance progress into Section 4 (0 = entering bottom, 1 = fully arrived)
    this.scrollEntrance = 0.0;
    this.isViewerVisible = false;
    this.rafId = null;

    // Box State (Starts CLOSED)
    this.isOpen = false;
    this.openTimeline = 0.0; // 0.0 = fully closed & locked, 1.0 = fully open
    this.lidOpenProgress = 0.0;
    this.claspOpenProgress = 0.0;

    // Slide Interaction State
    this.hoveredSlide = -1;
    this.selectedSlide = -1;
    this.isHoveringBoxTrigger = false;

    this.slides = [];
    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const slotZ = getSlideSlotZ(i);
      this.slides.push({
        index: i,
        slotZ,
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
      // Render initial warm-up frame so the canvas is ready before scrolling into Section 4
      this._renderSingleFrame(performance.now());
      if (this.isViewerVisible) {
        this._startRenderLoop();
      }
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
          // Section 1: "ESTA É A NOITE." — Entrance animation on load (not tied to scroll)
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

            // Fade out the scroll indicator naturally as the user scrolls down
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
          // Section 2 ("E VAI ACONTECER DE NOVO E DE NOVO.")
          // & Section 3 ("TEM QUE ACONTECER.")
          // Words appear progressively as the section scrolls through the viewport
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

      // Section 4: Trophy Box 3D integration & active rendering lifecycle
      const trophySection = document.getElementById('trophy-section');
      if (trophySection) {
        // Pause/resume WebGPU loop when Section 4 is near/in viewport to prevent any scroll lag
        ScrollTrigger.create({
          trigger: trophySection,
          start: 'top 125%',
          end: 'bottom -25%',
          onToggle: (self) => {
            this.isViewerVisible = self.isActive;
            if (this.isViewerVisible) {
              this._startRenderLoop();
            } else {
              this._stopRenderLoop();
            }
          }
        });

        // Smooth camera dolly & rotation as the user scrolls into Section 4
        ScrollTrigger.create({
          trigger: trophySection,
          start: 'top bottom',
          end: 'top top',
          scrub: true,
          onUpdate: (self) => {
            this.scrollEntrance = self.progress;
          }
        });
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
    // Pointer controls on canvas
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.dragDistance = 0;
      this.pointerDownPos = [e.clientX, e.clientY];
      this.lastPointerPos = [e.clientX, e.clientY];
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
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

    // ResizeObserver avoids querying layout inside the render loop
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.renderer.device) {
          this.renderer.resize();
          if (!this.isViewerVisible) {
            this._renderSingleFrame(performance.now());
          }
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

  _stopRenderLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _renderSingleFrame(now) {
    if (!this.renderer.device) return;
    const timeSec = now * 0.001;
    this._updateKinematics(0.016, timeSec);
    this.renderer.render({
      viewProjMatrix: this.viewProjMatrix,
      cameraPos: this.camera.pos,
      lidOpenProgress: this.lidOpenProgress,
      time: timeSec,
      hoveredSlide: this.hoveredSlide,
      selectedSlide: this.selectedSlide,
      baseMatrix: this.baseMatrix,
      lidMatrix: this.lidMatrix,
      claspMatrix: this.claspMatrix,
      slides: this.slides
    });
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
      // Shift camera target and distance to frame the entire open lid (Y up to 5.44) and slides
      this.camera.targetCenter = [0.0, 2.15, -0.45];
      this.camera.targetDistance = 11.8;
      this.camera.targetPitch = 0.42;
    }
    this._updateUI();
  }

  resetCamera() {
    if (this.isOpen) {
      this.camera.targetYaw = 0.48;
      this.camera.targetPitch = 0.42;
      this.camera.targetDistance = 11.8;
      this.camera.targetCenter = [0.0, 2.15, -0.45];
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
    // Reserved for optional HUD indicators if present
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

    // When box is closed, clicking the lid or latch opens the box
    if (!this.isOpen) {
      if (hit.hitLidOrLatch) {
        this.toggleBox();
      }
      return;
    }

    // When box is open:
    if (hit.slideIndex >= 0) {
      this.selectSlide(hit.slideIndex);
      return;
    }

    // Clicking the open lid or front latch closes the box
    if (hit.hitLidOrLatch) {
      this.toggleBox();
    }
  }

  _updateKinematics(dt, timeSec) {
    // Smooth cubic ease-out of scroll entrance (0 -> 1 as Section 4 reaches top of viewport)
    const introRem = 1.0 - Math.min(1.0, Math.max(0.0, this.scrollEntrance));
    const introEase = introRem * introRem;

    const effectiveTargetYaw = this.camera.targetYaw + INTRO_OFFSET.yaw * introEase;
    const effectiveTargetPitch = Math.min(1.48, this.camera.targetPitch + INTRO_OFFSET.pitch * introEase);
    const effectiveTargetDist = this.camera.targetDistance + INTRO_OFFSET.distance * introEase;
    const effectiveTargetCenterY = this.camera.targetCenter[1] + INTRO_OFFSET.centerY * introEase;

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
    Mat4.perspectiveZO(this.projMatrix, (38 * Math.PI) / 180, aspect, 0.1, 45.0);
    Mat4.lookAt(this.viewMatrix, this.camera.pos, this.camera.target, [0, 1, 0]);
    Mat4.multiply(this.viewProjMatrix, this.projMatrix, this.viewMatrix);
    Mat4.invert(this.invViewProjMatrix, this.viewProjMatrix);

    // 2. Box Open/Close Two-Stage Animation Timeline
    const targetTimeline = this.isOpen ? 1.0 : 0.0;
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

    // 6. Update all 24 Glass Slides
    const slideSmooth = 1.0 - Math.exp(-12.0 * dt);
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
      const posY = 0.34 + s.hoverProgress * 0.19 + neighborWave + s.selectProgress * 0.95 + floatOsc;
      const posZ = s.slotZ + s.selectProgress * (0.35 - s.slotZ * 0.35);
      const posX = 0.0;

      s.worldPos[0] = posX;
      s.worldPos[1] = posY;
      s.worldPos[2] = posZ;

      Mat4.fromTranslation(s.modelMatrix, s.worldPos);
      if (s.selectProgress > 0.001) {
        Mat4.rotateY(s.modelMatrix, s.modelMatrix, s.selectProgress * 0.25);
        Mat4.rotateX(s.modelMatrix, s.modelMatrix, -s.selectProgress * 0.18);
      }
      Mat4.invert(s.invModelMatrix, s.modelMatrix);
    }
  }

  _loop(now) {
    if (!this.isViewerVisible) {
      this.rafId = null;
      return;
    }

    const dt = Math.min(0.05, (now - this.lastFrameTime) * 0.001);
    this.lastFrameTime = now;
    const timeSec = now * 0.001;

    this._updateKinematics(dt, timeSec);

    this.renderer.render({
      viewProjMatrix: this.viewProjMatrix,
      cameraPos: this.camera.pos,
      lidOpenProgress: this.lidOpenProgress,
      time: timeSec,
      hoveredSlide: this.hoveredSlide,
      selectedSlide: this.selectedSlide,
      baseMatrix: this.baseMatrix,
      lidMatrix: this.lidMatrix,
      claspMatrix: this.claspMatrix,
      slides: this.slides
    });

    this.rafId = requestAnimationFrame((t) => this._loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new DexterBoxApp();
  app.start();
});
