/**
 * tekoanimation — Stacked Panels preview (Rev17)
 *
 * Silver-white studio: six rounded-hexagon terraces rise from a flat plate, our
 * real card model settles low on the top terrace, and six amount tags fan out
 * from the card in Rev19: one panel every 4.5 s.
 *
 * The deterministic composition/timing comes from the modeler-owned
 * ./stacked-panel-model.js (config, layout, pose(t), camera fit); this module
 * owns the three.js studio, the card integration (./card-model.js), the DOM
 * amount tags, the controls and the QA hooks.
 *
 * Local only: vendor three, local card assets and local model; no network.
 */
import * as THREE from 'three';
import {
  PANEL_CONFIG,
  PANEL_LAYOUT,
  panelPose,
  panelCameraFit,
  roundedPolygonPoints,
  stackedPanelReducedMotionPose,
  projectPoint,
} from './stacked-panel-model.js';
import { CARD_METRICS, loadCardBank } from './card-model.js';
import { applyEnvRoom } from './env-room.js';

const VERSION = '1.0.0';
const MODEL = PANEL_CONFIG;
const DURATION = MODEL.durationSeconds;
const DEFAULT_VARIANT = MODEL.defaultVariant;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* Rev21 — image-based lighting only.
   The whole studio (terraces, flat plate, floor, card) is lit by the shared
   room photograph through ./env-room.js. There are NO THREE lights and no
   procedural studio / softbox PMREM anymore: the photo's PMREM is
   `scene.environment`, and its own ceiling downlights do the key-light work.
   r151 has no scene-level `environmentIntensity`, so env-room multiplies each
   material's authored envMapIntensity by ENV.intensity — materials created
   after boot are picked up by refreshRoomEnv(). */
const ENV = Object.freeze({
  intensity: 4,
  label: 'assets/env/modern-empty-room.jpg (PMREM, env-room)',
});

/* ---------------------------------------------------------------- dom refs */

const dom = {
  body: document.body,
  stage: document.getElementById('stage'),
  canvas: document.getElementById('stage-canvas'),
  amountLayer: document.getElementById('amount-layer'),
  veilText: document.getElementById('veil-text'),
  stageEyebrow: document.getElementById('stage-eyebrow-text'),
  stageVariantCode: document.getElementById('stage-variant-code'),
  stageCode: document.getElementById('stage-code'),
  stageName: document.getElementById('stage-name'),
  variantName: document.getElementById('variant-name'),
  btnVariantA: document.getElementById('btn-variant-a'),
  btnVariantB: document.getElementById('btn-variant-b'),
  btnReplay: document.getElementById('btn-replay'),
  btnPlay: document.getElementById('btn-play'),
  btnPlayLabel: document.getElementById('btn-play-label'),
  timelineFill: document.getElementById('timeline-fill'),
  timelineReadout: document.getElementById('timeline-readout'),
  timelinePhase: document.getElementById('timeline-phase'),
  footerStatus: document.getElementById('footer-status'),
  fallback: document.getElementById('fallback'),
  fallbackMessage: document.getElementById('fallback-message'),
  errorBanner: document.getElementById('error-banner'),
  errorText: document.getElementById('error-text'),
  diag: document.getElementById('qa-diag'),
};

const params = new URLSearchParams(window.location.search);
const initial = (window.__stackedPanelBoot && window.__stackedPanelBoot.params) || {};
const param = (name, fallback) => (params.get(name) !== null ? params.get(name) : (initial[name] !== undefined ? initial[name] : fallback));

const state = {
  ready: false,
  failed: false,
  errors: [],
  warnings: [],
  variant: params.get('variant') === 'b' ? 'b' : DEFAULT_VARIANT,
  shot: params.get('shot') === '1' || params.get('still') === '1' || initial.shot === '1',
  reducedMotion: false,
  playing: false,
  time: 0,
  duration: DURATION,
  phase: 'panels',
  bank: null,
  card: null,
  cardGroup: null,
  cardMaterials: [],
  cardScale: 1,
  cardWidth: CARD_METRICS.width,
  scene: null,
  camera: null,
  renderer: null,
  root: null,
  room: null,
  panels: [],
  plane: null,
  floor: null,
  tags: [],
  tagEls: new Map(),
  pose: null,
  cameraFit: null,
  stageRect: { width: 0, height: 0 },
  raf: 0,
  lastFrame: 0,
  frames: 0,
  resizeObserver: null,
  diagTimer: 0,
  contextLost: false,
};

const qa = { errors: state.errors, warnings: state.warnings };

/* -------------------------------------------------------------- utilities */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

function pushError(message) {
  state.errors.push(String(message));
  dom.body.dataset.errors = String(state.errors.length);
}

function setBusy(busy, label) {
  if (!dom.stage) return;
  dom.stage.classList.toggle('is-busy', Boolean(busy));
  if (label && dom.veilText) dom.veilText.textContent = label;
}

function announce(message) {
  if (dom.footerStatus) dom.footerStatus.textContent = message;
}

function showError(message) {
  if (dom.errorText) dom.errorText.textContent = message;
  if (dom.errorBanner) dom.errorBanner.hidden = false;
}

function showFallback(message, error) {
  state.failed = true;
  dom.body.dataset.fallback = '1';
  dom.body.dataset.ready = '0';
  if (dom.fallback && message) {
    if (dom.fallbackMessage) dom.fallbackMessage.textContent = message;
    dom.fallback.hidden = false;
  }
  setBusy(false);
  if (error) {
    pushError(error && error.message ? error.message : error);
    showError('The stacked-panel studio failed to start: ' + (error && error.message ? error.message : error));
  }
  announce('Static fallback');
}

/* ------------------------------------------------------------- renderer */

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

/* Rev21: re-apply the room environment's intensity to the current scene graph.
   r151 only knows per-material envMapIntensity, so every material the page adds
   or re-authors after boot goes through here (idempotent: env-room keeps each
   material's authored base value). */
function refreshRoomEnv() {
  if (state.room) state.room.refresh(state.scene);
}

/* --------------------------------------------------------------- studio */

