/**
 * tekoanimation — iPhone 15 · Model Studio (Revision 7).
 *
 * Adapted from the standalone K:\iPhone-15-ThreeJS app.js (Three.js r0.180.0).
 * The renderer, PMREM/RoomEnvironment lighting, camera, OrbitControls, view
 * presets, display toggle, screen-artwork upload/restore, reset and GLB export
 * are kept. The finish is BLACK ONLY: the finish panel is static and no other
 * finish can be selected through the UI or the public API.
 *
 * Public QA API (SPEC R7-3): window.__tekoPhone = { ready, setView,
 * setScreenOn, setAutoRotate, resetView, debug } (+ exportModel for QA).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createPhone, finishes } from './phone-model.js';

const VERSION = '1.0.0';
const FINISH = 'Black';
const FIGMA_ARTWORK = './assets/phone/figma-screen.png';
const VIEWS = {
  hero: [-0.145, 0.065, 0.275],
  front: [0, 0, 0.315],
  back: [0, 0, -0.315],
  side: [0.315, 0, 0.005],
};
const VIEW_NAMES = Object.keys(VIEWS);

const params = new URLSearchParams(window.location.search);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const errors = [];

const dom = {
  body: document.body,
  viewport: document.getElementById('viewport'),
  loading: document.getElementById('loading'),
  fallback: document.getElementById('fallback'),
  status: document.getElementById('status'),
  finishLabel: document.getElementById('finish-label'),
  colorName: document.getElementById('color-name'),
  rotate: document.getElementById('rotate'),
  screen: document.getElementById('screen'),
  artwork: document.getElementById('artwork'),
  restore: document.getElementById('restore'),
  export: document.getElementById('export'),
  reset: document.getElementById('reset'),
};

const requestedView = VIEW_NAMES.includes(params.get('view')) ? params.get('view') : null;
const shot = params.get('shot') === '1';
const state = {
  ready: false,
  failed: false,
  view: shot && !requestedView ? 'hero' : requestedView || 'hero',
  screenOn: params.get('screen') === '0' ? false : true,
  autoRotate: params.get('rotate') === '1',
  shot,
  reducedMotion,
};
if (shot) state.autoRotate = false;
if (reducedMotion) state.autoRotate = false;

function pushError(message) {
  errors.push('phone: ' + String(message));
  if (errors.length > 40) errors.splice(0, errors.length - 40);
}

function setStatus(message) {
  if (dom.status) dom.status.textContent = message;
}

function showFallback(message) {
  state.failed = true;
  state.ready = false;
  pushError(message);
  if (dom.loading) dom.loading.hidden = true;
  if (dom.fallback) {
    dom.fallback.hidden = false;
    dom.fallback.innerHTML = '<p>' + message + ' <a href="./">Back to the coin studio</a>.</p>';
  }
  dom.body.dataset.fallback = '1';
  dom.body.dataset.qaReady = '0';
  dom.body.dataset.qaErrors = String(errors.length);
  if (dom.viewport) dom.viewport.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
}

/* ------------------------------------------------------------- renderer */

function probeWebGL() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch (error) {
    return false;
  }
}

let renderer = null;
if (probeWebGL()) {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (error) {
    renderer = null;
  }
}
if (!renderer) {
  showFallback('WebGL is unavailable in this browser, so the 3D phone cannot be rendered. Enable hardware acceleration and reload.');
}

const api = {
  version: VERSION,
  ready: false,
  setView: () => false,
  setScreenOn: () => false,
  setAutoRotate: () => false,
  resetView: () => false,
  debug: () => ({
    ready: state.ready,
    finish: FINISH,
    view: state.view,
    screenOn: state.screenOn,
    autoRotate: state.autoRotate,
    errors: errors.slice(),
  }),
  exportModel: async () => null,
};
window.__tekoPhone = api;

if (renderer) {
  boot(renderer);
}

