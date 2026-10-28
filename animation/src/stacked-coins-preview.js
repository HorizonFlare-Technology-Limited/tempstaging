/**
 * tekoanimation — Stacked Coins preview (Rev17)
 *
 * A tall stack of NINE real TEKO silver coins with THREE floating above, in a
 * dark editorial studio; the milled reeded edges glow TEKO theme gold (#ffd60a)
 * with a bright emissive core plus additive halo — never blue, never on the
 * satin faces.
 *
 * The composition/timing comes from the modeler-owned pure model
 * ./stacked-coins-model.js (COINS_CONFIG, coinsPose(t), coinsCameraFit,
 * COINS_LAYOUT, stackedCoinsReducedMotionPose); the coins come from the real
 * ./coin-model.js bank; the studio is ./stacked-coins-scene.js. This module owns
 * the boot, animation loop, controls, responsive fit and the QA hooks.
 *
 * Local only: vendored three, local coin assets/font, no network requests.
 */
import * as THREE from 'three';
import {
  COINS_CONFIG,
  coinsPose,
  coinsCameraFit,
  coinsProjectPoint,
  stackedCoinsReducedMotionPose,
} from './stacked-coins-model.js';
import { loadCoinBank } from './coin-model.js';
import { createStackedCoinsStudio } from './stacked-coins-scene.js';

const VERSION = '1.0.0';
const MODEL = COINS_CONFIG;
const DURATION = MODEL.durationSeconds;
const DEFAULT_SHOT_TIME = 1.5; // one of MODEL.shots
const REDUCED_MOTION_TIME = MODEL.reducedMotion.time;
const TAU = Math.PI * 2;

/** The currencies used by the composition (stack bottom -> top, float low -> high). */
const COIN_IDS = Object.freeze({
  stack: ['gbp', 'eur', 'cny', 'usd', 'vnd', 'php', 'thb', 'gbp', 'eur'],
  floats: ['gbp', 'usd', 'eur'],
});
const FACE_SIZE = Object.freeze({ stack: 512, float: 1024 });

/* ---------------------------------------------------------------- dom refs */

const dom = {
  body: document.body,
  stage: document.getElementById('stage'),
  canvas: document.getElementById('stage-canvas'),
  veilText: document.getElementById('veil-text'),
  eyebrow: document.getElementById('stage-eyebrow-text'),
  stageIndexStack: document.getElementById('stage-index-stack'),
  btnReplay: document.getElementById('btn-replay'),
  btnPlay: document.getElementById('btn-play'),
  btnPlayLabel: document.getElementById('btn-play-label'),
  timelineFill: document.getElementById('timeline-fill'),
  timelineReadout: document.getElementById('timeline-readout'),
  timelinePhase: document.getElementById('timeline-phase'),
  glowMeterFill: document.getElementById('glow-meter-fill'),
  glowMeterValue: document.getElementById('glow-meter-value'),
  footerStatus: document.getElementById('footer-status'),
  fallback: document.getElementById('fallback'),
  fallbackMessage: document.getElementById('fallback-message'),
  errorBanner: document.getElementById('error-banner'),
  errorText: document.getElementById('error-text'),
  diag: document.getElementById('qa-diag'),
};

