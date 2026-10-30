/**
 * tekoanimation - material columns preview controller.
 *
 * Owns the page shell wiring, the three.js studio, the QA hooks (SPEC-columns
 * §6.3) and the deterministic URL state (§6.4). The 27 box meshes, their exact
 * dimensions and the PBR materials come from ./columns-model.js through the
 * frozen §5 API; this module never builds column geometry or textures.
 *
 * Studio contract:
 *   - Rev21: the ONLY light is the shared room photograph
 *     (assets/env/modern-empty-room.jpg) filtered once into a PMREM by
 *     ./env-room.js and assigned to `scene.environment`; there are no THREE
 *     lights and no procedural studio / softbox PMREM any more;
 *   - an unlit, deterministic floor pool with alpha falloff, plus a
 *     contact-shadow bed, so the columns read as standing in a dark studio;
 *   - camera framing is solved numerically from the real 27 box corners for the
 *     live stage aspect, so all 27 columns fit at 1440x900 and 390x844.
 *
 * A missing or invalid model module / asset bank degrades to a descriptive
 * error state plus the static 27-column summary that ships in columns.html.
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { applyEnvRoom } from './env-room.js';

const VERSION = '1.4.0';

/* s48: uniform world scale. Mirrors COLUMN_WORLD_SCALE in columns-model.js (checked at load);
   page labels keep showing the spec px (world / WORLD_SCALE). */
const WORLD_SCALE = 200;

const MODEL_URL = new URL('./columns-model.js', import.meta.url);
const ASSET_BASE = './assets/textures/materials';

/* -------------------------------------------------------------- registries */

const MATERIALS = Object.freeze([
  Object.freeze({ id: 'plaster', label: 'Plaster', sourceImage: 'plaster.png' }),
  Object.freeze({ id: 'reeded-metal', label: 'Reeded Metal', sourceImage: 'reeded-metal.png' }),
  Object.freeze({ id: 'satin', label: 'Satin', sourceImage: 'satin.png' }),
  // Rev19 (s46): procedural metal groups (generated in the model, no assets).
  Object.freeze({ id: 'grain-metal', label: 'Natural Grain Metal', sourceImage: null }),
  Object.freeze({ id: 'titanium', label: 'Titanium Alloy', sourceImage: null })
]);
const MATERIAL_ORDER = Object.freeze(['plaster', 'reeded-metal', 'satin', 'grain-metal', 'titanium']);
const FOOTPRINT_ORDER = Object.freeze(['large', 'medium', 'small']);
const HEIGHT_ORDER = Object.freeze(['long', 'medium', 'short']);
const FOOTPRINTS = Object.freeze({
  large: Object.freeze({ id: 'large', label: 'Large', px: 140, xOffset: -180 * WORLD_SCALE }),
  medium: Object.freeze({ id: 'medium', label: 'Medium', px: 80, xOffset: 0 }),
  small: Object.freeze({ id: 'small', label: 'Small', px: 40, xOffset: 180 * WORLD_SCALE })
});
const HEIGHTS = Object.freeze({
  long: Object.freeze({ id: 'long', label: 'Long', px: 600, zOffset: -180 * WORLD_SCALE }),
  medium: Object.freeze({ id: 'medium', label: 'Medium', px: 550, zOffset: 0 }),
  short: Object.freeze({ id: 'short', label: 'Short', px: 500, zOffset: 180 * WORLD_SCALE })
});
const GROUP_SPACING = 700 * WORLD_SCALE;

/* Local mirror of the frozen spec table. The page needs 27 readable columns in
   the readout, the size-matrix legend and the fallback state even before (or
   without) src/columns-model.js; the model module is authoritative once loaded. */
