/**
 * tekoanimation — Logo blocks model (docs/logo-blocks-contract.md, L2 / L3 / L6).
 *
 * Two deterministic compositions for one page (Rev22: scenes 01 `stack` and 02
 * `bank` were removed; the catalogue numbering 03 / 04 is unchanged), built in a
 * single module:
 *
 *   scene `plates` (catalogue 03, reference: K:\HFWorkspace\refs\round3\logo-block.png)
 *     seven standing rounded-square metal plates — 1.50 x 1.50 x 0.30 world units,
 *     corner radius 0.255, rolled outer edge radius 0.085, face panel recessed
 *     0.020 below the rim crest, silver-grey satin side walls, bright satin
 *     faces. Each plate carries the TEKO arrow embossed as a two-tone
 *     *silver/graphite machined relief* built from a dark socket, a visible wall
 *     and a chamfered cap, so the mark reads as raised metal under the image
 *     based lighting (no lights exist in Rev21+). The plates slide in from the
 *     right into a cluster turned 45 degrees to the right, then every plate
 *     rotates about its own origin and spreads along the SAME 45 degree gather
 *     line (`PLATES_SPEC.open` and `.cluster` share the 1:1 direction vector;
 *     only the spacing differs) into an expanded row. They stand on the studio
 *     surface (Rev22: the surface is the satin columns platform).
 *
 *   scene `link` (catalogue 04)
 *     a logo block + a bank block (the same 1.45 x 1.45 x 0.20 shell, corner
 *     radius 0.245, rolled bright edge) with a thin theme-gold glow ring on the
 *     logo block, a raised classical bank icon relief on the bank block, and 56
 *     dotted particle rays from the logo block's back edge ring to the bank
 *     block's front edge ring. Rev22 removed the two metal pillars: the blocks
 *     rest directly on the same satin column top.
 *
 * Determinism / offline rules (contract L3, L7): everything is constants plus one
 * seeded mulberry32 stream (`SEED`); there is no Math.random, no time/device
 * input, no network access and no image asset in this module. Contact shadows use
 * vertex-alpha geometry, not a baked shadow map. The logo SVG is supplied by the
 * page (the model never fetches it) and parsed at runtime; its two authored fills
 * are mapped to the two machined metal tones (silver / graphite). Authored sRGB
 * albedos are converted to linear working values explicitly
 * (`workingColorFromHex`, as in src/shield-model.js) because three r151 ships
 * with ColorManagement disabled.
 *
 * The page/studio layer (`src/logo-blocks-preview.js`) owns environment,
 * cameras, DOM and renderer; each scene group here contains only the composition
 * (meshes, Y up, front faces +Z) plus the authored surface/contact shadows.
 * `bounds` is the composition bounds (the plates / blocks), so `bounds.min.y` is
 * the surface height the composition rests on; `fitPoints` additionally carries
 * the surface front-edge extents for camera framing.
 *
 * Public API (frozen for ./logo-blocks-preview.js, contract L3):
 *   MODEL_VERSION, LOGO_SOURCE_PATH, LOGO_PNG_PATH,
 *   PLATE_SPEC, LINK_BLOCK_SPEC, PLATES_SPEC, LINK_SPEC,
 *   MATERIAL_SPEC, CAMERA_SPEC, SEED,
 *   parseTekoLogoSvg(svgText, options),
 *   createLogoBlocksModel({ logoSvgText, logoSourcePath, seed, quality }) -> model
 *     model: { version, spec, materials, scenes: { plates, link }, getDebug(), dispose() }
 *
 * Everything else (rounded-rect sampling, band/extrusion helpers, emblem and
 * bank-icon builders) is internal.
 */

import * as THREE from 'three';
import { createColumns, COLUMN_GEOMETRY_RATIO } from './columns-model.js';

/** Human-readable module version (reported by getDebug(), not the page contract). */
export const MODEL_VERSION = '2.1.0';

/** Project-relative path of the copied TEKO icon used for the embossed emblem. */
export const LOGO_SOURCE_PATH = './assets/logo-blocks/teko2_icon.svg';

/** Project-relative path of the copied PNG mark (used by the page fallback poster). */
export const LOGO_PNG_PATH = './assets/logo-blocks/teko2_icon.png';

/**
 * One fixed seed for every procedural decision in the model (texture noise, dot
 * jitter, speckle placement). Chosen as the ASCII bytes of "logo".
 */
export const SEED = 0x6c6f676f;

