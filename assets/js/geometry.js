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
 * 4 = Lid Index Card (numbered 01-50 ruled chart)
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
  length: 5.20,      // Z: [-2.60, 2.60] (+Z is front latch, -Z is back hinge)
  baseHeight: 0.42,  // Y: [0.00, 0.42]
  lidHeight: 0.36,   // Y: [0.42, 0.78] when closed
  wallThick: 0.17,
  rackThick: 0.13,
  hingeY: 0.42,
  hingeZ: -2.60,
  numSlides: 45,
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
   * Adds a triangle with automatic normal calculation
   */
  addFaceTri(p0, p1, p2, uv0, uv1, uv2, matId, extra = 0) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    const i0 = this.addVertex(p0[0], p0[1], p0[2], nx, ny, nz, uv0[0], uv0[1], matId, extra);
    const i1 = this.addVertex(p1[0], p1[1], p1[2], nx, ny, nz, uv1[0], uv1[1], matId, extra);
    const i2 = this.addVertex(p2[0], p2[1], p2[2], nx, ny, nz, uv2[0], uv2[1], matId, extra);
    this.addTri(i0, i1, i2);
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
    this.addFace([x1, y3, z2], [x2, y3, z2], [x2, y3, z1], [x1, y3, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y0, z1], [x2, y0, z1], [x2, y0, z2], [x1, y0, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y1, z3], [x2, y1, z3], [x2, y2, z3], [x1, y2, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y1, z0], [x1, y1, z0], [x1, y2, z0], [x2, y2, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x3, y1, z2], [x3, y1, z1], [x3, y2, z1], [x3, y2, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
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

    // 8 Corner triangles
    this.addFaceTri([x2, y2, z3], [x3, y2, z2], [x2, y3, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x3, y2, z1], [x2, y2, z0], [x2, y3, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x1, y2, z0], [x0, y2, z1], [x1, y3, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x0, y2, z2], [x1, y2, z3], [x1, y3, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);

    this.addFaceTri([x3, y1, z2], [x2, y1, z3], [x2, y0, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x2, y1, z0], [x3, y1, z1], [x2, y0, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x0, y1, z1], [x1, y1, z0], [x1, y0, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x1, y1, z3], [x0, y1, z2], [x1, y0, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);
  }

  /**
   * Builds a seamless, single-piece beveled outer box with an open top cavity (for the Base)
   */
  addSeamlessHollowBase(minX, minY, minZ, maxX, maxY, maxZ, wallThick, floorY, bevel, matId, extra = 0) {
    const b = bevel;
    const bTop = bevel * 0.50;
    const x0 = minX, x1 = minX + b, x2 = maxX - b, x3 = maxX;
    const y0 = minY, y1 = minY + b, y2 = maxY - bTop, y3 = maxY;
    const z0 = minZ, z1 = minZ + b, z2 = maxZ - b, z3 = maxZ;

    // Seamless Exterior Faces
    this.addFace([x1, y0, z1], [x2, y0, z1], [x2, y0, z2], [x1, y0, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y1, z3], [x2, y1, z3], [x2, y2, z3], [x1, y2, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y1, z0], [x1, y1, z0], [x1, y2, z0], [x2, y2, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x3, y1, z2], [x3, y1, z1], [x3, y2, z1], [x3, y2, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x0, y1, z1], [x0, y1, z2], [x0, y2, z2], [x0, y2, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 4 Top outer bevels
    this.addFace([x1, y2, z3], [x2, y2, z3], [x2, y3, z2], [x1, y3, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y2, z0], [x1, y2, z0], [x1, y3, z1], [x2, y3, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x3, y2, z2], [x3, y2, z1], [x2, y3, z1], [x2, y3, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x0, y2, z1], [x0, y2, z2], [x1, y3, z2], [x1, y3, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 4 Bottom outer bevels
    this.addFace([x1, y0, z2], [x2, y0, z2], [x2, y1, z3], [x1, y1, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y0, z1], [x1, y0, z1], [x1, y1, z0], [x2, y1, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y0, z2], [x2, y0, z1], [x3, y1, z1], [x3, y1, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y0, z1], [x1, y0, z2], [x0, y1, z2], [x0, y1, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 4 Vertical corner bevels
    this.addFace([x2, y1, z3], [x3, y1, z2], [x3, y2, z2], [x2, y2, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x3, y1, z1], [x2, y1, z0], [x2, y2, z0], [x3, y2, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y1, z0], [x0, y1, z1], [x0, y2, z1], [x1, y2, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x0, y1, z2], [x1, y1, z3], [x1, y2, z3], [x0, y2, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 8 Outer Corner Triangles
    this.addFaceTri([x2, y2, z3], [x3, y2, z2], [x2, y3, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x3, y2, z1], [x2, y2, z0], [x2, y3, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x1, y2, z0], [x0, y2, z1], [x1, y3, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x0, y2, z2], [x1, y2, z3], [x1, y3, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);

    this.addFaceTri([x3, y1, z2], [x2, y1, z3], [x2, y0, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x2, y1, z0], [x3, y1, z1], [x2, y0, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x0, y1, z1], [x1, y1, z0], [x1, y0, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x1, y1, z3], [x0, y1, z2], [x1, y0, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);

    // Top Flat Rim & Inner Hollow Cavity
    const ix0 = minX + wallThick;
    const ix1 = maxX - wallThick;
    const iz0 = minZ + wallThick;
    const iz1 = maxZ - wallThick;

    this.addFace([x1, y3, z2], [x2, y3, z2], [ix1, y3, iz1], [ix0, y3, iz1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y3, z1], [x1, y3, z1], [ix0, y3, iz0], [ix1, y3, iz0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y3, z1], [x1, y3, z2], [ix0, y3, iz1], [ix0, y3, iz0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y3, z2], [x2, y3, z1], [ix1, y3, iz0], [ix1, y3, iz1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    this.addFace([ix1, floorY, iz1], [ix0, floorY, iz1], [ix0, y3, iz1], [ix1, y3, iz1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([ix0, floorY, iz0], [ix1, floorY, iz0], [ix1, y3, iz0], [ix0, y3, iz0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([ix0, floorY, iz1], [ix0, floorY, iz0], [ix0, y3, iz0], [ix0, y3, iz1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([ix1, floorY, iz0], [ix1, floorY, iz1], [ix1, y3, iz1], [ix1, y3, iz0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
  }

  /**
   * Builds a seamless, single-piece beveled outer lid with an open bottom cavity (for the Lid)
   */
  addSeamlessHollowLid(minX, minY, minZ, maxX, maxY, maxZ, wallThick, ceilingY, bevel, matId, extra = 0) {
    const b = bevel;
    const bBot = bevel * 0.50;
    const x0 = minX, x1 = minX + b, x2 = maxX - b, x3 = maxX;
    const y0 = minY, y1 = minY + bBot, y2 = maxY - b, y3 = maxY;
    const z0 = minZ, z1 = minZ + b, z2 = maxZ - b, z3 = maxZ;

    // Seamless Exterior Faces
    this.addFace([x1, y3, z2], [x2, y3, z2], [x2, y3, z1], [x1, y3, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y1, z3], [x2, y1, z3], [x2, y2, z3], [x1, y2, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y1, z0], [x1, y1, z0], [x1, y2, z0], [x2, y2, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x3, y1, z2], [x3, y1, z1], [x3, y2, z1], [x3, y2, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x0, y1, z1], [x0, y1, z2], [x0, y2, z2], [x0, y2, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 4 Top prominent bevels
    this.addFace([x1, y2, z3], [x2, y2, z3], [x2, y3, z2], [x1, y3, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y2, z0], [x1, y2, z0], [x1, y3, z1], [x2, y3, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x3, y2, z2], [x3, y2, z1], [x2, y3, z1], [x2, y3, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x0, y2, z1], [x0, y2, z2], [x1, y3, z2], [x1, y3, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 4 Bottom outer bevels
    this.addFace([x1, y0, z2], [x2, y0, z2], [x2, y1, z3], [x1, y1, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y0, z1], [x1, y0, z1], [x1, y1, z0], [x2, y1, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x2, y0, z2], [x2, y0, z1], [x3, y1, z1], [x3, y1, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y0, z1], [x1, y0, z2], [x0, y1, z2], [x0, y1, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 4 Vertical corner bevels
    this.addFace([x2, y1, z3], [x3, y1, z2], [x3, y2, z2], [x2, y2, z3], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x3, y1, z1], [x2, y1, z0], [x2, y2, z0], [x3, y2, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x1, y1, z0], [x0, y1, z1], [x0, y2, z1], [x1, y2, z0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([x0, y1, z2], [x1, y1, z3], [x1, y2, z3], [x0, y2, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    // 8 Outer Corner Triangles
    this.addFaceTri([x2, y2, z3], [x3, y2, z2], [x2, y3, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x3, y2, z1], [x2, y2, z0], [x2, y3, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x1, y2, z0], [x0, y2, z1], [x1, y3, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x0, y2, z2], [x1, y2, z3], [x1, y3, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);

    this.addFaceTri([x3, y1, z2], [x2, y1, z3], [x2, y0, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x2, y1, z0], [x3, y1, z1], [x2, y0, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x0, y1, z1], [x1, y1, z0], [x1, y0, z1], [0, 0], [1, 0], [0.5, 1], matId, extra);
    this.addFaceTri([x1, y1, z3], [x0, y1, z2], [x1, y0, z2], [0, 0], [1, 0], [0.5, 1], matId, extra);

    // Bottom Flat Rim & Inner Hollow Cavity
    const ix0 = minX + wallThick;
    const ix1 = maxX - wallThick;
    const iz0 = minZ + wallThick;
    const iz1 = maxZ - wallThick;

    this.addFace([ix0, y0, iz1], [ix1, y0, iz1], [x2, y0, z2], [x1, y0, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([ix1, y0, iz0], [ix0, y0, iz0], [x1, y0, z1], [x2, y0, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([ix0, y0, iz0], [ix0, y0, iz1], [x1, y0, z2], [x1, y0, z1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([ix1, y0, iz1], [ix1, y0, iz0], [x2, y0, z1], [x2, y0, z2], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);

    this.addFace([ix0, y0, iz1], [ix1, y0, iz1], [ix1, ceilingY, iz1], [ix0, ceilingY, iz1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([ix1, y0, iz0], [ix0, y0, iz0], [ix0, ceilingY, iz0], [ix1, ceilingY, iz0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([ix0, y0, iz0], [ix0, y0, iz1], [ix0, ceilingY, iz1], [ix0, ceilingY, iz0], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
    this.addFace([ix1, y0, iz1], [ix1, y0, iz0], [ix1, ceilingY, iz0], [ix1, ceilingY, iz1], [0, 0], [1, 0], [1, 1], [0, 1], matId, extra);
  }

  /**
   * Adds a cylinder/disk along Z axis with beveled rim for screws and rounded brass tabs
   */
  addDiskZ(cx, cy, z0, z1, radius, segments, matId, extra = 0, halfAngleStart = 0, halfAngleEnd = Math.PI * 2) {
    const bev = Math.min(0.004, (z1 - z0) * 0.35);
    const rInner = Math.max(0.002, radius - bev);
    const zFront = z1;
    const zMid = z1 - bev;

    const startIdxFront = this.vertexCount;
    this.addVertex(cx, cy, zFront, 0, 0, 1, 0.5, 0.5, matId, extra);
    for (let i = 0; i <= segments; i++) {
      const a = halfAngleStart + (i / segments) * (halfAngleEnd - halfAngleStart);
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = cx + ca * rInner;
      const y = cy + sa * rInner;
      this.addVertex(x, y, zFront, 0, 0, 1, 0.5 + 0.5 * ca, 0.5 + 0.5 * sa, matId, extra);
      if (i > 0) {
        this.addTri(startIdxFront, startIdxFront + i, startIdxFront + i + 1);
      }
    }

    // Beveled front edge + outer cylindrical rim
    for (let i = 0; i < segments; i++) {
      const a0 = halfAngleStart + (i / segments) * (halfAngleEnd - halfAngleStart);
      const a1 = halfAngleStart + ((i + 1) / segments) * (halfAngleEnd - halfAngleStart);
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);

      const ix0 = cx + c0 * rInner, iy0 = cy + s0 * rInner;
      const ix1 = cx + c1 * rInner, iy1 = cy + s1 * rInner;
      const ox0 = cx + c0 * radius, oy0 = cy + s0 * radius;
      const ox1 = cx + c1 * radius, oy1 = cy + s1 * radius;

      this.addFace(
        [ox0, oy0, zMid], [ix0, iy0, zFront], [ix1, iy1, zFront], [ox1, oy1, zMid],
        [0.5 + 0.5 * c0, 0.5 + 0.5 * s0],
        [0.5 + 0.45 * c0, 0.5 + 0.45 * s0],
        [0.5 + 0.45 * c1, 0.5 + 0.45 * s1],
        [0.5 + 0.5 * c1, 0.5 + 0.5 * s1],
        matId, extra
      );

      this.addFace(
        [ox0, oy0, z0], [ox0, oy0, zMid], [ox1, oy1, zMid], [ox1, oy1, z0],
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
 * 0. Build Studio Floor Mesh (separate from Base so floor shadow & reflection compose cleanly)
 */
export function buildFloorMesh() {
  const mb = new MeshBuilder();
  const floorSize = 16.0;
  mb.addFace(
    [-floorSize, -0.001, floorSize],
    [floorSize, -0.001, floorSize],
    [floorSize, -0.001, -floorSize],
    [-floorSize, -0.001, -floorSize],
    [-1, -1], [1, -1], [1, 1], [-1, 1],
    MATERIAL.FLOOR, 0
  );
  return mb.toTypedArrays();
}

/**
 * 1. Build Static Base Mesh
 */
export function buildBaseMesh() {
  const mb = new MeshBuilder();
  const hw = BOX_SPECS.width / 2;     // 0.96
  const hl = BOX_SPECS.length / 2;    // 2.60
  const bh = BOX_SPECS.baseHeight;    // 0.42
  const wt = BOX_SPECS.wallThick;     // 0.17
  const bev = 0.028;

  // Seamless Outer Mahogany Base Shell
  mb.addSeamlessHollowBase(-hw, 0.0, -hl, hw, bh, hl, wt, 0.09, bev, MATERIAL.WOOD, 0.0);

  // Inner cream floor lining
  const innerX = hw - wt; // 0.79
  const innerZ = hl - wt; // 2.43
  mb.addBox(-innerX, 0.09, -innerZ, innerX, 0.115, innerZ, MATERIAL.RACK, 0.2);

  // Slotted Comb Racks along Left and Right inner walls
  const rackW = BOX_SPECS.rackThick; // 0.13
  const rackTopY = bh - 0.025;       // 0.395
  const rackBaseY = 0.115;

  mb.addBox(-innerX, rackBaseY, -innerZ, -innerX + rackW * 0.42, rackTopY, innerZ, MATERIAL.RACK, 0.0);
  mb.addBox(innerX - rackW * 0.42, rackBaseY, -innerZ, innerX, rackTopY, innerZ, MATERIAL.RACK, 0.0);

  const numSlots = BOX_SPECS.numSlides;
  const usableZ = (innerZ - 0.08) * 2;
  const stepZ = usableZ / numSlots;
  const toothThick = stepZ * 0.42;
  const startZ = -innerZ + 0.08;

  for (let i = 0; i <= numSlots; i++) {
    const zCenter = startZ + i * stepZ;
    const z0 = zCenter - toothThick / 2;
    const z1 = zCenter + toothThick / 2;
    mb.addBox(-innerX + rackW * 0.4, rackBaseY, z0, -innerX + rackW, rackTopY, z1, MATERIAL.RACK, 1.0);
    mb.addBox(innerX - rackW, rackBaseY, z0, innerX - rackW * 0.4, rackTopY, z1, MATERIAL.RACK, 1.0);
  }

  // ============================================================================
  // FRONT LOWER BRASS LATCH ASSEMBLY (+Z = hl) — Matching Reference Image
  // ============================================================================
  const latchW = 0.232;
  const latchZ0 = hl - 0.004;
  const latchZ1 = hl + 0.020;

  // 1. Main rectangular lower brass plate (extra = 0.0)
  mb.addBeveledBox(-latchW, 0.156, latchZ0, latchW, bh - 0.010, latchZ1, 0.007, MATERIAL.BRASS, 0.0);

  // 2. Rounded bottom semicircular brass tab (extra = 4.0: reaches down to y = 0.004)
  mb.addDiskZ(0, 0.156, latchZ0, latchZ1, 0.152, 28, MATERIAL.BRASS, 4.0, Math.PI, Math.PI * 2);

  // 3. Two countersunk Phillips brass screws on lower plate (extra = 2.0)
  mb.addDiskZ(-0.150, 0.282, latchZ1 - 0.002, latchZ1 + 0.010, 0.025, 20, MATERIAL.BRASS, 2.0);
  mb.addDiskZ(0.150, 0.282, latchZ1 - 0.002, latchZ1 + 0.010, 0.025, 20, MATERIAL.BRASS, 2.0);

  // 4. Lower central catch staple / keeper block & side guide rails
  mb.addBeveledBox(-0.062, 0.130, latchZ1 - 0.002, -0.036, 0.405, latchZ1 + 0.020, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(0.036, 0.130, latchZ1 - 0.002, 0.062, 0.405, latchZ1 + 0.020, 0.005, MATERIAL.BRASS, 1.0);
  // Central raised keeper post
  mb.addBeveledBox(-0.034, 0.220, latchZ1, 0.034, 0.352, latchZ1 + 0.042, 0.006, MATERIAL.BRASS, 1.0);
  // Lower horizontal bridge bar & bottom tab lip receiver
  mb.addBeveledBox(-0.062, 0.112, latchZ1 - 0.002, 0.062, 0.156, latchZ1 + 0.020, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(-0.048, 0.066, latchZ1 - 0.002, 0.048, 0.114, latchZ1 + 0.018, 0.005, MATERIAL.BRASS, 1.0);

  // Back Brass Hinges
  const hingeXs = [-0.52, 0.52];
  for (const hx of hingeXs) {
    mb.addBox(hx - 0.13, bh - 0.06, -hl - 0.012, hx + 0.13, bh + 0.01, -hl + wt, MATERIAL.BRASS, 1.0);
  }

  return mb.toTypedArrays();
}

/**
 * 2. Build Pivoting Lid Mesh in Local Hinge Space
 */
export function buildLidMesh() {
  const mb = new MeshBuilder();
  const hw = BOX_SPECS.width / 2;     // 0.96
  const L = BOX_SPECS.length;         // 5.20
  const lh = BOX_SPECS.lidHeight;     // 0.36
  const wt = BOX_SPECS.wallThick;     // 0.17
  const bev = 0.028;

  // Seamless Outer Mahogany Lid Shell
  mb.addSeamlessHollowLid(-hw, 0.0, 0.0, hw, lh, L, wt, lh - 0.09, bev, MATERIAL.WOOD, 0.0);

  // Recessed Inner Cream Border Frame around Index Card
  const innerX = hw - wt;
  const cardMargin = 0.04;
  mb.addBox(-innerX, lh - 0.11, wt, innerX, lh - 0.085, L - wt, MATERIAL.RACK, 0.3);

  // White Numbered Index Card on the underside of the lid
  const cX0 = -innerX + cardMargin;
  const cX1 = innerX - cardMargin;
  const cZ0 = wt + cardMargin;
  const cZ1 = L - wt - cardMargin;
  const cardY = lh - 0.112;

  mb.addFace(
    [cX0, cardY, cZ0],
    [cX1, cardY, cZ0],
    [cX1, cardY, cZ1],
    [cX0, cardY, cZ1],
    [0, 1], [1, 1], [1, 0], [0, 0],
    MATERIAL.INDEX_CARD, 0.0
  );

  // ============================================================================
  // UPPER BRASS LATCH PLATE ON FRONT OF LID (Z_local = L)
  // ============================================================================
  const latchW = 0.232;
  const latchZ0 = L - 0.004;
  const latchZ1 = L + 0.020;

  // 1. Upper rectangular plate body (extra = 0.0)
  mb.addBeveledBox(-latchW, 0.010, latchZ0, latchW, 0.205, latchZ1, 0.007, MATERIAL.BRASS, 0.0);

  // 2. Rounded top semicircular brass tab (extra = 3.0)
  mb.addDiskZ(0, 0.205, latchZ0, latchZ1, 0.152, 28, MATERIAL.BRASS, 3.0, 0, Math.PI);

  // 3. Two countersunk Phillips brass screws on upper plate (extra = 2.0)
  mb.addDiskZ(-0.150, 0.104, latchZ1 - 0.002, latchZ1 + 0.010, 0.025, 20, MATERIAL.BRASS, 2.0);
  mb.addDiskZ(0.150, 0.104, latchZ1 - 0.002, latchZ1 + 0.010, 0.025, 20, MATERIAL.BRASS, 2.0);

  // 4. Upper central hinge block & stepped knuckle ribs
  mb.addBeveledBox(-0.062, 0.145, latchZ1 - 0.002, 0.062, 0.206, latchZ1 + 0.020, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(-0.042, 0.065, latchZ1, 0.042, 0.165, latchZ1 + 0.034, 0.005, MATERIAL.BRASS, 1.0);

  // Back Brass Hinge leaves attached to lid
  const hingeXs = [-0.52, 0.52];
  for (const hx of hingeXs) {
    mb.addBox(hx - 0.13, -0.01, -0.012, hx + 0.13, 0.05, wt, MATERIAL.BRASS, 1.0);
  }

  return mb.toTypedArrays();
}

/**
 * 3. Build Swinging Brass Hasp Clasp Loop (pivots at front of lid to lock/unlock over the lower catch)
 */
export function buildLatchClaspMesh() {
  const mb = new MeshBuilder();
  // Upper hinge barrel & bridge
  mb.addBeveledBox(-0.062, -0.03, -0.008, 0.062, 0.045, 0.020, 0.005, MATERIAL.BRASS, 1.0);
  // Central recessed tongue on upper hasp
  mb.addBeveledBox(-0.035, -0.11, 0.002, 0.035, 0.035, 0.026, 0.005, MATERIAL.BRASS, 1.0);

  // Left and Right sculpted vertical clasp rails
  mb.addBeveledBox(-0.062, -0.255, -0.006, -0.035, -0.01, 0.020, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(0.035, -0.255, -0.006, 0.062, -0.01, 0.020, 0.005, MATERIAL.BRASS, 1.0);

  // Horizontal stepped cross-bars below the keeper slot
  mb.addBeveledBox(-0.062, -0.222, -0.006, 0.062, -0.180, 0.022, 0.005, MATERIAL.BRASS, 1.0);
  mb.addBeveledBox(-0.058, -0.272, -0.005, 0.058, -0.225, 0.024, 0.005, MATERIAL.BRASS, 1.0);

  // Curved / angled bottom finger pull-lip at the base of the clasp
  mb.addBeveledBox(-0.050, -0.320, -0.002, 0.050, -0.270, 0.028, 0.005, MATERIAL.BRASS, 1.0);
  return mb.toTypedArrays();
}

/**
 * 4. Build Single Glass Slide Mesh centered at Local (0, 0, 0)
 */
export function buildSingleSlideMesh() {
  const mb = new MeshBuilder();
  const hw = BOX_SPECS.slideWidth / 2;
  const hh = BOX_SPECS.slideHeight / 2;
  const ht = BOX_SPECS.slideThick / 2;

  mb.addFace(
    [-hw, -hh, ht], [hw, -hh, ht], [hw, hh, ht], [-hw, hh, ht],
    [0, 0], [1, 0], [1, 1], [0, 1],
    MATERIAL.GLASS_SLIDE, 0.0
  );
  mb.addFace(
    [hw, -hh, -ht], [-hw, -hh, -ht], [-hw, hh, -ht], [hw, hh, -ht],
    [1, 0], [0, 0], [0, 1], [1, 1],
    MATERIAL.GLASS_SLIDE, 0.0
  );
  mb.addFace(
    [-hw, hh, ht], [hw, hh, ht], [hw, hh, -ht], [-hw, hh, -ht],
    [0, 1], [1, 1], [1, 1], [0, 1],
    MATERIAL.GLASS_SLIDE, 1.0
  );
  mb.addFace(
    [-hw, -hh, -ht], [hw, -hh, -ht], [hw, -hh, ht], [-hw, -hh, ht],
    [0, 0], [1, 0], [1, 0], [0, 0],
    MATERIAL.GLASS_SLIDE, 1.0
  );
  mb.addFace(
    [hw, -hh, ht], [hw, -hh, -ht], [hw, hh, -ht], [hw, hh, ht],
    [1, 0], [1, 0], [1, 1], [1, 1],
    MATERIAL.GLASS_SLIDE, 1.0
  );
  mb.addFace(
    [-hw, -hh, -ht], [-hw, -hh, ht], [-hw, hh, ht], [-hw, hh, -ht],
    [0, 0], [0, 0], [0, 1], [0, 1],
    MATERIAL.GLASS_SLIDE, 1.0
  );

  return mb.toTypedArrays();
}

/**
 * Computes the Z position of each of the 45 slots in the box
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
