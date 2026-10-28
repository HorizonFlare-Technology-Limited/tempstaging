/**
 * brandplate-preview.js — PROVISIONAL silver brand square plate page (Rev15 R15-4).
 *
 * Renders 5 thick silver-satin square plates with a black-mirror-metal middle
 * frame (same finish family as the Rev15 black card) and the local TEKO brand
 * logo. The plates start in an evenly spaced upright row and gather from RIGHT
 * to LEFT into a shingled stack (right plate on top / nearest camera, left
 * plates behind). ~3 s deterministic eased animation with replay + autoplay.
 *
 * The composition math comes from ./brandplate-model.js (pure/deterministic);
 * this module owns the three.js scene, materials, animation loop, UI and QA API.
 * Reference images for the plate were not supplied, so the page is provisional.
 */
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import {
  BRANDPLATE,
  brandplatePose,
  cameraFit,
} from './brandplate-model.js';

const PARAMS = new URLSearchParams(window.location.search);
const PROVISIONAL = BRANDPLATE.provisional;
const DURATION = BRANDPLATE.layout.durationSeconds;
const PLATE = BRANDPLATE.plate;
const FRAME = BRANDPLATE.frame;
const LOGO = BRANDPLATE.logo;
const SILVER = BRANDPLATE.silver;
const MIRROR = BRANDPLATE.blackMirror;

const errors = [];
const state = {
  time: 0,
  playing: false,
  autoplay: !isReducedMotion(),
  reducedMotion: isReducedMotion(),
  shotTime: null,
  ready: false,
  mode: PARAMS.get('mode') || 'default',
};

function isReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (error) {
    return false;
  }
}

function reportError(error) {
  const message = String((error && error.stack) || (error && error.message) || error);
  errors.push(message);
  const banner = document.getElementById('bp-error');
  if (banner) {
    banner.hidden = false;
    banner.textContent = 'Error: ' + message;
  }
  document.body.dataset.errors = String(errors.length);
  document.title = 'ERR brandplate: ' + message;
}
window.addEventListener('error', (event) => reportError(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

/* ------------------------------------------------------------------------- */
/* Renderer, scene, camera                                                   */
/* ------------------------------------------------------------------------- */

const stage = document.getElementById('bp-stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setClearColor(0x010203, 1);
renderer.shadowMap.enabled = false;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010203);
const camera = new THREE.PerspectiveCamera(BRANDPLATE.camera.fovDeg, 1, BRANDPLATE.camera.near, BRANDPLATE.camera.far);

// neutral dark studio environment (local RoomEnvironment, PMREM)
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envTarget = pmrem.fromScene(room, 0.035);
scene.environment = envTarget.texture;
room.dispose();
pmrem.dispose();

// backdrop wall + floor (neutral dark, no shadows)
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 40),
  new THREE.MeshBasicMaterial({ color: 0x05070a }),
);
backdrop.position.set(0, 4, -6.5);
scene.add(backdrop);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 40),
  new THREE.MeshBasicMaterial({ color: 0x0a0d11 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

// light rig: white key + fill + cool rim so satin silver and black mirror read
const key = new THREE.DirectionalLight(0xffffff, 1.15);
key.position.set(5, 7.5, 8);
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe6f0, 0.32);
fill.position.set(-6, 4, 6);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.85);
rim.position.set(2.5, 5.5, -7);
scene.add(rim);
const top = new THREE.DirectionalLight(0xffffff, 0.3);
top.position.set(-1, 9, 1);
scene.add(top);
const ambient = new THREE.AmbientLight(0x8892a0, 0.1);
scene.add(ambient);

/* ------------------------------------------------------------------------- */
/* Deterministic procedural silver-satin maps                                */
/* ------------------------------------------------------------------------- */

function lcg(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toTexture(canvas, srgb) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
  texture.needsUpdate = true;
  return texture;
}

