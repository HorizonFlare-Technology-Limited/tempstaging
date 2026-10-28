/**
 * brandplate-preview.js — REFERENCE BUILD silver brand square plate page (Rev16 R16-1).
 *
 * Rev16 reference (K:\HFWorkspace\refs\brandplate-ref.webp): a stack of thick,
 * rounded-square plates in a deep navy studio with a glossy dark floor. The
 * front/main plate (rightmost, nearest camera) has a silver-grey metal middle
 * frame with a bright blue fluorescent strip inlaid around the recessed face,
 * and a large monochrome silver TEKO mark. The rear stacked plates have neutral
 * grey metal frames (grey for now, per user) with no glow. Plate bodies are
 * silver satin, thicker and more rounded than the provisional build, with a
 * deeper recessed face and a prominent beveled frame.
 *
 * The composition math comes from ./brandplate-model.js (pure/deterministic);
 * this module owns the three.js scene, materials, animation loop, UI and QA API.
 */
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import {
  BRANDPLATE,
  brandplatePose,
  cameraFit,
  plateFrameRole,
} from './brandplate-model.js';

const PARAMS = new URLSearchParams(window.location.search);
const DURATION = BRANDPLATE.layout.durationSeconds;
const PLATE = BRANDPLATE.plate;
const FRAME = BRANDPLATE.frame;
const STRIP = BRANDPLATE.strip;
const LOGO = BRANDPLATE.logo;
const SILVER = BRANDPLATE.silver;
const FRONT_FRAME = BRANDPLATE.frontFrame;
const REAR_FRAME = BRANDPLATE.rearFrame;
const STUDIO = BRANDPLATE.studio;
const MAIN_INDEX = BRANDPLATE.mainPlateIndex;

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
renderer.setClearColor(new THREE.Color(STUDIO.background), 1);
renderer.shadowMap.enabled = false;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(STUDIO.background);
const camera = new THREE.PerspectiveCamera(BRANDPLATE.camera.fovDeg, 1, BRANDPLATE.camera.near, BRANDPLATE.camera.far);

// neutral studio environment (local RoomEnvironment, PMREM) for satin metal
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const envTarget = pmrem.fromScene(room, 0.035);
scene.environment = envTarget.texture;
room.dispose();
pmrem.dispose();

// glossy dark-blue floor: unlit vertical sheen gradient (deep navy -> near black)
function buildFloorTexture(size = 512) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, '#02040a'); // near edge (bottom of the screen)
  gradient.addColorStop(0.55, '#071022');
  gradient.addColorStop(0.82, '#0b1a33'); // sheen toward the horizon
  gradient.addColorStop(1, '#071022');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const glow = ctx.createRadialGradient(size * 0.5, size * 0.78, 0, size * 0.5, size * 0.78, size * 0.42);
  glow.addColorStop(0, 'rgba(47,107,255,0.16)');
  glow.addColorStop(0.55, 'rgba(47,107,255,0.05)');
  glow.addColorStop(1, 'rgba(47,107,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
const floorTexture = new THREE.CanvasTexture(buildFloorTexture(512));
floorTexture.encoding = THREE.sRGBEncoding;
floorTexture.anisotropy = 8;
floorTexture.needsUpdate = true;
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshBasicMaterial({ map: floorTexture }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

// light rig: neutral key + fill + cool rim; the blue strip adds its own bounce
const key = new THREE.DirectionalLight(0xffffff, 0.55);
key.position.set(5, 7.5, 8);
scene.add(key);
const fill = new THREE.DirectionalLight(0xcfd9e8, 0.24);
fill.position.set(-6, 4.5, 6);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xdfe9ff, 0.3);
rim.position.set(2.5, 5.5, -7);
scene.add(rim);
const top = new THREE.DirectionalLight(0xffffff, 0.18);
top.position.set(-1, 9, 1);
scene.add(top);
const ambient = new THREE.AmbientLight(0x24324a, 0.08);
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
      const value = Math.min(1, 0.7 + streak * 0.2);
      const index = (y * size + x) * 4;
      albedoData.data[index] = Math.round(value * 246);
      albedoData.data[index + 1] = Math.round(value * 250);
      albedoData.data[index + 2] = Math.round(value * 255);
      albedoData.data[index + 3] = 255;
      const rough = Math.round((0.24 + streak * 0.16 + fine * 0.03) * 255);
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

function buildSilverMaterial(color, roughness, envIntensity, metalness = 1.0) {
  const material = new THREE.MeshPhysicalMaterial({
    map: silverMaps.map,
    roughnessMap: silverMaps.roughnessMap,
    bumpMap: silverMaps.bumpMap,
    bumpScale: 0.0018,
    color: new THREE.Color(color),
    metalness,
    roughness,
    clearcoat: 0.05,
    clearcoatRoughness: 0.3,
    envMapIntensity: envIntensity,
    side: THREE.FrontSide,
  });
  return material;
}

const silverBodyMaterial = buildSilverMaterial('#cfd4da', 0.36, 0.9);
silverBodyMaterial.name = 'plate-silver-satin';
const silverFaceMaterial = buildSilverMaterial('#cfd5dc', 0.4, 1.4, 0.65);
silverFaceMaterial.name = 'plate-silver-face';

const frontFrameMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(FRONT_FRAME.color),
  metalness: 0.85,
  roughness: 0.55,
  clearcoat: FRONT_FRAME.clearcoat,
  clearcoatRoughness: FRONT_FRAME.clearcoatRoughness,
  envMapIntensity: 0.22,
  side: THREE.DoubleSide,
});
frontFrameMaterial.name = 'plate-front-frame-silver-grey';

const rearFrameMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(REAR_FRAME.color),
  metalness: 0.85,
  roughness: 0.55,
  clearcoat: REAR_FRAME.clearcoat,
  clearcoatRoughness: REAR_FRAME.clearcoatRoughness,
  envMapIntensity: 0.22,
  side: THREE.DoubleSide,
});
rearFrameMaterial.name = 'plate-rear-frame-neutral-grey';

const stripCoreMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#4a86ff'),
  toneMapped: false,
  side: THREE.DoubleSide,
});
stripCoreMaterial.name = 'plate-blue-strip-core';

const stripHaloMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#2f6bff'),
  transparent: true,
  opacity: 0.25,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  side: THREE.DoubleSide,
});
stripHaloMaterial.name = 'plate-blue-strip-halo';

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

function buildPlateBodyGeometry() {
  const depth = Math.max(0.02, PLATE.thickness - 2 * PLATE.bevel);
  const geometry = new THREE.ExtrudeGeometry(roundedRectShape(PLATE.size, PLATE.cornerRadius), {
    depth,
    bevelEnabled: true,
    bevelThickness: PLATE.bevel,
    bevelSize: PLATE.bevel,
    bevelSegments: 6,
    curveSegments: 24,
    steps: 1,
  });
  geometry.center();
  return geometry;
}

function buildRecessedFaceGeometry() {
  const size = 1.14; // meets the blue inlay ring (no bright groove between them)
  const depth = 0.022;
  const geometry = new THREE.ExtrudeGeometry(roundedRectShape(size, 0.16), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 3,
    curveSegments: 20,
    steps: 1,
  });
  geometry.center();
  return geometry;
}

function buildFrameRingGeometry() {
  const shape = roundedRectShape(FRAME.outerSize, FRAME.cornerRadius);
  shape.holes.push(roundedRectPath(FRAME.innerSize, FRAME.cornerRadius * 0.75));
  const depth = Math.max(0.02, FRAME.thickness - 2 * FRAME.bevel);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: FRAME.bevel,
    bevelSize: FRAME.bevel,
    bevelSegments: 3,
    curveSegments: 20,
    steps: 1,
  });
  geometry.center();
  return geometry;
}

function buildFlatRingGeometry(outer, inner, cornerRadius) {
  // flat rounded-square ring (guarantees the thin fluorescent line reads from the front)
  const shape = roundedRectShape(outer, cornerRadius);
  shape.holes.push(roundedRectPath(inner, Math.max(0.02, cornerRadius - (outer - inner) * 0.5)));
  const geometry = new THREE.ShapeGeometry(shape, 20);
  geometry.computeVertexNormals();
  return geometry;
}

/* Contact shadow sprite (subtle, on the glossy floor) */
function buildContactShadowTexture(size) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.62)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.3)');
  gradient.addColorStop(0.8, 'rgba(0,0,0,0.06)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
const contactTexture = new THREE.CanvasTexture(buildContactShadowTexture(256));
contactTexture.encoding = THREE.LinearEncoding;
contactTexture.needsUpdate = true;

/* TEKO mark -> monochrome SILVER inlay texture (Rev16; not gold) */
let logoLoadError = null;
const logoTexture = new THREE.TextureLoader().load(LOGO.srcSilver, (texture) => {
  texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  renderer.render(scene, camera);
}, undefined, (error) => {
  logoLoadError = error;
  reportError(error);
});
const logoMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: LOGO.metalness,
  roughness: LOGO.roughness,
  clearcoat: 0.08,
  clearcoatRoughness: 0.22,
  envMapIntensity: 1.3,
  transparent: true,
  alphaTest: 0.02,
  side: THREE.DoubleSide,
});
logoMaterial.name = 'plate-teko-logo-silver-inlay';
logoMaterial.map = logoTexture;
logoMaterial.needsUpdate = true;

