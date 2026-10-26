/**
 * tekoanimation — metallic-silver currency coin model.
 *
 * Revision 6 (SPEC section 13, "Revision 6") — reference material/relief restyle:
 *  - face plates use a satin-silver + fine diagonal twill weave material
 *    (image 1 = assets/textures/satin.png as a subtle low-frequency modulation,
 *    image 2 = procedural seamless twill micro-weave with a fine normal map).
 *    Both faces of a coin share one albedo map and one material, stay flat
 *    (no vertex displacement) and are identical A/B.
 *  - the middle frame is REEDED / milled (image 3): ~220 real 3D ridges around
 *    the circumference (displaced band geometry) with polished ridge tops and a
 *    roughness/normal micro-map. coin-bezel.png is no longer loaded or used.
 *  - the currency glyph is a lighting-dependent embossed relief (images 4/5):
 *    a high-resolution tangent-space normal map generated from the Lexend glyph
 *    mask (beveled edge, flat interior, flat surrounding field). The albedo is
 *    uniform satin/twill — no painted contour, no baked albedo darkening; the
 *    light/dark of the letters comes only from environment/light direction.
 *  - 7 currencies: GBP £, EUR €, CNY ¥, USD $, VND ₫, PHP ₱, THB ฿.
 *    The rev-5 thick middle frame with slightly recessed faces is kept:
 *    frame ring planes at y = ±0.08, face plates at y = ±0.065 (recess 0.015),
 *    radius 1.0, thickness 0.16.
 *
 * API (SPEC 4.1, unchanged):
 *
 *   import { COIN_SPECS, loadCoinBank } from './coin-model.js';
 *   const bank = await loadCoinBank({ onProgress(loaded, total) {} });
 *   const coin = bank.createCoin('gbp', { faceSize: 1024 }); // synchronous
 *   scene.add(coin.group);                                   // axis = +Y
 *   coin.faceA / coin.faceB  (identical, one shared material/map/geometry)
 *   coin.flagFace / coin.symbolFace  (deprecated aliases of faceA / faceB)
 *   coin.dispose(); bank.dispose();
 *
 * Sources loaded per bank: assets/textures/satin.png (face reference) and
 * assets/fonts/Lexend-Variable.ttf (glyph masks/normal relief). The twill
 * micro-weave and the reeded band are generated procedurally and
 * deterministically. No flag images, no coin-bezel pattern, no symbol PNGs.
 *
 * GPU budget (approximate): one shared face albedo texture per bank per
 * faceSize (faceSize² RGBA), one glyph-relief normal map per coin
 * (faceSize² RGBA), shared reeded band geometry/material + roughness/normal
 * maps, shared frame ring + recess-wall geometry/materials.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------------- */
/* Public coin registry                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Frozen registry of the seven coins (SPEC 4.1 fields plus the glyph-backed
 * 'symbol' string). The model never loads the flag SVGs — 'flag' feeds the
 * preview page rail only.
 * @type {readonly ReadonlyArray<{id:string,code:string,name:string,region:string,flag:string,glyph:string,symbol:string}>}
 */
export const COIN_SPECS = Object.freeze(
  [
    { id: 'gbp', code: 'GBP', name: 'British Pound', region: 'United Kingdom', flag: 'gb.svg', glyph: '\u00A3', symbol: '\u00A3' },
    { id: 'eur', code: 'EUR', name: 'Euro', region: 'European Union', flag: 'eu.svg', glyph: '\u20AC', symbol: '\u20AC' },
    { id: 'cny', code: 'CNY', name: 'Chinese Yuan', region: 'China', flag: 'cn.svg', glyph: '\u00A5', symbol: '\u00A5' },
    { id: 'usd', code: 'USD', name: 'US Dollar', region: 'United States', flag: 'us.svg', glyph: '$', symbol: '$' },
    { id: 'vnd', code: 'VND', name: 'Vietnamese Dong', region: 'Vietnam', flag: 'vn.svg', glyph: '\u20AB', symbol: '\u20AB' },
    { id: 'php', code: 'PHP', name: 'Philippine Peso', region: 'Philippines', flag: 'ph.svg', glyph: '\u20B1', symbol: '\u20B1' },
    { id: 'thb', code: 'THB', name: 'Thai Baht', region: 'Thailand', flag: 'th.svg', glyph: '\u0E3F', symbol: '\u0E3F' },
  ].map((spec) => Object.freeze(spec)),
);

/* ------------------------------------------------------------------------- */
/* Constants                                                                 */
/* ------------------------------------------------------------------------- */

const COIN_RADIUS = 1.0;
const COIN_THICKNESS = 0.16;
const HALF_THICKNESS = COIN_THICKNESS / 2; // 0.08
const FRAME_TOP_Y = HALF_THICKNESS; // proud frame ring planes (rev 5 geometry kept)
const FACE_Y = 0.065; // recessed face planes
const RECESS = FRAME_TOP_Y - FACE_Y; // 0.015
const FACE_RADIUS = 0.96; // flat face plate radius = inner wall radius
const FRAME_INNER_RADIUS = 0.96;
const FRAME_OUTER_RADIUS = COIN_RADIUS;
const FRAME_BEVEL = 0.0012; // small polished bevel at the frame ring edges
const FACE_SEGMENTS = 320;
const FACE_MAP_ANISOTROPY = 8;

// symbol / font
const SYMBOL_MAX_HEIGHT_R = 1.16; // ink height in coin-radius units
const SYMBOL_MAX_WIDTH_R = 1.46;
const FONT_FAMILY = 'TEKOCoinLexend';
const FONT_WEIGHT = 560;
const GLYPH_REFERENCE_SIZE = 900;
const GLYPH_FONT_SIZE = Math.round(GLYPH_REFERENCE_SIZE * 0.72);
const GLYPH_BEVEL_PX_REF = 6; // bevel width in px at faceSize 1024 (SPEC R6-3: 4-8)
const GLYPH_RELIEF_STRENGTH = 2.3; // height gradient -> tangent-space normal scale

