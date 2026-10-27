/**
 * tekoanimation — Billing documents preview controller (round 5, model v3).
 *
 * Standalone collection page controller for `billing.html` (docs/billing-contract.md):
 * a dark editorial three.js studio showing SEVEN rounded-rect paper sheets FACE DOWN
 * in a horizontal stack above the COLUMNS DELIVERABLE'S SATIN COLUMN. The camera
 * (fixed 45° three-quarter) sees the blank paper backs; each sheet carries:
 *   - a paper face that is OPAQUE for the two white and two gold sheets and stays
 *     translucent for the three grey-blue PCB sheets (round 5);
 *   - ONE unified abstract text-mockup pattern (identical on every sheet; only the
 *     ink tone differs) rendered as a SEPARATE floating layer a small offset ABOVE
 *     the paper — not baked into the paper albedo;
 *   - a treatment-tinted additive underlight glow card below the sheet.
 * There is no readable text anywhere: no words, numbers, amounts, codes or logos,
 * only abstract text-line bars, rules, dot fields and rounded chips.
 *
 * Support: the columns deliverable's satin column instance
 * (`createColumns(bank).columnsById['satin-large-long']`) is reused as the pedestal,
 * rescaled to the billing footprint and deliberately run past the bottom of the
 * stage (cropped) so the paper stack keeps its round-4 scale. The satin material is
 * `loadColumnBank().materials.satin` cloned, so it inherits the current satin grain
 * + the page's captured blurred studio reflection.
 *
 * Camera: fixed 45° three-quarter (azimuth 45°, elevation 19°), numerically fitted
 * to the expanded stack + the support's visible top band at every stage aspect
 * (1440x900 / 1200x900 / 390x844). The off-frame column base is never framed.
 *
 * Animation: the condensed pile on the right unfolds upward (right -> left,
 * staggered, ease-in-out) ONCE when the stage enters the viewport (IO threshold
 * 0.35). Replay button / Space / window.__tekoBilling.play()/replay(). Reduced
 * motion, ?still=1 and ?shot=1 show the final expanded frame deterministically;
 * ?play=0 shows the condensed initial state (see docs/billing.md).
 *
 * Light from below: besides the per-sheet underlight cards owned by the model, the
 * studio adds one soft additive underlight pool on the support's top face so the
 * light source reads in the gap under the stack. There is no point light (a close
 * point light blew the satin support out to pure white).
 *
 * QA hook: window.__tekoBilling = { ready, errors, play(), replay(), debug() }
 * plus body[data-qa-*] attributes and the hidden #qa-diag JSON mirror.
 */
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import * as BillingModel from './billing-model.js';

const VERSION = '3.0.0';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ------------------------------------------------------------------ spec */

const MODEL = BillingModel;
const CAMERA = MODEL.CAMERA_SPEC;
const SHEET_COUNT = MODEL.SHEET_COUNT;
const SUPPORT = MODEL.SUPPORT_SPEC;

// Columns material bank (read-only dependency; the satin material is cloned).
const COLUMN_MODEL_URL = new URL('./columns-model.js', import.meta.url);
const COLUMN_ASSET_BASE = './assets/textures/materials';
const SATIN_TILE_FALLBACK = 260;

/* ------------------------------------------------------------ render tuning */

const RENDERER = Object.freeze({ exposure: 0.98, dprMax: 2 });
// Same damping language as the columns studio: a damped RoomEnvironment plus a
// few HDR softbox panels (their solid angle is small, so they read as clean
// rectangular reflections on the satin instead of a flat ambient wash).
const ENVIRONMENT = Object.freeze({
  lightScale: 0.3,
  panelScale: 0.26,
  softboxScale: 1.2,
  // 0.03 stays under three.js' 20-sample PMREM blur limit (0.05 logs a
  // "sigmaRadians is too large" console warning, which the collection pages must
  // not produce); the studio is still softly diffused.
  sigma: 0.03,
});
const SOFTBOXES = Object.freeze([
  Object.freeze({ position: [-14, 10, 11], lookAt: [0, 4, 0], scale: [7, 5], color: 0xfff0df, intensity: 9 }),
  Object.freeze({ position: [12, 6, 9], lookAt: [0, 3, 0], scale: [5, 6], color: 0xa9c3e2, intensity: 5 }),
  Object.freeze({ position: [2, 8, -14], lookAt: [0, 4, 0], scale: [13, 2], color: 0xe4edf8, intensity: 12 }),
  // Satin blur accents: soft warm/cool blobs in the reflection only (the
  // environment is not part of the rendered scene), echoing the columns satin's
  // warm/cool reflection language.
  Object.freeze({ position: [15, 5, -9], lookAt: [0, 3, 0], scale: [8, 3.4], color: 0xff8a3d, intensity: 3.2 }),
  Object.freeze({ position: [-13, 8, -6], lookAt: [0, 4, 0], scale: [6, 4], color: 0x9fb8d8, intensity: 1.6 }),
]);
const LIGHTS = Object.freeze({
  key: { color: 0xfff0df, intensity: 1.45, position: [-620, 900, 760], target: [0, 280, 0] },
  fill: { color: 0xa9c3e2, intensity: 0.8, position: [820, 420, 520], target: [0, 260, 0] },
  rim: { color: 0xe4edf8, intensity: 2.4, position: [300, 640, -820], target: [0, 320, 0] },
  ambient: { color: 0x3a4552, intensity: 0.32 },
});
// Round 5: the reused satin column IS the pedestal and it runs out of the bottom
// of the stage, so there is no floor plane and no baked contact shadow any more —
// a floor ellipse would intersect the column it is supposed to stand on. The stage
// CSS aura is the only studio bed; the underlight pool stays on the support top.
// Light from below the stack: each sheet carries its own treatment-tinted additive
// underlight glow card (billing-model.js). The studio adds only a soft additive
// pool where that light spills onto the satin column's top face. Deliberately NO
// close point light: the satin clone is metalness 1 / envMapIntensity 2.4 and a
// point light just above the support top blew the whole support pure white
// (verified by isolation in round 4). The pool is placed between the condensed
// pile and the expanded bottom sheet so both animation states stay lit.
const UNDERLIGHT = Object.freeze({
  pool: Object.freeze({
    radius: 250,
    depthScale: 0.6,
    y: MODEL.SUPPORT_SPEC.topY + 1.6,
    color: 0xfff3e4,
    opacity: 0.16,
  }),
});
const IDLE = Object.freeze({ amplitude: 2.4, periodA: 7.6, periodB: 4.3, phaseB: 1.15, settleMs: 420 });
// Satin blurred-reflection capture (the same technique the columns preview uses
// for its satin material): one deterministic CubeCamera capture of the studio
// around the pedestal, PMREM-filtered and assigned as the satin clone's envMap,
// so the pedestal reflects the sheets and the dark stage as soft blobs instead of
// the bright room environment that would read as hammered white metal.
const SATIN_REFLECTION = Object.freeze({
  layer: 1,
  cubeSize: 256,
  near: 20,
  far: 12000,
  centerY: 150,
  accents: Object.freeze([
    // Broad neutral studio fill behind the reused column (reflection only): the
    // column is metalness ~1, so without a mid-grey backdrop its large vertical
    // faces reflect the black stage and read as a dark slab. These panels keep the
    // columns-satin grey/grain readable at the thicker billing scale.
    Object.freeze({ position: [-2400, 520, -2000], size: [3400, 2000], color: 0x8fa0b4, intensity: 1.2 }),
    Object.freeze({ position: [-1500, 260, 1800], size: [2200, 1200], color: 0x7f8fa2, intensity: 0.85 }),
    // Low "floor bounce" panels: a vertical face seen from the 19° camera reflects
    // DOWNWARD (the ground direction), so the big satin faces only light up with
    // something below them. Reflection-only, above the stage floor — nothing here
    // is visible in the rendered scene.
    Object.freeze({ position: [2400, -900, -1500], size: [3200, 1600], color: 0x8a9aad, intensity: 0.95 }),
    Object.freeze({ position: [-1900, -900, 2100], size: [3200, 1600], color: 0x8090a3, intensity: 0.85 }),
    // Warm accent reflected off the pedestal's front/right faces.
    Object.freeze({ position: [1500, 620, 900], size: [900, 520], color: 0xff7a2a, intensity: 3.2 }),
    // Cool steel accent from the left.
    Object.freeze({ position: [-1400, 760, -400], size: [760, 460], color: 0x9fb8d8, intensity: 1.8 }),
    // Low warm band behind the pedestal, echoing the orange sheet.
    Object.freeze({ position: [500, 260, -1200], size: [1100, 220], color: 0xff6a10, intensity: 2.6 }),
  ]),
});

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
const degToRad = (deg) => (deg * Math.PI) / 180;
const radToDeg = (rad) => (rad * 180) / Math.PI;
const round = (value, digits = 2) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};
const easeInOutCubic = MODEL.easeInOutCubic;

const srgbToLinear = (value) => (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
function srgbColor(hex) {
  const color = new THREE.Color();
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  if (THREE.ColorManagement && THREE.ColorManagement.enabled) color.setHex(hex);
  else color.setRGB(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  return color;
}

function errorMessage(error) {
  if (!error) return 'Unknown error';
  const message = error.message ? String(error.message) : String(error);
  return message.length > 240 ? message.slice(0, 237) + '...' : message;
}

function viewDirection(azimuthDeg, elevationDeg) {
  const azimuth = degToRad(azimuthDeg);
  const elevation = degToRad(elevationDeg);
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ).normalize();
}

function boundsCorners(bounds) {
  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  return corners;
}

/* ------------------------------------------------------------- early qa state */

const qa = IS_BROWSER
  ? (window.__TEKO_BILLING_QA = window.__TEKO_BILLING_QA || { errors: [], warnings: [], webgl: null })
  : { errors: [], warnings: [], webgl: null };
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];

function pushError(message) {
  qa.errors.push('billing-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}

function pushWarning(message) {
  qa.warnings.push('billing-preview: ' + message);
  if (qa.warnings.length > 60) qa.warnings.splice(0, qa.warnings.length - 60);
}

const urlParams = IS_BROWSER ? new URLSearchParams(window.location.search) : new URLSearchParams();
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
  bank: null,
  columns: null,
  columnInstance: null,
  columnGeometry: null,
  model: null,
  studio: null,
  satinSource: 'unknown',
  supportSource: 'unknown',
  satinTilePx: SATIN_TILE_FALLBACK,
  still: urlParams.get('still') === '1',
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  playParam: urlParams.get('play'),
  reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches),
  autoplay: false,
  viewObserver: null,
  watchStartedAt: 0,
  watchdog: 0,
  bootStartedAt: 0,
};