const params = new URLSearchParams(window.location.search);
const boot = window.__stackedCoinsBoot || { params: {}, reducedMotion: false };
const initial = boot.params || {};
const param = (name, fallback) => {
  const fromUrl = params.get(name);
  if (fromUrl !== null) return fromUrl;
  if (initial[name] !== undefined) return initial[name];
  return fallback;
};
const numberParam = (name) => {
  const raw = param(name, null);
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const state = {
  ready: false,
  failed: false,
  errors: [],
  warnings: [],
  shot: param('shot', '0') === '1' || param('still', '0') === '1',
  reducedMotion: false,
  mode: param('mode', 'hero') === 'closeup' ? 'closeup' : 'hero',
  uiHidden: param('ui', '1') === '0',
  playing: false,
  time: 0,
  duration: DURATION,
  bank: null,
  studio: null,
  scene: null,
  camera: null,
  renderer: null,
  coinsRoot: null,
  coins: [],
  materials: { face: [], band: [] },
  pose: null,
  cameraFit: null,
  stageRect: { width: 0, height: 0 },
  raf: 0,
  frames: 0,
  lastFrame: 0,
  resizeObserver: null,
  diagTimer: 0,
  contextLost: false,
  webgl: false,
  debugFlags: [],
  reducedMotionSource: 'none',
};

const qa = { errors: state.errors, warnings: state.warnings };

/* -------------------------------------------------------------- utilities */

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const wrapTime = (value) => {
  const time = Number(value) || 0;
  return ((time % DURATION) + DURATION) % DURATION;
};

function pushError(message) {
  const text = String(message);
  state.errors.push(text);
  dom.body.dataset.qaErrors = String(state.errors.length);
  if (dom.errorText) dom.errorText.textContent = 'Studio issue: ' + text;
  if (dom.errorBanner) dom.errorBanner.hidden = false;
}

function setBusy(busy, label) {
  if (!dom.stage) return;
  dom.stage.classList.toggle('is-busy', Boolean(busy));
  if (label && dom.veilText) dom.veilText.textContent = label;
}

function announce(message) {
  if (dom.footerStatus) dom.footerStatus.textContent = message;
}

function showError(message) {
  if (dom.errorText) dom.errorText.textContent = message;
  if (dom.errorBanner) dom.errorBanner.hidden = false;
}

function showFallback(message, error) {
  state.failed = true;
  dom.body.dataset.fallback = '1';
  dom.body.dataset.qaReady = '0';
  if (dom.fallback && message) {
    const note = error ? message + ' (' + (error && error.message ? error.message : String(error)) + ')' : message;
    if (dom.fallbackMessage) dom.fallbackMessage.textContent = note;
    dom.fallback.hidden = false;
  }
  setBusy(false);
  if (error) pushError(error && error.message ? error.message : error);
  announce('Static fallback');
}

/* -------------------------------------------------------------- renderer */

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  state.webgl = true;
  return renderer;
}

/* --------------------------------------------------------------- studio */

function buildStudio() {
  const renderer = createRenderer();
  state.renderer = renderer;
  state.scene = new THREE.Scene();
  state.scene.fog = new THREE.FogExp2(0x0b0d10, 0.02);
  state.camera = new THREE.PerspectiveCamera(MODEL.camera.fovDeg, 1, MODEL.camera.near, MODEL.camera.far);
  state.scene.add(state.camera);

  state.studio = createStackedCoinsStudio(renderer);
  state.scene.environment = state.studio.environment ? state.studio.environment.texture : null;
  state.scene.add(state.studio.group);

  state.coinsRoot = new THREE.Group();
  state.coinsRoot.name = 'stacked-coins-rings';
  state.scene.add(state.coinsRoot);
}

async function loadBank() {
  setBusy(true, 'Loading satin + Lexend assets');
  announce('Loading coin assets');
  const bank = await loadCoinBank({
    onProgress: (loaded, total) => {
      if (dom.veilText) dom.veilText.textContent = 'Loading coin assets ' + loaded + ' / ' + total;
    },
  });
  state.bank = bank;
  return bank;
}

/* ---------------------------------------------------------------- coins */

