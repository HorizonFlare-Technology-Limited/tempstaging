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
import { WAVE, waveSurfaceHeight } from './coin-wave.js';
import { createWaveComposition, WAVE_ACCENT } from './coin-wave-scene.js';
import { PARADE, paradePose, paradeCameraPose, paradeLoopTime, paradeRingSpacing } from './coin-parade.js';
import { createParadeStudio, prepareParadeCoin } from './coin-parade-scene.js';

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
const MODES = Object.freeze(['hero', 'gallery', 'ring', 'stack', 'wave', 'parade']);

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
  btnWave: document.getElementById('btn-wave'),
  btnParade: document.getElementById('btn-parade'),
  btnParadePlay: document.getElementById('btn-parade-play'),
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

// Revision 14: ?capture=1 is a clean stage-only capture state (deterministic
// Parade frames + reference-look screenshots); CSS hides the page chrome.
if (urlParams.get('capture') === '1') document.body.dataset.capture = '1';

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
  capture: urlParams.get('capture') === '1',
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
  /**
   * Wave composition (Revision 15): two broad flat-topped sine ribbons (brushed
   * steel front, TEKO gold satin behind at half a phase) with three coins in the
   * steel trough, 100 CSS px apart at the 1440/1200 default view and touching the
   * surface. Static scene; the 360° orbit stays live on empty space, and each
   * coin can be left-drag rotated (3 axes) or right-drag moved. See
   * src/coin-wave.js + coin-wave-scene.js.
   */
  wave: {
    group: null,
    scene: null,
    entries: [],
    camera: null,
    frameHook: null,
    previousEnvironment: undefined,
    previousLights: [],
    coinEnvironment: null,
    selected: null,
    drag: null,
    spacingCss: null,
    contact: null,
  },
  /**
   * Parade composition (Revision 14): seven coins on a rotating vertical
   * carousel with a deterministic 12 s loop, a black strip-lit PMREM studio and
   * mode-local material clones. Animation is driven by a frame hook from
   * paradePose(t); shot/still/reduced-motion hold the deterministic shot frame.
   */
  parade: {
    group: null,
    studio: null,
    entries: [],
    previousEnvironment: undefined,
    previousBackground: undefined,
    previousFog: undefined,
    previousExposure: null,
    previousToneMapping: null,
    previousFov: 30,
    playing: false,
    time: PARADE.shotTime,
    frameHook: null,
    camera: null,
    spacing: null,
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
  if (state.mode === 'ring' || state.mode === 'stack' || state.mode === 'wave' || state.mode === 'parade') applyCompositionCaption();
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
  } else if (state.mode === 'wave') {
    const total = String(WAVE.count).padStart(2, '0');
    dom.stageIndex.textContent = total;
    if (dom.stageIndexTotal) dom.stageIndexTotal.textContent = total;
    dom.stageCode.textContent = 'WAVE';
    dom.stageName.textContent = WAVE.count === 3 ? 'Three coins' : WAVE.count + ' coins';
  } else if (state.mode === 'parade') {
    const total = String(PARADE.count).padStart(2, '0');
    dom.stageIndex.textContent = total;
    if (dom.stageIndexTotal) dom.stageIndexTotal.textContent = total;
    dom.stageCode.textContent = 'PARADE';
    dom.stageName.textContent = 'Seven coins';
  }
}

function syncFaceUi() {
  // Both faces carry the identical symbol; a/b are only the two sides.
  dom.body.dataset.face = state.face;
}

const DEFAULT_HINT = 'Drag to rotate 360° · Shift-drag to roll · double-click to reset';

