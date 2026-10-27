/**
 * coin-parade.js — pure deterministic composition & timeline math for the
 * tekoanimation coin Parade mode (SPEC "Collection Revision 14").
 *
 * This module is deliberately dependency-free: no three.js, no DOM, no clocks,
 * no Math.random. Everything is a closed-form function of the playback time, so
 * the 12 s loop is exact and the same seconds always produce the same pose.
 *
 * Composition (matches the Revolut coin-carousel reference):
 *  - 7 coins on a vertical carousel ring, evenly spaced, standing upright, coin
 *    faces pointing radially outward (the coin model's +Y face normal is mapped
 *    to the world radial direction, its textured "up" to world +Y).
 *  - the ring turns one full turn per 12 s loop; every coin additionally spins
 *    about its own vertical diameter with a 3 s period (4 turns per loop) and a
 *    fixed, evenly distributed phase. Both motions are exactly periodic over the
 *    loop, so paradePose(t + 12) === paradePose(t).
 *  - camera: long-lens (13.5 deg) with a 3 deg elevation, deterministic fit to
 *    the stage aspect.
 */

const TAU = Math.PI * 2;

/** coin model geometry constants the composition relies on (coin radius units) */
const COIN_RADIUS = 1.0;
const COIN_THICKNESS = 0.16;

const COUNT = 7;
const IDS = ['gbp', 'eur', 'cny', 'usd', 'vnd', 'php', 'thb'];
const DURATION_SECONDS = 12;
const SPIN_PERIOD_SECONDS = 3; // divides 12 s: exact loop seam
const RING_TURNS_PER_LOOP = 1;

/** minimum ring radius so neighbouring coins never interpenetrate: r >= 1/sin(pi/n) * 1.06 */
const MIN_RING_RADIUS = (1 / Math.sin(Math.PI / COUNT)) * 1.06; // ~2.443
const RING_RADIUS = 2.5; // > minimum, leaves ~0.06 coin-radius clearance between neighbours
const NEIGHBOUR_CLEARANCE = 2 * RING_RADIUS * Math.sin(Math.PI / COUNT) - 2 * COIN_RADIUS;

const START_ANGLE = Math.PI / 2; // coin 0 sits at the front of the ring at t = 0
const RING_DIRECTION = -1; // clockwise when seen from above
const SPIN_DIRECTION = 1;

/**
 * Evenly distributed fixed spin phases (one per coin, spaced TAU/7 apart).
 * A small common offset (~20.6 deg) chooses the t=0 mix: the front coin is
 * almost face-on while the right-front neighbour is almost edge-on, so the
 * deterministic shot frame shows the reference's face/edge mix.
 */
const SPIN_PHASE_OFFSET = 0.36;
// The phases are handed out in reverse index order: the fixed evenly spaced set
// {offset - i*TAU/7} makes the coins' face normals spread across the camera arc
// at t=0 (front coin nearly face-on, left-front neighbour nearly edge-on, ...).
// Using the mirrored order (offset + i*TAU/7) would make the spin phase cancel
// the ring angle and every coin would face the same direction.
const SPIN_PHASES = Object.freeze(IDS.map((id, index) => SPIN_PHASE_OFFSET - (index * TAU) / COUNT));

/**
 * Full Parade contract, frozen. All visual/material tuning used by the page and
 * the studio module is exposed here so the look can be audited in one place.
 */
export const PARADE = Object.freeze({
  version: '1.0.0',
  count: COUNT,
  ids: Object.freeze(IDS.slice()),
  durationSeconds: DURATION_SECONDS,
  faceSize: 512,
  shotTime: 0,
  loopSeamEpsilon: 1e-9,
  ring: Object.freeze({
    radius: RING_RADIUS,
    minRadius: MIN_RING_RADIUS,
    neighbourClearance: NEIGHBOUR_CLEARANCE,
    direction: RING_DIRECTION,
    turnsPerLoop: RING_TURNS_PER_LOOP,
    startAngle: START_ANGLE,
  }),
  spin: Object.freeze({
    periodSeconds: SPIN_PERIOD_SECONDS,
    direction: SPIN_DIRECTION,
    phases: SPIN_PHASES,
    phaseOffset: SPIN_PHASE_OFFSET,
    spinsPerLoop: DURATION_SECONDS / SPIN_PERIOD_SECONDS,
  }),
  camera: Object.freeze({
    fovDeg: 13.5, // long lens, 13-15 deg as in the reference
    elevationDeg: 3.0, // low elevation, 2-4 deg
    fitMargin: 1.04,
    targetY: 0.05,
    nearCoinHeightFraction: 0.78, // desired front-coin diameter as a fraction of stage height
    frontCoinMaxHalfWidth: 0.86, // front coin must stay inside {0.86} of the half width on narrow stages
    lift: 0.05, // target height above the ring plane
  }),
  depth: Object.freeze({
    fogColor: '#000000',
    // fog distances are expressed as factors of the camera distance so the
    // far-arc dimming stays identical for every stage aspect
    fadeNear: 1.0,
    fadeFar: 1.9,
  }),
  look: Object.freeze({
    background: '#000000',
    toneMappingExposure: 1.05,
    coinRadius: COIN_RADIUS,
    thickness: COIN_THICKNESS,
  }),
});

