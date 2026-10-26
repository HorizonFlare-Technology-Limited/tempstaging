/**
 * tekoanimation — Currency Blocks model (CONTRACT.md §2).
 *
 * FIVE horizontal rounded-square currency blocks arranged in a vertical totem.
 * Both layouts are STACKED: the five flat plates always sit one above another on
 * the vertical axis (Y), each top face up, with air gaps. There is no flat-row
 * layout any more (v2.0.0 retired it): the layouts differ only in the horizontal
 * offset profile of the totem — "vertical" is the canonical plumb fig3 totem, and
 * "horizontal" is the same vertical stack fanned progressively along X (a
 * horizontal-direction stack), so both read as the reference's stacked object.
 *
 * The plates are extruded, heavily bevelled rounded squares of glossy black metal,
 * now genuinely thick (0.26 world units, fig3); each top face carries one currency
 * symbol from the project's Lexend variable font
 * (assets/fonts/Lexend-Variable.ttf, loaded through the FontFace API — no PNG
 * glyphs, no page-CSS dependency). The symbol inlay is centred on the top face in
 * x and z (v2: the old +Z forward offset that pushed the glyph toward the viewer
 * is gone) and its glyph is centred from the font's ink metrics, not its em box.
 *
 * Index 0 is the top block. Both layouts share one "gather and settle"
 * choreography (TIMELINE_SPEC): a loose intro, a bottom-up gather into a flush
 * puck, a tight hold and a top-down settle onto the resting fig3 arrangement.
 * After TIMELINE_SPEC.duration the pose is exactly the rest pose (no idle float).
 *
 * Determinism: every procedural choice (hairline wobble, glyph micro-shading,
 * per-block pose) comes from one seeded mulberry32 stream with a fixed seed; there
 * is no unseeded randomness, no time-of-day input, no network and no image asset in this
 * module. blockPose() is a pure function of (layout, index, seconds), so static
 * captures are byte-identical across reloads.
 *
 * Public API (frozen for ./currency-blocks-preview.js):
 *   MODEL_VERSION, BLOCK_COUNT, SEED, FONT_SPEC, BLOCK_SPEC, SYMBOL_SPEC,
 *   CURRENCY_SPECS, LAYOUT_SPEC, TIMELINE_SPEC, CAMERA_SPEC, MATERIAL_SPEC,
 *   LAYOUTS, easeInOutCubic(), easeOutBack(), loadLexendFont(),
 *   buildBlockGeometry(), blockPose(), createCurrencyBlocksModel()
 *
 * createSeededRandom() is exported as a small deterministic utility (maintained
 * from the retired stacked model, which this page replaces); everything else
 * (canvas helpers, glyph masks, texture painters, pose checks) is internal.
 */

import * as THREE from 'three';

/** Human-readable module version (mirrored by the page QA surface). */
export const MODEL_VERSION = '2.0.0';

/** The collection is exactly five currency blocks (CONTRACT §2). */
export const BLOCK_COUNT = 5;

/** One fixed seed for every procedural decision in the model. */
export const SEED = 0x2f6d1b93;

/**
 * Lexend is the project typeface for the block symbols. It is loaded through the
 * FontFace API so the model never depends on page CSS. All five required glyphs
 * are present in the shipped variable font (verified from the TTF cmap: £ U+00A3,
 * $ U+0024, € U+20AC, ¥ U+00A5, ₽ U+20BD); no glyph composition is needed.
 */
export const FONT_SPEC = Object.freeze({
  family: 'TEKOCurrencyBlocksLexend',
  cssFamily: 'Lexend',
  weight: 600,
  weightRange: '100 900',
  url: new URL('../assets/fonts/Lexend-Variable.ttf', import.meta.url).href,
});

/**
 * Block proportions (world units).
 *  - size 1.6 × 1.6 rounded square, corner radius 0.22 (large, 13.75 % of a side)
 *  - thickness 0.26 including the two chamfered bevel rings. This is the v2
 *    "reference thick plate": measuring the fig3 render (K:\HFWorkspace\refs\
 *    round5\currency-thickness.png) against its own projection gives a visible
 *    side-wall height of ≈0.257 world-screen units, i.e. a plate thickness of
 *    ≈0.27 at the reference elevation; 0.26 sits inside the requested 0.22–0.28
 *    band and is the documented value used everywhere in this model and page
 *    (the footprint stays 1.6 × 1.6).
 *  - bevel: 0.026 deep × 0.020 inset, 4 segments (bright polished chamfer). Scaled
 *    with the thickness to keep the fig3 rounded-over edge proportion (~10 % of
 *    the plate thickness) instead of the hairline chamfer of the old 0.09 plate.
 *  - 18 curve segments per rounded corner: smooth silhouette.
 */
export const BLOCK_SPEC = Object.freeze({
  size: 1.6,
  thickness: 0.26,
  radius: 0.22,
  bevelSize: 0.02,
  bevelThickness: 0.026,
  bevelSegments: 4,
  curveSegments: 18,
  steps: 1,
});

/**
 * Symbol inlay on the top face.
 *  - maxHeight 1.0 (62.5 % of the block side), maxWidth 1.3 (81 %): the glyph is
 *    fitted by whichever limit binds first (all five Lexend currency glyphs are
 *    height-bound), then centred on the inlay plane. v2 grows the glyph from 0.78
 *    to 1.0 to match the reference's large inlays.
 *  - forwardOffset 0: the inlay sits exactly on the top-face centre. v1 pushed it
 *    +0.34 toward the viewer to dodge the plate above at a 38° camera; v2 centres
 *    it as requested and lowers the fixed camera elevation to 30° so a centred
 *    glyph is never clipped by the plate above (the model verifies that with its
 *    `symbolClearance` self-check at the rest pose).
 *  - the inlay is a 1.30 × 1.30 alpha-tested metal decal raised 0.0011 above the
 *    top face; its 768² albedo/normal maps are generated from the Lexend glyph and
 *    the glyph's INK bounding box (font actualBoundingBox metrics / alpha trim) is
 *    what gets centred — not the em box, whose asymmetric side bearings are what
 *    make a baseline-centred glyph look off-centre.
 */
export const SYMBOL_SPEC = Object.freeze({
  decalSize: 1.3,
  maxHeight: 1.0,
  maxWidth: 1.3,
  forwardOffset: 0,
  raise: 0.0011,
  textureSize: 768,
  bevelPx: 8,
  reliefStrength: 7.2,
  albedoInterior: 242,
  albedoBevel: 96,
});

/** Index order: vertical top → bottom (CONTRACT §2). */
export const CURRENCY_SPECS = Object.freeze([
  Object.freeze({ id: 'gbp', code: 'GBP', name: 'Pound sterling', symbol: '£', glyph: '£' }),
  Object.freeze({ id: 'usd', code: 'USD', name: 'US dollar', symbol: '$', glyph: '$' }),
  Object.freeze({ id: 'eur', code: 'EUR', name: 'Euro', symbol: '€', glyph: '€' }),
  Object.freeze({ id: 'jpy', code: 'JPY', name: 'Japanese yen', symbol: '¥', glyph: '¥' }),
  Object.freeze({ id: 'rub', code: 'RUB', name: 'Russian ruble', symbol: '₽', glyph: '₽' }),
]);

/**
 * Frozen layout numbers (v2.0.0).
 *
 * BOTH layouts are the reference's stacked composition: five flat plates on the
 * vertical (Y) arrangement axis, one above another with air gaps. The retired v1
 * "horizontal row" (X arrangement axis) is gone. The layouts differ only in the
 * horizontal profile of the totem:
 *
 *  - `vertical`   — the canonical plumb fig3 totem: every plate sits on the same
 *                   vertical line with the accepted ±3–4° fig3 attitude.
 *  - `horizontal` — the SAME vertical stack fanned progressively along X: each
 *                   plate is offset 0.62 world units further right than the one
 *                   above it (so the totem leans/fans horizontally while staying a
 *                   vertical stack), with the per-plate yaw following the fan.
 *                   This is the documented v2 interpretation of the request "make
 *                   the horizontal direction a stacked / vertically arranged
 *                   composition, not a flat row": the blocks stay horizontally
 *                   oriented (flat, top face up) and vertically stacked; only the
 *                   totem's horizontal direction changes.
 *
 * Axis position: vertical Y `pitch * (2 - i)` (index 0 = top). Offsets are added on
 * top: x/z lateral, yaw/pitch/roll attitude.
 *  - scatterPitch + scatterOffsets: the loose opening totem.
 *  - tightPitch, zero offsets: the flush puck (gap = tightPitch − thickness).
 *  - restPitch + restOffsets: the accepted fig3 resting totem (the reference's
 *    generous air gaps).
 *
 * The rest pitch is 1.32 (1.06 air gap over the 0.26-thick plates) rather than
 * v1's 1.03: with the symbol now exactly centred on the top face and enlarged to
 * 1.0 world units, the plate above must clear the whole glyph at the fixed
 * three-quarter camera, and 1.32 keeps the clearance (verified by the model's
 * `symbolClearance` check) with the lowered 30° elevation (see CAMERA_SPEC).
 */
