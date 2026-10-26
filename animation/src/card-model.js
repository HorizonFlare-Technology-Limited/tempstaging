/**
 * tekoanimation - three.js metal payment-card model.  Revision 6.
 *
 * Build contract: docs/card-model-contract.md (API frozen; Revision 6 binding).
 * Derived assets are produced by tools/prepare-card-assets.py and documented in
 * docs/card-model.md; this module never loads anything outside the project and
 * never uses unseeded randomness (deterministic geometry and material setup).
 *
 *   import { CARD_SPECS, CARD_METRICS, loadCardBank } from './card-model.js';
 *
 *   const bank = await loadCardBank({
 *     assetBase: './assets/textures/card',
 *     onProgress(loaded, total) {},
 *   });
 *   const dark = bank.createCard('dark');        // synchronous
 *   scene.add(dark.group);                       // origin = card centre, +Z front
 *   dark.front / dark.back / dark.edge;          // THREE.Mesh
 *   dark.materials                               // { front, back, edge }
 *   dark.dispose();                              // this card's geometry + materials
 *   bank.dispose();                              // shared textures
 *
 * The card is a real 3-D object: a 3.36 x 2.3003 x 0.06 rounded-rectangle slab
 * whose front and back plates are inset by a wide 0.042 chamfer/bevel; an
 * elliptical round-over (vertical extent 0.021) connects the plate to a vertical
 * polished band at the full source silhouette (corner radius measured from the
 * source alpha: 34 px at 929 px width).  Both cards share the same geometry.
 *
 * Per-card materials:
 *  - DARK front (Revision 5, R5.1): smooth dark-gray metal.  The non-ink field
 *    uses a flat neutral dark-gray albedo (48 sRGB, luma 48 - lifted from 26 in
 *    the 2.4.1/2.4.2 capture tunes so it reads as dark metal, not matte black),
 *    a metalness map field of 1.0 (effective 0.92 with the scalar), a per-pixel
 *    roughness multiplier (field 0.56 -> 0.28 effective with scalar 0.5; matte
 *    ink 1.00 -> 0.50), a flat tangent normal (normalScale 0) so the metal is
 *    smooth with no grain/brushing, a clearcoat (0.42 / 0.15) and
 *    envMapIntensity 2.45 for a readable mirrored sheen.  All highlight/sheen
 *    comes from the real key light + environment - no baked stripes/highlights.
 *    The print (chip, Mastercard, Teko arrow, text) is untouched source artwork
 *    with dielectric-ink metalness (0.06), a low ink specular-intensity mask and
 *    the matte ink roughness, so it reads as print on the black metal.
 *  - LIGHT front: unchanged glossy sleek print (roughness 0.32, clearcoat 0.45,
 *    env 1.05, shared sleek normal/roughness maps, flattened residual overlay).
 *  - BACKS (Revision 6): per-card reconstructed back artwork.  Each card owns
 *    a 2048x1402 sRGB albedo (dark design on the dark card, light design on the
 *    light card), one linear RGBA ORM map (G = absolute roughness, B = absolute
 *    metalness) sampled by both roughnessMap and metalnessMap, and one linear
 *    OpenGL (+Y = +V) tangent normal.  The material keeps the accepted
 *    clearcoat family (0.20 / 0.40) and the shared sleek clearcoat normal; the
 *    ORM channels are absolute so roughness/metalness scalars stay 1.0.
 *    envMapIntensity / normalScale are per card (dark/light).  Highlights still
 *    come only from the real key light + PMREM environment - the albedo carries
 *    no baked highlight.
 *  - Bezels are per card (round 4): the light card keeps the polished silver
 *    frame (four-corner rim arcs); the dark card uses its dark satin frame
 *    (#303137, metalness 0.72) so no silver/white line appears on the dark
 *    silhouette.
 * All maps are local PNGs; no network.
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------------- */
/* Public registry + frozen metrics (source of truth for the page and QA)    */
/* ------------------------------------------------------------------------- */

/**
 * The two frozen card variants (contract 禮3).
 * @type {ReadonlyArray<Readonly<{id:string,label:string,source:string,face:string,background:string}>>}
 */
export const CARD_SPECS = Object.freeze(
  [
    {
      id: 'dark',
      label: 'Dark',
      source: 'novocard-default-dark.png',
      face: 'face-dark.png',
      background: '#303137',
    },
    {
      id: 'light',
      label: 'Light',
      source: 'novocard-default-light.png',
      face: 'face-light.png',
      background: '#e6e7e8',
    },
  ].map((spec) => Object.freeze(spec)),
);

/** Source content measured from the alpha bbox (both variants agree). */
const SOURCE_CONTENT = Object.freeze({ width: 929, height: 636, cornerRadiusPx: 34 });

