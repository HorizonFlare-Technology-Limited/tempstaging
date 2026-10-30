/**
 * tekoanimation — Vault preview controller.
 *
 * Standalone collection page controller for `vault.html` (docs/vault.md,
 * revision 17): a dark product studio showing a ribbed steel safe/vault whose
 * chamfered door swings from CLOSED to OPEN while 24 thin steel-blue bars
 * reveal themselves. All bars have the same length; only their vertical
 * position changes. 12 bars stand in front of the safe on the left and climb a
 * helix (one full turn) up from its left edge (+z); 12 stand behind it on the
 * right and rise from its right edge (-z). The reveal is ordered bottom-most
 * bar first; each next bar slides forward (+z) and fades in, finishing as the
 * door reaches fully open. Rev21: no floor reflection (env lighting only); the
 * floor is a dark fade plane + contact shadow under the vault + bars.
 *
 * Camera: fixed three-quarter view, numerically fitted to the union of the
 * initial and final poses (closed safe, opening/full door, revealed bars) at
 * every stage aspect (1440x900 / 1200x900 / 390x844) so nothing clips.
 *
 * Animation: plays ONCE when the stage enters the viewport (IO threshold 0.35).
 * Replay button / Space / window.__tekoVault.play() / replay() re-run it.
 * Reduced motion, ?still=1 and ?shot=1 show the final OPEN-DOOR + ALL-BARS-
 * VISIBLE frame deterministically; ?play=0 shows the initial closed/no-bars
 * state; ?t=<ms> freezes an exact deterministic animation time.
 *
 * QA hook: window.__tekoVault = { ready, errors, warnings, play(), replay(),
 * seek(ms), debug(), meshes(), waitForIdle(), readyPromise() } plus
 * body[data-qa-*] attributes and the hidden #qa-diag JSON mirror.
 */
import * as THREE from 'three';
import { applyEnvRoom, ENV_ROOM } from './env-room.js';
import * as VaultModel from './vault-model.js';
import { TRACKBALL, arcballDelta, quatMultiply, quatNormalize, quatSlerp, quatAngle } from './trackball.js';

const VERSION = '3.0.0';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ------------------------------------------------------------------ spec */

const MODEL = VaultModel;
const CAMERA = MODEL.CAMERA_SPEC;
const BAR_COUNT = MODEL.BAR_SPEC.count;

const RENDERER = Object.freeze({ exposure: 1.22, dprMax: 2 });
// Rev21: the ONLY light source is the shared room photograph
// (assets/env/modern-empty-room.jpg). `src/env-room.js` filters it once into a
// PMREM and assigns `scene.environment`; `intensity` multiplies every material's
// own authored envMapIntensity (r151 path) so the dark interior photo still reads
// as a lit product studio. No THREE light objects and no procedural env studio.
const ENVIRONMENT = Object.freeze({ intensity: 4.2 });
const ENVIRONMENT_LABEL = ENV_ROOM.url + ' (PMREM, env-room)';
const FLOOR = Object.freeze({
  fadeRadius: 26,
  fadeOpacity: 0.72,
  shadowWidth: 4.2,
  shadowDepth: 3.0,
  shadowOpacity: 0.82,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
const degToRad = (deg) => (deg * Math.PI) / 180;
const radToDeg = (rad) => (rad * 180) / Math.PI;
const round = (value, digits = 2) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};
const easeInOutCubic = MODEL.easeInOutCubic;

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
  ? (window.__TEKO_VAULT_QA = window.__TEKO_VAULT_QA || { errors: [], warnings: [], webgl: null })
  : { errors: [], warnings: [], webgl: null };
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];