async function buildStudio() {
  const renderer = createRenderer();
  state.renderer = renderer;
  state.scene = new THREE.Scene();
  state.root = new THREE.Group();
  state.root.name = 'stacked-panel-root';
  state.scene.add(state.root);
  state.camera = new THREE.PerspectiveCamera(MODEL.camera.fovDeg, 1, MODEL.camera.near, MODEL.camera.far);

  // Rev21: the room photo is the ONLY light source, and it must be in place
  // before anything is shaded (boot does not report ready before this awaits).
  state.room = await applyEnvRoom(THREE, renderer, state.scene, { intensity: ENV.intensity, toggleContainer: () => document.getElementById('stage'), toggleClass: 'env-toggle--stage' });

  state.floor = createFloor();
  state.scene.add(state.floor);
  state.capGradient = makeCapGradientTexture();

  state.plane = createPlane();
  state.root.add(state.plane);

  buildPanels();
  buildTagDom();
  applyVariantPalette(state.variant);
  resize();
}

function createFloor() {
  const geometry = new THREE.CircleGeometry(26, 96);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xdde1e6,
    metalness: 0.55,
    roughness: 0.38,
    clearcoat: 0.35,
    clearcoatRoughness: 0.32,
    // Rev21: authored base -- env-room multiplies it by ENV.intensity (the room
    // photo is dark, so the floor needs a strong IBL gain to stay readable).
    envMapIntensity: 2.4,
  });
  material.name = 'studio-floor';
  const floor = new THREE.Mesh(geometry, material);
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  return floor;
}

function createPlane() {
  const layout = PANEL_LAYOUT.terraces;
  const plane = layout.plane;
  const bodyGeometry = roundedHexGeometry(plane.radius, plane.thickness, layout.cornerRadiusFraction, 12, plane.sides);
  const capGeometry = capShapeGeometry(plane.radius, layout.cornerRadiusFraction, 12, plane.thickness, plane.sides);
  const capMaterial = makeCapMaterial(0xe9edf2);
  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x8f9aa7,
    metalness: 1.0,
    roughness: 0.24,
    clearcoat: 0.2,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.35,
  });
  capMaterial.name = 'stacked-panel-plane-top';
  edgeMaterial.name = 'stacked-panel-plane-edge';
  edgeMaterial.side = THREE.DoubleSide;
  const body = new THREE.Mesh(bodyGeometry, edgeMaterial);
  body.name = 'stacked-panel-plane-body';
  body.receiveShadow = true;
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.name = 'stacked-panel-plane-cap';
  cap.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'stacked-panel-plane';
  const shadowRing = makeStepShadow(plane.radius, layout.cornerRadiusFraction, 12, plane.thickness + 0.004, plane.sides);
  group.add(body, cap, shadowRing);
  group.userData = { materials: { cap: capMaterial, edge: edgeMaterial }, body, cap, shadowRing };
  return group;
}

function makeCapGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 12, 128, 128, 172);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.6, '#f5f7f9');
  gradient.addColorStop(0.86, '#dbe0e6');
  gradient.addColorStop(1, '#c2cad4');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = 2;
  texture.needsUpdate = true;
  return texture;
}

function makeStepShadowGeometry(radius, cornerFraction, samples, y, sides = LAYOUT_SIDES) {
  const outer = roundedPolygonPoints(sides, radius * 1.02, cornerFraction, Math.max(6, Math.round(samples || 6)));
  const inner = roundedPolygonPoints(sides, radius * 0.965, cornerFraction, Math.max(6, Math.round(samples || 6)));
  const shape = new THREE.Shape();
  outer.forEach((point, index) => { if (index === 0) shape.moveTo(point[0], point[1]); else shape.lineTo(point[0], point[1]); });
  shape.closePath();
  const hole = new THREE.Path();
  inner.forEach((point, index) => { if (index === 0) hole.moveTo(point[0], point[1]); else hole.lineTo(point[0], point[1]); });
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ShapeGeometry(shape, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function makeStepShadowMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.09, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
}

function makeStepShadow(radius, cornerFraction, samples, y, sides = LAYOUT_SIDES) {
  const mesh = new THREE.Mesh(makeStepShadowGeometry(radius, cornerFraction, samples, y, sides), makeStepShadowMaterial());
  mesh.name = 'step-shadow';
  mesh.renderOrder = 2;
  return mesh;
}

function makeCapMaterial(color) {
  const material = new THREE.MeshLambertMaterial({
    color: 0x000000,
    emissive: new THREE.Color(color),
    emissiveIntensity: 1,
    reflectivity: 0,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  if (state.capGradient) material.emissiveMap = state.capGradient;
  return material;
}

function roundedHexGeometry(radius, thickness, cornerFraction, samples, sides = LAYOUT_SIDES) {
  const points = roundedPolygonPoints(sides, radius, cornerFraction, Math.max(6, Math.round(samples || 6)));
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point[0], point[1]);
    else shape.lineTo(point[0], point[1]);
  });
  shape.closePath();
  const bevel = Math.min(0.018, thickness * 0.28);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, thickness - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function capShapeGeometry(radius, cornerFraction, samples, y, sides = LAYOUT_SIDES) {
  const points = roundedPolygonPoints(sides, radius * 0.998, cornerFraction, Math.max(6, Math.round(samples || 6)));
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point[0], point[1]);
    else shape.lineTo(point[0], point[1]);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 1);
  // ShapeGeometry UVs equal raw shape coordinates; normalise so the cap
  // gradient texture maps across the whole terrace (0..1).
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  const sizeX = Math.max(0.0001, bbox.max.x - bbox.min.x);
  const sizeY = Math.max(0.0001, bbox.max.y - bbox.min.y);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, (uv.getX(i) - bbox.min.x) / sizeX, (uv.getY(i) - bbox.min.y) / sizeY);
  }
  uv.needsUpdate = true;
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y + 0.002, 0);
  geometry.computeVertexNormals();
  return geometry;
}

const LAYOUT_SIDES = PANEL_LAYOUT.terraces.sides;

