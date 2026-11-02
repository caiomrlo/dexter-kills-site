/**
 * Main Application Entry Point — Dexter's Blood Slide Trophy Box (WebGPU)
 * Handles camera orbit controls, 3D raycast picking, lid/latch kinematics,
 * and individual glass slide inspection.
 */

import { TrophyBoxRenderer } from './renderer.js';
import { BOX_SPECS, getSlideSlotZ } from './geometry.js';
import { Mat4, createRayFromCamera, intersectRayOBB } from './math.js';

// Initial / closed camera framing: straight-on front view (yaw 0) slightly above the box
const CLOSED_VIEW = { yaw: 0.0, pitch: 0.25, distance: 7.9, center: [0.0, 0.20, 0.0] };

class DexterBoxApp {
  constructor() {
    this.canvas = document.getElementById('webgpu-canvas');
    this.renderer = new TrophyBoxRenderer(this.canvas);

    // Camera Orbit State (starts front-aligned: latch facing the viewer, lid receding in depth)
    this.camera = {
      yaw: CLOSED_VIEW.yaw,
      pitch: CLOSED_VIEW.pitch,
      distance: CLOSED_VIEW.distance,
      target: [...CLOSED_VIEW.center],
      targetYaw: CLOSED_VIEW.yaw,
      targetPitch: CLOSED_VIEW.pitch,
      targetDistance: CLOSED_VIEW.distance,
      targetCenter: [...CLOSED_VIEW.center],
      pos: [0, 3, 8]
    };

    // Box State (Starts CLOSED as requested)
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
    try {
      await this.renderer.init();
      this._bindEvents();
      this._updateUI();
      requestAnimationFrame((t) => this._loop(t));
    } catch (err) {
      console.error('WebGPU initialization error:', err);
      const errOverlay = document.getElementById('webgpu-error');
      if (errOverlay) errOverlay.classList.remove('hidden');
      const dot = document.getElementById('gpu-status-dot');
      if (dot) {
        dot.style.background = '#ef4444';
        dot.style.boxShadow = '0 0 10px #ef4444';
      }
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

    // Mouse wheel zoom
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const zoomSpeed = 0.0045;
        this.camera.targetDistance = Math.max(
          2.6,
          Math.min(18.0, this.camera.targetDistance + e.deltaY * zoomSpeed)
        );
      },
      { passive: false }
    );

    // UI Buttons
    const toggleBtn = document.getElementById('toggle-box-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleBox());
    }

    const resetBtn = document.getElementById('reset-cam-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetCamera());
    }

    const closeInspectorBtn = document.getElementById('inspector-close');
    if (closeInspectorBtn) {
      closeInspectorBtn.addEventListener('click', () => this.selectSlide(-1));
    }

    const prevSlideBtn = document.getElementById('prev-slide-btn');
    if (prevSlideBtn) {
      prevSlideBtn.addEventListener('click', () => {
        if (this.selectedSlide > 0) {
          this.selectSlide(this.selectedSlide - 1);
        } else {
          this.selectSlide(BOX_SPECS.numSlides - 1);
        }
      });
    }

    const nextSlideBtn = document.getElementById('next-slide-btn');
    if (nextSlideBtn) {
      nextSlideBtn.addEventListener('click', () => {
        if (this.selectedSlide < BOX_SPECS.numSlides - 1) {
          this.selectSlide(this.selectedSlide + 1);
        } else {
          this.selectSlide(0);
        }
      });
    }

    window.addEventListener('resize', () => this.renderer.resize());
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
      this.camera.targetCenter = [0.0, 2.15, -0.85];
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
      this.camera.targetCenter = [0.0, 2.15, -0.85];
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
    const toggleText = document.getElementById('toggle-box-text');
    const toggleIcon = document.getElementById('toggle-box-icon');
    const hint = document.getElementById('contextual-hint');
    const counterVal = document.getElementById('slide-counter-value');
    const inspector = document.getElementById('slide-inspector');

