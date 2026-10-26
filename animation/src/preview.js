/**
 * tekoanimation — preview page controller.
 *
 * Revision 6: seven currencies (GBP, EUR, CNY, USD, VND, PHP, THB). Both coin
 * faces carry the identical engraved Lexend symbol ("a"/"b" are only the two
 * sides of the 3D coin) on a satin + twill silver surface with a reeded middle
 * frame; the relief glyph is lit by the environment (no painted outline).
 * Boots the silver studio scene, wires the UI, mirrors state into the QA hooks
 * (SPEC 5.3) and degrades to a static asset list when WebGL or the three.js
 * module cannot start.
 *
 * Round task "coin-stack-unfold" (2026-10-26, later the same day):
 *  - Stack mode is reworked: the nine coins start as a TIGHT flush tower and
 *    slowly UNFOLD (bottom-up gaps, eased) to a final air gap of
 *    STACK.finalGap world units, chosen so the rendered spacing is 50 CSS px;
 *    once on viewport entry, Replay restarts it, and capture/reduced-motion
 *    modes show the deterministic unfolded final. See docs/coin-stack-unfold.md.
 *  - The drag view is a free quaternion trackball / 360° rotation (no Euler
 *    clamps; roll via Shift-drag or a two-finger twist) — see scene.js and
 *    trackball.js.
 *  - Flip stays removed from the visible page (no button, Space/click gesture
 *    or hint). The model keeps two identical faces; `?face=b` and the QA
 *    `setFace()` stay for verification only.
 */
import * as THREE from 'three';
import { RING, STACK, COIN_GEOMETRY, stackPose } from './coin-compositions.js';

const VERSION = '1.0.0';

// The coin model is the modeler's deliverable (SPEC section 4). The import is
// dynamic on purpose: a missing/broken module must degrade gracefully.
const MODEL_URL = new URL('./coin-model.js', import.meta.url);

// Local fallback registry — only used when ./coin-model.js cannot be imported.
const FALLBACK_SPECS = Object.freeze([
  { id: 'gbp', code: 'GBP', name: 'British Pound', region: 'United Kingdom', flag: 'gb.svg', glyph: '£' },
  { id: 'eur', code: 'EUR', name: 'Euro', region: 'European Union', flag: 'eu.svg', glyph: '€' },
  { id: 'cny', code: 'CNY', name: 'Chinese Yuan', region: 'China', flag: 'cn.svg', glyph: '¥' },
  { id: 'usd', code: 'USD', name: 'US Dollar', region: 'United States', flag: 'us.svg', glyph: '$' },
  { id: 'vnd', code: 'VND', name: 'Vietnamese Dong', region: 'Vietnam', flag: 'vn.svg', glyph: '₫' },
  { id: 'php', code: 'PHP', name: 'Philippine Peso', region: 'Philippines', flag: 'ph.svg', glyph: '₱' },
  { id: 'thb', code: 'THB', name: 'Thai Baht', region: 'Thailand', flag: 'th.svg', glyph: '฿' },
]);

/** Revision 6: source files shown in the info card (face surface reference + symbol font). */
const SOURCE_ASSETS = Object.freeze({ surface: 'satin.png', font: 'Lexend-Variable.ttf' });

/**
 * Ring + Stack compositions live in the pure-math `./coin-compositions.js`
 * module (no three.js import): RING.entries carries each coin's centre
 * position and orientation (coin model +Y is the face normal), STACK carries
 * the tight/unfold layout, timing and `stackPose(seconds)`. The controller only
 * applies those transforms to the studio rig and frames the result, so the
 * geometry can be verified offline (tools/verify-compositions.mjs).
 *
 * COIN_SPECS ships seven currencies; the eight ring positions reuse GBP on the
 * opposite side (the reference's ring-of-eight), and the stack's top coin is
 * STACK.topId (GBP) because the seven-currency catalog has no RUB.
 */
const MODES = Object.freeze(['hero', 'gallery', 'ring', 'stack']);

/** Revision 3: faces are "a"/"b"; legacy flag/symbol are accepted for compatibility. */
function normalizeFace(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'a' || key === 'flag') return 'a';
  if (key === 'b' || key === 'symbol') return 'b';
  return null;
}

const qa = (window.__TEKO_QA = window.__TEKO_QA || { errors: [], warnings: [], webgl: null });
const qaErrors = qa.errors;
const qaWarnings = qa.warnings;

const dom = {
  body: document.body,
  stage: document.getElementById('stage'),
  canvas: document.getElementById('stage-canvas'),
  galleryLabels: document.getElementById('gallery-labels'),
  stageEyebrow: document.getElementById('stage-eyebrow-text'),
  stageIndex: document.getElementById('stage-index'),
  stageIndexTotal: document.getElementById('stage-index-total'),
  stageCode: document.getElementById('stage-code'),
  stageName: document.getElementById('stage-name'),
  btnSpin: document.getElementById('btn-spin'),
  btnGallery: document.getElementById('btn-gallery'),
  btnRing: document.getElementById('btn-ring'),
  btnStack: document.getElementById('btn-stack'),
  btnReplay: document.getElementById('btn-replay'),
  stageHint: document.getElementById('stage-hint'),
  rail: document.getElementById('currency-rail'),
  infoIndex: document.getElementById('info-index'),
  infoName: document.getElementById('info-name'),
  infoRegion: document.getElementById('info-region'),
  infoGlyph: document.getElementById('info-glyph'),
  infoCode: document.getElementById('info-code'),
  infoSymbol: document.getElementById('info-symbol'),
  assetTags: document.getElementById('asset-tags'),
  assetNote: document.getElementById('asset-note'),
  infoFootState: document.getElementById('info-foot-state'),
  footerStatus: document.getElementById('footer-status'),
  curtain: document.getElementById('loading'),
  loadingBar: document.getElementById('loading-bar'),
  loadingLabel: document.getElementById('loading-label'),
  loadingCount: document.getElementById('loading-count'),
  errorBanner: document.getElementById('error-banner'),
  errorText: document.getElementById('error-text'),
  fallback: document.getElementById('fallback'),
  fallbackMessage: document.getElementById('fallback-message'),
  fallbackGrid: document.getElementById('fallback-grid'),
  diag: document.getElementById('qa-diag'),
  veilText: document.getElementById('veil-text'),
};

const urlParams = new URLSearchParams(window.location.search);
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function parseMode(value) {
  return MODES.includes(value) ? value : 'hero';
}

const state = {
  ready: false,
  failed: false,
  specs: [],
  bank: null,
  studio: null,
  coin: '',
  face: 'a',
  mode: parseMode(urlParams.get('mode')),
  spin: false,
  shot: urlParams.get('shot') === '1' || urlParams.get('still') === '1',
  still: urlParams.get('still') === '1',
  tilt: urlParams.get('tilt') === '1',
  reducedMotion: reducedMotionQuery.matches,
  heroCoin: null,
  galleryCoins: [],
  ringGroup: null,
  ringEntries: [],
  ringCamera: null,
  labels: new Map(),
  busy: false,
  booting: true,
  /** Stack composition (round task). No Math.random — layout is deterministic. */
  stack: {
    group: null,
    entries: [],
    pose: null,
    state: 'idle',
    progress: 0,
    elapsed: 0,
    playing: false,
    playedOnce: false,
    autoplay: urlParams.get('play') !== '0',
    observer: null,
    frameHook: null,
    camera: null,
    topId: STACK.topId,
    duration: STACK.timing.duration,
  },
};

/* ------------------------------------------------------------------ utils */

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const escapeAttr = escapeHtml;
const basename = (value) => String(value || '').split(/[\\/]/).pop();
const tick = (ms = 0) => new Promise((resolve) => window.setTimeout(resolve, ms));
const unique = (items) => Array.from(new Set(items.filter(Boolean)));

