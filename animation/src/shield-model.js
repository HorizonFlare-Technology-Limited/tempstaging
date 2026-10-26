/**
 * tekoanimation ??Security shield model (docs/props-contract.md §P1).
 *
 * A Revolut-style security shield built as a deterministic procedural solid:
 *
 *   silhouette   rounded shoulders (r 0.056), straight sides that fillet into
 *                the tapered lower edges (R 0.3166, taper from 60.4 % height)
 *                and a wide rounded bottom point (r 0.056); the chain is solved
 *                for exact tangency and traced from the reference (349 x 461 px,
 *                ratio 0.757);
 *   body         a dark gunmetal plate (mid-dark grey), 0.108 thick, with a
 *                rounded outer edge;
 *   front relief a polished outer bevel, a rim shoulder, a thin dark groove,
 *                a panel lip and a gently convex inner panel (panel edge at
 *                0.042 W, recessed below the rim, dome rising to the centre);
 *   logo         the TEKO arrow mark (`assets/shield/teko2_icon.svg`, copied
 *                byte-identically from K:\HFWorkspace\icons\teko2_icon.svg),
 *                parsed from the SVG at runtime and embossed as a two-tone
 *                relief whose edge — a rounded shoulder plus its side wall — is
 *                painted in the shield's own background tone, so the mark has no
 *                contrasting socket/outline and its edge blends into the plate;
 *   logo palette one shared emblem geometry re-tinted per palette: Brand Gold
 *                (the shipped default), White, Graphite, Silver and an adaptive
 *                white/graphite pair resolved against the surface the mark sits
 *                on. A palette swaps albedo + metalness/roughness per facet; it
 *                never rebuilds the silhouette, the relief, the background-toned
 *                edge or the camera (LOGO_PALETTES / resolveLogoPalette /
 *                applyLogoPalette).
 *
 * Everything is local, deterministic and texture-free: no image maps, no baked
 * lighting, no Math.random, no network access in this module. The page layer
 * (`shield-preview.js`) supplies the studio, environment and camera.
 *
 * Unit convention: shield width = 1.0 world unit, height = 1.321 (measured
 * reference aspect). Front face points towards +Z; the plate is extruded to
 * negative Z.
 *
 * Public API (frozen for ./shield-preview.js):
 *   MODEL_VERSION, LOGO_SOURCE_PATH, LOGO_GEOMETRY_SOURCE, SHIELD_SPEC,
 *   CAMERA_SPEC, MATERIAL_SPEC, LOGO_EDGE_BACKGROUND, LOGO_PALETTES,
 *   LOGO_PALETTE_IDS,
 *   DEFAULT_LOGO_PALETTE, normalizeLogoPaletteId(value),
 *   resolveLogoPalette(value, { surfaceHex }) -> resolved | null,
 *   applyLogoPalette(model, value, { surfaceHex }) -> resolved | null,
 *   buildShieldOutline(spec), parseTekoLogoSvg(svgText, options),
 *   createShieldModel({ logoSvgText, logoSourcePath, logoPalette }) -> model,
 *   model.setLogoPalette(value, { surfaceHex }) -> resolved | null,
 *   model.dispose()
 */

import * as THREE from 'three';

/** Human-readable module version (reported by debug(), not the page contract). */
export const MODEL_VERSION = '1.2.0';

/** Project-relative path of the copied TEKO icon used for the embossed logo. */
export const LOGO_SOURCE_PATH = './assets/shield/teko2_icon.svg';

/**
 * The single emblem geometry shared by every palette. Palettes only re-tint the
 * relief, so this path is the *shape* source even when the colour comes from a
 * different icon variant in `assets/shield/logo/`.
 */
export const LOGO_GEOMETRY_SOURCE = LOGO_SOURCE_PATH;

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ specs */

/**
 * Shield geometry spec, all values in shield-width units.
 *
 * Silhouette traced from the reference image (`refs/shield-ref.png`, non-white
 * bbox 349 x 461 px) at subpixel precision:
 *   - width/height = 349/461 = 0.757 (outer silhouette keeps 1.321 height)
 *   - rounded shoulders, corner radius 0.054 measured (0.056 used: rounded to
 *     the rounder end so the three-quarter render reads as a crest). The
 *     reference's near-white outer bevel blends into the backdrop above the
 *     dark inner edge, so the raw top corner is bracketable only to ~±1.5 px.
 *     A shoulder radius larger than every rim inset is also what lets the rim
 *     bands wrap the corner (offset radius r - inset > 0) instead of collapsing
 *     into a mitred cusp, the defect that made the old render read as a
 *     rectangular plate with a frame around it.
 *   - the sides are straight and vertical (reference drift < 0.1 px) down to
 *     y = -0.13896 = 60.4 % of the height
 *   - a large tangent fillet (R = 0.3166) turns the side into the 0.7566-slope
 *     lower edge; the two are tied by exact tangency (see buildShieldSegments)
 *   - the bottom is a rounded point (tip radius 0.056, reference 0.052); the tip
 *     arc is wider than the rim inset, so the polished bevel wraps a blunt U
 *   - the sharp-tip y is derived from that tangency and the tip radius lands the
 *     lowest vertex exactly on the 1.321 reference height
 */
export const SHIELD_SPEC = Object.freeze({
  width: 1.0,
  height: 1.321,
  halfWidth: 0.5,
  topY: 0.6605,
  /**
   * Sharp tip y is derived by the tangent solver in `buildShieldSegments()` (it
   * is the intercept of the two tangent lower edges), so it is not declared here
   * any more; the specs below are chosen so the derived sharp tip plus the tip
   * radius land exactly on the 1.321 reference height.
   *
   * Values are the subpixel trace of the reference (independent re-measurement:
   * corner 0.054, shoulder fillet 0.317 tangent at 60.4 % height, lower slope
   * 0.7566, tip 0.052) rounded a touch toward the rounder end (0.056 corner/tip)
   * so the three-quarter render reads as a rounded crest rather than the old
   * tight-shouldered plate.
   */
  tipRadius: 0.056,
  topCornerRadius: 0.056,
  sideEndY: -0.13896,
  bottomSlope: 0.7566,
  bottomFilletRadius: 0.3166,
  /** Silhouette samples around the closed outline (uniform arc length). */
  samples: 512,
  /**
   * Plate thickness (z=0 front edge to the back plate). Trimmed from 0.132: at
   * the 26 deg three-quarter camera the old wall read as the side of a slab;
   * the reference is a thin crest.
   */
  thickness: 0.108,
  /** Star centre used for interior ring parameterisation (inside the outline). */
  center: Object.freeze({ x: 0, y: -0.04 }),
  front: Object.freeze({
    /** Front z of the polished bevel crest. */
    bevelCrestZ: 0.026,
    /** Inward offset where the outer bevel crest ends. */
    bevelInnerInset: 0.02,
    /** Inward offset of the panel edge (rim + groove band width). */
    panelInset: 0.042,
    /** Panel edge z (recessed below the rim crest). */
    panelEdgeZ: 0.018,
    /** Gentle convex dome rise from the panel edge to the centre. */
    panelBulge: 0.022,
    /** Number of interior rings of the convex panel. */
    panelRings: 22,
    /** Number of interior rings of the back plate. */
    backRings: 14,
    /** Back plate dome (bulges away from the viewer). */
    backBulge: 0.01,
  }),
  logo: Object.freeze({
    /** Logo mark width in shield-width units (0.52 of the shield width). */
    width: 0.52,
    centerX: 0,
    centerY: 0.03,
    /** Emboss height above the local panel surface. */
    relief: 0.011,
    /** How far the emblem side wall is sunk into the panel (contact, hides gaps). */
    wallInset: 0.004,
    /**
     * Edge footprint, kept from the round-4 socket: each contour is scaled by
     * this about its own centroid to give the background-toned edge shoulder its
     * outer foot. The same 6 % footprint means the emblem keeps its size.
     */
    socketScale: 1.06,
    /**
     * Rounded edge shoulder (round 5). The shoulder is a smoothstep ramp from the
     * raised cap edge down into the panel: `edgeRings` radial steps, tangent to
     * the cap at the top and to the panel at the foot (zero slope at both ends),
     * so there is no razor rim and no sharp foot line. The foot is sunk
     * `edgeSink` into the panel so the seam can never crack.
     */
    edgeRings: 5,
    edgeSink: 0.0006,
    /**
     * Shoulder clearance around a neighbouring facet. Shared contour edges (the
     * two-tone splits) and the tight notches between sub-shapes get no shoulder:
     * there the ramp collapses to a subtle background-toned side wall, so the
     * internal facet split stays crisp and neighbouring shoulders never cross.
     */
    edgeClearance: 0.005,
    /** Cubic flattening segments per SVG curve. */
    curveSegments: 14,
  }),
});

/**
 * Fixed three-quarter studio camera (degrees). The pose is the deterministic
 * default; dragging orbits within the clamps and reset returns to this pose.
 */
export const CAMERA_SPEC = Object.freeze({
  fov: 30,
  near: 0.05,
  far: 40,
  azimuthDeg: 26,
  elevationDeg: 12,
  yawMinDeg: -14,
  yawMaxDeg: 66,
  pitchMinDeg: 0,
  pitchMaxDeg: 40,
  dragSensitivity: 0.18,
  /** Object fill fraction of the stage (both axes), like the collection pages. */
  fitMargin: 0.9,
  fitMarginNarrow: 0.84,
  narrowStageWidth: 520,
  targetYOffset: 0.0,
});

/* ------------------------------------------------------------ logo palettes */

