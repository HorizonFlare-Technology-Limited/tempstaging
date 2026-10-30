/**
 * tekoanimation — connection crystal preview controller.
 *
 * Standalone collection page controller for `connection.html` (see
 * notes/CONNECTION_CONTRACT.md): a dark editorial three.js studio showing two
 * interlocked right-angle L plates — ribbed silver metal bodies under layered
 * clear / dark acrylic tops — supported by two satin columns from the columns
 * deliverable, with a continuous silver "data" conduit threading the 28 px light
 * seam in the acrylic and leaving both open ends through clear rod bundles.
 *
 * The model (geometry, materials, flow path, clearance report) comes from
 * ./connection-model.js; this file owns the renderer, the Rev21 image-based
 * lighting (ONLY the shared room photograph assets/env/modern-empty-room.jpg
 * through ./env-room.js — no THREE lights, no procedural dome/softbox studio),
 * the fitted 33° / 33° three-quarter camera, the faint reflective
 * ground, the contact darkening under the satin columns, the drag-to-orbit
 * controls, the deterministic modes, the QA hooks and the fallback.
 *
 * Boot: renderer -> loadColumnBank() (satin from the columns deliverable) ->
 * createSatinMaterial(bank) -> createConnectionModel(...) -> studio -> ready.
 * A failed satin bank only degrades the material (numeric fallback); any other
 * failure shows the inline-SVG poster.
 *
 * Modes:
 *   default             autoplay: 7.0 s flow loop (drag to orbit)
 *   ?still=1            frozen at FLOW_SPEC.stillPhase, orbit allowed
 *   ?shot=1             frozen at FLOW_SPEC.stillPhase, controls disabled
 *   reduced motion      frozen at FLOW_SPEC.stillPhase, orbit allowed
 *   ?flow=0             autoplay but paused at the current phase
 *
 * QA hook: window.__tekoConnection = { version, ready, errors, warnings,
 * isReady, resetView, setPlaying, getPlaying, setFlowPhase, getFlowPhase,
 * getMode, debug } plus body[data-qa-*] attributes and the #qa-diag mirror.
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { loadColumnBank } from './columns-model.js';
import * as ConnectionModel from './connection-model.js';
import { applyEnvRoom } from './env-room.js';

const VERSION = '1.0.0';
const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/* --------------------------------------------------- model-api + fallbacks */

// The binding contract values, used only if connection-model.js does not expose
// them (it should). The preview never invents a different composition.
const FALLBACK_CAMERA = Object.freeze({
  azimuthDeg: 33,
  elevationDeg: 27,
  fov: 31,
  rollDeg: 0,
  target: [0, 584, 0],
  fitPadding: 1.08,
  near: 10,
  far: 20000,
});
const FALLBACK_FLOW = Object.freeze({
  period: 7.0,
  stillPhase: 0.36,
  radius: 9,
  glowRadius: 15,
  particleCount: 72,
  cornerRadius: 46,
  taper: 60,
  sampleStep: 2,
});
const FALLBACK_COLUMN_SPECS = Object.freeze([
  Object.freeze({ id: 'satin-large-long', width: 140, depth: 140, height: 600, position: [-330, 0, 330] }),
  Object.freeze({ id: 'satin-medium-close', width: 80, depth: 80, height: 600, position: [330, 0, -250] }),
]);

const MODEL_API = {
  createConnectionModel: typeof ConnectionModel.createConnectionModel === 'function'
    ? ConnectionModel.createConnectionModel
    : null,
  createSatinMaterial: typeof ConnectionModel.createSatinMaterial === 'function'
    ? ConnectionModel.createSatinMaterial
    : null,
  createFallbackSatinMaterial: typeof ConnectionModel.createFallbackSatinMaterial === 'function'
    ? ConnectionModel.createFallbackSatinMaterial
    : null,
  CAMERA_SPEC: ConnectionModel.CAMERA_SPEC && typeof ConnectionModel.CAMERA_SPEC === 'object'
    ? ConnectionModel.CAMERA_SPEC
    : FALLBACK_CAMERA,
  FLOW_SPEC: ConnectionModel.FLOW_SPEC && typeof ConnectionModel.FLOW_SPEC === 'object'
    ? ConnectionModel.FLOW_SPEC
    : FALLBACK_FLOW,
  MODEL_VERSION: typeof ConnectionModel.MODEL_VERSION === 'string' ? ConnectionModel.MODEL_VERSION : '0.0.0',
  SATIN_COLUMN_SPECS: Array.isArray(ConnectionModel.SATIN_COLUMN_SPECS) && ConnectionModel.SATIN_COLUMN_SPECS.length
    ? ConnectionModel.SATIN_COLUMN_SPECS
    : FALLBACK_COLUMN_SPECS,
};

const CAMERA = MODEL_API.CAMERA_SPEC;
const FLOW = MODEL_API.FLOW_SPEC;
const FLOW_PERIOD = Number(FLOW.period) > 0 ? Number(FLOW.period) : 7;
const STILL_PHASE = Number.isFinite(Number(FLOW.stillPhase)) ? clampPhase(Number(FLOW.stillPhase)) : 0.36;

/* ------------------------------------------------------------ render tuning */

// Rev21 image-based lighting: the dark-room photograph supplies both the black
// ambience of the void and the bright ceiling downlights that the silver ribs,
// acrylic edges and satin columns mirror. No direct light exists on the page.
const RENDERER = Object.freeze({ exposure: 1.0, dprMax: 2 });

/**
 * The only light source on the page. ./env-room.js filters
 * `assets/env/modern-empty-room.jpg` into a PMREM and assigns it to
 * `scene.environment`; on r151 the intensity multiplies each material's own
 * `envMapIntensity`, so the authored metal/acrylic ratios are preserved.
 */
const ENV_ROOM = Object.freeze({
  intensity: 1.3,
  label: 'assets/env/modern-empty-room.jpg (PMREM, env-room)',
});

