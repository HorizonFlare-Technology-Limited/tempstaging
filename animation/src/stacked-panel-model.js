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
 * - Duration 6.5 s: panels 0.0-3.0, card 3.0-3.8, tags 3.8-5.6, hold to 6.5.
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

const DURATION = 6.5;
const PHASES = deepFreeze({
  panelsStart: 0,
  panelsEnd: 3.0,
  cardStart: 3.0,
  cardEnd: 3.8,
  tagsStart: 3.8,
  tagsEnd: 5.6,
  holdEnd: 6.5,
  panelStagger: 0.5,
  panelRiseDuration: 0.5,
  cardFadeDuration: 0.8,
  tagWaveStagger: 0.6,
  tagWaveDuration: 0.6,
});

/* ------------------------------------------------------------------------- */
/* Panel / card / tag geometry (pure data)                                   */
/* ------------------------------------------------------------------------- */

const PANEL_GEOMETRY = deepFreeze({
  sides: 6, // rounded hexagon terraces
  cornerRadiusFraction: 0.34, // corner rounding as a fraction of the circumradius
  samplesPerSide: 8, // curve samples per side for the rounded polygon
  thickness: 0.22,
  layerGap: 0, // layers stack directly on each other
  // radii bottom (index 0, biggest) -> top (index 5, smallest)
  radii: [2.7, 2.24, 1.83, 1.47, 1.16, 0.9],
  yawDeg: [0, 30, 0, 30, 0, 30], // alternate facet orientation, like the reference
  plane: { radius: 9.0, thickness: 0.06, topY: 0 },
});

const LAYER_TOP_BOTTOM = 0; // layer 0 is the bottom (biggest) terrace
const LAYER_COUNT = PANEL_GEOMETRY.radii.length;

function layerBaseY(index) {
  return PANEL_GEOMETRY.plane.topY + index * (PANEL_GEOMETRY.thickness + PANEL_GEOMETRY.layerGap);
}
function layerTopY(index) {
  return layerBaseY(index) + PANEL_GEOMETRY.thickness;
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
const TAG_WAVES = deepFreeze([
  { wave: 0, labels: ['+100', '+250'], spreadX: 0.72, lift: 0.62 },
  { wave: 1, labels: ['+500', '+750'], spreadX: 1.25, lift: 1.02 },
  { wave: 2, labels: ['+1k', '+2k'], spreadX: 1.85, lift: 1.42 },
]);
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

function buildTagLayout() {
  const tags = [];
  for (const wave of TAG_WAVES) {
    for (let side = 0; side < 2; side += 1) {
      const direction = side === 0 ? -1 : 1;
      const label = wave.labels[side];
      tags.push({
        id: 'tag-' + label.replace('+', ''),
        label,
        wave: wave.wave,
        side: side === 0 ? 'left' : 'right',
        direction,
        width: TAG_GEOMETRY.width,
        height: TAG_GEOMETRY.height,
        startPosition: [direction * 0.12, CARD_CENTRE[1] + 0.16, 0.42],
        finalPosition: [
          direction * wave.spreadX,
          CARD_CENTRE[1] + wave.lift,
          round6(0.42 + wave.wave * 0.12),
        ],
        startTime: round6(PHASES.tagsStart + wave.wave * PHASES.tagWaveStagger),
        endTime: round6(PHASES.tagsStart + wave.wave * PHASES.tagWaveStagger + PHASES.tagWaveDuration),
      });
    }
  }
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
  const baseY = layerBaseY(index);
  return deepFreeze({
    index,
    radius: PANEL_GEOMETRY.radii[index],
    sides: PANEL_GEOMETRY.sides,
    cornerRadiusFraction: PANEL_GEOMETRY.cornerRadiusFraction,
    thickness: PANEL_GEOMETRY.thickness,
    yawDeg: PANEL_GEOMETRY.yawDeg[index],
    baseY: round6(baseY),
    topY: round6(layerTopY(index)),
    position: [0, round6(baseY - (1 - ease) * (PANEL_GEOMETRY.thickness + 0.35)), 0],
    rise: round6(ease),
    progress: round6(progress),
    opacity: round6(ease),
    visible: ease > 0,
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
  if (time < PHASES.cardStart) return 'panels';
  if (time < PHASES.tagsStart) return 'card';
  if (time < PHASES.tagsEnd) return 'tags';
  return 'final';
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
  headroom: 1.5, // empty world above the stack for the copy slot
  targetYFromTop: 1.0, // look this far below the framed top: the card sits low
  near: 0.05,
  far: 120,
});

const BOUNDS_MAX_Y = Math.max(
  TOP_TERRACE_TOP_Y + CARD_GEOMETRY.thickness + 0.02,
  Math.max(...TAGS.map((tag) => tag.finalPosition[1] + TAG_GEOMETRY.height / 2)),
);
const BOUNDS_MAX_X = Math.max(
  PANEL_GEOMETRY.radii[0],
  Math.max(...TAGS.map((tag) => Math.abs(tag.finalPosition[0]) + TAG_GEOMETRY.width / 2)),
);
const COMPOSITION_BOUNDS = deepFreeze({
  min: [-BOUNDS_MAX_X, 0, -PANEL_GEOMETRY.radii[0]],
  max: [BOUNDS_MAX_X, BOUNDS_MAX_Y, PANEL_GEOMETRY.radii[0]],
  center: [0, BOUNDS_MAX_Y / 2, 0],
  size: [BOUNDS_MAX_X * 2, BOUNDS_MAX_Y, PANEL_GEOMETRY.radii[0] * 2],
});

/**
 * Deterministic hero camera. Frames the whole terrace stack with extra headroom
 * above it so the page can put copy in the top area while the card sits low.
 */
export function panelCameraFit(stageWidth = 1440, stageHeight = 900) {
  const fov = CAMERA.fovDeg * DEG;
  const tanHalf = Math.tan(fov / 2);
  const aspect = stageWidth / stageHeight;
  const radiusWorld = PANEL_GEOMETRY.radii[0] * 1.08;
  const topWorld = TOP_TERRACE_TOP_Y + CARD_GEOMETRY.thickness;
  const frameBottom = -PANEL_GEOMETRY.thickness;
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
    thickness: PANEL_GEOMETRY.thickness,
    radiiBottomToTop: PANEL_GEOMETRY.radii.slice(),
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
  tagWaves: [
    { wave: 0, labels: TAG_WAVES[0].labels.slice() },
    { wave: 1, labels: TAG_WAVES[1].labels.slice() },
    { wave: 2, labels: TAG_WAVES[2].labels.slice() },
  ],
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
    easing: 'smootherstep',
    loop: false,
  },
  camera: CAMERA,
  bounds: COMPOSITION_BOUNDS,
  layout: PANEL_LAYOUT,
  reducedMotion: { final: true, time: DURATION },
  shots: [0, 1.6, 3.4, 4.9, 6.5],
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