/** Rail icons (country/region flags) used by the currency chips and fallback cards. */
const RAIL_FLAGS = Object.freeze({
  gbp: 'gb.svg',
  eur: 'eu.svg',
  cny: 'cn.svg',
  usd: 'us.svg',
  vnd: 'vn.svg',
  php: 'ph.svg',
  thb: 'th.svg',
});

function flagFileName(spec) {
  const raw = String((spec && (spec.flag || RAIL_FLAGS[spec.id])) || '').trim();
  if (!raw) return '';
  const file = basename(raw);
  return /\.svg$/i.test(file) ? file : file + '.svg';
}

function errorMessage(error) {
  if (!error) return 'Unknown error';
  const message = error.message ? String(error.message) : String(error);
  return message.length > 240 ? message.slice(0, 237) + '...' : message;
}

function specById(id) {
  return state.specs.find((spec) => spec.id === id) || null;
}

function pushError(message) {
  qaErrors.push('preview: ' + message);
  if (qaErrors.length > 60) qaErrors.splice(0, qaErrors.length - 60);
}

/* --------------------------------------------------------------- progress */

function curtainProgress(ratio, label, count) {
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  dom.loadingBar.style.width = (safeRatio * 100).toFixed(1) + '%';
  if (label) dom.loadingLabel.textContent = label;
  if (count !== undefined) dom.loadingCount.textContent = count;
}

function hideCurtain() {
  dom.curtain.classList.add('is-hidden');
  dom.curtain.setAttribute('aria-hidden', 'true');
  if (state.shot) {
    dom.curtain.hidden = true;
    return;
  }
  window.setTimeout(() => {
    dom.curtain.hidden = true;
  }, 700);
}

function setBusy(busy, text) {
  state.busy = Boolean(busy);
  dom.stage.classList.toggle('is-busy', state.busy && state.ready);
  if (text) dom.veilText.textContent = text;
}

/* -------------------------------------------------------------------- UI */

function buildRail() {
  dom.rail.innerHTML = '';
  for (const spec of state.specs) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.coin = spec.id;
    chip.setAttribute('aria-pressed', 'false');
    chip.setAttribute('aria-label', spec.code + ' — ' + spec.name);
    chip.innerHTML =
      '<img class="chip-flag" src="./assets/flags/' + escapeAttr(flagFileName(spec)) + '" alt="" width="28" height="28" draggable="false">' +
      '<span class="chip-code">' + escapeHtml(spec.code) + '</span>';
    chip.addEventListener('click', () => {
      runExclusive(async () => {
        await selectCoin(spec.id);
        if (state.mode === 'gallery' && state.studio) state.studio.setSelection(state.coin);
      });
    });
    dom.rail.appendChild(chip);
  }
  syncChips();
}

