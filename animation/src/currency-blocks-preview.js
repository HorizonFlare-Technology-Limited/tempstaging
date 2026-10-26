/**
 * tekoanimation — Currency Blocks preview controller.
 *
 * Standalone collection page controller for `currency-blocks.html`: a dark metal
 * studio showing FIVE glossy black rounded-square currency blocks that play one
 * shared "gather and settle" timeline (loose intro -> bottom-up gather into a
 * flush puck -> tight hold -> top-down settle onto the fig3 rest pose). The page
 * is the canonical replacement for the retired Stacked page: BOTH layouts are
 * stacked vertical totems (v2 — there is no flat row any more). "Vertical" is the
 * plumb fig3 totem; "horizontal" is the same stack fanned progressively along X
 * (a horizontal-direction stacked composition). Each top face carries one Lexend
 * currency glyph (£ $ € ¥ ₽) as a bright polished-metal inlay, centred on the
 * plate (v2: no viewer-side forward offset), and the block body colour is the same
 * near-black metal for every block (the reference's lighter/blue tones are lighting
 * only).
 *
 * The model (geometry, procedural maps, Lexend glyph inlays, deterministic poses
 * and the shared timeline) lives in ./currency-blocks-model.js. This file owns the
 * renderer, the PMREM dark-metal studio (damped RoomEnvironment + five HDR softbox
 * panels, unlit floor pool + baked contact shadow + faint additive blue
 * under-glow), the closed-form camera fit, clamped drag-to-orbit, the animation
 * clock, the layout toggle and the QA surface.
 *
 * Camera: fixed three-quarter view (fov/azimuth/elevation/near/far from
 * Model.CAMERA_SPEC — v2 sits at 42°/30°, lowered from 38° so the centred glyph on
 * a 0.26-thick plate is never clipped by the plate above), fitted in closed form
 * to the rest-pose bounds of the current layout with CAMERA_SPEC.fitMargin, then
 * one centring pass. Drag orbit is clamped to ±16° azimuth / ±7° elevation and
 * refits each step; R / Reset / #btn-reset return to the fixed view. Resizing or
 * switching layout refits.
 *
 * Clock: `time` in [0, TIMELINE_SPEC.duration]; RAF advances by at most 0.05 s per
 * frame and calls model.setTime(time). At the end the time is exactly the duration
 * and the loop stops (no idle float). Static modes (?still=1, ?shot=1,
 * prefers-reduced-motion, ?t=<s> and ?play=0) render exactly once and never start
 * the loop, so captures are byte-identical across reloads.
 *
 * QA hook: window.__tekoCurrencyBlocks = { version, ready, errors, warnings,
 * readyPromise(), play(), replay(), setLayout(), getLayout(), resetView(),
 * setTime(), debug() } plus body[data-qa-*] attributes and the hidden #qa-diag
 * JSON mirror. Early page capture arrays (window.__TEKO_CURRENCY_BLOCKS_QA) are
 * reused; the module only installs its own capture when the page has none.
 */
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import * as Model from './currency-blocks-model.js';

const VERSION = '2.0.0';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ------------------------------------------------------------------ spec */

const DURATION = Model.TIMELINE_SPEC.duration;
const TIMELINE = Model.TIMELINE_SPEC;
const CAMERA = Model.CAMERA_SPEC;
const BLOCK_COUNT = Model.BLOCK_COUNT;
const LAYOUTS = Model.LAYOUTS.slice();
const BLOCK_SPEC = Model.BLOCK_SPEC;
const FONT_SPEC = Model.FONT_SPEC;
const SYMBOLS = Model.CURRENCY_SPECS.map((currency) => currency.symbol);
const SYMBOL_CODES = Model.CURRENCY_SPECS.map((currency) => currency.code);
const SYMBOL_CHAIN = SYMBOLS.join(' · ');

/* --------------------------------------------------------- render tuning */

const RENDERER = Object.freeze({ exposure: 1.0, dprMax: 2 });

// A damped RoomEnvironment plus five HDR softbox panels. Small solid-angle panels
// read as clean rectangular highlights on the glossy black top faces (the
// reference's white sheen), while the low blue strips paint the side-wall rim
// light. sigma stays under three.js' 20-sample PMREM blur limit so no console
// warning is emitted.
const ENVIRONMENT = Object.freeze({
  lightScale: 0.3,
  panelScale: 0.26,
  softboxScale: 1.2,
  sigma: 0.035,
});
const SOFTBOXES = Object.freeze([
  Object.freeze({ position: [-9, 9.5, 8], lookAt: [0, 0.4, 0], scale: [6, 4], color: 0xfff3e6, intensity: 10 }),
  Object.freeze({ position: [8, 7.5, 7], lookAt: [0, 0.4, 0], scale: [4.4, 4.2], color: 0xbfd6ff, intensity: 6 }),
  Object.freeze({ position: [-1.5, 13, -1], lookAt: [0, 0, 0], scale: [8.5, 2.4], color: 0xffffff, intensity: 13 }),
  Object.freeze({ position: [0, -4, -11], lookAt: [0, -0.4, 0], scale: [10, 2.8], color: 0x2a59ff, intensity: 8 }),
  Object.freeze({ position: [-11, 2, -8], lookAt: [0, 0, 0], scale: [4.5, 6], color: 0x6f9dff, intensity: 4 }),
]);
const LIGHTS = Object.freeze({
  key: { color: 0xfff1e2, intensity: 1.7, position: [-7, 11, 8], target: [0, 0.5, 0] },
  fill: { color: 0xbcd2f2, intensity: 0.7, position: [8, 5, 7], target: [0, 0.3, 0] },
  rim: { color: 0x6f9dff, intensity: 2.0, position: [4, 6, -9], target: [0, 0.4, 0] },
  under: { color: 0x2a59ff, intensity: 1.15, position: [-3, -6, -5], target: [0, -1, 0] },
  ambient: { color: 0x2b3342, intensity: 0.26 },
});
const FLOOR = Object.freeze({
  yOffset: 0.42,
  poolOpacity: 0.55,
  shadowOpacity: 0.78,
  glowOpacity: 0.4,
  poolScale: 1.6,
  widthPad: 2.2,
  depthPad: 2.4,
  minWidth: 2.4,
  minDepth: 2.0,
  shadowZ: 0.1,
  glowZ: 0.2,
  poolStops: Object.freeze([
    Object.freeze([0, 'rgba(132, 158, 205, 0.24)']),
    Object.freeze([0.38, 'rgba(98, 124, 172, 0.12)']),
    Object.freeze([0.7, 'rgba(56, 74, 108, 0.045)']),
    Object.freeze([1, 'rgba(8, 9, 12, 0)']),
  ]),
  shadowStops: Object.freeze([
    Object.freeze([0, 'rgba(0, 0, 0, 0.92)']),
    Object.freeze([0.42, 'rgba(0, 0, 0, 0.62)']),
    Object.freeze([0.72, 'rgba(0, 0, 0, 0.22)']),
    Object.freeze([1, 'rgba(0, 0, 0, 0)']),
  ]),
  glowStops: Object.freeze([
    Object.freeze([0, 'rgba(46, 92, 255, 0.5)']),
    Object.freeze([0.4, 'rgba(36, 74, 220, 0.24)']),
    Object.freeze([0.75, 'rgba(24, 48, 132, 0.06)']),
    Object.freeze([1, 'rgba(10, 16, 40, 0)']),
  ]),
});

/* --------------------------------------------------------------- helpers */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degToRad = (deg) => (deg * Math.PI) / 180;
const round = (value, digits = 2) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};
const trim = (value) => String(Math.round(value * 1000) / 1000);
const firstNumber = (...values) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
};

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