/**
 * Emblem colour schemes. There is exactly ONE emblem geometry — the
 * three-contour TEKO arrow parsed from `LOGO_GEOMETRY_SOURCE`
 * (`assets/shield/teko2_icon.svg`) — and a palette changes only the embossed
 * relief's *facets*: the albedo / metalness / roughness / env intensity of the
 * bright pair and of the deep facet. The edge around the mark is the shared
 * background tone (see `LOGO_EDGE_BACKGROUND` below), so no palette carries a
 * contrasting socket any more. Silhouette, relief height, edge footprint and
 * camera are untouched, so every palette is the same minted shield with a
 * different emblem finish.
 *
 * The authored tones come from the matching brand variants in
 * `K:\HFWorkspace\icons` (copied byte-identically into `assets/shield/logo/`),
 * so each palette is a real icon variant rather than an invented colour:
 *
 *   gold      `teko2_icon.svg`   #ffd60a bright / #7d5a00 deep — the shipped mark
 *   white     `teko2-13.svg`     #ffffff at 100 % / at 50 % opacity
 *   black     `teko2-23.svg`     #000000 solid / #ffffff 50 % facet highlight
 *   silver    `teko2-16.svg`     #7f7f7f at 100 % / at 50 % opacity
 *   adaptive  `teko2-13.svg` + `teko2-16.svg` (dark surface)
 *             `teko2-23.svg` + `teko2-16.svg` (light surface)
 *
 * `gold` is the default and reproduces the shipped two-tone mark exactly (the
 * `MATERIAL_SPEC.goldBright/goldDeep` entries are these tones).
 */
export const DEFAULT_LOGO_PALETTE = 'gold';

const logoFacet = (color, metalness, roughness, envMapIntensity) =>
  Object.freeze({ color, metalness, roughness, envMapIntensity });

/**
 * Emblem edge rule ("background edge", round 5).
 *
 * The material around the mark — the rounded edge shoulder that ramps from the
 * raised relief down into the plate — is the shield's own **background tone**,
 * never a contrasting socket. Round 4 gave every contour a raised dark socket
 * cap (`#2c3136`, polished silver `#d7dde5` for graphite) plus a palette-coloured
 * vertical skirt, which read as a heterochromatic outline around the emblem.
 * That whole edge is now the panel albedo with the panel finish, so the edge
 * blends into the shield face in every palette and only the *facets* carry the
 * brand colour. The tone follows the declared background (`surfaceHex`, the
 * panel albedo `#777c82` on the page), so the resolver's own surface report and
 * the painted edge can never disagree.
 *
 * Each palette therefore stores the two facet tones only; the edge is shared.
 */
const LOGO_EDGE_FINISH = Object.freeze({ metalness: 1.0, roughness: 0.46, envMapIntensity: 0.95 });

/** Edge material description (no colour: the colour is the resolved background). */
export const LOGO_EDGE_BACKGROUND = Object.freeze({
  role: 'emblem edge shoulder \u2014 background tone (blends into the shield face)',
  ...LOGO_EDGE_FINISH,
});

/** `#rrggbb` -> 0xrrggbb (the palette resolver only ever hands it a normalised hex). */
const hexToInt = (hex) => parseInt(String(hex).replace('#', ''), 16);

/** The background tone every palette's emblem edge is painted with. */
const logoEdgeTone = (surfaceHex) =>
  logoFacet(hexToInt(surfaceHex), LOGO_EDGE_FINISH.metalness, LOGO_EDGE_FINISH.roughness, LOGO_EDGE_FINISH.envMapIntensity);

export const LOGO_PALETTES = Object.freeze({
  gold: Object.freeze({
    id: 'gold',
    label: 'Brand Gold',
    aliases: Object.freeze(['gold', 'brand', 'brand-gold', 'brandgold', 'teko-gold', 'current', 'default']),
    summary: 'Two-tone brand gold',
    finish: 'polished two-tone metal',
    tones: Object.freeze({
      bright: logoFacet(0xffd21c, 1.0, 0.26, 1.05),
      deep: logoFacet(0x9a700c, 1.0, 0.34, 0.95),
    }),
    sources: Object.freeze([
      Object.freeze({
        file: 'teko2_icon-gold.svg',
        asset: './assets/shield/logo/teko2_icon-gold.svg',
        original: 'K:\\HFWorkspace\\icons\\teko2_icon.svg',
        fills: Object.freeze(['#ffd60a', '#7d5a00']),
        note: 'the shipped emblem; the authored albedos are the shipped brand tones',
      }),
    ]),
  }),
  white: Object.freeze({
    id: 'white',
    label: 'White',
    aliases: Object.freeze(['white', 'enamel', 'light', 'white-gold']),
    summary: 'Enamel white',
    finish: 'matte enamel (near-dielectric)',
    tones: Object.freeze({
      bright: logoFacet(0xffffff, 0.06, 0.42, 0.95),
      deep: logoFacet(0xc7ced7, 0.06, 0.5, 0.9),
    }),
    sources: Object.freeze([
      Object.freeze({
        file: 'teko2-13-white.svg',
        asset: './assets/shield/logo/teko2-13-white.svg',
        original: 'K:\\HFWorkspace\\icons\\teko2-13.svg',
        fills: Object.freeze(['#ffffff', '#ffffff (opacity .5)']),
        note: 'white mark (a mark + wordmark lockup; its emblem paths carry the two whites); the two tones are that 100 % / 50 % white',
      }),
      Object.freeze({
        file: 'teko2-17-white.svg',
        asset: './assets/shield/logo/teko2-17-white.svg',
        original: 'K:\\HFWorkspace\\icons\\teko2-17.svg',
        fills: Object.freeze(['#ffffff', '#ffffff (opacity .5)']),
        note: 'mark-only white variant (tighter artwork), same two tones',
      }),
    ]),
  }),
  black: Object.freeze({
    id: 'black',
    label: 'Graphite',
    aliases: Object.freeze(['black', 'graphite', 'graphite-black', 'charcoal', 'dark']),
    summary: 'Anodised graphite',
    finish: 'anodised black metal',
    tones: Object.freeze({
      bright: logoFacet(0x14171a, 0.92, 0.3, 0.95),
      deep: logoFacet(0x4a525b, 0.9, 0.36, 0.85),
    }),
    sources: Object.freeze([
      Object.freeze({
        file: 'teko2-23-black.svg',
        asset: './assets/shield/logo/teko2-23-black.svg',
        original: 'K:\\HFWorkspace\\icons\\teko2-23.svg',
        fills: Object.freeze(['#000000 (implicit default)', '#000000 (implicit default, opacity .5)']),
        note: 'black mark (no white facet in the source: the 50 % facet is the same black at half opacity), so the deep tone is an authored graphite that keeps the two facets apart; the dark relief reads against the gunmetal by its own tone (no bright socket: the edge is the background tone)',
      }),
    ]),
  }),
  silver: Object.freeze({
    id: 'silver',
    label: 'Silver',
    aliases: Object.freeze(['silver', 'grey', 'gray', 'steel', 'chrome', 'silver-grey']),
    summary: 'Polished silver',
    finish: 'polished silver metal',
    tones: Object.freeze({
      bright: logoFacet(0xe7ebf0, 1.0, 0.2, 1.05),
      deep: logoFacet(0x98a2ad, 1.0, 0.3, 0.95),
    }),
    sources: Object.freeze([
      Object.freeze({
        file: 'teko2-16-grey.svg',
        asset: './assets/shield/logo/teko2-16-grey.svg',
        original: 'K:\\HFWorkspace\\icons\\teko2-16.svg',
        fills: Object.freeze(['#7f7f7f', '#7f7f7f (opacity .5)']),
        note: 'grey mark; silver is the polished-metal reading of the grey variant',
      }),
    ]),
  }),
  adaptive: Object.freeze({
    id: 'adaptive',
    label: 'Adaptive',
    aliases: Object.freeze(['adaptive', 'auto', 'automatic', 'adapt']),
    summary: 'White on dark, graphite on light',
    finish: 'adaptive two-tone',
    /**
     * No fixed tones: the pair is resolved at apply time against the surface the
     * mark sits on (the shield's panel albedo, reported as `surface`). The rule
     * is deliberately simple and deterministic ??each candidate is scored by the
     * absolute albedo-luminance distance of its bright facet from the surface,
     * and the larger distance wins (ties go to the white pair). This is the
     * light-theme / dark-theme pairing of the adaptive icon set, not a new colour.
     */
    adaptive: Object.freeze({
      rule: 'largest albedo-luminance distance between the bright facet and the surface the mark sits on; ties go to the white pair',
      candidates: Object.freeze({
        white: Object.freeze({
          id: 'white',
          label: 'white mark',
          tones: Object.freeze({
            bright: logoFacet(0xffffff, 0.08, 0.4, 0.95),
            deep: logoFacet(0x8f969e, 0.14, 0.44, 0.9),
          }),
          sources: Object.freeze([
            Object.freeze({
              file: 'teko2-13-white.svg',
              asset: './assets/shield/logo/teko2-13-white.svg',
              original: 'K:\\HFWorkspace\\icons\\teko2-13.svg',
              fills: Object.freeze(['#ffffff', '#ffffff (opacity .5)']),
              note: 'light mark for a dark surface (dark-theme adaptive icon pairing)',
            }),
            Object.freeze({
              file: 'teko2-16-grey.svg',
              asset: './assets/shield/logo/teko2-16-grey.svg',
              original: 'K:\\HFWorkspace\\icons\\teko2-16.svg',
              fills: Object.freeze(['#7f7f7f', '#7f7f7f (opacity .5)']),
              note: 'grey shade facet of the same pairing',
            }),
          ]),
        }),
        graphite: Object.freeze({
          id: 'graphite',
          label: 'graphite mark',
          tones: Object.freeze({
            bright: logoFacet(0x14171a, 0.86, 0.32, 0.95),
            deep: logoFacet(0x8d949c, 0.55, 0.38, 0.9),
          }),
          sources: Object.freeze([
            Object.freeze({
              file: 'teko2-23-black.svg',
              asset: './assets/shield/logo/teko2-23-black.svg',
              original: 'K:\\HFWorkspace\\icons\\teko2-23.svg',
              fills: Object.freeze(['#000000 (implicit default)', '#000000 (implicit default, opacity .5)']),
              note: 'dark mark for a light surface (light-theme adaptive icon pairing)',
            }),
            Object.freeze({
              file: 'teko2-16-grey.svg',
              asset: './assets/shield/logo/teko2-16-grey.svg',
              original: 'K:\\HFWorkspace\\icons\\teko2-16.svg',
              fills: Object.freeze(['#7f7f7f', '#7f7f7f (opacity .5)']),
              note: 'grey shade facet of the same pairing',
            }),
          ]),
        }),
      }),
    }),
  }),
});

