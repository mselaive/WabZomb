/**
 * Hornea la luz de La Roca: para cada píxel del lightmap, la luz directa de cada
 * lámpara (con sombra), la luna, el cielo y dos rebotes. Salen dos imágenes: con
 * la luz apagada y prendida. No hay más datos: el cliente calcula el mismo
 * reparto con lightmapLayout.
 *
 *   cd tools && npx tsx bake.ts [--fast]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { LM_RANGE, lightmapLayout, lmFacePoint, type LmRect } from "../packages/shared/src/map/lightmap.js";
import { ROCA } from "../packages/shared/src/map/roca.js";
import { ROCA_TEX, type Box, type MapLight } from "../packages/shared/src/map/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "apps", "client", "public", "roca");
const fast = process.argv.includes("--fast");
const SIZE = 2048;
const RAYS = fast ? 8 : 24;
const BOUNCES = 2;

const map = ROCA;
const layout = lightmapLayout(map, SIZE);
console.log(`densidad ${layout.density.toFixed(2)} píxeles por metro`);

// --- Albedo de cada textura (el promedio del color), para los rebotes.
const albedo: Record<number, [number, number, number]> = {};
for (let i = 0; i < ROCA_TEX.length; i++) {
  const stats = await sharp(join(out, "tex", `${ROCA_TEX[i]!.name}_c.webp`)).stats();
  const lin = (c: number) => Math.pow(c / 255, 2.2);
  albedo[19 + i] = [lin(stats.channels[0]!.mean), lin(stats.channels[1]!.mean), lin(stats.channels[2]!.mean)];
}

// --- Lo que tapa la luz: todo lo sólido y lo que se dibuja con cuerpo (mesas, patas). Rejas y barandas, no.
const occluders: { b: Box; index: number }[] = [];
map.boxes.forEach((b, index) => {
  if (b.thin || b.clip) return;
  if (b.decal && b.maxY - b.minY < 0.03) return;
  occluders.push({ b, index });
});

// --- Un BVH sencillo: rayos contra cajas.
interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}
interface Node extends Bounds {
  left: Node | null;
  right: Node | null;
  items: number[] | null;
}
function buildBvh(items: number[]): Node {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const i of items) {
    const b = occluders[i]!.b;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    minZ = Math.min(minZ, b.minZ);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  if (items.length <= 4) return { minX, minY, minZ, maxX, maxY, maxZ, left: null, right: null, items };
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const key = dx >= dy && dx >= dz ? (b: Box) => b.minX + b.maxX : dy >= dz ? (b: Box) => b.minY + b.maxY : (b: Box) => b.minZ + b.maxZ;
  const sorted = [...items].sort((p, q) => key(occluders[p]!.b) - key(occluders[q]!.b));
  const mid = sorted.length >> 1;
  return { minX, minY, minZ, maxX, maxY, maxZ, left: buildBvh(sorted.slice(0, mid)), right: buildBvh(sorted.slice(mid)), items: null };
}
const bvh = buildBvh(occluders.map((_, i) => i));

function slab(ox: number, oy: number, oz: number, ix: number, iy: number, iz: number, n: Bounds, far: number): number {
  let t0 = 0;
  let t1 = far;
  let a = (n.minX - ox) * ix;
  let b = (n.maxX - ox) * ix;
  if (a > b) [a, b] = [b, a];
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  if (t0 > t1) return -1;
  a = (n.minY - oy) * iy;
  b = (n.maxY - oy) * iy;
  if (a > b) [a, b] = [b, a];
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  if (t0 > t1) return -1;
  a = (n.minZ - oz) * iz;
  b = (n.maxZ - oz) * iz;
  if (a > b) [a, b] = [b, a];
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  if (t0 > t1) return -1;
  return t0;
}

const stack: Node[] = [];
/** La distancia del último impacto de `trace`. */
let hitT = 0;
/** La caja más cercana que toca el rayo, o -1. Con `anyHit`, cualquiera sirve (para las sombras). */
function trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number, anyHit: boolean): number {
  const ix = 1 / (dx || 1e-9);
  const iy = 1 / (dy || 1e-9);
  const iz = 1 / (dz || 1e-9);
  let best = -1;
  let bestT = far;
  let sp = 0;
  stack[sp++] = bvh;
  while (sp > 0) {
    const n = stack[--sp]!;
    if (slab(ox, oy, oz, ix, iy, iz, n, bestT) < 0) continue;
    if (n.items) {
      for (const i of n.items) {
        const b = occluders[i]!.b;
        const t = slab(ox, oy, oz, ix, iy, iz, b, bestT);
        if (t < 0 || t >= bestT) continue;
        // Un cilindro: el rayo tiene que tocar el círculo también.
        if (b.shape === "cyl") {
          const r = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
          const fx = ox - (b.minX + b.maxX) / 2;
          const fz = oz - (b.minZ + b.maxZ) / 2;
          const A = dx * dx + dz * dz;
          const B = fx * dx + fz * dz;
          const C = fx * fx + fz * fz - r * r;
          if (A > 1e-9 && B * B - A * C < 0) continue;
        }
        bestT = t;
        best = i;
        if (anyHit) {
          hitT = t;
          return best;
        }
      }
    } else {
      stack[sp++] = n.left!;
      stack[sp++] = n.right!;
    }
  }
  hitT = bestT;
  return best;
}

