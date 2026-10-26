/**
 * tekoanimation — metal card preview controller.
 *
 * Owns the page shell wiring, the QA hooks (contract §4.5) and the three.js
 * studio: a two-card glossy sleek-steel composition (light card front-left, dark
 * card behind-right) on a dark studio backdrop.
 *
 * Lighting contract (round 7): exactly ONE key PointLight, placed to the RIGHT of
 * the live default camera (screen-right at the 45°/20° view), aimed at the
 * composition centre, castShadow. The metal highlight therefore reads from the
 * camera's right and the authored soft shadow is offset to camera-left (the user
 * requirement). Overall brightness is tuned down (key intensity, exposure,
 * ambient fill and PMREM panel radiance) while keeping the print, bevel rims and
 * mirror reflections legible. No second shadow caster and no side/rim key.
 *
 * The card meshes themselves (geometry + textures + PBR materials) come from
 * ./card-model.js through the frozen API; this module never builds card
 * textures. A stale/missing model degrades to a static duo of the two original
 * source PNGs, exactly like the coin page's static fallback.
 */
import * as THREE from 'three';
const VERSION = '1.0.0';

// Dynamic on purpose: a missing / broken model module must degrade gracefully.
const MODEL_URL = new URL('./card-model.js', import.meta.url);
const ASSET_BASE = './assets/textures/card';
const SOURCE_DUO = Object.freeze({
  dark: './assets/textures/card/source/novocard-default-dark.png',
  light: './assets/textures/card/source/novocard-default-light.png',
});

const DEFAULT_POSE = Object.freeze({ yawDeg: 0, pitchDeg: 0 });
// Interactive drag is clamped to ±60° / ±28° (contract §4.3). The QA hook
// setPose() may go further so an inspection view of the backs is possible
// (contract §5 asks for setPose(180, 0)).
const POSE_LIMITS = Object.freeze({ yawDeg: 60, pitchDeg: 28 });
const HARD_LIMITS = Object.freeze({ yawDeg: 180, pitchDeg: 90 });
// Contract R5.2: the default camera is a ~45-degree three-quarter view around
// the composition (azimuth around the vertical axis, elevation above the
// horizon). Round 7 keeps that view but moves the single shadow-casting key
// light to the camera's right, so the highlight reads from screen-right.
const CAMERA_SPEC = Object.freeze({
  fov: 32,
  azimuthDeg: 45,
  elevationDeg: 20,
  near: 0.1,
  far: 160,
  minDistance: 4.2,
  maxDistance: 40,
});
const CAMERA_AXIS = (() => {
  const azimuth = (CAMERA_SPEC.azimuthDeg * Math.PI) / 180;
  const elevation = (CAMERA_SPEC.elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();
})();
const FIT = Object.freeze({ margin: 1.04, pad: 0.18 });
const BACKDROP = Object.freeze({ radius: 90 });
// Contract §4.2 (Revision 6): the key is still exactly ONE shadow-casting
// PointLight aimed at the composition centre, but it no longer sits at the
// camera. It is offset toward the camera's RIGHT by KEY_LIGHT.rightDeg (screen-
// right at the default 45°/20° view) plus a small upward lift, and placed on a
// CLOSER radius around the composition (distanceScale < 1). The closer, right-
// side key is what makes the falloff read across each face from screen-right to
// screen-left instead of lighting them flat like a lens light; the intensity is
// lowered accordingly (the accepted camera-coincident key was 7.0 at the full
// camera radius).
// Round 7 (user requirement): the whole rig is dimmer than the round-5 build —
// the key is 7.0 -> 3.7 at 0.62x the camera radius, exposure 0.92 -> 0.89, the
// ambient fill 0.17 -> 0.13 and the PMREM panel radiance is scaled down (the
// right panel stays the brightest so the reflective sheen also reads from the
// right) — with print/bevel/mirror detail still legible.
const KEY_LIGHT = Object.freeze({
  color: 0xfff2e2,
  intensity: 3.7,
  decay: 2,
  distance: 20,
  // Directional offset from the camera axis, in degrees: +right is the camera's
  // screen-right side, +up lifts the light slightly above the camera axis.
  rightDeg: 20,
  upDeg: 5,
  // Light radius as a fraction of the live camera distance. < 1 pulls the key
  // closer to the pair, which strengthens the right-to-left falloff across the
  // cards (and offsets the lower intensity value above).
  distanceScale: 0.62,
});
// Fraction of the projected key offset applied to the authored soft-shadow
// decals (1 = physically projected by the key angle, >1 exaggerates it so the
// cast shadow still reads on the backdrop with the key held to a modest angle).
const SHADOW_SHIFT = 1.9;
const AMBIENT = Object.freeze({ color: 0xa8bcd6, intensity: 0.13 });
// Round 2: purpose-built PMREM studio environment. Only reflections (env is
// reflection fill, not a direct light); the room below the camera axis is bright
// so every rounded corner/bevel picks up a continuous bright rim arc. The back
// panel is the soft face sheen, the four side/ceiling/floor panels are the rim
// sources; the camera-facing wall behind the subject stays dark.
// Round 7: every panel is dimmed and the right panel is the strongest, so the
// reflective sheen (like the key highlight) reads from the camera's right.
const ENV = Object.freeze({
  room: 0x05070a,
  panels: Object.freeze([
    { name: 'env-back', color: 0xfff1e2, intensity: 0.72, width: 34, height: 20, position: [0, 2.2, 14], gradient: true },
    { name: 'env-ceiling', color: 0xd9e6f6, intensity: 1.8, width: 34, height: 34, position: [0, 9.6, 0], gradient: true },
    { name: 'env-floor', color: 0xe8dcc6, intensity: 1.35, width: 34, height: 34, position: [0, -9.6, 0], gradient: true },
    { name: 'env-left', color: 0xcfdff2, intensity: 1.2, width: 30, height: 20, position: [-14.5, 0.4, 0], gradient: true },
    { name: 'env-right', color: 0xffffff, intensity: 2.5, width: 30, height: 20, position: [14.5, 0.4, 0], gradient: true },
    { name: 'env-front', color: 0x223044, intensity: 0.06, width: 34, height: 20, position: [0, 0, -14.5], gradient: false },
  ]),
});
const DRAG = Object.freeze({ yawPerPx: 0.26, pitchPerPx: 0.2, minVelocity: 5 });

// Slot transforms (degrees) — light card front-left (larger), dark card
// behind-right (smaller), partially overlapped but with every card landmark
// (chip / Mastercard / Teko mark) left visible.
const SLOTS = Object.freeze({
  front: Object.freeze({ position: [-0.6, -0.38, 0.52], rotation: [2.2, -4.5, -6.0], scale: 0.96, card: 'light' }),
  back: Object.freeze({ position: [1.02, 0.96, -0.22], rotation: [-2.0, 8.0, 4.5], scale: 0.8, card: 'dark' }),
});

const SWAP_DURATION = 0.9;
const AUTO = Object.freeze({ speed: 0.52, yawAmplitude: 19, pitchAmplitude: 2.4 });
const FLOAT = Object.freeze({ y: 0.014, tilt: 0.0016, speed: 0.82 });
// Round 3 "reflection" presentation mode: a dark glass table below the floating
// pair mirrors both cards (mirrored clone layer + gradient glass sheet), and the
// card materials' environment response is boosted. OFF is the accepted round-2
// render (no floor, baseline env values).
const REFLECTION = Object.freeze({
  // The pair floats just above the dark glass table; the mirror image starts
  // right below the lowest card and is framed with a visible, fading band.
  floorY: -1.90,
  // The far edge sits exactly at the backdrop plane (z = -1.35) so the glass
  // table meets the backdrop without a visible seam; the near edge is behind the
  // camera and therefore never visible.
  // At the 45-degree default view the visible floor region spans x ~-18..5.4
  // (desktop) so the plane must be wider than the old frontal framing; the
  // authored alphaMap still fades the borders so no plane edge can appear.
  floorWidth: 48,
  floorDepth: 12,
  floorCenterZ: -1.35 + 6,
  // glass coverage is authored directly in the alphaMap; this opacity is a
  // global multiplier driven by the ON/OFF weight
  floorOpacity: 1,
  // Round 5 iteration: instead of a separate black fade overlay (which turned
  // the large near floor region into a hard-edged black slab at 45 degrees), the
  // glass alphaMap itself carries the fade: a subtle semi-transparent mirror
  // band (so the reflection reads), a nearly opaque dark-glass surface on the
  // near/bottom part (so the deeper mirrored geometry dissolves and the table
  // reads as a continuous surface), and a soft dissolve at the far edge.
  mirrorCoverage: 0.12,
  nearCoverage: 0.95,
  fadeNearV: 0.69,
  mirrorFadeTopV: 0.74,
  farFadeStart: 0.92,
  glassCoverage: 0.12,
  cloneOpacity: 0.92,
  // ghost (mirror) materials are dimmed/tinted/roughened so the reflection reads
  // as a soft 15-30 % echo of the cards instead of a crisp duplicate
  ghostTint: 1.0,
  ghostRoughnessLift: 0.18,
  ghostEnvMax: 0.55,
  ghostSpecularMax: 0.4,
  transitionSeconds: 0.25,
  // How much of the mirrored card image is framed below the pair when ON. The
  // cards' own transforms are untouched; only the camera refits to include the
  // glass table, exactly like the auto-fit already frames the pair.
  frameBand: 0.8,
  // Round 3 reflection boost: shared front/back values and the LIGHT card's
  // polished edge boost. Round 4 makes the edge boost per card: the dark card's
  // satin frame must never turn into a white line in reflection mode, so its
  // edge is boosted only slightly from its own OFF value (contract R4.2).
  envOn: Object.freeze({ front: 1.6, edge: 2.7, back: 0.8, backLight: 2.95 }),
  // Revision 6: the backs are per-card reconstructed artwork with their own OFF
  // envMapIntensity (dark 0.70 / light 2.40). The shared R3 value 0.8 is still
  // the dark back's ON target; the light back needs its own slightly higher ON
  // target so reflection mode brightens both backs instead of dimming the white
  // one (see docs/card-model-contract.md R6.3).
  darkEdgeScale: 1.15,
  darkEdgeMin: 1.0,
  darkEdgeMax: 1.25,
});
const PLANE_Z = new THREE.Vector3(0, 0, 1);

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const degToRad = (deg) => (deg * Math.PI) / 180;
const radToDeg = (rad) => (rad * 180) / Math.PI;
const round = (value, digits = 2) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* ------------------------------------------------------------------ dom */

const dom = {
  body: document.body,
  page: document.getElementById('page'),
  stage: document.getElementById('stage'),
  canvas: document.getElementById('stage-canvas'),
  stageEyebrow: document.getElementById('stage-eyebrow-text'),
  stageCode: document.getElementById('stage-code'),
  stageName: document.getElementById('stage-name'),
  stageHint: document.getElementById('stage-hint'),
  stageVeil: document.getElementById('stage-veil'),
  veilText: document.getElementById('veil-text'),
  btnReset: document.getElementById('btn-reset'),
  btnSwap: document.getElementById('btn-swap'),
  btnAuto: document.getElementById('btn-auto'),
  btnReflection: document.getElementById('btn-reflection'),
  infoFootState: document.getElementById('info-foot-state'),
  specDark: document.getElementById('spec-dark'),
  specLight: document.getElementById('spec-light'),
  specMetalness: document.getElementById('spec-metalness'),
  specClearcoat: document.getElementById('spec-clearcoat'),
  assetTags: document.getElementById('asset-tags'),
  assetNote: document.getElementById('asset-note'),
  footerStatus: document.getElementById('footer-status'),
  curtain: document.getElementById('loading'),
  loadingBar: document.getElementById('loading-bar'),
  loadingTitle: document.getElementById('loading-title'),
  loadingLabel: document.getElementById('loading-label'),
  loadingCount: document.getElementById('loading-count'),
  errorBanner: document.getElementById('error-banner'),
  errorText: document.getElementById('error-text'),
  fallback: document.getElementById('fallback'),
  fallbackMessage: document.getElementById('fallback-message'),
  liveStatus: document.getElementById('live-status'),
  diag: document.getElementById('qa-diag'),
};

/* --------------------------------------------------------------- qa state */

const qa = (window.__TEKO_CARD_QA = window.__TEKO_CARD_QA || { errors: [], warnings: [], webgl: null });
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];

