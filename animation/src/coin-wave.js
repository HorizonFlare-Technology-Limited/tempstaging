/**
 * coin-wave.js — pure deterministic composition math for the Rev21 coin Wave.
 *
 * SPEC "Collection Revision 21" R21-2/R21-3: two true sine ribbon waves running
 * left-right on the shared room-lit stage. Each ribbon is a narrow metal strap
 * whose cross-section along the run (the wave) is an exact sine:
 *
 *     steel(x) = baseY + A * sin(2*pi*(x / lambda + PHASE_STEEL))
 *     gold(x)  = baseY + A * sin(2*pi*(x / lambda + PHASE_GOLD))
 *
 * with lambda = 2*pi*A EXACTLY (amplitude A is kept at 0.135, i.e. the wave is
 * as tall as before but its wavelength shrinks to ~0.848 world so it reads as a
 * small, tight wave).  rev26 s51: the curves are swapped between the ribbons -
 * steel carries A*sin(0.5x/A + 19/4) (PHASE_GOLD cycles, sin) and the slate
 * ribbon carries A*cos(0.5x/A) (PHASE_STEEL = 1/4 cycle, cos); phase constants
 * keep their names but now belong to the other ribbon.
 *
 * WAVE_SCALE is a single multiplier applied to the amplitude, the wavelength
 * and every ribbon dimension together, so lambda / A = 2*pi always holds. It is
 * exposed in the wave params panel / copy-JSON output so the wave can be
 * retuned without touching the composition code (default 1.0, range 0.5-3.0).
 *
 * The gold ribbon is retinted to the Rev21 slate blue-violet reference: base
 * #4c5482, gradient bottom-left #2a3054 -> centre #4c5482 -> top-right #7e84b2
 * (the procedural albedo map lives in coin-wave-scene.js; this module only
 * carries the palette + the polished-metal response).
 *
 * Three different-currency coins stand on the steel wave in a row, bottom rims
 * exactly on the surface; the row spacing is half a wavelength (the old ~0.42
 * world spacing) so the coins alternate crest/trough/crest, and it projects
 * to >= 100 CSS px at the default camera for 1440x900 and 1200x900 stages.
 *
 * This module is dependency-free (no three.js, DOM, clock or randomness) so the
 * offline verifier and any renderer share exactly the same numbers.
 * Scene-space == world-space; the coin model's local +Y is its face normal and
 * local -Z is the symbol's up direction.
 *
 * Coordinate conventions
 *  - X runs left-right along each ribbon (the wave runs along X).
 *  - Y is up, Z is depth (toward the camera).
 *  - A ribbon occupies z in [zStart, zEnd] (a flat strap across its width).
 *  - The slate crest is at x = 0 (cos); the steel trough is at ~-0.006*lambda and
 *    its crests at ~+0.494*lambda (sin + 19/4), (the coins use authored poses, see WAVE_COIN_POSES).
 */

export const COIN_GEOMETRY = Object.freeze({
  radius: 1,
  thickness: 0.16,
  halfThickness: 0.08,
});

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const clamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);
const round6 = (value) => Math.round(value * 1e6) / 1e6;
const round6Vec = (v) => [round6(v[0]), round6(v[1]), round6(v[2])];

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/* ------------------------------------------------------------------------- */
/* WAVE_SCALE + scaled ribbon geometry                                       */
/* ------------------------------------------------------------------------- */

/** Rev21 retune knob: one multiplier for the whole wave (documented range). */
export const WAVE_SCALE = 1.5;
export const WAVE_SCALE_MIN = 0.5;
export const WAVE_SCALE_MAX = 3;

/** Peak amplitude of the true sine wave (R21 keeps the Rev20 height). */
const BASE_AMPLITUDE = 0.135;
/** Periods kept from the Rev20 ribbon: 26 / 7.4 = 3.5135... */
const PERIODS = 26 / 7.4 / 2;
/** Rev20 wavelength, used only to derive the proportional geometry scale k. */
const LEGACY_WAVELENGTH = 7.4;
/** Rev20 authored ribbon proportions (scaled by k = lambda / 7.4). */
const LEGACY = Object.freeze({
  width: 2.2,
  steelThickness: 0.066,
  goldThickness: 0.06,
  steelZStart: 0.6,
  steelZEnd: 2.8,
  goldZStart: -1.6,
  goldZEnd: 0.6,
  goldBaseY: 0.44,
});

