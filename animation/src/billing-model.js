/**
 * tekoanimation — Billing documents model, v2 (round 4: face-down paper stack).
 *
 * The object is a HORIZONTAL stack of SEVEN translucent paper sheets floating
 * above the satin pedestal (the satin material is supplied by the page from the
 * columns deliverable bank: `loadColumnBank().materials.satin`, cloned so it
 * inherits the current satin grain/reflection). The sheets are FACE DOWN: the
 * camera (fixed 45° three-quarter, elevation 19°) looks down at the blank paper
 * back, while the printed graphic side is on the UNDERSIDE and — because paper is
 * translucent, and because every sheet carries an underlight glow card beneath
 * its print — the marks and the light from below read through the sheet.
 *
 * Unit convention: 1 world unit = 1 source px, matching the columns deliverable
 * (the satin albedo/normal/roughness maps are authored for that scale: one satin
 * texture tile covers 260 px x UV_DENSITY_SCALE = 338 world px).
 *
 * Sheet artwork is PROCEDURAL and LOCAL: deterministic canvas textures painted
 * from seeded mulberry32 PRNGs — no Math.random, no fetch, no external image, no
 * font dependency. There is NO readable text anywhere: no TEKO wordmark, no
 * amounts, no transaction copy, no letters or numbers. The print is only abstract
 * graphic language: thick short bars in loose rows (text-line rhythm without
 * forming letters), rounded strokes, dot-matrix fields, line/PCB-like traces,
 * thin rules, rounded-rect outlines, corner registration ticks and colour fields.
 *
 * Three treatments bottom -> top (2 WHITE / 2 GOLD / 3 PCB):
 *   - WHITE (0-1): warm-white paper with deterministic fibre/mottle, black
 *     abstract marks, white underlight + white rim.
 *   - GOLD (2-3): white -> gold RADIAL paper (verified - edges white, centre
 *     gold), black + light grey-blue marks, gold underlight + gold rim.
 *   - PCB (4-6): light grey-blue paper with deterministic banding/mottle, PCB-like
 *     pattern in lighter same-tone marks (plus a few deeper same-tone traces, NO
 *     black), cool underlight + cool rim.
 *
 * Per-sheet layer construction (all children of the animated sheet group, so the
 * existing pose animation moves every layer together):
 *   glow  renderOrder base+0  additive underlight card (1.1x sheet), just below
 *   print renderOrder base+1  underside print, rotated PI about X (normal down),
 *                             BackSide so the camera above sees it through paper
 *   paper renderOrder base+2  blank translucent paper top surface
 *   rim   renderOrder base+3  existing bright edge strip
 * where base = sheetIndex * 8 (bottom sheet drawn first, top sheet last) so a
 * page that has not applied its camera-distance ordering yet still composites
 * correctly. The page re-derives the same ladder from `sheet.layers`.
 *
 * Layout model (deterministic):
 *   - `sheetPose(index, 'expanded')` is the fanned horizontal stack rising above
 *     the pedestal and sweeping LEFT as it climbs; a tiny per-treatment skew
 *     (+2° yaw gold / -1° yaw PCB) makes the three sets read as groups.
 *   - `sheetPose(index, 'condensed')` is a tight pile on the RIGHT side of the
 *     pedestal, so playing the unfold reads as "right to left, upward".
 *   - The animation itself (staggered lerp) lives in the page controller; the two
 *     pose tables and the pure interpolation helpers are exported here so the
 *     choreography is testable without a DOM/browser.
 *
 * Geometry:
 *   - every sheet: a subdivided, corner-clamped rounded-rect surface with a
 *     gentle bow (centre up), plus a thin extruded rim strip (bright edge), all
 *     shared by the seven sheets;
 *   - the underlight card is a shared 1.1x PlaneGeometry;
 *   - pedestal: a rounded box (extruded rounded-rect plan, bevelled top/bottom)
 *     with world-scale per-face UVs + uv2 (the satin material samples aoMap from
 *     uv2, exactly like the columns model).
 *
 * Public API (frozen for ./billing-preview.js):
 *   MODEL_VERSION, SHEET_COUNT, TREATMENTS, GOLD_START_INDEX, WARM_SHEET_INDEX,
 *   SHEET_SPEC, LAYER_SPEC, PEDESTAL_SPEC, UV_DENSITY_SCALE, SATIN_TILE_PX,
 *   SATIN_FALLBACK, TEXTURE_SPEC, LAYOUT, TREATMENT_POSE_SKEW, CAMERA_SPEC,
 *   ANIMATION_SPEC, SHEET_META, treatmentForIndex,
 *   sheetPose(index, mode), lerpSheetPose(from, to, t), applySheetPose(sheet, pose),
 *   computeStackBounds(mode), createSeededRandom(seed), easeInOutCubic(t),
 *   artworkSpecFor(index), drawSheetArtwork(ctx, spec), createSheetTexture(index),
 *   paperArtworkSpecFor(treatment), drawPaperArtwork(ctx, spec),
 *   createPaperTexture(treatment), glowArtworkSpecFor(treatment),
 *   drawGlowArtwork(ctx, spec), createGlowTexture(treatment),
 *   buildSheetGeometries(spec), buildPedestalGeometry(spec, satinTilePx),
 *   createFallbackSatinMaterial({ tilePx }), createBillingModel(options)
 *
 * Everything is deterministic and local-only; there is no Math.random and no
 * network access anywhere in this module.
 */

import * as THREE from 'three';

/** Human-readable module version (not part of the page QA contract). */
export const MODEL_VERSION = '2.0.0';

/** The stack is exactly seven paper sheets (2 white / 2 gold / 3 PCB). */
export const SHEET_COUNT = 7;

/**
 * The three sheet treatments, bottom -> top. `count` is the number of sheets in
 * each group; `light` is the treatment's underlight colour (also used for the
 * rim); `lightId` is the short QA/debug tag.
 */
export const TREATMENTS = Object.freeze([
  Object.freeze({ id: 'white', label: 'White paper', count: 2, lightId: 'white', light: '#ffffff' }),
  Object.freeze({ id: 'gold', label: 'Gold field', count: 2, lightId: 'gold', light: '#ffb75e' }),
  Object.freeze({ id: 'pcb', label: 'PCB cool', count: 3, lightId: 'cool', light: '#aec6ff' }),
]);

/** Zero-based index of the first GOLD sheet (bottom -> top = 2 white, 2 gold, 3 PCB). */
export const GOLD_START_INDEX = 2;

/**
 * @deprecated v1 warm-sheet index, kept as a compatibility alias so older QA
 * reads still get a meaningful number (it is now the first gold sheet). The
 * single-warm-sheet concept is gone; there are three treatments instead.
 */
export const WARM_SHEET_INDEX = GOLD_START_INDEX;

/**
 * Sheet dimensions in source px (1 unit = 1 px). Portrait paper, 3:4.
 * `radius` is the Revolut-style corner radius; `bow` is the gentle centre-up
 * curvature of the paper (world px); `thickness` is the paper thickness that the
 * bright rim strip spans.
 */
export const SHEET_SPEC = Object.freeze({
  width: 180,
  height: 240,
  radius: 15,
  thickness: 2.8,
  bow: 4.5,
  gridX: 56,
  gridY: 74,
});

/**
 * Face-down layering constants, in sheet-local px / degrees.
 * The paper sits at z = 0; the print and the underlight card hang BELOW it
 * (negative z in sheet-local space is world DOWN once the sheet is pitched flat).
 * `renderOrderStride` is the renderOrder span reserved per sheet.
 */
export const LAYER_SPEC = Object.freeze({
  printDrop: 0.15,
  glowDrop: 4,
  glowScale: 1.1,
  renderOrderStride: 8,
});

/**
 * Satin pedestal in source px: a rounded plinth, 360 wide x 210 deep x 90 tall
 * (top face at world y = 90). Unchanged from v1.
 */
export const PEDESTAL_SPEC = Object.freeze({
  width: 360,
  depth: 210,
  height: 90,
  radius: 30,
  bevel: 6,
  centerX: -55,
  centerZ: 0,
});

/**
 * The columns deliverable bakes `manifestTilePx x UV_DENSITY_SCALE` world px per
 * texture tile on every face (columns-model.js UV_DENSITY_SCALE). Keep the same
 * density here so the satin grain keeps the exact physical scale it has on the
 * columns page.
 */
export const UV_DENSITY_SCALE = 1.3;

/** Default satin `tilePx` from the columns material manifest (world px/tile). */
export const SATIN_TILE_PX = 260;

/**
 * Satin fallback values. They mirror columns-model.js MATERIAL_TUNING.satin so a
 * degraded boot (columns bank temporarily unavailable) still reports the same
 * satin material contract in QA. The texture maps are of course missing in that
 * fallback; the page reports `satin.source = 'fallback'` in debug().
 */
export const SATIN_FALLBACK = Object.freeze({
  metalness: 1.0,
  roughness: 0.8,
  envMapIntensity: 2.4,
  colorSrgb: '#969ba3',
});

/** Procedural map sizes (3:4 print/paper, square glow). */
export const TEXTURE_SPEC = Object.freeze({
  print: Object.freeze({ width: 768, height: 1024 }),
  paper: Object.freeze({ width: 384, height: 512 }),
  glow: Object.freeze({ width: 256, height: 256 }),
});

/**
 * Expanded (fanned horizontal stack) and condensed (tight pile) sheet layouts.
 *
 * Each sheet pose = base + step * index for the position, and
 * base + step * (index - (SHEET_COUNT-1)/2) for the rotations (so the fan is
 * symmetric around its middle sheet). Positions are in the `billing-stack`
 * group's local space; the pedestal stands on world y = 0 (top face y = 90).
 *
 * Every sheet is pitched flat (pitch = -90°): the sheet's local +Y (texture top
 * edge) points away from the camera (-Z), its face normal points up. Expanded,
 * the stack starts just above the pedestal (baseY 126) and rises 32 px per sheet
 * while sweeping left (stepX -7) and gently receding (stepZ -5). Condensed, it is
 * a tight pile on the right of the pedestal (x 62..76) with 3.6 px steps.
 * A small per-treatment skew is added on top in `sheetPose` (TREATMENT_POSE_SKEW).
 */
