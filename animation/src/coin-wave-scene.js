/**
 * tekoanimation — Wave composition scene build (three.js side).
 *
 * Consumes the pure-math `WAVE` composition (`./coin-wave.js`) and builds:
 *  - the broad twisted ribbon/wave band: a watertight stadium-section sweep with
 *    four material groups (brushed-silver top face, blue/violet underside,
 *    polished silver long-edge rims, polished end caps);
 *  - deterministic procedural brushed-metal maps (seeded, no `Math.random`);
 *  - the wave lighting rig: a neutral WHITE key (shadow-casting, unchanged in
 *    colour) plus the reference's orange accent translated to the TEKO brand
 *    gold (`#ffd60a`) — nothing else is tinted;
 *  - soft authored contact-shadow decals under each coin and the coin cluster,
 *    aligned to the band surface.
 *
 * The four coins themselves stay owned by the page (they come from the coin
 * model bank); `preview.js` adds their holders to `group` using `WAVE.coins`.
 *
 * Determinism: textures are generated from a fixed LCG seed, all placements
 * come from `WAVE`, and nothing here reads the clock or `Math.random`.
 */
import * as THREE from 'three';
import { WAVE, waveSurfaceAt } from './coin-wave.js';

/** TEKO brand gold (shield emblem bright tone) replaces the reference's orange. */
export const WAVE_ACCENT = Object.freeze({
  gold: 0xffd60a,
  goldDeep: 0x7d5a00,
  white: 0xffffff,
  role: 'brand-gold accent (reference orange)',
});

/** Deterministic linear congruential generator (no Math.random anywhere). */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasTexture(canvas, { srgb = false, repeatU = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = repeatU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Brushed-silver maps: fine lines run ALONG the band (u), so the texture varies
 * across v (one random streak value per row, slightly jittered along u).
 */
function buildBrushedMaps(size = 512) {
  const random = lcg(0x5eed6a7);
  const albedo = makeCanvas(size, size);
  const roughness = makeCanvas(size, size);
  const bump = makeCanvas(size, size);
  const albedoCtx = albedo.getContext('2d');
  const roughnessCtx = roughness.getContext('2d');
  const bumpCtx = bump.getContext('2d');

  // smooth-ish row luminance: random walk so the brush lines group naturally
  const rows = [];
  let value = 0;
  for (let y = 0; y < size; y += 1) {
    value = value * 0.86 + (random() - 0.5) * 14;
    rows.push(value);
  }
  // a handful of brighter/darker long streaks for the satin sheen
  for (let streak = 0; streak < 46; streak += 1) {
    const y = Math.floor(random() * size);
    rows[y] += (random() - 0.5) * 18;
  }

  for (let y = 0; y < size; y += 1) {
    const row = rows[y];
    // albedo: bright neutral silver ~0.62..0.78 with fine per-pixel grain
    const base = 165 + row * 0.5;
    const rough = 46 + row * 0.4; // 0.15 .. 0.23 effective roughness
    const height = 128 + row * 0.6;
    for (let x = 0; x < size; x += 1) {
      const grain = (random() - 0.5) * 4;
      const level = Math.max(0, Math.min(255, Math.round(base + grain)));
      albedoCtx.fillStyle = 'rgb(' + level + ',' + level + ',' + (level + 1) + ')';
      albedoCtx.fillRect(x, y, 1, 1);
      const roughLevel = Math.max(0, Math.min(255, Math.round(rough + grain)));
      roughnessCtx.fillStyle = 'rgb(' + roughLevel + ',' + roughLevel + ',' + roughLevel + ')';
      roughnessCtx.fillRect(x, y, 1, 1);
      const bumpLevel = Math.max(0, Math.min(255, Math.round(height + grain * 2)));
      bumpCtx.fillStyle = 'rgb(' + bumpLevel + ',' + bumpLevel + ',' + bumpLevel + ')';
      bumpCtx.fillRect(x, y, 1, 1);
    }
  }

  return {
    albedo: canvasTexture(albedo, { srgb: true }),
    roughness: canvasTexture(roughness),
    bump: canvasTexture(bump),
  };
}

/** Soft radial contact-shadow alpha (black with a smooth falloff). */
function buildShadowTexture(size = 256) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.92)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.62)');
  gradient.addColorStop(0.78, 'rgba(0,0,0,0.2)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.LinearEncoding;
  return texture;
}