function pushError(message) {
  qa.errors.push('card-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}

function pushWarning(message) {
  qa.warnings.push('card-preview: ' + message);
  if (qa.warnings.length > 60) qa.warnings.splice(0, qa.warnings.length - 60);
}

function errorMessage(error) {
  if (!error) return 'Unknown error';
  const message = error.message ? String(error.message) : String(error);
  return message.length > 240 ? message.slice(0, 237) + '...' : message;
}

const urlParams = new URLSearchParams(window.location.search);
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  ready: false,
  failed: false,
  booting: true,
  bank: null,
  studio: null,
  specs: [],
  cards: { dark: null, light: null },
  metrics: null,
  still: urlParams.get('still') === '1',
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  reducedMotion: reducedMotionQuery.matches,
  frozen: false,
  autoRotate: false,
  reflection: urlParams.get('reflection') !== '0',
  pose: { yawDeg: 0, pitchDeg: 0 },
  swapFront: 'light',
  bootStartedAt: 0,
  watchdog: 0,
};

function motionAllowed() {
  return !state.still && !state.frozen && !state.reducedMotion;
}

/* --------------------------------------------------------------- progress */

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

function showErrorBanner(message) {
  if (!dom.errorBanner) return;
  dom.errorText.textContent = message;
  dom.errorBanner.hidden = false;
}

function announce(message) {
  if (dom.liveStatus) dom.liveStatus.textContent = message;
}

/* -------------------------------------------------------------- ui sync */

function specById(id) {
  return state.specs.find((spec) => spec.id === id) || null;
}

function syncVariantInfo() {
  const dark = specById('dark');
  const light = specById('light');
  if (dark && dom.specDark) dom.specDark.textContent = dark.source || dark.face || 'novocard-default-dark.png';
  if (light && dom.specLight) dom.specLight.textContent = light.source || light.face || 'novocard-default-light.png';
  const front = state.cards.light && state.cards.light.materials ? state.cards.light.materials.front : null;
  if (front) {
    if (dom.specMetalness && typeof front.metalness === 'number') dom.specMetalness.textContent = front.metalness.toFixed(2);
    if (dom.specClearcoat && typeof front.clearcoat === 'number') dom.specClearcoat.textContent = front.clearcoat.toFixed(2);
  }
}

function syncSwappedUi() {
  const swapped = state.swapFront === 'dark';
  if (dom.btnSwap) dom.btnSwap.setAttribute('aria-pressed', String(swapped));
  if (dom.btnAuto) dom.btnAuto.setAttribute('aria-pressed', String(state.autoRotate));
  if (dom.stageName) dom.stageName.textContent = swapped ? 'Light + Dark' : 'Dark + Light';
  if (dom.stageCode) dom.stageCode.textContent = swapped ? 'SWAP' : 'DUO';
  if (dom.infoFootState) dom.infoFootState.textContent = swapped ? 'Swapped · dark in front' : 'Default view';
  if (dom.stageHint) dom.stageHint.textContent = swapped ? 'Drag to rotate · F to swap back' : 'Drag to rotate';
  if (state.ready && dom.footerStatus) dom.footerStatus.textContent = swapped ? 'Swapped' : 'Ready';
}

function syncAutoUi() {
  if (!dom.btnAuto) return;
  const disabled = state.reducedMotion || state.still || state.frozen;
  dom.btnAuto.setAttribute('aria-pressed', String(state.autoRotate && !disabled));
  dom.btnAuto.disabled = disabled;
  if (disabled && state.reducedMotion) {
    dom.btnAuto.title = 'Auto-rotate is disabled by the reduced-motion preference.';
  } else if (disabled) {
    dom.btnAuto.title = 'Auto-rotate is disabled in this deterministic view.';
  } else {
    dom.btnAuto.removeAttribute('title');
  }
}

function syncReflectionUi() {
  if (!dom.btnReflection) return;
  dom.btnReflection.disabled = !state.ready || state.failed;
  dom.btnReflection.setAttribute('aria-pressed', String(Boolean(state.reflection)));
  dom.btnReflection.title = state.reflection
    ? 'Reflection on — click or press E to hide the glass-table reflection.'
    : 'Reflection off — click or press E to mirror the cards on the glass table.';
}

function syncPoseUi() {
  const pose = state.studio ? state.studio.getPose() : state.pose;
  state.pose = { yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };
  const swapped = state.studio ? state.studio.getOrder().front === 'dark' : state.swapFront === 'dark';
  state.swapFront = swapped ? 'dark' : 'light';
}

function publishState() {
  const body = dom.body;
  body.dataset.qaReady = state.ready ? '1' : '0';
  body.dataset.qaErrors = String(qa.errors.length);
  body.dataset.qaCards = state.specs.map((spec) => spec.id).join(',');
  const pose = state.studio ? state.studio.getPose() : state.pose;
  body.dataset.qaPose = round(pose.yawDeg, 1) + ',' + round(pose.pitchDeg, 1);
  body.dataset.qaComposition = 'duo';
  body.dataset.fallback = state.failed ? '1' : '0';
  body.dataset.swapped = state.swapFront === 'dark' ? '1' : '0';
  body.dataset.frozen = state.frozen || state.still ? '1' : '0';
  body.dataset.autoRotate = state.autoRotate ? '1' : '0';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.qaReflection = state.reflection ? '1' : '0';
  if (dom.diag) dom.diag.textContent = JSON.stringify(buildDebug());
}

/* --------------------------------------------------------------- debug */

function textureInfo(tex) {
  const image = tex.image || null;
  let url = '';
  let width = 0;
  let height = 0;
  if (image) {
    url = image.currentSrc || image.src || '';
    width = image.naturalWidth || image.width || 0;
    height = image.naturalHeight || image.height || 0;
  }
  if (!url && tex.userData && tex.userData.url) url = String(tex.userData.url);
  return { url, width, height };
}

function collectAssetInfo() {
  const textures = [];
  const urls = [];
  const seen = new Set();
  const keys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'aoMap', 'emissiveMap'];
  const add = (texture) => {
    if (!texture || seen.has(texture)) return;
    seen.add(texture);
    const info = textureInfo(texture);
    textures.push(info);
    if (info.url) urls.push(info.url);
  };
  for (const id of ['dark', 'light']) {
    const card = state.cards[id];
    if (!card || !card.materials) continue;
    for (const part of ['front', 'back', 'edge']) {
      const material = card.materials[part];
      if (!material) continue;
      for (const key of keys) add(material[key]);
    }
  }
  let sameOrigin = true;
  for (const url of urls) {
    try {
      if (new URL(url, window.location.href).origin !== window.location.origin) sameOrigin = false;
    } catch (error) {
      sameOrigin = false;
    }
  }
  const uniqueUrls = Array.from(new Set(urls));
  return { sameOrigin, urls: uniqueUrls, textures };
}

function materialProps(material) {
  return {
    metalness: round(typeof material.metalness === 'number' ? material.metalness : 0, 3),
    roughness: round(typeof material.roughness === 'number' ? material.roughness : 1, 3),
    clearcoat: round(typeof material.clearcoat === 'number' ? material.clearcoat : 0, 3),
    clearcoatRoughness: round(typeof material.clearcoatRoughness === 'number' ? material.clearcoatRoughness : 0, 3),
    envMapIntensity: round(typeof material.envMapIntensity === 'number' ? material.envMapIntensity : 1, 3),
    normalScale: material.normalScale
      ? [round(material.normalScale.x, 3), round(material.normalScale.y, 3)]
      : null,
    // Round 4: the model tags materials with an intended sRGB color/finish in
    // userData (the dark frame's linear material color would print too dark via
    // getHexString, so userData is the authoritative display value).
    color: material.userData && material.userData.color ? String(material.userData.color) : null,
    finish: material.userData && material.userData.finish ? String(material.userData.finish) : null,
    maps: {
      map: Boolean(material.map),
      normalMap: Boolean(material.normalMap),
      roughnessMap: Boolean(material.roughnessMap),
      clearcoatNormalMap: Boolean(material.clearcoatNormalMap),
      metalnessMap: Boolean(material.metalnessMap),
    },
  };
}

function materialDebug(id) {
  const card = state.cards[id];
  const material = card && card.materials ? card.materials.front : null;
  if (!material) return null;
  return { id, role: 'front', ...materialProps(material) };
}

// Round 2 QA: the bezel/edge material must be reported explicitly (the model
// exposes card.materials.edge). QA asserts edge roughness <= 0.2,
// envMapIntensity >= 1.2 and clearcoat >= 0.4 on the delivered build.
function edgeMaterialDebug(id) {
  const card = state.cards[id];
  const material = card && card.materials ? card.materials.edge : null;
  if (!material) return null;
  return { id, role: 'edge', ...materialProps(material) };
}

// Same shape for the back material: QA round 2 asserts a back material is
// present per card in every state (debug().backMaterials must be populated).
// Revision 6: the back is now per-card reconstructed artwork, so the debug
// entry also exposes the model's back-artwork contract (map files, ORM channel
// layout, normal convention) and proves that the SAME ORM texture feeds both
// roughnessMap and metalnessMap (three r151 samples .g / .b from one upload).
function backMaterialDebug(id) {
  const card = state.cards[id];
  const material = card && card.materials ? card.materials.back : null;
  if (!material) return null;
  const userData = material.userData || {};
  const debug = { id, role: 'back', ...materialProps(material) };
  debug.artwork = userData.artwork ? JSON.parse(JSON.stringify(userData.artwork)) : null;
  debug.sharedOrmMap = Boolean(
    material.roughnessMap && material.metalnessMap && material.roughnessMap === material.metalnessMap
  );
  return debug;
}