const GROUND = Object.freeze({
  radius: 4200,
  y: 0,
  color: 0x04060b,
  metalness: 0.7,
  roughness: 0.3,
  opacity: 0.45,
  envMapIntensity: 0.28,
});

const CONTACT = Object.freeze({ scale: 2.5, opacity: 0.62, y: 0.9 });

const MSG = Object.freeze({
  webgl: 'WebGL is unavailable in this browser, so the live connection crystal cannot be rendered. A static poster of the two interlocked L plates and their silver conduit is shown.',
  renderer: 'The WebGL renderer could not start, so a static poster of the connection crystal is shown.',
  contextLost: 'The WebGL context was lost, so a static poster of the connection crystal is shown.',
  watchdog: 'The interactive preview did not start within 24 seconds. A static poster of the connection crystal is shown.',
  model: 'The connection-crystal model could not be built, so a static poster is shown.',
  studio: 'The three.js studio could not start, so a static poster of the connection crystal is shown.',
  module: 'The interactive preview module could not start. A static poster of the connection crystal is shown.',
});

/* ------------------------------------------------------------- early qa state */

const qa = IS_BROWSER
  ? (window.__TEKO_CONNECTION_QA = window.__TEKO_CONNECTION_QA || { errors: [], warnings: [], webgl: null })
  : { errors: [], warnings: [], webgl: null };
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];