function buildSilverSatinMaps(size) {
  const random = lcg(0x51e7a11);
  const albedo = makeCanvas(size, size);
  const roughness = makeCanvas(size, size);
  const bump = makeCanvas(size, size);
  const albedoCtx = albedo.getContext('2d');
  const roughnessCtx = roughness.getContext('2d');
  const bumpCtx = bump.getContext('2d');
  const albedoData = albedoCtx.createImageData(size, size);
  const roughnessData = roughnessCtx.createImageData(size, size);
  const bumpData = bumpCtx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    const row = random() * 0.22 + 0.08;
    for (let x = 0; x < size; x += 1) {
      const fine = random();
      const streak = row + fine * 0.05;
      const value = Math.min(1, 0.72 + streak * 0.2);
      const index = (y * size + x) * 4;
      albedoData.data[index] = Math.round(value * 248);
      albedoData.data[index + 1] = Math.round(value * 251);
      albedoData.data[index + 2] = Math.round(value * 255);
      albedoData.data[index + 3] = 255;
      const rough = Math.round((0.24 + streak * 0.14 + fine * 0.03) * 255);
      roughnessData.data[index] = rough;
      roughnessData.data[index + 1] = rough;
      roughnessData.data[index + 2] = rough;
      roughnessData.data[index + 3] = 255;
      const bumpValue = Math.round((0.5 + streak * 0.4) * 255);
      bumpData.data[index] = bumpValue;
      bumpData.data[index + 1] = bumpValue;
      bumpData.data[index + 2] = bumpValue;
      bumpData.data[index + 3] = 255;
    }
  }
  albedoCtx.putImageData(albedoData, 0, 0);
  roughnessCtx.putImageData(roughnessData, 0, 0);
  bumpCtx.putImageData(bumpData, 0, 0);
  return {
    map: toTexture(albedo, true),
    roughnessMap: toTexture(roughness, false),
    bumpMap: toTexture(bump, false),
  };
}

const silverMaps = buildSilverSatinMaps(512);
const silverMaterial = new THREE.MeshPhysicalMaterial({
  map: silverMaps.map,
  roughnessMap: silverMaps.roughnessMap,
  bumpMap: silverMaps.bumpMap,
  bumpScale: 0.0018,
  color: new THREE.Color(SILVER.color),
  metalness: SILVER.metalness,
  roughness: SILVER.roughness,
  clearcoat: SILVER.clearcoat,
  clearcoatRoughness: SILVER.clearcoatRoughness,
  envMapIntensity: SILVER.envMapIntensity,
  side: THREE.FrontSide,
});
silverMaterial.name = 'plate-silver-satin';

const blackMirrorMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(MIRROR.color),
  metalness: MIRROR.metalness,
  roughness: MIRROR.roughness,
  clearcoat: MIRROR.clearcoat,
  clearcoatRoughness: MIRROR.clearcoatRoughness,
  envMapIntensity: MIRROR.envMapIntensity,
  side: THREE.DoubleSide,
});
blackMirrorMaterial.name = 'plate-black-mirror-metal';

/* ------------------------------------------------------------------------- */
/* Rounded-square geometry helpers                                           */
/* ------------------------------------------------------------------------- */

function roundedRectShape(size, radius) {
  const half = size / 2;
  const r = Math.min(radius, half);
  const shape = new THREE.Shape();
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.quadraticCurveTo(half, -half, half, -half + r);
  shape.lineTo(half, half - r);
  shape.quadraticCurveTo(half, half, half - r, half);
  shape.lineTo(-half + r, half);
  shape.quadraticCurveTo(-half, half, -half, half - r);
  shape.lineTo(-half, -half + r);
  shape.quadraticCurveTo(-half, -half, -half + r, -half);
  return shape;
}

function roundedRectPath(size, radius) {
  const half = size / 2;
  const r = Math.min(radius, half);
  const path = new THREE.Path();
  path.moveTo(-half + r, -half);
  path.lineTo(half - r, -half);
  path.quadraticCurveTo(half, -half, half, -half + r);
  path.lineTo(half, half - r);
  path.quadraticCurveTo(half, half, half - r, half);
  path.lineTo(-half + r, half);
  path.quadraticCurveTo(-half, half, -half, half - r);
  path.lineTo(-half, -half + r);
  path.quadraticCurveTo(-half, -half, -half + r, -half);
  return path;
}

