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
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
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

// Objects on this layer skip the (blurred) main pass and are drawn sharp on top
const FOCUS_LAYER = 1;

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
    this.camLightRig = null;
    this.floatKeyLight = null;
    this.floatRimLight = null;
  }

  async init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });

    this.renderer.setClearColor(0x000000, 1.0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.device = this.renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50.0);

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
    this.woodMat = new THREE.MeshPhysicalMaterial({
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
    });

    // 2. Brushed Antique Brass Hardware
    this.brassMat = new THREE.MeshPhysicalMaterial({
      map: brassMaps.map,
      normalMap: brassMaps.normalMap,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughnessMap: brassMaps.roughnessMap,
      roughness: 0.20,
      metalness: 0.92,
      clearcoat: 0.32,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.50
    });

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

          vec3 gCol = gSpec * 0.85;
          gCol += gRimCol * gRim * (0.95 + gSpecLum * 2.5 + gFres) * (0.6 + 0.4 * uPresence);
          gCol += gRimCol * gRimGlow * 0.06;
          gCol += vec3(0.62, 0.68, 0.68) * 0.028 * (0.4 + 0.6 * uPresence) * (1.0 - 0.8 * uFocus); // faint glass body haze
          gCol += vec3(0.85, 0.92, 0.95) * gStreak * (0.06 + gSpecLum * 0.6) * (0.5 + 0.5 * uPresence);
          gCol += vec3(0.88, 0.94, 1.0) * gScratch * (0.05 + gSpecLum * 2.2 + gFres * 0.4) * (1.0 - 0.45 * uFocus);
          gCol += vec3(0.55, 0.02, 0.03) * gBloodHalo * (0.07 + 0.12 * uFocus);
          gCol += vec3(1.0, 0.1, 0.12) * gRimGlow * gRedSide * 0.35 * uFocus; // red light bleeding in at one end
          gCol += vec3(1.0, 0.86, 0.52) * uActive * (0.05 + gRim * 0.9 + gRimGlow * 0.12);

          // Alpha = how much the glass dims what is behind it (mostly clear)
          float gA = 0.03 + 0.05 * uPresence + gFres * 0.30 + gRim * 0.40 + gSpecLum * 0.25 + gScratch * 0.04;
          gCol *= 1.0 - 0.35 * uFocus * (1.0 - gRim);
          gl_FragColor = vec4(gCol, clamp(gA, 0.0, 0.92));
          `
        );
    };
    return mat;
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

      const glassMesh = new THREE.Mesh(sharedSlideGeom, [faceMat, edgeMat]);
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
        edgeMat,
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
      textureWidth: 512,
      textureHeight: 512,
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
          vec3 reflColor = reflSample.rgb * 0.40 * radialFade;
          
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
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
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

    // 6. Soft Camera-Following Light Rig for the 7 Free-Floating Blood Slides in Sections 1-3
    this.camLightRig = new THREE.Group();
    this.floatKeyLight = new THREE.PointLight(0xfff0dd, 4.2, 22.0, 1.2);
    this.floatKeyLight.position.set(3.5, 2.8, -1.8);
    this.camLightRig.add(this.floatKeyLight);

    this.floatRimLight = new THREE.PointLight(0xd8e8ff, 3.5, 22.0, 1.2);
    this.floatRimLight.position.set(-3.8, -1.8, -2.5);
    this.camLightRig.add(this.floatRimLight);

    this.scene.add(this.camLightRig);

    // 7. Kill reveal lights: follow the slide in focus (blood-red rim from behind + cool key)
    this.focusRimLight = new THREE.PointLight(0xff1a24, 0.0, 6.0, 1.6);
    this.focusKeyLight = new THREE.PointLight(0xf4f1ff, 0.0, 6.0, 1.6);
    this.scene.add(this.focusRimLight, this.focusKeyLight);

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
      samples: 4
    });

    this.composer = new EffectComposer(this.renderer, renderTarget);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Depth of field for the kill reveal: blur the scene, then draw the focused slide sharp on top.
    // Two separable gaussian passes at different spreads give a soft, ghost-free blur.
    this.blurPasses = [
      new ShaderPass(HorizontalBlurShader),
      new ShaderPass(VerticalBlurShader),
      new ShaderPass(HorizontalBlurShader),
      new ShaderPass(VerticalBlurShader)
    ];
    this.blurPasses.forEach((p) => {
      p.enabled = false;
      this.composer.addPass(p);
    });

    this.focusCamera = new THREE.PerspectiveCamera();
    this.focusPass = new FocusLayerPass(this.scene, this.focusCamera);
    this.focusPass.enabled = false;
    this.composer.addPass(this.focusPass);

    // Subtle HDR Specular Bloom
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.06, // subtle optical halation strength
      0.28, // radius
      1.45  // strict HDR threshold so wood/paper never bloom
    );
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  resize() {
    if (!this.renderer) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const clientW = Math.max(1, this.canvas.clientWidth);
    const clientH = Math.max(1, this.canvas.clientHeight);
    const width = Math.max(1, Math.floor(clientW * dpr));
    const height = Math.max(1, Math.floor(clientH * dpr));

    if (this.canvas.width === width && this.canvas.height === height) {
      return;
    }

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(clientW, clientH, false);

    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(clientW, clientH);
    }
  }

  render(sceneState) {
    if (!this.renderer) return;

    const boxVisible = sceneState.boxVisible !== false;
    this.boxRoot.visible = boxVisible;

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

    // Move the floating-slide light rig with the camera, fading it out smoothly as we approach the Trophy Box
    if (this.camLightRig) {
      this.camLightRig.position.copy(this.camera.position);
      this.camLightRig.quaternion.setFromRotationMatrix(this.camera.matrixWorld);
      const floatLightFade = Math.max(0.0, Math.min(1.0, (camY - 9.0) / 6.0));
      this.floatKeyLight.intensity = 3.8 * floatLightFade;
      this.floatRimLight.intensity = 3.2 * floatLightFade;
    }

    // 2. Update Box Matrices (Base, Lid, Swinging Clasp + Floor Reflections)
    if (boxVisible) {
      this.baseGroup.matrix.fromArray(sceneState.baseMatrix);
      this.baseGroup.updateMatrixWorld(true);

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

    // 3. Update & Sort all 24 Glass Slides back-to-front relative to Camera
    const slideOrder = [];
    const focusIdx = sceneState.focusSlide ?? -1;
    const focusAmt = sceneState.focusAmount || 0;

    if (this.focusRimLight) {
      const fs = focusIdx >= 0 ? sceneState.slides[focusIdx] : null;
      if (fs && focusAmt > 0.001) {
        const [fx, fy, fz] = fs.worldPos;
        // Rim sits behind the slide (away from camera) and down-left; key comes from upper-right
        const bx = fx - camX, by = fy - camY, bz = fz - camZ;
        const len = Math.hypot(bx, by, bz) || 1;
        this.focusRimLight.position.set(fx + (bx / len) * 0.9 - 0.7, fy + (by / len) * 0.9 - 0.4, fz + (bz / len) * 0.9);
        this.focusKeyLight.position.set(fx + 0.9, fy + 1.1, fz - (bz / len) * -0.6);
        this.focusRimLight.intensity = 3.5 * focusAmt;
        this.focusKeyLight.intensity = 1.6 * focusAmt;
      } else {
        this.focusRimLight.intensity = 0;
        this.focusKeyLight.intensity = 0;
      }
    }

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
      const isFocus = i === focusIdx ? focusAmt : 0.0;
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
      slideObj.edgeMat.opacity = 0.55 + isHighFloating * 0.25 + activeAmt * 0.20;
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
      const distSq = dx * dx + dy * dy + dz * dz;
      slideOrder.push({ slideObj, distSq, isElevated: isHighFloating > 0.02 || activeAmt > 0.02 });
    }

    // Farthest slide gets lowest renderOrder; closest slide gets highest renderOrder.
    slideOrder.sort((a, b) => b.distSq - a.distSq);
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

    // 4. Depth of field: focused slide on its own sharp layer, everything else blurred
    const focusObj = focusIdx >= 0 ? this.slideObjects[focusIdx] : null;
    const detach = !!(focusObj && sceneState.focusDetached);
    if (focusObj && focusObj.onFocusLayer !== detach) {
      focusObj.group.traverse((o) => o.layers.set(detach ? FOCUS_LAYER : 0));
      focusObj.onFocusLayer = detach;
    }
    if (this._lastFocusObj && this._lastFocusObj !== focusObj && this._lastFocusObj.onFocusLayer) {
      this._lastFocusObj.group.traverse((o) => o.layers.set(0));
      this._lastFocusObj.onFocusLayer = false;
    }
    this._lastFocusObj = focusObj;

    if (this.blurPasses) {
      const blur = Math.max(0, Math.min(1, sceneState.backgroundBlur || 0));
      const blurOn = blur > 0.01;
      // Spread in pixels scales with the drawing-buffer height so it looks the same at any DPR
      const px = blur * 2.6 * (this.canvas.height / 900);
      const w = Math.max(1, this.canvas.width);
      const h = Math.max(1, this.canvas.height);
      const [h1, v1, h2, v2] = this.blurPasses;
      h1.uniforms.h.value = px / w;
      v1.uniforms.v.value = px / h;
      h2.uniforms.h.value = (px * 2.0) / w;
      v2.uniforms.v.value = (px * 2.0) / h;
      this.blurPasses.forEach((p) => (p.enabled = blurOn));

      this.focusPass.enabled = detach;
      if (detach) {
        this.focusCamera.copy(this.camera, false);
        this.focusCamera.layers.set(FOCUS_LAYER);
      }
    }

    // 5. Render with Integrated Post-Processing
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
