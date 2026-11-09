/**
 * Procedural PBR Texture & Normal Map Generators for Three.js
 * Generates realistic, high-craft textures for:
 * 1. Fine Honduras Mahogany / Rosewood (Albedo, Normal, Roughness)
 * 2. Brushed Antique Brass (Albedo, Normal, Roughness)
 * 3. Cream / Ivory Slotted Wood Rack (Albedo, Normal)
 * 4. Lid Numbered Index Card 01-24 (Albedo with recessed AO, crisp typography)
 * 5. Coagulated Blood Specimens (4 organic variations: Albedo+Alpha, Smooth 3D Meniscus Normal, Roughness)
 * 6. Microscope Glass Slide Optical Face Map
 * 7. Studio Floor Contact Shadow & Glossy Box Reflection Map
 */

import * as THREE from 'three';
import { allTexturePixels, assembleTexturePixels, TEXTURE_JOBS } from './texture-pixels.js';

function fract(x) {
  return x - Math.floor(x);
}

/*
 * The pixel-heavy maps (wood, brass, rack, blood, glass waviness) take ~2 s of math.
 * They are built in a Web Worker as soon as this module loads, so the page stays responsive;
 * the renderer awaits prepareProceduralTextures() before it builds its materials.
 */
let pixelsPromise = null;
let pixels = null;

/** Spreads the jobs over a few workers (one job at a time each, the biggest ones first). */
function buildInWorkers() {
  return new Promise((resolve, reject) => {
    const queue = TEXTURE_JOBS.slice();
    const byJob = {};
    let pending = queue.length;
    const cores = navigator.hardwareConcurrency || 4;
    const count = Math.max(1, Math.min(4, cores - 1, queue.length));
    const workers = [];
    const fail = (err) => {
      workers.forEach((w) => w.terminate());
      reject(err);
    };
    const feed = (w) => {
      if (queue.length) w.postMessage(queue.shift());
      else w.terminate();
    };
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./texture-worker.js', import.meta.url), { type: 'module' });
      workers.push(w);
      w.onerror = fail;
      w.onmessage = (e) => {
        const { job, result, error } = e.data || {};
        if (!result) return fail(new Error(error || 'texture worker failed'));
        byJob[job] = result;
        if (--pending === 0) {
          workers.forEach((x) => x.terminate());
          resolve(assembleTexturePixels(byJob));
        } else {
          feed(w);
        }
      };
      feed(w);
    }
  });
}

export function prepareProceduralTextures() {
  if (!pixelsPromise) {
    pixelsPromise = buildInWorkers()
      .catch((err) => {
        // No module workers (very old browsers): build them here instead, same pixels
        console.warn('Texture worker unavailable, building textures on the main thread', err);
        return allTexturePixels();
      })
      .then((result) => (pixels = result));
  }
  return pixelsPromise;
}
// Start right away: the worker runs while three.js, GSAP and the fonts are still loading
prepareProceduralTextures();

function getPixels() {
  if (!pixels) pixels = allTexturePixels(); // only if the renderer didn't await the worker
  return pixels;
}