/**
 * Frozen card metrics in world units (contract 禮3): overall width 3.36, height
 * derived from the source content bbox aspect (929x636), real thickness 0.06,
 * corner radius measured from the source silhouette, and the chamfer that
 * insets the printed plates.
 * @type {Readonly<{width:number,height:number,thickness:number,cornerRadius:number,bevel:number}>}
 */
export const CARD_METRICS = Object.freeze({
  width: 3.36,
  height: 3.36 * (SOURCE_CONTENT.height / SOURCE_CONTENT.width),
  thickness: 0.06,
  cornerRadius: 3.36 * (SOURCE_CONTENT.cornerRadiusPx / SOURCE_CONTENT.width),
  bevel: 0.042,
});

const DEFAULT_ASSET_BASE = new URL('../assets/textures/card/', import.meta.url).href;
const MODEL_VERSION = '2.5.0';

/** Geometry detail per quality level; hero is the page default (R2.3). */
const DETAIL_LEVELS = Object.freeze({
  hero: Object.freeze({ cornerSegments: 40, filletSegments: 22, bandSegments: 3 }),
  gallery: Object.freeze({ cornerSegments: 20, filletSegments: 12, bandSegments: 2 }),
});

/**
 * Vertical extent of the plate-to-band round-over.  `CARD_METRICS.bevel` (0.032)
 * is the in-plane chamfer; the vertical extent must stay below half the card
 * thickness (0.06), so the round-over uses 0.021 and leaves a 0.018-high
 * polished band at the full silhouette.
 */
const FILLET_DEPTH = 0.021;

/**
 * Round 4 (contract R4.2): the dark card's bezel uses the same dark tone as the
 * dark face.  The value is the novocard dark background (`#303137`, luma ~49),
 * converted from sRGB to linear because r151's ColorManagement legacy mode
 * treats material colors as linear - this makes the edge's metal F0 match the
 * sRGB-decoded face albedo instead of rendering ~6x brighter.
 */
const DARK_FRAME_COLOR_SRGB = 0x303137;
/** The intended sRGB hex of the dark frame color (for debug/documentation). */
const DARK_FRAME_COLOR_HEX = '#303137';

/**
 * Revision 6 frozen per-card back-artwork contract (docs/card-model-contract.md
 * R6.1/R6.2).  `card-assets.json` schemaVersion 2 declares the exact map files
 * under `back.cards.<id>`; this block only pins what the MODEL needs and owns:
 *
 *  - `size` / `mode`: the back maps are one 2048x1402 canvas; the ORM channels
 *    are ABSOLUTE values, so the material scalars stay 1.0 and the map alone
 *    decides the finish.  A metadata file generated with different conventions
 *    is rejected instead of silently mis-shading the back.
 *  - `channels`: three.js r151 samples roughness from the GREEN channel and
 *    metalness from the BLUE channel of the bound map, so the pipeline writes
 *    G = roughness, B = metalness (R = AO/unused, A = 255).
 *  - `material`: final model-owned tuning per card.  The asset tool also emits a
 *    recommendation in `back.cards.<id>.material`; it is recorded in
 *    `back.userData.artwork.recommendedMaterial` for provenance, while these
 *    numbers are what the delivered build renders (tuned against captures).
 */
const BACK_ART = Object.freeze({
  size: Object.freeze([2048, 1402]),
  mode: Object.freeze({ roughness: 'absolute', metalness: 'absolute' }),
  channels: Object.freeze({ roughness: 'g', metalness: 'b' }),
  normalConvention: 'OpenGL +Y=+V',
  material: Object.freeze({
    dark: Object.freeze({ envMapIntensity: 0.7, normalScale: 0.9 }),
    light: Object.freeze({ envMapIntensity: 2.4, normalScale: 0.9 }),
    clearcoat: 0.2,
    clearcoatRoughness: 0.4,
    clearcoatNormalScale: 0.12,
  }),
});


/* ------------------------------------------------------------------------- */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------- */

function fail(message) {
  throw new Error('card-model: ' + message);
}

function resolveBase(assetBase) {
  const raw = typeof assetBase === 'string' && assetBase.length ? assetBase : DEFAULT_ASSET_BASE;
  let url;
  try {
    url = new URL(raw, typeof document !== 'undefined' ? document.baseURI : undefined);
  } catch (error) {
    fail('invalid assetBase "' + raw + '"');
  }
  return url.href.endsWith('/') ? url.href : url.href + '/';
}

function reverseWinding(geometry) {
  const index = geometry.getIndex();
  if (!index) {
    fail('reverseWinding expects an indexed geometry');
  }
  const array = index.array;
  for (let i = 0; i < array.length; i += 3) {
    const tmp = array[i + 1];
    array[i + 1] = array[i + 2];
    array[i + 2] = tmp;
  }
  index.needsUpdate = true;
}