function syncChips() {
  for (const chip of dom.rail.querySelectorAll('.chip')) {
    const active = chip.dataset.coin === state.coin;
    chip.setAttribute('aria-pressed', String(active));
    if (active) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function syncCoinUi(spec, { updatePanel = true } = {}) {
  if (!spec) return;
  const list = state.specs.length ? state.specs : FALLBACK_SPECS;
  const total = String(list.length).padStart(2, '0');
  const index = String(list.findIndex((item) => item.id === spec.id) + 1).padStart(2, '0');
  dom.stageIndex.textContent = index;
  if (dom.stageIndexTotal) dom.stageIndexTotal.textContent = total;
  dom.stageCode.textContent = spec.code;
  dom.stageName.textContent = spec.name;
  dom.infoIndex.textContent = index + ' / ' + total;
  if (!updatePanel) return;
  dom.infoName.textContent = spec.name;
  dom.infoRegion.textContent = spec.region;
  dom.infoGlyph.textContent = spec.glyph;
  dom.infoCode.textContent = spec.code;
  dom.infoSymbol.textContent = spec.glyph;
  dom.assetTags.innerHTML =
    '<span class="asset-tag asset-tag--surface">' + SOURCE_ASSETS.surface + '</span>' +
    '<span class="asset-tag asset-tag--font">' + SOURCE_ASSETS.font + '</span>';
  dom.assetNote.textContent = SOURCE_ASSETS.surface + ' + ' + SOURCE_ASSETS.font;
  // Composition modes keep their own stage caption; the info card may still show
  // the currency selected with the rail / arrow keys.
  if (state.mode === 'ring' || state.mode === 'stack') applyCompositionCaption();
}

function applyCompositionCaption() {
  if (state.mode === 'ring') {
    dom.stageIndex.textContent = String(RING.count).padStart(2, '0');
    if (dom.stageIndexTotal) dom.stageIndexTotal.textContent = String(RING.count).padStart(2, '0');
    dom.stageCode.textContent = 'RING';
    dom.stageName.textContent = 'Eight coins';
  } else if (state.mode === 'stack') {
    const total = String(STACK.count).padStart(2, '0');
    dom.stageIndex.textContent = total;
    if (dom.stageIndexTotal) dom.stageIndexTotal.textContent = total;
    dom.stageCode.textContent = 'STACK';
    dom.stageName.textContent = STACK.count === 9 ? 'Nine coins' : STACK.count + ' coins';
  }
}

function syncFaceUi() {
  // Both faces carry the identical symbol; a/b are only the two sides.
  dom.body.dataset.face = state.face;
}

const DEFAULT_HINT = 'Drag to rotate 360° · Shift-drag to roll · double-click to reset';

function syncSpinUi() {
  const composition = state.mode === 'ring' || state.mode === 'stack';
  dom.btnSpin.setAttribute('aria-pressed', String(state.spin && !composition));
  const unavailable = state.reducedMotion || composition;
  dom.btnSpin.disabled = unavailable;
  if (state.reducedMotion) dom.btnSpin.title = 'Auto-spin is disabled by the reduced-motion preference.';
  else if (composition) dom.btnSpin.title = 'Auto-spin applies to the Hero and Gallery views.';
  else dom.btnSpin.removeAttribute('title');
}

function syncReplayUi() {
  if (!dom.btnReplay) return;
  const stack = state.mode === 'stack';
  dom.btnReplay.hidden = !stack;
  const blocked = !stack || state.reducedMotion || state.shot || !state.stack.group || state.stack.playing;
  dom.btnReplay.disabled = Boolean(blocked);
  if (!stack) dom.btnReplay.removeAttribute('title');
  else if (state.reducedMotion) dom.btnReplay.title = 'Replay is disabled by the reduced-motion preference.';
  else if (state.shot) dom.btnReplay.title = 'Replay is disabled in deterministic capture mode.';
  else if (state.stack.playing) dom.btnReplay.title = 'The stack is unfolding';
  else dom.btnReplay.title = 'Replay the unfold';
}

function syncModeUi() {
  const ring = state.mode === 'ring';
  const gallery = state.mode === 'gallery';
  const stack = state.mode === 'stack';
  dom.body.dataset.mode = state.mode;
  dom.btnGallery.setAttribute('aria-pressed', String(gallery));
  if (dom.btnRing) dom.btnRing.setAttribute('aria-pressed', String(ring));
  if (dom.btnStack) dom.btnStack.setAttribute('aria-pressed', String(stack));
  dom.stageEyebrow.textContent = stack
    ? 'Stack · ' + STACK.count + ' coins'
    : ring
      ? 'Ring · eight coins'
      : gallery
        ? 'Gallery · seven coins'
        : 'Silver studio';
  dom.infoFootState.textContent = stack ? 'Stack' : ring ? 'Ring' : gallery ? 'Gallery' : 'Hero';
  dom.galleryLabels.hidden = !gallery;
  if (dom.stageHint) {
    if (stack) {
      const unfolded = state.stack.state === 'unfolded';
      dom.stageHint.textContent =
        state.stack.playing
          ? 'Unfolding coins…'
          : state.reducedMotion || state.shot
            ? 'Drag to rotate 360° · Shift-drag to roll'
            : unfolded
              ? 'Drag to rotate · Replay to unfold again'
              : 'Drag to rotate · Replay to unfold';
    } else if (ring) {
      dom.stageHint.textContent = 'Drag to rotate · Y for hero';
    } else if (gallery) {
      dom.stageHint.textContent = 'Click a coin to open it';
    } else {
      dom.stageHint.textContent = DEFAULT_HINT;
    }
  }
  if (ring || stack) applyCompositionCaption();
  else {
    const spec = specById(state.coin);
    if (spec) syncCoinUi(spec, { updatePanel: false });
  }
  syncSpinUi();
  syncReplayUi();
  if (state.ready) dom.footerStatus.textContent = stack ? 'Stack' : ring ? 'Ring' : gallery ? 'Gallery' : 'Ready';
}

function syncShotUi() {
  if (state.shot) dom.body.dataset.shot = '1';
  if (state.still) dom.body.dataset.still = '1';
  if (state.tilt) dom.body.dataset.tilt = '1';
}

function refreshScene() {
  if (state.studio) state.studio.renderNow();
  updateDiag();
}

/* ------------------------------------------------------------------ debug */

function buildAssetsInfo() {
  const specs = state.specs.length ? state.specs : FALLBACK_SPECS;
  return {
    flags: unique(specs.map(flagFileName)),
    textures: [SOURCE_ASSETS.surface],
    fonts: [SOURCE_ASSETS.font],
  };
}

function buildDebug() {
  const stats = state.studio ? state.studio.getStats() : { textures: 0, drawCalls: 0, triangles: 0, fps: 0 };
  let resources = [];
  try {
    resources = performance.getEntriesByType('resource').map((entry) => entry.name);
  } catch (error) {
    resources = [];
  }
  let stageRect = null;
  try {
    const stageEl = document.getElementById('stage');
    if (stageEl) {
      const rect = stageEl.getBoundingClientRect();
      stageRect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      };
    }
  } catch (error) {
    stageRect = null;
  }
  let coinScreen = null;
  try {
    coinScreen = state.studio && state.studio.getCoinScreen ? state.studio.getCoinScreen() : null;
  } catch (error) {
    coinScreen = null;
  }
  let ring = null;
  let stack = null;
  let framing = null;
  try {
    ring = buildRingDebug();
    stack = buildStackDebug();
    const active = ring || stack;
    framing =
      active && active.framing
        ? Object.assign({}, active.framing, {
            aspect: state.studio && state.studio.camera ? Math.round(state.studio.camera.aspect * 1000) / 1000 : null,
          })
        : null;
  } catch (error) {
    ring = null;
    stack = null;
    framing = null;
  }
  return {
    ready: state.ready,
    webgl: state.studio ? state.studio.getWebGLInfo() : qa.webgl || null,
    coin: state.coin || '',
    face: state.face,
    mode: state.mode,
    coins: (state.specs.length ? state.specs : FALLBACK_SPECS).map((spec) => spec.id),
    errors: qaErrors.slice(),
    warnings: qaWarnings.slice(),
    textures: Math.round(stats.textures || 0),
    drawCalls: Math.round(stats.drawCalls || 0),
    triangles: Math.round(stats.triangles || 0),
    fps: Math.round(stats.fps || 0),
    resources,
    assets: buildAssetsInfo(),
    stageRect,
    coinScreen,
    ring,
    stack,
    framing,
    still: state.still,
    view: state.studio && state.studio.getView ? state.studio.getView() : { yaw: 0, pitch: 0, roll: 0, dragging: false },
  };
}

function updateDiag() {
  if (state.studio) qa.webgl = state.studio.getWebGLInfo();
  const debug = buildDebug();
  dom.diag.textContent = JSON.stringify(debug);
  dom.body.dataset.qaReady = debug.ready ? '1' : '0';
  dom.body.dataset.qaErrors = String(debug.errors.length);
  dom.body.dataset.coin = debug.coin;
  dom.body.dataset.face = debug.face;
  dom.body.dataset.mode = debug.mode;
  if (debug.mode === 'ring') {
    dom.body.dataset.ring = '1';
    dom.body.dataset.ringCount = String(state.ringEntries.length);
    if (state.ringEntries.length) {
      dom.body.dataset.ringIds = state.ringEntries.map((entry) => entry.id).join(',');
    }
  } else {
    delete dom.body.dataset.ring;
    delete dom.body.dataset.ringCount;
    delete dom.body.dataset.ringIds;
  }
  if (debug.mode === 'stack' && debug.stack) {
    dom.body.dataset.stack = '1';
    dom.body.dataset.stackState = debug.stack.state;
    dom.body.dataset.stackCount = String(debug.stack.count);
    dom.body.dataset.stackTop = debug.stack.topId || '';
    dom.body.dataset.stackProgress = String(debug.stack.progress);
    dom.body.dataset.stackSpacing = debug.stack.spacing ? String(debug.stack.spacing.meanPx) : '';
  } else {
    delete dom.body.dataset.stack;
    delete dom.body.dataset.stackState;
    delete dom.body.dataset.stackCount;
    delete dom.body.dataset.stackTop;
    delete dom.body.dataset.stackProgress;
    delete dom.body.dataset.stackSpacing;
  }
}

/* ----------------------------------------------------------- QA API (5.3) */

const api = {
  version: VERSION,
  debug: buildDebug,
  async setCoin(id) {
    const nextId = String(id || '');
    if (!specById(nextId) || state.failed) return false;
    return runExclusive(async () => {
      await selectCoin(nextId);
      refreshScene();
      return true;
    });
  },
  /**
   * QA/internal only: switches which of the two identical coin faces is up.
   * There is deliberately NO user-facing flip control on the page (round task:
   * remove Flip), so this exists purely so both faces stay verifiable — it is
   * not bound to any button, key or gesture.
   */
  async setFace(face) {
    const next = normalizeFace(face);
    if (!next) return false;
    return runExclusive(async () => {
      await setFace(next);
      refreshScene();
      return true;
    });
  },
  async setMode(mode) {
    if (!MODES.includes(mode)) return false;
    return runExclusive(async () => {
      await applyMode(mode);
      refreshScene();
      return true;
    });
  },
  async resetView() {
    if (!state.studio) return false;
    await state.studio.resetView();
    refreshScene();
    return true;
  },
  /** Replays the Stack unfold (no-op unless Stack mode is active). */
  async replayStack() {
    return runExclusive(async () => {
      const ok = playStack();
      refreshScene();
      return ok;
    });
  },
  /**
   * QA helper for the free trackball view. Accepts { quaternion: [x,y,z,w] },
   * { axis: [x,y,z], angle } or the legacy { yaw, pitch, roll } Euler form
   * (radians, 'YXZ'); applies immediately with no angle clamps.
   */
  setView(view) {
    if (!state.studio || typeof state.studio.setView !== 'function') return false;
    state.studio.setView(view || {});
    refreshScene();
    return true;
  },
  setSpin(enabled) {
    state.spin = Boolean(enabled) && !state.reducedMotion && !state.shot;
    if (state.studio) state.studio.setSpin(state.spin);
    syncSpinUi();
    updateDiag();
    return state.spin;
  },
};
window.__tekoAnimation = api;

/* --------------------------------------------------------------- actions */

let exclusiveChain = Promise.resolve();
function runExclusive(task) {
  const result = exclusiveChain.then(task, task);
  exclusiveChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function selectCoin(id) {
  const spec = specById(id);
  if (!spec) return false;
  if (state.mode === 'ring' || state.mode === 'stack') {
    // Composition modes show all coins at once; selection only drives the info
    // card (and the rail highlight).
    state.coin = id;
    syncChips();
    syncCoinUi(spec);
    if (state.studio) state.studio.setSelection(id);
    updateDiag();
    return true;
  }
  if (state.coin === id && (state.mode === 'hero' ? state.heroCoin : state.galleryCoins.length)) {
    syncChips();
    return true;
  }
  state.coin = id;
  syncChips();
  syncCoinUi(spec);
  if (!state.studio) return true;
  state.studio.setSelection(id);
  if (state.mode === 'hero') await buildHeroCoin();
  refreshScene();
  return true;
}

async function setFace(face) {
  const next = normalizeFace(face);
  if (!state.studio || !next) return;
  state.face = next;
  syncFaceUi();
  updateDiag();
  await state.studio.setFace(next);
  updateDiag();
}

async function applyMode(mode) {
  const next = parseMode(mode);
  const built =
    next === 'ring'
      ? Boolean(state.ringGroup)
      : next === 'stack'
        ? Boolean(state.stack.group)
        : next === 'gallery'
          ? state.galleryCoins.length > 0
          : Boolean(state.heroCoin);
  if (state.mode === next && built) {
    syncModeUi();
    return;
  }
  disposeView(next);
  state.mode = next;
  syncModeUi();
  if (!state.studio) {
    updateDiag();
    return;
  }
  if (next === 'ring') {
    await buildRing();
  } else if (next === 'stack') {
    await buildStack();
  } else {
    state.studio.setMode(next);
    if (next === 'gallery') await buildGalleryCoins();
    else await buildHeroCoin();
    if (state.studio) {
      state.studio.setMode(next);
      state.studio.setSelection(state.coin);
      state.studio.renderNow();
    }
  }
  updateDiag();
}

function disposeView(nextMode) {
  if (nextMode !== 'ring') disposeRingView();
  if (nextMode !== 'stack') disposeStackView();
  if (nextMode !== 'gallery' && state.galleryCoins.length) {
    for (const coin of state.galleryCoins) disposeCoin(coin);
    state.galleryCoins = [];
    state.labels = new Map();
    if (state.studio) state.studio.clearGallery();
    dom.galleryLabels.innerHTML = '';
    dom.galleryLabels.hidden = true;
  }
  if (nextMode !== 'hero' && state.heroCoin) {
    if (state.studio) state.studio.clearHeroCoin();
    disposeCoin(state.heroCoin);
    state.heroCoin = null;
  }
}

function disposeCoin(coin) {
  try {
    coin.dispose();
  } catch (error) {
    pushError('coin dispose failed: ' + errorMessage(error));
  }
}

function makeCoin(spec, faceSize) {
  const coin = state.bank.createCoin(spec, { faceSize });
  if (!coin || !coin.group) throw new Error('coin-model returned an invalid coin for ' + spec.id);
  return coin;
}

async function buildHeroCoin() {
  const spec = specById(state.coin);
  if (!spec || !state.bank) return;
  setBusy(true, 'Rendering ' + spec.code + ' coin');
  disposeView('gallery');
  await tick(0);
  try {
    const coin = makeCoin(spec, 1024);
    if (state.heroCoin) {
      if (state.studio) state.studio.clearHeroCoin();
      disposeCoin(state.heroCoin);
      state.heroCoin = null;
    }
    state.heroCoin = coin;
    if (state.studio) {
      state.studio.setHeroCoin(coin);
      state.studio.setFace(state.face, { immediate: !state.ready });
      state.studio.setSpin(state.spin);
      state.studio.renderNow();
      await state.studio.whenStable();
      state.studio.renderNow();
    }
    syncCoinUi(spec);
  } catch (error) {
    pushError('hero build failed: ' + errorMessage(error));
    showErrorBanner('Could not render the ' + (spec ? spec.code : 'selected') + ' coin: ' + errorMessage(error));
    throw error;
  } finally {
    setBusy(false);
  }
  updateDiag();
}

async function buildGalleryCoins() {
  if (!state.bank) return;
  setBusy(true, 'Building gallery');
  disposeView('hero');
  const labels = new Map();
  const coins = [];
  dom.galleryLabels.innerHTML = '';
  dom.galleryLabels.hidden = true;
  if (state.booting) curtainProgress(0, 'Building gallery', '0 / ' + state.specs.length);
  try {
    for (let index = 0; index < state.specs.length; index += 1) {
      const spec = state.specs[index];
      if (state.booting) {
        curtainProgress(index / state.specs.length, 'Building gallery', index + 1 + ' / ' + state.specs.length);
        await tick(0);
      }
      const coin = makeCoin(spec, 512);
      coins.push(coin);
      const label = document.createElement('div');
      label.className = 'gallery-label';
      label.dataset.coin = spec.id;
      label.innerHTML =
        '<span class="gallery-label-code">' + escapeHtml(spec.code) + '</span>' +
        '<span class="gallery-label-name">' + escapeHtml(spec.name) + '</span>';
      dom.galleryLabels.appendChild(label);
      labels.set(spec.id, label);
    }
    state.galleryCoins = coins;
    state.labels = labels;
    if (state.studio) {
      state.studio.setGalleryCoins(coins, labels);
      state.studio.setFace(state.face, { immediate: !state.ready });
      state.studio.setSpin(state.spin);
      state.studio.setSelection(state.coin);
      state.studio.renderNow();
      await state.studio.whenStable();
      state.studio.renderNow();
    }
    dom.galleryLabels.hidden = state.mode !== 'gallery';
  } catch (error) {
    for (const coin of coins) disposeCoin(coin);
    state.galleryCoins = [];
    state.labels = new Map();
    pushError('gallery build failed: ' + errorMessage(error));
    showErrorBanner('Could not render the gallery: ' + errorMessage(error));
    throw error;
  } finally {
    setBusy(false);
  }
  updateDiag();
}

/* ------------------------------------------------- compositions & framing */

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

const RING_FACE_SIZE = RING.camera && RING.camera.faceSize ? RING.camera.faceSize : 384;
const RING_CAM_Y = RING.camera && Number.isFinite(RING.camera.y) ? RING.camera.y : 0.42;
const RING_FIT_MARGIN = RING.camera && RING.camera.fitMargin ? RING.camera.fitMargin : 1.07;
const STACK_ELEVATION =
  STACK.camera && Number.isFinite(STACK.camera.elevationDeg)
    ? THREE.MathUtils.degToRad(STACK.camera.elevationDeg)
    : THREE.MathUtils.degToRad(34);
const STACK_FIT_MARGIN = STACK.camera && STACK.camera.fitMargin ? STACK.camera.fitMargin : 1.1;

/** Eight corners of a Box3, in world space (same shape as Box3.getCorners). */
function boxCorners(box) {
  const corners = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  return corners;
}

/**
 * Deterministic camera-distance fit: binary search the distance along +Z (with a
 * per-distance camera height) so every projected bbox corner stays inside the
 * stage at the requested margin. Pure projection math — no time/rAF dependence,
 * so ?shot=1 / ?still=1 captures are stable.
 */
function fitCameraDistance(corners, aspect, { fitMargin, camYFor, fov = 30 }) {
  const safeAspect = aspect > 0 ? aspect : 1.5;
  const probe = new THREE.PerspectiveCamera(fov, safeAspect, 0.1, 500);
  const projected = new THREE.Vector3();
  const limit = 1 / fitMargin;
  let lo = 0.4;
  let hi = 240;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const mid = (lo + hi) / 2;
    probe.position.set(0, camYFor(mid), mid);
    probe.lookAt(0, 0, 0);
    probe.updateMatrixWorld(true);
    let fits = true;
    for (const corner of corners) {
      projected.copy(corner).project(probe);
      if (Math.abs(projected.x) > limit || Math.abs(projected.y) > limit || projected.z < -1 || projected.z > 1) {
        fits = false;
        break;
      }
    }
    if (fits) hi = mid;
    else lo = mid;
  }
  return hi + 0.02;
}

function studioAspect(studio) {
  return studio && studio.camera && studio.camera.aspect > 0 ? studio.camera.aspect : 1.5;
}

function studioFov(studio) {
  return studio && studio.camera && studio.camera.fov ? studio.camera.fov : 30;
}

/** Zero the free trackball view so entering a composition is deterministic. */
function resetStudioView(studio) {
  if (!studio) return;
  if (typeof studio.resetView === 'function') {
    // scene.js owns the quaternion view; immediate so the first frame is
    // deterministic (the page passes { immediate: true } for captures).
    studio.resetView({ immediate: true });
  } else if (studio.orbit) {
    studio.orbit.rotation.set(0, 0, 0);
    studio.orbit.quaternion.set(0, 0, 0, 1);
  }
  if (studio._view) {
    studio._view.dragging = false;
    studio._view.flinging = false;
  }
}

/**
 * Add a per-frame callback to the studio's animation step. Uses the studio's own
 * addFrameHook() when present (scene.js) and otherwise wraps _update so the page
 * still works with either revision of the scene module.
 */
function installFrameHook(studio, fn) {
  if (!studio) return null;
  if (typeof studio.addFrameHook === 'function') return studio.addFrameHook(fn);
  const base = studio._update.bind(studio);
  let active = true;
  studio._update = function hookedUpdate(dt) {
    base(dt);
    if (!active) return;
    try {
      fn(dt);
    } catch (error) {
      pushError('stack frame hook failed: ' + errorMessage(error));
    }
  };
  return () => {
    active = false;
    studio._update = base;
  };
}

/**
 * The studio computes hero/gallery camera fits on resize and mode switches; the
 * composition framing is additive, so wrap that one method: when the page is in
 * Ring/Stack mode the wrapper re-applies the composition fit after the studio's
 * own fit (a resize while a composition is visible must not fall back to hero).
 */
function installCompositionFraming(studio) {
  if (!studio || studio.__compositionFramingInstalled) return;
  const baseFit = studio._computeFit.bind(studio);
  studio._computeFit = function compositionAwareFit() {
    baseFit();
    if (state.mode === 'ring' && state.ringGroup) applyRingFraming();
    else if (state.mode === 'stack' && state.stack.group) applyStackFraming(state.stack.pose);
  };
  studio.__compositionFramingInstalled = true;
}

/* ---------------------------------------------------------------- ring mode */

async function buildRing() {
  if (!state.bank || !state.studio) return;
  setBusy(true, 'Building ring');
  disposeRingView();
  const studio = state.studio;
  try {
    // Neutral internal mode: the ring has no parallax/spin/hero coin of its own.
    studio.setMode('hero');
    studio.heroRig.visible = false;
    studio.galleryGroup.visible = false;
    studio.shadow.visible = false;
    resetStudioView(studio);
    // Ring coins are not part of the hero/gallery flip/spin lists.
    studio._coinGroups = [];

    const group = new THREE.Group();
    group.name = 'coin-ring';
    const entries = [];
    const layoutEntries = Array.isArray(RING.entries) ? RING.entries : [];
    for (const data of layoutEntries) {
      const spec = specById(data.id);
      if (!spec) continue;
      const coin = makeCoin(spec, RING_FACE_SIZE);
      const holder = new THREE.Group();
      holder.name = 'ring-coin:' + data.index + ':' + spec.id;
      // coin-compositions.js gives the coin centre + the coin-model orientation
      // (model +Y is the face normal); the holder carries both.
      holder.position.fromArray(data.position);
      holder.quaternion.fromArray(data.quaternion);
      coin.group.scale.setScalar(RING.coinScale);
      holder.add(coin.group);
      group.add(holder);
      entries.push({ id: spec.id, index: data.index, coin, holder, layout: data });
    }
    if (!entries.length) throw new Error('no coin specs available for the ring');
    studio.orbit.add(group);
    state.ringGroup = group;
    state.ringEntries = entries;
    if (state.booting) curtainProgress(0.7, 'Building ring', entries.length + ' / ' + layoutEntries.length);
    installCompositionFraming(studio);
    applyRingFraming();
    studio.renderNow();
    await studio.whenStable();
    studio.renderNow();
  } catch (error) {
    for (const entry of state.ringEntries) disposeCoin(entry.coin);
    state.ringEntries = [];
    if (state.ringGroup && state.ringGroup.parent) state.ringGroup.parent.remove(state.ringGroup);
    state.ringGroup = null;
    state.ringCamera = null;
    pushError('ring build failed: ' + errorMessage(error));
    showErrorBanner('Could not render the coin ring: ' + errorMessage(error));
    throw error;
  } finally {
    setBusy(false);
  }
  updateDiag();
}

function disposeRingView() {
  const studio = state.studio;
  if (!state.ringGroup) return;
  if (state.ringGroup.parent) state.ringGroup.parent.remove(state.ringGroup);
  for (const entry of state.ringEntries) disposeCoin(entry.coin);
  state.ringGroup = null;
  state.ringEntries = [];
  state.ringCamera = null;
  if (studio) {
    if (studio.heroRig) studio.heroRig.visible = true;
    if (studio.shadow) studio.shadow.visible = true;
    if (typeof studio._computeFit === 'function') studio._computeFit();
    studio.renderNow();
  }
}

function ringBox() {
  const group = state.ringGroup;
  if (!group) return null;
  group.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(group);
  return box.isEmpty() ? null : box;
}

function computeRingDistance(studio) {
  const box = ringBox();
  if (!studio || !box) return null;
  return fitCameraDistance(boxCorners(box), studioAspect(studio), {
    fitMargin: RING_FIT_MARGIN,
    camYFor: () => RING_CAM_Y,
    fov: studioFov(studio),
  });
}

/** Push the computed ring framing into the studio camera rig. */
function applyRingFraming() {
  const studio = state.studio;
  if (!studio || !state.ringGroup) return;
  const distance = computeRingDistance(studio);
  if (!distance) return;
  studio._camTarget = distance;
  studio._camY = RING_CAM_Y;
  state.ringCamera = { distance: round3(distance), camY: RING_CAM_Y, fitMargin: RING_FIT_MARGIN };
  // Capture modes must be deterministic on the first rendered frame.
  if (studio.shot || studio.reducedMotion) studio._camDist = distance;
  studio.camera.position.set(0, RING_CAM_Y, studio._camDist);
  studio.camera.lookAt(0, 0, 0);
  studio.camera.updateMatrixWorld(true);
  if (studio.glow) studio.glow.scale.setScalar(1.5);
}

function buildRingDebug() {
  if (state.mode !== 'ring' || !state.ringGroup) return null;
  return {
    count: state.ringEntries.length,
    ids: state.ringEntries.map((entry) => entry.id),
    radius: RING.radius,
    coinScale: RING.coinScale,
    layout: RING.layout || 'shingled-rosette',
    metrics: RING.metrics || null,
    camera: RING.camera || null,
    screen: ringScreenBounds(),
    framing: state.ringCamera
      ? { cameraDistance: state.ringCamera.distance, cameraY: state.ringCamera.camY, fitMargin: state.ringCamera.fitMargin }
      : null,
  };
}

/* --------------------------------------------------------------- stack mode */

function stackPoseAt(seconds) {
  try {
    return stackPose(seconds);
  } catch (error) {
    pushError('stack pose failed: ' + errorMessage(error));
    return null;
  }
}

/** World bounding box of the stack at a pose (height/bottom come from the layout). */
function stackBox(pose) {
  const radius = COIN_GEOMETRY.radius;
  const fallbackHeight = STACK.count * COIN_GEOMETRY.thickness;
  const bottom = pose && Number.isFinite(pose.bottomY) ? pose.bottomY : -fallbackHeight / 2;
  const height = pose && Number.isFinite(pose.height) ? pose.height : fallbackHeight;
  return new THREE.Box3(new THREE.Vector3(-radius, bottom, -radius), new THREE.Vector3(radius, bottom + height, radius));
}

function computeStackDistance(studio, pose) {
  if (!studio) return null;
  return fitCameraDistance(boxCorners(stackBox(pose)), studioAspect(studio), {
    fitMargin: STACK_FIT_MARGIN,
    camYFor: (distance) => distance * Math.tan(STACK_ELEVATION),
    fov: studioFov(studio),
  });
}

/** Frame the stack for the current pose; the camera follows the unfold. */
function applyStackFraming(pose) {
  const studio = state.studio;
  if (!studio || !state.stack.group || !pose) return;
  const distance = computeStackDistance(studio, pose);
  if (!distance) return;
  const camY = distance * Math.tan(STACK_ELEVATION);
  studio._camTarget = distance;
  studio._camDist = distance;
  studio._camY = camY;
  state.stack.camera = {
    distance: round3(distance),
    camY: round3(camY),
    elevationDeg: round3(THREE.MathUtils.radToDeg(STACK_ELEVATION)),
    fitMargin: STACK_FIT_MARGIN,
  };
  studio.camera.position.set(0, camY, distance);
  studio.camera.lookAt(0, 0, 0);
  studio.camera.updateMatrixWorld(true);
  if (studio.glow) studio.glow.scale.setScalar(1.35);
}

/** Apply one stack pose from coin-compositions.js to the scene + camera. */
function applyStackPose(seconds, { framing = true } = {}) {
  const stack = state.stack;
  if (!stack.group) return null;
  const pose = stackPoseAt(seconds);
  if (!pose) return null;
  for (const entry of stack.entries) {
    const placement = pose.entries[entry.index];
    if (!placement) continue;
    entry.holder.position.y = placement.y;
    entry.holder.rotation.y = Number.isFinite(placement.yawRad) ? placement.yawRad : 0;
  }
  stack.pose = pose;
  stack.progress = round3(pose.progress);
  if (framing) applyStackFraming(pose);
  return pose;
}

async function buildStack() {
  if (!state.bank || !state.studio) return;
  setBusy(true, 'Building stack');
  disposeStackView();
  const studio = state.studio;
  try {
    // Neutral internal mode: the stack has no parallax/spin/hero coin of its own.
    studio.setMode('hero');
    studio.heroRig.visible = false;
    studio.galleryGroup.visible = false;
    studio.shadow.visible = false;
    resetStudioView(studio);
    studio._coinGroups = [];

    const group = new THREE.Group();
    group.name = 'coin-stack';
    const entries = [];
    const layoutEntries = Array.isArray(STACK.entries) ? STACK.entries : [];
    for (let index = 0; index < layoutEntries.length; index += 1) {
      const data = layoutEntries[index];
      const spec = specById(data.id) || state.specs[index % Math.max(1, state.specs.length)];
      if (!spec) continue;
      const isTop = index === layoutEntries.length - 1;
      // The top coin's face carries the visible symbol; the lower coins only
      // show slivers through the unfolded gaps, so keep them light.
      const coin = makeCoin(spec, isTop ? 1024 : 384);
      const holder = new THREE.Group();
      holder.name = 'stack-coin:' + index + ':' + spec.id;
      holder.position.set(0, Number.isFinite(data.finalY) ? data.finalY : 0, 0);
      holder.rotation.set(0, Number.isFinite(data.finalYawRad) ? data.finalYawRad : 0, 0);
      coin.group.scale.setScalar(1);
      holder.add(coin.group);
      group.add(holder);
      entries.push({ id: spec.id, index, coin, holder, layout: data });
    }
    if (!entries.length) throw new Error('no coin specs available for the stack');
    studio.orbit.add(group);
    state.stack.group = group;
    state.stack.entries = entries;
    state.stack.elapsed = 0;
    state.stack.playing = false;
    // Capture and reduced-motion modes hold the deterministic UNFOLDED final;
    // otherwise the stack starts tight and the viewport observer unfolds it.
    const staticFinal = state.shot || state.reducedMotion;
    state.stack.state = staticFinal ? 'unfolded' : 'tight';
    state.stack.progress = staticFinal ? 1 : 0;
    state.stack.playedOnce = staticFinal;
    applyStackPose(staticFinal ? STACK.timing.duration : 0, { framing: true });
    studio._camDist = studio._camTarget;
    state.stack.frameHook = installFrameHook(studio, (dt) => stepStack(dt));
    if (state.booting) curtainProgress(0.8, 'Building stack', entries.length + ' / ' + STACK.count);
    studio.renderNow();
    await studio.whenStable();
    studio.renderNow();
  } catch (error) {
    state.stack.entries = [];
    if (state.stack.group && state.stack.group.parent) state.stack.group.parent.remove(state.stack.group);
    state.stack.group = null;
    state.stack.camera = null;
    pushError('stack build failed: ' + errorMessage(error));
    showErrorBanner('Could not render the coin stack: ' + errorMessage(error));
    throw error;
  } finally {
    setBusy(false);
  }
  updateDiag();
  if (state.mode === 'stack') setupStackViewportTrigger();
}

function disposeStackView() {
  const studio = state.studio;
  const stack = state.stack;
  if (stack.observer) {
    try {
      stack.observer.disconnect();
    } catch (error) {
      /* observer teardown is best effort */
    }
    stack.observer = null;
  }
  if (typeof stack.frameHook === 'function') {
    try {
      stack.frameHook();
    } catch (error) {
      /* hook teardown is best effort */
    }
    stack.frameHook = null;
  }
  if (stack.group) {
    if (stack.group.parent) stack.group.parent.remove(stack.group);
    for (const entry of stack.entries) disposeCoin(entry.coin);
  }
  stack.group = null;
  stack.entries = [];
  stack.pose = null;
  stack.playing = false;
  stack.state = 'idle';
  stack.progress = 0;
  stack.elapsed = 0;
  stack.camera = null;
  stack.playedOnce = false;
  if (studio) {
    if (studio.heroRig) studio.heroRig.visible = true;
    if (studio.shadow) studio.shadow.visible = true;
    if (typeof studio._computeFit === 'function') studio._computeFit();
    studio.renderNow();
  }
}

/** Start (or restart) the slow unfold from the tight flush stack. */
function playStack() {
  const stack = state.stack;
  if (!state.studio || !stack.group || state.failed) return false;
  if (state.reducedMotion || state.shot) return false;
  stack.elapsed = 0;
  stack.playing = true;
  stack.playedOnce = true;
  stack.state = 'unfolding';
  applyStackPose(0, { framing: true });
  syncModeUi();
  updateDiag();
  return true;
}

/** Per-frame advance of the unfold (installed as a studio frame hook). */
function stepStack(dt) {
  const stack = state.stack;
  if (!stack.playing || !stack.group) return;
  const framed = Math.max(0, Math.min(dt, 0.08));
  stack.elapsed = Math.min(STACK.timing.duration, stack.elapsed + framed);
  const pose = applyStackPose(stack.elapsed, { framing: true });
  if (!pose) {
    stack.playing = false;
    return;
  }
  if (pose.state === 'unfolded' || stack.elapsed >= STACK.timing.duration - 1e-6) finishUnfold();
}

/** Hold the fully unfolded final frame and refresh the UI. */
function finishUnfold() {
  const stack = state.stack;
  stack.playing = false;
  stack.state = 'unfolded';
  applyStackPose(STACK.timing.duration, { framing: true });
  stack.progress = 1;
  syncModeUi();
  updateDiag();
}

/**
 * Play once when the stage enters the viewport (like the other object pages). A
 * missing IntersectionObserver, reduced motion or capture mode just shows the
 * deterministic final frame; `?play=0` keeps the tight stack until Replay.
 */
function setupStackViewportTrigger() {
  const stack = state.stack;
  if (!stack.group) return;
  if (state.shot || state.reducedMotion || stack.playedOnce) {
    syncModeUi();
    return;
  }
  if (!stack.autoplay) {
    syncModeUi();
    return;
  }
  if (typeof IntersectionObserver !== 'function') {
    playStack();
    return;
  }
  try {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            observer.disconnect();
            stack.observer = null;
            playStack();
            return;
          }
        }
      },
      { threshold: [0, 0.2, 0.35, 0.6, 1] },
    );
    observer.observe(dom.stage);
    stack.observer = observer;
  } catch (error) {
    pushWarning('IntersectionObserver failed, unfolding the stack immediately: ' + errorMessage(error));
    playStack();
  }
}