/** Raw RGBA buffer -> texture with the same sampling a CanvasTexture gets (linear + mipmaps). */
function toTexture({ width, height, data }, repeat = false) {
  const tex = new THREE.DataTexture(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 1. Fine Honduras Mahogany / Rosewood PBR Maps (Albedo, Normal, Roughness)
 */
export function createWoodPBRMaps(maxAnisotropy = 8) {
  const p = getPixels().wood;
  const map = toTexture(p.map, true);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;
  const roughnessMap = toTexture(p.roughnessMap, true);
  roughnessMap.anisotropy = maxAnisotropy;
  const normalMap = toTexture(p.normalMap, true);
  normalMap.anisotropy = maxAnisotropy;
  return { map, normalMap, roughnessMap };
}

/**
 * 2. Brushed Antique Brass PBR Maps (Albedo, Normal, Roughness)
 */
export function createBrassPBRMaps(maxAnisotropy = 8) {
  const p = getPixels().brass;
  const map = toTexture(p.map, true);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;
  const roughnessMap = toTexture(p.roughnessMap, true);
  roughnessMap.anisotropy = maxAnisotropy;
  const normalMap = toTexture(p.normalMap, true);
  normalMap.anisotropy = maxAnisotropy;
  return { map, normalMap, roughnessMap };
}

/**
 * 3. Cream / Ivory Slotted Wood Rack & Lining Texture
 */
export function createRackPBRMaps(maxAnisotropy = 8) {
  const p = getPixels().rack;
  const map = toTexture(p.map, true);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;
  const normalMap = toTexture(p.normalMap, true);
  normalMap.anisotropy = maxAnisotropy;
  return { map, normalMap };
}

/**
 * 4. High-Resolution Lid Numbered Index Card (01 - 24) with Recessed Frame AO & Crisp Typography
 */
export function createIndexCardMaps(maxAnisotropy = 16) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1600;
  const ctx = canvas.getContext('2d');

  // Warm archival cream cardstock base
  ctx.fillStyle = '#ede7db';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle organic paper fiber speckles
  ctx.fillStyle = 'rgba(135, 120, 100, 0.045)';
  for (let i = 0; i < 4500; i++) {
    const px = fract(Math.sin(i * 12.9898) * 43758.5453) * canvas.width;
    const py = fract(Math.sin(i * 78.233) * 43758.5453) * canvas.height;
    ctx.fillRect(px, py, 2, 2);
  }

  // Soft radial paper vignette
  const grad = ctx.createRadialGradient(512, 800, 180, 512, 800, 960);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(175,160,138,0.14)');
  grad.addColorStop(1, 'rgba(110,94,76,0.34)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Baked ambient occlusion shadow along the 4 edges where the card sits recessed inside the wood lid
  const edgeAO = 34;
  const topGrad = ctx.createLinearGradient(0, 0, 0, edgeAO);
  topGrad.addColorStop(0, 'rgba(35, 18, 10, 0.42)');
  topGrad.addColorStop(1, 'rgba(35, 18, 10, 0.0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, canvas.width, edgeAO);

  const botGrad = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - edgeAO);
  botGrad.addColorStop(0, 'rgba(35, 18, 10, 0.42)');
  botGrad.addColorStop(1, 'rgba(35, 18, 10, 0.0)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, canvas.height - edgeAO, canvas.width, edgeAO);

  const leftGrad = ctx.createLinearGradient(0, 0, edgeAO, 0);
  leftGrad.addColorStop(0, 'rgba(35, 18, 10, 0.38)');
  leftGrad.addColorStop(1, 'rgba(35, 18, 10, 0.0)');
  ctx.fillStyle = leftGrad;
  ctx.fillRect(0, 0, edgeAO, canvas.height);

  const rightGrad = ctx.createLinearGradient(canvas.width, 0, canvas.width - edgeAO, 0);
  rightGrad.addColorStop(0, 'rgba(35, 18, 10, 0.38)');
  rightGrad.addColorStop(1, 'rgba(35, 18, 10, 0.0)');
  ctx.fillStyle = rightGrad;
  ctx.fillRect(canvas.width - edgeAO, 0, edgeAO, canvas.height);

  const marginX = 76;
  const topY = 72;
  const bottomY = canvas.height - 72;
  const rows = 24;
  const rowStep = (bottomY - topY) / rows;

  // High-contrast warm charcoal ruled lines and numbers so all 24 rows are legible from Section 4 camera
  ctx.strokeStyle = '#6e665e';
  ctx.lineWidth = 3.2;
  ctx.fillStyle = '#1e1916';
  ctx.font = 'bold 26px "Courier New", Courier, monospace';
  ctx.textBaseline = 'bottom';

  for (let i = 1; i <= rows; i++) {
    const y = topY + i * rowStep;

    ctx.beginPath();
    ctx.moveTo(marginX, y);
    ctx.lineTo(canvas.width - marginX, y);
    ctx.stroke();

    const numStr = i < 10 ? `0${i}` : `${i}`;
    ctx.fillText(numStr, marginX + 6, y - 5);
  }

  // Vertical column divider line after the numbers
  ctx.strokeStyle = '#7c736a';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(marginX + 56, topY + rowStep * 0.18);
  ctx.lineTo(marginX + 56, bottomY);
  ctx.stroke();

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;

  return { map };
}

/**
 * 5. Realistic Coagulated Blood Drop Specimen Maps
 * Generates 4 distinct high-resolution (512x512) specimen variations with:
 * - Albedo + Alpha (deep oxidized venous rim, luminous arterial ruby mid-zone, dark coagulated core)
 * - Smooth C2-Continuous 3D Meniscus Normal Map (raised outer capillary "coffee-ring" ridge, concave lagoon)
 * - Roughness Map (glossy resinous meniscus edge vs satin interior)
 */
export function createBloodSpecimenVariants(maxAnisotropy = 8) {
  return getPixels().blood.map((p) => {
    const map = toTexture(p.map);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = maxAnisotropy;
    const roughnessMap = toTexture(p.roughnessMap);
    roughnessMap.anisotropy = maxAnisotropy;
    const normalMap = toTexture(p.normalMap);
    normalMap.anisotropy = maxAnisotropy;
    return { map, normalMap, roughnessMap };
  });
}

/**
 * 6. Microscope Glass Slide Surface Maps
 * - scratchMap: grayscale wear layer (hairline scratches + faint fingerprint smudges).
 *   The glass shader only reveals it where light is reflected, so it reads as real worn glass.
 * - normalMap: very low-amplitude float-glass waviness that breaks up perfectly flat reflections.
 * Generated once and shared by all 24 slides.
 */
export function createGlassSlideSurfaceMaps(maxAnisotropy = 8) {
  // --- Scratch / smudge layer (canvas 2D strokes: cheap to generate) ---
  const sw = 1024;
  const sh = 352; // ~ slide aspect (1.36 / 0.46)
  const sCanvas = document.createElement('canvas');
  sCanvas.width = sw;
  sCanvas.height = sh;
  const ctx = sCanvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, sw, sh);

  let rng = 1337;
  const rand = () => {
    rng = (rng * 16807) % 2147483647;
    return (rng - 1) / 2147483646;
  };

  // Faint fingerprint / cleaning smudges
  for (let i = 0; i < 14; i++) {
    const x = rand() * sw;
    const y = rand() * sh;
    const r = 40 + rand() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rand() * 0.07;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hairline scratches: mostly long and shallow-angled, a few short random nicks
  ctx.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const long = rand() < 0.55;
    const x = rand() * sw;
    const y = rand() * sh;
    const ang = long ? (rand() - 0.5) * 0.9 : rand() * Math.PI;
    const len = long ? 120 + rand() * 420 : 10 + rand() * 60;
    const bend = (rand() - 0.5) * len * 0.12;
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    ctx.strokeStyle = `rgba(255,255,255,${0.18 + rand() * 0.5})`;
    ctx.lineWidth = 0.5 + rand() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + dx * 0.5 - dy * 0.02 + bend, y + dy * 0.5 + bend, x + dx, y + dy);
    ctx.stroke();
  }

  const scratchMap = new THREE.CanvasTexture(sCanvas);
  scratchMap.colorSpace = THREE.NoColorSpace;
  scratchMap.anisotropy = maxAnisotropy;
  scratchMap.generateMipmaps = true;
  scratchMap.minFilter = THREE.LinearMipmapLinearFilter;
  scratchMap.needsUpdate = true;

  // --- Subtle float-glass waviness normal map (low-res is enough) ---
  const normalMap = toTexture(getPixels().glassNormal);
  normalMap.anisotropy = maxAnisotropy;

  return { scratchMap, normalMap };
}
