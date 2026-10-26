/**
 * tekoanimation - material columns preview controller.
 *
 * Owns the page shell wiring, the three.js studio, the QA hooks (SPEC-columns
 * §6.3) and the deterministic URL state (§6.4). The 27 box meshes, their exact
 * dimensions and the PBR materials come from ./columns-model.js through the
 * frozen §5 API; this module never builds column geometry or textures.
 *
 * Studio contract:
 *   - PMREM RoomEnvironment image-based lighting for all three materials;
 *   - key / fill / rim directional lights; only the key casts shadows (2048
 *     PCFSoft map over the 27-column envelope);
 *   - an unlit, deterministic floor pool with alpha falloff, plus a
 *     ShadowMaterial receiver, so the columns read as standing in a dark studio;
 *   - camera framing is solved numerically from the real 27 box corners for the
 *     live stage aspect, so all 27 columns fit at 1440x900 and 390x844.
 *
 * A missing or invalid model module / asset bank degrades to a descriptive
 * error state plus the static 27-column summary that ships in columns.html.
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const VERSION = '1.3.0';

const MODEL_URL = new URL('./columns-model.js', import.meta.url);
const ASSET_BASE = './assets/textures/materials';

/* -------------------------------------------------------------- registries */

const MATERIALS = Object.freeze([
  Object.freeze({ id: 'plaster', label: 'Plaster', sourceImage: 'plaster.png' }),
  Object.freeze({ id: 'limestone', label: 'Limestone', sourceImage: 'limestone.png' }),
  Object.freeze({ id: 'satin', label: 'Satin', sourceImage: 'satin.png' })
]);
const MATERIAL_ORDER = Object.freeze(['plaster', 'limestone', 'satin']);
const FOOTPRINT_ORDER = Object.freeze(['large', 'medium', 'small']);
const HEIGHT_ORDER = Object.freeze(['long', 'medium', 'short']);
const FOOTPRINTS = Object.freeze({
  large: Object.freeze({ id: 'large', label: 'Large', px: 140, xOffset: -180 }),
  medium: Object.freeze({ id: 'medium', label: 'Medium', px: 80, xOffset: 0 }),
  small: Object.freeze({ id: 'small', label: 'Small', px: 40, xOffset: 180 })
});
const HEIGHTS = Object.freeze({
  long: Object.freeze({ id: 'long', label: 'Long', px: 600, zOffset: -180 }),
  medium: Object.freeze({ id: 'medium', label: 'Medium', px: 550, zOffset: 0 }),
  short: Object.freeze({ id: 'short', label: 'Short', px: 500, zOffset: 180 })
});
const GROUP_SPACING = 700;

/* Local mirror of the frozen spec table. The page needs 27 readable columns in
   the readout, the size-matrix legend and the fallback state even before (or
   without) src/columns-model.js; the model module is authoritative once loaded. */
function buildLocalSpecs() {
  const specs = [];
  MATERIALS.forEach((material, groupIndex) => {
    const groupCentreX = (groupIndex - 1) * GROUP_SPACING;
    for (const footprintKey of FOOTPRINT_ORDER) {
      const footprint = FOOTPRINTS[footprintKey];
      for (const heightKey of HEIGHT_ORDER) {
        const height = HEIGHTS[heightKey];
        specs.push({
          id: material.id + '-' + footprintKey + '-' + heightKey,
          groupIndex,
          material: material.id,
          footprint: footprintKey,
          height: heightKey,
          width: footprint.px,
          depth: footprint.px,
          heightPx: height.px,
          position: { x: groupCentreX + footprint.xOffset, y: height.px / 2, z: height.zOffset },
          label: material.label + ' ' + footprint.label + ' ' + height.label
        });
      }
    }
  });
  return specs;
}

function computeSpecBounds(specs) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const spec of specs) {
    const halfW = spec.width / 2;
    const halfD = spec.depth / 2;
    min.x = Math.min(min.x, spec.position.x - halfW);
    max.x = Math.max(max.x, spec.position.x + halfW);
    min.y = Math.min(min.y, spec.position.y - spec.heightPx / 2);
    max.y = Math.max(max.y, spec.position.y + spec.heightPx / 2);
    min.z = Math.min(min.z, spec.position.z - halfD);
    max.z = Math.max(max.z, spec.position.z + halfD);
  }
  return { min: min, max: max, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } };
}

const LOCAL_SPECS = buildLocalSpecs();
const LOCAL_SPEC_BY_ID = new Map(LOCAL_SPECS.map((spec) => [spec.id, spec]));
const LOCAL_BOUNDS = computeSpecBounds(LOCAL_SPECS);

/* ------------------------------------------------------------------ views */

/* Camera azimuth is measured from +Z towards +X; elevation is degrees above the
   ground plane. The framing target is derived from the live envelope centre. */
// Rev 4 framing for the wide, short envelope (1850 x 600 x 500): the hero view
// lifts to 24 deg so the squat tiers read in depth, and the preset views keep a
// little elevation. Values solved against the live 27 boxes (binary-search fit).
const VIEWS = Object.freeze({
  hero: Object.freeze({ id: 'hero', label: 'Hero', azimuth: 33, elevation: 24, targetYFactor: 0.367, targetXOffset: 145 }),
  front: Object.freeze({ id: 'front', label: 'Front', azimuth: 0, elevation: 12, targetYFactor: 0.43, targetXOffset: 0 }),
  side: Object.freeze({ id: 'side', label: 'Side', azimuth: 90, elevation: 12, targetYFactor: 0.47, targetXOffset: 0 }),
  top: Object.freeze({ id: 'top', label: 'Top', azimuth: 0, elevation: 68, targetYFactor: 0.5, targetXOffset: 0 })
});
const VIEW_ORDER = Object.freeze(['hero', 'front', 'side', 'top']);
// Portrait / narrow stages cannot fill their height with the 1850-wide scene at
// the desktop 3/4 angle. Swinging the hero azimuth toward the depth axis (and
// using a slightly tighter fit margin) makes the 27 columns fill the tall stage
// on phones while all of them stay in frame. Desktop keeps VIEWS.hero.
const NARROW_VIEW = Object.freeze({ id: 'hero', label: 'Hero', azimuth: 58, elevation: 30, targetYFactor: 0.35, targetXOffset: 145, margin: 0.92 });
const FOCUS_VIEW = Object.freeze({ azimuth: 31, elevation: 12.5, margin: 0.82 });

const FIT = Object.freeze({ margin: 0.9, minDistance: 40, maxDistance: 240000 });

/* Rendering constants (tuned against the three material sheets in the studio). */
const RENDERER = Object.freeze({ exposure: 0.95, dprMax: 2 });
// RoomEnvironment is authored for a ~10-unit model: its point light is intensity
// 5 and its emissive panels are 17-100. At our 1850-unit scene scale the raw
// PMREM is a huge, flat ambient wash, so the room is damped before baking (same
// technique as the coin/card studios) to keep the key light directional and the
// satin reflecting.
const ENVIRONMENT = Object.freeze({ lightScale: 0.3, panelScale: 0.26, softboxScale: 1.2, sigma: 0.05 });
const LIGHTS = Object.freeze({
  key: { color: 0xfff0df, intensity: 1.45, position: [-1900, 2900, 2300], target: [-120, 300, -80] },
  fill: { color: 0xa9c3e2, intensity: 0.85, position: [2500, 1600, 1700] },
  // Rev 5: the satin group needs a low, rear-right rim so its low-roughness /
  // metalness maps produce the crisp edge highlight of the user reference.
  rim: { color: 0xe4edf8, intensity: 3.5, position: [1800, 500, -1600] },
  ambient: { color: 0x3a4552, intensity: 0.28 }
});
const SHADOW = Object.freeze({
  mapSize: 1024,
  camera: { left: -1500, right: 1500, top: 1500, bottom: -1500, near: 200, far: 9000 },
  bias: -0.0005,
  normalBias: 2.4
});
const FLOOR = Object.freeze({ radius: 9000, shadowRadius: 2600, shadowOpacity: 0.32, shadowY: 0.12 });
// Ghost columns are context silhouettes, not materials: an unlit near-black
// surface keeps every non-selected group darker than the floor's shadows so the
// selected group always owns the frame (SPEC §6.2 "fade to a ghost state").
const GHOST = Object.freeze({ color: 0x0b0f15 });
const OUTLINE = Object.freeze({ color: 0xcfe4ff, opacity: 0.85 });

/* Rev 6 - satin blurred mirror reflection.
   One deterministic CubeCamera capture from the satin group centre renders the
   real studio scene (layer 0) plus reflection-only warm/cool accents (layer 1)
   that the main camera never draws. The capture is PMREM-filtered and assigned
   as the satin material's envMap only, so the blur comes from roughness/mip
   filtering (soft blobs, no sharp mirrored lines) and the page composition is
   unchanged. */
const REFLECTION = Object.freeze({
  layer: 1,
  cubeSize: 512,
  near: 20,
  far: 120000,
  center: Object.freeze({ x: 700, y: 300, z: 0 }),
  minEnvIntensity: 2.0,
  maxEnvIntensity: 2.8,
  defaultEnvIntensity: 2.4,
  accents: Object.freeze([
    // Upper-rear warm halo: soft amber lift on the caps/upper faces.
    Object.freeze({ position: [1700, 650, -500], size: [700, 450], color: 0xff8a3d, intensity: 4.5 }),
    // Long amber band behind the group: the reference's warm streak.
    Object.freeze({ position: [1200, 380, -900], size: [1100, 180], color: 0xff9a4a, intensity: 5.0 }),
    // Low amber band: dim warm gradient on the lower rear faces.
    Object.freeze({ position: [600, 180, -1000], size: [900, 140], color: 0xff7a2a, intensity: 3.5 }),
    // Cool steel-blue panel: keeps the reflection from reading as all-orange.
    Object.freeze({ position: [-1500, 700, -600], size: [520, 320], color: 0x9fb8d8, intensity: 2.0 }),
    // Small warm vertical accent for blob variety.
    Object.freeze({ position: [-700, 600, -1050], size: [160, 400], color: 0xffb066, intensity: 3.0 }),
    // Floor-level warm patch IN FRONT of the satin group: vertical faces mirror
    // the floor near the viewer, so this is what puts a blurred orange smudge on
    // a side face instead of only on the caps. Kept small and dim so it reads as
    // one localized reflection, not a whole-face tint.
    Object.freeze({ position: [600, 2, 1000], size: [260, 180], rotation: [-Math.PI / 2, 0, 0], color: 0xff6a10, intensity: 4.0 })
  ])
});
const CAMERA = Object.freeze({ fov: 34, near: 20, far: 120000 });

/* Rev 7 - plaster liquid-metal mirror.
   A second deterministic CubeCamera capture from the plaster group centre
   renders the studio (layer 0) plus crisp COOL reflection-only panels (layer 2,
   never drawn by the main camera). PMREM-filtered and assigned only to the
   plaster material; its effective roughness (~0.09) is much lower than satin's
   (~0.24), so the plaster reads as a bright silver/chrome mirror where the
   reflected neighbour columns, softbox-like bands and panel edges stay
   recognisable instead of becoming soft blobs. Iteration 2 (Lead capture
   review: first pass read as dark charcoal with cloudy blobs): envMapIntensity
   raised to the top of the 2.0-3.0 band, brighter/larger accent panels plus a
   large soft backdrop so the mirror reflects a lit environment rather than
   near-black. */
