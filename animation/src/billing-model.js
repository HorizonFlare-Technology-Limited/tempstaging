/**
 * tekoanimation — Billing documents model, v3 (round 5: unified floating text
 * mockup, opaque faces, columns-satin column support).
 *
 * The object is a HORIZONTAL stack of SEVEN face-down paper sheets floating above
 * the COLUMNS DELIVERABLE'S SATIN COLUMN (the page instantiates
 * `createColumns(bank).columnsById['satin-large-long']`, passes that mesh in as
 * `columnInstance`, and the model reuses it as the support — no billing-owned
 * pedestal geometry is built here any more). The fixed 45°/19° camera looks down
 * at the blank paper backs.
 *
 * ROUND-5 changes from round 4:
 *   - UNIFIED TEXT MOCKUP: all seven sheets share ONE abstract typographic
 *     artwork — the same text-line pattern (header bar, title line, body line
 *     rows, amount bars, rules, dot field) painted once from one seed. Only the
 *     ink tone differs per treatment (white/gold dark, PCB light same-tone).
 *     There is still NO readable text: no letters, digits, words, amounts, codes
 *     or logo; the painter uses `fillRect` / rounded bars only, never `fillText`.
 *   - FLOATING LAYER: the unified mockup is its own mesh + own material, floating
 *     `LAYER_SPEC.mockupLift` world px ABOVE each sheet's paper surface. It is not
 *     painted into the paper albedo/map, so the graphic reads as a detached layer
 *     hovering over the paper.
 *   - OPAQUE FACES: the white and gold paper faces are opaque (transparent:false,
 *     opacity 1, depthWrite true); the PCB paper keeps the round-4 translucent
 *     spec (transparent, opacity < 1, depthWrite false). The underlight glow
 *     cards and the page's underlight pool are kept; on the opaque sheets the
 *     light now reads as the glow halo around the paper edge instead of shining
 *     through the sheet.
 *   - SUPPORT: the satin column instance from the columns deliverable is scaled to
 *     the billing footprint (SUPPORT_SPEC.width x depth), its top face at
 *     SUPPORT_SPEC.topY, and it is deliberately TALL: it runs down past the stage
 *     bottom and is cropped by the viewport. The paper stack keeps its round-4
 *     scale — the camera fit only takes the support vertices at/above
 *     SUPPORT_SPEC.cropY, never the whole column.
 *
 * Unit convention: 1 world unit = 1 source px, matching the columns deliverable
 * (the satin albedo/normal/roughness maps are authored for that scale: one satin
 * texture tile covers 260 px x UV_DENSITY_SCALE = 338 world px).
 *
 * Everything painted here is PROCEDURAL and LOCAL: deterministic canvas textures
 * from seeded mulberry32 PRNGs — no Math.random, no fetch, no external image, no
 * font dependency, no network.
 *
 * Three treatments bottom -> top (2 WHITE / 2 GOLD / 3 PCB):
 *   - WHITE (0-1): warm-white opaque paper, black unified mockup, white underlight
 *     + white rim.
 *   - GOLD (2-3): white -> gold RADIAL opaque paper, near-black unified mockup,
 *     gold underlight + gold rim.
 *   - PCB (4-6): light grey-blue translucent paper, light same-tone unified
 *     mockup, cool underlight + cool rim.
 *
 * Per-sheet layer construction (all children of the animated sheet group, so the
 * existing pose animation moves every layer together):
 *   glow   renderOrder base+0  additive underlight card (1.1x sheet), just below
 *   paper  renderOrder base+1  paper top surface (opaque white/gold, translucent
 *                              PCB), markings live on the separate mockup layer
 *   mockup renderOrder base+2  the floating unified text-mockup layer, lifted
 *                              above the paper surface (transparent background)
 *   rim    renderOrder base+3  existing bright edge strip
 * where base = sheetIndex * 8 (bottom sheet drawn first, top sheet last). The page
 * re-derives the same ladder from `sheet.layers`.
 *
 * Layout model (deterministic, unchanged from round 4):
 *   - `sheetPose(index, 'expanded')` is the fanned horizontal stack rising above
 *     the support and sweeping LEFT as it climbs; a tiny per-treatment skew
 *     (+2° yaw gold / -1° yaw PCB) makes the three sets read as groups.
 *   - `sheetPose(index, 'condensed')` is a tight pile on the RIGHT, so playing the
 *     unfold reads as "right to left, upward".
 *   - The animation itself (staggered lerp) lives in the page controller; the two
 *     pose tables and the pure interpolation helpers are exported here so the
 *     choreography is testable without a DOM/browser.
 *
 * Geometry:
 *   - every sheet: a subdivided, corner-clamped rounded-rect surface with a
 *     gentle bow (centre up), plus a thin extruded rim strip (bright edge), all
 *     shared by the seven sheets; the mockup layer reuses the same surface
 *     geometry, lifted in +Z (sheet local = world UP once pitched flat);
 *   - the underlight card is a shared 1.1x PlaneGeometry;
 *   - support: the columns deliverable's satin column mesh, rescaled/positioned by
 *     `prepareColumnSupport()` (geometry untouched, UVs stay the columns-baked
 *     per-face planar ones).
 *
 * Public API (frozen for ./billing-preview.js):
 *   MODEL_VERSION, SHEET_COUNT, TREATMENTS, GOLD_START_INDEX, WARM_SHEET_INDEX,
 *   SHEET_SPEC, LAYER_SPEC, SUPPORT_SPEC, PEDESTAL_SPEC (legacy alias),
 *   UV_DENSITY_SCALE, SATIN_TILE_PX, SATIN_FALLBACK, TEXTURE_SPEC, MOCKUP_SPEC,
 *   PAPER_FACE, LAYOUT, TREATMENT_POSE_SKEW, CAMERA_SPEC, ANIMATION_SPEC,
 *   SHEET_META, treatmentForIndex, resolveSupportScale(mesh, spec),
 *   prepareColumnSupport(mesh, spec), computeSupportBounds(support),
 *   sheetPose(index, mode), lerpSheetPose(from, to, t), applySheetPose(sheet, pose),
 *   computeStackBounds(mode), createSeededRandom(seed), easeInOutCubic(t),
 *   mockupArtworkSpecFor(), drawMockupArtwork(ctx, spec), createMockupTexture(),
 *   paperArtworkSpecFor(treatment), drawPaperArtwork(ctx, spec),
 *   createPaperTexture(treatment), glowArtworkSpecFor(treatment),
 *   drawGlowArtwork(ctx, spec), createGlowTexture(treatment),
 *   buildSheetGeometries(spec), createFallbackSatinMaterial({ tilePx }),
 *   createBillingModel(options)
 *
 * Everything is deterministic and local-only; there is no Math.random and no
 * network access anywhere in this module.
 */

