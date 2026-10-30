/**
 * s54 - dark + light metal cards lean onto two giant columns (low + high), then the
 * camera orbits azimuth 45 -> 30 deg. Units are card units; the cards are never
 * scaled. Pose / camera math lives in ./cards-columns-pose.js (pure, node-testable).
 * IBL only (two env handles, no THREE lights). ?still=1 / ?shot=1 / reduced motion
 * render the held end state; ?t=<s> seeks (paused) for captures.
 */
import * as THREE from 'three';
import { createEnvRoom } from './env-room.js';
import { loadCardBank, CARD_METRICS } from './card-model.js';
import { loadColumnBank, createColumns } from './columns-model.js';
import {
  layout, hull2, solveLean, leanProgress, cardZ, azimuthAt, cameraPosition,
  PHASE, TOTAL_TIME, LEAN_DEG, CAMERA, AZ_SIGN
} from './cards-columns-pose.js';

const params = new URLSearchParams(location.search);
const STILL = params.get('still') === '1';
const SHOT = params.get('shot') === '1';
const SEEK = params.has('t') ? Number(params.get('t')) : null;
const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const HELD = STILL || SHOT || REDUCED;

const MATERIALS = ['plaster', 'reeded-metal', 'satin', 'grain-metal', 'titanium'];
const MIRROR = { satin: 7, plaster: 3, 'reeded-metal': 2.6, topPlate: 3.2, 'grain-metal': 3, titanium: 3.2 };
const DEG2RAD = Math.PI / 180;
const CARD_ENV_DEG = (() => { const q = params.get('cardenv'); if (q) { const v = q.split(',').map(Number); if (v.length === 3 && v.every(Number.isFinite)) return v; } return [0, 0, 90]; })();
const CARD_ENV = { boost: 7, rotation: CARD_ENV_DEG.map((d) => d * DEG2RAD), intensity: 1 };
const EXPOSURE = 1.3;
const FRAME_MARGIN = 1.08;

const body = document.body;
const canvas = document.getElementById('stage-canvas');
const stage = document.getElementById('stage');
let errors = 0;
const bumpErrors = () => { errors += 1; body.dataset.qaErrors = String(errors); };
window.addEventListener('error', bumpErrors);
window.addEventListener('unhandledrejection', bumpErrors);

const qa = { ready: false, material: 'satin', time: 0, playing: false };
window.__cardsColumns = qa;

function fail(msg) {
  const el = document.getElementById('stage-error');
  if (el) { el.textContent = msg; el.hidden = false; }
  bumpErrors();
}

