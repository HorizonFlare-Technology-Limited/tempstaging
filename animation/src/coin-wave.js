/**
 * coin-wave.js — pure deterministic composition math for the Rev15 coin Wave.
 *
 * SPEC "Collection Revision 15" R15-3: two broad, wide-top ribbon waves running
 * left-right on a neutral dark studio. Each ribbon is a broad flat strap whose
 * cross-section along the run (the wave) is a gentle, low-frequency, low-slope
 * flattened sine: wide flat crests/troughs, smooth curvature, no creases. The
 * front ribbon is brushed stainless steel; the back ribbon is the same wave in
 * TEKO gold with a satin finish, offset HALF A PHASE (its crests sit exactly
 * over the steel wave's troughs and vice versa). Three different-currency coins
 * stand in the steel wave's broad trough in a row, bottom rims exactly on the
 * surface; their screen spacing is exactly 100 CSS px at the default camera for
 * 1440x900 and 1200x900 stages.
 *
 * This module is dependency-free (no three.js, DOM, clock or randomness) so the
 * offline verifier and any renderer share exactly the same numbers.
 * Scene-space == world-space; the coin model's local +Y is its face normal and
 * local -Z is the symbol's up direction.
 *
 * Coordinate conventions
 *  - X runs left-right along each ribbon (the wave runs along X).
 *  - Y is up, Z is depth (toward the camera).
 *  - A ribbon occupies z in [zStart, zEnd] (a broad flat top across its width);
 *    its top surface height is
 *        y = baseY + amplitude * profile(x / wavelength + phase)
 *    where profile() is the broad-top flattened sine in [-1, 1].
 *  - Steel trough is at x = 0; the gold ribbon's phase is +0.5 cycles, so at
 *    x = 0 the gold surface is at its crest: crest-over-trough by construction.
 */

export const COIN_GEOMETRY = Object.freeze({
  radius: 1,
  thickness: 0.16,
  halfThickness: 0.08,
});

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const clamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);
const tanh = (value) => {
  const x = clamp(value, -20, 20);
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
};
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
/* Wave cross-section profile (along the run)                                */
/* ------------------------------------------------------------------------- */

/**
 * Broad-top sine profile in [-1, 1]; u is in cycles (0..1 = one wavelength).
 * tanh() compresses the sine extremes so crests/troughs become wide flat tops
 * while the flanks stay smooth; the curve is C-infinity (no creases).
 */
const PROFILE = Object.freeze({
  sharpness: 0.7,
  flatTopThreshold: 0.8,
});

function profile(u) {
  const cycles = u - Math.floor(u);
  return tanh(PROFILE.sharpness * Math.sin(TAU * cycles)) / tanh(PROFILE.sharpness);
}

/** first derivative of the profile with respect to u (cycles) */
function profileDerivative(u) {
  const cycles = u - Math.floor(u);
  const s = PROFILE.sharpness;
  const sin = Math.sin(TAU * cycles);
  const cos = Math.cos(TAU * cycles);
  const sech2 = 1 / Math.cosh(s * sin) ** 2;
  return (sech2 * s * cos * TAU) / tanh(s);
}

/** second derivative of the profile with respect to u (cycles) */
function profileSecondDerivative(u) {
  const cycles = u - Math.floor(u);
  const s = PROFILE.sharpness;
  const sin = Math.sin(TAU * cycles);
  const cos = Math.cos(TAU * cycles);
  const sech2 = 1 / Math.cosh(s * sin) ** 2;
  const th = Math.tanh(s * sin);
  const dSech = -2 * sech2 * th * s * cos * TAU;
  return (dSech * s * cos * TAU + sech2 * (-s * sin * TAU * TAU)) / tanh(s);
}

/* ------------------------------------------------------------------------- */
/* Wave definitions                                                          */
/* ------------------------------------------------------------------------- */

