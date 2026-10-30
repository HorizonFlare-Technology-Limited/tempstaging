/**
 * tekoanimation — shared image-based lighting ("env room"), Revision 21.
 *
 * Every page is lit only by an equirectangular environment filtered through a
 * PMREMGenerator into `scene.environment`. There are no THREE lights and no
 * procedural studios. Three tiers are switchable at runtime (`setEnv(tier)`):
 *
 *   room    assets/env/modern-empty-room.jpg    (LDR photo, default)
 *   mono    assets/env/monochrome_studio_01.hdr (Radiance RGBE)
 *   small   assets/env/studio_small_03.hdr      (Radiance RGBE)
 *
 * The page passes its own THREE namespace (r151 on the module pages, r180 on the
 * phone page); all textures are therefore created by the exact build that
 * renders the page. Every tier is decoded to the same 2048x1024 half-float
 * linear equirect (the .jpg through a canvas, the .hdr through the RGBE parser
 * below), so one stable PMREM render target is re-rendered in place: the
 * `handle.texture` object never changes identity, scenes that cached it stay
 * valid, and nothing leaks when the tier changes.
 *
 * Intensity:
 *   r163+ : `scene.environmentIntensity` on every bound scene.
 *   r151  : no scene-level control exists, so the multiplier is BAKED into the
 *           radiance that is filtered into the PMREM. Materials are never
 *           touched, their authored `envMapIntensity` stays authoritative (the
 *           old per-material scaling double-applied whenever a page also set
 *           envMapIntensity itself, and missed materials created later).
 *
 * Usage:
 *   const room = await applyEnvRoom(THREE, renderer, scene, { intensity: 1 });
 *   mountEnvToggle(room);                 // 3-button Room/Mono/Studio switch
 *   await room.setEnv('mono');            // or ?env=room|mono|small
 *   room.dispose();
 *
 * Nothing here touches `scene.background`.
 */

export const ENV_TIERS = Object.freeze({
  room: Object.freeze({ id: 'room', label: 'Room', url: 'assets/env/modern-empty-room.jpg', kind: 'ldr' }),
  mono: Object.freeze({ id: 'mono', label: 'Mono', url: 'assets/env/monochrome_studio_01.hdr', kind: 'hdr' }),
  small: Object.freeze({ id: 'small', label: 'Studio', url: 'assets/env/studio_small_03.hdr', kind: 'hdr' }),
});
const TIER_ALIASES = Object.freeze({ studio: 'small', monochrome: 'mono', default: 'room' });

/** Frozen defaults shared by every page. */
export const ENV_ROOM = Object.freeze({
  url: ENV_TIERS.room.url,
  intensity: 1,
  width: 2048,
  height: 1024,
});

/** Normalise 'room' | 'mono' | 'small' (+aliases) to a tier id, else null. */
export function normalizeEnvTier(value) {
  if (value == null) return null;
  const key = String(value).trim().toLowerCase();
  const id = TIER_ALIASES[key] || key;
  return ENV_TIERS[id] ? id : null;
}

/** Tier requested by `?env=` (null when absent / invalid). */
export function envTierFromUrl(search) {
  try {
    const query = search == null ? (typeof location !== 'undefined' ? location.search : '') : search;
    return normalizeEnvTier(new URLSearchParams(query).get('env'));
  } catch (error) {
    return null;
  }
}

/* ------------------------------------------------------------- decoding */

const W = ENV_ROOM.width;
const H = ENV_ROOM.height;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('env-room: ' + url + ' -> HTTP ' + response.status);
  return response.arrayBuffer();
}