function buildCoins() {
  if (!state.bank || !state.studio) throw new Error('bank/studio not ready');
  const layout = MODEL.layout;
  const entries = [];

  const addEntry = (kind, index, currency, faceSize) => {
    setBusy(true, 'Minting ' + currency.toUpperCase() + ' · ' + (kind === 'stack' ? 'stack' : 'floating'));
    const coin = state.bank.createCoin(currency, { faceSize });
    const glow = state.studio.createEdgeGlow(coin);
    coin.group.name = 'stacked-coins-' + kind + '-' + index + '-' + currency;
    coin.group.userData = {
      kind,
      index,
      currency,
      symbol: coin.spec ? coin.spec.glyph : null,
      faceSize,
    };
    state.coinsRoot.add(coin.group);
    // Presentation tuning for the dark editorial studio: keep the model's satin +
    // twill albedo and embossed Lexend normal map, but give the silver a slightly
    // rougher satin response so it reads as brushed metal (not a white mirror
    // blowout) and the relief symbol keeps soft edge contrast.
    const faceMaterial = coin.faceA ? coin.faceA.material : null;
    if (faceMaterial) {
      faceMaterial.roughness = 0.44;
      faceMaterial.clearcoat = 0.04;
      faceMaterial.clearcoatRoughness = 0.5;
      faceMaterial.envMapIntensity = 0.95;
      if (faceMaterial.normalScale) faceMaterial.normalScale.set(1.18, 1.18);
      faceMaterial.needsUpdate = true;
    }
    if (faceMaterial && state.materials.face.indexOf(faceMaterial) === -1) state.materials.face.push(faceMaterial);
    if (state.materials.band.indexOf(glow.bandMaterial) === -1) state.materials.band.push(glow.bandMaterial);
    const entry = { kind, index, currency, coin, glow, faceSize, spec: coin.spec };
    entries.push(entry);
    return entry;
  };

  for (let index = 0; index < layout.stack.length; index += 1) {
    addEntry('stack', index, COIN_IDS.stack[index], FACE_SIZE.stack);
  }
  for (let index = 0; index < layout.floats.length; index += 1) {
    addEntry('float', index, COIN_IDS.floats[index], FACE_SIZE.float);
  }
  state.coins = entries;
  for (const entry of state.coins) {
    const coin = entry.coin;
    if (coin.faceA) {
      coin.faceA.castShadow = true;
      coin.faceA.receiveShadow = false;
    }
    if (coin.faceB) {
      coin.faceB.castShadow = true;
      coin.faceB.receiveShadow = false;
    }
  }
  return entries;
}

/* ----------------------------------------------------------------- pose */

function applyPose(time) {
  if (!state.ready && !state.pose) return null;
  const pose = coinsPose(time);
  state.pose = pose;
  const ordered = pose.stack.concat(pose.floats);
  for (let index = 0; index < state.coins.length && index < ordered.length; index += 1) {
    const entry = state.coins[index];
    const coinPose = ordered[index];
    entry.coin.group.position.set(coinPose.position[0], coinPose.position[1], coinPose.position[2]);
    entry.coin.group.quaternion.set(coinPose.quaternion[0], coinPose.quaternion[1], coinPose.quaternion[2], coinPose.quaternion[3]);
    entry.glow.setGlow(coinPose.glowIntensity, MODEL.glow.haloOpacity);
  }
  updateTimelineUi(pose);
  return pose;
}

function glowStats(pose) {
  const ordered = pose.stack.concat(pose.floats);
  let total = 0;
  for (const coin of ordered) total += coin.glowIntensity;
  const average = ordered.length ? total / ordered.length : MODEL.glow.emissiveBase;
  const min = MODEL.glow.emissiveBase * MODEL.glow.emissivePulseMin;
  const max = MODEL.glow.emissiveBase * MODEL.glow.emissivePulseMax;
  const normalized = clamp((average - min) / (max - min || 1), 0, 1);
  return { average: round(average, 3), normalized: round(normalized, 4) };
}