const WAVELENGTH = 7.4;
const AMPLITUDE = 0.45;
const RIBBON_LENGTH = 26;
const RIBBON_WIDTH = 2.2; // broad flat top across the ribbon width (Z)
const PHASE_STEEL = 0.75; // trough exactly at x = 0
const PHASE_GOLD = PHASE_STEEL + 0.5; // half a phase behind -> crest at x = 0
const STEEL_Z_START = 0.6;
const STEEL_Z_END = 2.8;
const GOLD_Z_START = -1.6;
const GOLD_Z_END = 0.6;
const GOLD_BASE_Y = 0.55; // the gold ribbon rides behind/above the steel one
const COIN_SCALE = 0.18; // ~86 CSS px diameter, leaving a visible gap on the 100 px spacing
const COIN_IDS = Object.freeze(['gbp', 'eur', 'usd']);
const COIN_Z = (STEEL_Z_START + STEEL_Z_END) / 2;

const WAVES = deepFreeze({
  steel: {
    kind: 'steel',
    label: 'Brushed stainless steel',
    finish: 'brushed',
    material: { color: 0xcfd4da, roughness: 0.38, metalness: 1 },
    length: RIBBON_LENGTH,
    width: RIBBON_WIDTH,
    zStart: STEEL_Z_START,
    zEnd: STEEL_Z_END,
    thickness: 0.22,
    baseY: 0,
    wavelength: WAVELENGTH,
    amplitude: AMPLITUDE,
    phase: PHASE_STEEL,
    troughX: 0,
    crestXs: [-WAVELENGTH / 2, WAVELENGTH / 2],
  },
  gold: {
    kind: 'gold',
    label: 'TEKO gold satin',
    finish: 'satin',
    material: { color: 0xffd60a, roughness: 0.5, metalness: 1 },
    length: RIBBON_LENGTH,
    width: RIBBON_WIDTH,
    zStart: GOLD_Z_START,
    zEnd: GOLD_Z_END,
    thickness: 0.2,
    baseY: GOLD_BASE_Y,
    wavelength: WAVELENGTH,
    amplitude: AMPLITUDE,
    phase: PHASE_GOLD,
    troughX: -WAVELENGTH / 2,
    crestX: 0,
  },
});

const WAVE_PHASE_OFFSET_CYCLES = (WAVES.gold.phase - WAVES.steel.phase + 1) % 1;

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

/** Wave phase at x in cycles (steel trough = 0.75, steel crest = 0.25). */
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
  elevationDeg: 20,
  distance: 7,
  target: Object.freeze([0, 0.25, 0.7]),
  stageWidth: 1440,
  stageHeight: 900,
});

/**
 * Default deterministic hero camera for the Wave scene. The camera distance is
 * fixed (not aspect-dependent) so the composition's pixel scale depends only on
 * the stage HEIGHT: 1440x900 and 1200x900 share exactly the same px/world
 * scale, which is what makes the 100 CSS px coin spacing hold at both.
 */