/** Static/deterministic modes never animate or idle-float (contract B4). */
function isStaticMode() {
  return state.still || state.shot || state.reducedMotion;
}

function curtainProgress(ratio, label, count, title) {
  const safeRatio = clamp(Number(ratio) || 0, 0, 1);
  if (dom.loadingBar) dom.loadingBar.style.width = (safeRatio * 100).toFixed(1) + '%';
  if (label && dom.loadingLabel) dom.loadingLabel.textContent = label;
  if (count !== undefined && dom.loadingCount) dom.loadingCount.textContent = String(count);
  if (title && dom.loadingTitle) dom.loadingTitle.textContent = title;
}

function hideCurtain() {
  if (!dom.curtain) return;
  dom.curtain.classList.add('is-hidden');
  dom.curtain.setAttribute('aria-hidden', 'true');
  if (state.still || state.shot || state.reducedMotion || state.qaMode) {
    dom.curtain.hidden = true;
    return;
  }
  window.setTimeout(() => {
    dom.curtain.hidden = true;
  }, 700);
}

function announce(message) {
  if (dom.liveStatus) dom.liveStatus.textContent = message;
}

/* ------------------------------------------------------------------- dom */

const dom = {};

function initDom() {
  const byId = (id) => document.getElementById(id);
  dom.body = document.body;
  dom.page = byId('page');
  dom.stage = byId('stage');
  dom.canvas = byId('stage-canvas');
  dom.stageEyebrow = byId('stage-eyebrow-text');
  dom.stageIndex = byId('stage-index');
  dom.stageCode = byId('stage-code');
  dom.stageName = byId('stage-name');
  dom.stageDetail = byId('stage-detail');
  dom.stageHint = byId('stage-hint');
  dom.stageVeil = byId('stage-veil');
  dom.veilText = byId('veil-text');
  dom.btnReplay = byId('btn-replay');
  dom.replayState = byId('replay-state');
  dom.infoFootState = byId('info-foot-state');
  dom.footerStatus = byId('footer-status');
  dom.specSatinMetalness = byId('spec-satin-metalness');
  dom.specSatinRoughness = byId('spec-satin-roughness');
  dom.specSatinEnv = byId('spec-satin-env');
  dom.specSatinSource = byId('spec-satin-source');
  dom.specSheetSize = byId('spec-sheet-size');
  dom.specTreatments = byId('spec-treatments');
  dom.specUnderlight = byId('spec-underlight');
  dom.specFaces = byId('spec-faces');
  dom.specMockup = byId('spec-mockup');
  dom.specSupport = byId('spec-support');
  dom.specCamera = byId('spec-camera');
  dom.specAnimation = byId('spec-animation');
  dom.assetNote = byId('asset-note');
  dom.curtain = byId('loading');
  dom.loadingBar = byId('loading-bar');
  dom.loadingTitle = byId('loading-title');
  dom.loadingLabel = byId('loading-label');
  dom.loadingCount = byId('loading-count');
  dom.errorBanner = byId('error-banner');
  dom.errorText = byId('error-text');
  dom.fallback = byId('fallback');
  dom.fallbackMessage = byId('fallback-message');
  dom.liveStatus = byId('live-status');
  dom.diag = byId('qa-diag');
}

function syncUi() {
  const studio = state.studio;
  const animation = studio ? studio.getAnimationDebug() : { playing: false, progress: 0, phase: state.playParam === '0' ? 'condensed' : 'intro' };
  const expanded = Boolean(studio && studio.expanded);
  const condensed = Boolean(studio && studio.condensed) && !expanded;

  if (dom.btnReplay) dom.btnReplay.disabled = !state.ready || state.failed;
  if (dom.replayState) {
    dom.replayState.textContent = animation.playing ? 'Unfolding' : expanded ? 'Expanded' : condensed ? 'Condensed' : 'Ready';
  }
  if (dom.infoFootState) {
    dom.infoFootState.textContent = state.failed
      ? 'Static fallback'
      : animation.playing
        ? 'Unfolding · ' + Math.round(animation.progress * 100) + '%'
        : expanded
          ? 'Expanded · held'
          : condensed
            ? 'Condensed stack'
            : 'Preparing';
  }
  if (dom.footerStatus) {
    dom.footerStatus.textContent = state.failed ? 'Static fallback' : state.ready ? (expanded ? 'Ready' : condensed ? 'Condensed' : 'Ready') : 'Loading';
  }
  if (dom.stageHint) {
    dom.stageHint.textContent = expanded ? 'Replay to unfold again' : animation.playing ? 'Unfolding documents' : 'Press Space to unfold';
  }
}

function syncObjectFacts() {
  const model = state.model;
  if (!model) return;
  const values = model.satin.values;
  if (dom.specSheetSize) dom.specSheetSize.textContent = MODEL.SHEET_SPEC.width + ' × ' + MODEL.SHEET_SPEC.height + ' px';
  const counts = model.treatments || null;
  if (dom.specTreatments && counts) {
    dom.specTreatments.textContent = counts.white + ' white · ' + counts.gold + ' gold · ' + counts.pcb + ' PCB';
  }
  if (dom.specUnderlight && MODEL.TREATMENTS) {
    dom.specUnderlight.textContent = MODEL.TREATMENTS.map((treatment) => treatment.lightId).join(' · ');
  }
  if (dom.specFaces && Array.isArray(model.sheets)) {
    const opaque = model.sheets.filter((sheet) => sheet.face === 'opaque').length;
    const translucent = model.sheets.filter((sheet) => sheet.face === 'translucent').length;
    dom.specFaces.textContent =
      (opaque ? model.sheets.filter((sheet) => sheet.face === 'opaque').map((sheet) => sheet.treatment).filter((value, index, list) => list.indexOf(value) === index).join(' + ') + ' opaque' : 'none opaque') +
      ' · ' + translucent + ' PCB translucent';
  }
  if (dom.specMockup && model.mockup) {
    dom.specMockup.textContent = 'unified · floating +' + model.mockup.lift + ' px · no text';
  }
  if (dom.specSatinSource) {
    dom.specSatinSource.textContent = state.supportSource === 'columns-satin-column' ? 'Columns satin column' : 'None (columns unavailable)';
  }
  if (dom.specSupport && model.supportInfo) {
    const scale = model.supportInfo.scale;
    dom.specSupport.textContent =
      model.supportInfo.columnId + ' · ×' + Number(scale.x).toFixed(2) + ' / ×' + Number(scale.z).toFixed(2) + ' · cropped';
  } else if (dom.specSupport) {
    dom.specSupport.textContent = 'none · paper stack floats';
  }
  if (dom.specSatinMetalness && values.metalness !== null) dom.specSatinMetalness.textContent = Number(values.metalness).toFixed(2);
  if (dom.specSatinRoughness && values.roughness !== null) dom.specSatinRoughness.textContent = Number(values.roughness).toFixed(2);
  if (dom.specSatinEnv && values.envMapIntensity !== null) dom.specSatinEnv.textContent = Number(values.envMapIntensity).toFixed(2);
  if (dom.specCamera) {
    dom.specCamera.textContent = MODEL.CAMERA_SPEC.azimuthDeg + '° / ' + MODEL.CAMERA_SPEC.elevationDeg + '° three-quarter';
  }
  if (dom.specAnimation) {
    const durationMs = MODEL.ANIMATION_SPEC.sheetDelayMs + (SHEET_COUNT - 1) * MODEL.ANIMATION_SPEC.staggerMs + MODEL.ANIMATION_SPEC.sheetDurationMs;
    dom.specAnimation.textContent = (durationMs / 1000).toFixed(1) + ' s unfold · once';
  }
  if (dom.assetNote) {
    dom.assetNote.textContent =
      state.supportSource === 'columns-satin-column'
        ? 'Seven paper sheets · floating text mockup · columns satin column · no network'
        : 'Seven paper sheets · floating text mockup · columns satin unavailable (no support) · no network';
  }
}

/** Publish the body data-qa-* state that the capture/QA harness reads. */
function publishState() {
  if (!IS_BROWSER) return;
  const body = dom.body || document.body;
  const studio = state.studio;
  const animation = studio ? studio.getAnimationDebug() : null;
  const camera = studio ? studio.getCameraDebug() : null;
  const expanded = Boolean(studio && studio.expanded);
  const phase = animation ? animation.phase : state.playParam === '0' ? 'condensed' : 'intro';
  body.dataset.qaReady = state.ready ? '1' : '0';
  body.dataset.qaErrors = String(qa.errors.length);
  body.dataset.qaWarnings = String(qa.warnings.length);
  body.dataset.qaWebgl = state.webgl ? '1' : '0';
  body.dataset.qaFallback = state.failed ? '1' : '0';
  body.dataset.qaAnimation = animation && animation.playing ? 'playing' : expanded ? 'expanded' : phase === 'condensed' ? 'condensed' : 'intro';
  body.dataset.qaExpanded = expanded ? '1' : '0';
  body.dataset.qaPlaying = animation && animation.playing ? '1' : '0';
  body.dataset.qaProgress = String(round(animation ? animation.progress : 0, 3));
  body.dataset.qaPlayedOnce = animation && animation.playedOnce ? '1' : '0';
  body.dataset.qaSheets = String(SHEET_COUNT);
  body.dataset.qaLayers = String(SHEET_COUNT);
  if (MODEL.TREATMENTS) {
    const counts = (state.model && state.model.treatments) || null;
    body.dataset.qaTreatments = MODEL.TREATMENTS.map(
      (treatment) => treatment.id + ':' + (counts && counts[treatment.id] !== undefined ? counts[treatment.id] : treatment.count),
    ).join(',');
    body.dataset.qaUnderlight = MODEL.TREATMENTS.map((treatment) => treatment.lightId || treatment.id).join(',');
  }
  if (body.dataset.qaWarmSheet !== undefined) delete body.dataset.qaWarmSheet;
  body.dataset.qaSatin = state.satinSource;
  body.dataset.qaSupport = state.supportSource;
  if (state.model && Array.isArray(state.model.sheets)) {
    body.dataset.qaMockup = state.model.mockup && state.model.mockup.unified ? 'unified' : 'unknown';
    body.dataset.qaMockupLift = String(round(state.model.mockup ? state.model.mockup.lift : 0, 2));
    body.dataset.qaFaces = state.model.sheets.map((sheet) => sheet.face || 'unknown').join(',');
  } else {
    body.dataset.qaMockup = 'unknown';
    body.dataset.qaMockupLift = '';
    body.dataset.qaFaces = '';
  }
  body.dataset.qaCamera = camera ? round(camera.azimuthDeg, 1) + ',' + round(camera.elevationDeg, 1) : '';
  body.dataset.qaDistance = camera ? String(round(camera.distance, 1)) : '';
  const objectRect = studio ? studio.getObjectScreenRect() : null;
  body.dataset.qaObjectRect = objectRect
    ? [objectRect.left, objectRect.top, objectRect.width, objectRect.height]
        .map((value) => String(round(value, 1)))
        .join(',')
    : '';
  body.dataset.still = state.still ? '1' : '0';
  body.dataset.shot = state.shot ? '1' : '0';
  body.dataset.qaMode = state.qaMode ? '1' : '0';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.play = state.playParam !== null ? state.playParam : 'auto';
  if (dom.diag) {
    try {
      dom.diag.textContent = JSON.stringify(buildDebug());
    } catch (error) {
      dom.diag.textContent = '{"error":"debug serialization failed"}';
    }
  }
}