/** LDR image -> linear Float32 RGBA at W x H. */
async function decodeLdr(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('env-room: ' + url + ' -> HTTP ' + response.status);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, W, H);
  if (bitmap.close) bitmap.close();
  const px = ctx.getImageData(0, 0, W, H).data;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) lut[i] = srgbToLinear(i / 255);
  const out = new Float32Array(W * H * 4);
  for (let i = 0, n = W * H; i < n; i += 1) {
    out[i * 4] = lut[px[i * 4]];
    out[i * 4 + 1] = lut[px[i * 4 + 1]];
    out[i * 4 + 2] = lut[px[i * 4 + 2]];
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** Radiance .hdr (RGBE, RLE or flat) -> {width,height,data: Float32 RGB}. */
export function parseRGBE(buffer) {
  const bytes = new Uint8Array(buffer);
  let pos = 0;
  const readLine = () => {
    let s = '';
    while (pos < bytes.length && bytes[pos] !== 10) s += String.fromCharCode(bytes[pos++]);
    pos += 1;
    return s;
  };
  const magic = readLine();
  if (magic.slice(0, 2) !== '#?') throw new Error('env-room: not a Radiance HDR file');
  let line;
  do {
    line = readLine();
  } while (line.length && pos < bytes.length);
  const res = /^([-+])Y\s+(\d+)\s+([-+])X\s+(\d+)/.exec(readLine());
  if (!res) throw new Error('env-room: unsupported HDR resolution line');
  const height = Number(res[2]);
  const width = Number(res[4]);
  const flipY = res[1] === '-';
  const rgbe = new Uint8Array(width * height * 4);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y += 1) {
    const b0 = bytes[pos];
    const b1 = bytes[pos + 1];
    const rle = width >= 8 && width < 32768 && b0 === 2 && b1 === 2 && ((bytes[pos + 2] << 8) | bytes[pos + 3]) === width;
    if (rle) {
      pos += 4;
      for (let c = 0; c < 4; c += 1) {
        let x = 0;
        while (x < width) {
          let count = bytes[pos++];
          if (count > 128) {
            count -= 128;
            const value = bytes[pos++];
            while (count-- > 0) scan[(x++) * 4 + c] = value;
          } else {
            while (count-- > 0) scan[(x++) * 4 + c] = bytes[pos++];
          }
        }
      }
    } else {
      // flat (uncompressed) scanline
      scan.set(bytes.subarray(pos, pos + width * 4));
      pos += width * 4;
    }
    const row = flipY ? y : height - 1 - y;
    rgbe.set(scan, row * width * 4);
  }
  // rgbe row 0 = top of image when flipY ('-Y'); equirect row 0 must be the zenith.
  const data = new Float32Array(width * height * 3);
  for (let i = 0, n = width * height; i < n; i += 1) {
    const e = rgbe[i * 4 + 3];
    const f = e ? Math.pow(2, e - 136) : 0;
    data[i * 3] = rgbe[i * 4] * f;
    data[i * 3 + 1] = rgbe[i * 4 + 1] * f;
    data[i * 3 + 2] = rgbe[i * 4 + 2] * f;
  }
  return { width, height, data };
}

/** Box-resample RGB float image to W x H, returning linear Float32 RGBA. */
function resampleToEnvSize(src) {
  const out = new Float32Array(W * H * 4);
  const sx = src.width / W;
  const sy = src.height / H;
  for (let y = 0; y < H; y += 1) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < W; x += 1) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * src.width + xx) * 3;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * W + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 1;
    }
  }
  return out;
}

function meanLuminance(rgba) {
  let sum = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < n; i += 1) sum += 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
  return sum / n;
}

/**
 * The room photo is an 8-bit LDR image: its ceiling downlights top out at 1.0, the
 * same radiance as a lit wall, so metals reflect them as dull grey patches and
 * pages compensated with 5-11x intensity (washing the whole room out). Expand
 * the highlights instead (inverse-tone-map style): radiance *= 1 + k * s^2 where
 * s = smoothstep(0.30, 0.95, luminance). Walls (<0.3) keep their radiance, the
 * downlight squares reach (1 + k)x. `boost` = k, per page (0 = untouched photo).
 */
function applyHighlightBoost(rgba, k) {
  if (!(k > 0)) return;
  for (let i = 0, n = rgba.length / 4; i < n; i += 1) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // luminance thresholds expressed in linear radiance (sRGB 0.3 ~ 0.073, 0.95 ~ 0.89)
    const t = Math.min(1, Math.max(0, (l - 0.073) / (0.89 - 0.073)));
    const s = t * t * (3 - 2 * t);
    const f = 1 + k * s * s;
    rgba[i * 4] = r * f;
    rgba[i * 4 + 1] = g * f;
    rgba[i * 4 + 2] = b * f;
  }
}

