/**
 * tekoanimation — pure arcball / quaternion math for the free trackball view.
 *
 * Deliberately dependency-free: no three.js import, no DOM, no `Math.random`
 * and no clock. Every function is deterministic, side-effect free and returns
 * plain arrays/objects so it can be unit-tested under plain Node and reused by
 * QA harnesses.
 *
 * Conventions (matching three.js / THREE.Quaternion):
 *  - a quaternion is a plain `[x, y, z, w]` array;
 *  - `quatMultiply(a, b)` is the Hamilton product `a ⊗ b`, i.e. the rotation
 *    `a` is applied *after* `b`;
 *  - rotations are right-handed, column vectors, `+Z` towards the viewer, so a
 *    positive rotation about `+Y` turns the rig right and a positive rotation
 *    about `+X` tips its top towards the viewer;
 *  - degeneracy (zero-length axes, non-finite numbers, antipodal sphere points)
 *    is guarded and never produces NaN.
 *
 * The arcball maps normalized stage coordinates (`[-1, 1]`, y up) onto a unit
 * sphere; a pointer move becomes the camera-space delta rotation that carries
 * the previous sphere point onto the current one. Composing those deltas by
 * pre-multiplication reaches the full SO(3), so there is no gimbal lock and no
 * Euler clamp anywhere in the view path.
 */

/** Tuning shared with scene.js (plain data; keep in sync with the scene feel). */
export const TRACKBALL = Object.freeze({
  dragEase: 24, // 1/s — current quaternion eases towards the target while dragging
  releaseEase: 12, // 1/s — easing after release / at rest
  reducedEase: 60, // 1/s — minimal easing under prefers-reduced-motion
  inertiaDamping: 8, // 1/s exponential damping of the release angular velocity
  inertiaMaxSpeed: 1.8, // rad/s — release inertia cap
  inertiaStopSpeed: 0.06, // rad/s — below this the inertia stops
  snapAngle: 0.0008, // rad — snap current onto the target once this close
  identity: Object.freeze([0, 0, 0, 1]),
});

const EPS = 1e-12;
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const finite = (value, fallback = 0) => (isNum(value) ? value : fallback);
const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

/** Read any array-like quaternion defensively; missing/garbage entries become 0. */
function readQuat(q) {
  const source = q || [];
  return [
    finite(source[0]),
    finite(source[1]),
    finite(source[2]),
    finite(source[3]),
  ];
}

/**
 * Project normalized stage coordinates onto the unit (virtual) sphere.
 * Points inside the unit disc land on the front hemisphere; points outside are
 * clamped radially onto the equator (the classic hyperbolic arcball sheet).
 * @param {number} x normalized [-1, 1] (screen x, right positive)
 * @param {number} y normalized [-1, 1] (screen y, up positive)
 * @returns {[number, number, number]} unit-length sphere point
 */
export function clampToSphere(x, y) {
  let px = finite(x);
  let py = finite(y);
  const d = px * px + py * py;
  if (d > 1) {
    const inv = 1 / Math.sqrt(d);
    px *= inv;
    py *= inv;
    return [px, py, 0];
  }
  return [px, py, Math.sqrt(Math.max(0, 1 - d))];
}

/**
 * Quaternion for a rotation of `angle` radians about the axis (ax, ay, az).
 * A zero/degenerate axis collapses to the identity instead of NaN.
 * @returns {[number, number, number, number]}
 */
export function axisAngleToQuat(ax, ay, az, angle) {
  const x = finite(ax);
  const y = finite(ay);
  const z = finite(az);
  const a = finite(angle);
  const length = Math.hypot(x, y, z);
  if (!(length > EPS) || Math.abs(a) <= EPS) return [0, 0, 0, 1];
  const inv = 1 / length;
  const half = a / 2;
  const s = Math.sin(half);
  return [x * inv * s, y * inv * s, z * inv * s, Math.cos(half)];
}

/**
 * Hamilton product `a ⊗ b` — rotation `a` applied after rotation `b`.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {[number, number, number, number]}
 */