function syncSpinUi() {
  const composition = state.mode === 'ring' || state.mode === 'stack' || state.mode === 'wave' || state.mode === 'parade';
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

/** Visible Play/Pause affordance for the Parade timeline (stage control). */
function syncParadeUi() {
  if (!dom.btnParadePlay) return;
  const parade = state.mode === 'parade';
  dom.btnParadePlay.hidden = !parade;
  const blocked = !parade || state.shot || !state.parade.group;
  dom.btnParadePlay.disabled = Boolean(blocked);
  const playing = parade && state.parade.playing;
  dom.btnParadePlay.setAttribute('aria-pressed', String(playing));
  dom.btnParadePlay.textContent = playing ? 'Pause' : 'Play';
  dom.btnParadePlay.setAttribute(
    'aria-label',
    playing ? 'Pause the coin parade animation' : 'Play the coin parade animation'
  );
  if (!parade) dom.btnParadePlay.removeAttribute('title');
  else if (state.shot) dom.btnParadePlay.title = 'Playback is frozen in deterministic capture mode.';
  else dom.btnParadePlay.title = playing ? 'Pause the coin parade' : 'Play the coin parade';
}

function syncModeUi() {
  const ring = state.mode === 'ring';
  const gallery = state.mode === 'gallery';
  const stack = state.mode === 'stack';
  const wave = state.mode === 'wave';
  const parade = state.mode === 'parade';
  dom.body.dataset.mode = state.mode;
  dom.btnGallery.setAttribute('aria-pressed', String(gallery));
  if (dom.btnRing) dom.btnRing.setAttribute('aria-pressed', String(ring));
  if (dom.btnStack) dom.btnStack.setAttribute('aria-pressed', String(stack));
  if (dom.btnWave) dom.btnWave.setAttribute('aria-pressed', String(wave));
  if (dom.btnParade) dom.btnParade.setAttribute('aria-pressed', String(parade));
  dom.stageEyebrow.textContent = parade
    ? 'Parade · ' + PARADE.count + ' coins'
    : wave
      ? 'Wave · ' + WAVE.count + ' coins'
      : stack
        ? 'Stack · ' + STACK.count + ' coins'
        : ring
          ? 'Ring · eight coins'
          : gallery
            ? 'Gallery · seven coins'
            : 'Silver studio';
  dom.infoFootState.textContent = parade
    ? 'Parade'
    : wave
      ? 'Wave'
      : stack
        ? 'Stack'
        : ring
          ? 'Ring'
          : gallery
            ? 'Gallery'
            : 'Hero';
  dom.galleryLabels.hidden = !gallery;
  if (dom.stageHint) {
    if (parade) {
      dom.stageHint.textContent = 'Drag to rotate 360° · Space play/pause';
    } else if (wave) {
      dom.stageHint.textContent = WAVE_HINT;
    } else if (stack) {
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
  if (ring || stack || wave || parade) applyCompositionCaption();
  else {
    const spec = specById(state.coin);
    if (spec) syncCoinUi(spec, { updatePanel: false });
  }
  syncSpinUi();
  syncReplayUi();
  if (state.ready) {
    dom.footerStatus.textContent = parade
      ? 'Parade'
      : wave
        ? 'Wave'
        : stack
          ? 'Stack'
          : ring
            ? 'Ring'
            : gallery
              ? 'Gallery'
              : 'Ready';
  }
  syncParadeUi();
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
  let wave = null;
  let parade = null;
  let framing = null;
  try {
    ring = buildRingDebug();
    stack = buildStackDebug();
    wave = buildWaveDebug();
    parade = buildParadeDebug();
    const active = wave || ring || stack || parade;
    framing =
      active && active.framing
        ? Object.assign({}, active.framing, {
            aspect: state.studio && state.studio.camera ? Math.round(state.studio.camera.aspect * 1000) / 1000 : null,
          })
        : null;
  } catch (error) {
    ring = null;
    stack = null;
    wave = null;
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
    wave,
    parade,
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
  if (debug.mode === 'wave' && debug.wave) {
    dom.body.dataset.wave = '1';
    dom.body.dataset.waveCount = String(debug.wave.count);
    dom.body.dataset.waveIds = (debug.wave.ids || []).join(',');
    dom.body.dataset.waveStatic = debug.wave.static ? '1' : '0';
    dom.body.dataset.waveSelected = debug.wave.selected || '';
    dom.body.dataset.waveSpacing = debug.wave.spacingCss ? String(debug.wave.spacingCss.mean) : '';
    dom.body.dataset.waveContact = debug.wave.contact ? String(debug.wave.contact.maxGap) : '';
  } else {
    delete dom.body.dataset.wave;
    delete dom.body.dataset.waveCount;
    delete dom.body.dataset.waveIds;
    delete dom.body.dataset.waveStatic;
    delete dom.body.dataset.waveSelected;
    delete dom.body.dataset.waveSpacing;
    delete dom.body.dataset.waveContact;
  }
  if (debug.mode === 'parade' && debug.parade) {
    dom.body.dataset.parade = '1';
    dom.body.dataset.paradeCount = String(debug.parade.count);
    dom.body.dataset.paradeIds = (debug.parade.ids || []).join(',');
    dom.body.dataset.paradePlaying = debug.parade.playing ? '1' : '0';
    dom.body.dataset.paradeTime = String(debug.parade.time);
    dom.body.dataset.paradeLoopTime = String(debug.parade.loopTime);
    dom.body.dataset.paradeStatic = debug.parade.static ? '1' : '0';
  } else {
    delete dom.body.dataset.parade;
    delete dom.body.dataset.paradeCount;
    delete dom.body.dataset.paradeIds;
    delete dom.body.dataset.paradePlaying;
    delete dom.body.dataset.paradeTime;
    delete dom.body.dataset.paradeLoopTime;
    delete dom.body.dataset.paradeStatic;
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
    if (state.mode === 'wave') await resetWaveView();
    else await state.studio.resetView();
    refreshScene();
    return true;
  },
  /** Revision 15: set one wave coin transform (local position array / quaternion). */
  setWaveCoinTransform(id, transform) {
    if (state.mode !== 'wave' || !state.wave.group) return false;
    const entry = state.wave.entries.find((candidate) => candidate.id === id);
    if (!entry) return false;
    const input = transform || {};
    let changed = false;
    if (Array.isArray(input.position) && input.position.length >= 3) {
      entry.holder.position.set(Number(input.position[0]), Number(input.position[1]), Number(input.position[2]));
      changed = true;
    }
    if (Array.isArray(input.quaternion) && input.quaternion.length >= 4) {
      entry.holder.quaternion.set(
        Number(input.quaternion[0]),
        Number(input.quaternion[1]),
        Number(input.quaternion[2]),
        Number(input.quaternion[3]),
      );
      if (entry.holder.quaternion.lengthSq() > 0) entry.holder.quaternion.normalize();
      changed = true;
    }
    if (!changed) return false;
    entry.holder.updateMatrixWorld(true);
    state.wave.group.updateMatrixWorld(true);
    state.wave.spacingCss = measureWaveSpacingCss();
    state.wave.contact = measureWaveContact();
    if (state.studio) {
      state.studio.renderNow();
    }
    updateDiag();
    return true;
  },
  /** Revision 15: restore the three default wave placements (camera untouched). */
  async resetWaveCoins() {
    if (state.mode !== 'wave' || !state.wave.group) return false;
    const ok = await resetWaveCoinTransforms();
    refreshScene();
    return ok;
  },
  /** Replays the Stack unfold (no-op unless Stack mode is active). */
  async replayStack() {
    return runExclusive(async () => {
      const ok = playStack();
      refreshScene();
      return ok;
    });
  },
  /** Plays/pauses the Parade timeline (no-op outside Parade / capture mode). */
  setParadePlaying(enabled) {
    return setParadePlaying(enabled);
  },
  /** Deterministic Parade time (seconds): pose + render, pauses playback. */
  setParadeTime(seconds) {
    if (state.mode !== 'parade' || !state.parade.group) return false;
    const time = paradeLoopTime(Number(seconds));
    state.parade.playing = false;
    state.parade.time = time;
    applyParadePose(time);
    if (state.studio) state.studio.renderNow();
    syncParadeUi();
    updateDiag();
    return time;
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
  if (state.mode === 'ring' || state.mode === 'stack' || state.mode === 'wave' || state.mode === 'parade') {
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
        : next === 'wave'
          ? Boolean(state.wave.group)
          : next === 'parade'
            ? Boolean(state.parade.group)
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
  } else if (next === 'wave') {
    await buildWave();
  } else if (next === 'parade') {
    await buildParade();
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
  if (nextMode !== 'wave') disposeWaveView();
  if (nextMode !== 'parade') disposeParadeView();
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
    else if (state.mode === 'wave' && state.wave.group) applyWaveFraming();
    else if (state.mode === 'parade' && state.parade.group) applyParadeFraming();
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

/* ---------------------------------------------------------------- wave mode */

const WAVE_FACE_SIZE = WAVE.faceSize || 512;
const WAVE_COIN_RADIUS = WAVE.coinScale || 0.18;
const WAVE_DESIGN_SPACING_PX = 100;
const WAVE_DESIGN_STAGE_HEIGHT = (WAVE.camera && WAVE.camera.stage && WAVE.camera.stage.height) || 900;
const WAVE_GOLD_HEX = '#' + WAVE_ACCENT.gold.toString(16).padStart(6, '0');
const WAVE_WHITE_HEX = '#' + WAVE_ACCENT.white.toString(16).padStart(6, '0');
const WAVE_HINT = 'Left-drag coin to rotate · Right-drag coin to move · Drag empty space to orbit';
const WAVE_ROTATE_SENSITIVITY = 0.0075;
const WAVE_FIT_MARGIN = 1.06;

let wavePointerBound = false;
const waveRaycaster = new THREE.Raycaster();
const waveNdc = new THREE.Vector2();
const waveScratch = {
  world: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  hit: new THREE.Vector3(),
  point: new THREE.Vector3(),
  local: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  quatX: new THREE.Quaternion(),
  quatY: new THREE.Quaternion(),
  plane: new THREE.Plane(),
  offset: new THREE.Vector3(),
  target: new THREE.Vector3(),
  direction: new THREE.Vector3(),
};
const waveRound = (value) => Math.round(value * 1000) / 1000;
const waveRound6 = (value) => Math.round(value * 1e6) / 1e6;

function waveTarget() {
  const camera = WAVE.camera || {};
  const target = Array.isArray(camera.target) ? camera.target : [0, Number(camera.targetY) || 0, 0];
  return [Number(target[0]) || 0, Number(target[1]) || 0, Number(target[2]) || 0];
}

function waveCameraDirection() {
  const camera = WAVE.camera || {};
  const target = waveTarget();
  const pos = Array.isArray(camera.position) ? camera.position : [0, target[1], 7];
  const dir = waveScratch.direction
    .set(Number(pos[0]) - target[0], Number(pos[1]) - target[1], Number(pos[2]) - target[2]);
  if (dir.lengthSq() === 0) dir.set(0, 0.34, 0.94);
  return dir.normalize();
}

/** Project a wave entry's world position into CSS px (canvas rect coords). */
function waveEntryScreen(entry, rect, out) {
  const studio = state.studio;
  if (!studio || !studio.camera) return null;
  const world = entry.holder.getWorldPosition(waveScratch.world);
  const ndc = world.project(studio.camera);
  out.x = (ndc.x * 0.5 + 0.5) * rect.width;
  out.y = (0.5 - ndc.y * 0.5) * rect.height;
  return out;
}

/** Screen-pixel distance between the coin centres (100 px at 1440/1200). */
function measureWaveSpacingCss() {
  const studio = state.studio;
  const wave = state.wave;
  if (!studio || !wave.group || wave.entries.length < 2) return null;
  const rect = studio.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const pairs = [];
  for (let i = 0; i < wave.entries.length - 1; i += 1) {
    const first = waveEntryScreen(wave.entries[i], rect, { x: 0, y: 0 });
    const second = waveEntryScreen(wave.entries[i + 1], rect, { x: 0, y: 0 });
    if (!first || !second) continue;
    pairs.push(Math.hypot(second.x - first.x, second.y - first.y));
  }
  if (!pairs.length) return null;
  const mean = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
  return { pairs: pairs.map(waveRound), mean: waveRound(mean), target: WAVE_DESIGN_SPACING_PX };
}

/** Bottom-rim contact of each coin against the steel wave (world units). */
function measureWaveContact() {
  const group = state.wave.group;
  if (!group) return null;
  const coins = [];
  let maxGap = -Infinity;
  let maxPenetration = 0;
  for (const entry of state.wave.entries) {
    entry.holder.updateWorldMatrix(true, false);
    const world = entry.holder.getWorldPosition(waveScratch.world);
    const local = group.worldToLocal(world.clone());
    const surface = waveSurfaceHeight('steel', local.x, local.z);
    const bottom = local.y - WAVE_COIN_RADIUS;
    const gap = bottom - surface;
    maxGap = Math.max(maxGap, gap);
    maxPenetration = Math.max(maxPenetration, -gap);
    coins.push({
      id: entry.id,
      gap: waveRound6(gap),
      penetration: waveRound6(Math.max(0, -gap)),
      contact: [waveRound6(local.x), waveRound6(surface), waveRound6(local.z)],
    });
  }
  return {
    maxGap: waveRound6(maxGap),
    maxPenetration: waveRound6(maxPenetration),
    design: WAVE.metrics ? WAVE.metrics.contact : null,
    coins,
  };
}

/** Screen coverage of the three coin discs (for row placement and clipping). */
function measureWaveCoinScreen(rect) {
  const studio = state.studio;
  if (!studio || !studio.camera) return null;
  const camera = studio.camera;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const forward = new THREE.Vector3();
  camera.matrixWorld.extractBasis(right, up, forward);
  right.normalize();
  up.normalize();
  let minTopY = Infinity;
  let maxBottomY = -Infinity;
  let minLeftX = Infinity;
  let maxRightX = -Infinity;
  let sumCenterY = 0;
  let count = 0;
  for (const entry of state.wave.entries) {
    const centreWorld = entry.holder.getWorldPosition(new THREE.Vector3());
    const centre = centreWorld.clone().project(camera);
    sumCenterY += (0.5 - centre.y * 0.5) * rect.height;
    count += 1;
    for (const offset of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const point = centreWorld
        .clone()
        .addScaledVector(right, offset[0] * WAVE_COIN_RADIUS)
        .addScaledVector(up, offset[1] * WAVE_COIN_RADIUS)
        .project(camera);
      const x = (point.x * 0.5 + 0.5) * rect.width;
      const y = (0.5 - point.y * 0.5) * rect.height;
      if (y < minTopY) minTopY = y;
      if (y > maxBottomY) maxBottomY = y;
      if (x < minLeftX) minLeftX = x;
      if (x > maxRightX) maxRightX = x;
    }
  }
  if (!count) return null;
  return { minTopY, maxBottomY, minLeftX, maxRightX, meanCenterY: sumCenterY / count };
}

/** Deterministic Wave camera. Desktop keeps the module's 100 CSS px coin spacing;
 *  short stages fall back to a coin-row fit so the row never clips. */
function applyWaveFraming() {
  const studio = state.studio;
  const wave = state.wave;
  if (!studio || !studio.camera || !wave.group) return;
  const rect = studio.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const cameraSpec = WAVE.camera || {};
  const fov = Number.isFinite(cameraSpec.fovDeg) ? cameraSpec.fovDeg : 30;
  const tanHalf = Math.tan((fov * Math.PI) / 360);
  const aspect = rect.width / rect.height;
  const target = waveTarget();
  const dir = waveCameraDirection();
  const spacingWorld = (WAVE.metrics && WAVE.metrics.spacing && WAVE.metrics.spacing.world) || 0.37;
  // Centre coin position relative to the authored camera target, projected onto
  // the view direction: this is the depth offset that makes screen spacing exact.
  const centre = wave.entries.length ? wave.entries[Math.floor(wave.entries.length / 2)].holder.position : new THREE.Vector3();
  const along = (centre.y - target[1]) * dir.y + (centre.z - target[2]) * dir.z;
  let distance;
  if (rect.width >= 700) {
    // solved so the projected centre spacing is exactly 100 CSS px
    const depth = (spacingWorld * rect.height) / (2 * tanHalf * WAVE_DESIGN_SPACING_PX);
    distance = depth + along;
  } else {
    // Fit the whole composition (coin row + gold crest) on short stages.
    const halfRow = spacingWorld + WAVE_COIN_RADIUS;
    const halfHeight = 0.98;
    const needWidth = (halfRow * WAVE_FIT_MARGIN) / (tanHalf * aspect);
    const needHeight = (halfHeight * WAVE_FIT_MARGIN) / tanHalf;
    distance = Math.max(needWidth, needHeight) + along;
  }
  distance = Math.max(1.6, distance);
  // Shift the composition so the orbit pivot is the authored camera target.
  wave.group.position.set(-target[0], -target[1], -target[2]);
  studio.camera.fov = fov;
  studio.camera.near = 0.05;
  studio.camera.far = 160;
  studio.camera.updateProjectionMatrix();
  const applyCamera = (value) => {
    const next = dir.clone().multiplyScalar(value);
    studio.camera.position.copy(next);
    studio.camera.lookAt(0, 0, 0);
    studio.camera.updateMatrixWorld(true);
    // The internal studio re-derives the hero camera from these each frame; the
    // wave target is shifted to the origin, so the hero camera path is valid.
    studio._camTarget = value;
    studio._camDist = value;
    studio._camY = next.y;
    return next;
  };
  let position = applyCamera(distance);
  // Keep the whole composition in frame: at very short mobile stages the
  // 100-px-spacing camera would clip the coin row / gold crest, so the fit
  // pulls back just enough (spacing then scales below 100 px only on mobile).
  for (let iteration = 0; iteration < 5; iteration += 1) {
    if (rect.width >= 700) {
      const spacing = measureWaveSpacingCss();
      if (spacing && Math.abs(spacing.mean - WAVE_DESIGN_SPACING_PX) > 0.05) {
        distance = Math.max(1.6, distance * (spacing.mean / WAVE_DESIGN_SPACING_PX));
        position = applyCamera(distance);
        continue;
      }
    }
    const screen = measureWaveCoinScreen(rect);
    if (!screen) break;
    const clipsVertical = screen.maxBottomY > rect.height * 0.94 || screen.minTopY < rect.height * 0.05;
    const clipsHorizontal = screen.minLeftX < rect.width * 0.03 || screen.maxRightX > rect.width * 0.97;
    if (clipsVertical || clipsHorizontal) {
      distance = Math.max(1.6, distance * 1.05);
      position = applyCamera(distance);
      continue;
    }
    break;
  }
  const lift = 0;
  wave.camera = {
    fov: waveRound(fov),
    distance: waveRound(distance),
    cameraY: waveRound(position.y),
    cameraZ: waveRound(position.z),
    target: target.map(waveRound),
    effectiveTargetY: waveRound(target[1] - lift),
    lift: waveRound(lift),
    elevationDeg: waveRound(THREE.MathUtils.radToDeg(Math.asin(Math.min(1, Math.max(-1, dir.y))))),
    fitMargin: WAVE_FIT_MARGIN,
    fitMode: rect.width >= 700 ? 'spacing-100px' : 'coin-row-fit',
    stage: { width: waveRound(rect.width), height: waveRound(rect.height), aspect: waveRound(aspect) },
    designStageHeight: WAVE_DESIGN_STAGE_HEIGHT,
    coinScale: WAVE.coinScale,
    spread: waveRound(spacingWorld * wave.entries.length + WAVE_COIN_RADIUS * 2),
  };
  wave.spacingCss = measureWaveSpacingCss();
  wave.contact = measureWaveContact();
}

/** Bright neutral equirectangular environment for the Wave-mode coins only. */
function makeWaveCoinEnvironment() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.42, '#eef2f6');
  gradient.addColorStop(0.62, '#c8d0d8');
  gradient.addColorStop(0.8, '#8d949c');
  gradient.addColorStop(1, '#4a4f55');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  return texture;
}

async function buildWave() {
  if (!state.bank || !state.studio) return;
  setBusy(true, 'Building wave');
  disposeWaveView();
  const studio = state.studio;
  try {
    // Neutral dark wave studio: the wave scene owns its environment and lights;
    // hide the silver-studio rig and keep the page's 360-degree orbit live.
    studio.setMode('hero');
    studio.heroRig.visible = false;
    studio.galleryGroup.visible = false;
    studio.shadow.visible = false;
    if (studio.glow) studio.glow.visible = false;
    studio.setSpin(false);
    if (typeof studio.setStatic === 'function') studio.setStatic(true);
    resetStudioView(studio);
    studio._coinGroups = [];
    if (studio.renderer && studio.renderer.shadowMap) studio.renderer.shadowMap.enabled = false;

    const scene = createWaveComposition({
      renderer: studio.renderer || null,
      castShadow: false,
    });
    const group = scene.group;
    const previousEnvironment = studio.scene ? studio.scene.environment : null;
    const previousLights = [];
    if (studio.scene) {
      for (const child of studio.scene.children) {
        if (child.isLight) {
          previousLights.push({ light: child, intensity: child.intensity });
          child.intensity = 0;
        }
      }
      if (scene.environment) studio.scene.environment = scene.environment.texture;
    }
    const coinEnvironment = makeWaveCoinEnvironment();
    const entries = [];
    for (const placement of WAVE.coins) {
      const spec = specById(placement.id);
      if (!spec) continue;
      const coin = makeCoin(spec, WAVE_FACE_SIZE);
      const holder = new THREE.Group();
      holder.name = 'wave-coin:' + placement.id;
      holder.position.fromArray(placement.position);
      holder.quaternion.fromArray(placement.quaternion);
      coin.group.scale.setScalar(placement.radius || WAVE_COIN_RADIUS);
      // Mode-local material clones keep the shared coin bank untouched while the
      // coins sit in the wave's neutral studio (satin silver, readable relief).
      const clonedMaterials = [];
      coin.group.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        const clone = object.material.clone();
        const base = Number.isFinite(clone.envMapIntensity) ? clone.envMapIntensity : 1;
        // The wave studio PMREM is warm/dim (gold bounce); the coins use the
        // page's neutral silver-studio environment explicitly so they read as
        // bright satin silver with legible relief (the ribbons keep the wave env).
        clone.envMap = coinEnvironment;
        clone.envMapIntensity = Math.max(base, 1.0) * 1.1;
        if (/face/i.test(object.name)) clone.roughness = Math.min(0.4, clone.roughness || 0.32);
        object.material = clone;
        clonedMaterials.push(clone);
      });
      holder.add(coin.group);
      group.add(holder);
      entries.push({
        id: spec.id,
        index: entries.length,
        coin,
        holder,
        layout: placement,
        clonedMaterials,
        defaults: {
          position: placement.position.slice(),
          quaternion: placement.quaternion.slice(),
        },
      });
    }
    if (!entries.length) throw new Error('no coin specs available for the wave');
    studio.orbit.add(group);
    state.wave = {
      group,
      scene,
      entries,
      camera: null,
      frameHook: null,
      previousEnvironment,
      previousLights,
      coinEnvironment,
      selected: null,
      drag: null,
      spacingCss: null,
      contact: null,
    };
    bindWaveInteractions();
    applyWaveFraming();
    if (state.booting) curtainProgress(0.82, 'Building wave', entries.length + ' / ' + WAVE.count);
    studio.renderNow();
    await studio.whenStable();
    studio.renderNow();
  } catch (error) {
    disposeWaveView();
    pushError('wave build failed: ' + errorMessage(error));
    showErrorBanner('Could not render the coin wave: ' + errorMessage(error));
    throw error;
  } finally {
    setBusy(false);
  }
  updateDiag();
}

function disposeWaveView() {
  const studio = state.studio;
  const wave = state.wave;
  if (!wave.group && !wave.scene) {
    if (wave.coinEnvironment) {
      try {
        wave.coinEnvironment.dispose();
      } catch (error) {
        /* best effort */
      }
    }
    if (studio) {
      if (studio.heroRig) studio.heroRig.visible = true;
      if (studio.shadow) studio.shadow.visible = true;
      if (studio.glow) studio.glow.visible = true;
      if (typeof studio.setStatic === 'function') studio.setStatic(false);
    }
    return;
  }
  for (const entry of wave.entries || []) disposeWaveCoin(entry);
  if (wave.group && wave.group.parent) wave.group.parent.remove(wave.group);
  if (studio && studio.scene && wave.previousEnvironment !== undefined) {
    studio.scene.environment = wave.previousEnvironment || null;
  }
  for (const saved of wave.previousLights || []) {
    if (saved && saved.light) saved.light.intensity = saved.intensity;
  }
  if (wave.coinEnvironment) {
    try {
      wave.coinEnvironment.dispose();
    } catch (error) {
      /* best effort */
    }
  }
  if (wave.scene) {
    try {
      wave.scene.dispose();
    } catch (error) {
      /* best effort */
    }
  }
  state.wave = {
    group: null,
    scene: null,
    entries: [],
    camera: null,
    frameHook: null,
    previousEnvironment: undefined,
    previousLights: [],
    selected: null,
    drag: null,
    spacingCss: null,
    contact: null,
  };
  if (studio) {
    if (studio.heroRig) studio.heroRig.visible = true;
    if (studio.shadow) studio.shadow.visible = true;
    if (studio.glow) studio.glow.visible = true;
    if (typeof studio.setStatic === 'function') studio.setStatic(false);
    studio.canvas.style.cursor = '';
    if (typeof studio._computeFit === 'function') studio._computeFit();
    studio.renderNow();
  }
}

function waveScreenBounds() {
  return groupScreenBounds(state.wave.group);
}

/**
 * Revision 15: wave coin interaction.
 *
 *  - LEFT-drag on a coin rotates it on all three axes (camera-space trackball
 *    quaternion, no Euler clamp).
 *  - RIGHT-drag on a coin moves it in the camera screen plane (the coin follows
 *    the pointer; its depth plane is preserved).
 *  - Drags that start on empty space are left to the existing 360-degree orbit.
 *  Hit-testing uses a raycast against the three coin groups; the pointerdown
 *  capture listener stops the event before the orbit handlers see it.
 */
function waveEntryMeshes() {
  const meshes = [];
  const owners = new Map();
  for (const entry of state.wave.entries) {
    entry.coin.group.traverse((object) => {
      if (!object.isMesh) return;
      meshes.push(object);
      owners.set(object, entry);
    });
  }
  return { meshes, owners };
}

function wavePickCoin(clientX, clientY) {
  const studio = state.studio;
  if (!studio || !studio.camera || !state.wave.group) return null;
  const rect = studio.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  waveNdc.set(x, y);
  waveRaycaster.setFromCamera(waveNdc, studio.camera);
  const { meshes, owners } = waveEntryMeshes();
  const hits = waveRaycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  return owners.get(hits[0].object) || null;
}

function waveSetCursor(cursor) {
  if (!state.studio || !state.studio.canvas) return;
  state.studio.canvas.style.cursor = cursor;
}

function wavePointerDown(event) {
  if (state.mode !== 'wave' || state.shot || !state.wave.group) return;
  if (event.button !== 0 && event.button !== 2) return;
  const entry = wavePickCoin(event.clientX, event.clientY);
  if (!entry) return; // empty space: the studio orbit keeps handling it
  event.preventDefault();
  event.stopImmediatePropagation();
  const studio = state.studio;
  const holder = entry.holder;
  holder.updateMatrixWorld(true);
  const world = holder.getWorldPosition(new THREE.Vector3());
  studio.camera.getWorldDirection(waveScratch.forward);
  waveScratch.plane.setFromNormalAndCoplanarPoint(waveScratch.forward, world);
  const rect = studio.canvas.getBoundingClientRect();
  waveNdc.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  waveRaycaster.setFromCamera(waveNdc, studio.camera);
  const grab = waveRaycaster.ray.intersectPlane(waveScratch.plane, waveScratch.hit)
    ? waveScratch.hit.clone()
    : world.clone();
  state.wave.drag = {
    type: event.button === 2 ? 'move' : 'rotate',
    id: entry.id,
    pointerId: event.pointerId,
    lastX: event.clientX,
    lastY: event.clientY,
    plane: waveScratch.plane.clone(),
    grabOffset: world.clone().sub(grab),
  };
  state.wave.selected = entry.id;
  try {
    studio.canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    /* pointer capture is an enhancement */
  }
  waveSetCursor('grabbing');
  updateDiag();
}

function wavePointerMove(event) {
  if (state.mode !== 'wave' || state.shot) return;
  const drag = state.wave.drag;
  if (!drag) {
    const entry = wavePickCoin(event.clientX, event.clientY);
    waveSetCursor(entry ? 'grab' : '');
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const studio = state.studio;
  const entry = state.wave.entries.find((candidate) => candidate.id === drag.id);
  if (!studio || !entry) return;
  const holder = entry.holder;
  if (drag.type === 'rotate') {
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    studio.camera.matrixWorld.extractBasis(waveScratch.right, waveScratch.up, waveScratch.forward);
    waveScratch.right.normalize();
    waveScratch.up.normalize();
    waveScratch.quatX.setFromAxisAngle(waveScratch.right, dx * WAVE_ROTATE_SENSITIVITY);
    waveScratch.quatY.setFromAxisAngle(waveScratch.up, -dy * WAVE_ROTATE_SENSITIVITY);
    waveScratch.quat.copy(waveScratch.quatY).multiply(waveScratch.quatX);
    holder.quaternion.premultiply(waveScratch.quat).normalize();
  } else {
    const rect = studio.canvas.getBoundingClientRect();
    waveNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    waveRaycaster.setFromCamera(waveNdc, studio.camera);
    if (waveRaycaster.ray.intersectPlane(drag.plane, waveScratch.hit)) {
      waveScratch.world.copy(waveScratch.hit).add(drag.grabOffset);
      const local = state.wave.group.worldToLocal(waveScratch.world.clone());
      holder.position.copy(local);
    }
  }
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  holder.updateMatrixWorld(true);
  state.wave.group.updateMatrixWorld(true);
  state.wave.spacingCss = measureWaveSpacingCss();
  state.wave.contact = measureWaveContact();
  studio.renderNow();
}

function wavePointerUp(event) {
  const drag = state.wave.drag;
  if (!drag) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    state.studio.canvas.releasePointerCapture(drag.pointerId);
  } catch (error) {
    /* ignore */
  }
  state.wave.drag = null;
  waveSetCursor('');
  updateDiag();
}

function waveContextMenu(event) {
  if (state.mode !== 'wave') return;
  event.preventDefault();
}

async function resetWaveCoinTransforms() {
  if (!state.wave.group) return false;
  for (const entry of state.wave.entries) {
    if (!entry.defaults) continue;
    entry.holder.position.fromArray(entry.defaults.position);
    entry.holder.quaternion.fromArray(entry.defaults.quaternion);
    entry.holder.updateMatrixWorld(true);
  }
  state.wave.selected = null;
  state.wave.drag = null;
  state.wave.group.updateMatrixWorld(true);
  state.wave.spacingCss = measureWaveSpacingCss();
  state.wave.contact = measureWaveContact();
  if (state.studio) {
    state.studio.renderNow();
  }
  updateDiag();
  return true;
}

async function resetWaveView() {
  if (!state.wave.group) return false;
  await resetWaveCoinTransforms();
  const studio = state.studio;
  if (studio) {
    try {
      await studio.resetView({ immediate: true });
    } catch (error) {
      /* the orbit reset is best effort */
    }
    applyWaveFraming();
    studio.renderNow();
  }
  updateDiag();
  return true;
}

function bindWaveInteractions() {
  if (wavePointerBound || !state.studio) return;
  const canvas = state.studio.canvas;
  canvas.addEventListener('pointerdown', wavePointerDown, { capture: true, passive: false });
  canvas.addEventListener('pointermove', wavePointerMove, { capture: true, passive: false });
  canvas.addEventListener('pointerup', wavePointerUp, { capture: true, passive: false });
  canvas.addEventListener('pointercancel', wavePointerUp, { capture: true, passive: false });
  canvas.addEventListener('contextmenu', waveContextMenu);
  canvas.addEventListener('dblclick', (event) => {
    if (state.mode !== 'wave' || state.shot) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    resetWaveView().catch(() => undefined);
  }, { capture: true });
  wavePointerBound = true;
}

/** Dispose a wave coin plus the mode-local material clones backing it. */
function disposeWaveCoin(entry) {
  disposeCoin(entry.coin);
  for (const material of entry.clonedMaterials || []) {
    try {
      material.dispose();
    } catch (error) {
      /* best effort */
    }
  }
}

function buildWaveDebug() {
  if (state.mode !== 'wave' || !state.wave.group) return null;
  let sceneDebug = null;
  try {
    sceneDebug = state.wave.scene && state.wave.scene.debug ? state.wave.scene.debug() : null;
  } catch (error) {
    sceneDebug = null;
  }
  const stageRect = state.studio && state.studio.canvas ? state.studio.canvas.getBoundingClientRect() : null;
  const coins = state.wave.entries.map((entry) => {
    const contact = state.wave.contact && state.wave.contact.coins
      ? state.wave.contact.coins.find((coin) => coin.id === entry.id)
      : null;
    let screen = null;
    if (stageRect && stageRect.width > 0) {
      const point = waveEntryScreen(entry, stageRect, { x: 0, y: 0 });
      if (point) screen = [waveRound(point.x), waveRound(point.y)];
    }
    const materials = [];
    entry.coin.group.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const material = object.material;
      if (materials.some((item) => item.name === material.name)) return;
      materials.push({
        name: material.name || object.name,
        metalness: waveRound(material.metalness),
        roughness: waveRound(material.roughness),
        envMapIntensity: waveRound(material.envMapIntensity),
        envMap: Boolean(material.envMap),
        color: material.color && material.color.isColor ? '#' + material.color.getHexString() : null,
      });
    });
    return {
      id: entry.id,
      index: entry.index,
      position: [waveRound6(entry.holder.position.x), waveRound6(entry.holder.position.y), waveRound6(entry.holder.position.z)],
      quaternion: [
        waveRound6(entry.holder.quaternion.x),
        waveRound6(entry.holder.quaternion.y),
        waveRound6(entry.holder.quaternion.z),
        waveRound6(entry.holder.quaternion.w),
      ],
      defaultPosition: entry.defaults ? entry.defaults.position.slice() : null,
      defaultQuaternion: entry.defaults ? entry.defaults.quaternion.slice() : null,
      authoredContact: entry.layout ? entry.layout.contact.slice() : null,
      contactGap: contact ? contact.gap : null,
      penetration: contact ? contact.penetration : null,
      screen,
      materials,
    };
  });
  return {
    count: state.wave.entries.length,
    ids: state.wave.entries.map((entry) => entry.id),
    static: true,
    animated: false,
    design: WAVE.layout ? WAVE.layout.design : 'two-ribbon-waves',
    coins,
    selected: state.wave.selected,
    dragging: state.wave.drag ? state.wave.drag.type : null,
    contact: state.wave.contact,
    spacingCss: state.wave.spacingCss,
    spacing: WAVE.metrics ? WAVE.metrics.spacing : null,
    phase: WAVE.metrics ? WAVE.metrics.phase : null,
    camera: state.wave.camera,
    authoredCamera: WAVE.camera || null,
    accent: { gold: WAVE_GOLD_HEX, white: WAVE_WHITE_HEX, role: WAVE_ACCENT.role },
    scene: sceneDebug
      ? {
          design: sceneDebug.design,
          waves: sceneDebug.waves,
          materials: sceneDebug.materials,
          lights: sceneDebug.lights,
          environment: sceneDebug.environment,
          contactDecals: sceneDebug.contactDecals,
        }
      : null,
    screen: waveScreenBounds(),
  };
}

/* --------------------------------------------------------------- parade mode */

const PARADE_FACE_SIZE = PARADE.faceSize || 512;

/** Module-level playback switch shared by the API, stage button and Space key. */
function setParadePlaying(enabled) {
  if (state.mode !== 'parade' || !state.parade.group || state.shot) return false;
  state.parade.playing = Boolean(enabled);
  syncParadeUi();
  updateDiag();
  return state.parade.playing;
}

/** Deterministic Parade camera fit (telephoto fov + long-lens framing). */
function applyParadeFraming() {
  const studio = state.studio;
  const parade = state.parade;
  if (!studio || !parade.group) return;
  const pose = paradeCameraPose(studioAspect(studio));
  studio.camera.fov = pose.fovDeg;
  studio.camera.updateProjectionMatrix();
  studio._camTarget = pose.distance;
  studio._camDist = pose.distance;
  studio._camY = pose.position[1];
  studio.camera.position.fromArray(pose.position);
  studio.camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  studio.camera.updateMatrixWorld(true);
  parade.camera = {
    fov: round3(pose.fovDeg),
    fovDeg: round3(pose.fovDeg),
    distance: round3(pose.distance),
    cameraY: round3(pose.position[1]),
    elevationDeg: pose.elevationDeg,
    fitMargin: pose.fitMargin,
  };
}

/**
 * Neutral silver studio reflection map for the coin FACES only (texture-review
 * note: the studio's blue rim strip must never tint a whole satin face). The
 * reeded band/frame keep the Parade studio environment, so the cool accent
 * stays a thin rim/glass reflection; faces reflect soft white panels only.
 */
function buildParadeFaceEnvironment(renderer) {
  if (!renderer) return null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x23262a);
  const panelGeometry = new THREE.PlaneGeometry(12, 8);
  const panels = [
    { position: [0, 8, 0], intensity: 1.2 },
    { position: [-7, 2, 2], intensity: 1.6 },
    { position: [7, 2, 2], intensity: 1.6 },
    { position: [0, 1, 9], intensity: 2.15 },
    { position: [0, 2, -9], intensity: 0.8 },
  ];
  for (const panel of panels) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffffff).multiplyScalar(panel.intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(panelGeometry, material);
    mesh.position.fromArray(panel.position);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
  }
  let renderTarget = null;
  try {
    renderTarget = pmrem.fromScene(envScene, 0.05);
  } catch (error) {
    renderTarget = null;
  }
  pmrem.dispose();
  panelGeometry.dispose();
  envScene.traverse((object) => {
    if (object.isMesh && object.material) object.material.dispose();
  });
  envScene.clear();
  return renderTarget;
}

