import { REVIVE_TICKS } from "../constants.js";
import type { GameState, GrenadeState, PlayerState, PowerUpState, ZombieState } from "../sim/types.js";
import {
  FLAG_ALIVE,
  FLAG_CONNECTED,
  FLAG_DOWN,
  FLAG_ON_GROUND,
  FLAG_RELOADING,
  FLAG_SCOPED,
  FLAG_SELF_REVIVE,
  FLAG_SHOOT_HELD,
  FLAG_USE_HELD,
  SP_ACTIVE,
  SP_BLEED,
  SP_CROUCH,
  SP_FLAGS,
  SP_HP,
  SP_ID,
  SP_LAST_SEQ,
  SP_MAXHP,
  SP_OWN,
  SP_PERKS,
  SP_PITCH,
  SP_POINTS,
  SP_REVIVE,
  SP_SLOTS,
  SP_VX,
  SP_VZ,
  SP_X,
  SP_Y,
  SP_YAW,
  SP_Z,
  type ClientMsg,
  type ServerMsg,
  type SnapBox,
  type SnapGrenade,
  type SnapPap,
  type SnapPlayer,
  type SnapPowerUp,
  type SnapRound,
  type SnapStanding,
  type SnapZombie,
} from "./messages.js";

/**
 * Toda la (de)serialización pasa por acá. Hoy es JSON: Cloudflare cobra por
 * CANTIDAD de mensajes, no por tamaño, así que JSON no cuesta plata.
 */

const P = 100;
const A = 1000;

export const packAngle = (rad: number): number => Math.round(rad * A);
export const unpackAngle = (mrad: number): number => mrad / A;

export function encodeClient(msg: ClientMsg): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const v = JSON.parse(raw) as ClientMsg;
    return v && typeof v === "object" && typeof v.t === "string" ? v : null;
  } catch {
    return null;
  }
}

export function encodeServer(msg: ServerMsg): string {
  return JSON.stringify(msg);
}

