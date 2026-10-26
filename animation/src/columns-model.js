/**
 * tekoanimation — Material Columns model  (SPEC-columns.md §3–§5).
 *
 * The model is 27 REAL long cuboids — one mesh per column (revision 9: an
 * analytic rounded box with 3 / 5 / 10 px bevels by footprint size class),
 * never instanced, never sprites, never rescaled:
 *
 *   3 material groups (plaster / limestone / satin)   [SPEC rev 5]
 *   × 3 heights      (long 600 px / medium 550 px / short 500 px)   [SPEC rev 4]
 *   × 3 footprints   (large 140 px / medium 80 px / small 40 px)
 *   = 27 columns.
 *
 * Unit convention: 1 source pixel = 1 three.js world unit.  Every dimension in
 * this file is therefore the literal pixel value from the source requirement;
 * geometry is authored at that scale and nothing is scaled at runtime.
 *
 * Layout (frozen, SPEC §4):
 *   - inside a group X = footprint axis: large -180, medium 0, small +180
 *   - inside a group Z = height axis:    long  -180, medium 0, short  +180
 *   - group centre X = (groupIndex - 1) * 700  (plaster, limestone, satin)
 *   - column centre  = (groupCentreX + xOffset, heightPx / 2, zOffset)
 *   - real geometry bounds (mesh bbox): X [-950, 900], Z [-250, 250], Y [0, 600]
 *     => 1850 × 500 × 600, content centre (-25, 300, 0)  (SPEC rev 4)
 *     (`large` sits at local x = -180, so the envelope is asymmetric on X)
 *
 * Textures are never invented: every map comes from the material manifest that
 * tools/prepare-material-assets.py derives from the source images
 * (plaster.png / limestone.png / satin.png).  One shared
 * MeshStandardMaterial per material group is configured from that manifest.
 * Limestone samples albedo + normalMap + roughnessMap + metalnessMap + aoMap and
 * an optional height bumpMap; satin samples albedo + normalMap + roughnessMap +
 * metalnessMap + aoMap; plaster samples albedo + aoMap only and uses authored
 * constants for normal / roughness / metalness (see rev 8 below).  Every group
 * keeps a per-material envMapIntensity (satin highest, so the studio softboxes
 * give it a crisp edge highlight like the satin reference).
 *
 * Revision 8 (SPEC-columns): the plaster group stays a reflective LIQUID-METAL
 * MIRROR (constant metalness 1.0, bright colour lift, dedicated preview
 * CubeCamera→PMREM envMap and its layer-2 accents) but is now FLAT AND CLEAN.
 * The revision-7 procedural liquid-flow normal and both the derived normal and
 * roughness map sampling are gone (normalScale [0, 0], constant roughness 0.092
 * = the rev-7 effective mean), so the mirror shows no rough grain and no flowing
 * waves — only the unchanged reflective response.  Satin keeps its derived grain
 * maps with a lower normalScale because the rev-8 rebuilt maps are denser and
 * finer; limestone is untouched.  Geometry, footprints, heights, UVs and layout
 * are identical to rev 7.
 *
 * Revision 9 (this branch, user request): the three surfaces are re-authored and
 * every column gets rounded/bevelled edges, while the 27 boxes, their exact
 * footprints/heights/layout, the UV density and the reflective kits are unchanged.
 *
 *   - Plaster: PERFECTLY smooth, zero grain.  The derived albedo is a flat
 *     calibrated colour (no speckle) and AO is flat, so after the unchanged
 *     metalness 1.0 / colour lift / dedicated CubeCamera→PMREM envMap the surface
 *     reads as a clean liquid-metal mirror with no micro-detail at all.  No
 *     normal, roughness, metalness or bump map is sampled (normalScale [0, 0]).
 *   - Limestone: the dark rough stone of the round-5 reference.  Its visible grain
 *     is carried ONLY by per-point chromatic variation in the albedo (colour
 *     noise), NOT by normal/bump/displacement geometry: no normalMap is sampled
 *     (normalScale [0, 0]) and bumpScale is 0.  The colour family stays the dark
 *     limestone family and the roughness/metalness/AO maps stay flat and matte.
 *   - Satin: the smooth neutral-grey satin of the round-5 reference.  The albedo
 *     carries the reference's soft tonal gradient and no grain; the rev-7/8 fine
 *     normal/roughness grain is gone (no normalMap sampled, normalScale [0, 0])
 *     while the rev-6 blurred mirror reflection behaviour (roughness factor 0.80
 *     over the flat 0.30 map, metalness map 0.85, envMapIntensity 2.40, dedicated
 *     satin CubeCamera capture) is unchanged.
 *   - Rounded edges: every column is an analytic rounded box (6 flat faces + 12
 *     quarter-cylinder bevel strips + 8 spherical corner octants) with an exact
 *     width × heightPx × depth bounding box.  The bevel radius is mapped from the
 *     footprint size class: large (140 px) = 10 px, medium (80 px) = 5 px,
 *     small/short (40 px) = 3 px — the brief's "large/medium/small" are the
 *     footprint classes; the height classes (long/medium/short) do not change the
 *     radius.  Six segments per 90° arc keep the bevel visually smooth.
 *
 * UV density (SPEC §5): the model bakes `effectiveTilePx = manifest.tilePx ×
 * UV_DENSITY_SCALE` (1.30, SPEC rev 4) as the world px one texture tile covers
 * on EVERY box face, so a 40 px face shows 40/effectiveTilePx of a tile while a
 * 140 px face shows 140/effectiveTilePx — the texture grain keeps its physical
 * scale on every dimension with 30% calmer density.  Baked into a per-column cloned geometry
 * (27 geometries) using a right-handed planar mapping aligned with the world
 * axes, so the grain also wraps continuously around the vertical corners.
 *
 * Public API (frozen names):
 *
 *   import {
 *     MATERIALS, FOOTPRINTS, HEIGHTS, COLUMN_SPECS, COLUMN_METRICS,
 *     loadColumnBank, createColumns,
 *   } from './columns-model.js';
 *
 *   const bank = await loadColumnBank({ onProgress(loaded, total) {} });
 *   const columns = createColumns(bank, { quality: 'hero' });
 *   scene.add(columns.group);
 *   columns.group / columns.columns / columns.materials / columns.bounds
 *   columns.dispose();   // 27 per-column geometries
 *   bank.dispose();      // shared textures + materials
 *
 * Everything is deterministic (no Math.random anywhere), local-only (relative
 * files through the page import map; no CDN, no external fonts/images) and the
 * module is safe to import without a DOM (only loadColumnBank needs a browser).
 */

import * as THREE from 'three';
import { createRoundedColumnGeometry } from './columns-rounded-geometry.js';

/** Human-readable module version (not part of the frozen page contract). */
export const MODEL_VERSION = '1.3.0';