/**
 * Render density (Lead texture review): the reference carousel keeps 4-5 coins
 * overlapping across the frame. The modeler contract fixes seven currencies on a
 * 7-position ring (pose(0) mix), so the page renders eight ring positions with
 * one currency repeated (GBP, like Ring mode) using the same motion law — the
 * front arc then always has enough coins. Every term is periodic over 12 s, so
 * pose(t + 12 s) === pose(t) exactly. The debug contract still reports the
 * seven-currency contract (count/ids) plus renderedCount/ringPositions/repeated.
 */
const PARADE_RENDER_COUNT = 8;
const PARADE_RENDER_IDS = PARADE.ids.concat([PARADE.ids[0]]);
const PARADE_TAU = Math.PI * 2;
const paradeAxisY = new THREE.Vector3(0, 1, 0);
const paradeBasis = new THREE.Matrix4();
const paradeQuatYaw = new THREE.Quaternion();
const paradeQuatFace = new THREE.Quaternion();

const paradeNormalA = new THREE.Vector3();
const paradeRollPi = new THREE.Quaternion().setFromAxisAngle(paradeAxisY, Math.PI);

function paradeFacingQuaternion(angle, spin) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  // local +Y (face normal) -> radial direction, local -Z (face up) -> world +Y
  paradeBasis.makeBasis(
    new THREE.Vector3(sin, 0, -cos),
    new THREE.Vector3(cos, 0, sin),
    new THREE.Vector3(0, -1, 0)
  );
  paradeQuatFace.setFromRotationMatrix(paradeBasis);
  paradeQuatYaw.setFromAxisAngle(paradeAxisY, spin);
  const quaternion = paradeQuatYaw.clone().multiply(paradeQuatFace);
  // Revision 14 fix (modeler task-23): back-facing symbols need a hidden
  // half-turn in-plane roll; the flip happens exactly at edge-on, and it is the
  // same rule as paradePose() (quaternion * Ry(pi) while face b is toward +Z).
  paradeNormalA.set(0, 1, 0).applyQuaternion(quaternion);
  const facing = paradeNormalA.z < 0 ? 'b' : 'a';
  const roll = facing === 'b' ? Math.PI : 0;
  if (roll !== 0) quaternion.multiply(paradeRollPi);
  return { quaternion, facing, roll };
}