function describeValue(value) {
  if (value && typeof value === 'object') {
    if (value.message) return String(value.message);
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
  return String(value);
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

function makeRadialTexture(stops, name, size = 512) {
  if (!IS_BROWSER || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, size, size);
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/* ---------------------------------------------------------- early qa state */

const earlyQA = IS_BROWSER ? window.__TEKO_CURRENCY_BLOCKS_QA : null;
const hasEarlyCapture = Boolean(earlyQA && typeof earlyQA === 'object' && Array.isArray(earlyQA.errors));
const qa = hasEarlyCapture ? earlyQA : { errors: [], warnings: [], webgl: null };
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];
if (IS_BROWSER && !hasEarlyCapture) window.__TEKO_CURRENCY_BLOCKS_QA = qa;

function pushError(message) {
  qa.errors.push('currency-blocks-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}

function pushWarning(message) {
  qa.warnings.push('currency-blocks-preview: ' + message);
  if (qa.warnings.length > 60) qa.warnings.splice(0, qa.warnings.length - 60);
}

/* Install the same capture surface as the page's early script, but only when the
   page did not provide it (so errors are never double-counted). */
function installCaptureFallback() {
  if (!IS_BROWSER || hasEarlyCapture) return;
  window.addEventListener(
    'error',
    (event) => {
      if (event && event.target && event.target !== window && event.target.tagName) {
        const source = event.target.currentSrc || event.target.src || event.target.href || event.target.tagName;
        pushError('failed to load ' + source);
        return;
      }
      const where = event && event.filename ? ' (' + event.filename + ':' + (event.lineno || 0) + ')' : '';
      pushError((event && event.message ? event.message : 'unknown error') + where);
    },
    true,
  );
  window.addEventListener('unhandledrejection', (event) => {
    pushError('unhandledrejection: ' + describeValue(event && event.reason));
  });
  if (!window.__tekoCurrencyBlocksConsoleCapture) {
    window.__tekoCurrencyBlocksConsoleCapture = true;
    const nativeError = console.error.bind(console);
    const nativeWarn = console.warn.bind(console);
    console.error = function onError() {
      pushError('console.error: ' + Array.prototype.map.call(arguments, describeValue).join(' '));
      nativeError.apply(null, arguments);
    };
    console.warn = function onWarn() {
      pushWarning('console.warn: ' + Array.prototype.map.call(arguments, describeValue).join(' '));
      nativeWarn.apply(null, arguments);
    };
  }
}

/* ---------------------------------------------------------- viewport/state */

const urlParams = IS_BROWSER ? new URLSearchParams(window.location.search) : new URLSearchParams();
const requestedLayout = (() => {
  const raw = urlParams.get('layout');
  return raw && LAYOUTS.indexOf(raw) !== -1 ? raw : null;
})();
const numericT = (() => {
  const raw = urlParams.get('t');
  if (raw === null || raw === '') return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? clamp(value, 0, DURATION) : null;
})();
const playRaw = urlParams.get('play');
const playParam = playRaw === '0' ? '0' : playRaw === '1' ? '1' : null;

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
  font: null,
  model: null,
  studio: null,
  still: urlParams.get('still') === '1',
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  playParam,
  tParam: numericT,
  qaSetTime: null,
  layout: requestedLayout || LAYOUTS[0],
  reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches),
  autoplay: false,
  autoPlays: 0,
  animationReason: 'initial',
  viewObserver: null,
  watchdog: 0,
  publishTimer: 0,
  pollTimer: 0,
  lastPublishAt: 0,
  bootStartedAt: 0,
};

/** Static modes never animate: ?still=1, ?shot=1, prefers-reduced-motion. */
function isStaticMode() {
  return state.still || state.shot || state.reducedMotion;
}

/** True when the clock is parked at a fixed time for any reason. */
function isFrozen() {
  return isStaticMode() || state.playParam === '0' || state.tParam !== null || state.qaSetTime !== null;
}

function frozenReason() {
  if (state.qaSetTime !== null) return 'setTime';
  if (state.tParam !== null) return 't=' + trim(state.tParam);
  if (state.playParam === '0') return 'play=0';
  if (state.reducedMotion) return 'reduced-motion';
  if (state.still) return 'still';
  if (state.shot) return 'shot';
  return 'static';
}

/** The frame a frozen page must show: ?t wins, then ?play=0 (loose), then rest. */
function staticTargetTime() {
  if (state.qaSetTime !== null) return clamp(state.qaSetTime, 0, DURATION);
  if (state.tParam !== null) return clamp(state.tParam, 0, DURATION);
  if (state.playParam === '0') return 0;
  return DURATION;
}

/** Derive the choreography phase from the clock (no extra state). */
function derivePhase(time) {
  if (time >= DURATION - 1e-9) return 'rest';
  if (time < TIMELINE.startHoldEnd) return 'loose';
  if (time < TIMELINE.tightHold.start) return 'gather';
  if (time <= TIMELINE.tightHold.end) return 'tight';
  return 'settle';
}

function layoutLabel(name) {
  return name === 'horizontal' ? 'Horizontal' : 'Vertical';
}

/* ------------------------------------------------------------------- dom */

const dom = {};

function initDom() {
  if (!IS_BROWSER) return;
  const byId = (id) => document.getElementById(id);
  dom.body = document.body;
  dom.stage = byId('stage');
  dom.canvas = byId('stage-canvas');
  dom.veil = byId('stage-veil');
  dom.veilText = byId('veil-text');
  if (dom.veil) {
    dom.veil.hidden = false;
    dom.veil.classList.remove('is-hidden');
  }
  dom.stageEyebrow = byId('stage-eyebrow-text');
  dom.stageIndex = byId('stage-index');
  dom.stageCaption = byId('stage-caption');
  dom.stageCode = byId('stage-code');
  dom.stageName = byId('stage-name');
  dom.stageDetail = byId('stage-detail');
  dom.stageHint = byId('stage-hint');
  dom.btnLayoutVertical = byId('btn-layout-vertical');
  dom.btnLayoutHorizontal = byId('btn-layout-horizontal');
  dom.btnReplay = byId('btn-replay');
  dom.btnReset = byId('btn-reset');
  dom.viewState = byId('view-state');
  dom.infoFootState = byId('info-foot-state');
  dom.specLayout = byId('spec-layout');
  dom.specBlocks = byId('spec-blocks');
  dom.specBlockSize = byId('spec-block-size');
  dom.specCornerRadius = byId('spec-corner-radius');
  dom.specThickness = byId('spec-thickness');
  dom.specRestPitch = byId('spec-rest-pitch');
  dom.specTightPitch = byId('spec-tight-pitch');
  dom.specTravel = byId('spec-travel');
  dom.specDuration = byId('spec-duration');
  dom.specEasing = byId('spec-easing');
  dom.specCamera = byId('spec-camera');
  dom.specMotion = byId('spec-motion');
  dom.specSymbols = byId('spec-symbols');
  dom.footerStatus = byId('footer-status');
  dom.fallback = byId('fallback');
  dom.fallbackMessage = byId('fallback-message');
  dom.errorBanner = byId('error-banner');
  dom.errorText = byId('error-text');
  dom.loading = byId('loading');
  dom.loadingBar = byId('loading-bar');
  dom.loadingLabel = byId('loading-label');
  dom.loadingCount = byId('loading-count');
  dom.loadingTitle = byId('loading-title');
  dom.diag = byId('qa-diag');
  dom.liveStatus = byId('live-status');
}

function setText(element, value) {
  if (element && value !== undefined && value !== null) element.textContent = String(value);
}

function curtainProgress(ratio, label, count, title) {
  const safeRatio = clamp(Number(ratio) || 0, 0, 1);
  if (dom.loadingBar) dom.loadingBar.style.width = (safeRatio * 100).toFixed(1) + '%';
  if (label && dom.loadingLabel) dom.loadingLabel.textContent = label;
  if (count !== undefined && dom.loadingCount) dom.loadingCount.textContent = String(count);
  if (title && dom.loadingTitle) dom.loadingTitle.textContent = title;
}

function hideCurtain() {
  if (dom.loading) {
    dom.loading.classList.add('is-hidden');
    dom.loading.hidden = true;
  }
  hideVeil();
}

function hideVeil() {
  if (!dom.veil) return;
  dom.veil.classList.add('is-hidden');
  dom.veil.hidden = true;
}

function announce(message) {
  if (dom.liveStatus) dom.liveStatus.textContent = message;
}

/* --------------------------------------------------------------- the studio */

class CurrencyBlocksStudio {
  constructor({ canvas, stage, model, layout, reducedMotion = false, still = false, shot = false }) {
    this.canvas = canvas;
    this.stage = stage;
    this.model = model;
    this.layout = layout || 'vertical';
    this.duration = DURATION;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.envRT = null;
    this.floorPool = null;
    this.contactShadow = null;
    this.underGlow = null;
    this.poolTexture = null;
    this.shadowTexture = null;
    this.glowTexture = null;
    this.lights = {};
    this.stageBox = { width: 1, height: 1 };
    this.cameraTarget = new THREE.Vector3(0, CAMERA.targetY, 0);
    this.cameraDistance = 10;
    this.viewBasis = {
      dir: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
    };
    this.renderCount = 0;
    this.firstFrameResolve = null;
    this.firstFramePromise = null;
    this.firstFrameRendered = false;
    this.needsRender = true;
    this.raf = 0;
    this.lastStamp = 0;
    this.destroyed = false;
    this.reducedMotion = Boolean(reducedMotion);
    this.still = Boolean(still);
    this.shot = Boolean(shot);
    this.dragging = false;
    this.pointerId = null;
    this.lastPointer = { x: 0, y: 0 };
    this.orbit = { azimuthDeg: 0, elevationDeg: 0 };
    this.resizeObserver = null;
    this.onWindowResize = null;
    this.time = 0;
    this.playing = false;
    this.playCount = 0;
    this.onChange = null;
    this.boundLoop = this.loop.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
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
    scene.name = 'currency-blocks-studio';
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.2, CAMERA.near, CAMERA.far);
    camera.name = 'currency-blocks-camera';
    this.camera = camera;

    this.buildEnvironment();
    this.buildLights();
    this.buildFloor();

    this.model.setTime(0);
    scene.add(this.model.root);

    this.bindPointer();

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.stage);
    } else {
      this.onWindowResize = () => this.resize();
      window.addEventListener('resize', this.onWindowResize);
    }
    this.resize();
    return this;
  }

  /** Damped RoomEnvironment + HDR softbox panels -> PMREM scene environment. */
  buildEnvironment() {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    const room = new RoomEnvironment();
    room.traverse((object) => {
      if (object.isLight && typeof object.intensity === 'number') object.intensity *= ENVIRONMENT.lightScale;
      if (
        object.isMesh &&
        object.material &&
        object.material.isMeshBasicMaterial &&
        object.material.color &&
        typeof object.material.color.multiplyScalar === 'function'
      ) {
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
    this.envRT = pmremGenerator.fromScene(room, ENVIRONMENT.sigma);
    this.scene.environment = this.envRT.texture;
    room.dispose();
    pmremGenerator.dispose();
  }

  buildLights() {
    const addDirectional = (name, spec) => {
      const light = new THREE.DirectionalLight(spec.color, spec.intensity);
      light.name = 'currency-blocks-light-' + name;
      light.position.set(spec.position[0], spec.position[1], spec.position[2]);
      light.target.position.set(spec.target[0], spec.target[1], spec.target[2]);
      this.scene.add(light);
      this.scene.add(light.target);
      this.lights[name] = light;
      return light;
    };
    addDirectional('key', LIGHTS.key);
    addDirectional('fill', LIGHTS.fill);
    addDirectional('rim', LIGHTS.rim);
    addDirectional('under', LIGHTS.under);
    const ambient = new THREE.AmbientLight(LIGHTS.ambient.color, LIGHTS.ambient.intensity);
    ambient.name = 'currency-blocks-light-ambient';
    this.scene.add(ambient);
    this.lights.ambient = ambient;
  }

  /**
   * Soft unlit floor pool + baked contact shadow + faint additive blue
   * under-glow. The planes are unit-sized and scaled per layout (no shadow-map
   * floor, no extra render pass).
   */
  buildFloor() {
    this.poolTexture = makeRadialTexture(FLOOR.poolStops, 'currency-blocks-floor-pool');
    this.shadowTexture = makeRadialTexture(FLOOR.shadowStops, 'currency-blocks-contact-shadow');
    this.glowTexture = makeRadialTexture(FLOOR.glowStops, 'currency-blocks-under-glow');

    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.MeshBasicMaterial({
        map: this.poolTexture,
        transparent: true,
        depthWrite: false,
        opacity: FLOOR.poolOpacity,
        toneMapped: false,
      }),
    );
    pool.name = 'currency-blocks-floor-pool';
    pool.rotation.x = -Math.PI / 2;
    pool.renderOrder = -2;
    this.scene.add(pool);
    this.floorPool = pool;

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: FLOOR.shadowOpacity,
      }),
    );
    shadow.name = 'currency-blocks-contact-shadow';
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = -1;
    this.scene.add(shadow);
    this.contactShadow = shadow;

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        transparent: true,
        depthWrite: false,
        opacity: FLOOR.glowOpacity,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    glow.name = 'currency-blocks-under-glow';
    glow.rotation.x = -Math.PI / 2;
    glow.renderOrder = 0;
    this.scene.add(glow);
    this.underGlow = glow;

    this.updateFloor();
  }

  /** Rest-pose bounds of the current layout (camera fit + floor framing). */
  restBounds() {
    const box = new THREE.Box3();
    let ok = false;
    try {
      const bounds = this.model.getBounds(this.layout, this.duration);
      if (bounds && bounds.isBox3 && !bounds.isEmpty()) {
        box.copy(bounds);
        ok = true;
      }
    } catch (error) {
      ok = false;
    }
    // getBounds() is pure per the model contract, but re-apply the clock pose in
    // case it touched transforms so the next render still shows the live frame.
    this.model.setTime(this.time);
    if (!ok) {
      box.setFromObject(this.model.root, true);
      if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    }
    return box;
  }

  /** Position/scale the floor bed for the current layout's rest bounds. */
  updateFloor() {
    if (!this.floorPool || !this.contactShadow || !this.underGlow) return;
    const bounds = this.restBounds();
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.x) || !Number.isFinite(size.z)) return;
    const width = Math.max(FLOOR.minWidth, size.x + FLOOR.widthPad);
    const depth = Math.max(FLOOR.minDepth, size.z + FLOOR.depthPad);
    const floorY = bounds.min.y - FLOOR.yOffset;
    // Keep the unlit pool a readable floor aura rather than a frame-wide haze in
    // the wide horizontal layout.
    const poolRadius = clamp(Math.max(width, depth) * FLOOR.poolScale, 5.2, 9);
    this.floorPool.scale.set(poolRadius, poolRadius, 1);
    this.floorPool.position.set(0, floorY, 0);
    this.contactShadow.scale.set(width, depth, 1);
    this.contactShadow.position.set(0, floorY + 0.02, FLOOR.shadowZ);
    this.underGlow.scale.set(width * 1.08, depth * 1.14, 1);
    this.underGlow.position.set(0, floorY + 0.035, FLOOR.glowZ);
  }

  /* ------------------------------------------------------------ camera fit */

  viewDirection() {
    const azimuth = degToRad(CAMERA.azimuthDeg + this.orbit.azimuthDeg);
    const elevation = degToRad(clamp(CAMERA.elevationDeg + this.orbit.elevationDeg, 12, 74));
    return new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    ).normalize();
  }

  /** Solve the minimum camera distance so the rest-pose blocks fit the stage. */
  fitCamera() {
    if (!this.camera) return 0;
    const width = Math.max(1, this.stageBox.width);
    const height = Math.max(1, this.stageBox.height);
    const aspect = width / height;
    const camera = this.camera;
    camera.aspect = aspect;
    camera.near = CAMERA.near;
    camera.far = CAMERA.far;
    camera.updateProjectionMatrix();

    const tanV = Math.tan(degToRad(CAMERA.fov / 2));
    const tanH = tanV * aspect;
    const dir = this.viewDirection();
    const right = new THREE.Vector3().crossVectors(dir.clone().negate(), new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, dir.clone().negate()).normalize();
    const bounds = this.restBounds();
    const corners = boundsCorners(bounds);
    const target = new THREE.Vector3(0, CAMERA.targetY, 0);

    const solve = (origin) => {
      let distance = 0;
      for (const corner of corners) {
        const delta = corner.clone().sub(origin);
        const depth = delta.dot(dir);
        const horizontal = Math.abs(delta.dot(right));
        const vertical = Math.abs(delta.dot(up));
        const required = depth + Math.max(horizontal / tanH, vertical / tanV);
        if (required > distance) distance = required;
      }
      return distance / CAMERA.fitMargin;
    };

    let distance = solve(target);
    // One centring pass: nudge the target along the screen axes so the projected
    // blocks sit in the middle of the stage, then refit the distance.
    camera.position.copy(target).addScaledVector(dir, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const projected = corners.map((corner) => corner.clone().project(camera));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of projected) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    const offsetX = (minX + maxX) / 2;
    const offsetY = (minY + maxY) / 2;
    if (Math.abs(offsetX) > 0.002 || Math.abs(offsetY) > 0.002) {
      // Moving the camera target by +right moves the projected object left, so the
      // correction has the same sign as the measured NDC offset.
      target.addScaledVector(right, offsetX * tanH * distance);
      target.addScaledVector(up, offsetY * tanV * distance);
      distance = solve(target);
    }

    camera.position.copy(target).addScaledVector(dir, distance);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    this.cameraTarget.copy(target);
    this.cameraDistance = distance;
    this.viewBasis.dir.copy(dir);
    this.viewBasis.right.copy(right);
    this.viewBasis.up.copy(up);
    this.needsRender = true;
    return distance;
  }

  getObjectScreenRect() {
    if (!this.camera || !this.model) return null;
    this.model.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model.root, true);
    if (box.isEmpty()) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of boundsCorners(box)) {
      const projected = corner.clone().project(this.camera);
      const px = (projected.x * 0.5 + 0.5) * this.stageBox.width;
      const py = (1 - (projected.y * 0.5 + 0.5)) * this.stageBox.height;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    return {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
      right: maxX,
      bottom: maxY,
    };
  }

  /* ---------------------------------------------------------------- clock */

  getPhase() {
    return derivePhase(this.time);
  }

  getProgress() {
    return clamp(this.time / (this.duration || 1), 0, 1);
  }

  setTime(seconds) {
    this.time = clamp(Number(seconds) || 0, 0, this.duration);
    this.model.setTime(this.time);
    this.needsRender = true;
  }

  /** Park the clock at an exact frame and render it once. */
  stopAt(seconds, reason = 'static') {
    this.stopLoop();
    this.playing = false;
    this.lastStamp = 0;
    this.reason = reason;
    this.setTime(seconds);
    this.renderNow();
    this.emitChange('stop');
  }

  /** Start a fresh one-shot pass from t=0. */
  startAnimation({ reason = 'manual' } = {}) {
    this.reason = reason;
    this.playCount += 1;
    this.stopLoop();
    this.playing = true;
    this.lastStamp = 0;
    this.setTime(0);
    this.renderNow();
    this.startLoop();
    this.emitChange('play');
    return { duration: this.duration };
  }

  startLoop() {
    if (this.destroyed || this.raf) return;
    this.raf = window.requestAnimationFrame(this.boundLoop);
  }

  stopLoop() {
    if (!this.raf) return;
    window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  loop(now) {
    this.raf = 0;
    if (this.destroyed || !this.playing) return;
    const previous = this.lastStamp;
    const dt = previous ? Math.min(0.05, Math.max(0, (now - previous) / 1000)) : 0;
    this.lastStamp = now;
    this.time = Math.min(this.duration, this.time + dt);
    this.model.setTime(this.time);
    if (this.time >= this.duration) {
      // Land exactly on the rest pose and stop the loop (no idle float).
      this.time = this.duration;
      this.model.setTime(this.duration);
      this.playing = false;
      this.reason = 'ended';
      this.renderNow();
      this.emitChange('end');
      return;
    }
    this.renderNow();
    this.raf = window.requestAnimationFrame(this.boundLoop);
    this.emitChange('frame');
  }

  waitForIdle() {
    if (!this.playing) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = performance.now();
      const poll = () => {
        if (this.destroyed || !this.playing) {
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

  emitChange(kind) {
    if (typeof this.onChange !== 'function') return;
    try {
      this.onChange(kind);
    } catch (error) {
      /* UI sync is best effort */
    }
  }

  /* ---------------------------------------------------------------- render */

  resize() {
    if (!this.stage || !this.renderer) return;
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.stageBox.width = width;
    this.stageBox.height = height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDERER.dprMax));
    this.renderer.setSize(width, height, false);
    this.fitCamera();
    this.renderNow();
  }

  renderNow() {
    if (!this.renderer || !this.scene || !this.camera) return;
    // Guard against any bounds helper leaving the model on a different pose.
    this.model.setTime(this.time);
    this.renderer.render(this.scene, this.camera);
    this.renderCount += 1;
    this.needsRender = false;
    if (!this.firstFrameRendered) {
      this.firstFrameRendered = true;
      if (this.firstFrameResolve) this.firstFrameResolve(true);
    }
  }

  whenFirstFrame() {
    if (this.firstFrameRendered) return Promise.resolve(true);
    if (!this.firstFramePromise) {
      this.firstFramePromise = new Promise((resolve) => {
        this.firstFrameResolve = resolve;
      });
    }
    return this.firstFramePromise;
  }

  /* ---------------------------------------------------------------- orbit */

  bindPointer() {
    if (!this.canvas || !this.stage) return;
    const onPointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      this.dragging = true;
      this.pointerId = event.pointerId;
      this.lastPointer.x = event.clientX;
      this.lastPointer.y = event.clientY;
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* pointer capture is best effort */
      }
      this.stage.classList.add('is-dragging');
    };
    this.onPointerDown = onPointerDown;
    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onPointerUp);
  }

  onPointerMove(event) {
    if (!this.dragging || (this.pointerId !== null && event.pointerId !== this.pointerId)) return;
    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    this.lastPointer.x = event.clientX;
    this.lastPointer.y = event.clientY;
    if (dx === 0 && dy === 0) return;
    const orbit = CAMERA.orbit;
    this.orbit.azimuthDeg = clamp(
      this.orbit.azimuthDeg - dx * orbit.azimuthPerPx,
      -orbit.azimuthRangeDeg,
      orbit.azimuthRangeDeg,
    );
    this.orbit.elevationDeg = clamp(
      this.orbit.elevationDeg + dy * orbit.elevationPerPx,
      -orbit.elevationRangeDeg,
      orbit.elevationRangeDeg,
    );
    this.fitCamera();
    this.renderNow();
    this.emitChange('orbit');
  }

  onPointerUp(event) {
    if (this.pointerId !== null && event && event.pointerId !== undefined && event.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    if (this.stage) this.stage.classList.remove('is-dragging');
    this.emitChange('orbit-end');
  }

  resetView() {
    this.orbit.azimuthDeg = 0;
    this.orbit.elevationDeg = 0;
    this.fitCamera();
    this.renderNow();
    this.emitChange('orbit-end');
    return { azimuthDeg: 0, elevationDeg: 0 };
  }

  /** Re-lay the same five blocks and refit the floor/camera for the new axis. */
  setLayout(name) {
    this.layout = name;
    this.model.setLayout(name);
    this.model.setTime(this.time);
    this.updateFloor();
    this.fitCamera();
    this.renderNow();
    this.emitChange('layout');
  }

  /* ---------------------------------------------------------------- debug */

  getAnimationDebug() {
    return {
      time: round(this.time, 3),
      duration: this.duration,
      playing: this.playing,
      phase: this.getPhase(),
      progress: round(this.getProgress(), 4),
      playCount: this.playCount,
    };
  }

  getCameraDebug() {
    const camera = this.camera;
    return {
      azimuth: round(CAMERA.azimuthDeg + this.orbit.azimuthDeg, 2),
      elevation: round(CAMERA.elevationDeg + this.orbit.elevationDeg, 2),
      baseAzimuth: CAMERA.azimuthDeg,
      baseElevation: CAMERA.elevationDeg,
      fov: CAMERA.fov,
      near: camera ? camera.near : CAMERA.near,
      far: camera ? camera.far : CAMERA.far,
      distance: round(this.cameraDistance, 3),
      aspect: camera ? round(camera.aspect, 4) : 1,
      fitMargin: CAMERA.fitMargin,
      target: {
        x: round(this.cameraTarget.x, 3),
        y: round(this.cameraTarget.y, 3),
        z: round(this.cameraTarget.z, 3),
      },
      orbit: {
        azimuth: round(this.orbit.azimuthDeg, 2),
        elevation: round(this.orbit.elevationDeg, 2),
        azimuthRangeDeg: CAMERA.orbit.azimuthRangeDeg,
        elevationRangeDeg: CAMERA.orbit.elevationRangeDeg,
      },
    };
  }

  getRenderDebug() {
    const renderer = this.renderer;
    return {
      renderer: 'three.js r' + THREE.REVISION,
      size: { width: this.stageBox.width, height: this.stageBox.height },
      pixelRatio: renderer ? round(renderer.getPixelRatio(), 2) : 1,
      renderCount: this.renderCount,
      exposure: RENDERER.exposure,
      triangles: renderer ? renderer.info.render.triangles : 0,
      calls: renderer ? renderer.info.render.calls : 0,
      shadowMap: false,
      lights: { directional: 4, ambient: 1, environment: 'PMREM RoomEnvironment + 5 softbox panels' },
    };
  }

  dispose() {
    this.destroyed = true;
    this.stopLoop();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize);
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerup', this.onPointerUp);
      this.canvas.removeEventListener('pointercancel', this.onPointerUp);
      this.canvas.removeEventListener('lostpointercapture', this.onPointerUp);
    }
    if (this.envRT) this.envRT.dispose();
    for (const texture of [this.poolTexture, this.shadowTexture, this.glowTexture]) {
      if (texture) texture.dispose();
    }
    for (const mesh of [this.floorPool, this.contactShadow, this.underGlow]) {
      if (!mesh) continue;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}

