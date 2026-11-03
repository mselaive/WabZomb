import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FRAG, KNIFE, M1911, RAYGUN, THUNDERGUN, weapon, weaponStats, type WeaponLook } from "@wabzomb/shared";

/**
 * Armas hechas de cajas y cilindros, armadas a partir de la descripción
 * (`look`) de cada una: largo del cuerpo y del caño, cargador, culata, mira.
 * El caño apunta a -Z (adelante en el espacio de la cámara), Y es arriba, X
 * es la derecha. Medidas en metros.
 */

interface Mat {
  color: number;
  metal?: number;
  rough?: number;
  emissive?: number;
}

const STEEL: Mat = { color: 0x3c424a, metal: 0.75, rough: 0.4 };
const STEEL_LIGHT: Mat = { color: 0x6c747e, metal: 0.8, rough: 0.35 };
const GLASS: Mat = { color: 0x7fb0ff, metal: 0.2, rough: 0.1 };
const SKIN: Mat = { color: 0xd9a877, metal: 0, rough: 0.9 };
const SLEEVE: Mat = { color: 0x4a4038, metal: 0, rough: 0.95 };
const GLOVE: Mat = { color: 0x2a2622, metal: 0, rough: 0.9 };
/** El Pack-a-Punch pinta el arma de un violeta oscuro con vetas que brillan. */
const PAP_BODY: Mat = { color: 0x2d1f4a, metal: 0.6, rough: 0.35, emissive: 0x120a26 };
const PAP_GLOW: Mat = { color: 0xb06cff, metal: 0.2, rough: 0.3, emissive: 0x7a3cff };

const mats = new Map<string, THREE.MeshStandardMaterial>();
let weaponEnv: THREE.Texture | null = null;

/** El reflejo propio de las armas: en un mapa oscuro, el metal sin nada que reflejar se ve negro. */
export function setWeaponEnvironment(env: THREE.Texture): void {
  weaponEnv = env;
  for (const m of mats.values()) {
    m.envMap = env;
    m.envMapIntensity = m.metalness > 0.3 ? 0.4 : 0.12;
    m.needsUpdate = true;
  }
}

/** Una textura pintada una sola vez: los gastes del metal, la veta de la madera. */
function painted(size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

let wearCache: THREE.Texture | null = null;
/** Gris medio con rayones claros y manchas: sirve de rugosidad y de relieve. */
function wearTexture(): THREE.Texture {
  wearCache ??= painted(256, (ctx, s) => {
    ctx.fillStyle = "#a8a8a8";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const v = Math.random() < 0.5 ? 60 : 225;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.1 + Math.random() * 0.35})`;
      ctx.lineWidth = 0.5 + Math.random() * 1.2;
      const x = Math.random() * s;
      const y = Math.random() * s;
      const a = Math.random() * 6.28;
      const l = 6 + Math.random() * 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 8 + Math.random() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  return wearCache;
}

let grainCache: THREE.Texture | null = null;
function grainTexture(): THREE.Texture {
  grainCache ??= painted(256, (ctx, s) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 150; i++) {
      ctx.strokeStyle = `rgba(40,22,10,${0.05 + Math.random() * 0.22})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.8;
      const x = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + (Math.random() - 0.5) * 18, s * 0.33, x + (Math.random() - 0.5) * 18, s * 0.66, x, s);
      ctx.stroke();
    }
  });
  grainCache.colorSpace = THREE.SRGBColorSpace;
  return grainCache;
}

function mat(m: Mat): THREE.MeshStandardMaterial {
  const key = `${m.color}-${m.metal ?? 0}-${m.rough ?? 0.5}-${m.emissive ?? 0}`;
  let out = mats.get(key);
  if (!out) {
    const metal = m.metal ?? 0;
    // Madera y plásticos: lo que no brilla y tiene color cálido lleva veta.
    const c = new THREE.Color(m.color);
    const warm = metal < 0.2 && c.r > c.b * 1.25;
    out = new THREE.MeshStandardMaterial({
      color: m.color,
      metalness: metal,
      roughness: Math.min(1, (m.rough ?? 0.5) * 1.25),
      emissive: m.emissive ?? 0,
      roughnessMap: wearTexture(),
      bumpMap: wearTexture(),
      bumpScale: 0.25,
      ...(warm ? { map: grainTexture() } : {}),
      ...(weaponEnv ? { envMap: weaponEnv, envMapIntensity: metal > 0.3 ? 0.4 : 0.12 } : {}),
    });
    mats.set(key, out);
  }
  return out;
}

const roundCache = new Map<string, THREE.BufferGeometry>();
/** Una caja con las aristas biseladas: es lo que le da un brillo creíble al metal. */
function bevelBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `${w}|${h}|${d}`;
  let g = roundCache.get(key);
  if (!g) {
    const small = Math.min(w, h, d);
    g = small < 0.006 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, Math.min(small * 0.22, 0.007));
    roundCache.set(key, g);
  }
  return g;
}

function box(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: Mat, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(bevelBox(w, h, d), mat(m));
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/** Un cilindro a lo largo de Z (el caño). */
function tube(g: THREE.Object3D, r: number, len: number, x: number, y: number, z: number, m: Mat, segments = 10): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, Math.max(14, segments)), mat(m));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/** Un cilindro a lo largo de X (bulones, manijas, el tambor). */
function pin(g: THREE.Object3D, r: number, len: number, x: number, y: number, z: number, m: Mat, segments = 8): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, Math.max(12, segments)), mat(m));
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function sights(g: THREE.Object3D, y: number, front: number, rear: number, m: Mat = STEEL): void {
  box(g, 0.006, 0.018, 0.008, 0, y, front, m);
  box(g, 0.022, 0.014, 0.01, 0, y - 0.003, rear, m);
}

