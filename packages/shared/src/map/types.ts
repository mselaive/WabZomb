/**
 * Un mapa es una lista de cajas alineadas a los ejes (paredes, cajones,
 * plataformas) más lo que hace a un mapa de zombis: zonas, puertas que se
 * compran, ventanas con tablas, lugares donde aparecen los zombis, armas en la
 * pared, la caja, las máquinas de bebidas, el Pack-a-Punch y la luz.
 */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Qué textura va (ver TEX_*). Sólo le importa al cliente. */
  tex: number;
  /** Se dibuja pero no choca ni frena balas. */
  decal?: boolean;
  /** Caja o cilindro vertical inscripto (barriles, tubos). */
  shape?: "box" | "cyl";
  /** Las balas la atraviesan (una reja): choca, pero no frena los tiros ni tapa la vista. */
  thin?: boolean;
  /** Choca pero no se dibuja (el hueco de una ventana: las tablas las dibuja el cliente aparte). */
  hidden?: boolean;
}

export interface Spawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Una zona del mapa: un rectángulo con nombre. Las puertas conectan zonas. */
export interface Zone {
  id: number;
  name: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Una puerta o escombros: una caja que desaparece al pagarla. Conecta dos zonas. */
export interface Door {
  id: number;
  name: string;
  price: number;
  box: Box;
  zones: [number, number];
}

/**
 * Una ventana con tablas. `box` es el hueco: choca siempre para los jugadores
 * (no se sale por la ventana); los zombis arrancan las tablas desde `outside`
 * y pasan a `inside`.
 */
export interface Barrier {
  id: number;
  zone: number;
  box: Box;
  outside: { x: number; z: number };
  inside: { x: number; z: number };
  /** Hacia dónde mira la ventana desde adentro (radianes), para dibujar las tablas. */
  yaw: number;
}

/** Dónde aparece un zombi: afuera de una ventana (`barrier`) o saliendo del piso adentro de una zona. */
export interface Spawner {
  zone: number;
  x: number;
  y: number;
  z: number;
  barrier?: number;
}

export interface WallWeapon {
  weapon: number;
  x: number;
  y: number;
  z: number;
  /** Hacia dónde mira la pared (desde la pared hacia la sala), en radianes. */
  yaw: number;
  zone: number;
}

export interface PerkMachine {
  perk: number;
  x: number;
  z: number;
  yaw: number;
  zone: number;
}

export interface Place {
  x: number;
  z: number;
  yaw: number;
  zone: number;
}

export interface GameMap {
  name: string;
  boxes: Box[];
  spawns: Spawn[];
  zones: Zone[];
  /** La zona en la que se arranca (abierta desde el principio). */
  startZone: number;
  doors: Door[];
  barriers: Barrier[];
  spawners: Spawner[];
  wallWeapons: WallWeapon[];
  /** Dónde puede estar la caja misteriosa (arranca en la primera). */
  boxSpots: Place[];
  perks: PerkMachine[];
  pap: Place;
  power: Place;
  /** Las radios escondidas del easter egg. */
  radios: { x: number; y: number; z: number; yaw: number }[];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  sky: number;
}

/** La zona en la que está un punto, o -1. */
export function zoneAt(map: GameMap, x: number, z: number): number {
  for (const zn of map.zones) if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) return zn.id;
  return -1;
}

/** Texturas: cada una se genera por código en el cliente (render/textures.ts). */
export const TEX_FLOOR = 0;
export const TEX_CONCRETE = 1;
export const TEX_CRATE = 2;
export const TEX_METAL = 3;
export const TEX_BRICK = 4;
export const TEX_PLASTER = 5;
export const TEX_WOOD = 6;
export const TEX_ROOF = 7;
export const TEX_ASPHALT = 8;
export const TEX_TILES = 9;
export const TEX_RUST = 10;
export const TEX_DIRT = 11;
export const TEX_FENCE = 12;
export const TEX_BARREL = 13;
export const TEX_SANDBAG = 14;
export const TEX_CONTAINER = 15;
export const TEX_GRATE = 16;
export const TEX_LAB = 17;
export const TEX_BOARDS = 18;
export const TEX_COUNT = 19;
