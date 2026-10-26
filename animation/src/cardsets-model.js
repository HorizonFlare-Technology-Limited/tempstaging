/**
 * tekoanimation — "Card sets" composition model (Unit C).
 *
 * Defines the two authored card SETS shown by `cardsets.html`: the black set
 * (four `dark` cards) and the white set (four `light` cards), each arranged as a
 * layered / fanned row of near-upright cards with their BACKS facing the camera.
 * The rhythm follows `K:\HFWorkspace\refs\round3\card-sets.png` (fig 2): rounded
 * panels standing on a common floor line, heavily overlapped, tops rising to a
 * tall hero then descending, each card slightly rotated and offset in depth.
 *
 * The card itself is NOT built here: geometry, textures and materials come from
 * `src/card-model.js` (`loadCardBank()` / `bank.createCard(id)`) — this module
 * only creates four instances per set and places them.
 *
 * Composition is authored in VIEW-ALIGNED units: `x` = screen right, `y` =
 * screen up, `z` = depth toward the camera (all world units at the target
 * plane). `resolveSlot()` maps a slot to a world position through the fixed
 * camera basis, so the figure rhythm is independent of the stage aspect; a
 * second authored `compact` layout packs the same rhythm for narrow (mobile)
 * stages.
 *
 * Deterministic: no randomness and no time-dependent state here. `applyPose()`
 * is a pure function of elapsed time (and is pinned to t = 0 under ?still/?shot
 * / reduced motion by the page).
 *
 * QA / docs consumers: `SET_SPECS`, `CARD_COUNT`, `CAMERA_SPEC`, `LAYOUTS`,
 * `pickLayout()`, `resolveSlot()`, `compositionTable()` and
 * `resolveBackArtwork()` are exported (read-only, frozen where possible).
 */
import * as THREE from 'three';

export const MODEL_VERSION = '1.0.0';

/* -------------------------------------------------------------------------- */
/* Sets                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The two card sets. Both use the same authored composition; only the card
 * variant differs, so the toggle is a straight material swap.
 * @type {ReadonlyArray<Readonly<object>>}
 */
export const SET_SPECS = Object.freeze([
  Object.freeze({
    id: 'dark',
    label: 'Black set',
    shortLabel: 'Black',
    code: 'BLK',
    setIndex: '01',
    cardId: 'dark',
    cardLabel: 'Dark card',
    name: 'Black set',
    region: 'Four dark cards · backs to camera',
    tagline: 'Dark metal back artwork',
    accent: '#7d8794',
  }),
  Object.freeze({
    id: 'light',
    label: 'White set',
    shortLabel: 'White',
    code: 'WHT',
    setIndex: '02',
    cardId: 'light',
    cardLabel: 'Light card',
    name: 'White set',
    region: 'Four light cards · backs to camera',
    tagline: 'Light metal back artwork',
    accent: '#e6e7e8',
  }),
]);

/** Cards per set (acceptance: four layered cards in every set). */
export const CARD_COUNT = 4;

export function setSpec(setId) {
  return SET_SPECS.find((spec) => spec.id === setId) || SET_SPECS[0];
}

/* -------------------------------------------------------------------------- */
/* Camera                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fixed 3/4 studio camera (contract: ~20-28° azimuth, ~6-10° elevation). The
 * camera never moves during interaction: drag orbits the SET through this fixed
 * view (like the stacked page), and `fitCamera()` keeps it framed at every
 * stage size. Distance is solved numerically by the preview module.
 */
export const CAMERA_SPEC = Object.freeze({
  fov: 23,
  near: 0.1,
  far: 120,
  azimuthDeg: 24,
  elevationDeg: 7,
  fitMargin: 1.04,
});

/* -------------------------------------------------------------------------- */
/* Authored composition                                                        */
/* -------------------------------------------------------------------------- */

const degToRad = (deg) => (deg * Math.PI) / 180;

