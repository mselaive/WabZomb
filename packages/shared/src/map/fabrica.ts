import {
  TEX_ASPHALT,
  TEX_BARREL,
  TEX_BRICK,
  TEX_CONCRETE,
  TEX_CONTAINER,
  TEX_CRATE,
  TEX_DIRT,
  TEX_FENCE,
  TEX_FLOOR,
  TEX_GRATE,
  TEX_LAB,
  TEX_METAL,
  TEX_PLASTER,
  TEX_ROOF,
  TEX_RUST,
  TEX_SANDBAG,
  TEX_TILES,
  TEX_WOOD,
  type Barrier,
  type Box,
  type Door,
  type GameMap,
  type PerkMachine,
  type Place,
  type Spawn,
  type Spawner,
  type WallWeapon,
  type Zone,
} from "./types.js";
import { AK74U, FRAG, M14, M16, MP40, MP5K, OLYMPIA, STAKEOUT } from "../weapons.js";
import { PERK_DOUBLETAP, PERK_JUGG, PERK_MULE, PERK_QUICK, PERK_SPEED, PERK_STAMIN } from "../constants.js";

/**
 * "La Fábrica": una fábrica abandonada de noche, 60 x 44 m adentro del muro,
 * con una franja de tierra alrededor de donde vienen los zombis.
 *
 *            norte (-Z)
 *   +-----------+-------+-----------+
 *   | Calderas  |  Lab  |  Taller   |   Calderas: la luz y Juggernog.
 *   |  (1000)   | (PaP) |  (1000)   |   Lab: el Pack-a-Punch y Mule Kick, al fondo.
 *   +-----------+-------+-----------+
 *   | Depósito  |███████|   Patio   |   Depósito: caja, MP40, Stamin-Up. Patio: a cielo abierto, Double Tap.
 *   |   (750)   |Oficina|   (750)   |   Oficina: se arranca acá, con Quick Revive y dos armas baratas.
 *   +-----------+-------+-----------+
 *            sur (+Z)
 *
 * Las puertas cuestan lo que dice el paréntesis. Los dos caminos (por el
 * depósito o por el patio) llegan a la luz y al laboratorio: se puede dar la
 * vuelta entera, que es lo que hace falta para correr en círculos.
 */

const WALL_H = 5;
const T = 0.5;
/** Altura del techo de las salas cerradas. */
const ROOF_Y = 4.6;

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tex: number): Box => ({
  minX: Math.min(minX, maxX),
  minY: Math.min(minY, maxY),
  minZ: Math.min(minZ, maxZ),
  maxX: Math.max(minX, maxX),
  maxY: Math.max(minY, maxY),
  maxZ: Math.max(minZ, maxZ),
  tex,
});

const crate = (x: number, z: number, s = 1.2, y = 0, tex = TEX_CRATE): Box => box(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, tex);
const barrel = (x: number, z: number, y = 0): Box => ({ ...box(x - 0.3, y, z - 0.3, x + 0.3, y + 0.9, z + 0.3, TEX_BARREL), shape: "cyl" });
const pillar = (x: number, z: number, h = ROOF_Y, s = 0.4): Box => box(x - s / 2, 0, z - s / 2, x + s / 2, h, z + s / 2, TEX_CONCRETE);

interface Gap {
  from: number;
  to: number;
  /** Desde dónde y hasta dónde está abierto (una puerta desde 0, una ventana desde el antepecho). */
  bottom: number;
  top: number;
}

/**
 * Una pared a lo largo de X (en z fijo) o de Z (en x fijo), con huecos. Lo que
 * queda alrededor de cada hueco (antepecho, dintel) se agrega como cajas.
 */
function wall(out: Box[], axis: "x" | "z", at: number, from: number, to: number, h: number, tex: number, gaps: Gap[] = [], thick = T): void {
  const sorted = [...gaps].sort((a, b) => a.from - b.from);
  let cursor = from;
  const seg = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 0.001 || y1 - y0 < 0.001) return;
    out.push(axis === "x" ? box(a, y0, at, b, y1, at + thick, tex) : box(at, y0, a, at + thick, y1, b, tex));
  };
  for (const g of sorted) {
    seg(cursor, g.from, 0, h);
    seg(g.from, g.to, 0, g.bottom);
    seg(g.from, g.to, g.top, h);
    cursor = g.to;
  }
  seg(cursor, to, 0, h);
}

