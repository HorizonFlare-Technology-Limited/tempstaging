import * as THREE from 'three';

/**
 * iPhone 15 procedural model — Revision 7 integration (black shell only).
 *
 * Derived from the standalone K:\iPhone-15-ThreeJS project (model.js, Three.js
 * r0.180.0). The geometry, materials, cameras, buttons and port details are
 * unchanged; only the finish set is restricted to the reference Black finish
 * (glass #303333 / metal #484d4e), which is also the default finish.
 *
 * Local geometry is in millimeters (root scale .001 exports glTF meters).
 */

export const finishes = { Black: { glass: '#303333', metal: '#484d4e' } };
export const DEFAULT_FINISH = 'Black';
export const FINISH_NAMES = Object.keys(finishes);

export function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function slab(w, h, d, r, b = 0.2) {
  const g = new THREE.ExtrudeGeometry(roundedShape(w - 2 * b, h - 2 * b, Math.max(0.1, r - b)), {
    depth: d - 2 * b,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: b,
    bevelThickness: b,
    curveSegments: 20,
  });
  g.translate(0, 0, -(d - 2 * b) / 2);
  return g;
}

function face(w, h, r) {
  const g = new THREE.ShapeGeometry(roundedShape(w, h, r), 32);
  const p = g.attributes.position;
  const u = g.attributes.uv;
  for (let i = 0; i < p.count; i++) u.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return g;
}

export function createPhone() {
  const root = new THREE.Group();
  root.name = 'iPhone 15';
  root.scale.setScalar(0.001);
  root.userData = {
    model: 'iPhone 15',
    finish: DEFAULT_FINISH,
    finishes: FINISH_NAMES.slice(),
    dimensionsMM: { width: 71.6, height: 147.6, depth: 7.8 },
    source: 'Figma XR9rZ6sUDTiQa8BCUaSTXk',
    note: 'Visual approximation; body dimensions follow Apple specifications. Small hardware details are approximate.',
  };

  const frame = new THREE.MeshStandardMaterial({ color: finishes.Black.metal, metalness: 0.8, roughness: 0.32 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: finishes.Black.glass,
    metalness: 0.12,
    roughness: 0.23,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
  });
  const black = new THREE.MeshStandardMaterial({ color: '#080b10', roughness: 0.28, metalness: 0.25 });
  const lens = new THREE.MeshPhysicalMaterial({ color: '#10213b', roughness: 0.1, metalness: 0.5, clearcoat: 1 });

  function add(name, g, m, x = 0, y = 0, z = 0, parent = root) {
    const a = new THREE.Mesh(g, m);
    a.name = name;
    a.position.set(x, y, z);
    parent.add(a);
    return a;
  }

  add('Contoured aluminum frame', slab(71.6, 147.6, 7.8, 11.5, 0.65), frame);
  add('Color-infused back glass', slab(70.3, 146.3, 0.65, 11.1, 0.18), glass, 0, 0, -3.75);
  add('Black display surround', slab(70.25, 146.25, 0.48, 11, 0.15), black, 0, 0, 3.79);

  const displayMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const display = add('Screen artwork', face(66.6, 142.8, 9.8), displayMaterial, 0, 0, 4.045);
  // Custom uninterrupted display: no Dynamic Island or front camera overlay.
  // Rear module sits at the upper-left when looking at the rear of the phone.
  add('Dual-camera glass platform', slab(32, 33.5, 1.9, 7, 0.38), glass, 15.6, 51, -4.85);

  function disk(name, r, d, mat, x, y, z) {
    const g = new THREE.CylinderGeometry(r, r, d, 64);
    g.rotateX(Math.PI / 2);
    return add(name, g, mat, x, y, z);
  }

  for (const [i, x, y] of [[1, 22.5, 59], [2, 8.5, 44]]) {
    disk('Camera ' + i + ' aluminum ring', 7.2, 2, frame, x, y, -6.45);
    disk('Camera ' + i + ' black bezel', 6.35, 2.1, black, x, y, -6.65);
    disk('Camera ' + i + ' optical glass', 5.5, 0.18, lens, x, y, -7.77);
    disk('Camera ' + i + ' iris', 3.2, 0.2, black, x, y, -7.88);
    disk('Camera ' + i + ' coating reflection', 1.8, 0.05, lens, x + 0.7, y + 0.65, -8.01);
  }
  disk('True Tone flash', 2.45, 0.3, new THREE.MeshStandardMaterial({ color: '#fff5d9', roughness: 0.35 }), 7.5, 60, -5.98);
  disk('Rear microphone', 0.65, 0.2, black, 22, 43, -5.98);

  // Center both sides vertically; the silent switch separates the volume buttons.
  add('Power button', slab(1.05, 17.2, 3.1, 0.5, 0.16), frame, 36.05, 0, 0);
  add('Volume up', slab(1.05, 12.5, 3, 0.5, 0.16), frame, -36.05, 14, 0);
  add('Volume down', slab(1.05, 12.5, 3, 0.5, 0.16), frame, -36.05, -14, 0);
  add('Ring / silent switch', slab(1.05, 6, 2.7, 0.5, 0.14), frame, -36.05, 0, 0);

  const port = add('USB-C opening', new THREE.ShapeGeometry(roundedShape(8.3, 2.6, 1.3)), black, 0, -73.82, 0);
  port.rotation.x = Math.PI / 2;
  add('USB-C tongue', new THREE.BoxGeometry(6, 0.16, 0.65), frame, 0, -73.86, 0);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const hole = add('Bottom speaker grille', new THREE.CircleGeometry(0.68, 16), black, side * (12.5 + i * 2.65), -73.83, 0);
      hole.rotation.x = Math.PI / 2;
    }
  }

  const antennaMat = new THREE.MeshStandardMaterial({ color: '#d2d8d3', roughness: 0.65 });
  for (const x of [-35.78, 35.78]) for (const y of [-57.5, 57.5]) add('Antenna band', new THREE.BoxGeometry(0.18, 1.1, 5.8), antennaMat, x, y, 0);
  add('Earpiece grille', face(10, 0.35, 0.17), black, 0, 72.1, 4.06);

  function setFinish(name) {
    if (!Object.prototype.hasOwnProperty.call(finishes, name)) return false;
    const f = finishes[name];
    frame.color.set(f.metal);
    glass.color.set(f.glass);
    root.userData.finish = name;
    return true;
  }

  function setScreen(texture) {
    displayMaterial.map?.dispose();
    displayMaterial.map = texture;
    displayMaterial.color.set(0xffffff);
    displayMaterial.needsUpdate = true;
  }

  function screenOn(on) {
    display.visible = Boolean(on);
  }

  setFinish(DEFAULT_FINISH);
  return { root, setFinish, setScreen, screenOn, display, finishes: FINISH_NAMES.slice() };
}
