/**
 * tekoanimation — Logo blocks preview controller.
 *
 * Standalone collection page controller for `logo-blocks.html`
 * (docs/logo-blocks-contract.md): one stage, two compositions —
 *
 *   scene `stack`  figure 4: four stacked silver rounded-square blocks with
 *                  silver/graphite machined TEKO emblems and brand-gold accent
 *                  bands, on a dark polished slab in a navy editorial studio;
 *   scene `bank`   figure 5: a fluted/dotted bank-icon plaque and a logo plaque
 *                  standing on a light concrete slab in a dark cool-grey studio.
 *
 * Both compositions are built synchronously by `src/logo-blocks-model.js` from
 * the local `assets/logo-blocks/teko2_icon.svg` (fetched here, same-origin only).
 * This module owns the two deterministic studios (procedural PMREM environments,
 * lights, backdrop, floor slab and authored contact shadows), the per-scene
 * fixed three-quarter camera fitted in closed form from each scene's
 * `fitPoints`, the clamped damped orbit, the scene toggle, the URL flags, the
 * loading curtain, the no-WebGL/error fallback and the QA API
 * `window.__tekoLogoBlocks`.
 *
 * Camera/stage contract: stack 24°/13° fitted to 88 % of the stage (84 % narrow),
 * bank 18°/9° fitted to 82 % (78 % narrow), fov 30°. There is deliberately no
 * autonomous motion — the only movement is the user's clamped orbit — so
 * `?still=1` / `?shot=1` and reduced motion are deterministic by construction.
 */
import * as THREE from 'three';
import * as LogoBlocksModel from './logo-blocks-model.js';

const VERSION = '1.0.0';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

const MODEL = LogoBlocksModel;

/* --------------------------------------------------------------- constants */

const SCENE_IDS = Object.freeze(['stack', 'bank']);

const LOGO_RELATIVE = './assets/logo-blocks/teko2_icon.svg';
const LOGO_URL = new URL('../assets/logo-blocks/teko2_icon.svg', import.meta.url);
const MODEL_MODULE = './src/logo-blocks-model.js';
const THREE_MODULE = './vendor/three.module.js';

const RENDERER = Object.freeze({ exposure: 1.0, dprMax: 2 });

/** Framing (contract L2): fill fraction of the stage per composition. */
const FRAMING = Object.freeze({
  stack: Object.freeze({ fill: 0.88, fillNarrow: 0.84 }),
  bank: Object.freeze({ fill: 0.82, fillNarrow: 0.78 }),
});

const NARROW_STAGE_WIDTH = 520;
const ORBIT = Object.freeze({ damping: 16, dragSensitivity: 0.18, nudgeDeg: 3 });

/** Default three-quarter poses + pitch clamps (contract L2). */
const DEFAULT_CAMERA = Object.freeze({
  stack: Object.freeze({ azimuthDeg: 24, elevationDeg: 13, pitchMaxDeg: 30 }),
  bank: Object.freeze({ azimuthDeg: 18, elevationDeg: 9, pitchMaxDeg: 26 }),
});
const YAW_HALF_RANGE_DEG = 16;
const PITCH_MIN_DEG = -4;

const TAU = Math.PI * 2;

/* -------------------------------------------------------------------- math */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
const degToRad = (deg) => (deg * Math.PI) / 180;
const radToDeg = (rad) => (rad * 180) / Math.PI;
const round = (value, digits = 2) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function finiteOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function srgbChannelToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Authored sRGB hex -> linear working colour (ColorManagement is legacy here). */
function workingColorFromHex(hex) {
  const color = new THREE.Color();
  color.setRGB(
    srgbChannelToLinear(((hex >> 16) & 255) / 255),
    srgbChannelToLinear(((hex >> 8) & 255) / 255),
    srgbChannelToLinear((hex & 255) / 255),
  );
  return color;
}

function hexString(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0');
}

function mixWorkingColors(a, b, t, out) {
  out.setRGB(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t));
  return out;
}

function errorMessage(error) {
  if (!error) return 'Unknown error';
  const message = error && error.message ? String(error.message) : String(error);
  return message.length > 240 ? message.slice(0, 237) + '...' : message;
}

const nextFrame = () =>
  new Promise((resolve) => {
    if (IS_BROWSER && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
    } else {
      resolve();
    }
  });

/* ------------------------------------------------------------------ camera */

function viewDirection(azimuthDeg, elevationDeg) {
  const azimuth = degToRad(azimuthDeg);
  const elevation = degToRad(elevationDeg);
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ).normalize();
}

function cameraBasis(azimuthDeg, elevationDeg) {
  const azimuth = degToRad(azimuthDeg);
  const elevation = degToRad(elevationDeg);
  return {
    direction: viewDirection(azimuthDeg, elevationDeg),
    right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)),
    up: new THREE.Vector3(
      -Math.sin(azimuth) * Math.sin(elevation),
      Math.cos(elevation),
      -Math.cos(azimuth) * Math.sin(elevation),
    ),
  };
}

/**
 * Resolve one scene's camera parameters. The contract (L2) fixes the default
 * leg of the orbit, the pitch range and the fill; the model supplies fov /
 * near / far / default pose through `CAMERA_SPEC[key]`. When the model also
 * states the clamps and framing (it does), those values are used after a sanity
 * check; otherwise the contract values below are used verbatim.
 */
function sceneCameraSpec(key) {
  const rawAll = MODEL.CAMERA_SPEC;
  const raw = rawAll && typeof rawAll[key] === 'object' && rawAll[key] ? rawAll[key] : {};
  const fallback = DEFAULT_CAMERA[key];
  const near = Math.max(0.01, finiteOr(raw.near, 0.05));
  const far = Math.max(near * 20, finiteOr(raw.far, 40));
  const azimuthDeg = finiteOr(raw.azimuthDeg, fallback.azimuthDeg);
  const elevationDeg = finiteOr(raw.elevationDeg, fallback.elevationDeg);

  let yawMinDeg = azimuthDeg - YAW_HALF_RANGE_DEG;
  let yawMaxDeg = azimuthDeg + YAW_HALF_RANGE_DEG;
  if (Number.isFinite(raw.yawMinDeg) && Number.isFinite(raw.yawMaxDeg) && raw.yawMinDeg < raw.yawMaxDeg &&
      raw.yawMaxDeg - raw.yawMinDeg <= 120 && azimuthDeg >= raw.yawMinDeg && azimuthDeg <= raw.yawMaxDeg) {
    yawMinDeg = raw.yawMinDeg;
    yawMaxDeg = raw.yawMaxDeg;
  }

  let pitchMinDeg = PITCH_MIN_DEG;
  let pitchMaxDeg = fallback.pitchMaxDeg;
  if (Number.isFinite(raw.pitchMinDeg) && Number.isFinite(raw.pitchMaxDeg) && raw.pitchMinDeg < raw.pitchMaxDeg &&
      pitchMaxDeg - pitchMinDeg <= 60 && elevationDeg >= raw.pitchMinDeg && elevationDeg <= raw.pitchMaxDeg) {
    pitchMinDeg = raw.pitchMinDeg;
    pitchMaxDeg = raw.pitchMaxDeg;
  }

  const fill = clamp(finiteOr(raw.fitMargin, FRAMING[key].fill), 0.3, 0.98);
  const fillNarrow = clamp(finiteOr(raw.fitMarginNarrow, FRAMING[key].fillNarrow), 0.3, 0.98);
  return Object.freeze({
    key,
    fov: finiteOr(raw.fov, 30),
    near,
    far,
    azimuthDeg,
    elevationDeg,
    dragSensitivity: Math.max(0.01, finiteOr(raw.dragSensitivity, ORBIT.dragSensitivity)),
    targetYOffset: finiteOr(raw.targetYOffset, 0),
    yawMinDeg,
    yawMaxDeg,
    pitchMinDeg,
    pitchMaxDeg,
    fill,
    fillNarrow,
    narrowStageWidth: Math.max(240, finiteOr(raw.narrowStageWidth, NARROW_STAGE_WIDTH)),
  });
}

/* ----------------------------------------------------------- scene copy/UI */

const STACK_GLYPH =
  '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="28" y="6" width="24" height="24" rx="6" opacity="0.3"></rect>' +
  '<rect x="22" y="12" width="24" height="24" rx="6" opacity="0.55"></rect>' +
  '<rect x="11" y="23" width="37" height="37" rx="9"></rect>' +
  '<path d="M29.5 47V33"></path><path d="M24 38.5 29.5 33 35 38.5"></path>' +
  '</svg>';

const BANK_GLYPH =
  '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M9 26 32 12l23 14"></path>' +
  '<path d="M15 26v19M24 26v19M33 26v19M42 26v19M51 26v19"></path>' +
  '<path d="M15 45h38"></path><path d="M11 51h46"></path><path d="M8 57h48"></path>' +
  '</svg>';

const STACK_LAYERS = Object.freeze([
  Object.freeze({ name: 'Block', color: 0x8a8f96, candidates: ['stackFace', 'face', 'stackBody'], swatch: 'block' }),
  Object.freeze({ name: 'Wall', color: 0x2c2f34, candidates: ['stackBody', 'body'], swatch: 'wall' }),
  Object.freeze({ name: 'Rim', color: 0xd6dbe1, candidates: ['stackRim', 'rim'], swatch: 'rim' }),
  Object.freeze({ name: 'Face', color: 0x8a8f96, candidates: ['stackFace', 'face'], swatch: 'face' }),
  Object.freeze({ name: 'Emblem silver', color: 0xd6dbe1, candidates: ['emblemSilver'], swatch: 'silver' }),
  Object.freeze({ name: 'Emblem graphite', color: 0x6a7078, candidates: ['emblemGraphite'], swatch: 'graphite' }),
  Object.freeze({ name: 'Gold band', color: 0xffd60a, candidates: ['goldBright', 'goldEdge'], swatch: 'gold', gold: true }),
  Object.freeze({ name: 'Surface', color: 0x23262b, candidates: ['stackFloor', 'floor'], swatch: 'surface' }),
]);

const BANK_LAYERS = Object.freeze([
  Object.freeze({ name: 'Plaque', color: 0xcfd3d9, candidates: ['bankFace', 'face', 'bankBody'], swatch: 'block' }),
  Object.freeze({ name: 'Wall', color: 0xb9bec6, candidates: ['bankBody', 'body'], swatch: 'wall' }),
  Object.freeze({ name: 'Rim', color: 0xeef2f6, candidates: ['bankRim', 'rim'], swatch: 'rim' }),
  Object.freeze({ name: 'Gold ring', color: 0xffd60a, candidates: ['goldEdge', 'goldBright'], swatch: 'gold', gold: true }),
  Object.freeze({ name: 'Fluted panel', color: 0xb7bcc4, candidates: [], swatch: 'surface' }),
  Object.freeze({ name: 'Bank icon', color: 0xe6eaee, candidates: ['bankRim', 'emblemSilver'], swatch: 'silver' }),
  Object.freeze({ name: 'Emblem graphite', color: 0x6a7078, candidates: ['emblemGraphite'], swatch: 'graphite' }),
  Object.freeze({ name: 'Concrete', color: 0xd9d9d7, candidates: ['concrete', 'surface'], swatch: 'surface' }),
]);

