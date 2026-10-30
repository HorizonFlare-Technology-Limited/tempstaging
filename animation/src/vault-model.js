/**
 * tekoanimation — Vault object model (reference: user figure 5), revision 21.
 *
 * Standalone procedural model for `vault.html` (docs/vault.md, model 3.0.0):
 * a dark-metal safe/vault with a dense ribbed/finned left side, a chamfered
 * front door hinged on the right with a circular ring of small dots/perforations
 * and a recessed grip slot, a recessed interior revealed when the door swings
 * open, and a single bar chain of 24 identical thin vertical capsules that
 * forms ONE continuous helix around the safe: it starts at the safe's front-left,
 * runs around the left side, behind the safe and around the right side while
 * ascending, closing exactly one revolution (23 equal angular steps of
 * 360/23 deg, constant vertical step). The path radius clears the safe body and
 * the full door swing at every bar.
 *
 * The reveal is ordered bottom-most first (the helix ascends in index order);
 * each next bar advances along the helix tangent from the previous slot, fading
 * in, at exactly the same time as the door opens. Final frame holds the open
 * door with all 24 bars seated on the helix.
 *
 * Everything is generated from constants — no randomness, no network, no DOM.
 * The module is safe to import in Node for offline geometry/determinism checks;
 * the page controller (src/vault-preview.js) owns the renderer, camera fitting,
 * environment, reflective floor, trackball and animation timeline.
 */
import * as THREE from 'three';

export const MODEL_VERSION = '3.0.0';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;

/** Cubic ease-in-out used for the door opening. */
export function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Cubic ease-out used for each bar's fade-in and forward slide. */
export function easeOutCubic(t) {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

/* ------------------------------------------------------------------ spec */

export const VAULT_SPEC = Object.freeze({
  width: 3.1,
  height: 2.8,
  depth: 2.2,
  cornerRadius: 0.24,
  wall: 0.17,
  // Dense ribbed left side: many thin vertical rounded fins across the depth.
  finCount: 24,
  finRadius: 0.05,
  finSpanZ: 1.94,
  finHeight: 2.46,
  finX: -1.555,
  // Chamfered door, hinged on the right, with a ring of perforations and a
  // recessed vertical grip slot on its free (left) edge.
  door: Object.freeze({
    width: 2.76,
    height: 2.44,
    thickness: 0.16,
    bevel: 0.05,
    openAngleDeg: 40,
    hingeX: 1.5,
    hingeZ: 1.12,
    dotCount: 22,
    dotRingRadius: 0.63,
    dotRadius: 0.044,
    dotDepth: 0.06,
    gripX: -1.2,
    gripWidth: 0.09,
    gripHeight: 0.72,
    gripDepth: 0.05,
  }),
  interior: Object.freeze({
    depth: 1.56,
    shelfCount: 2,
  }),
});

export const BAR_SPEC = Object.freeze({
  count: 24,
  radius: 0.05,
  /** ONE geometry for every bar: radius + length are the only size inputs. */
  length: 1.0,
  /**
   * ONE continuous helix around the safe:
   *   theta_i = startAngleDeg + i * deltaAngleDeg
   *   x = radius * cos(theta), z = radius * sin(theta)
   *   y_i = startY + i * stepY
   * 24 bars = 23 equal angular steps, so the chain closes exactly one
   * revolution (sum of the steps = 360 deg). Bar 0 sits at the safe's
   * front-left (135 deg in plan: x < 0, z > 0); the chain then runs around the
   * left side (180 deg), behind the safe (270 deg), around the right side
   * (360 deg) and ends one turn higher at bar 0's plan angle.
   */
  helix: Object.freeze({
    // Clears the safe body + the full open-door swing (see barClearanceReport).
    radius: 3.45,
    startAngleDeg: 135,
    deltaAngleDeg: 360 / 23,
    startY: 0.62,
    stepY: 0.05, // Rev21 s17: half of the rev-2 pitch (0.1)
  }),
  /** Every bar starts one helical slot behind its final slot (helix tangent). */
  revealFromPreviousSlot: true,
  toneCount: 5,
});

export const BAR_HELIX = BAR_SPEC.helix;

/** Sum of the angular steps: exactly one revolution. */
export const BAR_REVOLUTIONS = ((BAR_SPEC.count - 1) * BAR_HELIX.deltaAngleDeg) / 360;

const OPEN_ANGLE_RAD = VAULT_SPEC.door.openAngleDeg * DEG;

/**
 * Horizontal AABB of everything the safe body occupies with the door CLOSED:
 * shell/back plate, the rib fins on the left, and the seated door's front face.
 */
export const SAFE_BOX = Object.freeze({
  min: Object.freeze({ x: -1.605, y: 0, z: -1.2 }),
  max: Object.freeze({ x: 1.55, y: VAULT_SPEC.height + 0.04, z: 1.45 }),
});

/** Vertical range of the door plate (hinge height +/- plate height). */
export const DOOR_Y_RANGE = Object.freeze({
  min: VAULT_SPEC.height / 2 - VAULT_SPEC.door.height / 2 - 0.08,
  max: VAULT_SPEC.height / 2 + VAULT_SPEC.door.height / 2 + 0.08,
});

/**
 * The door's plan-space OBB corners (x, z) for a hinge rotation angle.
 * 0 = closed (seated over the front face); openAngleRad = fully open.
 */
export function doorPlanCorners(angleRad = OPEN_ANGLE_RAD) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const width = VAULT_SPEC.door.width;
  const thickness = VAULT_SPEC.door.thickness + 0.2;
  const local = [
    [-width - 0.04, 0],
    [-0.04, 0],
    [-width - 0.04, thickness],
    [-0.04, thickness],
  ];
  return local.map(([x, z]) => ({
    x: VAULT_SPEC.door.hingeX + x * cos + z * sin,
    z: VAULT_SPEC.door.hingeZ - x * sin + z * cos,
  }));
}