// --- Las muestras: cada píxel de cada cara.
const area = SIZE * SIZE;
const posX = new Float32Array(area);
const posY = new Float32Array(area);
const posZ = new Float32Array(area);
const nor = new Int8Array(area * 3);
const used = new Uint8Array(area);
const p = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
const OFFSET = 0.025;
let samples = 0;
const rectOfOcc: (LmRect | null)[][] = occluders.map((o) => layout.faces[o.index]!);

layout.faces.forEach((faces, bi) => {
  const b = map.boxes[bi]!;
  faces.forEach((r, face) => {
    if (!r) return;
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        const u = r.w > 1 ? i / (r.w - 1) : 0.5;
        const v = r.h > 1 ? j / (r.h - 1) : 0.5;
        if (b.shape === "cyl") {
          const rad = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
          if (face === 0) {
            const a = u * Math.PI * 2;
            p.nx = Math.sin(a);
            p.ny = 0;
            p.nz = Math.cos(a);
            p.x = (b.minX + b.maxX) / 2 + p.nx * rad;
            p.y = b.minY + v * (b.maxY - b.minY);
            p.z = (b.minZ + b.maxZ) / 2 + p.nz * rad;
          } else {
            p.nx = 0;
            p.ny = 1;
            p.nz = 0;
            p.x = b.minX + u * (b.maxX - b.minX);
            p.y = b.maxY;
            p.z = b.minZ + v * (b.maxZ - b.minZ);
          }
        } else {
          lmFacePoint(b, face, u, v, p);
        }
        const k = (r.y + j) * SIZE + r.x + i;
        posX[k] = p.x + p.nx * OFFSET;
        posY[k] = p.y + p.ny * OFFSET;
        posZ[k] = p.z + p.nz * OFFSET;
        nor[k * 3] = Math.round(p.nx * 127);
        nor[k * 3 + 1] = Math.round(p.ny * 127);
        nor[k * 3 + 2] = Math.round(p.nz * 127);
        used[k] = 1;
        samples++;
      }
    }
  });
});
console.log(`${samples} píxeles, ${occluders.length} cajas que tapan`);

// --- Luz directa: dos juegos (apagada y prendida).
const rgb = (hex: number): [number, number, number] => {
  const l = (c: number) => Math.pow(c / 255, 2.2);
  return [l((hex >> 16) & 255), l((hex >> 8) & 255), l(hex & 255)];
};
const moonLen = Math.hypot(-0.42, 0.78, -0.46);
const MOON_DIR = [-0.42 / moonLen, 0.78 / moonLen, -0.46 / moonLen] as const;
const MOON = [0.46, 0.56, 0.82] as const;
const SKY_UP = [0.16, 0.2, 0.3] as const;
const SKY_HORIZON = [0.2, 0.23, 0.29] as const;
/** Lo mínimo para que nada sea totalmente negro: el rebote que no se calcula. */
const AMBIENT = [0.022, 0.026, 0.036] as const;

