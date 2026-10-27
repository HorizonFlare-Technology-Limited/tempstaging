/**
 * tekoanimation — Wave composition math: the broad twisted ribbon/wave band and
 * the coins that stand/roll on it (round 6, reference `refs/round6/coin-wave.png`).
 *
 * Pure, deterministic geometry only: no three.js import, no DOM, no Math.random,
 * no clock. `src/preview.js` feeds `WAVE.ribbon.geometry` into a BufferGeometry
 * and `WAVE.coins` into the studio's presentation rig; it builds the materials
 * and lights itself (`src/coin-wave-scene.js`). Everything that decides the
 * look of the composition is therefore verifiable offline by
 * `tools/verify-wave.mjs`.
 *
 * What the composition is
 * -----------------------
 * The reference is a single broad satin-silver ribbon folded into a wave: its
 * top face is brushed metal, its underside is dark blue/violet glass, the long
 * edges carry a polished silver rim, and one accent light (orange in the
 * reference, brand gold on the page) grazes the near rim. Three silver coins
 * stand on edge on the ribbon as if caught mid-roll, facing the camera. This
 * module reproduces the GEOMETRY of that composition:
 *
 *  - `WAVE.ribbon`: a swept stadium-section ribbon (half width 1.6, half
 *    thickness 0.045) along a Catmull-Rom wave path. Frames are parallel-
 *    transported along the path (no artificial roll), then twisted about the
 *    tangent by `twistAt(t)`: -1.8 rad at the left end (so the blue underside
 *    turns to face the camera as the broad blue sweep), unwinding through an
 *    edge-on line to +0.78..+0.86 rad where the coins stand (so the brushed
 *    silver top face is the stage and tilts toward the camera). The twist makes
 *    the single ribbon read as both the blue band and the silver band of the
 *    reference, separated by the polished rim.
 *  - The section is a stadium (flat faces + semicircular long edges), so the
 *    ribbon is a closed watertight solid: silver top face group, blue underside
 *    face group, polished rim groups at both long edges. The returned geometry
 *    is a flat index/position/normal/uv buffer plus per-material index groups.
 *  - `WAVE.coins`: 4 coins (GBP/EUR/USD/CNY, one different symbol each — the
 *    catalog has no RUB) resting on the silver top face at different points
 *    across the band, facing a fixed presentation camera (elevation 20 deg)
 *    with small deterministic yaw/roll differences. Each coin is placed so its
 *    lowest rim point sits exactly on the ribbon top surface (minus a small
 *    authored sink), i.e. it is genuinely standing on the band.
 *  - `WAVE.metrics`: ribbon bounds, coin-contact error and minimum coin-coin
 *    surface clearance, so the verifier can assert "on the band" and "no
 *    interpenetration" without the browser.
 *
 * Coordinate conventions
 * ----------------------
 * Composition space equals world space (the page applies no group transform
 * before the studio orbit group). Coin model local +Y is the face normal and
 * local -Z is the symbol's up direction, exactly as `coin-compositions.js`
 * documents; a coin's `quaternion` is therefore the orientation of the coin
 * model group and `position` is its centre.
 */

export const COIN_GEOMETRY = Object.freeze({
  radius: 1,
  thickness: 0.16,
  halfThickness: 0.08,
});

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const HALF_PI = Math.PI / 2;

const clamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
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
/* Small pure vector / quaternion helpers (quaternions are [x, y, z, w])     */
/* ------------------------------------------------------------------------- */

function vecAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function vecScale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function vecDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function vecCross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function vecLength(a) {
  return Math.sqrt(vecDot(a, a));
}
function vecNormalize(a) {
  const length = vecLength(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

function quatAxisAngle(ax, ay, az, angle) {
  const length = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
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

function quatNormalize(q) {
  const length = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function quatRotate(q, v) {
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  const qw = q[3];
  const vx = v[0];
  const vy = v[1];
  const vz = v[2];
  const cx = qy * vz - qz * vy;
  const cy = qz * vx - qx * vz;
  const cz = qx * vy - qy * vx;
  const ccx = qy * cz - qz * cy;
  const ccy = qz * cx - qx * cz;
  const ccz = qx * cy - qy * cx;
  return [
    vx + 2 * (qw * cx + ccx),
    vy + 2 * (qw * cy + ccy),
    vz + 2 * (qw * cz + ccz),
  ];
}

/** Rotation matrix with columns (xAxis, yAxis, zAxis) -> quaternion [x,y,z,w]. */
function quatFromBasis(xAxis, yAxis, zAxis) {
  const m00 = xAxis[0];
  const m10 = xAxis[1];
  const m20 = xAxis[2];
  const m01 = yAxis[0];
  const m11 = yAxis[1];
  const m21 = yAxis[2];
  const m02 = zAxis[0];
  const m12 = zAxis[1];
  const m22 = zAxis[2];
  const trace = m00 + m11 + m22;
  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2; // 4w
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2; // 4x
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2; // 4y
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2; // 4z
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return quatNormalize([x, y, z, w]);
}

/* ------------------------------------------------------------------------- */
/* Tuning block                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Wave tuning block. Lengths are in composition/world units (coin radius 1.0,
 * thickness 0.16); the camera block mirrors the page's fov-30 deterministic
 * fit so the probe direction used for the coin orientations matches the render.
 */
const WAVE_SPEC = Object.freeze({
  /** 3-5 coins, one different symbol each (reference shows three). */
  ids: Object.freeze(['gbp', 'eur', 'usd', 'cny']),
  coinScale: 1.0,
  faceSize: 512,
  /** authored sink of each coin's lowest rim point below the band surface */
  coinSink: 0.03,
  camera: Object.freeze({ elevationDeg: 20, fitMargin: 1.05, probeDistance: 18 }),
  ribbon: Object.freeze({
    /**
     * Catmull-Rom control points, left -> right. The path holds the reference's
     * long S: high at the left (the blue back face), through a trough just left
     * of the coins, then a steady rise to the upper right under the silver face.
     */
    controlPoints: Object.freeze([
      Object.freeze([-6.6, 1.7, -1.3]),
      Object.freeze([-5.0, 1.05, -1.4]),
      Object.freeze([-3.0, 0.05, -1.0]),
      Object.freeze([-0.9, -0.75, -0.1]),
      Object.freeze([1.6, -0.55, 0.9]),
      Object.freeze([3.9, 0.0, 0.2]),
      Object.freeze([5.7, 0.9, -0.9]),
      Object.freeze([7.0, 1.65, -2.0]),
    ]),
    /** samples along the path (vertices along the ribbon = samples) */
    samples: 240,
    /** stadium section: total width 2 * halfWidth, thickness 2 * halfThickness */
    halfWidth: 1.6,
    halfThickness: 0.045,
    /** gentle crown on both flat faces (world units at the centre line) */
    crown: 0.012,
    /** subdivisions across each flat face and around each semicircular edge */
    faceSegments: 12,
    edgeSegments: 10,
    /** brushed-silver UVs repeat every `tileLength` world units along the band */
    tileLength: 2.5,
    /**
     * Twist about the tangent, piecewise-smoothstep between knots. NEGATIVE at
     * the left end: the blue underside then faces the camera as the broad blue
     * sweep, unwinding through the edge-on rim line to a strong POSITIVE twist
     * where the coins stand, tilting the brushed silver top face toward the
     * camera like the reference's broad ribbon surface.
     */
    twistKnots: Object.freeze([
      Object.freeze([0.0, -1.8]),
      Object.freeze([0.14, -1.4]),
      Object.freeze([0.28, -0.3]),
      Object.freeze([0.4, 0.55]),
      Object.freeze([0.5, 0.8]),
      Object.freeze([0.65, 0.86]),
      Object.freeze([0.8, 0.82]),
      Object.freeze([1.0, 0.78]),
    ]),
  }),
  /** Per-coin placement on the band: t along the ribbon, f across it (-1..1). */
  coins: Object.freeze([
    Object.freeze({ id: 'gbp', t: 0.44, f: -0.3, yawDeg: -8, rollDeg: 2.5, scale: 1.02 }),
    Object.freeze({ id: 'eur', t: 0.55, f: 0.04, yawDeg: 5, rollDeg: -3, scale: 0.98 }),
    Object.freeze({ id: 'usd', t: 0.66, f: 0.3, yawDeg: -4, rollDeg: 4, scale: 1.0 }),
    Object.freeze({ id: 'cny', t: 0.77, f: -0.14, yawDeg: 9, rollDeg: -1.5, scale: 0.96 }),
  ]),
});

/* ------------------------------------------------------------------------- */
/* Wave path + frames                                                        */
/* ------------------------------------------------------------------------- */

/** Uniform Catmull-Rom sample of the control polygon (endpoints duplicated). */
function samplePath(controlPoints, t) {
  const last = controlPoints.length - 1;
  const u = clamp(t, 0, 1) * last;
  const index = Math.min(Math.floor(u), last - 1);
  const local = u - index;
  const p0 = controlPoints[Math.max(0, index - 1)];
  const p1 = controlPoints[index];
  const p2 = controlPoints[index + 1];
  const p3 = controlPoints[Math.min(last, index + 2)];
  const t2 = local * local;
  const t3 = t2 * local;
  const out = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    out[axis] =
      0.5 *
      (2 * p1[axis] +
        (-p0[axis] + p2[axis]) * local +
        (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
        (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3);
  }
  return out;
}

/** Twist angle (radians) at path parameter t, smoothstep between the knots. */
function twistAt(t) {
  const knots = WAVE_SPEC.ribbon.twistKnots;
  const value = clamp(t, 0, 1);
  for (let index = 0; index < knots.length - 1; index += 1) {
    const [t0, a0] = knots[index];
    const [t1, a1] = knots[index + 1];
    if (value >= t0 && value <= t1) {
      const local = t1 > t0 ? (value - t0) / (t1 - t0) : 0;
      return lerp(a0, a1, smoothstep(local));
    }
  }
  return knots[knots.length - 1][1];
}

/**
 * Deterministic ribbon frames: positions along the Catmull-Rom wave, tangents
 * by central difference, a parallel-transported up vector (so the section does
 * not build up roll along the curve) and the twist about the tangent.
 */
function buildFrames(controlPoints, samples) {
  const frames = [];
  let distance = 0;
  let previous = null;
  // baseUp is the UNTWISTED parallel-transported section up: the twist is
  // applied on top of it for the stored frame, never accumulated step to step.
  let baseUp = null;
  for (let index = 0; index < samples; index += 1) {
    const t = samples === 1 ? 0 : index / (samples - 1);
    const position = samplePath(controlPoints, t);
    if (previous) distance += vecLength(vecSub(position, previous));
    previous = position;

    const dt = 1 / (samples - 1);
    const before = samplePath(controlPoints, Math.max(0, t - dt));
    const after = samplePath(controlPoints, Math.min(1, t + dt));
    let tangent = vecNormalize(vecSub(after, before));
    // guard a degenerate tangent near duplicated end control points
    if (!Number.isFinite(tangent[0]) || vecLength(tangent) < 1e-6) tangent = [1, 0, 0];

    if (!baseUp) {
      // initial section up: world up projected off the tangent
      baseUp = vecSub([0, 1, 0], vecScale(tangent, tangent[1]));
      if (vecLength(baseUp) < 1e-4) baseUp = vecSub([0, 0, 1], vecScale(tangent, tangent[2]));
      baseUp = vecNormalize(baseUp);
    } else {
      const previousTangent = frames[frames.length - 1].tangent;
      const axis = vecCross(previousTangent, tangent);
      const axisLength = vecLength(axis);
      if (axisLength >= 1e-9) {
        const angle = Math.acos(clamp(vecDot(previousTangent, tangent), -1, 1));
        const delta = quatAxisAngle(axis[0], axis[1], axis[2], angle);
        baseUp = quatRotate(delta, baseUp);
      }
      // re-orthonormalize against the new tangent
      baseUp = vecNormalize(vecSub(baseUp, vecScale(tangent, vecDot(baseUp, tangent))));
    }
    const baseSide = vecNormalize(vecCross(tangent, baseUp)); // right-handed (up, side, tangent)
    const twist = twistAt(t);
    const cosTwist = Math.cos(twist);
    const sinTwist = Math.sin(twist);
    // rotate the section about the tangent by the twist angle (applied once,
    // from the untwisted base frame)
    const up = vecNormalize(vecAdd(vecScale(baseUp, cosTwist), vecScale(baseSide, sinTwist)));
    const side = vecNormalize(vecCross(tangent, up));

    frames.push({
      t,
      position,
      tangent,
      up,
      side,
      twistRad: twist,
      distance,
    });
  }
  return frames;
}

/**
 * Interpolated frame at an arbitrary parameter t. Frames vary smoothly along
 * the ribbon, so component lerp + orthonormalization is stable here.
 */
export function waveFrameAt(t) {
  const frames = FRAMES;
  const value = clamp(Number(t) || 0, 0, 1);
  const scaled = value * (frames.length - 1);
  const index = Math.min(Math.floor(scaled), frames.length - 2);
  const frac = scaled - index;
  const a = frames[index];
  const b = frames[index + 1];
  const position = vecAdd(vecScale(a.position, 1 - frac), vecScale(b.position, frac));
  const tangent = vecNormalize(vecAdd(vecScale(a.tangent, 1 - frac), vecScale(b.tangent, frac)));
  const twist = lerp(a.twistRad, b.twistRad, frac);
  // both stored frames carry the same twist convention, so a component blend of
  // the section vectors is valid at the small per-sample twist step
  const up = vecNormalize(vecAdd(vecScale(a.up, 1 - frac), vecScale(b.up, frac)));
  const side = vecNormalize(vecCross(tangent, up));
  return {
    t: value,
    position,
    tangent,
    up: vecNormalize(vecSub(up, vecScale(tangent, vecDot(up, tangent)))),
    side,
    twistRad: twist,
    distance: lerp(a.distance, b.distance, frac),
  };
}

/* ------------------------------------------------------------------------- */
/* Ribbon section + geometry                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Stadium section across the band. Returns the closed ring of section points
 * (side, up coordinates), their outward normals, per-segment material indices
 * and the arc-length normalized coordinate used for the v UV.
 *
 * Segment material order: [silver top face] [rim right edge] [blue underside]
 * [rim left edge] — four contiguous index groups in the built geometry.
 */
function buildSection(halfWidth, halfThickness, faceSegments, edgeSegments, crown) {
  const h = halfThickness;
  const a = halfWidth - h;
  const points = [];
  const push = (side, up, normalSide, normalUp) => points.push({ side, up, normalSide, normalUp });

  // top face: -a -> +a (crowned)
  for (let k = 0; k <= faceSegments; k += 1) {
    const side = -a + (2 * a * k) / faceSegments;
    const ratio = side / a;
    const up = h + crown * (1 - ratio * ratio);
    const slope = (-2 * crown * ratio) / a;
    const length = Math.hypot(-slope, 1);
    push(side, up, -slope / length, 1 / length);
  }
  // right semicircular edge: top (+pi/2) -> bottom (-pi/2)
  for (let k = 1; k <= edgeSegments; k += 1) {
    const angle = HALF_PI - (Math.PI * k) / edgeSegments;
    push(a + h * Math.cos(angle), h * Math.sin(angle), Math.cos(angle), Math.sin(angle));
  }
  // bottom face: +a -> -a (crowned downwards)
  for (let k = 1; k <= faceSegments; k += 1) {
    const side = a - (2 * a * k) / faceSegments;
    const ratio = side / a;
    const up = -h - crown * (1 - ratio * ratio);
    const slope = (2 * crown * ratio) / a;
    const length = Math.hypot(slope, -1);
    push(side, up, slope / length, -1 / length);
  }
  // left semicircular edge: bottom (-pi/2) -> top (-3pi/2), excluding both ends
  for (let k = 1; k < edgeSegments; k += 1) {
    const angle = -HALF_PI - (Math.PI * k) / edgeSegments;
    push(-a + h * Math.cos(angle), h * Math.sin(angle), Math.cos(angle), Math.sin(angle));
  }

  const count = points.length;
  // arc length around the closed section (for v)
  let perimeter = 0;
  const arcs = [0];
  for (let index = 0; index < count; index += 1) {
    const next = points[(index + 1) % count];
    const point = points[index];
    perimeter += Math.hypot(next.side - point.side, next.up - point.up);
    arcs.push(perimeter);
  }

  const materialSegments = [
    { material: 0, start: 0, count: faceSegments }, // silver top
    { material: 2, start: faceSegments, count: edgeSegments }, // rim (right)
    { material: 1, start: faceSegments + edgeSegments, count: faceSegments }, // blue underside
    { material: 3, start: faceSegments + edgeSegments + faceSegments, count: edgeSegments }, // rim (left)
  ];

  return { points, count, arcs, perimeter, materialSegments };
}

/**
 * Build the ribbon mesh buffers: one vertex per (sample, section point), shared
 * by the four material groups; indices are emitted group-by-group so the page
 * can attach one material per group without duplicating vertices.
 */
/**
 * Rounded ribbon ends: the section narrows over the first/last `TAPER` of the
 * path so the band finishes in a soft sculpted tip instead of a flat cut face.
 * Coins live well inside this range, so their contact surface is unscaled.
 */
const RIBBON_TAPER = 0.055;
function ribbonTaperAt(t) {
  const edge = Math.min(t, 1 - t);
  if (edge >= RIBBON_TAPER) return 1;
  return 0.07 + 0.93 * smoothstep(edge / RIBBON_TAPER);
}

function buildRibbonGeometry(frames, section) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const groups = [];
  const tileLength = WAVE_SPEC.ribbon.tileLength;
  const pathLength = frames[frames.length - 1].distance || 1;
  // blue underside gradient: deep navy -> periwinkle highlight -> deep navy
  const blueStops = [
    [0.0, [0.07, 0.08, 0.2]],
    [0.26, [0.2, 0.23, 0.55]],
    [0.48, [0.42, 0.46, 0.95]],
    [0.72, [0.22, 0.25, 0.6]],
    [1.0, [0.07, 0.08, 0.2]],
  ];

  for (const frame of frames) {
    const ratio = frame.distance / pathLength;
    const taper = ribbonTaperAt(frame.t);
    let stop = 1;
    while (stop < blueStops.length - 1 && ratio > blueStops[stop][0]) stop += 1;
    const [t0, c0] = blueStops[stop - 1];
    const [t1, c1] = blueStops[stop];
    const blend = clamp((ratio - t0) / Math.max(1e-6, t1 - t0), 0, 1);
    const blue = [lerp(c0[0], c1[0], blend), lerp(c0[1], c1[1], blend), lerp(c0[2], c1[2], blend)];
    for (let index = 0; index < section.count; index += 1) {
      const point = section.points[index];
      const world = vecAdd(
        frame.position,
        vecAdd(
          vecScale(frame.side, point.side * taper),
          vecScale(frame.up, point.up * taper)
        )
      );
      const normal = vecNormalize(
        vecAdd(vecScale(frame.side, point.normalSide), vecScale(frame.up, point.normalUp))
      );
      positions.push(round6(world[0]), round6(world[1]), round6(world[2]));
      normals.push(round6(normal[0]), round6(normal[1]), round6(normal[2]));
      uvs.push(
        round6(frame.distance / tileLength),
        round6(section.arcs[index] / section.perimeter)
      );
      colors.push(round6(blue[0]), round6(blue[1]), round6(blue[2]));
    }
  }

  const stride = section.count;
  const triangle = (a, b, c) => {
    indices.push(a, b, c);
  };
  for (const group of section.materialSegments) {
    const start = indices.length;
    for (let sample = 0; sample < frames.length - 1; sample += 1) {
      for (let segment = 0; segment < group.count; segment += 1) {
        const s0 = group.start + segment;
        const s1 = (s0 + 1) % section.count;
        const a = sample * stride + s0;
        const b = sample * stride + s1;
        const c = (sample + 1) * stride + s0;
        const d = (sample + 1) * stride + s1;
        // winding: cross(section step, path step) = outward normal
        triangle(a, b, c);
        triangle(b, d, c);
      }
    }
    groups.push({ material: group.material, start, count: indices.length - start });
  }

  // Closed ends: a fan from the section centre to the end ring, so the ribbon
  // is a watertight solid (the ring vertices are shared with the side surface).
  const first = frames[0];
  const last = frames[frames.length - 1];
  const capStartIndex = positions.length / 3;
  for (const frame of [first, last]) {
    positions.push(round6(frame.position[0]), round6(frame.position[1]), round6(frame.position[2]));
    const outward = frame === first ? vecScale(frame.tangent, -1) : frame.tangent;
    normals.push(round6(outward[0]), round6(outward[1]), round6(outward[2]));
    uvs.push(0.5, 0.5);
    colors.push(frame === first ? 0.055 : 0.05, frame === first ? 0.07 : 0.06, frame === first ? 0.16 : 0.15);
  }
  const fanStart = indices.length;
  for (let segment = 0; segment < section.count; segment += 1) {
    const ringA = segment;
    const ringB = (segment + 1) % section.count;
    // profile runs clockwise in the (side, up) plane, so this winding faces -tangent
    triangle(capStartIndex, ringB, ringA);
  }
  for (let segment = 0; segment < section.count; segment += 1) {
    const ringA = (frames.length - 1) * stride + segment;
    const ringB = (frames.length - 1) * stride + ((segment + 1) % section.count);
    // and this winding faces +tangent at the far end
    triangle(capStartIndex + 1, ringA, ringB);
  }
  groups.push({ material: 2, start: fanStart, count: indices.length - fanStart });

  return { positions, normals, uvs, colors, indices, groups };
}

/* ------------------------------------------------------------------------- */
/* Coins on the band                                                         */
/* ------------------------------------------------------------------------- */

/** Camera position used for the presentation direction (matches the page fit). */
const ELEVATION_RAD = (WAVE_SPEC.camera.elevationDeg * Math.PI) / 180;
const PROBE_CAMERA = [0, WAVE_SPEC.camera.probeDistance * Math.tan(ELEVATION_RAD), WAVE_SPEC.camera.probeDistance];

/**
 * Point on the ribbon's SILVER TOP surface at path parameter t and fractional
 * position f across the flat top face (-1..1, 0 = centre line). Returns the
 * point and the section frame, so callers can also orient decals/shadows.
 */
export function waveSurfaceAt(t, f) {
  const frame = waveFrameAt(t);
  const ribbon = WAVE_SPEC.ribbon;
  const a = ribbon.halfWidth - ribbon.halfThickness;
  const ratio = clamp(Number(f) || 0, -1, 1);
  const sideOffset = ratio * a;
  const upOffset = ribbon.halfThickness + ribbon.crown * (1 - ratio * ratio);
  const point = vecAdd(
    frame.position,
    vecAdd(vecScale(frame.side, sideOffset), vecScale(frame.up, upOffset))
  );
  return { point, frame, sideOffset, upOffset };
}

/** Presentation camera direction of every coin (parallel to the fitted view). */
function presentationDirection() {
  return vecNormalize(PROBE_CAMERA);
}

/**
 * Build one coin placement: the coin stands on edge on the band, facing the
 * presentation camera with deterministic yaw/roll, its lowest rim point on the
 * top surface (minus `coinSink`).
 */
function buildCoin(spec) {
  const radius = WAVE_SPEC.coinScale * spec.scale * COIN_GEOMETRY.radius;
  const halfThickness = WAVE_SPEC.coinScale * spec.scale * COIN_GEOMETRY.halfThickness;
  const yaw = (spec.yawDeg * Math.PI) / 180;
  const roll = (spec.rollDeg * Math.PI) / 180;
  const elevation = ELEVATION_RAD;

  // face normal (local +Y): the presentation camera direction, yawed per coin
  const faceNormal = vecNormalize([
    Math.cos(elevation) * Math.sin(yaw),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(yaw),
  ]);
  // symbol up (local -Z): world up projected into the coin plane
  let symbolUp = vecNormalize(vecSub([0, 1, 0], vecScale(faceNormal, vecDot([0, 1, 0], faceNormal))));
  const inPlaneRight = vecNormalize(vecCross(symbolUp, faceNormal));
  symbolUp = vecNormalize(vecAdd(vecScale(symbolUp, Math.cos(roll)), vecScale(inPlaneRight, Math.sin(roll))));
  // local axes: +Y = faceNormal, +Z = -symbolUp, +X = symbolUp x faceNormal
  const axisX = vecNormalize(vecCross(symbolUp, faceNormal));
  const axisZ = vecScale(symbolUp, -1);
  const quaternion = quatFromBasis(axisX, faceNormal, axisZ);

  const surface = waveSurfaceAt(spec.t, spec.f);
  const contact = surface.point;
  // lowest rim point = centre - symbolUp * radius; sink it slightly into the band
  const centre = vecSub(vecAdd(contact, vecScale(symbolUp, radius)), vecScale(symbolUp, WAVE_SPEC.coinSink));
  const lowestRim = vecAdd(centre, vecScale(symbolUp, -radius));

  return {
    id: spec.id,
    t: round6(spec.t),
    f: round6(spec.f),
    scale: spec.scale,
    yawDeg: spec.yawDeg,
    rollDeg: spec.rollDeg,
    radius: round6(radius),
    thickness: round6(halfThickness * 2),
    position: round6Vec(centre),
    quaternion: [round6(quaternion[0]), round6(quaternion[1]), round6(quaternion[2]), round6(quaternion[3])],
    faceNormal: round6Vec(faceNormal),
    symbolUp: round6Vec(symbolUp),
    contact: round6Vec(contact),
    contactT: round6(spec.t),
    contactF: round6(spec.f),
    /** authored lowest rim point (it sits `coinSink` under the contact point) */
    lowestRim: round6Vec(lowestRim),
  };
}

/** Sample points on a coin's closed surface for measurements (pure math). */
function coinSamplePoints(coin) {
  const q = coin.quaternion;
  const radius = coin.radius;
  const half = coin.thickness / 2;
  const points = [];
  const STEPS = 24;
  for (let step = 0; step < STEPS; step += 1) {
    const angle = (step / STEPS) * TAU;
    for (const level of [-half, 0, half]) {
      // local rim circle: (cos, level, sin) with local +Y the face normal
      const local = [Math.cos(angle) * radius, level, Math.sin(angle) * radius];
      const rotated = quatRotate(q, local);
      points.push(vecAdd(coin.position, rotated));
    }
  }
  return points;
}

/** Minimum surface clearance between each neighbouring pair of coins. */
function measureCoinClearance(coins) {
  let minimum = Infinity;
  let pair = null;
  for (let i = 0; i < coins.length; i += 1) {
    for (let j = i + 1; j < coins.length; j += 1) {
      const a = coinSamplePoints(coins[i]);
      const b = coinSamplePoints(coins[j]);
      let best = Infinity;
      for (const pa of a) {
        for (const pb of b) {
          const distance = vecLength(vecSub(pa, pb));
          if (distance < best) best = distance;
        }
      }
      if (best < minimum) {
        minimum = best;
        pair = [coins[i].id, coins[j].id];
      }
    }
  }
  return { minClearance: minimum, pair };
}

/* ------------------------------------------------------------------------- */
/* Bounds + camera fit                                                       */
/* ------------------------------------------------------------------------- */

function boundsFromPoints(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  }
  return { min, max };
}

function ribbonBounds(geometry) {
  const points = [];
  const p = geometry.positions;
  for (let index = 0; index < p.length; index += 3) points.push([p[index], p[index + 1], p[index + 2]]);
  return boundsFromPoints(points);
}

function coinBounds(coins) {
  const points = [];
  for (const coin of coins) {
    const q = coin.quaternion;
    const radius = coin.radius;
    const half = coin.thickness / 2;
    for (let step = 0; step < 32; step += 1) {
      const angle = (step / 32) * TAU;
      for (const level of [-half, half]) {
        points.push(
          vecAdd(coin.position, quatRotate(q, [Math.cos(angle) * radius, level, Math.sin(angle) * radius]))
        );
      }
    }
  }
  return boundsFromPoints(points);
}

function mergeBounds(a, b) {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/**
 * Deterministic fov-30 fit of a camera at (0, d*tan(elevation), d) looking at
 * the origin so every bounds corner stays inside the stage. This is the same
 * method src/preview.js uses for Ring/Stack (and the browser verifier
 * re-derives it independently).
 */
function fitDistance(bounds, aspect, { fitMargin, elevationRad, fov = 30 }) {
  const corners = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x, y, z]);
    }
  }
  const safeAspect = aspect > 0 ? aspect : 1.5;
  const tanHalf = Math.tan((fov * Math.PI) / 360);
  const project = (point, distance) => {
    const camY = distance * Math.tan(elevationRad);
    // camera basis looking at the origin: forward = -normalize(cam), right = +X,
    // up = cross(right, forward)
    const forward = vecNormalize([-0, -camY, -distance]);
    const right = [1, 0, 0];
    const up = vecNormalize(vecCross(right, forward));
    const rel = vecSub(point, [0, camY, distance]);
    // forward points from the camera at (0, camY, distance) to the origin
    const depth = vecDot(rel, forward);
    if (depth <= 1e-6) return null;
    const ndcY = vecDot(rel, up) / (depth * tanHalf);
    const ndcX = vecDot(rel, right) / (depth * tanHalf * safeAspect);
    return { x: ndcX, y: ndcY, depth };
  };
  const limit = 1 / fitMargin;
  let lo = 0.4;
  let hi = 240;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const mid = (lo + hi) / 2;
    let fits = true;
    for (const corner of corners) {
      const projected = project(corner, mid);
      if (!projected || Math.abs(projected.x) > limit || Math.abs(projected.y) > limit) {
        fits = false;
        break;
      }
    }
    if (fits) hi = mid;
    else lo = mid;
  }
  return hi + 0.02;
}

