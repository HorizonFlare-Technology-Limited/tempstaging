/**
 * stacked-panel-model.js — pure deterministic model for the Rev17 stacked panel +
 * card page (stage: silver-white terraces rising from a flat plate, card low, six
 * amount tags expanding in three waves of two).
 *
 * Reference: K:\HFWorkspace\revolutmedia\images\stacked_panel_and_card.png
 * (silver-white layered rounded-hex terraces rising toward the centre, card on the
 * top terrace, amount pills above; this model keeps our own card model - the page
 * loads it - and provides only the deterministic composition/animation math).
 *
 * Dependency-free: no three.js, DOM, clock or randomness. The previewer consumes
 * CONFIG / LAYOUT / pose(t) / cameraFit and builds the meshes with our card model.
 *
 * Design
 * ------
 * - 6 rounded-hexagon terraces, biggest at the bottom, rising from a flat silver
 *   plane (bottom -> top, one layer at a time).
 * - Card on the top terrace, lying flat-ish, tilted toward the camera, low in the
 *   frame; the framing reserves headroom above for copy.
 * - Two variants: 'a' = silver-white panels + black card (default);
 *   'b' = deep silver-grey panels + white card (config parameter).
 * - 6 amount tags (+100, +250, +500, +750, +1k, +2k) in 3 waves of two expanding
 *   outward from the card; theme-gold accent.
 * - Rev21 s34 loop 8.4 s: panels 0.0-5.0 (2.5 s drop-in, 0.5 s stride, 2.0 s
 *   overlap), card 6.0-6.8 (exactly 1.0 s after the last panel ends), tags
 *   6.8-8.4 (1.1 s each, 0.1 s apart). Panels are identical rounded cuboids.
 * - Rev21 s9 shape: ONE base terrace shape, every panel is that same shape
 *   scaled uniformly by a frozen per-index factor.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smootherstep = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const round6 = (value) => Math.round(value * 1e6) / 1e6;
const round6Vec = (v) => v.map(round6);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/* ------------------------------------------------------------------------- */
/* Timing                                                                    */
/* ------------------------------------------------------------------------- */

// Rev21 s19: "alternate time" = OVERLAP (next panel starts before the previous
// ends). Whole loop = 5.0 s, no blank at the start (panel 0 starts at t=0).
// The model has 6 panels (not 3), so the 5 s total + 2.0 s overlap rule are kept
// and the per-panel appear time follows: 5 x stride + rise = 5.0 with
// rise - stride = 2.0  =>  rise 2.5 s, stride 0.5 s (3-panel spec is 3 s / 1 s).
// Card fade (0.8 s) is slower than the panel opacity ramp (0.5 s). Tags: 1.1 s
// each, consecutive starts 0.1 s apart => each tag overlaps the next by 1.0 s.
const PANEL_COUNT = 6;
// Rev21 s34: panel stack still spans 5.0 s with 2.0 s overlap; the card starts
// exactly STACK_TO_CARD_GAP after the last panel ends, so the loop is 8.4 s.
const PANEL_SPAN = 5.0;
const PANEL_OVERLAP = 2.0;
const STACK_TO_CARD_GAP = 1.0;
const PANEL_RISE_DURATION = (PANEL_SPAN + (PANEL_COUNT - 1) * PANEL_OVERLAP) / PANEL_COUNT; // 2.5
const PANEL_DROP = 1.0; // panels descend from this far above their seat (visible from t=0)
const PANEL_STAGGER = PANEL_RISE_DURATION - PANEL_OVERLAP; // 0.5
const PANEL_FADE = 0.5;
const PANELS_END = (PANEL_COUNT - 1) * PANEL_STAGGER + PANEL_RISE_DURATION; // 5.0
const CARD_FADE = 0.8;
const TAG_STAGGER = 0.1;
const TAG_DURATION = 1.1;
const CARD_START = round6(PANELS_END + STACK_TO_CARD_GAP); // 6.0
const TAGS_START = round6(CARD_START + CARD_FADE); // 6.8 (card finishes as tags begin)
const TAGS_END = round6(TAGS_START + (PANEL_COUNT - 1) * TAG_STAGGER + TAG_DURATION); // 8.4
const LOOP_SECONDS = TAGS_END;
const DURATION = round6(LOOP_SECONDS);
const PHASES = deepFreeze({
  panelsStart: 0,
  panelsEnd: round6(PANELS_END),
  panelOverlap: PANEL_OVERLAP,
  stackToCardGap: STACK_TO_CARD_GAP,
  panelFadeDuration: PANEL_FADE,
  cardStart: CARD_START,
  cardEnd: round6(CARD_START + CARD_FADE),
  tagsStart: round6(TAGS_START),
  tagsEnd: round6(TAGS_END),
  holdEnd: DURATION,
  panelStagger: PANEL_STAGGER,
  panelRiseDuration: PANEL_RISE_DURATION,
  cardFadeDuration: CARD_FADE,
  tagWaveStagger: TAG_STAGGER,
  tagWaveDuration: TAG_DURATION,
});

