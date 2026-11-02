/**
 * Todo lo que ajusta el juego, en un solo lugar. Unidades: metros, segundos,
 * radianes. Eje Y hacia arriba (como Three.js). El tick es de 50 ms.
 */

// ------------------------------------------------------------ tiempo y red

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
export const MS_PER_TICK = 1000 / TICK_RATE;

/** Los demás (y los zombis) se dibujan este tiempo en el pasado, interpolando entre snapshots. */
export const INTERP_DELAY_MS = 100;

/** Hasta cuántos ticks se rebobina a los zombis para decidir un tiro (compensación de lag). */
export const LAG_COMP_MAX_TICKS = 8;
/** Cuántas posiciones pasadas se recuerdan de cada cuerpo. */
export const TRAIL_LENGTH = 16;

/** Sube cuando el cliente y el servidor dejan de entenderse (ver el README). */
export const PROTOCOL_VERSION = 1;

/** Se puede jugar solo. Cuatro, como en el original. */
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;
export const MAX_NAME_LENGTH = 14;
export const ROOM_CODE_LENGTH = 6;

export const MAX_INPUT_BUFFER = 8;
export const RECONNECT_GRACE_MS = 15_000;
export const EMPTY_ROOM_SHUTDOWN_TICKS = 30 * TICK_RATE;

export const COUNTDOWN_TICKS = 3 * TICK_RATE;
/** Cuánto se muestra el resultado (la ronda a la que llegaron) antes de volver a la sala. */
export const ENDED_TICKS = 14 * TICK_RATE;

// ------------------------------------------------------------ jugador

export const PLAYER_HALF_W = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.25;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.07;
export const HEAD_HEIGHT = 0.3;
export const LEG_HEIGHT = 0.8;

export const MAX_HP = 100;
/** Con Juggernog. */
export const JUGG_HP = 250;
/** Sin recibir daño durante estos ticks, la vida vuelve sola (y rápido). */
export const REGEN_DELAY_TICKS = 70;
export const REGEN_PER_TICK = 5;

export const GRAVITY = 20;
export const JUMP_SPEED = 7.3;
/** Correr (Shift, hacia adelante): más rápido, sin poder disparar. */
export const SPRINT_FACTOR = 1.32;
export const CROUCH_FACTOR = 0.34;
export const GROUND_ACCEL = 14;
export const GROUND_FRICTION = 10;
export const AIR_ACCEL = 1.2;
export const STEP_HEIGHT = 0.45;
export const CROUCH_TICKS = 4;
/** Stamin-Up: más rápido. */
export const STAMIN_FACTOR = 1.14;
/** Un golpe de zombi frena un instante. */
export const TAG_TICKS = 6;
export const TAG_FACTOR = 0.5;

export const FALL_SAFE_SPEED = 9;
export const FALL_DAMAGE_PER_MS = 10;

// ------------------------------------------------------------ caídos y revivir

/** Caído: desangrándose este tiempo; después muere hasta la próxima ronda. */
export const DOWN_BLEED_TICKS = 45 * TICK_RATE;
/** Revivir a alguien: sostener E a su lado. Con Quick Revive, la mitad. */
export const REVIVE_TICKS = 3 * TICK_RATE;
export const REVIVE_RANGE = 1.8;
/** Solo con Quick Revive: te levantás vos a los pocos segundos (hasta 3 veces por partida). */
export const SOLO_REVIVE_TICKS = 5 * TICK_RATE;
export const SOLO_REVIVE_MAX = 3;
/** El que vuelve se levanta con esta vida, y estos ticks sin que lo puedan tocar (los zombis cerca salen empujados). */
export const REVIVE_HP = 50;
export const REVIVE_INVULN_TICKS = 50;
export const REVIVE_PUSH_RANGE = 3.5;
/** Con un caído al que nadie más puede defender, los zombis se quedan a esta distancia esperando. */
export const ZOMBIE_WAIT_RANGE = 2.4;

// ------------------------------------------------------------ puntos

export const START_POINTS = 500;
export const MAX_POINTS = 999_999;
export const HIT_POINTS = 10;
export const KILL_POINTS = 60;
export const HEADSHOT_POINTS = 100;
export const MELEE_POINTS = 130;
export const EXPLOSIVE_POINTS = 50;
export const BOARD_POINTS = 10;
/** Tablas que pagan por ronda y jugador (después se reparan igual, gratis). */
export const BOARD_PAID_PER_ROUND = 10;
export const NUKE_POINTS = 400;
export const CARPENTER_POINTS = 200;

// ------------------------------------------------------------ zombis