export const LAYOUT = Object.freeze({
  expanded: Object.freeze({
    baseX: 30,
    stepX: -13,
    baseY: 122,
    stepY: 27,
    baseZ: 26,
    stepZ: -6,
    baseYawDeg: 0,
    stepYawDeg: 1.1,
    baseRollDeg: 0,
    stepRollDeg: 0.35,
    basePitchDeg: -90,
    stepPitchDeg: -0.5,
  }),
  condensed: Object.freeze({
    baseX: 54,
    stepX: 2.4,
    baseY: 100,
    stepY: 3.6,
    baseZ: 16,
    stepZ: 1.2,
    baseYawDeg: 0,
    stepYawDeg: 0.35,
    baseRollDeg: 0,
    stepRollDeg: 0.15,
    basePitchDeg: -90,
    stepPitchDeg: -0.12,
  }),
});

/**
 * Tiny deterministic per-treatment pose skew (degrees / world px), added on top
 * of the layout lattice so the three groups read as distinct sets rather than a
 * uniform lattice: gold turns slightly more +yaw and forward, PCB slightly
 * -yaw. Pure function of the sheet index (never random).
 */
export const TREATMENT_POSE_SKEW = Object.freeze({
  white: Object.freeze({ yawDeg: 0, rollDeg: 0, pitchDeg: 0, dz: 0 }),
  gold: Object.freeze({ yawDeg: 2, rollDeg: 0.2, pitchDeg: 0.35, dz: 1.5 }),
  pcb: Object.freeze({ yawDeg: -1, rollDeg: -0.15, pitchDeg: -0.25, dz: -1 }),
});

/**
 * Fixed 45° three-quarter camera (contract B3): azimuth is measured from +Z
 * towards +X; elevation is above the horizon. The page fits the expanded stack
 * numerically for every stage aspect, so only the distance changes.
 */
export const CAMERA_SPEC = Object.freeze({
  fov: 30,
  azimuthDeg: 45,
  elevationDeg: 19,
  near: 20,
  far: 12000,
  // Projected-corner NDC margin used by the page's fit (0.97 — 1.5 % padding on
  // every side once the target is centred on the projected silhouette).
  fitMargin: 0.97,
  // Narrow/phone stages keep a little more breathing room above the stack and
  // below the pedestal so the stage caption row never collides with the object.
  fitMarginNarrow: 0.88,
  narrowStageWidth: 700,
  targetYOffset: 0,
});

/**
 * Unfold choreography (unchanged v1 timing: ~1.8–2.4 s total, ease-in-out,
 * staggered bottom -> top). The page adds a 380 ms gather phase on Replay when
 * the stack is already expanded, so a replay from expanded takes ~2.3 s.
 */
export const ANIMATION_SPEC = Object.freeze({
  gatherMs: 380,
  sheetDelayMs: 50,
  staggerMs: 95,
  sheetDurationMs: 1300,
});

/* ------------------------------------------------------------------------- */
/* Small deterministic helpers                                               */
/* ------------------------------------------------------------------------- */

const DEG_TO_RAD = Math.PI / 180;
const HALF_SHEET_COUNT = (SHEET_COUNT - 1) / 2;
const TAU = Math.PI * 2;
const PRINT_PAD = 56;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;

/** Ease-in-out cubic; the page uses the same curve for the unfold. */
export function easeInOutCubic(t) {
  const value = clamp(Number(t) || 0, 0, 1);
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

/**
 * Deterministic PRNG (mulberry32). Every procedural detail in the artwork is
 * driven from one of these seeded streams — `Math.random` is never used, so the
 * textures are byte-identical across reloads and machines.
 * @param {number} seed 32-bit integer seed
 * @returns {() => number} deterministic 0..1 generator
 */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(random, min, max) {
  return min + (max - min) * random();
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function srgbColor(hex) {
  const color = new THREE.Color();
  const value = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  if (THREE.ColorManagement && THREE.ColorManagement.enabled) color.setHex(value);
  else color.setRGB(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  return color;
}

function hexToRgb(hex) {
  const value = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** CSS rgba() string from a #rrggbb literal + alpha (used by the 2D canvas art). */
export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + clamp(alpha, 0, 1).toFixed(3) + ')';
}

/** Darken / lighten a #rrggbb literal by `amount` (-1..1) for canvas gradients. */
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const mix = (channel) => Math.round(channel + (target - channel) * t);
  const toHex = (channel) => clamp(mix(channel), 0, 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/* ------------------------------------------------------------------------- */
/* Treatment palettes, per-sheet metadata and grouping                       */
/* ------------------------------------------------------------------------- */

const WHITE_PALETTE = Object.freeze({
  paper: '#f3efe6',
  paperEdge: '#f7f4ec',
  paperMid: '#f3efe6',
  paperCenter: '#f3efe6',
  ink: '#0a0a0b',
  inkSoft: '#26262b',
  light: '#0a0a0b',
  deep: '#26262b',
  underlight: '#ffffff',
  edge: '#ffffff',
});

const GOLD_PALETTE = Object.freeze({
  paper: '#f7f4ec',
  paperEdge: '#f7f4ec',
  paperMid: '#efc884',
  paperCenter: '#e2a23a',
  ink: '#0a0a0b',
  inkSoft: '#c9d6e6',
  light: '#c9d6e6',
  deep: '#8ea4bf',
  underlight: '#ffb75e',
  edge: '#ffd08a',
});

const PCB_PALETTE = Object.freeze({
  paper: '#93a9c8',
  paperEdge: '#a6bad4',
  paperMid: '#93a9c8',
  paperCenter: '#93a9c8',
  ink: '#dbe6f6',
  inkSoft: '#7f95b5',
  light: '#dbe6f6',
  deep: '#8ea4bf',
  underlight: '#aec6ff',
  edge: '#a1c3ff',
});

const TREATMENT_PALETTES = Object.freeze({
  white: WHITE_PALETTE,
  gold: GOLD_PALETTE,
  pcb: PCB_PALETTE,
});

/** Abstract mark colours per treatment (metadata; also drives the print painter). */
const TREATMENT_MARKS = Object.freeze({
  white: Object.freeze(['#0a0a0b']),
  gold: Object.freeze(['#0a0a0b', '#c9d6e6']),
  pcb: Object.freeze(['#dbe6f6', '#8ea4bf']),
});

/** Fixed paper-texture seeds (one paper map per treatment). */
const PAPER_SEEDS = Object.freeze({ white: 8101, gold: 8209, pcb: 8317 });

/** Fixed glow-texture seeds (one underlight map per treatment). */
const GLOW_SEEDS = Object.freeze({ white: 9101, gold: 9209, pcb: 9317 });

function makeSheetMeta({ id, label, code, treatment, seed, opacity, glowOpacity }) {
  const palette = TREATMENT_PALETTES[treatment];
  return Object.freeze({
    id,
    label,
    code,
    treatment,
    tone: treatment,
    group: treatment,
    seed,
    // Paper top-surface opacity: low enough that the underside print + underlight
    // read through, high enough that the sheet still reads as paper.
    opacity,
    // Underlight card opacity: ramp brightest at the bottom of the stack.
    glowOpacity,
    paper: palette.paper,
    marks: TREATMENT_MARKS[treatment],
    underlight: palette.underlight,
    edge: palette.edge,
    palette,
  });
}

/**
 * Per-sheet identity + treatment metadata (bottom sheet first). `label` and
 * `code` are metadata only — they are NEVER painted on the sheets; no readable
 * text exists anywhere in the artwork.
 */
export const SHEET_META = Object.freeze([
  makeSheetMeta({ id: 'doc-01', label: 'White statement', code: 'DOC 2401', treatment: 'white', seed: 1021, opacity: 0.52, glowOpacity: 0.66 }),
  makeSheetMeta({ id: 'doc-02', label: 'White ledger', code: 'DOC 2402', treatment: 'white', seed: 2069, opacity: 0.52, glowOpacity: 0.44 }),
  makeSheetMeta({ id: 'doc-03', label: 'Gold statement', code: 'DOC 2403', treatment: 'gold', seed: 3121, opacity: 0.54, glowOpacity: 0.55 }),
  makeSheetMeta({ id: 'doc-04', label: 'Gold ledger', code: 'DOC 2404', treatment: 'gold', seed: 4177, opacity: 0.54, glowOpacity: 0.42 }),
  makeSheetMeta({ id: 'doc-05', label: 'PCB statement', code: 'DOC 2405', treatment: 'pcb', seed: 5233, opacity: 0.56, glowOpacity: 0.56 }),
  makeSheetMeta({ id: 'doc-06', label: 'PCB ledger', code: 'DOC 2406', treatment: 'pcb', seed: 6277, opacity: 0.56, glowOpacity: 0.44 }),
  makeSheetMeta({ id: 'doc-07', label: 'PCB archive', code: 'DOC 2407', treatment: 'pcb', seed: 7331, opacity: 0.56, glowOpacity: 0.34 }),
]);

/**
 * Treatment id for a sheet index (0..6, bottom -> top): two white, two gold,
 * three PCB. Pure function used by the pose tables, the painters and QA.
 * @param {number} index sheet index
 * @returns {'white'|'gold'|'pcb'}
 */
export function treatmentForIndex(index) {
  const safeIndex = clamp(Math.round(Number(index) || 0), 0, SHEET_COUNT - 1);
  let cursor = 0;
  for (const treatment of TREATMENTS) {
    cursor += treatment.count;
    if (safeIndex < cursor) return treatment.id;
  }
  return TREATMENTS[TREATMENTS.length - 1].id;
}

/** Counts of the three treatments in the stack. */
export const TREATMENT_COUNTS = Object.freeze({
  white: 2,
  gold: 2,
  pcb: 3,
});

/* ------------------------------------------------------------------------- */
/* Layout: pure pose tables + bounds                                         */
/* ------------------------------------------------------------------------- */

/**
 * Pose of one sheet for a layout mode.
 * @param {number} index 0 (bottom sheet) .. SHEET_COUNT-1 (top sheet)
 * @param {'expanded'|'condensed'} [mode='expanded']
 * @returns {{position:{x:number,y:number,z:number}, rotationDeg:{x:number,y:number,z:number}}}
 */
export function sheetPose(index, mode = 'expanded') {
  const layout = LAYOUT[mode];
  if (!layout) throw new Error('billing-model: unknown layout mode "' + mode + '"');
  const safeIndex = clamp(Math.round(Number(index) || 0), 0, SHEET_COUNT - 1);
  const offset = safeIndex - HALF_SHEET_COUNT;
  const skew = TREATMENT_POSE_SKEW[treatmentForIndex(safeIndex)] || TREATMENT_POSE_SKEW.white;
  const position = {
    x: layout.baseX + layout.stepX * safeIndex,
    y: layout.baseY + layout.stepY * safeIndex,
    z: layout.baseZ + layout.stepZ * safeIndex + skew.dz,
  };
  const rotationDeg = {
    x: layout.basePitchDeg + layout.stepPitchDeg * offset + skew.pitchDeg,
    y: layout.baseYawDeg + layout.stepYawDeg * offset + skew.yawDeg,
    z: layout.baseRollDeg + layout.stepRollDeg * offset + skew.rollDeg,
  };
  return { position, rotationDeg };
}

/**
 * Interpolate two sheet poses (positions in world px, rotations in degrees).
 * @param {object} from pose from sheetPose()
 * @param {object} to pose from sheetPose()
 * @param {number} t 0..1 (already eased by the caller if desired)
 */
export function lerpSheetPose(from, to, t) {
  const k = clamp(Number(t) || 0, 0, 1);
  return {
    position: {
      x: lerp(from.position.x, to.position.x, k),
      y: lerp(from.position.y, to.position.y, k),
      z: lerp(from.position.z, to.position.z, k),
    },
    rotationDeg: {
      x: lerp(from.rotationDeg.x, to.rotationDeg.x, k),
      y: lerp(from.rotationDeg.y, to.rotationDeg.y, k),
      z: lerp(from.rotationDeg.z, to.rotationDeg.z, k),
    },
  };
}

/** Apply a pose to a sheet's mesh group (rotation order YXZ: yaw, pitch, roll). */
export function applySheetPose(sheet, pose) {
  if (!sheet || !sheet.mesh || !pose) return false;
  sheet.mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
  sheet.mesh.rotation.set(
    pose.rotationDeg.x * DEG_TO_RAD,
    pose.rotationDeg.y * DEG_TO_RAD,
    pose.rotationDeg.z * DEG_TO_RAD,
    'YXZ',
  );
  return true;
}

/**
 * Axis-aligned bounds of the seven sheet groups (all four layers included: the
 * underlight card is 1.1x the sheet) in `stack` local space.
 */
export function computeStackBounds(mode = 'expanded') {
  const halfW = (SHEET_SPEC.width * LAYER_SPEC.glowScale) / 2;
  const halfH = (SHEET_SPEC.height * LAYER_SPEC.glowScale) / 2;
  const halfD = SHEET_SPEC.thickness / 2 + LAYER_SPEC.glowDrop + 1;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let index = 0; index < SHEET_COUNT; index += 1) {
    const pose = sheetPose(index, mode);
    const rx = pose.rotationDeg.x * DEG_TO_RAD;
    const ry = pose.rotationDeg.y * DEG_TO_RAD;
    const rz = pose.rotationDeg.z * DEG_TO_RAD;
    const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    matrix.setPosition(pose.position.x, pose.position.y, pose.position.z);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const point = new THREE.Vector3(sx * halfW, sy * halfH, sz * halfD).applyMatrix4(matrix);
          min.x = Math.min(min.x, point.x);
          min.y = Math.min(min.y, point.y);
          min.z = Math.min(min.z, point.z);
          max.x = Math.max(max.x, point.x);
          max.y = Math.max(max.y, point.y);
          max.z = Math.max(max.z, point.z);
        }
      }
    }
  }
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  return { mode, min, max, center, size };
}