function buildDebug() {
  const studio = state.studio;
  const debug = {
    version: VERSION,
    ready: Boolean(state.ready),
    errors: qa.errors.slice(),
    warnings: qa.warnings.slice(),
    stageRect: null,
    webgl: {
      supported: Boolean(studio && studio.renderer) || Boolean(qa.webgl),
      version: studio ? studio.getWebGLVersion() : qa.webgl || '',
    },
    cards: state.specs.map((spec) => spec.id),
    composition: 'duo',
    pose: { yawDeg: 0, pitchDeg: 0 },
    defaultPose: { yawDeg: DEFAULT_POSE.yawDeg, pitchDeg: DEFAULT_POSE.pitchDeg },
    camera: {
      position: [0, 0, 0],
      target: [0, 0, 0],
      fov: CAMERA_SPEC.fov,
      distance: 0,
      axis: [round(CAMERA_AXIS.x, 4), round(CAMERA_AXIS.y, 4), round(CAMERA_AXIS.z, 4)],
      azimuthDeg: CAMERA_SPEC.azimuthDeg,
      elevationDeg: CAMERA_SPEC.elevationDeg,
      specAzimuthDeg: CAMERA_SPEC.azimuthDeg,
      specElevationDeg: CAMERA_SPEC.elevationDeg,
      aspect: 1,
    },
    keyLight: {
      type: 'PointLight',
      position: [0, 0, 0],
      target: [0, 0, 0],
      intensity: 0,
      castShadow: false,
      shadowMapSize: [0, 0],
      positionMode: 'camera-right-offset',
      offsetDeg: { right: KEY_LIGHT.rightDeg, up: KEY_LIGHT.upDeg },
    },
    lights: { directional: 0, shadowCasters: 0, ambient: 0 },
    materials: [],
    edgeMaterials: [],
    backMaterials: [],
    reflection: null,
    assets: { sameOrigin: true, urls: [], textures: [] },
    render: { triangles: 0, drawCalls: 0, pixelRatio: 1, shadowMapEnabled: false, frames: 0 },
    flags: {
      frozen: Boolean(state.frozen || state.still || state.shot),
      autoRotate: Boolean(state.autoRotate),
      reducedMotion: Boolean(state.reducedMotion),
      fallback: Boolean(state.failed),
      still: Boolean(state.still),
      shot: Boolean(state.shot),
      qaMode: Boolean(state.qaMode),
    },
    order: { front: 'light', back: 'dark' },
  };
  if (studio) {
    const pose = studio.getPose();
    debug.pose = { yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };
    debug.order = studio.getOrder();
    const camera = studio.getCameraDebug();
    debug.camera = camera;
    debug.keyLight = studio.getKeyLightDebug();
    debug.lights = studio.getLightCounts();
    debug.materials = ['dark', 'light'].map(materialDebug).filter(Boolean);
    debug.edgeMaterials = ['dark', 'light'].map(edgeMaterialDebug).filter(Boolean);
    debug.backMaterials = ['dark', 'light'].map(backMaterialDebug).filter(Boolean);
    debug.reflection = studio.getReflectionDebug();
    // Calibration aid: projected mirror-layer screen bbox + sampled floor alpha
    // values (glass coverage / fade overlay) so captures can be checked against
    // where the reflection actually lands.
    try {
      Object.assign(debug.reflection, studio.getReflectionScreenDebug());
    } catch (error) {
      /* instrumentation is best effort */
    }
    debug.render = studio.getRenderDebug();
    try {
      debug.assets = collectAssetInfo();
    } catch (error) {
      debug.assets = { sameOrigin: false, urls: [], textures: [], error: errorMessage(error) };
    }
  }
  try {
    const stageElement = document.getElementById('stage');
    if (stageElement) {
      const rect = stageElement.getBoundingClientRect();
      const x = round(rect.x, 2);
      const y = round(rect.y, 2);
      const width = round(rect.width, 2);
      const height = round(rect.height, 2);
      debug.stageRect = {
        x,
        y,
        width,
        height,
        w: width,
        h: height,
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

/* =========================================================================
   Studio — renderer, scene, lights, backdrop, composition, interactions.
   ========================================================================= */

/* --------------------------------------------------- studio environment */
/* A purpose-built PMREM room: dark cyclorama shell + large emissive softboxes.
   PMREM renders it with tone mapping disabled, so the panel colours are true
   HDR radiance values. Only the environment map is produced - no scene light. */

function makeEnvSoftboxTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(size * 0.5, size * 0.45, size * 0.03, size * 0.5, size * 0.5, size * 0.62);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.82)');
  gradient.addColorStop(0.75, 'rgba(255,255,255,0.30)');
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
    new THREE.BoxGeometry(36, 22, 36),
    new THREE.MeshBasicMaterial({ color: ENV.room, side: THREE.BackSide })
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
    mesh.lookAt(0, 0, 0);
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

/* ----------------------------------------------------- reflection helpers */
/* The glass table is a horizontal plane whose alphaMap is authored in canvas
   space: the mirror layer is visible under the cards, the glass becomes more
   opaque with distance (so the reflection fades out toward the horizon) and the
   near/outer edges dissolve so the plane never shows a hard edge. */

// Glass coverage as a function of the floor plane's v coordinate (v = 1 at the
// far/backdrop edge, v = 0 at the near camera-side edge). Low coverage in the
// mirror band lets the reflection read; coverage rises to near-opaque towards
// the viewer so the deeper mirrored geometry fades into a dark glass surface
// (no cut, no hard-edged overlay); the far edge dissolves to 0.
function reflectionFloorCoverage(v) {
  if (v >= REFLECTION.farFadeStart) {
    return REFLECTION.mirrorCoverage * (1 - smoothstep(REFLECTION.farFadeStart, 1, v));
  }
  if (v >= REFLECTION.mirrorFadeTopV) return REFLECTION.mirrorCoverage;
  if (v > REFLECTION.fadeNearV) {
    return lerp(
      REFLECTION.mirrorCoverage,
      REFLECTION.nearCoverage,
      smoothstep(REFLECTION.fadeNearV, REFLECTION.mirrorFadeTopV, v)
    );
  }
  return REFLECTION.nearCoverage;
}

function makeReflectionFloorAlphaTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      // Canvas rows are flipped by the default texture flipY: map the row index
      // to the plane's v coordinate (v = 1 at the far edge that meets the
      // backdrop, v = 0 at the near camera-side edge).
      const v = 1 - y / (size - 1);
      const coverage = reflectionFloorCoverage(v);
      const sideFade = smoothstep(0, 0.05, u) * smoothstep(0, 0.05, 1 - u);
      const alpha = clamp(coverage * sideFade, 0, 1);
      const index = (y * size + x) * 4;
      // alphaMap samples the GREEN channel in three.js
      const value = Math.round(alpha * 255);
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  // alphaMap is read as a linear coverage value (green channel) - keep the
  // default linear encoding so the authored alpha gradient is not gamma-shifted.
  texture.needsUpdate = true;
  return texture;
}

function makeReflectionFloorTintTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  // v = 1 at the far edge (top of the canvas row 0), v = 0 near the viewer.
  gradient.addColorStop(0, '#090d13');
  gradient.addColorStop(0.22, '#0b1017');
  gradient.addColorStop(0.5, '#10161f');
  gradient.addColorStop(0.78, '#151c26');
  gradient.addColorStop(1, '#1a222e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  return texture;
}

function makeReflectionGhostMaterial(source) {
  const material = source.clone();
  material.transparent = true;
  material.opacity = 0;
  material.depthWrite = false;
  // mirrored geometry flips the winding; keep both sides visible
  material.side = THREE.DoubleSide;
  // The mirror must be a soft, dim echo: tint it down, kill the sharp clearcoat
  // highlight and roughen it so no crisp logo text/edge survives.
  if (material.color) material.color.multiplyScalar(REFLECTION.ghostTint);
  material.clearcoat = 0;
  material.clearcoatRoughness = 1;
  material.roughness = Math.min(1, (typeof material.roughness === 'number' ? material.roughness : 0.5) + REFLECTION.ghostRoughnessLift);
  material.envMapIntensity = Math.min(
    typeof material.envMapIntensity === 'number' ? material.envMapIntensity : 1,
    REFLECTION.ghostEnvMax
  );
  if (typeof material.specularIntensity === 'number') {
    material.specularIntensity = Math.min(material.specularIntensity, REFLECTION.ghostSpecularMax);
  }
  material.needsUpdate = true;
  return material;
}

/**
 * Round 5: the frontal backdrop plane no longer covers the frame at the
 * 45-degree default camera (its finite edges showed as a hard diagonal slab in
 * both reflection modes), so the studio is now a large inward-facing gradient
 * sphere. A sphere is seamless from every yaw/elevation of the fixed default
 * camera and every aspect ratio, and the glass floor dissolves into it.
 */
function makeStudioBackdropTexture(renderer) {
  const size = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Vertical studio gradient (canvas top = sphere top).
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#1b2431');
  base.addColorStop(0.3, '#151d28');
  base.addColorStop(0.55, '#0f151e');
  base.addColorStop(0.78, '#090d14');
  base.addColorStop(1, '#05070c');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, height);

  // Soft light pool behind/above the composition, fully inside the canvas so
  // the sphere seam stays invisible.
  const pool = ctx.createRadialGradient(size * 0.5, height * 0.4, size * 0.02, size * 0.5, height * 0.45, size * 0.36);
  pool.addColorStop(0, 'rgba(120,144,176,0.20)');
  pool.addColorStop(0.45, 'rgba(70,88,112,0.10)');
  pool.addColorStop(1, 'rgba(10,14,20,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, size, height);

  // Deterministic dither so the large gradient never bands.
  const image = ctx.getImageData(0, 0, size, height);
  const data = image.data;
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < data.length; index += 4) {
    const n = (next() - 0.5) * 2.4;
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

/**
 * Soft card-shaped silhouette shadow used as the *visible* soft shadow.
 *
 * Why a decal: the key light is a single point light that now sits to the
 * camera's right (round 7), so the physically traced shadow of a card is
 * partially visible but the large soft penumbra the page design relies on is
 * still authored here. The decal is a feathered silhouette placed behind the card
 * along the view axis and displaced toward camera-left by the projected distance
 * of the right-side key (see _updateShadowDecals) — i.e. the shadow reads on the
 * side away from the light.
 *
 * The blurred silhouette is inset 40/512 of the texture (blur never clips at
 * the plane edge); the plane is scaled so the visible penumbra reads at
 * ~1.04-1.10× the card footprint.
 */
function makeCardShadowTexture() {
  const width = 512;
  const height = Math.round((width * 2.30028) / 3.36);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const inset = 40;
  const radius = 20;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.filter = 'blur(18px)';
  ctx.fillStyle = 'rgba(0,0,0,0.95)';
  ctx.beginPath();
  const x = inset;
  const y = Math.round((inset * height) / width);
  const w = width - 2 * x;
  const h = height - 2 * y;
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  texture.userData = { role: 'soft-card-shadow' };
  return texture;
}

class CardStudio {
  constructor(options) {
    this.canvas = options.canvas;
    this.stage = options.stage;
    this.metrics = options.metrics || null;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.still = Boolean(options.still);
    this.frozen = this.still || Boolean(options.frozen);
    this.autoRotate = false;
    this.autoWeight = 0;
    this.autoPhase = 0;
    this.floatWeight = 0;
    this.time = 0;
    this.pose = { yawDeg: 0, pitchDeg: 0 };
    this.poseTarget = { yawDeg: 0, pitchDeg: 0 };
    this.velocity = { yaw: 0, pitch: 0 };
    this.inertia = false;
    this.dragging = false;
    this.pointerId = null;
    this.pointerLast = null;
    this.pointerLastTime = 0;
    this.swapProgress = 0;
    this.swapTween = null;
    this.orderFront = 'light';
    this._floatY = 0;
    this._floatTilt = 0;
    this._lastYaw = 0;
    this._lastPitch = 0;
    this._shadowDirty = true;
    this._halfX = 2.7;
    this._halfY = 1.8;
    this._halfZ = 0.4;
    this.cards = { dark: null, light: null };
    this.cardList = [];
    this._size = { w: 0, h: 0 };
    this._cameraDistance = 7.6;
    this._raf = 0;
    this._lastFrame = 0;
    this._needsRender = true;
    this._rendered = false;
    this._frameCount = 0;
    this._renderCount = 0;
    this._stats = { triangles: 0, drawCalls: 0 };
    this._destroyed = false;
    this._pulseTimer = 0;
    this._resizeObserver = null;
    // Round 3 reflection state (default ON unless the page passes ?reflection=0)
    this.reflectionEnabled = options.reflection === undefined ? true : Boolean(options.reflection);
    this.reflectionWeight = this.reflectionEnabled ? 1 : 0;
    this._reflectionFloor = null;
    this._reflectionRoot = null;
    this._reflectionClones = {};
    this._reflectionAlphaTexture = null;
    this._reflectionEnvBase = null;
    this._mirrorMatrix = null;
    this._onPointerDown = (event) => this._handlePointerDown(event);
    this._onPointerMove = (event) => this._handlePointerMove(event);
    this._onPointerUp = (event) => this._handlePointerUp(event);
    this._onPointerCancel = (event) => this._handlePointerUp(event, true);
    this._onDoubleClick = (event) => {
      if (this._destroyed) return;
      event.preventDefault();
      this.reset({ immediate: this.reducedMotion });
    };
    this._isBooted = false;
  }

  /* ---------------------------------------------------------------- boot */

  init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Round 7: exposure 0.92 -> 0.89 (part of the overall brightness reduction).
    renderer.toneMappingExposure = 0.89;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_SPEC.fov, 1, CAMERA_SPEC.near, CAMERA_SPEC.far);
    this.camera.position.copy(CAMERA_AXIS).multiplyScalar(9);
    this.camera.lookAt(0, 0, 0);

    this._buildLights();
    this._buildEnvironment();
    this._buildBackdrop();

    this.floatGroup = new THREE.Group();
    this.floatGroup.name = 'float';
    this.scene.add(this.floatGroup);

    this.composition = new THREE.Group();
    this.composition.name = 'composition';
    this.composition.rotation.order = 'YXZ';
    this.floatGroup.add(this.composition);

    this.holders = {
      light: new THREE.Group(),
      dark: new THREE.Group(),
    };
    this.holders.light.name = 'holder-light';
    this.holders.dark.name = 'holder-dark';
    this.composition.add(this.holders.light, this.holders.dark);
    this._buildShadowDecals();
    this._buildReflection();

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.stage);
    this._resize();

    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerCancel);
    this.canvas.addEventListener('dblclick', this._onDoubleClick);
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      pushError('WebGL context lost');
      if (typeof this.onContextLost === 'function') this.onContextLost();
    });

    this._pulseTimer = window.setInterval(() => this._pulse(), 160);
    this._isBooted = true;
    this._step(0.016, true);
    this._scheduleFrame();
    return this;
  }

  _buildLights() {
    const ambient = new THREE.AmbientLight(AMBIENT.color, AMBIENT.intensity);
    ambient.name = 'ambient-fill';
    this.scene.add(ambient);
    this.ambient = ambient;

    // Exactly one shadow-casting key light, offset toward the camera's right
    // (contract §4.2 Revision 6): _syncKeyLight() derives its position from the
    // live camera fit, and the authored shadow decals are offset to camera-left.
    const key = new THREE.PointLight(KEY_LIGHT.color, KEY_LIGHT.intensity, KEY_LIGHT.distance, KEY_LIGHT.decay);
    key.name = 'key-light';
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1.5;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.04;
    key.shadow.radius = 5;
    key.shadow.autoUpdate = false;
    key.shadow.needsUpdate = true;
    key.shadow.camera.updateProjectionMatrix();
    this.scene.add(key);
    this.keyLight = key;
    this._shadowDirty = true;
    this._syncKeyLight();
  }

  _buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const built = createStudioEnvironment();
    this._envRT = pmrem.fromScene(built.scene, 0.04);
    this.scene.environment = this._envRT.texture;
    disposeEnvironmentScene(built.scene, built.textures);
    pmrem.dispose();
  }

  _buildBackdrop() {
    // Seamless studio: a large unlit gradient sphere around the whole scene
    // (see makeStudioBackdropTexture). No finite backdrop edges can appear at
    // the 45-degree default view or any aspect ratio, and the glass floor fades
    // into it. The visible soft shadow is still the authored key-side decal.
    this._backdropTexture = makeStudioBackdropTexture(this.renderer);
    const material = new THREE.MeshBasicMaterial({
      map: this._backdropTexture,
      side: THREE.BackSide,
      toneMapped: false,
      depthWrite: false,
    });
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(BACKDROP.radius, 48, 32), material);
    this.backdrop.name = 'studio-backdrop';
    this.backdrop.renderOrder = -1;
    this.scene.add(this.backdrop);
  }

  /* ---------------------------------------------------------- reflection */

  _buildReflection() {
    const alphaMap = makeReflectionFloorAlphaTexture();
    const tintMap = makeReflectionFloorTintTexture();
    this._reflectionAlphaTexture = alphaMap;
    this._reflectionTintTexture = tintMap;
    const material = new THREE.MeshBasicMaterial({
      map: tintMap,
      alphaMap,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(REFLECTION.floorWidth, REFLECTION.floorDepth), material);
    floor.name = 'reflection-floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, REFLECTION.floorY, REFLECTION.floorCenterZ);
    floor.renderOrder = 3;
    floor.castShadow = false;
    floor.receiveShadow = false;
    floor.visible = false;
    this.scene.add(floor);
    this._reflectionFloor = floor;

    this._reflectionRoot = new THREE.Group();
    this._reflectionRoot.name = 'reflection-layer';
    this._reflectionRoot.visible = false;
    this.scene.add(this._reflectionRoot);

    // Mirror about the horizontal plane y = floorY.
    this._mirrorMatrix = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, -1, 0, 2 * REFLECTION.floorY,
      0, 0, 1, 0,
      0, 0, 0, 1
    );
    this._applyReflectionState();
  }

  _reflectionEnvForCard(card) {
    if (!card || !card.materials) return null;
    const envOf = (material) =>
      material && typeof material.envMapIntensity === 'number' ? material.envMapIntensity : 1;
    return {
      front: envOf(card.materials.front),
      edge: envOf(card.materials.edge),
      back: envOf(card.materials.back),
    };
  }

  // Reflection-ON environment values per card. Front/back are the shared round-3
  // boosts; the light card keeps its polished-edge boost (2.0 -> 2.7) while the
  // dark card's satin edge is only nudged from its own OFF value and clamped to
  // the low R4.2 range so the dark frame cannot become a white line.
  _reflectionOnEnv(id, base) {
    const on = REFLECTION.envOn;
    return {
      front: on.front,
      edge:
        id === 'light'
          ? on.edge
          : clamp(base.edge * REFLECTION.darkEdgeScale, REFLECTION.darkEdgeMin, REFLECTION.darkEdgeMax),
      back: id === 'dark' ? on.back : (Number(on.backLight) || on.back),
    };
  }

  _buildReflectionClones() {
    if (!this._reflectionRoot) return;
    this._disposeReflectionClones();
    // Base (round-4/OFF) env values are read from each card's live materials so
    // the page does not hard-code the modeler's dark-edge numbers.
    this._reflectionEnvBase = {
      light: this._reflectionEnvForCard(this.cards.light),
      dark: this._reflectionEnvForCard(this.cards.dark),
    };
    for (const id of ['light', 'dark']) {
      const card = this.cards[id];
      if (!card || !card.group) continue;
      const clone = card.group.clone(true);
      clone.name = 'reflection-card-' + id;
      const ghosts = [];
      clone.traverse((object) => {
        if (!object.isMesh) return;
        const source = object.material;
        const ghost = Array.isArray(source)
          ? source.map((material) => makeReflectionGhostMaterial(material))
          : makeReflectionGhostMaterial(source);
        object.material = ghost;
        object.castShadow = false;
        object.receiveShadow = false;
        object.renderOrder = 1;
        for (const material of Array.isArray(ghost) ? ghost : [ghost]) ghosts.push(material);
      });
      clone.matrixAutoUpdate = false;
      this._reflectionRoot.add(clone);
      this._reflectionClones[id] = { group: clone, ghosts };
    }
    this._updateReflectionClones();
    this._applyReflectionState();
  }

  _disposeReflectionClones() {
    if (!this._reflectionRoot) return;
    for (const entry of Object.values(this._reflectionClones)) {
      this._reflectionRoot.remove(entry.group);
      for (const material of entry.ghosts) material.dispose();
    }
    this._reflectionClones = {};
  }

  _updateReflectionClones() {
    if (!this._reflectionRoot || !this._mirrorMatrix) return;
    if (!(this.reflectionWeight > 0.001) || !this._reflectionRoot.visible) return;
    this.floatGroup.updateMatrixWorld(true);
    for (const id of ['light', 'dark']) {
      const entry = this._reflectionClones[id];
      const card = this.cards[id];
      if (!entry || !card) continue;
      entry.group.matrix.copy(card.group.matrixWorld).premultiply(this._mirrorMatrix);
      entry.group.matrixWorldNeedsUpdate = true;
    }
  }

  _applyReflectionState() {
    const weight = clamp(this.reflectionWeight, 0, 1);
    const cardsReady = Boolean(this.cards && this.cards.light && this.cards.dark);
    const active = weight > 0.001 && cardsReady;
    if (this._reflectionFloor) {
      this._reflectionFloor.visible = active;
      this._reflectionFloor.material.opacity = weight * REFLECTION.floorOpacity;
    }
    if (this._reflectionRoot) this._reflectionRoot.visible = active;
    for (const entry of Object.values(this._reflectionClones)) {
      for (const material of entry.ghosts) material.opacity = weight * REFLECTION.cloneOpacity;
    }
    if (this._reflectionEnvBase) {
      for (const id of ['light', 'dark']) {
        const card = this.cards[id];
        const base = this._reflectionEnvBase[id];
        if (!card || !card.materials || !base) continue;
        const on = this._reflectionOnEnv(id, base);
        card.materials.front.envMapIntensity = lerp(base.front, on.front, weight);
        card.materials.edge.envMapIntensity = lerp(base.edge, on.edge, weight);
        card.materials.back.envMapIntensity = lerp(base.back, on.back, weight);
      }
    }
    this._updateReflectionClones();
  }

  /* --------------------------------------------------------------- cards */

  setCards(cards) {
    for (const id of ['dark', 'light']) {
      const card = cards[id];
      if (!card || !card.group) throw new Error('card-model returned an invalid card for ' + id);
      this.cards[id] = card;
      this.cardList.push(card);
      const group = card.group;
      group.name = 'card-' + id;
      group.rotation.order = 'YXZ';
      for (const part of [card.front, card.back, card.edge]) {
        if (!part) continue;
        part.castShadow = true;
        part.receiveShadow = true;
      }
      group.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        // The card plates are single-sided ShapeGeometry surfaces. Three's
        // shadow pass defaults to `shadowSide = BackSide` for FrontSide materials,
        // which culls a flat plate seen from the light and therefore casts *no*
        // shadow. DoubleSide makes the printed plates cast their real key-light
        // shadow (the edge band already casts).
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material || material.shadowSide === THREE.DoubleSide) continue;
          material.shadowSide = THREE.DoubleSide;
          material.needsUpdate = true;
        }
      });
      this.holders[id].add(group);
    }
    this._computeCompositionBounds();
    this._applyLayout(0);
    this._applyPose();
    this._fitCamera();
    this._buildReflectionClones();
    this.requestRender();
  }

  _computeCompositionBounds() {
    const restore = this.swapProgress;
    const bounds = new THREE.Box3();
    const sample = new THREE.Box3();
    for (const progress of [0, 1]) {
      this._applyLayout(progress);
      this.composition.updateMatrixWorld(true);
      sample.setFromObject(this.composition);
      if (!sample.isEmpty()) bounds.union(sample);
    }
    this._applyLayout(restore);
    this.composition.updateMatrixWorld(true);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    this.composition.position.set(-center.x, -center.y, -center.z);
    this._bounds = { size, center };
    this._halfY = Math.max(Math.abs(bounds.max.y - center.y), Math.abs(bounds.min.y - center.y));
    this._halfX = Math.max(Math.abs(bounds.max.x - center.x), Math.abs(bounds.min.x - center.x));
    this._halfZ = Math.max(Math.abs(bounds.max.z - center.z), Math.abs(bounds.min.z - center.z));
    // Reflection framing: when the glass table is ON, frame the pair plus the top
    // band of its mirror image (cards' transforms stay untouched; only the camera
    // refits, which is what makes the mirror visible below the floating pair).
    const mirrorTop = 2 * REFLECTION.floorY + this._halfY;
    const mirrorBottom = mirrorTop - REFLECTION.frameBand;
    const frameMinY = Math.min(-this._halfY, mirrorBottom);
    const frameMaxY = Math.max(this._halfY, mirrorTop);
    this._reflectionFrame = {
      halfY: (frameMaxY - frameMinY) / 2,
      centerY: (frameMaxY + frameMinY) / 2,
    };
  }

  _applyLayout(progress) {
    const p = clamp(progress, 0, 1);
    const eased = easeInOutCubic(p);
    const arc = Math.sin(Math.PI * p);
    const front = SLOTS.front;
    const back = SLOTS.back;
    for (const id of ['light', 'dark']) {
      const holder = this.holders[id];
      const card = this.cards[id];
      if (!holder || !card) continue;
      const from = id === 'light' ? front : back;
      const to = id === 'light' ? back : front;
      const fromScale = from.scale;
      const toScale = to.scale;
      // Moving card arcs toward the camera; the card heading back dips behind,
      // so the two cards never interpenetrate at the crossing point.
      const zBump = id === 'light' ? arc * 0.34 : arc * -0.24;
      const yBump = id === 'light' ? arc * 0.16 : arc * -0.1;
      holder.position.set(
        lerp(from.position[0], to.position[0], eased),
        lerp(from.position[1], to.position[1], eased) + yBump,
        lerp(from.position[2], to.position[2], eased) + zBump
      );
      holder.scale.setScalar(lerp(fromScale, toScale, eased));
      card.group.rotation.set(
        degToRad(lerp(from.rotation[0], to.rotation[0], eased)),
        degToRad(lerp(from.rotation[1], to.rotation[1], eased)),
        degToRad(lerp(from.rotation[2], to.rotation[2], eased))
      );
    }
    this.swapProgress = p;
    this.orderFront = p < 0.5 ? 'light' : 'dark';
    this._markShadowDirty();
  }

  _applyPose() {
    const pose = this._displayPose();
    const yaw = degToRad(pose.yawDeg);
    const pitch = degToRad(pose.pitchDeg);
    if (Math.abs(yaw - this._lastYaw) > 1e-4 || Math.abs(pitch - this._lastPitch) > 1e-4) {
      this._lastYaw = yaw;
      this._lastPitch = pitch;
      this._markShadowDirty();
    }
    this.composition.rotation.y = yaw;
    this.composition.rotation.x = pitch;
    this.floatGroup.position.y = this._floatY;
    this.floatGroup.rotation.z = this._floatTilt;
    this._updateShadowDecals();
    this._updateReflectionClones();
  }


  /* ------------------------------------------------- key-light soft shadow */
  /* See makeCardShadowTexture(): the key light sits to the camera's right, so
     the visible soft shadow is a feathered silhouette placed behind each card
     along the view axis and displaced toward camera-left (see
     _updateShadowDecals), i.e. on the side away from the light.  */

  _buildShadowDecals() {
    this._shadowTexture = makeCardShadowTexture();
    const baseMaterial = new THREE.MeshBasicMaterial({
      map: this._shadowTexture,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    this.decalsEnabled = true;
    this.shadowDecals = [];
    // Two layers give a shadow that reads like a real soft shadow rather than a
    // flat vignette: a tight darker core just outside the silhouette plus a wide
    // soft penumbra. Both are strictly behind the card (depth-extent offset).
    // Round 7 exposes more of the decal to camera-left (see _updateShadowDecals),
    // so the authored opacity is lowered to keep the cast shadow a soft presence
    // instead of a black slab.
    const layers = [
      { spread: 1.36, light: 0.24, dark: 0.2 },
      { spread: 1.22, light: 0.4, dark: 0.32 },
    ];
    for (const layer of layers) {
      for (const id of ['light', 'dark']) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), baseMaterial.clone());
        mesh.name = 'camera-angle-shadow-' + id + '-' + layer.spread;
        mesh.material.opacity = id === 'light' ? layer.light : layer.dark;
        mesh.renderOrder = 2;
        mesh.visible = false;
        this.scene.add(mesh);
        this.shadowDecals.push({ id, mesh, spread: layer.spread });
      }
    }
    baseMaterial.dispose();
  }

  /**
   * Position the billboarded shadow decals strictly behind their cards: the
   * offset is the card's exact depth extent along the view axis
   * (halfW·|x·v| + halfH·|y·v| + halfT·|z·v| + margin), so a transparent decal
   * can never paint a hard edge over a face. The plane is scaled by
   * decalDepth/centerDepth so the projected penumbra keeps matching the card
   * footprint (including foreshortening while dragging) and is spun with the
   * card's screen-plane tilt so the silhouette lines up at rest.
   */
  _updateShadowDecals() {
    if (!this.shadowDecals || !this.shadowDecals.length) return;
    if (!this.cards.light || !this.cards.dark || !this.metrics) return;
    this.floatGroup.updateMatrixWorld(true);
    // View direction of the live camera (not the origin-to-camera vector): the
    // decals must stay behind the cards for the 45-degree default view too.
    const camDir = this._camDir || (this._camDir = new THREE.Vector3());
    this.camera.getWorldDirection(camDir);
    const away = this._decalAway || (this._decalAway = new THREE.Vector3());
    away.copy(camDir);
    const camRight = this._camRight || (this._camRight = new THREE.Vector3(1, 0, 0));
    const camUp = this._camUp || (this._camUp = new THREE.Vector3(0, 1, 0));
    camRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    camUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const axis = this._decalAxis || (this._decalAxis = new THREE.Vector3());
    const world = this._decalWorld || (this._decalWorld = new THREE.Vector3());
    const toPoint = this._decalToPoint || (this._decalToPoint = new THREE.Vector3());
    const spin = this._decalSpin || (this._decalSpin = new THREE.Quaternion());
    const halfW = this.metrics.width / 2;
    const halfH = this.metrics.height / 2;
    const halfT = this.metrics.thickness / 2;
    for (const entry of this.shadowDecals) {
      const holder = this.holders[entry.id];
      const card = this.cards[entry.id];
      if (!holder || !card || !card.group) continue;
      const elements = card.group.matrixWorld.elements;
      axis.set(elements[0], elements[1], elements[2]).normalize();
      const axisXdotAway = Math.abs(axis.dot(away));
      const axisXdotRight = axis.dot(camRight);
      const axisXdotUp = axis.dot(camUp);
      const projectedWidth = Math.abs(axisXdotRight);
      const screenAngle = Math.atan2(axisXdotUp, axisXdotRight);
      axis.set(elements[4], elements[5], elements[6]).normalize();
      const axisYdotAway = Math.abs(axis.dot(away));
      const projectedHeight = Math.abs(axis.dot(camUp));
      axis.set(elements[8], elements[9], elements[10]).normalize();
      const axisZdotAway = Math.abs(axis.dot(away));
      const thicknessWidth = Math.abs(axis.dot(camRight));
      const thicknessHeight = Math.abs(axis.dot(camUp));

      holder.getWorldPosition(world);
      toPoint.copy(world).sub(this.camera.position);
      const centerDepth = toPoint.dot(away);
      const depthExtent = halfW * axisXdotAway + halfH * axisYdotAway + halfT * axisZdotAway;
      const margin = 0.055;
      world.addScaledVector(away, depthExtent + margin);
      // Round 7: the key light is offset to the camera's right, so the authored
      // soft shadow is displaced toward camera-left (and slightly down for the
      // small upward key lift) by the projected distance a real shadow of the
      // card would move at the decal depth. This keeps the visible shadow
      // pointing away from the new light instead of sitting zero-offset behind
      // the card.
      const shadowDepth = depthExtent + margin;
      world.addScaledVector(camRight, -shadowDepth * SHADOW_SHIFT * Math.tan(degToRad(KEY_LIGHT.rightDeg)));
      world.addScaledVector(camUp, -shadowDepth * SHADOW_SHIFT * Math.tan(degToRad(KEY_LIGHT.upDeg)));
      entry.mesh.position.copy(world);
      entry.mesh.quaternion.copy(this.camera.quaternion);
      spin.setFromAxisAngle(PLANE_Z, screenAngle);
      entry.mesh.quaternion.multiply(spin);
      const depthScale = (centerDepth + depthExtent + margin) / Math.max(0.001, centerDepth);
      const scale = holder.scale.x;
      const spread = entry.spread || 1.3;
      entry.mesh.scale.set(
        (this.metrics.width * Math.max(projectedWidth, 0.22) + this.metrics.thickness * thicknessWidth * 2) * scale * spread * depthScale,
        (this.metrics.height * Math.max(projectedHeight, 0.22) + this.metrics.thickness * thicknessHeight * 2) * scale * spread * depthScale,
        1
      );
      entry.mesh.visible = this.decalsEnabled !== false;
    }
  }

  _displayPose() {
    const yawOffset = Math.sin(this.autoPhase) * AUTO.yawAmplitude * this.autoWeight;
    const pitchOffset = Math.sin(this.autoPhase * 0.73 + 1.1) * AUTO.pitchAmplitude * this.autoWeight;
    return {
      yawDeg: clamp(this.pose.yawDeg + yawOffset, -HARD_LIMITS.yawDeg, HARD_LIMITS.yawDeg),
      pitchDeg: clamp(this.pose.pitchDeg + pitchOffset, -HARD_LIMITS.pitchDeg, HARD_LIMITS.pitchDeg),
    };
  }

  _autoActive() {
    return Boolean(this.autoRotate) && this._motionAllowed();
  }

  _motionAllowed() {
    return !this.still && !this.frozen && !this.reducedMotion;
  }

  _floatActive() {
    return this._motionAllowed() && !this._autoActive() && !this.dragging && this.floatWeight > 0.002;
  }

  /* -------------------------------------------------------------- camera */

  _resize() {
    if (!this.renderer || this._destroyed) return;
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this._size.w && height === this._size.h) return;
    this._size = { w: width, h: height };
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this._fitCamera();
    this.requestRender();
  }

  _fitCamera() {
    if (!this.camera) return;
    const baseHalfY = this._halfY || 1.8;
    const baseHalfX = this._halfX || 2.7;
    const baseHalfZ = this._halfZ || 0.4;
    // Blend toward the reflection framing with the ON/OFF weight so the toggle
    // smoothly refits the camera (cards themselves are not moved/rescaled).
    const reflectionWeight = this._reflectionFrame ? clamp(this.reflectionWeight, 0, 1) : 0;
    const halfY = lerp(baseHalfY, this._reflectionFrame ? this._reflectionFrame.halfY : baseHalfY, reflectionWeight);
    const centerY = this._reflectionFrame ? lerp(0, this._reflectionFrame.centerY, reflectionWeight) : 0;
    const target = new THREE.Vector3(0, centerY, 0);
    // Fit box = pair + framed reflection band, in composition space (the
    // composition group is recentred on the pair bounds). A 45-degree view
    // rotates the projected extents, so solve the distance numerically: binary
    // search for the nearest camera distance that keeps all eight fit-box
    // corners inside the viewport with the FIT margin at the current aspect.
    // Deterministic (fixed iteration count, no randomness/time dependence).
    const corners = this._fitCorners || (this._fitCorners = []);
    if (corners.length === 0) {
      for (let i = 0; i < 8; i += 1) corners.push(new THREE.Vector3());
    }
    let cornerIndex = 0;
    for (const x of [-baseHalfX, baseHalfX]) {
      for (const y of [-halfY, halfY]) {
        for (const z of [-baseHalfZ, baseHalfZ]) {
          corners[cornerIndex].set(x, centerY + y, z);
          cornerIndex += 1;
        }
      }
    }
    const projected = this._fitProjected || (this._fitProjected = new THREE.Vector3());
    const ndcLimit = 1 / FIT.margin;
    let lo = CAMERA_SPEC.minDistance;
    let hi = CAMERA_SPEC.maxDistance;
    for (let iteration = 0; iteration < 28; iteration += 1) {
      const mid = (lo + hi) / 2;
      this.camera.position.copy(CAMERA_AXIS).multiplyScalar(mid).add(target);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld(true);
      let fits = true;
      for (const corner of corners) {
        projected.copy(corner).project(this.camera);
        if (
          Math.abs(projected.x) > ndcLimit ||
          Math.abs(projected.y) > ndcLimit ||
          projected.z < -1 ||
          projected.z > 1
        ) {
          fits = false;
          break;
        }
      }
      if (fits) hi = mid;
      else lo = mid;
    }
    const distance = clamp(hi + FIT.pad, CAMERA_SPEC.minDistance, CAMERA_SPEC.maxDistance);
    this._cameraDistance = distance;
    this._cameraTarget = target.clone();
    this.camera.position.copy(CAMERA_AXIS).multiplyScalar(distance).add(target);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
    this._syncKeyLight();
    this._markShadowDirty();
    // Decals are screen-space relative to the camera: never let them be a frame
    // stale after a fit/resize (first-load determinism).
    this._updateShadowDecals();
  }

  _syncKeyLight() {
    if (!this.keyLight || !this.camera) return;
    // Round 7 requirement: the key light sits to the camera's RIGHT (screen-
    // right), not at the camera. Start from the target->camera direction, rotate
    // it toward the camera-right basis by KEY_LIGHT.rightDeg and lift it by
    // KEY_LIGHT.upDeg, then place the light on a closer radius around the
    // composition target (distanceScale). The highlight therefore falls on the
    // right of the cards and the visible soft shadow is offset toward camera-left.
    const forward = this._keyForward || (this._keyForward = new THREE.Vector3());
    const right = this._keyRight || (this._keyRight = new THREE.Vector3(1, 0, 0));
    const up = this._keyUp || (this._keyUp = new THREE.Vector3(0, 1, 0));
    const axis = this._keyAxis || (this._keyAxis = new THREE.Vector3());
    this.camera.getWorldDirection(forward);
    right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const rightRad = degToRad(KEY_LIGHT.rightDeg);
    const upRad = degToRad(KEY_LIGHT.upDeg);
    axis
      .copy(forward)
      .multiplyScalar(-Math.cos(rightRad) * Math.cos(upRad))
      .addScaledVector(right, Math.sin(rightRad) * Math.cos(upRad))
      .addScaledVector(up, Math.sin(upRad))
      .normalize();
    const target =
      this._cameraTarget || this._keyDefaultTarget || (this._keyDefaultTarget = new THREE.Vector3(0, 0, 0));
    const distance = this._cameraDistance * KEY_LIGHT.distanceScale;
    this.keyLight.position.copy(target).addScaledVector(axis, distance);
    this.keyLight.updateMatrixWorld(true);
    this._markShadowDirty();
  }

  _markShadowDirty() {
    this._shadowDirty = true;
    if (this.keyLight) this.keyLight.shadow.needsUpdate = true;
  }

  /* -------------------------------------------------------------- render */

  requestRender() {
    this._needsRender = true;
    this._scheduleFrame();
  }

  _scheduleFrame() {
    if (this._raf || this._destroyed) return;
    this._raf = window.requestAnimationFrame((now) => this._frame(now));
  }

  _frame(now) {
    this._raf = 0;
    if (this._destroyed) return;
    const dt = this._lastFrame ? clamp((now - this._lastFrame) / 1000, 0.001, 0.05) : 0.016;
    this._lastFrame = now;
    this._step(dt);
    this.renderNow();
    this._frameCount += 1;
    if (this._needsFrame()) {
      this._scheduleFrame();
    } else {
      this._lastFrame = 0;
    }
  }

  _pulse() {
    if (this._destroyed || !this.renderer) return;
    if (!this._needsFrame()) return;
    const now = performance.now();
    if (this._lastFrame && now - this._lastFrame < 140) return;
    const dt = 0.016;
    this._step(dt);
    this.renderNow();
    this._frameCount += 1;
    this._lastFrame = now;
  }

  _needsFrame() {
    if (this._destroyed) return false;
    if (this._needsRender) return true;
    if (this.dragging || this.inertia) return true;
    if (this.poseTarget.yawDeg !== this.pose.yawDeg || this.poseTarget.pitchDeg !== this.pose.pitchDeg) return true;
    if (this.swapTween) return true;
    if (this._autoActive()) return true;
    if (this.autoWeight > 0.002 || this.floatWeight > 0.002) return true;
    if (this._floatActive()) return true;
    if (this.reflectionWeight !== (this.reflectionEnabled ? 1 : 0)) return true;
    return false;
  }

  _step(dt, immediate = false) {
    if (this._destroyed) return;
    this.time += dt;

    // Inertia after a drag release.
    if (this.inertia && !this.dragging) {
      this.pose.yawDeg = clamp(this.pose.yawDeg + this.velocity.yaw * dt, -POSE_LIMITS.yawDeg, POSE_LIMITS.yawDeg);
      this.pose.pitchDeg = clamp(this.pose.pitchDeg + this.velocity.pitch * dt, -POSE_LIMITS.pitchDeg, POSE_LIMITS.pitchDeg);
      this.poseTarget.yawDeg = this.pose.yawDeg;
      this.poseTarget.pitchDeg = this.pose.pitchDeg;
      const decay = Math.exp(-dt * 3.1);
      this.velocity.yaw *= decay;
      this.velocity.pitch *= decay;
      if (Math.abs(this.pose.yawDeg) >= POSE_LIMITS.yawDeg) this.velocity.yaw = 0;
      if (Math.abs(this.pose.pitchDeg) >= POSE_LIMITS.pitchDeg) this.velocity.pitch = 0;
      if (Math.hypot(this.velocity.yaw, this.velocity.pitch) < 2) {
        this.velocity.yaw = 0;
        this.velocity.pitch = 0;
        this.inertia = false;
      }
    }

    // Pose easing (used by Reset and by API setPose animating from a drag).
    if (!immediate && !this.dragging && !this.inertia) {
      const ease = 1 - Math.exp(-dt * 9.5);
      this.pose.yawDeg = lerp(this.pose.yawDeg, this.poseTarget.yawDeg, ease);
      this.pose.pitchDeg = lerp(this.pose.pitchDeg, this.poseTarget.pitchDeg, ease);
      if (Math.abs(this.pose.yawDeg - this.poseTarget.yawDeg) < 0.01) this.pose.yawDeg = this.poseTarget.yawDeg;
      if (Math.abs(this.pose.pitchDeg - this.poseTarget.pitchDeg) < 0.01) this.pose.pitchDeg = this.poseTarget.pitchDeg;
    }

    // Swap tween.
    if (this.swapTween) {
      const tween = this.swapTween;
      tween.t += dt / tween.dur;
      const eased = easeInOutCubic(clamp(tween.t, 0, 1));
      this._applyLayout(lerp(tween.from, tween.to, eased));
      if (tween.t >= 1) {
        this._applyLayout(tween.to);
        this.swapTween = null;
      }
    }

    // Auto-rotate phase / float weight.
    const motion = this._motionAllowed();
    const autoTarget = this.autoRotate && motion ? 1 : 0;
    this.autoWeight = lerp(this.autoWeight, autoTarget, 1 - Math.exp(-dt * 4.5));
    if (this.autoWeight < 0.002 && autoTarget === 0) {
      this.autoWeight = 0;
      this.autoPhase = 0;
    }
    if (this.autoWeight > 0) this.autoPhase += dt * AUTO.speed;

    const floatTarget = motion && !this.autoRotate && !this.dragging && !this.inertia ? 1 : 0;
    this.floatWeight = lerp(this.floatWeight, floatTarget, 1 - Math.exp(-dt * 2.4));
    if (this.floatWeight < 0.002) this.floatWeight = 0;
    this._floatY = Math.sin(this.time * FLOAT.speed) * FLOAT.y * this.floatWeight;
    this._floatTilt = Math.sin(this.time * FLOAT.speed * 0.77 + 0.6) * FLOAT.tilt * this.floatWeight;

    // Reflection ON/OFF weight: smooth ~250 ms when motion is allowed, instant
    // under reduced motion / ?still=1 (deterministic captures).
    const reflectionTarget = this.reflectionEnabled ? 1 : 0;
    if (this.reflectionWeight !== reflectionTarget) {
      if (immediate || this._reducedMotionNow()) {
        this.reflectionWeight = reflectionTarget;
      } else {
        const stepSize = dt / REFLECTION.transitionSeconds;
        const remaining = reflectionTarget - this.reflectionWeight;
        if (Math.abs(remaining) <= stepSize) this.reflectionWeight = reflectionTarget;
        else this.reflectionWeight += Math.sign(remaining) * stepSize;
      }
      this._applyReflectionState();
      // The toggle also refits the camera (glass-table framing); keep the fit in
      // step with the transition weight.
      this._fitCamera();
    }

    this._applyPose();
  }

  renderNow() {
    if (!this.renderer || !this.scene || !this.camera || this._destroyed) return;
    this.renderer.render(this.scene, this.camera);
    this._needsRender = false;
    this._rendered = true;
    this._renderCount += 1;
    const info = this.renderer.info;
    this._stats.triangles = info.render.triangles;
    this._stats.drawCalls = info.render.calls;
  }

  /* ----------------------------------------------------------- interaction */

  _handlePointerDown(event) {
    if (this._destroyed || !this._rendered) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (this.dragging) return;
    const now = performance.now();
    this.dragging = true;
    this.inertia = false;
    this.velocity.yaw = 0;
    this.velocity.pitch = 0;
    this.pointerId = event.pointerId;
    this.pointerLast = { x: event.clientX, y: event.clientY };
    this.pointerLastTime = now;
    this.canvas.classList.add('is-dragging');
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* pointer capture is best effort */
    }
    this._setCursor('grabbing');
    this.requestRender();
  }

  _handlePointerMove(event) {
    if (this._destroyed) return;
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    const now = performance.now();
    const dx = event.clientX - this.pointerLast.x;
    const dy = event.clientY - this.pointerLast.y;
    const dt = Math.max(1e-3, (now - this.pointerLastTime) / 1000);
    if (!dx && !dy) return;
    const yawDelta = dx * DRAG.yawPerPx;
    const pitchDelta = dy * DRAG.pitchPerPx;
    this._setPoseImmediate(this.pose.yawDeg + yawDelta, this.pose.pitchDeg + pitchDelta);
    // Track velocity for the release inertia (smoothed, deg/s).
    const instantYaw = yawDelta / dt;
    const instantPitch = pitchDelta / dt;
    this.velocity.yaw = this.velocity.yaw * 0.6 + instantYaw * 0.4;
    this.velocity.pitch = this.velocity.pitch * 0.6 + instantPitch * 0.4;
    this.pointerLast = { x: event.clientX, y: event.clientY };
    this.pointerLastTime = now;
    this.requestRender();
  }

  _handlePointerUp(event, cancelled = false) {
    if (this._destroyed) return;
    if (!this.dragging || (event.pointerId !== undefined && event.pointerId !== this.pointerId)) return;
    this.dragging = false;
    try {
      if (this.pointerId !== null) this.canvas.releasePointerCapture(this.pointerId);
    } catch (error) {
      /* pointer capture is best effort */
    }
    this.pointerId = null;
    this.canvas.classList.remove('is-dragging');
    this._setCursor('grab');
    const speed = Math.hypot(this.velocity.yaw, this.velocity.pitch);
    const fresh = performance.now() - this.pointerLastTime < 140;
    if (!cancelled && speed >= DRAG.minVelocity && fresh) {
      this.inertia = true;
      this.requestRender();
    } else {
      this.velocity.yaw = 0;
      this.velocity.pitch = 0;
      this.inertia = false;
    }
    if (typeof this.onInteract === 'function') this.onInteract();
    this.requestRender();
  }

  _setCursor(cursor) {
    if (!this.canvas) return;
    this.canvas.style.cursor = cursor;
  }

  _setPoseImmediate(yawDeg, pitchDeg, limits = POSE_LIMITS) {
    this.pose.yawDeg = clamp(yawDeg, -limits.yawDeg, limits.yawDeg);
    this.pose.pitchDeg = clamp(pitchDeg, -limits.pitchDeg, limits.pitchDeg);
    this.poseTarget.yawDeg = this.pose.yawDeg;
    this.poseTarget.pitchDeg = this.pose.pitchDeg;
    this._applyPose();
  }

  /* ---------------------------------------------------------------- api */

  getPose() {
    const pose = this._displayPose();
    return { yawDeg: round(pose.yawDeg, 2), pitchDeg: round(pose.pitchDeg, 2) };
  }

  setPose(yawDeg, pitchDeg) {
    const yaw = Number.isFinite(Number(yawDeg)) ? Number(yawDeg) : 0;
    const pitch = Number.isFinite(Number(pitchDeg)) ? Number(pitchDeg) : 0;
    this.inertia = false;
    this.velocity.yaw = 0;
    this.velocity.pitch = 0;
    this._setPoseImmediate(yaw, pitch, HARD_LIMITS);
    this.requestRender();
    this.renderNow();
    return this.getPose();
  }

  async reset({ immediate = false } = {}) {
    const instant = Boolean(immediate) || this.reducedMotion;
    this.inertia = false;
    this.velocity.yaw = 0;
    this.velocity.pitch = 0;
    if (this.autoRotate) this.setAutoRotate(false);
    if (instant) {
      this._setPoseImmediate(DEFAULT_POSE.yawDeg, DEFAULT_POSE.pitchDeg);
      if (this.swapProgress !== 0) this._applyLayout(0);
      this.swapTween = null;
      this.requestRender();
      this.renderNow();
      return this.getPose();
    }
    this.poseTarget.yawDeg = DEFAULT_POSE.yawDeg;
    this.poseTarget.pitchDeg = DEFAULT_POSE.pitchDeg;
    if (this.swapProgress > 0.0001) this.swap({ immediate: false });
    this.requestRender();
    await this.waitForIdle();
    return this.getPose();
  }

  swap({ immediate = false } = {}) {
    const target = this.swapProgress > 0.5 ? 0 : 1;
    const targetOrder = target === 0 ? { front: 'light', back: 'dark' } : { front: 'dark', back: 'light' };
    const instant = Boolean(immediate) || this.reducedMotion;
    if (instant) {
      this._applyLayout(target);
      this.swapTween = null;
      this.requestRender();
      this.renderNow();
      return targetOrder;
    }
    this.swapTween = { from: this.swapProgress, to: target, t: 0, dur: SWAP_DURATION };
    this.requestRender();
    return targetOrder;
  }

  async waitSwap() {
    if (!this.swapTween) return this.getOrder();
    await this.waitForIdle();
    return this.getOrder();
  }

  setAutoRotate(enabled) {
    const next = Boolean(enabled) && this._motionAllowed();
    this.autoRotate = next;
    if (!next) {
      this.autoPhase = 0;
    }
    this.requestRender();
    return this.autoRotate;
  }

  setFrozen(frozen) {
    this.frozen = Boolean(frozen) || this.still;
    if (this.frozen) {
      this.autoRotate = false;
      this.autoWeight = 0;
      this.floatWeight = 0;
      this.inertia = false;
      this.velocity.yaw = 0;
      this.velocity.pitch = 0;
    }
    this.requestRender();
    this.renderNow();
    return this.frozen;
  }

  // Reduced motion must make the Reflection toggle instant. Besides the flags
  // synced from the page listener, query the live media preference so an
  // emulated/OS preference that arrives without a change event still snaps.
  _reducedMotionNow() {
    if (this.still || this.reducedMotion) return true;
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (error) {
      return false;
    }
  }

  setReflection(enabled, { immediate = false } = {}) {
    const next = Boolean(enabled);
    this.reflectionEnabled = next;
    const instant = Boolean(immediate) || this._reducedMotionNow();
    if (instant) {
      this.reflectionWeight = next ? 1 : 0;
      this._applyReflectionState();
      this.requestRender();
      this.renderNow();
    } else {
      this.requestRender();
    }
    return next;
  }

  getOrder() {
    return this.swapProgress < 0.5
      ? { front: 'light', back: 'dark' }
      : { front: 'dark', back: 'light' };
  }

  async waitForIdle() {
    if (this._destroyed) return true;
    const started = performance.now();
    // "Idle" means no user/API-driven motion is in flight. The gentle idle
    // float and the auto-rotate showcase are continuous by design, so they are
    // not part of this predicate (QA determinism uses ?still=1, which disables
    // both). A render is forced once before resolving.
    const settling = () =>
      !this.dragging &&
      !this.inertia &&
      !this.swapTween &&
      !this._needsRender &&
      this.reflectionWeight === (this.reflectionEnabled ? 1 : 0) &&
      Math.abs(this.pose.yawDeg - this.poseTarget.yawDeg) < 0.02 &&
      Math.abs(this.pose.pitchDeg - this.poseTarget.pitchDeg) < 0.02;
    if (settling()) {
      this.renderNow();
      return true;
    }
    await new Promise((resolve) => {
      const poll = () => {
        if (this.reflectionWeight !== (this.reflectionEnabled ? 1 : 0)) {
          // Advance the ~250 ms reflection transition deterministically.
          this._step(0.016);
        }
        if (this._needsRender) this.renderNow();
        if (settling() || performance.now() - started > 4000) {
          this.renderNow();
          resolve(true);
          return;
        }
        window.setTimeout(poll, 16);
      };
      window.setTimeout(poll, 16);
    });
    return true;
  }

  whenFirstFrame() {
    if (this._rendered) return Promise.resolve(true);
    return new Promise((resolve) => {
      const poll = () => {
        if (this._rendered) {
          resolve(true);
          return;
        }
        window.setTimeout(poll, 16);
      };
      window.setTimeout(poll, 16);
    });
  }

  /**
   * Deterministic pre-ready settle: refit the camera for the current stage size,
   * refresh the shadow decals, render, then wait for at least two real animation
   * frames (or a 350 ms fallback in rAF-starved environments) and render again.
   * The page only resolves `ready` after this, so the very first capture of a
   * fresh load already shows the fitted camera and settled decals.
   */
  async settleForReady() {
    this._fitCamera();
    this._updateShadowDecals();
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
    this._fitCamera();
    this._updateShadowDecals();
    this.renderNow();
    return true;
  }

  /* --------------------------------------------------------------- debug */

  getCameraDebug() {
    const camera = this.camera;
    const target = this._cameraTarget ? this._cameraTarget.clone() : new THREE.Vector3(0, 0, 0);
    const offset = camera.position.clone().sub(target);
    const distance = offset.length();
    const direction = distance > 1e-6 ? offset.clone().multiplyScalar(1 / distance) : CAMERA_AXIS.clone();
    // Realised default-view angles (contract R5.2: azimuth ~40-50 deg,
    // elevation ~15-25 deg). target stays [0,0,0] for the composition-centre QA
    // contract; the vertical framing offset is a fit device in _cameraTarget.
    const azimuthDeg = radToDeg(Math.atan2(direction.x, direction.z));
    const elevationDeg = radToDeg(Math.asin(clamp(direction.y, -1, 1)));
    return {
      position: [round(camera.position.x, 4), round(camera.position.y, 4), round(camera.position.z, 4)],
      target: [0, 0, 0],
      fov: camera.fov,
      distance: round(distance, 4),
      axis: [round(direction.x, 4), round(direction.y, 4), round(direction.z, 4)],
      azimuthDeg: round(azimuthDeg, 2),
      elevationDeg: round(elevationDeg, 2),
      specAzimuthDeg: CAMERA_SPEC.azimuthDeg,
      specElevationDeg: CAMERA_SPEC.elevationDeg,
      aspect: round(camera.aspect, 4),
      near: camera.near,
      far: camera.far,
    };
  }

  getKeyLightDebug() {
    const key = this.keyLight;
    return {
      type: key.type,
      position: [round(key.position.x, 4), round(key.position.y, 4), round(key.position.z, 4)],
      target: [0, 0, 0],
      intensity: round(key.intensity, 4),
      decay: key.decay,
      distance: key.distance,
      castShadow: Boolean(key.castShadow),
      shadowMapSize: [key.shadow.mapSize.x, key.shadow.mapSize.y],
      shadowBias: key.shadow.bias,
      shadowNormalBias: key.shadow.normalBias,
      shadowMapAllocated: Boolean(key.shadow.map),
      shadowType: this.renderer.shadowMap.enabled ? 'PCFSoftShadowMap' : 'disabled',
      distanceToCamera: round(key.position.distanceTo(this.camera.position), 6),
      // Round 7: the key is no longer camera-coincident; report the offset so QA
      // can assert the light is on the camera's right and not at the eye.
      positionMode: 'camera-right-offset',
      offsetDeg: { right: KEY_LIGHT.rightDeg, up: KEY_LIGHT.upDeg },
      distanceScale: KEY_LIGHT.distanceScale,
    };
  }

  getLightCounts() {
    let directional = 0;
    let point = 0;
    let ambient = 0;
    let shadowCasters = 0;
    let hemisphere = 0;
    this.scene.traverse((object) => {
      if (!object.isLight) return;
      if (object.isDirectionalLight) directional += 1;
      if (object.isPointLight) point += 1;
      if (object.isAmbientLight) ambient += 1;
      if (object.isHemisphereLight) hemisphere += 1;
      if (object.castShadow) shadowCasters += 1;
    });
    return { directional, point, shadowCasters, ambient, hemisphere, total: directional + point + ambient + hemisphere };
  }

  _screenRowForWorldPoint(point) {
    // Project a world point to a CSS-pixel row inside the stage (0 = top).
    const projected = point.clone().project(this.camera);
    return (0.5 - projected.y * 0.5) * this._size.h;
  }

  _floorVAtScreenRow(row) {
    // Ray from the camera through the given stage row; intersect the glass plane.
    if (!this.camera || !this._size.h) return null;
    const ndcY = 1 - (row / this._size.h) * 2;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const direction = forward.clone().addScaledVector(up, ndcY * tan).normalize();
    if (Math.abs(direction.y) < 1e-6) return null;
    const distance = (REFLECTION.floorY - this.camera.position.y) / direction.y;
    if (distance <= 0) return null;
    const hit = this.camera.position.clone().addScaledVector(direction, distance);
    return clamp(0.5 + (REFLECTION.floorCenterZ - hit.z) / REFLECTION.floorDepth, 0, 1);
  }

  getReflectionDebug() {
    const card = this.cards.light || this.cards.dark;
    const materials = card && card.materials ? card.materials : null;
    const envFor = (id) => {
      const target = this.cards[id];
      const targetMaterials = target && target.materials ? target.materials : null;
      return targetMaterials
        ? {
            front: round(targetMaterials.front ? targetMaterials.front.envMapIntensity : 0, 3),
            edge: round(targetMaterials.edge ? targetMaterials.edge.envMapIntensity : 0, 3),
            back: round(targetMaterials.back ? targetMaterials.back.envMapIntensity : 0, 3),
          }
        : null;
    };
    return {
      enabled: Boolean(this.reflectionEnabled),
      floorVisible: Boolean(
        this._reflectionFloor && this._reflectionFloor.visible && this.reflectionWeight > 0.001
      ),
      reflectionPass: Boolean(
        this.reflectionEnabled && this.reflectionWeight > 0.5 && this._reflectionRoot && this._reflectionRoot.visible
      ),
      // Round-3 shape (light card = polished edge, the headline boost). Round 4
      // adds envByCard so QA can read the dark card's deliberately lower edge
      // boost; debug().edgeMaterials remains the authoritative live per-card
      // material source (color + satin props included).
      env: {
        front: round(materials && materials.front ? materials.front.envMapIntensity : 0, 3),
        edge: round(materials && materials.edge ? materials.edge.envMapIntensity : 0, 3),
        back: round(materials && materials.back ? materials.back.envMapIntensity : 0, 3),
      },
      envByCard: { light: envFor('light'), dark: envFor('dark') },
      mode: this.reflectionEnabled ? 'on' : 'off',
      weight: round(this.reflectionWeight, 3),
      implementation: 'mirrored-clones',
      layers: {
        mirror: Boolean(this._reflectionRoot && this._reflectionRoot.visible),
        glass: Boolean(this._reflectionFloor && this._reflectionFloor.visible),
        fade: false,
      },
      ghostOpacity: round(this.reflectionWeight * REFLECTION.cloneOpacity, 3),
    };
  }

  getReflectionScreenDebug() {
    const out = { mirrorScreen: null, samples: [] };
    if (!this.camera || !this._size.h || !this._reflectionRoot) return out;
    const box = new THREE.Box3().setFromObject(this._reflectionRoot);
    if (box.isEmpty()) return out;
    const corners = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    const rows = corners.map((corner) => this._screenRowForWorldPoint(corner));
    const cols = corners.map((corner) => {
      const ndc = corner.clone().project(this.camera);
      return (ndc.x * 0.5 + 0.5) * this._size.w;
    });
    out.mirrorScreen = {
      x0: round(Math.min(...cols), 1),
      y0: round(Math.min(...rows), 1),
      x1: round(Math.max(...cols), 1),
      y1: round(Math.max(...rows), 1),
      stageH: round(this._size.h, 1),
    };
    for (const [label, row] of [
      ['mirrorTop', Math.min(...rows)],
      ['mirrorBottom', Math.max(...rows)],
      ['stageBottom', this._size.h],
    ]) {
      const v = this._floorVAtScreenRow(row);
      out.samples.push({
        at: label,
        row: round(row, 1),
        v: v === null ? null : round(v, 3),
        glassAlpha: v === null ? null : round(reflectionFloorCoverage(v), 3),
        coverage: v === null ? null : round(reflectionFloorCoverage(v), 3),
        overlayAlpha: 0,
      });
    }
    return out;
  }

  getRenderDebug() {
    return {
      triangles: this._stats.triangles,
      drawCalls: this._stats.drawCalls,
      pixelRatio: round(this.renderer.getPixelRatio(), 3),
      shadowMapEnabled: Boolean(this.renderer.shadowMap.enabled),
      shadowMapType: this.renderer.shadowMap.type === THREE.PCFSoftShadowMap ? 'PCFSoftShadowMap' : String(this.renderer.shadowMap.type),
      frames: this._frameCount,
      renders: this._renderCount,
      size: { width: this._size.w, height: this._size.h },
    };
  }

  getWebGLVersion() {
    try {
      const gl = this.renderer.getContext();
      return gl.getParameter(gl.VERSION) || '';
    } catch (error) {
      return '';
    }
  }

  dispose() {
    this._destroyed = true;
    if (this._raf) window.cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._pulseTimer) window.clearInterval(this._pulseTimer);
    this._pulseTimer = 0;
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerCancel);
    this.canvas.removeEventListener('dblclick', this._onDoubleClick);
    for (const card of this.cardList) {
      try {
        if (typeof card.dispose === 'function') card.dispose();
      } catch (error) {
        /* disposal is best effort */
      }
    }
    if (this.backdrop) {
      this.backdrop.geometry.dispose();
      this.backdrop.material.map.dispose();
      this.backdrop.material.dispose();
    }
    if (this.shadowDecals) {
      for (const entry of this.shadowDecals) {
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
        this.scene.remove(entry.mesh);
      }
      this.shadowDecals = [];
    }
    if (this._shadowTexture) this._shadowTexture.dispose();
    if (this._reflectionRoot) {
      this._disposeReflectionClones();
      this.scene.remove(this._reflectionRoot);
      this._reflectionRoot = null;
    }
    if (this._reflectionFloor) {
      this.scene.remove(this._reflectionFloor);
      this._reflectionFloor.geometry.dispose();
      this._reflectionFloor.material.dispose();
      this._reflectionFloor = null;
    }
    if (this._reflectionAlphaTexture) {
      this._reflectionAlphaTexture.dispose();
      this._reflectionAlphaTexture = null;
    }
    if (this._reflectionTintTexture) {
      this._reflectionTintTexture.dispose();
      this._reflectionTintTexture = null;
    }
    if (this._envRT) this._envRT.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}