function buildPanels() {
  const terraces = PANEL_LAYOUT.terraces;
  /* Rev21 s9: ONE base shape. All six terraces are built from this single
     geometry set (the biggest terrace) and each panel mesh is uniformly scaled
     by terraces.scaleFactors[i] -- every panel is base * s_i, so outline,
     corner-radius ratio and aspect are identical, and the thickness/y of each
     terrace scales with its footprint. */
  const baseRadius = terraces.baseRadius;
  const baseThickness = terraces.baseThickness;
  const baseBodyGeometry = roundedHexGeometry(baseRadius, baseThickness, terraces.cornerRadiusFraction, 10);
  const baseCapGeometry = capShapeGeometry(baseRadius, terraces.cornerRadiusFraction, 10, baseThickness);
  const baseOutlineGeometry = new THREE.EdgesGeometry(baseCapGeometry, 28);
  const baseShadowGeometry = makeStepShadowGeometry(baseRadius, terraces.cornerRadiusFraction, 10, baseThickness + 0.004);
  for (let index = 0; index < terraces.count; index += 1) {
    const scale = terraces.scaleFactors[index];
    const thickness = baseThickness * scale;
    const capMaterial = makeCapMaterial(0xdfe3e8);
    capMaterial.transparent = true;
    capMaterial.opacity = 0;
    const edgeMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x808c9a,
      metalness: 1.0,
      roughness: 0.22,
      clearcoat: 0.16,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.35,
      transparent: true,
      opacity: 0,
    });
    capMaterial.name = 'stacked-panel-terrace-' + index + '-top';
    edgeMaterial.name = 'stacked-panel-terrace-' + index + '-edge';
    edgeMaterial.side = THREE.DoubleSide;
    const body = new THREE.Mesh(baseBodyGeometry, edgeMaterial);
    body.name = 'stacked-panel-terrace-' + index + '-body';
    body.castShadow = true;
    body.receiveShadow = true;
    const cap = new THREE.Mesh(baseCapGeometry, capMaterial);
    cap.name = 'stacked-panel-terrace-' + index + '-cap';
    cap.castShadow = true;
    cap.receiveShadow = true;
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color('#4f5a66').convertSRGBToLinear(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const outline = new THREE.LineSegments(baseOutlineGeometry, outlineMaterial);
    outline.name = 'stacked-panel-terrace-' + index + '-outline';
    outline.visible = false;
    const shadowRing = new THREE.Mesh(baseShadowGeometry, makeStepShadowMaterial());
    shadowRing.name = 'step-shadow';
    shadowRing.renderOrder = 2;
    shadowRing.visible = false;
    const mesh = new THREE.Group();
    mesh.name = 'stacked-panel-terrace-' + index;
    mesh.add(body, cap, shadowRing, outline);
    mesh.rotation.y = terraces.yawDeg[index] * DEG;
    mesh.scale.setScalar(scale);
    mesh.userData = {
      index,
      scale,
      radius: terraces.radiiBottomToTop[index],
      baseRadius,
      thickness,
      materials: { cap: capMaterial, edge: edgeMaterial },
      outline,
      body,
      cap,
      shadowRing,
    };
    state.panels.push(mesh);
    state.root.add(mesh);
  }
}

function buildTagDom() {
  const layer = dom.amountLayer;
  if (!layer) return;
  layer.innerHTML = '';
  state.tagEls.clear();
  for (const tag of PANEL_LAYOUT.tags) {
    const el = document.createElement('div');
    el.className = 'amount-tag';
    el.dataset.tagId = tag.id;
    el.dataset.wave = String(tag.wave);
    el.dataset.side = tag.side;
    el.innerHTML = '<span class="amount-tag-dot" aria-hidden="true"></span><span class="amount-tag-label">' + tag.label + '</span>';
    el.setAttribute('aria-hidden', 'true');
    layer.appendChild(el);
    state.tagEls.set(tag.id, el);
  }
}

function applyVariantPalette(variant) {
  const palette = MODEL.variants[variant] || MODEL.variants[DEFAULT_VARIANT];
  state.variant = palette.id;
  dom.body.dataset.variant = palette.id;
  if (dom.variantName) dom.variantName.textContent = palette.label;
  if (dom.stageVariantCode) dom.stageVariantCode.textContent = palette.id.toUpperCase();
  if (dom.stageEyebrow) dom.stageEyebrow.textContent = palette.id === 'b' ? 'Deep silver-grey studio' : 'Silver-white studio';
  const headerNote = document.querySelector('.header-note');
  if (headerNote) {
    headerNote.innerHTML = palette.id === 'b'
      ? 'Deep silver-grey studio <span class="header-dot" aria-hidden="true"></span> real card model <span class="header-dot" aria-hidden="true"></span> six terraces'
      : 'Silver-white studio <span class="header-dot" aria-hidden="true"></span> real card model <span class="header-dot" aria-hidden="true"></span> six terraces';
  }
  const headerLinkLabel = document.querySelector('.header-link span');
  if (headerLinkLabel) headerLinkLabel.textContent = 'Metal Card';
  const copyKicker = document.querySelector('.copy-kicker');
  if (copyKicker) copyKicker.innerHTML = '<span class="copy-rule" aria-hidden="true"></span> TEKO · ' + (palette.id === 'b' ? 'Deep silver-grey' : 'Silver-white') + ' panels';
  const copyBody = document.querySelector('.copy-body');
  if (copyBody) {
    copyBody.textContent = palette.id === 'b'
      ? 'Six deep silver-grey terraces rise out of a flat plate, one layer at a time. The white card settles low, then six amounts appear at random spots — +100 to +2k.'
      : 'Six silver terraces rise out of a flat plate, one layer at a time. The card settles low, then six amounts appear at random spots — +100 to +2k.';
  }

  const isB = palette.id === 'b';
  const capColor = isB ? '#4f5761' : '#e4e8ed';
  const edgeColor = isB ? '#9aa4b0' : '#c9d1da';
  const planeCapColor = isB ? '#3c444d' : '#e9edf2';
  const planeEdgeColor = isB ? '#8f99a5' : '#c2cad4';
  // floor + plane
  if (state.floor && state.floor.material) {
    state.floor.material.color.set(palette.studio.floor).convertSRGBToLinear();
    state.floor.material.metalness = palette.id === 'b' ? 0.15 : 0.3;
    state.floor.material.roughness = palette.id === 'b' ? 0.62 : 0.48;
  }
  if (state.plane) {
    const materials = state.plane.userData.materials;
    materials.cap.emissive.set(planeCapColor).convertSRGBToLinear();
    materials.edge.color.set(planeEdgeColor).convertSRGBToLinear();
    materials.edge.metalness = isB ? 0.85 : 0.6;
    materials.edge.roughness = 0.3;
  }
  for (const panel of state.panels) {
    const materials = panel.userData.materials;
    materials.cap.emissive.set(capColor).convertSRGBToLinear();
    materials.edge.color.set(edgeColor).convertSRGBToLinear();
    materials.edge.metalness = isB ? 0.85 : 0.6;
    materials.edge.roughness = isB ? 0.22 : 0.28;
  }
  // background/atmosphere
  dom.body.dataset.variant = palette.id;
  dom.body.style.setProperty('--tag-bg', palette.tag.background);
  dom.body.style.setProperty('--tag-fg', palette.tag.foreground);
  dom.body.style.setProperty('--tag-border', palette.tag.border);
  dom.body.style.setProperty('--tag-accent', palette.tag.accent);
  if (state.renderer) {
    state.renderer.toneMappingExposure = palette.id === 'b' ? 0.78 : 0.9;
  }
  // Rev21: floor / plate / terraces were just re-authored -> re-apply the room
  // environment intensity (r151 scales every material's own envMapIntensity).
  refreshRoomEnv();
  updateVariantButtons();
  applyPose(state.time);
  paintFrame();
}