const SCENE_META = Object.freeze({
  stack: Object.freeze({
    id: 'stack',
    stage: Object.freeze({
      eyebrow: 'Composition 01 \u00b7 stacked blocks',
      code: 'STK',
      name: 'Four-block stack',
      detail: 'Silver relief \u00b7 gold edge bands',
      index: '01',
      total: '02',
    }),
    info: Object.freeze({
      name: 'Stacked Logo Blocks',
      region: 'Four silver blocks \u00b7 brand-gold edge accents',
      index: 'Stack / 01',
      glyph: STACK_GLYPH,
    }),
    sceneLabel: 'Stack \u00b7 fig 4',
    blocksLabel: '4 blocks \u00b7 1.500 square',
    surfaceLabel: 'Dark polished slab',
    accentLabel: 'Brand-gold accent bands',
    thicknessFallback: 0.3,
    layers: STACK_LAYERS,
    tags: Object.freeze([
      Object.freeze({ label: 'teko2_icon.svg' }),
      Object.freeze({ label: '3 contours', metal: true }),
      Object.freeze({ label: 'silver + graphite' }),
      Object.freeze({ label: 'gold edge bands', gold: true }),
      Object.freeze({ label: 'seeded studio' }),
    ]),
    note: 'Logo copied byte-identically from <span class="mono">K:\\HFWorkspace\\icons</span> \u00b7 SVG parsed at runtime \u00b7 brand gold only on the edge accents \u00b7 no network',
    footState: 'Stack \u00b7 brand-gold edges',
    footerState: 'Stack ready',
  }),
  bank: Object.freeze({
    id: 'bank',
    stage: Object.freeze({
      eyebrow: 'Composition 02 \u00b7 bank icon',
      code: 'BNK',
      name: 'Bank icon + logo',
      detail: 'Machined relief \u00b7 gold face ring',
      index: '02',
      total: '02',
    }),
    info: Object.freeze({
      name: 'Bank Icon Blocks',
      region: 'Two silver plaques \u00b7 machined emblem + bank icon',
      index: 'Bank / 02',
      glyph: BANK_GLYPH,
    }),
    sceneLabel: 'Bank \u00b7 fig 5',
    blocksLabel: '2 plaques \u00b7 1.450 square',
    surfaceLabel: 'Procedural concrete',
    accentLabel: 'Brand-gold face ring',
    thicknessFallback: 0.2,
    layers: BANK_LAYERS,
    tags: Object.freeze([
      Object.freeze({ label: 'teko2_icon.svg' }),
      Object.freeze({ label: '3 contours', metal: true }),
      Object.freeze({ label: 'bank icon relief' }),
      Object.freeze({ label: 'gold face ring', gold: true }),
      Object.freeze({ label: 'concrete 1024\u00b2' }),
    ]),
    note: 'Logo copied byte-identically from <span class="mono">K:\\HFWorkspace\\icons</span> \u00b7 SVG parsed at runtime \u00b7 seeded flutes, dots and concrete \u00b7 no network',
    footState: 'Bank \u00b7 machined icon',
    footerState: 'Bank ready',
  }),
});

/* ----------------------------------------------------------- studio specs */

/**
 * Per-composition studio definition. Colours are authored sRGB hex; the
 * environment values are LINEAR radiance (panels may exceed 1.0). Nothing is
 * baked into a map: every tonal difference comes from albedo + lights + PMREM.
 */
const STUDIO = Object.freeze({
  stack: Object.freeze({
    backdrop: Object.freeze({
      top: 0x060a14,
      subject: 0x15203a,
      horizon: 0x0f1830,
      bottom: 0x04060c,
      stops: Object.freeze([0.0, 0.5]),
      leftLift: 0.05,
      rightTint: 0.05,
    }),
    wall: Object.freeze({
      zOffset: -0.06,
      width: 16,
      height: 22,
      bottom: 0x0a0c12,
      top: 0x05070f,
      glow: 0x26385f,
      glowOpacity: 0.42,
      glowY: 0.34,
      ao: 0.55,
    }),
    environment: Object.freeze({
      sigma: 0.03,
      dome: Object.freeze({ radius: 12, sky: 0.06, horizon: 0.03, floor: 0.005, frontBoost: 0.02, horizonGlow: 0.015, warmTint: 0.01, coolTint: 0.03 }),
      panels: Object.freeze([
        Object.freeze({ position: [-1.7, 0.35, 6.0], lookAt: [0, 0.9, 0], size: [6.6, 3.2], color: [1.0, 0.99, 0.97], intensity: 2.6 }),
        Object.freeze({ position: [1.2, 3.0, 5.6], lookAt: [0, 0.8, 0], size: [6.0, 3.6], color: [1.0, 0.99, 0.97], intensity: 1.1 }),
        Object.freeze({ position: [-3.8, 4.2, 3.4], lookAt: [0, 0.6, 0], size: [3.2, 2.4], color: [1.0, 0.96, 0.9], intensity: 2.2 }),
        Object.freeze({ position: [0.2, 5.4, 1.2], lookAt: [0, 0.4, 0], size: [3.4, 1.6], color: [1.0, 1.0, 1.0], intensity: 1.6 }),
        Object.freeze({ position: [3.9, 2.2, 1.8], lookAt: [0, 0.4, 0], size: [2.2, 3.2], color: [0.82, 0.9, 1.0], intensity: 0.8 }),
        Object.freeze({ position: [2.0, 2.4, -4.6], lookAt: [0, 0.4, 0], size: [2.4, 1.8], color: [1.0, 0.82, 0.55], intensity: 0.7 }),
      ]),
    }),
    lights: Object.freeze({
      key: Object.freeze({ color: 0xfff2e2, intensity: 0.15, position: [-3.6, 4.8, 4.2], target: [0, 0.2, 0] }),
      fill: Object.freeze({ color: 0xd6e2f5, intensity: 0.1, position: [3.8, 1.7, 3.0], target: [0, 0.2, 0] }),
      rim: Object.freeze({ color: 0xffd9a8, intensity: 0.25, position: [1.2, 2.6, -4.4], target: [0, 0.3, 0] }),
    }),
    surface: Object.freeze({ color: 0x23262b, metalness: 0.35, roughness: 0.3, envMapIntensity: 0.9, thickness: 0.16 }),
    shadows: Object.freeze({ mode: 'group', widthScale: 1.65, depthScale: 1.5, opacity: 0.52, coreScale: 0.68, coreOpacity: 0.4, offsetX: 0.12, offsetZ: 0.1 }),
  }),
  bank: Object.freeze({
    backdrop: Object.freeze({
      top: 0x3b434d,
      subject: 0x2f363f,
      horizon: 0x2a3038,
      bottom: 0x171b20,
      stops: Object.freeze([0.0, 0.5]),
      leftLift: 0.16,
      rightTint: 0.02,
    }),
    wall: Object.freeze({
      zOffset: -0.1,
      width: 16,
      height: 22,
      bottom: 0x212730,
      top: 0x39414b,
      glow: 0x7c8b9e,
      glowOpacity: 0.26,
      glowY: 0.52,
      ao: 0.3,
    }),
    environment: Object.freeze({
      sigma: 0.03,
      dome: Object.freeze({ radius: 12, sky: 0.33, horizon: 0.22, floor: 0.05, frontBoost: 0.05, horizonGlow: 0.03, warmTint: 0.015, coolTint: 0.03 }),
      panels: Object.freeze([
        Object.freeze({ position: [-1.2, 0.5, 6.2], lookAt: [0, 1.0, 0], size: [6.0, 3.0], color: [1.0, 0.99, 0.97], intensity: 1.35 }),
        Object.freeze({ position: [-3.2, 4.4, 3.8], lookAt: [0, 0.8, 0], size: [4.0, 2.8], color: [1.0, 0.97, 0.92], intensity: 2.2 }),
        Object.freeze({ position: [0.2, 5.6, 1.2], lookAt: [0, 0.4, 0], size: [3.2, 2.0], color: [1.0, 1.0, 1.0], intensity: 1.3 }),
        Object.freeze({ position: [3.8, 2.4, 2.8], lookAt: [0, 0.6, 0], size: [2.2, 3.0], color: [0.88, 0.93, 1.0], intensity: 1.0 }),
        Object.freeze({ position: [0.4, 2.2, 5.4], lookAt: [0, 0.6, 0], size: [6.0, 3.2], color: [1.0, 0.99, 0.97], intensity: 0.45 }),
      ]),
    }),
    lights: Object.freeze({
      key: Object.freeze({ color: 0xfff6ea, intensity: 1.05, position: [-3.8, 4.6, 3.8], target: [0, 0.4, 0] }),
      fill: Object.freeze({ color: 0xdce8f6, intensity: 0.42, position: [4.2, 2.0, 2.4], target: [0, 0.4, 0] }),
      rim: Object.freeze({ color: 0xffffff, intensity: 0.35, position: [0.4, 3.2, -4.2], target: [0, 0.5, 0] }),
    }),
    surface: Object.freeze({ color: 0xd9d9d7, metalness: 0.0, roughness: 0.85, envMapIntensity: 0.6, thickness: 0.42 }),
    shadows: Object.freeze({ mode: 'blocks', widthScale: 1.55, depthScale: 1.35, opacity: 0.46, coreScale: 0.6, coreOpacity: 0.34, offsetX: 0.16, offsetZ: 0.12 }),
  }),
});

/* --------------------------------------------------------------- early qa */

const qa = IS_BROWSER
  ? (window.__TEKO_LOGO_BLOCKS_QA = window.__TEKO_LOGO_BLOCKS_QA || { errors: [], warnings: [], webgl: null })
  : { errors: [], warnings: [], webgl: null };
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];