/**
 * Fold an arbitrary time into the 12 s loop: [0, duration).
 * @param {number} seconds
 * @returns {number}
 */
export function paradeLoopTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 0;
  let time = value % DURATION_SECONDS;
  if (time < 0) time += DURATION_SECONDS;
  if (time === DURATION_SECONDS) time = 0; // guard -0 / rounding
  return time === 0 ? 0 : time;
}

/** Ring rotation angle (radians) for a loop time. */
export function paradeRingAngle(loopTime) {
  return RING_DIRECTION * TAU * ((loopTime / DURATION_SECONDS) * RING_TURNS_PER_LOOP);
}

/** Common spin angle (radians) for a loop time; per-coin phase is added on top. */
export function paradeSpinAngle(loopTime) {
  return SPIN_DIRECTION * TAU * (loopTime / SPIN_PERIOD_SECONDS);
}

/* ------------------------------- quaternion math -------------------------- */

function quatMultiply(a, b) {
  // a * b (apply b first, then a), both in [x, y, z, w] form
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatFromUnitYaw(angle) {
  const half = angle * 0.5;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/**
 * Quaternion that turns the coin group's local frame into the world so that:
 *   local +Y (face normal) -> world radial direction (cos a, 0, sin a)
 *   local -Z (textured up on face A) -> world +Y
 * i.e. the coin stands upright with its face pointing radially outward.
 * Built from the orthonormal basis columns X' = (sin a, 0, -cos a),
 * Y' = (cos a, 0, sin a), Z' = (0, -1, 0).
 */
function quatFacingRadially(angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const m00 = sin, m01 = cos, m02 = 0;
  const m10 = 0, m11 = 0, m12 = -1;
  const m20 = -cos, m21 = sin, m22 = 0;
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const length = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  return [x / length, y / length, z / length, w / length];
}

/* ------------------------- back-face roll correction ---------------------- */
/*
 * The coin's two faces are authored with opposite local "up" axes (face A's
 * texture up is local -Z, face B's is local +Z) so either face reads upright in
 * the hero flip (coin group Rx(pi/2) shows A, Rx(3pi/2) shows B). In Parade the
 * coin is oriented upright-radial (face A up = world +Y), so while the BACK
 * face is the one toward the camera its symbol would be upside down. The fix is
 * a half-turn ROLL about the coin's own face-normal axis, applied only while
 * the back face is visible:
 *
 *   q = Ry(spin) * Rx(pi/2) * Ry(roll)   with roll = pi when back, 0 when front
 *   (basis form here: q = Ry(spin) * qFacingRadially(angle) * Ry(roll))
 *
 * The roll is a pure in-plane rotation of the coin, so it is invisible exactly
 * when the coin is edge-on (the reeded band also has an even ridge count, so its
 * pattern maps onto itself under the half-turn). That is where the front/back
 * switch happens; the threshold is the coin face normal becoming perpendicular
 * to the camera axis (+Z), i.e. the deterministic ring test cos(ringAngle+spin)
 * crossing zero.
 */
function rotateByQuaternion(quaternion, vector) {
  const x = quaternion[0], y = quaternion[1], z = quaternion[2], w = quaternion[3];
  const vx = vector[0], vy = vector[1], vz = vector[2];
  return [
    2 * (vx * (0.5 - y * y - z * z) + vy * (x * y - w * z) + vz * (x * z + w * y)),
    2 * (vx * (x * y + w * z) + vy * (0.5 - x * x - z * z) + vz * (y * z - w * x)),
    2 * (vx * (x * z - w * y) + vy * (y * z + w * x) + vz * (0.5 - x * x - y * y)),
  ];
}

/** deterministic face visibility: back face is toward the camera when the A normal points away from +Z */
function facingForQuaternion(quaternion) {
  const normalA = rotateByQuaternion(quaternion, [0, 1, 0]);
  return normalA[2] < 0 ? 'b' : 'a';
}

/* ---------------------------------- pose ---------------------------------- */

/**
 * Deterministic Parade pose for a playback time.
 * @param {number} seconds
 * @returns {{time:number, loopTime:number, ringAngle:number, spinAngle:number,
 *   coins: Array<{id:string,index:number,angle:number,spin:number,position:number[],quaternion:number[]}>}}
 */
export function paradePose(seconds) {
  const loopTime = paradeLoopTime(seconds);
  const ringAngle = paradeRingAngle(loopTime);
  const spinAngle = paradeSpinAngle(loopTime);
  const radius = PARADE.ring.radius;
  const coins = IDS.map((id, index) => {
    const angle = START_ANGLE + (index * TAU) / COUNT + ringAngle;
    const spin = spinAngle + PARADE.spin.phases[index];
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    // upright, face radial; spin about the world vertical through the coin centre
    const noRoll = quatMultiply(quatFromUnitYaw(spin), quatFacingRadially(angle));
    // which authored face is toward the camera, and the in-plane half-turn roll
    // that keeps the visible symbol upright (jump happens only at edge-on)
    const facing = facingForQuaternion(noRoll);
    const roll = facing === 'b' ? Math.PI : 0;
    const quaternion = roll === 0 ? noRoll : quatMultiply(noRoll, quatFromUnitYaw(roll));
    return Object.freeze({
      id,
      index,
      angle,
      spin,
      facing,
      roll,
      position: Object.freeze([x, 0, z]),
      quaternion: Object.freeze(quaternion),
    });
  });
  return Object.freeze({
    // wrapped loop timestamp: pose(t + 12) is deeply identical to pose(t)
    time: loopTime,
    loopTime,
    ringAngle,
    spinAngle,
    coins: Object.freeze(coins),
  });
}

/**
 * Conservative world-space bounds of the whole carousel (all motions).
 * @returns {{min:number[], max:number[], center:number[], size:number[]}}
 */
export function paradeBounds() {
  const reach = PARADE.ring.radius + COIN_RADIUS + 0.1; // upright coin radius + margin (thickness included)
  const halfHeight = COIN_RADIUS + 0.1;
  const min = [-reach, -halfHeight, -reach];
  const max = [reach, halfHeight, reach];
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
    center: Object.freeze([0, 0, 0]),
    size: Object.freeze([max[0] - min[0], max[1] - min[1], max[2] - min[2]]),
  });
}