/** Palette ids in presentation order (the UI and `?logo=` accept exactly these). */
export const LOGO_PALETTE_IDS = Object.freeze(Object.keys(LOGO_PALETTES));

/**
 * Structurally distinct materials. `color` is the true albedo (no baked
 * lighting anywhere): the mid-dark gunmetal body tone comes from the reference's
 * central dark band, the brighter silver bevels are polished edges, and the gold
 * pairs follow the TEKO brand mark's two-tone yellow/deep-gold artwork.
 */
export const MATERIAL_SPEC = Object.freeze({
  face: Object.freeze({ color: 0x777c82, ...LOGO_EDGE_FINISH, role: 'satin body gunmetal (dark band)' }),
  body: Object.freeze({ color: 0x6e737a, metalness: 1.0, roughness: 0.4, envMapIntensity: 0.9, role: 'body edge / rim shoulder' }),
  bevel: Object.freeze({ color: 0xd4dae2, metalness: 1.0, roughness: 0.14, envMapIntensity: 1.05, role: 'polished bevel edge' }),
  groove: Object.freeze({ color: 0x3e434a, metalness: 1.0, roughness: 0.5, envMapIntensity: 0.8, role: 'recessed groove (dark)' }),
  back: Object.freeze({ color: 0x5b6067, metalness: 1.0, roughness: 0.42, envMapIntensity: 0.85, role: 'machined back plate' }),
  goldBright: Object.freeze({ ...LOGO_PALETTES.gold.tones.bright, role: 'TEKO brand gold (bright)' }),
  goldDeep: Object.freeze({ ...LOGO_PALETTES.gold.tones.deep, role: 'TEKO brand gold (deep)' }),
  /**
   * Emblem edge: the background tone by rule (round 5). It is the face albedo
   * with the face finish, so the shoulder around the mark renders as the plate
   * it sits on; the palette resolver re-points it at the declared background.
   */
  socket: Object.freeze({ color: 0x777c82, ...LOGO_EDGE_FINISH, role: 'emblem edge shoulder \u2014 background tone (blends into the shield face)' }),
});

/* ------------------------------------------------------------------ maths */

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}


/* ------------------------------------------------- silhouette segments */

/**
 * Analytic shield outline as an ordered list of line/circular-arc segments,
 * tangent-continuous and traversed clockwise (viewed from +Z), starting at the
 * left end of the top edge. Circular arcs (not ellipses) keep inward offsets
 * exact: an arc offsets to an arc of radius r - d and collapses to a mitred
 * cusp once d reaches r.
 *
 * The lower chain is solved for exact tangency instead of being read off loose
 * constants: the vertical side ends at `sideEndY`, the fillet arc of radius
 * `bottomFilletRadius` leaves it tangentially, and the straight lower edge at
 * `bottomSlope` is tangent to both that fillet and the tip arc. The sharp-tip y
 * therefore falls out of the spec (it is not an independent constant any more),
 * and every joint is closed with no sampling gap.
 */
export function buildShieldSegments(spec = SHIELD_SPEC) {
  const hw = spec.halfWidth;
  const topY = spec.topY;
  const cornerRadius = spec.topCornerRadius;
  const filletRadius = spec.bottomFilletRadius;
  const slope = spec.bottomSlope;
  const slopeAngle = Math.atan(slope);
  // Tangency angle of the straight lower edges with the side fillets / tip arc.
  const tangentAngle = -(Math.PI / 2 - slopeAngle);
  const lineNorm = Math.sqrt(1 + slope * slope);

  const filletCenterX = hw - filletRadius;
  const filletCenterY = spec.sideEndY;
  // Exact tangency: the lower edge y = slope*x + c is tangent to the fillet
  // circle from the outside, which fixes its intercept c.
  const tipSharpY = spec.sideEndY - slope * hw - filletRadius * (lineNorm - slope);
  const filletTangentX = filletCenterX + filletRadius * Math.cos(tangentAngle);
  const filletTangentY = filletCenterY + filletRadius * Math.sin(tangentAngle);
  // Tip arc: centred on the symmetry axis, tangent to the same lower edge.
  const tipCenterY = tipSharpY + spec.tipRadius * lineNorm;
  const tipTangentX = spec.tipRadius * Math.cos(tangentAngle);
  const tipTangentY = tipCenterY + spec.tipRadius * Math.sin(tangentAngle);

  const line = (x0, y0, x1, y1) => ({ type: 'line', a: new THREE.Vector2(x0, y0), b: new THREE.Vector2(x1, y1) });
  const arc = (cx, cy, radius, startAngle, endAngle) => ({
    type: 'arc',
    center: new THREE.Vector2(cx, cy),
    radius,
    startAngle,
    endAngle,
  });

  return [
    line(-(hw - cornerRadius), topY, hw - cornerRadius, topY),
    arc(hw - cornerRadius, topY - cornerRadius, cornerRadius, Math.PI / 2, 0),
    line(hw, topY - cornerRadius, hw, filletCenterY),
    arc(filletCenterX, filletCenterY, filletRadius, 0, tangentAngle),
    line(filletTangentX, filletTangentY, tipTangentX, tipTangentY),
    arc(0, tipCenterY, spec.tipRadius, tangentAngle, -Math.PI - tangentAngle),
    line(-tipTangentX, tipTangentY, -filletTangentX, filletTangentY),
    arc(-filletCenterX, filletCenterY, filletRadius, -Math.PI - tangentAngle, -Math.PI),
    line(-hw, filletCenterY, -hw, topY - cornerRadius),
    arc(-(hw - cornerRadius), topY - cornerRadius, cornerRadius, Math.PI, Math.PI / 2),
  ];
}

function segmentLength(segment) {
  if (segment.type === 'line') return segment.a.distanceTo(segment.b);
  return Math.abs(segment.endAngle - segment.startAngle) * segment.radius;
}

function segmentPoint(segment, t) {
  if (segment.type === 'line') return new THREE.Vector2().lerpVectors(segment.a, segment.b, t);
  const angle = lerp(segment.startAngle, segment.endAngle, t);
  return new THREE.Vector2(
    segment.center.x + Math.cos(angle) * segment.radius,
    segment.center.y + Math.sin(angle) * segment.radius,
  );
}

/** Unit tangent at parameter t (same direction before and after offsetting). */
function segmentTangent(segment, t) {
  if (segment.type === 'line') {
    return new THREE.Vector2().subVectors(segment.b, segment.a).normalize();
  }
  const angle = lerp(segment.startAngle, segment.endAngle, t);
  const direction = Math.sign(segment.endAngle - segment.startAngle) || 1;
  return new THREE.Vector2(-Math.sin(angle), Math.cos(angle)).multiplyScalar(direction);
}

/**
 * Build the closed shield silhouette as `samples` uniform-arc-length points
 * traversed clockwise, starting at the left end of the top edge.
 */
export function buildShieldOutline(spec = SHIELD_SPEC, samples = spec.samples) {
  const segments = buildShieldSegments(spec);
  const lengths = segments.map(segmentLength);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const out = [];
  let index = 0;
  let walked = 0;
  for (let k = 0; k < samples; k += 1) {
    const target = (k / samples) * total;
    while (index < segments.length - 1 && walked + lengths[index] < target) {
      walked += lengths[index];
      index += 1;
    }
    const t = lengths[index] > 1e-9 ? (target - walked) / lengths[index] : 0;
    out.push(segmentPoint(segments[index], clamp01(t)));
  }
  return out;
}

/* ------------------------------------------------------------ offset rings */

function inwardNormal(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return new THREE.Vector2(dy / length, -dx / length);
}

/** Offset one analytic segment inward; null when a convex arc collapses. */
function offsetSegment(segment, distance) {
  if (segment.type === 'line') {
    const normal = inwardNormal(segment.a, segment.b);
    return {
      type: 'line',
      a: new THREE.Vector2(segment.a.x + normal.x * distance, segment.a.y + normal.y * distance),
      b: new THREE.Vector2(segment.b.x + normal.x * distance, segment.b.y + normal.y * distance),
    };
  }
  const radius = segment.radius - distance;
  if (radius <= 0.0008) return null;
  return {
    type: 'arc',
    center: segment.center.clone(),
    radius,
    startAngle: segment.startAngle,
    endAngle: segment.endAngle,
  };
}

function lineIntersection(a0, a1, b0, b1) {
  const rx = a1.x - a0.x;
  const ry = a1.y - a0.y;
  const sx = b1.x - b0.x;
  const sy = b1.y - b0.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return null;
  const qpx = b0.x - a0.x;
  const qpy = b0.y - a0.y;
  const t = (qpx * sy - qpy * sx) / denominator;
  return new THREE.Vector2(a0.x + rx * t, a0.y + ry * t);
}

function denseSegmentPoints(piece) {
  const length = segmentLength(piece);
  const steps = Math.max(2, Math.min(48, Math.ceil(length / 0.012)));
  const points = [];
  for (let i = 0; i <= steps; i += 1) points.push(segmentPoint(piece, i / steps));
  return points;
}

/**
 * Dense polyline of the silhouette offset inward by `distance`.
 *
 * Where an arc is narrower than the offset (the 0.030 top corners and the 0.046
 * bottom point), the arc collapses and the two neighbouring offset lines meet in
 * a mitred cusp ??exactly how a constant-width bevelled border terminates at a
 * tight corner, and never a folded/self-intersecting ring.
 */