import * as THREE from 'three';

/** Human-readable module version (not part of the page QA contract). */
export const MODEL_VERSION = '3.0.0';

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
 * The paper sits at z = 0; the underlight card hangs BELOW it (negative z in
 * sheet-local space is world DOWN once the sheet is pitched flat), while the
 * unified text mockup floats ABOVE the paper surface (+Z = world UP).
 * `renderOrderStride` is the renderOrder span reserved per sheet.
 */
export const LAYER_SPEC = Object.freeze({
  glowDrop: 4,
  glowScale: 1.1,
  // World px the floating mockup layer sits above the paper surface. This is a
  // real 3D gap (the camera is at 19° elevation), so the graphic reads as a
  // detached layer hovering over the paper instead of ink baked into it.
  mockupLift: 10,
  renderOrderStride: 8,
});

/**
 * Column support in source px. The support is NOT built here: the page reuses the
 * columns deliverable's satin column instance (columns-model.js
 * `createColumns(bank).columnsById['satin-large-long']`) and the model rescales
 * that instance to this specification.
 *
 *   width x depth  = the billing footprint (the round-4 plinth plan, unchanged)
 *   topY            = the support top face; the paper stack floats above it exactly
 *                    as it did over the round-4 plinth
 *   columnId        = the columns deliverable column that is reused
 *   cropY           = framing clip: only support vertices at/above this y take
 *                    part in the camera fit. The column itself is much taller and
 *                    runs down past the stage bottom (cropped by the viewport),
 *                    so the paper stack keeps its round-4 scale.
 *   columnScaleY    = world-scale of the reused column along its length: keeps the
 *                    support tall enough to run out of the bottom of the stage at
 *                    1440/1200/390 without shrinking the paper stack.
 */
export const SUPPORT_SPEC = Object.freeze({
  width: 360,
  depth: 210,
  topY: 90,
  centerX: -55,
  centerZ: 0,
  columnId: 'satin-large-long',
  cropY: 0,
  columnScaleY: 1.5,
});

/** Legacy name kept for older QA reads; the plinth is the columns satin column. */
export const PEDESTAL_SPEC = SUPPORT_SPEC;

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

/**
 * Procedural map sizes (3:4 mockup/paper, square glow). The round-4 per-sheet
 * 768x1024 print maps are retired: ONE 512x683 unified mockup layout is painted
 * twice (a white-ink floating layer and its blurred shadow) and shared by every
 * sheet, because the mockup is a FLOATING LAYER, not paper albedo.
 */
export const TEXTURE_SPEC = Object.freeze({
  mockup: Object.freeze({ width: 512, height: 683 }),
  paper: Object.freeze({ width: 384, height: 512 }),
  glow: Object.freeze({ width: 256, height: 256 }),
});

/**
 * The unified text mockup (round 5). ONE abstract typographic pattern painted once
 * from one seed and shared identically by all seven sheets; the per-treatment ink
 * tone is the only difference (material colour, not a different layout).
 *
 * It is deliberately NOT paper albedo: the model builds a separate mockup mesh per
 * sheet, lifted `lift` world px above the paper surface, with a transparent
 * background, so the graphic floats over the paper instead of being baked into it.
 * There is no readable content anywhere: the painter draws bars, rules, rounded
 * chips and dots only — never letters, digits, words, amounts or a logo.
 */
export const MOCKUP_SPEC = Object.freeze({
  seed: 4409,
  width: TEXTURE_SPEC.mockup.width,
  height: TEXTURE_SPEC.mockup.height,
  lift: LAYER_SPEC.mockupLift,
  opacity: 0.92,
  unified: true,
  /** Per-treatment ink tone (the unified pattern is identical for every sheet). */
  ink: Object.freeze({ white: '#0b0b0c', gold: '#0a0a0b', pcb: '#dbe6f6' }),
  /**
   * Soft drop shadow of the floating layer, painted on the paper just under the
   * ink. It is what makes the mockup read as DETACHED from the paper at the fixed
   * 19° camera (a flat vertical gap alone is hard to see on a plain sheet): the
   * ink floats `lift` px above the paper and casts a blurred shadow on it.
   * Both the ink and the shadow are separate layers — neither is paper albedo.
   */
  shadow: Object.freeze({
    enabled: true,
    opacity: 0.26,
    blurPx: 5,
    offsetX: 1.1,
    offsetY: 2.4,
    lift: 0.4,
    // The blurred white-ink shadow map is tinted near-black by its material.
    colorSrgb: '#050608',
  }),
});

/**
 * Paper face contract (round 5). The straight/front paper faces of the white and
 * gold sheets are OPAQUE; the grey-blue PCB paper stays translucent exactly as the
 * round-4 spec described. `depthWrite` follows the face: opaque faces write depth
 * (so the stack composites cleanly), translucent faces do not.
 */