/**
 * Revision-4 texture-density reduction: the model bakes UVs so one texture tile
 * covers `manifest.tilePx × UV_DENSITY_SCALE` world px of surface (30% calmer,
 * larger features — user request "纹理浓度过重，减轻纹理浓度").
 * @type {number}
 */
export const UV_DENSITY_SCALE = 1.3;

/** Texture channels the model understands, in load order. */
export const MAP_CHANNELS = Object.freeze([
  'albedo',
  'normal',
  'roughness',
  'metalness',
  'ao',
  'height',
]);

/* ------------------------------------------------------------------------- */
/* Frozen public registry (SPEC §3)                                          */
/* ------------------------------------------------------------------------- */

/**
 * The three material groups, in group order.  Each group's maps are derived
 * from its own workspace PBR sample sheet.
 * @type {readonly ReadonlyArray<{id:string,label:string,sourceImage:string}>}
 */
export const MATERIALS = Object.freeze(
  [
    { id: 'plaster', label: 'Plaster', sourceImage: 'plaster.png' },
    { id: 'limestone', label: 'Limestone', sourceImage: 'limestone.png' },
    { id: 'satin', label: 'Satin', sourceImage: 'satin.png' },
  ].map((material) => Object.freeze(material)),
);

/**
 * Frozen footprint registry: box base X × Z in source px (SPEC §3).
 * @type {Readonly<Record<'large'|'medium'|'small', Readonly<{id:string,label:string,px:number}>>>}
 */
export const FOOTPRINTS = Object.freeze({
  large: Object.freeze({ id: 'large', label: 'Large', px: 140 }),
  medium: Object.freeze({ id: 'medium', label: 'Medium', px: 80 }),
  small: Object.freeze({ id: 'small', label: 'Small', px: 40 }),
});

/**
 * Frozen height registry: Y extent in source px, bottom face at y = 0 (SPEC §3).
 * @type {Readonly<Record<'long'|'medium'|'short', Readonly<{id:string,label:string,px:number}>>>}
 */
export const HEIGHTS = Object.freeze({
  long: Object.freeze({ id: 'long', label: 'Long', px: 600 }),
  medium: Object.freeze({ id: 'medium', label: 'Medium', px: 550 }),
  short: Object.freeze({ id: 'short', label: 'Short', px: 500 }),
});

/** Deterministic iteration order — also the order of COLUMN_SPECS. */
const FOOTPRINT_ORDER = Object.freeze(['large', 'medium', 'small']);
const HEIGHT_ORDER = Object.freeze(['long', 'medium', 'short']);

/** X offsets inside a group (footprint axis), SPEC §4. */
const FOOTPRINT_X_OFFSET = Object.freeze({ large: -180, medium: 0, small: 180 });

/** Z offsets inside a group (height axis), SPEC §4. */
const HEIGHT_Z_OFFSET = Object.freeze({ long: -180, medium: 0, short: 180 });

/**
 * Frozen layout metrics (SPEC §4 + revision 4).  `bounds` are the REAL
 * geometry extents measured from the 27 meshes: the largest footprint sits at
 * local x = -180 (plaster large) and the small footprint at x = +180 (satin
 * small), so the envelope is asymmetric on X and 1850 px wide:
 *
 *   min = (-950, 0, -250)   max = (900, 600, 250)
 *   size = (1850, 600, 500)   centre = (-25, 300, 0)
 *
 * The extreme contributors are plaster-large-long (min X), satin-small-long
 * (max X), plaster-large-long (min Z), plaster-large-short (max Z), any long
 * column (max Y = 600).  `uvDensityScale` is the rev-4 texture-density reduction
 * applied to the manifest tilePx when baking UVs (effectiveTilePx = tilePx ×
 * uvDensityScale).
 *
 * Revision 9 rounded edges: `cornerRadiusPx` maps the collection's footprint size
 * classes to the bevel radius in source px (large 140 px → 10, medium 80 px → 5,
 * small/short 40 px → 3).  The brief's "small/short" is the small end of the size
 * range; a column's height class (long/medium/short) does NOT change its radius,
 * so the mapping is keyed purely by footprint.  `bevelSegments` is the number of
 * segments per 90° bevel arc (6 → 15° per segment, smooth at this scale).
 * @type {Readonly<object>}
 */
export const COLUMN_METRICS = Object.freeze({
  cell: 180,
  gap: 40,
  groupSpacing: 700,
  totalWidth: 1850,
  totalDepth: 500,
  maxHeight: 600,
  unit: 'px',
  uvDensityScale: UV_DENSITY_SCALE,
  groupOrder: Object.freeze(['plaster', 'limestone', 'satin']),
  footprintXOffset: FOOTPRINT_X_OFFSET,
  heightZOffset: HEIGHT_Z_OFFSET,
  // Revision 9: rounded-column bevel radius by footprint size class (source px,
  // 1 px = 1 world unit).  The three radius values requested by the user:
  // small/short = 3 px, medium = 5 px, large = 10 px.
  cornerRadiusPx: Object.freeze({ large: 10, medium: 5, small: 3 }),
  // Segments per 90° bevel arc: 6 = 15° steps, enough to read smooth at the
  // page's on-screen column scale (a 10 px radius on a 140 px column is only
  // ~7 % of the width, so 6 steps give a convincingly round edge).
  bevelSegments: 6,
  bounds: Object.freeze({
    min: Object.freeze({ x: -950, y: 0, z: -250 }),
    max: Object.freeze({ x: 900, y: 600, z: 250 }),
    size: Object.freeze({ x: 1850, y: 600, z: 500 }),
    center: Object.freeze({ x: -25, y: 300, z: 0 }),
  }),
});

/* ------------------------------------------------------------------------- */
/* Frozen column specs (27)                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Build the frozen 27-column spec table straight from the registries above.
 * Iteration order: material group (plaster, limestone, satin) → footprint
 * (large, medium, small) → height (long, medium, short).
 * @returns {Array<object>}
 */
function createColumnSpecs() {
  const specs = [];
  MATERIALS.forEach((material, groupIndex) => {
    const groupCentreX = (groupIndex - 1) * COLUMN_METRICS.groupSpacing;
    for (const footprintKey of FOOTPRINT_ORDER) {
      const footprint = FOOTPRINTS[footprintKey];
      for (const heightKey of HEIGHT_ORDER) {
        const height = HEIGHTS[heightKey];
        const position = Object.freeze({
          x: groupCentreX + COLUMN_METRICS.footprintXOffset[footprintKey],
          y: height.px / 2,
          z: COLUMN_METRICS.heightZOffset[heightKey],
        });
        specs.push(
          Object.freeze({
            id: material.id + '-' + footprintKey + '-' + heightKey,
            groupIndex,
            material: material.id,
            footprint: footprintKey,
            height: heightKey,
            width: footprint.px,
            depth: footprint.px,
            heightPx: height.px,
            position,
            label: material.label + ' ' + footprint.label + ' ' + height.label,
          }),
        );
      }
    }
  });
  return specs;
}