/* ------------------------------------------------------------------ maths */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => clamp(value, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;

function degToRad(deg) {
  return deg * DEG;
}

/** Signed area of a closed 2D polygon (positive = counter-clockwise, +Z normal). */
function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function centroidOf(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return new THREE.Vector2(x / points.length, y / points.length);
}

/** Relative luminance of an authored sRGB hex fill (used for emblem tone mapping). */
function relativeLuminance(hex) {
  const value = String(hex || '#000000').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexString(hex) {
  return '#' + (Number(hex) >>> 0).toString(16).padStart(6, '0');
}

/* ------------------------------------------------------------------ specs */

/**
 * Scene `plates` block profile (catalogue 03) — plate shell, emblem and the
 * shared studio-surface constants.
 *
 * Profile numbers are measured from the plate's back face (profile z 0 = back,
 * `thickness` = front rim crest); the builder recentres them on the block origin.
 * The rolled edge is a quarter circle of radius `rolledEdgeRadius` that starts at
 * the top of the straight satin wall (`wallEndZ`) and ends at the crest; the face
 * panel plane (`faceZ`) is `faceRecess` below that crest, inside the rim chamfer
 * table.
 */
export const PLATE_SPEC = Object.freeze({
  faceSize: 1.5,
  thickness: 0.3,
  cornerRadius: 0.255,
  rolledEdgeRadius: 0.085,
  faceRecess: 0.02,
  /** Profile z: top of the straight dark side wall. */
  wallEndZ: 0.215,
  /** Profile z: rounded-square rim crest (frontmost silhouette). */
  crestZ: 0.3,
  /** Profile z: recessed face panel plane (`crestZ - faceRecess`). */
  faceZ: 0.28,
  /** Inward offset of the face panel edge (rim + chamfer width). */
  panelInset: 0.112,
  /**
   * Rim chamfer from the crest down/inward to the panel edge as [inset, profileZ]
   * pairs; the last entry must equal `panelInset` / `faceZ`.
   */
  rimChamfer: Object.freeze([
    Object.freeze([0.098, 0.2895]),
    Object.freeze([0.107, 0.2815]),
    Object.freeze([0.112, 0.28]),
  ]),
  /** Outline sampling: points per rounded corner / per straight edge. */
  cornerSegments: 8,
  edgeSegments: 12,
  /** Rings used to tessellate the rolled edge quarter circle. */
  rimArcSegments: 6,
  emblem: Object.freeze({
    /** Emblem width as a fraction of the face width (0.52 of 1.50). */
    width: 0.52,
    /** Centre offset as a fraction of the face width. */
    centerX: 0,
    centerY: 0.015,
    /** Machined relief: cap plane above the recessed face panel. */
    relief: 0.022,
    /** Wall skirt base sunk into the face panel (hides the contact seam). */
    wallInset: 0.003,
    /** Top of the visible vertical wall; the chamfer rises from here to `relief`. */
    wallTop: 0.01,
    /** Inward chamfer rings (scale about the contour centroid) up to the cap. */
    chamferScales: Object.freeze([0.988, 0.976, 0.964, 0.952]),
    /** Dark socket outline scale around each SVG sub-shape centroid. */
    socketScale: 1.05,
    /** Socket plane above the face panel (kept clear of the cap/wall). */
    socketLift: 0.001,
    /** Cubic flattening segments per SVG curve. */
    curveSegments: 12,
  }),
  /**
   * Satin columns platform (Rev22). The platform is the Columns collection's
   * deliverable `satin-large-long` column mesh (600 px long, 140 x 140 px cross
   * section, 1 px = 1 world unit) rotated so its length runs along world X, laid
   * HORIZONTAL with its top face at `topY`. The scene builder derives a uniform
   * `scale` from the composition footprint (depth of the top face = 140 * scale)
   * with `marginXZ` clearance, and the preview reuses the columns bank's satin
   * material object verbatim (same maps/params, no re-build).
   */
  platform: Object.freeze({
    columnId: 'satin-large-long',
    materialId: 'satin',
    footprint: 'large',
    height: 'long',
    crossSectionPx: 140,
    lengthPx: 600,
    topY: 0,
    marginXZ: 0.24,
    probeHalfWidth: 1.2,
  }),
  /** Per-plate soft contact shadow pressed onto the platform top face. */
  shadow: Object.freeze({
    alpha: 0.48,
    radiusX: 0.92,
    radiusZ: 0.6,
    raise: 0.0016,
    rings: 10,
    segments: 36,
  }),
});

/**
 * Scene `link` block profile (catalogue 04) — logo/bank block shell, emblem,
 * glow ring and the raised classical bank icon. Profile numbers follow the same
 * back-face convention as PLATE_SPEC. The two blocks' placement, tilt and rays
 * live in LINK_SPEC below.
 */
export const LINK_BLOCK_SPEC = Object.freeze({
  faceSize: 1.45,
  thickness: 0.2,
  cornerRadius: 0.245,
  rolledEdgeRadius: 0.055,
  faceRecess: 0.016,
  wallEndZ: 0.145,
  crestZ: 0.2,
  faceZ: 0.184,
  panelInset: 0.086,
  rimChamfer: Object.freeze([
    Object.freeze([0.072, 0.1885]),
    Object.freeze([0.086, 0.184]),
  ]),
  cornerSegments: 8,
  edgeSegments: 12,
  rimArcSegments: 5,
  emblem: Object.freeze({
    width: 0.5,
    centerX: 0,
    centerY: 0.01,
    relief: 0.02,
    wallInset: 0.003,
    wallTop: 0.009,
    chamferScales: Object.freeze([0.988, 0.976, 0.964, 0.952]),
    socketScale: 1.05,
    socketLift: 0.001,
    curveSegments: 12,
  }),
  /** Thin gold accent ring on the logo plaque: flat band on the panel plane. */
  ring: Object.freeze({
    insetStart: 0.086,
    insetEnd: 0.102,
    width: 0.016,
    raise: 0.0012,
  }),
  /**
   * Raised classical bank icon (left plaque). Normalised icon coordinates run
   * x -0.50..0.50, y -0.50..0.46; every part is a rounded extruded shape in the
   * same polished panel material so the fluted/dotted maps continue over the
   * relief.
   */
  bankIcon: Object.freeze({
    width: 0.47,
    relief: 0.024,
    centerY: 0,
    cornerRadius: 0.014,
    cornerSegments: 5,
    bevelSize: 0.01,
    bevelThickness: 0.003,
    bevelSegments: 2,
    /** Dark separation plate under every icon part (shadow / depth cue). */
    shadowScale: 1.035,
    shadowLift: 0.0005,
  }),
});

/**
 * Every material in the model. `color` is the authored sRGB albedo (converted to
 * linear working values by workingColorFromHex at creation); no baked lighting is
 * stored in any map and every plain metal material is map-free. Brand gold is
 * confined to the link glow ring (`goldGlow` carries the subtle emissive); the
 * emblem is silver-on-silver (`emblemSilver` polished cap from the SVG's bright
 * fill, `emblemGraphite` satin cap from the SVG's deep fill) over the dark
 * `socket` outline.
 */
export const MATERIAL_SPEC = Object.freeze({
  bankFace: Object.freeze({ color: 0xcfd3d9, metalness: 1.0, roughness: 0.26, envMapIntensity: 1.05, role: 'bright satin silver plate face (catalogue 03)' }),
  bankRim: Object.freeze({ color: 0xeef2f6, metalness: 1.0, roughness: 0.12, envMapIntensity: 1.1, role: 'bright rolled edge' }),
  emblemSilver: Object.freeze({ color: 0xd6dbe1, metalness: 1.0, roughness: 0.18, envMapIntensity: 1.1, role: 'machined emblem cap from the SVG bright fill (polished silver)' }),
  emblemGraphite: Object.freeze({ color: 0x6a7078, metalness: 1.0, roughness: 0.36, envMapIntensity: 0.8, role: 'machined emblem cap from the SVG deep fill (satin graphite; tuned so it reads visibly darker than the silver cap)' }),
  socket: Object.freeze({ color: 0x2a2d31, metalness: 0.9, roughness: 0.5, envMapIntensity: 0.7, role: 'emblem socket outline' }),
  bankIcon: Object.freeze({
    color: 0xffffff,
    colorScale: 1.14,
    metalness: 1.0,
    roughness: 0.14,
    envMapIntensity: 1.25,
    role: 'polished silver classical-bank icon relief (tighter polish + a touch brighter than the field so the light catches the pediment/column edges)',
  }),
  frameSatin: Object.freeze({ color: 0x8d949c, metalness: 1.0, roughness: 0.42, envMapIntensity: 0.95, role: 'silver-grey satin metal middle frame (Rev19)' }),
  coinFace: Object.freeze({ color: 0xd4d8de, metalness: 1.0, roughness: 0.38, envMapIntensity: 0.92, role: 'coin-style satin silver block face (same metal/roughness/clearcoat as the coin face)' }),
  goldGlow: Object.freeze({ color: 0xffd60a, metalness: 0.6, roughness: 0.3, envMapIntensity: 0.8, emissive: 0xffc21a, emissiveIntensity: 1.5, role: 'theme-gold glow ring between face and frame' }),
  bankShadow: Object.freeze({
    color: 0x2f3237,
    metalness: 0.0,
    roughness: 0.95,
    envMapIntensity: 0.25,
    role: 'dark separation/shadow plate under the raised bank icon (geometry-only depth cue)',
  }),
  bankIconEdge: Object.freeze({
    color: 0xf2f6fa,
    metalness: 1.0,
    roughness: 0.1,
    envMapIntensity: 1.25,
    role: 'polished plain silver for the bank-icon chamfer/side walls',
  }),
  contactShadow: Object.freeze({
    color: 0x000000,
    kind: 'shadow',
    role: 'soft contact shadow (vertex-alpha geometry, no baked shadow map)',
  }),
});

/**
 * Fixed three-quarter cameras per scene (contract L2). The previewer applies its
 * own dolly fit from `fitPoints`; these are the default poses, fov and the orbit
 * clamps it exposes (yaw clamps are absolute azimuth degrees, +/-16 deg around the
 * default; pitch clamps are absolute elevation degrees).
 */
export const CAMERA_SPEC = Object.freeze({
  plates: Object.freeze({
    fov: 30,
    near: 0.05,
    far: 60,
    azimuthDeg: 0,
    elevationDeg: 10,
    yawMinDeg: -16,
    yawMaxDeg: 16,
    yawRangeDeg: 16,
    pitchMinDeg: -4,
    pitchMaxDeg: 26,
    dragSensitivity: 0.16,
    fitMargin: 0.9,
    fitMarginNarrow: 0.86,
    narrowStageWidth: 520,
    targetYOffset: 0,
  }),
  link: Object.freeze({
    fov: 30,
    near: 0.05,
    far: 60,
    azimuthDeg: 0,
    elevationDeg: 14,
    yawMinDeg: -16,
    yawMaxDeg: 16,
    yawRangeDeg: 16,
    pitchMinDeg: -4,
    pitchMaxDeg: 30,
    dragSensitivity: 0.16,
    fitMargin: 0.9,
    fitMarginNarrow: 0.86,
    narrowStageWidth: 520,
    targetYOffset: 0,
  }),
});

/* ------------------------------------------------------ colour + textures */

function srgbChannelToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * three r151 ships with ColorManagement disabled (legacy mode), so a hex handed
 * to the Color constructor is treated as a working-space value and renders far
 * too bright once the sRGB output encoding is applied. Convert the authored sRGB
 * hex to linear working values explicitly (same helper as src/shield-model.js).
 */
function workingColorFromHex(hex) {
  const color = new THREE.Color();
  color.setRGB(
    srgbChannelToLinear(((hex >> 16) & 255) / 255),
    srgbChannelToLinear(((hex >> 8) & 255) / 255),
    srgbChannelToLinear((hex & 255) / 255),
  );
  return color;
}

/** Triangle count of a geometry (indexed or not). */
function triangleCountOf(geometry) {
  if (!geometry) return 0;
  if (geometry.index) return geometry.index.count / 3;
  const position = geometry.getAttribute('position');
  return position ? position.count / 3 : 0;
}

/* ------------------------------------------------------------ geometry core */

function createIndexedGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // r151 only auto-wraps plain Arrays in setIndex; pass an explicit
  // BufferAttribute so index.count / the renderer see a proper attribute.
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/** Flip triangle winding (used when the computed normals point the wrong way). */
function flipWinding(geometry) {
  const index = geometry.getIndex();
  if (!index) return;
  const array = index.array;
  for (let i = 0; i < array.length; i += 3) {
    const swap = array[i + 1];
    array[i + 1] = array[i + 2];
    array[i + 2] = swap;
  }
  index.needsUpdate = true;
}

/**
 * Rounded-square outline centred on the origin, counter-clockwise, sampled with
 * a fixed number of points (4 * edgeSegments + 4 * cornerSegments). Every inward
 * offset of a rounded rectangle is the rounded rectangle of the reduced half
 * extent / corner radius around the same corner centres, so calling this for two
 * insets yields two rings with exact 1:1 point correspondence (no twisted bands).
 */
function roundedRectPoints(half, radius, cornerSegments, edgeSegments) {
  const r = Math.max(1e-6, Math.min(radius, half - 1e-6));
  const c = half - r;
  const points = [];
  const push = (x, y) => points.push(new THREE.Vector2(x, y));
  const pushArc = (cx, cy, rad, a0, a1, steps) => {
    for (let i = 1; i <= steps; i += 1) {
      const angle = lerp(a0, a1, i / steps);
      push(cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad);
    }
  };
  const pushEdge = (x0, y0, x1, y1) => {
    for (let i = 1; i <= edgeSegments; i += 1) {
      push(lerp(x0, x1, i / edgeSegments), lerp(y0, y1, i / edgeSegments));
    }
  };
  push(c, -half);
  pushEdge(c, -half, -c, -half); // bottom edge (right -> left, CCW)
  pushArc(-c, -c, r, (3 * Math.PI) / 2, Math.PI, cornerSegments); // bottom-left corner
  pushEdge(-half, -c, -half, c); // left edge
  pushArc(-c, c, r, Math.PI, Math.PI / 2, cornerSegments); // top-left corner
  pushEdge(-c, half, c, half); // top edge
  pushArc(c, c, r, Math.PI / 2, 0, cornerSegments); // top-right corner
  pushEdge(half, c, half, -c); // right edge
  pushArc(c, -c, r, 0, -Math.PI / 2, cornerSegments); // bottom-right corner
  // The final arc returns exactly to the start point; drop the duplicate.
  if (points.length > 1 && points[0].distanceToSquared(points[points.length - 1]) < 1e-14) points.pop();
  return points;
}

/**
 * Build one closed band surface (a grid of rings) as indexed geometry.
 * `rings` are ordered back/outer -> front/inner; every ring is
 * `{ points: Vector2[], z: number }` with the same point count. `options.centre`
 * caps the last ring with a triangle fan (single-ring caps / face panels).
 * `options.expected` ('front' | 'back' | 'radial') selects the orientation test:
 * the winding is flipped when the computed normals point the wrong way, so no
 * band can end up as an inverted front face (the shield's proven approach).
 */
function buildBandGeometry(rings, options = {}) {
  const ringCount = rings.length;
  const sampleCount = rings[0].points.length;
  const centre = options.centre || null;
  const uvScale = options.uvScale || 1;
  const vertexCount = ringCount * sampleCount + (centre ? 1 : 0);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let cursor = 0;
  let uvCursor = 0;
  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const ring = rings[ringIndex];
    for (let i = 0; i < sampleCount; i += 1) {
      const point = ring.points[i];
      positions[cursor] = point.x;
      positions[cursor + 1] = point.y;
      positions[cursor + 2] = ring.z;
      uvs[uvCursor] = point.x / uvScale + 0.5;
      uvs[uvCursor + 1] = point.y / uvScale + 0.5;
      cursor += 3;
      uvCursor += 2;
    }
  }
  const centreIndex = centre ? ringCount * sampleCount : -1;
  if (centre) {
    positions[cursor] = centre.x;
    positions[cursor + 1] = centre.y;
    positions[cursor + 2] = centre.z;
    uvs[uvCursor] = centre.x / uvScale + 0.5;
    uvs[uvCursor + 1] = centre.y / uvScale + 0.5;
  }

  const triangles = (ringCount - 1) * sampleCount * 2 + (centre ? sampleCount : 0);
  const closed = options.closed === undefined ? true : options.closed;
  const indices = new Uint32Array(triangles * 3);
  let write = 0;
  const lastSample = closed ? sampleCount : sampleCount - 1;
  for (let ringIndex = 0; ringIndex < ringCount - 1; ringIndex += 1) {
    const base = ringIndex * sampleCount;
    const nextBase = base + sampleCount;
    for (let i = 0; i < lastSample; i += 1) {
      const next = (i + 1) % sampleCount;
      indices[write] = base + i;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = base + next;
      write += 3;
      indices[write] = base + next;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = nextBase + next;
      write += 3;
    }
  }
  if (centre) {
    const base = (ringCount - 1) * sampleCount;
    for (let i = 0; i < sampleCount; i += 1) {
      const next = (i + 1) % sampleCount;
      indices[write] = base + i;
      indices[write + 1] = centreIndex;
      indices[write + 2] = base + next;
      write += 3;
    }
  }

  const geometry = createIndexedGeometry(positions, indices);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  const expected = options.expected || 'front';
  const normalAttribute = geometry.getAttribute('normal');
  let score = 0;
  if (expected === 'radial') {
    const stride = Math.max(1, Math.floor(vertexCount / 64));
    for (let i = 0; i < vertexCount; i += stride) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const length = Math.hypot(px, py) || 1;
      score += (normalAttribute.getX(i) * px + normalAttribute.getY(i) * py) / length;
    }
  } else {
    const sign = expected === 'back' ? -1 : 1;
    const stride = Math.max(1, Math.floor(vertexCount / 64));
    for (let i = 0; i < vertexCount; i += stride) score += normalAttribute.getZ(i) * sign;
  }
  if (score < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  geometry.userData = { expected, role: options.role || '' };
  return geometry;
}

/**
 * Shape from a 2D polygon with softly rounded corners (quadratic fillets). Used
 * for the classical bank icon parts before extrusion; the input may be CW or CCW.
 */
function roundedPolygonShape(points, radius) {
  const list = points.map((point) => (point.isVector2 ? point.clone() : new THREE.Vector2(point.x, point.y)));
  const loop = signedArea(list) < 0 ? list.reverse() : list;
  const shape = new THREE.Shape();
  const corners = loop.map((current, index) => {
    const previous = loop[(index - 1 + loop.length) % loop.length];
    const next = loop[(index + 1) % loop.length];
    const toPrevious = previous.clone().sub(current);
    const toNext = next.clone().sub(current);
    const trim = Math.min(radius, toPrevious.length() * 0.45, toNext.length() * 0.45);
    toPrevious.normalize();
    toNext.normalize();
    return {
      current,
      a: current.clone().addScaledVector(toPrevious, trim),
      b: current.clone().addScaledVector(toNext, trim),
    };
  });
  shape.moveTo(corners[0].a.x, corners[0].a.y);
  for (let i = 0; i < corners.length; i += 1) {
    const corner = corners[i];
    shape.quadraticCurveTo(corner.current.x, corner.current.y, corner.b.x, corner.b.y);
    const next = corners[(i + 1) % corners.length];
    shape.lineTo(next.a.x, next.a.y);
  }
  shape.closePath();
  return shape;
}

/**
 * Rounded, bevelled extrude of a block-local 2D polygon into +Z.
 * The finished solid spans z 0..(depth + 2 * bevelThickness); UVs are rewritten
 * to the block face plane so the procedural panel maps continue across the
 * relief (planar projection in block-local world units, `uvScale` = face size).
 */
function buildExtrudedPart(points, options) {
  const {
    cornerRadius = 0.014,
    cornerSegments = 4,
    depth,
    bevelSize = 0.006,
    bevelThickness = 0.005,
    bevelSegments = 2,
    uvScale = 1,
  } = options;
  const shape = roundedPolygonShape(points, cornerRadius);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: cornerSegments + 2,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelOffset: 0,
    bevelSegments,
  });
  geometry.translate(0, 0, bevelThickness);
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = position.getX(i) / uvScale + 0.5;
    uv[i * 2 + 1] = position.getY(i) / uvScale + 0.5;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Flat top plate of a surface slab (horizontal, +Y normal) with planar world-space
 * UVs (`u = x / tile + 0.5`, `v = z / tile + 0.5`) so a repeatable procedural map
 * tiles across the slab without seams.
 */