function pistol(g: THREE.Group, look: WeaponLook, bodyMat: Mat, frameMat: Mat): void {
  const len = look.body;
  const tall = 0.036;
  const slide = box(g, 0.03, tall, len, 0, 0.03, -len / 2 + 0.03, bodyMat);
  slide.name = "slide";
  // Estrías de agarre atrás, ventana de eyección y boca.
  const dark: Mat = { color: 0x101114, metal: 0.5, rough: 0.6 };
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) box(slide, 0.001, tall * 0.5, 0.002, s * 0.0152, 0.002, len / 2 - 0.012 - i * 0.005, dark);
  box(slide, 0.002, 0.014, len * 0.26, 0.0155, 0.009, -len * 0.05, dark);
  box(slide, 0.02, 0.003, len * 0.92, 0, tall / 2 + 0.0005, 0, { color: 0x1c1e22, metal: 0.6, rough: 0.5 });
  box(g, 0.028, 0.025, len * 0.75, 0, 0.005, -len * 0.38 + 0.02, frameMat);
  box(g, 0.027, 0.11, 0.036, 0.0, -0.045, 0.012, { color: look.wood, rough: 0.7 }, 0.22);
  // Las cachas con su tornillo, el martillo y el seguro.
  for (const s of [-1, 1]) {
    box(g, 0.002, 0.08, 0.026, s * 0.0145, -0.044, 0.013, { color: darken(look.wood, 22), rough: 0.85 }, 0.22);
    pin(g, 0.004, 0.003, s * 0.0158, -0.04, 0.012, STEEL_LIGHT, 8);
  }
  box(g, 0.007, 0.018, 0.012, 0, 0.056, 0.038, STEEL, -0.45);
  box(g, 0.004, 0.006, 0.018, 0.016, 0.018, 0.012, STEEL);
  box(g, 0.004, 0.028, 0.04, 0, -0.02, -0.03, frameMat);
  box(g, 0.004, 0.018, 0.005, 0, -0.012, -0.025, STEEL);
  tube(g, 0.006, 0.03 + look.barrel, 0, 0.032, -len + 0.03 - look.barrel / 2, STEEL_LIGHT, 8);
  if (look.mag === "cylinder") {
    // El tambor del revólver.
    pin(g, 0.02, 0.034, 0, 0.022, -0.04, STEEL_LIGHT, 10);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      tube(g, 0.004, 0.036, Math.cos(a) * 0.013, 0.022 + Math.sin(a) * 0.013, -0.04, STEEL, 6);
    }
  } else {
    // El cargador dentro de la empuñadura: al recargar sale por abajo y se ve.
    const m = new THREE.Group();
    m.name = "mag";
    m.position.set(0, -0.045, 0.012);
    box(m, 0.022, 0.1, 0.03, 0, 0, 0, STEEL, 0.22);
    box(m, 0.03, 0.012, 0.038, 0, -0.056, 0.012, STEEL_LIGHT, 0.22);
    g.add(m);
  }
  sights(g, 0.03 + tall / 2, -len + 0.045, 0.02);
}

/** La Thunder Gun: un cuerpo gordo con cuatro caños, un tanque arriba y anillos que brillan celeste. */
function thunderGun(g: THREE.Group, look: WeaponLook, pap: boolean): void {
  const body: Mat = { color: pap ? 0x4a3a6e : look.color, metal: 0.75, rough: 0.35 };
  const dark: Mat = { color: look.wood, metal: 0.6, rough: 0.5 };
  const glow: Mat = { color: look.glow ?? 0x9ad0ff, emissive: pap ? 0xff9a2a : look.glow ?? 0x9ad0ff, metal: 0.1, rough: 0.3 };
  box(g, 0.07, 0.09, 0.3, 0, 0.03, -0.08, body);
  for (const [x, y] of [[-0.025, 0.055], [0.025, 0.055], [-0.025, 0.005], [0.025, 0.005]] as const) tube(g, 0.016, 0.32, x, y, -0.36, dark, 10);
  tube(g, 0.052, 0.04, 0, 0.03, -0.52, body, 14);
  tube(g, 0.045, 0.012, 0, 0.03, -0.54, glow, 14);
  // El tanque de arriba con sus abrazaderas, y los anillos.
  tube(g, 0.03, 0.2, 0, 0.1, -0.06, dark, 12);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.006, 8, 18), mat(glow));
    ring.position.set(0, 0.03, -0.18 - i * 0.08);
    g.add(ring);
  }
  // Empuñadura, gatillo y culata.
  box(g, 0.03, 0.1, 0.045, 0, -0.05, 0.06, dark, 0.3);
  box(g, 0.004, 0.024, 0.04, 0, -0.016, 0.0, STEEL);
  box(g, 0.05, 0.07, 0.16, 0, 0.02, 0.17, dark);
  box(g, 0.05, 0.09, 0.012, 0, 0.02, 0.25, { color: 0x15171a, metal: 0.5, rough: 0.6 });
}

