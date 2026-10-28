/**
 * brandplate-model.js — pure deterministic model for the PROVISIONAL silver brand
 * square plate page (SPEC Collection Revision 15 R15-4).
 *
 * The user reference images for the brand square plate were not attached, so
 * this provisional design uses: thick SILVER SATIN square plates, the project's
 * TEKO brand logo (local asset, gold), and a BLACK-MIRROR-METAL middle frame
 * with the same finish family as the Rev15 black card (R15-1). The page and docs
 * mark it PROVISIONAL.
 *
 * Composition: 5 upright plates start in an evenly spaced row and gather from
 * RIGHT to LEFT into a shingled stack; in the final stack the RIGHT plate is the
 * top layer (nearest the camera) and the left plates sit behind it. Duration is
 * ~3 s with an eased per-plate stagger.
 *
 * This module is dependency-free (no three.js, DOM, clock or randomness) so the
 * offline verifier and the renderer share exactly the same numbers.
 *
 * Coordinates: X = right, Y = up, Z = towards the camera. A plate's centre is
 * its geometric centre; plates stand upright with their bottom edges at y = 0.
 */

const DEG = Math.PI / 180;
const COUNT = 5;
const DURATION_SECONDS = 3.0;
const STAGGER_SECONDS = 0.28;
const MOVE_SECONDS = 1.55;

const PLATE = Object.freeze({
  size: 1.6, // square face edge length (world)
  thickness: 0.18, // thick slab
  cornerRadius: 0.14,
  bevel: 0.035,
  edgeSegments: 6,
});

const FRAME = Object.freeze({
  // black-mirror-metal middle frame, a square ring set into the plate face
  outerSize: 1.2,
  innerSize: 0.84,
  width: 0.18,
  thickness: 0.034,
  proud: 0.012, // sits slightly proud of the silver face
  cornerRadius: 0.09,
  finish: 'black-mirror-metal',
});

const LOGO = Object.freeze({
  src: 'assets/brandplate/teko-logo.png',
  srcSvg: 'assets/brandplate/teko-logo.svg',
  size: 0.7,
  clearance: 0.03, // sits in the silver centre inside the black frame opening
  color: '#ffd60a',
  plane: 'front',
});

const SILVER = Object.freeze({
  finish: 'silver-satin',
  label: 'Silver satin',
  metalness: 1.0,
  roughness: 0.3,
  color: '#d8dde2',
  clearcoat: 0.05,
  clearcoatRoughness: 0.4,
  envMapIntensity: 1.15,
  brushed: true,
});

const BLACK_MIRROR = Object.freeze({
  // same finish family as the Rev15 black card middle frame (R15-1)
  finish: 'black-mirror-metal',
  label: 'Black mirror metal (card frame family)',
  metalness: 1.0,
  roughness: 0.045,
  color: '#0e1114',
  clearcoat: 0.08,
  clearcoatRoughness: 0.12,
  envMapIntensity: 2.6,
});

const START = Object.freeze({
  rowSpacing: 2.1,
  z: 0,
  yawDeg: 0,
  lift: 0,
});

const FINAL_STACK = Object.freeze({
  shingleX: 0.09, // horizontal shingle fan (right plates sit to the right)
  layerZ: 0.032, // per-index depth step: right plate = highest index = nearest camera
  yawDeg: 1.0, // tiny per-index yaw so the stack catches studio highlights
  centerX: 0,
  centerZ: 0,
});

const LAYOUT = Object.freeze({
  count: COUNT,
  durationSeconds: DURATION_SECONDS,
  staggerSeconds: STAGGER_SECONDS,
  moveSeconds: MOVE_SECONDS,
  direction: 'right-to-left',
  topLayer: 'right',
  start: START,
  final: FINAL_STACK,
  shotTimes: Object.freeze([0, 1.5, 3.0]),
});

const CAMERA = Object.freeze({
  fovDeg: 30,
  elevationDeg: 7,
  target: Object.freeze([0, 0.8, 0]),
  fitMargin: 1.08,
  near: 0.05,
  far: 100,
});

/** base centre height so the bottom edge of every plate rests on y = 0 */
const BASE_Y = PLATE.size / 2;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (x) => x * x * (3 - 2 * x);
/** smootherstep: zero first and second derivatives at both ends (gentle ~3 s easing) */
const smootherstep = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const round6 = (value) => Math.round(value * 1e6) / 1e6;

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/* ------------------------------------------------------------------------- */
/* Placements                                                                */
/* ------------------------------------------------------------------------- */