/* ------------------------------------------------------------------------- */
/* Panel / card / tag geometry (pure data)                                   */
/* ------------------------------------------------------------------------- */

const PANEL_GEOMETRY = deepFreeze({
  sides: 4, // Rev21 s34: rounded cuboids (rounded square footprint, bevelled edges)
  cornerRadiusFraction: 0.34, // corner rounding as a fraction of the circumradius
  samplesPerSide: 8, // curve samples per side for the rounded polygon
  // Rev21 s9: ONE base shape (the biggest, index 0). Every terrace is that same
  // shape scaled uniformly -- scaleFactors are the accepted Rev19 radii ratios
  // (8 dp so the public radii still reproduce 5.4 ... 1.8 exactly).
  baseRadius: 5.4,
  baseThickness: 0.11, // Rev19: 50% thinner (0.22 -> 0.11) at the base scale
  layerGap: 0, // layers stack directly on each other
  scaleFactors: [1, 0.82962963, 0.67777778, 0.54444444, 0.42962963, 0.33333333],
  yawDeg: [45, 45, 45, 45, 45, 45], // Rev21 s34: identical orientation (edges square to the camera)
  plane: { sides: 6, radius: 18.0, thickness: 0.06, topY: 0 },
});
const PANEL_SCALE_FACTORS = PANEL_GEOMETRY.scaleFactors;
// Public bottom->top radii (5.4 ... 1.8) and the uniformly scaled thicknesses.
const PANEL_RADII = PANEL_SCALE_FACTORS.map((scale) => round6(PANEL_GEOMETRY.baseRadius * scale));
const PANEL_THICKNESS = PANEL_SCALE_FACTORS.map((scale) => round6(PANEL_GEOMETRY.baseThickness * scale));

const LAYER_TOP_BOTTOM = 0; // layer 0 is the bottom (biggest) terrace
const LAYER_COUNT = PANEL_GEOMETRY.scaleFactors.length;

function layerThickness(index) {
  return PANEL_GEOMETRY.baseThickness * PANEL_SCALE_FACTORS[index];
}
function layerBaseY(index) {
  // Rev21 s9: uniform scaling also scales each terrace's thickness, so the layers
  // stack on the cumulative scaled thicknesses (base 0.11 down to 0.0367 on top).
  let y = PANEL_GEOMETRY.plane.topY;
  for (let i = 0; i < index; i += 1) y += layerThickness(i) + PANEL_GEOMETRY.layerGap;
  return y;
}
function layerTopY(index) {
  return layerBaseY(index) + layerThickness(index);
}
const TOP_TERRACE_TOP_Y = layerTopY(LAYER_COUNT - 1);

const CARD_GEOMETRY = deepFreeze({
  // our own card model is a rounded rectangle lying in its local XY plane
  width: 2.05,
  height: 1.29,
  thickness: 0.06,
  cornerRadius: 0.13,
  tiltDeg: 24, // face tilted toward the camera while lying on the terrace
  yawDeg: 0,
  lift: 0.004, // tiny lift so the card does not z-fight the terrace
});
// card centre: lying flat on the top terrace, tilted up toward the camera
const CARD_CENTRE = deepFreeze([0, TOP_TERRACE_TOP_Y + CARD_GEOMETRY.thickness / 2 + CARD_GEOMETRY.lift, 0]);

const TAG_AMOUNTS = deepFreeze(['+100', '+250', '+500', '+750', '+1k', '+2k']);
const TAG_GEOMETRY = deepFreeze({
  width: 0.72,
  height: 0.26,
  depth: 0.02,
  cornerRadius: 0.13,
  gapFromCardTop: 0.4,
  accent: '#ffd60a',
  appearScale: 0.62,
  startFromCard: true,
});