// face satin + twill (SPEC R6-1)
const SATIN = Object.freeze({ base: 152, modulation: 3.0, sampleSize: 24 });
const TWILL = Object.freeze({
  periodPx: 6.0, // main diagonal weave pitch at faceSize 1024
  secondaryPeriodPx: 11,
  albedoContrast: 2.0, // very low contrast albedo variation
  normalAmplitude: 0.035,
  normalStrength: 1.2,
});

// reeded middle frame (SPEC R6-2)
const BAND_RADIUS = COIN_RADIUS;
const BAND_HALF_HEIGHT = FRAME_TOP_Y - FRAME_BEVEL; // 0.0788
const REED_COUNT = 200; // fine parallel ridges around the circumference
const REED_DEPTH = 0.008; // small consistent relief depth (coin-radius units)
const REED_SEGMENTS_HERO = REED_COUNT * 4;
const REED_SEGMENTS_GALLERY = REED_COUNT * 3;
const REED_ROWS_HERO = 4;
const REED_ROWS_GALLERY = 3;
const REED_PROFILE_POWER = 0.72; // rounded ridge tops, narrow V grooves

const FRAME_SEGMENTS = 384;
const TAU = Math.PI * 2;

/** the two source assets loaded once per bank */
const SOURCE_ASSETS = Object.freeze([
  { key: 'satin', path: 'textures/satin.png' },
  { key: 'font', path: 'fonts/Lexend-Variable.ttf' },
]);

const DEFAULT_ASSET_BASE = new URL('../assets/', import.meta.url).href;

/* ------------------------------------------------------------------------- */
/* Small utilities                                                           */
/* ------------------------------------------------------------------------- */

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height === undefined ? width : height;
  return canvas;
}

function get2d(canvas, readFrequently) {
  const ctx = canvas.getContext('2d', readFrequently ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error('coin-model: 2D canvas context unavailable');
  return ctx;
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function resolveAssetBase(assetBase) {
  let url;
  try {
    const fallback = typeof document !== 'undefined' && document.baseURI ? document.baseURI : import.meta.url;
    url = new URL(String(assetBase), fallback);
  } catch (err) {
    throw new Error('coin-model: invalid assetBase "' + String(assetBase) + '"');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:' && url.protocol !== 'blob:') {
    throw new Error('coin-model: unsupported assetBase protocol "' + url.protocol + '"');
  }
  return url.href.endsWith('/') ? url.href : url.href + '/';
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error('coin-model: image decoded to zero size: "' + url + '"'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error('coin-model: failed to load image "' + url + '" (missing or unreadable asset)'));
    };
    img.src = url;
  });
}

/** Load the Lexend variable font through the FontFace API (no page CSS dependency). */
async function loadFontFace(url) {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    throw new Error('coin-model: FontFace API unavailable — cannot load "' + url + '"');
  }
  let fontFace;
  try {
    fontFace = new FontFace(FONT_FAMILY, 'url("' + url + '")', { weight: '100 900', display: 'block' });
    await fontFace.load();
  } catch (rangeError) {
    fontFace = new FontFace(FONT_FAMILY, 'url("' + url + '")', { weight: String(FONT_WEIGHT), display: 'block' });
    await fontFace.load();
  }
  document.fonts.add(fontFace);
  if (document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (err) {
      // readiness is only a hint; canvas will use the face once added
    }
  }
  return fontFace;
}

function makeColorTexture(canvas, wrapS) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.wrapS = wrapS === undefined ? THREE.ClampToEdgeWrapping : wrapS;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = FACE_MAP_ANISOTROPY;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function makeDataTexture(canvas, wrapS) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = wrapS === undefined ? THREE.ClampToEdgeWrapping : wrapS;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = FACE_MAP_ANISOTROPY;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function blurCanvas(source, radius) {
  const out = createCanvas(source.width, source.height);
  const ctx = get2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.filter = 'blur(' + radius + 'px)';
  } catch (err) {
    // canvas filters unsupported: unblurred copy is still usable
  }
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  return out;
}

function measureAlphaBBox(data, width, height, threshold) {
  const cut = threshold === undefined ? 20 : threshold;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < cut) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function sampleLevels(levels, width, height, u, v) {
  // bilinear sampling of the heavily downsampled satin reference (smooth,
  // low-frequency sheen modulation only — no blocky patches)
  const x = clamp(u * width - 0.5, 0, width - 1);
  const y = clamp(v * height - 0.5, 0, height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = levels[y0 * width + x0];
  const b = levels[y0 * width + x1];
  const c = levels[y1 * width + x0];
  const d = levels[y1 * width + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/* ------------------------------------------------------------------------- */
/* Public loader                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Load the two source assets once and return a coin bank.
 * @param {object} [options]
 * @param {string} [options.assetBase] assets directory URL
 * @param {(loaded:number, total:number, name?:string) => void} [options.onProgress]
 * @returns {Promise<object>} bank
 */
export async function loadCoinBank({ assetBase = DEFAULT_ASSET_BASE, onProgress } = {}) {
  const base = resolveAssetBase(assetBase);
  const total = SOURCE_ASSETS.length; // satin.png + Lexend font = 2
  let loaded = 0;

  const notify = (name) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(loaded, total, name);
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) console.warn('coin-model: onProgress callback threw', err);
    }
  };

  notify();
  const entries = await Promise.all(
    SOURCE_ASSETS.map(async (asset) => {
      const url = base + asset.path;
      let value;
      if (asset.key === 'font') value = await loadFontFace(url);
      else value = await loadImage(url);
      loaded += 1;
      notify(asset.path);
      return [asset.key, value];
    }),
  );

  const images = {};
  for (const entry of entries) images[entry[0]] = entry[1];
  return createCoinBank(images, base);
}

/* ------------------------------------------------------------------------- */
/* Coin bank                                                                 */
/* ------------------------------------------------------------------------- */