/* ------------------------------------------------------------------ debug */

function modelDebugSafe() {
  if (!state.model) return null;
  try {
    return state.model.getDebug();
  } catch (error) {
    pushWarning('model.getDebug() failed: ' + errorMessage(error));
    return null;
  }
}

function stageRect() {
  try {
    if (!dom.stage) return null;
    const rect = dom.stage.getBoundingClientRect();
    return {
      x: round(rect.x, 2),
      y: round(rect.y, 2),
      width: round(rect.width, 2),
      height: round(rect.height, 2),
      top: round(rect.top, 2),
      left: round(rect.left, 2),
      right: round(rect.right, 2),
      bottom: round(rect.bottom, 2),
    };
  } catch (error) {
    return null;
  }
}

function objectRectDebug(studio) {
  if (!studio) return null;
  const rect = studio.getObjectScreenRect();
  if (!rect) return null;
  return {
    left: round(rect.left, 2),
    top: round(rect.top, 2),
    width: round(rect.width, 2),
    height: round(rect.height, 2),
    right: round(rect.right, 2),
    bottom: round(rect.bottom, 2),
  };
}

/** Same-origin resource audit for the QA locality block. */
function localityDebug() {
  const origin = IS_BROWSER ? window.location.origin : '';
  const resources = [];
  const externalRequests = [];
  try {
    const entries =
      IS_BROWSER && typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
        ? performance.getEntriesByType('resource')
        : [];
    for (const entry of entries) {
      const name = entry && entry.name ? String(entry.name) : '';
      if (!name) continue;
      let parsed = null;
      try {
        parsed = new URL(name, window.location.href);
      } catch (error) {
        parsed = null;
      }
      // data:/blob: entries are not network requests (the page favicon is inline).
      if (parsed && (parsed.protocol === 'data:' || parsed.protocol === 'blob:')) continue;
      resources.push(name);
      if (!parsed || parsed.origin !== origin) externalRequests.push(name);
    }
  } catch (error) {
    /* resource timing is diagnostics only */
  }
  return { origin, resources, externalRequests };
}