/**
 * Rev19: tag positions are random (seeded, so deterministic) and NOT globally
 * symmetric. Candidates are re-drawn until no two tags overlap, no pair mirrors
 * about the card axis, and both sides are used unevenly.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTagPlacements() {
  const w = TAG_GEOMETRY.width;
  const h = TAG_GEOMETRY.height;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rand = mulberry32(19000 + attempt);
    const spots = TAG_AMOUNTS.map(() => ({
      x: (rand() < 0.5 ? -1 : 1) * (0.55 + rand() * 1.35),
      y: 0.4 + rand() * 0.95,
      z: 0.42 + rand() * 0.4,
    }));
    let ok = true;
    for (let i = 0; i < spots.length && ok; i += 1) {
      for (let j = i + 1; j < spots.length; j += 1) {
        const dx = Math.abs(spots[i].x - spots[j].x);
        const dy = Math.abs(spots[i].y - spots[j].y);
        if (dx < w + 0.12 && dy < h + 0.14) ok = false;
        if (Math.abs(spots[i].x + spots[j].x) < 0.3 && dy < 0.3) ok = false; // mirrored pair
      }
    }
    if (spots.some((spot) => Math.abs(spot.x) < 1.35 && spot.y < 0.95)) ok = false; // keep clear of the card face
    const left = spots.filter((spot) => spot.x < 0).length;
    if (ok && left >= 2 && left <= 4) return spots;
  }
  return TAG_AMOUNTS.map((_, i) => ({ x: (i % 2 ? 1 : -1) * (0.7 + i * 0.33), y: 0.6 + ((i * 7) % 5) * 0.28, z: 0.5 }));
}

function buildTagLayout() {
  const spots = randomTagPlacements();
  const tags = [];
  TAG_AMOUNTS.forEach((label, order) => {
    const spot = spots[order];
    const direction = spot.x < 0 ? -1 : 1;
    const startTime = round6(PHASES.tagsStart + order * PHASES.tagWaveStagger);
    tags.push({
      id: 'tag-' + label.replace('+', ''),
      label,
      wave: order >> 1,
      order,
      side: direction < 0 ? 'left' : 'right',
      direction,
      width: TAG_GEOMETRY.width,
      height: TAG_GEOMETRY.height,
      startPosition: [direction * 0.12, CARD_CENTRE[1] + 0.16, 0.42],
      finalPosition: [round6(spot.x), round6(CARD_CENTRE[1] + spot.y), round6(spot.z)],
      startTime,
      endTime: round6(startTime + PHASES.tagWaveDuration),
    });
  });
  return deepFreeze(tags);
}
const TAGS = buildTagLayout();

const PAGE = deepFreeze({
  page: 'stacked-panel.html',
  copySlot: 'top',
  cardAnchor: 'low-centre',
});

/* ------------------------------------------------------------------------- */
/* Variants (materials are data for the previewer)                           */
/* ------------------------------------------------------------------------- */

const VARIANTS = deepFreeze({
  a: {
    id: 'a',
    label: 'Silver-white panels + black card',
    panels: {
      finish: 'silver-white',
      top: '#f7f8fa',
      body: '#eceef1',
      edge: '#c9ced6',
      metalness: 1.0,
      roughness: 0.26,
      edgeRoughness: 0.18,
      envMapIntensity: 1.25,
      glow: null,
    },
    card: { finish: 'black', body: '#0d0f12', ink: '#f3f5f8', metalness: 0.2, roughness: 0.34 },
    studio: { background: '#eef0f3', floor: '#dde1e6', fog: null },
    tag: { background: '#12151a', foreground: '#ffffff', accent: '#ffd60a', border: 'rgba(255,255,255,0.16)' },
  },
  b: {
    id: 'b',
    label: 'Deep silver-grey panels + white card',
    panels: {
      finish: 'deep-silver-grey',
      top: '#aab0b8',
      body: '#8b9199',
      edge: '#5f656d',
      metalness: 1.0,
      roughness: 0.34,
      edgeRoughness: 0.24,
      envMapIntensity: 1.1,
      glow: null,
    },
    card: { finish: 'white', body: '#f5f6f8', ink: '#101317', metalness: 0.1, roughness: 0.3 },
    studio: { background: '#11151b', floor: '#0c1015', fog: null },
    tag: { background: '#f4f5f8', foreground: '#101317', accent: '#ffd60a', border: 'rgba(16,19,23,0.14)' },
  },
});
const DEFAULT_VARIANT = 'a';
function resolveVariant(variant = DEFAULT_VARIANT) {
  return VARIANTS[variant] || VARIANTS[DEFAULT_VARIANT];
}