function buildLocalSpecs() {
  const specs = [];
  MATERIALS.forEach((material, groupIndex) => {
    const groupCentreX = (groupIndex - (MATERIALS.length - 1) / 2) * GROUP_SPACING;
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
          width: footprint.px * WORLD_SCALE,
          depth: footprint.px * WORLD_SCALE,
          heightPx: height.px * WORLD_SCALE,
          position: { x: groupCentreX + footprint.xOffset, y: (height.px * WORLD_SCALE) / 2, z: height.zOffset },
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
  hero: Object.freeze({ id: 'hero', label: 'Hero', azimuth: 33, elevation: 24, targetYFactor: 0.367, targetXOffset: 145 * WORLD_SCALE }),
  front: Object.freeze({ id: 'front', label: 'Front', azimuth: 0, elevation: 12, targetYFactor: 0.43, targetXOffset: 0 }),
  side: Object.freeze({ id: 'side', label: 'Side', azimuth: 90, elevation: 12, targetYFactor: 0.47, targetXOffset: 0 }),
  top: Object.freeze({ id: 'top', label: 'Top', azimuth: 0, elevation: 68, targetYFactor: 0.5, targetXOffset: 0 })
});
const VIEW_ORDER = Object.freeze(['hero', 'front', 'side', 'top']);
// Portrait / narrow stages cannot fill their height with the 1850-wide scene at
// the desktop 3/4 angle. Swinging the hero azimuth toward the depth axis (and
// using a slightly tighter fit margin) makes the 27 columns fill the tall stage
// on phones while all of them stay in frame. Desktop keeps VIEWS.hero.
const NARROW_VIEW = Object.freeze({ id: 'hero', label: 'Hero', azimuth: 58, elevation: 30, targetYFactor: 0.35, targetXOffset: 145 * WORLD_SCALE, margin: 0.92 });
const FOCUS_VIEW = Object.freeze({ azimuth: 31, elevation: 12.5, margin: 0.82 });

const FIT = Object.freeze({ margin: 0.9, minDistance: 40 * WORLD_SCALE, maxDistance: 240000 * WORLD_SCALE });

/* Rendering constants (tuned against the three material sheets in the studio). */
/* s47 precision: the canvas is supersampled. pixelRatio = min(devicePixelRatio * renderScale, maxPixelRatio);
   adaptive: if the mean frame time over `adaptWindow` frames exceeds `slowMs`, drop to `fallbackScale` once. */
const RENDERER = Object.freeze({ exposure: 1.4, renderScale: 2, maxPixelRatio: 3, fallbackScale: 1.5, slowMs: 24, adaptWindow: 30 });
/* Rev21 — image-based lighting only: the shared room photograph
   (assets/env/modern-empty-room.jpg) is filtered into a PMREM by ./env-room.js
   and becomes `scene.environment`. No THREE lights and no procedural studio /
   softbox PMREM: the photo's dark interior with its bright ceiling downlights
   is the light. r151 has no scene-level environmentIntensity, so env-room BAKES
   ROOM.intensity into the PMREM radiance (materials are never scaled by it).
   s42: every column material is a metal mirror with its own absolute radiance gain
   (MIRROR), so the bake must stay NEUTRAL (1). s14 baked 4.5 on top of the
   MIRROR gains and blew plaster/satin out (~27x/22x) and flattened the steel. */
const ROOM = Object.freeze({
  intensity: 1,
  label: 'assets/env/modern-empty-room.jpg (PMREM, env-room)',
});
const FLOOR = Object.freeze({ radius: 9000 * WORLD_SCALE });
// Ghost columns are context silhouettes, not materials: an unlit near-black
// surface keeps every non-selected group darker than the floor's shadows so the
// selected group always owns the frame (SPEC §6.2 "fade to a ghost state").
const GHOST = Object.freeze({ color: 0x0b0f15 });
const OUTLINE = Object.freeze({ color: 0xcfe4ff, opacity: 0.85 });

/* Rev21 - plaster / satin mirror radiance gains.
   Plan lim (Rev21 s1): CubeCamera self-reflection captures may stay only if they
   capture real scene geometry lit by the room env, with NO added emitters. The
   rev-6/rev-7 reflection-only emitter panels (warm/cool backdrops, banners and
   floor patches, drawn only for the captures on layers 1/2) are therefore GONE
   together with their CubeCamera captures: a capture of the emitters-free scene
   reflected near-black, so both mirrors now sample the shared room-photo PMREM
   (`scene.environment`) directly, like reeded-metal.

   A metal mirror samples environment RADIANCE (not the diffuse irradiance the
   room intensity is tuned for), so the plaster/satin env gain is clamped to the
   accepted radiance range below. The baked ROOM.intensity (1) multiplies them
   neutrally; do not raise it without dividing these gains. */
const MIRROR = Object.freeze({
  satin: Object.freeze({ envIntensity: 7, envIntensityBand: Object.freeze([4, 12]) }),
  plaster: Object.freeze({ envIntensity: 3, envIntensityBand: Object.freeze([2, 16]) }),
  // Rev 5 s32: reeded-metal steel sides + its reeded top plate.
  'reeded-metal': Object.freeze({ envIntensity: 2.6, topEnvIntensity: 3.2, envIntensityBand: Object.freeze([0.8, 5]) }),
  // Rev19 s46: procedural metal groups (soft broad gradient, no blown highlights).
  'grain-metal': Object.freeze({ envIntensity: 3, envIntensityBand: Object.freeze([1, 6]) }),
  titanium: Object.freeze({ envIntensity: 3.2, envIntensityBand: Object.freeze([1, 6]) })
});
const CAMERA = Object.freeze({ fov: 34, near: 20 * WORLD_SCALE, far: 120000 * WORLD_SCALE });
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
    'reeded-metal': document.querySelector('[data-group-label="reeded-metal"]'),
    satin: document.querySelector('[data-group-label="satin"]'),
    'grain-metal': document.querySelector('[data-group-label="grain-metal"]'),
    titanium: document.querySelector('[data-group-label="titanium"]')
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
  return spec.width / WORLD_SCALE + ' x ' + spec.depth / WORLD_SCALE + ' x ' + spec.heightPx / WORLD_SCALE + ' px';
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
  let name = 'All 45 columns';
  let dims = '140 / 80 / 40 px footprints - 600 / 550 / 500 px heights';
  let id = '5 materials x 9 dimensions';
  const hovered = state.focusId || state.hoverId;
  const hoveredSpec = specById(hovered);
  const cell = state.matrixCell || state.matrixHover;
  if (hoveredSpec) {
    const footprint = FOOTPRINTS[hoveredSpec.footprint];
    const height = HEIGHTS[hoveredSpec.height];
    kicker = state.focusId ? 'Focused' : 'Hovered';
    name = materialLabel(hoveredSpec.material) + ' - ' + footprint.label + ' - ' + height.label;
    dims = hoveredSpec.width / WORLD_SCALE + ' x ' + hoveredSpec.depth / WORLD_SCALE + ' x ' + hoveredSpec.heightPx / WORLD_SCALE + ' px';
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
      dom.stageName.textContent = 'long cuboids - 5 materials x 9 dimensions';
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
    dom.specExtent.textContent = Math.round(bounds.size.x / WORLD_SCALE) + ' x ' + Math.round(bounds.size.z / WORLD_SCALE) + ' x ' +
      Math.round(bounds.size.y / WORLD_SCALE) + ' px';
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
  if (modelModule.COLUMN_WORLD_SCALE !== WORLD_SCALE) {
    return { ok: false, message: 'The columns model world scale (' + modelModule.COLUMN_WORLD_SCALE + ') disagrees with the page (' + WORLD_SCALE + ').' };
  }
  const specs = modelModule.COLUMN_SPECS;
  if (!Array.isArray(specs) || specs.length !== 45) {
    return {
      ok: false,
      message: 'The columns model exposes ' + (Array.isArray(specs) ? specs.length : 'no') + ' COLUMN_SPECS, expected 45.'
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
    if (check.width !== footprint.px * WORLD_SCALE || check.depth !== footprint.px * WORLD_SCALE || check.heightPx !== height.px * WORLD_SCALE) {
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
  const width = bounds.size.x + 900 * WORLD_SCALE;
  const depth = bounds.size.z + 900 * WORLD_SCALE;
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
    const radius = spec.width * 0.9 + 46 * WORLD_SCALE;
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
    // Rev21: the shared room-photo PMREM handle (env-room.js); no envRT/lights.
    this.room = null;
    this.floor = null;
    this.columnsGroup = null;
    this.overlayGroup = null;
    this.columns = [];
    this.columnsById = new Map();
    this.baseMaterials = new Map();
    this.ghostMaterial = null;
    this.contactShadowKey = null;
    // Rev21: the two metal mirrors read `scene.environment` directly (no
    // CubeCamera capture, no reflection-only emitter layers).
    this.satinMaterial = null;
    this.plasterMaterial = null;
    this.reededMaterial = null;
    this.reededTopMaterial = null;
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
    this.renderScale = RENDERER.renderScale;
    this.adaptive = true;
    this.frameTimes = [];
    this.qaCamera = false;
    renderer.setPixelRatio(this.effectivePixelRatio());
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDERER.exposure;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.6, CAMERA.near, CAMERA.far);
    camera.position.set(0, 1500 * WORLD_SCALE, 4000 * WORLD_SCALE);
    this.camera = camera;

    const controls = new OrbitControls(camera, this.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.75;
    controls.panSpeed = 0.6;
    controls.screenSpacePanning = false;
    controls.enablePan = true;
    controls.minDistance = 90 * WORLD_SCALE;
    controls.maxDistance = 24000 * WORLD_SCALE;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.5;
    controls.target.set(0, 500 * WORLD_SCALE, 0);
    controls.update();
    this.controls = controls;

    // Rev21: the room photograph is the whole light rig. It must resolve before
    // the columns are built (init is awaited by boot, which does not report
    // ready until it returns).
    await this.buildEnvironment();

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

    this.overlayGroup = new THREE.Group();
    this.overlayGroup.name = 'studio-overlays';
    scene.add(this.overlayGroup);

    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: srgbColor(GHOST.color),
      toneMapped: false
    });

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
    // Rev21: the 27 column materials only exist now. Apply the room intensity
    // (diffuse groups) and the mirror radiance gains (plaster/satin read the
    // same `scene.environment`; there is no CubeCamera capture any more).
    if (this.room) this.room.refresh(this.scene);
    this.applyMirrorGains();
  }

  /**
   * Rev21: record the plaster/satin materials and give them their mirror
   * radiance gain. `factor` is the QA intensity knob (1 = the tuned page value).
   */
  applyMirrorGains(factor) {
    for (const column of this.columns) {
      const spec = column && column.spec;
      const material = column && (column.material || (column.mesh ? column.mesh.material : null));
      if (!spec || !material) continue;
      if (spec.material === 'plaster') this.plasterMaterial = material;
      else if (spec.material === 'satin') this.satinMaterial = material;
      else if (spec.material === 'reeded-metal') {
        this.reededMaterial = material;
        if (column.topPlate && column.topPlate.material) this.reededTopMaterial = column.topPlate.material;
      }
    }
    const scale = clamp(factor === undefined ? 1 : Number(factor) || 1, 0.25, 2);
    if (this.plasterMaterial) this.plasterMaterial.envMapIntensity = MIRROR.plaster.envIntensity * scale;
    if (this.satinMaterial) this.satinMaterial.envMapIntensity = MIRROR.satin.envIntensity * scale;
    if (this.reededMaterial) this.reededMaterial.envMapIntensity = MIRROR['reeded-metal'].envIntensity * scale;
    if (this.reededTopMaterial) this.reededTopMaterial.envMapIntensity = MIRROR['reeded-metal'].topEnvIntensity * scale;
    for (const id of ['grain-metal', 'titanium']) {
      const column = this.columns.find((entry) => entry && entry.spec && entry.spec.material === id);
      const material = column && (column.material || (column.mesh ? column.mesh.material : null));
      if (material) material.envMapIntensity = MIRROR[id].envIntensity * scale;
    }
    this.requestRender();
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
    plane.position.set(bed.centreX, 0.26 * WORLD_SCALE, bed.centreZ);
    plane.renderOrder = 2;
    plane.name = 'studio-contact-shadows';
    this.scene.add(plane);
    this.contactPlane = plane;
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
      // Rev 5 s32: the separate reeded top plate follows the column's ghost state.
      if (column.topPlate) column.topPlate.visible = !ghost;
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

  /**
   * Rev21: attach the shared room-photo environment (./env-room.js) as the only
   * light. `intensity` (optional) lets QA retune the exposure of the IBL, i.e.
   * it re-applies the per-material envMapIntensity multiplier on r151.
   */
  async buildEnvironment(intensity) {
    if (this.room) {
      try { this.room.dispose(); } catch (error) { /* best effort */ }
      this.room = null;
    }
    this.room = await applyEnvRoom(THREE, this.renderer, this.scene, {
      intensity: intensity === undefined ? ROOM.intensity : intensity
    });
    this.requestRender();
    return this.room;
  }

  /**
   * QA/knob hook: scale the room's IBL multiplier without rebuilding it.
   * `scale` multiplies ROOM.intensity (clamped 0.25-2 so the page cannot be
   * washed out or killed). The plaster/satin mirrors sample the same
   * `scene.environment` with their own radiance gain, so they scale with it.
   */
  setEnvIntensity(scale) {
    if (!this.room) return null;
    const factor = clamp(Number(scale) || 0, 0.25, 2);
    this.room.setIntensity(ROOM.intensity * factor, this.scene);
    this.applyMirrorGains(factor);
    this.requestRender();
    return this.room.intensity;
  }

  effectivePixelRatio() {
    return Math.min((window.devicePixelRatio || 1) * this.renderScale, RENDERER.maxPixelRatio);
  }

  /** s47: set the supersampling factor (also locks the adaptive governor off: explicit = QA/user choice). */
  setRenderScale(scale, fromAdaptive) {
    if (!this.renderer) return null;
    this.renderScale = clamp(Number(scale) || 1, 0.5, 4);
    if (!fromAdaptive) this.adaptive = false;
    this.renderer.setPixelRatio(this.effectivePixelRatio());
    this.renderer.setSize(this.stageBox.width || 1, this.stageBox.height || 1, false);
    this.requestRender();
    return this.renderScale;
  }

  /** s47 QA: free camera pose (bypasses controls min/max distance + target clamp until the next normal framing). */
  setQaCamera(position, target) {
    if (!this.controls) return false;
    if (!this.qaCamera) {
      this.qaSaved = {
        minDistance: this.controls.minDistance,
        maxDistance: this.controls.maxDistance,
        maxPolarAngle: this.controls.maxPolarAngle
      };
    }
    this.qaCamera = true;
    this.cameraGoal = null;
    this.controls.minDistance = 0;
    this.controls.maxDistance = Infinity;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.target.set(target[0], target[1], target[2]);
    this.camera.position.set(position[0], position[1], position[2]);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.requestRender();
    return true;
  }

  endQaCamera() {
    if (!this.qaCamera || !this.controls) return;
    this.qaCamera = false;
    if (this.qaSaved) {
      this.controls.minDistance = this.qaSaved.minDistance;
      this.controls.maxDistance = this.qaSaved.maxDistance;
      this.controls.maxPolarAngle = this.qaSaved.maxPolarAngle;
    }
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
    if (this.bounds && !this.qaCamera) this.frameCurrentView(true);
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
    let high = 2000 * WORLD_SCALE;
    let guard = 0;
    while (!test(high) && guard < 14) {
      high *= 2;
      guard += 1;
    }
    if (guard >= 14) return high;
    for (let index = 0; index < 45; index += 1) {
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
    this.endQaCamera();
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
      this.governRenderScale(dt);
      this.step(dt);
      this.renderNow();
      this.frameCount += 1;
    };
    this.raf = window.requestAnimationFrame(tick);
  }

  /** s47 adaptive governor: sustained slow frames (mean > slowMs over adaptWindow) -> one drop to fallbackScale. */
  governRenderScale(dt) {
    if (!this.adaptive || this.frozen || this.renderScale <= RENDERER.fallbackScale) return;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length < RENDERER.adaptWindow) return;
    const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (mean > RENDERER.slowMs) {
      this.setRenderScale(RENDERER.fallbackScale, true);
      this.adaptive = false;
    }
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
    if (!this.controls || this.qaCamera) return;
    const target = this.controls.target;
    const bounds = this.bounds || LOCAL_BOUNDS;
    const minX = bounds.min.x - 300 * WORLD_SCALE;
    const maxX = bounds.max.x + 300 * WORLD_SCALE;
    const minZ = bounds.min.z - 300 * WORLD_SCALE;
    const maxZ = bounds.max.z + 300 * WORLD_SCALE;
    const clampedX = clamp(target.x, minX, maxX);
    const clampedY = clamp(target.y, 0, bounds.max.y + 200 * WORLD_SCALE);
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
    // directly under the stage carries the Plaster / Reeded Metal / Satin names.
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
      const x = (groupIndex - (MATERIALS.length - 1) / 2) * GROUP_SPACING + (bounds.min.x + bounds.max.x) / 2;
      const anchor = new THREE.Vector3(x, bounds.max.y + 60 * WORLD_SCALE, 0);
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
    if (this.room) {
      try { this.room.dispose(); } catch (error) { /* best effort */ }
      this.room = null;
    }
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
    ? 'The interactive preview could not start. The 45 long cuboids, their material groups and their exact dimensions are listed below.'
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
        // plaster is perfectly smooth, reeded-metal grain is albedo colour noise,
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
    if (!material.sourceImage) continue; // Rev19: procedural groups are not asset files
    const textures = bank.textures[material.id];
    if (!textures) continue;
    for (const channel of ['albedo', 'normal', 'roughness', 'metalness', 'ao', 'height']) {
      if (textures[channel]) loaded += 1;
    }
  }
  // s48: per-texture size + estimated GPU MB (RGBA8 + full mip chain) and procedural gen time.
  const maps = [];
  let mb = 0;
  for (const [materialId, set] of Object.entries(bank.textures)) {
    for (const [channel, tex] of Object.entries(set || {})) {
      if (!tex) continue;
      const img = tex.image || {};
      const w = img.width || (tex.userData && tex.userData.width) || 0;
      const h = img.height || (tex.userData && tex.userData.height) || 0;
      const size = (w * h * 4 * 4) / 3 / (1024 * 1024);
      mb += size;
      maps.push({ id: materialId, ch: channel, w, h, mb: +size.toFixed(1), genMs: tex.userData && tex.userData.genMs });
    }
  }
  return { loaded: loaded, total: 18, totalMB: +mb.toFixed(1), maps };
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
 * Rev21 QA: describe the plaster mirror SURFACE wiring from the real material.
 * The expected state is the clean flat mirror: no normalMap (sample-able), a
 * [0, 0] normalScale, no roughnessMap and the constant 0.092 roughness, while
 * the reflective response comes from the shared room-photo PMREM
 * (`scene.environment`, radiance gain MIRROR.plaster.envIntensity) -- there is
 * no CubeCamera capture and no reflection-only emitter panel. Nothing animates.
 */
function plasterSurfaceDebug() {
  const plasterMaterial = state.bank && state.bank.materials ? state.bank.materials.plaster : null;
  const data = plasterMaterial && plasterMaterial.userData ? plasterMaterial.userData : null;
  const params = data && data.params ? data.params : null;
  const normalScale = plasterMaterial && plasterMaterial.normalScale ? plasterMaterial.normalScale : null;
  return {
    normalMap: Boolean(plasterMaterial && plasterMaterial.normalMap),
    normalScale: normalScale ? [round(normalScale.x, 3), round(normalScale.y, 3)] : null,
    roughnessMap: Boolean(plasterMaterial && plasterMaterial.roughnessMap),
    roughness: params ? round(params.roughnessEffective, 4) : null,
    mirrorEnvMap: Boolean(plasterMaterial && plasterMaterial.envMap),
    envMap: 'scene.environment',
    envMapIntensity: plasterMaterial ? round(plasterMaterial.envMapIntensity, 3) : null,
    accents: 0,
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
        // Rev 9 rounded box: radius in source px (large 2.8 / medium 1.6 / small 1)
        // and the bevel segment count baked into the geometry.
        cornerRadius: geometryData && Number.isFinite(geometryData.cornerRadius) ? geometryData.cornerRadius : null,
        bevelSegments: geometryData && Number.isFinite(geometryData.bevelSegments) ? geometryData.bevelSegments : null,
        roundedBox: Boolean(geometryData && geometryData.roundedBox)
      };
    }),
    textures: textureInfo,
    // Rev21: there are zero THREE lights in the scene -- the only light is the
    // shared room photograph, PMREM-filtered by ./env-room.js.
    lights: {
      count: 0,
      environment: ROOM.label,
      intensity: studio && studio.room ? round(studio.room.intensity, 3) : null,
      sceneEnvironment: Boolean(studio && studio.scene && studio.scene.environment)
    },
    worldScale: WORLD_SCALE,
    renderer: {
      antialias: true,
      dpr: window.devicePixelRatio || 1,
      pixelRatio: studio && studio.renderer ? round(studio.renderer.getPixelRatio(), 3) : 1,
      renderScale: studio ? studio.renderScale : null,
      adaptive: studio ? studio.adaptive : null,
      canvas: studio && studio.canvas ? { width: studio.canvas.width, height: studio.canvas.height, cssWidth: studio.canvas.clientWidth, cssHeight: studio.canvas.clientHeight } : null,
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
    // Rev21: satin mirror -- no CubeCamera capture and no reflection-only
    // emitter panels; the satin reads the shared room-photo PMREM directly.
    reflection: {
      captured: false,
      cubeSize: 0,
      layer: 0,
      accents: 0,
      envMap: 'scene.environment',
      envMapIntensity: studio && studio.satinMaterial ? round(studio.satinMaterial.envMapIntensity, 3) : null,
      envIntensityBand: MIRROR.satin.envIntensityBand.slice(),
      center: null
    },
    // Rev21: plaster mirror -- same wiring as satin (shared env, no capture).
    // The rev-7 liquid-flow state stays reported as the disabled `liquid` stub.
    plasterMirror: {
      captured: false,
      cubeSize: 0,
      layer: 0,
      accents: 0,
      envMap: 'scene.environment',
      envMapIntensity: studio && studio.plasterMaterial ? round(studio.plasterMaterial.envMapIntensity, 3) : null,
      envIntensityBand: MIRROR.plaster.envIntensityBand.slice(),
      center: null
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
  },
  /** Rev21 env knob: scale the room-photo IBL (1 = the page's tuned value). */
  setEnvIntensity(value) {
    if (!state.studio) return null;
    const applied = state.studio.setEnvIntensity(value);
    publishState();
    return applied;
  },
  /** s47 QA: free camera pose {position:[x,y,z], target:[x,y,z]}; bypasses min/max distance; any normal view/reset restores. */
  setCamera(pose) {
    if (!state.studio || !pose || !pose.position || !pose.target) return false;
    const ok = state.studio.setQaCamera(pose.position, pose.target);
    state.studio.renderNow();
    return ok;
  },
  setRenderScale(value) {
    return state.studio ? state.studio.setRenderScale(value) : null;
  },
  getRenderScale() {
    return state.studio ? state.studio.renderScale : null;
  },
  getEnvIntensity() {
    return state.studio && state.studio.room ? state.studio.room.intensity : null;
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
    if (key === '1' || key === '2' || key === '3' || key === '4' || key === '5') {
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
    showFallback('WebGL is not available in this browser, so the interactive columns cannot be rendered. The 45 columns and their exact dimensions are listed below.');
    resolveReady(false);
    return;
  }

  curtainProgress(0.05, 'Loading 3D engine', '');
  let modelModule = null;
  try {
    modelModule = await import(MODEL_URL.href);
  } catch (error) {
    showFallback('The columns model module could not be loaded (' + errorMessage(error) + '). The 45 columns and their exact dimensions are listed below.', { error: error, banner: true });
    resolveReady(false);
    return;
  }
  const validation = validateModelModule(modelModule);
  if (!validation.ok) {
    showFallback(validation.message + ' The 45 columns and their exact dimensions are listed below.', { banner: true });
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
    showFallback('The material maps could not be loaded (' + errorMessage(error) + '). The 45 columns and their exact dimensions are listed below.', { error: error, banner: true });
    resolveReady(false);
    return;
  }
  state.bank = bank;

  curtainProgress(0.74, 'Building the 45 columns', '');
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
    if (!created || !created.group || !Array.isArray(created.columns) || created.columns.length !== 45) {
      throw new Error('createColumns() did not return the expected 45-column scene graph.');
    }
    state.studio.attachColumns(created, state.specs, state.bounds);
    // Rev21: no CubeCamera reflection captures and no reflection-only emitter
    // layers -- attachColumns already laid the room intensity + mirror gains on
    // the real materials. Rev 8: the plaster mirror is a static flat surface, so
    // there is no liquid-flow controller either.
    state.studio.spin = state.spin;
    applyUrlCameraState(true);
  } catch (error) {
    if (state.studio) {
      try { state.studio.dispose(); } catch (disposeError) { /* best effort */ }
      state.studio = null;
    }
    showFallback('The column studio could not start (' + errorMessage(error) + '). The 45 columns and their exact dimensions are listed below.', { error: error, banner: true });
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
  if (dom.infoFootState) dom.infoFootState.textContent = '45 / 45 ready';
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
    showFallback('The preview failed to start (' + errorMessage(error) + '). The 45 columns and their exact dimensions are listed below.', { error: error, banner: true });
  }
  resolveReady(false);
});

state.watchdog = window.setTimeout(() => {
  if (!state.ready && !state.failed) {
    showFallback('The interactive preview did not start within 20 seconds. The 45 columns and their exact dimensions are listed below.', { banner: true });
    resolveReady(false);
  }
}, 20000);

window.setInterval(() => {
  if (state.failed) return;
  publishState();
}, 500);