/* ------------------------------------------------------------------------- */
/* Geometry                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Rounded-rectangle outline, counter-clockwise, starting at the bottom-right
 * corner tangent point.  Each point carries its 2-D outward normal and the
 * cumulative arc length, which the edge mesh needs for its tiling UVs.
 */
function roundedRectOutline(width, height, radius, segmentsPerCorner) {
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.max(Math.min(radius, halfW, halfH), 1e-5);
  const cx = halfW - r;
  const cy = halfH - r;
  const corners = [
    [cx, -cy, -Math.PI / 2, 0], // bottom-right
    [cx, cy, 0, Math.PI / 2], // top-right
    [-cx, cy, Math.PI / 2, Math.PI], // top-left
    [-cx, -cy, Math.PI, Math.PI * 1.5], // bottom-left
  ];
  const points = [];
  for (const corner of corners) {
    const [ox, oy, a0, a1] = corner;
    for (let i = 0; i <= segmentsPerCorner; i += 1) {
      const angle = a0 + ((a1 - a0) * i) / segmentsPerCorner;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      points.push({ x: ox + r * nx, y: oy + r * ny, nx, ny });
    }
  }
  let s = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) {
      s += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    points[i].s = s;
  }
  return { points, perimeter: s };
}

/** Front or back plate: flat rounded-rect face inset by `inset` from silhouette. */
function buildPlateGeometry(metrics, detail, side) {
  const inset = metrics.bevel;
  const width = metrics.width - 2 * inset;
  const height = metrics.height - 2 * inset;
  const radius = metrics.cornerRadius - inset;
  const { points } = roundedRectOutline(width, height, radius, detail.cornerSegments);
  const shape = new THREE.Shape(points.map((point) => new THREE.Vector2(point.x, point.y)));
  const geometry = new THREE.ShapeGeometry(shape);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const z = side === 'front' ? metrics.thickness / 2 : -metrics.thickness / 2;
  const normals = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    position.setZ(i, z);
    if (side === 'front') {
      uv.setXY(i, x / width + 0.5, y / height + 0.5);
    } else {
      // viewed from the back (-Z) the viewer's right is world -X, so mirror U
      uv.setXY(i, 0.5 - x / width, y / height + 0.5);
    }
    normals[i * 3 + 2] = side === 'front' ? 1 : -1;
  }
  position.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (side === 'back') {
    reverseWinding(geometry);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Edge profile in (inset, z, normal) space: a wide elliptical round-over from
 * the plate boundary down to a vertical polished band at the full silhouette,
 * then mirror to the back plate.  In-plane chamfer = CARD_METRICS.bevel (0.032),
 * vertical extent = FILLET_DEPTH (0.021); the analytic ellipse normals are
 * continuous across the round-over so the glossy rim shades as one smooth arc
 * (no faceting/banding, R2.3).
 */
function buildEdgeProfile(metrics, detail) {
  const { thickness, bevel } = metrics;
  const half = thickness / 2;
  const zBand = half - FILLET_DEPTH;
  const ring = [];
  const pushFillet = (phi, sign) => {
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    // exact ellipse normal: gradient of inset^2/bevel^2 + z^2/filletDepth^2
    const nOut = sin / bevel;
    const nZ = (cos / FILLET_DEPTH) * sign;
    const length = Math.hypot(nOut, nZ) || 1;
    ring.push({
      inset: bevel - bevel * sin,
      z: sign * (zBand + FILLET_DEPTH * cos),
      normalOut: nOut / length,
      normalZ: nZ / length,
    });
  };
  for (let i = 0; i <= detail.filletSegments; i += 1) {
    pushFillet((i / detail.filletSegments) * (Math.PI / 2), 1);
  }
  for (let i = 1; i <= detail.bandSegments; i += 1) {
    ring.push({
      inset: 0,
      z: zBand - (2 * zBand * i) / detail.bandSegments,
      normalOut: 1,
      normalZ: 0,
    });
  }
  for (let i = 1; i <= detail.filletSegments; i += 1) {
    pushFillet((1 - i / detail.filletSegments) * (Math.PI / 2), -1);
  }
  return ring;
}

/**
 * Edge mesh: sweeps the profile around the outline.  UVs are authored so the
 * shared sleek maps tile an integer number of times around the perimeter
 * (no seam) and sample one band of the tile across the 0.06 thickness.
 */
function buildEdgeGeometry(metrics, detail, sampling) {
  const outline = roundedRectOutline(metrics.width, metrics.height, metrics.cornerRadius,
    detail.cornerSegments);
  const points = outline.points;
  const ring = buildEdgeProfile(metrics, detail);
  const pointCount = points.length;
  const ringCount = ring.length;

  const repeat = sampling && sampling.front ? sampling.front.sharedRepeat : [1, 1];
  const offset = sampling && sampling.front ? sampling.front.sharedOffset : [0, 0];
  const repsU = Math.max(2.4, Number(repeat[0]) || 1);
  const repsV = Math.max(1.7, Number(repeat[1]) || 1);
  const offU = Number(offset[0]) || 0;
  const offV = Number(offset[1]) || 0;

  // integer number of tiles around the rim => periodic tile joins itself
  const targetTile = sampling && sampling.edge ? Number(sampling.edge.tileWorldAlongRim) || 0.42 : 0.42;
  const tileCount = Math.max(6, Math.round(outline.perimeter / targetTile));
  const tileWorld = outline.perimeter / tileCount;
  const profileRange = sampling && sampling.edge && Array.isArray(sampling.edge.profileRange)
    ? sampling.edge.profileRange
    : [0.30, 0.70];
  const v0 = Number(profileRange[0]);
  const v1 = Number(profileRange[1]);

  const positions = new Float32Array(pointCount * ringCount * 3);
  const normals = new Float32Array(pointCount * ringCount * 3);
  const uvs = new Float32Array(pointCount * ringCount * 2);
  let p = 0;
  let n = 0;
  let t = 0;
  for (let k = 0; k < ringCount; k += 1) {
    const r = ring[k];
    const desiredV = v0 + (v1 - v0) * (k / (ringCount - 1));
    const uvV = (desiredV - offV) / repsV;
    for (let i = 0; i < pointCount; i += 1) {
      const point = points[i];
      const desiredU = point.s / tileWorld;
      const uvU = (desiredU - offU) / repsU;
      positions[p++] = point.x - point.nx * r.inset;
      positions[p++] = point.y - point.ny * r.inset;
      positions[p++] = r.z;
      normals[n++] = point.nx * r.normalOut;
      normals[n++] = point.ny * r.normalOut;
      normals[n++] = r.normalZ;
      uvs[t++] = uvU;
      uvs[t++] = uvV;
    }
  }

  const indices = [];
  for (let k = 0; k < ringCount - 1; k += 1) {
    for (let i = 0; i < pointCount; i += 1) {
      const iNext = (i + 1) % pointCount;
      const a = k * pointCount + i;
      const b = k * pointCount + iNext;
      const c = (k + 1) * pointCount + i;
      const d = (k + 1) * pointCount + iNext;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  orientOutward(geometry);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Flip triangle winding when the analytic normals disagree with the faces. */
function orientOutward(geometry) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const indices = index.array;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const face = new THREE.Vector3();
  const reference = new THREE.Vector3();
  let score = 0;
  const step = Math.max(3, Math.floor(indices.length / 3 / 64) * 3);
  for (let i = 0; i < indices.length; i += step) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    face.crossVectors(ab, ac);
    reference.set(0, 0, 0);
    reference.add(new THREE.Vector3().fromBufferAttribute(normal, ia));
    reference.add(new THREE.Vector3().fromBufferAttribute(normal, ib));
    reference.add(new THREE.Vector3().fromBufferAttribute(normal, ic));
    score += Math.sign(face.dot(reference));
  }
  if (score < 0) {
    reverseWinding(geometry);
  }
}

/* ------------------------------------------------------------------------- */
/* Textures                                                                  */
/* ------------------------------------------------------------------------- */

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => resolve(texture),
      undefined,
      () => reject(new Error('failed to load "' + url + '"')),
    );
  });
}