export const PAPER_FACE = Object.freeze({
  white: Object.freeze({ opaque: true, transparent: false, opacity: 1, depthWrite: true }),
  gold: Object.freeze({ opaque: true, transparent: false, opacity: 1, depthWrite: true }),
  pcb: Object.freeze({ opaque: false, transparent: true, opacity: 0.56, depthWrite: false }),
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

/**
 * Unified-mockup ink tone per treatment (one pattern, different ink). Metadata for
 * QA/docs; the painter itself draws in white and the mockup material's colour
 * multiplies it.
 */
const TREATMENT_MARKS = Object.freeze({
  white: Object.freeze([MOCKUP_SPEC.ink.white]),
  gold: Object.freeze([MOCKUP_SPEC.ink.gold]),
  pcb: Object.freeze([MOCKUP_SPEC.ink.pcb]),
});

/** Fixed paper-texture seeds (one paper map per treatment). */
const PAPER_SEEDS = Object.freeze({ white: 8101, gold: 8209, pcb: 8317 });

/** Fixed glow-texture seeds (one underlight map per treatment). */
const GLOW_SEEDS = Object.freeze({ white: 9101, gold: 9209, pcb: 9317 });

function makeSheetMeta({ id, label, code, treatment, glowOpacity }) {
  const palette = TREATMENT_PALETTES[treatment];
  const face = PAPER_FACE[treatment];
  return Object.freeze({
    id,
    label,
    code,
    treatment,
    tone: treatment,
    group: treatment,
    // Paper face contract: white/gold opaque, PCB translucent (round 5).
    face: face.opaque ? 'opaque' : 'translucent',
    faceOpacity: face.opacity,
    faceTransparent: face.transparent,
    // Underlight card opacity: ramp brightest at the bottom of the stack.
    glowOpacity,
    // The one unified mockup pattern; only this ink tone varies per treatment.
    ink: MOCKUP_SPEC.ink[treatment],
    mockupLift: MOCKUP_SPEC.lift,
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
  makeSheetMeta({ id: 'doc-01', label: 'White statement', code: 'DOC 2401', treatment: 'white', glowOpacity: 0.66 }),
  makeSheetMeta({ id: 'doc-02', label: 'White ledger', code: 'DOC 2402', treatment: 'white', glowOpacity: 0.44 }),
  makeSheetMeta({ id: 'doc-03', label: 'Gold statement', code: 'DOC 2403', treatment: 'gold', glowOpacity: 0.55 }),
  makeSheetMeta({ id: 'doc-04', label: 'Gold ledger', code: 'DOC 2404', treatment: 'gold', glowOpacity: 0.42 }),
  makeSheetMeta({ id: 'doc-05', label: 'PCB statement', code: 'DOC 2405', treatment: 'pcb', glowOpacity: 0.56 }),
  makeSheetMeta({ id: 'doc-06', label: 'PCB ledger', code: 'DOC 2406', treatment: 'pcb', glowOpacity: 0.44 }),
  makeSheetMeta({ id: 'doc-07', label: 'PCB archive', code: 'DOC 2407', treatment: 'pcb', glowOpacity: 0.34 }),
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
 * underlight card is 1.1x the sheet and the floating mockup sits above the bowed
 * paper) in `stack` local space.
 */
export function computeStackBounds(mode = 'expanded') {
  const halfW = (SHEET_SPEC.width * LAYER_SPEC.glowScale) / 2;
  const halfH = (SHEET_SPEC.height * LAYER_SPEC.glowScale) / 2;
  const halfD = Math.max(
    SHEET_SPEC.bow + LAYER_SPEC.mockupLift,
    SHEET_SPEC.thickness / 2 + LAYER_SPEC.glowDrop,
  ) + 1;
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
/* Unified text-mockup artwork (2D canvas, deterministic, abstract only)     */
/* ------------------------------------------------------------------------- */

/**
 * ONE unified abstract typographic pattern for every sheet (round 5). The canvas
 * background stays TRANSPARENT: only ink is painted, in white, so each sheet's
 * mockup material multiplies its per-treatment ink tone (dark for the white/gold
 * paper, light grey-blue for the PCB paper).
 *
 * The pattern is a mock statement: a header chip row, a title bar and subtitle
 * bar, seven body line rows (left label + word-rhythm bars + a right-hand amount
 * bar), a dot-matrix reference block, a total row and footer rules. It NEVER forms
 * a letter, digit, word, amount, code or logo — bars, rules, rounded chips and
 * dots only — and there is deliberately no `fillText` in this module.
 *
 * The layout is IDENTICAL for all seven sheets (that is the round-5 "one text
 * mockup pattern" requirement); only the ink tone differs.
 */
const MOCKUP_PAD = 40;

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

function dot(ctx, x, y, radius, fillStyle) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.6, radius), 0, TAU);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

/** Rounded bar in the layer's ink/fill style. */
function mockupBar(ctx, x, y, width, height, fillStyle) {
  fillRoundRect(
    ctx,
    Math.max(0, x),
    y,
    Math.max(1, width),
    Math.max(1.5, height),
    Math.min(height, width) / 2,
    fillStyle,
  );
}

/** Thin rule in the layer's ink/fill style. */
function mockupRule(ctx, x, y, width, thickness, fillStyle) {
  ctx.fillStyle = fillStyle;
  ctx.fillRect(x, y, width, thickness);
}

/** Dot in the layer's ink/fill style. */
function mockupInkDot(ctx, x, y, radius, fillStyle) {
  dot(ctx, x, y, radius, fillStyle);
}

/** Abstract corner registration ticks (security-print marks, no letters). */
function drawMockupCornerTicks(ctx, width, height, pad, color) {
  const tick = width * 0.07;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, width * 0.004);
  const corners = [
    { x: pad, y: pad, dx: 1, dy: 1 },
    { x: width - pad, y: pad, dx: -1, dy: 1 },
    { x: pad, y: height - pad, dx: 1, dy: -1 },
    { x: width - pad, y: height - pad, dx: -1, dy: -1 },
  ];
  for (const corner of corners) {
    ctx.beginPath();
    ctx.moveTo(corner.x + tick * corner.dx, corner.y);
    ctx.lineTo(corner.x, corner.y);
    ctx.lineTo(corner.x, corner.y + tick * corner.dy);
    ctx.stroke();
  }
}

/**
 * Paint the unified text mockup. Deterministic: one seeded stream, identical
 * output on every reload/machine, identical for every sheet.
 *
 * `spec.inkColor` selects the paint tone (white ink for the ink layer, near-black
 * for the soft shadow layer) and `spec.blurPx` optionally blurs the paint (shadow
 * only). Both layers are painted from the SAME layout, so the shadow is exactly
 * the pattern the floating ink casts on the paper.
 */
export function drawMockupArtwork(ctx, spec) {
  const width = spec.width;
  const height = spec.height;
  const pad = MOCKUP_PAD * (width / 512);
  const inner = width - pad * 2;
  const px = width / 512;
  const random = createSeededRandom(spec.seed);
  const inkColor = spec.inkColor || '#ffffff';
  const ink = (alpha) => rgba(inkColor, alpha);
  ctx.clearRect(0, 0, width, height);
  if (spec.blurPx > 0) {
    // Shadow layer: a soft blurred copy of the same marks (filter support is a
    // canvas-2D feature; any engine that lacks it still gets an unblurred shadow).
    ctx.filter = 'blur(' + Number(spec.blurPx).toFixed(2) + 'px)';
  } else {
    ctx.filter = 'none';
  }

  // 1. Header: two small chips (left document label + right reference).
  mockupBar(ctx, pad, height * 0.058, inner * 0.15, 11 * px, ink(0.82));
  mockupBar(ctx, pad + inner - inner * 0.11, height * 0.058, inner * 0.11, 9 * px, ink(0.5));

  // 2. Title bar + subtitle bar.
  mockupBar(ctx, pad, height * 0.096, inner * 0.48, 15 * px, ink(0.95));
  mockupBar(ctx, pad, height * 0.146, inner * 0.27, 7 * px, ink(0.55));

  // 3. Header rule.
  mockupRule(ctx, pad, height * 0.176, inner, 1.6 * px, ink(0.34));

  // 4. Body "text" rows: left label + word-rhythm line bars + right amount bar.
  const rowTop = height * 0.208;
  const rowGap = height * 0.047;
  const lineH = 8 * px;
  for (let row = 0; row < 7; row += 1) {
    const y = rowTop + row * rowGap;
    mockupBar(ctx, pad, y, inner * randomBetween(random, 0.1, 0.16), lineH, ink(randomBetween(random, 0.4, 0.62)));
    let cursor = pad + inner * 0.2;
    const count = 2 + Math.round(random() * 2);
    for (let i = 0; i < count; i += 1) {
      const barWidth = inner * randomBetween(random, 0.07, 0.19);
      mockupBar(ctx, cursor, y, barWidth, lineH, ink(randomBetween(random, 0.72, 0.95)));
      cursor += barWidth + inner * randomBetween(random, 0.02, 0.05);
      if (cursor > pad + inner * 0.66) break;
    }
    mockupBar(
      ctx,
      pad + inner - inner * randomBetween(random, 0.075, 0.11),
      y,
      inner * 0.075,
      lineH,
      ink(randomBetween(random, 0.66, 0.9)),
    );
  }

  // 5. Divider + dot-matrix reference block (transaction-id rhythm) + chips.
  mockupRule(ctx, pad, height * 0.563, inner, 1.6 * px, ink(0.3));
  const fieldTop = height * 0.592;
  const fieldLeft = pad;
  const fieldWidth = inner * 0.56;
  const fieldHeight = height * 0.085;
  const cols = 14;
  const rows = 4;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (random() < 0.22) continue;
      const cx = fieldLeft + (fieldWidth / cols) * (col + 0.5) + randomBetween(random, -1.2, 1.2) * px;
      const cy = fieldTop + (fieldHeight / rows) * (row + 0.5) + randomBetween(random, -1.2, 1.2) * px;
      mockupInkDot(ctx, cx, cy, 3.2 * px, ink(randomBetween(random, 0.3, 0.9)));
    }
  }
  mockupBar(ctx, pad + inner * 0.64, fieldTop, inner * 0.22, 6 * px, ink(0.58));
  mockupBar(ctx, pad + inner * 0.64, fieldTop + 11 * px, inner * 0.14, 6 * px, ink(0.4));
  mockupRule(ctx, pad, height * 0.702, inner, 1.4 * px, ink(0.26));

  // 6. Total row: bold label bar + bold amount bar.
  mockupBar(ctx, pad, height * 0.722, inner * 0.24, 11 * px, ink(0.9));
  mockupBar(ctx, pad + inner - inner * 0.19, height * 0.718, inner * 0.19, 12 * px, ink(0.98));
  mockupRule(ctx, pad, height * 0.772, inner, 1.8 * px, ink(0.32));

  // 7. Footer: two thin rules + three legal chips.
  mockupRule(ctx, pad, height * 0.808, inner * 0.62, 1.2 * px, ink(0.27));
  mockupRule(ctx, pad, height * 0.822, inner * 0.48, 1.2 * px, ink(0.2));
  mockupBar(ctx, pad, height * 0.878, inner * 0.2, 6 * px, ink(0.42));
  mockupBar(ctx, pad + inner * 0.26, height * 0.878, inner * 0.13, 6 * px, ink(0.3));
  mockupBar(ctx, pad + inner * 0.65, height * 0.878, inner * 0.35, 6 * px, ink(0.22));

  // 8. Corner registration ticks (abstract marks, no letters).
  drawMockupCornerTicks(ctx, width, height, pad, ink(0.4));

  // Reset the paint state so the canvas is not left with a filter/translate.
  ctx.filter = 'none';
  return spec;
}