function buildChecks(md) {
  const modelChecks = (md && md.checks) || {};
  const blockColor = md && md.materials && md.materials.block ? md.materials.block.colorSrgb : null;
  const blockThickness = md && md.block && typeof md.block.thickness === 'number' ? md.block.thickness : BLOCK_SPEC.thickness;
  const modelClearance = md && md.symbolClearance ? md.symbolClearance : null;
  const clearanceOk = Boolean(
    md &&
      modelChecks.symbolClearance !== false &&
      modelClearance &&
      modelClearance.vertical &&
      modelClearance.horizontal &&
      modelClearance.vertical.clippedBlocks === 0 &&
      modelClearance.horizontal.clippedBlocks === 0,
  );
  const responsive = IS_BROWSER
    ? { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }
    : { scrollWidth: 0, clientWidth: 0 };
  const locality = localityDebug();
  return {
    ready: Boolean(state.ready),
    webglAvailable: Boolean(state.webgl),
    blocksFive: Boolean(
      md &&
        ((typeof md.blockCount === 'number' && md.blockCount === BLOCK_COUNT) ||
          (Array.isArray(md.blocks) && md.blocks.length === BLOCK_COUNT)),
    ),
    symbolsFromLexend: Boolean(
      state.font && state.font.loaded && state.font.covers && modelChecks.symbolsFromLexend !== false,
    ),
    noPngGlyphs: modelChecks.noPngGlyphs !== false,
    blackBlocks:
      modelChecks.blackBlockBody === true ||
      (typeof blockColor === 'string' && blockColor.toLowerCase() === '#0a0b0d'),
    // v2: the plate is the fig3 thick plate (0.22–0.28 world units).
    thickPlates: modelChecks.thickPlates === true && blockThickness >= 0.22 && blockThickness <= 0.28,
    // v2: the glyph is centred on the plate in x and z (no viewer-side offset).
    symbolsCentred: modelChecks.symbolsCentred === true,
    // v2: both layouts are stacked vertical totems (no flat row).
    stackedLayouts: modelChecks.stackedLayouts === true,
    symbolClearance: clearanceOk,
    layoutPair:
      modelChecks.layoutPair !== false &&
      LAYOUTS.length === 2 &&
      LAYOUTS.indexOf('vertical') !== -1 &&
      LAYOUTS.indexOf('horizontal') !== -1,
    sharedTimeline: Boolean(
      md && md.timeline && md.timeline.duration === DURATION && md.layoutSpec && md.layoutSpec.vertical && md.layoutSpec.horizontal,
    ),
    playsOnce: Boolean(state.ready) && state.autoPlays <= 1,
    replayable: Boolean(state.studio) && !state.failed,
    localOnly: locality.externalRequests.length === 0,
    deterministic: modelChecks.deterministic !== false, // seeded model, elapsed-time clock, one render in frozen modes
    responsive,
  };
}