/**
 * Authored slots. `layer` 0 is nearest the camera (front), 3 is the deepest;
 * within the fan the left cards sit in front of the right ones so every card's
 * right-hand back artwork (lock-up side) stays visible, exactly like the fig-2
 * panels.
 *
 * The `wide` values are the source of truth; `compact` is a second authored
 * table (not a uniform scale) that turns the open row into a taller, tighter
 * fan so the same rhythm reads on a 390 px portrait stage.
 *
 * Screen-space rhythm (wide): card tops rise 0.25 -> 0.63 -> 1.37 -> 0.41 and
 * the bottoms sit on a shared floor line (-1.49 .. -1.61).
 */
export const LAYOUTS = Object.freeze({
  wide: Object.freeze({
    id: 'wide',
    label: 'Open fan',
    targetY: 0.32,
    slots: Object.freeze([
      Object.freeze({ id: 'c1', layer: 0, x: -2.17, y: -0.95, z: 0.68, scale: 0.78, yawDeg: 9.5, pitchDeg: -2.4, rollDeg: -3.6 }),
      Object.freeze({ id: 'c2', layer: 1, x: -0.78, y: -0.72, z: 0.29, scale: 0.9, yawDeg: 4.5, pitchDeg: -1.5, rollDeg: -1.3 }),
      Object.freeze({ id: 'c3', layer: 2, x: 0.45, y: 0.18, z: -0.24, scale: 1.46, yawDeg: -2.8, pitchDeg: -0.7, rollDeg: 0.8 }),
      Object.freeze({ id: 'c4', layer: 3, x: 2.28, y: -0.82, z: -0.61, scale: 0.86, yawDeg: -7.5, pitchDeg: -2.2, rollDeg: 2.6 }),
    ]),
  }),
  compact: Object.freeze({
    id: 'compact',
    label: 'Compact fan',
    targetY: 0.02,
    slots: Object.freeze([
      Object.freeze({ id: 'c1', layer: 0, x: -1.42, y: -1.35, z: 0.5, scale: 0.86, yawDeg: 9.5, pitchDeg: -2.4, rollDeg: -3.6 }),
      Object.freeze({ id: 'c2', layer: 1, x: -0.42, y: -0.85, z: 0.2, scale: 1.0, yawDeg: 4.5, pitchDeg: -1.5, rollDeg: -1.3 }),
      Object.freeze({ id: 'c3', layer: 2, x: 0.56, y: 0.1, z: -0.16, scale: 1.3, yawDeg: -2.8, pitchDeg: -0.7, rollDeg: 0.8 }),
      Object.freeze({ id: 'c4', layer: 3, x: 1.42, y: -1.05, z: -0.5, scale: 0.92, yawDeg: -7.5, pitchDeg: -2.2, rollDeg: 2.6 }),
    ]),
  }),
});

export const LAYOUT_IDS = Object.freeze(Object.keys(LAYOUTS));

/**
 * Pick the authored layout for a stage aspect ratio. Desktop/landscape stages
 * use the open fan; narrow portrait stages use the compact fan. Deterministic,
 * so a fixed viewport always yields the same composition.
 */
export function pickLayout(aspect) {
  return Number(aspect) >= 1.18 ? 'wide' : 'compact';
}

/* -------------------------------------------------------------------------- */
/* Camera basis + slot resolution                                              */
/* -------------------------------------------------------------------------- */

/**
 * Orthonormal camera basis for an azimuth/elevation pair.
 * `dir` points from the target toward the camera; `right` is screen right; `up`
 * is screen up. All vectors unit length.
 */
export function viewBasis(azimuthDeg = CAMERA_SPEC.azimuthDeg, elevationDeg = CAMERA_SPEC.elevationDeg) {
  const az = degToRad(azimuthDeg);
  const el = degToRad(elevationDeg);
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  ).normalize();
  const right = new THREE.Vector3(dir.z, 0, -dir.x);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, dir.clone().negate()).normalize();
  return { dir, right, up };
}

const VIEW_BASIS = viewBasis();

/**
 * Resolve an authored view-aligned slot into a world transform.
 * `position` is world xyz, rotations are degrees for the holder's YXZ Euler,
 * with the card's back turned to the camera by `yawDeg + 180°`.
 */