/**
 * All 27 frozen column specs.  Column id = "<material>-<footprint>-<height>",
 * e.g. `limestone-small-long`.  `position` is the mesh centre (bottom face at
 * y = 0), exactly as defined by SPEC §3–§4.
 * @type {readonly ReadonlyArray<Readonly<{
 *   id:string, groupIndex:number, material:string, footprint:string,
 *   height:string, width:number, depth:number, heightPx:number,
 *   position:Readonly<{x:number,y:number,z:number}>, label:string
 * }>>}
 */
export const COLUMN_SPECS = Object.freeze(createColumnSpecs());

/** Fast id lookup over the frozen spec table (internal, deterministic). */
const SPEC_BY_ID = new Map(COLUMN_SPECS.map((spec) => [spec.id, spec]));

/* ------------------------------------------------------------------------- */
/* Constants                                                                 */
/* ------------------------------------------------------------------------- */

const DEFAULT_ASSET_BASE = new URL('../assets/textures/materials/', import.meta.url).href;

/** Texture filtering/anisotropy (SPEC §5).  8 is the requested value; WebGL
 *  clamps it to the driver maximum at upload time. */
const TEXTURE_ANISOTROPY = 8;

/** Manifest shape required by SPEC §2.  `size` is the exact required square
 *  size in source px and `colorSpace` is the channel's declared colour space. */
const CHANNEL_RULES = Object.freeze({
  albedo: Object.freeze({ required: true, size: 1024, colorSpace: 'srgb' }),
  normal: Object.freeze({ required: true, size: 512, colorSpace: 'linear' }),
  roughness: Object.freeze({ required: true, size: 512, colorSpace: 'linear' }),
  metalness: Object.freeze({ required: true, size: 512, colorSpace: 'linear' }),
  ao: Object.freeze({ required: true, size: 512, colorSpace: 'linear' }),
  height: Object.freeze({ required: false, size: 512, colorSpace: 'linear' }),
});

/**
 * Per-material render tuning.  These are the model's authored defaults; the
 * asset manifest may override them with an optional `params` block on a
 * material entry (the extraction pipeline knows the measured roughness /
 * metalness stats of each derived map).  Units: normalScale and aoMapIntensity
 * are multipliers, bumpScale is in world px (1 px = 1 world unit).
 *
 * All three groups keep world-aligned UV grain (no vertical rotation in rev 5);
 * limestone keeps the dielectric metalness base of 0 (it can never read as
 * metal), while satin's effective metalness comes from its map (mean ≈ 0.85) and
 * rev 7/8 keep plaster as a constant metalness 1.0 liquid-metal mirror that is
 * FLAT AND CLEAN in rev 8.  Rev 9 removes the last micro-detail: the plaster
 * albedo/AO are flat, and limestone/satin stop sampling their normal maps (the
 * limestone grain is albedo colour noise; the satin is smooth).
 */
const MATERIAL_TUNING = Object.freeze({
  plaster: Object.freeze({
    // Revision 8 (user request: keep the reflective liquid-metal mirror but
    // remove the visible rough/wavy surface texture): the mirror is FLAT AND
    // CLEAN.  Revision 9 removes the final albedo/AO micro-speckle in the asset
    // pipeline, so the surface is PERFECTLY smooth: all remaining variation comes
    // from what the unchanged mirror reflects.  Geometry, footprints, heights,
    // the asset tree and the reflective appearance are unchanged.  Maps NOT
    // sampled: metalnessMap (constant 1.0 instead), normalMap (none at all),
    // roughnessMap (constant 0.092), height/bump (none).
    metalness: 1.0,
    // Rev 8: constant roughness with NO roughnessMap sampling.  0.092 is exactly
    // the rev-7 EFFECTIVE mean (rev-7 factor 0.10 × manifest roughness map mean
    // 0.9204), so the mirror keeps the accepted reflective sharpness while the
    // map's visible speckle modulation of the reflection is gone.
    roughness: 0.092,
    // Flat surface - no normal map sampling at all.  Kept explicit as [0, 0] and
    // forwarded to THREE.Vector2 so QA can prove the wiring.
    normalScale: Object.freeze([0, 0]),
    aoMapIntensity: 0.9,
    // Rev 7 band 2.0–3.0 (top of band). The previewer assigns a dedicated,
    // sharper scene-capture envMap; 3.0 lifts the mirror from "dark charcoal"
    // to a bright silver/chrome liquid mirror (Lead capture review).  Unchanged
    // in rev 8/9 because the reflective response is exactly the accepted one.
    envMapIntensity: 3.0,
    // No bump: nothing perturbs the flat mirror.
    bumpScale: 0.0,
    // Neutralise the light warm-grey plaster albedo into a bright silver/chrome
    // F0: linear albedo means ≈ (0.389, 0.374, 0.350) × (2.00, 2.12, 2.36)
    // ≈ (0.78, 0.79, 0.83) linear reflectance.
    color: Object.freeze([2.0, 2.12, 2.36]),
  }),
  limestone: Object.freeze({
    // Rev 9: dark rough stone (round-5 reference).  The stone is dielectric and
    // fully matte; the grain reads from the ALBEDO's per-point chromatic
    // variation only, so the material samples no normal map and no height bump.
    metalness: 0.0,
    // The pipeline's flat matte roughness map is the whole response (no grain
    // modulation); factor 1.0 → effective ≈ the map mean.
    roughness: 1.0,
    // NO normal map (rev 9): normalScale stays explicit as [0, 0] so QA can
    // prove the chromatic-albedo-only grain wiring.
    normalScale: Object.freeze([0, 0]),
    aoMapIntensity: 0.95,
    envMapIntensity: 0.48,
    // No bump: surface geometry must not create the grain (rev 9).
    bumpScale: 0.0,
    color: Object.freeze([1.0, 1.0, 1.0]),
  }),
  satin: Object.freeze({
    // Effective metalness = 1.0 × metalness map (flat mean 0.85) => ≈ 0.85.
    metalness: 1.0,
    // Rev 6 reflection behaviour kept: roughness factor 0.80 over the flat 0.30
    // map => effective ≈ 0.24 (SPEC band 0.20-0.28).  The previewer's PMREM
    // scene-capture envMap blurs through its mip chain into soft reflection
    // blobs instead of a razor-sharp mirror.
    roughness: 0.8,
    // Rev 9: the rev-7/8 normal grain is REMOVED.  The satin is the smooth
    // neutral-grey reference surface; its sheen comes from the (unchanged)
    // blurred mirror reflection + the albedo tonal gradient, not from a normal
    // map.  normalScale is kept explicit as [0, 0] for QA.
    normalScale: Object.freeze([0, 0]),
    aoMapIntensity: 0.85,
    // Rev 6: the previewer assigns a dedicated PMREM scene-capture envMap to
    // the satin material (scene.environment still serves limestone).
    // 2.4 sits mid-band (2.0-2.8) so the reflected warm/cool accent blobs are
    // clearly visible but the satin stays cool grey, not blown out.
    envMapIntensity: 2.4,
    // No bump: the shading is not perturbed (rev 9 grain removal).
    bumpScale: 0.0,
    color: Object.freeze([1.0, 1.0, 1.0]),
  }),
});