/** Un fusil, subfusil, escopeta, ametralladora o francotirador, según `look`. */
function longGun(g: THREE.Group, look: WeaponLook, bodyMat: Mat, woodMat: Mat, magMat: Mat): void {
  const B = look.body;
  const bodyZ = -B / 2 + 0.05;
  // Cajón de mecanismos (cuerpo) y la tapa.
  box(g, 0.044, 0.065, B, 0, 0.03, bodyZ, bodyMat);
  box(g, 0.04, 0.016, B * 0.9, 0, 0.07, bodyZ, { ...bodyMat, color: lighten(bodyMat.color, 18) });
  // Ventana de eyección y manija de carga del lado derecho.
  box(g, 0.004, 0.02, Math.min(0.08, B * 0.3), 0.023, 0.04, bodyZ - B * 0.1, STEEL_LIGHT);
  pin(g, 0.006, 0.03, 0.028, 0.055, bodyZ + B * 0.25, STEEL);
  // Remaches, el riel de la tapa y la línea del cajón.
  const seam: Mat = { color: 0x101114, metal: 0.5, rough: 0.6 };
  for (const s of [-1, 1]) {
    box(g, 0.002, 0.003, B * 0.92, s * 0.0225, 0.012, bodyZ, seam);
    for (let i = 0; i < 3; i++) pin(g, 0.0035, 0.002, s * 0.023, 0.02, bodyZ - B * 0.3 + i * B * 0.3, STEEL_LIGHT, 8);
  }
  // Guardamanos y caño.
  const handZ = bodyZ - B / 2 - look.barrel * 0.28;
  const handLen = Math.max(0.1, look.barrel * 0.55);
  if (look.double) {
    tube(g, 0.011, look.barrel, -0.013, 0.05, bodyZ - B / 2 - look.barrel / 2, STEEL, 8);
    tube(g, 0.011, look.barrel, 0.013, 0.05, bodyZ - B / 2 - look.barrel / 2, STEEL, 8);
    box(g, 0.046, 0.05, look.barrel * 0.4, 0, 0.02, handZ, woodMat);
  } else {
    box(g, 0.046, 0.05, handLen, 0, 0.03, handZ, woodMat);
    // Ranuras de ventilación del guardamanos.
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) box(g, 0.002, 0.014, handLen * 0.12, s * 0.0235, 0.038, handZ - handLen * 0.33 + i * handLen * 0.22, seam);
    tube(g, 0.012, Math.max(0.05, look.barrel * 0.45), 0, 0.055, handZ - handLen / 2 - 0.02, STEEL, 8);
    tube(g, 0.009, look.barrel, 0, 0.05, bodyZ - B / 2 - look.barrel / 2, STEEL, 8);
    // Boca con el apagallamas.
    tube(g, 0.013, 0.05, 0, 0.05, bodyZ - B / 2 - look.barrel + 0.02, STEEL_LIGHT, 8);
  }
  // Cargador.
  const magZ = bodyZ - B * 0.12;
  switch (look.mag) {
    case "straight":
      box(g, 0.03, look.magLen, 0.055, 0, -0.03 - look.magLen / 2 + 0.01, magZ, magMat, 0.1).name = "mag";
      break;
    case "curved": {
      const m = new THREE.Group();
      m.name = "mag";
      m.position.set(0, -0.03, magZ);
      box(m, 0.03, look.magLen * 0.55, 0.06, 0, -look.magLen * 0.27, 0, magMat, 0.2);
      box(m, 0.03, look.magLen * 0.55, 0.06, 0, -look.magLen * 0.72, -look.magLen * 0.2, magMat, 0.6);
      g.add(m);
      break;
    }
    case "drum":
      pin(g, 0.07, 0.05, 0, -0.045, magZ, magMat, 14).name = "mag";
      break;
    case "box":
      box(g, 0.07, look.magLen * 0.6, 0.11, 0, -0.03 - look.magLen * 0.3, magZ, magMat).name = "mag";
      break;
    case "tube":
      // El tubo de cartuchos de la escopeta, bajo el caño, con la corredera de madera.
      tube(g, 0.013, look.magLen, 0, 0.02, bodyZ - B / 2 - look.magLen / 2 + 0.02, STEEL_LIGHT, 8);
      box(g, 0.046, 0.05, 0.13, 0, 0.03, handZ, woodMat).name = "pump";
      break;
    default:
      break;
  }
  // Empuñadura y gatillo.
  box(g, 0.03, 0.095, 0.042, 0, -0.045, 0.06, woodMat, 0.28);
  box(g, 0.004, 0.024, 0.04, 0, -0.016, -0.02, STEEL);
  // Culata.
  switch (look.stock) {
    case "wood":
      box(g, 0.038, 0.062, 0.28, 0, 0.012, 0.23, woodMat, 0.06);
      box(g, 0.04, 0.085, 0.03, 0, -0.005, 0.37, { ...woodMat, color: darken(woodMat.color, 20) }, 0.06);
      break;
    case "poly":
      tube(g, 0.016, 0.2, 0, 0.055, 0.17, bodyMat, 10);
      box(g, 0.038, 0.085, 0.1, 0, 0.02, 0.26, bodyMat);
      box(g, 0.04, 0.1, 0.012, 0, 0.02, 0.316, { color: 0x15171a, metal: 0.5, rough: 0.6 });
      break;
    case "skeleton":
      tube(g, 0.008, 0.26, 0.015, 0.06, 0.2, STEEL, 6);
      tube(g, 0.008, 0.26, -0.015, 0.06, 0.2, STEEL, 6);
      box(g, 0.04, 0.09, 0.016, 0, 0.02, 0.33, STEEL);
      tube(g, 0.008, 0.08, 0, 0.02, 0.29, STEEL, 6);
      break;
    default:
      break;
  }
  // Asa de transporte (M16, FAMAS, AUG, G11).
  if (look.handle) {
    box(g, 0.012, 0.02, B * 0.7, -0.012, 0.11, bodyZ, bodyMat);
    box(g, 0.012, 0.02, B * 0.7, 0.012, 0.11, bodyZ, bodyMat);
    box(g, 0.034, 0.008, B * 0.7, 0, 0.123, bodyZ, bodyMat);
  }
  // Mira telescópica o alzas.
  if (look.scope) {
    box(g, 0.012, 0.03, 0.03, 0, 0.09, bodyZ + 0.06, STEEL);
    box(g, 0.012, 0.03, 0.03, 0, 0.09, bodyZ - 0.1, STEEL);
    tube(g, 0.02, 0.26, 0, 0.12, bodyZ - 0.02, { color: 0x1f2226, metal: 0.4, rough: 0.5 }, 12);
    tube(g, 0.026, 0.06, 0, 0.12, bodyZ - 0.15, { color: 0x1f2226, metal: 0.4, rough: 0.5 }, 12);
    box(g, 0.04, 0.04, 0.004, 0, 0.12, bodyZ - 0.182, GLASS);
  } else {
    sights(g, 0.085, bodyZ - B / 2 - look.barrel + 0.06, bodyZ + B / 2 - 0.03);
  }
  // Bípode plegado bajo el caño.
  if (look.bipod) {
    box(g, 0.008, 0.008, 0.2, -0.014, 0.012, handZ - 0.02, STEEL, 0, 0, 0);
    box(g, 0.008, 0.008, 0.2, 0.014, 0.012, handZ - 0.02, STEEL, 0, 0, 0);
  }
}