/* =========================================================================
   Page controller
   ========================================================================= */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
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

function showFallback(message, { error = null, banner = false } = {}) {
  state.failed = true;
  state.ready = false;
  state.booting = false;
  if (error) pushError(errorMessage(error));
  if (dom.fallback) {
    dom.fallback.hidden = false;
    if (dom.fallbackMessage) dom.fallbackMessage.textContent = message;
  }
  dom.body.dataset.fallback = '1';
  dom.body.dataset.qaReady = '0';
  for (const button of [dom.btnReset, dom.btnSwap, dom.btnAuto, dom.btnReflection]) {
    if (button) button.disabled = true;
  }
  hideCurtain();
  if (banner) showErrorBanner(message);
  if (dom.infoFootState) dom.infoFootState.textContent = 'Static fallback';
  if (dom.footerStatus) dom.footerStatus.textContent = 'Static fallback';
  announce('Static preview: ' + message);
  publishState();
}

function syncResetUi() {
  if (!dom.btnReset) return;
  dom.btnReset.disabled = !state.ready;
}
function syncSwapUi() {
  if (!dom.btnSwap) return;
  dom.btnSwap.disabled = !state.ready;
  dom.btnSwap.setAttribute('aria-pressed', String(state.swapFront === 'dark'));
}
function syncAllUi() {
  syncResetUi();
  syncSwapUi();
  syncAutoUi();
  syncReflectionUi();
  syncSwappedUi();
  publishState();
}