/**
 * Rotate an equirect (linear Float32 RGBA, rows top-first) by Euler XYZ radians:
 * out(dir) = src(R^-1 dir), bilinear. Only used when a page passes an array
 * `rotation`; every other page never reaches this.
 */
function rotateEquirect(src, euler) {
  const [ax, ay, az] = euler;
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  // R = Rz * Ry * Rx ; inverse = transpose
  const r00 = cz * cy, r01 = cz * sy * sx - sz * cx, r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy, r11 = sz * sy * sx + cz * cx, r12 = sz * sy * cx - cz * sx;
  const r20 = -sy, r21 = cy * sx, r22 = cy * cx;
  const out = new Float32Array(src.length);
  for (let y = 0; y < H; y += 1) {
    const el = (0.5 - (y + 0.5) / H) * Math.PI;
    const ce = Math.cos(el), se = Math.sin(el);
    for (let x = 0; x < W; x += 1) {
      const ph = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
      const dx = ce * Math.cos(ph), dy = se, dz = ce * Math.sin(ph);
      const qx = r00 * dx + r10 * dy + r20 * dz;
      const qy = r01 * dx + r11 * dy + r21 * dz;
      const qz = r02 * dx + r12 * dy + r22 * dz;
      const u = Math.atan2(qz, qx) / (2 * Math.PI) + 0.5;
      const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, qy))) / Math.PI;
      const fx = u * W - 0.5, fy = Math.min(H - 1, Math.max(0, v * H - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W, ya = y0, yb = Math.min(H - 1, y0 + 1);
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const a = src[(ya * W + xa) * 4 + c] * (1 - tx) + src[(ya * W + xb) * 4 + c] * tx;
        const b = src[(yb * W + xa) * 4 + c] * (1 - tx) + src[(yb * W + xb) * 4 + c] * tx;
        out[o + c] = a * (1 - ty) + b * ty;
      }
    }
  }
  return out;
}

/**
 * Rev21 s37: bake ONE line-shaped light into the equirect (linear RGBA, top-first),
 * i.e. an emissive strip that exists only inside the environment map (no THREE
 * light). spec = {color:[r,g,b] linear, intensity, azimuth (rad), halfWidth (rad),
 * elevMin, elevMax (rad), soft (rad), tilt (rad)}. Added on top of the tier's radiance.
 */
function paintLineLight(rgba, spec) {
  const color = spec.color || [0.012, 0.028, 0.147];
  const k = Number.isFinite(spec.intensity) ? spec.intensity : 20;
  const az = Number.isFinite(spec.azimuth) ? spec.azimuth : 0;
  const hw = Math.max(1e-3, Number.isFinite(spec.halfWidth) ? spec.halfWidth : 0.02);
  const e0 = Number.isFinite(spec.elevMin) ? spec.elevMin : -0.9;
  const e1 = Number.isFinite(spec.elevMax) ? spec.elevMax : 0.9;
  const soft = Math.max(1e-3, Number.isFinite(spec.soft) ? spec.soft : 0.12);
  const tilt = Number.isFinite(spec.tilt) ? spec.tilt : 0;
  const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < H; y += 1) {
    const el = (0.5 - (y + 0.5) / H) * Math.PI;
    const ends = ss(e0 - soft, e0 + soft, el) * (1 - ss(e1 - soft, e1 + soft, el));
    if (ends <= 0) continue;
    const center = az + tilt * el;
    for (let x = 0; x < W; x += 1) {
      let d = ((x + 0.5) / W - 0.5) * 2 * Math.PI - center;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const across = 1 - ss(hw * 0.35, hw, Math.abs(d));
      if (across <= 0) continue;
      const f = k * across * ends;
      const o = (y * W + x) * 4;
      rgba[o] += color[0] * f;
      rgba[o + 1] += color[1] * f;
      rgba[o + 2] += color[2] * f;
    }
  }
}

/* --------------------------------------------------------------- handle */