/** Max plan radius reached by the door across its swing (door OBB corners). */
export function doorMaxRadius(angleRad = OPEN_ANGLE_RAD) {
  return Math.max(...doorPlanCorners(angleRad).map((corner) => Math.hypot(corner.x, corner.z)));
}

/** The helix slot of bar `index` (final seated pose). Pure function. */
export function barSlot(index) {
  const i = Math.max(0, Math.floor(index));
  const thetaDeg = BAR_HELIX.startAngleDeg + i * BAR_HELIX.deltaAngleDeg;
  const thetaRad = thetaDeg * DEG;
  const y = BAR_HELIX.startY + i * BAR_HELIX.stepY;
  return {
    index: i,
    slot: i,
    thetaDeg,
    thetaRad,
    x: BAR_HELIX.radius * Math.cos(thetaRad),
    z: BAR_HELIX.radius * Math.sin(thetaRad),
    y,
    top: y + BAR_SPEC.length / 2,
    tone: i % BAR_TONES.length,
  };
}

/**
 * The previous helical slot (one angular step back, one vertical step down) —
 * the reveal start pose, so a bar advances along the helix tangent rather than
 * sliding on a straight world axis. For bar 0 this extrapolates one slot.
 */
export function barStartSlot(index) {
  const i = Math.max(0, Math.floor(index));
  const thetaDeg = BAR_HELIX.startAngleDeg + (i - 1) * BAR_HELIX.deltaAngleDeg;
  const thetaRad = thetaDeg * DEG;
  const y = BAR_HELIX.startY + (i - 1) * BAR_HELIX.stepY;
  return {
    index: i,
    thetaDeg,
    thetaRad,
    x: BAR_HELIX.radius * Math.cos(thetaRad),
    z: BAR_HELIX.radius * Math.sin(thetaRad),
    y,
  };
}

/** Reveal rank: the helix ascends in index order, so the bottom-most is index 0. */
export function barRevealRank(index) {
  return Math.max(0, Math.floor(index));
}

/** Deterministic full reveal order (bottom-most first). */
export const BAR_REVEAL_ORDER = Object.freeze(
  Array.from({ length: BAR_SPEC.count }, (_, index) => index),
);

export const CAMERA_SPEC = Object.freeze({
  fov: 33,
  near: 0.1,
  far: 200,
  azimuthDeg: -40,
  elevationDeg: 13,
  target: Object.freeze([0.5, 2.15, 0.7]),
  fitMargin: 0.1,
  fitMarginNarrow: 0.14,
  narrowStageWidth: 760,
});

/**
 * The door OPENS over 1.6 s while the 24 bars reveal bottom-most first: each
 * bar takes 0.75 s to advance along the helix + fade in, staggered by 37 ms.
 * Reveal t0 === door t0 === 0; the last bar starts at 23 * 37 = 851 ms and
 * lands at 1601 ms, one millisecond after the door finishes - both motions
 * share the same window and the final frame holds the open door with every bar
 * seated on the helix.
 */
export const ANIMATION_SPEC = Object.freeze({
  doorDurationMs: 1600,
  barDurationMs: 750,
  barStaggerMs: 37,
  barTotalMs: 750 + (BAR_SPEC.count - 1) * 37,
  totalMs: Math.max(1600, 750 + (BAR_SPEC.count - 1) * 37),
});

/** Bar gradient: pale steel at the bottom -> saturated cobalt at the top. */
const BAR_GRADIENT_STOPS = Object.freeze([
  Object.freeze({ t: 0.0, color: 0xd8e6f6 }),
  Object.freeze({ t: 0.24, color: 0x9fc4ea }),
  Object.freeze({ t: 0.52, color: 0x5f9de6 }),
  Object.freeze({ t: 0.78, color: 0x2f76d6 }),
  Object.freeze({ t: 1.0, color: 0x1c58b4 }),
]);

export const BAR_TONES = Object.freeze([
  Object.freeze({ name: 'cobalt', tint: 0x2f76d6 }),
  Object.freeze({ name: 'steel', tint: 0x9fc4ea }),
  Object.freeze({ name: 'slate', tint: 0x4f86c8 }),
  Object.freeze({ name: 'ice', tint: 0xc4ddf4 }),
  Object.freeze({ name: 'night', tint: 0x2a5fa8 }),
]);

/**
 * Deterministic final/start pose pair for one bar.
 *
 * `final` is the helical slot (barSlot); `start` is the previous helical slot
 * (one angular + one vertical step back), so the reveal advance travels along
 * the helix tangent instead of sliding on a world axis.
 */
export function barPoses(index) {
  const slot = barSlot(index);
  const previous = barStartSlot(index);
  const order = barRevealRank(slot.index);
  const final = {
    position: { x: slot.x, y: slot.y, z: slot.z },
    rotation: { x: 0, y: 0, z: 0 },
  };
  const start = {
    position: { x: previous.x, y: previous.y, z: previous.z },
    rotation: { x: 0, y: 0, z: 0 },
  };
  return {
    index: slot.index,
    slot: slot.slot,
    thetaDeg: slot.thetaDeg,
    thetaRad: slot.thetaRad,
    startThetaDeg: previous.thetaDeg,
    radius: BAR_HELIX.radius,
    top: slot.top,
    length: BAR_SPEC.length,
    tone: slot.tone,
    toneName: BAR_TONES[slot.tone].name,
    order,
    final,
    start,
  };
}

