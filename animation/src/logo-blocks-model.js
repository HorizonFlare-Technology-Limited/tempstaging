/**
 * tekoanimation — Logo blocks model (docs/logo-blocks-contract.md, L2 / L3 / L6).
 *
 * Two deterministic compositions for one page, built in a single module:
 *
 *   scene `stack` (reference: K:\HFWorkspace\refs\round3\logo-block.png, fig 4)
 *     four standing rounded-square metal blocks — 1.50 x 1.50 x 0.30 world units,
 *     corner radius 0.255, rolled outer edge radius 0.085, face panel recessed
 *     0.020 below the rim crest, near-black side walls, satin silver faces. The
 *     front block sits at the +X/+Z corner; blocks 1..3 recede on a shallow
 *     -X/-Z diagonal (0.17 face-width X, 0.13 face-width Z, +0.015 Y, -3 deg yaw
 *     per step), so only their rounded front-left edges show. Every block carries
 *     the TEKO arrow embossed as a two-tone *silver/graphite machined relief*
 *     (Lead correction 2026-10-26 — the mark is silver-on-silver, never gold),
 *     built as a dark socket, a visible wall and a chamfered cap (polished
 *     silver / satin graphite) so it reads as a raised metal mark with real
 *     light/shadow, not a flat decal. The hero block stays monochrome silver;
 *     the exposed rear-block edges carry the brand-gold accent bands (bright
 *     #ffd60a on blocks 1-2, deep #7d5a00 on the rear block) — a few thin strips,
 *     never a face bezel (Lead visual review 2026-10-26). The blocks stand on a
 *     dark reflective slab with a polished rounded front lip.
 *
 *   scene `bank` (reference: K:\HFWorkspace\refs\round3\logo-bank-blocks.png, fig 5)
 *     two standing bright-silver plaques — 1.45 x 1.45 x 0.20, corner radius
 *     0.245, rolled bright edge. The left/back plaque carries a recessed panel
 *     with a seeded procedural fluted + dotted texture set (1024^2 albedo /
 *     normal / roughness) and a raised classical bank icon (pediment, four
 *     columns with capitals, two base steps, +0.024 relief); the bank icon caps
 *     sample the same projected panel maps so the dot/flute field runs across the
 *     relief. The right/front plaque carries the same silver/graphite TEKO arrow
 *     relief and a thin gold accent ring around the face edge. Both plaques rest
 *     on a light concrete slab (seeded speckle albedo + normal, 1024^2, mean luma
 *     ~205) with a rounded front lip.
 *
 * Determinism / offline rules (contract L3, L7): everything is constants plus one
 * seeded mulberry32 stream (`SEED`); there is no Math.random, no time/device
 * input, no network access and no image asset in this module. The only textures
 * are the two authored procedural families (bank panel field, concrete surface);
 * both are fixed 1024^2 and seeded. Contact shadows use vertex-alpha geometry,
 * not a baked shadow map. The logo SVG is supplied by the page (the model never
 * fetches it) and parsed at runtime; its two authored fills are mapped to the two
 * machined metal tones (silver / graphite) while brand gold appears only in the
 * accent bands / edge ring. Authored sRGB albedos are converted to linear working
 * values explicitly (`workingColorFromHex`, as in src/shield-model.js) because
 * three r151 ships with ColorManagement disabled.
 *
 * The page/studio layer (`src/logo-blocks-preview.js`) owns lights, environment,
 * cameras, DOM and renderer; each scene group here contains only the composition
 * (meshes, Y up, front faces +Z) plus the authored surface slab and contact
 * shadow planes. `bounds` is the composition bounds (the blocks / plaques), so
 * `bounds.min.y` is the surface height the composition rests on; `fitPoints`
 * additionally carries the surface front-lip extents for camera framing.
 *
 * Public API (frozen for ./logo-blocks-preview.js, contract L3):
 *   MODEL_VERSION, LOGO_SOURCE_PATH, LOGO_PNG_PATH,
 *   STACK_SPEC, BANK_SPEC, MATERIAL_SPEC, CAMERA_SPEC, SEED,
 *   parseTekoLogoSvg(svgText, options),
 *   createLogoBlocksModel({ logoSvgText, logoSourcePath, seed, quality }) -> model
 *     model: { version, spec, materials, scenes: { stack, bank }, getDebug(), dispose() }
 *
 * Everything else (rounded-rect sampling, band/extrusion helpers, texture painters,
 * emblem and bank-icon builders) is internal.
 */

import * as THREE from 'three';

/** Human-readable module version (reported by getDebug(), not the page contract). */
export const MODEL_VERSION = '1.0.0';

/** Project-relative path of the copied TEKO icon used for the embossed emblem. */
export const LOGO_SOURCE_PATH = './assets/logo-blocks/teko2_icon.svg';

/** Project-relative path of the copied PNG mark (used by the page fallback poster). */
export const LOGO_PNG_PATH = './assets/logo-blocks/teko2_icon.png';

/**
 * One fixed seed for every procedural decision in the model (texture noise, dot
 * jitter, speckle placement). Chosen as the ASCII bytes of "logo".
 */
export const SEED = 0x6c6f676f;