/**
 * Create the environment handle: loads the initial tier, owns one stable PMREM
 * render target, and exposes `setEnv(tier)`.
 *
 * @param {any} THREE
 * @param {any} renderer
 * @param {{tier?: string, intensity?: number, url?: string, rotation?: number}} [options]  rotation = env yaw in radians (default 0)
 */
export async function createEnvRoom(THREE, renderer, options = {}) {
  if (!THREE) throw new Error('env-room: three namespace required');
  if (!renderer) throw new Error('env-room: renderer required');

  const cache = new Map(); // tier -> linear Float32 RGBA (already luminance-matched)
  const scenes = new Set();
  const listeners = new Set();
  const sceneLevel = 'environmentIntensity' in new THREE.Scene();
  let referenceLuminance = 0;
  const boost = Number.isFinite(options.boost) ? Math.max(0, options.boost) : 0;
  // options.rotation: number = yaw (rad) | [rx, ry, rz] = Euler XYZ (rad) applied to the environment.
  const rotation = Number.isFinite(options.rotation) ? options.rotation : 0;
  const rotationEuler = Array.isArray(options.rotation) && options.rotation.some((v) => Number(v)) ? options.rotation.map(Number) : null;
  let renderTarget = null;
  let disposed = false;
  let tier = null;
  let intensity = Number.isFinite(options.intensity) ? Math.max(0, options.intensity) : ENV_ROOM.intensity;
  let chain = Promise.resolve();
  let lineLight = null; // s37: optional baked line light (null = off)

  async function loadTier(id) {
    if (cache.has(id)) return cache.get(id);
    const def = ENV_TIERS[id];
    let linear;
    if (def.kind === 'ldr') {
      linear = await decodeLdr(options.url && id === 'room' ? options.url : def.url);
    } else {
      linear = resampleToEnvSize(parseRGBE(await fetchBuffer(def.url)));
    }
    if (id === 'room') {
      referenceLuminance = meanLuminance(linear);
      applyHighlightBoost(linear, boost);
    } else {
      // Match each HDR to the room photo's mean radiance so per-page intensity
      // tuning stays roughly valid across tiers.
      if (!referenceLuminance) {
        await loadTier('room');
      }
      const scale = referenceLuminance / Math.max(1e-6, meanLuminance(linear));
      for (let i = 0; i < linear.length; i += 1) linear[i] *= scale;
    }
    cache.set(id, linear);
    return linear;
  }

  function toHalf(linear, gain) {
    const toHalfFloat = THREE.DataUtils.toHalfFloat;
    const out = new Uint16Array(linear.length);
    // DataTexture row 0 is the bottom of the image; `linear` is stored top-first.
    // Optional yaw rotation (options.rotation, radians; default 0 = untouched):
    // shift the equirect columns so the environment turns about the vertical axis.
    if (rotationEuler) linear = rotateEquirect(linear, rotationEuler);
    if (lineLight) {
      if (linear === cache.get(tier)) linear = linear.slice();
      paintLineLight(linear, lineLight);
    }
    const shift = Math.round((rotation / (Math.PI * 2)) * W);
    for (let y = 0; y < H; y += 1) {
      const src = y * W * 4;
      const dst = (H - 1 - y) * W * 4;
      if (!shift) {
        for (let i = 0; i < W * 4; i += 1) out[dst + i] = toHalfFloat(Math.min(65000, linear[src + i] * gain));
      } else {
        for (let x = 0; x < W; x += 1) {
          const sx = (((x - shift) % W) + W) % W;
          for (let c = 0; c < 4; c += 1) out[dst + x * 4 + c] = toHalfFloat(Math.min(65000, linear[src + sx * 4 + c] * gain));
        }
      }
    }
    return out;
  }

  function bake() {
    const linear = cache.get(tier);
    const gain = sceneLevel ? 1 : intensity;
    const source = new THREE.DataTexture(toHalf(linear, gain), W, H, THREE.RGBAFormat, THREE.HalfFloatType);
    source.mapping = THREE.EquirectangularReflectionMapping;
    source.magFilter = THREE.LinearFilter;
    source.minFilter = THREE.LinearFilter;
    source.generateMipmaps = false;
    source.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    if (typeof pmrem.compileEquirectangularShader === 'function') pmrem.compileEquirectangularShader();
    if (renderTarget && !sceneLevel && typeof pmrem._setSize === 'function' && typeof pmrem._allocateTargets === 'function') {
      // r151 only builds the blur ping-pong target inside _allocateTargets(); a
      // reused output target would leave it null and bake black. Prime it.
      pmrem._setSize(W / 4);
      pmrem._allocateTargets().dispose();
    }
    renderTarget = pmrem.fromEquirectangular(source, renderTarget);
    pmrem.dispose();
    source.dispose(); // the equirect has done its job; only the PMREM chain is kept
  }

  function applyScenes() {
    for (const scene of scenes) {
      scene.environment = renderTarget.texture;
      if (sceneLevel) scene.environmentIntensity = intensity;
    }
  }

  function notify() {
    for (const fn of listeners) {
      try {
        fn(tier, handle);
      } catch (error) {
        console.error(error);
      }
    }
  }

  const handle = {
    THREE,
    renderer,
    sceneLevel,
    tiers: ENV_TIERS,
    get texture() {
      return renderTarget ? renderTarget.texture : null;
    },
    get renderTarget() {
      return renderTarget;
    },
    get tier() {
      return tier;
    },
    get intensity() {
      return intensity;
    },
    /** Intensity the page asked for at creation (modes restore to it). */
    baseIntensity: intensity,
    /** Make `scene` use this environment (kept in sync on every tier change). */
    bind(scene) {
      if (!scene) return handle;
      scenes.add(scene);
      scene.environment = renderTarget.texture;
      if (sceneLevel) scene.environmentIntensity = intensity;
      return handle;
    },
    unbind(scene) {
      scenes.delete(scene);
      return handle;
    },
    /** Compatibility no-op: materials are never scaled any more. */
    refresh() {
      return handle;
    },
    /** Change the intensity multiplier (r151 re-bakes the PMREM). */
    setIntensity(value) {
      const next = Math.max(0, Number(value) || 0);
      if (next === intensity) return handle;
      intensity = next;
      if (disposed || !tier) return handle;
      if (sceneLevel) applyScenes();
      else bake();
      return handle;
    },
    /** s37: bake (or clear with null) one line-shaped light into the environment map. */
    setLineLight(spec) {
      lineLight = spec ? { ...spec } : null;
      if (disposed || !tier) return handle;
      bake();
      applyScenes();
      return handle;
    },
    get lineLight() {
      return lineLight ? { ...lineLight } : null;
    },
    /** Switch tier; resolves to the active tier id. Serialised, cached. */
    setEnv(next) {
      const id = normalizeEnvTier(next);
      if (!id) return Promise.reject(new Error('env-room: unknown tier ' + next));
      chain = chain.then(async () => {
        if (disposed || id === tier) return tier;
        await loadTier(id);
        if (disposed) return tier;
        tier = id;
        bake();
        applyScenes();
        notify();
        return tier;
      });
      return chain;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const scene of scenes) if (scene.environment === (renderTarget && renderTarget.texture)) scene.environment = null;
      scenes.clear();
      listeners.clear();
      cache.clear();
      if (renderTarget) renderTarget.dispose();
      renderTarget = null;
    },
  };

  await handle.setEnv(normalizeEnvTier(options.tier) || envTierFromUrl() || 'room');
  if (typeof window !== 'undefined') {
    (window.__tekoEnvRooms = window.__tekoEnvRooms || []).push(handle);
  }
  return handle;
}

