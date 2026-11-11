/**
 * 3D Geometry Builders for Dexter's Blood Slide Trophy Box (Three.js)
 * Maintains exact dimensional compatibility with main.js kinematics & raycasting while
 * upgrading all parts to smooth 3D beveled geometries, cylindrical hinge knuckles,
 * 3D slotted screws, and chamfered optical microscope slides.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Bakes every plain Mesh inside a group into one mesh per material + shadow flags,
 * so the box costs ~1 draw call per material instead of one per part.
 * InstancedMeshes are kept as they are. Picking uses OBBs in main.js, not these meshes.
 */
function mergeStaticMeshes(group) {
  group.updateMatrixWorld(true);
  const toGroupSpace = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const merged = [];

  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}`;
    if (!buckets.has(key)) buckets.set(key, { material: o.material, cast: o.castShadow, receive: o.receiveShadow, geoms: [] });
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.clearGroups();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toGroupSpace, o.matrixWorld));
    buckets.get(key).geoms.push(g);
    merged.push(o);
  });

  for (const o of merged) {
    o.removeFromParent();
    o.geometry.dispose();
  }
  // Empty helper groups (screws) are left behind; drop them
  for (const child of [...group.children]) {
    if (child.isGroup && child.children.length === 0) group.remove(child);
  }

  for (const { material, cast, receive, geoms } of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geoms, false), material);
    geoms.forEach((g) => g.dispose());
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}

export const MATERIAL = {
  FLOOR: 0,
  WOOD: 1,
  BRASS: 2,
  RACK: 3,
  INDEX_CARD: 4,
  GLASS_SLIDE: 5
};

export const BOX_SPECS = {
  width: 1.92,       // X: [-0.96, 0.96]
  length: 3.00,      // Z: [-1.50, 1.50] (+Z is front latch, -Z is back hinge)
  baseHeight: 0.42,  // Y: [0.00, 0.42]
  lidHeight: 0.36,   // Y: [0.42, 0.78] when closed
  wallThick: 0.17,
  rackThick: 0.13,
  hingeY: 0.42,
  hingeZ: -1.50,
  numSlides: 24,
  slideWidth: 1.36,
  slideHeight: 0.46,
  slideThick: 0.022
};

/**
 * Computes the Z position of each of the 24 slots in the box
 */
export function getSlideSlotZ(index) {
  const hl = BOX_SPECS.length / 2;
  const wt = BOX_SPECS.wallThick;
  const innerZ = hl - wt;
  const usableZ = (innerZ - 0.08) * 2;
  const stepZ = usableZ / BOX_SPECS.numSlides;
  const startZ = -innerZ + 0.08;
  return startZ + (BOX_SPECS.numSlides - 0.5 - index) * stepZ;
}

/** World units covered by one tile of the wood texture. */
const WOOD_TILE = 2.2;

/**
 * Box-projected UVs for wood boards. Box geometries stretch the whole texture over every
 * face, which squashes the grain on thin boards. Instead each face samples the tileable
 * texture at real scale, with the grain (texture v) running along the board's longer side
 * on that face, and an offset from the face's plane so neighbouring faces don't repeat.
 */
function applyGrainUVs(geom, center, size) {
  const pos = geom.attributes.position;
  const nrm = geom.attributes.normal;
  const uv = geom.attributes.uv;
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const n = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)];
    const ax = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    const axis = ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : ax[1] >= ax[2] ? 1 : 2;
    const [a, b] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
    const [along, across] = size[a] >= size[b] ? [a, b] : [b, a];

    p[0] = pos.getX(i) + center[0];
    p[1] = pos.getY(i) + center[1];
    p[2] = pos.getZ(i) + center[2];
    const plane = center[axis] + Math.sign(n[axis]) * size[axis] * 0.5 + axis * 1.7;

    uv.setXY(i, p[across] / WOOD_TILE + plane * 0.618, p[along] / WOOD_TILE + plane * 0.383);
  }
  uv.needsUpdate = true;
}

/**
 * Helper to create a positioned RoundedBox mesh from [minX, minY, minZ] to [maxX, maxY, maxZ]
 */
function createBoxBetween(minX, minY, minZ, maxX, maxY, maxZ, radius, segments, material, castShadow = true, receiveShadow = true) {
  const sx = maxX - minX;
  const sy = maxY - minY;
  const sz = maxZ - minZ;
  const r = Math.min(radius, sx * 0.45, sy * 0.45, sz * 0.45);
  const geom = r > 0.001
    ? new RoundedBoxGeometry(sx, sy, sz, segments, r)
    : new THREE.BoxGeometry(sx, sy, sz);

  const center = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
  if (material.userData.grainUV) applyGrainUVs(geom, center, [sx, sy, sz]);

  const mesh = new THREE.Mesh(geom, material);
  mesh.position.set(center[0], center[1], center[2]);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/**
 * Helper to create a 3D countersunk brass screw head with a recessed dark slot
 */
function createBrassScrew(x, y, z, radius, brassMat, darkSlotMat) {
  const screwGroup = new THREE.Group();
  screwGroup.position.set(x, y, z);

  // Domed/cylindrical screw head along Z
  const headGeom = new THREE.CylinderGeometry(radius, radius * 1.05, 0.014, 18);
  headGeom.rotateX(Math.PI * 0.5);
  const headMesh = new THREE.Mesh(headGeom, brassMat);
  headMesh.castShadow = true;
  screwGroup.add(headMesh);

  // Cross slot indentation
  const slotH = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.35, radius * 0.24, 0.006), darkSlotMat);
  slotH.position.z = 0.006;
  screwGroup.add(slotH);

  const slotV = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.24, radius * 1.35, 0.006), darkSlotMat);
  slotV.position.z = 0.006;
  screwGroup.add(slotV);

  return screwGroup;
}

/**
 * Helper to create a semicircular brass latch tab in XY plane extruded along Z
 */
function createSemicircleTab(cx, cy, z0, z1, radius, isTopHalf, material) {
  const shape = new THREE.Shape();
  if (isTopHalf) {
    shape.absarc(0, 0, radius, 0, Math.PI, false);
    shape.lineTo(radius, 0);
  } else {
    shape.absarc(0, 0, radius, Math.PI, Math.PI * 2, false);
    shape.lineTo(-radius, 0);
  }

  const depth = z1 - z0;
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: depth * 0.7,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.004,
    bevelThickness: depth * 0.15
  });

  const mesh = new THREE.Mesh(geom, material);
  mesh.position.set(cx, cy, z0 + depth * 0.15);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 1. Build Static Mahogany Base Group (World Origin)
 */
export function buildBaseGroup(materials) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;

  const hw = BOX_SPECS.width / 2;     // 0.96
  const hl = BOX_SPECS.length / 2;    // 1.50
  const bh = BOX_SPECS.baseHeight;    // 0.42
  const wt = BOX_SPECS.wallThick;     // 0.17
  const bev = 0.024;

  const { woodMat, brassMat, darkBrassSlotMat, rackMat, floorLiningMat } = materials;

  // Outer Mahogany Base: 4 beveled walls + bottom floor slab
  // Left wall (-X)
  group.add(createBoxBetween(-hw, 0.0, -hl, -hw + wt, bh, hl, bev, 3, woodMat));
  // Right wall (+X)
  group.add(createBoxBetween(hw - wt, 0.0, -hl, hw, bh, hl, bev, 3, woodMat));
  // Front wall (+Z)
  group.add(createBoxBetween(-hw + wt - 0.02, 0.0, hl - wt, hw - wt + 0.02, bh, hl, bev, 3, woodMat));
  // Back wall (-Z)
  group.add(createBoxBetween(-hw + wt - 0.02, 0.0, -hl, hw - wt + 0.02, bh, -hl + wt, bev, 3, woodMat));
  // Base bottom floor slab
  group.add(createBoxBetween(-hw + wt * 0.5, 0.005, -hl + wt * 0.5, hw - wt * 0.5, 0.09, hl - wt * 0.5, 0.005, 1, woodMat));

  // Inner cream floor lining under the slides
  const innerX = hw - wt; // 0.79
  const innerZ = hl - wt; // 1.33
  group.add(createBoxBetween(-innerX, 0.09, -innerZ, innerX, 0.116, innerZ, 0.0, 1, floorLiningMat, false, true));

  // Slotted Comb Racks along Left and Right inner walls
  const rackW = BOX_SPECS.rackThick; // 0.13
  const rackTopY = bh - 0.024;       // 0.396
  const rackBaseY = 0.115;

  // Continuous backing strip of the rack against the wood wall (left, right, back & front inner lining)
  group.add(createBoxBetween(-innerX, rackBaseY, -innerZ, -innerX + rackW * 0.42, rackTopY, innerZ, 0.004, 1, rackMat));
  group.add(createBoxBetween(innerX - rackW * 0.42, rackBaseY, -innerZ, innerX, rackTopY, innerZ, 0.004, 1, rackMat));
  group.add(createBoxBetween(-innerX, rackBaseY, -innerZ, innerX, rackTopY, -innerZ + 0.025, 0.002, 1, floorLiningMat, false, true));
  group.add(createBoxBetween(-innerX, rackBaseY, innerZ - 0.025, innerX, rackTopY, innerZ, 0.002, 1, floorLiningMat, false, true));

  // 25 separator teeth creating 24 slots along Z (using InstancedMesh for optimal draw-call performance!)
  const numSlots = BOX_SPECS.numSlides;
  const usableZ = (innerZ - 0.08) * 2;
  const stepZ = usableZ / numSlots;
  const toothThick = stepZ * 0.42;
  const startZ = -innerZ + 0.08;

  const toothWidth = rackW * 0.62;
  const toothHeight = rackTopY - rackBaseY;
  const toothGeom = new RoundedBoxGeometry(toothWidth, toothHeight, toothThick, 2, 0.005);
  const teethInstanced = new THREE.InstancedMesh(toothGeom, rackMat, (numSlots + 1) * 2);
  teethInstanced.castShadow = true;
  teethInstanced.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let instIdx = 0;
  for (let i = 0; i <= numSlots; i++) {
    const zCenter = startZ + i * stepZ;
    // Left tooth
    dummy.position.set(-innerX + rackW * 0.38 + toothWidth * 0.5, rackBaseY + toothHeight * 0.5, zCenter);
    dummy.updateMatrix();
    teethInstanced.setMatrixAt(instIdx++, dummy.matrix);

    // Right tooth
    dummy.position.set(innerX - rackW * 0.38 - toothWidth * 0.5, rackBaseY + toothHeight * 0.5, zCenter);
    dummy.updateMatrix();
    teethInstanced.setMatrixAt(instIdx++, dummy.matrix);
  }
  teethInstanced.instanceMatrix.needsUpdate = true;
  group.add(teethInstanced);

  // Front Lower Brass Latch Assembly (+Z = hl)
  const latchW = 0.23;
  const latchZ0 = hl - 0.005;
  const latchZ1 = hl + 0.022;
  // Main rectangular lower brass plate
  group.add(createBoxBetween(-latchW, 0.15, latchZ0, latchW, bh - 0.010, latchZ1, 0.007, 2, brassMat));
  // Rounded bottom semicircular brass tab
  group.add(createSemicircleTab(0, 0.15, latchZ0, latchZ1, 0.155, false, brassMat));

  // Two 3D brass screws on lower plate
  group.add(createBrassScrew(-0.16, 0.27, latchZ1 + 0.004, 0.028, brassMat, darkBrassSlotMat));
  group.add(createBrassScrew(0.16, 0.27, latchZ1 + 0.004, 0.028, brassMat, darkBrassSlotMat));

  // Central raised turn-catch / loop post on lower plate
  group.add(createBoxBetween(-0.045, 0.20, latchZ1, 0.045, 0.34, latchZ1 + 0.044, 0.009, 2, brassMat));
  // Lower hanging brass catch loop
  group.add(createBoxBetween(-0.068, 0.08, latchZ1 + 0.008, -0.042, 0.26, latchZ1 + 0.028, 0.006, 2, brassMat));
  group.add(createBoxBetween(0.042, 0.08, latchZ1 + 0.008, 0.068, 0.26, latchZ1 + 0.028, 0.006, 2, brassMat));
  group.add(createBoxBetween(-0.068, 0.065, latchZ1 + 0.008, 0.068, 0.095, latchZ1 + 0.028, 0.006, 2, brassMat));

  // Back Brass Hinges (2 hinges at X = -0.52 and X = +0.52 with cylindrical knuckles)
  const hingeXs = [-0.52, 0.52];
  for (const hx of hingeXs) {
    // Lower hinge leaf recessed into back wall
    group.add(createBoxBetween(hx - 0.13, bh - 0.065, -hl - 0.012, hx + 0.13, bh + 0.005, -hl + wt * 0.6, 0.004, 2, brassMat));
    // 3 Cylindrical hinge knuckles along X axis at (hx, bh, -hl - 0.012)
    const knuckleGeom = new THREE.CylinderGeometry(0.022, 0.022, 0.26, 16);
    knuckleGeom.rotateZ(Math.PI * 0.5);
    const knuckleMesh = new THREE.Mesh(knuckleGeom, brassMat);
    knuckleMesh.position.set(hx, bh, -hl - 0.012);
    knuckleMesh.castShadow = true;
    group.add(knuckleMesh);
  }

  return mergeStaticMeshes(group);
}

/**
 * 2. Build Pivoting Lid Group in Local Hinge Space:
 * Origin (0,0,0) is at World (0, BOX_SPECS.hingeY = 0.42, BOX_SPECS.hingeZ = -1.50)
 */
export function buildLidGroup(materials) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;

  const hw = BOX_SPECS.width / 2;     // 0.96
  const L = BOX_SPECS.length;         // 3.00
  const lh = BOX_SPECS.lidHeight;     // 0.36
  const wt = BOX_SPECS.wallThick;     // 0.17
  const bev = 0.024;

  const { woodMat, brassMat, darkBrassSlotMat, rackMat, indexCardMat } = materials;

  // Hollow lid frame
  // Top roof panel
  group.add(createBoxBetween(-hw, lh - 0.09, 0.0, hw, lh, L, bev, 3, woodMat));
  // Left rim (-X)
  group.add(createBoxBetween(-hw, 0.0, 0.0, -hw + wt, lh - 0.045, L, bev, 3, woodMat));
  // Right rim (+X)
  group.add(createBoxBetween(hw - wt, 0.0, 0.0, hw, lh - 0.045, L, bev, 3, woodMat));
  // Front rim (+Z = L)
  group.add(createBoxBetween(-hw + wt - 0.02, 0.0, L - wt, hw - wt + 0.02, lh - 0.045, L, bev, 3, woodMat));
  // Back rim (Z = 0)
  group.add(createBoxBetween(-hw + wt - 0.02, 0.0, 0.0, hw - wt + 0.02, lh - 0.045, wt, bev, 3, woodMat));

  // Recessed Inner Cream Border Frame around Index Card
  const innerX = hw - wt;
  const cardMargin = 0.04;
  group.add(createBoxBetween(-innerX, lh - 0.11, wt, innerX, lh - 0.085, L - wt, 0.004, 1, rackMat));

  // White Numbered Index Card on the underside of the lid (faces -Y in local lid space)
  const cX0 = -innerX + cardMargin;
  const cX1 = innerX - cardMargin;
  const cZ0 = wt + cardMargin;
  const cZ1 = L - wt - cardMargin;
  const cardY = lh - 0.113;

  const cardWidth = cX1 - cX0;
  const cardLen = cZ1 - cZ0;
  const cardGeom = new THREE.PlaneGeometry(cardWidth, cardLen);
  // Rotate PlaneGeometry (+Z normal) by +90 deg around X so normal points -Y,
  // and top of texture (V=1, row 01) sits at Z=cZ0 (hinge side, which becomes top when opened!)
  // Wait: when lid opens by -105 deg around X, Z_local = L (front) swings UP to the top!
  // Let's verify exact UV orientation from original buildLidMesh:
  // Original vertices: [cX0, cardY, cZ0] -> UV(0, 1), [cX1, cardY, cZ0] -> UV(1, 1), [cX1, cardY, cZ1] -> UV(1, 0), [cX0, cardY, cZ1] -> UV(0, 0)
  // Note: In WebGPU/Three.js CanvasTexture, flipY = true by default so V=1 is the top of the canvas (01) and V=0 is bottom (24).
  // When lid opens (-105 deg around X), cZ1 (L - wt) is at the TOP of the open lid, and cZ0 (wt) is at the bottom near the hinge!
  // Let's build the exact quad geometry so 01 is at the top of the open lid (cZ1) and 24 is at the bottom (cZ0)!
  const customCardGeom = new THREE.BufferGeometry();
  const cardPos = new Float32Array([
    cX0, cardY, cZ0,
    cX1, cardY, cZ0,
    cX1, cardY, cZ1,
    cX0, cardY, cZ1
  ]);
  const cardNorm = new Float32Array([
    0, -1, 0,
    0, -1, 0,
    0, -1, 0,
    0, -1, 0
  ]);
  // With CanvasTexture (flipY = true), v=1 is top of canvas (01) and v=0 is bottom of canvas (24).
  // At cZ1 (top of open lid), we want v=1; at cZ0 (bottom of open lid near hinge), we want v=0.
  const cardUV = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1
  ]);
  customCardGeom.setAttribute('position', new THREE.BufferAttribute(cardPos, 3));
  customCardGeom.setAttribute('normal', new THREE.BufferAttribute(cardNorm, 3));
  customCardGeom.setAttribute('uv', new THREE.BufferAttribute(cardUV, 2));
  customCardGeom.setIndex([0, 1, 2, 0, 2, 3]);

  const cardMesh = new THREE.Mesh(customCardGeom, indexCardMat);
  cardMesh.receiveShadow = true;
  group.add(cardMesh);

  // Upper Brass Latch Plate on front of Lid (Z_local = L)
  const latchW = 0.23;
  const latchZ0 = L - 0.005;
  const latchZ1 = L + 0.022;
  group.add(createBoxBetween(-latchW, 0.010, latchZ0, latchW, 0.21, latchZ1, 0.007, 2, brassMat));
  // Rounded top semicircular brass tab
  group.add(createSemicircleTab(0, 0.21, latchZ0, latchZ1, 0.155, true, brassMat));

  // Two 3D brass screws on upper plate
  group.add(createBrassScrew(-0.16, 0.10, latchZ1 + 0.004, 0.028, brassMat, darkBrassSlotMat));
  group.add(createBrassScrew(0.16, 0.10, latchZ1 + 0.004, 0.028, brassMat, darkBrassSlotMat));

  // Upper central clasp bracket
  group.add(createBoxBetween(-0.052, 0.02, latchZ1, 0.052, 0.18, latchZ1 + 0.036, 0.008, 2, brassMat));

  // Back Brass Hinge leaves attached to lid
  const hingeXs = [-0.52, 0.52];
  for (const hx of hingeXs) {
    group.add(createBoxBetween(hx - 0.13, -0.005, -0.012, hx + 0.13, 0.055, wt * 0.6, 0.004, 2, brassMat));
  }

  return mergeStaticMeshes(group);
}

/**
 * 3. Build Swinging Brass Hasp Clasp Loop Group
 */
export function buildClaspGroup(materials) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;

  const { brassMat } = materials;
  group.add(createBoxBetween(-0.078, -0.22, -0.01, -0.046, 0.02, 0.022, 0.006, 2, brassMat));
  group.add(createBoxBetween(0.046, -0.22, -0.01, 0.078, 0.02, 0.022, 0.006, 2, brassMat));
  group.add(createBoxBetween(-0.078, -0.24, -0.01, 0.078, -0.19, 0.022, 0.006, 2, brassMat));
  group.add(createBoxBetween(-0.035, -0.14, 0.005, 0.035, 0.03, 0.032, 0.006, 2, brassMat));

  return mergeStaticMeshes(group);
}

/**
 * 4. Build Precision Chamfered 3D Microscope Slide Geometry
 * Material Group 0: Front & Back Optical Glass Faces (crystal clear with coverslip & specular)
 * Material Group 1: Chamfered 45° Ground-Glass Bevels & Side Edges (emerald soda-lime glass tint)
 */
export function createChamferedSlideGeometry() {
  const hw = BOX_SPECS.slideWidth / 2;   // 0.68
  const hh = BOX_SPECS.slideHeight / 2;  // 0.23
  const ht = BOX_SPECS.slideThick / 2;   // 0.011

  const positions = [];
  const normals = [];
  const uvs = [];
  const faceIndices = [];
  const edgeIndices = [];
  let vCount = 0;

  function addFaceWithNormal(p0, p1, p2, p3, nx, ny, nz, uv0, uv1, uv2, uv3, targetIndices) {
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    const base = vCount;
    const pts = [p0, p1, p2, p3];
    const tcs = [uv0, uv1, uv2, uv3];
    for (let i = 0; i < 4; i++) {
      positions.push(pts[i][0], pts[i][1], pts[i][2]);
      normals.push(nx, ny, nz);
      uvs.push(tcs[i][0], tcs[i][1]);
      vCount++;
    }
    targetIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // --- GROUP 0: Front (+Z) and Back (-Z) Polished Optical Faces ---
  addFaceWithNormal(
    [-hw, -hh, ht], [hw, -hh, ht], [hw, hh, ht], [-hw, hh, ht],
    0, 0, 1,
    [0, 0], [1, 0], [1, 1], [0, 1],
    faceIndices
  );
  addFaceWithNormal(
    [hw, -hh, -ht], [-hw, -hh, -ht], [-hw, hh, -ht], [hw, hh, -ht],
    0, 0, -1,
    [1, 0], [0, 0], [0, 1], [1, 1],
    faceIndices
  );

  // --- GROUP 1: 4 Ground-Glass Outer Rims (+Y, -Y, +X, -X) ---
  // Top glass edge (+Y)
  addFaceWithNormal(
    [-hw, hh, ht], [hw, hh, ht], [hw, hh, -ht], [-hw, hh, -ht],
    0, 1, 0,
    [0, 1], [1, 1], [1, 0], [0, 0],
    edgeIndices
  );
  // Bottom glass edge (-Y) — upward-biased normal so it never reflects black floor across rear slides
  addFaceWithNormal(
    [-hw, -hh, -ht], [hw, -hh, -ht], [hw, -hh, ht], [-hw, -hh, ht],
    0, 0.35, 0.94,
    [0, 0], [1, 0], [1, 1], [0, 1],
    edgeIndices
  );
  // Right glass edge (+X)
  addFaceWithNormal(
    [hw, -hh, ht], [hw, -hh, -ht], [hw, hh, -ht], [hw, hh, ht],
    1, 0.25, 0,
    [0, 0], [1, 0], [1, 1], [0, 1],
    edgeIndices
  );
  // Left glass edge (-X)
  addFaceWithNormal(
    [-hw, -hh, -ht], [-hw, -hh, ht], [-hw, hh, ht], [-hw, hh, -ht],
    -1, 0.25, 0,
    [0, 0], [1, 0], [1, 1], [0, 1],
    edgeIndices
  );

  const allIndices = [...faceIndices, ...edgeIndices];
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(allIndices);

  geom.addGroup(0, faceIndices.length, 0);
  geom.addGroup(faceIndices.length, edgeIndices.length, 1);

  return geom;
}
