/**
 * tekoanimation — Billing "layer stack" model, Revision 32 (model 6.0.0).
 *
 * Seven US Letter (8.5 x 11, long axis = 11) sheets float with equal air gaps
 * above a satin column platform (the real Columns deliverable column
 * `satin-large-long`, imported whole from src/columns-model.js, no cropping).
 * Bottom -> top the layers are
 *
 *     paper, paper, paper, glow, acrylic, acrylic, acrylic
 *
 * Two model classes (SHEET_CLASS):
 *
 *   PAPER   - white matte paper with a wave (a corner drape plus a travelling
 *             ripple), a thin dark line-art decal. Unchanged since Rev21 s55.
 *     - paper : plain white paper bill.
 *     - glow  : the same paper plus an ORANGE INNER GLOW (an emissive map that
 *               is bright at the sheet border and fades toward the middle).
 *   ACRYLIC - Rev32: ONE clear acrylic plate. The old grey circuit board, its
 *             trace texture and the embossed glyph strokes are GONE (the model
 *             no longer imitates a circuit board). What is left is the surface
 *             pattern the user supplied (the doc-icon line layout) painted over
 *             a dot grid on the clear plate. The plate is thickened INWARD: it
 *             keeps the retired stack's top face height (board + glyph + air +
 *             acrylic = 0.128 thick) and grows down to the old board underside,
 *             so the stack silhouette is unchanged and nothing shifts upward.
 *
 * Nothing readable is ever painted: only strokes, dots, rules and outlines.
 * There are no THREE lights: the page lights this model with the shared image
 * based environment in src/env-room.js.
 *
 * Node-friendly: every canvas painter takes an injected 2D context and every
 * texture is created through an injectable `createCanvas`, so
 * tools/verify-billing.mjs can build and measure the model without a DOM. The
 * satin column is attached afterwards with `model.attachColumnPlatform(bank)`
 * (bank = loadColumnBank() result from src/columns-model.js).
 */

import * as THREE from 'three';
import { createColumns, COLUMN_GEOMETRY_RATIO } from './columns-model.js';

/* ------------------------------------------------------------------ version */

export const MODEL_VERSION = '6.0.0';

/* ------------------------------------------------------------- sheet stacks */

export const SHEET_COUNT = 7;

/** Bottom -> top. */
export const SHEET_KINDS = Object.freeze([
  'paper', 'paper', 'paper', 'glow', 'acrylic', 'acrylic', 'acrylic',
]);

export const KIND_COUNTS = Object.freeze({ paper: 3, glow: 1, acrylic: 3 });

/** The two model classes: paper (wavy, + glow variant) and acrylic (clear plate + pattern). */
export const SHEET_CLASS = Object.freeze({ paper: 'paper', glow: 'paper', acrylic: 'acrylic' });

/** US Letter: 11 in long x 8.5 in short. */
export const LETTER_ASPECT = 11 / 8.5;

/**
 * Rev32 clear acrylic plate (replaces the retired circuit board + embossed glyph
 * layer). One plate per sheet: clear, transparent, clearcoated, with a bright
 * bevelled rim. The plate is thickened INWARD - its top face keeps the retired
 * acrylic top height, its underside reaches the old board underside, so the
 * stack is unchanged and nothing moves upward.
 */
export const ACRYLIC_PLATE = Object.freeze({
  /** Top face height above the sheet centre plane (unchanged acrylic top). */
  topY: 0.103,
  /** Underside height (the retired circuit board underside). */
  bottomY: -0.025,
  /** Curvature 0: a clear plate is rigid and perfectly flat. */
  curvature: 0,
  /** Surface pattern ink: Rev32 - the lines are THICKER and LESS concentrated. */
  patternLineWidth: 14,
  patternInk: 'rgba(246, 250, 255, 0.52)',
  patternInkSoft: 'rgba(246, 250, 255, 0.34)',
});
export const ACRYLIC_PLATE_THICKNESS = ACRYLIC_PLATE.topY - ACRYLIC_PLATE.bottomY;

export const SHEET_SPEC = Object.freeze({
  /** Long axis (local X): US Letter 11 in at 0.4 world units per inch. */
  length: 4.4,
  /** Short axis (local Z): US Letter 8.5 in at 0.4 world units per inch. */
  width: 3.4,
  cornerRadius: 0.1,
  thickness: Object.freeze({ paper: 0.03, glow: 0.03, acrylic: ACRYLIC_PLATE_THICKNESS }),
  bevel: Object.freeze({ paper: 0, glow: 0, acrylic: 0.01 }),
  /** Surface grid for the wavy paper sheets. */
  gridU: 72,
  gridV: 56,
});

/**
 * Drape amplitude per PAPER sheet (index 0 = bottom-most). Curvature increases
 * toward the bottom: 0.95 > 0.72 > 0.52. Acceptance threshold is
 * 0.02 x sheet length = 0.088.
 */
export const PAPER_CURVATURE = Object.freeze([0.95, 0.72, 0.52]);

/** The glow paper keeps the paper wave (a milder drape). */
export const GLOW_CURVATURE = 0.4;

/** Travelling ripple added on top of the drape of every paper-class sheet. */
export const PAPER_WAVE = Object.freeze({ amplitude: 0.055, cycles: 1.75, phase: 0.6 });

export const LAYOUT = Object.freeze({
  /** Centre-plane height of the bottom sheet. */
  baseY: 1.12,
  /** Equal centre-plane gap between consecutive sheets. */
  gap: 0.62,
  /** In-plane yaw of every sheet: the long axis runs left -> right-front. */
  yawDeg: -58,
  /** Tiny per-layer yaw offset so the stack reads as a hand-stacked pile. */
  yawStepDeg: 1.1,
  /** Tiny per-layer plan offset (local X / local Z, world units). */
  shiftX: 0.035,
  shiftZ: 0.012,
});

