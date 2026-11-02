import {
  BOARD_MAX,
  ENDED_TICKS,
  FRAG_START,
  MAX_HP,
  REGEN_PER_TICK,
  REVIVE_HP,
  ROUND_INTERMISSION_TICKS,
  ROUND_OVER_TICKS,
  START_POINTS,
  TRAIL_LENGTH,
  zombieCount,
} from "../constants.js";
import { mulberry32 } from "../math.js";
import type { Box, GameMap } from "../map/types.js";
import { M1911, weaponStats } from "../weapons.js";
import { resetTrail, revivePlayer } from "./combat.js";
import type { GameState, PlayerState, SimEvent } from "./types.js";

/** Lo de arranque: la pistola, dos granadas, 500 puntos, sin bebidas. */
export function giveStartingKit(p: PlayerState): void {
  const s = weaponStats(M1911, false);
  p.slots = [M1911, -1, -1];
  p.ammo = [s.mag, 0, 0];
  p.reserve = [s.reserve, 0, 0];
  p.pap = [0, 0, 0];
  p.active = 0;
  p.grenades = FRAG_START;
  p.perks = 0;
  p.quickRevives = 0;
  p.maxHp = MAX_HP;
  p.points = START_POINTS;
  p.kills = 0;
  p.headshots = 0;
  p.downs = 0;
  p.revives = 0;
}

/** Vivo, entero y quieto en un punto de aparición. */
export function placeAt(p: PlayerState, s: { x: number; y: number; z: number; yaw: number }): void {
  p.alive = true;
  p.down = false;
  p.selfRevive = false;
  p.bleedTicks = 0;
  p.reviveTicks = 0;
  p.reviveBy = -1;
  p.hp = p.maxHp;
  p.regenAt = 0;
  p.x = s.x;
  p.y = s.y;
  p.z = s.z;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.yaw = s.yaw;
  p.pitch = 0;
  p.onGround = true;
  p.crouch = 0;
  p.fireCd = 0;
  p.reloadCd = 0;
  p.drawCd = 0;
  p.meleeCd = 0;
  p.reloading = false;
  p.recoil = 0;
  p.recoilCool = 0;
  p.scoped = false;
  p.tagged = 0;
  p.fallImpact = 0;
  p.invulnTicks = 0;
  p.drinkTicks = 0;
  p.diedAtTick = -1;
  p.useTicks = 0;
  p.boardsPaid = 0;
  if ((p.slots[p.active] ?? -1) < 0) {
    for (let s2 = 0; s2 < 3; s2++) if ((p.slots[s2] ?? -1) >= 0) p.active = s2;
  }
  resetTrail(p);
}

/** Arranca la partida: todo a cero, puertas cerradas, tablas puestas, luz apagada, ronda 1 anunciándose. */
export function startMatch(state: GameState, seed: number, map: GameMap, events: SimEvent[]): void {
  state.phase = "playing";
  state.phaseTicksLeft = 0;
  state.seed = seed;
  state.rng = mulberry32(seed);
  state.tick = 0;
  state.zombies = [];
  state.grenades = [];
  state.powerUps = [];
  state.doorsOpen = 0;
  state.boards = map.barriers.map(() => BOARD_MAX);
  state.power = false;
  state.box = { spot: 0, phase: 0, ticksLeft: 0, weapon: -1, forId: -1, uses: 0 };
  state.pap = { phase: 0, ticksLeft: 0, weapon: -1, forId: -1 };
  state.instaKill = 0;
  state.doublePoints = 0;
  state.fireSale = 0;
  state.radios = 0;
  state.songTicks = 0;
  state.egg = 0;
  state.eggSouls = 0;
  state.reachedRound = 0;
  // La caja arranca en cualquiera de sus lugares: en cada partida hay que salir a buscarla.
  state.box.spot = Math.floor((state.rng ?? Math.random)() * Math.max(1, map.boxSpots.length));
  state.round = { number: 1, phase: "intermission", ticksLeft: ROUND_INTERMISSION_TICKS, total: 0, spawned: 0, killed: 0, nextSpawnAt: 0, powerUps: 0 };
  const members = state.players.filter((p) => p.connected).sort((a, b) => a.id - b.id);
  members.forEach((p, i) => {
    giveStartingKit(p);
    placeAt(p, map.spawns[i % map.spawns.length]!);
  });
  events.push({ t: "round", phase: "intermission", number: 1 });
}