/** Page render pose: 8 evenly spaced positions, one currency repeated. */
function paradeRenderPose(seconds) {
  const loopTime = paradeLoopTime(seconds);
  const ringAngle = PARADE.ring.direction * PARADE_TAU * (loopTime / PARADE.durationSeconds);
  // Revision 15 (R15-2): coins no longer rotate about their own axes; only the
  // ring turns. The hidden back-face upright roll still follows the ring angle.
  const spinEnabled = Boolean(PARADE.spin && PARADE.spin.enabled);
  const spinPeriod = spinEnabled && Number.isFinite(PARADE.spin.periodSeconds) ? PARADE.spin.periodSeconds : 0;
  const spinAngle = spinEnabled && spinPeriod > 0
    ? PARADE.spin.direction * PARADE_TAU * (loopTime / spinPeriod)
    : 0;
  const coins = [];
  for (let index = 0; index < PARADE_RENDER_COUNT; index += 1) {
    const angle = PARADE.ring.startAngle + (index * PARADE_TAU) / PARADE_RENDER_COUNT + ringAngle;
    const spin = spinEnabled
      ? spinAngle + PARADE.spin.phaseOffset - (index * PARADE_TAU) / PARADE_RENDER_COUNT
      : 0;
    const oriented = paradeFacingQuaternion(angle, spin);
    const quaternion = oriented.quaternion;
    coins.push({
      id: PARADE_RENDER_IDS[index],
      index,
      angle,
      spin,
      facing: oriented.facing,
      roll: oriented.roll,
      position: [PARADE.ring.radius * Math.cos(angle), 0, PARADE.ring.radius * Math.sin(angle)],
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    });
  }
  return { time: loopTime, loopTime, ringAngle, spinAngle, coins };
}

