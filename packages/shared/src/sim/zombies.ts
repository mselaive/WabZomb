import {
  BARRIER_VAULT_TICKS,
  BOARD_TEAR_TICKS,
  TRAIL_LENGTH,
  ZOMBIE_ATTACK_RANGE,
  ZOMBIE_ATTACK_TICKS,
  ZOMBIE_DAMAGE,
  ZOMBIE_HEIGHT,
  ZOMBIE_MAX_ALIVE,
  ZOMBIE_RISE_TICKS,
  ZOMBIE_SPEEDS,
  ZOMBIE_WAIT_RANGE,
  ZOMBIE_WINDUP_TICKS,
  zombieHp,
  zombieSpawnInterval,
  zombieTypeFor,
} from "../constants.js";
import { lerp, wrapAngle } from "../math.js";
import { segmentClear } from "../map/raycast.js";
import { zoneAt, type Box, type GameMap, type Spawner } from "../map/types.js";
import { damagePlayer, recordTrail, resetTrail } from "./combat.js";
import { moveBody, overlapsAny } from "./movement.js";
import { cellsOfBox, findPath, navGridFor, type NavGrid } from "./nav.js";
import { Z_ATTACK, Z_HUNT, Z_OUTSIDE, Z_RISING, Z_TEARING, Z_VAULT, type GameState, type PlayerState, type SimEvent, type ZombieState } from "./types.js";

/** Cada cuántos ticks un zombi recalcula el camino (repartido entre ellos). */
const REPATH_TICKS = 20;
/** Trabado tanto tiempo, se lo manda de vuelta a aparecer. */
const STUCK_RESPAWN_TICKS = 160;
/** Un zombi que lleva esto sin acercarse a nadie (40 s) está trabado en algún rincón: vuelve a la cola y sale por otro lado. */
const LOST_TICKS = 40 * 20;
/** A menos de esto de alguien cuenta como "cerca". */
const ENGAGED_RANGE = 6;

/** Las celdas que tapan las puertas cerradas: por ahí no pasa el A*. */
export function blockedCells(state: GameState, map: GameMap, grid: NavGrid): Set<number> {
  const out = new Set<number>();
  for (const d of map.doors) {
    if ((state.doorsOpen & (1 << d.id)) !== 0) continue;
    for (const c of cellsOfBox(grid, d.box)) out.add(c);
  }
  return out;
}

/** Las zonas a las que se llega desde la de arranque con las puertas abiertas. */
export function openZones(state: Pick<GameState, "doorsOpen">, map: GameMap): Set<number> {
  const open = new Set<number>([map.startZone]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of map.doors) {
      if ((state.doorsOpen & (1 << d.id)) === 0) continue;
      const [a, b] = d.zones;
      if (open.has(a) && !open.has(b)) {
        open.add(b);
        grew = true;
      } else if (open.has(b) && !open.has(a)) {
        open.add(a);
        grew = true;
      }
    }
  }
  return open;
}

/**
 * Dónde pueden aparecer ahora: en zonas abiertas donde hay alguien, o vecinas
 * (por una puerta abierta) de una donde hay alguien. Si no queda ninguna, en
 * cualquier zona abierta.
 */
export function activeSpawners(state: GameState, map: GameMap): Spawner[] {
  const open = openZones(state, map);
  const occupied = new Set<number>();
  for (const p of state.players) {
    if (!p.connected || !p.alive) continue;
    const z = zoneAt(map, p.x, p.z);
    if (z >= 0) occupied.add(z);
  }
  const active = new Set<number>(occupied);
  for (const d of map.doors) {
    if ((state.doorsOpen & (1 << d.id)) === 0) continue;
    const [a, b] = d.zones;
    if (occupied.has(a)) active.add(b);
    if (occupied.has(b)) active.add(a);
  }
  let out = map.spawners.filter((s) => open.has(s.zone) && active.has(s.zone));
  if (out.length === 0) out = map.spawners.filter((s) => open.has(s.zone));
  return out;
}

