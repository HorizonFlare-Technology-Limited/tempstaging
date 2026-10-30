/**
 * tekoanimation - three.js metal payment-card model.  Revision 8.
 *
 * Build contract: docs/card-model-contract.md (API frozen; Revision 8 binding).
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
 * whose front and back plates are inset by a thin 0.016 chamfer/bevel; a short
 * elliptical round-over (vertical extent 0.007) connects the plate to a vertical
 * mirror band at the full source silhouette (corner radius measured from the
 * source alpha: 34 px at 929 px width).  Both cards share the same geometry.
 * Revision 8: the plate chamfer and round-over are reduced from 0.042 / 0.021 so
 * the bezel reads as a thin, flush mirror rim (never proud of the plate planes -
 * the edge's outermost ring lies exactly on z = +/-thickness/2).
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
 *  - Bezels are per card (Revision 8, round 8): BOTH cards now use a polished
 *    mirror/chrome middle frame (metalness 1.0, roughness ~0.04, no normal-map
 *    grain, tuned clearcoat + envMapIntensity) on the thin 0.016 flush rim, so
 *    the frame reads as a mirror edge instead of the wider R2/R4 frame.  The
 *    R4 dark satin frame and the R2 target of a wide bright bevel are superseded;
 *    the chrome reflection is never allowed to clip to flat white.
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
  // Revision 8 (round 8): thin flush mirror bezel.  0.042 -> 0.016 (about 27 %
  // of the 0.06 card thickness, well inside the "same width or thinner" target):
  // the frame is a hairline chamfer so the printed plates come within 0.016 of
  // the silhouette instead of the wide R2.2 0.042 border.
  bevel: 0.016,
});

const DEFAULT_ASSET_BASE = new URL('../assets/textures/card/', import.meta.url).href;
const MODEL_VERSION = '2.6.0';

/** Geometry detail per quality level; hero is the page default (R2.3). */
const DETAIL_LEVELS = Object.freeze({
  hero: Object.freeze({ cornerSegments: 40, filletSegments: 22, bandSegments: 3 }),
  gallery: Object.freeze({ cornerSegments: 20, filletSegments: 12, bandSegments: 2 }),
});

/**
 * Vertical extent of the plate-to-band round-over (Revision 8: 0.021 -> 0.007).
 * `CARD_METRICS.bevel` (0.016) is the in-plane chamfer; the vertical extent must
 * stay below half the card thickness (0.06), so the round-over uses 0.007 and
 * leaves a 0.046-high mirror band at the full silhouette.  The round-over stays
 * short on purpose: a chrome mirror needs a nearly vertical band, and a shallow
 * chamfer at plate level, to read as a flush hairline rim instead of a wide
 * raised bevel.
 */
const FILLET_DEPTH = 0.007;

/**
 * Revision 8 (round 8): the middle frame/bezel of BOTH cards is a mirror chrome
 * material.  This supersedes the Round-4 dark satin frame (contract R4.2) and the
 * Round-2 wide polished bevel (R2.3): the user asked for a mirror frame that is
 * visually flush with the card thickness and no longer protrudes beyond the card.
 *
 * Chrome means a fully metallic dielectric-free BRDF: metalness 1.0, a very low
 * roughness (the specular lobe is the studio environment, not a blurred sheen),
 * no normal-map grain (a mirror must not be bent by micro-structure), and a low
 * clearcoat coat (a heavy coat would add a white dielectric sheen on top of the
 * mirror and risk clipping).  `envMapIntensity` is tuned per card against the
 * delivered dark studio: the dark card's frame must reflect the environment as a
 * chrome edge without becoming a clipped white line, the light card's frame may
 * sit slightly brighter because it sits on a light face.
 */
