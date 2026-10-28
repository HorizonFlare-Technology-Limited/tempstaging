/**
 * stacked-coins-scene.js — three.js studio for the Rev17 stacked glowing coins page.
 *
 * Consumes the pure deterministic model (./stacked-coins-model.js: COINS_CONFIG /
 * STUDIO / GLOW) and builds the dark editorial studio the page's real coin model
 * lives in:
 *  - a black PMREM studio with a dim overhead panel, neutral side panels, one warm
 *    THEME-GOLD bounce panel and a dim back wall. All authored locally (no HDR, no
 *    network, no clock, no Math.random);
 *  - a small light rig: white key with soft shadows, cool-neutral fill, white back
 *    rim and the model's gold bounce point light;
 *  - grounding: an invisible alpha shadow catcher, an authored contact-shadow decal
 *    and a faint gold reflection pool so the stack sits in the void;
 *  - the per-coin REEDED-EDGE glow: the coin model's shared reeded-band material is
 *    cloned per coin and given a striped THEME-GOLD emissive map (bright milled
 *    ridge tops, dark grooves) plus two additive rim-fresnel halo shells. Faces are
 *    never tinted (model glow.faceGlow is 0) — only the milled edge glows.
 *
 * The page owns the coin bank/groups; this module exposes
 * createStackedCoinsStudio(renderer) -> studio.createEdgeGlow(coin).
 */
import * as THREE from 'three';
import { COINS_CONFIG } from './stacked-coins-model.js';

/** TEKO theme gold — the only glow colour on this page (never blue). */
export const STACKED_COINS_GOLD = 0xffd60a;
export const STACKED_COINS_GOLD_RIM = 0xf5c400;

const GLOW = COINS_CONFIG.glow;
const STUDIO = COINS_CONFIG.studio;