/**
 * El trabuco giratorio: culata de madera, un cuerpo de bronce con manivela al
 * costado, y un haz de seis caños acampanados que da vuelta con cada tiro.
 */
function trabuco(g: THREE.Group, look: WeaponLook, pap: boolean): void {
  const brass: Mat = pap ? { color: 0x4a2e7a, metal: 0.8, rough: 0.3, emissive: 0x160a30 } : { color: look.color, metal: 0.85, rough: 0.38 };
  const iron: Mat = { color: pap ? 0x20142f : 0x2c2e31, metal: 0.75, rough: 0.45 };
  const wood: Mat = pap ? { color: 0x1c1430, metal: 0.3, rough: 0.6 } : { color: look.wood, metal: 0.05, rough: 0.72 };
  const glow: Mat = { color: 0xb06cff, emissive: 0x7a3cff, metal: 0.2, rough: 0.3 };
  // Culata y empuñadura.
  box(g, 0.04, 0.066, 0.26, 0, 0.0, 0.2, wood, 0.12);
  box(g, 0.042, 0.09, 0.03, 0, -0.024, 0.33, { ...wood, color: darken(wood.color, 18) }, 0.12);
  box(g, 0.032, 0.1, 0.044, 0, -0.05, 0.075, wood, 0.32);
  box(g, 0.004, 0.024, 0.04, 0, -0.016, 0.02, STEEL);
  // El cuerpo: dos tambores de bronce y el eje que los une.
  tube(g, 0.042, 0.13, 0, 0.022, -0.015, brass, 18);
  tube(g, 0.047, 0.016, 0, 0.022, 0.05, brass, 18);
  tube(g, 0.047, 0.016, 0, 0.022, -0.08, brass, 18);
  // La manivela, del lado izquierdo.
  pin(g, 0.008, 0.04, -0.06, 0.022, -0.015, iron, 8);
  box(g, 0.008, 0.06, 0.01, -0.08, 0.045, -0.015, iron);
  pin(g, 0.009, 0.03, -0.094, 0.07, -0.015, wood, 8);
  // El haz, en su propio grupo: es lo que gira.
  const spin = new THREE.Group();
  spin.name = "spin";
  spin.position.set(0, 0.022, -0.09);
  g.add(spin);
  const len = look.barrel;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 0.028;
    const y = Math.sin(a) * 0.028;
    tube(spin, 0.0105, len, x, y, -len / 2, iron, 12);
    // La boca acampanada: un cono abierto hacia adelante.
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0105, 0.05, 14, 1, true), mat(brass));
    bell.rotation.x = -Math.PI / 2;
    bell.position.set(x * 1.14, y * 1.14, -len - 0.02);
    bell.material = mat(brass);
    (bell.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    spin.add(bell);
  }
  // Los aros que atan el haz.
  for (const z of [-0.03, -len * 0.55, -len + 0.03]) tube(spin, 0.044, 0.012, 0, 0, z, pap ? glow : brass, 18);
  // La guía de puntería.
  box(g, 0.006, 0.02, 0.008, 0, 0.078, -0.03, iron);
}

/** La Ray Gun: cuerpo rechoncho, boca redonda y bobinas verdes que brillan. */
function rayGun(g: THREE.Group, look: WeaponLook, pap: boolean): void {
  const body: Mat = { color: pap ? 0x5a2c6e : look.color, metal: 0.7, rough: 0.3 };
  const glow: Mat = { color: look.glow ?? 0x2fbf6a, emissive: pap ? 0xff5a2a : look.glow ?? 0x2fbf6a, metal: 0.1, rough: 0.3 };
  box(g, 0.05, 0.07, 0.2, 0, 0.03, -0.06, body);
  tube(g, 0.04, 0.16, 0, 0.04, -0.22, body, 14);
  tube(g, 0.048, 0.02, 0, 0.04, -0.31, { color: 0x202020, metal: 0.6, rough: 0.4 }, 14);
  tube(g, 0.03, 0.015, 0, 0.04, -0.318, glow, 14);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.006, 8, 18), mat(glow));
    ring.position.set(0, 0.04, -0.17 - i * 0.045);
    g.add(ring);
  }
  // La "antena" de atrás y la empuñadura.
  tube(g, 0.012, 0.08, 0, 0.07, 0.06, body, 8);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), mat(glow));
  bulb.position.set(0, 0.07, 0.1);
  g.add(bulb);
  box(g, 0.03, 0.1, 0.045, 0, -0.045, 0.02, { color: 0x3a2a2a, rough: 0.8 }, 0.25);
  box(g, 0.004, 0.024, 0.04, 0, -0.016, -0.03, STEEL);
}