function configureTexture(texture, entry, isShared, sampling) {
  texture.name = entry.file;
  texture.encoding = entry.encoding === 'sRGB' ? THREE.sRGBEncoding : THREE.LinearEncoding;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (isShared) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    const repeat = (sampling && sampling.front && sampling.front.sharedRepeat) || [1, 1];
    const offset = (sampling && sampling.front && sampling.front.sharedOffset) || [0, 0];
    texture.repeat.set(Number(repeat[0]) || 1, Number(repeat[1]) || 1);
    texture.offset.set(Number(offset[0]) || 0, Number(offset[1]) || 0);
  } else {
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
  }
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------------- */
/* Bank                                                                      */
/* ------------------------------------------------------------------------- */

function normalizeMetadata(raw, base, jsonUrl) {
  const invalid = (why) => fail('invalid card asset metadata "' + jsonUrl + '": ' + why
    + '  - rerun tools/prepare-card-assets.py');
  if (!raw || typeof raw !== 'object') invalid('not a JSON object');
  if (raw.schemaVersion !== 2) {
    invalid('expected schemaVersion 2 (Revision 6 per-card backs), got '
      + JSON.stringify(raw.schemaVersion));
  }
  const content = raw.content;
  if (!content || !content.world) invalid('missing content.world metrics');
  const world = content.world;
  if (Math.abs(Number(world.width) - CARD_METRICS.width) > 1e-4
    || Math.abs(Number(world.height) - CARD_METRICS.height) > 1e-4
    || Math.abs(Number(world.cornerRadius) - CARD_METRICS.cornerRadius) > 1e-4) {
    invalid('world metrics (' + JSON.stringify(world) + ') disagree with CARD_METRICS ('
      + JSON.stringify(CARD_METRICS) + ')');
  }
  if (!Array.isArray(raw.textures) || !raw.textures.length) invalid('missing textures[]');
  if (!Array.isArray(raw.cards) || raw.cards.length !== CARD_SPECS.length) {
    invalid('cards[] must describe the ' + CARD_SPECS.length + ' variants');
  }
  for (const spec of CARD_SPECS) {
    const entry = raw.cards.find((card) => card && card.id === spec.id);
    if (!entry) invalid('missing card entry "' + spec.id + '"');
    if (entry.face !== spec.face || entry.source !== spec.source || entry.background !== spec.background) {
      invalid('card entry "' + spec.id + '" does not match CARD_SPECS');
    }
  }
  if (!raw.sleekMaps || !raw.sleekMaps.metal || !raw.sleekMaps.rough || !raw.sleekMaps.normal) {
    invalid('missing sleekMaps {metal, rough, normal}');
  }
  if (!raw.sampling || !raw.sampling.front) invalid('missing sampling.front');

  // Revision 6: the shared sleek-steel back is gone.  Every card owns a
  // reconstructed back artwork trio (albedo + ORM + normal) declared under
  // back.cards.<id>; the maps are absolute-channel ORM and an OpenGL normal.
  const back = raw.back;
  if (!back || typeof back !== 'object') invalid('missing back artwork block');
  if (!Array.isArray(back.size)
    || Number(back.size[0]) !== BACK_ART.size[0] || Number(back.size[1]) !== BACK_ART.size[1]) {
    invalid('back.size must be [' + BACK_ART.size.join(',') + '], got '
      + JSON.stringify(back.size));
  }
  if (!back.mode || typeof back.mode !== 'object'
    || back.mode.roughness !== BACK_ART.mode.roughness
    || back.mode.metalness !== BACK_ART.mode.metalness) {
    invalid('back.mode must be ' + JSON.stringify(BACK_ART.mode) + ', got '
      + JSON.stringify(back.mode));
  }
  if (!back.cards || typeof back.cards !== 'object') {
    invalid('missing back.cards {dark, light}');
  }
  const backCards = {};
  for (const spec of CARD_SPECS) {
    const entry = back.cards[spec.id];
    if (!entry || typeof entry !== 'object') invalid('missing back.cards.' + spec.id);
    for (const key of ['albedo', 'orm', 'normal']) {
      if (typeof entry[key] !== 'string' || !entry[key]) {
        invalid('back.cards.' + spec.id + '.' + key + ' must be a texture file name');
      }
    }
    const maps = entry.maps;
    if (!maps || typeof maps !== 'object'
      || maps.roughnessChannel !== BACK_ART.channels.roughness
      || maps.metalnessChannel !== BACK_ART.channels.metalness) {
      invalid('back.cards.' + spec.id + '.maps must be '
        + JSON.stringify(BACK_ART.channels) + ' (three r151 samples .g / .b), got '
        + JSON.stringify(maps));
    }
    backCards[spec.id] = entry;
  }
  const byFile = raw.textures.reduce((map, texture) => {
    if (texture && typeof texture.file === 'string') map.set(texture.file, texture);
    return map;
  }, new Map());
  const backFiles = [];
  for (const spec of CARD_SPECS) {
    const entry = backCards[spec.id];
    backFiles.push(entry.albedo, entry.orm, entry.normal);
  }
  const required = [
    ...CARD_SPECS.map((spec) => spec.face),
    ...raw.cards.map((entry) => entry.faceMetalness),
    // Revision 5: the dark card has dark-specific front roughness/normal maps;
    // cards that do not define them use the shared sleek maps.
    ...raw.cards.map((entry) => entry.faceRoughness).filter(Boolean),
    ...raw.cards.map((entry) => entry.faceNormal).filter(Boolean),
    raw.sleekMaps.metal.file,
    raw.sleekMaps.rough.file,
    raw.sleekMaps.normal.file,
    ...backFiles,
  ];
  for (const file of required) {
    if (!byFile.has(file)) invalid('texture "' + file + '" is not listed in textures[]');
  }
  // Encoding + dimension checks for the new back maps: a wrong encoding would
  // silently gamma-shift the albedo / normal, a wrong size means a stale or
  // mis-generated export.
  const backEncoding = { albedo: 'sRGB', orm: 'linear', normal: 'linear' };
  for (const spec of CARD_SPECS) {
    const entry = backCards[spec.id];
    for (const key of ['albedo', 'orm', 'normal']) {
      const texture = byFile.get(entry[key]);
      const encoding = String(texture.encoding || '').toLowerCase();
      if (encoding !== backEncoding[key].toLowerCase()) {
        invalid('texture "' + entry[key] + '" must declare encoding "'
          + backEncoding[key] + '" (got ' + JSON.stringify(texture.encoding) + ')');
      }
      if (Number(texture.width) && Number(texture.height)
        && (Number(texture.width) !== BACK_ART.size[0] || Number(texture.height) !== BACK_ART.size[1])) {
        invalid('texture "' + entry[key] + '" must be ' + BACK_ART.size.join('x')
          + ', got ' + texture.width + 'x' + texture.height);
      }
    }
  }
  return { raw, byFile, required, content, sampling: raw.sampling, backCards };
}

