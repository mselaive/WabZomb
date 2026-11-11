import {
  TEX_R_ASPHALT,
  TEX_R_BRICK,
  TEX_R_CORRUGATED,
  TEX_R_FLOOR,
  TEX_R_FLOORBAD,
  TEX_R_FLOORDARK,
  TEX_R_PLANKS,
  TEX_R_PLASTER,
  TEX_R_RAW,
  TEX_R_ROCK,
  TEX_R_RUST,
  TEX_R_STEEL,
  TEX_R_STEELGREEN,
  TEX_R_STONE,
  TEX_R_TILEFLOOR,
  TEX_R_TILEWALL,
  TEX_R_TREAD,
  TEX_R_WALL,
  TEX_R_WALLGREEN,
  TEX_R_WOODFLOOR,
  TEX_R_YARD,
  type Barrier,
  type Box,
  type CellRow,
  type Door,
  type GameMap,
  type MapLight,
  type MapProp,
  type MapRail,
  type MapRamp,
  type PerkMachine,
  type Place,
  type Spawn,
  type Spawner,
  type WallWeapon,
  type Zone,
} from "./types.js";
import { AK74U, FRAG, GARAND, M14, M16, MP40, MP5K, OLYMPIA, PM63, PYTHON, STAKEOUT, THOMPSON, WINCHESTER } from "../weapons.js";
import { PERK_DOUBLETAP, PERK_JUGG, PERK_MULE, PERK_QUICK, PERK_SPEED, PERK_STAMIN } from "../constants.js";

/**
 * "La Roca": una penitenciaría en una isla, de noche y con niebla. La planta
 * sale de los planos públicos de la penitenciaría federal de Alcatraz (Servicio
 * de Parques de EE. UU.): cuatro bloques de celdas de tres pisos, Broadway por
 * el medio, Times Square con su reloj delante del comedor, el hospital arriba
 * del comedor y la ciudadela de piedra abajo de todo. Es un mapa propio: la
 * distribución de zonas, las puertas y el recorrido están pensados para este juego.
 *
 *                                  norte (-Z)
 *               +---------+-------------------------------+--------+----------+
 *               |         |  Bloque A                     |        |          |
 *   +--------+  |         |  Michigan Avenue              |        | Oficina  |
 *   |        |  | Comedor |  Bloque B                     |        | Visitas  |--+
 *   | Cocina |--| (arriba,|  BROADWAY (se arranca acá)    | Control| Armería  |  | camino
 *   |        |  | hospital)  Bloque C                     |        |          |  | al muelle
 *   +--------+  |  T.Sq.  |  Calle D  (abajo, la ciudadela)        |          |  |
 *        +------+---+-----+  Bloque D        Biblioteca   +--------+----------+  |
 *        | Patio de |                                                            |
 *        | recreo   |--- camino --+---------- muelle ----------------------------+
 *        +----------+                      |  (Pack-a-Punch al final)
 *
 * Tres alturas caminables: la planta baja, la galería del segundo piso (con el
 * hospital arriba del comedor) y las azoteas. Toda subida es por escaleras: los
 * zombis no saltan, así que nada que necesite un salto se puede pisar.
 */

/** Dónde están los mostradores de la sala de visitas (en X; van de -0,2 a 0,2 en Z). */
const VISIT_BOOTHS = [33, 36, 44, 47];

const TIER = 2.8;
const PITCH = 1.92;
const DEPTH = 2.6;
const CELLS = 25;
const BX0 = -24;
const BX1 = BX0 + PITCH * CELLS;
const HALL_H = 11;
const ROOF_Y = 11.4;
const HOSP_Y = 5.6;
const TERRACE_Y = 9.3;
const DOCK_Y = -8;
const CITADEL_Y = -4;
const MASS_Y = -14;
/** Luces de los pasillos. */
const WARM = 0xffe6c8;
const COLD = 0xbfd8ff;
const RED = 0xff3a22;

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tex: number): Box => ({
  minX: Math.min(minX, maxX),
  minY: Math.min(minY, maxY),
  minZ: Math.min(minZ, maxZ),
  maxX: Math.max(minX, maxX),
  maxY: Math.max(minY, maxY),
  maxZ: Math.max(minZ, maxZ),
  tex,
});

interface Gap {
  from: number;
  to: number;
  bottom: number;
  top: number;
}

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Un rectángulo menos unos huecos: partido en pedazos, para el suelo de la isla. */
function cut(base: Rect, holes: readonly Rect[]): Rect[] {
  const xs = [...new Set([base.x0, base.x1, ...holes.flatMap((h) => [h.x0, h.x1])])].filter((v) => v >= base.x0 && v <= base.x1).sort((a, b) => a - b);
  const zs = [...new Set([base.z0, base.z1, ...holes.flatMap((h) => [h.z0, h.z1])])].filter((v) => v >= base.z0 && v <= base.z1).sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    let open: Rect | null = null;
    for (let j = 0; j + 1 < zs.length; j++) {
      const mx = (xs[i]! + xs[i + 1]!) / 2;
      const mz = (zs[j]! + zs[j + 1]!) / 2;
      const hole = holes.some((h) => mx > h.x0 && mx < h.x1 && mz > h.z0 && mz < h.z1);
      if (hole) {
        if (open) out.push(open);
        open = null;
      } else if (open) open.z1 = zs[j + 1]!;
      else open = { x0: xs[i]!, z0: zs[j]!, x1: xs[i + 1]!, z1: zs[j + 1]! };
    }
    if (open) out.push(open);
  }
  return out;
}