/* ------------------------------------------------------------------------- */
/* Deterministic pose                                                        */
/* ------------------------------------------------------------------------- */

function panelLayerPose(index) {
  const start = PHASES.panelsStart + index * PHASES.panelStagger;
  const raw = (stateTimeRef.value - start) / PHASES.panelRiseDuration;
  const progress = clamp01(raw);
  const ease = smootherstep(progress);
  // Rev21 s34: the drop-in uses ease-out so motion is visible from the first frame
  // (smootherstep is ~0 for the first 0.3 s); it is the same curve for all panels.
  const moveEase = 1 - Math.pow(1 - progress, 3);
  const baseY = layerBaseY(index);
  const thickness = layerThickness(index);
  return deepFreeze({
    index,
    radius: PANEL_RADII[index],
    baseRadius: PANEL_GEOMETRY.baseRadius,
    // Rev21 s9: every panel is the ONE base shape scaled uniformly by this factor.
    scale: round6(PANEL_SCALE_FACTORS[index]),
    sides: PANEL_GEOMETRY.sides,
    cornerRadiusFraction: PANEL_GEOMETRY.cornerRadiusFraction,
    thickness: round6(thickness),
    yawDeg: PANEL_GEOMETRY.yawDeg[index],
    baseY: round6(baseY),
    topY: round6(layerTopY(index)),
    startTime: round6(start),
    endTime: round6(start + PHASES.panelRiseDuration),
    riseDuration: PANEL_RISE_DURATION,
    position: [0, round6(baseY + (1 - moveEase) * PANEL_DROP), 0],
    rise: round6(ease),
    moveEase: round6(moveEase),
    progress: round6(progress),
    opacity: round6(smootherstep(clamp01((stateTimeRef.value - start) / PANEL_FADE))),
    visible: progress > 0,
  });
}

function cardPose() {
  const raw = (stateTimeRef.value - PHASES.cardStart) / PHASES.cardFadeDuration;
  const progress = clamp01(raw);
  const ease = smootherstep(progress);
  const tilt = CARD_GEOMETRY.tiltDeg * DEG;
  // card local face normal is +Z: lay it flat (normal up) then tilt toward camera
  const half = Math.SQRT1_2;
  const tiltQuat = [Math.sin((tilt - Math.PI / 2) / 2), 0, 0, Math.cos((tilt - Math.PI / 2) / 2)];
  const yaw = CARD_GEOMETRY.yawDeg * DEG;
  const yawQuat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const quaternion = quatMultiply(yawQuat, tiltQuat);
  return deepFreeze({
    progress: round6(progress),
    ease: round6(ease),
    opacity: round6(ease),
    scale: round6(lerp(0.94, 1, ease)),
    position: [CARD_CENTRE[0], round6(CARD_CENTRE[1] + (1 - ease) * 0.22), CARD_CENTRE[2]],
    quaternion: quaternion.map(round6),
    tiltDeg: CARD_GEOMETRY.tiltDeg,
    width: CARD_GEOMETRY.width,
    height: CARD_GEOMETRY.height,
    thickness: CARD_GEOMETRY.thickness,
  });
}

function tagPose(tag) {
  const duration = tag.endTime - tag.startTime;
  const raw = (stateTimeRef.value - tag.startTime) / duration;
  const progress = clamp01(raw);
  const ease = smootherstep(progress);
  return deepFreeze({
    id: tag.id,
    label: tag.label,
    wave: tag.wave,
    side: tag.side,
    progress: round6(progress),
    ease: round6(ease),
    opacity: round6(ease),
    scale: round6(lerp(TAG_GEOMETRY.appearScale, 1, ease)),
    position: [
      round6(lerp(tag.startPosition[0], tag.finalPosition[0], ease)),
      round6(lerp(tag.startPosition[1], tag.finalPosition[1], ease)),
      round6(lerp(tag.startPosition[2], tag.finalPosition[2], ease)),
    ],
    width: tag.width,
    height: tag.height,
    accent: TAG_GEOMETRY.accent,
    visible: ease > 0,
  });
}