function loadTextureBank(entries, base, sampling, onProgress, total) {
  const sharedFiles = new Set([
    entries.raw.sleekMaps.metal.file,
    entries.raw.sleekMaps.rough.file,
    entries.raw.sleekMaps.normal.file,
  ]);
  const entriesByFile = new Map();
  let loaded = 1; // metadata counts as one progress unit
  if (typeof onProgress === 'function') onProgress(0, total);
  const textures = {};
  const jobs = entries.required.map((file) => {
    const entry = entries.byFile.get(file);
    entriesByFile.set(file, entry);
    const url = base + file;
    return loadTexture(url).then((texture) => {
      textures[file] = configureTexture(texture, entry, sharedFiles.has(file), sampling);
      loaded += 1;
      if (typeof onProgress === 'function') onProgress(loaded, total);
    }).catch((error) => {
      throw new Error('card-model: ' + (error && error.message ? error.message : error)
        + ' (assetBase="' + base + '"; check assets/textures/card/ exists and card-assets.json lists it)');
    });
  });
  return Promise.all(jobs).then(() => textures).catch((error) => {
    disposeTextures(textures);
    throw error;
  });
}

function disposeTextures(textures) {
  for (const key of Object.keys(textures)) {
    const texture = textures[key];
    if (texture && typeof texture.dispose === 'function') texture.dispose();
    delete textures[key];
  }
}