/**
 * Platform = the Columns collection's `satin-large-long` column (600 px long,
 * 140 x 140 px cross-section, 1 px = 1 source unit), the WHOLE model, laid
 * horizontal (rotated -90 deg about Z, as logo-blocks does) and uniformly
 * scaled; its top face (600*scale long x 140*scale deep) is the stage.
 */
export const SUPPORT_SPEC = Object.freeze({
  columnId: 'satin-large-long',
  materialId: 'satin',
  source: './src/columns-model.js',
  lengthPx: 600,
  crossSectionPx: 140,
  scale: 0.04,
  /** Top face height (the sheets float above it). */
  topY: 0.18,
  centerX: 0,
  centerZ: 0,
  /** Camera fit window on the top face (half extents) and the visible-body floor. */
  fitHalfX: 2.7,
  fitHalfZ: 2.3,
  cropY: -0.7,
});

export const CAMERA_SPEC = Object.freeze({
  fov: 30,
  azimuthDeg: -42,
  elevationDeg: 32,
  targetYOffset: 0.35,
  fitMargin: 0.93,
  fitMarginNarrow: 0.9,
  near: 1,
  far: 400,
  narrowStageWidth: 760,
});

/** Preview zoom: multiplies the fitted camera distance (smaller = closer). */
export const ZOOM_SPEC = Object.freeze({ min: 0.4, max: 2.5, default: 1, step: 1.2, wheelSpeed: 0.0015 });

export const ANIMATION_SPEC = Object.freeze({
  /** Each sheet's own entrance. */
  sheetDurationMs: 940,
  /** Bottom-most sheet starts first, one stagger per layer. */
  staggerMs: 165,
  /** A small downward offset the sheet rises out of (it stays in its own slot). */
  entryRise: 0.5,
});

export const DECAL_SPEC = Object.freeze({
  width: 2048,
  height: 1582,
  /** Shared seed per paper decal. */
  seedBase: Object.freeze({ paper: 8329 }),
});

export const TEXTURE_SPEC = Object.freeze({
  paper: Object.freeze({ width: 512, height: 512 }),
  glow: Object.freeze({ width: 512, height: 512 }),
});

export const TAU = Math.PI * 2;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (from, to, t) => from + (to - from) * t;
export const degToRad = (deg) => (deg * Math.PI) / 180;
export const radToDeg = (rad) => (rad * 180) / Math.PI;
export const round = (value, digits = 3) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Deterministic 32-bit LCG in [0,1); the only randomness used anywhere. */
export function createSeededRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/* ------------------------------------------------------------------- poses */

export function sheetY(index) {
  const i = clamp(Math.floor(index), 0, SHEET_COUNT - 1);
  return LAYOUT.baseY + i * LAYOUT.gap;
}

/** Equal centre-plane air gap between consecutive sheets (constant). */
export function sheetGap() {
  return LAYOUT.gap;
}

export function sheetYawDeg(index) {
  const i = clamp(Math.floor(index), 0, SHEET_COUNT - 1);
  return LAYOUT.yawDeg + (i - (SHEET_COUNT - 1) / 2) * LAYOUT.yawStepDeg;
}

/** Final plan offset of a sheet (small hand-stacked drift, symmetric about the middle). */
export function sheetShift(index) {
  const i = clamp(Math.floor(index), 0, SHEET_COUNT - 1);
  const centred = i - (SHEET_COUNT - 1) / 2;
  return { x: centred * LAYOUT.shiftX, z: centred * LAYOUT.shiftZ };
}

/** Curvature (max drape drop) for a sheet index. */
export function sheetCurvature(index) {
  const i = clamp(Math.floor(index), 0, SHEET_COUNT - 1);
  const kind = SHEET_KINDS[i];
  if (kind === 'paper') return PAPER_CURVATURE[i];
  if (kind === 'glow') return GLOW_CURVATURE;
  return ACRYLIC_PLATE.curvature;
}

/**
 * Draped paper surface: downward offset for surface coordinates u (long axis,
 * -1..1) and v (short axis, -1..1). The drape is strongest at the u = -1 / v = +1
 * corner (the near-left corner in the shot) and fades to a flat plane.
 */
export function paperDrapeOffset(u, v, amplitude) {
  const uc = clamp(u, -1, 1);
  const vc = clamp(v, -1, 1);
  // 0 for u >= 0.15, rising to 1 at u = -1 (the near-left end).
  const along = smoothstep(0.15, -1, uc);
  // The near edge (v = +1) drapes a little more than the far edge.
  const across = 0.55 + 0.45 * smoothstep(-1, 1, vc);
  return -amplitude * along * across;
}

/** Final local pose of one sheet. */
export function sheetPose(index) {
  const i = clamp(Math.floor(index), 0, SHEET_COUNT - 1);
  const shift = sheetShift(i);
  return {
    position: { x: shift.x, y: sheetY(i), z: shift.z },
    rotationDeg: { x: 0, y: sheetYawDeg(i), z: 0 },
  };
}

/** Initial (pre-entrance) local pose: hidden below its slot, tilted out a touch. */
export function sheetEntryPose(index) {
  const i = clamp(Math.floor(index), 0, SHEET_COUNT - 1);
  const final = sheetPose(i);
  return {
    position: {
      x: final.position.x - 0.1,
      y: final.position.y - ANIMATION_SPEC.entryRise,
      z: final.position.z,
    },
    rotationDeg: {
      x: 0,
      y: final.rotationDeg.y - 1.4,
      z: 0,
    },
  };
}

export function sheetStartMs(index) {
  const i = clamp(Math.floor(index), 0, SHEET_COUNT - 1);
  return i * ANIMATION_SPEC.staggerMs;
}