export function decodeServer(raw: string): ServerMsg | null {
  try {
    const v = JSON.parse(raw) as ServerMsg;
    return v && typeof v === "object" && typeof v.t === "string" ? v : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ snapshots

const SLOT_BASE = 64;

export function packPlayer(p: PlayerState, own: boolean): SnapPlayer {
  let flags = 0;
  if (p.alive) flags |= FLAG_ALIVE;
  if (p.connected) flags |= FLAG_CONNECTED;
  if (p.down) flags |= FLAG_DOWN;
  if (p.scoped) flags |= FLAG_SCOPED;
  if (p.reloading) flags |= FLAG_RELOADING;
  if (p.onGround) flags |= FLAG_ON_GROUND;
  if (p.shootHeld) flags |= FLAG_SHOOT_HELD;
  if (p.useHeld) flags |= FLAG_USE_HELD;
  if (p.selfRevive) flags |= FLAG_SELF_REVIVE;
  const out: SnapPlayer = [
    p.id,
    Math.round(p.x * P),
    Math.round(p.y * P),
    Math.round(p.z * P),
    packAngle(p.yaw),
    packAngle(p.pitch),
    Math.ceil(p.hp),
    p.maxHp,
    flags,
    p.slots[p.active] ?? -1,
    (p.slots[0] ?? -1) + 1 + ((p.slots[1] ?? -1) + 1) * SLOT_BASE + ((p.slots[2] ?? -1) + 1) * SLOT_BASE * SLOT_BASE,
    p.lastSeq,
    p.crouch,
    Math.round(p.vx * P),
    Math.round(p.vz * P),
    p.points,
    p.perks,
    Math.round((Math.min(REVIVE_TICKS, p.reviveTicks) / REVIVE_TICKS) * 100),
    p.bleedTicks,
  ];
  if (own) {
    out.push(
      p.ammo[0] ?? 0,
      p.reserve[0] ?? 0,
      p.ammo[1] ?? 0,
      p.reserve[1] ?? 0,
      p.ammo[2] ?? 0,
      p.reserve[2] ?? 0,
      (p.pap[0] ?? 0) + (p.pap[1] ?? 0) * 2 + (p.pap[2] ?? 0) * 4,
      p.fireCd,
      p.reloadCd,
      p.drawCd,
      p.recoil,
      Math.round(p.vy * P),
      p.grenades,
      p.tagged,
      p.meleeCd,
      p.quickRevives,
      p.invulnTicks,
      p.drinkTicks,
    );
  }
  return out;
}

export interface UnpackedPlayer {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  connected: boolean;
  down: boolean;
  scoped: boolean;
  reloading: boolean;
  onGround: boolean;
  shootHeld: boolean;
  useHeld: boolean;
  selfRevive: boolean;
  /** Id del arma en la mano, o -1. */
  weapon: number;
  slots: [number, number, number];
  active: number;
  lastSeq: number;
  crouch: number;
  vx: number;
  vz: number;
  points: number;
  perks: number;
  /** Progreso de la revivida (0 a 1) y ticks que le quedan caído. */
  revive: number;
  bleed: number;
  own: {
    ammo: [number, number, number];
    reserve: [number, number, number];
    pap: [number, number, number];
    fireCd: number;
    reloadCd: number;
    drawCd: number;
    recoil: number;
    vy: number;
    grenades: number;
    tagged: number;
    meleeCd: number;
    quickRevives: number;
    invulnTicks: number;
    drinkTicks: number;
  } | null;
}

export function unpackPlayer(t: SnapPlayer): UnpackedPlayer {
  const flags = t[SP_FLAGS] ?? 0;
  const packed = t[SP_SLOTS] ?? 0;
  const s0 = (packed % SLOT_BASE) - 1;
  const s1 = (Math.floor(packed / SLOT_BASE) % SLOT_BASE) - 1;
  const s2 = Math.floor(packed / (SLOT_BASE * SLOT_BASE)) - 1;
  const weapon = t[SP_ACTIVE] ?? -1;
  const slots: [number, number, number] = [s0, s1, s2];
  let active = slots.indexOf(weapon);
  if (active < 0) active = 0;
  const papBits = t[SP_OWN + 6] ?? 0;
  const own =
    t.length > SP_OWN
      ? {
          ammo: [t[SP_OWN] ?? 0, t[SP_OWN + 2] ?? 0, t[SP_OWN + 4] ?? 0] as [number, number, number],
          reserve: [t[SP_OWN + 1] ?? 0, t[SP_OWN + 3] ?? 0, t[SP_OWN + 5] ?? 0] as [number, number, number],
          pap: [papBits & 1, (papBits >> 1) & 1, (papBits >> 2) & 1] as [number, number, number],
          fireCd: t[SP_OWN + 7] ?? 0,
          reloadCd: t[SP_OWN + 8] ?? 0,
          drawCd: t[SP_OWN + 9] ?? 0,
          recoil: t[SP_OWN + 10] ?? 0,
          vy: (t[SP_OWN + 11] ?? 0) / P,
          grenades: t[SP_OWN + 12] ?? 0,
          tagged: t[SP_OWN + 13] ?? 0,
          meleeCd: t[SP_OWN + 14] ?? 0,
          quickRevives: t[SP_OWN + 15] ?? 0,
          invulnTicks: t[SP_OWN + 16] ?? 0,
          drinkTicks: t[SP_OWN + 17] ?? 0,
        }
      : null;
  return {
    id: t[SP_ID] ?? 0,
    x: (t[SP_X] ?? 0) / P,
    y: (t[SP_Y] ?? 0) / P,
    z: (t[SP_Z] ?? 0) / P,
    yaw: unpackAngle(t[SP_YAW] ?? 0),
    pitch: unpackAngle(t[SP_PITCH] ?? 0),
    hp: t[SP_HP] ?? 0,
    maxHp: t[SP_MAXHP] ?? 100,
    alive: (flags & FLAG_ALIVE) !== 0,
    connected: (flags & FLAG_CONNECTED) !== 0,
    down: (flags & FLAG_DOWN) !== 0,
    scoped: (flags & FLAG_SCOPED) !== 0,
    reloading: (flags & FLAG_RELOADING) !== 0,
    onGround: (flags & FLAG_ON_GROUND) !== 0,
    shootHeld: (flags & FLAG_SHOOT_HELD) !== 0,
    useHeld: (flags & FLAG_USE_HELD) !== 0,
    selfRevive: (flags & FLAG_SELF_REVIVE) !== 0,
    weapon,
    slots,
    active,
    lastSeq: t[SP_LAST_SEQ] ?? 0,
    crouch: t[SP_CROUCH] ?? 0,
    vx: (t[SP_VX] ?? 0) / P,
    vz: (t[SP_VZ] ?? 0) / P,
    points: t[SP_POINTS] ?? 0,
    perks: t[SP_PERKS] ?? 0,
    revive: (t[SP_REVIVE] ?? 0) / 100,
    bleed: t[SP_BLEED] ?? 0,
    own,
  };
}

export function packZombie(z: ZombieState): SnapZombie {
  return [
    z.id,
    z.type,
    Math.round(z.x * P),
    Math.round(z.y * P),
    Math.round(z.z * P),
    packAngle(z.yaw),
    z.state,
    z.stateTicks,
    Math.max(0, Math.min(100, Math.round((z.hp / z.maxHp) * 100))),
    Math.round(z.vx * P),
    Math.round(z.vz * P),
  ];
}

export interface UnpackedZombie {
  id: number;
  type: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: number;
  stateTicks: number;
  /** 0 a 1. */
  hp: number;
  vx: number;
  vz: number;
}

export function unpackZombie(t: SnapZombie): UnpackedZombie {
  return { id: t[0], type: t[1], x: t[2] / P, y: t[3] / P, z: t[4] / P, yaw: unpackAngle(t[5]), state: t[6], stateTicks: t[7], hp: t[8] / 100, vx: t[9] / P, vz: t[10] / P };
}

export function packGrenade(g: GrenadeState): SnapGrenade {
  return [g.id, Math.round(g.x * P), Math.round(g.y * P), Math.round(g.z * P), Math.round(g.vx * P), Math.round(g.vy * P), Math.round(g.vz * P)];
}

export interface UnpackedGrenade {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export function unpackGrenade(t: SnapGrenade): UnpackedGrenade {
  return { id: t[0], x: t[1] / P, y: t[2] / P, z: t[3] / P, vx: t[4] / P, vy: t[5] / P, vz: t[6] / P };
}

export function packPowerUp(p: PowerUpState): SnapPowerUp {
  return [p.id, p.kind, Math.round(p.x * P), Math.round(p.y * P), Math.round(p.z * P), p.ticksLeft];
}

export function unpackPowerUp(t: SnapPowerUp): PowerUpState {
  return { id: t[0], kind: t[1], x: t[2] / P, y: t[3] / P, z: t[4] / P, ticksLeft: t[5] };
}

export function packRound(state: GameState): SnapRound {
  const r = state.round;
  return [r.number, r.phase === "intermission" ? 0 : r.phase === "live" ? 1 : 2, r.ticksLeft, r.total, r.spawned, r.killed];
}

export interface UnpackedRound {
  number: number;
  phase: "intermission" | "live" | "over";
  ticksLeft: number;
  total: number;
  spawned: number;
  killed: number;
}

export function unpackRound(t: SnapRound): UnpackedRound {
  return { number: t[0], phase: t[1] === 0 ? "intermission" : t[1] === 1 ? "live" : "over", ticksLeft: t[2], total: t[3], spawned: t[4], killed: t[5] };
}

export function packBox(state: GameState): SnapBox {
  const b = state.box;
  return [b.spot, b.phase, b.ticksLeft, b.weapon, b.forId, b.uses];
}

export function unpackBox(t: SnapBox): GameState["box"] {
  return { spot: t[0], phase: t[1], ticksLeft: t[2], weapon: t[3], forId: t[4], uses: t[5] };
}

export function packPap(state: GameState): SnapPap {
  const p = state.pap;
  return [p.phase, p.ticksLeft, p.weapon, p.forId];
}

export function unpackPap(t: SnapPap): GameState["pap"] {
  return { phase: t[0], ticksLeft: t[1], weapon: t[2], forId: t[3] };
}

/** La tabla: los que están. */
export function packStandings(state: GameState): SnapStanding[] {
  return state.players.filter((p) => p.connected).map((p) => [p.id, p.kills, p.headshots, p.downs, p.revives, p.points, p.alive ? 1 : 0]);
}
