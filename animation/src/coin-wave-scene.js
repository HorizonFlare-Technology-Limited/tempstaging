/**
 * coin-wave-scene.js — three.js scene build for the Rev21 coin Wave.
 *
 * Consumes the pure composition module (./coin-wave.js) and builds:
 *  - two true sine ribbon waves running left-right: the front one in polished
 *    stainless steel (sin), the back one in the Rev21 slate blue-violet with a
 *    diagonal gradient albedo + fine dot-grid (cos after the rev26 s51 swap; steel is
 *    sin + 19/4); both surfaces come straight from WAVE's
 *    exact sine profile functions, with polished rounded long-edge bevels;
 *  - soft authored contact-shadow decals under the three coin placements;
 *  - no lights and no private studio environment: the shared room photo
 *    (src/env-room.js -> assets/env/modern-empty-room.jpg) is the only light
 *    source (Revision 21).
 *
 * The three coins themselves are page-owned (they come from the coin model
 * bank); the page adds them to the returned group using WAVE.coins.
 *
 * Determinism: all procedural maps come from a fixed LCG seed, placements and
 * surfaces come from WAVE, nothing reads the clock or Math.random.
 */
import * as THREE from 'three';
import { ENV_ROOM } from './env-room.js';
import { WAVE, waveSurfaceHeight, waveSurfaceNormal } from './coin-wave.js';
// s58: IMPORT-ONLY reuse of the columns material bank (columns-model.js is not edited).
import { loadColumnBank, createColumns, UV_DENSITY_SCALE, COLUMN_PATTERN_SCALE } from './columns-model.js';

// Rev21: the shared room photo is the only light source (applied to the page's
// own scene by src/env-room.js). The composition never builds an environment.
const ENV_ROOM_LABEL = ENV_ROOM.url + ' (PMREM, env-room)';

/**
 * s58: selectable wave materials. 'default' = the authored look (polished steel
 * / slate ribbon). The rest are the columns-bank materials (reeded excluded;
 * knurl no longer exists), triplanar-patched by columns-model createColumns.
 */
export const WAVE_MATERIAL_CHOICES = Object.freeze(['default', 'plaster', 'satin', 'grain-metal', 'titanium']);
/** Wave kinds that accept a material choice: steel = metal wave, gold = blue slate ribbon. */
export const WAVE_MATERIAL_KINDS = Object.freeze(['steel', 'gold']);
/**
 * Pattern scale glue. The bank triplanar maps in OBJECT space with
 * 1 / (tilePx * UV_DENSITY_SCALE * COLUMN_PATTERN_SCALE * patternDivisor); the
 * columns are ~200 units, the ribbon ~0.25 wide, so the divisor shrinks the
 * tile to WAVE_PATTERN_TILE_WORLD world units for the plaster tile (420 px);
 * other materials keep their manifest tile ratio. Fine-detail octaves scale
 * with the same divisor and fade by screen derivative (no shimmer).
 */
export const WAVE_PATTERN_TILE_WORLD = 0.5;
const WAVE_PATTERN_REF_TILE_PX = 420;
export const WAVE_PATTERN_DIVISOR = WAVE_PATTERN_TILE_WORLD / (WAVE_PATTERN_REF_TILE_PX * UV_DENSITY_SCALE * COLUMN_PATTERN_SCALE);
/** Per-material env gain on the wave (the bank values are tuned for the cards page). */
const WAVE_BANK_ENV = Object.freeze({ plaster: 0.7, satin: 0.8, 'grain-metal': 0.7, titanium: 0.7 });

