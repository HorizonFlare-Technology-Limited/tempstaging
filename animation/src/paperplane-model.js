/**
 * tekoanimation — paper plane model (docs/paperplane.md).
 *
 * Procedural, deterministic three.js model of a paper plane built to the props
 * contract P3, rebuilt as THREE closed metal solids instead of one folded sheet:
 *
 *   1. a left wing polyhedron and 2. a right wing polyhedron — two mirrored,
 *      flat-shaded wedge volumes whose half thickness rolls to zero over a bead
 *      at the rounded outline, with a spanwise crease splitting each wing into
 *      two large facets;
 *   3. a V-section fuselage column — one lofted prism with a V groove cut along
 *      its spine, a pointed nose prow, a V-cut tail end face and a keel apex.
 *
 * The wing roots are buried in the fuselage flanks just below the column rims,
 * so the centre ridge between the wings slopes front to rear and dives into the
 * body while every rim closes as a rounded bead.
 *
 * The surface is silver "paper-fibre" metal: a seeded procedural colour map with
 * tiny elongated blue pigment flecks, a matching roughness map (tactile sheen),
 * a metalness variation map and a bump map for the fibre grain. No image files,
 * no network, no Math.random — every map is generated from one mulberry32 stream.
 *
 * Local units: plane is about 2.22 (span) x 1.96 (length) x 0.55 (depth).
 */
import * as THREE from 'three';

export const MODEL_VERSION = '2.0.0';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ spec */

export const PLANE_SPEC = Object.freeze({
  // Shared planform frame: x = lateral, z = longitudinal (nose at +Z), y up.
  noseZ: 1.26,
  tailZ: -0.7,
  halfSpan: 1.12,
  // V-section fuselage column: one lofted prism from the nose prow to the V
  // tail. Each station gives the outer half width, the rim height, the keel
  // apex, the height where the vertical shoulder starts, the groove mouth half
  // width and the V-groove depth below the rim. The rim rises toward the tail so
  // the V cut reads as a notched fin; the nose collapses to a prow.
  fuselage: Object.freeze({
    noseZ: 1.26,
    tailZ: -0.7,
    ringPoints: 96,
    loftStations: 76,
    stations: Object.freeze([
      Object.freeze({ z: 1.26, halfWidth: 0.02, topY: 0.055, keelY: 0.03, shoulderY: 0.045, grooveHalf: 0.009, grooveDepth: 0.004 }),
      Object.freeze({ z: 1.1, halfWidth: 0.09, topY: 0.115, keelY: -0.02, shoulderY: 0.055, grooveHalf: 0.045, grooveDepth: 0.025 }),
      Object.freeze({ z: 0.92, halfWidth: 0.155, topY: 0.168, keelY: -0.15, shoulderY: 0.07, grooveHalf: 0.104, grooveDepth: 0.062 }),
      Object.freeze({ z: 0.65, halfWidth: 0.17, topY: 0.178, keelY: -0.26, shoulderY: 0.07, grooveHalf: 0.108, grooveDepth: 0.075 }),
      Object.freeze({ z: 0.25, halfWidth: 0.172, topY: 0.18, keelY: -0.33, shoulderY: 0.065, grooveHalf: 0.11, grooveDepth: 0.078 }),
      Object.freeze({ z: -0.1, halfWidth: 0.17, topY: 0.184, keelY: -0.34, shoulderY: 0.065, grooveHalf: 0.108, grooveDepth: 0.08 }),
      Object.freeze({ z: -0.32, halfWidth: 0.166, topY: 0.19, keelY: -0.315, shoulderY: 0.07, grooveHalf: 0.104, grooveDepth: 0.082 }),
      Object.freeze({ z: -0.48, halfWidth: 0.148, topY: 0.203, keelY: -0.24, shoulderY: 0.08, grooveHalf: 0.094, grooveDepth: 0.082 }),
      Object.freeze({ z: -0.6, halfWidth: 0.128, topY: 0.21, keelY: -0.17, shoulderY: 0.09, grooveHalf: 0.084, grooveDepth: 0.08 }),
      Object.freeze({ z: -0.7, halfWidth: 0.114, topY: 0.196, keelY: -0.12, shoulderY: 0.08, grooveHalf: 0.076, grooveDepth: 0.075 }),
    ]),
  }),
  // Two faceted wing polyhedra. Each is a closed top/bottom shell whose half
  // thickness rolls to zero over `rim` at its rounded outline, so the wing is a
  // solid bevelled wedge instead of a flat fold. The root edge is buried in the
  // fuselage flank and sinks toward the trailing edge so the wing root dives
  // into the body; two flat panels make the upper surface read as facets.
  wing: Object.freeze({
    rootFrontX: 0.105,
    rootFrontZ: 1.02,
    rootRearX: 0.12,
    rootRearZ: -0.26,
    tipX: 1.18,
    tipZ: -0.58,
    outlineSmoothing: 3,
    columns: 92,
    rows: 26,
    thickness: 0.12,
    tipThickness: 0.062,
    rim: 0.03,
    rootBaseY: 0.065,
    rootSink: 0.0,
    creaseSpan: 0.36,
    panel1Slope: 0.055,
    panel2Slope: 0.16,
  }),
});


