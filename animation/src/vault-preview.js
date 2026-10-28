/**
 * tekoanimation — Vault preview controller.
 *
 * Standalone collection page controller for `vault.html` (docs/vault.md,
 * revision 17): a dark product studio showing a ribbed steel safe/vault whose
 * chamfered door swings from CLOSED to OPEN while 24 thin steel-blue bars
 * reveal themselves: 12 bars stand in front of the safe on the right (stepping
 * downward from its right edge, +z) and 12 stand behind it on the left
 * (stepping upward from its left edge, -z). The reveal is ordered bottom-most
 * bar first; each next bar slides forward (+z) and fades in, finishing as the
 * door reaches fully open. The reflective dark floor shows a soft mirrored echo
 * of the vault + bars.
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
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import * as VaultModel from './vault-model.js';

const VERSION = '2.0.0';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ------------------------------------------------------------------ spec */

const MODEL = VaultModel;
const CAMERA = MODEL.CAMERA_SPEC;
const BAR_COUNT = MODEL.BAR_SPEC.count;

const RENDERER = Object.freeze({ exposure: 1.02, dprMax: 2 });
const ENVIRONMENT = Object.freeze({
  lightScale: 0.3,
  panelScale: 0.26,
  softboxScale: 1.2,
  sigma: 0.03,
});
const SOFTBOXES = Object.freeze([
  Object.freeze({ position: [-14, 12, 12], lookAt: [0, 2.4, 0], scale: [8, 6], color: 0xfff0df, intensity: 9 }),
  Object.freeze({ position: [13, 7, 9], lookAt: [0, 2.2, 0], scale: [6, 7], color: 0xa9c3e2, intensity: 5 }),
  Object.freeze({ position: [1, 10, -15], lookAt: [0, 2.4, 0], scale: [15, 2.6], color: 0xe4edf8, intensity: 13 }),
  Object.freeze({ position: [-15, 5, -8], lookAt: [0, 2.2, 0], scale: [8, 3.4], color: 0x6f9ddb, intensity: 3.4 }),
  Object.freeze({ position: [14, 8, -6], lookAt: [0, 2.4, 0], scale: [6, 4], color: 0x9fb8d8, intensity: 2.0 }),
]);
const LIGHTS = Object.freeze({
  key: { color: 0xfff0df, intensity: 1.35, position: [-620, 900, 760], target: [0, 240, 0] },
  fill: { color: 0xa9c3e2, intensity: 0.7, position: [820, 420, 520], target: [0, 220, 0] },
  rim: { color: 0xe4edf8, intensity: 2.1, position: [300, 640, -820], target: [0, 300, 0] },
  ambient: { color: 0x33404f, intensity: 0.3 },
});
const FLOOR = Object.freeze({
  fadeRadius: 26,
  fadeOpacity: 0.72,
  shadowWidth: 4.2,
  shadowDepth: 3.0,
  shadowOpacity: 0.82,
});
const REFLECTION = Object.freeze({
  // Strengthened for the rev-1 capture pass: the darker gunmetal body needs a
  // slightly brighter mirrored echo, while the floor fade still lets it die out.
  colorScale: 0.52,
  envScale: 0.45,
  emissiveScale: 0.55,
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
  constructor({ canvas, stage, model, reducedMotion = false, still = false, shot = false }) {
    this.canvas = canvas;
    this.stage = stage;
    this.model = model;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.envRT = null;
    this.floorFade = null;
    this.contactShadow = null;
    this.mirrorGroup = null;
    this.mirrorMaterials = [];
    this.mirrorSources = [];
    this.mirrorTargets = [];
    this.lights = {};
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

    this.buildFloor();
    this.buildContactShadow();
    this.buildMirrorReflection();

    scene.add(this.model.root);
    this.applyPose('initial');

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
      if (object.isMesh && object.material && object.material.isMeshBasicMaterial && object.material.color
        && typeof object.material.color.multiplyScalar === 'function') {
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

  /** Dark reflective-floor bed: a soft radial fade plane (the mirror lives below). */
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

  /**
   * Mirror the whole vault + bar field below the floor and dim it - the page's
   * dark reflective floor (no baked reflection, no extra render target).
   */
  buildMirrorReflection() {
    const mirror = this.model.root.clone(true);
    mirror.name = 'vault-mirror';
    mirror.scale.set(1, -1, 1);
    mirror.position.set(0, 0, 0);
    mirror.traverse((object) => {
      if (object.isMesh && object.material) {
        const originals = Array.isArray(object.material) ? object.material : [object.material];
        const clones = originals.map((material) => {
          const clone = material.clone();
          clone.name = (material.name || 'vault') + '-mirror';
          if (clone.color) clone.color.multiplyScalar(REFLECTION.colorScale);
          if (clone.emissive) clone.emissive.multiplyScalar(REFLECTION.emissiveScale);
          if (typeof clone.envMapIntensity === 'number') clone.envMapIntensity *= REFLECTION.envScale;
          clone.side = THREE.DoubleSide;
          clone.depthWrite = true;
          this.mirrorMaterials.push(clone);
          return clone;
        });
        object.material = Array.isArray(object.material) ? clones : clones[0];
      }
    });
    mirror.renderOrder = 0;
    this.scene.add(mirror);
    this.mirrorGroup = mirror;
    // The clone has its own meshes; keep them in the same traversal order as the
    // source so the reflection can follow the door/bars animation every frame.
    this.mirrorSources = [];
    this.model.root.traverse((object) => {
      if (object.isMesh) this.mirrorSources.push(object);
    });
    this.mirrorTargets = [];
    mirror.traverse((object) => {
      if (object.isMesh) this.mirrorTargets.push(object);
    });
    this.syncMirror();
  }

  /** Copy the animated pose (and bar fade) of every mesh onto its mirrored twin. */
  syncMirror() {
    const count = Math.min(this.mirrorSources.length, this.mirrorTargets.length);
    for (let index = 0; index < count; index += 1) {
      const source = this.mirrorSources[index];
      const target = this.mirrorTargets[index];
      target.position.copy(source.position);
      target.quaternion.copy(source.quaternion);
      target.scale.copy(source.scale);
      target.visible = source.visible !== false;
      const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material];
      const targetMaterials = Array.isArray(target.material) ? target.material : [target.material];
      for (let slot = 0; slot < Math.min(sourceMaterials.length, targetMaterials.length); slot += 1) {
        const from = sourceMaterials[slot];
        const to = targetMaterials[slot];
        if (from && to && typeof from.opacity === 'number' && typeof to.opacity === 'number') {
          to.opacity = from.opacity;
        }
      }
    }
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
    this.syncMirror();
    this.final = final;
    this.requestRender();
  }

  /** Apply the exact pose for animation.elapsed (door opening + bar reveal). */
  applyCurrentFrame() {
    const elapsed = this.animation.elapsed;
    const doorProgress = MODEL.getDoorProgress(elapsed);
    const barsElapsed = Math.min(elapsed, MODEL.ANIMATION_SPEC.barTotalMs);
    MODEL.applyAnimationFrame(this.model, { doorProgress, barsElapsedMs: barsElapsed });
    this.syncMirror();
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
    this.syncMirror();
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
    const safeFrontZ = this.model.spec.depth / 2;
    const safeBackZ = -this.model.spec.depth / 2;
    const positions = this.model.bars.map((bar) => ({
      index: bar.index,
      side: bar.side,
      order: bar.order,
      top: round(bar.top, 3),
      length: round(bar.length, 3),
      final: {
        x: round(bar.final.position.x, 3),
        y: round(bar.final.position.y, 3),
        z: round(bar.final.position.z, 3),
      },
      startZ: round(bar.start.position.z, 3),
      position: {
        x: round(bar.mesh.position.x, 3),
        y: round(bar.mesh.position.y, 3),
        z: round(bar.mesh.position.z, 3),
      },
      opacity: round(bar.material.opacity, 3),
      visible: bar.mesh.visible !== false,
    }));
    const right = positions.filter((bar) => bar.side === 'right');
    const left = positions.filter((bar) => bar.side === 'left');
    const order = this.model.revealOrder.slice();
    const topsByOrder = order.map((index) => this.model.bars[index].top);
    const rightMinZ = Math.min(...right.map((bar) => bar.final.z));
    const leftMaxZ = Math.max(...left.map((bar) => bar.final.z));
    return {
      count: BAR_COUNT,
      rightCount: right.length,
      leftCount: left.length,
      expandedProgress: round(expanded, 4),
      condensedProgress: round(1 - expanded, 4),
      visibleCount: positions.filter((bar) => bar.visible).length,
      order,
      bars: positions,
      sides: {
        right: {
          flank: 'front',
          count: right.length,
          startX: round(right[0] ? right[0].final.x : 0, 3),
          endX: round(right[right.length - 1] ? right[right.length - 1].final.x : 0, 3),
          zRange: [
            round(Math.min(...right.map((bar) => bar.final.z)), 3),
            round(Math.max(...right.map((bar) => bar.final.z)), 3),
          ],
          topStart: round(right[0] ? right[0].top : 0, 3),
          topEnd: round(right[right.length - 1] ? right[right.length - 1].top : 0, 3),
        },
        left: {
          flank: 'back',
          count: left.length,
          startX: round(left[0] ? left[0].final.x : 0, 3),
          endX: round(left[left.length - 1] ? left[left.length - 1].final.x : 0, 3),
          zRange: [round(Math.min(...left.map((bar) => bar.final.z)), 3), round(leftMaxZ, 3)],
          topStart: round(left[0] ? left[0].top : 0, 3),
          topEnd: round(left[left.length - 1] ? left[left.length - 1].top : 0, 3),
        },
      },
      layering: {
        safeFrontZ: round(safeFrontZ, 3),
        safeBackZ: round(safeBackZ, 3),
        rightMinZ: round(rightMinZ, 3),
        leftMaxZ: round(leftMaxZ, 3),
        rightInFront: right.every((bar) => bar.final.z > safeFrontZ),
        leftBehind: left.every((bar) => bar.final.z < safeBackZ),
        frontGap: round(rightMinZ - safeFrontZ, 3),
        backGap: round(safeBackZ - leftMaxZ, 3),
      },
      reveal: {
        doorDurationMs: MODEL.ANIMATION_SPEC.doorDurationMs,
        barDurationMs: MODEL.ANIMATION_SPEC.barDurationMs,
        barStaggerMs: MODEL.ANIMATION_SPEC.barStaggerMs,
        barTotalMs: MODEL.ANIMATION_SPEC.barTotalMs,
        totalMs: MODEL.ANIMATION_SPEC.totalMs,
        firstBar: order[0],
        lastBar: order[order.length - 1],
        firstBarTop: round(topsByOrder[0], 3),
        lastBarTop: round(topsByOrder[topsByOrder.length - 1], 3),
        bottomMostFirst: topsByOrder.every((top, index) => index === 0 || top >= topsByOrder[index - 1]),
        simultaneousWithDoor: true,
      },
      tones: MODEL.BAR_TONES.map((tone) => tone.name),
      gradient: 'steel -> cobalt (procedural DataTexture, no baked reflection)',
      advance: MODEL.BAR_SPEC.advance,
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
    const box = new THREE.Box3();
    this.model.root.updateMatrixWorld(true);
    box.setFromObject(this.model.root, true);
    if (!Number.isFinite(box.min.x)) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const world = new THREE.Vector3();
    const projected = new THREE.Vector3();
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
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
    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
    }
    for (const material of this.mirrorMaterials) material.dispose();
    this.mirrorMaterials = [];
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
    safe: studio ? studio.getSafetyDebug() : null,
    bars: studio
      ? studio.getBarDebug()
      : {
          count: BAR_COUNT,
          rightCount: MODEL.BAR_SPEC.rightCount,
          leftCount: MODEL.BAR_SPEC.leftCount,
          expandedProgress: 0,
          condensedProgress: 1,
          visibleCount: 0,
        },
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
          barRight: MODEL.BAR_SPEC.rightCount,
          barLeft: MODEL.BAR_SPEC.leftCount,
          lights: { directional: 3, ambient: 1 },
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
            rightCount: MODEL.BAR_SPEC.rightCount,
            leftCount: MODEL.BAR_SPEC.leftCount,
            material: 'MeshStandardMaterial per bar, procedural DataTexture gradient, animated opacity, no baked reflection',
          },
        }
      : null,
    model: {
      version: MODEL.MODEL_VERSION,
      spec: MODEL.VAULT_SPEC,
      barSpec: MODEL.BAR_SPEC,
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