function vec3(values) {
  return new THREE.Vector3(values[0], values[1], values[2]);
}

/**
 * Purpose-built PMREM studio for the wave: a dark room with a strong white
 * softbox upper-left (the reference's white light), a softer white panel front
 * right, a blue-violet panel behind-left (so the blue underside reflects blue,
 * not grey) and a brand-gold strip low-right (the reference's orange accent
 * reflections). The palette is why the silver reads as satin metal here instead
 * of the dim silver-studio environment used by Hero/Gallery.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @returns {{texture: THREE.Texture, dispose: () => void}}
 */
export function buildWaveEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const resources = [geometry];

  const addPanel = (color, intensity, position, scale, lookAt = [0, 0, 0]) => {
    const material = new THREE.MeshBasicMaterial();
    material.color.setRGB(color[0] * intensity, color[1] * intensity, color[2] * intensity);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    envScene.add(mesh);
    resources.push(material);
    return mesh;
  };

  // dark blue-grey room shell (low ambient body for the metals)
  const shellMaterial = new THREE.MeshBasicMaterial({ color: 0x0a0d16, side: THREE.BackSide });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(26, 12, 8), shellMaterial);
  envScene.add(shell);
  resources.push(shell.geometry, shellMaterial);

  // Main white softbox directly ABOVE the composition: the band's silver top
  // face mirrors to +Y at the coins, so this is the reflection that makes the
  // broad brushed surface read bright.
  addPanel([1.0, 0.98, 0.95], 3.6, [0, 16, 1], [16, 11, 0.1]);
  // Secondary softbox above/front: brightens the near slopes of the wave.
  addPanel([1.0, 0.98, 0.95], 2.0, [0, 12, 12], [10, 6, 0.1]);
  // Secondary softbox above/behind: gives the far edges and rims a cool sheen.
  addPanel([0.92, 0.96, 1.0], 1.8, [0, 15, -7], [14, 9, 0.1]);
  // Quiet front panel: coin faces point at the camera, so their mirror
  // reflection samples this panel — keep it dim so the satin coins stay a mid
  // tone with readable relief instead of clipping white.
  addPanel([1.0, 0.98, 0.95], 0.55, [-3, 5, 14], [8, 5, 0.1]);
  // Blue-violet sweep behind-left (blue underside reflections).
  addPanel([0.3, 0.36, 1.0], 3.2, [-15, 3, -4], [8, 12, 0.1]);
  // Blue-violet panel behind the CAMERA: the blue underside faces the viewer,
  // so its mirror reflection samples this panel and reads as blue-violet glass.
  addPanel([0.34, 0.4, 1.0], 2.2, [-5, 3, 15], [9, 7, 0.1]);
  // White kicker behind-right (silver rim highlights).
  addPanel([1.0, 0.97, 0.92], 1.2, [12, 7, -4], [8, 8, 0.1]);
  // Brand-gold accent strip low-right (reference orange).
  addPanel([1.0, 0.72, 0.1], 2.2, [9, -4, 5], [6, 2, 0.1]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  for (const resource of resources) resource.dispose();
  return {
    texture: target.texture,
    dispose() {
      target.dispose();
    },
  };
}

/**
 * Build the wave band + lighting + contact shadows.
 * @param {{ castShadow?: boolean, renderer?: THREE.WebGLRenderer }} [options]
 * @returns {{
 *   group: THREE.Group,
 *   band: THREE.Mesh,
 *   materials: Record<string, THREE.Material>,
 *   lights: Record<string, THREE.Light>,
 *   environment: { texture: THREE.Texture, dispose: () => void } | null,
 *   decals: THREE.Mesh[],
 *   debug(): object,
 *   dispose(): void
 * }}
 */