/* ------------------------------------------------------------------ maths */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => clamp(value, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothStep(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function degToRad(deg) {
  return deg * DEG;
}

/** Signed area of a closed 2D polygon (positive = counter-clockwise, +Z normal). */
function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function centroidOf(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return new THREE.Vector2(x / points.length, y / points.length);
}

/** Relative luminance of an authored sRGB hex fill (used for emblem tone mapping). */
function relativeLuminance(hex) {
  const value = String(hex || '#000000').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexString(hex) {
  return '#' + (Number(hex) >>> 0).toString(16).padStart(6, '0');
}

/**
 * Deterministic PRNG (mulberry32). All procedural detail in this module derives
 * from one stream created from `SEED`; there is no Math.random anywhere.
 */
function createSeededRandom(seed) {
  let state = (Number(seed) || 0) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise on a wrapping grid (seeded, bilinear) for procedural surfaces. */
function createValueNoise(random, columns, rows) {
  const values = new Float32Array(columns * rows);
  for (let i = 0; i < values.length; i += 1) values[i] = random() * 2 - 1;
  return function sample(u, v) {
    const x = clamp(u, 0, 0.9999) * columns;
    const y = clamp(v, 0, 0.9999) * rows;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const x1 = (x0 + 1) % columns;
    const y1 = (y0 + 1) % rows;
    const a = lerp(values[y0 * columns + x0], values[y0 * columns + x1], fx);
    const b = lerp(values[y1 * columns + x0], values[y1 * columns + x1], fx);
    return lerp(a, b, fy);
  };
}

/* ------------------------------------------------------------------ specs */

/**
 * Scene `stack` (fig 4) — blocks, layout, emblem, accent and surface constants.
 *
 * Profile numbers are measured from the block's back face (profile z 0 = back,
 * `thickness` = front rim crest); the builder recentres them on the block origin.
 * The rolled edge is a quarter circle of radius `rolledEdgeRadius` that starts at
 * the top of the straight dark wall (`wallEndZ`) and ends at the crest; the face
 * panel plane (`faceZ`) is `faceRecess` below that crest, inside the rim chamfer
 * table. The accent band is a thin gold shell that follows the rolled edge from
 * `accent.zStart` (wall) to `accent.zEnd` (just under the crest) on the exposed
 * rear blocks only (see `accent.frontBand`), so the coloured strips read as edge
 * lights rather than a bezel around the hero face.
 */
export const STACK_SPEC = Object.freeze({
  blockCount: 4,
  faceSize: 1.5,
  thickness: 0.3,
  cornerRadius: 0.255,
  rolledEdgeRadius: 0.085,
  faceRecess: 0.02,
  /** Profile z: top of the straight dark side wall. */
  wallEndZ: 0.215,
  /** Profile z: rounded-square rim crest (frontmost silhouette). */
  crestZ: 0.3,
  /** Profile z: recessed face panel plane (`crestZ - faceRecess`). */
  faceZ: 0.28,
  /** Inward offset of the face panel edge (rim + chamfer width). */
  panelInset: 0.112,
  /**
   * Rim chamfer from the crest down/inward to the panel edge as [inset, profileZ]
   * pairs; the last entry must equal `panelInset` / `faceZ`.
   */
  rimChamfer: Object.freeze([
    Object.freeze([0.098, 0.2895]),
    Object.freeze([0.107, 0.2815]),
    Object.freeze([0.112, 0.28]),
  ]),
  /** Outline sampling: points per rounded corner / per straight edge. */
  cornerSegments: 8,
  edgeSegments: 12,
  /** Rings used to tessellate the rolled edge quarter circle. */
  rimArcSegments: 6,
  /**
   * Layout: block `index` sits at
   *   (frontX + stepX*index, surfaceTopY + frontY + stepY*index, frontZ + stepZ*index)
   * with yaw stepYawDeg*index. Block 0 is the hero at the +X/+Z corner; each step
   * moves -0.20 face widths in X and -0.067 in Z (Lead visual review 2026-10-26:
   * spread laterally / less depth so the group silhouette is landscape like fig 4,
   * the earlier -0.17 / -0.13 diagonal read too tall and narrow).
   */
  layout: Object.freeze({
    frontX: 0.38,
    frontY: 0.75,
    frontZ: 0.2,
    stepX: -0.3,
    stepZ: -0.1,
    stepY: 0.015,
    stepYawDeg: -3,
  }),
  emblem: Object.freeze({
    /** Emblem width as a fraction of the face width (0.52 of 1.50). */
    width: 0.52,
    /** Centre offset as a fraction of the face width. */
    centerX: 0,
    centerY: 0.015,
    /** Machined relief: cap plane above the recessed face panel. */
    relief: 0.022,
    /** Wall skirt base sunk into the face panel (hides the contact seam). */
    wallInset: 0.003,
    /** Top of the visible vertical wall; the chamfer rises from here to `relief`. */
    wallTop: 0.01,
    /** Inward chamfer rings (scale about the contour centroid) up to the cap. */
    chamferScales: Object.freeze([0.988, 0.976, 0.964, 0.952]),
    /** Dark socket outline scale around each SVG sub-shape centroid. */
    socketScale: 1.05,
    /** Socket plane above the face panel (kept clear of the cap/wall). */
    socketLift: 0.001,
    /** Cubic flattening segments per SVG curve. */
    curveSegments: 12,
  }),
  accent: Object.freeze({
    /** Gold band profile-z window (height = 0.075 just behind the crest). */
    zStart: 0.215,
    zEnd: 0.29,
    height: 0.075,
    /** Shell offset outward from the rolled edge (avoids z-fighting). */
    outwardOffset: 0.0016,
    segments: 5,
    brightColor: 0xffd60a,
    deepColor: 0x7d5a00,
    emissiveColor: 0xffb300,
    emissiveIntensity: 0.55,
    /** Rear-most block takes the deep-gold variant. */
    rearIndex: 3,
    /**
     * Lead visual review 2026-10-26: the hero block stays monochrome silver (the
     * reference's coloured strips only appear on the exposed rear-block edges), so
     * the front block carries no accent band; blocks 1-2 are bright gold and the
     * rear block is deep gold. The band is clipped to the left-facing perimeter
     * (the exposed edge) instead of being a full ring, so it reads as a vertical
     * strip rather than a gold border.
     */
    frontIndex: 0,
    frontBand: false,
    /** Outward normal-x threshold for the left-facing accent strip. */
    faceNormalMaxX: -0.2,
  }),
  surface: Object.freeze({
    topY: 0,
    width: 14,
    backZ: -6.5,
    frontTopZ: 1.5,
    lipRadius: 0.16,
    bottomY: -0.7,
    lipSegments: 7,
  }),
  /**
   * Camera-fit lip probe: a strip of surface front-lip points (Lead visual review
   * 2026-10-26: the surface extents must be in fitPoints). The strip spans
   * `lipHalfWidth` around the composition centre so the fit frames blocks + table
   * lip and the projected composition stays landscape (objectRect aspect ~1.3,
   * blocks dominant) instead of tall/narrow.
   */
  fit: Object.freeze({
    lipCenterOffset: 0,
    lipHalfWidth: 1.2,
  }),
  shadow: Object.freeze({
    alpha: 0.5,
    radiusX: 1.32,
    radiusZ: 0.82,
    centerX: -0.02,
    centerZ: 0.02,
    raise: 0.0016,
    rings: 12,
    segments: 48,
  }),
});

/**
 * Scene `bank` (fig 5) — plaque, icon, panel-texture, ring and surface constants.
 * Profile numbers follow the same back-face convention as STACK_SPEC.
 */
export const BANK_SPEC = Object.freeze({
  blockCount: 2,
  faceSize: 1.45,
  thickness: 0.2,
  cornerRadius: 0.245,
  rolledEdgeRadius: 0.055,
  faceRecess: 0.016,
  wallEndZ: 0.145,
  crestZ: 0.2,
  faceZ: 0.184,
  panelInset: 0.086,
  rimChamfer: Object.freeze([
    Object.freeze([0.072, 0.1885]),
    Object.freeze([0.086, 0.184]),
  ]),
  cornerSegments: 8,
  edgeSegments: 12,
  rimArcSegments: 5,
  /** Centre y of both plaques; plaque half height 0.725 rests on the slab top. */
  layout: Object.freeze({
    plaqueY: 0.78,
    /**
     * Lead visual review 2026-10-26: the bank plaque was hidden behind the logo
     * plaque. It now sits further left and only slightly behind so its fluted +
     * dotted face and bank icon read beside the logo plaque (fig 5: bank left /
     * back, logo right / front, slight overlap).
     */
    bank: Object.freeze({ x: -0.82, y: 0.78, z: 0.06, yawDeg: 16 }),
    logo: Object.freeze({ x: 0.43, y: 0.78, z: 0.3, yawDeg: -10 }),
  }),
  emblem: Object.freeze({
    width: 0.5,
    centerX: 0,
    centerY: 0.01,
    relief: 0.02,
    wallInset: 0.003,
    wallTop: 0.009,
    chamferScales: Object.freeze([0.988, 0.976, 0.964, 0.952]),
    socketScale: 1.05,
    socketLift: 0.001,
    curveSegments: 12,
  }),
  /** Thin gold accent ring on the logo plaque: flat band on the panel plane. */
  ring: Object.freeze({
    insetStart: 0.086,
    insetEnd: 0.102,
    width: 0.016,
    raise: 0.0012,
  }),
  /**
   * Raised classical bank icon (left plaque). Normalised icon coordinates run
   * x -0.50..0.50, y -0.50..0.46; every part is a rounded extruded shape in the
   * same polished panel material so the fluted/dotted maps continue over the
   * relief.
   */
  bankIcon: Object.freeze({
    width: 0.47,
    relief: 0.024,
    centerY: 0,
    cornerRadius: 0.014,
    cornerSegments: 5,
    bevelSize: 0.01,
    bevelThickness: 0.003,
    bevelSegments: 2,
    /** Dark separation plate under every icon part (shadow / depth cue). */
    shadowScale: 1.035,
    shadowLift: 0.0005,
  }),
  /** Procedural fluted + dotted panel texture field (fig 5 left plaque). */
  panel: Object.freeze({
    textureSize: 1024,
    /** Vertical flute period in face units (~8.5 px at 1024 over 1.45). */
    flutePeriod: 0.012,
    /** Bright-dot grid spacing in face units. */
    dotSpacing: 0.05,
    /** Seeded dot-position jitter in face units (subtle: keeps a regular grid). */
    dotJitter: 0.0035,
    /** Dot radius in face units (small, even bright dots). */
    dotRadius: 0.0085,
    reliefStrength: 1.05,
    albedoBase: 203,
    dotGain: 24,
    fluteGain: 4,
    roughnessBase: 0.3,
  }),
  /** Procedural concrete surface field (fig 5 slab). */
  surface: Object.freeze({
    topY: 0.055,
    width: 14,
    backZ: -6.5,
    frontTopZ: 1.8,
    lipRadius: 0.16,
    bottomY: -0.95,
    lipSegments: 7,
    textureSize: 1024,
    textureTile: 4,
    targetMeanLuma: 205,
    normalStrength: 0.6,
    speckCells: 88,
  }),
  /** Camera-fit lip probe (see STACK_SPEC.fit; bank lip strip is a bit narrower). */
  fit: Object.freeze({
    lipCenterOffset: 0,
    lipHalfWidth: 1.1,
  }),
  shadow: Object.freeze({
    alpha: 0.5,
    radiusX: 0.98,
    radiusZ: 0.62,
    offsetZ: 0.18,
    raise: 0.0015,
    rings: 10,
    segments: 40,
  }),
});

/**
 * Every material in the model. `color` is the authored sRGB albedo (converted to
 * linear working values by workingColorFromHex at creation); no baked lighting is
 * stored in any map. The only mapped materials are the two procedural surfaces
 * (`bankPanel` = fluted + dotted field, `concrete` = speckle slab): every plain
 * metal material is map-free. Brand gold is confined to the accent band / edge
 * ring (`goldEdge` carries the subtle emissive); the emblem is silver-on-silver
 * (`emblemSilver` polished cap from the SVG's bright fill, `emblemGraphite` satin
 * cap from the SVG's deep fill) over the dark `socket` outline.
 */
export const MATERIAL_SPEC = Object.freeze({
  stackFace: Object.freeze({ color: 0x8a8f96, metalness: 1.0, roughness: 0.32, envMapIntensity: 1.0, role: 'satin silver front face (fig 4)' }),
  stackBody: Object.freeze({ color: 0x2c2f34, metalness: 1.0, roughness: 0.24, envMapIntensity: 1.0, role: 'dark metal side wall / back (fig 4)' }),
  stackRim: Object.freeze({ color: 0xd6dbe1, metalness: 1.0, roughness: 0.18, envMapIntensity: 1.1, role: 'rolled polished rim crest (fig 4)' }),
  bankFace: Object.freeze({ color: 0xcfd3d9, metalness: 1.0, roughness: 0.26, envMapIntensity: 1.05, role: 'bright polished silver plaque face (fig 5)' }),
  bankBody: Object.freeze({ color: 0xb9bec6, metalness: 1.0, roughness: 0.2, envMapIntensity: 1.0, role: 'bright silver plaque wall / back (fig 5)' }),
  bankRim: Object.freeze({ color: 0xeef2f6, metalness: 1.0, roughness: 0.12, envMapIntensity: 1.1, role: 'bright rolled edge (fig 5)' }),
  goldBright: Object.freeze({ color: 0xffd60a, metalness: 1.0, roughness: 0.22, envMapIntensity: 1.1, role: 'brand gold (bright, accents only)' }),
  goldDeep: Object.freeze({ color: 0x7d5a00, metalness: 1.0, roughness: 0.3, envMapIntensity: 1.0, role: 'brand gold (deep, rear accent band)' }),
  goldEdge: Object.freeze({ color: 0xffd60a, metalness: 0.9, roughness: 0.25, envMapIntensity: 1.0, emissive: 0xffb300, emissiveIntensity: 0.55, role: 'gold accent band / face edge ring (subtle emissive)' }),
  emblemSilver: Object.freeze({ color: 0xd6dbe1, metalness: 1.0, roughness: 0.18, envMapIntensity: 1.1, role: 'machined emblem cap from the SVG bright fill (polished silver)' }),
  emblemGraphite: Object.freeze({ color: 0x6a7078, metalness: 1.0, roughness: 0.36, envMapIntensity: 0.8, role: 'machined emblem cap from the SVG deep fill (satin graphite; tuned so it reads visibly darker than the silver cap)' }),
  socket: Object.freeze({ color: 0x2a2d31, metalness: 0.9, roughness: 0.5, envMapIntensity: 0.7, role: 'emblem socket outline' }),
  concrete: Object.freeze({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.85,
    envMapIntensity: 0.6,
    maps: Object.freeze(['albedo', 'normal']),
    albedoTone: 0xd9d9d7,
    role: 'bank-scene slab (procedural speckle albedo + normal; the map carries the measured tone)',
  }),
  stackFloor: Object.freeze({ color: 0x23262b, metalness: 0.35, roughness: 0.3, envMapIntensity: 0.9, role: 'dark reflective surface slab (fig 4)' }),
  bankPanel: Object.freeze({
    color: 0xffffff,
    metalness: 1.0,
    roughness: 1.0,
    envMapIntensity: 1.05,
    maps: Object.freeze(['albedo', 'normal', 'roughness']),
    albedoTone: 0xd6dae0,
    role: 'bright silver fluted + dotted panel (procedural maps carry tone + finish)',
  }),
  bankIcon: Object.freeze({
    color: 0xffffff,
    colorScale: 1.14,
    metalness: 1.0,
    roughness: 0.14,
    envMapIntensity: 1.25,
    maps: Object.freeze(['albedo', 'normal']),
    albedoTone: 0xe4e8ee,
    role: 'polished silver classical-bank icon relief (same projected panel maps, tighter polish + a touch brighter than the field so the key light catches the pediment/column edges)',
  }),
  bankShadow: Object.freeze({
    color: 0x2f3237,
    metalness: 0.0,
    roughness: 0.95,
    envMapIntensity: 0.25,
    role: 'dark separation/shadow plate under the raised bank icon (geometry-only depth cue)',
  }),
  bankIconEdge: Object.freeze({
    color: 0xf2f6fa,
    metalness: 1.0,
    roughness: 0.1,
    envMapIntensity: 1.25,
    role: 'polished plain silver for the bank-icon chamfer/side walls (the caps keep the projected fluted/dotted maps)',
  }),
  contactShadow: Object.freeze({
    color: 0x000000,
    kind: 'shadow',
    role: 'soft contact shadow (vertex-alpha geometry, no baked shadow map)',
  }),
});

/**
 * Fixed three-quarter cameras per scene (contract L2). The previewer applies its
 * own dolly fit from `fitPoints`; these are the default poses, fov and the orbit
 * clamps it exposes (yaw clamps are absolute azimuth degrees, +/-16 deg around the
 * default; pitch clamps are absolute elevation degrees).
 */
export const CAMERA_SPEC = Object.freeze({
  stack: Object.freeze({
    fov: 30,
    near: 0.05,
    far: 60,
    azimuthDeg: 24,
    elevationDeg: 13,
    yawMinDeg: 8,
    yawMaxDeg: 40,
    yawRangeDeg: 16,
    pitchMinDeg: -4,
    pitchMaxDeg: 30,
    dragSensitivity: 0.16,
    fitMargin: 0.88,
    fitMarginNarrow: 0.84,
    narrowStageWidth: 520,
    targetYOffset: 0,
  }),
  bank: Object.freeze({
    fov: 30,
    near: 0.05,
    far: 60,
    azimuthDeg: 18,
    elevationDeg: 9,
    yawMinDeg: 2,
    yawMaxDeg: 34,
    yawRangeDeg: 16,
    pitchMinDeg: -4,
    pitchMaxDeg: 26,
    dragSensitivity: 0.16,
    fitMargin: 0.82,
    fitMarginNarrow: 0.78,
    narrowStageWidth: 520,
    targetYOffset: 0,
  }),
});

/* ------------------------------------------------------ colour + textures */

function srgbChannelToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * three r151 ships with ColorManagement disabled (legacy mode), so a hex handed
 * to the Color constructor is treated as a working-space value and renders far
 * too bright once the sRGB output encoding is applied. Convert the authored sRGB
 * hex to linear working values explicitly (same helper as src/shield-model.js).
 */
function workingColorFromHex(hex) {
  const color = new THREE.Color();
  color.setRGB(
    srgbChannelToLinear(((hex >> 16) & 255) / 255),
    srgbChannelToLinear(((hex >> 8) & 255) / 255),
    srgbChannelToLinear((hex & 255) / 255),
  );
  return color;
}

function createCanvas(width, height) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('logo-blocks-model: a DOM document is required to paint the procedural textures');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function get2d(canvas) {
  const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d', { willReadFrequently: true }) : null;
  if (!context) throw new Error('logo-blocks-model: 2D canvas context unavailable');
  return context;
}

function createCanvasTexture(canvas, name, options = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  if (options.srgb) texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = 8;
  texture.wrapS = options.wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = options.wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Triangle count of a geometry (indexed or not). */
function triangleCountOf(geometry) {
  if (!geometry) return 0;
  if (geometry.index) return geometry.index.count / 3;
  const position = geometry.getAttribute('position');
  return position ? position.count / 3 : 0;
}

/**
 * Procedural fluted + dotted panel field (fig 5, left plaque).
 *
 * Height field = vertical flute cosine (period `flutePeriod` face units) +
 * seeded bright-dot bumps (grid `dotSpacing`, seeded jitter `dotJitter`, radius
 * `dotRadius`). One pass writes three fixed 1024^2 maps:
 *   albedo    sRGB silver field, brighter ridges and dot crowns;
 *   roughness linear map (multiplied by bankPanel.roughness = 1.0), smoother dots;
 *   normal    tangent-space normal from the analytic height field.
 * Nothing is sampled from the network or from Math.random.
 */
function buildPanelMaps(spec, faceSize, seed) {
  const size = spec.textureSize;
  const pxPerUnit = size / faceSize;
  const flutePeriodPx = spec.flutePeriod * pxPerUnit;
  const dotSpacingPx = spec.dotSpacing * pxPerUnit;
  const random = createSeededRandom(seed ^ 0x50414e4c); // "PANL"
  const micro = createValueNoise(random, 192, 192);

  // Seeded bright-dot lattice (one dot per cell, jittered inside its cell).
  const cells = Math.max(4, Math.round(size / dotSpacingPx));
  const cell = size / cells;
  const jitterPx = Math.min(0.46, spec.dotJitter / spec.dotSpacing) * cell;
  const dots = new Array(cells * cells);
  for (let gy = 0; gy < cells; gy += 1) {
    for (let gx = 0; gx < cells; gx += 1) {
      dots[gy * cells + gx] = {
        x: (gx + 0.5) * cell + (random() - 0.5) * 2 * jitterPx,
        y: (gy + 0.5) * cell + (random() - 0.5) * 2 * jitterPx,
        r: spec.dotRadius * pxPerUnit * (0.94 + random() * 0.12),
      };
    }
  }

  const count = size * size;
  const fluteField = new Float32Array(count);
  const bumpField = new Float32Array(count);
  const heightField = new Float32Array(count);

  for (let y = 0; y < size; y += 1) {
    const gy = Math.floor(y / cell);
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const flute = Math.cos(((x + 0.5) / flutePeriodPx) * TAU);
      const gx = Math.floor(x / cell);
      let bump = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        const cy = gy + oy;
        if (cy < 0 || cy >= cells) continue;
        for (let ox = -1; ox <= 1; ox += 1) {
          const cx = gx + ox;
          if (cx < 0 || cx >= cells) continue;
          const dot = dots[cy * cells + cx];
          const dx = x + 0.5 - dot.x;
          const dy = y + 0.5 - dot.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < dot.r) {
            const t = 1 - distance / dot.r;
            const value = t * t * (3 - 2 * t);
            if (value > bump) bump = value;
          }
        }
      }
      fluteField[i] = flute;
      bumpField[i] = bump;
      heightField[i] = flute * 0.55 + bump * 1.35 + micro(x / size, y / size) * 0.05;
    }
  }

  // --- albedo (sRGB silver field with brighter dot crowns / flute ridges).
  const albedoCanvas = createCanvas(size, size);
  const albedoContext = get2d(albedoCanvas);
  const albedoImage = albedoContext.createImageData(size, size);
  const albedoData = albedoImage.data;
  let lumaSum = 0;
  for (let i = 0; i < count; i += 1) {
    const microValue = micro((i % size) / size, Math.floor(i / size) / size);
    const value = spec.albedoBase + fluteField[i] * spec.fluteGain + bumpField[i] * spec.dotGain + microValue * 2.5;
    const v = clamp(value, 0, 255);
    const o = i * 4;
    albedoData[o] = clamp(v - 1, 0, 255);
    albedoData[o + 1] = clamp(v, 0, 255);
    albedoData[o + 2] = clamp(v + 3, 0, 255);
    albedoData[o + 3] = 255;
    lumaSum += 0.2126 * albedoData[o] + 0.7152 * albedoData[o + 1] + 0.0722 * albedoData[o + 2];
  }
  albedoContext.putImageData(albedoImage, 0, 0);

  // --- roughness (linear; smoother dot crowns, slightly rougher flute grooves).
  const roughCanvas = createCanvas(size, size);
  const roughContext = get2d(roughCanvas);
  const roughImage = roughContext.createImageData(size, size);
  const roughData = roughImage.data;
  for (let i = 0; i < count; i += 1) {
    const roughValue = clamp(
      spec.roughnessBase + (0.5 - fluteField[i] * 0.5) * 0.1 - bumpField[i] * 0.12 + micro((i % size) / size, Math.floor(i / size) / size) * 0.02,
      0.14,
      0.46,
    );
    const encoded = Math.round(roughValue * 255);
    const o = i * 4;
    roughData[o] = encoded;
    roughData[o + 1] = encoded;
    roughData[o + 2] = encoded;
    roughData[o + 3] = 255;
  }
  roughContext.putImageData(roughImage, 0, 0);

  // --- normal map from the analytic height field.
  const normalCanvas = createCanvas(size, size);
  const normalContext = get2d(normalCanvas);
  const normalImage = normalContext.createImageData(size, size);
  const normalData = normalImage.data;
  const strength = spec.reliefStrength;
  let maxTilt = 0;
  for (let y = 0; y < size; y += 1) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < size - 1 ? y + 1 : size - 1;
    for (let x = 0; x < size; x += 1) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < size - 1 ? x + 1 : size - 1;
      const i = y * size + x;
      const dhdu = (heightField[y * size + xp] - heightField[y * size + xm]) * 0.5;
      const dhdv = -(heightField[yp * size + x] - heightField[ym * size + x]) * 0.5;
      let nx = -dhdu * strength;
      let ny = -dhdv * strength;
      const length = Math.sqrt(nx * nx + ny * ny + 1) || 1;
      nx /= length;
      ny /= length;
      const nz = 1 / length;
      const o = i * 4;
      normalData[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[o + 3] = 255;
      const tilt = Math.sqrt(nx * nx + ny * ny);
      if (tilt > maxTilt) maxTilt = tilt;
    }
  }
  normalContext.putImageData(normalImage, 0, 0);

  const textures = {
    albedo: createCanvasTexture(albedoCanvas, 'logo-blocks-bank-panel-albedo', { srgb: true }),
    normal: createCanvasTexture(normalCanvas, 'logo-blocks-bank-panel-normal'),
    roughness: createCanvasTexture(roughCanvas, 'logo-blocks-bank-panel-roughness'),
  };
  return {
    textures,
    stats: {
      size,
      faceSize,
      dotSeed: (seed ^ 0x50414e4c) >>> 0,
      dotCount: dots.length,
      dotSpacing: spec.dotSpacing,
      dotSpacingPx: Math.round(dotSpacingPx * 10) / 10,
      dotRadius: spec.dotRadius,
      flutePeriod: spec.flutePeriod,
      flutePeriodPx: Math.round(flutePeriodPx * 100) / 100,
      cellPx: Math.round(cell * 100) / 100,
      meanLuma: Math.round(lumaSum / count),
      maxTilt: Math.round(maxTilt * 1000) / 1000,
    },
  };
}

/**
 * Procedural concrete surface field (fig 5 slab): seeded multi-scale mottling,
 * fine grain and a wrapped speckle lattice, written into fixed 1024^2 albedo +
 * normal maps that tile seamlessly (`textureTile` world units per repeat). The
 * albedo mean luma is normalised to `targetMeanLuma` (~205) so the slab reads as
 * the reference's light concrete.
 */
function buildConcreteMaps(spec, seed) {
  const size = spec.textureSize;
  const random = createSeededRandom(seed ^ 0x434f4e43); // "CONC"
  const blotchLow = createValueNoise(random, 6, 6);
  const blotchMid = createValueNoise(random, 24, 24);
  const grain = createValueNoise(random, 160, 160);

  // Wrapped speckle lattice (one speckle per cell, jittered inside its cell).
  const speckCells = spec.speckCells;
  const speckCell = size / speckCells;
  const speckles = new Array(speckCells * speckCells);
  for (let gy = 0; gy < speckCells; gy += 1) {
    for (let gx = 0; gx < speckCells; gx += 1) {
      speckles[gy * speckCells + gx] = {
        x: (gx + 0.5) * speckCell + (random() - 0.5) * speckCell * 0.7,
        y: (gy + 0.5) * speckCell + (random() - 0.5) * speckCell * 0.7,
        r: speckCell * (0.08 + random() * 0.14),
        tone: (random() < 0.55 ? -1 : 1) * (0.4 + random() * 0.6),
      };
    }
  }

  const count = size * size;
  const lumaField = new Float32Array(count);
  const heightField = new Float32Array(count);
  for (let y = 0; y < size; y += 1) {
    const gy = Math.floor(y / speckCell);
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const u = x / size;
      const v = y / size;
      const low = blotchLow(u, v);
      const mid = blotchMid(u, v);
      const grainValue = grain(u, v);
      let speck = 0;
      const gx = Math.floor(x / speckCell);
      if (gx >= 0 && gx < speckCells && gy >= 0 && gy < speckCells) {
        const s = speckles[gy * speckCells + gx];
        const dx = x + 0.5 - s.x;
        const dy = y + 0.5 - s.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < s.r) speck = s.tone * smoothStep(1 - distance / s.r);
      }
      lumaField[i] = spec.targetMeanLuma + low * 7 + mid * 4 + grainValue * 3 + speck * 16;
      heightField[i] = low * 0.8 + mid * 0.35 + grainValue * 0.2 + speck * 0.5;
    }
  }

  // Normalise the tinted albedo to the measured mean luma (~205).
  const tint = [2, 1, -3];
  let mean = 0;
  for (let i = 0; i < count; i += 1) {
    const v = clamp(lumaField[i], 0, 255);
    mean += 0.2126 * clamp(v + tint[0], 0, 255) + 0.7152 * clamp(v + tint[1], 0, 255) + 0.0722 * clamp(v + tint[2], 0, 255);
  }
  mean /= count;
  const offset = spec.targetMeanLuma - mean;

  const albedoCanvas = createCanvas(size, size);
  const albedoContext = get2d(albedoCanvas);
  const albedoImage = albedoContext.createImageData(size, size);
  const albedoData = albedoImage.data;
  let finalLuma = 0;
  for (let i = 0; i < count; i += 1) {
    const v = clamp(lumaField[i] + offset, 0, 255);
    const o = i * 4;
    albedoData[o] = clamp(Math.round(v + tint[0]), 0, 255);
    albedoData[o + 1] = clamp(Math.round(v + tint[1]), 0, 255);
    albedoData[o + 2] = clamp(Math.round(v + tint[2]), 0, 255);
    albedoData[o + 3] = 255;
    finalLuma += 0.2126 * albedoData[o] + 0.7152 * albedoData[o + 1] + 0.0722 * albedoData[o + 2];
  }
  albedoContext.putImageData(albedoImage, 0, 0);

  const normalCanvas = createCanvas(size, size);
  const normalContext = get2d(normalCanvas);
  const normalImage = normalContext.createImageData(size, size);
  const normalData = normalImage.data;
  const strength = spec.normalStrength;
  let maxTilt = 0;
  for (let y = 0; y < size; y += 1) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < size - 1 ? y + 1 : size - 1;
    for (let x = 0; x < size; x += 1) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < size - 1 ? x + 1 : size - 1;
      const i = y * size + x;
      const dhdu = (heightField[y * size + xp] - heightField[y * size + xm]) * 0.5;
      const dhdv = -(heightField[yp * size + x] - heightField[ym * size + x]) * 0.5;
      let nx = -dhdu * strength;
      let ny = -dhdv * strength;
      const length = Math.sqrt(nx * nx + ny * ny + 1) || 1;
      nx /= length;
      ny /= length;
      const nz = 1 / length;
      const o = i * 4;
      normalData[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[o + 3] = 255;
      const tilt = Math.sqrt(nx * nx + ny * ny);
      if (tilt > maxTilt) maxTilt = tilt;
    }
  }
  normalContext.putImageData(normalImage, 0, 0);

  const textures = {
    albedo: createCanvasTexture(albedoCanvas, 'logo-blocks-surface-albedo', { srgb: true, wrap: 'repeat' }),
    normal: createCanvasTexture(normalCanvas, 'logo-blocks-surface-normal', { wrap: 'repeat' }),
  };
  return {
    textures,
    stats: {
      size,
      tileWorld: spec.textureTile,
      meanLuma: Math.round(finalLuma / count),
      normalMaxTilt: Math.round(maxTilt * 1000) / 1000,
      speckCells,
    },
  };
}