export function animationTotalMs() {
  return sheetStartMs(SHEET_COUNT - 1) + ANIMATION_SPEC.sheetDurationMs;
}

/** Per-sheet animation state for a global elapsed time. */
export function sheetAnimationState(index, elapsedMs) {
  const start = sheetStartMs(index);
  const raw = clamp((elapsedMs - start) / ANIMATION_SPEC.sheetDurationMs, 0, 1);
  return {
    startMs: start,
    raw,
    progress: easeInOutCubic(raw),
    visible: elapsedMs >= start,
    settled: raw >= 1,
  };
}

/** Interpolate between two sheet poses. */
export function lerpSheetPose(from, to, t) {
  const k = clamp(Number(t) || 0, 0, 1);
  return {
    position: {
      x: lerp(from.position.x, to.position.x, k),
      y: lerp(from.position.y, to.position.y, k),
      z: lerp(from.position.z, to.position.z, k),
    },
    rotationDeg: {
      x: lerp(from.rotationDeg.x, to.rotationDeg.x, k),
      y: lerp(from.rotationDeg.y, to.rotationDeg.y, k),
      z: lerp(from.rotationDeg.z, to.rotationDeg.z, k),
    },
  };
}

export function applySheetPose(sheet, pose) {
  if (!sheet || !sheet.group) return;
  sheet.group.position.set(pose.position.x, pose.position.y, pose.position.z);
  sheet.group.rotation.set(
    degToRad(pose.rotationDeg.x),
    degToRad(pose.rotationDeg.y),
    degToRad(pose.rotationDeg.z),
  );
}

/** Apply a deterministic pose: 'final' (all entered) or 'initial' (empty stack). */
export function applyStaticPose(model, mode = 'final') {
  if (!model || !Array.isArray(model.sheets)) return;
  model.sheets.forEach((sheet) => {
    const pose = mode === 'initial' ? sheetEntryPose(sheet.index) : sheetPose(sheet.index);
    applySheetPose(sheet, pose);
    sheet.group.visible = mode !== 'initial';
    if (sheet.decal) sheet.decal.visible = mode !== 'initial';
  });
  model.pose = mode;
}

/** Apply the bottom-up staggered entrance for a global elapsed time. */
export function applyAnimationFrame(model, elapsedMs) {
  if (!model || !Array.isArray(model.sheets)) return;
  const elapsed = clamp(Number(elapsedMs) || 0, 0, animationTotalMs());
  model.sheets.forEach((sheet) => {
    const finalPose = sheetPose(sheet.index);
    const entryPose = sheetEntryPose(sheet.index);
    const state = sheetAnimationState(sheet.index, elapsed);
    applySheetPose(sheet, lerpSheetPose(entryPose, finalPose, state.progress));
    sheet.group.visible = state.visible;
    if (sheet.decal) sheet.decal.visible = state.visible;
  });
  model.elapsedMs = elapsed;
  model.pose = elapsed >= animationTotalMs() ? 'final' : elapsed <= 0 ? 'initial' : 'entering';
}

/* ----------------------------------------------------------------- artwork */
/* ----------------------------------------------------------------- artwork */

const PAPER_INK = 'rgba(15, 19, 27, 0.55)';
const PAPER_INK_SOFT = 'rgba(15, 19, 27, 0.34)';

/* Doc-icon layout (portrait page, fractions of the page box; page top-right dog-ear is
 * deliberately NOT drawn - the page outline is the sheet edge itself). Elements, in order:
 * gutter rule, title box, 3 centred rules, 2 wide boxes, 2 small boxes. */
export const PAPER_LAYOUT = Object.freeze({
  gutter: Object.freeze({ x: 0.1, y0: 0.05, y1: 0.95 }),
  title: Object.freeze({ x: 0.2, y: 0.06, w: 0.4, h: 0.085 }),
  rules: Object.freeze([
    Object.freeze({ y: 0.205, w: 0.45 }),
    Object.freeze({ y: 0.465, w: 0.45 }),
    Object.freeze({ y: 0.725, w: 0.45 }),
  ]),
  wideBoxes: Object.freeze([
    Object.freeze({ y: 0.255, w: 0.6, h: 0.15 }),
    Object.freeze({ y: 0.785, w: 0.6, h: 0.15 }),
  ]),
  smallBoxes: Object.freeze([
    Object.freeze({ x: 0.2, y: 0.515, w: 0.25, h: 0.15 }),
    Object.freeze({ x: 0.55, y: 0.515, w: 0.25, h: 0.15 }),
  ]),
  centreX: 0.5,
});

export function paperArtworkSpecFor(index = 0) {
  const variant = index % 3;
  return {
    kind: 'paper-decal',
    variant,
    width: DECAL_SPEC.width,
    height: DECAL_SPEC.height,
    seed: DECAL_SPEC.seedBase.paper + variant * 911,
    anisotropy: 16,
    ink: PAPER_INK,
    inkSoft: PAPER_INK_SOFT,
    layout: 'doc-icon',
    elements: ['gutter', 'title', 'rule', 'rule', 'rule', 'wideBox', 'wideBox', 'smallBox', 'smallBox'],
    marginFrac: 0.05,
    lineWidth: 8,
  };
}

/** The portrait doc-icon page is rotated a quarter turn onto the landscape sheet
 *  (page top at canvas left); all strokes share one ink tone, width, round caps/joins. */
export function drawPaperArtwork(ctx, spec) {
  ctx.clearRect(0, 0, spec.width, spec.height);
  drawPaperLayout(ctx, spec);
}