/** Rev21 slate blue-violet palette (refs/rev21/wave-gold-color.png). */
export const WAVE_ACCENT = Object.freeze({
  gold: 0x4c5482,
  goldDeep: 0x2a3054,
  gradientTop: 0x7e84b2,
  steel: 0xcfd4da,
  white: 0xffffff,
  role: 'slate blue-violet ribbon (back wave)',
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

/**
 * Rev21 slate blue-violet albedo for the back ribbon (refs/rev21/wave-gold-color.png):
 * a diagonal gradient bottom-left #2a3054 -> centre #4c5482 -> top-right #7e84b2
 * with the ref's fine dot-grid overlaid. Authored, deterministic (no randomness,
 * no network). It is an ALBEDO map on a metalness=1 material, so the ribbon keeps
 * its polished-metal response instead of reading as paint.
 */
function buildSlateGradientTexture(width = 1024, height = 256) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // diagonal bottom-left -> top-right (canvas y grows downward)
  const gradient = ctx.createLinearGradient(0, height, width, 0);
  gradient.addColorStop(0, '#2a3054');
  gradient.addColorStop(0.5, '#4c5482');
  gradient.addColorStop(1, '#7e84b2');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  // fine dot-grid: milled-panel micro texture from the reference
  const spacing = 8;
  for (let y = spacing / 2; y < height; y += spacing) {
    for (let x = spacing / 2; x < width; x += spacing) {
      const light = ((x / spacing) | 0) % 2 === ((y / spacing) | 0) % 2;
      ctx.fillStyle = light ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
      ctx.fillRect(x - 1, y - 1, 1.6, 1.6);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.encoding = THREE.sRGBEncoding;
  // UVs are world-space (u = x, v = cross-section arc length); remap the run of
  // the ribbon onto the full gradient with a little diagonal variation across
  // the narrow width.
  const length = WAVE.waves.gold.length || 1;
  const band = Math.max(1e-6, WAVE.waves.gold.width * 2.2);
  texture.repeat.set(1 / length, 1 / band);
  texture.offset.set(0.5, 0.5);
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------------- */
/* Wave geometry                                                             */
/* ------------------------------------------------------------------------- */

/** Rounded-edge cross-section arc segments per long edge (Rev18: edges are circular arcs). */
const EDGE_ARC_SEGMENTS = 10;

/**
 * Ribbon geometry from the exact analytic surface. Rev18: the strap is swept
 * along X with a closed rounded cross-section (flat top, flat underside, and
 * the two long edges are semicircular arcs of radius thickness/2), so the
 * wave sides are thin and round instead of square walls. One surface, one
 * material; UVs are world-scaled (1 unit = 1 world unit); the Rev20
 * ribbons carry no pattern maps, UVs are kept for tooling.
 */
function buildRibbonGeometry(wave, { xSegments = 220, zFlatSegments = 8 } = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const halfLength = wave.length / 2;
  const r = wave.thickness / 2;
  const zLeft = wave.zStart + r; // arc centre z (left edge)
  const zRight = wave.zEnd - r; // arc centre z (right edge)
  const flat = zRight - zLeft;

  // closed section loop: z, dy (relative to the top surface), unit normal (sy, sz), arc length so far
  const section = [];
  let along = 0;
  const addPoint = (z, dy, sy, sz) => {
    if (section.length) {
      const prev = section[section.length - 1];
      along += Math.hypot(z - prev.z, dy - prev.dy);
    }
    section.push({ z, dy, sy, sz, along });
  };
  // top, left -> right
  for (let j = 0; j <= zFlatSegments; j += 1) addPoint(zLeft + (flat * j) / zFlatSegments, 0, 1, 0);
  // right arc, from the top (+Y) around +Z to the underside (-Y)
  for (let k = 1; k <= EDGE_ARC_SEGMENTS; k += 1) {
    const a = (Math.PI * k) / EDGE_ARC_SEGMENTS;
    addPoint(zRight + r * Math.sin(a), -r + r * Math.cos(a), Math.cos(a), Math.sin(a));
  }
  // underside, right -> left
  for (let j = 1; j <= zFlatSegments; j += 1) addPoint(zRight - (flat * j) / zFlatSegments, -2 * r, -1, 0);
  // left arc, from the underside (-Y) around -Z back to the top (+Y)
  for (let k = 1; k < EDGE_ARC_SEGMENTS; k += 1) {
    const a = Math.PI + (Math.PI * k) / EDGE_ARC_SEGMENTS;
    addPoint(zLeft + r * Math.sin(a), -r + r * Math.cos(a), Math.cos(a), Math.sin(a));
  }
  const ringSize = section.length;

  for (let i = 0; i <= xSegments; i += 1) {
    const x = -halfLength + (wave.length * i) / xSegments;
    const surfaceY = waveSurfaceHeight(wave.kind, x, wave.zStart);
    const tilt = waveSurfaceNormal(wave.kind, x, wave.zStart);
    for (let j = 0; j < ringSize; j += 1) {
      const point = section[j];
      // world normal: section normal with the wave's slope tilt on the vertical part
      let nx = tilt[0] * point.sy;
      let ny = tilt[1] * point.sy;
      let nz = point.sz;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      positions.push(x, surfaceY + point.dy, point.z);
      normals.push(nx, ny, nz);
      uvs.push(x, point.along);
    }
  }
  for (let i = 0; i < xSegments; i += 1) {
    for (let j = 0; j < ringSize - 1; j += 1) {
      const a = i * ringSize + j;
      const b = a + 1;
      const c = (i + 1) * ringSize + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    // closing quad: last section point -> first (the left arc ends at the top-left corner)
    const a = i * ringSize + (ringSize - 1);
    const b = i * ringSize;
    const c = (i + 1) * ringSize + (ringSize - 1);
    const d = (i + 1) * ringSize;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------------- */
/* Composition                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Build the Wave scene (ribbons + contact decals). Rev21: the scene carries no
 * lights and never builds an environment — it reuses the page's shared room-env
 * texture (src/env-room.js) via `options.room`, so the whole page is lit by the
 * same photo. The page applies that environment to its own scene.
 * @param {{ room?: object, castShadow?: boolean }} [options]
 * @returns {{
 *   group: THREE.Group,
 *   environment: THREE.Texture | null,
 *   lights: Record<string, never>,
 *   materials: Record<string, THREE.Material>,
 *   waves: Record<string, { mesh: THREE.Mesh, geometry: THREE.BufferGeometry }>,
 *   frame: () => object,
 *   debug: () => object,
 *   dispose: () => void
 * }}
 */
export function createWaveComposition(options = {}) {
  const room = options.room || null;
  const environment = room && room.texture ? room.texture : null;
  // Rev21: kept for API compatibility — there are never any lights.
  const lights = Object.freeze({});
  const group = new THREE.Group();
  group.name = 'coin-wave-composition';

  const contactTexture = new THREE.CanvasTexture(buildContactShadowTexture(256));
  contactTexture.encoding = THREE.LinearEncoding;
  contactTexture.needsUpdate = true;

  // Rev20: both ribbons are smooth polished metal (no pattern maps): the surface
  // is a clean mirror-like sheet that reflects the environment.
  // Rev21: the room photo is a dark interior whose ceiling/walls are much
  // brighter than the old panel studio for broad horizontal mirrors, so the
  // authored envMapIntensity is lowered to keep the steel/gold from clipping.
  const steelMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd8dde3,
    metalness: 1.0,
    roughness: 0.46, // s59: diffuse enough to show the line light as a soft glow
    clearcoat: 0.5,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.3,
    side: THREE.DoubleSide,
  });
  steelMaterial.name = 'wave-steel-polished';
  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdfe4ea,
    metalness: 1.0,
    roughness: 0.2,
    clearcoat: 0.28,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  });
  edgeMaterial.name = 'wave-polished-edge';
  // Rev21: the back ribbon is the slate blue-violet reference. Its albedo is a
  // procedural diagonal gradient + dot-grid map, but it stays metalness 1 /
  // low roughness, so it reads as a polished metal ribbon, not paint.
  const slateGradientTexture = buildSlateGradientTexture(1024, 256);
  const goldRibbonMaterial = new THREE.MeshPhysicalMaterial({
    // The albedo is the exact Rev21 ref gradient (+ dot-grid) via the map; the
    // material colour stays neutral so the rendered albedo is the ref slate.
    color: 0xffffff,
    map: slateGradientTexture,
    metalness: 1.0,
    roughness: 0.2,
    // The page-level env-room intensity (x11) multiplies every authored
    // envMapIntensity: a mirror-like gain would wash the dark slate albedo out
    // to silver, so the ribbon takes a moderate reflection gain.
    envMapIntensity: 0.35,
    // A faint own-tint emission keeps the ribbon unmistakably slate blue-violet
    // where the room photo's dim walls leave the metal nearly black (material
    // emission is allowed by the Rev21 lighting rules; no THREE light is added).
    emissive: new THREE.Color(0x4c5482),
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
  });
  goldRibbonMaterial.name = 'wave-slate-blue-violet-polished';
  const materials = { steel: steelMaterial, gold: goldRibbonMaterial, edge: edgeMaterial };
  const geometries = [];
  const waves = {};

  for (const kind of ['steel', 'gold']) {
    const spec = WAVE.waves[kind];
    const geometry = buildRibbonGeometry(spec);
    // s58: bank materials sample aoMap on the uv2 channel; the triplanar shader ignores the UVs
    // but the program still needs the attribute declared.
    if (!geometry.getAttribute('uv2') && geometry.getAttribute('uv')) geometry.setAttribute('uv2', geometry.getAttribute('uv').clone());
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

  // Rev21: no lights and no private studio environment. The shared room photo
  // (scene.environment, owned by the page via src/env-room.js) lights the
  // ribbons and the page-owned coins; the composition only exposes the handle.
  // s58: live material swap. Default materials are kept (and re-disposable);
  // bank materials come from a lazily loaded columns bank owned by this composition.
  const defaultMaterials = { steel: steelMaterial, gold: goldRibbonMaterial };
  const chosen = { steel: 'default', gold: 'default' };
  const swapToken = { steel: 0, gold: 0 };
  const columnAssetBase = options.columnAssetBase || './assets/textures/materials';
  let bankPromise = null;
  let bank = null;
  let bankCols = null;
  let swaps = 0;
  let disposedMaterials = 0;
  function ensureBank() {
    if (!bankPromise) {
      bankPromise = loadColumnBank({ assetBase: columnAssetBase }).then((b) => {
        bank = b;
        bankCols = createColumns(b, { quality: 'hero', patternDivisor: WAVE_PATTERN_DIVISOR });
        for (const id of Object.keys(WAVE_BANK_ENV)) {
          const m = b.materials[id];
          m.side = THREE.DoubleSide;
          m.envMapIntensity = WAVE_BANK_ENV[id];
          m.needsUpdate = true;
        }
        return b;
      });
    }
    return bankPromise;
  }
  /**
   * @param {'steel'|'gold'} kind
   * @param {string} id one of WAVE_MATERIAL_CHOICES
   * @returns {Promise<string>} the applied id (stale requests resolve to the current one)
   */
  async function setWaveMaterial(kind, id) {
    if (!WAVE_MATERIAL_KINDS.includes(kind)) throw new Error('setWaveMaterial: unknown kind ' + kind);
    if (!WAVE_MATERIAL_CHOICES.includes(id)) throw new Error('setWaveMaterial: unknown material ' + id);
    const token = ++swapToken[kind];
    if (id !== 'default') await ensureBank();
    if (disposed || token !== swapToken[kind]) return chosen[kind];
    const next = id === 'default' ? defaultMaterials[kind] : bank.materials[id];
    const prev = materials[kind];
    if (prev === next) { chosen[kind] = id; return id; }
    waves[kind].mesh.material = next;
    materials[kind] = next;
    chosen[kind] = id;
    swaps += 1;
    const other = kind === 'steel' ? 'gold' : 'steel';
    if (prev !== materials[other] && prev !== materials.edge) { prev.dispose(); disposedMaterials += 1; }
    return id;
  }

  let disposed = false;
  const composition = {
    setWaveMaterial,
    getWaveMaterials: () => ({ ...chosen }),
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
        lights: [],
        environment: ENV_ROOM_LABEL,
        environmentTexture: Boolean(environment),
        waveScale: WAVE.waveScale,
        palette: WAVE.palette,
        goldAlbedoMap: Boolean(goldRibbonMaterial.map),
        waveMaterials: { ...chosen, swaps, disposedMaterials, bankLoaded: Boolean(bank), patternDivisor: WAVE_PATTERN_DIVISOR, patternTileWorld: WAVE_PATTERN_TILE_WORLD },
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
      for (const e of Object.values(defaultMaterials)) e.dispose();
      if (bankCols) bankCols.dispose();
      if (bank) bank.dispose();
      swapToken.steel++; swapToken.gold++;
      contactTexture.dispose();
      slateGradientTexture.dispose();
      for (const decal of decals) {
        decal.geometry.dispose();
        decal.material.dispose();
      }
      decals.length = 0;
      // The room environment texture is shared and owned by the page — never
      // disposed here.
      group.removeFromParent();
      group.clear();
    },
  };
  return composition;
}