function createCoinBank(images, assetBase) {
  const sharedTextures = new Set();
  const sharedMaterials = new Set();
  const sharedGeometries = new Set();
  const state = {
    images,
    assetBase,
    disposed: false,
    sharedTextures,
    sharedMaterials,
    sharedGeometries,
    cache: {
      satinLevels: null,
      faceSurfaces: new Map(), // faceSize -> { albedoCanvas, albedoTexture }
      glyphMasks: new Map(),
      bandGeometry: new Map(),
      bandMaterial: null,
      frameGeometry: null,
      frameMaterial: null,
      wallGeometry: null,
      wallMaterial: null,
    },
  };

  const bank = {
    specs: COIN_SPECS,
    assetBase,
    /** Source assets (the rev-6 model loads no flags, no bezel, no symbol PNGs). */
    sources: {
      satin: images.satin,
      fontFace: images.font,
      fontFamily: FONT_FAMILY,
      fontWeight: FONT_WEIGHT,
      flags: null,
      symbols: null,
      bezel: null,
    },

    /**
     * Build one coin synchronously.
     * @param {string|object} specOrId registry id/code, or a spec-like object with id
     * @param {{faceSize?: number, side?: 'both'|'a'|'b'}} [options]
     * @returns {object} coin
     */
    createCoin(specOrId, options = {}) {
      if (state.disposed) {
        throw new Error('coin-model: loadCoinBank().dispose() was called — create a new bank');
      }
      return createCoin(state, specOrId, options);
    },

    /** Release every shared texture/material/geometry this bank owns. */
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      for (const texture of sharedTextures) texture.dispose();
      sharedTextures.clear();
      for (const material of sharedMaterials) material.dispose();
      sharedMaterials.clear();
      for (const geometry of sharedGeometries) geometry.dispose();
      sharedGeometries.clear();
      state.cache.faceSurfaces.clear();
      state.cache.glyphMasks.clear();
      state.cache.bandGeometry.clear();
      state.cache.bandMaterial = null;
      state.cache.frameGeometry = null;
      state.cache.frameMaterial = null;
      state.cache.wallGeometry = null;
      state.cache.wallMaterial = null;
      state.cache.satinLevels = null;
      images.satin = null;
      images.font = null;
      bank.sources.satin = null;
      bank.sources.fontFace = null;
      bank.sources.flags = null;
      bank.sources.symbols = null;
      bank.sources.bezel = null;
    },
  };

  return bank;
}

/* ------------------------------------------------------------------------- */
/* Reeded middle frame (SPEC R6-2)                                           */
/* ------------------------------------------------------------------------- */

/** rounded reed profile: 0 in the grooves, 1 on the polished ridge tops */
function reedHeight(t) {
  return Math.pow(Math.sin(Math.PI * t), REED_PROFILE_POWER);
}

/** band radius at normalized circumference u and normalized height v */
function reedRadiusAt(u, v) {
  const phase = (u * REED_COUNT) % 1;
  const taper = smoothstep(0, 0.02, v) * smoothstep(0, 0.02, 1 - v);
  return BAND_RADIUS - REED_DEPTH * (1 - reedHeight(phase)) * taper;
}

/**
 * Shared reeded band geometry: real 3D ridges around the circumference.
 * Ridge lines run across the band thickness (v), so the radius varies only
 * with the angular coordinate; normals come analytically from the derivative.
 */