function buildDebug() {
  const studio = state.studio;
  const md = modelDebugSafe();
  const animation = studio
    ? {
        ...studio.getAnimationDebug(),
        static: isFrozen(),
        reason: state.animationReason,
      }
    : {
        time: 0,
        duration: DURATION,
        playing: false,
        phase: 'idle',
        progress: 0,
        playCount: 0,
        static: isFrozen(),
        reason: state.animationReason,
      };
  const camera = studio ? studio.getCameraDebug() : null;
  const render = studio
    ? { ...studio.getRenderDebug(), webgl: state.webgl }
    : {
        renderer: 'three.js r' + THREE.REVISION,
        size: { width: 0, height: 0 },
        pixelRatio: 1,
        renderCount: 0,
        webgl: state.webgl,
      };
  const checks = buildChecks(md);
  return {
    ready: Boolean(state.ready),
    version: VERSION,
    layout: state.layout,
    layouts: LAYOUTS.slice(),
    animation,
    camera,
    stageRect: stageRect(),
    objectRect: objectRectDebug(studio),
    model: md,
    flags: {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      qa: Boolean(state.qaMode),
      reducedMotion: Boolean(state.reducedMotion),
      fallback: Boolean(state.failed),
      play: state.playParam === null ? 'auto' : state.playParam,
    },
    render,
    locality: localityDebug(),
    checks,
    urls: {
      page: IS_BROWSER ? window.location.href : '',
      font: FONT_SPEC.url,
      model: IS_BROWSER ? new URL('./currency-blocks-model.js', import.meta.url).href : '',
      three: IS_BROWSER ? new URL('../vendor/three.module.js', import.meta.url).href : '',
    },
    errors: qa.errors.slice(),
    warnings: qa.warnings.slice(),
  };
}