/**
 * Derive every wave dimension for a given WAVE_SCALE.
 *
 * lambda is defined as 2*pi*amplitude, so lambda / amplitude === 2*pi for EVERY
 * scale; the ribbon length keeps the Rev20 period count and every cross-section
 * dimension is scaled by k = lambda / 7.4 (the same factor the Rev20 ribbon had
 * relative to the new wavelength), so the whole ribbon shrinks/grows
 * proportionally and still "reads as the same wave, just smaller".
 *
 * @param {number} [scale] WAVE_SCALE multiplier, clamped to [0.5, 3]
 * @returns {{scale: number, amplitude: number, wavelength: number,
 *   wavelengthOverAmplitude: number, periods: number, length: number,
 *   width: number, steelThickness: number, goldThickness: number,
 *   steelZStart: number, steelZEnd: number, goldZStart: number, goldZEnd: number,
 *   goldBaseY: number, geometryScale: number}}
 */
export function waveGeometryAtScale(scale = WAVE_SCALE) {
  const s = Number.isFinite(scale) ? clamp(Number(scale), WAVE_SCALE_MIN, WAVE_SCALE_MAX) : WAVE_SCALE;
  const amplitude = BASE_AMPLITUDE * s;
  // rev5 s26 / rev26 s51: steel y=A*sin(0.5*x/A+19/4), gold y=A*cos(0.5*x/A) => k = 0.5/A => lambda = 4*pi*A
  const wavelength = 2 * TAU * amplitude;
  const geometryScale = (TAU * amplitude) / LEGACY_WAVELENGTH;
  return deepFreeze({
    scale: s,
    amplitude,
    wavelength,
    wavelengthOverAmplitude: wavelength / amplitude,
    periods: PERIODS,
    length: PERIODS * wavelength,
    width: LEGACY.width * geometryScale,
    steelThickness: LEGACY.steelThickness * geometryScale,
    goldThickness: LEGACY.goldThickness * geometryScale,
    steelZStart: LEGACY.steelZStart * geometryScale,
    steelZEnd: LEGACY.steelZEnd * geometryScale,
    goldZStart: LEGACY.goldZStart * geometryScale,
    goldZEnd: LEGACY.goldZEnd * geometryScale,
    goldBaseY: LEGACY.goldBaseY * geometryScale,
    geometryScale,
  });
}

const GEOM = waveGeometryAtScale(WAVE_SCALE);
const AMPLITUDE = GEOM.amplitude;
const WAVELENGTH = GEOM.wavelength;
const RIBBON_LENGTH = GEOM.length;
const RIBBON_WIDTH = GEOM.width;
const STEEL_Z_START = GEOM.steelZStart;
const STEEL_Z_END = GEOM.steelZEnd;
const GOLD_Z_START = GEOM.goldZStart;
const GOLD_Z_END = GEOM.goldZEnd;
const GOLD_BASE_Y = GEOM.goldBaseY;

// rev26 s51 (curves swapped): steel y = A*sin(0.5*x/A + 19/4) = sin(2pi*(x/lambda + (19/4)/2pi));
// gold y = baseY + A*cos(0.5*x/A) = sin(2pi*(x/lambda + 1/4)) (crest at x = 0).
const GOLD_PHASE_RAD = 19 / 4;
const PHASE_STEEL = 0.25;
const PHASE_GOLD = GOLD_PHASE_RAD / TAU;
const PHASE_OFFSET_CYCLES = (((PHASE_GOLD - PHASE_STEEL) % 1) + 1) % 1;

const COIN_SCALE = 0.18; // ~86 CSS px diameter at the Rev20 readout
const COIN_IDS = Object.freeze(['gbp', 'eur', 'usd']);
/** Rev21 slate blue-violet palette (from refs/rev21/wave-gold-color.png). */
const SLATE_PALETTE = Object.freeze({
  base: 0x4c5482,
  bottomLeft: 0x2a3054,
  topRight: 0x7e84b2,
  averageHex: '#4d5481',
  dotGrid: true,
});

/* ------------------------------------------------------------------------- */
/* Wave cross-section profile (exact sine along the run)                     */
/* ------------------------------------------------------------------------- */