/* ------------------------------------------------------------ geometry core */

function createIndexedGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // r151 only auto-wraps plain Arrays in setIndex; pass an explicit
  // BufferAttribute so index.count / the renderer see a proper attribute.
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/** Flip triangle winding (used when the computed normals point the wrong way). */
function flipWinding(geometry) {
  const index = geometry.getIndex();
  if (!index) return;
  const array = index.array;
  for (let i = 0; i < array.length; i += 3) {
    const swap = array[i + 1];
    array[i + 1] = array[i + 2];
    array[i + 2] = swap;
  }
  index.needsUpdate = true;
}

/**
 * Rounded-square outline centred on the origin, counter-clockwise, sampled with
 * a fixed number of points (4 * edgeSegments + 4 * cornerSegments). Every inward
 * offset of a rounded rectangle is the rounded rectangle of the reduced half
 * extent / corner radius around the same corner centres, so calling this for two
 * insets yields two rings with exact 1:1 point correspondence (no twisted bands).
 */
function roundedRectPoints(half, radius, cornerSegments, edgeSegments) {
  const r = Math.max(1e-6, Math.min(radius, half - 1e-6));
  const c = half - r;
  const points = [];
  const push = (x, y) => points.push(new THREE.Vector2(x, y));
  const pushArc = (cx, cy, rad, a0, a1, steps) => {
    for (let i = 1; i <= steps; i += 1) {
      const angle = lerp(a0, a1, i / steps);
      push(cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad);
    }
  };
  const pushEdge = (x0, y0, x1, y1) => {
    for (let i = 1; i <= edgeSegments; i += 1) {
      push(lerp(x0, x1, i / edgeSegments), lerp(y0, y1, i / edgeSegments));
    }
  };
  push(c, -half);
  pushEdge(c, -half, -c, -half); // bottom edge (right -> left, CCW)
  pushArc(-c, -c, r, (3 * Math.PI) / 2, Math.PI, cornerSegments); // bottom-left corner
  pushEdge(-half, -c, -half, c); // left edge
  pushArc(-c, c, r, Math.PI, Math.PI / 2, cornerSegments); // top-left corner
  pushEdge(-c, half, c, half); // top edge
  pushArc(c, c, r, Math.PI / 2, 0, cornerSegments); // top-right corner
  pushEdge(half, c, half, -c); // right edge
  pushArc(c, -c, r, 0, -Math.PI / 2, cornerSegments); // bottom-right corner
  // The final arc returns exactly to the start point; drop the duplicate.
  if (points.length > 1 && points[0].distanceToSquared(points[points.length - 1]) < 1e-14) points.pop();
  return points;
}

/**
 * Build one closed band surface (a grid of rings) as indexed geometry.
 * `rings` are ordered back/outer -> front/inner; every ring is
 * `{ points: Vector2[], z: number }` with the same point count. `options.centre`
 * caps the last ring with a triangle fan (single-ring caps / face panels).
 * `options.expected` ('front' | 'back' | 'radial') selects the orientation test:
 * the winding is flipped when the computed normals point the wrong way, so no
 * band can end up as an inverted front face (the shield's proven approach).
 */
function buildBandGeometry(rings, options = {}) {
  const ringCount = rings.length;
  const sampleCount = rings[0].points.length;
  const centre = options.centre || null;
  const uvScale = options.uvScale || 1;
  const vertexCount = ringCount * sampleCount + (centre ? 1 : 0);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let cursor = 0;
  let uvCursor = 0;
  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const ring = rings[ringIndex];
    for (let i = 0; i < sampleCount; i += 1) {
      const point = ring.points[i];
      positions[cursor] = point.x;
      positions[cursor + 1] = point.y;
      positions[cursor + 2] = ring.z;
      uvs[uvCursor] = point.x / uvScale + 0.5;
      uvs[uvCursor + 1] = point.y / uvScale + 0.5;
      cursor += 3;
      uvCursor += 2;
    }
  }
  const centreIndex = centre ? ringCount * sampleCount : -1;
  if (centre) {
    positions[cursor] = centre.x;
    positions[cursor + 1] = centre.y;
    positions[cursor + 2] = centre.z;
    uvs[uvCursor] = centre.x / uvScale + 0.5;
    uvs[uvCursor + 1] = centre.y / uvScale + 0.5;
  }

  const triangles = (ringCount - 1) * sampleCount * 2 + (centre ? sampleCount : 0);
  const closed = options.closed === undefined ? true : options.closed;
  const indices = new Uint32Array(triangles * 3);
  let write = 0;
  const lastSample = closed ? sampleCount : sampleCount - 1;
  for (let ringIndex = 0; ringIndex < ringCount - 1; ringIndex += 1) {
    const base = ringIndex * sampleCount;
    const nextBase = base + sampleCount;
    for (let i = 0; i < lastSample; i += 1) {
      const next = (i + 1) % sampleCount;
      indices[write] = base + i;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = base + next;
      write += 3;
      indices[write] = base + next;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = nextBase + next;
      write += 3;
    }
  }
  if (centre) {
    const base = (ringCount - 1) * sampleCount;
    for (let i = 0; i < sampleCount; i += 1) {
      const next = (i + 1) % sampleCount;
      indices[write] = base + i;
      indices[write + 1] = centreIndex;
      indices[write + 2] = base + next;
      write += 3;
    }
  }

  const geometry = createIndexedGeometry(positions, indices);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  const expected = options.expected || 'front';
  const normalAttribute = geometry.getAttribute('normal');
  let score = 0;
  if (expected === 'radial') {
    const stride = Math.max(1, Math.floor(vertexCount / 64));
    for (let i = 0; i < vertexCount; i += stride) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const length = Math.hypot(px, py) || 1;
      score += (normalAttribute.getX(i) * px + normalAttribute.getY(i) * py) / length;
    }
  } else {
    const sign = expected === 'back' ? -1 : 1;
    const stride = Math.max(1, Math.floor(vertexCount / 64));
    for (let i = 0; i < vertexCount; i += stride) score += normalAttribute.getZ(i) * sign;
  }
  if (score < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  geometry.userData = { expected, role: options.role || '' };
  return geometry;
}

