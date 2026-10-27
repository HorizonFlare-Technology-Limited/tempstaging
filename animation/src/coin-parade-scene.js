/**
 * coin-parade-scene.js — three.js studio + material tuning for the coin Parade
 * mode (SPEC "Collection Revision 14"). Kept separate from the shared coin
 * model and from the page runtime so the mode can be built and reviewed in a
 * cache proof page without touching the shared scenes.
 *
 * Look (from the Revolut reference): pure-black void, long thin white strip
 * emitters (left / right / overhead / behind) that draw long silver highlight
 * streaks on the reeded edges, one cool blue strip for the faint rim accent,
 * a very dim white fill panel, soft white key/fill lights for the satin faces,
 * and black distance fog for the dim far arc. No floor, no shadows, no glow,
 * no post-processing. Coins stay neutral silver; blue only appears in rim
 * reflections.
 */

import * as THREE from 'three';

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
    blackVoid: true,
    pmremSigma: 0.06,
    stripCount: 7,
    blueStripCount: 1,
    fillPanel: true,
  }),
  strips: Object.freeze({
    // long vertical white strips on the left/right walls
    side: Object.freeze({ count: 2, width: 0.16, height: 9.5, depth: 0.16, x: 6.4, intensity: 9.0 }),
    // long horizontal white strips overhead
    overhead: Object.freeze({ count: 2, width: 0.12, length: 14, height: 0.12, y: 6.6, zOffset: 2.4, intensity: 5.0 }),
    // one long white strip behind the carousel (rim catch on the far arc)
    back: Object.freeze({ width: 14, height: 0.14, depth: 0.14, y: 3.4, z: -7.2, intensity: 4.0 }),
    // one cool blue strip: the faint rim accent of the reference
    // one long cool blue strip at the left of the set: the faint blue line that
    // catches the polished rims in the reference (never a face tint)
    blue: Object.freeze({ color: 0x5b95ff, intensity: 22.0, width: 0.25, height: 7.0, depth: 0.25, x: -6.2, y: 0.8, z: 2.0 }),
    // very dim white fill panel in front to keep the satin faces readable
    fill: Object.freeze({ color: 0x8f9aa8, intensity: 0.35, width: 8, height: 5, z: 7.5 }),
    // two broad softboxes left/right: the long satin sheen gradient on the faces
    softbox: Object.freeze({ count: 2, color: 0xffffff, intensity: 1.15, width: 5.5, height: 4.2, depth: 0.06, x: 3.8, y: 2.2, z: 5.6 }),
  }),
  lights: Object.freeze({
    key: Object.freeze({ color: 0xffffff, intensity: 3.2, position: [4.8, 6.2, 6.4] }),
    fill: Object.freeze({ color: 0xdfe7f2, intensity: 0.45, position: [-5.0, 2.2, 5.0] }),
    back: Object.freeze({ color: 0xffffff, intensity: 1.05, position: [-3.2, 4.6, -7.0] }),
  }),
  fog: Object.freeze({ color: 0x000000 }),
  shadows: false,
  postProcessing: false,
  materialTuning: Object.freeze({
    face: Object.freeze({ envMapIntensity: 1.05, roughness: 0.42, clearcoat: 0.1, color: 0xa9aeb4, normalScale: 1.2 }),
    band: Object.freeze({ envMapIntensity: 1.9, roughness: 1.0 }),
    frame: Object.freeze({ envMapIntensity: 1.9, roughness: 0.14 }),
    wall: Object.freeze({ envMapIntensity: 0.72 }),
  }),
});

function addBox(envScene, { width, height, depth, x = 0, y = 0, z = 0, color, intensity }) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), fog: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  envScene.add(mesh);
  return { mesh, geometry, material };
}

/**
 * Build the black strip-light PMREM studio for the Parade mode.
 *
 * @param {{renderer: THREE.WebGLRenderer}} options
 * @returns {{group: THREE.Group, environment: {texture: THREE.Texture, dispose: Function},
 *   fog: THREE.Fog, frame: Function, debug: Function, dispose: Function}}
 */