function stackScreenBounds() {
  return groupScreenBounds(state.stack.group);
}

/**
 * Live rendered-page spacing readout (QA + tuning): project each neighbouring
 * pair's facing surfaces onto the canvas and report the air gap in CSS px.
 * Measured through the actual scene graph, so it includes the studio camera,
 * the canvas rect and (in interactive mode) the idle float; under ?shot=1 /
 * ?still=1 the scene is frozen and these numbers are deterministic.
 *
 * The 50 CSS px target is the MEAN of the eight air gaps (perspective makes
 * the top gaps read wider than the bottom ones: ~41-60 px). `midPx` is the
 * pair just above the centre. See docs/coin-stack-unfold.md.
 */
function stackSpacingDebug() {
  const studio = state.studio;
  const stack = state.stack;
  if (!studio || !studio.camera || !stack.group || !stack.pose) return null;
  const rect = studio.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const pose = stack.pose;
  if (!Array.isArray(pose.entries) || pose.entries.length < 2) return null;
  stack.group.updateWorldMatrix(true, true);
  studio.camera.updateMatrixWorld();
  const half = COIN_GEOMETRY.thickness / 2;
  const point = new THREE.Vector3();
  const projectY = (y) => {
    point.set(0, y, 0);
    stack.group.localToWorld(point);
    point.project(studio.camera);
    return rect.top + (-point.y * 0.5 + 0.5) * rect.height;
  };
  const pairs = [];
  for (let index = 0; index < pose.entries.length - 1; index += 1) {
    const below = pose.entries[index];
    const above = pose.entries[index + 1];
    const airPx = Math.abs(projectY(above.y - half) - projectY(below.y + half));
    const pitchPx = Math.abs(projectY(above.y) - projectY(below.y));
    pairs.push({ index, airPx: round3(airPx), pitchPx: round3(pitchPx) });
  }
  const air = pairs.map((pair) => pair.airPx);
  const meanPx = air.reduce((sum, value) => sum + value, 0) / air.length;
  const mid = pairs[Math.floor(pairs.length / 2)];
  return {
    measure: 'air-gap',
    targetPx: STACK.spacing.targetPx,
    midPx: mid.airPx,
    meanPx: round3(meanPx),
    minPx: round3(Math.min(...air)),
    maxPx: round3(Math.max(...air)),
    pitchMidPx: mid.pitchPx,
    pairs,
  };
}