/** Exact sine profile in [-1, 1]; u is in cycles (0..1 = one wavelength). */
function profile(u) {
  return Math.sin(TAU * u);
}

/** first derivative of sin(2*pi*u) with respect to u (cycles): 2*pi*cos(2*pi*u) */
function profileDerivative(u) {
  return TAU * Math.cos(TAU * u);
}

/** second derivative of sin(2*pi*u) with respect to u: -4*pi^2*sin(2*pi*u) */
function profileSecondDerivative(u) {
  return -TAU * TAU * Math.sin(TAU * u);
}

/* ------------------------------------------------------------------------- */
/* Wave definitions                                                          */
/* ------------------------------------------------------------------------- */

// steel crest: 0.5*x/A + 19/4 = pi/2 (mod 2pi), nearest to x = 0
const STEEL_CREST_X = (() => {
  const k = 0.5 / AMPLITUDE;
  let x = (Math.PI / 2 - GOLD_PHASE_RAD) / k;
  const period = WAVELENGTH;
  x -= Math.round(x / period) * period;
  return x;
})();

const STEEL_TROUGH_X = STEEL_CREST_X - WAVELENGTH / 2;

const WAVES = deepFreeze({
  steel: {
    kind: 'steel',
    label: 'Polished stainless steel',
    finish: 'polished',
    material: { color: 0xd8dde3, roughness: 0.2, metalness: 1 },
    length: RIBBON_LENGTH,
    width: RIBBON_WIDTH,
    zStart: STEEL_Z_START,
    zEnd: STEEL_Z_END,
    thickness: GEOM.steelThickness,
    baseY: 0,
    wavelength: WAVELENGTH,
    amplitude: AMPLITUDE,
    phase: PHASE_GOLD,
    phaseKind: 'sin',
    crestX: STEEL_CREST_X,
    troughX: STEEL_TROUGH_X,
  },
  gold: {
    kind: 'gold',
    label: 'Slate blue-violet, polished',
    finish: 'polished',
    // Rev21 ref: base slate blue-violet (albedo gradient is applied by the
    // procedural map in coin-wave-scene.js; this is the flat fallback colour).
    material: { color: SLATE_PALETTE.base, roughness: 0.22, metalness: 1 },
    palette: SLATE_PALETTE,
    length: RIBBON_LENGTH,
    width: RIBBON_WIDTH,
    zStart: GOLD_Z_START,
    zEnd: GOLD_Z_END,
    thickness: GEOM.goldThickness,
    baseY: GOLD_BASE_Y,
    wavelength: WAVELENGTH,
    amplitude: AMPLITUDE,
    phase: PHASE_STEEL,
    phaseKind: 'cos',
    crestX: 0,
    troughXs: [-WAVELENGTH / 2, WAVELENGTH / 2],
    troughX: WAVELENGTH / 2,
  },
});

function rawSurfaceY(wave, x) {
  return wave.baseY + wave.amplitude * profile(x / wave.wavelength + wave.phase);
}

function rawSlope(wave, x) {
  return (wave.amplitude / wave.wavelength) * profileDerivative(x / wave.wavelength + wave.phase);
}

function rawCurvature(wave, x) {
  return (wave.amplitude / (wave.wavelength * wave.wavelength)) * profileSecondDerivative(x / wave.wavelength + wave.phase);
}

/* ------------------------------------------------------------------------- */
/* Exact surface functions (single source of truth for scene + verifier)     */
/* ------------------------------------------------------------------------- */

/**
 * Top-surface height of a wave at (x, z). The ribbon's top is flat across its
 * width, so z only selects the ribbon (and does not change the height).
 * @param {'steel'|'gold'} kind
 * @param {number} x
 * @param {number} z
 */
export function waveSurfaceHeight(kind, x, z) {
  const wave = WAVES[kind];
  if (!wave) throw new Error('coin-wave: unknown wave "' + kind + '"');
  return rawSurfaceY(wave, x);
}

/** Surface normal (unit) of a wave at x: tilts along X only. */
export function waveSurfaceNormal(kind, x, z) {
  const wave = WAVES[kind];
  if (!wave) throw new Error('coin-wave: unknown wave "' + kind + '"');
  const slope = rawSlope(wave, x);
  const inv = 1 / Math.sqrt(1 + slope * slope);
  return Object.freeze([-slope * inv, inv, 0]);
}