function updateTimelineUi(pose) {
  const progress = clamp(state.time / DURATION, 0, 1);
  if (dom.timelineFill) dom.timelineFill.style.width = (progress * 100).toFixed(2) + '%';
  if (dom.timelineReadout && dom.timelineReadout.firstChild) {
    dom.timelineReadout.firstChild.nodeValue = state.time.toFixed(1) + ' s ';
  }
  if (dom.glowMeterFill || dom.glowMeterValue) {
    const glow = glowStats(pose);
    if (dom.glowMeterFill) dom.glowMeterFill.style.width = (18 + glow.normalized * 82).toFixed(1) + '%';
    if (dom.glowMeterValue) dom.glowMeterValue.textContent = glow.average.toFixed(2);
  }
  dom.body.dataset.time = state.time.toFixed(3);
  dom.body.dataset.playing = state.playing ? '1' : '0';
}

/* --------------------------------------------------------------- camera */

function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cameraFitForStage(width, height) {
  const fit = coinsCameraFit(width, height);
  if (state.mode !== 'closeup') return fit;
  const target = [0, 1.78, 0];
  const direction = normalize3([fit.position[0] - fit.target[0], fit.position[1] - fit.target[1], fit.position[2] - fit.target[2]]);
  const distance = 4.4;
  return {
    ...fit,
    mode: 'closeup',
    target,
    distance: round(distance, 6),
    position: [round(target[0] + direction[0] * distance, 6), round(target[1] + direction[1] * distance, 6), round(target[2] + direction[2] * distance, 6)],
  };
}

function applyCameraFit(fit) {
  state.cameraFit = fit;
  const camera = state.camera;
  camera.fov = fit.fovDeg;
  camera.near = fit.near;
  camera.far = fit.far;
  camera.aspect = state.stageRect.width / state.stageRect.height;
  camera.position.fromArray(fit.position);
  camera.lookAt(fit.target[0], fit.target[1], fit.target[2]);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function resize() {
  if (!state.renderer || !state.camera || !dom.stage) return;
  const rect = dom.stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  state.stageRect = { width, height };
  state.renderer.setSize(width, height, false);
  applyCameraFit(cameraFitForStage(width, height));
  if (state.ready) applyPose(state.time);
  paintFrame();
}

function paintFrame() {
  if (!state.renderer || !state.scene || !state.camera) return;
  state.renderer.render(state.scene, state.camera);
  state.frames += 1;
}

/* --------------------------------------------------------------- controls */

function updateControls() {
  const frozen = state.shot || state.reducedMotion;
  if (dom.btnPlay) {
    dom.btnPlay.disabled = frozen || !state.ready;
    dom.btnPlay.setAttribute('aria-pressed', String(state.playing));
    dom.btnPlay.title = state.reducedMotion
      ? 'Playback is disabled by the reduced-motion preference.'
      : state.shot
        ? 'Playback is frozen in deterministic capture mode.'
        : state.playing ? 'Pause the animation' : 'Play the animation';
  }
  if (dom.btnPlayLabel) dom.btnPlayLabel.textContent = state.reducedMotion || state.shot ? 'Static' : state.playing ? 'Pause' : 'Play';
  if (dom.btnReplay) dom.btnReplay.disabled = !state.ready;
  if (dom.timelinePhase) {
    dom.timelinePhase.textContent = state.reducedMotion ? 'STILL' : state.shot ? 'SHOT' : state.playing ? 'LOOP' : 'PAUSED';
  }
}

function setTime(time, { paint = true } = {}) {
  state.time = clamp(Number(time) || 0, 0, DURATION);
  if (state.ready) applyPose(state.time);
  if (paint) paintFrame();
  updateControls();
}

function setPlaying(playing) {
  state.playing = Boolean(playing) && !state.shot && !state.reducedMotion;
  updateControls();
  if (state.ready) applyPose(state.time);
}

function replay() {
  if (!state.ready) return false;
  state.time = 0;
  state.playing = !state.shot && !state.reducedMotion;
  applyPose(0);
  paintFrame();
  updateControls();
  return true;
}

function togglePlay() {
  if (!state.ready || state.shot || state.reducedMotion) return false;
  if (state.playing) {
    setPlaying(false);
    return false;
  }
  setPlaying(true);
  return true;
}

function stepTime(delta) {
  const frozen = state.shot || state.reducedMotion;
  if (!state.ready || frozen) return false;
  state.playing = false;
  updateControls();
  setTime(wrapTime(state.time + delta));
  return true;
}

function wireUi() {
  if (dom.btnReplay) dom.btnReplay.addEventListener('click', () => { replay(); publish(); });
  if (dom.btnPlay) dom.btnPlay.addEventListener('click', () => { togglePlay(); publish(); });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.target === dom.btnPlay || event.target === dom.btnReplay) {
      if (event.key === ' ' || event.key === 'Spacebar') event.preventDefault();
    }
    if (event.defaultPrevented) return;
    const key = event.key;
    if (key === 'r' || key === 'R') {
      event.preventDefault();
      replay();
      publish();
    } else if (key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      togglePlay();
      publish();
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      stepTime(-0.25);
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      stepTime(0.25);
    }
  });
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) {
    state.resizeObserver = new ResizeObserver(() => resize());
    state.resizeObserver.observe(dom.stage);
  }
  window.addEventListener('pagehide', dispose);
}

