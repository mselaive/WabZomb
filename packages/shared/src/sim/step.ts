import { ACT_GRENADE, ACT_NONE, EGG_READY, EGG_FURNACE, EGG_SONG, EGG_SOULS, FALL_DAMAGE_PER_MS, FALL_SAFE_SPEED, MAX_HP, SOUL_RANGE, START_POINTS, TRAIL_LENGTH } from "../constants.js";
import type { Box, GameMap } from "../map/types.js";
import { M1911 } from "../weapons.js";
import { applySlotAction, damagePlayer, recordTrail, resolveMelee, resolveShot, shotRewind, stepMelee, stepWeaponState, tryThrow } from "./combat.js";
import { throwGrenade, stepGrenades } from "./grenade.js";
import { stepMachines, stepUse } from "./interact.js";
import { collisionBoxes, stepPlayerMovement } from "./movement.js";
import { stepPowerUps } from "./powerups.js";
import { stepPlayerStatus, stepRound } from "./rounds.js";
import type { GameState, PlayerInput, PlayerState, SimEvent } from "./types.js";
import { stepZombies } from "./zombies.js";

export function createPlayer(id: number): PlayerState {
  return {
    id,
    alive: false,
    down: false,
    bleedTicks: 0,
    reviveTicks: 0,
    reviveBy: -1,
    selfRevive: false,
    connected: true,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    onGround: true,
    crouch: 0,
    hp: MAX_HP,
    maxHp: MAX_HP,
    regenAt: 0,
    tagged: 0,
    fallImpact: 0,
    invulnTicks: 0,
    drinkTicks: 0,
    slots: [M1911, -1, -1],
    ammo: [8, 0, 0],
    reserve: [80, 0, 0],
    pap: [0, 0, 0],
    active: 0,
    grenades: 2,
    perks: 0,
    quickRevives: 0,
    fireCd: 0,
    reloadCd: 0,
    drawCd: 0,
    meleeCd: 0,
    reloading: false,
    recoil: 0,
    recoilCool: 0,
    shootHeld: false,
    useHeld: false,
    useTicks: 0,
    scoped: false,
    points: START_POINTS,
    kills: 0,
    headshots: 0,
    downs: 0,
    revives: 0,
    boardsPaid: 0,
    trail: new Array<number>(TRAIL_LENGTH * 3).fill(0),
    lastSeq: 0,
    diedAtTick: -1,
  };
}

export function createGameState(): GameState {
  return {
    tick: 0,
    phase: "lobby",
    phaseTicksLeft: 0,
    players: [],
    zombies: [],
    nextZombieId: 1,
    grenades: [],
    nextGrenadeId: 1,
    powerUps: [],
    nextPowerUpId: 1,
    round: { number: 0, phase: "intermission", ticksLeft: 0, total: 0, spawned: 0, killed: 0, nextSpawnAt: 0, powerUps: 0 },
    doorsOpen: 0,
    boards: [],
    power: false,
    box: { spot: 0, phase: 0, ticksLeft: 0, weapon: -1, forId: -1, uses: 0 },
    pap: { phase: 0, ticksLeft: 0, weapon: -1, forId: -1 },
    instaKill: 0,
    doublePoints: 0,
    fireSale: 0,
    radios: 0,
    songTicks: 0,
    egg: 0,
    eggSouls: 0,
    eggTicks: 0,
    reachedRound: 0,
    seed: 1,
    mapIndex: 0,
  };
}

export function findPlayer(state: GameState, id: number): PlayerState | undefined {
  for (const p of state.players) if (p.id === id) return p;
  return undefined;
}

/** ¿Se puede caminar y disparar? Siempre que la partida esté en curso. */
export function canAct(state: GameState): boolean {
  return state.phase === "playing";
}

/**
 * Lo que un input hace en el servidor con un jugador: moverse, usar, la
 * acción puntual, el arma y, si disparó, el tiro contra los zombis.
 */