/* ---------------------------------------------------------------- the studio */

class BillingStudio {
  constructor({ canvas, stage, model, reducedMotion = false, still = false, shot = false }) {
    this.canvas = canvas;
    this.stage = stage;
    this.model = model;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.envRT = null;
    this.lights = {};
    this.underlightPool = null;
    this.underlightAnchor = null;
    this.satinReflectionAccents = null;
    this.satinEnvRT = null;
    this.satinCubeRT = null;
    this.satinReflectionCaptured = false;
    this.stageBox = { width: 0, height: 0 };
    this.cameraTarget = new THREE.Vector3();
    this.cameraDistance = 0;
    this.renderCount = 0;
    this.firstFrameResolve = null;
    this.firstFrameRendered = false;
    this.needsRender = true;
    this.raf = 0;
    this.lastTime = 0;
    this.destroyed = false;
    this.reducedMotion = Boolean(reducedMotion);
    this.still = Boolean(still);
    this.shot = Boolean(shot);
    this.idleTime = 0;
    this.settleTime = 0;
    this.expanded = false;
    this.condensed = true;
    this.onChange = null;
    this.resizeObserver = null;

    this.animation = {
      playing: false,
      playedOnce: false,
      progress: 0,
      phase: 'intro',
      elapsed: 0,
      total: 0,
      gather: 0,
      startPoses: null,
      sheetStartPoses: null,
      settled: false,
    };
  }

  motionAllowed() {
    return !this.still && !this.shot && !this.reducedMotion;
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

    const scene = new THREE.Scene();
    scene.name = 'billing-studio';
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.5, CAMERA.near, CAMERA.far);
    camera.name = 'billing-camera';
    this.camera = camera;

    this.buildEnvironment();

    const key = new THREE.DirectionalLight(LIGHTS.key.color, LIGHTS.key.intensity);
    key.position.set(LIGHTS.key.position[0], LIGHTS.key.position[1], LIGHTS.key.position[2]);
    key.target.position.set(LIGHTS.key.target[0], LIGHTS.key.target[1], LIGHTS.key.target[2]);
    scene.add(key);
    scene.add(key.target);
    this.lights.key = key;

    const fill = new THREE.DirectionalLight(LIGHTS.fill.color, LIGHTS.fill.intensity);
    fill.position.set(LIGHTS.fill.position[0], LIGHTS.fill.position[1], LIGHTS.fill.position[2]);
    fill.target.position.set(LIGHTS.fill.target[0], LIGHTS.fill.target[1], LIGHTS.fill.target[2]);
    scene.add(fill);
    scene.add(fill.target);
    this.lights.fill = fill;

    const rim = new THREE.DirectionalLight(LIGHTS.rim.color, LIGHTS.rim.intensity);
    rim.position.set(LIGHTS.rim.position[0], LIGHTS.rim.position[1], LIGHTS.rim.position[2]);
    rim.target.position.set(LIGHTS.rim.target[0], LIGHTS.rim.target[1], LIGHTS.rim.target[2]);
    scene.add(rim);
    scene.add(rim.target);
    this.lights.rim = rim;

    const ambient = new THREE.AmbientLight(LIGHTS.ambient.color, LIGHTS.ambient.intensity);
    scene.add(ambient);
    this.lights.ambient = ambient;

    this.buildUnderlight();

    scene.add(this.model.root);
    // Capture the satin column's blurred studio reflection while the stack is in
    // its final expanded pose (the deterministic / captured state).
    this.captureSatinReflection();
    this.applyStaticPose('condensed');

