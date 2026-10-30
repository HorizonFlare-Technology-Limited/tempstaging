/**
 * tekoanimation — Billing layer-stack preview controller (Rev32, model 6.0.0).
 *
 * Standalone collection page controller for `billing.html`: a black editorial
 * studio showing SEVEN US-Letter sheets floating with equal air gaps above the
 * satin column (src/columns-model.js, satin-large-long, used whole):
 *
 *     paper, paper, paper, glow, acrylic, acrylic, acrylic     (bottom -> top)
 *
 * Two model classes: PAPER (wavy white paper; the glow variant adds an orange
 * inner glow via the emissive map) and ACRYLIC (one thick CLEAR plate carrying
 * the dot grid + doc-icon surface pattern; the old grey circuit board, its
 * traces and the embossed glyph strokes are gone). Nothing readable is painted.
 *
 * Light: NO THREE lights. The one light source is the shared room photograph
 * `assets/env/modern-empty-room.jpg`, pre-filtered once by `src/env-room.js`.
 *
 * Zoom (all modes): wheel, pinch (two pointers) and the +/- buttons scale the
 * fitted camera distance, clamped to ZOOM_SPEC. Drag-rotate stays in ?mode=sheets.
 *
 * Animation: the sheets enter bottom-up, staggered, then hold. Replay / Space
 * re-runs it; ?still=1, ?shot=1 and reduced motion show the final held frame
 * deterministically; ?play=0 shows the empty pre-entrance frame.
 *
 * QA hook: window.__tekoBilling = { ready, errors, warnings, play(), replay(),
 * debug(), waitForIdle(), readyPromise() } plus body[data-qa-*] attributes and
 * the hidden #qa-diag JSON mirror.
 */
import * as THREE from 'three';
import { applyEnvRoom, ENV_ROOM } from './env-room.js';
import * as BillingModel from './billing-model.js';
import { loadColumnBank } from './columns-model.js';
import { arcballDelta, quatFromEulerYXZ, quatMultiply, quatNormalize } from './trackball.js';

const VERSION = '6.0.0';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ------------------------------------------------------------------ spec */

const MODEL = BillingModel;
const CAMERA = MODEL.CAMERA_SPEC;
const SHEET_COUNT = MODEL.SHEET_COUNT;
const SUPPORT = MODEL.SUPPORT_SPEC;
const ZOOM = MODEL.ZOOM_SPEC;

/* ------------------------------------------------------------ render tuning */

const RENDERER = Object.freeze({ exposure: 1.05, dprMax: 2 });
// Rev21: the ONLY light source is the shared room photograph
// (assets/env/modern-empty-room.jpg). `src/env-room.js` filters it once into a
// PMREM and assigns `scene.environment`; `intensity` multiplies every material's
// own authored envMapIntensity (r151 path). No THREE light objects.
const ENVIRONMENT = Object.freeze({ intensity: 3.6 });
const ENVIRONMENT_LABEL = ENV_ROOM.url + ' (PMREM, env-room)';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degToRad = (deg) => (deg * Math.PI) / 180;
const radToDeg = (rad) => (rad * 180) / Math.PI;
const round = (value, digits = 2) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};

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
  model: null,
  studio: null,
  supportSource: 'unknown',
  columnBank: null,
  still: urlParams.get('still') === '1',
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  // Rev21 s23: ?mode=sheets shows the three sheet models side by side (drag to rotate)
  mode: urlParams.get('mode') === 'sheets' ? 'sheets' : 'stack',
  playParam: urlParams.get('play'),
  reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches),
  autoplay: false,
  viewObserver: null,
  watchdog: 0,
  bootStartedAt: 0,
};

/** Static/deterministic modes never animate (contract: deterministic held frame). */
function isStaticMode() {
  return state.still || state.shot || state.reducedMotion;
}

/* ------------------------------------------------------------------- dom */

const dom = {};

function byId(id) {
  return document.getElementById(id);
}