/**
 * Deterministic telephoto camera pose that fits the stage aspect ratio.
 * The front coin is always fully inside the frame with margin; on narrow
 * (mobile) stages the camera pulls back so the front coin's width fits too;
 * the far left/right coins may crop, as in the reference.
 * @param {number} aspect stage width / height
 * @returns {{fovDeg:number, fov:number, aspect:number, distance:number,
 *   position:number[], target:number[], elevationDeg:number, fitMargin:number,
 *   nearCoinHeightFraction:number}}
 */
export function paradeCameraPose(aspect) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 16 / 9;
  const fovDeg = PARADE.camera.fovDeg;
  const fov = (fovDeg * Math.PI) / 180;
  const tanHalf = Math.tan(fov * 0.5);
  const ringRadius = PARADE.ring.radius;
  const frontCoinCenterZ = ringRadius; // coin 0 at the front
  const frontCoinFrontZ = ringRadius + COIN_RADIUS; // its outermost point toward the camera

  // 1) the front coin must fit vertically, with a small world margin
  const halfHeight = COIN_RADIUS + 0.1;
  const distanceVertical = halfHeight / tanHalf + frontCoinFrontZ;

  // 2) the front coin must fit horizontally on narrow stages
  const distanceHorizontal = 1 / (PARADE.camera.frontCoinMaxHalfWidth * tanHalf * safeAspect) + frontCoinCenterZ;

  // 3) desired near-coin size for the full-bleed carousel look
  const distanceSize = 1 / (PARADE.camera.nearCoinHeightFraction * tanHalf) + frontCoinCenterZ;

  const distance = Math.max(PARADE.camera.minDistance || 8, distanceVertical, distanceHorizontal, distanceSize) * PARADE.camera.fitMargin;
  const elevation = (PARADE.camera.elevationDeg * Math.PI) / 180;
  const targetY = PARADE.camera.targetY;
  const position = [0, targetY + distance * Math.sin(elevation), distance * Math.cos(elevation)];
  const nearCoinHeightFraction = 1 / ((distance - frontCoinCenterZ) * tanHalf);

  return Object.freeze({
    fovDeg,
    fov,
    aspect: safeAspect,
    distance,
    position: Object.freeze(position),
    target: Object.freeze([0, targetY, 0]),
    elevationDeg: PARADE.camera.elevationDeg,
    fitMargin: PARADE.camera.fitMargin,
    nearCoinHeightFraction,
  });
}

/**
 * Ring spacing report used by the verifier and the page debug API.
 * @returns {{count:number, chord:number, coinDiameter:number, clearance:number, minRadius:number, radius:number}}
 */
export function paradeRingSpacing() {
  const chord = 2 * PARADE.ring.radius * Math.sin(Math.PI / COUNT);
  return Object.freeze({
    count: COUNT,
    chord,
    coinDiameter: 2 * COIN_RADIUS,
    clearance: chord - 2 * COIN_RADIUS,
    minRadius: MIN_RING_RADIUS,
    radius: PARADE.ring.radius,
  });
}