    this.resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.stage);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
    this.resize();

    this.loop = this.loop.bind(this);
    this.raf = window.requestAnimationFrame(this.loop);
    return this;
  }

  /** Damped RoomEnvironment + HDR softbox panels -> PMREM scene environment. */
  buildEnvironment() {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    const room = new RoomEnvironment();
    room.traverse((object) => {
      if (object.isLight && typeof object.intensity === 'number') object.intensity *= ENVIRONMENT.lightScale;
      if (object.isMesh && object.material && object.material.isMeshBasicMaterial && object.material.color && typeof object.material.color.multiplyScalar === 'function') {
        object.material.color.multiplyScalar(ENVIRONMENT.panelScale);
      }
    });
    for (const panel of SOFTBOXES) {
      const material = new THREE.MeshBasicMaterial({
        color: srgbColor(panel.color).multiplyScalar(panel.intensity * ENVIRONMENT.softboxScale),
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);
      mesh.lookAt(panel.lookAt[0], panel.lookAt[1], panel.lookAt[2]);
      mesh.scale.set(panel.scale[0], panel.scale[1], 1);
      room.add(mesh);
    }
    if (this.envRT) this.envRT.dispose();
    this.envRT = pmremGenerator.fromScene(room, ENVIRONMENT.sigma);
    this.scene.environment = this.envRT.texture;
    room.dispose();
    pmremGenerator.dispose();
  }

  /**
   * Round-5 light from below the stack: a soft additive pool on the reused satin
   * column's top face. The per-sheet white/gold/cool glow cards are owned by the
   * model; this pool only shows that light spilling onto the support so the source
   * reads in the gap under the paper stack. No point light on purpose — see the
   * UNDERLIGHT comment (satin blow-out).
   */
  buildUnderlight() {
    const model = this.model;
    if (!model || !Array.isArray(model.sheets) || !model.sheets.length) return null;
    const first = model.sheets[0];
    const expanded = first && first.expanded ? first.expanded.position : { x: SUPPORT.centerX, z: SUPPORT.centerZ };
    const condensed = first && first.condensed ? first.condensed.position : expanded;
    const x = (expanded.x + condensed.x) / 2;
    const z = (expanded.z + condensed.z) / 2;
    this.underlightAnchor = { x, z };

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(0.22, 'rgba(255, 250, 242, 0.55)');
    gradient.addColorStop(0.52, 'rgba(255, 244, 230, 0.22)');
    gradient.addColorStop(0.78, 'rgba(255, 240, 224, 0.06)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'billing-underlight-pool';
    texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    texture.userData = { role: 'underlight-pool', procedural: true, local: true };
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: srgbColor(UNDERLIGHT.pool.color),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: UNDERLIGHT.pool.opacity,
    });
    const geometry = new THREE.CircleGeometry(UNDERLIGHT.pool.radius, 96);
    const pool = new THREE.Mesh(geometry, material);
    pool.name = 'studio-underlight-pool';
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(1, UNDERLIGHT.pool.depthScale, 1);
    pool.position.set(x, UNDERLIGHT.pool.y, z);
    pool.renderOrder = 1;
    this.scene.add(pool);
    this.underlightPool = pool;
    return pool;
  }

  getUnderlightDebug() {
    const pool = this.underlightPool || null;
    return {
      type: 'additive-pool',
      // The white/gold/cool light itself comes from the model's seven additive
      // underlight cards; the pool is only the studio spill on the plinth.
      glowCards: this.model && Array.isArray(this.model.sheets) ? this.model.sheets.length : 0,
      colors: this.model && this.model.treatments ? this.model.treatments : null,
      anchor: this.underlightAnchor ? [round(this.underlightAnchor.x, 2), round(this.underlightAnchor.z, 2)] : null,
      pool: pool
        ? {
            color: pool.material.color && typeof pool.material.color.getHexString === 'function' ? '#' + pool.material.color.getHexString() : null,
            opacity: round(pool.material.opacity, 3),
            radius: UNDERLIGHT.pool.radius,
            depthScale: UNDERLIGHT.pool.depthScale,
            y: UNDERLIGHT.pool.y,
            additive: pool.material.blending === THREE.AdditiveBlending,
          }
        : null,
    };
  }

  requestRender() {
    this.needsRender = true;
  }

  /**
   * Deterministic satin reflection capture, the same technique the columns
   * preview uses for its satin material: render a cube map of the studio from
   * just above the reused satin column's top face (sheet colours above, dark stage
   * around, plus a few reflection-only warm/cool accent panels), PMREM-filter it
   * and assign it as the cloned satin material's envMap. The support then shows the
   * current columns satin grain over a soft studio reflection instead of the bright
   * room environment (which read as hammered white metal in the first capture).
   */
  captureSatinReflection() {
    const satin = this.model && this.model.satin ? this.model.satin.material : null;
    if (!satin || this.satinReflectionCaptured || !this.renderer || !this.scene) return false;
    const center = new THREE.Vector3(
      SUPPORT.centerX,
      SATIN_REFLECTION.centerY,
      SUPPORT.centerZ,
    );
    const group = new THREE.Group();
    group.name = 'satin-reflection-accents';
    for (const accent of SATIN_REFLECTION.accents) {
      const geometry = new THREE.PlaneGeometry(accent.size[0], accent.size[1]);
      const material = new THREE.MeshBasicMaterial({
        color: srgbColor(accent.color).multiplyScalar(accent.intensity),
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'satin-reflection-accent';
      mesh.position.set(accent.position[0], accent.position[1], accent.position[2]);
      mesh.lookAt(center.x, center.y, center.z);
      mesh.layers.set(SATIN_REFLECTION.layer);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    this.scene.add(group);
    this.satinReflectionAccents = group;

    const hidden = [];
    const support = this.model.support || this.model.pedestal;
    if (support && support.visible) {
      support.visible = false;
      hidden.push(support);
    }
    if (this.underlightPool && this.underlightPool.visible) {
      this.underlightPool.visible = false;
      hidden.push(this.underlightPool);
    }
    // The stack starts just above the support, so the CubeCamera (centerY 150)
    // sits INSIDE it and would capture the bright paper + additive glow from close
    // range; the satin envMap would then read as a blown-out white support. Hide
    // the whole sheet stack for the cube capture (the reflection-only warm/cool
    // accents remain) so the satin reads as the columns-style blurred studio
    // reflection, not a white box.
    if (this.model && this.model.stack && this.model.stack.visible) {
      this.model.stack.visible = false;
      hidden.push(this.model.stack);
    }

    const cubeRT = new THREE.WebGLCubeRenderTarget(SATIN_REFLECTION.cubeSize, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    cubeRT.texture.name = 'billing-satin-reflection-cube';
    const cubeCamera = new THREE.CubeCamera(SATIN_REFLECTION.near, SATIN_REFLECTION.far, cubeRT);
    cubeCamera.name = 'billing-satin-reflection-camera';
    cubeCamera.position.copy(center);
    cubeCamera.layers.enable(SATIN_REFLECTION.layer);
    cubeCamera.update(this.renderer, this.scene);
    for (const object of hidden) object.visible = true;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileCubemapShader();
    const envRT = pmrem.fromCubemap(cubeRT.texture);
    pmrem.dispose();

    satin.envMap = envRT.texture;
    satin.needsUpdate = true;
    this.satinEnvRT = envRT;
    this.satinCubeRT = cubeRT;
    this.satinReflectionCaptured = true;
    return true;
  }

  renderFrame() {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
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

  /**
   * Composite order for the sheet layers. The stack is a flat pile seen from
   * above, so the visible stacking order is the sheet index (bottom sheet first,
   * top sheet last), NOT a camera-origin distance sort (with the camera above a
   * horizontal stack the far/top sheet can be nearer to the camera origin while
   * still occluding the sheets below — the origin sort misordered the layers).
   * Model v3 exposes `sheet.layers` (glow → paper → shadow → mockup → rim); the
   * legacy v1 pair (`surface` + `rim`) is still supported.
   */
  updateSheetRenderOrder() {
    if (!this.camera || !this.model) return;
    const entries = this.model.sheets.map((sheet) => ({ sheet }));
    entries.sort((a, b) => a.sheet.index - b.sheet.index);
    entries.forEach((entry, order) => {
      const layers = Array.isArray(entry.sheet.layers) ? entry.sheet.layers : null;
      if (layers && layers.length) {
        const base = order * 8;
        for (const layer of layers) {
          if (!layer || !layer.mesh) continue;
          const offset = Number.isFinite(layer.orderOffset) ? layer.orderOffset : 0;
          layer.mesh.renderOrder = base + offset;
        }
        return;
      }
      entry.sheet.surface.renderOrder = order * 2;
      entry.sheet.rim.renderOrder = order * 2 + 1;
    });
  }

  /* ---------------------------------------------------------- camera fit */

  /**
   * Fit the fixed 45° camera so the whole expanded object fills the stage height
   * like the reference while every silhouette point stays inside the frame.
   *
   * Because the view direction is FIXED (only the target offset and distance are
   * solved), the minimal distance has a closed form: for a point p with
   * view-space offsets xv = (p - target)·right and yv = (p - target)·up and depth
   * d + c (c = (p - target)·forward), |xv| <= maxX*depth and |yv| <= maxY*depth
   * become d >= |xv|/maxX - c and d >= |yv|/maxY - c. The binding point usually
   * sits on one side only (a perspective projection of a tall object is not
   * vertically centred on its AABB centre), so the page first shifts the camera
   * target along the camera's up/right axes until the projected silhouette is
   * centred, then solves the closed form again. The result: ~97 % of the stage
   * height with ~1.5 % padding on every side at every aspect.
   */
  solveFitDistance(target, right, up, forward, maxX, maxY, points) {
    let distance = 40;
    for (let index = 0; index < points.length; index += 3) {
      const rx = points[index] - target.x;
      const ry = points[index + 1] - target.y;
      const rz = points[index + 2] - target.z;
      const xv = rx * right.x + ry * right.y + rz * right.z;
      const yv = rx * up.x + ry * up.y + rz * up.z;
      const c = rx * forward.x + ry * forward.y + rz * forward.z;
      distance = Math.max(
        distance,
        Math.abs(xv) / maxX - c,
        Math.abs(yv) / maxY - c,
        CAMERA.near + 2 - c,
      );
    }
    return distance;
  }

  fitCamera() {
    if (!this.camera) return;
    const bounds = this.model.bounds.expanded;
    const baseTarget = new THREE.Vector3(
      bounds.center.x,
      bounds.center.y + CAMERA.targetYOffset,
      bounds.center.z,
    );
    const direction = viewDirection(CAMERA.azimuthDeg, CAMERA.elevationDeg);
    const azimuth = degToRad(CAMERA.azimuthDeg);
    const elevation = degToRad(CAMERA.elevationDeg);
    const right = new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
    const up = new THREE.Vector3(
      -Math.sin(azimuth) * Math.sin(elevation),
      Math.cos(elevation),
      -Math.cos(azimuth) * Math.sin(elevation),
    );
    const forward = direction.clone().negate();
    const aspect = (this.stageBox.width || 1) / (this.stageBox.height || 1);
    const narrow = (this.stageBox.width || 0) < CAMERA.narrowStageWidth;
    const fitMargin = narrow ? CAMERA.fitMarginNarrow : CAMERA.fitMargin;
    const tanHalf = Math.tan(degToRad(CAMERA.fov) / 2);
    const maxX = fitMargin * tanHalf * aspect;
    const maxY = fitMargin * tanHalf;
    const points = this.model.fitPoints && this.model.fitPoints.expanded;
    const target = baseTarget.clone();
    let distance = 40;

    if (points && points.length >= 3) {
      const probe = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
      const projected = new THREE.Vector3();
      for (let iteration = 0; iteration < 4; iteration += 1) {
        distance = this.solveFitDistance(target, right, up, forward, maxX, maxY, points);
        // Project the silhouette at this distance and measure the projected
        // centre; shift the target along the camera axes to centre it.
        probe.position.copy(target).addScaledVector(direction, distance);
        probe.lookAt(target);
        probe.updateMatrixWorld(true);
        probe.updateProjectionMatrix();
        let minX = Infinity;
        let maxXValue = -Infinity;
        let minY = Infinity;
        let maxYValue = -Infinity;
        for (let index = 0; index < points.length; index += 3) {
          projected.set(points[index], points[index + 1], points[index + 2]).project(probe);
          minX = Math.min(minX, projected.x);
          maxXValue = Math.max(maxXValue, projected.x);
          minY = Math.min(minY, projected.y);
          maxYValue = Math.max(maxYValue, projected.y);
        }
        const centerX = (minX + maxXValue) / 2;
        const centerY = (minY + maxYValue) / 2;
        if (Math.abs(centerX) < 0.002 && Math.abs(centerY) < 0.002) break;
        // Moving target +s up shifts the projection by -s/(depth*tanHalf).
        target.addScaledVector(up, centerY * distance * tanHalf);
        target.addScaledVector(right, centerX * distance * tanHalf * aspect);
      }
      distance = this.solveFitDistance(target, right, up, forward, maxX, maxY, points);
    } else {
      // Defensive fallback: binary-search fit on the AABB corners.
      const corners = boundsCorners(bounds);
      const probe = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
      const projected = new THREE.Vector3();
      const test = (candidate) => {
        probe.position.copy(target).addScaledVector(direction, candidate);
        probe.lookAt(target);
        probe.updateMatrixWorld(true);
        probe.updateProjectionMatrix();
        for (const corner of corners) {
          projected.copy(corner).project(probe);
          if (projected.z >= 1 || projected.z <= -1) return false;
          if (Math.abs(projected.x) > fitMargin) return false;
          if (Math.abs(projected.y) > fitMargin) return false;
        }
        return true;
      };
      let high = 600;
      let guard = 0;
      while (!test(high) && guard < 16) {
        high *= 2;
        guard += 1;
      }
      let low = 40;
      for (let iteration = 0; iteration < 50; iteration += 1) {
        const mid = (low + high) / 2;
        if (test(mid)) high = mid;
        else low = mid;
      }
      distance = high;
    }

    distance = clamp(distance, 40, CAMERA.far * 0.7);
    this.cameraDistance = distance;
    this.cameraTarget.copy(target);
    this.camera.aspect = aspect;
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.updateSheetRenderOrder();
    this.needsRender = true;
  }

  resize() {
    if (!this.renderer || this.destroyed) return;
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.stageBox.width && height === this.stageBox.height) return;
    this.stageBox = { width, height };
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.fitCamera();
    this.requestRender();
  }

  /* ------------------------------------------------------------ animation */

  applyStaticPose(mode) {
    for (const sheet of this.model.sheets) {
      MODEL.applySheetPose(sheet, mode === 'condensed' ? sheet.condensed : sheet.expanded);
    }
    this.model.stack.position.y = 0;
    this.expanded = mode === 'expanded';
    this.condensed = mode === 'condensed';
    this.idleTime = 0;
    this.settleTime = 0;
    this.requestRender();
  }

  currentPoses() {
    return this.model.sheets.map((sheet) => ({
      position: {
        x: sheet.mesh.position.x,
        y: sheet.mesh.position.y,
        z: sheet.mesh.position.z,
      },
      rotationDeg: {
        x: radToDeg(sheet.mesh.rotation.x),
        y: radToDeg(sheet.mesh.rotation.y),
        z: radToDeg(sheet.mesh.rotation.z),
      },
    }));
  }

  animationTotalMs(gather) {
    const spec = MODEL.ANIMATION_SPEC;
    return (gather ? spec.gatherMs : 0) + spec.sheetDelayMs + (SHEET_COUNT - 1) * spec.staggerMs + spec.sheetDurationMs;
  }

  /**
   * Start the unfold. When the stack is already expanded a short gather phase
   * pulls it back into the condensed pile first (replay), so the choreography
   * always reads right-to-left + upward.
   */
  startUnfold({ fromExpanded = null } = {}) {
    const alreadyExpanded = fromExpanded === null ? this.expanded : Boolean(fromExpanded);
    if (!this.motionAllowed()) {
      this.applyStaticPose('expanded');
      this.animation.playing = false;
      this.animation.playedOnce = true;
      this.animation.progress = 1;
      this.animation.phase = 'expanded';
      this.animation.total = 0;
      this.animation.elapsed = 0;
      this.emitChange();
      return { durationMs: 0 };
    }
    const gather = alreadyExpanded ? MODEL.ANIMATION_SPEC.gatherMs : 0;
    this.animation.startPoses = alreadyExpanded ? this.currentPoses() : null;
    this.animation.sheetStartPoses = this.model.sheets.map((sheet) => ({
      position: { ...sheet.condensed.position },
      rotationDeg: { ...sheet.condensed.rotationDeg },
    }));
    this.animation.gather = gather;
    this.animation.total = this.animationTotalMs(gather);
    this.animation.elapsed = 0;
    this.animation.progress = 0;
    this.animation.playing = true;
    this.animation.playedOnce = true;
    this.animation.phase = gather ? 'gathering' : 'unfolding';
    this.animation.settled = false;
    this.expanded = false;
    this.condensed = gather > 0 ? this.condensed : true;
    this.idleTime = 0;
    this.settleTime = 0;
    this.model.stack.position.y = 0;
    if (gather === 0) {
      // Snap to the condensed pile before the first unfolded frame; the page
      // shows the pile at rest before autoplay so this is visually continuous.
      this.applyStaticPose('condensed');
      this.expanded = false;
      this.condensed = true;
    }
    this.requestRender();
    this.emitChange();
    return { durationMs: this.animation.total };
  }

  updateAnimation(dtMs) {
    const animation = this.animation;
    if (!animation.playing) return;
    animation.elapsed += dtMs;
    const spec = MODEL.ANIMATION_SPEC;
    const elapsed = animation.elapsed;
    const gather = animation.gather || 0;
    if (gather > 0 && elapsed < gather) {
      const t = easeInOutCubic(elapsed / gather);
      for (let index = 0; index < this.model.sheets.length; index += 1) {
        const sheet = this.model.sheets[index];
        const start = animation.startPoses ? animation.startPoses[index] : sheet.expanded;
        MODEL.applySheetPose(sheet, MODEL.lerpSheetPose(start, sheet.condensed, t));
      }
      animation.phase = 'gathering';
    } else {
      animation.phase = 'unfolding';
      const unfoldElapsed = elapsed - gather;
      for (let index = 0; index < this.model.sheets.length; index += 1) {
        const sheet = this.model.sheets[index];
        const delay = spec.sheetDelayMs + index * spec.staggerMs;
        const raw = clamp((unfoldElapsed - delay) / spec.sheetDurationMs, 0, 1);
        const eased = easeInOutCubic(raw);
        MODEL.applySheetPose(sheet, MODEL.lerpSheetPose(sheet.condensed, sheet.expanded, eased));
      }
    }
    animation.progress = clamp(elapsed / (animation.total || 1), 0, 1);
    if (elapsed >= animation.total) {
      animation.playing = false;
      animation.progress = 1;
      animation.phase = 'expanded';
      animation.settled = true;
      animation.startPoses = null;
      this.applyStaticPose('expanded');
      this.emitChange();
    }
    this.requestRender();
  }

  updateIdle(dt) {
    if (!this.motionAllowed() || !this.expanded || this.animation.playing) {
      if (this.model.stack.position.y !== 0) {
        this.model.stack.position.y = 0;
        this.requestRender();
      }
      return;
    }
    this.settleTime += dt * 1000;
    this.idleTime += dt;
    const settle = this.settleTime < IDLE.settleMs ? this.settleTime / IDLE.settleMs : 1;
    const t = this.idleTime;
    const offset = (Math.sin((t * TAU) / IDLE.periodA) * IDLE.amplitude
      + Math.sin((t * TAU) / IDLE.periodB + IDLE.phaseB) * IDLE.amplitude * 0.35) * settle;
    this.model.stack.position.y = offset;
    this.requestRender();
  }

  loop(now) {
    if (this.destroyed) return;
    this.raf = window.requestAnimationFrame(this.loop);
    const previous = this.lastTime || now;
    const dt = Math.min(64, Math.max(0, now - previous));
    this.lastTime = now;
    if (this.animation.playing) this.updateAnimation(dt);
    this.updateIdle(dt / 1000);
    if (this.needsRender) this.renderFrame();
  }

  emitChange() {
    if (typeof this.onChange === 'function') {
      try {
        this.onChange();
      } catch (error) {
        /* UI sync is best effort */
      }
    }
  }

  waitForIdle() {
    if (!this.animation.playing) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = performance.now();
      const poll = () => {
        if (this.destroyed || !this.animation.playing) {
          resolve(true);
          return;
        }
        if (performance.now() - started > 8000) {
          resolve(false);
          return;
        }
        window.setTimeout(poll, 60);
      };
      window.setTimeout(poll, 60);
    });
  }

  /* -------------------------------------------------------------- debug */

  getAnimationDebug() {
    const animation = this.animation;
    return {
      playing: animation.playing,
      progress: round(animation.progress, 4),
      playedOnce: animation.playedOnce,
      phase: animation.phase,
      totalMs: round(animation.total, 1),
      elapsedMs: round(animation.elapsed, 1),
      gatherMs: MODEL.ANIMATION_SPEC.gatherMs,
      sheetDelayMs: MODEL.ANIMATION_SPEC.sheetDelayMs,
      staggerMs: MODEL.ANIMATION_SPEC.staggerMs,
      sheetDurationMs: MODEL.ANIMATION_SPEC.sheetDurationMs,
      mode: this.motionAllowed() ? 'animated' : 'static',
    };
  }

  getCameraDebug() {
    if (!this.camera) return null;
    const direction = new THREE.Vector3().subVectors(this.camera.position, this.cameraTarget).normalize();
    const azimuthDeg = radToDeg(Math.atan2(direction.x, direction.z));
    const elevationDeg = radToDeg(Math.asin(clamp(direction.y, -1, 1)));
    return {
      azimuthDeg: round(azimuthDeg, 2),
      elevationDeg: round(elevationDeg, 2),
      distance: round(this.camera.position.distanceTo(this.cameraTarget), 2),
      fov: CAMERA.fov,
      near: CAMERA.near,
      far: CAMERA.far,
      aspect: round(this.camera.aspect, 4),
      position: [round(this.camera.position.x, 2), round(this.camera.position.y, 2), round(this.camera.position.z, 2)],
      target: [round(this.cameraTarget.x, 2), round(this.cameraTarget.y, 2), round(this.cameraTarget.z, 2)],
      axis: [round(direction.x, 4), round(direction.y, 4), round(direction.z, 4)],
      nominalAzimuthDeg: CAMERA.azimuthDeg,
      nominalElevationDeg: CAMERA.elevationDeg,
      fitMargin:
        (this.stageBox.width || 0) < CAMERA.narrowStageWidth ? CAMERA.fitMarginNarrow : CAMERA.fitMargin,
      narrowStage: (this.stageBox.width || 0) < CAMERA.narrowStageWidth,
    };
  }

  /**
   * Screen-space bounding box of the *object only* (all seven sheets at their
   * current poses, the floating mockup layer and the support's visible top band),
   * in stage-local pixels. This lets a capture harness measure entrance/unfold/fit
   * without including the static stage caption / eyebrow / aura furniture that a
   * plain luma-mask bbox would pick up. The support's off-frame lower part is
   * excluded exactly like the camera fit does.
   */
  getObjectScreenRect() {
    if (!this.camera || !this.model) return null;
    const width = this.stageBox.width || 1;
    const height = this.stageBox.height || 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const world = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const include = (point) => {
      projected.copy(point).project(this.camera);
      const px = (projected.x * 0.5 + 0.5) * width;
      const py = (1 - (projected.y * 0.5 + 0.5)) * height;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    };
    const halfW = MODEL.SHEET_SPEC.width / 2;
    const halfH = MODEL.SHEET_SPEC.height / 2;
    const halfT = MODEL.SHEET_SPEC.thickness / 2;
    const mockupLift = MODEL.LAYER_SPEC.mockupLift;
    for (const sheet of this.model.sheets) {
      sheet.mesh.updateMatrixWorld(true);
      for (const sx of [-halfW, halfW]) {
        for (const sy of [-halfH, halfH]) {
          for (const sz of [-halfT, halfT]) {
            world.set(sx, sy, sz);
            sheet.mesh.localToWorld(world);
            include(world);
          }
        }
      }
      // edge midpoints (silhouette tangents) + the bow centre
      for (const [mx, my] of [[0, 0], [-halfW, 0], [halfW, 0], [0, -halfH], [0, halfH]]) {
        world.set(mx, my, 0);
        sheet.mesh.localToWorld(world);
        include(world);
      }
      // the floating mockup layer (lifted above the paper, so it can extend the
      // top of the silhouette by a few px)
      for (const sx of [-halfW, halfW]) {
        for (const sy of [-halfH, halfH]) {
          world.set(sx, sy, mockupLift);
          sheet.mesh.localToWorld(world);
          include(world);
        }
      }
    }
    const support = this.model.support || this.model.pedestal;
    if (support && support.geometry) {
      support.updateMatrixWorld(true);
      const positions = support.geometry.getAttribute('position');
      if (positions) {
        for (let index = 0; index < positions.count; index += 2) {
          world.set(positions.getX(index), positions.getY(index), positions.getZ(index)).applyMatrix4(support.matrixWorld);
          if (world.y < SUPPORT.cropY) continue;
          include(world);
        }
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          world.set(SUPPORT.centerX + (sx * SUPPORT.width) / 2, SUPPORT.cropY, SUPPORT.centerZ + (sz * SUPPORT.depth) / 2);
          include(world);
        }
      }
    }
    if (!Number.isFinite(minX)) return null;
    const roundRect = (value) => round(value, 2);
    return {
      units: 'stage-px',
      x: roundRect(minX),
      y: roundRect(minY),
      width: roundRect(maxX - minX),
      height: roundRect(maxY - minY),
      w: roundRect(maxX - minX),
      h: roundRect(maxY - minY),
      left: roundRect(minX),
      top: roundRect(minY),
      right: roundRect(maxX),
      bottom: roundRect(maxY),
      stageWidth: roundRect(width),
      stageHeight: roundRect(height),
    };
  }

  getSheetDebug() {
    return this.model.sheets.map((sheet) => {
      const materials = sheet.materials || {};
      const paper = materials.paper || materials.face || null;
      const mockup = materials.mockup || null;
      const shadow = materials.shadow || null;
      const glow = materials.glow || null;
      const edge = materials.edge || null;
      const layers = Array.isArray(sheet.layers)
        ? sheet.layers.map((layer) => ({
            role: layer && layer.role ? layer.role : 'layer',
            orderOffset: layer && Number.isFinite(layer.orderOffset) ? layer.orderOffset : 0,
            renderOrder: layer && layer.mesh ? layer.mesh.renderOrder : null,
          }))
        : null;
      return {
        index: sheet.index,
        id: sheet.id,
        tone: sheet.tone || sheet.treatment || null,
        treatment: sheet.treatment || sheet.tone || null,
        group: sheet.group || sheet.treatment || sheet.tone || null,
        label: sheet.label,
        code: sheet.code,
        // Round 5: white/gold paper faces are opaque, PCB stays translucent.
        face: sheet.face || (paper && paper.userData ? paper.userData.face : null),
        ink: sheet.ink || null,
        underlight: sheet.underlight || (glow && glow.color && glow.color.getHexString ? '#' + glow.color.getHexString() : null),
        expanded: {
          position: { ...sheet.expanded.position },
          rotationDeg: { ...sheet.expanded.rotationDeg },
        },
        condensed: {
          position: { ...sheet.condensed.position },
          rotationDeg: { ...sheet.condensed.rotationDeg },
        },
        current: {
          position: {
            x: round(sheet.mesh.position.x, 3),
            y: round(sheet.mesh.position.y, 3),
            z: round(sheet.mesh.position.z, 3),
          },
          rotationDeg: {
            x: round(radToDeg(sheet.mesh.rotation.x), 3),
            y: round(radToDeg(sheet.mesh.rotation.y), 3),
            z: round(radToDeg(sheet.mesh.rotation.z), 3),
          },
        },
        // Face-down construction: paper = the top face the camera sees (opaque or
        // translucent), mockup = the ONE unified floating text-mockup layer lifted
        // above it, glow = the underlight card below, edge = the thin bright rim.
        material: paper
          ? {
              transparent: Boolean(paper.transparent),
              opacity: round(paper.opacity, 4),
              roughness: round(paper.roughness, 4),
              metalness: round(paper.metalness, 4),
              envMapIntensity: round(paper.envMapIntensity, 4),
              hasMap: Boolean(paper.map),
              depthWrite: Boolean(paper.depthWrite),
              emissiveIntensity: round(paper.emissiveIntensity, 3),
              side: paper.side,
              face: sheet.face || null,
              opaque: sheet.face === 'opaque',
            }
          : null,
        mockup: mockup
          ? {
              unified: true,
              floating: true,
              lift: round(sheet.mockupLift || 0, 3),
              map: Boolean(mockup.map),
              transparent: Boolean(mockup.transparent),
              opacity: round(mockup.opacity, 4),
              side: mockup.side,
              depthWrite: Boolean(mockup.depthWrite),
              color: mockup.color && typeof mockup.color.getHexString === 'function' ? '#' + mockup.color.getHexString() : null,
              ink: sheet.ink || null,
              shadow: shadow
                ? {
                    map: Boolean(shadow.map),
                    blurred: (shadow.userData && shadow.userData.blurred) || null,
                    opacity: round(shadow.opacity, 4),
                    lift: (shadow.userData && shadow.userData.lift) || null,
                  }
                : null,
            }
          : null,
        layers: {
          paper: paper
            ? {
                transparent: Boolean(paper.transparent),
                opacity: round(paper.opacity, 4),
                depthWrite: Boolean(paper.depthWrite),
                roughness: round(paper.roughness, 4),
                metalness: round(paper.metalness, 4),
                map: Boolean(paper.map),
                side: paper.side,
                face: sheet.face || null,
              }
            : null,
          mockup: mockup
            ? {
                map: Boolean(mockup.map),
                transparent: Boolean(mockup.transparent),
                opacity: round(mockup.opacity, 4),
                side: mockup.side,
                depthWrite: Boolean(mockup.depthWrite),
                unified: true,
                floating: true,
                lift: round(sheet.mockupLift || 0, 3),
                color: mockup.color && typeof mockup.color.getHexString === 'function' ? '#' + mockup.color.getHexString() : null,
              }
            : null,
          shadow: shadow
            ? {
                map: Boolean(shadow.map),
                transparent: Boolean(shadow.transparent),
                opacity: round(shadow.opacity, 4),
                side: shadow.side,
                depthWrite: Boolean(shadow.depthWrite),
                blurred: (shadow.userData && shadow.userData.blurred) || null,
              }
            : null,
          glow: glow
            ? {
                color: glow.color && typeof glow.color.getHexString === 'function' ? '#' + glow.color.getHexString() : null,
                opacity: round(glow.opacity, 4),
                additive: glow.blending === THREE.AdditiveBlending,
                side: glow.side,
              }
            : null,
          edge: edge
            ? {
                color: edge.color && typeof edge.color.getHexString === 'function' ? '#' + edge.color.getHexString() : null,
                opacity: round(edge.opacity, 4),
                side: edge.side,
              }
            : null,
        },
        layerList: layers,
        renderOrder: sheet.surface ? sheet.surface.renderOrder : null,
      };
    });
  }

  getRenderDebug() {
    const info = this.renderer ? this.renderer.info : null;
    return {
      renderer: 'WebGL',
      pixelRatio: this.renderer ? round(this.renderer.getPixelRatio(), 3) : 1,
      width: this.stageBox.width,
      height: this.stageBox.height,
      frames: this.renderCount,
      triangles: info ? info.render.triangles : 0,
      drawCalls: info ? info.render.calls : 0,
      shadowMapEnabled: Boolean(this.renderer && this.renderer.shadowMap.enabled),
      toneMappingExposure: RENDERER.exposure,
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
    if (this.underlightPool) {
      this.scene.remove(this.underlightPool);
      this.underlightPool.geometry.dispose();
      if (this.underlightPool.material.map) this.underlightPool.material.map.dispose();
      this.underlightPool.material.dispose();
      this.underlightPool = null;
    }
    if (this.model && this.model.root && this.scene) this.scene.remove(this.model.root);
    if (this.satinReflectionAccents && this.scene) {
      this.scene.remove(this.satinReflectionAccents);
      this.satinReflectionAccents.traverse((object) => {
        if (object.isMesh) {
          if (object.geometry) object.geometry.dispose();
          if (object.material) object.material.dispose();
        }
      });
      this.satinReflectionAccents = null;
    }
    if (this.satinEnvRT) {
      this.satinEnvRT.dispose();
      this.satinEnvRT = null;
    }
    if (this.satinCubeRT) {
      this.satinCubeRT.dispose();
      this.satinCubeRT = null;
    }
    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
    }
    if (this.scene) this.scene.environment = null;
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
  }
}