export const LAYOUT_SPEC = {
  vertical: {
    axis: 'y',
    scatterPitch: 1.5,
    tightPitch: 0.3,
    restPitch: 1.32,
    // rest offsets (fig3 totem): { x, y, z, yawDeg, pitchDeg, rollDeg }
    restOffsets: [
      { x: -0.02, z: 0.03, yawDeg: 2.6, pitchDeg: -1.2, rollDeg: -1.4 },
      { x: 0.045, z: -0.035, yawDeg: -3.4, pitchDeg: -0.7, rollDeg: 1.7 },
      { x: -0.035, z: 0.015, yawDeg: 1.2, pitchDeg: -1.5, rollDeg: -0.8 },
      { x: 0.05, z: -0.02, yawDeg: -2.1, pitchDeg: -0.5, rollDeg: 1.1 },
      { x: -0.015, z: 0.04, yawDeg: 3.8, pitchDeg: -1.3, rollDeg: -1.6 },
    ],
    // loose intro offsets: bigger attitude + lateral scatter (the "loose" state)
    scatterOffsets: [
      { x: -0.1, z: 0.12, yawDeg: 6.5, pitchDeg: -3.4, rollDeg: -3.8 },
      { x: 0.14, z: -0.14, yawDeg: -8.0, pitchDeg: -2.1, rollDeg: 4.6 },
      { x: -0.12, z: 0.08, yawDeg: 4.2, pitchDeg: -4.0, rollDeg: -2.6 },
      { x: 0.16, z: -0.12, yawDeg: -7.2, pitchDeg: -1.8, rollDeg: 3.4 },
      { x: -0.09, z: 0.15, yawDeg: 8.8, pitchDeg: -3.6, rollDeg: -4.4 },
    ],
  },
  horizontal: {
    axis: 'y',
    // Progressive +X offset per plate (index 0 = top, so the fan runs from the
    // top-left block down to the bottom-right block) — the "horizontal direction"
    // of the stacked totem. Mirrored by the matching yaw line.
    fanSpread: 0.62,
    scatterPitch: 1.5,
    tightPitch: 0.3,
    restPitch: 1.32,
    restOffsets: [
      { x: -0.62, z: 0.03, yawDeg: 5.2, pitchDeg: -1.1, rollDeg: -1.7 },
      { x: -0.31, z: -0.035, yawDeg: 2.6, pitchDeg: -0.6, rollDeg: 1.8 },
      { x: 0, z: 0.015, yawDeg: 0.0, pitchDeg: -1.4, rollDeg: -0.9 },
      { x: 0.31, z: -0.02, yawDeg: -2.6, pitchDeg: -0.5, rollDeg: 1.2 },
      { x: 0.62, z: 0.04, yawDeg: -5.2, pitchDeg: -1.2, rollDeg: -1.6 },
    ],
    // Loose frame: the same totem opened up along the horizontal direction (the
    // fan splay is much wider than the rest fan) before it gathers into the flush
    // vertical puck and settles back out onto the fanned rest totem.
    scatterOffsets: [
      { x: -1.02, y: 0.06, z: 0.14, yawDeg: 8.4, pitchDeg: -3.2, rollDeg: -4.0 },
      { x: -0.51, y: -0.06, z: -0.15, yawDeg: -7.8, pitchDeg: -2.0, rollDeg: 4.4 },
      { x: 0, y: 0.04, z: 0.09, yawDeg: 3.6, pitchDeg: -3.6, rollDeg: -2.4 },
      { x: 0.51, y: -0.05, z: -0.12, yawDeg: -6.8, pitchDeg: -1.7, rollDeg: 3.2 },
      { x: 1.02, y: 0.07, z: 0.15, yawDeg: 7.4, pitchDeg: -3.3, rollDeg: -4.2 },
    ],
  },
};

/**
 * Frozen shared timeline (CONTRACT §2.3). The same choreography drives both
 * layouts; only the rest/scatter horizontal profile differs, the timing does not.
 *
 *   0 .. 0.14           loose intro (scatter pose held)
 *   gather 0.14 .. 1.43 bottom-up convergence into the tight puck
 *   tight  1.43 .. 1.62 exactly the tight pose
 *   settle 1.62 .. 2.90 top-down splay onto the rest pose
 *   >= 2.90             exactly the rest pose (no residual motion, no idle float)
 *
 * Per block i at time t:
 *   g = easeInOutCubic(clamp((t - (0.14 + (4 - i) * 0.06)) / 1.05, 0, 1))
 *   s = easeOutBack(clamp((t - (1.62 + i * 0.05)) / 1.05, 0, 1))
 *   axis      = lerp(lerp(scatterAxis, tightAxis, g), restAxis, s)
 *   lateral/rotation = lerp(lerp(scatterOff, 0, g), restOff, s)
 *   scale = 1
 */
export const TIMELINE_SPEC = {
  duration: 2.9,
  startHoldEnd: 0.14,
  gather: { start: 0.14, stagger: 0.06, duration: 1.05, order: 'bottom-up', ease: 'easeInOutCubic' },
  tightHold: { start: 1.43, end: 1.62 },
  settle: { start: 1.62, stagger: 0.05, duration: 1.05, order: 'top-down', ease: 'easeOutBack' },
};

/**
 * Fixed three-quarter camera (the page solves distance/fit from bounds).
 *
 * v2 lowers the elevation from 38° to 30°: with the symbol now exactly centred on
 * each top face (no +Z forward offset), a 38° camera over 0.26-thick plates would
 * let the plate above clip the back edge of the glyph. 30° keeps the whole glyph
 * clear at the 1.06 air gap (verified by the model's symbolClearance probe) and
 * also matches the reference render's flatter plate projection better.
 */
export const CAMERA_SPEC = Object.freeze({
  fov: 28,
  azimuthDeg: 42,
  elevationDeg: 30,
  near: 0.1,
  far: 120,
  targetY: 0,
  fitMargin: 0.82,
  orbit: Object.freeze({
    azimuthRangeDeg: 16,
    elevationRangeDeg: 7,
    azimuthPerPx: 0.22,
    elevationPerPx: 0.14,
  }),
});

/** Block + symbol material values (verbatim from the accepted stacked model). */
export const MATERIAL_SPEC = Object.freeze({
  plate: Object.freeze({
    colorSrgb: '#0a0b0d',
    metalness: 0.92,
    roughness: 0.19,
    clearcoat: 0.72,
    clearcoatRoughness: 0.11,
    envMapIntensity: 1.35,
    normalScale: 0.3,
  }),
  edge: Object.freeze({
    colorSrgb: '#07080b',
    metalness: 0.96,
    roughness: 0.1,
    clearcoat: 0.85,
    clearcoatRoughness: 0.07,
    envMapIntensity: 1.5,
  }),
  symbol: Object.freeze({
    colorSrgb: '#eef2f6',
    metalness: 0.35,
    roughness: 0.18,
    clearcoat: 0.5,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1.4,
    normalScale: 1.0,
  }),
});

/** Supported arrangement layouts (index order is QA-significant). */
export const LAYOUTS = Object.freeze(['vertical', 'horizontal']);

/** The scene-QA probe time used for the tight pose (CONTRACT §5.4). */
const TIGHT_PROBE_TIME = 1.52;

/** Determinism sample times for the internal getDebug() checks. */
const CHECK_SAMPLE_TIMES = Object.freeze([0, 0.14, 0.38, 0.7, 1.05, 1.43, 1.52, 1.62, 2.0, 2.45, 2.9]);

/** Every pose field, in stable order (used for exact equality checks). */
const POSE_FIELDS = Object.freeze(['x', 'y', 'z', 'yawDeg', 'pitchDeg', 'rollDeg', 'scale']);

/* ------------------------------------------------------------------ helpers */

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degToRad = (deg) => (deg * Math.PI) / 180;
const round = (value, digits = 3) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};

/**
 * Linear interpolation with exact end points. Returning the endpoint itself at
 * t = 0 / t = 1 (instead of a + (b - a) * t, which can round) is what makes the
 * scatter/tight/rest states bit-stable and exactly equal to the frozen numbers.
 */
const lerp = (from, to, t) => (t <= 0 ? from : t >= 1 ? to : from + (to - from) * t);