/** Wave phase at x in cycles (gold crest = 0.25, gold trough = 0.75; steel is offset by 19/4/2pi). */
export function wavePhase(kind, x) {
  const wave = WAVES[kind];
  return (x / wave.wavelength + wave.phase) % 1;
}

/** local slope dy/dx and curvature d2y/dx2 (for smoothness checks). */
export function waveSlope(kind, x) {
  return rawSlope(WAVES[kind], x);
}
export function waveCurvature(kind, x) {
  return rawCurvature(WAVES[kind], x);
}

/** raw normalized profile value of a wave at x (in [-1, 1]). */
export function waveProfileAt(kind, x) {
  const wave = WAVES[kind];
  return profile(x / wave.wavelength + wave.phase);
}

/* ------------------------------------------------------------------------- */
/* Camera + projection (default hero framing)                                */
/* ------------------------------------------------------------------------- */

const CAMERA = Object.freeze({
  fovDeg: 30,
  // Rev21: a slightly higher hero elevation than the Rev20 20 deg keeps the
  // ribbon's narrow top surface visible (it now spans a small sine) and avoids
  // grazing-angle mirror wash-out on the slate albedo.
  elevationDeg: 27,
  stageWidth: 1440,
  stageHeight: 900,
  fitMargin: 1.06,
});

/**
 * Default deterministic hero camera for the Wave scene. The camera distance is
 * fixed (not aspect-dependent) so the composition's pixel scale depends only on
 * the stage HEIGHT: 1440x900 and 1200x900 share exactly the same px/world scale.
 */
export function waveCameraPose(stageWidth = CAMERA.stageWidth, stageHeight = CAMERA.stageHeight) {
  const fov = CAMERA.fovDeg * DEG;
  const elevation = CAMERA.elevationDeg * DEG;
  const tanHalf = Math.tan(fov / 2);
  const aspect = stageWidth / Math.max(1, stageHeight);
  // Aspect-stable desktop fit (fixed distance) + a row fit so the three coins
  // never clip on a short/phone stage (the ribbons may bleed off the sides).
  const rowHalf = COIN_ROW_HALF;
  const rowFitDistance = (rowHalf * CAMERA.fitMargin) / (tanHalf * Math.max(0.2, aspect));
  const distance = round6(Math.max(CAMERA_SPEC.distance, rowFitDistance));
  const target = Object.freeze([CAMERA_SPEC.target[0], CAMERA_SPEC.target[1], CAMERA_SPEC.target[2]]);
  const position = Object.freeze([
    target[0],
    target[1] + distance * Math.sin(elevation),
    target[2] + distance * Math.cos(elevation),
  ]);
  const pxPerWorld = stageHeight / (2 * distance * tanHalf);
  return Object.freeze({
    fovDeg: CAMERA.fovDeg,
    fov,
    elevationDeg: CAMERA.elevationDeg,
    elevation,
    distance,
    target,
    position,
    stage: Object.freeze({ width: stageWidth, height: stageHeight }),
    pxPerWorld,
    pxPerWorldAt900: round6(900 / (2 * distance * tanHalf)),
  });
}