/** Apply one deterministic paradeRenderPose(t) to the eight coin holders. */
function applyParadePose(seconds) {
  const parade = state.parade;
  if (!parade.group) return null;
  const pose = paradeRenderPose(seconds);
  for (let index = 0; index < parade.entries.length; index += 1) {
    const entry = parade.entries[index];
    const placement = pose.coins[index];
    if (!placement) continue;
    entry.holder.position.fromArray(placement.position);
    entry.holder.quaternion.fromArray(placement.quaternion);
  }
  parade.time = pose.loopTime;
  return pose;
}

/**
 * Build Parade mode: seven coins on a vertical carousel (deterministic 12 s
 * timeline) inside the purpose-built black strip-light PMREM studio. The coins
 * are real coin-model instances with mode-local material clones; the shared
 * bank materials are untouched, so Hero/Gallery keep their exact finish.
 */
async function buildParade() {
  if (!state.bank || !state.studio) return;
  setBusy(true, 'Building parade');
  disposeParadeView();
  const studio = state.studio;
  let paradeStudio = null;
  try {
    studio.setMode('hero');
    studio.heroRig.visible = false;
    studio.galleryGroup.visible = false;
    studio.shadow.visible = false;
    if (studio.glow) studio.glow.visible = false;
    studio.setSpin(false);
    if (typeof studio.setStatic === 'function') studio.setStatic(true);
    resetStudioView(studio);
    studio._coinGroups = [];

    paradeStudio = createParadeStudio({ renderer: studio.renderer });
    // The Parade studio lights live in world space next to the coin stage; the
    // coin studio's own warm/cool lights and point bounces are hidden for the
    // duration so the black strip-lit look matches the reference exactly.
    if (studio.scene) studio.scene.add(paradeStudio.group);
    const previousLights = [];
    if (studio.scene) {
      for (const child of studio.scene.children) {
        if (child.isLight) {
          previousLights.push({ light: child, visible: child.visible });
          child.visible = false;
        }
      }
    }
    const previousEnvironment = studio.scene ? studio.scene.environment : undefined;
    const previousBackground = studio.scene ? studio.scene.background : undefined;
    const previousFog = studio.scene ? studio.scene.fog : undefined;
    const previousExposure = studio.renderer ? studio.renderer.toneMappingExposure : null;
    const previousToneMapping = studio.renderer ? studio.renderer.toneMapping : null;
    const previousFov = studio.camera ? studio.camera.fov : 30;

    if (studio.scene) {
      studio.scene.environment = paradeStudio.environment.texture;
      studio.scene.background = new THREE.Color(PARADE.look.background);
      studio.scene.fog = paradeStudio.fog;
    }
    if (studio.renderer) {
      studio.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      studio.renderer.toneMappingExposure = PARADE.look.toneMappingExposure;
      studio.renderer.setClearColor(0x000000, 1);
    }

    const cameraPose = paradeCameraPose(studioAspect(studio));
    if (studio.camera) {
      studio.camera.fov = cameraPose.fovDeg;
      studio.camera.updateProjectionMatrix();
      studio.camera.position.fromArray(cameraPose.position);
      studio.camera.lookAt(cameraPose.target[0], cameraPose.target[1], cameraPose.target[2]);
      studio.camera.updateMatrixWorld(true);
    }
    const fogRange = paradeStudio.applySceneSettings(studio.scene, {
      cameraDistance: cameraPose.distance,
      exposure: PARADE.look.toneMappingExposure,
    });
    // Depth cueing: the studio default (0.82/1.34 x distance) crushes the far
    // arc to black; the composition contract's fadeNear/fadeFar (1.0/1.9) keeps
    // back coins dim but readable, like the reference.
    if (paradeStudio.fog) {
      paradeStudio.fog.near = cameraPose.distance * 0.95;
      paradeStudio.fog.far = cameraPose.distance * 1.7;
      if (studio.scene) studio.scene.fog = paradeStudio.fog;
      void fogRange;
    }

    const group = new THREE.Group();
    group.name = 'coin-parade';
    const faceEnvironment = buildParadeFaceEnvironment(studio.renderer);
    const entries = [];
    const shotPose = paradeRenderPose(PARADE.shotTime);
    for (let index = 0; index < PARADE_RENDER_IDS.length; index += 1) {
      const id = PARADE_RENDER_IDS[index];
      const spec = specById(id);
      if (!spec) continue;
      const coin = makeCoin(spec, PARADE_FACE_SIZE);
      const prepared = prepareParadeCoin(coin);
      const holder = new THREE.Group();
      holder.name = 'parade-coin:' + index + ':' + id;
      const placement = shotPose.coins[index];
      if (placement) {
        holder.position.fromArray(placement.position);
        holder.quaternion.fromArray(placement.quaternion);
      }
      holder.add(coin.group);
      group.add(holder);
      entries.push({ id, index, coin, holder, prepared });
    }
    if (!entries.length) throw new Error('no coin specs available for the parade');
    // Look polish (texture-review notes): keep the satin faces neutral silver —
    // the modeler's studio blue rim strip must only accent the reeded band/rim,
    // not tint whole faces — and keep the far arc dim but readable.
    for (const entry of entries) {
      for (const mesh of entry.prepared.meshes) {
        const material = mesh.material;
        if (!material) continue;
        const role =
          mesh.name === 'band' ? 'band' : mesh.name === 'frame' ? 'frame' : mesh.name === 'wall' ? 'wall' : 'face';
        if (role !== 'face') continue;
        if (faceEnvironment && faceEnvironment.texture) material.envMap = faceEnvironment.texture;
        material.envMapIntensity = 0.68;
        if (Number.isFinite(material.metalness)) material.metalness = Math.min(material.metalness, 0.72);
        if (Number.isFinite(material.roughness)) material.roughness = Math.max(material.roughness, 0.46);
        if (material.color && material.color.isColor) material.color.set('#b0b3b6');
        material.needsUpdate = true;
      }
    }
    studio.orbit.add(group);

    state.parade = {
      group,
      studio: paradeStudio,
      entries,
      previousEnvironment,
      previousBackground,
      previousFog,
      previousExposure,
      previousToneMapping,
      previousFov,
      playing: false,
      time: PARADE.shotTime,
      frameHook: null,
      camera: null,
      previousLights,
      faceEnvironment,
      spacing: paradeRingSpacing ? paradeRingSpacing() : null,
    };
    applyParadePose(PARADE.shotTime);
    applyParadeFraming();

    const autoplay = !state.shot && !state.reducedMotion && !state.capture;
    state.parade.playing = autoplay;
    state.parade.frameHook = installFrameHook(studio, (dt) => {
      const parade = state.parade;
      if (!parade.group || !parade.playing) return;
      const step = Math.max(0, Math.min(0.1, dt));
      applyParadePose(parade.time + step);
    });
    if (state.booting) curtainProgress(0.8, 'Building parade', entries.length + ' / ' + PARADE.count);
    studio.renderNow();
    await studio.whenStable();
    studio.renderNow();
  } catch (error) {
    if (paradeStudio) {
      try {
        paradeStudio.dispose();
      } catch (disposeError) {
        /* best effort */
      }
    }
    pushError('parade build failed: ' + errorMessage(error));
    showErrorBanner('Could not render the coin parade: ' + errorMessage(error));
    if (studio) {
      if (studio.heroRig) studio.heroRig.visible = true;
      if (studio.shadow) studio.shadow.visible = true;
      if (studio.glow) studio.glow.visible = true;
      if (typeof studio.setStatic === 'function') studio.setStatic(false);
      if (typeof studio._computeFit === 'function') studio._computeFit();
    }
    throw error;
  } finally {
    setBusy(false);
    syncParadeUi();
  }
  updateDiag();
}