function pushError(message) {
  qa.errors.push('logo-blocks-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}

function pushWarning(message) {
  qa.warnings.push('logo-blocks-preview: ' + message);
  if (qa.warnings.length > 60) qa.warnings.splice(0, qa.warnings.length - 60);
}

/* ------------------------------------------------------------------- state */

const urlParams = IS_BROWSER ? new URLSearchParams(window.location.search) : new URLSearchParams();

function parsePoseParam(raw) {
  if (!raw) return null;
  const parts = String(raw).split(',');
  if (parts.length < 2) return null;
  const azimuthDeg = Number(parts[0]);
  const elevationDeg = Number(parts[1]);
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(elevationDeg)) return null;
  return { azimuthDeg, elevationDeg };
}

let reducedMotionQuery = null;
if (IS_BROWSER && typeof window.matchMedia === 'function') {
  try {
    reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch (error) {
    reducedMotionQuery = null;
  }
}

const state = {
  ready: false,
  failed: false,
  booting: true,
  webgl: null,
  model: null,
  studio: null,
  scene: urlParams.get('scene') === 'bank' ? 'bank' : 'stack',
  still: urlParams.get('still') === '1',
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches),
  poseRequested: parsePoseParam(urlParams.get('pose')),
  logoBytes: 0,
  watchdog: 0,
  publishTimer: 0,
};

/** Static/deterministic modes snap the pose and never ease (no idle motion). */
function isStaticMode() {
  return state.still || state.shot || state.reducedMotion;
}

/* --------------------------------------------------------------------- dom */

const dom = {};

function initDom() {
  const byId = (id) => document.getElementById(id);
  dom.body = document.body;
  dom.stage = byId('stage');
  dom.canvas = byId('stage-canvas');
  dom.stageAura = byId('stage-aura');
  dom.stageEyebrowText = byId('stage-eyebrow-text');
  dom.stageIndex = byId('stage-index');
  dom.stageIndexTotal = byId('stage-index-total');
  dom.stageCaption = byId('stage-caption');
  dom.stageCode = byId('stage-code');
  dom.stageName = byId('stage-name');
  dom.stageDetail = byId('stage-detail');
  dom.stageHint = byId('stage-hint');
  dom.stageVeil = byId('stage-veil');
  dom.veilText = byId('veil-text');
  dom.sceneToggle = byId('scene-toggle');
  dom.btnReset = byId('btn-reset');
  dom.btnSceneStack = byId('btn-scene-stack');
  dom.btnSceneBank = byId('btn-scene-bank');
  dom.poseState = byId('pose-state');
  dom.infoName = byId('info-name');
  dom.infoRegion = byId('info-region');
  dom.infoGlyph = byId('info-glyph');
  dom.infoIndex = byId('info-index');
  dom.specScene = byId('spec-scene');
  dom.specBlocks = byId('spec-blocks');
  dom.specFace = byId('spec-face');
  dom.specThickness = byId('spec-thickness');
  dom.specEmblem = byId('spec-emblem');
  dom.specAccent = byId('spec-accent');
  dom.specSurface = byId('spec-surface');
  dom.specCamera = byId('spec-camera');
  dom.specTriangles = byId('spec-triangles');
  dom.infoFootState = byId('info-foot-state');
  dom.assetTags = byId('asset-tags');
  dom.assetNote = byId('asset-note');
  dom.layerRail = byId('layer-rail');
  dom.footerStatus = byId('footer-status');
  dom.curtain = byId('loading') || byId('curtain');
  dom.loadingTitle = byId('loading-title');
  dom.loadingBar = byId('loading-bar');
  dom.loadingLabel = byId('loading-label');
  dom.loadingCount = byId('loading-count');
  dom.fallback = byId('fallback');
  dom.fallbackMessage = byId('fallback-message');
  dom.fallbackPoster = byId('fallback-poster');
  dom.errorBanner = byId('error-banner');
  dom.errorText = byId('error-text');
  dom.liveStatus = byId('live-status');
  dom.diag = byId('qa-diag');
}

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function curtainProgress(ratio, label, count, title) {
  const safe = clamp(Number(ratio) || 0, 0, 1);
  if (dom.loadingBar) dom.loadingBar.style.width = (safe * 100).toFixed(1) + '%';
  if (label && dom.loadingLabel) dom.loadingLabel.textContent = label;
  if (count !== undefined && dom.loadingCount) dom.loadingCount.textContent = String(count);
  if (title && dom.loadingTitle) dom.loadingTitle.textContent = title;
  if (label && dom.veilText) dom.veilText.textContent = label;
}

function hideCurtain() {
  hideStageVeil();
  if (!dom.curtain) return;
  dom.curtain.classList.add('is-hidden');
  dom.curtain.setAttribute('aria-hidden', 'true');
  if (isStaticMode() || state.qaMode) {
    dom.curtain.hidden = true;
    return;
  }
  window.setTimeout(() => {
    if (dom.curtain) dom.curtain.hidden = true;
  }, 700);
}

function hideStageVeil() {
  if (dom.stage) dom.stage.classList.remove('is-busy');
  if (!dom.stageVeil) return;
  dom.stageVeil.classList.add('is-hidden');
  dom.stageVeil.setAttribute('aria-hidden', 'true');
  dom.stageVeil.hidden = true;
}

function showStageBusy() {
  if (dom.stage) dom.stage.classList.add('is-busy');
  if (dom.stageVeil) {
    dom.stageVeil.hidden = false;
    dom.stageVeil.classList.remove('is-hidden');
    dom.stageVeil.removeAttribute('aria-hidden');
  }
}

function announce(message) {
  if (dom.liveStatus) dom.liveStatus.textContent = message;
}

/* --------------------------------------------------------- scene facts/ui */

function hexFromMaterial(material) {
  if (!material) return null;
  if (material.userData && typeof material.userData.specColorHex === 'string' && material.userData.specColorHex) {
    return material.userData.specColorHex.toLowerCase();
  }
  if (material.color && typeof material.color.clone === 'function') {
    return '#' + material.color.clone().convertLinearToSRGB().getHexString();
  }
  return null;
}

function materialHex(candidates) {
  const materials = state.model && state.model.materials;
  if (!materials || !Array.isArray(candidates)) return null;
  for (const key of candidates) {
    const material = materials[key];
    if (material) {
      const hex = hexFromMaterial(material);
      if (hex) return hex;
    }
  }
  return null;
}

function findMaterialByHint(hint) {
  const materials = state.model && state.model.materials;
  if (!materials) return null;
  const pattern = new RegExp(hint, 'i');
  for (const key of Object.keys(materials)) {
    if (pattern.test(key) && materials[key]) return materials[key];
  }
  return null;
}

function faceMaterialFor(sceneKey) {
  const candidates = sceneKey === 'stack'
    ? ['stackFace', 'faceStack', 'face', 'stackFaceMaterial']
    : ['bankFace', 'faceBank', 'face', 'bankFaceMaterial'];
  for (const key of candidates) {
    const materials = state.model && state.model.materials;
    if (materials && materials[key]) return materials[key];
  }
  return findMaterialByHint('face');
}

function finishLabel(roughness) {
  if (!Number.isFinite(roughness)) return 'machined';
  if (roughness <= 0.2) return 'polished';
  if (roughness <= 0.34) return 'satin';
  return 'machined';
}

function sceneFacts(sceneKey) {
  const meta = SCENE_META[sceneKey];
  const model = state.model;
  const sceneModel = model && model.scenes ? model.scenes[sceneKey] : null;
  const sceneSpec = model && model.spec ? model.spec[sceneKey] : null;
  const rig = state.studio && state.studio.rigs ? state.studio.rigs[sceneKey] : null;
  const cameraSpec = rig ? rig.spec : sceneCameraSpec(sceneKey);
  const blockCount = sceneModel && Array.isArray(sceneModel.blocks) ? sceneModel.blocks.length : 0;
  const triangles = sceneModel && sceneModel.stats ? finiteOr(sceneModel.stats.triangles, 0) : 0;
  const thickness = finiteOr(sceneSpec && (sceneSpec.thickness !== undefined ? sceneSpec.thickness : sceneSpec.blockThickness), meta.thicknessFallback);
  const face = faceMaterialFor(sceneKey);
  const faceHex = hexFromMaterial(face);
  const emblem = sceneModel && sceneModel.emblem ? sceneModel.emblem : null;
  const emblemShapes = emblem ? finiteOr(emblem.shapeCount, Array.isArray(emblem.shapes) ? emblem.shapes.length : 3) : 3;
  const accent = sceneModel && sceneModel.accent ? sceneModel.accent : null;
  const accentCount = accent ? finiteOr(accent.count, 0) : 0;
  return {
    sceneLabel: meta.sceneLabel,
    blocks: meta.blocksLabel,
    face: faceHex ? faceHex + ' \u00b7 ' + finishLabel(face ? face.roughness : NaN) : '\u2014',
    thickness: thickness.toFixed(3),
    emblem: 'teko2_icon.svg \u00b7 ' + emblemShapes + ' shapes \u00b7 silver/graphite',
    accent: sceneKey === 'stack'
      ? meta.accentLabel + (accentCount > 0 ? ' \u00d7 ' + accentCount : '')
      : meta.accentLabel,
    surface: meta.surfaceLabel,
    camera: cameraSpec.azimuthDeg + '\u00b0 / ' + cameraSpec.elevationDeg + '\u00b0 three-quarter',
    triangles: triangles > 0 ? triangles.toLocaleString('en-US') : '\u2014',
    blockCount,
    trianglesRaw: triangles,
    emblemShapes,
    bankIconShapes: model && model.scenes && model.scenes.bank && model.scenes.bank.bankIcon
      ? finiteOr(model.scenes.bank.bankIcon.shapeCount, 0)
      : 0,
  };
}

function layerColor(layer) {
  const hex = materialHex(layer.candidates);
  if (hex) return hex;
  return hexString(layer.color);
}

function layersMarkup(sceneKey) {
  const layers = SCENE_META[sceneKey].layers;
  const chips = layers.map((layer, index) => {
    const color = layerColor(layer);
    const chipClass = 'layer-chip' + (layer.gold ? ' layer-chip--gold' : '');
    const swatchClass = 'layer-swatch' + (layer.swatch ? ' layer-swatch--' + layer.swatch : '');
    return '<span class="' + chipClass + '">' +
      '<span class="' + swatchClass + '" style="background:' + color + '" aria-hidden="true"></span>' +
      '<span class="layer-name">' + layer.name + '</span>' +
      '<span class="layer-index">' + String(index + 1).padStart(2, '0') + '</span>' +
      '</span>';
  });
  return chips.join('');
}

function tagsMarkup(sceneKey, facts) {
  const meta = SCENE_META[sceneKey];
  const tags = [];
  for (const tag of meta.tags) tags.push(tag);
  if (facts && facts.trianglesRaw > 0) tags.push({ label: facts.trianglesRaw.toLocaleString('en-US') + ' tris' });
  return tags
    .map((tag) => {
      let classes = 'asset-tag';
      if (tag.gold) classes += ' asset-tag--gold';
      if (tag.metal) classes += ' asset-tag--metal';
      return '<span class="' + classes + '">' + tag.label + '</span>';
    })
    .join('');
}

function syncSceneButtons() {
  if (dom.btnSceneStack) dom.btnSceneStack.setAttribute('aria-pressed', state.scene === 'stack' ? 'true' : 'false');
  if (dom.btnSceneBank) dom.btnSceneBank.setAttribute('aria-pressed', state.scene === 'bank' ? 'true' : 'false');
}

function syncPoseReadout() {
  const rig = state.studio ? state.studio.getActiveRig() : null;
  const spec = rig ? rig.spec : sceneCameraSpec(state.scene);
  const pose = rig ? rig.getPose() : { azimuthDeg: spec.azimuthDeg, elevationDeg: spec.elevationDeg };
  setText(dom.poseState, round(pose.azimuthDeg, 0) + '\u00b0 / ' + round(pose.elevationDeg, 0) + '\u00b0');
}

function syncSceneUi() {
  const meta = SCENE_META[state.scene];
  const facts = sceneFacts(state.scene);
  setText(dom.stageEyebrowText, meta.stage.eyebrow);
  setText(dom.stageIndex, meta.stage.index);
  setText(dom.stageIndexTotal, meta.stage.total);
  setText(dom.stageCode, meta.stage.code);
  setText(dom.stageName, meta.stage.name);
  setText(dom.stageDetail, meta.stage.detail);
  setText(dom.infoName, meta.info.name);
  setText(dom.infoRegion, meta.info.region);
  setText(dom.infoIndex, meta.info.index);
  if (dom.infoGlyph) dom.infoGlyph.innerHTML = meta.info.glyph;
  setText(dom.specScene, facts.sceneLabel);
  setText(dom.specBlocks, facts.blocks);
  setText(dom.specFace, facts.face);
  setText(dom.specThickness, facts.thickness);
  setText(dom.specEmblem, facts.emblem);
  setText(dom.specAccent, facts.accent);
  setText(dom.specSurface, facts.surface);
  setText(dom.specCamera, facts.camera);
  setText(dom.specTriangles, facts.triangles);
  if (dom.assetTags) dom.assetTags.innerHTML = tagsMarkup(state.scene, facts);
  if (dom.assetNote) dom.assetNote.innerHTML = meta.note;
  if (dom.layerRail) dom.layerRail.innerHTML = layersMarkup(state.scene);
  if (dom.stageCaption) dom.stageCaption.setAttribute('data-scene', state.scene);
  syncSceneButtons();
  syncPoseReadout();
  if (!state.ready && !state.failed) {
    setText(dom.infoFootState, 'Preparing');
    setText(dom.footerStatus, 'Loading');
  }
}

function syncUi() {
  const meta = SCENE_META[state.scene];
  if (dom.btnReset) dom.btnReset.disabled = !state.ready || state.failed;
  if (dom.stageHint) {
    const hidden = state.failed || state.still || state.shot;
    dom.stageHint.hidden = hidden;
    if (hidden) dom.stageHint.setAttribute('aria-hidden', 'true');
    else dom.stageHint.removeAttribute('aria-hidden');
  }
  setText(dom.infoFootState, state.failed ? 'Static fallback' : state.ready ? meta.footState : 'Preparing');
  setText(dom.footerStatus, state.failed ? 'Static fallback' : state.ready ? meta.footerState : 'Loading');
  if (dom.stage && (state.ready || state.failed)) dom.stage.classList.remove('is-busy');
  syncPoseReadout();
}

/* ------------------------------------------------------ geometry helpers */

function measurePointExtents(points, fallbackBounds) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  if (points && typeof points.length === 'number' && points.length >= 3) {
    for (let index = 0; index + 2 < points.length; index += 3) {
      const x = points[index];
      const y = points[index + 1];
      const z = points[index + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  if (!Number.isFinite(minX) && fallbackBounds) {
    minX = fallbackBounds.min.x;
    minY = fallbackBounds.min.y;
    minZ = fallbackBounds.min.z;
    maxX = fallbackBounds.max.x;
    maxY = fallbackBounds.max.y;
    maxZ = fallbackBounds.max.z;
  }
  if (!Number.isFinite(minX)) {
    minX = -1; maxX = 1; minY = 0; maxY = 1; minZ = -1; maxZ = 1;
  }
  return {
    minX, minY, minZ, maxX, maxY, maxZ,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  };
}

function resolveFitPoints(sceneModel) {
  const points = sceneModel && sceneModel.fitPoints;
  if (points && typeof points.length === 'number' && points.length >= 3) return points;
  const bounds = sceneModel && sceneModel.bounds;
  const box = measurePointExtents(null, bounds);
  const corners = [];
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      for (const z of [box.minZ, box.maxZ]) corners.push(x, y, z);
    }
  }
  return new Float32Array(corners);
}

function disposeObject(root) {
  if (!root) return;
  root.traverse((object) => {
    if (object.isMesh) {
      if (object.geometry) object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          if (entry.map) entry.map.dispose();
          if (entry.normalMap) entry.normalMap.dispose();
          if (entry.roughnessMap) entry.roughnessMap.dispose();
          entry.dispose();
        }
      } else if (material) {
        if (material.map) material.map.dispose();
        if (material.normalMap) material.normalMap.dispose();
        if (material.roughnessMap) material.roughnessMap.dispose();
        material.dispose();
      }
    }
  });
}