function pushError(message) {
  qa.errors.push('connection-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}

function pushWarning(message) {
  qa.warnings.push('connection-preview: ' + message);
  if (qa.warnings.length > 60) qa.warnings.splice(0, qa.warnings.length - 60);
}

function errorMessage(error) {
  if (!error) return 'Unknown error';
  const message = error.message ? String(error.message) : String(error);
  return message.length > 240 ? message.slice(0, 237) + '...' : message;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};

function clampPhase(value) {
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function violationCount(clearance) {
  if (!clearance) return 0;
  const violations = clearance.violations;
  if (Array.isArray(violations)) return violations.length;
  return Number.isFinite(Number(violations)) ? Number(violations) : 0;
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

const flowParam = urlParams.get('flow');
const PLAY_PARAM = flowParam === '0' ? false : flowParam === '1' ? true : null;

const state = {
  ready: false,
  failed: false,
  booting: true,
  webgl: null,
  model: null,
  studio: null,
  bank: null,
  satinSource: null,
  satinTilePx: null,
  still: urlParams.get('still') === '1',
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches),
  playing: PLAY_PARAM !== false,
  flowElapsed: 0,
  watchdog: 0,
};

function motionAllowed() {
  return !state.still && !state.shot && !state.reducedMotion;
}

function playingNow() {
  return Boolean(motionAllowed() && state.playing && state.ready && !state.failed);
}

function modeName() {
  if (state.shot) return 'shot';
  if (state.still) return 'still';
  if (state.reducedMotion) return 'reduced';
  return 'auto';
}

/* -------------------------------------------------------------------- dom */

const dom = {};

function initDom() {
  const byId = (id) => document.getElementById(id);
  dom.body = document.body;
  dom.stage = byId('stage');
  dom.canvas = byId('stage-canvas');
  dom.veil = byId('stage-veil');
  dom.veilText = byId('veil-text');
  dom.flowToggle = byId('flow-toggle');
  dom.reset = byId('reset');
  dom.status = byId('studio-status');
  dom.specSatin = byId('spec-satin');
  dom.specFlowClearance = byId('spec-flow-clearance');
  dom.specFlowLength = byId('spec-flow-length');
  dom.specBlocks = byId('spec-blocks');
  dom.specCamera = byId('spec-camera');
  dom.specMaterials = byId('spec-materials');
  dom.fallback = byId('fallback');
  dom.fallbackMessage = byId('fallback-message');
  dom.curtain = byId('loading');
  dom.curtainTitle = byId('loading-title');
  dom.errorBanner = byId('error-banner');
  dom.errorText = byId('error-text');
  dom.liveStatus = byId('live-status');
  dom.diag = byId('qa-diag');
}

function announce(message) {
  if (dom.liveStatus) dom.liveStatus.textContent = message;
}

function setStatus(message) {
  if (dom.status) dom.status.textContent = message;
}

function satinLabel() {
  const model = state.model;
  const source = model && model.satin && model.satin.source ? model.satin.source : state.satinSource;
  if (source === 'columns') {
    const tile = Number(state.satinTilePx);
    return 'Columns satin · ' + (Number.isFinite(tile) && tile > 0 ? round(tile, 0) + ' px tile' : '1.3× UV');
  }
  if (source === 'fallback') return 'Numeric satin · fallback';
  return '—';
}

function syncUi() {
  const frozen = !motionAllowed();
  const playing = playingNow();
  if (dom.flowToggle) {
    dom.flowToggle.disabled = frozen || state.failed || !state.ready;
    dom.flowToggle.setAttribute('aria-pressed', String(playing));
    const label = dom.flowToggle.querySelector('span');
    if (label) label.textContent = playing ? 'ON' : 'OFF';
  }
  if (dom.status) {
    dom.status.textContent = state.failed
      ? 'Static preview'
      : !state.ready
        ? 'Preparing the studio'
        : state.shot
          ? 'Shot locked · deterministic frame'
          : state.still
            ? 'Still pose · drag to orbit'
            : state.reducedMotion
              ? 'Reduced motion · frozen conduit'
              : playing
                ? 'Flow on · drag to orbit'
                : 'Flow paused · drag to orbit';
  }
  if (dom.specSatin) dom.specSatin.textContent = satinLabel();
}

function syncModelFacts() {
  const model = state.model;
  if (!model) return;
  const flow = model.flow || null;
  const counts = model.counts || null;
  const clearance = flow && flow.clearance ? flow.clearance : null;
  if (dom.specFlowClearance) {
    dom.specFlowClearance.textContent = clearance && Number.isFinite(Number(clearance.min))
      ? round(Number(clearance.min), 1) + ' px min · ' + violationCount(clearance) + ' viol'
      : '—';
  }
  if (dom.specFlowLength) {
    const length = flow && Number.isFinite(Number(flow.curveLength)) ? Number(flow.curveLength) : NaN;
    dom.specFlowLength.textContent = Number.isFinite(length)
      ? Math.round(length).toLocaleString('en-US') + ' px · ' + FLOW_PERIOD.toFixed(1) + ' s'
      : '—';
  }
  if (dom.specBlocks) {
    const plates = counts && Number.isFinite(Number(counts.plates)) ? Number(counts.plates) : 2;
    const particles = counts && Number.isFinite(Number(counts.particles)) ? Number(counts.particles) : Number(FLOW.particleCount);
    dom.specBlocks.textContent = plates + ' plates · ' + particles + ' crystals';
  }
  if (dom.specCamera) {
    dom.specCamera.textContent = CAMERA.azimuthDeg + '° / ' + CAMERA.elevationDeg + '° · fov ' + CAMERA.fov + '°';
  }
  if (dom.specMaterials) {
    const keys = model.materials && typeof model.materials === 'object' ? Object.keys(model.materials).length : 0;
    dom.specMaterials.textContent = keys ? keys + ' materials · procedural rib' : '—';
  }
  if (dom.specSatin) dom.specSatin.textContent = satinLabel();
}

/** Publish body[data-qa-*] + the hidden JSON diagnostic mirror. */
function publishState() {
  if (!IS_BROWSER) return;
  const body = dom.body || document.body;
  if (!body) return;
  const studio = state.studio;
  const camera = studio ? studio.getCameraDebug() : null;
  const objectRect = studio ? studio.getObjectScreenRect() : null;
  const model = state.model;
  const clearance = model && model.flow && model.flow.clearance ? model.flow.clearance : null;
  const satinSource = model && model.satin && model.satin.source ? model.satin.source : (state.satinSource || '');
  body.dataset.qaReady = state.ready ? '1' : '0';
  body.dataset.qaErrors = String(qa.errors.length);
  body.dataset.qaWarnings = String(qa.warnings.length);
  body.dataset.qaWebgl = state.webgl ? '1' : '0';
  body.dataset.fallback = state.failed ? '1' : '0';
  body.dataset.qaFallback = state.failed ? '1' : '0';
  body.dataset.qaSatin = satinSource || 'none';
  body.dataset.qaMotion = modeName();
  body.dataset.qaPlaying = playingNow() ? '1' : '0';
  body.dataset.qaStill = state.still ? '1' : '0';
  body.dataset.qaShot = state.shot ? '1' : '0';
  body.dataset.qaReducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.qaCamera = camera ? round(camera.azimuthDeg, 1) + ',' + round(camera.elevationDeg, 1) : '';
  body.dataset.qaDistance = camera ? String(round(camera.distance, 1)) : '';
  body.dataset.qaFlowPhase = String(round(getFlowPhase(), 4));
  body.dataset.qaFlowClearance = clearance && Number.isFinite(Number(clearance.min)) ? String(round(Number(clearance.min), 2)) : '';
  body.dataset.qaFlowViolations = String(violationCount(clearance));
  body.dataset.qaObjectRect = objectRect
    ? [objectRect.left, objectRect.top, objectRect.width, objectRect.height].map((value) => String(round(value, 1))).join(',')
    : '';
  body.dataset.qaModel = MODEL_API.MODEL_VERSION;
  body.dataset.still = state.still ? '1' : '0';
  body.dataset.shot = state.shot ? '1' : '0';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.qaMode = state.qaMode ? '1' : '0';
  if (dom.diag) {
    try {
      dom.diag.textContent = JSON.stringify(buildDebug());
    } catch (error) {
      dom.diag.textContent = '{"error":"debug serialization failed"}';
    }
  }
}

/* ------------------------------------------------------------------ studio */

class ConnectionStudio {
  constructor({ renderer, canvas, stage, model, reducedMotion: reduced, still, shot }) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.stage = stage;
    this.model = model;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.room = null;
    this.ground = null;
    this.contactPlanes = [];
    this.stageBox = { width: 0, height: 0 };
    this.cameraTarget = new THREE.Vector3();
    this.cameraDistance = 0;
    this.fitPoints = null;
    this.renderCount = 0;
    this.firstFrameRendered = false;
    this.firstFrameResolve = null;
    this.needsRender = true;
    this.raf = 0;
    this.lastTime = 0;
    this.destroyed = false;
    this.reducedMotion = Boolean(reduced);
    this.still = Boolean(still);
    this.shot = Boolean(shot);
    this.resizeObserver = null;
    this.flowTime = 0;
    this.playing = false;
  }

  motionAllowed() {
    return !this.still && !this.shot && !this.reducedMotion;
  }

  async init() {
    const scene = new THREE.Scene();
    scene.name = 'connection-studio';
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.5, CAMERA.near, CAMERA.far);
    camera.name = 'connection-camera';
    camera.up.set(0, 1, 0);
    this.camera = camera;

    this.buildGround();
    this.buildContactDarkening();

    scene.add(this.model.group);
    this.collectFitPoints();

    // Rev21: the room photograph is the page's ONLY light source. It is applied
    // once the scene exists and after the model is in the graph, then refreshed
    // so the r151 per-material envMapIntensity pass reaches every material.
    this.room = await applyEnvRoom(THREE, this.renderer, scene, { intensity: ENV_ROOM.intensity });
    this.room.refresh(scene);

    const controls = new OrbitControls(camera, this.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.55;
    controls.minPolarAngle = 12 * DEG;
    controls.maxPolarAngle = 82 * DEG;
    controls.addEventListener('change', () => this.requestRender());
    controls.enabled = !this.shot;
    this.controls = controls;

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

  /** Faint near-black reflective disc with a radial alpha fade; no visible plane edge. */
  buildGround() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
    gradient.addColorStop(0.34, 'rgba(150, 150, 150, 0.42)');
    gradient.addColorStop(0.68, 'rgba(60, 60, 60, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const alpha = new THREE.CanvasTexture(canvas);
    alpha.name = 'connection-ground-fade';
    alpha.anisotropy = 4;
    const material = new THREE.MeshStandardMaterial({
      color: GROUND.color,
      metalness: GROUND.metalness,
      roughness: GROUND.roughness,
      transparent: true,
      opacity: GROUND.opacity,
      alphaMap: alpha,
      envMapIntensity: GROUND.envMapIntensity,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(GROUND.radius, 96), material);
    mesh.name = 'studio-ground';
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = GROUND.y;
    mesh.renderOrder = -2;
    this.scene.add(mesh);
    this.ground = mesh;
  }

  /** Soft procedural darkening under each satin column (no shadow map). */
  buildContactDarkening() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.66)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.38)');
    gradient.addColorStop(0.74, 'rgba(0, 0, 0, 0.11)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'connection-contact-darkening';
    texture.anisotropy = 4;
    const specs = MODEL_API.SATIN_COLUMN_SPECS;
    for (const spec of specs) {
      const position = Array.isArray(spec.position) ? spec.position : [0, 0, 0];
      const footprint = Math.max(Number(spec.width) || 100, Number(spec.depth) || 100);
      const planeSize = footprint * CONTACT.scale;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        opacity: CONTACT.opacity,
      });
      material.map = texture;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), material);
      mesh.name = 'contact-darkening:' + (spec.id || 'column');
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(position[0], CONTACT.y, position[2]);
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.contactPlanes.push(mesh);
    }
  }

  /**
   * Per-mesh bounding-box corners restricted to the model's core `fitBounds`
   * (plates + columns): a tighter, on-target fit than the whole-group AABB, and
   * it lets the thin rod bundles run off-frame like the reference. Falls back to
   * the total `bounds` when the model does not publish fitBounds.
   */
  collectFitPoints() {
    const points = [];
    const group = this.model && this.model.group ? this.model.group : null;
    const fitBounds = this.model && this.model.fitBounds ? this.model.fitBounds : null;
    const guard = fitBounds
      ? {
          min: { x: fitBounds.min.x - 2, y: fitBounds.min.y - 2, z: fitBounds.min.z - 2 },
          max: { x: fitBounds.max.x + 2, y: fitBounds.max.y + 2, z: fitBounds.max.z + 2 },
        }
      : null;
    if (group) {
      group.updateMatrixWorld(true);
      const corner = new THREE.Vector3();
      group.traverse((object) => {
        if (!object.isMesh || object.isInstancedMesh) return;
        const geometry = object.geometry;
        if (!geometry) return;
        if (!geometry.boundingBox) {
          if (typeof geometry.computeBoundingBox !== 'function') return;
          geometry.computeBoundingBox();
        }
        const box = geometry.boundingBox;
        if (!box) return;
        const corners = [];
        for (let index = 0; index < 8; index += 1) {
          corner.set(
            index & 1 ? box.max.x : box.min.x,
            index & 2 ? box.max.y : box.min.y,
            index & 4 ? box.max.z : box.min.z,
          );
          corner.applyMatrix4(object.matrixWorld);
          corners.push([corner.x, corner.y, corner.z]);
        }
        if (guard) {
          const outside = corners.some(([x, y, z]) => (
            x < guard.min.x || x > guard.max.x ||
            y < guard.min.y || y > guard.max.y ||
            z < guard.min.z || z > guard.max.z
          ));
          if (outside) return;
        }
        for (const [x, y, z] of corners) points.push(x, y, z);
      });
    }
    if (!points.length && fitBounds) {
      for (const x of [fitBounds.min.x, fitBounds.max.x]) {
        for (const y of [fitBounds.min.y, fitBounds.max.y]) {
          for (const z of [fitBounds.min.z, fitBounds.max.z]) points.push(x, y, z);
        }
      }
    }
    if (!points.length && this.model && this.model.bounds) {
      const bounds = this.model.bounds;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) points.push(x, y, z);
        }
      }
    }
    this.fitPoints = new Float32Array(points);
    return this.fitPoints;
  }

  viewBasis() {
    const az = CAMERA.azimuthDeg * DEG;
    const el = CAMERA.elevationDeg * DEG;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const rolledUp = new THREE.Vector3(0, 1, 0);
    rolledUp.addScaledVector(dir, -rolledUp.dot(dir)).normalize();
    if (CAMERA.rollDeg) rolledUp.applyAxisAngle(dir, CAMERA.rollDeg * DEG);
    const right = new THREE.Vector3().crossVectors(rolledUp, dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    return { dir, rolledUp, right, up, forward: dir.clone().negate() };
  }

  solveFitDistance(target, basis, maxX, maxY, points) {
    let distance = 0.01;
    for (let index = 0; index < points.length; index += 3) {
      const rx = points[index] - target.x;
      const ry = points[index + 1] - target.y;
      const rz = points[index + 2] - target.z;
      const xv = rx * basis.right.x + ry * basis.right.y + rz * basis.right.z;
      const yv = rx * basis.up.x + ry * basis.up.y + rz * basis.up.z;
      const c = rx * basis.forward.x + ry * basis.forward.y + rz * basis.forward.z;
      distance = Math.max(distance, Math.abs(xv) / maxX - c, Math.abs(yv) / maxY - c, CAMERA.near + 1 - c);
    }
    return distance;
  }

  fitCamera() {
    if (!this.camera) return;
    const points = this.fitPoints;
    if (!points || !points.length) return;
    const basis = this.viewBasis();
    const aspect = (this.stageBox.width || 1) / (this.stageBox.height || 1);
    const tanHalf = Math.tan(CAMERA.fov * DEG / 2);
    const fitPadding = Number(CAMERA.fitPadding) > 0 ? Number(CAMERA.fitPadding) : 1.08;
    const maxX = tanHalf * aspect / fitPadding;
    const maxY = tanHalf / fitPadding;
    const target = new THREE.Vector3(
      CAMERA.target[0] || 0,
      Number.isFinite(CAMERA.target[1]) ? CAMERA.target[1] : 584,
      CAMERA.target[2] || 0,
    );
    // The view direction is fixed, so only the distance and a small target
    // offset have to be solved: centre the projected silhouette, then fit.
    const probe = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
    probe.up.copy(basis.rolledUp);
    const projected = new THREE.Vector3();
    let distance = this.solveFitDistance(target, basis, maxX, maxY, points);
    for (let iteration = 0; iteration < 5; iteration += 1) {
      distance = this.solveFitDistance(target, basis, maxX, maxY, points);
      probe.position.copy(target).addScaledVector(basis.dir, distance);
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
      if (Math.abs(centerX) < 0.001 && Math.abs(centerY) < 0.001) break;
      target.addScaledVector(basis.up, centerY * distance * tanHalf);
      target.addScaledVector(basis.right, centerX * distance * tanHalf * aspect);
    }
    distance = clamp(this.solveFitDistance(target, basis, maxX, maxY, points), CAMERA.near * 2, CAMERA.far * 0.7);
    this.cameraDistance = distance;
    this.cameraTarget.copy(target);
    this.camera.aspect = aspect;
    this.camera.up.copy(basis.rolledUp);
    this.camera.position.copy(target).addScaledVector(basis.dir, distance);
    this.camera.lookAt(target);
    this.camera.near = CAMERA.near;
    this.camera.far = CAMERA.far;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.minDistance = distance * 0.55;
      this.controls.maxDistance = distance * 1.75;
      const basePolar = Math.acos(clamp(basis.dir.y, -1, 1));
      this.controls.minPolarAngle = Math.max(0.18, basePolar - 0.4);
      this.controls.maxPolarAngle = Math.min(Math.PI - 0.2, basePolar + 0.48);
      const baseAzimuth = Math.atan2(basis.dir.x, basis.dir.z);
      this.controls.minAzimuthAngle = baseAzimuth - 0.7;
      this.controls.maxAzimuthAngle = baseAzimuth + 0.7;
      this.controls.update();
    }
    this.needsRender = true;
  }

  resize() {
    if (this.destroyed || !this.renderer) return;
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.stageBox.width && height === this.stageBox.height) return;
    this.stageBox = { width, height };
    this.renderer.setSize(width, height, false);
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.fitCamera();
    this.needsRender = true;
    if (this.shot) this.renderFrame();
  }

  resetView() {
    this.fitCamera();
    this.requestRender();
    return true;
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
      const resolve = this.firstFrameResolve;
      this.firstFrameResolve = null;
      if (resolve) resolve(true);
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

  /** Advance the model's flow to the absolute flow clock. */
  applyFlowTime(seconds) {
    const model = this.model;
    if (!model) return;
    this.flowTime = seconds;
    if (typeof model.update === 'function') model.update(seconds);
    this.needsRender = true;
  }

  /** Deterministic still pose at the contract's stillPhase. */
  applyStillPose() {
    const model = this.model;
    if (!model) return;
    this.flowTime = STILL_PHASE * FLOW_PERIOD;
    if (typeof model.setPhase === 'function') model.setPhase(STILL_PHASE);
    else if (typeof model.update === 'function') model.update(this.flowTime);
    this.needsRender = true;
  }

  setPlaying(on) {
    this.playing = Boolean(on) && this.motionAllowed();
    return this.playing;
  }

  loop(now) {
    if (this.destroyed) return;
    this.raf = window.requestAnimationFrame(this.loop);
    const previous = this.lastTime || now;
    const dtMs = Math.min(64, Math.max(0, now - previous));
    this.lastTime = now;
    if (this.playing && this.motionAllowed()) {
      this.flowTime += dtMs / 1000;
      if (typeof this.model.update === 'function') this.model.update(this.flowTime);
      this.needsRender = true;
    }
    if (this.controls && this.controls.enabled) {
      const changed = this.controls.update();
      if (changed) this.needsRender = true;
    }
    if (this.needsRender) this.renderFrame();
  }

  getCameraDebug() {
    if (!this.camera) return null;
    const direction = new THREE.Vector3().subVectors(this.camera.position, this.cameraTarget).normalize();
    return {
      azimuthDeg: round(Math.atan2(direction.x, direction.z) / DEG, 2),
      elevationDeg: round(Math.asin(clamp(direction.y, -1, 1)) / DEG, 2),
      rollDeg: CAMERA.rollDeg,
      distance: round(this.camera.position.distanceTo(this.cameraTarget), 1),
      fov: CAMERA.fov,
      near: CAMERA.near,
      far: CAMERA.far,
      aspect: round(this.camera.aspect, 4),
      position: [round(this.camera.position.x, 1), round(this.camera.position.y, 1), round(this.camera.position.z, 1)],
      target: [round(this.cameraTarget.x, 1), round(this.cameraTarget.y, 1), round(this.cameraTarget.z, 1)],
      fitPadding: CAMERA.fitPadding,
      narrowStage: (this.stageBox.width || 0) < 640,
      controlsEnabled: Boolean(this.controls && this.controls.enabled),
      controlsTarget: [
        round(this.controls ? this.controls.target.x : 0, 1),
        round(this.controls ? this.controls.target.y : 0, 1),
        round(this.controls ? this.controls.target.z : 0, 1),
      ],
    };
  }

  getObjectScreenRect() {
    if (!this.camera || !this.fitPoints || !this.fitPoints.length) return null;
    const width = this.stageBox.width || 1;
    const height = this.stageBox.height || 1;
    const points = this.fitPoints;
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
      left: round(minX, 1),
      top: round(minY, 1),
      right: round(maxX, 1),
      bottom: round(maxY, 1),
      width: round(maxX - minX, 1),
      height: round(maxY - minY, 1),
      stageWidth: round(width, 1),
      stageHeight: round(height, 1),
      overflowLeft: round(Math.max(0, -minX), 1),
      overflowTop: round(Math.max(0, -minY), 1),
      overflowRight: round(Math.max(0, maxX - width), 1),
      overflowBottom: round(Math.max(0, maxY - height), 1),
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
      toneMappingExposure: RENDERER.exposure,
      outputEncoding: 'sRGB',
      toneMapping: 'ACESFilmic',
      // Rev21: image-based lighting only — zero THREE light objects; the scene
      // is lit by the PMREM of the shared room photograph.
      environmentIntensity: ENV_ROOM.intensity,
      environment: ENV_ROOM.label,
      lights: { directional: 0, point: 0, spot: 0, ambient: 0, hemisphere: 0, rectArea: 0 },
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
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
    for (const plane of this.contactPlanes) {
      if (this.scene) this.scene.remove(plane);
      plane.geometry.dispose();
      if (plane.material.map) plane.material.map.dispose();
      plane.material.dispose();
    }
    this.contactPlanes = [];
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      if (this.ground.material.alphaMap) this.ground.material.alphaMap.dispose();
      this.ground.material.dispose();
      this.ground = null;
    }
    if (this.room) {
      this.room.dispose();
      this.room = null;
    }
    if (this.scene) {
      this.scene.remove(this.model.group);
      this.scene.environment = null;
    }
    if (this.model && typeof this.model.dispose === 'function') this.model.dispose();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
  }
}

