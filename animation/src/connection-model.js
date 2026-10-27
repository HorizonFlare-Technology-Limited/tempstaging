/**
 * tekoanimation — Connection crystal: pure deterministic three.js model.
 *
 * Two interlocked right-angle L blocks — ribbed satin-silver metal bodies,
 * layered acrylic tops (a clear cap1 band under a dark glass cap2) with thin
 * orange/blue edge-lit accents, two satin columns from the columns deliverable,
 * two polished interlock pads, and thin clear rod bundles leaving the two open
 * ends. A single continuous silver "data" conduit runs through the 28 px air seam
 * between the acrylic layers of each plate, drops through the 34 px interlock
 * clearance between the plates and leaves through the other open end.
 *
 * Contract: `notes/CONNECTION_CONTRACT.md` (Lead-owned). Units: 1 world unit =
 * 1 source px (the columns deliverable convention); y is up; the model's origin
 * is the floor centre, so the group can be dropped straight into a scene.
 *
 * Determinism / purity
 * --------------------
 * No renderer, no DOM required, no fetch, no wall-clock reads and no
 * `Math.random` anywhere: every "random" value comes from the integer hash in
 * `hash01()`, the procedural canvas art is generated from a fixed formula, and
 * `update(elapsed)` is a pure function of the elapsed seconds. `createCanvas`
 * can be injected (test hook) and the whole scene still builds headlessly when
 * no canvas exists (the procedural rib maps are then reported as absent).
 *
 * three.js r151.3 is imported as the bare specifier `three` (the page importmap
 * maps it to `./vendor/three.module.js`); node verifiers can use
 * `tools/three-import-loader.mjs`.
 *
 * Exports
 * -------
 *   MODEL_VERSION, MODEL_SPEC, CAMERA_SPEC, SATIN_COLUMN_SPECS, FLOW_SPEC,
 *   createSatinMaterial(bank), createFallbackSatinMaterial(),
 *   createConnectionModel({ satinMaterial, satinTilePx, createCanvas })
 *
 * The returned model object is documented above `createConnectionModel()`.
 */

import * as THREE from 'three';
import { createRoundedColumnGeometry } from './columns-rounded-geometry.js';

/** Human-readable module version (contract revision 1). */
export const MODEL_VERSION = '1.0.0';

/* ========================================================================= */
/* Small deterministic helpers                                               */
/* ========================================================================= */

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
const smoothstep01 = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const degToRad = (deg) => (deg * Math.PI) / 180;