export const MATERIAL_SPEC = Object.freeze({
  color: '#b9c0c8',
  // The maps below multiply these values (three.js roughnessMap/metalnessMap are
  // multipliers), so the maps are authored around 0.9-0.95 and the effective
  // surface is ~0.75 metalness / ~0.35 roughness.
  metalness: 0.8,
  roughness: 0.38,
  clearcoat: 0.1,
  clearcoatRoughness: 0.4,
  envMapIntensity: 1.35,
  bumpScale: 0.0012,
  specularIntensity: 0.55,
});

export const CAMERA_SPEC = Object.freeze({
  fov: 30,
  azimuthDeg: -136,
  elevationDeg: 24,
  rollDeg: -14,
  fitMargin: 0.84,
  fitMarginNarrow: 0.9,
  narrowStageWidth: 560,
  near: 0.05,
  far: 80,
});

export const IDLE_SPEC = Object.freeze({
  floatAmplitude: 0.032,
  floatPeriod: 7.4,
  driftAmplitude: 0.012,
  driftPeriod: 4.6,
  driftPhase: 1.2,
  pitchDeg: 1.35,
  pitchPeriod: 8.2,
  rollDeg: 1.9,
  rollPeriod: 6.1,
  yawDeg: 0.9,
  yawPeriod: 9.6,
  settleMs: 520,
});

export const SURFACE_SPEC = Object.freeze({
  seed: 0x5eed1a3,
  colorSize: 2048,
  dataSize: 1024,
  bumpSize: 1024,
  metalSize: 512,
  speckles: 260,
  clusters: 12,
  smudges: 16,
  // Mid silver-grey body: the metal needs a darker albedo than paper-white so the
  // studio reflections actually read as metal.
  baseColor: Object.freeze([162, 170, 178]),
  speckleColors: Object.freeze([
    Object.freeze([63, 104, 181]),
    Object.freeze([91, 135, 207]),
    Object.freeze([49, 88, 159]),
    Object.freeze([121, 160, 222]),
  ]),
});

/* --------------------------------------------------------- deterministic rng */

/** Deterministic PRNG (mulberry32). All procedural detail derives from this. */
export function createSeededRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

function hash2i(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------ surface maps */

function makeNoiseGrid(random, size) {
  const grid = new Float32Array(size * size);
  for (let index = 0; index < grid.length; index += 1) grid[index] = random();
  return grid;
}

function sampleNoise(grid, size, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const xa = ((x0 % size) + size) % size;
  const xb = (xa + 1) % size;
  const ya = ((y0 % size) + size) % size;
  const yb = (ya + 1) % size;
  const a = grid[ya * size + xa];
  const b = grid[ya * size + xb];
  const c = grid[yb * size + xa];
  const d = grid[yb * size + xb];
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function makeSpeckleField(random, spec) {
  const speckles = [];
  const base = spec.speckles;
  for (let index = 0; index < base; index += 1) {
    speckles.push({
      x: random(),
      y: random(),
      length: mix(0.008, 0.032, random()),
      width: mix(0.0014, 0.0042, random()),
      angle: random() * Math.PI,
      color: spec.speckleColors[Math.floor(random() * spec.speckleColors.length) % spec.speckleColors.length],
      alpha: mix(0.6, 0.97, random()),
    });
  }
  // A handful of small clusters read like paper pigmentation rather than dust.
  for (let cluster = 0; cluster < spec.clusters; cluster += 1) {
    const cx = random();
    const cy = random();
    const count = 2 + Math.floor(random() * 4);
    for (let index = 0; index < count; index += 1) {
      speckles.push({
        x: clamp01(cx + (random() - 0.5) * 0.05),
        y: clamp01(cy + (random() - 0.5) * 0.05),
        length: mix(0.006, 0.021, random()),
        width: mix(0.0011, 0.0031, random()),
        angle: random() * Math.PI,
        color: spec.speckleColors[Math.floor(random() * spec.speckleColors.length) % spec.speckleColors.length],
        alpha: mix(0.5, 0.9, random()),
      });
    }
  }
  // Faint, larger blue-grey smudges in the fibre.
  for (let index = 0; index < spec.smudges; index += 1) {
    speckles.push({
      x: random(),
      y: random(),
      length: mix(0.02, 0.06, random()),
      width: mix(0.01, 0.03, random()),
      angle: random() * Math.PI,
      color: spec.speckleColors[Math.floor(random() * spec.speckleColors.length) % spec.speckleColors.length],
      alpha: mix(0.05, 0.14, random()),
    });
  }
  return speckles;
}

function paintSpeckle(target, size, speckle, strength) {
  const cx = speckle.x * size;
  const cy = speckle.y * size;
  const halfLength = Math.max(0.75, speckle.length * size * 0.5);
  const halfWidth = Math.max(0.45, speckle.width * size * 0.5);
  const cos = Math.cos(speckle.angle);
  const sin = Math.sin(speckle.angle);
  const pad = halfLength + 2;
  const x0 = Math.max(0, Math.floor(cx - pad));
  const x1 = Math.min(size - 1, Math.ceil(cx + pad));
  const y0 = Math.max(0, Math.floor(cy - pad));
  const y1 = Math.min(size - 1, Math.ceil(cy + pad));
  const alpha = clamp01(speckle.alpha * strength);
  if (alpha <= 0) return;
  const [r, g, b] = speckle.color;
  for (let y = y0; y <= y1; y += 1) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const d = (u * u) / (halfLength * halfLength) + (v * v) / (halfWidth * halfWidth);
      if (d >= 1) continue;
      const falloff = Math.pow(1 - d, 0.62);
      const a = alpha * falloff;
      const offset = (y * size + x) * 4;
      target[offset] = Math.round(mix(target[offset], r, a));
      target[offset + 1] = Math.round(mix(target[offset + 1], g, a));
      target[offset + 2] = Math.round(mix(target[offset + 2], b, a));
    }
  }
}