export function quatMultiply(a, b) {
  const ax = finite(a && a[0]);
  const ay = finite(a && a[1]);
  const az = finite(a && a[2]);
  const aw = finite(a && a[3], 1);
  const bx = finite(b && b[0]);
  const by = finite(b && b[1]);
  const bz = finite(b && b[2]);
  const bw = finite(b && b[3], 1);
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * Normalize a quaternion to unit length (degenerate input -> identity).
 * @returns {[number, number, number, number]}
 */
export function quatNormalize(q) {
  const [x, y, z, w] = readQuat(q);
  const length = Math.hypot(x, y, z, w);
  if (!(length > EPS)) return [0, 0, 0, 1];
  const inv = 1 / length;
  return [x * inv, y * inv, z * inv, w * inv];
}

/**
 * Shortest-arc spherical linear interpolation from `a` to `b`.
 * `t` is clamped to [0, 1]; endpoints are returned exactly and degenerate
 * input collapses to the identity side rather than NaN.
 * @returns {[number, number, number, number]}
 */
export function quatSlerp(a, b, t) {
  const qa = quatNormalize(a);
  let qb = quatNormalize(b);
  const tt = clamp(finite(t), 0, 1);
  if (tt <= 0) return qa;
  if (tt >= 1) return qb;
  let dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (dot < 0) {
    // q and -q describe the same rotation: take the short way round.
    qb = [-qb[0], -qb[1], -qb[2], -qb[3]];
    dot = -dot;
  }
  dot = clamp(dot, -1, 1);
  if (dot > 0.9995) {
    // Nearly identical: normalized lerp is both stable and accurate.
    return quatNormalize([
      qa[0] + (qb[0] - qa[0]) * tt,
      qa[1] + (qb[1] - qa[1]) * tt,
      qa[2] + (qb[2] - qa[2]) * tt,
      qa[3] + (qb[3] - qa[3]) * tt,
    ]);
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  if (!(Math.abs(sinTheta) > EPS)) return qa.slice();
  const w0 = Math.sin((1 - tt) * theta) / sinTheta;
  const w1 = Math.sin(tt * theta) / sinTheta;
  return quatNormalize([
    qa[0] * w0 + qb[0] * w1,
    qa[1] * w0 + qb[1] * w1,
    qa[2] * w0 + qb[2] * w1,
    qa[3] * w0 + qb[3] * w1,
  ]);
}

/**
 * Shortest rotation angle of `q` relative to the identity, in [0, π].
 * `q` and `-q` are the same rotation, hence the `|w|`.
 * @returns {number}
 */
export function quatAngle(q) {
  const n = quatNormalize(q);
  const w = clamp(Math.abs(n[3]), 0, 1);
  return 2 * Math.acos(w);
}

/**
 * Rotate the vector `v` by quaternion `q`.
 * @param {number[]} q
 * @param {number[]} v [x, y, z]
 * @returns {[number, number, number]}
 */
export function quatRotate(q, v) {
  const n = quatNormalize(q);
  const vx = finite(v && v[0]);
  const vy = finite(v && v[1]);
  const vz = finite(v && v[2]);
  const qx = n[0];
  const qy = n[1];
  const qz = n[2];
  const qw = n[3];
  // t = 2 * (qv × v); v' = v + w * t + qv × t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Quaternion for Euler angles in three.js order `'YXZ'` — i.e. the exact
 * rotation of `object.rotation.set(pitch, yaw, roll)` with order 'YXZ'
 * (`R = Ry(yaw) · Rx(pitch) · Rz(roll)`).
 * @param {number} yaw rotation about +Y
 * @param {number} pitch rotation about +X
 * @param {number} roll rotation about +Z
 * @returns {[number, number, number, number]}
 */
export function quatFromEulerYXZ(yaw, pitch, roll) {
  const x = finite(pitch);
  const y = finite(yaw);
  const z = finite(roll);
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  // Same formula as THREE.Quaternion.setFromEuler(..., 'YXZ').
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

/**
 * Euler 'YXZ' readout of `q` (informational only; the view itself is never
 * driven through this). Matches THREE.Euler.setFromQuaternion(q, 'YXZ').
 * @returns {{ yaw: number, pitch: number, roll: number }}
 */
export function quatToEulerYXZ(q) {
  const n = quatNormalize(q);
  const x = n[0];
  const y = n[1];
  const z = n[2];
  const w = n[3];
  const m11 = 1 - 2 * (y * y + z * z);
  const m13 = 2 * (x * z + w * y);
  const m21 = 2 * (x * y + w * z);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m31 = 2 * (x * z - w * y);
  const m33 = 1 - 2 * (x * x + y * y);
  const pitch = Math.asin(clamp(-m23, -1, 1));
  let yaw;
  let roll;
  if (Math.abs(m23) < 0.9999999) {
    yaw = Math.atan2(m13, m33);
    roll = Math.atan2(m21, m22);
  } else {
    // Gimbal lock: roll folds into yaw (readout only, rotation is unchanged).
    yaw = Math.atan2(-m31, m11);
    roll = 0;
  }
  return { yaw, pitch, roll };
}

/**
 * Arcball delta rotation for a pointer move, in camera space.
 *
 * `prevX/prevY` and `curX/curY` are normalized stage coordinates in [-1, 1]
 * with y pointing up. Both are projected onto the virtual unit sphere; the
 * returned quaternion is the shortest rotation carrying the previous sphere
 * point onto the current one (axis = normalized cross product, angle = the
 * geodesic angle between them). Pre-multiply the view quaternion with it to
 * rotate the composition the way the pointer moved.
 *
 * Degenerate cases: identical points -> identity; antipodal points (a full
 * diameter drag) -> a deterministic π rotation about an axis perpendicular to
 * the start point, so a full-width swipe still turns the view by π.
 * @returns {[number, number, number, number]}
 */
export function arcballDelta(prevX, prevY, curX, curY) {
  const p0 = clampToSphere(prevX, prevY);
  const p1 = clampToSphere(curX, curY);
  const dot = clamp(p0[0] * p1[0] + p0[1] * p1[1] + p0[2] * p1[2], -1, 1);
  const cx = p0[1] * p1[2] - p0[2] * p1[1];
  const cy = p0[2] * p1[0] - p0[0] * p1[2];
  const cz = p0[0] * p1[1] - p0[1] * p1[0];
  const length = Math.hypot(cx, cy, cz);
  if (length > 1e-9) {
    const angle = Math.atan2(length, dot);
    return axisAngleToQuat(cx / length, cy / length, cz / length, angle);
  }
  if (dot >= 0) return [0, 0, 0, 1]; // same point
  // Antipodal: the cross product vanished mid-drag (exact 180° step). Both
  // points are necessarily on the equator (clampToSphere keeps z >= 0), so a
  // deterministic axis perpendicular to p0 that matches the small-step limit
  // along the front sheet is p0 × +Z: horizontal drags then read as the
  // intuitive half turn about ±Y.
  let ax = p0[1];
  let ay = -p0[0];
  let az = 0;
  if (!(Math.hypot(ax, ay, az) > 1e-9)) {
    ax = 1;
    ay = 0;
  }
  const axisLength = Math.hypot(ax, ay, az);
  return axisAngleToQuat(ax / axisLength, ay / axisLength, az / axisLength, Math.PI);
}