function updateVariantButtons() {
  if (dom.btnVariantA) {
    const active = state.variant === 'a';
    dom.btnVariantA.setAttribute('aria-pressed', String(active));
    dom.btnVariantA.dataset.active = active ? '1' : '0';
  }
  if (dom.btnVariantB) {
    const active = state.variant === 'b';
    dom.btnVariantB.setAttribute('aria-pressed', String(active));
    dom.btnVariantB.dataset.active = active ? '1' : '0';
  }
}

/* ------------------------------------------------------------------ card */

async function loadCardForVariant(variant) {
  const palette = MODEL.variants[variant] || MODEL.variants[DEFAULT_VARIANT];
  if (!state.bank) return null;
  if (state.card) {
    try { state.card.dispose(); } catch (error) { /* best effort */ }
    state.card = null;
    state.cardGroup = null;
    state.cardMaterials = [];
    state.cardMaterialInfo = [];
  }
  const cardId = palette.card.finish === 'black' ? 'dark' : 'light';
  const card = state.bank.createCard(cardId, { quality: 'hero' });
  const group = card.group;
  group.name = 'stacked-panel-card';
  // scale the real card to the model's authored card width
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const targetWidth = PANEL_LAYOUT.card.width;
  const scale = targetWidth / (size.x || CARD_METRICS.width);
  group.scale.setScalar(scale);
  state.cardScale = scale;
  state.cardWidth = size.x * scale;
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const part = /front/i.test(object.name) ? 'front' : /back/i.test(object.name) ? 'back' : /edge/i.test(object.name) ? 'edge' : 'other';
    for (const material of materials) {
      if (!material) continue;
      material.transparent = true;
      material.opacity = 0;
      if (part === 'front' || part === 'back') {
        // Rev21: the face is now lit ONLY by the room photo's diffuse IBL, so
        // its environment gain is raised (the old 0.03 cancelled the studio
        // lights and would leave the white variant card black). Keep the real
        // albedo / metalness / roughness maps (the authored card colour still
        // wins), just soften the direct environment specular.
        material.envMapIntensity = 2.0;
        material.metalness = Math.min(material.metalness === undefined ? 1 : material.metalness, 0.22);
        material.roughness = Math.max(0.68, material.roughness || 0.5);
        material.clearcoat = 0;
        material.clearcoatRoughness = 0.6;
        if ('specularIntensity' in material) material.specularIntensity = 0.22;
      } else if (part === 'edge') {
        material.envMapIntensity = 0.7;
      }
      state.cardMaterials.push(material);
      state.cardMaterialInfo = state.cardMaterialInfo || [];
      state.cardMaterialInfo.push({ name: material.name || object.name, part, metalness: material.metalness, roughness: material.roughness, envMapIntensity: material.envMapIntensity, map: Boolean(material.map), normalMap: Boolean(material.normalMap), transparent: material.transparent });
    }
  });
  state.card = card;
  state.cardGroup = group;
  state.cardMaterialInfo = state.cardMaterialInfo || [];
  state.root.add(group);
  // Rev21: the card materials are new objects -> pick up the room intensity.
  refreshRoomEnv();
  return card;
}

/* -------------------------------------------------------------- timeline */