/**
 * Swept band for a surface slab cross-section (top front edge -> rounded polished
 * lip -> front wall), extruded across X. UVs are world-scaled on both axes
 * (u = x / tile, v = arc length / tile) so the concrete map keeps its density on
 * the lip and the front face.
 */
/**
 * Surface slab: flat top plate + swept rounded front lip and front wall. Both
 * scenes use the same construction with their own measured profile and material.
 */
/**
 * Soft contact shadow: a flat disc in XZ with per-vertex RGBA (black, alpha
 * fading to zero at the rim). Geometry-only, so it adds no baked shadow map and
 * no texture; the material is a transparent MeshBasicMaterial.
 */
function buildContactShadowGeometry(spec, geometrySet) {
  const rings = spec.rings;
  const segments = spec.segments;
  const vertexCount = 1 + rings * segments;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);
  const uvs = new Float32Array(vertexCount * 2);

  const setVertex = (index, x, z, alpha) => {
    positions[index * 3] = x;
    positions[index * 3 + 1] = 0;
    positions[index * 3 + 2] = z;
    colors[index * 4] = 0;
    colors[index * 4 + 1] = 0;
    colors[index * 4 + 2] = 0;
    colors[index * 4 + 3] = clamp01(alpha);
    uvs[index * 2] = x / (spec.radiusX * 2) + 0.5;
    uvs[index * 2 + 1] = z / (spec.radiusZ * 2) + 0.5;
  };

  setVertex(0, 0, 0, spec.alpha);
  for (let ring = 1; ring <= rings; ring += 1) {
    const t = ring / rings;
    const alpha = spec.alpha * Math.pow(1 - t, 2.1);
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * TAU;
      const index = 1 + (ring - 1) * segments + segment;
      setVertex(index, Math.cos(angle) * t * spec.radiusX, Math.sin(angle) * t * spec.radiusZ, alpha);
    }
  }

  const indices = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(0, 1 + segment, 1 + next);
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const base = 1 + (ring - 1) * segments;
    const outer = base + segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(base + segment, outer + segment, outer + next);
      indices.push(base + segment, outer + next, base + next);
    }
  }
  const geometry = createIndexedGeometry(positions, new Uint32Array(indices));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.userData = { role: 'contact shadow' };
  geometrySet.add(geometry);
  return geometry;
}

/* -------------------------------------------------------------- svg parser */

const SVG_PATH_COMMANDS = 'MmLlHhVvCcSsQqTtAaZz';

function tokenizePathData(d) {
  const tokens = [];
  const pattern = new RegExp('([' + SVG_PATH_COMMANDS + '])|([-+]?(?:\\d*\\.\\d+|\\d+)(?:[eE][-+]?\\d+)?)', 'g');
  let match = pattern.exec(d);
  while (match !== null) {
    if (match[1]) tokens.push({ command: match[1] });
    else tokens.push({ number: Number(match[2]) });
    match = pattern.exec(d);
  }
  return tokens;
}

/** Minimal deterministic SVG path parser: M L H V C S Q T Z (absolute + relative). */
function parsePathData(d, options = {}) {
  const curveSegments = Math.max(2, Math.round(options.curveSegments || 12));
  const tokens = tokenizePathData(d);
  const subpaths = [];
  let current = [];
  let x = 0;
  let y = 0;
  let command = null;
  let index = 0;
  let cubicControl = null;
  let quadControl = null;

  const read = (count) => {
    const values = [];
    for (let i = 0; i < count; i += 1) {
      if (index >= tokens.length || tokens[index].command) return null;
      values.push(tokens[index].number);
      index += 1;
    }
    return values;
  };
  const addPoint = (px, py) => {
    current.push(new THREE.Vector2(px, py));
  };
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let i = 1; i <= curveSegments; i += 1) {
      const t = i / curveSegments;
      const mt = 1 - t;
      const px = mt * mt * mt * x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
      const py = mt * mt * mt * y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
      addPoint(px, py);
    }
    x = x3;
    y = y3;
  };
  const quadratic = (x1, y1, x2, y2) => {
    for (let i = 1; i <= curveSegments; i += 1) {
      const t = i / curveSegments;
      const mt = 1 - t;
      const px = mt * mt * x + 2 * mt * t * x1 + t * t * x2;
      const py = mt * mt * y + 2 * mt * t * y1 + t * t * y2;
      addPoint(px, py);
    }
    x = x2;
    y = y2;
  };

  while (index < tokens.length) {
    if (tokens[index].command) {
      command = tokens[index].command;
      index += 1;
      if (command === 'Z' || command === 'z') {
        if (current.length > 0) subpaths.push(current);
        current = [];
        command = null;
        continue;
      }
    } else if (!command) {
      throw new Error('SVG path data contains numbers before a command');
    }

    const upper = command.toUpperCase();
    const relative = command !== upper;

    if (upper === 'M') {
      if (current.length > 0) subpaths.push(current);
      current = [];
      const values = read(2);
      if (!values) break;
      x = relative ? x + values[0] : values[0];
      y = relative ? y + values[1] : values[1];
      addPoint(x, y);
      command = relative ? 'l' : 'L';
      cubicControl = null;
      quadControl = null;
      continue;
    }

    let values = null;
    switch (upper) {
      case 'L': {
        values = read(2);
        if (!values) { index = tokens.length; break; }
        x = relative ? x + values[0] : values[0];
        y = relative ? y + values[1] : values[1];
        addPoint(x, y);
        break;
      }
      case 'H': {
        values = read(1);
        if (!values) { index = tokens.length; break; }
        x = relative ? x + values[0] : values[0];
        addPoint(x, y);
        break;
      }
      case 'V': {
        values = read(1);
        if (!values) { index = tokens.length; break; }
        y = relative ? y + values[0] : values[0];
        addPoint(x, y);
        break;
      }
      case 'C': {
        values = read(6);
        if (!values) { index = tokens.length; break; }
        const x1 = relative ? x + values[0] : values[0];
        const y1 = relative ? y + values[1] : values[1];
        const x2 = relative ? x + values[2] : values[2];
        const y2 = relative ? y + values[3] : values[3];
        const x3 = relative ? x + values[4] : values[4];
        const y3 = relative ? y + values[5] : values[5];
        cubic(x1, y1, x2, y2, x3, y3);
        cubicControl = new THREE.Vector2(x2, y2);
        quadControl = null;
        break;
      }
      case 'S': {
        values = read(4);
        if (!values) { index = tokens.length; break; }
        const reflected = cubicControl
          ? new THREE.Vector2(2 * x - cubicControl.x, 2 * y - cubicControl.y)
          : new THREE.Vector2(x, y);
        const x2 = relative ? x + values[0] : values[0];
        const y2 = relative ? y + values[1] : values[1];
        const x3 = relative ? x + values[2] : values[2];
        const y3 = relative ? y + values[3] : values[3];
        cubic(reflected.x, reflected.y, x2, y2, x3, y3);
        cubicControl = new THREE.Vector2(x2, y2);
        quadControl = null;
        break;
      }
      case 'Q': {
        values = read(4);
        if (!values) { index = tokens.length; break; }
        const x1 = relative ? x + values[0] : values[0];
        const y1 = relative ? y + values[1] : values[1];
        const x2 = relative ? x + values[2] : values[2];
        const y2 = relative ? y + values[3] : values[3];
        quadratic(x1, y1, x2, y2);
        quadControl = new THREE.Vector2(x1, y1);
        cubicControl = null;
        break;
      }
      case 'T': {
        values = read(2);
        if (!values) { index = tokens.length; break; }
        const reflected = quadControl
          ? new THREE.Vector2(2 * x - quadControl.x, 2 * y - quadControl.y)
          : new THREE.Vector2(x, y);
        const x2 = relative ? x + values[0] : values[0];
        const y2 = relative ? y + values[1] : values[1];
        quadratic(reflected.x, reflected.y, x2, y2);
        quadControl = new THREE.Vector2(reflected.x, reflected.y);
        cubicControl = null;
        break;
      }
      default:
        throw new Error('Unsupported SVG path command "' + command + '"');
    }
    cubicControl = upper === 'C' || upper === 'S' ? cubicControl : null;
    if (upper !== 'Q' && upper !== 'T') quadControl = null;
  }

  if (current.length > 0) subpaths.push(current);
  return subpaths;
}

/**
 * Parse the TEKO icon SVG into closed 2D contours with their authored fill
 * colours (same contract as src/shield-model.js). Returns `{ shapes, bbox }`,
 * every shape `{ index, subpathIndex, fill, points }` in SVG coordinates. The two
 * fills are #ffd60a (bright) and #7d5a00 (deep) — the model maps those source
 * tones to `emblemSilver` / `emblemGraphite`, never to gold.
 */
