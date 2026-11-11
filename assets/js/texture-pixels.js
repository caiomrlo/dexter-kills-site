/**
 * Pixel math for the procedural textures (wood, brass, rack, blood specimens, glass waviness).
 * No DOM and no three.js, so it runs inside a Web Worker (texture-worker.js) and keeps
 * the ~2 s of number crunching off the main thread. textures.js turns the buffers into textures.
 *
 * Every map is { width, height, data: Uint8ClampedArray RGBA }.
 */

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

/** Value noise that repeats every px x py lattice cells, so a texture built from it tiles. */
function noiseP(x, y, px, py, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
  const uy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);
  const x0 = ((ix % px) + px) % px;
  const y0 = ((iy % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Tileable fbm over u, v in [0, 1), normalised to ~0..1. px/py = cells across the tile at the first octave. */
function fbmP(u, v, px, py, octaves = 4, seed = 0) {
  let val = 0.0;
  let amp = 0.5;
  let norm = 0.0;
  for (let i = 0; i < octaves; i++) {
    val += amp * noiseP(u * px, v * py, px, py, seed + i * 19.19);
    norm += amp;
    px *= 2;
    py *= 2;
    amp *= 0.5;
  }
  return val / norm;
}

function clamp01(v) {
  return v < 0.0 ? 0.0 : v > 1.0 ? 1.0 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3.0 - 2.0 * t);
}

const rgba = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

/** Scalar height buffer -> smooth 3x3 Sobel normal map. */
function heightToNormal(heightBuf, width, height, strength = 2.0, repeat = true) {
  const out = rgba(width, height);
  const data = out.data;

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
  return out;
}

/**
 * 1. Flat-sawn reddish mahogany (albedo, normal, roughness). Seamlessly tileable.
 * Grain runs along v (texture rows); geometry.js maps v along each board's length.
 * Layers: wavy growth bands with a soft earlywood -> sharp latewood edge, long fibre
 * streaks, short dark pore dashes and broad colour blotches.
 */
export function woodPixels() {
  const width = 1024;
  const height = 1024;
  const albedo = rgba(width, height);
  const rough = rgba(width, height);
  const aData = albedo.data;
  const rData = rough.data;
  const heightBuf = new Float32Array(width * height);

  const BANDS = 26; // growth bands across one tile
  // Light earlywood, mid, dark latewood (reddish mahogany)
  const L = [176, 74, 46];
  const M = [122, 40, 24];
  const D = [52, 14, 9];

  // The slow fields (grain meander, colour blotches) are smooth, so build them on a
  // coarse tileable grid and interpolate: same look, a fraction of the noise calls.
  const C = 256;
  const meander = new Float32Array(C * C);
  const blotches = new Float32Array(C * C);
  for (let cy = 0; cy < C; cy++) {
    for (let cx = 0; cx < C; cx++) {
      const cu = cx / C;
      const cv = cy / C;
      meander[cy * C + cx] = (fbmP(cu, cv, 3, 2, 4, 1.7) - 0.5) * 3.2 + (fbmP(cu, cv, 9, 3, 2, 4.1) - 0.5) * 0.35;
      blotches[cy * C + cx] = fbmP(cu, cv, 2, 3, 3, 9.9);
    }
  }
  const sampleCoarse = (buf, u, v) => {
    const fx = u * C;
    const fy = v * C;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const xa = x0 % C;
    const xb = (x0 + 1) % C;
    const ya = (y0 % C) * C;
    const yb = ((y0 + 1) % C) * C;
    const top = buf[ya + xa] + (buf[ya + xb] - buf[ya + xa]) * tx;
    const bot = buf[yb + xa] + (buf[yb + xb] - buf[yb + xa]) * tx;
    return top + (bot - top) * ty;
  };

  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;

      // Gentle sideways meander of the grain (in band units)
      const m = sampleCoarse(meander, u, v);
      const uw = u + m / BANDS; // fibres follow the meander too

      // Growth bands: each one ramps from light to a crisp dark edge, width/contrast varies per band
      const g = u * BANDS + m;
      const gi = Math.floor(g);
      const f = g - gi;
      const bandId = ((gi % BANDS) + BANDS) % BANDS;
      const bh = hash2(bandId, 0, 3.3);
      const bandStrength = 0.45 + hash2(bandId, 1, 6.1) * 0.55;
      const band = Math.pow(f, 2.2 + bh * 3.5) * (1.0 - smoothstep(0.96, 1.0, f) * 0.6) * bandStrength;

      // Long fibre streaks (fine across, stretched along the grain)
      const fiber = fbmP(uw, v, 150, 3, 3, 5.3);
      const fiberFine = noiseP(uw * 460, v * 8, 460, 8, 8.8);

      // Pores: thin dark dashes stretched along the grain
      const pn = noiseP(uw * 380, v * 22, 380, 22, 11.4);
      const pore = smoothstep(0.84, 0.97, pn);

      // Broad colour variation between areas of the board
      const blotch = sampleCoarse(blotches, u, v);

      let t = 0.30 + band * 0.42 + (fiber - 0.5) * 0.55 + (fiberFine - 0.5) * 0.18 + (blotch - 0.5) * 0.45;
      t = clamp01(t);

      let r, gg, b;
      if (t < 0.5) {
        const k = t / 0.5;
        r = L[0] + (M[0] - L[0]) * k;
        gg = L[1] + (M[1] - L[1]) * k;
        b = L[2] + (M[2] - L[2]) * k;
      } else {
        const k = (t - 0.5) / 0.5;
        r = M[0] + (D[0] - M[0]) * k;
        gg = M[1] + (D[1] - M[1]) * k;
        b = M[2] + (D[2] - M[2]) * k;
      }
      const poreDark = 1.0 - pore * 0.45;
      r *= poreDark;
      gg *= poreDark;
      b *= poreDark;

      const idx = (y * width + x) * 4;
      aData[idx] = Math.min(255, Math.max(0, Math.round(r)));
      aData[idx + 1] = Math.min(255, Math.max(0, Math.round(gg)));
      aData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      aData[idx + 3] = 255;

      heightBuf[y * width + x] = fiber * 0.22 + fiberFine * 0.06 - band * 0.10 - pore * 0.55;

      const roughVal = Math.round(clamp01(0.20 + band * 0.06 + (1.0 - fiber) * 0.05 + pore * 0.30) * 255);
      rData[idx] = roughVal;
      rData[idx + 1] = roughVal;
      rData[idx + 2] = roughVal;
      rData[idx + 3] = 255;
    }
  }

  return { map: albedo, roughnessMap: rough, normalMap: heightToNormal(heightBuf, width, height, 1.6, true) };
}

