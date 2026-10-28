/**
 * paperplane-model.js — Rev17 classic folded paper plane.
 *
 * Rebuilt from the six supplied references (paperplane.jpg / -black / -blue /
 * -cyan / -white / -yellow): a classic folded dart — two swept delta wings meeting
 * at a raised centre ridge, a crease on each wing, and a folded keel/tail below
 * the body. The old rounded three-solid metal model is retired.
 *
 * The paper is thin, flat panels meeting at sharp creases. The material is silver
 * with THEME-GOLD transmitted light: a translucent MeshPhysicalMaterial
 * (transmission 0.35, attenuation #ffd60a, thin thickness) plus gold additive edge
 * lines and a warm gold back light, so the paper edges visibly glow gold. No
 * external textures are used.
 *
 * Deterministic: no randomness, no clock, no DOM. The page owns layout, camera,
 * interaction, reduced motion and shot determinism (paperplane-preview.js).
 */
import * as THREE from 'three';

export const MODEL_VERSION = '3.0.0';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/* ------------------------------------------------------------------ spec */
/*
 * Planform frame: x = lateral (span), z = longitudinal (nose at +Z), y = up.
 * The plane is built from flat paper triangles; fold lines are shared edges.
 */
export const PLANE_SPEC = Object.freeze({
  noseZ: 1.05,
  tailZ: -0.68,
  halfSpan: 0.98,
  folded: Object.freeze({
    style: 'classic-dart',
    ridge: Object.freeze({
      nose: Object.freeze([0, 0.16, 1.06]),
      tail: Object.freeze([0, 0.24, -0.64]),
      raise: 0.03,
    }),
    wings: Object.freeze({
      tipLeft: Object.freeze([-1.02, -0.34, -0.72]),
      tipRight: Object.freeze([1.02, -0.34, -0.72]),
      foldLeft: Object.freeze([-0.5, 0.03, -0.66]),
      foldRight: Object.freeze([0.5, 0.03, -0.66]),
      leadingSweepDeg: 31.5,
      dihedralDeg: 7.2,
    }),
    keel: Object.freeze({
      top: Object.freeze([0, 0.15, 0.85]),
      tail: Object.freeze([0, 0.05, -0.58]),
      bottom: Object.freeze([0, -0.55, 0.28]),
      tailNotch: Object.freeze([0, -0.26, -0.82]),
      thickness: 0.004,
    }),
    paper: Object.freeze({
      panels: 7,
      creases: 12,
      thinEdge: 0.004,
      sharpNormals: true,
    }),
  }),
  // Serialised wing/body summary for debug() (kept small and JSON-safe).
  fuselage: Object.freeze({
    kind: 'folded-keel',
    keelBottomY: -0.3,
    keelTopY: 0.05,
    ridgeRaise: 0.028,
    thickness: 0.004,
  }),
  wing: Object.freeze({
    kind: 'two-panel-delta',
    panelsPerSide: 2,
    foldLine: 'nose-to-trailing-edge',
    tipY: -0.105,
    dihedralDeg: 7.2,
    leadingSweepDeg: 31.5,
  }),
});

/* --------------------------------------------------------------- material */

export const MATERIAL_SPEC = Object.freeze({
  color: '#8995a1',
  // Neutral cool silver paper; the gold lives only in the transmitted light
  // (attenuation), the fold-edge lines/ribbons, the back light and the halo.
  metalness: 0.45,
  roughness: 0.5,
  clearcoat: 0.14,
  clearcoatRoughness: 0.3,
  envMapIntensity: 0.85,
  specularIntensity: 0.6,
  bumpScale: 0,
  ior: 1.45,
  transmission: 0.3,
  thickness: 0.45,
  attenuationColor: '#ffd60a',
  attenuationDistance: 0.5,
  emissive: '#ffd60a',
  emissiveIntensity: 0.05,
  edgeColor: '#ffd60a',
  edgeOpacity: 0.95,
  edgeRibbonWidth: 0.016,
  backlightColor: '#ffd60a',
  backlightIntensity: 1.6,
  backlightDistance: 3.8,
});

