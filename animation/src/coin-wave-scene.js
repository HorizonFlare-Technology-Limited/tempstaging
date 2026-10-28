/**
 * coin-wave-scene.js — three.js scene build for the Rev15 coin Wave.
 *
 * Consumes the pure composition module (./coin-wave.js) and builds:
 *  - two broad, wide-top ribbon waves running left-right: the front one in
 *    brushed stainless steel, the back one in TEKO gold with a satin finish,
 *    half a phase along X (gold crest over the steel trough); both surfaces come
 *    straight from WAVE's exact profile functions (flat-topped sine along X,
 *    broad flat top across the ribbon width), with polished long-edge bevels;
 *  - a neutral dark studio environment (PMREM): a large soft overhead panel,
 *    broad neutral side panels and a faint warm bounce for the gold, no floor;
 *  - soft authored contact-shadow decals under the three coin placements;
 *  - a small neutral light rig (white key + cool-neutral fill + back light).
 *
 * The three coins themselves are page-owned (they come from the coin model
 * bank); the page adds them to the returned group using WAVE.coins.
 *
 * Determinism: all procedural maps come from a fixed LCG seed, placements and
 * surfaces come from WAVE, nothing reads the clock or Math.random.
 */
import * as THREE from 'three';
import { WAVE, waveSurfaceHeight, waveSurfaceNormal } from './coin-wave.js';

/** TEKO theme gold (satin wave) plus the neutral studio accents. */
export const WAVE_ACCENT = Object.freeze({
  gold: 0xffd60a,
  goldDeep: 0x7d5a00,
  steel: 0xcfd4da,
  white: 0xffffff,
  role: 'TEKO brand gold satin ribbon (back wave)',
});

/* ------------------------------------------------------------------------- */
/* Deterministic procedural maps                                             */
/* ------------------------------------------------------------------------- */

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasTexture(canvas, { srgb = false, repeatU = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = repeatU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Brushed stainless steel: fine streaks run ALONG the ribbon (u), neutral cool
 * silver, low-contrast albedo + roughness + bump variation.
 */
function buildBrushedMaps(size = 512) {
  const random = lcg(0x575e7a1);
  const albedo = makeCanvas(size, size);
  const roughness = makeCanvas(size, size);
  const bump = makeCanvas(size, size);
  const albedoCtx = albedo.getContext('2d');
  const roughnessCtx = roughness.getContext('2d');
  const bumpCtx = bump.getContext('2d');
  const albedoData = albedoCtx.createImageData(size, size);
  const roughnessData = roughnessCtx.createImageData(size, size);
  const bumpData = bumpCtx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    const rowStreak = random() * 0.22 + random() * 0.1;
    for (let x = 0; x < size; x += 1) {
      const fine = random();
      const streak = rowStreak + fine * 0.06;
      const base = 0.6 + streak * 0.16;
      const index = (y * size + x) * 4;
      const albedoValue = Math.round(Math.min(1, base) * 255);
      albedoData.data[index] = albedoValue - 3;
      albedoData.data[index + 1] = albedoValue - 1;
      albedoData.data[index + 2] = albedoValue + 2;
      albedoData.data[index + 3] = 255;
      const roughnessValue = Math.round((0.3 + streak * 0.18 + fine * 0.03) * 255);
      roughnessData.data[index] = roughnessValue;
      roughnessData.data[index + 1] = roughnessValue;
      roughnessData.data[index + 2] = roughnessValue;
      roughnessData.data[index + 3] = 255;
      const bumpValue = Math.round((0.5 + streak * 0.35) * 255);
      bumpData.data[index] = bumpValue;
      bumpData.data[index + 1] = bumpValue;
      bumpData.data[index + 2] = bumpValue;
      bumpData.data[index + 3] = 255;
    }
  }
  albedoCtx.putImageData(albedoData, 0, 0);
  roughnessCtx.putImageData(roughnessData, 0, 0);
  bumpCtx.putImageData(bumpData, 0, 0);
  return {
    map: canvasTexture(albedo, { srgb: true }),
    roughnessMap: canvasTexture(roughness),
    bumpMap: canvasTexture(bump),
  };
}

/**
 * TEKO gold satin: soft, low-contrast satin sheen (no brushed streaks), a very
 * gentle mottling and a satin roughness (0.34..0.46) so it reads smooth matte
 * gold rather than mirror chrome.
 */
function buildSatinGoldMaps(size = 512) {
  const random = lcg(0x60d5a71);
  const albedo = makeCanvas(size, size);
  const roughness = makeCanvas(size, size);
  const ctx = albedo.getContext('2d');
  const rCtx = roughness.getContext('2d');
  const albedoData = ctx.createImageData(size, size);
  const roughnessData = rCtx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const mottle = (random() - 0.5) * 0.05;
      const value = 0.72 + mottle; // neutral value: the TEKO gold colour tints it
      albedoData.data[index] = Math.round(Math.min(1, value) * 255);
      albedoData.data[index + 1] = Math.round(Math.min(1, value) * 255);
      albedoData.data[index + 2] = Math.round(Math.min(1, value) * 255);
      albedoData.data[index + 3] = 255;
      const roughnessValue = Math.round((0.36 + random() * 0.12) * 255);
      roughnessData.data[index] = roughnessValue;
      roughnessData.data[index + 1] = roughnessValue;
      roughnessData.data[index + 2] = roughnessValue;
      roughnessData.data[index + 3] = 255;
    }
  }
  ctx.putImageData(albedoData, 0, 0);
  rCtx.putImageData(roughnessData, 0, 0);
  return {
    map: canvasTexture(albedo, { srgb: true }),
    roughnessMap: canvasTexture(roughness),
  };
}