const PLASTER_MIRROR = Object.freeze({
  layer: 2,
  cubeSize: 512,
  near: 20,
  far: 120000,
  center: Object.freeze({ x: -700, y: 300, z: 0 }),
  minEnvIntensity: 2.0,
  maxEnvIntensity: 3.0,
  defaultEnvIntensity: 3.0,
  accents: Object.freeze([
    // Large soft cool backdrop behind the group: lifts the whole mirror from
    // near-black to a lit silver/chrome environment (soft gradient, no hard edge).
    Object.freeze({ position: [-700, 420, -1700], size: [3000, 1500], color: 0x9db0c6, intensity: 1.35 }),
    // Large soft front fill: keeps side/back faces from reflecting pure black.
    Object.freeze({ position: [-700, 380, 1650], size: [2600, 1300], color: 0xc6d4e6, intensity: 1.2 }),
    // Bright overhead strip: sharp reflected highlight band across caps / upper faces.
    Object.freeze({ position: [-700, 1450, -150], size: [1800, 380], rotation: [-Math.PI / 2, 0, 0], color: 0xf6f9ff, intensity: 3.6 }),
    // Tall cool banner in front of the group: crisp vertical mirror band on +Z faces.
    Object.freeze({ position: [-700, 300, 980], size: [900, 950], color: 0xdfe9f7, intensity: 2.6 }),
    // Bright side panels: read as the reflected neighbouring group axis + studio softboxes.
    Object.freeze({ position: [260, 480, 240], size: [420, 1150], color: 0xeaf3ff, intensity: 2.8 }),
    Object.freeze({ position: [-1660, 480, 240], size: [420, 1150], color: 0xd8e6f7, intensity: 2.0 }),
    // Faint warm key-side panel: the liquid metal keeps a little studio warmth.
    Object.freeze({ position: [-1480, 520, 700], size: [520, 640], color: 0xffd9b0, intensity: 1.1 }),
    // Low cool patch in front: the near floor/vertical faces mirror a bright band.
    Object.freeze({ position: [-700, 2, 1200], size: [620, 420], rotation: [-Math.PI / 2, 0, 0], color: 0xeaf2ff, intensity: 1.6 }),
  ])
});

const TAU = Math.PI * 2;

/* three r151 ships with ColorManagement.enabled = false, so Color(hex) values
   are treated as linear and get washed out by the sRGB output encode. Every
   colour-critical page value goes through this helper so a hex literal means the
   colour that actually ends up on screen. */
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
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
const degToRad = (deg) => (deg * Math.PI) / 180;
const round = (value, digits) => {
  const d = digits === undefined ? 2 : digits;
  const factor = Math.pow(10, d);
  return Math.round(value * factor) / factor;
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* -------------------------------------------------------------------- dom */

const dom = {
  body: document.body,
  page: document.getElementById('page'),
  stage: document.getElementById('stage'),
  canvas: document.getElementById('stage-canvas'),
  stageEyebrow: document.getElementById('stage-eyebrow-text'),
  stageIndex: document.getElementById('stage-index'),
  stageCode: document.getElementById('stage-code'),
  stageName: document.getElementById('stage-name'),
  stageDetail: document.getElementById('stage-detail'),
  stageHint: document.getElementById('stage-hint'),
  stageVeil: document.getElementById('stage-veil'),
  veilText: document.getElementById('veil-text'),
  groupLabels: {
    plaster: document.querySelector('[data-group-label="plaster"]'),
    limestone: document.querySelector('[data-group-label="limestone"]'),
    satin: document.querySelector('[data-group-label="satin"]')
  },
  btnReset: document.getElementById('btn-reset'),
  btnSpin: document.getElementById('btn-spin'),
  materialTabs: Array.prototype.slice.call(document.querySelectorAll('.material-tab')),
  materialChips: Array.prototype.slice.call(document.querySelectorAll('[data-material-chip]')),
  matrixCells: Array.prototype.slice.call(document.querySelectorAll('.matrix-cell')),
  matrixNote: document.getElementById('matrix-note'),
  readoutState: document.getElementById('readout-state'),
  readoutName: document.getElementById('readout-name'),
  readoutDims: document.getElementById('readout-dims'),
  readoutId: document.getElementById('readout-id'),
  infoIndex: document.getElementById('info-index'),
  infoFootState: document.getElementById('info-foot-state'),
  specExtent: document.getElementById('spec-extent'),
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
  diag: document.getElementById('qa-diag')
};

/* -------------------------------------------------------------- qa state */

const qa = (window.__TEKO_COLUMNS_QA = window.__TEKO_COLUMNS_QA || { errors: [], warnings: [], webgl: null });
if (!Array.isArray(qa.errors)) qa.errors = [];
if (!Array.isArray(qa.warnings)) qa.warnings = [];

function pushError(message) {
  qa.errors.push('columns-preview: ' + message);
  if (qa.errors.length > 60) qa.errors.splice(0, qa.errors.length - 60);
}

function pushWarning(message) {
  qa.warnings.push('columns-preview: ' + message);
  if (qa.warnings.length > 60) qa.warnings.splice(0, qa.warnings.length - 60);
}

function errorMessage(error) {
  if (!error) return 'Unknown error';
  const message = error.message ? String(error.message) : String(error);
  return message.length > 260 ? message.slice(0, 257) + '...' : message;
}

const urlParams = new URLSearchParams(window.location.search);
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  ready: false,
  failed: false,
  webgl: false,
  webglVersion: '',
  bank: null,
  studio: null,
  specs: LOCAL_SPECS.slice(),
  specsFromModel: false,
  bounds: LOCAL_BOUNDS,
  boundsFromModel: false,
  material: 'all',
  view: 'hero',
  spin: false,
  hoverId: null,
  focusId: null,
  matrixCell: null,
  matrixHover: null,
  shot: urlParams.get('shot') === '1',
  qaMode: urlParams.get('qa') === '1',
  // Rev 7: ?still=1 is an explicit deterministic freeze in addition to the
  // existing shot/qa capture modes. Rev 8: the plaster liquid-flow normal was
  // removed, so "still" now only freezes the camera transition + auto-rotate
  // (the rendered studio state is deterministic either way).
  still: urlParams.get('still') === '1',
  cleanChrome: urlParams.get('chrome') === '0',
  reducedMotion: reducedMotionQuery.matches,
  frozen: false,
  bootStartedAt: 0,
  watchdog: 0,
  url: { material: null, view: null, focus: null, spin: null }
};

function motionAllowed() {
  return !state.frozen && !state.reducedMotion;
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
  // Rev 8: ?still=1 is a deterministic capture mode too.  The curtain must be
  // hidden in the SAME frame as the freeze (like shot/qa/reduced-motion); the
  // old 700 ms fade meant a still capture could sample a nearly-transparent
  // curtain and differ by 1 level from an otherwise identical load.
  if (state.shot || state.qaMode || state.still || state.reducedMotion) {
    dom.curtain.hidden = true;
    return;
  }
  window.setTimeout(() => {
    dom.curtain.hidden = true;
  }, 700);
}

function showErrorBanner(message) {
  if (!dom.errorBanner) return;
  if (dom.errorText) dom.errorText.textContent = message;
  dom.errorBanner.hidden = false;
}

function announce(message) {
  if (dom.liveStatus) dom.liveStatus.textContent = message;
}

function specById(id) {
  if (!id) return null;
  return state.specs.find((spec) => spec.id === id) || null;
}

function materialOf(id) {
  for (const material of MATERIALS) {
    if (material.id === id) return material;
  }
  return null;
}

function materialLabel(id) {
  const material = materialOf(id);
  return material ? material.label : 'Unknown';
}

function formatDims(spec) {
  return spec.width + ' x ' + spec.depth + ' x ' + spec.heightPx + ' px';
}

/* -------------------------------------------------------------- URL state */

function parseUrlState() {
  const material = (urlParams.get('material') || '').toLowerCase();
  const view = (urlParams.get('view') || '').toLowerCase();
  const focus = urlParams.get('focus') || '';
  const spin = urlParams.get('spin');
  state.url.material = material === 'all' || MATERIAL_ORDER.indexOf(material) >= 0 ? material : null;
  state.url.view = VIEW_ORDER.indexOf(view) >= 0 ? view : null;
  state.url.focus = focus || null;
  state.url.spin = spin === '1' ? true : spin === '0' ? false : null;
}

/* --------------------------------------------------------------- ui sync */