/**
 * Shape from a 2D polygon with softly rounded corners (quadratic fillets). Used
 * for the classical bank icon parts before extrusion; the input may be CW or CCW.
 */
function roundedPolygonShape(points, radius) {
  const list = points.map((point) => (point.isVector2 ? point.clone() : new THREE.Vector2(point.x, point.y)));
  const loop = signedArea(list) < 0 ? list.reverse() : list;
  const shape = new THREE.Shape();
  const corners = loop.map((current, index) => {
    const previous = loop[(index - 1 + loop.length) % loop.length];
    const next = loop[(index + 1) % loop.length];
    const toPrevious = previous.clone().sub(current);
    const toNext = next.clone().sub(current);
    const trim = Math.min(radius, toPrevious.length() * 0.45, toNext.length() * 0.45);
    toPrevious.normalize();
    toNext.normalize();
    return {
      current,
      a: current.clone().addScaledVector(toPrevious, trim),
      b: current.clone().addScaledVector(toNext, trim),
    };
  });
  shape.moveTo(corners[0].a.x, corners[0].a.y);
  for (let i = 0; i < corners.length; i += 1) {
    const corner = corners[i];
    shape.quadraticCurveTo(corner.current.x, corner.current.y, corner.b.x, corner.b.y);
    const next = corners[(i + 1) % corners.length];
    shape.lineTo(next.a.x, next.a.y);
  }
  shape.closePath();
  return shape;
}

/**
 * Rounded, bevelled extrude of a block-local 2D polygon into +Z.
 * The finished solid spans z 0..(depth + 2 * bevelThickness); UVs are rewritten
 * to the block face plane so the procedural panel maps continue across the
 * relief (planar projection in block-local world units, `uvScale` = face size).
 */
function buildExtrudedPart(points, options) {
  const {
    cornerRadius = 0.014,
    cornerSegments = 4,
    depth,
    bevelSize = 0.006,
    bevelThickness = 0.005,
    bevelSegments = 2,
    uvScale = 1,
  } = options;
  const shape = roundedPolygonShape(points, cornerRadius);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: cornerSegments + 2,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelOffset: 0,
    bevelSegments,
  });
  geometry.translate(0, 0, bevelThickness);
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = position.getX(i) / uvScale + 0.5;
    uv[i * 2 + 1] = position.getY(i) / uvScale + 0.5;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Flat top plate of a surface slab (horizontal, +Y normal) with planar world-space
 * UVs (`u = x / tile + 0.5`, `v = z / tile + 0.5`) so a repeatable procedural map
 * tiles across the slab without seams.
 */
function buildSurfaceTop(width, depth, centreZ, topY, tile) {
  const geometry = new THREE.PlaneGeometry(width, depth, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, topY, centreZ);
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = position.getX(i) / tile + 0.5;
    uv[i * 2 + 1] = position.getZ(i) / tile + 0.5;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.userData = { role: 'surface top' };
  return geometry;
}

/**
 * Swept band for a surface slab cross-section (top front edge -> rounded polished
 * lip -> front wall), extruded across X. UVs are world-scaled on both axes
 * (u = x / tile, v = arc length / tile) so the concrete map keeps its density on
 * the lip and the front face.
 */
function buildSweptProfile(profile, x0, x1, tile) {
  const rows = profile.length;
  const positions = new Float32Array(rows * 2 * 3);
  const uvs = new Float32Array(rows * 2 * 2);
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      const index = i * 2 + j;
      const x = j === 0 ? x0 : x1;
      positions[index * 3] = x;
      positions[index * 3 + 1] = profile[i].y;
      positions[index * 3 + 2] = profile[i].z;
      uvs[index * 2] = x / tile + 0.5;
      uvs[index * 2 + 1] = profile[i].s / tile;
    }
  }
  const indices = new Uint32Array((rows - 1) * 6);
  let write = 0;
  for (let i = 0; i < rows - 1; i += 1) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices[write] = a;
    indices[write + 1] = b;
    indices[write + 2] = c;
    indices[write + 3] = b;
    indices[write + 4] = d;
    indices[write + 5] = c;
    write += 6;
  }
  const geometry = createIndexedGeometry(positions, indices);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  // Outward normals of the lip/front wall have a positive Y or Z component.
  const normal = geometry.getAttribute('normal');
  let score = 0;
  const stride = Math.max(1, Math.floor(normal.count / 32));
  for (let i = 0; i < normal.count; i += stride) score += normal.getY(i) + normal.getZ(i);
  if (score < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  geometry.userData = { role: 'surface lip' };
  return geometry;
}

/**
 * Surface slab: flat top plate + swept rounded front lip and front wall. Both
 * scenes use the same construction with their own measured profile and material.
 */
function buildSurfaceSlab(options) {
  const { spec, name, material, tile = 4, recorder, geometrySet } = options;
  const group = new THREE.Group();
  group.name = name;

  const top = buildSurfaceTop(spec.width, spec.frontTopZ - spec.backZ, (spec.backZ + spec.frontTopZ) / 2, spec.topY, tile);
  geometrySet.add(top);
  const topMesh = new THREE.Mesh(top, material);
  topMesh.name = name + '-top';
  topMesh.castShadow = false;
  topMesh.receiveShadow = true;
  topMesh.userData = { role: 'surface top plane' };
  group.add(topMesh);
  recorder.add(topMesh, 'surface top plane');

  const profile = [];
  let arcLength = 0;
  let previous = null;
  const pushProfile = (z, y) => {
    if (previous) arcLength += Math.hypot(z - previous[0], y - previous[1]);
    profile.push({ z, y, s: arcLength });
    previous = [z, y];
  };
  pushProfile(spec.frontTopZ, spec.topY);
  for (let i = 1; i <= spec.lipSegments; i += 1) {
    const phi = (Math.PI / 2) * (i / spec.lipSegments);
    pushProfile(spec.frontTopZ + spec.lipRadius * Math.sin(phi), spec.topY - spec.lipRadius + spec.lipRadius * Math.cos(phi));
  }
  pushProfile(spec.frontTopZ + spec.lipRadius, spec.bottomY);

  const lip = buildSweptProfile(profile, -spec.width / 2, spec.width / 2, tile);
  geometrySet.add(lip);
  const lipMesh = new THREE.Mesh(lip, material);
  lipMesh.name = name + '-lip';
  lipMesh.castShadow = false;
  lipMesh.receiveShadow = true;
  lipMesh.userData = { role: 'rounded polished surface lip + front wall' };
  group.add(lipMesh);
  recorder.add(lipMesh, 'rounded polished surface lip + front wall');

  return group;
}

/**
 * Soft contact shadow: a flat disc in XZ with per-vertex RGBA (black, alpha
 * fading to zero at the rim). Geometry-only, so it adds no baked shadow map and
 * no texture; the material is a transparent MeshBasicMaterial.
 */
function buildContactShadowGeometry(spec, geometrySet) {
  const rings = spec.rings;
  const segments = spec.segments;
  const vertexCount = 1 + rings * segments;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);
  const uvs = new Float32Array(vertexCount * 2);

  const setVertex = (index, x, z, alpha) => {
    positions[index * 3] = x;
    positions[index * 3 + 1] = 0;
    positions[index * 3 + 2] = z;
    colors[index * 4] = 0;
    colors[index * 4 + 1] = 0;
    colors[index * 4 + 2] = 0;
    colors[index * 4 + 3] = clamp01(alpha);
    uvs[index * 2] = x / (spec.radiusX * 2) + 0.5;
    uvs[index * 2 + 1] = z / (spec.radiusZ * 2) + 0.5;
  };

  setVertex(0, 0, 0, spec.alpha);
  for (let ring = 1; ring <= rings; ring += 1) {
    const t = ring / rings;
    const alpha = spec.alpha * Math.pow(1 - t, 2.1);
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * TAU;
      const index = 1 + (ring - 1) * segments + segment;
      setVertex(index, Math.cos(angle) * t * spec.radiusX, Math.sin(angle) * t * spec.radiusZ, alpha);
    }
  }

  const indices = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(0, 1 + segment, 1 + next);
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const base = 1 + (ring - 1) * segments;
    const outer = base + segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(base + segment, outer + segment, outer + next);
      indices.push(base + segment, outer + next, base + next);
    }
  }
  const geometry = createIndexedGeometry(positions, new Uint32Array(indices));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.userData = { role: 'contact shadow' };
  geometrySet.add(geometry);
  return geometry;
}

/* -------------------------------------------------------------- svg parser */

const SVG_PATH_COMMANDS = 'MmLlHhVvCcSsQqTtAaZz';

function tokenizePathData(d) {
  const tokens = [];
  const pattern = new RegExp('([' + SVG_PATH_COMMANDS + '])|([-+]?(?:\\d*\\.\\d+|\\d+)(?:[eE][-+]?\\d+)?)', 'g');
  let match = pattern.exec(d);
  while (match !== null) {
    if (match[1]) tokens.push({ command: match[1] });
    else tokens.push({ number: Number(match[2]) });
    match = pattern.exec(d);
  }
  return tokens;
}

/** Minimal deterministic SVG path parser: M L H V C S Q T Z (absolute + relative). */
function parsePathData(d, options = {}) {
  const curveSegments = Math.max(2, Math.round(options.curveSegments || 12));
  const tokens = tokenizePathData(d);
  const subpaths = [];
  let current = [];
  let x = 0;
  let y = 0;
  let command = null;
  let index = 0;
  let cubicControl = null;
  let quadControl = null;

  const read = (count) => {
    const values = [];
    for (let i = 0; i < count; i += 1) {
      if (index >= tokens.length || tokens[index].command) return null;
      values.push(tokens[index].number);
      index += 1;
    }
    return values;
  };
  const addPoint = (px, py) => {
    current.push(new THREE.Vector2(px, py));
  };
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let i = 1; i <= curveSegments; i += 1) {
      const t = i / curveSegments;
      const mt = 1 - t;
      const px = mt * mt * mt * x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
      const py = mt * mt * mt * y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
      addPoint(px, py);
    }
    x = x3;
    y = y3;
  };
  const quadratic = (x1, y1, x2, y2) => {
    for (let i = 1; i <= curveSegments; i += 1) {
      const t = i / curveSegments;
      const mt = 1 - t;
      const px = mt * mt * x + 2 * mt * t * x1 + t * t * x2;
      const py = mt * mt * y + 2 * mt * t * y1 + t * t * y2;
      addPoint(px, py);
    }
    x = x2;
    y = y2;
  };

  while (index < tokens.length) {
    if (tokens[index].command) {
      command = tokens[index].command;
      index += 1;
      if (command === 'Z' || command === 'z') {
        if (current.length > 0) subpaths.push(current);
        current = [];
        command = null;
        continue;
      }
    } else if (!command) {
      throw new Error('SVG path data contains numbers before a command');
    }

    const upper = command.toUpperCase();
    const relative = command !== upper;

    if (upper === 'M') {
      if (current.length > 0) subpaths.push(current);
      current = [];
      const values = read(2);
      if (!values) break;
      x = relative ? x + values[0] : values[0];
      y = relative ? y + values[1] : values[1];
      addPoint(x, y);
      command = relative ? 'l' : 'L';
      cubicControl = null;
      quadControl = null;
      continue;
    }

    let values = null;
    switch (upper) {
      case 'L': {
        values = read(2);
        if (!values) { index = tokens.length; break; }
        x = relative ? x + values[0] : values[0];
        y = relative ? y + values[1] : values[1];
        addPoint(x, y);
        break;
      }
      case 'H': {
        values = read(1);
        if (!values) { index = tokens.length; break; }
        x = relative ? x + values[0] : values[0];
        addPoint(x, y);
        break;
      }
      case 'V': {
        values = read(1);
        if (!values) { index = tokens.length; break; }
        y = relative ? y + values[0] : values[0];
        addPoint(x, y);
        break;
      }
      case 'C': {
        values = read(6);
        if (!values) { index = tokens.length; break; }
        const x1 = relative ? x + values[0] : values[0];
        const y1 = relative ? y + values[1] : values[1];
        const x2 = relative ? x + values[2] : values[2];
        const y2 = relative ? y + values[3] : values[3];
        const x3 = relative ? x + values[4] : values[4];
        const y3 = relative ? y + values[5] : values[5];
        cubic(x1, y1, x2, y2, x3, y3);
        cubicControl = new THREE.Vector2(x2, y2);
        quadControl = null;
        break;
      }
      case 'S': {
        values = read(4);
        if (!values) { index = tokens.length; break; }
        const reflected = cubicControl
          ? new THREE.Vector2(2 * x - cubicControl.x, 2 * y - cubicControl.y)
          : new THREE.Vector2(x, y);
        const x2 = relative ? x + values[0] : values[0];
        const y2 = relative ? y + values[1] : values[1];
        const x3 = relative ? x + values[2] : values[2];
        const y3 = relative ? y + values[3] : values[3];
        cubic(reflected.x, reflected.y, x2, y2, x3, y3);
        cubicControl = new THREE.Vector2(x2, y2);
        quadControl = null;
        break;
      }
      case 'Q': {
        values = read(4);
        if (!values) { index = tokens.length; break; }
        const x1 = relative ? x + values[0] : values[0];
        const y1 = relative ? y + values[1] : values[1];
        const x2 = relative ? x + values[2] : values[2];
        const y2 = relative ? y + values[3] : values[3];
        quadratic(x1, y1, x2, y2);
        quadControl = new THREE.Vector2(x1, y1);
        cubicControl = null;
        break;
      }
      case 'T': {
        values = read(2);
        if (!values) { index = tokens.length; break; }
        const reflected = quadControl
          ? new THREE.Vector2(2 * x - quadControl.x, 2 * y - quadControl.y)
          : new THREE.Vector2(x, y);
        const x2 = relative ? x + values[0] : values[0];
        const y2 = relative ? y + values[1] : values[1];
        quadratic(reflected.x, reflected.y, x2, y2);
        quadControl = new THREE.Vector2(reflected.x, reflected.y);
        cubicControl = null;
        break;
      }
      default:
        throw new Error('Unsupported SVG path command "' + command + '"');
    }
    cubicControl = upper === 'C' || upper === 'S' ? cubicControl : null;
    if (upper !== 'Q' && upper !== 'T') quadControl = null;
  }

  if (current.length > 0) subpaths.push(current);
  return subpaths;
}

