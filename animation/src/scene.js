/**
 * tekoanimation — silver studio 3D scene.
 *
 * Owns the WebGLRenderer, the PMREM RoomEnvironment, the lights, the coin
 * presentation rig (float / tilt / face / spin), the gallery layout and the
 * projected gallery labels. Coin meshes are supplied by ./coin-model.js
 * through the SPEC §4 API; this module never composes coin textures itself.
 *
 * Interaction: a free quaternion trackball drags the composition 360° around
 * the fixed camera. Pointer positions are mapped onto a virtual unit sphere and
 * each move becomes a camera-space axis-angle delta that pre-multiplies the
 * target quaternion (arcball), so the full SO(3) is reachable — there are no
 * Euler angle clamps and no gimbal lock anywhere in the view path. Shift+drag
 * or a two-pointer twist rolls about the view axis. There is no tap-to-flip
 * gesture — the coin's two faces are an internal `setFace()` concern
 * (`?face=b`).
 *
 * Rendering: a requestAnimationFrame loop for interactive browsers plus a
 * low-frequency timer "pulse" so the scene still presents frames in headless
 * capture environments where rAF is starved (Chrome --virtual-time-budget).
 */
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import {
  TRACKBALL,
  arcballDelta,
  axisAngleToQuat,
  quatAngle,
  quatFromEulerYXZ,
  quatMultiply,
  quatNormalize,
  quatSlerp,
  quatToEulerYXZ,
} from './trackball.js';

const TAU = Math.PI * 2;
// Rev3: both faces carry the identical engraved symbol; "a"/"b" are just the
// two sides of the 3D coin (legacy flag/symbol aliases map to a/b upstream).
const FACE_ANGLE = { a: 0, b: Math.PI };

// Revision 8: free quaternion trackball view.
// A pointer drag maps stage coordinates onto a virtual sphere (arcball) and
// pre-multiplies camera-space axis-angle deltas onto the target quaternion, so
// the view can rotate forever in any direction (no Euler clamps). Shift+drag
// and a two-pointer twist still roll about the view axis with the old feel.
const VIEW_SENSITIVITY = 0.0058; // radians per CSS pixel (roll only)
const TWIST_MIN_SPREAD = 24; // CSS px between the two pointers before a twist counts
const DRAG_TAP_THRESHOLD = 5; // CSS px — below this a pointer gesture is a click
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_DIST = 40; // CSS px