function lighten(c: number, d: number): number {
  const r = Math.min(255, (c >> 16) + d);
  const g = Math.min(255, ((c >> 8) & 255) + d);
  const b = Math.min(255, (c & 255) + d);
  return (r << 16) | (g << 8) | b;
}

function darken(c: number, d: number): number {
  return lighten(c, -d);
}

/**
 * Un arma hecha de cajas y cilindros. `firstPerson` agrega las manos y las
 * mangas. `pap` la pinta como mejorada.
 */
export function buildWeaponMesh(id: number, firstPerson: boolean, pap = false): THREE.Group {
  const g = new THREE.Group();
  g.name = `weapon-${id}`;
  const w = weapon(id >= 0 ? id : M1911);
  const look = w.look;
  const bodyMat: Mat = pap ? PAP_BODY : { color: look.color, metal: 0.65, rough: 0.45 };
  const woodMat: Mat = pap ? { color: 0x1c1430, metal: 0.3, rough: 0.6 } : { color: look.wood, metal: look.wood === look.color ? 0.4 : 0.05, rough: 0.75 };
  const magMat: Mat = pap ? PAP_GLOW : { color: look.magColor ?? darken(look.color, 10), metal: 0.6, rough: 0.5 };
  let rightHand: [number, number, number] = [0, -0.06, 0.0];
  let leftHand: [number, number, number] | null = null;

  if (id === FRAG) {
    const gm = buildGrenadeMesh();
    gm.position.set(0, 0.0, -0.05);
    g.add(gm);
    rightHand = [0, -0.04, 0.0];
  } else if (id === KNIFE || id < 0) {
    // Las manos vacías (el arma se la llevó el Pack-a-Punch): un cuchillo de combate.
    knife(g);
    rightHand = [0, 0, 0.04];
  } else if (id === THUNDERGUN) {
    thunderGun(g, look, pap);
    rightHand = [0, -0.07, 0.06];
    leftHand = [0, -0.02, -0.26];
  } else if (look.rotary) {
    trabuco(g, look, pap);
    rightHand = [0, -0.07, 0.075];
    leftHand = [0.0, -0.035, -0.2];
  } else if (w.cls === "wonder") {
    rayGun(g, look, pap);
    rightHand = [0, -0.07, 0.02];
    leftHand = [-0.02, -0.03, -0.14];
  } else if (w.cls === "pistol") {
    pistol(g, look, bodyMat, { color: pap ? 0x1c1430 : darken(look.color, 30), metal: 0.5, rough: 0.6 });
    rightHand = [0, -0.06, 0.01];
    leftHand = [-0.045, -0.07, 0.01];
  } else {
    longGun(g, look, bodyMat, woodMat, magMat);
    rightHand = [0, -0.07, 0.04];
    leftHand = [0, -0.005, -look.body / 2 + 0.05 - look.body / 2 - look.barrel * 0.28];
  }
  if (pap && id !== FRAG && id !== KNIFE && w.cls !== "wonder" && !look.rotary) {
    // Vetas que brillan a lo largo del cuerpo.
    for (let i = 0; i < 3; i++) box(g, 0.047, 0.004, look.body * 0.8, 0, 0.012 + i * 0.018, -look.body / 2 + 0.05, PAP_GLOW);
  }

  if (firstPerson) {
    const [hx, hy, hz] = rightHand;
    const rh = new THREE.Group();
    rh.name = "rhand";
    g.add(rh);
    box(rh, 0.065, 0.075, 0.07, hx + 0.012, hy, hz, GLOVE, 0.2);
    for (let i = 0; i < 4; i++) box(rh, 0.016, 0.014, 0.05, hx - 0.018, hy + 0.024 - i * 0.016, hz - 0.012, GLOVE, 0.2);
    box(rh, 0.07, 0.07, 0.06, hx + 0.03, hy - 0.04, hz + 0.1, SKIN, 0.3);
    box(rh, 0.075, 0.08, 0.28, hx + 0.03, hy - 0.08, hz + 0.2, SLEEVE, 0.35);
    if (leftHand) {
      const [lx, ly, lz] = leftHand;
      const lh = new THREE.Group();
      lh.name = "lhand";
      g.add(lh);
      box(lh, 0.07, 0.06, 0.08, lx - 0.01, ly - 0.03, lz, GLOVE, 0, 0, 0.2);
      for (let i = 0; i < 4; i++) box(lh, 0.014, 0.016, 0.05, lx + 0.028, ly - 0.012, lz - 0.03 + i * 0.016, GLOVE, 0, 0, 0.2);
      box(lh, 0.07, 0.07, 0.06, lx - 0.06, ly - 0.09, lz + 0.06, SKIN, 0.5, -0.3, 0);
      box(lh, 0.075, 0.08, 0.26, lx - 0.12, ly - 0.15, lz + 0.14, SLEEVE, 0.55, -0.35, 0);
    }
  }
  return g;
}

/** Un cuchillo de combate, mango en el puño y hoja hacia adelante. */
function knife(root: THREE.Group): void {
  const g = new THREE.Group();
  g.position.set(0, 0, 0.04);
  g.rotation.set(0.25, 0.55, 0.35);
  root.add(g);
  const k = new THREE.Group();
  k.position.set(0, 0, -0.04);
  g.add(k);
  box(k, 0.03, 0.036, 0.125, 0, 0, 0.04, { color: 0x2a2a2a, rough: 0.85 });
  box(k, 0.034, 0.04, 0.02, 0, 0, 0.11, STEEL);
  box(k, 0.014, 0.08, 0.012, 0, 0.004, -0.03, STEEL);
  box(k, 0.005, 0.03, 0.15, 0, 0.002, -0.111, { color: 0xd3dae2, metal: 0.95, rough: 0.2 });
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.06, 4), mat({ color: 0xd3dae2, metal: 0.95, rough: 0.2 }));
  tip.rotation.x = -Math.PI / 2;
  tip.scale.set(0.32, 1, 1);
  tip.position.set(0, 0.002, -0.216);
  k.add(tip);
}