function build(): GameMap {
  const boxes: Box[] = [];
  const zones: Zone[] = [
    { id: 0, name: "Oficina", minX: -7, minZ: 4, maxX: 7, maxZ: 18 },
    { id: 1, name: "Depósito", minX: -29, minZ: -8, maxX: -8, maxZ: 18 },
    { id: 2, name: "Patio", minX: 8, minZ: -8, maxX: 29, maxZ: 18 },
    { id: 3, name: "Calderas", minX: -29, minZ: -24, maxX: -8, maxZ: -9 },
    { id: 4, name: "Taller", minX: 8, minZ: -24, maxX: 29, maxZ: -9 },
    { id: 5, name: "Laboratorio", minX: -7, minZ: -24, maxX: 7, maxZ: -2 },
  ];

  // ---- Piso: tierra afuera, y cada sala con el suyo (calcomanías sobre la losa).
  boxes.push(box(-37, -0.5, -32, 37, 0, 26, TEX_DIRT));
  boxes.push({ ...box(-29.5, 0, -24.5, 29.5, 0.01, 18.5, TEX_FLOOR), decal: true });
  boxes.push({ ...box(-7, 0, 4, 7, 0.015, 18, TEX_TILES), decal: true });
  boxes.push({ ...box(8, 0, -8, 29, 0.015, 18, TEX_ASPHALT), decal: true });
  boxes.push({ ...box(-7, 0, -24, 7, 0.015, -2, TEX_LAB), decal: true });
  boxes.push({ ...box(-29, 0, -24, -8, 0.015, -9, TEX_GRATE), decal: true });

  // ---- El alambrado del fondo: la franja de tierra termina ahí.
  boxes.push({ ...box(-37, 0, -32, 37, 2.6, -31.8, TEX_FENCE), thin: true });
  boxes.push({ ...box(-37, 0, 25.8, 37, 2.6, 26, TEX_FENCE), thin: true });
  boxes.push({ ...box(-37, 0, -32, -36.8, 2.6, 26, TEX_FENCE), thin: true });
  boxes.push({ ...box(36.8, 0, -32, 37, 2.6, 26, TEX_FENCE), thin: true });

  // ---- Ventanas con tablas: huecos en el muro de afuera (antepecho a 0,8, dintel a 2,4).
  const barriers: Barrier[] = [];
  const spawners: Spawner[] = [];
  const win = (bottom = 0.8, top = 2.4) => ({ bottom, top });
  /** Una ventana en una pared a lo largo de X (z fijo): el hueco choca pero no se dibuja. */
  const windowX = (zone: number, at: number, from: number, to: number, outsideDir: 1 | -1): Gap => {
    const id = barriers.length;
    const cx = (from + to) / 2;
    boxes.push({ ...box(from, 0.8, at, to, 2.4, at + T, TEX_BRICK), hidden: true, thin: true });
    barriers.push({
      id,
      zone,
      box: box(from, 0.8, at, to, 2.4, at + T, TEX_BRICK),
      outside: { x: cx, z: at + T / 2 + outsideDir * 1.3 },
      inside: { x: cx, z: at + T / 2 - outsideDir * 1.4 },
      yaw: outsideDir > 0 ? Math.PI : 0,
    });
    for (let i = 0; i < 2; i++) spawners.push({ zone, x: cx + (i === 0 ? -2.5 : 2.5), y: 0, z: at + T / 2 + outsideDir * (5 + i * 1.5), barrier: id });
    return { from, to, ...win() };
  };
  const windowZ = (zone: number, at: number, from: number, to: number, outsideDir: 1 | -1): Gap => {
    const id = barriers.length;
    const cz = (from + to) / 2;
    boxes.push({ ...box(at, 0.8, from, at + T, 2.4, to, TEX_BRICK), hidden: true, thin: true });
    barriers.push({
      id,
      zone,
      box: box(at, 0.8, from, at + T, 2.4, to, TEX_BRICK),
      outside: { x: at + T / 2 + outsideDir * 1.3, z: cz },
      inside: { x: at + T / 2 - outsideDir * 1.4, z: cz },
      yaw: outsideDir > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
    for (let i = 0; i < 2; i++) spawners.push({ zone, x: at + T / 2 + outsideDir * (5 + i * 1.5), y: 0, z: cz + (i === 0 ? -2.5 : 2.5), barrier: id });
    return { from, to, ...win() };
  };

  // Muro sur (z 18..18.5): ventanas de la oficina (3), del depósito y del patio.
  wall(boxes, "x", 18, -29.5, 29.5, WALL_H, TEX_BRICK, [
    windowX(0, 18, -5, -3.4, 1),
    windowX(0, 18, -0.8, 0.8, 1),
    windowX(0, 18, 3.4, 5, 1),
    windowX(1, 18, -22, -20.4, 1),
    windowX(2, 18, 20.4, 22, 1),
  ]);
  // Muro norte (z -24.5..-24): calderas (2), laboratorio (1), taller (2).
  wall(boxes, "x", -24.5, -29.5, 29.5, WALL_H, TEX_BRICK, [
    windowX(3, -24.5, -24, -22.4, -1),
    windowX(3, -24.5, -14, -12.4, -1),
    windowX(5, -24.5, -0.8, 0.8, -1),
    windowX(4, -24.5, 12.4, 14, -1),
    windowX(4, -24.5, 22.4, 24, -1),
  ]);
  // Muro oeste (x -29.5..-29): depósito (2), calderas (1).
  wall(boxes, "z", -29.5, -24.5, 18.5, WALL_H, TEX_BRICK, [
    windowZ(3, -29.5, -18, -16.4, -1),
    windowZ(1, -29.5, 2, 3.6, -1),
    windowZ(1, -29.5, 12, 13.6, -1),
  ]);
  // Muro este (x 29..29.5): el patio es a cielo abierto, con portones de reja; el taller, cerrado.
  wall(boxes, "z", 29, -24.5, 18.5, WALL_H, TEX_BRICK, [
    windowZ(4, 29, -18, -16.4, 1),
    windowZ(2, 29, 2, 3.6, 1),
    windowZ(2, 29, 12, 13.6, 1),
  ]);

  // ---- Tabiques interiores y puertas.
  const doors: Door[] = [];
  const doorGap = (id: number, name: string, price: number, b: Box, zonesOf: [number, number]): Gap => {
    doors.push({ id, name, price, box: b, zones: zonesOf });
    return { from: 0, to: 0, bottom: 0, top: 0 };
  };
  // Oficina | Depósito (x -8..-7) y Oficina | Patio (x 7..8): puertas en z 10..12,2.
  wall(boxes, "z", -8, 4, 18, ROOF_Y, TEX_PLASTER, [{ from: 10, to: 12.2, bottom: 0, top: 2.6 }], 1);
  doorGap(0, "Puerta del depósito", 750, box(-8, 0, 10, -7, 2.6, 12.2, TEX_WOOD), [0, 1]);
  wall(boxes, "z", 7, 4, 18, ROOF_Y, TEX_PLASTER, [{ from: 10, to: 12.2, bottom: 0, top: 2.6 }], 1);
  doorGap(1, "Portón al patio", 750, box(7, 0, 10, 8, 2.6, 12.2, TEX_METAL), [0, 2]);
  // El bloque sellado entre la oficina y el laboratorio (la sala de máquinas): macizo.
  boxes.push(box(-8, 0, -2, 8, ROOF_Y, 4, TEX_CONCRETE));
  // Depósito | Calderas (z -9..-8), escombros en x -20..-17,8. Patio | Taller, reja en x 17,8..20.
  wall(boxes, "x", -9, -29, -8, ROOF_Y, TEX_CONCRETE, [{ from: -20, to: -17.8, bottom: 0, top: 2.8 }], 1);
  doorGap(2, "Escombros de las calderas", 1000, box(-20, 0, -9, -17.8, 2.8, -8, TEX_CRATE), [1, 3]);
  wall(boxes, "x", -9, 8, 29, ROOF_Y, TEX_CONCRETE, [{ from: 17.8, to: 20, bottom: 0, top: 2.8 }], 1);
  doorGap(3, "Reja del taller", 1000, { ...box(17.8, 0, -9, 20, 2.8, -8, TEX_FENCE), thin: true }, [2, 4]);
  // Calderas | Lab (x -8..-7) y Taller | Lab (x 7..8): puertas en z -17..-14,8. El resto hasta z -2, pared.
  wall(boxes, "z", -8, -24, -2, ROOF_Y, TEX_PLASTER, [{ from: -17, to: -14.8, bottom: 0, top: 2.6 }], 1);
  doorGap(4, "Puerta del laboratorio", 1250, box(-8, 0, -17, -7, 2.6, -14.8, TEX_METAL), [3, 5]);
  wall(boxes, "z", 7, -24, -2, ROOF_Y, TEX_PLASTER, [{ from: -17, to: -14.8, bottom: 0, top: 2.6 }], 1);
  doorGap(5, "Puerta del laboratorio", 1250, box(7, 0, -17, 8, 2.6, -14.8, TEX_METAL), [4, 5]);

  // ---- Techos: todo menos el patio. El dintel de cada ventana ya llega al techo.
  boxes.push(box(-29.5, ROOF_Y, 4, 7.5, ROOF_Y + 0.3, 18.5, TEX_ROOF));
  boxes.push(box(-29.5, ROOF_Y, -8, -7, ROOF_Y + 0.3, 4, TEX_ROOF));
  boxes.push(box(-29.5, ROOF_Y, -24.5, 8, ROOF_Y + 0.3, -8, TEX_ROOF));
  boxes.push(box(8, ROOF_Y, -24.5, 29.5, ROOF_Y + 0.3, -9, TEX_ROOF));
  // Vigas a la vista en el depósito y el taller.
  for (const z of [-2, 8]) boxes.push(box(-29, ROOF_Y - 0.4, z, -8, ROOF_Y, z + 0.3, TEX_RUST));
  for (const z of [-20, -14]) boxes.push(box(8, ROOF_Y - 0.4, z, 29, ROOF_Y, z + 0.3, TEX_RUST));

  // ---- Oficina: escritorios, archivero y un mostrador. Se corre alrededor del mostrador.
  boxes.push(box(-3.2, 0, 8.5, -1.6, 0.75, 9.3, TEX_WOOD));
  boxes.push(box(1.6, 0, 8.5, 3.2, 0.75, 9.3, TEX_WOOD));
  boxes.push(box(-1.4, 0, 13.6, 1.4, 1.0, 14.4, TEX_WOOD));
  boxes.push(box(-6.8, 0, 4.2, -5.6, 1.6, 5.4, TEX_METAL));
  boxes.push(crate(-5.4, 16.6, 1.0, 0, TEX_CRATE));

  // ---- Depósito: estanterías largas, pallets de cajones, barriles. Pasillos de 2,5 m.
  for (const x of [-24, -16]) {
    boxes.push(box(x - 0.5, 0, 0, x + 0.5, 2.6, 7, TEX_METAL));
    boxes.push(box(x - 0.5, 0, 10, x + 0.5, 2.6, 15, TEX_METAL));
  }
  boxes.push(crate(-12, 15.5, 1.2));
  boxes.push(crate(-12, 15.5, 1.0, 1.2, TEX_WOOD));
  boxes.push(crate(-13.3, 15.6, 1.1));
  boxes.push(crate(-26.5, -5.5, 1.2));
  boxes.push(barrel(-11, -6.5));
  boxes.push(barrel(-11.7, -6.9));
  boxes.push(barrel(-27.5, 16.5));
  boxes.push(box(-28.5, 0, 14.5, -25.5, 0.15, 16.5, TEX_WOOD));
  boxes.push(box(-28.5, 0.15, 14.5, -25.5, 2.2, 15.2, TEX_METAL));
  boxes.push(pillar(-20, -4));
  boxes.push(pillar(-20, 4));

  // ---- Patio: contenedores, una plataforma de carga con escalón, barriles y sacos.
  boxes.push(box(21, 0, -6, 27, 2.6, -3.6, TEX_CONTAINER));
  boxes.push(box(10.5, 0, 0, 13, 2.6, 6, TEX_CONTAINER));
  boxes.push(box(22, 0, 5, 28.5, 0.8, 9.5, TEX_CONCRETE));
  boxes.push(box(22, 0, 9.5, 28.5, 0.4, 10.5, TEX_CONCRETE));
  boxes.push(crate(24, 7.2, 1.0, 0.8, TEX_WOOD));
  boxes.push(barrel(14, 15));
  boxes.push(barrel(14.7, 15.4));
  boxes.push(barrel(14.2, 16.1));
  boxes.push(box(16, 0, -1, 19, 0.9, -0.4, TEX_SANDBAG));
  boxes.push(crate(10, 16.5, 1.2));
  // Dos cajones apilados contra el contenedor chico: por ahí se sube al techo (la bobina está arriba).
  boxes.push(crate(14.2, 3, 1.2));
  boxes.push(crate(14.2, 3, 1.2, 1.2, TEX_WOOD));
  boxes.push(pillar(19, 4, 3.2, 0.3));

  // ---- Calderas: dos calderas grandes, tubos y la tarima de la llave de la luz.
  for (const x of [-25, -12]) boxes.push({ ...box(x - 1.3, 0, -21.3, x + 1.3, 3.6, -18.7, TEX_RUST), shape: "cyl" });
  boxes.push(box(-26.3, 2.8, -22, -10.7, 3.2, -21.6, TEX_RUST));
  boxes.push({ ...box(-19, 0, -14, -17.5, 2.2, -12.5, TEX_RUST), shape: "cyl" });
  boxes.push(box(-21, 0, -23.8, -15, 0.25, -22.4, TEX_METAL));
  boxes.push(barrel(-27, -11));
  boxes.push(crate(-10, -11, 1.1));
  // El armario con llave de la primera pieza: lo abren las tres radios.
  doors.push({ id: 6, name: "Armario", price: 0, box: box(-10.6, 0, -13.4, -9.4, 2.2, -12.2, TEX_METAL), zones: [3, 3], locked: true });

  // ---- Taller: mesas de trabajo, un elevador de autos y un auto a medio desarmar.
  boxes.push(box(8.5, 0, -23.5, 11.4, 0.9, -22.5, TEX_METAL));
  boxes.push(box(25.2, 0, -23.5, 28.5, 0.9, -22.5, TEX_METAL));
  boxes.push(box(16, 0, -18, 20.4, 0.5, -15.8, TEX_RUST));
  boxes.push(box(16.6, 0.5, -17.6, 19.8, 1.4, -16.2, TEX_CONTAINER));
  boxes.push(crate(27.5, -11, 1.2));
  boxes.push(crate(27.5, -11, 1.0, 1.2, TEX_WOOD));
  boxes.push(barrel(9.8, -10.5));
  boxes.push(barrel(10.5, -10.9));

  // ---- Laboratorio: mesadas, tanques y la tarima del Pack-a-Punch al fondo.
  boxes.push(box(-5.5, 0, -12, -2.5, 0.9, -5, TEX_LAB));
  boxes.push(box(2.5, 0, -12, 5.5, 0.9, -5, TEX_LAB));
  for (const x of [-5.5, 5.5]) boxes.push({ ...box(x - 0.7, 0, -20.7, x + 0.7, 2.8, -19.3, TEX_METAL), shape: "cyl" });
  boxes.push(box(-2.5, 0, -23.5, 2.5, 0.3, -19.5, TEX_CONCRETE));
  boxes.push(pillar(-3, -15, ROOF_Y, 0.4));
  boxes.push(pillar(3, -15, ROOF_Y, 0.4));

  // ---- Afuera: algún cajón y barril tirados, para que no sea una explanada pelada.
  boxes.push(crate(-33, 8, 1.2));
  boxes.push(barrel(33.5, -12));
  boxes.push(crate(10, 22.5, 1.1));
  boxes.push(crate(-15, -28.5, 1.2));

  // ---- Zombis que salen del piso adentro de las salas (no en la oficina).
  spawners.push({ zone: 1, x: -20, y: 0, z: 8.5 }, { zone: 1, x: -12, y: 0, z: -3 });
  spawners.push({ zone: 2, x: 16, y: 0, z: 10 }, { zone: 2, x: 24, y: 0, z: 1 });
  spawners.push({ zone: 3, x: -22, y: 0, z: -12 });
  spawners.push({ zone: 4, x: 24, y: 0, z: -19 });
  spawners.push({ zone: 5, x: 0, y: 0, z: -9 }, { zone: 5, x: 0, y: 0, z: -16 });

  // ---- Lo que se compra.
  const wallWeapons: WallWeapon[] = [
    { weapon: M14, x: -6.85, y: 1.4, z: 7, yaw: -Math.PI / 2, zone: 0 },
    { weapon: OLYMPIA, x: 6.85, y: 1.4, z: 7, yaw: Math.PI / 2, zone: 0 },
    { weapon: MP40, x: -28.85, y: 1.4, z: 8.5, yaw: -Math.PI / 2, zone: 1 },
    { weapon: FRAG, x: -8.15, y: 1.3, z: 2, yaw: Math.PI / 2, zone: 1 },
    { weapon: STAKEOUT, x: 16, y: 1.4, z: 17.85, yaw: 0, zone: 2 },
    { weapon: M16, x: -10.5, y: 1.4, z: -23.85, yaw: Math.PI, zone: 3 },
    { weapon: AK74U, x: 28.85, y: 1.4, z: -13, yaw: Math.PI / 2, zone: 4 },
    { weapon: MP5K, x: 4, y: 1.4, z: -2.15, yaw: 0, zone: 5 },
  ];
  const boxSpots: Place[] = [
    { x: -20, z: 16.5, yaw: 0, zone: 1 },
    { x: 20, z: 15, yaw: 0, zone: 2 },
    { x: 13, z: -20, yaw: -Math.PI / 2, zone: 4 },
    { x: -15, z: -11, yaw: Math.PI, zone: 3 },
  ];
  const perks: PerkMachine[] = [
    { perk: PERK_QUICK, x: 5.9, z: 5.2, yaw: Math.PI * 0.75, zone: 0 },
    { perk: PERK_STAMIN, x: -27.9, z: -6, yaw: -Math.PI / 2, zone: 1 },
    { perk: PERK_DOUBLETAP, x: 27.9, z: 16, yaw: Math.PI / 2, zone: 2 },
    { perk: PERK_JUGG, x: -27.9, z: -14, yaw: -Math.PI / 2, zone: 3 },
    { perk: PERK_SPEED, x: 27.9, z: -11.5, yaw: Math.PI / 2, zone: 4 },
    { perk: PERK_MULE, x: 5.6, z: -3, yaw: Math.PI / 4, zone: 5 },
  ];

  const spawns: Spawn[] = [
    { x: -2, y: 0, z: 11, yaw: Math.PI },
    { x: 2, y: 0, z: 11, yaw: Math.PI },
    { x: -2, y: 0, z: 12.8, yaw: Math.PI },
    { x: 2, y: 0, z: 12.8, yaw: Math.PI },
  ];

  return {
    name: "La Fábrica",
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
    pap: { x: 0, z: -21.5, yaw: Math.PI, zone: 5 },
    power: { x: -18, z: -22.9, yaw: Math.PI, zone: 3 },
    eggParts: [
      { x: -10, y: 1.1, z: -12.8 },
      { x: 11.75, y: 2.75, z: 3 },
    ],
    bench: { x: 10, z: -21.9, yaw: Math.PI, zone: 4 },
    radios: [
      { x: -27, y: 2.25, z: 14.85, yaw: Math.PI / 2 },
      { x: 24, y: 2.6, z: -4.8, yaw: 0 },
      { x: -6.4, y: 0.9, z: -11.5, yaw: Math.PI / 2 },
    ],
    bounds: { minX: -37, minZ: -32, maxX: 37, maxZ: 26 },
    sky: 0x0b1020,
  };
}

export const FABRICA: GameMap = build();
