/**
 * WebGPU WGSL Shaders for Dexter's Blood Slide Trophy Box
 * Includes studio PBR lighting, fine-pored mahogany wood grain,
 * sculpted warm-gold brass latch with embossed reliefs & countersunk Phillips screws,
 * textured index card, and crystal-clear microscope glass slides with coagulated blood specimens.
 */

export const WGSL_SHADER = /* wgsl */ `
struct SceneUniforms {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  // x: lidOpenFactor (0..1), y: time, z: hoveredSlideIndex (-1 if none), w: selectedSlideIndex (-1 if none)
  params : vec4<f32>,
};

struct ObjectUniforms {
  model : mat4x4<f32>,
  normalMat : mat4x4<f32>,
  // x: slideIndex (-1 for box parts), y: hoverAmount (0..1), z: selectAmount (0..1), w: seed
  objParams : vec4<f32>,
};

@group(0) @binding(0) var<uniform> scene : SceneUniforms;
@group(0) @binding(1) var indexCardTex : texture_2d<f32>;
@group(0) @binding(2) var indexCardSampler : sampler;

@group(1) @binding(0) var<uniform> obj : ObjectUniforms;

struct VertexInput {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv : vec2<f32>,
  @location(3) matId : f32,
  @location(4) extra : f32,
};

struct VertexOutput {
  @builtin(position) @invariant clipPos : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
  @location(1) localPos : vec3<f32>,
  @location(2) worldNormal : vec3<f32>,
  @location(3) uv : vec2<f32>,
  @location(4) matId : f32,
  @location(5) extra : f32,
};

@vertex
fn vs_main(in : VertexInput) -> VertexOutput {
  var out : VertexOutput;
  let worldPos4 = obj.model * vec4<f32>(in.position, 1.0);
  out.worldPos = worldPos4.xyz;
  out.localPos = in.position;
  out.worldNormal = normalize((obj.normalMat * vec4<f32>(in.normal, 0.0)).xyz);
  out.uv = in.uv;
  out.matId = in.matId;
  out.extra = in.extra;
  // Floor reflection pass (objParams.w < -0.5): mirror the geometry across the floor plane (Y = 0)
  // only for rasterization; shading still uses the original (un-mirrored) world position/normal.
  var clipWorld = worldPos4;
  if (obj.objParams.w < -0.5) {
    clipWorld.y = -clipWorld.y;
  }
  out.clipPos = scene.viewProj * clipWorld;
  return out;
}

// --- Procedural Noise Functions for Fine Rosewood/Mahogany, Patina & Blood Microstructure ---

fn hash31(p : vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn noise3D(p : vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let n000 = hash31(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));

  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);

  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);

  return mix(nxy0, nxy1, u.z);
}

fn fbm3D(p : vec3<f32>) -> f32 {
  var val = 0.0;
  var amp = 0.5;
  var pos = p;
  for (var i = 0; i < 4; i++) {
    val += amp * noise3D(pos);
    pos = pos * 2.03 + vec3<f32>(13.7, 7.1, 19.3);
    amp *= 0.5;
  }
  return val;
}

// Studio softbox environment approximation for realistic specular reflections
fn sampleStudioEnv(reflDir : vec3<f32>, roughness : f32) -> vec3<f32> {
  let y = clamp(reflDir.y, -1.0, 1.0);
  let keySoftbox = smoothstep(0.34 - roughness * 0.28, 0.92, dot(reflDir, normalize(vec3<f32>(-0.36, 0.86, 0.35))));
  let frontStrip = smoothstep(0.42 - roughness * 0.25, 0.94, dot(reflDir, normalize(vec3<f32>(-0.14, 0.72, 0.68))));
  let rightFill  = smoothstep(0.48 - roughness * 0.30, 0.94, dot(reflDir, normalize(vec3<f32>(0.52, 0.78, 0.34))));
  let backRim    = smoothstep(0.42, 0.90, dot(reflDir, normalize(vec3<f32>(0.0, 0.48, -0.88))));
  let horizon    = mix(vec3<f32>(0.26, 0.23, 0.22), vec3<f32>(0.84, 0.84, 0.86), smoothstep(-0.35, 0.55, y));
  return horizon + vec3<f32>(1.0, 0.96, 0.90) * (keySoftbox * 0.82 + frontStrip * 0.45 + rightFill * 0.36 + backRim * 0.30);
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
  let isReflection = obj.objParams.w < -0.5;

  // For the mirrored floor reflection, view the original surface from the mirrored camera
  var camPos = scene.cameraPos.xyz;
  if (isReflection) {
    camPos.y = -camPos.y;
  }

  let col = shadeSurface(in, camPos, isReflection);

  if (isReflection) {
    let matId = i32(round(in.matId));
    if (matId == 0) {
      discard;
    }

    // Glossy studio floor reflection matching the reference photo:
    // Smoothly spans from Y = 0 down across the front face (0..0.64)
    let h = max(in.worldPos.y, 0.0);
    let verticalFade = pow(1.0 - smoothstep(0.0, 0.64, h), 1.45);

    // Soften lateral edges of reflection at X = +-0.96
    let sideEdgeSoft = smoothstep(0.965, 0.88, abs(in.worldPos.x));

    // Crisp dark contact shadow crease right at Y = 0 where the box touches the floor
    let contactCrease = mix(0.18, 1.0, smoothstep(0.0, 0.068, h));

    // Base warm mahogany reflection tone
    let mahoganyReflBase = vec3<f32>(0.24, 0.075, 0.042);
    var reflRgb = col.rgb;

    if (matId == 1) {
      // Rich, warm reddish-brown mahogany reflection matching Reference Image
      reflRgb = mix(reflRgb * 1.15, mahoganyReflBase, 0.32);
    } else if (matId == 2) {
      // Soften & blend the reflected gold latch into the warm mahogany reflection
      // so the brass reflection looks softly blurred and fades out together with the wood!
      let brassSoftness = 0.32 + smoothstep(0.0, 0.52, h) * 0.50;
      let warmGoldRefl = mix(reflRgb, vec3<f32>(0.76, 0.52, 0.20), 0.42);
      reflRgb = mix(warmGoldRefl, mahoganyReflBase * 1.25, brassSoftness);
    }

    reflRgb *= contactCrease;
    let reflAlpha = clamp(col.a * verticalFade * sideEdgeSoft * 0.76, 0.0, 0.80);
    return vec4<f32>(reflRgb, reflAlpha);
  }
  return col;
}

fn shadeSurface(in : VertexOutput, camPos : vec3<f32>, isReflection : bool) -> vec4<f32> {
  let N = normalize(in.worldNormal);
  let V = normalize(camPos - in.worldPos);
  let R = reflect(-V, N);
  let NoV = max(dot(N, V), 0.001);

  // Sample index card texture unconditionally in uniform control flow
  let cardSample = textureSample(indexCardTex, indexCardSampler, in.uv);

  // Studio lighting vectors (Key from top-left-front matching Reference Image)
  let L_key  = normalize(vec3<f32>(-0.44, 0.79, 0.42));
  let L_fill = normalize(vec3<f32>(0.52, 0.68, 0.51));
  let L_rim  = normalize(vec3<f32>(-0.15, 0.58, -0.80));

  let matId = i32(round(in.matId));

  // ==========================================================
  // MATERIAL 0: SEAMLESS STUDIO CYCLORAMA FLOOR + SOFT SHADOW
  // ==========================================================
  if (matId == 0) {
    let boxHalf = vec2<f32>(0.955, 2.59);
    let pXZ = in.worldPos.xz;
    let dBox = abs(pXZ) - boxHalf;
    let dist = length(max(dBox, vec2<f32>(0.0))) + min(max(dBox.x, dBox.y), 0.0);

    // Prevent floor shadow behind Z = -2.45 from peeking above the back top edge of the closed lid in perspective
    let rearClipMask = mix(smoothstep(-2.56, -2.35, pXZ.y), 1.0, scene.params.x);

    // 1. Crisp pitch-black contact shadow directly under the box and along its bottom seam
    let underFootprint = smoothstep(0.03, -0.04, dist) * 0.88 * rearClipMask;
    let tightContact   = exp(-max(dist, 0.0) * 36.0) * 0.78 * rearClipMask;
    let nearContact    = exp(-max(dist, 0.0) * 9.5) * 0.28 * rearClipMask;

    // 2. Compact, atmospheric studio shadows flanking the left & right front sides of the box
    // (Matches Reference Image: concentrated near the lower flanks z in [0.0..2.55], fading cleanly within ~1.2 units in X)
    let sideDistX = max(abs(pXZ.x) - 0.93, 0.0);
    let zFlankMask = smoothstep(-0.8, 1.5, pXZ.y) * (1.0 - smoothstep(2.15, 2.60, pXZ.y));
    let lateralShadow = (exp(-sideDistX * 2.15) * 0.44 + exp(-sideDistX * 1.05) * 0.14) * zFlankMask;

    // 3. Soft shadow strictly under the immediate front reflection zone (|x| < 0.96, z in 2.58..3.1)
    let frontZ = max(pXZ.y - 2.58, 0.0);
    let frontXMask = smoothstep(0.98, 0.82, abs(pXZ.x));
    let underReflShadow = exp(-frontZ * 5.8) * frontXMask * 0.26;

    // 4. Additional shadow behind the box when the lid swings open backward
    let lidRearDist = length((pXZ - vec2<f32>(0.0, -3.1)) * vec2<f32>(0.85, 0.65));
    let lidOpenShadow = scene.params.x * exp(-lidRearDist * 1.15) * 0.24;

    let radialFade = 1.0 - smoothstep(3.5, 8.0, length(pXZ));
    let shadowAlpha = clamp(
      (underFootprint + tightContact + nearContact + lateralShadow + underReflShadow + lidOpenShadow) * radialFade,
      0.0,
      0.90
    );

    return vec4<f32>(0.02, 0.018, 0.02, shadowAlpha);
  }

  // ==========================================================
  // MATERIAL 1: RICH MAHOGANY / ROSEWOOD BOX (Fine Interlocked Grain & Studio Sheen)
  // ==========================================================
  if (matId == 1) {
    let isFrontBack = step(0.60, abs(N.z));

    // Fine, dense, organic mahogany/rosewood grain matching Reference Image (no wide zebra stripes!)
    var pGrain : vec3<f32>;
    if (isFrontBack > 0.5) {
      // Interlocked horizontal mahogany figure on front/back vertical walls
      pGrain = vec3<f32>(in.localPos.x * 3.8, in.localPos.y * 14.5 + in.worldPos.y * 3.0, in.localPos.z * 6.0);
    } else {
      // Fine elongated longitudinal rosewood/mahogany grain running along Z on the top & sides
      pGrain = vec3<f32>(in.localPos.x * 14.5 + in.localPos.y * 2.5, in.localPos.z * 1.65, in.localPos.y * 8.0);
    }

    let warp1 = fbm3D(pGrain * vec3<f32>(0.95, 0.85, 1.0));
    let warp2 = fbm3D(pGrain * vec3<f32>(2.4, 2.1, 2.0) + vec3<f32>(5.2, 1.9, 8.4));
    let fineFibers = fbm3D(pGrain * vec3<f32>(4.8, 3.6, 3.0) + vec3<f32>(warp1 * 2.2));

    // Subtle wavy ribbon figure + fine dark mahogany pore streaks
    let ribbonCoord = pGrain.x * 1.85 + warp1 * 3.6 + warp2 * 1.6 + sin(pGrain.y * 1.8 + warp1 * 2.2) * 0.65;
    let grainWave = sin(ribbonCoord) * 0.5 + 0.5;
    let subtleVein = pow(1.0 - abs(sin(ribbonCoord * 1.4 + warp2 * 1.8)), 3.2);

    // Fine open wood pores
    let poreFreq = select(vec3<f32>(190.0, 24.0, 90.0), vec3<f32>(32.0, 180.0, 90.0), isFrontBack > 0.5);
    let poreNoise = noise3D(in.localPos * poreFreq + vec3<f32>(warp1 * 3.5));
    let poreMask = smoothstep(0.64, 0.89, poreNoise) * (0.55 + 0.45 * subtleVein);

    // Rich, cohesive dark reddish-brown Mahogany palette matching Reference Image
    let darkPoreCol  = vec3<f32>(0.055, 0.008, 0.003); // Deep dark espresso-black pores
    let deepMahogany = vec3<f32>(0.185, 0.032, 0.011); // Deep mahogany shadow tone
    let richMahogany = vec3<f32>(0.335, 0.068, 0.022); // Rich reddish-mahogany midtone
    let warmAmber    = vec3<f32>(0.485, 0.125, 0.042); // Warm mahogany highlight undertone

    var woodColor = mix(deepMahogany, richMahogany, grainWave * 0.42 + fineFibers * 0.58);
    woodColor = mix(woodColor, warmAmber, smoothstep(0.45, 0.85, fineFibers * 0.6 + grainWave * 0.4) * 0.38);
    woodColor = mix(woodColor, darkPoreCol, clamp(subtleVein * 0.32 + poreMask * 0.48, 0.0, 0.78));

    // Micro-normal perturbation from wood fibers & pores
    let bumpScale = select(1.0, 0.18, isReflection);
    let nPerturb = normalize(
      N + vec3<f32>(
        (poreNoise - 0.5) * 0.028 + (fineFibers - 0.5) * 0.016,
        (grainWave - 0.5) * 0.012,
        (warp2 - 0.5) * 0.018
      ) * bumpScale
    );

    // Studio diffuse lighting
    let diffKey  = clamp((dot(nPerturb, L_key) + 0.30) / 1.30, 0.0, 1.0);
    let diffFill = clamp((dot(nPerturb, L_fill) + 0.35) / 1.35, 0.0, 1.0);
    let diffRim  = clamp((dot(nPerturb, L_rim) + 0.30) / 1.30, 0.0, 1.0);
    var diffuse = diffKey * 0.60 + diffFill * 0.28 + diffRim * 0.16 + 0.26;

    // ==========================================================================
    // STUDIO LIGHTING & SPECULAR CATCHLIGHTS MATCHING REFERENCE IMAGE:
    // 1. Silky warm-champagne diagonal softbox sheen along the left side of the lid top
    // 2. Crisp white catchlight near the back-left edge of the lid
    // 3. Localized white-warm catchlights on the front-top & side-top bevels
    // ==========================================================================
    let isTopFace = smoothstep(0.55, 0.95, N.y);
    let zNorm = clamp((in.worldPos.z + 2.60) / 5.20, 0.0, 1.0); // 0 = back hinge, 1 = front latch edge
    let closedMask = 1.0 - scene.params.x * 0.75;

    // Diagonal light streak center sweeps from back-left (x = -0.85 at zNorm=0.15) to front-left (x = -0.45 at zNorm=1.0)
    let streakCenterX = mix(-0.86, -0.45, zNorm);
    let streakWidth   = mix(0.20, 0.34, zNorm);
    let distToStreak  = abs(in.worldPos.x - streakCenterX) + (warp1 - 0.5) * 0.035;

    let diagonalSheen = isTopFace * exp(-pow(distToStreak / streakWidth, 2.0)) * closedMask;
    let streakCore    = isTopFace * exp(-pow(distToStreak / (streakWidth * 0.52), 2.0)) * closedMask;

    // Localized bright edge catchlight near the back-left corner of the lid (matching Reference Image)
    let backLeftGlint = isTopFace
      * exp(-pow((in.worldPos.x - (-0.85)) / 0.10, 2.0))
      * exp(-pow((zNorm - 0.19) / 0.16, 2.0))
      * closedMask;

    // Right-side studio falloff on the top of the lid so the right half is deep, rich dark mahogany
    let topRightShade = mix(1.0, 0.70, isTopFace * smoothstep(-0.10, 0.72, in.worldPos.x));
    diffuse = diffuse * topRightShade + diagonalSheen * 0.42;

    // Standard PBR clearcoat + wood specular
    let H_key  = normalize(L_key + V);
    let H_fill = normalize(L_fill + V);
    let specWood = pow(max(dot(nPerturb, H_key), 0.0), 22.0) * 0.15;
    let specCoat = pow(max(dot(N, H_key), 0.0), 85.0) * 0.20 + pow(max(dot(N, H_fill), 0.0), 45.0) * 0.10;

    // Bevel Masks
    let frontTopBevelMask = smoothstep(0.25, 0.68, N.y) * smoothstep(0.25, 0.68, N.z);
    let sideTopBevelMask  = smoothstep(0.25, 0.68, N.y) * smoothstep(0.25, 0.68, abs(N.x));
    let vertCornerBevel   = smoothstep(0.25, 0.68, abs(N.x)) * smoothstep(0.25, 0.68, abs(N.z));
    let isLidBevel        = step(0.43, in.worldPos.y);
    let isBaseTopLip      = smoothstep(0.36, 0.42, in.worldPos.y) * step(in.worldPos.y, 0.425);

    // Localized glints along the front-top bevel of the lid:
    let frontBevelGlints = 0.12
      + 0.68 * exp(-pow((in.worldPos.x - (-0.91)) / 0.08, 2.0))
      + 0.52 * exp(-pow((in.worldPos.x - (-0.45)) / 0.20, 2.0))
      + 0.56 * exp(-pow((in.worldPos.x - 0.74) / 0.20, 2.0));

    let leftBevelProfile  = step(in.worldPos.x, 0.0) * (0.42 + 0.55 * exp(-pow((zNorm - 0.22) / 0.26, 2.0)));
    let rightBevelProfile = step(0.0, in.worldPos.x) * (0.36 + 0.22 * zNorm);

    let hairlineNoise = smoothstep(0.86, 0.98, noise3D(in.localPos * vec3<f32>(160.0, 40.0, 160.0))) * 0.22;

    let bevelSpec = frontTopBevelMask * isLidBevel * (frontBevelGlints + hairlineNoise * frontBevelGlints)
                  + sideTopBevelMask * isLidBevel * (leftBevelProfile + rightBevelProfile)
                  + frontTopBevelMask * isBaseTopLip * 0.18
                  + vertCornerBevel * 0.14;

    let fresnel = pow(1.0 - NoV, 4.2) * 0.16;
    let envRefl = sampleStudioEnv(reflect(-V, nPerturb), 0.18);

    // Silky warm-champagne studio reflection in the diagonal sheen (matches Reference Image's soft peachy-white highlight)
    let grainMod = 0.75 + 0.25 * fineFibers - poreMask * 0.30;
    let warmSheenSpec = (diagonalSheen * 0.24 + streakCore * 0.22) * grainMod + specWood;
    let whiteCoatSpec = specCoat + backLeftGlint * 0.58 + streakCore * 0.14 * grainMod + bevelSpec;

    // ==========================================================================
    // FRONT FACE SHADING, SEAM GROOVE & BRASS LATCH CAST SHADOW (AO)
    // ==========================================================================
    var aoFactor = 1.0;

    // 1. Deep horizontal seam groove between Lid and Base (Y = 0.42) when closed
    let seamDist = abs(in.worldPos.y - 0.42);
    let seamShadow = mix(1.0, smoothstep(0.003, 0.026, seamDist) * 0.85 + 0.15, 1.0 - scene.params.x);
    aoFactor *= seamShadow;

    // 2. Front wall shading gradient & latch cast shadow
    if (N.z > 0.45) {
      let isBaseFront = step(in.worldPos.y, 0.42);
      let baseVerticalGrad = mix(1.0, 0.62, isBaseFront * (1.0 - smoothstep(0.0, 0.38, in.worldPos.y)));
      let bottomContactVignette = smoothstep(0.0, 0.048, in.worldPos.y) * 0.66 + 0.34;
      let sideCornerVignette = 1.0 - smoothstep(0.72, 0.96, abs(in.worldPos.x)) * 0.26;
      aoFactor *= baseVerticalGrad * bottomContactVignette * sideCornerVignette;

      // Cast shadow from the Brass Latch plates & semicircular tabs onto the front wood
      let sp = vec2<f32>(in.worldPos.x - 0.010, in.worldPos.y + 0.014);
      let dPlate  = max(abs(sp.x) - 0.235, max(0.154 - sp.y, sp.y - 0.626));
      let dTopTab = length(sp - vec2<f32>(0.0, 0.625)) - 0.152;
      let dBotTab = length(sp - vec2<f32>(0.0, 0.156)) - 0.152;
      let dLatch  = min(dPlate, min(dTopTab, dBotTab));
      let latchCastShadow = 1.0 - exp(-max(dLatch, 0.0) * 36.0) * 0.68;
      aoFactor *= latchCastShadow;
    }

    if (N.y < -0.25) {
      aoFactor *= 0.20;
    }

    let litWood = mix(woodColor, warmAmber * 1.12, clamp(diagonalSheen * 0.38, 0.0, 0.45));
    let finalWood = (
      litWood * diffuse
      + envRefl * (fresnel + 0.03)
      + vec3<f32>(1.0, 0.85, 0.74) * warmSheenSpec
      + vec3<f32>(1.0, 0.97, 0.94) * whiteCoatSpec
    ) * aoFactor;

    return vec4<f32>(finalWood, 1.0);
  }

  // ==========================================================
  // MATERIAL 2: SCULPTED WARM GOLD / BRASS LATCH & HINGES
  // ==========================================================
  if (matId == 2) {
    let brushNoise  = noise3D(in.localPos * vec3<f32>(210.0, 50.0, 210.0));
    let patinaNoise = fbm3D(in.localPos * 38.0);

    // Rich, warm golden-amber brass palette matching Reference Image
    let brightGold = vec3<f32>(1.00, 0.83, 0.40);
    let midBrass   = vec3<f32>(0.88, 0.60, 0.19);
    let warmBronze = vec3<f32>(0.45, 0.24, 0.05);

    var goldAlbedo = mix(midBrass, brightGold, 0.56 - (brushNoise - 0.5) * 0.16);
    goldAlbedo = mix(goldAlbedo, warmBronze, smoothstep(0.52, 0.88, patinaNoise) * 0.25);

    var nBrass = normalize(N + vec3<f32>((brushNoise - 0.5) * 0.025, (patinaNoise - 0.5) * 0.018, 0.0));
    var reliefAO = 1.0;
    var specBoost = 1.0;

    // A. Rectangular Plates (extra == 0.0)
    if (in.extra < 0.5) {
      let ax = abs(in.localPos.x);
      let borderGroove = exp(-pow((ax - 0.206) / 0.010, 2.0));
      reliefAO *= (1.0 - borderGroove * 0.20);
      nBrass = normalize(nBrass + vec3<f32>(sign(in.localPos.x) * borderGroove * 0.14, 0.0, 0.0));

      let claspDistX = max(ax - 0.060, 0.0);
      let claspShadow = 1.0 - exp(-claspDistX * 42.0) * 0.50;
      reliefAO *= claspShadow;
    }

    // B. Central Hinged Clasp, Keeper & Knuckles (extra == 1.0)
    if (in.extra > 0.5 && in.extra < 1.5) {
      let ax = abs(in.localPos.x);
      let innerChannel = smoothstep(0.038, 0.026, ax);
      let stepWave = sin(in.localPos.y * 92.0);
      let stepCrevice = smoothstep(0.72, 0.98, stepWave) * 0.28;
      nBrass = normalize(nBrass + vec3<f32>(0.0, cos(in.localPos.y * 92.0) * 0.18, 0.0));
      reliefAO *= (1.0 - innerChannel * 0.18) * (1.0 - stepCrevice);
      specBoost = 1.12;
    }

    // C. Countersunk Domed Phillips Screws (extra == 2.0)
    if (in.extra > 1.5 && in.extra < 2.5) {
      let cUV = (in.uv - vec2<f32>(0.5, 0.5)) * 2.0;
      let r = length(cUV);

      let moatRing = exp(-pow((r - 0.82) / 0.09, 2.0));
      if (r < 0.78) {
        nBrass = normalize(N + vec3<f32>(cUV.x * 0.68, cUV.y * 0.68, 0.0));
      } else {
        nBrass = normalize(N - vec3<f32>(cUV.x * 0.38, cUV.y * 0.38, 0.0));
      }

      let armW = 0.13;
      let armL = 0.46;
      let inHoriz = smoothstep(armW + 0.04, armW - 0.02, abs(cUV.y)) * smoothstep(armL + 0.05, armL - 0.03, abs(cUV.x));
      let inVert  = smoothstep(armW + 0.04, armW - 0.02, abs(cUV.x)) * smoothstep(armL + 0.05, armL - 0.03, abs(cUV.y));
      let crossMask = clamp(max(inHoriz, inVert), 0.0, 1.0);

      let slotLip = smoothstep(0.11, 0.19, abs(cUV.x)) * step(abs(cUV.y), 0.40) * step(0.0, cUV.x)
                  + smoothstep(0.11, 0.19, abs(cUV.y)) * step(abs(cUV.x), 0.40) * step(cUV.y, 0.0);
      specBoost = 1.0 + slotLip * 0.55 * (1.0 - crossMask);

      reliefAO *= (1.0 - moatRing * 0.52) * mix(1.0, 0.18, crossMask);
    }

    // D. Semicircular Top & Bottom Rounded Tabs (extra == 3.0 or 4.0)
    if (in.extra > 2.5) {
      let centerY = select(0.156, 0.205, in.extra < 3.5);
      let dTab = vec2<f32>(in.localPos.x, in.localPos.y - centerY);
      let rNorm = length(dTab) / 0.152;
      let radialDir = normalize(dTab + vec2<f32>(0.0, 0.0001));

      let archGroove = exp(-pow((rNorm - 0.67) / 0.048, 2.0));
      let outerRimBevel = smoothstep(0.88, 0.99, rNorm);
      let grooveNormalShift = (rNorm - 0.67) / 0.048 * archGroove * 0.35 - outerRimBevel * 0.35;

      nBrass = normalize(nBrass + vec3<f32>(radialDir.x * grooveNormalShift, radialDir.y * grooveNormalShift, 0.0));
      reliefAO *= (1.0 - archGroove * 0.28) * (1.0 - outerRimBevel * 0.20);

      if (in.extra > 3.5) {
        let underClasp = smoothstep(0.068, 0.040, abs(in.localPos.x)) * smoothstep(0.050, 0.110, in.localPos.y);
        reliefAO *= (1.0 - underClasp * 0.45);
      }
    }

    let brassSeamDist = abs(in.worldPos.y - 0.42);
    let brassSeamAO = mix(1.0, smoothstep(0.002, 0.015, brassSeamDist) * 0.74 + 0.26, 1.0 - scene.params.x);
    reliefAO *= brassSeamAO;

    if (isReflection) {
      reliefAO = mix(1.0, reliefAO, 0.45);
    }

    let R_brass = reflect(-V, nBrass);
    let env = sampleStudioEnv(R_brass, 0.15);
    let H1 = normalize(L_key + V);
    let H2 = normalize(L_fill + V);
    let spec1 = pow(max(dot(nBrass, H1), 0.0), 88.0) * specBoost;
    let spec2 = pow(max(dot(nBrass, H2), 0.0), 36.0) * specBoost;
    let diff = max(dot(nBrass, L_key), 0.0) * 0.58 + max(dot(nBrass, L_fill), 0.0) * 0.36 + 0.34;

    var metallicColor = goldAlbedo * (env * 0.74 + diff * 0.50)
                      + vec3<f32>(1.0, 0.93, 0.72) * (spec1 * 0.72 + spec2 * 0.38);

    let creviceTint = mix(vec3<f32>(0.28, 0.13, 0.02), vec3<f32>(1.0, 1.0, 1.0), reliefAO);
    metallicColor *= creviceTint;

    return vec4<f32>(metallicColor, 1.0);
  }

  // ==========================================================
  // MATERIAL 3: SLOTTED CREAM WOOD / IVORY RACK & INNER LINING
  // ==========================================================
  if (matId == 3) {
    let fineGrain = noise3D(in.localPos * vec3<f32>(32.0, 32.0, 10.0)) * 0.04;
    var baseCream = vec3<f32>(0.93, 0.88, 0.80) - vec3<f32>(fineGrain);
    if (abs(in.extra - 0.2) < 0.05) {
      baseCream = vec3<f32>(0.95, 0.93, 0.89) - vec3<f32>(fineGrain * 0.5);
    }

    let cavityAO = mix(0.45, 1.0, clamp(scene.params.x * 0.85 + 0.25, 0.0, 1.0));
    let heightAO = smoothstep(0.06, 0.41, in.worldPos.y) * 0.30 + 0.70;

    let diff = max(dot(N, L_key), 0.0) * 0.58 + max(dot(N, L_fill), 0.0) * 0.36 + max(dot(N, L_rim), 0.0) * 0.22 + 0.46;
    let col = baseCream * diff * cavityAO * heightAO;
    return vec4<f32>(col, 1.0);
  }

  // ==========================================================
  // MATERIAL 4: LID NUMBERED INDEX CARD (01 - 50)
  // ==========================================================
  if (matId == 4) {
    let paperGrain = (noise3D(in.localPos * 60.0) - 0.5) * 0.02;
    let paperColor = cardSample.rgb + vec3<f32>(paperGrain);
    let diff = max(dot(N, L_key), 0.0) * 0.50 + max(dot(N, L_fill), 0.0) * 0.38 + max(dot(N, L_rim), 0.0) * 0.28 + 0.52;
    let lidAO = mix(0.35, 1.0, clamp(scene.params.x * 0.9 + 0.15, 0.0, 1.0));
    return vec4<f32>(paperColor * diff * lidAO, 1.0);
  }

  // ==========================================================
  // MATERIAL 5: GLASS MICROSCOPE SLIDE + DRIED BLOOD SPECIMEN
  // ==========================================================
  let hoverAmt = obj.objParams.y;
  let selectAmt = obj.objParams.z;
  let seed = obj.objParams.w;

  if (in.extra > 0.5) {
    let edgeTint = vec3<f32>(0.78, 0.90, 0.86);
    let env = sampleStudioEnv(R, 0.06);
    let H1 = normalize(L_key + V);
    let spec = pow(max(dot(N, H1), 0.0), 110.0);
    var edgeColor = mix(edgeTint, env, 0.50) + vec3<f32>(spec * 0.85);
    if (hoverAmt > 0.01 || selectAmt > 0.01) {
      edgeColor = mix(edgeColor, vec3<f32>(1.0, 0.88, 0.48), max(hoverAmt, selectAmt) * 0.55);
    }
    return vec4<f32>(edgeColor, 0.62 + max(hoverAmt, selectAmt) * 0.25);
  }

  let aspect = 1.36 / 0.46;
  let p = (in.uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(aspect, 1.0);

  let offsetX = sin(seed * 17.3) * 0.032;
  let offsetY = cos(seed * 29.1) * 0.020;
  let dp = p - vec2<f32>(offsetX, offsetY);

  let angle = atan2(dp.y, dp.x);
  let organicWobble = sin(angle * 3.0 + seed * 5.0) * 0.010 + cos(angle * 5.0 - seed * 3.7) * 0.006;
  let baseRadius = 0.295 + sin(seed * 11.7) * 0.018;
  let r = length(dp) + organicWobble;
  let normR = r / baseRadius;

  let borderX = smoothstep(0.475, 0.50, abs(in.uv.x - 0.5));
  let borderY = smoothstep(0.45, 0.50, abs(in.uv.y - 0.5));
  let bevelRim = max(borderX, borderY);

  let env = sampleStudioEnv(R, 0.04);
  let H1 = normalize(L_key + V);
  let H2 = normalize(L_fill + V);
  let specGlass = pow(max(dot(N, H1), 0.0), 150.0) * 0.70 + pow(max(dot(N, H2), 0.0), 90.0) * 0.35;
  let fresnel = clamp(pow(1.0 - NoV, 3.8), 0.0, 1.0);

  if (normR < 1.02) {
    let edgeSoft = 1.0 - smoothstep(0.93, 1.02, normR);
    let outerRing = exp(-pow((normR - 0.83) / 0.12, 2.0));
    let centerCore = exp(-pow(normR / 0.28, 2.0));
    let microCell = noise3D(vec3<f32>(dp * 42.0, seed * 3.1));

    let rubyMid  = vec3<f32>(0.54, 0.026, 0.032);
    let darkClot = vec3<f32>(0.22, 0.006, 0.009);
    let deepRim  = vec3<f32>(0.34, 0.010, 0.014);

    var bloodCol = mix(rubyMid, deepRim, outerRing * 0.78);
    bloodCol = mix(bloodCol, darkClot, centerCore * 0.68);
    bloodCol *= (0.88 + microCell * 0.24);

    let lightTrans = max(dot(N, L_key), 0.0) * 0.50 + 0.60;
    let finalBlood = bloodCol * lightTrans + env * 0.08 + vec3<f32>(specGlass * 0.75);
    let bloodAlpha = clamp(edgeSoft * 0.92, 0.0, 0.94);
    return vec4<f32>(finalBlood, bloodAlpha);
  }

  var glassColor = mix(vec3<f32>(0.88, 0.95, 0.92), env, 0.65) + vec3<f32>(specGlass);
  if (hoverAmt > 0.01 || selectAmt > 0.01) {
    glassColor = mix(glassColor, vec3<f32>(1.0, 0.90, 0.60), max(hoverAmt, selectAmt) * 0.40);
  }

  let glassAlpha = clamp(0.035 + fresnel * 0.14 + bevelRim * 0.38 + specGlass * 0.55 + max(hoverAmt, selectAmt) * 0.18, 0.035, 0.85);
  return vec4<f32>(glassColor, glassAlpha);
}
`;
