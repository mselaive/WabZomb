import { DT, FRAG_RADIUS, FRAG_SELF_DAMAGE, GRAVITY, GRENADE_BOUNCE, GRENADE_FUSE_TICKS, GRENADE_RADIUS, GRENADE_THROW_SPEED, fragDamage } from "../constants.js";
import { viewDir } from "../math.js";
import type { Box } from "../map/types.js";
import { FRAG } from "../weapons.js";
import { explodeAt } from "./combat.js";
import { eyeHeightOf } from "./movement.js";
import type { GameState, GrenadeState, PlayerState, SimEvent } from "./types.js";

/** Sale de la mano: desde los ojos, hacia donde mira, con un poco hacia arriba. Determinista. */
export function throwGrenade(state: GameState, p: PlayerState, events: SimEvent[], seq: number): GrenadeState {
  const dir = viewDir(p.yaw, p.pitch + 0.12, { x: 0, y: 0, z: 0 });
  const g: GrenadeState = {
    id: state.nextGrenadeId++,
    ownerId: p.id,
    x: p.x + dir.x * 0.4,
    y: p.y + eyeHeightOf(p) - 0.1 + dir.y * 0.4,
    z: p.z + dir.z * 0.4,
    vx: dir.x * GRENADE_THROW_SPEED + p.vx * 0.5,
    vy: dir.y * GRENADE_THROW_SPEED + p.vy * 0.3,
    vz: dir.z * GRENADE_THROW_SPEED + p.vz * 0.5,
    ticksLeft: GRENADE_FUSE_TICKS,
  };
  state.grenades.push(g);
  events.push({ t: "throw", byId: p.id, seq, id: g.id });
  return g;
}

function overlaps(b: Box, x: number, y: number, z: number, r: number): boolean {
  return x + r > b.minX && x - r < b.maxX && y + r > b.minY && y - r < b.maxY && z + r > b.minZ && z - r < b.maxZ;
}

/** Un paso de la física de una granada: gravedad y rebotes de a un eje. */
export function advanceGrenade(g: GrenadeState, boxes: readonly Box[]): void {
  g.vy -= GRAVITY * DT;
  const r = GRENADE_RADIUS;
  let onGround = false;
  g.x += g.vx * DT;
  for (const b of boxes) {
    if (b.decal || b.clip || !overlaps(b, g.x, g.y, g.z, r)) continue;
    g.x = g.vx > 0 ? b.minX - r : b.maxX + r;
    g.vx = -g.vx * GRENADE_BOUNCE;
  }
  g.z += g.vz * DT;
  for (const b of boxes) {
    if (b.decal || b.clip || !overlaps(b, g.x, g.y, g.z, r)) continue;
    g.z = g.vz > 0 ? b.minZ - r : b.maxZ + r;
    g.vz = -g.vz * GRENADE_BOUNCE;
  }
  g.y += g.vy * DT;
  for (const b of boxes) {
    if (b.decal || b.clip || !overlaps(b, g.x, g.y, g.z, r)) continue;
    if (g.vy <= 0) {
      g.y = b.maxY + r;
      g.vy = Math.abs(g.vy) > 2 ? -g.vy * GRENADE_BOUNCE : 0;
      onGround = true;
    } else {
      g.y = b.minY - r;
      g.vy = -g.vy * GRENADE_BOUNCE;
    }
  }
  if (onGround) {
    g.vx *= 0.8;
    g.vz *= 0.8;
    if (Math.abs(g.vx) < 0.05) g.vx = 0;
    if (Math.abs(g.vz) < 0.05) g.vz = 0;
  }
  if (g.y < -5) {
    g.y = 0.1;
    g.vy = 0;
  }
}

/** Un tick de todas las granadas; las que estallan hacen lo suyo. */
export function stepGrenades(state: GameState, boxes: readonly Box[], events: SimEvent[]): void {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i]!;
    advanceGrenade(g, boxes);
    if (--g.ticksLeft > 0) continue;
    state.grenades.splice(i, 1);
    events.push({ t: "explode", id: g.id, x: Math.round(g.x * 100) / 100, y: Math.round(g.y * 100) / 100, z: Math.round(g.z * 100) / 100 });
    const owner = state.players.find((p) => p.id === g.ownerId) ?? state.players[0];
    if (owner) explodeAt(state, owner, g.x, g.y + 0.2, g.z, FRAG_RADIUS, fragDamage(state.round.number), FRAG, boxes, events, null, FRAG_SELF_DAMAGE);
  }
}