export const CAMERA_SPEC = Object.freeze({
  fov: 30,
  azimuthDeg: 28,
  elevationDeg: 35,
  rollDeg: -4,
  fitMargin: 0.84,
  fitMarginNarrow: 0.9,
  narrowStageWidth: 560,
  near: 0.05,
  far: 80,
});

export const IDLE_SPEC = Object.freeze({
  floatAmplitude: 0.032,
  floatPeriod: 7.4,
  driftAmplitude: 0.012,
  driftPeriod: 4.6,
  driftPhase: 1.2,
  pitchDeg: 1.35,
  pitchPeriod: 8.2,
  rollDeg: 1.9,
  rollPeriod: 6.1,
  yawDeg: 0.9,
  yawPeriod: 9.6,
  settleMs: 520,
});

export const SURFACE_SPEC = Object.freeze({
  // Kept for the page's surface debug block; the folded rebuild needs no maps.
  seed: 0x5eed1a3,
  colorSize: 0,
  dataSize: 0,
  bumpSize: 0,
  metalSize: 0,
  speckles: 0,
  clusters: 0,
  smudges: 0,
  baseColor: Object.freeze([205, 211, 218]),
  speckleColors: Object.freeze([]),
});

/* ------------------------------------------------------------ paper panels */

const PANELS = Object.freeze([
  // wing inner panels (ridge -> wing crease)
  Object.freeze({ id: 'wing-inner-left', cornerA: 'nose', cornerB: 'ridgeTail', cornerC: 'foldLeft' }),
  Object.freeze({ id: 'wing-inner-right', cornerA: 'nose', cornerB: 'foldRight', cornerC: 'ridgeTail' }),
  // wing outer panels (crease -> swept tip)
  Object.freeze({ id: 'wing-outer-left', cornerA: 'nose', cornerB: 'foldLeft', cornerC: 'tipLeft' }),
  Object.freeze({ id: 'wing-outer-right', cornerA: 'nose', cornerB: 'tipRight', cornerC: 'foldRight' }),
  // folded keel and rear tail notch (vertical paper fin under the body)
  Object.freeze({ id: 'keel', cornerA: 'keelTop', cornerB: 'keelBottom', cornerC: 'keelTail' }),
  Object.freeze({ id: 'keel-tail', cornerA: 'keelTop', cornerB: 'keelTailNotch', cornerC: 'keelTail' }),
  // small raised ridge strip so the centre fold reads like the reference tube
  Object.freeze({ id: 'ridge', cornerA: 'ridgeLow', cornerB: 'ridgeHigh', cornerC: 'ridgeTailLow' }),
]);

const CREASES = Object.freeze([
  Object.freeze({ id: 'ridge-line', from: 'nose', to: 'ridgeTail' }),
  Object.freeze({ id: 'crease-left', from: 'nose', to: 'foldLeft' }),
  Object.freeze({ id: 'crease-right', from: 'nose', to: 'foldRight' }),
  Object.freeze({ id: 'leading-left', from: 'nose', to: 'tipLeft' }),
  Object.freeze({ id: 'leading-right', from: 'nose', to: 'tipRight' }),
  Object.freeze({ id: 'trailing-left', from: 'tipLeft', to: 'foldLeft' }),
  Object.freeze({ id: 'trailing-right', from: 'foldRight', to: 'tipRight' }),
  Object.freeze({ id: 'trailing-centre-left', from: 'ridgeTail', to: 'foldLeft' }),
  Object.freeze({ id: 'trailing-centre-right', from: 'foldRight', to: 'ridgeTail' }),
  Object.freeze({ id: 'keel-top', from: 'keelTop', to: 'keelTail' }),
  Object.freeze({ id: 'keel-bottom-left', from: 'keelTop', to: 'keelBottom' }),
  Object.freeze({ id: 'keel-bottom-right', from: 'keelBottom', to: 'keelTail' }),
]);