/* ---------------------------------------------------------------- studio glue */

function createStudio() {
  const model = state.model;
  const studio = new BillingStudio({
    canvas: dom.canvas,
    stage: dom.stage,
    model,
    reducedMotion: state.reducedMotion,
    still: state.still,
    shot: state.shot,
  });
  studio.onChange = () => {
    syncUi();
    publishState();
  };
  return studio;
}

/* ------------------------------------------------------------------- api */

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

function doPlay() {
  const studio = state.studio;
  if (!studio || state.failed) return Promise.resolve(false);
  const fromExpanded = studio.expanded;
  studio.startUnfold({ fromExpanded });
  syncUi();
  publishState();
  announce(fromExpanded ? 'Replaying the unfold' : 'Unfolding the documents');
  return studio.waitForIdle().then(() => {
    syncUi();
    publishState();
    return true;
  });
}

function doReplay() {
  const studio = state.studio;
  if (!studio || state.failed) return Promise.resolve(false);
  studio.startUnfold({ fromExpanded: studio.expanded });
  syncUi();
  publishState();
  announce('Replaying the unfold');
  return studio.waitForIdle().then(() => {
    syncUi();
    publishState();
    return true;
  });
}

function buildDebug() {
  const studio = state.studio;
  const debug = {
    version: VERSION,
    ready: Boolean(state.ready),
    errors: qa.errors.slice(),
    warnings: qa.warnings.slice(),
    webgl: {
      supported: Boolean(studio && studio.renderer) || Boolean(state.webgl),
      version: state.webgl || '',
    },
    sheets: studio ? studio.getSheetDebug() : [],
    sheetCount: SHEET_COUNT,
    // Round-4 treatments, bottom -> top: two white, two gold, three PCB sheets.
    treatments: MODEL.TREATMENTS || null,
    treatmentCounts: studio && state.model && state.model.treatments ? state.model.treatments : null,
    goldStartIndex: Number.isFinite(MODEL.GOLD_START_INDEX) ? MODEL.GOLD_START_INDEX : null,
    // Legacy alias kept for older capture scripts; points at the first gold sheet.
    warmSheetIndex: Number.isFinite(MODEL.WARM_SHEET_INDEX) ? MODEL.WARM_SHEET_INDEX : null,
    // Round 5: ONE unified text mockup shared by all seven sheets, rendered as a
    // separate floating layer above each paper face (never paper albedo).
    mockup: state.model
      ? {
          unified: Boolean(state.model.mockup && state.model.mockup.unified),
          floating: Boolean(state.model.mockup && state.model.mockup.floating),
          detached: Boolean(state.model.mockup && state.model.mockup.detached),
          textureCount: state.model.mockup ? state.model.mockup.textureCount : 0,
          textureUuid: state.model.mockup && state.model.mockup.texture ? state.model.mockup.texture.uuid : null,
          shadowTextureCount: state.model.mockup ? state.model.mockup.shadowTextureCount : 0,
          shadowTextureUuid: state.model.mockup && state.model.mockup.shadowTexture ? state.model.mockup.shadowTexture.uuid : null,
          shadow: state.model.mockup ? state.model.mockup.shadow : null,
          sheetCount: state.model.mockup ? state.model.mockup.sheetCount : 0,
          lift: state.model.mockup ? state.model.mockup.lift : null,
          ink: MODEL.MOCKUP_SPEC.ink,
          spec: state.model.mockup ? state.model.mockup.spec : null,
          shadowSpec: state.model.mockup ? state.model.mockup.shadowSpec : null,
        }
      : null,
    // Round 5 paper-face contract: white/gold opaque, PCB translucent.
    faces: state.model
      ? {
          paperFace: MODEL.PAPER_FACE,
          perSheet: state.model.sheets.map((sheet) => ({ id: sheet.id, treatment: sheet.treatment, face: sheet.face })),
          opaque: state.model.sheets.filter((sheet) => sheet.face === 'opaque').map((sheet) => sheet.id),
          translucent: state.model.sheets.filter((sheet) => sheet.face === 'translucent').map((sheet) => sheet.id),
        }
      : null,
    // Round 5 support: the columns deliverable's satin column instance, reused.
    support: state.model && state.model.supportInfo
      ? {
          ...state.model.supportInfo,
          meshName: state.model.supportInfo.meshName,
          fitCropY: state.model.fitCropY,
          fitPoints: state.model.fitPoints && state.model.fitPoints.expanded ? state.model.fitPoints.expanded.length / 3 : 0,
          fullBounds: state.model.supportBounds,
        }
      : state.model
        ? { reused: false, source: 'none', note: 'columns satin column unavailable; stack rendered without support' }
        : null,
    stackExpanded: Boolean(studio && studio.expanded),
    animation: studio
      ? studio.getAnimationDebug()
      : { playing: false, progress: 0, playedOnce: false, phase: 'intro' },
    camera: studio ? studio.getCameraDebug() : null,
    // Object-only screen bbox in stage-local px (excludes the stage caption /
    // eyebrow / aura furniture) for capture-harness fit + motion measurement.
    objectRect: studio ? studio.getObjectScreenRect() : null,
    materials: {
      satin: state.model
        ? (() => {
            const material = state.model.satin.material;
            const liveMaps = {
              map: Boolean(material.map),
              normalMap: Boolean(material.normalMap),
              roughnessMap: Boolean(material.roughnessMap),
              metalnessMap: Boolean(material.metalnessMap),
              aoMap: Boolean(material.aoMap),
              bumpMap: Boolean(material.bumpMap),
              envMap: Boolean(material.envMap),
            };
            return {
              source: state.satinSource,
              clonedFrom: material.userData && material.userData.clonedFrom,
              metalness: material.metalness,
              roughness: material.roughness,
              envMapIntensity: material.envMapIntensity,
              normalScale: material.normalScale
                ? [round(material.normalScale.x, 4), round(material.normalScale.y, 4)]
                : null,
              color:
                material.color && typeof material.color.getHexString === 'function'
                  ? '#' + material.color.getHexString()
                  : null,
              maps: liveMaps,
              envMode: liveMaps.envMap
                ? 'captured PMREM studio reflection (columns-style CubeCamera; layer-1 warm/cool accents)'
                : 'scene.environment',
              tilePx: state.model.satin.tilePx,
              uvDensityScale: MODEL.UV_DENSITY_SCALE,
              supportSpec: MODEL.SUPPORT_SPEC,
              reusedColumnMesh: state.columnInstance ? state.columnInstance.uuid : null,
              reflection: {
                captured: Boolean(state.studio && state.studio.satinReflectionCaptured),
                cubeSize: SATIN_REFLECTION.cubeSize,
                centerY: SATIN_REFLECTION.centerY,
                accents: SATIN_REFLECTION.accents.length,
              },
            };
          })()
        : null,
      sheets: studio
        ? studio.getSheetDebug().map((sheet) => ({
            id: sheet.id,
            treatment: sheet.treatment,
            group: sheet.group,
            underlight: sheet.underlight,
            // Flat alias of the paper material for old capture scripts;
            // layers.paper/shadow/mockup/glow/edge carry the full detail.
            transparent: sheet.material ? sheet.material.transparent : null,
            opacity: sheet.material ? sheet.material.opacity : null,
            roughness: sheet.material ? sheet.material.roughness : null,
            metalness: sheet.material ? sheet.material.metalness : null,
            envMapIntensity: sheet.material ? sheet.material.envMapIntensity : null,
            layers: sheet.layers,
          }))
        : [],
    },
    underlight: studio ? studio.getUnderlightDebug() : null,
    model: {
      version: MODEL.MODEL_VERSION,
      sheetSpec: MODEL.SHEET_SPEC,
      layerSpec: MODEL.LAYER_SPEC,
      supportSpec: MODEL.SUPPORT_SPEC,
      mockupSpec: MODEL.MOCKUP_SPEC,
      paperFace: MODEL.PAPER_FACE,
      cameraSpec: CAMERA,
      animationSpec: MODEL.ANIMATION_SPEC,
      layout: MODEL.LAYOUT,
      treatments: state.model && state.model.treatments ? state.model.treatments : null,
      bounds: state.model
        ? { expanded: state.model.bounds.expanded, condensed: state.model.bounds.condensed }
        : null,
    },
    objects: studio
      ? {
          support: state.model && state.model.support ? 1 : 0,
          // Legacy alias: the support column is the pedestal.
          pedestal: state.model && state.model.support ? 1 : 0,
          sheets: SHEET_COUNT,
          sheetSurfaces: SHEET_COUNT,
          sheetRims: SHEET_COUNT,
          sheetMockupLayers: SHEET_COUNT,
          sheetGlowLayers: SHEET_COUNT,
          floatingMockupLayers: SHEET_COUNT,
          lights: {
            directional: 3,
            ambient: 1,
            point: 0,
            underlightPool: Boolean(studio.underlightPool),
          },
          render: studio.getRenderDebug(),
        }
      : null,
    stageRect: null,
    flags: {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      qaMode: Boolean(state.qaMode),
      reducedMotion: Boolean(state.reducedMotion),
      autoplay: Boolean(state.autoplay),
      fallback: Boolean(state.failed),
      play: state.playParam !== null ? state.playParam : 'auto',
      idle: Boolean(studio && studio.motionAllowed() && studio.expanded),
    },
    urls: {
      page: IS_BROWSER ? window.location.href : '',
      columnsModel: COLUMN_MODEL_URL.href,
      assetBase: COLUMN_ASSET_BASE,
    },
  };
  try {
    const stage = dom.stage || document.getElementById('stage');
    if (stage) {
      const rect = stage.getBoundingClientRect();
      const x = round(rect.x, 2);
      const y = round(rect.y, 2);
      const width = round(rect.width, 2);
      const height = round(rect.height, 2);
      debug.stageRect = {
        x,
        y,
        width,
        height,
        w: width,
        h: height,
        top: round(rect.top, 2),
        right: round(rect.right, 2),
        bottom: round(rect.bottom, 2),
        left: round(rect.left, 2),
      };
    }
  } catch (error) {
    debug.stageRect = null;
  }
  return debug;
}