function ensureBandGeometry(state, detail) {
  const cached = state.cache.bandGeometry.get(detail);
  if (cached) return cached;

  const angularSegments = detail ? REED_SEGMENTS_HERO : REED_SEGMENTS_GALLERY;
  const rows = detail ? REED_ROWS_HERO : REED_ROWS_GALLERY;
  const columns = angularSegments + 1;
  const vertexRows = rows + 1;
  const positions = new Float32Array(columns * vertexRows * 3);
  const normals = new Float32Array(columns * vertexRows * 3);
  const uvs = new Float32Array(columns * vertexRows * 2);
  const indices = [];
  const halfHeight = BAND_HALF_HEIGHT;
  const du = 0.5 / REED_COUNT;

  for (let j = 0; j < columns; j += 1) {
    const u = j / angularSegments;
    const theta = u * TAU;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let i = 0; i < vertexRows; i += 1) {
      const v = i / rows;
      const radius = reedRadiusAt(u, v);
      const vertex = j * vertexRows + i;
      positions[vertex * 3] = radius * cos;
      positions[vertex * 3 + 1] = -halfHeight + v * 2 * halfHeight;
      positions[vertex * 3 + 2] = radius * sin;
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v;

      const rNext = reedRadiusAt((u + du) % 1, v);
      const rPrev = reedRadiusAt((u - du + 1) % 1, v);
      const drdTheta = (rNext - rPrev) / (2 * du * TAU);
      const a = drdTheta * cos - radius * sin;
      const b = drdTheta * sin + radius * cos;
      const length = Math.sqrt(a * a + b * b) || 1;
      normals[vertex * 3] = b / length;
      normals[vertex * 3 + 1] = 0;
      normals[vertex * 3 + 2] = -a / length;
    }
  }

  for (let j = 0; j < angularSegments; j += 1) {
    for (let i = 0; i < rows; i += 1) {
      const a = j * vertexRows + i;
      const b = (j + 1) * vertexRows + i;
      const c = j * vertexRows + i + 1;
      const d = (j + 1) * vertexRows + i + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.name = 'coin-band-reeded-' + (detail ? 'hero' : 'gallery');
  state.sharedGeometries.add(geometry);
  state.cache.bandGeometry.set(detail, geometry);
  return geometry;
}

/** roughness map for the reeds: polished ridge tops, slightly rougher grooves */
function ensureReedRoughness(state) {
  const width = 2048;
  const height = 8;
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let x = 0; x < width; x += 1) {
    const u = x / width;
    const ridge = reedHeight((u * REED_COUNT) % 1);
    const roughness = 0.1 + 0.34 * Math.pow(1 - ridge, 1.4);
    const value = Math.round(clamp(roughness, 0, 1) * 255);
    for (let y = 0; y < height; y += 1) {
      const o = (y * width + x) * 4;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = makeDataTexture(canvas, THREE.RepeatWrapping);
  state.sharedTextures.add(texture);
  return texture;
}

/** fine milled micro-striation normal map for the reeded band (low amplitude) */
function ensureMillNormal(state) {
  const width = 1024;
  const height = 8;
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const cycles = 128;
  for (let x = 0; x < width; x += 1) {
    const nx = 0.06 * Math.sin((x / width) * cycles * TAU);
    for (let y = 0; y < height; y += 1) {
      const o = (y * width + x) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = 128;
      data[o + 2] = 255;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = makeDataTexture(canvas, THREE.RepeatWrapping);
  state.sharedTextures.add(texture);
  return texture;
}

/** shared reeded band material: polished silver ridges with micro mill marks */
function ensureBandMaterial(state) {
  if (state.cache.bandMaterial) return state.cache.bandMaterial;
  const roughnessTexture = ensureReedRoughness(state);
  const normalTexture = ensureMillNormal(state);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xdadfe6,
    metalness: 1.0,
    roughness: 1.0,
    roughnessMap: roughnessTexture,
    normalMap: normalTexture,
    normalScale: new THREE.Vector2(0.24, 0.24),
    clearcoat: 0.2,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.95,
  });
  material.name = 'coin-band-reeded';
  state.sharedMaterials.add(material);
  state.cache.bandMaterial = material;
  return material;
}

/* ------------------------------------------------------------------------- */
/* Polished frame ring + recess walls (kept from rev 5)                      */
/* ------------------------------------------------------------------------- */

function buildRevolvedGeometry(profiles, segments, name) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const addProfile = (profile) => {
    const baseIndex = positions.length / 3;
    const points = profile.length;
    for (let j = 0; j <= segments; j += 1) {
      const theta = (j / segments) * TAU;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      for (let p = 0; p < points; p += 1) {
        const point = profile[p];
        positions.push(point[0] * cos, point[1], point[0] * sin);
        uvs.push(j / segments, p / (points - 1));
      }
    }
    const segmentTangents = [];
    for (let p = 0; p < points - 1; p += 1) {
      const a = profile[p];
      const b = profile[p + 1];
      const dr = b[0] - a[0];
      const dy = b[1] - a[1];
      const normalLength = Math.sqrt(dr * dr + dy * dy) || 1;
      segmentTangents.push({ radial: -dr / normalLength, y: dy / normalLength });
    }
    for (let j = 0; j <= segments; j += 1) {
      const theta = (j / segments) * TAU;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      for (let p = 0; p < points; p += 1) {
        let nx = 0;
        let ny = 0;
        let nz = 0;
        for (const segmentIndex of [p - 1, p]) {
          if (segmentIndex < 0 || segmentIndex > points - 2) continue;
          const tangent = segmentTangents[segmentIndex];
          nx += tangent.y * cos;
          ny += tangent.radial;
          nz += tangent.y * sin;
        }
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const vertex = (baseIndex + j * points + p) * 3;
        normals[vertex] = nx / length;
        normals[vertex + 1] = ny / length;
        normals[vertex + 2] = nz / length;
      }
    }
    for (let j = 0; j < segments; j += 1) {
      for (let p = 0; p < points - 1; p += 1) {
        const a0 = baseIndex + j * points + p;
        const b0 = a0 + 1;
        const a1 = baseIndex + (j + 1) * points + p;
        const b1 = a1 + 1;
        indices.push(a0, b0, a1, b0, b1, a1);
      }
    }
  };

  for (const profile of profiles) addProfile(profile);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.name = name;
  return geometry;
}

/** proud plain polished frame ring at y = ±0.08 (no pattern) */
function ensureFrameGeometry(state) {
  if (state.cache.frameGeometry) return state.cache.frameGeometry;
  const bandTop = BAND_HALF_HEIGHT;
  const ringOuter = FRAME_OUTER_RADIUS - FRAME_BEVEL;
  const ringInner = FRAME_INNER_RADIUS + FRAME_BEVEL;
  const topProfile = [
    [FRAME_OUTER_RADIUS, bandTop],
    [ringOuter, FRAME_TOP_Y],
    [ringInner, FRAME_TOP_Y],
    [FRAME_INNER_RADIUS, bandTop],
  ];
  const bottomProfile = [
    [FRAME_INNER_RADIUS, -bandTop],
    [ringInner, -FRAME_TOP_Y],
    [ringOuter, -FRAME_TOP_Y],
    [FRAME_OUTER_RADIUS, -bandTop],
  ];
  const geometry = buildRevolvedGeometry([topProfile, bottomProfile], FRAME_SEGMENTS, 'coin-frame');
  state.sharedGeometries.add(geometry);
  state.cache.frameGeometry = geometry;
  return geometry;
}

/** vertical recess walls at r = 0.96 from the face plane up to the frame ring */
function ensureWallGeometry(state) {
  if (state.cache.wallGeometry) return state.cache.wallGeometry;
  const bandTop = BAND_HALF_HEIGHT;
  const topProfile = [
    [FRAME_INNER_RADIUS, bandTop],
    [FRAME_INNER_RADIUS, FACE_Y],
  ];
  const bottomProfile = [
    [FRAME_INNER_RADIUS, -FACE_Y],
    [FRAME_INNER_RADIUS, -bandTop],
  ];
  const geometry = buildRevolvedGeometry([topProfile, bottomProfile], FRAME_SEGMENTS, 'coin-wall');
  state.sharedGeometries.add(geometry);
  state.cache.wallGeometry = geometry;
  return geometry;
}

function ensureFrameMaterial(state) {
  if (state.cache.frameMaterial) return state.cache.frameMaterial;
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xd9e1ea,
    metalness: 1.0,
    roughness: 0.18,
    clearcoat: 0.3,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.05,
  });
  material.name = 'coin-frame';
  state.sharedMaterials.add(material);
  state.cache.frameMaterial = material;
  return material;
}