const lights = map.art!.lights.map((l: MapLight) => ({ l, c: rgb(l.color) }));
// Las luces por casillero de 8 m: para no mirarlas todas en cada píxel.
const GRID = 8;
const lightCells = new Map<string, number[]>();
lights.forEach(({ l }, i) => {
  const r = Math.ceil(l.range / GRID);
  const cx = Math.floor(l.x / GRID);
  const cy = Math.floor(l.y / GRID);
  const cz = Math.floor(l.z / GRID);
  for (let a = -r; a <= r; a++) {
    for (let b = -r; b <= r; b++) {
      for (let c = -r; c <= r; c++) {
        const key = `${cx + a},${cy + b},${cz + c}`;
        const list = lightCells.get(key);
        if (list) list.push(i);
        else lightCells.set(key, [i]);
      }
    }
  }
});

const directOff = new Float32Array(area * 3);
const directOn = new Float32Array(area * 3);
const t0 = Date.now();
for (let k = 0; k < area; k++) {
  if (!used[k]) continue;
  const x = posX[k]!;
  const y = posY[k]!;
  const z = posZ[k]!;
  const nx = nor[k * 3]! / 127;
  const ny = nor[k * 3 + 1]! / 127;
  const nz = nor[k * 3 + 2]! / 127;
  // La luna.
  const ml = nx * MOON_DIR[0] + ny * MOON_DIR[1] + nz * MOON_DIR[2];
  if (ml > 0 && trace(x, y, z, MOON_DIR[0], MOON_DIR[1], MOON_DIR[2], 200, true) < 0) {
    for (let c = 0; c < 3; c++) {
      directOff[k * 3 + c] = directOff[k * 3 + c]! + MOON[c]! * ml;
      directOn[k * 3 + c] = directOn[k * 3 + c]! + MOON[c]! * ml;
    }
  }
  const list = lightCells.get(`${Math.floor(x / GRID)},${Math.floor(y / GRID)},${Math.floor(z / GRID)}`);
  if (!list) continue;
  for (const i of list) {
    const { l, c } = lights[i]!;
    const dx = l.x - x;
    const dy = l.y - y;
    const dz = l.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > l.range * l.range) continue;
    const d = Math.sqrt(d2);
    const nl = (nx * dx + ny * dy + nz * dz) / d;
    if (nl <= 0) continue;
    if (trace(x, y, z, dx / d, dy / d, dz / d, d - 0.1, true) >= 0) continue;
    const fall = 1 - Math.pow(d / l.range, 4);
    const e = (l.power / (d2 + 1)) * nl * fall * fall;
    for (let ch = 0; ch < 3; ch++) {
      const v = e * c[ch]!;
      if (l.when !== "grid") directOff[k * 3 + ch] = directOff[k * 3 + ch]! + v;
      if (l.when !== "off") directOn[k * 3 + ch] = directOn[k * 3 + ch]! + v;
    }
  }
}
console.log(`directa: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// --- De una caja y un punto, el píxel que le corresponde: cuánta luz sale de donde pegó el rayo.
function luxelAt(oi: number, x: number, y: number, z: number): number {
  const b = occluders[oi]!.b;
  const faces = rectOfOcc[oi]!;
  const eps = 0.04;
  let face = -1;
  if (b.shape === "cyl") face = Math.abs(y - b.maxY) < eps && faces[2] ? 2 : 0;
  else if (Math.abs(x - b.maxX) < eps) face = 0;
  else if (Math.abs(x - b.minX) < eps) face = 1;
  else if (Math.abs(y - b.maxY) < eps) face = 2;
  else if (Math.abs(y - b.minY) < eps) face = 3;
  else if (Math.abs(z - b.maxZ) < eps) face = 4;
  else if (Math.abs(z - b.minZ) < eps) face = 5;
  const r = face >= 0 ? faces[face] : null;
  if (!r) return -1;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const d = b.maxZ - b.minZ;
  let u = 0;
  let v = 0;
  switch (face) {
    case 0:
      if (b.shape === "cyl") {
        u = (Math.atan2(x - (b.minX + b.maxX) / 2, z - (b.minZ + b.maxZ) / 2) / (Math.PI * 2) + 1) % 1;
        v = (y - b.minY) / h;
      } else {
        u = (b.maxZ - z) / d;
        v = (y - b.minY) / h;
      }
      break;
    case 1:
      u = (z - b.minZ) / d;
      v = (y - b.minY) / h;
      break;
    case 2:
      u = (x - b.minX) / w;
      v = b.shape === "cyl" ? (z - b.minZ) / d : 1 - (z - b.minZ) / d;
      break;
    case 3:
      u = (x - b.minX) / w;
      v = 1 - (b.maxZ - z) / d;
      break;
    case 4:
      u = (x - b.minX) / w;
      v = (y - b.minY) / h;
      break;
    default:
      u = (b.maxX - x) / w;
      v = (y - b.minY) / h;
      break;
  }
  const i = Math.max(0, Math.min(r.w - 1, Math.round(u * (r.w - 1))));
  const j = Math.max(0, Math.min(r.h - 1, Math.round(v * (r.h - 1))));
  return (r.y + j) * SIZE + r.x + i;
}

// --- Rebotes: de cada píxel salen rayos; lo que devuelven es cielo o la luz de lo que tocaron.
let seed = 1234567;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function gather(sourceOff: Float32Array, sourceOn: Float32Array, withSky: boolean): [Float32Array, Float32Array] {
  const resOff = new Float32Array(area * 3);
  const resOn = new Float32Array(area * 3);
  for (let k = 0; k < area; k++) {
    if (!used[k]) continue;
    const x = posX[k]!;
    const y = posY[k]!;
    const z = posZ[k]!;
    const nx = nor[k * 3]! / 127;
    const ny = nor[k * 3 + 1]! / 127;
    const nz = nor[k * 3 + 2]! / 127;
    // Una base alrededor de la normal.
    let tx = Math.abs(nx) > 0.9 ? 0 : 1;
    let ty = Math.abs(nx) > 0.9 ? 1 : 0;
    let tz = 0;
    const dot = tx * nx + ty * ny + tz * nz;
    tx -= nx * dot;
    ty -= ny * dot;
    tz -= nz * dot;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;
    let oR = 0;
    let oG = 0;
    let oB = 0;
    let pR = 0;
    let pG = 0;
    let pB = 0;
    for (let s = 0; s < RAYS; s++) {
      // Coseno: más rayos cerca de la normal.
      const r1 = (s + rnd()) / RAYS;
      const r2 = rnd() * Math.PI * 2;
      const rad = Math.sqrt(r1);
      const lx = rad * Math.cos(r2);
      const ly = rad * Math.sin(r2);
      const lz = Math.sqrt(Math.max(0, 1 - r1));
      const dx = tx * lx + bx * ly + nx * lz;
      const dy = ty * lx + by * ly + ny * lz;
      const dz = tz * lx + bz * ly + nz * lz;
      const hit = trace(x, y, z, dx, dy, dz, 70, false);
      if (hit < 0) {
        if (withSky) {
          const up = Math.max(0, dy);
          const r = SKY_HORIZON[0] + (SKY_UP[0] - SKY_HORIZON[0]) * up;
          const g = SKY_HORIZON[1] + (SKY_UP[1] - SKY_HORIZON[1]) * up;
          const b = SKY_HORIZON[2] + (SKY_UP[2] - SKY_HORIZON[2]) * up;
          oR += r;
          oG += g;
          oB += b;
          pR += r;
          pG += g;
          pB += b;
        }
        continue;
      }
      const t = hitT;
      const q = luxelAt(hit, x + dx * t, y + dy * t, z + dz * t);
      if (q < 0) continue;
      const a = albedo[occluders[hit]!.b.tex] ?? [0.3, 0.3, 0.3];
      oR += sourceOff[q * 3]! * a[0];
      oG += sourceOff[q * 3 + 1]! * a[1];
      oB += sourceOff[q * 3 + 2]! * a[2];
      pR += sourceOn[q * 3]! * a[0];
      pG += sourceOn[q * 3 + 1]! * a[1];
      pB += sourceOn[q * 3 + 2]! * a[2];
    }
    const f = 1 / RAYS;
    resOff[k * 3] = oR * f;
    resOff[k * 3 + 1] = oG * f;
    resOff[k * 3 + 2] = oB * f;
    resOn[k * 3] = pR * f;
    resOn[k * 3 + 1] = pG * f;
    resOn[k * 3 + 2] = pB * f;
  }
  return [resOff, resOn];
}

/** Suaviza el ruido de los rebotes, sin salirse de cada cara. */
function smooth(src: Float32Array, radius: number): Float32Array {
  const res = new Float32Array(area * 3);
  for (const faces of layout.faces) {
    for (const r of faces) {
      if (!r) continue;
      for (let j = 0; j < r.h; j++) {
        for (let i = 0; i < r.w; i++) {
          const j0 = Math.max(0, j - radius);
          const j1 = Math.min(r.h - 1, j + radius);
          const i0 = Math.max(0, i - radius);
          const i1 = Math.min(r.w - 1, i + radius);
          let a = 0;
          let b = 0;
          let c = 0;
          let n = 0;
          for (let y = j0; y <= j1; y++) {
            for (let x = i0; x <= i1; x++) {
              const k = (r.y + y) * SIZE + r.x + x;
              a += src[k * 3]!;
              b += src[k * 3 + 1]!;
              c += src[k * 3 + 2]!;
              n++;
            }
          }
          const k = (r.y + j) * SIZE + r.x + i;
          res[k * 3] = a / n;
          res[k * 3 + 1] = b / n;
          res[k * 3 + 2] = c / n;
        }
      }
    }
  }
  return res;
}

const totalOff = directOff.slice();
const totalOn = directOn.slice();
let srcOff: Float32Array = directOff;
let srcOn: Float32Array = directOn;
for (let bounce = 0; bounce < BOUNCES; bounce++) {
  const t1 = Date.now();
  const [gOff, gOn] = gather(srcOff, srcOn, bounce === 0);
  const sOff = smooth(gOff, 2);
  const sOn = smooth(gOn, 2);
  for (let i = 0; i < area * 3; i++) {
    totalOff[i] = totalOff[i]! + sOff[i]!;
    totalOn[i] = totalOn[i]! + sOn[i]!;
  }
  srcOff = sOff;
  srcOn = sOn;
  console.log(`rebote ${bounce + 1}: ${((Date.now() - t1) / 1000).toFixed(1)} s`);
}

// --- A imagen: curva sRGB, y cada cara se derrama un píxel para que el filtrado no muestre costuras.
function save(total: Float32Array, name: string): Promise<unknown> {
  const px = Buffer.alloc(area * 3);
  const enc = (v: number) => {
    const n = Math.max(0, Math.min(1, v / LM_RANGE));
    const s = n <= 0.0031308 ? 12.92 * n : 1.055 * Math.pow(n, 1 / 2.4) - 0.055;
    return Math.round(s * 255);
  };
  for (let k = 0; k < area; k++) {
    if (!used[k]) continue;
    px[k * 3] = enc(total[k * 3]! + AMBIENT[0]);
    px[k * 3 + 1] = enc(total[k * 3 + 1]! + AMBIENT[1]);
    px[k * 3 + 2] = enc(total[k * 3 + 2]! + AMBIENT[2]);
  }
  for (const faces of layout.faces) {
    for (const r of faces) {
      if (!r) continue;
      const copy = (fromX: number, fromY: number, toX: number, toY: number) => {
        const a = (fromY * SIZE + fromX) * 3;
        const b = (toY * SIZE + toX) * 3;
        px[b] = px[a]!;
        px[b + 1] = px[a + 1]!;
        px[b + 2] = px[a + 2]!;
      };
      for (let i = -1; i <= r.w; i++) {
        const sx = r.x + Math.max(0, Math.min(r.w - 1, i));
        copy(sx, r.y, r.x + i, r.y - 1);
        copy(sx, r.y + r.h - 1, r.x + i, r.y + r.h);
      }
      for (let j = 0; j < r.h; j++) {
        copy(r.x, r.y + j, r.x - 1, r.y + j);
        copy(r.x + r.w - 1, r.y + j, r.x + r.w, r.y + j);
      }
    }
  }
  return sharp(px, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: fast ? 80 : 92, effort: 5 }).toFile(join(out, `${name}.webp`));
}

await save(totalOff, "lightmap_off");
await save(totalOn, "lightmap_on");
console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