export function parseTekoLogoSvg(svgText, options = {}) {
  if (typeof svgText !== 'string' || svgText.length === 0) {
    throw new Error('parseTekoLogoSvg requires the SVG source text');
  }
  const curveSegments = Math.max(2, Math.round(options.curveSegments || 12));

  const classFills = new Map();
  const styleBlocks = svgText.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  for (const block of styleBlocks) {
    const rulePattern = /\.([A-Za-z0-9_-]+)\s*\{[^}]*fill\s*:\s*([^;}]+)/g;
    let rule = rulePattern.exec(block);
    while (rule !== null) {
      classFills.set(rule[1], rule[2].trim());
      rule = rulePattern.exec(block);
    }
  }

  const shapes = [];
  const pathPattern = /<path\b([^>]*?)\/?>/g;
  let match = pathPattern.exec(svgText);
  let shapeIndex = 0;
  while (match !== null) {
    const attributes = match[1] || '';
    const dMatch = attributes.match(/\sd\s*=\s*"([^"]*)"/) || attributes.match(/\sd\s*=\s*'([^']*)'/);
    if (dMatch && dMatch[1]) {
      const classMatch = attributes.match(/\sclass\s*=\s*"([^"]*)"/) || attributes.match(/\sclass\s*=\s*'([^']*)'/);
      const fillMatch = attributes.match(/\sfill\s*=\s*"([^"]*)"/) || attributes.match(/\sfill\s*=\s*'([^']*)'/);
      let fill = fillMatch ? fillMatch[1] : null;
      if (!fill && classMatch) {
        for (const className of classMatch[1].split(/\s+/)) {
          if (classFills.has(className)) {
            fill = classFills.get(className);
            break;
          }
        }
      }
      if (!fill) fill = '#000000';
      const subpaths = parsePathData(dMatch[1], { curveSegments });
      subpaths.forEach((points, subpathIndex) => {
        if (points.length < 3) return;
        shapes.push({ index: shapeIndex, subpathIndex, fill: String(fill).trim(), points });
        shapeIndex += 1;
      });
    }
    match = pathPattern.exec(svgText);
  }

  if (shapes.length === 0) {
    throw new Error('no <path> artwork found in the TEKO icon SVG');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    for (const point of shape.points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }
  return {
    shapes,
    bbox: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
  };
}

/* ----------------------------------------------------------------- emblem */

/** Remove duplicate consecutive points from a closed 2D contour. */
function cleanClosedContour(points) {
  const out = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (!previous || previous.distanceToSquared(point) > 1e-12) out.push(point);
  }
  if (out.length > 2 && out[0].distanceToSquared(out[out.length - 1]) < 1e-12) out.pop();
  return out;
}

/**
 * Triangulated flat cap of a closed contour at `capZ`, with per-triangle winding
 * correction and degenerate-triangle removal.
 *
 * `THREE.ShapeUtils.triangulateShape` (Earcut) does not guarantee uniform
 * counter-clockwise output for concave SVG contours, so a plain
 * `computeVertexNormals()` pass can leave individual cap triangles facing
 * backwards — that is what makes a relief read as "thin outline with white
 * patches" instead of a solid machined mark. Each triangle is therefore re-wound
 * to +Z (positive signed area) and zero-area triangles are dropped.
 */
function buildEmblemCap(contour, capZ, uvScale) {
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions = new Float32Array(contour.length * 3);
  const uvs = new Float32Array(contour.length * 2);
  for (let i = 0; i < contour.length; i += 1) {
    const x = contour[i].x;
    const y = contour[i].y;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = capZ;
    uvs[i * 2] = x / uvScale + 0.5;
    uvs[i * 2 + 1] = y / uvScale + 0.5;
  }
  const indices = [];
  let dropped = 0;
  for (const triangle of triangles) {
    const a = contour[triangle[0]];
    const b = contour[triangle[1]];
    const c = contour[triangle[2]];
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-10) {
      dropped += 1;
      continue;
    }
    if (area > 0) indices.push(triangle[0], triangle[1], triangle[2]);
    else indices.push(triangle[0], triangle[2], triangle[1]);
  }
  const geometry = createIndexedGeometry(positions, new Uint32Array(indices));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.userData = {
    expected: 'front',
    role: 'emblem cap',
    triangleCount: indices.length / 3,
    droppedTriangles: dropped,
  };
  return geometry;
}

/**
 * Emboss body: a short vertical wall from `baseZ` (sunk into the face panel) up
 * to `wallTopZ`, then a chamfer whose rings are scaled toward the contour
 * centroid while rising to `capZ`. The chamfer gives the mark a light-catching
 * bevel and the wall gives it visible side depth, so the relief reads as a
 * machined metal emboss rather than a flat sticker.
 */