async function main() {
  const lay = layout(CARD_METRICS);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 2000);

  const [cardEnv, colEnv, cardBank, colBank] = await Promise.all([
    createEnvRoom(THREE, renderer, CARD_ENV),
    createEnvRoom(THREE, renderer, { intensity: 1 }),
    loadCardBank({ assetBase: './assets/textures/card' }),
    loadColumnBank({ assetBase: './assets/textures/materials' })
  ]);
  cardEnv.bind(scene);

  /* columns: the 5 x (large-short, large-long) at physical pattern scale */
  const cols = createColumns(colBank, { quality: 'hero', patternDivisor: 1 });
  for (const m of MATERIALS) {
    const mat = colBank.materials[m];
    mat.envMap = colEnv.texture;
    mat.envMapIntensity = MIRROR[m];
    mat.needsUpdate = true;
  }
  if (cols.topMaterial) {
    cols.topMaterial.envMap = colEnv.texture;
    cols.topMaterial.envMapIntensity = MIRROR.topPlate;
    cols.topMaterial.needsUpdate = true;
  }
  const columnRoot = new THREE.Group();
  scene.add(columnRoot);
  const pairs = {};
  for (const m of MATERIALS) {
    const low = cols.columnsById[m + '-large-short'].mesh;
    const high = cols.columnsById[m + '-large-long'].mesh;
    for (const mesh of [low, high]) {
      mesh.scale.setScalar(lay.meshScale);
      columnRoot.add(mesh);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
    low.position.set(-lay.E / 2, lay.lowH / 2, 0);
    high.position.set(lay.E / 2, lay.highH / 2, 0);
    pairs[m] = { low, high };
  }
  columnRoot.updateMatrixWorld(true);

  /* cards: dark + light, real geometry, unscaled */
  const cards = [];
  for (const id of ['dark', 'light']) {
    const spec = cardBank.specs.find((s) => s.id === id);
    const card = cardBank.createCard(spec, { quality: 'hero' });
    cards.push({ id, group: card.group, card });
  }
  const profiles = cards.map((c) => {
    c.group.updateMatrixWorld(true);
    const pts = [];
    const v = new THREE.Vector3();
    c.group.traverse((o) => {
      if (!o.isMesh || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        pts.push([-v.z, v.x]);
      }
    });
    return hull2(pts);
  });
  const solves = profiles.map((p) => solveLean(lay, p));
  const base = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0));
  const baseQ = new THREE.Quaternion().setFromRotationMatrix(base);
  const zAxis = new THREE.Vector3(0, 0, 1);
  cards.forEach((c) => scene.add(c.group));

  /* fixed framing: pair centre + sphere over cards and both column tops */
  const endPoses = solves.map((s) => s.pose(s.phiEnd));
  const E = lay.E;
  const target = [(endPoses[0].x + endPoses[1].x) / 2, (endPoses[0].y + endPoses[1].y) / 2, 0];
  const frameSet = [];
  for (const x of [-E, 0, E]) for (const z of [-E / 2, E / 2]) frameSet.push([x, x <= 0 ? lay.lowH : lay.highH, z]);
  frameSet.push([0, lay.lowH, -E / 2], [0, lay.lowH, E / 2]);
  endPoses.forEach((p, i) => {
    for (const dx of [-2, 2]) for (const dy of [-2.2, 2.2]) frameSet.push([p.x + dx, p.y + dy, cardZ(i, CARD_METRICS)]);
  });
  let R = 0;
  for (const q of frameSet) R = Math.max(R, Math.hypot(q[0] - target[0], q[1] - target[1], q[2] - target[2]));
  let distance = 100;
  function fit() {
    const w = stage.clientWidth || 1200;
    const h = stage.clientHeight || 700;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const vHalf = (CAMERA.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    distance = (R / Math.sin(Math.min(vHalf, hHalf))) * FRAME_MARGIN;
    camera.far = distance + 400;
    camera.updateProjectionMatrix();
  }
  fit();

  function applyTime(t) {
    qa.time = t;
    cards.forEach((c, i) => {
      const p = solves[i].pose(solves[i].phiEnd * leanProgress(t, i === 1 ? PHASE.lightDelay : 0));
      c.group.position.set(p.x, p.y, cardZ(i, CARD_METRICS));
      c.group.quaternion.setFromAxisAngle(zAxis, -p.phi).multiply(baseQ);
      c.group.updateMatrixWorld(true);
    });
    camera.position.fromArray(cameraPosition(target, distance, azimuthAt(t)));
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
  }
  const redraw = () => applyTime(qa.time);

  function setMaterial(m) {
    if (!MATERIALS.includes(m)) return;
    qa.material = m;
    for (const k of MATERIALS) { pairs[k].low.visible = k === m; pairs[k].high.visible = k === m; }
    body.dataset.material = m;
    document.querySelectorAll('button[data-material]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.material === m)));
    redraw();
  }

  let start = 0;
  let raf = 0;
  function tick(now) {
    const t = Math.min(TOTAL_TIME, (now - start) / 1000);
    applyTime(t);
    if (t < TOTAL_TIME) raf = requestAnimationFrame(tick);
    else { qa.playing = false; body.dataset.playing = '0'; }
  }
  function play() {
    cancelAnimationFrame(raf);
    if (HELD) { qa.playing = false; applyTime(TOTAL_TIME); return; }
    qa.playing = true;
    body.dataset.playing = '1';
    start = performance.now();
    raf = requestAnimationFrame(tick);
  }
  qa.seek = (t) => { cancelAnimationFrame(raf); qa.playing = false; applyTime(Math.max(0, Math.min(TOTAL_TIME, Number(t) || 0))); };
  qa.replay = play;
  qa.setMaterial = setMaterial;
  qa.lights = () => { let n = 0; scene.traverse((o) => { if (o.isLight) n += 1; }); return n; };
  qa.layout = () => ({ ...lay, leanDeg: LEAN_DEG, azSign: AZ_SIGN, distance, target, frame: R });
  /* real-geometry contact check: card world vertices vs the high face (x = 0) and the low top (y = lowH) */
  qa.contact = (t) => {
    applyTime(t === undefined ? TOTAL_TIME : t);
    const v = new THREE.Vector3();
    return cards.map((c) => {
      let maxX = -Infinity;
      let minY = Infinity;
      c.group.traverse((o) => {
        if (!o.isMesh || !o.geometry.attributes.position) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 1) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y;
        }
      });
      return { id: c.id, maxX, minY, gapFace: -maxX, gapTop: minY - lay.lowH };
    });
  };
  qa.scale = () => cards.map((c) => { const s = new THREE.Vector3(); c.group.getWorldScale(s); return s.toArray(); });

  const playBtn = document.getElementById('btn-play');
  if (playBtn) playBtn.addEventListener('click', play);
  document.querySelectorAll('button[data-material]').forEach((b) => b.addEventListener('click', () => setMaterial(b.dataset.material)));
  window.addEventListener('keydown', (e) => {
    const i = Number(e.key);
    if (i >= 1 && i <= 5) setMaterial(MATERIALS[i - 1]);
    else if (e.key === ' ' || e.key.toLowerCase() === 'r') { e.preventDefault(); play(); }
  });
  let resizeRaf = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(() => { fit(); redraw(); }); });

  setMaterial(MATERIALS.includes(params.get('material')) ? params.get('material') : 'satin');
  if (SEEK !== null && Number.isFinite(SEEK)) qa.seek(SEEK);
  else if (HELD) applyTime(TOTAL_TIME);
  else play();
  qa.ready = true;
  body.dataset.qaReady = '1';
  const veil = document.getElementById('stage-veil');
  if (veil) veil.hidden = true;
}

main().catch((err) => { console.error(err); fail('Could not start the scene: ' + (err && err.message ? err.message : err)); });