/* ------------------------------------------------------------------------- */
/* Public pose API                                                           */
/* ------------------------------------------------------------------------- */

// small module-local holder so the helper functions stay side-effect free API
const stateTimeRef = { value: 0 };

function phaseFor(time) {
  if (time >= DURATION) return 'final';
  if (time >= PHASES.tagsStart) return 'tags';
  if (time >= PHASES.cardStart) return 'card';
  return 'panels';
}

/**
 * Deterministic stacked-panel pose at time t (seconds, clamped to [0, duration]).
 * Panels rise bottom-to-top, then the card fades in, then the tags expand in
 * three waves of two (outer tags later). The variant parameter only selects the
 * material palette and is echoed back; the layout/animation is identical.
 */
export function panelPose(t, variant = DEFAULT_VARIANT) {
  const time = Math.min(DURATION, Math.max(0, Number(t) || 0));
  stateTimeRef.value = time;
  const resolved = resolveVariant(variant);
  const panels = [];
  for (let index = 0; index < LAYER_COUNT; index += 1) panels.push(panelLayerPose(index));
  const card = cardPose();
  const tags = TAGS.map((tag) => tagPose(tag));
  const complete = time >= PHASES.tagsEnd;
  return deepFreeze({
    time: round6(time),
    duration: DURATION,
    phase: phaseFor(time),
    variant: resolved.id,
    variantLabel: resolved.label,
    complete,
    panels,
    card,
    tags,
    plane: {
      visible: true,
      sides: PANEL_GEOMETRY.plane.sides,
      radius: PANEL_GEOMETRY.plane.radius,
      thickness: PANEL_GEOMETRY.plane.thickness,
      topY: PANEL_GEOMETRY.plane.topY,
    },
    palette: resolved,
  });
}

/** Reduced-motion pose: the final composed state, no animation. */
export function stackedPanelReducedMotionPose(variant = DEFAULT_VARIANT) {
  return panelPose(DURATION, variant);
}

/* ------------------------------------------------------------------------- */
/* Camera + projection                                                       */
/* ------------------------------------------------------------------------- */

const CAMERA = deepFreeze({
  fovDeg: 30,
  elevationDeg: 32, // looking down on the terraces like the reference
  fitMargin: 1.1,
  headroom: 2.4, // Rev19: more headroom - the random tags reach higher than the old waves
  targetYFromTop: 1.0, // look this far below the framed top: the card sits low
  near: 0.05,
  far: 120,
});

const BOUNDS_MAX_Y = Math.max(
  TOP_TERRACE_TOP_Y + CARD_GEOMETRY.thickness + 0.02,
  Math.max(...TAGS.map((tag) => tag.finalPosition[1] + TAG_GEOMETRY.height / 2)),
);
const BOUNDS_MAX_X = Math.max(
  PANEL_RADII[0],
  Math.max(...TAGS.map((tag) => Math.abs(tag.finalPosition[0]) + TAG_GEOMETRY.width / 2)),
);
const COMPOSITION_BOUNDS = deepFreeze({
  min: [-BOUNDS_MAX_X, 0, -PANEL_RADII[0]],
  max: [BOUNDS_MAX_X, BOUNDS_MAX_Y, PANEL_RADII[0]],
  center: [0, BOUNDS_MAX_Y / 2, 0],
  size: [BOUNDS_MAX_X * 2, BOUNDS_MAX_Y, PANEL_RADII[0] * 2],
});

/**
 * Deterministic hero camera. Frames the whole terrace stack with extra headroom
 * above it so the page can put copy in the top area while the card sits low.
 */