/** `quality` may only reduce shadow/segment settings — never the 27 boxes or
 *  their exact dimensions (SPEC §5). */
const QUALITY_LEVELS = Object.freeze({
  hero: Object.freeze({ castShadow: true, receiveShadow: true }),
  preview: Object.freeze({ castShadow: false, receiveShadow: true }),
});

/* ------------------------------------------------------------------------- */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------- */

function fail(message) {
  throw new Error('columns-model: ' + message);
}

function describeValue(value) {
  if (typeof value === 'string') return '"' + value + '"';
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function abortError(phase) {
  const error = new Error('columns-model: load aborted' + (phase ? ' (' + phase + ')' : ''));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal, phase) {
  if (signal && signal.aborted) throw abortError(phase);
}

function reportProgress(onProgress, loaded, total) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(loaded, total);
  } catch (error) {
    /* a broken UI callback must not fail the load */
  }
}

function resolveAssetBase(assetBase) {
  const raw = typeof assetBase === 'string' && assetBase.trim() ? assetBase.trim() : DEFAULT_ASSET_BASE;
  let url;
  try {
    const fallback = typeof document !== 'undefined' && document.baseURI ? document.baseURI : import.meta.url;
    url = new URL(raw, fallback);
  } catch (error) {
    fail('invalid assetBase ' + describeValue(assetBase));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:' && url.protocol !== 'blob:') {
    fail('unsupported assetBase protocol "' + url.protocol + '" (expected a same-origin relative path)');
  }
  const href = url.href;
  return href.endsWith('/') ? href : href + '/';
}

/**
 * Resolve a manifest-declared channel file against the asset base, rejecting
 * absolute paths / URLs / escaping `..` segments (the model only ever loads
 * relative local files, SPEC §5).
 */
function resolveAssetFile(baseUrl, file, context) {
  if (typeof file !== 'string' || !file.trim()) {
    fail(context + ': "file" must be a non-empty relative path');
  }
  const relative = file.trim().replace(/\\/g, '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative)) {
    fail(context + ': file ' + describeValue(relative) + ' must be a local relative path (URLs are not allowed)');
  }
  if (relative.startsWith('/')) {
    fail(context + ': file ' + describeValue(relative) + ' must be relative to the material asset directory');
  }
  if (relative.split('/').includes('..')) {
    fail(context + ': file ' + describeValue(relative) + ' may not escape the material asset directory');
  }
  try {
    return new URL(relative, baseUrl).href;
  } catch (error) {
    fail(context + ': file ' + describeValue(relative) + ' is not a valid relative path');
  }
}

/* ------------------------------------------------------------------------- */
/* Geometry: one rounded box per column, per-face UV density baked in           */
/* ------------------------------------------------------------------------- */

/**
 * Planar UV mapping per box face.  Each face's U/V axes are chosen so that
 * cross(dU, dV) points along the outward normal (right-handed — normal maps
 * stay correct) and so that the grain wraps continuously around the vertical
 * box corners.  `uExtent`/`vExtent` are the face dimensions in world px.
 */
function columnFacePlan(spec) {
  // SPEC rev 5: no material uses the rev4 metal vertical-grain rotation, so every
  // face uses the same world-axis-aligned planar mapping.
  return [
    { face: 'px', axis: 'x', sign: 1, uExtent: spec.depth, vExtent: spec.heightPx },
    { face: 'nx', axis: 'x', sign: -1, uExtent: spec.depth, vExtent: spec.heightPx },
    { face: 'py', axis: 'y', sign: 1, uExtent: spec.width, vExtent: spec.depth },
    { face: 'ny', axis: 'y', sign: -1, uExtent: spec.width, vExtent: spec.depth },
    { face: 'pz', axis: 'z', sign: 1, uExtent: spec.width, vExtent: spec.heightPx },
    { face: 'nz', axis: 'z', sign: -1, uExtent: spec.width, vExtent: spec.heightPx },
  ];
}

/**
 * Build the per-column geometry with baked per-face UV density (SPEC §5) and
 * revision-9 rounded edges.
 *
 * Revision 9 replaces the 24-vertex `THREE.BoxGeometry` with an analytic
 * sphere-swept rounded box from `./columns-rounded-geometry.js`: 6 flat face
 * quads at ±half, 12 quarter-cylinder bevel strips and 8 spherical corner
 * octants, with the SAME overall width × heightPx × depth bounding box (the
 * sphere sweep is inside the original box envelope; nothing is scaled at
 * runtime).  The bevel radius is mapped from the footprint size class
 * (`COLUMN_METRICS.cornerRadiusPx`: large 140 px → 10, medium 80 px → 5,
 * small/short 40 px → 3) and the bevel uses `COLUMN_METRICS.bevelSegments` (6)
 * segments per 90° arc.
 *
 * UVs are baked into the geometry by the rounded-box builder with the existing
 * world-scale planar mapping: one texture tile covers `effectiveTilePx =
 * manifest.tilePx × UV_DENSITY_SCALE` world px of surface:
 *
 *   +X: u = -z / tilePx, v =  y / tilePx      -X: u =  z / tilePx, v = y / tilePx
 *   +Y: u =  x / tilePx, v = -z / tilePx      -Y: u =  x / tilePx, v = z / tilePx
 *   +Z: u =  x / tilePx, v =  y / tilePx      -Z: u = -x / tilePx, v = y / tilePx
 *
 * Bevel/corner vertices use the dominant |normal| axis formula, so the UVs are
 * exact on the flat faces and continuous into the bevels (the only seam is a
 * harmless 45° mid-bevel line, invisible under the albedo/noise textures).  The
 * same UVs are duplicated into `uv2` as the explicit AO UV set (three r151
 * samples aoMap from uv2 when the texture channel is 1).
 *
 * @param {object} spec frozen column spec
 * @param {number} manifestTilePx manifest tilePx for the material (world px per
 *        tile at 1:1); the baked density uses manifestTilePx × UV_DENSITY_SCALE
 * @returns {THREE.BufferGeometry}
 */