function buildStackDebug() {
  if (state.mode !== 'stack' || !state.stack.group) return null;
  const stack = state.stack;
  const pose = stack.pose || {};
  return {
    count: stack.entries.length,
    ids: stack.entries.map((entry) => entry.id),
    topId: STACK.topId,
    state: stack.state,
    playing: stack.playing,
    progress: round3(stack.progress),
    elapsed: round3(stack.elapsed),
    duration: round3(STACK.timing.duration),
    finalGap: STACK.finalGap,
    elevationDeg: STACK.camera.elevationDeg,
    thickness: COIN_GEOMETRY.thickness,
    height: Number.isFinite(pose.height) ? round3(pose.height) : null,
    bottomY: Number.isFinite(pose.bottomY) ? round3(pose.bottomY) : null,
    autoplay: stack.autoplay,
    static: Boolean(state.shot || state.reducedMotion),
    spacing: stackSpacingDebug(),
    camera: stack.camera,
    screen: stackScreenBounds(),
    framing: stack.camera
      ? {
          cameraDistance: stack.camera.distance,
          cameraY: stack.camera.camY,
          elevationDeg: stack.camera.elevationDeg,
          fitMargin: stack.camera.fitMargin,
        }
      : null,
  };
}

/** Projected bounds of a scene group in CSS px (QA framing/no-clipping hook). */
function groupScreenBounds(group) {
  const studio = state.studio;
  if (!studio || !group || !studio.renderer) return null;
  const rect = studio.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  group.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return null;
  studio.camera.updateMatrixWorld();
  const corner = new THREE.Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of boxCorners(box)) {
    corner.copy(point).project(studio.camera);
    const x = rect.left + (corner.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-corner.y * 0.5 + 0.5) * rect.height;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    x0: round3(minX),
    y0: round3(minY),
    x1: round3(maxX),
    y1: round3(maxY),
    width: round3(maxX - minX),
    height: round3(maxY - minY),
    stage: { x: round3(rect.left), y: round3(rect.top), width: round3(rect.width), height: round3(rect.height) },
    clipped: minX < rect.left - 0.5 || maxX > rect.right + 0.5 || minY < rect.top - 0.5 || maxY > rect.bottom + 0.5,
  };
}