export const ZOMBIE_HALF_W = 0.3;
export const ZOMBIE_HEIGHT = 1.8;
/** Vivos a la vez, como mucho. */
export const ZOMBIE_MAX_ALIVE = 24;
/** Lo que pega un zombi: dos manotazos te tiran (cinco con Juggernog). */
export const ZOMBIE_DAMAGE = 50;
export const ZOMBIE_ATTACK_RANGE = 1.35;
/** Desde que levanta el brazo hasta que pega (se puede esquivar), y cuánto espera para el siguiente. */
export const ZOMBIE_WINDUP_TICKS = 8;
export const ZOMBIE_ATTACK_TICKS = 22;
/** Tipos: caminan, trotan, corren (m/s). */
export const ZOMBIE_SPEEDS = [1.7, 3.1, 4.7] as const;
export const ZTYPE_WALK = 0;
export const ZTYPE_JOG = 1;
export const ZTYPE_RUN = 2;
/** Salir del piso tarda esto; mientras, ya se los puede balear. */
export const ZOMBIE_RISE_TICKS = 30;
/** Pasar por la ventana sin tablas. */
export const BARRIER_VAULT_TICKS = 18;
/** Un zombi tarda esto en arrancar una tabla; el jugador en poner una (sosteniendo E). */
export const BOARD_TEAR_TICKS = 30;
export const BOARD_REPAIR_TICKS = 14;
export const BOARD_MAX = 6;
export const BOARD_RANGE = 2.4;

/** Vida de un zombi en la ronda `r`: sube 100 por ronda hasta la 9, después un 10 % por ronda. */
export function zombieHp(round: number): number {
  if (round <= 9) return 150 + 100 * (round - 1);
  return Math.round(950 * Math.pow(1.1, round - 9));
}

/** Cuántos zombis trae la ronda `r` con `players` jugadores. */
export function zombieCount(round: number, players: number): number {
  const base = 5 + 1.6 * round + 0.12 * round * round;
  return Math.round(base * (1 + 0.45 * (Math.max(1, players) - 1)));
}

/** Ticks entre un zombi y el siguiente: cada vez más seguido. */
export function zombieSpawnInterval(round: number): number {
  return Math.max(10, 50 - 3 * round);
}

/** Qué tipo de zombi sale en la ronda `r` con el azar `u` (0 a 1): corren, trotan o caminan. */
export function zombieTypeFor(round: number, u: number): number {
  const run = Math.min(0.85, Math.max(0, (round - 3) / 12));
  const jog = Math.min(0.6, Math.max(0.1, (round - 1) / 8));
  if (u < run) return ZTYPE_RUN;
  if (u < run + jog) return ZTYPE_JOG;
  return ZTYPE_WALK;
}

// ------------------------------------------------------------ rondas

/** Entre rondas: "Ronda N" en pantalla y un respiro. La primera tarda lo mismo. */
export const ROUND_INTERMISSION_TICKS = 8 * TICK_RATE;
/** Al caer el último zombi, cuánto se espera antes de anunciar la siguiente ronda. */
export const ROUND_OVER_TICKS = 3 * TICK_RATE;

// ------------------------------------------------------------ compras

export const USE_RANGE = 2.4;
export const BOX_PRICE = 950;
export const BOX_FIRE_SALE_PRICE = 10;
/** La caja gira este tiempo, y después deja el arma a la vista para agarrarla. */
export const BOX_SPIN_TICKS = 70;
export const BOX_TAKE_TICKS = 10 * TICK_RATE;
/** Las primeras vueltas nunca traen el osito; después puede: la caja se va a otro lado y devuelve la plata. */
export const BOX_TEDDY_FREE_USES = 4;
export const PAP_PRICE = 5000;
export const PAP_TICKS = 5 * TICK_RATE;
export const PAP_TAKE_TICKS = 15 * TICK_RATE;
/** Munición de un arma de pared: la mitad del precio; mejorada, un precio fijo. */
export const WALL_AMMO_FACTOR = 0.5;
export const PAP_AMMO_PRICE = 4500;
export const PERK_MAX = 4;
/** Tomar la bebida lleva esto: sin disparar mientras tanto. */
export const DRINK_TICKS = 50;