const HERO_FIT = { w: 2.78, h: 2.78 };
// Rev6: seven coins -> 4 + 3 grid, last row centred.
const GALLERY_LAYOUT = {
  cols: 4,
  gapX: 2.6,
  gapY: 2.45,
  labelOffset: 1.12,
};
const GALLERY_FIT = { w: 10.45, h: 6.6 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function makeRadialTexture(stops, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  return texture;
}

export class CoinStudio {
  /**
   * @param {{ canvas: HTMLCanvasElement, stage: HTMLElement, reducedMotion?: boolean, shot?: boolean }} options
   */
  constructor(options) {
    this.canvas = options.canvas;
    this.stage = options.stage;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.shot = Boolean(options.shot);
    // Revision 2: deterministic 3/4 presentation (?tilt=1) revealing the mid-frame.
    this.threeQuarter = Boolean(options.tilt);

    this._onGalleryTap = typeof options.onGalleryTap === 'function' ? options.onGalleryTap : null;

    this.mode = 'hero';
    this.face = 'a';
    this.spinEnabled = false;

    // Revision 8: free trackball view state. `quaternion` is the orientation
    // actually rendered on the orbit group, `target` the orientation the input
    // drives; the current slerps towards the target at the old rates.
    // `velocity` is a camera-space angular velocity (rad/s) that feeds the
    // bounded, damped release inertia. There are no Euler angles (and no
    // clamps) in this path — the Euler yaw/pitch/roll are derived on demand for
    // `getView()` only.
    this._view = {
      quaternion: new THREE.Quaternion(),
      target: new THREE.Quaternion(),
      dragging: false,
      flinging: false,
      velocity: new THREE.Vector3(),
    };
    this._drag = null;
    this._pointers = new Map();
    this._lastTapAt = 0;
    this._lastTapX = 0;
    this._lastTapY = 0;
    this._resetWaiters = [];

    this._size = { w: 1, h: 1 };
    this._time = 0;
    this._lastFrame = 0;
    this._lastPulseAt = 0;
    this._lastRenderAt = 0;
    this._camDist = 6;
    this._camTarget = 6;
    this._flipAngle = 0;
    this._flipTween = null;
    this._flipWaiters = [];
    this._spinAngle = 0;
    this._intro = null;
    this._introPlayed = false;
    this._introPose = 0;
    this._pointerTarget = { x: 0, y: 0 };
    this._hovered = null;
    this._selected = null;
    this._galleryEntries = [];
    this._labelEls = new Map();
    this._stats = { fps: 0, textures: 0, drawCalls: 0, triangles: 0 };
    this._stableWaiters = [];
    this._frameCount = 0;
    this._renderCount = 0;
    this._coinGroups = [];
    this._heroCoin = null;
    this._pulseTimer = 0;
    // Revision 7: per-frame hooks registered by the page (stack settle etc.).
    this._frameHooks = [];
  }

  /* ---------------------------------------------------------------- boot */

  async init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.88;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 140);
    this.camera.position.set(0, 0, 6);

    // Silver studio reflections: PMREM-filtered RoomEnvironment (SPEC §5.1).
    // Revision 2: the room panels are dimmed before filtering so the engraving
    // is not washed out by broad environment highlights; the reflections that
    // remain still give the silver its metallic body.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    envScene.traverse((object) => {
      if (object.isPointLight) object.intensity *= 0.35;
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material && material.color) material.color.multiplyScalar(0.18);
      }
    });
    this._envRT = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this._envRT.texture;
    envScene.dispose();
    pmrem.dispose();

    // Warm key + cool rim + soft frontal fill.
    // Revision 2: stronger key, softer rim/bounce and a quieter environment so
    // the engraved line work and shallow relief read instead of being washed out.
    const key = new THREE.DirectionalLight(0xfff0dc, 4.2);
    key.position.set(6.5, 2.2, 1.8);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xa9c9ff, 2.6);
    rim.position.set(-4.5, 3.0, -3.5);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0xdfe9ff, 0.15);
    fill.position.set(0.6, -2.6, 3.4);
    this.scene.add(fill);

    const warmBounce = new THREE.PointLight(0xffd6ae, 0.5, 16, 2);
    warmBounce.position.set(-2.4, 1.4, 3.2);
    this.scene.add(warmBounce);

    const coolBounce = new THREE.PointLight(0x9dbfe8, 2.0, 18, 2);
    coolBounce.position.set(2.8, -1.2, -2.2);
    this.scene.add(coolBounce);

    // Presentation rig:
    //   root (float) > tilt (pointer parallax) > presentation (fixed 3/4 tilt)
    //   > hero flip > coin, and > gallery grid.
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.tilt = new THREE.Group();
    this.root.add(this.tilt);

    // Revision 8: drag orbit group around the fixed presentation rig. Its
    // orientation is driven directly as a quaternion (arcball trackball); the
    // 'YXZ' rotation order is only the order used to derive the informational
    // yaw/pitch/roll readout — the transform is never driven through it.
    this.orbit = new THREE.Group();
    this.orbit.rotation.order = 'YXZ';
    this.tilt.add(this.orbit);

    this.presentation = new THREE.Group();
    this.presentation.rotation.order = 'YXZ';
    this.orbit.add(this.presentation);

    this.heroRig = new THREE.Group();
    this.presentation.add(this.heroRig);

    this.heroFlip = new THREE.Group();
    this.heroRig.add(this.heroFlip);

    this.heroHolder = new THREE.Group();
    this.heroFlip.add(this.heroHolder);

    this.galleryGroup = new THREE.Group();
    this.galleryGroup.visible = false;
    this.tilt.add(this.galleryGroup);

    this._applyPresentation();
    this._buildBackdrop();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.stage);
    this._resize();

    this._onPointerDown = (event) => this._handlePointerDown(event);
    this._onPointerMove = (event) => this._handlePointerMove(event);
    this._onPointerUp = (event) => this._handlePointerUp(event);
    this._onPointerCancel = (event) => this._handlePointerCancel(event);
    this._onPointerLeave = (event) => this._handlePointerLeave(event);
    this._onDoubleClick = (event) => {
      if (this.shot || this.mode !== 'hero') return;
      event.preventDefault();
      this.resetView();
    };
    this.canvas.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    this.canvas.addEventListener('pointermove', this._onPointerMove, { passive: false });
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerCancel);
    this.canvas.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
    this.canvas.addEventListener('dblclick', this._onDoubleClick);
    this._updateCursor();

    this._startLoop();
    this._startPulse();
    this.renderNow();
    return this;
  }

  _buildBackdrop() {
    const glowTexture = makeRadialTexture([
      [0, 'rgba(255,255,255,0.5)'],
      [0.38, 'rgba(255,255,255,0.18)'],
      [0.68, 'rgba(255,255,255,0.05)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const glowMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      color: 0x9fb6d6,
      toneMapped: false,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 6.4), glowMaterial);
    this.glow.position.set(0, 0.05, -2.4);
    this.glow.renderOrder = -2;
    this.scene.add(this.glow);

    const shadowTexture = makeRadialTexture([
      [0, 'rgba(255,255,255,0.9)'],
      [0.45, 'rgba(255,255,255,0.42)'],
      [0.78, 'rgba(255,255,255,0.08)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.35), shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0, -1.5, 0);
    this.shadow.renderOrder = -1;
    this.scene.add(this.shadow);
  }

  /* ------------------------------------------------------------- layout */

  _resize() {
    if (!this.renderer) return;
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this._size.w && height === this._size.h) return;
    this._size = { w: width, h: height };
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this._computeFit();
    if (this.shot || this.reducedMotion || this.threeQuarter) this._camDist = this._camTarget;
  }

  _fitDistance(reqW, reqH) {
    const vFov = (this.camera.fov * Math.PI) / 180;
    const halfTan = Math.tan(vFov / 2);
    const aspect = this._size.w / Math.max(1, this._size.h);
    const byHeight = reqH / 2 / halfTan;
    const byWidth = reqW / 2 / (halfTan * aspect);
    return Math.max(byHeight, byWidth);
  }

  _computeFit() {
    // A strong 3/4 view projects the disc smaller; pull the camera in a little
    // so the patterned middle frame still reads at hero size.
    const heroFit = this.threeQuarter ? 2.0 : HERO_FIT.w;
    this._heroDist = this._fitDistance(heroFit, heroFit) + 0.35;
    this._galleryDist = this._fitDistance(GALLERY_FIT.w, GALLERY_FIT.h) + 0.35;
    this._camTarget = this.mode === 'gallery' ? this._galleryDist : this._heroDist;
    this._camY = this.mode === 'gallery' ? 0.9 : 0.52;
    this.glow.scale.setScalar(this.mode === 'gallery' ? 1.5 : 1);
  }

  /* ------------------------------------------------------------- coins */

  setHeroCoin(coin) {
    if (this._heroCoin) this.heroHolder.remove(this._heroCoin.group);
    this._heroCoin = coin || null;
    if (!coin) {
      this._coinGroups = this._galleryEntries.map((entry) => entry.coin.group);
      return;
    }
    const group = coin.group;
    group.rotation.order = 'XYZ';
    group.rotation.set(Math.PI / 2, this._spinAngle, 0);
    this.heroHolder.add(group);
    this._coinGroups = [group];
    this._syncFlipVisual();
  }

  clearHeroCoin() {
    if (this._heroCoin) {
      this.heroHolder.remove(this._heroCoin.group);
      this._heroCoin = null;
    }
    this._coinGroups = this._galleryEntries.map((entry) => entry.coin.group);
  }

  setGalleryCoins(coins, labels) {
    this.clearGallery();
    this._labelEls = labels || new Map();
    const { cols, gapX, gapY } = GALLERY_LAYOUT;
    // Split into rows so the final partial row is centred (11 = 4 + 4 + 3).
    const rows = [];
    for (let start = 0; start < coins.length; start += cols) rows.push(coins.slice(start, start + cols));
    rows.forEach((rowCoins, row) => {
      rowCoins.forEach((coin, col) => {
        const count = rowCoins.length;
        const holder = new THREE.Group();
        holder.position.set((col - (count - 1) / 2) * gapX, ((rows.length - 1) / 2 - row) * gapY, 0);
        // Rev2: each coin gets the fixed 3/4 tilt so the patterned middle frame
        // shows, while the gallery grid itself stays face-on and non-overlapping.
        holder.rotation.order = 'YXZ';
        holder.rotation.set(this._tiltPitch, this._tiltYaw, 0);

        const flip = new THREE.Group();
        holder.add(flip);

        const group = coin.group;
        group.rotation.order = 'XYZ';
        group.rotation.set(Math.PI / 2, this._spinAngle, 0);
        flip.add(group);

        this.galleryGroup.add(holder);
        this._galleryEntries.push({ id: coin.spec ? coin.spec.id : String(row * cols + col), coin, holder, flip });
      });
    });
    this._coinGroups = this._galleryEntries.map((entry) => entry.coin.group);
    this._syncFlipVisual();
    this._updateLabels();
  }

  clearGallery() {
    for (const entry of this._galleryEntries) this.galleryGroup.remove(entry.holder);
    this._galleryEntries = [];
    this._labelEls = new Map();
    this._setHovered(null);
    this._coinGroups = this._heroCoin ? [this._heroCoin.group] : [];
  }

  _syncFlipVisual() {
    const angle = FACE_ANGLE[this.face] || 0;
    this._flipAngle = angle;
    this.heroFlip.rotation.x = angle;
    for (const entry of this._galleryEntries) entry.flip.rotation.x = angle;
  }

  /** Fixed presentation tilt: subtle 3/4 by default, stronger with ?tilt=1. */
  _applyPresentation() {
    const strong = this.threeQuarter;
    // Default hero/gallery presentation is yaw-free so the engraved face design
    // is horizontally symmetric/centred on the coin silhouette; a modest pitch
    // keeps the 3D read (top/bottom middle-frame band visible). ?tilt=1 keeps
    // the strong 3/4 view that reveals the patterned middle frame.
    this._tiltYaw = strong ? -1.0 : 0; // -57° / 0°
    this._tiltPitch = strong ? -0.18 : -0.1; // -10.3° / -5.7°
    this.presentation.rotation.y = this._tiltYaw;
    this.presentation.rotation.x = this._tiltPitch;
  }

  /* -------------------------------------------------------------- mode */

  setMode(mode) {
    this.mode = mode === 'gallery' ? 'gallery' : 'hero';
    const gallery = this.mode === 'gallery';
    this.heroRig.visible = !gallery;
    this.galleryGroup.visible = gallery;
    this.shadow.visible = !gallery;
    this._computeFit();
    if (this.shot || this.reducedMotion) this._camDist = this._camTarget;
    // A mode switch drops any gesture that was in flight (including a twist).
    this._drag = null;
    this._pointers.clear();
    this._view.dragging = false;
    this._view.flinging = false;
    this._view.velocity.set(0, 0, 0);
    this._setHovered(null);
    this._updateLabels();
    this._updateCursor();
  }

  setSelection(id) {
    this._selected = id || null;
    for (const [coinId, el] of this._labelEls) el.classList.toggle('is-selected', coinId === this._selected);
  }

  setShot(shot) {
    this.shot = Boolean(shot);
    if (this.shot) {
      this._intro = null;
      this.spinEnabled = false;
      this._camDist = this._camTarget;
      this._pointerTarget.x = 0;
      this._pointerTarget.y = 0;
      // Revision 8: deterministic capture mode ignores drag and forces the
      // identity view quaternion (immediate reset of current + target).
      this._drag = null;
      this._pointers.clear();
      this._view.dragging = false;
      this.resetView({ immediate: true });
      this._updateCursor();
    }
  }

  /* -------------------------------------------------------------- face */

  /**
   * Internal two-face support only: the model still carries face a/b (?face=b),
   * but the page no longer exposes a flip gesture. `?shot`/reduced-motion snap.
   */
  setFace(face, { immediate = false } = {}) {
    // Rev3: a/b are the two faces of the coin (legacy flag/symbol tolerated).
    const next = face === 'b' || face === 'symbol' ? 'b' : 'a';
    this.face = next;
    const target = FACE_ANGLE[next];
    const instant = immediate || this.shot || this.reducedMotion;
    if (instant) {
      this._flipTween = null;
      this._flipAngle = target;
      this.heroFlip.rotation.x = target;
      for (const entry of this._galleryEntries) entry.flip.rotation.x = target;
      this._flushFlipWaiters();
      return Promise.resolve();
    }
    const done = new Promise((resolve) => this._flipWaiters.push(resolve));
    if (Math.abs(this._flipAngle - target) < 0.0005) {
      this._flushFlipWaiters();
      return done;
    }
    const from = this._flipAngle;
    this._flipTween = {
      from,
      to: target,
      t: 0,
      dur: 0.5 + 0.45 * Math.min(1, Math.abs(target - from) / Math.PI),
    };
    return done;
  }

  _flushFlipWaiters() {
    const waiters = this._flipWaiters;
    this._flipWaiters = [];
    for (const resolve of waiters) resolve();
  }

  setSpin(enabled) {
    this.spinEnabled = Boolean(enabled) && !this.reducedMotion && !this.shot;
  }

  playIntro() {
    if (this.shot || this.reducedMotion || this.threeQuarter || this._introPlayed) {
      this._intro = null;
      this._introPose = 0;
      return;
    }
    this._introPlayed = true;
    this._intro = { t: 0, dur: 1.1 };
  }

  /* ------------------------------------------------------------ picking */

  pick(clientX, clientY) {
    if (this.mode !== 'gallery' || !this._galleryEntries.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const position = new THREE.Vector3();
    let best = null;
    let bestDistance = Infinity;
    this.camera.updateMatrixWorld();
    for (const entry of this._galleryEntries) {
      entry.holder.getWorldPosition(position);
      const projected = position.clone().project(this.camera);
      const cx = (projected.x * 0.5 + 0.5) * rect.width;
      const cy = (-projected.y * 0.5 + 0.5) * rect.height;
      const edge = position.clone().add(new THREE.Vector3(1, 0, 0)).project(this.camera);
      const radius = Math.abs((edge.x - projected.x) * 0.5 * rect.width) * 1.06;
      const distance = Math.hypot(px - cx, py - cy);
      if (distance <= radius && distance < bestDistance) {
        bestDistance = distance;
        best = entry.id;
      }
    }
    return best;
  }

  /* --------------------------------------------------------- drag view */

  /**
   * Normalized stage coordinates of a viewport position: x/y in [-1, 1] with y
   * pointing up (the arcball convention). Guards zero-sized stages.
   */
  _pointerNormalized(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    return {
      x: ((clientX - rect.left) / width) * 2 - 1,
      y: -(((clientY - rect.top) / height) * 2 - 1),
    };
  }

  /**
   * Pre-multiply the target quaternion with a camera-space delta rotation:
   * `target = delta ⊗ target`. Pre-multiplying applies the delta after the
   * current view, which is what makes the trackball rotate freely past 90°/180°
   * instead of unfolding through Euler angles. Normalized on every update.
   */
  _premultiplyTarget(delta) {
    if (!delta) return;
    const view = this._view;
    view.target.fromArray(quatNormalize(quatMultiply(delta, view.target.toArray())));
  }

  /** Copy the current (eased) view quaternion onto the rendered orbit group. */
  _syncOrbit() {
    if (this.orbit) this.orbit.quaternion.copy(this._view.quaternion);
  }

  _handlePointerDown(event) {
    if (this.shot) return;
    if (event.button !== undefined && event.button !== 0) return;
    this._pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      px: event.clientX,
      py: event.clientY,
    });
    const isGallery = this.mode === 'gallery';

    // Revision 7/8: a second pointer joining a hero gesture turns it into a
    // two-pointer twist-roll instead of letting the pointers fight over the
    // trackball. One pointer stays the drag anchor; either may twist.
    if (this._drag && !this._drag.gallery && this._pointers.size >= 2) {
      this._drag.twist = true;
      this._drag.twistLast = null;
      this._view.flinging = false;
      this._view.velocity.set(0, 0, 0);
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* pointer capture is best effort */
      }
      this._updateCursor();
      if (event.cancelable) event.preventDefault();
      return;
    }

    const anchor = this._pointerNormalized(event.clientX, event.clientY);
    this._drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastNx: anchor.x,
      lastNy: anchor.y,
      moved: 0,
      prevT: performance.now(),
      gallery: isGallery,
      twist: false,
      twistLast: null,
    };
    this._view.dragging = !isGallery;
    this._view.flinging = false;
    this._view.velocity.set(0, 0, 0);
    if (!isGallery) {
      // A new gesture starts from what is on screen, cancelling any easing or
      // inertia lead the previous gesture left behind.
      this._view.target.copy(this._view.quaternion);
    }
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* pointer capture is best effort */
    }
    this._updateCursor();
    if (!isGallery && event.cancelable) event.preventDefault();
  }

  _handlePointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    this._pointerTarget.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointerTarget.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    if (this.mode === 'gallery') this._setHovered(this.pick(event.clientX, event.clientY));

    const pointer = this._pointers.get(event.pointerId);
    if (pointer) {
      pointer.px = pointer.x;
      pointer.py = pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }

    const drag = this._drag;
    if (!drag) return;
    const primary = drag.id === event.pointerId;
    const twisting = !drag.gallery && !this.shot && drag.twist && this._pointers.size >= 2;
    // While twisting, movement of either finger counts; otherwise only the
    // pointer that opened the gesture drives the view.
    if (!primary && !twisting) return;
    if (pointer) drag.moved += Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py);
    if (drag.gallery || this.shot) {
      if (event.cancelable) event.preventDefault();
      return;
    }

    const now = performance.now();
    const dt = Math.max(0.008, Math.min(0.05, (now - drag.prevT) / 1000));
    drag.prevT = now;
    const view = this._view;

    if (twisting) {
      const measure = this._pointerAngle();
      if (!measure) {
        // Fingers too close together for a stable angle: wait for spread.
        drag.twistLast = null;
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (drag.twistLast === null) {
        drag.twistLast = measure.angle;
        if (event.cancelable) event.preventDefault();
        return;
      }
      let delta = measure.angle - drag.twistLast;
      drag.twistLast = measure.angle;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      // Screen-clockwise twist (positive delta, screen y points down) is a
      // clockwise coin roll, i.e. a negative rotation about the view axis.
      const rollDelta = -delta;
      this._premultiplyTarget(axisAngleToQuat(0, 0, 1, rollDelta));
      view.velocity.z = view.velocity.z * 0.55 + (rollDelta / dt) * 0.45;
      if (event.cancelable) event.preventDefault();
      return;
    }

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    if (event.shiftKey) {
      // Shift+drag rolls about the camera view axis (same sign as the old
      // roll); a vertical component keeps the old pitch reaction.
      const rollDelta = -dx * VIEW_SENSITIVITY;
      const pitchDelta = dy * VIEW_SENSITIVITY;
      this._premultiplyTarget(axisAngleToQuat(0, 0, 1, rollDelta));
      if (pitchDelta) this._premultiplyTarget(axisAngleToQuat(1, 0, 0, pitchDelta));
      view.velocity.z = view.velocity.z * 0.55 + (rollDelta / dt) * 0.45;
      view.velocity.x = view.velocity.x * 0.55 + (pitchDelta / dt) * 0.45;
      if (event.cancelable) event.preventDefault();
      return;
    }

    // Arcball: the pointer move becomes the camera-space rotation carrying the
    // previous virtual-sphere point onto the current one. Pre-multiplying the
    // target quaternion keeps the thing under the pointer under the pointer, so
    // a drag past 90°/180° keeps turning — full 360° in any direction, never
    // through an Euler decomposition (no gimbal lock, no clamp).
    const next = this._pointerNormalized(event.clientX, event.clientY);
    const delta = arcballDelta(drag.lastNx, drag.lastNy, next.x, next.y);
    drag.lastNx = next.x;
    drag.lastNy = next.y;
    this._premultiplyTarget(delta);
    // Smoothed camera-space angular velocity for the light release inertia.
    const angle = quatAngle(delta);
    const axisLength = Math.hypot(delta[0], delta[1], delta[2]);
    if (angle > 1e-9 && axisLength > 1e-9) {
      const rate = angle / (axisLength * dt); // rad/s per unit axis
      view.velocity.x = view.velocity.x * 0.55 + delta[0] * rate * 0.45;
      view.velocity.y = view.velocity.y * 0.55 + delta[1] * rate * 0.45;
      view.velocity.z = view.velocity.z * 0.55 + delta[2] * rate * 0.45;
    } else {
      // Holding still (no virtual-sphere movement, e.g. the pointer resting at
      // the end of a flick) bleeds the gesture velocity off exactly like the
      // old per-axis velocity smoothing did, so a deliberate stop does not
      // release with inertia.
      view.velocity.multiplyScalar(0.55);
    }
    if (event.cancelable) event.preventDefault();
  }

  _handlePointerUp(event) {
    this._pointers.delete(event.pointerId);
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
    const drag = this._drag;
    if (!drag) return;
    // With several pointers down the gesture survives losing one of them: hand
    // the anchor over to a remaining pointer (twist stays on when two are left).
    if (this._pointers.size > 0) {
      this._rebindDrag();
      return;
    }
    this._drag = null;
    this._view.dragging = false;
    this._updateCursor();
    if (this.shot) return;
    if (drag.moved < DRAG_TAP_THRESHOLD) {
      this._view.velocity.set(0, 0, 0);
      this._handleTap(event.clientX, event.clientY, drag.gallery);
      return;
    }
    if (drag.gallery) return;
    const speed = this._view.velocity.length();
    if (this.reducedMotion || speed <= 0.35) {
      this._view.flinging = false;
      this._view.velocity.set(0, 0, 0);
    } else {
      // Light, bounded camera-space inertia so a fast flick cannot spin the
      // composition wildly (≈1.8 rad/s cap, 8/s exponential damping).
      this._view.velocity.multiplyScalar(Math.min(1, TRACKBALL.inertiaMaxSpeed / speed));
      this._view.flinging = true;
    }
    this.renderNow();
  }

  _handlePointerCancel(event) {
    this._pointers.delete(event.pointerId);
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
    if (!this._drag) return;
    if (this._pointers.size > 0) {
      this._rebindDrag();
      return;
    }
    this._drag = null;
    this._view.dragging = false;
    this._view.flinging = false;
    this._view.velocity.set(0, 0, 0);
    this._updateCursor();
  }

  /**
   * Safety net for lost pointers: a pointer that leaves the canvas while the
   * browser is not capturing it would otherwise freeze the drag mid-gesture.
   */
  _handlePointerLeave(event) {
    this._pointerTarget.x = 0;
    this._pointerTarget.y = 0;
    this._setHovered(null);
    if (!this._pointers.has(event.pointerId)) return;
    let captured = false;
    try {
      captured = Boolean(this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(event.pointerId));
    } catch (error) {
      captured = false;
    }
    // While captured, boundary events do not end the gesture; moves keep coming.
    if (captured) return;
    this._pointers.delete(event.pointerId);
    if (!this._drag) return;
    if (this._pointers.size > 0) {
      this._rebindDrag();
      return;
    }
    this._drag = null;
    this._view.dragging = false;
    this._view.flinging = false;
    this._view.velocity.set(0, 0, 0);
    this._updateCursor();
  }

  /** Hand an in-flight gesture to whichever pointer is still down. */
  _rebindDrag() {
    const drag = this._drag;
    const ids = Array.from(this._pointers.keys());
    if (!drag || !ids.length) return;
    drag.id = ids[0];
    drag.twist = !drag.gallery && this._pointers.size >= 2;
    drag.twistLast = null;
    const measure = drag.twist ? this._pointerAngle() : null;
    if (measure) drag.twistLast = measure.angle;
    const anchor = this._pointers.get(drag.id);
    if (anchor) {
      drag.lastX = anchor.x;
      drag.lastY = anchor.y;
      const normalized = this._pointerNormalized(anchor.x, anchor.y);
      drag.lastNx = normalized.x;
      drag.lastNy = normalized.y;
    }
    drag.prevT = performance.now();
    this._view.flinging = false;
    this._view.velocity.set(0, 0, 0);
    this._updateCursor();
  }

  /** Angle (screen space) of the first two tracked pointers, or null. */
  _pointerAngle() {
    const ids = Array.from(this._pointers.keys()).slice(0, 2);
    if (ids.length < 2) return null;
    const a = this._pointers.get(ids[0]);
    const b = this._pointers.get(ids[1]);
    if (!a || !b) return null;
    const spread = Math.hypot(b.x - a.x, b.y - a.y);
    if (spread < TWIST_MIN_SPREAD) return null;
    return { angle: Math.atan2(b.y - a.y, b.x - a.x), spread };
  }

  /**
   * Tap handling. Hero taps are inert (no flip gesture any more); a double-tap
   * resets the view, and gallery taps open the picked coin. Double-click reset
   * is wired separately so it also works for mouse users.
   */
  _handleTap(clientX, clientY, gallery) {
    const now = performance.now();
    if (
      !gallery &&
      now - this._lastTapAt < DOUBLE_TAP_MS &&
      Math.hypot(clientX - this._lastTapX, clientY - this._lastTapY) < DOUBLE_TAP_DIST
    ) {
      this._lastTapAt = 0;
      this.resetView();
      return;
    }
    this._lastTapAt = now;
    this._lastTapX = clientX;
    this._lastTapY = clientY;
    if (!gallery) return;
    const id = this.pick(clientX, clientY);
    if (id && this._onGalleryTap) this._onGalleryTap(id);
  }

  /**
   * Reset the trackball view to the default framing (identity quaternion).
   * Immediate under ?shot=1 / reduced motion; otherwise the current quaternion
   * slerps to the identity and the returned promise resolves once it settles.
   * @param {{ immediate?: boolean }} [options]
   * @returns {Promise<void>}
   */
  resetView(options = {}) {
    const immediate = Boolean(options.immediate) || this.shot || this.reducedMotion;
    const view = this._view;
    view.target.identity();
    view.flinging = false;
    view.velocity.set(0, 0, 0);
    if (immediate) {
      view.quaternion.identity();
      view.dragging = false;
      this._drag = null;
      this._pointers.clear();
      this._syncOrbit();
      this._flushResetWaiters();
      this.renderNow();
      return Promise.resolve();
    }
    return new Promise((resolve) => this._resetWaiters.push(resolve));
  }

  _flushResetWaiters() {
    const waiters = this._resetWaiters;
    this._resetWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /**
   * QA hook: set the view orientation immediately (no easing, no inertia, no
   * clamps). Accepts any of:
   *  - `{ quaternion: [x, y, z, w] }` — normalized; `q` and `-q` are equivalent;
   *  - `{ axis: [x, y, z], angle: radians }` — camera-space axis-angle;
   *  - legacy `{ yaw, pitch, roll }` in radians — Euler order 'YXZ'. Omitted
   *    axes keep their current angle and the triple is read as one orientation.
   * Missing fields keep their current value. Cancels any gesture, stops inertia
   * and resolves pending resetView() waiters.
   * @param {{ quaternion?: number[], axis?: number[], angle?: number, yaw?: number, pitch?: number, roll?: number }} next
   * @returns {ReturnType<CoinStudio['getView']>}
   */
  setView(next = {}) {
    const input = next || {};
    const view = this._view;
    let quaternion = null;
    if (Array.isArray(input.quaternion) && input.quaternion.length >= 4) {
      quaternion = quatNormalize(input.quaternion);
    } else if (Array.isArray(input.axis) && Number.isFinite(input.angle)) {
      quaternion = quatNormalize(
        axisAngleToQuat(input.axis[0], input.axis[1], input.axis[2], input.angle)
      );
    } else if (
      Number.isFinite(input.yaw) ||
      Number.isFinite(input.pitch) ||
      Number.isFinite(input.roll)
    ) {
      const current = quatToEulerYXZ(view.quaternion.toArray());
      const yaw = Number.isFinite(input.yaw) ? input.yaw : current.yaw;
      const pitch = Number.isFinite(input.pitch) ? input.pitch : current.pitch;
      const roll = Number.isFinite(input.roll) ? input.roll : current.roll;
      quaternion = quatFromEulerYXZ(yaw, pitch, roll);
    }
    const applied = quatNormalize(quaternion || view.quaternion.toArray());
    view.quaternion.fromArray(applied);
    view.target.fromArray(applied);
    this._drag = null;
    this._pointers.clear();
    view.dragging = false;
    view.flinging = false;
    view.velocity.set(0, 0, 0);
    this._syncOrbit();
    this._flushResetWaiters();
    this._updateCursor();
    this.renderNow();
    return this.getView();
  }

  /**
   * Read-only view snapshot (QA contract).
   *  - `quaternion`: normalized orientation, 4 dp, canonical `w >= 0` branch;
   *  - `yaw/pitch/roll`: informational Euler 'YXZ' readout derived from it —
   *    the view itself is never driven through these angles;
   *  - `angleRad`: shortest total rotation angle from the identity, [0, π];
   *  - `mode`: fixed tag for the free trackball.
   * @returns {{ quaternion: number[], yaw: number, pitch: number, roll: number, angleRad: number, dragging: boolean, mode: 'trackball-360' }}
   */
  getView() {
    const round = (value) => {
      const rounded = Math.round(value * 10000) / 10000;
      return rounded === 0 ? 0 : rounded;
    };
    let q = quatNormalize(this._view.quaternion.toArray());
    // q and -q are the same rotation; report the canonical w >= 0 branch so the
    // readout is stable (a full 360° sweep reads as the identity again).
    if (q[3] < 0 || (q[3] === 0 && (q[0] < 0 || (q[0] === 0 && q[1] < 0)))) {
      q = [-q[0], -q[1], -q[2], -q[3]];
    }
    const euler = quatToEulerYXZ(q);
    return {
      quaternion: [round(q[0]), round(q[1]), round(q[2]), round(q[3])],
      yaw: round(euler.yaw),
      pitch: round(euler.pitch),
      roll: round(euler.roll),
      angleRad: round(quatAngle(q)),
      dragging: this._view.dragging,
      mode: 'trackball-360',
    };
  }

  _updateCursor() {
    if (this._drag) {
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (this.mode === 'gallery') {
      this.canvas.style.cursor = this._hovered ? 'pointer' : 'default';
      return;
    }
    this.canvas.style.cursor = this.shot ? 'default' : 'grab';
  }

  _setHovered(id) {
    if (this._hovered === id) return;
    this._hovered = id;
    for (const [coinId, el] of this._labelEls) el.classList.toggle('is-hovered', coinId === id);
    this._updateCursor();
  }

  /* ------------------------------------------------------------- render */

  _startLoop() {
    this._raf = 0;
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = this._lastFrame ? Math.min(0.05, Math.max(0, (now - this._lastFrame) / 1000)) : 0.016;
      this._lastFrame = now;
      this._advance(dt);
      this.renderNow();
      this._frameCount += 1;
    };
    this._raf = requestAnimationFrame(loop);
  }

  /** Timer-driven safety pulse for environments where rAF is starved. */
  _startPulse() {
    this._pulseTimer = window.setInterval(() => {
      if (!this.renderer) return;
      const now = performance.now();
      if (now - this._lastRenderAt < 120) return; // rAF loop is healthy
      const dt = clamp((now - (this._lastPulseAt || now - 16)) / 1000, 0.001, 0.12);
      this._lastPulseAt = now;
      this._advance(dt);
      this.renderNow();
      this._frameCount += 1;
    }, 150);
  }

  _advance(dt) {
    this._time += dt;
    this._update(dt);
  }

  renderNow() {
    if (!this.renderer) return;
    this.renderer.render(this.scene, this.camera);
    this._updateLabels();
    const info = this.renderer.info;
    this._stats.textures = info.memory.textures;
    this._stats.drawCalls = info.render.calls;
    this._stats.triangles = info.render.triangles;
    const now = performance.now();
    if (this._lastRenderAt) {
      const instantFps = 1000 / Math.max(1, now - this._lastRenderAt);
      this._stats.fps = this._stats.fps ? this._stats.fps * 0.85 + instantFps * 0.15 : instantFps;
    }
    this._lastRenderAt = now;
    this._renderCount += 1;
    if (this._stableWaiters.length && this._renderCount >= 1) {
      const waiters = this._stableWaiters;
      this._stableWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  _update(dt) {
    // Intro reveal offset
    if (this._intro) {
      this._intro.t += dt / this._intro.dur;
      const eased = easeOutCubic(clamp(this._intro.t, 0, 1));
      this._introPose = 1 - eased;
      if (this._intro.t >= 1) {
        this._intro = null;
        this._introPose = 0;
      }
    } else {
      this._introPose = 0;
    }

    // Flip tween
    if (this._flipTween) {
      const tween = this._flipTween;
      tween.t += dt / tween.dur;
      const eased = easeInOutCubic(clamp(tween.t, 0, 1));
      this._flipAngle = tween.from + (tween.to - tween.from) * eased;
      if (tween.t >= 1) {
        this._flipAngle = tween.to;
        this._flipTween = null;
        this._flushFlipWaiters();
      }
    }
    this.heroFlip.rotation.x = this._flipAngle;
    for (const entry of this._galleryEntries) entry.flip.rotation.x = this._flipAngle;

    // Revision 8: free quaternion trackball — bounded camera-space inertia
    // integrated into the target, then the rendered quaternion slerps towards
    // the target at the old rates (24/s dragging, 12/s at rest, 60/s reduced).
    const view = this._view;
    if (view.flinging) {
      const speed = view.velocity.length();
      if (speed > TRACKBALL.inertiaStopSpeed) {
        const inertia = axisAngleToQuat(
          view.velocity.x / speed,
          view.velocity.y / speed,
          view.velocity.z / speed,
          speed * dt
        );
        this._premultiplyTarget(inertia);
        view.velocity.multiplyScalar(Math.exp(-dt * TRACKBALL.inertiaDamping));
        if (view.velocity.length() < TRACKBALL.inertiaStopSpeed) {
          view.flinging = false;
          view.velocity.set(0, 0, 0);
        }
      } else {
        view.flinging = false;
        view.velocity.set(0, 0, 0);
      }
    }
    const easeRate = this.reducedMotion
      ? TRACKBALL.reducedEase
      : view.dragging
        ? TRACKBALL.dragEase
        : TRACKBALL.releaseEase;
    const orbitEase = 1 - Math.exp(-dt * easeRate);
    view.quaternion.fromArray(
      quatSlerp(view.quaternion.toArray(), view.target.toArray(), orbitEase)
    );
    // Snap once nearly equal (no visible step, no asymptotic crawl) and resolve
    // any pending resetView() promise when it has fully settled.
    const gapDot = Math.abs(view.quaternion.dot(view.target));
    const gapAngle = 2 * Math.acos(Math.min(1, gapDot));
    if (gapAngle < TRACKBALL.snapAngle) {
      view.quaternion.copy(view.target);
      if (this._resetWaiters.length) this._flushResetWaiters();
    }
    view.quaternion.normalize();
    this._syncOrbit();

    // Idle spin (coin turns around its own axis; the displayed face stays front)
    const motionAllowed = !this.shot && !this.reducedMotion && !this.threeQuarter;
    if (this.spinEnabled && motionAllowed) {
      this._spinAngle = (this._spinAngle + dt * 0.62) % TAU;
    }
    for (const group of this._coinGroups) group.rotation.y = this._spinAngle;

    // Subtle float
    this.root.position.y = motionAllowed ? Math.sin(this._time * 0.72) * 0.032 : 0;

    // Pointer parallax + intro swing
    const parallaxScale = this.shot || this.reducedMotion || this.threeQuarter || this.mode === 'hero' ? 0 : 0.45;
    const targetTiltY = this._pointerTarget.x * 0.085 * parallaxScale + this._introPose * 0.5;
    const targetTiltX = -this._pointerTarget.y * 0.055 * parallaxScale;
    const tiltEase = 1 - Math.exp(-dt * 4.2);
    this.tilt.rotation.y = lerp(this.tilt.rotation.y, targetTiltY, tiltEase);
    this.tilt.rotation.x = lerp(this.tilt.rotation.x, targetTiltX, tiltEase);
    this.tilt.rotation.z = lerp(this.tilt.rotation.z, this._pointerTarget.x * 0.012 * parallaxScale, tiltEase);

    // Camera dolly (smooth on mode switches / resize)
    const displayTarget = this._camTarget + this._introPose * 2.4;
    this._camDist = this.shot || this.reducedMotion || this.threeQuarter
      ? displayTarget
      : lerp(this._camDist, displayTarget, 1 - Math.exp(-dt * 5.5));
    this.camera.position.set(0, this._camY, this._camDist);
    this.camera.lookAt(0, 0, 0);

    // Keep the backdrop halo behind the coin.
    this.glow.position.z = -this._camDist * 0.42;

    // Revision 7: page-owned animation hooks run after the core update.
    this._runFrameHooks(dt);
  }

  /* --------------------------------------------------------- frame hooks */

  /**
   * Register a callback invoked once per scene update, after the core rig has
   * been advanced. Used by the page for the stack settle animation.
   * A throwing hook is reported once (console.warn) and never breaks the loop.
   * @param {(dt: number) => void} fn
   * @returns {() => void} unsubscribe
   */
  addFrameHook(fn) {
    if (typeof fn !== 'function') return () => {};
    const hook = { fn, warned: false };
    this._frameHooks.push(hook);
    return () => {
      const index = this._frameHooks.indexOf(hook);
      if (index >= 0) this._frameHooks.splice(index, 1);
    };
  }

  _runFrameHooks(dt) {
    if (!this._frameHooks.length) return;
    for (const hook of this._frameHooks.slice()) {
      try {
        hook.fn(dt);
      } catch (error) {
        if (hook.warned) continue;
        hook.warned = true;
        console.warn('[CoinStudio] frame hook failed:', error);
      }
    }
  }

  clearFrameHooks() {
    this._frameHooks = [];
  }

  _updateLabels() {
    if (!this.renderer || !this._labelEls.size) return;
    const rect = this.canvas.getBoundingClientRect();
    const position = new THREE.Vector3();
    this.camera.updateMatrixWorld();
    for (const entry of this._galleryEntries) {
      const el = this._labelEls.get(entry.id);
      if (!el) continue;
      entry.holder.getWorldPosition(position);
      position.y -= GALLERY_LAYOUT.labelOffset;
      const projected = position.clone().project(this.camera);
      const x = (projected.x * 0.5 + 0.5) * rect.width;
      const y = (-projected.y * 0.5 + 0.5) * rect.height;
      const visible = projected.z < 1 && x > -80 && x < rect.width + 80 && y > -60 && y < rect.height + 60;
      el.style.opacity = visible ? '1' : '0';
      el.style.transform = 'translate3d(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px, 0) translate(-50%, 0)';
    }
  }

  /**
   * Projected coin silhouette centre + radius in CSS px relative to the
   * viewport (QA hook): derived from the coin's world bounds projected with the
   * current camera after the presentation rotation. In gallery mode the
   * selected coin is used.
   */
  getCoinScreen() {
    if (!this.renderer) return null;
    const coin =
      this.mode === 'hero'
        ? this._heroCoin
        : (this._galleryEntries.find((entry) => entry.id === this._selected) || null)?.coin;
    const group = coin && coin.group;
    if (!group) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.camera.updateMatrixWorld();
    group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const round = (value) => Math.round(value * 100) / 100;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const corner = new THREE.Vector3();
    for (let index = 0; index < 8; index += 1) {
      corner.set(
        index & 1 ? box.max.x : box.min.x,
        index & 2 ? box.max.y : box.min.y,
        index & 4 ? box.max.z : box.min.z
      );
      corner.project(this.camera);
      const px = rect.left + (corner.x * 0.5 + 0.5) * rect.width;
      const py = rect.top + (-corner.y * 0.5 + 0.5) * rect.height;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    return {
      x: round((minX + maxX) / 2),
      y: round((minY + maxY) / 2),
      radius: round(Math.max(maxX - minX, maxY - minY) / 2),
    };
  }

  getStats() {
    return {
      textures: this._stats.textures,
      drawCalls: this._stats.drawCalls,
      triangles: this._stats.triangles,
      fps: this._stats.fps,
    };
  }

  whenStable() {
    return new Promise((resolve) => {
      if (this._renderCount >= 1) {
        resolve();
        return;
      }
      this._stableWaiters.push(resolve);
      window.setTimeout(resolve, 400);
    });
  }

  getWebGLInfo() {
    try {
      const gl = this.renderer.getContext();
      return gl.getParameter(gl.VERSION) || null;
    } catch (error) {
      return null;
    }
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.clearInterval(this._pulseTimer);
    if (this._ro) this._ro.disconnect();
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    this.canvas.removeEventListener('dblclick', this._onDoubleClick);
    // Revision 7: frame hooks belong to the page and must not survive disposal.
    this._frameHooks = [];
    this._pointers.clear();
    this._drag = null;
    if (this.glow) {
      this.glow.geometry.dispose();
      this.glow.material.map.dispose();
      this.glow.material.dispose();
    }
    if (this.shadow) {
      this.shadow.geometry.dispose();
      this.shadow.material.map.dispose();
      this.shadow.material.dispose();
    }
    if (this._envRT) this._envRT.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}