function build(): GameMap {
  const boxes: Box[] = [];
  const barriers: Barrier[] = [];
  const spawners: Spawner[] = [];
  const doors: Door[] = [];
  const lights: MapLight[] = [];
  const props: MapProp[] = [];
  const rails: MapRail[] = [];
  const ramps: MapRamp[] = [];
  const cells: CellRow[] = [];
  const windows: Box[] = [];

  const add = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tex: number): Box => {
    const b = box(minX, minY, minZ, maxX, maxY, maxZ, tex);
    boxes.push(b);
    return b;
  };
  /** Choca y frena balas, pero no se dibuja (lo dibuja el cliente: las celdas). */
  const solid = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => boxes.push({ ...box(minX, minY, minZ, maxX, maxY, maxZ, TEX_R_WALL), hidden: true });
  /** Choca pero deja pasar las balas (rejas y barandas). */
  const fence = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => boxes.push({ ...box(minX, minY, minZ, maxX, maxY, maxZ, TEX_R_STEEL), hidden: true, thin: true });
  /** Pared invisible que frena jugadores y zombis: nada más. */
  const clip = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => boxes.push({ ...box(minX, minY, minZ, maxX, maxY, maxZ, TEX_R_STEEL), hidden: true, thin: true, clip: true });
  /** Sólo se ve. */
  const decal = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tex: number) => boxes.push({ ...box(minX, minY, minZ, maxX, maxY, maxZ, tex), decal: true });
  /** Un mueble: lo que no se sube caminando lleva una pared invisible arriba. */
  const furn = (minX: number, minZ: number, maxX: number, maxZ: number, y0: number, y1: number, tex: number) => {
    add(minX, y0, minZ, maxX, y1, maxZ, tex);
    clip(minX, y1, minZ, maxX, y1 + 3, maxZ);
  };
  const floorDecal = (x0: number, z0: number, x1: number, z1: number, y: number, tex: number) => decal(x0, y, z0, x1, y + 0.012, z1, tex);

  /** Una pared con huecos: de `from` a `to` a lo largo de un eje, en `at`. */
  const wall = (axis: "x" | "z", at: number, from: number, to: number, y0: number, y1: number, tex: number, gaps: Gap[] = [], thick = 0.6) => {
    const seg = (a: number, b: number, lo: number, hi: number) => {
      if (b - a < 0.001 || hi - lo < 0.001) return;
      if (axis === "x") add(a, lo, at, b, hi, at + thick, tex);
      else add(at, lo, a, at + thick, hi, b, tex);
    };
    let cursor = from;
    for (const g of [...gaps].sort((a, b) => a.from - b.from)) {
      seg(cursor, g.from, y0, y1);
      seg(g.from, g.to, y0, g.bottom);
      seg(g.from, g.to, g.top, y1);
      cursor = g.to;
    }
    seg(cursor, to, y0, y1);
  };

  const door = (id: number, name: string, price: number, b: Box, zones: [number, number], style: Door["style"], locked = false) => {
    doors.push({ id, name, price, box: b, zones, style, ...(locked ? { locked } : {}) });
  };

  /** Una escalera recta de `a` a `b`. Los escalones son chapas; con `fill`, macizos hasta el piso. */
  const stairs = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, tex: number, fill = false, base = y0) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? x1 - x0 : z1 - z0;
    const rise = y1 - y0;
    const n = Math.ceil(Math.abs(rise) / 0.19);
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const top = y0 + rise * t1;
      const bottom = fill ? base : top - 0.1;
      if (alongX) add(x0 + len * t0, bottom, z0 - width / 2, x0 + len * t1, top, z0 + width / 2, tex);
      else add(x0 - width / 2, bottom, z0 + len * t0, x0 + width / 2, top, z0 + len * t1, tex);
    }
  };

  /** Macizo e invisible debajo de una escalera de chapas que sube hacia +X, hasta la altura `upTo`. */
  const underStairs = (x0: number, y0: number, z: number, x1: number, y1: number, width: number, upTo: number) => {
    const n = Math.ceil(Math.abs(y1 - y0) / 0.19);
    for (let i = 0; i < n; i++) {
      const top = y0 + ((y1 - y0) * (i + 1)) / n - 0.1;
      if (top > upTo || top <= y0) continue;
      solid(x0 + ((x1 - x0) * i) / n, y0, z - width / 2, x0 + ((x1 - x0) * (i + 1)) / n, top, z + width / 2);
    }
  };

  /** Una baranda que se ve, y que no se puede saltar. */
  const rail = (x0: number, z0: number, x1: number, z1: number, y: number, h = 2.4) => {
    rails.push({ x0, z0, x1, z1, y });
    const pad = 0.04;
    fence(Math.min(x0, x1) - pad, y, Math.min(z0, z1) - pad, Math.max(x0, x1) + pad, y + h, Math.max(z0, z1) + pad);
  };

  /** Una rampa: por colisión son escalones bajos; lo que se ve es un plano inclinado. */
  const ramp = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, tex: number) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.ceil(Math.abs(y1 - y0) / 0.24);
    for (let i = 0; i < n; i++) {
      const a = i / n;
      const b = (i + 1) / n;
      const top = y0 + (y1 - y0) * (a + (y1 > y0 ? b - a : 0));
      if (alongX) solid(x0 + len * a, MASS_Y, z0 - width / 2, x0 + len * b, top, z0 + width / 2);
      else solid(x0 - width / 2, MASS_Y, z0 + len * a, x0 + width / 2, top, z0 + len * b);
    }
    ramps.push({ x0, y0, z0, x1, y1, z1, width, tex });
  };

  const prop = (model: string, x: number, y: number, z: number, yaw = 0, scale = 1) => props.push({ model, x, y, z, yaw, scale });
  const light = (x: number, y: number, z: number, power: number, range: number, when: MapLight["when"] = "grid", color = WARM, fixture?: string, yaw?: number) =>
    lights.push({ x, y, z, power, range, when, color, fixture, yaw });

  // ---- Zonas.
  const zones: Zone[] = [
    { id: 0, name: "Broadway", minX: BX0, minZ: -3, maxX: BX1, maxZ: 3, maxY: 2 },
    { id: 1, name: "Times Square", minX: -31, minZ: -19, maxX: BX0, maxZ: 19, maxY: 2 },
    { id: 2, name: "Control", minX: BX1, minZ: -19, maxX: 30, maxZ: 19, maxY: 2 },
    { id: 3, name: "Galería", minX: -31, minZ: -3, maxX: BX1, maxZ: 3, minY: 2, maxY: 8, more: [{ minX: -31, minZ: -9.3, maxX: -29.4, maxZ: -3 }] },
    { id: 4, name: "Comedor", minX: -60, minZ: -13, maxX: -31, maxZ: 13, maxY: 5 },
    { id: 5, name: "Michigan Avenue", minX: BX0, minZ: -15.4, maxX: BX1, maxZ: -9.4, maxY: 2 },
    { id: 6, name: "Calle D", minX: BX0, minZ: 9.4, maxX: BX1, maxZ: 19, minY: -0.3, maxY: 2 },
    { id: 7, name: "Administración", minX: 30.6, minZ: -16, maxX: 50, maxZ: 16, maxY: 5 },
    { id: 8, name: "Cocina", minX: -74, minZ: -13, maxX: -60, maxZ: 13, maxY: 5 },
    { id: 9, name: "Patio de recreo", minX: -66, minZ: 13.6, maxX: -31.6, maxZ: 44, maxY: 8, outdoor: true },
    { id: 10, name: "Hospital", minX: -60, minZ: -13, maxX: -31, maxZ: 13, minY: 5, maxY: 8.9 },
    { id: 11, name: "Azotea", minX: -60.6, minZ: -19.6, maxX: 30.6, maxZ: 19.6, minY: 8.9, outdoor: true },
    { id: 12, name: "El muelle", minX: -31, minZ: 20, maxX: 62, maxZ: 95, maxY: 3, outdoor: true, more: [{ minX: 50.6, minZ: -8, maxX: 62, maxZ: 20 }] },
    { id: 13, name: "La ciudadela", minX: -6, minZ: 6, maxX: 24, maxZ: 19, maxY: -0.3 },
  ];

  // ---- La isla: una masa de roca con los huecos de los caminos y de la ciudadela.
  const road1: Rect = { x0: -31, z0: 28, x1: -1, z1: 35 };
  const landing: Rect = { x0: -1, z0: 28, x1: 6, z1: 46 };
  const road2: Rect = { x0: 53, z0: 8, x1: 60, z1: 46 };
  const stairHole: Rect = { x0: 15.5, z0: 9.9, x1: 20.2, z1: 11.5 };
  const citadel: Rect = { x0: -6.6, z0: 5.4, x1: 24.6, z1: 19.6 };
  const island: Rect = { x0: -95, z0: -45, x1: 75, z1: 46 };
  const westShore: Rect = { x0: -95, z0: 46, x1: -31, z1: 58 };
  for (const r of [westShore]) {
    boxes.push({ ...box(r.x0, MASS_Y, r.z0, r.x1, 0, r.z1, TEX_R_ROCK), lm: 0.2 });
  }
  for (const r of cut(island, [road1, landing, road2, stairHole])) boxes.push({ ...box(r.x0, -0.6, r.z0, r.x1, 0, r.z1, TEX_R_ROCK), lm: 0.2 });
  for (const r of cut(island, [road1, landing, road2, citadel])) boxes.push({ ...box(r.x0, MASS_Y, r.z0, r.x1, -0.6, r.z1, TEX_R_ROCK), lm: 0.2 });
  // El muelle: la losa, el espigón de madera y la bajada.
  boxes.push({ ...box(-1, MASS_Y, 46, 60, DOCK_Y, 72, TEX_R_RAW), lm: 0.6 });
  add(-1, MASS_Y, 28, 6, DOCK_Y, 46, TEX_R_RAW);
  add(18, DOCK_Y - 0.5, 72, 32, DOCK_Y, 92, TEX_R_PLANKS);
  for (let z = 74; z <= 92; z += 4) for (const x of [18.4, 25, 31.6]) add(x - 0.22, MASS_Y, z - 0.22, x + 0.22, DOCK_Y - 0.5, z + 0.22, TEX_R_PLANKS);

  // ---- Los pisos que se ven, cada sala con el suyo.
  for (const r of cut({ x0: BX0 - 7, z0: -19, x1: 30, z1: 19 }, [stairHole])) floorDecal(r.x0, r.z0, r.x1, r.z1, 0, TEX_R_FLOOR);
  floorDecal(-31, -19, BX0 - 0.4, 19, 0.002, TEX_R_FLOORDARK);
  floorDecal(BX1 + 0.4, -19, 30, 19, 0.002, TEX_R_FLOORDARK);
  floorDecal(-60, -13, -31, 13, 0, TEX_R_FLOORDARK);
  floorDecal(-74, -13, -60.6, 13, 0, TEX_R_TILEFLOOR);
  floorDecal(30.6, -16, 50, 16, 0, TEX_R_WOODFLOOR);
  floorDecal(-66, 13.6, -31.6, 44, 0, TEX_R_YARD);
  floorDecal(50.6, -8, 60, 8, 0, TEX_R_ASPHALT);
  floorDecal(-60, -13, -31, 13, HOSP_Y, TEX_R_TILEFLOOR);
  floorDecal(-1, 46, 60, 72, DOCK_Y, TEX_R_ASPHALT);
  floorDecal(-1, 28, 6, 46, DOCK_Y, TEX_R_ASPHALT);
  floorDecal(-6, 6, 24, 19, CITADEL_Y, TEX_R_FLOORBAD);
  add(-6.6, CITADEL_Y - 0.5, 5.4, 24.6, CITADEL_Y, 19.6, TEX_R_STONE);

  // ---- La casa de celdas. Paredes: afuera hormigón crudo, adentro pintura.
  const cellhouse = (at: number, axis: "x" | "z", from: number, to: number, gaps: Gap[], outsideLow: boolean) => {
    const skin = 0.12;
    if (outsideLow) {
      wall(axis, at, from, to, 0, ROOF_Y, TEX_R_RAW, gaps, 0.48);
      wall(axis, at + 0.48, from, to, 0, HALL_H, TEX_R_WALL, gaps, skin);
    } else {
      wall(axis, at, from, to, 0, HALL_H, TEX_R_WALL, gaps, skin);
      wall(axis, at + skin, from, to, 0, ROOF_Y, TEX_R_RAW, gaps, 0.48);
    }
  };

  /** Ventana con tablas en una pared a lo largo de X (z fijo). */
  const winX = (zone: number, at: number, cx: number, outsideDir: 1 | -1, w = 1.8): Gap => {
    const from = cx - w / 2;
    const to = cx + w / 2;
    const bx = box(from, 0.8, at, to, 2.5, at + 0.6, TEX_R_STEEL);
    const id = barriers.length;
    boxes.push({ ...bx, hidden: true, thin: true });
    barriers.push({ id, zone, box: bx, outside: { x: cx, z: at + 0.3 + outsideDir * 1.1 }, inside: { x: cx, z: at + 0.3 - outsideDir * 1.5 }, yaw: outsideDir > 0 ? Math.PI : 0, kind: "window" });
    for (let i = 0; i < 2; i++) spawners.push({ zone, x: cx + (i === 0 ? -2.2 : 2.2), y: 0, z: at + 0.3 + outsideDir * (5 + i * 1.5), barrier: id });
    return { from, to, bottom: 0.8, top: 2.5 };
  };
  const winZ = (zone: number, at: number, cz: number, outsideDir: 1 | -1, w = 1.8, spread = 2.2): Gap => {
    const from = cz - w / 2;
    const to = cz + w / 2;
    const bx = box(at, 0.8, from, at + 0.6, 2.5, to, TEX_R_STEEL);
    const id = barriers.length;
    boxes.push({ ...bx, hidden: true, thin: true });
    barriers.push({ id, zone, box: bx, outside: { x: at + 0.3 + outsideDir * 1.1, z: cz }, inside: { x: at + 0.3 - outsideDir * 1.5, z: cz }, yaw: outsideDir > 0 ? -Math.PI / 2 : Math.PI / 2, kind: "window" });
    for (let i = 0; i < 2; i++) spawners.push({ zone, x: at + 0.3 + outsideDir * (5 + i * 1.5), y: 0, z: cz + (i === 0 ? -spread : spread), barrier: id });
    return { from, to, bottom: 0.8, top: 2.5 };
  };
  /** Ventana alta con reja, sin tablas: sólo deja entrar la luna. */
  const highWinX = (at: number, cx: number, bottom: number, top: number, w = 2.2): Gap => {
    windows.push(box(cx - w / 2, bottom, at, cx + w / 2, top, at + 0.6, TEX_R_STEEL));
    fence(cx - w / 2, bottom, at, cx + w / 2, top, at + 0.6);
    return { from: cx - w / 2, to: cx + w / 2, bottom, top };
  };
  const highWinZ = (at: number, cz: number, bottom: number, top: number, w = 2.2): Gap => {
    windows.push(box(at, bottom, cz - w / 2, at + 0.6, top, cz + w / 2, TEX_R_STEEL));
    fence(at, bottom, cz - w / 2, at + 0.6, top, cz + w / 2);
    return { from: cz - w / 2, to: cz + w / 2, bottom, top };
  };

  const northWallWins = [-20, -12, -4, 4, 12, 20].map((x) => highWinX(-19.6, x, 6.2, 9.6, 2.4));
  const southWallWins = [-20, -12, -4, 4, 12, 20].map((x) => highWinX(19, x, 6.2, 9.6, 2.4));
  cellhouse(-19.6, "x", -31.6, 30.6, northWallWins, true);
  cellhouse(19, "x", -31.6, 30.6, southWallWins, false);

  // Oeste: la puerta del comedor; arriba la del hospital (desde el descanso); una ventana al norte.
  const timesWin = winZ(1, -31.6, -16, -1, 1.8, 1.1);
  cellhouse(-31.6, "z", -19, 19, [timesWin, { from: -1.5, to: 1.5, bottom: 0, top: 3 }, { from: -8.9, to: -7, bottom: HOSP_Y, top: HOSP_Y + 2.5 }], true);
  // Este: la puerta de administración.
  cellhouse(30, "z", -19, 19, [{ from: -1.5, to: 1.5, bottom: 0, top: 3 }], false);

  // Techo con los tragaluces de Broadway, Michigan y la calle D.
  const skyRects: Rect[] = [
    { x0: -18, z0: -1.3, x1: 18, z1: 1.3 },
    { x0: -18, z0: -13.7, x1: 18, z1: -11.1 },
    { x0: -18, z0: 11.1, x1: 18, z1: 13.7 },
  ];
  for (const r of cut({ x0: -31.6, z0: -19.6, x1: 30.6, z1: 19.6 }, skyRects)) add(r.x0, HALL_H, r.z0, r.x1, ROOF_Y, r.z1, TEX_R_RAW);
  const skylights = skyRects.map((r) => ({ minX: r.x0, minZ: r.z0, maxX: r.x1, maxZ: r.z1, y: ROOF_Y + 0.55 }));
  for (const r of skyRects) {
    add(r.x0 - 0.2, ROOF_Y, r.z0 - 0.2, r.x1 + 0.2, ROOF_Y + 0.6, r.z0, TEX_R_STEEL);
    add(r.x0 - 0.2, ROOF_Y, r.z1, r.x1 + 0.2, ROOF_Y + 0.6, r.z1 + 0.2, TEX_R_STEEL);
    add(r.x0 - 0.2, ROOF_Y, r.z0, r.x0, ROOF_Y + 0.6, r.z1, TEX_R_STEEL);
    add(r.x1, ROOF_Y, r.z0, r.x1 + 0.2, ROOF_Y + 0.6, r.z1, TEX_R_STEEL);
    clip(r.x0 - 0.2, ROOF_Y, r.z0 - 0.2, r.x1 + 0.2, ROOF_Y + 6, r.z1 + 0.2);
  }

  // ---- Los bloques: cada uno es una columna maciza (que frena balas) con filas de celdas en los costados.
  interface Row extends CellRow {
    gaps: Map<number, [number, number][]>;
    walkTiers: number;
  }
  const makeRow = (z: number, dir: 1 | -1, walkTiers: number, count = CELLS, solidFront = false): Row => {
    const r: Row = { x0: BX0, z, dir, count, pitch: PITCH, depth: DEPTH, tiers: 3, tierH: TIER, noFront: [], gaps: new Map(), walkTiers, ...(solidFront ? { solid: true } : {}) };
    cells.push(r);
    return r;
  };
  const cellX = (r: Row, i: number) => r.x0 + r.pitch * (i + 0.5);
  const gapOf = (r: Row, tier: number, i: number) => {
    const list = r.gaps.get(tier) ?? [];
    list.push([r.x0 + r.pitch * i, r.x0 + r.pitch * (i + 1)]);
    r.gaps.set(tier, list);
    r.noFront.push(`${tier}:${i}`);
  };
  const cellWalls = (r: Row, tier: number, i: number) => {
    const y0 = tier * TIER;
    const a = r.z;
    const b = r.z + r.dir * r.depth;
    solid(r.x0 + r.pitch * i - 0.08, y0, a, r.x0 + r.pitch * i + 0.08, y0 + TIER, b);
    solid(r.x0 + r.pitch * (i + 1) - 0.08, y0, a, r.x0 + r.pitch * (i + 1) + 0.08, y0 + TIER, b);
    if (tier > 0) solid(r.x0 + r.pitch * i, y0 - 0.12, a, r.x0 + r.pitch * (i + 1), y0, b);
  };
  /** Una celda abierta: se entra (ahí van máquinas y la caja). */
  const openCell = (r: Row, i: number, tier = 0) => {
    gapOf(r, tier, i);
    cellWalls(r, tier, i);
    return { x: cellX(r, i), y: tier * TIER, z: r.z + r.dir * 1.25 };
  };
  /** Una celda tapiada con tablones: de ahí salen los zombis. */
  const plankCell = (r: Row, i: number, zone: number, tier = 0) => {
    gapOf(r, tier, i);
    cellWalls(r, tier, i);
    const y0 = tier * TIER;
    const cx = cellX(r, i);
    const id = barriers.length;
    const bx = box(cx - 0.72, y0 + 0.1, r.z - 0.1, cx + 0.72, y0 + 2.3, r.z + 0.1, TEX_R_STEEL);
    boxes.push({ ...bx, hidden: true, thin: true });
    barriers.push({
      id,
      zone,
      box: bx,
      outside: { x: cx, z: r.z + r.dir * 0.95 },
      inside: { x: cx, z: r.z - r.dir * (tier > 0 ? 0.72 : 1.35) },
      yaw: r.dir > 0 ? Math.PI : 0,
      kind: "cell",
      ...(tier > 0 ? { y: y0 } : {}),
    });
    spawners.push({ zone, x: cx, y: y0, z: r.z + r.dir * 1.9, barrier: id });
  };
  const finishRow = (r: Row) => {
    for (let t = 0; t < r.walkTiers; t++) {
      const y0 = t * TIER;
      let cursor = r.x0;
      const end = r.x0 + r.pitch * r.count;
      const seg = (a: number, b: number) => {
        if (b - a > 0.01) fence(a, y0, Math.min(r.z, r.z + r.dir * 0.08), b, y0 + TIER - 0.15, Math.max(r.z, r.z + r.dir * 0.08));
      };
      for (const [a, b] of (r.gaps.get(t) ?? []).sort((p, q) => p[0] - q[0])) {
        seg(cursor, a);
        cursor = b;
      }
      seg(cursor, end);
    }
  };
  const blockBody = (zMin: number, zMax: number, spineMin: number, spineMax: number, x1 = BX1) => {
    solid(BX0, 0, spineMin, x1, TIER * 3, spineMax);
    add(BX0, TIER * 3, zMin, x1, TIER * 3 + 0.3, zMax, TEX_R_WALL);
    add(BX0 - 0.4, 0, zMin, BX0, TIER * 3 + 0.3, zMax, TEX_R_WALL);
    add(x1, 0, zMin, x1 + 0.4, TIER * 3 + 0.3, zMax, TEX_R_WALL);
  };

  const rowBS = makeRow(-3, -1, 2);
  const rowBN = makeRow(-9.4, 1, 1);
  const rowCN = makeRow(3, 1, 2);
  const rowCS = makeRow(9.4, -1, 1);
  const rowA = makeRow(-15.4, -1, 1);
  const rowD = makeRow(15.4, 1, 1, 17, true);
  blockBody(-9.4, -3, -6.8, -5.6);
  blockBody(3, 9.4, 5.6, 6.8);
  blockBody(-19, -15.4, -19, -18);
  blockBody(15.4, 19, 18, 19, BX0 + PITCH * 17);

  // Los zombis salen de las celdas tapiadas.
  for (const i of [5, 19]) plankCell(rowBS, i, 0);
  for (const i of [6, 20]) plankCell(rowCN, i, 0);
  for (const i of [8, 16]) plankCell(rowBS, i, 3, 1);
  for (const i of [3, 13, 21]) plankCell(rowBN, i, 5);
  for (const i of [8, 17]) plankCell(rowA, i, 5);
  for (const i of [4, 9, 14]) plankCell(rowCS, i, 6);

  // ---- Las galerías del segundo piso y los pasarelas del tercero (a ese no se llega).
  const walkway = (x0: number, z0: number, x1: number, z1: number, y: number) => add(x0, y - 0.15, z0, x1, y, z1, TEX_R_TREAD);
  const gy = TIER;
  // Bloque B sobre Broadway: de punta a punta y sigue por arriba de Times Square hasta la escalera del hospital.
  const gw = 1.65;
  walkway(-31, -3, BX1, -gw, gy);
  rail(-29.4, -gw, -12.2, -gw, gy);
  rail(-10.6, -gw, BX1 - 1.6, -gw, gy);
  rail(-29.4, -3, -24.4, -3, gy);
  // Bloque C sobre Broadway: desde el descanso de la escalera hacia el este.
  walkway(-18, gw, BX1, 3, gy);
  rail(-18, gw, -12.2, gw, gy);
  rail(-10.6, gw, BX1 - 1.6, gw, gy);
  // Puente sobre Broadway, y otro al fondo.
  walkway(-12.2, -gw, -10.6, gw, gy);
  rail(-12.2, -gw, -12.2, gw, gy);
  rail(-10.6, -gw, -10.6, gw, gy);
  walkway(BX1 - 1.6, -gw, BX1, gw, gy);
  rail(BX1 - 1.6, -gw, BX1 - 1.6, gw, gy);
  add(BX1, gy - 0.15, -3, BX1 + 0.4, gy + 1.1, 3, TEX_R_STEEL);
  clip(BX1, gy + 1.1, -3, BX1 + 0.4, gy + 3, 3);
  // Tercer piso: se ve, no se llega.
  for (const y of [TIER * 2]) {
    add(BX0, y - 0.15, -3, BX1, y, -1.9, TEX_R_TREAD);
    add(BX0, y - 0.15, 1.9, BX1, y, 3, TEX_R_TREAD);
    rails.push({ x0: BX0, z0: -1.9, x1: BX1, z1: -1.9, y }, { x0: BX0, z0: 1.9, x1: BX1, z1: 1.9, y });
  }
  for (const [a, b] of [[-9.4, -8.3], [-16.5, -15.4], [8.3, 9.4]] as const) {
    for (const y of [TIER, TIER * 2]) {
      add(BX0, y - 0.15, a, BX1, y, b, TEX_R_TREAD);
      const edge = a === -9.4 ? b : a === 8.3 ? a : a;
      rails.push({ x0: BX0, z0: edge, x1: BX1, z1: edge, y });
    }
  }
  for (const y of [TIER, TIER * 2]) {
    add(BX0, y - 0.15, 15.4, BX0 + PITCH * 17, y, 16.5, TEX_R_TREAD);
    rails.push({ x0: BX0, z0: 15.4, x1: BX0 + PITCH * 17, z1: 15.4, y });
  }

  // La escalera de Broadway: sube hacia el este, del lado del bloque C, hasta el arranque de la galería.
  const stairZ = (gw + 3) / 2;
  stairs(-22.8, 0, stairZ, -18, gy, stairZ, 3 - gw, TEX_R_TREAD);
  rail(-22.8, gw, -18, gw, 0, gy + 2.4);
  // Abajo de la escalera no se entra: sin esto, los zombis quedaban atrapados contra los escalones.
  underStairs(-22.8, 0, stairZ, -18, gy, 3 - gw, gy);
  door(2, "Reja de la galería", 1000, box(-23.1, 0, gw, -22.85, 2.6, 3, TEX_R_STEEL), [0, 3], "bars");

  // La escalera del hospital, en Times Square: de la galería sube pegada a la pared oeste.
  add(-31, gy - 0.15, -3, -29.4, gy, -gw, TEX_R_TREAD);
  stairs(-30.2, gy, -3, -30.2, HOSP_Y, -6.9, 1.6, TEX_R_TREAD);
  add(-31, HOSP_Y - 0.15, -9.2, -29.4, HOSP_Y, -6.9, TEX_R_TREAD);
  rail(-29.4, -3, -29.4, -9.2, gy, 5.2);
  rail(-31, -9.2, -29.4, -9.2, HOSP_Y);
  door(11, "Entrada al hospital", 1250, box(-31.6, HOSP_Y, -8.9, -31, HOSP_Y + 2.5, -7, TEX_R_STEEL), [3, 10], "steel");

  // ---- Las rejas grandes de los pasillos.
  const gate = (x: number, z0: number, z1: number) => box(x - 0.14, 0, z0, x + 0.14, 2.62, z1, TEX_R_STEEL);
  door(0, "Reja de Times Square", 750, gate(BX0 - 0.2, -3, 3), [0, 1], "bars");
  door(1, "Reja de Control", 750, gate(BX1 + 0.2, -3, 3), [0, 2], "bars");
  door(4, "Reja de Michigan Avenue", 1000, gate(BX0 - 0.2, -15.4, -9.4), [1, 5], "bars");
  door(5, "Reja de Michigan Avenue", 1000, gate(BX1 + 0.2, -15.4, -9.4), [2, 5], "bars");
  door(6, "Reja de la calle D", 1000, gate(BX0 - 0.2, 9.4, 15.4), [1, 6], "bars");
  door(7, "Reja de la calle D", 1000, gate(BX1 + 0.2, 9.4, 19), [2, 6], "bars");
  for (const x of [BX0 - 0.2, BX1 + 0.2]) {
    for (const [z0, z1] of [[-3, 3], [-15.4, -9.4], [9.4, x > 0 ? 19 : 15.4]] as const) {
      if (z0 !== -3) add(x - 0.2, 2.62, z0, x + 0.2, 2.86, z1, TEX_R_STEEL);
      else if (x < 0) add(x - 0.2, 2.62, -1.61, x + 0.2, 2.86, z1, TEX_R_STEEL);
      // Las jambas, a los costados de la reja.
      add(x - 0.2, 0, z0 - 0.02, x + 0.2, 2.62, z0 + 0.1, TEX_R_STEEL);
      add(x - 0.2, 0, z1 - 0.1, x + 0.2, 2.62, z1 + 0.02, TEX_R_STEEL);
    }
  }
  door(3, "Puerta del comedor", 1000, box(-31.6, 0, -1.5, -31, 3, 1.5, TEX_R_WOODFLOOR), [1, 4], "wood");
  door(8, "Puerta de administración", 1250, box(30, 0, -1.5, 30.6, 3, 1.5, TEX_R_STEEL), [2, 7], "steel");

  // ---- Comedor (abajo) y hospital (arriba).
  const yardDoor: Gap = { from: -43.5, to: -41, bottom: 0, top: 2.7 };
  const comedorN = [winX(4, -13.6, -36, -1), winX(4, -13.6, -45.5, -1), winX(4, -13.6, -55, -1)];
  const hospN = [-35, -45.5, -55].map((x) => highWinX(-13.6, x, HOSP_Y + 1, HOSP_Y + 2.8, 2));
  // Las ventanas del sur dan al patio: sólo reja, para que entre la luna.
  const comedorS = [highWinX(13, -36, 1.3, 4, 2.4), yardDoor, highWinX(13, -55, 1.3, 4, 2.4)];
  const hospS: Gap[] = [-39, -45.5, -55].map((x) => highWinX(13, x, HOSP_Y + 1, HOSP_Y + 2.8, 2));
  hospS.push({ from: -35, to: -33, bottom: TERRACE_Y, top: TERRACE_Y + 1.1 });
  const twoFloors = (axis: "x" | "z", at: number, from: number, to: number, low: Gap[], high: Gap[], outside?: "min" | "max") => {
    if (outside === "min") {
      wall(axis, at, from, to, 0, 5, TEX_R_RAW, low, 0.48);
      wall(axis, at + 0.48, from, to, 0, 5, TEX_R_WALL, low, 0.12);
    } else if (outside === "max") {
      wall(axis, at, from, to, 0, 5, TEX_R_WALL, low, 0.12);
      wall(axis, at + 0.12, from, to, 0, 5, TEX_R_RAW, low, 0.48);
    } else {
      wall(axis, at, from, to, 0, 5, TEX_R_WALL, low);
    }
    add(...(axis === "x" ? ([from, 5, at, to, HOSP_Y, at + 0.6] as const) : ([at, 5, from, at + 0.6, HOSP_Y, to] as const)), TEX_R_RAW);
    wall(axis, at, from, to, HOSP_Y, TERRACE_Y + 1.1, TEX_R_RAW, high);
  };
  twoFloors("x", -13.6, -60.6, -31, comedorN, hospN, "min");
  twoFloors("x", 13, -60.6, -31, comedorS, hospS, "max");
  const kitchenDoor: Gap = { from: -1.5, to: 1.5, bottom: 0, top: 2.7 };
  twoFloors("z", -60.6, -13, 13, [kitchenDoor], [-8, 0, 8].map((z) => highWinZ(-60.6, z, HOSP_Y + 1, HOSP_Y + 2.8, 2)));
  door(9, "Puerta de la cocina", 1000, box(-60.6, 0, -1.5, -60, 2.7, 1.5, TEX_R_STEEL), [4, 8], "steel");
  door(10, "Salida al patio", 1250, box(-43.5, 0, 13, -41, 2.7, 13.6, TEX_R_STEEL), [4, 9], "bars");
  // El piso del hospital es el techo del comedor.
  add(-60, 5, -13, -31, HOSP_Y, 13, TEX_R_WALL);
  // El techo del hospital es la terraza. Tiene el hueco de la escalera.
  const terraceHole: Rect = { x0: -46.2, z0: -12.7, x1: -41, z1: -11.1 };
  for (const r of cut({ x0: -60.6, z0: -13.6, x1: -31, z1: 13.6 }, [terraceHole])) add(r.x0, 9, r.z0, r.x1, TERRACE_Y, r.z1, TEX_R_RAW);
  floorDecal(-60.6, -13.6, -31.6, 13.6, TERRACE_Y, TEX_R_ASPHALT);
  // Pretiles de la terraza, que no se saltan.
  clip(-60.6, TERRACE_Y + 1.1, -13.6, -31.6, TERRACE_Y + 4, -13);
  clip(-60.6, TERRACE_Y + 1.1, 13, -36, TERRACE_Y + 4, 13.6);
  clip(-60.6, TERRACE_Y + 1.1, -13, -60, TERRACE_Y + 4, 13);
  rail(-46.2, -11.1, -41, -11.1, TERRACE_Y);
  rail(-41, -12.7, -41, -11.1, TERRACE_Y);

  // Mesas del comedor: filas largas, con pasillos para correr.
  for (const z of [-9, -3.4, 3.4, 9]) {
    for (const [x0, x1] of [[-57, -49], [-47, -39], [-37, -33.5]] as const) {
      furn(x0, z - 0.45, x1, z + 0.45, 0.72, 0.8, TEX_R_WOODFLOOR);
      // Patas y bancos: se ven, y la caja de abajo los junta para chocar.
      solid(x0, 0, z - 0.85, x1, 0.72, z + 0.85);
      clip(x0, 0.72, z - 0.85, x1, 3.8, z - 0.45);
      clip(x0, 0.72, z + 0.45, x1, 3.8, z + 0.85);
      decal(x0, 0.42, z - 0.85, x1, 0.47, z - 0.55, TEX_R_WOODFLOOR);
      decal(x0, 0.42, z + 0.55, x1, 0.47, z + 0.85, TEX_R_WOODFLOOR);
      for (const x of [x0 + 0.3, (x0 + x1) / 2, x1 - 0.3]) {
        decal(x - 0.03, 0, z - 0.8, x + 0.03, 0.42, z + 0.8, TEX_R_STEEL);
        decal(x - 0.03, 0.42, z - 0.05, x + 0.03, 0.72, z + 0.05, TEX_R_STEEL);
      }
    }
  }
  // Columnas del comedor y el mostrador de la línea de servir, del lado de la cocina.
  for (const x of [-48, -38]) for (const z of [-6.2, 6.2]) add(x - 0.3, 0, z - 0.3, x + 0.3, 5, z + 0.3, TEX_R_WALLGREEN);
  furn(-59.6, -8, -58.4, -2.4, 0, 1.05, TEX_R_STEEL);
  furn(-59.6, 2.4, -58.4, 8, 0, 1.05, TEX_R_STEEL);

  // ---- Hospital: un pasillo y dos salas de internación.
  const hy = HOSP_Y;
  const hospTop = 9;
  const partition = (z: number, gaps: [number, number][]) => {
    wall("x", z, -60, -31, hy, hospTop, TEX_R_TILEWALL, gaps.map(([from, to]) => ({ from, to, bottom: hy, top: hy + 2.5 })), 0.2);
  };
  partition(-2.1, [[-52, -50], [-40.5, -38.5]]);
  partition(1.9, [[-52, -50], [-40.5, -38.5]]);
  // La sala de operaciones, en la punta oeste del pasillo.
  wall("z", -54, -1.9, 1.9, hy, hospTop, TEX_R_TILEWALL, [{ from: -1.1, to: 1.1, bottom: hy, top: hy + 2.5 }], 0.2);
  for (const x of [-57, -48, -36]) {
    for (const z of [-9.4, -5.4, 5.4, 9.4]) {
      if (x === -36 && z === -9.4) continue;
      prop("bed", x, hy, z, Math.PI / 2);
      solid(x - 1.05, hy, z - 0.48, x + 1.05, hy + 0.55, z + 0.48);
      clip(x - 1.05, hy + 0.55, z - 0.48, x + 1.05, hy + 3, z + 0.48);
    }
  }
  prop("wheelchair", -44, hy, -0.6, 0.6);
  prop("crutches", -33.5, hy, 12.2, 0, 1);
  prop("medbox", -36.6, hy + 0.7, 9.4, 1.1);
  prop("gasmask", -59, hy + 1.0, 0.4, Math.PI / 2);
  furn(-59.7, -0.9, -58.6, 0.9, hy, hy + 0.9, TEX_R_STEEL);
  furn(-37.3, 10.75, -35.9, 11.45, hy, hy + 0.72, TEX_R_STEEL);
  furn(-57.6, -0.6, -55.6, 0.6, hy, hy + 0.95, TEX_R_STEELGREEN);

  // La escalera a la terraza, en la sala del norte.
  stairs(-40, hy, -11.9, -46, TERRACE_Y, -11.9, 1.5, TEX_R_WALL, true, hy);
  add(-48, hy, -12.65, -46, TERRACE_Y, -11.15, TEX_R_WALL);
  rail(-40, -11.1, -46, -11.1, hy, 4.2);
  door(12, "Subida a la terraza", 1000, box(-39.95, hy, -12.65, -39.7, hy + 2.6, -11.15, TEX_R_STEEL), [10, 11], "bars");
  // El armario con llave del hospital (lo abren las radios).
  door(16, "Armario de medicamentos", 0, box(-34.6, hy, -13, -33.2, hy + 2.2, -12, TEX_R_STEELGREEN), [10, 10], "steel", true);

  // Terraza → techo de la casa de celdas.
  stairs(-35.2, TERRACE_Y, 0, -31.6, ROOF_Y, 0, 3, TEX_R_RAW, true, TERRACE_Y);
  rail(-35.2, -1.5, -31.6, -1.5, TERRACE_Y, 4.5);
  rail(-35.2, 1.5, -31.6, 1.5, TERRACE_Y, 4.5);
  // Pretiles del techo.
  const parapetH = 1.1;
  add(-31.6, ROOF_Y, -19.6, 30.6, ROOF_Y + parapetH, -19.2, TEX_R_RAW);
  add(-31.6, ROOF_Y, 19.2, 30.6, ROOF_Y + parapetH, 19.6, TEX_R_RAW);
  add(30.2, ROOF_Y, -19.2, 30.6, ROOF_Y + parapetH, 19.2, TEX_R_RAW);
  add(-31.6, ROOF_Y, -19.2, -31.2, ROOF_Y + parapetH, -1.5, TEX_R_RAW);
  add(-31.6, ROOF_Y, 1.5, -31.2, ROOF_Y + parapetH, 19.2, TEX_R_RAW);
  clip(-31.6, ROOF_Y + parapetH, -19.6, 30.6, ROOF_Y + 4, -19.2);
  clip(-31.6, ROOF_Y + parapetH, 19.2, 30.6, ROOF_Y + 4, 19.6);
  clip(30.2, ROOF_Y + parapetH, -19.2, 30.6, ROOF_Y + 4, 19.2);
  clip(-31.6, ROOF_Y + parapetH, -19.2, -31.2, ROOF_Y + 4, -1.5);
  clip(-31.6, ROOF_Y + parapetH, 1.5, -31.2, ROOF_Y + 4, 19.2);
  // El tanque de agua y las chimeneas de ventilación del techo.
  add(14, ROOF_Y, -18, 22, ROOF_Y + 3.4, -15, TEX_R_RUST);
  clip(14, ROOF_Y + 3.4, -18, 22, ROOF_Y + 6, -15);
  for (const [x, z] of [[-24, -7], [-24, 7], [24, -7], [24, 7], [0, -7], [0, 7]] as const) {
    furn(x - 0.5, z - 0.5, x + 0.5, z + 0.5, ROOF_Y, ROOF_Y + 1.4, TEX_R_STEEL);
  }
  prop("searchlight", 26.5, ROOF_Y + 0.02, 0, -Math.PI / 2, 2.2);
  prop("rack", -28, ROOF_Y, -15, 0.4);

  // ---- Cocina.
  const kN = [winX(8, -13.6, -67, -1)];
  wall("x", -13.6, -74.6, -60.6, 0, 5, TEX_R_RAW, kN, 0.48);
  wall("x", -13.12, -74.6, -60.6, 0, 5, TEX_R_TILEWALL, kN, 0.12);
  wall("x", 13, -74.6, -60.6, 0, 5, TEX_R_TILEWALL, [], 0.12);
  wall("x", 13.12, -74.6, -60.6, 0, 5, TEX_R_RAW, [], 0.48);
  const kW = [winZ(8, -74.6, -6, -1), winZ(8, -74.6, 6, -1)];
  wall("z", -74.6, -13.6, 13.6, 0, 5, TEX_R_RAW, kW, 0.48);
  wall("z", -74.12, -13.12, 13, 0, 5, TEX_R_TILEWALL, kW, 0.12);
  add(-74.6, 4.6, -13.6, -60.6, 5, 13.6, TEX_R_RAW);
  // Las hornallas, las mesadas de chapa y las pilas.
  furn(-73.8, -5, -72.4, 5, 0, 1.0, TEX_R_STEEL);
  furn(-68, -7, -66.4, -1.8, 0, 0.95, TEX_R_STEELGREEN);
  furn(-68, 1.8, -66.4, 7, 0, 0.95, TEX_R_STEELGREEN);
  furn(-63, -12.6, -61, -10.6, 0, 1.4, TEX_R_RUST);
  furn(-63, 10.6, -61, 12.6, 0, 1.4, TEX_R_RUST);
  furn(-72.5, 11.2, -70, 12.6, 0, 1.8, TEX_R_STEEL);
  prop("rack", -64, 0, 12.1, Math.PI);
  prop("trash", -62, 0, -7.6, 0.3, 0.8);
  add(-73.8, 1.6, -5, -72.4, 3.8, 5, TEX_R_STEEL);

  // ---- Patio de recreo: paredes altas, gradas de hormigón y salida al camino.
  const yardW = [winZ(9, -66.6, 24, -1), winZ(9, -66.6, 36, -1)];
  const yardS = [winX(9, 44, -50, 1), winX(9, 44, -38, 1)];
  const road1Gate: Gap = { from: 30, to: 33, bottom: 0, top: 2.8 };
  wall("z", -66.6, 13, 44.6, 0, 6.5, TEX_R_RAW, yardW);
  wall("x", 44, -66.6, -31, 0, 6.5, TEX_R_RAW, yardS);
  wall("z", -31.6, 19.6, 44.6, 0, 6.5, TEX_R_RAW, [road1Gate]);
  clip(-66.6, 6.5, 13.6, -66, 14, 44.6);
  clip(-66.6, 6.5, 44, -31.6, 14, 44.6);
  clip(-31.6, 6.5, 19.6, -31, 14, 44.6);
  door(14, "Portón del camino", 1500, box(-31.6, 0, 30, -31, 2.8, 33, TEX_R_STEEL), [9, 12], "bars");
  // Gradas: subir de a un escalón, los zombis también.
  for (let i = 0; i < 4; i++) {
    const x0 = -66 + i * 1.1;
    decal(x0, 0, 26.6, x0 + 1.1, 0.4 * (4 - i), 33.4, TEX_R_RAW);
  }
  // Entre las dos ventanas del oeste: los que entran por ahí tienen que caer en el piso.
  solid(-66, 0, 26.6, -61.6, 1.6, 33.4);
  clip(-66, 1.6, 26.6, -61.6, 6.5, 33.4);
  // Una cancha gastada, tachos y cajones.
  floorDecal(-58, 22, -36, 40, 0.014, TEX_R_ASPHALT);
  prop("trash", -34, 0, 42, 2.1, 0.9);
  prop("barrel", -33, 0, 40.4, 0.5);
  furn(-36.4, 41.6, -34.6, 43.4, 0, 1.1, TEX_R_PLANKS);

  // La escalera de incendios: de la terraza baja por la pared sur del comedor hasta el patio.
  const fireZ = 14.3;
  add(-36, TERRACE_Y - 0.15, 13.6, -33, TERRACE_Y, 15, TEX_R_TREAD);
  add(-35, TERRACE_Y - 0.15, 13, -33, TERRACE_Y, 13.6, TEX_R_TREAD);
  stairs(-36, TERRACE_Y, fireZ, -51, 0, fireZ, 1.4, TEX_R_TREAD);
  rail(-36, 15, -51, 15, 0, TERRACE_Y + 2.4);
  // Lo mismo abajo de la punta baja de la escalera de incendios.
  underStairs(-51, 0, fireZ, -36, TERRACE_Y, 1.4, 2.4);
  rail(-33, 15, -36, 15, TERRACE_Y);
  rail(-33, 13.6, -33, 15, TERRACE_Y);
  rail(-33, 13, -33, 13.6, TERRACE_Y);
  door(17, "Escalera de incendios", 750, box(-36.3, TERRACE_Y, 13.6, -36.05, TERRACE_Y + 2.5, 15, TEX_R_STEEL), [11, 9], "bars");

  // ---- La calle D: el aislamiento, la biblioteca al fondo y la bajada a la ciudadela.
  const libX0 = BX0 + PITCH * 17;
  // El cierre de la biblioteca: estantes, y mesas de lectura.
  for (const x of [13, 17, 21]) {
    furn(x - 1.2, 16.2, x + 1.2, 16.8, 0, 2.2, TEX_R_PLANKS);
    prop("rack", x - 0.6, 0, 18.3, 0);
  }
  furn(libX0 + 1, 17.6, libX0 + 2.6, 18.6, 0, 0.75, TEX_R_WOODFLOOR);
  prop("schooldesk", libX0 + 3.6, 0, 18.1, 0.2);
  prop("schooldesk", 23, 0, 16, 2.2);

  // La bajada: una escalera de piedra hacia el oeste.
  stairs(20.2, 0, 10.7, 14, CITADEL_Y, 10.7, 1.6, TEX_R_STONE, true, CITADEL_Y);
  // El pretil: a la altura de la cintura, y sin subirse.
  furn(15.3, 9.7, 20.2, 9.9, 0, 1.05, TEX_R_RAW);
  furn(15.3, 11.5, 20.2, 11.7, 0, 1.05, TEX_R_RAW);
  furn(15.3, 9.9, 15.5, 11.5, 0, 1.05, TEX_R_RAW);
  // El portal de piedra, para que se lea de lejos: jambas, dintel y un farol adentro.
  add(20.2, 0, 9.5, 20.5, 2.95, 9.9, TEX_R_STONE);
  add(20.2, 0, 11.5, 20.5, 2.95, 11.9, TEX_R_STONE);
  add(20.2, 2.6, 9.9, 20.5, 2.95, 11.5, TEX_R_STONE);
  door(13, "Bajada a la ciudadela", 1500, box(20.2, 0, 9.9, 20.45, 2.6, 11.5, TEX_R_STEEL), [6, 13], "bars");

  // ---- La ciudadela: piedra, pilares, los calabozos del fuerte viejo, la luz y el horno.
  const cy = CITADEL_Y;
  const ctop = -0.6;
  wall("x", 5.4, -6.6, 24.6, cy, ctop, TEX_R_STONE);
  wall("x", 19, -6.6, 24.6, cy, ctop, TEX_R_STONE);
  wall("z", -6.6, 5.4, 19.6, cy, ctop, TEX_R_STONE);
  wall("z", 24, 5.4, 19.6, cy, ctop, TEX_R_STONE);
  for (const x of [-1, 5, 11]) for (const z of [9.5, 15]) add(x - 0.45, cy, z - 0.45, x + 0.45, ctop, z + 0.45, TEX_R_STONE);
  add(17, cy, 14.4, 17.9, ctop, 15.3, TEX_R_STONE);
  // Calabozos: nichos de piedra con barrotes en la pared norte.
  for (let i = 0; i < 4; i++) {
    const x0 = -5 + i * 3.6;
    add(x0, cy, 6, x0 + 0.4, ctop, 7.6, TEX_R_STONE);
    fence(x0 + 0.4, cy, 7.5, x0 + 3.6, ctop, 7.6);
    windows.push(box(x0 + 0.4, cy, 7.5, x0 + 3.6, ctop - 0.1, 7.6, TEX_R_RUST));
  }
  add(9.4, cy, 6, 9.8, ctop, 7.6, TEX_R_STONE);
  prop("crate", -2, cy, 6.7, 0.3);
  prop("barrel", 21.8, cy, 7, 0.2);
  prop("crate2", 19, cy, 6.6, 1.2, 1.4);
  prop("crate", 22.2, cy, 8.6, 0.8);

  // El horno: una boca de ladrillo contra la pared sur, con chimenea que sube.
  furn(11.9, 17.8, 16.1, 18.95, cy, cy + 3.2, TEX_R_BRICK);
  add(12.2, cy, 17.4, 15.8, cy + 0.3, 17.8, TEX_R_STEEL);

  // ---- Administración: tres salas y la salida al camino.
  const adminY = 4.4;
  wall("x", -16.6, 30.6, 50.6, 0, adminY + 0.4, TEX_R_PLASTER, [winX(7, -16.6, 36, -1), winX(7, -16.6, 45, -1)]);
  wall("x", 16, 30.6, 50.6, 0, adminY + 0.4, TEX_R_PLASTER, [winX(7, 16, 36, 1), winX(7, 16, 45, 1)]);
  wall("z", 50, -16.6, 16.6, 0, adminY + 0.4, TEX_R_PLASTER, [{ from: -1.5, to: 1.5, bottom: 0, top: 2.8 }, highWinZ(50, -9, 1, 3, 2), highWinZ(50, 9, 1, 3, 2)]);
  add(30.6, adminY, -16.6, 50.6, adminY + 0.4, 16.6, TEX_R_RAW);
  wall("x", -5.2, 30.6, 50, 0, adminY, TEX_R_PLASTER, [{ from: 38.5, to: 41.5, bottom: 0, top: 2.7 }], 0.25);
  wall("x", 5, 30.6, 50, 0, adminY, TEX_R_PLASTER, [{ from: 38.5, to: 41.5, bottom: 0, top: 2.7 }], 0.25);
  door(15, "Salida al camino", 1500, box(50, 0, -1.5, 50.6, 2.8, 1.5, TEX_R_STEEL), [7, 12], "bars");
  // Oficina del alcaide: el escritorio y unos archivos.
  prop("desk", 40, 0, -11.5, Math.PI);
  solid(39, 0, -12, 41, 0.9, -11);
  clip(39, 0.9, -12, 41, 3.5, -11);
  furn(31, -15.6, 33, -14.8, 0, 1.9, TEX_R_STEELGREEN);
  furn(47, -15.6, 49.4, -15, 0, 2.2, TEX_R_PLANKS);
  prop("clock", 40, 3.1, -15.95, 0, 1.4);
  // Sala de visitas: los mostradores con el vidrio y un teléfono de cada lado (el vidrio y los
  // teléfonos los arma el cliente arriba de cada mostrador).
  for (const x of VISIT_BOOTHS) {
    furn(x - 1, -0.2, x + 1, 0.2, 0, 1.0, TEX_R_STEELGREEN);
  }
  // Armería: racks y cajones.
  furn(31.2, 6, 32.4, 15, 0, 1.2, TEX_R_RUST);
  prop("rack", 49, 0, 12, Math.PI / 2);
  prop("crate2", 46, 0, 15, 0.1, 1.4);
  prop("crate", 44, 0, 14.8, 0.5);
  solid(39.2, 0, 10, 40.8, 0.9, 11);
  clip(39.2, 0.9, 10, 40.8, 3.5, 11);
  prop("toolchest", 43.4, 0, 15.2, Math.PI, 0.9);

  // ---- El camino al muelle, con la bajada del patio y la de administración.
  ramp(-31, 0, 31.5, -1, DOCK_Y, 31.5, 7, TEX_R_ASPHALT);
  ramp(56.5, 0, 8, 56.5, DOCK_Y, 46, 7, TEX_R_ASPHALT);
  // Bordes de las bajadas arriba, donde todavía hay suelo a los costados.
  clip(-31, 0, 27.8, -1, 4, 28);
  clip(-31, 0, 35, -1, 4, 35.2);
  clip(52.8, 0, 8, 53, 4, 46);
  clip(60, 0, 8, 60.2, 4, 46);
  clip(50.6, 0, -8.2, 62, 4, -8);
  clip(60, 0, -8, 60.2, 4, 8);
  clip(50.6, 0, 7.9, 53, 4, 8);
  // Los bordes del muelle y del espigón: agua. No se salta.
  clip(-1, DOCK_Y, 72, 18, DOCK_Y + 6, 72.2);
  clip(32, DOCK_Y, 72, 60, DOCK_Y + 6, 72.2);
  clip(60, DOCK_Y, 46, 60.2, DOCK_Y + 6, 72.2);
  clip(-1.2, DOCK_Y, 46, -1, DOCK_Y + 6, 72.2);
  clip(17.8, DOCK_Y, 72, 18, DOCK_Y + 6, 92);
  clip(32, DOCK_Y, 72, 32.2, DOCK_Y + 6, 92);
  clip(17.8, DOCK_Y, 92, 32.2, DOCK_Y + 6, 92.2);
  rails.push({ x0: 18, z0: 72, x1: 18, z1: 92, y: DOCK_Y }, { x0: 32, z0: 72, x1: 32, z1: 92, y: DOCK_Y }, { x0: 18, z0: 92, x1: 32, z1: 92, y: DOCK_Y }, { x0: -1, z0: 72, x1: 18, z1: 72, y: DOCK_Y }, { x0: 32, z0: 72, x1: 60, z1: 72, y: DOCK_Y });
  for (const x of [4, 12, 38, 46, 54]) boxes.push({ ...box(x - 0.2, DOCK_Y, 71.2, x + 0.2, DOCK_Y + 0.7, 71.6, TEX_R_STEELGREEN), shape: "cyl", decal: true });
  for (const [x0, z0, x1, z1] of [[-71, 47, -70.6, 47.4], [-65, 47, -64.6, 47.4], [-71, 53, -70.6, 53.4], [-65, 53, -64.6, 53.4]] as const) add(x0, 0, z0, x1, 11, z1, TEX_R_RUST);
  add(-72, 11, 46, -63.6, 11.2, 54.4, TEX_R_PLANKS);
  wall("x", 46, -72, -63.6, 11.2, 12.4, TEX_R_PLANKS, [], 0.12);
  wall("x", 54.28, -72, -63.6, 11.2, 12.4, TEX_R_PLANKS, [], 0.12);
  wall("z", -72, 46, 54.4, 11.2, 12.4, TEX_R_PLANKS, [], 0.12);
  wall("z", -63.72, 46, 54.4, 11.2, 12.4, TEX_R_PLANKS, [], 0.12);
  for (const [x, z] of [[-71.8, 46.2], [-63.8, 46.2], [-71.8, 54.2], [-63.8, 54.2]] as const) add(x - 0.08, 12.4, z - 0.08, x + 0.08, 14, z + 0.08, TEX_R_RUST);
  add(-72.6, 14, 45.4, -63, 14.25, 55, TEX_R_CORRUGATED);
  // Lo del muelle: galpón, cajones, tambores, salvavidas.
  add(38, DOCK_Y, 48, 56, DOCK_Y + 4.4, 56, TEX_R_CORRUGATED);
  clip(38, DOCK_Y + 4.4, 48, 56, DOCK_Y + 8, 56);
  add(7, DOCK_Y, 48, 14, DOCK_Y + 2.4, 52, TEX_R_RUST);
  clip(7, DOCK_Y + 2.4, 48, 14, DOCK_Y + 6, 52);
  for (const [x, z] of [[10, 60], [13, 62], [36, 64], [44, 62], [5, 68]] as const) {
    furn(x - 0.75, z - 0.75, x + 0.75, z + 0.75, DOCK_Y, DOCK_Y + 1.2, TEX_R_PLANKS);
  }
  furn(19.5, 65, 21, 66.5, DOCK_Y, DOCK_Y + 1.5, TEX_R_RUST);
  for (const [x, z] of [[30, 60], [30.8, 60.7], [29.4, 61], [52, 66], [52.7, 65.5]] as const) {
    prop("barrel", x, DOCK_Y, z, x);
    boxes.push({ ...box(x - 0.32, DOCK_Y, z - 0.32, x + 0.32, DOCK_Y + 0.95, z + 0.32, TEX_R_RUST), hidden: true, shape: "cyl" });
    clip(x - 0.32, DOCK_Y + 0.95, z - 0.32, x + 0.32, DOCK_Y + 4, z + 0.32);
  }
  prop("lifebuoy", 18.05, DOCK_Y + 1.5, 80, Math.PI / 2, 1);
  prop("lifebuoy", 31.95, DOCK_Y + 1.5, 86, -Math.PI / 2, 1);
  prop("driftwood", 42, MASS_Y + 5, 78, 1.1, 0.8);
  // Cliffs y rocas alrededor de la isla (sólo se ven).
  prop("cliff", 60, -18, 78, 2.6, 0.45);
  prop("cliff", -40, -18, 60, 0.4, 0.5);
  prop("rocks", 72, -15, 48, 0.8, 2.2);
  prop("rocks", 2, -15, 78, 3.4, 2.4);
  prop("cliff", -100, -18, 20, 1.6, 0.6);
  prop("cliff", -40, -18, -56, 3.2, 0.6);
  prop("cliff", 40, -18, -56, 2.9, 0.6);
  prop("cliff", 90, -18, 0, -1.5, 0.6);

  // El edificio largo (las viviendas de los guardias) mirando al muelle.
  add(10, 0, 30, 50, 11, 45.9, TEX_R_BRICK);
  add(9.6, 11, 29.6, 50.4, 11.6, 46.2, TEX_R_RAW);
  // El faro, y una caseta en el patio de atrás de administración.
  boxes.push({ ...box(60, 0, -30, 66, 26, -24, TEX_R_RAW), shape: "cyl" });
  add(60.5, 26, -29.5, 65.5, 27, -24.5, TEX_R_STEEL);

  // ---- Lo que se compra.
  const qr = openCell(rowCN, 12);
  const boxSpotCell = openCell(rowBS, 12);
  const muleCell = openCell(rowBN, 8);
  const boxCell2 = openCell(rowCS, 18);
  const boxCellA = openCell(rowA, 12);

  const wallWeapons: WallWeapon[] = [
    { weapon: M14, x: -7, y: 1.5, z: -2.97, yaw: Math.PI, zone: 0 },
    { weapon: OLYMPIA, x: 8, y: 1.5, z: 2.97, yaw: 0, zone: 0 },
    { weapon: MP40, x: -30.92, y: 1.5, z: 8, yaw: -Math.PI / 2, zone: 1 },
    { weapon: FRAG, x: 29.92, y: 1.5, z: -8, yaw: Math.PI / 2, zone: 2 },
    { weapon: M16, x: -50, y: 1.6, z: -12.95, yaw: Math.PI, zone: 4 },
    { weapon: STAKEOUT, x: -47, y: 1.5, z: 12.95, yaw: 0, zone: 4 },
    { weapon: PYTHON, x: 40, y: 1.5, z: 15.95, yaw: 0, zone: 7 },
    { weapon: AK74U, x: 0, y: 1.5, z: -15.38, yaw: Math.PI, zone: 5 },
    { weapon: MP5K, x: -57, y: 1.5, z: 43.95, yaw: 0, zone: 9 },
    { weapon: PM63, x: 2, y: 1.5, z: 15.38, yaw: 0, zone: 6 },
    { weapon: THOMPSON, x: -14, y: 1.5, z: -15.38, yaw: Math.PI, zone: 5 },
    { weapon: WINCHESTER, x: -10, y: 1.5, z: 15.38, yaw: 0, zone: 6 },
    { weapon: GARAND, x: -45, y: 7.1, z: -1.88, yaw: Math.PI, zone: 10 },
  ];
  const boxSpots: Place[] = [
    { x: boxSpotCell.x, z: boxSpotCell.z - 0.1, yaw: 0, zone: 0 },
    { x: -33, z: -11.6, yaw: -Math.PI / 2, zone: 4 },
    { x: 18, z: 17.8, yaw: 0, zone: 6 },
    { x: boxCellA.x, z: boxCellA.z, yaw: 0, zone: 5 },
    { x: -40, y: HOSP_Y, z: 11.8, yaw: 0, zone: 10 },
    { x: -44, z: 41, yaw: 0, zone: 9 },
    { x: 36, y: DOCK_Y, z: 58, yaw: Math.PI, zone: 12 },
    { x: boxCell2.x, z: boxCell2.z, yaw: Math.PI, zone: 6 },
  ];
  const perks: PerkMachine[] = [
    { perk: PERK_QUICK, x: qr.x, z: qr.z, yaw: 0, zone: 0 },
    { perk: PERK_JUGG, x: -30.3, z: -11, yaw: -Math.PI / 2, zone: 1 },
    { perk: PERK_SPEED, x: -70.8, z: -12.4, yaw: Math.PI, zone: 8 },
    { perk: PERK_DOUBLETAP, x: 34.5, z: -15.2, yaw: Math.PI, zone: 7 },
    { perk: PERK_STAMIN, x: -33, z: 16, yaw: Math.PI / 2, zone: 9 },
    { perk: PERK_MULE, x: muleCell.x, z: muleCell.z, yaw: 0, zone: 5 },
  ];

  // Las máquinas chocan: no se camina a través de ellas.
  for (const m of perks) {
    const sideways = Math.abs(Math.sin(m.yaw)) > 0.5;
    const hx = sideways ? 0.36 : 0.47;
    const hz = sideways ? 0.47 : 0.36;
    const y = m.y ?? 0;
    solid(m.x - hx, y, m.z - hz, m.x + hx, y + 2.1, m.z + hz);
    clip(m.x - hx, y + 2.1, m.z - hz, m.x + hx, y + 4, m.z + hz);
  }
  solid(25 - 0.95, DOCK_Y, 89.5 - 0.62, 25 + 0.95, DOCK_Y + 2, 89.5 + 0.62);
  clip(25 - 0.95, DOCK_Y + 2, 89.5 - 0.62, 25 + 0.95, DOCK_Y + 5, 89.5 + 0.62);

  // ---- Zombis que salen del piso.
  spawners.push({ zone: 1, x: -27.5, y: 0, z: 13 }, { zone: 1, x: -27.5, y: 0, z: -13 });
  spawners.push({ zone: 2, x: 27, y: 0, z: 14 }, { zone: 2, x: 27, y: 0, z: -14 });
  spawners.push({ zone: 3, x: 6, y: gy, z: -2.45 }, { zone: 3, x: 16, y: gy, z: 2.45 });
  spawners.push({ zone: 4, x: -45, y: 0, z: -6 }, { zone: 4, x: -45, y: 0, z: 6 });
  spawners.push({ zone: 10, x: -45, y: hy, z: 0 }, { zone: 10, x: -36, y: hy, z: -3.5 }, { zone: 10, x: -45, y: hy, z: 7.5 }, { zone: 10, x: -52, y: hy, z: -7.5 });
  spawners.push({ zone: 11, x: -45, y: TERRACE_Y, z: 6 }, { zone: 11, x: -52, y: TERRACE_Y, z: -6 }, { zone: 11, x: -8, y: ROOF_Y, z: -7 }, { zone: 11, x: 12, y: ROOF_Y, z: 7 });
  spawners.push({ zone: 12, x: 20, y: DOCK_Y, z: 58 }, { zone: 12, x: 46, y: DOCK_Y, z: 66 }, { zone: 12, x: 25, y: DOCK_Y, z: 78 }, { zone: 12, x: 3, y: DOCK_Y, z: 40 }, { zone: 12, x: 56.5, y: 0, z: 2 });
  spawners.push({ zone: 13, x: 2, y: cy, z: 12.5 }, { zone: 13, x: 8, y: cy, z: 17 }, { zone: 13, x: -3, y: cy, z: 16 });
  spawners.push({ zone: 6, x: 18, y: 0, z: 14 });
  spawners.push({ zone: 7, x: 40, y: 0, z: -9 }, { zone: 7, x: 44, y: 0, z: 8 });
  spawners.push({ zone: 8, x: -70, y: 0, z: -9 }, { zone: 8, x: -64, y: 0, z: 9 });
  spawners.push({ zone: 9, x: -48, y: 0, z: 18 }, { zone: 9, x: -42, y: 0, z: 34 });

  // ---- Las luces. Prendidas con la llave: amarillas y parejas; apagadas: la luna y unos faroles rojos.
  const hall = (x: number, z: number, y = 8.9, p = 26, r = 19) => light(x, y, z, p, r, "grid", WARM, "lamp");
  for (const x of [-20, -10, 0, 10, 20]) {
    hall(x, 0);
    hall(x, -12.4);
    hall(x, 12.4);
  }
  for (const z of [-14, -5, 5, 14]) {
    hall(-27.5, z, 8.2, 22);
    hall(27, z, 8.2, 22);
  }
  // Las de emergencia: pocas y rojas, para que se pueda jugar antes de prender la luz.
  for (const [x, y, z] of [[-14, 2.3, -2.6], [10, 2.3, 2.6], [-14, 2.3, -9.7], [10, 2.3, -15.1], [-10, 2.3, 9.7], [10, 2.3, 15.1], [-30.7, 2.5, 5], [29.7, 2.5, -5]] as const) {
    light(x, y, z, 11, 15, "off", RED, "bulb");
  }
  for (const x of [-52, -42, -35]) for (const z of [-6.2, 6.2]) light(x, 4.5, z, 15, 14, "grid", WARM, "hanging");
  light(-45, 3, 12.2, 8, 13, "off", RED, "bulb");
  light(-45, 3, -12.8, 8, 13, "off", RED, "bulb");
  for (const z of [-8, 0, 8]) light(-67, 4.2, z, 16, 13, "grid", COLD, "hanging");
  light(-61.2, 2.6, -8, 7, 12, "off", RED, "bulb");
  for (const x of [-56, -45, -35]) {
    light(x, 8.6, -7, 11, 11, "grid", COLD, "hanging");
    light(x, 8.6, 7, 11, 11, "grid", COLD, "hanging");
    light(x, 8.6, 0, 7, 9, "grid", COLD, "bulb");
  }
  // La lámpara de cirugía: fuerte sobre la camilla, pero sin encandilar la sala (con 22 quemaba todo).
  light(-57, 8.5, 0, 9, 8, "grid", 0xffffff, "lamp");
  light(-32, 8, -7.8, 7, 11, "off", RED, "bulb");
  light(-45, 7.8, 1.5, 7, 11, "off", RED, "bulb");
  // Las oficinas, con luz cálida.
  for (const [x, z] of [[36, -11], [45, -11], [36, 0], [45, 0], [36, 11], [45, 11]] as const) light(x, 4.1, z, 10, 11, "grid", WARM, "bulb");
  light(31.4, 3, 10, 7, 11, "off", RED, "bulb");
  // La ciudadela: faroles cálidos, y el rojo ahí abajo siempre.
  for (const [x, z] of [[-3, 12], [4, 12], [10, 12], [16, 8], [20, 14]] as const) light(x, -1.1, z, 6.5, 11, "grid", 0xffb060, "bulb");
  for (const [x, z] of [[1, 8.6], [13, 17], [22, 9.5]] as const) light(x, -1.2, z, 9, 13, "always", RED, "bulb");
  // El brillo que sale del pozo de la escalera: es lo que dice "acá se baja".
  light(16, -1.4, 10.7, 16, 9, "always", 0xff8a3c, "bulb");
  // Lo de afuera: reflectores del patio, del camino y del muelle.
  for (const [x, z] of [[-65.6, 28], [-32, 24], [-50, 43.5], [-32, 40]] as const) light(x, 6, z, 26, 26, "grid", COLD, "seclight", x < -60 ? -Math.PI / 2 : x > -40 ? Math.PI / 2 : 0);
  for (const [x, y, z] of [[0, DOCK_Y + 7, 60], [22, DOCK_Y + 4, 72], [50, DOCK_Y + 7, 60], [25, DOCK_Y + 4.6, 90], [-14, -2, 27], [56.5, 3.4, 22], [51, 3, 4]] as const) {
    light(x, y, z, 28, 24, "grid", WARM, "seclight");
  }
  light(25, DOCK_Y + 3.2, 91, 9, 12, "always", 0x9a70ff, "bulb");
  // Las máquinas con su color: se hornean para que el piso de alrededor brille.
  const perkGlow: Record<number, number> = { [PERK_QUICK]: 0x4ad0ff, [PERK_JUGG]: 0xff4a4a, [PERK_SPEED]: 0x4aff7a, [PERK_DOUBLETAP]: 0xffc04a, [PERK_STAMIN]: 0xffe04a, [PERK_MULE]: 0x7aff9a };
  for (const m of perks) light(m.x, (m.y ?? 0) + 1.6, m.z, 4.2, 6, m.perk === PERK_QUICK ? "always" : "grid", perkGlow[m.perk] ?? WARM);

  for (const r of [rowBS, rowBN, rowCN, rowCS, rowA, rowD]) finishRow(r);

  // Pasillos con caños y mugre: lo cuelga el cliente; los dos carros de Broadway sí chocan.
  solid(3.3, 0, -1.6, 4.4, 0.9, -0.8);
  clip(3.3, 0.9, -1.6, 4.4, 3.8, -0.8);
  prop("toolcart", 3.85, 0, -1.2, 0.2, 0.9);
  prop("trash", -7, 0, 2.5, 1.1, 0.8);
  prop("alarm", 24.45, 1.5, -6, Math.PI / 2, 1);
  prop("utility", -30.85, 0.3, -11.7, Math.PI / 2, 1);
  prop("clock", -30.92, 4, 0, Math.PI / 2, 3);
  prop("alarm", -30.9, 1.5, -3, Math.PI / 2, 1);
  prop("crate", 28.6, 0, 17.6, 0.3);
  prop("crate2", 26.8, 0, 18.1, 1.4, 1.2);
  prop("barrel", 29.2, 0, 15.6, 2);
  prop("barrel", 28.9, 0, -17.8, 0.7);
  prop("trash", 25.4, 0, -18.2, 0.9, 0.8);
  prop("utility", 29.85, 0.4, 6, -Math.PI / 2, 1);
  prop("alarm", 29.9, 1.5, 3, -Math.PI / 2, 1);
  prop("trash", -29.8, 0, 17.6, 2.6, 0.8);
  prop("crate", -30, 0, -17.8, 1.1);
  prop("rack", -60.0, 5.6, 11.6, Math.PI, 1);
  prop("medbox", -57, 6.55, -9.4, 0.3);
  prop("crutches", -59.5, 5.6, -11.8, 1.2);
  prop("wheelchair", -36.5, 5.6, 2.8, 2.4);
  prop("schooldesk", 33.4, 0, -9, 1.2);
  prop("schooldesk", 47, 0, -9, -1.3);
  prop("crate", 12, -8, 66, 0.4);
  prop("crate2", 48, -8, 58.4, 1.1, 1.4);
  prop("trash", 34, -8, 70.8, 0.2, 0.9);
  prop("searchlight", -33.2, 9.32, -12.2, 2.3, 1.8);
  prop("drill", 21, 0, -12, 0.4, 1);
  solid(20.7, 0, -12.3, 21.3, 0.8, -11.7);
  clip(20.7, 0.8, -12.3, 21.3, 3, -11.7);

  const spawns: Spawn[] = [
    { x: -1.5, y: 0, z: -0.8, yaw: Math.PI / 2 },
    { x: -1.5, y: 0, z: 0.8, yaw: Math.PI / 2 },
    { x: 1, y: 0, z: -0.8, yaw: Math.PI / 2 },
    { x: 1, y: 0, z: 0.8, yaw: Math.PI / 2 },
  ];

  // Las puertas se buscan por posición en la lista (y por bit en doorsOpen): en orden de número.
  doors.sort((a, b) => a.id - b.id);

  return {
    name: "La Roca",
    boxes,
    spawns,
    zones,
    startZone: 0,
    doors,
    barriers,
    spawners,
    wallWeapons,
    boxSpots,
    perks,
    pap: { x: 25, y: DOCK_Y, z: 89.5, yaw: 0, zone: 12 },
    power: { x: 21.6, y: cy, z: 18.6, yaw: 0, zone: 13 },
    radios: [
      { x: -36.6, y: hy + 0.72, z: 11.1, yaw: Math.PI },
      { x: -2, y: cy + 0.52, z: 6.7, yaw: Math.PI },
      { x: -27.6, y: ROOF_Y + 1.15, z: -15, yaw: 0.4 },
    ],
    eggParts: [
      { x: -33.9, y: hy + 1.1, z: -12.5, door: 16 },
      { x: 13.6, y: DOCK_Y + 2.55, z: 51.6 },
      { x: 14, y: cy + 1, z: 17.3, souls: true },
    ],
    bench: { x: 40, z: 11.5, yaw: 0, zone: 7 },
    furnace: { x: 14, y: cy, z: 17.72, yaw: 0, zone: 13 },
    bounds: { minX: -95, minZ: -45, maxX: 75, maxZ: 96 },
    maxDrop: 0.5,
    sky: 0x0a1018,
    quest: {
      key: { name: "la llave del alcaide", x: 41, y: 0, z: -15.9, h: 1.25 },
      parts: [
        { name: "las bujías", x: -67.2, y: 0, z: -4, h: 1.0 },
        { name: "la hélice", x: -60.9, y: 0, z: 30, h: 0.35 },
        { name: "el bidón de nafta", x: 31.8, y: 0, z: 8, h: 1.34 },
        { name: "el timón", x: -56.6, y: hy, z: 0, h: 1.05 },
      ],
      boat: { name: "la lancha", x: 10, y: DOCK_Y, z: 71, h: 0 },
      beacon: { name: "el faro", x: 25.4, y: ROOF_Y, z: 0, h: 1.2 },
      safe: { name: "la caja fuerte", x: 41, y: 0, z: -15.9, h: 1.3 },
      safeWheels: [40.2, 41, 41.8],
      clues: [
        { x: -24 + PITCH * 20.5, y: 1.55, z: -17.93, yaw: Math.PI },
        { x: 7.6, y: -2.5, z: 6.03, yaw: Math.PI },
        { x: -59.95, y: 7.4, z: -1.4, yaw: -Math.PI / 2 },
      ],
      breakers: [
        { name: "la llave de Control", x: 29.9, y: 0, z: 11, h: 1.5 },
        { name: "la llave de Michigan", x: 8, y: 0, z: -15.36, h: 1.5 },
        { name: "la llave de Times Square", x: -30.92, y: 0, z: 14.5, h: 1.5 },
      ],
      phones: VISIT_BOOTHS.flatMap((x) => [-1, 1].map((side) => ({ name: "el teléfono", x, y: 0, z: side * 0.45, h: 1.35 }))),
      axe: { name: "el hacha de incendios", x: -60.9, y: 0, z: 8, h: 1.5 },
      notes: {
        radios: [
          "Grabación del doctor Arrieta, noche 3: el alcaide encerró el núcleo del generador en el armario de medicamentos del hospital. Dice que la música los calma. A los de abajo.",
          "Noche 9: la bobina quedó arriba del contenedor del muelle, y se alcanza desde el piso. Hay que sacar todo de la isla antes de que cierre la niebla.",
          "Noche 14: el horno de la ciudadela no se apaga más. Le damos a los muertos y devuelve lo que falta. Con las tres piezas, al banco de la armería.",
        ],
        steps: [
          "El núcleo todavía late. Falta la bobina del muelle y lo que escupa el horno.",
          "La bobina está fría. El horno de la ciudadela quiere almas: matá zombis a su lado.",
          "El horno escupió el gatillo. Con las tres piezas, al banco de la armería.",
          "Arrieta la armó para abrirse paso. No llegó. Lo que queda está en la caja fuerte del alcaide, en su oficina.",
        ],
        safeHint: "Arrieta anotó la combinación en tres lugares, con tiza: en una celda del bloque A, en un calabozo de la ciudadela y en la sala de operaciones. Las rayas dicen el orden.",
        breakers: "El faro no tiene corriente: hay tres llaves de corte, en Control, en Michigan y en Times Square. Bajada la primera, hay 45 segundos para las otras.",
        breakersFail: "Se volvieron a levantar. Hay que bajarlas las tres juntas.",
        bossDown: "El alcaide no se levanta más. La lancha espera.",
        key: "La llave maestra. Abre los depósitos, y la lancha del muelle necesita cuatro cosas: las bujías de la cocina, la hélice del patio, la nafta de la armería y el timón del hospital.",
        part: "Una menos para la lancha.",
        boat: "La lancha arranca, pero nadie cruza esta niebla a ciegas: hay que prender el faro desde el techo de los bloques, y para eso darle corriente.",
        beacon: "El faro le avisa a toda la isla. Aguantá hasta que se abra la niebla.",
        ready: "Se abrió la niebla, pero algo viene por el muelle. El alcaide no deja salir a nadie.",
      },
    },
    art: { id: "roca", lights, props, cells, rails, ramps, skylights, seaY: -13.5, lighthouse: { x: 63, y: 27.5, z: -27 }, windows },
  };
}

export const ROCA: GameMap = build();