export function createZombie(state: GameState, s: Spawner, map: GameMap, rng: () => number): ZombieState {
  const r = state.round.number;
  const hp = zombieHp(r);
  const barrier = s.barrier ?? -1;
  const b = barrier >= 0 ? map.barriers[barrier] : undefined;
  const z: ZombieState = {
    id: state.nextZombieId++,
    type: zombieTypeFor(r, rng()),
    hp,
    maxHp: hp,
    x: s.x + (rng() - 0.5) * 0.6,
    y: s.y,
    z: s.z + (rng() - 0.5) * 0.6,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    onGround: true,
    crouch: 0,
    trail: new Array<number>(TRAIL_LENGTH * 3).fill(0),
    state: b ? Z_OUTSIDE : Z_RISING,
    stateTicks: b ? 0 : ZOMBIE_RISE_TICKS,
    barrier,
    target: -1,
    path: [],
    repathAt: 0,
    attackCd: 0,
    stuck: 0,
    lastX: s.x,
    lastZ: s.z,
    engagedAt: state.tick,
    goalX: b ? b.outside.x : s.x,
    goalZ: b ? b.outside.z : s.z,
  };
  resetTrail(z);
  return z;
}

/** Saca zombis mientras la ronda lo pida y haya lugar. */
function spawnZombies(state: GameState, map: GameMap, events: SimEvent[]): void {
  const r = state.round;
  if (r.phase !== "live" || r.spawned >= r.total || state.zombies.length >= ZOMBIE_MAX_ALIVE) return;
  if (state.tick < r.nextSpawnAt) return;
  const rng = state.rng ?? Math.random;
  const spots = activeSpawners(state, map);
  if (spots.length === 0) return;
  const s = spots[Math.floor(rng() * spots.length)]!;
  const z = createZombie(state, s, map, rng);
  state.zombies.push(z);
  r.spawned++;
  r.nextSpawnAt = state.tick + zombieSpawnInterval(r.number);
  if (z.state === Z_RISING) events.push({ t: "zombie", what: "rise", id: z.id, x: z.x, y: z.y, z: z.z });
}

function nearestTarget(state: GameState, z: ZombieState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestD = Infinity;
  // Primero los que están de pie; si no queda ninguno, los caídos.
  for (const pass of [0, 1]) {
    for (const p of state.players) {
      if (!p.connected || !p.alive) continue;
      if (pass === 0 ? p.down : !p.down) continue;
      const d = Math.hypot(p.x - z.x, p.z - z.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) return best;
  }
  return null;
}

/** Los zombis se empujan entre ellos un poco, para no caminar uno adentro del otro. */
function separate(zombies: ZombieState[]): void {
  const n = zombies.length;
  for (let i = 0; i < n; i++) {
    const a = zombies[i]!;
    if (a.state === Z_OUTSIDE || a.state === Z_VAULT || a.state === Z_TEARING) continue;
    for (let j = i + 1; j < n; j++) {
      const b = zombies[j]!;
      if (b.state === Z_OUTSIDE || b.state === Z_VAULT || b.state === Z_TEARING) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0.36 || d2 < 1e-6 || Math.abs(a.y - b.y) > 1) continue;
      const d = Math.sqrt(d2);
      const push = (0.6 - d) * 0.25;
      const nx = dx / d;
      const nz = dz / d;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
    }
  }
}

function faceToward(z: ZombieState, x: number, zz: number, k = 0.35): void {
  const want = Math.atan2(-(x - z.x), -(zz - z.z));
  z.yaw = wrapAngle(z.yaw + wrapAngle(want - z.yaw) * k);
}

