/**
 * Three.js PBR + Shadow + Post-Processing Renderer for Dexter's Blood Slide Box
 * Implements:
 * - Complete out-of-the-box Physical PBR (MeshPhysicalMaterial with Clearcoat, IOR, Normal & Roughness maps)
 * - Procedural Studio HDR Environment via PMREMGenerator for realistic reflections on glass, blood, brass & lacquer
 * - Real-time PCFSoftShadowMap + Studio Contact Shadows + Subtle Glossy Floor Reflection
 * - Dynamic back-to-front depth sorting for all 24 glass slides & 3D coagulated blood specimens
 * - Integrated Post-Processing (EffectComposer with 4x MSAA, subtle HDR Specular Bloom & ACES Filmic Output)
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

import {
  BOX_SPECS,
  buildBaseGroup,
  buildLidGroup,
  buildClaspGroup,
  createChamferedSlideGeometry
} from './geometry.js';

import {
  createWoodPBRMaps,
  createBrassPBRMaps,
  createRackPBRMaps,
  createIndexCardMaps,
  createBloodSpecimenVariants,
  createGlassSlideSurfaceMaps
} from './textures.js';

import { QUALITY } from './quality.js';

// Objects on this layer skip the (blurred) main pass and are drawn sharp on top
const FOCUS_LAYER = 1;
// Slides resting in the rack: seen by the main camera, skipped by the floor reflection camera
const RACK_LAYER = 2;

/**
 * Draws only the FOCUS_LAYER objects over the already-blurred frame (depth cleared,
 * colour kept), so the slide in focus stays crisp while the box behind is out of focus.
 */
class FocusLayerPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const oldAutoClear = renderer.autoClear;
    const oldBackground = this.scene.background;
    renderer.autoClear = false;
    this.scene.background = null;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    this.scene.background = oldBackground;
    renderer.autoClear = oldAutoClear;
  }
}

const shaderMat = (shader) =>
  new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(shader.uniforms),
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    depthTest: false,
    depthWrite: false
  });

/**
 * Depth-of-field blur for the kill reveal, done at half resolution.
 * Same two separable gaussian passes as before (spread given in UV units, so it looks the same),
 * at a quarter of the pixel cost. The result is scaled back up into the composer chain.
 */
class HalfResBlurPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.spread = 0; // in full-resolution pixels
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.copyMat = shaderMat(CopyShader);
    this.hMat = shaderMat(HorizontalBlurShader);
    this.vMat = shaderMat(VerticalBlurShader);
    this.quad = new FullScreenQuad(null);
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width / 2));
    const h = Math.max(1, Math.floor(height / 2));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
  }

  _draw(renderer, mat, input, output) {
    mat.uniforms.tDiffuse.value = input.texture;
    this.quad.material = mat;
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    const w = Math.max(1, readBuffer.width);
    const h = Math.max(1, readBuffer.height);
    const px = this.spread;
    this._draw(renderer, this.copyMat, readBuffer, this.rtA);
    this.hMat.uniforms.h.value = px / w;
    this._draw(renderer, this.hMat, this.rtA, this.rtB);
    this.vMat.uniforms.v.value = px / h;
    this._draw(renderer, this.vMat, this.rtB, this.rtA);
    this.hMat.uniforms.h.value = (px * 2.0) / w;
    this._draw(renderer, this.hMat, this.rtA, this.rtB);
    this.vMat.uniforms.v.value = (px * 2.0) / h;
    this._draw(renderer, this.vMat, this.rtB, this.rtA);
    this._draw(renderer, this.copyMat, this.rtA, this.renderToScreen ? null : writeBuffer);
  }
}

const MAX_DOF_SLIDES = 7;
const DOF_CORNERS = [
  [-BOX_SPECS.slideWidth / 2, -BOX_SPECS.slideHeight / 2],
  [BOX_SPECS.slideWidth / 2, -BOX_SPECS.slideHeight / 2],
  [BOX_SPECS.slideWidth / 2, BOX_SPECS.slideHeight / 2],
  [-BOX_SPECS.slideWidth / 2, BOX_SPECS.slideHeight / 2]
];
const _dofCorner = new THREE.Vector3();
const _dofView = new THREE.Vector3();

/**
 * Depth of field for the free-floating slides (Sections 1-3): each slide gets its own blur amount.
 * The frame is blurred twice (soft at half res, softer at quarter res), then each pixel blends
 * sharp -> soft -> softer by the amount of the slide covering it. Slides are masked by their
 * projected outline, padded so the blurred edge can spill out. Off when every slide is sharp.
 */
class SlideDepthBlurPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.scale = 1; // blur spread multiplier (drawing-buffer height / 900)
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtHalfA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtHalfB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtHalfC = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtQuarterA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtQuarterB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.copyMat = shaderMat(CopyShader);
    this.hMat = shaderMat(HorizontalBlurShader);
    this.vMat = shaderMat(VerticalBlurShader);

    const quads = [];
    for (let i = 0; i < MAX_DOF_SLIDES * 2; i++) quads.push(new THREE.Vector4());
    const params = [];
    for (let i = 0; i < MAX_DOF_SLIDES; i++) params.push(new THREE.Vector2());
    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tSharp: { value: null },
        tSoft: { value: null },
        tMedium: { value: null },
        tSofter: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCount: { value: 0 },
        uQuads: { value: quads },  // 2 per slide: corners (a, b) and (c, d) in buffer pixels, CCW
        uParams: { value: params } // x = blur amount, y = edge padding in pixels
      },
      vertexShader: CopyShader.vertexShader,
      fragmentShader: /* glsl */ `
        #define MAX_SLIDES ${MAX_DOF_SLIDES}
        uniform sampler2D tSharp;
        uniform sampler2D tSoft;
        uniform sampler2D tMedium;
        uniform sampler2D tSofter;
        uniform vec2 uRes;
        uniform int uCount;
        uniform vec4 uQuads[MAX_SLIDES * 2];
        uniform vec2 uParams[MAX_SLIDES];
        varying vec2 vUv;

        float edgeDist(vec2 p, vec2 a, vec2 b) {
          vec2 e = b - a;
          return dot(p - a, normalize(vec2(e.y, -e.x)));
        }

        void main() {
          vec2 p = vUv * uRes;
          float amt = 0.0;
          // Far -> near order, so a nearer slide wins where two overlap
          for (int i = 0; i < MAX_SLIDES; i++) {
            if (i >= uCount) break;
            vec4 q0 = uQuads[i * 2];
            vec4 q1 = uQuads[i * 2 + 1];
            float d = edgeDist(p, q0.xy, q0.zw);
            d = max(d, edgeDist(p, q0.zw, q1.xy));
            d = max(d, edgeDist(p, q1.xy, q1.zw));
            d = max(d, edgeDist(p, q1.zw, q0.xy));
            float mask = 1.0 - smoothstep(0.0, uParams[i].y, d);
            amt = mix(amt, uParams[i].x, mask);
          }
          vec4 sharp = texture2D(tSharp, vUv);
          if (amt < 0.002) { gl_FragColor = sharp; return; }
          // Short steps between close levels so no crisp outline ghosts over a wide haze
          vec4 soft = texture2D(tSoft, vUv);
          vec4 col;
          if (amt < 0.15) {
            col = mix(sharp, soft, amt / 0.15);
          } else if (amt < 0.45) {
            col = mix(soft, texture2D(tMedium, vUv), (amt - 0.15) / 0.3);
          } else {
            col = mix(texture2D(tMedium, vUv), texture2D(tSofter, vUv), (amt - 0.45) / 0.55);
          }
          gl_FragColor = col;
        }
      `,
      depthTest: false,
      depthWrite: false
    });
    this.quad = new FullScreenQuad(null);
  }

  setSize(width, height) {
    const hw = Math.max(1, Math.floor(width / 2));
    const hh = Math.max(1, Math.floor(height / 2));
    const qw = Math.max(1, Math.floor(width / 4));
    const qh = Math.max(1, Math.floor(height / 4));
    this.rtHalfA.setSize(hw, hh);
    this.rtHalfB.setSize(hw, hh);
    this.rtHalfC.setSize(hw, hh);
    this.rtQuarterA.setSize(qw, qh);
    this.rtQuarterB.setSize(qw, qh);
  }

  _draw(renderer, mat, input, output) {
    mat.uniforms.tDiffuse.value = input.texture;
    this.quad.material = mat;
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
  }

  // One separable gaussian round (a -> tmp -> out); px = tap spacing in full-resolution pixels
  _blur(renderer, a, tmp, out, w, h, px) {
    this.hMat.uniforms.h.value = px / w;
    this._draw(renderer, this.hMat, a, tmp);
    this.vMat.uniforms.v.value = px / h;
    this._draw(renderer, this.vMat, tmp, out);
  }

  render(renderer, writeBuffer, readBuffer) {
    const w = Math.max(1, readBuffer.width);
    const h = Math.max(1, readBuffer.height);
    const k = this.scale;
    // Sigma at 900 px tall: soft ~5 px, medium ~12 px, softer ~31 px (each built on the previous)
    this._draw(renderer, this.copyMat, readBuffer, this.rtHalfA);
    this._blur(renderer, this.rtHalfA, this.rtHalfB, this.rtHalfA, w, h, 2.5 * k);
    this._blur(renderer, this.rtHalfA, this.rtHalfB, this.rtHalfC, w, h, 5.0 * k);
    this._draw(renderer, this.copyMat, this.rtHalfC, this.rtQuarterA);
    this._blur(renderer, this.rtQuarterA, this.rtQuarterB, this.rtQuarterA, w, h, 6.0 * k);
    this._blur(renderer, this.rtQuarterA, this.rtQuarterB, this.rtQuarterA, w, h, 12.0 * k);

    const u = this.compositeMat.uniforms;
    u.tSharp.value = readBuffer.texture;
    u.tSoft.value = this.rtHalfA.texture;
    u.tMedium.value = this.rtHalfC.texture;
    u.tSofter.value = this.rtQuarterA.texture;
    u.uRes.value.set(w, h);
    this.quad.material = this.compositeMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

/**
 * The page's dark atmosphere: a red smoke photo that slides to the right as the page scrolls
 * (Section 1 -> the box), plus a vignette. Screen-blended over the frame inside
 * the OutputPass right after tone mapping + sRGB, so it costs no extra full-screen pass.
 * Works in display (sRGB) space, like the browser did.
 */
const SMOKE_URL = 'assets/img/backgrounds/smoke-bg.webp';
const SMOKE_MIN_WIDTH = 1.5; // image is at least 1.5x the viewport width, so there is room to pan
const SMOKE_STRENGTH = 0.6;  // brightness of the smoke (1 = the photo as is)

const BACKDROP_GLSL = /* glsl */ `
  uniform float uBackdrop;
  uniform vec2 uResolution;  // CSS pixels
  uniform float uPixelRatio;
  uniform sampler2D uSmoke;
  uniform vec2 uSmokeSize;   // image size in pixels
  uniform float uSmokePan;   // 0 = top of the page, 1 = the box

  vec4 applyBackdrop(vec4 frame, vec2 uv) {
    vec2 res = uResolution;
    vec2 p = vec2(uv.x, 1.0 - uv.y) * res; // CSS pixels, y down

    // Smoke: covers the screen, wider than it, left edge travels from -overflow to 0 (moves right)
    float scale = max(res.y / uSmokeSize.y, res.x * ${SMOKE_MIN_WIDTH.toFixed(2)} / uSmokeSize.x);
    vec2 size = uSmokeSize * scale;
    vec2 origin = vec2(-(size.x - res.x) * (1.0 - uSmokePan), (res.y - size.y) * 0.5);
    vec2 st = (p - origin) / size;
    // Toned down so the smoke stays in the background (no white grain: it greyed the whole page)
    vec3 s = texture2D(uSmoke, vec2(st.x, 1.0 - st.y)).rgb * ${SMOKE_STRENGTH.toFixed(2)};

    // Vignette: farthest-corner ellipse, transparent 40% -> black 0.9 at 100%, multiply
    float dv = length((p - res * 0.5) / (res * 0.5)) / 1.41421356;
    s *= 1.0 - 0.9 * clamp((dv - 0.4) / 0.6, 0.0, 1.0);

    // screen(frame over the black page, backdrop)
    vec3 scr = 1.0 - (1.0 - frame.rgb) * (1.0 - s);
    return mix(frame, vec4(scr, 1.0), uBackdrop);
  }
`;

/** Adds the backdrop to an OutputPass (runs after its tone mapping and sRGB conversion). */
function addBackdropToOutput(outputPass) {
  Object.assign(outputPass.uniforms, {
    uBackdrop: { value: 1.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1.0 },
    uSmoke: { value: null },
    uSmokeSize: { value: new THREE.Vector2(2000, 1000) },
    uSmokePan: { value: 0.0 }
  });
  const fs = outputPass.material.fragmentShader;
  const mainAt = fs.indexOf('void main()');
  const endAt = fs.lastIndexOf('}');
  outputPass.material.fragmentShader =
    fs.slice(0, mainAt) +
    BACKDROP_GLSL +
    fs.slice(mainAt, endAt) +
    '  if (uBackdrop > 0.001) gl_FragColor = applyBackdrop(gl_FragColor, vUv);\n}\n';
  outputPass.material.needsUpdate = true;
}

/** Loads the smoke photo into the backdrop (kept in sRGB: the backdrop runs in display space). */
async function loadSmoke(outputPass) {
  try {
    const tex = await new THREE.TextureLoader().loadAsync(SMOKE_URL);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    outputPass.uniforms.uSmoke.value = tex;
    outputPass.uniforms.uSmokeSize.value.set(tex.image.width, tex.image.height);
  } catch (err) {
    console.warn('Smoke background failed to load', err);
  }
}

export class TrophyBoxRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.device = null; // truthy flag used by main.js to verify renderer is initialized
    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.bloomPass = null;

    this.boxRoot = null;
    this.baseGroup = null;
    this.lidGroup = null;
    this.claspGroup = null;
    this.reflector = null;

    this.slideObjects = [];
    this.keyPoint = null;
    this.rimPoint = null;
    this._forceRender = true; // draw the next frame even if nothing moved
    this.maxPixelRatio = QUALITY.maxPixelRatio; // lowered at runtime by the adaptive quality in main.js
  }

  async init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      // The composer renders into its own MSAA target, so canvas antialiasing would be wasted
      antialias: false,
      powerPreference: 'high-performance',
      // Transparent so the closed-box stage (background + headline) shows behind the box
      alpha: true
    });

    this.renderer.setClearColor(0x000000, 0.0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Only the box casts shadows: the map is redrawn when the lid or clasp move (see render())
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.device = this.renderer;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50.0);
    this.camera.layers.enable(RACK_LAYER);

    // 1. Generate Studio PMREM Environment Map for realistic PBR reflections
    this._createStudioEnvironment();

    // 2. Generate Procedural PBR Textures & Materials
    this._createMaterials();

    // 3. Build Scene Hierarchy (Trophy Box, Floor Reflection, 24 Microscope Slides)
    this._buildSceneGraph();

    // 4. Configure Studio Lighting & Real Shadow Mapping
    this._setupLights();

    // 5. Configure Integrated Post-Processing (4x MSAA + Subtle HDR Specular Bloom + ACES Output)
    this._setupPostProcessing();

    this.resize();
    if (this.outputPass) await loadSmoke(this.outputPass);
    await this._warmUp();
  }

  /**
   * Compiles every shader up front (box, blood, glass, shadows, reflection, dossier blur)
   * so nothing stalls the first time it scrolls into view.
   */
  async _warmUp() {
    const cam = this.camera;
    cam.position.set(0, 3.5, 8.0);
    cam.lookAt(0, 0.6, 0);
    cam.updateMatrixWorld();

    // Programs are built for the target they render into (linear HDR buffer, not the canvas)
    this.renderer.setRenderTarget(this.composer.readBuffer);
    // Rack glass is swapped in at runtime: put it on one slide so it gets compiled too
    const probe = this.slideObjects[this.slideObjects.length - 1];
    probe.glassMesh.material = probe.rackMats;
    if (this.renderer.compileAsync) {
      try {
        await this.renderer.compileAsync(this.scene, cam);
      } catch (e) {
        /* falls back to compiling during the warm-up frame */
      }
    }
    this.renderer.setRenderTarget(null);

    this.blurPass.enabled = true;
    this.slideDofPass.enabled = true;
    this.focusPass.enabled = true;
    this.focusCamera.copy(cam, false);
    this.focusCamera.layers.set(FOCUS_LAYER);
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
    this.blurPass.enabled = false;
    this.slideDofPass.enabled = false;
    this.focusPass.enabled = false;
    probe.glassMesh.material = probe.fullMats;

    // Nothing from the warm-up frame stays on screen
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.shadowMap.needsUpdate = true;
    this._forceRender = true;
  }

  /**
   * Builds a virtual 3D photography studio dome with softboxes and bakes it into a PMREM environment map
   */
  _createStudioEnvironment() {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileCubemapShader();

    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x282422);

    const addPanel = (pos, lookAt, w, h, color, intensity) => {
      const geom = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(...pos);
      mesh.lookAt(...lookAt);
      envScene.add(mesh);
    };

    // Balanced studio softboxes + floor bounce so glass edges never reflect pitch black
    addPanel([0.0, 9.0, 2.0], [0, 0, 0], 7.5, 5.5, 0xfff6eb, 1.05);
    addPanel([-7.5, 5.2, 2.5], [0, 0, 0], 6.5, 5.5, 0xd8e6f8, 0.90);
    addPanel([0.0, 6.2, -8.0], [0, 0, 0], 10.0, 2.8, 0xfff1dc, 0.95);
    addPanel([7.5, 3.5, -1.0], [0, 0, 0], 5.0, 4.0, 0xffeedd, 0.75);
    addPanel([0.0, -6.5, 0.0], [0, 0, 0], 12.0, 12.0, 0xd8cfc4, 0.65);

    const envRT = pmremGenerator.fromScene(envScene, 0.03);
    this.scene.environment = envRT.texture;
    pmremGenerator.dispose();

    // Plain cube map of the same studio for the cheap rack glass (one texture lookup per pixel)
    this.envCubeRT = new THREE.WebGLCubeRenderTarget(128, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter
    });
    new THREE.CubeCamera(0.1, 100, this.envCubeRT).update(this.renderer, envScene);
  }

  _createMaterials() {
    const maxAniso = Math.min(16, this.renderer.capabilities.getMaxAnisotropy() || 8);

    const woodMaps = createWoodPBRMaps(maxAniso);
    const brassMaps = createBrassPBRMaps(maxAniso);
    const rackMaps = createRackPBRMaps(maxAniso);
    const cardMaps = createIndexCardMaps(maxAniso);
    this.bloodVariants = createBloodSpecimenVariants(maxAniso);
    this.glassSurfaceMaps = createGlassSlideSurfaceMaps(maxAniso);

    // 1. Honduras Mahogany / Rosewood with Warm Satin-Lacquer Finish
    const Lacquered = QUALITY.physicalMaterials ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const physicalOnly = (params) => {
      if (QUALITY.physicalMaterials) return params;
      const out = { ...params };
      for (const k of ['clearcoat', 'clearcoatRoughness', 'clearcoatNormalMap', 'clearcoatNormalScale', 'ior', 'reflectivity']) delete out[k];
      return out;
    };

    this.woodMat = new Lacquered(physicalOnly({
      map: woodMaps.map,
      normalMap: woodMaps.normalMap,
      normalScale: new THREE.Vector2(0.24, 0.24),
      roughnessMap: woodMaps.roughnessMap,
      roughness: 0.26,
      metalness: 0.02,
      clearcoat: 0.45,
      clearcoatRoughness: 0.20,
      clearcoatNormalMap: woodMaps.normalMap,
      clearcoatNormalScale: new THREE.Vector2(0.12, 0.12),
      ior: 1.48,
      reflectivity: 0.65,
      envMapIntensity: 1.10
    }));

    // 2. Brushed Antique Brass Hardware
    this.brassMat = new Lacquered(physicalOnly({
      map: brassMaps.map,
      normalMap: brassMaps.normalMap,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughnessMap: brassMaps.roughnessMap,
      roughness: 0.20,
      metalness: 0.92,
      clearcoat: 0.32,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.50
    }));

    // Dark recessed screw slot material
    this.darkBrassSlotMat = new THREE.MeshStandardMaterial({
      color: 0x1a1106,
      roughness: 0.7,
      metalness: 0.4
    });

    // 3. Slotted Cream/Ivory Wood Rack
    this.rackMat = new THREE.MeshStandardMaterial({
      map: rackMaps.map,
      normalMap: rackMaps.normalMap,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughness: 0.58,
      metalness: 0.0,
      envMapIntensity: 0.32
    });

    // Bright cream floor lining beneath the slides (so the 13 crimson blood drops pop vividly)
    this.floorLiningMat = new THREE.MeshStandardMaterial({
      color: 0xf4eee2,
      map: rackMaps.map,
      roughness: 0.65,
      metalness: 0.0,
      envMapIntensity: 0.28
    });

    // 4. Recessed Numbered Index Card (01 - 24)
    this.indexCardMat = new THREE.MeshStandardMaterial({
      map: cardMaps.map,
      roughness: 0.82,
      metalness: 0.0,
      envMapIntensity: 0.18,
      side: THREE.DoubleSide
    });

    // 5/6. Glass slide faces + edges are created per slide by _createGlassFaceMaterial()
    // and _createGlassEdgeMaterial() (each slide needs its own uniforms; the shader program is shared).

    // 7. 4 Coagulated Blood Drop Specimen Physical Materials
    // Uses ruby-tinted specularColor (0xff3838) so surface highlights on the 3D meniscus
    // stay rich wet-crimson and never wash out into chalky pastel pink!
    this.bloodMaterials = this.bloodVariants.map((variant) => {
      return new THREE.MeshPhysicalMaterial({
        map: variant.map,
        normalMap: variant.normalMap,
        normalScale: new THREE.Vector2(1.15, 1.15),
        roughnessMap: variant.roughnessMap,
        roughness: 0.22,
        metalness: 0.0,
        specularColor: new THREE.Color(0xff3838),
        specularIntensity: 0.45,
        clearcoat: 0.0,
        ior: 1.46,
        envMapIntensity: 0.15,
        emissive: new THREE.Color(0x6b050b),
        emissiveMap: variant.map,
        emissiveIntensity: 0.68,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });
    });
  }

  /**
   * Cheap "fake" optical glass for the slide faces.
   * - Black albedo: glass has no diffuse colour, only reflections (env + lights) are kept.
   * - Premultiplied-style blending (ONE, ONE_MINUS_SRC_ALPHA): reflections are added on top,
   *   while alpha only slightly dims what is behind, so the face reads as see-through glass.
   * - Fresnel, thin bright bevel rim, view-dependent sheen streak and a shared scratch layer
   *   are all computed in the fragment shader: no extra render passes or render targets.
   */
  _createGlassFaceMaterial(index, hasBlood) {
    const seed = index + 1.0;
    const uniforms = {
      uScratchMap: { value: this.glassSurfaceMaps.scratchMap },
      uPresence: { value: 1.0 }, // 1 = free-floating hero slide, 0 = stacked inside the box
      uActive: { value: 0.0 },   // hover / select highlight
      uFocus: { value: 0.0 },    // kill reveal: slide held up close to the camera
      uBlood: {
        value: new THREE.Vector3(
          hasBlood ? 1.0 : 0.0,
          Math.sin(seed * 17.3) * 0.030,
          Math.cos(seed * 29.1) * 0.016
        )
      },
      uSeed: { value: seed }
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      normalMap: this.glassSurfaceMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.04,
      metalness: 0.0,
      envMapIntensity: 1.6,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor
    });
    mat.userData.glassUniforms = uniforms;

    mat.customProgramCacheKey = () => 'dexter-glass-face-v2';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGlassUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGlassUv = uv;');

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vGlassUv;
          uniform sampler2D uScratchMap;
          uniform float uPresence;
          uniform float uActive;
          uniform float uFocus;
          uniform vec3 uBlood;
          uniform float uSeed;`
        )
        .replace(
          '#include <opaque_fragment>',
          `
          vec3 gV = normalize(vViewPosition);
          vec3 gN = normalize(normal);
          float gNoV = clamp(abs(dot(gN, gV)), 0.0, 1.0);
          float gFres = pow(1.0 - gNoV, 4.0);

          // Physical slide coordinates (1.36 x 0.46), centered
          vec2 gP = (vGlassUv - 0.5) * vec2(1.36, 0.46);
          vec2 gEd = vec2(0.68, 0.23) - abs(gP);
          float gEdge = min(gEd.x, gEd.y);
          float gRim = 1.0 - smoothstep(0.0, 0.009, gEdge);      // razor-thin polished bevel
          float gRimGlow = 1.0 - smoothstep(0.0, 0.045, gEdge);  // soft inner glow along the edge

          // Soft-compress strong reflections so grazing angles stay glassy instead of milky,
          // and sun-like light hits don't blow out into big bloom blobs
          vec3 gSpec = totalSpecular * 1.35 * (1.0 - 0.55 * uFocus);
          gSpec = gSpec / (1.0 + gSpec * 0.9);
          float gSpecLum = dot(gSpec, vec3(0.299, 0.587, 0.114));

          // View-dependent diagonal sheen streak that slides across the face as the slide turns
          float gT = gP.x * 0.32 + gP.y;
          float gC = gN.x * 0.55 - gN.y * 0.35 + sin(uSeed * 3.7) * 0.12;
          float gStreak = exp(-pow((gT - gC) / 0.07, 2.0)) * 0.55 + exp(-pow((gT - gC + 0.16) / 0.025, 2.0)) * 0.35;

          // Wear layer: only visible where light reflects (plus a whisper everywhere)
          float gScratch = texture2D(uScratchMap, vGlassUv).r;

          // Faint crimson tint bleeding into the glass around the blood drop
          float gBloodD = length(gP - uBlood.yz);
          float gBloodHalo = uBlood.x * exp(-pow(gBloodD / 0.24, 2.0));

          // Rim tint: cool soda-lime green, warming to crimson at one end like a red back light
          float gRedSide = smoothstep(0.1, 0.68, gP.x * sign(sin(uSeed * 5.1) + 0.001));
          vec3 gRimCol = mix(vec3(0.80, 0.96, 0.90), vec3(1.0, 0.28, 0.24), gRedSide * (0.45 + 0.5 * uFocus));
          gRimCol = mix(gRimCol, vec3(0.95, 0.96, 1.0), (1.0 - gRedSide) * uFocus * 0.6);

          // Free-floating slides (Sections 1-3) read lighter: clearer body, softer bevel
          float gClear = uPresence * (1.0 - uFocus);

          vec3 gCol = gSpec * 0.85 * (1.0 - 0.35 * gClear);
          gCol += gRimCol * gRim * (0.95 + gSpecLum * 2.5 + gFres) * (0.6 + 0.4 * uPresence) * (1.0 - 0.25 * gClear);
          gCol += gRimCol * gRimGlow * 0.06;
          gCol += vec3(0.62, 0.68, 0.68) * 0.028 * (0.4 + 0.6 * uPresence) * (1.0 - 0.8 * uFocus) * (1.0 - 0.5 * gClear); // faint glass body haze
          gCol += vec3(0.85, 0.92, 0.95) * gStreak * (0.06 + gSpecLum * 0.6) * (0.5 + 0.5 * uPresence) * (1.0 - 0.35 * gClear);
          gCol += vec3(0.88, 0.94, 1.0) * gScratch * (0.05 + gSpecLum * 2.2 + gFres * 0.4) * (1.0 - 0.45 * uFocus) * (1.0 - 0.4 * gClear);
          gCol += vec3(0.55, 0.02, 0.03) * gBloodHalo * (0.07 + 0.12 * uFocus);
          gCol += vec3(1.0, 0.1, 0.12) * gRimGlow * gRedSide * 0.35 * uFocus; // red light bleeding in at one end
          gCol += vec3(1.0, 0.86, 0.52) * uActive * (0.05 + gRim * 0.9 + gRimGlow * 0.12);

          // Alpha = how much the glass dims what is behind it (mostly clear)
          float gA = 0.03 + 0.05 * uPresence + gFres * 0.30 + gRim * 0.40 + gSpecLum * 0.25 + gScratch * 0.04;
          gA *= 1.0 - 0.45 * gClear * (1.0 - 0.4 * gRim); // body clears more than the bevel
          gCol *= 1.0 - 0.35 * uFocus * (1.0 - gRim);
          gCol *= 1.0 - 0.45 * gClear * (1.0 - gRim); // floating: clearer body (the bevel is dimmed above)
          gl_FragColor = vec4(gCol, clamp(gA, 0.0, 0.92));
          `
        );
    };
    return mat;
  }

  /**
   * Cheap stand-in for the glass face while a slide rests in the rack.
   * There, 24 transparent slides stack up behind each other, so every rack pixel runs the face
   * shader many times. The full face is a MeshStandardMaterial lit by every light in the scene;
   * at that distance only its environment reflection shows (the light glints on 0.04-roughness
   * glass are a few pixels wide), so this one keeps the same look with a single cube-map lookup
   * plus the same fresnel/rim/streak/scratch layer. Shares its uniforms with the full face.
   */
  _createRackGlassMaterial(faceMat) {
    const uniforms = {
      ...faceMat.userData.glassUniforms,
      uEnv: { value: this.envCubeRT.texture },
      uEnvIntensity: { value: 1.6 }
    };
    return new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      vertexShader: `
        varying vec2 vGlassUv;
        varying vec3 vViewNormal;
        varying vec3 vViewPos;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vGlassUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 mv = viewMatrix * wp;
          vViewPos = mv.xyz;
          vViewNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform samplerCube uEnv;
        uniform float uEnvIntensity;
        uniform sampler2D uScratchMap;
        uniform float uPresence;
        uniform float uActive;
        uniform float uFocus;
        uniform vec3 uBlood;
        uniform float uSeed;
        varying vec2 vGlassUv;
        varying vec3 vViewNormal;
        varying vec3 vViewPos;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;

        void main() {
          vec3 gV = normalize(vViewPos);
          vec3 gN = normalize(vViewNormal);
          float gNoV = clamp(abs(dot(gN, gV)), 0.0, 1.0);
          float gFres = pow(1.0 - gNoV, 4.0);

          // Environment specular as MeshStandardMaterial computes it (roughness 0.0525, F0 0.04)
          vec3 wN = normalize(vWorldNormal);
          vec3 wI = normalize(vWorldPos - cameraPosition);
          vec3 radiance = textureCube(uEnv, reflect(wI, wN)).rgb * uEnvIntensity;
          const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
          const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
          vec4 r = 0.0525 * c0 + c1;
          float a004 = min(r.x * r.x, exp2(-9.28 * gNoV)) * r.x + r.y;
          vec2 fab = vec2(-1.04, 1.04) * a004 + r.zw;
          vec3 totalSpecular = radiance * (0.04 * fab.x + fab.y);

          // ---- same layer as the full glass face (_createGlassFaceMaterial) ----
          vec2 gP = (vGlassUv - 0.5) * vec2(1.36, 0.46);
          vec2 gEd = vec2(0.68, 0.23) - abs(gP);
          float gEdge = min(gEd.x, gEd.y);
          float gRim = 1.0 - smoothstep(0.0, 0.009, gEdge);
          float gRimGlow = 1.0 - smoothstep(0.0, 0.045, gEdge);

          vec3 gSpec = totalSpecular * 1.35 * (1.0 - 0.55 * uFocus);
          gSpec = gSpec / (1.0 + gSpec * 0.9);
          float gSpecLum = dot(gSpec, vec3(0.299, 0.587, 0.114));

          float gT = gP.x * 0.32 + gP.y;
          float gC = gN.x * 0.55 - gN.y * 0.35 + sin(uSeed * 3.7) * 0.12;
          float gStreak = exp(-pow((gT - gC) / 0.07, 2.0)) * 0.55 + exp(-pow((gT - gC + 0.16) / 0.025, 2.0)) * 0.35;

          float gScratch = texture2D(uScratchMap, vGlassUv).r;

          float gBloodD = length(gP - uBlood.yz);
          float gBloodHalo = uBlood.x * exp(-pow(gBloodD / 0.24, 2.0));

          float gRedSide = smoothstep(0.1, 0.68, gP.x * sign(sin(uSeed * 5.1) + 0.001));
          vec3 gRimCol = mix(vec3(0.80, 0.96, 0.90), vec3(1.0, 0.28, 0.24), gRedSide * (0.45 + 0.5 * uFocus));
          gRimCol = mix(gRimCol, vec3(0.95, 0.96, 1.0), (1.0 - gRedSide) * uFocus * 0.6);

          vec3 gCol = gSpec * 0.85;
          gCol += gRimCol * gRim * (0.95 + gSpecLum * 2.5 + gFres) * (0.6 + 0.4 * uPresence);
          gCol += gRimCol * gRimGlow * 0.06;
          gCol += vec3(0.62, 0.68, 0.68) * 0.028 * (0.4 + 0.6 * uPresence) * (1.0 - 0.8 * uFocus);
          gCol += vec3(0.85, 0.92, 0.95) * gStreak * (0.06 + gSpecLum * 0.6) * (0.5 + 0.5 * uPresence);
          gCol += vec3(0.88, 0.94, 1.0) * gScratch * (0.05 + gSpecLum * 2.2 + gFres * 0.4) * (1.0 - 0.45 * uFocus);
          gCol += vec3(0.55, 0.02, 0.03) * gBloodHalo * (0.07 + 0.12 * uFocus);
          gCol += vec3(1.0, 0.1, 0.12) * gRimGlow * gRedSide * 0.35 * uFocus;
          gCol += vec3(1.0, 0.86, 0.52) * uActive * (0.05 + gRim * 0.9 + gRimGlow * 0.12);

          float gA = 0.03 + 0.05 * uPresence + gFres * 0.30 + gRim * 0.40 + gSpecLum * 0.25 + gScratch * 0.04;
          gCol *= 1.0 - 0.35 * uFocus * (1.0 - gRim);
          gl_FragColor = vec4(gCol, clamp(gA, 0.0, 0.92));
        }
      `
    });
  }

  /** Chamfered ground-glass side faces (the slide's thickness), bright and slightly green. */
  _createGlassEdgeMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xbfe8dc,
      emissive: 0x2c5c50,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.7,
      roughness: 0.25,
      metalness: 0.0,
      envMapIntensity: 1.0,
      depthWrite: false
    });
  }

  _buildSceneGraph() {
    const matBundle = {
      woodMat: this.woodMat,
      brassMat: this.brassMat,
      darkBrassSlotMat: this.darkBrassSlotMat,
      rackMat: this.rackMat,
      floorLiningMat: this.floorLiningMat,
      indexCardMat: this.indexCardMat
    };

    this.boxRoot = new THREE.Group();
    this.scene.add(this.boxRoot);

    // 1. Main Trophy Box Groups
    this.baseGroup = buildBaseGroup(matBundle);
    this.lidGroup = buildLidGroup(matBundle);
    this.claspGroup = buildClaspGroup(matBundle);

    this.boxRoot.add(this.baseGroup);
    this.baseGroup.traverse((o) => {
      if (o.isMesh && (o.material === this.rackMat || o.material === this.floorLiningMat)) o.layers.set(RACK_LAYER);
    });
    this.boxRoot.add(this.lidGroup);
    this.boxRoot.add(this.claspGroup);

    // 2. Subtle Glossy Floor Reflection & Soft Studio Contact Shadow Plane
    this._buildStudioFloorAndReflection();

    // 3. Build all 24 Microscope Glass Slides
    const sharedSlideGeom = createChamferedSlideGeometry();
    const specimenSize = 0.305;
    const sharedSpecimenGeom = new THREE.PlaneGeometry(specimenSize, specimenSize);

    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const slideGroup = new THREE.Group();
      slideGroup.matrixAutoUpdate = false;

      const hasBlood = i < 13;
      const faceMat = this._createGlassFaceMaterial(i, hasBlood);
      const edgeMat = this._createGlassEdgeMaterial();

      const rackFaceMat = this._createRackGlassMaterial(faceMat);
      const fullMats = [faceMat, edgeMat];
      const rackMats = [rackFaceMat, edgeMat];
      const glassMesh = new THREE.Mesh(sharedSlideGeom, fullMats);
      glassMesh.castShadow = false;
      glassMesh.receiveShadow = false;
      slideGroup.add(glassMesh);

      // Only the first 13 slides carry a coagulated blood drop specimen
      let frontBlood = null;
      let backBlood = null;
      if (i < 13) {
        const seed = i + 1.0;
        const variantIdx = i % this.bloodMaterials.length;
        const bloodMat = this.bloodMaterials[variantIdx];

        const offsetX = Math.sin(seed * 17.3) * 0.030;
        const offsetY = Math.cos(seed * 29.1) * 0.016;
        const rotZ = (seed * 1.37) % (Math.PI * 2);
        const scale = 0.94 + Math.sin(seed * 11.7) * 0.06;

        const zFront = BOX_SPECS.slideThick * 0.5 + 0.0006;
        frontBlood = new THREE.Mesh(sharedSpecimenGeom, bloodMat);
        frontBlood.position.set(offsetX, offsetY, zFront);
        frontBlood.rotation.z = rotZ;
        frontBlood.scale.set(scale, scale, 1);
        slideGroup.add(frontBlood);

        backBlood = new THREE.Mesh(sharedSpecimenGeom, bloodMat);
        backBlood.position.set(offsetX, offsetY, -zFront);
        backBlood.rotation.y = Math.PI;
        backBlood.rotation.z = -rotZ;
        backBlood.scale.set(scale, scale, 1);
        slideGroup.add(backBlood);
      }

      this.scene.add(slideGroup);
      this.slideObjects.push({
        group: slideGroup,
        glassMesh,
        faceMat,
        rackFaceMat,
        edgeMat,
        fullMats,
        rackMats,
        frontBlood,
        backBlood
      });
    }
  }

  /**
   * Builds an ultra-smooth, organic studio floor reflection and ambient contact shadow.
   * Uses Reflector with a custom 6-tap satin glossy shader and distance-based soft fade,
   * dissolving seamlessly into the pitch-black void with zero square edges or harsh borders.
   */
  _buildStudioFloorAndReflection() {
    const floorGeom = new THREE.PlaneGeometry(16, 16);
    this.reflector = new Reflector(floorGeom, {
      clipBias: 0.003,
      // Dim and blurred by the shader below, so 256 px is plenty
      textureWidth: 256,
      textureHeight: 256,
      // No MSAA: it was most of this pass's cost, and the 6-tap blur below already smooths the edges
      multisample: 0,
      color: 0x333333
    });
    this.reflector.rotation.x = -Math.PI * 0.5;
    this.reflector.position.y = -0.002;

    const customShader = {
      uniforms: {
        color: { value: new THREE.Color(0x333333) },
        tDiffuse: { value: null },
        textureMatrix: { value: new THREE.Matrix4() }
      },
      vertexShader: `
        uniform mat4 textureMatrix;
        varying vec4 vReflCoord;
        varying vec3 vWorldPos;
        
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vReflCoord = textureMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D tDiffuse;
        varying vec4 vReflCoord;
        varying vec3 vWorldPos;
        
        void main() {
          vec4 coord = vReflCoord;
          vec2 uv = coord.xy / coord.w;
          
          // 6-tap soft jittered sample for satin glossy acrylic reflection
          vec4 sum = vec4(0.0);
          float blur = 0.0028;
          sum += texture2D(tDiffuse, uv + vec2(-blur, -blur) * 0.7);
          sum += texture2D(tDiffuse, uv + vec2( blur, -blur) * 0.7);
          sum += texture2D(tDiffuse, uv + vec2(-blur,  blur) * 0.7);
          sum += texture2D(tDiffuse, uv + vec2( blur,  blur) * 0.7);
          sum += texture2D(tDiffuse, uv) * 2.0;
          vec4 reflSample = sum / 6.0;
          
          // Distance from box footprint
          vec2 boxHalf = vec2(0.96, 1.50);
          vec2 dBox = max(abs(vWorldPos.xz) - boxHalf, vec2(0.0));
          float dist = length(dBox);
          
          // Smooth radial falloff into pitch-black background (reaches 0 by dist = 2.5)
          float radialFade = 1.0 - smoothstep(0.0, 2.5, dist);
          radialFade = radialFade * radialFade;
          
          // Deep contact shadow directly under the box base
          float contactAO = exp(-dist * 14.0) * 0.85 + exp(-dist * 2.8) * 0.25;
          
          // Soften and dim the reflection so it looks like dark polished studio obsidian/acrylic
          vec3 reflColor = reflSample.rgb * 0.28 * radialFade;
          
          // Shadow darkens the surface
          reflColor = reflColor * (1.0 - contactAO * 0.75);
          
          // Alpha blends smoothly into the CSS black background (zero square border!)
          float alpha = clamp(radialFade * 0.55 + contactAO * 0.75, 0.0, 1.0);
          
          gl_FragColor = vec4(reflColor, alpha);
          
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    };

    const customMat = new THREE.ShaderMaterial({
      uniforms: customShader.uniforms,
      vertexShader: customShader.vertexShader,
      fragmentShader: customShader.fragmentShader,
      transparent: true,
      depthWrite: false
    });

    customMat.uniforms.textureMatrix = this.reflector.material.uniforms.textureMatrix;
    customMat.uniforms.tDiffuse = this.reflector.material.uniforms.tDiffuse;
    this.reflector.material = customMat;

    this.boxRoot.add(this.reflector);
  }

  _setupLights() {
    // 1. Ambient / Hemisphere Studio Base
    const hemiLight = new THREE.HemisphereLight(0xfff6ea, 0x321a14, 1.15);
    this.scene.add(hemiLight);

    // 2. Main Studio Key Light (with high-res PCFSoftShadowMap for the Trophy Box)
    this.keyLight = new THREE.DirectionalLight(0xfff5e8, 2.3);
    this.keyLight.position.set(-1.8, 6.5, 4.2);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = QUALITY.shadowMapSize;
    this.keyLight.shadow.mapSize.height = QUALITY.shadowMapSize;
    this.keyLight.shadow.camera.near = 1.0;
    this.keyLight.shadow.camera.far = 14.0;
    const d = 2.4;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.012;
    this.keyLight.shadow.radius = 2.5;
    this.scene.add(this.keyLight);

    // 3. Studio Fill Light (right side)
    const fillLight = new THREE.DirectionalLight(0xd8e8f8, 1.5);
    fillLight.position.set(2.8, 4.5, 4.5);
    this.scene.add(fillLight);

    // 4. Dedicated Front Fill Light for the front face & gold latch
    const frontFill = new THREE.DirectionalLight(0xfff2e0, 1.35);
    frontFill.position.set(0.2, 3.2, 5.8);
    this.scene.add(frontFill);

    // 5. Back Rim Light (illuminates open lid edge & glass slide bevels)
    const rimLight = new THREE.DirectionalLight(0xffeed9, 1.15);
    rimLight.position.set(0.0, 4.2, -4.8);
    this.scene.add(rimLight);

    // 6/7. Two point lights with two jobs, never needed at the same time
    // (every light costs every pixel, even at intensity 0):
    // - Sections 1-3: camera-following key + rim for the 7 free-floating blood slides
    // - Kill reveal: follow the slide in focus (cool key + blood-red rim from behind)
    this.keyPoint = new THREE.PointLight(0xfff0dd, 0.0, 22.0, 1.2);
    this.rimPoint = new THREE.PointLight(0xd8e8ff, 0.0, 22.0, 1.2);
    this.scene.add(this.keyPoint, this.rimPoint);
    this.floatKeyOffset = new THREE.Vector3(3.5, 2.8, -1.8); // camera space
    this.floatRimOffset = new THREE.Vector3(-3.8, -1.8, -2.5);
    this.floatKeyColor = new THREE.Color(0xfff0dd);
    this.floatRimColor = new THREE.Color(0xd8e8ff);
    this.focusKeyColor = new THREE.Color(0xf4f1ff);
    this.focusRimColor = new THREE.Color(0xff1a24);

    // Lights must also light the sharp focus layer
    this.scene.traverse((o) => {
      if (o.isLight) o.layers.enable(FOCUS_LAYER);
    });
  }

  _setupPostProcessing() {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);

    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: QUALITY.msaa
    });

    this.composer = new EffectComposer(this.renderer, renderTarget);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Depth of field on the floating slides (some sharp, some soft), gone by the time they reach the box
    this.slideDofPass = new SlideDepthBlurPass();
    this.slideDofPass.enabled = false;
    this.composer.addPass(this.slideDofPass);

    // Depth of field for the kill reveal: blur the scene, then draw the focused slide sharp on top.
    // Two separable gaussian passes at different spreads give a soft, ghost-free blur.
    this.blurPass = new HalfResBlurPass();
    this.blurPass.enabled = false;
    this.composer.addPass(this.blurPass);

    this.focusCamera = new THREE.PerspectiveCamera();
    this.focusPass = new FocusLayerPass(this.scene, this.focusCamera);
    this.focusPass.enabled = false;
    this.composer.addPass(this.focusPass);

    // Subtle HDR Specular Bloom (barely visible at this strength; skipped on the low tier)
    if (QUALITY.bloom) this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.06, // subtle optical halation strength
      0.28, // radius
      1.45  // strict HDR threshold so wood/paper never bloom
    );
    if (this.bloomPass) this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    addBackdropToOutput(this.outputPass);
    this.composer.addPass(this.outputPass);
  }

  /** Caps the drawing-buffer pixel ratio (adaptive quality); resizes right away. */
  setMaxPixelRatio(value) {
    if (Math.abs(value - this.maxPixelRatio) < 1e-3) return;
    this.maxPixelRatio = value;
    this.resize();
  }

  resize() {
    if (!this.renderer) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const clientW = Math.max(1, this.canvas.clientWidth);
    const clientH = Math.max(1, this.canvas.clientHeight);
    const width = Math.max(1, Math.floor(clientW * dpr));
    const height = Math.max(1, Math.floor(clientH * dpr));

    if (this.outputPass) {
      this.outputPass.uniforms.uResolution.value.set(clientW, clientH);
      this.outputPass.uniforms.uPixelRatio.value = dpr;
    }

    if (this.canvas.width === width && this.canvas.height === height) {
      return;
    }
    this._forceRender = true;

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(clientW, clientH, false);

    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(clientW, clientH);
    }
  }

  /**
   * Everything that decides what the frame looks like, packed into one array.
   * When it matches the last drawn frame, the frame is skipped and the canvas keeps its image.
   */
  _frameSignature(sceneState, boxVisible) {
    const sig = this._sig || (this._sig = new Float32Array(32 + 16 * 2 + BOX_SPECS.numSlides * 22));
    let k = 0;
    const put = (v) => { sig[k++] = v; };
    const putM = (m) => { for (let i = 0; i < 16; i++) sig[k++] = m[i]; };

    put(this.canvas.width);
    put(this.canvas.height);
    put(boxVisible ? 1 : 0);
    put(sceneState.screenShiftX || 0);
    put(sceneState.backgroundBlur || 0);
    put(sceneState.backdropOpacity ?? 1);
    put(sceneState.lidOpenProgress || 0);
    putM(sceneState.viewMatrix);
    if (boxVisible) {
      putM(sceneState.lidMatrix);
      putM(sceneState.claspMatrix);
    }
    for (const s of sceneState.slides) {
      if (!(boxVisible || s.isFloating)) continue;
      putM(s.modelMatrix);
      put(s.hoverProgress);
      put(s.selectProgress);
      put(s.focusProgress || 0);
      put(s.focusDetached ? 1 : 0);
      put(s.depthBlur || 0);
      put(s.overText ? 1 : 0);
    }
    return k;
  }

  _signatureChanged(len) {
    const sig = this._sig;
    const last = this._lastSig || (this._lastSig = new Float32Array(sig.length));
    let changed = len !== this._lastSigLen;
    for (let i = 0; !changed && i < len; i++) {
      if (Math.abs(sig[i] - last[i]) > 1e-5) changed = true;
    }
    if (changed) {
      last.set(sig);
      this._lastSigLen = len;
    }
    return changed;
  }

  /**
   * A slide's outline on screen: its 4 face corners in drawing-buffer pixels (y up),
   * counter-clockwise. Null when part of it is behind the camera.
   */
  _projectSlideQuad(group) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pts = [];
    for (const [x, y] of DOF_CORNERS) {
      _dofCorner.set(x, y, 0).applyMatrix4(group.matrixWorld);
      _dofView.copy(_dofCorner).applyMatrix4(this.camera.matrixWorldInverse);
      if (_dofView.z > -0.05) return null;
      _dofCorner.project(this.camera);
      pts.push((_dofCorner.x * 0.5 + 0.5) * w, (_dofCorner.y * 0.5 + 0.5) * h);
    }
    let area = 0;
    for (let c = 0; c < 4; c++) {
      const n = (c + 1) % 4;
      area += pts[c * 2] * pts[n * 2 + 1] - pts[n * 2] * pts[c * 2 + 1];
    }
    if (area < 0) pts.splice(0, 8, pts[6], pts[7], pts[4], pts[5], pts[2], pts[3], pts[0], pts[1]);
    return pts;
  }

  /**
   * Slides flagged overText look like they float in front of the HTML headlines: right after
   * the frame is drawn, their pixels are copied onto a 2D canvas layered above the text.
   * The copy is slightly see-through, so a headline passing under it reads as behind the glass.
   */
  _drawOverTextSlides(sceneState) {
    let layer = this.overTextCanvas;
    if (!layer) {
      const wrapper = document.getElementById('smooth-wrapper');
      if (!wrapper) return;
      layer = this.overTextCanvas = document.createElement('canvas');
      layer.className = 'over-text-slides';
      layer.setAttribute('aria-hidden', 'true');
      wrapper.after(layer);
      this.overTextCtx = layer.getContext('2d');
    }
    const ctx = this.overTextCtx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (layer.width !== w || layer.height !== h) {
      layer.width = w;
      layer.height = h;
      this._overTextDrawn = false;
    }
    if (this._overTextDrawn) ctx.clearRect(0, 0, w, h);
    this._overTextDrawn = false;

    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const s = sceneState.slides[i];
      const g = this.slideObjects[i].group;
      if (!s.overText || !g.visible) continue;
      const pts = this._projectSlideQuad(g);
      if (!pts) continue;
      // Grow the outline a touch so the bevel highlight is fully covered (canvas y runs down)
      let cx = 0;
      let cy = 0;
      for (let c = 0; c < 4; c++) { cx += pts[c * 2] / 4; cy += pts[c * 2 + 1] / 4; }
      const grow = 1.5 * Math.max(1, h / 900);
      ctx.save();
      ctx.beginPath();
      let minX = w, minY = h, maxX = 0, maxY = 0;
      for (let c = 0; c < 4; c++) {
        const dx = pts[c * 2] - cx;
        const dy = pts[c * 2 + 1] - cy;
        const len = Math.hypot(dx, dy) || 1;
        const px = pts[c * 2] + (dx / len) * grow;
        const py = h - (pts[c * 2 + 1] + (dy / len) * grow);
        if (c === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      ctx.closePath();
      ctx.clip();
      const x0 = Math.max(0, Math.floor(minX));
      const y0 = Math.max(0, Math.floor(minY));
      const x1 = Math.min(w, Math.ceil(maxX));
      const y1 = Math.min(h, Math.ceil(maxY));
      if (x1 > x0 && y1 > y0) {
        ctx.globalAlpha = 0.82;
        ctx.drawImage(this.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
        this._overTextDrawn = true;
      }
      ctx.restore();
    }
  }

  /**
   * Feeds the floating-slide depth of field: each blurred slide's outline on screen
   * (its 4 projected corners) and blur amount, ordered far -> near.
   */
  _updateSlideDof(sceneState) {
    const pass = this.slideDofPass;
    if (!pass) return;
    const scale = this.canvas.height / 900;
    // How far the softest blur spills past the slide outline
    const softestPx = 31 * scale;

    const list = this._dofList || (this._dofList = []);
    list.length = 0;
    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const s = sceneState.slides[i];
      const amt = s.depthBlur || 0;
      const g = this.slideObjects[i].group;
      if (amt < 0.01 || !g.visible) continue;
      const pts = this._projectSlideQuad(g);
      if (!pts) continue;
      const dx = s.worldPos[0] - sceneState.cameraPos[0];
      const dy = s.worldPos[1] - sceneState.cameraPos[1];
      const dz = s.worldPos[2] - sceneState.cameraPos[2];
      list.push({ pts, amt, distSq: dx * dx + dy * dy + dz * dz });
    }

    pass.enabled = list.length > 0;
    if (!pass.enabled) return;
    list.sort(byDistanceDesc);
    pass.scale = scale;
    const u = pass.compositeMat.uniforms;
    const n = Math.min(MAX_DOF_SLIDES, list.length);
    u.uCount.value = n;
    for (let i = 0; i < n; i++) {
      const { pts, amt } = list[i];
      u.uQuads.value[i * 2].set(pts[0], pts[1], pts[2], pts[3]);
      u.uQuads.value[i * 2 + 1].set(pts[4], pts[5], pts[6], pts[7]);
      u.uParams.value[i].set(amt, 2.0 + softestPx * amt * 2.2);
    }
  }

  render(sceneState) {
    if (!this.renderer) return;

    const boxVisible = sceneState.boxVisible !== false;

    // Nothing moved since the last drawn frame: keep the current image on the canvas
    const sigLen = this._frameSignature(sceneState, boxVisible);
    if (!this._signatureChanged(sigLen) && !this._forceRender) return;
    this._forceRender = false;

    if (this.boxRoot.visible !== boxVisible) {
      this.boxRoot.visible = boxVisible;
      this.renderer.shadowMap.needsUpdate = true;
    }

    // 1. Sync Three.js Camera from main.js matrices / state
    const aspect = Math.max(1, this.canvas.width) / Math.max(1, this.canvas.height);
    if (Math.abs(this.camera.aspect - aspect) > 1e-4) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }

    // Screen-space horizontal shift (clip.x += shift * clip.w) applied every frame
    this.camera.projectionMatrix.elements[8] = -(sceneState.screenShiftX || 0);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldInverse.fromArray(sceneState.viewMatrix);
    this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();
    const camX = sceneState.cameraPos[0];
    const camY = sceneState.cameraPos[1];
    const camZ = sceneState.cameraPos[2];
    this.camera.position.set(camX, camY, camZ);

    // 2. Update Box Matrices (Base, Lid, Swinging Clasp + Floor Reflections)
    if (boxVisible) {
      this.baseGroup.matrix.fromArray(sceneState.baseMatrix);
      this.baseGroup.updateMatrixWorld(true);

      // The box is the only shadow caster: redraw the shadow map only when the lid or clasp moved
      const lidSig = this._lidSig || (this._lidSig = new Float32Array(32));
      let moved = false;
      for (let i = 0; i < 16; i++) {
        const a = sceneState.lidMatrix[i];
        const b = sceneState.claspMatrix[i];
        if (Math.abs(a - lidSig[i]) > 1e-6 || Math.abs(b - lidSig[16 + i]) > 1e-6) moved = true;
        lidSig[i] = a;
        lidSig[16 + i] = b;
      }
      if (moved) this.renderer.shadowMap.needsUpdate = true;

      this.lidGroup.matrix.fromArray(sceneState.lidMatrix);
      this.lidGroup.updateMatrixWorld(true);

      this.claspGroup.matrix.fromArray(sceneState.claspMatrix);
      this.claspGroup.updateMatrixWorld(true);

      if (this.reflector) {
        this.reflector.visible = true;
      }

      // Modulate interior ambient intensity based on lidOpenProgress so closing the box darkens interior
      const lidFactor = Math.max(0.25, sceneState.lidOpenProgress);
      this.rackMat.envMapIntensity = 0.32 * lidFactor;
      this.floorLiningMat.envMapIntensity = 0.28 * lidFactor;
      this.indexCardMat.envMapIntensity = 0.18 * lidFactor;
    }

    // 3. Point lights: kill reveal (follow the slide most in focus; two can cross during a swap)
    // or the camera-following rig for the floating slides, fading out as we approach the box
    let fs = null;
    let focusAmt = 0;
    for (const sl of sceneState.slides) {
      if ((sl.focusProgress || 0) > focusAmt) {
        focusAmt = sl.focusProgress;
        fs = sl;
      }
    }

    if (fs && focusAmt > 0.001) {
      const [fx, fy, fz] = fs.worldPos;
      // Rim sits behind the slide (away from camera) and down-left; key comes from upper-right
      const bx = fx - camX, by = fy - camY, bz = fz - camZ;
      const len = Math.hypot(bx, by, bz) || 1;
      this.rimPoint.position.set(fx + (bx / len) * 0.9 - 0.7, fy + (by / len) * 0.9 - 0.4, fz + (bz / len) * 0.9);
      this.keyPoint.position.set(fx + 0.9, fy + 1.1, fz - (bz / len) * -0.6);
      this.rimPoint.color.copy(this.focusRimColor);
      this.keyPoint.color.copy(this.focusKeyColor);
      this.rimPoint.intensity = 3.5 * focusAmt;
      this.keyPoint.intensity = 1.6 * focusAmt;
      this.rimPoint.distance = this.keyPoint.distance = 6.0;
      this.rimPoint.decay = this.keyPoint.decay = 1.6;
    } else {
      const floatLightFade = Math.max(0.0, Math.min(1.0, (camY - 9.0) / 6.0));
      this.keyPoint.position.copy(this.floatKeyOffset).applyMatrix4(this.camera.matrixWorld);
      this.rimPoint.position.copy(this.floatRimOffset).applyMatrix4(this.camera.matrixWorld);
      this.keyPoint.color.copy(this.floatKeyColor);
      this.rimPoint.color.copy(this.floatRimColor);
      this.keyPoint.intensity = 3.8 * floatLightFade;
      this.rimPoint.intensity = 3.2 * floatLightFade;
      this.keyPoint.distance = this.rimPoint.distance = 22.0;
      this.keyPoint.decay = this.rimPoint.decay = 1.2;
    }

    // 4. Update & Sort all 24 Glass Slides back-to-front relative to Camera
    const slideOrder = this._slideOrder || (this._slideOrder = []);
    const orderPool = this._orderPool || (this._orderPool = []);
    slideOrder.length = 0;

    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const s = sceneState.slides[i];
      const slideObj = this.slideObjects[i];
      const visible = boxVisible || s.isFloating;
      slideObj.group.visible = visible;
      if (!visible) continue;

      slideObj.group.matrix.fromArray(s.modelMatrix);
      slideObj.group.updateMatrixWorld(true);

      // Differentiate optical presence between free-floating slides against pitch-black background (Sections 1-3)
      // and the 24 tightly stacked slides inside the cream-lined Trophy Box (Section 4)
      const isHighFloating = s.worldPos[1] > 1.4 ? Math.min(1.0, (s.worldPos[1] - 1.4) / 2.0) : 0.0;
      const isFocus = s.focusProgress || 0.0;
      const activeAmt = Math.max(s.hoverProgress, s.selectProgress) * (1.0 - isFocus);

      const gu = slideObj.faceMat.userData.glassUniforms;
      gu.uPresence.value = isHighFloating;
      gu.uActive.value = activeAmt;
      gu.uFocus.value = isFocus;
      slideObj.faceMat.envMapIntensity = 1.6 - 1.0 * isFocus;

      // Thickness edges: bright soda-lime green, warming to gold on hover/select
      slideObj.edgeMat.color.setRGB(
        0.75 + activeAmt * 0.25,
        0.91 - activeAmt * 0.05,
        0.86 - activeAmt * 0.40
      );
      slideObj.edgeMat.emissive.setRGB(
        0.17 + activeAmt * 0.45,
        0.36 + activeAmt * 0.20,
        0.31 - activeAmt * 0.10
      );
      slideObj.edgeMat.opacity = 0.55 + isHighFloating * 0.12 + activeAmt * 0.20;
      if (isFocus > 0.0) {
        // Focused slide: edges glow blood red, like the bevel is catching a red lamp
        const c = slideObj.edgeMat.color, e = slideObj.edgeMat.emissive;
        c.setRGB(c.r + (1.0 - c.r) * isFocus, c.g + (0.42 - c.g) * isFocus, c.b + (0.42 - c.b) * isFocus);
        e.setRGB(e.r + (0.85 - e.r) * isFocus, e.g + (0.06 - e.g) * isFocus, e.b + (0.08 - e.b) * isFocus);
        slideObj.edgeMat.opacity = Math.min(1.0, slideObj.edgeMat.opacity + 0.15 * isFocus);
      }

      const dx = s.worldPos[0] - camX;
      const dy = s.worldPos[1] - camY;
      const dz = s.worldPos[2] - camZ;
      const entry = orderPool[i] || (orderPool[i] = { slideObj: null, distSq: 0, isElevated: false });
      entry.slideObj = slideObj;
      entry.distSq = dx * dx + dy * dy + dz * dz;
      entry.isElevated = isHighFloating > 0.02 || activeAmt > 0.02;
      slideOrder.push(entry);
    }

    // Farthest slide gets lowest renderOrder; closest slide gets highest renderOrder.
    slideOrder.sort(byDistanceDesc);
    for (let k = 0; k < slideOrder.length; k++) {
      const { slideObj, isElevated } = slideOrder[k];
      if (isElevated) {
        const baseOrder = 300 + k * 3;
        slideObj.glassMesh.renderOrder = baseOrder;
        if (slideObj.backBlood) slideObj.backBlood.renderOrder = baseOrder + 1;
        if (slideObj.frontBlood) slideObj.frontBlood.renderOrder = baseOrder + 2;
      } else {
        slideObj.glassMesh.renderOrder = 100 + k;
        if (slideObj.backBlood) slideObj.backBlood.renderOrder = 200 + k * 2;
        if (slideObj.frontBlood) slideObj.frontBlood.renderOrder = 200 + k * 2 + 1;
      }
    }

    // 5. Layers per slide:
    // - focused slide on its own sharp layer (depth of field: everything else gets blurred)
    // - slides resting in the rack on a layer the floor reflection skips (the box walls hide them there)
    let detach = false;
    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const s = sceneState.slides[i];
      const slideObj = this.slideObjects[i];
      const focus = !!s.focusDetached;
      const inRack = !focus && s.worldPos[1] < 0.6 && (s.focusProgress || 0) < 0.001;
      const layer = focus ? FOCUS_LAYER : inRack ? RACK_LAYER : 0;
      if (slideObj.layer !== layer) {
        slideObj.group.traverse((o) => o.layers.set(layer));
        slideObj.glassMesh.material = layer === RACK_LAYER ? slideObj.rackMats : slideObj.fullMats;
        slideObj.layer = layer;
      }
      if (inRack) slideObj.rackFaceMat.uniforms.uEnvIntensity.value = slideObj.faceMat.envMapIntensity;
      detach = detach || focus;
    }

    if (this.blurPass) {
      const blur = Math.max(0, Math.min(1, sceneState.backgroundBlur || 0));
      // Spread in pixels scales with the drawing-buffer height so it looks the same at any DPR
      this.blurPass.spread = blur * 2.6 * (this.canvas.height / 900);
      this.blurPass.enabled = blur > 0.01;

      this.focusPass.enabled = detach;
      if (detach) {
        this.focusCamera.copy(this.camera, false);
        this.focusCamera.layers.set(FOCUS_LAYER);
      }
    }

    this._updateSlideDof(sceneState);

    // 6. Page atmosphere (fades out on the closed-box stage)
    if (this.outputPass) {
      this.outputPass.uniforms.uBackdrop.value = Math.max(0, Math.min(1, sceneState.backdropOpacity ?? 1));
      this.outputPass.uniforms.uSmokePan.value = Math.max(0, Math.min(1, sceneState.smokePan ?? 0));
    }

    // 7. Render with Integrated Post-Processing
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    // Must run right after drawing, while the WebGL canvas still holds this frame
    this._drawOverTextSlides(sceneState);
  }
}

function byDistanceDesc(a, b) {
  return b.distSq - a.distSq;
}