/**
 * Generate the four procedural surface pixel buffers. Pure function: no DOM, no
 * Math.random, so the output is byte-identical across browsers and reloads.
 */
export function generateSurfaceMaps(options = {}) {
  const spec = SURFACE_SPEC;
  const colorSize = options.colorSize || spec.colorSize;
  const dataSize = options.dataSize || spec.dataSize;
  const bumpSize = options.bumpSize || spec.bumpSize;
  const metalSize = options.metalSize || spec.metalSize;
  const seed = options.seed === undefined ? spec.seed : options.seed;
  const random = createSeededRandom(seed);

  const gLow = makeNoiseGrid(random, 64);
  const gMid = makeNoiseGrid(random, 128);
  const gFibre = makeNoiseGrid(random, 256);
  const gFine = makeNoiseGrid(random, 512);
  const speckles = makeSpeckleField(random, spec);

  const color = new Uint8ClampedArray(colorSize * colorSize * 4);
  const baseColor = spec.baseColor;
  for (let y = 0; y < colorSize; y += 1) {
    const ny = y / colorSize;
    for (let x = 0; x < colorSize; x += 1) {
      const nx = x / colorSize;
      const low = sampleNoise(gLow, 64, nx * 3.1 + 0.7, ny * 2.9 + 0.3);
      const mid = sampleNoise(gMid, 128, nx * 9.4, ny * 8.2);
      // Long, thin paper fibres: strongly anisotropic noise plus two sine
      // striations at slightly different angles.
      const fibre = sampleNoise(gFibre, 256, nx * 21 + ny * 3.5, ny * 150);
      const striation = Math.sin((nx * 17.0 + ny * 2.2) * TAU + low * 4.2)
        + 0.55 * Math.sin((nx * 42.0 - ny * 7.5) * TAU + mid * 3.1);
      const grain = hash2i(Math.imul(x + 1, 0x9e3779b1), Math.imul(y + 1, 0x85ebca6b));
      const shade = (low - 0.5) * 24 + (mid - 0.5) * 9 + (fibre - 0.5) * 9 + striation * 0.8 + (grain - 0.5) * 5;
      const cool = (fibre - 0.5) * 4.2 + (mid - 0.5) * 1.8;
      const offset = (y * colorSize + x) * 4;
      color[offset] = Math.round(clamp01((baseColor[0] + shade - cool * 0.5) / 255) * 255);
      color[offset + 1] = Math.round(clamp01((baseColor[1] + shade + cool * 0.15) / 255) * 255);
      color[offset + 2] = Math.round(clamp01((baseColor[2] + shade + cool) / 255) * 255);
      color[offset + 3] = 255;
    }
  }
  for (const speckle of speckles) paintSpeckle(color, colorSize, speckle, 1);

  function buildField(size, sample) {
    const buffer = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      const ny = y / size;
      for (let x = 0; x < size; x += 1) {
        const nx = x / size;
        const value = clamp01(sample(nx, ny, x, y, size));
        const offset = (y * size + x) * 4;
        const channel = Math.round(value * 255);
        buffer[offset] = channel;
        buffer[offset + 1] = channel;
        buffer[offset + 2] = channel;
        buffer[offset + 3] = 255;
      }
    }
    return buffer;
  }

  const roughness = buildField(dataSize, (nx, ny, x, y, size) => {
    const low = sampleNoise(gLow, 64, nx * 3.1 + 0.7, ny * 2.9 + 0.3);
    const mid = sampleNoise(gMid, 128, nx * 9.4, ny * 8.2);
    const fibre = sampleNoise(gFibre, 256, nx * 21 + ny * 3.5, ny * 150);
    const grain = hash2i(Math.imul(x + 11, 0x27d4eb2f), Math.imul(y + 7, 0x165667b1));
    return 0.9 + (low - 0.5) * 0.06 + (fibre - 0.5) * 0.07 + (mid - 0.5) * 0.03 + (grain - 0.5) * 0.02;
  });
  // Pigment flecks are a touch rougher than the surrounding silver fibre.
  for (const speckle of speckles) {
    paintSpeckle(roughness, dataSize, {
      ...speckle,
      color: [214, 214, 214],
      alpha: clamp01(speckle.alpha) * 0.35,
    }, 1);
  }

  const metalness = buildField(metalSize, (nx, ny) => {
    const low = sampleNoise(gLow, 64, nx * 3.1 + 0.7, ny * 2.9 + 0.3);
    const mid = sampleNoise(gMid, 128, nx * 9.4, ny * 8.2);
    return 0.94 + (low - 0.5) * 0.05 + (mid - 0.5) * 0.03;
  });

  const bump = buildField(bumpSize, (nx, ny, x, y, size) => {
    const fibre = sampleNoise(gFibre, 256, nx * 21 + ny * 3.5, ny * 150);
    const mid = sampleNoise(gMid, 128, nx * 9.4, ny * 8.2);
    const fine = sampleNoise(gFine, 512, nx * 210, ny * 180);
    const grain = hash2i(Math.imul(x + 3, 0x68bc21eb), Math.imul(y + 5, 0x02e5be93));
    return 0.5 + (fibre - 0.5) * 0.24 + (fine - 0.5) * 0.1 + (mid - 0.5) * 0.08 + (grain - 0.5) * 0.08;
  });

  function meanChannel(buffer) {
    let total = 0;
    let count = 0;
    for (let index = 0; index < buffer.length; index += 4) {
      total += buffer[index];
      count += 1;
    }
    return total / count / 255;
  }

  return {
    color,
    roughness,
    metalness,
    bump,
    colorSize,
    dataSize,
    bumpSize,
    metalSize,
    speckles: speckles.length,
    roughnessMean: meanChannel(roughness),
    metalnessMean: meanChannel(metalness),
    seed,
  };
}