/** Per-bar reveal window in ms: bar k (reveal order) starts at k*stagger. */
export function barRevealTiming(order) {
  return {
    startMs: order * ANIMATION_SPEC.barStaggerMs,
    endMs: order * ANIMATION_SPEC.barStaggerMs + ANIMATION_SPEC.barDurationMs,
  };
}

/* ------------------------------------------------------------- clearance */

/** Distance from a plan point to an axis-aligned plan box (0 inside). */
function pointToAabb2D(x, z, box) {
  const dx = Math.max(box.min.x - x, 0, x - box.max.x);
  const dz = Math.max(box.min.z - z, 0, z - box.max.z);
  return Math.hypot(dx, dz);
}

/** Distance from a plan point to a convex planar polygon (0 inside). */
function pointToPolygon2D(x, z, corners) {
  let inside = true;
  let minDistance = Infinity;
  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (cross < 0) inside = false;
    // distance to the edge segment a-b
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const lengthSq = ex * ex + ez * ez;
    const t = lengthSq > 1e-12 ? clamp(((x - a.x) * ex + (z - a.z) * ez) / lengthSq, 0, 1) : 0;
    minDistance = Math.min(minDistance, Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t)));
  }
  return inside ? 0 : minDistance;
}

function verticalOverlap(aMin, aMax, bMin, bMax) {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin) > 0;
}

/**
 * Full numeric clearance report for the 24-bar helix:
 *   - horizontal gap between every bar's capsule surface and the safe AABB;
 *   - the same against the door OBB in its CLOSED and OPEN states (the swing is
 *     monotonic in plan radius, so those two states bound every intermediate
 *     angle);
 *   - the helix radius vs the largest plan radius of the safe + open door.
 * Clearance values are surface gaps: `distance - barRadius`.
 */
export function barClearanceReport() {
  const barRadius = BAR_SPEC.radius;
  const halfLength = BAR_SPEC.length / 2 + barRadius;
  const closedDoor = doorPlanCorners(0);
  const openDoor = doorPlanCorners(OPEN_ANGLE_RAD);
  const entries = [];
  for (let index = 0; index < BAR_SPEC.count; index += 1) {
    const slot = barSlot(index);
    const yMin = slot.y - halfLength;
    const yMax = slot.y + halfLength;
    const safeOverlap = verticalOverlap(yMin, yMax, SAFE_BOX.min.y, SAFE_BOX.max.y);
    const doorOverlap = verticalOverlap(yMin, yMax, DOOR_Y_RANGE.min, DOOR_Y_RANGE.max);
    const safeDistance = safeOverlap ? pointToAabb2D(slot.x, slot.z, SAFE_BOX) : Infinity;
    const closedDistance = doorOverlap ? pointToPolygon2D(slot.x, slot.z, closedDoor) : Infinity;
    const openDistance = doorOverlap ? pointToPolygon2D(slot.x, slot.z, openDoor) : Infinity;
    entries.push({
      index,
      thetaDeg: slot.thetaDeg,
      x: slot.x,
      y: slot.y,
      z: slot.z,
      safeDistance,
      doorClosedDistance: closedDistance,
      doorOpenDistance: openDistance,
      safeClearance: safeDistance - barRadius,
      doorClosedClearance: closedDistance - barRadius,
      doorOpenClearance: openDistance - barRadius,
    });
  }
  const minOf = (key) => Math.min(...entries.map((entry) => entry[key]));
  const safeMaxRadius = Math.max(
    Math.hypot(SAFE_BOX.min.x, SAFE_BOX.min.z),
    Math.hypot(SAFE_BOX.min.x, SAFE_BOX.max.z),
    Math.hypot(SAFE_BOX.max.x, SAFE_BOX.min.z),
    Math.hypot(SAFE_BOX.max.x, SAFE_BOX.max.z),
  );
  const doorClosedMaxRadius = doorMaxRadius(0);
  const doorOpenMaxRadius = doorMaxRadius(OPEN_ANGLE_RAD);
  const maxBodyRadius = Math.max(safeMaxRadius, doorClosedMaxRadius, doorOpenMaxRadius);
  return {
    barRadius,
    helixRadius: BAR_HELIX.radius,
    deltaAngleDeg: BAR_HELIX.deltaAngleDeg,
    deltaY: BAR_HELIX.stepY,
    safeBox: SAFE_BOX,
    doorYRange: DOOR_Y_RANGE,
    doorClosedCorners: closedDoor,
    doorOpenCorners: openDoor,
    safeMaxRadius,
    doorClosedMaxRadius,
    doorOpenMaxRadius,
    maxBodyRadius,
    /** The helix circle must clear the largest body radius plus the bar radius. */
    helixClearsBody: BAR_HELIX.radius - maxBodyRadius - barRadius > 0,
    helixClearance: BAR_HELIX.radius - maxBodyRadius - barRadius,
    entries,
    minSafeDistance: minOf('safeDistance'),
    minDoorClosedDistance: minOf('doorClosedDistance'),
    minDoorOpenDistance: minOf('doorOpenDistance'),
    minSafeClearance: minOf('safeClearance'),
    minDoorClosedClearance: minOf('doorClosedClearance'),
    minDoorOpenClearance: minOf('doorOpenClearance'),
    minClearance: Math.min(
      minOf('safeClearance'),
      minOf('doorClosedClearance'),
      minOf('doorOpenClearance'),
    ),
    allClear: entries.every((entry) => entry.safeClearance > 0 && entry.doorClosedClearance > 0 && entry.doorOpenClearance > 0),
  };
}