function ringScreenBounds() {
  return groupScreenBounds(state.ringGroup);
}

/* ------------------------------------------------------------- fallbacks */

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

function buildFallbackCards() {
  dom.fallbackGrid.innerHTML = FALLBACK_SPECS.map((spec) => {
    const flagFile = flagFileName(spec);
    return (
      '<article class="fallback-card">' +
      '<img class="fallback-flag" src="./assets/flags/' + escapeAttr(flagFile) + '" alt="" width="46" height="46" draggable="false">' +
      '<span class="fallback-glyph">' + escapeHtml(spec.glyph) + '</span>' +
      '<span class="fallback-code">' + escapeHtml(spec.code) + '</span>' +
      '<span class="fallback-name">' + escapeHtml(spec.name) + ' · ' + escapeHtml(spec.region) + '</span>' +
      '<span class="fallback-files">' + SOURCE_ASSETS.surface + ' + ' + SOURCE_ASSETS.font + '</span>' +
      '</article>'
    );
  }).join('');
}

function showErrorBanner(message) {
  dom.errorText.textContent = message;
  dom.errorBanner.hidden = false;
}

function showFallback(message, error) {
  state.failed = true;
  state.ready = false;
  if (error) pushError(errorMessage(error));
  pushError(message);
  dom.body.dataset.fallback = '1';
  dom.body.dataset.qaReady = '0';
  dom.body.dataset.qaErrors = String(qaErrors.length);
  dom.fallback.hidden = false;
  dom.fallbackMessage.textContent = message;
  buildFallbackCards();
  showErrorBanner(message);
  hideCurtain();
  dom.footerStatus.textContent = 'Static fallback';
  updateDiag();
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  state.mode = parseMode(urlParams.get('mode'));
  state.face = normalizeFace(urlParams.get('face')) || 'a';
  state.spin = !state.shot && !state.reducedMotion && urlParams.get('spin') === '1';
  syncShotUi();
  syncModeUi();
  syncFaceUi();
  syncSpinUi();
  updateDiag();

  const webgl = probeWebGL();
  qa.webgl = webgl;
  if (!webgl) {
    showFallback(
      'WebGL is not available in this browser, so the 3D coin cannot be rendered. The seven coins and their source assets are listed below.'
    );
    return;
  }

  curtainProgress(0.02, 'Loading 3D engine', '');
  let sceneModule = null;
  let modelModule = null;
  try {
    [sceneModule, modelModule] = await Promise.all([import('./scene.js'), import(MODEL_URL.href)]);
  } catch (error) {
    showFallback(
      'The 3D engine could not be loaded (' + errorMessage(error) + '). The seven coins and their source assets are listed below.',
      error
    );
    return;
  }

  curtainProgress(0.05, 'Loading source assets', '0 / 0');
  try {
    state.bank = await modelModule.loadCoinBank({
      onProgress: (loaded, total) => {
        const safeTotal = total || Math.max(loaded, 1);
        curtainProgress(0.05 + (loaded / safeTotal) * 0.75, 'Loading source assets', loaded + ' / ' + safeTotal);
      },
    });
  } catch (error) {
    showFallback('The coin model assets could not be loaded (' + errorMessage(error) + ').', error);
    return;
  }

  if (!state.bank || typeof state.bank.createCoin !== 'function' || !Array.isArray(state.bank.specs) || !state.bank.specs.length) {
    showFallback('The coin model module did not expose the expected bank API (loadCoinBank/createCoin/coin.group).');
    return;
  }
  state.specs = state.bank.specs.slice();
  if (state.specs.length !== 7) pushError('expected 7 coin specs, got ' + state.specs.length);
  buildRail();

  const paramsCoin = String(urlParams.get('coin') || '').toLowerCase();
  state.coin = specById(paramsCoin) ? paramsCoin : state.specs[0].id;
  curtainProgress(0.85, 'Preparing coin', '');
  syncCoinUi(specById(state.coin));

  try {
    state.studio = new sceneModule.CoinStudio({
      canvas: dom.canvas,
      stage: dom.stage,
      reducedMotion: state.reducedMotion,
      shot: state.shot,
      tilt: state.tilt,
      // The scene owns pointer gestures. There is no flip gesture any more: a
      // gallery tap opens a coin, double-tap/double-click resets the 3-axis view.
      onGalleryTap: (id) => {
        runExclusive(async () => {
          await selectCoin(id);
          await applyMode('hero');
        }).then(refreshScene, () => undefined);
      },
    });
    await state.studio.init();
    installCompositionFraming(state.studio);
  } catch (error) {
    showFallback('The WebGL studio could not start (' + errorMessage(error) + ').', error);
    return;
  }

  try {
    if (state.mode === 'ring') await buildRing();
    else if (state.mode === 'stack') await buildStack();
    else if (state.mode === 'gallery') await buildGalleryCoins();
    else await buildHeroCoin();
    if (state.studio) {
      // Composition modes already configured their own rig/camera/visibility.
      if (state.mode !== 'ring' && state.mode !== 'stack') state.studio.setMode(state.mode);
      state.studio.setFace(state.face, { immediate: true });
      state.studio.setSpin(state.spin);
      state.studio.setSelection(state.coin);
      state.studio.setShot(state.shot);
      state.studio.renderNow();
      await state.studio.whenStable();
      state.studio.renderNow();
    }
    curtainProgress(1, 'Studio ready', '');
    try {
      if (document.fonts && document.fonts.ready) {
        await Promise.race([document.fonts.ready, tick(900)]);
      }
    } catch (error) {
      /* font readiness is cosmetic only */
    }
    if (state.studio) state.studio.renderNow();
    hideCurtain();
    state.booting = false;
    state.ready = true;
    dom.footerStatus.textContent =
      state.mode === 'stack' ? 'Stack' : state.mode === 'ring' ? 'Ring' : state.mode === 'gallery' ? 'Gallery' : 'Ready';
    syncModeUi();
    syncFaceUi();
    syncSpinUi();
    if (state.studio) {
      // Only the hero/gallery presentation has an intro reveal; the compositions
      // hold their own deterministic framing.
      if (!state.shot && (state.mode === 'hero' || state.mode === 'gallery')) state.studio.playIntro();
      state.studio.renderNow();
    }
    updateDiag();
  } catch (error) {
    state.booting = false;
    if (!state.failed) showFallback('The silver studio failed to render (' + errorMessage(error) + ').', error);
  }
  window.setInterval(updateDiag, 400);
}

