/**
 * tekoanimation — Material Columns model  (SPEC-columns.md §3–§5).
 *
 * The model is 27 REAL long cuboids — one mesh per column (revision 9: an
 * analytic rounded box with 3 / 5 / 10 px bevels by footprint size class),
 * never instanced, never sprites, never rescaled:
 *
 *   3 material groups (plaster / reeded-metal / satin)   [SPEC rev 5]
 *   × 3 heights      (long 600 px / medium 550 px / short 500 px)   [SPEC rev 4]
 *   × 3 footprints   (large 140 px / medium 80 px / small 40 px)
 *   = 27 columns.
 *
 * Unit convention: 1 source pixel = 4 three.js world units (COLUMN_WORLD_SCALE).  Every dimension in
 * this file is therefore the literal pixel value from the source requirement;
 * geometry is authored at that scale and nothing is scaled at runtime.
 *
 * Layout (frozen, SPEC §4):
 *   - inside a group X = footprint axis: large -180, medium 0, small +180
 *   - inside a group Z = height axis:    long  -180, medium 0, short  +180
 *   - group centre X = (groupIndex - 1) * 700  (plaster, reeded-metal, satin)
 *   - column centre  = (groupCentreX + xOffset, heightPx / 2, zOffset)
 *   - real geometry bounds (mesh bbox): X [-950, 900], Z [-250, 250], Y [0, 600]
 *     => 1850 × 500 × 600, content centre (-25, 300, 0)  (SPEC rev 4)
 *     (`large` sits at local x = -180, so the envelope is asymmetric on X)
 *
 * Textures are never invented: every map comes from the material manifest that
 * tools/prepare-material-assets.py derives from the source images
 * (plaster.png / reeded-metal.png / satin.png).  One shared
 * MeshStandardMaterial per material group is configured from that manifest.
 * Reeded Metal samples albedo + normalMap + roughnessMap + metalnessMap + aoMap and
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
 * finer; reeded-metal is steel (rev 5 s32).  Geometry, footprints, heights, UVs and layout
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
 *   - Reeded Metal: the dark rough stone of the round-5 reference.  Its visible grain
 *     is carried ONLY by per-point chromatic variation in the albedo (colour
 *     noise), NOT by normal/bump/displacement geometry: no normalMap is sampled
 *     (normalScale [0, 0]) and bumpScale is 0.  The colour family stays the dark
 *     reeded-metal family and the roughness/metalness/AO maps stay flat and matte.  [Superseded in rev 5 s32: reeded-metal is polished/brushed steel sides plus a separate reeded top plate.]
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
export const MODEL_VERSION = '1.4.0';

/**
 * s48: ONE uniform world scale. Spec px (SPEC §3: 140/80/40 x 600/550/500) are
 * multiplied by this constant for every world-space quantity (footprints, heights,
 * gaps, offsets, bounds, corner radii, reeded plate, relief strength, camera). Page
 * labels keep showing spec px (= world / COLUMN_WORLD_SCALE). Texture tiles scale too,
 * so the pattern size relative to a column is unchanged; fidelity comes from texel
 * density, tessellation and the detail octave instead.
 * @type {number}
 */
export const COLUMN_WORLD_SCALE = 200;
const WS = COLUMN_WORLD_SCALE;

/**
 * s53: the world scale the fine PATTERN (texture tiles, detail octaves, reed pitch)
 * was authored at. Columns are 50x larger than at that scale (COLUMN_GEOMETRY_RATIO)
 * but the pattern keeps its physical size, i.e. it has 50x the feature density.
 * Other scenes (card scene s54, billing, logo-blocks) that shrink the column mesh by
 * `scale` reuse the pattern with `createColumns(bank, { patternDivisor })`:
 * divisor 1 = physical pattern (50x density, as on the columns page), divisor
 * COLUMN_GEOMETRY_RATIO = the pre-s53 look (pattern scales with the column).
 * @type {number}
 */
export const COLUMN_PATTERN_SCALE = 4;
/** s53: geometry / pattern-authoring scale ratio (= 50). */
export const COLUMN_GEOMETRY_RATIO = COLUMN_WORLD_SCALE / COLUMN_PATTERN_SCALE;

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
    { id: 'reeded-metal', label: 'Reeded Metal', sourceImage: 'reeded-metal.png' },
    { id: 'satin', label: 'Satin', sourceImage: 'satin.png' },
  ].map((material) => Object.freeze(material)),
);

/**
 * Rev19 (s46): three NEW procedural metal groups, generated in-model (no asset
 * files / manifest entries).  `MATERIALS` stays the 3 asset-backed groups
 * (backward compatible); `ALL_MATERIALS` = MATERIALS + these, in layout order.
 */
export const PROCEDURAL_MATERIALS = Object.freeze(
  [
    { id: 'grain-metal', label: 'Natural Grain Metal', sourceImage: null, procedural: true },
    { id: 'titanium', label: 'Titanium Alloy', sourceImage: null, procedural: true },
  ].map((material) => Object.freeze(material)),
);

/** All six material groups in layout order (X ascending). */
export const ALL_MATERIALS = Object.freeze([...MATERIALS, ...PROCEDURAL_MATERIALS]);

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
const FOOTPRINT_X_OFFSET = Object.freeze({ large: -180 * WS, medium: 0, small: 180 * WS });

/** Z offsets inside a group (height axis), SPEC §4. */
const HEIGHT_Z_OFFSET = Object.freeze({ long: -180 * WS, medium: 0, short: 180 * WS });

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
 * classes to the bevel radius in source px (s60: large 140 px → 2.8, medium 80 px → 1.6,
 * small 40 px → 1; 2 % of the footprint, minimum 1 px).  The brief's "small/short" is the small end of the size
 * range; a column's height class (long/medium/short) does NOT change its radius,
 * so the mapping is keyed purely by footprint.  `bevelSegments` is the number of
 * segments per 90° bevel arc (smooth at this scale).
 * @type {Readonly<object>}
 */
export const COLUMN_METRICS = Object.freeze({
  worldScale: WS,
  cell: 180 * WS,
  gap: 40 * WS,
  groupSpacing: 700 * WS,
  totalWidth: 3250 * WS,
  totalDepth: 500 * WS,
  maxHeight: 600 * WS,
  unit: 'world (spec px x worldScale)',
  uvDensityScale: UV_DENSITY_SCALE,
  groupOrder: Object.freeze(['plaster', 'reeded-metal', 'satin', 'grain-metal', 'titanium']),
  footprintXOffset: FOOTPRINT_X_OFFSET,
  heightZOffset: HEIGHT_Z_OFFSET,
  // Revision 9: rounded-column bevel radius by footprint size class (source px,
  // 1 px = COLUMN_WORLD_SCALE (200) world units).  The three radius values requested by the user:
  // s60: small = 1 px (minimum), medium = 1.6 px, large = 2.8 px (2 % of footprint width).
  cornerRadiusPx: Object.freeze({ large: 2.8 * WS, medium: 1.6 * WS, small: 1 * WS }),
  // Segments per 90° bevel arc (s60: tiny radii, 24 stays smooth and seam-free).
  bevelSegments: 24,
  bounds: Object.freeze({
    min: Object.freeze({ x: -1650 * WS, y: 0, z: -250 * WS }),
    max: Object.freeze({ x: 1600 * WS, y: 600 * WS, z: 250 * WS }),
    size: Object.freeze({ x: 3250 * WS, y: 600 * WS, z: 500 * WS }),
    center: Object.freeze({ x: -25 * WS, y: 300 * WS, z: 0 }),
  }),
});

