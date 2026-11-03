export type MatchPhase = "lobby" | "countdown" | "playing" | "ended";
/** La ronda: anunciándose (nadie aparece todavía), en curso, o terminada (cayó el último). */
export type RoundPhase = "intermission" | "live" | "over";

export interface PlayerInput {
  seq: number;
  fwd: number;
  side: number;
  yaw: number;
  pitch: number;
  shoot: boolean;
  reload: boolean;
  jump: boolean;
  crouch: boolean;
  /** Shift: correr (hacia adelante). */
  sprint: boolean;
  scope: boolean;
  /** E: usar lo que tenga adelante (comprar, reparar, revivir). */
  use: boolean;
  /** V: cuchillo. */
  melee: boolean;
  /** Acción puntual del tick (ver ACT_*). */
  act: number;
  /** Tick del servidor que el jugador tenía en pantalla, con fracción; -1 si no se sabe. */
  view: number;
}

/** Tres ranuras de arma: -1 vacía. */
export type Slots = [number, number, number];

/** Lo que tienen en común un jugador y un zombi para moverse y para que les peguen. */
export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  onGround: boolean;
  /** 0 de pie, CROUCH_TICKS agachado del todo (los zombis siempre 0). */
  crouch: number;
  /** Dónde estuvo en los últimos ticks (x, y, z por tick), para rebobinar los tiros. */
  trail: number[];
}

export interface PlayerState extends Body {
  id: number;
  /** En la partida (vivo o caído). Falso: muerto hasta la próxima ronda, o se fue. */
  alive: boolean;
  /** Caído: en el piso, desangrándose, esperando que lo levanten. */
  down: boolean;
  /** Ticks que le quedan caído antes de morir. */
  bleedTicks: number;
  /** Progreso de quien lo está reviviendo (ticks acumulados) y quién. */
  reviveTicks: number;
  reviveBy: number;
  /** Cayó con Quick Revive jugando solo: se levanta él cuando se acabe `bleedTicks`. */
  selfRevive: boolean;
  connected: boolean;
  pitch: number;

  hp: number;
  maxHp: number;
  /** Tick en que podrá empezar a regenerar vida. */
  regenAt: number;
  /** Ticks que le quedan frenado por un golpe. */
  tagged: number;
  fallImpact: number;
  /** Recién levantado: estos ticks no lo tocan. */
  invulnTicks: number;
  /** Tomando una bebida: estos ticks sin disparar. */
  drinkTicks: number;

  slots: Slots;
  ammo: Slots;
  reserve: Slots;
  /** 1 si el arma de esa ranura está mejorada (Pack-a-Punch). */
  pap: Slots;
  active: number;
  grenades: number;
  /** Bits PERK_*. */
  perks: number;
  /** Cuántas veces compró Quick Revive jugando solo. */
  quickRevives: number;

  fireCd: number;
  reloadCd: number;
  drawCd: number;
  meleeCd: number;
  reloading: boolean;
  recoil: number;
  recoilCool: number;
  shootHeld: boolean;
  useHeld: boolean;
  /** Ticks seguidos sosteniendo E sobre lo mismo (reparar, revivir). */
  useTicks: number;
  scoped: boolean;

  points: number;
  kills: number;
  headshots: number;
  downs: number;
  revives: number;
  /** Tablas que ya cobró en esta ronda. */
  boardsPaid: number;

  lastSeq: number;
  diedAtTick: number;
}

export const Z_RISING = 0;
export const Z_OUTSIDE = 1;
export const Z_TEARING = 2;
export const Z_VAULT = 3;
export const Z_HUNT = 4;
export const Z_ATTACK = 5;

export interface ZombieState extends Body {
  id: number;
  /** ZTYPE_WALK, ZTYPE_JOG o ZTYPE_RUN. */
  type: number;
  hp: number;
  maxHp: number;
  /** Z_*. */
  state: number;
  /** Ticks que le quedan en el estado (salir del piso, pasar la ventana, el manotazo). */
  stateTicks: number;
  /** La ventana por la que entra, o -1. */
  barrier: number;
  /** Jugador al que persigue, o -1. */
  target: number;
  /** Camino que sigue (centros de celda) y cuándo lo vuelve a calcular. */
  path: { x: number; y: number; z: number }[];
  repathAt: number;
  /** Cuándo puede volver a pegar. */
  attackCd: number;
  /** Para saber si está trabado. */
  stuck: number;
  lastX: number;
  lastZ: number;
  /** El punto de la ventana al que va mientras está afuera. */
  /** Último tick en que estuvo cerca de alguien (o pegando): si pasa mucho sin eso, está trabado en algún lado y se lo recicla. */
  engagedAt: number;
  goalX: number;
  goalZ: number;
}

export interface GrenadeState {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ticksLeft: number;
}

export interface PowerUpState {
  id: number;
  /** POWERUP_*. */
  kind: number;
  x: number;
  y: number;
  z: number;
  ticksLeft: number;
}