const EDGE_MIRROR = Object.freeze({
  // Revision 15 (R15-1): the DARK card's middle frame is a black metal mirror,
  // not chrome. Fully metallic near-black F0, very low roughness (mirror lobe),
  // no albedo/normal grain and a deliberately low clearcoat (a heavy coat would
  // add a white dielectric sheen on top of the black mirror). envMapIntensity is
  // tuned against the delivered dark studio so the thin edge reads as a black
  // mirror band (it must not collapse into the dark backdrop).
  dark: Object.freeze({
    finish: 'black-mirror-metal',
    metalness: 1.0,
    roughness: 0.045,
    clearcoat: 0.08,
    clearcoatRoughness: 0.12,
    normalScale: 0,
    clearcoatNormalScale: 0,
    color: '#0e1114',
    envMapIntensity: 2.6,
    glossyMirror: true,
    blackMirror: true,
  }),
  // The LIGHT card's frame stays the accepted Revision-8 mirror chrome.
  light: Object.freeze({
    finish: 'mirror-chrome',
    metalness: 1.0,
    roughness: 0.04,
    // A light clearcoat keeps the chrome lobe clean; 0.42 also stays at/above the
    // QA edge-clearcoat floor inherited from the round-2 bezel contract.
    clearcoat: 0.42,
    clearcoatRoughness: 0.06,
    normalScale: 0,
    clearcoatNormalScale: 0,
    color: '#eef2f6',
    envMapIntensity: 1.45,
    glossyMirror: true,
    blackMirror: false,
  }),
});

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
 * Edge profile in (inset, z, normal) space: a short elliptical round-over from
 * the plate boundary down to a near-vertical mirror band at the full silhouette,
 * then mirror to the back plate.  Revision 8: in-plane chamfer =
 * CARD_METRICS.bevel (0.016), vertical extent = FILLET_DEPTH (0.007); the
 * analytic ellipse normals are continuous across the round-over (max step
 * 9.28 deg at the hero 22-segment subdivision, sub-pixel on the page) so the
 * chrome rim shades as one smooth band with no faceting.
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
  const sharedFiles = new Set(); // Rev 5: sleek maps are no longer loaded (procedural microdot instead)
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
  return Promise.all(jobs).then(() => {
    addMicrodotTextures(textures);
    return textures;
  }).catch((error) => {
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

/* ------------------------------------------------------------------------- */
/* Rev 5: procedural micro-dot microdoted grid (replaces sleek.jpg maps)         */
/* ------------------------------------------------------------------------- */

// Hex-ish (offset-row) lattice of tiny raised dots. One tile = 4 dots x 2 rows;
// the tile repeats MICRODOT.repeat times over the card face (~128 dots across).
// Rev 11: front faces are plain (no normal / dot roughness); lightRoughness = the former dotted-map mean.
const MICRODOT_FACE = { lightRoughness: 0.41, clearcoatRoughness: 0.3 };
const MICRODOT = Object.freeze({
  tileW: 64, tileH: 28, pitch: 16, rowPitch: 14, radius: 5.4,
  repeat: [32, 50],        // u, v tile repeats over the card (square dot pitch on the 3.36 x 2.30 face)
  normalStrength: 2.6,     // slope multiplier of the bump profile
});

let microdotTile = null;
function microdotHeightTile() {
  if (microdotTile) return microdotTile;
  const { tileW, tileH, pitch, rowPitch, radius } = MICRODOT;
  const h = new Float32Array(tileW * tileH);
  const centres = [];
  for (let j = 0; j < 2; j += 1) {
    for (let i = 0; i < 4; i += 1) centres.push([(i + 0.25 + 0.5 * j) * pitch, (j + 0.5) * rowPitch]);
  }
  for (let y = 0; y < tileH; y += 1) {
    for (let x = 0; x < tileW; x += 1) {
      let best = 0;
      for (const [cx, cy] of centres) {
        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            const dx = x + 0.5 - (cx + ox * tileW);
            const dy = y + 0.5 - (cy + oy * tileH);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < radius) {
              const c = Math.cos((Math.PI * d) / (2 * radius));
              best = Math.max(best, c * c);
            }
          }
        }
      }
      h[y * tileW + x] = best;
    }
  }
  microdotTile = h;
  return h;
}

function makeMicrodotNormal() {
  const { tileW, tileH, normalStrength } = MICRODOT;
  const h = microdotHeightTile();
  const data = new Uint8Array(tileW * tileH * 4);
  const at = (x, y) => h[((y + tileH) % tileH) * tileW + ((x + tileW) % tileW)];
  for (let y = 0; y < tileH; y += 1) {
    for (let x = 0; x < tileW; x += 1) {
      // DataTexture row 0 = v 0 (up in tangent space), so dh/dv = dh/dy here.
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * normalStrength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * normalStrength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * tileW + x) * 4;
      data[o] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, tileW, tileH, THREE.RGBAFormat);
  return finishMicrodotTexture(tex, 'microdot-normal');
}

