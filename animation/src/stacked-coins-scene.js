/**
 * stacked-coins-scene.js — three.js helper for the coin-page Stack mode (Rev21 s37).
 *
 * Consumes the pure deterministic model (./stacked-coins-model.js: COINS_CONFIG /
 * STUDIO / LINE_LIGHT_SPEC) and builds the dark editorial stage the page's real
 * coin model lives in:
 *  - NO lights, NO private PMREM studio, NO fluorescence. The only light source is
 *    the shared environment map (src/env-room.js, three tiers room/mono/small),
 *    into which the page bakes ONE thin dark-blue LINE (room.setLineLight) before
 *    PMREM filtering. The line shows up as dark-blue linear highlights on the
 *    reeded rims and faces;
 *  - no emissive maps, no additive halo shells, no gold floor pool;
 *  - grounding: an authored contact-shadow decal (a decal, not a light).
 *
 * The page owns the coin bank/groups; this module exposes
 * createStackedCoinsStudio(renderer, {room}) -> studio.createEdge(coin).
 */
import * as THREE from 'three';
import { ENV_ROOM } from './env-room.js';
import { COINS_CONFIG } from './stacked-coins-model.js';

const ENV_ROOM_LABEL = ENV_ROOM.url + ' (PMREM, env-room + baked line light)';

const STUDIO = COINS_CONFIG.studio;
const LINE = COINS_CONFIG.lineLight;

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Soft radial falloff texture for the black contact-shadow decal. */
function buildShadowTexture(size = 256) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, alpha] of [[0, 0.72], [0.42, 0.38], [0.72, 0.1], [1, 0]]) {
    gradient.addColorStop(offset, 'rgba(0,0,0,' + alpha + ')');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.LinearEncoding;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Build the Stack-mode helper (grounding decal + per-coin edge factory).
 * @param {THREE.WebGLRenderer} renderer kept for API compatibility (unused)
 * @param {{room?: object}} [options]
 */
export function createStackedCoinsStudio(renderer, options = {}) {
  const room = options && options.room ? options.room : null;
  const group = new THREE.Group();
  group.name = 'stacked-coins-studio';

  const textures = [];
  const geometries = [];
  const materials = [];
  const edgeHandles = new Set();
  const environment = room && room.texture ? room.texture : null;
  const lights = Object.freeze({});

  const shadowTexture = buildShadowTexture(256);
  textures.push(shadowTexture);
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 4.4),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
  );
  contactShadow.name = 'stacked-coins-contact-shadow';
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.set(0, 0.002, 0);
  geometries.push(contactShadow.geometry);
  materials.push(contactShadow.material);
  group.add(contactShadow);

  /**
   * Per-coin reeded edge: the band material is cloned so the stack can tune the
   * milled edge's response to the baked line light without touching the shared
   * coin material. No emissive, no map changes.
   */
  const createEdge = (coin) => {
    const band = coin && coin.meshes && coin.meshes.band ? coin.meshes.band : null;
    if (!band || !band.material) throw new Error('stacked-coins-scene: coin has no reeded band mesh');
    const original = band.material;
    const edgeMaterial = original.clone();
    edgeMaterial.name = 'coin-band-stack';
    edgeMaterial.emissive = new THREE.Color(0x000000);
    edgeMaterial.emissiveIntensity = 0;
    edgeMaterial.emissiveMap = null;
    edgeMaterial.needsUpdate = true;
    band.material = edgeMaterial;
    const handle = {
      band,
      bandMaterial: edgeMaterial,
      debug() {
        return { emissiveIntensity: edgeMaterial.emissiveIntensity, emissiveMap: Boolean(edgeMaterial.emissiveMap) };
      },
      dispose() {
        edgeHandles.delete(handle);
        edgeMaterial.dispose();
      },
    };
    edgeHandles.add(handle);
    return handle;
  };

  let disposed = false;
  const studio = {
    group,
    environment,
    lights,
    textures,
    materials,
    createEdge,
    frame() {
      return studio.debug();
    },
    debug() {
      return {
        finish: STUDIO.finish,
        environment: ENV_ROOM_LABEL,
        environmentTexture: Boolean(environment),
        background: STUDIO.background,
        floor: STUDIO.floor,
        lights: [],
        goldPool: false,
        emissive: false,
        additiveHalo: false,
        lineLight: { kind: LINE.kind, color: LINE.hex, bakedIn: 'environment-map' },
        edges: edgeHandles.size,
        disposed,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const handle of Array.from(edgeHandles)) handle.dispose();
      edgeHandles.clear();
      for (const material of materials) material.dispose();
      materials.length = 0;
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      for (const texture of textures) texture.dispose();
      textures.length = 0;
      group.removeFromParent();
      group.clear();
    },
  };
  return studio;
}