function pushError(message) {
  qa.errors.push('vault-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}
function pushWarning(message) {
  qa.warnings.push('vault-preview: ' + message);
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
  still: urlParams.get('still') === '1',
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  playParam: urlParams.get('play'),
  timeParam: urlParams.get('t'),
  viewParam: urlParams.get('view'),
  reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches),
  autoplay: false,
  viewObserver: null,
  watchdog: 0,
};

function isStaticMode() {
  return state.still || state.shot || state.reducedMotion;
}

/** ?t=<ms> freezes the exact animation time (deterministic QA sampling). */
function fixedTimeMs() {
  if (state.timeParam === null || state.timeParam === '') return null;
  const value = Number(state.timeParam);
  if (!Number.isFinite(value)) return null;
  return clamp(value, 0, MODEL.ANIMATION_SPEC.totalMs);
}

/**
 * ?view=<deg> — deterministic rig yaw for captures/QA (`?shot=1&view=38` shows
 * the drag-rotated orientation without simulating a pointer gesture).
 */
function fixedViewYaw() {
  if (state.viewParam === null || state.viewParam === '') return null;
  const value = Number(state.viewParam);
  if (!Number.isFinite(value)) return null;
  return clamp(value, -180, 180);
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
  dom.stage = byId('stage');
  dom.canvas = byId('stage-canvas');
  dom.stageEyebrow = byId('stage-eyebrow-text');
  dom.stageIndex = byId('stage-index');
  dom.stageCode = byId('stage-code');
  dom.stageName = byId('stage-name');
  dom.stageDetail = byId('stage-detail');
  dom.stageHint = byId('stage-hint');
  dom.btnReplay = byId('btn-replay');
  dom.btnResetView = byId('btn-reset-view');
  dom.replayState = byId('replay-state');
  dom.infoFootState = byId('info-foot-state');
  dom.footerStatus = byId('footer-status');
  dom.fallback = byId('fallback');
  dom.fallbackMessage = byId('fallback-message');
  dom.errorBanner = byId('error-banner');
  dom.errorText = byId('error-text');
  dom.curtain = byId('loading');
  dom.loadingBar = byId('loading-bar');
  dom.loadingLabel = byId('loading-label');
  dom.loadingCount = byId('loading-count');
  dom.loadingTitle = byId('loading-title');
  dom.liveStatus = byId('live-status');
  dom.diag = byId('qa-diag');
}

function syncUi() {
  const studio = state.studio;
  const final = studio ? studio.final : false;
  const playing = Boolean(studio && studio.animation.playing);
  const phase = studio ? studio.animation.phase : 'intro';
  const opening = !state.failed && (playing || phase === 'opening' || phase === 'revealing');
  const label = final ? 'Open' : opening ? 'Opening' : 'Closed';
  if (dom.replayState) {
    dom.replayState.textContent = state.failed ? 'Static preview' : label;
  }
  if (dom.infoFootState) {
    dom.infoFootState.textContent = state.failed ? 'Static fallback' : state.ready ? label : 'Loading';
  }
  if (dom.footerStatus) {
    dom.footerStatus.textContent = state.failed ? 'Static fallback' : state.ready ? 'Ready' : 'Loading';
  }
  if (dom.btnReplay) dom.btnReplay.disabled = !state.ready || state.failed;
  if (dom.btnResetView) {
    dom.btnResetView.disabled = !state.ready || state.failed || !(studio && studio.motionAllowed());
  }
  if (dom.stageHint) {
    const visible = studio && typeof studio.getBarDebug === 'function' ? studio.getBarDebug().visibleCount : 0;
    dom.stageHint.textContent = state.failed
      ? 'Static preview'
      : playing ? 'Door opening · bars revealing'
        : final ? 'All bars visible · replay to open again'
          : opening ? 'Opening · ' + visible + ' of ' + BAR_COUNT + ' bars'
            : 'Door closed · waiting to open';
  }
}

function objectsDebugCount(studio) {
  if (!studio || !studio.model) return 0;
  let count = 0;
  studio.model.root.traverse((object) => {
    if (object.isMesh) count += 1;
  });
  return count;
}

function publishState() {
  if (!dom.body) return;
  const studio = state.studio;
  const animation = studio ? studio.getAnimationDebug() : null;
  const safety = studio ? studio.getSafetyDebug() : null;
  const bars = studio ? studio.getBarDebug() : null;
  const camera = studio ? studio.getCameraDebug() : null;
  const objectRect = studio ? studio.getObjectScreenRect() : null;
  const final = Boolean(studio && studio.final);

  dom.body.dataset.qaReady = state.ready ? '1' : '0';
  dom.body.dataset.qaErrors = String(qa.errors.length);
  dom.body.dataset.qaWarnings = String(qa.warnings.length);
  dom.body.dataset.qaWebgl = state.webgl ? '1' : '0';
  dom.body.dataset.qaFallback = state.failed ? '1' : '0';
  dom.body.dataset.fallback = state.failed ? '1' : '0';
  dom.body.dataset.qaAnimation = state.failed ? 'fallback'
    : animation && animation.playing ? 'playing'
      : final ? 'open'
        : animation && (animation.phase === 'opening' || animation.phase === 'revealing') ? 'opening' : 'closed';
  dom.body.dataset.qaSafeState = safety ? safety.state : (state.failed ? 'fallback' : 'closed');
  dom.body.dataset.qaDoorProgress = safety ? String(safety.progress) : '0';
  dom.body.dataset.qaDoorAngle = safety ? String(safety.angleDeg) : '0';
  dom.body.dataset.qaDoorTarget = safety ? String(safety.openAngleDeg) : '0';
  dom.body.dataset.qaBarsProgress = bars ? String(bars.expandedProgress) : '0';
  dom.body.dataset.qaBarsCondensed = bars ? String(round(1 - bars.expandedProgress, 4)) : '1';
  dom.body.dataset.qaBarsVisible = bars ? String(bars.visibleCount) : '0';
  dom.body.dataset.qaTime = String(round(animation ? animation.elapsedMs : 0, 1));
  dom.body.dataset.qaBarsCount = String(BAR_COUNT);
  if (bars && bars.helix) dom.body.dataset.qaHelix = String(round(bars.helix.radius, 3));
  if (bars && bars.geometry) dom.body.dataset.qaBarGeometry = bars.geometry.shared ? 'shared' : 'distinct';
  const trackball = studio && studio.trackball ? studio.trackball : null;
  dom.body.dataset.qaTrackball = trackball
    ? (trackball.dragging ? 'dragging' : quatAngle(trackball.current) < 1e-6 ? 'rest' : 'rotated')
    : 'rest';
  dom.body.dataset.qaMeshCount = String(objectsDebugCount(studio));
  dom.body.dataset.qaPlaying = animation && animation.playing ? '1' : '0';
  dom.body.dataset.qaPlayedOnce = animation && animation.playedOnce ? '1' : '0';
  if (camera) {
    dom.body.dataset.qaCamera = [camera.azimuthDeg, camera.elevationDeg].join(',');
    dom.body.dataset.qaDistance = String(camera.distance);
  }
  if (objectRect) {
    dom.body.dataset.qaObjectRect = [objectRect.x, objectRect.y, objectRect.width, objectRect.height].join(',');
  }
  dom.body.dataset.still = state.still ? '1' : '0';
  dom.body.dataset.shot = state.shot ? '1' : '0';
  dom.body.dataset.play = state.playParam !== null ? state.playParam : 'auto';
  dom.body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  try {
    const stage = dom.stage;
    if (stage) {
      const rect = stage.getBoundingClientRect();
      dom.body.dataset.qaStageRect = [rect.x, rect.y, rect.width, rect.height].map((v) => round(v, 2)).join(',');
    }
  } catch (error) { /* stage rect is diagnostics only */ }
  if (dom.diag) dom.diag.textContent = JSON.stringify(buildDebug());
}

/* ----------------------------------------------------------------- studio */

class VaultStudio {
  constructor({ canvas, stage, model, reducedMotion = false, still = false, shot = false, deterministicView = false }) {
    this.canvas = canvas;
    this.stage = stage;
    this.model = model;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    /** Rev21 shared image-based lighting handle (src/env-room.js). */
    this.room = null;
    this.floorFade = null;
    this.contactShadow = null;
    this.stageBox = { width: 0, height: 0 };
    this.cameraTarget = new THREE.Vector3(CAMERA.target[0], CAMERA.target[1], CAMERA.target[2]);
    this.cameraDirection = viewDirection(CAMERA.azimuthDeg, CAMERA.elevationDeg);
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
    this.final = false;
    this.onChange = null;
    this.resizeObserver = null;
    // Rev21 trackball: the whole vault group can be dragged (arcball, camera-space
    // delta pre-multiplied onto a target quaternion, damped with slerp). Static /
    // deterministic modes keep the rest orientation.
    this.deterministicView = Boolean(deterministicView) || !this.motionAllowed();
    this.trackball = {
      enabled: !this.deterministicView,
      dragging: false,
      pointerId: null,
      lastPoint: null,
      current: TRACKBALL.identity.slice(),
      target: TRACKBALL.identity.slice(),
      dragCount: 0,
      resetCount: 0,
      moveCount: 0,
    };
    this.pointerHandlers = null;
    this.animation = {
      playing: false,
      playedOnce: false,
      progress: 0,
      phase: 'intro',
      elapsed: 0,
      total: MODEL.ANIMATION_SPEC.totalMs,
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
    scene.name = 'vault-studio';
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.4, CAMERA.near, CAMERA.far);
    camera.name = 'vault-camera';
    this.camera = camera;

    // Rev21: wait for the shared room photo (PMREM -> scene.environment) before
    // anything else; the page only reports ready after this resolves.
    this.room = await applyEnvRoom(THREE, renderer, scene, { intensity: ENVIRONMENT.intensity });

    this.buildFloor();
    this.buildContactShadow();

    scene.add(this.model.root);
    // r151: the room intensity is applied per material, so re-walk the now-built
    // scene (vault body/door/bars).
    this.room.refresh(scene);
    this.applyPose('initial');
    this.wireTrackball();
    // Deterministic captures and reduced-motion pages always start/rest upright.
    if (this.deterministicView) this.resetView({ immediate: true });

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

  /** Dark reflective-floor bed: a soft radial fade plane. */
  buildFloor() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(7, 9, 13, 0.0)');
    gradient.addColorStop(0.34, 'rgba(7, 9, 13, 0.18)');
    gradient.addColorStop(0.62, 'rgba(6, 8, 11, 0.55)');
    gradient.addColorStop(0.84, 'rgba(5, 6, 9, 0.86)');
    gradient.addColorStop(1, 'rgba(4, 5, 7, 0.97)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'vault-floor-fade';
    texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(FLOOR.fadeRadius * 2, FLOOR.fadeRadius * 2);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: FLOOR.fadeOpacity,
    });
    const fade = new THREE.Mesh(geometry, material);
    fade.name = 'vault-floor-fade';
    fade.rotation.x = -Math.PI / 2;
    fade.position.y = 0.002;
    fade.renderOrder = 2;
    this.scene.add(fade);
    this.floorFade = fade;
  }

  /** Baked soft contact shadow under the safe (deterministic, no shadow map). */
  buildContactShadow() {
    const width = 512;
    const height = 256;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(1, height / width);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, width / 2);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
    gradient.addColorStop(0.42, 'rgba(0, 0, 0, 0.36)');
    gradient.addColorStop(0.74, 'rgba(0, 0, 0, 0.12)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'vault-contact-shadow';
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: FLOOR.shadowOpacity,
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR.shadowWidth, FLOOR.shadowDepth), material,
    );
    mesh.name = 'vault-contact-shadow';
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.004, 0.1);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.contactShadow = mesh;
  }

  /* ------------------------------------------------------------ trackball */

  /** Normalized stage coordinates ([-1,1], y up) for a pointer event. */
  pointerPoint(event) {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    return [
      clamp(((event.clientX - rect.left) / width) * 2 - 1, -1, 1),
      clamp(-(((event.clientY - rect.top) / height) * 2 - 1), -1, 1),
    ];
  }

  /** Rotate the whole vault rig to the current quaternion. */
  applyOrientation() {
    const q = this.trackball.current;
    this.model.root.quaternion.set(q[0], q[1], q[2], q[3]);
    this.model.root.updateMatrixWorld(true);
  }

  /** Ease the current quaternion toward the target (damped slerp). */
  updateTrackball(dtMs) {
    const tb = this.trackball;
    if (this.deterministicView) return;
    const dt = clamp(dtMs / 1000, 0, 0.1);
    const ease = tb.dragging ? TRACKBALL.dragEase : TRACKBALL.releaseEase;
    const alpha = 1 - Math.exp(-ease * dt);
    const next = quatSlerp(tb.current, tb.target, alpha);
    const delta = Math.abs(next[0] - tb.current[0]) + Math.abs(next[1] - tb.current[1])
      + Math.abs(next[2] - tb.current[2]) + Math.abs(next[3] - tb.current[3]);
    if (delta < 1e-7) return;
    // angle between `next` and `target` (conjugate of a unit quat is its inverse)
    const remaining = quatAngle(quatMultiply([-next[0], -next[1], -next[2], next[3]], tb.target));
    tb.current = remaining < TRACKBALL.snapAngle ? tb.target.slice() : next;
    this.applyOrientation();
    this.requestRender();
  }

  /** Deterministic rig yaw (used by ?view=<deg> for rotated evidence captures). */
  setViewYaw(degrees) {
    const angle = degToRad(Number(degrees) || 0);
    const q = quatNormalize([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]);
    this.trackball.target = q.slice();
    this.trackball.current = q.slice();
    this.applyOrientation();
    this.requestRender();
    return q;
  }

  /** Reset the view to the deterministic rest orientation. */
  resetView({ immediate = false } = {}) {
    const tb = this.trackball;
    tb.target = TRACKBALL.identity.slice();
    if (immediate || this.deterministicView) tb.current = TRACKBALL.identity.slice();
    tb.dragging = false;
    tb.pointerId = null;
    tb.lastPoint = null;
    tb.resetCount += 1;
    this.applyOrientation();
    this.requestRender();
    return tb.resetCount;
  }

  wireTrackball() {
    if (this.deterministicView) {
      this.resetView({ immediate: true });
      return;
    }
    const onDown = (event) => {
      if (!this.motionAllowed() || this.deterministicView) return;
      if (typeof event.button === 'number' && event.button !== 0) return;
      const tb = this.trackball;
      tb.dragging = true;
      tb.pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      tb.lastPoint = this.pointerPoint(event);
      tb.dragCount += 1;
      if (this.canvas && typeof this.canvas.setPointerCapture === 'function' && tb.pointerId !== null) {
        try { this.canvas.setPointerCapture(tb.pointerId); } catch (error) { /* best effort */ }
      }
      this.requestRender();
    };
    const onMove = (event) => {
      const tb = this.trackball;
      if (!tb.dragging) return;
      if (tb.pointerId !== null && typeof event.pointerId === 'number' && event.pointerId !== tb.pointerId) return;
      const point = this.pointerPoint(event);
      const previous = tb.lastPoint || point;
      const delta = arcballDelta(previous[0], previous[1], point[0], point[1]);
      tb.target = quatNormalize(quatMultiply(delta, tb.target));
      tb.lastPoint = point;
      tb.moveCount += 1;
      this.requestRender();
    };
    const onUp = (event) => {
      const tb = this.trackball;
      if (!tb.dragging) return;
      if (tb.pointerId !== null && event && typeof event.pointerId === 'number' && event.pointerId !== tb.pointerId) return;
      tb.dragging = false;
      tb.pointerId = null;
      tb.lastPoint = null;
      this.requestRender();
    };
    const onDoubleClick = (event) => {
      if (!this.motionAllowed() || this.deterministicView) return;
      if (event) event.preventDefault();
      this.resetView({ immediate: true });
    };
    this.pointerHandlers = { onDown, onMove, onUp, onDoubleClick };
    this.canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    this.canvas.addEventListener('dblclick', onDoubleClick);
  }

  unwireTrackball() {
    const handlers = this.pointerHandlers;
    if (!handlers || !this.canvas) return;
    this.canvas.removeEventListener('pointerdown', handlers.onDown);
    window.removeEventListener('pointermove', handlers.onMove);
    window.removeEventListener('pointerup', handlers.onUp);
    window.removeEventListener('pointercancel', handlers.onUp);
    this.canvas.removeEventListener('dblclick', handlers.onDoubleClick);
    this.pointerHandlers = null;
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

  /* --------------------------------------------------------- fit camera */

  boundsCorners(bounds) {
    const corners = [];
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    return corners;
  }

  fitCamera() {
    if (!this.camera) return;
    const width = this.stageBox.width || 1;
    const height = this.stageBox.height || 1;
    const aspect = width / height;
    const margin = width < CAMERA.narrowStageWidth ? CAMERA.fitMarginNarrow : CAMERA.fitMargin;
    const corners = this.boundsCorners(this.model.bounds.all);
    const direction = this.cameraDirection;
    const target = this.cameraTarget;
    const limitX = 1 - margin;
    const limitY = 1 - margin;
    const projected = new THREE.Vector3();
    let distance = 4;
    for (let step = 0; step < 400; step += 1) {
      const probe = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
      probe.position.copy(target).addScaledVector(direction, distance);
      probe.lookAt(target);
      probe.updateMatrixWorld(true);
      probe.updateProjectionMatrix();
      let fits = true;
      for (const corner of corners) {
        projected.copy(corner).project(probe);
        if (Math.abs(projected.x) > limitX || Math.abs(projected.y) > limitY) {
          fits = false;
          break;
        }
      }
      if (fits) break;
      distance += 0.25;
    }
    this.cameraDistance = distance;
    this.camera.aspect = aspect;
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  resize() {
    if (!this.renderer || this.destroyed) return;
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.stageBox.width && height === this.stageBox.height) return;
    this.stageBox = { width, height };
    this.renderer.setSize(width, height, false);
    this.fitCamera();
    this.requestRender();
  }

  /* ------------------------------------------------------------ animation */

  /** Static pose: 'final' = open door + all bars visible, 'initial' = closed. */
  applyPose(mode) {
    const final = mode === 'final' || mode === 'closed';
    MODEL.applyStaticPose(this.model, final ? 'final' : 'initial');
    if (this.deterministicView) this.resetView({ immediate: true });
    this.final = final;
    this.requestRender();
  }

  /** Apply the exact pose for animation.elapsed (door opening + bar reveal). */
  applyCurrentFrame() {
    const elapsed = this.animation.elapsed;
    const doorProgress = MODEL.getDoorProgress(elapsed);
    const barsElapsed = Math.min(elapsed, MODEL.ANIMATION_SPEC.barTotalMs);
    MODEL.applyAnimationFrame(this.model, { doorProgress, barsElapsedMs: barsElapsed });
    this.final = elapsed >= MODEL.ANIMATION_SPEC.totalMs;
    this.requestRender();
  }

  /** Deterministic time sample (used by ?t=<ms> and the QA seek() hook). */
  seek(elapsedMs) {
    const total = MODEL.ANIMATION_SPEC.totalMs;
    const elapsed = clamp(Number(elapsedMs) || 0, 0, total);
    this.animation.playing = false;
    this.animation.elapsed = elapsed;
    this.animation.progress = clamp(elapsed / total, 0, 1);
    this.animation.phase = elapsed >= total ? 'open' : elapsed <= 0 ? 'closed' : 'opening';
    this.animation.playedOnce = elapsed >= total;
    this.applyCurrentFrame();
    this.final = elapsed >= total;
    this.emitChange();
    return elapsed;
  }

  startAnimation() {
    if (!this.motionAllowed()) {
      this.applyPose('final');
      this.animation.playing = false;
      this.animation.playedOnce = true;
      this.animation.progress = 1;
      this.animation.phase = 'open';
      this.animation.elapsed = MODEL.ANIMATION_SPEC.totalMs;
      this.emitChange();
      return { durationMs: 0 };
    }
    // Play/replay always restarts from the initial closed / no-bars pose.
    this.applyPose('initial');
    this.animation.playing = true;
    this.animation.playedOnce = true;
    this.animation.progress = 0;
    this.animation.phase = 'opening';
    this.animation.elapsed = 0;
    this.animation.total = MODEL.ANIMATION_SPEC.totalMs;
    this.final = false;
    this.requestRender();
    this.emitChange();
    return { durationMs: this.animation.total };
  }

  updateAnimation(dtMs) {
    const animation = this.animation;
    if (!animation.playing) return;
    animation.elapsed = Math.min(animation.elapsed + dtMs, MODEL.ANIMATION_SPEC.totalMs);
    const elapsed = animation.elapsed;
    const doorProgress = MODEL.getDoorProgress(elapsed);
    MODEL.applyAnimationFrame(this.model, {
      doorProgress,
      barsElapsedMs: Math.min(elapsed, MODEL.ANIMATION_SPEC.barTotalMs),
    });
    animation.progress = clamp(elapsed / (animation.total || 1), 0, 1);
    animation.phase = doorProgress < 1 ? 'opening' : 'revealing';
    if (elapsed >= MODEL.ANIMATION_SPEC.totalMs) {
      animation.playing = false;
      animation.progress = 1;
      animation.phase = 'open';
      animation.elapsed = MODEL.ANIMATION_SPEC.totalMs;
      this.applyPose('final');
      this.final = true;
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
    this.updateTrackball(dt);
    if (this.needsRender) this.renderFrame();
  }

  emitChange() {
    if (typeof this.onChange === 'function') {
      try {
        this.onChange();
      } catch (error) { /* UI sync is best effort */ }
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
    const doorProgress = MODEL.getDoorProgress(animation.elapsed);
    const barProgress = clamp(animation.elapsed / MODEL.ANIMATION_SPEC.barTotalMs, 0, 1);
    return {
      playing: animation.playing,
      progress: round(animation.progress, 4),
      playedOnce: animation.playedOnce,
      phase: animation.phase,
      totalMs: round(animation.total, 1),
      elapsedMs: round(animation.elapsed, 1),
      doorDurationMs: MODEL.ANIMATION_SPEC.doorDurationMs,
      barDurationMs: MODEL.ANIMATION_SPEC.barDurationMs,
      barStaggerMs: MODEL.ANIMATION_SPEC.barStaggerMs,
      barTotalMs: MODEL.ANIMATION_SPEC.barTotalMs,
      doorProgress: round(doorProgress, 4),
      barProgress: round(barProgress, 4),
      doorDirection: 'closed -> open',
      mode: this.motionAllowed() ? 'animated' : 'static',
      final: Boolean(this.final),
    };
  }

  getSafetyDebug() {
    const angle = this.model.safe.door.group.rotation.y;
    const openAngleRad = this.model.openAngleRad || 1;
    const progress = clamp(angle / openAngleRad, 0, 1);
    return {
      state: progress >= 0.999 ? 'open' : progress <= 0.001 ? 'closed' : 'opening',
      progress: round(progress, 4),
      angleDeg: round(radToDeg(angle), 2),
      openAngleDeg: round(radToDeg(openAngleRad), 2),
      direction: 'closed -> open',
      dotCount: this.model.spec.door.dotCount,
      ribCount: this.model.spec.finCount,
      handle: 'recessed grip slot + hinge pins',
    };
  }

  getBarDebug() {
    const total = MODEL.ANIMATION_SPEC.barTotalMs;
    const elapsed = this.animation.elapsed;
    const expanded = clamp(elapsed / total, 0, 1);
    const helix = MODEL.BAR_HELIX;
    const clearance = this.model.barClearance;
    const order = this.model.revealOrder.slice();
    const positions = this.model.bars.map((bar) => ({
      index: bar.index,
      slot: bar.slot,
      order: bar.order,
      thetaDeg: round(bar.thetaDeg, 4),
      startThetaDeg: round(bar.startThetaDeg, 4),
      radius: round(bar.radius, 4),
      y: round(bar.final.position.y, 4),
      top: round(bar.top, 4),
      length: round(bar.length, 4),
      final: {
        x: round(bar.final.position.x, 4),
        y: round(bar.final.position.y, 4),
        z: round(bar.final.position.z, 4),
      },
      start: {
        x: round(bar.start.position.x, 4),
        y: round(bar.start.position.y, 4),
        z: round(bar.start.position.z, 4),
      },
      position: {
        x: round(bar.mesh.position.x, 4),
        y: round(bar.mesh.position.y, 4),
        z: round(bar.mesh.position.z, 4),
      },
      opacity: round(bar.material.opacity, 3),
      visible: bar.mesh.visible !== false,
      geometryUuid: bar.mesh.geometry.uuid,
      scale: [round(bar.mesh.scale.x, 4), round(bar.mesh.scale.y, 4), round(bar.mesh.scale.z, 4)],
    }));
    const thetasByOrder = order.map((index) => positions[index].thetaDeg);
    const ysByOrder = order.map((index) => positions[index].y);
    const deltaThetas = [];
    const deltaYs = [];
    for (let index = 1; index < order.length; index += 1) {
      deltaThetas.push(round(thetasByOrder[index] - thetasByOrder[index - 1], 6));
      deltaYs.push(round(ysByOrder[index] - ysByOrder[index - 1], 6));
    }
    const unique = (values) => Array.from(new Set(values));
    const geometryUuids = unique(positions.map((bar) => bar.geometryUuid));
    const lengths = unique(positions.map((bar) => bar.length));
    const scales = unique(positions.map((bar) => bar.scale.join(',')));
    const sumDeltaTheta = round(deltaThetas.reduce((sum, value) => sum + value, 0), 6);
    return {
      count: BAR_COUNT,
      expandedProgress: round(expanded, 4),
      condensedProgress: round(1 - expanded, 4),
      visibleCount: positions.filter((bar) => bar.visible).length,
      order,
      bars: positions,
      helix: {
        radius: round(helix.radius, 4),
        startAngleDeg: round(helix.startAngleDeg, 4),
        deltaAngleDeg: round(helix.deltaAngleDeg, 6),
        startY: round(helix.startY, 4),
        stepY: round(helix.stepY, 4),
        revolutions: round(MODEL.BAR_REVOLUTIONS, 6),
        thetaStartDeg: round(thetasByOrder[0], 4),
        thetaEndDeg: round(thetasByOrder[thetasByOrder.length - 1], 4),
        deltaThetasDeg: deltaThetas,
        deltaYs,
        deltaThetaConstant: unique(deltaThetas.map((value) => value.toFixed(6))).length === 1,
        deltaYConstant: unique(deltaYs.map((value) => value.toFixed(6))).length === 1,
        sumDeltaThetaDeg: sumDeltaTheta,
        yStart: round(ysByOrder[0], 4),
        yEnd: round(ysByOrder[ysByOrder.length - 1], 4),
      },
      geometry: {
        shared: geometryUuids.length === 1,
        geometryUuid: geometryUuids[0] || null,
        geometryCount: geometryUuids.length,
        meshCount: positions.length,
        lengths,
        scales,
        uniformScale: scales.length === 1 && scales[0] === '1,1,1',
      },
      clearance: {
        barRadius: round(clearance.barRadius, 4),
        helixRadius: round(clearance.helixRadius, 4),
        safeMaxRadius: round(clearance.safeMaxRadius, 4),
        doorClosedMaxRadius: round(clearance.doorClosedMaxRadius, 4),
        doorOpenMaxRadius: round(clearance.doorOpenMaxRadius, 4),
        maxBodyRadius: round(clearance.maxBodyRadius, 4),
        helixClearance: round(clearance.helixClearance, 4),
        minSafeClearance: round(clearance.minSafeClearance, 4),
        minDoorClosedClearance: round(clearance.minDoorClosedClearance, 4),
        minDoorOpenClearance: round(clearance.minDoorOpenClearance, 4),
        minClearance: round(clearance.minClearance, 4),
        allClear: clearance.allClear,
        helixClearsBody: clearance.helixClearsBody,
      },
      reveal: {
        doorDurationMs: MODEL.ANIMATION_SPEC.doorDurationMs,
        barDurationMs: MODEL.ANIMATION_SPEC.barDurationMs,
        barStaggerMs: MODEL.ANIMATION_SPEC.barStaggerMs,
        barTotalMs: MODEL.ANIMATION_SPEC.barTotalMs,
        totalMs: MODEL.ANIMATION_SPEC.totalMs,
        doorStartMs: 0,
        revealStartMs: 0,
        firstBar: order[0],
        lastBar: order[order.length - 1],
        firstBarY: round(ysByOrder[0], 4),
        lastBarY: round(ysByOrder[ysByOrder.length - 1], 4),
        bottomMostFirst: ysByOrder.every((y, index) => index === 0 || y > ysByOrder[index - 1]),
        simultaneousWithDoor: true,
      },
      tones: MODEL.BAR_TONES.map((tone) => tone.name),
      gradient: 'steel -> cobalt (procedural DataTexture, no baked reflection)',
      advance: 'previous helix slot (tangent advance)',
    };
  }
  getCameraDebug() {
    if (!this.camera) return null;
    const direction = new THREE.Vector3().subVectors(this.camera.position, this.cameraTarget).normalize();
    return {
      azimuthDeg: round(radToDeg(Math.atan2(direction.x, direction.z)), 2),
      elevationDeg: round(radToDeg(Math.asin(clamp(direction.y, -1, 1))), 2),
      distance: round(this.camera.position.distanceTo(this.cameraTarget), 2),
      fov: CAMERA.fov,
      near: CAMERA.near,
      far: CAMERA.far,
      aspect: round(this.camera.aspect, 4),
      position: [round(this.camera.position.x, 2), round(this.camera.position.y, 2), round(this.camera.position.z, 2)],
      target: [round(this.cameraTarget.x, 2), round(this.cameraTarget.y, 2), round(this.cameraTarget.z, 2)],
      nominalAzimuthDeg: CAMERA.azimuthDeg,
      nominalElevationDeg: CAMERA.elevationDeg,
      narrowStage: (this.stageBox.width || 0) < CAMERA.narrowStageWidth,
    };
  }

  getObjectScreenRect() {
    if (!this.camera || !this.model) return null;
    const width = this.stageBox.width || 1;
    const height = this.stageBox.height || 1;
    // Project the SAME fitted envelope the camera solve uses (the rotation-safe
    // bounds box) so the reported rect describes the framed object volume even
    // after a trackball rotation.
    const bounds = this.model.bounds.all;
    if (!bounds) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const world = new THREE.Vector3();
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          world.set(x, y, z).project(this.camera);
          const px = (world.x * 0.5 + 0.5) * width;
          const py = (1 - (world.y * 0.5 + 0.5)) * height;
          minX = Math.min(minX, px); maxX = Math.max(maxX, px);
          minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
      }
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

  /**
   * Per-mesh material inventory for QA/Lead debugging: every visible mesh of the
   * safe/bar field with its material name/type and the legacy-color-safe values.
   */
  getVaultMeshDebug() {
    if (!this.model) return [];
    const list = [];
    this.model.root.updateMatrixWorld(true);
    this.model.root.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      list.push({
        mesh: object.name,
        visible: object.visible !== false,
        materials: materials.map((material) => ({
          name: material.name,
          type: material.type,
          color: material.color
            ? '#' + material.color.clone().convertLinearToSRGB().getHexString()
            : null,
          metalness: typeof material.metalness === 'number' ? round(material.metalness, 3) : null,
          roughness: typeof material.roughness === 'number' ? round(material.roughness, 3) : null,
          envMapIntensity: typeof material.envMapIntensity === 'number'
            ? round(material.envMapIntensity, 3) : null,
          opacity: typeof material.opacity === 'number' ? round(material.opacity, 3) : null,
          transparent: Boolean(material.transparent),
          hasMap: Boolean(material.map),
        })),
      });
    });
    return list;
  }

  getRenderDebug() {
    return {
      renderCount: this.renderCount,
      stage: { width: this.stageBox.width, height: this.stageBox.height },
      dpr: this.renderer ? this.renderer.getPixelRatio() : 1,
      triangles: this.renderer ? this.renderer.info.render.triangles : 0,
      calls: this.renderer ? this.renderer.info.render.calls : 0,
    };
  }

  dispose() {
    this.destroyed = true;
    this.unwireTrackball();
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    if (this.room) {
      this.room.dispose();
      this.room = null;
    }
    if (this.scene) this.scene.environment = null;
  }
}

