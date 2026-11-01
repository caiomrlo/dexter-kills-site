/**
 * WebGPU WGSL Shaders for Dexter's Blood Slide Trophy Box
 * Includes high-contrast studio PBR lighting, fine-pored mahogany wood grain,
 * beveled edge catchlights, hardware ambient occlusion, brushed gold latch,
 * real-time 3D planar floor reflection, directional studio shadows,
 * textured index card, and crystal-clear microscope glass slides with coagulated blood specimens.
 */

export const WGSL_SHADER = /* wgsl */ `
struct SceneUniforms {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  // x: lidOpenFactor (0..1), y: time, z: hoveredSlideIndex (-1 if none), w: selectedSlideIndex (-1 if none)
  params : vec4<f32>,
  // x: smoothMouseX (-1..1), y: smoothMouseY (-1..1), z: unused, w: unused
  mouseParallax : vec4<f32>,
};

struct ObjectUniforms {
  model : mat4x4<f32>,
  normalMat : mat4x4<f32>,
  // x: slideIndex (-1 for box parts, -2 for floor reflection pass), y: hoverAmount (0..1), z: selectAmount (0..1), w: seed
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
  @builtin(position) clipPos : vec4<f32>,
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
  out.clipPos = scene.viewProj * worldPos4;
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
  let softboxKey = smoothstep(0.32 - roughness * 0.3, 0.88, dot(reflDir, normalize(vec3<f32>(-0.42, 0.86, 0.30))));
  let softboxFill = smoothstep(0.45 - roughness * 0.3, 0.92, dot(reflDir, normalize(vec3<f32>(0.25, 0.85, 0.35))));
  let rimLight = smoothstep(0.42, 0.90, dot(reflDir, normalize(vec3<f32>(0.45, 0.38, -0.80))));
  let horizon = mix(vec3<f32>(0.36, 0.36, 0.38), vec3<f32>(0.80, 0.81, 0.83), smoothstep(-0.35, 0.55, y));
  return horizon + vec3<f32>(0.99, 0.96, 0.92) * (softboxKey * 0.78 + softboxFill * 0.42 + rimLight * 0.28);
}

// Converts solid object shading into a soft satin tabletop reflection when rendered in the reflection pass
fn finalizeSolidOutput(
  col : vec3<f32>,
  matId : i32,
  isReflection : bool,
  worldPos : vec3<f32>,
  localPos : vec3<f32>,
  rawV : vec3<f32>
) -> vec4<f32> {
  if (!isReflection) {
    return vec4<f32>(col, 1.0);
  }

  let h = max(0.0, -worldPos.y);
  // Subtle micro-scatter jitter so the reflection feels like a satin studio tabletop rather than a glass mirror
  let microJitter = (hash31(worldPos * 95.0) - 0.5) * 0.025 * clamp(h * 2.5, 0.0, 1.0);
  let hEff = max(0.0, h + microJitter);

  // Smooth vertical falloff into the satin gray tabletop
  let vFade = exp(-hEff * 2.85) * smoothstep(0.88, 0.0, hEff);
  let floorNoV = clamp(abs(rawV.y), 0.0, 1.0);
  let floorFresnel = mix(0.36, 0.68, pow(1.0 - floorNoV, 2.2));

  // Soften horizontal edges of the reflected brass plate so it blends like a glossy reflection
  var edgeFeather = 1.0;
  if (matId == 2) {
    edgeFeather = smoothstep(0.24, 0.12, abs(localPos.x)) * 1.35;
  } else if (matId == 1) {
    edgeFeather = smoothstep(0.98, 0.84, abs(localPos.x)) * 0.92 + 0.08;
  }

  // Darken reflection right inside the tight contact shadow crease (h -> 0)
  let contactCrease = smoothstep(0.0, 0.042, h) * 0.68 + 0.32;
  // Slightly soften color saturation with depth to mimic satin tabletop diffusion
  let luma = dot(col, vec3<f32>(0.299, 0.587, 0.114));
  let diffusedCol = mix(col, vec3<f32>(luma) * vec3<f32>(1.05, 0.95, 0.92), clamp(h * 0.65, 0.0, 0.45));

  let reflAlpha = clamp(vFade * floorFresnel * edgeFeather, 0.0, 0.52);
  return vec4<f32>(diffusedCol * contactCrease, reflAlpha);
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
  let matId = i32(round(in.matId));
  let isReflection = obj.objParams.x < -1.5;

  // Clip any reflected geometry that pokes above the floor plane Y = 0
  if (isReflection && in.worldPos.y > 0.002) {
    discard;
  }

  // Un-flip Y for shading calculations during the planar reflection pass so wood seam, AO, and normals match the real box
  let shadePos = select(in.worldPos, vec3<f32>(in.worldPos.x, -in.worldPos.y, in.worldPos.z), isReflection);
  let rawN = normalize(in.worldNormal);
  let N = select(rawN, normalize(vec3<f32>(rawN.x, -rawN.y, rawN.z)), isReflection);
  let rawV = normalize(scene.cameraPos.xyz - in.worldPos);
  let V = select(rawV, normalize(vec3<f32>(rawV.x, -rawV.y, rawV.z)), isReflection);
  let R = reflect(-V, N);
  let NoV = max(dot(N, V), 0.001);

  let reflDepth = select(0.0, max(0.0, -in.worldPos.y), isReflection);
  let reflBlur = select(1.0, exp(-reflDepth * 3.8), isReflection);

  // Sample index card texture unconditionally in uniform control flow
  let cardSample = textureSample(indexCardTex, indexCardSampler, in.uv);

  // Studio 3-point lighting setup (Key light from upper-left/front-left matching Reference Image, reactive to mouse parallax)
  let mx = scene.mouseParallax.x;
  let my = scene.mouseParallax.y;
  let L1 = normalize(vec3<f32>(-0.54 + mx * 0.12, 0.76 - my * 0.08, 0.38));
  let L2 = normalize(vec3<f32>(0.18 + mx * 0.06, 0.84, 0.50));
  let L3 = normalize(vec3<f32>(0.62, 0.42, -0.66));

  // ==========================================================
  // MATERIAL 0: STUDIO FLOOR — DIRECTIONAL SHADOWS & SATIN REFLECTION HALO
  // ==========================================================
  if (matId == 0) {
    let boxHalf = vec2<f32>(0.95, 2.58);
    let pXZ = in.worldPos.xz;
    let dBox = abs(pXZ) - boxHalf;
    let dist = length(max(dBox, vec2<f32>(0.0))) + min(max(dBox.x, dBox.y), 0.0);

    // 1. Razor-sharp dark contact occlusion right under the box perimeter
    let tightContact = exp(-max(dist, 0.0) * 17.5) * 0.74;
    let underBox = smoothstep(0.14, -0.03, dist) * 0.72;

    // 2. Directional cast shadow extending to the right (+X) and rear-right (+X, -Z) opposite the upper-left key light
    let lightShift = vec2<f32>(0.64 - mx * 0.09, -0.22 + my * 0.06);
    let pCast = pXZ - lightShift;
    let dCast = abs(pCast) - vec2<f32>(1.10, 2.66);
    let distCast = length(max(dCast, vec2<f32>(0.0))) + min(max(dCast.x, dCast.y), 0.0);
    let rightSideMask = smoothstep(-0.35, 0.85, pXZ.x);
    let castCore = exp(-max(distCast, 0.0) * 3.8) * 0.38 * rightSideMask;
    let castPenumbra = exp(-max(distCast + 0.08, 0.0) * 1.35) * 0.44 * rightSideMask;

    // 3. Soft omnidirectional ambient studio shadow around the box base
    let ambientShadow = exp(-max(dist + 0.03, 0.0) * 2.15) * 0.28;

    // 4. Additional shadow behind the box (-Z) when the lid swings open
    let lidRearDist = length((pXZ - vec2<f32>(0.25, -3.15)) * vec2<f32>(0.85, 0.68));
    let lidOpenShadow = scene.params.x * exp(-lidRearDist * 1.15) * 0.24;

    // 5. Soft diffused satin floor reflection halo (warm mahogany + golden latch bounce on the tabletop)
    let frontZone = smoothstep(1.25, -0.10, abs(pXZ.x)) * smoothstep(2.45, 2.62, pXZ.y) * exp(-max(pXZ.y - 2.58, 0.0) * 2.2);
    let sideZone = smoothstep(2.75, -0.10, abs(pXZ.y)) * smoothstep(0.85, 0.98, abs(pXZ.x)) * exp(-max(abs(pXZ.x) - 0.95, 0.0) * 2.6);
    let latchBounce = exp(-length((pXZ - vec2<f32>(0.0, 2.82)) * vec2<f32>(2.8, 2.2)) * 2.4);

    let warmWoodBounce = vec3<f32>(0.16, 0.042, 0.018);
    let goldLatchBounce = vec3<f32>(0.58, 0.42, 0.14);
    let bounceMask = clamp((frontZone + sideZone * 0.65) * smoothstep(0.0, 0.06, dist), 0.0, 1.0);
    let bounceCol = mix(warmWoodBounce, goldLatchBounce, clamp(latchBounce * 0.75, 0.0, 0.85));
    let bounceAlpha = bounceMask * 0.20 + latchBounce * smoothstep(2.50, 2.62, pXZ.y) * 0.14;

    // Fade out smoothly with radial distance so floor blends 100% into the interactive studio backdrop
    let radialFade = 1.0 - smoothstep(4.8, 12.5, length(pXZ));
    let rawShadow = tightContact + underBox + castCore + castPenumbra + ambientShadow + lidOpenShadow;
    let shadowAlpha = clamp(rawShadow * radialFade, 0.0, 0.86);

    let totalAlpha = clamp(shadowAlpha + bounceAlpha * radialFade, 0.0, 0.88);
    let shadowCol = vec3<f32>(0.025, 0.024, 0.026);
    let floorColor = mix(shadowCol, bounceCol, clamp(bounceAlpha / max(totalAlpha, 0.001), 0.0, 0.55));

    return vec4<f32>(floorColor, totalAlpha);
  }

  // ==========================================================
  // MATERIAL 1: FINE MAHOGANY / ROSEWOOD BOX (Enhanced Shading & Contrast)
  // ==========================================================
  if (matId == 1) {
    // Straight, tight longitudinal rosewood/mahogany grain matching Reference Image
    let gPos = vec3<f32>(in.localPos.x * 28.0, in.localPos.y * 28.0, in.localPos.z * 1.35);
    let subtleWarp = fbm3D(gPos * 0.45) * 0.55;
    let streakCoord = (in.localPos.x + in.localPos.y * 0.65) * 34.0 + subtleWarp * 3.2;

    let broadBand = sin(streakCoord) * 0.5 + 0.5;
    let mediumStrands = fbm3D(vec3<f32>(in.localPos.x * 55.0, in.localPos.y * 55.0, in.localPos.z * 3.2));
    let finePores = noise3D(vec3<f32>(in.localPos.x * 165.0, in.localPos.y * 165.0, in.localPos.z * 14.0));
    let poreMask = smoothstep(0.66, 0.92, finePores) * reflBlur;

    // Rich dark mahogany color palette with deep espresso shadows and warm amber-red highlights
    let deepMahogany = vec3<f32>(0.135, 0.032, 0.011);
    let richMahogany = vec3<f32>(0.275, 0.074, 0.025);
    let warmAmber    = vec3<f32>(0.395, 0.122, 0.042);
    let darkPoreCol  = vec3<f32>(0.065, 0.014, 0.005);

    var woodColor = mix(deepMahogany, richMahogany, broadBand * 0.55 + mediumStrands * 0.45);
    woodColor = mix(woodColor, warmAmber, smoothstep(0.42, 0.84, mediumStrands) * 0.48);
    woodColor = mix(woodColor, darkPoreCol, poreMask * 0.46);

    // Micro-normal perturbation from wood pores (softened in reflection pass)
    let nPerturb = normalize(N + vec3<f32>((finePores - 0.5) * 0.025 * reflBlur, 0.0, (mediumStrands - 0.5) * 0.016 * reflBlur));

    // High-contrast studio directional lighting:
    // Top lid (+Y) and front latch face (+Z) receive warm key/fill light; right side wall (+X) falls into deep studio shadow
    let diff1 = max(dot(nPerturb, L1), 0.0);
    let diff2 = max(dot(nPerturb, L2), 0.0);
    let diff3 = max(dot(nPerturb, L3), 0.0);

    // Directional face contrast (darkens the +X right side wall to match the dramatic shadow in the reference image)
    let rightWallShadow = smoothstep(0.15, 0.85, N.x);
    let frontWallShade = smoothstep(0.15, 0.85, N.z) * (1.0 - rightWallShadow);
    let faceContrast = mix(1.0, 0.46, rightWallShadow) * mix(1.0, 0.82, frontWallShade);

    // Subtle longitudinal studio light falloff across the box (brighter front-left, deeper back-right)
    let studioFalloff = clamp(1.04 - shadePos.x * 0.13 + shadePos.z * 0.055, 0.72, 1.16);

    let diffuse = (diff1 * 0.82 + diff2 * 0.38 + diff3 * 0.16 + 0.22) * faceContrast * studioFalloff;

    // Multi-scale Ambient Occlusion (AO):
    // 1. Floor contact AO at the bottom of the base (Y -> 0)
    let floorContactAO = smoothstep(0.0, 0.16, shadePos.y) * 0.36 + 0.64;

    // 2. Crisp dark seam groove where lid meets base (Y = 0.42) when closed
    let seamDist = abs(shadePos.y - 0.42);
    let seamSharp = smoothstep(0.0015, 0.016, seamDist);
    let seamSoft  = smoothstep(0.004, 0.055, seamDist);
    let seamFactor = mix(1.0, seamSharp * 0.52 + seamSoft * 0.26 + 0.22, 1.0 - scene.params.x);

    // 3. Hardware mounting AO on the wood around the front golden brass latch
    var latchAO = 1.0;
    if (shadePos.z > 2.50) {
      let dLatch = max(abs(in.localPos.x) - 0.235, abs(shadePos.y - 0.39) - 0.25);
      let latchShadow = exp(-max(dLatch, 0.0) * 28.0) * 0.42;
      latchAO = 1.0 - latchShadow;
    }

    // 4. Corner/edge vignette AO along the box perimeter
    let edgeVignette = clamp(1.0 - pow(abs(in.localPos.x) / 0.98, 4.0) * 0.14 - pow(abs(shadePos.z) / 2.62, 4.0) * 0.12, 0.78, 1.0);

    // Semi-gloss lacquer coat with broad softbox sheen + crisp chamfered bevel catchlights
    let H1 = normalize(L1 + V);
    let H2 = normalize(L2 + V);
    let isBevel = clamp((1.0 - abs(N.y)) * abs(N.y) * 3.6 + abs(N.x) * abs(N.z) * 2.5, 0.0, 1.0);
    let bevelBoost = 1.0 + isBevel * 1.15;

    let specBroad = pow(max(dot(nPerturb, H1), 0.0), 24.0) * 0.24 * faceContrast;
    let specCoat  = (pow(max(dot(N, H1), 0.0), 88.0) * 0.38 + pow(max(dot(N, H2), 0.0), 48.0) * 0.22) * bevelBoost;
    let fresnel   = pow(1.0 - NoV, 4.0) * 0.26;
    let envRefl   = sampleStudioEnv(reflect(-V, nPerturb), 0.18);

    let totalAO = floorContactAO * seamFactor * latchAO * edgeVignette;
    let finalWood = (woodColor * diffuse + envRefl * (fresnel + 0.035) * faceContrast + vec3<f32>(1.0, 0.92, 0.82) * (specBroad + specCoat)) * totalAO;

    return finalizeSolidOutput(finalWood, matId, isReflection, in.worldPos, in.localPos, rawV);
  }

  // ==========================================================
  // MATERIAL 2: POLISHED GOLD / BRASS LATCH & HINGES (Richer Relief & AO)
  // ==========================================================
  if (matId == 2) {
    var goldBase = vec3<f32>(0.97, 0.76, 0.31);
    let brush = noise3D(in.localPos * vec3<f32>(180.0, 40.0, 180.0)) * 0.06 * reflBlur;
    goldBase = goldBase - vec3<f32>(brush * 0.35);

    // Screw slot cross-recess shadow & rim bevel (blurred out in the satin floor reflection)
    var hardwareAO = 1.0;
    if (in.extra > 1.5 && !isReflection) {
      let centeredUV = in.uv - vec2<f32>(0.5, 0.5);
      let rad = length(centeredUV);
      let crossH = smoothstep(0.055, 0.11, abs(centeredUV.y)) + smoothstep(0.32, 0.36, abs(centeredUV.x));
      let crossV = smoothstep(0.055, 0.11, abs(centeredUV.x)) + smoothstep(0.32, 0.36, abs(centeredUV.y));
      let slotMask = min(clamp(crossH, 0.0, 1.0), clamp(crossV, 0.0, 1.0));
      let rimAO = smoothstep(0.50, 0.38, rad) * 0.35 + 0.65;
      hardwareAO = mix(0.16, 1.0, slotMask) * rimAO;
    } else {
      // Subtle crevice darkening around the central clasp post and plate edges
      let centerCrevice = smoothstep(0.035, 0.095, abs(in.localPos.x));
      let seamCrevice = smoothstep(0.005, 0.045, abs(shadePos.y - 0.42));
      hardwareAO = mix(0.68, 1.0, centerCrevice * 0.5 + 0.5) * mix(0.55, 1.0, seamCrevice);
    }

    let env = sampleStudioEnv(R, select(0.09, 0.32, isReflection));
    let H1 = normalize(L1 + V);
    let H2 = normalize(L2 + V);
    let specExp1 = select(115.0, 18.0, isReflection);
    let specExp2 = select(46.0, 12.0, isReflection);
    let spec1 = pow(max(dot(N, H1), 0.0), specExp1);
    let spec2 = pow(max(dot(N, H2), 0.0), specExp2);
    let diff = max(dot(N, L1), 0.0) * 0.58 + max(dot(N, L2), 0.0) * 0.38 + 0.32;

    // Warm bronze-gold shadow tone in recesses, bright specular gold on highlights
    let bronzeShadow = vec3<f32>(0.42, 0.25, 0.06);
    let baseMetallic = mix(bronzeShadow, goldBase, clamp(diff * hardwareAO, 0.0, 1.0));
    let metallicColor = baseMetallic * (env * 0.78 + diff * 0.48) + vec3<f32>(1.0, 0.96, 0.82) * (spec1 * 0.92 + spec2 * 0.48);

    return finalizeSolidOutput(metallicColor * hardwareAO, matId, isReflection, in.worldPos, in.localPos, rawV);
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
    let heightAO = smoothstep(0.06, 0.41, shadePos.y) * 0.30 + 0.70;

    let diff = max(dot(N, L1), 0.0) * 0.58 + max(dot(N, L2), 0.0) * 0.36 + max(dot(N, L3), 0.0) * 0.22 + 0.46;
    let col = baseCream * diff * cavityAO * heightAO;
    return finalizeSolidOutput(col, matId, isReflection, in.worldPos, in.localPos, rawV);
  }

  // ==========================================================
  // MATERIAL 4: LID NUMBERED INDEX CARD (01 - 50)
  // ==========================================================
  if (matId == 4) {
    let paperGrain = (noise3D(in.localPos * 60.0) - 0.5) * 0.02;
    let paperColor = cardSample.rgb + vec3<f32>(paperGrain);
    let diff = max(dot(N, L1), 0.0) * 0.50 + max(dot(N, L2), 0.0) * 0.38 + max(dot(N, L3), 0.0) * 0.28 + 0.52;
    let lidAO = mix(0.35, 1.0, clamp(scene.params.x * 0.9 + 0.15, 0.0, 1.0));
    return finalizeSolidOutput(paperColor * diff * lidAO, matId, isReflection, in.worldPos, in.localPos, rawV);
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

  // Subtle organic variation per slide (1..45)
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

    let lightTrans = max(dot(N, L1), 0.0) * 0.50 + 0.60;
    let finalBlood = bloodCol * lightTrans + env * 0.08 + vec3<f32>(specGlass * 0.75);
    let bloodAlpha = clamp(edgeSoft * 0.92, 0.0, 0.94);
    return vec4<f32>(finalBlood, bloodAlpha);
  }

  // Crystal-clear microscope glass outside the blood drop so all 45 blood drops remain vividly visible
  var glassColor = mix(vec3<f32>(0.88, 0.95, 0.92), env, 0.65) + vec3<f32>(specGlass);
  if (hoverAmt > 0.01 || selectAmt > 0.01) {
    glassColor = mix(glassColor, vec3<f32>(1.0, 0.90, 0.60), max(hoverAmt, selectAmt) * 0.40);
  }

  let glassAlpha = clamp(0.035 + fresnel * 0.14 + bevelRim * 0.38 + specGlass * 0.55 + max(hoverAmt, selectAmt) * 0.18, 0.035, 0.85);
  return vec4<f32>(glassColor, glassAlpha);
}
`;
