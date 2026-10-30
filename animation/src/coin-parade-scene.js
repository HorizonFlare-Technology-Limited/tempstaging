/**
 * coin-parade-scene.js — three.js material tuning for the coin Parade mode
 * (SPEC "Collection Revision 14"). Kept separate from the shared coin model and
 * from the page runtime so the mode can be built and reviewed in a cache proof
 * page without touching the shared scenes.
 *
 * Look (from the Revolut reference): pure-black void lit by the shared room
 * photo (Revision 21: assets/env/modern-empty-room.jpg through src/env-room.js —
 * no THREE lights and no strip/softbox PMREM studio), long silver highlight
 * streaks are reflections of the photo's ceiling downlights, one cool blue
 * strip accent is gone (the room photo is neutral), and black distance fog dims
 * the far arc. No floor, no shadows, no glow, no post-processing. Coins stay
 * neutral silver.
 */

import * as THREE from 'three';
import { ENV_ROOM } from './env-room.js';

const ENV_ROOM_LABEL = ENV_ROOM.url + ' (PMREM, env-room)';

/**
 * Auditable studio description (colors / roles / intensity tuning).
 * The page and the offline verifier read this object.
 */
export const PARADE_STUDIO = Object.freeze({
  version: '1.0.0',
  background: 0x000000,
  toneMapping: 'ACESFilmic',
  exposure: 1.05,
  environment: Object.freeze({
    // Rev21: the only light source is the page's shared room-env texture.
    shared: true,
    label: ENV_ROOM_LABEL,
  }),
  fog: Object.freeze({ color: 0x000000 }),
  shadows: false,
  postProcessing: false,
  materialTuning: Object.freeze({
    face: Object.freeze({ envMapIntensity: 1.05, roughness: 0.8, clearcoat: 0, color: 0xa9aeb4, normalScale: 1.2 }),
    band: Object.freeze({ envMapIntensity: 1.9, roughness: 1.0 }),
    frame: Object.freeze({ envMapIntensity: 1.9, roughness: 0.14 }),
    wall: Object.freeze({ envMapIntensity: 0.72 }),
  }),
});

/**
 * Build the Parade-mode set. Rev21: no lights and no private PMREM studio — the
 * set is lit by the page's shared room environment (src/env-room.js), passed in
 * as `room`. The studio only owns the black void look (fog + renderer settings)
 * and the mode-local material clones.
 *
 * @param {{renderer?: THREE.WebGLRenderer, room?: object}} options
 * @returns {{group: THREE.Group, environment: {texture: THREE.Texture, shared: boolean} | null,
 *   fog: THREE.Fog, frame: Function, debug: Function, dispose: Function}}
 */
export function createParadeStudio({ renderer, room } = {}) {
  if (!renderer) throw new Error('coin-parade-scene: createParadeStudio requires a renderer');

  const group = new THREE.Group();
  group.name = 'coin-parade-studio';

  // Rev21: the shared room-env texture (owned by the page) — never disposed here.
  const environment = room && room.texture ? { texture: room.texture, shared: true } : null;

  const fog = new THREE.Fog(new THREE.Color(PARADE_STUDIO.fog.color).getHex(), 0.1, 1);
  fog.color.setHex(PARADE_STUDIO.fog.color);
  const state = {
    disposed: false,
    environmentReady: Boolean(environment),
    fogNear: fog.near,
    fogFar: fog.far,
  };

  let disposed = false;
  return {
    group,
    environment,
    /** black distance fog; the page applies it to its scene and updates the range */
    fog,
    /** enforce the Parade renderer settings + fog for a given camera distance */
    applySceneSettings(scene, { cameraDistance, exposure = PARADE_STUDIO.exposure } = {}) {
      if (!scene) return null;
      scene.background = new THREE.Color(PARADE_STUDIO.background);
      if (environment) scene.environment = environment.texture;
      const distance = Number.isFinite(cameraDistance) ? cameraDistance : 16;
      fog.color.setHex(PARADE_STUDIO.fog.color);
      fog.near = distance * 0.82;
      fog.far = distance * 1.34;
      scene.fog = fog;
      if (renderer) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = exposure;
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
      state.fogNear = fog.near;
      state.fogFar = fog.far;
      return { fogNear: fog.near, fogFar: fog.far };
    },
    /** deterministic: the studio is static, so frame() is a stable no-op hook */
    frame(seconds) {
      void seconds;
      return state;
    },
    debug() {
      return {
        version: PARADE_STUDIO.version,
        environment: ENV_ROOM_LABEL,
        environmentTexture: Boolean(environment),
        lights: [],
        fog: { color: PARADE_STUDIO.fog.color, near: state.fogNear, far: state.fogFar },
        shadows: PARADE_STUDIO.shadows,
        postProcessing: PARADE_STUDIO.postProcessing,
        toneMapping: PARADE_STUDIO.toneMapping,
        exposure: renderer ? renderer.toneMappingExposure : PARADE_STUDIO.exposure,
        disposed,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      state.disposed = true;
      group.removeFromParent();
      sceneRemoveAll(group);
      // No lights; the shared room-env texture is owned by the page and the fog
      // has no GPU resources of its own.
    },
  };
}

function sceneRemoveAll(group) {
  while (group.children.length) group.remove(group.children[0]);
  group.clear();
}

/**
 * Mode-local material clones for one coin. The shared coin-bank materials are
 * never mutated: each mesh gets a fresh clone with Parade tuning suitable for
 * the black room-lit set (brighter reflections on the reeded band and polished
 * frame, mid-silver satin face).
 *
 * @param {object} coin coin returned by bank.createCoin()
 * @returns {{materials: THREE.Material[], meshes: THREE.Mesh[], originals: Map,
 *   dispose: Function, restore: Function}}
 */
export function prepareParadeCoin(coin) {
  if (!coin || !coin.group) throw new Error('coin-parade-scene: prepareParadeCoin requires a coin');
  const tuning = PARADE_STUDIO.materialTuning;
  const meshes = [];
  coin.group.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });

  const originals = new Map();
  const materials = [];
  for (const mesh of meshes) {
    const original = mesh.material;
    if (!original) continue;
    const clone = original.clone();
    const role = mesh.name === 'band' ? 'band' : mesh.name === 'frame' ? 'frame' : mesh.name === 'wall' ? 'wall' : /^relief/.test(mesh.name) ? 'relief' : 'face';
    if (role === 'relief') continue; // rev5 s27: raised white relief keeps its own white material
    const tint = tuning[role] || tuning.face;
    clone.name = original.name + '-parade';
    if (Number.isFinite(tint.envMapIntensity)) clone.envMapIntensity = tint.envMapIntensity;
    if (Number.isFinite(tint.roughness)) clone.roughness = tint.roughness;
    if (Number.isFinite(tint.clearcoat)) clone.clearcoat = tint.clearcoat;
    if (Number.isFinite(tint.color)) clone.color = new THREE.Color(tint.color);
    if (Number.isFinite(tint.normalScale) && clone.normalScale) clone.normalScale.set(tint.normalScale, tint.normalScale);
    clone.fog = true;
    clone.needsUpdate = true;
    originals.set(mesh, original);
    materials.push(clone);
    mesh.material = clone;
  }

  return {
    materials,
    meshes,
    originals,
    /** put the shared bank materials back on the meshes (page mode exit) */
    restore() {
      for (const [mesh, original] of originals) {
        if (mesh.material === originals.get(mesh) || mesh.material) {
          mesh.material = original;
        }
      }
    },
    dispose() {
      for (const material of materials) material.dispose();
      materials.length = 0;
      originals.clear();
    },
  };
}