export function resolveSlot(slot) {
  const { dir, right, up } = VIEW_BASIS;
  const position = new THREE.Vector3()
    .addScaledVector(right, slot.x)
    .addScaledVector(up, slot.y)
    .addScaledVector(dir, slot.z);
  return {
    position: [position.x, position.y, position.z],
    rotationDeg: [slot.pitchDeg, 180 + slot.yawDeg, slot.rollDeg],
    scale: slot.scale,
  };
}

/** The documented composition table for one layout (used by docs + debug). */
export function compositionTable(layoutId = 'wide') {
  const layout = LAYOUTS[layoutId] || LAYOUTS.wide;
  return layout.slots.map((slot) => {
    const resolved = resolveSlot(slot);
    return Object.freeze({
      id: slot.id,
      layer: slot.layer,
      scale: slot.scale,
      yawDeg: slot.yawDeg,
      pitchDeg: slot.pitchDeg,
      rollDeg: slot.rollDeg,
      viewOffset: Object.freeze({ x: slot.x, y: slot.y, z: slot.z }),
      position: Object.freeze(resolved.position.map((value) => Math.round(value * 1000) / 1000)),
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Idle pose (deterministic, pure function of t)                               */
/* -------------------------------------------------------------------------- */

/** Very small studio "breathing": the fan bob + a fraction of a degree of sway. */
export const IDLE = Object.freeze({
  bob: 0.02,
  swayDeg: 0.42,
  rollDeg: 0.09,
  speed: 0.5,
});

const SLOT_PHASE = Object.freeze([0, 1.7, 3.1, 4.6]);

/**
 * Apply the idle pose. Pure in `time` (seconds); the page pins time to 0 in
 * static modes so captures are reproducible.
 */
export function applyPose(set, time, { motion = true } = {}) {
  const t = motion ? Number(time) || 0 : 0;
  const phase = t * IDLE.speed;
  const bob = Math.sin(phase) * IDLE.bob;
  const sway = Math.sin(phase * 0.7) * IDLE.swayDeg;
  set.root.position.y = set.basePositionY + bob;
  set.root.rotation.y = degToRad(sway);
  for (const entry of set.slots) {
    const roll = entry.baseRollDeg + Math.sin(phase * 0.9 + SLOT_PHASE[entry.index]) * IDLE.rollDeg;
    entry.holder.rotation.z = degToRad(roll);
  }
  set.root.updateMatrixWorld(true);
}

/* -------------------------------------------------------------------------- */
/* Set construction                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Create one card set: four cards from the bank, placed by an authored layout.
 *
 * @param {object} bank       `loadCardBank()` result.
 * @param {'dark'|'light'} setId
 * @param {{layout?:string, quality?:string}} [options]
 * @returns {{id:string, spec:object, root:THREE.Group, slots:Array, layout:string,
 *            applyLayout:Function, applyPose:Function, getBounds:Function, dispose:Function}}
 */
export function createCardSet(bank, setId, { layout = 'wide', quality = 'hero' } = {}) {
  const spec = setSpec(setId);
  if (!bank || typeof bank.createCard !== 'function') {
    throw new Error('cardsets-model: loadCardBank() result is required (createCard missing)');
  }
  const layoutSpec = LAYOUTS[layout] || LAYOUTS.wide;
  const root = new THREE.Group();
  root.name = 'cardset-' + spec.id;
  root.rotation.order = 'YXZ';

  const slots = [];
  for (let index = 0; index < CARD_COUNT; index += 1) {
    const card = bank.createCard(spec.cardId, { quality });
    if (!card || !card.group) {
      throw new Error('cardsets-model: card-model returned an invalid card for "' + spec.cardId + '"');
    }
    const holder = new THREE.Group();
    holder.name = 'cardset-' + spec.id + '-slot-' + (index + 1);
    holder.rotation.order = 'YXZ';
    holder.add(card.group);
    root.add(holder);
    slots.push({ index, holder, card, baseRollDeg: 0, transform: null });
  }

  const set = {
    id: spec.id,
    spec,
    root,
    slots,
    layout: layoutSpec.id,
    basePositionY: 0,
    targetY: layoutSpec.targetY,
    applyLayout(nextLayout) {
      const next = LAYOUTS[nextLayout] || LAYOUTS.wide;
      set.layout = next.id;
      set.targetY = next.targetY;
      for (const entry of set.slots) {
        const slot = next.slots[entry.index];
        const resolved = resolveSlot(slot);
        entry.transform = Object.freeze({
          slotId: slot.id,
          layer: slot.layer,
          scale: slot.scale,
          yawDeg: slot.yawDeg,
          pitchDeg: slot.pitchDeg,
          rollDeg: slot.rollDeg,
          viewOffset: Object.freeze({ x: slot.x, y: slot.y, z: slot.z }),
          position: resolved.position,
        });
        entry.baseRollDeg = slot.rollDeg;
        entry.holder.position.set(resolved.position[0], resolved.position[1], resolved.position[2]);
        entry.holder.rotation.set(
          degToRad(resolved.rotationDeg[0]),
          degToRad(resolved.rotationDeg[1]),
          degToRad(resolved.rotationDeg[2]),
        );
        entry.holder.scale.setScalar(resolved.scale);
      }
      set.root.position.y = 0;
      set.root.rotation.y = 0;
      set.root.updateMatrixWorld(true);
      return set;
    },
    applyPose(time, options) {
      applyPose(set, time, options);
      return set;
    },
    getBounds() {
      set.root.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(set.root);
    },
    dispose() {
      for (const entry of set.slots) {
        entry.card.dispose();
        entry.holder.clear();
      }
      root.clear();
    },
  };

  set.applyLayout(layoutSpec.id);
  return set;
}

/* -------------------------------------------------------------------------- */
/* Back-artwork provenance (fallback + info column)                            */
/* -------------------------------------------------------------------------- */

/** Old (schema v1) shared back artwork, still valid until Revision 6 lands. */
const LEGACY_BACK = Object.freeze({ albedo: 'back-albedo.png', orm: 'back-rough.png', normal: 'back-normal.png' });

/**
 * Resolve the back-artwork file names for a set from the live card asset
 * metadata. Revision 6 (schemaVersion 2) carries per-card maps under
 * `back.cards.<id>`; older metadata has a single shared `back` block. Reading it
 * at runtime keeps the page correct across the model integration instead of
 * hard-coding file names.
 *
 * @param {object|null} metadata `bank.metadata`
 * @param {'dark'|'light'} setId
 * @returns {{albedo:string, orm:string|null, normal:string|null, source:string, perCard:boolean}}
 */
export function resolveBackArtwork(metadata, setId) {
  const spec = setSpec(setId);
  const back = metadata && metadata.back ? metadata.back : null;
  if (back && back.cards && back.cards[spec.cardId]) {
    const entry = back.cards[spec.cardId];
    return {
      albedo: String(entry.albedo || LEGACY_BACK.albedo),
      orm: entry.orm ? String(entry.orm) : null,
      normal: entry.normal ? String(entry.normal) : null,
      source: String((back.artwork && back.artwork.provenance) || 'reconstructed card-back artwork'),
      perCard: true,
    };
  }
  return {
    albedo: String((back && back.albedo) || LEGACY_BACK.albedo),
    orm: String((back && back.rough) || LEGACY_BACK.orm),
    normal: String((back && back.normal) || LEGACY_BACK.normal),
    source: 'shared engraved-arrow back artwork',
    perCard: false,
  };
}

/**
 * QA / docs description of the authored composition (no THREE objects), used by
 * `debug().pose` and docs/cardsets.md.
 */
export function describeComposition() {
  return LAYOUT_IDS.map((layoutId) => ({
    id: layoutId,
    label: LAYOUTS[layoutId].label,
    targetY: LAYOUTS[layoutId].targetY,
    slots: compositionTable(layoutId),
  }));
}

export const CARD_LAYOUT = Object.freeze({
  count: CARD_COUNT,
  facing: 'back',
  orientation: 'near-upright',
  arrangement: 'layered fan, heavy overlap, staggered depth',
});