export function createWaveComposition(options = {}) {
  const castShadow = options.castShadow !== false;
  const group = new THREE.Group();
  group.name = 'coin-wave';
  // Purpose-built PMREM studio (returned to the page, which owns
  // scene.environment and restores the silver-studio env on mode exit).
  const environment = options.renderer ? buildWaveEnvironment(options.renderer) : null;

  const geometry = new THREE.BufferGeometry();
  const data = WAVE.ribbon.geometry;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(data.indices, 1));
  for (const entry of data.groups) geometry.addGroup(entry.start, entry.count, entry.material);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const brushed = buildBrushedMaps(512);

  const silver = new THREE.MeshPhysicalMaterial({
    name: 'wave-silver-brushed',
    color: 0xffffff,
    map: brushed.albedo,
    roughnessMap: brushed.roughness,
    roughness: 1.0,
    metalness: 1.0,
    bumpMap: brushed.bump,
    bumpScale: 0.0025,
    envMapIntensity: 1.08,
  });
  const blue = new THREE.MeshPhysicalMaterial({
    name: 'wave-blue-underside',
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.28,
    roughness: 0.2,
    clearcoat: 0.7,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1.0,
  });
  const rim = new THREE.MeshPhysicalMaterial({
    name: 'wave-polished-rim',
    color: 0xe4e8ee,
    metalness: 1.0,
    roughness: 0.07,
    envMapIntensity: 1.55,
  });
  const rimEnd = rim.clone();
  rimEnd.name = 'wave-polished-rim-end';

  const materials = [silver, blue, rim, rimEnd];
  const band = new THREE.Mesh(geometry, materials);
  band.name = 'wave-band';
  band.castShadow = false;
  band.receiveShadow = true;
  group.add(band);

  /* ------------------------------------------------------------ lighting */

  // Neutral WHITE key: the reference's white light is kept white (only the
  // accent light takes the brand gold). It also casts the coins' soft shadows
  // onto the band.
  const whiteKey = new THREE.DirectionalLight(WAVE_ACCENT.white, 1.2);
  whiteKey.name = 'wave-white-key';
  whiteKey.position.set(-7.5, 4.5, 5.0);
  whiteKey.target.position.set(0.4, 0.2, 0.2);
  whiteKey.castShadow = castShadow;
  if (castShadow) {
    whiteKey.shadow.mapSize.set(2048, 2048);
    whiteKey.shadow.camera.left = -12;
    whiteKey.shadow.camera.right = 12;
    whiteKey.shadow.camera.top = 8;
    whiteKey.shadow.camera.bottom = -8;
    whiteKey.shadow.camera.near = 1;
    whiteKey.shadow.camera.far = 40;
    whiteKey.shadow.bias = -0.0008;
    whiteKey.shadow.normalBias = 0.02;
    whiteKey.shadow.radius = 4;
  }
  group.add(whiteKey);
  group.add(whiteKey.target);

  // A second, softer white key from the camera side reads the brushed top face.
  const whiteFill = new THREE.DirectionalLight(0xffffff, 0.18);
  whiteFill.name = 'wave-white-fill';
  whiteFill.position.set(2.5, 7.0, 9.0);
  whiteFill.target.position.set(0.8, 0.4, 0.2);
  group.add(whiteFill);
  group.add(whiteFill.target);

  // Brand-gold accent (reference orange): a grazing light on the near rim of
  // the band, kept low and away from the coin faces so the satin silver coins
  // stay silver — only their bottom rims pick up the warm edge.
  const goldAccent = new THREE.PointLight(WAVE_ACCENT.gold, 24, 7, 2);
  goldAccent.name = 'wave-gold-accent';
  goldAccent.position.set(2.4, -2.3, 2.3);
  group.add(goldAccent);

  // A white raking light from the camera-right, low: it skims across the satin
  // coin faces so the embossed relief reads (a frontal key alone leaves the
  // glyph bevels flat at this scale).
  const whiteRake = new THREE.DirectionalLight(0xffffff, 1.6);
  whiteRake.name = 'wave-white-rake';
  whiteRake.position.set(11, 2.6, 6);
  whiteRake.target.position.set(1.2, 0.4, 0.6);
  group.add(whiteRake);
  group.add(whiteRake.target);

  // A quiet cool fill keeps the blue underside from going black.
  const coolFill = new THREE.PointLight(0x8fa4ff, 5.0, 24, 2);
  coolFill.name = 'wave-cool-fill';
  coolFill.position.set(-4.6, 2.2, -4.2);
  group.add(coolFill);

  /* ------------------------------------------------- contact shadow decals */

  const shadowTexture = buildShadowTexture(256);
  const decals = [];
  const decalGroup = new THREE.Group();
  decalGroup.name = 'wave-contact-shadows';
  group.add(decalGroup);

  const addDecal = ({ t, f, width, height, opacity, offsetAlong, offsetSide }) => {
    const surface = waveSurfaceAt(t, f);
    const material = new THREE.MeshBasicMaterial({
      name: 'wave-contact-shadow',
      map: shadowTexture,
      color: 0x000000,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = 'wave-shadow-decal';
    const basis = new THREE.Matrix4().makeBasis(
      vec3(surface.frame.side),
      vec3(surface.frame.tangent),
      vec3(surface.frame.up)
    );
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position
      .copy(vec3(surface.point))
      .addScaledVector(vec3(surface.frame.up), 0.012)
      .addScaledVector(vec3(surface.frame.tangent), offsetAlong || 0)
      .addScaledVector(vec3(surface.frame.side), offsetSide || 0);
    mesh.renderOrder = 2;
    decalGroup.add(mesh);
    decals.push(mesh);
    return mesh;
  };

  for (const coin of WAVE.coins) {
    const scale = coin.scale;
    addDecal({
      t: coin.contactT,
      f: coin.contactF,
      width: 2.1 * scale,
      height: 1.25 * scale,
      opacity: 0.55,
      offsetAlong: -0.12 * scale,
      offsetSide: -0.04 * scale,
    });
  }

  const dispose = () => {
    geometry.dispose();
    for (const material of materials) material.dispose();
    brushed.albedo.dispose();
    brushed.roughness.dispose();
    brushed.bump.dispose();
    shadowTexture.dispose();
    for (const mesh of decals) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    whiteKey.dispose();
    whiteFill.dispose();
    whiteRake.dispose();
    goldAccent.dispose();
    coolFill.dispose();
    if (environment) environment.dispose();
  };

  const debug = () => ({
    band: {
      vertices: data.vertexCount,
      triangles: data.triangleCount,
      groups: data.groups.map((entry) => ({ material: entry.material, count: entry.count / 3 })),
      materials: materials.map((material) => material.name),
      width: WAVE.ribbon.metrics.width,
      thickness: WAVE.ribbon.metrics.thickness,
      length: WAVE.ribbon.metrics.length,
      twistDeg: {
        min: Math.round((Math.min(...WAVE.frames.map((frame) => frame.twistRad)) * 180) / Math.PI),
        max: Math.round((Math.max(...WAVE.frames.map((frame) => frame.twistRad)) * 180) / Math.PI),
      },
    },
    lights: {
      white: { type: 'DirectionalLight', color: '#' + WAVE_ACCENT.white.toString(16).padStart(6, '0'), castShadow },
      gold: { color: '#' + WAVE_ACCENT.gold.toString(16).padStart(6, '0'), role: WAVE_ACCENT.role },
      names: [whiteKey.name, whiteFill.name, whiteRake.name, goldAccent.name, coolFill.name],
      shadowMap: castShadow,
    },
    environment: environment ? 'wave-pmrem-studio' : null,
    decals: decals.length,
    textures: ['brushed-albedo', 'brushed-roughness', 'brushed-bump', 'contact-shadow'],
  });

  return {
    group,
    band,
    materials: { silver, blue, rim, rimEnd },
    lights: { whiteKey, whiteFill, whiteRake, goldAccent, coolFill },
    environment,
    decals,
    debug,
    dispose,
  };
}