function syncMaterialUi() {
  const material = state.material;
  dom.body.dataset.material = material;
  for (const tab of dom.materialTabs) {
    const active = tab.getAttribute('data-material') === material;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for (const chip of dom.materialChips) {
    const active = chip.getAttribute('data-material-chip') === material;
    chip.classList.toggle('is-active', active);
    if (chip.tagName === 'BUTTON') chip.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  const visible = material === 'all' ? state.specs.length : state.specs.filter((spec) => spec.material === material).length;
  if (dom.stageIndex) dom.stageIndex.textContent = String(visible).padStart(2, '0');
  if (dom.infoIndex) dom.infoIndex.textContent = visible + ' / ' + state.specs.length;
  for (const materialEntry of MATERIALS) {
    const label = dom.groupLabels[materialEntry.id];
    if (!label) continue;
    label.classList.toggle('is-dim', material !== 'all' && material !== materialEntry.id);
  }
}

function syncViewUi() {
  dom.body.dataset.view = state.view;
  if (!dom.stageEyebrow) return;
  if (state.view === 'focus' && state.focusId) {
    dom.stageEyebrow.textContent = 'Focused column';
  } else {
    const view = VIEWS[state.view];
    dom.stageEyebrow.textContent = (view ? view.label : 'Hero') + ' view';
  }
}

function syncSpinUi() {
  if (!dom.btnSpin) return;
  const disabled = !motionAllowed();
  dom.btnSpin.disabled = disabled;
  dom.btnSpin.setAttribute('aria-pressed', String(Boolean(state.spin) && !disabled));
  dom.body.dataset.spin = state.spin && !disabled ? '1' : '0';
  if (disabled && state.reducedMotion) {
    dom.btnSpin.title = 'Auto-rotate is disabled by the reduced-motion preference.';
  } else if (disabled) {
    dom.btnSpin.title = 'Auto-rotate is disabled in this deterministic view.';
  } else {
    dom.btnSpin.removeAttribute('title');
  }
}

function matrixCellKey(cell) {
  return cell ? cell.footprint + ':' + cell.height : null;
}

function syncMatrixUi() {
  const activeCell = state.matrixCell || state.matrixHover;
  const activeKey = matrixCellKey(activeCell);
  for (const cell of dom.matrixCells) {
    const key = cell.getAttribute('data-footprint') + ':' + cell.getAttribute('data-height');
    const isActive = key === activeKey;
    cell.classList.toggle('is-active', isActive);
    cell.setAttribute('aria-pressed', key === matrixCellKey(state.matrixCell) ? 'true' : 'false');
  }
  if (dom.matrixNote) {
    if (activeCell) {
      const footprint = FOOTPRINTS[activeCell.footprint];
      const height = HEIGHTS[activeCell.height];
      const count = state.specs.filter(
        (spec) => spec.footprint === activeCell.footprint && spec.height === activeCell.height &&
          (state.material === 'all' || spec.material === state.material)
      ).length;
      dom.matrixNote.textContent = footprint.label + ' ' + footprint.px + ' px footprint, ' + height.label + ' ' +
        height.px + ' px height - highlighting ' + count + (count === 1 ? ' column' : ' columns') + '.';
    } else {
      dom.matrixNote.textContent = 'Hover or select a cell to highlight the matching column(s).';
    }
  }
}

function syncReadout() {
  let kicker = 'Hover a column';
  let name = 'All 27 columns';
  let dims = '140 / 80 / 40 px footprints - 600 / 550 / 500 px heights';
  let id = '3 materials x 9 dimensions';
  const hovered = state.focusId || state.hoverId;
  const hoveredSpec = specById(hovered);
  const cell = state.matrixCell || state.matrixHover;
  if (hoveredSpec) {
    const footprint = FOOTPRINTS[hoveredSpec.footprint];
    const height = HEIGHTS[hoveredSpec.height];
    kicker = state.focusId ? 'Focused' : 'Hovered';
    name = materialLabel(hoveredSpec.material) + ' - ' + footprint.label + ' - ' + height.label;
    dims = hoveredSpec.width + ' x ' + hoveredSpec.depth + ' x ' + hoveredSpec.heightPx + ' px';
    id = hoveredSpec.id;
  } else if (cell) {
    const footprint = FOOTPRINTS[cell.footprint];
    const height = HEIGHTS[cell.height];
    kicker = state.matrixCell ? 'Selected cell' : 'Highlighted cell';
    name = footprint.label + ' footprint - ' + height.label + ' height';
    dims = footprint.px + ' x ' + footprint.px + ' x ' + height.px + ' px';
    const matches = state.specs.filter(
      (spec) => spec.footprint === cell.footprint && spec.height === cell.height &&
        (state.material === 'all' || spec.material === state.material)
    );
    id = matches.length + (matches.length === 1 ? ' column' : ' columns');
  } else if (state.material !== 'all') {
    const material = materialOf(state.material);
    kicker = 'Material group';
    name = material ? material.label : 'Material';
    dims = '9 columns - 3 footprints x 3 heights';
    id = material ? material.sourceImage : '';
  }
  if (dom.readoutState) dom.readoutState.textContent = kicker;
  if (dom.readoutName) dom.readoutName.textContent = name;
  if (dom.readoutDims) dom.readoutDims.textContent = dims;
  if (dom.readoutId) dom.readoutId.textContent = id;
  if (dom.stageCode) {
    if (hoveredSpec) {
      dom.stageCode.textContent = materialLabel(hoveredSpec.material).toUpperCase();
    } else if (state.material !== 'all') {
      dom.stageCode.textContent = materialLabel(state.material).toUpperCase();
    } else {
      dom.stageCode.textContent = String(state.specs.length);
    }
  }
  if (dom.stageName) {
    if (hoveredSpec) {
      dom.stageName.textContent = formatDims(hoveredSpec);
    } else if (cell && !state.matrixCell) {
      dom.stageName.textContent = FOOTPRINTS[cell.footprint].px + ' x ' + FOOTPRINTS[cell.footprint].px + ' x ' + HEIGHTS[cell.height].px + ' px';
    } else if (state.material !== 'all') {
      dom.stageName.textContent = '9 columns - ' + materialLabel(state.material).toLowerCase() + ' group';
    } else {
      dom.stageName.textContent = 'long cuboids - 3 materials x 9 dimensions';
    }
  }
  if (dom.stageDetail) {
    dom.stageDetail.textContent = hoveredSpec ? hoveredSpec.id : '';
  }
  dom.body.dataset.hover = hoveredSpec ? '1' : '0';
}

function syncSpecUi() {
  const bounds = state.bounds;
  if (dom.specExtent) {
    dom.specExtent.textContent = Math.round(bounds.size.x) + ' x ' + Math.round(bounds.size.z) + ' x ' +
      Math.round(bounds.size.y) + ' px';
  }
}

function publishState() {
  const body = dom.body;
  body.dataset.qaReady = state.ready ? '1' : '0';
  body.dataset.qaErrors = String(qa.errors.length);
  body.dataset.count = String(state.specs.length);
  body.dataset.fallback = state.failed ? '1' : '0';
  body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  body.dataset.frozen = state.frozen ? '1' : '0';
  body.dataset.hover = state.hoverId || state.focusId ? '1' : '0';
  body.dataset.focus = state.focusId || '';
  if (state.shot) body.dataset.shot = '1';
  if (state.qaMode) body.dataset.qa = '1';
  if (state.still) body.dataset.still = '1';
  if (state.cleanChrome) body.dataset.chrome = '0';
  if (dom.diag) dom.diag.textContent = JSON.stringify(buildDebug());
}

function syncAllUi() {
  syncMaterialUi();
  syncViewUi();
  syncSpinUi();
  syncMatrixUi();
  syncReadout();
  syncSpecUi();
  publishState();
}

/* ----------------------------------------------------------- model loading */

function validateModelModule(modelModule) {
  if (!modelModule || typeof modelModule !== 'object') {
    return { ok: false, message: 'The columns model module did not load.' };
  }
  if (typeof modelModule.loadColumnBank !== 'function' || typeof modelModule.createColumns !== 'function') {
    return { ok: false, message: 'The columns model module does not expose loadColumnBank()/createColumns().' };
  }
  const specs = modelModule.COLUMN_SPECS;
  if (!Array.isArray(specs) || specs.length !== 27) {
    return {
      ok: false,
      message: 'The columns model exposes ' + (Array.isArray(specs) ? specs.length : 'no') + ' COLUMN_SPECS, expected 27.'
    };
  }
  for (const spec of specs) {
    const check = spec || {};
    if (!check.id || !check.material || !check.footprint || !check.height || !check.position) {
      return { ok: false, message: 'A COLUMN_SPECS entry is missing id/material/footprint/height/position.' };
    }
    const footprint = FOOTPRINTS[check.footprint];
    const height = HEIGHTS[check.height];
    if (!footprint || !height) {
      return { ok: false, message: 'Column "' + check.id + '" has an unknown footprint/height key.' };
    }
    if (check.width !== footprint.px || check.depth !== footprint.px || check.heightPx !== height.px) {
      return {
        ok: false,
        message: 'Column "' + check.id + '" dimensions disagree with SPEC §3 (expected ' +
          footprint.px + ' x ' + footprint.px + ' x ' + height.px + ').'
      };
    }
  }
  return { ok: true, specs: specs };
}

function normalizeBounds(bounds) {
  if (!bounds || !bounds.min || !bounds.max) return null;
  const min = bounds.min;
  const max = bounds.max;
  const read = (value) => (typeof value === 'number' ? value : Number(value));
  const normalized = {
    min: { x: read(min.x), y: read(min.y), z: read(min.z) },
    max: { x: read(max.x), y: read(max.y), z: read(max.z) }
  };
  normalized.size = {
    x: normalized.max.x - normalized.min.x,
    y: normalized.max.y - normalized.min.y,
    z: normalized.max.z - normalized.min.z
  };
  return normalized;
}

function cloneSpecs(specs) {
  return specs.map((spec) => ({
    id: String(spec.id),
    groupIndex: Number(spec.groupIndex),
    material: String(spec.material),
    footprint: String(spec.footprint),
    height: String(spec.height),
    width: Number(spec.width),
    depth: Number(spec.depth),
    heightPx: Number(spec.heightPx),
    position: { x: Number(spec.position.x), y: Number(spec.position.y), z: Number(spec.position.z) },
    label: spec.label ? String(spec.label) : String(spec.id)
  }));
}

/* =========================================================================
   Studio - renderer, environment, lights, floor, columns, camera, labels.
   ========================================================================= */

function makeFloorTexture(renderer) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Horizontal light pool under the 27 columns, alpha fading to zero so the
  // floor dissolves into the page background at the frame edges.
  const pool = ctx.createRadialGradient(size * 0.5, size * 0.52, size * 0.015, size * 0.5, size * 0.52, size * 0.34);
  pool.addColorStop(0, 'rgba(30, 36, 46, 0.9)');
  pool.addColorStop(0.18, 'rgba(24, 29, 37, 0.8)');
  pool.addColorStop(0.4, 'rgba(16, 20, 26, 0.56)');
  pool.addColorStop(0.66, 'rgba(10, 12, 15, 0.24)');
  pool.addColorStop(1, 'rgba(8, 9, 11, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, size, size);

  // Cool sheen from the rim light, warm spill from the key light.
  const rim = ctx.createRadialGradient(size * 0.5, size * 0.46, size * 0.01, size * 0.5, size * 0.46, size * 0.2);
  rim.addColorStop(0, 'rgba(150, 178, 214, 0.09)');
  rim.addColorStop(1, 'rgba(150, 178, 214, 0)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  const warm = ctx.createRadialGradient(size * 0.38, size * 0.6, size * 0.01, size * 0.38, size * 0.6, size * 0.22);
  warm.addColorStop(0, 'rgba(232, 195, 156, 0.07)');
  warm.addColorStop(1, 'rgba(232, 195, 156, 0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, size, size);

  // Deterministic dither (LCG) so the large gradient cannot band.
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  let seed = 0x2f6e2b1;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < data.length; index += 4) {
    const n = (next() - 0.5) * 2.6;
    data[index] = clamp(data[index] + n, 0, 255);
    data[index + 1] = clamp(data[index + 1] + n, 0, 255);
    data[index + 2] = clamp(data[index + 2] + n, 0, 255);
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  texture.userData = { role: 'floor-pool' };
  return texture;
}

/**
 * Contact-shadow bed: one deterministic texture that darkens the floor directly
 * under each column base. Directional shadows are offset by the key angle, so
 * this soft occlusion is what visually grounds the 27 boxes. Pure staging: the
 * plane is transparent black painted at y=0 and never changes model bounds.
 */
function makeContactShadowTexture(specs, bounds) {
  const width = bounds.size.x + 900;
  const depth = bounds.size.z + 900;
  const canvasW = 1024;
  const canvasH = Math.max(256, Math.round((canvasW * depth) / width));
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasW, canvasH);
  const centreX = (bounds.min.x + bounds.max.x) / 2;
  const centreZ = (bounds.min.z + bounds.max.z) / 2;
  const toX = (worldX) => ((worldX - (centreX - width / 2)) / width) * canvasW;
  const toY = (worldZ) => ((worldZ - (centreZ - depth / 2)) / depth) * canvasH;
  for (const spec of specs) {
    const radius = spec.width * 0.9 + 46;
    const scaleX = 1;
    const scaleY = (radius * 2) / (radius * 2);
    const x = toX(spec.position.x);
    const y = toY(spec.position.z);
    const rx = (radius / width) * canvasW;
    ctx.save();
    ctx.translate(x, y);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
    gradient.addColorStop(0.45, 'rgba(0, 0, 0, 0.22)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.userData = { role: 'contact-shadows' };
  return { texture: texture, width: width, depth: depth, centreX: centreX, centreZ: centreZ };
}

function createDampedRoomEnvironment(lightScale, panelScale) {
  const room = new RoomEnvironment();
  room.traverse((object) => {
    if (object.isLight && typeof object.intensity === 'number') {
      object.intensity *= lightScale;
    }
    if (object.isMesh && object.material && object.material.isMeshBasicMaterial &&
      object.material.color && typeof object.material.color.multiplyScalar === 'function') {
      object.material.color.multiplyScalar(panelScale);
    }
  });
  return room;
}

/**
 * The shared studio environment: the damped RoomEnvironment (soft diffuse
 * bounce) plus three HDR softbox panels placed on the key / fill / rim axes.
 * The panels are what give the satin group crisp rectangular edge highlights;
 * their solid angle is small enough that the matte plaster / limestone groups
 * stay diffuse.
 */
const SOFTBOXES = Object.freeze([
  Object.freeze({ position: [-14, 10, 11], lookAt: [0, 4, 0], scale: [7, 5], color: 0xfff0df, intensity: 9 }),
  Object.freeze({ position: [12, 6, 9], lookAt: [0, 3, 0], scale: [5, 6], color: 0xa9c3e2, intensity: 5 }),
  Object.freeze({ position: [2, 8, -14], lookAt: [0, 4, 0], scale: [13, 2], color: 0xe4edf8, intensity: 12 })
]);

function createStudioEnvironment(lightScale, panelScale, softboxScale) {
  const room = createDampedRoomEnvironment(lightScale, panelScale);
  const panelGeometry = new THREE.PlaneGeometry(1, 1);
  for (const panel of SOFTBOXES) {
    const color = srgbColor(panel.color).multiplyScalar(panel.intensity * softboxScale);
    const material = new THREE.MeshBasicMaterial({ color: color, toneMapped: false });
    const mesh = new THREE.Mesh(panelGeometry, material);
    mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);
    mesh.lookAt(panel.lookAt[0], panel.lookAt[1], panel.lookAt[2]);
    mesh.scale.set(panel.scale[0], panel.scale[1], 1);
    room.add(mesh);
  }
  return room;
}

function viewDirection(azimuthDeg, elevationDeg) {
  const azimuth = degToRad(azimuthDeg);
  const elevation = degToRad(elevationDeg);
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();
}

function specCorners(spec) {
  const halfW = spec.width / 2;
  const halfD = spec.depth / 2;
  const x = spec.position.x;
  const z = spec.position.z;
  const y0 = 0;
  const y1 = spec.heightPx;
  return [
    new THREE.Vector3(x - halfW, y0, z - halfD),
    new THREE.Vector3(x + halfW, y0, z - halfD),
    new THREE.Vector3(x - halfW, y0, z + halfD),
    new THREE.Vector3(x + halfW, y0, z + halfD),
    new THREE.Vector3(x - halfW, y1, z - halfD),
    new THREE.Vector3(x + halfW, y1, z - halfD),
    new THREE.Vector3(x - halfW, y1, z + halfD),
    new THREE.Vector3(x + halfW, y1, z + halfD)
  ];
}

class ColumnsStudio {
  constructor(options) {
    this.canvas = options.canvas;
    this.stage = options.stage;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.frozen = Boolean(options.frozen);
    this.captureMode = false;
    this.groupLabelEls = options.groupLabels || {};
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.envRT = null;
    this.floor = null;
    this.shadowPlane = null;
    this.lights = {};
    this.columnsGroup = null;
    this.overlayGroup = null;
    this.columns = [];
    this.columnsById = new Map();
    this.baseMaterials = new Map();
    this.ghostMaterial = null;
    this.contactShadowKey = null;
    this.satinMaterial = null;
    this.reflectionAccents = null;
    this.reflectionCubeRT = null;
    this.reflectionEnvRT = null;
    this.reflectionCaptured = false;
    // Rev 7/8 - plaster liquid-metal mirror.  Rev 8: the mirror surface is flat
    // and clean, so the rev-7 liquid-flow controller/clock is gone; only the
    // dedicated reflection capture + layer-2 accents remain.
    this.plasterMaterial = null;
    this.plasterReflectionAccents = null;
    this.plasterReflectionCubeRT = null;
    this.plasterReflectionEnvRT = null;
    this.plasterReflectionCaptured = false;
    this.outlines = new Map();
    this.specs = [];
    this.bounds = null;
    this.stageBox = { width: 0, height: 0 };
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.focus = null;
    this.cameraGoal = null;
    this.frameCount = 0;
    this.renderCount = 0;
    this.stats = { drawCalls: 0, triangles: 0 };
    this.rendered = false;
    this.destroyed = false;
    this.raf = 0;
    this.lastFrameTime = 0;
    this.resizeObserver = null;
    this.onReady = null;
    this._needsRender = true;
    this.pointerDown = false;
    this.pointerDownAt = { x: 0, y: 0, time: 0 };
  }

  async init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDERER.dprMax));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDERER.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.6, CAMERA.near, CAMERA.far);
    camera.position.set(0, 1500, 4000);
    this.camera = camera;

    const controls = new OrbitControls(camera, this.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.75;
    controls.panSpeed = 0.6;
    controls.screenSpacePanning = false;
    controls.enablePan = true;
    controls.minDistance = 90;
    controls.maxDistance = 24000;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.5;
    controls.target.set(0, 500, 0);
    controls.update();
    this.controls = controls;

    // PMREM room environment: the shared image-based lighting for all three
    // materials (satin reflections, plaster/limestone soft bounce).
    this.buildEnvironment(ENVIRONMENT.lightScale, ENVIRONMENT.panelScale, ENVIRONMENT.softboxScale);

    const key = new THREE.DirectionalLight(LIGHTS.key.color, LIGHTS.key.intensity);
    key.position.set(LIGHTS.key.position[0], LIGHTS.key.position[1], LIGHTS.key.position[2]);
    key.target.position.set(LIGHTS.key.target[0], LIGHTS.key.target[1], LIGHTS.key.target[2]);
    key.castShadow = true;
    key.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
    key.shadow.camera.left = SHADOW.camera.left;
    key.shadow.camera.right = SHADOW.camera.right;
    key.shadow.camera.top = SHADOW.camera.top;
    key.shadow.camera.bottom = SHADOW.camera.bottom;
    key.shadow.camera.near = SHADOW.camera.near;
    key.shadow.camera.far = SHADOW.camera.far;
    key.shadow.bias = SHADOW.bias;
    key.shadow.normalBias = SHADOW.normalBias;
    key.shadow.camera.updateProjectionMatrix();
    scene.add(key);
    scene.add(key.target);
    this.lights.key = key;

    const fill = new THREE.DirectionalLight(LIGHTS.fill.color, LIGHTS.fill.intensity);
    fill.position.set(LIGHTS.fill.position[0], LIGHTS.fill.position[1], LIGHTS.fill.position[2]);
    fill.target.position.set(0, 500, 0);
    scene.add(fill);
    scene.add(fill.target);
    this.lights.fill = fill;

    const rim = new THREE.DirectionalLight(LIGHTS.rim.color, LIGHTS.rim.intensity);
    rim.position.set(LIGHTS.rim.position[0], LIGHTS.rim.position[1], LIGHTS.rim.position[2]);
    rim.target.position.set(0, 600, 0);
    scene.add(rim);
    scene.add(rim.target);
    this.lights.rim = rim;

    const ambient = new THREE.AmbientLight(LIGHTS.ambient.color, LIGHTS.ambient.intensity);
    scene.add(ambient);
    this.lights.ambient = ambient;

    const floorTexture = makeFloorTexture(renderer);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(FLOOR.radius, 160),
      new THREE.MeshBasicMaterial({
        map: floorTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.renderOrder = 0;
    floor.name = 'studio-floor';
    scene.add(floor);
    this.floor = floor;

    const shadowPlane = new THREE.Mesh(
      new THREE.CircleGeometry(FLOOR.shadowRadius, 96),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: FLOOR.shadowOpacity, transparent: true, depthWrite: false })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = FLOOR.shadowY;
    shadowPlane.receiveShadow = true;
    shadowPlane.renderOrder = 1;
    shadowPlane.name = 'studio-shadow-plane';
    scene.add(shadowPlane);
    this.shadowPlane = shadowPlane;

    this.overlayGroup = new THREE.Group();
    this.overlayGroup.name = 'studio-overlays';
    scene.add(this.overlayGroup);

    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: srgbColor(GHOST.color),
      toneMapped: false
    });

    this.buildReflectionAccents();
    // Rev 7: cool crisp panels on layer 2 for the plaster mirror capture.
    this.buildPlasterMirrorAccents();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);
    this.resize();
    this.startLoop();
    return this;
  }

  attachColumns(created, specs, bounds) {
    this.specs = specs.slice();
    this.bounds = bounds;
    this.columns = (created.columns || []).slice();
    this.columnsById = new Map();
    this.baseMaterials = new Map();
    if (created.group) {
      created.group.name = 'columns-group';
      this.columnsGroup = created.group;
      this.scene.add(created.group);
    }
    for (const column of this.columns) {
      const spec = column.spec || specByIdLocal(this.specs, column.mesh && column.mesh.userData ? column.mesh.userData.columnId : '');
      if (!spec) continue;
      this.columnsById.set(spec.id, column);
      this.baseMaterials.set(spec.id, column.material || (column.mesh ? column.mesh.material : null));
      if (column.mesh) {
        column.mesh.castShadow = true;
        column.mesh.receiveShadow = true;
        column.mesh.userData = column.mesh.userData || {};
        column.mesh.userData.columnId = spec.id;
      }
    }
    this.columnsCreated = created;
    this.buildContactShadows(this.specs, this.bounds);
  }

  buildContactShadows(specs, bounds) {
    if (!bounds || !specs.length) return;
    const bed = makeContactShadowTexture(specs, bounds);
    if (this.contactPlane) {
      this.contactPlane.geometry.dispose();
      if (this.contactPlane.material.map) this.contactPlane.material.map.dispose();
      this.contactPlane.material.dispose();
      this.scene.remove(this.contactPlane);
    }
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(bed.width, bed.depth),
      new THREE.MeshBasicMaterial({ map: bed.texture, transparent: true, depthWrite: false, toneMapped: false })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(bed.centreX, 0.26, bed.centreZ);
    plane.renderOrder = 2;
    plane.name = 'studio-contact-shadows';
    this.scene.add(plane);
    this.contactPlane = plane;
  }

  /**
   * Rev 6: build the reflection-only accent panels. They live on layer 1, which
   * the main camera (layer 0) never renders, so the page composition is
   * untouched; the satin reflection CubeCamera enables layer 1 and captures
   * them as the warm/cool blobs seen in the user reference.
   */
  buildReflectionAccents(accentDefs) {
    const defs = Array.isArray(accentDefs) && accentDefs.length ? accentDefs : REFLECTION.accents;
    const group = new THREE.Group();
    group.name = 'satin-reflection-accents';
    const centre = new THREE.Vector3(REFLECTION.center.x, REFLECTION.center.y, REFLECTION.center.z);
    for (const accent of defs) {
      const geometry = new THREE.PlaneGeometry(accent.size[0], accent.size[1]);
      const material = new THREE.MeshBasicMaterial({
        color: srgbColor(accent.color).multiplyScalar(accent.intensity),
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'satin-reflection-accent';
      mesh.position.set(accent.position[0], accent.position[1], accent.position[2]);
      if (accent.rotation) mesh.rotation.set(accent.rotation[0], accent.rotation[1], accent.rotation[2]);
      else mesh.lookAt(centre);
      mesh.layers.set(REFLECTION.layer);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    this.scene.add(group);
    this.reflectionAccents = group;
    return group;
  }

  /**
   * Rev 7: build the cool, crisp reflection-only panels for the plaster mirror.
   * Layer 2 only - the main camera (layer 0) never draws them, so the page
   * composition is unchanged; the plaster CubeCamera enables layer 2 and captures
   * them as sharp silver highlights in the mirror.
   */
  buildPlasterMirrorAccents(accentDefs) {
    const defs = Array.isArray(accentDefs) && accentDefs.length ? accentDefs : PLASTER_MIRROR.accents;
    const group = new THREE.Group();
    group.name = 'plaster-mirror-accents';
    const centre = new THREE.Vector3(PLASTER_MIRROR.center.x, PLASTER_MIRROR.center.y, PLASTER_MIRROR.center.z);
    for (const accent of defs) {
      const geometry = new THREE.PlaneGeometry(accent.size[0], accent.size[1]);
      const material = new THREE.MeshBasicMaterial({
        color: srgbColor(accent.color).multiplyScalar(accent.intensity),
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'plaster-mirror-accent';
      mesh.position.set(accent.position[0], accent.position[1], accent.position[2]);
      if (accent.rotation) mesh.rotation.set(accent.rotation[0], accent.rotation[1], accent.rotation[2]);
      else mesh.lookAt(centre);
      mesh.layers.set(PLASTER_MIRROR.layer);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    this.scene.add(group);
    this.plasterReflectionAccents = group;
    return group;
  }

  /**
   * Rev 7/8: one-off deterministic CubeCamera capture for the plaster liquid-metal
   * mirror, taken from the plaster group centre (layers 0 + 2) with the nine
   * plaster meshes and the outline overlays hidden (no self-reflection). PMREM
   * filtered and assigned ONLY to the plaster material. Rev 8 keeps the mirror
   * surface flat and clean (no normal/roughness maps, constant roughness 0.092),
   * so the material's low effective roughness samples the mip chain near its
   * sharpest level: the reflected neighbour columns / floor / cool panels stay
   * recognisable - a deliberately SHARPER mirror than satin's blurred one
   * (roughness ~0.24).
   */
  capturePlasterReflection(plasterMaterial) {
    if (!plasterMaterial || this.plasterReflectionCaptured || this.destroyed) return false;
    const hiddenMeshes = [];
    for (const column of this.columns) {
      if (!column || !column.spec || !column.mesh) continue;
      if (!column.mesh.visible) continue;
      if (column.spec.material === 'plaster') {
        hiddenMeshes.push(column.mesh);
        column.mesh.visible = false;
      }
    }
    const hiddenOutlines = [];
    for (const line of this.outlines.values()) {
      if (line.visible) {
        line.visible = false;
        hiddenOutlines.push(line);
      }
    }
    const cubeRT = new THREE.WebGLCubeRenderTarget(PLASTER_MIRROR.cubeSize, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter
    });
    cubeRT.texture.name = 'plaster-mirror-cube';
    const cubeCamera = new THREE.CubeCamera(PLASTER_MIRROR.near, PLASTER_MIRROR.far, cubeRT);
    cubeCamera.name = 'plaster-mirror-camera';
    cubeCamera.position.set(PLASTER_MIRROR.center.x, PLASTER_MIRROR.center.y, PLASTER_MIRROR.center.z);
    cubeCamera.layers.enable(PLASTER_MIRROR.layer);
    cubeCamera.update(this.renderer, this.scene);
    for (const mesh of hiddenMeshes) mesh.visible = true;
    for (const line of hiddenOutlines) line.visible = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileCubemapShader();
    const envRT = pmrem.fromCubemap(cubeRT.texture);
    pmrem.dispose();
    const intensity = clamp(
      Number(plasterMaterial.envMapIntensity) || PLASTER_MIRROR.defaultEnvIntensity,
      PLASTER_MIRROR.minEnvIntensity,
      PLASTER_MIRROR.maxEnvIntensity
    );
    plasterMaterial.envMap = envRT.texture;
    plasterMaterial.envMapIntensity = intensity;
    plasterMaterial.needsUpdate = true;
    this.plasterMaterial = plasterMaterial;
    this.plasterReflectionCubeRT = cubeRT;
    this.plasterReflectionEnvRT = envRT;
    this.plasterReflectionCaptured = true;
    this.requestRender();
    return true;
  }

  /**
   * Rev 6: one-off deterministic CubeCamera capture of the studio from the satin
   * group centre (layers 0+1), PMREM-filtered and assigned as the satin
   * material's envMap. Satin meshes are hidden during the capture (no
   * self-reflection) but kept in the graph; all other staging stays visible.
   * Blur is produced by the PMREM mip chain + the material's roughness, so the
   * reflected shapes are soft blobs rather than a sharp mirror.
   */
  captureSatinReflection(satinMaterial) {
    if (!satinMaterial || this.reflectionCaptured || this.destroyed) return false;
    const hiddenMeshes = [];
    for (const column of this.columns) {
      if (!column || !column.spec || !column.mesh) continue;
      if (!column.mesh.visible) continue;
      if (column.spec.material === 'satin') {
        hiddenMeshes.push(column.mesh);
        column.mesh.visible = false;
      }
    }
    const hiddenOutlines = [];
    for (const line of this.outlines.values()) {
      if (line.visible) {
        line.visible = false;
        hiddenOutlines.push(line);
      }
    }
    const cubeRT = new THREE.WebGLCubeRenderTarget(REFLECTION.cubeSize, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter
    });
    cubeRT.texture.name = 'satin-reflection-cube';
    const cubeCamera = new THREE.CubeCamera(REFLECTION.near, REFLECTION.far, cubeRT);
    cubeCamera.name = 'satin-reflection-camera';
    cubeCamera.position.set(REFLECTION.center.x, REFLECTION.center.y, REFLECTION.center.z);
    cubeCamera.layers.enable(REFLECTION.layer);
    cubeCamera.update(this.renderer, this.scene);
    for (const mesh of hiddenMeshes) mesh.visible = true;
    for (const line of hiddenOutlines) line.visible = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileCubemapShader();
    const envRT = pmrem.fromCubemap(cubeRT.texture);
    pmrem.dispose();
    const intensity = clamp(
      Number(satinMaterial.envMapIntensity) || REFLECTION.defaultEnvIntensity,
      REFLECTION.minEnvIntensity,
      REFLECTION.maxEnvIntensity
    );
    satinMaterial.envMap = envRT.texture;
    satinMaterial.envMapIntensity = intensity;
    satinMaterial.needsUpdate = true;
    this.satinMaterial = satinMaterial;
    this.reflectionCubeRT = cubeRT;
    this.reflectionEnvRT = envRT;
    this.reflectionCaptured = true;
    this.requestRender();
    return true;
  }

  applyPresentation(presentation) {
    const materialFilter = presentation.material;
    const cell = presentation.matrixCell;
    // Deterministic capture modes (?shot=1 / ?qa=1) drop the non-selected groups
    // entirely so gallery shots are clean; interactive mode keeps the dark ghost
    // silhouettes as context (SPEC §6.2 "hide or fade to a ghost state").
    const hideGhosts = Boolean(this.captureMode);
    const onlyMaterial = materialFilter !== 'all';
    for (const column of this.columns) {
      const spec = column.spec;
      if (!spec) continue;
      const matchMaterial = !onlyMaterial || spec.material === materialFilter;
      const matchCell = !cell || (spec.footprint === cell.footprint && spec.height === cell.height);
      const ghost = !(matchMaterial && matchCell);
      const target = ghost ? this.ghostMaterial : this.baseMaterials.get(spec.id) || column.material;
      if (target && column.mesh.material !== target) column.mesh.material = target;
      column.mesh.castShadow = !ghost;
      column.mesh.receiveShadow = !ghost;
      column.mesh.visible = !(ghost && hideGhosts);
      column.ghost = ghost;
    }
    this.syncOutlines(presentation);
    // Staging must follow the same capture-mode rule: an isolated gallery shot
    // shows exactly nine columns AND only their contact shadows (the shadow bed
    // is rebuilt from the visible subset, not the whole 27-column layout).
    if (hideGhosts) {
      const shadowSpecs = onlyMaterial ? this.specs.filter((spec) => spec.material === materialFilter) : this.specs;
      const shadowKey = onlyMaterial ? materialFilter : 'all';
      if (this.contactShadowKey !== shadowKey) {
        this.contactShadowKey = shadowKey;
        this.buildContactShadows(shadowSpecs, this.bounds);
      }
    } else if (this.contactShadowKey !== 'all') {
      this.contactShadowKey = 'all';
      this.buildContactShadows(this.specs, this.bounds);
    }
  }

  syncOutlines(presentation) {
    const wanted = new Set();
    const focusId = presentation.focusId;
    const hoverId = presentation.hoverId;
    const cell = presentation.matrixCell;
    const materialFilter = presentation.material;
    if (focusId) wanted.add(focusId);
    if (hoverId) wanted.add(hoverId);
    if (!focusId && !hoverId && cell) {
      for (const column of this.columns) {
        const spec = column.spec;
        if (!spec) continue;
        if (spec.footprint === cell.footprint && spec.height === cell.height &&
          (materialFilter === 'all' || spec.material === materialFilter)) {
          wanted.add(spec.id);
        }
      }
    }
    for (const [id, line] of this.outlines) {
      if (!wanted.has(id)) {
        line.visible = false;
      }
    }
    for (const id of wanted) {
      const line = this.getOutline(this.columnsById.get(id));
      if (line) line.visible = true;
    }
  }

  getOutline(column) {
    if (!column || !column.spec) return null;
    const id = column.spec.id;
    const existing = this.outlines.get(id);
    if (existing) return existing;
    const spec = column.spec;
    const width = spec.width * 1.035;
    const height = spec.heightPx * 1.012;
    const depth = spec.depth * 1.035;
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth));
    const material = new THREE.LineBasicMaterial({
      color: srgbColor(OUTLINE.color),
      transparent: true,
      opacity: OUTLINE.opacity,
      toneMapped: false
    });
    const line = new THREE.LineSegments(geometry, material);
    line.position.set(spec.position.x, spec.heightPx / 2, spec.position.z);
    line.renderOrder = 3;
    line.visible = false;
    line.name = 'column-outline:' + id;
    this.overlayGroup.add(line);
    this.outlines.set(id, line);
    return line;
  }

  clearOutlines() {
    for (const line of this.outlines.values()) line.visible = false;
  }

  /** (Re)build the damped PMREM room environment. Tuning hook for testbeds. */
  buildEnvironment(lightScale, panelScale, softboxScale) {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    const roomEnvironment = createStudioEnvironment(
      lightScale,
      panelScale,
      softboxScale === undefined ? ENVIRONMENT.softboxScale : softboxScale
    );
    if (this.envRT) this.envRT.dispose();
    this.envRT = pmremGenerator.fromScene(roomEnvironment, ENVIRONMENT.sigma);
    this.scene.environment = this.envRT.texture;
    roomEnvironment.dispose();
    pmremGenerator.dispose();
    this.requestRender();
  }

  resize() {
    if (!this.renderer || this.destroyed) return;
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.stageBox.width && height === this.stageBox.height) return;
    this.stageBox = { width: width, height: height };
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.bounds) this.frameCurrentView(true);
    this.requestRender();
  }

  layoutTarget() {
    const bounds = this.bounds || LOCAL_BOUNDS;
    const view = VIEWS[this.viewId] || VIEWS.hero;
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: bounds.min.y + (bounds.max.y - bounds.min.y) * view.targetYFactor,
      z: (bounds.min.z + bounds.max.z) / 2
    };
  }

  fitDistance(direction, target, specs, margin) {
    const width = this.stageBox.width || 1;
    const height = this.stageBox.height || 1;
    const aspect = width / height;
    const probe = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
    const point = new THREE.Vector3();
    const test = (distance) => {
      probe.position.copy(target).addScaledVector(direction, distance);
      probe.lookAt(target);
      probe.updateMatrixWorld(true);
      probe.updateProjectionMatrix();
      for (const spec of specs) {
        const corners = specCorners(spec);
        for (const corner of corners) {
          point.copy(corner).project(probe);
          if (point.z >= 1 || point.z <= -1) return false;
          if (Math.abs(point.x) > margin || Math.abs(point.y) > margin) return false;
        }
      }
      return true;
    };
    let low = FIT.minDistance;
    let high = 2000;
    let guard = 0;
    while (!test(high) && guard < 14) {
      high *= 2;
      guard += 1;
    }
    if (guard >= 14) return high;
    for (let index = 0; index < 54; index += 1) {
      const mid = (low + high) / 2;
      if (test(mid)) high = mid;
      else low = mid;
    }
    return high;
  }

  specsForFraming(materialFilter) {
    if (materialFilter && materialFilter !== 'all') {
      return this.specs.filter((spec) => spec.material === materialFilter);
    }
    return this.specs;
  }

  isNarrowStage() {
    // Only a genuinely phone-width stage takes the portrait-friendly view. The
    // deterministic capture mode paints the stage at the full viewport, so an
    // aspect test would mistake a 1440x900 capture for a narrow stage.
    return (this.stageBox.width || 0) < 700;
  }

  cameraGoalFor(viewId, materialFilter) {
    const narrow = this.isNarrowStage() && viewId === 'hero';
    const isolated = materialFilter && materialFilter !== 'all';
    const view = narrow ? NARROW_VIEW : VIEWS[viewId] || VIEWS.hero;
    // Isolated material views get ~8% breathing room on every side so a gallery
    // panel never crops a column at the frame edge.
    const margin = isolated ? 0.84 : narrow ? NARROW_VIEW.margin : FIT.margin;
    const bounds = this.bounds || LOCAL_BOUNDS;
    let targetSpecs = this.specsForFraming(materialFilter);
    if (!targetSpecs.length) targetSpecs = this.specs;
    const materialBounds = materialFilter && materialFilter !== 'all' ? computeSpecBounds(targetSpecs) : bounds;
    // Per-view framing offset: the 3/4 hero view projects the near (satin) group
    // larger, so the hero target is nudged +X and lowered slightly to centre the
    // whole 27-column composition in the frame (values solved from projected
    // corner margins at 1440x900 and 390x844).
    const target = new THREE.Vector3(
      (materialBounds.min.x + materialBounds.max.x) / 2 + (view.targetXOffset || 0),
      materialBounds.min.y + (materialBounds.max.y - materialBounds.min.y) * view.targetYFactor,
      (materialBounds.min.z + materialBounds.max.z) / 2
    );
    const direction = viewDirection(view.azimuth, view.elevation);
    const distance = this.fitDistance(direction, target, targetSpecs, margin);
    return {
      position: target.clone().addScaledVector(direction, distance),
      target: target
    };
  }

  focusGoal(id) {
    const column = this.columnsById.get(id);
    const spec = column ? column.spec : specByIdLocal(this.specs, id);
    if (!spec) return null;
    const target = new THREE.Vector3(spec.position.x, spec.heightPx / 2, spec.position.z);
    const direction = viewDirection(FOCUS_VIEW.azimuth, FOCUS_VIEW.elevation);
    const distance = this.fitDistance(direction, target, [spec], FOCUS_VIEW.margin);
    return {
      position: target.clone().addScaledVector(direction, distance),
      target: target
    };
  }

  applyCameraGoal(goal, immediate) {
    if (!goal) return;
    const instant = Boolean(immediate) || this.frozen || this.reducedMotion;
    if (instant) {
      this.cameraGoal = null;
      this.camera.position.copy(goal.position);
      this.controls.target.copy(goal.target);
      this.camera.lookAt(goal.target);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.cameraGoal = {
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: goal.position.clone(),
      toTarget: goal.target.clone(),
      t: 0,
      duration: 0.55
    };
    this.requestRender();
  }

  frameCurrentView(immediate) {
    if (!this.bounds || !this.specs.length) return;
    const goal = this.cameraGoalFor(this.viewId || 'hero', this.materialFilter || 'all');
    this.applyCameraGoal(goal, immediate);
  }

  setCameraState(viewId, materialFilter) {
    this.viewId = viewId;
    this.materialFilter = materialFilter;
    this.frameCurrentView(false);
  }

  requestRender() {
    this._needsRender = true;
  }

  startLoop() {
    if (this.raf || this.destroyed) return;
    const tick = (now) => {
      if (this.destroyed) return;
      this.raf = window.requestAnimationFrame(tick);
      const dt = this.lastFrameTime ? clamp((now - this.lastFrameTime) / 1000, 0.001, 0.06) : 0.016;
      this.lastFrameTime = now;
      this.step(dt);
      this.renderNow();
      this.frameCount += 1;
    };
    this.raf = window.requestAnimationFrame(tick);
  }

  step(dt) {
    if (this.destroyed) return;
    if (this.cameraGoal) {
      const goal = this.cameraGoal;
      goal.t = Math.min(1, goal.t + dt / goal.duration);
      const eased = easeInOutCubic(goal.t);
      this.camera.position.lerpVectors(goal.fromPosition, goal.toPosition, eased);
      this.controls.target.lerpVectors(goal.fromTarget, goal.toTarget, eased);
      this.camera.lookAt(this.controls.target);
      if (goal.t >= 1) {
        this.cameraGoal = null;
        this.controls.target.copy(goal.toTarget);
        this.controls.update();
      }
      this.requestRender();
    }
    if (this.controls) {
      this.controls.autoRotate = Boolean(this.spin) && !this.frozen && !this.reducedMotion && !this.cameraGoal;
      this.controls.update();
      this.clampTarget();
    }
    this.updateGroupLabels();
  }

  clampTarget() {
    if (!this.controls) return;
    const target = this.controls.target;
    const bounds = this.bounds || LOCAL_BOUNDS;
    const minX = bounds.min.x - 300;
    const maxX = bounds.max.x + 300;
    const minZ = bounds.min.z - 300;
    const maxZ = bounds.max.z + 300;
    const clampedX = clamp(target.x, minX, maxX);
    const clampedY = clamp(target.y, 0, bounds.max.y + 200);
    const clampedZ = clamp(target.z, minZ, maxZ);
    if (clampedX !== target.x || clampedY !== target.y || clampedZ !== target.z) {
      target.set(clampedX, clampedY, clampedZ);
    }
  }

  renderNow() {
    if (!this.renderer || !this.camera || !this.scene || this.destroyed) return;
    this.renderer.render(this.scene, this.camera);
    this._needsRender = false;
    this.rendered = true;
    this.renderCount += 1;
    const info = this.renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
  }

  updateGroupLabels() {
    const els = this.groupLabelEls;
    if (!els || !this.camera) return;
    const width = this.stageBox.width || 1;
    const height = this.stageBox.height || 1;
    const bounds = this.bounds || LOCAL_BOUNDS;
    // Top view has no clean silhouette to hang a label on, and a phone-width
    // stage fills its frame with columns - in both cases the material selector
    // directly under the stage carries the Plaster / Limestone / Satin names.
    const hideAll = this.viewId === 'top' || this.isNarrowStage();
    const point = new THREE.Vector3();
    for (const material of MATERIALS) {
      const element = els[material.id];
      if (!element) continue;
      if (hideAll) {
        element.classList.add('is-hidden');
        continue;
      }
      const groupIndex = MATERIAL_ORDER.indexOf(material.id);
      const x = (groupIndex - 1) * GROUP_SPACING + (bounds.min.x + bounds.max.x) / 2;
      const anchor = new THREE.Vector3(x, bounds.max.y + 60, 0);
      point.copy(anchor).project(this.camera);
      const behind = point.z > 1 || point.z < -1;
      const px = (point.x * 0.5 + 0.5) * width;
      const py = (-point.y * 0.5 + 0.5) * height;
      const outside = px < -120 || px > width + 120 || py < -60 || py > height + 60;
      if (behind || outside) {
        element.classList.add('is-hidden');
        continue;
      }
      element.classList.remove('is-hidden');
      element.style.transform = 'translate(-50%, -100%) translate(' + round(px, 1) + 'px,' + round(py - 10, 1) + 'px)';
    }
  }

  raycastColumn(clientX, clientY) {
    if (!this.camera) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    for (const column of this.columns) {
      if (column.mesh && !column.ghost) meshes.push(column.mesh);
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    return hit.object && hit.object.userData ? hit.object.userData.columnId || null : null;
  }

  getColumnScreenRect(id) {
    const column = this.columnsById.get(id);
    const spec = column ? column.spec : specByIdLocal(this.specs, id);
    if (!spec || !this.camera) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const corners = specCorners(spec);
    const point = new THREE.Vector3();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      point.copy(corner).project(this.camera);
      const px = rect.left + (point.x * 0.5 + 0.5) * rect.width;
      const py = rect.top + (-point.y * 0.5 + 0.5) * rect.height;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    return {
      x: round(minX, 2),
      y: round(minY, 2),
      width: round(maxX - minX, 2),
      height: round(maxY - minY, 2)
    };
  }

  whenFirstFrame() {
    if (this.rendered) return Promise.resolve(true);
    return new Promise((resolve) => {
      const poll = () => {
        if (this.rendered) {
          resolve(true);
          return;
        }
        window.setTimeout(poll, 16);
      };
      window.setTimeout(poll, 16);
    });
  }

  dispose() {
    this.destroyed = true;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.controls) this.controls.dispose();
    if (this.columnsCreated && typeof this.columnsCreated.dispose === 'function') {
      try { this.columnsCreated.dispose(); } catch (error) { /* best effort */ }
    }
    if (this.bank && typeof this.bank.dispose === 'function') {
      try { this.bank.dispose(); } catch (error) { /* best effort */ }
    }
    if (this.floor) {
      this.floor.geometry.dispose();
      if (this.floor.material.map) this.floor.material.map.dispose();
      this.floor.material.dispose();
    }
    if (this.shadowPlane) {
      this.shadowPlane.geometry.dispose();
      this.shadowPlane.material.dispose();
    }
    if (this.contactPlane) {
      this.contactPlane.geometry.dispose();
      if (this.contactPlane.material.map) this.contactPlane.material.map.dispose();
      this.contactPlane.material.dispose();
    }
    for (const line of this.outlines.values()) {
      line.geometry.dispose();
      line.material.dispose();
    }
    this.outlines.clear();
    if (this.ghostMaterial) this.ghostMaterial.dispose();
    if (this.reflectionAccents) {
      for (const mesh of this.reflectionAccents.children) {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      }
      this.scene.remove(this.reflectionAccents);
      this.reflectionAccents = null;
    }
    if (this.reflectionCubeRT) this.reflectionCubeRT.dispose();
    if (this.reflectionEnvRT) this.reflectionEnvRT.dispose();
    if (this.plasterReflectionAccents) {
      for (const mesh of this.plasterReflectionAccents.children) {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      }
      this.scene.remove(this.plasterReflectionAccents);
      this.plasterReflectionAccents = null;
    }
    if (this.plasterReflectionCubeRT) this.plasterReflectionCubeRT.dispose();
    if (this.plasterReflectionEnvRT) this.plasterReflectionEnvRT.dispose();
    if (this.envRT) this.envRT.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}

function specByIdLocal(specs, id) {
  for (const spec of specs) {
    if (spec.id === id) return spec;
  }
  return null;
}

/* =========================================================================
   Page controller
   ========================================================================= */

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

function showFallback(message, options) {
  const opts = options || {};
  state.failed = true;
  state.ready = false;
  if (opts.error) pushError(errorMessage(opts.error));
  // The banner carries the detailed failure; the static summary keeps a short,
  // stable explanation so the two never duplicate the same stack of text.
  const fallbackText = opts.banner
    ? 'The interactive preview could not start. The 27 long cuboids, their material groups and their exact dimensions are listed below.'
    : message;
  if (dom.fallback) {
    dom.fallback.hidden = false;
    if (dom.fallbackMessage) dom.fallbackMessage.textContent = fallbackText;
  }
  dom.body.dataset.fallback = '1';
  dom.body.dataset.qaReady = '0';
  for (const button of [dom.btnReset, dom.btnSpin]) {
    if (button) button.disabled = true;
  }
  for (const control of dom.materialTabs.concat(dom.materialChips)) {
    if (control.tagName === 'BUTTON') control.disabled = true;
  }
  for (const cell of dom.matrixCells) cell.disabled = true;
  hideCurtain();
  if (opts.banner) showErrorBanner(message);
  if (dom.infoFootState) dom.infoFootState.textContent = 'Static summary';
  if (dom.footerStatus) dom.footerStatus.textContent = 'Static summary';
  announce('Static summary: ' + message);
  publishState();
}

function setMaterial(id, options) {
  const opts = options || {};
  const next = id === 'all' || MATERIAL_ORDER.indexOf(id) >= 0 ? id : 'all';
  state.material = next;
  state.matrixCell = null;
  state.matrixHover = null;
  if (state.view === 'focus' && state.focusId) {
    const focused = specById(state.focusId);
    if (!focused || (next !== 'all' && focused.material !== next)) {
      state.view = 'hero';
      state.focusId = null;
    }
  }
  if (state.studio) {
    state.studio.materialFilter = next;
    state.studio.applyPresentation({
      material: next,
      matrixCell: state.matrixCell,
      hoverId: state.hoverId,
      focusId: state.focusId
    });
    if (state.view === 'focus' && state.focusId) {
      state.studio.viewId = 'focus';
      state.studio.materialFilter = next;
      state.studio.applyCameraGoal(state.studio.focusGoal(state.focusId), !opts.animate);
    } else {
      state.studio.setCameraState(state.view, next);
      if (!opts.animate) state.studio.frameCurrentView(true);
    }
  }
  syncAllUi();
  announce('Material filter: ' + (next === 'all' ? 'all materials' : materialLabel(next)));
  return next;
}

function setView(viewId, options) {
  const opts = options || {};
  const next = VIEW_ORDER.indexOf(viewId) >= 0 ? viewId : 'hero';
  state.view = next;
  state.focusId = null;
  if (state.studio) {
    state.studio.viewId = next;
    state.studio.materialFilter = state.material;
    state.studio.applyPresentation({
      material: state.material,
      matrixCell: state.matrixCell,
      hoverId: state.hoverId,
      focusId: null
    });
    if (opts.animate) state.studio.frameCurrentView(false);
    else state.studio.frameCurrentView(true);
  }
  syncAllUi();
  announce('View: ' + next);
  return next;
}

function setSpin(enabled) {
  const requested = Boolean(enabled);
  state.spin = requested && motionAllowed();
  if (state.studio) state.studio.spin = state.spin;
  syncSpinUi();
  publishState();
  announce(state.spin ? 'Auto-rotate on' : 'Auto-rotate off');
  return state.spin;
}

function focusColumn(id, options) {
  const opts = options || {};
  const spec = specById(id);
  if (!spec) return false;
  state.focusId = spec.id;
  state.view = 'focus';
  // A focused column must always stay lit: clear a material filter that would
  // ghost it before framing the camera on it.
  if (state.material !== 'all' && spec.material !== state.material) {
    state.material = 'all';
    syncMaterialUi();
  }
  if (state.studio) {
    state.studio.materialFilter = state.material;
    state.studio.viewId = 'focus';
    state.studio.applyPresentation({
      material: state.material,
      matrixCell: state.matrixCell,
      hoverId: state.hoverId,
      focusId: spec.id
    });
    state.studio.applyCameraGoal(state.studio.focusGoal(spec.id), !opts.animate ? true : false);
  }
  syncAllUi();
  announce('Focused ' + spec.id);
  return true;
}

function setHover(id) {
  const spec = id ? specById(id) : null;
  state.hoverId = spec ? spec.id : null;
  if (state.studio) {
    state.studio.applyPresentation({
      material: state.material,
      matrixCell: state.matrixCell,
      hoverId: state.hoverId,
      focusId: state.focusId
    });
  }
  syncReadout();
  publishState();
  return state.hoverId;
}

function reset(options) {
  const opts = options || {};
  state.view = 'hero';
  state.focusId = null;
  state.hoverId = null;
  state.matrixCell = null;
  state.matrixHover = null;
  state.spin = false;
  if (state.studio) {
    state.studio.viewId = 'hero';
    state.studio.spin = false;
    state.studio.applyPresentation({
      material: state.material,
      matrixCell: null,
      hoverId: null,
      focusId: null
    });
    state.studio.setCameraState('hero', state.material);
    if (!opts.animate) state.studio.frameCurrentView(true);
  }
  syncAllUi();
  announce('View reset');
  return true;
}

/* ------------------------------------------------------------- QA hooks */

let resolveReady = null;
const readyPromise = new Promise((resolve) => {
  resolveReady = resolve;
});

function collectMaterialDebug() {
  const bank = state.bank;
  return MATERIALS.map((material) => {
    const textures = bank && bank.textures ? bank.textures[material.id] : null;
    const modelMaterial = bank && bank.materials ? bank.materials[material.id] : null;
    const materialUserData = modelMaterial && modelMaterial.userData ? modelMaterial.userData : null;
    const userDataMaps = materialUserData && materialUserData.maps ? materialUserData.maps : null;
    // Rev 9: prefer the model's `userData.maps` (what the material ACTUALLY
    // samples: NO material wires a normalMap in rev 9; plaster wires neither
    // roughness nor metalness) over the older "is the channel file loaded"
    // probe.  The fallback keeps older banks usable.
    const mapFlag = (channel, materialProperty) => {
      if (userDataMaps && Object.prototype.hasOwnProperty.call(userDataMaps, channel)) {
        return Boolean(userDataMaps[channel]);
      }
      if (textures && textures[channel]) return true;
      if (modelMaterial && modelMaterial[materialProperty]) return true;
      return false;
    };
    const hasNormalMap = Boolean(modelMaterial && modelMaterial.normalMap);
    return {
      id: material.id,
      label: material.label,
      columns: state.specs.filter((spec) => spec.material === material.id).length,
      maps: {
        albedo: mapFlag('albedo', 'map'),
        normal: mapFlag('normal', 'normalMap'),
        roughness: mapFlag('roughness', 'roughnessMap'),
        metalness: mapFlag('metalness', 'metalnessMap'),
        ao: mapFlag('ao', 'aoMap'),
        height: mapFlag('height', 'bumpMap'),
        // Rev 9: no material samples a normal map ('none' for all three):
        // plaster is perfectly smooth, limestone grain is albedo colour noise,
        // satin is smooth neutral grey.
        normalSource: hasNormalMap ? 'derived-map' : 'none',
        metalnessSource: modelMaterial && !modelMaterial.metalnessMap ? 'constant' : 'metalness-map'
      },
      // Rev 7/8: live material numbers (the model publishes tuning + effective
      // factors from the manifest map means in userData.params).
      params: materialUserData && materialUserData.params ? {
        metalness: round(materialUserData.params.metalness, 4),
        metalnessEffective: round(materialUserData.params.metalnessEffective, 4),
        roughness: round(materialUserData.params.roughness, 4),
        roughnessMapMean: round(materialUserData.params.roughnessMapMean, 4),
        roughnessEffective: round(materialUserData.params.roughnessEffective, 4),
        // Rev 9 explicit wiring flags: false/false for the perfectly smooth
        // plaster mirror (and normalMapSampled is false for all three groups).
        normalMapSampled: Boolean(materialUserData.params.normalMapSampled),
        roughnessMapSampled: Boolean(materialUserData.params.roughnessMapSampled),
        normalScale: [round(materialUserData.params.normalScale[0], 3), round(materialUserData.params.normalScale[1], 3)],
        aoMapIntensity: round(materialUserData.params.aoMapIntensity, 3),
        envMapIntensity: round(materialUserData.params.envMapIntensity, 3),
        bumpScale: round(materialUserData.params.bumpScale, 4),
        envMapIntensityLive: modelMaterial ? round(modelMaterial.envMapIntensity, 3) : null
      } : null,
      mapUsage: materialUserData && materialUserData.mapUsage ? { ...materialUserData.mapUsage } : null,
      // Rev 9: where the visible surface detail comes from (additive QA field).
      grainMode: materialUserData && materialUserData.grainMode ? materialUserData.grainMode : null,
      // Rev 8: always null (the rev-7 procedural descriptor is gone); the key is
      // kept so older QA readers do not crash.
      liquidNormal: materialUserData && materialUserData.liquidNormal ? { ...materialUserData.liquidNormal } : null
    };
  });
}

function countTextureFiles() {
  const bank = state.bank;
  if (!bank || !bank.textures) return { loaded: 0, total: 18 };
  let loaded = 0;
  for (const material of MATERIALS) {
    const textures = bank.textures[material.id];
    if (!textures) continue;
    for (const channel of ['albedo', 'normal', 'roughness', 'metalness', 'ao', 'height']) {
      if (textures[channel]) loaded += 1;
    }
  }
  return { loaded: loaded, total: 18 };
}

/**
 * Rev 8 QA compatibility: the rev-7 plaster liquid-flow normal (and its clock)
 * was removed when the mirror became flat and clean.  Older Lead capture scripts
 * still read `debug().liquid`, so it stays as a permanently disabled stub with
 * the exact rev-7 shape: nothing is animated, nothing flows, time/offset are
 * fixed at 0/null.  The live surface wiring is reported by `plasterSurface`.
 */
function liquidDebug() {
  return {
    enabled: false,
    mode: 'none',
    size: null,
    waveCount: 0,
    measuredMeanSlope: null,
    flowSpeedU: null,
    flowSpeedV: null,
    animated: false,
    paused: true,
    time: 0,
    offset: null
  };
}

/**
 * Rev 8 QA: describe the plaster mirror SURFACE wiring from the real material.
 * The expected state is the clean flat mirror: no normalMap (sample-able), a
 * [0, 0] normalScale, no roughnessMap and the constant 0.092 roughness, while
 * the reflective kit is untouched (CubeCamera→PMREM mirror envMap captured,
 * PLASTER_MIRROR layer-2 accents, envMapIntensity 3.0).  Nothing animates.
 */
function plasterSurfaceDebug() {
  const plasterMaterial = state.bank && state.bank.materials ? state.bank.materials.plaster : null;
  const studio = state.studio;
  const data = plasterMaterial && plasterMaterial.userData ? plasterMaterial.userData : null;
  const params = data && data.params ? data.params : null;
  const normalScale = plasterMaterial && plasterMaterial.normalScale ? plasterMaterial.normalScale : null;
  return {
    normalMap: Boolean(plasterMaterial && plasterMaterial.normalMap),
    normalScale: normalScale ? [round(normalScale.x, 3), round(normalScale.y, 3)] : null,
    roughnessMap: Boolean(plasterMaterial && plasterMaterial.roughnessMap),
    roughness: params ? round(params.roughnessEffective, 4) : null,
    mirrorEnvMap: Boolean(studio && studio.plasterReflectionCaptured) || Boolean(plasterMaterial && plasterMaterial.envMap),
    envMapIntensity: plasterMaterial ? round(plasterMaterial.envMapIntensity, 3) : null,
    accents: PLASTER_MIRROR.accents.length,
    animated: false
  };
}

function buildDebug() {
  const studio = state.studio;
  const specs = state.specs;
  const bounds = state.bounds;
  const rects = {};
  for (const spec of specs) {
    rects[spec.id] = studio ? studio.getColumnScreenRect(spec.id) : null;
  }
  const textureInfo = countTextureFiles();
  const camera = studio && studio.camera ? studio.camera : null;
  const target = studio && studio.controls ? studio.controls.target : null;
  // Rev 9: expose the rounded-column bevel wiring from the real geometry for QA
  // (per-column radius + segments; the model publishes these in geometry.userData).
  const studioColumns = studio && studio.columnsById ? studio.columnsById : null;
  const columnGeometryData = (id) => {
    const column = studioColumns ? studioColumns.get(id) : null;
    return column && column.mesh && column.mesh.geometry ? column.mesh.geometry.userData : null;
  };
  return {
    ready: Boolean(state.ready),
    errors: qa.errors.length,
    webgl: Boolean(state.webgl),
    material: state.material,
    view: state.view,
    spin: Boolean(state.spin),
    count: specs.length,
    materials: collectMaterialDebug(),
    columns: specs.map((spec) => {
      const geometryData = columnGeometryData(spec.id);
      return {
        id: spec.id,
        material: spec.material,
        footprint: spec.footprint,
        height: spec.height,
        width: spec.width,
        depth: spec.depth,
        heightPx: spec.heightPx,
        position: { x: spec.position.x, y: spec.position.y, z: spec.position.z },
        // Rev 9 rounded box: radius in source px (large 10 / medium 5 / small 3)
        // and the bevel segment count baked into the geometry.
        cornerRadius: geometryData && Number.isFinite(geometryData.cornerRadius) ? geometryData.cornerRadius : null,
        bevelSegments: geometryData && Number.isFinite(geometryData.bevelSegments) ? geometryData.bevelSegments : null,
        roundedBox: Boolean(geometryData && geometryData.roundedBox)
      };
    }),
    textures: textureInfo,
    renderer: {
      antialias: true,
      dpr: studio && studio.renderer ? round(studio.renderer.getPixelRatio(), 3) : 1,
      drawCalls: studio ? studio.stats.drawCalls : 0
    },
    camera: {
      position: camera ? [round(camera.position.x, 3), round(camera.position.y, 3), round(camera.position.z, 3)] : [0, 0, 0],
      target: target ? [round(target.x, 3), round(target.y, 3), round(target.z, 3)] : [0, 0, 0]
    },
    bounds: {
      min: [bounds.min.x, bounds.min.y, bounds.min.z],
      max: [bounds.max.x, bounds.max.y, bounds.max.z]
    },
    reflection: {
      captured: Boolean(studio && studio.reflectionCaptured),
      cubeSize: REFLECTION.cubeSize,
      layer: REFLECTION.layer,
      accents: REFLECTION.accents.length,
      envMapIntensity: studio && studio.satinMaterial ? round(studio.satinMaterial.envMapIntensity, 3) : null,
      center: [REFLECTION.center.x, REFLECTION.center.y, REFLECTION.center.z]
    },
    // Rev 7/8: plaster liquid-metal mirror (mirror capture + accents); the
    // rev-7 liquid-flow state is gone and reported as the disabled `liquid` stub.
    plasterMirror: {
      captured: Boolean(studio && studio.plasterReflectionCaptured),
      cubeSize: PLASTER_MIRROR.cubeSize,
      layer: PLASTER_MIRROR.layer,
      accents: PLASTER_MIRROR.accents.length,
      envMapIntensity: studio && studio.plasterMaterial ? round(studio.plasterMaterial.envMapIntensity, 3) : null,
      envIntensityBand: [PLASTER_MIRROR.minEnvIntensity, PLASTER_MIRROR.maxEnvIntensity],
      center: [PLASTER_MIRROR.center.x, PLASTER_MIRROR.center.y, PLASTER_MIRROR.center.z]
    },
    // Rev 8: live plaster SURFACE wiring - proves the clean flat mirror.
    plasterSurface: plasterSurfaceDebug(),
    liquid: liquidDebug(),
    still: Boolean(state.still),
    columnScreenRects: rects
  };
}

const api = {
  setMaterial(id) {
    return setMaterial(id, { animate: false });
  },
  setView(view) {
    return setView(view, { animate: false });
  },
  setSpin(enabled) {
    return setSpin(enabled);
  },
  reset() {
    reset({ animate: false });
    return Promise.resolve(true);
  },
  focusColumn(id) {
    return focusColumn(id, { animate: false });
  },
  hoverColumn(id) {
    return setHover(id);
  },
  getColumnScreenRect(id) {
    return state.studio ? state.studio.getColumnScreenRect(id) : null;
  }
};

const hook = (window.__tekoColumns = window.__tekoColumns || {});
hook.version = VERSION;
hook.debug = buildDebug;
hook.api = api;
hook.ready = readyPromise;

/* ------------------------------------------------------------ ui wiring */

function applyMatrixCell(cell, options) {
  const opts = options || {};
  const next = state.matrixCell && state.matrixCell.footprint === cell.footprint && state.matrixCell.height === cell.height
    ? null
    : cell;
  state.matrixCell = next;
  if (state.studio) {
    state.studio.applyPresentation({
      material: state.material,
      matrixCell: state.matrixCell,
      hoverId: state.hoverId,
      focusId: state.focusId
    });
  }
  syncMatrixUi();
  syncReadout();
  publishState();
  announce(next ? 'Highlighted ' + FOOTPRINTS[next.footprint].label + ' / ' + HEIGHTS[next.height].label : 'Column highlight cleared');
  return state.matrixCell;
}

function wireUi() {
  if (dom.btnReset) {
    dom.btnReset.addEventListener('click', () => {
      if (!state.ready) return;
      reset({ animate: true });
    });
  }
  if (dom.btnSpin) {
    dom.btnSpin.addEventListener('click', () => {
      if (!state.ready) return;
      setSpin(!state.spin);
    });
  }
  for (const tab of dom.materialTabs) {
    tab.addEventListener('click', () => {
      if (!state.ready) return;
      setMaterial(tab.getAttribute('data-material'), { animate: true });
    });
  }
  for (const chip of dom.materialChips) {
    chip.addEventListener('click', () => {
      if (!state.ready || chip.tagName !== 'BUTTON') return;
      setMaterial(chip.getAttribute('data-material-chip'), { animate: true });
    });
  }
  for (const cell of dom.matrixCells) {
    const cellData = { footprint: cell.getAttribute('data-footprint'), height: cell.getAttribute('data-height') };
    cell.addEventListener('pointerenter', () => {
      state.matrixHover = cellData;
      if (state.studio) {
        state.studio.applyPresentation({
          material: state.material,
          matrixCell: state.matrixHover,
          hoverId: state.hoverId,
          focusId: state.focusId
        });
      }
      syncMatrixUi();
      syncReadout();
    });
    cell.addEventListener('pointerleave', () => {
      state.matrixHover = null;
      if (state.studio) {
        state.studio.applyPresentation({
          material: state.material,
          matrixCell: state.matrixCell,
          hoverId: state.hoverId,
          focusId: state.focusId
        });
      }
      syncMatrixUi();
      syncReadout();
    });
    cell.addEventListener('click', () => {
      if (!state.ready) return;
      applyMatrixCell(cellData, { animate: true });
    });
  }

  if (dom.canvas) {
    dom.canvas.addEventListener('pointermove', (event) => {
      if (!state.ready || state.pointerDown) return;
      if (event.pointerType === 'touch') return;
      const id = state.studio ? state.studio.raycastColumn(event.clientX, event.clientY) : null;
      if (id !== state.hoverId) {
        dom.canvas.classList.toggle('is-hovering', Boolean(id));
        setHover(id);
      }
    });
    dom.canvas.addEventListener('pointerleave', () => {
      dom.canvas.classList.remove('is-hovering');
      if (state.hoverId) setHover(null);
    });
    dom.canvas.addEventListener('pointerdown', (event) => {
      state.pointerDown = true;
      state.pointerDownAt = { x: event.clientX, y: event.clientY, time: performance.now() };
    });
    dom.canvas.addEventListener('pointerup', (event) => {
      const wasDown = state.pointerDown;
      state.pointerDown = false;
      if (!wasDown || !state.ready) return;
      const dx = event.clientX - state.pointerDownAt.x;
      const dy = event.clientY - state.pointerDownAt.y;
      const elapsed = performance.now() - state.pointerDownAt.time;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6 || elapsed > 700) return;
      const id = state.studio ? state.studio.raycastColumn(event.clientX, event.clientY) : null;
      if (id) {
        focusColumn(id, { animate: true });
      } else if (state.view === 'focus') {
        reset({ animate: true });
      }
    });
    dom.canvas.addEventListener('pointercancel', () => {
      state.pointerDown = false;
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
    if (!state.ready) return;
    if (key === '1' || key === '2' || key === '3') {
      event.preventDefault();
      setMaterial(MATERIAL_ORDER[Number(key) - 1], { animate: true });
    } else if (key === '0' || key === 'a') {
      event.preventDefault();
      setMaterial('all', { animate: true });
    } else if (key === 'r') {
      event.preventDefault();
      reset({ animate: true });
    } else if (key === ' ' || key === 'spacebar') {
      event.preventDefault();
      setSpin(!state.spin);
    } else if (key === 'escape') {
      event.preventDefault();
      reset({ animate: true });
    }
  });

  reducedMotionQuery.addEventListener('change', (event) => {
    state.reducedMotion = event.matches;
    if (state.reducedMotion) {
      state.spin = false;
      if (state.studio) state.studio.spin = false;
    }
    if (state.studio) state.studio.reducedMotion = state.reducedMotion;
    syncAllUi();
  });

  window.addEventListener('pagehide', () => {
    window.clearTimeout(state.watchdog);
    if (state.studio) {
      try { state.studio.dispose(); } catch (error) { /* best effort */ }
      state.studio = null;
    }
  });
}

/* ------------------------------------------------------------------ boot */

function applyUrlMaterialAndFlags() {
  if (state.url.material) state.material = state.url.material;
  if (state.url.spin !== null) state.spin = state.url.spin && motionAllowed();
  state.frozen = state.shot || state.qaMode || state.still;
  if (state.frozen) state.spin = false;
  syncMaterialUi();
  syncSpinUi();
  syncSpecUi();
  syncReadout();
  publishState();
}

function applyUrlCameraState(immediate) {
  if (!state.studio) return;
  const material = state.material;
  state.studio.materialFilter = material;
  state.studio.spin = state.spin;
  state.studio.applyPresentation({
    material: material,
    matrixCell: state.matrixCell,
    hoverId: null,
    focusId: state.url.focus ? state.url.focus : null
  });
  const focusSpec = state.url.focus ? specById(state.url.focus) : null;
  if (focusSpec) {
    state.focusId = focusSpec.id;
    state.view = 'focus';
    state.studio.viewId = 'focus';
    state.studio.applyCameraGoal(state.studio.focusGoal(focusSpec.id), true);
  } else {
    state.focusId = null;
    state.view = state.url.view || 'hero';
    state.studio.viewId = state.view;
    state.studio.frameCurrentView(true);
  }
  syncAllUi();
}

async function boot() {
  state.bootStartedAt = performance.now();
  parseUrlState();
  state.frozen = state.shot || state.qaMode || state.still;
  if (state.shot) dom.body.dataset.shot = '1';
  if (state.cleanChrome) dom.body.dataset.chrome = '0';
  if (state.qaMode) {
    dom.body.dataset.qa = '1';
    if (dom.curtain) {
      dom.curtain.hidden = true;
      dom.curtain.classList.add('is-hidden');
    }
  }

  applyUrlMaterialAndFlags();
  curtainProgress(0.01, 'Detecting WebGL', '', 'Preparing the material studio');

  const webglVersion = probeWebGL();
  qa.webgl = webglVersion;
  state.webgl = Boolean(webglVersion);
  state.webglVersion = webglVersion || '';
  if (!state.webgl) {
    showFallback('WebGL is not available in this browser, so the interactive columns cannot be rendered. The 27 columns and their exact dimensions are listed below.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.05, 'Loading 3D engine', '');
  let modelModule = null;
  try {
    modelModule = await import(MODEL_URL.href);
  } catch (error) {
    showFallback('The columns model module could not be loaded (' + errorMessage(error) + '). The 27 columns and their exact dimensions are listed below.', { error: error, banner: true });
    resolveReady(false);
    return;
  }
  const validation = validateModelModule(modelModule);
  if (!validation.ok) {
    showFallback(validation.message + ' The 27 columns and their exact dimensions are listed below.', { banner: true });
    resolveReady(false);
    return;
  }
  state.specs = cloneSpecs(modelModule.COLUMN_SPECS);
  state.specsFromModel = true;
  const metrics = modelModule.COLUMN_METRICS || {};
  state.bounds = normalizeBounds(metrics.bounds) || computeSpecBounds(state.specs);
  state.boundsFromModel = Boolean(metrics.bounds);
  syncSpecUi();
  syncReadout();
  publishState();

  curtainProgress(0.09, 'Loading material maps', '0 / 19');
  let bank = null;
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        bank = await modelModule.loadColumnBank({
          assetBase: ASSET_BASE,
          onProgress: (loaded, total) => {
            const safeTotal = Number(total) || 0;
            const ratio = safeTotal > 0 ? clamp(loaded / safeTotal, 0, 1) : 0;
            curtainProgress(0.09 + ratio * 0.62, 'Loading material maps', loaded + ' / ' + (safeTotal || 19));
          }
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          pushWarning('material asset load failed, retrying once: ' + errorMessage(error));
          curtainProgress(0.09, 'Retrying material maps', '0 / 19');
          await new Promise((resolve) => window.setTimeout(resolve, 350));
        }
      }
    }
    if (lastError) throw lastError;
  } catch (error) {
    showFallback('The material maps could not be loaded (' + errorMessage(error) + '). The 27 columns and their exact dimensions are listed below.', { error: error, banner: true });
    resolveReady(false);
    return;
  }
  state.bank = bank;

  curtainProgress(0.74, 'Building the 27 columns', '');
  try {
    state.studio = new ColumnsStudio({
      canvas: dom.canvas,
      stage: dom.stage,
      groupLabels: dom.groupLabels,
      reducedMotion: state.reducedMotion,
      frozen: state.frozen
    });
    state.studio.captureMode = Boolean(state.shot || state.qaMode);
    await state.studio.init();
    const created = modelModule.createColumns(bank, { quality: 'hero' });
    if (!created || !created.group || !Array.isArray(created.columns) || created.columns.length !== 27) {
      throw new Error('createColumns() did not return the expected 27-column scene graph.');
    }
    state.studio.attachColumns(created, state.specs, state.bounds);
    // Rev 8: the plaster mirror is a static flat surface - there is no liquid
    // flow controller to hand to the studio any more.
    // Rev 6: one deterministic reflection capture in the canonical all-visible
    // scene state, before any material filter/ghost presentation is applied.
    state.studio.captureSatinReflection(bank.materials ? bank.materials.satin : null);
    // Rev 7: a second one-off capture for the sharper plaster liquid-metal mirror.
    state.studio.capturePlasterReflection(bank.materials ? bank.materials.plaster : null);
    state.studio.spin = state.spin;
    applyUrlCameraState(true);
  } catch (error) {
    if (state.studio) {
      try { state.studio.dispose(); } catch (disposeError) { /* best effort */ }
      state.studio = null;
    }
    showFallback('The column studio could not start (' + errorMessage(error) + '). The 27 columns and their exact dimensions are listed below.', { error: error, banner: true });
    resolveReady(false);
    return;
  }

  curtainProgress(0.96, 'Preparing the studio', '');
  try {
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, new Promise((resolve) => window.setTimeout(resolve, 900))]);
    }
  } catch (error) {
    /* font readiness is cosmetic only */
  }
  state.studio.resize();
  applyUrlCameraState(true);
  state.studio.renderNow();

  curtainProgress(1, 'Studio ready', '');
  hideCurtain();
  state.ready = true;
  state.bootStartedAt = 0;
  window.clearTimeout(state.watchdog);
  if (dom.infoFootState) dom.infoFootState.textContent = '27 / 27 ready';
  if (dom.footerStatus) dom.footerStatus.textContent = 'Ready';
  syncAllUi();
  announce('Material columns ready');
  state.studio.requestRender();
  await state.studio.whenFirstFrame();
  state.studio.renderNow();
  publishState();
  resolveReady(true);
}

/* ------------------------------------------------------------------ main */

wireUi();
applyUrlMaterialAndFlags();
if (dom.footerStatus) dom.footerStatus.textContent = 'Loading';
publishState();

boot().catch((error) => {
  if (!state.failed) {
    showFallback('The preview failed to start (' + errorMessage(error) + '). The 27 columns and their exact dimensions are listed below.', { error: error, banner: true });
  }
  resolveReady(false);
});

state.watchdog = window.setTimeout(() => {
  if (!state.ready && !state.failed) {
    showFallback('The interactive preview did not start within 20 seconds. The 27 columns and their exact dimensions are listed below.', { banner: true });
    resolveReady(false);
  }
}, 20000);

window.setInterval(() => {
  if (state.failed) return;
  publishState();
}, 500);