const api = {
  version: VERSION,
  ready: false,
  errors: qa.errors,
  warnings: qa.warnings,
  play() {
    return doPlay();
  },
  replay() {
    return doReplay();
  },
  debug: buildDebug,
  waitForIdle() {
    if (!state.studio) return Promise.resolve(false);
    return state.studio.waitForIdle();
  },
  readyPromise() {
    return readyPromise;
  },
};
if (IS_BROWSER) window.__tekoBilling = api;

/* ------------------------------------------------------------------ fallback */

function showFallback(message, { error = null, banner = false } = {}) {
  state.failed = true;
  state.ready = false;
  state.booting = false;
  api.ready = false;
  if (error) pushError(errorMessage(error));
  if (dom.fallback) {
    dom.fallback.hidden = false;
    if (dom.fallbackMessage) dom.fallbackMessage.textContent = message;
  }
  if (dom.body) dom.body.dataset.fallback = '1';
  if (dom.btnReplay) dom.btnReplay.disabled = true;
  hideCurtain();
  if (banner && dom.errorBanner) {
    if (dom.errorText) dom.errorText.textContent = message;
    dom.errorBanner.hidden = false;
  }
  if (dom.infoFootState) dom.infoFootState.textContent = 'Static fallback';
  if (dom.footerStatus) dom.footerStatus.textContent = 'Static fallback';
  announce('Static preview: ' + message);
  syncUi();
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

/* -------------------------------------------------------------- viewport IO */

function triggerUnfold(source) {
  const studio = state.studio;
  if (!studio || state.failed) return;
  if (source !== 'manual' && !state.autoplay) return;
  if (studio.animation.playedOnce) return;
  state.autoplay = false;
  publishState();
  studio.startUnfold({ fromExpanded: false });
  syncUi();
  publishState();
  announce(source === 'viewport' ? 'Documents unfolding' : 'Documents unfolded');
}

function setupViewportTrigger() {
  if (!state.autoplay) {
    publishState();
    return;
  }
  if (!dom.stage || typeof IntersectionObserver !== 'function') {
    triggerUnfold('no-observer');
    return;
  }
  try {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            observer.disconnect();
            state.viewObserver = null;
            triggerUnfold('viewport');
            return;
          }
        }
      },
      { threshold: [0, 0.2, 0.35, 0.6, 1] },
    );
    observer.observe(dom.stage);
    state.viewObserver = observer;
  } catch (error) {
    pushWarning('IntersectionObserver failed, unfolding immediately: ' + errorMessage(error));
    triggerUnfold('no-observer');
  }
}