function connected(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.connected);
}

/** Dónde vuelve un muerto al empezar la ronda: al lado de un compañero vivo, o en su spawn. */
function respawnPoint(state: GameState, map: GameMap, p: PlayerState, index: number): { x: number; y: number; z: number; yaw: number } {
  const mate = state.players.find((q) => q !== p && q.connected && q.alive && !q.down);
  if (mate) return { x: mate.x, y: mate.y, z: mate.z, yaw: mate.yaw };
  return map.spawns[index % map.spawns.length]!;
}

/**
 * Un tick de la máquina de rondas: anuncia, deja que salgan todos y que caigan
 * todos, y pasa a la siguiente. También decide si se terminó la partida.
 */
export function stepRound(state: GameState, map: GameMap, events: SimEvent[]): void {
  const r = state.round;
  const people = connected(state);

  // ¿Se terminó? Nadie de pie, y nadie que se vaya a levantar solo.
  const standing = people.filter((p) => p.alive && !p.down);
  const selfReviving = people.some((p) => p.alive && p.down && p.selfRevive);
  if (people.length > 0 && standing.length === 0 && !selfReviving) {
    state.phase = "ended";
    state.phaseTicksLeft = ENDED_TICKS;
    state.reachedRound = r.number;
    for (const p of state.players) {
      p.alive = false;
      p.down = false;
    }
    events.push({ t: "gameover", round: r.number });
    return;
  }

  if (r.phase === "intermission") {
    if (--r.ticksLeft <= 0) {
      r.phase = "live";
      r.total = zombieCount(r.number, people.length);
      r.spawned = 0;
      r.killed = 0;
      r.nextSpawnAt = state.tick + 20;
      events.push({ t: "round", phase: "live", number: r.number });
    }
    return;
  }
  if (r.phase === "live") {
    if (r.killed >= r.total && state.zombies.length === 0) {
      r.phase = "over";
      r.ticksLeft = ROUND_OVER_TICKS;
      events.push({ t: "round", phase: "over", number: r.number });
    }
    return;
  }
  // over
  if (--r.ticksLeft <= 0) {
    r.number++;
    r.phase = "intermission";
    r.ticksLeft = ROUND_INTERMISSION_TICKS;
    r.powerUps = 0;
    // Los que murieron vuelven, con lo básico; los vivos siguen con lo suyo.
    people.forEach((p, i) => {
      p.boardsPaid = 0;
      if (p.alive) return;
      const had = p.points;
      giveStartingKit(p);
      p.points = had;
      placeAt(p, respawnPoint(state, map, p, i));
    });
    events.push({ t: "round", phase: "intermission", number: r.number });
  }
}

/** Vida que vuelve, caídos que se desangran o se levantan solos, revividas que se cortan. */
export function stepPlayerStatus(state: GameState, events: SimEvent[], boxes: readonly Box[] = []): void {
  for (const p of state.players) {
    if (!p.connected || !p.alive) continue;
    if (p.down) {
      if (p.reviveBy < 0) p.reviveTicks = Math.max(0, p.reviveTicks - 1);
      p.reviveBy = -1;
      if (--p.bleedTicks <= 0) {
        if (p.selfRevive) {
          revivePlayer(state, p, p, REVIVE_HP, events, boxes);
        } else {
          p.alive = false;
          p.down = false;
          p.diedAtTick = state.tick;
          events.push({ t: "bleedout", id: p.id });
        }
      }
      continue;
    }
    if (p.hp < p.maxHp && state.tick >= p.regenAt) p.hp = Math.min(p.maxHp, p.hp + REGEN_PER_TICK);
  }
}

export { TRAIL_LENGTH };
