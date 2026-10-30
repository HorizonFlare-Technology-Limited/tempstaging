/**
 * tekoanimation — paper plane preview controller.
 *
 * Standalone collection page controller for `paperplane.html` (docs/paperplane.md):
 * a light editorial three.js studio showing one paper plane rebuilt as three
 * closed silver "paper-fibre" metal solids — a left wing polyhedron, a right wing
 * polyhedron and a V-section fuselage column with a V groove cut along its spine —
 * surfaced with seeded blue speckles. The model comes from ./paperplane-model.js
 * (geometry and procedural maps); this file owns the renderer, the fixed playful
 * three-quarter camera with a slight roll, the env-room photograph (the only
 * light source: no THREE lights, no studio box), the
 * gentle idle float/rock, the drag-to-orbit controls, the QA hooks and the
 * fallback.
 *
 * Camera: fixed -136° / 24° three-quarter with a -14° roll, numerically fitted to
 * the plane's silhouette at every stage aspect (1440x900 / 1200x900 / 390x844).
 *
 * Modes:
 *   default            gentle deterministic idle float (drag to orbit)
 *   ?still=1           frozen pose, no float (orbit allowed)
 *   ?shot=1            frozen pose, controls disabled (deterministic capture)
 *   reduced motion     frozen pose, no float
 *
 * QA hook: window.__tekoPaperplane = { ready, errors, resetView, setFloat,
 * getFloat, debug } plus body[data-qa-*] attributes and the hidden #qa-diag mirror.
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { applyEnvRoom } from './env-room.js';
import {
  CAMERA_SPEC,
  IDLE_SPEC,
  MATERIAL_SPEC,
  MODEL_VERSION,
  PLANE_SPEC,
  SURFACE_SPEC,
  applyIdlePose,
  createPaperPlane,
  idlePose,
} from './paperplane-model.js';

const VERSION = '2.0.0';
const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
const DEG = Math.PI / 180;

const CAMERA = CAMERA_SPEC;

/* ------------------------------------------------------------ render tuning */

const RENDERER = Object.freeze({ exposure: 1.0, dprMax: 2 });

// Rev21 lighting contract: the page has no THREE lights and no procedural studio
// box. `assets/env/modern-empty-room.jpg` is PMREM-filtered by ./env-room.js and
// becomes the scene's only environment; the retired studio box was much brighter
// than this room photo, so the intensity multiplier stays high.
const ROOM = Object.freeze({
  intensity: 3.8,
  label: 'assets/env/modern-empty-room.jpg (PMREM, env-room)',
});

const SHADOW = Object.freeze({ width: 3.3, depth: 2.5, opacity: 0.27, y: -0.44 });

/* ------------------------------------------------------------- early qa state */

const qa = IS_BROWSER
  ? (window.__TEKO_PLANE_QA = window.__TEKO_PLANE_QA || { errors: [], warnings: [], webgl: null })
  : { errors: [], warnings: [], webgl: null };
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];