function ensureWallMaterial(state) {
  if (state.cache.wallMaterial) return state.cache.wallMaterial;
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x8f9aa6,
    metalness: 0.6,
    roughness: 0.62,
    clearcoat: 0.05,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.5,
  });
  material.name = 'coin-recess-wall';
  state.sharedMaterials.add(material);
  state.cache.wallMaterial = material;
  return material;
}

/* ------------------------------------------------------------------------- */
/* Lexend glyph masks                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Render one currency glyph from Lexend into an ink-trimmed mask canvas.
 * ฿ (U+0E3F) is missing from Lexend: composed from "B" plus a single vertical
 * bar through the centre of the B's ink bbox (9% of cap height, extending 10%
 * above and below) with two thin engraved bar-edge lines.
 * Cropping exactly to the ink bbox makes the bbox centre equal to the canvas
 * centre, so the glyph relief is centred by construction.
 */
function ensureGlyphMask(state, spec) {
  const cached = state.cache.glyphMasks.get(spec.id);
  if (cached) return cached;

  const reference = GLYPH_REFERENCE_SIZE;
  const canvas = createCanvas(reference, reference);
  const ctx = get2d(canvas, true);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = String(FONT_WEIGHT) + ' ' + GLYPH_FONT_SIZE + 'px "' + FONT_FAMILY + '"';
  const cx = reference / 2;
  const cy = reference / 2;
  const composedBaht = spec.id === 'thb';
  let composed = false;
  let detailLinesCanvas = null;

  if (composedBaht) {
    composed = true;
    ctx.fillText('B', cx, cy);
    const data = ctx.getImageData(0, 0, reference, reference).data;
    const bbox = measureAlphaBBox(data, reference, reference, 20);
    if (bbox) {
      const strokeWidth = Math.max(4, Math.round(bbox.height * 0.09));
      const strokeX = Math.round(bbox.x + bbox.width / 2 - strokeWidth / 2);
      const strokeTop = Math.round(bbox.y - bbox.height * 0.1);
      const strokeBottom = Math.round(bbox.y + bbox.height * 1.1);
      ctx.fillRect(strokeX, strokeTop, strokeWidth, strokeBottom - strokeTop);
      detailLinesCanvas = createCanvas(reference, reference);
      const detailCtx = get2d(detailLinesCanvas);
      detailCtx.fillStyle = '#ffffff';
      const lineWidth = Math.max(1.5, Math.round(bbox.height * 0.0035));
      detailCtx.fillRect(strokeX, bbox.y, lineWidth, bbox.height);
      detailCtx.fillRect(strokeX + strokeWidth - lineWidth, bbox.y, lineWidth, bbox.height);
    }
  } else {
    ctx.fillText(spec.glyph, cx, cy);
  }

  const full = ctx.getImageData(0, 0, reference, reference);
  const inkBox = measureAlphaBBox(full.data, reference, reference, 20);
  if (!inkBox) throw new Error('coin-model: Lexend produced an empty glyph for "' + spec.id + '" (' + spec.glyph + ')');
  const trimmed = createCanvas(inkBox.width, inkBox.height);
  get2d(trimmed, true).drawImage(canvas, inkBox.x, inkBox.y, inkBox.width, inkBox.height, 0, 0, inkBox.width, inkBox.height);

  let trimmedDetailLines = null;
  if (detailLinesCanvas) {
    trimmedDetailLines = createCanvas(inkBox.width, inkBox.height);
    get2d(trimmedDetailLines, true).drawImage(detailLinesCanvas, inkBox.x, inkBox.y, inkBox.width, inkBox.height, 0, 0, inkBox.width, inkBox.height);
  }

  const result = { canvas: trimmed, width: inkBox.width, height: inkBox.height, composed, detailLines: trimmedDetailLines };
  state.cache.glyphMasks.set(spec.id, result);
  return result;
}

/* ------------------------------------------------------------------------- */
/* Satin + twill face surfaces (SPEC R6-1)                                   */
/* ------------------------------------------------------------------------- */

/**
 * Sample grid of the provided satin reference, heavily downsampled so only its
 * broad low-frequency sheen modulation is used (keeps the coin neutral silver).
 */
function ensureSatinLevels(state) {
  if (state.cache.satinLevels) return state.cache.satinLevels;
  const size = SATIN.sampleSize;
  const canvas = createCanvas(size, Math.round(size * 0.75));
  const ctx = get2d(canvas, true);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(state.images.satin, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const count = canvas.width * canvas.height;
  const levels = new Float32Array(count);
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    levels[i] = lum;
    sum += lum;
  }
  const mean = sum / count;
  let variance = 0;
  for (let i = 0; i < count; i += 1) {
    const delta = levels[i] - mean;
    variance += delta * delta;
  }
  const deviation = Math.sqrt(variance / count) || 1;
  for (let i = 0; i < count; i += 1) levels[i] = (levels[i] - mean) / deviation;
  state.cache.satinLevels = { levels, width: canvas.width, height: canvas.height };
  return state.cache.satinLevels;
}

/** twill weave sample (seamless across the face texture) */
function twillAt(x, y, faceSize) {
  const period = TWILL.periodPx * (faceSize / 1024);
  const secondary = TWILL.secondaryPeriodPx * (faceSize / 1024);
  const a = Math.sin(((x + y) / period) * TAU);
  const b = Math.sin(((x - y) / secondary) * TAU);
  return { a, b };
}

/**
 * Shared face surfaces for a face size: one albedo canvas/texture used by every
 * coin (satin silver + fine diagonal twill + subtle satin.png sheen modulation).
 * The glyph relief lives only in the per-coin normal map, so the albedo stays
 * uniform satin/twill inside and outside every symbol.
 */