export function buildOffsetPolyline(segments, distance) {
  const pieces = [];
  for (let i = 0; i < segments.length; i += 1) {
    const piece = offsetSegment(segments[i], distance);
    if (piece) pieces.push({ segmentIndex: i, piece, points: denseSegmentPoints(piece) });
  }
  if (pieces.length === 0) return [];

  const joins = [];
  for (let k = 0; k < pieces.length; k += 1) {
    const current = pieces[k];
    const next = pieces[(k + 1) % pieces.length];
    const currentEnd = current.points[current.points.length - 1];
    const nextStart = next.points[0];
    const adjacent = (current.segmentIndex + 1) % segments.length === next.segmentIndex;
    if (adjacent && currentEnd.distanceTo(nextStart) <= 1e-6) {
      joins.push(currentEnd.clone());
      continue;
    }
    let meet = null;
    if (current.piece.type === 'line' && next.piece.type === 'line') {
      meet = lineIntersection(current.piece.a, current.piece.b, next.piece.a, next.piece.b);
    }
    if (!meet || meet.distanceTo(currentEnd) > 0.6 || meet.distanceTo(nextStart) > 0.6) {
      meet = new THREE.Vector2().addVectors(currentEnd, nextStart).multiplyScalar(0.5);
    }
    joins.push(meet);
  }

  const polyline = [];
  for (let k = 0; k < pieces.length; k += 1) {
    const current = pieces[k];
    const points = current.points;
    const startJoin = joins[(k - 1 + pieces.length) % pieces.length];
    const endJoin = joins[k];
    const original = segments[current.segmentIndex];
    const startTangent = segmentTangent(original, 0);
    const endTangent = segmentTangent(original, 1);
    // After a mitred join the piece endpoint can sit past the intersection; trim
    // the points that would backtrack the traversal (they would break the polar
    // angle ordering used to build correspondence-aligned rings).
    let first = 0;
    while (
      first < points.length &&
      (points[first].x - startJoin.x) * startTangent.x + (points[first].y - startJoin.y) * startTangent.y < -1e-6
    ) {
      first += 1;
    }
    let last = points.length - 1;
    while (
      last > first &&
      (points[last].x - endJoin.x) * endTangent.x + (points[last].y - endJoin.y) * endTangent.y > 1e-6
    ) {
      last -= 1;
    }
    const append = (point) => {
      const tail = polyline[polyline.length - 1];
      if (tail && tail.distanceTo(point) < 1e-7) return;
      polyline.push(point);
    };
    append(startJoin.clone());
    for (let i = first; i <= last; i += 1) append(points[i].clone());
    append(endJoin.clone());
  }
  return polyline;
}

/** Polar radius of a closed polyline relative to `center` (clockwise, unwrapped). */
function polylinePolarTable(polyline, center) {
  const angles = [];
  const radii = [];
  let previous = null;
  for (const point of polyline) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    let angle = Math.atan2(dy, dx);
    if (previous !== null) {
      if (angle > previous) {
        // Numeric micro-kinks at tangent joins must not be mistaken for the
        // -2*pi wrap; hold the angle for those instead of subtracting a turn.
        if (angle - previous < 0.02) angle = previous;
        else while (angle > previous + 1e-9) angle -= TAU;
      }
    }
    previous = angle;
    angles.push(angle);
    radii.push(Math.hypot(dx, dy));
  }
  return { angles, radii };
}

function samplePolarRadius(table, theta) {
  const { angles, radii } = table;
  const last = angles.length - 1;
  let angle = theta;
  while (angle > angles[0]) angle -= TAU;
  while (angle < angles[last]) angle += TAU;
  if (angle >= angles[0]) return radii[0];
  if (angle <= angles[last]) return radii[last];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (angles[mid] >= angle) low = mid;
    else high = mid;
  }
  const span = angles[high] - angles[low] || 1;
  const t = (angle - angles[low]) / span;
  return lerp(radii[low], radii[high], t);
}

/**
 * Ring points for an inward offset, sampled along the same polar directions as
 * the silhouette so every band ring has a 1:1 correspondence with the outline.
 */
export function sampleOffsetRing(segments, distance, thetaTargets, center) {
  const polyline = buildOffsetPolyline(segments, distance);
  if (polyline.length === 0) return thetaTargets.map((theta) => new THREE.Vector2(center.x + Math.cos(theta) * 0.01, center.y + Math.sin(theta) * 0.01));
  const table = polylinePolarTable(polyline, center);
  return thetaTargets.map((theta) => {
    const radius = samplePolarRadius(table, theta);
    return new THREE.Vector2(center.x + Math.cos(theta) * radius, center.y + Math.sin(theta) * radius);
  });
}

/* ------------------------------------------------------------- front relief */

function buildPolarTables(outline, panelEdgeRing, spec) {
  const center = spec.center;
  const n = outline.length;
  const angles = new Array(n);
  const radii = new Array(n);
  const edgeRadii = new Array(n);
  let previous = null;
  for (let i = 0; i < n; i += 1) {
    const dx = outline[i].x - center.x;
    const dy = outline[i].y - center.y;
    let angle = Math.atan2(dy, dx);
    if (previous !== null) {
      while (angle > previous + 1e-9) angle -= TAU;
    }
    previous = angle;
    angles[i] = angle;
    radii[i] = Math.hypot(dx, dy);
    edgeRadii[i] = panelEdgeRing[i].distanceTo(new THREE.Vector2(center.x, center.y));
  }
  return { angles, radii, edgeRadii };
}

function samplePolar(table, theta) {
  const { angles, radii, edgeRadii } = table;
  const last = angles.length - 1;
  let angle = theta;
  while (angle > angles[0]) angle -= TAU;
  while (angle < angles[last]) angle += TAU;
  if (angle >= angles[0]) return { radius: radii[0], edgeRadius: edgeRadii[0] };
  if (angle <= angles[last]) return { radius: radii[last], edgeRadius: edgeRadii[last] };
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (angles[mid] >= angle) low = mid;
    else high = mid;
  }
  const span = angles[high] - angles[low] || 1;
  const t = (angle - angles[low]) / span;
  return {
    radius: lerp(radii[low], radii[high], t),
    edgeRadius: lerp(edgeRadii[low], edgeRadii[high], t),
  };
}

/** Analytic z of the convex panel surface at a point (used by the logo relief). */
function panelSurfaceZ(x, y, polar, spec) {
  const center = spec.center;
  const dx = x - center.x;
  const dy = y - center.y;
  const distance = Math.hypot(dx, dy);
  const edgeZ = spec.front.panelEdgeZ;
  const bulge = spec.front.panelBulge;
  if (distance < 1e-6) return edgeZ + bulge;
  const sample = samplePolar(polar, Math.atan2(dy, dx));
  const panelScale = sample.edgeRadius / sample.radius;
  const t = clamp01(1 - distance / (sample.radius * panelScale));
  return edgeZ + bulge * (1 - (1 - t) * (1 - t));
}

/* ------------------------------------------------------------------ svg */

const SVG_PATH_COMMANDS = 'MmLlHhVvCcSsQqTtAaZz';

function tokenizePathData(d) {
  const tokens = [];
  const pattern = new RegExp('([' + SVG_PATH_COMMANDS + '])|([-+]?(?:\\d*\\.\\d+|\\d+)(?:[eE][-+]?\\d+)?)', 'g');
  let match = pattern.exec(d);
  while (match !== null) {
    if (match[1]) tokens.push({ command: match[1] });
    else tokens.push({ number: Number(match[2]) });
    match = pattern.exec(d);
  }
  return tokens;
}

/** Minimal deterministic SVG path parser: M L H V C S Q T Z (absolute + relative). */
function parsePathData(d, options = {}) {
  const curveSegments = Math.max(2, Math.round(options.curveSegments || 14));
  const tokens = tokenizePathData(d);
  const subpaths = [];
  let current = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = null;
  let index = 0;
  let cubicControl = null;
  let quadControl = null;

  const read = (count) => {
    const values = [];
    for (let i = 0; i < count; i += 1) {
      if (index >= tokens.length || tokens[index].command) return null;
      values.push(tokens[index].number);
      index += 1;
    }
    return values;
  };
  const addPoint = (px, py) => {
    current.push(new THREE.Vector2(px, py));
  };
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let i = 1; i <= curveSegments; i += 1) {
      const t = i / curveSegments;
      const mt = 1 - t;
      const px = mt * mt * mt * x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
      const py = mt * mt * mt * y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
      addPoint(px, py);
    }
    x = x3;
    y = y3;
  };
  const quadratic = (x1, y1, x2, y2) => {
    for (let i = 1; i <= curveSegments; i += 1) {
      const t = i / curveSegments;
      const mt = 1 - t;
      const px = mt * mt * x + 2 * mt * t * x1 + t * t * x2;
      const py = mt * mt * y + 2 * mt * t * y1 + t * t * y2;
      addPoint(px, py);
    }
    x = x2;
    y = y2;
  };

  while (index < tokens.length) {
    if (tokens[index].command) {
      command = tokens[index].command;
      index += 1;
      if (command === 'Z' || command === 'z') {
        if (current.length > 0) subpaths.push(current);
        current = [];
        command = null;
        continue;
      }
    } else if (!command) {
      throw new Error('SVG path data contains numbers before a command');
    }

    const upper = command.toUpperCase();
    const relative = command !== upper;

    if (upper === 'M') {
      if (current.length > 0) subpaths.push(current);
      current = [];
      const values = read(2);
      if (!values) break;
      x = relative ? x + values[0] : values[0];
      y = relative ? y + values[1] : values[1];
      startX = x;
      startY = y;
      addPoint(x, y);
      command = relative ? 'l' : 'L';
      cubicControl = null;
      quadControl = null;
      continue;
    }

    let values = null;
    switch (upper) {
      case 'L': {
        values = read(2);
        if (!values) { index = tokens.length; break; }
        x = relative ? x + values[0] : values[0];
        y = relative ? y + values[1] : values[1];
        addPoint(x, y);
        break;
      }
      case 'H': {
        values = read(1);
        if (!values) { index = tokens.length; break; }
        x = relative ? x + values[0] : values[0];
        addPoint(x, y);
        break;
      }
      case 'V': {
        values = read(1);
        if (!values) { index = tokens.length; break; }
        y = relative ? y + values[0] : values[0];
        addPoint(x, y);
        break;
      }
      case 'C': {
        values = read(6);
        if (!values) { index = tokens.length; break; }
        const x1 = relative ? x + values[0] : values[0];
        const y1 = relative ? y + values[1] : values[1];
        const x2 = relative ? x + values[2] : values[2];
        const y2 = relative ? y + values[3] : values[3];
        const x3 = relative ? x + values[4] : values[4];
        const y3 = relative ? y + values[5] : values[5];
        cubic(x1, y1, x2, y2, x3, y3);
        cubicControl = new THREE.Vector2(x2, y2);
        quadControl = null;
        break;
      }
      case 'S': {
        values = read(4);
        if (!values) { index = tokens.length; break; }
        const reflected = cubicControl
          ? new THREE.Vector2(2 * x - cubicControl.x, 2 * y - cubicControl.y)
          : new THREE.Vector2(x, y);
        const x2 = relative ? x + values[0] : values[0];
        const y2 = relative ? y + values[1] : values[1];
        const x3 = relative ? x + values[2] : values[2];
        const y3 = relative ? y + values[3] : values[3];
        cubic(reflected.x, reflected.y, x2, y2, x3, y3);
        cubicControl = new THREE.Vector2(x2, y2);
        quadControl = null;
        break;
      }
      case 'Q': {
        values = read(4);
        if (!values) { index = tokens.length; break; }
        const x1 = relative ? x + values[0] : values[0];
        const y1 = relative ? y + values[1] : values[1];
        const x2 = relative ? x + values[2] : values[2];
        const y2 = relative ? y + values[3] : values[3];
        quadratic(x1, y1, x2, y2);
        quadControl = new THREE.Vector2(x1, y1);
        cubicControl = null;
        break;
      }
      case 'T': {
        values = read(2);
        if (!values) { index = tokens.length; break; }
        const reflected = quadControl
          ? new THREE.Vector2(2 * x - quadControl.x, 2 * y - quadControl.y)
          : new THREE.Vector2(x, y);
        const x2 = relative ? x + values[0] : values[0];
        const y2 = relative ? y + values[1] : values[1];
        quadratic(reflected.x, reflected.y, x2, y2);
        quadControl = new THREE.Vector2(reflected.x, reflected.y);
        cubicControl = null;
        break;
      }
      default:
        throw new Error('Unsupported SVG path command "' + command + '"');
    }
    cubicControl = upper === 'C' || upper === 'S' ? cubicControl : null;
    if (upper !== 'Q' && upper !== 'T') quadControl = null;
    command = command;
  }

  if (current.length > 0) subpaths.push(current);
  return subpaths;
}

