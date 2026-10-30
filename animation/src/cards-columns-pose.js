/**
 * s54 pure pose / camera math for the cards-on-columns animation (no three.js,
 * no DOM). Units are CARD units (CARD_METRICS); columns are scaled to them.
 *
 * World: +y up, column footprint E x E, low column x in [-E,0], high x in [0,E],
 * z in [-E/2,E/2]. Card (portrait) local X = long edge -> world up, local Y (short)
 * -> world -z, local Z (front normal) -> world -x. Lean = rotation about the card's
 * back-bottom edge (the world z-parallel line), top toward +x, onto the high
 * column's side face (plane x = 0). The profile of the card in the lean plane
 * (world x/y of the upright card, relative to the card centre) is supplied by the
 * caller: the sharp box corners (analytic) or the real geometry's convex hull.
 */
export const SPEC_PX = Object.freeze({ footprint: 140, high: 600, low: 500 });
export const PHASE = Object.freeze({ leanStart: 0, leanEnd: 2.5, orbitStart: 2.5, orbitEnd: 6, lightDelay: 0.3 });
export const TOTAL_TIME = PHASE.orbitEnd;
/* Lean angle (deg): >= asin((bevelR + margin) / L) so the pivot stays on the flat
   top of the low column (its top-edge bevel radius = 14 spec px = E/10 units). */
export const LEAN_DEG = 36;
export const CARD_GAP = 0.3;
export const CAMERA = Object.freeze({ azStart: 45, azEnd: 30, elevation: 20, fov: 34 });
/* Azimuth is measured from +z towards -x (sign -1): +x is occluded by the high column. */
export const AZ_SIGN = -1;

const DEG = Math.PI / 180;
export const easeInOut = (t) => { const c = Math.min(1, Math.max(0, t)); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };

export function layout(metrics) {
  const short = Math.min(metrics.width, metrics.height);
  const long = Math.max(metrics.width, metrics.height);
  const E = 4 * (2 * short);
  return {
    short, long, E,
    highH: (E * SPEC_PX.high) / SPEC_PX.footprint,
    lowH: (E * SPEC_PX.low) / SPEC_PX.footprint,
    patternUnit: E / SPEC_PX.footprint,
    meshScale: E / SPEC_PX.footprint / 200,
    bevelR: (14 * E) / SPEC_PX.footprint,
  };
}

/** Sharp box profile (x = -Z_local, y = X_local about the card centre). */
export function boxProfile(metrics) {
  const L = Math.max(metrics.width, metrics.height) / 2;
  const t = metrics.thickness / 2;
  return [[-t, -L], [t, -L], [t, L], [-t, L]];
}

/** Convex hull (monotone chain) of [x,y] pairs. */
export function hull2(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

function rot(phi, x, y) { const c = Math.cos(phi), s = Math.sin(phi); return [x * c + y * s, -x * s + y * c]; }

/**
 * Solve the lean pose. Pivot = back-bottom sharp corner of the upright card. The
 * pivot x is fixed by the END pose (the real profile's furthest +x reach touches
 * x = 0); the vertical offset keeps the lowest profile point exactly on y = lowH.
 */
export function solveLean(lay, profile, leanDeg = LEAN_DEG) {
  const prof = hull2(profile);
  let tHalf = -Infinity, lHalf = Infinity;
  for (const q of prof) { tHalf = Math.max(tHalf, q[0]); lHalf = Math.min(lHalf, q[1]); }
  const corner = [tHalf, lHalf]; // back-bottom corner relative to the centre
  const phiEnd = leanDeg * DEG;
  // reach of the profile about the corner at phiEnd
  let reach = -Infinity;
  for (const q of prof) reach = Math.max(reach, rot(phiEnd, q[0] - corner[0], q[1] - corner[1])[0]);
  const pivotX = -reach;
  function pose(phi) {
    let minY = Infinity;
    for (const q of prof) minY = Math.min(minY, rot(phi, q[0] - corner[0], q[1] - corner[1])[1]);
    const dy = -minY; // lift so the lowest point is exactly on the plane
    const pivotY = lay.lowH + dy;
    const c = rot(phi, -corner[0], -corner[1]); // card centre relative to the pivot
    return { phi, x: pivotX + c[0], y: pivotY + c[1], pivotX, pivotY, dy };
  }
  function extents(phi) {
    const p = pose(phi);
    let maxX = -Infinity, minY = Infinity, minX = Infinity, maxY = -Infinity;
    for (const q of prof) {
      const r = rot(phi, q[0], q[1]);
      maxX = Math.max(maxX, r[0] + p.x); minX = Math.min(minX, r[0] + p.x);
      minY = Math.min(minY, r[1] + p.y); maxY = Math.max(maxY, r[1] + p.y);
    }
    return { maxX, minX, minY, maxY };
  }
  return { phiEnd, pivotX, corner, pose, extents, reach, flatTopEdgeX: -lay.bevelR };
}

/** Time -> lean progress eased 0..1 for a card with the given start delay. */
export function leanProgress(t, delay = 0) {
  return easeInOut((t - PHASE.leanStart - delay) / (PHASE.leanEnd - PHASE.leanStart - delay));
}

export function cardZ(index, metrics) {
  const w = Math.min(metrics.width, metrics.height);
  return (index === 0 ? -1 : 1) * (w / 2 + CARD_GAP / 2);
}

/** Camera azimuth (deg) at time t: held at azStart through phase A, eased to azEnd, held. */
export function azimuthAt(t) {
  const u = easeInOut((t - PHASE.orbitStart) / (PHASE.orbitEnd - PHASE.orbitStart));
  return CAMERA.azStart + (CAMERA.azEnd - CAMERA.azStart) * u;
}

export function cameraPosition(target, distance, azDeg, elDeg = CAMERA.elevation) {
  const az = azDeg * DEG * AZ_SIGN, el = elDeg * DEG;
  return [
    target[0] + distance * Math.sin(az) * Math.cos(el),
    target[1] + distance * Math.sin(el),
    target[2] + distance * Math.cos(az) * Math.cos(el),
  ];
}