/** The doc-icon strokes only (no clear) - shared by the paper decal and the acrylic pattern. */
export function drawPaperLayout(ctx, spec) {
  const w = spec.width;
  const h = spec.height;
  const L = PAPER_LAYOUT;

  const mx = w * spec.marginFrac;
  const my = h * spec.marginFrac;
  const pageW = h - my * 2; // page width runs along canvas y
  const pageH = w - mx * 2; // page height runs along canvas x
  const px = (fx, fy) => [mx + fy * pageH, my + (1 - fx) * pageW];
  const radius = pageW * 0.022;

  ctx.strokeStyle = spec.ink;
  ctx.lineWidth = spec.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const line = (fx0, fy0, fx1, fy1) => {
    const [x0, y0] = px(fx0, fy0);
    const [x1, y1] = px(fx1, fy1);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const box = (fx, fy, fw, fh) => {
    const [xa, ya] = px(fx, fy);
    const [xb, yb] = px(fx + fw, fy + fh);
    ctx.beginPath();
    ctx.roundRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya), radius);
    ctx.stroke();
  };

  line(L.gutter.x, L.gutter.y0, L.gutter.x, L.gutter.y1);
  box(L.title.x, L.title.y, L.title.w, L.title.h);
  for (const rule of L.rules) line(L.centreX - rule.w / 2, rule.y, L.centreX + rule.w / 2, rule.y);
  for (const b of L.wideBoxes) box(L.centreX - b.w / 2, b.y, b.w, b.h);
  for (const b of L.smallBoxes) box(b.x, b.y, b.w, b.h);
}

/* Clear-acrylic top pattern: (1) dot grid, pitch 18 px of the decal canvas (DECAL_SPEC
 * 2048x1582 - the 18 is canvas px, not CSS/screen px), then (2) the same PAPER_LAYOUT
 * doc-icon strokes on top. Light ink with alpha so the plate stays clear. Rev32: the
 * strokes are thicker (lineWidth 14, was 8) and less concentrated (alpha 0.52, was
 * 0.92) than the paper decal - only this acrylic pattern changes, the paper artwork
 * keeps PAPER_INK / lineWidth 8. */
export const ACRYLIC_PATTERN = Object.freeze({
  dotPitch: 18,
  dotRadius: 3,
  order: Object.freeze(['dots', 'layout']),
  lineWidth: ACRYLIC_PLATE.patternLineWidth,
  ink: ACRYLIC_PLATE.patternInk,
  inkSoft: ACRYLIC_PLATE.patternInkSoft,
});

export function acrylicArtworkSpecFor() {
  return {
    kind: 'acrylic-decal',
    variant: 0,
    width: DECAL_SPEC.width,
    height: DECAL_SPEC.height,
    seed: DECAL_SPEC.seedBase.paper + 4001,
    anisotropy: 16,
    dotPitch: ACRYLIC_PATTERN.dotPitch,
    dotRadius: ACRYLIC_PATTERN.dotRadius,
    dotInk: 'rgba(238, 246, 255, 0.7)',
    ink: ACRYLIC_PATTERN.ink,
    inkSoft: ACRYLIC_PATTERN.inkSoft,
    layout: 'doc-icon',
    order: ACRYLIC_PATTERN.order.slice(),
    elements: ['gutter', 'title', 'rule', 'rule', 'rule', 'wideBox', 'wideBox', 'smallBox', 'smallBox'],
    marginFrac: 0.05,
    lineWidth: ACRYLIC_PATTERN.lineWidth,
  };
}

export function drawAcrylicArtwork(ctx, spec) {
  ctx.clearRect(0, 0, spec.width, spec.height);
  // (1) dot grid (single path, one fill)
  const pitch = spec.dotPitch;
  ctx.fillStyle = spec.dotInk;
  ctx.beginPath();
  for (let y = pitch / 2; y < spec.height; y += pitch) {
    for (let x = pitch / 2; x < spec.width; x += pitch) {
      ctx.moveTo(x + spec.dotRadius, y);
      ctx.arc(x, y, spec.dotRadius, 0, TAU);
    }
  }
  ctx.fill();
  // (2) doc-icon layout over the dots
  drawPaperLayout(ctx, spec);
}
/* ------------------------------------------------------- surface paintings */

/* ------------------------------------------------------- surface paintings */

export function drawPaperSurface(ctx, spec) {
  const w = spec.width;
  const h = spec.height;
  const rand = createSeededRandom(spec.seed);
  ctx.clearRect(0, 0, w, h);
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, '#f4f3ef');
  gradient.addColorStop(0.48, '#ebeae6');
  gradient.addColorStop(1, '#dedcd8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  // Fine matte grain + faint fibres.
  for (let dot = 0; dot < 2600; dot += 1) {
    const alpha = 0.03 + rand() * 0.05;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255, 255, 255, ' + alpha + ')' : 'rgba(60, 58, 52, ' + alpha + ')';
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 1.6, 1 + rand() * 1.6);
  }
  ctx.strokeStyle = 'rgba(120, 116, 108, 0.06)';
  ctx.lineWidth = 0.8;
  for (let fibre = 0; fibre < 26; fibre += 1) {
    const y = rand() * h;
    ctx.beginPath();
    ctx.moveTo(rand() * w * 0.3, y);
    ctx.lineTo(w * (0.6 + rand() * 0.4), y + (rand() - 0.5) * 3);
    ctx.stroke();
  }
}

/**
 * Inner-glow emissive map: black in the middle, orange hugging all four
 * borders (linear gradients, each fading to 0 over ~22% of the size).
 */
export function drawGlowSurface(ctx, spec) {
  const w = spec.width;
  const h = spec.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  const reach = spec.reach;
  const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, 'rgba(255, 120, 30, 0.95)');
    gradient.addColorStop(0.45, 'rgba(255, 120, 30, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 120, 30, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, w * reach, 0, 0, 0, w * reach, h);
  edge(w, 0, w * (1 - reach), 0, w * (1 - reach), 0, w * reach, h);
  edge(0, 0, 0, h * reach, 0, 0, w, h * reach);
  edge(0, h, 0, h * (1 - reach), 0, h * (1 - reach), w, h * reach);
}