/**
 * Parse the TEKO icon SVG into closed 2D contours with their fill colours.
 * Returns `{ shapes, bbox, source }`, where every shape is `{ fill, points }`
 * in SVG coordinates (`points` flattened to a polyline).
 */
export function parseTekoLogoSvg(svgText, options = {}) {
  if (typeof svgText !== 'string' || svgText.length === 0) {
    throw new Error('parseTekoLogoSvg requires the SVG source text');
  }
  const curveSegments = Math.max(2, Math.round(options.curveSegments || SHIELD_SPEC.logo.curveSegments));

  const classFills = new Map();
  const styleBlocks = svgText.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  for (const block of styleBlocks) {
    const rulePattern = /\.([A-Za-z0-9_-]+)\s*\{[^}]*fill\s*:\s*([^;}]+)/g;
    let rule = rulePattern.exec(block);
    while (rule !== null) {
      classFills.set(rule[1], rule[2].trim());
      rule = rulePattern.exec(block);
    }
  }

  const shapes = [];
  const pathPattern = /<path\b([^>]*?)\/?>/g;
  let match = pathPattern.exec(svgText);
  let shapeIndex = 0;
  while (match !== null) {
    const attributes = match[1] || '';
    const dMatch = attributes.match(/\sd\s*=\s*"([^"]*)"/) || attributes.match(/\sd\s*=\s*'([^']*)'/);
    if (dMatch && dMatch[1]) {
      const classMatch = attributes.match(/\sclass\s*=\s*"([^"]*)"/) || attributes.match(/\sclass\s*=\s*'([^']*)'/);
      const fillMatch = attributes.match(/\sfill\s*=\s*"([^"]*)"/) || attributes.match(/\sfill\s*=\s*'([^']*)'/);
      let fill = fillMatch ? fillMatch[1] : null;
      if (!fill && classMatch) {
        for (const className of classMatch[1].split(/\s+/)) {
          if (classFills.has(className)) {
            fill = classFills.get(className);
            break;
          }
        }
      }
      if (!fill) fill = '#000000';
      const subpaths = parsePathData(dMatch[1], { curveSegments });
      subpaths.forEach((points, subpathIndex) => {
        if (points.length < 3) return;
        shapes.push({
          index: shapeIndex,
          subpathIndex,
          fill: String(fill).trim(),
          points,
        });
        shapeIndex += 1;
      });
    }
    match = pathPattern.exec(svgText);
  }

  if (shapes.length === 0) {
    throw new Error('no <path> artwork found in the TEKO icon SVG');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    for (const point of shape.points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }
  return {
    shapes,
    bbox: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
  };
}

/* --------------------------------------------------------------- geometry */

function createIndexedGeometry(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // r151 only auto-wraps plain Arrays in setIndex; pass an explicit
  // BufferAttribute so index.count / the renderer see a proper attribute.
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/** Flip triangle winding (used when the computed normals point the wrong way). */
function flipWinding(geometry) {
  const index = geometry.getIndex();
  if (!index) return;
  const array = index.array;
  for (let i = 0; i < array.length; i += 3) {
    const swap = array[i + 1];
    array[i + 1] = array[i + 2];
    array[i + 2] = swap;
  }
  index.needsUpdate = true;
}

/**
 * Build a band (a closed grid of rings) as one indexed geometry.
 * `rings` is ordered outer/back -> inner/front and every ring is
 * `{ points: Vector2[], z: number }` with the same point count.
 */
function buildBandGeometry(rings, options = {}) {
  const ringCount = rings.length;
  const sampleCount = rings[0].points.length;
  const positions = new Float32Array((ringCount * sampleCount + (options.centre ? 1 : 0)) * 3);
  let cursor = 0;
  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const ring = rings[ringIndex];
    for (let i = 0; i < sampleCount; i += 1) {
      positions[cursor] = ring.points[i].x;
      positions[cursor + 1] = ring.points[i].y;
      positions[cursor + 2] = ring.z;
      cursor += 3;
    }
  }
  const centreIndex = options.centre ? ringCount * sampleCount : -1;
  if (options.centre) {
    positions[cursor] = options.centre.x;
    positions[cursor + 1] = options.centre.y;
    positions[cursor + 2] = options.centre.z;
  }

  const triangleCount = (ringCount - 1) * sampleCount * 2 + (options.centre ? sampleCount : 0);
  const indices = new Uint32Array(triangleCount * 3);
  let write = 0;
  for (let ringIndex = 0; ringIndex < ringCount - 1; ringIndex += 1) {
    const base = ringIndex * sampleCount;
    const nextBase = base + sampleCount;
    for (let i = 0; i < sampleCount; i += 1) {
      const next = (i + 1) % sampleCount;
      // Triangle A: (outer i, inner i, outer i+1)
      indices[write] = base + i;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = base + next;
      write += 3;
      // Triangle B: (outer i+1, inner i, inner i+1)
      indices[write] = base + next;
      indices[write + 1] = nextBase + i;
      indices[write + 2] = nextBase + next;
      write += 3;
    }
  }
  if (options.centre) {
    const base = (ringCount - 1) * sampleCount;
    for (let i = 0; i < sampleCount; i += 1) {
      const next = (i + 1) % sampleCount;
      indices[write] = base + i;
      indices[write + 1] = centreIndex;
      indices[write + 2] = base + next;
      write += 3;
    }
  }

  const geometry = createIndexedGeometry(positions, indices);
  geometry.computeVertexNormals();

  const expected = options.expectedNormal || 'front';
  const normalAttribute = geometry.getAttribute('normal');
  let score = 0;
  if (expected === 'radial') {
    for (let i = 0; i < sampleCount; i += Math.max(1, Math.floor(sampleCount / 32))) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const nx = normalAttribute.getX(i);
      const ny = normalAttribute.getY(i);
      score += (px * nx + py * ny) / (Math.hypot(px, py) || 1);
    }
  } else {
    const sign = expected === 'back' ? -1 : 1;
    for (let i = 0; i < normalAttribute.count; i += Math.max(1, Math.floor(normalAttribute.count / 64))) {
      score += normalAttribute.getZ(i) * sign;
    }
  }
  if (score < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/**
 * three r151 ships with ColorManagement disabled (legacy mode), so a hex handed
 * to the Color constructor is treated as a working-space value and renders far
 * too bright once the sRGB output encoding is applied. Convert the authored
 * sRGB hex to linear working values explicitly so the material renders exactly
 * as the measured reference tone.
 */
function srgbChannelToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function workingColorFromHex(hex) {
  const color = new THREE.Color();
  color.setRGB(
    srgbChannelToLinear(((hex >> 16) & 255) / 255),
    srgbChannelToLinear(((hex >> 8) & 255) / 255),
    srgbChannelToLinear((hex & 255) / 255),
  );
  return color;
}

function hexString(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

/* --------------------------------------------------- palette resolution */

const roundTo = (value, digits = 3) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};

/** Normalise `#abc` / `#AABBCC` / `aabbcc` to lower-case `#aabbcc`; null otherwise. */
function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{3}$/.test(raw) && !/^[0-9a-f]{6}$/.test(raw)) return null;
  const full = raw.length === 3 ? raw.split('').map((character) => character + character).join('') : raw;
  return '#' + full;
}