function buildPlateBody() {
  const depth = Math.max(0.02, PLATE.thickness - 2 * PLATE.bevel);
  const geometry = new THREE.ExtrudeGeometry(roundedRectShape(PLATE.size, PLATE.cornerRadius), {
    depth,
    bevelEnabled: true,
    bevelThickness: PLATE.bevel,
    bevelSize: PLATE.bevel,
    bevelSegments: 5,
    curveSegments: 20,
    steps: 1,
  });
  geometry.center();
  return geometry;
}

function buildFrameRing() {
  const shape = roundedRectShape(FRAME.outerSize, FRAME.cornerRadius);
  shape.holes.push(roundedRectPath(FRAME.innerSize, FRAME.cornerRadius * 0.7));
  const depth = FRAME.thickness - 0.008;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 3,
    curveSegments: 16,
    steps: 1,
  });
  geometry.center();
  return geometry;
}

/* Contact shadow sprite */
function buildContactShadowTexture(size) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.6)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.32)');
  gradient.addColorStop(0.8, 'rgba(0,0,0,0.08)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
const contactTexture = new THREE.CanvasTexture(buildContactShadowTexture(256));
contactTexture.encoding = THREE.LinearEncoding;
contactTexture.needsUpdate = true;

/* TEKO logo texture (local asset) */
const logoTexture = new THREE.TextureLoader().load(LOGO.src, () => {
  logoTexture.encoding = THREE.sRGBEncoding;
  logoTexture.anisotropy = 8;
  logoTexture.needsUpdate = true;
});
logoTexture.encoding = THREE.sRGBEncoding;
logoTexture.anisotropy = 8;

const logoMaterial = new THREE.MeshPhysicalMaterial({
  map: logoTexture,
  color: 0xffffff,
  metalness: 0.65,
  roughness: 0.3,
  clearcoat: 0.1,
  clearcoatRoughness: 0.25,
  envMapIntensity: 1.25,
  transparent: true,
  alphaTest: 0.02,
  side: THREE.DoubleSide,
});
logoMaterial.name = 'plate-teko-logo-gold';

const plateBodyGeometry = buildPlateBody();
const frameGeometry = buildFrameRing();
const logoGeometry = new THREE.PlaneGeometry(LOGO.size, LOGO.size);
const shadowGeometry = new THREE.PlaneGeometry(2.6, 1.3);

const plates = [];
for (let index = 0; index < BRANDPLATE.count; index += 1) {
  const group = new THREE.Group();
  group.name = 'brandplate-' + index;
  const body = new THREE.Mesh(plateBodyGeometry, silverMaterial);
  body.name = 'plate-body-' + index;
  group.add(body);
  const frame = new THREE.Mesh(frameGeometry, blackMirrorMaterial);
  frame.name = 'plate-frame-' + index;
  frame.position.z = PLATE.thickness / 2 + FRAME.proud - FRAME.thickness / 2 + FRAME.thickness / 2;
  frame.position.z = PLATE.thickness / 2 + FRAME.proud - 0.004;
  group.add(frame);
  const logo = new THREE.Mesh(logoGeometry, logoMaterial);
  logo.name = 'plate-logo-' + index;
  logo.position.z = PLATE.thickness / 2 + FRAME.proud + 0.004;
  group.add(logo);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: contactTexture,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.name = 'plate-shadow-' + index;
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.004;
  scene.add(shadow);
  scene.add(group);
  plates.push({ index, group, body, frame, logo, shadow, shadowMaterial });
}

/* ------------------------------------------------------------------------- */
/* Camera fit + responsive sizing                                            */
/* ------------------------------------------------------------------------- */

let lastCamera = null;

function applyCamera(width, height) {
  const fit = cameraFit(width, height);
  lastCamera = fit;
  camera.fov = fit.fovDeg;
  camera.aspect = width / height;
  camera.near = fit.near;
  camera.far = fit.far;
  camera.position.set(fit.position[0], fit.position[1], fit.position[2]);
  camera.lookAt(fit.target[0], fit.target[1], fit.target[2]);
  camera.updateProjectionMatrix();
  return fit;
}

function applyCloseupCamera() {
  const pose = brandplatePose(DURATION);
  const topPlate = pose.plates[BRANDPLATE.count - 1];
  const target = [topPlate.position[0], topPlate.position[1], topPlate.position[2]];
  camera.fov = 30;
  camera.near = 0.05;
  camera.far = 40;
  camera.position.set(target[0] + 0.12, target[1] + 0.1, target[2] + 3.4);
  camera.lookAt(target[0], target[1] - 0.02, target[2]);
  camera.updateProjectionMatrix();
}

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  if (state.mode === 'closeup') applyCloseupCamera();
  else applyCamera(width, height);
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------------- */
/* Pose application + animation                                              */
/* ------------------------------------------------------------------------- */

function applyPose(pose) {
  for (const plate of plates) {
    const target = pose.plates[plate.index];
    plate.group.position.set(target.position[0], target.position[1], target.position[2]);
    plate.group.rotation.set(0, target.yawRad, 0);
    plate.shadow.position.set(target.position[0], 0.004, target.position[2]);
    plate.shadow.scale.setScalar(0.84 + 0.12 * (1 - Math.abs(Math.sin(Math.PI * target.progress))));
    plate.shadowMaterial.opacity = 0.34 + 0.18 * (1 - Math.abs(Math.sin(Math.PI * target.progress)));
  }
  document.body.dataset.brandplateTime = String(pose.time);
  document.body.dataset.brandplatePhase = pose.phase;
}

function updateUi() {
  const poseNow = brandplatePose(state.time);
  const progress = DURATION > 0 ? poseNow.time / DURATION : 1;
  const bar = document.getElementById('bp-progress');
  if (bar) bar.style.transform = 'scaleX(' + progress.toFixed(4) + ')';
  const label = document.getElementById('bp-time');
  if (label) label.textContent = poseNow.time.toFixed(2) + ' s / ' + DURATION.toFixed(1) + ' s';
  const phaseLabel = document.getElementById('bp-phase');
  if (phaseLabel) phaseLabel.textContent = poseNow.phase.toUpperCase();
  const replay = document.getElementById('bp-replay');
  if (replay) replay.disabled = state.playing;
  const playPause = document.getElementById('bp-playpause');
  if (playPause) playPause.textContent = state.playing ? 'Pause' : state.time >= DURATION ? 'Replay' : 'Play';
  const autoplay = document.getElementById('bp-autoplay');
  if (autoplay) autoplay.setAttribute('aria-pressed', state.autoplay ? 'true' : 'false');
}

function setPlaying(playing) {
  if (playing && state.time >= DURATION) state.time = 0;
  state.playing = Boolean(playing);
  updateUi();
}

function play() {
  setPlaying(true);
}
function pause() {
  setPlaying(false);
}
function replay() {
  state.time = 0;
  state.playing = true;
  updateUi();
}
function setTime(seconds) {
  state.time = Math.min(DURATION, Math.max(0, Number(seconds) || 0));
  state.playing = false;
  applyPose(brandplatePose(state.time));
  updateUi();
  return state.time;
}
function setAutoplay(enabled) {
  state.autoplay = Boolean(enabled);
  updateUi();
}

let lastFrame = 0;
function animate(now) {
  if (state.playing) {
    if (!lastFrame) lastFrame = now;
    const delta = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    state.time = Math.min(DURATION, state.time + delta);
    if (state.time >= DURATION) {
      if (state.autoplay) {
        // Autoplay loops the 3 s gather; it is a looping preference, not a play state.
        state.time = 0;
      } else {
        state.time = DURATION;
        state.playing = false;
      }
    }
    applyPose(brandplatePose(state.time));
    updateUi();
  } else {
    lastFrame = 0;
  }
  renderer.render(scene, camera);
  if (!state.shotTime) requestAnimationFrame(animate);
}

/* ------------------------------------------------------------------------- */
/* QА API + controls                                                         */
/* ------------------------------------------------------------------------- */

window.__brandplate = {
  version: '1.0.0',
  provisional: PROVISIONAL,
  duration: DURATION,
  getTime: () => state.time,
  setTime,
  play,
  pause,
  replay,
  setAutoplay,
  get playing() {
    return state.playing;
  },
  pose: () => brandplatePose(state.time),
  camera: () => lastCamera,
  debug: () => ({
    provisional: PROVISIONAL,
    count: BRANDPLATE.count,
    duration: DURATION,
    time: state.time,
    playing: state.playing,
    phase: brandplatePose(state.time).phase,
    direction: BRANDPLATE.layout.direction,
    topLayer: BRANDPLATE.layout.topLayer,
    plate: PLATE,
    frame: FRAME,
    silver: { finish: SILVER.finish, metalness: SILVER.metalness, roughness: SILVER.roughness },
    blackMirror: { finish: MIRROR.finish, metalness: MIRROR.metalness, roughness: MIRROR.roughness, color: MIRROR.color },
    logo: LOGO,
    camera: lastCamera,
    bounds: BRANDPLATE.bounds,
    finalBounds: BRANDPLATE.finalBounds,
    errors: errors.slice(),
  }),
  setShot: (seconds) => setTime(seconds),
  errors,
};

function bindControls() {
  const replayButton = document.getElementById('bp-replay');
  if (replayButton) replayButton.addEventListener('click', replay);
  const playPauseButton = document.getElementById('bp-playpause');
  if (playPauseButton) {
    playPauseButton.addEventListener('click', () => {
      if (state.playing) pause();
      else if (state.time >= DURATION) replay();
      else play();
    });
  }
  const autoplayButton = document.getElementById('bp-autoplay');
  if (autoplayButton) {
    autoplayButton.addEventListener('click', () => {
      const next = !state.autoplay;
      setAutoplay(next);
      if (next && !state.playing) {
        // Turning autoplay on starts/restarts the gather without disabling it again.
        state.time = 0;
        state.playing = true;
        applyPose(brandplatePose(0));
        updateUi();
      }
    });
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'r' || event.key === 'R') replay();
    if (event.key === ' ') {
      event.preventDefault();
      if (state.playing) pause();
      else if (state.time >= DURATION) replay();
      else play();
    }
  });
}

