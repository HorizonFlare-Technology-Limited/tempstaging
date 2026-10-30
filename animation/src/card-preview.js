/**
 * tekoanimation — metal card preview controller.
 *
 * Owns the page shell wiring, the QA hooks (contract §4.5) and the three.js
 * studio: a two-card glossy sleek-steel composition (light card front-left, dark
 * card behind-right) on a dark studio backdrop, both cards edged with the
 * Revision-8 thin mirror-chrome middle frame.
 *
 * Lighting contract (Revision 21): the page is lit ONLY by the shared room-photo
 * image-based lighting in `src/env-room.js` — assets/env/modern-empty-room.jpg
 * filtered through a PMREM and assigned to `scene.environment`. There are no
 * THREE light objects and no procedural studio environment. The
 * card materials are metal (metalness 1, low roughness), so they mirror the dark
 * room with its bright ceiling downlights; brightness is balanced with the shared
 * env intensity plus `toneMappingExposure`. Reflection and shadow are computed
 * from the real scene (mirrored-camera planar reflection + projected contact shadow).
 *
 * The card meshes themselves (geometry + textures + PBR materials) come from
 * ./card-model.js through the frozen API; this module never builds card
 * textures. A stale/missing model degrades to a static duo of the two original
 * source PNGs, exactly like the coin page's static fallback.
 */
import * as THREE from 'three';
import { applyEnvRoom } from './env-room.js';
const VERSION = '1.0.0';

// Dynamic on purpose: a missing / broken model module must degrade gracefully.
const MODEL_URL = new URL('./card-model.js', import.meta.url);
const ASSET_BASE = './assets/textures/card';
const SOURCE_DUO = Object.freeze({
  dark: './assets/textures/card/source/novocard-default-dark.png',
  light: './assets/textures/card/source/novocard-default-light.png',
});

// Card-set edge row (vertical orientation, ported from the standalone page):
// pitch is the spacing along the camera-right row axis.
const CARD_SET = Object.freeze({ count: 9, pitch: 0.62, raisedIndex: 4, raise: 1.1 });
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
// Revision 21: the page is lit ONLY by the shared room-photo IBL
// (src/env-room.js -> assets/env/modern-empty-room.jpg PMREM). No THREE light
// object exists any more, so the old single right-side key PointLight rig and the
// purpose-built softbox PMREM studio (their constants, builders and shadow map)
// are gone. `ENV_INTENSITY.on` is the tuned room-radiance multiplier (r151 applies
// it through each material's own envMapIntensity, so the model's authored values
// are preserved); the light toggle reuses the old ?light=0|1 / L API as a room
// light level: ON = normal env intensity, OFF = dimmed (ENV_INTENSITY.off).
const ENV_ROOM_REPORT = 'assets/env/modern-empty-room.jpg (PMREM, env-room)';
const ENV_INTENSITY = Object.freeze({ on: 1, off: 0.45 });
// Highlight expansion of the LDR room photo (see env-room.js applyHighlightBoost).
const ENV_BOOST = 7;
// Rev5 s30: env Euler XYZ rotation (deg; default rolls the ceiling lights onto the card's right side) so the brightest reflection sits on the card's side, not its top. ?envrot=<deg> overrides for tuning.
const ENV_ROTATION_DEG = (() => { try { const q = new URLSearchParams(location.search).get('envrot'); if (q != null) { const v = q.split(',').map(Number); if (v.every(Number.isFinite)) return v.length === 3 ? v : [0, v[0] || 0, 0]; } } catch (e) { /* default */ } return [0, 0, -90]; })();
// Fraction of the projected authored-shadow offset applied to the soft-shadow
// decals (>1 exaggerates it so the soft shadow still reads on the backdrop).
const SHADOW_SHIFT = 1.9;
// Authored direction of the visible soft-shadow decals, in degrees relative to
// the live camera axis (the room's bright ceiling downlights sit above/behind the
// camera, so the shadow is displaced toward camera-left and slightly down).
const SHADOW_OFFSET = Object.freeze({ rightDeg: 20, upDeg: 5 });
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
// "Reflection" presentation mode: a glass table below the floating pair shows a
// REAL planar reflection of the page scene (re-rendered from the mirrored camera,
// see CardStudio._renderMirror) plus a real projected contact shadow. Nothing is
// painted; the card materials' env response is boosted in this mode.
const REFLECTION = Object.freeze({
  floorY: -1.90,
  floorWidth: 48,
  floorDepth: 24,
  floorCenterZ: 0,
  // shader constants: base reflectance (plus analytic Fresnel) and the radial
  // falloff radius (world units) that fades the mirror image out with distance.
  strength: 0.22,
  fadeRadius: 4.6,
  transitionSeconds: 0.25,
  // How much of the mirrored card image is framed below the pair when ON.
  frameBand: 0.8,
  // Round 3 reflection boost: shared front/back values plus the mirror-bezel
  // boost. Revision 8 (round 8): BOTH cards' bezels are mirror chrome, so the
  // old Round-4 per-card satin clamp is gone; a single modest edge boost is
  // applied to both live edge materials and clamped to a narrow band so
  // reflection ON cannot clip the chrome rim to flat white. The OFF/base values
  // are read live from the model (dark 1.35 / light 1.45 in v2.6.0).
  // Revision 15: the dark frame is a near-black metal mirror (its F0 reflects
  // much less than chrome), so reflection ON lifts the dark edge above the light
  // chrome edge; both stay clamped so neither rim clips to flat white.
  envOn: Object.freeze({ front: 1.6, frontDark: 1.0, edge: 1.75, edgeDark: 3.0, edgeLight: 1.75, back: 0.8, backLight: 2.95 }),
  // Revision 6: the backs are per-card reconstructed artwork with their own OFF
  // envMapIntensity (dark 0.70 / light 2.40). The shared R3 value 0.8 is still
  // the dark back's ON target; the light back needs its own slightly higher ON
  // target so reflection mode brightens both backs instead of dimming the white
  // one (see docs/card-model-contract.md R6.3).
  edgeOnMin: 1.45,
  edgeOnMax: 2.0,
});
// Projected contact shadow: real card geometry rendered from above onto the table.
const CONTACT_SHADOW = Object.freeze({ width: 16, depth: 12, resolution: 512, range: 4.5, darkness: 1, blur: 2.2, opacity: 0.6 });
const PLANE_Z = new THREE.Vector3(0, 0, 1);
const CARD_SET_EDGE_YAW_DEG = 90 + CAMERA_SPEC.azimuthDeg;
const CARD_SET_ROW_AXIS = new THREE.Vector3(
  Math.cos((CAMERA_SPEC.azimuthDeg * Math.PI) / 180),
  0,
  -Math.sin((CAMERA_SPEC.azimuthDeg * Math.PI) / 180)
);

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
  btnLight: document.getElementById('btn-light'),
  btnSet: document.getElementById('btn-cardset'),
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
  cardSet: false,
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
  // Revision 21: there is no key light any more. The existing light toggle API
  // survives as a room env-intensity toggle: light ON = the tuned env intensity,
  // light OFF = dimmed env (?light=0|1, L key, setLight()).
  lightOn: urlParams.get('light') !== '0',
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
  // Revision 8: the two live numeric fact rows now describe the mirror-chrome
  // bezel (the user-facing headline of this round), so read the light card's
  // EDGE material and fall back to the front material only if it is missing.
  const lightMaterials = state.cards.light && state.cards.light.materials
    ? state.cards.light.materials
    : null;
  const bezel = lightMaterials ? (lightMaterials.edge || lightMaterials.front) : null;
  if (bezel) {
    if (dom.specMetalness && typeof bezel.metalness === 'number') dom.specMetalness.textContent = bezel.metalness.toFixed(2);
    if (dom.specClearcoat && typeof bezel.clearcoat === 'number') dom.specClearcoat.textContent = bezel.clearcoat.toFixed(2);
  }
}