/* ------------------------------------------------------------------------- */
/* Frozen column specs (27)                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Build the frozen 27-column spec table straight from the registries above.
 * Iteration order: material group (plaster, reeded-metal, satin) → footprint
 * (large, medium, small) → height (long, medium, short).
 * @returns {Array<object>}
 */
function createColumnSpecs() {
  const specs = [];
  ALL_MATERIALS.forEach((material, groupIndex) => {
    // Rev19: 6 groups centred on X = 0 (centres -1750 ... +1750, step 700).
    const groupCentreX = (groupIndex - (ALL_MATERIALS.length - 1) / 2) * COLUMN_METRICS.groupSpacing;
    for (const footprintKey of FOOTPRINT_ORDER) {
      const footprint = FOOTPRINTS[footprintKey];
      for (const heightKey of HEIGHT_ORDER) {
        const height = HEIGHTS[heightKey];
        const position = Object.freeze({
          x: groupCentreX + COLUMN_METRICS.footprintXOffset[footprintKey],
          y: (height.px * WS) / 2,
          z: COLUMN_METRICS.heightZOffset[heightKey],
        });
        specs.push(
          Object.freeze({
            id: material.id + '-' + footprintKey + '-' + heightKey,
            groupIndex,
            material: material.id,
            footprint: footprintKey,
            height: heightKey,
            width: footprint.px * WS,
            depth: footprint.px * WS,
            heightPx: height.px * WS,
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
 * e.g. `reeded-metal-small-long`.  `position` is the mesh centre (bottom face at
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
const TEXTURE_ANISOTROPY = 16; // s47: clamped by the GPU max (three clamps; preview sets renderer max)

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
 * are multipliers, bumpScale is in world px (1 px = COLUMN_WORLD_SCALE (200) world units).
 *
 * All three groups keep world-aligned UV grain (no vertical rotation in rev 5);
 * reeded-metal (rev 5 s32) is a constant conductor like plaster (metalness 1.0), while satin's effective metalness comes from its map (mean ≈ 0.85) and
 * rev 7/8 keep plaster as a constant metalness 1.0 liquid-metal mirror that is
 * FLAT AND CLEAN in rev 8.  Rev 9 removes the last micro-detail: the plaster
 * albedo/AO are flat, and reeded-metal/satin stop sampling their normal maps (the
 * reeded-metal grain is albedo colour noise; the satin is smooth).
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
  'reeded-metal': Object.freeze({
    // Rev 5 s32 (reeded metal column ref): polished / brushed steel SIDE faces.
    // Constant conductor (metalness 1.0, constant roughness 0.30, NO albedo /
    // roughness / metalness map sampling) so the sides read as bright steel
    // from the room env alone.  The thin reeded TOP PLATE is a separate mesh
    // per column with its own material (see createReededTopMaterial).
    metalness: 1.0,
    roughness: 0.3,
    normalScale: Object.freeze([0, 0]),
    aoMapIntensity: 0.9,
    envMapIntensity: 4.0,
    bumpScale: 0.0,
    // Steel F0 (linear reflectance of polished stainless).
    color: Object.freeze([0.78, 0.8, 0.84]),
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
    // the satin material (scene.environment still serves reeded-metal).
    // 2.4 sits mid-band (2.0-2.8) so the reflected warm/cool accent blobs are
    // clearly visible but the satin stays cool grey, not blown out.
    envMapIntensity: 2.4,
    // No bump: the shading is not perturbed (rev 9 grain removal).
    bumpScale: 0.0,
    color: Object.freeze([1.0, 1.0, 1.0]),
  }),
});

/* ------------------------------------------------------------------------- */
/* Rev19 (s46): procedural metal groups (natural grain / titanium)   */
/* ------------------------------------------------------------------------- */

/**
 * Albedo is carried in the generated sRGB map (baseLinear = LINEAR colour the
 * map is centred on); the material colour stays white and roughness is the
 * generated map (G) x 1.0.  Deterministic: integer-hash noise, no Math.random.
 */
const PROCEDURAL_TUNING = Object.freeze({
  'grain-metal': Object.freeze({
    kind: 'grain', baseLinear: Object.freeze([0.42, 0.42, 0.43]), roughness: 0.5, metalness: 1.0,
    normalScale: Object.freeze([0, 0]), envMapIntensity: 3.0,
    tilePx: 128, albedoAmp: 0.07, roughAmp: 0.07, seed: 0x6a09e667, coarse: 1.0,
  }),
  titanium: Object.freeze({
    kind: 'grain', baseLinear: Object.freeze([0.38, 0.37, 0.35]), roughness: 0.45, metalness: 1.0,
    normalScale: Object.freeze([0, 0]), envMapIntensity: 3.0,
    tilePx: 128, albedoAmp: 0.055, roughAmp: 0.015, seed: 0xbb67ae85, coarse: 1.1,
  }),
});

const PROC_SIZE = 2048; // s48: 4x texel density per axis (was 512); pattern per tile unchanged

function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise, `cells` lattice cells per tile, range -1..1. */
function valueNoise(x, y, cells, seed, size) {
  const fx = (x / size) * cells;
  const fy = (y / size) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  const g = (ix, iy) => hash2(((ix % cells) + cells) % cells, ((iy % cells) + cells) % cells, seed) * 2 - 1;
  const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
  const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** Periodic jittered-cell (Worley) field: crystallite tone id -1..1 and boundary proximity edge 0..1. */
function cellular(x, y, cells, seed, size) {
  const fx = (x / size) * cells;
  const fy = (y / size) * cells;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j += 1) {
    for (let i = -1; i <= 1; i += 1) {
      const nx = cx + i;
      const ny = cy + j;
      const wx = ((nx % cells) + cells) % cells;
      const wy = ((ny % cells) + cells) % cells;
      const px = nx + hash2(wx, wy, seed ^ 0x1234567);
      const py = ny + hash2(wx, wy, seed ^ 0x7654321);
      const d = Math.hypot(px - fx, py - fy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(wx, wy, seed ^ 0x55aa55aa) * 2 - 1;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return { id, edge: Math.max(0, 1 - (d2 - d1) * 3.2) };
}

const srgbEncode = (lin) => (lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055);

/**
 * Pure pixel generator for rows [y0,y1) (runs in a Worker, or time-sliced on
 * the main thread). Self-contained: toString()'d into the worker source.
 * grain: NATURAL irregular isotropic micro-grain, albedo + roughness only.
 */
function genProcRows(t, n, y0, y1, albedo, rough, normal) {
  const S = n / 512;
  const coarse = t.coarse || 1;
  const sd = t.seed || 0;
  const base = t.baseLinear;
  const enc = (lin) => (lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055);
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const o = (y * n + x) * 4;
      let lum = 1;
      let rg = t.roughness;
      let nx = 0;
      let ny = 0;
      {
        // s49: fine micro-grain. Dominant crystallite ~4.2x smaller (440 cells/tile, was 104), no large
        // octaves; low-freq mottling 24 cells at ~1/3 amplitude (was 7 cells).
        const cell = cellular(x, y, Math.round(440 / coarse), sd, n);
        const f1 = valueNoise(x, y, Math.round(680 / coarse), sd ^ 0x9e3779b1, n);
        const f2 = valueNoise(x, y, Math.round(256 / coarse), sd ^ 0x7f4a7c15, n);
        const mott = valueNoise(x, y, 24, sd ^ 0x2545f491, n);
        const speckN = valueNoise(x, y, Math.round(900 / coarse), sd ^ 0x68e31da4, n);
        const speck = Math.max(0, (speckN - 0.42) / 0.58);
        const L = 0.42 * cell.id + 0.3 * f1 + 0.22 * f2 + 0.05 * mott - 0.28 * cell.edge - 0.85 * speck;
        lum = 1 + t.albedoAmp * L;
        rg = t.roughness + t.roughAmp * (0.5 * cell.id + 0.4 * f1 + 0.1 * mott - 0.6 * speck);
      }
      for (let c = 0; c < 3; c += 1) {
        albedo[o + c] = Math.max(0, Math.min(255, Math.round(enc(Math.min(1, base[c] * lum)) * 255)));
      }
      albedo[o + 3] = 255;
      const rv = Math.max(0, Math.min(255, Math.round(rg * 255)));
      rough[o] = 255;
      rough[o + 1] = rv; // G = roughness
      rough[o + 2] = 255; // B = metalness (1)
      rough[o + 3] = 255;
      const len = Math.hypot(nx, ny, 1);
      normal[o] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
    }
  }
}

let procWorkerUrl = null;
function procWorkerSource() {
  return [hash2, valueNoise, cellular, genProcRows].map((f) => f.toString()).join('\n') +
    '\nself.onmessage=(e)=>{const {t,n}=e.data;const a=new Uint8Array(n*n*4),r=new Uint8Array(n*n*4),m=new Uint8Array(n*n*4);' +
    'genProcRows(t,n,0,n,a,r,m);self.postMessage({a,r,m},[a.buffer,r.buffer,m.buffer]);};';
}

/** Off-main-thread generation; falls back to ~12 ms time-sliced main-thread bands. */
function generateProcPixels(t, n) {
  const fallback = async () => {
    const a = new Uint8Array(n * n * 4);
    const r = new Uint8Array(n * n * 4);
    const m = new Uint8Array(n * n * 4);
    let y = 0;
    while (y < n) {
      const start = performance.now();
      while (y < n && performance.now() - start < 12) {
        genProcRows(t, n, y, Math.min(n, y + 2), a, r, m);
        y += 2;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { a, r, m };
  };
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return fallback();
  return new Promise((resolve) => {
    let worker;
    try {
      if (!procWorkerUrl) procWorkerUrl = URL.createObjectURL(new Blob([procWorkerSource()], { type: 'text/javascript' }));
      worker = new Worker(procWorkerUrl);
    } catch (err) {
      resolve(fallback());
      return;
    }
    worker.onmessage = (e) => { worker.terminate(); resolve(e.data); };
    worker.onerror = () => { worker.terminate(); resolve(fallback()); };
    worker.postMessage({ t: { ...t, baseLinear: Array.from(t.baseLinear) }, n });
  });
}

async function createProceduralTextures(id) {
  const t = PROCEDURAL_TUNING[id];
  const n = PROC_SIZE;
  const t0 = performance.now();
  const { a: albedo, r: rough, m: normal } = await generateProcPixels(t, n);
  const genMs = Math.round(performance.now() - t0);
  const make = (data, srgb, channel) => {
    const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.name = 'column-map:' + id + ':' + channel;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = TEXTURE_ANISOTROPY;
    texture.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
    if ('colorSpace' in texture) texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.userData = { materialId: id, channel, procedural: true, width: n, height: n, genMs };
    texture.needsUpdate = true;
    return texture;
  };
  const out = { albedo: make(albedo, true, 'albedo'), roughness: make(rough, false, 'roughness') };
  return out;
}


function createProceduralMaterial(material, textures) {
  const t = PROCEDURAL_TUNING[material.id];
  const m = new THREE.MeshStandardMaterial({
    name: 'column-material:' + material.id,
    color: new THREE.Color(1, 1, 1),
    map: textures.albedo,
    roughnessMap: textures.roughness,
    roughness: 1.0,
    metalnessMap: textures.roughness,
    metalness: t.metalness,
    normalMap: textures.normal || null,
    normalScale: new THREE.Vector2(t.normalScale[0], t.normalScale[1]),
    envMapIntensity: t.envMapIntensity,
    dithering: true,
    fog: true,
  });
  m.userData = {
    materialId: material.id,
    label: material.label,
    procedural: true,
    kind: t.kind,
    tilePx: t.tilePx,
    maps: { albedo: true, normal: Boolean(textures.normal), roughness: true, metalness: true, ao: false, height: false },
    params: {
      metalness: t.metalness,
      roughness: t.roughness,
      baseLinear: t.baseLinear.slice(),
      normalMapSampled: Boolean(textures.normal),
      normalScale: [t.normalScale[0], t.normalScale[1]],
      envMapIntensity: t.envMapIntensity,
    },
    grainMode:
      'natural irregular isotropic micro-grain (cellular crystallites + boundary flecks + dark specks + mottling): albedo + roughness only, no normal',
  };
  return m;
}

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
 * (`COLUMN_METRICS.cornerRadiusPx`: large 140 px → 2.8, medium 80 px → 1.6,
 * small 40 px → 1) and the bevel uses `COLUMN_METRICS.bevelSegments` (24; s60 radii 2.8/1.6/1)
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
/**
 * s47: seam-free surface sampling for the rounded column bodies.  The baked
 * dominant-axis planar UV has discontinuities along every 45 deg bevel line and
 * a Y-shaped triple junction in each corner octant.  Instead of the baked UV,
 * every map the body material samples (albedo, roughness, metalness, AO and the
 * normal map) is sampled triplanar from OBJECT-space position with the
 * same per-sign formulas and density as the baked UV (so flat faces get weight 1
 * and look identical), blended with weights |n|^TRIPLANAR_SHARPNESS.  The normal
 * map is reoriented per projection (slope blend, no tangent flip), which equals
 * three's tangent-space result exactly on flat faces.  No lights are added.
 */
const TRIPLANAR_SHARPNESS = 6;
const TRIPLANAR_VERT_DECL = `varying vec3 vTpPos;
varying vec3 vTpN;
varying vec3 vTpAX;
varying vec3 vTpAY;
varying vec3 vTpAZ;
`;
const TRIPLANAR_VERT_BODY = `vTpPos = position;
vTpN = normal;
vTpAX = mat3( normalMatrix ) * vec3( 1.0, 0.0, 0.0 );
vTpAY = mat3( normalMatrix ) * vec3( 0.0, 1.0, 0.0 );
vTpAZ = mat3( normalMatrix ) * vec3( 0.0, 0.0, 1.0 );`;
const TRIPLANAR_FRAG_DECL = `varying vec3 vTpPos;
varying vec3 vTpN;
varying vec3 vTpAX;
varying vec3 vTpAY;
varying vec3 vTpAZ;
uniform float tpInvTile;
vec3 tpWeights() {
	vec3 w = pow( abs( normalize( vTpN ) ), vec3( ${TRIPLANAR_SHARPNESS.toFixed(1)} ) );
	return w / max( w.x + w.y + w.z, 1e-5 );
}
vec2 tpUvX() { float s = vTpN.x >= 0.0 ? 1.0 : -1.0; return vec2( -s * vTpPos.z, vTpPos.y ) * tpInvTile; }
vec2 tpUvY() { float s = vTpN.y >= 0.0 ? 1.0 : -1.0; return vec2( vTpPos.x, -s * vTpPos.z ) * tpInvTile; }
vec2 tpUvZ() { float s = vTpN.z >= 0.0 ? 1.0 : -1.0; return vec2( s * vTpPos.x, vTpPos.y ) * tpInvTile; }
vec4 tpTex( sampler2D t ) {
	vec3 w = tpWeights();
	return texture2D( t, tpUvX() ) * w.x + texture2D( t, tpUvY() ) * w.y + texture2D( t, tpUvZ() ) * w.z;
}
`;
const TRIPLANAR_NORMAL_CHUNK = `#ifdef USE_NORMALMAP_TANGENTSPACE
	vec3 tpW = tpWeights();
	vec3 tpAX = normalize( vTpAX );
	vec3 tpAY = normalize( vTpAY );
	vec3 tpAZ = normalize( vTpAZ );
	float tpSx = vTpN.x >= 0.0 ? 1.0 : -1.0;
	float tpSy = vTpN.y >= 0.0 ? 1.0 : -1.0;
	float tpSz = vTpN.z >= 0.0 ? 1.0 : -1.0;
	vec3 tpMx = texture2D( normalMap, tpUvX() ).xyz * 2.0 - 1.0;
	vec3 tpMy = texture2D( normalMap, tpUvY() ).xyz * 2.0 - 1.0;
	vec3 tpMz = texture2D( normalMap, tpUvZ() ).xyz * 2.0 - 1.0;
	tpMx.xy *= normalScale;
	tpMy.xy *= normalScale;
	tpMz.xy *= normalScale;
	vec3 tpN = normal;
	tpN += tpW.x * ( tpMx.x * ( -tpSx * tpAZ ) + tpMx.y * tpAY ) / max( tpMx.z, 0.2 );
	tpN += tpW.y * ( tpMy.x * tpAX + tpMy.y * ( -tpSy * tpAZ ) ) / max( tpMy.z, 0.2 );
	tpN += tpW.z * ( tpMz.x * ( tpSz * tpAX ) + tpMz.y * tpAY ) / max( tpMz.z, 0.2 );
	normal = normalize( tpN );
#endif`;

/**
 * s48 rework: world-locked fine detail (3D gradient noise, analytic derivative, object
 * space so it is seamless over bevels), 3 octaves each faded by the screen-space
 * footprint (fwidth) so it only exists in close-ups; hero views are unchanged.
 * Per material: freq = cycles per world unit of the 3 octaves, stretch = scale of
 * the noise along object Y (column length; <1 = streaks), albedo/rough = amplitude,
 * slope = normal tilt per unit noise gradient.
 */
const DETAIL_TUNING = Object.freeze({
  // s48b: 4 octaves, finest visible ones land at ~3 px periods in face-filling close-ups; corner = extra roughness in the corner octants (kills the mirror 'bead')
  'plaster': Object.freeze({ freq: [1 / 5, 1 / 1.8, 1 / 0.9, 1 / 0.5], stretch: 1.0, albedo: 0.08, rough: 0.08, slope: 0, corner: 0.4, roughLow: 0, ridge: 0 }),
  'reeded-metal': Object.freeze({ freq: [1 / 5, 1 / 1.8, 1 / 0.85, 1 / 0.55], stretch: 0.03, albedo: 0.12, rough: 0.18, slope: 0, corner: 0.2, roughLow: 0.25, ridge: 0.7 }),
  'satin': Object.freeze({ freq: [1 / 5, 1 / 1.8, 1 / 0.85, 1 / 0.55], stretch: 0.03, albedo: 0.12, rough: 0.18, slope: 0, corner: 0.2, roughLow: 0.25, ridge: 0.7 }),
  'grain-metal': Object.freeze({ freq: [1 / 1.9, 1 / 0.9, 1 / 0.45, 1 / 0.22], stretch: 0.2, albedo: 0.102, rough: 0.15, slope: 0, corner: 0.15, roughLow: 1, ridge: 0 }),
  // s49 rev2: fine even grain, low contrast (was pebbled/orange-peel)
  'titanium': Object.freeze({ freq: [1 / 0.3, 1 / 0.15, 1 / 0.08, 1 / 0.04], stretch: 1.0, albedo: 0.045, rough: 0.06, slope: 0, corner: 0.15, roughLow: 1, ridge: 0 }),
});

// s48c: gradient (Perlin) noise with analytic derivatives, one rotated domain per octave
// (no axis-aligned lattice -> no square plateaus / blocks), optional ridged octaves (crisp
// hairlines) and a fine-only roughness term (no low-frequency roughness blocks on mirror-like plaster).
function dtMulM(a, b) {
  const r = new Array(9).fill(0);
  for (let c = 0; c < 3; c += 1) for (let rr = 0; rr < 3; rr += 1) for (let k = 0; k < 3; k += 1) r[c * 3 + rr] += a[k * 3 + rr] * b[c * 3 + k];
  return r;
}
const dtRotX = (a) => [1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a)];
const dtRotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
const dtRotZ = (a) => [Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const DT_ANG = [[0.0, 0.0, 0.0], [0.61, 0.83, 1.07], [1.13, 0.47, 0.71], [0.29, 1.21, 0.53]];
const DT_ROT_FULL = DT_ANG.map(([a, b, c]) => dtMulM(dtMulM(dtRotY(a), dtRotX(b)), dtRotZ(c)));
const DT_ROT_Y = DT_ANG.map(([a]) => dtRotY(a * 1.9));
const dtMat = (m) => 'mat3( ' + m.map((v) => v.toFixed(6)).join(', ') + ' )';
const dtRotArr = (name, list) => 'mat3 ' + name + '[4];\n' + list.map((m, i) => '\t' + name + '[' + i + '] = ' + dtMat(m) + ';').join('\n') + '\n';
const DETAIL_GLSL = `
uniform vec4 dtFreq;
uniform float dtCorner;
uniform vec4 dtAmp; // albedo, rough, slope, stretchY
uniform vec4 dtMore; // roughLow (1 = all octaves drive roughness, 0 = finest two only), ridge, -, -
float dtFine;
vec3 dtHash3( vec3 p ) {
	p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
	p += dot( p, p.yxz + 33.33 );
	return fract( ( p.xxy + p.yxx ) * p.zyx ) * 2.0 - 1.0;
}
// Perlin gradient noise (quintic) with analytic derivative: xyz = d/dx, w = value
vec4 dtNoise( vec3 x ) {
	vec3 i = floor( x );
	vec3 w = x - i;
	vec3 u = w * w * w * ( w * ( w * 6.0 - 15.0 ) + 10.0 );
	vec3 du = 30.0 * w * w * ( w * ( w - 2.0 ) + 1.0 );
	vec3 ga = dtHash3( i );
	vec3 gb = dtHash3( i + vec3( 1.0, 0.0, 0.0 ) );
	vec3 gc = dtHash3( i + vec3( 0.0, 1.0, 0.0 ) );
	vec3 gd = dtHash3( i + vec3( 1.0, 1.0, 0.0 ) );
	vec3 ge = dtHash3( i + vec3( 0.0, 0.0, 1.0 ) );
	vec3 gf = dtHash3( i + vec3( 1.0, 0.0, 1.0 ) );
	vec3 gg = dtHash3( i + vec3( 0.0, 1.0, 1.0 ) );
	vec3 gh = dtHash3( i + vec3( 1.0, 1.0, 1.0 ) );
	float va = dot( ga, w );
	float vb = dot( gb, w - vec3( 1.0, 0.0, 0.0 ) );
	float vc = dot( gc, w - vec3( 0.0, 1.0, 0.0 ) );
	float vd = dot( gd, w - vec3( 1.0, 1.0, 0.0 ) );
	float ve = dot( ge, w - vec3( 0.0, 0.0, 1.0 ) );
	float vf = dot( gf, w - vec3( 1.0, 0.0, 1.0 ) );
	float vg = dot( gg, w - vec3( 0.0, 1.0, 1.0 ) );
	float vh = dot( gh, w - vec3( 1.0, 1.0, 1.0 ) );
	float val = va + u.x * ( vb - va ) + u.y * ( vc - va ) + u.z * ( ve - va ) + u.x * u.y * ( va - vb - vc + vd ) + u.y * u.z * ( va - vc - ve + vg ) + u.z * u.x * ( va - vb - ve + vf ) + ( -va + vb + vc - vd + ve - vf - vg + vh ) * u.x * u.y * u.z;
	vec3 der = ga + u.x * ( gb - ga ) + u.y * ( gc - ga ) + u.z * ( ge - ga ) + u.x * u.y * ( ga - gb - gc + gd ) + u.y * u.z * ( ga - gc - ge + gg ) + u.z * u.x * ( ga - gb - ge + gf ) + ( -ga + gb + gc - gd + ge - gf - gg + gh ) * u.x * u.y * u.z
		+ du * ( vec3( vb, vc, ve ) - va + u.yzx * vec3( va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf ) + u.zxy * vec3( va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg ) + u.yzx * u.zxy * ( -va + vb + vc - vd + ve - vf - vg + vh ) );
	return vec4( der, val );
}
// returns (value ~[-1,1], gradient in object space per cell); dtFine = finest-two-octave value
vec4 dtDetail( vec3 p ) {
	vec3 sc = vec3( 1.0, dtAmp.w, 1.0 );
	bool brushed = dtAmp.w < 0.5;
	${dtRotArr('rF', DT_ROT_FULL)}${dtRotArr('rY', DT_ROT_Y)}	vec4 acc = vec4( 0.0 );
	float fine = 0.0;
	float wgt[4];
	wgt[0] = 0.7; wgt[1] = 0.85; wgt[2] = 1.0; wgt[3] = 1.0;
	if ( brushed ) { wgt[0] = 0.25; wgt[1] = 0.5; wgt[2] = 1.1; wgt[3] = 1.3; }
	float fr[4];
	fr[0] = dtFreq.x; fr[1] = dtFreq.y; fr[2] = dtFreq.z; fr[3] = dtFreq.w;
	for ( int o = 0; o < 4; o ++ ) {
		mat3 R = brushed ? rY[o] : rF[o];
		// s54r: per-octave fade from the REAL lattice footprint (cycles/px of the stretched, rotated noise
		// coordinate; stretched axes are slow so hairlines survive longer along them). Ridged octaves carry
		// a 2x harmonic (abs), so fade completes at 0.18 cycles/px (<< Nyquist 0.5) -> no moire.
		vec3 dtQ = R * ( p * sc ) * fr[o];
		float fq = max( length( dFdx( dtQ ) ), length( dFdy( dtQ ) ) );
		float fade = 1.0 - smoothstep( 0.04, 0.18, fq );
		vec4 n = dtNoise( dtQ + float( o ) * 17.3 );
		n *= 1.8;
		vec3 g = n.xyz * R;
		float v = n.w;
		if ( o > 0 && dtMore.y > 0.0 ) {
			// ridged: -|n| gives hairline creases (crisp valley lines)
			float rv = 0.55 - abs( v );
			vec3 rg = - sign( v ) * g;
			v = mix( v, rv * 1.6, dtMore.y );
			g = mix( g, rg * 1.6, dtMore.y );
		}
		float wf = wgt[o] * fade;
		acc += vec4( v, g * sc ) * wf;
		if ( o >= 2 ) fine += v * wf;
	}
	dtFine = fine / 2.2;
	return acc / 2.2;
}
`;

const DETAIL_MAP_CHUNK = `vec4 dtD = dtDetail( vTpPos );
diffuseColor.rgb *= 1.0 + dtAmp.x * dtD.x;
`;
const DETAIL_ROUGH_CHUNK = `roughnessFactor = clamp( roughnessFactor + dtAmp.y * mix( dtFine, dtD.x, dtMore.x ), 0.04, 1.0 );
vec3 dtAn = abs( normalize( vTpN ) );
roughnessFactor = clamp( roughnessFactor + dtCorner * ( 0.55 * ( 1.0 - smoothstep( 0.86, 0.995, max( dtAn.x, max( dtAn.y, dtAn.z ) ) ) ) + 0.45 * smoothstep( 0.0, 0.5, min( dtAn.x, min( dtAn.y, dtAn.z ) ) ) ), 0.04, 1.0 );
`;
const DETAIL_NORMAL_CHUNK = `{
	vec3 dtAX = normalize( vTpAX );
	vec3 dtAY = normalize( vTpAY );
	vec3 dtAZ = normalize( vTpAZ );
	vec3 dtGv = dtD.y * dtAX + dtD.z * dtAY + dtD.w * dtAZ;
	dtGv -= normal * dot( dtGv, normal );
	normal = normalize( normal - dtAmp.z * dtGv );
}`;

function applyTriplanar(material, effectiveTilePx, patternDivisor = 1) {
  if (!material || material.userData.triplanar) return;
  const detail = DETAIL_TUNING[material.userData.materialId] || null;
  const inv = 1 / effectiveTilePx;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = function onBeforeCompileTriplanar(shader, renderer) {
    if (typeof previous === 'function') previous.call(this, shader, renderer);
    shader.uniforms.tpInvTile = { value: inv };
    if (detail) {
      shader.uniforms.dtFreq = { value: new THREE.Vector4(detail.freq[0] / patternDivisor, detail.freq[1] / patternDivisor, detail.freq[2] / patternDivisor, detail.freq[3] / patternDivisor) };
      shader.uniforms.dtCorner = { value: detail.corner };
      shader.uniforms.dtMore = { value: new THREE.Vector4(detail.roughLow, detail.ridge, 0, 0) };
    shader.uniforms.dtAmp = { value: new THREE.Vector4(detail.albedo, detail.rough, detail.slope, detail.stretch) };
    }
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', () => TRIPLANAR_VERT_DECL + 'void main() {')
      .replace('#include <begin_vertex>', () => '#include <begin_vertex>\n' + TRIPLANAR_VERT_BODY);
    let frag = shader.fragmentShader.replace('void main() {', () => TRIPLANAR_FRAG_DECL + (detail ? DETAIL_GLSL : '') + 'void main() {');
    if (detail) {
      frag = frag.replace('#include <map_fragment>', () => '#include <map_fragment>\n' + DETAIL_MAP_CHUNK);
      frag = frag.replace('#include <roughnessmap_fragment>', () => '#include <roughnessmap_fragment>\n' + DETAIL_ROUGH_CHUNK);
    }
    const sub = (name, from, to) => {
      frag = frag.replace('#include <' + name + '>', () => THREE.ShaderChunk[name].replace(from, to));
    };
    sub('map_fragment', 'texture2D( map, vMapUv )', 'tpTex( map )');
    sub('roughnessmap_fragment', 'texture2D( roughnessMap, vRoughnessMapUv )', 'tpTex( roughnessMap )');
    sub('metalnessmap_fragment', 'texture2D( metalnessMap, vMetalnessMapUv )', 'tpTex( metalnessMap )');
    sub('aomap_fragment', 'texture2D( aoMap, vAoMapUv )', 'tpTex( aoMap )');
    // s53: no normal-based fine pattern (DETAIL slope 0, DETAIL_NORMAL_CHUNK not injected)
    frag = frag.replace('#include <normal_fragment_maps>', () => TRIPLANAR_NORMAL_CHUNK);
    shader.fragmentShader = frag;
  };
  material.customProgramCacheKey = () => 'teko-triplanar-s54r-' + (detail ? 'detail' : 'plain');
  material.userData.triplanar = { sharpness: TRIPLANAR_SHARPNESS, tilePx: effectiveTilePx };
  material.needsUpdate = true;
}

function buildColumnGeometry(spec, manifestTilePx, patternDivisor = 1) {
  const effectiveTilePx = manifestTilePx * UV_DENSITY_SCALE * COLUMN_PATTERN_SCALE * patternDivisor;
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
    // Revision 9 rounded edges (source px; 1 px = COLUMN_WORLD_SCALE (200) world units).
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
      fail('material manifest "' + manifestUrl + '" is missing ' + context + ' (expected plaster, reeded-metal and satin)');
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

  // Rev19: procedural groups (generated in-model, no assets / manifest entries).
  const procGenerated = await Promise.all(PROCEDURAL_MATERIALS.map((m) => createProceduralTextures(m.id)));
  for (const [pi, material] of PROCEDURAL_MATERIALS.entries()) {
    const generated = procGenerated[pi];
    texturesByMaterial[material.id] = Object.freeze(generated);
    materials[material.id] = createProceduralMaterial(material, generated);
    tilePx[material.id] = PROCEDURAL_TUNING[material.id].tilePx;
    for (const texture of Object.values(generated)) allTextures.push(texture);
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
 *     plaster must be perfectly smooth, reeded-metal's steel sides are a constant conductor (the reeds live on the separate top plate), and satin is the smooth neutral-grey
 *     reference surface.  The normal/height files still load into `bank.textures`
 *     for provenance/QA but are not sampled.
 *   - Plaster additionally samples no roughnessMap/metalnessMap; it keeps its
 *     constant conductor wiring (metalness 1.0, roughness 0.092) and the flat
 *     albedo/AO maps, so the reflective kit is untouched.
 *   - Reeded Metal and satin keep albedo + AO + a flat roughness map + a flat
 *     metalness map; reeded-metal has bumpScale 0 (no height map), satin likewise.
 */
function createMaterial(materialPlan, textures, extras = {}) {
  const tuning = materialPlan.tuning;
  const isPlaster = materialPlan.id === 'plaster' || materialPlan.id === 'reeded-metal'; // constant-conductor materials
  const heightTexture = textures.height || null;
  // Rev 9: no normal map is sampled by any material.
  const normalTexture = null;
  // Plaster samples no roughness / metalness map (constant conductor); reeded-metal
  // and satin sample their flat 0.30 / 0.92 roughness and 0.85 / 0 metalness maps.
  const roughnessTexture = isPlaster ? null : textures.roughness || null;
  const metalnessTexture = isPlaster ? null : textures.metalness || null;
  const parameters = {
    name: 'column-material:' + materialPlan.id,
    color: new THREE.Color().setRGB(tuning.color[0], tuning.color[1], tuning.color[2]),
    map: isPlaster ? null : textures.albedo || null,
    normalMap: normalTexture,
    normalScale: new THREE.Vector2(tuning.normalScale[0], tuning.normalScale[1]),
    roughnessMap: roughnessTexture,
    roughness: tuning.roughness,
    // Rev 7/8: plaster's constant metalness 1.0 replaces the all-zero derived
    // map; reeded-metal/satin keep their metalness maps exactly as accepted in
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
    parameters.bumpScale = tuning.bumpScale * COLUMN_PATTERN_SCALE;
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
  // roughness is simply the authored constant (0.092); for reeded-metal/satin this
  // stays the published map mean × the tuning factor (what QA measures on screen).
  const roughnessEffective = isPlaster
    ? tuning.roughness
    : roughnessMapMean === null ? null : roughnessMapMean * tuning.roughness;
  const metalnessEffective = isPlaster ? tuning.metalness
    : metalnessMapMean === null ? null : metalnessMapMean * tuning.metalness;
  material.userData = {
    materialId: materialPlan.id,
    label: materialPlan.label,
    tilePx: materialPlan.tilePx,
    normalConvention: materialPlan.normalConvention,
    tuning,
    maps: {
      albedo: Boolean(parameters.map),
      // Rev 9: no material samples a normal map (the channel files still load
      // into bank.textures; these flags report the SAMPLED wiring, the QA proof
      // that reeded-metal's grain is albedo-only and the plaster/satin are smooth).
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
      : materialPlan.id === 'reeded-metal'
        ? 'none on the sides (polished/brushed steel constant conductor); fine parallel reeds live on the separate top plate (rev 5 s32)'
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
      : materialPlan.id === 'reeded-metal'
        ? {
          albedo: 'not sampled - constant steel colour (rev 5 s32)',
          normal: 'not sampled (reeds are on the separate top plate material)',
          roughness: 'not sampled - constant roughness 0.30',
          metalness: 'constant 1.0',
          ao: 'aoMap (flat)',
          height: 'not sampled',
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
  for (const material of ALL_MATERIALS) {
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


/* ------------------------------------------------------------------------- */
/* Reeded-metal top plate (rev 5 s32)                                        */
/* ------------------------------------------------------------------------- */

/** Reeds across the full top width (s44: sparser, wider reeds; was 48). */
export const REED_COUNT_ACROSS = 20;
/** Plate thickness as a fraction of the smaller footprint side (ref: ~2-3 %). */
export const TOP_PLATE_THICKNESS_RATIO = 0.03;
/** Plate top stands this many px above the column top (hides the column cap). */
const TOP_PLATE_LIFT = 0.15 * WS;
const REEDS_PER_TILE = 4;
/** Texels per reed along V (s44: 128, was 16). */
const REED_TEXELS = 128;
/** s49: CONCAVE reeds. Fraction of each reed pitch taken by the recessed groove (rest = flat land). */
const REED_GROOVE_W = 0.32;
/** Wall angle (degrees) at the groove edge: circular-arc U channel, shallow (depth ~ 0.10 x groove width). */
const REED_GROOVE_EDGE_DEG = 34;
/** Lip rounding on the land side of each groove edge: width (fraction of pitch) and max tilt (deg) = thin edge highlight. */
const REED_LIP_W = 0.028;
const REED_LIP_DEG = 20;
/** Groove albedo relative to the land (-13%) and roughness (land / groove). */
const REED_GROOVE_ALBEDO = 0.87;
const REED_LAND_ROUGH = 0.30;
const REED_GROOVE_ROUGH = 0.35;
const REED_SUPERSAMPLE = 8;
/** s45 screen-space fade: reeds per screen px where detail starts / ends fading (1/6 px .. 1/2.2 px pitch). */
const REED_FADE_LO = 0.26;
const REED_FADE_HI = 0.5;
/** Mean of the albedo AO and roughness maps (fade targets) and extra roughness^2 added at full fade. */
const REED_ALBEDO_MEAN = 1.0; // s49: fade targets the flat LAND (= body steel colour)
const REED_ROUGH_MEAN = REED_LAND_ROUGH;
const REED_TOKSVIG = 0.06;

/**
 * Procedural reed maps (deterministic DataTextures, no DOM): a tangent-space
 * normal map of circular-arc crowned reeds with a narrow flat groove, a
 * roughness/metalness map (crown smooth, groove rough) and a grey albedo map
 * that darkens the groove + crown shoulders (ambient occlusion).  Every texel is
 * supersampled so the reed edges stay crisp but alias-free.  The stripes vary
 * along V, so the reeds run parallel to the plate's X edge.
 */
function createReedTextures() {
  const rows = REEDS_PER_TILE * REED_TEXELS;
  const cols = 4;
  const normal = new Uint8Array(cols * rows * 4);
  const rough = new Uint8Array(cols * rows * 4);
  const albedo = new Uint8Array(cols * rows * 4);
  const wallSin = Math.sin((REED_GROOVE_EDGE_DEG * Math.PI) / 180);
  const lipMax = (REED_LIP_DEG * Math.PI) / 180;
  const gh = REED_GROOVE_W / 2;
  for (let y = 0; y < rows; y += 1) {
    let sy = 0;
    let sz = 0;
    let rr = 0;
    let ao = 0;
    for (let s = 0; s < REED_SUPERSAMPLE; s += 1) {
      const v = (y + (s + 0.5) / REED_SUPERSAMPLE) / REED_TEXELS;
      const x = (v - Math.floor(v)) - 0.5; // -0.5..0.5 across one reed pitch, groove centred
      const ax = Math.abs(x);
      let tilt = 0; // convex-positive (as s44); groove walls are negative
      let rg = REED_LAND_ROUGH;
      let occ = 1;
      if (ax < gh) {
        const u = x / gh; // -1..1 across the groove
        tilt = -Math.asin(u * wallSin);
        rg = REED_GROOVE_ROUGH;
        occ = REED_GROOVE_ALBEDO + (1 - REED_GROOVE_ALBEDO) * 0.45 * u * u;
      } else if (ax < gh + REED_LIP_W) {
        const g = (ax - gh) / REED_LIP_W;
        tilt = Math.sign(x) * lipMax * (1 - g) * (1 - g);
      }
      sy += -Math.sin(tilt);
      sz += Math.cos(tilt);
      rr += rg;
      ao += occ;
    }
    const ny = sy / REED_SUPERSAMPLE;
    const nz = sz / REED_SUPERSAMPLE;
    const len = Math.hypot(ny, nz) || 1;
    const roughness = rr / REED_SUPERSAMPLE;
    const occlusion = ao / REED_SUPERSAMPLE;
    for (let x = 0; x < cols; x += 1) {
      const o = (y * cols + x) * 4;
      normal[o] = 128;
      normal[o + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
      rough[o] = 255;
      rough[o + 1] = Math.round(roughness * 255);
      rough[o + 2] = 255;
      rough[o + 3] = 255;
      const a = Math.round(occlusion * 255);
      albedo[o] = a;
      albedo[o + 1] = a;
      albedo[o + 2] = a;
      albedo[o + 3] = 255;
    }
  }
  // Explicit mip chain (s44): box-filtered, then each level fades toward the
  // mean once a reed is only a few texels wide, so distant tops settle to a calm
  // satin tone instead of aliasing / moire against the pixel grid.
  const FADE = [1, 1, 1, 1, 1, 0.8, 0.45, 0.15];
  const buildMips = (base) => {
    const mean = [0, 0, 0, 0];
    for (let i = 0; i < base.length; i += 4) for (let c = 0; c < 4; c += 1) mean[c] += base[i + c];
    for (let c = 0; c < 4; c += 1) mean[c] /= base.length / 4;
    const mips = [{ data: base, width: cols, height: rows }];
    let prev = base;
    let w = cols;
    let h = rows;
    let level = 0;
    while (w > 1 || h > 1) {
      const nw = Math.max(1, w >> 1);
      const nh = Math.max(1, h >> 1);
      level += 1;
      const fade = FADE[Math.min(level, FADE.length - 1)];
      const out = new Uint8Array(nw * nh * 4);
      for (let y = 0; y < nh; y += 1) {
        for (let x = 0; x < nw; x += 1) {
          for (let c = 0; c < 4; c += 1) {
            let sum = 0;
            let n = 0;
            for (let dy = 0; dy < 2; dy += 1) {
              for (let dx = 0; dx < 2; dx += 1) {
                const sx = Math.min(w - 1, x * 2 + dx);
                const sy = Math.min(h - 1, y * 2 + dy);
                sum += prev[(sy * w + sx) * 4 + c];
                n += 1;
              }
            }
            const avg = sum / n;
            out[(y * nw + x) * 4 + c] = Math.round(mean[c] + (avg - mean[c]) * (c === 3 ? 1 : fade));
          }
        }
      }
      mips.push({ data: out, width: nw, height: nh });
      prev = out;
      w = nw;
      h = nh;
    }
    return mips;
  };
  const make = (data) => {
    const texture = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.mipmaps = buildMips(data);
    texture.generateMipmaps = false;
    texture.anisotropy = 16; // clamped to the GPU maximum by three
    texture.needsUpdate = true;
    return texture;
  };  return { normal: make(normal), roughness: make(rough), albedo: make(albedo) };
}

/** One shared material for every reeded top plate (silver conductor + reed maps). */
function createReededTopMaterial(textures, reedCount = REED_COUNT_ACROSS) {
  const material = new THREE.MeshStandardMaterial({
    name: 'column-material:reeded-metal-top',
    color: new THREE.Color().setRGB(0.78, 0.8, 0.84), // s49: = steel body colour (lands)
    map: textures.albedo,
    metalness: 1.0,
    metalnessMap: textures.roughness,
    roughness: 1.0,
    roughnessMap: textures.roughness,
    normalMap: textures.normal,
    normalScale: new THREE.Vector2(0, 0), // s53: no normal-based fine pattern; reeds read through albedo + roughness
    envMapIntensity: 5.0,
    fog: true,
  });
  // s45 screen-space reed AA: once a reed pitch drops under ~REED_FADE_HI px the
  // texture mips (anisotropy-limited along the foreshortened axis) alias into
  // diagonal moire.  Fade normal tilt / groove albedo toward the mean and raise
  // roughness (Toksvig-style: the lost slope variance widens the highlight) as
  // reeds-per-pixel grows.  Pure shader math on MeshStandardMaterial, no lights.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `float reedsPerPx = length(vec2(dFdx(vMapUv.y), dFdy(vMapUv.y))) * ${REEDS_PER_TILE.toFixed(1)};
        float reedFade = 1.0 - smoothstep(${REED_FADE_LO.toFixed(3)}, ${REED_FADE_HI.toFixed(3)}, reedsPerPx);
        #include <map_fragment>
        diffuseColor.rgb = mix(vec3(${REED_ALBEDO_MEAN.toFixed(3)}) * diffuse, diffuseColor.rgb, reedFade);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(${REED_ROUGH_MEAN.toFixed(3)}, roughnessFactor, reedFade);
        roughnessFactor = min(1.0, sqrt(roughnessFactor * roughnessFactor + (1.0 - reedFade) * ${REED_TOKSVIG.toFixed(3)}));`
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * reedFade;')
      );
  };
  material.customProgramCacheKey = () => 'teko-reed-aa-s53';
  material.userData = {
    materialId: 'reeded-metal-top',
    reedCountAcrossWidth: reedCount,
    reedsPerTile: REEDS_PER_TILE,
    thicknessRatio: TOP_PLATE_THICKNESS_RATIO,
  };
  return material;
}

/**
 * Thin top plate geometry: a rectangle slab with a chamfered rim, bottom at
 * y = 0 and top at y = thickness.  UVs are planar (x, z) / reed-tile length, so
 * REED_COUNT_ACROSS reeds span the plate width and run parallel to X.
 */
function buildReededTopGeometry(spec, reedCount = REED_COUNT_ACROSS) {
  const radius = COLUMN_METRICS.cornerRadiusPx[spec.footprint] || 0;
  const inset = radius * 0.6;
  const w = spec.width - 2 * inset;
  const d = spec.depth - 2 * inset;
  const thickness = Math.max(1.2 * WS, TOP_PLATE_THICKNESS_RATIO * Math.min(spec.width, spec.depth));
  const chamfer = thickness * 0.35;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -d / 2);
  shape.lineTo(w / 2, -d / 2);
  shape.lineTo(w / 2, d / 2);
  shape.lineTo(-w / 2, d / 2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - 2 * chamfer,
    bevelEnabled: true,
    bevelThickness: chamfer,
    bevelSize: chamfer,
    bevelOffset: -chamfer,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, chamfer, 0);
  const pitch = w / reedCount;
  const tileLength = pitch * REEDS_PER_TILE;
  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = position.getX(i) / tileLength;
    uv[i * 2 + 1] = position.getZ(i) / tileLength;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeBoundingBox();
  geometry.userData = { reededTopPlate: true, thickness, chamfer, inset, width: w, depth: d, reeds: reedCount, reedPitch: pitch };
  return geometry;
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
export function createColumns(bank, { quality = 'hero', patternDivisor = 1 } = {}) {
  if (!(patternDivisor > 0)) fail('createColumns: patternDivisor must be > 0, got ' + describeValue(patternDivisor));
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
  for (const material of ALL_MATERIALS) {
    const candidate = bankMaterials[material.id];
    if (!candidate) {
      fail('createColumns(bank, options): bank.materials["' + material.id + '"] is missing — the bank must contain all five material groups');
    }
    if (candidate.isMaterial !== true) {
      fail('createColumns(bank, options): bank.materials["' + material.id + '"] is not a THREE.Material');
    }
  }
  const tilePx = readTilePxMap(bank);
  const effectiveTilePx = Object.freeze(
    Object.fromEntries(ALL_MATERIALS.map((material) => [material.id, tilePx[material.id] * UV_DENSITY_SCALE * COLUMN_PATTERN_SCALE * patternDivisor])),
  );

  for (const material of ALL_MATERIALS) applyTriplanar(bankMaterials[material.id], effectiveTilePx[material.id], patternDivisor);

  const group = new THREE.Group();
  group.name = 'column-bank';
  const reedTextures = createReedTextures();
  // s53: physical reed pitch = pre-s53 pitch (REED_COUNT_ACROSS per plate at COLUMN_PATTERN_SCALE)
  const reedCount = Math.max(1, Math.round((REED_COUNT_ACROSS * COLUMN_GEOMETRY_RATIO) / patternDivisor));
  const topMaterial = createReededTopMaterial(reedTextures, reedCount);
  const topPlates = [];
  const columns = [];
  const columnsById = {};
  const geometries = [];
  for (const spec of COLUMN_SPECS) {
    const geometry = buildColumnGeometry(spec, tilePx[spec.material], patternDivisor);
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
    const column = { spec, mesh, material, topPlate: null };
    columns.push(column);
    columnsById[spec.id] = column;
  }
  group.updateMatrixWorld(true);
  const meshBounds = new THREE.Box3().setFromObject(group);
  // Rev 5 s32: every reeded-metal column gets a SEPARATE thin top plate mesh
  // (child of the column mesh).  Added after meshBounds so the exact column
  // bounding boxes are unchanged (the plate stands only TOP_PLATE_LIFT px proud).
  for (const column of columns) {
    if (column.spec.material !== 'reeded-metal') continue;
    const plateGeometry = buildReededTopGeometry(column.spec, reedCount);
    geometries.push(plateGeometry);
    const thickness = plateGeometry.userData.thickness;
    const plate = new THREE.Mesh(plateGeometry, topMaterial);
    plate.name = 'column-top:' + column.spec.id;
    plate.position.set(0, column.spec.heightPx / 2 + TOP_PLATE_LIFT - thickness, 0);
    plate.castShadow = qualityLevel.castShadow;
    plate.receiveShadow = qualityLevel.receiveShadow;
    plate.userData = { columnId: column.spec.id, topPlate: true, thickness, reeds: reedCount };
    column.mesh.add(plate);
    column.topPlate = plate;
    topPlates.push(plate);
  }
  const bounds = COLUMN_METRICS.bounds;
  group.userData = {
    columnCount: COLUMN_SPECS.length,
    materialCount: ALL_MATERIALS.length,
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
    topMaterial.dispose();
    reedTextures.normal.dispose();
    reedTextures.roughness.dispose();
    group.clear();
  };

  return {
    group,
    columns,
    columnsById: Object.freeze(columnsById),
    materials: bankMaterials,
    topPlates,
    topMaterial,
    bounds,
    meshBounds,
    tilePx,
    effectiveTilePx,
    uvDensityScale: UV_DENSITY_SCALE,
    quality,
    patternDivisor,
    reedCount,
    dispose,
  };
}