/* --------------------------------------------------------------------- ui */

function wireUi() {
  if (dom.btnReplay) {
    dom.btnReplay.addEventListener('click', () => {
      doReplay();
    });
  }
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') {
      // Space on the focused Replay button would double-trigger; the button's
      // own click handler covers that case.
      if (target === dom.btnReplay) return;
      event.preventDefault();
      doReplay();
    }
  });
  if (reducedMotionQuery) {
    const onChange = (event) => {
      state.reducedMotion = Boolean(event.matches);
      if (state.studio) {
        state.studio.reducedMotion = state.reducedMotion;
        if (state.reducedMotion) {
          if (state.viewObserver) {
            state.viewObserver.disconnect();
            state.viewObserver = null;
          }
          state.studio.applyStaticPose('expanded');
          state.studio.animation.playing = false;
          state.studio.animation.progress = 1;
          state.studio.animation.phase = 'expanded';
          state.studio.animation.playedOnce = true;
          state.autoplay = false;
        }
      }
      syncUi();
      publishState();
    };
    if (typeof reducedMotionQuery.addEventListener === 'function') reducedMotionQuery.addEventListener('change', onChange);
    else if (typeof reducedMotionQuery.addListener === 'function') reducedMotionQuery.addListener(onChange);
  }
}

/* ----------------------------------------------------------------- fonts */