/**
 * Parse the TEKO icon SVG into closed 2D contours with their authored fill
 * colours (same contract as src/shield-model.js). Returns `{ shapes, bbox }`,
 * every shape `{ index, subpathIndex, fill, points }` in SVG coordinates. The two
 * fills are #ffd60a (bright) and #7d5a00 (deep) — the model maps those source
 * tones to `emblemSilver` / `emblemGraphite`, never to gold.
 */
export function parseTekoLogoSvg(svgText, options = {}) {
  if (typeof svgText !== 'string' || svgText.length === 0) {
    throw new Error('parseTekoLogoSvg requires the SVG source text');
  }
  const curveSegments = Math.max(2, Math.round(options.curveSegments || 12));

  const classFills = new Map();
  const styleBlocks = svgText.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  for (const block of styleBlocks) {
    const rulePattern = /\.([A-Za-z0-9_-]+)\s*\{[^}]*fill\s*:\s*([^;}]+)/g;
    let rule = rulePattern.exec(block);
    while (rule !== null) {
      classFills.set(rule[1], rule[2].trim());
      rule = rulePattern.exec(block);
    }
  }

  const shapes = [];
  const pathPattern = /<path\b([^>]*?)\/?>/g;
  let match = pathPattern.exec(svgText);
  let shapeIndex = 0;
  while (match !== null) {
    const attributes = match[1] || '';
    const dMatch = attributes.match(/\sd\s*=\s*"([^"]*)"/) || attributes.match(/\sd\s*=\s*'([^']*)'/);
    if (dMatch && dMatch[1]) {
      const classMatch = attributes.match(/\sclass\s*=\s*"([^"]*)"/) || attributes.match(/\sclass\s*=\s*'([^']*)'/);
      const fillMatch = attributes.match(/\sfill\s*=\s*"([^"]*)"/) || attributes.match(/\sfill\s*=\s*'([^']*)'/);
      let fill = fillMatch ? fillMatch[1] : null;
      if (!fill && classMatch) {
        for (const className of classMatch[1].split(/\s+/)) {
          if (classFills.has(className)) {
            fill = classFills.get(className);
            break;
          }
        }
      }
      if (!fill) fill = '#000000';
      const subpaths = parsePathData(dMatch[1], { curveSegments });
      subpaths.forEach((points, subpathIndex) => {
        if (points.length < 3) return;
        shapes.push({ index: shapeIndex, subpathIndex, fill: String(fill).trim(), points });
        shapeIndex += 1;
      });
    }
    match = pathPattern.exec(svgText);
  }

  if (shapes.length === 0) {
    throw new Error('no <path> artwork found in the TEKO icon SVG');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    for (const point of shape.points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }
  return {
    shapes,
    bbox: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
  };
}

/* ----------------------------------------------------------------- emblem */

/** Remove duplicate consecutive points from a closed 2D contour. */
function cleanClosedContour(points) {
  const out = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (!previous || previous.distanceToSquared(point) > 1e-12) out.push(point);
  }
  if (out.length > 2 && out[0].distanceToSquared(out[out.length - 1]) < 1e-12) out.pop();
  return out;
}

/**
 * Triangulated flat cap of a closed contour at `capZ`, with per-triangle winding
 * correction and degenerate-triangle removal.
 *
 * `THREE.ShapeUtils.triangulateShape` (Earcut) does not guarantee uniform
 * counter-clockwise output for concave SVG contours, so a plain
 * `computeVertexNormals()` pass can leave individual cap triangles facing
 * backwards — that is what makes a relief read as "thin outline with white
 * patches" instead of a solid machined mark. Each triangle is therefore re-wound
 * to +Z (positive signed area) and zero-area triangles are dropped.
 */
function buildEmblemCap(contour, capZ, uvScale) {
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions = new Float32Array(contour.length * 3);
  const uvs = new Float32Array(contour.length * 2);
  for (let i = 0; i < contour.length; i += 1) {
    const x = contour[i].x;
    const y = contour[i].y;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = capZ;
    uvs[i * 2] = x / uvScale + 0.5;
    uvs[i * 2 + 1] = y / uvScale + 0.5;
  }
  const indices = [];
  let dropped = 0;
  for (const triangle of triangles) {
    const a = contour[triangle[0]];
    const b = contour[triangle[1]];
    const c = contour[triangle[2]];
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-10) {
      dropped += 1;
      continue;
    }
    if (area > 0) indices.push(triangle[0], triangle[1], triangle[2]);
    else indices.push(triangle[0], triangle[2], triangle[1]);
  }
  const geometry = createIndexedGeometry(positions, new Uint32Array(indices));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.userData = {
    expected: 'front',
    role: 'emblem cap',
    triangleCount: indices.length / 3,
    droppedTriangles: dropped,
  };
  return geometry;
}

/**
 * Emboss body: a short vertical wall from `baseZ` (sunk into the face panel) up
 * to `wallTopZ`, then a chamfer whose rings are scaled toward the contour
 * centroid while rising to `capZ`. The chamfer gives the mark a light-catching
 * bevel and the wall gives it visible side depth, so the relief reads as a
 * machined metal emboss rather than a flat sticker.
 */
function buildEmblemRelief(contour, baseZ, wallTopZ, capZ, chamferScales, uvScale) {
  const centroid = centroidOf(contour);
  const ringAt = (scaleValue) =>
    contour.map(
      (point) => new THREE.Vector2(
        centroid.x + (point.x - centroid.x) * scaleValue,
        centroid.y + (point.y - centroid.y) * scaleValue,
      ),
    );
  const rings = [
    { points: contour, z: baseZ },
    { points: contour, z: wallTopZ },
  ];
  for (let i = 0; i < chamferScales.length; i += 1) {
    const t = (i + 1) / chamferScales.length;
    rings.push({ points: ringAt(chamferScales[i]), z: wallTopZ + (capZ - wallTopZ) * t });
  }

  const ringCount = rings.length;
  const sampleCount = contour.length;
  const vertexCount = ringCount * sampleCount;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let cursor = 0;
  let uvCursor = 0;
  for (const ring of rings) {
    for (const point of ring.points) {
      positions[cursor] = point.x;
      positions[cursor + 1] = point.y;
      positions[cursor + 2] = ring.z;
      uvs[uvCursor] = point.x / uvScale + 0.5;
      uvs[uvCursor + 1] = point.y / uvScale + 0.5;
      cursor += 3;
      uvCursor += 2;
    }
  }
  const indices = new Uint32Array((ringCount - 1) * sampleCount * 6);
  let write = 0;
  for (let ringIndex = 0; ringIndex < ringCount - 1; ringIndex += 1) {
    const base = ringIndex * sampleCount;
    const nextBase = base + sampleCount;
    for (let i = 0; i < sampleCount; i += 1) {
      const next = (i + 1) % sampleCount;
      indices[write] = base + i;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = base + next;
      write += 3;
      indices[write] = base + next;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = nextBase + next;
      write += 3;
    }
  }
  const geometry = createIndexedGeometry(positions, indices);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  // Outward normals radiate away from the contour centroid (wall sides and
  // chamfer both); flip the winding when the computed normals point inward.
  const normal = geometry.getAttribute('normal');
  let score = 0;
  for (let i = 0; i < normal.count; i += 1) {
    const dx = positions[i * 3] - centroid.x;
    const dy = positions[i * 3 + 1] - centroid.y;
    const length = Math.hypot(dx, dy) || 1;
    score += (normal.getX(i) * dx + normal.getY(i) * dy) / length;
  }
  if (score < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  geometry.userData = { expected: 'contour', role: 'emblem relief band' };
  return geometry;
}

/**
 * Build the TEKO arrow as a two-tone machined relief on a flat face plane.
 *
 * Each SVG contour becomes three parts, all placed relative to the scene's
 * actual recessed face/panel z (`surfaceZ`):
 *   1. socket  — a dark flat contour expanded 1.06 around its centroid, lifted
 *                1.2 mm above the panel (its own z plane, never coplanar);
 *   2. body    — a wall skirt sunk `wallInset` into the panel plus three chamfer
 *                rings scaled toward the centroid up to the cap height;
 *   3. cap     — the triangulated raised top plane (bright fill -> polished
 *                `emblemSilver`, deep fill -> satin `emblemGraphite`).
 * Caps are re-wound per triangle so concave contours can never render as
 * inverted/back-facing patches. The returned group is built in block-local
 * coordinates and cloned per block; its geometries/materials are shared.
 */
function buildEmblem(context) {
  const { parsed, spec, faceSize, surfaceZ, materials, geometrySet, source } = context;
  const group = new THREE.Group();
  group.name = 'teko-emblem';

  const bbox = parsed.bbox;
  const scale = (spec.width * faceSize) / Math.max(1e-6, bbox.width);
  const sourceCentreX = (bbox.minX + bbox.maxX) / 2;
  const sourceCentreY = (bbox.minY + bbox.maxY) / 2;
  const uvScale = faceSize;
  const toModel = (point) =>
    new THREE.Vector2(
      spec.centerX * faceSize + (point.x - sourceCentreX) * scale,
      spec.centerY * faceSize - (point.y - sourceCentreY) * scale,
    );

  const baseZ = surfaceZ - spec.wallInset;
  const wallTopZ = surfaceZ + spec.wallTop;
  const capZ = surfaceZ + spec.relief;
  const capScale = spec.chamferScales[spec.chamferScales.length - 1];

  const parts = [];
  const shapes = [];
  let triangleCount = 0;

  for (const shape of parsed.shapes) {
    const contour = cleanClosedContour(shape.points.map(toModel));
    if (contour.length < 3) continue;
    if (signedArea(contour) < 0) contour.reverse();
    const centroid = centroidOf(contour);
    const isBright = relativeLuminance(shape.fill) > 0.45;
    const tone = isBright ? 'silver' : 'graphite';
    const capMaterial = isBright ? materials.emblemSilver : materials.emblemGraphite;
    const socketMaterial = materials.socket;

    // --- 1. dark socket outline: a flat expanded contour just above the panel
    // (kept 1.2 mm clear of every other emblem plane, so it never z-fights).
    const socketContour = contour.map(
      (point) => new THREE.Vector2(
        centroid.x + (point.x - centroid.x) * spec.socketScale,
        centroid.y + (point.y - centroid.y) * spec.socketScale,
      ),
    );
    const socketGeometry = buildEmblemCap(socketContour, surfaceZ + spec.socketLift, uvScale);
    geometrySet.add(socketGeometry);
    const socketMesh = new THREE.Mesh(socketGeometry, socketMaterial);
    socketMesh.name = 'teko-emblem-socket-' + shapes.length;
    socketMesh.castShadow = false;
    socketMesh.receiveShadow = false;
    socketMesh.userData = { role: 'emblem socket outline' };
    group.add(socketMesh);
    const socketTriangles = triangleCountOf(socketGeometry);

    // --- 2. machined body: wall skirt (sunk into the panel) + chamfer rings.
    const reliefGeometry = buildEmblemRelief(contour, baseZ, wallTopZ, capZ, spec.chamferScales, uvScale);
    geometrySet.add(reliefGeometry);
    const reliefMesh = new THREE.Mesh(reliefGeometry, capMaterial);
    reliefMesh.name = 'teko-emblem-' + tone + '-' + shapes.length + '-relief';
    reliefMesh.castShadow = false;
    reliefMesh.receiveShadow = false;
    reliefMesh.userData = { role: 'emblem ' + tone + ' relief body' };
    group.add(reliefMesh);
    const reliefTriangles = triangleCountOf(reliefGeometry);

    // --- 3. raised cap plane (triangulated, per-triangle winding corrected).
    const capContour = contour.map(
      (point) => new THREE.Vector2(
        centroid.x + (point.x - centroid.x) * capScale,
        centroid.y + (point.y - centroid.y) * capScale,
      ),
    );
    const capGeometry = buildEmblemCap(capContour, capZ, uvScale);
    geometrySet.add(capGeometry);
    const capMesh = new THREE.Mesh(capGeometry, capMaterial);
    capMesh.name = 'teko-emblem-' + tone + '-' + shapes.length + '-cap';
    capMesh.castShadow = false;
    capMesh.receiveShadow = false;
    capMesh.userData = { role: 'emblem ' + tone + ' cap' };
    group.add(capMesh);
    const capTriangles = triangleCountOf(capGeometry);

    triangleCount += socketTriangles + reliefTriangles + capTriangles;
    parts.push({ name: capMesh.name, role: 'emblem ' + tone + ' cap', material: capMaterial.name, triangles: capTriangles });
    parts.push({ name: reliefMesh.name, role: 'emblem ' + tone + ' relief body', material: capMaterial.name, triangles: reliefTriangles });
    parts.push({ name: socketMesh.name, role: 'emblem socket outline', material: socketMaterial.name, triangles: socketTriangles });

    shapes.push({
      fill: shape.fill,
      tone,
      points: contour.length,
      triangles: socketTriangles + reliefTriangles + capTriangles,
    });
  }

  return {
    group,
    parts,
    shapes,
    triangleCount,
    source,
    width: spec.width * faceSize,
    height: bbox.height * scale,
    relief: spec.relief,
    parsed,
  };
}

/* ------------------------------------------------------- block geometries */

/**
 * Contiguous index run of a rounded-square outline whose outward 2D normal points
 * to -X (the exposed left edge of each rear stack block). The gold accent band is
 * clipped to this run so it reads as a vertical strip on the exposed edge instead
 * of a full gold ring around the face.
 */
function leftPerimeterIndices(points, maxNormalX) {
  const count = points.length;
  const included = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const previous = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const tx = next.x - previous.x;
    const ty = next.y - previous.y;
    const length = Math.hypot(tx, ty) || 1;
    // The outline is traversed clockwise, so the outward normal is (-ty, tx).
    included[i] = -ty / length <= maxNormalX;
  }
  let start = -1;
  for (let i = 0; i < count; i += 1) {
    if (included[i] && !included[(i - 1 + count) % count]) {
      start = i;
      break;
    }
  }
  if (start < 0) return Array.from({ length: count }, (unused, index) => index);
  const run = [];
  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    if (!included[index]) break;
    run.push(index);
  }
  return run;
}
/** Shared shell geometries of the stack block (all four blocks reuse them). */
function buildStackShellGeometries(spec, geometrySet) {
  const half = spec.faceSize / 2;
  const zOffset = spec.thickness / 2;
  const z = (profileZ) => profileZ - zOffset;
  const ring = (inset) => roundedRectPoints(half - inset, spec.cornerRadius - inset, spec.cornerSegments, spec.edgeSegments);
  const uvScale = spec.faceSize;
  const wallRing = ring(0);

  const wall = buildBandGeometry(
    [{ points: wallRing, z: z(0) }, { points: wallRing, z: z(spec.wallEndZ) }],
    { expected: 'radial', uvScale, role: 'wall' },
  );

  const rimRings = [{ points: wallRing, z: z(spec.wallEndZ) }];
  const radius = spec.rolledEdgeRadius;
  for (let i = 1; i <= spec.rimArcSegments; i += 1) {
    const theta = (Math.PI / 2) * (i / spec.rimArcSegments);
    const inset = radius * (1 - Math.cos(theta));
    rimRings.push({ points: ring(inset), z: z(spec.wallEndZ + radius * Math.sin(theta)) });
  }
  for (const [inset, profileZ] of spec.rimChamfer) {
    rimRings.push({ points: ring(inset), z: z(profileZ) });
  }
  const rim = buildBandGeometry(rimRings, { expected: 'radial', uvScale, role: 'rim' });

  const face = buildBandGeometry(
    [{ points: ring(spec.panelInset), z: z(spec.faceZ) }],
    { expected: 'front', uvScale, role: 'face', centre: { x: 0, y: 0, z: z(spec.faceZ) } },
  );
  const back = buildBandGeometry(
    [{ points: wallRing, z: z(0) }],
    { expected: 'back', uvScale, role: 'back', centre: { x: 0, y: 0, z: z(0) } },
  );

  // Accent band: a thin gold strip that follows the rolled edge from the wall
  // (zStart) to just behind the crest (zEnd), offset slightly outward and clipped
  // to the left-facing perimeter run (the exposed edge of a rear block). The face
  // perimeter stays silver so the gold reads as a few thin strips, not a bezel.
  const accent = spec.accent;
  const accentIndices = leftPerimeterIndices(wallRing, accent.faceNormalMaxX);
  const accentRings = [];
  const thetaMax = Math.asin(clamp((accent.zEnd - spec.wallEndZ) / radius, -1, 1));
  for (let i = 0; i <= accent.segments; i += 1) {
    const theta = thetaMax * (i / accent.segments);
    const inset = radius * (1 - Math.cos(theta)) - accent.outwardOffset * Math.cos(theta);
    const profileZ = spec.wallEndZ + radius * Math.sin(theta) + accent.outwardOffset * Math.sin(theta);
    const points = ring(inset);
    accentRings.push({ points: accentIndices.map((index) => points[index]), z: z(profileZ) });
  }
  const accentGeometry = buildBandGeometry(accentRings, { expected: 'radial', uvScale, role: 'accent', closed: false });

  geometrySet.add(wall);
  geometrySet.add(rim);
  geometrySet.add(face);
  geometrySet.add(back);
  geometrySet.add(accentGeometry);
  return { wall, rim, face, back, accent: accentGeometry };
}

