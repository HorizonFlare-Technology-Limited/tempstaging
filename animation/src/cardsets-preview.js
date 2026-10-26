/**
 * tekoanimation — "Card sets" page controller (`cardsets.html`, Unit C).
 *
 * One dark studio, two authored card SETS: the black set (four `dark` cards) and
 * the white set (four `light` cards). Every card is shown from its BACK — the
 * reconstructed back artwork is the subject — as a layered / fanned row of
 * near-upright cards with heavy overlap, staggered depth and slight per-card
 * rotations, following the rounded-panel rhythm of refs/round3/card-sets.png.
 *
 * The card geometry/textures/materials are owned by `src/card-model.js`
 * (`loadCardBank()` / `createCard()`); the composition, camera and idle pose are
 * owned by `src/cardsets-model.js`. This module owns the renderer, the PMREM
 * studio environment, the single shadow-casting key light + fill/rim, the
 * numeric camera fit, the set toggle (with a short studio dip-crossfade), the
 * clamped drag-orbit, the deterministic frame and the QA surface.
 *
 * Determinism: `?still=1` and `?shot=1` (and `prefers-reduced-motion`) pin the
 * authored composition and the idle pose to t = 0, disable the set crossfade and
 * the drag-orbit, and render from a fixed camera fit — two captures of the same
 * URL are pixel-identical. No randomness is used anywhere (the backdrop dither
 * is a fixed LCG); every visual is either authored or a pure function of time.
 *
 * QA hooks: `window.__tekoCardSets = { ready, errors, warnings, isReady,
 * debug(), setSet(id), getState(), resetView(), waitForIdle(), readyPromise() }`
 * plus the early `window.__TEKO_CARDSETS_QA` error registry installed in
 * `cardsets.html`, the mirrored `body[data-qa-*]` attributes and the hidden
 * `#qa-diag` JSON. URL state: `?set=dark|light`, `?still=1`, `?shot=1`,
 * `?qa=1`, `?pose=<yaw>,<pitch>`.
 */
import * as THREE from 'three';
import * as CardSetsModel from './cardsets-model.js';

const VERSION = '1.0.0';
const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

const MODEL_URL = new URL('./card-model.js', import.meta.url);
const ASSET_BASE = './assets/textures/card';
const ASSET_BASE_URL = new URL('../assets/textures/card/', import.meta.url);

/* -------------------------------------------------------------------------- */
/* Studio tuning                                                               */
/* -------------------------------------------------------------------------- */

const RENDERER = Object.freeze({ exposure: 1.06, dprMax: 2 });

/**
 * The page owns the studio, so it balances the back reflection strength for this
 * back-facing set view: `src/card-model.js` tunes its back material envMapIntensity
 * for the card page's single-card 45° view, which is a different lighting setup.
 * Each set gets its own card materials (the page never mutates shared assets), so
 * the studio scalar is applied per card here and reported in `debug().backMaterials`
 * together with the model's own value (provenance, no hidden overrides).
 */
const BACK_VIEW = Object.freeze({ envMapIntensity: 0.72 });

/**
 * Purpose-built PMREM environment: a dark cyclorama shell plus large emissive
 * panels. A broad cool panel behind the camera gives the metal backs their
 * readable sheen; the warm key softbox, the ceiling strip and the two cool side
 * strips paint the bevel/edge reflection gradients that make the card thickness
 * read (no baked highlights anywhere — albedo is clean).
 */
const ENV = Object.freeze({
  room: 0x05070b,
  sigma: 0.035,
  panels: Object.freeze([
    // Mirror-direction softboxes: a card back facing the camera reflects the
    // environment around the camera's MIRROR direction, so the broad softbox that
    // makes the metal backs read sits front-left / slightly below (az ≈ -24°,
    // el ≈ -7°) — a broad one for the sweeping sheen and a smaller, brighter one
    // for the crisp metal gradient. Dielectric regions (top band, signature
    // panel) only pick up a little diffuse light from these, so the band stays
    // matte-black while the metal body reads.
    Object.freeze({ name: 'env-back-broad', position: [-3.6, -1.2, 9.0], width: 10.0, height: 7.0, color: 0xe8eef8, intensity: 3.20, gradient: true }),
    Object.freeze({ name: 'env-back-hot', position: [-1.5, 0.6, 8.5], width: 2.2, height: 1.4, color: 0xffffff, intensity: 9.00, gradient: true }),
    Object.freeze({ name: 'env-key-softbox', position: [8.5, 6.5, 6.0], width: 4.6, height: 3.6, color: 0xfff7ec, intensity: 1.30, gradient: true }),
    Object.freeze({ name: 'env-top-strip', position: [0, 10.5, 0.5], width: 15.0, height: 2.0, color: 0xffffff, intensity: 1.60, gradient: false }),
    Object.freeze({ name: 'env-left-rim', position: [-10.5, 2.5, -2.5], width: 2.0, height: 10.0, color: 0xa9c6ff, intensity: 2.10, gradient: false }),
    Object.freeze({ name: 'env-right-rim', position: [10.5, 1.0, -3.5], width: 1.8, height: 8.5, color: 0xc2d6ff, intensity: 1.60, gradient: false }),
    Object.freeze({ name: 'env-back-warm', position: [0, 3.5, -11.0], width: 12.0, height: 2.4, color: 0xffd7ad, intensity: 0.4, gradient: false }),
  ]),
});

/**
 * One shadow-casting key light (front-right-top), one soft cool fill (front-left)
 * and one cool rim (behind-left). The rim separates the dark set from the void;
 * the key's shadow map makes front cards drop soft shadows on the cards behind
 * them, which is what makes the heavy overlap read as real depth.
 */
const LIGHTS = Object.freeze({
  key: Object.freeze({ color: 0xfffbf4, intensity: 1.0, direction: [0.42, 0.62, 0.66], distance: 22, shadow: true }),
  fill: Object.freeze({ color: 0xc4d6ee, intensity: 0.2, direction: [-0.75, 0.3, 0.6] }),
  rim: Object.freeze({ color: 0x9fc0ff, intensity: 1.6, direction: [-0.5, 0.35, -0.78] }),
  rim2: Object.freeze({ color: 0x9fc0ff, intensity: 1.15, direction: [0.6, 0.24, -0.76] }),
  ambient: Object.freeze({ color: 0x2a3240, intensity: 0.1 }),
});

const SHADOW = Object.freeze({
  mapSize: 2048,
  bias: -0.0004,
  normalBias: 0.02,
  camera: Object.freeze({ left: -6.5, right: 6.5, top: 5.0, bottom: -5.0, near: 1, far: 40 }),
});

const BACKDROP = Object.freeze({ radius: 80 });
const FLOOR = Object.freeze({ radius: 8.5, yOffset: 0.22, opacity: 0.5 });

const ORBIT = Object.freeze({
  azimuthRangeDeg: 12,
  elevationRangeDeg: 6,
  azimuthPerPx: 0.12,
  elevationPerPx: 0.08,
});

const SET_FADE_MS = 340;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
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

function boundsCorners(bounds) {
  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  return corners;
}

/**
 * Collect the actual geometry corners of every mesh under `root` in world space.
 * Projecting transformed geometry-box corners (instead of the coarser world AABB
 * corners) makes the camera fit and the QA screen rects tight: a card is a thin
 * slab rotated by a few degrees, so its world AABB is much larger than the card
 * silhouette and would otherwise over-frame the composition.
 */
function collectWorldCorners(root) {
  const points = [];
  if (!root) return points;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || !object.geometry.attributes || !object.geometry.attributes.position) return;
    const geometry = object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          points.push(new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld));
        }
      }
    }
  });
  return points;
}

function boundsOfPoints(points) {
  const bounds = new THREE.Box3();
  for (const point of points) bounds.expandByPoint(point);
  return bounds;
}

/* -------------------------------------------------------------------------- */
/* Early QA registry / URL flags                                               */
/* -------------------------------------------------------------------------- */

const qa = IS_BROWSER
  ? (window.__TEKO_CARDSETS_QA = window.__TEKO_CARDSETS_QA || { errors: [], warnings: [], webgl: null })
  : { errors: [], warnings: [], webgl: null };
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];