function stepOne(state: GameState, z: ZombieState, map: GameMap, boxes: readonly Box[], grid: NavGrid, blocked: ReadonlySet<number>, events: SimEvent[]): boolean {
  const speed = ZOMBIE_SPEEDS[z.type] ?? ZOMBIE_SPEEDS[0];
  // Perdido: en cualquier estado, si hace 40 s que no se acerca a nadie, se lo recicla.
  for (const p of state.players) {
    if (p.connected && p.alive && Math.hypot(p.x - z.x, p.z - z.z) < ENGAGED_RANGE) z.engagedAt = state.tick;
  }
  if (state.tick - z.engagedAt > LOST_TICKS) return false;
  if (z.attackCd > 0) z.attackCd--;

  switch (z.state) {
    case Z_RISING: {
      if (--z.stateTicks <= 0) z.state = Z_HUNT;
      const t = nearestTarget(state, z);
      if (t) faceToward(z, t.x, t.z, 0.2);
      return true;
    }
    case Z_OUTSIDE: {
      const dx = z.goalX - z.x;
      const dz = z.goalZ - z.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.45) {
        z.vx = 0;
        z.vz = 0;
        const boards = state.boards[z.barrier] ?? 0;
        if (boards > 0) {
          z.state = Z_TEARING;
          z.stateTicks = BOARD_TEAR_TICKS;
        } else {
          z.state = Z_VAULT;
          z.stateTicks = BARRIER_VAULT_TICKS;
          events.push({ t: "zombie", what: "vault", id: z.id, x: z.x, y: z.y, z: z.z });
        }
        return true;
      }
      faceToward(z, z.goalX, z.goalZ);
      moveBody(z, dx / d, dz / d, speed, false, ZOMBIE_HEIGHT, boxes);
      return true;
    }
    case Z_TEARING: {
      const b = map.barriers[z.barrier]!;
      faceToward(z, b.inside.x, b.inside.z);
      moveBody(z, 0, 0, 0, false, ZOMBIE_HEIGHT, boxes);
      if (--z.stateTicks > 0) return true;
      const boards = state.boards[z.barrier] ?? 0;
      if (boards > 0) {
        state.boards[z.barrier] = boards - 1;
        events.push({ t: "board", barrier: z.barrier, boards: boards - 1, byId: -1 });
        events.push({ t: "zombie", what: "tear", id: z.id, x: z.x, y: z.y, z: z.z });
      }
      if ((state.boards[z.barrier] ?? 0) > 0) {
        z.stateTicks = BOARD_TEAR_TICKS;
      } else {
        z.state = Z_VAULT;
        z.stateTicks = BARRIER_VAULT_TICKS;
        events.push({ t: "zombie", what: "vault", id: z.id, x: z.x, y: z.y, z: z.z });
      }
      return true;
    }
    case Z_VAULT: {
      const b = map.barriers[z.barrier]!;
      z.stateTicks--;
      const k = 1 - z.stateTicks / BARRIER_VAULT_TICKS;
      z.x = lerp(b.outside.x, b.inside.x, k);
      z.z = lerp(b.outside.z, b.inside.z, k);
      z.y = Math.sin(Math.PI * Math.min(1, k)) * 0.9;
      z.vx = 0;
      z.vy = 0;
      z.vz = 0;
      faceToward(z, b.inside.x, b.inside.z, 0.5);
      if (z.stateTicks <= 0) {
        z.y = 0;
        z.onGround = true;
        z.state = Z_HUNT;
        z.repathAt = 0;
      }
      return true;
    }
    case Z_ATTACK: {
      moveBody(z, 0, 0, 0, false, ZOMBIE_HEIGHT, boxes);
      const t = state.players.find((p) => p.id === z.target);
      if (t) faceToward(z, t.x, t.z, 0.5);
      if (--z.stateTicks > 0) return true;
      if (t && t.alive && Math.hypot(t.x - z.x, t.z - z.z) <= ZOMBIE_ATTACK_RANGE * 1.3 && Math.abs(t.y - z.y) < 1.4) {
        damagePlayer(state, t, ZOMBIE_DAMAGE, z.id, events);
      }
      z.attackCd = ZOMBIE_ATTACK_TICKS;
      z.state = Z_HUNT;
      return true;
    }
    default: {
      // Z_HUNT: elegir a quién, ir, pegar.
      const t = nearestTarget(state, z);
      if (!t) {
        moveBody(z, 0, 0, 0, false, ZOMBIE_HEIGHT, boxes);
        return true;
      }
      if (t.id !== z.target) {
        z.target = t.id;
        z.path = [];
        z.repathAt = 0;
      }
      const dxT = t.x - z.x;
      const dzT = t.z - z.z;
      const dT = Math.hypot(dxT, dzT);
      // Un caído que es lo único que queda: lo rodean a distancia y esperan, sin pegarle.
      if (t.down && dT <= ZOMBIE_WAIT_RANGE) {
        faceToward(z, t.x, t.z, 0.3);
        moveBody(z, 0, 0, 0, false, ZOMBIE_HEIGHT, boxes);
        return true;
      }
      if (!t.down && dT <= ZOMBIE_ATTACK_RANGE && Math.abs(t.y - z.y) < 1.4 && z.attackCd === 0) {
        z.state = Z_ATTACK;
        z.stateTicks = ZOMBIE_WINDUP_TICKS;
        z.vx = 0;
        z.vz = 0;
        return true;
      }
      // Cerca y a la vista: derecho, sin la grilla.
      const direct = dT < 4 && Math.abs(t.y - z.y) < 1 && segmentClear(z.x, z.y + 1, z.z, t.x, t.y + 1, t.z, boxes);
      let wx = 0;
      let wz = 0;
      if (direct) {
        wx = dxT / dT;
        wz = dzT / dT;
        z.path = [];
      } else {
        if (z.path.length === 0 || state.tick >= z.repathAt) {
          z.path = findPath(grid, z.x, z.z, t.x, t.z, z.y, t.y, blocked) ?? [];
          z.repathAt = state.tick + REPATH_TICKS + (z.id % 7);
          if (z.path.length === 0) {
            // Sin camino (el otro está en una zona cerrada, raro): hacia él igual.
            wx = dxT / dT;
            wz = dzT / dT;
          }
        }
        while (z.path.length > 0 && Math.hypot(z.path[0]!.x - z.x, z.path[0]!.z - z.z) < 0.4 && Math.abs(z.path[0]!.y - z.y) < 1) z.path.shift();
        const next = z.path[0];
        if (next) {
          const dx = next.x - z.x;
          const dz = next.z - z.z;
          const d = Math.hypot(dx, dz);
          wx = dx / d;
          wz = dz / d;
        }
      }
      if (wx !== 0 || wz !== 0) faceToward(z, z.x + wx, z.z + wz);
      moveBody(z, wx, wz, speed, false, ZOMBIE_HEIGHT, boxes);

      // Trabado: recalcular; mucho tiempo trabado, volver a aparecer.
      const moved = Math.hypot(z.x - z.lastX, z.z - z.lastZ);
      z.lastX = z.x;
      z.lastZ = z.z;
      z.stuck = moved < 0.02 && dT > ZOMBIE_ATTACK_RANGE ? z.stuck + 1 : 0;
      if (z.stuck === 25) {
        z.path = [];
        z.repathAt = 0;
        // Un empujón de costado por si quedó contra una esquina.
        const sx = -wz * 0.3;
        const sz = wx * 0.3;
        if (!overlapsAny(z.x + sx, z.y, z.z + sz, ZOMBIE_HEIGHT, boxes)) {
          z.x += sx;
          z.z += sz;
        }
      }
      if (z.stuck > STUCK_RESPAWN_TICKS) return false;
      return true;
    }
  }
}

/** Un tick de todos los zombis: aparecen, caminan, arrancan tablas, pegan. */
export function stepZombies(state: GameState, map: GameMap, boxes: readonly Box[], events: SimEvent[]): void {
  spawnZombies(state, map, events);
  if (state.zombies.length === 0) return;
  const grid = navGridFor(map);
  const blocked = blockedCells(state, map, grid);
  for (let i = state.zombies.length - 1; i >= 0; i--) {
    const z = state.zombies[i]!;
    const keep = stepOne(state, z, map, boxes, grid, blocked, events);
    if (!keep) {
      // Vuelve a la cola: se lo saca y la ronda lo vuelve a sacar por otro lado.
      state.zombies.splice(i, 1);
      state.round.spawned--;
    }
  }
  separate(state.zombies);
  for (const z of state.zombies) recordTrail(z, state.tick);
}
