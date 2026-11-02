/**
 * Procedural 3D Geometry Generator for Dexter's Blood Slide Box
 * Vertex Layout (10 floats = 40 bytes):
 * [posX, posY, posZ, normX, normY, normZ, u, v, materialId, extraParam]
 *
 * Material IDs:
 * 0 = Studio Floor (shadow receiver)
 * 1 = Mahogany Wood (outer box & lid frames)
 * 2 = Polished Gold / Brass (latch plates, screws, clasp loop, hinges)
 * 3 = Slotted Cream Wood / Ivory Rack & Inner Lining
 * 4 = Lid Index Card (numbered 01-24 ruled chart)
 * 5 = Microscope Glass Slide (with central blood drop specimen)
 */

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
  slideThick: 0.020
};

class MeshBuilder {
  constructor() {
    this.vertices = [];
    this.indices = [];
    this.vertexCount = 0;
  }

  addVertex(px, py, pz, nx, ny, nz, u, v, matId, extra = 0) {
    this.vertices.push(px, py, pz, nx, ny, nz, u, v, matId, extra);
    return this.vertexCount++;
  }

  addQuad(v0, v1, v2, v3) {
    this.indices.push(v0, v1, v2, v0, v2, v3);
  }

  addTri(v0, v1, v2) {
    this.indices.push(v0, v1, v2);
  }

