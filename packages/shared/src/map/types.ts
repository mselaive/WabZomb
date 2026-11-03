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
  /** Pared invisible sobre un mueble: frena a jugadores y zombis, no a las balas ni a las granadas. Es lo que impide subirse a donde un zombi no llega. */
  clip?: boolean;
  /** Cuánto detalle de luz horneada lleva (1 = el normal). */
  lm?: number;
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
  /** En un mapa con pisos, de qué altura a qué altura vale (sin esto, todas). */
  minY?: number;
  maxY?: number;
  /** Más rectángulos de la misma zona, cuando un camino dobla. */
  more?: { minX: number; minZ: number; maxX: number; maxZ: number }[];
  /** A cielo abierto: el cliente pone lluvia y viento. */
  outdoor?: boolean;
}

/** Una puerta o escombros: una caja que desaparece al pagarla. Conecta dos zonas. */
export interface Door {
  id: number;
  name: string;
  price: number;
  box: Box;
  zones: [number, number];
  /** No se compra: la abre el easter egg (las tres radios). */
  locked?: boolean;
  /** Cómo se dibuja: reja de barrotes, puerta de chapa o madera, o tablones. Sólo le importa al cliente. */
  style?: "bars" | "steel" | "wood" | "planks";
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
  /** La altura del piso donde cae el zombi (sin esto, 0). */
  y?: number;
  /** Cómo se dibuja: una ventana con reja o una celda tapiada. Sólo le importa al cliente. */
  kind?: "window" | "cell";
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
  y?: number;
  z: number;
  yaw: number;
  zone: number;
}

export interface Place {
  x: number;
  y?: number;
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
  /** Las piezas de la Thunder Gun: la A en el armario (`door` tiene que estar abierta), la B arriba de algo, la C la escupe el horno (`souls`). */
  eggParts: { x: number; y: number; z: number; door?: number; souls?: boolean }[];
  /** El banco donde se arma, y el horno que junta almas. */
  bench: Place;
  furnace: Place;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  sky: number;
  /** La dirección de arte: sólo la usa el cliente (y la herramienta que hornea la luz). */
  art?: MapArt;
  /** El easter egg largo, si el mapa lo tiene. */
  quest?: Quest;
  /** Desde qué altura se tiran los zombis para bajar (sin esto, MAX_DROP de la grilla). */
  maxDrop?: number;
}

/** Un objeto de la fuga: dónde se para el jugador (`y`, el piso) y a qué altura flota el objeto (`h`). */
export interface QuestItem {
  name: string;
  x: number;
  y: number;
  z: number;
  h: number;
}

/** La fuga: llave, piezas de la lancha, la lancha, el faro. Y lo que se cuenta en cada paso. */
export interface Quest {
  key: QuestItem;
  parts: QuestItem[];
  boat: QuestItem;
  beacon: QuestItem;
  /** La caja fuerte del alcaide: tres ruedas a lo largo de X. */
  safe: QuestItem;
  safeWheels: number[];
  /** Dónde están pintados los tres números. */
  clues: { x: number; y: number; z: number; yaw: number }[];
  /** Las tres llaves de corte. */
  breakers: QuestItem[];
  /** El hacha, en su caja de vidrio. */
  axe: QuestItem;
  notes: {
    radios: string[];
    /** Núcleo, bobina, gatillo, Thunder Gun armada. */
    steps: string[];
    key: string;
    part: string;
    boat: string;
    beacon: string;
    ready: string;
    safeHint: string;
    breakers: string;
    breakersFail: string;
    bossDown: string;
  };
}

/** Una luz del mapa: se hornea en el lightmap, y las más cercanas también brillan en tiempo real. */
export interface MapLight {
  x: number;
  y: number;
  z: number;
  color: number;
  /** Intensidad a un metro. */
  power: number;
  range: number;
  /** "grid" se prende con la luz; "always" está siempre; "off" sólo con la luz apagada (las de emergencia). */
  when: "grid" | "always" | "off";
  /** Qué artefacto colgar en ese lugar. */
  fixture?: string;
  /** Hacia dónde mira el artefacto (si va en una pared). */
  yaw?: number;
}

/** Un modelo apoyado en el mapa: decoración, sin colisión propia. */
export interface MapProp {
  model: string;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  scale?: number;
}