/**
 * Attach the environment to a scene (plus intensity). Resolves once lit.
 * @param {any} THREE
 * @param {any} renderer
 * @param {any} scene
 * @param {{url?: string, tier?: string, intensity?: number}} [options]
 */
export async function applyEnvRoom(THREE, renderer, scene, options = {}) {
  if (!scene) throw new Error('env-room: scene required');
  const handle = await createEnvRoom(THREE, renderer, options);
  handle.scene = scene;
  handle.bind(scene);
  if (options.toggle !== false && typeof document !== 'undefined') {
    const mount = () => mountEnvToggle(handle, { className: options.toggleClass, container: options.toggleContainer ? (typeof options.toggleContainer === 'function' ? options.toggleContainer() : options.toggleContainer) : undefined });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }
  return handle;
}

/* ------------------------------------------------------------ toggle UI */

const TOGGLE_CSS = `
.env-toggle{display:inline-flex;align-items:stretch;gap:0;margin:0;padding:0;border:0;background:none;vertical-align:middle}
.env-toggle>button{margin:0;border-radius:0;min-width:0;white-space:nowrap}
.env-toggle>button:first-child{border-top-left-radius:999px;border-bottom-left-radius:999px}
.env-toggle>button:last-child{border-top-right-radius:999px;border-bottom-right-radius:999px}
.env-toggle>button+button{margin-left:-1px}
.env-toggle>button[aria-pressed="true"]{background:#3b4256!important;color:#fff!important;border-color:#8b94b0!important}
.env-toggle{max-width:100%;box-sizing:border-box;min-width:0}
@media (max-width:640px){.env-toggle{display:flex;width:100%;grid-column:1/-1}.env-toggle>button{flex:1 1 0!important;width:auto!important;min-width:0;min-height:0!important;height:30px!important;padding:0 8px!important;font-size:11px!important}}
.env-toggle--float{position:fixed;right:16px;bottom:16px;z-index:50}
.env-toggle--stage{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:6;width:auto!important}
.env-toggle--float>button,.env-toggle--stage>button{font:600 11px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:9px 12px;color:#cfd3dc;background:rgba(12,14,20,.72);border:1px solid rgba(255,255,255,.22);cursor:pointer}
`;