function boot(webglRenderer) {
  webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  webglRenderer.setClearColor(0x000000, 0);
  webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  webglRenderer.toneMappingExposure = 1.15;
  dom.viewport.prepend(webglRenderer.domElement);
  webglRenderer.domElement.setAttribute('aria-label', 'iPhone 15 3D model. Drag to rotate, scroll to zoom, right-drag to pan, or use the view buttons.');
  webglRenderer.domElement.tabIndex = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
  const controls = new OrbitControls(camera, webglRenderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.16;
  controls.maxDistance = 0.65;
  controls.autoRotateSpeed = 1.2;
  controls.target.set(0, 0, 0);

  const pmrem = new THREE.PMREMGenerator(webglRenderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xaab69e, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(-0.1, 0.2, 0.3);
  scene.add(light);

  const phone = createPhone();
  scene.add(phone.root);
  phone.screenOn(state.screenOn);
  surfaceFinish();

  function surfaceFinish() {
    // The model only exposes the Black finish; keep the UI in sync and assert it.
    if (!phone.setFinish || phone.setFinish(FINISH) === false) pushError('the Black finish was not applied');
    if (dom.colorName) dom.colorName.textContent = FINISH;
    if (dom.finishLabel) dom.finishLabel.textContent = FINISH.toUpperCase();
    dom.body.dataset.finish = FINISH;
  }

  function syncViewButtons() {
    document.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    dom.body.dataset.view = state.view;
  }

  function setView(name) {
    if (!VIEW_NAMES.includes(name)) return false;
    state.view = name;
    camera.position.fromArray(VIEWS[name]);
    controls.target.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    controls.update();
    syncViewButtons();
    return true;
  }

  function syncToggles() {
    if (dom.rotate) {
      dom.rotate.setAttribute('aria-pressed', String(state.autoRotate));
      const label = dom.rotate.querySelector('span');
      if (label) label.textContent = state.autoRotate ? 'ON' : 'OFF';
    }
    if (dom.screen) {
      dom.screen.setAttribute('aria-pressed', String(state.screenOn));
      const label = dom.screen.querySelector('span');
      if (label) label.textContent = state.screenOn ? 'ON' : 'OFF';
    }
    dom.body.dataset.rotate = state.autoRotate ? '1' : '0';
    dom.body.dataset.screen = state.screenOn ? '1' : '0';
  }

  function setAutoRotate(on) {
    if (state.shot) return false;
    state.autoRotate = Boolean(on);
    controls.autoRotate = state.autoRotate;
    syncToggles();
    return state.autoRotate;
  }

  function setScreenOn(on) {
    state.screenOn = Boolean(on);
    phone.screenOn(state.screenOn);
    syncToggles();
    return state.screenOn;
  }

  function resetView() {
    setAutoRotate(false);
    setView('hero');
    return true;
  }

  function imageTexture(image) {
    const canvas = document.createElement('canvas');
    canvas.width = 1179;
    canvas.height = 2556;
    const context = canvas.getContext('2d');
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = webglRenderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  function loadArtwork(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        phone.setScreen(imageTexture(image));
        resolve(true);
      };
      image.onerror = () => reject(new Error('Could not load screen image'));
      image.src = url;
    });
  }

  let readyPromise = null;

  async function exportModel() {
    if (readyPromise) await readyPromise.catch(() => undefined);
    return new GLTFExporter().parseAsync(phone.root, { binary: true, maxTextureSize: 4096 });
  }

  /* ---------------------------------------------------------------- UI */

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  if (dom.rotate) dom.rotate.addEventListener('click', () => setAutoRotate(!state.autoRotate));
  if (dom.screen) dom.screen.addEventListener('click', () => setScreenOn(!state.screenOn));
  if (dom.reset) dom.reset.addEventListener('click', () => resetView());
  if (dom.restore) {
    dom.restore.addEventListener('click', async () => {
      try {
        await loadArtwork(FIGMA_ARTWORK);
        setScreenOn(true);
        setStatus('Original Figma artwork restored.');
      } catch (error) {
        pushError(error.message);
        setStatus(error.message);
      }
    });
  }
  if (dom.artwork) {
    dom.artwork.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        setStatus('Choose a PNG, JPEG or WebP image.');
        return;
      }
      const url = URL.createObjectURL(file);
      try {
        await loadArtwork(url);
        setScreenOn(true);
        setStatus('Screen artwork updated.');
      } catch (error) {
        pushError(error.message);
        setStatus(error.message);
      } finally {
        URL.revokeObjectURL(url);
        event.target.value = '';
      }
    });
  }
  if (dom.export) {
    dom.export.addEventListener('click', async () => {
      dom.export.disabled = true;
      setStatus('Preparing GLB…');
      try {
        const data = await exportModel();
        const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'iphone-15-black.glb';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        setStatus('GLB exported with the black finish and screen.');
      } catch (error) {
        pushError(error.message);
        setStatus('Export failed: ' + error.message);
      } finally {
        dom.export.disabled = false;
      }
    });
  }

  new ResizeObserver(() => {
    const { width, height } = dom.viewport.getBoundingClientRect();
    if (!width || !height) return;
    webglRenderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }).observe(dom.viewport);

  webglRenderer.setAnimationLoop(() => {
    controls.update();
    webglRenderer.render(scene, camera);
  });

  /* ------------------------------------------------------------- boot */

  setView(state.view);
  syncToggles();

  readyPromise = loadArtwork(FIGMA_ARTWORK)
    .then(() => {
      setScreenOn(state.screenOn);
      if (dom.loading) dom.loading.hidden = true;
      state.ready = true;
      dom.body.dataset.qaReady = '1';
      dom.body.dataset.qaErrors = String(errors.length);
      dom.body.dataset.shot = state.shot ? '1' : '0';
      setAutoRotate(state.autoRotate);
      setView(state.view);
      setStatus('Black finish · drag to rotate, scroll to zoom.');
      api.ready = true;
    })
    .catch((error) => {
      pushError(error.message);
      if (dom.loading) dom.loading.hidden = true;
      if (dom.fallback) {
        dom.fallback.hidden = false;
        dom.fallback.innerHTML = '<p>Could not load the screen artwork (' + error.message + '). <a href="./phone.html">Reload the studio</a>.</p>';
      }
      dom.body.dataset.qaErrors = String(errors.length);
      dom.body.dataset.qaReady = '0';
    });

  // Deterministic QA captures render on demand.
  if (state.shot) {
    webglRenderer.setAnimationLoop(() => {
      webglRenderer.render(scene, camera);
    });
  }

  api.setView = setView;
  api.setScreenOn = setScreenOn;
  api.setAutoRotate = setAutoRotate;
  api.resetView = resetView;
  api.exportModel = exportModel;
  api.debug = () => ({
    ready: state.ready,
    finish: FINISH,
    view: state.view,
    screenOn: state.screenOn,
    autoRotate: state.shot ? false : Boolean(controls.autoRotate),
    errors: errors.slice(),
  });

  // Kept for compatibility with the standalone studio's embedding API.
  window.phoneStudio = {
    phone,
    scene,
    camera,
    controls,
    renderer: webglRenderer,
    ready: readyPromise,
    setView,
    exportModel,
  };
}

/* ------------------------------------------------------ global errors */

window.addEventListener('error', (event) => {
  pushError(event.message || 'unknown error');
  dom.body.dataset.qaErrors = String(errors.length);
});
window.addEventListener('unhandledrejection', (event) => {
  pushError(event.reason && event.reason.message ? event.reason.message : String(event.reason));
  dom.body.dataset.qaErrors = String(errors.length);
});

// Keep the debug snapshot fresh for QA (errors appear asynchronously).
window.setInterval(() => {
  dom.body.dataset.qaErrors = String(errors.length);
  dom.body.dataset.qaReady = state.ready ? '1' : '0';
}, 400);

// Data-* mirror for the URL state (handy for automation and CSS).
dom.body.dataset.shot = state.shot ? '1' : '0';
dom.body.dataset.qaErrors = String(errors.length);