export function waveCameraPose(stageWidth = CAMERA.stageWidth, stageHeight = CAMERA.stageHeight) {
  const fov = CAMERA.fovDeg * DEG;
  const elevation = CAMERA.elevationDeg * DEG;
  const target = Object.freeze([CAMERA.target[0], CAMERA.target[1], CAMERA.target[2]]);
  const position = Object.freeze([
    target[0],
    target[1] + CAMERA.distance * Math.sin(elevation),
    target[2] + CAMERA.distance * Math.cos(elevation),
  ]);
  const pxPerWorld = stageHeight / (2 * CAMERA.distance * Math.tan(fov / 2));
  return Object.freeze({
    fovDeg: CAMERA.fovDeg,
    fov,
    elevationDeg: CAMERA.elevationDeg,
    elevation,
    distance: CAMERA.distance,
    target,
    position,
    stage: Object.freeze({ width: stageWidth, height: stageHeight }),
    pxPerWorld,
    pxPerWorldAt900: round6(900 / (2 * CAMERA.distance * Math.tan(fov / 2))),
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

function buildCoins() {
  const camera = waveCameraPose();
  const surfaceYAt = (x) => rawSurfaceY(WAVES.steel, x);
  // solve the world spacing that projects to exactly 100 CSS px at the default
  // 1440x900 camera; coin centres share z and sit r above the local surface
  const projectAt = (x) => waveProjectPoint([x, surfaceYAt(x) + COIN_SCALE, COIN_Z], camera);
  let spacingWorld = 0.4;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const p0 = projectAt(0);
    const p1 = projectAt(spacingWorld);
    const pixels = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const error = 100 / pixels;
    spacingWorld *= error;
    if (Math.abs(error - 1) < 1e-14) break;
  }
  const half = Math.SQRT1_2;
  const quaternion = Object.freeze([half, 0, 0, half]); // Rx(pi/2): face +Z, symbol up +Y
  return COIN_IDS.map((id, index) => {
    const x = (index - (COIN_IDS.length - 1) / 2) * spacingWorld;
    const surface = surfaceYAt(x);
    return deepFreeze({
      id,
      index,
      surface: 'steel',
      radius: COIN_SCALE,
      scale: COIN_SCALE,
      position: round6Vec([x, surface + COIN_SCALE, COIN_Z]),
      quaternion,
      contact: round6Vec([x, surface, COIN_Z]),
      gap: 0,
      penetration: 0,
      facing: '+Z',
      screenSpacingPx: 100,
    });
  });
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
  let flatSamples = 0;
  let totalSamples = 0;
  const slopeSteps = [];
  for (const kind of ['steel', 'gold']) {
    const wave = WAVES[kind];
    for (let i = 0; i < 1440; i += 1) {
      const x = -wave.wavelength / 2 + (i / 1440) * wave.wavelength;
      maxSlope = Math.max(maxSlope, Math.abs(rawSlope(wave, x)));
      maxCurvature = Math.max(maxCurvature, Math.abs(rawCurvature(wave, x)));
      if (Math.abs(profile(x / wave.wavelength + wave.phase)) >= PROFILE.flatTopThreshold) flatSamples += 1;
      totalSamples += 1;
      slopeSteps.push(rawSlope(wave, x));
    }
  }
  let maxSlopeJump = 0;
  for (let i = 1; i < slopeSteps.length; i += 1) maxSlopeJump = Math.max(maxSlopeJump, Math.abs(slopeSteps[i] - slopeSteps[i - 1]));
  const flatTopFraction = flatSamples / totalSamples;
  // anti-phase proof: gold(x) - goldBaseY === -(steel(x) - steelBaseY)
  let maxAntiPhaseError = 0;
  for (let i = 0; i < 720; i += 1) {
    const x = -WAVELENGTH / 2 + (i / 720) * WAVELENGTH;
    const steelOffset = rawSurfaceY(WAVES.steel, x) - WAVES.steel.baseY;
    const goldOffset = rawSurfaceY(WAVES.gold, x) - WAVES.gold.baseY;
    maxAntiPhaseError = Math.max(maxAntiPhaseError, Math.abs(steelOffset + goldOffset));
  }
  // crest/trough alignment at x = 0 (steel trough, gold crest)
  const steelTroughY = rawSurfaceY(WAVES.steel, 0);
  const goldCrestY = rawSurfaceY(WAVES.gold, 0);
  const steelCrestY = rawSurfaceY(WAVES.steel, WAVELENGTH / 2);
  const goldTroughY = rawSurfaceY(WAVES.gold, WAVELENGTH / 2);
  const spacingWorld = COINS[1].position[0] - COINS[0].position[0];
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
    const surface = waveSurfaceHeight(coin.surface, coin.position[0], coin.position[2]);
    const rimY = coin.position[1] - coin.radius;
    const gap = rimY - surface;
    maxContactGap = Math.max(maxContactGap, Math.abs(gap));
    maxPenetration = Math.max(maxPenetration, Math.max(0, -gap));
  }
  return deepFreeze({
    bounds: buildBounds(),
    minCoinClearance: round6(spacingWorld - 2 * COIN_SCALE),
    clearancePair: ['gbp', 'eur'],
    contact: { authoredSink: 0, maxGap: round6(maxContactGap), maxPenetration: round6(maxPenetration), contactPoints: COINS.map((coin) => coin.contact) },
    coinCount: COINS.length,
    spacing: {
      world: round6(spacingWorld),
      pixels1440: round6(pxProject(camera1440, COINS[0], COINS[1])),
      pixels1200: round6(pxProject(camera1200, COINS[0], COINS[1])),
      pixels390: round6(pxProject(camera390, COINS[0], COINS[1])),
    },
    phase: {
      offsetCycles: round6(WAVE_PHASE_OFFSET_CYCLES),
      offsetDegrees: round6(WAVE_PHASE_OFFSET_CYCLES * 360),
      maxAntiPhaseError: round6(maxAntiPhaseError),
      steelTroughX: WAVES.steel.troughX,
      steelTroughY: round6(steelTroughY),
      goldCrestX: WAVES.gold.crestX,
      goldCrestY: round6(goldCrestY),
      steelCrestX: WAVELENGTH / 2,
      steelCrestY: round6(steelCrestY),
      goldTroughX: WAVELENGTH / 2,
      goldTroughY: round6(goldTroughY),
    },
    profile: {
      sharpness: PROFILE.sharpness,
      wavelength: WAVELENGTH,
      amplitude: AMPLITUDE,
      maxSlope: round6(maxSlope),
      maxSlopeDegrees: round6((Math.atan(maxSlope) * 180) / Math.PI),
      maxCurvature: round6(maxCurvature),
      maxSlopeJump: round6(maxSlopeJump),
      flatTopThreshold: PROFILE.flatTopThreshold,
      flatTopFraction: round6(flatTopFraction),
      troughFlatWidth: round6(flatWidthFor(WAVES.steel)),
    },
    layers: {
      steelZ: [STEEL_Z_START, STEEL_Z_END],
      goldZ: [GOLD_Z_START, GOLD_Z_END],
      goldBaseY: GOLD_BASE_Y,
      layers: 'steel front, gold behind and half a phase along X',
    },
  });
}

/** world width of the broad flat part of the steel trough (where the coins sit) */
function flatWidthFor(wave) {
  // scan the trough side of one period: |profile| >= flatTopThreshold
  let count = 0;
  const samples = 4096;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / samples) * wave.wavelength - wave.wavelength / 2;
    if (Math.abs(profile(x / wave.wavelength + wave.phase)) >= PROFILE.flatTopThreshold) count += 1;
  }
  void count;
  // trough flat region alone: sample around x = troughX
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < 4096; i += 1) {
    const x = (i / 4096) * (wave.wavelength / 2);
    const value = profile(x / wave.wavelength + wave.phase);
    if (value <= -PROFILE.flatTopThreshold) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  return hi - lo;
}