/** Shared shell geometries of the bank plaque (both plaques reuse them). */
function buildBankShellGeometries(spec, geometrySet) {
  const half = spec.faceSize / 2;
  const zOffset = spec.thickness / 2;
  const z = (profileZ) => profileZ - zOffset;
  const ring = (inset) => roundedRectPoints(half - inset, spec.cornerRadius - inset, spec.cornerSegments, spec.edgeSegments);
  const uvScale = spec.faceSize;
  const wallRing = ring(0);

  const wall = buildBandGeometry(
    [{ points: wallRing, z: z(0) }, { points: wallRing, z: z(spec.wallEndZ) }],
    { expected: 'radial', uvScale, role: 'wall' },
  );

  const rimRings = [{ points: wallRing, z: z(spec.wallEndZ) }];
  const radius = spec.rolledEdgeRadius;
  for (let i = 1; i <= spec.rimArcSegments; i += 1) {
    const theta = (Math.PI / 2) * (i / spec.rimArcSegments);
    const inset = radius * (1 - Math.cos(theta));
    rimRings.push({ points: ring(inset), z: z(spec.wallEndZ + radius * Math.sin(theta)) });
  }
  for (const [inset, profileZ] of spec.rimChamfer) {
    rimRings.push({ points: ring(inset), z: z(profileZ) });
  }
  const rim = buildBandGeometry(rimRings, { expected: 'radial', uvScale, role: 'rim' });

  const face = buildBandGeometry(
    [{ points: ring(spec.panelInset), z: z(spec.faceZ) }],
    { expected: 'front', uvScale, role: 'panel', centre: { x: 0, y: 0, z: z(spec.faceZ) } },
  );
  const back = buildBandGeometry(
    [{ points: wallRing, z: z(0) }],
    { expected: 'back', uvScale, role: 'back', centre: { x: 0, y: 0, z: z(0) } },
  );

  // Thin flat gold ring on the face plane (logo plaque only), just inside the
  // panel edge — the reference's blue face line becomes brand gold.
  const ringGeometry = buildBandGeometry(
    [
      { points: ring(spec.ring.insetStart), z: z(spec.faceZ) + spec.ring.raise },
      { points: ring(spec.ring.insetEnd), z: z(spec.faceZ) + spec.ring.raise },
    ],
    { expected: 'front', uvScale, role: 'accent-ring' },
  );

  geometrySet.add(wall);
  geometrySet.add(rim);
  geometrySet.add(face);
  geometrySet.add(back);
  geometrySet.add(ringGeometry);
  return { wall, rim, face, back, ring: ringGeometry };
}

/**
 * Raised classical bank icon: pediment roof + cornice overhang, four columns with
 * capitals and two base steps, every part a rounded bevelled extrusion in the
 * panel material so the fluted/dotted field continues across the relief. Built in
 * block-local coordinates (centred on the face, sitting on the panel plane).
 */
function buildBankIcon(context) {
  const { spec, faceSize, materials, geometrySet, panelZ } = context;
  const group = new THREE.Group();
  group.name = 'bank-icon';
  const unit = spec.width * faceSize;
  const centreY = spec.centerY * faceSize;
  const depth = spec.relief - spec.bevelThickness * 2;
  const parts = [];
  const shadowParts = [];
  let triangleCount = 0;

  const rect = (x0, x1, y0, y1) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];

  const add = (name, points) => {
    const worldPoints = points.map(([x, y]) => new THREE.Vector2(x * unit, y * unit + centreY));
    const geometry = buildExtrudedPart(worldPoints, {
      cornerRadius: spec.cornerRadius,
      cornerSegments: spec.cornerSegments,
      depth,
      bevelSize: spec.bevelSize,
      bevelThickness: spec.bevelThickness,
      bevelSegments: spec.bevelSegments,
      uvScale: faceSize,
    });
    geometrySet.add(geometry);
    const mesh = new THREE.Mesh(geometry, [materials.bankIcon, materials.bankIconEdge]);
    mesh.name = 'bank-icon-' + name;
    mesh.position.set(0, 0, panelZ);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData = { role: 'bank icon relief (' + name + ')' };
    group.add(mesh);
    const triangles = triangleCountOf(geometry);
    triangleCount += triangles;
    parts.push({ name: mesh.name, role: 'bank icon relief (' + name + ')', material: materials.bankIcon.name + '+' + materials.bankIconEdge.name, triangles });

    // Dark separation plate just above the panel: the expanded flat outline peeks
    // out around the raised shape and reads as a groove/shadow, so the classical
    // bank stays legible at page scale (the relief itself is only 24 mm tall).
    const centroid = centroidOf(worldPoints);
    const shadowPoints = worldPoints.map(
      (point) => new THREE.Vector2(
        centroid.x + (point.x - centroid.x) * spec.shadowScale,
        centroid.y + (point.y - centroid.y) * spec.shadowScale,
      ),
    );
    const shadowGeometry = buildEmblemCap(shadowPoints, panelZ + spec.shadowLift, faceSize);
    geometrySet.add(shadowGeometry);
    const shadowMesh = new THREE.Mesh(shadowGeometry, materials.bankShadow);
    shadowMesh.name = mesh.name + '-shadow';
    shadowMesh.castShadow = false;
    shadowMesh.receiveShadow = false;
    shadowMesh.userData = { role: 'bank icon shadow plate (' + name + ')' };
    group.add(shadowMesh);
    const shadowTriangles = triangleCountOf(shadowGeometry);
    triangleCount += shadowTriangles;
    shadowParts.push({ name: shadowMesh.name, role: 'bank icon shadow plate', material: materials.bankShadow.name, triangles: shadowTriangles });
  };

  // Pediment: sloped roof (slightly flattened apex) over a cornice with overhang.
  add('pediment-roof', [[-0.47, 0.13], [0.47, 0.13], [0, 0.46]]);
  add('pediment-cornice', rect(-0.5, 0.5, 0.05, 0.14));
  const columnXs = [-0.36, -0.12, 0.12, 0.36];
  columnXs.forEach((cx, index) => add('column-' + (index + 1), rect(cx - 0.0425, cx + 0.0425, -0.31, 0.02)));
  columnXs.forEach((cx, index) => add('capital-' + (index + 1), rect(cx - 0.065, cx + 0.065, 0.005, 0.06)));
  add('base-step-upper', rect(-0.42, 0.42, -0.4, -0.31));
  add('base-step-lower', rect(-0.47, 0.47, -0.5, -0.4));

  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const measuredWidth = bounds.max.x - bounds.min.x;

  return {
    group,
    parts,
    shadowParts,
    shapeCount: parts.length,
    shadowShapeCount: shadowParts.length,
    relief: spec.relief,
    width: unit,
    measuredWidth: Math.round(measuredWidth * 1000) / 1000,
    measuredHeight: Math.round((bounds.max.y - bounds.min.y) * 1000) / 1000,
    triangleCount,
  };
}

/* -------------------------------------------------------------- collectors */

function createRecorder() {
  const parts = [];
  return {
    parts,
    add(mesh, role, block) {
      const entry = {
        name: mesh.name,
        role,
        material: mesh.material && mesh.material.name ? mesh.material.name : '',
        triangles: triangleCountOf(mesh.geometry),
      };
      if (block !== undefined && block !== null) entry.block = block;
      parts.push(entry);
    },
    aggregate(name, role, material, triangles, block) {
      const entry = { name, role, material, triangles };
      if (block !== undefined && block !== null) entry.block = block;
      parts.push(entry);
    },
  };
}

function addMesh(parent, geometry, material, name, role, recorder, block, options = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = options.castShadow === undefined ? true : options.castShadow;
  mesh.receiveShadow = options.receiveShadow === undefined ? true : options.receiveShadow;
  mesh.userData = { role };
  parent.add(mesh);
  if (recorder) recorder.add(mesh, role, block);
  return mesh;
}

function pushBoxCorners(points, box) {
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) points.push(x, y, z);
    }
  }
}

function boundsObject(box) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    center: { x: center.x, y: center.y, z: center.z },
    size: { x: size.x, y: size.y, z: size.z },
  };
}

/**
 * Camera fit points: the composition box corners plus a narrow strip of the
 * surface front edge / rounded lip around the composition centre. The contract
 * requires the surface extents in `fitPoints` so the page frames blocks + table
 * lip; using a narrow strip (rather than the slab's full width) keeps the lip in
 * frame without letting its near corners dominate the fit and shrink the blocks.
 */
function buildSceneFitPoints(blocks, spec) {
  const points = [];
  const box = new THREE.Box3();
  const blockBox = new THREE.Box3();
  for (const block of blocks) {
    block.group.updateMatrixWorld(true);
    blockBox.setFromObject(block.group);
    box.union(blockBox);
    pushBoxCorners(points, blockBox);
  }
  const surface = spec.surface;
  const centreX = (box.min.x + box.max.x) / 2 + spec.fit.lipCenterOffset;
  const halfWidth = spec.fit.lipHalfWidth;
  const lipZ = surface.frontTopZ + surface.lipRadius;
  const lipY = surface.topY - surface.lipRadius;
  const lipX0 = centreX - halfWidth;
  const lipX1 = centreX + halfWidth;
  // Surface where the composition stands, the front edge and the rounded lip.
  points.push(lipX0, surface.topY, box.min.z, lipX1, surface.topY, box.min.z);
  points.push(lipX0, surface.topY, surface.frontTopZ, lipX1, surface.topY, surface.frontTopZ);
  points.push(lipX0, lipY, lipZ, lipX1, lipY, lipZ);
  return new Float32Array(points);
}

function aggregateStats(group, recorder) {
  const stats = { triangles: 0, meshes: 0, drawCalls: 0, parts: recorder.parts };
  group.traverse((object) => {
    if (object.isMesh) {
      stats.meshes += 1;
      stats.triangles += triangleCountOf(object.geometry);
    }
  });
  stats.triangles = Math.round(stats.triangles);
  stats.drawCalls = stats.meshes;
  stats.partsTriangles = Math.round(recorder.parts.reduce((sum, part) => sum + part.triangles, 0));
  return stats;
}