function cardScreenRect() {
  if (!state.cardGroup || !state.camera) return null;
  const rect = state.stageRect;
  const box = new THREE.Box3().setFromObject(state.cardGroup);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(state.camera);
        const px = (point.x * 0.5 + 0.5) * rect.width;
        const py = (0.5 - point.y * 0.5) * rect.height;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

function poseAt(time, variant) {
  return panelPose(time, variant || state.variant);
}

function applyPose(time) {
  if (!state.ready) return;
  const clamped = Math.min(DURATION, Math.max(0, Number(time) || 0));
  state.time = clamped;
  const pose = poseAt(clamped, state.variant);
  state.pose = pose;
  state.phase = pose.phase;

  // terraces
  for (let index = 0; index < state.panels.length; index += 1) {
    const panel = state.panels[index];
    const panelPose = pose.panels[index];
    if (!panelPose) continue;
    panel.position.set(panelPose.position[0], panelPose.position[1], panelPose.position[2]);
    panel.rotation.y = panelPose.yawDeg * DEG;
    // Rev21 s9: every panel is the same base shape uniformly scaled by s_i.
    panel.scale.setScalar(panelPose.scale);
    panel.visible = panelPose.opacity > 0.001;
    const materials = panel.userData.materials;
    const opacity = clamp01(panelPose.opacity);
    const fade = opacity < 0.999;
    materials.cap.opacity = opacity;
    materials.edge.opacity = opacity;
    materials.cap.depthWrite = !fade;
    materials.edge.depthWrite = !fade;
    if (materials.cap.transparent !== fade) {
      materials.cap.transparent = fade;
      materials.cap.needsUpdate = true;
      materials.edge.transparent = fade;
      materials.edge.needsUpdate = true;
    }
    const outline = panel.userData.outline;
    if (outline) {
      outline.visible = panel.visible;
      outline.material.opacity = opacity * (state.variant === 'b' ? 0.22 : 0.14);
    }
    const shadowRing = panel.userData.shadowRing;
    if (shadowRing) {
      shadowRing.visible = panel.visible;
      shadowRing.material.opacity = opacity * (state.variant === 'b' ? 0.06 : 0.028);
    }
  }

  // card
  if (state.cardGroup) {
    const cardPose = pose.card;
    const card = state.cardGroup;
    card.position.set(cardPose.position[0], cardPose.position[1], cardPose.position[2]);
    // The model's pose is nearly flat; recline the real card to ~44 deg so the
    // printed TEKO face reads instead of being foreshortened from this camera.
    const cardTilt = -46 * (Math.PI / 180);
    card.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), cardTilt);
    card.scale.setScalar(state.cardScale * cardPose.scale);
    // The authored card centre does not account for the card's own size under
    // the tilt: lift the real card so its lowest point rests on the top terrace
    // instead of letting the terrace cap poke through the face.
    card.updateMatrixWorld(true);
    const cardBox = new THREE.Box3().setFromObject(card);
    const terraceTop = PANEL_LAYOUT.terraces.topTerraceTopY;
    const lift = (terraceTop + 0.012) - cardBox.min.y;
    card.position.y += lift;
    card.updateMatrixWorld(true);
    state.cardLift = lift;
    const opacity = clamp01(cardPose.opacity);
    card.visible = opacity > 0.001;
    const fade = opacity < 0.999;
    for (const material of state.cardMaterials) {
      material.opacity = opacity;
      material.depthWrite = !fade;
      if (material.transparent !== fade) {
        material.transparent = fade;
        material.needsUpdate = true;
      }
    }
  }

  // tags (DOM)
  for (const tagPose of pose.tags) {
    const el = state.tagEls.get(tagPose.id);
    if (!el) continue;
    el.classList.toggle('is-visible', tagPose.visible && tagPose.opacity > 0.01);
    el.dataset.visible = tagPose.visible ? '1' : '0';
    el.dataset.wave = String(tagPose.wave);
    el.dataset.ease = String(tagPose.ease);
    el.style.opacity = String(clamp01(tagPose.opacity));
    let screen = projectTag([tagPose.position[0], tagPose.position[1] + (state.cardLift || 0), tagPose.position[2]]);
    // Rev19: tags sit at their own random (seeded) layout positions; just clear the
    // card artwork a little.
    screen = [screen[0], screen[1] - 24];
    if (state.stageRect.width < 620 && state.cardGroup) {
      const cardRect = cardScreenRect();
      if (cardRect) {
        const w = state.stageRect.width;
        const h = state.stageRect.height;
        const cx = (cardRect[0] + cardRect[2]) / 2;
        const offset = Math.min(w * 0.3, Math.max(70, (cardRect[2] - cardRect[0]) / 2 + 46));
        const clampX = (value) => Math.min(w - 40, Math.max(40, value));
        // Rev19: no mirrored rows. Each side stacks its own tags (in appear order)
        // through four rows, so the narrow layout is uneven but never overlaps.
        const r0 = Math.max(40, cardRect[1] - 62);
        const r1 = Math.max(r0 + 30, cardRect[1] - 27);
        const r2 = Math.min(h - 26, cardRect[3] + 24);
        const r3 = (cardRect[1] + cardRect[3]) / 2;
        const rows = [r0, r1, r3, r2];
        const sameSide = pose.tags.filter((other) => other.side === tagPose.side);
        const slot = sameSide.findIndex((other) => other.id === tagPose.id);
        const rowShift = tagPose.side === 'left' ? 0 : 1;
        const jitter = (slot % 2 ? 0 : 1) * Math.min(14, w * 0.035); // outward only: never into the card
        screen = [clampX(tagPose.side === 'left' ? cx - offset - jitter : cx + offset + jitter), rows[(slot + rowShift) % rows.length]];
      }
    }
    el.dataset.screenX = String(round(screen[0], 2));
    el.dataset.screenY = String(round(screen[1], 2));
    const scale = Number.isFinite(tagPose.scale) ? tagPose.scale : 1;
    el.style.transform = 'translate(-50%, -50%) translate3d(' + screen[0].toFixed(2) + 'px, ' + screen[1].toFixed(2) + 'px, 0) scale(' + scale.toFixed(3) + ')';
  }

  updateTimelineUi(pose);
  paintFrame();
}

function projectTag(position) {
  if (!state.camera || !state.stageRect) return [0, 0];
  const vector = new THREE.Vector3(position[0], position[1], position[2]).project(state.camera);
  return [
    (vector.x * 0.5 + 0.5) * state.stageRect.width,
    (0.5 - vector.y * 0.5) * state.stageRect.height,
  ];
}

function updateTimelineUi(pose) {
  const fraction = DURATION > 0 ? state.time / DURATION : 0;
  if (dom.timelineFill) dom.timelineFill.style.width = (clamp01(fraction) * 100).toFixed(2) + '%';
  if (dom.timelineReadout) {
    dom.timelineReadout.innerHTML = state.time.toFixed(1) + ' s <span aria-hidden="true">/</span> ' + DURATION.toFixed(1) + ' s';
  }
  if (dom.timelinePhase) dom.timelinePhase.textContent = (pose.phase || 'panels').toUpperCase();
  if (dom.stageCode) dom.stageCode.textContent = state.variant === 'b' ? 'DEEP' : 'PANELS';
  if (dom.stageName) dom.stageName.textContent = phaseLabel(pose.phase);
  if (dom.btnPlayLabel) dom.btnPlayLabel.textContent = state.playing ? 'Pause' : (state.time >= DURATION ? 'Replay' : 'Play');
  dom.body.dataset.time = state.time.toFixed(3);
  dom.body.dataset.phase = pose.phase;
  dom.body.dataset.playing = state.playing ? '1' : '0';
}

function phaseLabel(phase) {
  if (phase === 'panels') return 'Terraces rising';
  if (phase === 'card') return 'Card settles';
  if (phase === 'tags') return 'Amounts expand';
  return 'Composed';
}

/* --------------------------------------------------------------- render */

function paintFrame() {
  if (!state.renderer || !state.scene || !state.camera) return;
  state.renderer.render(state.scene, state.camera);
  state.frames += 1;
}