function buildMaterials(spec, textures, meta) {
  const frontMap = textures[spec.face];
  const sharedMetal = textures[meta.sleekMaps.metal.file];
  const sharedRough = textures[meta.sleekMaps.rough.file];
  const sharedNormal = textures[meta.sleekMaps.normal.file];
  const cardMeta = meta.cards.find((entry) => entry.id === spec.id);
  const faceMetalness = textures[cardMeta.faceMetalness];
  const faceRough = cardMeta.faceRoughness ? textures[cardMeta.faceRoughness] : null;
  const faceNormal = cardMeta.faceNormal ? textures[cardMeta.faceNormal] : null;
  // Revision 6: per-card reconstructed backs.  The file names come from
  // card-assets.json (`back.cards.<id>`) and are validated by normalizeMetadata;
  // the metadata tuning recommendation is recorded in userData for provenance,
  // while BACK_ART.material holds the model-owned final numbers.
  const backMeta = meta.back.cards[spec.id];
  const backAlbedo = textures[backMeta.albedo];
  const backOrm = textures[backMeta.orm];
  const backNormal = textures[backMeta.normal];
  const backTuning = BACK_ART.material[spec.id];
  const backRecommended = (backMeta && backMeta.material) || {};

  // Revision 5: the dark card's front is smooth black metal (flat near-black
  // field, smooth flat normal, per-pixel roughness: field 0.15 / ink 0.50
  // effective); the print keeps the untouched source artwork + dielectric ink.
  // The light card keeps the round-2 glossy sleek print exactly.
  const smoothBlack = spec.id === 'dark';
  const front = new THREE.MeshPhysicalMaterial({
    name: 'card-' + spec.id + '-front',
    map: frontMap,
    metalnessMap: faceMetalness,
    // the same RGBA map carries the dielectric-print specular intensity in its
    // alpha channel (RGB = metalness, three samples .b / .a respectively)
    specularIntensity: 1.0,
    specularIntensityMap: faceMetalness,
    normalMap: faceNormal || sharedNormal,
    normalScale: smoothBlack ? new THREE.Vector2(0, 0) : new THREE.Vector2(0.22, 0.22),
    roughnessMap: faceRough || sharedRough,
    roughness: smoothBlack ? 0.5 : 0.32,
    metalness: 0.92,
    clearcoat: smoothBlack ? 0.42 : 0.45,
    clearcoatRoughness: smoothBlack ? 0.15 : 0.15,
    clearcoatNormalMap: smoothBlack ? (faceNormal || sharedNormal) : sharedNormal,
    clearcoatNormalScale: smoothBlack ? new THREE.Vector2(0, 0) : new THREE.Vector2(0.1, 0.1),
    envMapIntensity: smoothBlack ? 2.45 : 1.05,
  });
  front.userData = {
    role: 'front',
    cardId: spec.id,
    finish: smoothBlack ? 'smooth-black-metal' : 'gloss-print-sleek',
    effectiveMetalnessField: smoothBlack ? 0.92 : 0.506,
    effectiveMetalnessInk: 0.0552,
    effectiveRoughnessField: smoothBlack ? 0.28 : 0.2944,
    effectiveRoughnessInk: smoothBlack ? 0.5 : 0.2944,
    normalScale: smoothBlack ? 0 : 0.22,
  };

  // Revision 6 back material.  One linear RGBA ORM texture feeds BOTH
  // roughnessMap and metalnessMap (three r151 samples roughness .g, metalness
  // .b) with scalars 1.0 because the channels are absolute; the sRGB albedo
  // carries the reconstructed artwork and the linear normal carries the
  // engraving/panel bevels.  The clearcoat family (0.20 / 0.40) and the shared
  // sleek clearcoat normal are unchanged from the accepted R2 back.
  const backArtworkMeta = (meta.back && meta.back.artwork) || {};
  const backRecommendedMaterial = {};
  for (const key of ['envMapIntensity', 'normalScale', 'clearcoat', 'clearcoatRoughness']) {
    const value = Number(backRecommended[key]);
    if (Number.isFinite(value)) backRecommendedMaterial[key] = value;
  }
  const back = new THREE.MeshPhysicalMaterial({
    name: 'card-' + spec.id + '-back',
    map: backAlbedo,
    roughnessMap: backOrm,
    metalnessMap: backOrm,
    roughness: 1,
    metalness: 1,
    normalMap: backNormal,
    normalScale: new THREE.Vector2(backTuning.normalScale, backTuning.normalScale),
    clearcoat: BACK_ART.material.clearcoat,
    clearcoatRoughness: BACK_ART.material.clearcoatRoughness,
    clearcoatNormalMap: sharedNormal,
    clearcoatNormalScale: new THREE.Vector2(
      BACK_ART.material.clearcoatNormalScale,
      BACK_ART.material.clearcoatNormalScale,
    ),
    envMapIntensity: backTuning.envMapIntensity,
  });
  back.userData = {
    role: 'back',
    cardId: spec.id,
    finish: 'reconstructed-engraved-metal',
    normalScale: backTuning.normalScale,
    envMapIntensity: backTuning.envMapIntensity,
    artwork: {
      revision: 6,
      design: spec.id + '-back',
      size: BACK_ART.size.slice(),
      files: { albedo: backMeta.albedo, orm: backMeta.orm, normal: backMeta.normal },
      channels: { roughness: BACK_ART.channels.roughness, metalness: BACK_ART.channels.metalness },
      mode: { roughness: BACK_ART.mode.roughness, metalness: BACK_ART.mode.metalness },
      normalConvention: BACK_ART.normalConvention,
      provenance: typeof backArtworkMeta.provenance === 'string'
        ? backArtworkMeta.provenance
        : 'docs/card-back-artwork.md',
      recommendedMaterial: backRecommendedMaterial,
    },
  };

  // Round 4: per-card bezel.  The light card keeps the polished silver rim
  // (R2.2; the four-corner bright arcs are an acceptance property).  The dark
  // card's frame is the same dark metal tone as its face - a flat dark color,
  // no albedo texture (so no baked/white stripe), satin/gloss body per R4.2.
  const darkFrame = spec.id === 'dark';
  const edge = new THREE.MeshPhysicalMaterial(darkFrame
    ? {
      name: 'card-' + spec.id + '-edge',
      color: new THREE.Color(DARK_FRAME_COLOR_SRGB).convertSRGBToLinear(),
      normalMap: sharedNormal,
      normalScale: new THREE.Vector2(0.15, 0.15),
      roughnessMap: sharedRough,
      roughness: 0.37,
      metalness: 0.72,
      clearcoat: 0.38,
      clearcoatRoughness: 0.18,
      clearcoatNormalMap: sharedNormal,
      clearcoatNormalScale: new THREE.Vector2(0.15, 0.15),
      envMapIntensity: 0.95,
    }
    : {
      name: 'card-' + spec.id + '-edge',
      map: sharedMetal,
      normalMap: sharedNormal,
      normalScale: new THREE.Vector2(0.15, 0.15),
      roughnessMap: sharedRough,
      roughness: 0.10,
      metalness: 1,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
      clearcoatNormalMap: sharedNormal,
      clearcoatNormalScale: new THREE.Vector2(0.15, 0.15),
      envMapIntensity: 2.0,
    });
  edge.userData = {
    role: 'edge',
    cardId: spec.id,
    finish: darkFrame ? 'dark-satin-frame' : 'polished-silver',
    color: darkFrame ? DARK_FRAME_COLOR_HEX : '#ffffff',
  };

  return { front, back, edge };
}