function buildEmblemRelief(contour, baseZ, wallTopZ, capZ, chamferScales, uvScale) {
  const centroid = centroidOf(contour);
  const ringAt = (scaleValue) =>
    contour.map(
      (point) => new THREE.Vector2(
        centroid.x + (point.x - centroid.x) * scaleValue,
        centroid.y + (point.y - centroid.y) * scaleValue,
      ),
    );
  const rings = [
    { points: contour, z: baseZ },
    { points: contour, z: wallTopZ },
  ];
  for (let i = 0; i < chamferScales.length; i += 1) {
    const t = (i + 1) / chamferScales.length;
    rings.push({ points: ringAt(chamferScales[i]), z: wallTopZ + (capZ - wallTopZ) * t });
  }

  const ringCount = rings.length;
  const sampleCount = contour.length;
  const vertexCount = ringCount * sampleCount;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let cursor = 0;
  let uvCursor = 0;
  for (const ring of rings) {
    for (const point of ring.points) {
      positions[cursor] = point.x;
      positions[cursor + 1] = point.y;
      positions[cursor + 2] = ring.z;
      uvs[uvCursor] = point.x / uvScale + 0.5;
      uvs[uvCursor + 1] = point.y / uvScale + 0.5;
      cursor += 3;
      uvCursor += 2;
    }
  }
  const indices = new Uint32Array((ringCount - 1) * sampleCount * 6);
  let write = 0;
  for (let ringIndex = 0; ringIndex < ringCount - 1; ringIndex += 1) {
    const base = ringIndex * sampleCount;
    const nextBase = base + sampleCount;
    for (let i = 0; i < sampleCount; i += 1) {
      const next = (i + 1) % sampleCount;
      indices[write] = base + i;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = base + next;
      write += 3;
      indices[write] = base + next;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = nextBase + next;
      write += 3;
    }
  }
  const geometry = createIndexedGeometry(positions, indices);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  // Outward normals radiate away from the contour centroid (wall sides and
  // chamfer both); flip the winding when the computed normals point inward.
  const normal = geometry.getAttribute('normal');
  let score = 0;
  for (let i = 0; i < normal.count; i += 1) {
    const dx = positions[i * 3] - centroid.x;
    const dy = positions[i * 3 + 1] - centroid.y;
    const length = Math.hypot(dx, dy) || 1;
    score += (normal.getX(i) * dx + normal.getY(i) * dy) / length;
  }
  if (score < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  geometry.userData = { expected: 'contour', role: 'emblem relief band' };
  return geometry;
}

/**
 * Build the TEKO arrow as a two-tone machined relief on a flat face plane.
 *
 * Each SVG contour becomes three parts, all placed relative to the scene's
 * actual recessed face/panel z (`surfaceZ`):
 *   1. socket  — a dark flat contour expanded 1.06 around its centroid, lifted
 *                1.2 mm above the panel (its own z plane, never coplanar);
 *   2. body    — a wall skirt sunk `wallInset` into the panel plus three chamfer
 *                rings scaled toward the centroid up to the cap height;
 *   3. cap     — the triangulated raised top plane (bright fill -> polished
 *                `emblemSilver`, deep fill -> satin `emblemGraphite`).
 * Caps are re-wound per triangle so concave contours can never render as
 * inverted/back-facing patches. The returned group is built in block-local
 * coordinates and cloned per block; its geometries/materials are shared.
 */
function buildEmblem(context) {
  const { parsed, spec, faceSize, surfaceZ, materials, geometrySet, source } = context;
  const group = new THREE.Group();
  group.name = 'teko-emblem';

  const bbox = parsed.bbox;
  const scale = (spec.width * faceSize) / Math.max(1e-6, bbox.width);
  const sourceCentreX = (bbox.minX + bbox.maxX) / 2;
  const sourceCentreY = (bbox.minY + bbox.maxY) / 2;
  const uvScale = faceSize;
  const toModel = (point) =>
    new THREE.Vector2(
      spec.centerX * faceSize + (point.x - sourceCentreX) * scale,
      spec.centerY * faceSize - (point.y - sourceCentreY) * scale,
    );

  const baseZ = surfaceZ - spec.wallInset;
  const wallTopZ = surfaceZ + spec.wallTop;
  const capZ = surfaceZ + spec.relief;
  const capScale = spec.chamferScales[spec.chamferScales.length - 1];

  const parts = [];
  const shapes = [];
  let triangleCount = 0;

  for (const shape of parsed.shapes) {
    const contour = cleanClosedContour(shape.points.map(toModel));
    if (contour.length < 3) continue;
    if (signedArea(contour) < 0) contour.reverse();
    const centroid = centroidOf(contour);
    const isBright = relativeLuminance(shape.fill) > 0.45;
    const tone = isBright ? 'silver' : 'graphite';
    const capMaterial = isBright ? materials.emblemSilver : materials.emblemGraphite;
    const socketMaterial = materials.socket;

    // --- 1. dark socket outline: a flat expanded contour just above the panel
    // (kept 1.2 mm clear of every other emblem plane, so it never z-fights).
    const socketContour = contour.map(
      (point) => new THREE.Vector2(
        centroid.x + (point.x - centroid.x) * spec.socketScale,
        centroid.y + (point.y - centroid.y) * spec.socketScale,
      ),
    );
    const socketGeometry = buildEmblemCap(socketContour, surfaceZ + spec.socketLift, uvScale);
    geometrySet.add(socketGeometry);
    const socketMesh = new THREE.Mesh(socketGeometry, socketMaterial);
    socketMesh.name = 'teko-emblem-socket-' + shapes.length;
    socketMesh.castShadow = false;
    socketMesh.receiveShadow = false;
    socketMesh.userData = { role: 'emblem socket outline' };
    group.add(socketMesh);
    const socketTriangles = triangleCountOf(socketGeometry);

    // --- 2. machined body: wall skirt (sunk into the panel) + chamfer rings.
    const reliefGeometry = buildEmblemRelief(contour, baseZ, wallTopZ, capZ, spec.chamferScales, uvScale);
    geometrySet.add(reliefGeometry);
    const reliefMesh = new THREE.Mesh(reliefGeometry, capMaterial);
    reliefMesh.name = 'teko-emblem-' + tone + '-' + shapes.length + '-relief';
    reliefMesh.castShadow = false;
    reliefMesh.receiveShadow = false;
    reliefMesh.userData = { role: 'emblem ' + tone + ' relief body' };
    group.add(reliefMesh);
    const reliefTriangles = triangleCountOf(reliefGeometry);

    // --- 3. raised cap plane (triangulated, per-triangle winding corrected).
    const capContour = contour.map(
      (point) => new THREE.Vector2(
        centroid.x + (point.x - centroid.x) * capScale,
        centroid.y + (point.y - centroid.y) * capScale,
      ),
    );
    const capGeometry = buildEmblemCap(capContour, capZ, uvScale);
    geometrySet.add(capGeometry);
    const capMesh = new THREE.Mesh(capGeometry, capMaterial);
    capMesh.name = 'teko-emblem-' + tone + '-' + shapes.length + '-cap';
    capMesh.castShadow = false;
    capMesh.receiveShadow = false;
    capMesh.userData = { role: 'emblem ' + tone + ' cap' };
    group.add(capMesh);
    const capTriangles = triangleCountOf(capGeometry);

    triangleCount += socketTriangles + reliefTriangles + capTriangles;
    parts.push({ name: capMesh.name, role: 'emblem ' + tone + ' cap', material: capMaterial.name, triangles: capTriangles });
    parts.push({ name: reliefMesh.name, role: 'emblem ' + tone + ' relief body', material: capMaterial.name, triangles: reliefTriangles });
    parts.push({ name: socketMesh.name, role: 'emblem socket outline', material: socketMaterial.name, triangles: socketTriangles });

    shapes.push({
      fill: shape.fill,
      tone,
      points: contour.length,
      triangles: socketTriangles + reliefTriangles + capTriangles,
    });
  }

  return {
    group,
    parts,
    shapes,
    triangleCount,
    source,
    width: spec.width * faceSize,
    height: bbox.height * scale,
    relief: spec.relief,
    parsed,
  };
}

/* ------------------------------------------------------- block geometries */

/** Shared shell geometries of a brand plate (all plates reuse them). */
function buildPlateShellGeometries(spec, geometrySet) {
  const half = spec.faceSize / 2;
  const zOffset = spec.thickness / 2;
  const z = (profileZ) => profileZ - zOffset;
  const ring = (inset) => roundedRectPoints(half - inset, spec.cornerRadius - inset, spec.cornerSegments, spec.edgeSegments);
  const uvScale = spec.faceSize;
  const wallRing = ring(0);

  const wall = buildBandGeometry(
    [{ points: wallRing, z: z(0) }, { points: wallRing, z: z(spec.wallEndZ) }],
    { expected: 'radial', uvScale, role: 'wall' },
  );

  const rimRings = [{ points: wallRing, z: z(spec.wallEndZ) }];
  const radius = spec.rolledEdgeRadius;
  for (let i = 1; i <= spec.rimArcSegments; i += 1) {
    const theta = (Math.PI / 2) * (i / spec.rimArcSegments);
    const inset = radius * (1 - Math.cos(theta));
    rimRings.push({ points: ring(inset), z: z(spec.wallEndZ + radius * Math.sin(theta)) });
  }
  for (const [inset, profileZ] of spec.rimChamfer) {
    rimRings.push({ points: ring(inset), z: z(profileZ) });
  }
  const rim = buildBandGeometry(rimRings, { expected: 'radial', uvScale, role: 'rim' });

  const face = buildBandGeometry(
    [{ points: ring(spec.panelInset), z: z(spec.faceZ) }],
    { expected: 'front', uvScale, role: 'face', centre: { x: 0, y: 0, z: z(spec.faceZ) } },
  );
  const back = buildBandGeometry(
    [{ points: wallRing, z: z(0) }],
    { expected: 'back', uvScale, role: 'back', centre: { x: 0, y: 0, z: z(0) } },
  );

  geometrySet.add(wall);
  geometrySet.add(rim);
  geometrySet.add(face);
  geometrySet.add(back);
  return { wall, rim, face, back };
}

function buildBankShellGeometries(spec, geometrySet) {
  const half = spec.faceSize / 2;
  const zOffset = spec.thickness / 2;
  const z = (profileZ) => profileZ - zOffset;
  const ring = (inset) => roundedRectPoints(half - inset, spec.cornerRadius - inset, spec.cornerSegments, spec.edgeSegments);
  const uvScale = spec.faceSize;
  const wallRing = ring(0);

  const wall = buildBandGeometry(
    [{ points: wallRing, z: z(0) }, { points: wallRing, z: z(spec.wallEndZ) }],
    { expected: 'radial', uvScale, role: 'wall' },
  );

  const rimRings = [{ points: wallRing, z: z(spec.wallEndZ) }];
  const radius = spec.rolledEdgeRadius;
  for (let i = 1; i <= spec.rimArcSegments; i += 1) {
    const theta = (Math.PI / 2) * (i / spec.rimArcSegments);
    const inset = radius * (1 - Math.cos(theta));
    rimRings.push({ points: ring(inset), z: z(spec.wallEndZ + radius * Math.sin(theta)) });
  }
  for (const [inset, profileZ] of spec.rimChamfer) {
    rimRings.push({ points: ring(inset), z: z(profileZ) });
  }
  const rim = buildBandGeometry(rimRings, { expected: 'radial', uvScale, role: 'rim' });

  const face = buildBandGeometry(
    [{ points: ring(spec.panelInset), z: z(spec.faceZ) }],
    { expected: 'front', uvScale, role: 'panel', centre: { x: 0, y: 0, z: z(spec.faceZ) } },
  );
  const back = buildBandGeometry(
    [{ points: wallRing, z: z(0) }],
    { expected: 'back', uvScale, role: 'back', centre: { x: 0, y: 0, z: z(0) } },
  );

  // Thin flat gold ring on the face plane (logo plaque only), just inside the
  // panel edge — the reference's blue face line becomes brand gold.
  const ringGeometry = buildBandGeometry(
    [
      { points: ring(spec.ring.insetStart), z: z(spec.faceZ) + spec.ring.raise },
      { points: ring(spec.ring.insetEnd), z: z(spec.faceZ) + spec.ring.raise },
    ],
    { expected: 'front', uvScale, role: 'accent-ring' },
  );

  geometrySet.add(wall);
  geometrySet.add(rim);
  geometrySet.add(face);
  geometrySet.add(back);
  geometrySet.add(ringGeometry);
  return { wall, rim, face, back, ring: ringGeometry };
}

/**
 * Raised classical bank icon: pediment roof + cornice overhang, four columns with
 * capitals and two base steps, every part a rounded bevelled extrusion in the
 * panel material so the fluted/dotted field continues across the relief. Built in
 * block-local coordinates (centred on the face, sitting on the panel plane).
 */
function buildBankIcon(context) {
  const { spec, faceSize, materials, geometrySet, panelZ } = context;
  const group = new THREE.Group();
  group.name = 'bank-icon';
  const unit = spec.width * faceSize;
  const centreY = spec.centerY * faceSize;
  const depth = spec.relief - spec.bevelThickness * 2;
  const parts = [];
  const shadowParts = [];
  let triangleCount = 0;

  const rect = (x0, x1, y0, y1) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];

  const add = (name, points) => {
    const worldPoints = points.map(([x, y]) => new THREE.Vector2(x * unit, y * unit + centreY));
    const geometry = buildExtrudedPart(worldPoints, {
      cornerRadius: spec.cornerRadius,
      cornerSegments: spec.cornerSegments,
      depth,
      bevelSize: spec.bevelSize,
      bevelThickness: spec.bevelThickness,
      bevelSegments: spec.bevelSegments,
      uvScale: faceSize,
    });
    geometrySet.add(geometry);
    const mesh = new THREE.Mesh(geometry, [materials.bankIcon, materials.bankIconEdge]);
    mesh.name = 'bank-icon-' + name;
    mesh.position.set(0, 0, panelZ);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData = { role: 'bank icon relief (' + name + ')' };
    group.add(mesh);
    const triangles = triangleCountOf(geometry);
    triangleCount += triangles;
    parts.push({ name: mesh.name, role: 'bank icon relief (' + name + ')', material: materials.bankIcon.name + '+' + materials.bankIconEdge.name, triangles });

    // Dark separation plate just above the panel: the expanded flat outline peeks
    // out around the raised shape and reads as a groove/shadow, so the classical
    // bank stays legible at page scale (the relief itself is only 24 mm tall).
    const centroid = centroidOf(worldPoints);
    const shadowPoints = worldPoints.map(
      (point) => new THREE.Vector2(
        centroid.x + (point.x - centroid.x) * spec.shadowScale,
        centroid.y + (point.y - centroid.y) * spec.shadowScale,
      ),
    );
    const shadowGeometry = buildEmblemCap(shadowPoints, panelZ + spec.shadowLift, faceSize);
    geometrySet.add(shadowGeometry);
    const shadowMesh = new THREE.Mesh(shadowGeometry, materials.bankShadow);
    shadowMesh.name = mesh.name + '-shadow';
    shadowMesh.castShadow = false;
    shadowMesh.receiveShadow = false;
    shadowMesh.userData = { role: 'bank icon shadow plate (' + name + ')' };
    group.add(shadowMesh);
    const shadowTriangles = triangleCountOf(shadowGeometry);
    triangleCount += shadowTriangles;
    shadowParts.push({ name: shadowMesh.name, role: 'bank icon shadow plate', material: materials.bankShadow.name, triangles: shadowTriangles });
  };

  // Pediment: sloped roof (slightly flattened apex) over a cornice with overhang.
  add('pediment-roof', [[-0.47, 0.13], [0.47, 0.13], [0, 0.46]]);
  add('pediment-cornice', rect(-0.5, 0.5, 0.05, 0.14));
  const columnXs = [-0.36, -0.12, 0.12, 0.36];
  columnXs.forEach((cx, index) => add('column-' + (index + 1), rect(cx - 0.0425, cx + 0.0425, -0.31, 0.02)));
  columnXs.forEach((cx, index) => add('capital-' + (index + 1), rect(cx - 0.065, cx + 0.065, 0.005, 0.06)));
  add('base-step-upper', rect(-0.42, 0.42, -0.4, -0.31));
  add('base-step-lower', rect(-0.47, 0.47, -0.5, -0.4));

  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const measuredWidth = bounds.max.x - bounds.min.x;

  return {
    group,
    parts,
    shadowParts,
    shapeCount: parts.length,
    shadowShapeCount: shadowParts.length,
    relief: spec.relief,
    width: unit,
    measuredWidth: Math.round(measuredWidth * 1000) / 1000,
    measuredHeight: Math.round((bounds.max.y - bounds.min.y) * 1000) / 1000,
    triangleCount,
  };
}

/* -------------------------------------------------------------- collectors */

function createRecorder() {
  const parts = [];
  return {
    parts,
    add(mesh, role, block) {
      const entry = {
        name: mesh.name,
        role,
        material: mesh.material && mesh.material.name ? mesh.material.name : '',
        triangles: triangleCountOf(mesh.geometry),
      };
      if (block !== undefined && block !== null) entry.block = block;
      parts.push(entry);
    },
    aggregate(name, role, material, triangles, block) {
      const entry = { name, role, material, triangles };
      if (block !== undefined && block !== null) entry.block = block;
      parts.push(entry);
    },
  };
}

function addMesh(parent, geometry, material, name, role, recorder, block, options = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = options.castShadow === undefined ? true : options.castShadow;
  mesh.receiveShadow = options.receiveShadow === undefined ? true : options.receiveShadow;
  mesh.userData = { role };
  parent.add(mesh);
  if (recorder) recorder.add(mesh, role, block);
  return mesh;
}

function pushBoxCorners(points, box) {
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) points.push(x, y, z);
    }
  }
}

function boundsObject(box) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    center: { x: center.x, y: center.y, z: center.z },
    size: { x: size.x, y: size.y, z: size.z },
  };
}

/**
 * Camera fit points: the composition box corners plus a narrow strip of the
 * surface front edge / rounded lip around the composition centre. The contract
 * requires the surface extents in `fitPoints` so the page frames blocks + table
 * lip; using a narrow strip (rather than the slab's full width) keeps the lip in
 * frame without letting its near corners dominate the fit and shrink the blocks.
 */