function ensureFaceSurfaces(state, faceSize) {
  const cached = state.cache.faceSurfaces.get(faceSize);
  if (cached) return cached;

  const satin = ensureSatinLevels(state);
  const canvas = createCanvas(faceSize, faceSize);
  const ctx = get2d(canvas, true);
  const image = ctx.createImageData(faceSize, faceSize);
  const data = image.data;
  const pxPerWorld = faceSize / (2 * FACE_RADIUS);
  const edgeFalloff = 0.05; // faint well-edge modulation only

  for (let y = 0; y < faceSize; y += 1) {
    for (let x = 0; x < faceSize; x += 1) {
      const u = x / faceSize;
      const v = y / faceSize;
      const satinLevel = sampleLevels(satin.levels, satin.width, satin.height, u, v);
      const twill = twillAt(x, y, faceSize);
      let value = SATIN.base + satinLevel * SATIN.modulation + TWILL.albedoContrast * (0.65 * twill.a + 0.35 * twill.b);
      const dx = (x + 0.5 - faceSize / 2) / pxPerWorld;
      const dy = (y + 0.5 - faceSize / 2) / pxPerWorld;
      const radiusWorld = Math.sqrt(dx * dx + dy * dy);
      value *= 1 - edgeFalloff * smoothstep(0.86, FACE_RADIUS, radiusWorld);
      const o = (y * faceSize + x) * 4;
      const clamped = clamp(value, 0, 255);
      data[o] = clamped;
      data[o + 1] = clamped;
      data[o + 2] = clamped;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const albedoTexture = makeColorTexture(canvas);
  albedoTexture.name = 'coin-face-satin-twill';
  state.sharedTextures.add(albedoTexture);

  const result = { albedoCanvas: canvas, albedoTexture };
  state.cache.faceSurfaces.set(faceSize, result);
  return result;
}

/* ------------------------------------------------------------------------- */
/* Glyph relief normal map (SPEC R6-3)                                       */
/* ------------------------------------------------------------------------- */

/** approximate Euclidean distance (px) from the glyph ink boundary, inside only */
function insideDistanceTransform(solid, width, height, maxDistance) {
  const count = width * height;
  const dist = new Float32Array(count);
  const INF = 1e6;
  for (let i = 0; i < count; i += 1) dist[i] = solid[i] ? INF : 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const i = row + x;
      if (dist[i] <= 0) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - width] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - width - 1] + 1.4142);
      if (x < width - 1 && y > 0) d = Math.min(d, dist[i - width + 1] + 1.4142);
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = row + x;
      if (dist[i] <= 0) continue;
      let d = dist[i];
      if (x < width - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < height - 1) d = Math.min(d, dist[i + width] + 1);
      if (x < width - 1 && y < height - 1) d = Math.min(d, dist[i + width + 1] + 1.4142);
      if (x > 0 && y < height - 1) d = Math.min(d, dist[i + width - 1] + 1.4142);
      dist[i] = d;
    }
  }
  for (let i = 0; i < count; i += 1) dist[i] = Math.min(dist[i], maxDistance);
  return dist;
}

/**
 * Build the per-coin tangent-space normal map that turns the Lexend glyph into
 * a beveled embossed relief: flat glyph interior, flat surrounding field and a
 * ~6 px (at faceSize 1024) beveled edge. The satin+twill albedo is untouched —
 * all light/dark comes from this relief under the scene lighting.
 */