function canvasFromPixels(createCanvas, size, pixels) {
  const canvas = createCanvas(size, size);
  if (!canvas) return null;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(size, size);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  return canvas;
}

function setTextureEncoding(texture, srgb) {
  if (THREE.SRGBColorSpace && 'colorSpace' in texture) {
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return;
  }
  texture.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
}

/** Build CanvasTextures from the procedural buffers (browser only). */
export function createSurfaceTextures({ createCanvas, anisotropy = 1, maps = null } = {}) {
  const data = maps || generateSurfaceMaps();
  if (typeof createCanvas !== 'function') {
    return { textures: null, maps: data };
  }
  const colorCanvas = canvasFromPixels(createCanvas, data.colorSize, data.color);
  const roughCanvas = canvasFromPixels(createCanvas, data.dataSize, data.roughness);
  const metalCanvas = canvasFromPixels(createCanvas, data.metalSize, data.metalness);
  const bumpCanvas = canvasFromPixels(createCanvas, data.bumpSize, data.bump);
  if (!colorCanvas || !roughCanvas || !metalCanvas || !bumpCanvas) {
    return { textures: null, maps: data };
  }
  const make = (canvas, srgb, role) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'paperplane-' + role;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.max(1, anisotropy);
    texture.needsUpdate = true;
    texture.userData = { role, procedural: true, local: true, seeded: true };
    setTextureEncoding(texture, srgb);
    return texture;
  };
  return {
    textures: {
      color: make(colorCanvas, true, 'silver-fibre-albedo'),
      roughness: make(roughCanvas, false, 'paper-fibre-roughness'),
      metalness: make(metalCanvas, false, 'speckled-metalness'),
      bump: make(bumpCanvas, false, 'paper-fibre-bump'),
    },
    maps: data,
    canvases: { color: colorCanvas, roughness: roughCanvas, metalness: metalCanvas, bump: bumpCanvas },
  };
}

/* -------------------------------------------------------------- geometry */

const clampUnit = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Smoothstep interpolation of one named station parameter over z. */
function sampleStation(stations, z, key) {
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (z >= first.z) return first[key];
  if (z <= last.z) return last[key];
  for (let index = 0; index < stations.length - 1; index += 1) {
    const a = stations[index];
    const b = stations[index + 1];
    if (z <= a.z && z >= b.z) {
      const span = a.z - b.z;
      const t = span > 1e-9 ? (a.z - z) / span : 0;
      return a[key] + (b[key] - a[key]) * (t * t * (3 - 2 * t));
    }
  }
  return last[key];
}

/**
 * Closed Chaikin corner cutting used for the wing planform: the nose, wingtip
 * and trailing-edge corners become soft rounded beads while the leading and
 * trailing folds stay straight.
 */