/** Una fila de celdas, para dibujar con instancias: frente en `z`, y hacia dónde va el fondo. */
export interface CellRow {
  x0: number;
  z: number;
  /** +1: el fondo de la celda está hacia +Z. */
  dir: 1 | -1;
  count: number;
  pitch: number;
  depth: number;
  tiers: number;
  tierH: number;
  /** Puerta maciza con mirilla (el aislamiento) en lugar de barrotes. */
  solid?: boolean;
  /** Claves "piso:celda" que no llevan frente de barrotes (abiertas o tapiadas). */
  noFront: string[];
}

export interface MapRail {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}

/** Una rampa inclinada que tapa una escalera de colisión: del punto 0 al 1. */
export interface MapRamp {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  width: number;
  tex: number;
}

export interface MapArt {
  /** La carpeta de assets (apps/client/public/<id>) y los lightmaps. */
  id: string;
  lights: MapLight[];
  props: MapProp[];
  cells: CellRow[];
  rails: MapRail[];
  ramps: MapRamp[];
  /** Huecos con reja y vidrio sucio: los arma el cliente. */
  windows: Box[];
  /** Tragaluces: de ahí bajan los rayos de luna. */
  skylights: { minX: number; minZ: number; maxX: number; maxZ: number; y: number }[];
  /** A qué altura está el mar. */
  seaY: number;
  /** Dónde está el reflector que gira, si hay. */
  lighthouse?: { x: number; y: number; z: number };
}

/** La zona en la que está un punto, o -1. */
export function zoneAt(map: GameMap, x: number, z: number, y = 0): number {
  for (const zn of map.zones) {
    if ((zn.minY !== undefined && y < zn.minY) || (zn.maxY !== undefined && y >= zn.maxY)) continue;
    if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) return zn.id;
    if (zn.more?.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ)) return zn.id;
  }
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

/** Las de La Roca: materiales PBR que el cliente baja de public/roca/tex (no se generan por código). */
export const TEX_R_WALL = 19;
export const TEX_R_WALLGREEN = 20;
export const TEX_R_PLASTER = 21;
export const TEX_R_FLOOR = 22;
export const TEX_R_FLOORDARK = 23;
export const TEX_R_FLOORBAD = 24;
export const TEX_R_STEEL = 25;
export const TEX_R_RUST = 26;
export const TEX_R_STEELGREEN = 27;
export const TEX_R_TREAD = 28;
export const TEX_R_STONE = 29;
export const TEX_R_BRICK = 30;
export const TEX_R_ROCK = 31;
export const TEX_R_TILEWALL = 32;
export const TEX_R_TILEFLOOR = 33;
export const TEX_R_PLANKS = 34;
export const TEX_R_WOODFLOOR = 35;
export const TEX_R_ASPHALT = 36;
export const TEX_R_CORRUGATED = 37;
export const TEX_R_RAW = 38;
export const TEX_R_YARD = 39;
export const TEX_ALL = 40;
/** Los archivos de cada TEX_R_*, en orden (public/roca/tex/<nombre>_c.webp), y cuántos metros cubre un tile. */
export const ROCA_TEX: readonly { name: string; metres: number; metal?: boolean }[] = [
  { name: "wall", metres: 3 },
  { name: "wallgreen", metres: 3 },
  { name: "plaster", metres: 3 },
  { name: "floor", metres: 3 },
  { name: "floordark", metres: 4 },
  { name: "floorbad", metres: 3 },
  { name: "steel", metres: 2, metal: true },
  { name: "rust", metres: 2, metal: true },
  { name: "steelgreen", metres: 2, metal: true },
  { name: "tread", metres: 1.2, metal: true },
  { name: "stone", metres: 2.5 },
  { name: "brick", metres: 2 },
  { name: "rock", metres: 6 },
  { name: "tilewall", metres: 1.5 },
  { name: "tilefloor", metres: 2 },
  { name: "planks", metres: 2.5 },
  { name: "woodfloor", metres: 2.5 },
  { name: "asphalt", metres: 3 },
  { name: "corrugated", metres: 2, metal: true },
  { name: "raw", metres: 3 },
  { name: "yard", metres: 4 },
];