/* ------------------------------------------------------------- environments */

/**
 * Build one procedural PMREM environment (deterministic `fromScene`, no HDR
 * file): a smooth radiance dome plus a few large soft panels. Returns the
 * render target; dispose it with the studio.
 */
function buildEnvironment(renderer, spec) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  envScene.name = 'logo-blocks-environment';

  const dome = spec.dome;
  const geometry = new THREE.SphereGeometry(dome.radius, 64, 40);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) / dome.radius;
    const y = position.getY(index) / dome.radius;
    const z = position.getZ(index) / dome.radius;
    let value = lerp(dome.floor, dome.sky, smoothstep(-0.85, 0.3, y));
    value += dome.horizonGlow * Math.exp(-Math.pow((y - 0.02) / 0.3, 2));
    value += dome.frontBoost * Math.pow(Math.max(0, z), 1.5);
    const warm = Math.max(0, -x) * dome.warmTint;
    const cool = Math.max(0, x) * dome.coolTint;
    colors[index * 3] = Math.max(0, value + warm);
    colors[index * 3 + 1] = Math.max(0, value + warm * 0.55 + cool * 0.25);
    colors[index * 3 + 2] = Math.max(0, value - warm * 0.45 + cool);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const domeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false });
  const domeMesh = new THREE.Mesh(geometry, domeMaterial);
  domeMesh.name = 'env-dome';
  envScene.add(domeMesh);

  for (let index = 0; index < spec.panels.length; index += 1) {
    const panel = spec.panels[index];
    const color = new THREE.Color().setRGB(panel.color[0], panel.color[1], panel.color[2]).multiplyScalar(panel.intensity);
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(panel.size[0], panel.size[1]), material);
    mesh.name = 'env-panel-' + index;
    mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);
    mesh.lookAt(panel.lookAt[0], panel.lookAt[1], panel.lookAt[2]);
    envScene.add(mesh);
  }

  const renderTarget = pmremGenerator.fromScene(envScene, spec.sigma);
  pmremGenerator.dispose();
  disposeObject(envScene);
  return renderTarget;
}

/** Visible studio backdrop: a large vertex-coloured dome (world-Y gradient). */
function buildBackdrop(spec, radius) {
  const geometry = new THREE.SphereGeometry(radius, 64, 40);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const top = workingColorFromHex(spec.top);
  const subject = workingColorFromHex(spec.subject);
  const horizon = workingColorFromHex(spec.horizon);
  const bottom = workingColorFromHex(spec.bottom);
  const blend = new THREE.Color();
  const stopA = spec.stops[0];
  const stopB = spec.stops[1];
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) / radius;
    const y = position.getY(index) / radius;
    if (y <= stopA) {
      mixWorkingColors(bottom, horizon, smoothstep(-1, stopA, y), blend);
    } else if (y <= stopB) {
      mixWorkingColors(horizon, subject, smoothstep(stopA, stopB, y), blend);
    } else {
      mixWorkingColors(subject, top, smoothstep(stopB, 1, y), blend);
    }
    const lift = 1 + spec.leftLift * Math.max(0, -x);
    const tint = 1 + spec.rightTint * Math.max(0, x);
    colors[index * 3] = Math.max(0, blend.r * lift);
    colors[index * 3 + 1] = Math.max(0, blend.g * lift);
    colors[index * 3 + 2] = Math.max(0, blend.b * lift * tint);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    toneMapped: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'studio-backdrop';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function rgbaString(hex, alpha) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

/**
 * Studio backdrop wall (cyclorama) behind the composition. It hides the far
 * expanse of the model's surface slab — which otherwise fills the frame and
 * reads as a plaza instead of the reference's table-against-backdrop — and
 * carries the scene's soft glow and a contact-darkened junction band. It is an
 * unlit gradient, deterministic, and part of the studio (not the model).
 */
function buildBackdropWall(spec, modelScene) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'studio-backdrop-wall';
  texture.encoding = THREE.sRGBEncoding;
  texture.userData = { role: 'studio backdrop wall', procedural: true, local: true };

  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const vertical = ctx.createLinearGradient(0, size, 0, 0);
    vertical.addColorStop(0, rgbaString(spec.bottom, 1));
    vertical.addColorStop(0.55, rgbaString(spec.top, 1));
    vertical.addColorStop(1, rgbaString(spec.top, 1));
    ctx.fillStyle = vertical;
    ctx.fillRect(0, 0, size, size);

    const glowY = clamp(spec.glowY, 0.05, 0.95);
    const glow = ctx.createRadialGradient(size * 0.5, size * (1 - glowY), 0, size * 0.5, size * (1 - glowY), size * 0.52);
    glow.addColorStop(0, rgbaString(spec.glow, spec.glowOpacity));
    glow.addColorStop(0.45, rgbaString(spec.glow, spec.glowOpacity * 0.42));
    glow.addColorStop(1, rgbaString(spec.glow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    const ao = ctx.createLinearGradient(0, size, 0, size * 0.72);
    ao.addColorStop(0, 'rgba(0, 0, 0, ' + spec.ao + ')');
    ao.addColorStop(0.55, 'rgba(0, 0, 0, ' + spec.ao * 0.35 + ')');
    ao.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ao;
    ctx.fillRect(0, 0, size, size);
    texture.needsUpdate = true;
  }

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    depthWrite: true,
    side: THREE.FrontSide,
    fog: false,
  });
  material.name = 'studio-backdrop-wall-material';
  const geometry = new THREE.PlaneGeometry(spec.width, spec.height, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'studio-backdrop-wall';
  const bounds = modelScene && modelScene.bounds;
  const surfaceY = bounds ? bounds.min.y : 0;
  mesh.position.set(
    bounds ? bounds.center.x : 0,
    surfaceY + spec.height / 2 - 0.35,
    (bounds ? bounds.min.z : 0) + spec.zOffset,
  );
  mesh.renderOrder = -4;
  return mesh;
}

function addStudioLights(scene, lights) {
  const out = {};
  for (const key of Object.keys(lights)) {
    const spec = lights[key];
    const light = new THREE.DirectionalLight(spec.color, spec.intensity);
    light.name = 'studio-light-' + key;
    light.position.set(spec.position[0], spec.position[1], spec.position[2]);
    light.target.position.set(spec.target[0], spec.target[1], spec.target[2]);
    scene.add(light);
    scene.add(light.target);
    out[key] = light;
  }
  return out;
}

/**
 * The model owns the visible floor slabs and authored contact shadows (it is
 * part of each composition's group). Detect them so this previewer never adds a
 * second, coplanar floor on top: the procedural studio floor + shadow below are
 * only a fallback for a model that omits them.
 */
function detectModelStudio(modelScene) {
  const found = { surface: false, shadow: false, surfaceY: null };
  const group = modelScene && modelScene.group;
  if (!group || typeof group.traverse !== 'function') return found;
  group.traverse((object) => {
    if (!object.isMesh) return;
    const name = String(object.name || '').toLowerCase();
    if (/shadow/.test(name)) {
      found.shadow = true;
      return;
    }
    if (/surface|floor|slab|table/.test(name)) found.surface = true;
  });
  if (found.surface && modelScene.bounds) found.surfaceY = modelScene.bounds.min.y;
  return found;
}

/* ------------------------------------------------------------- floor slab */

function tileTexture(source, repeatX, repeatY, isColorMap) {
  if (!source || !source.isTexture) return null;
  const texture = source.clone();
  texture.name = (source.name || 'surface') + '-tiled';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  if (isColorMap && texture.encoding !== THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  return texture;
}

function pickSurfaceTexture(surfaceMaps, names) {
  if (!surfaceMaps) return null;
  for (const name of names) {
    const value = surfaceMaps[name];
    if (!value) continue;
    if (value.isTexture) return value;
    if (value.texture && value.texture.isTexture) return value.texture;
  }
  return null;
}

function createSurfaceMaterial(sceneKey, studioSpec, sceneModel) {
  const spec = studioSpec.surface;
  if (sceneKey !== 'bank') {
    return new THREE.MeshStandardMaterial({
      name: 'studio-floor-stack',
      color: workingColorFromHex(spec.color),
      metalness: spec.metalness,
      roughness: spec.roughness,
      envMapIntensity: spec.envMapIntensity,
    });
  }

  const surfaceMaps = sceneModel && sceneModel.textures ? sceneModel.textures.surface : null;
  const albedo = pickSurfaceTexture(surfaceMaps, ['albedo', 'map', 'color']);
  const normal = pickSurfaceTexture(surfaceMaps, ['normal', 'normalMap']);
  const roughness = pickSurfaceTexture(surfaceMaps, ['roughness', 'roughnessMap']);
  const material = new THREE.MeshStandardMaterial({
    name: 'studio-floor-bank',
    color: albedo ? new THREE.Color(1, 1, 1) : workingColorFromHex(spec.color),
    metalness: spec.metalness,
    roughness: roughness ? 1.0 : spec.roughness,
    envMapIntensity: spec.envMapIntensity,
  });
  if (albedo) material.map = tileTexture(albedo, 2, 2, true);
  if (normal) {
    material.normalMap = tileTexture(normal, 2, 2, false);
    material.normalScale = new THREE.Vector2(1, 1);
  }
  if (roughness) material.roughnessMap = tileTexture(roughness, 2, 2, false);
  material.userData = { role: 'concrete slab (bank scene)', procedural: Boolean(albedo), local: true };
  return material;
}

/**
 * The visible studio floor. Its footprint comes from the scene's `fitPoints`
 * XZ extents (the model includes the surface front-edge margin there), so the
 * framed composition always ends exactly at the slab's rounded front lip.
 */
function buildSurface(sceneKey, studioSpec, sceneModel) {
  const fit = measurePointExtents(sceneModel.fitPoints, sceneModel.bounds);
  const surfaceY = sceneModel.bounds ? sceneModel.bounds.min.y : 0;
  const thickness = studioSpec.surface.thickness;
  const lipRadius = thickness / 2;
  const frontZ = fit.maxZ - lipRadius;
  const backZ = fit.minZ;
  const depth = Math.max(0.2, frontZ - backZ);
  const width = Math.max(fit.width * 2.2, 10);
  const centerX = fit.centerX;
  const centerZ = (frontZ + backZ) / 2;
  const material = createSurfaceMaterial(sceneKey, studioSpec, sceneModel);

  const group = new THREE.Group();
  group.name = 'studio-surface';
  const slab = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, depth), material);
  slab.name = 'studio-surface-slab';
  slab.position.set(centerX, surfaceY - thickness / 2, centerZ);
  group.add(slab);

  const lip = new THREE.Mesh(new THREE.CylinderGeometry(lipRadius, lipRadius, width, 48, 1, false), material);
  lip.name = 'studio-surface-lip';
  lip.rotation.z = Math.PI / 2;
  lip.position.set(centerX, surfaceY - lipRadius, frontZ);
  group.add(lip);

  return { group, material, surfaceY, fit, frontZ, backZ, width, depth, centerX, centerZ };
}