/** Una granada: verde, redonda, con la espoleta. */
export function buildGrenadeMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat({ color: 0x4e5a3f, metal: 0.1, rough: 0.8 }));
  g.add(body);
  tube(g, 0.02, 0.03, 0, 0.08, 0, STEEL_LIGHT, 8);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 12), mat(STEEL_LIGHT));
  ring.position.set(0.02, 0.09, 0);
  g.add(ring);
  return g;
}

/** Dónde queda la punta del caño, en el espacio del arma (para el fogonazo y los trazadores). */
export function muzzleOffset(id: number): THREE.Vector3 {
  if (id < 0 || id === KNIFE || id === FRAG) return new THREE.Vector3(0, 0, -0.3);
  const w = weapon(id);
  const look = w.look;
  if (id === THUNDERGUN) return new THREE.Vector3(0, 0.03, -0.55);
  if (look.rotary) return new THREE.Vector3(0, 0.022, -0.09 - look.barrel - 0.05);
  if (w.cls === "wonder") return new THREE.Vector3(0, 0.04, -0.33);
  if (w.cls === "pistol") return new THREE.Vector3(0, 0.032, -look.body + 0.03 - look.barrel);
  return new THREE.Vector3(0, 0.05, -look.body / 2 + 0.05 - look.body / 2 - look.barrel);
}

function easeOut(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return 1 - (1 - k) * (1 - k);
}

