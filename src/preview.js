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
 */
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
  btnFlip: document.getElementById('btn-flip'),
  btnSpin: document.getElementById('btn-spin'),
  btnGallery: document.getElementById('btn-gallery'),
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

const state = {
  ready: false,
  failed: false,
  specs: [],
  bank: null,
  studio: null,
  coin: '',
  face: 'a',
  mode: 'hero',
  spin: false,
  shot: urlParams.get('shot') === '1',
  tilt: urlParams.get('tilt') === '1',
  reducedMotion: reducedMotionQuery.matches,
  heroCoin: null,
  galleryCoins: [],
  labels: new Map(),
  busy: false,
  booting: true,
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
}

function syncFaceUi() {
  // Both faces carry the identical symbol; a/b are only the two sides.
  dom.body.dataset.face = state.face;
}

function syncSpinUi() {
  dom.btnSpin.setAttribute('aria-pressed', String(state.spin));
  if (state.reducedMotion) {
    dom.btnSpin.disabled = true;
    dom.btnSpin.title = 'Auto-spin is disabled by the reduced-motion preference.';
  }
}

function syncModeUi() {
  dom.body.dataset.mode = state.mode;
  dom.btnGallery.setAttribute('aria-pressed', String(state.mode === 'gallery'));
  dom.stageEyebrow.textContent = state.mode === 'gallery' ? 'Gallery · seven coins' : 'Silver studio';
  dom.infoFootState.textContent = state.mode === 'gallery' ? 'Gallery' : 'Hero';
  dom.galleryLabels.hidden = state.mode !== 'gallery';
  if (state.ready) dom.footerStatus.textContent = state.mode === 'gallery' ? 'Gallery' : 'Ready';
}

function syncShotUi() {
  if (state.shot) dom.body.dataset.shot = '1';
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
    view: state.studio && state.studio.getView ? state.studio.getView() : { yaw: 0, pitch: 0, dragging: false },
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
    if (mode !== 'hero' && mode !== 'gallery') return false;
    return runExclusive(async () => {
      await applyMode(mode);
      refreshScene();
      return true;
    });
  },
  async flip() {
    return runExclusive(async () => {
      await flipCoin();
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

async function flipCoin() {
  if (!state.studio) return;
  const next = state.face === 'a' ? 'b' : 'a';
  state.face = next;
  syncFaceUi();
  updateDiag();
  await state.studio.setFace(next);
  updateDiag();
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
  const next = mode === 'gallery' ? 'gallery' : 'hero';
  if (state.mode === next && (next === 'gallery' ? state.galleryCoins.length : state.heroCoin)) {
    syncModeUi();
    return;
  }
  disposeView(next);
  state.mode = next;
  syncModeUi();
  if (state.studio) state.studio.setMode(next);
  if (next === 'gallery') await buildGalleryCoins();
  else await buildHeroCoin();
  if (state.studio) {
    state.studio.setMode(next);
    state.studio.setSelection(state.coin);
    state.studio.renderNow();
  }
  updateDiag();
}

function disposeView(nextMode) {
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
  state.mode = urlParams.get('mode') === 'gallery' ? 'gallery' : 'hero';
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
      // Revision 4: the scene owns pointer gestures; it reports taps back so a
      // click (not a drag) still flips the coin / opens a gallery coin.
      onTap: () => {
        runExclusive(() => flipCoin()).then(refreshScene, () => undefined);
      },
      onGalleryTap: (id) => {
        runExclusive(async () => {
          await selectCoin(id);
          await applyMode('hero');
        }).then(refreshScene, () => undefined);
      },
    });
    await state.studio.init();
  } catch (error) {
    showFallback('The WebGL studio could not start (' + errorMessage(error) + ').', error);
    return;
  }

  try {
    if (state.mode === 'gallery') await buildGalleryCoins();
    else await buildHeroCoin();
    if (state.studio) {
      state.studio.setMode(state.mode);
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
    dom.footerStatus.textContent = state.mode === 'gallery' ? 'Gallery' : 'Ready';
    syncModeUi();
    syncFaceUi();
    syncSpinUi();
    if (state.studio) {
      if (!state.shot) state.studio.playIntro();
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
  dom.btnFlip.addEventListener('click', () => {
    runExclusive(() => flipCoin()).then(refreshScene, () => undefined);
  });
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
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        runExclusive(() => flipCoin()).then(refreshScene, () => undefined);
        break;
      case 'g':
      case 'G':
        runExclusive(() => applyMode(state.mode === 'gallery' ? 'hero' : 'gallery')).then(refreshScene, () => undefined);
        break;
      case 's':
      case 'S':
        if (state.reducedMotion) break;
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