/* ---------------------------------------------------------- contact shadow */

function createShadowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'studio-contact-shadow';
  texture.anisotropy = 4;
  texture.userData = { role: 'contact-shadow', procedural: true, local: true };
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.92)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.52)');
    gradient.addColorStop(0.72, 'rgba(0, 0, 0, 0.16)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    texture.needsUpdate = true;
  }
  return texture;
}

function buildContactShadows(spec, sceneModel, surfaceY, fit) {
  const group = new THREE.Group();
  group.name = 'studio-contact-shadows';
  const texture = createShadowTexture();
  const boxes = [];

  if (spec.mode === 'blocks' && Array.isArray(sceneModel.blocks)) {
    for (const block of sceneModel.blocks) {
      const object = block.group || block.mesh;
      if (!object) continue;
      object.updateMatrixWorld(true);
      try {
        boxes.push(new THREE.Box3().setFromObject(object));
      } catch (error) {
        /* skip a block whose bounds cannot be measured */
      }
    }
  }
  if (boxes.length === 0) {
    const bounds = sceneModel.bounds;
    if (bounds) {
      boxes.push(new THREE.Box3(
        new THREE.Vector3(fit.minX, bounds.min.y, fit.minZ),
        new THREE.Vector3(fit.maxX, bounds.max.y, fit.maxZ),
      ));
    }
  }

  const addShadow = (width, depth, centerX, centerZ, y, opacity, order) => {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0x000000,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.25, width), Math.max(0.2, depth)), material);
    mesh.name = 'studio-contact-shadow';
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(centerX, y, centerZ);
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  };

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  let order = 2;
  for (const box of boxes) {
    box.getSize(size);
    box.getCenter(center);
    const width = Math.max(0.35, size.x * spec.widthScale, size.z * spec.widthScale * 0.6);
    const depth = Math.max(0.3, size.z * spec.depthScale, size.x * spec.depthScale * 0.4);
    const x = center.x + spec.offsetX;
    const z = center.z + spec.offsetZ;
    addShadow(width, depth, x, z, surfaceY + 0.004, spec.opacity, order);
    order += 1;
    addShadow(width * spec.coreScale, depth * spec.coreScale, x, z, surfaceY + 0.006, spec.coreOpacity, order);
    order += 1;
  }

  return { group, texture };
}

/* --------------------------------------------------------------------- rig */

/**
 * One composition: its own THREE.Scene + camera + fitted pose. Both rigs are
 * built once at boot; only the active rig is rendered, and entering a scene
 * snaps its camera to that scene's default pose (deterministic).
 */
class LogoBlocksRig {
  constructor({ studio, key, spec, scene, camera, envRT, backdrop, wall, surface, shadows, modelScene }) {
    this.studio = studio;
    this.key = key;
    this.spec = spec;
    this.scene = scene;
    this.camera = camera;
    this.envRT = envRT;
    this.backdrop = backdrop;
    this.wall = wall;
    this.surface = surface;
    this.shadows = shadows;
    this.modelScene = modelScene;
    this.fitPoints = resolveFitPoints(modelScene);
    this.bounds = modelScene.bounds;
    this.extents = measurePointExtents(this.fitPoints, this.bounds);
    this.pose = { azimuthDeg: spec.azimuthDeg, elevationDeg: spec.elevationDeg };
    this.targetPose = { azimuthDeg: spec.azimuthDeg, elevationDeg: spec.elevationDeg };
    this.target = new THREE.Vector3();
    this.targetTarget = new THREE.Vector3();
    this.distance = 6;
    this.targetDistance = 6;
    this.aspect = 1.6;
    this.narrowStage = false;
    this.fitMargin = spec.fill;
    this.orbitActive = false;
    this.backdropBaseRadius = this.backdrop ? this.backdrop.geometry.parameters.radius : 1;
  }

  motionAllowed() {
    return this.studio.motionAllowed();
  }

  /** Closed-form fit for the fixed view direction (see shield's proven solver). */
  solveFitDistance(target, basis, maxX, maxY, points) {
    let distance = this.spec.near + 2;
    for (let index = 0; index + 2 < points.length; index += 3) {
      const rx = points[index] - target.x;
      const ry = points[index + 1] - target.y;
      const rz = points[index + 2] - target.z;
      const xv = rx * basis.right.x + ry * basis.right.y + rz * basis.right.z;
      const yv = rx * basis.up.x + ry * basis.up.y + rz * basis.up.z;
      const c = rx * basis.direction.x * -1 + ry * basis.direction.y * -1 + rz * basis.direction.z * -1;
      distance = Math.max(distance, Math.abs(xv) / maxX - c, Math.abs(yv) / maxY - c);
    }
    return distance;
  }

  computeFit(azimuthDeg, elevationDeg) {
    const bounds = this.bounds || { center: { x: 0, y: 0, z: 0 } };
    const baseTarget = new THREE.Vector3(
      bounds.center.x,
      bounds.center.y + this.spec.targetYOffset,
      bounds.center.z,
    );
    const aspect = this.aspect > 0 ? this.aspect : 1.6;
    const narrow = this.studio.stageBox.width < this.spec.narrowStageWidth;
    const margin = narrow ? this.spec.fillNarrow : this.spec.fill;
    const tanHalf = Math.tan(degToRad(this.spec.fov) / 2);
    const maxX = margin * tanHalf * aspect;
    const maxY = margin * tanHalf;
    const basis = cameraBasis(azimuthDeg, elevationDeg);
    const points = this.fitPoints;
    const target = baseTarget.clone();
    let distance = 5;

    if (points && points.length >= 3) {
      const probe = new THREE.PerspectiveCamera(this.spec.fov, aspect, this.spec.near, this.spec.far);
      const projected = new THREE.Vector3();
      for (let iteration = 0; iteration < 4; iteration += 1) {
        distance = this.solveFitDistance(target, basis, maxX, maxY, points);
        probe.position.copy(target).addScaledVector(basis.direction, distance);
        probe.lookAt(target);
        probe.updateMatrixWorld(true);
        probe.updateProjectionMatrix();
        let minX = Infinity;
        let maxXValue = -Infinity;
        let minY = Infinity;
        let maxYValue = -Infinity;
        for (let index = 0; index + 2 < points.length; index += 3) {
          projected.set(points[index], points[index + 1], points[index + 2]).project(probe);
          minX = Math.min(minX, projected.x);
          maxXValue = Math.max(maxXValue, projected.x);
          minY = Math.min(minY, projected.y);
          maxYValue = Math.max(maxYValue, projected.y);
        }
        const centerX = (minX + maxXValue) / 2;
        const centerY = (minY + maxYValue) / 2;
        if (Math.abs(centerX) < 0.0015 && Math.abs(centerY) < 0.0015) break;
        target.addScaledVector(basis.up, centerY * distance * tanHalf);
        target.addScaledVector(basis.right, centerX * distance * tanHalf * aspect);
      }
      distance = this.solveFitDistance(target, basis, maxX, maxY, points);
    }
    return { target, distance: clamp(distance, this.spec.near + 1, this.spec.far * 0.7) };
  }

  placeCamera() {
    if (!this.camera) return;
    const basis = cameraBasis(this.pose.azimuthDeg, this.pose.elevationDeg);
    this.camera.position.copy(this.target).addScaledVector(basis.direction, this.distance);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    if (this.backdrop) {
      const pad = this.spec.far * 0.9 - this.distance;
      const scale = clamp(pad / this.backdropBaseRadius, 0.4, 1.5);
      this.backdrop.scale.setScalar(scale);
      this.backdrop.position.set(this.extents.centerX, this.extents.centerY + this.extents.height * 0.25, this.extents.centerZ);
    }
  }

  applyPose({ snap = true } = {}) {
    if (!snap) return;
    this.orbitActive = false;
    this.pose.azimuthDeg = this.targetPose.azimuthDeg;
    this.pose.elevationDeg = this.targetPose.elevationDeg;
    this.distance = this.targetDistance;
    this.target.copy(this.targetTarget);
    this.placeCamera();
  }

  setPose(azimuthDeg, elevationDeg, { snap = false } = {}) {
    const azimuth = clamp(finiteOr(azimuthDeg, this.targetPose.azimuthDeg), this.spec.yawMinDeg, this.spec.yawMaxDeg);
    const elevation = clamp(finiteOr(elevationDeg, this.targetPose.elevationDeg), this.spec.pitchMinDeg, this.spec.pitchMaxDeg);
    this.targetPose.azimuthDeg = azimuth;
    this.targetPose.elevationDeg = elevation;
    const fit = this.computeFit(azimuth, elevation);
    this.targetDistance = fit.distance;
    this.targetTarget.copy(fit.target);
    if (snap || !this.motionAllowed()) this.applyPose({ snap: true });
    else this.orbitActive = true;
    return this.getPose();
  }

  reset({ snap = false } = {}) {
    return this.setPose(this.spec.azimuthDeg, this.spec.elevationDeg, { snap: snap || !this.motionAllowed() });
  }

  getPose() {
    return {
      azimuthDeg: this.pose.azimuthDeg,
      elevationDeg: this.pose.elevationDeg,
      targetAzimuthDeg: this.targetPose.azimuthDeg,
      targetElevationDeg: this.targetPose.elevationDeg,
      defaultAzimuthDeg: this.spec.azimuthDeg,
      defaultElevationDeg: this.spec.elevationDeg,
    };
  }

  updateOrbit(dtSeconds) {
    if (!this.orbitActive || !this.motionAllowed()) return false;
    const easing = 1 - Math.exp(-ORBIT.damping * dtSeconds);
    const pose = this.pose;
    const target = this.targetPose;
    pose.azimuthDeg += (target.azimuthDeg - pose.azimuthDeg) * easing;
    pose.elevationDeg += (target.elevationDeg - pose.elevationDeg) * easing;
    this.distance += (this.targetDistance - this.distance) * easing;
    this.target.lerp(this.targetTarget, easing);
    const settled =
      Math.abs(target.azimuthDeg - pose.azimuthDeg) < 0.02 &&
      Math.abs(target.elevationDeg - pose.elevationDeg) < 0.02 &&
      Math.abs(this.targetDistance - this.distance) < 0.0005 &&
      this.target.distanceTo(this.targetTarget) < 0.0005;
    if (settled) {
      pose.azimuthDeg = target.azimuthDeg;
      pose.elevationDeg = target.elevationDeg;
      this.distance = this.targetDistance;
      this.target.copy(this.targetTarget);
      this.orbitActive = false;
    }
    this.placeCamera();
    return true;
  }

