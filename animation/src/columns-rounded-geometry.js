/**
 * tekoanimation — analytic rounded-box geometry for the Material Columns.
 *
 * The model renders 27 REAL long cuboids (see columns-model.js).  This module
 * replaces the sharp `THREE.BoxGeometry(w, h, d)` for a column with an
 * *analytic sphere-swept box* (a box with every one of its 12 edges and 8
 * corners rounded by the same radius) while keeping the OUTER BOUNDING BOX
 * exactly `width × height × depth`, centred on x/z and spanning
 * `y ∈ [-height/2, +height/2]`.  The model places each mesh centre at
 * `(x, heightPx / 2, z)`, so the bottom face therefore stays flat at `y = 0`
 * and the frozen layout bounds (1850 × 500 × 600, SPEC-columns §4) do not move.
 *
 * Construction (Minkowski sum of an inner box and a sphere of radius r):
 *
 *   inner box half extents:  ix = width/2 - r, iy = height/2 - r, iz = depth/2 - r
 *
 *   6 flat faces        quads centred on ±x/±y/±z at ±half, extent = inner box
 *   12 edge bevels      quarter-cylinder strips around the 12 inner-box edges,
 *                       `bevelSegments` segments per 90° arc
 *   8 corner rounds     1/8 sphere octants around the 8 inner-box corners,
 *                       `bevelSegments` × `bevelSegments` spherical grid plus a
 *                       triangle fan at the flat-face tangent point
 *
 * Every surface vertex therefore lies exactly `r` away from the inner box
 * (this is also the QA invariant), the analytic unit normal is
 * `normalize(vertex - closestPointOnInnerBox)` — computed directly, never via
 * `computeVertexNormals()` — and the outer extremes come from the six flat
 * faces at exactly `±width/2`, `±height/2`, `±depth/2`.
 *
 * Determinism: fixed iteration order (faces +x,-x,+y,-y,+z,-z, then the 12
 * edges in cyclic-axis order, then the 8 corners in (sx, sy, sz) order), no
 * randomness, no per-run ids.  Two calls with the same arguments build
 * byte-identical buffers.
 *
 * ---------------------------------------------------------------------------
 * bevelSegments (smoothness / budget)
 * ---------------------------------------------------------------------------
 * `bevelSegments` is the number of quad segments per 90° bevel arc, so the
 * analytic normal advances `90 / bevelSegments` degrees per segment.  The
 * default is 6 (15°), because with per-vertex analytic normals and per-pixel
 * (Phong) interpolation the *shading* error of a 15° normal step is only about
 * 1 - cos(7.5°) / ... ≈ 0.02° — far below the ~0.5° perceptual threshold — and
 * the silhouette deviation of a 3-10 px bevel is r·(1 - cos 7.5°) ≈ 0.09 px,
 * i.e. sub-pixel even at the page's 100-500 screen px column size.  Cost per
 * column with S = bevelSegments:
 *
 *   triangles = 16·S² + 16·S + 12         (S = 6 → 684, S = 8 → 1164)
 *   vertices  = 24 + 24·(S + 1) + 8·(1 + S·(S + 1))   (S = 6 → 536)
 *
 * 27 columns at the default S = 6 is ≈ 18.5k triangles total (the previous
 * sharp-box model was 324), still a trivially small static scene.
 *
 * ---------------------------------------------------------------------------
 * UV contract (identical to buildColumnGeometry in columns-model.js)
 * ---------------------------------------------------------------------------
 * The caller passes the BAKED `tilePx` (the model's
 * `effectiveTilePx = manifestTilePx × UV_DENSITY_SCALE`, SPEC rev 4), and this
 * module bakes one texture tile = `tilePx` world px of surface directly into
 * the geometry.  No runtime UV scaling happens anywhere.  Per-vertex mapping,
 * chosen from the vertex's DOMINANT |normal| axis component:
 *
 *   +X: u = -z / tilePx, v =  y / tilePx     -X: u =  z / tilePx, v = y / tilePx
 *   +Y: u =  x / tilePx, v = -z / tilePx     -Y: u =  x / tilePx, v = z / tilePx
 *   +Z: u =  x / tilePx, v =  y / tilePx     -Z: u = -x / tilePx, v = y / tilePx
 *
 * These are exactly the six formulas of the existing per-face planar mapping
 * (right-handed: cross(dU, dV) points along the outward normal, so tangent
 * space normal maps stay correct).  On the six flat faces the mapping is
 * identical to the sharp box.  A bevel/corner vertex uses the formula of
 * whichever world axis its normal points at most strongly, so the mapping is
 * exact on both flat faces and continues unchanged into the bevel from either
 * side.  The only UV discontinuities are the 45° lines where the dominant axis
 * switches (the mid-line of every bevel strip, plus the three 45° arcs of each
 * spherical corner) — the same class of offset the sharp box already has at
 * every box corner.  Both sides of such a line still show the correct 1:1 world
 * density and stay continuous with their neighbouring flat face; on the box's
 * noise/grain maps the seam is a sub-1-tile jump across a 3-10 px strip, and it
 * is the agreed trade-off for keeping the grain density uniform on a bevel
 * (a blended "smeared" unwrap would compress the whole texture into the strip).
 * Axis ties are resolved with a 1e-9 tolerance, so two patches meeting at a 45°
 * point always choose the same formula (no torn UVs at patch seams).
 *
 * The geometry contains `position`, `normal` and `uv` attributes plus an
 * index; the model's `buildColumnGeometry` still duplicates `uv` into `uv2`
 * for the aoMap channel and adds its per-column userData.
 *
 * `geometry.userData` is a plain (non-frozen) object
 * `{ roundedBox: true, cornerRadius, bevelSegments, tilePx }` so the caller can
 * keep adding `columnId` / face metadata additively.
 *
 * ---------------------------------------------------------------------------
 * Radius mapping the model applies per column footprint (supplied by the
 * caller — this module only takes the resulting `radius` value)
 * ---------------------------------------------------------------------------
 *   footprint large  (140 px)  → radius 10 px
 *   footprint medium ( 80 px)  → radius  5 px
 *   footprint small  ( 40 px)  → radius  3 px
 * Height class (600/550/500 px) does not change the radius.
 *
 * `radius` is clamped defensively to `[0, min(width, height, depth) / 2]`;
 * `radius = 0` degrades to the plain 24-vertex / 12-triangle sharp box.  (At
 * the exact clamp limit the Minkowski decomposition collapses — the page's
 * 3/5/10 px radii are ≤ 0.15 × that limit — but the clamp still keeps every
 * output finite, unit-normal and bbox-exact.)
 *
 * @example
 *   import { createRoundedColumnGeometry } from './columns-rounded-geometry.js';
 *   const geometry = createRoundedColumnGeometry({
 *     width: spec.width, height: spec.heightPx, depth: spec.depth,
 *     radius: RADIUS_BY_FOOTPRINT[spec.footprint],   // 140→10, 80→5, 40→3
 *     tilePx: effectiveTilePx,                       // tilePx × UV_DENSITY_SCALE
 *   });
 *   geometry.userData = Object.assign(geometry.userData, { columnId: spec.id });
 */