const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** mulberry32 — small deterministic seeded PRNG (the collection's standard stream). */
export function createSeededRandom(seed) {
  let state = (Number(seed) || 0) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/* --------------------------------------------------------------- easings */

/** Standard cubic ease-in-out; e(0) = 0 and e(1) = 1 exactly. */
export function easeInOutCubic(t) {
  const x = clamp(Number(t) || 0, 0, 1);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Overshooting ease-out; the contract requires e(0) = 0 and e(1) = 1 exactly, so
 * the end points are returned literally (the backsolve at t = 1 would otherwise
 * rely on the cubic terms cancelling in floating point).
 */
export function easeOutBack(t) {
  const x = clamp(Number(t) || 0, 0, 1);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/* ------------------------------------------------------------------- font */

/**
 * Parse the sfnt `cmap` of an ArrayBuffer and return the glyph id for every
 * required currency glyph (0 = missing). Supports the two subtable formats a
 * variable TTF ships with: format 4 (BMP) and format 12 (full Unicode).
 * Returns null when the buffer is not a readable cmap.
 */
function parseCmapCoverage(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 12) return null;
    const numTables = view.getUint16(4, false);
    let cmapOffset = -1;
    for (let i = 0; i < numTables; i += 1) {
      const record = 12 + i * 16;
      if (record + 16 > view.byteLength) break;
      const tag =
        String.fromCharCode(view.getUint8(record), view.getUint8(record + 1), view.getUint8(record + 2), view.getUint8(record + 3));
      if (tag === 'cmap') {
        cmapOffset = view.getUint32(record + 8, false);
        break;
      }
    }
    if (cmapOffset < 0 || cmapOffset + 4 > view.byteLength) return null;
    const tableCount = view.getUint16(cmapOffset + 2, false);
    const subtables = [];
    for (let i = 0; i < tableCount; i += 1) {
      const record = cmapOffset + 4 + i * 8;
      if (record + 8 > view.byteLength) break;
      const offset = cmapOffset + view.getUint32(record + 4, false);
      if (offset + 2 > view.byteLength) continue;
      const format = view.getUint16(offset, false);
      if (format === 12) subtables.unshift({ format, offset });
      else if (format === 4) subtables.push({ format, offset });
    }
    const coverage = {};
    for (const currency of CURRENCY_SPECS) {
      const codePoint = currency.glyph.codePointAt(0);
      let glyphId = 0;
      for (const subtable of subtables) {
        glyphId = subtable.format === 12
          ? lookupCmapFormat12(view, subtable.offset, codePoint)
          : lookupCmapFormat4(view, subtable.offset, codePoint);
        if (glyphId > 0) break;
      }
      coverage[currency.glyph] = glyphId;
    }
    return coverage;
  } catch (error) {
    return null;
  }
}

function lookupCmapFormat12(view, offset, codePoint) {
  if (offset + 16 > view.byteLength) return 0;
  const groupCount = view.getUint32(offset + 12, false);
  if (groupCount > 100000) return 0;
  let low = 0;
  let high = groupCount - 1;
  const groups = offset + 16;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const record = groups + middle * 12;
    if (record + 12 > view.byteLength) return 0;
    const start = view.getUint32(record, false);
    const end = view.getUint32(record + 4, false);
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return view.getUint32(record + 8, false) + (codePoint - start);
  }
  return 0;
}

function lookupCmapFormat4(view, offset, codePoint) {
  if (codePoint > 0xffff || offset + 14 > view.byteLength) return 0;
  const segCountX2 = view.getUint16(offset + 6, false);
  if (!segCountX2) return 0;
  const segCount = segCountX2 / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segCountX2 + 2;
  const idDeltas = startCodes + segCountX2;
  const idRangeOffsets = idDeltas + segCountX2;
  for (let segment = 0; segment < segCount; segment += 1) {
    if (endCodes + segment * 2 + 2 > view.byteLength) return 0;
    if (codePoint > view.getUint16(endCodes + segment * 2, false)) continue;
    if (startCodes + segment * 2 + 2 > view.byteLength) return 0;
    const start = view.getUint16(startCodes + segment * 2, false);
    if (codePoint < start) return 0;
    const rangeOffsetPosition = idRangeOffsets + segment * 2;
    if (rangeOffsetPosition + 2 > view.byteLength) return 0;
    const rangeOffset = view.getUint16(rangeOffsetPosition, false);
    const delta = view.getUint16(idDeltas + segment * 2, false);
    if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
    const glyphIndex = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
    if (glyphIndex + 2 > view.byteLength) return 0;
    const glyphId = view.getUint16(glyphIndex, false);
    return glyphId === 0 ? 0 : (glyphId + delta) & 0xffff;
  }
  return 0;
}

/** Fetch the local font and read its cmap (best effort — null when unavailable). */
async function readCmapCoverage() {
  try {
    if (typeof fetch !== 'function') return null;
    const response = await fetch(FONT_SPEC.url);
    if (!response || !response.ok) return null;
    const buffer = await response.arrayBuffer();
    return parseCmapCoverage(buffer);
  } catch (error) {
    return null;
  }
}

/**
 * Load the Lexend variable font through the FontFace API. The family is unique to
 * this deliverable (TEKOCurrencyBlocksLexend) so it cannot collide with the page
 * CSS face; the FontFace is registered on document.fonts before it is used by
 * canvas. Throws a descriptive Error when FontFace is unavailable or the font
 * fails to load. No page CSS is required.
 */
export async function loadLexendFont({ timeoutMs = 8000 } = {}) {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    throw new Error('currency-blocks-model: FontFace API unavailable — cannot load "' + FONT_SPEC.url + '"');
  }
  let face;
  try {
    face = new FontFace(FONT_SPEC.family, 'url("' + FONT_SPEC.url + '")', {
      weight: FONT_SPEC.weightRange,
      display: 'block',
    });
  } catch (error) {
    face = new FontFace(FONT_SPEC.family, 'url("' + FONT_SPEC.url + '")', {
      weight: String(FONT_SPEC.weight),
      display: 'block',
    });
  }
  const timeout = new Promise((resolve, reject) => {
    setTimeout(
      () => reject(new Error('currency-blocks-model: timed out loading Lexend (' + FONT_SPEC.url + ')')),
      timeoutMs,
    );
  });
  try {
    await Promise.race([face.load(), timeout]);
  } catch (error) {
    const detail = error && error.message ? String(error.message) : String(error);
    throw new Error('currency-blocks-model: failed to load Lexend (' + FONT_SPEC.url + '): ' + detail);
  }
  document.fonts.add(face);
  if (document.fonts.ready) {
    try {
      await Promise.race([document.fonts.ready, timeout]);
    } catch (error) {
      /* readiness is a nicety; the face is already parsed */
    }
  }

  // Glyph coverage: the shipped TTF cmap is authoritative; a canvas ink test and
  // document.fonts.check are reduced checks used only when the cmap is unreadable.
  const coverage = await readCmapCoverage();
  const requiredGlyphs = CURRENCY_SPECS.map((currency) => currency.glyph);
  const cmapCovers = coverage ? requiredGlyphs.map((glyph) => (coverage[glyph] || 0) > 0) : null;
  let canvasCovers = null;
  try {
    canvasCovers = requiredGlyphs.map((glyph) => canvasGlyphHasInk(glyph));
  } catch (error) {
    canvasCovers = null;
  }
  let fontCovers = null;
  if (typeof document.fonts.check === 'function') {
    try {
      fontCovers = requiredGlyphs.map((glyph) =>
        document.fonts.check(FONT_SPEC.weight + ' 64px "' + FONT_SPEC.family + '"', glyph),
      );
    } catch (error) {
      fontCovers = null;
    }
  }
  const covers = cmapCovers
    ? cmapCovers.every(Boolean)
    : canvasCovers
      ? canvasCovers.every(Boolean)
      : fontCovers
        ? fontCovers.every(Boolean)
        : true;
  const coversGlyphs = cmapCovers ? cmapCovers.every(Boolean) : covers;

  return {
    family: FONT_SPEC.family,
    cssFamily: FONT_SPEC.cssFamily,
    weight: FONT_SPEC.weight,
    weightRange: FONT_SPEC.weightRange,
    url: FONT_SPEC.url,
    loaded: true,
    covers,
    coversGlyphs,
    face,
  };
}

/* ---------------------------------------------------------- canvas helpers */

function createCanvas(width, height) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('currency-blocks-model: a DOM document is required to paint procedural textures');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function get2d(canvas, willReadFrequently = false) {
  const context = canvas.getContext('2d', willReadFrequently ? { willReadFrequently: true } : undefined);
  if (!context) throw new Error('currency-blocks-model: 2D canvas context unavailable');
  return context;
}

/** Paint one glyph with the loaded family and report whether it left any ink. */
function canvasGlyphHasInk(glyph) {
  const size = 64;
  const canvas = createCanvas(size, size);
  const ctx = get2d(canvas, true);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = String(FONT_SPEC.weight) + ' 48px "' + FONT_SPEC.family + '"';
  ctx.fillText(glyph, size / 2, size / 2);
  const data = ctx.getImageData(0, 0, size, size).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) return true;
  return false;
}

/** Measure the alpha ink bounding box of a canvas's RGBA data. */
function measureAlphaBBox(data, width, height, threshold = 8) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (data[(row + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Approximate Euclidean distance (px) from the glyph ink boundary, inside only.
 * Two-pass chamfer transform (1 / 1.4142), capped at maxDistance.
 */
function insideDistanceTransform(solid, width, height, maxDistance) {
  const count = width * height;
  const distance = new Float32Array(count);
  const INF = 1e6;
  for (let i = 0; i < count; i += 1) distance[i] = solid[i] ? INF : 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const i = row + x;
      if (distance[i] <= 0) continue;
      let d = distance[i];
      if (x > 0) d = Math.min(d, distance[i - 1] + 1);
      if (y > 0) d = Math.min(d, distance[i - width] + 1);
      if (x > 0 && y > 0) d = Math.min(d, distance[i - width - 1] + 1.4142);
      if (x < width - 1 && y > 0) d = Math.min(d, distance[i - width + 1] + 1.4142);
      distance[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = row + x;
      if (distance[i] <= 0) continue;
      let d = distance[i];
      if (x < width - 1) d = Math.min(d, distance[i + 1] + 1);
      if (y < height - 1) d = Math.min(d, distance[i + width] + 1);
      if (x < width - 1 && y < height - 1) d = Math.min(d, distance[i + width + 1] + 1.4142);
      if (x > 0 && y < height - 1) d = Math.min(d, distance[i + width - 1] + 1.4142);
      distance[i] = d;
    }
  }
  for (let i = 0; i < count; i += 1) distance[i] = Math.min(distance[i], maxDistance);
  return distance;
}

/** 3×3 box blur over a float height field (keeps relief edges soft, not aliased). */
function blurHeightField(values, width, height, passes = 1) {
  let source = values;
  for (let pass = 0; pass < passes; pass += 1) {
    const target = new Float32Array(values.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let weight = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          const sy = y + oy;
          if (sy < 0 || sy >= height) continue;
          for (let ox = -1; ox <= 1; ox += 1) {
            const sx = x + ox;
            if (sx < 0 || sx >= width) continue;
            const w = ox === 0 && oy === 0 ? 4 : 1;
            sum += source[sy * width + sx] * w;
            weight += w;
          }
        }
        target[y * width + x] = sum / weight;
      }
    }
    source = target;
  }
  return source;
}

