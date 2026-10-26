/**
 * tekoanimation — coin composition math: the Ring rosette and the Stack settle.
 *
 * Pure, deterministic geometry only: no three.js import, no DOM, no
 * Math.random, no clock. `src/preview.js` applies the exported numbers to its
 * own presentation rig and fits its own camera (fov 30, binary search).
 *
 * Coordinate conventions
 * ----------------------
 * The coin model (src/coin-model.js) is built in its group's local frame:
 *   - radius 1.0, thickness 0.16 (half-thickness 0.08)
 *   - local +Y is the face-A normal (faceA sits at y = +0.065, reeded band
 *     radius 1.0 / half height 0.079, frame ring at y = +-0.08)
 *   - local -Z is the FACE-A SYMBOL UP direction (the glyph is drawn on the
 *     circle geometry's +Y, which faceA's rotation.x = -PI/2 maps to -Z)
 *   - face A is the readable face; face B is the identical back.
 *
 * A composition entry's `quaternion` is the orientation of the coin MODEL
 * GROUP, so the page should put the coin group (unrotated, scaled by
 * `coinScale`) inside a holder and apply `position` / `quaternion` to the
 * holder. Composition space equals world space: the composition box is
 * untransformed (identity group).
 *
 * RING (8 coins, docs/coin-ring.md, reference docs/coin-ring.png)
 * ---------------------------------------------------------------
 * Eight 0.75-scale coins sit on a ring of radius 1.5 whose plane is tilted
 * -0.34 rad about X, so the ring reads as a 3/4 ellipse: the top coins recede
 * (z = -1.5 sin(angle) sin(tilt)) and the bottom coins come forward. Every
 * coin still faces the camera (face normal ~ world +Z), so all eight symbols
 * stay readable, like the reference rosette.
 *
 * The old page laid the coins out with a sin(2a)*0.07 depth jitter; adjacent
 * projected discs overlapped 23.5 % while the coin cylinders physically
 * interpenetrated. Two deterministic corrections keep the same ring radius /
 * scale / count and remove all 3D interpenetration:
 *
 *  1. depth ripple `-depthRipple * sin(angle)^3` (max 0.19 world z) on top of
 *     the plane tilt. The plane tilt alone only separates the pairs near the
 *     ring's left/right sides; near the top and bottom the tilt's depth
 *     difference shrinks to 0.146 and the coins would still collide. The
 *     odd-symmetric sin^3 ripple widens exactly those top/bottom neighbour
 *     gaps, so every adjacent pair is separated by at least 0.27 world z
 *     (>= 2 * half-thickness 0.06 + 0.15 of air; the verifier measures a
 *     minimum sampled surface clearance of 0.055 world units).
 *  2. alternating lean `shingleTiltRad` (5.7 deg) about each coin's local
 *     tangent, so neighbouring coins fan in/out of the ring plane (rosette
 *     shingle) and their dark reeded edges catch the light. This is the only
 *     orientation change; it stays within the 8-10 deg camera-facing budget.
 *
 * Note: a *strict* alternating normal offset (the obvious shingle recipe) is
 * not enough here — the ring-plane tilt's own z slope carries the same sign as
 * the alternation on four of the eight neighbour pairs, cancelling down to
 * 0.074 < 2*half-thickness. The sin^3 ripple adds depth only where the tilt is
 * weakest, which is why it replaces the plain +- depth offset.
 *
 * The two coins at indices 3 and 5 also get a small yaw (like the rev-1 ring)
 * so their dark reeded band shows; every other coin is square to the camera.
 *
 * STACK (9 coins)
 * ---------------
 * Nine 1.0-radius / 0.16-thick coins start as a TIGHT flush tower (all air
 * gaps exactly 0) and slowly UNFOLD: the eight gaps open from 0 to `finalGap`
 * world units with a slow bottom-up stagger, each eased in/out. Opening the
 * gap below coin k lifts coin k and every coin above it; gaps are never
 * negative, so neighbouring coins never interpenetrate. The column is drifted
 * down by half of the open gaps (a deterministic vertical offset, not a
 * per-coin motion), which keeps the whole composition centred on the origin in
 * EVERY animation state (the tight flush column and the fully unfolded column
 * are both centred), so the page's per-state camera fit never has to
 * re-centre a lopsided stack.
 *
 * `finalGap` is derived from the rendered-page spacing target: the projected
 * mean air gap must be 50 CSS px at the 1440x900 / 1200x900 stage (perspective
 * makes the eight projected gaps run ~41-60 px). See the block comment above
 * STACK_SPEC and docs/coin-stack-unfold.md; tools/verify-compositions.mjs
 * recomputes and asserts the numbers.
 *
 * The top coin is `gbp` (the catalog has no RUB): final yaw 0, so local +Y is
 * world +Y (face A up) and local -Z is world -Z (symbol up), which is exactly
 * the "upright from the 3/4 camera" orientation. Coins below end at
 * deterministic yaws on the 90 deg grid (keeps their axis-aligned bounding
 * box tight, so the page's Box3 fit stays close) and the tight-state jitter
 * settles flat as each gap below opens.
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
const sin3 = (angle) => {
  const s = Math.sin(angle);
  return s * s * s;
};

/* ------------------------------------------------------------------------- */
/* Small pure math helpers (quaternions are [x, y, z, w])                    */
/* ------------------------------------------------------------------------- */

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