export interface RoundState {
  /** Desde 1. */
  number: number;
  phase: RoundPhase;
  ticksLeft: number;
  /** Zombis de la ronda: cuántos trae, cuántos salieron ya, cuántos cayeron. */
  total: number;
  spawned: number;
  killed: number;
  /** Cuándo sale el próximo. */
  nextSpawnAt: number;
  /** Power-ups que ya cayeron en esta ronda. */
  powerUps: number;
}

/** La caja misteriosa. */
export interface BoxState {
  /** Índice en map.boxSpots. */
  spot: number;
  /** 0 quieta, 1 girando, 2 con el arma a la vista, 3 el osito (se va). */
  phase: number;
  ticksLeft: number;
  /** El arma que ofrece (fase 2), y para quién. */
  weapon: number;
  forId: number;
  uses: number;
}

/** El Pack-a-Punch. */
export interface PapState {
  /** 0 libre, 1 trabajando, 2 con el arma lista para retirar. */
  phase: number;
  ticksLeft: number;
  weapon: number;
  forId: number;
}

export interface GameState {
  tick: number;
  phase: MatchPhase;
  phaseTicksLeft: number;
  players: PlayerState[];
  zombies: ZombieState[];
  nextZombieId: number;
  grenades: GrenadeState[];
  nextGrenadeId: number;
  powerUps: PowerUpState[];
  nextPowerUpId: number;
  round: RoundState;
  /** Bits: la puerta i está abierta. */
  doorsOpen: number;
  /** Tablas que le quedan a cada ventana. */
  boards: number[];
  power: boolean;
  box: BoxState;
  pap: PapState;
  /** Ticks que quedan de cada efecto global. */
  instaKill: number;
  doublePoints: number;
  fireSale: number;
  /** Radios prendidas (bits) y cuánto queda de canción. */
  radios: number;
  songTicks: number;
  /** El easter egg: bits EGG_*. Las piezas son de todos. */
  egg: number;
  /** Lo que queda del asedio de la fuga, en ticks (0 si no hay). */
  eggTicks: number;
  /** Almas juntadas en el horno (zombis muertos cerca), hasta EGG_SOULS. */
  eggSouls: number;
  /** A qué ronda llegaron (cuando termina). */
  reachedRound: number;
  seed: number;
  rng?: () => number;
  mapIndex: number;
}

export interface PlayerMeta {
  id: number;
  name: string;
  ready: boolean;
  away?: boolean;
  /** Marcador de la sala: partidas jugadas, mejor ronda, bajas sumadas. */
  played?: number;
  bestRound?: number;
  totalKills?: number;
}

/** Qué pegó un perdigón (en `hits` del evento `shot`). */
export const HIT_NONE = 0;
export const HIT_WORLD = 1;
export const HIT_BODY = 2;
export const HIT_HEAD = 3;

export type SimEvent =
  | { t: "shot"; byId: number; seq: number; weapon: number; x: number; y: number; z: number; hits: number[] }
  /** Le pegaron a un zombi. */
  | { t: "zhit"; zombieId: number; byId: number; amount: number; zone: number; x: number; y: number; z: number }
  /** Un zombi cayó. */
  | { t: "zkill"; zombieId: number; byId: number; weapon: number; headshot: boolean; x: number; y: number; z: number }
  /** Un zombi le pegó a alguien. */
  | { t: "hurt"; targetId: number; zombieId: number; amount: number }
  | { t: "down"; id: number }
  | { t: "revive"; id: number; byId: number }
  | { t: "bleedout"; id: number }
  | { t: "round"; phase: RoundPhase; number: number }
  | { t: "points"; id: number; amount: number; x: number; y: number; z: number }
  | { t: "door"; id: number; byId: number }
  | { t: "power"; byId: number }
  /** Compra de arma de pared (o su munición), bebida, y la caja en cada paso. */
  | { t: "buy"; byId: number; what: "weapon" | "ammo" | "perk" | "grenades"; which: number }
  | { t: "box"; what: "open" | "offer" | "take" | "teddy" | "close"; byId: number; weapon: number; spot: number }
  | { t: "pap"; what: "start" | "ready" | "take"; byId: number; weapon: number }
  | { t: "board"; barrier: number; boards: number; byId: number }
  | { t: "powerup"; what: "drop" | "take" | "gone"; id: number; kind: number; byId: number; x: number; y: number; z: number }
  | { t: "reload"; byId: number; x: number; y: number; z: number }
  | { t: "throw"; byId: number; seq: number; id: number }
  | { t: "explode"; id: number; x: number; y: number; z: number }
  | { t: "melee"; byId: number; seq: number; hit: boolean }
  /** Un zombi que sale del piso, arranca una tabla, o pasa la ventana (para el sonido). */
  | { t: "zombie"; what: "rise" | "tear" | "vault" | "groan"; id: number; x: number; y: number; z: number }
  | { t: "radio"; byId: number; which: number; all: boolean }
  /** El easter egg avanza: una pieza agarrada (0, 1, 2), la Thunder Gun armada (3), un alma más en el horno (4, con `souls`). La fuga: la llave (10), una pieza de la lancha (20 + cuál), lancha arreglada (30), faro (31), niebla abierta (32), escaparon (33). */
  | { t: "egg"; byId: number; step: number; souls?: number }
  | { t: "gameover"; round: number };