/**
 * Spec for one unified mockup map shared by all seven sheets. Two variants are
 * painted from the same deterministic layout:
 *   - `ink`    white marks, the floating graphic itself (material tint = treatment)
 *   - `shadow` white marks blurred, tinted near-black by its material and offset
 *              in the plane, painted on the paper just under the ink so the
 *              floating layer visibly detaches from the paper
 * `ink` (the per-treatment tone map) is metadata for QA/docs.
 */
export function mockupArtworkSpecFor({ variant = 'ink', width = MOCKUP_SPEC.width, height = MOCKUP_SPEC.height } = {}) {
  const isShadow = variant === 'shadow';
  return {
    kind: isShadow ? 'mockup-shadow' : 'mockup',
    variant: isShadow ? 'shadow' : 'ink',
    unified: true,
    seed: MOCKUP_SPEC.seed,
    width,
    height,
    lift: MOCKUP_SPEC.lift,
    opacity: MOCKUP_SPEC.opacity,
    ink: { ...MOCKUP_SPEC.ink },
    inkColor: '#ffffff',
    blurPx: isShadow ? MOCKUP_SPEC.shadow.blurPx : 0,
    treatments: TREATMENTS.map((treatment) => treatment.id),
    faceDown: true,
  };
}

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
 * Create the deterministic unified TEXT-MOCKUP canvas textures shared by all seven
 * sheets (transparent background + white ink; the per-sheet material tints it).
 * There are exactly two variants in the whole model, painted from the SAME layout:
 * `ink` (the floating graphic) and `shadow` (the same marks blurred, printed on the
 * paper under the ink so the graphic reads as detached). Both are shared by every
 * sheet — one pattern on all seven sheets, as required by round 5.
 * @param {{createCanvas?:() => HTMLCanvasElement, variant?:'ink'|'shadow'}} [options]
 * @returns {{texture:THREE.CanvasTexture, canvas:object, spec:object}}
 */