/** 2. Brushed Antique Brass (albedo, normal, roughness). */
export function brassPixels() {
  const width = 256;
  const height = 256;
  const albedo = rgba(width, height);
  const roughMap = rgba(width, height);
  const aData = albedo.data;
  const rData = roughMap.data;
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

  return { map: albedo, roughnessMap: roughMap, normalMap: heightToNormal(heightBuf, width, height, 1.0, true) };
}

/** 3. Cream / Ivory slotted wood rack (albedo, normal). */
export function rackPixels() {
  const width = 256;
  const height = 256;
  const albedo = rgba(width, height);
  const data = albedo.data;
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

  return { map: albedo, normalMap: heightToNormal(heightBuf, width, height, 0.9, true) };
}

/**
 * 5. Coagulated blood drop specimens: 4 variations (512x512) with
 * albedo + alpha, a smooth meniscus normal map and a roughness map.
 */
export function bloodPixels(only = -1) {
  const variants = [];
  const size = 512;

  for (let vIdx = 0; vIdx < 4; vIdx++) {
    if (only >= 0 && vIdx !== only) continue;
    const seed = (vIdx + 1) * 13.37;
    const albedo = rgba(size, size);
    const roughMap = rgba(size, size);
    const aData = albedo.data;
    const rData = roughMap.data;
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
          // Outside the drop: transparent albedo, fully rough
          rData[idx] = 255;
          rData[idx + 1] = 255;
          rData[idx + 2] = 255;
          rData[idx + 3] = 255;
          continue;
        }

        // Smooth meniscus contact edge
        const smoothEdge = 1.0 - smoothstep(0.93, 1.02, normR);

        // Physical "coffee-ring" coagulation profile
        const outerRidge = Math.exp(-Math.pow((normR - 0.83) / 0.115, 2.0));
        const midWave = Math.exp(-Math.pow((normR - 0.54) / 0.15, 2.0)) * 0.30;
        const centerClot = Math.exp(-Math.pow(normR / 0.30, 2.0));

        // Smooth organic cellular marbling
        const cellMacro = fbm2D(px * 7.5, py * 7.5, 3, seed + 10.0);
        const cellMicro = fbm2D(px * 18.0, py * 18.0, 3, seed + 23.0);

        // Smooth 3D height for normal map
        const meniscusShoulder = smoothstep(1.01, 0.86, normR);
        heightBuf[y * size + x] = meniscusShoulder * (
          0.24 +
          outerRidge * 0.56 +
          midWave * 0.15 +
          centerClot * 0.30 +
          (cellMacro - 0.5) * 0.07
        );

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

        // Roughness: glossy resinous outer meniscus ring, tight satin-gloss interior
        const rough = clamp01(0.15 - outerRidge * 0.09 - centerClot * 0.04 + (1.0 - cellMicro) * 0.05);
        const roughByte = Math.round(rough * 255);
        rData[idx] = roughByte;
        rData[idx + 1] = roughByte;
        rData[idx + 2] = roughByte;
        rData[idx + 3] = 255;
      }
    }

    variants.push({
      map: albedo,
      roughnessMap: roughMap,
      normalMap: heightToNormal(heightBuf, size, size, 2.8, false)
    });
  }

  return variants;
}