export function panelCameraFit(stageWidth = 1440, stageHeight = 900) {
  const fov = CAMERA.fovDeg * DEG;
  const tanHalf = Math.tan(fov / 2);
  const aspect = stageWidth / stageHeight;
  // Rev19: framing keeps the pre-doubling width basis (2.7), so the doubled panels
  // read twice as large on screen and the lower terraces run off the stage.
  const radiusWorld = 2.7 * 1.08;
  const topWorld = TOP_TERRACE_TOP_Y + CARD_GEOMETRY.thickness;
  const frameBottom = -PANEL_GEOMETRY.baseThickness;
  const frameTop = topWorld + CAMERA.headroom;
  const frameHeight = frameTop - frameBottom;
  // aim below the framed top so the card/terraces sit in the lower part of the
  // frame and the top area stays free for the page copy
  const targetY = frameTop - CAMERA.targetYFromTop;
  const distanceForWidth = (radiusWorld * CAMERA.fitMargin) / (tanHalf * aspect);
  const distanceForHeight = ((frameHeight / 2) * CAMERA.fitMargin) / tanHalf;
  const distance = Math.max(distanceForWidth, distanceForHeight, 4.5);
  const elevation = CAMERA.elevationDeg * DEG;
  const position = [0, targetY + distance * Math.sin(elevation), distance * Math.cos(elevation)];
  return deepFreeze({
    fovDeg: CAMERA.fovDeg,
    fov,
    elevationDeg: CAMERA.elevationDeg,
    distance: round6(distance),
    target: [0, round6(targetY), 0],
    position: round6Vec(position),
    near: CAMERA.near,
    far: CAMERA.far,
    stage: { width: stageWidth, height: stageHeight },
    aspect: round6(aspect),
    fitMargin: CAMERA.fitMargin,
    framing: {
      bottomWorld: round6(frameBottom),
      topWorld: round6(frameTop),
      headroomWorld: CAMERA.headroom,
      topWorldOfComposition: round6(topWorld),
    },
  });
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a) {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}
function quatMultiply(a, b) {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Project a world point to CSS pixels (origin top-left) for a camera fit result. */
export function projectPoint(worldPoint, camera = panelCameraFit()) {
  const eye = camera.position;
  const target = camera.target;
  const forward = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const rel = [worldPoint[0] - eye[0], worldPoint[1] - eye[1], worldPoint[2] - eye[2]];
  const zCam = dot(forward, rel);
  const tanHalf = Math.tan(camera.fov / 2);
  const aspect = camera.stage.width / camera.stage.height;
  const ndcX = dot(right, rel) / (zCam * tanHalf * aspect);
  const ndcY = dot(up, rel) / (zCam * tanHalf);
  return [round6((ndcX * 0.5 + 0.5) * camera.stage.width), round6((0.5 - ndcY * 0.5) * camera.stage.height)];
}

/**
 * Rounded regular-polygon outline in the XY plane (convex, radius-bounded).
 * Corners are quadratic Bezier arcs; sides are straight segments. Useful for the
 * terrace meshes (extrude/loft in the previewer).
 */
export function roundedPolygonPoints(sides = 6, radius = 1, cornerRadiusFraction = 0.34, samplesPerSide = 8) {
  const n = Math.max(3, Math.round(sides));
  const cornerInset = Math.max(0, Math.min(0.49, cornerRadiusFraction)) * radius;
  const vertices = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (Math.PI * 2 * i) / n + Math.PI / 2;
    vertices.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  const points = [];
  const arcSamples = Math.max(2, samplesPerSide);
  const edgeSamples = Math.max(1, Math.floor(samplesPerSide / 2));
  for (let i = 0; i < n; i += 1) {
    const vertex = vertices[i];
    const next = vertices[(i + 1) % n];
    // corner arc: from a point on the incoming edge to a point on the outgoing edge
    const prev = vertices[(i - 1 + n) % n];
    const dirIn = normalize([prev[0] - vertex[0], prev[1] - vertex[1], 0]);
    const dirOut = normalize([next[0] - vertex[0], next[1] - vertex[1], 0]);
    const arcStart = [vertex[0] + dirIn[0] * cornerInset, vertex[1] + dirIn[1] * cornerInset];
    const arcEnd = [vertex[0] + dirOut[0] * cornerInset, vertex[1] + dirOut[1] * cornerInset];
    for (let s = 0; s <= arcSamples; s += 1) {
      const t = s / arcSamples;
      const mt = 1 - t;
      const x = mt * mt * arcStart[0] + 2 * mt * t * vertex[0] + t * t * arcEnd[0];
      const y = mt * mt * arcStart[1] + 2 * mt * t * vertex[1] + t * t * arcEnd[1];
      points.push([round6(x), round6(y)]);
    }
    const nextDirIn = normalize([vertex[0] - next[0], vertex[1] - next[1], 0]);
    const nextArcStart = [next[0] + nextDirIn[0] * cornerInset, next[1] + nextDirIn[1] * cornerInset];
    for (let s = 1; s < edgeSamples; s += 1) {
      const t = s / edgeSamples;
      points.push([round6(lerp(arcEnd[0], nextArcStart[0], t)), round6(lerp(arcEnd[1], nextArcStart[1], t))]);
    }
  }
  return points;
}

/* ------------------------------------------------------------------------- */
/* Frozen public contract                                                    */
/* ------------------------------------------------------------------------- */

export const PANEL_LAYOUT = deepFreeze({
  page: PAGE,
  terraces: {
    count: LAYER_COUNT,
    sides: PANEL_GEOMETRY.sides,
    cornerRadiusFraction: PANEL_GEOMETRY.cornerRadiusFraction,
    thickness: PANEL_GEOMETRY.baseThickness,
    baseRadius: PANEL_GEOMETRY.baseRadius,
    baseThickness: PANEL_GEOMETRY.baseThickness,
    // Rev21 s9: ONE base shape; every panel is base * scaleFactors[i] (uniform).
    scaleFactors: PANEL_SCALE_FACTORS.slice(),
    uniformScale: true,
    radiiBottomToTop: PANEL_RADII.slice(),
    thicknessBottomToTop: PANEL_THICKNESS.slice(),
    yawDeg: PANEL_GEOMETRY.yawDeg.slice(),
    riseOrder: 'bottom-to-top',
    plane: PANEL_GEOMETRY.plane,
    topTerraceTopY: round6(TOP_TERRACE_TOP_Y),
  },
  card: {
    width: CARD_GEOMETRY.width,
    height: CARD_GEOMETRY.height,
    thickness: CARD_GEOMETRY.thickness,
    cornerRadius: CARD_GEOMETRY.cornerRadius,
    tiltDeg: CARD_GEOMETRY.tiltDeg,
    yawDeg: CARD_GEOMETRY.yawDeg,
    lift: CARD_GEOMETRY.lift,
    position: CARD_CENTRE.slice(),
    anchor: 'low-centre',
    restsOn: 'top-terrace',
  },
  tags: TAGS.map((tag) => ({
    id: tag.id,
    label: tag.label,
    wave: tag.wave,
    side: tag.side,
    startPosition: tag.startPosition.slice(),
    finalPosition: tag.finalPosition.slice(),
    width: tag.width,
    height: tag.height,
    startTime: tag.startTime,
    endTime: tag.endTime,
  })),
  tagWaves: [0, 1, 2].map((wave) => ({ wave, labels: TAG_AMOUNTS.slice(wave * 2, wave * 2 + 2) })),
  tagPlacement: 'random-seeded-asymmetric',
  tagAccent: TAG_GEOMETRY.accent,
  copySlot: 'top',
});

export const PANEL_CONFIG = deepFreeze({
  id: 'stacked-panel',
  version: '1.0.0',
  page: 'stacked-panel.html',
  durationSeconds: DURATION,
  phases: PHASES,
  variants: VARIANTS,
  defaultVariant: DEFAULT_VARIANT,
  animation: {
    panelStagger: PHASES.panelStagger,
    panelRiseDuration: PHASES.panelRiseDuration,
    cardFadeDuration: PHASES.cardFadeDuration,
    tagWaveStagger: PHASES.tagWaveStagger,
    tagWaveDuration: PHASES.tagWaveDuration,
    panelOverlap: PHASES.panelOverlap,
    stackToCardGap: STACK_TO_CARD_GAP,
    panelFadeDuration: PHASES.panelFadeDuration,
    loopSeconds: LOOP_SECONDS,
    panelDrop: PANEL_DROP,
    easing: 'smootherstep',
    loop: false,
  },
  camera: CAMERA,
  bounds: COMPOSITION_BOUNDS,
  layout: PANEL_LAYOUT,
  reducedMotion: { final: true, time: DURATION },
  shots: [0, 1.0, 2.5, CARD_START + 0.4, TAGS_START + 0.8, DURATION],
  projectPoint,
  cameraFit: panelCameraFit,
  pose: panelPose,
});

export const PANEL_DURATION = DURATION;
export const panelConfig = PANEL_CONFIG;
export const stackedPanelConfig = PANEL_CONFIG;

/** Convenience alias for page builders. */
export const STACKED_PANEL_MODEL = deepFreeze({
  config: PANEL_CONFIG,
  duration: DURATION,
  layout: PANEL_LAYOUT,
  bounds: COMPOSITION_BOUNDS,
  pose: panelPose,
  cameraFit: panelCameraFit,
  projectPoint,
  reducedMotionPose: stackedPanelReducedMotionPose,
  variantConfig: resolveVariant,
});