/* ------------------------------------------------------------------------- */
/* Procedural print artwork (2D canvas, deterministic, abstract only)        */
/* ------------------------------------------------------------------------- */

/** Rounded-rect path helper (no ctx.roundRect dependency). */
function pathRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fillStyle) {
  pathRoundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth) {
  pathRoundRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function dot(ctx, x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.6, radius), 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Thin unlit rules (abstract underlines / column rules). */
function drawRules(ctx, { x, width, ys, color, thickness }) {
  ctx.fillStyle = color;
  for (const y of ys) ctx.fillRect(x, y, width, thickness);
}

/** Corner registration ticks (abstract security-print marks, no letters). */
function drawCornerTicks(ctx, width, height, color) {
  const inset = 76;
  const tick = 36;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  const corners = [
    { x: inset, y: inset, dx: 1, dy: 1 },
    { x: width - inset, y: inset, dx: -1, dy: 1 },
    { x: inset, y: height - inset, dx: 1, dy: -1 },
    { x: width - inset, y: height - inset, dx: -1, dy: -1 },
  ];
  for (const corner of corners) {
    ctx.beginPath();
    ctx.moveTo(corner.x + tick * corner.dx, corner.y);
    ctx.lineTo(corner.x, corner.y);
    ctx.lineTo(corner.x, corner.y + tick * corner.dy);
    ctx.stroke();
  }
}

/** Printed frame: rounded outer rule, inner hairline and corner ticks. */
function drawPrintFrame(ctx, spec, frameColor, hairlineColor, tickColor) {
  const width = spec.width;
  const height = spec.height;
  const outer = 34;
  strokeRoundRect(ctx, outer, outer, width - outer * 2, height - outer * 2, Math.max(10, spec.radiusPx - 18), frameColor, 4);
  const inner = 52;
  strokeRoundRect(ctx, inner, inner, width - inner * 2, height - inner * 2, Math.max(8, spec.radiusPx - 34), hairlineColor, 1.6);
  drawCornerTicks(ctx, width, height, tickColor);
}

/**
 * Thick short bars in loose rows: the rhythm of statement lines without ever
 * forming a letter (bars only, rounded caps, varying lengths per seeded stream).
 */
function drawBarRows(ctx, random, options) {
  const { x, y, width, rows, rowGap, height, minScale, maxScale, colors } = options;
  for (let row = 0; row < rows; row += 1) {
    const rowY = y + row * rowGap;
    const count = 1 + (random() > 0.5 ? 1 : 0) + (random() > 0.85 ? 1 : 0);
    let cursor = x + width * randomBetween(random, 0, 0.12);
    for (let i = 0; i < count; i += 1) {
      const barWidth = Math.min(width * randomBetween(random, minScale, maxScale), x + width - cursor);
      if (barWidth < height * 1.2) break;
      const color = colors[Math.floor(random() * colors.length) % colors.length];
      fillRoundRect(ctx, cursor, rowY, barWidth, height, height / 2, color);
      cursor += barWidth + width * randomBetween(random, 0.05, 0.14);
    }
  }
}

/** Rows of dashes (gold treatment's grey-blue rhythm marks). */
function drawDashRows(ctx, random, options) {
  const { x, y, width, rows, rowGap, height, colors } = options;
  for (let row = 0; row < rows; row += 1) {
    const rowY = y + row * rowGap;
    let cursor = x + width * randomBetween(random, 0, 0.08);
    while (cursor < x + width - height) {
      const dash = width * randomBetween(random, 0.022, 0.07);
      const visible = Math.min(dash, x + width - cursor);
      const color = colors[Math.floor(random() * colors.length) % colors.length];
      fillRoundRect(ctx, cursor, rowY, visible, height, height / 2, color);
      cursor += dash + width * randomBetween(random, 0.012, 0.042);
    }
  }
}

/** Dot-matrix data field (abstract dots only). */
function drawDotField(ctx, random, options) {
  const { x, y, width, height, cols, rows, skip, radius, colors } = options;
  const stepX = width / cols;
  const stepY = height / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (random() < skip) continue;
      const jitterX = randomBetween(random, -stepX * 0.12, stepX * 0.12);
      const jitterY = randomBetween(random, -stepY * 0.12, stepY * 0.12);
      const r = radius * randomBetween(random, 0.7, 1.25);
      const color = colors[Math.floor(random() * colors.length) % colors.length];
      dot(ctx, x + stepX * (col + 0.5) + jitterX, y + stepY * (row + 0.5) + jitterY, r, color);
    }
  }
}

/** PCB-like traces: 90°/45° segments with rounded caps/joins, pads and vias. */
function drawPcbTraces(ctx, random, spec, count) {
  const width = spec.width;
  const height = spec.height;
  const light = spec.palette.ink;
  const deep = spec.palette.inkSoft;
  const scale = width / 768;
  for (let trace = 0; trace < count; trace += 1) {
    let x = randomBetween(random, width * 0.08, width * 0.92);
    let y = randomBetween(random, height * 0.1, height * 0.9);
    const isDeep = random() > 0.72;
    const style = rgba(isDeep ? deep : light, isDeep ? 0.66 : 0.9);
    const lineWidth = randomBetween(random, 8, 13) * scale;
    const segments = 3 + Math.floor(random() * 4);
    let angle = [0, 45, 90, 135, 180, 225, 270, 315][Math.floor(random() * 8)];
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let segment = 0; segment < segments; segment += 1) {
      angle += [90, -90, 45, -45][Math.floor(random() * 4)];
      const length = randomBetween(random, 46, 165) * scale;
      const radians = (angle * Math.PI) / 180;
      x += Math.cos(radians) * length;
      y += Math.sin(radians) * length;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    // terminal pad / via (ring)
    ctx.beginPath();
    ctx.arc(x, y, lineWidth * 1.7, 0, TAU);
    ctx.strokeStyle = style;
    ctx.lineWidth = Math.max(2, lineWidth * 0.45);
    ctx.stroke();
  }
}

/** Scattered abstract specks (print grain). */
function drawSpecks(ctx, random, { width, height, count, colorFn }) {
  for (let i = 0; i < count; i += 1) {
    const x = randomBetween(random, PRINT_PAD, width - PRINT_PAD);
    const y = randomBetween(random, height * 0.26, height * 0.76);
    const size = width * randomBetween(random, 0.004, 0.01);
    fillRoundRect(ctx, x, y, size, size, size * 0.4, colorFn());
  }
}

/* ------------------------------------------------------------------------- */
/* WHITE print: black abstract marks on transparent background               */
/* ------------------------------------------------------------------------- */