/** Project a world point to CSS pixels (origin top-left) with the hero camera. */
export function waveProjectPoint(worldPoint, camera = waveCameraPose()) {
  const eye = camera.position;
  const forward = normalize([
    camera.target[0] - eye[0],
    camera.target[1] - eye[1],
    camera.target[2] - eye[2],
  ]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const rel = [worldPoint[0] - eye[0], worldPoint[1] - eye[1], worldPoint[2] - eye[2]];
  const zCam = dot(forward, rel);
  const tanHalf = Math.tan(camera.fov / 2);
  const aspect = camera.stage.width / camera.stage.height;
  const ndcX = dot(right, rel) / (zCam * tanHalf * aspect);
  const ndcY = dot(up, rel) / (zCam * tanHalf);
  return Object.freeze([
    (ndcX * 0.5 + 0.5) * camera.stage.width,
    (0.5 - ndcY * 0.5) * camera.stage.height,
  ]);
}

/* ------------------------------------------------------------------------- */
/* Coin placements in the steel trough                                       */
/* ------------------------------------------------------------------------- */

/**
 * s57: the three coin poses are AUTHORED (tuned in the page and pasted back from
 * the QA "copy JSON" readout) at WAVE_SCALE 1.5. Positions scale with
 * WAVE_SCALE / 1.5 (the same factor the wave geometry uses); quaternion
 * ([x, y, z, w]) and the coin scale (0.18) are scale independent. There is no
 * alternation / gap-0 placement logic any more: the contact gap / penetration is
 * a reported metric (waveCoinContact), not an invariant.
 */
export const WAVE_AUTHORED_SCALE = 1.5;
export const WAVE_COIN_POSES = deepFreeze([
  { id: 'gbp', position: [-0.412771, 0.077551, 0.300082], quaternion: [-0.307844, 0.626903, 0.654562, -0.289436], rotationDeg: [-87.821, -49.987, 179.37], scale: 0.18 },
  { id: 'eur', position: [0.265906, 0.035762, 0.296766], quaternion: [-0.423975, -0.548418, -0.615496, -0.37503], rotationDeg: [-83.772, 68.948, -179.462], scale: 0.18 },
  { id: 'usd', position: [0.001566, -0.025502, 0.356595], quaternion: [0.717749, 0.027354, 0.027717, 0.695212], rotationDeg: [91.829, 4.463, -0.042], scale: 0.18 },
]);
const POSE_FACTOR = WAVE_SCALE / WAVE_AUTHORED_SCALE;
const COIN_ROW_HALF = WAVE_COIN_POSES.reduce((max, pose) => Math.max(max, Math.abs(pose.position[0] * POSE_FACTOR) + pose.scale), 0);

/**
 * s59 + Rev32: the orange-red LINE light of the Wave mode. Baked into the equirect
 * by src/env-room.js (room.setLineLight) before PMREM, i.e. an emissive strip that
 * exists only inside the environment map (no THREE light). Same schema as
 * LINE_LIGHT_SPEC in stacked-coins-model.js: linear `color`, HDR `intensity`,
 * angles in radians. Set on entering the Wave mode, reset to null on leaving.
 *
 * Rev32 position: the source sits ABOVE the coins - the strip is a narrow cap at
 * the zenith of the environment (elevation 1.40..1.55 rad, i.e. ~80..89 deg), so
 * the orange-red light comes down from directly overhead and the metal wave and
 * the coin rims reflect it through their own materials.
 */
export const WAVE_LINE_LIGHT = deepFreeze({
  name: 'wave-line-light',
  kind: 'env-baked-line',
  color: [0.42, 0.045, 0.004],
  hex: '#ff4a14',
  intensity: 9,
  azimuth: 0,
  halfWidth: 0.3,
  elevMin: 1.4,
  elevMax: 1.55,
  soft: 0.12,
  tilt: 0,
});

/**
 * Contact of one coin disc against a wave surface: the disc rim (circle of
 * radius `scale` in the plane perpendicular to the coin axis, local +Y rotated by
 * the quaternion) is sampled and compared with the surface height below each
 * point. `clearance` = min over the rim of (rimY - surfaceY): > 0 floating,
 * < 0 penetrating. Reported only; nothing asserts it is 0.
 */
export function waveCoinContact(kind, position, quaternion, scale = COIN_SCALE, samples = 720) {
  const [qx, qy, qz, qw] = quaternion;
  const rot = (v) => {
    const [vx, vy, vz] = v;
    return [
      2 * (vx * (0.5 - qy * qy - qz * qz) + vy * (qx * qy - qw * qz) + vz * (qx * qz + qw * qy)),
      2 * (vx * (qx * qy + qw * qz) + vy * (0.5 - qx * qx - qz * qz) + vz * (qy * qz - qw * qx)),
      2 * (vx * (qx * qz - qw * qy) + vy * (qy * qz + qw * qx) + vz * (0.5 - qx * qx - qy * qy)),
    ];
  };
  const u = rot([1, 0, 0]);
  const v = rot([0, 0, 1]);
  let clearance = Infinity;
  let at = [position[0], position[1], position[2]];
  for (let i = 0; i < samples; i += 1) {
    const t = (i / samples) * TAU;
    const c = Math.cos(t) * scale;
    const s = Math.sin(t) * scale;
    const x = position[0] + u[0] * c + v[0] * s;
    const y = position[1] + u[1] * c + v[1] * s;
    const z = position[2] + u[2] * c + v[2] * s;
    const gap = y - waveSurfaceHeight(kind, x, z);
    if (gap < clearance) {
      clearance = gap;
      at = [x, y, z];
    }
  }
  return { clearance, rim: at };
}

function buildCoins() {
  return deepFreeze(COIN_IDS.map((id, index) => {
    const pose = WAVE_COIN_POSES.find((entry) => entry.id === id);
    const position = round6Vec(pose.position.map((value) => value * POSE_FACTOR));
    const { clearance, rim } = waveCoinContact('steel', position, pose.quaternion, pose.scale);
    return {
      id,
      index,
      surface: 'steel',
      radius: pose.scale,
      scale: pose.scale,
      position,
      quaternion: pose.quaternion.slice(),
      rotationDeg: pose.rotationDeg.slice(),
      contact: round6Vec([rim[0], waveSurfaceHeight('steel', rim[0], rim[2]), rim[2]]),
      clearance: round6(clearance),
      gap: round6(Math.max(0, clearance)),
      penetration: round6(Math.max(0, -clearance)),
      facing: 'authored',
    };
  }));
}

/* ------------------------------------------------------------------------- */
/* Bounds, metrics, frozen WAVE object                                       */
/* ------------------------------------------------------------------------- */

function waveSamples(wave, count = 256) {
  const samples = [];
  for (let i = 0; i <= count; i += 1) {
    const x = -wave.length / 2 + (wave.length * i) / count;
    samples.push({ x, y: rawSurfaceY(wave, x) });
  }
  return samples;
}

function buildBounds() {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const kind of ['steel', 'gold']) {
    const wave = WAVES[kind];
    for (const sample of waveSamples(wave)) {
      minY = Math.min(minY, sample.y - wave.thickness);
      maxY = Math.max(maxY, sample.y);
    }
  }
  for (const coin of COINS) {
    minY = Math.min(minY, coin.position[1] - coin.radius);
    maxY = Math.max(maxY, coin.position[1] + coin.radius);
  }
  const min = [-RIBBON_LENGTH / 2, minY, GOLD_Z_START];
  const max = [RIBBON_LENGTH / 2, maxY, STEEL_Z_END];
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return deepFreeze({ min: round6Vec(min), max: round6Vec(max), center: round6Vec(center), size: round6Vec(size) });
}