/* ------------------------------------------------------------ scene: stack */

function buildStackScene(context) {
  const { spec, materials, emblemTemplate, geometrySet } = context;
  const root = new THREE.Group();
  root.name = 'logo-blocks-stack';
  const recorder = createRecorder();
  const shell = buildStackShellGeometries(spec, geometrySet);
  const blocks = [];
  const blockBox = new THREE.Box3();
  const bounds = new THREE.Box3();

  for (let index = 0; index < spec.blockCount; index += 1) {
    const layout = spec.layout;
    const group = new THREE.Group();
    group.name = 'logo-block-' + index;

    const wall = addMesh(group, shell.wall, materials.stackBody, group.name + '-wall', 'dark metal side wall', recorder, index);
    const rim = addMesh(group, shell.rim, materials.stackRim, group.name + '-rim', 'rolled polished rim crest', recorder, index);
    const face = addMesh(group, shell.face, materials.stackFace, group.name + '-face', 'recessed satin silver face panel', recorder, index);
    const back = addMesh(group, shell.back, materials.stackBody, group.name + '-back', 'back plate', recorder, index, { castShadow: false });

    // Lead visual review 2026-10-26: the hero block stays monochrome (the
    // reference's coloured strips live on the exposed rear-block edges); blocks
    // 1-2 take the bright-gold band and the rear block the deep-gold band.
    const isRear = index === spec.accent.rearIndex;
    const hasAccent = spec.accent.frontBand || index !== spec.accent.frontIndex;
    const accentMaterial = isRear ? materials.goldDeep : materials.goldEdge;
    let accentMesh = null;
    if (hasAccent) {
      accentMesh = addMesh(
        group,
        shell.accent,
        accentMaterial,
        group.name + '-accent',
        isRear ? 'deep-gold accent band (rolled outer edge)' : 'bright-gold accent band (rolled outer edge)',
        recorder,
        index,
        { receiveShadow: false },
      );
    }

    let emblemGroup = null;
    if (emblemTemplate) {
      emblemGroup = emblemTemplate.group.clone(true);
      emblemGroup.name = group.name + '-emblem';
      group.add(emblemGroup);
      recorder.aggregate(
        emblemGroup.name,
        'TEKO arrow emboss (silver/graphite, 3 shapes)',
        'emblemSilver+emblemGraphite+socket',
        emblemTemplate.triangleCount,
        index,
      );
    }

    group.position.set(
      layout.frontX + layout.stepX * index,
      spec.surface.topY + layout.frontY + layout.stepY * index,
      layout.frontZ + layout.stepZ * index,
    );
    group.rotation.y = degToRad(layout.stepYawDeg * index);
    root.add(group);

    blocks.push({
      index,
      id: 'block-' + index,
      group,
      mesh: wall,
      meshes: { wall, rim, face, back },
      emblemGroup,
      accentMesh,
      accentTone: !hasAccent ? 'none' : isRear ? 'deep' : 'bright',
    });
  }

  // Authored dark reflective surface slab + soft contact shadow.
  const surfaceName = 'logo-blocks-stack-surface';
  const surface = buildSurfaceSlab({
    spec: spec.surface,
    name: surfaceName,
    material: materials.stackFloor,
    tile: 2,
    recorder,
    geometrySet,
  });
  root.add(surface);

  const shadowGeometry = buildContactShadowGeometry(spec.shadow, geometrySet);
  const shadowMesh = new THREE.Mesh(shadowGeometry, materials.contactShadow);
  shadowMesh.name = 'logo-blocks-stack-contact-shadow';
  shadowMesh.castShadow = false;
  shadowMesh.receiveShadow = false;
  shadowMesh.renderOrder = 2;
  shadowMesh.position.set(spec.shadow.centerX, spec.surface.topY + spec.shadow.raise, spec.shadow.centerZ);
  shadowMesh.userData = { role: 'soft contact shadow' };
  root.add(shadowMesh);
  recorder.add(shadowMesh, 'soft contact shadow');

  // Composition bounds (the blocks), camera fit points (blocks + table lip).
  for (const block of blocks) {
    block.group.updateMatrixWorld(true);
    blockBox.setFromObject(block.group);
    bounds.union(blockBox);
  }
  // The accent shell stands ~0.002 proud of the block silhouette; snap the
  // resting plane so bounds.min.y is exactly the surface the stack stands on.
  if (Math.abs(bounds.min.y - spec.surface.topY) < 0.02) bounds.min.y = spec.surface.topY;
  const fitPoints = buildSceneFitPoints(blocks, spec);

  const accentInfo = {
    count: blocks.filter((block) => block.accentMesh).length,
    colorSrgb: hexString(spec.accent.brightColor),
    deepSrgb: hexString(spec.accent.deepColor),
    emissiveSrgb: hexString(spec.accent.emissiveColor),
    emissiveIntensity: spec.accent.emissiveIntensity,
    bandHeight: spec.accent.zEnd - spec.accent.zStart,
    frontBlockAccent: spec.accent.frontBand,
    blocks: blocks.map((block) => ({
      index: block.index,
      tone: block.accentTone,
      colorSrgb:
        block.accentTone === 'deep'
          ? hexString(spec.accent.deepColor)
          : block.accentTone === 'bright'
            ? hexString(spec.accent.brightColor)
            : null,
      material: block.accentMesh ? block.accentMesh.material.name : null,
    })),
  };

  const scene = {
    name: 'stack',
    group: root,
    blocks,
    bounds: boundsObject(bounds),
    fitPoints,
    stats: aggregateStats(root, recorder),
    emblem: emblemTemplate ? emblemDebug(emblemTemplate) : emptyEmblemDebug(STACK_SPEC, context.logoSource),
    accent: accentInfo,
    surface: { name: surfaceName + '-top', topY: spec.surface.topY, frontLipZ: spec.surface.frontTopZ + spec.surface.lipRadius },
  };
  return scene;
}

/* ------------------------------------------------------------- scene: bank */

function buildBankScene(context) {
  const { spec, materials, emblemTemplate, geometrySet, panelStats, surfaceStats } = context;
  const root = new THREE.Group();
  root.name = 'logo-blocks-bank';
  const recorder = createRecorder();
  const shell = buildBankShellGeometries(spec, geometrySet);
  const blocks = [];

  const definitions = [
    { id: 'bank', layout: spec.layout.bank, panelMaterial: materials.bankPanel, panelRole: 'recessed fluted + dotted procedural panel' },
    { id: 'logo', layout: spec.layout.logo, panelMaterial: materials.bankFace, panelRole: 'recessed bright silver face panel' },
  ];

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const group = new THREE.Group();
    group.name = 'bank-block-' + definition.id;

    const wall = addMesh(group, shell.wall, materials.bankBody, group.name + '-wall', 'bright silver wall', recorder, index);
    const rim = addMesh(group, shell.rim, materials.bankRim, group.name + '-rim', 'bright rolled edge', recorder, index);
    const panelMesh = addMesh(group, shell.face, definition.panelMaterial, group.name + '-panel', definition.panelRole, recorder, index);
    const back = addMesh(group, shell.back, materials.bankBody, group.name + '-back', 'back plate', recorder, index, { castShadow: false });

    group.position.set(definition.layout.x, definition.layout.y, definition.layout.z);
    group.rotation.y = degToRad(definition.layout.yawDeg);

    const block = { index, id: definition.id, group, mesh: wall, panelMesh, meshes: { wall, rim, panel: panelMesh, back } };

    if (definition.id === 'logo') {
      const ringMesh = addMesh(
        group,
        shell.ring,
        materials.goldEdge,
        group.name + '-gold-ring',
        'thin gold accent ring around the face edge',
        recorder,
        index,
        { receiveShadow: false },
      );
      block.accentMesh = ringMesh;
      if (emblemTemplate) {
        const emblemGroup = emblemTemplate.group.clone(true);
        emblemGroup.name = group.name + '-emblem';
        group.add(emblemGroup);
        block.emblemGroup = emblemGroup;
        recorder.aggregate(
          emblemGroup.name,
          'TEKO arrow emboss (silver/graphite, 3 shapes)',
          'emblemSilver+emblemGraphite+socket',
          emblemTemplate.triangleCount,
          index,
        );
      }
    } else {
      const icon = buildBankIcon({
        spec: spec.bankIcon,
        faceSize: spec.faceSize,
        materials,
        geometrySet,
        panelZ: spec.faceZ - spec.thickness / 2,
      });
      group.add(icon.group);
      block.bankIcon = {
        group: icon.group,
        parts: icon.parts,
        shadowParts: icon.shadowParts,
        shapeCount: icon.shapeCount,
        shadowShapeCount: icon.shadowShapeCount,
        relief: icon.relief,
        width: icon.width,
        measuredWidth: icon.measuredWidth,
        measuredHeight: icon.measuredHeight,
        triangleCount: icon.parts.reduce((sum, part) => sum + part.triangles, 0),
        shadowTriangleCount: icon.shadowParts.reduce((sum, part) => sum + part.triangles, 0),
      };
      recorder.aggregate(group.name + '-bank-icon', 'classical bank icon relief (12 rounded shapes)', 'bankIcon+bankIconEdge',
        icon.parts.reduce((sum, part) => sum + part.triangles, 0), index);
      recorder.aggregate(group.name + '-bank-icon-shadow', 'bank icon shadow/separation plates (12)', 'bankShadow',
        icon.shadowParts.reduce((sum, part) => sum + part.triangles, 0), index);
    }

    root.add(group);
    blocks.push(block);
  }

  // Authored light concrete surface slab + soft contact shadows under both plaques.
  const surfaceName = 'logo-blocks-bank-surface';
  const surface = buildSurfaceSlab({
    spec: spec.surface,
    name: surfaceName,
    material: materials.concrete,
    tile: spec.surface.textureTile,
    recorder,
    geometrySet,
  });
  root.add(surface);

  const shadowGeometry = buildContactShadowGeometry(spec.shadow, geometrySet);
  for (const block of blocks) {
    const shadowMesh = new THREE.Mesh(shadowGeometry, materials.contactShadow);
    shadowMesh.name = 'logo-blocks-bank-shadow-' + block.id;
    shadowMesh.castShadow = false;
    shadowMesh.receiveShadow = false;
    shadowMesh.renderOrder = 2;
    shadowMesh.position.set(block.group.position.x, spec.surface.topY + spec.shadow.raise, block.group.position.z + spec.shadow.offsetZ);
    shadowMesh.userData = { role: 'soft contact shadow' };
    root.add(shadowMesh);
    recorder.add(shadowMesh, 'soft contact shadow');
  }

  const bounds = new THREE.Box3();
  const blockBox = new THREE.Box3();
  for (const block of blocks) {
    block.group.updateMatrixWorld(true);
    blockBox.setFromObject(block.group);
    bounds.union(blockBox);
  }
  // Float32 vertex precision makes the resting plane a few 1e-8 off; snap it to
  // the authored slab top so the previewer's studio floor aligns exactly.
  if (Math.abs(bounds.min.y - spec.surface.topY) < 0.02) bounds.min.y = spec.surface.topY;
  const fitPoints = buildSceneFitPoints(blocks, spec);

  const texturesRuntime = {
    panel: {
      albedo: context.panelMaps.textures.albedo,
      normal: context.panelMaps.textures.normal,
      roughness: context.panelMaps.textures.roughness,
      size: panelStats.size,
      faceSize: panelStats.faceSize,
      flutePeriod: spec.panel.flutePeriod,
      flutePeriodPx: panelStats.flutePeriodPx,
      dotSpacing: spec.panel.dotSpacing,
      dotSpacingPx: panelStats.dotSpacingPx,
      dotCount: panelStats.dotCount,
      dotSeed: panelStats.dotSeed,
    },
    surface: {
      albedo: context.surfaceMaps.textures.albedo,
      normal: context.surfaceMaps.textures.normal,
      roughness: null,
      size: surfaceStats.size,
      tileWorld: surfaceStats.tileWorld,
      meanLuma: surfaceStats.meanLuma,
    },
    dotSeed: panelStats.dotSeed,
    dotSpacing: spec.panel.dotSpacing,
    flutePeriod: spec.panel.flutePeriod,
  };

  const scene = {
    name: 'bank',
    group: root,
    blocks,
    bounds: boundsObject(bounds),
    fitPoints,
    stats: aggregateStats(root, recorder),
    emblem: emblemTemplate ? emblemDebug(emblemTemplate) : emptyEmblemDebug(BANK_SPEC, context.logoSource),
    bankIcon: blocks.find((block) => block.bankIcon) ? bankIconDebug(blocks.find((block) => block.bankIcon).bankIcon, spec) : null,
    textures: texturesRuntime,
    surface: { name: surfaceName + '-top', topY: spec.surface.topY, frontLipZ: spec.surface.frontTopZ + spec.surface.lipRadius },
  };
  return scene;
}

/* ----------------------------------------------------------- debug helpers */

function emblemDebug(emblem) {
  const tones = new Set(emblem.shapes.map((shape) => shape.tone));
  return {
    source: emblem.source,
    shapeCount: emblem.shapes.length,
    tone: 'silver-graphite',
    twoTone: tones.size > 1,
    shapes: emblem.shapes.map((shape) => ({ fill: shape.fill, tone: shape.tone, triangles: Math.round(shape.triangles) })),
    width: emblem.width,
    height: emblem.height,
    relief: emblem.relief,
    triangleCount: Math.round(emblem.triangleCount),
    parts: emblem.parts,
  };
}

function emptyEmblemDebug(spec, source) {
  return {
    source: source || LOGO_SOURCE_PATH,
    shapeCount: 0,
    tone: 'silver-graphite',
    twoTone: false,
    shapes: [],
    width: spec.emblem.width * spec.faceSize,
    relief: spec.emblem.relief,
    triangleCount: 0,
    parts: [],
    note: 'logo SVG not supplied to createLogoBlocksModel',
  };
}