function buildCorners() {
  const folded = PLANE_SPEC.folded;
  const nose = folded.ridge.nose.slice();
  const ridgeTail = folded.ridge.tail.slice();
  return {
    nose,
    ridgeTail,
    tipLeft: folded.wings.tipLeft.slice(),
    tipRight: folded.wings.tipRight.slice(),
    foldLeft: folded.wings.foldLeft.slice(),
    foldRight: folded.wings.foldRight.slice(),
    keelTop: folded.keel.top.slice(),
    keelTail: folded.keel.tail.slice(),
    keelBottom: folded.keel.bottom.slice(),
    keelTailNotch: folded.keel.tailNotch.slice(),
    // thin ridge strip: two low points and one raised ridge point
    ridgeLow: [nose[0] - 0.012, nose[1] - 0.006, nose[2] - 0.02],
    ridgeHigh: [0, nose[1] + folded.ridge.raise, nose[2] - 0.16],
    ridgeTailLow: [ridgeTail[0] - 0.012, ridgeTail[1] - 0.008, ridgeTail[2]],
  };
}

const CORNERS = buildCorners();

function triangleGeometry(panelList) {
  const positions = [];
  const normals = [];
  const triangles = [];
  for (const panel of panelList) {
    const a = CORNERS[panel.cornerA];
    const b = CORNERS[panel.cornerB];
    const c = CORNERS[panel.cornerC];
    // flat triangle with an explicit normal (sharp creases)
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const normal = ab.cross(ac);
    if (normal.lengthSq() < 1e-12) continue;
    normal.normalize();
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i += 1) normals.push(normal.x, normal.y, normal.z);
    triangles.push(panel.id);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  geometry.computeBoundingSphere();
  return { geometry, triangles };
}

function buildKeelGeometry() {
  // keel panels are part of the same paper sheet but shaded a touch darker
  const keelPanels = PANELS.filter((panel) => panel.id.startsWith('keel'));
  return triangleGeometry(keelPanels);
}

function buildWingsGeometry() {
  const wingPanels = PANELS.filter((panel) => panel.id.startsWith('wing'));
  return triangleGeometry(wingPanels);
}

function buildRidgeGeometry() {
  const ridgePanels = PANELS.filter((panel) => panel.id === 'ridge');
  return triangleGeometry(ridgePanels);
}