function setStudioStateFromStudio() {
  if (!state.studio) return;
  const pose = state.studio.getPose();
  state.pose = { yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg };
  state.swapFront = state.studio.getOrder().front;
  state.autoRotate = state.studio.autoRotate;
  state.reflection = state.studio.reflectionEnabled;
}

function afterInteraction(action) {
  setStudioStateFromStudio();
  syncAllUi();
  if (dom.footerStatus && state.ready) dom.footerStatus.textContent = state.swapFront === 'dark' ? 'Swapped' : 'Ready';
  if (action) announce(action);
}

function doReset({ immediate = false } = {}) {
  if (!state.studio) return Promise.resolve(false);
  const run = state.studio.reset({ immediate });
  afterInteraction('View reset');
  return run.then((pose) => {
    afterInteraction('View reset');
    return pose;
  });
}

function doSwap({ immediate = false } = {}) {
  if (!state.studio) return Promise.resolve(false);
  const order = state.studio.swap({ immediate });
  setStudioStateFromStudio();
  syncAllUi();
  const swapped = order.front === 'dark';
  announce(swapped ? 'Cards swapped · dark card in front' : 'Cards in default order · light card in front');
  return Promise.resolve(order).then(async () => {
    await state.studio.waitSwap();
    afterInteraction(swapped ? 'Cards swapped · dark card in front' : 'Cards in default order · light card in front');
    return state.studio.getOrder();
  });
}