/* -------------------------------------------------------------------- ui */

function syncLayoutButtons() {
  if (!IS_BROWSER) return;
  // The layout toggle stays usable in fallback mode: it flips body[data-layout],
  // which the static CSS poster responds to (the page promises that switch).
  const pairs = [
    ['vertical', dom.btnLayoutVertical],
    ['horizontal', dom.btnLayoutHorizontal],
  ];
  for (const [name, button] of pairs) {
    if (!button) continue;
    button.setAttribute('aria-pressed', state.layout === name ? 'true' : 'false');
    button.classList.toggle('is-active', state.layout === name);
    button.disabled = false;
  }
}

function syncUi() {
  if (!IS_BROWSER) return;
  const studio = state.studio;
  const phase = studio ? studio.getPhase() : 'idle';
  const progress = studio ? studio.getProgress() : 0;
  const orbit = studio ? studio.orbit : { azimuthDeg: 0, elevationDeg: 0 };
  const azimuth = round(CAMERA.azimuthDeg + orbit.azimuthDeg, 0);
  const elevation = round(CAMERA.elevationDeg + orbit.elevationDeg, 0);
  const orbitText = azimuth + '° / ' + elevation + '°';
  const label = layoutLabel(state.layout);

  if (dom.viewState) {
    if (state.failed) dom.viewState.textContent = 'Static poster';
    else if (!state.ready || !studio) dom.viewState.textContent = 'Loading';
    else if (studio.playing) dom.viewState.textContent = 'Playing · ' + phase + ' · ' + Math.round(progress * 100) + '%';
    else if (isFrozen()) dom.viewState.textContent = 'Static · ' + phase + ' · ' + label;
    else if (studio.time >= DURATION - 1e-9) dom.viewState.textContent = 'Rest · ' + label + ' · ' + orbitText;
    else dom.viewState.textContent = 'Loose · ' + label + ' · ' + orbitText;
  }
  if (dom.stageHint) {
    if (state.failed) dom.stageHint.textContent = 'Static preview';
    else if (!state.ready) dom.stageHint.textContent = 'Preparing the studio';
    else if (studio && studio.playing) dom.stageHint.textContent = 'Gathering the blocks';
    else if (isFrozen()) dom.stageHint.textContent = 'Static deterministic frame';
    else dom.stageHint.textContent = 'Space replays · drag to orbit · R resets';
  }
  if (dom.infoFootState) {
    dom.infoFootState.textContent = state.failed ? 'Static fallback' : state.ready ? 'Ready' : 'Loading';
  }
  if (dom.footerStatus) {
    dom.footerStatus.textContent = state.failed
      ? 'Static fallback'
      : state.ready
        ? 'Ready · ' + label.toLowerCase() + ' · ' + phase
        : 'Loading';
  }
  const enabled = Boolean(state.ready && !state.failed && studio);
  if (dom.btnReplay) dom.btnReplay.disabled = !enabled;
  if (dom.btnReset) dom.btnReset.disabled = !enabled;
  syncLayoutButtons();
}

function syncCopy() {
  if (!IS_BROWSER) return;
  const vertical = state.layout === 'vertical';
  setText(dom.stageEyebrow, vertical ? 'Currency totem' : 'Currency fan');
  setText(dom.stageCode, vertical ? 'VRT' : 'HRZ');
  setText(dom.stageName, vertical ? 'Vertical stack' : 'Horizontal stack');
  setText(dom.stageDetail, SYMBOL_CHAIN + (vertical ? ' · stacked top to bottom' : ' · fanned top to bottom'));
}

function syncSpecs() {
  if (!IS_BROWSER) return;
  const layout = state.layout;
  const vertical = layout === 'vertical';
  const md = state.model ? modelDebugSafe() : null;
  const layoutSpec = (Model.LAYOUT_SPEC && Model.LAYOUT_SPEC[layout]) || {};
  const layoutDebug = md && md.layoutSpec && md.layoutSpec[layout] ? md.layoutSpec[layout] : null;
  const restPitch = firstNumber(layoutSpec.restPitch, layoutDebug && layoutDebug.restPitch, 1.32);
  const tightPitch = firstNumber(layoutSpec.tightPitch, layoutDebug && layoutDebug.tightPitch, 0.3);
  const scatterPitch = firstNumber(layoutSpec.scatterPitch, layoutDebug && layoutDebug.scatterPitch, restPitch);
  const travel = firstNumber(
    layoutDebug && layoutDebug.travel,
    ((BLOCK_COUNT - 1) / 2) * (scatterPitch - tightPitch),
  );
  setText(dom.specLayout, vertical ? 'Vertical stack · Y axis' : 'Horizontal fan · stacked on Y');
  setText(dom.specBlocks, BLOCK_COUNT + ' · one per currency');
  setText(dom.specBlockSize, trim(BLOCK_SPEC.size) + ' × ' + trim(BLOCK_SPEC.size));
  setText(dom.specCornerRadius, trim(BLOCK_SPEC.radius) + ' · large');
  setText(dom.specThickness, trim(BLOCK_SPEC.thickness) + ' · bevel ' + trim(BLOCK_SPEC.bevelThickness));
  setText(dom.specRestPitch, trim(restPitch) + ' · fig3 ' + (vertical ? 'totem' : 'fan'));
  setText(dom.specTightPitch, trim(tightPitch) + ' · flush puck');
  setText(dom.specTravel, trim(travel) + ' units · loose to flush');
  setText(dom.specDuration, trim(DURATION) + ' s · one pass');
  setText(dom.specEasing, 'easeInOutCubic / easeOutBack');
  setText(dom.specCamera, CAMERA.azimuthDeg + '° / ' + CAMERA.elevationDeg + '° three-quarter');
  setText(dom.specMotion, isFrozen() ? 'Static · ' + (state.studio ? state.studio.getPhase() : 'idle') : 'Stacked gather and settle · both layouts');
  setText(dom.specSymbols, SYMBOL_CHAIN);
}