  getCameraDebug(dragging) {
    if (!this.camera) return null;
    const narrow = this.studio.stageBox.width < this.spec.narrowStageWidth;
    return {
      azimuthDeg: round(this.pose.azimuthDeg, 2),
      elevationDeg: round(this.pose.elevationDeg, 2),
      targetAzimuthDeg: round(this.targetPose.azimuthDeg, 2),
      targetElevationDeg: round(this.targetPose.elevationDeg, 2),
      defaultAzimuthDeg: this.spec.azimuthDeg,
      defaultElevationDeg: this.spec.elevationDeg,
      distance: round(this.camera.position.distanceTo(this.target), 4),
      fov: this.spec.fov,
      near: this.spec.near,
      far: this.spec.far,
      aspect: round(this.camera.aspect, 4),
      position: [round(this.camera.position.x, 4), round(this.camera.position.y, 4), round(this.camera.position.z, 4)],
      target: [round(this.target.x, 4), round(this.target.y, 4), round(this.target.z, 4)],
      clamps: {
        yawMinDeg: round(this.spec.yawMinDeg, 2),
        yawMaxDeg: round(this.spec.yawMaxDeg, 2),
        pitchMinDeg: this.spec.pitchMinDeg,
        pitchMaxDeg: this.spec.pitchMaxDeg,
      },
      fitMargin: narrow ? this.spec.fillNarrow : this.spec.fill,
      narrowStage: narrow,
      dragging: Boolean(dragging),
    };
  }

  /** Screen bbox of this composition's fit points, in stage-local pixels. */
  getObjectRect() {
    if (!this.camera) return null;
    const width = this.studio.stageBox.width || 1;
    const height = this.studio.stageBox.height || 1;
    const points = this.fitPoints;
    if (!points || points.length < 3) return null;
    const projected = new THREE.Vector3();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let index = 0; index + 2 < points.length; index += 3) {
      projected.set(points[index], points[index + 1], points[index + 2]).project(this.camera);
      const px = (projected.x * 0.5 + 0.5) * width;
      const py = (1 - (projected.y * 0.5 + 0.5)) * height;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    if (!Number.isFinite(minX)) return null;
    return {
      units: 'stage-px',
      x: round(minX, 2),
      y: round(minY, 2),
      left: round(minX, 2),
      top: round(minY, 2),
      right: round(maxX, 2),
      bottom: round(maxY, 2),
      width: round(maxX - minX, 2),
      height: round(maxY - minY, 2),
      w: round(maxX - minX, 2),
      h: round(maxY - minY, 2),
      stageWidth: round(width, 2),
      stageHeight: round(height, 2),
    };
  }

  dispose() {
    if (this.scene) {
      this.scene.traverse((object) => {
        if (object.isMesh) {
          if (object.geometry) object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            for (const entry of material) {
              if (entry.map) entry.map.dispose();
              entry.dispose();
            }
          } else if (material && material.name && material.name.indexOf('studio-') === 0) {
            if (material.map) material.map.dispose();
            if (material.normalMap) material.normalMap.dispose();
            if (material.roughnessMap) material.roughnessMap.dispose();
            material.dispose();
          }
        }
      });
      this.scene.environment = null;
    }
    if (this.shadows && this.shadows.texture) this.shadows.texture.dispose();
    if (this.envRT) this.envRT.dispose();
    this.envRT = null;
    this.scene = null;
    this.camera = null;
  }
}

/* ------------------------------------------------------------------ studio */

class LogoBlocksStudio {
  constructor({ canvas, stage, model, reducedMotion = false, still = false, shot = false }) {
    this.canvas = canvas;
    this.stage = stage;
    this.model = model;
    this.rigs = {};
    this.activeKey = 'stack';
    this.renderer = null;
    this.stageBox = { width: 0, height: 0 };
    this.renderCount = 0;
    this.firstFrameRendered = false;
    this.firstFrameResolve = null;
    this.needsRender = true;
    this.raf = 0;
    this.lastTime = 0;
    this.destroyed = false;
    this.dragging = false;
    this.reducedMotion = Boolean(reducedMotion);
    this.still = Boolean(still);
    this.shot = Boolean(shot);
    this.resizeObserver = null;
    this.boundResize = null;
    this.onChange = null;
    this.boundLoop = (now) => this.loop(now);
  }

  motionAllowed() {
    return !this.still && !this.shot && !this.reducedMotion;
  }

  getActiveRig() {
    return this.rigs[this.activeKey] || null;
  }

  async init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDERER.dprMax));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDERER.exposure;
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    for (const key of SCENE_IDS) this.rigs[key] = this.buildRig(key);

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.stage);
    } else {
      this.boundResize = () => this.resize();
      window.addEventListener('resize', this.boundResize);
    }
    this.resize();
    this.raf = window.requestAnimationFrame(this.boundLoop);
    return this;
  }

  buildRig(key) {
    const spec = sceneCameraSpec(key);
    const modelScene = this.model.scenes ? this.model.scenes[key] : null;
    if (!modelScene || !modelScene.group) {
      throw new Error('model scene "' + key + '" is missing its group');
    }
    const studioSpec = STUDIO[key];
    const scene = new THREE.Scene();
    scene.name = 'logo-blocks-studio-' + key;
    scene.add(modelScene.group);
    modelScene.group.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera(spec.fov, 1.6, spec.near, spec.far);
    camera.name = 'logo-blocks-camera-' + key;

    const envRT = buildEnvironment(this.renderer, studioSpec.environment);
    scene.environment = envRT.texture;

    const backdropRadius = clamp(spec.far * 0.5, 10, 24);
    const backdrop = buildBackdrop(studioSpec.backdrop, backdropRadius);
    scene.add(backdrop);
    const wall = buildBackdropWall(studioSpec.wall, modelScene);
    scene.add(wall);
    addStudioLights(scene, studioSpec.lights);

    const modelStudio = detectModelStudio(modelScene);
    const fitExtents = measurePointExtents(modelScene.fitPoints, modelScene.bounds);
    const surfaceY = modelScene.bounds ? modelScene.bounds.min.y : 0;
    let surface = null;
    if (!modelStudio.surface) {
      surface = buildSurface(key, studioSpec, modelScene);
      scene.add(surface.group);
    }
    let shadows = null;
    if (!modelStudio.shadow) {
      shadows = buildContactShadows(studioSpec.shadows, modelScene, surfaceY, fitExtents);
      scene.add(shadows.group);
    }

    return new LogoBlocksRig({
      studio: this,
      key,
      spec,
      scene,
      camera,
      envRT,
      backdrop,
      wall,
      surface,
      shadows,
      modelScene,
    });
  }

  resize() {
    if (!this.renderer || this.destroyed) return;
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.stageBox.width && height === this.stageBox.height && this.firstFrameRendered) return;
    this.stageBox = { width, height };
    this.renderer.setSize(width, height, false);
    for (const key of SCENE_IDS) {
      const rig = this.rigs[key];
      if (!rig) continue;
      rig.aspect = width / height;
      rig.camera.aspect = rig.aspect;
      rig.camera.updateProjectionMatrix();
      const fit = rig.computeFit(rig.targetPose.azimuthDeg, rig.targetPose.elevationDeg);
      rig.targetDistance = fit.distance;
      rig.targetTarget.copy(fit.target);
      rig.applyPose({ snap: true });
    }
    this.needsRender = true;
  }

  setScene(name, { snap = true } = {}) {
    const key = SCENE_IDS.indexOf(String(name)) >= 0 ? String(name) : null;
    if (!key) return false;
    const rig = this.rigs[key];
    if (!rig) return false;
    this.activeKey = key;
    rig.setPose(rig.spec.azimuthDeg, rig.spec.elevationDeg, { snap: snap || !this.motionAllowed() });
    this.needsRender = true;
    return key;
  }

  setPose(azimuthDeg, elevationDeg, options = {}) {
    const rig = this.getActiveRig();
    if (!rig) return null;
    return rig.setPose(azimuthDeg, elevationDeg, {
      snap: Boolean(options.snap) || !this.motionAllowed(),
    });
  }

  reset({ snap = false } = {}) {
    const rig = this.getActiveRig();
    if (!rig) return null;
    return rig.reset({ snap: snap || !this.motionAllowed() });
  }

  loop(now) {
    if (this.destroyed) return;
    this.raf = window.requestAnimationFrame(this.boundLoop);
    const previous = this.lastTime || now;
    const dt = Math.min(64, Math.max(0, now - previous));
    this.lastTime = now;
    const rig = this.getActiveRig();
    if (rig && rig.updateOrbit(dt / 1000)) {
      this.needsRender = true;
      this.emitChange();
    }
    if (this.needsRender) this.renderFrame();
  }

  emitChange() {
    if (typeof this.onChange !== 'function') return;
    try {
      this.onChange();
    } catch (error) {
      /* UI sync is best effort */
    }
  }

  renderFrame() {
    const rig = this.getActiveRig();
    if (!this.renderer || !rig || !rig.scene || !rig.camera) return;
    this.renderer.render(rig.scene, rig.camera);
    this.needsRender = false;
    this.renderCount += 1;
    if (!this.firstFrameRendered) {
      this.firstFrameRendered = true;
      if (this.firstFrameResolve) {
        const resolve = this.firstFrameResolve;
        this.firstFrameResolve = null;
        resolve();
      }
    }
  }

  renderNow() {
    this.needsRender = true;
    this.renderFrame();
  }

  whenFirstFrame() {
    if (this.firstFrameRendered) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.firstFrameResolve = resolve;
    });
  }

  getRenderDebug() {
    const info = this.renderer ? this.renderer.info : null;
    return {
      pixelRatio: this.renderer ? round(this.renderer.getPixelRatio(), 3) : 1,
      width: this.stageBox.width,
      height: this.stageBox.height,
      frames: this.renderCount,
      triangles: info ? info.render.triangles : 0,
      drawCalls: info ? info.render.calls : 0,
      toneMappingExposure: this.renderer ? this.renderer.toneMappingExposure : RENDERER.exposure,
      shadowMapEnabled: Boolean(this.renderer && this.renderer.shadowMap.enabled),
    };
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.boundResize) {
      window.removeEventListener('resize', this.boundResize);
      this.boundResize = null;
    }
    for (const key of SCENE_IDS) {
      const rig = this.rigs[key];
      if (!rig) continue;
      try {
        rig.dispose();
      } catch (error) {
        /* best effort */
      }
      this.rigs[key] = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}

/* ------------------------------------------------------------ model debug */

function roundArray(values, digits = 4) {
  if (!values) return null;
  const out = [];
  for (let index = 0; index < values.length; index += 1) out.push(round(values[index], digits));
  return out;
}

function vectorDebug(vector, digits = 4) {
  if (!vector) return null;
  return [round(vector.x, digits), round(vector.y, digits), round(vector.z, digits)];
}

function boundsDebug(bounds) {
  if (!bounds) return null;
  return {
    min: vectorDebug(bounds.min),
    max: vectorDebug(bounds.max),
    center: vectorDebug(bounds.center),
    size: vectorDebug(bounds.size),
  };
}

function statsDebug(stats) {
  if (!stats) return null;
  return {
    triangles: finiteOr(stats.triangles, 0),
    meshes: finiteOr(stats.meshes, 0),
    drawCalls: finiteOr(stats.drawCalls, 0),
    parts: Array.isArray(stats.parts) ? stats.parts : [],
  };
}

function emblemDebug(emblem) {
  if (!emblem) return null;
  return {
    source: emblem.source || LOGO_RELATIVE,
    tone: emblem.tone || 'silver-graphite',
    shapeCount: finiteOr(emblem.shapeCount, Array.isArray(emblem.shapes) ? emblem.shapes.length : 0),
    width: finiteOr(emblem.width, 0),
    relief: finiteOr(emblem.relief, 0),
    shapes: Array.isArray(emblem.shapes)
      ? emblem.shapes.map((shape) => ({
          fill: shape && shape.fill !== undefined ? shape.fill : null,
          tone: shape && shape.tone ? shape.tone : null,
          triangles: shape && shape.triangles !== undefined ? shape.triangles : null,
        }))
      : [],
  };
}