function resize() {
  if (!state.renderer || !state.camera || !dom.stage) return;
  const rect = dom.stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  state.stageRect = { width, height };
  state.renderer.setSize(width, height, false);
  let fit = panelCameraFit(width, height);
  if (width < 620) {
    // Narrow screens: frame closer so the card/terraces stay legible; the tag
    // layout switches to a compact two-column arrangement around the card.
    const target = new THREE.Vector3().fromArray(fit.target);
    const position = new THREE.Vector3().fromArray(fit.position).sub(target).multiplyScalar(0.78).add(target);
    fit = Object.assign({}, fit, { distance: fit.distance * 0.78, position: position.toArray() });
  }
  state.cameraFit = fit;
  state.camera.fov = fit.fovDeg;
  state.camera.near = fit.near;
  state.camera.far = fit.far;
  state.camera.aspect = width / height;
  state.camera.position.fromArray(fit.position);
  state.camera.lookAt(fit.target[0], fit.target[1], fit.target[2]);
  state.camera.updateProjectionMatrix();
  state.camera.updateMatrixWorld(true);
  applyPose(state.time);
  paintFrame();
}

/* --------------------------------------------------------------- controls */

function setTime(time, options = {}) {
  const next = Math.min(DURATION, Math.max(0, Number(time) || 0));
  state.time = next;
  if (options.playing !== undefined) state.playing = Boolean(options.playing);
  applyPose(next);
  updatePlayButton();
}

function setPlaying(playing) {
  state.playing = Boolean(playing) && !state.shot && !state.reducedMotion;
  if (state.playing && state.time >= DURATION) state.time = 0;
  updatePlayButton();
  applyPose(state.time);
}

function replay() {
  if (!state.ready) return false;
  state.time = 0;
  state.playing = !state.shot && !state.reducedMotion;
  applyPose(0);
  updatePlayButton();
  return true;
}

function togglePlay() {
  if (state.shot || state.reducedMotion) return false;
  if (state.time >= DURATION) return replay();
  setPlaying(!state.playing);
  return state.playing;
}

function updatePlayButton() {
  if (!dom.btnPlay) return;
  const disabled = state.shot || state.reducedMotion || !state.ready;
  dom.btnPlay.disabled = disabled;
  dom.btnPlay.setAttribute('aria-pressed', String(state.playing));
  if (state.reducedMotion) dom.btnPlay.title = 'Playback is disabled by the reduced-motion preference.';
  else if (state.shot) dom.btnPlay.title = 'Playback is frozen in deterministic capture mode.';
  else dom.btnPlay.title = state.playing ? 'Pause the animation' : 'Play the animation';
  if (dom.btnReplay) dom.btnReplay.disabled = !state.ready;
}

async function setVariant(variant, options = {}) {
  if (!state.ready && !options.force) return false;
  const next = MODEL.variants[variant] ? variant : DEFAULT_VARIANT;
  if (next === state.variant && state.cardGroup && !options.force) {
    applyVariantPalette(next);
    return true;
  }
  state.variant = next;
  applyVariantPalette(next);
  if (state.bank) {
    try {
      await loadCardForVariant(next);
    } catch (error) {
      pushError('card variant failed: ' + (error && error.message ? error.message : error));
      showError('Could not build the ' + next + ' card variant.');
    }
  }
  applyPose(state.time);
  paintFrame();
  announce(MODEL.variants[next].label);
  return true;
}

function wireUi() {
  if (dom.btnVariantA) dom.btnVariantA.addEventListener('click', () => { setVariant('a').catch(() => undefined); });
  if (dom.btnVariantB) dom.btnVariantB.addEventListener('click', () => { setVariant('b').catch(() => undefined); });
  if (dom.btnReplay) dom.btnReplay.addEventListener('click', () => { replay(); });
  if (dom.btnPlay) dom.btnPlay.addEventListener('click', () => { togglePlay(); });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    const key = event.key;
    if (key === 'r' || key === 'R') {
      event.preventDefault();
      replay();
    } else if (key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      togglePlay();
    } else if (key === 'v' || key === 'V') {
      event.preventDefault();
      setVariant(state.variant === 'a' ? 'b' : 'a').catch(() => undefined);
    }
  });
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) {
    state.resizeObserver = new ResizeObserver(() => resize());
    state.resizeObserver.observe(dom.stage);
  }
  window.addEventListener('pagehide', dispose);
}

/* ------------------------------------------------------------------ boot */

async function loadBank() {
  setBusy(true, 'Loading card assets');
  announce('Loading card assets');
  const bank = await loadCardBank({
    onProgress: (loaded, total) => {
      if (dom.veilText) dom.veilText.textContent = 'Loading card assets ' + loaded + ' / ' + total;
    },
  });
  state.bank = bank;
  return bank;
}

/* Rev21 s9: the page shell ships a static "31.9 s deterministic" copy line and an
   initial timeline readout; both must follow the model's recomputed total. */
function syncStaticDurationText() {
  const meta = document.querySelector('.copy-meta');
  if (meta) {
    const spans = meta.querySelectorAll('span');
    const last = spans.length ? spans[spans.length - 1] : null;
    if (last && /s deterministic/i.test(last.textContent)) last.textContent = DURATION.toFixed(1) + ' s deterministic';
  }
  if (dom.timelineReadout) dom.timelineReadout.innerHTML = '0.0 s <span aria-hidden="true">/</span> ' + DURATION.toFixed(1) + ' s';
  if (dom.timelineFill) dom.timelineFill.style.width = '0%';
}

function setupInitialState() {
  state.reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  dom.body.dataset.reducedMotion = state.reducedMotion ? '1' : '0';
  if (state.reducedMotion) state.shot = true;
  const shotParam = params.get('t');
  const explicitTime = shotParam !== null && shotParam !== '' && Number.isFinite(Number(shotParam));
  if (explicitTime) state.time = Math.min(DURATION, Math.max(0, Number(shotParam)));
  else if (state.shot) state.time = DURATION;
  state.variant = params.get('variant') === 'b' ? 'b' : DEFAULT_VARIANT;
  state.playing = !state.shot && !state.reducedMotion;
  syncStaticDurationText();
}