export function paperSurfaceSpecFor() {
  return { kind: 'paper-surface', width: TEXTURE_SPEC.paper.width, height: TEXTURE_SPEC.paper.height, seed: 4409 };
}

export function glowSurfaceSpecFor() {
  return { kind: 'glow-surface', width: TEXTURE_SPEC.glow.width, height: TEXTURE_SPEC.glow.height, seed: 5511, reach: 0.22 };
}

/* --------------------------------------------------------------- textures */

function paintCanvas(createCanvas, width, height, painter, userData, { srgb = false } = {}) {
  if (typeof createCanvas !== 'function') return null;
  const canvas = createCanvas();
  if (!canvas) return null;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  painter(ctx, { width, height });
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = (userData && userData.name) || 'billing-canvas';
  texture.anisotropy = (userData && userData.anisotropy) || 4;
  texture.needsUpdate = true;
  if (srgb) {
    if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
    else texture.encoding = THREE.sRGBEncoding;
  }
  if (userData) texture.userData = userData;
  return texture;
}

export function createPaperSurfaceTexture({ createCanvas } = {}) {
  const spec = paperSurfaceSpecFor();
  return paintCanvas(createCanvas, spec.width, spec.height, (ctx) => drawPaperSurface(ctx, spec), {
    role: 'paper-surface',
    name: 'billing-paper-surface',
    ...spec,
  }, { srgb: true });
}

export function createGlowSurfaceTexture({ createCanvas } = {}) {
  const spec = glowSurfaceSpecFor();
  return paintCanvas(createCanvas, spec.width, spec.height, (ctx) => drawGlowSurface(ctx, spec), {
    role: 'glow-surface',
    name: 'billing-glow-surface',
    ...spec,
  }, { srgb: true });
}

/** Paper decal (the glow variant reuses it). */
function createDecalTexture(kind, index, createCanvas) {
  const spec = paperArtworkSpecFor(index);
  return paintCanvas(createCanvas, spec.width, spec.height, (ctx) => drawPaperArtwork(ctx, spec), {
    role: 'decal',
    kind: spec.kind,
    name: 'billing-' + spec.kind + '-' + (spec.variant || 0),
    seed: spec.seed,
    noReadableText: true,
    ...spec,
  }, { srgb: true });
}

/** Acrylic dot-grid + doc-icon pattern (alpha-carrying, shared by the acrylic plates). */
function createAcrylicDecalTexture(createCanvas) {
  const spec = acrylicArtworkSpecFor();
  return paintCanvas(createCanvas, spec.width, spec.height, (ctx) => drawAcrylicArtwork(ctx, spec), {
    role: 'acrylic-decal',
    name: 'billing-' + spec.kind,
    noReadableText: true,
    ...spec,
  }, { srgb: true });
}

/* --------------------------------------------------------------- geometry */