function publishState() {
  if (!IS_BROWSER) return;
  const body = dom.body || document.body;
  const debug = buildDebug();
  const animation = debug.animation;
  state.lastPublishAt = performance.now();
  body.dataset.qaReady = debug.ready ? '1' : '0';
  body.dataset.qaErrors = String(debug.errors.length);
  body.dataset.qaWarnings = String(debug.warnings.length);
  body.dataset.qaWebgl = state.webgl ? '1' : '0';
  body.dataset.qaFallback = state.failed ? '1' : '0';
  body.dataset.fallback = state.failed ? '1' : '0';
  body.dataset.layout = state.layout;
  body.dataset.qaLayout = state.layout;
  body.dataset.qaPhase = animation.phase;
  body.dataset.qaProgress = animation.progress.toFixed(3);
  body.dataset.qaTime = round(animation.time, 2).toFixed(2);
  body.dataset.qaDuration = trim(DURATION);
  body.dataset.qaCamera = debug.camera ? round(debug.camera.azimuth, 1) + ',' + round(debug.camera.elevation, 1) : '';
  body.dataset.qaObjectRect = debug.objectRect
    ? [debug.objectRect.left, debug.objectRect.top, debug.objectRect.width, debug.objectRect.height]
        .map((value) => String(round(value, 1)))
        .join(',')
    : '';
  body.dataset.qaPlayCount = String(animation.playCount);
  body.dataset.qaStatic = animation.static ? '1' : '0';
  body.dataset.qaBlocks = String(BLOCK_COUNT);
  body.dataset.qaSymbols = SYMBOL_CODES.join(',');
  body.dataset.qaFont = 'lexend';
  body.dataset.qaFontLoaded = state.font && state.font.loaded ? '1' : '0';
  body.dataset.qaAnimation = animation.playing ? 'playing' : animation.phase;
  body.dataset.still = state.still ? '1' : '0';
  body.dataset.shot = state.shot ? '1' : '0';
  body.dataset.qaMode = state.qaMode ? '1' : '0';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.play = state.playParam === null ? 'auto' : state.playParam;
  if (dom.diag) {
    try {
      dom.diag.textContent = JSON.stringify(debug);
    } catch (error) {
      dom.diag.textContent = '{"error":"debug serialization failed"}';
    }
  }
}

/** Throttled publish used by high-frequency events (animation frames, drag). */
function requestPublish(force) {
  if (!IS_BROWSER) return;
  if (force) {
    publishState();
    return;
  }
  const now = performance.now();
  if (now - state.lastPublishAt >= 120) {
    publishState();
    return;
  }
  if (state.publishTimer) return;
  state.publishTimer = window.setTimeout(() => {
    state.publishTimer = 0;
    publishState();
  }, 130);
}

/* ------------------------------------------------------------------ actions */

function writeLayoutUrl(layout) {
  if (!IS_BROWSER) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('layout', layout);
    window.history.replaceState(null, '', url.href);
  } catch (error) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('layout', layout);
      window.history.replaceState(null, '', url.search + url.hash);
    } catch (innerError) {
      /* History writes are best effort: file:// origins reject URL replacement. */
    }
  }
}

function applyLayout(name, options = {}) {
  if (LAYOUTS.indexOf(name) === -1) return state.layout;
  const changed = state.layout !== name;
  state.layout = name;
  const studio = state.studio;
  if (studio) {
    studio.setLayout(name);
  } else if (state.model) {
    state.model.setLayout(name);
  }
  if (dom.body) dom.body.dataset.layout = name;
  if (dom.body) dom.body.dataset.qaLayout = name;
  if (options.updateUrl !== false) writeLayoutUrl(name);
  syncLayoutButtons();
  syncCopy();
  syncSpecs();
  syncUi();
  if (options.publish !== false) publishState();
  if (options.announce !== false && changed) announce(layoutLabel(name) + ' layout');
  return state.layout;
}

function doPlay(reason) {
  const studio = state.studio;
  if (!studio || state.failed) return Promise.resolve(false);
  state.autoplay = false;
  if (isFrozen()) {
    studio.stopAt(staticTargetTime(), reason);
    state.animationReason = frozenReason();
    syncUi();
    publishState();
    announce('Static frame · ' + (studio ? studio.getPhase() : 'rest'));
    return Promise.resolve(false);
  }
  if (reason === 'viewport') state.autoPlays += 1;
  studio.startAnimation({ reason });
  state.animationReason = reason;
  syncUi();
  publishState();
  announce(reason === 'replay' ? 'Replaying gather and settle' : 'Playing gather and settle');
  return studio.waitForIdle().then(() => {
    state.animationReason = 'ended';
    syncUi();
    publishState();
    return true;
  });
}

function doResetView() {
  const studio = state.studio;
  if (!studio || state.failed) return false;
  studio.resetView();
  syncUi();
  publishState();
  announce('Camera reset');
  return true;
}

function doSetTime(seconds) {
  const studio = state.studio;
  const value = Number(seconds);
  if (!studio || state.failed || !Number.isFinite(value)) return false;
  state.autoplay = false;
  state.qaSetTime = clamp(value, 0, DURATION);
  studio.stopAt(state.qaSetTime, 'setTime');
  state.animationReason = 'setTime';
  syncUi();
  publishState();
  announce('Frozen at ' + trim(state.qaSetTime) + ' s');
  return true;
}

/* ------------------------------------------------------------- fallback/webgl */

function showFallback(message, { error = null, banner = false } = {}) {
  state.failed = true;
  state.ready = false;
  state.booting = false;
  api.ready = false;
  state.autoplay = false;
  if (error) pushError(errorMessage(error));
  if (dom.fallback) {
    dom.fallback.hidden = false;
    if (dom.fallbackMessage) dom.fallbackMessage.textContent = message;
  }
  if (dom.body) {
    dom.body.dataset.fallback = '1';
    dom.body.dataset.qaFallback = '1';
  }
  if (state.viewObserver) {
    state.viewObserver.disconnect();
    state.viewObserver = null;
  }
  if (state.studio) state.studio.stopLoop();
  hideCurtain();
  if (banner && dom.errorBanner) {
    if (dom.errorText) dom.errorText.textContent = message;
    dom.errorBanner.hidden = false;
  }
  syncUi();
  publishState();
  announce('Static preview: ' + message);
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

/* ------------------------------------------------------------ viewport entry */

function setupViewportTrigger() {
  if (!state.autoplay || state.failed || !state.studio) return;
  if (!dom.stage || typeof IntersectionObserver !== 'function') {
    doPlay('viewport');
    return;
  }
  try {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            observer.disconnect();
            state.viewObserver = null;
            if (state.autoplay) doPlay('viewport');
            return;
          }
        }
      },
      { threshold: [0, 0.35, 0.6, 1] },
    );
    observer.observe(dom.stage);
    state.viewObserver = observer;
  } catch (error) {
    pushWarning('IntersectionObserver failed, playing immediately: ' + errorMessage(error));
    doPlay('viewport');
  }
}

/* -------------------------------------------------------------------- api */

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
  readyPromise() {
    return readyPromise;
  },
  play() {
    return doPlay('manual');
  },
  replay() {
    return doPlay('replay');
  },
  setLayout(name) {
    return applyLayout(name, { announce: true });
  },
  getLayout() {
    return state.layout;
  },
  resetView() {
    return doResetView();
  },
  setTime(seconds) {
    return doSetTime(seconds);
  },
  debug: buildDebug,
};
// Keep `api.ready` live: capture harnesses poll it after boot.
Object.defineProperty(api, 'ready', {
  enumerable: true,
  get: () => state.ready,
  set: (value) => {
    state.ready = Boolean(value);
  },
});
if (IS_BROWSER) window.__tekoCurrencyBlocks = api;

/* -------------------------------------------------------------------- boot */

function syncBodyFlags() {
  if (!IS_BROWSER) return;
  const body = dom.body;
  if (!body) return;
  body.dataset.still = state.still ? '1' : '0';
  body.dataset.shot = state.shot ? '1' : '0';
  body.dataset.qaMode = state.qaMode ? '1' : '0';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.layout = state.layout;
  body.dataset.qaLayout = state.layout;
  body.dataset.qaDuration = trim(DURATION);
  body.dataset.qaBlocks = String(BLOCK_COUNT);
}