function chaikinClosed(polygon, keyA = 'x', keyB = 'y') {
  const next = [];
  const count = polygon.length;
  for (let index = 0; index < count; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % count];
    const first = {};
    first[keyA] = a[keyA] * 0.75 + b[keyA] * 0.25;
    first[keyB] = a[keyB] * 0.75 + b[keyB] * 0.25;
    const second = {};
    second[keyA] = a[keyA] * 0.25 + b[keyA] * 0.75;
    second[keyB] = a[keyB] * 0.25 + b[keyB] * 0.75;
    next.push(first, second);
  }
  return next;
}

/** Uniform arc-length resample of a closed polygon, starting at `startIndex`. */
function resampleRing(points, count, startIndex = 0) {
  const ordered = points.slice(startIndex).concat(points.slice(0, startIndex));
  const cumulative = [0];
  for (let index = 0; index < ordered.length; index += 1) {
    const a = ordered[index];
    const b = ordered[(index + 1) % ordered.length];
    cumulative.push(cumulative[index] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative[cumulative.length - 1];
  const ring = [];
  let segment = 0;
  for (let index = 0; index < count; index += 1) {
    const target = (total * index) / count;
    while (segment < ordered.length - 1 && cumulative[segment + 1] < target) segment += 1;
    const a = ordered[segment];
    const b = ordered[(segment + 1) % ordered.length];
    const length = cumulative[segment + 1] - cumulative[segment];
    const t = length > 1e-9 ? (target - cumulative[segment]) / length : 0;
    ring.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return ring;
}

/** One rounded outline corner: a quadratic bead cut of radius `radius`. */
function roundedCorner(previous, corner, next, radius, segments) {
  const toPrevious = { x: previous.x - corner.x, y: previous.y - corner.y };
  const toNext = { x: next.x - corner.x, y: next.y - corner.y };
  const previousLength = Math.max(1e-9, Math.hypot(toPrevious.x, toPrevious.y));
  const nextLength = Math.max(1e-9, Math.hypot(toNext.x, toNext.y));
  const cut = Math.min(radius, 0.45 * previousLength, 0.45 * nextLength);
  const start = { x: corner.x + (toPrevious.x / previousLength) * cut, y: corner.y + (toPrevious.y / previousLength) * cut };
  const end = { x: corner.x + (toNext.x / nextLength) * cut, y: corner.y + (toNext.y / nextLength) * cut };
  const arc = [];
  for (let index = 0; index < segments; index += 1) {
    const t = index / (segments - 1);
    const mt = 1 - t;
    arc.push({
      x: mt * mt * start.x + 2 * mt * t * corner.x + t * t * end.x,
      y: mt * mt * start.y + 2 * mt * t * corner.y + t * t * end.y,
    });
  }
  return arc;
}

/** Rounded outline through {x, y, radius} control points; keeps sharp V corners. */
function roundedRing(control, segments) {
  const ring = [];
  const count = control.length;
  for (let index = 0; index < count; index += 1) {
    const previous = control[(index - 1 + count) % count];
    const corner = control[index];
    const next = control[(index + 1) % count];
    const arc = roundedCorner(previous, corner, next, corner.radius, segments);
    for (const point of arc) {
      const last = ring[ring.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 1e-6) ring.push(point);
    }
  }
  return ring;
}

/**
 * V-section fuselage ring at one longitudinal station.
 *
 * One closed outline: keel apex -> V flank -> vertical shoulder -> outer rim ->
 * V-groove wall -> groove apex -> mirrored back. Only the corners are bevelled
 * with explicit bead radii, so the trough and the keel stay crisp V cuts while
 * every edge stays soft.
 */
function fuselageRing(spec, z, count) {
  const f = spec.fuselage;
  const stations = f.stations;
  const halfWidth = sampleStation(stations, z, 'halfWidth');
  const topY = sampleStation(stations, z, 'topY');
  const keelY = sampleStation(stations, z, 'keelY');
  const shoulderY = sampleStation(stations, z, 'shoulderY');
  const grooveHalf = Math.min(halfWidth * 0.86, sampleStation(stations, z, 'grooveHalf'));
  const grooveY = topY - sampleStation(stations, z, 'grooveDepth');
  const wallTopY = topY - 0.22 * (topY - shoulderY);
  const rimX = halfWidth * 0.9;
  const flankY = keelY + 0.62 * (shoulderY - keelY);
  const control = [
    { x: 0, y: keelY, radius: 0.022 },
    { x: 0.5 * halfWidth, y: flankY, radius: 0.05 },
    { x: halfWidth, y: shoulderY, radius: 0.035 },
    { x: halfWidth * 0.995, y: wallTopY, radius: 0.03 },
    { x: rimX, y: topY, radius: 0.024 },
    { x: grooveHalf, y: topY, radius: 0.02 },
    { x: 0, y: grooveY, radius: 0.018 },
    { x: -grooveHalf, y: topY, radius: 0.02 },
    { x: -rimX, y: topY, radius: 0.024 },
    { x: -halfWidth * 0.995, y: wallTopY, radius: 0.03 },
    { x: -halfWidth, y: shoulderY, radius: 0.035 },
    { x: -0.5 * halfWidth, y: flankY, radius: 0.05 },
  ];
  return resampleRing(roundedRing(control, 5), count, 0);
}

/** One lofted V-cut fuselage column: nose prow, V groove along the spine, V tail. */
export function buildFuselageGeometry(spec = PLANE_SPEC) {
  const f = spec.fuselage;
  const ringCount = f.ringPoints;
  const stationCount = f.loftStations;
  const positions = [];
  const ringStarts = [];
  for (let station = 0; station < stationCount; station += 1) {
    const t = station / (stationCount - 1);
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
    const z = f.noseZ + (f.tailZ - f.noseZ) * eased;
    const ring = fuselageRing(spec, z, ringCount);
    ringStarts.push(positions.length / 3);
    for (const point of ring) positions.push(point.x, point.y, z);
  }
  const indices = [];
  for (let station = 0; station < stationCount - 1; station += 1) {
    const a = ringStarts[station];
    const b = ringStarts[station + 1];
    for (let index = 0; index < ringCount; index += 1) {
      const next = (index + 1) % ringCount;
      indices.push(a + index, b + index, b + next);
      indices.push(a + index, b + next, a + next);
    }
  }
  const cap = (ringStart, outwardPositiveZ) => {
    const contour = [];
    for (let index = 0; index < ringCount; index += 1) {
      contour.push(new THREE.Vector2(
        positions[(ringStart + index) * 3],
        positions[(ringStart + index) * 3 + 1],
      ));
    }
    let area = 0;
    for (let index = 0; index < contour.length; index += 1) {
      const a = contour[index];
      const b = contour[(index + 1) % contour.length];
      area += a.x * b.y - b.x * a.y;
    }
    const oriented = (area > 0) === outwardPositiveZ;
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i0, i1, i2] of triangles) {
      if (oriented) indices.push(ringStart + i0, ringStart + i1, ringStart + i2);
      else indices.push(ringStart + i0, ringStart + i2, ringStart + i1);
    }
  };
  cap(ringStarts[0], true);
  cap(ringStarts[ringStarts.length - 1], false);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const length = Math.abs(f.noseZ - f.tailZ);
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let index = 0; index < positions.length / 3; index += 1) {
    uv[index * 2] = (positions[index * 3 + 2] - f.tailZ) / length;
    uv[index * 2 + 1] = (index % ringCount) / ringCount;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ----------------------------------------------------------------- wings */

/** Right-wing planform control polygon (absolute model units, x lateral, z chord). */
function wingControlRight(spec) {
  const w = spec.wing;
  return [
    [w.rootFrontX, w.rootFrontZ],
    [0.2, 0.9],
    [0.4, 0.66],
    [0.62, 0.36],
    [0.84, 0.02],
    [w.tipX, w.tipZ],
    [0.95, -0.6],
    [0.7, -0.52],
    [0.46, -0.4],
    [w.rootRearX, w.rootRearZ],
  ];
}

function nearestIndex(points, x, z) {
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const dx = points[index].x - x;
    const dz = points[index].z - z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function polylinePoint(points, t) {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (points.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(points.length - 1, low + 1);
  const blend = scaled - low;
  return {
    x: points[low].x + (points[high].x - points[low].x) * blend,
    z: points[low].z + (points[high].z - points[low].z) * blend,
  };
}

function distanceToPolyline(points, x, z) {
  let best = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    let t = lengthSq > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / lengthSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t - x;
    const pz = a.z + dz * t - z;
    const distance = px * px + pz * pz;
    if (distance < best) best = distance;
  }
  return Math.sqrt(best);
}

/** Wing chord thickness: chunky at the root, tapering to the tip. */
function wingThickness(x, spec) {
  const w = spec.wing;
  const span = Math.max(1e-6, w.tipX - w.rootFrontX);
  const q = clampUnit((Math.abs(x) - w.rootFrontX) / span);
  return w.thickness + (w.tipThickness - w.thickness) * q;
}

/**
 * Wing mid-surface: two flat facets per wing (inboard and outboard of the
 * spanwise crease). The root line sits just proud of the fuselage shoulder and
 * sinks toward the trailing edge, so the wing root dives into the body instead
 * of sitting on it.
 */
function wingSurfaceY(x, z, spec) {
  const w = spec.wing;
  const chordSpan = Math.max(1e-6, w.rootFrontZ - w.rootRearZ);
  const t = clampUnit((w.rootFrontZ - z) / chordSpan);
  const rootY = w.rootBaseY - w.rootSink * t * t;
  const sx = Math.max(0, Math.abs(x) - w.rootFrontX);
  if (sx <= w.creaseSpan) return rootY + w.panel1Slope * sx;
  return rootY + w.panel1Slope * w.creaseSpan + w.panel2Slope * (sx - w.creaseSpan);
}

/**
 * One faceted wing polyhedron: a closed top/bottom shell over the rounded
 * planform whose half thickness rolls to zero over `rim` metres at the outline,
 * welding top and bottom into a rounded bead edge. Two flat upper facets and
 * flat-shaded triangles keep the volume reading as a machined polyhedron.
 */
export function buildWingGeometry(side = 1, spec = PLANE_SPEC) {
  const w = spec.wing;
  const control = wingControlRight(spec).map(([x, z]) => ({ x: x * side, z }));
  let polygon = control;
  for (let iteration = 0; iteration < w.outlineSmoothing; iteration += 1) polygon = chaikinClosed(polygon, 'x', 'z');
  const rootFrontIndex = nearestIndex(polygon, control[0].x, control[0].z);
  const outline = polygon.slice(rootFrontIndex).concat(polygon.slice(0, rootFrontIndex));
  const tipIndex = nearestIndex(outline, control[5].x, control[5].z);
  const rootRearIndex = nearestIndex(outline, control[control.length - 1].x, control[control.length - 1].z);
  const leadArc = outline.slice(0, tipIndex + 1);
  const trailArc = outline.slice(tipIndex, rootRearIndex + 1).reverse();

  const columns = w.columns;
  const rows = w.rows;
  const positions = [];
  const lookup = new Map();
  const inverse = 1e5;
  const addVertex = (x, y, z) => {
    const key = Math.round(x * inverse) + '|' + Math.round(y * inverse) + '|' + Math.round(z * inverse);
    let index = lookup.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      lookup.set(key, index);
      positions.push(x, y, z);
    }
    return index;
  };
  const top = new Int32Array(columns * rows);
  const bottom = new Int32Array(columns * rows);
  for (let column = 0; column < columns; column += 1) {
    const u = column / (columns - 1);
    const lead = polylinePoint(leadArc, u);
    const trail = polylinePoint(trailArc, u);
    for (let row = 0; row < rows; row += 1) {
      const v = 0.5 * (1 - Math.cos((Math.PI * row) / (rows - 1)));
      const x = trail.x + (lead.x - trail.x) * v;
      const z = trail.z + (lead.z - trail.z) * v;
      const distance = distanceToPolyline(outline, x, z);
      const profile = Math.min(1, distance / w.rim);
      const half = 0.5 * wingThickness(x, spec) * Math.sqrt(1 - (1 - profile) * (1 - profile));
      const base = wingSurfaceY(x, z, spec);
      top[column * rows + row] = addVertex(x, base + half, z);
      bottom[column * rows + row] = addVertex(x, base - half, z);
    }
  }
  const indices = [];
  const flip = side < 0;
  const triangle = (a, b, c) => {
    if (a === b || b === c || a === c) return;
    if (flip) indices.push(a, c, b);
    else indices.push(a, b, c);
  };
  for (let column = 0; column < columns - 1; column += 1) {
    for (let row = 0; row < rows - 1; row += 1) {
      const a = top[column * rows + row];
      const b = top[(column + 1) * rows + row];
      const c = top[(column + 1) * rows + row + 1];
      const d = top[column * rows + row + 1];
      triangle(a, c, b);
      triangle(a, d, c);
      const e = bottom[column * rows + row];
      const f = bottom[(column + 1) * rows + row];
      const g = bottom[(column + 1) * rows + row + 1];
      const h = bottom[column * rows + row + 1];
      triangle(e, f, g);
      triangle(e, g, h);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const uv = new Float32Array((positions.length / 3) * 2);
  const uSpan = spec.halfSpan * 2;
  const vSpan = Math.abs(spec.noseZ - spec.tailZ);
  for (let index = 0; index < positions.length / 3; index += 1) {
    uv[index * 2] = (positions[index * 3] + spec.halfSpan) / uSpan;
    uv[index * 2 + 1] = (positions[index * 3 + 2] - spec.tailZ) / vSpan;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------ model */

function collectFitPoints(meshes) {
  const points = [];
  const world = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateMatrix();
    const positions = mesh.geometry.attributes.position;
    const step = Math.max(1, Math.ceil(positions.count / 2600));
    for (let index = 0; index < positions.count; index += step) {
      world.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrix);
      points.push(world.x, world.y, world.z);
    }
  }
  return points;
}

export function createPaperPlane({ createCanvas = null, anisotropy = 1 } = {}) {
  const spec = PLANE_SPEC;
  const maps = generateSurfaceMaps();
  const textured = createSurfaceTextures({ createCanvas, anisotropy, maps });
  const textures = textured.textures;

  const wingMaterial = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : new THREE.Color(MATERIAL_SPEC.color),
    metalness: MATERIAL_SPEC.metalness,
    roughness: MATERIAL_SPEC.roughness,
    clearcoat: MATERIAL_SPEC.clearcoat,
    clearcoatRoughness: MATERIAL_SPEC.clearcoatRoughness,
    envMapIntensity: MATERIAL_SPEC.envMapIntensity,
    specularIntensity: MATERIAL_SPEC.specularIntensity,
    bumpScale: MATERIAL_SPEC.bumpScale,
    flatShading: true,
  });
  wingMaterial.name = 'paperplane-wing-silver-fibre';
  if (textures) {
    wingMaterial.map = textures.color;
    wingMaterial.roughnessMap = textures.roughness;
    wingMaterial.metalnessMap = textures.metalness;
    wingMaterial.bumpMap = textures.bump;
    wingMaterial.needsUpdate = true;
  }
  // The V-column body sits under the wings: a touch darker silver keeps the
  // trough reading as the shadowed inside of the fold without turning it into
  // a separate dark object.
  const fuselageMaterial = wingMaterial.clone();
  fuselageMaterial.name = 'paperplane-fuselage-silver';
  fuselageMaterial.color.setHex(0xb3bac2);
  fuselageMaterial.envMapIntensity = MATERIAL_SPEC.envMapIntensity * 1.02;

  const fuselageGeometry = buildFuselageGeometry(spec);
  const wingRightGeometry = buildWingGeometry(1, spec);
  const wingLeftGeometry = buildWingGeometry(-1, spec);
  const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
  fuselage.name = 'V-cut fuselage column';
  const wingRight = new THREE.Mesh(wingRightGeometry, wingMaterial);
  wingRight.name = 'Right wing polyhedron';
  const wingLeft = new THREE.Mesh(wingLeftGeometry, wingMaterial);
  wingLeft.name = 'Left wing polyhedron';

  const root = new THREE.Group();
  root.name = 'Paper plane';
  root.add(fuselage, wingRight, wingLeft);
  root.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  for (const mesh of [fuselage, wingRight, wingLeft]) mesh.position.sub(center);
  root.updateMatrixWorld(true);
  bounds.setFromObject(root);

  const fitPoints = collectFitPoints([fuselage, wingRight, wingLeft]);
  const stats = {
    vertices: fuselageGeometry.attributes.position.count
      + wingRightGeometry.attributes.position.count
      + wingLeftGeometry.attributes.position.count,
    triangles: (fuselageGeometry.index ? fuselageGeometry.index.count : fuselageGeometry.attributes.position.count) / 3
      + (wingRightGeometry.index ? wingRightGeometry.index.count : wingRightGeometry.attributes.position.count) / 3
      + (wingLeftGeometry.index ? wingLeftGeometry.index.count : wingLeftGeometry.attributes.position.count) / 3,
    fuselageVertices: fuselageGeometry.attributes.position.count,
    wingVertices: wingRightGeometry.attributes.position.count,
    parts: 3,
    speckles: maps.speckles,
  };

  function dispose() {
    fuselageGeometry.dispose();
    wingRightGeometry.dispose();
    wingLeftGeometry.dispose();
    wingMaterial.dispose();
    fuselageMaterial.dispose();
    if (textures) {
      textures.color.dispose();
      textures.roughness.dispose();
      textures.metalness.dispose();
      textures.bump.dispose();
    }
  }

  return {
    root,
    fuselage,
    wingLeft,
    wingRight,
    material: wingMaterial,
    fuselageMaterial,
    textures,
    maps,
    spec,
    stats,
    bounds: {
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
      center: { x: bounds.getCenter(new THREE.Vector3()).x, y: bounds.getCenter(new THREE.Vector3()).y, z: bounds.getCenter(new THREE.Vector3()).z },
      size: { x: bounds.getSize(new THREE.Vector3()).x, y: bounds.getSize(new THREE.Vector3()).y, z: bounds.getSize(new THREE.Vector3()).z },
    },
    fitPoints,
    dispose,
  };
}

/* ------------------------------------------------------------------ idle */

export function idlePose(timeSeconds, settle = 1, spec = IDLE_SPEC) {
  const t = timeSeconds;
  const s = clamp01(settle);
  const float = (Math.sin((t * TAU) / spec.floatPeriod) * spec.floatAmplitude
    + Math.sin((t * TAU) / spec.driftPeriod + spec.driftPhase) * spec.driftAmplitude) * s;
  return {
    float,
    pitchDeg: Math.sin((t * TAU) / spec.pitchPeriod + 0.4) * spec.pitchDeg * s,
    rollDeg: Math.sin((t * TAU) / spec.rollPeriod + 1.7) * spec.rollDeg * s,
    yawDeg: Math.sin((t * TAU) / spec.yawPeriod + 2.2) * spec.yawDeg * s,
  };
}

export function applyIdlePose(root, pose) {
  root.position.set(0, pose.float, 0);
  root.rotation.set(pose.pitchDeg * DEG, pose.yawDeg * DEG, pose.rollDeg * DEG, 'XYZ');
}