import * as THREE from 'three';

/**
 * Default number of quad segments per 90° bevel arc (15° analytic normal step).
 * @type {number}
 */
export const DEFAULT_BEVEL_SEGMENTS = 6;

/** Hard cap on `bevelSegments` (defensive; the page uses 6). */
const MAX_BEVEL_SEGMENTS = 24;

/** Quarter turn in radians — every bevel arc is exactly this wide. */
const HALF_PI = Math.PI / 2;

/**
 * Triangles whose doubled area is below this (world px²) are dropped instead of
 * being emitted as degenerate faces (only reachable through the defensive
 * radius clamp; production radii never produce one).
 */
const DEGENERATE_AREA = 1e-12;

/* ------------------------------------------------------------------------- */
/* Argument validation                                                       */
/* ------------------------------------------------------------------------- */

function fail(message) {
  throw new Error('columns-rounded-geometry: ' + message);
}

function describeValue(value) {
  if (typeof value === 'string') return '"' + value + '"';
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

/** Read a required finite positive dimension (width / height / depth / tilePx). */
function readPositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    fail('"' + name + '" must be a finite positive number (got ' + describeValue(value) + ')');
  }
  return number;
}

/** Read `bevelSegments`, defaulting to 6 and clamping the integer range. */
function readBevelSegments(value) {
  if (value === undefined || value === null) return DEFAULT_BEVEL_SEGMENTS;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) {
    fail('"bevelSegments" must be a finite number >= 1 (got ' + describeValue(value) + ')');
  }
  return Math.min(MAX_BEVEL_SEGMENTS, Math.max(1, Math.round(number)));
}