/** WCAG relative luminance of an sRGB hex colour (0 = black, 1 = white). */
function hexLuminance(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const channel = (offset) => srgbChannelToLinear(parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrastBetween(luminanceA, luminanceB) {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

function toneSummary(tone) {
  return Object.freeze({
    color: tone.color,
    hex: hexString(tone.color),
    metalness: tone.metalness,
    roughness: tone.roughness,
    envMapIntensity: tone.envMapIntensity,
  });
}

/** Surface colour the adaptive pair is resolved against (panel albedo by default). */
function paletteSurfaceHex(options = {}) {
  return normalizeHex(options.surfaceHex) || hexString(MATERIAL_SPEC.face.color);
}

/**
 * Map a user-facing palette value (canonical id or an alias such as `graphite`,
 * `grey`, `brand gold`, `auto`) to a canonical palette id; null when unknown.
 */
export function normalizeLogoPaletteId(value) {
  if (typeof value !== 'string') return null;
  const needle = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!needle) return null;
  for (const [id, palette] of Object.entries(LOGO_PALETTES)) {
    if (id === needle) return id;
    if (Array.isArray(palette.aliases) && palette.aliases.includes(needle)) return id;
  }
  return null;
}

/**
 * Resolve a palette value into concrete render data: the two facet tones, the
 * socket tone, the surface it was resolved against, contrast measurements and
 * the icon-variant provenance. Returns null for an unknown palette value.
 *
 * The result is plain JSON (no three.js objects), so `debug()` embeds it and the
 * QA layer can assert on it.
 */
export function resolveLogoPalette(value, options = {}) {
  const id = normalizeLogoPaletteId(value);
  if (!id) return null;
  const palette = LOGO_PALETTES[id];
  const surfaceHex = paletteSurfaceHex(options);
  const surfaceLuminance = hexLuminance(surfaceHex);

  let tones = palette.tones || null;
  let sources = palette.sources || Object.freeze([]);
  let variant = null;
  let variantLabel = null;
  let decision = null;

  if (palette.adaptive) {
    const scored = Object.entries(palette.adaptive.candidates).map(([key, candidate]) => {
      const luminance = hexLuminance(hexString(candidate.tones.bright.color));
      return Object.freeze({
        id: key,
        label: candidate.label,
        brightLuminance: roundTo(luminance, 4),
        distance: roundTo(Math.abs(luminance - surfaceLuminance), 4),
        contrast: roundTo(contrastBetween(luminance, surfaceLuminance), 2),
      });
    });
    let chosen = scored[0];
    for (const entry of scored) {
      if (entry.distance > chosen.distance) chosen = entry;
    }
    const candidate = palette.adaptive.candidates[chosen.id];
    tones = candidate.tones;
    sources = candidate.sources;
    variant = chosen.id;
    variantLabel = candidate.label;
    decision = Object.freeze({
      rule: palette.adaptive.rule,
      chosen: chosen.id,
      surfaceHex,
      surfaceLuminance: roundTo(surfaceLuminance, 4),
      candidates: Object.freeze(scored),
    });
  }

  // The emblem edge is always the background the mark sits on (round-5 rule),
  // for every palette including adaptive: same albedo and finish as the plate.
  const socket = logoEdgeTone(surfaceHex);
  const brightLuminance = hexLuminance(hexString(tones.bright.color));
  const deepLuminance = hexLuminance(hexString(tones.deep.color));
  const socketLuminance = hexLuminance(surfaceHex);
  return Object.freeze({
    id,
    requested: typeof value === 'string' ? value.trim() : id,
    label: palette.label,
    summary: palette.summary,
    finish: palette.finish,
    variant,
    variantLabel,
    tones: Object.freeze({ bright: toneSummary(tones.bright), deep: toneSummary(tones.deep) }),
    socket: toneSummary(socket),
    edge: Object.freeze({
      rule: 'background tone: the emblem edge is painted with the surface the mark sits on',
      background: true,
      blendsWithSurface: true,
      role: LOGO_EDGE_BACKGROUND.role,
      colorHex: surfaceHex,
    }),
    surface: Object.freeze({ hex: surfaceHex, luminance: roundTo(surfaceLuminance, 4) }),
    contrast: Object.freeze({
      brightVsSurface: roundTo(contrastBetween(brightLuminance, surfaceLuminance), 2),
      deepVsSurface: roundTo(contrastBetween(deepLuminance, surfaceLuminance), 2),
      brightVsDeep: roundTo(contrastBetween(brightLuminance, deepLuminance), 2),
      socketVsSurface: roundTo(contrastBetween(socketLuminance, surfaceLuminance), 2),
    }),
    decision,
    sources,
    geometrySource: LOGO_GEOMETRY_SOURCE,
  });
}

/** Re-tint the three logo materials in place (albedo + finish + provenance). */
function paintLogoMaterial(material, tone, role, paletteId) {
  if (!material) return;
  material.color.copy(workingColorFromHex(tone.color));
  material.metalness = tone.metalness;
  material.roughness = tone.roughness;
  material.envMapIntensity = tone.envMapIntensity;
  material.userData = {
    ...material.userData,
    role,
    specColor: tone.color,
    specColorHex: hexString(tone.color),
    palette: paletteId,
    procedural: true,
    local: true,
  };
}

function paintLogoMaterials(materials, resolved) {
  if (!materials || !resolved) return;
  paintLogoMaterial(materials.goldBright, resolved.tones.bright, 'logo bright facet \u2014 ' + resolved.label, resolved.id);
  paintLogoMaterial(materials.goldDeep, resolved.tones.deep, 'logo deep facet \u2014 ' + resolved.label, resolved.id);
  paintLogoMaterial(materials.socket, resolved.socket, 'emblem edge shoulder (background tone) \u2014 ' + resolved.label, resolved.id);
}

/**
 * Apply a palette to an already-built model: recolours the three logo materials
 * and refreshes `model.logoPalette` / `model.logo.palette`. Geometry, silhouette,
 * relief, camera and triangle count are untouched ??nothing is rebuilt.
 */
export function applyLogoPalette(model, value, options = {}) {
  if (!model || !model.materials) return null;
  const faceHex = model.materials.face && model.materials.face.userData ? model.materials.face.userData.specColorHex : null;
  const resolved = resolveLogoPalette(value, { surfaceHex: options.surfaceHex || faceHex || null });
  if (!resolved) return null;
  paintLogoMaterials(model.materials, resolved);
  model.logoPalette = resolved;
  if (model.logo) model.logo.palette = resolved;
  return resolved;
}

function createMaterials() {
  const materials = {};
  for (const [key, config] of Object.entries(MATERIAL_SPEC)) {
    const material = new THREE.MeshStandardMaterial({
      name: 'shield-' + key,
      color: workingColorFromHex(config.color),
      metalness: config.metalness,
      roughness: config.roughness,
      envMapIntensity: config.envMapIntensity,
      dithering: true,
    });
    material.userData = {
      role: config.role,
      specColor: config.color,
      specColorHex: hexString(config.color),
      procedural: true,
      local: true,
    };
    materials[key] = material;
  }
  return materials;
}

/* ------------------------------------------------------------------- logo */

function buildLogo(options) {
  const { spec, surfaceZ, materials, logoSvgText } = options;
  const logo = spec.logo;
  const group = new THREE.Group();
  group.name = 'shield-logo';
  const parsed = parseTekoLogoSvg(logoSvgText, { curveSegments: logo.curveSegments });
  const bbox = parsed.bbox;
  const scale = logo.width / Math.max(1e-6, bbox.width);
  const sourceCentreX = (bbox.minX + bbox.maxX) / 2;
  const sourceCentreY = (bbox.minY + bbox.maxY) / 2;
  const toModel = (point) =>
    new THREE.Vector2(
      logo.centerX + (point.x - sourceCentreX) * scale,
      logo.centerY - (point.y - sourceCentreY) * scale,
    );

  const parts = [];
  const shapeInfo = [];
  let triangleCount = 0;
  let capTriangleCount = 0;
  let edgeTriangleCount = 0;

  // Model-space contours (CCW, front face +Z) and the per-contour width mask of
  // the background-toned edge shoulder. The mask removes the shoulder where a
  // contour edge is shared with a neighbouring facet or runs tight against it.
  const contours = parsed.shapes.map((shape) => {
    const contour = shape.points.map(toModel);
    if (signedArea(contour) < 0) contour.reverse();
    return contour;
  });
  const centroids = contours.map((contour) => centroidOf(contour));
  const edgeMasks = buildLogoEdgeMasks(contours, centroids, logo);

  for (let shapeIndex = 0; shapeIndex < parsed.shapes.length; shapeIndex += 1) {
    const shape = parsed.shapes[shapeIndex];
    const contour = contours[shapeIndex];
    const centroid = centroids[shapeIndex];
    const isBright = relativeLuminance(shape.fill) > 0.45;
    const capMaterial = isBright ? materials.goldBright : materials.goldDeep;
    const edgeMaterial = materials.socket;

    // --- raised palette-tinted relief cap (the mark itself; unchanged geometry).
    const capGeometry = buildLogoCap(contour, (x, y) => surfaceZ(x, y) + logo.relief, 'cap');
    const capMesh = new THREE.Mesh(capGeometry, capMaterial);
    capMesh.name = 'shield-logo-' + (isBright ? 'bright' : 'deep') + '-' + shapeInfo.length;
    capMesh.castShadow = false;
    capMesh.receiveShadow = false;
    group.add(capMesh);
    const capTriangles = capGeometry.index ? capGeometry.index.count / 3 : 0;
    triangleCount += capTriangles;
    capTriangleCount += capTriangles;
    parts.push({ name: capMesh.name, role: isBright ? 'logo bright facet' : 'logo deep facet', material: capMaterial.name, triangles: capTriangles });

    // --- background-toned edge: rounded shoulder + side wall (one mesh).
    const edgeGeometry = buildLogoEdge({
      contour,
      centroid,
      surfaceZ,
      relief: logo.relief,
      scale: logo.socketScale,
      rings: logo.edgeRings,
      sink: logo.edgeSink,
      mask: edgeMasks[shapeIndex],
    });
    const edgeMesh = new THREE.Mesh(edgeGeometry, edgeMaterial);
    edgeMesh.name = 'shield-logo-edge-' + shapeInfo.length;
    edgeMesh.castShadow = false;
    edgeMesh.receiveShadow = false;
    group.add(edgeMesh);
    const edgeTriangles = edgeGeometry.index ? edgeGeometry.index.count / 3 : 0;
    triangleCount += edgeTriangles;
    edgeTriangleCount += edgeTriangles;
    parts.push({ name: edgeMesh.name, role: 'logo edge shoulder (background tone)', material: edgeMaterial.name, triangles: edgeTriangles });

    shapeInfo.push({
      fill: shape.fill,
      tone: isBright ? 'bright' : 'deep',
      points: contour.length,
      triangles: capTriangles + edgeTriangles,
    });
  }

  return {
    group,
    parts,
    shapes: shapeInfo,
    bbox: {
      width: bbox.width * scale,
      height: bbox.height * scale,
      sourceWidth: bbox.width,
      sourceHeight: bbox.height,
      scale,
    },
    relief: logo.relief,
    width: logo.width,
    /** Background-toned edge rule + geometry budget (reported by debug()). */
    edge: Object.freeze({
      rule: LOGO_EDGE_BACKGROUND.role,
      background: true,
      scale: logo.socketScale,
      rings: logo.edgeRings,
      sink: logo.edgeSink,
      clearance: logo.edgeClearance,
      meshes: parsed.shapes.length,
      triangles: edgeTriangleCount,
    }),
    capTriangleCount,
    triangleCount,
    parsed,
  };
}

function relativeLuminance(hex) {
  const value = String(hex || '#000000').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function centroidOf(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return new THREE.Vector2(x / points.length, y / points.length);
}

/** Triangulated cap draped over the convex panel surface. */
function buildLogoCap(contour, zFunction, role) {
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions = new Float32Array(contour.length * 3);
  for (let i = 0; i < contour.length; i += 1) {
    const x = contour[i].x;
    const y = contour[i].y;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = zFunction(x, y);
  }
  const indices = new Uint32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i += 1) {
    indices[i * 3] = triangles[i][0];
    indices[i * 3 + 1] = triangles[i][1];
    indices[i * 3 + 2] = triangles[i][2];
  }
  const geometry = createIndexedGeometry(positions, indices);
  geometry.computeVertexNormals();
  const normalAttribute = geometry.getAttribute('normal');
  let score = 0;
  for (let i = 0; i < normalAttribute.count; i += 1) score += normalAttribute.getZ(i);
  if (score < 0) {
    flipWinding(geometry);
    geometry.computeVertexNormals();
  }
  geometry.userData = { role };
  return geometry;
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** Point-in-polygon test (even-odd rule) for a closed 2D contour. */
function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a 2D segment. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSquared : 0;
  t = clamp01(t);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Distance from a point to a closed 2D contour boundary. */
function distanceToPolygon(x, y, points) {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    best = Math.min(best, distanceToSegment(x, y, points[j].x, points[j].y, points[i].x, points[i].y));
  }
  return best;
}

/**
 * Width mask of the background-toned edge shoulder, one value per contour point.
 *
 * A shoulder is only wanted where the mark borders the plate: shared contour
 * edges (the two-tone facet splits) and the tight notches between the three
 * sub-shapes must not get one, or two neighbouring shoulders would cross each
 * other and speckle. Each contour point is therefore projected to its shoulder
 * foot (the contour scaled about its own centroid, the round-4 footprint) and
 * the point is masked out when that foot lands inside another sub-shape or
 * closer to it than `edgeClearance`. Two circular smoothing passes then let the
 * shoulder taper to nothing instead of ending in a step.
 */
function buildLogoEdgeMasks(contours, centroids, logo) {
  const scale = logo.socketScale;
  const clearance = Math.max(1e-6, logo.edgeClearance);
  return contours.map((contour, shapeIndex) => {
    const centroid = centroids[shapeIndex];
    const raw = new Float64Array(contour.length);
    for (let i = 0; i < contour.length; i += 1) {
      const point = contour[i];
      const footX = centroid.x + (point.x - centroid.x) * scale;
      const footY = centroid.y + (point.y - centroid.y) * scale;
      let value = 1;
      for (let other = 0; other < contours.length && value > 0; other += 1) {
        if (other === shapeIndex) continue;
        if (pointInPolygon(footX, footY, contours[other])) value = 0;
        else if (distanceToPolygon(footX, footY, contours[other]) < clearance) value = 0;
      }
      raw[i] = value;
    }
    let values = raw;
    const n = values.length;
    for (let pass = 0; pass < 2; pass += 1) {
      const next = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        next[i] = 0.25 * values[(i - 1 + n) % n] + 0.5 * values[i] + 0.25 * values[(i + 1) % n];
      }
      values = next;
    }
    const mask = new Float64Array(n);
    for (let i = 0; i < n; i += 1) mask[i] = values[i] < 0.02 ? 0 : values[i];
    return mask;
  });
}

/**
 * Background-toned edge around one emblem contour.
 *
 * Round 4's edge was a contrasting socket cap floating above the panel plus a
 * palette-coloured vertical skirt: a dark (polished silver for graphite) ~6 %
 * outline with a razor rim, which dithered into a speckled line at grazing
 * angles. It is now a rounded shoulder in the shield's **background tone** that
 * ramps from the raised cap edge down into the plate. The profile is a
 * smoothstep, so the shoulder leaves the cap and meets the panel with zero slope:
 * no sharp rim, no foot line, and smooth analytic normals across the whole band
 * (the cap and the panel share the same normal at the seams). Where the mask is
 * 0 the band collapses to a subtle background-toned side wall instead, which
 * keeps the internal facet split crisp and fills the seam between the caps.
 */
function buildLogoEdge(options) {
  const { contour, centroid, surfaceZ, relief, scale, rings, sink, mask } = options;
  const count = contour.length;
  const steps = Math.max(2, Math.round(rings));
  const ringCount = steps + 1;
  const totalHeight = relief + sink;

  const travel = new Float64Array(count);
  const dirX = new Float64Array(count);
  const dirY = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const point = contour[i];
    const dx = centroid.x + (point.x - centroid.x) * scale - point.x;
    const dy = centroid.y + (point.y - centroid.y) * scale - point.y;
    const length = Math.hypot(dx, dy) || 1e-9;
    dirX[i] = dx / length;
    dirY[i] = dy / length;
    travel[i] = length * (mask ? mask[i] : 1);
  }

  const positions = new Float32Array(count * ringCount * 3);
  const normals = new Float32Array(count * ringCount * 3);
  const gradientStep = 0.0006;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const t = ring / steps;
    const eased = smoothstep01(t);
    const profileSlope = 6 * t * (1 - t); // smoothstep derivative: 0 at both ends
    for (let i = 0; i < count; i += 1) {
      const point = contour[i];
      const x = point.x + dirX[i] * travel[i] * t;
      const y = point.y + dirY[i] * travel[i] * t;
      const z = surfaceZ(x, y) + relief * (1 - eased) - sink * eased;
      const offset = (i * ringCount + ring) * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;

      let nx;
      let ny;
      let nz;
      if (travel[i] > 1e-7) {
        const dhdd = (-totalHeight * profileSlope) / travel[i];
        const fx = (surfaceZ(x + gradientStep, y) - surfaceZ(x - gradientStep, y)) / (2 * gradientStep);
        const fy = (surfaceZ(x, y + gradientStep) - surfaceZ(x, y - gradientStep)) / (2 * gradientStep);
        nx = -(fx + dhdd * dirX[i]);
        ny = -(fy + dhdd * dirY[i]);
        nz = 1;
      } else {
        // Collapsed to the side wall: shade it as the vertical face it is.
        nx = dirX[i];
        ny = dirY[i];
        nz = 0;
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[offset] = nx / length;
      normals[offset + 1] = ny / length;
      normals[offset + 2] = nz / length;
    }
  }

  const indices = [];
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    if (travel[i] <= 1e-7 && travel[next] <= 1e-7) continue;
    for (let ring = 0; ring < steps; ring += 1) {
      const a = i * ringCount + ring;
      const b = next * ringCount + ring;
      const c = next * ringCount + ring + 1;
      const d = i * ringCount + ring + 1;
      // CCW contour, ring 0 at the cap edge: (a, d, c) / (a, c, b) face +Z.
      indices.push(a, d, c, a, c, b);
    }
  }

  const geometry = createIndexedGeometry(positions, new Uint32Array(indices));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  // Guard the winding (analytic normals mean computeVertexNormals cannot vote).
  const index = geometry.getIndex();
  let windingScore = 0;
  for (let i = 0; i + 2 < index.count; i += 3) {
    const ia = index.getX(i);
    const ib = index.getX(i + 1);
    const ic = index.getX(i + 2);
    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const bx = positions[ib * 3];
    const by = positions[ib * 3 + 1];
    const cx = positions[ic * 3];
    const cy = positions[ic * 3 + 1];
    windingScore += (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }
  if (windingScore < 0) flipWinding(geometry);
  geometry.userData = { role: 'logo-edge' };
  return geometry;
}