function quatRotate(q, v) {
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  const qw = q[3];
  const vx = v[0];
  const vy = v[1];
  const vz = v[2];
  // v' = v + 2 qw (q x v) + 2 q x (q x v)
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

function normalize3(v) {
  const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function round6Vec(v) {
  return [round6(v[0]), round6(v[1]), round6(v[2])];
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/* ------------------------------------------------------------------------- */
/* Ring parameters                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Ring tuning block. All lengths are in the composition/world units used by
 * the coin model (coin radius 1.0 before `coinScale`).
 */
const RING_SPEC = Object.freeze({
  ids: Object.freeze(['gbp', 'usd', 'eur', 'cny', 'gbp', 'vnd', 'php', 'thb']),
  count: 8,
  coinScale: 0.75,
  radius: 1.5,
  /** ring plane tilt about +X: the top of the ring recedes (3/4 read) */
  planeTiltRad: 0.34,
  /** extra -depthRipple * sin(angle)^3 depth (world z) that opens the top/bottom shingle gaps */
  depthRipple: 0.19,
  /** alternating lean about each coin's tangent axis (rosette fan, ~5.7 deg) */
  shingleTiltRad: 0.1,
  /** per-coin yaw about world Y (0 except the two dark-edge coins, like rev-1) */
  edgeYawRad: Object.freeze([0, 0.05, -0.04, 0.1, 0, -0.1, 0.04, -0.05]),
  camera: Object.freeze({ y: 0.42, fitMargin: 1.07, faceSize: 384 }),
});

/** Ring plane normal after the plane tilt (unit, composition/world space). */
function ringAxis() {
  const t = RING_SPEC.planeTiltRad;
  return [0, Math.sin(t), Math.cos(t)];
}

/* ------------------------------------------------------------------------- */
/* Ring build                                                                */
/* ------------------------------------------------------------------------- */

function buildRingEntries() {
  const tilt = RING_SPEC.planeTiltRad;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const entries = [];

  for (let index = 0; index < RING_SPEC.count; index += 1) {
    // index 0 sits at the top of the ring, indices run clockwise (screen sense)
    const angleRad = HALF_PI - (index * TAU) / RING_SPEC.count;
    const sinA = Math.sin(angleRad);
    const cosA = Math.cos(angleRad);

    // centre on the tilted circle, plus the sin^3 depth ripple on world z
    const position = [
      RING_SPEC.radius * cosA,
      RING_SPEC.radius * sinA * cosTilt,
      -RING_SPEC.radius * sinA * sinTilt - RING_SPEC.depthRipple * sin3(angleRad),
    ];

    // tangent of the tilted ring at this angle = the shingle lean axis
    const tangent = normalize3([-sinA, cosA * cosTilt, -cosA * sinTilt]);
    const shingle = RING_SPEC.shingleTiltRad * (index % 2 === 0 ? 1 : -1);
    const yaw = RING_SPEC.edgeYawRad[index];

    // face-on base (local +Y -> world +Z, local -Z -> world +Y), then the
    // tangent lean, then the optional world-Y yaw
    const quaternion = quatMultiply(
      quatAxisAngle(0, 1, 0, yaw),
      quatMultiply(
        quatAxisAngle(tangent[0], tangent[1], tangent[2], shingle),
        quatAxisAngle(1, 0, 0, HALF_PI),
      ),
    );

    const faceNormal = quatRotate(quaternion, [0, 1, 0]);
    const symbolUp = quatRotate(quaternion, [0, 0, -1]);
    const normalOffRad = Math.acos(clamp(faceNormal[2], -1, 1));

    entries.push({
      id: RING_SPEC.ids[index],
      index,
      angleRad: round6(angleRad),
      position: round6Vec(position),
      quaternion: [round6(quaternion[0]), round6(quaternion[1]), round6(quaternion[2]), round6(quaternion[3])],
      faceNormal: round6Vec(faceNormal),
      // yawDeg: heading of the face normal about +Y (0 = straight at camera)
      yawDeg: round6(Math.atan2(faceNormal[0], faceNormal[2]) * DEG),
      // pitchDeg: face-normal elevation (positive = looking up)
      pitchDeg: round6(Math.asin(clamp(faceNormal[1], -1, 1)) * DEG),
      // rollDeg: symbol rotation about the view axis (positive = tilted to +x)
      rollDeg: round6(Math.atan2(symbolUp[0], symbolUp[1]) * DEG),
      // normalOffDeg: angle between the face normal and world +Z (camera-facing budget)
      normalOffDeg: round6(normalOffRad * DEG),
    });
  }
  return entries;
}

/**
 * Measured ring-hole numbers (same values the verifier reports):
 *  - holeRadius: minimum orthographic-XY distance from the composition centre
 *    to any coin's inner rim (the clear hole you see in the picture),
 *  - axisHoleRadius: minimum distance from any coin's rim to the ring axis
 *    (a rod of this radius can pass through the ring along its normal).
 */
function measureRingHole(entries) {
  const R = RING_SPEC.coinScale * COIN_GEOMETRY.radius;
  const H = RING_SPEC.coinScale * COIN_GEOMETRY.halfThickness;
  const axis = ringAxis();
  let holeRadius = Infinity;
  let axisHoleRadius = Infinity;
  const RADIAL_SEGMENTS = 240;
  for (const entry of entries) {
    const a1 = quatRotate(entry.quaternion, [1, 0, 0]);
    const a2 = quatRotate(entry.quaternion, [0, 0, 1]);
    const n = quatRotate(entry.quaternion, [0, 1, 0]);
    for (const level of [-H, 0, H]) {
      for (let k = 0; k < RADIAL_SEGMENTS; k += 1) {
        const theta = (k / RADIAL_SEGMENTS) * TAU;
        const s = R * Math.cos(theta);
        const t = R * Math.sin(theta);
        const p = [
          entry.position[0] + a1[0] * s + a2[0] * t + n[0] * level,
          entry.position[1] + a1[1] * s + a2[1] * t + n[1] * level,
          entry.position[2] + a1[2] * s + a2[2] * t + n[2] * level,
        ];
        const projected = Math.hypot(p[0], p[1]);
        if (projected < holeRadius) holeRadius = projected;
        const along = p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
        const distance = Math.hypot(p[0] - axis[0] * along, p[1] - axis[1] * along, p[2] - axis[2] * along);
        if (distance < axisHoleRadius) axisHoleRadius = distance;
      }
    }
  }
  return { holeRadius, axisHoleRadius };
}

const RING_ENTRIES = buildRingEntries();

/**
 * Ring rosette: 8 coins, radius 1.5, coin scale 0.75, every symbol facing the
 * camera, no interpenetrating pair (see tools/verify-compositions.mjs).
 * `entries` are in composition/world space; apply `position`/`quaternion` to
 * the coin holders inside an identity group. `axis` is the ring-plane normal;
 * `layout` is the tuning block and `metrics` the measured centre hole.
 */
export const RING = deepFreeze({
  count: RING_SPEC.count,
  ids: RING_SPEC.ids.slice(),
  coinScale: RING_SPEC.coinScale,
  radius: RING_SPEC.radius,
  camera: { ...RING_SPEC.camera },
  axis: round6Vec(ringAxis()),
  layout: {
    planeTiltRad: RING_SPEC.planeTiltRad,
    depthRipple: RING_SPEC.depthRipple,
    shingleTiltRad: RING_SPEC.shingleTiltRad,
  },
  metrics: measureRingHole(RING_ENTRIES),
  entries: RING_ENTRIES,
});
/* ------------------------------------------------------------------------- */
/* Stack parameters                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Stack tuning block. The nine coins are stacked coaxially on +Y: the flush
 * (tight) column is centred on the origin (bottom face at -count*thickness/2)
 * and the unfolded column is centred too (a deterministic -openGaps/2 drift),
 * so the page's per-state camera fit never has to re-centre a lopsided stack.
 *
 * Animation: the stack starts TIGHT and UNFOLDS. The eight air gaps open from
 * exactly 0 to `finalGap` world units with a slow bottom-up stagger (gap below
 * coin 1 first, gap below coin 8 last), each eased in/out over
 * `stageDuration`. Gaps never go negative, so neighbouring coins never
 * interpenetrate; closing/opening a gap moves every coin above it.
 *
 * Spacing target: `finalGap` is chosen so the spacing on the RENDERED page is
 * 50 CSS px. The page frames the stack with a fov-30 camera at
 * `elevationDeg` above the horizon and `fitMargin` (binary-search fit, same as
 * the ring), so equal world gaps project to different pixel gaps up the column
 * (perspective: the camera is above the stack, so the top gaps read wider).
 * The 50 px target is therefore defined as the MEAN projected air gap
 * (surface-to-surface) of the eight gaps at the reference 1440x900 stage
 * (stage 960.516 x 593.016 CSS px; the 1200x900 stage is 790.406 x 593.016 —
 * the same height, so it measures the same). The eight gaps run ~41-60 px and
 * the pair just above the centre reads ~50.8 px. At 390x844 the stage is
 * 371.359 px tall, so the same world gap/camera fit projects the mean gap to
 * ~31.3 px (it is the fit, not the world gap, that limits a phone). The
 * offline verifier (tools/verify-compositions.mjs) recomputes all of this and
 * asserts the numbers; docs/coin-stack-unfold.md documents the px <-> world
 * mapping.
 */
const STACK_SPEC = Object.freeze({
  // bottom -> top. COIN_SPECS has seven currencies (no RUB), so USD and GBP
  // repeat; the visible top coin is GBP.
  ids: Object.freeze(['php', 'vnd', 'thb', 'cny', 'eur', 'usd', 'gbp', 'usd', 'gbp']),
  radius: 1.0,
  thickness: 0.16,
  /**
   * Final air gap between neighbouring coins, in world units (coin radius 1,
   * thickness 0.16). Chosen for the 50 CSS px projected mean air gap target
   * through the standard stack camera fit (elevation 28 deg, fov 30,
   * fitMargin 1.07); see the block comment above. The offline verifier
   * recomputes the projected spacing from this value and fails if it drifts
   * away from 50.0 px.
   */
  finalGap: 1.02475,
  /**
   * Camera elevation above the horizon for the 3/4 read. The flush-settle
   * round used 34 deg; with real 50 px air gaps the perspective spread between
   * the bottom and top gap was 39-62 px at 34 deg, so the camera is lowered to
   * 28 deg: the gaps read more evenly (~41-60 px) while the top coin's face
   * still reads from above.
   */
  elevationDeg: 28,
  fitMargin: 1.07,
  /** per-gap unfold stage length (s) and the bottom-up stagger (s) */
  stageDuration: 1.2,
  stageStagger: 0.5,
  /** final symbol yaw about +Y (90 deg grid keeps the Box3 AABB tight) */
  finalYawRad: Object.freeze([HALF_PI, Math.PI, -HALF_PI, 0, HALF_PI, Math.PI, -HALF_PI, HALF_PI, 0]),
  /** tight-state twist that settles flat as each gap opens (top coin: 0) */
  yawJitterRad: Object.freeze([0.04, -0.035, 0.04, -0.035, 0.03, -0.04, 0.035, 0.03, 0]),
});

const STACK_COUNT = STACK_SPEC.ids.length;
/** gaps: below coin k, k = 1 .. count-1 (bottom-up opening order) */
const STACK_GAP_COUNT = STACK_COUNT - 1;
/** the last gap (below the top coin) starts at (count-2)*stagger */
const STACK_DURATION = (STACK_GAP_COUNT - 1) * STACK_SPEC.stageStagger + STACK_SPEC.stageDuration;
/** flush column: bottom face at -count*thickness/2, coin index 0 bottom */
const STACK_BOTTOM_TIGHT = (-STACK_COUNT * STACK_SPEC.thickness) / 2;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** coin centre in the TIGHT (flush, centred) column */
function stackTightY(index) {
  return STACK_BOTTOM_TIGHT + STACK_SPEC.thickness * (index + 0.5);
}

/** coin centre in the FULLY UNFOLDED column (centred: +-g*(count-1)/2 offset) */
function stackFinalY(index) {
  return stackTightY(index) + STACK_SPEC.finalGap * (index - (STACK_COUNT - 1) / 2);
}

function buildStackEntries() {
  const entries = [];
  for (let index = 0; index < STACK_COUNT; index += 1) {
    entries.push({
      id: STACK_SPEC.ids[index],
      index,
      // exact (unrounded) values: the gaps stay exact to float precision
      tightY: stackTightY(index),
      finalY: stackFinalY(index),
      finalYawRad: STACK_SPEC.finalYawRad[index],
      yawJitterRad: STACK_SPEC.yawJitterRad[index],
    });
  }
  return entries;
}

/**
 * Stack composition: 9 coins (radius 1.0, thickness 0.16) that start as a
 * tight flush tower and slowly unfold to `finalGap` air gaps, bottom-up.
 * Both the tight and the unfolded columns are centred on the origin, so the
 * per-state camera fit keeps the composition centred. The top coin is `gbp`
 * with finalYawRad 0: local +Y = world +Y (face A up), local -Z = world -Z
 * (symbol up), which is upright from the stack camera.
 */
export const STACK = deepFreeze({
  count: STACK_COUNT,
  ids: STACK_SPEC.ids.slice(),
  topId: STACK_SPEC.ids[STACK_COUNT - 1],
  radius: STACK_SPEC.radius,
  thickness: STACK_SPEC.thickness,
  /** world-unit air gap at the fully unfolded state */
  finalGap: STACK_SPEC.finalGap,
  camera: { elevationDeg: STACK_SPEC.elevationDeg, fitMargin: STACK_SPEC.fitMargin },
  layout: {
    elevationDeg: STACK_SPEC.elevationDeg,
    gapOrder: 'bottom-up',
    finalYawRad: STACK_SPEC.finalYawRad.slice(),
    yawJitterRad: STACK_SPEC.yawJitterRad.slice(),
  },
  /**
   * Design target for the rendered spacing. The projected numbers are a page
   * measurement (camera fit), not pure composition math, so they live in the
   * docs and in tools/verify-compositions.mjs, which asserts them; this block
   * only names the target and its measurement convention.
   */
  spacing: {
    targetPx: 50,
    measure: 'mean projected air gap (surface-to-surface) of the eight gaps',
    referenceViewport: '1440x900 / 1200x900',
    referenceStage: { width: 960.516, height: 593.016 },
    elevationDeg: STACK_SPEC.elevationDeg,
    fitMargin: STACK_SPEC.fitMargin,
  },
  metrics: {
    gapCount: STACK_GAP_COUNT,
    tightHeight: STACK_COUNT * STACK_SPEC.thickness,
    finalHeight: STACK_COUNT * STACK_SPEC.thickness + STACK_GAP_COUNT * STACK_SPEC.finalGap,
    tightBottomY: STACK_BOTTOM_TIGHT,
    finalBottomY: -((STACK_COUNT * STACK_SPEC.thickness + STACK_GAP_COUNT * STACK_SPEC.finalGap) / 2),
  },
  entries: buildStackEntries(),
  timing: {
    stageDuration: STACK_SPEC.stageDuration,
    stageStagger: STACK_SPEC.stageStagger,
    duration: STACK_DURATION,
  },
});

/* ------------------------------------------------------------------------- */
/* Stack pose                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Deterministic stack pose at `timeSeconds` (clamped to [0, duration]).
 *
 * The stack starts TIGHT at t = 0 (all gaps exactly 0) and UNFOLDS: gap k
 * (the air gap below coin k, k = 1 .. count-1) opens from 0 to `finalGap`
 * over `stageDuration`, starting at t = (k-1)*stageStagger, i.e. bottom-up:
 * the gap below coin 1 opens first, the gap below the top coin last. Each gap
 * is eased in/out (`easeInOutCubic`).
 *
 * Coin k sits on top of all gaps below it, so opening gap k lifts coin k and
 * every coin above it by the current gap. A deterministic vertical drift of
 * -(sum of open gaps)/2 is added to every coin: it keeps the composition's
 * vertical centre on the origin in every state (tight flush column and fully
 * unfolded column alike) without changing any gap, so all gap / non-
 * penetration guarantees are unaffected.
 *
 * @param {number} timeSeconds
 * @returns {{t:number, progress:number, state:'tight'|'unfolding'|'unfolded',
 *   height:number, bottomY:number,
 *   entries:Array<{index:number, y:number, yawRad:number}>}}
 */
export function stackPose(timeSeconds) {
  const duration = STACK_DURATION;
  const raw = Number(timeSeconds);
  const t = clamp(Number.isFinite(raw) ? raw : 0, 0, duration);

  // gap[k] = current air gap below coin k (k = 1 .. count-1); bottom-up order
  const gap = new Array(STACK_COUNT).fill(0);
  const closed = new Array(STACK_COUNT).fill(0); // eased progress per gap
  let openTotal = 0;
  for (let k = 1; k < STACK_COUNT; k += 1) {
    const stageStart = (k - 1) * STACK_SPEC.stageStagger;
    const p = easeInOutCubic(clamp((t - stageStart) / STACK_SPEC.stageDuration, 0, 1));
    closed[k] = p;
    gap[k] = STACK_SPEC.finalGap * p;
    openTotal += gap[k];
  }

  // centred composition: shift the whole stack down by half the open gaps
  const drift = -0.5 * openTotal;
  const totalOpen = STACK_GAP_COUNT * STACK_SPEC.finalGap;
  const progress = totalOpen > 0 ? clamp(openTotal / totalOpen, 0, 1) : 0;

  const entries = [];
  let above = 0;
  let closedBelow = 0;
  for (let index = 0; index < STACK_COUNT; index += 1) {
    if (index > 0) {
      above += gap[index];
      closedBelow += closed[index];
    }
    const y = stackTightY(index) + above + drift;
    // yaw: the deterministic finish spin, twisted by yawJitter in the tight
    // state and settling flat as the gaps below it open
    const settleFraction = index === 0 ? progress : clamp(closedBelow / index, 0, 1);
    const yawRad = STACK_SPEC.finalYawRad[index] + STACK_SPEC.yawJitterRad[index] * (1 - settleFraction);
    entries.push({ index, y, yawRad });
  }

  let state = 'unfolding';
  if (openTotal <= 1e-12) state = 'tight';
  else if (openTotal >= totalOpen - 1e-12) state = 'unfolded';

  const height = STACK_COUNT * STACK_SPEC.thickness + openTotal;
  const bottomY = STACK_BOTTOM_TIGHT + drift;
  return { t, progress, state, height, bottomY, entries };
}