export function createParadeStudio({ renderer } = {}) {
  if (!renderer) throw new Error('coin-parade-scene: createParadeStudio requires a renderer');

  const group = new THREE.Group();
  group.name = 'coin-parade-studio';

  // ---- soft white key/fill lights for the satin faces ----------------------
  const lights = [];
  const { key, fill, back } = PARADE_STUDIO.lights;
  const keyLight = new THREE.DirectionalLight(key.color, key.intensity);
  keyLight.position.set(key.position[0], key.position[1], key.position[2]);
  keyLight.castShadow = false;
  group.add(keyLight);
  lights.push(keyLight);
  const fillLight = new THREE.DirectionalLight(fill.color, fill.intensity);
  fillLight.position.set(fill.position[0], fill.position[1], fill.position[2]);
  fillLight.castShadow = false;
  group.add(fillLight);
  lights.push(fillLight);
  const backLight = new THREE.DirectionalLight(back.color, back.intensity);
  backLight.position.set(back.position[0], back.position[1], back.position[2]);
  backLight.castShadow = false;
  group.add(backLight);
  lights.push(backLight);

  // ---- procedural environment: black void + long strip emitters ------------
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x000000);
  const envResources = [];
  const strips = PARADE_STUDIO.strips;

  for (let i = 0; i < strips.side.count; i += 1) {
    const sign = i === 0 ? -1 : 1;
    envResources.push(addBox(envScene, {
      width: strips.side.depth, height: strips.side.height, depth: strips.side.width,
      x: sign * strips.side.x, y: 2.4, z: i === 0 ? -0.8 : 1.6,
      color: 0xffffff, intensity: strips.side.intensity,
    }));
  }
  for (let i = 0; i < strips.overhead.count; i += 1) {
    const sign = i === 0 ? -1 : 1;
    envResources.push(addBox(envScene, {
      width: 1.2, height: strips.overhead.height, depth: strips.overhead.length,
      x: sign * 2.6, y: strips.overhead.y, z: strips.overhead.zOffset,
      color: 0xffffff, intensity: strips.overhead.intensity,
    }));
  }
  envResources.push(addBox(envScene, {
    width: strips.back.width, height: strips.back.height, depth: strips.back.depth,
    y: strips.back.y, z: strips.back.z, color: 0xffffff, intensity: strips.back.intensity,
  }));
  envResources.push(addBox(envScene, {
    width: strips.blue.width, height: strips.blue.height, depth: strips.blue.depth,
    x: strips.blue.x !== undefined ? strips.blue.x : 0,
    y: strips.blue.y !== undefined ? strips.blue.y : 2.0,
    z: strips.blue.z !== undefined ? strips.blue.z : -2.2,
    color: strips.blue.color, intensity: strips.blue.intensity,
  }));
  envResources.push(addBox(envScene, {
    width: strips.fill.width, height: strips.fill.height, depth: 0.05,
    y: 1.4, z: strips.fill.z, color: strips.fill.color, intensity: strips.fill.intensity,
  }));
  for (let i = 0; i < strips.softbox.count; i += 1) {
    const sign = i === 0 ? -1 : 1;
    envResources.push(addBox(envScene, {
      width: strips.softbox.width, height: strips.softbox.height, depth: strips.softbox.depth,
      x: sign * strips.softbox.x, y: strips.softbox.y, z: strips.softbox.z,
      color: strips.softbox.color, intensity: strips.softbox.intensity,
    }));
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const renderTarget = pmrem.fromScene(envScene, PARADE_STUDIO.environment.pmremSigma);
  pmrem.dispose();
  const environment = {
    texture: renderTarget.texture,
    renderTarget,
    dispose() {
      if (renderTarget) renderTarget.dispose();
    },
  };

  // release the temporary env scene resources (the PMREM is already baked)
  for (const resource of envResources) {
    envScene.remove(resource.mesh);
    resource.geometry.dispose();
    resource.material.dispose();
  }
  envScene.clear();

  const fog = new THREE.Fog(new THREE.Color(PARADE_STUDIO.fog.color).getHex(), 0.1, 1);
  fog.color.setHex(PARADE_STUDIO.fog.color);
  const state = {
    disposed: false,
    environmentReady: true,
    stripCount: PARADE_STUDIO.environment.stripCount,
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
      scene.environment = environment.texture;
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
        environment: state.environmentReady,
        stripCount: state.stripCount,
        blueStrip: PARADE_STUDIO.environment.blueStripCount,
        lights: lights.map((light) => ({ type: light.type, intensity: light.intensity })),
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
      environment.dispose();
      group.removeFromParent();
      for (const light of lights) group.remove(light);
      sceneRemoveAll(group);
      // fog has no GPU resources; the environment render target is disposed above
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
 * the black strip-lit set (brighter strip reflections on the reeded band and
 * polished frame, mid-silver satin face).
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
    const role = mesh.name === 'band' ? 'band' : mesh.name === 'frame' ? 'frame' : mesh.name === 'wall' ? 'wall' : 'face';
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