/* ------------------------------------------------------------------------- */
/* Boot                                                                      */
/* ------------------------------------------------------------------------- */

function boot() {
  resize();
  if (state.reducedMotion) {
    state.time = DURATION;
    state.playing = false;
    state.autoplay = false;
  } else if (PARAMS.get('shot') === '1') {
    const shotTime = Number(PARAMS.get('t'));
    state.time = Number.isFinite(shotTime) ? Math.min(DURATION, Math.max(0, shotTime)) : 0;
    state.playing = false;
    state.autoplay = false;
  } else {
    state.time = 0;
    state.playing = state.autoplay;
  }
  applyPose(brandplatePose(state.time));
  updateUi();
  bindControls();
  if (state.mode === 'closeup') applyCloseupCamera();
  renderer.render(scene, camera);
  state.ready = true;
  document.body.dataset.ready = '1';
  document.body.dataset.debug = JSON.stringify({
    canvas: [renderer.domElement.width, renderer.domElement.height],
    camera: camera.position.toArray().map((value) => Math.round(value * 100) / 100),
    plates: plates.length,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    env: Boolean(scene.environment),
    plateY: plates.length ? plates[0].group.position.toArray().map((value) => Math.round(value * 100) / 100) : null,
  });
  document.body.dataset.provisional = PROVISIONAL ? '1' : '0';
  document.body.dataset.brandplateReducedMotion = state.reducedMotion ? '1' : '0';
  const staticShot = state.reducedMotion || PARAMS.get('shot') === '1';
  if (staticShot) {
    // deterministic static state. The pose is fixed, but keep presenting frames
    // through requestAnimationFrame so headless compositing reliably captures
    // the WebGL result (a single pre-composite render can be missed).
    state.shotTime = state.time;
    document.body.dataset.shot = PARAMS.get('shot') === '1' ? '1' : '0';
    let presented = 0;
    const present = () => {
      renderer.render(scene, camera);
      presented += 1;
      if (presented === 3) {
        document.title = state.reducedMotion
          ? 'OK brandplate reduced'
          : 'OK brandplate shot ' + state.time.toFixed(2);
        document.body.dataset.ready = '2';
      }
      requestAnimationFrame(present);
    };
    requestAnimationFrame(present);
    return;
  }
  document.title = 'OK brandplate ready';
  requestAnimationFrame(animate);
}

try {
  boot();
} catch (error) {
  reportError(error);
}