/** Round for JSON/debug output (keeps the numbers readable). */
const round = (value, digits = 3) => {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Deterministic 32-bit integer hash (fmix32-style avalanche). Used for every
 * seeded value in this model so two builds are bit-identical.
 */
function hash32(value) {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** Seeded uniform number in [0, 1) from `(index, salt)`. */
function hash01(index, salt = 0) {
  const a = Math.imul((index | 0) + 1, 0x9e3779b1) >>> 0;
  const b = Math.imul((salt | 0) + 1, 0x85ebca6b) >>> 0;
  return hash32(a ^ b) / 4294967296;
}

/** Seeded uniform number in [min, max). */
const hashRange = (index, salt, min, max) => min + (max - min) * hash01(index, salt);

/** Recursively freeze plain objects/arrays (the exported frozen specs). */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function fail(message) {
  throw new Error('connection-model: ' + message);
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

function materialSnapshot(material) {
  if (!material) return null;
  return {
    name: material.name || '',
    type: material.type || 'Material',
    metalness: typeof material.metalness === 'number' ? round(material.metalness, 4) : null,
    roughness: typeof material.roughness === 'number' ? round(material.roughness, 4) : null,
    envMapIntensity: typeof material.envMapIntensity === 'number' ? round(material.envMapIntensity, 4) : null,
    transmission: typeof material.transmission === 'number' ? round(material.transmission, 4) : null,
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

/** Resolve a deterministic 2D canvas (DOM by default, injectable for tests). */
function resolveCanvas(createCanvas) {
  if (typeof createCanvas === 'function') {
    const injected = createCanvas();
    if (injected && injected.getContext) return injected;
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    if (canvas && typeof canvas.getContext === 'function') return canvas;
  }
  return null;
}

/* ========================================================================= */
/* Frozen contract constants                                                 */
/* ========================================================================= */

/**
 * Plate levels (REVISION 2, contract §REVISION 2). Two interlocked L plates:
 * a thick ribbed metal body with a THIN layered glass top hugging it — a clear
 * cap1 (16), a 28 px flow seam carrying the conduit, and a dark glass cap2 (24).
 * The 34 px air gap between the lower cap2 top (858) and the upper body bottom
 * (892) is the interlock clearance.
 * @type {Readonly<object>}
 */
const PLATE_LEVELS = Object.freeze({
  lower: Object.freeze({
    id: 'lower',
    label: 'Lower L plate',
    body: Object.freeze({ bottom: 600, top: 790 }),
    cap1: Object.freeze({ bottom: 790, top: 806 }),
    seam: Object.freeze({ bottom: 806, top: 834, thickness: 28 }),
    cap2: Object.freeze({ bottom: 834, top: 858 }),
    flowLevel: 820,
    top: 858,
  }),
  upper: Object.freeze({
    id: 'upper',
    label: 'Upper L plate',
    body: Object.freeze({ bottom: 892, top: 1082 }),
    cap1: Object.freeze({ bottom: 1082, top: 1098 }),
    seam: Object.freeze({ bottom: 1098, top: 1126, thickness: 28 }),
    cap2: Object.freeze({ bottom: 1126, top: 1150 }),
    flowLevel: 1112,
    top: 1150,
  }),
});

/**
 * Plan rectangles (top view; x = right, z = front/toward camera). Each plate is
 * the union of a long arm (A) and a short arm (B); the two L plans nest 180°.
 * @type {Readonly<object>}
 */
const PLATE_PLANS = Object.freeze({
  lower: Object.freeze([
    Object.freeze({ id: 'A1', x: Object.freeze([-520, 520]), z: Object.freeze([160, 520]) }),
    Object.freeze({ id: 'B1', x: Object.freeze([160, 520]), z: Object.freeze([-520, 160]) }),
  ]),
  upper: Object.freeze([
    Object.freeze({ id: 'A2', x: Object.freeze([-520, 520]), z: Object.freeze([-520, -160]) }),
    Object.freeze({ id: 'B2', x: Object.freeze([-520, -160]), z: Object.freeze([-160, 320]) }),
  ]),
});

/** Plan outline (6 rectilinear vertices, x in [0], z in [1]) of each L union. */
const PLATE_OUTLINES = Object.freeze({
  lower: Object.freeze([
    Object.freeze([-520, 160]), Object.freeze([-520, 520]), Object.freeze([520, 520]),
    Object.freeze([520, -520]), Object.freeze([160, -520]), Object.freeze([160, 160]),
  ]),
  upper: Object.freeze([
    Object.freeze([-520, -520]), Object.freeze([520, -520]), Object.freeze([520, -160]),
    Object.freeze([-160, -160]), Object.freeze([-160, 320]), Object.freeze([-520, 320]),
  ]),
});

/** Acrylic cap stack constants (REVISION 2: thin layered glass hugging the body). */
const CAP_SPEC = Object.freeze({
  clear: Object.freeze({ id: 'cap1', expansion: 8, height: 16, bevel: 2.0, bevelSegments: 3 }),
  dark: Object.freeze({ id: 'cap2', expansion: 16, height: 24, bevel: 2.0, bevelSegments: 3 }),
  /** metal body bevel (rounded L prism) */
  bodyBevel: 2.0,
  bodyBevelSegments: 3,
});

/** Interlock pads (REVISION 2): UL rests on LL through them. */
const PAD_SPEC = Object.freeze({
  width: 70,
  depth: 70,
  height: 34,
  radius: 4,
  bottom: 858,
  top: 892,
  positions: Object.freeze([
    Object.freeze([250, -470]),
    Object.freeze([430, -470]),
  ]),
});

/** Open-end line bundles (contract §1). Axis is x; offsets are [dy, dz]. */
const BUNDLE_SPEC = Object.freeze({
  rodCount: 5,
  rodRadius: 3.2,
  rodLength: 330,
  nearX: 552,
  farX: 882,
  coreRadius: 0.8,
  /** deterministic fan: far-end offsets = offset × (1 + fan) */
  fan: 0.12,
  offsets: Object.freeze([
    Object.freeze([0, 34]),
    Object.freeze([0, -34]),
    Object.freeze([34, 10]),
    Object.freeze([-34, 10]),
    Object.freeze([34, -12]),
  ]),
  boltRadius: 5,
  /**
   * 3 chrome bolt dots around each conduit at the open end faces
   * (REVISION 2 cap levels: UL cap2 1126..1150 / cap1 1082..1098 at x 536/528;
   * LL cap2 834..858 / cap1 790..806 at x -536/-528).
   */
  boltPositions: Object.freeze([
    // upper plate open end (flow level y = 1112, z = -210)
    Object.freeze([536, 1140, -180]),
    Object.freeze([536, 1140, -240]),
    Object.freeze([528, 1090, -210]),
    // lower plate open end (flow level y = 820, z = 470)
    Object.freeze([-536, 846, 440]),
    Object.freeze([-536, 846, 500]),
    Object.freeze([-528, 794, 470]),
  ]),
});

/**
 * Edge-light accents (REVISION 2):
 * - cap2 top perimeter: thin additive cyan-white line;
 * - body/cap1 boundary on the exposed front/left faces: orange #ff7a2a inlay;
 * - interlock-facing (notch-side) cap2 top edges: blue #5b8cff accent.
 */
const ACCENT_SPEC = Object.freeze({
  colors: Object.freeze({ orange: 0xff7a2a, blue: 0x5b8cff, edge: 0xbfe6ff }),
  /** top-rim additive line (thin, cyan-white) */
  rim: Object.freeze({ width: 1.6, height: 0.7, inset: 1.2, lift: 0.55 }),
  /** orange inlay at the body/cap1 boundary, proud of the clear glass face */
  orangeInlay: Object.freeze({ width: 0.8, height: 2.4, lift: 0.45, faceOffset: 0.3 }),
  /** blue notch-side accent line on the dark-glass top rim */
  blueRim: Object.freeze({ width: 1.7, height: 0.7, inset: 1.6, lift: 0.62 }),
});

/**
 * Flow path control points P0..P9 (REVISION 2 re-route). The visible runs sit
 * 50 px inside the plates' inner edges so the camera sees them: the upper seam
 * run is at z = -210 (back arm) and x = -210 (short arm); the lower seam run is
 * at z = 470 (front arm) from the notch entry to the open end. All seam samples
 * stay inside the cap1 plan (QA min >= 8).
 */
const FLOW_POINTS = Object.freeze([
  Object.freeze([882, 1112, -210]), // P0 entry far (free air, tapers in)
  Object.freeze([540, 1112, -210]), // P1 just outside UL open end
  Object.freeze([-210, 1112, -210]), // P2 UL back-arm seam run -> inner corner
  Object.freeze([-210, 1112, 352]), // P3 UL short-arm seam run -> past its cap end
  Object.freeze([-210, 875, 352]), // P4 drop through the interlock void
  Object.freeze([-210, 875, 96]), // P5 cross the interlock void (front notch)
  Object.freeze([-210, 820, 96]), // P6 descend in the LL notch to the LL seam
  Object.freeze([-210, 820, 470]), // P7 slide under the LL cap2 overhang into the LL seam
  Object.freeze([-536, 820, 470]), // P8 through the LL front-arm seam to its open end
  Object.freeze([-882, 820, 470]), // P9 exit far (free air, tapers out)
]);

/**
 * Published flow spec (REVISION 2). `cornerRadius` is the NOMINAL fillet radius;
 * the builder clamps an individual corner when a fillet would pinch the tube and
 * reports the actual radii in debug().
 * @type {Readonly<object>}
 */
export const FLOW_SPEC = Object.freeze({
  period: 7.0,
  stillPhase: 0.36,
  radius: 6,
  glowRadius: 11,
  particleCount: 72,
  cornerRadius: 26,
  taper: 55,
  sampleStep: 2,
});

/** Published 3/4 camera spec (REVISION 2). */
export const CAMERA_SPEC = Object.freeze({
  azimuthDeg: 33,
  elevationDeg: 33,
  fov: 30,
  rollDeg: 0,
  target: Object.freeze([0, 575, 0]),
  fitPadding: 1.02,
  near: 10,
  far: 20000,
});

/**
 * The two satin columns, taken from the columns deliverable's real specs:
 * footprint radius 10 (large 140 px) / 5 (medium 80 px), height 600, bottom at
 * y = 0. `position` is [x, 0, z] (contract §1/§3).
 * @type {ReadonlyArray<Readonly<object>>}
 */
export const SATIN_COLUMN_SPECS = Object.freeze([
  Object.freeze({
    id: 'satin-large-long',
    width: 140,
    depth: 140,
    height: 600,
    radius: 10,
    position: Object.freeze([-330, 0, 330]),
    label: 'Satin large long column',
  }),
  Object.freeze({
    id: 'satin-medium-long',
    width: 80,
    depth: 80,
    height: 600,
    radius: 5,
    position: Object.freeze([330, 0, -250]),
    label: 'Satin medium long column',
  }),
]);

/** Columns-deliverable UV density scale (contract §1: satin tilePx × 1.3). */
const UV_DENSITY_SCALE = 1.3;

/** Manifest satin tilePx default (assets/textures/materials/manifest.json). */
const SATIN_TILE_PX = 260;

/** World px covered by one rib texture tile (rib pitch = tile / ribCount). */
const RIB_TILE_PX = 320;
/** 40 ribs per 320 px tile = 8 px pitch ≈ 24 ribs over the 190 px body. */
const RIB_COUNT = 40;

/** Published core fit box for the camera (plates + columns only). */
const FIT_BOUNDS_MIN = Object.freeze({ x: -560, y: 0, z: -560 });
const FIT_BOUNDS_MAX = Object.freeze({ x: 560, y: 1150, z: 560 });

/**
 * Frozen spatial model spec (REVISION 2: plan / levels / caps / pads / columns /
 * bundles / accents / fit bounds), published for the preview's spec rows and QA.
 */
export const MODEL_SPEC = deepFreeze({
  unit: 'px',
  up: 'y',
  revision: 2,
  plates: [
    {
      id: PLATE_LEVELS.lower.id,
      label: PLATE_LEVELS.lower.label,
      levels: {
        body: [PLATE_LEVELS.lower.body.bottom, PLATE_LEVELS.lower.body.top],
        cap1: [PLATE_LEVELS.lower.cap1.bottom, PLATE_LEVELS.lower.cap1.top],
        seam: [PLATE_LEVELS.lower.seam.bottom, PLATE_LEVELS.lower.seam.top],
        cap2: [PLATE_LEVELS.lower.cap2.bottom, PLATE_LEVELS.lower.cap2.top],
      },
      plan: PLATE_PLANS.lower.map((arm) => ({ id: arm.id, x: arm.x, z: arm.z })),
      flowLevel: PLATE_LEVELS.lower.flowLevel,
      top: PLATE_LEVELS.lower.top,
    },
    {
      id: PLATE_LEVELS.upper.id,
      label: PLATE_LEVELS.upper.label,
      levels: {
        body: [PLATE_LEVELS.upper.body.bottom, PLATE_LEVELS.upper.body.top],
        cap1: [PLATE_LEVELS.upper.cap1.bottom, PLATE_LEVELS.upper.cap1.top],
        seam: [PLATE_LEVELS.upper.seam.bottom, PLATE_LEVELS.upper.seam.top],
        cap2: [PLATE_LEVELS.upper.cap2.bottom, PLATE_LEVELS.upper.cap2.top],
      },
      plan: PLATE_PLANS.upper.map((arm) => ({ id: arm.id, x: arm.x, z: arm.z })),
      flowLevel: PLATE_LEVELS.upper.flowLevel,
      top: PLATE_LEVELS.upper.top,
    },
  ],
  plan: PLATE_PLANS,
  caps: {
    clear: { id: 'cap1', expansion: CAP_SPEC.clear.expansion, height: CAP_SPEC.clear.height, bevel: CAP_SPEC.clear.bevel },
    dark: { id: 'cap2', expansion: CAP_SPEC.dark.expansion, height: CAP_SPEC.dark.height, bevel: CAP_SPEC.dark.bevel },
    bodyBevel: CAP_SPEC.bodyBevel,
  },
  seam: { thickness: PLATE_LEVELS.lower.seam.thickness },
  interlock: {
    topOfLower: PLATE_LEVELS.lower.top,
    bottomOfUpper: PLATE_LEVELS.upper.body.bottom,
    clearance: PLATE_LEVELS.upper.body.bottom - PLATE_LEVELS.lower.top,
    slabLevel: 875,
  },
  pads: {
    width: PAD_SPEC.width,
    depth: PAD_SPEC.depth,
    height: PAD_SPEC.height,
    radius: PAD_SPEC.radius,
    level: [PAD_SPEC.bottom, PAD_SPEC.top],
    positions: PAD_SPEC.positions.map((position) => [position[0], position[1]]),
  },
  columns: SATIN_COLUMN_SPECS,
  bundles: {
    rodCount: BUNDLE_SPEC.rodCount,
    rodRadius: BUNDLE_SPEC.rodRadius,
    rodLength: BUNDLE_SPEC.rodLength,
    nearX: BUNDLE_SPEC.nearX,
    farX: BUNDLE_SPEC.farX,
    coreRadius: BUNDLE_SPEC.coreRadius,
    offsets: BUNDLE_SPEC.offsets,
    fan: BUNDLE_SPEC.fan,
    boltRadius: BUNDLE_SPEC.boltRadius,
    boltCount: BUNDLE_SPEC.boltPositions.length,
    boltPositions: BUNDLE_SPEC.boltPositions,
  },
  accents: {
    orange: ACCENT_SPEC.colors.orange,
    blue: ACCENT_SPEC.colors.blue,
    edge: ACCENT_SPEC.colors.edge,
    rim: ACCENT_SPEC.rim,
    orangeInlay: ACCENT_SPEC.orangeInlay,
    blueRim: ACCENT_SPEC.blueRim,
  },
  flowPath: FLOW_POINTS,
  flowLevels: {
    lower: PLATE_LEVELS.lower.flowLevel,
    upper: PLATE_LEVELS.upper.flowLevel,
    interlock: 875,
  },
  fitBounds: {
    min: { x: FIT_BOUNDS_MIN.x, y: FIT_BOUNDS_MIN.y, z: FIT_BOUNDS_MIN.z },
    max: { x: FIT_BOUNDS_MAX.x, y: FIT_BOUNDS_MAX.y, z: FIT_BOUNDS_MAX.z },
  },
});

/* ========================================================================= */
/* Satin material (columns deliverable integration)                          */
/* ========================================================================= */

function resolveSatinTilePx(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  return SATIN_TILE_PX;
}

/**
 * Clone the columns deliverable's satin material for this page.
 *
 * The clone keeps the columns tuning verbatim (metalness/roughness/
 * envMapIntensity and every derived map) so it inherits the current satin grain
 * and soft blurred reflection; only the name / provenance is page-specific.
 * The satin's aoMap samples uv2, so every column geometry must carry a
 * duplicated uv2 attribute (the model does that).
 *
 * @param {object} bank object resolved by `loadColumnBank()` from columns-model.js
 * @returns {THREE.MeshStandardMaterial}
 */
export function createSatinMaterial(bank) {
  const source = bank && bank.materials ? bank.materials.satin : null;
  if (!source || source.isMaterial !== true) {
    fail(
      'createSatinMaterial(bank) requires bank.materials.satin from loadColumnBank() (got ' +
        describeValue(bank && bank.materials ? bank.materials.satin : bank) + ')',
    );
  }
  const material = source.clone();
  material.name = 'connection-satin';
  // REVISION 2: the page studio is brighter, so the satin env response is
  // lifted to ~3.0 while keeping the columns deliverable's maps/tuning.
  material.envMapIntensity = 3.0;
  const sourceUserData = source.userData && typeof source.userData === 'object' ? source.userData : {};
  material.userData = {
    ...sourceUserData,
    role: 'connection-satin',
    source: 'columns',
    clonedFrom: source.name || 'column-material:satin',
    tilePx: bank && bank.tilePx ? bank.tilePx.satin : null,
    uv2:
      'geometry uv2 = uv (three r151 samples the satin aoMap from uv2; the columns geometry bakes uv, ' +
      'the model duplicates it)',
    envMode: 'scene.environment / page PMREM studio (cloned material envMap stays null)',
  };
  material.needsUpdate = true;
  return material;
}

/**
 * Numeric satin fallback used only when the columns bank cannot be loaded:
 * exactly the published contract numbers (color 0xb9bdc4, metalness 0.85,
 * roughness 0.24, envMapIntensity 2.4), no derived maps.
 * @returns {THREE.MeshStandardMaterial}
 */
export function createFallbackSatinMaterial() {
  const material = new THREE.MeshStandardMaterial({
    name: 'connection-satin-fallback',
    color: new THREE.Color(0xb9bdc4),
    metalness: 0.85,
    roughness: 0.24,
    envMapIntensity: 2.4,
    dithering: true,
  });
  material.userData = {
    role: 'connection-satin',
    source: 'fallback',
    note:
      'columns-model loadColumnBank() was unavailable; the numeric satin contract is preserved ' +
      '(metalness 0.85 / roughness 0.24 / envMapIntensity 2.4) but the derived albedo/ao maps are missing',
  };
  return material;
}

/* ========================================================================= */
/* Procedural rib maps (metal body side walls)                               */
/* ========================================================================= */

/**
 * Build the deterministic rib normal + roughness + albedo maps for the metal
 * bodies.
 *
 * The rib pattern varies only along the geometry V axis (v = world y / 320), so
 * horizontal ribs stay continuous and phase-locked across the two arm joints of
 * an L body, they wrap around the open end faces (world-Y UV) and they close
 * cleanly because the stitch is at a groove. One texture tile covers
 * RIB_TILE_PX world px and contains RIB_COUNT ribs (8 px pitch ≈ 24 ribs over
 * the 190 px body) — the fine polished ribbing of the reference figure.
 *
 * All three maps are procedural canvas textures generated from a fixed formula —
 * no randomness — and are owned by the model (disposed by `dispose()`).
 *
 * @param {(() => object)|null} createCanvas optional DOM-canvas factory hook
 * @returns {{normal:THREE.CanvasTexture|null, roughness:THREE.CanvasTexture|null,
 *            albedo:THREE.CanvasTexture|null, meta:object}}
 */
function createRibTextures(createCanvas) {
  const meta = {
    tilePx: RIB_TILE_PX,
    ribCount: RIB_COUNT,
    ribPitchPx: round(RIB_TILE_PX / RIB_COUNT, 3),
    width: 64,
    height: 1024,
    generated: false,
  };

  const width = meta.width;
  const height = meta.height;
  const canvases = [];
  const images = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const canvas = resolveCanvas(createCanvas);
    if (!canvas || typeof canvas.getContext !== 'function') {
      return { normal: null, roughness: null, albedo: null, meta };
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { normal: null, roughness: null, albedo: null, meta };
    canvases.push({ canvas, ctx });
    images.push(ctx.createImageData(width, height));
  }

  const normalData = images[0].data;
  const roughData = images[1].data;
  const albedoData = images[2].data;

  // Rounded ridge profile per rib: h(phase) = A · sin(π·phase) — smooth polished
  // crest lands separated by narrow dark grooves (the reference ribbing).
  const amplitudePx = 0.6;
  for (let y = 0; y < height; y += 1) {
    const phase = ((y + 0.5) / height) * RIB_COUNT;
    const frac = phase - Math.floor(phase);
    const slopeV = (amplitudePx * Math.PI * RIB_COUNT * Math.cos(Math.PI * frac)) / RIB_TILE_PX;
    // Tangent-space normal (T along u, B along v, N out): n = (-du, -dv, 1) / |…|
    const ny = -slopeV;
    const inv = 1 / Math.sqrt(ny * ny + 1);
    const nr = 128;
    const ng = Math.round((ny * inv * 0.5 + 0.5) * 255);
    const nb = Math.round((inv * 0.5 + 0.5) * 255);
    const ridge = Math.sin(Math.PI * frac); // 0 at the groove, 1 at the crest
    // Polished land at the crest, satin groove at the valley.
    const roughness = clamp(0.42 - 0.29 * Math.pow(ridge, 0.7), 0.06, 1);
    const roughLevel = Math.round(roughness * 255);
    // Baked rib albedo/AO: bright polished ridge lands, dark grooves, so the
    // ridge contrast survives the dark studio without relying on the env only.
    const land = Math.pow(ridge, 0.55);
    const albedo = 0.36 + 0.58 * land;
    const albedoLevel = Math.round(albedo * 255);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      normalData[offset] = nr;
      normalData[offset + 1] = ng;
      normalData[offset + 2] = nb;
      normalData[offset + 3] = 255;
      roughData[offset] = roughLevel;
      roughData[offset + 1] = roughLevel;
      roughData[offset + 2] = roughLevel;
      roughData[offset + 3] = 255;
      albedoData[offset] = albedoLevel;
      albedoData[offset + 1] = albedoLevel;
      albedoData[offset + 2] = albedoLevel;
      albedoData[offset + 3] = 255;
    }
  }

  const specs = [
    { name: 'connection-rib-normal', data: normalData, role: 'rib-normal', colorEncoding: false, map: false },
    { name: 'connection-rib-roughness', data: roughData, role: 'rib-roughness', colorEncoding: false, map: false },
    { name: 'connection-rib-albedo', data: albedoData, role: 'rib-albedo', colorEncoding: true, map: true },
  ];
  const textures = [];
  for (let i = 0; i < canvases.length; i += 1) {
    const { canvas, ctx } = canvases[i];
    const spec = specs[i];
    ctx.putImageData(images[i], 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = spec.name;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.encoding = spec.colorEncoding ? THREE.sRGBEncoding : THREE.LinearEncoding;
    texture.needsUpdate = true;
    texture.userData = { role: spec.role, procedural: true, ...meta };
    textures.push(texture);
  }
  meta.generated = true;
  return { normal: textures[0], roughness: textures[1], albedo: textures[2], meta };
}

/* ========================================================================= */
/* Extruded rounded L prism geometry                                         */
/* ========================================================================= */

function pointInArms(x, z, arms) {
  for (const arm of arms) {
    if (x >= arm.x[0] && x <= arm.x[1] && z >= arm.z[0] && z <= arm.z[1]) return true;
  }
  return false;
}

/**
 * Outward normals of every edge of a rectilinear L outline, probed against the
 * arm rectangles (so the function is independent of the outline's winding).
 * @param {ReadonlyArray<ReadonlyArray<number>>} outline [x, z] vertices
 * @param {ReadonlyArray<{x:number[],z:number[]}>} arms plan rectangles
 * @returns {Array<{x:number, z:number}>}
 */
function outlineEdgeNormals(outline, arms) {
  const count = outline.length;
  const normals = [];
  for (let i = 0; i < count; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % count];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    let nx = -dz / length;
    let nz = dx / length;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    // The union is on one side of every edge; probe a hair along the candidate
    // normal and flip if that lands inside the solid.
    if (pointInArms(mx + nx * 0.01, mz + nz * 0.01, arms)) {
      nx = -nx;
      nz = -nz;
    }
    normals.push({ x: nx, z: nz });
  }
  return normals;
}

/**
 * Outward-offset a rectilinear L outline by `expansion` world px (negative =
 * inset). Every outline vertex is a right angle, so the mitre offset is simply
 * `V + expansion · (n_prev + n_next)`.
 *
 * @param {ReadonlyArray<ReadonlyArray<number>>} outline [x, z] vertices
 * @param {number} expansion world px (may be negative)
 * @param {ReadonlyArray<{x:number[],z:number[]}>} arms plan rectangles
 * @returns {Array<{x:number, z:number}>}
 */
function expandLOutline(outline, expansion, arms) {
  const count = outline.length;
  const normals = outlineEdgeNormals(outline, arms);
  const expanded = [];
  for (let i = 0; i < count; i += 1) {
    const previous = normals[(i - 1 + count) % count];
    const next = normals[i];
    expanded.push({
      x: outline[i][0] + expansion * (previous.x + next.x),
      z: outline[i][1] + expansion * (previous.z + next.z),
    });
  }
  return expanded;
}

/**
 * Build the extruded, bevelled L prism for a plate body or an acrylic cap.
 *
 * The published cap plan is "body plan expanded by E on every outer edge"; the
 * extruder shapes the slab from the plan inset by the bevel and lets the bevel
 * grow it back out, so the outer silhouette is exactly E (and the total height is
 * exactly `height`, bottom face flat at `bottom`). After `rotateX(-π/2)` the
 * shape's Y axis maps to world -Z, so the shape is authored as (x, -z) to land
 * the plan in world x/z.
 *
 * @param {object} options
 * @param {ReadonlyArray<ReadonlyArray<number>>} options.outline published plan outline
 * @param {ReadonlyArray<object>} options.arms plan arm rectangles (offset probes)
 * @param {number} options.expansion plan expansion in world px
 * @param {number} options.height total slab height in world px
 * @param {number} options.bottom world y of the flat bottom face
 * @param {number} options.bevel bevel size/thickness
 * @param {number} options.bevelSegments bevel segments per 90° arc
 * @returns {THREE.ExtrudeGeometry}
 */
function buildExtrudedPlanPrism({ outline, arms, expansion, height, bottom, bevel, bevelSegments }) {
  const shapeExpansion = expansion - bevel;
  const points = expandLOutline(outline, shapeExpansion, arms);
  // Shape-space points: y = -z (see the rotateX(-π/2) mapping above).
  const shapePoints = points.map((point) => new THREE.Vector2(point.x, -point.z));
  // ExtrudeGeometry keeps the contour winding; make it counter-clockwise in
  // shape space so the extruded side walls face outward.
  let signedArea = 0;
  for (let i = 0; i < shapePoints.length; i += 1) {
    const a = shapePoints[i];
    const b = shapePoints[(i + 1) % shapePoints.length];
    signedArea += a.x * b.y - b.x * a.y;
  }
  if (signedArea < 0) shapePoints.reverse();
  const shape = new THREE.Shape();
  shape.moveTo(shapePoints[0].x, shapePoints[0].y);
  for (let i = 1; i < shapePoints.length; i += 1) shape.lineTo(shapePoints[i].x, shapePoints[i].y);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.5, height - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments,
    steps: 1,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox ? geometry.boundingBox.min.y : 0;
  geometry.translate(0, bottom - minY, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Bake the columns-deliverable world-scale planar UVs into an extruded prism
 * (dominant |normal| axis, right-handed so tangent-space normal maps stay
 * correct). Side faces get v = world y / tilePx, so the horizontal rib pattern
 * is phase-locked across the arm joints of the L.
 * @param {THREE.BufferGeometry} geometry
 * @param {number} tilePx world px per texture tile
 * @returns {THREE.BufferGeometry}
 */
function applyWorldUv(geometry, tilePx) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || !normal) return geometry;
  const invTile = 1 / tilePx;
  const uv = new Float32Array(position.count * 2);
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
    if (ay + 1e-9 >= ax && ay + 1e-9 >= az) {
      // ±Y: u = x, v = ∓z
      u = x * invTile;
      v = (ny >= 0 ? -z : z) * invTile;
    } else if (ax + 1e-9 >= az) {
      // ±X: u = ∓z, v = y
      u = (nx >= 0 ? -z : z) * invTile;
      v = y * invTile;
    } else {
      // ±Z: u = ±x, v = y
      u = (nz >= 0 ? x : -x) * invTile;
      v = y * invTile;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/* ========================================================================= */
/* Flow trace (routed inlay on the dark-glass top faces)                     */
/* ========================================================================= */

/** Deterministic point-in-polygon test (ray casting) for an [x,z] polygon. */
function pointInPlan(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Build a thin generalized-cylinder tube through a polyline (used by the routed
 * flow trace). Deterministic parallel-transport frames, no random values.
 * @param {THREE.Vector3[]} points polyline points (>= 2)
 * @param {number} radius tube radius
 * @param {number} sides cross-section segments
 * @returns {THREE.BufferGeometry|null}
 */
function buildPolylineTube(points, radius, sides) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const positions = [];
  const normals = [];
  const indices = [];
  const tangent = new THREE.Vector3();
  const previousTangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const rotated = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  previousTangent.subVectors(points[1], points[0]).normalize();
  const up = Math.abs(previousTangent.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0);
  normal.crossVectors(previousTangent, up).normalize();
  if (normal.lengthSq() < 1e-8) normal.set(1, 0, 0);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (i === 0) tangent.subVectors(points[1], points[0]).normalize();
    else if (i === points.length - 1) tangent.subVectors(points[i], points[i - 1]).normalize();
    else tangent.subVectors(points[i + 1], points[i - 1]).normalize();
    if (i > 0) {
      quaternion.setFromUnitVectors(previousTangent, tangent);
      rotated.copy(normal).applyQuaternion(quaternion);
      rotated.sub(tangent.clone().multiplyScalar(rotated.dot(tangent)));
      if (rotated.lengthSq() > 1e-10) normal.copy(rotated).normalize();
    }
    binormal.crossVectors(tangent, normal).normalize();
    normal.crossVectors(binormal, tangent).normalize();
    previousTangent.copy(tangent);
    for (let side = 0; side < sides; side += 1) {
      const angle = (TAU * side) / sides;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = normal.x * cos + binormal.x * sin;
      const ny = normal.y * cos + binormal.y * sin;
      const nz = normal.z * cos + binormal.z * sin;
      positions.push(point.x + nx * radius, point.y + ny * radius, point.z + nz * radius);
      normals.push(nx, ny, nz);
    }
  }
  for (let row = 0; row < points.length - 1; row += 1) {
    for (let side = 0; side < sides; side += 1) {
      const nextSide = (side + 1) % sides;
      const a = row * sides + side;
      const b = row * sides + nextSide;
      const c = (row + 1) * sides + nextSide;
      const d = (row + 1) * sides + side;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Create the two routed flow-trace meshes: the conduit route projected onto each
 * plate's cap2 top plane, clipped to the dark-glass plan and (for the lower
 * plate) to the part that is not under the upper plate.
 *
 * @param {object} path rounded flow path
 * @param {THREE.Material} material additive trace material
 * @param {THREE.BufferGeometry[]} ownedGeometries disposal ledger
 * @returns {{upper:THREE.Mesh, lower:THREE.Mesh, meta:object}}
 */
function createFlowTrace(path, material, ownedGeometries) {
  const samples = path.sample(2);
  const upperPlan = expandLOutline(PLATE_OUTLINES.upper, CAP_SPEC.dark.expansion - 4, PLATE_PLANS.upper);
  const lowerPlan = expandLOutline(PLATE_OUTLINES.lower, CAP_SPEC.dark.expansion - 4, PLATE_PLANS.lower);
  const upperOccluder = expandLOutline(PLATE_OUTLINES.upper, CAP_SPEC.dark.expansion + 4, PLATE_PLANS.upper);
  const upperY = PLATE_LEVELS.upper.top + 0.55;
  const lowerY = PLATE_LEVELS.lower.top + 0.55;
  const upperPoints = [];
  const lowerPoints = [];
  for (const sample of samples) {
    const point = sample.point;
    if (point.y > PLATE_LEVELS.upper.flowLevel - 0.5 && pointInPlan(point.x, point.z, upperPlan)) {
      upperPoints.push(V3(point.x, upperY, point.z));
    }
    if (
      point.y < PLATE_LEVELS.lower.flowLevel + 0.5 &&
      pointInPlan(point.x, point.z, lowerPlan) &&
      !pointInPlan(point.x, point.z, upperOccluder)
    ) {
      lowerPoints.push(V3(point.x, lowerY, point.z));
    }
  }
  const buildMesh = (points, name) => {
    // split into contiguous runs (the trace may have gaps)
    const runs = [];
    let current = [];
    let previous = null;
    for (const point of points) {
      if (previous && previous.distanceTo(point) > 4) {
        if (current.length >= 2) runs.push(current);
        current = [];
      }
      current.push(point);
      previous = point;
    }
    if (current.length >= 2) runs.push(current);
    const geometries = [];
    for (let i = 0; i < runs.length; i += 1) {
      const geometry = buildPolylineTube(runs[i], 1.2, 6);
      if (!geometry) continue;
      geometry.name = name + '-run-' + (i + 1);
      geometry.userData = { role: 'flow-trace', radius: 1.2, run: i };
      ownedGeometries.push(geometry);
      geometries.push(geometry);
    }
    const group = new THREE.Group();
    group.name = name;
    for (const geometry of geometries) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = geometry.name;
      mesh.renderOrder = 6;
      mesh.userData = { role: 'flow-trace' };
      group.add(mesh);
    }
    return group;
  };
  return {
    upper: buildMesh(upperPoints, 'connection-flow-trace-upper'),
    lower: buildMesh(lowerPoints, 'connection-flow-trace-lower'),
    meta: {
      radius: 1.2,
      opacity: 0.35,
      upperRuns: 1,
      lowerRuns: 1,
      upperSamples: upperPoints.length,
      lowerSamples: lowerPoints.length,
    },
  };
}

/* ========================================================================= */
/* Rounded flow path                                                         */
/* ========================================================================= */

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const sub = (a, b) => V3(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const distance3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Compute the per-corner nominal fillet limit from the segment lengths (a fillet
 * may never eat more than half of either adjacent segment) and the published
 * corner radius.
 * @param {ReadonlyArray<ReadonlyArray<number>>} points
 * @returns {number[]} one entry per point (0 for the two open ends)
 */
function nominalCornerRadii(points) {
  const radii = new Array(points.length).fill(0);
  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = distance3(points[i], points[i - 1]);
    const next = distance3(points[i + 1], points[i]);
    if (!(previous > 1e-6) || !(next > 1e-6)) continue;
    // Collinear control points (P1 and P8 in the published path) are not
    // corners: rounding them would double the path back on itself.
    const inX = points[i][0] - points[i - 1][0];
    const inY = points[i][1] - points[i - 1][1];
    const inZ = points[i][2] - points[i - 1][2];
    const outX = points[i + 1][0] - points[i][0];
    const outY = points[i + 1][1] - points[i][1];
    const outZ = points[i + 1][2] - points[i][2];
    const dot = (inX * outX + inY * outY + inZ * outZ) / (previous * next);
    if (dot > 0.9999) continue;
    radii[i] = Math.min(FLOW_SPEC.cornerRadius, previous / 2, next / 2);
  }
  return radii;
}

/**
 * Create the rounded flow path: straight segments joined by 90° circular
 * fillets. A corner segment is `point(θ) = C − r·cosθ·d2 + r·sinθ·d1` with
 * `C = P + r·(d2 − d1)`, which starts exactly at `P − r·d1` (end of the incoming
 * segment) and ends exactly at `P + r·d2` (start of the outgoing segment), with
 * the tangent running from d1 to d2.
 *
 * @param {ReadonlyArray<ReadonlyArray<number>>} points control points
 * @param {number[]} radii per-point fillet radii (0 = no corner)
 * @returns {object} path object with length / pointAt / tangentAt / segment info
 */
function createRoundedPath(points, radii) {
  const segments = [];
  let total = 0;
  const pushLine = (a, b) => {
    const length = distance3(a, b);
    if (length < 1e-6) return;
    const direction = V3((b[0] - a[0]) / length, (b[1] - a[1]) / length, (b[2] - a[2]) / length);
    segments.push({
      type: 'line',
      start: total,
      length,
      tangentAt: () => direction,
      pointAt: (s) => V3(a[0] + direction.x * s, a[1] + direction.y * s, a[2] + direction.z * s),
    });
    total += length;
  };
  const pushArc = (corner, radius, d1, d2) => {
    const length = radius * HALF_PI;
    if (length < 1e-6) return;
    const center = [
      corner[0] + radius * (d2.x - d1.x),
      corner[1] + radius * (d2.y - d1.y),
      corner[2] + radius * (d2.z - d1.z),
    ];
    segments.push({
      type: 'arc',
      start: total,
      length,
      radius,
      center,
      pointAt: (s) => {
        const theta = clamp(s / radius, 0, HALF_PI);
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        return V3(
          center[0] - radius * cos * d2.x + radius * sin * d1.x,
          center[1] - radius * cos * d2.y + radius * sin * d1.y,
          center[2] - radius * cos * d2.z + radius * sin * d1.z,
        );
      },
      tangentAt: (s) => {
        const theta = clamp(s / radius, 0, HALF_PI);
        const sin = Math.sin(theta);
        const cos = Math.cos(theta);
        const direction = V3(
          sin * d2.x + cos * d1.x,
          sin * d2.y + cos * d1.y,
          sin * d2.z + cos * d1.z,
        );
        return direction.normalize();
      },
    });
    total += length;
  };

  let cursor = V3(points[0][0], points[0][1], points[0][2]);
  for (let i = 1; i < points.length - 1; i += 1) {
    const corner = points[i];
    const radius = radii[i] || 0;
    const previous = points[i - 1];
    const next = points[i + 1];
    if (radius > 1e-6) {
      const d1 = sub(corner, previous).normalize();
      const d2 = sub(next, corner).normalize();
      const tangentIn = V3(
        corner[0] - radius * d1.x,
        corner[1] - radius * d1.y,
        corner[2] - radius * d1.z,
      );
      pushLine([cursor.x, cursor.y, cursor.z], [tangentIn.x, tangentIn.y, tangentIn.z]);
      pushArc(corner, radius, d1, d2);
      const tangentOut = V3(
        corner[0] + radius * d2.x,
        corner[1] + radius * d2.y,
        corner[2] + radius * d2.z,
      );
      cursor = tangentOut;
    }
  }
  const last = points[points.length - 1];
  pushLine([cursor.x, cursor.y, cursor.z], [last[0], last[1], last[2]]);

  const length = total;
  const findSegment = (s) => {
    const clamped = clamp(s, 0, length);
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (segments[mid].start <= clamped) low = mid;
      else high = mid - 1;
    }
    return segments[low];
  };
  return {
    points,
    radii,
    segments,
    length,
    pointAt(s) {
      const segment = findSegment(s);
      return segment.pointAt(clamp(s - segment.start, 0, segment.length));
    },
    tangentAt(s) {
      const segment = findSegment(s);
      return segment.tangentAt(clamp(s - segment.start, 0, segment.length));
    },
    /** Uniform arc-length samples `[{ s, point, tangent }]`. */
    sample(step) {
      const spacing = Math.max(0.5, Number(step) || 2);
      const count = Math.max(2, Math.ceil(length / spacing) + 1);
      const samples = [];
      for (let i = 0; i < count; i += 1) {
        const s = (length * i) / (count - 1);
        samples.push({ s, point: this.pointAt(s), tangent: this.tangentAt(s) });
      }
      return samples;
    },
  };
}

/** Flow tube radius profile: full radius through the object, pinch out at the ends. */
function flowRadiusAt(s, length) {
  const taper = FLOW_SPEC.taper;
  const edge = Math.min(s, length - s);
  const scale = smoothstep01(edge / taper);
  return Math.max(FLOW_SPEC.radius * scale, 0.02);
}

/* ========================================================================= */
/* Clearance QA                                                              */
/* ========================================================================= */

/** `[minX,minY,minZ,maxX,maxY,maxZ]` box from two world points. */
function boxFromPoints(a, b) {
  return [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]),
    Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]),
  ];
}

/**
 * Box from an arm rectangle + a world y range. `planInflate` expands the plan
 * (x/z) only — a cap's "+12/+26 on every outer edge" is a PLAN expansion and
 * must not eat into the 28 px air seam above/below the slab.
 */
function boxFromArm(arm, yBottom, yTop, planInflate = 0) {
  return [
    arm.x[0] - planInflate, yBottom, arm.z[0] - planInflate,
    arm.x[1] + planInflate, yTop, arm.z[1] + planInflate,
  ];
}

/**
 * Distance from a point to an axis-aligned box `[minX,minY,minZ,maxX,maxY,maxZ]`.
 * @returns {number}
 */
function pointBoxDistance(point, box) {
  const dx = Math.max(box[0] - point[0], 0, point[0] - box[3]);
  const dy = Math.max(box[1] - point[1], 0, point[1] - box[4]);
  const dz = Math.max(box[2] - point[2], 0, point[2] - box[5]);
  return Math.hypot(dx, dy, dz);
}

/** Per-solid minimum distance from a point (min over the solid's boxes). */
function pointSolidDistance(point, solid) {
  let best = Infinity;
  for (const box of solid.boxes) {
    const distance = pointBoxDistance(point, box);
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * Build the complete QA solid list: 4 plate body arms (metal), 4 acrylic caps
 * (clear cap1 + dark cap2 for each plate, each decomposed into its two arm
 * boxes so the L notch is not falsely filled), 2 pads, 2 columns (AABB inflated
 * by the column's corner radius), 10 rods (centre-line AABB + rod radius) and
 * 6 bolts (point + bolt radius).
 * @returns {Array<{id:string,kind:'metal'|'acrylic',boxes:number[][],radius:number}>}
 */
function buildClearanceSolids() {
  const solids = [];
  const addBodyArms = (plateKey, levels) => {
    for (const arm of PLATE_PLANS[plateKey]) {
      solids.push({
        id: plateKey + '-body-' + arm.id.toLowerCase(),
        kind: 'metal',
        radius: 0,
        boxes: [boxFromArm(arm, levels.body.bottom, levels.body.top)],
      });
    }
  };
  const addCap = (plateKey, levels, capKey, capSpec) => {
    solids.push({
      id: plateKey + '-' + capSpec.id,
      kind: 'acrylic',
      radius: 0,
      boxes: PLATE_PLANS[plateKey].map((arm) =>
        boxFromArm(arm, levels[capKey].bottom, levels[capKey].top, capSpec.expansion)),
    });
  };
  addBodyArms('lower', PLATE_LEVELS.lower);
  addBodyArms('upper', PLATE_LEVELS.upper);
  addCap('lower', PLATE_LEVELS.lower, 'cap1', CAP_SPEC.clear);
  addCap('lower', PLATE_LEVELS.lower, 'cap2', CAP_SPEC.dark);
  addCap('upper', PLATE_LEVELS.upper, 'cap1', CAP_SPEC.clear);
  addCap('upper', PLATE_LEVELS.upper, 'cap2', CAP_SPEC.dark);

  PAD_SPEC.positions.forEach((position, index) => {
    solids.push({
      id: 'pad-' + (index + 1),
      kind: 'metal',
      radius: 0,
      boxes: [[
        position[0] - PAD_SPEC.width / 2, PAD_SPEC.bottom, position[1] - PAD_SPEC.depth / 2,
        position[0] + PAD_SPEC.width / 2, PAD_SPEC.top, position[1] + PAD_SPEC.depth / 2,
      ]],
    });
  });

  SATIN_COLUMN_SPECS.forEach((spec) => {
    const [x, , z] = spec.position;
    solids.push({
      id: spec.id,
      kind: 'metal',
      radius: 0,
      boxes: [[
        x - spec.width / 2 - spec.radius, 0, z - spec.depth / 2 - spec.radius,
        x + spec.width / 2 + spec.radius, spec.height, z + spec.depth / 2 + spec.radius,
      ]],
    });
  });

  // Rod bundles: one centre-line AABB per rod (its slight fan is inside the box)
  // plus the rod radius as the solid radius.
  for (const bundle of [-1, 1]) {
    const flowLevel = bundle > 0 ? PLATE_LEVELS.upper.flowLevel : PLATE_LEVELS.lower.flowLevel;
    const flowZ = bundle > 0 ? -210 : 470;
    const nearX = BUNDLE_SPEC.nearX * bundle;
    const farX = BUNDLE_SPEC.farX * bundle;
    BUNDLE_SPEC.offsets.forEach((offset, index) => {
      const dy0 = offset[0];
      const dz0 = offset[1];
      const dy1 = dy0 * (1 + BUNDLE_SPEC.fan);
      const dz1 = dz0 * (1 + BUNDLE_SPEC.fan);
      solids.push({
        id: 'rod-' + (bundle > 0 ? 'upper' : 'lower') + '-' + (index + 1),
        kind: 'acrylic',
        radius: BUNDLE_SPEC.rodRadius,
        boxes: [boxFromPoints(
          [nearX, flowLevel + dy0, flowZ + dz0],
          [farX, flowLevel + dy1, flowZ + dz1],
        )],
      });
    });
  }

  BUNDLE_SPEC.boltPositions.forEach((position, index) => {
    solids.push({
      id: 'bolt-' + (index + 1),
      kind: 'metal',
      radius: BUNDLE_SPEC.boltRadius,
      boxes: [[position[0], position[1], position[2], position[0], position[1], position[2]]],
    });
  });
  return solids;
}

/**
 * Minimum clearance of one point against every solid:
 * `min_solid( distance(point, solid) − solid.radius ) − flowRadius`.
 * @returns {number}
 */
function clearanceAtPoint(point, solids) {
  let best = Infinity;
  for (const solid of solids) {
    const distance = pointSolidDistance(point, solid) - solid.radius;
    if (distance < best) best = distance;
  }
  return best - FLOW_SPEC.radius;
}

/**
 * Compute the contract's flow clearance report. The centreline is sampled every
 * `FLOW_SPEC.sampleStep` world px; for every solid the minimum
 * `distance − flowRadius − solidRadius` over all samples is recorded; `min` is
 * the global minimum and `violations` lists the samples with clearance < 2.
 * @param {object} path rounded flow path
 * @param {ReadonlyArray<object>} solids QA solid list
 * @returns {{min:number, violations:Array<object>, samples:number, solids:Array<object>}}
 */
function computeClearance(path, solids) {
  const step = FLOW_SPEC.sampleStep;
  const samples = path.sample(step);
  const perSolid = solids.map((solid) => ({ id: solid.id, kind: solid.kind, minClearance: Infinity }));
  const violations = [];
  let globalMin = Infinity;
  for (const sample of samples) {
    const point = [sample.point.x, sample.point.y, sample.point.z];
    for (let s = 0; s < solids.length; s += 1) {
      const solid = solids[s];
      const clearance = pointSolidDistance(point, solid) - solid.radius - FLOW_SPEC.radius;
      const record = perSolid[s];
      if (clearance < record.minClearance) record.minClearance = clearance;
      if (clearance < globalMin) globalMin = clearance;
      if (clearance < 2 && violations.length < 64) {
        violations.push({
          s: round(sample.s, 2),
          point: [round(point[0], 2), round(point[1], 2), round(point[2], 2)],
          solid: solid.id,
          clearance: round(clearance, 3),
        });
      }
    }
  }
  return {
    min: round(globalMin, 3),
    violations,
    samples: samples.length,
    solids: perSolid.map((record) => ({
      id: record.id,
      kind: record.kind,
      minClearance: round(record.minClearance, 3),
    })),
  };
}

/**
 * Arc-only clearance for one corner candidate radius (used to clamp a fillet
 * that would pinch the tube against a cap corner).
 * @returns {number} minimum clearance over the arc samples
 */
function arcClearance(corner, next, previous, radius, solids) {
  const d1 = sub(corner, previous).normalize();
  const d2 = sub(next, corner).normalize();
  const length = radius * HALF_PI;
  const count = Math.max(3, Math.ceil(length / FLOW_SPEC.sampleStep));
  const center = [
    corner[0] + radius * (d2.x - d1.x),
    corner[1] + radius * (d2.y - d1.y),
    corner[2] + radius * (d2.z - d1.z),
  ];
  let best = Infinity;
  for (let i = 0; i <= count; i += 1) {
    const theta = (HALF_PI * i) / count;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const point = [
      center[0] - radius * cos * d2.x + radius * sin * d1.x,
      center[1] - radius * cos * d2.y + radius * sin * d1.y,
      center[2] - radius * cos * d2.z + radius * sin * d1.z,
    ];
    const clearance = clearanceAtPoint(point, solids);
    if (clearance < best) best = clearance;
  }
  return best;
}

/**
 * Resolve the actual per-corner fillet radii: start from the published nominal
 * radius (already limited by the two adjacent segment lengths) and walk it down
 * deterministically until the corner arc keeps a small safety margin over the
 * published 8 px minimum clearance.
 *
 * Why: the first contract draft published cornerRadius = 46 with P3/P4 placed
 * only 20 px outside the upper cap1 end face; a 46 px fillet at P3 swept the
 * tube ~1.2 px into that cap's corner. The revision-2 constants (cornerRadius
 * 26) plus the per-corner clamp keep every sample >= 8 px; the actual radii are
 * reported in debug().
 *
 * @returns {{radii:number[], nominal:number[]}}
 */
function solveCornerRadii(points, solids) {
  const nominal = nominalCornerRadii(points);
  const radii = nominal.slice();
  const targetClearance = 8.25;
  for (let i = 1; i < points.length - 1; i += 1) {
    if (radii[i] <= 8) continue;
    let chosen = Math.min(radii[i], 8);
    let bestClearance = -Infinity;
    let bestRadius = chosen;
    for (let candidate = Math.max(8, Math.floor(radii[i])); candidate >= 8; candidate -= 1) {
      const clearance = arcClearance(points[i], points[i + 1], points[i - 1], candidate, solids);
      if (clearance >= targetClearance) {
        chosen = candidate;
        bestClearance = clearance;
        bestRadius = candidate;
        break;
      }
      // Even a tight corner can be the best available: keep the radius that
      // maximises the clearance instead of collapsing to a random minimum.
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestRadius = candidate;
      }
    }
    if (bestClearance < targetClearance) chosen = bestRadius;
    radii[i] = chosen;
  }
  return { radii, nominal };
}

/* ========================================================================= */
/* Mesh / material construction helpers                                      */
/* ========================================================================= */

function tagMesh(mesh, role, extra = {}) {
  mesh.userData = { ...(mesh.userData || {}), role, ...extra };
  return mesh;
}

/* ========================================================================= */
/* createConnectionModel                                                     */
/* ========================================================================= */

/**
 * Build the whole connection scene synchronously.
 *
 * @param {object} [options]
 * @param {THREE.Material|null} [options.satinMaterial] satin material from
 *        `createSatinMaterial(bank)` (or the columns bank satin itself — the
 *        model clones it so it never mutates the caller's material)
 * @param {number|null} [options.satinTilePx] manifest satin tilePx (260 in the
 *        shipped manifest); the baked UV tile is this × UV_DENSITY_SCALE (1.3)
 * @param {Function|null} [options.createCanvas] optional canvas factory hook for
 *        node verifiers (no DOM available); the model builds headlessly without
 * @returns {object} model object:
 *   {
 *     version, group, bounds,
 *     materials: { satin, metal, ribNormal, ribRoughness, acrylicClear, acrylicDark,
 *                  flow, glow, accentOrange, accentBlue, rod, chrome },
 *     counts: { plates: 2, columns: 2, pads: 2, rodBundles: 2, rods: 10, particles: 72 },
 *     satin: { source: 'columns'|'fallback', material, tilePx, effectiveTilePx, ... },
 *     flow: { points, curveLength, radius, tube, glow, particles, pulses, clearance },
 *     update(elapsedSeconds), setPhase(phase01), getPhase(), debug(), dispose(),
 *   }
 */
export function createConnectionModel({
  satinMaterial = null,
  satinTilePx = null,
  createCanvas = null,
} = {}) {
  if (satinMaterial !== null && satinMaterial !== undefined && satinMaterial.isMaterial !== true) {
    fail('createConnectionModel({ satinMaterial }) must be a THREE.Material (got ' +
      describeValue(satinMaterial) + ')');
  }
  const tilePxManifest = resolveSatinTilePx(satinTilePx);
  const effectiveSatinTilePx = tilePxManifest * UV_DENSITY_SCALE;

  /* ---- owned resources -------------------------------------------------- */
  const disposed = { value: false };
  const ownedGeometries = [];
  const ownedMaterials = [];
  const ownedTextures = [];

  /* ---- materials -------------------------------------------------------- */
  const satinSourceMaterial = satinMaterial ? satinMaterial.clone() : createFallbackSatinMaterial();
  if (satinMaterial) {
    // Keep provenance: a fallback material passed by the page stays "fallback".
    const incomingSource = satinMaterial.userData && satinMaterial.userData.source;
    satinSourceMaterial.name = 'connection-satin';
    satinSourceMaterial.envMapIntensity = 3.0;
    satinSourceMaterial.userData = {
      ...(satinMaterial.userData || {}),
      role: 'connection-satin',
      source: incomingSource === 'fallback' ? 'fallback' : 'columns',
      clonedFrom: satinMaterial.name || 'column-material:satin',
      uv2: 'geometry uv2 = uv (three r151 samples the satin aoMap from uv2)',
      envMode: 'scene.environment / page PMREM studio',
    };
  }
  const satinSource = satinSourceMaterial.userData && satinSourceMaterial.userData.source === 'fallback'
    ? 'fallback' : 'columns';
  ownedMaterials.push(satinSourceMaterial);

  const ribTextures = createRibTextures(createCanvas);
  if (ribTextures.normal) ownedTextures.push(ribTextures.normal);
  if (ribTextures.roughness) ownedTextures.push(ribTextures.roughness);
  if (ribTextures.albedo) ownedTextures.push(ribTextures.albedo);

  const metalMaterial = new THREE.MeshStandardMaterial({
    name: 'connection-metal-ribbed',
    color: ribTextures.albedo ? new THREE.Color(0xffffff) : new THREE.Color(0xc9ced6),
    metalness: 0.95,
    roughness: ribTextures.roughness ? 1.0 : 0.3,
    map: ribTextures.albedo,
    normalMap: ribTextures.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: ribTextures.roughness,
    envMapIntensity: 2.5,
    dithering: true,
  });
  metalMaterial.userData = {
    role: 'metal-body',
    maps:
      'procedural rib albedo + normal + roughness (8 px pitch, world-Y phase; ' +
      'ribs continue around both arms and close at the open end faces)',
    uvMode: 'world-scale planar dominant-axis UV baked by the model',
  };
  ownedMaterials.push(metalMaterial);

  const acrylicClear = new THREE.MeshPhysicalMaterial({
    name: 'connection-acrylic-clear',
    color: new THREE.Color(0xd2e4f4),
    metalness: 0.0,
    roughness: 0.03,
    transmission: 0.95,
    thickness: 16,
    ior: 1.49,
    attenuationColor: new THREE.Color(0xb9d4ec),
    attenuationDistance: 900,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 2.0,
    transparent: true,
    opacity: 1,
    // FrontSide only: a DoubleSide transmissive slab renders its own back face
    // into the transmission buffer, which would hide the conduit in the seam.
    side: THREE.FrontSide,
  });
  acrylicClear.userData = { role: 'acrylic-clear', layer: 'cap1', transmission: 0.95, thickness: 16 };
  ownedMaterials.push(acrylicClear);

  const acrylicDark = new THREE.MeshPhysicalMaterial({
    name: 'connection-acrylic-dark',
    color: new THREE.Color(0x1b2230),
    metalness: 0.1,
    roughness: 0.04,
    transmission: 0.82,
    thickness: 24,
    ior: 1.52,
    attenuationColor: new THREE.Color(0x2a3a5a),
    attenuationDistance: 800,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.6,
    transparent: true,
    opacity: 1,
    // FrontSide only — see the clear cap above (double-sided transmission
    // back-faces would cover the flow seam in the transmission buffer).
    side: THREE.FrontSide,
  });
  acrylicDark.userData = { role: 'acrylic-dark', layer: 'cap2', transmission: 0.82, thickness: 24 };
  ownedMaterials.push(acrylicDark);

  const flowMaterial = new THREE.MeshStandardMaterial({
    name: 'connection-flow-silver',
    color: new THREE.Color(0xdce8f4),
    metalness: 0.92,
    roughness: 0.1,
    envMapIntensity: 2.6,
    // modest emissive so the dark glass above the seam visibly glows
    emissive: new THREE.Color(0x9dc2f0),
    emissiveIntensity: 0.42,
    dithering: true,
  });
  flowMaterial.userData = { role: 'flow-crystal', metalness: 0.92, roughness: 0.1, emissiveIntensity: 0.42 };
  ownedMaterials.push(flowMaterial);

  const glowMaterial = new THREE.MeshBasicMaterial({
    name: 'connection-flow-glow',
    color: new THREE.Color(0x9fc8ff),
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  glowMaterial.userData = { role: 'flow-glow', additive: true, radius: FLOW_SPEC.glowRadius };
  ownedMaterials.push(glowMaterial);

  const accentOrange = new THREE.MeshBasicMaterial({
    name: 'connection-accent-orange',
    color: new THREE.Color().setRGB(1.7, 0.33, 0.05),
    toneMapped: false,
  });
  accentOrange.userData = { role: 'accent-orange', hex: ACCENT_SPEC.colors.orange };
  ownedMaterials.push(accentOrange);

  const accentBlue = new THREE.MeshBasicMaterial({
    name: 'connection-accent-blue',
    color: new THREE.Color().setRGB(0.24, 0.55, 2.0),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  accentBlue.userData = { role: 'accent-blue', hex: ACCENT_SPEC.colors.blue, additive: true };
  ownedMaterials.push(accentBlue);

  const edgeLineMaterial = new THREE.MeshBasicMaterial({
    name: 'connection-edge-line',
    color: new THREE.Color().setRGB(0.62, 1.25, 1.7),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  edgeLineMaterial.userData = { role: 'edge-line', additive: true, cyanWhite: true };
  ownedMaterials.push(edgeLineMaterial);

  // Faint "flow trace" on the dark-glass TOP surfaces: a thin additive
  // cyan-white filament that follows the exact routed conduit route, so the
  // route reads from above like an inlaid light line.
  const traceMaterial = new THREE.MeshBasicMaterial({
    name: 'connection-flow-trace',
    color: new THREE.Color().setRGB(0.42, 0.82, 1.0),
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  traceMaterial.userData = { role: 'flow-trace', additive: true, radius: 1.2, opacity: 0.35 };
  ownedMaterials.push(traceMaterial);

  const rodMaterial = new THREE.MeshPhysicalMaterial({
    name: 'connection-rod-acrylic',
    color: new THREE.Color(0xdfeaf6),
    metalness: 0,
    roughness: 0.06,
    transmission: 0.88,
    thickness: 16,
    ior: 1.49,
    attenuationColor: new THREE.Color(0xbcd6f0),
    attenuationDistance: 900,
    transparent: true,
    opacity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 2.2,
  });
  rodMaterial.userData = { role: 'rod-acrylic', rodRadius: BUNDLE_SPEC.rodRadius };
  ownedMaterials.push(rodMaterial);

  const chromeMaterial = new THREE.MeshStandardMaterial({
    name: 'connection-chrome',
    color: new THREE.Color(0xeef2f7),
    metalness: 1.0,
    roughness: 0.08,
    envMapIntensity: 2.8,
  });
  chromeMaterial.userData = { role: 'chrome', metalness: 1.0, roughness: 0.08 };
  ownedMaterials.push(chromeMaterial);

  /* internal-only materials (not part of the published materials object) */
  const rodCoreMaterial = new THREE.MeshBasicMaterial({
    name: 'connection-rod-core',
    color: new THREE.Color(0xffffff),
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  rodCoreMaterial.userData = { role: 'rod-core', additive: true };
  ownedMaterials.push(rodCoreMaterial);

  const pulseMaterials = [
    new THREE.MeshBasicMaterial({
      name: 'connection-pulse-cool',
      color: new THREE.Color(0xd8ecff),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    new THREE.MeshBasicMaterial({
      name: 'connection-pulse-warm',
      color: new THREE.Color().setRGB(2.0, 0.75, 0.2),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    new THREE.MeshBasicMaterial({
      name: 'connection-pulse-blue',
      color: new THREE.Color().setRGB(0.35, 0.7, 2.2),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  ];
  ownedMaterials.push(...pulseMaterials);

  /* ---- group ------------------------------------------------------------ */
  const group = new THREE.Group();
  group.name = 'connection-model';
  group.userData = Object.freeze({ role: 'connection-model', version: MODEL_VERSION });

  const platesGroup = new THREE.Group();
  platesGroup.name = 'connection-plates';
  group.add(platesGroup);

  const columnsGroup = new THREE.Group();
  columnsGroup.name = 'connection-columns';
  group.add(columnsGroup);

  const padsGroup = new THREE.Group();
  padsGroup.name = 'connection-pads';
  group.add(padsGroup);

  const bundlesGroup = new THREE.Group();
  bundlesGroup.name = 'connection-bundles';
  group.add(bundlesGroup);

  const flowGroup = new THREE.Group();
  flowGroup.name = 'connection-flow';
  group.add(flowGroup);

  /* ---- plates ----------------------------------------------------------- */
  const plateMeshes = [];
  const buildPlate = (plateKey) => {
    const levels = PLATE_LEVELS[plateKey];
    const arms = PLATE_PLANS[plateKey];
    const outline = PLATE_OUTLINES[plateKey];

    // Metal body: rounded L prism, ribbed on the side walls.
    const bodyGeometry = buildExtrudedPlanPrism({
      outline,
      arms,
      expansion: 0,
      height: levels.body.top - levels.body.bottom,
      bottom: levels.body.bottom,
      bevel: CAP_SPEC.bodyBevel,
      bevelSegments: CAP_SPEC.bodyBevelSegments,
    });
    applyWorldUv(bodyGeometry, RIB_TILE_PX);
    bodyGeometry.name = 'connection-' + plateKey + '-body';
    bodyGeometry.userData = {
      role: 'plate-body',
      plate: plateKey,
      levels: [levels.body.bottom, levels.body.top],
      plan: arms,
      ribs: ribTextures.meta,
    };
    ownedGeometries.push(bodyGeometry);
    const bodyMesh = new THREE.Mesh(bodyGeometry, metalMaterial);
    bodyMesh.name = 'connection-' + plateKey + '-body';
    tagMesh(bodyMesh, 'plate-body', { plate: plateKey });
    platesGroup.add(bodyMesh);
    plateMeshes.push(bodyMesh);

    // clear cap1
    const cap1Geometry = buildExtrudedPlanPrism({
      outline,
      arms,
      expansion: CAP_SPEC.clear.expansion,
      height: levels.cap1.top - levels.cap1.bottom,
      bottom: levels.cap1.bottom,
      bevel: CAP_SPEC.clear.bevel,
      bevelSegments: CAP_SPEC.clear.bevelSegments,
    });
    cap1Geometry.name = 'connection-' + plateKey + '-cap1-clear';
    cap1Geometry.userData = {
      role: 'cap-clear',
      plate: plateKey,
      levels: [levels.cap1.bottom, levels.cap1.top],
      expansion: CAP_SPEC.clear.expansion,
    };
    ownedGeometries.push(cap1Geometry);
    const cap1Mesh = new THREE.Mesh(cap1Geometry, acrylicClear);
    cap1Mesh.name = 'connection-' + plateKey + '-cap1-clear';
    tagMesh(cap1Mesh, 'cap-clear', { plate: plateKey });
    platesGroup.add(cap1Mesh);
    plateMeshes.push(cap1Mesh);

    // dark glass cap2
    const cap2Geometry = buildExtrudedPlanPrism({
      outline,
      arms,
      expansion: CAP_SPEC.dark.expansion,
      height: levels.cap2.top - levels.cap2.bottom,
      bottom: levels.cap2.bottom,
      bevel: CAP_SPEC.dark.bevel,
      bevelSegments: CAP_SPEC.dark.bevelSegments,
    });
    cap2Geometry.name = 'connection-' + plateKey + '-cap2-dark';
    cap2Geometry.userData = {
      role: 'cap-dark',
      plate: plateKey,
      levels: [levels.cap2.bottom, levels.cap2.top],
      expansion: CAP_SPEC.dark.expansion,
    };
    ownedGeometries.push(cap2Geometry);
    const cap2Mesh = new THREE.Mesh(cap2Geometry, acrylicDark);
    cap2Mesh.name = 'connection-' + plateKey + '-cap2-dark';
    tagMesh(cap2Mesh, 'cap-dark', { plate: plateKey });
    platesGroup.add(cap2Mesh);
    plateMeshes.push(cap2Mesh);
  };
  buildPlate('lower');
  buildPlate('upper');

  /**
   * Thin additive line following one edge of a plate's cap2 top perimeter.
   * `edgeIndex` refers to the plate outline edge (same order as PLATE_OUTLINES).
   */
  const addPlanEdgeStrip = (group, plateKey, expansion, insetPx, widthPx, heightPx, y, edgeIndex, material, role) => {
    const outline = PLATE_OUTLINES[plateKey];
    const arms = PLATE_PLANS[plateKey];
    const normals = outlineEdgeNormals(outline, arms);
    const expanded = expandLOutline(outline, expansion, arms);
    const count = expanded.length;
    const a = expanded[edgeIndex];
    const b = expanded[(edgeIndex + 1) % count];
    const normal = normals[edgeIndex];
    const ax = a.x - normal.x * insetPx;
    const az = a.z - normal.z * insetPx;
    const bx = b.x - normal.x * insetPx;
    const bz = b.z - normal.z * insetPx;
    const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
    const length = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
    if (length < 1) return;
    const geometry = new THREE.BoxGeometry(
      alongX ? length + widthPx : widthPx,
      heightPx,
      alongX ? widthPx : length + widthPx,
    );
    geometry.name = 'connection-accent-' + role + '-' + plateKey + '-' + edgeIndex;
    geometry.userData = { role: 'accent', kind: role, plate: plateKey, edge: edgeIndex };
    ownedGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = geometry.name;
    mesh.position.set((ax + bx) / 2, y, (az + bz) / 2);
    mesh.renderOrder = 3;
    tagMesh(mesh, 'accent', { kind: role, plate: plateKey, edge: edgeIndex });
    group.add(mesh);
    plateMeshes.push(mesh);
  };

  // REVISION 2 edge accents:
  //  - cap2 top perimeter: thin additive cyan-white line (outer edges);
  //  - cap2 top notch-side edges: blue #5b8cff interlock accent;
  //  - body/cap1 boundary on the exposed front/left faces: orange #ff7a2a inlay.
  const RIM = ACCENT_SPEC.rim;
  const BLUE_RIM = ACCENT_SPEC.blueRim;
  const plateAccentPlan = [
    // lower plate: edges 4 (x=144) and 5 (z=144) face the interlock/notch.
    { plateKey: 'lower', top: PLATE_LEVELS.lower.top, notchEdges: [4, 5] },
    // upper plate: edges 2 (z=-144) and 3 (x=-144) face the interlock/notch.
    { plateKey: 'upper', top: PLATE_LEVELS.upper.top, notchEdges: [2, 3] },
  ];
  for (const entry of plateAccentPlan) {
    const outline = PLATE_OUTLINES[entry.plateKey];
    for (let edgeIndex = 0; edgeIndex < outline.length; edgeIndex += 1) {
      const isNotch = entry.notchEdges.includes(edgeIndex);
      addPlanEdgeStrip(
        platesGroup,
        entry.plateKey,
        CAP_SPEC.dark.expansion,
        isNotch ? BLUE_RIM.inset : RIM.inset,
        isNotch ? BLUE_RIM.width : RIM.width,
        isNotch ? BLUE_RIM.height : RIM.height,
        entry.top + (isNotch ? BLUE_RIM.lift : RIM.lift),
        edgeIndex,
        isNotch ? accentBlue : edgeLineMaterial,
        isNotch ? 'blue-rim' : 'edge-rim',
      );
    }
  }

  // Orange inlays at the body/cap1 boundary on the exposed front/left faces
  // (proud of the clear-glass face by ~0.3 px so they stay visible).
  const addFaceInlay = (center, size, plateKey, face) => {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    geometry.name = 'connection-accent-orange-' + plateKey + '-' + face;
    geometry.userData = { role: 'accent', kind: 'orange-inlay', plate: plateKey, face };
    ownedGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, accentOrange);
    mesh.name = geometry.name;
    mesh.position.set(center[0], center[1], center[2]);
    mesh.renderOrder = 3;
    tagMesh(mesh, 'accent', { kind: 'orange-inlay', plate: plateKey, face });
    platesGroup.add(mesh);
    plateMeshes.push(mesh);
  };
  const O = ACCENT_SPEC.orangeInlay;
  const lowerCap1Y = PLATE_LEVELS.lower.cap1.bottom + 3.5;
  const upperCap1Y = PLATE_LEVELS.upper.cap1.bottom + 3.5;
  // lower plate: front face (z = +528) and left end (x = -528)
  addFaceInlay([0, lowerCap1Y, 528 + O.faceOffset], [1056, O.height, O.width], 'lower', 'front');
  addFaceInlay([-528 - O.faceOffset, lowerCap1Y, 340], [O.width, O.height, 376], 'lower', 'left');
  // upper plate: short-arm front face (z = +328) and left end (x = -528)
  addFaceInlay([-340, upperCap1Y, 328 + O.faceOffset], [376, O.height, O.width], 'upper', 'front');
  addFaceInlay([-528 - O.faceOffset, upperCap1Y, -100], [O.width, O.height, 856], 'upper', 'left');

  /* ---- satin columns (columns deliverable) ------------------------------ */
  const columnMeshes = [];
  for (const spec of SATIN_COLUMN_SPECS) {
    const geometry = createRoundedColumnGeometry({
      width: spec.width,
      height: spec.height,
      depth: spec.depth,
      radius: spec.radius,
      bevelSegments: 6,
      tilePx: effectiveSatinTilePx,
    });
    const uv = geometry.getAttribute('uv');
    if (uv) geometry.setAttribute('uv2', uv.clone());
    geometry.name = 'connection-column-' + spec.id;
    geometry.userData = {
      ...geometry.userData,
      role: 'satin-column',
      columnId: spec.id,
      width: spec.width,
      depth: spec.depth,
      height: spec.height,
      radius: spec.radius,
      tilePx: effectiveSatinTilePx,
    };
    ownedGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, satinSourceMaterial);
    mesh.name = 'connection-column-' + spec.id;
    mesh.position.set(spec.position[0], spec.height / 2, spec.position[2]);
    tagMesh(mesh, 'satin-column', { columnId: spec.id });
    columnsGroup.add(mesh);
    columnMeshes.push(mesh);
  }

  /* ---- interlock pads --------------------------------------------------- */
  const padMeshes = [];
  PAD_SPEC.positions.forEach((position, index) => {
    const geometry = createRoundedColumnGeometry({
      width: PAD_SPEC.width,
      height: PAD_SPEC.height,
      depth: PAD_SPEC.depth,
      radius: PAD_SPEC.radius,
      bevelSegments: 4,
      tilePx: 64,
    });
    geometry.name = 'connection-pad-' + (index + 1);
    geometry.userData = { ...geometry.userData, role: 'interlock-pad', index };
    ownedGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, chromeMaterial);
    mesh.name = 'connection-pad-' + (index + 1);
    mesh.position.set(position[0], (PAD_SPEC.bottom + PAD_SPEC.top) / 2, position[1]);
    tagMesh(mesh, 'interlock-pad', { index });
    padsGroup.add(mesh);
    padMeshes.push(mesh);
  });

  /* ---- rod bundles + bolts --------------------------------------------- */
  const rodMeshes = [];
  const boltMeshes = [];
  const buildBundle = (bundleSign) => {
    const flowLevel = bundleSign > 0 ? PLATE_LEVELS.upper.flowLevel : PLATE_LEVELS.lower.flowLevel;
    const flowZ = bundleSign > 0 ? -210 : 470;
    const nearX = BUNDLE_SPEC.nearX * bundleSign;
    const farX = BUNDLE_SPEC.farX * bundleSign;
    const bundleGroup = new THREE.Group();
    bundleGroup.name = 'connection-bundle-' + (bundleSign > 0 ? 'upper' : 'lower');
    bundlesGroup.add(bundleGroup);

    BUNDLE_SPEC.offsets.forEach((offset, index) => {
      const dy0 = offset[0];
      const dz0 = offset[1];
      const dy1 = dy0 * (1 + BUNDLE_SPEC.fan);
      const dz1 = dz0 * (1 + BUNDLE_SPEC.fan);
      const p0 = V3(nearX, flowLevel + dy0, flowZ + dz0);
      const p1 = V3(farX, flowLevel + dy1, flowZ + dz1);
      const direction = p1.clone().sub(p0);
      const length = direction.length();
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(
        V3(0, 1, 0),
        direction.clone().normalize(),
      );

      const rodGeometry = new THREE.CylinderGeometry(
        BUNDLE_SPEC.rodRadius,
        BUNDLE_SPEC.rodRadius,
        length,
        10,
        1,
      );
      rodGeometry.name = 'connection-rod-' + (bundleSign > 0 ? 'upper' : 'lower') + '-' + (index + 1);
      rodGeometry.userData = { role: 'rod', bundle: bundleSign > 0 ? 'upper' : 'lower', index };
      ownedGeometries.push(rodGeometry);
      const rod = new THREE.Mesh(rodGeometry, rodMaterial);
      rod.name = rodGeometry.name;
      rod.position.copy(mid);
      rod.quaternion.copy(quaternion);
      tagMesh(rod, 'rod', { bundle: bundleSign > 0 ? 'upper' : 'lower', index });
      bundleGroup.add(rod);
      rodMeshes.push(rod);

      const coreGeometry = new THREE.CylinderGeometry(
        BUNDLE_SPEC.coreRadius,
        BUNDLE_SPEC.coreRadius,
        length,
        6,
        1,
      );
      coreGeometry.name = rod.name + '-core';
      coreGeometry.userData = { role: 'rod-core', bundle: bundleSign > 0 ? 'upper' : 'lower', index };
      ownedGeometries.push(coreGeometry);
      const core = new THREE.Mesh(coreGeometry, rodCoreMaterial);
      core.name = coreGeometry.name;
      core.position.copy(mid);
      core.quaternion.copy(quaternion);
      core.renderOrder = 6;
      tagMesh(core, 'rod-core', { bundle: bundleSign > 0 ? 'upper' : 'lower', index });
      bundleGroup.add(core);
      rodMeshes.push(core);
    });
  };
  buildBundle(1);
  buildBundle(-1);

  const boltPositiveX = (position) => position[0] > 0;
  BUNDLE_SPEC.boltPositions.forEach((position, index) => {
    const geometry = new THREE.SphereGeometry(
      BUNDLE_SPEC.boltRadius,
      14,
      8,
      0,
      TAU,
      0,
      HALF_PI,
    );
    geometry.rotateZ(boltPositiveX(position) ? -HALF_PI : HALF_PI);
    geometry.name = 'connection-bolt-' + (index + 1);
    geometry.userData = { role: 'bolt', index };
    ownedGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, chromeMaterial);
    mesh.name = geometry.name;
    mesh.position.set(position[0], position[1], position[2]);
    tagMesh(mesh, 'bolt', { index });
    bundlesGroup.add(mesh);
    boltMeshes.push(mesh);
  });

  /* ---- flow ------------------------------------------------------------- */
  // QA solids first: the fillet clamp needs them before the path is final.
  const clearanceSolids = buildClearanceSolids();
  const solved = solveCornerRadii(FLOW_POINTS, clearanceSolids);
  const path = createRoundedPath(FLOW_POINTS, solved.radii);
  const clearanceReport = computeClearance(path, clearanceSolids);

  const flowSamples = path.sample(FLOW_SPEC.sampleStep * 1.5);
  const tubeGeometry = buildTubeGeometry(flowSamples, path.length, 1.0, 12);
  tubeGeometry.name = 'connection-flow-tube';
  tubeGeometry.userData = { role: 'flow-tube', radius: FLOW_SPEC.radius };
  ownedGeometries.push(tubeGeometry);
  const tube = new THREE.Mesh(tubeGeometry, flowMaterial);
  tube.name = tubeGeometry.name;
  tagMesh(tube, 'flow-tube');
  flowGroup.add(tube);

  const glowGeometry = buildTubeGeometry(flowSamples, path.length, FLOW_SPEC.glowRadius / FLOW_SPEC.radius, 10);
  glowGeometry.name = 'connection-flow-glow';
  glowGeometry.userData = { role: 'flow-glow', radius: FLOW_SPEC.glowRadius };
  ownedGeometries.push(glowGeometry);
  const glowTube = new THREE.Mesh(glowGeometry, glowMaterial);
  glowTube.name = glowGeometry.name;
  glowTube.renderOrder = 4;
  tagMesh(glowTube, 'flow-glow');
  flowGroup.add(glowTube);

  // Fast deterministic position/tangent table used by the animated particles.
  const FLOW_TABLE_SIZE = 1024;
  const flowTable = {
    size: FLOW_TABLE_SIZE,
    points: [],
    tangents: [],
  };
  for (let i = 0; i <= FLOW_TABLE_SIZE; i += 1) {
    const s = (path.length * i) / FLOW_TABLE_SIZE;
    flowTable.points.push(path.pointAt(s));
    flowTable.tangents.push(path.tangentAt(s));
  }
  const sampleFlow = (u01, outPoint, outTangent) => {
    const wrapped = ((u01 % 1) + 1) % 1;
    const f = wrapped * FLOW_TABLE_SIZE;
    const i0 = Math.floor(f) % FLOW_TABLE_SIZE;
    const i1 = (i0 + 1) % FLOW_TABLE_SIZE;
    const frac = f - Math.floor(f);
    outPoint.lerpVectors(flowTable.points[i0], flowTable.points[i1], frac);
    outTangent.lerpVectors(flowTable.tangents[i0], flowTable.tangents[i1], frac).normalize();
    return outPoint;
  };
  const crossingFactor = (u01) => {
    const wrapped = ((u01 % 1) + 1) % 1;
    return smoothstep01(Math.min(wrapped, 1 - wrapped) / 0.035);
  };

  // 72 seeded metallic octahedra crystals travelling along the conduit.
  const particleGeometry = new THREE.OctahedronGeometry(3.0, 0);
  particleGeometry.name = 'connection-flow-particle';
  ownedGeometries.push(particleGeometry);
  const particles = new THREE.InstancedMesh(particleGeometry, flowMaterial, FLOW_SPEC.particleCount);
  particles.name = 'connection-flow-particles';
  particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particles.frustumCulled = false;
  particles.userData = { role: 'flow-particles', count: FLOW_SPEC.particleCount };
  flowGroup.add(particles);

  // A few bright additive pulses.
  const pulseSpecs = [
    { offset: 0.02, size: 6.5, stretch: 2.1, material: pulseMaterials[0] },
    { offset: 0.35, size: 5.2, stretch: 1.7, material: pulseMaterials[1] },
    { offset: 0.68, size: 5.8, stretch: 1.9, material: pulseMaterials[2] },
  ];
  const pulses = [];
  for (let i = 0; i < pulseSpecs.length; i += 1) {
    const spec = pulseSpecs[i];
    const geometry = new THREE.SphereGeometry(spec.size, 12, 8);
    geometry.name = 'connection-flow-pulse-' + (i + 1);
    geometry.userData = { role: 'flow-pulse', index: i };
    ownedGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, spec.material);
    mesh.name = geometry.name;
    mesh.renderOrder = 5;
    mesh.userData = { role: 'flow-pulse', index: i, offset: spec.offset, stretch: spec.stretch };
    flowGroup.add(mesh);
    pulses.push(mesh);
  }

  // Faint routed "flow trace" on each dark-glass top face (REVISION 2): the
  // exact conduit route projected to the cap2 top plane, cut to the glass plan,
  // so the route reads from above as an inlaid light filament.
  const trace = createFlowTrace(path, traceMaterial, ownedGeometries);
  flowGroup.add(trace.upper);
  flowGroup.add(trace.lower);

  // Seeded per-particle constants (crystal size, spin, radial scatter).
  const particleSeeds = [];
  for (let i = 0; i < FLOW_SPEC.particleCount; i += 1) {
    particleSeeds.push({
      offset: hash01(i, 11),
      spin: hashRange(i, 12, 0, TAU),
      spinSpeed: hashRange(i, 13, -2.4, 2.4),
      scale: hashRange(i, 14, 0.55, 1.3),
      stretch: hashRange(i, 15, 1.1, 1.9),
      radial: hashRange(i, 16, 0, 4.6),
      radialAngle: hashRange(i, 17, 0, TAU),
    });
  }

  /* ---- state / animation ------------------------------------------------ */
  const state = {
    phase: FLOW_SPEC.stillPhase,
    disposed: false,
  };
  const dummy = new THREE.Object3D();
  const tmpPoint = new THREE.Vector3();
  const tmpTangent = new THREE.Vector3();
  const tmpNormal = new THREE.Vector3();
  const tmpBinormal = new THREE.Vector3();
  const WORLD_UP = V3(0, 1, 0);

  const applyPhase = (phase) => {
    state.phase = phase;
    const phaseOffset = phase;

    // crystals
    for (let i = 0; i < FLOW_SPEC.particleCount; i += 1) {
      const seed = particleSeeds[i];
      const u = seed.offset + phaseOffset;
      sampleFlow(u, tmpPoint, tmpTangent);
      // deterministic frame around the tangent for the radial scatter
      if (Math.abs(tmpTangent.y) > 0.98) tmpNormal.set(1, 0, 0);
      else tmpNormal.copy(WORLD_UP);
      tmpBinormal.crossVectors(tmpTangent, tmpNormal).normalize();
      tmpNormal.crossVectors(tmpBinormal, tmpTangent).normalize();
      const radial = seed.radial;
      const angle = seed.radialAngle;
      tmpPoint.x += tmpNormal.x * Math.cos(angle) * radial + tmpBinormal.x * Math.sin(angle) * radial;
      tmpPoint.y += tmpNormal.y * Math.cos(angle) * radial + tmpBinormal.y * Math.sin(angle) * radial;
      tmpPoint.z += tmpNormal.z * Math.cos(angle) * radial + tmpBinormal.z * Math.sin(angle) * radial;
      dummy.position.copy(tmpPoint);
      dummy.quaternion.setFromUnitVectors(WORLD_UP, tmpTangent);
      dummy.rotateY(seed.spin + phaseOffset * TAU * seed.spinSpeed);
      const fade = crossingFactor(u);
      const scale = seed.scale * fade;
      dummy.scale.set(scale, scale * seed.stretch, scale);
      dummy.updateMatrix();
      particles.setMatrixAt(i, dummy.matrix);
    }
    particles.instanceMatrix.needsUpdate = true;

    // pulses
    for (let i = 0; i < pulses.length; i += 1) {
      const pulse = pulses[i];
      const spec = pulse.userData;
      const u = spec.offset + phaseOffset;
      sampleFlow(u, tmpPoint, tmpTangent);
      pulse.position.copy(tmpPoint);
      pulse.quaternion.setFromUnitVectors(WORLD_UP, tmpTangent);
      const fade = crossingFactor(u);
      const pulseScale = fade * (0.85 + 0.15 * Math.sin((phaseOffset * TAU * 2) + i * 1.7));
      pulse.scale.set(pulseScale, pulseScale * spec.stretch, pulseScale);
      pulse.visible = fade > 0.01;
    }

    // glow breathing (deterministic in the phase)
    glowMaterial.opacity = 0.145 + 0.03 * (0.5 + 0.5 * Math.sin(phaseOffset * TAU * 2));
  };

  /**
   * Animate to `elapsedSeconds`: phase = (elapsed / 7 s) % 1. Deterministic.
   * @param {number} elapsedSeconds
   */
  const update = (elapsedSeconds) => {
    if (state.disposed) return state.phase;
    const seconds = Number(elapsedSeconds);
    const elapsed = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    applyPhase((elapsed / FLOW_SPEC.period) % 1);
    return state.phase;
  };

  /**
   * Freeze the flow at a phase in [0, 1). Negative / >1 values wrap; NaN -> 0.
   * @param {number} phase01
   * @returns {number} the applied phase
   */
  const setPhase = (phase01) => {
    const value = Number(phase01);
    const phase = Number.isFinite(value) ? ((value % 1) + 1) % 1 : 0;
    if (!state.disposed) applyPhase(phase);
    return phase;
  };

  const getPhase = () => state.phase;

  /* ---- bounds ----------------------------------------------------------- */
  // Pose the flow at the deterministic still phase BEFORE measuring, so the
  // pulse / particle meshes sit on the conduit instead of at the origin.
  applyPhase(FLOW_SPEC.stillPhase);
  group.updateMatrixWorld(true);

  // fitBounds = the CORE object the preview camera fits (published REVISION 2
  // box: plates + columns only, x ±560, y 0..1150, z ±560). The measured core
  // box is kept in debug() as `coreBounds` for transparency.
  const coreBox = new THREE.Box3().setFromObject(platesGroup);
  coreBox.expandByObject(columnsGroup);
  const coreBounds = {
    min: { x: round(coreBox.min.x, 2), y: round(coreBox.min.y, 2), z: round(coreBox.min.z, 2) },
    max: { x: round(coreBox.max.x, 2), y: round(coreBox.max.y, 2), z: round(coreBox.max.z, 2) },
  };
  const fitBounds = {
    min: { x: FIT_BOUNDS_MIN.x, y: FIT_BOUNDS_MIN.y, z: FIT_BOUNDS_MIN.z },
    max: { x: FIT_BOUNDS_MAX.x, y: FIT_BOUNDS_MAX.y, z: FIT_BOUNDS_MAX.z },
  };

  const boundsBox = new THREE.Box3().setFromObject(group);
  const bounds = {
    min: { x: round(boundsBox.min.x, 2), y: round(boundsBox.min.y, 2), z: round(boundsBox.min.z, 2) },
    max: { x: round(boundsBox.max.x, 2), y: round(boundsBox.max.y, 2), z: round(boundsBox.max.z, 2) },
  };

  /* ---- published materials / counts / satin ----------------------------- */
  const materials = {
    satin: satinSourceMaterial,
    metal: metalMaterial,
    ribNormal: ribTextures.normal,
    ribRoughness: ribTextures.roughness,
    ribAlbedo: ribTextures.albedo,
    acrylicClear,
    acrylicDark,
    flow: flowMaterial,
    glow: glowMaterial,
    accentOrange,
    accentBlue,
    rod: rodMaterial,
    chrome: chromeMaterial,
  };

  const counts = Object.freeze({
    plates: 2,
    columns: columnMeshes.length,
    pads: padMeshes.length,
    rodBundles: 2,
    rods: rodMeshes.filter((mesh) => mesh.userData.role === 'rod').length,
    particles: FLOW_SPEC.particleCount,
  });

  const satin = {
    source: satinSource,
    material: satinSourceMaterial,
    tilePx: tilePxManifest,
    effectiveTilePx: effectiveSatinTilePx,
    uvDensityScale: UV_DENSITY_SCALE,
    clonedFrom: (satinSourceMaterial.userData && satinSourceMaterial.userData.clonedFrom) || null,
    mapCounts: materialSnapshot(satinSourceMaterial).maps,
    meshes: columnMeshes,
  };

  const flow = {
    points: FLOW_POINTS,
    curveLength: round(path.length, 3),
    radius: FLOW_SPEC.radius,
    tube,
    glow: glowTube,
    particles,
    pulses,
    trace: { upper: trace.upper, lower: trace.lower, meta: trace.meta },
    clearance: clearanceReport,
  };

  /* ---- lifetime --------------------------------------------------------- */
  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    group.traverse((object) => {
      if (object.isMesh || object.isInstancedMesh) {
        if (object.geometry) object.geometry.dispose();
      }
    });
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const texture of ownedTextures) texture.dispose();
    for (const material of ownedMaterials) material.dispose();
    if (group.parent) group.parent.remove(group);
    group.clear();
  };

  const debug = () => ({
    version: MODEL_VERSION,
    revision: 2,
    counts: { ...counts },
    satin: {
      source: satin.source,
      tilePx: satin.tilePx,
      effectiveTilePx: satin.effectiveTilePx,
      uvDensityScale: satin.uvDensityScale,
      clonedFrom: satin.clonedFrom,
      maps: satin.mapCounts,
    },
    plates: MODEL_SPEC.plates.map((plate) => ({
      id: plate.id,
      levels: plate.levels,
      flowLevel: plate.flowLevel,
      top: plate.top,
    })),
    seam: { thickness: MODEL_SPEC.seam.thickness, flowLevels: { ...MODEL_SPEC.flowLevels } },
    interlock: { ...MODEL_SPEC.interlock },
    flow: {
      radius: FLOW_SPEC.radius,
      glowRadius: FLOW_SPEC.glowRadius,
      length: flow.curveLength,
      phase: round(state.phase, 4),
      period: FLOW_SPEC.period,
      cornerRadius: FLOW_SPEC.cornerRadius,
      cornerRadii: path.radii.map((radius) => round(radius, 2)),
      cornerRadiiNominal: solved.nominal.map((radius) => round(radius, 2)),
      trace: {
        radius: trace.meta.radius,
        opacity: trace.meta.opacity,
        upperRuns: trace.upper.children.length,
        lowerRuns: trace.lower.children.length,
      },
      clearance: {
        min: clearanceReport.min,
        violations: clearanceReport.violations.slice(),
        samples: clearanceReport.samples,
        solids: clearanceReport.solids.map((solid) => ({ ...solid })),
      },
    },
    materialsSummary: Object.fromEntries(
      Object.entries(materials).map(([key, value]) => [
        key,
        value && value.isTexture
          ? { texture: value.name, role: value.userData && value.userData.role }
          : materialSnapshot(value),
      ]),
    ),
    fitBounds,
    coreBounds,
    bounds,
  });

  /* ---- deterministic initial pose --------------------------------------- */
  applyPhase(FLOW_SPEC.stillPhase);

  return {
    version: MODEL_VERSION,
    group,
    bounds,
    fitBounds,
    materials,
    counts,
    satin,
    flow,
    update,
    setPhase,
    getPhase,
    debug,
    dispose,
  };
}

/* ========================================================================= */
/* Tapering generalized cylinder (tube)                                       */
/* ========================================================================= */

/**
 * Build a tapering generalized-cylinder tube along the rounded flow path with
 * deterministic parallel-transport frames (no twisting, no random values).
 *
 * @param {Array<{s:number, point:THREE.Vector3, tangent:THREE.Vector3}>} samples
 * @param {number} pathLength
 * @param {number} radiusScale multiplier on the published flow radius
 * @param {number} radialSegments cross-section segments
 * @returns {THREE.BufferGeometry}
 */
function buildTubeGeometry(samples, pathLength, radiusScale, radialSegments) {
  const sides = Math.max(6, Math.floor(radialSegments));
  const rows = samples.length;
  const positions = new Float32Array(rows * sides * 3);
  const normals = new Float32Array(rows * sides * 3);
  const uvs = new Float32Array(rows * sides * 2);
  const indices = [];

  // Parallel transport: start from any normal perpendicular to the first tangent
  // and rotate it by the minimal rotation between consecutive tangents.
  const tangent = new THREE.Vector3();
  const previousTangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const rotated = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  previousTangent.copy(samples[0].tangent);
  const up = Math.abs(previousTangent.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0);
  normal.crossVectors(previousTangent, up).normalize();
  if (normal.lengthSq() < 1e-8) normal.set(1, 0, 0);

  for (let row = 0; row < rows; row += 1) {
    const sample = samples[row];
    tangent.copy(sample.tangent);
    if (row > 0) {
      quaternion.setFromUnitVectors(previousTangent, tangent);
      rotated.copy(normal).applyQuaternion(quaternion);
      rotated.sub(tangent.clone().multiplyScalar(rotated.dot(tangent)));
      if (rotated.lengthSq() > 1e-10) normal.copy(rotated).normalize();
    }
    binormal.crossVectors(tangent, normal).normalize();
    normal.crossVectors(binormal, tangent).normalize();
    previousTangent.copy(tangent);

    const radius = Math.max(flowRadiusAt(sample.s, pathLength) * radiusScale, 0.02);
    for (let side = 0; side < sides; side += 1) {
      const angle = (TAU * side) / sides;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = normal.x * cos + binormal.x * sin;
      const ny = normal.y * cos + binormal.y * sin;
      const nz = normal.z * cos + binormal.z * sin;
      const index = row * sides + side;
      positions[index * 3] = sample.point.x + nx * radius;
      positions[index * 3 + 1] = sample.point.y + ny * radius;
      positions[index * 3 + 2] = sample.point.z + nz * radius;
      normals[index * 3] = nx;
      normals[index * 3 + 1] = ny;
      normals[index * 3 + 2] = nz;
      uvs[index * 2] = side / sides;
      uvs[index * 2 + 1] = sample.s / 40;
    }
  }
  for (let row = 0; row < rows - 1; row += 1) {
    for (let side = 0; side < sides; side += 1) {
      const nextSide = (side + 1) % sides;
      const a = row * sides + side;
      const b = row * sides + nextSide;
      const c = (row + 1) * sides + nextSide;
      const d = (row + 1) * sides + side;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