/* ------------------------------------------------------------------ loop */

function startLoop() {
  if (state.raf) cancelAnimationFrame(state.raf);
  let last = performance.now();
  const frame = (now) => {
    if (state.failed) return;
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.playing && !state.shot && !state.reducedMotion) {
      state.time = wrapTime(state.time + delta);
      applyPose(state.time);
    }
    paintFrame();
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ boot */

function setupInitialState() {
  const mediaReduced = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  state.reducedMotion = Boolean(boot.forceReducedMotion) || Boolean(boot.reducedMotion) || mediaReduced;
  state.reducedMotionSource = boot.forceReducedMotion ? 'param' : mediaReduced ? 'media' : 'none';
  dom.body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  if (state.reducedMotion) state.shot = true;
  const explicitTime = numberParam('t');
  if (explicitTime !== null) state.time = wrapTime(explicitTime);
  else if (state.reducedMotion) state.time = REDUCED_MOTION_TIME;
  else if (state.shot) state.time = DEFAULT_SHOT_TIME;
  if (state.mode === 'closeup') dom.body.dataset.mode = 'closeup';
  state.playing = !state.shot && !state.reducedMotion;
  dom.body.classList.toggle('is-loading', true);
}

async function bootPage() {
  setupInitialState();
  try {
    setBusy(true, 'Building the black studio');
    announce('Building the black studio');
    buildStudio();
    resize();
    paintFrame();
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    await loadBank();
    setBusy(true, 'Minting 12 coins');
    announce('Minting 12 coins');
    buildCoins();
    resize();
    applyQaFlags();
    addCoinLabelsToStage();
    state.ready = true;
    dom.body.dataset.qaReady = '1';
    dom.body.dataset.qaErrors = String(state.errors.length);
    dom.body.dataset.stackCount = String(state.coins.filter((entry) => entry.kind === 'stack').length);
    dom.body.dataset.floatCount = String(state.coins.filter((entry) => entry.kind === 'float').length);
    dom.body.dataset.coinCount = String(state.coins.length);
    dom.body.dataset.glowColor = MODEL.glow.color;
    dom.body.dataset.shot = state.shot ? '1' : '0';
    dom.body.classList.remove('is-loading');
    setBusy(false);
    if (state.reducedMotion) {
      state.time = REDUCED_MOTION_TIME;
      state.playing = false;
    } else if (state.shot) {
      state.playing = false;
    } else {
      state.playing = true;
      state.time = 0;
    }
    applyPose(state.time);
    updateControls();
    wireUi();
    paintFrame();
    startLoop();
    publish();
    state.diagTimer = window.setInterval(publish, 250);
    announce(state.reducedMotion ? 'Reduced motion · static frame' : state.shot ? 'Deterministic shot ready' : 'Studio ready');
    if (!state.shot && !state.reducedMotion && dom.btnReplay) dom.btnReplay.focus({ preventScroll: true });
  } catch (error) {
    showFallback('The stacked-coins studio could not start. Serve the worktree over http://127.0.0.1 and check WebGL.', error);
    if (window.console && console.warn) console.warn('stacked-coins: boot failed', error);
  }
}

/**
 * QA-only deterministic switch set (?debug=nohalo,nokey,norim,nofill,nogold,noenv,noground)
 * used to isolate lighting/glow contributions in headless evidence; it never runs
 * unless the URL asks for it.
 */
function applyQaFlags() {
  const flags = String(param('debug', '') || '').split(',').map((value) => value.trim()).filter(Boolean);
  state.debugFlags = flags;
  if (!flags.length || !state.studio) return;
  const lights = state.studio.lights;
  if (flags.indexOf('nokey') >= 0) lights.key.intensity = 0;
  if (flags.indexOf('norim') >= 0) lights.rim.intensity = 0;
  if (flags.indexOf('nofill') >= 0) lights.fill.intensity = 0;
  if (flags.indexOf('nogold') >= 0) {
    lights.goldBounce.intensity = 0;
    lights.goldPoolLight.intensity = 0;
  }
  if (flags.indexOf('noenv') >= 0 && state.scene) state.scene.environment = null;
  if (flags.indexOf('nohalo') >= 0 && state.scene) {
    state.scene.traverse((object) => {
      if (object.name && object.name.indexOf('stacked-coins-halo') === 0) object.visible = false;
    });
  }
  if (flags.indexOf('noground') >= 0) {
    for (const mesh of Object.values(state.studio.ground)) {
      if (mesh && mesh.isMesh) mesh.visible = false;
    }
  }
  paintFrame();
}

/** A tiny stage index/eyebrow copy refresh driven by the built coins. */
function addCoinLabelsToStage() {
  if (dom.stageIndexStack) dom.stageIndexStack.textContent = String(COIN_IDS.stack.length).padStart(2, '0');
  if (dom.eyebrow) dom.eyebrow.textContent = 'Reeded edges · theme gold';
}

/* -------------------------------------------------------------------- QA */

function projectWorld(position) {
  if (!state.cameraFit) return [0, 0];
  try {
    return coinsProjectPoint(position, state.cameraFit).map((value) => round(value, 2));
  } catch (error) {
    return [0, 0];
  }
}

function buildDebug() {
  const pose = state.pose;
  const faceMaterial = state.materials.face[0] || null;
  const glowDebug = state.coins.length ? state.coins[0].glow.debug() : null;
  return {
    version: VERSION,
    model: 'stacked-coins-model.js',
    ready: Boolean(state.ready),
    failed: Boolean(state.failed),
    errors: state.errors.slice(),
    warnings: state.warnings.slice(),
    webgl: Boolean(state.webgl),
    mode: state.mode,
    debugFlags: (state.debugFlags || []).slice(),
    duration: DURATION,
    loop: Boolean(MODEL.loop),
    time: round(state.time, 3),
    playing: Boolean(state.playing),
    shot: Boolean(state.shot),
    reducedMotion: Boolean(state.reducedMotion),
    reducedMotionSource: state.reducedMotionSource || 'none',
    counts: {
      stack: state.coins.filter((entry) => entry.kind === 'stack').length,
      floats: state.coins.filter((entry) => entry.kind === 'float').length,
      total: state.coins.length,
      specs: MODEL.layout.stackCount + MODEL.layout.floatCount,
      goldCoins: state.materials.band.length,
    },
    layout: {
      stackTopY: MODEL.layout.stackTopY,
      floaterBaseY: MODEL.layout.floaterBaseY,
      stackCount: MODEL.layout.stackCount,
      floatCount: MODEL.layout.floatCount,
    },
    glow: {
      color: MODEL.glow.color,
      colorRgb: MODEL.glow.colorRgb.slice(),
      target: MODEL.glow.target,
      emissiveBase: MODEL.glow.emissiveBase,
      pulsePeriodSeconds: MODEL.glow.pulsePeriodSeconds,
      pulseMin: MODEL.glow.emissivePulseMin,
      pulseMax: MODEL.glow.emissivePulseMax,
      additiveHalo: MODEL.glow.additiveHalo,
      haloOpacity: MODEL.glow.haloOpacity,
      faceGlow: MODEL.glow.faceGlow,
      active: glowDebug,
      average: pose ? glowStats(pose).average : null,
    },
    coins: state.coins.map((entry) => {
      const coinPose = pose ? (entry.kind === 'stack' ? pose.stack[entry.index] : pose.floats[entry.index]) : null;
      return {
        kind: entry.kind,
        index: entry.index,
        currency: entry.currency,
        symbol: entry.spec ? entry.spec.glyph : null,
        faceSize: entry.faceSize,
        position: coinPose ? coinPose.position.slice() : null,
        quaternion: coinPose ? coinPose.quaternion.slice() : null,
        normal: coinPose ? coinPose.normal.slice() : null,
        glowIntensity: coinPose ? coinPose.glowIntensity : null,
        yawDeg: coinPose ? coinPose.yawDeg : null,
        bob: coinPose && coinPose.bob !== undefined ? coinPose.bob : null,
        screen: coinPose ? projectWorld(coinPose.position) : null,
        materials: entry.coin.group ? {
          face: {
            name: entry.coin.faceA ? entry.coin.faceA.material.name : null,
            metalness: entry.coin.faceA ? entry.coin.faceA.material.metalness : null,
            roughness: entry.coin.faceA ? entry.coin.faceA.material.roughness : null,
            map: Boolean(entry.coin.faceA && entry.coin.faceA.material.map),
            normalMap: Boolean(entry.coin.faceA && entry.coin.faceA.material.normalMap),
            envMapIntensity: entry.coin.faceA ? entry.coin.faceA.material.envMapIntensity : null,
          },
          bandGlow: entry.glow.debug(),
        } : null,
      };
    }),
    faceMaterial: faceMaterial ? {
      type: faceMaterial.type,
      metalness: faceMaterial.metalness,
      roughness: faceMaterial.roughness,
      envMapIntensity: faceMaterial.envMapIntensity,
      map: Boolean(faceMaterial.map),
      normalMap: Boolean(faceMaterial.normalMap),
      emissive: faceMaterial.emissive ? '#' + faceMaterial.emissive.getHexString() : null,
      faceGlow: MODEL.glow.faceGlow,
    } : null,
    bandMaterial: state.materials.band.length ? {
      name: state.materials.band[0].name,
      type: state.materials.band[0].type,
      emissive: '#' + state.materials.band[0].emissive.getHexString(),
      emissiveIntensity: state.materials.band[0].emissiveIntensity,
      metalness: state.materials.band[0].metalness,
      roughness: state.materials.band[0].roughness,
    } : null,
    studio: state.studio ? state.studio.debug() : null,
    camera: state.cameraFit ? {
      fovDeg: state.cameraFit.fovDeg,
      elevationDeg: state.cameraFit.elevationDeg,
      distance: state.cameraFit.distance,
      target: state.cameraFit.target.slice(),
      position: state.cameraFit.position.slice(),
      stage: state.cameraFit.stage,
      framing: state.cameraFit.framing,
      mode: state.cameraFit.mode || 'hero',
    } : null,
    stage: { width: state.stageRect.width, height: state.stageRect.height },
    render: {
      frames: state.frames,
      pixelRatio: state.renderer ? state.renderer.getPixelRatio() : 0,
      triangles: state.renderer ? state.renderer.info.render.triangles : 0,
      calls: state.renderer ? state.renderer.info.render.calls : 0,
      toneMapping: 'ACESFilmic',
      exposure: state.renderer ? state.renderer.toneMappingExposure : null,
      outputEncoding: 'sRGB',
    },
    bank: state.bank ? { ready: true, specs: state.bank.specs.length } : { ready: false },
    assets: {
      coinSources: ['assets/textures/satin.png', 'assets/fonts/Lexend-Variable.ttf'],
      remote: false,
      three: 'vendor/three.module.js',
    },
  };
}

function publish() {
  const debug = buildDebug();
  if (dom.diag) dom.diag.textContent = JSON.stringify(debug);
  dom.body.dataset.qaReady = state.ready ? '1' : '0';
  dom.body.dataset.qaErrors = String(state.errors.length);
  dom.body.dataset.time = state.time.toFixed(3);
  dom.body.dataset.playing = state.playing ? '1' : '0';
  dom.body.dataset.phase = state.reducedMotion ? 'still' : state.shot ? 'shot' : state.playing ? 'loop' : 'paused';
  return debug;
}

const api = {
  version: VERSION,
  debug() {
    return buildDebug();
  },
  config() {
    return MODEL;
  },
  getTime() {
    return round(state.time, 3);
  },
  setTime(time) {
    if (!state.ready) return false;
    state.time = wrapTime(time);
    state.playing = false;
    updateControls();
    applyPose(state.time);
    paintFrame();
    publish();
    return true;
  },
  play() {
    if (!state.ready || state.shot || state.reducedMotion) return false;
    setPlaying(true);
    publish();
    return true;
  },
  pause() {
    setPlaying(false);
    publish();
    return true;
  },
  replay() {
    const ok = replay();
    publish();
    return ok;
  },
  setShot(time) {
    if (!state.ready) return false;
    state.shot = true;
    dom.body.dataset.shot = '1';
    state.playing = false;
    state.time = wrapTime(time === undefined ? DEFAULT_SHOT_TIME : time);
    updateControls();
    applyPose(state.time);
    paintFrame();
    publish();
    return true;
  },
  pose() {
    return state.pose;
  },
  camera() {
    return state.cameraFit;
  },
  project(position) {
    return projectWorld(position);
  },
  reducedMotionPose() {
    return stackedCoinsReducedMotionPose();
  },
  debugScene() {
    const rows = [];
    const visit = (object) => {
      if (object.isMesh) {
        const material = object.material;
        const list = Array.isArray(material) ? material : [material];
        rows.push({
          name: object.name,
          type: object.type,
          position: [round(object.position.x, 3), round(object.position.y, 3), round(object.position.z, 3)],
          visible: object.visible,
          materials: list.filter(Boolean).map((entry) => ({
            name: entry.name,
            type: entry.type,
            color: entry.color ? '#' + entry.color.getHexString() : null,
            emissive: entry.emissive ? '#' + entry.emissive.getHexString() : null,
            opacity: entry.opacity,
            transparent: entry.transparent,
            blending: entry.blending,
          })),
        });
      }
      for (const child of object.children) visit(child);
    };
    if (state.scene) visit(state.scene);
    return rows;
  },
};

window.__stackedCoins = api;

/* --------------------------------------------------------------- teardown */

function dispose() {
  window.clearInterval(state.diagTimer);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  if (state.resizeObserver) state.resizeObserver.disconnect();
  if (state.studio) {
    try { state.studio.dispose(); } catch (error) { /* best effort */ }
  }
  for (const entry of state.coins) {
    try { entry.coin.dispose(); } catch (error) { /* best effort */ }
  }
  state.coins = [];
  state.materials.face.length = 0;
  state.materials.band.length = 0;
  if (state.bank) {
    try { state.bank.dispose(); } catch (error) { /* best effort */ }
  }
  state.bank = null;
  if (state.renderer) {
    try { state.renderer.dispose(); } catch (error) { /* best effort */ }
  }
}

bootPage();