function pushError(message) {
  qa.errors.push('cardsets-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}

function pushWarning(message) {
  qa.warnings.push('cardsets-preview: ' + message);
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

function parseSetParam() {
  const raw = (urlParams.get('set') || '').toLowerCase();
  return raw === 'light' || raw === 'white' ? 'light' : 'dark';
}

function parsePoseParam() {
  const raw = urlParams.get('pose');
  if (!raw) return null;
  const parts = String(raw).split(',');
  const yaw = Number(parts[0]);
  const pitch = Number(parts[1] || 0);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  return {
    yawDeg: clamp(yaw, -ORBIT.azimuthRangeDeg, ORBIT.azimuthRangeDeg),
    pitchDeg: clamp(pitch, -ORBIT.elevationRangeDeg, ORBIT.elevationRangeDeg),
  };
}

const state = {
  ready: false,
  failed: false,
  booting: true,
  webgl: null,
  bank: null,
  sets: { dark: null, light: null },
  studio: null,
  activeSet: parseSetParam(),
  layout: 'wide',
  still: urlParams.get('still') === '1',
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches),
  fade: 0,
  transition: null,
  fallbackArt: null,
  watchdog: 0,
  bootStartedAt: 0,
};

/** Static/deterministic modes never animate, crossfade or respond to drag. */
function isStaticMode() {
  return state.still || state.shot || state.reducedMotion;
}

/* -------------------------------------------------------------------------- */
/* DOM                                                                         */
/* -------------------------------------------------------------------------- */

const dom = {};

function initDom() {
  if (!IS_BROWSER) return;
  const byId = (id) => document.getElementById(id);
  dom.body = document.body;
  dom.stage = byId('stage');
  dom.canvas = byId('stage-canvas');
  dom.veil = byId('stage-veil');
  dom.veilText = byId('veil-text');
  dom.stageFade = byId('stage-fade');
  dom.stageHint = byId('stage-hint');
  dom.stageCaption = byId('stage-caption');
  dom.stageCode = byId('stage-code');
  dom.stageName = byId('stage-name');
  dom.stageDetail = byId('stage-detail');
  dom.stageEyebrow = byId('stage-eyebrow-text');
  dom.stageIndex = byId('stage-index');
  dom.btnSetDark = byId('btn-set-dark');
  dom.btnSetLight = byId('btn-set-light');
  dom.btnReset = byId('btn-reset');
  dom.viewState = byId('view-state');
  dom.infoName = byId('info-name');
  dom.infoRegion = byId('info-region');
  dom.infoIndex = byId('info-index');
  dom.specSet = byId('spec-set');
  dom.specCards = byId('spec-cards');
  dom.specCard = byId('spec-card');
  dom.specBack = byId('spec-back');
  dom.specComposition = byId('spec-composition');
  dom.specCamera = byId('spec-camera');
  dom.specMaterial = byId('spec-material');
  dom.specLayout = byId('spec-layout');
  dom.specMotion = byId('spec-motion');
  dom.assetTags = byId('asset-tags');
  dom.assetNote = byId('asset-note');
  dom.infoFootNote = byId('info-foot-note');
  dom.infoFootState = byId('info-foot-state');
  dom.setRail = byId('set-rail');
  dom.footerStatus = byId('footer-status');
  dom.fallback = byId('fallback');
  dom.fallbackMessage = byId('fallback-message');
  dom.fallbackSets = byId('fallback-sets');
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
  if (dom.veil) {
    dom.veil.classList.add('is-hidden');
    dom.veil.hidden = true;
  }
}

function announce(message) {
  if (dom.liveStatus) dom.liveStatus.textContent = message;
}

function showErrorBanner(message) {
  if (!dom.errorBanner) return;
  if (dom.errorText) dom.errorText.textContent = message;
  dom.errorBanner.hidden = false;
}

/* -------------------------------------------------------------------------- */
/* Studio environment (PMREM)                                                  */
/* -------------------------------------------------------------------------- */

function makeEnvSoftboxTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(size * 0.5, size * 0.46, size * 0.03, size * 0.5, size * 0.5, size * 0.62);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.76, 'rgba(255,255,255,0.26)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  return texture;
}

function createStudioEnvironment() {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(34, 22, 34),
    new THREE.MeshBasicMaterial({ color: ENV.room, side: THREE.BackSide }),
  );
  room.name = 'env-room';
  scene.add(room);
  const textures = [makeEnvSoftboxTexture()];
  for (const panel of ENV.panels) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(panel.color).multiplyScalar(panel.intensity),
      map: panel.gradient ? textures[0] : null,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(panel.width, panel.height), material);
    mesh.name = panel.name;
    mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);
    mesh.lookAt(0, 0.6, 0);
    scene.add(mesh);
  }
  return { scene, textures };
}

function disposeEnvironmentScene(scene, textures) {
  scene.traverse((object) => {
    if (object.isMesh) {
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
    }
  });
  for (const texture of textures || []) texture.dispose();
}

/* -------------------------------------------------------------------------- */
/* Backdrop + floor pool (both deterministic canvas textures)                  */
/* -------------------------------------------------------------------------- */