/* ------------------------------------------------------------------ utils */

function roundedRectShape(width, height, radius) {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}

function roundedRectRingShape(width, height, radius, innerWidth, innerHeight, innerRadius) {
  const shape = roundedRectShape(width, height, radius);
  shape.holes.push(roundedRectShape(innerWidth, innerHeight, innerRadius));
  return shape;
}

function extrude(shape, depth, bevel, curveSegments = 8) {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments,
    steps: 1,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: bevel > 0 ? 3 : 1,
  });
}

function capsule(radius, length, radialSegments = 14, heightSegments = 6) {
  return new THREE.CapsuleGeometry(radius, length, heightSegments, radialSegments);
}

/** Vertical steel->cobalt gradient generated procedurally (DataTexture, no DOM). */
function buildBarGradientTexture() {
  const height = 64;
  const data = new Uint8Array(4 * height);
  const stops = BAR_GRADIENT_STOPS;
  for (let row = 0; row < height; row += 1) {
    // row 0 = texture bottom (v=0)
    const t = row / (height - 1);
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let index = 0; index < stops.length - 1; index += 1) {
      if (t >= stops[index].t && t <= stops[index + 1].t) {
        a = stops[index];
        b = stops[index + 1];
        break;
      }
    }
    const span = Math.max(1e-6, b.t - a.t);
    const k = clamp((t - a.t) / span, 0, 1);
    const ca = new THREE.Color(a.color);
    const cb = new THREE.Color(b.color);
    const color = ca.clone().lerp(cb, k);
    const offset = row * 4;
    data[offset] = Math.round(color.r * 255);
    data[offset + 1] = Math.round(color.g * 255);
    data[offset + 2] = Math.round(color.b * 255);
    data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 1, height, THREE.RGBAFormat);
  texture.name = 'vault-bar-gradient';
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  return texture;
}