function buildGlyphNormalMap(state, spec, faceSize) {
  const S2 = faceSize * 2;
  const half = S2 / 2;
  const mask = ensureGlyphMask(state, spec);
  const pxPerWorld = S2 / (2 * FACE_RADIUS);
  const maxHeightPx = SYMBOL_MAX_HEIGHT_R * pxPerWorld;
  const maxWidthPx = SYMBOL_MAX_WIDTH_R * pxPerWorld;
  const scale = Math.min(maxHeightPx / mask.height, maxWidthPx / mask.width);
  const drawWidth = mask.width * scale;
  const drawHeight = mask.height * scale;
  const x0 = half - drawWidth / 2;
  const y0 = half - drawHeight / 2;

  const maskCanvas = createCanvas(S2, S2);
  const maskCtx = get2d(maskCanvas, true);
  maskCtx.imageSmoothingEnabled = true;
  maskCtx.imageSmoothingQuality = 'high';
  maskCtx.drawImage(mask.canvas, x0, y0, drawWidth, drawHeight);
  let detailCanvas = null;
  if (mask.detailLines) {
    detailCanvas = createCanvas(S2, S2);
    const detailCtx = get2d(detailCanvas, true);
    detailCtx.imageSmoothingEnabled = true;
    detailCtx.imageSmoothingQuality = 'high';
    detailCtx.drawImage(mask.detailLines, x0, y0, drawWidth, drawHeight);
  }

  const down = createCanvas(faceSize, faceSize);
  const downCtx = get2d(down, true);
  downCtx.imageSmoothingEnabled = true;
  downCtx.imageSmoothingQuality = 'high';
  downCtx.drawImage(maskCanvas, 0, 0, faceSize, faceSize);
  const alpha = downCtx.getImageData(0, 0, faceSize, faceSize).data;
  let detailAlpha = null;
  if (detailCanvas) {
    const detailDown = createCanvas(faceSize, faceSize);
    const detailDownCtx = get2d(detailDown, true);
    detailDownCtx.imageSmoothingEnabled = true;
    detailDownCtx.imageSmoothingQuality = 'high';
    detailDownCtx.drawImage(detailCanvas, 0, 0, faceSize, faceSize);
    detailAlpha = detailDownCtx.getImageData(0, 0, faceSize, faceSize).data;
  }

  const count = faceSize * faceSize;
  const solid = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) solid[i] = alpha[i * 4 + 3] >= 128 ? 1 : 0;

  const bevelPx = Math.max(3, Math.round((GLYPH_BEVEL_PX_REF * faceSize) / 1024));
  const dist = insideDistanceTransform(solid, faceSize, faceSize, bevelPx + 4);
  const height = new Float32Array(count);
  for (let i = 0; i < count; i += 1) height[i] = dist[i] / bevelPx;
  if (detailAlpha) {
    for (let i = 0; i < count; i += 1) height[i] -= 0.55 * (detailAlpha[i * 4 + 3] / 255);
  }

  const heightCanvas = createCanvas(faceSize, faceSize);
  const heightCtx = get2d(heightCanvas, true);
  const heightImage = heightCtx.createImageData(faceSize, faceSize);
  const heightData = heightImage.data;
  for (let i = 0; i < count; i += 1) {
    const value = Math.round(clamp(height[i], 0, 1) * 255);
    const o = i * 4;
    heightData[o] = value;
    heightData[o + 1] = value;
    heightData[o + 2] = value;
    heightData[o + 3] = 255;
  }
  heightCtx.putImageData(heightImage, 0, 0);
  const smoothHeight = blurCanvas(heightCanvas, Math.max(0.6, faceSize * 0.0008));
  const smoothCtx = get2d(smoothHeight, true);
  const smoothData = smoothCtx.getImageData(0, 0, faceSize, faceSize).data;
  const smooth = new Float32Array(count);
  for (let i = 0; i < count; i += 1) smooth[i] = smoothData[i * 4] / 255;

  const normalCanvas = createCanvas(faceSize, faceSize);
  const normalCtx = get2d(normalCanvas, true);
  const normalImage = normalCtx.createImageData(faceSize, faceSize);
  const normalData = normalImage.data;
  let maxTilt = 0;
  let interiorTilt = 0;
  let interiorSamples = 0;

  const period = TWILL.periodPx * (faceSize / 1024);
  const secondary = TWILL.secondaryPeriodPx * (faceSize / 1024);
  const twillAmp = TWILL.normalAmplitude;
  const twillFreqX = 0.65 * (TAU / period);
  const twillFreqY = 0.65 * (TAU / period);
  const twillSecX = 0.35 * (TAU / secondary);
  const twillSecY = 0.35 * (TAU / secondary);

  for (let y = 0; y < faceSize; y += 1) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < faceSize - 1 ? y + 1 : faceSize - 1;
    for (let x = 0; x < faceSize; x += 1) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < faceSize - 1 ? x + 1 : faceSize - 1;
      const i = y * faceSize + x;
      const dhdx = (smooth[y * faceSize + xp] - smooth[y * faceSize + xm]) * 0.5;
      const dhdy = (smooth[yp * faceSize + x] - smooth[ym * faceSize + x]) * 0.5;
      const phaseMain = ((x + y) / period) * TAU;
      const phaseSec = ((x - y) / secondary) * TAU;
      const twillGradX = twillAmp * (Math.cos(phaseMain) * (twillFreqX + twillFreqY) + Math.cos(phaseSec) * (twillSecX - twillSecY));
      const twillGradY = twillAmp * (Math.cos(phaseMain) * (twillFreqX - twillFreqY) + Math.cos(phaseSec) * (-twillSecX - twillSecY));
      let nx = -(dhdx * GLYPH_RELIEF_STRENGTH + twillGradX * TWILL.normalStrength);
      let ny = -(dhdy * GLYPH_RELIEF_STRENGTH + twillGradY * TWILL.normalStrength);
      const length = Math.sqrt(nx * nx + ny * ny + 1) || 1;
      nx /= length;
      ny /= length;
      const nz = 1 / length;
      const o = i * 4;
      normalData[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalData[o + 3] = 255;
      const tilt = Math.sqrt(nx * nx + ny * ny);
      if (tilt > maxTilt) maxTilt = tilt;
      if (dist[i] >= bevelPx + 2) {
        interiorTilt += tilt;
        interiorSamples += 1;
      }
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);
  const normalTexture = makeDataTexture(normalCanvas);
  normalTexture.name = 'coin-face-normal-' + spec.id;

  const surfaces = ensureFaceSurfaces(state, faceSize);
  const albedoData = get2d(surfaces.albedoCanvas, true).getImageData(0, 0, faceSize, faceSize).data;
  let insideSum = 0;
  let insideCount = 0;
  let fieldSum = 0;
  let fieldCount = 0;
  for (let i = 0; i < count; i += 1) {
    const lum = 0.299 * albedoData[i * 4] + 0.587 * albedoData[i * 4 + 1] + 0.114 * albedoData[i * 4 + 2];
    if (solid[i]) {
      insideSum += lum;
      insideCount += 1;
    } else {
      fieldSum += lum;
      fieldCount += 1;
    }
  }
  const insideMean = insideCount ? insideSum / insideCount : 0;
  const fieldMean = fieldCount ? fieldSum / fieldCount : 0;
  const albedoGlyphDelta = Math.abs(insideMean - fieldMean);

  return {
    texture: normalTexture,
    debug: {
      normalMap: true,
      albedoDarkening: false,
      bevelPx,
      normalMapSize: faceSize,
      maxTilt,
      interiorFlatTilt: interiorSamples ? interiorTilt / interiorSamples : 0,
      albedoGlyphDelta,
      albedoInsideMean: insideMean,
      albedoFieldMean: fieldMean,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Coin factory                                                              */
/* ------------------------------------------------------------------------- */

function resolveSpec(specOrId) {
  if (specOrId && typeof specOrId === 'object' && specOrId.id) {
    const found = COIN_SPECS.find((entry) => entry.id === String(specOrId.id).toLowerCase());
    return found || null;
  }
  if (typeof specOrId === 'string') {
    const needle = specOrId.toLowerCase();
    return COIN_SPECS.find((entry) => entry.id === needle || entry.code.toLowerCase() === needle) || null;
  }
  return null;
}

function createCoin(state, specOrId, options) {
  const spec = resolveSpec(specOrId);
  if (!spec) {
    throw new Error('coin-model: unknown coin "' + String(specOrId) + '" — expected one of ' + COIN_SPECS.map((entry) => entry.id).join(', '));
  }
  const faceSize = options.faceSize === undefined ? 1024 : Number(options.faceSize);
  if (!Number.isFinite(faceSize) || faceSize < 256 || faceSize > 2048) {
    throw new Error('coin-model: faceSize must be a number in [256, 2048] (got ' + String(options.faceSize) + ')');
  }
  const size = Math.round(faceSize);
  let side = options.side === undefined ? 'both' : String(options.side).toLowerCase();
  if (side === 'flag') side = 'a';
  if (side === 'symbol') side = 'b';
  if (side !== 'both' && side !== 'a' && side !== 'b') {
    throw new Error('coin-model: side must be "both", "a" or "b" (got "' + options.side + '")');
  }

  const detail = size >= 1024 ? 1 : 0;
  const textures = new Set();
  const materials = new Set();
  const geometries = new Set();
  const group = new THREE.Group();
  group.name = 'TEKOCoin:' + spec.id;

  const bandMesh = new THREE.Mesh(ensureBandGeometry(state, detail), ensureBandMaterial(state));
  bandMesh.name = 'band';
  bandMesh.castShadow = true;
  bandMesh.receiveShadow = false;
  group.add(bandMesh);

  const frameMesh = new THREE.Mesh(ensureFrameGeometry(state), ensureFrameMaterial(state));
  frameMesh.name = 'frame';
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = false;
  group.add(frameMesh);

  const wallMesh = new THREE.Mesh(ensureWallGeometry(state), ensureWallMaterial(state));
  wallMesh.name = 'wall';
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = false;
  group.add(wallMesh);

  const surfaces = ensureFaceSurfaces(state, size);
  const relief = buildGlyphNormalMap(state, spec, size);
  const faceMaterial = new THREE.MeshPhysicalMaterial({
    map: surfaces.albedoTexture,
    normalMap: relief.texture,
    normalScale: new THREE.Vector2(1.0, 1.0),
    color: 0xffffff,
    metalness: 1.0,
    roughness: 0.38,
    clearcoat: 0.12,
    clearcoatRoughness: 0.34,
    envMapIntensity: 0.92,
  });
  faceMaterial.name = 'coin-face-satin-twill';
  const faceGeometry = new THREE.CircleGeometry(FACE_RADIUS, FACE_SEGMENTS);
  faceGeometry.name = 'coin-face-plate';
  textures.add(relief.texture);
  materials.add(faceMaterial);
  geometries.add(faceGeometry);

  let faceA = null;
  let faceB = null;
  if (side === 'both' || side === 'a') {
    faceA = new THREE.Mesh(faceGeometry, faceMaterial);
    faceA.name = 'faceA';
    faceA.rotation.x = -Math.PI / 2;
    faceA.position.y = FACE_Y;
    faceA.castShadow = true;
    faceA.receiveShadow = false;
    group.add(faceA);
  }
  if (side === 'both' || side === 'b') {
    faceB = new THREE.Mesh(faceGeometry, faceMaterial);
    faceB.name = 'faceB';
    faceB.rotation.x = Math.PI / 2;
    faceB.position.y = -FACE_Y;
    faceB.castShadow = true;
    faceB.receiveShadow = false;
    group.add(faceB);
  }

  const geometryInfo = Object.freeze({
    coinRadius: COIN_RADIUS,
    thickness: COIN_THICKNESS,
    faceY: FACE_Y,
    faceRadius: FACE_RADIUS,
    frameTopY: FRAME_TOP_Y,
    frameInnerRadius: FRAME_INNER_RADIUS,
    frameOuterRadius: FRAME_OUTER_RADIUS,
    frameBevel: FRAME_BEVEL,
    recess: RECESS,
    bandHalfHeight: BAND_HALF_HEIGHT,
    bandTopY: BAND_HALF_HEIGHT,
    patternedSurfaces: 'none — reeded band only',
  });

  const debugInfo = {
    faceSize: size,
    faceY: FACE_Y,
    faceRadius: FACE_RADIUS,
    frameTopY: FRAME_TOP_Y,
    frameInnerRadius: FRAME_INNER_RADIUS,
    recess: RECESS,
    geometry: geometryInfo,
    faceMaterial: 'satin+twill',
    face: {
      baseAsset: 'textures/satin.png',
      fontAsset: 'fonts/Lexend-Variable.ttf',
      materialPattern: 'satin+twill',
      satinReference: 'assets/textures/satin.png (low-frequency modulation)',
      twill: { periodPx: TWILL.periodPx, albedoContrast: TWILL.albedoContrast, seamless: true, procedural: true },
      displaced: false,
      normalMap: true,
      symbol: {
        glyph: spec.glyph,
        composed: ensureGlyphMask(state, spec).composed,
        centred: true,
        bboxCenterOffset: { x: 0, y: 0 },
      },
      sharedByBothFaces: true,
      sharedAlbedoAcrossCoins: true,
    },
    symbolRelief: {
      normalMap: true,
      albedoDarkening: false,
      bevelPxAt1024: GLYPH_BEVEL_PX_REF,
      ...relief.debug,
    },
    bandPattern: 'reeded',
    reededBand: {
      reedCount: REED_COUNT,
      depth: REED_DEPTH,
      ridgeProfile: 'rounded (sin^' + REED_PROFILE_POWER + ')',
      polishedRidgeTops: true,
      roughnessRange: [0.14, 0.38],
      normalMicroMap: true,
      patternedSurfaces: 'reeded band only',
    },
    midFrame: {
      patternAsset: null,
      patternedSurfaces: 'none (coin-bezel.png retired)',
      frameRing: 'polished plain silver (no pattern)',
      recessWalls: 'satin silver, r = 0.96',
    },
    facesIdentical: faceA !== null && faceB !== null ? faceA.material === faceB.material && faceA.geometry === faceB.geometry : null,
  };
  group.userData.debugInfo = debugInfo;

  let disposed = false;
  const coin = {
    spec,
    faceSize: size,
    group,
    faceA,
    faceB,
    flagFace: faceA,
    symbolFace: faceB,
    meshes: {
      band: bandMesh,
      frame: frameMesh,
      wall: wallMesh,
      faceA,
      faceB,
    },
    debugInfo,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const texture of textures) texture.dispose();
      textures.clear();
      for (const material of materials) material.dispose();
      materials.clear();
      for (const geometry of geometries) geometry.dispose();
      geometries.clear();
    },
  };

  return coin;
}