function buildColumnGeometry(spec, manifestTilePx) {
  const effectiveTilePx = manifestTilePx * UV_DENSITY_SCALE;
  const cornerRadius = COLUMN_METRICS.cornerRadiusPx[spec.footprint];
  const geometry = createRoundedColumnGeometry({
    width: spec.width,
    height: spec.heightPx,
    depth: spec.depth,
    radius: cornerRadius,
    bevelSegments: COLUMN_METRICS.bevelSegments,
    tilePx: effectiveTilePx,
  });
  const uv = geometry.getAttribute('uv');
  const uv2 = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i += 1) {
    uv2[i * 2] = uv.getX(i);
    uv2[i * 2 + 1] = uv.getY(i);
  }
  geometry.setAttribute('uv2', new THREE.BufferAttribute(uv2, 2));

  const faces = columnFacePlan(spec).map((face) =>
    Object.freeze({
      face: face.face,
      axis: face.axis,
      uExtent: face.uExtent,
      vExtent: face.vExtent,
      uRepeat: face.uExtent / effectiveTilePx,
      vRepeat: face.vExtent / effectiveTilePx,
    }),
  );
  const builderData = geometry.userData && typeof geometry.userData === 'object' ? geometry.userData : {};
  const usedRadius = Number.isFinite(builderData.cornerRadius) ? builderData.cornerRadius : cornerRadius;
  const usedSegments = Number.isFinite(builderData.bevelSegments) ? builderData.bevelSegments : COLUMN_METRICS.bevelSegments;
  geometry.userData = Object.freeze({
    columnId: spec.id,
    tilePx: manifestTilePx,
    uvDensityScale: UV_DENSITY_SCALE,
    effectiveTilePx,
    uvMode: 'per-face world-scale planar mapping (right-handed, world-axis aligned) on a rounded box; density = extent / (tilePx × uvDensityScale)',
    grainOrientation: 'horizontal: world-axis-aligned planar mapping (no vertical-grain rotation in rev 5+)',
    // Revision 9 rounded edges (source px; 1 px = 1 world unit).
    roundedBox: true,
    cornerRadius: usedRadius,
    bevelSegments: usedSegments,
    faces: Object.freeze(faces),
  });
  geometry.name = 'geometry:column:' + spec.id;
  return geometry;
}

/* ------------------------------------------------------------------------- */
/* Manifest validation + texture loading                                     */
/* ------------------------------------------------------------------------- */

async function fetchManifestJson(manifestUrl, signal) {
  if (typeof fetch !== 'function') {
    fail('this environment has no fetch(); loadColumnBank must run in the browser preview page');
  }
  let response;
  try {
    response = await fetch(manifestUrl, { cache: 'no-store', signal });
  } catch (error) {
    if (error && error.name === 'AbortError') throw abortError('manifest');
    fail(
      'could not fetch material manifest "' +
        manifestUrl +
        '" (' +
        (error && error.message ? error.message : String(error)) +
        ') — generate it with "py tools/prepare-material-assets.py"',
    );
  }
  if (!response.ok) {
    fail(
      'material manifest "' +
        manifestUrl +
        '" returned HTTP ' +
        response.status +
        ' ' +
        (response.statusText || '') +
        ' — generate it with "py tools/prepare-material-assets.py"',
    );
  }
  let json;
  try {
    json = await response.json();
  } catch (error) {
    fail('material manifest "' + manifestUrl + '" is not valid JSON (' + (error && error.message ? error.message : String(error)) + ')');
  }
  return json;
}

/**
 * Validate the SPEC §2 manifest shape and normalise it into a load plan.
 * Every failure is a descriptive Error naming the material, channel and file.
 * @param {object} raw parsed manifest JSON
 * @param {string} manifestUrl URL used for error messages
 * @param {string} baseUrl asset directory URL (trailing slash)
 * @returns {{raw:object, materials:Array<object>}}
 */
function validateManifest(raw, manifestUrl, baseUrl) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('material manifest "' + manifestUrl + '" must contain a JSON object');
  }
  if (Number(raw.version) !== 1) {
    fail(
      'material manifest "' + manifestUrl + '" has version ' +
        describeValue(raw.version) + ', expected 1 (SPEC-columns §2)',
    );
  }
  if (!raw.materials || typeof raw.materials !== 'object' || Array.isArray(raw.materials)) {
    fail('material manifest "' + manifestUrl + '" is missing the "materials" object');
  }

  const materials = [];
  for (const material of MATERIALS) {
    const entry = raw.materials[material.id];
    const context = 'material "' + material.id + '"';
    if (!entry || typeof entry !== 'object') {
      fail('material manifest "' + manifestUrl + '" is missing ' + context + ' (expected plaster, limestone and satin)');
    }
    const tilePx = Number(entry.tilePx);
    if (!Number.isFinite(tilePx) || tilePx < 32 || tilePx > 4096) {
      fail(
        'manifest ' + context + ' has invalid tilePx ' + describeValue(entry.tilePx) +
          ' (expected a finite number of world px per texture tile, SPEC-columns §2)',
      );
    }
    const normalConvention = String(entry.normalConvention === undefined ? '' : entry.normalConvention).toLowerCase();
    if (normalConvention !== 'opengl') {
      fail(
        'manifest ' + context + ' declares normalConvention ' + describeValue(entry.normalConvention) +
          '; the model requires tangent-space OpenGL normals (green = +Y up, SPEC-columns §2)',
      );
    }
    if (!entry.channels || typeof entry.channels !== 'object') {
      fail('manifest ' + context + ' is missing the "channels" object');
    }

    const channels = {};
    for (const channelId of MAP_CHANNELS) {
      const rule = CHANNEL_RULES[channelId];
      const declared = entry.channels[channelId];
      const channelContext = context + ' channel "' + channelId + '"';
      if (!declared) {
        if (rule.required) {
          fail('manifest ' + context + ' is missing required channel "' + channelId + '" (SPEC-columns §2)');
        }
        continue;
      }
      if (typeof declared !== 'object') {
        fail(channelContext + ' must be an object with file/width/height/colorSpace');
      }
      const width = Number(declared.width);
      const height = Number(declared.height);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        fail(channelContext + ' must declare integer width/height (got ' + describeValue(declared.width) + '×' + describeValue(declared.height) + ')');
      }
      if (width !== rule.size || height !== rule.size) {
        fail(
          channelContext + ' declares ' + width + '×' + height + ' px but SPEC-columns §2 requires ' +
            rule.size + '×' + rule.size + ' px',
        );
      }
      const file = declared.file;
      const url = resolveAssetFile(baseUrl, file, channelContext);
      let colorSpace = String(declared.colorSpace === undefined ? rule.colorSpace : declared.colorSpace).toLowerCase();
      if (colorSpace === 'srgb-linear' || colorSpace === 'none') colorSpace = 'linear';
      if (rule.colorSpace === 'srgb' && colorSpace !== 'srgb') {
        fail(channelContext + ' must be declared "srgb" (albedo is a colour map), got ' + describeValue(declared.colorSpace));
      }
      if (rule.colorSpace === 'linear' && colorSpace !== 'linear') {
        fail(channelContext + ' must be declared "linear" (data map), got ' + describeValue(declared.colorSpace));
      }
      channels[channelId] = Object.freeze({
        id: channelId,
        file: typeof file === 'string' ? file.trim() : '',
        url,
        width,
        height,
        colorSpace,
        source: typeof declared.source === 'string' ? declared.source : 'unknown',
        from: typeof declared.from === 'string' ? declared.from : '',
      });
    }

    const overrides = entry.params && typeof entry.params === 'object' ? entry.params : null;
    const tuning = mergeMaterialTuning(material, overrides);
    materials.push(
      Object.freeze({
        id: material.id,
        label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : material.label,
        tilePx,
        normalConvention,
        channels: Object.freeze(channels),
        tuning,
      }),
    );
  }
  return { raw, materials };
}