function pushError(message) {
  qa.errors.push('paperplane-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}

function pushWarning(message) {
  qa.warnings.push('paperplane-preview: ' + message);
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
  reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches),
  float: true,
  floatTouched: false,
  watchdog: 0,
};

function motionAllowed() {
  return !state.still && !state.shot && !state.reducedMotion;
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
  dom.floatToggle = byId('float-toggle');
  dom.reset = byId('reset');
  dom.status = byId('studio-status');
  dom.specMetalness = byId('spec-metalness');
  dom.specRoughness = byId('spec-roughness');
  dom.specSpeckles = byId('spec-speckles');
  dom.specGeometry = byId('spec-geometry');
  dom.specCamera = byId('spec-camera');
  dom.specMotion = byId('spec-motion');
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

function syncUi() {
  const animated = motionAllowed() && state.float;
  if (dom.floatToggle) {
    const disabled = !motionAllowed() || state.failed || !state.ready;
    dom.floatToggle.disabled = disabled;
    dom.floatToggle.setAttribute('aria-pressed', String(animated));
    const label = dom.floatToggle.querySelector('span');
    if (label) label.textContent = animated ? 'ON' : 'OFF';
  }
  if (dom.specMotion) {
    dom.specMotion.textContent = animated ? '0.2 Hz float · on' : state.failed ? '—' : 'float · paused';
  }
  if (dom.specCamera) {
    dom.specCamera.textContent = CAMERA.azimuthDeg + '° / ' + CAMERA.elevationDeg + '° · ' + Math.abs(CAMERA.rollDeg) + '° roll';
  }
  if (dom.status) {
    dom.status.textContent = state.failed
      ? 'Static preview'
      : !state.ready
        ? 'Preparing the fold'
        : animated
          ? 'Float on · drag to orbit'
          : 'Float paused · drag to orbit';
  }
}

function syncModelFacts() {
  const model = state.model;
  if (!model) return;
  const effective = effectiveSurface();
  if (dom.specMetalness) dom.specMetalness.textContent = effective.metalness.toFixed(2);
  if (dom.specRoughness) dom.specRoughness.textContent = effective.roughness.toFixed(2);
  if (dom.specSpeckles) dom.specSpeckles.textContent = model.stats.panels + ' panels / ' + model.stats.creases + ' creases';
  if (dom.specGeometry) {
    dom.specGeometry.textContent = model.stats.triangles.toLocaleString('en-US') + ' tris · ' + model.stats.vertices.toLocaleString('en-US') + ' verts';
  }
}

/** Publish body[data-qa-*] + the hidden JSON diagnostic mirror. */
function publishState() {
  if (!IS_BROWSER) return;
  const body = dom.body || document.body;
  const studio = state.studio;
  const camera = studio ? studio.getCameraDebug() : null;
  const objectRect = studio ? studio.getObjectScreenRect() : null;
  body.dataset.qaReady = state.ready ? '1' : '0';
  body.dataset.qaErrors = String(qa.errors.length);
  body.dataset.qaWarnings = String(qa.warnings.length);
  body.dataset.qaWebgl = state.webgl ? '1' : '0';
  body.dataset.fallback = state.failed ? '1' : '0';
  body.dataset.qaFallback = state.failed ? '1' : '0';
  body.dataset.qaStill = state.still ? '1' : '0';
  body.dataset.qaShot = state.shot ? '1' : '0';
  body.dataset.qaReducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.qaFloat = motionAllowed() && state.float ? '1' : '0';
  body.dataset.qaCamera = camera ? round(camera.azimuthDeg, 1) + ',' + round(camera.elevationDeg, 1) : '';
  body.dataset.qaRoll = camera ? String(round(camera.rollDeg, 1)) : '';
  body.dataset.qaDistance = camera ? String(round(camera.distance, 3)) : '';
  body.dataset.qaObjectRect = objectRect
    ? [objectRect.left, objectRect.top, objectRect.width, objectRect.height].map((value) => String(round(value, 1))).join(',')
    : '';
  body.dataset.qaVertices = state.model ? String(state.model.stats.vertices) : '0';
  body.dataset.qaTriangles = state.model ? String(state.model.stats.triangles) : '0';
  body.dataset.qaSpeckles = state.model ? String(state.model.maps.speckles) : '0';
  const surface = effectiveSurface();
  body.dataset.qaMetalness = surface.metalness.toFixed(2);
  body.dataset.qaRoughness = surface.roughness.toFixed(2);
  body.dataset.qaModel = MODEL_VERSION;
  body.dataset.still = state.still ? '1' : '0';
  body.dataset.shot = state.shot ? '1' : '0';
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

class PaperPlaneStudio {
  constructor({ renderer, canvas, stage, model, reducedMotion: reduced, still, shot }) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.stage = stage;
    this.model = model;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.room = null;
    this.shadow = null;
    this.stageBox = { width: 0, height: 0 };
    this.cameraTarget = new THREE.Vector3();
    this.cameraDistance = 0;
    this.baseView = null;
    this.renderCount = 0;
    this.firstFrameRendered = false;
    this.firstFrameResolve = null;
    this.needsRender = true;
    this.raf = 0;
    this.lastTime = 0;
    this.destroyed = false;
    this.idleTime = 0;
    this.settle = 0;
    this.reducedMotion = Boolean(reduced);
    this.still = Boolean(still);
    this.shot = Boolean(shot);
    this.resizeObserver = null;
  }

  motionAllowed() {
    return !this.still && !this.shot && !this.reducedMotion;
  }

  async init() {
    const scene = new THREE.Scene();
    scene.name = 'paperplane-studio';
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.5, CAMERA.near, CAMERA.far);
    camera.name = 'paperplane-camera';
    // OrbitControls caches its up-axis quaternion when it is constructed, so the
    // rolled studio up must be on the camera before the controls exist.
    camera.up.copy(this.viewBasis().rolledUp);
    this.camera = camera;

    // Rev21: the room photograph is the only light source (PMREM via env-room).
    this.room = await applyEnvRoom(THREE, this.renderer, scene, { intensity: ROOM.intensity });

    this.buildShadow();
    scene.add(this.model.root);
    this.model.root.position.set(0, 0, 0);
    this.model.root.rotation.set(0, 0, 0);
    // r151: materials added above need the intensity walked over them.
    this.room.refresh(scene);

    const controls = new OrbitControls(camera, this.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.55;
    controls.minPolarAngle = 20 * DEG;
    controls.maxPolarAngle = 84 * DEG;
    controls.addEventListener('change', () => this.requestRender());
    controls.enabled = !this.shot;
    this.controls = controls;

    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    if (this.resizeObserver) this.resizeObserver.observe(this.stage);
    else window.addEventListener('resize', () => this.resize());
    this.resize();

    this.loop = this.loop.bind(this);
    if (!this.shot) this.raf = window.requestAnimationFrame(this.loop);
    return this;
  }

  buildShadow() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(60, 72, 88, 0.2)');
    gradient.addColorStop(0.36, 'rgba(60, 72, 88, 0.12)');
    gradient.addColorStop(0.7, 'rgba(60, 72, 88, 0.035)');
    gradient.addColorStop(1, 'rgba(60, 72, 88, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'paperplane-contact-shadow';
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, opacity: SHADOW.opacity });
    const geometry = new THREE.PlaneGeometry(SHADOW.width, SHADOW.depth);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'paperplane-contact-shadow';
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = SHADOW.y;
    mesh.renderOrder = -1;
    this.scene.add(mesh);
    this.shadow = mesh;
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

  /* ----------------------------------------------------------- camera fit */

  viewBasis() {
    const az = CAMERA.azimuthDeg * DEG;
    const el = CAMERA.elevationDeg * DEG;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const rolledUp = new THREE.Vector3(0, 1, 0);
    rolledUp.addScaledVector(dir, -rolledUp.dot(dir)).normalize();
    rolledUp.applyAxisAngle(dir, CAMERA.rollDeg * DEG);
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
    if (!this.camera || !this.model) return;
    const basis = this.viewBasis();
    const points = this.model.fitPoints;
    const aspect = (this.stageBox.width || 1) / (this.stageBox.height || 1);
    const narrow = (this.stageBox.width || 0) < CAMERA.narrowStageWidth;
    const fitMargin = narrow ? CAMERA.fitMarginNarrow : CAMERA.fitMargin;
    const tanHalf = Math.tan(CAMERA.fov * DEG / 2);
    const maxX = fitMargin * tanHalf * aspect;
    const maxY = fitMargin * tanHalf;
    const target = new THREE.Vector3(0, 0, 0);
    const probe = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
    probe.up.copy(basis.rolledUp);
    const projected = new THREE.Vector3();
    let distance = 0.01;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      distance = this.solveFitDistance(target, basis, maxX, maxY, points);
      probe.position.copy(target).addScaledVector(basis.dir, distance);
      probe.lookAt(target);
      probe.updateMatrixWorld(true);
      probe.updateProjectionMatrix();
      let minX = Infinity;
      let maxXv = -Infinity;
      let minY = Infinity;
      let maxYv = -Infinity;
      for (let index = 0; index < points.length; index += 3) {
        projected.set(points[index], points[index + 1], points[index + 2]).project(probe);
        minX = Math.min(minX, projected.x);
        maxXv = Math.max(maxXv, projected.x);
        minY = Math.min(minY, projected.y);
        maxYv = Math.max(maxYv, projected.y);
      }
      const centerX = (minX + maxXv) / 2;
      const centerY = (minY + maxYv) / 2;
      if (Math.abs(centerX) < 0.0005 && Math.abs(centerY) < 0.0005) break;
      target.addScaledVector(basis.up, centerY * distance * tanHalf);
      target.addScaledVector(basis.right, centerX * distance * tanHalf * aspect);
    }
    distance = this.solveFitDistance(target, basis, maxX, maxY, points);
    distance = clamp(distance, 0.5, CAMERA.far * 0.7);
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
    this.baseView = { target: target.clone(), distance, basis };
    if (this.controls) {
      this.controls.target.copy(target);
      const offset = this.camera.position.clone().sub(target);
      const spherical = new THREE.Spherical().setFromVector3(offset.clone().applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0)),
      ));
      const basePolar = spherical.phi;
      const baseTheta = spherical.theta;
      this.controls.minDistance = distance * 0.72;
      this.controls.maxDistance = distance * 1.6;
      this.controls.minPolarAngle = Math.max(0.15, basePolar - 0.42);
      this.controls.maxPolarAngle = Math.min(Math.PI - 0.18, basePolar + 0.5);
      const margin = 0.8;
      if (baseTheta > Math.PI - margin) {
        this.controls.minAzimuthAngle = baseTheta - margin;
        this.controls.maxAzimuthAngle = Math.PI;
      } else if (baseTheta < -Math.PI + margin) {
        this.controls.minAzimuthAngle = -Math.PI;
        this.controls.maxAzimuthAngle = baseTheta + margin;
      } else {
        this.controls.minAzimuthAngle = baseTheta - margin;
        this.controls.maxAzimuthAngle = baseTheta + margin;
      }
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

  /* -------------------------------------------------------------- motion */

  applyPose(pose) {
    applyIdlePose(this.model.root, pose);
    this.needsRender = true;
  }

  resetPose() {
    this.idleTime = 0;
    this.settle = 0;
    applyIdlePose(this.model.root, { float: 0, pitchDeg: 0, rollDeg: 0, yawDeg: 0 });
    this.needsRender = true;
  }

  updateIdle(dt) {
    if (!this.motionAllowed() || !state.float) return;
    this.idleTime += dt;
    this.settle = Math.min(1, this.settle + dt * 1000 / IDLE_SPEC.settleMs);
    const pose = idlePose(this.idleTime, this.settle);
    applyIdlePose(this.model.root, pose);
    this.needsRender = true;
  }

  loop(now) {
    if (this.destroyed) return;
    this.raf = window.requestAnimationFrame(this.loop);
    const previous = this.lastTime || now;
    const dtMs = Math.min(64, Math.max(0, now - previous));
    this.lastTime = now;
    this.updateIdle(dtMs / 1000);
    if (this.controls && this.controls.enabled) {
      const changed = this.controls.update();
      if (changed) this.needsRender = true;
    } else if (this.controlsChanged) {
      }
    if (this.needsRender) this.renderFrame();
  }

  /* --------------------------------------------------------------- debug */

  getCameraDebug() {
    if (!this.camera) return null;
    const direction = new THREE.Vector3().subVectors(this.camera.position, this.cameraTarget).normalize();
    const azimuthDeg = Math.atan2(direction.x, direction.z) / DEG;
    const elevationDeg = Math.asin(clamp(direction.y, -1, 1)) / DEG;
    return {
      azimuthDeg: round(azimuthDeg, 2),
      elevationDeg: round(elevationDeg, 2),
      rollDeg: CAMERA.rollDeg,
      distance: round(this.camera.position.distanceTo(this.cameraTarget), 3),
      fov: CAMERA.fov,
      near: CAMERA.near,
      far: CAMERA.far,
      aspect: round(this.camera.aspect, 4),
      position: [round(this.camera.position.x, 3), round(this.camera.position.y, 3), round(this.camera.position.z, 3)],
      target: [round(this.cameraTarget.x, 3), round(this.cameraTarget.y, 3), round(this.cameraTarget.z, 3)],
      nominalAzimuthDeg: CAMERA.azimuthDeg,
      nominalElevationDeg: CAMERA.elevationDeg,
      fitMargin: (this.stageBox.width || 0) < CAMERA.narrowStageWidth ? CAMERA.fitMarginNarrow : CAMERA.fitMargin,
      narrowStage: (this.stageBox.width || 0) < CAMERA.narrowStageWidth,
    };
  }

  getObjectScreenRect() {
    if (!this.camera || !this.model) return null;
    const width = this.stageBox.width || 1;
    const height = this.stageBox.height || 1;
    const points = this.model.fitPoints;
    const root = this.model.root;
    root.updateMatrixWorld(true);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const world = new THREE.Vector3();
    const projected = new THREE.Vector3();
    for (let index = 0; index < points.length; index += 3) {
      world.set(points[index], points[index + 1], points[index + 2]).applyMatrix4(root.matrixWorld).project(this.camera);
      const px = (world.x * 0.5 + 0.5) * width;
      const py = (1 - (world.y * 0.5 + 0.5)) * height;
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

  getMaterialDebug() {
    const material = this.model.material;
    const surface = effectiveSurface(this.model);
    const fuselageMaterial = this.model.fuselage.material;
    const textures = this.model.textures;
    return {
      wing: {
        type: material.type,
        metalness: material.metalness,
        roughness: material.roughness,
        clearcoat: material.clearcoat,
        clearcoatRoughness: material.clearcoatRoughness,
        bumpScale: material.bumpScale,
        envMapIntensity: material.envMapIntensity,
        color: '#' + material.color.getHexString(),
        maps: {
          map: Boolean(material.map),
          roughnessMap: Boolean(material.roughnessMap),
          metalnessMap: Boolean(material.metalnessMap),
          bumpMap: Boolean(material.bumpMap),
        },
      },
      transmission: {
        transmission: round(material.transmission, 3),
        thickness: round(material.thickness, 3),
        ior: round(material.ior, 3),
        attenuationColor: '#' + material.attenuationColor.getHexString(),
        attenuationDistance: round(material.attenuationDistance, 3),
        emissive: '#' + material.emissive.getHexString(),
        emissiveIntensity: round(material.emissiveIntensity, 3),
      },
      effective: {
        metalness: round(surface.metalness, 4),
        roughness: round(surface.roughness, 4),
        roughnessMapMean: round(this.model.maps.roughnessMean, 4),
        metalnessMapMean: round(this.model.maps.metalnessMean, 4),
      },
      fuselage: {
        color: '#' + fuselageMaterial.color.getHexString(),
        metalness: fuselageMaterial.metalness,
        roughness: fuselageMaterial.roughness,
        envMapIntensity: fuselageMaterial.envMapIntensity,
        transmission: round(fuselageMaterial.transmission, 3),
      },
      edgeGlow: null, // Rev21 s18: gold edge removed
      glow: this.model.glow ? {
        kind: 'additive gold halo sprite (material emission, no light)',
        color: '#' + this.model.glow.material.color.getHexString(),
        opacity: round(this.model.glow.material.opacity, 3),
        additive: this.model.glow.material.blending === THREE.AdditiveBlending,
      } : null,
      textures: null,
      speckles: 0,
      seed: this.model.maps.seed,
      folded: {
        panels: this.model.stats.panels,
        creases: this.model.stats.creases,
        style: 'classic-dart',
      },
      surface: SURFACE_SPEC,
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
    if (this.shadow) {
      this.scene.remove(this.shadow);
      this.shadow.geometry.dispose();
      if (this.shadow.material.map) this.shadow.material.map.dispose();
      this.shadow.material.dispose();
      this.shadow = null;
    }
    if (this.room) {
      this.room.dispose();
      this.room = null;
    }
    if (this.scene) {
      this.scene.remove(this.model.root);
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

function createCanvasFactory() {
  return (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
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
  resetView() {
    if (!state.studio || state.failed) return false;
    state.studio.resetView();
    announce('View reset');
    return true;
  },
  setFloat(on) {
    if (!state.studio || state.failed) return false;
    if (!motionAllowed()) {
      state.float = false;
      syncUi();
      publishState();
      return false;
    }
    state.float = Boolean(on);
    state.floatTouched = true;
    if (!state.float) state.studio.resetPose();
    syncUi();
    publishState();
    announce(state.float ? 'Idle float on' : 'Idle float paused');
    return state.float;
  },
  getFloat() {
    return Boolean(state.float && motionAllowed());
  },
  debug: () => buildDebug(),
  waitForReady() {
    return readyPromise;
  },
};
if (IS_BROWSER) window.__tekoPaperplane = api;

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

function effectiveSurface(model = state.model) {
  const maps = model && model.maps ? model.maps : null;
  const roughnessMean = maps && Number.isFinite(maps.roughnessMean) ? maps.roughnessMean : 1;
  const metalnessMean = maps && Number.isFinite(maps.metalnessMean) ? maps.metalnessMean : 1;
  return {
    metalness: MATERIAL_SPEC.metalness * metalnessMean,
    roughness: MATERIAL_SPEC.roughness * roughnessMean,
  };
}

function buildDebug() {
  const studio = state.studio;
  const debug = {
    version: VERSION,
    ready: Boolean(state.ready),
    errors: qa.errors.slice(),
    warnings: qa.warnings.slice(),
    webgl: { supported: Boolean(state.webgl), version: state.webgl || '' },
    lights: [],
    environment: ROOM.label,
    flags: {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      qaMode: Boolean(state.qaMode),
      reducedMotion: Boolean(state.reducedMotion),
      float: Boolean(state.float && motionAllowed()),
      fallback: Boolean(state.failed),
      motion: motionAllowed() ? 'animated' : 'static',
    },
    model: state.model
      ? {
          version: MODEL_VERSION,
          folded: Boolean(state.model.folded),
          panels: state.model.panels,
          creases: state.model.creases,
          keelProfile: keelProfile(state.model),
          goldEdgeMeshes: 0,
          material: {
            type: 'MeshPhysicalMaterial',
            color: '#' + state.model.material.color.getHexString(),
            metalness: state.model.material.metalness,
            roughness: state.model.material.roughness,
            transmission: state.model.material.transmission,
            thickness: state.model.material.thickness,
            ior: state.model.material.ior,
            attenuationColor: '#' + state.model.material.attenuationColor.getHexString(),
            attenuationDistance: state.model.material.attenuationDistance,
            emissive: '#' + state.model.material.emissive.getHexString(),
            emissiveIntensity: state.model.material.emissiveIntensity,
            maps: {
              map: Boolean(state.model.material.map),
              roughnessMap: Boolean(state.model.material.roughnessMap),
              metalnessMap: Boolean(state.model.material.metalnessMap),
              bumpMap: Boolean(state.model.material.bumpMap),
            },
          },
          spec: {
            noseZ: PLANE_SPEC.noseZ,
            tailZ: PLANE_SPEC.tailZ,
            halfSpan: PLANE_SPEC.halfSpan,
            fuselage: PLANE_SPEC.fuselage,
            wing: PLANE_SPEC.wing,
          },
          stats: state.model.stats,
          bounds: state.model.bounds,
          pose: {
            position: [round(state.model.root.position.x, 4), round(state.model.root.position.y, 4), round(state.model.root.position.z, 4)],
            rotationDeg: [
              round(state.model.root.rotation.x / DEG, 3),
              round(state.model.root.rotation.y / DEG, 3),
              round(state.model.root.rotation.z / DEG, 3),
            ],
          },
        }
      : null,
    materials: studio ? studio.getMaterialDebug() : null,
    camera: studio ? studio.getCameraDebug() : null,
    objectRect: studio ? studio.getObjectScreenRect() : null,
    render: studio ? studio.getRenderDebug() : null,
    idle: {
      amplitude: IDLE_SPEC.floatAmplitude,
      periods: [IDLE_SPEC.floatPeriod, IDLE_SPEC.driftPeriod],
      pitchDeg: IDLE_SPEC.pitchDeg,
      rollDeg: IDLE_SPEC.rollDeg,
      yawDeg: IDLE_SPEC.yawDeg,
    },
    page: {
      url: IS_BROWSER ? window.location.href : '',
      viewport: IS_BROWSER
        ? { width: window.innerWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth }
        : null,
      stageRect: studio
        ? { width: studio.stageBox.width, height: studio.stageBox.height }
        : null,
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
  dom.body.dataset.fallback = '0';
  dom.body.dataset.qaReady = '0';
  if (state.still) dom.body.dataset.still = '1';
  if (state.shot) dom.body.dataset.shot = '1';
  if (state.reducedMotion) dom.body.dataset.reducedMotion = '1';
  syncUi();
  publishState();

  const glVersion = probeWebGL();
  state.webgl = glVersion;
  qa.webgl = glVersion;
  if (!glVersion) {
    showFallback('WebGL is unavailable in this browser, so the interactive folded paper plane cannot be rendered. A static poster of the classic folded dart is shown.');
    resolveReady(false);
    return;
  }
  if (dom.veilText) dom.veilText.textContent = 'Rendering the folded paper plane';

  renderer = createRenderer();
  if (!renderer) {
    showFallback('The WebGL renderer could not start, so a static poster of the paper plane is shown.');
    resolveReady(false);
    return;
  }

  const contextLost = (event) => {
    event.preventDefault();
    showFallback('The WebGL context was lost, so a static poster of the paper plane is shown.');
    resolveReady(false);
  };
  dom.canvas.addEventListener('webglcontextlost', contextLost, false);

  // Let the loading veil paint before the procedural map generation blocks.
  await new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    else resolve();
  });
  if (dom.veilText) dom.veilText.textContent = 'Folding the paper panels';

  let model = null;
  try {
    model = createPaperPlane({
      createCanvas: createCanvasFactory(),
      anisotropy: renderer.capabilities.getMaxAnisotropy(),
    });
    state.model = model;
  } catch (error) {
    showFallback('The paper-plane model could not be built (' + errorMessage(error) + '). A static poster is shown.', { error, banner: true });
    resolveReady(false);
    return;
  }

  try {
    state.studio = new PaperPlaneStudio({
      renderer,
      canvas: dom.canvas,
      stage: dom.stage,
      model,
      reducedMotion: state.reducedMotion,
      still: state.still,
      shot: state.shot,
    });
    await state.studio.init();
  } catch (error) {
    if (state.studio) {
      try {
        state.studio.dispose();
      } catch (disposeError) {
        /* best effort */
      }
      state.studio = null;
    }
    showFallback('The three.js studio could not start (' + errorMessage(error) + '). A static poster is shown.', { error, banner: true });
    resolveReady(false);
    return;
  }

  const studio = state.studio;
  studio.resetPose();
  studio.fitCamera();
  studio.renderNow();
  await studio.whenFirstFrame();
  studio.renderNow();

  // Deterministic modes: no idle float, and ?shot=1 also freezes controls.
  if (!motionAllowed()) {
    state.float = false;
    studio.resetPose();
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
  dom.body.dataset.qaReady = '1';
  syncUi();
  publishState();
  announce('Paper plane ready');
  // A late layout pass (scrollbars / font swap) must not leave a stale frame.
  window.setTimeout(() => {
    if (!state.studio || state.failed) return;
    state.studio.resize();
    state.studio.renderNow();
    publishState();
  }, 220);
  resolveReady(true);
  studio.bootMs = Math.round(performance.now() - started);
}

/* --------------------------------------------------------------------- ui */

function wireUi() {
  if (dom.floatToggle) {
    dom.floatToggle.addEventListener('click', () => {
      api.setFloat(!state.float);
    });
  }
  if (dom.reset) {
    dom.reset.addEventListener('click', () => api.resetView());
  }
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (event.key === 'r' || event.key === 'R') api.resetView();
    if (event.key === 'f' || event.key === 'F') api.setFloat(!state.float);
  });
  if (reducedMotionQuery) {
    const onChange = (event) => {
      state.reducedMotion = Boolean(event.matches);
      if (state.studio) state.studio.reducedMotion = state.reducedMotion;
      if (state.reducedMotion && state.studio) {
        state.studio.resetPose();
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
      showFallback('The paper-plane preview failed to start (' + errorMessage(error) + '). A static poster is shown.', { error, banner: true });
    }
    resolveReady(false);
  });
  state.watchdog = window.setTimeout(() => {
    if (!state.ready && !state.failed) {
      showFallback('The interactive preview did not start within 20 seconds. A static poster is shown.', { banner: true });
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
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    if (state.model) state.model = null;
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

export { VERSION, PaperPlaneStudio };

/** Rev21 s18: keel (bottom triangle) vertical thickness at its nose end vs tail end. */
function keelProfile(model) {
  const position = model.keel.geometry.attributes.position;
  const ys = [];
  const zs = [];
  for (let i = 0; i < position.count; i += 1) {
    ys.push(position.getY(i));
    zs.push(position.getZ(i));
  }
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const band = (zMax - zMin) * 0.12;
  const thick = (lo, hi) => {
    const sel = ys.filter((_, i) => zs[i] >= lo && zs[i] <= hi);
    return sel.length ? Math.max(...sel) - Math.min(...sel) : 0;
  };
  // vertex-based: the nose tip is a single vertex (thickness 0), the rear has the full depth
  return {
    noseZ: round(zMax, 3),
    tailZ: round(zMin, 3),
    noseThickness: round(thick(zMax - 1e-6, zMax), 3),
    tailThickness: round(thick(zMin, zMin + band * 2.5), 3),
  };
}