  /**
   * Adds a face with automatic normal calculation
   */
  addFace(p0, p1, p2, p3, uv0, uv1, uv2, uv3, matId, extra = 0) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    const i0 = this.addVertex(p0[0], p0[1], p0[2], nx, ny, nz, uv0[0], uv0[1], matId, extra);
    const i1 = this.addVertex(p1[0], p1[1], p1[2], nx, ny, nz, uv1[0], uv1[1], matId, extra);
    const i2 = this.addVertex(p2[0], p2[1], p2[2], nx, ny, nz, uv2[0], uv2[1], matId, extra);
    const i3 = this.addVertex(p3[0], p3[1], p3[2], nx, ny, nz, uv3[0], uv3[1], matId, extra);
    this.addQuad(i0, i1, i2, i3);
  }

  /**
   * Adds an axis-aligned box from [minX, minY, minZ] to [maxX, maxY, maxZ]
   */
  addBox(minX, minY, minZ, maxX, maxY, maxZ, matId, extra = 0) {
    // Front (+Z)
    this.addFace(
      [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
      [0, 0], [1, 0], [1, 1], [0, 1], matId, extra
    );
    // Back (-Z)
    this.addFace(
      [maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ],
      [0, 0], [1, 0], [1, 1], [0, 1], matId, extra
    );
    // Right (+X)
    this.addFace(
      [maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ],
      [0, 0], [1, 0], [1, 1], [0, 1], matId, extra
    );
    // Left (-X)
    this.addFace(
      [minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ],
      [0, 0], [1, 0], [1, 1], [0, 1], matId, extra
    );
    // Top (+Y)
    this.addFace(
      [minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ],
      [0, 0], [1, 0], [1, 1], [0, 1], matId, extra
    );
    // Bottom (-Y)
    this.addFace(
      [minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ],
      [0, 0], [1, 0], [1, 1], [0, 1], matId, extra
    );
  }

  /**
   * Adds a beveled solid block (chamfered top/bottom/side edges for realistic specular catchlights)
   */
  addBeveledBox(minX, minY, minZ, maxX, maxY, maxZ, bevel, matId, extra = 0) {
    const b = bevel;
    const x0 = minX, x1 = minX + b, x2 = maxX - b, x3 = maxX;
    const y0 = minY, y1 = minY + b, y2 = maxY - b, y3 = maxY;
    const z0 = minZ, z1 = minZ + b, z2 = maxZ - b, z3 = maxZ;

    // Main 6 faces (inset by bevel)
    // Top
    this.addFace([x1, y3, z2], [x2, y3, z2], [x2, y3, z1], [x1, y3, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    // Bottom
    this.addFace([x1, y0, z1], [x2, y0, z1], [x2, y0, z2], [x1, y0, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    // Front (+Z)
    this.addFace([x1, y1, z3], [x2, y1, z3], [x2, y2, z3], [x1, y2, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    // Back (-Z)
    this.addFace([x2, y1, z0], [x1, y1, z0], [x1, y2, z0], [x2, y2, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    // Right (+X)
    this.addFace([x3, y1, z2], [x3, y1, z1], [x3, y2, z1], [x3, y2, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    // Left (-X)
    this.addFace([x0, y1, z1], [x0, y1, z2], [x0, y2, z2], [x0, y2, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 4 Top bevels
    this.addFace([x1, y2, z3], [x2, y2, z3], [x2, y3, z2], [x1, y3, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y2, z0], [x1, y2, z0], [x1, y3, z1], [x2, y3, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x3, y2, z2], [x3, y2, z1], [x2, y3, z1], [x2, y3, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x0, y2, z1], [x0, y2, z2], [x1, y3, z2], [x1, y3, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 4 Bottom bevels
    this.addFace([x1, y0, z2], [x2, y0, z2], [x2, y1, z3], [x1, y1, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y0, z1], [x1, y0, z1], [x1, y1, z0], [x2, y1, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y0, z2], [x2, y0, z1], [x3, y1, z1], [x3, y1, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y0, z1], [x1, y0, z2], [x0, y1, z2], [x0, y1, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 4 Vertical side bevels
    this.addFace([x2, y1, z3], [x3, y1, z2], [x3, y2, z2], [x2, y2, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x3, y1, z1], [x2, y1, z0], [x2, y2, z0], [x3, y2, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y1, z0], [x0, y1, z1], [x0, y2, z1], [x1, y2, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x0, y1, z2], [x1, y1, z3], [x1, y2, z3], [x0, y2, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 8 Corner triangles (top 4, bottom 4)
    const addCornerTri = (p0, p1, p2) => {
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i0 = this.addVertex(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0, matId, extra);
      const i1 = this.addVertex(p1[0], p1[1], p1[2], nx, ny, nz, 1, 0, matId, extra);
      const i2 = this.addVertex(p2[0], p2[1], p2[2], nx, ny, nz, 0.5, 1, matId, extra);
      this.addTri(i0, i1, i2);
    };

    // Top corners
    addCornerTri([x2, y2, z3], [x3, y2, z2], [x2, y3, z2]);
    addCornerTri([x3, y2, z1], [x2, y2, z0], [x2, y3, z1]);
    addCornerTri([x1, y2, z0], [x0, y2, z1], [x1, y3, z1]);
    addCornerTri([x0, y2, z2], [x1, y2, z3], [x1, y3, z2]);

    // Bottom corners
    addCornerTri([x3, y1, z2], [x2, y1, z3], [x2, y0, z2]);
    addCornerTri([x2, y1, z0], [x3, y1, z1], [x2, y0, z1]);
    addCornerTri([x0, y1, z1], [x1, y1, z0], [x1, y0, z1]);
    addCornerTri([x1, y1, z3], [x0, y1, z2], [x1, y0, z2]);
  }

  /**
   * Adds a cylinder along Z or Y axis for screws, hinge barrels, and rounded brass tabs
   */
  addDiskZ(cx, cy, z0, z1, radius, segments, matId, extra = 0, halfAngleStart = 0, halfAngleEnd = Math.PI * 2) {
    const startIdxFront = this.vertexCount;
    this.addVertex(cx, cy, z1, 0, 0, 1, 0.5, 0.5, matId, extra);
    for (let i = 0; i <= segments; i++) {
      const a = halfAngleStart + (i / segments) * (halfAngleEnd - halfAngleStart);
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      this.addVertex(x, y, z1, 0, 0, 1, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), matId, extra);
      if (i > 0) {
        this.addTri(startIdxFront, startIdxFront + i, startIdxFront + i + 1);
      }
    }

    // Rim
    for (let i = 0; i < segments; i++) {
      const a0 = halfAngleStart + (i / segments) * (halfAngleEnd - halfAngleStart);
      const a1 = halfAngleStart + ((i + 1) / segments) * (halfAngleEnd - halfAngleStart);
      const x0 = cx + Math.cos(a0) * radius, y0 = cy + Math.sin(a0) * radius;
      const x1 = cx + Math.cos(a1) * radius, y1 = cy + Math.sin(a1) * radius;
      this.addFace(
        [x0, y0, z0], [x0, y0, z1], [x1, y1, z1], [x1, y1, z0],
        [0, 0], [1, 0], [1, 1], [0, 1], matId, extra
      );
    }
  }

  toTypedArrays() {
    return {
      vertices: new Float32Array(this.vertices),
      indices: new Uint32Array(this.indices),
      indexCount: this.indices.length
    };
  }
}

/**
 * 1. Build Static Base Mesh:
 * - Studio shadow plane
 * - Hollow mahogany base with beveled exterior walls
 * - Slotted cream-wood racks along left & right inner walls (24 slots)
 * - Lower front brass latch plate with rounded bottom tab, screws & catch post
 * - Rear brass hinge lower barrels
 */
export function buildBaseMesh() {
  const mb = new MeshBuilder();
  const hw = BOX_SPECS.width / 2;     // 0.96
  const hl = BOX_SPECS.length / 2;    // 1.50
  const bh = BOX_SPECS.baseHeight;    // 0.42
  const wt = BOX_SPECS.wallThick;     // 0.17
  const bev = 0.026;

  // Studio floor plane (for subtle soft contact shadow)
  const floorSize = 14.0;
  mb.addFace(
    [-floorSize, -0.002, floorSize],
    [floorSize, -0.002, floorSize],
    [floorSize, -0.002, -floorSize],
    [-floorSize, -0.002, -floorSize],
    [-1, -1], [1, -1], [1, 1], [-1, 1],
    MATERIAL.FLOOR, 0
  );

  // Outer Mahogany Base: 4 walls + floor so interior is authentically hollow
  // Left wall (-X)
  mb.addBeveledBox(-hw, 0.0, -hl, -hw + wt, bh, hl, bev, MATERIAL.WOOD, 0.0);
  // Right wall (+X)
  mb.addBeveledBox(hw - wt, 0.0, -hl, hw, bh, hl, bev, MATERIAL.WOOD, 0.0);
  // Front wall (+Z)
  mb.addBeveledBox(-hw + wt - 0.02, 0.0, hl - wt, hw - wt + 0.02, bh, hl, bev, MATERIAL.WOOD, 0.0);
  // Back wall (-Z)
  mb.addBeveledBox(-hw + wt - 0.02, 0.0, -hl, hw - wt + 0.02, bh, -hl + wt, bev, MATERIAL.WOOD, 0.0);
  // Base bottom floor slab
  mb.addBox(-hw + wt * 0.5, 0.01, -hl + wt * 0.5, hw - wt * 0.5, 0.09, hl - wt * 0.5, MATERIAL.WOOD, 0.0);

  // Inner cream floor lining (under the slides so red blood drops pop like in reference photo 2)
  const innerX = hw - wt; // 0.79
  const innerZ = hl - wt; // 1.33
  mb.addBox(-innerX, 0.09, -innerZ, innerX, 0.115, innerZ, MATERIAL.RACK, 0.2);

  // Slotted Comb Racks along Left and Right inner walls
  const rackW = BOX_SPECS.rackThick; // 0.13
  const rackTopY = bh - 0.025;       // 0.395
  const rackBaseY = 0.115;

  // Continuous backing strip of the rack against the wood wall
  mb.addBox(-innerX, rackBaseY, -innerZ, -innerX + rackW * 0.42, rackTopY, innerZ, MATERIAL.RACK, 0.0);
  mb.addBox(innerX - rackW * 0.42, rackBaseY, -innerZ, innerX, rackTopY, innerZ, MATERIAL.RACK, 0.0);

  // 25 separator teeth creating 24 slots along Z
  const numSlots = BOX_SPECS.numSlides;
  const usableZ = (innerZ - 0.08) * 2;
  const stepZ = usableZ / numSlots;
  const toothThick = stepZ * 0.42;
  const startZ = -innerZ + 0.08;

  for (let i = 0; i <= numSlots; i++) {
    const zCenter = startZ + i * stepZ;
    const z0 = zCenter - toothThick / 2;
    const z1 = zCenter + toothThick / 2;
    // Left tooth
    mb.addBox(-innerX + rackW * 0.4, rackBaseY, z0, -innerX + rackW, rackTopY, z1, MATERIAL.RACK, 1.0);
    // Right tooth
    mb.addBox(innerX - rackW, rackBaseY, z0, innerX - rackW * 0.4, rackTopY, z1, MATERIAL.RACK, 1.0);
  }

  // Front Lower Brass Latch Assembly (+Z = hl)
  const latchW = 0.23;
  const latchZ0 = hl - 0.005;
  const latchZ1 = hl + 0.022;
  // Main rectangular lower brass plate
  mb.addBeveledBox(-latchW, 0.15, latchZ0, latchW, bh - 0.012, latchZ1, 0.006, MATERIAL.BRASS, 0.0);
  // Rounded bottom semicircular brass tab (matching Image 1 bottom-left)
  mb.addDiskZ(0, 0.15, latchZ0, latchZ1, 0.155, 18, MATERIAL.BRASS, 0.0, Math.PI, Math.PI * 2);

  // Two brass screws on lower plate (left & right)
  mb.addDiskZ(-0.16, 0.27, latchZ1, latchZ1 + 0.012, 0.028, 12, MATERIAL.BRASS, 2.0);
  mb.addDiskZ(0.16, 0.27, latchZ1, latchZ1 + 0.012, 0.028, 12, MATERIAL.BRASS, 2.0);

  // Central raised turn-catch / loop post on lower plate
  mb.addBeveledBox(-0.045, 0.20, latchZ1, 0.045, 0.34, latchZ1 + 0.042, 0.008, MATERIAL.BRASS, 1.0);
  // Lower hanging brass catch loop (visible in Image 1 & 2)
  mb.addBeveledBox(-0.068, 0.08, latchZ1 + 0.008, -0.042, 0.26, latchZ1 + 0.028, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(0.042, 0.08, latchZ1 + 0.008, 0.068, 0.26, latchZ1 + 0.028, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(-0.068, 0.065, latchZ1 + 0.008, 0.068, 0.095, latchZ1 + 0.028, 0.005, MATERIAL.BRASS, 1.0);

  // Back Brass Hinges (2 hinges at X = -0.52 and X = +0.52)
  const hingeXs = [-0.52, 0.52];
  for (const hx of hingeXs) {
    mb.addBox(hx - 0.13, bh - 0.06, -hl - 0.012, hx + 0.13, bh + 0.01, -hl + wt, MATERIAL.BRASS, 1.0);
  }

  return mb.toTypedArrays();
}

/**
 * 2. Build Pivoting Lid Mesh in Local Hinge Space:
 * Origin (0, 0, 0) in Lid Local Space is at the Hinge Axis: World (0, BOX_SPECS.hingeY, BOX_SPECS.hingeZ)
 * So when lidAngle = 0:
 * - Z_local runs from 0.0 (back edge) to +3.00 (front edge)
 * - Y_local runs from 0.0 (bottom rim of lid) to +0.36 (top surface of lid)
 */
export function buildLidMesh() {
  const mb = new MeshBuilder();
  const hw = BOX_SPECS.width / 2;     // 0.96
  const L = BOX_SPECS.length;         // 3.00
  const lh = BOX_SPECS.lidHeight;     // 0.36
  const wt = BOX_SPECS.wallThick;     // 0.17
  const bev = 0.026;

  // Hollow lid frame so the recessed numbered index card sits inside when opened!
  // Top roof panel
  mb.addBeveledBox(-hw, lh - 0.09, 0.0, hw, lh, L, bev, MATERIAL.WOOD, 0.0);
  // Left rim (-X)
  mb.addBeveledBox(-hw, 0.0, 0.0, -hw + wt, lh - 0.05, L, bev, MATERIAL.WOOD, 0.0);
  // Right rim (+X)
  mb.addBeveledBox(hw - wt, 0.0, 0.0, hw, lh - 0.05, L, bev, MATERIAL.WOOD, 0.0);
  // Front rim (+Z = L)
  mb.addBeveledBox(-hw + wt - 0.02, 0.0, L - wt, hw - wt + 0.02, lh - 0.05, L, bev, MATERIAL.WOOD, 0.0);
  // Back rim (Z = 0)
  mb.addBeveledBox(-hw + wt - 0.02, 0.0, 0.0, hw - wt + 0.02, lh - 0.05, wt, bev, MATERIAL.WOOD, 0.0);

  // Recessed Inner Cream Border Frame around Index Card
  const innerX = hw - wt;
  const cardMargin = 0.04;
  mb.addBox(-innerX, lh - 0.11, wt, innerX, lh - 0.085, L - wt, MATERIAL.RACK, 0.3);

  // White Numbered Index Card on the underside of the lid (faces -Y when closed, faces forward/viewer when open!)
  const cX0 = -innerX + cardMargin;
  const cX1 = innerX - cardMargin;
  const cZ0 = wt + cardMargin;
  const cZ1 = L - wt - cardMargin;
  const cardY = lh - 0.112;

  // Bottom face of the card (normal pointing -Y in local lid space, which rotates to face +Z/+Y when lid opens!)
  mb.addFace(
    [cX0, cardY, cZ0],
    [cX1, cardY, cZ0],
    [cX1, cardY, cZ1],
    [cX0, cardY, cZ1],
    [0, 1], [1, 1], [1, 0], [0, 0],
    MATERIAL.INDEX_CARD, 0.0
  );

  // Upper Brass Latch Plate on front of Lid (Z_local = L)
  const latchW = 0.23;
  const latchZ0 = L - 0.005;
  const latchZ1 = L + 0.022;
  // Upper plate body
  mb.addBeveledBox(-latchW, 0.012, latchZ0, latchW, 0.21, latchZ1, 0.006, MATERIAL.BRASS, 0.0);
  // Rounded top semicircular brass tab (matching Image 1 bottom-left)
  mb.addDiskZ(0, 0.21, latchZ0, latchZ1, 0.155, 18, MATERIAL.BRASS, 0.0, 0, Math.PI);

  // Two brass screws on upper plate
  mb.addDiskZ(-0.16, 0.10, latchZ1, latchZ1 + 0.012, 0.028, 12, MATERIAL.BRASS, 2.0);
  mb.addDiskZ(0.16, 0.10, latchZ1, latchZ1 + 0.012, 0.028, 12, MATERIAL.BRASS, 2.0);

  // Upper central clasp bracket
  mb.addBeveledBox(-0.052, 0.02, latchZ1, 0.052, 0.18, latchZ1 + 0.036, 0.007, MATERIAL.BRASS, 1.0);

  // Back Brass Hinge leaves attached to lid
  const hingeXs = [-0.52, 0.52];
  for (const hx of hingeXs) {
    mb.addBox(hx - 0.13, -0.01, -0.012, hx + 0.13, 0.05, wt, MATERIAL.BRASS, 1.0);
  }

  return mb.toTypedArrays();
}

/**
 * 3. Build Swinging Brass Hasp Clasp Loop (pivots at front of lid to lock/unlock over the lower catch)
 * Local origin (0,0,0) at Lid Local (0, 0.08, L + 0.025)
 */
export function buildLatchClaspMesh() {
  const mb = new MeshBuilder();
  // Arched brass clasp bar that hooks downward over the lower catch when locked
  mb.addBeveledBox(-0.078, -0.22, -0.01, -0.046, 0.02, 0.022, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(0.046, -0.22, -0.01, 0.078, 0.02, 0.022, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(-0.078, -0.24, -0.01, 0.078, -0.19, 0.022, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(-0.035, -0.14, 0.005, 0.035, 0.03, 0.032, 0.005, MATERIAL.BRASS, 1.0);
  return mb.toTypedArrays();
}

/**
 * 4. Build Single Glass Slide Mesh centered at Local (0, 0, 0)
 * X in [-slideWidth/2, slideWidth/2]
 * Y in [-slideHeight/2, slideHeight/2]
 * Z in [-slideThick/2, slideThick/2]
 * UV mapped [0..1, 0..1] so the shader renders the glass plate, beveled green glass edge, and volumetric blood drop!
 */
export function buildSingleSlideMesh() {
  const mb = new MeshBuilder();
  const hw = BOX_SPECS.slideWidth / 2;
  const hh = BOX_SPECS.slideHeight / 2;
  const ht = BOX_SPECS.slideThick / 2;

  // Front face (+Z) with UVs [0..1, 0..1]
  mb.addFace(
    [-hw, -hh, ht], [hw, -hh, ht], [hw, hh, ht], [-hw, hh, ht],
    [0, 0], [1, 0], [1, 1], [0, 1],
    MATERIAL.GLASS_SLIDE, 0.0
  );
  // Back face (-Z) with UVs [0..1, 0..1]
  mb.addFace(
    [hw, -hh, -ht], [-hw, -hh, -ht], [-hw, hh, -ht], [hw, hh, -ht],
    [1, 0], [0, 0], [0, 1], [1, 1],
    MATERIAL.GLASS_SLIDE, 0.0
  );
  // Top glass edge (+Y) - extra = 1.0 indicates frosted green glass edge
  mb.addFace(
    [-hw, hh, ht], [hw, hh, ht], [hw, hh, -ht], [-hw, hh, -ht],
    [0, 1], [1, 1], [1, 1], [0, 1],
    MATERIAL.GLASS_SLIDE, 1.0
  );
  // Bottom glass edge (-Y)
  mb.addFace(
    [-hw, -hh, -ht], [hw, -hh, -ht], [hw, -hh, ht], [-hw, -hh, ht],
    [0, 0], [1, 0], [1, 0], [0, 0],
    MATERIAL.GLASS_SLIDE, 1.0
  );
  // Right glass edge (+X)
  mb.addFace(
    [hw, -hh, ht], [hw, -hh, -ht], [hw, hh, -ht], [hw, hh, ht],
    [1, 0], [1, 0], [1, 1], [1, 1],
    MATERIAL.GLASS_SLIDE, 1.0
  );
  // Left glass edge (-X)
  mb.addFace(
    [-hw, -hh, -ht], [-hw, -hh, ht], [-hw, hh, ht], [-hw, hh, -ht],
    [0, 0], [0, 0], [0, 1], [0, 1],
    MATERIAL.GLASS_SLIDE, 1.0
  );

  return mb.toTypedArrays();
}

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
  // Index 0 is at the front (+Z) like the close-up photo, index 23 is at the back (-Z)
  return startZ + (BOX_SPECS.numSlides - 0.5 - index) * stepZ;
}