function drawWhitePrint(ctx, spec, random) {
  const width = spec.width;
  const height = spec.height;
  const pad = PRINT_PAD;
  const ink = spec.palette.ink;
  const soft = spec.palette.inkSoft;

  // 1. Loose colour fields (soft black print washes).
  fillRoundRect(ctx, pad, height * 0.085, width - pad * 2, height * 0.3, 30, rgba(ink, 0.045));
  fillRoundRect(ctx, pad, height * 0.72, width - pad * 2, height * 0.16, 26, rgba(ink, 0.03));

  // 2. Printed frame + corner registration ticks.
  drawPrintFrame(ctx, spec, rgba(ink, 0.5), rgba(ink, 0.2), rgba(ink, 0.6));

  // 3. Thick short bars in loose rows (abstract statement-line rhythm).
  drawBarRows(ctx, random, {
    x: pad,
    y: height * 0.14,
    width: width - pad * 2,
    rows: 5,
    rowGap: height * 0.06,
    height: Math.round(width * 0.033),
    minScale: 0.16,
    maxScale: 0.44,
    colors: [rgba(ink, 0.96), rgba(ink, 0.84), rgba(ink, 0.66)],
  });

  // 4. Caption-sized bar cluster.
  let cursor = pad;
  for (let i = 0; i < 9; i += 1) {
    const barWidth = width * randomBetween(random, 0.018, 0.042);
    fillRoundRect(ctx, cursor, height * 0.455, barWidth, Math.round(width * 0.019), Math.round(width * 0.01), rgba(ink, randomBetween(random, 0.28, 0.58)));
    cursor += barWidth + width * randomBetween(random, 0.012, 0.028);
  }

  // 5. Dot-matrix field + right-hand dot strip.
  drawDotField(ctx, random, {
    x: pad,
    y: height * 0.525,
    width: width * 0.52,
    height: height * 0.2,
    cols: 12,
    rows: 7,
    skip: 0.15,
    radius: width * 0.0082,
    colors: [rgba(ink, 0.4), rgba(ink, 0.68), rgba(ink, 0.94)],
  });
  for (let i = 0; i < 12; i += 1) {
    dot(ctx, width - pad - width * 0.1, height * 0.525 + i * height * 0.017, width * 0.009, rgba(ink, 0.3 + random() * 0.55));
  }

  // 6. Thin rules.
  drawRules(ctx, { x: pad, width: width - pad * 2, ys: [height * 0.772, height * 0.798], color: rgba(ink, 0.22), thickness: 2 });
  drawRules(ctx, { x: pad, width: (width - pad * 2) * 0.42, ys: [height * 0.823], color: rgba(ink, 0.35), thickness: 3 });

  // 7. Chunky headline bars near the bottom (suggestion only, no glyphs).
  fillRoundRect(ctx, pad, height * 0.858, width * 0.46, Math.round(width * 0.044), Math.round(width * 0.022), rgba(ink, 0.92));
  fillRoundRect(ctx, pad, height * 0.918, width * 0.3, Math.round(width * 0.044), Math.round(width * 0.022), rgba(ink, 0.86));
  fillRoundRect(ctx, pad + width * 0.34, height * 0.918, width * 0.12, Math.round(width * 0.044), Math.round(width * 0.022), rgba(soft, 0.8));

  // 8. Print grain.
  drawSpecks(ctx, random, { width, height, count: 26, colorFn: () => rgba(ink, randomBetween(random, 0.15, 0.45)) });
}

/* ------------------------------------------------------------------------- */
/* GOLD print: black + light grey-blue marks on transparent background       */
/* ------------------------------------------------------------------------- */

function drawGoldPrint(ctx, spec, random) {
  const width = spec.width;
  const height = spec.height;
  const pad = PRINT_PAD;
  const ink = spec.palette.ink;
  const light = spec.palette.inkSoft;

  // 1. Soft grey-blue colour fields + a faint dark wash.
  fillRoundRect(ctx, width * 0.46, height * 0.08, width * 0.42, height * 0.17, 44, rgba(light, 0.2));
  fillRoundRect(ctx, pad, height * 0.335, width * 0.5, height * 0.1, 30, rgba(light, 0.12));
  fillRoundRect(ctx, pad, height * 0.74, width - pad * 2, height * 0.12, 26, rgba(ink, 0.05));
  fillRoundRect(ctx, width * 0.58, height * 0.5, width * 0.32, height * 0.16, 34, rgba(light, 0.08));

  // 2. Printed frame in grey-blue + black ticks.
  drawPrintFrame(ctx, spec, rgba(light, 0.52), rgba(ink, 0.16), rgba(ink, 0.5));

  // 3. Black line rows (thick bars, abstract only).
  drawBarRows(ctx, random, {
    x: pad,
    y: height * 0.15,
    width: width - pad * 2,
    rows: 3,
    rowGap: height * 0.062,
    height: Math.round(width * 0.032),
    minScale: 0.18,
    maxScale: 0.46,
    colors: [rgba(ink, 0.96), rgba(ink, 0.82), rgba(ink, 0.64)],
  });

  // 4. Grey-blue dash rows.
  drawDashRows(ctx, random, {
    x: pad,
    y: height * 0.375,
    width: width - pad * 2,
    rows: 3,
    rowGap: height * 0.057,
    height: Math.round(width * 0.025),
    colors: [rgba(light, 0.94), rgba(light, 0.76), rgba(light, 0.56)],
  });

  // 5. Dot-matrix field.
  drawDotField(ctx, random, {
    x: pad,
    y: height * 0.55,
    width: width * 0.5,
    height: height * 0.17,
    cols: 9,
    rows: 5,
    skip: 0.18,
    radius: width * 0.0105,
    colors: [rgba(light, 0.5), rgba(light, 0.74), rgba(light, 0.95)],
  });

  // 6. Thin rules + short accent rule.
  drawRules(ctx, { x: pad, width: width - pad * 2, ys: [height * 0.782, height * 0.806], color: rgba(light, 0.34), thickness: 2 });
  drawRules(ctx, { x: pad, width: width * 0.34, ys: [height * 0.833], color: rgba(ink, 0.3), thickness: 3 });

  // 7. Bottom bars: two black headline bars + a grey-blue field bar.
  fillRoundRect(ctx, pad, height * 0.852, width * 0.47, Math.round(width * 0.046), Math.round(width * 0.023), rgba(ink, 0.9));
  fillRoundRect(ctx, pad, height * 0.912, width * 0.28, Math.round(width * 0.046), Math.round(width * 0.023), rgba(ink, 0.84));
  fillRoundRect(ctx, pad + width * 0.32, height * 0.912, width * 0.19, Math.round(width * 0.046), Math.round(width * 0.023), rgba(light, 0.72));

  // 8. Print grain (mixed ink + grey-blue specks).
  drawSpecks(ctx, random, {
    width,
    height,
    count: 30,
    colorFn: () => (random() > 0.6 ? rgba(light, randomBetween(random, 0.3, 0.65)) : rgba(ink, randomBetween(random, 0.12, 0.35))),
  });
}

/* ------------------------------------------------------------------------- */
/* PCB print: lighter same-tone marks (never black) on transparent bg        */
/* ------------------------------------------------------------------------- */

function drawPcbPrint(ctx, spec, random) {
  const width = spec.width;
  const height = spec.height;
  const pad = PRINT_PAD;
  const light = spec.palette.ink;
  const deep = spec.palette.inkSoft;

  // 1. Same-tone colour fields.
  fillRoundRect(ctx, pad, height * 0.09, width - pad * 2, height * 0.26, 34, rgba(light, 0.1));
  fillRoundRect(ctx, pad, height * 0.62, width - pad * 2, height * 0.28, 30, rgba(deep, 0.06));

  // 2. Printed frame in the light tone + deeper hairline.
  drawPrintFrame(ctx, spec, rgba(light, 0.5), rgba(deep, 0.3), rgba(light, 0.6));

  // 3. PCB traces first so the bars/pads layer above them.
  drawPcbTraces(ctx, random, spec, 16);

  // 4. Pads and vias (ring + filled core), light/deep same-tone only.
  for (let i = 0; i < 12; i += 1) {
    const x = randomBetween(random, width * 0.1, width * 0.9);
    const y = randomBetween(random, height * 0.14, height * 0.82);
    const radius = width * randomBetween(random, 0.016, 0.03);
    const isDeep = random() > 0.7;
    const style = rgba(isDeep ? deep : light, isDeep ? 0.66 : 0.9);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.strokeStyle = style;
    ctx.lineWidth = Math.max(2, width * 0.005);
    ctx.stroke();
    dot(ctx, x, y, radius * 0.34, rgba(isDeep ? light : deep, 0.6));
  }

  // 5. Fine dot grid.
  drawDotField(ctx, random, {
    x: width * 0.08,
    y: height * 0.425,
    width: width * 0.84,
    height: height * 0.42,
    cols: 16,
    rows: 9,
    skip: 0.2,
    radius: width * 0.0084,
    colors: [rgba(light, 0.42), rgba(light, 0.68), rgba(deep, 0.54)],
  });

  // 6. Thick abstract bars in the upper third (the same statement rhythm, in
  //    lighter same-tone marks).
  drawBarRows(ctx, random, {
    x: pad,
    y: height * 0.145,
    width: width - pad * 2,
    rows: 2,
    rowGap: height * 0.072,
    height: Math.round(width * 0.03),
    minScale: 0.18,
    maxScale: 0.42,
    colors: [rgba(light, 0.95), rgba(light, 0.76), rgba(deep, 0.6)],
  });

  // 7. Deeper same-tone rules + bottom headline bars.
  drawRules(ctx, { x: pad, width: width - pad * 2, ys: [height * 0.885], color: rgba(deep, 0.36), thickness: 2 });
  fillRoundRect(ctx, pad, height * 0.9, width * 0.42, Math.round(width * 0.04), Math.round(width * 0.02), rgba(light, 0.6));
  fillRoundRect(ctx, pad, height * 0.95, width * 0.26, Math.round(width * 0.04), Math.round(width * 0.02), rgba(deep, 0.45));

  // 8. Same-tone print grain.
  drawSpecks(ctx, random, {
    width,
    height,
    count: 34,
    colorFn: () => rgba(random() > 0.55 ? light : deep, randomBetween(random, 0.2, 0.55)),
  });
}

/**
 * Everything `drawSheetArtwork` needs for one sheet's print map. Kept as a plain
 * object so the painter can be unit-tested in Node against a mock 2D context.
 * @param {number} index 0..6
 * @param {number} [width] canvas width
 * @param {number} [height] canvas height
 */
export function artworkSpecFor(index, width = TEXTURE_SPEC.print.width, height = TEXTURE_SPEC.print.height) {
  const meta = SHEET_META[index];
  if (!meta) throw new Error('billing-model: no artwork spec for sheet index ' + index);
  return {
    kind: 'print',
    index,
    id: meta.id,
    treatment: meta.treatment,
    label: meta.label,
    code: meta.code,
    seed: meta.seed,
    width,
    height,
    radiusPx: Math.round((SHEET_SPEC.radius / SHEET_SPEC.width) * width),
    palette: meta.palette,
    marks: meta.marks,
    underlight: meta.underlight,
    faceDown: true,
  };
}

