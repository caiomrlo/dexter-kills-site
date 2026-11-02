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

function fract(x) {
  return x - Math.floor(x);
}

function hash2(x, y, seed = 0) {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function noise2D(x, y, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Quintic interpolation for C2-continuous smooth derivatives (zero blocky normal artifacts!)
  const ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
  const uy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);

  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2D(x, y, octaves = 4, seed = 0) {
  let val = 0.0;
  let amp = 0.5;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise2D(x * freq, y * freq, seed + i * 19.19);
    freq *= 2.02;
    amp *= 0.5;
  }
  return val;
}

function clamp01(v) {
  return v < 0.0 ? 0.0 : v > 1.0 ? 1.0 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3.0 - 2.0 * t);
}

/**
 * Converts a scalar height buffer (Float32Array) into a smooth 3x3 Sobel Normal Map CanvasTexture
 */
function heightBufferToNormalTexture(heightBuf, width, height, strength = 2.0, repeat = true) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  const idxAt = (x, y) => {
    const wx = repeat ? (x + width) % width : Math.max(0, Math.min(width - 1, x));
    const wy = repeat ? (y + height) % height : Math.max(0, Math.min(height - 1, y));
    return heightBuf[wy * width + wx];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = idxAt(x - 1, y - 1);
      const tc = idxAt(x, y - 1);
      const tr = idxAt(x + 1, y - 1);
      const ml = idxAt(x - 1, y);
      const mr = idxAt(x + 1, y);
      const bl = idxAt(x - 1, y + 1);
      const bc = idxAt(x, y + 1);
      const br = idxAt(x + 1, y + 1);

      const dX = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
      const dY = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);

      const nx = -dX * strength * 0.25;
      const ny = dY * strength * 0.25;
      const nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);

      const idx = (y * width + x) * 4;
      data[idx] = Math.round(((nx * invLen) * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round(((ny * invLen) * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round(((nz * invLen) * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 1. Fine Honduras Mahogany / Rosewood PBR Maps (Albedo, Normal, Roughness)
 */
export function createWoodPBRMaps(maxAnisotropy = 8) {
  const width = 512;
  const height = 512;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = width;
  albedoCanvas.height = height;
  const albedoCtx = albedoCanvas.getContext('2d');
  const albedoImg = albedoCtx.createImageData(width, height);
  const aData = albedoImg.data;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const roughCtx = roughCanvas.getContext('2d');
  const roughImg = roughCtx.createImageData(width, height);
  const rData = roughImg.data;

  const heightBuf = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;

      const warp = fbm2D(u * 4.0, v * 16.0, 4, 1.7) * 0.22;
      const streak = (u * 38.0 + v * 6.0 + warp * 8.0);
      const broadBand = Math.sin(streak * Math.PI * 2.0) * 0.5 + 0.5;
      const fineStrands = fbm2D(u * 95.0, v * 18.0, 4, 5.3);

      const poreNoise = noise2D(u * 210.0, v * 36.0, 11.4);
      const poreMask = smoothstep(0.75, 0.96, poreNoise);

      const mixFactor = broadBand * 0.35 + fineStrands * 0.65;
      let r = 82 + mixFactor * 68;
      let g = 22 + mixFactor * 22;
      let b = 10 + mixFactor * 10;

      const amber = Math.pow(fineStrands, 2.0) * 0.35;
      r += amber * 48;
      g += amber * 16;
      b += amber * 6;

      r *= (1.0 - poreMask * 0.38);
      g *= (1.0 - poreMask * 0.42);
      b *= (1.0 - poreMask * 0.42);

      const idx = (y * width + x) * 4;
      aData[idx] = Math.min(255, Math.max(0, Math.round(r)));
      aData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      aData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      aData[idx + 3] = 255;

      heightBuf[y * width + x] = fineStrands * 0.25 + broadBand * 0.08 - poreMask * 0.50;

      const roughVal = Math.round((0.20 + fineStrands * 0.07 + poreMask * 0.28) * 255);
      rData[idx] = roughVal;
      rData[idx + 1] = roughVal;
      rData[idx + 2] = roughVal;
      rData[idx + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  const normalMap = heightBufferToNormalTexture(heightBuf, width, height, 1.4, true);
  normalMap.anisotropy = maxAnisotropy;

  return { map, normalMap, roughnessMap };
}

/**
 * 2. Brushed Antique Brass PBR Maps (Albedo, Normal, Roughness)
 */
export function createBrassPBRMaps(maxAnisotropy = 8) {
  const width = 256;
  const height = 256;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = width;
  albedoCanvas.height = height;
  const albedoCtx = albedoCanvas.getContext('2d');
  const albedoImg = albedoCtx.createImageData(width, height);
  const aData = albedoImg.data;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const roughCtx = roughCanvas.getContext('2d');
  const roughImg = roughCtx.createImageData(width, height);
  const rData = roughImg.data;

  const heightBuf = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;

      const brush = noise2D(u * 16.0, v * 160.0, 3.1) * 0.65 + noise2D(u * 48.0, v * 280.0, 9.2) * 0.35;
      const patina = fbm2D(u * 5.0, v * 5.0, 3, 7.7);

      const baseR = 240 - patina * 16 - (1.0 - brush) * 10;
      const baseG = 194 - patina * 14 - (1.0 - brush) * 8;
      const baseB = 88 - patina * 10 - (1.0 - brush) * 5;

      const idx = (y * width + x) * 4;
      aData[idx] = Math.round(baseR);
      aData[idx + 1] = Math.round(baseG);
      aData[idx + 2] = Math.round(baseB);
      aData[idx + 3] = 255;

      heightBuf[y * width + x] = brush * 0.4 + patina * 0.15;

      const rough = Math.round((0.16 + (1.0 - brush) * 0.12 + patina * 0.08) * 255);
      rData[idx] = rough;
      rData[idx + 1] = rough;
      rData[idx + 2] = rough;
      rData[idx + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  const normalMap = heightBufferToNormalTexture(heightBuf, width, height, 1.0, true);
  normalMap.anisotropy = maxAnisotropy;

  return { map, normalMap, roughnessMap };
}

/**
 * 3. Cream / Ivory Slotted Wood Rack & Lining Texture
 */
export function createRackPBRMaps(maxAnisotropy = 8) {
  const width = 256;
  const height = 256;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const data = img.data;
  const heightBuf = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const grain = fbm2D(u * 12.0, v * 65.0, 3, 21.4);
      const fine = noise2D(u * 70.0, v * 70.0, 4.2);

      const r = 236 - grain * 14 - fine * 5;
      const g = 225 - grain * 15 - fine * 5;
      const b = 205 - grain * 16 - fine * 5;

      const idx = (y * width + x) * 4;
      data[idx] = Math.round(r);
      data[idx + 1] = Math.round(g);
      data[idx + 2] = Math.round(b);
      data[idx + 3] = 255;

      heightBuf[y * width + x] = grain * 0.4 + fine * 0.2;
    }
  }

  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const normalMap = heightBufferToNormalTexture(heightBuf, width, height, 0.9, true);
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
  const variants = [];
  const size = 512;

  for (let vIdx = 0; vIdx < 4; vIdx++) {
    const seed = (vIdx + 1) * 13.37;

    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = size;
    albedoCanvas.height = size;
    const albedoCtx = albedoCanvas.getContext('2d');
    const albedoImg = albedoCtx.createImageData(size, size);
    const aData = albedoImg.data;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const roughCtx = roughCanvas.getContext('2d');
    const roughImg = roughCtx.createImageData(size, size);
    const rData = roughImg.data;

    const heightBuf = new Float32Array(size * size);

    const stretchX = 1.0 + Math.sin(seed * 2.1) * 0.065;
    const stretchY = 1.0 + Math.cos(seed * 3.4) * 0.055;

    for (let y = 0; y < size; y++) {
      const py = ((y / size) * 2.0 - 1.0) * stretchY;
      for (let x = 0; x < size; x++) {
        const px = ((x / size) * 2.0 - 1.0) * stretchX;

        const angle = Math.atan2(py, px);
        const rawDist = Math.hypot(px, py);

        // Smooth organic droplet lobes (compressed between glass slides)
        const lobe2 = Math.sin(angle * 2.0 + seed * 1.9) * 0.028;
        const lobe3 = Math.cos(angle * 3.0 - seed * 2.7) * 0.020;
        const lobe5 = Math.sin(angle * 5.0 + seed * 4.3) * 0.011;
        const lowFreqWarp = (fbm2D(px * 2.6, py * 2.6, 3, seed) - 0.5) * 0.038;

        const baseRadius = 0.76;
        const normR = (rawDist + lobe2 + lobe3 + lobe5 + lowFreqWarp) / baseRadius;

        const idx = (y * size + x) * 4;

        if (normR > 1.03) {
          aData[idx] = 0;
          aData[idx + 1] = 0;
          aData[idx + 2] = 0;
          aData[idx + 3] = 0;
          rData[idx] = 255;
          rData[idx + 1] = 255;
          rData[idx + 2] = 255;
          rData[idx + 3] = 255;
          heightBuf[y * size + x] = 0.0;
          continue;
        }

        // Smooth meniscus contact edge
        const smoothEdge = 1.0 - smoothstep(0.93, 1.02, normR);

        // Physical "coffee-ring" coagulation profile:
        // 1. Thick raised outer meniscus ridge at normR ~ 0.83
        const outerRidge = Math.exp(-Math.pow((normR - 0.83) / 0.115, 2.0));
        // 2. Secondary inner coagulation wave at normR ~ 0.54
        const midWave = Math.exp(-Math.pow((normR - 0.54) / 0.15, 2.0)) * 0.30;
        // 3. Dense coagulated central droplet core at normR < 0.30
        const centerClot = Math.exp(-Math.pow(normR / 0.30, 2.0));

        // Smooth organic cellular marbling
        const cellMacro = fbm2D(px * 7.5, py * 7.5, 3, seed + 10.0);
        const cellMicro = fbm2D(px * 18.0, py * 18.0, 3, seed + 23.0);

        // Smooth 3D height for normal map
        const meniscusShoulder = smoothstep(1.01, 0.86, normR);
        const hVal = meniscusShoulder * (
          0.24 +
          outerRidge * 0.56 +
          midWave * 0.15 +
          centerClot * 0.30 +
          (cellMacro - 0.5) * 0.07
        );
        heightBuf[y * size + x] = hVal;

        // Authentic hematology color transition:
        const opticalThickness = clamp01(
          0.22 + outerRidge * 0.72 + centerClot * 0.65 + midWave * 0.24 + (cellMacro - 0.5) * 0.18
        );

        // Luminous arterial ruby-crimson (thin zone) vs deep venous garnet-black (thick clot ring)
        const thinR = 175, thinG = 9, thinB = 14;
        const thickR = 30, thickG = 2, thickB = 4;

        let r = thinR + (thickR - thinR) * Math.pow(opticalThickness, 0.85);
        let g = thinG + (thickG - thinG) * Math.pow(opticalThickness, 0.95);
        let b = thinB + (thickB - thinB) * Math.pow(opticalThickness, 0.95);

        const microMod = 0.88 + cellMicro * 0.24;
        r *= microMod;
        g *= microMod;
        b *= microMod;

        aData[idx] = Math.min(255, Math.max(0, Math.round(r)));
        aData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
        aData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));

        // High opacity inside the specimen so the crimson column in the box is rich and vivid
        const specimenAlpha = smoothEdge * (0.93 + opticalThickness * 0.06);
        aData[idx + 3] = Math.min(255, Math.max(0, Math.round(specimenAlpha * 255)));

        // Roughness: glossy resinous outer meniscus ring (0.06), tight satin-gloss interior (0.14)
        const rough = clamp01(0.15 - outerRidge * 0.09 - centerClot * 0.04 + (1.0 - cellMicro) * 0.05);
        const roughByte = Math.round(rough * 255);
        rData[idx] = roughByte;
        rData[idx + 1] = roughByte;
        rData[idx + 2] = roughByte;
        rData[idx + 3] = 255;
      }
    }

    albedoCtx.putImageData(albedoImg, 0, 0);
    roughCtx.putImageData(roughImg, 0, 0);

    const map = new THREE.CanvasTexture(albedoCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = maxAnisotropy;
    map.needsUpdate = true;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.anisotropy = maxAnisotropy;
    roughnessMap.needsUpdate = true;

    const normalMap = heightBufferToNormalTexture(heightBuf, size, size, 2.8, false);
    normalMap.anisotropy = maxAnisotropy;

    variants.push({ map, normalMap, roughnessMap });
  }

  return variants;
}

/**
 * 6. Crystal-Clear Microscope Glass Slide Optical Face Map
 * Pure optical clarity with a razor-thin ground edge catchlight and subtle diagonal studio reflection.
 * No artificial inner square that cuts across the blood specimen!
 */
export function createGlassSlideSurfaceMaps(maxAnisotropy = 8) {
  const width = 512;
  const height = 256;

  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = width;
  alphaCanvas.height = height;
  const ctx = alphaCanvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const data = img.data;

  const heightBuf = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const v = y / height;
    const ny = (v - 0.5) * 2.0; // -1..1
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const nx = (u - 0.5) * 2.0; // -1..1

      // 1. Gentle optical edge catchlight at the outer perimeter
      const edgeX = smoothstep(0.95, 1.0, Math.abs(nx));
      const edgeY = smoothstep(0.92, 1.0, Math.abs(ny));
      const edgeRim = Math.max(edgeX, edgeY);

      // 2. Subtle diagonal studio light reflection band across the optical face
      const diag1 = Math.pow(clamp01(1.0 - Math.abs(nx * 0.6 + ny * 0.4 - 0.15)), 3.5) * 0.045;
      const diag2 = Math.pow(clamp01(1.0 - Math.abs(nx * 0.6 + ny * 0.4 + 0.42)), 4.5) * 0.025;
      const diagSheen = diag1 + diag2;

      heightBuf[y * width + x] = -edgeRim * 0.05;

      const idx = (y * width + x) * 4;
      data[idx] = Math.round(228 - edgeRim * 10);
      data[idx + 1] = Math.round(245 - edgeRim * 2);
      data[idx + 2] = Math.round(240 - edgeRim * 4);

      // Smooth optical glass alpha profile (avoids harsh contrast lines across stacked slides)
      const alpha = clamp01(0.085 + diagSheen + edgeRim * 0.11);
      data[idx + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(alphaCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;
  map.needsUpdate = true;

  const normalMap = heightBufferToNormalTexture(heightBuf, width, height, 1.4, false);
  normalMap.anisotropy = maxAnisotropy;

  return { map, normalMap };
}