/**
 * Merge the model's authored tuning defaults with an optional manifest
 * `params` block (the asset pipeline may publish measured values).  Anything
 * malformed is a descriptive Error.
 */
function mergeMaterialTuning(material, overrides) {
  const defaults = MATERIAL_TUNING[material.id];
  const tuning = {
    metalness: defaults.metalness,
    roughness: defaults.roughness,
    normalScale: [defaults.normalScale[0], defaults.normalScale[1]],
    aoMapIntensity: defaults.aoMapIntensity,
    envMapIntensity: defaults.envMapIntensity,
    bumpScale: defaults.bumpScale,
    color: [defaults.color[0], defaults.color[1], defaults.color[2]],
  };
  if (!overrides) return Object.freeze(tuning);
  const numericKeys = ['metalness', 'roughness', 'aoMapIntensity', 'envMapIntensity', 'bumpScale'];
  for (const key of numericKeys) {
    if (overrides[key] === undefined) continue;
    const value = Number(overrides[key]);
    if (!Number.isFinite(value) || value < 0) {
      fail('manifest material "' + material.id + '" params.' + key + ' must be a finite non-negative number (got ' + describeValue(overrides[key]) + ')');
    }
    tuning[key] = value;
  }
  if (overrides.normalScale !== undefined) {
    const raw = Array.isArray(overrides.normalScale) ? overrides.normalScale : [overrides.normalScale, overrides.normalScale];
    if (raw.length !== 2 || !Number.isFinite(Number(raw[0])) || !Number.isFinite(Number(raw[1]))) {
      fail('manifest material "' + material.id + '" params.normalScale must be a number or [x, y]');
    }
    tuning.normalScale = [Number(raw[0]), Number(raw[1])];
  }
  if (overrides.color !== undefined) {
    const raw = overrides.color;
    if (Array.isArray(raw) && raw.length === 3 && raw.every((value) => Number.isFinite(Number(value)))) {
      // [r, g, b] in the material colour space (0..1, values may exceed 1 for
      // intentionally brighter steel); used verbatim as THREE.Color.setRGB().
      tuning.color = [Number(raw[0]), Number(raw[1]), Number(raw[2])];
    } else {
      const color = new THREE.Color();
      try {
        color.set(raw);
      } catch (error) {
        fail('manifest material "' + material.id + '" params.color is not a valid colour (' + describeValue(raw) + ')');
      }
      tuning.color = [color.r, color.g, color.b];
    }
  }
  return Object.freeze(tuning);
}

/** Decode one PNG into an <img> element (browser only). */
function loadImage(url, label) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('columns-model: loadColumnBank requires a browser environment (Image API unavailable)'));
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      reject(new Error('columns-model: failed to load ' + label + ' — "' + url + '" (missing, unreadable or not a decodable image)'));
    };
    image.src = url;
  });
}

/**
 * Wrap a decoded image in a repeating THREE.Texture configured from the
 * manifest channel (SPEC §5): RepeatWrapping, anisotropy 8, sRGB albedo,
 * linear data maps, explicit UV2 channel for the AO map.
 */
function createChannelTexture(image, material, channel) {
  const srgb = channel.colorSpace === 'srgb';
  const texture = new THREE.Texture(image);
  texture.name = 'column-map:' + material.id + ':' + channel.id;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  texture.flipY = true;
  // three r151 colour management is driven by Texture.encoding (sRGBEncoding =
  // colour map, LinearEncoding = data map).  The r152+ texture.colorSpace API
  // named in SPEC §5 is applied as well when the build exposes it.
  texture.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
  if ('colorSpace' in texture) {
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  }
  if (channel.id === 'ao') {
    // Explicit AO UV set: r151 samples aoMap from uv2 when channel === 1.
    texture.channel = 1;
  }
  texture.userData = Object.freeze({
    materialId: material.id,
    channel: channel.id,
    file: channel.file,
    width: channel.width,
    height: channel.height,
    colorSpace: channel.colorSpace,
    source: channel.source,
  });
  texture.needsUpdate = true;
  return texture;
}

/**
 * Load the material bank: manifest + the 18 derived PBR maps.
 *
 * @param {object} [options]
 * @param {string} [options.assetBase='./assets/textures/materials'] asset directory
 * @param {(loaded:number,total:number)=>void} [options.onProgress] progress
 *        callback; total = manifest + every channel file (19 when the optional
 *        height maps are present), first call is (1, total) once the manifest
 *        has been validated, then one call per decoded texture.
 * @param {AbortSignal} [options.signal] optional abort signal
 * @returns {Promise<{
 *   manifest:object,
 *   textures:Readonly<Record<string, Readonly<Record<string, THREE.Texture>>>>,
 *   materials:Readonly<Record<string, THREE.Material>>,
 *   tilePx:Readonly<Record<string, number>>,
 *   assetCount:number, textureCount:number, version:string,
 *   dispose:()=>void
 * }>}
 */
export async function loadColumnBank({ assetBase = DEFAULT_ASSET_BASE, onProgress = () => {}, signal } = {}) {
  const baseUrl = resolveAssetBase(assetBase);
  const manifestUrl = baseUrl + 'manifest.json';
  throwIfAborted(signal, 'before manifest');

  const rawManifest = await fetchManifestJson(manifestUrl, signal);
  const plan = validateManifest(rawManifest, manifestUrl, baseUrl);
  throwIfAborted(signal, 'after manifest');

  const jobs = [];
  for (const material of plan.materials) {
    for (const channelId of MAP_CHANNELS) {
      const channel = material.channels[channelId];
      if (channel) jobs.push({ material, channel });
    }
  }
  const total = 1 + jobs.length;
  let loaded = 1;
  reportProgress(onProgress, loaded, total);

  const results = await Promise.allSettled(
    jobs.map(async ({ material, channel }) => {
      throwIfAborted(signal, 'loading ' + material.id + '/' + channel.id);
      const label = 'material "' + material.id + '" channel "' + channel.id + '"';
      const image = await loadImage(channel.url, label);
      if (signal && signal.aborted) throw abortError('loading ' + material.id + '/' + channel.id);
      if (image.naturalWidth !== channel.width || image.naturalHeight !== channel.height) {
        fail(
          'texture for ' + label + ' decoded ' + image.naturalWidth + '×' + image.naturalHeight +
            ' but the manifest declares ' + channel.width + '×' + channel.height + ' — "' + channel.url + '"',
        );
      }
      const texture = createChannelTexture(image, material, channel);
      loaded += 1;
      reportProgress(onProgress, loaded, total);
      return { material, channel, texture };
    }),
  );

  const failed = results.find((result) => result.status === 'rejected');
  if (failed) {
    for (const result of results) {
      if (result.status === 'fulfilled') result.value.texture.dispose();
    }
    throw failed.reason;
  }
  throwIfAborted(signal, 'after textures');

  const texturesByMaterial = {};
  for (const material of MATERIALS) texturesByMaterial[material.id] = {};
  for (const result of results) {
    const { material, channel, texture } = result.value;
    texturesByMaterial[material.id][channel.id] = texture;
  }
  for (const material of MATERIALS) {
    texturesByMaterial[material.id] = Object.freeze(texturesByMaterial[material.id]);
  }

  const materials = {};
  for (const material of plan.materials) {
    const manifestEntry = rawManifest.materials && rawManifest.materials[material.id]
      ? rawManifest.materials[material.id] : null;
    materials[material.id] = createMaterial(material, texturesByMaterial[material.id], {
      manifestEntry,
    });
  }

  const tilePx = {};
  for (const material of plan.materials) tilePx[material.id] = material.tilePx;

  const allTextures = [];
  for (const material of MATERIALS) {
    for (const channelId of MAP_CHANNELS) {
      const texture = texturesByMaterial[material.id][channelId];
      if (texture) allTextures.push(texture);
    }
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const texture of allTextures) texture.dispose();
    for (const material of Object.values(materials)) material.dispose();
  };

  return {
    version: MODEL_VERSION,
    manifest: rawManifest,
    textures: Object.freeze(texturesByMaterial),
    materials: Object.freeze(materials),
    tilePx: Object.freeze(tilePx),
    // Rev 8: no procedural liquid normal / flow controller is exposed any more;
    // the plaster mirror is a flat, clean, static surface.
    assetCount: total,
    textureCount: jobs.length,
    dispose,
  };
}