function startX(index) {
  return (index - (COUNT - 1) / 2) * START.rowSpacing;
}

function finalX(index) {
  return FINAL_STACK.centerX + (index - (COUNT - 1) / 2) * FINAL_STACK.shingleX;
}

function finalZ(index) {
  return FINAL_STACK.centerZ + index * FINAL_STACK.layerZ;
}

/** Per-plate animation timing: the RIGHT plate moves first, then the rest to the left. */
function delayFor(index) {
  return (COUNT - 1 - index) * STAGGER_SECONDS;
}

/** Eased progress (0..1) of a plate at time t. */
function plateProgress(index, t) {
  if (t <= 0) return 0;
  const raw = (t - delayFor(index)) / MOVE_SECONDS;
  if (raw <= 0) return 0;
  if (raw >= 1) return 1;
  return smootherstep(raw);
}

/* ------------------------------------------------------------------------- */
/* Public pose API                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Deterministic gather pose at time t (seconds).
 * Returns frozen objects only; pose(0) is the start row, pose(duration) the
 * final shingled stack. Plates are upright, yaw-only (no pitch/roll).
 */
export function brandplatePose(t) {
  const time = clamp01(t / DURATION_SECONDS) * DURATION_SECONDS;
  const plates = [];
  for (let index = 0; index < COUNT; index += 1) {
    const progress = plateProgress(index, time);
    const ease = progress;
    const x = lerp(startX(index), finalX(index), ease);
    const z = lerp(START.z, finalZ(index), ease);
    const lift = Math.sin(Math.PI * ease) * (0.16 + 0.03 * index);
    const y = BASE_Y + lift;
    const yawDeg = lerp(START.yawDeg, FINAL_STACK.yawDeg * (index - (COUNT - 1) / 2), ease);
    plates.push(
      deepFreeze({
        index,
        progress: round6(progress),
        ease: round6(ease),
        position: [round6(x), round6(y), round6(z)],
        yawDeg: round6(yawDeg),
        yawRad: round6(yawDeg * DEG),
        layer: 'plate-' + index,
        bottomEdgeOnFloor: progress === 0,
        final: progress === 1,
      }),
    );
  }
  const allDone = plates.every((plate) => plate.final);
  return deepFreeze({
    time: round6(time),
    duration: DURATION_SECONDS,
    phase: allDone ? 'settled' : time <= 0 ? 'start' : 'gather',
    complete: allDone,
    plates,
  });
}

/** Reduced-motion state: the final stack, no animation. */
export function brandplateReducedMotionPose() {
  return brandplatePose(DURATION_SECONDS);
}

/* ------------------------------------------------------------------------- */
/* Plate corner geometry + projection (for camera fit and verifier)          */
/* ------------------------------------------------------------------------- */

/** World-space front-face corners of a plate pose (used for camera fit). */
export function plateCorners(plate, inset = 0) {
  const half = PLATE.size / 2 - inset;
  const corners = [];
  const yaw = plate.yawRad || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const localX = sx * half;
    const localZ = PLATE.thickness / 2;
    corners.push([
      plate.position[0] + localX * cos + localZ * sin,
      plate.position[1] + sy * half,
      plate.position[2] - localX * sin + localZ * cos,
    ]);
  }
  return corners;
}

/** Axis-aligned world bounds of a whole pose. */
export function poseBounds(pose) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const plate of pose.plates) {
    for (const corner of plateCorners(plate)) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], corner[axis]);
        max[axis] = Math.max(max[axis], corner[axis]);
      }
    }
  }
  return deepFreeze({
    min: min.map(round6),
    max: max.map(round6),
    center: min.map((value, axis) => round6((value + max[axis]) / 2)),
    size: min.map((value, axis) => round6(max[axis] - value)),
  });
}