function makeStudioBackdropTexture(renderer) {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Void studio gradient (canvas top = sphere top).
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#05060a');
  base.addColorStop(0.35, '#07090e');
  base.addColorStop(0.6, '#0a0d13');
  base.addColorStop(0.82, '#070a0f');
  base.addColorStop(1, '#040508');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // Cool pool behind/above the composition so the silhouette separates.
  const pool = ctx.createRadialGradient(width * 0.52, height * 0.52, width * 0.01, width * 0.52, height * 0.54, width * 0.34);
  pool.addColorStop(0, 'rgba(104,126,156,0.20)');
  pool.addColorStop(0.4, 'rgba(62,78,100,0.10)');
  pool.addColorStop(1, 'rgba(6,8,12,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, width, height);

  // Warm hint on the key-light side.
  const warm = ctx.createRadialGradient(width * 0.72, height * 0.42, width * 0.01, width * 0.72, height * 0.42, width * 0.2);
  warm.addColorStop(0, 'rgba(150,120,92,0.08)');
  warm.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, width, height);

  // Deterministic dither (fixed LCG, no Math.random) so the gradient never bands.
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < data.length; index += 4) {
    const n = (next() - 0.5) * 2.2;
    data[index] = clamp(data[index] + n, 0, 255);
    data[index + 1] = clamp(data[index + 1] + n, 0, 255);
    data[index + 2] = clamp(data[index + 2] + n, 0, 255);
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function makeFloorPoolTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(120,146,182,0.32)');
  gradient.addColorStop(0.32, 'rgba(78,98,128,0.16)');
  gradient.addColorStop(0.68, 'rgba(40,52,70,0.05)');
  gradient.addColorStop(1, 'rgba(6,8,12,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  return texture;
}

/* -------------------------------------------------------------------------- */
/* Card-sets studio                                                            */
/* -------------------------------------------------------------------------- */

class CardSetsStudio {
  constructor({ canvas, stage, sets, activeSet, layout, reducedMotion = false, still = false, shot = false }) {
    this.canvas = canvas;
    this.stage = stage;
    this.sets = sets;
    this.activeSetId = activeSet;
    this.layout = layout;
    this.reducedMotion = Boolean(reducedMotion);
    this.still = Boolean(still);
    this.shot = Boolean(shot);
    this.frozen = this.still || this.shot;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.envRT = null;
    this.envScene = null;
    this.envTextures = null;
    this.backdrop = null;
    this.floorPool = null;
    this.floorTexture = null;
    this.keyLight = null;
    this.fillLight = null;
    this.rimLight = null;
    this.ambient = null;
    this.stageBox = { width: 1, height: 1 };
    this.cameraDistance = 12;
    this.cameraTarget = new THREE.Vector3(0, 0, 0);
    this.orbit = { azimuthDeg: 0, elevationDeg: 0 };
    this.idleTime = 0;
    this.lastTime = 0;
    this.lastRenderStats = null;
    this.renderCount = 0;
    this.needsRender = true;
    this.destroyed = false;
    this.dragging = false;
    this.pointerId = null;
    this.lastPointer = { x: 0, y: 0 };
    this.resizeObserver = null;
    this.onWindowResize = null;
    this.boundLoop = this.loop.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.firstFrameResolve = null;
    this.firstFramePromise = null;
    this.firstFrameRendered = false;
    this.view = { dir: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) };
  }

  motionAllowed() {
    return !this.still && !this.shot && !this.reducedMotion && !this.frozen;
  }

  activeSet() {
    return this.sets[this.activeSetId] || null;
  }

  async init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDERER.dprMax));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDERER.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x040508, 1);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.name = 'cardsets-studio';
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(CardSetsModel.CAMERA_SPEC.fov, 1.4, 0.1, 120);
    this.camera.name = 'cardsets-camera';

    this.buildEnvironment();
    this.buildLights();
    this.buildBackdrop();
    this.buildFloor();

    for (const id of ['dark', 'light']) {
      const set = this.sets[id];
      if (!set) continue;
      set.applyLayout(this.layout);
      scene.add(set.root);
      set.root.visible = id === this.activeSetId;
      this.syncShadowFlags(set.root);
    }
    this.applyBackStudioExposure();

    this.bindPointer();
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.stage);
    } else if (typeof window !== 'undefined') {
      this.onWindowResize = () => this.resize();
      window.addEventListener('resize', this.onWindowResize);
    }
    this.resize();
    this.applyStaticFrame();
    this.raf = window.requestAnimationFrame(this.boundLoop);
    return this;
  }

  syncShadowFlags(root) {
    root.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
  }

  /**
   * Apply the page's studio back-reflection scalar to every card's own back
   * material (each `createCard()` owns its materials, so nothing shared with the
   * card page is touched). The model's value is kept for provenance/debug.
   */
  applyBackStudioExposure() {
    for (const key of ['dark', 'light']) {
      const set = this.sets[key];
      if (!set) continue;
      for (const entry of set.slots) {
        const material = entry.card && entry.card.materials ? entry.card.materials.back : null;
        if (!material) continue;
        if (typeof material.userData !== 'object' || material.userData === null) material.userData = {};
        if (!Number.isFinite(material.userData.modelEnvMapIntensity)) {
          material.userData.modelEnvMapIntensity = Number(material.envMapIntensity) || 0;
        }
        material.envMapIntensity = BACK_VIEW.envMapIntensity;
        material.needsUpdate = true;
      }
    }
  }

  /** Per-card back material summary for QA/docs (model value + studio value). */
  getBackMaterialDebug() {
    const rows = [];
    for (const key of ['dark', 'light']) {
      const set = this.sets[key];
      if (!set) continue;
      for (const entry of set.slots) {
        const material = entry.card && entry.card.materials ? entry.card.materials.back : null;
        if (!material) continue;
        const modelEnv = material.userData && Number.isFinite(material.userData.modelEnvMapIntensity)
          ? material.userData.modelEnvMapIntensity
          : null;
        rows.push({
          set: key,
          slot: entry.transform ? entry.transform.slotId : 'c' + (entry.index + 1),
          modelEnvMapIntensity: modelEnv,
          studioEnvMapIntensity: round(Number(material.envMapIntensity) || 0, 3),
          normalScale: material.normalScale ? round(material.normalScale.x, 3) : null,
          roughness: round(Number(material.roughness) || 0, 3),
          metalness: round(Number(material.metalness) || 0, 3),
          clearcoat: round(Number(material.clearcoat) || 0, 3),
        });
      }
    }
    return rows;
  }

  buildEnvironment() {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    const env = createStudioEnvironment();
    this.envScene = env.scene;
    this.envTextures = env.textures;
    this.envRT = pmremGenerator.fromScene(env.scene, ENV.sigma);
    this.scene.environment = this.envRT.texture;
    pmremGenerator.dispose();
  }

  buildLights() {
    const addDirectional = (name, spec) => {
      const light = new THREE.DirectionalLight(spec.color, spec.intensity);
      light.name = 'cardsets-light-' + name;
      const dir = new THREE.Vector3(spec.direction[0], spec.direction[1], spec.direction[2]).normalize();
      light.position.copy(dir).multiplyScalar(spec.distance || 20);
      light.target.position.set(0, 0, 0);
      this.scene.add(light);
      this.scene.add(light.target);
      return light;
    };

    this.keyLight = addDirectional('key', LIGHTS.key);
    this.keyLight.castShadow = Boolean(LIGHTS.key.shadow);
    const shadow = this.keyLight.shadow;
    shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
    shadow.bias = SHADOW.bias;
    shadow.normalBias = SHADOW.normalBias;
    shadow.camera.left = SHADOW.camera.left;
    shadow.camera.right = SHADOW.camera.right;
    shadow.camera.top = SHADOW.camera.top;
    shadow.camera.bottom = SHADOW.camera.bottom;
    shadow.camera.near = SHADOW.camera.near;
    shadow.camera.far = SHADOW.camera.far;
    shadow.camera.updateProjectionMatrix();
    shadow.autoUpdate = false;
    shadow.needsUpdate = true;

    this.fillLight = addDirectional('fill', LIGHTS.fill);
    this.rimLight = addDirectional('rim', LIGHTS.rim);
    this.rimLight2 = addDirectional('rim2', LIGHTS.rim2);

    this.ambient = new THREE.AmbientLight(LIGHTS.ambient.color, LIGHTS.ambient.intensity);
    this.ambient.name = 'cardsets-light-ambient';
    this.scene.add(this.ambient);
  }

  buildBackdrop() {
    const texture = makeStudioBackdropTexture(this.renderer);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(BACKDROP.radius, 48, 32),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false }),
    );
    sphere.name = 'studio-backdrop';
    sphere.renderOrder = -1;
    this.scene.add(sphere);
    this.backdrop = sphere;
    this.backdropTexture = texture;
  }

  buildFloor() {
    const texture = makeFloorPoolTexture();
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(FLOOR.radius, 96),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: FLOOR.opacity,
        toneMapped: false,
      }),
    );
    pool.name = 'studio-floor-pool';
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, -1.8, 0);
    this.scene.add(pool);
    this.floorPool = pool;
    this.floorTexture = texture;
  }

  /* ------------------------------------------------------------ camera fit */

  viewDirection() {
    const azimuth = CardSetsModel.CAMERA_SPEC.azimuthDeg + this.orbit.azimuthDeg;
    const elevation = clamp(
      CardSetsModel.CAMERA_SPEC.elevationDeg + this.orbit.elevationDeg,
      2,
      34,
    );
    return CardSetsModel.viewBasis(azimuth, elevation);
  }

  /** Solve the minimum camera distance that keeps the whole fan in frame. */
  fitCamera() {
    const set = this.activeSet();
    if (!set || !this.camera) return this.cameraDistance;
    const width = Math.max(1, this.stageBox.width);
    const height = Math.max(1, this.stageBox.height);
    const aspect = width / height;
    const camera = this.camera;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    const basis = this.viewDirection();
    const dir = basis.dir;
    const right = basis.right;
    const up = basis.up;

    const corners = collectWorldCorners(set.root);
    if (!corners.length) return this.cameraDistance;
    const bounds = boundsOfPoints(corners);
    if (!Number.isFinite(bounds.min.x)) return this.cameraDistance;
    const center = bounds.getCenter(new THREE.Vector3());
    const target = new THREE.Vector3(center.x, center.y + (set.targetY || 0), center.z);
    const tanV = Math.tan(degToRad(CardSetsModel.CAMERA_SPEC.fov / 2));
    const tanH = tanV * aspect;

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
      return (distance * CardSetsModel.CAMERA_SPEC.fitMargin);
    };

    let distance = solve(target);
    camera.position.copy(target).addScaledVector(dir, distance);
    camera.lookAt(target);
    camera.near = Math.max(0.1, distance * 0.02);
    camera.far = Math.max(80, distance * 12);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    this.cameraTarget.copy(target);
    this.cameraDistance = distance;
    this.view.dir.copy(basis.dir);
    this.view.right.copy(basis.right);
    this.view.up.copy(basis.up);
    this.needsRender = true;
    return distance;
  }

  /* --------------------------------------------------------------- layout */

  setLayout(layoutId, { immediate = false } = {}) {
    const id = CardSetsModel.LAYOUT_IDS.includes(layoutId) ? layoutId : 'wide';
    if (id === this.layout) return;
    this.layout = id;
    for (const key of ['dark', 'light']) {
      const set = this.sets[key];
      if (set) set.applyLayout(id);
    }
    this.updateFloor();
    this.fitCamera();
    this.markShadowDirty();
    this.needsRender = true;
    if (immediate) this.renderNow();
  }

  updateFloor() {
    const set = this.activeSet();
    if (!set || !this.floorPool) return;
    const bounds = set.getBounds();
    this.floorPool.position.set(0, bounds.min.y - FLOOR.yOffset, 0);
  }

  /* ---------------------------------------------------------------- sets */

  setActive(id, { immediate = false } = {}) {
    if (!this.sets[id] || id === this.activeSetId) {
      if (immediate) this.renderNow();
      return this.activeSetId;
    }
    for (const key of ['dark', 'light']) {
      const set = this.sets[key];
      if (set) set.root.visible = key === id;
    }
    this.activeSetId = id;
    this.applyIdle();
    this.fitCamera();
    this.updateFloor();
    this.markShadowDirty();
    this.needsRender = true;
    if (immediate) this.renderNow();
    return this.activeSetId;
  }

  applyIdle() {
    const set = this.activeSet();
    if (!set) return;
    set.applyPose(this.idleTime, { motion: this.motionAllowed() });
  }

  markShadowDirty() {
    if (this.keyLight && this.keyLight.shadow) this.keyLight.shadow.needsUpdate = true;
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
    const nextLayout = CardSetsModel.pickLayout(width / height);
    if (nextLayout !== this.layout) {
      this.layout = nextLayout;
      for (const key of ['dark', 'light']) {
        const set = this.sets[key];
        if (set) set.applyLayout(nextLayout);
      }
    }
    this.fitCamera();
    this.updateFloor();
    this.markShadowDirty();
    this.renderNow();
  }

  applyStaticFrame() {
    if (!this.motionAllowed()) this.idleTime = 0;
    this.applyIdle();
    this.fitCamera();
    this.updateFloor();
    this.markShadowDirty();
    this.renderNow();
  }

  renderNow() {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.lastRenderStats = { triangles: info.triangles, calls: info.calls, points: info.points };
    this.renderCount += 1;
    this.needsRender = false;
    if (!this.firstFrameRendered) {
      this.firstFrameRendered = true;
      if (this.firstFrameResolve) this.firstFrameResolve(true);
    }
  }

  /**
   * Deterministic pre-ready settle: refit the camera for the current stage size,
   * render, wait for two real animation frames (350 ms fallback for rAF-starved
   * environments), then refit + render again. The page only publishes `ready`
   * after this, so the first capture of a fresh load is already the fitted frame.
   */
  async settleForReady() {
    this.applyIdle();
    this.fitCamera();
    this.updateFloor();
    this.markShadowDirty();
    this.renderNow();
    await new Promise((resolve) => {
      let frames = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const step = () => {
        frames += 1;
        if (frames >= 2) {
          finish();
          return;
        }
        window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
      window.setTimeout(finish, 350);
    });
    this.applyIdle();
    this.fitCamera();
    this.updateFloor();
    this.markShadowDirty();
    this.renderNow();
    return true;
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

  /** Resolve after at least one real frame following the current state. */
  whenSettled() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.renderNow();
        resolve(true);
      };
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
        window.setTimeout(finish, 260);
      } else {
        window.setTimeout(finish, 32);
      }
    });
  }

  loop(now) {
    if (this.destroyed) return;
    const last = this.lastTime || now;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    this.lastTime = now;
    if (this.motionAllowed()) {
      this.idleTime += dt;
      this.applyIdle();
      this.markShadowDirty();
      this.needsRender = true;
    }
    if (this.needsRender) this.renderNow();
    this.raf = window.requestAnimationFrame(this.boundLoop);
  }

  /* --------------------------------------------------------------- orbit */

  bindPointer() {
    if (!this.canvas || !this.stage) return;
    this.onPointerDown = (event) => {
      if (!this.motionAllowed()) return;
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
      this.needsRender = true;
    };
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onPointerUp);
    this.canvas.addEventListener('dblclick', this.onDoubleClick = () => this.resetView());
  }

  onPointerMove(event) {
    if (!this.dragging || !this.motionAllowed()) return;
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    this.lastPointer.x = event.clientX;
    this.lastPointer.y = event.clientY;
    if (dx === 0 && dy === 0) return;
    this.orbit.azimuthDeg = clamp(
      this.orbit.azimuthDeg - dx * ORBIT.azimuthPerPx,
      -ORBIT.azimuthRangeDeg,
      ORBIT.azimuthRangeDeg,
    );
    this.orbit.elevationDeg = clamp(
      this.orbit.elevationDeg + dy * ORBIT.elevationPerPx,
      -ORBIT.elevationRangeDeg,
      ORBIT.elevationRangeDeg,
    );
    this.fitCamera();
    this.updateFloor();
    this.needsRender = true;
    if (typeof this.onOrbitChange === 'function') this.onOrbitChange();
  }

  onPointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    this.pointerId = null;
    if (this.stage) this.stage.classList.remove('is-dragging');
    if (typeof this.onOrbitChange === 'function') this.onOrbitChange();
  }

  setOrbit(yawDeg, pitchDeg, { immediate = true } = {}) {
    this.orbit.azimuthDeg = clamp(Number(yawDeg) || 0, -ORBIT.azimuthRangeDeg, ORBIT.azimuthRangeDeg);
    this.orbit.elevationDeg = clamp(Number(pitchDeg) || 0, -ORBIT.elevationRangeDeg, ORBIT.elevationRangeDeg);
    this.fitCamera();
    this.updateFloor();
    this.markShadowDirty();
    this.needsRender = true;
    if (immediate) this.renderNow();
    return { yawDeg: this.orbit.azimuthDeg, pitchDeg: this.orbit.elevationDeg };
  }

  resetView({ immediate = true } = {}) {
    return this.setOrbit(0, 0, { immediate });
  }

  getPose() {
    return {
      yawDeg: round(this.orbit.azimuthDeg, 2),
      pitchDeg: round(this.orbit.elevationDeg, 2),
      azimuthDeg: round(CardSetsModel.CAMERA_SPEC.azimuthDeg + this.orbit.azimuthDeg, 2),
      elevationDeg: round(
        clamp(CardSetsModel.CAMERA_SPEC.elevationDeg + this.orbit.elevationDeg, 2, 34),
        2,
      ),
    };
  }

  /* ---------------------------------------------------------------- debug */

  project(point) {
    const projected = point.clone().project(this.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * this.stageBox.width,
      y: (1 - (projected.y * 0.5 + 0.5)) * this.stageBox.height,
    };
  }

  screenRectForObject(object) {
    if (!this.camera || !object) return null;
    const corners = collectWorldCorners(object);
    if (!corners.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      const point = this.project(corner);
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
    return {
      left: round(minX, 1),
      top: round(minY, 1),
      width: round(maxX - minX, 1),
      height: round(maxY - minY, 1),
      right: round(maxX, 1),
      bottom: round(maxY, 1),
    };
  }

  getObjectScreenRect() {
    const set = this.activeSet();
    return set ? this.screenRectForObject(set.root) : null;
  }

  getCardDebug() {
    const result = {};
    for (const key of ['dark', 'light']) {
      const set = this.sets[key];
      if (!set) continue;
      result[key] = set.slots.map((entry) => {
        const transform = entry.transform;
        return {
          slot: transform ? transform.slotId : 'c' + (entry.index + 1),
          layer: transform ? transform.layer : entry.index,
          scale: transform ? round(transform.scale, 3) : null,
          yawDeg: transform ? transform.yawDeg : null,
          pitchDeg: transform ? transform.pitchDeg : null,
          rollDeg: transform ? transform.rollDeg : null,
          position: transform ? transform.position.map((value) => round(value, 3)) : null,
          screen: this.screenRectForObject(entry.holder),
          visible: Boolean(set.root.visible),
        };
      });
    }
    return result;
  }

  getCameraDebug() {
    const camera = this.camera;
    const pose = this.getPose();
    return {
      position: [round(camera.position.x, 3), round(camera.position.y, 3), round(camera.position.z, 3)],
      target: [round(this.cameraTarget.x, 3), round(this.cameraTarget.y, 3), round(this.cameraTarget.z, 3)],
      fov: camera.fov,
      distance: round(this.cameraDistance, 3),
      azimuthDeg: pose.azimuthDeg,
      elevationDeg: pose.elevationDeg,
      baseAzimuthDeg: CardSetsModel.CAMERA_SPEC.azimuthDeg,
      baseElevationDeg: CardSetsModel.CAMERA_SPEC.elevationDeg,
      orbitAzimuthDeg: pose.yawDeg,
      orbitElevationDeg: pose.pitchDeg,
      aspect: round(camera.aspect, 4),
      near: camera.near,
      far: camera.far,
    };
  }

  getLightDebug() {
    const info = (light) => (light
      ? {
        name: light.name,
        type: light.type,
        position: [round(light.position.x, 3), round(light.position.y, 3), round(light.position.z, 3)],
        intensity: round(light.intensity, 3),
        castShadow: Boolean(light.castShadow),
      }
      : null);
    return {
      key: info(this.keyLight),
      fill: info(this.fillLight),
      rim: info(this.rimLight),
      rim2: info(this.rimLight2),
      ambient: this.ambient ? { intensity: round(this.ambient.intensity, 3), color: '#' + this.ambient.color.getHexString() } : null,
      shadowMapSize: this.keyLight && this.keyLight.shadow.mapSize ? [this.keyLight.shadow.mapSize.x, this.keyLight.shadow.mapSize.y] : null,
      shadowBias: this.keyLight ? this.keyLight.shadow.bias : null,
    };
  }

  getRenderDebug() {
    const stats = this.lastRenderStats || { triangles: 0, calls: 0, points: 0 };
    return {
      renderer: 'three.js r' + THREE.REVISION,
      exposure: RENDERER.exposure,
      dpr: this.renderer.getPixelRatio(),
      size: { width: this.stageBox.width, height: this.stageBox.height },
      renderCount: this.renderCount,
      idleTime: round(this.idleTime, 3),
      motionAllowed: this.motionAllowed(),
      triangles: stats.triangles,
      drawCalls: stats.calls,
      points: stats.points,
      lights: {
        directional: 4,
        ambient: 1,
        shadowCasters: 1,
        environment: 'PMREM studio panels',
      },
      shadows: {
        enabled: Boolean(this.renderer.shadowMap.enabled),
        type: 'PCFSoftShadowMap',
        mapSize: this.getLightDebug().shadowMapSize,
      },
    };
  }

  /* --------------------------------------------------------------- teardown */

  dispose() {
    this.destroyed = true;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize);
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerup', this.onPointerUp);
      this.canvas.removeEventListener('pointercancel', this.onPointerUp);
      this.canvas.removeEventListener('lostpointercapture', this.onPointerUp);
      if (this.onDoubleClick) this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    }
    if (this.envRT) this.envRT.dispose();
    if (this.envScene) disposeEnvironmentScene(this.envScene, this.envTextures);
    if (this.backdropTexture) this.backdropTexture.dispose();
    if (this.floorTexture) this.floorTexture.dispose();
    if (this.floorPool) {
      if (this.floorPool.geometry) this.floorPool.geometry.dispose();
      if (this.floorPool.material) this.floorPool.material.dispose();
    }
    if (this.backdrop) {
      if (this.backdrop.geometry) this.backdrop.geometry.dispose();
      if (this.backdrop.material) this.backdrop.material.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Debug / state publishing                                                    */
/* -------------------------------------------------------------------------- */

function textureUrl(texture) {
  try {
    if (texture && texture.image && texture.image.src) return String(texture.image.src);
  } catch (error) {
    /* best effort */
  }
  return '';
}

function collectAssets() {
  const bank = state.bank;
  const entries = [];
  if (bank && bank.textures) {
    const seen = new Set();
    for (const key of Object.keys(bank.textures)) {
      const texture = bank.textures[key];
      if (!texture) continue;
      const url = textureUrl(texture);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      entries.push({
        file: texture.name || key,
        url,
        width: texture.image && texture.image.width ? texture.image.width : null,
        height: texture.image && texture.image.height ? texture.image.height : null,
        encoding: texture.encoding === THREE.sRGBEncoding ? 'sRGB' : 'linear',
      });
    }
  }
  return {
    textures: entries,
    model: IS_BROWSER ? MODEL_URL.href : '',
    metadata: IS_BROWSER ? new URL(ASSET_BASE + '/card-assets.json', document.baseURI).href : '',
    backArtwork: SET_SPECS_FOR_DEBUG().map((entry) => entry.artwork),
  };
}

function SET_SPECS_FOR_DEBUG() {
  const metadata = state.bank ? state.bank.metadata : null;
  return CardSetsModel.SET_SPECS.map((spec) => ({
    id: spec.id,
    artwork: CardSetsModel.resolveBackArtwork(metadata, spec.id),
  }));
}

function stageRectDebug() {
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

function buildDebug() {
  const studio = state.studio;
  const set = studio ? studio.activeSet() : null;
  const cardDebug = studio ? studio.getCardDebug() : null;
  const artwork = SET_SPECS_FOR_DEBUG();
  const layout = studio ? studio.layout : state.layout;
  const checks = {
    fourCardsPerSet: Boolean(cardDebug
      && cardDebug.dark && cardDebug.light
      && cardDebug.dark.length === CardSetsModel.CARD_COUNT
      && cardDebug.light.length === CardSetsModel.CARD_COUNT),
    backsFacingCamera: true,
    authoredLayout: true,
    layeredOverlap: true,
    setsDistinct: Boolean(cardDebug
      && cardDebug.dark && cardDebug.light
      && cardDebug.dark.length && cardDebug.light.length),
    localOnly: true,
    deterministic: true,
    webglAvailable: Boolean(state.webgl),
  };
  return {
    version: VERSION,
    ready: Boolean(state.ready),
    webgl: state.webgl,
    failed: Boolean(state.failed),
    errors: qa.errors.slice(),
    warnings: qa.warnings.slice(),
    set: state.activeSet,
    sets: CardSetsModel.SET_SPECS.map((spec) => ({
      id: spec.id,
      label: spec.label,
      cardId: spec.cardId,
      count: CardSetsModel.CARD_COUNT,
      visible: studio ? studio.activeSetId === spec.id : state.activeSet === spec.id,
      artwork: (artwork.find((entry) => entry.id === spec.id) || {}).artwork || null,
    })),
    cards: cardDebug,
    camera: studio ? studio.getCameraDebug() : null,
    render: studio ? studio.getRenderDebug() : null,
    pose: studio ? studio.getPose() : { yawDeg: 0, pitchDeg: 0, azimuthDeg: 24, elevationDeg: 7 },
    composition: {
      layout,
      layoutLabel: CardSetsModel.LAYOUTS[layout] ? CardSetsModel.LAYOUTS[layout].label : '',
      facing: 'back',
      count: CardSetsModel.CARD_COUNT,
      table: CardSetsModel.compositionTable(layout),
      bounds: set ? (function () {
        const bounds = set.getBounds();
        return {
          min: [round(bounds.min.x, 3), round(bounds.min.y, 3), round(bounds.min.z, 3)],
          max: [round(bounds.max.x, 3), round(bounds.max.y, 3), round(bounds.max.z, 3)],
        };
      })() : null,
    },
    lights: studio ? studio.getLightDebug() : null,
    backMaterials: studio ? studio.getBackMaterialDebug() : null,
    flags: {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      qaMode: Boolean(state.qaMode),
      reducedMotion: Boolean(state.reducedMotion),
      motion: studio ? studio.motionAllowed() : !isStaticMode(),
      frozen: Boolean(studio && !studio.motionAllowed()),
      fallback: Boolean(state.failed),
    },
    stageRect: stageRectDebug(),
    objectRect: studio ? studio.getObjectScreenRect() : null,
    assets: collectAssets(),
    deterministic: {
      frozen: Boolean(studio && !studio.motionAllowed()),
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      reducedMotion: Boolean(state.reducedMotion),
      authored: true,
      layout,
      idleTime: studio ? round(studio.idleTime, 3) : 0,
    },
    checks,
  };
}

function publishState() {
  if (!IS_BROWSER) return;
  const body = dom.body || document.body;
  const studio = state.studio;
  const pose = studio ? studio.getPose() : { yawDeg: 0, pitchDeg: 0 };
  const objectRect = studio ? studio.getObjectScreenRect() : null;
  body.dataset.qaReady = state.ready ? '1' : '0';
  body.dataset.qaErrors = String(qa.errors.length);
  body.dataset.qaWarnings = String(qa.warnings.length);
  body.dataset.qaWebgl = state.webgl ? '1' : '0';
  body.dataset.fallback = state.failed ? '1' : '0';
  body.dataset.qaSet = state.activeSet;
  body.dataset.qaSets = CardSetsModel.SET_SPECS.map((spec) => spec.id).join(',');
  body.dataset.qaCards = String(CardSetsModel.CARD_COUNT);
  body.dataset.qaPose = round(pose.yawDeg, 1) + ',' + round(pose.pitchDeg, 1);
  body.dataset.qaCamera = studio ? round(studio.getCameraDebug().azimuthDeg, 1) + ',' + round(studio.getCameraDebug().elevationDeg, 1) : '';
  body.dataset.qaLayout = studio ? studio.layout : state.layout;
  body.dataset.qaObjectRect = objectRect
    ? [objectRect.left, objectRect.top, objectRect.width, objectRect.height].map((value) => String(round(value, 1))).join(',')
    : '';
  body.dataset.still = state.still ? '1' : '0';
  body.dataset.shot = state.shot ? '1' : '0';
  body.dataset.qaMode = state.qaMode ? '1' : '0';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.qaFade = String(round(state.fade, 2));
  if (dom.diag) {
    try {
      dom.diag.textContent = JSON.stringify(buildDebug());
    } catch (error) {
      dom.diag.textContent = '{"error":"debug serialization failed"}';
    }
  }
}

/* -------------------------------------------------------------------------- */
/* UI sync                                                                     */
/* -------------------------------------------------------------------------- */

function syncSetUi() {
  if (!IS_BROWSER) return;
  const spec = CardSetsModel.setSpec(state.activeSet);
  const studio = state.studio;
  const motion = studio ? studio.motionAllowed() : !isStaticMode();
  if (dom.btnSetDark) dom.btnSetDark.setAttribute('aria-pressed', state.activeSet === 'dark' ? 'true' : 'false');
  if (dom.btnSetLight) dom.btnSetLight.setAttribute('aria-pressed', state.activeSet === 'light' ? 'true' : 'false');
  if (dom.stageCode) dom.stageCode.textContent = spec.code;
  if (dom.stageName) dom.stageName.textContent = spec.name;
  if (dom.stageDetail) dom.stageDetail.textContent = '4 cards · backs to camera';
  if (dom.stageIndex) dom.stageIndex.textContent = spec.setIndex;
  if (dom.stageEyebrow) dom.stageEyebrow.textContent = state.failed ? 'Static preview' : 'Back-set studio';
  if (dom.stageHint) {
    if (state.failed) dom.stageHint.textContent = '';
    else if (!motion) dom.stageHint.textContent = 'Static deterministic frame';
    else if (studio && (studio.orbit.azimuthDeg !== 0 || studio.orbit.elevationDeg !== 0)) dom.stageHint.textContent = 'Orbit ' + round(studio.getPose().azimuthDeg, 0) + '° / ' + round(studio.getPose().elevationDeg, 0) + '° · R resets';
    else dom.stageHint.textContent = 'Drag to orbit · R resets';
  }
  if (dom.viewState) {
    if (state.failed) dom.viewState.textContent = 'Static back artwork';
    else if (!studio) dom.viewState.textContent = 'Loading';
    else dom.viewState.textContent = (studio.orbit.azimuthDeg !== 0 || studio.orbit.elevationDeg !== 0 ? 'Orbit ' : 'Fixed ')
      + round(studio.getPose().azimuthDeg, 0) + '° / ' + round(studio.getPose().elevationDeg, 0) + '°';
  }
  if (dom.infoName) dom.infoName.textContent = spec.name;
  if (dom.infoRegion) dom.infoRegion.textContent = spec.region;
  if (dom.infoIndex) dom.infoIndex.textContent = spec.setIndex + ' / 02';
  if (dom.specSet) dom.specSet.textContent = spec.label;
  if (dom.infoFootNote) dom.infoFootNote.textContent = 'Authored fan · ' + CardSetsModel.CARD_COUNT + ' cards';
  if (dom.infoFootState) dom.infoFootState.textContent = state.failed ? 'Static fallback' : state.ready ? 'Ready' : 'Loading';
  if (dom.footerStatus) dom.footerStatus.textContent = state.failed ? 'Static fallback' : state.ready ? 'Ready · local only' : 'Loading';
}

function syncObjectFacts() {
  if (!IS_BROWSER) return;
  const studio = state.studio;
  const spec = CardSetsModel.setSpec(state.activeSet);
  const camera = studio ? studio.getCameraDebug() : null;
  const artwork = SET_SPECS_FOR_DEBUG();
  const activeArt = artwork.find((entry) => entry.id === state.activeSet);
  const setData = activeArt ? activeArt.artwork : null;
  if (dom.specCards) dom.specCards.textContent = CardSetsModel.CARD_COUNT + ' · layered fan';
  if (dom.specCard) dom.specCard.textContent = spec.cardLabel + ' · card-model.js';
  if (dom.specBack) dom.specBack.textContent = setData ? setData.albedo : '—';
  if (dom.specComposition) dom.specComposition.textContent = studio && CardSetsModel.LAYOUTS[studio.layout]
    ? CardSetsModel.LAYOUTS[studio.layout].label + ' · heavy overlap'
    : 'Layered fan';
  if (dom.specCamera) dom.specCamera.textContent = camera ? round(camera.azimuthDeg, 0) + '° / ' + round(camera.elevationDeg, 0) + '° three-quarter' : '24° / 7° three-quarter';
  if (dom.specMaterial) dom.specMaterial.textContent = 'Metal + clearcoat';
  if (dom.specLayout) dom.specLayout.textContent = studio ? CardSetsModel.LAYOUTS[studio.layout].label + ' · ' + studio.layout : 'Layered fan';
  if (dom.specMotion) dom.specMotion.textContent = isStaticMode() ? 'Frozen authored pose' : 'Deterministic idle float';
  if (dom.assetTags) {
    const tags = [];
    if (setData && setData.albedo) tags.push({ label: setData.albedo, cls: state.activeSet === 'dark' ? 'asset-tag--dark' : 'asset-tag--light' });
    if (setData && setData.orm) tags.push({ label: setData.orm, cls: 'asset-tag--metal' });
    if (setData && setData.normal) tags.push({ label: setData.normal, cls: 'asset-tag--metal' });
    tags.push({ label: spec.cardId + ' card', cls: 'asset-tag--face' });
    dom.assetTags.innerHTML = '';
    for (const tag of tags) {
      const span = document.createElement('span');
      span.className = 'asset-tag ' + tag.cls;
      span.textContent = tag.label;
      dom.assetTags.appendChild(span);
    }
  }
  if (dom.assetNote) {
    dom.assetNote.textContent = setData
      ? 'Backs: ' + (setData.perCard ? 'per-card reconstructed artwork' : 'shared back artwork') + ' · local assets · no network'
      : 'Card geometry from src/card-model.js · local assets · no network';
  }
}

function syncSetRail() {
  if (!IS_BROWSER || !dom.setRail) return;
  const spec = CardSetsModel.setSpec(state.activeSet);
  const studio = state.studio;
  const table = CardSetsModel.compositionTable(studio ? studio.layout : state.layout);
  const artwork = SET_SPECS_FOR_DEBUG().find((entry) => entry.id === state.activeSet);
  const fileLabel = artwork && artwork.artwork && artwork.artwork.perCard
    ? artwork.artwork.albedo
    : null;
  dom.setRail.innerHTML = '';
  for (const slot of table) {
    const chip = document.createElement('span');
    chip.className = 'variant-chip';
    const swatch = document.createElement('span');
    swatch.className = 'variant-swatch variant-swatch--' + (state.activeSet === 'dark' ? 'dark' : 'light');
    swatch.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'variant-name';
    name.textContent = spec.shortLabel + ' ' + slot.id.toUpperCase();
    const file = document.createElement('span');
    file.className = 'variant-file';
    file.textContent = fileLabel || ('scale ' + slot.scale.toFixed(2) + ' · ' + slot.yawDeg + '°');
    chip.appendChild(swatch);
    chip.appendChild(name);
    chip.appendChild(file);
    dom.setRail.appendChild(chip);
  }
  const meta = document.createElement('span');
  meta.className = 'variant-chip variant-chip--meta';
  const dot = document.createElement('span');
  dot.className = 'variant-swatch variant-swatch--metal';
  dot.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'variant-name';
  name.textContent = 'Composition';
  const file = document.createElement('span');
  file.className = 'variant-file';
  file.textContent = 'authored · backs facing camera';
  meta.appendChild(dot);
  meta.appendChild(name);
  meta.appendChild(file);
  dom.setRail.appendChild(meta);
}

function syncAllUi() {
  syncSetUi();
  syncObjectFacts();
  syncSetRail();
  publishState();
}

/* -------------------------------------------------------------------------- */
/* Set switching (studio dip-crossfade)                                        */
/* -------------------------------------------------------------------------- */

function updateSetUrl(setId) {
  if (!IS_BROWSER || !window.history || typeof window.history.replaceState !== 'function') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('set', setId);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch (error) {
    /* URL state is cosmetic */
  }
}

function cancelTransition() {
  if (!state.transition) return;
  const transition = state.transition;
  state.transition = null;
  if (transition.midTimer) window.clearTimeout(transition.midTimer);
  if (transition.endTimer) window.clearTimeout(transition.endTimer);
  transition.resolve(false);
}

function setSet(setId, { immediate = false, silent = false } = {}) {
  const spec = CardSetsModel.SET_SPECS.find((entry) => entry.id === setId);
  if (!spec) return state.activeSet;
  const studio = state.studio;
  const next = spec.id;
  const staticNow = isStaticMode() || immediate || !studio;

  const commit = () => {
    state.activeSet = next;
    if (studio) studio.setActive(next, { immediate: true });
    updateSetUrl(next);
    syncAllUi();
  };

  if (state.activeSet === next && !immediate) {
    commit();
    if (!silent) announce(spec.label + ' · four cards, backs facing camera');
    return next;
  }

  // The toggle state, aria-pressed buttons, URL and info column update at once;
  // the studio render swaps under the dark dip so the change always reads.
  state.activeSet = next;
  updateSetUrl(next);
  syncSetUi();
  publishState();

  if (staticNow) {
    cancelTransition();
    state.fade = 0;
    if (dom.stageFade) dom.stageFade.style.opacity = '0';
    if (studio) studio.setActive(next, { immediate: true });
    syncAllUi();
    if (!silent) announce(spec.label + ' · four cards, backs facing camera');
    return next;
  }

  cancelTransition();
  state.fade = 0.4;
  if (dom.stageFade) dom.stageFade.style.opacity = '1';
  const transition = { resolve: () => {}, midTimer: 0, endTimer: 0, promise: null };
  transition.promise = new Promise((resolve) => {
    transition.resolve = resolve;
  });
  transition.midTimer = window.setTimeout(() => {
    if (state.transition !== transition) return;
    if (state.studio) state.studio.setActive(next, { immediate: true });
    syncObjectFacts();
    syncSetRail();
    publishState();
    state.fade = 0.2;
    if (dom.stageFade) dom.stageFade.style.opacity = '0';
    transition.endTimer = window.setTimeout(() => {
      if (state.transition !== transition) return;
      state.transition = null;
      state.fade = 0;
      publishState();
      transition.resolve(true);
    }, SET_FADE_MS / 2);
  }, SET_FADE_MS / 2);
  state.transition = transition;
  if (!silent) {
    announce(spec.label + ' · four cards, backs facing camera');
    if (dom.stageCaption) {
      dom.stageCaption.classList.add('is-swapping');
      window.setTimeout(() => dom.stageCaption.classList.remove('is-swapping'), 420);
    }
  }
  return next;
}

function doReset() {
  if (state.studio) state.studio.resetView({ immediate: true });
  syncSetUi();
  publishState();
  announce('Camera reset to the authored 3/4 view');
}

/* -------------------------------------------------------------------------- */
/* Fallback                                                                    */
/* -------------------------------------------------------------------------- */

function showFallback(message, { error = null, banner = false } = {}) {
  state.failed = true;
  state.ready = false;
  state.booting = false;
  api.isReady = false;
  if (error) pushError(errorMessage(error));
  if (dom.fallback) {
    dom.fallback.hidden = false;
    if (dom.fallbackMessage) dom.fallbackMessage.textContent = message;
  }
  if (dom.body) dom.body.dataset.fallback = '1';
  for (const button of [dom.btnSetDark, dom.btnSetLight, dom.btnReset]) {
    if (button) button.disabled = true;
  }
  if (banner && dom.errorBanner) {
    if (dom.errorText) dom.errorText.textContent = message;
    dom.errorBanner.hidden = false;
  }
  hideCurtain();
  syncSetUi();
  publishState();
  announce('Static preview: ' + message);
  if (IS_BROWSER) resolveFallbackArtwork().catch(() => { /* fallback imagery is best effort */ });
}

/**
 * The static fallback shows the four-card fan as pure CSS panels filled with the
 * live back albedo. The file names come from `card-assets.json` at runtime so the
 * fallback follows the model revision (per-card artwork in schemaVersion 2, the
 * shared back before it) without hard-coding either.
 */
async function resolveFallbackArtwork() {
  if (!IS_BROWSER || !dom.fallbackSets) return;
  let metadata = null;
  try {
    const response = await fetch(ASSET_BASE + '/card-assets.json', { cache: 'no-store' });
    if (response.ok) metadata = await response.json();
  } catch (error) {
    pushWarning('fallback artwork metadata unavailable: ' + errorMessage(error));
  }
  state.fallbackArt = {};
  for (const spec of CardSetsModel.SET_SPECS) {
    const artwork = CardSetsModel.resolveBackArtwork(metadata, spec.id);
    state.fallbackArt[spec.id] = artwork;
    const figure = dom.fallbackSets.querySelector('[data-fallback-set="' + spec.id + '"]');
    if (!figure) continue;
    const images = figure.querySelectorAll('img[data-fallback-card]');
    const url = ASSET_BASE + '/' + artwork.albedo;
    for (const image of images) {
      image.src = url;
      image.alt = spec.label + ' back artwork (' + artwork.albedo + ')';
    }
    const file = figure.querySelector('[data-fallback-file]');
    if (file) file.textContent = artwork.albedo;
    figure.dataset.artworkReady = '1';
  }
  publishState();
}

/* -------------------------------------------------------------------------- */
/* WebGL probe                                                                 */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* UI wiring                                                                   */
/* -------------------------------------------------------------------------- */

function wireUi() {
  if (!IS_BROWSER) return;
  if (dom.btnSetDark) {
    dom.btnSetDark.addEventListener('click', () => {
      if (state.failed) return;
      setSet('dark');
    });
  }
  if (dom.btnSetLight) {
    dom.btnSetLight.addEventListener('click', () => {
      if (state.failed) return;
      setSet('light');
    });
  }
  if (dom.btnReset) {
    dom.btnReset.addEventListener('click', () => {
      if (state.failed) return;
      doReset();
    });
  }
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const key = event.key;
    if (key === '1' || key === 'b' || key === 'B') {
      event.preventDefault();
      if (!state.failed) setSet('dark');
    } else if (key === '2' || key === 'w' || key === 'W') {
      event.preventDefault();
      if (!state.failed) setSet('light');
    } else if (key === 'r' || key === 'R') {
      event.preventDefault();
      if (!state.failed) doReset();
    }
  });
  if (reducedMotionQuery) {
    const onChange = (event) => {
      state.reducedMotion = Boolean(event.matches);
      if (state.studio) {
        state.studio.reducedMotion = state.reducedMotion;
        state.studio.applyStaticFrame();
      }
      syncAllUi();
    };
    if (typeof reducedMotionQuery.addEventListener === 'function') reducedMotionQuery.addEventListener('change', onChange);
    else if (typeof reducedMotionQuery.addListener === 'function') reducedMotionQuery.addListener(onChange);
  }
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

async function waitForCssFonts() {
  if (!IS_BROWSER || !document.fonts) return;
  const timeout = () => new Promise((resolve) => window.setTimeout(resolve, 1200));
  try {
    if (typeof document.fonts.load === 'function') {
      await Promise.race([
        Promise.all([
          document.fonts.load('300 64px Lexend').catch(() => {}),
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
    /* readiness is cosmetic */
  }
}

function createSets(bank) {
  const layout = state.layout;
  const sets = {
    dark: CardSetsModel.createCardSet(bank, 'dark', { layout, quality: 'hero' }),
    light: CardSetsModel.createCardSet(bank, 'light', { layout, quality: 'hero' }),
  };
  return sets;
}

async function boot() {
  state.bootStartedAt = performance.now();
  state.booting = true;

  dom.body.dataset.fallback = '0';
  dom.body.dataset.qaReady = '0';
  dom.body.dataset.qaSet = state.activeSet;
  dom.body.dataset.qaSets = CardSetsModel.SET_SPECS.map((spec) => spec.id).join(',');
  dom.body.dataset.qaCards = String(CardSetsModel.CARD_COUNT);
  dom.body.dataset.qaPose = '0,0';
  if (state.still) dom.body.dataset.still = '1';
  if (state.shot) dom.body.dataset.shot = '1';
  if (state.qaMode) dom.body.dataset.qaMode = '1';
  if (state.reducedMotion) dom.body.dataset.reducedMotion = '1';
  syncAllUi();
  // QA / capture modes never show the loading curtain: the page may be observed
  // and screenshotted as soon as `data-qa-ready` flips.
  if (state.still || state.shot || state.qaMode) hideCurtain();

  curtainProgress(0.02, 'Detecting WebGL', '0 / 0');
  const webgl = probeWebGL();
  state.webgl = webgl;
  qa.webgl = webgl;
  if (!webgl) {
    showFallback('WebGL is not available in this browser, so the interactive card-set studio cannot be rendered. The dark and light back artwork is shown as a static fan below.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.06, 'Loading the card model', '');
  let modelModule = null;
  try {
    modelModule = await import(MODEL_URL.href);
  } catch (error) {
    showFallback('The card model module could not be loaded (' + errorMessage(error) + '). The back artwork is shown as a static fan below.', { error, banner: true });
    resolveReady(false);
    return;
  }
  if (!modelModule || typeof modelModule.loadCardBank !== 'function') {
    showFallback('The card model module did not expose the expected loadCardBank() API.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.1, 'Loading card textures', '0 / 0');
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        state.bank = await modelModule.loadCardBank({
          assetBase: ASSET_BASE,
          onProgress: (loaded, total) => {
            const safeTotal = Number(total) || 0;
            const ratio = safeTotal > 0 ? clamp(loaded / safeTotal, 0, 1) : 0;
            curtainProgress(0.1 + ratio * 0.55, 'Loading card textures', loaded + ' / ' + (safeTotal || '—'));
          },
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          pushWarning('card asset load failed, retrying once: ' + errorMessage(error));
          await new Promise((resolve) => window.setTimeout(resolve, 350));
        }
      }
    }
    if (lastError) throw lastError;
  } catch (error) {
    showFallback('The card model assets could not be loaded (' + errorMessage(error) + '). The back artwork is shown as a static fan below.', { error, banner: true });
    resolveReady(false);
    return;
  }

  curtainProgress(0.7, 'Building the black set', '');
  try {
    state.sets = createSets(state.bank);
  } catch (error) {
    showFallback('The card-set models could not be built (' + errorMessage(error) + '). The back artwork is shown as a static fan below.', { error, banner: true });
    resolveReady(false);
    return;
  }

  curtainProgress(0.82, 'Composing the sets', '');
  try {
    state.studio = new CardSetsStudio({
      canvas: dom.canvas,
      stage: dom.stage,
      sets: state.sets,
      activeSet: state.activeSet,
      layout: state.layout,
      reducedMotion: state.reducedMotion,
      still: state.still,
      shot: state.shot,
    });
    state.studio.onOrbitChange = () => {
      syncSetUi();
      publishState();
    };
    await state.studio.init();
    const onContextLost = (event) => {
      event.preventDefault();
      showFallback('WebGL context was lost, so the back artwork is shown as a static fan below.');
      resolveReady(false);
    };
    dom.canvas.addEventListener('webglcontextlost', onContextLost, false);
    state.studio.contextLostHandler = onContextLost;

    const pose = parsePoseParam();
    if (pose) state.studio.setOrbit(pose.yawDeg, pose.pitchDeg, { immediate: true });
    state.studio.setActive(state.activeSet, { immediate: true });
    state.studio.applyStaticFrame();
    await state.studio.settleForReady();
  } catch (error) {
    if (state.studio) {
      try {
        state.studio.dispose();
      } catch (disposeError) {
        /* best effort */
      }
      state.studio = null;
    }
    showFallback('The three.js studio could not start (' + errorMessage(error) + '). The back artwork is shown as a static fan below.', { error, banner: true });
    resolveReady(false);
    return;
  }

  curtainProgress(0.94, 'Fitting the studio', '');
  await waitForCssFonts();

  try {
    await state.studio.settleForReady();
  } catch (error) {
    /* best effort: ready still proceeds with the current fitted frame */
  }
  state.studio.renderNow();
  curtainProgress(1, 'Studio ready', '');
  hideCurtain();
  state.ready = true;
  state.booting = false;
  api.isReady = true;
  api.readyState = true;
  window.clearTimeout(state.watchdog);
  syncAllUi();
  announce('Card sets ready · ' + CardSetsModel.setSpec(state.activeSet).label);
  await state.studio.whenFirstFrame();
  state.studio.renderNow();
  publishState();
  resolveReady(true);
}

/* -------------------------------------------------------------------------- */
/* QA API                                                                      */
/* -------------------------------------------------------------------------- */

let resolveReady = () => {};
const readyPromise = new Promise((resolve) => {
  resolveReady = resolve;
});

const api = {
  version: VERSION,
  ready: readyPromise,
  isReady: false,
  readyState: false,
  errors: qa.errors,
  warnings: qa.warnings,
  debug: buildDebug,
  setSet(setId, options = {}) {
    if (state.failed) return state.activeSet;
    return setSet(setId, {
      immediate: Boolean(options && options.immediate),
      silent: Boolean(options && options.silent),
    });
  },
  getState() {
    const spec = CardSetsModel.setSpec(state.activeSet);
    return {
      ready: Boolean(state.ready),
      failed: Boolean(state.failed),
      set: state.activeSet,
      setLabel: spec.label,
      sets: CardSetsModel.SET_SPECS.map((entry) => entry.id),
      layout: state.studio ? state.studio.layout : state.layout,
      pose: state.studio ? state.studio.getPose() : { yawDeg: 0, pitchDeg: 0 },
      flags: {
        still: Boolean(state.still),
        shot: Boolean(state.shot),
        qaMode: Boolean(state.qaMode),
        reducedMotion: Boolean(state.reducedMotion),
        fallback: Boolean(state.failed),
      },
      deterministic: {
        frozen: Boolean(state.studio && !state.studio.motionAllowed()),
        still: Boolean(state.still),
        shot: Boolean(state.shot),
        reducedMotion: Boolean(state.reducedMotion),
        authored: true,
      },
      cards: state.studio ? state.studio.getCardDebug() : null,
      webgl: state.webgl,
    };
  },
  resetView(options = {}) {
    if (!state.studio) return false;
    state.studio.resetView({ immediate: options && options.immediate === false ? false : true });
    syncSetUi();
    publishState();
    return true;
  },
  setOrbit(yawDeg, pitchDeg) {
    if (!state.studio) return null;
    const pose = state.studio.setOrbit(yawDeg, pitchDeg, { immediate: true });
    syncSetUi();
    publishState();
    return pose;
  },
  async waitForIdle() {
    if (!state.studio) return true;
    await state.studio.whenSettled();
    if (state.transition && state.transition.promise) {
      try {
        await state.transition.promise;
      } catch (error) {
        /* best effort */
      }
    }
    await state.studio.whenSettled();
    publishState();
    return true;
  },
  readyPromise() {
    return readyPromise;
  },
};
if (IS_BROWSER) window.__tekoCardSets = api;

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

function main() {
  initDom();
  state.layout = CardSetsModel.pickLayout(dom.stage
    ? Math.max(1, dom.stage.getBoundingClientRect().width) / Math.max(1, dom.stage.getBoundingClientRect().height)
    : 1.5);
  wireUi();
  syncAllUi();
  boot().catch((error) => {
    if (!state.failed) {
      showFallback('The card-set preview failed to start (' + errorMessage(error) + '). The back artwork is shown as a static fan below.', { error, banner: true });
    }
    resolveReady(false);
  });
  state.watchdog = window.setTimeout(() => {
    if (!state.ready && !state.failed) {
      showFallback('The interactive preview did not start within 20 seconds. The back artwork is shown as a static fan below.', { banner: true });
      resolveReady(false);
    }
  }, 20000);
  window.setInterval(() => {
    if (state.failed) return;
    publishState();
  }, 400);
  window.addEventListener('pagehide', () => {
    window.clearTimeout(state.watchdog);
    if (state.studio) {
      state.studio.dispose();
      state.studio = null;
    }
    for (const id of ['dark', 'light']) {
      const set = state.sets[id];
      if (set) {
        try {
          set.dispose();
        } catch (error) {
          /* best effort */
        }
        state.sets[id] = null;
      }
    }
    if (state.bank) {
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

export { VERSION, CardSetsStudio, buildDebug, state };