/**
 * One shared MeshStandardMaterial per material group, configured from the
 * validated manifest + tuning (SPEC §5).  The material carries its tuning and
 * map provenance in `userData` for QA / debugging.
 *
 * Revision 9 surface wiring:
 *   - NO material samples a normal map (normalScale [0, 0], normalMap null):
 *     plaster must be perfectly smooth, limestone's dark-stone grain is carried
 *     by per-point albedo colour noise only, and satin is the smooth neutral-grey
 *     reference surface.  The normal/height files still load into `bank.textures`
 *     for provenance/QA but are not sampled.
 *   - Plaster additionally samples no roughnessMap/metalnessMap; it keeps its
 *     constant conductor wiring (metalness 1.0, roughness 0.092) and the flat
 *     albedo/AO maps, so the reflective kit is untouched.
 *   - Limestone and satin keep albedo + AO + a flat roughness map + a flat
 *     metalness map; limestone has bumpScale 0 (no height map), satin likewise.
 */
function createMaterial(materialPlan, textures, extras = {}) {
  const tuning = materialPlan.tuning;
  const isPlaster = materialPlan.id === 'plaster';
  const heightTexture = textures.height || null;
  // Rev 9: no normal map is sampled by any material.
  const normalTexture = null;
  // Plaster samples no roughness / metalness map (constant conductor); limestone
  // and satin sample their flat 0.30 / 0.92 roughness and 0.85 / 0 metalness maps.
  const roughnessTexture = isPlaster ? null : textures.roughness || null;
  const metalnessTexture = isPlaster ? null : textures.metalness || null;
  const parameters = {
    name: 'column-material:' + materialPlan.id,
    color: new THREE.Color().setRGB(tuning.color[0], tuning.color[1], tuning.color[2]),
    map: textures.albedo || null,
    normalMap: normalTexture,
    normalScale: new THREE.Vector2(tuning.normalScale[0], tuning.normalScale[1]),
    roughnessMap: roughnessTexture,
    roughness: tuning.roughness,
    // Rev 7/8: plaster's constant metalness 1.0 replaces the all-zero derived
    // map; limestone/satin keep their metalness maps exactly as accepted in
    // rev 5/6.
    metalnessMap: metalnessTexture,
    metalness: tuning.metalness,
    aoMap: textures.ao || null,
    aoMapIntensity: tuning.aoMapIntensity,
    envMapIntensity: tuning.envMapIntensity,
    dithering: true,
    fog: true,
  };
  const bumpTexture = heightTexture && tuning.bumpScale > 0 ? heightTexture : null;
  if (bumpTexture) {
    parameters.bumpMap = bumpTexture;
    parameters.bumpScale = tuning.bumpScale;
  }
  const material = new THREE.MeshStandardMaterial(parameters);
  // Effective factors from the manifest's published map means (the model's
  // factors are multipliers, so this is what QA measures on screen).
  const entry = extras.manifestEntry && typeof extras.manifestEntry === 'object' ? extras.manifestEntry : null;
  const channelMean = (channel) => {
    const value = entry && entry.channels && entry.channels[channel]
      ? Number(entry.channels[channel].deployedMean) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  const roughnessMapMean = channelMean('roughness');
  const metalnessMapMean = channelMean('metalness');
  // Rev 8/9: plaster does not sample its roughness map, so its effective
  // roughness is simply the authored constant (0.092); for limestone/satin this
  // stays the published map mean × the tuning factor (what QA measures on screen).
  const roughnessEffective = isPlaster
    ? tuning.roughness
    : roughnessMapMean === null ? null : roughnessMapMean * tuning.roughness;
  const metalnessEffective = isPlaster ? 1.0
    : metalnessMapMean === null ? null : metalnessMapMean * tuning.metalness;
  material.userData = {
    materialId: materialPlan.id,
    label: materialPlan.label,
    tilePx: materialPlan.tilePx,
    normalConvention: materialPlan.normalConvention,
    tuning,
    maps: {
      albedo: Boolean(textures.albedo),
      // Rev 9: no material samples a normal map (the channel files still load
      // into bank.textures; these flags report the SAMPLED wiring, the QA proof
      // that limestone's grain is albedo-only and the plaster/satin are smooth).
      normal: Boolean(normalTexture),
      roughness: Boolean(roughnessTexture),
      metalness: Boolean(metalnessTexture),
      ao: Boolean(textures.ao),
      height: Boolean(bumpTexture),
    },
    params: {
      metalness: tuning.metalness,
      metalnessEffective,
      roughness: tuning.roughness,
      roughnessMapMean,
      roughnessEffective,
      normalMapSampled: Boolean(normalTexture),
      roughnessMapSampled: Boolean(roughnessTexture),
      normalScale: [tuning.normalScale[0], tuning.normalScale[1]],
      aoMapIntensity: tuning.aoMapIntensity,
      envMapIntensity: tuning.envMapIntensity,
      bumpScale: tuning.bumpScale,
      color: [tuning.color[0], tuning.color[1], tuning.color[2]],
    },
    // Rev 9: where the visible surface detail comes from, per material.
    grainMode: isPlaster
      ? 'none (perfectly smooth flat liquid-metal mirror, rev 9)'
      : materialPlan.id === 'limestone'
        ? 'albedo chromatic colour noise only (rev 9; no normal map / bump geometry)'
        : 'none (smooth neutral-grey satin: tonal albedo gradient + blurred mirror reflection, rev 9)',
    mapUsage: isPlaster
      ? {
        albedo: 'map (flat calibrated colour, no grain)',
        normal: 'not sampled (perfectly smooth mirror, rev 9)',
        roughness: 'not sampled - constant roughness 0.092 (perfectly smooth mirror, rev 9)',
        metalness: 'constant 1.0 (the derived metalness map is 0 and not sampled)',
        ao: 'aoMap (flat)',
        height: 'not sampled (perfectly smooth mirror, no bump, rev 9)',
      }
      : materialPlan.id === 'limestone'
        ? {
          albedo: 'map (dark-stone chromatic grain)',
          normal: 'not sampled (grain is albedo colour noise only, rev 9)',
          roughness: 'roughnessMap (flat matte, no grain modulation)',
          metalness: 'metalnessMap (flat 0)',
          ao: 'aoMap (flat)',
          height: 'not sampled (no bump; grain is albedo colour noise, rev 9)',
        }
        : {
          albedo: 'map (smooth neutral-grey tonal gradient)',
          normal: 'not sampled (smooth satin, rev 9)',
          roughness: 'roughnessMap (flat 0.30, rev-6 blurred mirror response)',
          metalness: 'metalnessMap (flat 0.85)',
          ao: 'aoMap (flat)',
          height: 'not sampled (no bump; smooth satin, rev 9)',
        },
    // Rev 8: the liquid-flow normal was removed; the key stays (null) so older
    // QA readers that probe `liquidNormal` keep working.
    liquidNormal: null,
    uvStrategy: 'per-face world-scale UV: one texture tile = tilePx world px on every face',
  };
  return material;
}

/* ------------------------------------------------------------------------- */
/* Scene assembly (synchronous)                                              */
/* ------------------------------------------------------------------------- */

function readTilePxMap(bank) {
  const tilePx = {};
  const manifest = bank && bank.manifest && typeof bank.manifest === 'object' ? bank.manifest : null;
  for (const material of MATERIALS) {
    let value = NaN;
    if (bank && bank.tilePx && bank.tilePx[material.id] !== undefined) {
      value = Number(bank.tilePx[material.id]);
    } else if (manifest && manifest.materials && manifest.materials[material.id]) {
      value = Number(manifest.materials[material.id].tilePx);
    }
    if (!Number.isFinite(value) || value <= 0) {
      fail(
        'createColumns(bank): missing tilePx for material "' + material.id +
          '" — pass the bank resolved by loadColumnBank()',
      );
    }
    tilePx[material.id] = value;
  }
  return Object.freeze(tilePx);
}

/**
 * Instantiate the 27-column scene graph from a loaded bank (synchronous).
 *
 * @param {object} bank object resolved by loadColumnBank()
 * @param {{quality?:'hero'|'preview'}} [options] quality only reduces shadow
 *        settings — the 27 boxes and their exact dimensions never change.
 * @returns {{
 *   group: THREE.Group,
 *   columns: Array<{spec:object, mesh:THREE.Mesh, material:THREE.Material}>,
 *   columnsById: Readonly<Record<string, object>>,
 *   materials: Readonly<Record<string, THREE.Material>>,
 *   bounds: Readonly<object>,
 *   meshBounds: THREE.Box3,
 *   tilePx: Readonly<Record<string, number>>,            // manifest base tilePx
 *   effectiveTilePx: Readonly<Record<string, number>>,   // tilePx × uvDensityScale (baked)
 *   uvDensityScale: number,                              // 1.30 (SPEC rev 4)
 *   quality: string,
 *   dispose: () => void
 * }}
 */
export function createColumns(bank, { quality = 'hero' } = {}) {
  const qualityLevel = QUALITY_LEVELS[quality];
  if (!qualityLevel) {
    fail('unknown quality ' + describeValue(quality) + '; expected one of: ' + Object.keys(QUALITY_LEVELS).join(', '));
  }
  if (!bank || typeof bank !== 'object') {
    fail('createColumns(bank, options): bank is required — pass the object resolved by loadColumnBank()');
  }
  const bankMaterials = bank.materials;
  if (!bankMaterials || typeof bankMaterials !== 'object') {
    fail('createColumns(bank, options): bank.materials is missing — pass the object resolved by loadColumnBank()');
  }
  for (const material of MATERIALS) {
    const candidate = bankMaterials[material.id];
    if (!candidate) {
      fail('createColumns(bank, options): bank.materials["' + material.id + '"] is missing — the bank must contain all three material groups');
    }
    if (candidate.isMaterial !== true) {
      fail('createColumns(bank, options): bank.materials["' + material.id + '"] is not a THREE.Material');
    }
  }
  const tilePx = readTilePxMap(bank);
  const effectiveTilePx = Object.freeze(
    Object.fromEntries(MATERIALS.map((material) => [material.id, tilePx[material.id] * UV_DENSITY_SCALE])),
  );

  const group = new THREE.Group();
  group.name = 'column-bank';
  const columns = [];
  const columnsById = {};
  const geometries = [];
  for (const spec of COLUMN_SPECS) {
    const geometry = buildColumnGeometry(spec, tilePx[spec.material]);
    geometries.push(geometry);
    const material = bankMaterials[spec.material];
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'column:' + spec.id;
    mesh.position.set(spec.position.x, spec.position.y, spec.position.z);
    mesh.castShadow = qualityLevel.castShadow;
    mesh.receiveShadow = qualityLevel.receiveShadow;
    mesh.userData = {
      columnId: spec.id,
      material: spec.material,
      footprint: spec.footprint,
      height: spec.height,
      width: spec.width,
      depth: spec.depth,
      heightPx: spec.heightPx,
      // Revision 9 rounded edges: the bevel radius (source px) and arc segments
      // are mirrored here for QA without walking into geometry.userData.
      cornerRadius: geometry.userData.cornerRadius,
      bevelSegments: geometry.userData.bevelSegments,
      roundedBox: geometry.userData.roundedBox,
    };
    group.add(mesh);
    const column = { spec, mesh, material };
    columns.push(column);
    columnsById[spec.id] = column;
  }
  group.updateMatrixWorld(true);
  const meshBounds = new THREE.Box3().setFromObject(group);
  const bounds = COLUMN_METRICS.bounds;
  group.userData = {
    columnCount: COLUMN_SPECS.length,
    materialCount: MATERIALS.length,
    unit: COLUMN_METRICS.unit,
    uvDensityScale: UV_DENSITY_SCALE,
    layoutBounds: bounds,
    meshBounds,
  };

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    geometries.length = 0;
    group.clear();
  };

  return {
    group,
    columns,
    columnsById: Object.freeze(columnsById),
    materials: bankMaterials,
    bounds,
    meshBounds,
    tilePx,
    effectiveTilePx,
    uvDensityScale: UV_DENSITY_SCALE,
    quality,
    dispose,
  };
}