/* ----------------------------------------------------------------- model */

function buildFrontGeometry(segments, thetaTargets, spec, materials) {
  const group = new THREE.Group();
  group.name = 'shield-front';
  const parts = [];
  const thickness = spec.thickness;
  const panelInset = spec.front.panelInset;
  const rings = (definitions) =>
    definitions.map((definition) => ({
      points: sampleOffsetRing(segments, definition.d, thetaTargets, spec.center),
      z: definition.z,
    }));

  const bands = [
    {
      name: 'shield-wall',
      role: 'body wall',
      material: materials.body,
      expectedNormal: 'radial',
      rings: rings([
        { d: -0.0008, z: -thickness },
        { d: -0.0016, z: -thickness + 0.012 },
        { d: -0.0024, z: -0.066 },
        { d: -0.003, z: -0.036 },
        { d: -0.0029, z: -0.016 },
        { d: -0.0018, z: -0.007 },
      ]),
    },
    {
      name: 'shield-bevel',
      role: 'polished outer bevel',
      material: materials.bevel,
      expectedNormal: 'front',
      rings: rings([
        { d: -0.0009, z: -0.003 },
        { d: 0.0, z: 0.0 },
        { d: 0.002, z: 0.005 },
        { d: 0.006, z: 0.0125 },
        { d: 0.011, z: 0.0185 },
        { d: 0.016, z: 0.0235 },
        { d: 0.02, z: spec.front.bevelCrestZ },
      ]),
    },
    {
      name: 'shield-rim',
      role: 'rim shoulder',
      material: materials.body,
      expectedNormal: 'front',
      rings: rings([
        { d: 0.02, z: 0.0257 },
        { d: 0.024, z: 0.0235 },
      ]),
    },
    {
      name: 'shield-groove',
      role: 'recessed groove',
      material: materials.groove,
      expectedNormal: 'front',
      rings: rings([
        { d: 0.024, z: 0.0215 },
        { d: 0.0265, z: 0.013 },
        { d: 0.029, z: 0.0112 },
        { d: 0.0315, z: 0.0116 },
        { d: 0.035, z: 0.0138 },
      ]),
    },
    {
      name: 'shield-panel-lip',
      role: 'panel lip',
      material: materials.bevel,
      expectedNormal: 'front',
      rings: rings([
        { d: 0.035, z: 0.0148 },
        { d: 0.042, z: 0.018 },
      ]),
    },
  ];

  for (const band of bands) {
    const geometry = buildBandGeometry(band.rings, { expectedNormal: band.expectedNormal });
    const mesh = new THREE.Mesh(geometry, band.material);
    mesh.name = band.name;
    mesh.userData = { role: band.role };
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    const triangles = geometry.index ? geometry.index.count / 3 : 0;
    parts.push({ name: band.name, role: band.role, material: band.material.name, triangles });
  }

  // Convex panel: homothetic rings from the panel edge towards the star centre.
  const panelEdge = sampleOffsetRing(segments, panelInset, thetaTargets, spec.center);
  const center = spec.center;
  const panelRingCount = spec.front.panelRings;
  const panelRings = [];
  for (let ringIndex = 0; ringIndex < panelRingCount; ringIndex += 1) {
    const s = ringIndex / panelRingCount;
    const z = spec.front.panelEdgeZ + spec.front.panelBulge * (1 - (1 - s) * (1 - s));
    panelRings.push({
      points: panelEdge.map((point) => new THREE.Vector2(center.x + (point.x - center.x) * (1 - s), center.y + (point.y - center.y) * (1 - s))),
      z,
    });
  }
  const panelGeometry = buildBandGeometry(panelRings, {
    expectedNormal: 'front',
    centre: { x: center.x, y: center.y, z: spec.front.panelEdgeZ + spec.front.panelBulge },
  });
  const panelMesh = new THREE.Mesh(panelGeometry, materials.face);
  panelMesh.name = 'shield-panel';
  panelMesh.userData = { role: 'convex face panel' };
  group.add(panelMesh);
  const panelTriangles = panelGeometry.index ? panelGeometry.index.count / 3 : 0;
  parts.push({ name: 'shield-panel', role: 'convex face panel', material: materials.face.name, triangles: panelTriangles });

  return { group, parts };
}