/* ------------------------------------------------------------------------- */
/* Authored procedural textures                                              */
/* ------------------------------------------------------------------------- */

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Soft radial falloff texture: contact shadow (black) or gold pool (warm). */
function buildRadialTexture(size, stops, { rgb = [0, 0, 0], seed = 0x51a7c3 } = {}) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const random = lcg(seed);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, alpha] of stops) {
    const jitter = seed ? (random() - 0.5) * 0.01 : 0;
    gradient.addColorStop(Math.max(0, Math.min(1, offset + jitter)), 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.LinearEncoding;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Reeded-edge emissive map: the milled ridges light up (bright polished ridge
 * tops, dark grooves) so the theme gold reads as a striped milled edge instead
 * of a solid yellow tube. One 2048x8 texture is shared by every coin: the band
 * UV u wraps the circumference (200 reeds), v is the band height.
 */
function buildReedGlowTexture(reedCount = 200, width = 2048, height = 96) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    // 1 at the band's top/bottom rim folds, 0 across the flat middle of the edge
    const rim = Math.pow(1 - Math.min(1, Math.min(v, 1 - v) / 0.2), 1.6);
    for (let x = 0; x < width; x += 1) {
      const phase = ((x / width) * reedCount) % 1;
      const ridge = Math.pow(Math.sin(Math.PI * phase), 0.72);
      // faint gold glints on the ridge crests so the milled reeding stays legible
      const crest = Math.pow(Math.max(0, (ridge - 0.58) / 0.42), 1.5);
      const value = Math.round(Math.max(rim, crest * 0.32) * 255);
      const offset = (y * width + x) * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------------- */
/* PMREM environment                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Black editorial PMREM studio. The only warm source is the low front gold panel
 * that puts the TEKO-gold bounce into the silver (the studio's "gold bounce"). The
 * overhead panel + back rim strip give the reeded edges their long highlights.
 */
export function buildStackedCoinsEnvironment(renderer) {
  if (!renderer) return null;
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x050608);
  const resources = [];
  const addPanel = ({ width, height, depth, x = 0, y = 0, z = 0, color = 0xffffff, intensity = 1 }) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), fog: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    envScene.add(mesh);
    resources.push({ mesh, geometry, material });
  };
  // broad soft overhead light box (dim: the satin faces stay dark editorial)
  addPanel({ width: 22, height: 0.5, depth: 14, x: 0, y: 8.4, z: -0.6, color: 0xffffff, intensity: 0.5 });
  // narrow overhead strip closer to the stack: long crisp edge highlights
  addPanel({ width: 13, height: 0.24, depth: 2.0, x: 0, y: 6.2, z: 3.0, color: 0xffffff, intensity: 0.7 });
  // neutral side panels (cool, dim)
  addPanel({ width: 0.4, height: 7.0, depth: 13, x: -8.2, y: 2.6, z: -2.0, color: 0xe6eef8, intensity: 0.38 });
  addPanel({ width: 0.4, height: 7.0, depth: 13, x: 8.2, y: 2.6, z: -2.0, color: 0xe6eef8, intensity: 0.38 });
  // dim back wall + thin bright back rim strip behind the composition
  addPanel({ width: 24, height: 9, depth: 0.3, x: 0, y: 2.4, z: -11.0, color: 0xa9b4c2, intensity: 0.09 });
  addPanel({ width: 16, height: 0.18, depth: 0.6, x: 0, y: 4.6, z: -6.4, color: 0xffffff, intensity: 0.2 });
  // THEME-GOLD bounce: a low warm panel in front of the stack
  addPanel({ width: 0.5, height: 2.6, depth: 5.0, x: 3.1, y: 0.5, z: 3.6, color: STACKED_COINS_GOLD, intensity: 0.22 });
  addPanel({ width: 6.0, height: 0.3, depth: 0.7, x: 0, y: 0.35, z: 4.6, color: STACKED_COINS_GOLD, intensity: 0.12 });

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  for (const resource of resources) {
    envScene.remove(resource.mesh);
    resource.geometry.dispose();
    resource.material.dispose();
  }
  envScene.clear();
  return {
    texture: target.texture,
    renderTarget: target,
    dispose() {
      target.dispose();
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Rim-fresnel halo material                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Additive rim glow for a cylindrical shell: strongest where the shell is edge-on
 * to the camera (the reeded rim silhouette holds the brightest light), fading
 * vertically to zero at the shell's top/bottom so it reads as light spilling out
 * of the milled edge rather than a solid tube.
 */
function createHaloMaterial({ color, opacity, power }) {
  return new THREE.ShaderMaterial({
    name: 'stacked-coins-gold-halo',
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uPower: { value: power },
    },
    vertexShader: [
      'varying vec3 vWorldNormal;',
      'varying float vRim;',
      'varying float vHeight;',
      'void main() {',
      '  vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
      '  vWorldNormal = normalize(mat3(modelMatrix) * normal);',
      '  vec4 mvPosition = viewMatrix * worldPosition;',
      '  vec3 viewNormal = normalize(mat3(viewMatrix) * vWorldNormal);',
      '  vRim = 1.0 - clamp(abs(dot(normalize(-mvPosition.xyz), viewNormal)), 0.0, 1.0);',
      '  vHeight = uv.y;',
      '  gl_Position = projectionMatrix * mvPosition;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor;',
      'uniform float uOpacity;',
      'uniform float uPower;',
      'varying vec3 vWorldNormal;',
      'varying float vRim;',
      'varying float vHeight;',
      'void main() {',
      '  float rim = pow(clamp(vRim, 0.0, 1.0), uPower);',
      '  float band = pow(max(sin(clamp(vHeight, 0.0, 1.0) * 3.14159265), 0.0), 0.55);',
      '  float alpha = uOpacity * rim * band;',
      '  if (alpha <= 0.002) discard;',
      '  gl_FragColor = vec4(uColor, alpha);',
      '}',
    ].join('\n'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/* ------------------------------------------------------------------------- */
/* Studio                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Build the stacked-coins studio (environment + lights + grounding + glow factory).
 * @param {THREE.WebGLRenderer} renderer
 * @returns {object} studio
 */
export function createStackedCoinsStudio(renderer) {
  const group = new THREE.Group();
  group.name = 'stacked-coins-studio';

  const textures = [];
  const geometries = [];
  const materials = [];
  const bandMaterialEmissive = [];
  const haloMaterials = [];
  const edgeGlowHandles = new Set();

  /* --- environment ------------------------------------------------------ */
  const environment = buildStackedCoinsEnvironment(renderer || null);

  /* --- lights ----------------------------------------------------------- */
  const key = new THREE.DirectionalLight(STUDIO.keyLight.color, 2.6);
  key.name = 'stacked-coins-key';
  key.position.fromArray(STUDIO.keyLight.position);
  key.castShadow = true;
  const shadowSize = 2048;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -6.5;
  key.shadow.camera.right = 6.5;
  key.shadow.camera.top = 7.5;
  key.shadow.camera.bottom = -2.5;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  key.target.position.set(0, 1.4, 0);
  group.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xdfe7f2, 0.55);
  fill.name = 'stacked-coins-fill';
  fill.position.fromArray(STUDIO.fillLight.position);
  group.add(fill);

  const rim = new THREE.DirectionalLight(0xfff4e0, 0.55);
  rim.name = 'stacked-coins-rim';
  rim.position.set(-3.0, 1.7, -7.6);
  group.add(rim);

  const goldBounce = new THREE.PointLight(STUDIO.goldBounce.color, 0.55, 8.5, 1.7);
  goldBounce.name = 'stacked-coins-gold-bounce';
  goldBounce.position.fromArray(STUDIO.goldBounce.position);
  group.add(goldBounce);

  const goldPoolLight = new THREE.PointLight(STACKED_COINS_GOLD, 0.2, 5.5, 2.0);
  goldPoolLight.name = 'stacked-coins-gold-pool';
  goldPoolLight.position.set(0, 0.18, 2.2);
  group.add(goldPoolLight);

  // soft neutral front wash: gives the satin faces their readable sheen without
  // the white mirror blowout of a hard back rim.
  const frontWash = new THREE.DirectionalLight(0xf2f6fb, 0.62);
  frontWash.name = 'stacked-coins-front-wash';
  frontWash.position.set(0.8, 3.6, 8.6);
  group.add(frontWash);

  const ambient = new THREE.AmbientLight(0x2a3038, 0.1);
  ambient.name = 'stacked-coins-ambient';
  group.add(ambient);

  const lights = { key, fill, rim, frontWash, goldBounce, goldPoolLight, ambient };

  /* --- ground: shadow catcher + authored decals ------------------------- */
  const shadowTexture = buildRadialTexture(256, [
    [0, 0.72],
    [0.42, 0.38],
    [0.72, 0.1],
    [1, 0],
  ], { rgb: [0, 0, 0], seed: 0x51a7c3 });
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

  const poolTexture = buildRadialTexture(256, [
    [0, 0.55],
    [0.35, 0.22],
    [0.75, 0.04],
    [1, 0],
  ], { rgb: [255, 214, 10], seed: 0x7f31d9 });
  textures.push(poolTexture);
  const goldPool = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 3.8),
    new THREE.MeshBasicMaterial({
      map: poolTexture,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  goldPool.name = 'stacked-coins-gold-pool';
  goldPool.rotation.x = -Math.PI / 2;
  goldPool.position.set(0, 0.004, 0);
  geometries.push(goldPool.geometry);
  materials.push(goldPool.material);
  group.add(goldPool);

  // Invisible alpha shadow catcher: the key light's soft shadow lands on the
  // "floor" even though the page background is a CSS void.
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.42 }),
  );
  shadowCatcher.name = 'stacked-coins-shadow-catcher';
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.set(0, 0.001, 0);
  shadowCatcher.receiveShadow = true;
  geometries.push(shadowCatcher.geometry);
  materials.push(shadowCatcher.material);
  group.add(shadowCatcher);

  const ground = { contactShadow, goldPool, shadowCatcher };

  /* --- per-coin reeded-edge gold glow ----------------------------------- */
  const reedGlowTexture = buildReedGlowTexture(200);
  textures.push(reedGlowTexture);
  const shellGeometries = new Map();
  const shellGeometry = (radius, height) => {
    const keyName = radius.toFixed(4) + ':' + height.toFixed(4);
    if (!shellGeometries.has(keyName)) {
      const geometry = new THREE.CylinderGeometry(radius, radius, height, 128, 1, true);
      geometry.name = 'stacked-coins-halo-shell';
      shellGeometries.set(keyName, geometry);
      geometries.push(geometry);
    }
    return shellGeometries.get(keyName);
  };

  /**
   * Attach the theme-gold reeded-edge glow to one coin.
   * @param {object} coin coin-model coin (has meshes.band + group)
   * @returns {{setGlow:Function, debug:Function, dispose:Function}}
   */
  const createEdgeGlow = (coin) => {
    const band = coin && coin.meshes && coin.meshes.band ? coin.meshes.band : null;
    if (!band || !band.material) throw new Error('stacked-coins-scene: coin has no reeded band mesh');
    const bandGlow = band.material.clone();
    bandGlow.name = 'coin-band-gold-glow';
    bandGlow.emissive = new THREE.Color(GLOW.color);
    bandGlow.emissiveMap = reedGlowTexture;
    bandGlow.emissiveIntensity = 0;
    bandGlow.needsUpdate = true;
    bandMaterialEmissive.push(bandGlow);
    band.material = bandGlow;

    const tight = createHaloMaterial({ color: GLOW.color, opacity: 0, power: 1.7 });
    const wide = createHaloMaterial({ color: GLOW.color, opacity: 0, power: 1.15 });
    haloMaterials.push(tight, wide);
    const tightMesh = new THREE.Mesh(shellGeometry(1.018, 0.235), tight);
    tightMesh.name = 'stacked-coins-halo-tight';
    const wideMesh = new THREE.Mesh(shellGeometry(1.06, 0.34), wide);
    wideMesh.name = 'stacked-coins-halo-wide';
    coin.group.add(tightMesh, wideMesh);

    const handle = {
      band,
      bandMaterial: bandGlow,
      tight,
      wide,
      setGlow(glowIntensity, haloOpacity = GLOW.haloOpacity) {
        const k = Math.max(0, Number(glowIntensity) || 0) / GLOW.emissiveBase;
        bandGlow.emissiveIntensity = 1.15 * k;
        tight.uniforms.uOpacity.value = haloOpacity * 0.5 * k;
        wide.uniforms.uOpacity.value = haloOpacity * 0.12 * k;
      },
      debug() {
        return {
          bandEmissiveIntensity: bandGlow.emissiveIntensity,
          emissive: '#' + bandGlow.emissive.getHexString(),
          emissiveMap: Boolean(bandGlow.emissiveMap),
          tightOpacity: tight.uniforms.uOpacity.value,
          wideOpacity: wide.uniforms.uOpacity.value,
        };
      },
      dispose() {
        edgeGlowHandles.delete(handle);
        if (tightMesh.parent) tightMesh.parent.remove(tightMesh);
        if (wideMesh.parent) wideMesh.parent.remove(wideMesh);
        tight.dispose();
        wide.dispose();
        bandGlow.dispose();
      },
    };
    edgeGlowHandles.add(handle);
    return handle;
  };

  let disposed = false;
  const studio = {
    group,
    environment,
    lights,
    ground,
    textures,
    materials,
    createEdgeGlow,
    frame() {
      return studio.debug();
    },
    debug() {
      return {
        finish: STUDIO.finish,
        environment: Boolean(environment),
        background: STUDIO.background,
        floor: STUDIO.floor,
        lights: Object.keys(lights).map((name) => {
          const light = lights[name];
          return {
            name,
            type: light.type,
            color: '#' + light.color.getHexString(),
            intensity: light.intensity,
            position: light.position.toArray().map((value) => Math.round(value * 1000) / 1000),
          };
        }),
        shadowMap: {
          enabled: true,
          size: shadowSize,
          catcher: Boolean(shadowCatcher),
          contactShadow: Boolean(contactShadow),
        },
        goldPool: Boolean(goldPool),
        glow: {
          color: GLOW.color,
          target: GLOW.target,
          emissiveBase: GLOW.emissiveBase,
          additiveHalo: GLOW.additiveHalo,
          haloOpacity: GLOW.haloOpacity,
          haloScale: GLOW.haloScale,
          shellsPerCoin: 2,
          bandEmissive: 'gold',
          bandEmissiveMap: 'reeded-striped',
          faceGlow: GLOW.faceGlow,
        },
        coinsGlowing: bandMaterialEmissive.length,
        disposed,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const handle of Array.from(edgeGlowHandles)) handle.dispose();
      edgeGlowHandles.clear();
      for (const material of bandMaterialEmissive) material.dispose();
      bandMaterialEmissive.length = 0;
      for (const material of haloMaterials) material.dispose();
      haloMaterials.length = 0;
      for (const material of materials) material.dispose();
      materials.length = 0;
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      for (const texture of textures) texture.dispose();
      textures.length = 0;
      if (environment) environment.dispose();
      for (const light of Object.values(lights)) group.remove(light);
      group.removeFromParent();
      group.clear();
    },
  };
  return studio;
}