/** Tear down Parade and restore the silver studio (env, fog, fov, visibility). */
function disposeParadeView() {
  const studio = state.studio;
  const parade = state.parade;
  if (parade.frameHook) {
    try {
      parade.frameHook();
    } catch (error) {
      /* hook teardown is best effort */
    }
    parade.frameHook = null;
  }
  if (parade.group && parade.group.parent) parade.group.parent.remove(parade.group);
  for (const entry of parade.entries) {
    disposeCoin(entry.coin);
    if (entry.prepared) {
      try {
        entry.prepared.dispose();
      } catch (error) {
        /* best effort */
      }
    }
  }
  if (studio && studio.scene) {
    if (parade.previousEnvironment !== undefined) studio.scene.environment = parade.previousEnvironment || null;
    studio.scene.background = parade.previousBackground === undefined ? null : parade.previousBackground;
    studio.scene.fog = parade.previousFog === undefined ? null : parade.previousFog;
  }
  if (studio && studio.renderer) {
    studio.renderer.setClearColor(0x000000, 0);
    if (parade.previousExposure !== null) studio.renderer.toneMappingExposure = parade.previousExposure;
    if (parade.previousToneMapping !== null) studio.renderer.toneMapping = parade.previousToneMapping;
  }
  if (studio && studio.camera && Number.isFinite(parade.previousFov)) {
    studio.camera.fov = parade.previousFov;
    studio.camera.updateProjectionMatrix();
  }
  if (parade.studio) {
    try {
      parade.studio.dispose();
    } catch (error) {
      /* best effort */
    }
  }
  for (const entry of parade.previousLights || []) {
    if (entry && entry.light) entry.light.visible = entry.visible !== false;
  }
  if (parade.faceEnvironment) {
    try {
      parade.faceEnvironment.dispose();
    } catch (error) {
      /* best effort */
    }
  }
  state.parade = {
    group: null,
    studio: null,
    entries: [],
    previousEnvironment: undefined,
    previousBackground: undefined,
    previousFog: undefined,
    previousExposure: null,
    previousToneMapping: null,
    previousFov: 30,
    playing: false,
    time: PARADE.shotTime,
    frameHook: null,
    camera: null,
    previousLights: [],
    faceEnvironment: null,
    spacing: null,
  };
  if (studio) {
    if (studio.heroRig) studio.heroRig.visible = true;
    if (studio.galleryGroup) studio.galleryGroup.visible = studio.mode === 'gallery';
    if (studio.shadow) studio.shadow.visible = true;
    if (studio.glow) studio.glow.visible = true;
    if (typeof studio.setStatic === 'function') studio.setStatic(false);
    if (typeof studio._computeFit === 'function') studio._computeFit();
    studio.renderNow();
  }
}