export function createMockupTexture({ createCanvas, variant = 'ink' } = {}) {
  const canvas = resolveCanvas(createCanvas);
  if (!canvas) {
    throw new Error('billing-model: createMockupTexture() requires a DOM canvas (document.createElement) or a createCanvas factory');
  }
  const spec = mockupArtworkSpecFor({ variant });
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('billing-model: could not acquire a 2D canvas context for the unified text mockup');
  drawMockupArtwork(ctx, spec);
  const isShadow = spec.variant === 'shadow';
  const texture = configureCanvasTexture(canvas, {
    name: isShadow ? 'billing-text-mockup-shadow:unified' : 'billing-text-mockup:unified',
    width: spec.width,
    height: spec.height,
    seed: spec.seed,
    userData: {
      role: isShadow ? 'sheet-mockup-shadow' : 'sheet-mockup',
      kind: spec.kind,
      unified: true,
      variant: spec.variant,
      sharedBySheets: SHEET_COUNT,
      lift: spec.lift,
      ink: spec.ink,
      blurPx: spec.blurPx,
      faceDown: true,
      background: 'transparent (white paint only; the material multiplies the tone)',
      note: isShadow
        ? 'soft shadow of the floating mockup, painted on the paper under the ink (not paper albedo)'
        : 'not paper albedo — rendered as a separate floating layer above the paper',
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
      marks: 'none (the unified text mockup is a separate floating layer above the paper; it is never baked into this map)',
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
 * All seven sheets share this pair (the paper / glow maps differ; the floating
 * mockup layer reuses the surface geometry, lifted in +Z).
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

/* ------------------------------------------------------------------------- */
/* Support: the columns deliverable's satin column, reused as the pedestal    */
/* ------------------------------------------------------------------------- */

/** Read the source (columns-deliverable) width/depth/height of a column mesh. */
function readColumnSourceSize(mesh) {
  const userData = mesh && mesh.userData && typeof mesh.userData === 'object' ? mesh.userData : {};
  let width = Number(userData.width);
  let depth = Number(userData.depth);
  let height = Number(userData.heightPx);
  const geometry = mesh && mesh.geometry;
  if ((!Number.isFinite(width) || !Number.isFinite(depth) || !Number.isFinite(height)) && geometry) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box) {
      width = Number.isFinite(width) ? width : box.max.x - box.min.x;
      depth = Number.isFinite(depth) ? depth : box.max.z - box.min.z;
      height = Number.isFinite(height) ? height : box.max.y - box.min.y;
    }
  }
  return {
    width: Number.isFinite(width) && width > 0 ? width : 140,
    depth: Number.isFinite(depth) && depth > 0 ? depth : 140,
    height: Number.isFinite(height) && height > 0 ? height : 600,
  };
}

/**
 * Compute the non-uniform scale that fits the reused column's cross-section to the
 * billing footprint (SUPPORT_SPEC.width x depth) and keeps it tall enough to run
 * past the stage bottom. 1 world unit = 1 source px both here and in the columns
 * deliverable, so this is a pure instance scale — the column geometry/UVs are
 * never rebuilt. The slight grain-scale change caused by the non-uniform cross
 * section scale is an accepted consequence of reusing the instance.
 */
export function resolveSupportScale(mesh, spec = SUPPORT_SPEC) {
  const source = readColumnSourceSize(mesh);
  const scaledHeight = source.height * spec.columnScaleY;
  return Object.freeze({
    source,
    scale: Object.freeze({
      x: spec.width / source.width,
      y: spec.columnScaleY,
      z: spec.depth / source.depth,
    }),
    scaledHeight,
    // The cropped column bottom (far below the stage; only the top band is framed).
    bottomY: spec.topY - scaledHeight,
  });
}

/**
 * Reuse the columns deliverable's satin column mesh as the billing pedestal:
 * detach it from the columns group, scale it to the billing footprint, stand its
 * top face at SUPPORT_SPEC.topY and let its lower part run out of the bottom of the
 * stage (the paper stack keeps its round-4 scale; the column is never shrunk to
 * fit the whole column into the frame). The geometry/UVs are left untouched.
 */
export function prepareColumnSupport(mesh, spec = SUPPORT_SPEC) {
  if (!mesh || mesh.isMesh !== true || !mesh.geometry) {
    throw new Error('billing-model: prepareColumnSupport() needs the columns deliverable satin column mesh (a THREE.Mesh with geometry)');
  }
  if (mesh.parent) mesh.parent.remove(mesh);
  const { source, scale, scaledHeight, bottomY } = resolveSupportScale(mesh, spec);
  const sourceUserData = mesh.userData && typeof mesh.userData === 'object' ? mesh.userData : {};
  mesh.name = 'billing-support:satin-column';
  mesh.position.set(spec.centerX, spec.topY - scaledHeight / 2, spec.centerZ);
  mesh.scale.set(scale.x, scale.y, scale.z);
  mesh.rotation.set(0, 0, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData = {
    ...sourceUserData,
    role: 'support',
    source: 'columns-model',
    reusedColumn: true,
    columnId: sourceUserData.columnId || spec.columnId,
    footprint: { width: spec.width, depth: spec.depth },
    topY: spec.topY,
    bottomY,
    cropY: spec.cropY,
    sourceSize: source,
    scale: { x: scale.x, y: scale.y, z: scale.z },
    scaledHeight,
    note: 'columns deliverable satin column instance, rescaled to the billing footprint; its lower part is cropped by the stage (never shrunk to fit)',
  };
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Axis-aligned world bounds of the reused support mesh. */
export function computeSupportBounds(mesh) {
  if (!mesh) return null;
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    center: { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 },
    size: { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z },
  };
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
 * `satin.source = 'fallback'` so QA can tell the difference. Without the columns
 * deliverable there is no column instance to reuse, so the page renders the stack
 * with no support (QA warning, no console error).
 */
export function createFallbackSatinMaterial({ tilePx = SATIN_TILE_PX, name = 'billing-support-satin-fallback' } = {}) {
  const material = new THREE.MeshStandardMaterial({
    name,
    color: srgbColor(SATIN_FALLBACK.colorSrgb),
    metalness: SATIN_FALLBACK.metalness,
    roughness: SATIN_FALLBACK.roughness,
    envMapIntensity: SATIN_FALLBACK.envMapIntensity,
    dithering: true,
  });
  material.userData = {
    role: 'support-satin',
    source: 'fallback',
    materialId: 'satin',
    tilePx,
    note: 'columns-model loadColumnBank() was unavailable; no columns satin column instance to reuse; numeric satin contract preserved, derived grain/reflection maps missing',
  };
  return material;
}

function prepareSatin(source, satinTilePx) {
  if (source && source.isMaterial) {
    const clone = source.clone();
    clone.name = 'billing-support-satin';
    const sourceUserData = source.userData && typeof source.userData === 'object' ? source.userData : {};
    clone.userData = {
      ...sourceUserData,
      role: 'support-satin',
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
 * Build the materials of one face-down sheet (round 5):
 *   paper  MeshStandardMaterial — the paper top surface. White and gold are OPAQUE
 *          (transparent:false, opacity 1, depthWrite true); the grey-blue PCB paper
 *          keeps the round-4 translucent spec (transparent, opacity < 1, no depth
 *          write).
 *   mockup MeshBasicMaterial — the unified text mockup: a SEPARATE layer floating
 *          above the paper (own shared map, own per-treatment ink tone, transparent
 *          background). It is not paper albedo.
 *   shadow MeshBasicMaterial — the same mockup layout blurred and tinted near-black,
 *          painted on the paper just under the ink so the floating layer visibly
 *          detaches from the paper (also not paper albedo).
 *   glow   MeshBasicMaterial, additive (the underlight card below the paper)
 *   edge   MeshBasicMaterial (the bright rim strip)
 * `face` is a legacy alias of `paper`.
 */
function createSheetMaterials(meta, index, textures) {
  const face = PAPER_FACE[meta.treatment] || PAPER_FACE.white;
  const paper = new THREE.MeshStandardMaterial({
    name: 'billing-sheet-paper:' + meta.id,
    map: textures.paper,
    color: 0xffffff,
    transparent: face.transparent,
    opacity: face.opacity,
    roughness: 0.6,
    metalness: 0.0,
    envMapIntensity: 0.55,
    side: THREE.FrontSide,
    depthWrite: face.depthWrite,
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
    face: face.opaque ? 'opaque' : 'translucent',
    opaque: face.opaque,
    baseOpacity: face.opacity,
    maps: { map: true },
    note: face.opaque
      ? 'opaque paper face (round 5); the unified text mockup is a separate floating layer above it'
      : 'translucent PCB paper (round-4 spec); the underlight card below reads through it while the mockup floats above it',
  };

  const mockup = new THREE.MeshBasicMaterial({
    name: 'billing-sheet-mockup:' + meta.id,
    map: textures.mockup,
    color: srgbColor(meta.ink),
    transparent: true,
    opacity: MOCKUP_SPEC.opacity,
    side: THREE.FrontSide,
    depthWrite: false,
    dithering: true,
    toneMapped: true,
  });
  mockup.userData = {
    role: 'sheet-mockup',
    layer: 'mockup',
    sheetId: meta.id,
    sheetIndex: index,
    treatment: meta.treatment,
    faceDown: true,
    ink: meta.ink,
    lift: MOCKUP_SPEC.lift,
    unified: true,
    baseOpacity: MOCKUP_SPEC.opacity,
    note: 'unified abstract text mockup (one shared pattern for all sheets), floating above the paper surface as a separate layer; transparent background, per-treatment ink tone, no readable text',
  };

  const shadow = new THREE.MeshBasicMaterial({
    name: 'billing-sheet-mockup-shadow:' + meta.id,
    map: textures.mockupShadow,
    color: srgbColor(MOCKUP_SPEC.shadow.colorSrgb),
    transparent: true,
    opacity: MOCKUP_SPEC.shadow.opacity,
    side: THREE.FrontSide,
    depthWrite: false,
    dithering: true,
    toneMapped: true,
  });
  shadow.userData = {
    role: 'sheet-mockup-shadow',
    layer: 'shadow',
    sheetId: meta.id,
    sheetIndex: index,
    treatment: meta.treatment,
    faceDown: true,
    blurred: MOCKUP_SPEC.shadow.blurPx,
    unified: true,
    baseOpacity: MOCKUP_SPEC.shadow.opacity,
    note: 'soft blurred shadow of the floating mockup, printed on the paper under the ink (separate layer, not paper albedo) — it makes the graphic read as detached from the sheet',
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
    note: 'additive underlight card below the paper; fades to black at its edges (its halo is what keeps the light visible around the opaque sheets)',
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

  return { paper, mockup, shadow, glow, edge, face: paper };
}

/* ------------------------------------------------------------------------- */
/* Model assembly                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Build the complete billing object (round 5): the columns deliverable's satin
 * column reused as the support + seven face-down paper sheets, each with glow
 * (underlight), paper (opaque white/gold, translucent PCB), the FLOATING unified
 * text mockup and the bright rim.
 *
 * @param {object} [options]
 * @param {THREE.Material} [options.satinMaterial] `loadColumnBank().materials.satin`
 *        (cloned, never mutated); when omitted a numeric-contract fallback is used.
 * @param {number} [options.satinTilePx] satin manifest tilePx (default 260)
 * @param {THREE.Mesh} [options.columnInstance] the columns deliverable satin column
 *        mesh (e.g. `createColumns(bank).columnsById['satin-large-long'].mesh`).
 *        The model REUSES that instance as the pedestal: it is detached from the
 *        columns group, rescaled to the SUPPORT_SPEC footprint and stood on its top
 *        face, with its lower part running out of the bottom of the stage. Its
 *        geometry is never rebuilt here and never disposed here (the page's columns
 *        instance owns it). When omitted the stack renders with no support and QA
 *        reports the degraded path.
 * @param {{columnId?:string,width?:number,depth?:number,heightPx?:number}} [options.columnSource]
 *        optional fallback metadata for the reused column; normally read from the
 *        columns mesh userData (createColumns() writes width/depth/heightPx there).
 * @param {'hero'|'preview'} [options.quality] accepted for API symmetry
 * @param {()=>{texture:THREE.Texture, canvas:object, spec:object}} [options.mockupTextureFactory]
 *        test hook for the single shared unified mockup map
 * @param {(treatment:string)=>{texture:THREE.Texture, canvas:object, spec:object}} [options.paperTextureFactory]
 *        test hook for the treatment paper maps
 * @param {(treatment:string)=>{texture:THREE.Texture, canvas:object, spec:object}} [options.glowTextureFactory]
 *        test hook for the treatment underlight maps
 * @returns {object} model handle (see file header / docs/billing.md)
 */
export function createBillingModel({
  satinMaterial = null,
  satinTilePx = SATIN_TILE_PX,
  columnInstance = null,
  columnSource = null,
  quality = 'hero',
  mockupTextureFactory = null,
  paperTextureFactory = null,
  glowTextureFactory = null,
} = {}) {
  const root = new THREE.Group();
  root.name = 'billing-object';

  const tilePx = Number(satinTilePx) > 0 ? Number(satinTilePx) : SATIN_TILE_PX;
  const satin = prepareSatin(satinMaterial, tilePx);

  // ---- Support: reuse the columns deliverable's satin column instance --------
  // No pedestal/column geometry is built here (round 5). The instance is owned by
  // the page's columns model: this module only rescales/positions/attaches it and
  // reassigns the cloned satin material; it never disposes the column geometry.
  let support = null;
  let supportInfo = null;
  if (columnInstance) {
    if (columnInstance.isMesh !== true || !columnInstance.geometry) {
      throw new Error('billing-model: columnInstance must be the columns deliverable satin column mesh (THREE.Mesh)');
    }
    if (columnSource && typeof columnSource === 'object') {
      const userData = { ...(columnInstance.userData && typeof columnInstance.userData === 'object' ? columnInstance.userData : {}) };
      if (userData.columnId == null && columnSource.columnId) userData.columnId = columnSource.columnId;
      if (userData.width == null && columnSource.width != null) userData.width = columnSource.width;
      if (userData.depth == null && columnSource.depth != null) userData.depth = columnSource.depth;
      if (userData.heightPx == null && columnSource.heightPx != null) userData.heightPx = columnSource.heightPx;
      columnInstance.userData = userData;
    }
    support = prepareColumnSupport(columnInstance, SUPPORT_SPEC);
    support.material = satin.material; // the cloned columns satin, never the bank original
    root.add(support);
    supportInfo = {
      reused: true,
      source: 'columns-model',
      columnId: support.userData.columnId || SUPPORT_SPEC.columnId,
      meshName: support.name,
      geometryUuid: support.geometry ? support.geometry.uuid : null,
      materialSource: satin.source,
      footprint: { width: SUPPORT_SPEC.width, depth: SUPPORT_SPEC.depth },
      topY: SUPPORT_SPEC.topY,
      bottomY: support.userData.bottomY,
      cropY: SUPPORT_SPEC.cropY,
      visibleHeight: SUPPORT_SPEC.topY - SUPPORT_SPEC.cropY,
      sourceSize: support.userData.sourceSize,
      scale: support.userData.scale,
      scaledHeight: support.userData.scaledHeight,
      croppedByStage: true,
      otherColumnsPlaced: false,
    };
  }
  root.userData = {
    role: 'billing-object',
    version: MODEL_VERSION,
    faceDown: true,
    unifiedMockup: true,
    floatingMockup: true,
    opaqueFaces: ['white', 'gold'],
    translucentFaces: ['pcb'],
    support: support ? 'columns-satin-column' : 'none',
  };

  // ---- Document stack -------------------------------------------------------
  const stack = new THREE.Group();
  stack.name = 'billing-stack';
  stack.userData = { role: 'document-stack', faceDown: true, mockupLayer: 'floating' };
  root.add(stack);

  // Shared geometry: sheet surface + rim + the 1.1x underlight card plane. The
  // floating mockup layer reuses the sheet surface geometry, offset in +Z (world
  // UP once pitched flat).
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

  // ONE shared unified mockup pattern for all seven sheets (round 5): the ink layer
  // is the floating graphic itself; the shadow layer is the same pattern blurred,
  // painted on the paper below so the graphic reads as detached from the sheet.
  const mockupFactory = typeof mockupTextureFactory === 'function'
    ? mockupTextureFactory
    : (variant) => createMockupTexture({ variant });
  const mockupCreated = mockupFactory('ink');
  const mockupTexture = mockupCreated.texture;
  const mockupSpec = mockupCreated.spec || mockupArtworkSpecFor({ variant: 'ink' });
  const shadowCreated = mockupFactory('shadow');
  const mockupShadowTexture = shadowCreated.texture;
  const mockupShadowSpec = (shadowCreated && shadowCreated.spec) || mockupArtworkSpecFor({ variant: 'shadow' });

  // Paper + underlight maps are shared by the sheets of one treatment.
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

  const sheets = SHEET_META.map((meta, index) => {
    const faceTextures = {
      paper: paperTextures.get(meta.treatment),
      mockup: mockupTexture,
      mockupShadow: mockupShadowTexture,
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
      face: meta.face,
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

    // paper (opaque white/gold, translucent PCB) ----------------- base + 1
    const paper = new THREE.Mesh(geometries.surface, materials.paper);
    paper.name = 'billing-sheet-paper:' + meta.id;
    paper.renderOrder = base + 1;
    paper.castShadow = false;
    paper.receiveShadow = false;
    paper.userData = { role: 'sheet-paper', sheetId: meta.id, sheetIndex: index, orderOffset: 1, face: meta.face };

    // shadow (blurred mockup shadow, painted on the paper) ------- base + 2
    const shadow = new THREE.Mesh(geometries.surface, materials.shadow);
    shadow.name = 'billing-sheet-mockup-shadow:' + meta.id;
    shadow.position.set(MOCKUP_SPEC.shadow.offsetX, MOCKUP_SPEC.shadow.offsetY, MOCKUP_SPEC.shadow.lift);
    shadow.renderOrder = base + 2;
    shadow.castShadow = false;
    shadow.receiveShadow = false;
    shadow.userData = {
      role: 'sheet-mockup-shadow',
      layer: 'shadow',
      sheetId: meta.id,
      sheetIndex: index,
      orderOffset: 2,
      unified: true,
      blurred: MOCKUP_SPEC.shadow.blurPx,
      lift: MOCKUP_SPEC.shadow.lift,
      geometrySource: 'billing-sheet-surface',
    };

    // mockup (unified text mockup, floating ABOVE the paper) ------ base + 3
    const mockup = new THREE.Mesh(geometries.surface, materials.mockup);
    mockup.name = 'billing-sheet-mockup:' + meta.id;
    mockup.position.z = LAYER_SPEC.mockupLift;
    mockup.renderOrder = base + 3;
    mockup.castShadow = false;
    mockup.receiveShadow = false;
    mockup.userData = {
      role: 'sheet-mockup',
      layer: 'mockup',
      sheetId: meta.id,
      sheetIndex: index,
      orderOffset: 3,
      unified: true,
      floating: true,
      lift: LAYER_SPEC.mockupLift,
      ink: meta.ink,
      geometrySource: 'billing-sheet-surface',
      noReadableText: true,
    };

    // rim (bright edge strip) --------------------------------- base + 4
    const rim = new THREE.Mesh(geometries.rim, materials.edge);
    rim.name = 'billing-sheet-rim:' + meta.id;
    rim.renderOrder = base + 4;
    rim.castShadow = false;
    rim.receiveShadow = false;
    rim.userData = { role: 'sheet-rim', sheetId: meta.id, sheetIndex: index, orderOffset: 4 };

    mesh.add(glow);
    mesh.add(paper);
    mesh.add(shadow);
    mesh.add(mockup);
    mesh.add(rim);
    stack.add(mesh);

    const layers = [
      { mesh: glow, role: 'glow', orderOffset: 0 },
      { mesh: paper, role: 'paper', orderOffset: 1 },
      { mesh: shadow, role: 'shadow', orderOffset: 2 },
      { mesh: mockup, role: 'mockup', orderOffset: 3 },
      { mesh: rim, role: 'rim', orderOffset: 4 },
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
      ink: meta.ink,
      face: meta.face,
      faceOpacity: meta.faceOpacity,
      faceTransparent: meta.faceTransparent,
      palette: meta.palette,
      marks: meta.marks,
      mesh,
      layers,
      surface: paper,
      shadow,
      mockup,
      rim,
      materials,
      // Legacy alias kept for older QA reads: the sheet's artwork map is now the
      // shared floating mockup map, not a per-sheet print map.
      texture: mockupTexture,
      mockupTexture,
      mockupShadowTexture,
      mockupSpec,
      mockupShadowSpec,
      mockupLift: LAYER_SPEC.mockupLift,
      paperTexture: faceTextures.paper,
      glowTexture: faceTextures.glow,
      artworkSpec: mockupSpec,
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

  // The support is static and much taller than the crop: its reported bounds are
  // clipped to the framing crop line (only that band is ever visible), while the
  // full support bounds are exposed separately for QA.
  const supportBounds = support ? computeSupportBounds(support) : null;
  if (supportBounds) {
    const clipped = new THREE.Box3(
      new THREE.Vector3(supportBounds.min.x, Math.max(supportBounds.min.y, SUPPORT_SPEC.cropY), supportBounds.min.z),
      new THREE.Vector3(supportBounds.max.x, supportBounds.max.y, supportBounds.max.z),
    );
    for (const box of [expandedBox, condensedBox]) box.union(clipped);
  }
  applyMode('expanded');

  const toPlainBounds = (box) => ({
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    center: { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 },
    size: { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z },
  });

  // Exact silhouette point cloud used by the page's camera fit: the real sheet
  // surface + rim vertices, the four corners and centre of each underlight card,
  // the floating mockup's corners + centre (lifted above the paper) and ONLY the
  // support vertices at/above SUPPORT_SPEC.cropY. The column's lower part is
  // deliberately excluded so the paper stack keeps its round-4 scale.
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
      // The floating mockup is the same bowed surface mesh, already lifted by
      // LAYER_SPEC.mockupLift: sample its REAL geometry vertices through the mockup
      // mesh (never add the lift a second time) so the fit follows the graphic's
      // true silhouette, including the bow at the centre.
      const mockupMesh = sheet.mockup;
      for (let i = 0; i < surfacePositions.count; i += 3) {
        local.fromBufferAttribute(surfacePositions, i);
        mockupMesh.localToWorld(local);
        points.push(local.x, local.y, local.z);
      }
    }
    if (support && support.geometry) {
      const position = support.geometry.getAttribute('position');
      if (position) {
        const matrix = support.matrixWorld;
        for (let i = 0; i < position.count; i += 1) {
          local.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(matrix);
          if (local.y < SUPPORT_SPEC.cropY) continue;
          points.push(local.x, local.y, local.z);
        }
        // The reused column is a plain box: it has vertices only at its top and
        // bottom, so the crop-line cross-section must be synthesized explicitly.
        // Framing on it keeps the paper stack at its round-4 scale while the
        // column's lower part continues out of the bottom of the stage.
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            points.push(
              SUPPORT_SPEC.centerX + (sx * SUPPORT_SPEC.width) / 2,
              SUPPORT_SPEC.cropY,
              SUPPORT_SPEC.centerZ + (sz * SUPPORT_SPEC.depth) / 2,
            );
          }
        }
      }
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
      for (const material of [sheet.materials.paper, sheet.materials.mockup, sheet.materials.shadow, sheet.materials.glow, sheet.materials.edge]) {
        if (!material || seenMaterials.has(material)) continue;
        seenMaterials.add(material);
        material.dispose();
      }
    }
    const seenTextures = new Set();
    const allTextures = [mockupTexture, mockupShadowTexture, ...paperTextures.values(), ...glowTextures.values()];
    for (const texture of allTextures) {
      if (!texture || seenTextures.has(texture)) continue;
      seenTextures.add(texture);
      texture.dispose();
    }
    geometries.surface.dispose();
    geometries.rim.dispose();
    geometries.glow.dispose();
    satin.material.dispose();
    // The reused column instance and its geometry stay owned by the page's columns
    // model (columns.dispose()); only the cloned satin material above belongs here.
    if (support) support.removeFromParent();
    stack.clear();
    root.clear();
  };

  return {
    version: MODEL_VERSION,
    quality,
    faceDown: true,
    unifiedMockup: true,
    root,
    stack,
    support,
    // Legacy alias: older QA/docs called the support the pedestal.
    pedestal: support,
    supportInfo,
    supportBounds,
    sheets,
    geometries,
    mockup: {
      unified: true,
      floating: true,
      detached: true,
      texture: mockupTexture,
      textureCount: 1,
      shadowTexture: mockupShadowTexture,
      shadowTextureCount: 1,
      shadow: { ...MOCKUP_SPEC.shadow },
      sheetCount: sheets.length,
      lift: LAYER_SPEC.mockupLift,
      spec: mockupSpec,
      shadowSpec: mockupShadowSpec,
    },
    textures: [mockupTexture, mockupShadowTexture],
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
    fitCropY: SUPPORT_SPEC.cropY,
    sheetCount: sheets.length,
    treatments: { ...TREATMENT_COUNTS },
    goldStartIndex: GOLD_START_INDEX,
    warmSheetIndex: WARM_SHEET_INDEX,
    dispose,
  };
}