function initDom() {
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
  dom.btnSheets = byId('btn-sheets');
  dom.replayState = byId('replay-state');
  dom.infoFootState = byId('info-foot-state');
  dom.footerStatus = byId('footer-status');
  dom.specLayers = byId('spec-layers');
  dom.specSheetSize = byId('spec-sheet-size');
  dom.specStackHeight = byId('spec-stack-height');
  dom.specCurvature = byId('spec-curvature');
  dom.specGap = byId('spec-gap');
  dom.specAcrylic = byId('spec-acrylic');
  dom.btnZoomIn = byId('btn-zoom-in');
  dom.btnZoomOut = byId('btn-zoom-out');
  dom.zoomValue = byId('zoom-value');
  dom.specSupport = byId('spec-support');
  dom.specSupportSource = byId('spec-support-source');
  dom.specCamera = byId('spec-camera');
  dom.specAnimation = byId('spec-animation');
  dom.specEnv = byId('spec-env');
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

/* -------------------------------------------------------------------- facts */

function syncObjectFacts() {
  const model = state.model;
  if (!model) return;
  if (dom.specLayers) dom.specLayers.textContent = '7 · ' + MODEL.SHEET_KINDS.map((kind) => kind).join(' · ');
  if (dom.specSheetSize) {
    dom.specSheetSize.textContent = MODEL.SHEET_SPEC.length.toFixed(1) + ' × ' + MODEL.SHEET_SPEC.width.toFixed(1) + ' × thin';
  }
  if (dom.specStackHeight) {
    const span = MODEL.sheetY(SHEET_COUNT - 1) - MODEL.sheetY(0) + MODEL.SHEET_SPEC.width;
    dom.specStackHeight.textContent = span.toFixed(2) + ' tall · 7 planes';
  }
  if (dom.specCurvature) {
    dom.specCurvature.textContent = 'paper ' + MODEL.PAPER_CURVATURE.map((value) => value.toFixed(2)).join(' / ') + ' · glow ' + MODEL.GLOW_CURVATURE.toFixed(2) + ' · acrylic flat';
  }
  if (dom.specGap) dom.specGap.textContent = MODEL.sheetGap().toFixed(2) + ' plane gap (equal)';
  if (dom.specAcrylic) {
    dom.specAcrylic.textContent = '3 clear plates · ' + MODEL.ACRYLIC_PLATE_THICKNESS.toFixed(2) + ' thick · dot grid ' + MODEL.ACRYLIC_PATTERN.dotPitch + ' px + doc-icon pattern';
  }
  if (dom.specSupport) {
    dom.specSupport.textContent = 'satin column · ' + model.supportInfo.length.toFixed(1) + ' × ' + model.supportInfo.width.toFixed(1) + ' · whole model';
  }
  if (dom.specSupportSource) {
    dom.specSupportSource.textContent = model.supportInfo.attached
      ? SUPPORT.columnId + ' (' + SUPPORT.materialId + ')'
      : 'satin column unavailable';
  }
  if (dom.specCamera) {
    dom.specCamera.textContent = MODEL.CAMERA_SPEC.azimuthDeg + '° / ' + MODEL.CAMERA_SPEC.elevationDeg + '° three-quarter';
  }
  if (dom.specAnimation) {
    dom.specAnimation.textContent = (MODEL.animationTotalMs() / 1000).toFixed(2) + ' s bottom-up · once';
  }
  if (dom.specEnv) dom.specEnv.textContent = 'image-based · ' + round(ENVIRONMENT.intensity, 1);
  if (dom.assetNote) {
    dom.assetNote.textContent = model.supportInfo.attached
      ? 'Seven Letter sheets · satin column platform · procedural decals · no network'
      : 'Seven Letter sheets · procedural decals · no network';
  }
}

/* --------------------------------------------------------------------- ui */

function syncUi() {
  const studio = state.studio;
  const animation = studio ? studio.getAnimationDebug() : { playing: false, progress: 0, held: false };
  const held = Boolean(studio && studio.held);
  if (dom.btnReplay) dom.btnReplay.disabled = !state.ready || state.failed;
  const zoom = studio ? studio.zoom : 1;
  if (dom.zoomValue) dom.zoomValue.textContent = Math.round(zoom * 100) + '%';
  if (dom.btnZoomIn) dom.btnZoomIn.disabled = !state.ready || state.failed || zoom >= ZOOM.max - 1e-6;
  if (dom.btnZoomOut) dom.btnZoomOut.disabled = !state.ready || state.failed || zoom <= ZOOM.min + 1e-6;
  if (dom.replayState) dom.replayState.textContent = animation.playing ? 'Entering' : held ? 'Held' : 'Ready';
  if (dom.infoFootState) {
    dom.infoFootState.textContent = state.failed
      ? 'Static fallback'
      : animation.playing
        ? 'Entering · ' + Math.round(animation.progress * 100) + '%'
        : held
          ? 'Held · layers settled'
          : 'Preparing';
  }
  if (dom.footerStatus) {
    dom.footerStatus.textContent = state.failed ? 'Static fallback' : state.ready ? (held ? 'Ready' : 'Loading') : 'Loading';
  }
  if (dom.stageHint) {
    dom.stageHint.textContent = held ? 'Replay to stack again' : animation.playing ? 'Layers entering' : 'Press Space to stack';
  }
}

/** Publish the body data-qa-* state that the capture/QA harness reads. */
function publishState() {
  if (!IS_BROWSER) return;
  const body = dom.body || document.body;
  const studio = state.studio;
  const animation = studio ? studio.getAnimationDebug() : null;
  const camera = studio ? studio.getCameraDebug() : null;
  const held = Boolean(studio && studio.held);
  const model = state.model;
  body.dataset.qaReady = state.ready ? '1' : '0';
  body.dataset.qaErrors = String(qa.errors.length);
  body.dataset.qaWarnings = String(qa.warnings.length);
  body.dataset.qaWebgl = state.webgl ? '1' : '0';
  body.dataset.qaFallback = state.failed ? '1' : '0';
  body.dataset.qaAnimation = animation && animation.playing ? 'entering' : held ? 'held' : 'intro';
  body.dataset.qaHeld = held ? '1' : '0';
  body.dataset.qaPlaying = animation && animation.playing ? '1' : '0';
  body.dataset.qaProgress = String(round(animation ? animation.progress : 0, 3));
  body.dataset.qaPlayedOnce = animation && animation.playedOnce ? '1' : '0';
  body.dataset.qaSheets = String(SHEET_COUNT);
  if (model) {
    body.dataset.qaLayers = model.sheets.map((sheet) => sheet.kind).join(',');
    body.dataset.qaKinds = 'paper:3,glow:1,acrylic:3';
    body.dataset.qaGap = String(round(MODEL.sheetGap(), 3));
    body.dataset.qaCurvature = MODEL.PAPER_CURVATURE.map((value) => value.toFixed(2)).join(',');
    body.dataset.qaSupport = 'satin-column';
    body.dataset.qaSupportSource = model.supportInfo.attached ? SUPPORT.columnId : 'pending';
    body.dataset.qaZoom = String(round(state.studio ? state.studio.zoom : 1, 3));
  } else {
    body.dataset.qaLayers = '';
    body.dataset.qaKinds = '';
    body.dataset.qaGap = '';
    body.dataset.qaCurvature = '';
    body.dataset.qaSupport = 'unknown';
    body.dataset.qaSupportSource = 'unknown';
    body.dataset.qaZoom = '1';
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

/* ---------------------------------------------------------------- textures */

/* ---------------------------------------------------------------- the studio */

class BillingStudio {
  constructor({ canvas, stage, model, reducedMotion = false, still = false, shot = false }) {
    this.canvas = canvas;
    this.stage = stage;
    this.model = model;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    /** Rev21 shared image-based lighting handle (src/env-room.js). */
    this.room = null;
    this.stageBox = { width: 0, height: 0 };
    this.cameraTarget = new THREE.Vector3();
    this.cameraDistance = 0;
    /** Zoom factor (1 = fitted framing); >1 moves the camera closer. */
    this.zoom = ZOOM.default;
    this.fitDistance = 0;
    this.pinch = { pointers: new Map(), startDistance: 0, startZoom: 1, active: false, count: 0 };
    this.zoomHandlers = null;
    this.zoomCount = 0;
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
    this.held = false;
    this.onChange = null;
    this.resizeObserver = null;
    this.animation = {
      playing: false,
      playedOnce: false,
      progress: 0,
      elapsedMs: 0,
      totalMs: MODEL.animationTotalMs(),
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

    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.4, CAMERA.near, CAMERA.far);
    camera.name = 'billing-camera';
    this.camera = camera;

    // Rev21: wait for the shared room photo (PMREM -> scene.environment) before
    // anything else; the page only reports ready after this resolves.
    this.room = await applyEnvRoom(THREE, renderer, scene, { intensity: ENVIRONMENT.intensity });

    scene.add(this.model.root);
    // r151: the room intensity is applied per material, so re-walk the now-built
    // scene (paper/glow/acrylic sheets + the satin column) to pick up its maps.
    this.room.refresh(scene);

    this.resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.stage);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
    this.resize();
    this.wireZoom();

    this.loop = this.loop.bind(this);
    this.raf = window.requestAnimationFrame(this.loop);
    return this;
  }

  requestRender() {
    this.needsRender = true;
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

  /* ------------------------------------------------- Rev21 s23 sheet showcase */

  /** Swap the 7-layer stack for the three sheet models side by side + trackball drag. */
  enterShowcase() {
    if (this.showcase) return this.showcase;
    const showcase = MODEL.createSheetShowcase({ createCanvas: () => document.createElement('canvas') });
    this.model.root.visible = false;
    this.scene.add(showcase.root);
    this.room.refresh(this.scene);
    const rest = quatNormalize(quatFromEulerYXZ(degToRad(MODEL.SHOWCASE_SPEC.tiltDeg.y), degToRad(MODEL.SHOWCASE_SPEC.tiltDeg.x), 0));
    this.showcase = showcase;
    this.showcaseView = {
      rest,
      current: rest.slice(),
      dragging: false,
      pointerId: null,
      lastPoint: null,
      dragCount: 0,
      moveCount: 0,
      resetCount: 0,
      handlers: null,
    };
    this.applyShowcaseOrientation();
    this.wireShowcaseDrag();
    this.fitCamera();
    return showcase;
  }

  applyShowcaseOrientation() {
    const q = this.showcaseView.current;
    this.showcase.pivot.quaternion.set(q[0], q[1], q[2], q[3]);
    this.showcase.root.updateMatrixWorld(true);
    this.requestRender();
  }

  fitShowcaseCamera() {
    const aspect = (this.stageBox.width || 1) / (this.stageBox.height || 1);
    const vHalf = degToRad(CAMERA.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    // frame the row's half-length (the rest view); a free rotation may swing past it
    const radius = this.showcase.bounds.getSize(new THREE.Vector3()).x / 2 * 1.4;
    const fit = clamp(radius / Math.tan(hHalf), 4, CAMERA.far * 0.7);
    this.fitDistance = fit;
    const distance = Math.max(CAMERA.near + 1, fit / this.zoom);
    this.cameraDistance = distance;
    this.cameraTarget.set(0, 0, 0);
    this.camera.aspect = aspect;
    this.camera.position.set(0, 0, distance);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  showcasePoint(event) {
    const rect = this.stage.getBoundingClientRect();
    return [
      clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1, -1, 1),
      clamp(-(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1), -1, 1),
    ];
  }

  wireShowcaseDrag() {
    const view = this.showcaseView;
    const onDown = (event) => {
      if (!this.motionAllowed()) return;
      if (this.pinch.active || this.pinch.pointers.size > 1) return;
      if (typeof event.button === 'number' && event.button !== 0) return;
      view.dragging = true;
      view.pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      view.lastPoint = this.showcasePoint(event);
      view.dragCount += 1;
      if (typeof this.canvas.setPointerCapture === 'function' && view.pointerId !== null) {
        try { this.canvas.setPointerCapture(view.pointerId); } catch (error) { /* best effort */ }
      }
    };
    const onMove = (event) => {
      if (!view.dragging) return;
      if (this.pinch.active) { view.dragging = false; return; }
      if (view.pointerId !== null && typeof event.pointerId === 'number' && event.pointerId !== view.pointerId) return;
      const point = this.showcasePoint(event);
      const previous = view.lastPoint || point;
      view.current = quatNormalize(quatMultiply(arcballDelta(previous[0], previous[1], point[0], point[1]), view.current));
      view.lastPoint = point;
      view.moveCount += 1;
      this.applyShowcaseOrientation();
    };
    const onUp = (event) => {
      if (!view.dragging) return;
      if (view.pointerId !== null && event && typeof event.pointerId === 'number' && event.pointerId !== view.pointerId) return;
      view.dragging = false;
      view.pointerId = null;
      view.lastPoint = null;
    };
    const onDouble = () => {
      view.current = view.rest.slice();
      view.resetCount += 1;
      this.applyShowcaseOrientation();
    };
    view.handlers = { onDown, onMove, onUp, onDouble };
    this.canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    this.canvas.addEventListener('dblclick', onDouble);
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'grab';
  }

  unwireShowcaseDrag() {
    const handlers = this.showcaseView && this.showcaseView.handlers;
    if (!handlers) return;
    this.canvas.removeEventListener('pointerdown', handlers.onDown);
    window.removeEventListener('pointermove', handlers.onMove);
    window.removeEventListener('pointerup', handlers.onUp);
    window.removeEventListener('pointercancel', handlers.onUp);
    this.canvas.removeEventListener('dblclick', handlers.onDouble);
    this.showcaseView.handlers = null;
  }

  /* -------------------------------------------------------------- zoom */

  /** Set the zoom factor (clamped to ZOOM_SPEC) and refit the camera. */
  setZoom(value) {
    const next = clamp(Number(value) || ZOOM.default, ZOOM.min, ZOOM.max);
    if (next !== this.zoom) this.zoomCount += 1;
    this.zoom = next;
    this.fitCamera();
    this.emitChange();
    return this.zoom;
  }

  zoomBy(factor) {
    return this.setZoom(this.zoom * factor);
  }

  wireZoom() {
    if (this.zoomHandlers) return;
    const pinch = this.pinch;
    const pinchDistance = () => {
      const points = Array.from(pinch.pointers.values());
      if (points.length < 2) return 0;
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    };
    const onWheel = (event) => {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 120 : event.deltaY;
      this.setZoom(this.zoom * Math.exp(-delta * ZOOM.wheelSpeed));
    };
    const onDown = (event) => {
      if (typeof event.pointerId !== 'number') return;
      pinch.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch.pointers.size === 2) {
        pinch.active = true;
        pinch.startDistance = pinchDistance();
        pinch.startZoom = this.zoom;
      }
    };
    const onMove = (event) => {
      if (!pinch.pointers.has(event.pointerId)) return;
      pinch.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch.active && pinch.startDistance > 4) {
        pinch.count += 1;
        this.setZoom(pinch.startZoom * (pinchDistance() / pinch.startDistance));
      }
    };
    const onUp = (event) => {
      pinch.pointers.delete(event.pointerId);
      if (pinch.pointers.size < 2) pinch.active = false;
    };
    this.stage.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    this.canvas.style.touchAction = 'none';
    this.zoomHandlers = { onWheel, onDown, onMove, onUp };
  }

  unwireZoom() {
    const handlers = this.zoomHandlers;
    if (!handlers) return;
    this.stage.removeEventListener('wheel', handlers.onWheel);
    this.canvas.removeEventListener('pointerdown', handlers.onDown);
    window.removeEventListener('pointermove', handlers.onMove);
    window.removeEventListener('pointerup', handlers.onUp);
    window.removeEventListener('pointercancel', handlers.onUp);
    this.zoomHandlers = null;
  }

  getZoomDebug() {
    return {
      zoom: round(this.zoom, 4),
      min: ZOOM.min,
      max: ZOOM.max,
      step: ZOOM.step,
      fitDistance: round(this.fitDistance, 3),
      distance: round(this.cameraDistance, 3),
      zoomCount: this.zoomCount,
      pinchCount: this.pinch.count,
      pinching: this.pinch.active,
      inputs: ['wheel', 'pinch', 'buttons'],
    };
  }

  /* ---------------------------------------------------------- camera fit */

  /**
   * Fit the fixed three-quarter camera so the whole layer stack + the satin column
   * block's visible top band fill the stage. The view direction is FIXED; only
   * the target offset and the distance are solved. For a point p, the view-space
   * offsets (xv, yv) and depth (d + c) give d >= |xv|/maxX - c and
   * d >= |yv|/maxY - c, so a closed form covers every fit point; a few projected-
   * centre iterations then centre the silhouette.
   */
  solveFitDistance(target, right, up, forward, maxX, maxY, points) {
    let distance = 4;
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
    if (this.showcase) {
      this.fitShowcaseCamera();
      return;
    }
    const center = this.model.bounds.getCenter(new THREE.Vector3());
    const baseTarget = new THREE.Vector3(center.x, center.y + CAMERA.targetYOffset, center.z);
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
    const points = this.model.fitPoints;
    const target = baseTarget.clone();
    const probe = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
    const projected = new THREE.Vector3();
    let distance = 4;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      distance = this.solveFitDistance(target, right, up, forward, maxX, maxY, points);
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
      target.addScaledVector(up, centerY * distance * tanHalf);
      target.addScaledVector(right, centerX * distance * tanHalf * aspect);
    }
    distance = this.solveFitDistance(target, right, up, forward, maxX, maxY, points);
    distance = clamp(distance, 4, CAMERA.far * 0.7);
    this.fitDistance = distance;
    distance = Math.max(CAMERA.near + 1, distance / this.zoom);
    this.cameraDistance = distance;
    this.cameraTarget.copy(target);
    this.camera.aspect = aspect;
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.requestRender();
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
    MODEL.applyStaticPose(this.model, mode);
    this.animation.playing = false;
    this.animation.elapsedMs = mode === 'initial' ? 0 : this.animation.totalMs;
    this.animation.progress = mode === 'initial' ? 0 : 1;
    this.held = mode !== 'initial';
    this.requestRender();
  }

  /** Start the bottom-up staggered entrance (Replay / play). */
  startEntrance({ restart = true } = {}) {
    if (!this.motionAllowed()) {
      this.applyStaticPose('final');
      this.animation.playedOnce = true;
      this.emitChange();
      return { durationMs: 0 };
    }
    if (restart) {
      MODEL.applyAnimationFrame(this.model, 0);
      this.animation.elapsedMs = 0;
      this.animation.progress = 0;
      this.held = false;
    }
    this.animation.playing = true;
    this.animation.playedOnce = true;
    this.animation.totalMs = MODEL.animationTotalMs();
    this.model.elapsedMs = this.animation.elapsedMs;
    this.requestRender();
    this.emitChange();
    return { durationMs: Math.max(0, this.animation.totalMs - this.animation.elapsedMs) };
  }

  updateAnimation(dtMs) {
    const animation = this.animation;
    if (!animation.playing) return;
    animation.elapsedMs = Math.min(animation.elapsedMs + dtMs, animation.totalMs);
    MODEL.applyAnimationFrame(this.model, animation.elapsedMs);
    animation.progress = clamp(animation.elapsedMs / (animation.totalMs || 1), 0, 1);
    if (animation.elapsedMs >= animation.totalMs) {
      animation.playing = false;
      animation.progress = 1;
      this.held = true;
      this.model.pose = 'final';
      this.emitChange();
    }
    this.requestRender();
  }

  loop(now) {
    if (this.destroyed) return;
    this.raf = window.requestAnimationFrame(this.loop);
    const previous = this.lastTime || now;
    const dt = Math.min(64, Math.max(0, now - previous));
    this.lastTime = now;
    if (this.animation.playing) this.updateAnimation(dt);
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
      phase: animation.playing ? 'entering' : this.held ? 'held' : 'intro',
      held: this.held,
      totalMs: round(animation.totalMs, 1),
      elapsedMs: round(animation.elapsedMs, 1),
      sheetDurationMs: MODEL.ANIMATION_SPEC.sheetDurationMs,
      staggerMs: MODEL.ANIMATION_SPEC.staggerMs,
      order: 'bottom -> top',
      mode: this.motionAllowed() ? 'animated' : 'static',
    };
  }

  getLayerDebug() {
    return this.model.sheets.map((sheet) => ({
      index: sheet.index,
      kind: sheet.kind,
      planeY: round(sheet.planeY, 3),
      yawDeg: round(sheet.yawDeg, 2),
      curvature: round(sheet.curvature, 3),
      thickness: sheet.thickness,
      position: {
        x: round(sheet.group.position.x, 3),
        y: round(sheet.group.position.y, 3),
        z: round(sheet.group.position.z, 3),
      },
      visible: sheet.group.visible !== false,
      sheetClass: sheet.sheetClass,
      hasAcrylicPlate: Boolean(sheet.acrylic && sheet.kind === 'acrylic'),
      hasAcrylicPattern: Boolean(sheet.acrylicPattern),
      hasAcrylic: Boolean(sheet.acrylic),
      hasDecal: Boolean(sheet.decal),
      material: sheet.material && sheet.material.name ? sheet.material.name : null,
      rimMaterial: sheet.rimMaterial && sheet.rimMaterial.name ? sheet.rimMaterial.name : null,
      decalTexture: sheet.decal && sheet.decal.material && sheet.decal.material.map
        ? sheet.decal.material.map.name
        : null,
    }));
  }

  getSupportDebug() {
    const info = this.model.supportInfo;
    return {
      kind: info.kind,
      source: info.source,
      columnId: info.columnId,
      materialId: info.materialId,
      attached: info.attached,
      materialName: info.materialName,
      scale: info.scale,
      laidHorizontal: info.laidHorizontal,
      length: info.length,
      width: info.width,
      depth: info.depth,
      height: info.height,
      topY: info.topY,
      cropY: info.cropY,
      cropped: info.cropped,
      center: info.center,
      materialNames: info.materialNames,
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

  /** Screen-space bbox of the model (all layers + the support's visible band). */
  getObjectScreenRect() {
    if (!this.camera) return null;
    const width = this.stageBox.width || 1;
    const height = this.stageBox.height || 1;
    const points = this.model.fitPoints;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const projected = new THREE.Vector3();
    for (let index = 0; index < points.length; index += 3) {
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
      width: round(maxX - minX, 2),
      height: round(maxY - minY, 2),
      left: round(minX, 2),
      top: round(minY, 2),
      right: round(maxX, 2),
      bottom: round(maxY, 2),
      stageWidth: round(width, 2),
      stageHeight: round(height, 2),
    };
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
    this.unwireZoom();
    if (this.showcase) {
      this.unwireShowcaseDrag();
      if (this.scene) this.scene.remove(this.showcase.root);
      this.showcase.dispose();
      this.showcase = null;
    }
    if (this.model && this.model.root && this.scene) this.scene.remove(this.model.root);
    if (this.room) {
      this.room.dispose();
      this.room = null;
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
  const studio = new BillingStudio({
    canvas: dom.canvas,
    stage: dom.stage,
    model: state.model,
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
  studio.startEntrance({ restart: true });
  syncUi();
  publishState();
  announce('Layers entering bottom-up');
  return studio.waitForIdle().then(() => {
    syncUi();
    publishState();
    return true;
  });
}

function doReplay() {
  const studio = state.studio;
  if (!studio || state.failed) return Promise.resolve(false);
  studio.startEntrance({ restart: true });
  syncUi();
  publishState();
  announce('Replaying the layer entrance');
  return studio.waitForIdle().then(() => {
    syncUi();
    publishState();
    return true;
  });
}

function buildDebug() {
  const studio = state.studio;
  const model = state.model;
  const debug = {
    version: VERSION,
    ready: Boolean(state.ready),
    errors: qa.errors.slice(),
    warnings: qa.warnings.slice(),
    webgl: {
      supported: Boolean(studio && studio.renderer) || Boolean(state.webgl),
      version: state.webgl || '',
    },
    // Rev21: image-based lighting only — zero THREE light objects.
    mode: state.mode,
    zoom: studio ? studio.getZoomDebug() : null,
    showcase: studio && studio.showcase
      ? {
          kinds: studio.showcase.kinds.slice(),
          sheetCount: studio.showcase.sheets.length,
          xs: studio.showcase.sheets.map((sheet) => round(sheet.group.position.x, 4)),
          drag: {
            dragging: studio.showcaseView.dragging,
            dragCount: studio.showcaseView.dragCount,
            moveCount: studio.showcaseView.moveCount,
            resetCount: studio.showcaseView.resetCount,
            quaternion: studio.showcaseView.current.map((value) => round(value, 6)),
          },
        }
      : null,
    environment: {
      mode: 'image-based',
      source: ENVIRONMENT_LABEL,
      intensity: ENVIRONMENT.intensity,
      exposure: RENDERER.exposure,
      lights: 0,
    },
    model: {
      version: MODEL.MODEL_VERSION,
      sheetCount: MODEL.SHEET_COUNT,
      kinds: MODEL.SHEET_KINDS.slice(),
      counts: MODEL.KIND_COUNTS,
      sheetSpec: MODEL.SHEET_SPEC,
      layout: MODEL.LAYOUT,
      paperCurvature: MODEL.PAPER_CURVATURE.slice(),
      glowCurvature: MODEL.GLOW_CURVATURE,
      acrylicCurvature: MODEL.ACRYLIC_PLATE.curvature,
      letterAspect: MODEL.LETTER_ASPECT,
      zoomSpec: MODEL.ZOOM_SPEC,
      supportSpec: MODEL.SUPPORT_SPEC,
      cameraSpec: MODEL.CAMERA_SPEC,
      animationSpec: MODEL.ANIMATION_SPEC,
      decalSpec: MODEL.DECAL_SPEC,
      animationTotalMs: MODEL.animationTotalMs(),
      gaps: Array.from({ length: MODEL.SHEET_COUNT - 1 }, (_, index) =>
        round(MODEL.sheetY(index + 1) - MODEL.sheetY(index), 4)),
    },
    layers: studio ? studio.getLayerDebug() : [],
    support: studio ? studio.getSupportDebug() : null,
    animation: studio
      ? studio.getAnimationDebug()
      : { playing: false, progress: 0, playedOnce: false, phase: 'intro', held: false },
    camera: studio ? studio.getCameraDebug() : null,
    objectRect: studio ? studio.getObjectScreenRect() : null,
    materials: model
      ? {
          glow: {
            type: 'MeshStandardMaterial',
            emissive: '#' + model.materials.glow.emissive.getHexString(),
            emissiveIntensity: model.materials.glow.emissiveIntensity,
            hasEmissiveMap: Boolean(model.materials.glow.emissiveMap),
          },
          acrylicPlate: {
            type: 'MeshPhysicalMaterial',
            opacity: model.materials.acrylic.opacity,
            transparent: model.materials.acrylic.transparent,
            clearcoat: model.materials.acrylic.clearcoat,
            thickness: MODEL.ACRYLIC_PLATE_THICKNESS,
            topY: MODEL.ACRYLIC_PLATE.topY,
            bottomY: MODEL.ACRYLIC_PLATE.bottomY,
            hasPatternMap: Boolean(model.sheets[4] && model.sheets[4].acrylicPattern),
            patternLineWidth: MODEL.ACRYLIC_PATTERN.lineWidth,
            patternInk: MODEL.ACRYLIC_PATTERN.ink,
          },
          acrylic: {
            type: 'MeshPhysicalMaterial',
            opacity: model.materials.acrylic.opacity,
            transparent: model.materials.acrylic.transparent,
            clearcoat: model.materials.acrylic.clearcoat,
          },
          paper: {
            type: 'MeshStandardMaterial',
            roughness: model.materials.paper.roughness,
            metalness: model.materials.paper.metalness,
            hasSurfaceMap: Boolean(model.materials.paper.map),
            hasDecalLayer: Boolean(model.sheets[0] && model.sheets[0].decal),
          },
          counts: {
            materials: Object.keys(model.materials).length,
            textures: model.textures.length,
            decalTextures: model.decalTextures.length,
          },
        }
      : null,
    textures: model
      ? model.decalTextures.map((texture) => ({
          name: texture.name,
          kind: texture.userData && texture.userData.kind,
          seed: texture.userData && texture.userData.seed,
          noReadableText: texture.userData && texture.userData.noReadableText === true,
        }))
      : [],
    objects: studio
      ? {
          layers: MODEL.SHEET_COUNT,
          paper: 3,
          glow: 1,
          acrylic: 3,
          support: 1,
          supportKind: 'satin-column',
          decals: model ? model.sheets.reduce((total, sheet) => total + sheet.decals.length, 0) : 0,
          lights: {
            total: 0,
            directional: 0,
            ambient: 0,
            point: 0,
            spot: 0,
            hemisphere: 0,
            rectArea: 0,
            environment: ENVIRONMENT_LABEL,
          },
          render: studio.getRenderDebug(),
        }
      : null,
    flags: {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      qaMode: Boolean(state.qaMode),
      reducedMotion: Boolean(state.reducedMotion),
      autoplay: Boolean(state.autoplay),
      fallback: Boolean(state.failed),
      play: state.playParam !== null ? state.playParam : 'auto',
      held: Boolean(studio && studio.held),
    },
    urls: {
      page: IS_BROWSER ? window.location.href : '',
      columns: IS_BROWSER ? new URL('./columns-model.js', import.meta.url).href : '',
    },
    stageRect: null,
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

function triggerEntrance(source) {
  const studio = state.studio;
  if (!studio || state.failed) return;
  if (source !== 'manual' && !state.autoplay) return;
  if (studio.animation.playedOnce) return;
  state.autoplay = false;
  publishState();
  studio.startEntrance({ restart: false });
  syncUi();
  publishState();
  announce(source === 'viewport' ? 'Layers entering' : 'Layers entered');
}

function setupViewportTrigger() {
  if (!state.autoplay) {
    publishState();
    return;
  }
  if (!dom.stage || typeof IntersectionObserver !== 'function') {
    triggerEntrance('no-observer');
    return;
  }
  try {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            observer.disconnect();
            state.viewObserver = null;
            triggerEntrance('viewport');
            return;
          }
        }
      },
      { threshold: [0, 0.2, 0.35, 0.6, 1] },
    );
    observer.observe(dom.stage);
    state.viewObserver = observer;
  } catch (error) {
    pushWarning('IntersectionObserver failed, entering immediately: ' + errorMessage(error));
    triggerEntrance('no-observer');
  }
}

/* --------------------------------------------------------------------- ui */

function wireUi() {
  if (dom.btnSheets) {
    // Rev21 s23: toggle between the 7-layer stack and the 3 sheet models (page reload, ?mode=sheets).
    if (state.mode === 'sheets') {
      dom.btnSheets.setAttribute('aria-pressed', 'true');
      const label = dom.btnSheets.querySelector('span');
      if (label) label.textContent = 'Layer stack';
    }
    dom.btnSheets.addEventListener('click', () => {
      const next = new URL(window.location.href);
      if (state.mode === 'sheets') next.searchParams.delete('mode');
      else next.searchParams.set('mode', 'sheets');
      window.location.href = next.toString();
    });
  }
  if (dom.btnZoomIn) {
    dom.btnZoomIn.addEventListener('click', () => {
      if (state.studio) state.studio.zoomBy(ZOOM.step);
      syncUi();
      publishState();
    });
  }
  if (dom.btnZoomOut) {
    dom.btnZoomOut.addEventListener('click', () => {
      if (state.studio) state.studio.zoomBy(1 / ZOOM.step);
      syncUi();
      publishState();
    });
  }
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
          state.studio.applyStaticPose('final');
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

async function boot() {
  state.bootStartedAt = performance.now();
  state.booting = true;
  api.ready = false;

  // Deterministic flags first: the body attributes must be correct while the
  // curtain is still up (QA polls them).
  dom.body.dataset.fallback = '0';
  dom.body.dataset.qaReady = '0';
  dom.body.dataset.qaAnimation = 'intro';
  dom.body.dataset.qaHeld = '0';
  dom.body.dataset.qaSupport = 'unknown';
  dom.body.dataset.qaSupportSource = 'unknown';
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
    showFallback('WebGL is not available in this browser, so the interactive billing layer stack cannot be rendered. A static poster of the seven layers is shown below.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.08, 'Loading type', '');
  await waitForFonts();

  curtainProgress(0.56, 'Building the layers', '');
  let model = null;
  try {
    model = MODEL.createBillingModel({
      createCanvas: () => document.createElement('canvas'),
    });
    state.model = model;
    state.supportSource = 'pending';
  } catch (error) {
    showFallback('The billing layer model could not be built (' + errorMessage(error) + '). A static poster is shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }
  if (!model || !Array.isArray(model.sheets) || model.sheets.length !== SHEET_COUNT) {
    showFallback('The billing model did not produce the expected seven layers.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.76, 'Starting the studio', '');
  try {
    state.studio = createStudio();
    await state.studio.init();
    // The platform is the WHOLE satin column from the columns bank (src/columns-model.js).
    curtainProgress(0.82, 'Loading the satin column platform', '');
    try {
      state.columnBank = await loadColumnBank({
        onProgress(loaded, total) {
          curtainProgress(0.82 + 0.08 * (total ? clamp(loaded / total, 0, 1) : 1), 'Loading the satin column platform', loaded + ' / ' + total);
        },
      });
      model.attachColumnPlatform(state.columnBank);
      state.supportSource = SUPPORT.columnId;
      state.studio.room.refresh(state.studio.scene);
    } catch (error) {
      pushWarning('satin column platform unavailable (' + errorMessage(error) + '); the sheets are shown without the platform');
    }
    if (state.mode === 'sheets') state.studio.enterShowcase();
    const contextLost = (event) => {
      event.preventDefault();
      showFallback('WebGL context was lost, so a static poster of the layer stack is shown below.');
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
  // Deterministic / initial states:
  //   still | shot | reduced-motion -> final held frame, no entrance
  //   ?play=0                      -> empty pre-entrance frame, no autoplay
  //   default                      -> entrance once on viewport entry
  if (isStaticMode()) {
    studio.applyStaticPose('final');
    studio.animation.playedOnce = true;
    state.autoplay = false;
  } else if (state.playParam === '0') {
    studio.applyStaticPose('initial');
    studio.animation.playedOnce = false;
    state.autoplay = false;
  } else {
    studio.applyStaticPose('initial');
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
  announce('Billing layers ready');
  studio.renderNow();
  resolveReady(true);

  // Viewport-triggered entrance (once). Deterministic modes never autoplay.
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
    if (state.columnBank) {
      try {
        state.columnBank.dispose();
      } catch (error) {
        /* best effort */
      }
      state.columnBank = null;
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

export { VERSION, BillingStudio };