/* --------------------------------------------------------------- studio glue */

let renderer = null;

function probeWebGL() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (!gl) return null;
    const version = gl.getParameter(gl.VERSION) || 'WebGL';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return version;
  } catch (error) {
    return null;
  }
}

function createRenderer() {
  try {
    const instance = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    instance.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDERER.dprMax));
    instance.outputEncoding = THREE.sRGBEncoding;
    instance.toneMapping = THREE.ACESFilmicToneMapping;
    instance.toneMappingExposure = RENDERER.exposure;
    instance.shadowMap.enabled = false;
    instance.setClearColor(0x000000, 0);
    return instance;
  } catch (error) {
    pushError(errorMessage(error));
    return null;
  }
}

function nextPaint() {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

/* ----------------------------------------------------------------- fallback */

function showFallback(message, { error = null, banner = false } = {}) {
  state.failed = true;
  state.ready = false;
  state.booting = false;
  api.ready = false;
  if (error) pushError(errorMessage(error));
  if (dom.fallback) dom.fallback.hidden = false;
  if (dom.fallbackMessage) dom.fallbackMessage.textContent = message;
  if (dom.body) dom.body.dataset.fallback = '1';
  if (dom.curtain) dom.curtain.hidden = true;
  if (dom.veil) dom.veil.hidden = true;
  if (banner && dom.errorBanner) {
    if (dom.errorText) dom.errorText.textContent = message;
    dom.errorBanner.hidden = false;
  }
  syncUi();
  publishState();
  announce('Static preview: ' + message);
}

/* ------------------------------------------------------------------- api */

const api = {
  version: VERSION,
  ready: false,
  errors: qa.errors,
  warnings: qa.warnings,
  isReady() {
    return Boolean(state.ready);
  },
  resetView() {
    if (!state.studio || state.failed) return false;
    state.studio.resetView();
    announce('View reset');
    return true;
  },
  setPlaying(on) {
    const want = Boolean(on);
    if (!state.studio || state.failed) return false;
    if (!motionAllowed()) {
      state.playing = false;
      syncUi();
      publishState();
      return false;
    }
    state.playing = want;
    state.studio.setPlaying(want);
    syncUi();
    publishState();
    announce(want ? 'Flow playing' : 'Flow paused');
    return want;
  },
  getPlaying() {
    return playingNow();
  },
  setFlowPhase(phase01) {
    if (!state.model || state.failed) return false;
    const phase = clampPhase(Number(phase01));
    if (typeof state.model.setPhase === 'function') state.model.setPhase(phase);
    state.flowElapsed = phase * FLOW_PERIOD;
    if (state.studio) {
      state.studio.flowTime = state.flowElapsed;
      state.studio.requestRender();
      if (motionAllowed() && state.playing) state.studio.setPlaying(true);
      else state.studio.renderNow();
    }
    publishState();
    return true;
  },
  getFlowPhase() {
    return getFlowPhase();
  },
  getMode() {
    return {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      reducedMotion: Boolean(state.reducedMotion),
      playing: playingNow(),
    };
  },
  debug() {
    return buildDebug();
  },
  waitForReady() {
    return readyPromise;
  },
};
if (IS_BROWSER) window.__tekoConnection = api;

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

function getFlowPhase() {
  const model = state.model;
  if (model && typeof model.getPhase === 'function') {
    const phase = Number(model.getPhase());
    if (Number.isFinite(phase)) return clampPhase(phase);
  }
  return clampPhase(state.flowElapsed / FLOW_PERIOD);
}

function buildDebug() {
  const studio = state.studio;
  const model = state.model;
  const flow = model && model.flow ? model.flow : null;
  const clearance = flow && flow.clearance ? flow.clearance : null;
  const counts = model && model.counts ? model.counts : null;
  const satinSource = model && model.satin && model.satin.source ? model.satin.source : (state.satinSource || null);
  const debug = {
    version: VERSION,
    ready: Boolean(state.ready),
    errors: qa.errors.slice(),
    warnings: qa.warnings.slice(),
    webgl: { supported: Boolean(state.webgl), version: state.webgl || '' },
    mode: {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      reducedMotion: Boolean(state.reducedMotion),
      playing: playingNow(),
      name: modeName(),
    },
    modelVersion: MODEL_API.MODEL_VERSION,
    satin: {
      source: satinSource,
      tilePx: state.satinTilePx,
      label: satinLabel(),
      bank: Boolean(state.bank),
    },
    counts: counts || null,
    flow: {
      phase: round(getFlowPhase(), 4),
      period: FLOW_PERIOD,
      stillPhase: STILL_PHASE,
      length: flow && Number.isFinite(Number(flow.curveLength)) ? round(Number(flow.curveLength), 1) : null,
      radius: flow && Number.isFinite(Number(flow.radius)) ? Number(flow.radius) : Number(FLOW.radius),
      particles: counts && Number.isFinite(Number(counts.particles)) ? Number(counts.particles) : Number(FLOW.particleCount),
      clearance: clearance
        ? {
            min: Number.isFinite(Number(clearance.min)) ? round(Number(clearance.min), 3) : null,
            // numeric count (QA gate) + the raw samples for inspection
            violations: violationCount(clearance),
            violationSamples: Array.isArray(clearance.violations) ? clearance.violations.slice(0, 12) : [],
            samples: Number.isFinite(Number(clearance.samples)) ? Number(clearance.samples) : null,
            solids: Array.isArray(clearance.solids)
              ? clearance.solids.map((solid) => ({
                  id: solid && solid.id,
                  kind: solid && solid.kind,
                  minClearance: solid && Number.isFinite(Number(solid.minClearance)) ? round(Number(solid.minClearance), 2) : null,
                }))
              : [],
          }
        : null,
    },
    bounds: model && model.bounds ? model.bounds : null,
    camera: studio ? studio.getCameraDebug() : null,
    renderer: studio ? studio.getRenderDebug() : null,
    objectRect: studio ? studio.getObjectScreenRect() : null,
    page: {
      url: IS_BROWSER ? window.location.href : '',
      viewport: IS_BROWSER
        ? { width: window.innerWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth }
        : null,
      stageRect: studio ? { width: studio.stageBox.width, height: studio.stageBox.height } : null,
      flowParam: PLAY_PARAM === null ? 'auto' : PLAY_PARAM ? '1' : '0',
    },
  };
  if (IS_BROWSER) {
    try {
      const rect = dom.stage ? dom.stage.getBoundingClientRect() : null;
      if (rect) debug.stageRect = { x: round(rect.x, 1), y: round(rect.y, 1), width: round(rect.width, 1), height: round(rect.height, 1) };
    } catch (error) {
      debug.stageRect = null;
    }
  }
  return debug;
}

/* --------------------------------------------------------------------- boot */

async function boot() {
  const started = performance.now();
  if (dom.body) {
    dom.body.dataset.fallback = '0';
    dom.body.dataset.qaReady = '0';
    if (state.still) dom.body.dataset.still = '1';
    if (state.shot) dom.body.dataset.shot = '1';
    if (state.reducedMotion) dom.body.dataset.reducedMotion = '1';
  }
  syncUi();
  publishState();

  const glVersion = probeWebGL();
  state.webgl = glVersion;
  qa.webgl = glVersion;
  if (!glVersion) {
    showFallback(MSG.webgl);
    resolveReady(false);
    return;
  }
  if (dom.veilText) dom.veilText.textContent = 'Waking the renderer';

  renderer = createRenderer();
  if (!renderer) {
    showFallback(MSG.renderer);
    resolveReady(false);
    return;
  }

  const contextLost = (event) => {
    event.preventDefault();
    showFallback(MSG.contextLost);
    resolveReady(false);
  };
  dom.canvas.addEventListener('webglcontextlost', contextLost, false);

  // Let the loading veil paint before the satin textures + model build block.
  await nextPaint();
  if (dom.veilText) dom.veilText.textContent = 'Loading the satin material bank';

  let bank = null;
  try {
    bank = await loadColumnBank({
      onProgress: (loaded, total) => {
        if (dom.veilText) dom.veilText.textContent = 'Loading satin bank ' + loaded + ' / ' + total;
      },
    });
  } catch (error) {
    // The columns bank is an enhancement: a missing bank degrades the satin
    // material to the numeric fallback, it must never fail the page.
    pushWarning('satin bank unavailable (' + errorMessage(error) + ') — numeric satin fallback');
  }
  state.bank = bank;

  let satinMaterial = null;
  if (bank && MODEL_API.createSatinMaterial) {
    try {
      satinMaterial = MODEL_API.createSatinMaterial(bank);
      state.satinSource = 'columns';
      const tile = bank.tilePx && Number(bank.tilePx.satin);
      state.satinTilePx = Number.isFinite(tile) && tile > 0 ? tile : null;
    } catch (error) {
      pushWarning('createSatinMaterial failed (' + errorMessage(error) + ') — numeric satin fallback');
      satinMaterial = null;
    }
  }
  if (!satinMaterial) {
    state.satinSource = 'fallback';
    state.satinTilePx = null;
    if (MODEL_API.createFallbackSatinMaterial) {
      try {
        satinMaterial = MODEL_API.createFallbackSatinMaterial();
      } catch (error) {
        pushWarning('numeric satin fallback failed (' + errorMessage(error) + ')');
        satinMaterial = null;
      }
    }
  }
  if (dom.veilText) dom.veilText.textContent = 'Forming the interlocked crystal';

  if (!MODEL_API.createConnectionModel) {
    showFallback(MSG.model + ' (connection-model.js did not expose createConnectionModel).', { banner: true });
    resolveReady(false);
    return;
  }

  let model = null;
  try {
    model = MODEL_API.createConnectionModel({
      satinMaterial,
      satinTilePx: state.satinTilePx,
    });
  } catch (error) {
    showFallback(MSG.model + ' (' + errorMessage(error) + ')', { error, banner: true });
    resolveReady(false);
    return;
  }
  if (!model || !model.group) {
    showFallback(MSG.model + ' (no model group returned).', { banner: true });
    resolveReady(false);
    return;
  }
  state.model = model;
  if (model.satin && model.satin.source) state.satinSource = model.satin.source;

  // Deterministic initial pose: autoplay starts at phase 0, everything else at
  // the contract stillPhase.
  try {
    if (motionAllowed() && PLAY_PARAM !== false) {
      if (typeof model.update === 'function') model.update(0);
    } else if (typeof model.setPhase === 'function') {
      model.setPhase(STILL_PHASE);
      state.flowElapsed = STILL_PHASE * FLOW_PERIOD;
    }
  } catch (error) {
    pushWarning('initial flow pose failed (' + errorMessage(error) + ')');
  }

  try {
    state.studio = new ConnectionStudio({
      renderer,
      canvas: dom.canvas,
      stage: dom.stage,
      model,
      reducedMotion: state.reducedMotion,
      still: state.still,
      shot: state.shot,
    });
    // `init()` awaits the shared room PMREM, so the page cannot report ready
    // before its only light source exists.
    await state.studio.init();
    state.studio.setPlaying(motionAllowed() && state.playing);
  } catch (error) {
    if (state.studio) {
      try {
        state.studio.dispose();
      } catch (disposeError) {
        /* best effort */
      }
      state.studio = null;
    }
    showFallback(MSG.studio + ' (' + errorMessage(error) + ')', { error, banner: true });
    resolveReady(false);
    return;
  }

  const studio = state.studio;
  studio.fitCamera();
  studio.renderNow();
  await studio.whenFirstFrame();
  studio.renderNow();

  if (!motionAllowed()) {
    studio.playing = false;
    studio.applyStillPose();
    studio.fitCamera();
    studio.renderNow();
  }
  syncModelFacts();
  state.ready = true;
  state.booting = false;
  api.ready = true;
  window.clearTimeout(state.watchdog);
  if (dom.curtain) {
    if (!motionAllowed() || state.qaMode) {
      dom.curtain.hidden = true;
    } else {
      dom.curtain.classList.add('is-hidden');
      window.setTimeout(() => {
        if (dom.curtain) dom.curtain.hidden = true;
      }, 380);
    }
  }
  if (dom.veil) dom.veil.hidden = true;
  if (dom.body) dom.body.dataset.qaReady = '1';
  syncUi();
  publishState();
  announce('Connection crystal ready');
  // A late layout pass (font swap / scrollbar) must not leave a stale frame.
  window.setTimeout(() => {
    if (!state.studio || state.failed) return;
    state.studio.resize();
    state.studio.renderNow();
    publishState();
  }, 240);
  resolveReady(true);
  studio.bootMs = Math.round(performance.now() - started);
}

/* --------------------------------------------------------------------- ui */

function toggleFlow() {
  api.setPlaying(!playingNow());
}

function wireUi() {
  if (dom.flowToggle) {
    dom.flowToggle.addEventListener('click', () => toggleFlow());
  }
  if (dom.reset) {
    dom.reset.addEventListener('click', () => api.resetView());
  }
  if (dom.canvas) {
    dom.canvas.addEventListener('dblclick', () => api.resetView());
  }
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (event.code === 'Space' || event.key === ' ') {
      if (target && target.tagName === 'BUTTON') return;
      event.preventDefault();
      toggleFlow();
      return;
    }
    if (event.key === 'r' || event.key === 'R') api.resetView();
  });
  if (reducedMotionQuery) {
    const onChange = (event) => {
      state.reducedMotion = Boolean(event.matches);
      if (state.studio) state.studio.reducedMotion = state.reducedMotion;
      if (state.model && typeof state.model.setPhase === 'function') {
        state.model.setPhase(STILL_PHASE);
        state.flowElapsed = STILL_PHASE * FLOW_PERIOD;
      }
      if (state.studio) {
        state.studio.flowTime = STILL_PHASE * FLOW_PERIOD;
        state.studio.playing = playingNow();
        state.studio.requestRender();
        state.studio.renderNow();
      }
      syncUi();
      publishState();
    };
    if (typeof reducedMotionQuery.addEventListener === 'function') reducedMotionQuery.addEventListener('change', onChange);
    else if (typeof reducedMotionQuery.addListener === 'function') reducedMotionQuery.addListener(onChange);
  }
}

/* ------------------------------------------------------------------- main */

function main() {
  initDom();
  wireUi();
  syncUi();
  publishState();
  boot().catch((error) => {
    if (!state.failed) {
      showFallback('The connection-crystal preview failed to start (' + errorMessage(error) + '). A static poster is shown.', { error, banner: true });
    }
    resolveReady(false);
  });
  state.watchdog = window.setTimeout(() => {
    if (!state.ready && !state.failed) {
      showFallback(MSG.watchdog, { banner: true });
      resolveReady(false);
    }
  }, 24000);
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
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    if (state.bank && typeof state.bank.dispose === 'function') {
      try {
        state.bank.dispose();
      } catch (error) {
        /* best effort */
      }
    }
    state.model = null;
  });
}

window.addEventListener('error', (event) => {
  pushError(event.message || 'unknown error');
  if (dom.body) dom.body.dataset.qaErrors = String(qa.errors.length);
});
window.addEventListener('unhandledrejection', (event) => {
  pushError(event.reason && event.reason.message ? event.reason.message : String(event.reason));
  if (dom.body) dom.body.dataset.qaErrors = String(qa.errors.length);
});

if (IS_BROWSER) main();

export { VERSION, ConnectionStudio };