/** Value-noise grid (seeded, bilinear) for the fine brushed hairlines. */
function createValueNoise(random, columns, rows) {
  const values = new Float32Array(columns * rows);
  for (let i = 0; i < values.length; i += 1) values[i] = random() * 2 - 1;
  return function sample(u, v) {
    const x = clamp(u, 0, 0.9999) * columns;
    const y = clamp(v, 0, 0.9999) * rows;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const x1 = (x0 + 1) % columns;
    const y1 = (y0 + 1) % rows;
    const a = lerp(values[y0 * columns + x0], values[y0 * columns + x1], fx);
    const b = lerp(values[y1 * columns + x0], values[y1 * columns + x1], fx);
    return lerp(a, b, fy);
  };
}

/* ---------------------------------------------------------------- geometry */

/** Rounded-square contour centred on the origin (shape space). */
function roundedSquareShape(size, radius) {
  const half = size / 2;
  const r = Math.min(radius, half);
  const shape = new THREE.Shape();
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.absarc(half - r, -half + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(half, half - r);
  shape.absarc(half - r, half - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-half + r, half);
  shape.absarc(-half + r, half - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-half, -half + r);
  shape.absarc(-half + r, -half + r, r, Math.PI, (Math.PI * 3) / 2, false);
  shape.closePath();
  return shape;
}

/**
 * Shared block geometry: a bevelled extruded rounded square laid flat in the XZ
 * plane (top face up, +Y), centred on its own origin. The same geometry instance
 * is used by every block and by both layouts.
 *
 * ExtrudeGeometry spans z ∈ [−bevelThickness, depth + bevelThickness]; after the
 * −90° X rotation the extrusion axis becomes +Y. Cap groups use material 0 and the
 * extruded sides/bevels use material 1. Cap UVs are remapped to the full square so
 * the procedural hairline texture is continuous across the whole top face; side
 * UVs are unused by the edge material.
 */
export function buildBlockGeometry(spec = BLOCK_SPEC) {
  const depth = spec.thickness - spec.bevelThickness * 2;
  if (!(depth > 0)) throw new Error('currency-blocks-model: block bevel is thicker than the block');
  // ExtrudeGeometry's bevel grows outward by bevelSize, so inset the contour by
  // that amount: the finished silhouette is exactly BLOCK_SPEC.size across.
  const shapeSize = spec.size - spec.bevelSize * 2;
  const shapeRadius = Math.max(0.01, spec.radius - spec.bevelSize);
  const geometry = new THREE.ExtrudeGeometry(roundedSquareShape(shapeSize, shapeRadius), {
    depth,
    steps: spec.steps,
    curveSegments: spec.curveSegments,
    bevelEnabled: true,
    bevelThickness: spec.bevelThickness,
    bevelSize: spec.bevelSize,
    bevelOffset: 0,
    bevelSegments: spec.bevelSegments,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -depth / 2, 0);
  geometry.computeBoundingBox();
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const half = spec.size / 2;
  for (let i = 0; i < positions.count; i += 1) {
    if (Math.abs(normals.getY(i)) > 0.6 && uv) {
      uv.setXY(i, (positions.getX(i) + half) / spec.size, (positions.getZ(i) + half) / spec.size);
    }
  }
  if (uv) uv.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.name = 'currency-block';
  return geometry;
}

/* ------------------------------------------------------- procedural textures */

/** Fine diagonal brushed hairlines on the black top face (seeded, tile-free). */
function buildFaceTextures(seed) {
  const size = 1024;
  const random = createSeededRandom(seed ^ 0x9e3779b9);
  const patch = createValueNoise(random, 22, 22);
  const jitter = createValueNoise(random, 96, 96);
  const periodPx = 5.6;
  const wobbleAmp = 1.6;

  const albedoCanvas = createCanvas(size, size);
  const albedoContext = get2d(albedoCanvas, true);
  const albedo = albedoContext.createImageData(size, size);
  const albedoData = albedo.data;
  const roughCanvas = createCanvas(size, size);
  const roughContext = get2d(roughCanvas, true);
  const rough = roughContext.createImageData(size, size);
  const roughData = rough.data;
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const low = patch(u, v);
      const micro = jitter(u, v);
      const wobble = low * wobbleAmp * Math.PI;
      // Lines run lower-left -> upper-right (the reference's diagonal brushing).
      const phase = ((x - y) / periodPx) * TAU + wobble;
      const line = Math.sin(phase);
      const i = y * size + x;
      height[i] = line * 0.5 + low * 0.85 + micro * 0.16;
      const albedoValue = clamp(10 + line * 1.15 + low * 2.3 + micro * 0.7, 5, 19);
      const o = i * 4;
      albedoData[o] = albedoValue;
      albedoData[o + 1] = albedoValue + 1;
      albedoData[o + 2] = albedoValue + 3;
      albedoData[o + 3] = 255;
      const roughValue = clamp(0.95 + line * 0.055 + low * 0.07 + micro * 0.02, 0.78, 1);
      const encoded = Math.round(roughValue * 255);
      roughData[o] = encoded;
      roughData[o + 1] = encoded;
      roughData[o + 2] = encoded;
      roughData[o + 3] = 255;
    }
  }
  albedoContext.putImageData(albedo, 0, 0);
  const albedoTex = new THREE.CanvasTexture(albedoCanvas);
  albedoTex.name = 'currency-blocks-face-albedo';
  albedoTex.encoding = THREE.sRGBEncoding;
  albedoTex.anisotropy = 8;
  albedoTex.wrapS = THREE.ClampToEdgeWrapping;
  albedoTex.wrapT = THREE.ClampToEdgeWrapping;
  albedoTex.needsUpdate = true;

  roughContext.putImageData(rough, 0, 0);
  const roughTex = new THREE.CanvasTexture(roughCanvas);
  roughTex.name = 'currency-blocks-face-roughness';
  roughTex.anisotropy = 8;
  roughTex.needsUpdate = true;

  const normalCanvas = createCanvas(size, size);
  const normalContext = get2d(normalCanvas, true);
  const normalImage = normalContext.createImageData(size, size);
  const normalData = normalImage.data;
  const smooth = blurHeightField(height, size, size, 1);
  let maxTilt = 0;
  for (let y = 0; y < size; y += 1) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < size - 1 ? y + 1 : size - 1;
    for (let x = 0; x < size; x += 1) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < size - 1 ? x + 1 : size - 1;
      const i = y * size + x;
      const dhdu = (smooth[y * size + xp] - smooth[y * size + xm]) * 0.5;
      const dhdv = -(smooth[yp * size + x] - smooth[ym * size + x]) * 0.5;
      let nx = -dhdu * 0.34;
      let ny = -dhdv * 0.34;
      const length = Math.sqrt(nx * nx + ny * ny + 1) || 1;
      nx /= length;
      ny /= length;
      const nz = 1 / length;
      const o = i * 4;
      normalData[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[o + 3] = 255;
      const tilt = Math.sqrt(nx * nx + ny * ny);
      if (tilt > maxTilt) maxTilt = tilt;
    }
  }
  normalContext.putImageData(normalImage, 0, 0);
  const normalTex = new THREE.CanvasTexture(normalCanvas);
  normalTex.name = 'currency-blocks-face-normal';
  normalTex.anisotropy = 8;
  normalTex.needsUpdate = true;

  return {
    size,
    maps: { albedoTex, roughTex, normalTex },
    stats: {
      periodPx,
      wobbleAmp,
      maxTilt: Math.round(maxTilt * 1000) / 1000,
    },
  };
}

/** Render one Lexend glyph into an ink-trimmed white-on-transparent canvas. */
function renderGlyphCanvas(font, currency) {
  const reference = 512;
  if (!font || !font.family) {
    throw new Error('currency-blocks-model: loadLexendFont() result is required before painting symbols');
  }
  const canvas = createCanvas(reference, reference);
  const ctx = get2d(canvas, true);
  ctx.clearRect(0, 0, reference, reference);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = String(FONT_SPEC.weight) + ' 340px "' + font.family + '", "' + FONT_SPEC.cssFamily + '", sans-serif';
  ctx.fillText(currency.glyph, reference / 2, reference / 2);
  // Font metrics are recorded for the centring report only. Centring itself uses
  // the measured INK box (below), because the em box carries asymmetric side
  // bearings that make a baseline/typographically centred glyph look off-centre.
  let metrics = null;
  try {
    metrics = typeof ctx.measureText === 'function' ? ctx.measureText(currency.glyph) : null;
  } catch (error) {
    metrics = null;
  }
  const data = ctx.getImageData(0, 0, reference, reference).data;
  const box = measureAlphaBBox(data, reference, reference, 6);
  if (!box) {
    throw new Error('currency-blocks-model: Lexend produced no ink for "' + currency.code + '" (' + currency.glyph + ')');
  }
  const trimmed = createCanvas(box.width, box.height);
  const trimmedCtx = get2d(trimmed, true);
  trimmedCtx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return { canvas: trimmed, width: box.width, height: box.height, inkBox: box, metrics, reference };
}

/**
 * Build the 768² symbol inlay maps for one currency:
 *   - albedo RGBA: bright silver-white glyph interior, darker chamfer ring, alpha
 *     from the glyph coverage (alphaTest cuts the field away);
 *   - tangent-space normal map from an inner-distance bevel, so the inlay reads as
 *     a raised polished metal letter instead of a painted decal.
 */