function bankIconDebug(bankIcon, spec) {
  return {
    shapeCount: bankIcon.shapeCount,
    shadowShapeCount: bankIcon.shadowShapeCount || 0,
    parts: bankIcon.parts.map((part) => ({ name: part.name, triangles: Math.round(part.triangles) })),
    relief: bankIcon.relief,
    width: bankIcon.width,
    measuredWidth: bankIcon.measuredWidth,
    measuredHeight: bankIcon.measuredHeight,
    triangleCount: Math.round(bankIcon.triangleCount),
    shadowTriangleCount: Math.round(bankIcon.shadowTriangleCount || 0),
    panelWidth: spec.faceSize,
  };
}

function textureDebug(texture) {
  if (!texture) return null;
  const image = texture.image || {};
  return {
    name: texture.name,
    size: [image.width || null, image.height || null],
    encoding: texture.encoding === THREE.sRGBEncoding ? 'sRGB' : 'linear',
    wrap: texture.wrapS === THREE.RepeatWrapping ? 'repeat' : 'clamp',
  };
}

function materialDebug(key, material, spec) {
  const maps = [];
  for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
    if (material[slot]) maps.push({ slot, ...textureDebug(material[slot]) });
  }
  return {
    name: material.name,
    type: material.type,
    colorSrgb: spec && spec.color !== undefined ? hexString(spec.color) : null,
    specColorHex: material.userData && material.userData.specColorHex ? material.userData.specColorHex : null,
    metalness: material.metalness === undefined ? null : material.metalness,
    roughness: material.roughness === undefined ? null : material.roughness,
    envMapIntensity: material.envMapIntensity === undefined ? null : material.envMapIntensity,
    emissiveSrgb: spec && spec.emissive !== undefined ? hexString(spec.emissive) : null,
    emissiveIntensity: material.emissiveIntensity === undefined ? null : material.emissiveIntensity,
    maps,
    bakedLighting: false,
    role: spec && spec.role ? spec.role : '',
  };
}

function sceneDebug(scene, spec) {
  const sceneSurface = spec.surface;
  const base = {
    name: scene.name,
    blockCount: scene.blocks.length,
    blocks: scene.blocks.map((block) => {
      const position = block.group.position;
      return {
        index: block.index,
        id: block.id,
        position: { x: position.x, y: position.y, z: position.z },
        rotationYDeg: Math.round((block.group.rotation.y / DEG) * 1000) / 1000,
        faceSize: spec.faceSize,
        thickness: spec.thickness,
        cornerRadius: spec.cornerRadius,
        triangles: Math.round(triangleCountOf(block.mesh.geometry)),
        accentTone: block.accentTone || null,
        accentMaterial: block.accentMesh ? block.accentMesh.material.name : null,
        emblemShapes: block.emblemGroup ? 3 : 0,
        panel: block.panelMesh ? block.panelMesh.material.name : null,
        bankIconShapes: block.bankIcon ? block.bankIcon.shapeCount : 0,
      };
    }),
    layout: {
      frontBlockAtPositiveXZ: scene.name === 'stack',
      stepX: scene.name === 'stack' ? STACK_SPEC.layout.stepX : null,
      stepZ: scene.name === 'stack' ? STACK_SPEC.layout.stepZ : null,
      stepY: scene.name === 'stack' ? STACK_SPEC.layout.stepY : null,
      stepYawDeg: scene.name === 'stack' ? STACK_SPEC.layout.stepYawDeg : null,
      plaqueY: scene.name === 'bank' ? BANK_SPEC.layout.plaqueY : null,
    },
    bounds: scene.bounds,
    fitPoints: {
      count: scene.fitPoints.length / 3,
      min: minOfPoints(scene.fitPoints),
      max: maxOfPoints(scene.fitPoints),
    },
    stats: scene.stats,
    emblem: scene.emblem,
    surface: {
      topY: scene.surface.topY,
      frontLipZ: scene.surface.frontLipZ,
      slabWidth: sceneSurface.width,
      slabFrontTopZ: sceneSurface.frontTopZ,
      slabBackZ: sceneSurface.backZ,
    },
  };
  if (scene.accent) base.accent = scene.accent;
  if (scene.bankIcon) base.bankIcon = scene.bankIcon;
  if (scene.textures) {
    base.textures = {
      panel: {
        size: scene.textures.panel.size,
        albedo: textureDebug(scene.textures.panel.albedo),
        normal: textureDebug(scene.textures.panel.normal),
        roughness: textureDebug(scene.textures.panel.roughness),
        flutePeriod: scene.textures.panel.flutePeriod,
        flutePeriodPx: scene.textures.panel.flutePeriodPx,
        dotSpacing: scene.textures.panel.dotSpacing,
        dotSpacingPx: scene.textures.panel.dotSpacingPx,
        dotCount: scene.textures.panel.dotCount,
        dotSeed: scene.textures.panel.dotSeed,
      },
      surface: {
        size: scene.textures.surface.size,
        albedo: textureDebug(scene.textures.surface.albedo),
        normal: textureDebug(scene.textures.surface.normal),
        roughness: null,
        tileWorld: scene.textures.surface.tileWorld,
        meanLuma: scene.textures.surface.meanLuma,
      },
      dotSeed: scene.textures.dotSeed,
      dotSpacing: scene.textures.dotSpacing,
      flutePeriod: scene.textures.flutePeriod,
    };
  }
  return base;
}

function minOfPoints(points) {
  let x = Infinity;
  let y = Infinity;
  let z = Infinity;
  for (let i = 0; i < points.length; i += 3) {
    if (points[i] < x) x = points[i];
    if (points[i + 1] < y) y = points[i + 1];
    if (points[i + 2] < z) z = points[i + 2];
  }
  return { x, y, z };
}

function maxOfPoints(points) {
  let x = -Infinity;
  let y = -Infinity;
  let z = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    if (points[i] > x) x = points[i];
    if (points[i + 1] > y) y = points[i + 1];
    if (points[i + 2] > z) z = points[i + 2];
  }
  return { x, y, z };
}

/* ------------------------------------------------------------------ model */

function createMaterials(textures) {
  const materials = {};
  for (const [key, config] of Object.entries(MATERIAL_SPEC)) {
    if (config.kind === 'shadow') {
      const material = new THREE.MeshBasicMaterial({
        name: 'logo-blocks-' + key,
        color: workingColorFromHex(config.color),
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      material.userData = { role: config.role, specColorHex: hexString(config.color) };
      materials[key] = material;
      continue;
    }
    const material = new THREE.MeshStandardMaterial({
      name: 'logo-blocks-' + key,
      color: workingColorFromHex(config.color),
      metalness: config.metalness === undefined ? 0 : config.metalness,
      roughness: config.roughness === undefined ? 1 : config.roughness,
      envMapIntensity: config.envMapIntensity === undefined ? 1 : config.envMapIntensity,
      dithering: true,
    });
    if (config.colorScale !== undefined && config.colorScale !== 1) material.color.multiplyScalar(config.colorScale);
    if (config.emissive !== undefined) {
      material.emissive = workingColorFromHex(config.emissive);
      material.emissiveIntensity = config.emissiveIntensity === undefined ? 1 : config.emissiveIntensity;
    }
    if (key === 'bankPanel' && textures && textures.panel) {
      material.map = textures.panel.albedo;
      material.normalMap = textures.panel.normal;
      material.roughnessMap = textures.panel.roughness;
      // The roughness map carries the 0.14..0.46 range; material.roughness is a
      // multiplier in three, so it stays at 1.0.
      material.roughness = 1.0;
    }
    if (key === 'bankIcon' && textures && textures.panel) {
      // Same projected fluted/dotted field continues across the raised icon, but
      // the icon stays polished (scalar roughness) so its chamfer catches the key
      // light and reads as a raised classical bank, not engraved lines.
      material.map = textures.panel.albedo;
      material.normalMap = textures.panel.normal;
    }
    if (key === 'concrete' && textures && textures.surface) {
      material.map = textures.surface.albedo;
      material.normalMap = textures.surface.normal;
    }
    material.userData = {
      role: config.role,
      specColorHex: hexString(config.color),
      procedural: true,
      local: true,
    };
    materials[key] = material;
  }
  return materials;
}

/**
 * Create both logo-block compositions.
 *
 * @param {object} options
 * @param {string} options.logoSvgText  UTF-8 text of assets/logo-blocks/teko2_icon.svg
 * @param {string} [options.logoSourcePath] provenance path reported by getDebug()
 * @param {number} [options.seed] override for the fixed SEED (QA only; keep default)
 * @param {string} [options.quality] 'hero' (default) or 'preview'; geometry and
 *   texture resolution are fixed, so both qualities are byte-identical — the
 *   option is recorded for the previewer's layer rail but never changes output.
 * @returns {object} model
 */
export function createLogoBlocksModel(options = {}) {
  const seed = options.seed === undefined || options.seed === null ? SEED : Number(options.seed) >>> 0;
  const quality = options.quality === undefined ? 'hero' : String(options.quality);
  const logoSvgText = typeof options.logoSvgText === 'string' ? options.logoSvgText : '';
  const logoSource = options.logoSourcePath || LOGO_SOURCE_PATH;

  const warnings = [];
  const geometrySet = new Set();
  const textureSet = new Set();

  // Two procedural surface texture families, both fixed 1024^2 and seeded.
  const panelMaps = buildPanelMaps(BANK_SPEC.panel, BANK_SPEC.faceSize, seed);
  const surfaceMaps = buildConcreteMaps(BANK_SPEC.surface, seed);
  for (const texture of Object.values(panelMaps.textures)) textureSet.add(texture);
  for (const texture of Object.values(surfaceMaps.textures)) textureSet.add(texture);
  const textures = { panel: panelMaps.textures, surface: surfaceMaps.textures };
  const materials = createMaterials(textures);

  let parsedLogo = null;
  let stackEmblem = null;
  let bankEmblem = null;
  if (logoSvgText) {
    try {
      parsedLogo = parseTekoLogoSvg(logoSvgText, { curveSegments: STACK_SPEC.emblem.curveSegments });
      stackEmblem = buildEmblem({
        parsed: parsedLogo,
        spec: STACK_SPEC.emblem,
        faceSize: STACK_SPEC.faceSize,
        surfaceZ: STACK_SPEC.faceZ - STACK_SPEC.thickness / 2,
        materials,
        geometrySet,
        source: logoSource,
      });
      bankEmblem = buildEmblem({
        parsed: parsedLogo,
        spec: BANK_SPEC.emblem,
        faceSize: BANK_SPEC.faceSize,
        surfaceZ: BANK_SPEC.faceZ - BANK_SPEC.thickness / 2,
        materials,
        geometrySet,
        source: logoSource,
      });
    } catch (error) {
      warnings.push('emblem export failed: ' + (error && error.message ? error.message : error));
      parsedLogo = null;
      stackEmblem = null;
      bankEmblem = null;
    }
  } else {
    warnings.push('no logo SVG source supplied; logo blocks built without the TEKO emblem');
  }

  const stackScene = buildStackScene({
    spec: STACK_SPEC,
    materials,
    emblemTemplate: stackEmblem,
    geometrySet,
    logoSource,
  });
  const bankScene = buildBankScene({
    spec: BANK_SPEC,
    materials,
    emblemTemplate: bankEmblem,
    geometrySet,
    logoSource,
    panelMaps,
    surfaceMaps,
    panelStats: panelMaps.stats,
    surfaceStats: surfaceMaps.stats,
  });

  const model = {
    version: MODEL_VERSION,
    seed,
    quality,
    spec: { stack: STACK_SPEC, bank: BANK_SPEC },
    materials,
    textures,
    logo: {
      source: logoSource,
      pngPath: LOGO_PNG_PATH,
      shapeCount: parsedLogo ? parsedLogo.shapes.length : 0,
      fills: parsedLogo ? Array.from(new Set(parsedLogo.shapes.map((shape) => shape.fill))) : [],
      bbox: parsedLogo ? parsedLogo.bbox : null,
    },
    scenes: { stack: stackScene, bank: bankScene },
    warnings,
    getDebug() {
      return {
        version: MODEL_VERSION,
        seed,
        quality,
        logo: {
          source: logoSource,
          pngPath: LOGO_PNG_PATH,
          shapeCount: parsedLogo ? parsedLogo.shapes.length : 0,
          fills: parsedLogo ? Array.from(new Set(parsedLogo.shapes.map((shape) => shape.fill))) : [],
          bbox: parsedLogo
            ? {
                width: parsedLogo.bbox.width,
                height: parsedLogo.bbox.height,
                minX: parsedLogo.bbox.minX,
                minY: parsedLogo.bbox.minY,
                maxX: parsedLogo.bbox.maxX,
                maxY: parsedLogo.bbox.maxY,
              }
            : null,
        },
        scenes: { stack: sceneDebug(stackScene, STACK_SPEC), bank: sceneDebug(bankScene, BANK_SPEC) },
        camera: CAMERA_SPEC,
        materials: Object.fromEntries(
          Object.entries(materials).map(([key, material]) => [key, materialDebug(key, material, MATERIAL_SPEC[key])]),
        ),
        textureFamilies: {
          panel: { size: panelMaps.stats.size, maps: ['albedo', 'normal', 'roughness'], ...panelMaps.stats },
          surface: { size: surfaceMaps.stats.size, maps: ['albedo', 'normal'], ...surfaceMaps.stats },
        },
        totals: {
          triangles: stackScene.stats.triangles + bankScene.stats.triangles,
          meshes: stackScene.stats.meshes + bankScene.stats.meshes,
          geometries: geometrySet.size,
          textures: textureSet.size,
        },
        warnings: warnings.slice(),
      };
    },
    dispose() {
      for (const geometry of geometrySet) {
        try {
          geometry.dispose();
        } catch (error) {
          /* best effort */
        }
      }
      for (const texture of textureSet) {
        try {
          texture.dispose();
        } catch (error) {
          /* best effort */
        }
      }
      for (const material of Object.values(materials)) {
        try {
          material.dispose();
        } catch (error) {
          /* best effort */
        }
      }
    },
  };

  return model;
}