/* ------------------------------------------------------------------------- */
/* Build                                                                     */
/* ------------------------------------------------------------------------- */

const RIBBON_SPEC = WAVE_SPEC.ribbon;
const FRAMES = buildFrames(RIBBON_SPEC.controlPoints, RIBBON_SPEC.samples);
const SECTION = buildSection(
  RIBBON_SPEC.halfWidth,
  RIBBON_SPEC.halfThickness,
  RIBBON_SPEC.faceSegments,
  RIBBON_SPEC.edgeSegments,
  RIBBON_SPEC.crown
);
const GEOMETRY = buildRibbonGeometry(FRAMES, SECTION);
const COINS = WAVE_SPEC.coins.map((spec) => buildCoin(spec));
const CLEARANCE = measureCoinClearance(COINS);
const RIBBON_BOUNDS = ribbonBounds(GEOMETRY);
const COIN_BOUNDS = coinBounds(COINS);
const BOUNDS = mergeBounds(RIBBON_BOUNDS, COIN_BOUNDS);
const ELEVATION_DEG = WAVE_SPEC.camera.elevationDeg;
const FIT_MARGIN = WAVE_SPEC.camera.fitMargin;
const PATH_LENGTH = FRAMES[FRAMES.length - 1].distance;

/**
 * Per-coin contact depth: how far the authored lowest rim point sits BELOW the
 * band's top surface, measured along the surface normal (positive = embedded in
 * the band, i.e. touching/sunk by the authored sink; negative would float).
 */