/** Soft radial contact-shadow sprite (authored, deterministic, no blur filter). */
function buildContactShadowTexture(size = 256) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.3)');
  gradient.addColorStop(0.78, 'rgba(0,0,0,0.08)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/* ------------------------------------------------------------------------- */
/* Wave environment + geometry                                               */
/* ------------------------------------------------------------------------- */

/**
 * Neutral dark PMREM studio: a large soft overhead panel, two broad neutral
 * side panels, a dim back wall and a faint warm bounce for the gold. No floor,
 * no network assets, no clock/random.
 */
export function buildWaveEnvironment(renderer) {
  if (!renderer) return null;
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x050607);
  const resources = [];
  const addPanel = ({ width, height, depth, x = 0, y = 0, z = 0, color, intensity }) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), fog: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    envScene.add(mesh);
    resources.push({ mesh, geometry, material });
  };
  addPanel({ width: 26, height: 0.4, depth: 16, x: 0, y: 8.0, z: -1.0, color: 0xffffff, intensity: 1.2 });
  addPanel({ width: 18, height: 0.3, depth: 2.5, x: 0, y: 6.4, z: 3.4, color: 0xffffff, intensity: 1.0 });
  addPanel({ width: 0.4, height: 7.0, depth: 14, x: -8.0, y: 2.4, z: -2.4, color: 0xe3eaf2, intensity: 1.3 });
  addPanel({ width: 0.4, height: 7.0, depth: 14, x: 8.0, y: 2.4, z: -2.4, color: 0xe3eaf2, intensity: 1.3 });
  addPanel({ width: 24, height: 9, depth: 0.3, x: 0, y: 2.0, z: -12.0, color: 0xb8c2cc, intensity: 0.45 });
  addPanel({ width: 12, height: 0.3, depth: 0.6, x: 0, y: -2.6, z: 4.2, color: 0xffcf6a, intensity: 0.9 });

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  for (const resource of resources) {
    envScene.remove(resource.mesh);
    resource.geometry.dispose();
    resource.material.dispose();
  }
  envScene.clear();
  return {
    texture: target.texture,
    renderTarget: target,
    dispose() {
      target.dispose();
    },
  };
}

/**
 * Ribbon geometry from the exact analytic surface: top sheet (metal material,
 * group 0), polished long-edge side walls (group 1) and underside (group 0).
 * The ribbon is a broad flat strap that undulates along X; its two long edges
 * follow the wave, so the wave reads as a wavy ribbon silhouette.
 */
