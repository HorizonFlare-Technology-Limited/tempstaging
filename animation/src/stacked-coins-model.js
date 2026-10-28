/**
 * stacked-coins-model.js — pure deterministic model for the Rev17 stacked glowing
 * coins page (dark editorial studio, tall stack of 8-10 coins, 2-3 floating coins,
 * theme-gold glow on the reeded edges, subtle float/pulse).
 *
 * Reference: K:\HFWorkspace\revolutmedia\images\stacked_and_glow_coins.png
 * (reference uses a blue edge glow; this page uses the TEKO theme GOLD glow, per
 * the task brief, with our own coin model loaded by the previewer).
 *
 * Dependency-free: no three.js, DOM, clock or randomness. The previewer consumes
 * CONFIG / LAYOUT / pose(t) / cameraFit and adds our coin model groups.
 *
 * Coin model contract (see SPEC 4): coin local axis = +Y, faces at +/-Y, radius 1,
 * thickness 0.16. A coin lying flat is identity; flipping about X shows the other
 * face; the page loads/creates the coins itself.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const lerp = (a, b, t) => a + (b - a) * t;
const round6 = (value) => Math.round(value * 1e6) / 1e6;
const round6Vec = (v) => v.map(round6);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/* ------------------------------------------------------------------------- */
/* Config                                                                    */
/* ------------------------------------------------------------------------- */

const DURATION = 6.0; // one deterministic loop
const COIN = deepFreeze({
  radius: 1.0,
  thickness: 0.16,
  faceUp: 'symbol', // flip the model so the symbol face is up on the stack
});

const STACK_CONFIG = deepFreeze({
  count: 9, // 8-10 allowed by the brief
  gap: 0.008,
  baseGap: 0.0,
  yawStepDeg: 6.0, // alternating small yaws so the reeded edges shimmer
  yawSigns: [-1, 1, -1, 1, -1, 1, -1, 1, -1],
});

const FLOAT_CONFIG = deepFreeze({
  count: 3, // 2-3 allowed by the brief
  bobPeriodSeconds: 3.0,
  yawPeriodSeconds: 6.0,
  bobAmplitude: [0.09, 0.075, 0.11],
  yawDriftDeg: [8, -6, 10],
  tiltXDeg: [16, -12, 20],
  tiltZDeg: [-10, 14, 7],
  basePosition: [
    [-0.6, null, 0.12],
    [0.42, null, -0.16],
    [-0.12, null, 0.06],
  ],
  heightOffsets: [0.55, 0.98, 1.5], // above the top of the stack
});

const GLOW = deepFreeze({
  target: 'reeded-edges',
  color: '#ffd60a',
  colorRgb: [1.0, 0.8392, 0.0392],
  emissiveBase: 2.2,
  emissivePulseMin: 0.82,
  emissivePulseMax: 1.2,
  pulsePeriodSeconds: 2.0,
  additiveHalo: true,
  haloOpacity: 0.26,
  haloScale: 1.03,
  faceGlow: 0.0, // satin silver faces stay unglowed
  rimTint: '#f5c400',
});

const STUDIO = deepFreeze({
  finish: 'dark-editorial',
  background: '#0b0d10',
  floor: '#0e1115',
  floorRoughness: 0.42,
  floorMetalness: 0.35,
  keyLight: { intensity: 1.35, color: '#ffffff', position: [4.5, 7.0, 6.0] },
  fillLight: { intensity: 0.4, color: '#cfd9e8', position: [-5.0, 3.5, 4.0] },
  goldBounce: { intensity: 1.1, color: '#ffd60a', position: [0, 1.6, 2.6] },
});

const STACK_TOP_Y = COIN.thickness / 2 + (STACK_CONFIG.count - 1) * (COIN.thickness + STACK_CONFIG.gap);
const FLOATER_BASE_Y = STACK_TOP_Y + COIN.thickness / 2;

/* ------------------------------------------------------------------------- */
/* Coin orientations + layout                                                */
/* ------------------------------------------------------------------------- */