const COINS = buildCoins();
const METRICS = buildMetrics();
const CAMERA_METRICS = waveCameraPose();

/**
 * Frozen Wave composition (public contract).
 */
export const WAVE = deepFreeze({
  mode: 'wave',
  ids: COIN_IDS.slice(),
  count: COINS.length,
  coinScale: COIN_SCALE,
  faceSize: 512,
  camera: {
    fovDeg: CAMERA.fovDeg,
    fov: CAMERA.fovDeg * DEG,
    elevationDeg: CAMERA.elevationDeg,
    elevationRad: round6(CAMERA.elevationDeg * DEG),
    distance: CAMERA.distance,
    targetY: CAMERA.target[1],
    target: [CAMERA.target[0], CAMERA.target[1], CAMERA.target[2]],
    position: CAMERA_METRICS.position.slice(),
    stage: { width: CAMERA.stageWidth, height: CAMERA.stageHeight },
    fitMargin: 1.0,
    fitMode: 'height',
    pxPerWorld: round6(CAMERA_METRICS.pxPerWorld),
    baseDistance: round6(CAMERA.distance),
  },
  layout: {
    design: 'two-ribbon-waves',
    coinRow: 'steel-trough-flat',
    coinScale: COIN_SCALE,
    coins: COINS.map((coin) => ({ ...coin })),
  },
  waves: {
    steel: { ...WAVES.steel, profile: { ...PROFILE, wavelength: WAVELENGTH, amplitude: AMPLITUDE } },
    gold: { ...WAVES.gold, profile: { ...PROFILE, wavelength: WAVELENGTH, amplitude: AMPLITUDE } },
  },
  ribbon: {
    metrics: { length: RIBBON_LENGTH, width: RIBBON_WIDTH, steelThickness: 0.22, goldThickness: 0.2 },
    section: { materials: ['brushed-steel', 'gold-satin', 'polished-edge'] },
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