/* ---------------------------------------------------------------- wiring */

function createStudio() {
  const studio = new VaultStudio({
    canvas: dom.canvas,
    stage: dom.stage,
    model: state.model,
    reducedMotion: state.reducedMotion,
    still: state.still,
    shot: state.shot,
    deterministicView: isStaticMode() || state.timeParam !== null,
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
  studio.startAnimation();
  syncUi();
  publishState();
  announce('Vault opening');
  return studio.waitForIdle().then(() => {
    syncUi();
    publishState();
    return true;
  });
}

function doReplay() {
  const studio = state.studio;
  if (!studio || state.failed) return Promise.resolve(false);
  studio.startAnimation();
  syncUi();
  publishState();
  announce('Replaying the vault opening');
  return studio.waitForIdle().then(() => {
    syncUi();
    publishState();
    return true;
  });
}

function buildDebug() {
  const studio = state.studio;
  const meshDebug = studio ? studio.getVaultMeshDebug() : [];
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
    environment: {
      mode: 'image-based',
      source: ENVIRONMENT_LABEL,
      intensity: ENVIRONMENT.intensity,
      exposure: RENDERER.exposure,
      lights: 0,
    },
    safe: studio ? studio.getSafetyDebug() : null,
    bars: studio
      ? studio.getBarDebug()
      : {
          count: BAR_COUNT,
          expandedProgress: 0,
          condensedProgress: 1,
          visibleCount: 0,
          helix: { radius: MODEL.BAR_HELIX.radius, deltaAngleDeg: MODEL.BAR_HELIX.deltaAngleDeg },
        },
    trackball: studio && studio.trackball
      ? {
          enabled: studio.trackball.enabled,
          deterministic: studio.deterministicView,
          dragging: studio.trackball.dragging,
          dragCount: studio.trackball.dragCount,
          moveCount: studio.trackball.moveCount,
          resetCount: studio.trackball.resetCount,
          quaternion: studio.trackball.current.map((value) => round(value, 6)),
          target: studio.trackball.target.map((value) => round(value, 6)),
          angleDeg: round(radToDeg(quatAngle(studio.trackball.current)), 3),
          rest: quatAngle(studio.trackball.current) < 1e-6,
          // The actual rig (group) quaternion the renderer uses.
          groupQuaternion: state.model ? state.model.root.quaternion.toArray().map((value) => round(value, 6)) : null,
          // The deterministic rest orientation is the identity quaternion; static
          // captures always report it.
          restQuaternion: [0, 0, 0, 1],
        }
      : null,
    animation: studio
      ? studio.getAnimationDebug()
      : { playing: false, progress: 0, playedOnce: false, phase: 'intro' },
    camera: studio ? studio.getCameraDebug() : null,
    objectRect: studio ? studio.getObjectScreenRect() : null,
    // Per-mesh material inventory (every visible mesh of the safe + bar field).
    meshes: meshDebug,
    meshCount: meshDebug.length,
    objects: studio
      ? {
          safe: 1,
          ribs: MODEL.VAULT_SPEC.finCount,
          doorDots: MODEL.VAULT_SPEC.door.dotCount,
          bars: BAR_COUNT,
          barGeometry: state.model ? state.model.barGeometryShare.geometryCount : 0,
          barGeometryShared: Boolean(state.model && state.model.barGeometryShare.sharedInstance),
          barHelixRevolutions: round(MODEL.BAR_REVOLUTIONS, 6),
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
    materials: state.model
      ? {
          body: {
            metalness: state.model.materials.body.metalness,
            roughness: state.model.materials.body.roughness,
            envMapIntensity: state.model.materials.body.envMapIntensity,
          },
          door: {
            metalness: state.model.materials.door.metalness,
            roughness: state.model.materials.door.roughness,
          },
          bars: {
            count: BAR_COUNT,
            helixRadius: MODEL.BAR_HELIX.radius,
            geometry: 'ONE shared CapsuleGeometry instance for all 24 bars',
            material: 'MeshStandardMaterial per bar, procedural DataTexture gradient, animated opacity, no baked reflection',
          },
        }
      : null,
    model: {
      version: MODEL.MODEL_VERSION,
      spec: MODEL.VAULT_SPEC,
      barSpec: MODEL.BAR_SPEC,
      helix: {
        ...MODEL.BAR_HELIX,
        revolutions: MODEL.BAR_REVOLUTIONS,
      },
      clearance: state.model ? state.model.barClearance : MODEL.barClearanceReport(),
      geometryShare: state.model
        ? {
            shared: state.model.barGeometryShare.sharedInstance,
            geometryCount: state.model.barGeometryShare.geometryCount,
            meshCount: state.model.barGeometryShare.meshCount,
            geometryUuid: state.model.barGeometry.uuid,
          }
        : null,
      cameraSpec: CAMERA,
      animationSpec: MODEL.ANIMATION_SPEC,
      revealOrder: state.model ? state.model.revealOrder.slice() : null,
      bounds: state.model ? state.model.bounds : null,
    },
    timeMs: studio ? round(studio.animation.elapsed, 1) : 0,
    stageRect: null,
    flags: {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      qaMode: Boolean(state.qaMode),
      reducedMotion: Boolean(state.reducedMotion),
      autoplay: Boolean(state.autoplay),
      fallback: Boolean(state.failed),
      play: state.playParam !== null ? state.playParam : 'auto',
      time: state.timeParam !== null ? fixedTimeMs() : null,
      view: state.viewParam !== null ? fixedViewYaw() : null,
      final: Boolean(studio && studio.final),
    },
    urls: {
      page: IS_BROWSER ? window.location.href : '',
      model: IS_BROWSER ? new URL('./vault-model.js', import.meta.url).href : '',
    },
  };
  try {
    const stage = dom.stage || document.getElementById('stage');
    if (stage) {
      const rect = stage.getBoundingClientRect();
      debug.stageRect = {
        x: round(rect.x, 2),
        y: round(rect.y, 2),
        width: round(rect.width, 2),
        height: round(rect.height, 2),
        w: round(rect.width, 2),
        h: round(rect.height, 2),
        top: round(rect.top, 2),
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
  seek(elapsedMs) {
    if (!state.studio || state.failed) return false;
    const elapsed = state.studio.seek(Number(elapsedMs));
    syncUi();
    publishState();
    return elapsed;
  },
  debug: buildDebug,
  meshes() {
    return state.studio ? state.studio.getVaultMeshDebug() : [];
  },
  /** Reset the trackball view to the deterministic rest orientation. */
  resetView() {
    if (!state.studio) return false;
    state.studio.resetView({ immediate: true });
    syncUi();
    publishState();
    announce('View reset');
    return true;
  },
  waitForIdle() {
    if (!state.studio) return Promise.resolve(false);
    return state.studio.waitForIdle();
  },
  readyPromise() {
    return readyPromise;
  },
};
// Keep `api.ready` live (some capture harnesses poll it after boot).
Object.defineProperty(api, 'ready', {
  enumerable: true,
  get: () => state.ready,
  set: (value) => { state.ready = Boolean(value); },
});
if (IS_BROWSER) window.__tekoVault = api;

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
  if (dom.body) {
    dom.body.dataset.fallback = '1';
    dom.body.dataset.qaFallback = '1';
  }
  if (dom.btnReplay) dom.btnReplay.disabled = true;
  hideCurtain();
  if (banner && dom.errorBanner) {
    if (dom.errorText) dom.errorText.textContent = message;
    dom.errorBanner.hidden = false;
  }
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

function triggerAnimation(source) {
  const studio = state.studio;
  if (!studio || state.failed) return;
  if (source !== 'manual' && !state.autoplay) return;
  if (studio.animation.playedOnce && studio.final) return;
  if (studio.animation.playing) return;
  state.autoplay = false;
  publishState();
  studio.startAnimation();
  syncUi();
  publishState();
  announce(source === 'viewport' ? 'Vault opening' : 'Vault opening again');
}

function setupViewportTrigger() {
  if (!state.autoplay) {
    publishState();
    return;
  }
  if (!dom.stage || typeof IntersectionObserver !== 'function') {
    triggerAnimation('no-observer');
    return;
  }
  try {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
          observer.disconnect();
          state.viewObserver = null;
          triggerAnimation('viewport');
          return;
        }
      }
    }, { threshold: [0, 0.2, 0.35, 0.6, 1] });
    observer.observe(dom.stage);
    state.viewObserver = observer;
  } catch (error) {
    pushWarning('IntersectionObserver failed, animating immediately: ' + errorMessage(error));
    triggerAnimation('no-observer');
  }
}

/* --------------------------------------------------------------------- ui */

function wireUi() {
  if (dom.btnReplay) {
    dom.btnReplay.addEventListener('click', () => {
      doReplay();
    });
  }
  if (dom.btnResetView) {
    dom.btnResetView.addEventListener('click', () => {
      if (!state.studio) return;
      state.studio.resetView({ immediate: true });
      syncUi();
      publishState();
      announce('View reset');
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
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      // Reset the trackball view to the deterministic rest orientation.
      event.preventDefault();
      if (state.studio) {
        state.studio.resetView({ immediate: true });
        syncUi();
        publishState();
        announce('View reset');
      }
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
          state.studio.applyPose('final');
          state.studio.animation.playing = false;
          state.studio.animation.progress = 1;
          state.studio.animation.phase = 'open';
          state.studio.animation.playedOnce = true;
          state.studio.animation.elapsed = MODEL.ANIMATION_SPEC.totalMs;
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

/* -------------------------------------------------------------------- boot */

async function boot() {
  state.booting = true;
  api.ready = false;

  dom.body.dataset.fallback = '0';
  dom.body.dataset.qaReady = '0';
  const bootTime = fixedTimeMs();
  dom.body.dataset.qaAnimation = bootTime !== null ? 'sample' : state.playParam === '0' ? 'initial' : 'intro';
  dom.body.dataset.qaSafeState = 'closed';
  dom.body.dataset.qaDoorProgress = '0';
  dom.body.dataset.qaDoorAngle = '0';
  dom.body.dataset.qaBarsProgress = '0';
  dom.body.dataset.qaBarsVisible = '0';
  dom.body.dataset.qaTime = bootTime !== null ? String(bootTime) : '0';
  dom.body.dataset.qaBarsCount = String(BAR_COUNT);
  dom.body.dataset.qaMeshCount = '0';
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
    showFallback('WebGL is not available in this browser, so the interactive vault cannot be rendered. A static poster of the ribbed steel safe is shown below.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.3, 'Building the vault', '');
  let model = null;
  try {
    model = MODEL.createVaultModel({ quality: 'hero' });
    state.model = model;
  } catch (error) {
    showFallback('The vault model could not be built (' + errorMessage(error) + '). A static poster is shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }
  if (!model || !Array.isArray(model.bars) || model.bars.length !== BAR_COUNT) {
    showFallback('The vault model did not produce the expected ' + BAR_COUNT + ' background bars.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.6, 'Starting the vault studio', '');
  try {
    state.studio = createStudio();
    await state.studio.init();
    const contextLost = (event) => {
      event.preventDefault();
      showFallback('WebGL context was lost, so a static poster of the vault is shown below.');
      resolveReady(false);
    };
    dom.canvas.addEventListener('webglcontextlost', contextLost, false);
    state.studio.contextLostHandler = contextLost;
  } catch (error) {
    if (state.studio) {
      try {
        state.studio.dispose();
      } catch (disposeError) { /* best effort */ }
      state.studio = null;
    }
    showFallback('The three.js studio could not start (' + errorMessage(error) + '). A static poster is shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }

  const studio = state.studio;
  // Deterministic / initial states:
  //   ?t=<ms>                      -> exact frozen animation sample, no autoplay
  //   still | shot | reduced-motion -> final OPEN door + ALL bars visible
  //   ?play=0                      -> initial closed door / no bars, no autoplay
  //   default                      -> initial closed / no bars, animate on viewport entry
  const bootTimeMs = fixedTimeMs();
  if (bootTimeMs !== null) {
    studio.seek(bootTimeMs);
    studio.final = bootTimeMs >= MODEL.ANIMATION_SPEC.totalMs;
    state.autoplay = false;
  } else if (isStaticMode()) {
    studio.applyPose('final');
    studio.animation.playing = false;
    studio.animation.progress = 1;
    studio.animation.phase = 'open';
    studio.animation.playedOnce = true;
    studio.animation.elapsed = MODEL.ANIMATION_SPEC.totalMs;
    state.autoplay = false;
  } else if (state.playParam === '0') {
    studio.applyPose('initial');
    studio.animation.playing = false;
    studio.animation.progress = 0;
    studio.animation.phase = 'closed';
    studio.animation.playedOnce = false;
    studio.animation.elapsed = 0;
    state.autoplay = false;
  } else {
    studio.applyPose('initial');
    studio.animation.playing = false;
    studio.animation.progress = 0;
    studio.animation.phase = 'closed';
    studio.animation.playedOnce = false;
    studio.animation.elapsed = 0;
    state.autoplay = true;
  }
  // ?view=<deg>: deterministic rig yaw for rotated evidence captures.
  const viewYaw = fixedViewYaw();
  if (viewYaw !== null) studio.setViewYaw(viewYaw);
  syncUi();
  publishState();

  curtainProgress(0.94, 'Fitting the studio', '');
  studio.fitCamera();
  studio.renderNow();
  await studio.whenFirstFrame();

  hideCurtain();
  state.ready = true;
  state.booting = false;
  api.ready = true;
  window.clearTimeout(state.watchdog);
  syncUi();
  publishState();
  announce('Vault ready');
  studio.renderNow();
  resolveReady(true);

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
      showFallback('The vault preview failed to start (' + errorMessage(error) + '). A static poster is shown below.', { error, banner: true });
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
      } catch (error) { /* best effort */ }
      state.model = null;
    }
  });
}

if (IS_BROWSER) main();

export { VERSION, VaultStudio };