function syncSwappedUi() {
  const swapped = state.swapFront === 'dark';
  if (dom.btnSwap) dom.btnSwap.setAttribute('aria-pressed', String(swapped));
  if (dom.btnAuto) dom.btnAuto.setAttribute('aria-pressed', String(state.autoRotate));
  if (dom.stageName) dom.stageName.textContent = state.cardSet ? 'Card set · 9' : swapped ? 'Light + Dark' : 'Dark + Light';
  if (dom.stageCode) dom.stageCode.textContent = swapped ? 'SWAP' : 'DUO';
  if (dom.infoFootState) dom.infoFootState.textContent = swapped ? 'Swapped · dark in front' : 'Default view';
  if (dom.stageHint) dom.stageHint.textContent = swapped ? 'Drag to rotate · F to swap back · L light' : 'Drag to rotate · L light';
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

function syncLightUi() {
  if (!dom.btnLight) return;
  const on = Boolean(state.lightOn);
  // Revision 21: the toolbar button was purely light-based (it switched the old
  // key PointLight), so it is hidden from the layout. The env-intensity toggle it
  // used to expose stays fully reachable through the L key, `?light=0|1` and the
  // public setLight() API, and its state is still reported in the QA attributes.
  dom.btnLight.hidden = true;
  dom.btnLight.setAttribute('hidden', '');
  dom.btnLight.disabled = !state.ready || state.failed;
  dom.btnLight.setAttribute('aria-pressed', String(on));
  const label = document.getElementById('btn-light-label');
  if (label) label.textContent = on ? 'Light ON' : 'Light OFF';
  dom.btnLight.title = on
    ? 'Room environment at full intensity — press L or load ?light=0 for dimmed room light.'
    : 'Room environment dimmed — press L or load ?light=1 for full room light.';
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
  body.dataset.qaComposition = state.cardSet ? 'set' : 'duo';
  body.dataset.qaCardCount = state.cardSet ? '9' : '2';
  body.dataset.fallback = state.failed ? '1' : '0';
  body.dataset.swapped = state.swapFront === 'dark' ? '1' : '0';
  body.dataset.frozen = state.frozen || state.still ? '1' : '0';
  body.dataset.autoRotate = state.autoRotate ? '1' : '0';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.qaReflection = state.reflection ? '1' : '0';
  body.dataset.qaLight = state.lightOn ? '1' : '0';
  body.dataset.light = state.lightOn ? 'on' : 'off';
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
// exposes card.materials.edge). Revision 8: QA asserts the mirror-chrome frame
// (metalness 1.0, roughness <= 0.10, finish 'mirror-chrome', live
// envMapIntensity inside the model's documented OFF/ON range).
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
      type: 'none',
      position: [0, 0, 0],
      target: [0, 0, 0],
      intensity: 0,
      castShadow: false,
      shadowMapSize: [0, 0],
      positionMode: 'environment-only',
      offsetDeg: { right: SHADOW_OFFSET.rightDeg, up: SHADOW_OFFSET.upDeg },
    },
    // Revision 21: zero light objects — the room photo PMREM is the only light.
    lights: { directional: 0, point: 0, ambient: 0, hemisphere: 0, shadowCasters: 0, total: 0 },
    light: {
      enabled: Boolean(state.lightOn),
      keyType: 'none',
      keyIntensity: 0,
      ambientIntensity: 0,
      environment: ENV_ROOM_REPORT,
      mode: state.lightOn ? 'on' : 'off',
      intensity: state.lightOn ? ENV_INTENSITY.on : ENV_INTENSITY.off,
    },
    materials: [],
    edgeMaterials: [],
    backMaterials: [],
    reflection: null,
    assets: { sameOrigin: true, urls: [], textures: [] },
    render: { triangles: 0, drawCalls: 0, pixelRatio: 1, shadowMapEnabled: false, frames: 0 },
    flags: {
      frozen: Boolean(state.frozen || state.still || state.shot),
      autoRotate: Boolean(state.autoRotate),
      light: Boolean(state.lightOn),
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
    debug.light = studio.getEnvironmentDebug();
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
   Studio — renderer, scene, image-based room light, backdrop, composition,
   interactions. Revision 21: the scene light is assets/env/modern-empty-room.jpg
   filtered through src/env-room.js; no THREE light is ever constructed.
   ========================================================================= */

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
    // Revision 21: the light toggle is a room env-intensity toggle (the old
    // key PointLight no longer exists).
    this.keyLightEnabled = options.light === undefined ? true : Boolean(options.light);
    this.envIntensity = ENV_INTENSITY.on;
    this._reflectionFloor = null;
    this._reflectionEnvBase = null;
    this._mirrorTarget = null;
    this._shadowPlane = null;
    this.decalsEnabled = true;
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

  async init() {
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
    // Revision 21: the room photo is a dark interior with bright ceiling
    // downlights, so the exposure is lifted well above the old key-light value
    // (0.89) to keep the mirrored card faces off black while the downlight
    // streaks stay below clipping.
    renderer.toneMappingExposure = 1.2;
    // No lights exist any more, so there are no shadow casters: the visible
    // soft shadow is the authored camera-angle decal.
    renderer.shadowMap.enabled = false;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_SPEC.fov, 1, CAMERA_SPEC.near, CAMERA_SPEC.far);
    this.camera.position.copy(CAMERA_AXIS).multiplyScalar(9);
    this.camera.lookAt(0, 0, 0);

    // Revision 21: the ONLY light. Awaited here (init() is awaited by boot())
    // so the page can never publish ready before the room env is applied. The
    // per-material envMapIntensity scaling is re-applied once the card materials
    // exist (setCards) and is re-derived from those authored values on a toggle.
    this.envRoom = await applyEnvRoom(THREE, renderer, this.scene, { intensity: this.envIntensity, boost: ENV_BOOST, rotation: ENV_ROTATION_DEG.map(degToRad) });

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
    this._buildReflection();
    this._buildContactShadow();

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

  _buildBackdrop() {
    // Seamless studio: a large unlit gradient sphere around the whole scene
    // (see makeStudioBackdropTexture). No finite backdrop edges can appear at
    // the 45-degree default view or any aspect ratio, and the glass floor fades
    // into it. The visible soft shadow is the authored camera-angle decal.
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
  /* Real planar reflection + real contact shadow, both computed from the page
     scene every render (nothing is painted into a canvas):
       - mirror: the scene (cards lit by the room env) is re-rendered from the
         camera mirrored about the glass-table plane into a render target; the
         table samples it as a projective texture, weighted by an analytic Fresnel
         term and a distance falloff computed in the shader.
       - contact shadow: the real card geometry is rendered from above with a
         height-above-floor shader, max-blended, blurred and drawn on the floor. */

  _buildReflection() {
    this._mirrorTarget = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 4 });
    this._mirrorCamera = new THREE.PerspectiveCamera();
    this._mirrorMatrixTex = new THREE.Matrix4();
    this._mirrorUniforms = {
      tMirror: { value: this._mirrorTarget.texture },
      uTextureMatrix: { value: this._mirrorMatrixTex },
      uWeight: { value: 0 },
      uCenter: { value: new THREE.Vector3(0, REFLECTION.floorY, 0) },
      uFadeRadius: { value: REFLECTION.fadeRadius },
      uStrength: { value: REFLECTION.strength },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this._mirrorUniforms,
      vertexShader: [
        'uniform mat4 uTextureMatrix;',
        'varying vec4 vProj;',
        'varying vec3 vWorld;',
        'void main() {',
        '  vProj = uTextureMatrix * vec4(position, 1.0);',
        '  vec4 world = modelMatrix * vec4(position, 1.0);',
        '  vWorld = world.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * world;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tMirror;',
        'uniform float uWeight;',
        'uniform float uFadeRadius;',
        'uniform float uStrength;',
        'uniform vec3 uCenter;',
        'varying vec4 vProj;',
        'varying vec3 vWorld;',
        'void main() {',
        '  vec3 mirror = texture2DProj(tMirror, vProj).rgb;',
        '  vec3 viewDir = normalize(cameraPosition - vWorld);',
        '  float cosTheta = clamp(viewDir.y, 0.0, 1.0);',
        '  float fresnel = 0.04 + 0.96 * pow(1.0 - cosTheta, 5.0);',
        '  vec2 d = vWorld.xz - uCenter.xz;',
        '  float falloff = exp(-dot(d, d) / (uFadeRadius * uFadeRadius));',
        '  float k = clamp(uStrength + fresnel * 0.5, 0.0, 1.0) * falloff * uWeight;',
        '  gl_FragColor = vec4(mirror * k, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <encodings_fragment>',
        '}',
      ].join('\n'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(REFLECTION.floorWidth, REFLECTION.floorDepth), material);
    floor.name = 'reflection-floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, REFLECTION.floorY, REFLECTION.floorCenterZ);
    floor.renderOrder = 3;
    floor.visible = false;
    this.scene.add(floor);
    this._reflectionFloor = floor;
    this._resizeMirrorTarget();
    this._applyReflectionState();
  }

  _resizeMirrorTarget() {
    if (!this._mirrorTarget || !this.renderer) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this._mirrorTarget.setSize(Math.max(2, Math.round(size.x * 0.75)), Math.max(2, Math.round(size.y * 0.75)));
  }

  _buildContactShadow() {
    const spec = CONTACT_SHADOW;
    const height = Math.round(spec.resolution * (spec.depth / spec.width));
    const opts = { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this._shadowRtA = new THREE.WebGLRenderTarget(spec.resolution, height, opts);
    this._shadowRtB = new THREE.WebGLRenderTarget(spec.resolution, height, opts);
    this._shadowCamera = new THREE.OrthographicCamera(-spec.width / 2, spec.width / 2, spec.depth / 2, -spec.depth / 2, 0.01, 40);
    this._shadowCamera.up.set(0, 0, -1);
    this._shadowCamera.position.set(0, REFLECTION.floorY + 20, 0);
    this._shadowCamera.lookAt(0, REFLECTION.floorY, 0);
    this._shadowCamera.updateMatrixWorld(true);
    // Height-above-floor shader: nearer the floor = darker; max-blended so the
    // lowest surface of the real card geometry wins at every texel.
    this._shadowDepthMaterial = new THREE.ShaderMaterial({
      uniforms: { uFloorY: { value: REFLECTION.floorY }, uRange: { value: spec.range }, uDarkness: { value: spec.darkness } },
      vertexShader: 'varying float vH; uniform float uFloorY;\nvoid main() { vec4 w = modelMatrix * vec4(position, 1.0); vH = w.y - uFloorY; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'varying float vH; uniform float uRange; uniform float uDarkness;\nvoid main() { float a = vH < 0.0 ? 0.0 : uDarkness * (1.0 - smoothstep(0.0, uRange, vH)); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }',
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this._shadowBlurMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;',
        'void main() {',
        '  float a = texture2D(tDiffuse, vUv).a * 0.2270270270;',
        '  a += (texture2D(tDiffuse, vUv + uDir * 1.3846153846).a + texture2D(tDiffuse, vUv - uDir * 1.3846153846).a) * 0.3162162162;',
        '  a += (texture2D(tDiffuse, vUv + uDir * 3.2307692308).a + texture2D(tDiffuse, vUv - uDir * 3.2307692308).a) * 0.0702702703;',
        '  gl_FragColor = vec4(0.0, 0.0, 0.0, a);',
        '}',
      ].join('\n'),
      depthTest: false,
      depthWrite: false,
    });
    this._shadowQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._shadowBlurMaterial);
    this._shadowQuad.frustumCulled = false;
    this._shadowQuadScene = new THREE.Scene();
    this._shadowQuadScene.add(this._shadowQuad);
    this._shadowQuadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.width, spec.depth),
      new THREE.MeshBasicMaterial({ map: this._shadowRtA.texture, transparent: true, opacity: spec.opacity, depthWrite: false, toneMapped: false })
    );
    plane.name = 'contact-shadow';
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, REFLECTION.floorY + 0.004, 0);
    plane.renderOrder = 2;
    plane.visible = false;
    this.scene.add(plane);
    this._shadowPlane = plane;
  }

  _withHidden(list, fn) {
    const saved = list.map((object) => (object ? object.visible : false));
    list.forEach((object) => { if (object) object.visible = false; });
    try { fn(); } finally { list.forEach((object, i) => { if (object) object.visible = saved[i]; }); }
  }

  _renderContactShadow() {
    const plane = this._shadowPlane;
    if (!plane || !this.cards.light || !this.cards.dark) return;
    const show = this.decalsEnabled !== false && !this.setMode;
    plane.visible = show;
    if (!show) return;
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevColor = renderer.getClearColor(new THREE.Color());
    this.scene.updateMatrixWorld(true);
    this._withHidden([this.backdrop, this._reflectionFloor, plane], () => {
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this._shadowRtA);
      renderer.clear();
      this.scene.overrideMaterial = this._shadowDepthMaterial;
      renderer.render(this.scene, this._shadowCamera);
      this.scene.overrideMaterial = null;
    });
    const spec = CONTACT_SHADOW;
    const passes = [
      [this._shadowRtA, this._shadowRtB, 1, 0],
      [this._shadowRtB, this._shadowRtA, 0, 1],
      [this._shadowRtA, this._shadowRtB, 1, 0],
      [this._shadowRtB, this._shadowRtA, 0, 1],
    ];
    for (const [from, to, dx, dy] of passes) {
      this._shadowBlurMaterial.uniforms.tDiffuse.value = from.texture;
      this._shadowBlurMaterial.uniforms.uDir.value.set((dx * spec.blur) / from.width, (dy * spec.blur) / from.height);
      renderer.setRenderTarget(to);
      renderer.clear();
      renderer.render(this._shadowQuadScene, this._shadowQuadCamera);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
  }

  _renderMirror() {
    const floor = this._reflectionFloor;
    if (!floor) return;
    const weight = this._mirrorUniforms.uWeight.value;
    if (!floor.visible || !(weight > 0.001)) return;
    const camera = this.camera;
    const vc = this._mirrorCamera;
    const normal = new THREE.Vector3(0, 1, 0);
    const point = new THREE.Vector3(0, REFLECTION.floorY, 0);
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= point.y) return;
    const view = new THREE.Vector3().subVectors(point, camPos).reflect(normal).negate().add(point);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = new THREE.Vector3().subVectors(point, lookAt).reflect(normal).negate().add(point);
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vc.lookAt(target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld(true);
    vc.projectionMatrix.copy(camera.projectionMatrix);
    floor.updateMatrixWorld(true);
    this._mirrorMatrixTex.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this._mirrorMatrixTex.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse).multiply(floor.matrixWorld);
    // Oblique near plane = the table plane, so geometry below the table never shows.
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(vc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix;
    const q = new THREE.Vector4(
      (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0],
      (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5],
      -1,
      (1 + pm.elements[10]) / pm.elements[14]
    );
    clip.multiplyScalar(2 / clip.dot(q));
    pm.elements[2] = clip.x;
    pm.elements[6] = clip.y;
    pm.elements[10] = clip.z + 1 - 0.003;
    pm.elements[14] = clip.w;

    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevColor = renderer.getClearColor(new THREE.Color());
    this._withHidden([this.backdrop, floor, this._shadowPlane], () => {
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this._mirrorTarget);
      renderer.clear();
      renderer.render(this.scene, vc);
    });
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
  }

  _disposeReflection() {
    if (this._reflectionFloor) {
      this.scene.remove(this._reflectionFloor);
      this._reflectionFloor.geometry.dispose();
      this._reflectionFloor.material.dispose();
      this._reflectionFloor = null;
    }
    if (this._mirrorTarget) { this._mirrorTarget.dispose(); this._mirrorTarget = null; }
    if (this._shadowPlane) {
      this.scene.remove(this._shadowPlane);
      this._shadowPlane.geometry.dispose();
      this._shadowPlane.material.dispose();
      this._shadowPlane = null;
    }
    for (const key of ['_shadowRtA', '_shadowRtB']) { if (this[key]) { this[key].dispose(); this[key] = null; } }
    for (const key of ['_shadowDepthMaterial', '_shadowBlurMaterial']) { if (this[key]) { this[key].dispose(); this[key] = null; } }
    if (this._shadowQuad) { this._shadowQuad.geometry.dispose(); this._shadowQuad = null; }
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

  // Reflection-ON environment values per card (see REFLECTION.envOn).
  _reflectionOnEnv(id, base) {
    const on = REFLECTION.envOn;
    const edgeTarget = id === 'dark' ? (Number(on.edgeDark) || on.edge) : (Number(on.edgeLight) || on.edge);
    const edgeMin = id === 'dark' ? 2.2 : REFLECTION.edgeOnMin;
    const edgeMax = id === 'dark' ? 3.4 : REFLECTION.edgeOnMax;
    return {
      // Rev 11 s38: black face is a light-absorbing dielectric; reflection ON must not boost its env (white face keeps on.front).
      front: id === 'dark' ? (Number(on.frontDark) || base.front) : on.front,
      edge: clamp(edgeTarget, edgeMin, edgeMax),
      back: id === 'dark' ? on.back : (Number(on.backLight) || on.back),
    };
  }

  _captureReflectionEnvBase() {
    // Base (OFF) env values are read from each card's live materials so the page
    // does not hard-code the modeler's mirror-edge numbers.
    this._reflectionEnvBase = {
      light: this._reflectionEnvForCard(this.cards.light),
      dark: this._reflectionEnvForCard(this.cards.dark),
    };
  }

  _applyReflectionState() {
    const weight = clamp(this.reflectionWeight, 0, 1);
    // The room env intensity scales BOTH states, so the reflection ON/OFF targets
    // stay proportional when the env level changes.
    const envIntensity = Number(this.envIntensity) || 1;
    const cardsReady = Boolean(this.cards && this.cards.light && this.cards.dark);
    const active = weight > 0.001 && cardsReady;
    if (this._reflectionFloor) {
      this._reflectionFloor.visible = active && !this.setMode;
      this._mirrorUniforms.uWeight.value = weight;
    }
    if (this._reflectionEnvBase) {
      for (const id of ['light', 'dark']) {
        const card = this.cards[id];
        const base = this._reflectionEnvBase[id];
        if (!card || !card.materials || !base) continue;
        const on = this._reflectionOnEnv(id, base);
        card.materials.front.envMapIntensity = lerp(base.front, on.front, weight) * envIntensity;
        card.materials.edge.envMapIntensity = lerp(base.edge, on.edge, weight) * envIntensity;
        card.materials.back.envMapIntensity = lerp(base.back, on.back, weight) * envIntensity;
      }
    }
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
      group.traverse((object) => {
        if (!object.isMesh) return;
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
    // Revision 21: the card materials only exist now (the model creates them), so
    // re-apply the room env to the new meshes before the reflection clones copy
    // their envMapIntensity values (r151 has no scene-level env intensity).
    this._refreshEnvRoom();
    this._captureReflectionEnvBase();
    this._applyReflectionState();
    this.requestRender();
  }

  /**
   * Rev19 card-set option: nine equal cards in an upright edge row (edges toward the
   * fixed 45-degree camera, faces toward their neighbours), the fifth card raised above the others. Replaces the
   * duo in the composition (the duo holders are detached, not rebuilt).
   */
  setCardSet(on, bank) {
    const next = Boolean(on);
    if (next === Boolean(this.setMode)) return this.setMode;
    if (next) {
      if (!this.setGroup) {
        if (!bank || typeof bank.createCard !== 'function') throw new Error('card set needs the card bank');
        this.setGroup = new THREE.Group();
        this.setGroup.name = 'card-set';
        this.setCards = [];
        const spec = CARD_SET;
        for (let i = 0; i < spec.count; i += 1) {
          const cardSpec = bank.specs.find((s) => s.id === (i % 2 === 0 ? 'dark' : 'light')) || bank.specs[0];
          const card = bank.createCard(cardSpec, { quality: 'gallery' });
          const group = card.group;
          group.name = 'card-set-' + (i + 1);
          group.rotation.order = 'YXZ';
          // Vertical edge-row orientation (from the retired standalone cardsets
          // page): a pure Y yaw of 90deg + camera azimuth turns each card's face
          // normal onto the camera-right row axis (edge to camera, upright);
          // alternate cards flip 180deg so neighbouring faces face each other.
          // Rev5: every card faces the white (light) card's direction (yaw EDGE+180),
          // then rolls 90deg counter-clockwise (seen from the front, Rev9 s36) about its own z.
          group.rotation.y = degToRad(CARD_SET_EDGE_YAW_DEG + 180);
          group.rotation.z = Math.PI / 2;
          const along = (i - (spec.count - 1) / 2) * spec.pitch;
          group.position.set(CARD_SET_ROW_AXIS.x * along, i === spec.raisedIndex ? spec.raise : 0, CARD_SET_ROW_AXIS.z * along);
          group.traverse((object) => {
            if (!object.isMesh) return;
          });
          this.setGroup.add(group);
          this.setCards.push(card);
        }
      }
      this.composition.remove(this.holders.light, this.holders.dark);
      this.composition.add(this.setGroup);
    } else {
      this.composition.remove(this.setGroup);
      this.composition.add(this.holders.light, this.holders.dark);
    }
    this.setMode = next;
    // Revision 21: the nine gallery cards are created lazily here, so give their
    // materials the room env intensity too (r151 applies it per material).
    this._refreshEnvRoom();
    this._computeCompositionBounds();
    if (next) this._reflectionFrame = null;
    this._applyReflectionState();
    this._fitCamera();
    this._applyPose();
    this.requestRender();
    return this.setMode;
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
  }

  _applyPose() {
    const pose = this._displayPose();
    const yaw = degToRad(pose.yawDeg);
    const pitch = degToRad(pose.pitchDeg);
    if (Math.abs(yaw - this._lastYaw) > 1e-4 || Math.abs(pitch - this._lastPitch) > 1e-4) {
      this._lastYaw = yaw;
      this._lastPitch = pitch;
    }
    this.composition.rotation.y = yaw;
    this.composition.rotation.x = pitch;
    this.floatGroup.position.y = this._floatY;
    this.floatGroup.rotation.z = this._floatTilt;
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
    this._resizeMirrorTarget();
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
    this._renderMirror();
    this._renderContactShadow();
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

  /**
   * Revision 21: the old light toggle is now a room env-intensity toggle.
   * ON keeps the tuned room intensity; OFF dims the whole environment
   * through the shared env-room handle (r151 scales each material's
   * envMapIntensity), then the reflection targets are re-applied proportionally
   * so the render changes visibly and stays internally consistent.
   */
  setKeyLightEnabled(enabled) {
    this.keyLightEnabled = Boolean(enabled);
    this.envIntensity = this.keyLightEnabled ? ENV_INTENSITY.on : ENV_INTENSITY.off;
    if (this.envRoom) this.envRoom.setIntensity(this.envIntensity, this.scene);
    this._applyReflectionState();
    this.requestRender();
    this.renderNow();
    return this.keyLightEnabled;
  }

  _refreshEnvRoom() {
    if (this.envRoom) this.envRoom.refresh(this.scene);
  }

  getEnvironmentDebug() {
    const sceneEnvironment = Boolean(this.scene && this.scene.environment);
    return {
      enabled: Boolean(this.keyLightEnabled),
      keyType: 'none',
      keyIntensity: 0,
      ambientIntensity: 0,
      environment: ENV_ROOM_REPORT,
      mode: this.keyLightEnabled ? 'on' : 'off',
      intensity: round(this.envIntensity, 3),
      sceneEnvironment,
    };
  }

  getKeyLightEnabled() {
    return Boolean(this.keyLightEnabled);
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
    // Revision 21: no key light object exists; the shape is kept for QA
    // compatibility and reports the environment-only lighting state instead.
    return {
      type: 'none',
      enabled: Boolean(this.keyLightEnabled),
      position: [0, 0, 0],
      target: [0, 0, 0],
      intensity: 0,
      decay: 0,
      distance: 0,
      castShadow: false,
      shadowMapSize: [0, 0],
      shadowBias: 0,
      shadowNormalBias: 0,
      shadowMapAllocated: false,
      shadowType: 'disabled',
      distanceToCamera: 0,
      positionMode: 'environment-only',
      offsetDeg: { right: SHADOW_OFFSET.rightDeg, up: SHADOW_OFFSET.upDeg },
      distanceScale: 0,
      environment: ENV_ROOM_REPORT,
      envIntensity: round(this.envIntensity, 3),
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
    return {
      directional,
      point,
      shadowCasters,
      ambient,
      hemisphere,
      total: directional + point + ambient + hemisphere,
      // Revision 21: zero lights — the room photo PMREM is the only light source.
      environment: ENV_ROOM_REPORT,
    };
  }

  _screenRowForWorldPoint(point) {
    // Project a world point to a CSS-pixel row inside the stage (0 = top).
    const projected = point.clone().project(this.camera);
    return (0.5 - projected.y * 0.5) * this._size.h;
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
      floorVisible: Boolean(this._reflectionFloor && this._reflectionFloor.visible && this.reflectionWeight > 0.001),
      reflectionPass: Boolean(this.reflectionEnabled && this.reflectionWeight > 0.5 && this._reflectionFloor && this._reflectionFloor.visible),
      env: {
        front: round(materials && materials.front ? materials.front.envMapIntensity : 0, 3),
        edge: round(materials && materials.edge ? materials.edge.envMapIntensity : 0, 3),
        back: round(materials && materials.back ? materials.back.envMapIntensity : 0, 3),
      },
      envByCard: { light: envFor('light'), dark: envFor('dark') },
      mode: this.reflectionEnabled ? 'on' : 'off',
      weight: round(this.reflectionWeight, 3),
      implementation: 'planar-reflector',
      shadow: 'projected-contact-shadow',
      layers: {
        mirror: Boolean(this._reflectionFloor && this._reflectionFloor.visible),
        glass: Boolean(this._reflectionFloor && this._reflectionFloor.visible),
        contactShadow: Boolean(this._shadowPlane && this._shadowPlane.visible),
      },
      painted: false,
    };
  }

  getReflectionScreenDebug() {
    // Projected screen bbox of the mirror image (the real card bounds mirrored
    // about the table plane).
    const out = { mirrorScreen: null, samples: [] };
    if (!this.camera || !this._size.h || !this.cards.light) return out;
    this.floatGroup.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const id of ['light', 'dark']) {
      if (this.cards[id] && this.cards[id].group) box.expandByObject(this.cards[id].group);
    }
    if (box.isEmpty()) return out;
    const ys = [2 * REFLECTION.floorY - box.max.y, 2 * REFLECTION.floorY - box.min.y];
    const rows = [];
    const cols = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of ys) {
        for (const z of [box.min.z, box.max.z]) {
          const corner = new THREE.Vector3(x, y, z);
          rows.push(this._screenRowForWorldPoint(corner));
          cols.push((corner.clone().project(this.camera).x * 0.5 + 0.5) * this._size.w);
        }
      }
    }
    out.mirrorScreen = {
      x0: round(Math.min(...cols), 1),
      y0: round(Math.min(...rows), 1),
      x1: round(Math.max(...cols), 1),
      y1: round(Math.max(...rows), 1),
      stageH: round(this._size.h, 1),
    };
    return out;
  }

  getRenderDebug() {
    return {
      triangles: this._stats.triangles,
      drawCalls: this._stats.drawCalls,
      pixelRatio: round(this.renderer.getPixelRatio(), 3),
      shadowMapEnabled: Boolean(this.renderer.shadowMap.enabled),
      shadowMapType: 'disabled',
      toneMappingExposure: round(this.renderer.toneMappingExposure, 3),
      environment: ENV_ROOM_REPORT,
      envIntensity: round(this.envIntensity, 3),
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
    this._disposeReflection();
    if (this.envRoom) {
      this.envRoom.dispose();
      this.envRoom = null;
    }
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
  for (const button of [dom.btnReset, dom.btnSwap, dom.btnAuto, dom.btnReflection, dom.btnLight]) {
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
  syncLightUi();
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
  if (typeof state.studio.getKeyLightEnabled === 'function') {
    state.lightOn = state.studio.getKeyLightEnabled();
  }
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

function doSetCardSet(on) {
  if (!state.studio || !state.bank) return false;
  const next = state.studio.setCardSet(Boolean(on), state.bank);
  state.cardSet = next;
  if (dom.btnSet) dom.btnSet.setAttribute('aria-pressed', String(next));
  if (dom.stageName) dom.stageName.textContent = next ? 'Card set · 9' : state.swapFront === 'dark' ? 'Light + Dark' : 'Dark + Light';
  if (dom.btnSwap) dom.btnSwap.disabled = next;
  if (dom.btnReflection) dom.btnReflection.disabled = next;
  announce(next ? 'Card set: nine equal cards' : 'Card duo');
  publishState();
  return next;
}

function doSetLight(enabled) {
  if (!state.studio) return false;
  const next = state.studio.setKeyLightEnabled(Boolean(enabled));
  state.lightOn = next;
  syncLightUi();
  syncAllUi();
  announce(next ? 'Room environment at full intensity' : 'Room environment dimmed');
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
  if (dom.btnSet) {
    dom.btnSet.addEventListener('click', () => {
      if (!state.ready) return;
      doSetCardSet(!state.cardSet);
    });
  }
  if (dom.btnLight) {
    dom.btnLight.addEventListener('click', () => {
      if (!state.ready) return;
      doSetLight(!state.lightOn);
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
    } else if (key === 'g') {
      event.preventDefault();
      if (state.ready) doSetCardSet(!state.cardSet);
    } else if (key === 'l') {
      event.preventDefault();
      if (state.ready) doSetLight(!state.lightOn);
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
  /** Revision 21: room env-intensity toggle (was the key-light on/off API). */
  setLight(enabled) {
    if (!state.studio) return false;
    const next = doSetLight(Boolean(enabled));
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
      if (state.studio._shadowPlane) state.studio._shadowPlane.visible = state.studio.decalsEnabled && !state.studio.setMode;
      state.studio.requestRender();
      state.studio.renderNow();
      return state.studio.decalsEnabled;
    },
    // s39 QA-only: screen-space quad (canvas CSS px) of a card's front face, the
    // live studio handle for per-term ablation, and a canvas-readback luma probe.
    faceQuad(id) {
      const st = state.studio; const card = st && st.cards && st.cards[id];
      if (!card) return null;
      card.group.updateWorldMatrix(true, true);
      st.camera.updateMatrixWorld(true);
      const geo = card.front.geometry; geo.computeBoundingBox();
      const b = geo.boundingBox; const z = b.max.z;
      const rect = st.canvas.getBoundingClientRect();
      const out = [];
      for (const [x, y] of [[b.min.x, b.max.y], [b.max.x, b.max.y], [b.max.x, b.min.y], [b.min.x, b.min.y]]) {
        const v = card.front.localToWorld(card.front.position.clone().set(x, y, z));
        v.project(st.camera);
        out.push([(v.x * 0.5 + 0.5) * rect.width, (-v.y * 0.5 + 0.5) * rect.height]);
      }
      return out;
    },
    studio() { return state.studio; },
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
  dom.body.dataset.qaLight = state.lightOn ? '1' : '0';
  dom.body.dataset.light = state.lightOn ? 'on' : 'off';
  syncAutoUi();
  syncReflectionUi();
  syncLightUi();
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
      light: state.lightOn,
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
    state.lightOn = state.studio.setKeyLightEnabled(state.lightOn);

    // URL-driven deterministic state (?pose / ?swap / ?reflection), applied before ready.
    const pose = parsePoseParam();
    if (pose) state.studio.setPose(pose.yawDeg, pose.pitchDeg);
    if (urlParams.get('swap') === '1') state.studio.swap({ immediate: true });
    if (urlParams.get('set') === '1') doSetCardSet(true);
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
