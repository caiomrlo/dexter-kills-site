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

    // 5. Microscope Glass Slide — Optical Flat Faces (Group 0)
    // Uses MeshStandardMaterial so grazing-angle bevels obey material.opacity strictly
    // without overriding alpha to 1.0 over the stacked slides inside the box!
    this.glassFaceBaseMat = new THREE.MeshStandardMaterial({
      color: 0xf2faf8,
      map: this.glassSurfaceMaps.map,
      normalMap: this.glassSurfaceMaps.normalMap,
      normalScale: new THREE.Vector2(0.12, 0.12),
      transparent: true,
      opacity: 0.35,
      roughness: 0.06,
      metalness: 0.08,
      envMapIntensity: 0.95,
      depthWrite: false,
      side: THREE.FrontSide
    });

    // 6. Microscope Glass Slide — Chamfered 45° Soda-Lime Ground Glass Edges (Group 1)
    this.glassEdgeBaseMat = new THREE.MeshStandardMaterial({
      color: 0xc4ece2,
      emissive: 0x16382e,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.22,
      roughness: 0.52,
      metalness: 0.02,
      envMapIntensity: 0.40,
      depthWrite: false
    });

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

      const faceMat = this.glassFaceBaseMat.clone();
      const edgeMat = this.glassEdgeBaseMat.clone();

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
      const activeAmt = Math.max(s.hoverProgress, s.selectProgress);

      slideObj.faceMat.opacity = 0.52 + isHighFloating * 0.48 + activeAmt * 0.30;
      slideObj.faceMat.envMapIntensity = 0.85 + isHighFloating * 0.45 + activeAmt * 0.35;

      const baseEdgeOpacity = 0.42 + isHighFloating * 0.14;
      if (activeAmt > 0.005) {
        slideObj.edgeMat.color.setRGB(
          0.85 + activeAmt * 0.15,
          0.95 - activeAmt * 0.07,
          0.90 - activeAmt * 0.40
        );
        slideObj.edgeMat.emissive.setRGB(
          0.12 + activeAmt * 0.45,
          0.24 + activeAmt * 0.28,
          0.20
        );
        slideObj.edgeMat.opacity = baseEdgeOpacity + activeAmt * 0.45;
      } else {
        slideObj.edgeMat.color.setRGB(
          0.86 - isHighFloating * 0.30,
          0.96 - isHighFloating * 0.12,
          0.92 - isHighFloating * 0.18
        );
        slideObj.edgeMat.emissive.setRGB(
          0.14 - isHighFloating * 0.06,
          0.26 - isHighFloating * 0.08,
          0.22 - isHighFloating * 0.06
        );
        slideObj.edgeMat.opacity = baseEdgeOpacity;
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

    // 4. Render with Integrated Post-Processing
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