async function waitForFonts() {
  if (!IS_BROWSER || !document.fonts) return;
  const timeout = () => new Promise((resolve) => window.setTimeout(resolve, 1200));
  try {
    if (typeof document.fonts.load === 'function') {
      // The page typography (facts/notes/captions) uses the local Lexend face;
      // wait for it so the first deterministic capture has final metrics. Round 4
      // removed all text from the procedural sheet maps, so the canvas textures
      // no longer depend on this font.
      await Promise.race([
        Promise.all([
          document.fonts.load('600 36px Lexend').catch(() => {}),
          document.fonts.load('400 16px Lexend').catch(() => {}),
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
    /* font readiness is cosmetic/deterministic only */
  }
}

/* -------------------------------------------------------------------- boot */

async function loadColumnsBank() {
  curtainProgress(0.1, 'Loading columns satin', '0 / 0');
  try {
    const columnModule = await import(COLUMN_MODEL_URL.href);
    if (!columnModule || typeof columnModule.loadColumnBank !== 'function') {
      throw new Error('columns-model.js did not expose loadColumnBank()');
    }
    if (typeof columnModule.createColumns !== 'function') {
      throw new Error('columns-model.js did not expose createColumns()');
    }
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const bank = await columnModule.loadColumnBank({
          assetBase: COLUMN_ASSET_BASE,
          onProgress: (loaded, total) => {
            const safeTotal = Number(total) || 0;
            const ratio = safeTotal > 0 ? clamp(loaded / safeTotal, 0, 1) : 0;
            curtainProgress(0.1 + ratio * 0.5, 'Loading columns satin', loaded + ' / ' + (safeTotal || '—'));
          },
        });
        state.bank = bank;
        const satin = bank && bank.materials ? bank.materials.satin : null;
        if (!satin) throw new Error('columns bank has no satin material');
        state.satinSource = 'columns';
        state.satinTilePx = Number(bank.tilePx && bank.tilePx.satin) > 0 ? Number(bank.tilePx.satin) : SATIN_TILE_FALLBACK;

        // Round 5: instantiate the columns deliverable and REUSE one satin column
        // instance as the billing pedestal. The other 26 columns are never placed in
        // the billing scene, so their geometries are disposed immediately (the
        // extracted column's geometry is kept and disposed on pagehide).
        curtainProgress(0.78, 'Reusing the satin column', '');
        const columns = columnModule.createColumns(bank, { quality: 'hero' });
        const supportId = SUPPORT.columnId;
        const picked = (columns.columnsById && columns.columnsById[supportId])
          || columns.columns.find((column) => column && column.spec && column.spec.material === 'satin');
        if (!picked || !picked.mesh) throw new Error('columns model exposed no satin column to reuse');
        for (const column of columns.columns) {
          if (column === picked) continue;
          if (column.mesh && column.mesh.parent) column.mesh.parent.remove(column.mesh);
          if (column.mesh && column.mesh.geometry) column.mesh.geometry.dispose();
        }
        state.columns = columns;
        state.columnInstance = picked.mesh;
        state.columnGeometry = picked.mesh.geometry;
        state.supportSource = 'columns-satin-column';
        return satin;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          pushWarning('columns satin/column load failed, retrying once: ' + errorMessage(error));
          await new Promise((resolve) => window.setTimeout(resolve, 350));
        }
      }
    }
    if (lastError) throw lastError;
  } catch (error) {
    pushWarning(
      'columns satin column unavailable (' + errorMessage(error) + '); the paper stack renders WITHOUT the reused satin column support (no pedestal geometry is built by the billing model)',
    );
  }
  state.satinSource = 'fallback';
  state.supportSource = 'none';
  state.satinTilePx = SATIN_TILE_FALLBACK;
  return null;
}

async function boot() {
  state.bootStartedAt = performance.now();
  state.booting = true;
  api.ready = false;

  // Deterministic flags first: the body attributes must be correct while the
  // curtain is still up (QA polls them).
  dom.body.dataset.fallback = '0';
  dom.body.dataset.qaReady = '0';
  dom.body.dataset.qaAnimation = state.playParam === '0' ? 'condensed' : 'intro';
  dom.body.dataset.qaExpanded = '0';
  dom.body.dataset.qaSatin = 'unknown';
  dom.body.dataset.qaSupport = 'unknown';
  if (state.still) dom.body.dataset.still = '1';
  if (state.shot) dom.body.dataset.shot = '1';
  if (state.qaMode) dom.body.dataset.qaMode = '1';
  if (state.reducedMotion) dom.body.dataset.reducedMotion = '1';
  syncUi();
  publishState();

  curtainProgress(0.02, 'Detecting WebGL', '0 / 0');
  const webgl = probeWebGL();
  state.webgl = webgl;
  qa.webgl = webgl;
  if (!webgl) {
    showFallback('WebGL is not available in this browser, so the interactive billing documents cannot be rendered. A static poster of the seven-sheet stack is shown below.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.06, 'Loading type', '');
  await waitForFonts();

  const satin = await loadColumnsBank();

  curtainProgress(0.68, 'Building the documents', '');
  let model = null;
  try {
    model = MODEL.createBillingModel({
      satinMaterial: satin,
      satinTilePx: state.satinTilePx,
      columnInstance: state.columnInstance,
      quality: 'hero',
    });
    state.model = model;
  } catch (error) {
    showFallback('The billing documents model could not be built (' + errorMessage(error) + '). A static poster is shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }
  if (!model || !Array.isArray(model.sheets) || model.sheets.length !== SHEET_COUNT) {
    showFallback('The billing model did not produce the expected seven document sheets.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.78, 'Starting the studio', '');
  try {
    state.studio = createStudio();
    await state.studio.init();
    const contextLost = (event) => {
      event.preventDefault();
      showFallback('WebGL context was lost, so a static poster of the document stack is shown below.');
      resolveReady(false);
    };
    dom.canvas.addEventListener('webglcontextlost', contextLost, false);
    state.studio.contextLostHandler = contextLost;
  } catch (error) {
    if (state.studio) {
      try {
        state.studio.dispose();
      } catch (disposeError) {
        /* best effort */
      }
      state.studio = null;
    }
    showFallback('The three.js studio could not start (' + errorMessage(error) + '). A static poster is shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }

  const studio = state.studio;
  // Deterministic / initial states (contract B4):
  //   still | shot | reduced-motion -> final expanded frame, no idle float
  //   ?play=0                      -> condensed initial pile, no autoplay
  //   ?play=1                      -> autoplay on viewport entry (default)
  if (isStaticMode()) {
    studio.applyStaticPose('expanded');
    studio.animation.playing = false;
    studio.animation.progress = 1;
    studio.animation.phase = 'expanded';
    studio.animation.playedOnce = true;
    state.autoplay = false;
  } else if (state.playParam === '0') {
    studio.applyStaticPose('condensed');
    studio.animation.playing = false;
    studio.animation.progress = 0;
    studio.animation.phase = 'condensed';
    studio.animation.playedOnce = false;
    state.autoplay = false;
  } else {
    studio.applyStaticPose('condensed');
    studio.animation.playing = false;
    studio.animation.progress = 0;
    studio.animation.phase = 'condensed';
    studio.animation.playedOnce = false;
    state.autoplay = true;
  }
  syncUi();
  publishState();

  // Fonts can shift the grid by a pixel; fit + render before ready so the first
  // capture of a fresh load is already the settled, deterministic frame.
  curtainProgress(0.94, 'Fitting the studio', '');
  studio.fitCamera();
  studio.renderNow();
  await studio.whenFirstFrame();

  hideCurtain();
  state.ready = true;
  state.booting = false;
  api.ready = true;
  window.clearTimeout(state.watchdog);
  syncObjectFacts();
  syncUi();
  publishState();
  announce('Billing documents ready');
  studio.renderNow();
  resolveReady(true);

  // Viewport-triggered unfold (once). Deterministic modes never autoplay.
  if (state.autoplay) setupViewportTrigger();
}

/* ------------------------------------------------------------------- main */

function main() {
  initDom();
  wireUi();
  syncUi();
  publishState();
  boot().catch((error) => {
    if (!state.failed) {
      showFallback('The billing preview failed to start (' + errorMessage(error) + '). A static poster is shown below.', { error, banner: true });
    }
    resolveReady(false);
  });
  state.watchdog = window.setTimeout(() => {
    if (!state.ready && !state.failed) {
      showFallback('The interactive preview did not start within 20 seconds. A static poster is shown below.', { banner: true });
      resolveReady(false);
    }
  }, 20000);
  window.setInterval(() => {
    if (state.failed) return;
    publishState();
  }, 400);
  window.addEventListener('pagehide', () => {
    window.clearTimeout(state.watchdog);
    if (state.viewObserver) {
      state.viewObserver.disconnect();
      state.viewObserver = null;
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
    // The reused satin column geometry is owned by the page's columns instance
    // (createColumns), not by the billing model, so it is disposed here. The
    // other 26 column geometries were already disposed right after extraction.
    if (state.columnGeometry) {
      try {
        state.columnGeometry.dispose();
      } catch (error) {
        /* best effort */
      }
      state.columnGeometry = null;
    }
    state.columnInstance = null;
    state.columns = null;
    if (state.bank && typeof state.bank.dispose === 'function') {
      try {
        state.bank.dispose();
      } catch (error) {
        /* best effort */
      }
      state.bank = null;
    }
  });
}

if (IS_BROWSER) main();

export { VERSION, BillingStudio };