/* ------------------------------------------------------------- UI wiring */

function wireUi() {
  if (dom.btnStack) {
    dom.btnStack.addEventListener('click', () => {
      runExclusive(() => applyMode(state.mode === 'stack' ? 'hero' : 'stack')).then(refreshScene, () => undefined);
    });
  }
  if (dom.btnReplay) {
    dom.btnReplay.addEventListener('click', () => {
      runExclusive(async () => {
        playStack();
        refreshScene();
        return true;
      }).then(refreshScene, () => undefined);
    });
  }
  dom.btnSpin.addEventListener('click', () => {
    if (state.reducedMotion) return;
    state.spin = !state.spin;
    if (state.studio) state.studio.setSpin(state.spin);
    syncSpinUi();
    updateDiag();
  });
  dom.btnGallery.addEventListener('click', () => {
    runExclusive(() => applyMode(state.mode === 'gallery' ? 'hero' : 'gallery')).then(refreshScene, () => undefined);
  });
  if (dom.btnRing) {
    dom.btnRing.addEventListener('click', () => {
      runExclusive(() => applyMode(state.mode === 'ring' ? 'hero' : 'ring')).then(refreshScene, () => undefined);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const typing =
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing) return;
    if (target && target.tagName === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        cycleCoin(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        cycleCoin(1);
        break;
      case 'g':
      case 'G':
        runExclusive(() => applyMode(state.mode === 'gallery' ? 'hero' : 'gallery')).then(refreshScene, () => undefined);
        break;
      case 'y':
      case 'Y':
        runExclusive(() => applyMode(state.mode === 'ring' ? 'hero' : 'ring')).then(refreshScene, () => undefined);
        break;
      case 't':
      case 'T':
        runExclusive(() => applyMode(state.mode === 'stack' ? 'hero' : 'stack')).then(refreshScene, () => undefined);
        break;
      case 's':
      case 'S':
        if (state.reducedMotion || state.mode === 'ring' || state.mode === 'stack') break;
        state.spin = !state.spin;
        if (state.studio) state.studio.setSpin(state.spin);
        syncSpinUi();
        updateDiag();
        break;
      case 'r':
      case 'R':
        runExclusive(async () => {
          if (state.studio) await state.studio.resetView();
          refreshScene();
        }).then(refreshScene, () => undefined);
        break;
      default:
        break;
    }
  });
}

function cycleCoin(delta) {
  if (!state.specs.length) return;
  const current = state.specs.findIndex((spec) => spec.id === state.coin);
  const nextIndex = (current + delta + state.specs.length) % state.specs.length;
  runExclusive(() => selectCoin(state.specs[nextIndex].id)).then(refreshScene, () => undefined);
}

/* ------------------------------------------------------------------ main */

wireUi();
syncShotUi();
syncModeUi();
syncFaceUi();
syncSpinUi();
dom.footerStatus.textContent = 'Loading';
updateDiag();
boot().catch((error) => {
  if (!state.failed) showFallback('The preview failed to start (' + errorMessage(error) + ').', error);
});