function startLoop() {
  if (state.raf) cancelAnimationFrame(state.raf);
  let last = performance.now();
  const frame = (now) => {
    if (state.failed) return;
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.playing && !state.shot && !state.reducedMotion) {
      state.time = Math.min(DURATION, state.time + delta);
      if (state.time >= DURATION) {
        state.time = DURATION;
        state.playing = false;
        updatePlayButton();
      }
      applyPose(state.time);
    } else {
      paintFrame();
    }
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
}

async function boot() {
  setupInitialState();
  try {
    setBusy(true, 'Building studio');
    if (dom.stage) dom.stage.classList.remove('is-hidden');
    // Rev21: buildStudio awaits the room environment, so nothing is shaded (and
    // the page never reports ready) before the photo-based IBL is in place.
    await buildStudio();
    state.renderer.render(state.scene, state.camera);
    await loadBank();
    await loadCardForVariant(state.variant);
    applyVariantPalette(state.variant);
    state.ready = true;
    dom.body.dataset.ready = '1';
    dom.body.dataset.phase = state.phase;
    setBusy(false);
    if (dom.stage) dom.stage.classList.add('is-hidden');
    if (state.shot || state.reducedMotion) {
      state.playing = false;
      state.time = Math.min(DURATION, Math.max(0, state.time));
    } else {
      state.playing = true;
      state.time = 0;
    }
    applyPose(state.time);
    updatePlayButton();
    wireUi();
    startLoop();
    announce(state.shot ? 'Deterministic shot ready' : 'Studio ready');
    if (dom.btnReplay) dom.btnReplay.focus({ preventScroll: true });
  } catch (error) {
    showFallback('The 3D studio could not load. Check that the worktree is served over http://127.0.0.1 (not file://).', error);
    console.error('stacked-panel:', error);
  }
}

/* ------------------------------------------------------------------- QA */

function buildDebug() {
  const pose = state.pose || (state.ready ? poseAt(state.time, state.variant) : null);
  return {
    version: VERSION,
    model: 'stacked-panel-model.js',
    ready: Boolean(state.ready),
    failed: Boolean(state.failed),
    errors: state.errors.slice(),
    warnings: state.warnings.slice(),
    mode: 'stacked-panel',
    variant: state.variant,
    variantLabel: MODEL.variants[state.variant].label,
    duration: DURATION,
    time: round(state.time, 3),
    phase: state.phase,
    playing: Boolean(state.playing),
    shot: Boolean(state.shot),
    reducedMotion: Boolean(state.reducedMotion),
    labels: PANEL_LAYOUT.tags.map((tag) => tag.label),
    tags: pose ? pose.tags.map((tag) => ({
      id: tag.id,
      label: tag.label,
      wave: tag.wave,
      side: tag.side,
      visible: Boolean(tag.visible),
      opacity: tag.opacity,
      ease: tag.ease,
      scale: tag.scale,
      position: tag.position.slice(),
      screen: (() => {
        const el = state.tagEls.get(tag.id);
        const x = el ? Number(el.dataset.screenX) : NaN;
        const y = el ? Number(el.dataset.screenY) : NaN;
        return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : projectTag(tag.position).map((value) => round(value, 2));
      })(),
    })) : [],
    panels: pose ? pose.panels.map((panel) => ({
      index: panel.index,
      radius: panel.radius,
      baseRadius: panel.baseRadius,
      scale: panel.scale,
      thickness: panel.thickness,
      cornerRadiusFraction: panel.cornerRadiusFraction,
      startTime: panel.startTime,
      endTime: panel.endTime,
      riseDuration: panel.riseDuration,
      position: panel.position.slice(),
      yawDeg: panel.yawDeg,
      rise: panel.rise,
      opacity: panel.opacity,
      visible: panel.visible,
      outline: Boolean(state.panels[panel.index] && state.panels[panel.index].userData.outline && state.panels[panel.index].userData.outline.visible),
    })) : [],
    // Rev21 s9: prove the panels share ONE base geometry and differ only by the
    // uniform per-index scale factor.
    terraceGeometry: (() => {
      const bodySet = new Set();
      const capSet = new Set();
      const outlineSet = new Set();
      for (const panel of state.panels) {
        const data = panel.userData || {};
        if (data.body) bodySet.add(data.body.geometry);
        if (data.cap) capSet.add(data.cap.geometry);
        if (data.outline) outlineSet.add(data.outline.geometry);
      }
      return {
        shared: bodySet.size === 1 && capSet.size === 1 && outlineSet.size === 1,
        bodyGeometries: bodySet.size,
        capGeometries: capSet.size,
        outlineGeometries: outlineSet.size,
        baseRadius: PANEL_LAYOUT.terraces.baseRadius,
        baseThickness: PANEL_LAYOUT.terraces.baseThickness,
        scaleFactors: PANEL_LAYOUT.terraces.scaleFactors.slice(),
      };
    })(),
    card: pose ? {
      visible: Boolean(state.card),
      id: state.card ? state.card.id : null,
      lift: round(state.cardLift || 0, 4),
      width: state.cardWidth,
      scale: state.cardScale,
      opacity: pose.card.opacity,
      position: pose.card.position.slice(),
      quaternion: pose.card.quaternion.slice(),
      worldWidth: state.card ? new THREE.Box3().setFromObject(state.cardGroup).getSize(new THREE.Vector3()).x : null,
      screen: state.cardGroup ? (() => {
        const rect = state.stageRect;
        const box = new THREE.Box3().setFromObject(state.cardGroup);
        const points = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z).project(state.camera));
        const xs = points.map((p) => (p.x * 0.5 + 0.5) * rect.width);
        const ys = points.map((p) => (0.5 - p.y * 0.5) * rect.height);
        return [round(Math.min(...xs), 1), round(Math.min(...ys), 1), round(Math.max(...xs), 1), round(Math.max(...ys), 1)];
      })() : null,
      materials: (state.cardMaterialInfo || []).slice(),
      materialStates: state.cardMaterials.map((material) => ({ name: material.name, metalness: material.metalness, roughness: material.roughness, envMapIntensity: material.envMapIntensity, transparent: material.transparent, opacity: material.opacity, map: Boolean(material.map) })),
    } : null,
    camera: state.cameraFit ? {
      fov: state.cameraFit.fovDeg,
      distance: state.cameraFit.distance,
      target: state.cameraFit.target.slice(),
      position: state.cameraFit.position.slice(),
      elevationDeg: state.cameraFit.elevationDeg,
      stage: state.cameraFit.stage,
      framing: state.cameraFit.framing,
    } : null,
    stage: { width: state.stageRect.width, height: state.stageRect.height },
    palette: {
      plane: state.plane ? { cap: '#' + state.plane.userData.materials.cap.emissive.getHexString(), capType: state.plane.userData.materials.cap.type, capToneMapped: state.plane.userData.materials.cap.toneMapped, edge: '#' + state.plane.userData.materials.edge.color.getHexString(), edgeType: state.plane.userData.materials.edge.type } : null,
      terrace: state.panels.length ? { cap: '#' + state.panels[0].userData.materials.cap.emissive.getHexString(), capType: state.panels[0].userData.materials.cap.type, capToneMapped: state.panels[0].userData.materials.cap.toneMapped, edge: '#' + state.panels[0].userData.materials.edge.color.getHexString(), edgeType: state.panels[0].userData.materials.edge.type } : null,
      floor: state.floor ? '#' + state.floor.material.color.getHexString() : null,
      // Rev21: no THREE lights exist any more -- the only light is the room
      // photo's PMREM assigned to scene.environment by ./env-room.js.
      lights: {
        count: 0,
        environment: ENV.label,
        intensity: ENV.intensity,
        appliedIntensity: state.room ? state.room.intensity : null,
      },
      exposure: state.renderer ? state.renderer.toneMappingExposure : null,
    },
    domTags: Array.from(state.tagEls.values()).map((el) => ({ id: el.dataset.tagId, visible: el.classList.contains('is-visible'), screenX: Number(el.dataset.screenX || 0), screenY: Number(el.dataset.screenY || 0) })),
    cardBank: state.bank ? { ready: true, specs: state.bank.specs.length, metadata: Boolean(state.bank.metadata) } : { ready: false },
    render: { frames: state.frames, pixelRatio: state.renderer ? state.renderer.getPixelRatio() : 0, triangles: state.renderer ? state.renderer.info.render.triangles : 0 },
    features: {
      panelsRise: true,
      cardFade: true,
      tagWaves: true,
      variants: ['a', 'b'],
    },
  };
}

