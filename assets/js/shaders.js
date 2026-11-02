/**
 * WebGPU WGSL Shaders for Dexter's Blood Slide Trophy Box
 * Includes studio PBR lighting, fine-pored mahogany wood grain, brushed gold latch,
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

// --- Procedural Noise Functions for Fine Rosewood/Mahogany & Blood Microstructure ---

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
    pos = pos * 2.02 + vec3<f32>(13.7, 7.1, 19.3);
    amp *= 0.5;
  }
  return val;
}

// Studio softbox environment approximation for realistic specular reflections
fn sampleStudioEnv(reflDir : vec3<f32>, roughness : f32) -> vec3<f32> {
  let y = clamp(reflDir.y, -1.0, 1.0);
  let softbox1 = smoothstep(0.35 - roughness * 0.3, 0.88, dot(reflDir, normalize(vec3<f32>(0.25, 0.92, 0.28))));
  let softbox2 = smoothstep(0.45 - roughness * 0.3, 0.92, dot(reflDir, normalize(vec3<f32>(-0.45, 0.82, -0.35))));
  let rimLight = smoothstep(0.40, 0.90, dot(reflDir, normalize(vec3<f32>(0.0, 0.45, -0.89))));
  let horizon = mix(vec3<f32>(0.48, 0.47, 0.46), vec3<f32>(0.82, 0.82, 0.84), smoothstep(-0.3, 0.5, y));
  return horizon + vec3<f32>(0.98, 0.96, 0.93) * (softbox1 * 0.72 + softbox2 * 0.45 + rimLight * 0.32);
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
  let isReflection = obj.objParams.w < -0.5;

  // For the mirrored floor reflection, view the original surface from the mirrored camera
  var camPos = scene.cameraPos.xyz;
  if (isReflection) {
    camPos.y = -camPos.y;
  }

  let col = shadeSurface(in, camPos);

  if (isReflection) {
    // The studio floor itself is never reflected
    if (i32(round(in.matId)) == 0) {
      discard;
    }
    // Glossy floor reflection: strongest where the box touches the floor, fading out with height
    let h = max(in.worldPos.y, 0.0);
    let fade = 1.0 - smoothstep(0.0, 0.62, h);
    return vec4<f32>(col.rgb, col.a * fade * fade * 0.50);
  }
  return col;
}

fn shadeSurface(in : VertexOutput, camPos : vec3<f32>) -> vec4<f32> {
  let N = normalize(in.worldNormal);
  let V = normalize(camPos - in.worldPos);
  let R = reflect(-V, N);
  let NoV = max(dot(N, V), 0.001);

  // Sample index card texture unconditionally in uniform control flow
  let cardSample = textureSample(indexCardTex, indexCardSampler, in.uv);

  // Studio 3-point lighting setup
  let L1 = normalize(vec3<f32>(0.38, 0.86, 0.48));
  let L2 = normalize(vec3<f32>(-0.58, 0.68, 0.36));
  let L3 = normalize(vec3<f32>(0.10, 0.55, -0.82));

  let matId = i32(round(in.matId));

  // ==========================================================
  // MATERIAL 0: SEAMLESS STUDIO CYCLORAMA FLOOR + SOFT SHADOW
  // ==========================================================
  if (matId == 0) {
    let boxHalf = vec2<f32>(0.95, 1.48);
    let pXZ = in.worldPos.xz;
    let dBox = abs(pXZ) - boxHalf;
    let dist = length(max(dBox, vec2<f32>(0.0))) + min(max(dBox.x, dBox.y), 0.0);

    // Multi-layered soft studio contact + ambient shadow matching the reference photos
    let tightContact = exp(-max(dist, 0.0) * 16.0) * 0.20;
    let midShadow = exp(-max(dist, 0.0) * 2.2) * 0.10 + exp(-max(dist, 0.0) * 0.75) * 0.06;
    let underBox = smoothstep(0.10, -0.05, dist) * 0.12;

    // Additional soft shadow behind the box when the lid opens backward
    let lidRearDist = length((pXZ - vec2<f32>(0.0, -2.0)) * vec2<f32>(0.9, 0.7));
    let lidOpenShadow = scene.params.x * exp(-lidRearDist * 1.2) * 0.16;

    // Fade shadow out smoothly with radial distance so floor blends 100% into the CSS studio backdrop
    let radialFade = 1.0 - smoothstep(4.5, 11.0, length(pXZ));
    let shadowAlpha = clamp((tightContact + midShadow + underBox + lidOpenShadow) * radialFade, 0.0, 0.40);

    return vec4<f32>(0.04, 0.035, 0.035, shadowAlpha);
  }

  // ==========================================================
  // MATERIAL 1: FINE MAHOGANY / ROSEWOOD BOX (Longitudinal Grain)
  // ==========================================================
  if (matId == 1) {
    // Straight, tight longitudinal rosewood/mahogany grain matching Reference Image 1
    let gPos = vec3<f32>(in.localPos.x * 28.0, in.localPos.y * 28.0, in.localPos.z * 1.35);
    let subtleWarp = fbm3D(gPos * 0.45) * 0.55;
    let streakCoord = (in.localPos.x + in.localPos.y * 0.65) * 34.0 + subtleWarp * 3.2;

    let broadBand = sin(streakCoord) * 0.5 + 0.5;
    let mediumStrands = fbm3D(vec3<f32>(in.localPos.x * 55.0, in.localPos.y * 55.0, in.localPos.z * 3.2));
    let finePores = noise3D(vec3<f32>(in.localPos.x * 165.0, in.localPos.y * 165.0, in.localPos.z * 14.0));
    let poreMask = smoothstep(0.68, 0.92, finePores);

    // Rich dark mahogany color palette matching Reference Image 1
    let deepMahogany = vec3<f32>(0.165, 0.044, 0.016);
    let richMahogany = vec3<f32>(0.285, 0.082, 0.030);
    let warmAmber    = vec3<f32>(0.375, 0.118, 0.044);
    let darkPoreCol  = vec3<f32>(0.085, 0.020, 0.007);

    var woodColor = mix(deepMahogany, richMahogany, broadBand * 0.55 + mediumStrands * 0.45);
    woodColor = mix(woodColor, warmAmber, smoothstep(0.45, 0.85, mediumStrands) * 0.45);
    woodColor = mix(woodColor, darkPoreCol, poreMask * 0.42);

    // Micro-normal perturbation from wood pores
    let nPerturb = normalize(N + vec3<f32>((finePores - 0.5) * 0.022, 0.0, (mediumStrands - 0.5) * 0.015));

    // Wrapped (half-Lambert style) diffuse for soft, gradual studio falloff across faces
    let diff1 = clamp((dot(nPerturb, L1) + 0.35) / 1.35, 0.0, 1.0);
    let diff2 = clamp((dot(nPerturb, L2) + 0.35) / 1.35, 0.0, 1.0);
    let diff3 = clamp((dot(nPerturb, L3) + 0.35) / 1.35, 0.0, 1.0);
    let diffuse = diff1 * 0.60 + diff2 * 0.34 + diff3 * 0.20 + 0.34;

    // Semi-gloss lacquer coat with broad softbox sheen + crisp bevel highlights
    let H1 = normalize(L1 + V);
    let H2 = normalize(L2 + V);
    let specBroad = pow(max(dot(nPerturb, H1), 0.0), 18.0) * 0.16;
    let specCoat  = pow(max(dot(N, H1), 0.0), 64.0) * 0.22 + pow(max(dot(N, H2), 0.0), 40.0) * 0.12;
    let fresnel   = pow(1.0 - NoV, 4.2) * 0.24;
    let envRefl   = sampleStudioEnv(reflect(-V, nPerturb), 0.20);

    // Crisp dark seam groove where lid meets base (Y = 0.42) when closed
    let seamDist = abs(in.worldPos.y - 0.42);
    let seamFactor = mix(1.0, smoothstep(0.002, 0.026, seamDist) * 0.55 + 0.45, 1.0 - scene.params.x);

    let finalWood = (woodColor * diffuse + envRefl * (fresnel + 0.04) + vec3<f32>(1.0, 0.93, 0.85) * (specBroad + specCoat)) * seamFactor;
    return vec4<f32>(finalWood, 1.0);
  }

  // ==========================================================
  // MATERIAL 2: POLISHED GOLD / BRASS LATCH & HINGES
  // ==========================================================
  if (matId == 2) {
    var goldBase = vec3<f32>(0.96, 0.77, 0.33);
    let brush = noise3D(in.localPos * vec3<f32>(180.0, 40.0, 180.0)) * 0.06;
    goldBase = goldBase - vec3<f32>(brush * 0.35);

    var screwShadow = 1.0;
    if (in.extra > 1.5) {
      let centeredUV = in.uv - vec2<f32>(0.5, 0.5);
      let crossH = smoothstep(0.06, 0.11, abs(centeredUV.y)) + smoothstep(0.32, 0.36, abs(centeredUV.x));
      let crossV = smoothstep(0.06, 0.11, abs(centeredUV.x)) + smoothstep(0.32, 0.36, abs(centeredUV.y));
      let slotMask = min(clamp(crossH, 0.0, 1.0), clamp(crossV, 0.0, 1.0));
      screwShadow = mix(0.22, 1.0, slotMask);
    }

    let env = sampleStudioEnv(R, 0.10);
    let H1 = normalize(L1 + V);
    let H2 = normalize(L2 + V);
    let spec1 = pow(max(dot(N, H1), 0.0), 110.0);
    let spec2 = pow(max(dot(N, H2), 0.0), 52.0);
    let diff = max(dot(N, L1), 0.0) * 0.52 + max(dot(N, L2), 0.0) * 0.36 + 0.38;

    let metallicColor = goldBase * (env * 0.82 + diff * 0.45) + vec3<f32>(1.0, 0.97, 0.84) * (spec1 * 0.85 + spec2 * 0.45);
    return vec4<f32>(metallicColor * screwShadow, 1.0);
  }

  // ==========================================================
  // MATERIAL 3: SLOTTED CREAM WOOD / IVORY RACK & INNER LINING
  // ==========================================================
  if (matId == 3) {
    let fineGrain = noise3D(in.localPos * vec3<f32>(32.0, 32.0, 10.0)) * 0.04;
    // If extra == 0.2, it's the bright cream floor beneath the slides
    var baseCream = vec3<f32>(0.93, 0.88, 0.80) - vec3<f32>(fineGrain);
    if (abs(in.extra - 0.2) < 0.05) {
      baseCream = vec3<f32>(0.95, 0.93, 0.89) - vec3<f32>(fineGrain * 0.5);
    }

    let cavityAO = mix(0.45, 1.0, clamp(scene.params.x * 0.85 + 0.25, 0.0, 1.0));
    let heightAO = smoothstep(0.06, 0.41, in.worldPos.y) * 0.30 + 0.70;

    let diff = max(dot(N, L1), 0.0) * 0.58 + max(dot(N, L2), 0.0) * 0.36 + max(dot(N, L3), 0.0) * 0.22 + 0.46;
    let col = baseCream * diff * cavityAO * heightAO;
    return vec4<f32>(col, 1.0);
  }

  // ==========================================================
  // MATERIAL 4: LID NUMBERED INDEX CARD (01 - 24)
  // ==========================================================
  if (matId == 4) {
    let paperGrain = (noise3D(in.localPos * 60.0) - 0.5) * 0.02;
    let paperColor = cardSample.rgb + vec3<f32>(paperGrain);
    let diff = max(dot(N, L1), 0.0) * 0.50 + max(dot(N, L2), 0.0) * 0.38 + max(dot(N, L3), 0.0) * 0.28 + 0.52;
    let lidAO = mix(0.35, 1.0, clamp(scene.params.x * 0.9 + 0.15, 0.0, 1.0));
    return vec4<f32>(paperColor * diff * lidAO, 1.0);
  }

  // ==========================================================
  // MATERIAL 5: GLASS MICROSCOPE SLIDE + DRIED BLOOD SPECIMEN
  // ==========================================================
  let hoverAmt = obj.objParams.y;
  let selectAmt = obj.objParams.z;
  let seed = obj.objParams.w;

  // Thin frosted green-tinted glass edge (extra > 0.5)
  if (in.extra > 0.5) {
    let edgeTint = vec3<f32>(0.78, 0.90, 0.86);
    let env = sampleStudioEnv(R, 0.06);
    let H1 = normalize(L1 + V);
    let spec = pow(max(dot(N, H1), 0.0), 110.0);
    var edgeColor = mix(edgeTint, env, 0.50) + vec3<f32>(spec * 0.85);
    if (hoverAmt > 0.01 || selectAmt > 0.01) {
      edgeColor = mix(edgeColor, vec3<f32>(1.0, 0.88, 0.48), max(hoverAmt, selectAmt) * 0.55);
    }
    return vec4<f32>(edgeColor, 0.62 + max(hoverAmt, selectAmt) * 0.25);
  }

  // Slide face UV in [0..1, 0..1]. Convert to physical aspect ratio coordinates centered at (0,0)
  let aspect = 1.36 / 0.46;
  let p = (in.uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(aspect, 1.0);

  // Subtle organic variation per slide (1..24)
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
  let H1 = normalize(L1 + V);
  let H2 = normalize(L2 + V);
  let specGlass = pow(max(dot(N, H1), 0.0), 150.0) * 0.70 + pow(max(dot(N, H2), 0.0), 90.0) * 0.35;
  let fresnel = clamp(pow(1.0 - NoV, 3.8), 0.0, 1.0);

  // Inside the dried blood drop specimen (normR < 1.02)
  // Only the first 13 slides carry a blood specimen; the rest are blank glass
  if (normR < 1.02 && seed < 13.5) {
    let edgeSoft = 1.0 - smoothstep(0.93, 1.02, normR);
    // Authentic dried blood coagulation rings (Reference Image 2 bottom-left):
    let outerRing = exp(-pow((normR - 0.83) / 0.12, 2.0));
    let centerCore = exp(-pow(normR / 0.28, 2.0));
    let microCell = noise3D(vec3<f32>(dp * 42.0, seed * 3.1));

    let rubyMid  = vec3<f32>(0.54, 0.026, 0.032);
    let darkClot = vec3<f32>(0.22, 0.006, 0.009);
    let deepRim  = vec3<f32>(0.34, 0.010, 0.014);

    var bloodCol = mix(rubyMid, deepRim, outerRing * 0.78);
    bloodCol = mix(bloodCol, darkClot, centerCore * 0.68);
    bloodCol *= (0.88 + microCell * 0.24);

    let lightTrans = max(dot(N, L1), 0.0) * 0.50 + 0.60;
    let finalBlood = bloodCol * lightTrans + env * 0.08 + vec3<f32>(specGlass * 0.75);
    let bloodAlpha = clamp(edgeSoft * 0.92, 0.0, 0.94);
    return vec4<f32>(finalBlood, bloodAlpha);
  }

  // Crystal-clear microscope glass outside the blood drop so all 24 blood drops remain vividly visible!
  var glassColor = mix(vec3<f32>(0.88, 0.95, 0.92), env, 0.65) + vec3<f32>(specGlass);
  if (hoverAmt > 0.01 || selectAmt > 0.01) {
    glassColor = mix(glassColor, vec3<f32>(1.0, 0.90, 0.60), max(hoverAmt, selectAmt) * 0.40);
  }

  // Very low base alpha on flat clear glass face so 24 stacked slides don't milk out the crimson column behind them
  let glassAlpha = clamp(0.035 + fresnel * 0.14 + bevelRim * 0.38 + specGlass * 0.55 + max(hoverAmt, selectAmt) * 0.18, 0.035, 0.85);
  return vec4<f32>(glassColor, glassAlpha);
}
`;