/**
 * Draw the deterministic abstract UNDERSIDE artwork for one sheet. The canvas
 * background stays TRANSPARENT — only marks/pattern colour fields are painted, so
 * the underlight card below the print glows through the gaps.
 *
 * There is deliberately no `fillText` anywhere in this module: no wordmark, no
 * amounts, no transaction copy, no letters or digits on any sheet.
 */
export function drawSheetArtwork(ctx, spec) {
  const width = spec.width;
  const height = spec.height;
  ctx.clearRect(0, 0, width, height);
  const random = createSeededRandom(spec.seed);
  if (spec.treatment === 'white') drawWhitePrint(ctx, spec, random);
  else if (spec.treatment === 'gold') drawGoldPrint(ctx, spec, random);
  else if (spec.treatment === 'pcb') drawPcbPrint(ctx, spec, random);
  else throw new Error('billing-model: unknown print treatment "' + spec.treatment + '"');
  return spec;
}

/* ------------------------------------------------------------------------- */
/* Paper maps + underlight glow maps (deterministic canvas)                  */
/* ------------------------------------------------------------------------- */

/** Spec for one treatment's opaque paper map (the blank back of the sheet). */
export function paperArtworkSpecFor(treatment, width = TEXTURE_SPEC.paper.width, height = TEXTURE_SPEC.paper.height) {
  const entry = TREATMENTS.find((candidate) => candidate.id === treatment);
  if (!entry) throw new Error('billing-model: unknown paper treatment "' + treatment + '"');
  return {
    kind: 'paper',
    treatment: entry.id,
    seed: PAPER_SEEDS[entry.id],
    width,
    height,
    palette: TREATMENT_PALETTES[entry.id],
  };
}

/** Paint one treatment's paper map: paper colour/field + deterministic fibre/mottle. */
export function drawPaperArtwork(ctx, spec) {
  const width = spec.width;
  const height = spec.height;
  const palette = spec.palette;
  const random = createSeededRandom(spec.seed);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, height);

  if (spec.treatment === 'gold') {
    // White -> gold RADIAL field: centre gold, edges warm white.
    const radius = Math.hypot(width, height) * 0.58;
    const field = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, radius);
    field.addColorStop(0, palette.paperCenter);
    field.addColorStop(0.36, palette.paperMid);
    field.addColorStop(0.66, '#f5e4bd');
    field.addColorStop(0.86, palette.paperEdge);
    field.addColorStop(1, palette.paperEdge);
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, width, height);
    // Fine warm mottle so the gradient reads as paper, not a flat ramp.
    for (let i = 0; i < 46; i += 1) {
      const x = randomBetween(random, 0, width);
      const y = randomBetween(random, 0, height);
      const r = randomBetween(random, 5, 24);
      const blot = ctx.createRadialGradient(x, y, 0, x, y, r);
      blot.addColorStop(0, random() > 0.5 ? 'rgba(255, 246, 226, 0.06)' : 'rgba(214, 168, 96, 0.05)');
      blot.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = blot;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 520; i += 1) {
      const x = randomBetween(random, 0, width);
      const y = randomBetween(random, 0, height);
      ctx.fillStyle = random() > 0.5 ? 'rgba(255, 249, 234, 0.05)' : 'rgba(206, 178, 130, 0.045)';
      ctx.fillRect(x, y, randomBetween(random, 1, 2.2), randomBetween(random, 1, 3.2));
    }
    return spec;
  }

  if (spec.treatment === 'pcb') {
    // Light grey-blue paper: horizontal banding + soft same-tone mottle.
    let bandY = 0;
    while (bandY < height) {
      const bandHeight = randomBetween(random, 3, 9);
      ctx.fillStyle = random() > 0.5 ? 'rgba(255, 255, 255, 0.03)' : 'rgba(142, 164, 191, 0.03)';
      ctx.fillRect(0, bandY, width, bandHeight);
      bandY += bandHeight + randomBetween(random, 1, 4);
    }
    const sheen = ctx.createLinearGradient(0, 0, 0, height);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
    sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    sheen.addColorStop(1, 'rgba(120, 140, 172, 0.08)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 34; i += 1) {
      const x = randomBetween(random, 0, width);
      const y = randomBetween(random, 0, height);
      const r = randomBetween(random, 6, 30);
      const blot = ctx.createRadialGradient(x, y, 0, x, y, r);
      blot.addColorStop(0, random() > 0.5 ? 'rgba(226, 238, 252, 0.07)' : 'rgba(128, 148, 175, 0.06)');
      blot.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = blot;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 420; i += 1) {
      const x = randomBetween(random, 0, width);
      const y = randomBetween(random, 0, height);
      ctx.fillStyle = random() > 0.5 ? 'rgba(236, 244, 255, 0.05)' : 'rgba(132, 152, 180, 0.05)';
      ctx.fillRect(x, y, randomBetween(random, 1, 2.4), randomBetween(random, 1, 3.4));
    }
    return spec;
  }

  // WHITE: warm-white paper, soft centre lift, edge vignette, fibre + mottle.
  const lift = ctx.createRadialGradient(width * 0.46, height * 0.4, 0, width * 0.46, height * 0.4, width * 0.82);
  lift.addColorStop(0, 'rgba(255, 252, 243, 0.55)');
  lift.addColorStop(0.55, 'rgba(255, 251, 240, 0.18)');
  lift.addColorStop(1, 'rgba(255, 250, 238, 0)');
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createRadialGradient(width * 0.5, height * 0.5, width * 0.3, width * 0.5, height * 0.5, width * 0.78);
  vignette.addColorStop(0, 'rgba(196, 186, 166, 0)');
  vignette.addColorStop(0.75, 'rgba(196, 186, 166, 0.06)');
  vignette.addColorStop(1, 'rgba(186, 174, 152, 0.16)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 70; i += 1) {
    const x = randomBetween(random, 0, width);
    const y = randomBetween(random, 0, height);
    const r = randomBetween(random, 4, 22);
    const blot = ctx.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, random() > 0.45 ? 'rgba(205, 194, 173, 0.05)' : 'rgba(255, 253, 247, 0.06)');
    blot.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = blot;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 900; i += 1) {
    const x = randomBetween(random, 0, width);
    const y = randomBetween(random, 0, height);
    ctx.fillStyle = random() > 0.5 ? 'rgba(206, 196, 176, 0.05)' : 'rgba(255, 255, 252, 0.06)';
    ctx.fillRect(x, y, randomBetween(random, 1, 2.2), randomBetween(random, 1, 3.4));
  }
  return spec;
}

/** Spec for one treatment's underlight glow map (black at the card edges). */
export function glowArtworkSpecFor(treatment, width = TEXTURE_SPEC.glow.width, height = TEXTURE_SPEC.glow.height) {
  const entry = TREATMENTS.find((candidate) => candidate.id === treatment);
  if (!entry) throw new Error('billing-model: unknown glow treatment "' + treatment + '"');
  return {
    kind: 'glow',
    treatment: entry.id,
    seed: GLOW_SEEDS[entry.id],
    light: entry.light,
    width,
    height,
  };
}

/**
 * Paint one treatment's underlight map: a soft white falloff to BLACK at the
 * card edges (the material colour tints it; additive blending turns black into
 * "adds nothing", so the card has no visible rectangle edge).
 */
export function drawGlowArtwork(ctx, spec) {
  const width = spec.width;
  const height = spec.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const cx = width * 0.5;
  const cy = height * 0.52;
  const radius = Math.min(width, height) * 0.52;
  const field = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  if (spec.treatment === 'gold') {
    field.addColorStop(0, 'rgba(255, 255, 255, 1)');
    field.addColorStop(0.3, 'rgba(255, 255, 255, 0.66)');
    field.addColorStop(0.62, 'rgba(255, 255, 255, 0.24)');
    field.addColorStop(0.85, 'rgba(255, 255, 255, 0.06)');
    field.addColorStop(1, 'rgba(255, 255, 255, 0)');
  } else if (spec.treatment === 'pcb') {
    field.addColorStop(0, 'rgba(255, 255, 255, 0.82)');
    field.addColorStop(0.32, 'rgba(255, 255, 255, 0.56)');
    field.addColorStop(0.66, 'rgba(255, 255, 255, 0.22)');
    field.addColorStop(0.88, 'rgba(255, 255, 255, 0.06)');
    field.addColorStop(1, 'rgba(255, 255, 255, 0)');
  } else {
    field.addColorStop(0, 'rgba(255, 255, 255, 1)');
    field.addColorStop(0.38, 'rgba(255, 255, 255, 0.74)');
    field.addColorStop(0.7, 'rgba(255, 255, 255, 0.3)');
    field.addColorStop(0.9, 'rgba(255, 255, 255, 0.08)');
    field.addColorStop(1, 'rgba(255, 255, 255, 0)');
  }
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, width, height);

  // Secondary band toward the card's lower edge: the physical light source sits
  // under the stack, so the underlight is a little brighter at the bottom.
  const band = ctx.createLinearGradient(0, height * 0.55, 0, height);
  band.addColorStop(0, 'rgba(255, 255, 255, 0)');
  band.addColorStop(0.65, spec.treatment === 'gold' ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.1)');
  band.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, height * 0.55, width, height * 0.45);
  return spec;
}

/* ------------------------------------------------------------------------- */
/* Canvas texture creation                                                   */
/* ------------------------------------------------------------------------- */

function resolveCanvas(createCanvas) {
  if (typeof createCanvas === 'function') return createCanvas();
  if (typeof document !== 'undefined' && document.createElement) return document.createElement('canvas');
  return null;
}

function configureCanvasTexture(canvas, meta, anisotropy) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = meta.name;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.encoding = THREE.sRGBEncoding;
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.userData = Object.freeze({
    procedural: true,
    local: true,
    width: meta.width,
    height: meta.height,
    seed: meta.seed,
    ...meta.userData,
  });
  return texture;
}

/**
 * Create the deterministic underside PRINT canvas texture for one sheet
 * (transparent background + abstract marks only).
 * @param {number} index 0..6
 * @param {{createCanvas?:() => HTMLCanvasElement}} [options] test hook
 * @returns {{texture:THREE.CanvasTexture, canvas:object, spec:object}}
 */