function buildRibbonGeometry(wave, { xSegments = 220, zSegments = 10 } = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indicesTop = [];
  const indicesEdge = [];
  const halfLength = wave.length / 2;
  const zStart = wave.zStart;
  const zSpan = wave.zEnd - wave.zStart;
  const uRepeat = 6;

  const pushVertex = (x, y, z, nx, ny, nz, u, v) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  // top sheet
  const topStart = positions.length / 3;
  for (let i = 0; i <= xSegments; i += 1) {
    const x = -halfLength + (wave.length * i) / xSegments;
    const surfaceY = waveSurfaceHeight(wave.kind, x, zStart);
    const normal = waveSurfaceNormal(wave.kind, x, zStart);
    for (let j = 0; j <= zSegments; j += 1) {
      const z = zStart + (zSpan * j) / zSegments;
      pushVertex(x, surfaceY, z, normal[0], normal[1], normal[2], (i / xSegments) * uRepeat, j / zSegments);
    }
  }
  for (let i = 0; i < xSegments; i += 1) {
    for (let j = 0; j < zSegments; j += 1) {
      const a = topStart + i * (zSegments + 1) + j;
      const b = a + 1;
      const c = a + (zSegments + 1);
      const d = c + 1;
      indicesTop.push(a, c, b, b, c, d);
    }
  }

  // underside, opposite winding
  const bottomStart = positions.length / 3;
  for (let i = 0; i <= xSegments; i += 1) {
    const x = -halfLength + (wave.length * i) / xSegments;
    const surfaceY = waveSurfaceHeight(wave.kind, x, zStart);
    for (let j = 0; j <= zSegments; j += 1) {
      const z = zStart + (zSpan * j) / zSegments;
      pushVertex(x, surfaceY - wave.thickness, z, 0, -1, 0, (i / xSegments) * uRepeat, j / zSegments);
    }
  }
  for (let i = 0; i < xSegments; i += 1) {
    for (let j = 0; j < zSegments; j += 1) {
      const a = bottomStart + i * (zSegments + 1) + j;
      const b = a + 1;
      const c = a + (zSegments + 1);
      const d = c + 1;
      indicesTop.push(a, b, c, b, d, c);
    }
  }

  // polished long-edge side walls (two long edges of the strap)
  for (const edge of [
    { z: zStart, side: -1 },
    { z: wave.zEnd, side: 1 },
  ]) {
    const edgeStart = positions.length / 3;
    const normal = [0, 0.18, edge.side];
    const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
    const n = [normal[0] / normalLength, normal[1] / normalLength, normal[2] / normalLength];
    for (let i = 0; i <= xSegments; i += 1) {
      const x = -halfLength + (wave.length * i) / xSegments;
      const surfaceY = waveSurfaceHeight(wave.kind, x, edge.z);
      pushVertex(x, surfaceY, edge.z, n[0], n[1], n[2], (i / xSegments) * uRepeat, 1);
      pushVertex(x, surfaceY - wave.thickness, edge.z, n[0], n[1], n[2], (i / xSegments) * uRepeat, 0);
    }
    for (let i = 0; i < xSegments; i += 1) {
      const a = edgeStart + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (edge.side > 0) indicesEdge.push(a, b, c, c, b, d);
      else indicesEdge.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([...indicesTop, ...indicesEdge]);
  geometry.addGroup(0, indicesTop.length, 0);
  geometry.addGroup(indicesTop.length, indicesEdge.length, 1);
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------------- */
/* Composition                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Build the Wave scene (ribbons + studio + contact decals + lights).
 * @param {{ renderer?: THREE.WebGLRenderer, castShadow?: boolean }} [options]
 * @returns {{
 *   group: THREE.Group,
 *   environment: { texture: THREE.Texture, dispose: () => void } | null,
 *   lights: Record<string, THREE.Light>,
 *   materials: Record<string, THREE.Material>,
 *   waves: Record<string, { mesh: THREE.Mesh, geometry: THREE.BufferGeometry }>,
 *   frame: () => object,
 *   debug: () => object,
 *   dispose: () => void
 * }}
 */
export function createWaveComposition(options = {}) {
  const renderer = options.renderer || null;
  const group = new THREE.Group();
  group.name = 'coin-wave-composition';

  const steelMaps = buildBrushedMaps(512);
  const goldMaps = buildSatinGoldMaps(512);
  const contactTexture = new THREE.CanvasTexture(buildContactShadowTexture(256));
  contactTexture.encoding = THREE.LinearEncoding;
  contactTexture.needsUpdate = true;

  const steelMaterial = new THREE.MeshPhysicalMaterial({
    map: steelMaps.map,
    roughnessMap: steelMaps.roughnessMap,
    bumpMap: steelMaps.bumpMap,
    bumpScale: 0.0016,
    color: 0xffffff,
    metalness: 1.0,
    roughness: 0.38,
    clearcoat: 0.04,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });
  steelMaterial.name = 'wave-steel-brushed';
  const goldMaterial = new THREE.MeshPhysicalMaterial({
    map: goldMaps.map,
    roughnessMap: goldMaps.roughnessMap,
    color: 0xffd60a,
    metalness: 0.0,
    roughness: 0.5,
    clearcoat: 0.0,
    clearcoatRoughness: 1.0,
    envMapIntensity: 0.5,
    side: THREE.DoubleSide,
  });
  goldMaterial.name = 'wave-gold-satin';
  const goldEdgeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffe55c,
    metalness: 1.0,
    roughness: 0.24,
    clearcoat: 0.2,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.15,
    side: THREE.DoubleSide,
  });
  goldEdgeMaterial.name = 'wave-gold-polished-edge';
  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdfe4ea,
    metalness: 1.0,
    roughness: 0.2,
    clearcoat: 0.28,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
  });
  edgeMaterial.name = 'wave-polished-edge';

  const goldRibbonMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffd60a,
    metalness: 0.5,
    roughness: 0.48,
    clearcoat: 0.04,
    clearcoatRoughness: 0.5,
    envMapIntensity: 1.25,
    side: THREE.DoubleSide,
  });
  goldRibbonMaterial.name = 'wave-gold-satin';
  const materials = { steel: steelMaterial, gold: goldRibbonMaterial, edge: edgeMaterial };
  const textures = [steelMaps.map, steelMaps.roughnessMap, steelMaps.bumpMap, goldMaps.map, goldMaps.roughnessMap];
  const geometries = [];
  const waves = {};

  for (const kind of ['steel', 'gold']) {
    const spec = WAVE.waves[kind];
    const geometry = buildRibbonGeometry(spec);
    geometries.push(geometry);
    // one material per ribbon so the whole wave surface reads as that metal
    const mesh = new THREE.Mesh(geometry, kind === 'steel' ? steelMaterial : goldRibbonMaterial);
    mesh.name = 'wave-ribbon-' + kind;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    waves[kind] = { mesh, geometry, spec };
  }

  // soft contact shadows under the page-owned coins (grounding, no float look)
  const decals = [];
  for (const coin of WAVE.coins) {
    const surface = waveSurfaceHeight(coin.surface, coin.position[0], coin.position[2]);
    const geometry = new THREE.PlaneGeometry(coin.radius * 3.2, coin.radius * 2.4);
    const material = new THREE.MeshBasicMaterial({
      map: contactTexture,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const decal = new THREE.Mesh(geometry, material);
    decal.name = 'wave-contact-' + coin.id;
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(coin.position[0], surface + 0.002, coin.position[2]);
    group.add(decal);
    decals.push({ decal, geometry, material });
  }

  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(4.5, 7.5, 6.5);
  key.castShadow = false;
  group.add(key);
  const fill = new THREE.DirectionalLight(0xdfe6f0, 0.35);
  fill.position.set(-5.5, 3.5, 4.5);
  fill.castShadow = false;
  group.add(fill);
  const back = new THREE.DirectionalLight(0xffffff, 0.25);
  back.position.set(-2.5, 4.5, -6.0);
  back.castShadow = false;
  group.add(back);
  const lights = { key, fill, back };

  const environment = renderer ? buildWaveEnvironment(renderer) : null;

  let disposed = false;
  const composition = {
    group,
    environment,
    lights,
    materials,
    waves,
    frame() {
      return composition.debug();
    },
    debug() {
      return {
        design: 'two-ribbon-waves',
        waves: Object.keys(waves).map((kind) => ({
          kind,
          label: WAVE.waves[kind].label,
          finish: WAVE.waves[kind].finish,
          vertices: waves[kind].geometry.getAttribute('position').count,
          triangles: waves[kind].geometry.index.count / 3,
          zStart: WAVE.waves[kind].zStart,
          zEnd: WAVE.waves[kind].zEnd,
          troughX: WAVE.waves[kind].troughX ?? WAVE.waves[kind].crestX,
          amplitude: WAVE.waves[kind].amplitude,
          wavelength: WAVE.waves[kind].wavelength,
        })),
        materials: Object.keys(materials).map((keyName) => ({
          key: keyName,
          name: materials[keyName].name,
          color: '#' + materials[keyName].color.getHexString(),
          metalness: materials[keyName].metalness,
          roughness: materials[keyName].roughness,
        })),
        lights: Object.keys(lights).map((name) => ({ name, type: lights[name].type, intensity: lights[name].intensity })),
        environment: Boolean(environment),
        contactDecals: decals.length,
        coins: WAVE.count,
        spacing: WAVE.metrics.spacing,
        phase: WAVE.metrics.phase,
        contact: WAVE.metrics.contact,
        bounds: WAVE.metrics.bounds,
        shadows: false,
        postProcessing: false,
        disposed,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      for (const e of Object.values(materials)) e.dispose();
      for (const texture of textures) texture.dispose();
      contactTexture.dispose();
      for (const decal of decals) {
        decal.geometry.dispose();
        decal.material.dispose();
      }
      decals.length = 0;
      if (environment) environment.dispose();
      for (const light of Object.values(lights)) group.remove(light);
      group.removeFromParent();
      group.clear();
    },
  };
  return composition;
}