function minimalSceneDebug(key, sceneModel) {
  if (!sceneModel) return null;
  const blocks = Array.isArray(sceneModel.blocks) ? sceneModel.blocks.length : 0;
  const out = {
    name: sceneModel.name || key,
    blocks,
    bounds: boundsDebug(sceneModel.bounds),
    stats: statsDebug(sceneModel.stats),
    emblem: emblemDebug(sceneModel.emblem),
  };
  if (key === 'bank') {
    const icon = sceneModel.bankIcon;
    out.bankIcon = icon
      ? {
          shapeCount: finiteOr(icon.shapeCount, 0),
          triangleCount: finiteOr(icon.triangleCount, 0),
          width: finiteOr(icon.width, 0),
          relief: finiteOr(icon.relief, 0),
          parts: Array.isArray(icon.parts) ? icon.parts : [],
        }
      : null;
    const textures = sceneModel.textures || {};
    out.textures = {
      panel: textures.panel ? { size: textures.panel.size || null } : null,
      surface: textures.surface ? { size: textures.surface.size || null } : null,
      dotSeed: textures.dotSeed !== undefined ? textures.dotSeed : null,
      dotSpacing: textures.dotSpacing !== undefined ? textures.dotSpacing : null,
      flutePeriod: textures.flutePeriod !== undefined ? textures.flutePeriod : null,
    };
    out.accent = sceneModel.accent
      ? {
          count: finiteOr(sceneModel.accent.count, 0),
          colorSrgb: sceneModel.accent.colorSrgb || null,
          deepSrgb: sceneModel.accent.deepSrgb || null,
          emissiveSrgb: sceneModel.accent.emissiveSrgb || null,
          emissiveIntensity: finiteOr(sceneModel.accent.emissiveIntensity, 0),
          bandHeight: finiteOr(sceneModel.accent.bandHeight, 0),
        }
      : null;
  } else {
    out.accent = sceneModel.accent
      ? {
          count: finiteOr(sceneModel.accent.count, 0),
          colorSrgb: sceneModel.accent.colorSrgb || null,
          deepSrgb: sceneModel.accent.deepSrgb || null,
          emissiveSrgb: sceneModel.accent.emissiveSrgb || null,
          emissiveIntensity: finiteOr(sceneModel.accent.emissiveIntensity, 0),
          bandHeight: finiteOr(sceneModel.accent.bandHeight, 0),
        }
      : null;
  }
  return out;
}

function materialsDebug() {
  const model = state.model;
  if (!model || !model.materials) return null;
  const out = {};
  for (const key of Object.keys(model.materials)) {
    const material = model.materials[key];
    if (!material) continue;
    const maps = material.maps || {};
    out[key] = {
      colorSrgb: hexFromMaterial(material),
      metalness: round(finiteOr(material.metalness, 0), 4),
      roughness: round(finiteOr(material.roughness, 0), 4),
      envMapIntensity: round(finiteOr(material.envMapIntensity, 1), 4),
      maps: {
        map: Boolean(material.map || maps.map),
        normalMap: Boolean(material.normalMap || maps.normalMap),
        roughnessMap: Boolean(material.roughnessMap || maps.roughnessMap),
        metalnessMap: Boolean(material.metalnessMap || maps.metalnessMap),
        aoMap: Boolean(material.aoMap || maps.aoMap),
        emissiveMap: Boolean(material.emissiveMap || maps.emissiveMap),
      },
    };
  }
  return out;
}

function modelDebugSnapshot() {
  const model = state.model;
  if (!model) return null;
  let snapshot = null;
  if (typeof model.getDebug === 'function') {
    try {
      snapshot = model.getDebug();
    } catch (error) {
      snapshot = null;
    }
  }
  const scenes = {};
  for (const key of SCENE_IDS) {
    let sceneDebug = null;
    if (snapshot && snapshot.scenes && snapshot.scenes[key]) sceneDebug = snapshot.scenes[key];
    if (!sceneDebug) sceneDebug = minimalSceneDebug(key, model.scenes ? model.scenes[key] : null);
    scenes[key] = sceneDebug;
  }
  const materials = (snapshot && snapshot.materials) || materialsDebug();
  return {
    version: (snapshot && snapshot.version) || model.version || MODEL.MODEL_VERSION || '1.0.0',
    seed: snapshot && snapshot.seed !== undefined ? snapshot.seed : MODEL.SEED !== undefined ? MODEL.SEED : null,
    scenes,
    materials,
  };
}

/* ------------------------------------------------------------------ debug */

function readStageRect() {
  try {
    const stage = dom.stage || document.getElementById('stage');
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    return {
      x: round(rect.x, 2),
      y: round(rect.y, 2),
      width: round(rect.width, 2),
      height: round(rect.height, 2),
      w: round(rect.width, 2),
      h: round(rect.height, 2),
      top: round(rect.top, 2),
      right: round(rect.right, 2),
      bottom: round(rect.bottom, 2),
      left: round(rect.left, 2),
    };
  } catch (error) {
    return null;
  }
}

function buildDebug() {
  const studio = state.studio;
  const rig = studio ? studio.getActiveRig() : null;
  return {
    version: VERSION,
    ready: Boolean(state.ready),
    errors: qa.errors.slice(),
    warnings: qa.warnings.slice(),
    webgl: { supported: Boolean(state.webgl), version: state.webgl || '' },
    scene: state.scene,
    scenes: SCENE_IDS.slice(),
    camera: rig ? rig.getCameraDebug(studio.dragging) : null,
    objectRect: rig ? rig.getObjectRect() : null,
    stageRect: readStageRect(),
    model: modelDebugSnapshot(),
    render: studio ? studio.getRenderDebug() : null,
    flags: {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      qaMode: Boolean(state.qaMode),
      reducedMotion: Boolean(state.reducedMotion),
      fallback: Boolean(state.failed),
      staticMode: isStaticMode(),
    },
    urls: {
      page: IS_BROWSER ? window.location.href : '',
      logo: IS_BROWSER ? LOGO_URL.href : LOGO_RELATIVE,
      modelModule: MODEL_MODULE,
      three: THREE_MODULE,
    },
  };
}

/* -------------------------------------------------------------------- api */

function updateSceneUrl(scene) {
  if (!IS_BROWSER || !window.history || typeof window.history.replaceState !== 'function') return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('scene') === scene) return;
    url.searchParams.set('scene', scene);
    window.history.replaceState(null, '', url.href);
  } catch (error) {
    /* URL reflection is best effort */
  }
}

function doSetScene(name) {
  const requested = String(name);
  if (SCENE_IDS.indexOf(requested) < 0) return false;
  const studio = state.studio;
  if (studio) {
    const active = studio.setScene(requested);
    if (!active) return false;
    state.scene = active;
    updateSceneUrl(active);
  } else {
    if (state.scene === requested) return requested;
    state.scene = requested;
    updateSceneUrl(requested);
  }
  if (dom.fallback) dom.fallback.dataset.scene = state.scene;
  if (dom.fallbackPoster) dom.fallbackPoster.dataset.scene = state.scene;
  syncSceneUi();
  syncUi();
  publishState();
  if (state.ready && !state.failed) {
    announce(SCENE_META[state.scene].stage.name + ' composition');
  }
  return state.scene;
}

function doSetPose(azimuthDeg, elevationDeg, options = {}) {
  const studio = state.studio;
  if (!studio) return null;
  const pose = studio.setPose(azimuthDeg, elevationDeg, { snap: Boolean(options.snap) });
  if (!pose) return null;
  syncPoseReadout();
  publishState();
  return pose;
}

function doReset(options = {}) {
  const announceIt = options.announceIt !== false;
  const studio = state.studio;
  if (!studio || state.failed) return false;
  const pose = studio.reset({ snap: !studio.motionAllowed() });
  if (!pose) return false;
  syncPoseReadout();
  syncUi();
  publishState();
  if (announceIt) announce('View reset to the default three-quarter pose');
  return true;
}

let readyResolve = null;
const readyPromise = new Promise((resolve) => {
  readyResolve = resolve;
});

function resolveReady(value) {
  if (readyResolve) {
    readyResolve(Boolean(value));
    readyResolve = null;
  }
}

const api = {
  version: VERSION,
  ready: false,
  errors: qa.errors,
  warnings: qa.warnings,
  debug: buildDebug,
  setScene(name) {
    return doSetScene(name);
  },
  getScene() {
    return state.scene;
  },
  reset(options) {
    return doReset(options || {});
  },
  setPose(azimuthDeg, elevationDeg, options) {
    return doSetPose(azimuthDeg, elevationDeg, options || {});
  },
  readyPromise() {
    return readyPromise;
  },
};
if (IS_BROWSER) window.__tekoLogoBlocks = api;

/* ------------------------------------------------------------------ publish */

function publishState() {
  if (!IS_BROWSER) return;
  const body = dom.body || document.body;
  if (!body) return;
  const studio = state.studio;
  const rig = studio ? studio.getActiveRig() : null;
  const facts = state.model ? sceneFacts(state.scene) : null;
  const cameraSpec = rig ? rig.spec : sceneCameraSpec(state.scene);
  const pose = rig ? rig.getPose() : { azimuthDeg: cameraSpec.azimuthDeg, elevationDeg: cameraSpec.elevationDeg };
  const objectRect = rig ? rig.getObjectRect() : null;

  body.dataset.qaReady = state.ready ? '1' : '0';
  body.dataset.qaErrors = String(qa.errors.length);
  body.dataset.qaWarnings = String(qa.warnings.length);
  body.dataset.qaWebgl = state.webgl ? '1' : '0';
  body.dataset.qaFallback = state.failed ? '1' : '0';
  body.dataset.fallback = state.failed ? '1' : '0';
  body.dataset.qaScene = state.scene;
  body.dataset.scene = state.scene;
  body.dataset.qaScenes = SCENE_IDS.join(',');
  body.dataset.qaPose = round(pose.azimuthDeg, 1) + ',' + round(pose.elevationDeg, 1);
  body.dataset.qaDefaultPose = cameraSpec.azimuthDeg + ',' + cameraSpec.elevationDeg;
  body.dataset.still = state.still ? '1' : '0';
  body.dataset.shot = state.shot ? '1' : '0';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.qaMode = state.qaMode ? '1' : 'live';
  body.dataset.qaLogo = LOGO_RELATIVE.replace(/^\.\//, '');
  if (dom.fallback) dom.fallback.dataset.scene = state.scene;
  if (dom.fallbackPoster) dom.fallbackPoster.dataset.scene = state.scene;
  if (facts) {
    body.dataset.qaTriangles = String(facts.trianglesRaw);
    body.dataset.qaBlocks = String(facts.blockCount);
    body.dataset.qaLogoShapes = String(facts.emblemShapes);
    body.dataset.qaBankIcon = String(facts.bankIconShapes);
  } else {
    body.dataset.qaTriangles = '0';
    body.dataset.qaBlocks = '0';
    body.dataset.qaLogoShapes = '0';
    body.dataset.qaBankIcon = '0';
  }
  body.dataset.qaObjectRect = objectRect
    ? [objectRect.left, objectRect.top, objectRect.width, objectRect.height].map((value) => String(value)).join(',')
    : '';
  syncPoseReadout();
  if (dom.diag && state.qaMode) {
    try {
      dom.diag.textContent = JSON.stringify(buildDebug());
    } catch (error) {
      dom.diag.textContent = '{"error":"debug serialization failed"}';
    }
  }
}

/* ---------------------------------------------------------------- fallback */

function showFallback(message, { error = null, banner = false } = {}) {
  state.failed = true;
  state.ready = false;
  state.booting = false;
  api.ready = false;
  if (error) pushError(errorMessage(error));
  if (state.studio && state.studio.raf) {
    window.cancelAnimationFrame(state.studio.raf);
    state.studio.raf = 0;
  }
  if (dom.fallback) {
    dom.fallback.hidden = false;
    dom.fallback.dataset.scene = state.scene;
  }
  if (dom.fallbackPoster) dom.fallbackPoster.dataset.scene = state.scene;
  if (dom.fallbackMessage) dom.fallbackMessage.textContent = message;
  if (dom.btnReset) dom.btnReset.disabled = true;
  if (banner && dom.errorBanner) {
    if (dom.errorText) dom.errorText.textContent = message;
    dom.errorBanner.hidden = false;
  }
  hideCurtain();
  setText(dom.infoFootState, 'Static fallback');
  setText(dom.footerStatus, 'Static fallback');
  announce('Static preview: ' + message);
  syncSceneButtons();
  publishState();
}

function probeWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return null;
    const version = gl.getParameter(gl.VERSION) || 'WebGL';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return version;
  } catch (error) {
    return null;
  }
}