function smooth(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

/**
 * El arma en la mano, en el espacio de la cámara, con sus animaciones: sale
 * de abajo al cambiar, se balancea al caminar, patea al disparar, el cargador
 * sale y entra al recargar, el culatazo del cuchillo, mirar el arma con F.
 */
export class ViewModel {
  readonly root = new THREE.Group();
  private current = -3;
  private currentPap = false;
  private mesh: THREE.Group | null = null;
  private mag: THREE.Object3D | null = null;
  private magHome = new THREE.Vector3();
  private slide: THREE.Object3D | null = null;
  private slideHome = new THREE.Vector3();
  private spin: THREE.Object3D | null = null;
  private pump: THREE.Object3D | null = null;
  private pumpHome = new THREE.Vector3();
  private lhand: THREE.Object3D | null = null;
  private lhandHome = new THREE.Vector3();
  private rhand: THREE.Object3D | null = null;
  private rhandHome = new THREE.Vector3();
  private readonly flash: THREE.Mesh;
  private flashLeft = 0;
  private kick = 0;
  private kickSide = 0;
  private slideT = 0;
  private cycleT = 0;
  private cycleTotal = 0.45;
  private bob = 0;
  private swayX = 0;
  private swayY = 0;
  private drawT = 0;
  private drawTotal = 0.3;
  private reloadT = 0;
  private reloadTotal = 1;
  private wasReloading = false;
  private meleeT = 0;
  private inspectT = 0;
  private readonly inspectTotal = 1.7;
  private landDip = 0;
  private hidden = false;
  private time = 0;
  /** Corriendo: el arma baja y se cruza; se mezcla de a poco. */
  private sprintK = 0;
  /** Tomando una bebida: la botella sube, se inclina y se va. */
  private bottle: THREE.Group | null = null;
  private drinkT = 0;
  private readonly drinkTotal = 2.4;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.position.set(0.19, -0.15, -0.32);
    this.root.rotation.set(0.05, 0.1, 0.03);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false });
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), flashMat);
    this.flash.visible = false;
    this.root.add(this.flash);
  }

  setWeapon(id: number, pap = false): void {
    if (id === this.current && pap === this.currentPap) return;
    if (this.mesh) this.root.remove(this.mesh);
    this.mesh = buildWeaponMesh(id, true, pap);
    if (id === THUNDERGUN) this.mesh.scale.setScalar(0.8);
    this.root.add(this.mesh);
    this.current = id;
    this.currentPap = pap;
    const find = (name: string, home: THREE.Vector3): THREE.Object3D | null => {
      const o = this.mesh!.getObjectByName(name) ?? null;
      if (o) home.copy(o.position);
      return o;
    };
    this.mag = find("mag", this.magHome);
    this.slide = find("slide", this.slideHome);
    this.spin = this.mesh?.getObjectByName("spin") ?? null;
    this.pump = find("pump", this.pumpHome);
    this.lhand = find("lhand", this.lhandHome);
    this.rhand = find("rhand", this.rhandHome);
    this.drawTotal = Math.max(0.15, (id >= 0 ? weapon(id).drawTicks : 4) * 0.05);
    this.drawT = this.drawTotal;
    this.reloadT = 0;
    this.meleeT = 0;
    this.inspectT = 0;
    this.cycleT = 0;
    this.flash.position.copy(muzzleOffset(id));
  }

  get weaponId(): number {
    return this.current;
  }

  setHidden(h: boolean): void {
    this.hidden = h;
    this.root.visible = !h;
  }

  inspect(): void {
    if (this.hidden || this.reloadT > 0 || this.drawT > 0 || this.inspectT > 0) return;
    this.inspectT = this.inspectTotal;
  }

  /** Un tiro salió: retroceso, fogonazo, corredera; la bomba de la escopeta después. */
  fire(): void {
    this.inspectT = 0;
    if (this.current < 0 || this.current === KNIFE || this.current === FRAG) {
      this.meleeT = 0.28;
      return;
    }
    const w = weapon(this.current);
    const stats = weaponStats(this.current, this.currentPap);
    this.kick = Math.min(1, this.kick + 0.45 + w.kick * 5);
    this.kickSide = (Math.random() - 0.5) * 0.03;
    this.flashLeft = 0.05;
    this.slideT = 1;
    if (this.pump) {
      this.cycleTotal = Math.min(0.9, Math.max(0.3, stats.fireTicks * 0.05 * 0.6));
      this.cycleT = this.cycleTotal;
    }
  }

  /** El culatazo del cuchillo (V): el arma se va para adelante y vuelve. */
  melee(): void {
    this.inspectT = 0;
    this.meleeT = 0.3;
  }

  /** Tirar una granada: el brazo que se va. */
  throwAnim(): void {
    this.meleeT = 0.32;
  }

  reload(totalSeconds: number): void {
    this.inspectT = 0;
    this.reloadTotal = Math.max(0.4, totalSeconds);
    this.reloadT = this.reloadTotal;
  }

  land(strength: number): void {
    this.landDip = Math.min(1, this.landDip + strength);
  }

  /** Tomar una bebida del color de la máquina: la botella tapa el arma un par de segundos. */
  drink(color: number): void {
    if (this.bottle) this.root.remove(this.bottle);
    const b = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.17, 12), mat({ color, metal: 0.1, rough: 0.25 }));
    glass.position.y = 0.085;
    b.add(glass);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.024, 0.06, 10), mat({ color, metal: 0.1, rough: 0.25 }));
    neck.position.y = 0.195;
    b.add(neck);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 10), mat(STEEL_LIGHT));
    cap.position.y = 0.235;
    b.add(cap);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 12), mat({ color: 0xf2eadc, rough: 0.8 }));
    label.position.y = 0.09;
    b.add(label);
    // La mano que la sostiene.
    box(b, 0.07, 0.07, 0.07, 0.03, 0.06, 0.0, GLOVE, 0.1);
    box(b, 0.075, 0.08, 0.24, 0.05, -0.08, 0.16, SLEEVE, 0.5);
    b.visible = false;
    this.root.add(b);
    this.bottle = b;
    this.drinkT = this.drinkTotal;
    this.inspectT = 0;
  }

  ejectPoint(camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    out.set(0.03, 0.04, -0.12).add(this.root.position);
    camera.updateMatrixWorld();
    return camera.localToWorld(out);
  }

  update(dt: number, speed: number, onGround: boolean, reloading: boolean, reloadSeconds: number, lookDx = 0, lookDy = 0, sprinting = false): void {
    if (this.hidden || !this.mesh) return;
    this.time += dt;

    this.sprintK += ((sprinting ? 1 : 0) - this.sprintK) * Math.min(1, dt * 9);
    this.bob += dt * (onGround ? Math.min(speed, 7) * 2.3 : 0.8);
    const amp = onGround ? Math.min(speed / 5, 1.3) * 0.014 : 0.004;
    const bx = Math.sin(this.bob) * amp;
    const by = -Math.abs(Math.cos(this.bob)) * amp * 0.8;
    const idleX = Math.sin(this.time * 1.3) * 0.0025;
    const idleY = Math.sin(this.time * 2.1) * 0.002;

    const k = 1 - Math.exp(-dt * 14);
    this.swayX += (-lookDx * 0.5 - this.swayX) * k;
    this.swayY += (-lookDy * 0.5 - this.swayY) * k;
    this.swayX = Math.max(-0.06, Math.min(0.06, this.swayX));
    this.swayY = Math.max(-0.06, Math.min(0.06, this.swayY));

    this.kick = Math.max(0, this.kick - dt * 8);
    this.slideT = Math.max(0, this.slideT - dt * 12);
    this.landDip = Math.max(0, this.landDip - dt * 5);
    const kk = this.kick;

    this.drawT = Math.max(0, this.drawT - dt);
    const drawK = 1 - easeOut(1 - this.drawT / this.drawTotal);

    if (reloading && !this.wasReloading && this.reloadT <= 0) this.reload(reloadSeconds);
    this.wasReloading = reloading;
    if (!reloading) this.reloadT = 0;
    else this.reloadT = Math.max(0, this.reloadT - dt);
    const rt = reloading ? 1 - this.reloadT / this.reloadTotal : 0;
    let tiltX = 0;
    let tiltZ = 0;
    let dropY = 0;
    let lhX = 0;
    let lhY = 0;
    let lhZ = 0;
    let rhY = 0;
    let rhZ = 0;
    let slideBack = 0;
    if (reloading) {
      const inOut = Math.sin(Math.PI * Math.min(1, rt));
      // El arma se ladea bien hacia el medio de la pantalla, para que se vea el cargador salir.
      tiltZ = 0.6 * inOut;
      tiltX = 0.28 * inOut;
      dropY = 0.03 * inOut;
      if (this.mag) {
        // Hasta dónde baja el cargador: lo justo para que se vea salir sin irse de cuadro.
        const drop = this.current >= 0 && weapon(this.current).cls === "pistol" ? 0.16 : 0.26;
        let magOff = 0;
        let visible = true;
        if (rt < 0.3) magOff = -drop * smooth((rt - 0.06) / 0.22);
        else if (rt < 0.55) visible = false;
        else if (rt < 0.85) magOff = -drop * (1 - smooth((rt - 0.55) / 0.3));
        this.mag.visible = visible;
        this.mag.position.set(this.magHome.x, this.magHome.y + magOff, this.magHome.z + (visible ? magOff * 0.3 : 0));
        lhY = visible ? magOff : -drop;
        lhZ = (visible ? magOff * 0.3 : -0.09) + 0.04 * inOut;
        lhX = -0.03 * inOut;
      } else {
        lhY = -0.07 * Math.abs(Math.sin(rt * Math.PI * 4)) - 0.03 * inOut;
        lhZ = 0.1 * inOut;
      }
      // El golpe final: la palmada al cargador y, en las pistolas, la corredera que vuelve.
      if (rt > 0.85) {
        const k = Math.sin((Math.PI * (rt - 0.85)) / 0.15);
        tiltX += -0.16 * k;
        if (this.slide) slideBack = rt < 0.93 ? 1 : 0;
      }
    } else if (this.mag) {
      this.mag.visible = true;
      this.mag.position.copy(this.magHome);
    }

    if (this.slide) this.slide.position.set(this.slideHome.x, this.slideHome.y, this.slideHome.z + 0.035 * Math.max(this.slideT, slideBack));
    // El haz de caños da un sexto de vuelta por tiro (el tiempo que dura el ciclo del arma).
    if (this.spin && this.cycleT > 0) this.spin.rotation.z += (dt / Math.max(0.05, this.cycleTotal)) * (Math.PI / 3);
    let cycleTilt = 0;
    if (this.cycleT > 0) {
      this.cycleT = Math.max(0, this.cycleT - dt);
      const c = 1 - this.cycleT / this.cycleTotal;
      const back = Math.sin(Math.PI * Math.min(1, Math.max(0, (c - 0.15) / 0.7)));
      if (this.pump) {
        this.pump.position.set(this.pumpHome.x, this.pumpHome.y, this.pumpHome.z + 0.09 * back);
        lhZ += 0.09 * back;
        cycleTilt = 0.03 * back;
      }
    } else if (this.pump) this.pump.position.copy(this.pumpHome);

    if (this.lhand) this.lhand.position.set(this.lhandHome.x + lhX, this.lhandHome.y + lhY, this.lhandHome.z + lhZ);
    if (this.rhand) this.rhand.position.set(this.rhandHome.x, this.rhandHome.y + rhY, this.rhandHome.z + rhZ);

    // El culatazo / tajo / brazo de la granada.
    let mX = 0;
    let mZ = 0;
    let mRot = 0;
    if (this.meleeT > 0) {
      this.meleeT = Math.max(0, this.meleeT - dt);
      const t = 1 - this.meleeT / 0.3;
      const s = Math.sin(Math.PI * t);
      mRot = -0.7 * s;
      mZ = -0.14 * s;
      mX = -0.05 * s;
    }

    let insX = 0;
    let insY = 0;
    let insZ = 0;
    let insRX = 0;
    let insRY = 0;
    let insRZ = 0;
    if (this.inspectT > 0) {
      this.inspectT = Math.max(0, this.inspectT - dt);
      const t = 1 - this.inspectT / this.inspectTotal;
      const s = Math.sin(Math.PI * t);
      insRY = -1.05 * s;
      insRX = 0.3 * s;
      insRZ = 0.3 * s;
      insX = -0.11 * s;
      insY = 0.04 * s;
      insZ = -0.07 * s;
    }

    // La bebida: el arma baja del todo y la botella sube, se inclina y se va.
    let drinkDown = 0;
    if (this.drinkT > 0) {
      this.drinkT = Math.max(0, this.drinkT - dt);
      const t = 1 - this.drinkT / this.drinkTotal;
      drinkDown = smooth(Math.min(1, t / 0.2)) * (1 - smooth(Math.max(0, (t - 0.8) / 0.2)));
      if (this.bottle) {
        this.bottle.visible = drinkDown > 0.05;
        const up = drinkDown;
        const tilt = Math.sin(Math.PI * Math.max(0, Math.min(1, (t - 0.25) / 0.5)));
        // Sube delante de la cara y se empina: la boca hacia la cámara (+Z), el fondo arriba.
        this.bottle.position.set(-0.12 - 0.07 * tilt, -0.42 + 0.3 * up + 0.29 * tilt, -0.08 + 0.1 * tilt);
        this.bottle.rotation.set(1.85 * tilt, 0, 0.12 * (1 - tilt));
      }
    } else if (this.bottle) {
      this.root.remove(this.bottle);
      this.bottle = null;
    }
    const sp = this.sprintK;

    this.mesh.position.set(
      bx + idleX + this.swayX + this.kickSide * kk + mX + insX - sp * 0.03,
      by + idleY + this.swayY * 0.6 - drawK * 0.35 - this.landDip * 0.05 + dropY + insY - sp * 0.1 - drinkDown * 0.4,
      kk * 0.05 + mZ + insZ + sp * 0.04,
    );
    this.mesh.rotation.set(
      -kk * 0.14 + drawK * 1.1 + tiltX + mRot + cycleTilt + this.landDip * 0.08 + insRX + sp * 0.32 + drinkDown * 0.9,
      this.swayX * 0.8 + drawK * 0.25 + insRY - sp * 0.7,
      this.kickSide * kk * 2 + tiltZ + insRZ + sp * 0.12,
    );

    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      this.flash.visible = true;
      const ray = this.current === RAYGUN;
      (this.flash.material as THREE.MeshBasicMaterial).color.set(ray ? 0x6fff9a : 0xffd27a);
      this.flash.scale.setScalar(0.8 + Math.random() * 0.6);
      this.flash.position.copy(muzzleOffset(this.current)).add(this.mesh.position);
    } else {
      this.flash.visible = false;
    }
  }
}