function buildMetrics() {
  let maxSlope = 0;
  let maxCurvature = 0;
  let maxSlopeJump = 0;
  for (const kind of ['steel', 'gold']) {
    const wave = WAVES[kind];
    const slopeSteps = [];
    for (let i = 0; i < 1440; i += 1) {
      const x = -wave.wavelength / 2 + (i / 1440) * wave.wavelength;
      maxSlope = Math.max(maxSlope, Math.abs(rawSlope(wave, x)));
      maxCurvature = Math.max(maxCurvature, Math.abs(rawCurvature(wave, x)));
      slopeSteps.push(rawSlope(wave, x));
    }
    for (let i = 1; i < slopeSteps.length; i += 1) maxSlopeJump = Math.max(maxSlopeJump, Math.abs(slopeSteps[i] - slopeSteps[i - 1]));
  }
  // rev26 s51 proof: steel == A*sin(0.5x/A + 19/4), gold - baseY == A*cos(0.5x/A)
  let maxQuadratureError = 0;
  for (let i = 0; i < 720; i += 1) {
    const x = -WAVELENGTH / 2 + (i / 720) * WAVELENGTH;
    const k = 0.5 / AMPLITUDE;
    const steelErr = Math.abs(rawSurfaceY(WAVES.steel, x) - AMPLITUDE * Math.sin(k * x + GOLD_PHASE_RAD));
    const goldErr = Math.abs(rawSurfaceY(WAVES.gold, x) - WAVES.gold.baseY - AMPLITUDE * Math.cos(k * x));
    maxQuadratureError = Math.max(maxQuadratureError, steelErr, goldErr);
  }
  const steelTroughY = rawSurfaceY(WAVES.steel, WAVES.steel.troughX);
  const steelCrestY = rawSurfaceY(WAVES.steel, WAVES.steel.crestX);
  const goldMidY = rawSurfaceY(WAVES.gold, WAVELENGTH / 4);
  const goldCrestY = rawSurfaceY(WAVES.gold, WAVES.gold.crestX);
  const goldTroughY = rawSurfaceY(WAVES.gold, WAVES.gold.troughX);
  // s57: the authored row is irregular. spacing = the NEAREST pair of coin centres
  // in X (reported only; no 100 px rule is asserted any more).
  const byX = COINS.slice().sort((a, b) => a.position[0] - b.position[0]);
  let pairA = byX[0];
  let pairB = byX[1] || byX[0];
  for (let i = 0; i < byX.length - 1; i += 1) {
    if (byX[i + 1].position[0] - byX[i].position[0] < pairB.position[0] - pairA.position[0]) {
      pairA = byX[i];
      pairB = byX[i + 1];
    }
  }
  const spacingWorld = pairB.position[0] - pairA.position[0];
  const camera1440 = waveCameraPose(1440, 900);
  const camera1200 = waveCameraPose(1200, 900);
  const camera390 = waveCameraPose(390, 844);
  const pxProject = (camera, a, b) => {
    const pa = waveProjectPoint(a.position, camera);
    const pb = waveProjectPoint(b.position, camera);
    return Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  };
  let maxContactGap = 0;
  let maxPenetration = 0;
  for (const coin of COINS) {
    maxContactGap = Math.max(maxContactGap, coin.gap);
    maxPenetration = Math.max(maxPenetration, coin.penetration);
  }
  return deepFreeze({
    bounds: BOUNDS,
    minCoinClearance: round6(spacingWorld - 2 * COIN_SCALE),
    clearancePair: [pairA.id, pairB.id],
    contact: {
      authoredSink: 0,
      reported: true,
      method: 'rim circle vs steel surface (min of rimY - surfaceY)',
      maxGap: round6(maxContactGap),
      maxPenetration: round6(maxPenetration),
      perCoin: COINS.map((coin) => ({ id: coin.id, clearance: coin.clearance, gap: coin.gap, penetration: coin.penetration })),
      contactPoints: COINS.map((coin) => coin.contact),
    },
    coinCount: COINS.length,
    waveScale: WAVE_SCALE,
    spacing: {
      world: round6(spacingWorld),
      halfWavelength: round6(WAVELENGTH / 2),
      pair: [pairA.id, pairB.id],
      pixels1440: round6(pxProject(camera1440, pairA, pairB)),
      pixels1200: round6(pxProject(camera1200, pairA, pairB)),
      pixels390: round6(pxProject(camera390, pairA, pairB)),
      minPixels: null,
      rule: 'reported-only (authored poses)',
    },
    phase: {
      offsetCycles: round6(PHASE_OFFSET_CYCLES),
      offsetDegrees: round6(PHASE_OFFSET_CYCLES * 360),
      quadrature: false,
      formulas: { steel: 'A*sin(0.5*x/A+19/4)', gold: 'A*cos(0.5*x/A)' },
      maxQuadratureError: round6(maxQuadratureError),
      steelPhase: round6(PHASE_GOLD),
      goldPhase: PHASE_STEEL,
      steelKind: 'sin',
      goldKind: 'cos',
      steelTroughX: round6(WAVES.steel.troughX),
      steelTroughY: round6(steelTroughY),
      steelCrestX: round6(WAVES.steel.crestX),
      steelCrestY: round6(steelCrestY),
      goldCrestX: round6(WAVES.gold.crestX),
      goldCrestY: round6(goldCrestY),
      goldTroughX: round6(WAVES.gold.troughX),
      goldMidY: round6(goldMidY),
      goldTroughY: round6(goldTroughY),
    },
    profile: {
      form: 'sine',
      k: round6(0.5 / AMPLITUDE),
      scale: WAVE_SCALE,
      wavelength: round6(WAVELENGTH),
      amplitude: round6(AMPLITUDE),
      wavelengthOverAmplitude: round6(WAVELENGTH / AMPLITUDE),
      periods: round6(PERIODS),
      geometryScale: round6(GEOM.geometryScale),
      maxSlope: round6(maxSlope),
      maxSlopeDegrees: round6((Math.atan(maxSlope) * 180) / Math.PI),
      maxCurvature: round6(maxCurvature),
      maxSlopeJump: round6(maxSlopeJump),
      coinPlacement: 'authored',
    },
    layers: {
      steelZ: [round6(STEEL_Z_START), round6(STEEL_Z_END)],
      goldZ: [round6(GOLD_Z_START), round6(GOLD_Z_END)],
      goldBaseY: round6(GOLD_BASE_Y),
      layers: 'steel front (sin + 19/4), slate blue-violet ribbon behind (cos)',
    },
  });
}

