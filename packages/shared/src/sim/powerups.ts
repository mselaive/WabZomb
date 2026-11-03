import { ZTYPE_BOSS } from "../constants.js";
import {
  BOARD_MAX,
  CARPENTER_POINTS,
  FRAG_MAX,
  NUKE_POINTS,
  POWERUP_CARPENTER,
  POWERUP_DOUBLE,
  POWERUP_EFFECT_TICKS,
  POWERUP_FIRE_SALE,
  POWERUP_INSTA,
  POWERUP_LIFE_TICKS,
  POWERUP_MAX_AMMO,
  POWERUP_NUKE,
  POWERUP_RADIUS,
} from "../constants.js";
import { SLOT_COUNT, weaponStats } from "../weapons.js";
import type { GameState, PlayerState, SimEvent } from "./types.js";

/** Con qué peso sale cada uno. Carpenter sólo si falta alguna tabla; Fire Sale sólo con la caja ya usada. */
function pickKind(state: GameState, rng: () => number): number {
  const weights = [25, 22, 22, 15, 0, 0];
  if (state.boards.some((b) => b < BOARD_MAX)) weights[POWERUP_CARPENTER] = 10;
  if (state.box.uses > 0 || state.fireSale === 0) weights[POWERUP_FIRE_SALE] = 6;
  const total = weights.reduce((a, b) => a + b, 0);
  let u = rng() * total;
  for (let k = 0; k < weights.length; k++) {
    u -= weights[k]!;
    if (u <= 0) return k;
  }
  return POWERUP_MAX_AMMO;
}

export function dropPowerUp(state: GameState, x: number, y: number, z: number, rng: () => number, events: SimEvent[]): void {
  const kind = pickKind(state, rng);
  const id = state.nextPowerUpId++;
  state.powerUps.push({ id, kind, x, y, z, ticksLeft: POWERUP_LIFE_TICKS });
  state.round.powerUps++;
  events.push({ t: "powerup", what: "drop", id, kind, byId: -1, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 });
}

/** Munición llena para todos (la del cargador no: hay que recargar, como en el original). */
export function maxAmmo(state: GameState): void {
  for (const p of state.players) {
    if (!p.connected) continue;
    for (let s = 0; s < SLOT_COUNT; s++) {
      const wid = p.slots[s] ?? -1;
      if (wid < 0) continue;
      p.reserve[s] = weaponStats(wid, (p.pap[s] ?? 0) === 1).reserve;
    }
    p.grenades = FRAG_MAX;
  }
}

export function applyPowerUp(state: GameState, kind: number, by: PlayerState, events: SimEvent[]): void {
  const alive = state.players.filter((p) => p.connected && p.alive);
  switch (kind) {
    case POWERUP_MAX_AMMO:
      maxAmmo(state);
      break;
    case POWERUP_INSTA:
      state.instaKill = POWERUP_EFFECT_TICKS;
      break;
    case POWERUP_DOUBLE:
      state.doublePoints = POWERUP_EFFECT_TICKS;
      break;
    case POWERUP_NUKE: {
      // Mueren todos los que están: cuentan para la ronda, no para nadie.
      for (const z of state.zombies.slice()) {
        // El alcaide no se va con una bomba.
        if (z.type === ZTYPE_BOSS) continue;
        events.push({ t: "zkill", zombieId: z.id, byId: -1, weapon: -1, headshot: false, x: Math.round(z.x * 100) / 100, y: Math.round(z.y * 100) / 100, z: Math.round(z.z * 100) / 100 });
        state.round.killed++;
      }
      state.zombies = state.zombies.filter((z) => z.type === ZTYPE_BOSS);
      for (const p of alive) {
        p.points += state.doublePoints > 0 ? NUKE_POINTS * 2 : NUKE_POINTS;
        events.push({ t: "points", id: p.id, amount: state.doublePoints > 0 ? NUKE_POINTS * 2 : NUKE_POINTS, x: p.x, y: p.y + 1.5, z: p.z });
      }
      break;
    }
    case POWERUP_CARPENTER:
      for (let i = 0; i < state.boards.length; i++) {
        if (state.boards[i]! < BOARD_MAX) {
          state.boards[i] = BOARD_MAX;
          events.push({ t: "board", barrier: i, boards: BOARD_MAX, byId: -1 });
        }
      }
      for (const p of alive) {
        p.points += state.doublePoints > 0 ? CARPENTER_POINTS * 2 : CARPENTER_POINTS;
        events.push({ t: "points", id: p.id, amount: state.doublePoints > 0 ? CARPENTER_POINTS * 2 : CARPENTER_POINTS, x: p.x, y: p.y + 1.5, z: p.z });
      }
      break;
    case POWERUP_FIRE_SALE:
      state.fireSale = POWERUP_EFFECT_TICKS;
      break;
  }
  void by;
}

/** Un tick de los power-ups: se agarran pasando por encima, y los que nadie agarra se van. */
export function stepPowerUps(state: GameState, events: SimEvent[]): void {
  if (state.instaKill > 0) state.instaKill--;
  if (state.doublePoints > 0) state.doublePoints--;
  if (state.fireSale > 0) state.fireSale--;
  for (let i = state.powerUps.length - 1; i >= 0; i--) {
    const pu = state.powerUps[i]!;
    let taker: PlayerState | null = null;
    for (const p of state.players) {
      if (!p.connected || !p.alive || p.down) continue;
      if (Math.hypot(p.x - pu.x, p.z - pu.z) <= POWERUP_RADIUS && Math.abs(p.y - pu.y) < 1.5) {
        taker = p;
        break;
      }
    }
    if (taker) {
      state.powerUps.splice(i, 1);
      applyPowerUp(state, pu.kind, taker, events);
      events.push({ t: "powerup", what: "take", id: pu.id, kind: pu.kind, byId: taker.id, x: pu.x, y: pu.y, z: pu.z });
      continue;
    }
    if (--pu.ticksLeft <= 0) {
      state.powerUps.splice(i, 1);
      events.push({ t: "powerup", what: "gone", id: pu.id, kind: pu.kind, byId: -1, x: pu.x, y: pu.y, z: pu.z });
    }
  }
}