/* ------------------------------------------------------------------------- */
/* Geometry builder                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Create the rounded-box BufferGeometry for one column.
 *
 * The geometry is centred on x/z, spans `y ∈ [-height/2, +height/2]` (so the
 * mesh centre at `heightPx / 2` keeps the bottom flat at `y = 0`), and its
 * bounding box is exactly `width × height × depth`.
 *
 * @param {object} options
 * @param {number} options.width   outer X extent in world px (> 0)
 * @param {number} options.height  outer Y extent in world px (> 0)
 * @param {number} options.depth   outer Z extent in world px (> 0)
 * @param {number} [options.radius=0] bevel radius in world px; clamped to
 *        `[0, min(width, height, depth) / 2]`.  0 = sharp box.
 * @param {number} [options.bevelSegments=6] quad segments per 90° bevel arc.
 * @param {number} options.tilePx  world px covered by one texture tile (the
 *        model's baked `effectiveTilePx`); UVs are baked from this value.
 * @returns {THREE.BufferGeometry} indexed geometry with position / normal / uv,
 *        `userData = { roundedBox, cornerRadius, bevelSegments, tilePx }`.
 */
export function createRoundedColumnGeometry(options = {}) {
  if (options === null || typeof options !== 'object') {
    fail('expected an options object, got ' + describeValue(options));
  }
  const width = readPositive(options.width, 'width');
  const height = readPositive(options.height, 'height');
  const depth = readPositive(options.depth, 'depth');
  const tilePx = readPositive(options.tilePx, 'tilePx');
  const bevelSegments = readBevelSegments(options.bevelSegments);

  const requestedRadius = options.radius === undefined || options.radius === null
    ? 0 : Number(options.radius);
  if (!Number.isFinite(requestedRadius)) {
    fail('"radius" must be a finite number (got ' + describeValue(options.radius) + ')');
  }
  const maxRadius = Math.min(width, height, depth) / 2;
  const cornerRadius = Math.min(Math.max(requestedRadius, 0), maxRadius);

  const halfW = width / 2;
  const halfH = height / 2;
  const halfD = depth / 2;
  const half = [halfW, halfH, halfD];
  // Inner-box half extents: the flat faces keep these extents, the bevels wrap
  // around the inner box with radius `cornerRadius`.
  const inner = [halfW - cornerRadius, halfH - cornerRadius, halfD - cornerRadius];
  const invTile = 1 / tilePx;

  /** Flat [x,y,z, x,y,z, ...] scratch buffers (converted to float32 at the end). */
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  /**
   * Tolerance for the dominant-axis decision.  On a 45° bevel line the two axis
   * components of the normal are mathematically equal and only differ by float
   * rounding — and neighbours that meet at such a point can be computed from
   * different trigonometric expressions (cos θ on the spherical corner vs sin φ
   * on the adjoining cylinder), i.e. they can differ by one float64 ULP.  A raw
   * `>=` comparison would then pick different axes for two vertices at the SAME
   * position, which would tear the UVs apart at that seam.  Treat components
   * that agree to 1e-9 as a tie and resolve ties in the fixed axis priority
   * +X/−X → +Y/−Y → +Z/−Z, so the choice is consistent everywhere.
   */
  const AXIS_TIE_EPSILON = 1e-9;

  /**
   * Append one vertex and bake its UV from its position + dominant normal axis.
   * @returns {number} the new vertex index
   */
  function pushVertex(px, py, pz, nx, ny, nz) {
    const index = positions.length / 3;
    positions.push(px, py, pz);
    normals.push(nx, ny, nz);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let u;
    let v;
    if (ax + AXIS_TIE_EPSILON >= ay && ax + AXIS_TIE_EPSILON >= az) {
      // ±X dominant.  +X: u = -z / tile, v = y / tile;  -X: u = z / tile, v = y / tile.
      if (nx >= 0) {
        u = -pz * invTile;
      } else {
        u = pz * invTile;
      }
      v = py * invTile;
    } else if (ay + AXIS_TIE_EPSILON >= az) {
      // ±Y dominant.  +Y: u = x / tile, v = -z / tile;  -Y: u = x / tile, v = z / tile.
      u = px * invTile;
      if (ny >= 0) {
        v = -pz * invTile;
      } else {
        v = pz * invTile;
      }
    } else {
      // ±Z dominant.  +Z: u = x / tile, v = y / tile;  -Z: u = -x / tile, v = y / tile.
      if (nz >= 0) {
        u = px * invTile;
      } else {
        u = -px * invTile;
      }
      v = py * invTile;
    }
    uvs.push(u, v);
    return index;
  }

  /**
   * Append one triangle with outward (counter-clockwise when seen from outside)
   * winding and drop zero-area triangles.  Winding is decided from the analytic
   * normals, so mirrored corner octants (odd number of negative axes) do not
   * need hand-ordered index tables.
   */
  function pushTriangle(i0, i1, i2) {
    const p0 = i0 * 3;
    const p1 = i1 * 3;
    const p2 = i2 * 3;
    const e1x = positions[p1] - positions[p0];
    const e1y = positions[p1 + 1] - positions[p0 + 1];
    const e1z = positions[p1 + 2] - positions[p0 + 2];
    const e2x = positions[p2] - positions[p0];
    const e2y = positions[p2 + 1] - positions[p0 + 1];
    const e2z = positions[p2 + 2] - positions[p0 + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    if (!(Math.sqrt(cx * cx + cy * cy + cz * cz) > DEGENERATE_AREA)) return;
    // Reference direction = sum of the three analytic vertex normals.
    const rx = normals[p0] + normals[p1] + normals[p2];
    const ry = normals[p0 + 1] + normals[p1 + 1] + normals[p2 + 1];
    const rz = normals[p0 + 2] + normals[p1 + 2] + normals[p2 + 2];
    if (cx * rx + cy * ry + cz * rz < 0) {
      const swap = i1;
      i1 = i2;
      i2 = swap;
    }
    indices.push(i0, i1, i2);
  }

  /* ----------------------------------------------------------------------- */
  /* 1. The six flat faces                                                   */
  /* ----------------------------------------------------------------------- */
  // Face plane positions use the exact outer half extents; the in-plane extents
  // are the inner-box half extents, so the face quads share their border exactly
  // with the bevel strips.  Tangents are chosen so that t1 × t2 = outward normal
  // (CCW winding when viewed from outside).
  for (let axis = 0; axis < 3; axis += 1) {
    for (const sign of [1, -1]) {
      const b = sign > 0 ? (axis + 1) % 3 : (axis + 2) % 3;
      const c = sign > 0 ? (axis + 2) % 3 : (axis + 1) % 3;
      const extentB = inner[b];
      const extentC = inner[c];
      // Defensive clamp corner: a face can collapse to zero width when the
      // radius reaches min(width, height, depth) / 2.
      if (!(extentB > 0) || !(extentC > 0)) continue;
      const normal = [0, 0, 0];
      normal[axis] = sign;
      const faceIndices = [];
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [signB, signC] of corners) {
        const p = [0, 0, 0];
        p[axis] = sign * half[axis];
        p[b] = signB * extentB;
        p[c] = signC * extentC;
        faceIndices.push(pushVertex(p[0], p[1], p[2], normal[0], normal[1], normal[2]));
      }
      pushTriangle(faceIndices[0], faceIndices[1], faceIndices[2]);
      pushTriangle(faceIndices[0], faceIndices[2], faceIndices[3]);
    }
  }

  const hasBevel = cornerRadius > 0;
  if (hasBevel) {
    // Shared arc table: `cosTable[k] = cos(k·90°/S)`, `sinTable[k] = sin(k·90°/S)`.
    // The two end entries are snapped to exact 0/1 so that bevel border vertices
    // carry EXACTLY the adjacent flat-face normal (and therefore the same
    // dominant-axis UV as the flat face).
    const cosTable = new Float64Array(bevelSegments + 1);
    const sinTable = new Float64Array(bevelSegments + 1);
    for (let k = 0; k <= bevelSegments; k += 1) {
      const angle = (k * HALF_PI) / bevelSegments;
      cosTable[k] = Math.cos(angle);
      sinTable[k] = Math.sin(angle);
    }
    cosTable[0] = 1;
    sinTable[0] = 0;
    cosTable[bevelSegments] = 0;
    sinTable[bevelSegments] = 1;

    /* --------------------------------------------------------------------- */
    /* 2. The twelve edge bevels (quarter-cylinder strips)                   */
    /* --------------------------------------------------------------------- */
    // For each extrusion axis the other two axes are taken in cyclic order
    // (b, c) so that the arc normal n(φ) = s_b·cosφ·e_b + s_c·sinφ·e_c runs from
    // the +b flat face (φ = 0) to the +c flat face (φ = 90°).  The strip is a
    // straight extrusion along `axis` from -inner[axis] to +inner[axis], so one
    // quad per arc segment is exact (the surface is ruled along that axis).
    for (let axis = 0; axis < 3; axis += 1) {
      const b = (axis + 1) % 3;
      const c = (axis + 2) % 3;
      for (const signB of [1, -1]) {
        for (const signC of [1, -1]) {
          const centre = [0, 0, 0];
          centre[b] = signB * inner[b];
          centre[c] = signC * inner[c];
          const ends = [-inner[axis], inner[axis]];
          const rows = [];
          for (const end of ends) {
            const row = new Array(bevelSegments + 1);
            for (let k = 0; k <= bevelSegments; k += 1) {
              const normal = [0, 0, 0];
              normal[b] = signB * cosTable[k];
              normal[c] = signC * sinTable[k];
              const p = [0, 0, 0];
              p[axis] = end;
              p[b] = centre[b] + cornerRadius * normal[b];
              p[c] = centre[c] + cornerRadius * normal[c];
              row[k] = pushVertex(p[0], p[1], p[2], normal[0], normal[1], normal[2]);
            }
            rows.push(row);
          }
          for (let k = 0; k < bevelSegments; k += 1) {
            pushTriangle(rows[0][k], rows[0][k + 1], rows[1][k + 1]);
            pushTriangle(rows[0][k], rows[1][k + 1], rows[1][k]);
          }
        }
      }
    }

    /* --------------------------------------------------------------------- */
    /* 3. The eight corner rounds (1/8 sphere octants)                       */
    /* --------------------------------------------------------------------- */
    // Spherical parameterisation of the (+,+,+) octant:
    //   n(θ, φ) = (cosθ, sinθ·cosφ, sinθ·sinφ),  θ, φ ∈ [0, 90°]
    // mirrored onto the requested sign triple.  Its three border arcs are
    //   φ = 0     → n = (cosθ, sinθ, 0)        (shared with the Z-edge strip)
    //   φ = 90°   → n = (cosθ, 0, sinθ)        (shared with the Y-edge strip)
    //   θ = 90°   → n = (0, cosφ, sinφ)        (shared with the X-edge strip)
    // and θ = 0 collapses to the single flat-face tangent point, emitted once as
    // a triangle fan (so there are no zero-area triangles at the pole).
    for (const signX of [1, -1]) {
      for (const signY of [1, -1]) {
        for (const signZ of [1, -1]) {
          const signs = [signX, signY, signZ];
          const centre = [
            signX * inner[0],
            signY * inner[1],
            signZ * inner[2],
          ];
          // Pole: normal points straight out of the ±X flat face.
          const poleNormal = [signX, 0, 0];
          const pole = pushVertex(
            centre[0] + cornerRadius * poleNormal[0],
            centre[1] + cornerRadius * poleNormal[1],
            centre[2] + cornerRadius * poleNormal[2],
            poleNormal[0],
            poleNormal[1],
            poleNormal[2],
          );
          const rows = [];
          for (let i = 1; i <= bevelSegments; i += 1) {
            const cosTheta = cosTable[i];
            const sinTheta = sinTable[i];
            const row = new Array(bevelSegments + 1);
            for (let j = 0; j <= bevelSegments; j += 1) {
              const cosPhi = cosTable[j];
              const sinPhi = sinTable[j];
              const normal = [
                signs[0] * cosTheta,
                signs[1] * sinTheta * cosPhi,
                signs[2] * sinTheta * sinPhi,
              ];
              row[j] = pushVertex(
                centre[0] + cornerRadius * normal[0],
                centre[1] + cornerRadius * normal[1],
                centre[2] + cornerRadius * normal[2],
                normal[0],
                normal[1],
                normal[2],
              );
            }
            rows.push(row);
          }
          // Triangle fan from the flat-face tangent point to the first grid row.
          for (let j = 0; j < bevelSegments; j += 1) {
            pushTriangle(pole, rows[0][j], rows[0][j + 1]);
          }
          // Spherical grid between consecutive rows.
          for (let i = 1; i < bevelSegments; i += 1) {
            for (let j = 0; j < bevelSegments; j += 1) {
              pushTriangle(rows[i - 1][j], rows[i][j], rows[i][j + 1]);
              pushTriangle(rows[i - 1][j], rows[i][j + 1], rows[i - 1][j + 1]);
            }
          }
        }
      }
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Buffers                                                                 */
  /* ----------------------------------------------------------------------- */
  const vertexCount = positions.length / 3;
  const geometry = new THREE.BufferGeometry();
  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(normals);
  const uvArray = new Float32Array(uvs);
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const indexArray = new IndexArray(indices);

  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));

  // Exact bounds derived from the real float32 vertices (extremes are the six
  // flat faces, so this reproduces width × height × depth to the last bit of
  // the stored positions).  Computing them here also keeps the model's
  // `new THREE.Box3().setFromObject(group)` layout check exact and cheap.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  geometry.userData = {
    roundedBox: true,
    cornerRadius,
    bevelSegments,
    tilePx,
  };
  return geometry;
}