/** QA/debug snapshot of the Parade mode (SPEC R14-1 QA/API contract). */
function buildParadeDebug() {
  if (state.mode !== 'parade' || !state.parade.group) return null;
  const time = paradeLoopTime(state.parade.time);
  const pose = paradeRenderPose(time);
  let studioDebug = null;
  try {
    studioDebug = state.parade.studio && state.parade.studio.debug ? state.parade.studio.debug() : null;
    if (studioDebug && state.parade.studio && state.parade.studio.fog) {
      studioDebug.fog = {
        color: PARADE.depth.fogColor,
        near: round3(state.parade.studio.fog.near),
        far: round3(state.parade.studio.fog.far),
      };
    }
  } catch (error) {
    studioDebug = null;
  }
  let loopSeamOk = true;
  try {
    const a = JSON.stringify(paradePose(PARADE.shotTime));
    const b = JSON.stringify(paradePose(PARADE.shotTime + PARADE.durationSeconds));
    const renderA = JSON.stringify(paradeRenderPose(PARADE.shotTime));
    const renderB = JSON.stringify(paradeRenderPose(PARADE.shotTime + PARADE.durationSeconds));
    loopSeamOk = a === b && renderA === renderB;
  } catch (error) {
    loopSeamOk = false;
  }
  return {
    count: PARADE.count,
    ids: PARADE.ids.slice(),
    renderedCount: state.parade.entries.length,
    ringPositions: PARADE_RENDER_COUNT,
    repeated: PARADE_RENDER_IDS[PARADE_RENDER_COUNT - 1],
    playing: Boolean(state.parade.playing),
    time: round3(time),
    duration: PARADE.durationSeconds,
    loopTime: round3(time),
    ringAngle: round3(pose.ringAngle),
    spinEnabled: Boolean(PARADE.spin && PARADE.spin.enabled),
    spinPeriod: PARADE.spin && PARADE.spin.enabled ? PARADE.spin.periodSeconds : 0,
    spinAngle: round3(pose.spinAngle),
    camera: state.parade.camera,
    studio: studioDebug,
    // Upright-symbol invariant data (modeler task-23): each rendered coin's
    // authored face toward the camera and the in-plane half-turn roll.
    coins: pose.coins.map((coin) => ({
      id: coin.id,
      facing: coin.facing,
      roll: round3(coin.roll),
      angle: round3(coin.angle),
      spin: round3(coin.spin),
    })),
    static: Boolean(state.shot || state.still || state.reducedMotion || !state.parade.playing),
    loopSeamOk,
    spacing: state.parade.spacing
      ? {
          chord: state.parade.spacing.chord,
          clearance: state.parade.spacing.clearance,
          minRadius: state.parade.spacing.minRadius,
          radius: state.parade.spacing.radius,
        }
      : null,
    frontScreen: paradeFrontScreen(),
    groupScreen: groupScreenBounds(state.parade.group),
  };
}