function resolveSpec(specOrId) {
  if (typeof specOrId === 'string') {
    const spec = CARD_SPECS.find((entry) => entry.id === specOrId);
    if (!spec) {
      fail('unknown card id "' + specOrId + '" (expected one of '
        + CARD_SPECS.map((entry) => '"' + entry.id + '"').join(', ') + ')');
    }
    return spec;
  }
  if (specOrId && typeof specOrId === 'object' && typeof specOrId.id === 'string') {
    const spec = CARD_SPECS.find((entry) => entry.id === specOrId.id);
    if (!spec) fail('unknown card id "' + specOrId.id + '"');
    return spec;
  }
  fail('createCard expects a card id string or a spec with an id');
  return CARD_SPECS[0];
}

/**
 * Load the card asset bank: card-assets.json + the fifteen sampled PNGs
 * (Revision 6: 2 faces, 2 face-metalness maps, 2 dark-front extra maps, 3 shared
 * sleek tiles and 6 per-card back maps - albedo + ORM + normal for dark/light).
 * `onProgress(loaded, total)` counts the metadata as one unit, so total = 16.
 *
 * @param {{assetBase?:string, onProgress?:(loaded:number,total:number)=>void}} [options]
 * @returns {Promise<{specs:typeof CARD_SPECS, metrics:typeof CARD_METRICS, metadata:object,
 *   textures:object, createCard:Function, dispose:Function}>}
 */