function buildSymbolTextures(font, currency, seed) {
  const S = SYMBOL_SPEC.textureSize;
  const glyph = renderGlyphCanvas(font, currency);
  const pxPerWorld = S / SYMBOL_SPEC.decalSize;
  const maxHeightPx = SYMBOL_SPEC.maxHeight * pxPerWorld;
  const maxWidthPx = SYMBOL_SPEC.maxWidth * pxPerWorld;
  const scale = Math.min(maxHeightPx / glyph.height, maxWidthPx / glyph.width);
  const drawWidth = glyph.width * scale;
  const drawHeight = glyph.height * scale;
  const x0 = (S - drawWidth) / 2;
  const y0 = (S - drawHeight) / 2;

  const maskCanvas = createCanvas(S, S);
  const maskCtx = get2d(maskCanvas, true);
  maskCtx.imageSmoothingEnabled = true;
  maskCtx.imageSmoothingQuality = 'high';
  maskCtx.clearRect(0, 0, S, S);
  maskCtx.drawImage(glyph.canvas, x0, y0, drawWidth, drawHeight);
  const maskData = maskCtx.getImageData(0, 0, S, S).data;

  const count = S * S;
  const solid = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) solid[i] = maskData[i * 4 + 3] >= 128 ? 1 : 0;
  const bevelPx = SYMBOL_SPEC.bevelPx;
  const distance = insideDistanceTransform(solid, S, S, bevelPx + 4);

  const height = new Float32Array(count);
  for (let i = 0; i < count; i += 1) height[i] = distance[i] > 0 ? smoothstep(0, 1, distance[i] / bevelPx) : 0;
  const smoothHeight = blurHeightField(height, S, S, 1);

  const random = createSeededRandom(seed ^ hashString(currency.id));
  const albedoCanvas = createCanvas(S, S);
  const albedoContext = get2d(albedoCanvas, true);
  const albedoImage = albedoContext.createImageData(S, S);
  const albedoData = albedoImage.data;
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    const alpha = maskData[o + 3];
    if (alpha === 0) {
      albedoData[o + 3] = 0;
      continue;
    }
    const t = smoothstep(0, 1, distance[i] / bevelPx);
    const shade = lerp(SYMBOL_SPEC.albedoBevel, SYMBOL_SPEC.albedoInterior, t);
    const micro = (random() - 0.5) * 5;
    albedoData[o] = clamp(shade + micro, 0, 255);
    albedoData[o + 1] = clamp(shade + micro + 1, 0, 255);
    albedoData[o + 2] = clamp(shade + micro + 3, 0, 255);
    albedoData[o + 3] = alpha;
  }
  albedoContext.putImageData(albedoImage, 0, 0);
  const albedoTex = new THREE.CanvasTexture(albedoCanvas);
  albedoTex.name = 'currency-blocks-symbol-' + currency.id;
  albedoTex.encoding = THREE.sRGBEncoding;
  albedoTex.anisotropy = 8;
  albedoTex.needsUpdate = true;

  const normalCanvas = createCanvas(S, S);
  const normalContext = get2d(normalCanvas, true);
  const normalImage = normalContext.createImageData(S, S);
  const normalData = normalImage.data;
  let maxTilt = 0;
  for (let y = 0; y < S; y += 1) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < S - 1 ? y + 1 : S - 1;
    for (let x = 0; x < S; x += 1) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < S - 1 ? x + 1 : S - 1;
      const i = y * S + x;
      const dhdu = (smoothHeight[y * S + xp] - smoothHeight[y * S + xm]) * 0.5;
      const dhdv = -(smoothHeight[yp * S + x] - smoothHeight[ym * S + x]) * 0.5;
      let nx = -dhdu * SYMBOL_SPEC.reliefStrength;
      let ny = -dhdv * SYMBOL_SPEC.reliefStrength;
      const length = Math.sqrt(nx * nx + ny * ny + 1) || 1;
      nx /= length;
      ny /= length;
      const nz = 1 / length;
      const o = i * 4;
      normalData[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[o + 3] = 255;
      const tilt = Math.sqrt(nx * nx + ny * ny);
      if (tilt > maxTilt) maxTilt = tilt;
    }
  }
  normalContext.putImageData(normalImage, 0, 0);
  const normalTex = new THREE.CanvasTexture(normalCanvas);
  normalTex.name = 'currency-blocks-symbol-normal-' + currency.id;
  normalTex.anisotropy = 8;
  normalTex.needsUpdate = true;

  return {
    textures: { albedoTex, normalTex },
    stats: {
      id: currency.id,
      code: currency.code,
      glyph: currency.glyph,
      glyphAspect: Math.round((glyph.width / glyph.height) * 1000) / 1000,
      drawWidthPx: Math.round(drawWidth),
      drawHeightPx: Math.round(drawHeight),
      drawRectPx: {
        x: Math.round(x0 * 100) / 100,
        y: Math.round(y0 * 100) / 100,
        width: Math.round(drawWidth * 100) / 100,
        height: Math.round(drawHeight * 100) / 100,
      },
      // The ink box is drawn at the texture centre: these two offsets are what
      // "the glyph is centred in the 768² inlay map" means numerically (≈0).
      centerOffsetPx: {
        x: Math.round((x0 + drawWidth / 2 - S / 2) * 1000) / 1000,
        y: Math.round((y0 + drawHeight / 2 - S / 2) * 1000) / 1000,
      },
      textureCenterPx: { x: S / 2, y: S / 2 },
      // Ink half-extents in world units on the 1.30 decal plane, used by the
      // symbolClipping probe (x across the plate, z along the plate's face-down
      // direction: the canvas +Y maps to the block-local -Z on the top face).
      worldHalfExtents: {
        x: Math.round(((drawWidth / S) * SYMBOL_SPEC.decalSize / 2) * 10000) / 10000,
        z: Math.round(((drawHeight / S) * SYMBOL_SPEC.decalSize / 2) * 10000) / 10000,
      },
      glyphMetrics: (() => {
        const metrics = glyph.metrics;
        if (!metrics) return null;
        const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? round(value, 2) : null);
        const record = {
          actualBoundingBoxLeft: num(metrics.actualBoundingBoxLeft),
          actualBoundingBoxRight: num(metrics.actualBoundingBoxRight),
          actualBoundingBoxAscent: num(metrics.actualBoundingBoxAscent),
          actualBoundingBoxDescent: num(metrics.actualBoundingBoxDescent),
          width: num(metrics.width),
        };
        return Object.values(record).some((value) => value !== null) ? record : null;
      })(),
      coveragePx: solid.reduce((sum, value) => sum + value, 0),
      maxTilt: Math.round(maxTilt * 1000) / 1000,
    },
  };
}

/* ------------------------------------------------------------------- poses */

function layoutSpecFor(layout) {
  const spec = LAYOUT_SPEC[layout];
  if (!spec) {
    throw new Error(
      'currency-blocks-model: unknown layout "' + String(layout) + '" (expected ' + LAYOUTS.join(' or ') + ')',
    );
  }
  return spec;
}

/** Axis position of block `index` on the layout axis (`pitch * (2 - i)` / `pitch * (i - 2)`). */
function axisPosition(pitch, axis, index) {
  return axis === 'y' ? pitch * (2 - index) : pitch * (index - 2);
}

/** Normalise one offset record: every missing component defaults to 0. */
function normalizeOffset(raw) {
  const source = raw || {};
  return {
    x: source.x === undefined ? 0 : source.x,
    y: source.y === undefined ? 0 : source.y,
    z: source.z === undefined ? 0 : source.z,
    yawDeg: source.yawDeg === undefined ? 0 : source.yawDeg,
    pitchDeg: source.pitchDeg === undefined ? 0 : source.pitchDeg,
    rollDeg: source.rollDeg === undefined ? 0 : source.rollDeg,
  };
}

/** Read the offset record for one block index. */
function offsetAt(offsets, index) {
  return normalizeOffset(offsets[index]);
}

/**
 * Pure, deterministic pose of one block at a given time (seconds) in a layout.
 * No state, no randomness, no time-of-day. Returns the scatter pose for t <= 0,
 * the tight pose for 1.43 <= t <= 1.62 and the rest pose for t >= 2.9 exactly.
 */
export function blockPose(layout, index, seconds = 0) {
  const spec = layoutSpecFor(layout);
  const i = clamp(Math.floor(Number(index) || 0), 0, BLOCK_COUNT - 1);
  const t = Math.max(0, Number(seconds) || 0);

  // Gather (bottom-up) and settle (top-down) from the frozen shared timeline.
  const gatherDelay = TIMELINE_SPEC.gather.start + (BLOCK_COUNT - 1 - i) * TIMELINE_SPEC.gather.stagger;
  const settleDelay = TIMELINE_SPEC.settle.start + i * TIMELINE_SPEC.settle.stagger;
  const gather = easeInOutCubic(clamp((t - gatherDelay) / TIMELINE_SPEC.gather.duration, 0, 1));
  const settle = easeOutBack(clamp((t - settleDelay) / TIMELINE_SPEC.settle.duration, 0, 1));

  const scatterOff = offsetAt(spec.scatterOffsets, i);
  const restOff = offsetAt(spec.restOffsets, i);
  const axisScatter = axisPosition(spec.scatterPitch, spec.axis, i);
  const axisTight = axisPosition(spec.tightPitch, spec.axis, i);
  const axisRest = axisPosition(spec.restPitch, spec.axis, i);

  const axis = lerp(lerp(axisScatter, axisTight, gather), axisRest, settle);
  const x = lerp(lerp(scatterOff.x, 0, gather), restOff.x, settle);
  const y = lerp(lerp(scatterOff.y, 0, gather), restOff.y, settle);
  const z = lerp(lerp(scatterOff.z, 0, gather), restOff.z, settle);
  const yawDeg = lerp(lerp(scatterOff.yawDeg, 0, gather), restOff.yawDeg, settle);
  const pitchDeg = lerp(lerp(scatterOff.pitchDeg, 0, gather), restOff.pitchDeg, settle);
  const rollDeg = lerp(lerp(scatterOff.rollDeg, 0, gather), restOff.rollDeg, settle);

  if (spec.axis === 'y') {
    return { x, y: axis + y, z, yawDeg, pitchDeg, rollDeg, scale: 1 };
  }
  return { x: axis + x, y, z, yawDeg, pitchDeg, rollDeg, scale: 1 };
}