function doAutoRotate(enabled) {
  if (!state.studio) return false;
  const next = state.studio.setAutoRotate(enabled);
  state.autoRotate = next;
  syncAutoUi();
  syncAllUi();
  announce(next ? 'Auto-rotate on' : 'Auto-rotate off');
  publishState();
  return next;
}

function doSetReflection(enabled) {
  if (!state.studio) return false;
  let prefersReduced = state.reducedMotion || state.still;
  try {
    prefersReduced = prefersReduced || Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (error) { /* media query is best effort */ }
  const next = state.studio.setReflection(Boolean(enabled), { immediate: prefersReduced });
  state.reflection = next;
  syncReflectionUi();
  syncAllUi();
  announce(next ? 'Reflection on · glass-table mirror' : 'Reflection off · clean studio view');
  publishState();
  return next;
}

function doSetFrozen(frozen) {
  state.frozen = Boolean(frozen) || state.still;
  if (state.studio) state.studio.setFrozen(state.frozen);
  syncAutoUi();
  syncAllUi();
  return state.frozen;
}

function wireUi() {
  if (dom.btnReset) {
    dom.btnReset.addEventListener('click', () => {
      if (!state.ready) return;
      doReset({ immediate: false }).then(() => publishState());
    });
  }
  if (dom.btnSwap) {
    dom.btnSwap.addEventListener('click', () => {
      if (!state.ready) return;
      doSwap({ immediate: state.reducedMotion });
    });
  }
  if (dom.btnAuto) {
    dom.btnAuto.addEventListener('click', () => {
      if (!state.ready) return;
      doAutoRotate(!state.autoRotate);
    });
  }
  if (dom.btnReflection) {
    dom.btnReflection.addEventListener('click', () => {
      if (!state.ready) return;
      doSetReflection(!state.reflection);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (!target) return;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    const key = String(event.key || '').toLowerCase();
    const isButton = tag === 'BUTTON';
    if (isButton && (key === ' ' || key === 'enter' || key === 'spacebar')) return;
    if (key === 'r') {
      event.preventDefault();
      if (state.ready) doReset({ immediate: false }).then(() => publishState());
    } else if (key === 'f') {
      event.preventDefault();
      if (state.ready) doSwap({ immediate: state.reducedMotion });
    } else if (key === 's') {
      event.preventDefault();
      if (state.ready) doAutoRotate(!state.autoRotate);
    } else if (key === 'e') {
      event.preventDefault();
      if (state.ready) doSetReflection(!state.reflection);
    }
  });

  reducedMotionQuery.addEventListener('change', (event) => {
    state.reducedMotion = event.matches;
    if (state.reducedMotion) {
      state.autoRotate = false;
      if (state.studio) {
        state.studio.reducedMotion = true;
        state.studio.setAutoRotate(false);
        state.studio.setReflection(state.studio.reflectionEnabled, { immediate: true });
      }
    } else if (state.studio) {
      state.studio.reducedMotion = false;
    }
    state.frozen = state.still ? true : state.frozen;
    syncAllUi();
  });
  if (reducedMotionQuery.addEventListener) {
    /* listener registered above */
  } else if (reducedMotionQuery.addListener) {
    reducedMotionQuery.addListener(() => {});
  }
}

/* ------------------------------------------------------------- QA API */

let resolveReady = null;
const readyPromise = new Promise((resolve) => {
  resolveReady = resolve;
});

const api = {
  version: VERSION,
  ready: readyPromise,
  debug: buildDebug,
  getPose() {
    if (state.studio) return state.studio.getPose();
    return { yawDeg: state.pose.yawDeg, pitchDeg: state.pose.pitchDeg };
  },
  setPose(yawDeg, pitchDeg) {
    if (!state.studio) return false;
    const pose = state.studio.setPose(yawDeg, pitchDeg);
    setStudioStateFromStudio();
    syncAllUi();
    return pose;
  },
  reset(options = {}) {
    if (!state.studio) return Promise.resolve(false);
    return doReset({ immediate: Boolean(options && options.immediate) }).then((pose) => {
      publishState();
      return pose;
    });
  },
  swap(options = {}) {
    if (!state.studio) return Promise.resolve(false);
    return doSwap({ immediate: Boolean(options && options.immediate) }).then((order) => {
      publishState();
      return order;
    });
  },
  setAutoRotate(enabled) {
    if (!state.studio) return false;
    const next = doAutoRotate(Boolean(enabled));
    publishState();
    return next;
  },
  setFrozen(frozen) {
    const next = doSetFrozen(Boolean(frozen));
    publishState();
    return next;
  },
  waitForIdle() {
    if (!state.studio) return Promise.resolve(true);
    return state.studio.waitForIdle().then(() => {
      publishState();
      return true;
    });
  },
  // QA-only ablation toggle (documented in docs/card-preview.md): lets the
  // independent QA harness prove the authored soft shadow by diffing decal-on vs
  // decal-off captures on the delivered build. No other diagnostics are exposed.
  __qa: {
    setDecals(visible) {
      if (!state.studio) return false;
      state.studio.decalsEnabled = Boolean(visible);
      for (const entry of state.studio.shadowDecals || []) entry.mesh.visible = state.studio.decalsEnabled;
      state.studio.requestRender();
      state.studio.renderNow();
      return state.studio.decalsEnabled;
    },
    decalsVisible() {
      return Boolean(state.studio && state.studio.decalsEnabled !== false);
    },
  },
};
window.__tekoCard = api;

/* ---------------------------------------------------------------- boot */

function parsePoseParam() {
  const raw = urlParams.get('pose');
  if (!raw) return null;
  const parts = String(raw).split(',');
  const yaw = Number(parts[0]);
  const pitch = Number(parts[1] || 0);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  return {
    yawDeg: clamp(yaw, -HARD_LIMITS.yawDeg, HARD_LIMITS.yawDeg),
    pitchDeg: clamp(pitch, -HARD_LIMITS.pitchDeg, HARD_LIMITS.pitchDeg),
  };
}

async function boot() {
  state.bootStartedAt = performance.now();
  // ?still=1 and ?shot=1 are deterministic capture modes: freeze the idle float
  // (and every other motion) exactly like still mode, so repeated shots are
  // pixel-identical (docs/card-preview.md promises the same motion suppression
  // for ?shot=1 as for ?qa).
  state.frozen = state.still || state.shot;
  state.booting = true;

  // Deterministic flags first: body attributes must already be right while the
  // curtain is still up (QA polls them).
  dom.body.dataset.fallback = '0';
  dom.body.dataset.qaReady = '0';
  dom.body.dataset.qaCards = '';
  dom.body.dataset.qaErrors = String(qa.errors.length);
  dom.body.dataset.qaComposition = 'duo';
  dom.body.dataset.qaPose = '0,0';
  if (state.still) dom.body.dataset.still = '1';
  if (state.shot) dom.body.dataset.shot = '1';
  if (state.qaMode) dom.body.dataset.qa = '1';
  if (state.reducedMotion) dom.body.dataset.reducedMotion = '1';
  dom.body.dataset.qaReflection = state.reflection ? '1' : '0';
  syncAutoUi();
  syncReflectionUi();
  syncSwappedUi();
  syncResetUi();
  syncSwapUi();
  publishState();

  curtainProgress(0.02, 'Detecting WebGL', '0 / 0');
  const webgl = probeWebGL();
  qa.webgl = webgl;
  if (!webgl) {
    showFallback('WebGL is not available in this browser, so the interactive metal card cannot be rendered. The two original source card faces are shown below.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.05, 'Loading 3D engine', '');
  let modelModule = null;
  try {
    modelModule = await import(MODEL_URL.href);
  } catch (error) {
    showFallback('The card model module could not be loaded (' + errorMessage(error) + '). The source card faces are shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }

  if (!modelModule || typeof modelModule.loadCardBank !== 'function') {
    showFallback('The card model module did not expose the expected loadCardBank() API.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.08, 'Loading card textures', '0 / 0');
  try {
    // One retry: a transient HTTP/asset read hiccup must not drop the preview
    // to the static fallback mid-capture.
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        state.bank = await modelModule.loadCardBank({
          assetBase: ASSET_BASE,
          onProgress: (loaded, total) => {
            const safeTotal = Number(total) || 0;
            const ratio = safeTotal > 0 ? clamp(loaded / safeTotal, 0, 1) : 0;
            curtainProgress(0.08 + ratio * 0.62, 'Loading card textures', loaded + ' / ' + (safeTotal || '—'));
          },
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          pushWarning('card asset load failed, retrying once: ' + errorMessage(error));
          curtainProgress(0.08, 'Retrying card textures', '0 / 0');
          await new Promise((resolve) => window.setTimeout(resolve, 350));
        }
      }
    }
    if (lastError) throw lastError;
  } catch (error) {
    showFallback('The card model assets could not be loaded (' + errorMessage(error) + '). The source card faces are shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }

  if (!state.bank || typeof state.bank.createCard !== 'function' || !Array.isArray(state.bank.specs) || !state.bank.specs.length) {
    showFallback('The card model module did not expose the expected bank API (loadCardBank/createCard/card.group).');
    resolveReady(false);
    return;
  }

  state.specs = state.bank.specs.slice();
  state.metrics = state.bank.metrics || null;
  const ids = state.specs.map((spec) => spec.id);
  if (!ids.includes('dark') || !ids.includes('light')) {
    pushWarning('expected dark + light card specs, got ' + ids.join(','));
  }

  curtainProgress(0.72, 'Building the card pair', '');
  try {
    state.studio = new CardStudio({
      canvas: dom.canvas,
      stage: dom.stage,
      metrics: state.metrics || state.bank.metrics,
      reducedMotion: state.reducedMotion,
      still: state.still,
      frozen: state.frozen,
      reflection: state.reflection,
    });
    state.studio.onInteract = () => {
      setStudioStateFromStudio();
      publishState();
    };
    state.studio.onContextLost = () => {
      showFallback('WebGL context was lost, so the static source card faces are shown below.');
      resolveReady(false);
    };
    await state.studio.init();

    const cards = {};
    for (const id of ['dark', 'light']) {
      const spec = specById(id) || state.specs[0];
      cards[id] = state.bank.createCard(spec, { quality: 'hero' });
      if (!cards[id] || !cards[id].group) throw new Error('card-model returned an invalid card for ' + id);
    }
    state.cards = cards;
    state.studio.setCards(cards);
    state.studio.setReflection(state.reflection, { immediate: true });

    // URL-driven deterministic state (?pose / ?swap / ?reflection), applied before ready.
    const pose = parsePoseParam();
    if (pose) state.studio.setPose(pose.yawDeg, pose.pitchDeg);
    if (urlParams.get('swap') === '1') state.studio.swap({ immediate: true });
    await state.studio.settleForReady();
    await state.studio.waitForIdle();
  } catch (error) {
    if (state.studio) {
      try {
        state.studio.dispose();
      } catch (disposeError) {
        /* best effort */
      }
      state.studio = null;
    }
    showFallback('The card studio could not start (' + errorMessage(error) + '). The source card faces are shown below.', { error, banner: true });
    resolveReady(false);
    return;
  }

  curtainProgress(0.94, 'Preparing the studio', '');
  try {
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, new Promise((resolve) => window.setTimeout(resolve, 900))]);
    }
  } catch (error) {
    /* font readiness is cosmetic only */
  }

  // Fonts can shift the grid by a pixel; refit + re-render before the page is
  // declared ready so the FIRST capture of a fresh load is already the fitted,
  // settled frame (QA determinism).
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
  window.clearTimeout(state.watchdog);
  setStudioStateFromStudio();
  syncVariantInfo();
  syncAllUi();
  if (dom.footerStatus) dom.footerStatus.textContent = state.swapFront === 'dark' ? 'Swapped' : 'Ready';
  announce('Metal card duo ready');
  state.studio.requestRender();
  await state.studio.whenFirstFrame();
  state.studio.renderNow();
  publishState();
  resolveReady(true);
}

/* --------------------------------------------------------------- main */

wireUi();
syncVariantInfo();
syncAllUi();
if (dom.footerStatus) dom.footerStatus.textContent = 'Loading';
publishState();

boot().catch((error) => {
  if (!state.failed) {
    showFallback('The preview failed to start (' + errorMessage(error) + '). The source card faces are shown below.', { error, banner: true });
  }
  resolveReady(false);
});

state.watchdog = window.setTimeout(() => {
  if (!state.ready && !state.failed) {
    showFallback('The interactive preview did not start within 20 seconds. The source card faces are shown below.', { banner: true });
    resolveReady(false);
  }
}, 20000);

// Keep the mirrored body attributes / hidden diag fresh (cheap, hidden) so CDP
// can read live pose and state without racing the render loop.
window.setInterval(() => {
  if (state.failed) return;
  if (state.studio) setStudioStateFromStudio();
  publishState();
}, 400);

window.addEventListener('pagehide', () => {
  window.clearTimeout(state.watchdog);
  if (state.studio && typeof state.studio.dispose === 'function') state.studio.dispose();
});