/** Las bebidas. */
export const PERK_JUGG = 0;
export const PERK_SPEED = 1;
export const PERK_DOUBLETAP = 2;
export const PERK_QUICK = 3;
export const PERK_STAMIN = 4;
export const PERK_MULE = 5;
export const PERK_COUNT = 6;
export const PERK_NAMES = ["Juggernog", "Speed Cola", "Double Tap", "Quick Revive", "Stamin-Up", "Mule Kick"] as const;
export const PERK_SHORT = ["JUG", "SPD", "DTP", "QRV", "STM", "MLK"] as const;
export const PERK_PRICES = [2500, 3000, 2000, 1500, 2000, 4000] as const;
/** Quick Revive solo sale más barato (y se puede comprar tres veces). */
export const PERK_QUICK_SOLO_PRICE = 500;
/** Colores de cada máquina (para el cliente). */
export const PERK_COLORS = [0xd4312b, 0x3fb44f, 0xe6b422, 0x4aa7e0, 0xe8e45a, 0x2fbf9a] as const;
/** Lo que hace cada una, para los carteles. */
export const PERK_DESC = [
  "250 de vida en vez de 100",
  "Recargás al doble de velocidad",
  "Cada bala pega el doble",
  "Revivís más rápido (solo: te levantás vos)",
  "Corrés más rápido",
  "Una tercera arma",
] as const;

// ------------------------------------------------------------ power-ups

export const POWERUP_MAX_AMMO = 0;
export const POWERUP_INSTA = 1;
export const POWERUP_DOUBLE = 2;
export const POWERUP_NUKE = 3;
export const POWERUP_CARPENTER = 4;
export const POWERUP_FIRE_SALE = 5;
export const POWERUP_COUNT = 6;
export const POWERUP_NAMES = ["Max Ammo", "Insta-Kill", "Double Points", "Nuke", "Carpenter", "Fire Sale"] as const;
/** Cuánto queda en el piso, y cuánto dura el efecto (Insta-Kill, Double Points, Fire Sale). */
export const POWERUP_LIFE_TICKS = 30 * TICK_RATE;
export const POWERUP_EFFECT_TICKS = 30 * TICK_RATE;
export const POWERUP_RADIUS = 1.4;
/** Probabilidad por baja, y cuántos como mucho por ronda. */
export const POWERUP_CHANCE = 0.035;
export const POWERUP_MAX_PER_ROUND = 4;

// ------------------------------------------------------------ granadas y cuchillo

export const FRAG_MAX = 4;
export const FRAG_START = 2;
export const GRENADE_FUSE_TICKS = 50;
export const GRENADE_THROW_SPEED = 17;
export const GRENADE_BOUNCE = 0.45;
export const GRENADE_RADIUS = 0.08;
export const FRAG_RADIUS = 5;
/** La granada escala con la ronda: mata de una hasta la 10 más o menos. */
export function fragDamage(round: number): number {
  return 500 + 60 * round;
}
/** Daño al que la tira (o al compañero) si le cae cerca: poco, pero existe. */
export const FRAG_SELF_DAMAGE = 40;
export const KNIFE_DAMAGE = 150;
export const KNIFE_RANGE = 1.5;
export const KNIFE_TICKS = 12;

// ------------------------------------------------------------ input

export const BTN_SHOOT = 1;
export const BTN_RELOAD = 2;
export const BTN_JUMP = 4;
export const BTN_CROUCH = 8;
/** Shift: correr. */
export const BTN_SPRINT = 16;
export const BTN_SCOPE = 32;
/** E: usar (comprar, reparar, revivir). */
export const BTN_USE = 64;
/** V: cuchillo. */
export const BTN_MELEE = 128;

export const ACT_NONE = 0;
export const ACT_SLOT_0 = 1;
export const ACT_SLOT_1 = 2;
export const ACT_SLOT_2 = 3;
/** G: tirar una granada. */
export const ACT_GRENADE = 4;
export const ACT_MAX = 4;

/** Zonas de impacto. */
export const ZONE_HEAD = 0;
export const ZONE_BODY = 1;
export const ZONE_LEGS = 2;

export const FOV = 75;
export const FOV_SCOPED = 22;


/**
 * El easter egg: tres radios escondidas (E) hacen sonar la canción y abren el
 * armario con la primera pieza; la segunda está arriba de un contenedor; la
 * tercera la da la caja cuando ya se tienen las otras dos. Con las tres, en el
 * banco del taller se arma la Thunder Gun.
 */
export const EGG_RADIOS = 3;
export const EGG_SONG_TICKS = 70 * TICK_RATE;
export const EGG_SONG = 1;
export const EGG_PART_A = 2;
export const EGG_PART_B = 4;
export const EGG_PART_C = 8;
export const EGG_BUILT = 16;
export const EGG_PART_NAMES = ["el núcleo", "la bobina", "el gatillo"] as const;
/** La caja ofrece la pieza con este "arma". */
export const BOX_PART_ITEM = -5;
/** La Thunder Gun: hasta dónde llega el soplido y qué tan ancho (coseno del medio ángulo). */
export const THUNDER_RANGE = 9;
export const THUNDER_COS = 0.82;