/** Projected bounds of the nearest (front) coin only — the far arc may crop. */
function paradeFrontScreen() {
  if (!state.parade.group) return null;
  let front = null;
  const position = new THREE.Vector3();
  for (const entry of state.parade.entries) {
    entry.holder.updateWorldMatrix(true, false);
    entry.holder.getWorldPosition(position);
    if (!front || position.z > front.z) front = { z: position.z, holder: entry.holder };
  }
  return front ? groupScreenBounds(front.holder) : null;
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
    else if (state.mode === 'wave') await buildWave();
    else if (state.mode === 'parade') await buildParade();
    else if (state.mode === 'gallery') await buildGalleryCoins();
    else await buildHeroCoin();
    if (state.studio) {
      // Composition modes already configured their own rig/camera/visibility.
      if (state.mode !== 'ring' && state.mode !== 'stack' && state.mode !== 'wave' && state.mode !== 'parade') {
        state.studio.setMode(state.mode);
      }
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
      state.mode === 'parade'
        ? 'Parade'
        : state.mode === 'wave'
          ? 'Wave'
          : state.mode === 'stack'
            ? 'Stack'
            : state.mode === 'ring'
              ? 'Ring'
              : state.mode === 'gallery'
                ? 'Gallery'
                : 'Ready';
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
  if (dom.btnWave) {
    dom.btnWave.addEventListener('click', () => {
      runExclusive(() => applyMode(state.mode === 'wave' ? 'hero' : 'wave')).then(refreshScene, () => undefined);
    });
  }
  if (dom.btnParade) {
    dom.btnParade.addEventListener('click', () => {
      runExclusive(() => applyMode(state.mode === 'parade' ? 'hero' : 'parade')).then(refreshScene, () => undefined);
    });
  }
  if (dom.btnParadePlay) {
    dom.btnParadePlay.addEventListener('click', () => {
      if (state.mode !== 'parade') return;
      runExclusive(async () => {
        setParadePlaying(!state.parade.playing);
        refreshScene();
      }).then(refreshScene, () => undefined);
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
      case 'w':
      case 'W':
        runExclusive(() => applyMode(state.mode === 'wave' ? 'hero' : 'wave')).then(refreshScene, () => undefined);
        break;
      case 'p':
      case 'P':
        runExclusive(() => applyMode(state.mode === 'parade' ? 'hero' : 'parade')).then(refreshScene, () => undefined);
        break;
      case 's':
      case 'S':
        if (state.reducedMotion || state.mode === 'ring' || state.mode === 'stack' || state.mode === 'wave' || state.mode === 'parade') break;
        state.spin = !state.spin;
        if (state.studio) state.studio.setSpin(state.spin);
        syncSpinUi();
        updateDiag();
        break;
      case 'r':
      case 'R':
        runExclusive(async () => {
          if (state.mode === 'wave') await resetWaveView();
          else if (state.studio) await state.studio.resetView();
          refreshScene();
        }).then(refreshScene, () => undefined);
        break;
      case ' ':
      case 'Spacebar':
        if (state.mode !== 'parade') break;
        event.preventDefault();
        runExclusive(async () => {
          setParadePlaying(!state.parade.playing);
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