    if (toggleText) {
      toggleText.textContent = this.isOpen ? 'Fechar Caixa' : 'Abrir Caixa';
    }
    if (toggleIcon) {
      toggleIcon.innerHTML = this.isOpen ? '&#128274;' : '&#128275;';
    }
    if (hint) {
      hint.innerHTML = this.isOpen
        ? '<strong>Passe o mouse / Clique nas lâminas:</strong> Inspecionar amostra'
        : '<strong>Clique no fecho dourado ou na tampa:</strong> Abrir caixa';
    }

    if (this.selectedSlide >= 0 && this.isOpen) {
      const num = this.selectedSlide + 1;
      const numStr = num < 10 ? `0${num}` : `${num}`;
      if (counterVal) counterVal.textContent = `LÂMINA #${numStr} / ${BOX_SPECS.numSlides}`;
      if (inspector) inspector.classList.remove('hidden');

      const inspId = document.getElementById('inspector-id');
      const metaSlot = document.getElementById('meta-slot');
      const metaDate = document.getElementById('meta-date');
      const metaCoag = document.getElementById('meta-coag');
      const dropEl = document.getElementById('inspector-drop');

      if (inspId) inspId.textContent = `AMOSTRA #${numStr}`;
      if (metaSlot) metaSlot.textContent = `${numStr} / ${BOX_SPECS.numSlides}`;
      if (metaDate) metaDate.textContent = `LINHA #${numStr} DO CATÁLOGO`;
      if (metaCoag) {
        const coagPct = (97.2 + ((num * 7) % 25) * 0.1).toFixed(1);
        metaCoag.textContent = `${coagPct}% SECO`;
      }
      if (dropEl) {
        const scale = 0.88 + ((num * 13) % 24) * 0.012;
        const rot = (num * 47) % 360;
        dropEl.style.transform = `scale(${scale}) rotate(${rot}deg)`;
      }
    } else {
      if ( this.hoveredSlide >= 0 && this.isOpen ) {
        const num = this.hoveredSlide + 1;
        const numStr = num < 10 ? `0${num}` : `${num}`;
        if (counterVal) counterVal.textContent = `SLOT #${numStr} (HOVER)`;
      } else {
        if (counterVal) counterVal.textContent = this.isOpen ? '45 AMOSTRAS EXPOSTAS' : 'CAIXA FECHADA';
      }
      if (inspector) inspector.classList.add('hidden');
    }
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

    // 1. If open, test intersection against all 45 glass slides first
    let closestSlide = -1;
    let minSlideT = Infinity;