export const START_BOUNDS = poseBounds(brandplatePose(0));
export const FINAL_BOUNDS = poseBounds(brandplatePose(DURATION_SECONDS));
const COMP_MIN = [Math.min(START_BOUNDS.min[0], FINAL_BOUNDS.min[0]), Math.min(START_BOUNDS.min[1], FINAL_BOUNDS.min[1]), Math.min(START_BOUNDS.min[2], FINAL_BOUNDS.min[2])];
const COMP_MAX = [Math.max(START_BOUNDS.max[0], FINAL_BOUNDS.max[0]), Math.max(START_BOUNDS.max[1], FINAL_BOUNDS.max[1]), Math.max(START_BOUNDS.max[2], FINAL_BOUNDS.max[2])];
export const COMPOSITION_BOUNDS = deepFreeze({
  min: COMP_MIN.map(round6),
  max: COMP_MAX.map(round6),
  center: [0, BASE_Y, 0].map(round6),
  size: COMP_MIN.map((value, axis) => round6(COMP_MAX[axis] - value)),
});

/**
 * Deterministic hero camera that fits the whole gather for a given stage size.
 * Same fit for both start row and final stack (the widest state wins).
 */
export function cameraFit(stageWidth = 1440, stageHeight = 900) {
  const fov = CAMERA.fovDeg * DEG;
  const tanHalf = Math.tan(fov / 2);
  const aspect = stageWidth / stageHeight;
  const halfWidth = Math.max(Math.abs(COMPOSITION_BOUNDS.min[0]), Math.abs(COMPOSITION_BOUNDS.max[0]));
  const halfHeight = Math.max(Math.abs(COMPOSITION_BOUNDS.min[1] - CAMERA.target[1]), Math.abs(COMPOSITION_BOUNDS.max[1] - CAMERA.target[1]));
  const distanceForWidth = (halfWidth * CAMERA.fitMargin) / (tanHalf * aspect);
  const distanceForHeight = (halfHeight * CAMERA.fitMargin) / tanHalf;
  const distance = Math.max(distanceForWidth, distanceForHeight, 4.2);
  const elevation = CAMERA.elevationDeg * DEG;
  const position = [
    0,
    CAMERA.target[1] + distance * Math.sin(elevation),
    distance * Math.cos(elevation),
  ];
  return deepFreeze({
    fovDeg: CAMERA.fovDeg,
    fov,
    elevationDeg: CAMERA.elevationDeg,
    distance: round6(distance),
    target: CAMERA.target.slice(),
    position: position.map(round6),
    near: CAMERA.near,
    far: CAMERA.far,
    stage: { width: stageWidth, height: stageHeight },
    aspect: round6(aspect),
    fitMargin: CAMERA.fitMargin,
    fit: distanceForWidth >= distanceForHeight ? 'width' : 'height',
  });
}

/** Project a world point to CSS pixels (origin top-left) for a cameraFit result. */
export function projectPoint(worldPoint, camera = cameraFit()) {
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

/** Projected CSS-pixel bounds of a pose (for camera-fit checks). */
export function projectedBounds(pose, camera) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const plate of pose.plates) {
    for (const corner of plateCorners(plate)) {
      const [x, y] = projectPoint(corner, camera);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return deepFreeze({ min: [round6(minX), round6(minY)], max: [round6(maxX), round6(maxY)] });
}

/* ------------------------------------------------------------------------- */
/* Frozen public contract                                                    */
/* ------------------------------------------------------------------------- */

export const BRANDPLATE = deepFreeze({
  mode: 'brandplate',
  provisional: true,
  provisionalNote: 'References missing: provisional silver satin plates, TEKO logo and the black-mirror-metal card-frame family.',
  count: COUNT,
  plate: PLATE,
  frame: FRAME,
  logo: LOGO,
  silver: SILVER,
  blackMirror: BLACK_MIRROR,
  layout: LAYOUT,
  camera: CAMERA,
  start: START,
  final: FINAL_STACK,
  baseY: BASE_Y,
  bounds: COMPOSITION_BOUNDS,
  startBounds: START_BOUNDS,
  finalBounds: FINAL_BOUNDS,
  reducedMotion: { final: true, time: DURATION_SECONDS },
  shotTimes: LAYOUT.shotTimes,
  labels: {
    title: 'Silver brand square plate',
    subtitle: 'Provisional',
    badge: 'PROVISIONAL',
    note: 'Reference images missing (not attached). This provisional build uses silver satin plates, the TEKO brand logo and the black-mirror-metal middle frame from the card (R15-1).',
  },
});

export const BRANDPLATE_COMPOSITION = BRANDPLATE;

/* Small vector helpers (shared with the projection above). */
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