function finishMicrodotTexture(tex, name) {
  tex.name = name;
  tex.encoding = THREE.LinearEncoding;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(MICRODOT.repeat[0], MICRODOT.repeat[1]);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Rev 11 (s38): the FRONT faces carry no dot pattern; only the shared clearcoat
// normal used by the BACK plates remains procedural.
function addMicrodotTextures(textures) {
  textures['microdot-normal'] = makeMicrodotNormal();
}

const BLACK_FACE_SPECULAR = 0.16;
function buildMaterials(spec, textures, meta) {
  const frontMap = textures[spec.face];
  // Revision 8: `sleek-metal.png` is still part of the validated texture bank
  // (the asset contract and loader keep it), but the mirror bezel no longer
  // samples it - a chrome F0 is the raw metal colour, not the flattened sleek
  // albedo.
  const sharedNormal = textures['microdot-normal'];
  const cardMeta = meta.cards.find((entry) => entry.id === spec.id);
  const faceMetalness = textures[cardMeta.faceMetalness];
  const faceRough = (cardMeta.faceRoughness && textures[cardMeta.faceRoughness]) || null; // dark: plain ink/field roughness map
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
    // Rev 12 (s39): black face = light-absorbing dielectric; the shared env boost makes a
    // full F0 .04 lobe read mid-grey (~75/255) at lit poses, so scale the specular down.
    specularIntensity: smoothBlack ? BLACK_FACE_SPECULAR : 1.0,
    specularIntensityMap: faceMetalness,
    roughnessMap: faceRough,
    roughness: smoothBlack ? 0.5 : MICRODOT_FACE.lightRoughness,
    metalness: smoothBlack ? 0 : 0.92,
    clearcoat: smoothBlack ? 0 : 0.45,
    clearcoatRoughness: MICRODOT_FACE.clearcoatRoughness,
    envMapIntensity: smoothBlack ? 1.0 : 1.05,
  });
  front.userData = {
    role: 'front',
    cardId: spec.id,
    finish: smoothBlack ? 'plain-black-metal' : 'plain-satin-print',
    effectiveMetalnessField: smoothBlack ? 0 : 0.506,
    effectiveMetalnessInk: 0.0552,
    effectiveRoughnessField: smoothBlack ? 0.28 : 0.41,
    effectiveRoughnessInk: smoothBlack ? 0.5 : 0.41,
    normalScale: 0,
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

  // Revision 8: mirror chrome middle frame for BOTH cards (supersedes R4.2's
  // dark satin frame and R2.2's polished-silver/map-based bezel).  The material
  // carries no albedo map and no normal-map grain: a mirror is defined by its
  // environment reflection, so the normalScale is 0 and the roughness is a single
  // low scalar (the sleek roughness map is intentionally NOT bound here - its
  // micro variation would smear the chrome lobe).  Clearcoat is deliberately
  // light: a heavy coat would add a white dielectric layer that reads as a
  // painted frame instead of chrome and can clip under the reflection boost.
  // Revision 15: per-card middle-frame finish. Dark card = black metal mirror
  // (near-black fully-metallic F0, mirror roughness, low clearcoat); light card =
  // the accepted Revision-8 mirror chrome. Both are map-free: a mirror must not be
  // bent/smeared by albedo or normal grain.
  const edgeSpec = EDGE_MIRROR[spec.id] || EDGE_MIRROR.light;
  const edge = new THREE.MeshPhysicalMaterial({
    name: 'card-' + spec.id + '-edge',
    color: new THREE.Color(edgeSpec.color).convertSRGBToLinear(),
    normalScale: new THREE.Vector2(edgeSpec.normalScale, edgeSpec.normalScale),
    roughness: edgeSpec.roughness,
    metalness: edgeSpec.metalness,
    clearcoat: edgeSpec.clearcoat,
    clearcoatRoughness: edgeSpec.clearcoatRoughness,
    clearcoatNormalScale: new THREE.Vector2(
      edgeSpec.clearcoatNormalScale,
      edgeSpec.clearcoatNormalScale,
    ),
    envMapIntensity: edgeSpec.envMapIntensity,
  });
  edge.userData = {
    role: 'edge',
    cardId: spec.id,
    finish: edgeSpec.finish,
    color: edgeSpec.color,
    glossyMirror: edgeSpec.glossyMirror,
    blackMirror: edgeSpec.blackMirror,
    envMapIntensity: edgeSpec.envMapIntensity,
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