function publish() {
  if (dom.diag) dom.diag.textContent = JSON.stringify(buildDebug());
  dom.body.dataset.ready = state.ready ? '1' : '0';
  dom.body.dataset.errors = String(state.errors.length);
  dom.body.dataset.variant = state.variant;
  dom.body.dataset.phase = state.phase;
  dom.body.dataset.time = state.time.toFixed(3);
  dom.body.dataset.playing = state.playing ? '1' : '0';
  dom.body.dataset.tagCount = String(PANEL_LAYOUT.tags.length);
}

const api = {
  version: VERSION,
  debug() {
    return buildDebug();
  },
  config() {
    return MODEL;
  },
  play() {
    if (!state.ready || state.shot || state.reducedMotion) return false;
    setPlaying(true);
    publish();
    return true;
  },
  pause() {
    setPlaying(false);
    publish();
    return true;
  },
  replay() {
    const ok = replay();
    publish();
    return ok;
  },
  setTime(time) {
    if (!state.ready) return false;
    if (state.shot || state.reducedMotion) return false;
    setPlaying(false);
    setTime(time);
    publish();
    return true;
  },
  setVariant(variant) {
    return setVariant(variant);
  },
  getVariant() {
    return state.variant;
  },
  projectTag(position) {
    return projectTag(position);
  },
  /** QA-only scene visibility probe (diagnostics; does not affect the normal page). */
  debugScene() {
    const rows = [];
    const visit = (object) => {
      if (object.isMesh || object.isLineSegments) {
        const material = object.material;
        const list = Array.isArray(material) ? material : [material];
        rows.push({
          name: object.name,
          type: object.type,
          pos: [round(object.position.x, 3), round(object.position.y, 3), round(object.position.z, 3)],
          visible: object.visible,
          materials: list.filter(Boolean).map((m) => ({ name: m.name, type: m.type, color: m.color ? '#' + m.color.getHexString() : null, emissive: m.emissive ? '#' + m.emissive.getHexString() : null, opacity: m.opacity, transparent: m.transparent, side: m.side })),
        });
      }
      for (const child of object.children) visit(child);
    };
    visit(state.scene);
    return rows;
  },
  debugCapColor(hex) {
    const color = new THREE.Color(hex).convertSRGBToLinear();
    if (state.plane) state.plane.userData.materials.cap.emissive.copy(color);
    for (const panel of state.panels) panel.userData.materials.cap.emissive.copy(color);
    paintFrame();
    return true;
  },
  debugVisibility(kind, visible) {
    if (kind === 'floor' && state.floor) state.floor.visible = Boolean(visible);
    if (kind === 'plane' && state.plane) state.plane.visible = Boolean(visible);
    if (kind === 'planeCap' && state.plane && state.plane.userData.cap) state.plane.userData.cap.visible = Boolean(visible);
    if (kind === 'planeBody' && state.plane && state.plane.userData.body) state.plane.userData.body.visible = Boolean(visible);
    if (kind === 'panels') for (const panel of state.panels) panel.visible = Boolean(visible);
    if (kind === 'card' && state.cardGroup) state.cardGroup.visible = Boolean(visible);
    paintFrame();
    return true;
  },
};

window.__stackedPanel = api;
state.diagTimer = window.setInterval(publish, 250);

function dispose() {
  window.clearInterval(state.diagTimer);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  if (state.resizeObserver) state.resizeObserver.disconnect();
  if (state.card) { try { state.card.dispose(); } catch (error) { /* ignore */ } }
  if (state.bank) { try { state.bank.dispose(); } catch (error) { /* ignore */ } }
  if (state.room) { try { state.room.dispose(); } catch (error) { /* best effort */ } state.room = null; }
  const disposeGroup = (group) => {
    group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (material && !material.userData.__disposed) {
            material.userData.__disposed = true;
            material.dispose();
          }
        }
      }
    });
  };
  for (const panel of state.panels) disposeGroup(panel);
  if (state.plane) disposeGroup(state.plane);
  if (state.floor) { state.floor.geometry.dispose(); state.floor.material.dispose(); }
  if (state.renderer) { state.renderer.dispose(); }
}

boot();