    if (this.lidOpenProgress > 0.45) {
      const sW = BOX_SPECS.slideWidth / 2;
      const sH = BOX_SPECS.slideHeight / 2;
      // Slightly generous Z thickness for comfortable mouse picking of thin glass slides
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
    // 1. Smoothly damp camera orbit
    const camSmooth = 1.0 - Math.exp(-10.0 * dt);
    this.camera.yaw += (this.camera.targetYaw - this.camera.yaw) * camSmooth;
    this.camera.pitch += (this.camera.targetPitch - this.camera.pitch) * camSmooth;
    this.camera.distance += (this.camera.targetDistance - this.camera.distance) * camSmooth;
    for (let k = 0; k < 3; k++) {
      this.camera.target[k] += (this.camera.targetCenter[k] - this.camera.target[k]) * camSmooth;
    }

    const cosP = Math.cos(this.camera.pitch);
    const sinP = Math.sin(this.camera.pitch);
    const sinY = Math.sin(this.camera.yaw);
    const cosY = Math.cos(this.camera.yaw);

    this.camera.pos[0] = this.camera.target[0] + this.camera.distance * cosP * sinY;
    this.camera.pos[1] = this.camera.target[1] + this.camera.distance * sinP;
    this.camera.pos[2] = this.camera.target[2] + this.camera.distance * cosP * cosY;

    const aspect = Math.max(1, this.canvas.width) / Math.max(1, this.canvas.height);
    Mat4.perspectiveZO(this.projMatrix, (38 * Math.PI) / 180, aspect, 0.1, 45.0);
    // Shift the scene to the right half of the screen (headline lives on the left)
    const shiftX = 0;
    this.projMatrix[8] = -shiftX;
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
    // Smooth cubic ease-in-out
    this.lidOpenProgress = rawLid < 0.5
      ? 4.0 * rawLid * rawLid * rawLid
      : 1.0 - Math.pow(-2.0 * rawLid + 2.0, 3.0) / 2.0;

    // 3. Compute Base Matrix (Identity at world origin)
    Mat4.identity(this.baseMatrix);
    Mat4.invert(this.invBaseMatrix, this.baseMatrix);

    // 4. Compute Lid Matrix (pivots around back hinge at Y = 0.42, Z = -2.60)
    const maxLidAngle = -1.83; // ~ -105 degrees backward tilt matching Reference Image 2
    const lidAngle = this.lidOpenProgress * maxLidAngle;
    Mat4.fromTranslation(this.lidMatrix, [0.0, BOX_SPECS.hingeY, BOX_SPECS.hingeZ]);
    Mat4.rotateX(this.lidMatrix, this.lidMatrix, lidAngle);
    Mat4.invert(this.invLidMatrix, this.lidMatrix);

    // 5. Compute Swinging Brass Clasp Loop Matrix (attached to front of lid)
    Mat4.copy(this.claspMatrix, this.lidMatrix);
    Mat4.translate(this.claspMatrix, this.claspMatrix, [0.0, 0.08, BOX_SPECS.length + 0.025]);
    // Swings outward when unlocking, then rests neatly at the top rim of the open lid
    const claspSwingAngle = -Math.sin(this.claspOpenProgress * Math.PI * 0.5) * 0.95;
    Mat4.rotateX(this.claspMatrix, this.claspMatrix, claspSwingAngle);

    // 6. Update all 45 Glass Slides
    const slideSmooth = 1.0 - Math.exp(-12.0 * dt);
    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const s = this.slides[i];
      const targetHover = (this.isOpen && this.hoveredSlide === i && this.selectedSlide !== i) ? 1.0 : 0.0;
      const targetSelect = (this.isOpen && this.selectedSlide === i) ? 1.0 : 0.0;

      s.hoverProgress += (targetHover - s.hoverProgress) * slideSmooth;
      s.selectProgress += (targetSelect - s.selectProgress) * slideSmooth;

      // Neighbor wave effect when hovering a slide
      let neighborWave = 0.0;
      if (this.isOpen && this.hoveredSlide >= 0 && this.selectedSlide === -1) {
        const distSlots = Math.abs(i - this.hoveredSlide);
        if (distSlots > 0 && distSlots <= 3) {
          neighborWave = Math.max(0.0, (1.0 - distSlots / 3.5) * 0.055);
        }
      }

      // Base resting height of slide center is Y = 0.34 (bottom at 0.11, top at 0.57)
      const floatOsc = s.selectProgress > 0.01 ? Math.sin(timeSec * 2.6) * 0.025 * s.selectProgress : 0.0;
      const posY = 0.34 + s.hoverProgress * 0.19 + neighborWave + s.selectProgress * 0.95 + floatOsc;
      const posZ = s.slotZ + s.selectProgress * (0.35 - s.slotZ * 0.35);
      const posX = 0.0;

      s.worldPos[0] = posX;
      s.worldPos[1] = posY;
      s.worldPos[2] = posZ;

      Mat4.fromTranslation(s.modelMatrix, s.worldPos);
      if (s.selectProgress > 0.001) {
        // Tilt slightly toward the viewer when inspected
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

    requestAnimationFrame((t) => this._loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new DexterBoxApp();
  app.start();
});