/* --------------------------------------------------------------------- ui */

function wireUi() {
  if (dom.btnReset) {
    dom.btnReset.addEventListener('click', () => {
      doReset();
    });
  }
  if (dom.btnSceneStack) {
    dom.btnSceneStack.addEventListener('click', () => {
      doSetScene('stack');
    });
  }
  if (dom.btnSceneBank) {
    dom.btnSceneBank.addEventListener('click', () => {
      doSetScene('bank');
    });
  }

  // Drag-to-orbit with pointer capture; the pose is clamped inside the rig.
  let drag = null;
  const canvas = dom.canvas;
  if (canvas) {
    canvas.addEventListener('pointerdown', (event) => {
      if (!state.studio || state.failed) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      const rig = state.studio.getActiveRig();
      if (!rig) return;
      const pose = rig.getPose();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        azimuthDeg: pose.azimuthDeg,
        elevationDeg: pose.elevationDeg,
        moved: false,
      };
      state.studio.dragging = true;
      canvas.classList.add('is-dragging');
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* pointer capture is best effort */
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag || !state.studio) return;
      const rig = state.studio.getActiveRig();
      if (!rig) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      rig.setPose(drag.azimuthDeg + dx * rig.spec.dragSensitivity, drag.elevationDeg + dy * rig.spec.dragSensitivity);
      syncPoseReadout();
    });
    const endDrag = (event) => {
      if (!drag) return;
      const wasMoved = drag.moved;
      drag = null;
      if (state.studio) state.studio.dragging = false;
      canvas.classList.remove('is-dragging');
      if (event && event.pointerId !== undefined) {
        try {
          if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        } catch (error) {
          /* release is best effort */
        }
      }
      if (wasMoved) announce('Orbiting the ' + (state.scene === 'stack' ? 'stacked blocks' : 'bank plaques'));
      syncPoseReadout();
      publishState();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      doReset();
    });
    canvas.addEventListener('contextmenu', (event) => {
      if (drag) event.preventDefault();
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const studio = state.studio;
    if (!studio || state.failed) return;
    const rig = studio.getActiveRig();
    if (!rig) return;
    const pose = rig.getPose();
    const nudge = (dAzimuth, dElevation) => {
      event.preventDefault();
      rig.setPose(pose.targetAzimuthDeg + dAzimuth, pose.targetElevationDeg + dElevation, {
        snap: !studio.motionAllowed(),
      });
      syncPoseReadout();
      publishState();
    };
    if (event.key === '1') {
      event.preventDefault();
      doSetScene('stack');
    } else if (event.key === '2') {
      event.preventDefault();
      doSetScene('bank');
    } else if (event.key === 'r' || event.key === 'R') {
      if (target === dom.btnReset) return;
      event.preventDefault();
      doReset();
    } else if (event.key === 'ArrowLeft') {
      nudge(-ORBIT.nudgeDeg, 0);
    } else if (event.key === 'ArrowRight') {
      nudge(ORBIT.nudgeDeg, 0);
    } else if (event.key === 'ArrowUp') {
      nudge(0, ORBIT.nudgeDeg);
    } else if (event.key === 'ArrowDown') {
      nudge(0, -ORBIT.nudgeDeg);
    } else if (event.key === 'Home') {
      event.preventDefault();
      doReset();
    }
  });

  if (reducedMotionQuery) {
    const onChange = (event) => {
      state.reducedMotion = Boolean(event.matches);
      if (state.studio) {
        state.studio.reducedMotion = state.reducedMotion;
        if (state.reducedMotion) {
          const rig = state.studio.getActiveRig();
          if (rig) rig.applyPose({ snap: true });
        }
      }
      if (dom.body) dom.body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
      syncUi();
      publishState();
    };
    if (typeof reducedMotionQuery.addEventListener === 'function') reducedMotionQuery.addEventListener('change', onChange);
    else if (typeof reducedMotionQuery.addListener === 'function') reducedMotionQuery.addListener(onChange);
  }
}

/* ------------------------------------------------------------------ fonts */

async function waitForFonts() {
  if (!IS_BROWSER || !document.fonts) return;
  const timeout = () => new Promise((resolve) => window.setTimeout(resolve, 1200));
  try {
    if (typeof document.fonts.load === 'function') {
      await Promise.race([
        Promise.all([
          document.fonts.load('300 30px Lexend').catch(() => {}),
          document.fonts.load('600 14px Lexend').catch(() => {}),
        ]),
        timeout(),
      ]);
    }
  } catch (error) {
    /* font preload is best effort */
  }
  try {
    await Promise.race([document.fonts.ready, timeout()]);
  } catch (error) {
    /* layout stability only */
  }
}

/* ------------------------------------------------------------------- logo */

async function loadLogoSvg() {
  curtainProgress(0.16, 'Loading TEKO emblem', '0 / 0');
  const response = await fetch(LOGO_URL.href, { cache: 'no-store' });
  if (!response.ok) throw new Error('emblem request failed with HTTP ' + response.status);
  const svgText = await response.text();
  if (!/<svg[\s>]/i.test(svgText) || !/<path[\s>]/i.test(svgText)) {
    throw new Error('emblem asset is not an SVG path artwork');
  }
  state.logoBytes = svgText.length;
  return svgText;
}

/* ------------------------------------------------------------------- boot */

function createStudio() {
  const studio = new LogoBlocksStudio({
    canvas: dom.canvas,
    stage: dom.stage,
    model: state.model,
    reducedMotion: state.reducedMotion,
    still: state.still,
    shot: state.shot,
  });
  studio.onChange = () => {
    syncPoseReadout();
    publishState();
  };
  return studio;
}

async function boot() {
  state.booting = true;
  api.ready = false;

  if (dom.body) {
    dom.body.dataset.fallback = '0';
    dom.body.dataset.qaFallback = '0';
    dom.body.dataset.qaReady = '0';
    dom.body.dataset.qaScene = state.scene;
    dom.body.dataset.scene = state.scene;
    dom.body.dataset.qaScenes = SCENE_IDS.join(',');
    dom.body.dataset.qaMode = state.qaMode ? '1' : 'live';
    dom.body.dataset.still = state.still ? '1' : '0';
    dom.body.dataset.shot = state.shot ? '1' : '0';
    dom.body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  }
  syncSceneUi();
  syncUi();
  publishState();

  if (state.qaMode) {
    if (dom.curtain) dom.curtain.hidden = true;
    if (dom.stageVeil) dom.stageVeil.hidden = true;
  }

  curtainProgress(0.04, 'Detecting WebGL', '0 / 0');
  const webgl = probeWebGL();
  state.webgl = webgl;
  qa.webgl = webgl;
  if (!webgl) {
    showFallback(
      'WebGL is not available in this browser, so the interactive logo-block studio cannot be rendered. A static preview of the composition is shown below.',
    );
    resolveReady(false);
    return;
  }

  curtainProgress(0.1, 'Loading type', '');
  await waitForFonts();

  let svgText = null;
  try {
    svgText = await loadLogoSvg();
  } catch (error) {
    showFallback(
      'The TEKO emblem asset could not be loaded (' + errorMessage(error) + '), so the logo-block studio cannot be built. A static preview is shown below.',
      { error, banner: true },
    );
    resolveReady(false);
    return;
  }

  curtainProgress(0.42, 'Building both compositions', '');
  await nextFrame();
  let model = null;
  try {
    model = MODEL.createLogoBlocksModel({ logoSvgText: svgText, logoSourcePath: LOGO_RELATIVE });
    state.model = model;
  } catch (error) {
    showFallback('The logo-block model could not be built (' + errorMessage(error) + '). A static preview is shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }
  if (!model || !model.scenes || !model.scenes.stack || !model.scenes.bank || !model.scenes.stack.group || !model.scenes.bank.group) {
    showFallback('The logo-block model did not produce both compositions.');
    resolveReady(false);
    return;
  }
  if (Array.isArray(model.warnings) && model.warnings.length > 0) {
    for (const warning of model.warnings) pushWarning('model: ' + warning);
  }

  curtainProgress(0.62, 'Building studio environments', '');
  await nextFrame();
  try {
    state.studio = createStudio();
    await state.studio.init();
    const contextLost = (event) => {
      event.preventDefault();
      if (state.failed) return;
      showFallback('WebGL context was lost, so a static preview of the composition is shown below.');
      resolveReady(false);
    };
    if (dom.canvas) dom.canvas.addEventListener('webglcontextlost', contextLost, false);
    state.contextLostHandler = contextLost;
  } catch (error) {
    if (state.studio) {
      try {
        state.studio.dispose();
      } catch (disposeError) {
        /* best effort */
      }
      state.studio = null;
    }
    showFallback('The three.js studio could not start (' + errorMessage(error) + '). A static preview is shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }

  curtainProgress(0.8, 'Fitting the cameras', '');
  const studio = state.studio;
  studio.still = state.still;
  studio.shot = state.shot;
  studio.reducedMotion = state.reducedMotion;
  studio.setScene(state.scene);
  if (state.poseRequested) {
    studio.setPose(state.poseRequested.azimuthDeg, state.poseRequested.elevationDeg, { snap: true });
  }

  curtainProgress(0.92, 'Rendering the studio', '');
  studio.resize();
  studio.renderNow();
  await studio.whenFirstFrame();

  curtainProgress(1, 'Ready', '');
  hideCurtain();
  state.ready = true;
  state.booting = false;
  api.ready = true;
  window.clearTimeout(state.watchdog);
  syncSceneUi();
  syncUi();
  publishState();
  announce('Logo block studio ready \u2014 ' + SCENE_META[state.scene].stage.name);
  studio.renderNow();
  resolveReady(true);
}

/* -------------------------------------------------------------------- main */

function main() {
  initDom();
  if (!dom.stage || !dom.canvas) {
    showFallback('The preview stage markup is missing, so a static preview is shown below.');
    resolveReady(false);
    return;
  }
  if (dom.body) {
    dom.body.dataset.qaScenes = SCENE_IDS.join(',');
    dom.body.dataset.qaScene = state.scene;
    dom.body.dataset.scene = state.scene;
  }
  showStageBusy();
  wireUi();
  syncSceneUi();
  syncUi();
  publishState();

  boot().catch((error) => {
    if (!state.failed) {
      showFallback('The logo-block preview failed to start (' + errorMessage(error) + '). A static preview is shown below.', { error, banner: true });
    }
    resolveReady(false);
  });

  state.watchdog = window.setTimeout(() => {
    if (!state.ready && !state.failed) {
      showFallback('The interactive preview did not start within 20 seconds. A static preview is shown below.', { banner: true });
      resolveReady(false);
    }
  }, 20000);

  state.publishTimer = window.setInterval(() => {
    if (state.failed) return;
    publishState();
  }, 400);

  window.addEventListener('pagehide', () => {
    window.clearTimeout(state.watchdog);
    window.clearInterval(state.publishTimer);
    if (state.contextLostHandler && dom.canvas) {
      dom.canvas.removeEventListener('webglcontextlost', state.contextLostHandler, false);
      state.contextLostHandler = null;
    }
    if (state.studio) {
      state.studio.dispose();
      state.studio = null;
    }
    if (state.model) {
      try {
        state.model.dispose();
      } catch (error) {
        /* best effort */
      }
      state.model = null;
    }
  });
}

if (IS_BROWSER) main();

export { VERSION, LogoBlocksStudio, LogoBlocksRig };