/** Expected pose for the frozen scatter / tight / rest states (used by getDebug checks). */
function expectedStatePose(layout, index, state) {
  const spec = LAYOUT_SPEC[layout];
  const pitch = state === 'scatter' ? spec.scatterPitch : state === 'tight' ? spec.tightPitch : spec.restPitch;
  const offsets = state === 'scatter' ? spec.scatterOffsets[index] : state === 'rest' ? spec.restOffsets[index] : null;
  const offset = normalizeOffset(offsets);
  const pose = {
    x: offset.x,
    y: offset.y,
    z: offset.z,
    yawDeg: offset.yawDeg,
    pitchDeg: offset.pitchDeg,
    rollDeg: offset.rollDeg,
    scale: 1,
  };
  pose[spec.axis] = axisPosition(pitch, spec.axis, index) + pose[spec.axis];
  return pose;
}

/* ------------------------------------------------------------------- model */

function makeSymbolMaterial(textures) {
  const spec = MATERIAL_SPEC.symbol;
  const material = new THREE.MeshPhysicalMaterial({
    name: 'currency-blocks-symbol-material',
    color: new THREE.Color(spec.colorSrgb),
    map: textures.albedoTex,
    normalMap: textures.normalTex,
    normalScale: new THREE.Vector2(spec.normalScale, spec.normalScale),
    metalness: spec.metalness,
    roughness: spec.roughness,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: spec.clearcoatRoughness,
    envMapIntensity: spec.envMapIntensity,
    alphaTest: 0.42,
    transparent: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.userData.role = 'currency-blocks-symbol';
  return material;
}

/**
 * Build the complete deterministic currency-block model.
 *
 * @param {{ font: object, seed?: number, layout?: 'vertical'|'horizontal' }} options
 * @returns {object} model with root, blocks, setLayout, setTime, blockPose,
 *   getBounds, getDebug and dispose
 */
export function createCurrencyBlocksModel(options = {}) {
  const font = options.font;
  if (!font || !font.family) {
    throw new Error('currency-blocks-model: createCurrencyBlocksModel() requires the loadLexendFont() result');
  }
  const seed = options.seed === undefined ? SEED : Number(options.seed) >>> 0;
  const requestedLayout = options.layout === undefined ? LAYOUTS[0] : options.layout;
  layoutSpecFor(requestedLayout);
  let currentLayout = requestedLayout;
  let currentTime = 0;

  const blockGeometry = buildBlockGeometry();
  const faceMaps = buildFaceTextures(seed);

  const blockMaterial = new THREE.MeshPhysicalMaterial({
    name: 'currency-blocks-black-metal',
    color: new THREE.Color(MATERIAL_SPEC.plate.colorSrgb),
    map: faceMaps.maps.albedoTex,
    roughnessMap: faceMaps.maps.roughTex,
    normalMap: faceMaps.maps.normalTex,
    normalScale: new THREE.Vector2(MATERIAL_SPEC.plate.normalScale, MATERIAL_SPEC.plate.normalScale),
    metalness: MATERIAL_SPEC.plate.metalness,
    roughness: MATERIAL_SPEC.plate.roughness,
    clearcoat: MATERIAL_SPEC.plate.clearcoat,
    clearcoatRoughness: MATERIAL_SPEC.plate.clearcoatRoughness,
    envMapIntensity: MATERIAL_SPEC.plate.envMapIntensity,
  });
  blockMaterial.userData.role = 'currency-blocks-block';

  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    name: 'currency-blocks-edge-black-chrome',
    color: new THREE.Color(MATERIAL_SPEC.edge.colorSrgb),
    metalness: MATERIAL_SPEC.edge.metalness,
    roughness: MATERIAL_SPEC.edge.roughness,
    clearcoat: MATERIAL_SPEC.edge.clearcoat,
    clearcoatRoughness: MATERIAL_SPEC.edge.clearcoatRoughness,
    envMapIntensity: MATERIAL_SPEC.edge.envMapIntensity,
  });
  edgeMaterial.userData.role = 'currency-blocks-edge';

  const root = new THREE.Group();
  root.name = 'currency-blocks';

  const decalGeometry = new THREE.PlaneGeometry(SYMBOL_SPEC.decalSize, SYMBOL_SPEC.decalSize);
  decalGeometry.rotateX(-Math.PI / 2);
  decalGeometry.name = 'currency-blocks-symbol-inlay';

  // The model never uses an image asset for a glyph (all inlay maps are painted
  // onto canvases); this flag is the module's own record of that invariant.
  const usesImageAsset = false;

  const blocks = CURRENCY_SPECS.map((currency, index) => {
    const symbol = buildSymbolTextures(font, currency, seed);
    const symbolMaterial = makeSymbolMaterial(symbol.textures);
    const group = new THREE.Group();
    group.name = 'currency-block-' + currency.id;

    const mesh = new THREE.Mesh(blockGeometry, [blockMaterial, edgeMaterial]);
    mesh.name = 'currency-block-mesh-' + currency.id;
    group.add(mesh);

    const inlay = new THREE.Mesh(decalGeometry, symbolMaterial);
    inlay.name = 'currency-block-symbol-' + currency.id;
    inlay.position.set(0, BLOCK_SPEC.thickness / 2 + SYMBOL_SPEC.raise, SYMBOL_SPEC.forwardOffset);
    group.add(inlay);

    root.add(group);
    return {
      index,
      currency,
      group,
      mesh,
      inlay,
      symbolMaterial,
      symbolStats: symbol.stats,
    };
  });

  function applyPoseAt(index, pose) {
    const block = blocks[index];
    if (!block) return;
    block.group.position.set(pose.x, pose.y, pose.z);
    block.group.rotation.set(degToRad(pose.pitchDeg), degToRad(pose.yawDeg), degToRad(pose.rollDeg), 'YXZ');
    block.group.scale.setScalar(pose.scale);
  }

  function applyAll(seconds) {
    for (let i = 0; i < blocks.length; i += 1) applyPoseAt(i, blockPose(currentLayout, i, seconds));
    root.updateMatrixWorld(true);
  }

  applyAll(currentTime);

  const scratchBounds = new THREE.Box3();
  const scratchMatrix = new THREE.Matrix4();
  const scratchQuaternion = new THREE.Quaternion();
  const scratchEuler = new THREE.Euler();
  const scratchPosition = new THREE.Vector3();
  const scratchScale = new THREE.Vector3();

  /**
   * Bounds of the plates (the alpha-tested inlay plane is larger than the glyph, so
   * including it would inflate the framing) at a layout/time. Pure: it does not
   * disturb the current model pose.
   */
  function getBounds(layout = currentLayout, seconds = TIMELINE_SPEC.duration) {
    layoutSpecFor(layout);
    const parsed = Number(seconds);
    const time = Number.isFinite(parsed) ? parsed : TIMELINE_SPEC.duration;
    const bounds = new THREE.Box3();
    for (let i = 0; i < blocks.length; i += 1) {
      const pose = blockPose(layout, i, time);
      scratchEuler.set(degToRad(pose.pitchDeg), degToRad(pose.yawDeg), degToRad(pose.rollDeg), 'YXZ');
      scratchQuaternion.setFromEuler(scratchEuler);
      scratchPosition.set(pose.x, pose.y, pose.z);
      scratchScale.setScalar(pose.scale);
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
      scratchBounds.copy(blockGeometry.boundingBox).applyMatrix4(scratchMatrix);
      if (i === 0) bounds.copy(scratchBounds);
      else bounds.union(scratchBounds);
    }
    return bounds;
  }

  /* -------------------------------------------------- symbol centring probe */

  /** Camera view direction (target -> camera) for the fixed default view. */
  const clearanceCameraDir = new THREE.Vector3(
    Math.sin(degToRad(CAMERA_SPEC.azimuthDeg)) * Math.cos(degToRad(CAMERA_SPEC.elevationDeg)),
    Math.sin(degToRad(CAMERA_SPEC.elevationDeg)),
    Math.cos(degToRad(CAMERA_SPEC.azimuthDeg)) * Math.cos(degToRad(CAMERA_SPEC.elevationDeg)),
  ).normalize();

  /**
   * Geometric proof that the centred glyph on each plate is not clipped by the
   * plate above at the resting frame: shoot a ray from each corner of the glyph's
   * ink box toward the fixed camera and test it against the other plates (in their
   * own local frames, so the per-plate yaw/roll is exact). Pure — the current model
   * pose is not touched.
   */
  function symbolClearance(layout) {
    layoutSpecFor(layout);
    const time = TIMELINE_SPEC.duration;
    const matrices = [];
    const inverses = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const pose = blockPose(layout, i, time);
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(degToRad(pose.pitchDeg), degToRad(pose.yawDeg), degToRad(pose.rollDeg), 'YXZ'),
      );
      matrix.compose(new THREE.Vector3(pose.x, pose.y, pose.z), quaternion, new THREE.Vector3(1, 1, 1));
      matrices.push(matrix);
      inverses.push(new THREE.Matrix4().copy(matrix).invert());
    }
    const localBox = blockGeometry.boundingBox;
    const localRay = new THREE.Ray();
    const localDir = new THREE.Vector3();
    const localOrigin = new THREE.Vector3();
    const hit = new THREE.Vector3();
    const corner = new THREE.Vector3();
    const topY = BLOCK_SPEC.thickness / 2 + SYMBOL_SPEC.raise;
    const clippedBlocks = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const stats = blocks[i].symbolStats;
      const halfX = stats.worldHalfExtents.x;
      const halfZ = stats.worldHalfExtents.z;
      let clippedCorners = 0;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          corner.set(sx * halfX, topY, sz * halfZ).applyMatrix4(matrices[i]);
          let hitAny = false;
          for (let j = 0; j < blocks.length; j += 1) {
            if (j === i) continue;
            localOrigin.copy(corner).applyMatrix4(inverses[j]);
            localDir.copy(clearanceCameraDir).transformDirection(inverses[j]);
            localRay.set(localOrigin, localDir);
            if (localRay.intersectBox(localBox, hit)) {
              hitAny = true;
              break;
            }
          }
          if (hitAny) clippedCorners += 1;
        }
      }
      if (clippedCorners > 0) clippedBlocks.push({ index: i, code: blocks[i].currency.code, clippedCorners });
    }
    return { clipped: clippedBlocks, clippedBlocks: clippedBlocks.length, layout };
  }

  /* ----------------------------------------------------------- self checks */

  function poseEquals(a, b) {
    for (const field of POSE_FIELDS) {
      if (!Object.is(a[field], b[field])) return false;
    }
    return true;
  }

  function finitePose(pose) {
    for (const field of POSE_FIELDS) {
      if (!Number.isFinite(pose[field])) return false;
    }
    return true;
  }

  function stateMatches(state, time) {
    for (const layout of LAYOUTS) {
      for (let i = 0; i < BLOCK_COUNT; i += 1) {
        if (!poseEquals(blockPose(layout, i, time), expectedStatePose(layout, i, state))) return false;
      }
    }
    return true;
  }

  function posesSnapshot() {
    const out = [];
    for (const layout of LAYOUTS) {
      for (let i = 0; i < BLOCK_COUNT; i += 1) {
        for (const time of CHECK_SAMPLE_TIMES) out.push(blockPose(layout, i, time));
      }
    }
    return JSON.stringify(out);
  }

  function seededStreamMatches() {
    const a = createSeededRandom(seed);
    const b = createSeededRandom(seed);
    for (let i = 0; i < 8; i += 1) {
      if (!Object.is(a(), b())) return false;
    }
    return true;
  }

  function computeChecks() {
    const scatterMatches = stateMatches('scatter', 0);
    const tightMatches = stateMatches('tight', TIGHT_PROBE_TIME);
    const restMatches = stateMatches('rest', TIMELINE_SPEC.duration);

    let allFinite = true;
    let deterministicPoses = true;
    for (const layout of LAYOUTS) {
      for (let i = 0; i < BLOCK_COUNT; i += 1) {
        for (const time of CHECK_SAMPLE_TIMES) {
          const pose = blockPose(layout, i, time);
          if (!finitePose(pose)) allFinite = false;
          if (!poseEquals(pose, blockPose(layout, i, time))) deterministicPoses = false;
        }
      }
    }
    const deterministic = allFinite && deterministicPoses && seededStreamMatches();

    let looseToTight = true;
    let tightToRest = true;
    for (const layout of LAYOUTS) {
      const axis = LAYOUT_SPEC[layout].axis;
      const loose = blockPose(layout, 0, 0);
      const tight = blockPose(layout, 0, TIGHT_PROBE_TIME);
      const rest = blockPose(layout, 0, TIMELINE_SPEC.duration);
      if (!(Math.abs(loose[axis] - tight[axis]) > 0.5) || !(Math.abs(loose.yawDeg) > 1)) looseToTight = false;
      if (!(Math.abs(rest[axis] - tight[axis]) > 0.5) || !(Math.abs(rest.yawDeg) > 1)) tightToRest = false;
    }

    const sameMaterials = blocks.every(
      (block) =>
        block.mesh.material[0] === blockMaterial &&
        block.mesh.material[1] === edgeMaterial &&
        block.mesh.geometry === blockGeometry,
    );
    const symbolMapsAreCanvas = blocks.every(
      (block) =>
        Boolean(block.symbolMaterial.map && block.symbolMaterial.map.isCanvasTexture) &&
        Boolean(block.symbolMaterial.normalMap && block.symbolMaterial.normalMap.isCanvasTexture),
    );
    const symbolsPainted = blocks.every((block) => block.symbolStats.coveragePx > 0);

    const bodyHex = '#' + blockMaterial.color.getHexString();

    // --- v2 checks -----------------------------------------------------------
    // Thick plate (fig3): 0.22–0.28 world units on the unchanged 1.6 footprint.
    const thickPlates =
      BLOCK_SPEC.size === 1.6 &&
      BLOCK_SPEC.thickness >= 0.22 &&
      BLOCK_SPEC.thickness <= 0.28 &&
      BLOCK_SPEC.bevelThickness > 0 &&
      Math.abs(blockGeometry.boundingBox.max.y - blockGeometry.boundingBox.min.y - BLOCK_SPEC.thickness) < 1e-6;

    // Symbol centred on the plate: the inlay has zero lateral/depth offset and
    // every glyph's ink box is centred in its 768² inlay map.
    const inlaysCentred = blocks.every(
      (block) =>
        Math.abs(block.inlay.position.x) < 1e-9 &&
        Math.abs(block.inlay.position.z - SYMBOL_SPEC.forwardOffset) < 1e-9,
    );
    const glyphsCentred = blocks.every((block) => {
      const stats = block.symbolStats;
      return Math.abs(stats.centerOffsetPx.x) < 0.01 && Math.abs(stats.centerOffsetPx.y) < 0.01;
    });
    const symbolsCentred =
      SYMBOL_SPEC.forwardOffset === 0 &&
      inlaysCentred &&
      glyphsCentred;

    // Both layouts are stacked on the vertical axis; no flat row remains.
    const restPosesFor = (layout) => blocks.map((block) => blockPose(layout, block.index, TIMELINE_SPEC.duration));
    const stackedLayouts = LAYOUTS.every((layout) => {
      if (LAYOUT_SPEC[layout].axis !== 'y') return false;
      const poses = restPosesFor(layout);
      let ordered = true;
      for (let i = 1; i < poses.length; i += 1) {
        if (!(poses[i - 1].y - poses[i].y > 0.5)) ordered = false;
      }
      const bounds = getBounds(layout, TIMELINE_SPEC.duration).getSize(new THREE.Vector3());
      return ordered && bounds.y > bounds.x && bounds.y > 2.5;
    });
    const layoutPair =
      LAYOUTS.length === 2 &&
      LAYOUTS[0] === 'vertical' &&
      LAYOUTS[1] === 'horizontal' &&
      stackedLayouts &&
      // The two layouts must not be identical: horizontal is the horizontal fan.
      Math.abs((LAYOUT_SPEC.horizontal.restOffsets[0].x || 0) - (LAYOUT_SPEC.vertical.restOffsets[0].x || 0)) > 0.3 &&
      sameMaterials;
    const clearance = {
      vertical: symbolClearance('vertical'),
      horizontal: symbolClearance('horizontal'),
    };
    const symbolClearanceCheck = clearance.vertical.clippedBlocks === 0 && clearance.horizontal.clippedBlocks === 0;

    let localOnly = false;
    try {
      const fontUrl = new URL(FONT_SPEC.url);
      if (typeof location !== 'undefined' && location && location.origin) {
        localOnly = fontUrl.origin === location.origin || fontUrl.protocol === 'file:';
      } else {
        localOnly = fontUrl.protocol === 'file:' || fontUrl.protocol === 'blob:';
      }
    } catch (error) {
      localOnly = false;
    }

    return {
      blockCountFive: BLOCK_COUNT === 5 && blocks.length === 5,
      symbolsFromLexend: Boolean(font.family === FONT_SPEC.family && font.loaded) && symbolsPainted,
      noPngGlyphs: !usesImageAsset && symbolMapsAreCanvas && symbolsPainted,
      blackBlockBody:
        bodyHex === MATERIAL_SPEC.plate.colorSrgb &&
        blockMaterial.metalness === MATERIAL_SPEC.plate.metalness &&
        blockMaterial.roughness === MATERIAL_SPEC.plate.roughness,
      sameColourAllBlocks: sameMaterials,
      thickPlates,
      symbolsCentred,
      stackedLayouts,
      layoutPair,
      symbolClearance: symbolClearanceCheck,
      sharedTimeline: scatterMatches && tightMatches && restMatches,
      looseToTight,
      tightToRest,
      deterministic,
      localOnly,
      glyphCoverage: Boolean(font.coversGlyphs) && symbolsPainted,
    };
  }

  /* -------------------------------------------------------------- debug */

  function layoutStats(layout) {
    const spec = LAYOUT_SPEC[layout];
    const size = getBounds(layout, TIMELINE_SPEC.duration).getSize(new THREE.Vector3());
    const restPoses = blocks.map((block) => blockPose(layout, block.index, TIMELINE_SPEC.duration));
    const restXs = restPoses.map((pose) => pose.x);
    const restYs = restPoses.map((pose) => pose.y);
    return {
      axis: spec.axis,
      stacked: spec.axis === 'y',
      fanSpread: spec.fanSpread === undefined ? 0 : spec.fanSpread,
      scatterPitch: spec.scatterPitch,
      tightPitch: spec.tightPitch,
      restPitch: spec.restPitch,
      // Air gap of the flush puck (tightPitch minus the plate thickness).
      tightGap: round(spec.tightPitch - BLOCK_SPEC.thickness),
      // Maximum gathering travel of an outer block along the layout axis.
      travel: round((spec.scatterPitch - spec.tightPitch) * ((BLOCK_COUNT - 1) / 2)),
      restHeight: round(size.y),
      restWidth: round(size.x),
      restXSpan: round(Math.max(...restXs) - Math.min(...restXs)),
      restYSpan: round(Math.max(...restYs) - Math.min(...restYs)),
    };
  }

  const model = {
    version: MODEL_VERSION,
    seed,
    count: BLOCK_COUNT,
    root,
    blocks,
    font,
    get layout() {
      return currentLayout;
    },
    setLayout(name) {
      layoutSpecFor(name);
      currentLayout = name;
      applyAll(currentTime);
      return currentLayout;
    },
    getLayout() {
      return currentLayout;
    },
    setTime(seconds) {
      const parsed = Number(seconds);
      currentTime = clamp(Number.isFinite(parsed) ? parsed : 0, 0, TIMELINE_SPEC.duration);
      applyAll(currentTime);
      return currentTime;
    },
    getTime() {
      return currentTime;
    },
    blockPose(index, seconds = currentTime) {
      return blockPose(currentLayout, index, seconds);
    },
    getBounds,
    getDebug() {
      const currentBounds = getBounds(currentLayout, currentTime);
      const boundsSize = currentBounds.getSize(new THREE.Vector3());
      return {
        version: MODEL_VERSION,
        seed,
        blockCount: blocks.length,
        layouts: LAYOUTS.slice(),
        layout: currentLayout,
        currencies: CURRENCY_SPECS.map((currency) => ({
          id: currency.id,
          code: currency.code,
          symbol: currency.symbol,
          glyph: currency.glyph,
          name: currency.name,
        })),
        block: {
          size: BLOCK_SPEC.size,
          footprint: BLOCK_SPEC.size + ' × ' + BLOCK_SPEC.size,
          thickness: BLOCK_SPEC.thickness,
          cornerRadius: BLOCK_SPEC.radius,
          bevelSize: BLOCK_SPEC.bevelSize,
          bevelThickness: BLOCK_SPEC.bevelThickness,
          bevelSegments: BLOCK_SPEC.bevelSegments,
        },
        symbol: {
          decalSize: SYMBOL_SPEC.decalSize,
          maxHeight: SYMBOL_SPEC.maxHeight,
          maxWidth: SYMBOL_SPEC.maxWidth,
          forwardOffset: SYMBOL_SPEC.forwardOffset,
          raise: SYMBOL_SPEC.raise,
          centering: 'ink-bbox',
          textureSize: SYMBOL_SPEC.textureSize,
          bevelPx: SYMBOL_SPEC.bevelPx,
        },
        symbolCentring: {
          policy: 'ink-bbox (canvas alpha trim of the Lexend glyph, then centred in the 768² inlay map)',
          forwardOffset: SYMBOL_SPEC.forwardOffset,
          maxCenterOffsetPx: round(
            Math.max(...blocks.map((block) => Math.max(Math.abs(block.symbolStats.centerOffsetPx.x), Math.abs(block.symbolStats.centerOffsetPx.y)))),
            6,
          ),
          allCentred: blocks.every(
            (block) =>
              Math.abs(block.symbolStats.centerOffsetPx.x) < 0.01 &&
              Math.abs(block.symbolStats.centerOffsetPx.y) < 0.01 &&
              Math.abs(block.inlay.position.x) < 1e-9 &&
              Math.abs(block.inlay.position.z - SYMBOL_SPEC.forwardOffset) < 1e-9,
          ),
        },
        symbolClearance: {
          vertical: symbolClearance('vertical'),
          horizontal: symbolClearance('horizontal'),
        },
        layoutSpec: {
          vertical: layoutStats('vertical'),
          horizontal: layoutStats('horizontal'),
        },
        timeline: {
          duration: TIMELINE_SPEC.duration,
          startHoldEnd: TIMELINE_SPEC.startHoldEnd,
          gather: {
            start: TIMELINE_SPEC.gather.start,
            stagger: TIMELINE_SPEC.gather.stagger,
            duration: TIMELINE_SPEC.gather.duration,
            order: TIMELINE_SPEC.gather.order,
            ease: TIMELINE_SPEC.gather.ease,
          },
          tightHold: { start: TIMELINE_SPEC.tightHold.start, end: TIMELINE_SPEC.tightHold.end },
          settle: {
            start: TIMELINE_SPEC.settle.start,
            stagger: TIMELINE_SPEC.settle.stagger,
            duration: TIMELINE_SPEC.settle.duration,
            order: TIMELINE_SPEC.settle.order,
            ease: TIMELINE_SPEC.settle.ease,
          },
        },
        blocks: blocks.map((block) => ({
          index: block.index,
          id: block.currency.id,
          code: block.currency.code,
          symbol: block.currency.symbol,
          pose: blockPose(currentLayout, block.index, currentTime),
          restPose: blockPose(currentLayout, block.index, TIMELINE_SPEC.duration),
          scatterPose: blockPose(currentLayout, block.index, 0),
          tightPose: blockPose(currentLayout, block.index, TIGHT_PROBE_TIME),
          glyphAspect: block.symbolStats.glyphAspect,
          symbolDrawWidthPx: block.symbolStats.drawWidthPx,
          symbolDrawHeightPx: block.symbolStats.drawHeightPx,
          symbolDrawRectPx: block.symbolStats.drawRectPx,
          symbolCenterOffsetPx: block.symbolStats.centerOffsetPx,
          symbolWorldHalfExtents: block.symbolStats.worldHalfExtents,
          symbolCoveragePx: block.symbolStats.coveragePx,
          glyphMetrics: block.symbolStats.glyphMetrics,
          // The inlay's local offset inside the block: x/z = 0 proves the glyph sits
          // exactly on the plate's top-face centre (not pushed toward the viewer).
          inlayOffset: {
            x: block.inlay.position.x,
            y: block.inlay.position.y,
            z: block.inlay.position.z,
          },
        })),
        materials: {
          block: {
            colorSrgb: MATERIAL_SPEC.plate.colorSrgb,
            metalness: blockMaterial.metalness,
            roughness: blockMaterial.roughness,
            clearcoat: blockMaterial.clearcoat,
            envMapIntensity: blockMaterial.envMapIntensity,
            maps: ['albedo (seeded hairline)', 'roughness (seeded hairline)', 'normal (seeded hairline)'],
          },
          edge: {
            colorSrgb: MATERIAL_SPEC.edge.colorSrgb,
            metalness: edgeMaterial.metalness,
            roughness: edgeMaterial.roughness,
            clearcoat: edgeMaterial.clearcoat,
            envMapIntensity: edgeMaterial.envMapIntensity,
            maps: [],
          },
          symbol: {
            colorSrgb: MATERIAL_SPEC.symbol.colorSrgb,
            metalness: MATERIAL_SPEC.symbol.metalness,
            roughness: MATERIAL_SPEC.symbol.roughness,
            maps: ['albedo (Lexend glyph + chamfer)', 'normal (Lexend glyph relief)'],
          },
        },
        textures: {
          faceSize: faceMaps.size,
          symbolSize: SYMBOL_SPEC.textureSize,
          faceMaps: ['albedo', 'roughness', 'normal'],
          symbolMapsPerBlock: ['albedo', 'normal'],
          total: 3 + blocks.length * 2,
        },
        faceStats: faceMaps.stats,
        font: {
          family: font.family,
          cssFamily: font.cssFamily,
          weight: font.weight,
          url: font.url,
          loaded: Boolean(font.loaded),
          covers: Boolean(font.covers),
          coversGlyphs: Boolean(font.coversGlyphs),
        },
        bounds: {
          min: { x: currentBounds.min.x, y: currentBounds.min.y, z: currentBounds.min.z },
          max: { x: currentBounds.max.x, y: currentBounds.max.y, z: currentBounds.max.z },
          size: { x: boundsSize.x, y: boundsSize.y, z: boundsSize.z },
        },
        checks: computeChecks(),
        currentTime,
      };
    },
    dispose() {
      const textures = [faceMaps.maps.albedoTex, faceMaps.maps.roughTex, faceMaps.maps.normalTex];
      for (const block of blocks) {
        textures.push(block.symbolMaterial.map, block.symbolMaterial.normalMap);
      }
      const materials = [blockMaterial, edgeMaterial].concat(blocks.map((block) => block.symbolMaterial));
      blockGeometry.dispose();
      decalGeometry.dispose();
      for (const texture of textures) {
        try {
          if (texture) texture.dispose();
        } catch (error) {
          /* best effort */
        }
      }
      for (const material of materials) {
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