function quatAxisAngle(ax, ay, az, angle) {
  const length = Math.hypot(ax, ay, az) || 1;
  const s = Math.sin(angle / 2) / length;
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}
function quatMultiply(a, b) {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
/** Euler order YXZ, angles in radians (yaw about Y, then X, then Z). */
function quatFromYawTiltYaw(yaw, tiltX, tiltZ) {
  const qYaw = quatAxisAngle(0, 1, 0, yaw);
  const qX = quatAxisAngle(1, 0, 0, tiltX);
  const qZ = quatAxisAngle(0, 0, 1, tiltZ);
  return quatMultiply(qYaw, quatMultiply(qX, qZ));
}
function rotateByQuaternion(quaternion, vector) {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = vector;
  return [
    2 * (vx * (0.5 - y * y - z * z) + vy * (x * y - w * z) + vz * (x * z + w * y)),
    2 * (vx * (x * y + w * z) + vy * (0.5 - x * x - z * z) + vz * (y * z - w * x)),
    2 * (vx * (x * z - w * y) + vy * (y * z + w * x) + vz * (0.5 - x * x - y * y)),
  ];
}

const FACE_FLIP = quatAxisAngle(1, 0, 0, Math.PI); // local +Y face -> -Y (symbol up)

function buildStackLayout() {
  const coins = [];
  for (let index = 0; index < STACK_CONFIG.count; index += 1) {
    const yawDeg = index % 2 === 0 ? STACK_CONFIG.yawStepDeg : -STACK_CONFIG.yawStepDeg;
    const y = COIN.thickness / 2 + index * (COIN.thickness + STACK_CONFIG.gap) + STACK_CONFIG.baseGap;
    const yawQuat = quatAxisAngle(0, 1, 0, yawDeg * DEG);
    const quaternion = quatMultiply(yawQuat, FACE_FLIP);
    coins.push({
      kind: 'stack',
      index,
      y: round6(y),
      yawDeg: round6(yawDeg),
      basePosition: [0, round6(y), 0],
      baseQuaternion: quaternion.map(round6),
      glowPhase: round6(index * 0.11),
    });
  }
  return coins;
}

function buildFloatLayout() {
  const coins = [];
  for (let index = 0; index < FLOAT_CONFIG.count; index += 1) {
    const base = FLOAT_CONFIG.basePosition[index];
    const y = round6(FLOATER_BASE_Y + FLOAT_CONFIG.heightOffsets[index]);
    const position = [base[0], y, base[2]];
    const tiltX = FLOAT_CONFIG.tiltXDeg[index] * DEG;
    const tiltZ = FLOAT_CONFIG.tiltZDeg[index] * DEG;
    const quaternion = quatMultiply(FACE_FLIP, quatFromYawTiltYaw(0, tiltX, tiltZ));
    coins.push({
      kind: 'float',
      index,
      basePosition: position,
      baseQuaternion: quaternion.map(round6),
      bobAmplitude: FLOAT_CONFIG.bobAmplitude[index],
      bobPeriodSeconds: FLOAT_CONFIG.bobPeriodSeconds,
      bobPhase: round6((index / FLOAT_CONFIG.count) * TAU + 0.4),
      yawPhase: round6((index / FLOAT_CONFIG.count) * TAU + 1.1),
      yawDriftDeg: FLOAT_CONFIG.yawDriftDeg[index],
      glowPhase: round6(index * 0.7 + 0.25),
    });
  }
  return coins;
}

const STACK_COINS = buildStackLayout();
const FLOAT_COINS = buildFloatLayout();
const ALL_COINS = [...STACK_COINS, ...FLOAT_COINS];

/* ------------------------------------------------------------------------- */
/* Pose                                                                      */
/* ------------------------------------------------------------------------- */

function pulseAt(time, phase) {
  const period = GLOW.pulsePeriodSeconds;
  const wave = 0.5 - 0.5 * Math.cos((TAU * time) / period + phase * TAU);
  return lerp(GLOW.emissivePulseMin, GLOW.emissivePulseMax, wave);
}

/**
 * Deterministic loop pose at time t (seconds; wraps into [0, duration)).
 * Stack coins are static except a tiny breathing offset and the gold glow pulse;
 * floating coins bob/slowly yaw above the stack.
 */
export function coinsPose(t) {
  const raw = Number(t) || 0;
  const time = ((raw % DURATION) + DURATION) % DURATION;
  const stack = STACK_COINS.map((coin) => {
    const breathe = Math.sin((TAU * time) / DURATION + coin.index * 0.35) * 0.0025;
    const glowIntensity = pulseAt(time, coin.glowPhase) * GLOW.emissiveBase;
    return {
      kind: 'stack',
      index: coin.index,
      position: [0, round6(coin.basePosition[1] + breathe), 0],
      quaternion: coin.baseQuaternion.slice(),
      normal: rotateByQuaternion(coin.baseQuaternion, [0, 1, 0]).map(round6),
      glowIntensity: round6(glowIntensity),
      yawDeg: coin.yawDeg,
    };
  });
  const floats = FLOAT_COINS.map((coin) => {
    const bobPhase = (TAU * time) / coin.bobPeriodSeconds + coin.bobPhase;
    const bob = Math.sin(bobPhase) * coin.bobAmplitude;
    const yawWave = Math.sin((TAU * time) / FLOAT_CONFIG.yawPeriodSeconds + coin.yawPhase);
    const yaw = yawWave * coin.yawDriftDeg * DEG;
    const driftX = Math.sin(bobPhase * 0.5) * 0.03;
    const driftZ = Math.cos(bobPhase * 0.5) * 0.03;
    const quaternion = quatMultiply(
      quatAxisAngle(0, 1, 0, yaw),
      coin.baseQuaternion,
    ).map(round6);
    return {
      kind: 'float',
      index: coin.index,
      position: [
        round6(coin.basePosition[0] + driftX),
        round6(coin.basePosition[1] + bob),
        round6(coin.basePosition[2] + driftZ),
      ],
      quaternion,
      normal: rotateByQuaternion(quaternion, [0, 1, 0]).map(round6),
      bob: round6(bob),
      yawDeg: round6(yaw / DEG),
      glowIntensity: round6(pulseAt(time, coin.glowPhase) * GLOW.emissiveBase),
    };
  });
  return deepFreeze({
    time: round6(time),
    duration: DURATION,
    loop: true,
    phase: 'loop',
    stack,
    floats,
    glow: {
      color: GLOW.color,
      target: GLOW.target,
      pulseMin: GLOW.emissivePulseMin,
      pulseMax: GLOW.emissivePulseMax,
      pulsePeriodSeconds: GLOW.pulsePeriodSeconds,
    },
    stackTopY: round6(STACK_TOP_Y),
  });
}

/** Reduced-motion pose: a fixed, composed frame (no float/pulse animation). */
export function stackedCoinsReducedMotionPose() {
  return coinsPose(DURATION * 0.25);
}

/* ------------------------------------------------------------------------- */
/* Camera + projection                                                       */
/* ------------------------------------------------------------------------- */

const CAMERA = deepFreeze({
  fovDeg: 30,
  elevationDeg: 10,
  fitMargin: 1.1,
  trainTopY: FLOATER_BASE_Y + FLOAT_CONFIG.heightOffsets[2] + FLOAT_CONFIG.bobAmplitude[2] + COIN.radius,
  targetY: null, // computed below
  near: 0.05,
  far: 120,
});

const COMPOSITION_BOUNDS = deepFreeze({
  min: [-COIN.radius * 1.75, 0, -COIN.radius * 1.75],
  max: [COIN.radius * 1.75, round6(CAMERA.trainTopY), COIN.radius * 1.75],
  center: [0, round6(CAMERA.trainTopY / 2), 0],
  size: [round6(COIN.radius * 3.5), round6(CAMERA.trainTopY), round6(COIN.radius * 3.5)],
});

/**
 * Deterministic hero camera framing the stack + floating coins in a dark studio.
 */
export function coinsCameraFit(stageWidth = 1440, stageHeight = 900) {
  const fov = CAMERA.fovDeg * DEG;
  const tanHalf = Math.tan(fov / 2);
  const aspect = stageWidth / stageHeight;
  const topWorld = CAMERA.trainTopY;
  const bottomWorld = -COIN.thickness;
  const frameHeight = topWorld - bottomWorld;
  const targetY = topWorld * 0.5;
  const halfWidth = COIN.radius * 1.7;
  const distanceForWidth = (halfWidth * CAMERA.fitMargin) / (tanHalf * aspect);
  const distanceForHeight = ((frameHeight / 2) * CAMERA.fitMargin) / tanHalf;
  const distance = Math.max(distanceForWidth, distanceForHeight, 4.0);
  const elevation = CAMERA.elevationDeg * DEG;
  const position = [0, targetY + distance * Math.sin(elevation), distance * Math.cos(elevation)];
  return deepFreeze({
    fovDeg: CAMERA.fovDeg,
    fov,
    elevationDeg: CAMERA.elevationDeg,
    distance: round6(distance),
    target: [0, round6(targetY), 0],
    position: round6Vec(position),
    near: CAMERA.near,
    far: CAMERA.far,
    stage: { width: stageWidth, height: stageHeight },
    aspect: round6(aspect),
    fitMargin: CAMERA.fitMargin,
    framing: {
      bottomWorld: round6(bottomWorld),
      topWorld: round6(topWorld),
      stackTopY: round6(STACK_TOP_Y),
      floaterTopY: round6(CAMERA.trainTopY),
    },
  });
}

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

/** Project a world point to CSS pixels (origin top-left) for a camera fit result. */
export function coinsProjectPoint(worldPoint, camera = coinsCameraFit()) {
  const eye = camera.position;
  const target = camera.target;
  const forward = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const rel = [worldPoint[0] - eye[0], worldPoint[1] - eye[1], worldPoint[2] - eye[2]];
  const zCam = dot(forward, rel);
  const tanHalf = Math.tan(camera.fov / 2);
  const aspect = camera.stage.width / camera.stage.height;
  const ndcX = dot(right, rel) / (zCam * tanHalf * aspect);
  const ndcY = dot(up, rel) / (zCam * tanHalf);
  return [round6((ndcX * 0.5 + 0.5) * camera.stage.width), round6((0.5 - ndcY * 0.5) * camera.stage.height)];
}

/* ------------------------------------------------------------------------- */
/* Frozen public contract                                                    */
/* ------------------------------------------------------------------------- */

export const COINS_LAYOUT = deepFreeze({
  stack: STACK_COINS.map((coin) => ({
    index: coin.index,
    position: coin.basePosition.slice(),
    quaternion: coin.baseQuaternion.slice(),
    yawDeg: coin.yawDeg,
    glowPhase: coin.glowPhase,
  })),
  floats: FLOAT_COINS.map((coin) => ({
    index: coin.index,
    basePosition: coin.basePosition.slice(),
    quaternion: coin.baseQuaternion.slice(),
    bobAmplitude: coin.bobAmplitude,
    bobPeriodSeconds: coin.bobPeriodSeconds,
    bobPhase: coin.bobPhase,
    yawPhase: coin.yawPhase,
    yawDriftDeg: coin.yawDriftDeg,
    glowPhase: coin.glowPhase,
  })),
  stackTopY: round6(STACK_TOP_Y),
  floaterBaseY: round6(FLOATER_BASE_Y),
  stackCount: STACK_CONFIG.count,
  floatCount: FLOAT_CONFIG.count,
});

export const COINS_CONFIG = deepFreeze({
  id: 'stacked-coins',
  version: '1.0.0',
  page: 'stacked-coins.html',
  durationSeconds: DURATION,
  loop: true,
  coin: COIN,
  stack: STACK_CONFIG,
  float: FLOAT_CONFIG,
  glow: GLOW,
  studio: STUDIO,
  camera: CAMERA,
  bounds: COMPOSITION_BOUNDS,
  layout: COINS_LAYOUT,
  reducedMotion: { final: true, time: round6(DURATION * 0.25) },
  shots: [0, 1.5, 3.0, 4.5],
  projectPoint: coinsProjectPoint,
  cameraFit: coinsCameraFit,
  pose: coinsPose,
});

export const COINS_DURATION = DURATION;
export const coinsConfig = COINS_CONFIG;
export const stackedCoinsConfig = COINS_CONFIG;

/** Convenience alias for page builders. */
export const STACKED_COINS_MODEL = deepFreeze({
  config: COINS_CONFIG,
  duration: DURATION,
  layout: COINS_LAYOUT,
  bounds: COMPOSITION_BOUNDS,
  pose: coinsPose,
  cameraFit: coinsCameraFit,
  projectPoint: coinsProjectPoint,
  reducedMotionPose: stackedCoinsReducedMotionPose,
});