function aggregateStats(group, recorder) {
  const stats = { triangles: 0, meshes: 0, drawCalls: 0, parts: recorder.parts };
  group.traverse((object) => {
    if (object.isMesh) {
      stats.meshes += 1;
      stats.triangles += triangleCountOf(object.geometry);
    }
  });
  stats.triangles = Math.round(stats.triangles);
  stats.drawCalls = stats.meshes;
  stats.partsTriangles = Math.round(recorder.parts.reduce((sum, part) => sum + part.triangles, 0));
  return stats;
}

/* ---------------------------------------------------- scenes: plates + link */

const smooth01 = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/**
 * Scene `plates` (catalogue 03): seven upright silver brand plates. They slide
 * in from the right one after another (leftmost first, so each plate lands in
 * front of the parked one and parallel plates never cross) into a cluster that
 * faces 45 degrees to the right, then every plate rotates about its OWN origin
 * and spreads along the SAME 45 degree gather line into a row. `open` and
 * `cluster` share the 1:1 direction vector; only the spacing is larger in
 * `open`. The camera never moves.
 */
export const PLATES_SPEC = Object.freeze({
  count: 7,
  /** One loop in seconds (the last ~2.5 s hold the expanded row). */
  cycle: 11,
  enter: Object.freeze({ delayStep: 0.35, duration: 1.8, fromDx: 7.5 }),
  expand: Object.freeze({ start: 4.6, delayStep: 0.14, duration: 2.6 }),
  cluster: Object.freeze({ stepX: 0.24, stepZ: 0.24, yawDeg: 45 }),
  /** Same 1:1 direction as `cluster.stepX:cluster.stepZ`; larger spacing only. */
  open: Object.freeze({ stepX: 0.46, stepZ: 0.46, yawDeg: 45 }),
});

/**
 * Pure plate pose at time `t` seconds (clamped to one loop). The entrance is
 * ordered leftmost-first: plate i starts after i * delayStep and slides in from
 * +X while the already-parked plate i-1 sits behind it along the gather line, so
 * no two plates ever interpenetrate at any t.
 */
export function platesPose(index, t, spec = PLATES_SPEC, spread = true) {
  const n = spec.count;
  const c = (n - 1) / 2;
  const time = Math.min(spec.cycle, Math.max(0, t));
  const cl = spec.cluster;
  const op = spec.open;
  const cx = (index - c) * cl.stepX;
  const cz = (index - c) * cl.stepZ;
  const enterDelay = index * spec.enter.delayStep;
  const enter = easeOutCubic((time - enterDelay) / spec.enter.duration);
  const expand = spread ? smooth01((time - spec.expand.start - index * spec.expand.delayStep) / spec.expand.duration) : 0;
  const ox = (index - c) * op.stepX;
  const oz = (index - c) * op.stepZ;
  const x = (cx + (1 - enter) * spec.enter.fromDx) * (1 - expand) + ox * expand;
  const z = cz * (1 - expand) + oz * expand;
  const yawDeg = cl.yawDeg * (1 - expand) + op.yawDeg * expand;
  return { x, z, yawDeg, enter, expand };
}

/**
 * Scene `link` (catalogue 04): logo block + bank block, dotted particle rays.
 * Rev22: the blocks rest directly on the satin column platform (no pillars), so
 * only the X/Z placement is authored — the Y is solved from each block's
 * real world bounding box so its lowest point touches the platform top.
 */
export const LINK_SPEC = Object.freeze({
  tiltDownDeg: 0,
  yawRightDeg: 45,
  logo: Object.freeze({ x: 1.0, z: 1.0 }),
  bank: Object.freeze({ x: -1.0, z: -1.0 }),
  /** Number of rays and particles per ray (odd => one centre particle). */
  rays: Object.freeze({ count: 56, particles: 27 }),
  colors: Object.freeze({ end: 0x6b4f0a, mid: 0xc79a1a, bright: 0xfff0a8 }),
  /** Brightness weight by distance (in particles) from the ray centre. */
  weights: Object.freeze([1, 1, 0.58, 0.4]),
  sizes: Object.freeze({ end: 0.04, mid: 0.056, bright: 0.082 }),
  ringInset: 0.035,
});