function roundedRectShape(length, width, radius) {
  const w = length / 2;
  const h = width / 2;
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

/**
 * Flat sheet: rounded-rect extrusion laid horizontal. The extrusion groups are
 * preserved so material[0] paints the two flat caps and material[1] the rim.
 * `kind` selects the thickness / bevel ('paper' sheet or 'acrylic' plate).
 * `spec.thickness[kind]` is the FINISHED slab thickness (bevel included), and the
 * finished slab is centred on the local plane y = 0.
 */
export function buildFlatSheetGeometry(kind, spec = SHEET_SPEC) {
  const thickness = spec.thickness[kind];
  const bevel = spec.bevel[kind];
  // ExtrudeGeometry adds bevelThickness at BOTH ends, so the extrusion depth is
  // the finished thickness minus the two bevels.
  const depth = Math.max(1e-4, thickness - 2 * bevel);
  const shape = roundedRectShape(spec.length, spec.width, spec.cornerRadius);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 10,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: bevel > 0 ? 3 : 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.translate(0, -(box.min.y + box.max.y) / 2, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** Ripple of the paper wave (added to the drape). The ripple fades toward the long edges. */
export function paperWaveOffset(u, v, wave = PAPER_WAVE) {
  const uc = clamp(u, -1, 1);
  const vc = clamp(v, -1, 1);
  const across = 0.65 + 0.35 * Math.cos(vc * Math.PI * 0.5);
  return wave.amplitude * Math.sin(uc * Math.PI * wave.cycles + wave.phase) * across;
}

/**
 * Wavy paper surface: (gridU + 1) x (gridV + 1) vertex grid in the local XZ
 * plane with the paper drape + ripple applied to Y.
 */
export function buildDrapedSheetGeometry(amplitude, spec = SHEET_SPEC) {
  const cols = spec.gridU;
  const rows = spec.gridV;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= rows; row += 1) {
    const v = (row / rows) * 2 - 1;
    for (let col = 0; col <= cols; col += 1) {
      const u = (col / cols) * 2 - 1;
      const x = (u * spec.length) / 2;
      const z = (v * spec.width) / 2;
      const y = paperDrapeOffset(u, v, amplitude) + paperWaveOffset(u, v);
      positions.push(x, y, z);
      uvs.push(col / cols, row / rows);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = row * (cols + 1) + col;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------- model */

/**
 * Reusable sheet builder. Owns the shared textures / materials of the two model
 * classes (paper incl. the glow variant, acrylic clear plate) and builds ONE
 * sheet of a kind on demand. createBillingModel (the 7-layer stack) and
 * createSheetShowcase (the models side by side) both use it, so the sheets are
 * identical.
 *
 * @param {{createCanvas?: () => any}} [options]
 */
export function createSheetKit(options = {}) {
  const createCanvas = typeof options.createCanvas === 'function' ? options.createCanvas : null;
  /* ---------------------------------------------------------- textures */
  const textures = [];
  const paperSurface = createPaperSurfaceTexture({ createCanvas });
  const glowSurface = createGlowSurfaceTexture({ createCanvas });
  for (const texture of [paperSurface, glowSurface]) if (texture) textures.push(texture);

  const acrylicTextures = [];
  let acrylicDecalTexture = null;
  const acrylicDecalFor = () => {
    if (!acrylicDecalTexture) {
      acrylicDecalTexture = createAcrylicDecalTexture(createCanvas);
      if (acrylicDecalTexture) acrylicTextures.push(acrylicDecalTexture);
    }
    return acrylicDecalTexture;
  };

  const decalTextures = [];
  const decalFor = (kind, index) => {
    const texture = createDecalTexture(kind, index, createCanvas);
    if (texture) decalTextures.push(texture);
    return texture;
  };

  /* --------------------------------------------------------- materials */
  const paperMaterial = new THREE.MeshStandardMaterial({
    name: 'billing-paper',
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.8,
    side: THREE.DoubleSide,
  });
  if (paperSurface) paperMaterial.map = paperSurface;

  // Glow paper: the same white paper plus an orange INNER GLOW. The emissive map
  // is bright at the border and fades to black toward the middle (material
  // emission, not a light object).
  const glowMaterial = new THREE.MeshStandardMaterial({
    name: 'billing-paper-glow',
    color: 0xffffff,
    roughness: 0.84,
    metalness: 0,
    envMapIntensity: 0.8,
    emissive: 0xff7a1c,
    emissiveIntensity: 1.5,
    side: THREE.DoubleSide,
  });
  if (paperSurface) glowMaterial.map = paperSurface;
  if (glowSurface) glowMaterial.emissiveMap = glowSurface;

  // Rev32 clear acrylic plate: one thick transparent slab per sheet, no board and
  // no embossed glyph layer any more. The plate carries the dot grid + doc-icon
  // pattern as a separate alpha decal on its top face, so it stays clear.
  const acrylicMaterial = new THREE.MeshPhysicalMaterial({
    name: 'billing-acrylic',
    color: 0xe4eeff,
    metalness: 0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    ior: 1.49,
    envMapIntensity: 1.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const acrylicEdgeMaterial = new THREE.MeshBasicMaterial({
    name: 'billing-acrylic-edge',
    color: 0xc3ccf2,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const decalMaterial = (texture) => new THREE.MeshBasicMaterial({
    name: 'billing-decal',
    map: texture || null,
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const geometries = [];
  const decalMaterials = [];

  /** Build one sheet group of `kind` ('paper'|'glow'|'acrylic'); `index` seeds decal + paper drape. */
  function buildSheet(kind, index) {
    const group = new THREE.Group();
    group.name = 'billing-sheet-' + index + '-' + kind;
    let geometry;
    let mesh;
    const decalMeshes = [];
    let acrylic = null;
    let acrylicPattern = null;

    if (kind === 'paper' || kind === 'glow') {
      geometry = buildDrapedSheetGeometry(sheetCurvature(index), SHEET_SPEC);
      geometries.push(geometry);
      mesh = new THREE.Mesh(geometry, kind === 'glow' ? glowMaterial : paperMaterial);
      mesh.name = 'billing-' + kind + '-surface-' + index;
      group.add(mesh);
      const decalTexture = decalFor('paper', index);
      if (decalTexture) {
        const material = decalMaterial(decalTexture);
        decalMaterials.push(material);
        const decal = new THREE.Mesh(geometry, material);
        decal.name = 'billing-' + kind + '-decal-' + index;
        decal.position.y = 0.004;
        decal.renderOrder = 2;
        group.add(decal);
        decalMeshes.push(decal);
      }
    } else {
      // ACRYLIC (Rev32): ONE clear plate - no circuit board, no embossed glyphs.
      // The plate is a thick transparent slab, flat (curvature 0), top face at
      // ACRYLIC_PLATE.topY above the sheet plane and underside at
      // ACRYLIC_PLATE.bottomY (thickened inward, the retired board volume filled).
      geometry = buildFlatSheetGeometry('acrylic', SHEET_SPEC);
      geometries.push(geometry);
      acrylic = new THREE.Mesh(geometry, [acrylicMaterial, acrylicEdgeMaterial]);
      acrylic.name = 'billing-acrylic-plate-' + index;
      acrylic.position.y = ACRYLIC_PLATE.topY - SHEET_SPEC.thickness.acrylic / 2;
      acrylic.renderOrder = 4;
      acrylic.userData = {
        role: 'clear acrylic plate (thick, pattern + dot grid on top)',
        topY: ACRYLIC_PLATE.topY,
        bottomY: ACRYLIC_PLATE.bottomY,
      };
      group.add(acrylic);
      mesh = acrylic;

      // Pattern layer: a thin alpha-carrying plane just above the plate's top face
      // (dot grid first, doc-icon layout over it - both baked in order on one canvas).
      const patternTexture = acrylicDecalFor();
      if (patternTexture) {
        const patternGeometry = new THREE.PlaneGeometry(SHEET_SPEC.length, SHEET_SPEC.width);
        patternGeometry.rotateX(Math.PI / 2); // same u->x, v->z mapping as the paper decal
        geometries.push(patternGeometry);
        const material = decalMaterial(patternTexture);
        material.name = 'billing-acrylic-pattern';
        decalMaterials.push(material);
        acrylicPattern = new THREE.Mesh(patternGeometry, material);
        acrylicPattern.name = 'billing-acrylic-pattern-' + index;
        acrylicPattern.position.y = ACRYLIC_PLATE.topY + 0.004;
        acrylicPattern.renderOrder = 5;
        acrylicPattern.userData = { role: 'acrylic dot-grid + doc-icon pattern', dotPitch: ACRYLIC_PATTERN.dotPitch };
        group.add(acrylicPattern);
      }
    }

    return {
      group,
      mesh,
      geometry,
      decals: decalMeshes,
      acrylic,
      acrylicPattern,
      material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
      rimMaterial: Array.isArray(mesh.material) ? mesh.material[1] : null,
    };
  }

  return {
    textures,
    decalTextures,
    acrylicTextures,
    decalMaterials,
    geometries,
    materials: {
      paper: paperMaterial,
      glow: glowMaterial,
      acrylic: acrylicMaterial,
      acrylicEdge: acrylicEdgeMaterial,
    },
    buildSheet,
  };
}

/** Showcase layout - the model variants side by side (acrylic, paper+glow, paper). */
export const SHOWCASE_SPEC = Object.freeze({
  kinds: Object.freeze(['acrylic', 'glow', 'paper']),
  // layer index per kind: seeds the decal + selects the paper drape amplitude
  indices: Object.freeze({ acrylic: 6, glow: 3, paper: 0 }),
  spacingFactor: 1.18, // centre spacing = sheet length x factor (no overlap)
  tiltDeg: Object.freeze({ x: 38, y: -10 }),
});

/**
 * The sheet models side by side, built with the same createSheetKit as the
 * 7-layer stack. Pure scene content: the page wraps it in a trackball so it
 * can be rotated freely.
 */
export function createSheetShowcase(options = {}) {
  const kit = createSheetKit(options);
  const root = new THREE.Group();
  root.name = 'billing-sheet-showcase';
  const pivot = new THREE.Group();
  pivot.name = 'billing-sheet-showcase-pivot';
  root.add(pivot);
  const pitch = SHEET_SPEC.length * SHOWCASE_SPEC.spacingFactor;
  const sheets = SHOWCASE_SPEC.kinds.map((kind, slot) => {
    const built = kit.buildSheet(kind, SHOWCASE_SPEC.indices[kind]);
    built.group.position.set((slot - 1) * pitch, 0, 0);
    pivot.add(built.group);
    return { kind, slot, group: built.group, mesh: built.mesh, geometry: built.geometry, decals: built.decals, acrylic: built.acrylic, acrylicPattern: built.acrylicPattern };
  });
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  let disposed = false;
  return {
    root,
    pivot,
    sheets,
    kinds: SHOWCASE_SPEC.kinds.slice(),
    pitch,
    bounds,
    materials: kit.materials,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of kit.textures.concat(kit.decalTextures, kit.acrylicTextures)) if (texture && texture.dispose) texture.dispose();
      for (const material of [...Object.values(kit.materials), ...kit.decalMaterials]) if (material && material.dispose) material.dispose();
      for (const geometry of new Set(kit.geometries)) if (geometry && geometry.dispose) geometry.dispose();
      while (pivot.children.length) pivot.remove(pivot.children[0]);
    },
  };
}

/**
 * Build the whole billing layer stack.
 *
 * @param {{createCanvas?: () => any}} [options]
 */
export function createBillingModel(options = {}) {
  const createCanvas = typeof options.createCanvas === 'function' ? options.createCanvas : null;
  const root = new THREE.Group();
  root.name = 'billing-layers-root';

  const kit = createSheetKit({ createCanvas });
  const { textures, decalTextures, acrylicTextures, decalMaterials, geometries } = kit;

  /* ---------------------------------------------------------- platform */
  // The satin column is mounted by attachColumnPlatform(bank). Until then the
  // platform group is an empty placeholder at the final position; the camera
  // fit uses the analytic top-face window below, so attaching never moves it.
  const support = new THREE.Group();
  support.name = 'billing-support-column';
  support.position.set(SUPPORT_SPEC.centerX, 0, SUPPORT_SPEC.centerZ);
  support.userData = { role: 'support', kind: 'satin-column', columnId: SUPPORT_SPEC.columnId };
  root.add(support);

  /* ------------------------------------------------------------ sheets */
  const sheets = [];
  // kit.geometries is filled as the sheets are built; share the same array.
  const materials = { ...kit.materials };

  for (let index = 0; index < SHEET_COUNT; index += 1) {
    const kind = SHEET_KINDS[index];
    const built = kit.buildSheet(kind, index);
    const { group, mesh, geometry } = built;
    const decalMeshes = built.decals;
    const pose = sheetPose(index);
    group.position.set(pose.position.x, pose.position.y, pose.position.z);
    group.rotation.y = degToRad(pose.rotationDeg.y);

    root.add(group);
    sheets.push({
      index,
      kind,
      sheetClass: SHEET_CLASS[kind],
      group,
      mesh,
      geometry,
      decal: decalMeshes[0] || null,
      decals: decalMeshes,
      acrylic: built.acrylic,
      acrylicPattern: built.acrylicPattern,
      material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
      rimMaterial: Array.isArray(mesh.material) ? mesh.material[1] : null,
      curvature: sheetCurvature(index),
      planeY: sheetY(index),
      yawDeg: sheetYawDeg(index),
      thickness: SHEET_SPEC.thickness[kind],
    });
  }

  /* ------------------------------------------------------------ fit data */
  applyStaticPose({ sheets }, 'final');
  root.updateMatrixWorld(true);
  const fitPointsArray = [];
  const world = new THREE.Vector3();
  for (const sheet of sheets) {
    sheet.group.updateMatrixWorld(true);
    const position = sheet.geometry.getAttribute('position');
    const stride = Math.max(1, Math.floor(position.count / 240));
    for (let vertex = 0; vertex < position.count; vertex += stride) {
      world.fromBufferAttribute(position, vertex).applyMatrix4(sheet.group.matrixWorld);
      fitPointsArray.push(world.x, world.y, world.z);
    }
    const box = sheet.geometry.boundingBox;
    if (box) {
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            world.set(x, y, z).applyMatrix4(sheet.group.matrixWorld);
            fitPointsArray.push(world.x, world.y, world.z);
          }
        }
      }
    }
  }
  // The column is fitted only over a window of its top face and down to its
  // crop line (the rest of the long body runs off-frame).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      fitPointsArray.push(SUPPORT_SPEC.centerX + sx * SUPPORT_SPEC.fitHalfX, SUPPORT_SPEC.cropY, SUPPORT_SPEC.centerZ + sz * SUPPORT_SPEC.fitHalfZ);
      fitPointsArray.push(SUPPORT_SPEC.centerX + sx * SUPPORT_SPEC.fitHalfX, SUPPORT_SPEC.topY, SUPPORT_SPEC.centerZ + sz * SUPPORT_SPEC.fitHalfZ);
    }
  }
  const fitPoints = Float32Array.from(fitPointsArray);

  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let index = 0; index < fitPoints.length; index += 3) {
    point.set(fitPoints[index], fitPoints[index + 1], fitPoints[index + 2]);
    bounds.expandByPoint(point);
  }

  const textureSet = new Set(textures.concat(decalTextures, acrylicTextures));
  const materialSet = new Set([...Object.values(kit.materials), ...decalMaterials]);
  const geometrySet = new Set(geometries);

  const supportInfo = {
    kind: 'satin-column',
    source: SUPPORT_SPEC.source,
    columnId: SUPPORT_SPEC.columnId,
    materialId: SUPPORT_SPEC.materialId,
    attached: false,
    materialName: null,
    scale: SUPPORT_SPEC.scale,
    laidHorizontal: true,
    length: SUPPORT_SPEC.lengthPx * SUPPORT_SPEC.scale,
    width: SUPPORT_SPEC.crossSectionPx * SUPPORT_SPEC.scale,
    depth: SUPPORT_SPEC.crossSectionPx * SUPPORT_SPEC.scale,
    height: SUPPORT_SPEC.crossSectionPx * SUPPORT_SPEC.scale,
    topY: SUPPORT_SPEC.topY,
    cropY: SUPPORT_SPEC.cropY,
    center: { x: SUPPORT_SPEC.centerX, z: SUPPORT_SPEC.centerZ },
    materialNames: [],
    cropped: false,
  };

  let columns = null;
  let disposed = false;
  const model = {
    version: MODEL_VERSION,
    sheetCount: SHEET_COUNT,
    kinds: SHEET_KINDS.slice(),
    root,
    sheets,
    support,
    supportInfo,
    /**
     * Mount the WHOLE satin column (`satin-large-long`, uncropped, uncut) from
     * the columns bank (loadColumnBank() result) as the platform. The bank's
     * satin material object is reused verbatim; the caller owns/disposes the bank.
     */
    attachColumnPlatform(bank) {
      if (model.platform) return model.platform;
      if (!bank || !bank.materials || !bank.materials.satin) {
        throw new Error('attachColumnPlatform requires the columns bank from loadColumnBank() (materials.satin missing)');
      }
      columns = createColumns(bank, { quality: 'hero', patternDivisor: COLUMN_GEOMETRY_RATIO });
      const column = columns.columnsById[SUPPORT_SPEC.columnId];
      if (!column) throw new Error('the columns bank has no "' + SUPPORT_SPEC.columnId + '" column');
      const mesh = new THREE.Mesh(column.mesh.geometry, bank.materials.satin);
      mesh.name = 'billing-support-satin-column';
      // local +Y (600 px length) -> world +X; local +X (140 px) -> world -Y.
      mesh.rotation.z = -Math.PI / 2;
      // s53: columns geometry is COLUMN_GEOMETRY_RATIO x larger; shrink it so the on-screen look is unchanged.
      mesh.scale.setScalar(SUPPORT_SPEC.scale / COLUMN_GEOMETRY_RATIO);
      mesh.position.set(0, SUPPORT_SPEC.topY - (SUPPORT_SPEC.crossSectionPx / 2) * SUPPORT_SPEC.scale, 0);
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      mesh.userData = {
        role: 'satin column platform (' + SUPPORT_SPEC.columnId + ' laid horizontal, whole model)',
        columnId: SUPPORT_SPEC.columnId,
        laidHorizontal: true,
        scale: SUPPORT_SPEC.scale,
      };
      support.add(mesh);
      root.updateMatrixWorld(true);
      supportInfo.attached = true;
      supportInfo.materialName = bank.materials.satin.name || 'satin';
      supportInfo.materialNames = [supportInfo.materialName];
      model.platform = { columnId: SUPPORT_SPEC.columnId, mesh, material: bank.materials.satin, geometry: column.mesh.geometry, columns };
      return model.platform;
    },
    platform: null,
    materials,
    textures,
    decalTextures,
    acrylicTextures,
    geometries,
    fitPoints,
    fitCropY: SUPPORT_SPEC.cropY,
    bounds,
    pose: 'final',
    elapsedMs: 0,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of textureSet) if (texture && texture.dispose) texture.dispose();
      for (const material of materialSet) if (material && material.dispose) material.dispose();
      for (const geometry of geometrySet) if (geometry && geometry.dispose) geometry.dispose();
      if (columns) {
        try { columns.dispose(); } catch (error) { /* best effort */ }
        columns = null;
      }
      while (support.children.length) support.remove(support.children[0]);
      while (root.children.length) root.remove(root.children[0]);
      textureSet.clear();
      materialSet.clear();
      geometrySet.clear();
    },
  };
  return model;
}

export default createBillingModel;