async function boot() {
  state.bootStartedAt = performance.now();
  state.booting = true;
  state.ready = false;
  api.ready = false;

  syncBodyFlags();
  if (dom.body) {
    dom.body.dataset.fallback = '0';
    dom.body.dataset.qaFallback = '0';
    dom.body.dataset.qaReady = '0';
    dom.body.dataset.qaFontLoaded = '0';
    dom.body.dataset.qaPhase = 'idle';
    dom.body.dataset.qaProgress = '0';
    dom.body.dataset.qaTime = '0';
    dom.body.dataset.qaPlayCount = '0';
  }
  syncUi();
  publishState();

  curtainProgress(0.02, 'Detecting WebGL', '0 / 0', 'Preparing the currency blocks');
  if (dom.veilText) dom.veilText.textContent = 'Detecting WebGL';
  const webgl = probeWebGL();
  state.webgl = webgl;
  qa.webgl = webgl;
  if (!webgl) {
    showFallback(
      'WebGL is not available in this browser, so the interactive currency blocks cannot be rendered. A static poster of the five blocks is shown below.',
    );
    resolveReady(false);
    return;
  }

  curtainProgress(0.08, 'Loading Lexend', '0 / ' + BLOCK_COUNT, 'Preparing the currency blocks');
  if (dom.veilText) dom.veilText.textContent = 'Loading Lexend';
  try {
    state.font = await Model.loadLexendFont();
  } catch (error) {
    pushError('Lexend FontFace load failed: ' + errorMessage(error));
    state.font = {
      family: FONT_SPEC.family,
      cssFamily: FONT_SPEC.cssFamily,
      weight: FONT_SPEC.weight,
      weightRange: FONT_SPEC.weightRange,
      url: FONT_SPEC.url,
      loaded: false,
      covers: false,
      status: 'fallback',
    };
  }
  curtainProgress(0.3, 'Loading Lexend', BLOCK_COUNT + ' / ' + BLOCK_COUNT, 'Preparing the currency blocks');
  if (dom.veilText) dom.veilText.textContent = 'Building the blocks';

  curtainProgress(0.34, 'Building the blocks', '');
  let model = null;
  try {
    model = Model.createCurrencyBlocksModel({ font: state.font, layout: state.layout });
    state.model = model;
  } catch (error) {
    showFallback('The currency blocks model could not be built (' + errorMessage(error) + '). A static poster is shown below.', {
      error,
      banner: true,
    });
    resolveReady(false);
    return;
  }
  if (!model || !model.root || !Array.isArray(model.blocks) || model.blocks.length !== BLOCK_COUNT) {
    showFallback('The model did not produce the expected five currency blocks.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.7, 'Starting the studio', '');
  if (dom.veilText) dom.veilText.textContent = 'Starting the studio';
  try {
    state.studio = createStudio();
    await state.studio.init();
    const contextLost = (event) => {
      event.preventDefault();
      showFallback('WebGL context was lost, so a static poster of the five blocks is shown below.');
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
    showFallback('The three.js studio could not start (' + errorMessage(error) + '). A static poster is shown below.', {
      error,
      banner: true,
    });
    resolveReady(false);
    return;
  }

  const studio = state.studio;
  // Land on the policy frame for this URL: frozen static frame, or the loose
  // opening frame held until the stage enters the viewport.
  if (isFrozen()) {
    studio.stopAt(staticTargetTime(), frozenReason());
    state.animationReason = frozenReason();
  } else {
    studio.stopAt(0, 'initial');
    state.animationReason = 'initial';
    state.autoplay = true;
  }
  applyLayout(state.layout, { announce: false, updateUrl: false, publish: false });
  syncObjectFacts();
  syncUi();

  curtainProgress(0.94, 'Fitting the studio', '');
  if (dom.veilText) dom.veilText.textContent = 'Fitting the studio';
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
  announce('Currency blocks ready');
  studio.renderNow();
  resolveReady(true);

  if (state.autoplay) setupViewportTrigger();
}

function syncObjectFacts() {
  if (!IS_BROWSER) return;
  syncCopy();
  syncSpecs();
  if (dom.stageIndex) {
    const value = String(BLOCK_COUNT).padStart(2, '0');
    dom.stageIndex.textContent = value;
  }
}

function createStudio() {
  const studio = new CurrencyBlocksStudio({
    canvas: dom.canvas,
    stage: dom.stage,
    model: state.model,
    layout: state.layout,
    reducedMotion: state.reducedMotion,
    still: state.still,
    shot: state.shot,
  });
  studio.onChange = (kind) => {
    syncUi();
    requestPublish(kind === 'end' || kind === 'play' || kind === 'stop');
  };
  return studio;
}

/* -------------------------------------------------------------------- wire */

function wireUi() {
  if (!IS_BROWSER) return;
  if (dom.btnLayoutVertical) {
    dom.btnLayoutVertical.addEventListener('click', () => applyLayout('vertical'));
  }
  if (dom.btnLayoutHorizontal) {
    dom.btnLayoutHorizontal.addEventListener('click', () => applyLayout('horizontal'));
  }
  if (dom.btnReplay) {
    dom.btnReplay.addEventListener('click', () => doPlay('replay'));
  }
  if (dom.btnReset) {
    dom.btnReset.addEventListener('click', () => doResetView());
  }
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && target.isContentEditable) return;
    const tagName = target && target.tagName ? String(target.tagName) : '';
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;
    if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') {
      // Let a focused button handle its own Space activation natively.
      if (tagName === 'BUTTON' || tagName === 'A') return;
      event.preventDefault();
      doPlay('replay');
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      if (tagName === 'INPUT' || tagName === 'TEXTAREA') return;
      event.preventDefault();
      doResetView();
    }
  });
  if (reducedMotionQuery) {
    const onChange = (event) => {
      state.reducedMotion = Boolean(event.matches);
      if (dom.body) dom.body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
      const studio = state.studio;
      if (studio) {
        studio.reducedMotion = state.reducedMotion;
        if (state.reducedMotion) {
          state.autoplay = false;
          if (state.viewObserver) {
            state.viewObserver.disconnect();
            state.viewObserver = null;
          }
          studio.stopAt(staticTargetTime(), frozenReason());
          state.animationReason = frozenReason();
        } else if (!isFrozen()) {
          studio.stopAt(0, 'initial');
          state.animationReason = 'initial';
          state.autoplay = true;
          setupViewportTrigger();
        }
      }
      syncObjectFacts();
      syncUi();
      publishState();
    };
    if (typeof reducedMotionQuery.addEventListener === 'function') reducedMotionQuery.addEventListener('change', onChange);
    else if (typeof reducedMotionQuery.addListener === 'function') reducedMotionQuery.addListener(onChange);
  }
}

/* -------------------------------------------------------------------- main */

function cleanup() {
  if (!IS_BROWSER) return;
  window.clearTimeout(state.watchdog);
  if (state.publishTimer) {
    window.clearTimeout(state.publishTimer);
    state.publishTimer = 0;
  }
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = 0;
  }
  if (state.viewObserver) {
    state.viewObserver.disconnect();
    state.viewObserver = null;
  }
  if (state.studio) {
    try {
      state.studio.dispose();
    } catch (error) {
      /* best effort */
    }
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
}

function main() {
  installCaptureFallback();
  initDom();
  wireUi();
  syncBodyFlags();
  syncObjectFacts();
  syncUi();
  publishState();
  boot().catch((error) => {
    if (!state.failed) {
      showFallback('The currency blocks preview failed to start (' + errorMessage(error) + '). A static poster is shown below.', {
        error,
        banner: true,
      });
    }
    resolveReady(false);
  });
  state.watchdog = window.setTimeout(() => {
    if (!state.ready && !state.failed) {
      showFallback('The interactive preview did not start within 20 seconds. A static poster is shown below.', {
        banner: true,
      });
      resolveReady(false);
    }
  }, 20000);
  state.pollTimer = window.setInterval(() => {
    if (state.failed) return;
    publishState();
  }, 500);
  window.addEventListener('pagehide', cleanup);
}

if (IS_BROWSER) main();

export { VERSION, CurrencyBlocksStudio };