/** 6b. Very low-amplitude float-glass waviness normal map for the slides. */
export function glassNormalPixels() {
  const width = 256;
  const height = 96;
  const heightBuf = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      heightBuf[y * width + x] = fbm2D(x / 48, y / 24, 3, 7) * 0.06;
    }
  }
  return heightToNormal(heightBuf, width, height, 1.0, false);
}

/**
 * Canvas textures are uploaded with flipY; flipping the rows here instead lets the raw
 * buffers go to the GPU as is (a flipY on raw data is slow and deprecated in Firefox).
 */
function flipRows(obj) {
  if (obj && obj.data instanceof Uint8ClampedArray) {
    const { width, height, data } = obj;
    const stride = width * 4;
    const tmp = new Uint8ClampedArray(stride);
    for (let top = 0, bot = height - 1; top < bot; top++, bot--) {
      tmp.set(data.subarray(top * stride, top * stride + stride));
      data.copyWithin(top * stride, bot * stride, bot * stride + stride);
      data.set(tmp, bot * stride);
    }
  } else if (obj && typeof obj === 'object') {
    for (const k in obj) flipRows(obj[k]);
  }
  return obj;
}

/** Independent jobs, so several workers can share the work. Rows come out flipped for upload. */
export const TEXTURE_JOBS = ['wood', 'blood0', 'blood1', 'blood2', 'blood3', 'brass', 'rack', 'glassNormal'];

export function texturePixelsJob(job) {
  let out;
  if (job.startsWith('blood')) out = bloodPixels(Number(job.slice(5)))[0];
  else if (job === 'wood') out = woodPixels();
  else if (job === 'brass') out = brassPixels();
  else if (job === 'rack') out = rackPixels();
  else if (job === 'glassNormal') out = glassNormalPixels();
  else throw new Error(`Unknown texture job ${job}`);
  return flipRows(out);
}

/** Job results -> the shape textures.js reads. */
export function assembleTexturePixels(byJob) {
  return {
    wood: byJob.wood,
    brass: byJob.brass,
    rack: byJob.rack,
    blood: [byJob.blood0, byJob.blood1, byJob.blood2, byJob.blood3],
    glassNormal: byJob.glassNormal
  };
}

/** Everything in one go, on the calling thread (fallback when workers are unavailable). */
export function allTexturePixels() {
  const byJob = {};
  for (const job of TEXTURE_JOBS) byJob[job] = texturePixelsJob(job);
  return assembleTexturePixels(byJob);
}

/** Every pixel buffer in a result, for zero-copy transfer out of the worker. */
export function collectBuffers(obj, out = []) {
  if (obj && obj.data instanceof Uint8ClampedArray) out.push(obj.data.buffer);
  else if (obj && typeof obj === 'object') for (const k in obj) collectBuffers(obj[k], out);
  return out;
}