const COINS = buildCoins();
const BOUNDS = buildBounds();

function buildCameraSpec() {
  const tanHalf = Math.tan((CAMERA.fovDeg * DEG) / 2);
  const designAspect = CAMERA.stageWidth / CAMERA.stageHeight;
  const halfSpan = (RIBBON_LENGTH / 2) * CAMERA.fitMargin;
  const distanceWidth = halfSpan / (tanHalf * designAspect);
  const targetY = round6((BOUNDS.min[1] + BOUNDS.max[1]) / 2);
  const targetZ = round6((GOLD_Z_START + STEEL_Z_END) / 2);
  const target = Object.freeze([0, targetY, targetZ]);
  const distance = round6(Math.max(1.6, distanceWidth + 0.12));
  return Object.freeze({ target, distance, fitMargin: CAMERA.fitMargin, distanceWidth: round6(distanceWidth), fovDeg: CAMERA.fovDeg, elevationDeg: CAMERA.elevationDeg });
}

const CAMERA_SPEC = buildCameraSpec();
const CAMERA_METRICS = waveCameraPose();
const METRICS = buildMetrics();

/**
 * Frozen Wave composition (public contract).
 */
export const WAVE = deepFreeze({
  mode: 'wave',
  ids: COIN_IDS.slice(),
  count: COINS.length,
  coinScale: COIN_SCALE,
  faceSize: 512,
  scale: WAVE_SCALE,
  waveScale: WAVE_SCALE,
  waveScaleRange: [WAVE_SCALE_MIN, WAVE_SCALE_MAX],
  palette: SLATE_PALETTE,
  camera: {
    fovDeg: CAMERA.fovDeg,
    fov: CAMERA.fovDeg * DEG,
    elevationDeg: CAMERA.elevationDeg,
    elevationRad: round6(CAMERA.elevationDeg * DEG),
    distance: CAMERA_SPEC.distance,
    targetY: CAMERA_SPEC.target[1],
    target: [CAMERA_SPEC.target[0], CAMERA_SPEC.target[1], CAMERA_SPEC.target[2]],
    position: CAMERA_METRICS.position.slice(),
    stage: { width: CAMERA.stageWidth, height: CAMERA.stageHeight },
    fitMargin: CAMERA.fitMargin,
    fitMode: 'bounds-fit',
    distanceWidth: CAMERA_SPEC.distanceWidth,
    pxPerWorld: round6(CAMERA_METRICS.pxPerWorld),
    baseDistance: round6(CAMERA_SPEC.distance),
  },
  layout: {
    design: 'two-ribbon-waves',
    coinRow: 'authored-poses',
    coinScale: COIN_SCALE,
    poseFactor: round6(POSE_FACTOR),
    authoredScale: WAVE_AUTHORED_SCALE,
    coins: COINS.map((coin) => ({ ...coin })),
  },
  waves: {
    steel: { ...WAVES.steel, profile: { form: 'sine', wavelength: round6(WAVELENGTH), amplitude: round6(AMPLITUDE), scale: WAVE_SCALE } },
    gold: { ...WAVES.gold, profile: { form: 'cosine', wavelength: round6(WAVELENGTH), amplitude: round6(AMPLITUDE), scale: WAVE_SCALE } },
  },
  ribbon: {
    metrics: {
      length: round6(RIBBON_LENGTH),
      width: round6(RIBBON_WIDTH),
      steelThickness: round6(GEOM.steelThickness),
      goldThickness: round6(GEOM.goldThickness),
      periods: round6(PERIODS),
      wavelength: round6(WAVELENGTH),
      amplitude: round6(AMPLITUDE),
      geometryScale: round6(GEOM.geometryScale),
      scale: WAVE_SCALE,
    },
    section: { materials: ['polished-steel', 'slate-blue-violet', 'polished-edge'] },
  },
  coins: COINS,
  entries: COINS,
  metrics: METRICS,
});

/** Convenience alias used by the page builder / verifier. */
export const WAVE_COMPOSITION = WAVE;

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a) {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}