// dark recessed backing behind the logo makes the silver inlay read as engraved
const logoBackingMaterial = new THREE.MeshStandardMaterial({
  color: 0x22262c,
  metalness: 0.35,
  roughness: 0.62,
  side: THREE.DoubleSide,
});
logoBackingMaterial.name = 'plate-logo-recess-shadow';

/* ------------------------------------------------------------------------- */
/* Plate assembly                                                            */
/* ------------------------------------------------------------------------- */

const bodyGeometry = buildPlateBodyGeometry();
const faceGeometry = buildRecessedFaceGeometry();
const frameGeometry = buildFrameRingGeometry();
const stripOuter = 1.18;
const stripInner = stripOuter - STRIP.bandWidth;
const haloOuter = stripOuter + 0.004;
const haloInner = stripInner - 0.004;
const stripCoreGeometry = buildFlatRingGeometry(stripOuter, stripInner, 0.14);
const stripHaloGeometry = buildFlatRingGeometry(haloOuter, haloInner, 0.15);
const logoGeometry = new THREE.PlaneGeometry(LOGO.size, LOGO.size);
const backingGeometry = new THREE.PlaneGeometry(LOGO.size * 1.06, LOGO.size * 1.06);
const shadowGeometry = new THREE.PlaneGeometry(3.0, 1.6);

const plates = [];
for (let index = 0; index < BRANDPLATE.count; index += 1) {
  const role = plateFrameRole(index);
  const isFront = role === 'front';
  const group = new THREE.Group();
  group.name = 'brandplate-' + index;
  group.userData.role = role;

  const body = new THREE.Mesh(bodyGeometry, silverBodyMaterial);
  body.name = 'plate-body-' + index;
  group.add(body);

  const centreZ = PLATE.thickness / 2;

  // recessed face panel (the face sits behind the prominent frame)
  const face = new THREE.Mesh(faceGeometry, silverFaceMaterial);
  face.name = 'plate-face-' + index;
  // the body is a solid slab (front at +thickness/2); the recessed content sits
  // just in front of it and the frame stands proud, giving the deep face recess
  face.position.z = centreZ - 0.018; // face front ~= body front
  group.add(face);

  // prominent beveled middle frame (silver-grey front, neutral grey rear)
  const frame = new THREE.Mesh(frameGeometry, isFront ? frontFrameMaterial : rearFrameMaterial);
  frame.name = 'plate-frame-' + index;
  frame.position.z = centreZ + FRAME.proud - FRAME.thickness / 2;
  group.add(frame);

  // blue fluorescent inlay strip around the face inside the frame: front only
  if (isFront && STRIP.frontOnly) {
    const strip = new THREE.Mesh(stripCoreGeometry, stripCoreMaterial);
    strip.name = 'plate-blue-strip-' + index;
    strip.position.z = centreZ + 0.006;
    group.add(strip);
    const halo = new THREE.Mesh(stripHaloGeometry, stripHaloMaterial);
    halo.name = 'plate-blue-halo-' + index;
    halo.position.z = centreZ + 0.004;
    group.add(halo);
    const bounce = new THREE.PointLight(
      new THREE.Color(STRIP.bounceColor),
      STRIP.bounceIntensity,
      STRIP.bounceDistance,
      2,
    );
    bounce.name = 'plate-blue-bounce-' + index;
    bounce.position.set(0, 0, centreZ + 0.22);
    group.add(bounce);
  }

  // logo: large monochrome silver inlay with a soft dark silhouette behind it
  const logoShadowMaterial = new THREE.MeshBasicMaterial({
    map: logoTexture,
    color: 0x000000,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const backing = new THREE.Mesh(backingGeometry, logoShadowMaterial);
  backing.name = 'plate-logo-shadow-' + index;
  backing.position.z = centreZ + 0.009;
  group.add(backing);
  const logo = new THREE.Mesh(logoGeometry, logoMaterial);
  logo.name = 'plate-logo-' + index;
  logo.position.z = centreZ + 0.014;
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
  plates.push({ index, role, group, body, face, frame, logo, backing, shadow, shadowMaterial });
}

/* ------------------------------------------------------------------------- */
/* Camera fit + responsive sizing                                            */
/* ------------------------------------------------------------------------- */

let lastCamera = null;

function applyCamera(width, height, time = state.time) {
  const fit = cameraFit(width, height, time);
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
  const topPlate = pose.plates[MAIN_INDEX];
  const target = [topPlate.position[0], topPlate.position[1], topPlate.position[2]];
  camera.fov = 30;
  camera.near = 0.05;
  camera.far = 40;
  camera.position.set(target[0] + 0.5, target[1] + 0.12, target[2] + 3.0);
  camera.lookAt(target[0], target[1] - 0.02, target[2]);
  camera.updateProjectionMatrix();
}

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  if (state.mode === 'closeup') applyCloseupCamera();
  else applyCamera(width, height, state.time);
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
    plate.shadow.scale.setScalar(0.9 + 0.1 * (1 - Math.abs(Math.sin(Math.PI * target.progress))));
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
  if (state.mode !== 'closeup') applyCamera(window.innerWidth, window.innerHeight, state.time);
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
    if (state.mode !== 'closeup') applyCamera(window.innerWidth, window.innerHeight, state.time);
    updateUi();
  } else {
    lastFrame = 0;
  }
  renderer.render(scene, camera);
  if (!state.shotTime) requestAnimationFrame(animate);
}