/** r151 legacy color mode treats material colors as linear: convert sRGB. */
function linearColor(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

function satinSteel(color, {
  metalness = 0.92,
  roughness = 0.44,
  envMapIntensity = 1.3,
  clearcoat = 0.12,
  clearcoatRoughness = 0.34,
} = {}) {
  return new THREE.MeshPhysicalMaterial({
    name: 'vault-satin-steel',
    color: linearColor(color),
    metalness,
    roughness,
    envMapIntensity,
    clearcoat,
    clearcoatRoughness,
  });
}

/* ------------------------------------------------------------------ model */

/**
 * Build the whole vault + bar field. Returns a plain object with the root
 * group, named parts, per-bar meshes/poses, materials and a dispose().
 */
export function createVaultModel({ quality = 'hero' } = {}) {
  const detail = quality === 'gallery'
    ? { curve: 4, finRadial: 8, dotRadial: 10, barRadial: 8, barSegments: 4 }
    : { curve: 8, finRadial: 14, dotRadial: 14, barRadial: 10, barSegments: 5 };

  const root = new THREE.Group();
  root.name = 'vault-root';

  // Revision 21 (image-based lighting): the shell/fins/frame are now a readable
  // DARK GUNMETAL, not near-black. Under the env-room photograph only (no THREE
  // lights) a near-black dielectric has no form at all, so the albedo was raised
  // and the environment response (metalness/envMapIntensity) retuned until the
  // ribbed side and body edges read as dark metal. The door stays bright polished
  // silver for contrast.
  const materials = {
    body: new THREE.MeshStandardMaterial({
      name: 'vault-body-dark', color: linearColor(0x3a414a), metalness: 0.55, roughness: 0.52,
      envMapIntensity: 1.4,
    }),
    fin: new THREE.MeshStandardMaterial({
      name: 'vault-fin-dark', color: linearColor(0x4a525c), metalness: 0.5, roughness: 0.48,
      envMapIntensity: 1.6,
    }),
    finValley: new THREE.MeshStandardMaterial({
      name: 'vault-fin-valley', color: linearColor(0x101318), metalness: 0.2, roughness: 0.8,
      envMapIntensity: 0.4,
    }),
    door: satinSteel(0xd9e0e8, { metalness: 1.0, roughness: 0.28, envMapIntensity: 1.6 }),
    doorPanel: satinSteel(0xc2ccd7, { metalness: 1.0, roughness: 0.34, envMapIntensity: 1.4 }),
    doorSeam: new THREE.MeshStandardMaterial({
      name: 'vault-door-seam', color: linearColor(0x0a0c0f), metalness: 0.4, roughness: 0.72,
      envMapIntensity: 0.35,
    }),
    outerFrame: new THREE.MeshStandardMaterial({
      name: 'vault-outer-frame', color: linearColor(0x2e343b), metalness: 0.45, roughness: 0.55,
      envMapIntensity: 1.2,
    }),
    dot: new THREE.MeshStandardMaterial({
      name: 'vault-perforation', color: linearColor(0x14171b), metalness: 0.5, roughness: 0.55,
      envMapIntensity: 0.7,
    }),
    dotGroove: new THREE.MeshStandardMaterial({
      name: 'vault-perforation-groove', color: linearColor(0x1d2127), metalness: 0.5, roughness: 0.5,
      envMapIntensity: 0.8,
    }),
    grip: new THREE.MeshStandardMaterial({
      name: 'vault-grip-slot', color: linearColor(0x1a1e24), metalness: 0.5, roughness: 0.55,
      envMapIntensity: 0.8,
    }),
    interior: new THREE.MeshStandardMaterial({
      name: 'vault-interior', color: linearColor(0x181c22), metalness: 0.3, roughness: 0.75,
      envMapIntensity: 0.5, side: THREE.BackSide,
    }),
    interiorShelf: new THREE.MeshStandardMaterial({
      name: 'vault-interior-shelf', color: linearColor(0x2a3039), metalness: 0.4, roughness: 0.55,
      envMapIntensity: 0.9,
    }),
    interiorGlow: new THREE.MeshBasicMaterial({
      name: 'vault-interior-glow', color: linearColor(0x22303f), transparent: true, opacity: 0.5,
      toneMapped: false,
    }),
    hinge: new THREE.MeshStandardMaterial({
      name: 'vault-hinge', color: linearColor(0xa8b2be), metalness: 1.0, roughness: 0.26,
      envMapIntensity: 1.5,
    }),
  };
  const barGradient = buildBarGradientTexture();
  const barMaterials = [];
  function createBarMaterial(tone) {
    const material = new THREE.MeshStandardMaterial({
      name: 'vault-bar-' + tone.name,
      map: barGradient,
      emissive: linearColor(tone.tint),
      emissiveMap: barGradient,
      emissiveIntensity: 0.45,
      metalness: 0.65,
      roughness: 0.28,
      envMapIntensity: 1.0,
      // Every bar owns its material so the staged reveal can fade it in on its
      // own schedule; depth writing keeps the front/behind layering exact.
      transparent: true,
      opacity: 0,
      depthWrite: true,
    });
    barMaterials.push(material);
    return material;
  }

  const geometries = [];
  const track = (geometry) => {
    geometries.push(geometry);
    return geometry;
  };

  const spec = VAULT_SPEC;
  const doorSpec = spec.door;
  const interiorSpec = spec.interior;

  /* ---------------- safe shell: rounded-rect tube + back plate ------------ */
  const safe = new THREE.Group();
  safe.name = 'vault-safe';
  root.add(safe);

  const shellShape = roundedRectRingShape(
    spec.width, spec.height, spec.cornerRadius,
    spec.width - spec.wall * 2, spec.height - spec.wall * 2, spec.cornerRadius - spec.wall,
  );
  const shellGeometry = track(extrude(shellShape, spec.depth - 0.08, 0.05, detail.curve));
  shellGeometry.translate(0, 0, -(spec.depth - 0.08) / 2);
  const shell = new THREE.Mesh(shellGeometry, materials.body);
  shell.name = 'vault-shell';
  shell.position.y = spec.height / 2;
  safe.add(shell);

  const backPlateGeometry = track(extrude(
    roundedRectShape(spec.width - 0.12, spec.height - 0.12, spec.cornerRadius - 0.04),
    0.1, 0.03, detail.curve,
  ));
  backPlateGeometry.translate(0, 0, spec.depth / 2 - 0.18);
  const backPlate = new THREE.Mesh(backPlateGeometry, materials.body);
  backPlate.name = 'vault-back-plate';
  backPlate.position.y = spec.height / 2;
  safe.add(backPlate);

  /* ---------------- dark recessed interior ------------------------------- */
  const cavityWidth = spec.width - spec.wall * 2 + 0.02;
  const cavityHeight = spec.height - spec.wall * 2 + 0.02;
  const cavityDepth = interiorSpec.depth;
  const cavityGeometry = track(new THREE.BoxGeometry(cavityWidth, cavityHeight, cavityDepth));
  const cavity = new THREE.Mesh(cavityGeometry, materials.interior);
  cavity.name = 'vault-interior-cavity';
  cavity.position.set(0, spec.height / 2, spec.depth / 2 - 0.1 - cavityDepth / 2);
  safe.add(cavity);

  const shelfGeometry = track(new THREE.BoxGeometry(cavityWidth - 0.1, 0.05, cavityDepth - 0.2));
  for (let index = 0; index < interiorSpec.shelfCount; index += 1) {
    const shelf = new THREE.Mesh(shelfGeometry, materials.interiorShelf);
    shelf.name = 'vault-interior-shelf-' + index;
    const t = (index + 1) / (interiorSpec.shelfCount + 1);
    shelf.position.set(0, spec.wall + (spec.height - spec.wall * 2) * t,
      spec.depth / 2 - 0.1 - cavityDepth / 2);
    safe.add(shelf);
  }
  const glowGeometry = track(new THREE.PlaneGeometry(cavityWidth - 0.36, cavityHeight - 0.36));
  const glow = new THREE.Mesh(glowGeometry, materials.interiorGlow);
  glow.name = 'vault-interior-glow';
  glow.position.set(0, spec.height / 2, spec.depth / 2 - cavityDepth + 0.3);
  glow.rotation.x = -Math.PI / 2;
  safe.add(glow);

  /* ---------------- dense ribbed left side: vertical rounded fins --------- */
  const fins = new THREE.Group();
  fins.name = 'vault-fins';
  safe.add(fins);
  const finGeometry = track(capsule(spec.finRadius, spec.finHeight, detail.finRadial, 5));
  for (let index = 0; index < spec.finCount; index += 1) {
    const t = spec.finCount === 1 ? 0.5 : index / (spec.finCount - 1);
    const fin = new THREE.Mesh(finGeometry, materials.fin);
    fin.name = 'vault-fin-' + index;
    fin.position.set(spec.finX, spec.height / 2, -spec.finSpanZ / 2 + t * spec.finSpanZ);
    fins.add(fin);
  }
  // dark recessed valley panel behind the fins so the ribs read against shadow
  const valleyGeometry = track(new THREE.BoxGeometry(0.05, spec.finHeight + 0.06, spec.finSpanZ + 0.04));
  const valley = new THREE.Mesh(valleyGeometry, materials.finValley);
  valley.name = 'vault-fin-valley';
  valley.position.set(spec.finX + spec.finRadius + 0.012, spec.height / 2, 0);
  safe.add(valley);
  // rounded rails that cap the fin panel top and bottom
  const railGeometry = track(new THREE.BoxGeometry(0.14, 0.1, spec.finSpanZ + 0.16));
  for (const y of [spec.height * 0.5 + spec.finHeight / 2 + 0.02, spec.height * 0.5 - spec.finHeight / 2 - 0.02]) {
    const rail = new THREE.Mesh(railGeometry, materials.outerFrame);
    rail.name = 'vault-fin-rail';
    rail.position.set(spec.finX + 0.01, y, 0);
    fins.add(rail);
  }

  /* ---------------- right-hinged chamfered door + dotted ring ------------- */
  const doorGroup = new THREE.Group();
  doorGroup.name = 'vault-door-group';
  doorGroup.position.set(doorSpec.hingeX, spec.height / 2, doorSpec.hingeZ);
  safe.add(doorGroup);

  const doorShape = roundedRectShape(doorSpec.width, doorSpec.height, 0.14);
  const doorGeometry = track(extrude(doorShape, doorSpec.thickness, doorSpec.bevel, detail.curve));
  doorGeometry.translate(-doorSpec.width / 2 - 0.04, 0, doorSpec.thickness / 2 + 0.02);
  const door = new THREE.Mesh(doorGeometry, materials.door);
  door.name = 'vault-door';
  doorGroup.add(door);

  // dark seam ring between the chamfered door base and the proud face plate, so
  // the chamfer/inset reads as a crisp dark border (reference door language)
  const seamShape = roundedRectRingShape(
    doorSpec.width - 0.06, doorSpec.height - 0.06, 0.15,
    doorSpec.width - 0.3, doorSpec.height - 0.3, 0.08,
  );
  const seamGeometry = track(extrude(seamShape, 0.02, 0.004, detail.curve));
  seamGeometry.translate(-doorSpec.width / 2 - 0.04, 0, doorSpec.thickness + 0.05);
  const doorSeam = new THREE.Mesh(seamGeometry, materials.doorSeam);
  doorSeam.name = 'vault-door-seam';
  doorGroup.add(doorSeam);

  // proud chamfered face plate: brighter silver inset panel with its own bevel
  const plateShape = roundedRectShape(doorSpec.width - 0.34, doorSpec.height - 0.34, 0.09);
  const plateGeometry = track(extrude(plateShape, 0.05, 0.022, detail.curve));
  plateGeometry.translate(-doorSpec.width / 2 - 0.04, 0, doorSpec.thickness + 0.07);
  const doorPlate = new THREE.Mesh(plateGeometry, materials.door);
  doorPlate.name = 'vault-door-plate';
  doorGroup.add(doorPlate);
  const panelShape = roundedRectShape(doorSpec.width - 0.5, doorSpec.height - 0.5, 0.07);
  const panelGeometry = track(extrude(panelShape, 0.018, 0.008, detail.curve));
  panelGeometry.translate(-doorSpec.width / 2 - 0.04, 0, doorSpec.thickness + 0.145);
  const doorPanel = new THREE.Mesh(panelGeometry, materials.doorPanel);
  doorPanel.name = 'vault-door-panel';
  doorGroup.add(doorPanel);

  // circular ring of perforation dots on the door face: a dark recessed groove
  // plus larger/deeper near-black dot cylinders so the ring reads at capture size
  const dots = new THREE.Group();
  dots.name = 'vault-door-dots';
  door.add(dots);
  const grooveGeometry = track(new THREE.TorusGeometry(
    doorSpec.dotRingRadius + 0.012, 0.034, 8, 72,
  ));
  const groove = new THREE.Mesh(grooveGeometry, materials.dotGroove);
  groove.name = 'vault-dot-groove';
  groove.position.set(-doorSpec.width / 2 + 0.02, 0, doorSpec.thickness + 0.155);
  dots.add(groove);
  const dotGeometry = track(new THREE.CylinderGeometry(
    doorSpec.dotRadius, doorSpec.dotRadius, doorSpec.dotDepth, detail.dotRadial,
  ));
  dotGeometry.rotateX(Math.PI / 2);
  for (let index = 0; index < doorSpec.dotCount; index += 1) {
    const angle = (index / doorSpec.dotCount) * TAU;
    const dot = new THREE.Mesh(dotGeometry, materials.dot);
    dot.name = 'vault-door-dot-' + index;
    dot.position.set(
      -doorSpec.width / 2 + 0.02 + Math.cos(angle) * doorSpec.dotRingRadius,
      Math.sin(angle) * doorSpec.dotRingRadius,
      doorSpec.thickness + 0.175,
    );
    dots.add(dot);
  }

  // recessed vertical grip slot on the door's free (left) edge
  const gripGeometry = track(new THREE.BoxGeometry(doorSpec.gripWidth, doorSpec.gripHeight, doorSpec.gripDepth));
  const grip = new THREE.Mesh(gripGeometry, materials.grip);
  grip.name = 'vault-grip-slot';
  grip.position.set(-doorSpec.width + 0.16, 0, doorSpec.thickness + 0.115);
  door.add(grip);
  const gripLipGeometry = track(new THREE.BoxGeometry(
    doorSpec.gripWidth + 0.05, doorSpec.gripHeight + 0.05, 0.012,
  ));
  const gripLip = new THREE.Mesh(gripLipGeometry, materials.outerFrame);
  gripLip.name = 'vault-grip-lip';
  gripLip.position.set(-doorSpec.width + 0.16, 0, doorSpec.thickness + 0.09);
  door.add(gripLip);

  // hinge pins on the right edge
  const hingeGeometry = track(new THREE.CylinderGeometry(0.045, 0.045, 0.26, 12));
  for (const offsetY of [-0.78, 0, 0.78]) {
    const hinge = new THREE.Mesh(hingeGeometry, materials.hinge);
    hinge.name = 'vault-hinge';
    hinge.position.set(spec.width / 2 - spec.wall * 0.4, offsetY, doorSpec.hingeZ + 0.02);
    safe.add(hinge);
  }

  // plinth / feet under the body
  const footGeometry = track(new THREE.BoxGeometry(spec.width * 0.84, 0.08, 0.44));
  for (const z of [-spec.depth * 0.26, spec.depth * 0.26]) {
    const foot = new THREE.Mesh(footGeometry, materials.outerFrame);
    foot.name = 'vault-foot';
    foot.position.set(0, 0.04, z);
    safe.add(foot);
  }

  /* ---------------- one continuous 24-bar helix --------------------------- */
  const barsGroup = new THREE.Group();
  barsGroup.name = 'vault-bars';
  root.add(barsGroup);
  // ONE geometry instance for all 24 bars (identical radius/length/segments).
  const barGeometry = track(new THREE.CapsuleGeometry(
    BAR_SPEC.radius, BAR_SPEC.length, detail.barSegments, detail.barRadial,
  ));
  barGeometry.name = 'vault-bar-shared-geometry';
  const bars = [];
  for (let index = 0; index < BAR_SPEC.count; index += 1) {
    const pose = barPoses(index);
    const material = createBarMaterial(BAR_TONES[pose.tone]);
    const bar = new THREE.Mesh(barGeometry, material);
    bar.name = 'vault-bar-' + index;
    bar.scale.set(1, 1, 1);
    bar.userData = {
      barIndex: index,
      slot: pose.slot,
      thetaDeg: pose.thetaDeg,
      tone: pose.toneName,
      revealOrder: pose.order,
    };
    barsGroup.add(bar);
    bars.push({
      index,
      slot: pose.slot,
      thetaDeg: pose.thetaDeg,
      thetaRad: pose.thetaRad,
      startThetaDeg: pose.startThetaDeg,
      radius: pose.radius,
      tone: pose.toneName,
      length: pose.length,
      top: pose.top,
      order: pose.order,
      mesh: bar,
      geometry: barGeometry,
      material,
      final: pose.final,
      start: pose.start,
    });
  }
  const barGeometryShare = {
    geometry: barGeometry,
    sharedInstance: true,
    geometryCount: new Set(bars.map((bar) => bar.mesh.geometry)).size,
    meshCount: bars.length,
  };

  /* ---------------- poses / bounds --------------------------------------- */
  const openAngle = doorSpec.openAngleDeg * DEG;

  /** Door opening progress: 0 = seated/closed, 1 = fully open. */
  function applyDoor(progress) {
    const eased = easeInOutCubic(clamp(progress, 0, 1));
    doorGroup.rotation.y = lerp(0, openAngle, eased);
  }

  /**
   * Staged bar reveal: bar `order` starts at order*stagger, then slides forward
   * from its start z (final z - advance) into place over barDurationMs while its
   * opacity fades 0 -> 1. At elapsed 0 no bar is visible; at barTotalMs every
   * bar sits exactly in its final pose at opacity 1.
   */
  function applyBars(elapsedMs) {
    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index];
      const startMs = bar.order * ANIMATION_SPEC.barStaggerMs;
      const raw = clamp((elapsedMs - startMs) / ANIMATION_SPEC.barDurationMs, 0, 1);
      const eased = easeOutCubic(raw);
      bar.mesh.position.set(
        lerp(bar.start.position.x, bar.final.position.x, eased),
        lerp(bar.start.position.y, bar.final.position.y, eased),
        lerp(bar.start.position.z, bar.final.position.z, eased),
      );
      bar.mesh.rotation.set(bar.final.rotation.x, bar.final.rotation.y, bar.final.rotation.z);
      // Fade slightly ahead of the slide so a bar is already readable while it
      // advances forward into its slot; both settle at exactly 1/1.0.
      const opacity = raw <= 0 ? 0 : easeOutCubic(clamp(raw / 0.68, 0, 1));
      bar.material.opacity = raw >= 1 ? 1 : opacity;
      bar.mesh.visible = raw > 0;
    }
  }

  /** Static poses: 'final' = open door + all bars visible, 'initial' = closed. */
  function setStaticPose(mode) {
    const final = mode === 'final' || mode === 'closed';
    applyDoor(final ? 1 : 0);
    applyBars(final ? ANIMATION_SPEC.totalMs : 0);
    return final;
  }

  // deterministic bounds (computed from the pose constants, not from the scene
  // graph, so they are identical in Node and the browser)
  function barBounds(stage) {
    // The bars are vertical capsules: the x/z extents are only the radius, the
    // y extent is length/2 + radius. `stage` is 'final' (revealed pose) or
    // 'start' (pushed back by the reveal advance) - the camera frames both.
    let minX = Infinity; let minY = Infinity; let minZ = Infinity;
    let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
    const radial = BAR_SPEC.radius + 0.03;
    for (const bar of bars) {
      const source = stage === 'start' ? bar.start : bar.final;
      const half = bar.length / 2 + BAR_SPEC.radius;
      minX = Math.min(minX, source.position.x - radial);
      maxX = Math.max(maxX, source.position.x + radial);
      minY = Math.min(minY, source.position.y - half);
      maxY = Math.max(maxY, source.position.y + half);
      minZ = Math.min(minZ, source.position.z - radial);
      maxZ = Math.max(maxZ, source.position.z + radial);
    }
    return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
  }

  // The door swings outward around the right hinge; include the open-door box so
  // the fitted camera never clips it in the initial frame.
  function doorBounds(angleRad) {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const x0 = -doorSpec.width - 0.04;
    const x1 = -0.04;
    const y0 = -doorSpec.height / 2 - 0.08;
    const y1 = doorSpec.height / 2 + 0.08;
    const z0 = 0;
    const z1 = doorSpec.thickness + 0.2;
    const box = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
    for (const x of [x0, x1]) {
      for (const y of [y0, y1]) {
        for (const z of [z0, z1]) {
          const wx = doorSpec.hingeX + x * cos + z * sin;
          const wy = spec.height / 2 + y;
          const wz = doorSpec.hingeZ - x * sin + z * cos;
          box.min.x = Math.min(box.min.x, wx);
          box.max.x = Math.max(box.max.x, wx);
          box.min.y = Math.min(box.min.y, wy);
          box.max.y = Math.max(box.max.y, wy);
          box.min.z = Math.min(box.min.z, wz);
          box.max.z = Math.max(box.max.z, wz);
        }
      }
    }
    return box;
  }

  const safeBounds = {
    min: { x: -spec.width / 2 - spec.finRadius - 0.02, y: 0, z: -spec.depth / 2 - 0.1 },
    max: { x: spec.width / 2 + 0.02, y: spec.height + 0.04, z: spec.depth / 2 + 0.42 },
  };
  const bounds = {
    safe: safeBounds,
    barsFinal: barBounds('final'),
    barsStart: barBounds('start'),
    doorClosed: doorBounds(0),
    doorOpen: doorBounds(openAngle),
  };
  // The fitted camera frames the union of every pose the page can show: the
  // closed safe, the opening door, the fully open door and the revealed bars
  // (plus their helical start pose so a revealing bar never clips).
  const allSources = [
    safeBounds,
    bounds.barsFinal,
    bounds.barsStart,
    bounds.doorClosed,
    bounds.doorOpen,
  ];
  const union = {
    min: {
      x: Math.min(...allSources.map((box) => box.min.x)),
      y: Math.min(...allSources.map((box) => box.min.y)),
      z: Math.min(...allSources.map((box) => box.min.z)),
    },
    max: {
      x: Math.max(...allSources.map((box) => box.max.x)),
      y: Math.max(...allSources.map((box) => box.max.y)),
      z: Math.max(...allSources.map((box) => box.max.z)),
    },
  };
  // The trackball can yaw the whole rig freely, so the fit box is made
  // rotation-safe: the plan extents are squared around the vertical axis using
  // the largest plan reach (the bar ring is already the widest part).
  const planReach = Math.max(
    Math.abs(union.min.x), Math.abs(union.max.x), Math.abs(union.min.z), Math.abs(union.max.z),
  );
  bounds.planReach = planReach;
  bounds.all = {
    min: { x: -planReach, y: union.min.y, z: -planReach },
    max: { x: planReach, y: union.max.y, z: planReach },
  };

  const model = {
    modelVersion: MODEL_VERSION,
    quality,
    root,
    safe: {
      group: safe,
      shell,
      backPlate,
      cavity,
      glow,
      fins,
      door: { group: doorGroup, mesh: door, plate: doorPlate, dots, grip, gripLip },
    },
    barsGroup,
    bars,
    /** ONE shared geometry instance for all 24 bars (same size/scale). */
    barGeometry,
    barGeometryShare,
    helix: BAR_HELIX,
    barClearance: barClearanceReport(),
    materials,
    barMaterials,
    barGradient,
    revealOrder: BAR_REVEAL_ORDER.slice(),
    bounds,
    spec,
    barSpec: BAR_SPEC,
    animationSpec: ANIMATION_SPEC,
    openAngleRad: openAngle,
    applyDoor,
    applyBars,
    setStaticPose,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
      for (const material of barMaterials) material.dispose();
      if (barGradient && typeof barGradient.dispose === 'function') barGradient.dispose();
    },
  };

  setStaticPose('final');
  return model;
}

/* ------------------------------------------------------------------ helpers */

/** Apply a whole animation frame: doorProgress 0=closed..1=open, barsElapsedMs. */
export function applyAnimationFrame(model, { doorProgress = 0, barsElapsedMs = 0 } = {}) {
  if (model && typeof model.applyDoor === 'function') model.applyDoor(doorProgress);
  if (model && typeof model.applyBars === 'function') model.applyBars(barsElapsedMs);
}

/** Static pose helper: 'final' (open door + all bars) or 'initial' (closed). */
export function applyStaticPose(model, mode) {
  if (model && typeof model.setStaticPose === 'function') model.setStaticPose(mode);
}

export function getBarAnimationProgress(barsElapsedMs) {
  return clamp(barsElapsedMs / ANIMATION_SPEC.barTotalMs, 0, 1);
}

export function getDoorProgress(elapsedMs) {
  return clamp(elapsedMs / ANIMATION_SPEC.doorDurationMs, 0, 1);
}
