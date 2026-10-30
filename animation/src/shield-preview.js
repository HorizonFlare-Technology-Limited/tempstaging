/**
 * tekoanimation ??Security shield preview controller.
 *
 * Standalone collection page controller for `shield.html`
 * (docs/props-contract.md 禮P1): a dark-gunmetal Revolut-style shield with a
 * polished bevelled rim, a recessed convex face and the TEKO arrow emblem
 * embossed in two-tone gold. Rev21 lighting: the shield is lit ONLY by the
 * shared room photograph `assets/env/modern-empty-room.jpg`, filtered once
 * through PMREM by ./env-room.js (no THREE lights, no procedural studio); the
 * metal's whole look is the dark interior reflected through its albedo.
 *
 * Camera: fixed three-quarter default pose (azimuth 26簞, elevation 12簞),
 * numerically fitted to the shield at every stage size (1440x900 / 1200x900 /
 * 390x844). Drag to orbit inside the clamps; double-click / R / Reset returns to
 * the default pose. There is no idle animation: the only motion is the user's
 * own orbit, so `?still=1` / `?shot=1` and reduced motion are deterministic by
 * construction (they snap instead of easing).
 *
 * The model itself is `src/shield-model.js`; the emblem is the local
 * `assets/shield/teko2_icon.svg` (copied byte-identically from
 * K:\HFWorkspace\icons\teko2_icon.svg) parsed at runtime.
 *
 * Emblem palette: the page ships a colour switch (`?logo=gold|white|black|silver`
 * plus `adaptive`, and the selector under the stage). A palette only re-tints the
 * embossed relief's two facets — the emblem geometry, silhouette, relief and
 * camera are shared by every palette, and the edge around the mark is always the
 * background tone (see LOGO_PALETTES / LOGO_EDGE_BACKGROUND in the model). The
 * URL value is applied before the first frame, so `?logo=…&still=1` captures are
 * deterministic, and the selector syncs the address bar as it changes.
 *
 * QA hook: window.__tekoShield = { ready, errors, warnings, debug(), reset(),
 * setPose(), logoPalettes(), getLogoPalette(), setLogoPalette() } plus
 * body[data-qa-*] attributes and the hidden #qa-diag JSON.
 */
import * as THREE from 'three';
import * as ShieldModel from './shield-model.js';
import { applyEnvRoom } from './env-room.js';

const VERSION = '1.1.0';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ------------------------------------------------------------------ spec */

const MODEL = ShieldModel;
const CAMERA = MODEL.CAMERA_SPEC;
const SHIELD = MODEL.SHIELD_SPEC;

/** The single emblem geometry every palette shares (shape source). */
const LOGO_URL = new URL('../assets/shield/teko2_icon.svg', import.meta.url);
const LOGO_RELATIVE = './assets/shield/teko2_icon.svg';
/** Folder holding the palette reference variants copied from K:\HFWorkspace\icons. */
const LOGO_ASSET_BASE = new URL('../assets/shield/logo/', import.meta.url);

/* ------------------------------------------------------------ render tuning */

const RENDERER = Object.freeze({ exposure: 3.4, dprMax: 2 });

/**
 * Rev21 image-based lighting (the only light source on the page).
 *
 * `assets/env/modern-empty-room.jpg` is a dark interior with bright ceiling
 * downlights; ./env-room.js filters it into a PMREM and assigns it to
 * `scene.environment`. On r151 the requested intensity multiplies each
 * material's own `envMapIntensity` (the shield's body/bevel/logo finishes keep
 * their authored ratios), so the gunmetal reads through the room's reflection
 * instead of being lit directly. No THREE light objects exist on this page.
 */
const ENV_ROOM = Object.freeze({
  intensity: 4.0,
  label: 'assets/env/modern-empty-room.jpg (PMREM, env-room)',
});

/** Baked soft contact shadow under the floating shield (deterministic canvas). */
const CONTACT_SHADOW = Object.freeze({
  width: 1.5,
  depth: 0.66,
  y: -0.676,
  opacity: 0.22,
  textureSize: [256, 128],
});

/** Orbit easing (per second). Static modes snap instead of easing. */
const ORBIT = Object.freeze({ damping: 16 });

const TAU = Math.PI * 2;
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

function cameraBasis(azimuthDeg, elevationDeg) {
  const azimuth = degToRad(azimuthDeg);
  const elevation = degToRad(elevationDeg);
  const direction = viewDirection(azimuthDeg, elevationDeg);
  return {
    direction,
    right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)),
    up: new THREE.Vector3(
      -Math.sin(azimuth) * Math.sin(elevation),
      Math.cos(elevation),
      -Math.cos(azimuth) * Math.sin(elevation),
    ),
    forward: direction.clone().negate(),
  };
}

/* ------------------------------------------------------------- early qa state */

const qa = IS_BROWSER
  ? (window.__TEKO_SHIELD_QA = window.__TEKO_SHIELD_QA || { errors: [], warnings: [], webgl: null })
  : { errors: [], warnings: [], webgl: null };
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];