export function createSheetTexture(index, { createCanvas } = {}) {
  const canvas = resolveCanvas(createCanvas);
  if (!canvas) {
    throw new Error('billing-model: createSheetTexture() requires a DOM canvas (document.createElement) or a createCanvas factory');
  }
  const spec = artworkSpecFor(index);
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('billing-model: could not acquire a 2D canvas context for sheet ' + index);
  drawSheetArtwork(ctx, spec);
  const texture = configureCanvasTexture(canvas, {
    name: 'billing-sheet-print:' + spec.id,
    width: spec.width,
    height: spec.height,
    seed: spec.seed,
    userData: {
      role: 'sheet-print',
      kind: 'print',
      sheetId: spec.id,
      sheetIndex: spec.index,
      treatment: spec.treatment,
      faceDown: true,
      background: 'transparent (marks only; the underlight glows through the gaps)',
    },
  }, 8);
  return { texture, canvas, spec };
}

/**
 * Create the deterministic PAPER map for one treatment (opaque, blank back).
 * @param {'white'|'gold'|'pcb'} treatment
 * @param {{createCanvas?:() => HTMLCanvasElement}} [options]
 */
export function createPaperTexture(treatment, { createCanvas } = {}) {
  const canvas = resolveCanvas(createCanvas);
  if (!canvas) {
    throw new Error('billing-model: createPaperTexture() requires a DOM canvas (document.createElement) or a createCanvas factory');
  }
  const spec = paperArtworkSpecFor(treatment);
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('billing-model: could not acquire a 2D canvas context for paper "' + treatment + '"');
  drawPaperArtwork(ctx, spec);
  const texture = configureCanvasTexture(canvas, {
    name: 'billing-paper:' + treatment,
    width: spec.width,
    height: spec.height,
    seed: spec.seed,
    userData: {
      role: 'sheet-paper',
      kind: 'paper',
      treatment,
      marks: 'none (the printed side lives on the print layer below)',
    },
  }, 4);
  return { texture, canvas, spec };
}

/**
 * Create the deterministic UNDERLIGHT glow map for one treatment.
 * @param {'white'|'gold'|'pcb'} treatment
 * @param {{createCanvas?:() => HTMLCanvasElement}} [options]
 */
export function createGlowTexture(treatment, { createCanvas } = {}) {
  const canvas = resolveCanvas(createCanvas);
  if (!canvas) {
    throw new Error('billing-model: createGlowTexture() requires a DOM canvas (document.createElement) or a createCanvas factory');
  }
  const spec = glowArtworkSpecFor(treatment);
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('billing-model: could not acquire a 2D canvas context for glow "' + treatment + '"');
  drawGlowArtwork(ctx, spec);
  const texture = configureCanvasTexture(canvas, {
    name: 'billing-underlight:' + treatment,
    width: spec.width,
    height: spec.height,
    seed: spec.seed,
    userData: {
      role: 'sheet-glow',
      kind: 'glow',
      treatment,
      light: spec.light,
      falloff: 'soft radial white -> black at the card edges (additive)',
    },
  }, 4);
  return { texture, canvas, spec };
}

/* ------------------------------------------------------------------------- */
/* Geometry                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Map a regular (gridX x gridY) rectangle grid onto the rounded-rect silhouette
 * and bend it with a gentle centre-up bow (+z in sheet-local space, which points
 * UP once the sheet is pitched flat).
 */
function sheetGridPoint(spec, i, j) {
  const halfW = spec.width / 2;
  const halfH = spec.height / 2;
  const radius = spec.radius;
  const cornerX = halfW - radius;
  const cornerY = halfH - radius;
  const px = -halfW + (i / spec.gridX) * spec.width;
  const py = -halfH + (j / spec.gridY) * spec.height;
  let x = px;
  let y = py;
  if (Math.abs(px) > cornerX && Math.abs(py) > cornerY) {
    const signX = Math.sign(px) || 1;
    const signY = Math.sign(py) || 1;
    let dx = Math.abs(px) - cornerX;
    let dy = Math.abs(py) - cornerY;
    const distance = Math.hypot(dx, dy);
    if (distance > radius && distance > 0) {
      const scale = radius / distance;
      dx *= scale;
      dy *= scale;
    }
    x = signX * (cornerX + dx);
    y = signY * (cornerY + dy);
  }
  const u = x / halfW;
  const z = spec.bow * Math.cos(u * Math.PI * 0.5);
  return { x, y, z, u, v: y / halfH, i, j };
}

/**
 * Build the shared sheet surface + bright rim geometries.
 * All seven sheets share this pair (the paper / print / glow maps differ).
 * @returns {{surface:THREE.BufferGeometry, rim:THREE.BufferGeometry}}
 */
export function buildSheetGeometries(spec = SHEET_SPEC) {
  const cols = spec.gridX;
  const rows = spec.gridY;
  const vertexCount = (cols + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint16Array(cols * rows * 6);
  const halfW = spec.width / 2;
  const halfH = spec.height / 2;
  const points = new Array(vertexCount);

  let vertex = 0;
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const point = sheetGridPoint(spec, i, j);
      points[j * (cols + 1) + i] = point;
      positions[vertex * 3] = point.x;
      positions[vertex * 3 + 1] = point.y;
      positions[vertex * 3 + 2] = point.z;
      uvs[vertex * 2] = point.x / spec.width + 0.5;
      uvs[vertex * 2 + 1] = point.y / spec.height + 0.5;
      vertex += 1;
    }
  }

  let index = 0;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + (cols + 1);
      const d = c + 1;
      // Counter-clockwise (wound so computeVertexNormals() gives +Z in sheet-local
      // space, i.e. UP once the sheet is pitched flat). The paper top surface is
      // FrontSide and MUST be visible from the camera above; v1 could use
      // DoubleSide so this winding never mattered there.
      indices[index] = a;
      indices[index + 1] = b;
      indices[index + 2] = c;
      indices[index + 3] = b;
      indices[index + 4] = d;
      indices[index + 5] = c;
      index += 6;
    }
  }

  const surface = new THREE.BufferGeometry();
  surface.name = 'billing-sheet-surface';
  surface.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  surface.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  surface.setIndex(new THREE.BufferAttribute(indices, 1));
  surface.computeVertexNormals();
  surface.computeBoundingBox();
  surface.computeBoundingSphere();
  surface.userData = Object.freeze({
    role: 'sheet-surface',
    width: spec.width,
    height: spec.height,
    radius: spec.radius,
    bow: spec.bow,
    triangles: cols * rows * 2,
    uvMode: 'normalised rounded-rect coordinate (artwork frame follows the rounded silhouette)',
  });

  // Rim: walk the grid boundary (dense rounded corners included) and extrude a
  // thin strip across the sheet thickness. Drawn with an unlit bright material,
  // so normals are not needed for shading (they are still provided for tooling).
  const boundary = [];
  for (let i = 0; i <= cols; i += 1) boundary.push(points[0 * (cols + 1) + i]);
  for (let j = 1; j <= rows; j += 1) boundary.push(points[j * (cols + 1) + cols]);
  for (let i = cols - 1; i >= 0; i -= 1) boundary.push(points[rows * (cols + 1) + i]);
  for (let j = rows - 1; j >= 1; j -= 1) boundary.push(points[j * (cols + 1) + 0]);

  const segmentCount = boundary.length;
  const rimPositions = new Float32Array(segmentCount * 2 * 3);
  const rimUvs = new Float32Array(segmentCount * 2 * 2);
  const halfThickness = spec.thickness / 2;
  for (let k = 0; k < segmentCount; k += 1) {
    const point = boundary[k];
    const front = k * 2;
    const back = k * 2 + 1;
    rimPositions[front * 3] = point.x;
    rimPositions[front * 3 + 1] = point.y;
    rimPositions[front * 3 + 2] = point.z + halfThickness;
    rimPositions[back * 3] = point.x;
    rimPositions[back * 3 + 1] = point.y;
    rimPositions[back * 3 + 2] = point.z - halfThickness;
    rimUvs[front * 2] = k / segmentCount;
    rimUvs[front * 2 + 1] = 1;
    rimUvs[back * 2] = k / segmentCount;
    rimUvs[back * 2 + 1] = 0;
  }
  const rimIndices = [];
  for (let k = 0; k < segmentCount - 1; k += 1) {
    const a = k * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    rimIndices.push(a, b, c, c, b, d);
  }
  // close the loop (last -> first)
  {
    const a = (segmentCount - 1) * 2;
    const b = a + 1;
    const c = 0;
    const d = 1;
    rimIndices.push(a, b, c, c, b, d);
  }
  const rim = new THREE.BufferGeometry();
  rim.name = 'billing-sheet-rim';
  rim.setAttribute('position', new THREE.BufferAttribute(rimPositions, 3));
  rim.setAttribute('uv', new THREE.BufferAttribute(rimUvs, 2));
  rim.setIndex(rimIndices);
  rim.computeVertexNormals();
  rim.computeBoundingBox();
  rim.computeBoundingSphere();
  rim.userData = Object.freeze({
    role: 'sheet-rim',
    thickness: spec.thickness,
    segments: segmentCount,
    triangles: segmentCount * 2,
  });

  // Exact silhouette report for QA / docs.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  surface.userData = Object.freeze({
    ...surface.userData,
    bounds: Object.freeze({ min: Object.freeze({ x: minX, y: minY, z: minZ }), max: Object.freeze({ x: maxX, y: maxY, z: maxZ }) }),
    halfWidth: halfW,
    halfHeight: halfH,
  });

  return { surface, rim };
}

/** Rounded-rect plan shape for the pedestal (centred on the origin). */
function roundedRectShape(width, depth, radius) {
  const shape = new THREE.Shape();
  const halfW = width / 2;
  const halfD = depth / 2;
  const r = Math.max(0, Math.min(radius, halfW, halfD));
  shape.moveTo(-halfW + r, -halfD);
  shape.lineTo(halfW - r, -halfD);
  shape.quadraticCurveTo(halfW, -halfD, halfW, -halfD + r);
  shape.lineTo(halfW, halfD - r);
  shape.quadraticCurveTo(halfW, halfD, halfW - r, halfD);
  shape.lineTo(-halfW + r, halfD);
  shape.quadraticCurveTo(-halfW, halfD, -halfW, halfD - r);
  shape.lineTo(-halfW, -halfD + r);
  shape.quadraticCurveTo(-halfW, -halfD, -halfW + r, -halfD);
  shape.closePath();
  return shape;
}

/**
 * Build the satin pedestal: a bevelled rounded box standing on y = 0 with
 * world-scale per-face UVs (and uv2 for the satin aoMap), matching the columns
 * model's density (one tile = manifestTilePx x UV_DENSITY_SCALE world px).
 * @param {object} [spec=PEDESTAL_SPEC]
 * @param {number} [satinTilePx=SATIN_TILE_PX]
 * @returns {THREE.BufferGeometry}
 */