function buildBackGeometry(segments, thetaTargets, spec, materials) {
  const group = new THREE.Group();
  group.name = 'shield-back';
  const edge = sampleOffsetRing(segments, -0.0008, thetaTargets, spec.center);
  const center = spec.center;
  const backZ = -spec.thickness;
  const ringCount = spec.front.backRings;
  const panelRings = [];
  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const s = ringIndex / ringCount;
    const z = backZ - spec.front.backBulge * (1 - (1 - s) * (1 - s));
    panelRings.push({
      points: edge.map((point) => new THREE.Vector2(center.x + (point.x - center.x) * (1 - s), center.y + (point.y - center.y) * (1 - s))),
      z,
    });
  }
  const geometry = buildBandGeometry(panelRings, {
    expectedNormal: 'back',
    centre: { x: center.x, y: center.y, z: backZ - spec.front.backBulge },
  });
  const mesh = new THREE.Mesh(geometry, materials.back);
  mesh.name = 'shield-back-plate';
  mesh.userData = { role: 'machined back plate' };
  group.add(mesh);
  const triangles = geometry.index ? geometry.index.count / 3 : 0;
  return { group, parts: [{ name: 'shield-back-plate', role: 'machined back plate', material: materials.back.name, triangles }] };
}

function buildFitPoints(outline, spec) {
  const points = [];
  const step = Math.max(1, Math.floor(outline.length / 128));
  for (let i = 0; i < outline.length; i += step) {
    for (const z of [-spec.thickness, -spec.thickness * 0.5, -0.02, 0, spec.front.bevelCrestZ, spec.front.panelEdgeZ + spec.front.panelBulge]) {
      points.push(outline[i].x, outline[i].y, z);
    }
  }
  points.push(0, spec.logo.centerY, spec.front.panelEdgeZ + spec.front.panelBulge + spec.logo.relief);
  return new Float32Array(points);
}

/**
 * Create the shield model.
 *
 * @param {object} options
 * @param {string} options.logoSvgText  UTF-8 text of assets/shield/teko2_icon.svg
 * @param {string} [options.logoSourcePath]  provenance path reported by debug()
 * @param {string} [options.logoPalette]  palette id or alias (LOGO_PALETTES); defaults to 'gold'
 * @param {string} [options.logoSurfaceHex]  surface colour the adaptive palette resolves against (defaults to the panel albedo)
 * @param {number} [options.quality]  reserved (hero / preview); geometry is fixed
 * @returns {object} model
 */
export function createShieldModel(options = {}) {
  const spec = SHIELD_SPEC;
  const warnings = [];
  const segments = buildShieldSegments(spec);
  const outline = buildShieldOutline(spec);
  const thetaTargets = outline.map((point) => Math.atan2(point.y - spec.center.y, point.x - spec.center.x));
  const panelEdgeRing = sampleOffsetRing(segments, spec.front.panelInset, thetaTargets, spec.center);
  const polar = buildPolarTables(outline, panelEdgeRing, spec);
  const surfaceZ = (x, y) => panelSurfaceZ(x, y, polar, spec);
  const materials = createMaterials();
  const surfaceHex = options.logoSurfaceHex || (materials.face.userData ? materials.face.userData.specColorHex : null);

  // Resolve + paint the requested emblem palette BEFORE the logo is built, so the
  // first frame already carries the right finish and `model.logo.palette` is set.
  const requestedPalette = options.logoPalette === undefined || options.logoPalette === null ? DEFAULT_LOGO_PALETTE : options.logoPalette;
  let logoPalette = resolveLogoPalette(requestedPalette, { surfaceHex });
  if (!logoPalette) {
    warnings.push(
      'unknown logo palette "' + String(requestedPalette) + '"; using ' + DEFAULT_LOGO_PALETTE + ' (expected ' + LOGO_PALETTE_IDS.join('|') + ')',
    );
    logoPalette = resolveLogoPalette(DEFAULT_LOGO_PALETTE, { surfaceHex });
  }
  paintLogoMaterials(materials, logoPalette);

  const root = new THREE.Group();
  root.name = 'shield-root';

  const front = buildFrontGeometry(segments, thetaTargets, spec, materials);
  root.add(front.group);
  const back = buildBackGeometry(segments, thetaTargets, spec, materials);
  root.add(back.group);

  let logo = null;
  if (typeof options.logoSvgText === 'string' && options.logoSvgText.length > 0) {
    try {
      logo = buildLogo({ spec, surfaceZ, materials, logoSvgText: options.logoSvgText });
      root.add(logo.group);
    } catch (error) {
      warnings.push('logo relief failed: ' + (error && error.message ? error.message : error));
      logo = null;
    }
  } else {
    warnings.push('no logo SVG source supplied; shield built without the TEKO emblem');
  }

  const parts = [...front.parts, ...back.parts];
  if (logo) parts.push(...logo.parts);
  let triangles = 0;
  for (const part of parts) triangles += part.triangles;

  const bounds = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  const fitPoints = buildFitPoints(outline, spec);

  const model = {
    version: MODEL_VERSION,
    spec,
    cameraSpec: CAMERA_SPEC,
    root,
    materials,
    outline,
    segments,
    bounds: { min: bounds.min.clone(), max: bounds.max.clone(), center, size },
    fitPoints,
    /** Resolved emblem palette currently painted on the logo materials. */
    logoPalette,
    logo: logo
      ? {
          source: options.logoSourcePath || LOGO_SOURCE_PATH,
          geometrySource: LOGO_GEOMETRY_SOURCE,
          palette: logoPalette,
          sourceBbox: logo.parsed.bbox,
          width: logo.width,
          height: logo.bbox.height,
          relief: logo.relief,
          shapes: logo.shapes,
          parts: logo.parts,
          triangleCount: logo.triangleCount,
          edge: logo.edge,
        }
      : null,
    stats: {
      samples: outline.length,
      triangles: Math.round(triangles),
      meshes: parts.length,
      parts,
    },
    warnings,
    /**
     * Switch the emblem palette in place. Recolours the three logo materials and
     * updates `logoPalette` / `logo.palette`; the geometry is not rebuilt, so the
     * shield's silhouette, relief, triangle count and camera are unchanged.
     * Returns the resolved palette, or null for an unknown value.
     */
    setLogoPalette(value, paletteOptions = {}) {
      return applyLogoPalette(model, value, {
        surfaceHex: paletteOptions.surfaceHex || surfaceHex,
      });
    },
    dispose() {
      root.traverse((object) => {
        if (object.isMesh) {
          if (object.geometry) object.geometry.dispose();
        }
      });
      for (const material of Object.values(materials)) {
        if (material && typeof material.dispose === 'function') material.dispose();
      }
    },
  };
  return model;
}