function resampleClosed(points, count) {
  const lengths = [0];
  for (let i = 1; i <= points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i % points.length];
    lengths.push(lengths[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[lengths.length - 1];
  const out = [];
  let seg = 1;
  for (let k = 0; k < count; k += 1) {
    const s = (total * k) / count;
    while (seg < lengths.length - 1 && lengths[seg] < s) seg += 1;
    const a = points[(seg - 1) % points.length];
    const b = points[seg % points.length];
    const span = lengths[seg] - lengths[seg - 1] || 1;
    const f = (s - lengths[seg - 1]) / span;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

function buildRoundSprite(textureSet) {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = Math.max(0, Math.min(1, (1 - d) / 0.35));
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * a * (3 - 2 * a) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'logo-blocks-ray-sprite';
  texture.needsUpdate = true;
  textureSet.add(texture);
  return texture;
}

/* ------------------------------------------------------ satin column platform */

/**
 * Union of the composition mesh boxes over the sampled times, plus the per-time
 * box corner fit points. The platform and the contact shadows are excluded (they
 * are authored around the composition, not part of it).
 */
function sampleFitPoints(group, update, times) {
  const points = [];
  const box = new THREE.Box3();
  const one = new THREE.Box3();
  for (const t of times) {
    update(t);
    group.updateMatrixWorld(true);
    one.makeEmpty();
    group.traverse((object) => {
      if (object.isMesh && !/platform|shadow/.test(object.name)) one.expandByObject(object);
    });
    box.union(one);
    pushBoxCorners(points, one);
  }
  return { box, points };
}

/**
 * Derive the satin column platform layout from a composition footprint.
 *
 * The Columns deliverable column geometry is 600 px long (local Y) with a
 * 140 x 140 px cross section (local X/Z), 1 px = 1 world unit. Laid horizontal
 * (rotated -90 deg about Z) and scaled uniformly by `scale`, it runs along world
 * X, is `140 * scale` tall and its top face is `600 * scale` long by
 * `140 * scale` deep. `scale` is chosen so the composition footprint (+ margin)
 * fits the top face in both axes.
 */
function createPlatformSpec(platformSpec, footprintBox) {
  const p = platformSpec;
  const centreX = (footprintBox.min.x + footprintBox.max.x) / 2;
  const centreZ = (footprintBox.min.z + footprintBox.max.z) / 2;
  const needHalfX = Math.max(footprintBox.max.x - centreX, centreX - footprintBox.min.x) + p.marginXZ;
  const needHalfZ = Math.max(footprintBox.max.z - centreZ, centreZ - footprintBox.min.z) + p.marginXZ;
  const scale = Math.max((needHalfX * 2) / p.lengthPx, (needHalfZ * 2) / p.crossSectionPx);
  const halfLength = (p.lengthPx * scale) / 2;
  const halfDepth = (p.crossSectionPx * scale) / 2;
  const height = p.crossSectionPx * scale;
  return {
    columnId: p.columnId,
    materialId: p.materialId,
    source: './src/columns-model.js',
    footprint: p.footprint,
    height: p.height,
    heightPx: p.lengthPx,
    crossSectionPx: p.crossSectionPx,
    laidHorizontal: true,
    scale,
    topY: p.topY,
    centreX,
    centreZ,
    halfLength,
    halfDepth,
    heightWorldY: height,
    margin: p.marginXZ,
    fitsComposition: halfLength + 1e-9 >= needHalfX && halfDepth + 1e-9 >= needHalfZ,
  };
}

/**
 * Mount the shared column geometry as a scene's platform mesh. The mesh is the
 * real Columns deliverable geometry (userData.columnId = satin-large-long) and
 * the real satin material object from the loaded columns bank.
 */
function mountPlatformMesh(sceneModel, geometry, material) {
  const p = sceneModel.platform;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'logo-blocks-' + sceneModel.name + '-platform';
  // local +Y (the 600 px length) -> world +X; local +X (140 px) -> world -Y.
  mesh.rotation.z = -Math.PI / 2;
  // s53: columns geometry is COLUMN_GEOMETRY_RATIO x larger; shrink it so the on-screen look is unchanged.
  mesh.scale.setScalar(p.scale / COLUMN_GEOMETRY_RATIO);
  mesh.position.set(p.centreX, p.topY - (p.crossSectionPx / 2) * p.scale, p.centreZ);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData = {
    role: 'satin columns platform (' + p.columnId + ' laid horizontal)',
    columnId: p.columnId,
    laidHorizontal: true,
    scale: p.scale,
  };
  sceneModel.group.add(mesh);
  sceneModel.platform.mesh = mesh.name;
  sceneModel.group.updateMatrixWorld(true);
  return mesh;
}

/** Contact shadows pressed onto the platform top face (vertex-alpha geometry). */
function addPlatformShadows(root, recorder, geometrySet, materials, shadowSpec, name, centres) {
  const geometry = buildContactShadowGeometry(shadowSpec, geometrySet);
  const meshes = [];
  centres.forEach((centre, index) => {
    const mesh = new THREE.Mesh(geometry, materials.contactShadow);
    mesh.name = name + '-shadow-' + index;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    mesh.position.set(centre.x, shadowSpec.topY + shadowSpec.raise, centre.z);
    mesh.userData = { role: 'soft contact shadow on the satin column top' };
    root.add(mesh);
    recorder.add(mesh, 'soft contact shadow');
    meshes.push(mesh);
  });
  return meshes;
}

/** Fit points: the composition box corners + the platform top near/far edge probe. */
function buildPlatformFitPoints(box, platform, probeHalfWidth, points) {
  pushBoxCorners(points, box);
  const hw = Math.min(probeHalfWidth, platform.halfLength * 0.9);
  const nearZ = platform.centreZ + platform.halfDepth;
  const farZ = platform.centreZ - platform.halfDepth;
  points.push(platform.centreX - hw, platform.topY, farZ, platform.centreX + hw, platform.topY, farZ);
  points.push(platform.centreX - hw, platform.topY, nearZ, platform.centreX + hw, platform.topY, nearZ);
  return new Float32Array(points);
}

function finishPlayScene(scene, group, recorder, update, times, platform, probeHalfWidth) {
  const { box, points } = sampleFitPoints(group, update, times);
  update(times[times.length - 1]);
  group.updateMatrixWorld(true);
  box.min.y = platform.topY;
  scene.bounds = boundsObject(box);
  scene.fitPoints = buildPlatformFitPoints(box, platform, probeHalfWidth, points);
  scene.stats = aggregateStats(group, recorder);
  return scene;
}

/** Box of the current scene graph, excluding the platform / shadow meshes. */
function compositionBox(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  group.traverse((object) => {
    if (object.isMesh && !/platform|shadow/.test(object.name)) box.expandByObject(object);
  });
  return box;
}

function buildPlatesScene(context) {
  const { spec, materials, emblemTemplate, geometrySet } = context;
  const plates = PLATES_SPEC;
  const platformConfig = spec.platform;
  const root = new THREE.Group();
  root.name = 'logo-blocks-plates';
  const recorder = createRecorder();
  const shell = buildPlateShellGeometries(spec, geometrySet);
  const blocks = [];
  const centreY = platformConfig.topY + spec.faceSize / 2;
  for (let index = 0; index < plates.count; index += 1) {
    const group = new THREE.Group();
    group.name = 'brand-plate-' + index;
    const wall = addMesh(group, shell.wall, materials.frameSatin, group.name + '-wall', 'silver-grey satin middle frame', recorder, index);
    const rim = addMesh(group, shell.rim, materials.bankRim, group.name + '-rim', 'polished rim crest', recorder, index);
    const face = addMesh(group, shell.face, materials.bankFace, group.name + '-face', 'silver face panel', recorder, index);
    const back = addMesh(group, shell.back, materials.frameSatin, group.name + '-back', 'back plate', recorder, index, { castShadow: false });
    let emblemGroup = null;
    if (emblemTemplate) {
      emblemGroup = emblemTemplate.group.clone(true);
      emblemGroup.name = group.name + '-emblem';
      group.add(emblemGroup);
      recorder.aggregate(emblemGroup.name, 'TEKO arrow emboss', 'emblemSilver+emblemGraphite+socket', emblemTemplate.triangleCount, index);
    }
    root.add(group);
    blocks.push({ index, id: 'plate-' + index, group, mesh: wall, meshes: { wall, rim, face, back }, emblemGroup });
  }

  const shadows = [];
  const flags = { spread: true };
  const update = (t) => {
    for (const block of blocks) {
      const pose = platesPose(block.index, t, plates, flags.spread);
      block.group.position.set(pose.x, centreY, pose.z);
      block.group.rotation.set(0, degToRad(pose.yawDeg), 0);
      block.pose = pose;
      const shadow = shadows[block.index];
      if (shadow) shadow.position.set(pose.x, platformConfig.topY + spec.shadow.raise, pose.z);
    }
  };
  update(plates.cycle);
  const platform = createPlatformSpec(platformConfig, compositionBox(root));

  shadows.push(...addPlatformShadows(
    root,
    recorder,
    geometrySet,
    materials,
    { ...spec.shadow, topY: platform.topY },
    'logo-blocks-plates',
    blocks.map((block) => ({ x: block.group.position.x, z: block.group.position.z })),
  ));

  const scene = {
    name: 'plates',
    group: root,
    blocks,
    animation: { duration: plates.cycle, spec: plates },
    update,
    /** Spread on/off (default on); caller re-runs update(t) afterwards. */
    setSpread(on) { flags.spread = Boolean(on); },
    getSpread() { return flags.spread; },
    platform,
    emblem: emblemTemplate ? emblemDebug(emblemTemplate) : emptyEmblemDebug(spec, context.logoSource),
    shadows: shadows.map((mesh) => mesh.name),
  };
  return finishPlayScene(scene, root, recorder, update, [plates.expand.start - 0.2, 7, plates.cycle], platform, platformConfig.probeHalfWidth);
}

function buildLinkScene(context) {
  const { spec, materials, emblemTemplate, geometrySet, textureSet, platformSpec } = context;
  const link = LINK_SPEC;
  const root = new THREE.Group();
  root.name = 'logo-blocks-link';
  const recorder = createRecorder();
  const shell = buildBankShellGeometries(spec, geometrySet);
  const blocks = [];
  const euler = new THREE.Euler(degToRad(link.tiltDownDeg), degToRad(link.yawRightDeg), 0, 'YXZ');
  const platformTopY = platformSpec.platform.topY;

  const makeBlock = (id, place, index) => {
    const group = new THREE.Group();
    group.name = 'link-block-' + id;
    const wall = addMesh(group, shell.wall, materials.frameSatin, group.name + '-wall', 'satin metal middle frame', recorder, index);
    const rim = addMesh(group, shell.rim, materials.frameSatin, group.name + '-rim', 'satin metal frame edge', recorder, index);
    const panel = addMesh(group, shell.face, materials.coinFace, group.name + '-panel', 'coin-style satin face', recorder, index);
    const back = addMesh(group, shell.back, materials.frameSatin, group.name + '-back', 'back plate', recorder, index, { castShadow: false });
    const glow = addMesh(group, shell.ring, materials.goldGlow, group.name + '-gold-glow', 'theme-gold glow ring between face and frame', recorder, index, { receiveShadow: false });
    group.position.set(place.x, 0, place.z);
    group.rotation.copy(euler);
    root.add(group);
    return { index, id, group, mesh: wall, panelMesh: panel, accentMesh: glow, meshes: { wall, rim, panel, back, glow } };
  };

  const logoBlock = makeBlock('logo', link.logo, 0);
  const bankBlock = makeBlock('bank', link.bank, 1);
  blocks.push(logoBlock, bankBlock);
  if (emblemTemplate) {
    const emblemGroup = emblemTemplate.group.clone(true);
    emblemGroup.name = 'link-block-logo-emblem';
    logoBlock.group.add(emblemGroup);
    logoBlock.emblemGroup = emblemGroup;
    recorder.aggregate(emblemGroup.name, 'TEKO arrow emboss', 'emblemSilver+emblemGraphite+socket', emblemTemplate.triangleCount, 0);
  }
  const icon = buildBankIcon({
    spec: spec.bankIcon,
    faceSize: spec.faceSize,
    materials,
    geometrySet,
    panelZ: spec.faceZ - spec.thickness / 2,
  });
  bankBlock.group.add(icon.group);
  bankBlock.bankIcon = { shapeCount: icon.shapeCount };
  recorder.aggregate('link-block-bank-icon', 'classical bank icon relief', 'bankIcon+bankIconEdge',
    icon.parts.reduce((sum, part) => sum + part.triangles, 0), 1);

  // Rev22: no pillars — seat every block so its lowest point is exactly
  // the satin column top (measured from the real world box, so the yaw
  // cannot leave a float or a sink).
  for (const block of blocks) {
    block.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(block.group);
    block.group.position.y += platformTopY - box.min.y;
    block.group.updateMatrixWorld(true);
    block.seatOffset = block.group.position.y;
  }
  root.updateMatrixWorld(true);

  // Dotted particle rays: logo block BACK edge ring -> bank block FRONT edge ring.
  const half = spec.faceSize / 2 - link.ringInset;
  const ring = roundedRectPoints(half, spec.cornerRadius - link.ringInset, spec.cornerSegments, spec.edgeSegments);
  const ringPoints = resampleClosed(ring, link.rays.count);
  const backZ = -spec.thickness / 2 - 0.004;
  const frontZ = spec.crestZ - spec.thickness / 2 + 0.004;
  const worldPoint = (block, p, z) => new THREE.Vector3(p.x, p.y, z).applyMatrix4(block.group.matrixWorld);
  const particles = link.rays.particles;
  const centre = (particles - 1) / 2;
  const tiers = { end: [], mid: [], bright: [] };
  const lines = [];
  for (let k = 0; k < ringPoints.length; k += 1) {
    const a = worldPoint(logoBlock, ringPoints[k], backZ);
    const b = worldPoint(bankBlock, ringPoints[k], frontZ);
    lines.push({ from: a, to: b });
    for (let j = 0; j < particles; j += 1) {
      const u = j / (particles - 1);
      const d = Math.round(Math.abs(j - centre));
      const weight = d < link.weights.length ? link.weights[d] : 0;
      const tier = weight >= 1 ? 'bright' : weight > 0 ? 'mid' : 'end';
      // the outer particles fade toward the darkest tone at the very ends
      const fade = 0.55 + 0.45 * Math.min(1, Math.min(u, 1 - u) * 6);
      tiers[tier].push({
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        z: a.z + (b.z - a.z) * u,
        w: tier === 'end' ? fade : 1,
      });
    }
  }
  const sprite = buildRoundSprite(textureSet);
  const rays = new THREE.Group();
  rays.name = 'link-rays';
  const tierCounts = {};
  for (const tier of ['end', 'mid', 'bright']) {
    const list = tiers[tier];
    const positions = new Float32Array(list.length * 3);
    const colors = new Float32Array(list.length * 3);
    const base = workingColorFromHex(link.colors[tier]);
    list.forEach((p, i) => {
      positions.set([p.x, p.y, p.z], i * 3);
      const c = base.clone().multiplyScalar(p.w);
      colors.set([c.r, c.g, c.b], i * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometrySet.add(geometry);
    const material = new THREE.PointsMaterial({
      name: 'logo-blocks-ray-' + tier,
      size: link.sizes[tier],
      sizeAttenuation: true,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    materials['ray_' + tier] = material;
    const points = new THREE.Points(geometry, material);
    points.name = 'link-rays-' + tier;
    points.frustumCulled = false;
    points.renderOrder = 4;
    points.userData = { role: 'particle rays (' + tier + ')' };
    rays.add(points);
    tierCounts[tier] = list.length;
  }
  root.add(rays);

  const platform = createPlatformSpec(platformSpec.platform, compositionBox(root));
  const shadows = addPlatformShadows(
    root,
    recorder,
    geometrySet,
    materials,
    { ...platformSpec.shadow, topY: platform.topY },
    'logo-blocks-link',
    blocks.map((block) => ({ x: block.group.position.x, z: block.group.position.z })),
  );

  const scene = {
    name: 'link',
    group: root,
    blocks,
    rays: { group: rays, count: ringPoints.length, particlesPerRay: particles, tiers: tierCounts, lines },
    platform,
    shadows: shadows.map((mesh) => mesh.name),
    emblem: emblemTemplate ? emblemDebug(emblemTemplate) : emptyEmblemDebug(spec, context.logoSource),
  };
  return finishPlayScene(scene, root, recorder, () => {}, [0], platform, platformSpec.platform.probeHalfWidth);
}


/* ----------------------------------------------------------- debug helpers */

function emblemDebug(emblem) {
  const tones = new Set(emblem.shapes.map((shape) => shape.tone));
  return {
    source: emblem.source,
    shapeCount: emblem.shapes.length,
    tone: 'silver-graphite',
    twoTone: tones.size > 1,
    shapes: emblem.shapes.map((shape) => ({ fill: shape.fill, tone: shape.tone, triangles: Math.round(shape.triangles) })),
    width: emblem.width,
    height: emblem.height,
    relief: emblem.relief,
    triangleCount: Math.round(emblem.triangleCount),
    parts: emblem.parts,
  };
}

function emptyEmblemDebug(spec, source) {
  return {
    source: source || LOGO_SOURCE_PATH,
    shapeCount: 0,
    tone: 'silver-graphite',
    twoTone: false,
    shapes: [],
    width: spec.emblem.width * spec.faceSize,
    relief: spec.emblem.relief,
    triangleCount: 0,
    parts: [],
    note: 'logo SVG not supplied to createLogoBlocksModel',
  };
}

function textureDebug(texture) {
  if (!texture) return null;
  const image = texture.image || {};
  return {
    name: texture.name,
    size: [image.width || null, image.height || null],
    encoding: texture.encoding === THREE.sRGBEncoding ? 'sRGB' : 'linear',
    wrap: texture.wrapS === THREE.RepeatWrapping ? 'repeat' : 'clamp',
  };
}

function materialDebug(key, material, spec) {
  const maps = [];
  for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
    if (material[slot]) maps.push({ slot, ...textureDebug(material[slot]) });
  }
  return {
    name: material.name,
    type: material.type,
    colorSrgb: spec && spec.color !== undefined ? hexString(spec.color) : null,
    specColorHex: material.userData && material.userData.specColorHex ? material.userData.specColorHex : null,
    metalness: material.metalness === undefined ? null : material.metalness,
    roughness: material.roughness === undefined ? null : material.roughness,
    envMapIntensity: material.envMapIntensity === undefined ? null : material.envMapIntensity,
    emissiveSrgb: spec && spec.emissive !== undefined ? hexString(spec.emissive) : null,
    emissiveIntensity: material.emissiveIntensity === undefined ? null : material.emissiveIntensity,
    maps,
    bakedLighting: false,
    role: spec && spec.role ? spec.role : '',
  };
}

function extraSceneDebug(scene) {
  const out = {
    name: scene.name,
    blockCount: scene.blocks.length,
    blocks: scene.blocks.map((block) => ({
      index: block.index,
      id: block.id,
      position: { x: block.group.position.x, y: block.group.position.y, z: block.group.position.z },
      rotationDeg: {
        x: Math.round((block.group.rotation.x / DEG) * 1000) / 1000,
        y: Math.round((block.group.rotation.y / DEG) * 1000) / 1000,
        z: Math.round((block.group.rotation.z / DEG) * 1000) / 1000,
      },
    })),
    bounds: scene.bounds,
    stats: scene.stats,
    animation: scene.animation ? { duration: scene.animation.duration } : null,
    rays: scene.rays ? { count: scene.rays.count, particlesPerRay: scene.rays.particlesPerRay, tiers: scene.rays.tiers } : null,
    platform: scene.platform || null,
    shadows: Array.isArray(scene.shadows) ? scene.shadows : [],
  };
  if (scene.bankIcon) out.bankIcon = { shapeCount: scene.bankIcon.shapeCount };
  return out;
}

/* ------------------------------------------------------------------ model */

function createMaterials() {
  const materials = {};
  for (const [key, config] of Object.entries(MATERIAL_SPEC)) {
    if (config.kind === 'shadow') {
      const material = new THREE.MeshBasicMaterial({
        name: 'logo-blocks-' + key,
        color: workingColorFromHex(config.color),
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      material.userData = { role: config.role, specColorHex: hexString(config.color) };
      materials[key] = material;
      continue;
    }
    const material = new THREE.MeshStandardMaterial({
      name: 'logo-blocks-' + key,
      color: workingColorFromHex(config.color),
      metalness: config.metalness === undefined ? 0 : config.metalness,
      roughness: config.roughness === undefined ? 1 : config.roughness,
      envMapIntensity: config.envMapIntensity === undefined ? 1 : config.envMapIntensity,
      dithering: true,
    });
    if (config.colorScale !== undefined && config.colorScale !== 1) material.color.multiplyScalar(config.colorScale);
    if (config.emissive !== undefined) {
      material.emissive = workingColorFromHex(config.emissive);
      material.emissiveIntensity = config.emissiveIntensity === undefined ? 1 : config.emissiveIntensity;
    }
    material.userData = {
      role: config.role,
      specColorHex: hexString(config.color),
      procedural: true,
      local: true,
    };
    if (key === 'coinFace') {
      const physical = new THREE.MeshPhysicalMaterial({
        name: material.name,
        color: material.color.clone(),
        metalness: config.metalness,
        roughness: config.roughness,
        clearcoat: 0.12,
        clearcoatRoughness: 0.34,
        envMapIntensity: config.envMapIntensity,
      });
      physical.userData = material.userData;
      material.dispose();
      materials[key] = physical;
      continue;
    }
    materials[key] = material;
  }
  return materials;
}

/**
 * Create both logo-block compositions.
 *
 * @param {object} options
 * @param {string} options.logoSvgText  UTF-8 text of assets/logo-blocks/teko2_icon.svg
 * @param {string} [options.logoSourcePath] provenance path reported by getDebug()
 * @param {number} [options.seed] override for the fixed SEED (QA only; keep default)
 * @param {string} [options.quality] 'hero' (default) or 'preview'; geometry is
 *   fixed, so both qualities are byte-identical after the Rev22 scene removal.
 * @returns {object} model
 */
export function createLogoBlocksModel(options = {}) {
  const seed = options.seed === undefined || options.seed === null ? SEED : Number(options.seed) >>> 0;
  const quality = options.quality === undefined ? 'hero' : String(options.quality);
  const logoSvgText = typeof options.logoSvgText === 'string' ? options.logoSvgText : '';
  const logoSource = options.logoSourcePath || LOGO_SOURCE_PATH;

  const warnings = [];
  const geometrySet = new Set();
  const textureSet = new Set();
  const materials = createMaterials();

  let parsedLogo = null;
  let plateEmblem = null;
  let linkEmblem = null;
  if (logoSvgText) {
    try {
      parsedLogo = parseTekoLogoSvg(logoSvgText, { curveSegments: PLATE_SPEC.emblem.curveSegments });
      plateEmblem = buildEmblem({
        parsed: parsedLogo,
        spec: PLATE_SPEC.emblem,
        faceSize: PLATE_SPEC.faceSize,
        surfaceZ: PLATE_SPEC.faceZ - PLATE_SPEC.thickness / 2,
        materials,
        geometrySet,
        source: logoSource,
      });
      linkEmblem = buildEmblem({
        parsed: parsedLogo,
        spec: LINK_BLOCK_SPEC.emblem,
        faceSize: LINK_BLOCK_SPEC.faceSize,
        surfaceZ: LINK_BLOCK_SPEC.faceZ - LINK_BLOCK_SPEC.thickness / 2,
        materials,
        geometrySet,
        source: logoSource,
      });
    } catch (error) {
      warnings.push('emblem export failed: ' + (error && error.message ? error.message : error));
      parsedLogo = null;
      plateEmblem = null;
      linkEmblem = null;
    }
  } else {
    warnings.push('no logo SVG source supplied; the logo blocks are built without the TEKO emblem');
  }

  const platesScene = buildPlatesScene({
    spec: PLATE_SPEC,
    materials,
    emblemTemplate: plateEmblem,
    geometrySet,
    logoSource,
  });
  const linkScene = buildLinkScene({
    spec: LINK_BLOCK_SPEC,
    platformSpec: PLATE_SPEC,
    materials,
    emblemTemplate: linkEmblem,
    geometrySet,
    textureSet,
    logoSource,
  });

  let platformAttachment = null;

  const model = {
    version: MODEL_VERSION,
    seed,
    quality,
    spec: { plates: PLATE_SPEC, link: LINK_BLOCK_SPEC },
    materials,
    logo: {
      source: logoSource,
      pngPath: LOGO_PNG_PATH,
      shapeCount: parsedLogo ? parsedLogo.shapes.length : 0,
      fills: parsedLogo ? Array.from(new Set(parsedLogo.shapes.map((shape) => shape.fill))) : [],
      bbox: parsedLogo ? parsedLogo.bbox : null,
    },
    scenes: { plates: platesScene, link: linkScene },
    warnings,
    /**
     * Mount the real Columns deliverable column as each scene's platform.
     *
     * `columnBank` is the object resolved by \`loadColumnBank()\` in
     * src/columns-model.js (read-only import on the page). The satin material
     * object from that bank is reused verbatim (same maps/params — it is not
     * rebuilt), and the \`satin-large-long\` column geometry (600 px long,
     * 140 x 140 px cross-section) is kept while the other 26 column geometries
     * are disposed. The platform mesh is rotated -90 deg about Z so its length
     * runs along world X with its top face at PLATE_SPEC.platform.topY.
     *
     * @param {object} columnBank result of loadColumnBank()
     * @returns {{columnId:string, material:object, materialName:string, geometry:object, meshes:object}}
     */
    attachColumnPlatforms(columnBank) {
      if (platformAttachment) return platformAttachment;
      if (!columnBank || !columnBank.materials || !columnBank.materials.satin) {
        throw new Error('attachColumnPlatforms requires the columns bank resolved by loadColumnBank() (materials.satin missing)');
      }
      const columns = createColumns(columnBank, { quality: 'hero', patternDivisor: COLUMN_GEOMETRY_RATIO });
      const column = columns.columnsById[PLATE_SPEC.platform.columnId];
      if (!column) throw new Error('the columns bank has no "' + PLATE_SPEC.platform.columnId + '" column');
      const geometry = column.mesh.geometry;
      // Keep only the satin-large-long geometry; free the other 26.
      for (const other of columns.columns) {
        if (other === column) continue;
        try {
          other.mesh.geometry.dispose();
        } catch (error) {
          /* best effort */
        }
      }
      geometrySet.add(geometry);
      const material = columnBank.materials.satin;
      const meshes = {};
      for (const [key, sceneModel] of Object.entries({ plates: platesScene, link: linkScene })) {
        if (!sceneModel.platform) continue;
        const mesh = mountPlatformMesh(sceneModel, geometry, material);
        meshes[key] = mesh;
        const parts = sceneModel.stats.parts.concat([{
          name: mesh.name,
          role: 'satin columns platform',
          material: material.name,
          triangles: Math.round(triangleCountOf(geometry)),
        }]);
        sceneModel.stats = aggregateStats(sceneModel.group, { parts });
      }
      platformAttachment = {
        columnId: PLATE_SPEC.platform.columnId,
        material,
        materialName: material.name,
        geometry,
        meshes,
        columns,
      };
      return platformAttachment;
    },
    getDebug() {
      return {
        version: MODEL_VERSION,
        seed,
        quality,
        logo: {
          source: logoSource,
          pngPath: LOGO_PNG_PATH,
          shapeCount: parsedLogo ? parsedLogo.shapes.length : 0,
          fills: parsedLogo ? Array.from(new Set(parsedLogo.shapes.map((shape) => shape.fill))) : [],
          bbox: parsedLogo
            ? {
                width: parsedLogo.bbox.width,
                height: parsedLogo.bbox.height,
                minX: parsedLogo.bbox.minX,
                minY: parsedLogo.bbox.minY,
                maxX: parsedLogo.bbox.maxX,
                maxY: parsedLogo.bbox.maxY,
              }
            : null,
        },
        scenes: {
          plates: extraSceneDebug(platesScene),
          link: extraSceneDebug(linkScene),
        },
        platform: {
          columnId: PLATE_SPEC.platform.columnId,
          materialId: PLATE_SPEC.platform.materialId,
          source: PLATE_SPEC.platform.source || './src/columns-model.js',
          attached: Boolean(platformAttachment),
          materialName: platformAttachment ? platformAttachment.materialName : null,
          meshes: platformAttachment
            ? Object.fromEntries(Object.entries(platformAttachment.meshes).map(([key, mesh]) => [key, { name: mesh.name, columnId: mesh.userData.columnId, laidHorizontal: mesh.userData.laidHorizontal, scale: mesh.userData.scale }]))
            : {},
          scenes: {
            plates: platesScene.platform,
            link: linkScene.platform,
          },
        },
        camera: CAMERA_SPEC,
        materials: Object.fromEntries(
          Object.entries(materials).map(([key, material]) => [key, materialDebug(key, material, MATERIAL_SPEC[key])]),
        ),
        totals: {
          triangles: platesScene.stats.triangles + linkScene.stats.triangles,
          meshes: platesScene.stats.meshes + linkScene.stats.meshes,
          geometries: geometrySet.size,
          textures: textureSet.size,
        },
        warnings: warnings.slice(),
      };
    },
    dispose() {
      for (const geometry of geometrySet) {
        try {
          geometry.dispose();
        } catch (error) {
          /* best effort */
        }
      }
      for (const texture of textureSet) {
        try {
          texture.dispose();
        } catch (error) {
          /* best effort */
        }
      }
      for (const material of Object.values(materials)) {
        try {
          material.dispose();
        } catch (error) {
          /* best effort */
        }
      }
    },
  };

  return model;
}