function stepPlayerInput(state: GameState, p: PlayerState, input: PlayerInput, map: GameMap, boxes: readonly Box[], events: SimEvent[]): void {
  p.lastSeq = input.seq;
  const acting = canAct(state);
  stepPlayerMovement(p, input, boxes, acting);
  if (!p.alive) return;
  if (p.fallImpact > FALL_SAFE_SPEED) {
    const dmg = Math.round((p.fallImpact - FALL_SAFE_SPEED) * FALL_DAMAGE_PER_MS);
    damagePlayer(state, p, dmg, -1, events);
    if (!p.alive) return;
  }
  stepUse(state, p, input, map, events);

  if (input.act !== ACT_NONE && !p.down) {
    if (input.act === ACT_GRENADE) {
      if (tryThrow(p, acting)) throwGrenade(state, p, events, input.seq);
    } else applySlotAction(p, input.act);
  }

  if (stepMelee(p, input, acting)) resolveMelee(state, p, input.seq, events);

  // Caído también se dispara (con la pistola, como en el original): es la única defensa.
  const wasReloading = p.reloading;
  const fired = stepWeaponState(p, input, acting);
  if (!wasReloading && p.reloading) events.push({ t: "reload", byId: p.id, x: p.x, y: p.y, z: p.z });
  if (fired >= 0) resolveShot(state, p, fired, input.seq, shotRewind(state.tick, input.view), boxes, events);
}

/**
 * El tick autoritativo. `inputs` trae, por jugador, los inputs a procesar en
 * este tick (ninguno, uno o dos), cada uno exactamente una vez y en orden.
 */
export function step(state: GameState, inputs: ReadonlyMap<number, PlayerInput[]>, events: SimEvent[], map: GameMap): void {
  state.tick++;

  if (state.phase === "countdown" || state.phase === "ended") {
    state.phaseTicksLeft--;
    return;
  }
  if (state.phase !== "playing") return;

  const boxes = collisionBoxes(state, map);
  const eventsBefore = events.length;
  for (const p of state.players) {
    if (!p.connected) continue;
    const batch = inputs.get(p.id);
    if (!batch) continue;
    for (const input of batch) stepPlayerInput(state, p, input, map, boxes, events);
  }

  stepGrenades(state, boxes, events);
  stepZombies(state, map, boxes, events);
  stepPowerUps(state, events);
  stepMachines(state, map, events);
  stepPlayerStatus(state, events, boxes);

  for (const p of state.players) if (p.alive) recordTrail(p, state.tick);

  stepSouls(state, map, events, eventsBefore);
  stepSiege(state, events);
  stepRound(state, map, events);
}

/** El asedio de la fuga: mientras dura no hay descanso entre rondas ni se acaban los zombis. */
function stepSiege(state: GameState, events: SimEvent[]): void {
  if (state.eggTicks <= 0) return;
  const r = state.round;
  if (r.phase !== "live") {
    r.phase = "live";
    r.spawned = 0;
    r.killed = 0;
    r.total = 8;
    r.nextSpawnAt = state.tick;
    events.push({ t: "round", phase: "live", number: r.number });
  }
  r.total = Math.max(r.total, r.spawned + 6);
  if (--state.eggTicks > 0) return;
  // Se abrió la niebla: los que están en pie son los últimos.
  r.total = r.spawned;
  state.egg |= EGG_READY;
  events.push({ t: "egg", byId: -1, step: 32 });
}

/**
 * El horno junta almas: cada zombi que alguien mata a menos de SOUL_RANGE de
 * él cuenta uno (después de las radios). Lleno, escupe el gatillo.
 */
function stepSouls(state: GameState, map: GameMap, events: SimEvent[], from: number): void {
  if ((state.egg & EGG_SONG) === 0 || (state.egg & EGG_FURNACE) !== 0) return;
  const n = events.length;
  for (let i = from; i < n; i++) {
    const e = events[i]!;
    if (e.t !== "zkill" || e.byId < 0) continue;
    if (Math.hypot(e.x - map.furnace.x, e.z - map.furnace.z) > SOUL_RANGE || Math.abs(e.y - (map.furnace.y ?? 0)) > 3) continue;
    state.eggSouls++;
    events.push({ t: "egg", byId: e.byId, step: 4, souls: state.eggSouls });
    if (state.eggSouls >= EGG_SOULS) {
      state.egg |= EGG_FURNACE;
      events.push({ t: "egg", byId: e.byId, step: 5 });
      return;
    }
  }
}