function measureContact(coins) {
  const depths = [];
  for (const coin of coins) {
    const surface = waveSurfaceAt(coin.contactT, coin.contactF);
    const lowest = vecSub(vecAdd(coin.position, vecScale(coin.symbolUp, -coin.radius)), surface.point);
    depths.push(-vecDot(lowest, surface.frame.up));
  }
  return {
    minNormalDepth: Math.min(...depths),
    maxNormalDepth: Math.max(...depths),
  };
}

/**
 * Wave composition (frozen): ribbon frames + mesh buffers, 4 coin placements on
 * the band, measured bounds/clearance/contact and the deterministic camera
 * block. `entries` is aliased as `coins` for symmetry with RING/STACK.
 */
export const WAVE = deepFreeze({
  mode: 'wave',
  ids: WAVE_SPEC.ids.slice(),
  count: COINS.length,
  coinScale: WAVE_SPEC.coinScale,
  faceSize: WAVE_SPEC.faceSize,
  camera: {
    elevationDeg: ELEVATION_DEG,
    elevationRad: round6(ELEVATION_RAD),
    fitMargin: FIT_MARGIN,
    fov: 30,
    probeDistance: WAVE_SPEC.camera.probeDistance,
    baseDistance: round6(fitDistance(BOUNDS, 960.516 / 593.016, {
      fitMargin: FIT_MARGIN,
      elevationRad: ELEVATION_RAD,
    })),
  },
  layout: {
    coinSink: WAVE_SPEC.coinSink,
    path: 'catmull-rom',
    twist: 'tangent-twist',
    coins: WAVE_SPEC.coins.map((entry) => ({ ...entry })),
  },
  frames: FRAMES.map((frame) => ({
    t: round6(frame.t),
    position: round6Vec(frame.position),
    tangent: round6Vec(frame.tangent),
    up: round6Vec(frame.up),
    side: round6Vec(frame.side),
    twistRad: round6(frame.twistRad),
    distance: round6(frame.distance),
  })),
  ribbon: {
    spec: {
      samples: RIBBON_SPEC.samples,
      halfWidth: RIBBON_SPEC.halfWidth,
      halfThickness: RIBBON_SPEC.halfThickness,
      crown: RIBBON_SPEC.crown,
      faceSegments: RIBBON_SPEC.faceSegments,
      edgeSegments: RIBBON_SPEC.edgeSegments,
      tileLength: RIBBON_SPEC.tileLength,
      twistKnots: RIBBON_SPEC.twistKnots.map((knot) => knot.slice()),
      controlPoints: RIBBON_SPEC.controlPoints.map((point) => point.slice()),
    },
    section: {
      points: SECTION.points.length,
      perimeter: round6(SECTION.perimeter),
      materials: ['silverTop', 'blueUnder', 'rim'],
    },
    geometry: {
      positions: GEOMETRY.positions,
      normals: GEOMETRY.normals,
      uvs: GEOMETRY.uvs,
      colors: GEOMETRY.colors,
      indices: GEOMETRY.indices,
      groups: GEOMETRY.groups,
      vertexCount: GEOMETRY.positions.length / 3,
      triangleCount: GEOMETRY.indices.length / 3,
    },
    metrics: {
      length: round6(PATH_LENGTH),
      width: round6(RIBBON_SPEC.halfWidth * 2),
      thickness: round6(RIBBON_SPEC.halfThickness * 2),
      bounds: {
        min: round6Vec(RIBBON_BOUNDS.min),
        max: round6Vec(RIBBON_BOUNDS.max),
      },
    },
  },
  coins: COINS,
  entries: COINS,
  metrics: {
    bounds: { min: round6Vec(BOUNDS.min), max: round6Vec(BOUNDS.max) },
    size: round6Vec(vecSub(BOUNDS.max, BOUNDS.min)),
    center: round6Vec(vecScale(vecAdd(BOUNDS.min, BOUNDS.max), 0.5)),
    minCoinClearance: round6(CLEARANCE.minClearance),
    clearancePair: CLEARANCE.pair,
    contact: { authoredSink: WAVE_SPEC.coinSink, ...measureContact(COINS) },
    pathLength: round6(PATH_LENGTH),
    coinCount: COINS.length,
  },
  /** Predicted projection at the reference stage aspect (offline framing test). */
  predicted: {
    aspect: round6(960.516 / 593.016),
    cameraDistance: round6(fitDistance(BOUNDS, 960.516 / 593.016, {
      fitMargin: FIT_MARGIN,
      elevationRad: ELEVATION_RAD,
    })),
  },
});

/** Convenience alias used by the page builder. */
export const WAVE_COMPOSITION = WAVE;