/* ------------------------------------------------------------------------- */
/* QA API + controls                                                         */
/* ------------------------------------------------------------------------- */

window.__brandplate = {
  version: '1.1.0',
  referenceBuild: BRANDPLATE.referenceBuild,
  referenceImage: BRANDPLATE.referenceImage,
  duration: DURATION,
  mainPlateIndex: MAIN_INDEX,
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
    referenceBuild: BRANDPLATE.referenceBuild,
    count: BRANDPLATE.count,
    duration: DURATION,
    time: state.time,
    playing: state.playing,
    phase: brandplatePose(state.time).phase,
    direction: BRANDPLATE.layout.direction,
    topLayer: BRANDPLATE.layout.topLayer,
    mainPlateIndex: MAIN_INDEX,
    plate: PLATE,
    frame: FRAME,
    strip: STRIP,
    silver: { finish: SILVER.finish, metalness: SILVER.metalness, roughness: SILVER.roughness },
    frontFrame: { finish: FRONT_FRAME.finish, metalness: FRONT_FRAME.metalness, roughness: FRONT_FRAME.roughness, color: FRONT_FRAME.color },
    rearFrame: { finish: REAR_FRAME.finish, metalness: REAR_FRAME.metalness, roughness: REAR_FRAME.roughness, color: REAR_FRAME.color },
    studio: STUDIO,
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
        // Turning autoplay on starts/restarts the gather without clearing the preference.
        state.time = 0;
        state.playing = true;
        applyPose(brandplatePose(0));
        if (state.mode !== 'closeup') applyCamera(window.innerWidth, window.innerHeight, 0);
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
  if (state.mode !== 'closeup') applyCamera(window.innerWidth, window.innerHeight, state.time);
  updateUi();
  bindControls();
  if (state.mode === 'closeup') applyCloseupCamera();
  renderer.render(scene, camera);
  state.ready = true;
  document.body.dataset.ready = '1';
  document.body.dataset.referenceBuild = '1';
  if (PARAMS.get('ui') === '0') document.body.classList.add('bp-chrome-hidden');
  document.body.dataset.brandplateRole = 'front:' + plates.filter((plate) => plate.role === 'front').length + ',rear:' + plates.filter((plate) => plate.role === 'rear').length;
  document.body.dataset.brandplateReducedMotion = state.reducedMotion ? '1' : '0';
  document.body.dataset.debug = JSON.stringify({
    logoMap: Boolean(logoMaterial.map),
    logoError: Boolean(logoLoadError),
    logoMeshes: plates.length,
    stripMeshes: plates.reduce((count, plate) => count + plate.group.children.filter((child) => /blue-(strip|halo)|blue-bounce/.test(child.name)).length, 0),
    errors: errors.length,
  });

  const staticShot = state.reducedMotion || PARAMS.get('shot') === '1';
  if (staticShot) {
    // deterministic static state. The pose is fixed, but keep presenting frames
    // through requestAnimationFrame so headless compositing reliably captures
    // the WebGL result.
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
