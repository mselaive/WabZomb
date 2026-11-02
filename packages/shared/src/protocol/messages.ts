import type { MatchPhase, PlayerMeta, SimEvent } from "../sim/types.js";

/**
 * Contrato cliente/servidor. Los mensajes de control son objetos legibles; los
 * datos "calientes" (snapshots) van como tuplas, que es lo que se manda 20
 * veces por segundo.
 */

// ------------------------------------------------------------ cliente -> servidor

export interface ReadyMsg {
  t: "ready";
  ready: boolean;
}

export interface InputMsg {
  t: "in";
  seq: number;
  f: number;
  s: number;
  /** Yaw y pitch en milirradianes. */
  yaw: number;
  pit: number;
  /** Bits BTN_*. */
  btn: number;
  /** Acción puntual (ACT_*). */
  act: number;
  /** Tick que tenías en pantalla, en décimas. Para la compensación de lag. */
  vt?: number;
}

export interface PingMsg {
  t: "ping";
  c: number;
}

export interface StartMsg {
  t: "start";
}

export interface KickMsg {
  t: "kick";
  id: number;
}

export interface ChatMsg {
  t: "chat";
  text: string;
}

export interface MapMsg {
  t: "map";
  map: number;
}

export type ClientMsg = ReadyMsg | InputMsg | PingMsg | StartMsg | KickMsg | ChatMsg | MapMsg;

// ------------------------------------------------------------ servidor -> cliente

export interface WelcomeMsg {
  t: "welcome";
  you: number;
  room: string;
  hostId: number;
  roster: PlayerMeta[];
  phase: MatchPhase;
  map: number;
}

export interface RosterMsg {
  t: "roster";
  roster: PlayerMeta[];
  hostId: number;
  map: number;
  nextIn?: number;
}

export interface MatchStartMsg {
  t: "start";
  seed: number;
  map: number;
}

/**
 * Un jugador en el snapshot. Posiciones en centímetros, ángulos en
 * milirradianes. Los últimos campos van sólo en la tupla del propio jugador.
 *
 *  0 id, 1 x, 2 y, 3 z, 4 yaw, 5 pitch, 6 hp, 7 maxHp, 8 flags, 9 arma activa
 * (id, -1 nada), 10 ranuras (s0+1 + (s1+1)*32 + (s2+1)*1024), 11 lastSeq,
 * 12 crouch, 13 vx, 14 vz, 15 puntos, 16 perks (bits), 17 revive (0-100 %),
 * 18 bleed (ticks)
 * --- sólo el propio:
 * 19 ammo0, 20 reserve0, 21 ammo1, 22 reserve1, 23 ammo2, 24 reserve2,
 * 25 pap (bits), 26 fireCd, 27 reloadCd, 28 drawCd, 29 recoil, 30 vy (cm/s),
 * 31 granadas, 32 tagged, 33 meleeCd, 34 quickRevives, 35 invulnTicks, 36 drinkTicks
 */
export type SnapPlayer = number[];

export const SP_ID = 0;
export const SP_X = 1;
export const SP_Y = 2;
export const SP_Z = 3;
export const SP_YAW = 4;
export const SP_PITCH = 5;
export const SP_HP = 6;
export const SP_MAXHP = 7;
export const SP_FLAGS = 8;
export const SP_ACTIVE = 9;
export const SP_SLOTS = 10;
export const SP_LAST_SEQ = 11;
export const SP_CROUCH = 12;
export const SP_VX = 13;
export const SP_VZ = 14;
export const SP_POINTS = 15;
export const SP_PERKS = 16;
export const SP_REVIVE = 17;
export const SP_BLEED = 18;
export const SP_OWN = 19;

export const FLAG_ALIVE = 1;
export const FLAG_CONNECTED = 2;
export const FLAG_DOWN = 4;
export const FLAG_SCOPED = 8;
export const FLAG_RELOADING = 16;
export const FLAG_ON_GROUND = 32;
export const FLAG_SHOOT_HELD = 64;
export const FLAG_USE_HELD = 128;
export const FLAG_SELF_REVIVE = 256;

/**
 * Un zombi: [id, tipo, x, y, z (cm), yaw (mrad), estado (Z_*), ticks del estado,
 * vida (0-100 %), vx, vz (cm/s)].
 */
export type SnapZombie = [number, number, number, number, number, number, number, number, number, number, number];

/** [id, x, y, z, vx, vy, vz] (cm y cm/s). */
export type SnapGrenade = [number, number, number, number, number, number, number];

/** [id, tipo, x, y, z, ticks que le quedan]. */
export type SnapPowerUp = [number, number, number, number, number, number];

/**
 * La ronda: [número, fase (0 anunciándose, 1 en curso, 2 terminada), ticks que
 * quedan, zombis totales, salidos, caídos].
 */
export type SnapRound = [number, number, number, number, number, number];

/** La caja: [lugar, fase, ticks, arma, para quién, usos]. */
export type SnapBox = [number, number, number, number, number, number];
/** El Pack-a-Punch: [fase, ticks, arma, para quién]. */
export type SnapPap = [number, number, number, number];

/** [id, kills, headshots, caídas, revividas, puntos, vivo]. Público: es la tabla. */
export type SnapStanding = [number, number, number, number, number, number, number];

export interface SnapshotMsg {
  t: "s";
  tick: number;
  now: number;
  phase: MatchPhase;
  left: number;
  rd: SnapRound;
  players: SnapPlayer[];
  z: SnapZombie[];
  gr?: SnapGrenade[];
  pu?: SnapPowerUp[];
  /** Puertas abiertas (bits), tablas por ventana, luz, caja, Pack-a-Punch. */
  doors: number;
  boards: number[];
  power: number;
  box: SnapBox;
  pap: SnapPap;
  /** Ticks que quedan de Insta-Kill, Double Points, Fire Sale y la canción. */
  fx: [number, number, number, number];
  radios: number;
  /** El easter egg (bits EGG_*) y las almas del horno. */
  egg: number;
  souls: number;
  st: SnapStanding[];
  /** A qué ronda llegaron (cuando terminó). */
  reached: number;
  ev?: SimEvent[];
}

export interface ErrMsg {
  t: "err";
  code: "room_full" | "kicked" | "version" | "bad_request";
  message: string;
}

export interface PongMsg {
  t: "pong";
  c: number;
  s: number;
}

export interface ChatOutMsg {
  t: "chat";
  by: number;
  text: string;
}

export type ServerMsg = WelcomeMsg | RosterMsg | MatchStartMsg | SnapshotMsg | ErrMsg | PongMsg | ChatOutMsg;