export async function loadCardBank({ assetBase = DEFAULT_ASSET_BASE, onProgress } = {}) {
  const base = resolveBase(assetBase);
  const jsonUrl = base + 'card-assets.json';
  let raw;
  try {
    const response = await fetch(jsonUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ' ' + response.statusText);
    }
    raw = await response.json();
  } catch (error) {
    throw new Error('card-model: failed to load card asset metadata "' + jsonUrl + '" ('
      + (error && error.message ? error.message : error)
      + '). Serve the project (node tools/serve.mjs) and check assetBase; regenerate the assets with '
      + 'tools/prepare-card-assets.py if the folder is missing.');
  }
  const entries = normalizeMetadata(raw, base, jsonUrl);
  const total = entries.required.length + 1;
  const textures = await loadTextureBank(entries, base, entries.sampling, onProgress, total);

  let disposed = false;
  const bank = {
    version: MODEL_VERSION,
    specs: CARD_SPECS,
    metrics: CARD_METRICS,
    metadata: entries.raw,
    textures,
    createCard(specOrId, options = {}) {
      if (disposed) fail('loadCardBank().dispose() was called  - create a new bank');
      const spec = resolveSpec(specOrId);
      const quality = options && typeof options.quality === 'string' && DETAIL_LEVELS[options.quality]
        ? options.quality
        : 'hero';
      const detail = DETAIL_LEVELS[quality];
      const materials = buildMaterials(spec, textures, entries.raw);

      const frontGeometry = buildPlateGeometry(CARD_METRICS, detail, 'front');
      const backGeometry = buildPlateGeometry(CARD_METRICS, detail, 'back');
      const edgeGeometry = buildEdgeGeometry(CARD_METRICS, detail, entries.sampling);

      const front = new THREE.Mesh(frontGeometry, materials.front);
      front.name = 'card-' + spec.id + '-front';
      front.castShadow = true;
      front.receiveShadow = true;
      const back = new THREE.Mesh(backGeometry, materials.back);
      back.name = 'card-' + spec.id + '-back';
      back.castShadow = true;
      back.receiveShadow = true;
      const edge = new THREE.Mesh(edgeGeometry, materials.edge);
      edge.name = 'card-' + spec.id + '-edge';
      edge.castShadow = true;
      edge.receiveShadow = true;

      const group = new THREE.Group();
      group.name = 'card-' + spec.id;
      group.add(front, back, edge);

      const geometries = [frontGeometry, backGeometry, edgeGeometry];
      let cardDisposed = false;
      const card = {
        id: spec.id,
        spec,
        quality,
        group,
        front,
        back,
        edge,
        materials,
        triangleCount: (frontGeometry.getIndex() ? frontGeometry.getIndex().count : frontGeometry.getAttribute('position').count) / 3
          + (backGeometry.getIndex() ? backGeometry.getIndex().count : backGeometry.getAttribute('position').count) / 3
          + (edgeGeometry.getIndex() ? edgeGeometry.getIndex().count : edgeGeometry.getAttribute('position').count) / 3,
        dispose() {
          if (cardDisposed) return;
          cardDisposed = true;
          for (const geometry of geometries) geometry.dispose();
          materials.front.dispose();
          materials.back.dispose();
          materials.edge.dispose();
          group.clear();
        },
      };
      return card;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeTextures(textures);
    },
  };
  return bank;
}