/**
 * Mount the segmented Room / Mono / Studio switch. Looks for the page's own
 * control bar (`.control-bar`, `.controls`, `.toolbar`) and borrows the class
 * of an existing secondary button so it matches; falls back to a floating pill.
 *
 * @param {ReturnType<typeof createEnvRoom> extends Promise<infer T> ? T : never} room
 * @param {{container?: Element, onChange?: (tier: string) => void}} [options]
 * @returns {HTMLElement}
 */
export function mountEnvToggle(room, options = {}) {
  if (typeof document === 'undefined' || !room) return null;
  const existing = document.querySelector('.env-toggle');
  if (existing) return existing;
  if (!document.getElementById('env-toggle-style')) {
    const style = document.createElement('style');
    style.id = 'env-toggle-style';
    style.textContent = TOGGLE_CSS;
    document.head.appendChild(style);
  }
  const container =
    options.container || document.querySelector('.control-bar, .controls, .toolbar, #controls, .bp-controls');
  const group = document.createElement('div');
  group.className = 'env-toggle';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Environment lighting');
  group.dataset.envToggle = '1';
  let buttonClass = '';
  if (container) {
    const sample =
      container.querySelector('button.btn-ghost, button.quiet, button.seg-btn, button.btn:not(.btn-primary)') ||
      container.querySelector('button:not(.btn-primary)');
    if (sample) buttonClass = Array.from(sample.classList).filter((c) => !/^(is-|selected|active)/.test(c)).join(' ');
  } else {
    group.classList.add('env-toggle--float');
  }
  if (options.className) {
    group.classList.add(options.className);
    buttonClass = '';
  }
  const buttons = new Map();
  for (const id of ['room', 'mono', 'small']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = buttonClass;
    button.dataset.env = id;
    button.textContent = ENV_TIERS[id].label;
    button.title = ENV_TIERS[id].url;
    button.setAttribute('aria-pressed', String(room.tier === id));
    button.addEventListener('click', () => {
      room.setEnv(id).catch((error) => console.error(error));
    });
    group.appendChild(button);
    buttons.set(id, button);
  }
  const sync = (tier) => {
    for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === tier));
    group.dataset.env = tier;
    if (typeof options.onChange === 'function') options.onChange(tier);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('teko-env-change', { detail: { tier } }));
    }
  };
  room.onChange(sync);
  group.dataset.env = room.tier;
  (container || document.body).appendChild(group);
  return group;
}

export default applyEnvRoom;