function buildEdgeGeometry() {
  const positions = [];
  for (const crease of CREASES) {
    const a = CORNERS[crease.from];
    const b = CORNERS[crease.to];
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Thin gold emissive ribbons along the fold lines (readable paper-edge glow). */
function buildEdgeRibbonGeometry(width) {
  const positions = [];
  const half = width / 2;
  for (const crease of CREASES) {
    const a = new THREE.Vector3(...CORNERS[crease.from]);
    const b = new THREE.Vector3(...CORNERS[crease.to]);
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const reference = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const perp = new THREE.Vector3().crossVectors(dir, reference).normalize().multiplyScalar(half);
    const a0 = [a.x + perp.x, a.y + perp.y, a.z + perp.z];
    const a1 = [a.x - perp.x, a.y - perp.y, a.z - perp.z];
    const b0 = [b.x + perp.x, b.y + perp.y, b.z + perp.z];
    const b1 = [b.x - perp.x, b.y - perp.y, b.z - perp.z];
    positions.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------ model */

export function createPaperPlane({ createCanvas = null, anisotropy = 1 } = {}) {
  void createCanvas;
  void anisotropy;
  const wings = buildWingsGeometry();
  const keel = buildKeelGeometry();
  const ridge = buildRidgeGeometry();
  const edgeGeometry = buildEdgeGeometry();
  const edgeRibbonGeometry = buildEdgeRibbonGeometry(MATERIAL_SPEC.edgeRibbonWidth);

  const wingMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(MATERIAL_SPEC.color),
    metalness: MATERIAL_SPEC.metalness,
    roughness: MATERIAL_SPEC.roughness,
    clearcoat: MATERIAL_SPEC.clearcoat,
    clearcoatRoughness: MATERIAL_SPEC.clearcoatRoughness,
    envMapIntensity: MATERIAL_SPEC.envMapIntensity,
    specularIntensity: MATERIAL_SPEC.specularIntensity,
    ior: MATERIAL_SPEC.ior,
    transmission: MATERIAL_SPEC.transmission,
    thickness: MATERIAL_SPEC.thickness,
    attenuationColor: new THREE.Color(MATERIAL_SPEC.attenuationColor),
    attenuationDistance: MATERIAL_SPEC.attenuationDistance,
    emissive: new THREE.Color(MATERIAL_SPEC.emissive),
    emissiveIntensity: MATERIAL_SPEC.emissiveIntensity,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  wingMaterial.name = 'paperplane-folded-silver-gold-transmission';

  const keelMaterial = wingMaterial.clone();
  keelMaterial.name = 'paperplane-folded-keel-silver';
  keelMaterial.color.setHex(0x8e99a4);
  keelMaterial.transmission = 0.3;
  keelMaterial.roughness = 0.34;

  const ridgeMaterial = wingMaterial.clone();
  ridgeMaterial.name = 'paperplane-folded-ridge-silver';
  ridgeMaterial.color.setHex(0xb6bec8);
  ridgeMaterial.emissiveIntensity = 0.16;

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(MATERIAL_SPEC.edgeColor),
    transparent: true,
    opacity: MATERIAL_SPEC.edgeOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  edgeMaterial.name = 'paperplane-gold-fold-edges';
  const edgeRibbonMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(MATERIAL_SPEC.edgeColor),
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  edgeRibbonMaterial.name = 'paperplane-gold-fold-edge-ribbons';

  const wingsMesh = new THREE.Mesh(wings.geometry, wingMaterial);
  wingsMesh.name = 'folded paper wings';
  const keelMesh = new THREE.Mesh(keel.geometry, keelMaterial);
  keelMesh.name = 'folded paper keel';
  const ridgeMesh = new THREE.Mesh(ridge.geometry, ridgeMaterial);
  ridgeMesh.name = 'folded centre ridge';
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.name = 'gold glowing fold edges';
  const edgeRibbons = new THREE.Mesh(edgeRibbonGeometry, edgeRibbonMaterial);
  edgeRibbons.name = 'gold glowing fold-edge ribbons';

  const backlight = new THREE.PointLight(
    new THREE.Color(MATERIAL_SPEC.backlightColor),
    MATERIAL_SPEC.backlightIntensity,
    MATERIAL_SPEC.backlightDistance,
    2,
  );
  backlight.name = 'gold transmitted-light backlight';
  backlight.position.set(0.1, -0.55, -0.95);

  const underglow = new THREE.PointLight(
    new THREE.Color(MATERIAL_SPEC.backlightColor),
    0.7,
    2.2,
    2,
  );
  underglow.name = 'gold underglow through the paper';
  underglow.position.set(0.0, -0.72, 0.15);

  // procedural gold halo behind the paper (no external textures)
  let glow = null;
  if (typeof createCanvas === 'function' || typeof document !== 'undefined') {
    const size = 256;
    const canvas = typeof createCanvas === 'function'
      ? createCanvas(size, size)
      : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (canvas) {
      if (!canvas.width) canvas.width = size;
      if (!canvas.height) canvas.height = size;
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (context) {
        const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gradient.addColorStop(0, 'rgba(255, 214, 10, 0.55)');
        gradient.addColorStop(0.45, 'rgba(255, 214, 10, 0.22)');
        gradient.addColorStop(0.78, 'rgba(255, 214, 10, 0.06)');
        gradient.addColorStop(1, 'rgba(255, 214, 10, 0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture,
          color: new THREE.Color(MATERIAL_SPEC.backlightColor),
          transparent: true,
          opacity: 0.26,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        spriteMaterial.name = 'paperplane-gold-transmitted-glow';
        glow = new THREE.Sprite(spriteMaterial);
        glow.name = 'gold transmitted-light halo';
        glow.position.set(0.05, 0.02, -0.42);
        glow.scale.set(2.4, 1.8, 1);
      }
    }
  }

  const root = new THREE.Group();
  root.name = 'Folded paper plane';
  root.add(wingsMesh, keelMesh, ridgeMesh, edges, edgeRibbons, glow || new THREE.Group(), backlight, underglow);

  // centre the local bounding box so the studio orbit target is the plane
  root.updateMatrixWorld(true);
  const rawBounds = new THREE.Box3().setFromObject(root);
  const center = rawBounds.getCenter(new THREE.Vector3());
  for (const mesh of [wingsMesh, keelMesh, ridgeMesh, edges, edgeRibbons]) mesh.position.sub(center);
  if (glow) glow.position.sub(center);
  underglow.position.sub(center);
  backlight.position.sub(center);
  root.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const fitPoints = [];
  const world = new THREE.Vector3();
  for (const mesh of [wingsMesh, keelMesh, ridgeMesh]) {
    mesh.updateMatrix();
    const positions = mesh.geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      world.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrix);
      fitPoints.push(world.x, world.y, world.z);
    }
  }

  const vertexCount = wings.geometry.attributes.position.count
    + keel.geometry.attributes.position.count
    + ridge.geometry.attributes.position.count;
  const triangleCount = wings.geometry.attributes.position.count / 3
    + keel.geometry.attributes.position.count / 3
    + ridge.geometry.attributes.position.count / 3;
  const stats = {
    vertices: vertexCount,
    triangles: triangleCount,
    wingsVertices: wings.geometry.attributes.position.count,
    keelVertices: keel.geometry.attributes.position.count,
    ridgeVertices: ridge.geometry.attributes.position.count,
    panels: PANELS.length,
    creases: CREASES.length,
    parts: 4,
    speckles: 0,
  };

  function dispose() {
    wings.geometry.dispose();
    keel.geometry.dispose();
    ridge.geometry.dispose();
    edgeGeometry.dispose();
    edgeRibbonGeometry.dispose();
    edgeRibbonMaterial.dispose();
    wingMaterial.dispose();
    keelMaterial.dispose();
    ridgeMaterial.dispose();
    edgeMaterial.dispose();
  }

  return {
    root,
    folded: true,
    version: MODEL_VERSION,
    fuselage: keelMesh,
    wingLeft: wingsMesh,
    wingRight: wingsMesh,
    wings: wingsMesh,
    keel: keelMesh,
    ridge: ridgeMesh,
    edges,
    backlight,
    material: wingMaterial,
    fuselageMaterial: keelMaterial,
    ridgeMaterial,
    edgeMaterial,
    edgeRibbonMaterial,
    edgeRibbons,
    glow,
    underglow,
    textures: null,
    maps: { speckles: 0, seed: SURFACE_SPEC.seed, colorSize: 0, roughnessMean: 1, metalnessMean: 1 },
    spec: PLANE_SPEC,
    panels: PANELS.map((panel) => panel.id),
    creases: CREASES.map((crease) => crease.id),
    corners: CORNERS,
    stats,
    bounds: {
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
      center: { x: bounds.getCenter(new THREE.Vector3()).x, y: bounds.getCenter(new THREE.Vector3()).y, z: bounds.getCenter(new THREE.Vector3()).z },
      size: { x: size.x, y: size.y, z: size.z },
    },
    fitPoints,
  };
}

/* ------------------------------------------------------------------ idle */

export function idlePose(timeSeconds, settle = 1, spec = IDLE_SPEC) {
  const t = timeSeconds;
  const s = clamp01(settle);
  const float = (Math.sin((t * TAU) / spec.floatPeriod) * spec.floatAmplitude
    + Math.sin((t * TAU) / spec.driftPeriod + spec.driftPhase) * spec.driftAmplitude) * s;
  return {
    float,
    pitchDeg: Math.sin((t * TAU) / spec.pitchPeriod + 0.4) * spec.pitchDeg * s,
    rollDeg: Math.sin((t * TAU) / spec.rollPeriod + 1.7) * spec.rollDeg * s,
    yawDeg: Math.sin((t * TAU) / spec.yawPeriod + 2.2) * spec.yawDeg * s,
  };
}

export function applyIdlePose(root, pose) {
  root.position.set(0, pose.float, 0);
  root.rotation.set(pose.pitchDeg * DEG, pose.yawDeg * DEG, pose.rollDeg * DEG, 'XYZ');
}

export function createSeededRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