export function buildPedestalGeometry(spec = PEDESTAL_SPEC, satinTilePx = SATIN_TILE_PX) {
  const bevel = Math.max(0.5, spec.bevel);
  const innerWidth = Math.max(4, spec.width - bevel * 2);
  const innerDepth = Math.max(4, spec.depth - bevel * 2);
  const innerRadius = Math.max(2, spec.radius - bevel);
  const shape = roundedRectShape(innerWidth, innerDepth, innerRadius);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(4, spec.height - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 14,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(spec.centerX, 0, spec.centerZ);
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox ? geometry.boundingBox.min.y : 0;
  if (Math.abs(minY) > 1e-6) geometry.translate(0, -minY, 0);
  geometry.computeBoundingBox();

  // World-scale, right-handed planar UVs per dominant face axis (grain wraps
  // around the pedestal's vertical corners exactly like the columns' boxes).
  const effectiveTilePx = Math.max(1, Number(satinTilePx) || SATIN_TILE_PX) * UV_DENSITY_SCALE;
  const invTile = 1 / effectiveTilePx;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);
  const uv2 = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let u;
    let v;
    if (ay >= ax && ay >= az) {
      u = x * invTile;
      v = (ny >= 0 ? -z : z) * invTile;
    } else if (ax >= az) {
      u = (nx >= 0 ? -z : z) * invTile;
      v = y * invTile;
    } else {
      u = (nz >= 0 ? x : -x) * invTile;
      v = y * invTile;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
    uv2[i * 2] = u;
    uv2[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('uv2', new THREE.BufferAttribute(uv2, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const bounds = geometry.boundingBox;
  geometry.name = 'billing-pedestal';
  geometry.userData = Object.freeze({
    role: 'pedestal',
    width: spec.width,
    depth: spec.depth,
    height: spec.height,
    radius: spec.radius,
    bevel: spec.bevel,
    centerX: spec.centerX,
    centerZ: spec.centerZ,
    satinTilePx: Number(satinTilePx) || SATIN_TILE_PX,
    effectiveTilePx,
    uvDensityScale: UV_DENSITY_SCALE,
    uvMode: 'world-scale per-face planar mapping (dominant axis), right-handed; one tile = tilePx x 1.3 world px',
    uv2: 'duplicated UVs for the satin aoMap (three r151 samples aoMap from uv2 when the texture channel is 1)',
    bounds: Object.freeze({
      min: Object.freeze({ x: bounds.min.x, y: bounds.min.y, z: bounds.min.z }),
      max: Object.freeze({ x: bounds.max.x, y: bounds.max.y, z: bounds.max.z }),
    }),
  });
  return geometry;
}

/* ------------------------------------------------------------------------- */
/* Satin material (cloned from the columns bank)                             */
/* ------------------------------------------------------------------------- */

function materialValues(material) {
  return {
    metalness: typeof material.metalness === 'number' ? material.metalness : null,
    roughness: typeof material.roughness === 'number' ? material.roughness : null,
    envMapIntensity: typeof material.envMapIntensity === 'number' ? material.envMapIntensity : null,
    clearcoat: typeof material.clearcoat === 'number' ? material.clearcoat : null,
    color: material.color && typeof material.color.getHexString === 'function' ? '#' + material.color.getHexString() : null,
    maps: {
      map: Boolean(material.map),
      normalMap: Boolean(material.normalMap),
      roughnessMap: Boolean(material.roughnessMap),
      metalnessMap: Boolean(material.metalnessMap),
      aoMap: Boolean(material.aoMap),
      bumpMap: Boolean(material.bumpMap),
      envMap: Boolean(material.envMap),
    },
  };
}

/**
 * Fallback satin material used only when the columns bank cannot be loaded. It
 * mirrors the columns satin's numeric contract (metalness 1.0, roughness 0.8,
 * envMapIntensity 2.4) but has no derived maps; debug() reports
 * `satin.source = 'fallback'` so QA can tell the difference.
 */
export function createFallbackSatinMaterial({ tilePx = SATIN_TILE_PX, name = 'billing-pedestal-satin-fallback' } = {}) {
  const material = new THREE.MeshStandardMaterial({
    name,
    color: srgbColor(SATIN_FALLBACK.colorSrgb),
    metalness: SATIN_FALLBACK.metalness,
    roughness: SATIN_FALLBACK.roughness,
    envMapIntensity: SATIN_FALLBACK.envMapIntensity,
    dithering: true,
  });
  material.userData = {
    role: 'pedestal-satin',
    source: 'fallback',
    materialId: 'satin',
    tilePx,
    note: 'columns-model loadColumnBank() was unavailable; numeric satin contract preserved, derived grain/reflection maps missing',
  };
  return material;
}

function prepareSatin(source, satinTilePx) {
  if (source && source.isMaterial) {
    const clone = source.clone();
    clone.name = 'billing-pedestal-satin';
    const sourceUserData = source.userData && typeof source.userData === 'object' ? source.userData : {};
    clone.userData = {
      ...sourceUserData,
      role: 'pedestal-satin',
      source: 'columns-model',
      clonedFrom: source.name || 'column-material:satin',
      envMode: 'scene.environment (cloned envMap is null; the page PMREM studio environment feeds it)',
    };
    // The clone keeps the columns tuning verbatim (metalness/roughness/envMapIntensity
    // and all derived maps) so it inherits the latest satin grain/reflection.
    return {
      material: clone,
      source: 'columns',
      tilePx: satinTilePx,
      values: materialValues(clone),
      disposed: false,
    };
  }
  const material = createFallbackSatinMaterial({ tilePx: satinTilePx });
  return {
    material,
    source: 'fallback',
    tilePx: satinTilePx,
    values: materialValues(material),
    disposed: false,
  };
}

/* ------------------------------------------------------------------------- */
/* Per-sheet face-down layer materials                                       */
/* ------------------------------------------------------------------------- */

/**
 * Build the four materials of one face-down sheet:
 *   paper  MeshStandardMaterial (blank translucent top surface, the camera's view)
 *   print  MeshBasicMaterial, BackSide (the underside artwork seen through paper)
 *   glow   MeshBasicMaterial, additive (the underlight card below the print)
 *   edge   MeshBasicMaterial (the bright rim strip)
 * `face` is a legacy alias of `paper`.
 */
function createSheetMaterials(meta, index, textures) {
  const paper = new THREE.MeshStandardMaterial({
    name: 'billing-sheet-paper:' + meta.id,
    map: textures.paper,
    color: 0xffffff,
    transparent: true,
    opacity: meta.opacity,
    roughness: 0.6,
    metalness: 0.0,
    envMapIntensity: 0.55,
    side: THREE.FrontSide,
    depthWrite: false,
    dithering: true,
    toneMapped: true,
  });
  paper.userData = {
    role: 'sheet-paper',
    layer: 'paper',
    sheetId: meta.id,
    sheetIndex: index,
    treatment: meta.treatment,
    faceDown: true,
    baseOpacity: meta.opacity,
    maps: { map: true },
    note: 'blank translucent paper back (no marks); the print + underlight read through it',
  };

  const print = new THREE.MeshBasicMaterial({
    name: 'billing-sheet-print:' + meta.id,
    map: textures.print,
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    side: THREE.BackSide,
    depthWrite: false,
    dithering: true,
    toneMapped: true,
  });
  print.userData = {
    role: 'sheet-print',
    layer: 'print',
    sheetId: meta.id,
    sheetIndex: index,
    treatment: meta.treatment,
    faceDown: true,
    baseOpacity: 0.9,
    note: 'underside abstract print (transparent background, marks only); mesh is rotated PI about X so its normal faces down',
  };

  const glow = new THREE.MeshBasicMaterial({
    name: 'billing-sheet-glow:' + meta.id,
    map: textures.glow,
    color: srgbColor(meta.underlight),
    transparent: true,
    opacity: meta.glowOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    dithering: true,
    toneMapped: false,
  });
  glow.userData = {
    role: 'sheet-glow',
    layer: 'glow',
    sheetId: meta.id,
    sheetIndex: index,
    treatment: meta.treatment,
    light: meta.underlight,
    baseOpacity: meta.glowOpacity,
    note: 'additive underlight card below the print; fades to black at its edges',
  };

  const edge = new THREE.MeshBasicMaterial({
    name: 'billing-sheet-edge:' + meta.id,
    color: srgbColor(meta.edge),
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    dithering: true,
  });
  edge.userData = {
    role: 'sheet-edge',
    layer: 'rim',
    sheetId: meta.id,
    sheetIndex: index,
    treatment: meta.treatment,
    light: meta.edge,
  };

  return { paper, print, glow, edge, face: paper };
}

/* ------------------------------------------------------------------------- */
/* Model assembly                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Build the complete billing object: satin pedestal + seven face-down paper
 * sheets, each with glow (underlight), print (underside), paper (top) and rim.
 *
 * @param {object} [options]
 * @param {THREE.Material} [options.satinMaterial] `loadColumnBank().materials.satin`
 *        (cloned, never mutated); when omitted a numeric-contract fallback is used.
 * @param {number} [options.satinTilePx] satin manifest tilePx (default 260)
 * @param {'hero'|'preview'} [options.quality] accepted for API symmetry
 * @param {(index:number)=>{texture:THREE.Texture, canvas:object, spec:object}} [options.sheetTextureFactory]
 *        test hook for the per-sheet print maps (same shape as createSheetTexture)
 * @param {(treatment:string)=>{texture:THREE.Texture, canvas:object, spec:object}} [options.paperTextureFactory]
 *        test hook for the treatment paper maps
 * @param {(treatment:string)=>{texture:THREE.Texture, canvas:object, spec:object}} [options.glowTextureFactory]
 *        test hook for the treatment underlight maps
 * @returns {object} model handle (see file header / docs/billing.md)
 */
export function createBillingModel({
  satinMaterial = null,
  satinTilePx = SATIN_TILE_PX,
  quality = 'hero',
  sheetTextureFactory = null,
  paperTextureFactory = null,
  glowTextureFactory = null,
} = {}) {
  const root = new THREE.Group();
  root.name = 'billing-object';
  root.userData = { role: 'billing-object' };

  const tilePx = Number(satinTilePx) > 0 ? Number(satinTilePx) : SATIN_TILE_PX;
  const satin = prepareSatin(satinMaterial, tilePx);
  const pedestalGeometry = buildPedestalGeometry(PEDESTAL_SPEC, tilePx);
  const pedestal = new THREE.Mesh(pedestalGeometry, satin.material);
  pedestal.name = 'billing-pedestal';
  pedestal.castShadow = false;
  pedestal.receiveShadow = true;
  pedestal.userData = {
    role: 'pedestal',
    geometry: 'bevelled rounded box (extruded rounded-rect plan)',
    materialSource: satin.source,
    topY: PEDESTAL_SPEC.height,
  };
  root.add(pedestal);

  const stack = new THREE.Group();
  stack.name = 'billing-stack';
  stack.userData = { role: 'document-stack', faceDown: true };
  root.add(stack);

  // Shared geometry: sheet surface + rim + the 1.1x underlight card plane.
  const geometries = buildSheetGeometries(SHEET_SPEC);
  geometries.glow = new THREE.PlaneGeometry(
    SHEET_SPEC.width * LAYER_SPEC.glowScale,
    SHEET_SPEC.height * LAYER_SPEC.glowScale,
  );
  geometries.glow.name = 'billing-underlight-card';
  geometries.glow.userData = Object.freeze({
    role: 'sheet-glow-card',
    width: SHEET_SPEC.width * LAYER_SPEC.glowScale,
    height: SHEET_SPEC.height * LAYER_SPEC.glowScale,
    glowScale: LAYER_SPEC.glowScale,
    offsetZ: -(SHEET_SPEC.thickness / 2 + LAYER_SPEC.glowDrop),
  });

  // Treatment maps are shared by the sheets of one group; print maps are per sheet.
  const paperTextures = new Map();
  const glowTextures = new Map();
  for (const treatment of TREATMENTS) {
    const paperCreated = typeof paperTextureFactory === 'function'
      ? paperTextureFactory(treatment.id)
      : createPaperTexture(treatment.id);
    paperTextures.set(treatment.id, paperCreated.texture);
    const glowCreated = typeof glowTextureFactory === 'function'
      ? glowTextureFactory(treatment.id)
      : createGlowTexture(treatment.id);
    glowTextures.set(treatment.id, glowCreated.texture);
  }

  const printTextures = [];
  const sheets = SHEET_META.map((meta, index) => {
    const printCreated = typeof sheetTextureFactory === 'function'
      ? sheetTextureFactory(index)
      : createSheetTexture(index);
    printTextures.push(printCreated.texture);

    const faceTextures = {
      paper: paperTextures.get(meta.treatment),
      print: printCreated.texture,
      glow: glowTextures.get(meta.treatment),
    };
    const materials = createSheetMaterials(meta, index, faceTextures);
    const mesh = new THREE.Group();
    mesh.name = 'billing-sheet:' + meta.id;
    mesh.userData = {
      role: 'sheet',
      sheetId: meta.id,
      sheetIndex: index,
      treatment: meta.treatment,
      group: meta.treatment,
      label: meta.label,
      faceDown: true,
    };

    const base = index * LAYER_SPEC.renderOrderStride;

    // glow (underlight card) ----------------------------- base + 0
    const glow = new THREE.Mesh(geometries.glow, materials.glow);
    glow.name = 'billing-sheet-glow:' + meta.id;
    glow.position.z = -(SHEET_SPEC.thickness / 2 + LAYER_SPEC.glowDrop);
    glow.renderOrder = base + 0;
    glow.castShadow = false;
    glow.receiveShadow = false;
    glow.userData = { role: 'sheet-glow', sheetId: meta.id, sheetIndex: index, orderOffset: 0 };

    // print (underside artwork; rotated PI about X so its normal faces DOWN) -- base + 1
    const print = new THREE.Mesh(geometries.surface, materials.print);
    print.name = 'billing-sheet-print:' + meta.id;
    print.rotation.x = Math.PI;
    print.position.z = -(SHEET_SPEC.thickness / 2 + LAYER_SPEC.printDrop);
    print.renderOrder = base + 1;
    print.castShadow = false;
    print.receiveShadow = false;
    print.userData = { role: 'sheet-print', sheetId: meta.id, sheetIndex: index, orderOffset: 1, faceDown: true };

    // paper (blank translucent top surface, visible from above) ------- base + 2
    const paper = new THREE.Mesh(geometries.surface, materials.paper);
    paper.name = 'billing-sheet-paper:' + meta.id;
    paper.renderOrder = base + 2;
    paper.castShadow = false;
    paper.receiveShadow = false;
    paper.userData = { role: 'sheet-paper', sheetId: meta.id, sheetIndex: index, orderOffset: 2 };

    // rim (bright edge strip) --------------------------------- base + 3
    const rim = new THREE.Mesh(geometries.rim, materials.edge);
    rim.name = 'billing-sheet-rim:' + meta.id;
    rim.renderOrder = base + 3;
    rim.castShadow = false;
    rim.receiveShadow = false;
    rim.userData = { role: 'sheet-rim', sheetId: meta.id, sheetIndex: index, orderOffset: 3 };

    mesh.add(glow);
    mesh.add(print);
    mesh.add(paper);
    mesh.add(rim);
    stack.add(mesh);

    const layers = [
      { mesh: glow, role: 'glow', orderOffset: 0 },
      { mesh: print, role: 'print', orderOffset: 1 },
      { mesh: paper, role: 'paper', orderOffset: 2 },
      { mesh: rim, role: 'rim', orderOffset: 3 },
    ];

    const expanded = sheetPose(index, 'expanded');
    const condensed = sheetPose(index, 'condensed');
    const sheet = {
      id: meta.id,
      index,
      treatment: meta.treatment,
      group: meta.treatment,
      tone: meta.treatment,
      label: meta.label,
      code: meta.code,
      underlight: meta.underlight,
      edge: meta.edge,
      palette: meta.palette,
      marks: meta.marks,
      mesh,
      layers,
      surface: paper,
      rim,
      materials,
      texture: printCreated.texture,
      paperTexture: faceTextures.paper,
      glowTexture: faceTextures.glow,
      artworkSpec: printCreated.spec || null,
      expanded,
      condensed,
      quality,
    };
    applySheetPose(sheet, expanded);
    return sheet;
  });

  stack.updateMatrixWorld(true);
  root.updateMatrixWorld(true);

  const expandedBox = new THREE.Box3();
  const condensedBox = new THREE.Box3();
  const applyMode = (mode) => {
    for (const sheet of sheets) applySheetPose(sheet, mode === 'condensed' ? sheet.condensed : sheet.expanded);
    stack.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
  };
  applyMode('expanded');
  expandedBox.setFromObject(stack);
  applyMode('condensed');
  condensedBox.setFromObject(stack);
  // Include the pedestal in the framing bounds (it is static, so its box is the
  // same in both modes).
  const pedestalBox = new THREE.Box3().setFromObject(pedestal);
  for (const box of [expandedBox, condensedBox]) {
    box.union(pedestalBox);
  }
  applyMode('expanded');

  const toPlainBounds = (box) => ({
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    center: { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 },
    size: { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z },
  });

  // Exact silhouette point cloud used by the page's camera fit: the real sheet
  // surface + rim vertices, the four corners of each underlight card (so the
  // glow halo is never clipped) and the rounded pedestal vertices.
  const collectFitPoints = (mode) => {
    applyMode(mode);
    const points = [];
    const local = new THREE.Vector3();
    const surfacePositions = geometries.surface.getAttribute('position');
    const rimPositions = geometries.rim.getAttribute('position');
    const halfGlowW = (SHEET_SPEC.width * LAYER_SPEC.glowScale) / 2;
    const halfGlowH = (SHEET_SPEC.height * LAYER_SPEC.glowScale) / 2;
    for (const sheet of sheets) {
      for (let i = 0; i < surfacePositions.count; i += 3) {
        local.fromBufferAttribute(surfacePositions, i);
        sheet.mesh.localToWorld(local);
        points.push(local.x, local.y, local.z);
      }
      for (let i = 0; i < rimPositions.count; i += 1) {
        local.fromBufferAttribute(rimPositions, i);
        sheet.mesh.localToWorld(local);
        points.push(local.x, local.y, local.z);
      }
      const glowMesh = sheet.layers[0].mesh;
      for (const gx of [-halfGlowW, halfGlowW]) {
        for (const gy of [-halfGlowH, halfGlowH]) {
          local.set(gx, gy, 0);
          glowMesh.localToWorld(local);
          points.push(local.x, local.y, local.z);
        }
      }
    }
    const pedestalPositions = pedestalGeometry.getAttribute('position');
    const pedestalMatrix = pedestal.matrixWorld;
    for (let i = 0; i < pedestalPositions.count; i += 1) {
      local.set(pedestalPositions.getX(i), pedestalPositions.getY(i), pedestalPositions.getZ(i)).applyMatrix4(pedestalMatrix);
      points.push(local.x, local.y, local.z);
    }
    return Float32Array.from(points);
  };
  const fitPoints = { expanded: collectFitPoints('expanded') };
  applyMode('expanded');

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const seenMaterials = new Set();
    for (const sheet of sheets) {
      for (const material of [sheet.materials.paper, sheet.materials.print, sheet.materials.glow, sheet.materials.edge]) {
        if (!material || seenMaterials.has(material)) continue;
        seenMaterials.add(material);
        material.dispose();
      }
    }
    const seenTextures = new Set();
    const allTextures = [...printTextures, ...paperTextures.values(), ...glowTextures.values()];
    for (const texture of allTextures) {
      if (!texture || seenTextures.has(texture)) continue;
      seenTextures.add(texture);
      texture.dispose();
    }
    geometries.surface.dispose();
    geometries.rim.dispose();
    geometries.glow.dispose();
    pedestalGeometry.dispose();
    satin.material.dispose();
    stack.clear();
    root.clear();
  };

  return {
    version: MODEL_VERSION,
    quality,
    faceDown: true,
    root,
    stack,
    pedestal,
    sheets,
    geometries,
    textures: printTextures,
    paperTextures: Array.from(paperTextures.values()),
    glowTextures: Array.from(glowTextures.values()),
    satin,
    bounds: {
      expanded: toPlainBounds(expandedBox),
      condensed: toPlainBounds(condensedBox),
    },
    stackBounds: {
      expanded: computeStackBounds('expanded'),
      condensed: computeStackBounds('condensed'),
    },
    fitPoints,
    sheetCount: sheets.length,
    treatments: { ...TREATMENT_COUNTS },
    goldStartIndex: GOLD_START_INDEX,
    warmSheetIndex: WARM_SHEET_INDEX,
    dispose,
  };
}