function pushError(message) {
  qa.errors.push('shield-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}

function pushWarning(message) {
  qa.warnings.push('shield-preview: ' + message);
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
  logoSha256: null,
  logoBytes: 0,
  /** Raw `?logo=` value (id or alias; may be unknown ??the model falls back). */
  logoPaletteRequest: urlParams.get('logo') || MODEL.DEFAULT_LOGO_PALETTE,
  /** Resolved palette currently painted on the model (plain JSON from the model). */
  logoPalette: null,
  /** Provenance fingerprint of the palette's source icon (async, best effort). */
  logoSourceFingerprint: null,
  logoSourceFingerprintToken: 0,
  still: urlParams.get('still') === '1',
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches),
  watchdog: 0,
  publishTimer: 0,
};

/** Static/deterministic modes snap the pose and never ease (no idle motion). */
function isStaticMode() {
  return state.still || state.shot || state.reducedMotion;
}

/* ------------------------------------------------------------------- dom */

const dom = {};

function initDom() {
  const byId = (id) => document.getElementById(id);
  dom.body = document.body;
  dom.page = byId('page');
  dom.stage = byId('stage');
  dom.canvas = byId('stage-canvas');
  dom.stageHint = byId('stage-hint');
  dom.stageVeil = byId('stage-veil');
  dom.veilText = byId('veil-text');
  dom.btnReset = byId('btn-reset');
  dom.poseState = byId('pose-state');
  dom.infoFootState = byId('info-foot-state');
  dom.footerStatus = byId('footer-status');
  dom.specSilhouette = byId('spec-silhouette');
  dom.specSize = byId('spec-size');
  dom.specThickness = byId('spec-thickness');
  dom.specBody = byId('spec-body');
  dom.specBevel = byId('spec-bevel');
  dom.specMetalness = byId('spec-metalness');
  dom.specRoughness = byId('spec-roughness');
  dom.specLogo = byId('spec-logo');
  dom.specLogoPalette = byId('spec-logo-palette');
  dom.specLogoTones = byId('spec-logo-tones');
  dom.specLogoSource = byId('spec-logo-source');
  dom.paletteGroup = byId('logo-palette');
  dom.assetTagPalette = byId('asset-tag-palette');
  dom.layerChipEmblem = byId('layer-chip-emblem');
  dom.layerSwatchEmblem = byId('layer-swatch-emblem');
  dom.headerEmblem = byId('header-emblem');
  dom.stageDetail = byId('stage-detail');
  dom.stageName = byId('stage-name');
  dom.infoRegion = byId('info-region');
  dom.specCamera = byId('spec-camera');
  dom.specTriangles = byId('spec-triangles');
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
  const safe = clamp(Number(ratio) || 0, 0, 1);
  if (dom.loadingBar) dom.loadingBar.style.width = (safe * 100).toFixed(1) + '%';
  if (label && dom.loadingLabel) dom.loadingLabel.textContent = label;
  if (count !== undefined && dom.loadingCount) dom.loadingCount.textContent = String(count);
  if (title && dom.loadingTitle) dom.loadingTitle.textContent = title;
}

function hideCurtain() {
  if (!dom.curtain) return;
  dom.curtain.classList.add('is-hidden');
  dom.curtain.setAttribute('aria-hidden', 'true');
  if (isStaticMode() || state.qaMode) {
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

function syncPoseReadout() {
  const studio = state.studio;
  const pose = studio ? studio.getPose() : { azimuthDeg: CAMERA.azimuthDeg, elevationDeg: CAMERA.elevationDeg };
  if (dom.poseState) {
    dom.poseState.textContent = round(pose.azimuthDeg, 0) + '\u00b0 / ' + round(pose.elevationDeg, 0) + '\u00b0';
  }
}

function syncObjectFacts() {
  const model = state.model;
  if (!model) return;
  const spec = model.spec;
  const materials = model.materials;
  const face = materials.face.userData;
  const bevel = materials.bevel.userData;
  if (dom.specSilhouette) dom.specSilhouette.innerHTML = '349 &times; 461 px &middot; 0.757';
  if (dom.specSize) dom.specSize.textContent = spec.width.toFixed(3) + ' / ' + spec.height.toFixed(3);
  if (dom.specThickness) dom.specThickness.textContent = spec.thickness.toFixed(3);
  if (dom.specBody) dom.specBody.textContent = face.specColorHex;
  if (dom.specBevel) dom.specBevel.textContent = bevel.specColorHex;
  if (dom.specMetalness) dom.specMetalness.textContent = Number(materials.face.metalness).toFixed(2);
  if (dom.specRoughness) dom.specRoughness.textContent = Number(materials.face.roughness).toFixed(2);
  if (dom.specLogo) dom.specLogo.textContent = 'teko2_icon.svg';
  if (dom.specCamera) dom.specCamera.textContent = CAMERA.azimuthDeg + '\u00b0 / ' + CAMERA.elevationDeg + '\u00b0 three-quarter';
  if (dom.specTriangles) dom.specTriangles.textContent = model.stats.triangles.toLocaleString('en-US');
}

function syncUi() {
  const model = state.model;
  if (dom.btnReset) dom.btnReset.disabled = !state.ready || state.failed;
  syncPoseReadout();
  if (dom.infoFootState) {
    dom.infoFootState.textContent = state.failed ? 'Static fallback' : state.ready ? 'Gunmetal shield \u00b7 ready' : 'Preparing';
  }
  if (dom.footerStatus) {
    dom.footerStatus.textContent = state.failed ? 'Static fallback' : state.ready ? 'Ready' : 'Loading';
  }
  if (dom.stageHint) dom.stageHint.textContent = 'Drag to orbit';
  if (dom.stage && state.ready) dom.stage.classList.remove('is-busy');
  if (model && dom.assetNote) {
    dom.assetNote.innerHTML =
      'Copied byte-identically from <span class="mono">K:\\HFWorkspace\\icons</span> \u00b7 ' +
      (state.logoBytes ? state.logoBytes + ' B' : 'local') +
      ' \u00b7 no network';
  }
}

/* --------------------------------------------------------- logo palette */

/**
 * Resolve palette data for a palette value. The model supplies the render data
 * (tones, socket, contrast, provenance); adaptive is resolved against the panel
 * albedo of the live model when there is one.
 */
function resolvedPaletteFor(value) {
  const model = state.model;
  const surfaceHex = model && model.materials && model.materials.face ? model.materials.face.userData.specColorHex : null;
  return MODEL.resolveLogoPalette(value, { surfaceHex });
}

/**
 * Fill the selector from the model spec: labels, two-tone swatches (CSS custom
 * properties) and titles come from LOGO_PALETTES, so markup and model cannot
 * drift apart. Clicking a chip selects that palette.
 */
function buildPaletteSelector() {
  if (!dom.paletteGroup) return;
  for (const button of dom.paletteGroup.querySelectorAll('[data-logo-palette]')) {
    const id = button.getAttribute('data-logo-palette');
    const palette = MODEL.LOGO_PALETTES[id];
    if (!palette) {
      button.hidden = true;
      continue;
    }
    const resolved = resolvedPaletteFor(id);
    const name = button.querySelector('.palette-name');
    if (name) name.textContent = palette.label;
    const swatch = button.querySelector('.palette-swatch');
    if (swatch && resolved) {
      swatch.style.setProperty('--swatch-bright', resolved.tones.bright.hex);
      swatch.style.setProperty('--swatch-deep', resolved.tones.deep.hex);
    }
    button.setAttribute('aria-label', palette.label + ' emblem palette');
    button.setAttribute(
      'title',
      palette.label + ' \u2014 ' + palette.summary + (resolved && resolved.variantLabel ? ' (this surface: ' + resolved.variantLabel + ')' : ''),
    );
    button.addEventListener('click', () => {
      selectLogoPalette(id, { announceIt: true, syncUrl: true });
    });
  }
}

/** Reflect the active palette in the address bar without adding history entries. */
function syncPaletteUrl(paletteId) {
  if (!IS_BROWSER || !window.history || typeof window.history.replaceState !== 'function') return;
  try {
    const url = new URL(window.location.href);
    if (!paletteId || paletteId === MODEL.DEFAULT_LOGO_PALETTE) url.searchParams.delete('logo');
    else url.searchParams.set('logo', paletteId);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch (error) {
    /* the address bar is a convenience; never break the page for it */
  }
}

/** Update every piece of UI that names the emblem palette. */
function syncPaletteUi() {
  const resolved = state.logoPalette;
  const label = resolved ? resolved.label : 'Brand Gold';
  const lower = label.toLowerCase();
  // Gold keeps the shipped copy wording ("TEKO gold emblem/relief"); the other
  // palettes read their own label (white / graphite / silver / adaptive).
  const caption = resolved && resolved.id === 'gold' ? 'gold' : lower;
  if (dom.paletteGroup) {
    for (const button of dom.paletteGroup.querySelectorAll('[data-logo-palette]')) {
      const active = Boolean(resolved) && button.getAttribute('data-logo-palette') === resolved.id;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.classList.toggle('is-active', active);
    }
  }
  if (dom.stageDetail) dom.stageDetail.textContent = 'TEKO ' + caption + ' relief';
  if (dom.infoRegion) dom.infoRegion.textContent = 'Gunmetal plate \u00b7 TEKO ' + caption + ' emblem';
  if (dom.headerEmblem) dom.headerEmblem.textContent = 'TEKO ' + caption + ' emblem';
  if (dom.assetTagPalette && resolved) {
    const first = resolved.sources[0];
    dom.assetTagPalette.textContent = first ? first.file : 'teko2_icon-gold.svg';
    dom.assetTagPalette.classList.toggle('asset-tag--gold', resolved.id === 'gold');
  }
  if (dom.layerSwatchEmblem && resolved) {
    dom.layerSwatchEmblem.style.setProperty('--swatch-bright', resolved.tones.bright.hex);
    dom.layerSwatchEmblem.style.setProperty('--swatch-deep', resolved.tones.deep.hex);
  }
  if (dom.layerChipEmblem) dom.layerChipEmblem.classList.toggle('layer-chip--gold', !resolved || resolved.id === 'gold');
  if (dom.specLogoPalette) {
    dom.specLogoPalette.textContent = label + (resolved && resolved.variantLabel ? ' (' + resolved.variantLabel + ')' : '');
  }
  if (dom.specLogoTones && resolved) {
    dom.specLogoTones.textContent = resolved.tones.bright.hex + ' / ' + resolved.tones.deep.hex;
  }
  if (dom.specLogoSource && resolved) {
    const first = resolved.sources[0];
    dom.specLogoSource.textContent = first ? first.file : '\u2014';
  }
}

/** SHA-256 of a UTF-8 string, or null when the platform has no subtle crypto. */
async function sha256Hex(text) {
  if (!IS_BROWSER || typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder !== 'function') return null;
  try {
    const encoded = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    return null;
  }
}

/**
 * Fingerprint the palette's source icon variant (a local fetch, no network) so
 * debug()/QA can prove the colour scheme really comes from the copied brand
 * asset. Best effort: a missing asset only records a warning.
 */
async function loadPaletteFingerprint(resolved) {
  state.logoSourceFingerprintToken += 1;
  const token = state.logoSourceFingerprintToken;
  state.logoSourceFingerprint = null;
  const paletteSource = resolved && resolved.sources ? resolved.sources[0] : null;
  if (!paletteSource) {
    publishState();
    return;
  }
  try {
    const response = await fetch(new URL(paletteSource.file, LOGO_ASSET_BASE).href, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    const sha256 = await sha256Hex(text);
    // Report the on-disk byte length (UTF-8), not the UTF-16 code-unit count.
    const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length;
    if (token !== state.logoSourceFingerprintToken) return;
    state.logoSourceFingerprint = { file: paletteSource.file, bytes, sha256, origin: paletteSource.original };
  } catch (error) {
    if (token !== state.logoSourceFingerprintToken) return;
    state.logoSourceFingerprint = { file: paletteSource.file, bytes: 0, sha256: null, error: errorMessage(error) };
    pushWarning('palette source asset unavailable: ' + paletteSource.file);
  }
  publishState();
}

/**
 * r151: ./env-room.js scaled every material's `envMapIntensity` by the room
 * intensity at boot. Switching the emblem palette repaints the three logo
 * materials and resets them to their authored intensities, so the room
 * multiplier is re-applied here (before the first render of the new palette).
 * On r163+ the scene-level `environmentIntensity` already covers this.
 */
function reapplyEnvIntensityToLogo() {
  const studio = state.studio;
  const model = state.model;
  if (!studio || !studio.room || studio.room.sceneLevel || !model || !model.materials) return;
  for (const key of ['goldBright', 'goldDeep', 'socket']) {
    const material = model.materials[key];
    if (material && 'envMapIntensity' in material) material.envMapIntensity *= ENV_ROOM.intensity;
  }
}

/**
 * Select an emblem palette. The model only re-tints its three logo materials, so
 * silhouette, relief, camera and triangle count stay exactly as built; the page
 * then re-renders, syncs the URL and updates its copy. Returns the resolved
 * palette, or null when the value is unknown (a warning is recorded).
 */
function selectLogoPalette(value, options = {}) {
  const model = state.model;
  if (!model || state.failed) return null;
  const resolved = model.setLogoPalette(value, options.surfaceHex ? { surfaceHex: options.surfaceHex } : {});
  if (!resolved) {
    pushWarning('unknown logo palette "' + String(value) + '" (expected ' + MODEL.LOGO_PALETTE_IDS.join('|') + ')');
    publishState();
    return null;
  }
  state.logoPalette = resolved;
  state.logoPaletteRequest = resolved.id;
  reapplyEnvIntensityToLogo();
  syncPaletteUi();
  syncObjectFacts();
  if (options.syncUrl !== false) syncPaletteUrl(resolved.id);
  if (state.studio) state.studio.renderNow();
  loadPaletteFingerprint(resolved);
  publishState();
  if (options.announceIt !== false) {
    announce('Emblem palette: ' + resolved.label + (resolved.variantLabel ? ' (' + resolved.variantLabel + ')' : ''));
  }
  return resolved;
}

/* ------------------------------------------------------------------ studio */

class ShieldStudio {
  constructor({ canvas, stage, model, reducedMotion = false, still = false, shot = false }) {
    this.canvas = canvas;
    this.stage = stage;
    this.model = model;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.room = null;
    this.contactShadow = null;
    this.stageBox = { width: 1, height: 1 };
    this.cameraTarget = new THREE.Vector3();
    this.targetCameraTarget = new THREE.Vector3();
    this.pose = { azimuthDeg: CAMERA.azimuthDeg, elevationDeg: CAMERA.elevationDeg };
    this.targetPose = { azimuthDeg: CAMERA.azimuthDeg, elevationDeg: CAMERA.elevationDeg };
    this.distance = 3;
    this.targetDistance = 3;
    this.renderCount = 0;
    this.firstFrameRendered = false;
    this.firstFrameResolve = null;
    this.needsRender = true;
    this.raf = 0;
    this.lastTime = 0;
    this.destroyed = false;
    this.reducedMotion = Boolean(reducedMotion);
    this.still = Boolean(still);
    this.shot = Boolean(shot);
    this.resizeObserver = null;
    this.dragging = false;
    this.orbitActive = false;
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
    scene.name = 'shield-studio';
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.5, CAMERA.near, CAMERA.far);
    camera.name = 'shield-camera';
    this.camera = camera;

    this.room = await applyEnvRoom(THREE, renderer, scene, { intensity: ENV_ROOM.intensity });
    this.buildContactShadow();

    scene.add(this.model.root);
    // r151: the material pass above ran before the shield existed, so re-apply
    // the room intensity to the model's materials now that they are in the graph.
    this.room.refresh(scene);

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.stage);
    } else {
      this.boundResize = () => this.resize();
      window.addEventListener('resize', this.boundResize);
    }
    this.applyPose({ snap: true });
    this.resize();

    this.boundLoop = this.boundLoop || ((now) => this.loop(now));
    this.raf = window.requestAnimationFrame(this.boundLoop);
    return this;
  }

  /** Baked soft contact shadow under the floating plate. */
  buildContactShadow() {
    const [width, height] = CONTACT_SHADOW.textureSize;
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
    gradient.addColorStop(0.38, 'rgba(0, 0, 0, 0.4)');
    gradient.addColorStop(0.72, 'rgba(0, 0, 0, 0.12)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, width / 2, 0, TAU);
    ctx.fill();
    ctx.restore();
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'shield-contact-shadow';
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    texture.userData = { role: 'contact-shadow', procedural: true, local: true };
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: CONTACT_SHADOW.opacity,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(CONTACT_SHADOW.width, CONTACT_SHADOW.depth), material);
    shadow.name = 'studio-contact-shadow';
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, CONTACT_SHADOW.y, 0);
    shadow.renderOrder = 1;
    this.scene.add(shadow);
    this.contactShadow = shadow;
  }

  requestRender() {
    this.needsRender = true;
  }

  /* ------------------------------------------------------------ camera fit */

  /**
   * Closed-form fit for the fixed view direction: for a point p with view-space
   * offsets xv = (p - target)繚right, yv = (p - target)繚up and depth d + c, the
   * constraints |xv| <= maxX*depth and |yv| <= maxY*depth give d >= |xv|/maxX - c
   * and d >= |yv|/maxY - c. The target is then shifted along the camera's
   * up/right axes so the projected silhouette is centred, and the fit re-solved.
   */
  solveFitDistance(target, basis, maxX, maxY, points) {
    let distance = CAMERA.near + 2;
    for (let index = 0; index < points.length; index += 3) {
      const rx = points[index] - target.x;
      const ry = points[index + 1] - target.y;
      const rz = points[index + 2] - target.z;
      const xv = rx * basis.right.x + ry * basis.right.y + rz * basis.right.z;
      const yv = rx * basis.up.x + ry * basis.up.y + rz * basis.up.z;
      const c = rx * basis.forward.x + ry * basis.forward.y + rz * basis.forward.z;
      distance = Math.max(distance, Math.abs(xv) / maxX - c, Math.abs(yv) / maxY - c);
    }
    return distance;
  }

  computeFit(azimuthDeg, elevationDeg) {
    const bounds = this.model.bounds;
    const baseTarget = new THREE.Vector3(
      bounds.center.x,
      bounds.center.y + CAMERA.targetYOffset,
      bounds.center.z,
    );
    const aspect = (this.stageBox.width || 1) / (this.stageBox.height || 1);
    const narrow = (this.stageBox.width || 0) < CAMERA.narrowStageWidth;
    const margin = narrow ? CAMERA.fitMarginNarrow : CAMERA.fitMargin;
    const tanHalf = Math.tan(degToRad(CAMERA.fov) / 2);
    const maxX = margin * tanHalf * aspect;
    const maxY = margin * tanHalf;
    const basis = cameraBasis(azimuthDeg, elevationDeg);
    const points = this.model.fitPoints;
    const target = baseTarget.clone();
    let distance = 3;

    if (points && points.length >= 3) {
      const probe = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
      const projected = new THREE.Vector3();
      for (let iteration = 0; iteration < 4; iteration += 1) {
        distance = this.solveFitDistance(target, basis, maxX, maxY, points);
        probe.position.copy(target).addScaledVector(basis.direction, distance);
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
        if (Math.abs(centerX) < 0.0015 && Math.abs(centerY) < 0.0015) break;
        target.addScaledVector(basis.up, centerY * distance * tanHalf);
        target.addScaledVector(basis.right, centerX * distance * tanHalf * aspect);
      }
      distance = this.solveFitDistance(target, basis, maxX, maxY, points);
    }
    return { target, distance: clamp(distance, CAMERA.near + 1, CAMERA.far * 0.7) };
  }

  placeCamera() {
    if (!this.camera) return;
    const basis = cameraBasis(this.pose.azimuthDeg, this.pose.elevationDeg);
    this.camera.position.copy(this.cameraTarget).addScaledVector(basis.direction, this.distance);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Move the target pose (clamped) and refit; `snap` disables easing. */
  setPose(azimuthDeg, elevationDeg, { snap = false } = {}) {
    const azimuth = clamp(Number(azimuthDeg), CAMERA.yawMinDeg, CAMERA.yawMaxDeg);
    const elevation = clamp(Number(elevationDeg), CAMERA.pitchMinDeg, CAMERA.pitchMaxDeg);
    this.targetPose.azimuthDeg = azimuth;
    this.targetPose.elevationDeg = elevation;
    const fit = this.computeFit(azimuth, elevation);
    this.targetDistance = fit.distance;
    this.targetCameraTarget.copy(fit.target);
    if (snap || !this.motionAllowed()) this.applyPose({ snap: true });
    else this.orbitActive = true;
    return this.getPose();
  }

  applyPose({ snap = true } = {}) {
    if (snap) {
      this.orbitActive = false;
      this.pose.azimuthDeg = this.targetPose.azimuthDeg;
      this.pose.elevationDeg = this.targetPose.elevationDeg;
      this.distance = this.targetDistance;
      this.cameraTarget.copy(this.targetCameraTarget);
      this.placeCamera();
      return;
    }
  }

  reset({ snap = false } = {}) {
    return this.setPose(CAMERA.azimuthDeg, CAMERA.elevationDeg, { snap: snap || !this.motionAllowed() });
  }

  getPose() {
    return {
      azimuthDeg: this.pose.azimuthDeg,
      elevationDeg: this.pose.elevationDeg,
      targetAzimuthDeg: this.targetPose.azimuthDeg,
      targetElevationDeg: this.targetPose.elevationDeg,
      defaultAzimuthDeg: CAMERA.azimuthDeg,
      defaultElevationDeg: CAMERA.elevationDeg,
    };
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

  updateOrbit(dtSeconds) {
    if (!this.orbitActive || !this.motionAllowed()) return;
    const easing = 1 - Math.exp(-ORBIT.damping * dtSeconds);
    const pose = this.pose;
    const target = this.targetPose;
    pose.azimuthDeg += (target.azimuthDeg - pose.azimuthDeg) * easing;
    pose.elevationDeg += (target.elevationDeg - pose.elevationDeg) * easing;
    this.distance += (this.targetDistance - this.distance) * easing;
    this.cameraTarget.lerp(this.targetCameraTarget, easing);
    const settled =
      Math.abs(target.azimuthDeg - pose.azimuthDeg) < 0.02 &&
      Math.abs(target.elevationDeg - pose.elevationDeg) < 0.02 &&
      Math.abs(this.targetDistance - this.distance) < 0.0005 &&
      this.cameraTarget.distanceTo(this.targetCameraTarget) < 0.0005;
    if (settled) {
      pose.azimuthDeg = target.azimuthDeg;
      pose.elevationDeg = target.elevationDeg;
      this.distance = this.targetDistance;
      this.cameraTarget.copy(this.targetCameraTarget);
      this.orbitActive = false;
    }
    this.placeCamera();
    if (settled) this.emitChange();
  }

  /* --------------------------------------------------------------- render */

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

  loop(now) {
    if (this.destroyed) return;
    this.raf = window.requestAnimationFrame(this.boundLoop);
    const previous = this.lastTime || now;
    const dt = Math.min(64, Math.max(0, now - previous));
    this.lastTime = now;
    this.updateOrbit(dt / 1000);
    if (this.needsRender) this.renderFrame();
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
    const fit = this.computeFit(this.targetPose.azimuthDeg, this.targetPose.elevationDeg);
    this.targetDistance = fit.distance;
    this.targetCameraTarget.copy(fit.target);
    this.applyPose({ snap: true });
  }

  /* ---------------------------------------------------------------- debug */

  getCameraDebug() {
    if (!this.camera) return null;
    return {
      azimuthDeg: round(this.pose.azimuthDeg, 2),
      elevationDeg: round(this.pose.elevationDeg, 2),
      targetAzimuthDeg: round(this.targetPose.azimuthDeg, 2),
      targetElevationDeg: round(this.targetPose.elevationDeg, 2),
      defaultAzimuthDeg: CAMERA.azimuthDeg,
      defaultElevationDeg: CAMERA.elevationDeg,
      distance: round(this.camera.position.distanceTo(this.cameraTarget), 4),
      fov: CAMERA.fov,
      near: CAMERA.near,
      far: CAMERA.far,
      aspect: round(this.camera.aspect, 4),
      position: [round(this.camera.position.x, 4), round(this.camera.position.y, 4), round(this.camera.position.z, 4)],
      target: [round(this.cameraTarget.x, 4), round(this.cameraTarget.y, 4), round(this.cameraTarget.z, 4)],
      clamps: {
        yawMinDeg: CAMERA.yawMinDeg,
        yawMaxDeg: CAMERA.yawMaxDeg,
        pitchMinDeg: CAMERA.pitchMinDeg,
        pitchMaxDeg: CAMERA.pitchMaxDeg,
      },
      fitMargin: this.stageBox.width < CAMERA.narrowStageWidth ? CAMERA.fitMarginNarrow : CAMERA.fitMargin,
      narrowStage: this.stageBox.width < CAMERA.narrowStageWidth,
      dragging: this.dragging,
    };
  }

  /** Object-only screen bbox (stage-local px) used for framing / clipping checks. */
  getObjectScreenRect() {
    if (!this.camera || !this.model) return null;
    const width = this.stageBox.width || 1;
    const height = this.stageBox.height || 1;
    const points = this.model.fitPoints;
    const projected = new THREE.Vector3();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
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
      left: round(minX, 2),
      top: round(minY, 2),
      right: round(maxX, 2),
      bottom: round(maxY, 2),
      width: round(maxX - minX, 2),
      height: round(maxY - minY, 2),
      w: round(maxX - minX, 2),
      h: round(maxY - minY, 2),
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
      toneMappingExposure: RENDERER.exposure,
      shadowMapEnabled: Boolean(this.renderer && this.renderer.shadowMap.enabled),
      // Rev21: image-based lighting only. The page has zero THREE light objects;
      // every material is lit by the PMREM of the shared room photograph.
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
    if (this.boundResize) {
      window.removeEventListener('resize', this.boundResize);
      this.boundResize = null;
    }
    if (this.model && this.model.root && this.scene) this.scene.remove(this.model.root);
    if (this.contactShadow) {
      this.scene.remove(this.contactShadow);
      this.contactShadow.geometry.dispose();
      if (this.contactShadow.material.map) this.contactShadow.material.map.dispose();
      this.contactShadow.material.dispose();
      this.contactShadow = null;
    }
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
  const studio = new ShieldStudio({
    canvas: dom.canvas,
    stage: dom.stage,
    model: state.model,
    reducedMotion: state.reducedMotion,
    still: state.still,
    shot: state.shot,
  });
  studio.onChange = () => {
    syncPoseReadout();
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

function doReset({ announceIt = true } = {}) {
  const studio = state.studio;
  if (!studio || state.failed) return false;
  studio.reset({ snap: !studio.motionAllowed() });
  syncUi();
  publishState();
  if (announceIt) announce('View reset to the three-quarter pose');
  return true;
}

function doSetPose(azimuthDeg, elevationDeg, options = {}) {
  const studio = state.studio;
  if (!studio || state.failed) return null;
  const pose = studio.setPose(azimuthDeg, elevationDeg, { snap: Boolean(options.snap) || !studio.motionAllowed() });
  syncUi();
  publishState();
  return pose;
}

function materialsDebug() {
  const model = state.model;
  if (!model) return null;
  const out = {};
  for (const [key, material] of Object.entries(model.materials)) {
    out[key] = {
      name: material.name,
      role: material.userData ? material.userData.role : null,
      color: material.userData ? material.userData.specColorHex : null,
      metalness: round(material.metalness, 4),
      roughness: round(material.roughness, 4),
      envMapIntensity: round(material.envMapIntensity, 4),
      maps: {
        map: Boolean(material.map),
        normalMap: Boolean(material.normalMap),
        roughnessMap: Boolean(material.roughnessMap),
        metalnessMap: Boolean(material.metalnessMap),
        aoMap: Boolean(material.aoMap),
        emissiveMap: Boolean(material.emissiveMap),
      },
      bakedLighting: Boolean(material.map || material.emissiveMap),
    };
  }
  return out;
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
      supported: Boolean(state.webgl),
      version: state.webgl || '',
    },
    camera: studio ? studio.getCameraDebug() : null,
    objectRect: studio ? studio.getObjectScreenRect() : null,
    stageRect: null,
    model: model
      ? {
          version: model.version,
          spec: {
            width: model.spec.width,
            height: model.spec.height,
            ratio: round(model.spec.width / model.spec.height, 4),
            thickness: model.spec.thickness,
            topCornerRadius: model.spec.topCornerRadius,
            sideEndY: model.spec.sideEndY,
            bottomSlope: model.spec.bottomSlope,
            bottomFilletRadius: model.spec.bottomFilletRadius,
            tipRadius: model.spec.tipRadius,
            panelInset: model.spec.front.panelInset,
            bevelCrestZ: model.spec.front.bevelCrestZ,
            panelEdgeZ: model.spec.front.panelEdgeZ,
            panelBulge: model.spec.front.panelBulge,
          },
          silhouette: {
            source: 'refs/shield-ref.png bbox 349 x 461 px',
            ratio: round(model.spec.width / model.spec.height, 4),
            samples: model.stats.samples,
            topCorners: 'rounded',
            bottomPoint: 'rounded point',
            bevelledRim: true,
            recessedPanel: true,
            convexFace: true,
          },
          bounds: {
            min: [round(model.bounds.min.x, 4), round(model.bounds.min.y, 4), round(model.bounds.min.z, 4)],
            max: [round(model.bounds.max.x, 4), round(model.bounds.max.y, 4), round(model.bounds.max.z, 4)],
            size: [round(model.bounds.size.x, 4), round(model.bounds.size.y, 4), round(model.bounds.size.z, 4)],
            center: [round(model.bounds.center.x, 4), round(model.bounds.center.y, 4), round(model.bounds.center.z, 4)],
          },
          stats: {
            triangles: model.stats.triangles,
            meshes: model.stats.meshes,
            parts: model.stats.parts,
          },
          logo: model.logo
            ? {
                source: LOGO_RELATIVE,
                sourceUrl: LOGO_URL.href,
                geometrySource: LOGO_RELATIVE,
                sha256: state.logoSha256,
                bytes: state.logoBytes,
                width: round(model.logo.width, 4),
                height: round(model.logo.height, 4),
                relief: model.logo.relief,
                center: [model.spec.logo.centerX, model.spec.logo.centerY],
                shapes: model.logo.shapes,
                triangleCount: model.logo.triangleCount,
                twoTone: model.logo.shapes.some((shape) => shape.tone === 'bright') && model.logo.shapes.some((shape) => shape.tone === 'deep'),
                /** Background-toned edge rule + shoulder geometry (round 5). */
                edge: model.logo.edge,
                palette: state.logoPalette || model.logoPalette || null,
                paletteRequested: state.logoPaletteRequest,
                paletteIds: MODEL.LOGO_PALETTE_IDS,
                paletteSource: state.logoSourceFingerprint,
                palettes: MODEL.LOGO_PALETTE_IDS.map((id) => {
                  const resolved = MODEL.resolveLogoPalette(id, {
                    surfaceHex: model.materials.face.userData.specColorHex,
                  });
                  return resolved
                    ? {
                        id: resolved.id,
                        label: resolved.label,
                        bright: resolved.tones.bright.hex,
                        deep: resolved.tones.deep.hex,
                        socket: resolved.socket.hex,
                        edgeBackground: resolved.edge ? resolved.edge.background : null,
                        variant: resolved.variant,
                        contrastVsSurface: resolved.contrast.brightVsSurface,
                        socketVsSurface: resolved.contrast.socketVsSurface,
                      }
                    : null;
                }).filter(Boolean),
              }
            : null,
          materials: materialsDebug(),
        }
      : null,
    flags: {
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      qaMode: Boolean(state.qaMode),
      reducedMotion: Boolean(state.reducedMotion),
      fallback: Boolean(state.failed),
      staticMode: isStaticMode(),
      logoPalette: (state.logoPalette || (model && model.logoPalette) || { id: null }).id,
    },
    urls: {
      page: IS_BROWSER ? window.location.href : '',
      logo: IS_BROWSER ? LOGO_URL.href : LOGO_RELATIVE,
      logoAssets: LOGO_ASSET_BASE.href,
      modelModule: './src/shield-model.js',
      three: './vendor/three.module.js',
    },
    render: studio ? studio.getRenderDebug() : null,
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
  debug: buildDebug,
  reset(options) {
    return doReset(options || {});
  },
  setPose(azimuthDeg, elevationDeg, options) {
    return doSetPose(azimuthDeg, elevationDeg, options || {});
  },
  /** Emblem palette ids in presentation order (`?logo=` accepts each one). */
  logoPalettes() {
    return MODEL.LOGO_PALETTE_IDS.slice();
  },
  /** Currently painted emblem palette (resolved JSON), or null before boot. */
  getLogoPalette() {
    return state.logoPalette || (state.model ? state.model.logoPalette : null);
  },
  /** Switch the emblem palette in place; returns the resolved palette or null. */
  setLogoPalette(value, options) {
    return selectLogoPalette(value, options || {});
  },
  readyPromise() {
    return readyPromise;
  },
};
if (IS_BROWSER) window.__tekoShield = api;

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
  if (dom.btnReset) dom.btnReset.disabled = true;
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

/* --------------------------------------------------------------------- ui */

function dragPose() {
  return state.studio ? state.studio.getPose() : { azimuthDeg: CAMERA.azimuthDeg, elevationDeg: CAMERA.elevationDeg };
}

function wireUi() {
  if (dom.btnReset) {
    dom.btnReset.addEventListener('click', () => {
      doReset();
    });
  }

  // Drag-to-orbit with pointer capture; the pose is clamped in studio.setPose.
  let drag = null;
  const canvas = dom.canvas;
  if (canvas) {
    canvas.addEventListener('pointerdown', (event) => {
      if (!state.studio || state.failed) return;
      if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      const pose = dragPose();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        azimuthDeg: pose.azimuthDeg,
        elevationDeg: pose.elevationDeg,
        moved: false,
      };
      state.studio.dragging = true;
      canvas.classList.add('is-dragging');
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* pointer capture is best effort */
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag || !state.studio) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      state.studio.setPose(
        drag.azimuthDeg + dx * CAMERA.dragSensitivity,
        drag.elevationDeg + dy * CAMERA.dragSensitivity,
      );
      syncPoseReadout();
    });
    const endDrag = (event) => {
      if (!drag) return;
      const wasMoved = drag.moved;
      drag = null;
      if (state.studio) state.studio.dragging = false;
      canvas.classList.remove('is-dragging');
      if (event && event.pointerId !== undefined) {
        try {
          if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        } catch (error) {
          /* release is best effort */
        }
      }
      if (wasMoved) announce('Orbiting the shield');
      syncPoseReadout();
      publishState();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      doReset();
    });
    canvas.addEventListener('contextmenu', (event) => {
      // Right-drag / long-press should not pop the native menu over the studio.
      if (drag) event.preventDefault();
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const studio = state.studio;
    if (!studio || state.failed) return;
    const pose = studio.getPose();
    const nudge = (dAzimuth, dElevation) => {
      event.preventDefault();
      studio.setPose(pose.targetAzimuthDeg + dAzimuth, pose.targetElevationDeg + dElevation, {
        snap: !studio.motionAllowed(),
      });
      syncPoseReadout();
      publishState();
    };
    if (event.key === 'r' || event.key === 'R') {
      // Ignore R when the focused element is the reset button (its click fires).
      if (target === dom.btnReset) return;
      event.preventDefault();
      doReset();
    } else if (event.key === 'ArrowLeft') {
      nudge(-3, 0);
    } else if (event.key === 'ArrowRight') {
      nudge(3, 0);
    } else if (event.key === 'ArrowUp') {
      nudge(0, 3);
    } else if (event.key === 'ArrowDown') {
      nudge(0, -3);
    } else if (/^[1-9]$/.test(event.key)) {
      // 1?? select the emblem palette (the numbers on the selector chips).
      const paletteId = MODEL.LOGO_PALETTE_IDS[Number(event.key) - 1];
      if (paletteId) {
        event.preventDefault();
        selectLogoPalette(paletteId);
      }
    } else if (event.key === 'Home') {
      event.preventDefault();
      doReset();
    }
  });

  if (reducedMotionQuery) {
    const onChange = (event) => {
      state.reducedMotion = Boolean(event.matches);
      if (state.studio) {
        state.studio.reducedMotion = state.reducedMotion;
        if (state.reducedMotion) state.studio.applyPose({ snap: true });
      }
      if (dom.body) dom.body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
      syncUi();
      publishState();
    };
    if (typeof reducedMotionQuery.addEventListener === 'function') reducedMotionQuery.addEventListener('change', onChange);
    else if (typeof reducedMotionQuery.addListener === 'function') reducedMotionQuery.addListener(onChange);
  }
}

/* ------------------------------------------------------------------ publish */

function publishState() {
  if (!IS_BROWSER) return;
  const body = dom.body || document.body;
  const studio = state.studio;
  const model = state.model;
  const pose = studio ? studio.getPose() : { azimuthDeg: CAMERA.azimuthDeg, elevationDeg: CAMERA.elevationDeg };
  const objectRect = studio ? studio.getObjectScreenRect() : null;
  body.dataset.qaReady = state.ready ? '1' : '0';
  body.dataset.qaErrors = String(qa.errors.length);
  body.dataset.qaWarnings = String(qa.warnings.length);
  body.dataset.qaWebgl = state.webgl ? '1' : '0';
  body.dataset.qaFallback = state.failed ? '1' : '0';
  body.dataset.qaPose = round(pose.azimuthDeg, 1) + ',' + round(pose.elevationDeg, 1);
  body.dataset.qaDefaultPose = CAMERA.azimuthDeg + ',' + CAMERA.elevationDeg;
  if (model) {
    body.dataset.qaBody = model.materials.face.userData.specColorHex;
    body.dataset.qaBevel = model.materials.bevel.userData.specColorHex;
    body.dataset.qaLogo = 'assets/shield/teko2_icon.svg';
    body.dataset.qaLogoShapes = String(model.logo ? model.logo.shapes.length : 0);
    body.dataset.qaTriangles = String(model.stats.triangles);
    const palette = state.logoPalette || model.logoPalette || null;
    body.dataset.qaLogoPalette = palette ? palette.id : '';
    body.dataset.qaLogoPaletteLabel = palette ? palette.label : '';
    body.dataset.qaLogoVariant = palette && palette.variant ? palette.variant : '';
    body.dataset.qaLogoBright = palette ? palette.tones.bright.hex : '';
    body.dataset.qaLogoDeep = palette ? palette.tones.deep.hex : '';
    body.dataset.qaLogoSocket = palette ? palette.socket.hex : '';
    body.dataset.qaLogoContrast = palette ? String(palette.contrast.brightVsSurface) : '';
    body.dataset.qaLogoSource = palette && palette.sources.length ? palette.sources[0].file : '';
    const fingerprint = state.logoSourceFingerprint;
    body.dataset.qaLogoSourceSha = fingerprint && fingerprint.sha256 ? fingerprint.sha256 : '';
    body.dataset.qaLogoSourceBytes = fingerprint && fingerprint.bytes ? String(fingerprint.bytes) : '';
    body.dataset.qaLogoGeometry = 'assets/shield/teko2_icon.svg';
  }
  body.dataset.qaDistance = studio ? String(round(studio.distance, 3)) : '';
  body.dataset.qaObjectRect = objectRect
    ? [objectRect.left, objectRect.top, objectRect.width, objectRect.height].map((value) => String(value)).join(',')
    : '';
  body.dataset.still = state.still ? '1' : '0';
  body.dataset.shot = state.shot ? '1' : '0';
  body.dataset.qaMode = state.qaMode ? '1' : 'live';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  if (dom.stageHint && state.shot) dom.stageHint.setAttribute('aria-hidden', 'true');
  syncPoseReadout();
  if (dom.diag) {
    try {
      dom.diag.textContent = JSON.stringify(buildDebug());
    } catch (error) {
      dom.diag.textContent = '{"error":"debug serialization failed"}';
    }
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
          document.fonts.load('300 30px Lexend').catch(() => {}),
          document.fonts.load('600 14px Lexend').catch(() => {}),
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
    /* font readiness only affects DOM layout stability */
  }
}

/* -------------------------------------------------------------------- logo */

async function loadLogoSvg() {
  curtainProgress(0.12, 'Loading TEKO emblem', '0 / 0');
  const response = await fetch(LOGO_URL.href, { cache: 'no-store' });
  if (!response.ok) throw new Error('emblem request failed with HTTP ' + response.status);
  const svgText = await response.text();
  if (!/<svg[\s>]/i.test(svgText) || !/<path[\s>]/i.test(svgText)) {
    throw new Error('emblem asset is not an SVG path artwork');
  }
  state.logoBytes = svgText.length;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder === 'function') {
    try {
      const encoded = new TextEncoder().encode(svgText);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      state.logoSha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      state.logoBytes = encoded.length;
    } catch (error) {
      state.logoSha256 = null;
    }
  }
  return svgText;
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  state.booting = true;
  api.ready = false;

  if (dom.body) {
    dom.body.dataset.fallback = '0';
    dom.body.dataset.qaReady = '0';
    dom.body.dataset.qaMode = state.qaMode ? '1' : 'live';
    dom.body.dataset.still = state.still ? '1' : '0';
    dom.body.dataset.shot = state.shot ? '1' : '0';
    dom.body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  }
  syncUi();
  publishState();

  curtainProgress(0.04, 'Detecting WebGL', '0 / 0');
  const webgl = probeWebGL();
  state.webgl = webgl;
  qa.webgl = webgl;
  if (!webgl) {
    showFallback(
      'WebGL is not available in this browser, so the interactive security shield cannot be rendered. A static poster of the gunmetal shield is shown below.',
    );
    resolveReady(false);
    return;
  }

  curtainProgress(0.08, 'Loading type', '');
  await waitForFonts();

  let svgText = null;
  try {
    svgText = await loadLogoSvg();
  } catch (error) {
    showFallback(
      'The TEKO emblem asset could not be loaded (' + errorMessage(error) + '), so the shield cannot be built. A static poster is shown below.',
      { error, banner: true },
    );
    resolveReady(false);
    return;
  }

  curtainProgress(0.62, 'Building the shield', '');
  let model = null;
  try {
    model = MODEL.createShieldModel({
      logoSvgText: svgText,
      logoSourcePath: LOGO_RELATIVE,
      logoPalette: state.logoPaletteRequest,
    });
    state.model = model;
    state.logoPalette = model.logoPalette;
  } catch (error) {
    showFallback('The shield model could not be built (' + errorMessage(error) + '). A static poster is shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }
  if (!model || !model.root || !model.logo) {
    showFallback('The shield model did not produce the expected embossed TEKO emblem.');
    resolveReady(false);
    return;
  }
  if (Array.isArray(model.warnings) && model.warnings.length > 0) {
    for (const warning of model.warnings) pushWarning('model: ' + warning);
  }

  curtainProgress(0.76, 'Starting the studio', '');
  try {
    state.studio = createStudio();
    await state.studio.init();
    const contextLost = (event) => {
      event.preventDefault();
      showFallback('WebGL context was lost, so a static poster of the shield is shown below.');
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
  studio.still = state.still;
  studio.shot = state.shot;
  studio.reducedMotion = state.reducedMotion;
  studio.reset({ snap: true });
  syncUi();
  publishState();

  curtainProgress(0.94, 'Fitting the studio', '');
  studio.resize();
  studio.renderNow();
  await studio.whenFirstFrame();

  hideCurtain();
  state.ready = true;
  state.booting = false;
  api.ready = true;
  window.clearTimeout(state.watchdog);
  syncPaletteUi();
  syncObjectFacts();
  syncUi();
  publishState();
  loadPaletteFingerprint(state.logoPalette);
  announce('Security shield ready');
  studio.renderNow();
  resolveReady(true);
}

/* -------------------------------------------------------------------- main */

function main() {
  initDom();
  wireUi();
  buildPaletteSelector();
  syncUi();
  publishState();

  boot().catch((error) => {
    if (!state.failed) {
      showFallback('The shield preview failed to start (' + errorMessage(error) + '). A static poster is shown below.', { error, banner: true });
    }
    resolveReady(false);
  });

  state.watchdog = window.setTimeout(() => {
    if (!state.ready && !state.failed) {
      showFallback('The interactive preview did not start within 20 seconds. A static poster is shown below.', { banner: true });
      resolveReady(false);
    }
  }, 20000);

  state.publishTimer = window.setInterval(() => {
    if (state.failed) return;
    publishState();
  }, 400);

  window.addEventListener('pagehide', () => {
    window.clearTimeout(state.watchdog);
    window.clearInterval(state.publishTimer);
    if (state.studio) {
      state.studio.dispose();
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
  });
}

if (IS_BROWSER) main();

export { VERSION, ShieldStudio };
