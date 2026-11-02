import {
  ACT_SLOT_0,
  ACT_SLOT_2,
  CROUCH_TICKS,
  DOWN_BLEED_TICKS,
  EXPLOSIVE_POINTS,
  HEADSHOT_POINTS,
  HEAD_HEIGHT,
  HIT_POINTS,
  JUGG_HP,
  KILL_POINTS,
  KNIFE_DAMAGE,
  KNIFE_RANGE,
  KNIFE_TICKS,
  LAG_COMP_MAX_TICKS,
  LEG_HEIGHT,
  MAX_HP,
  MAX_POINTS,
  MELEE_POINTS,
  PERK_DOUBLETAP,
  PERK_JUGG,
  PERK_MULE,
  PERK_QUICK,
  PERK_SPEED,
  PLAYER_HALF_W,
  POWERUP_CHANCE,
  POWERUP_MAX_PER_ROUND,
  REGEN_DELAY_TICKS,
  SOLO_REVIVE_TICKS,
  TAG_TICKS,
  TRAIL_LENGTH,
  ZOMBIE_HALF_W,
  ZOMBIE_HEIGHT,
  ZONE_BODY,
  ZONE_HEAD,
  ZONE_LEGS,
} from "../constants.js";
import { hashUnit, lerp, viewDir, type Vec3 } from "../math.js";
import { rayAabb, raycastBoxes, segmentClear, type RayHit } from "../map/raycast.js";
import type { Box } from "../map/types.js";
import { KNIFE, SLOT_COUNT, weapon, weaponStats, type WeaponDef } from "../weapons.js";
import { eyeHeightOf, hasPerk, heightOf } from "./movement.js";
import { dropPowerUp } from "./powerups.js";
import { HIT_BODY, HIT_HEAD, HIT_NONE, HIT_WORLD, type Body, type GameState, type PlayerInput, type PlayerState, type SimEvent, type ZombieState } from "./types.js";

const MAX_RANGE = 200;
const RECOIL_COOL_TICKS = 3;
const SCOPED_SPREAD = 0.0008;
const AIR_SPREAD = 0.1;

/** Cuántas ranuras de arma tiene: dos, tres con Mule Kick. */
export function slotLimit(p: PlayerState): number {
  return hasPerk(p, PERK_MULE) ? SLOT_COUNT : 2;
}

/** El id del arma en la mano, o -1 si no tiene nada (se la llevó el Pack-a-Punch). */
export function heldWeapon(p: PlayerState): number {
  return p.slots[p.active] ?? -1;
}

export function applySlotAction(p: PlayerState, act: number): void {
  if (act < ACT_SLOT_0 || act > ACT_SLOT_2) return;
  const slot = act - ACT_SLOT_0;
  if (slot === p.active || slot >= slotLimit(p)) return;
  if ((p.slots[slot] ?? -1) < 0) return;
  switchTo(p, slot);
}

export function switchTo(p: PlayerState, slot: number): void {
  p.active = slot;
  const wid = p.slots[slot] ?? -1;
  p.drawCd = wid >= 0 ? weapon(wid).drawTicks : 2;
  p.reloadCd = 0;
  p.reloading = false;
  p.scoped = false;
  p.recoil = 0;
}

/** La ranura con algo (la primera), o 0. */
export function firstUsableSlot(p: PlayerState): number {
  for (let s = 0; s < SLOT_COUNT; s++) if ((p.slots[s] ?? -1) >= 0) return s;
  return 0;
}

/**
 * El estado del arma en un tick: cadencia, recarga, retroceso, mira, y si con
 * este input sale un tiro. Devuelve el id del arma que disparó o -1. Corre
 * igual en el cliente y en el servidor.
 */
export function stepWeaponState(p: PlayerState, input: PlayerInput, canAct: boolean): number {
  if (p.fireCd > 0) p.fireCd--;
  if (p.drawCd > 0) p.drawCd--;
  if (p.meleeCd > 0) p.meleeCd--;
  const wid = heldWeapon(p);
  const stats = wid >= 0 ? weaponStats(wid, (p.pap[p.active] ?? 0) === 1) : null;
  if (p.reloadCd > 0) {
    p.reloadCd--;
    if (p.reloadCd === 0 && p.reloading) {
      p.reloading = false;
      if (stats) {
        const need = stats.mag - (p.ammo[p.active] ?? 0);
        const take = Math.min(need, p.reserve[p.active] ?? 0);
        p.ammo[p.active] = (p.ammo[p.active] ?? 0) + take;
        p.reserve[p.active] = (p.reserve[p.active] ?? 0) - take;
      }
    }
  }

  const w = wid >= 0 ? weapon(wid) : null;
  p.scoped = !!w && w.zoom > 0 && input.scope && p.drawCd === 0 && !p.reloading && !p.down;

  if (p.fireCd === 0 && p.recoil > 0) {
    if (++p.recoilCool >= RECOIL_COOL_TICKS) {
      p.recoilCool = 0;
      p.recoil--;
    }
  }

  if (!p.alive || !w || !stats) {
    p.shootHeld = input.shoot;
    return -1;
  }

  const ammo = p.ammo[p.active] ?? 0;
  const reserve = p.reserve[p.active] ?? 0;
  const ready = p.fireCd === 0 && p.drawCd === 0 && !p.reloading && p.meleeCd === 0;

  const wantsReload = input.reload || (input.shoot && ammo === 0);
  if (wantsReload && ready && ammo < stats.mag && reserve > 0) {
    p.reloading = true;
    // Speed Cola: la mitad del tiempo.
    p.reloadCd = Math.max(4, Math.round(w.reloadTicks * (hasPerk(p, PERK_SPEED) ? 0.5 : 1)));
    p.scoped = false;
    p.shootHeld = input.shoot;
    return -1;
  }

  let fired = -1;
  const trigger = input.shoot && (stats.auto || !p.shootHeld);
  if (canAct && trigger && ready && ammo > 0) {
    p.ammo[p.active] = ammo - 1;
    p.fireCd = stats.fireTicks;
    p.recoil++;
    p.recoilCool = 0;
    fired = wid;
  }
  p.shootHeld = input.shoot;
  return fired;
}

/** El cuchillo (V): arranca el tajo si se puede. Corta la recarga. Devuelve si salió. */
export function stepMelee(p: PlayerState, input: PlayerInput, canAct: boolean): boolean {
  if (!canAct || !input.melee || !p.alive || p.down || p.meleeCd > 0 || p.drawCd > 0) return false;
  p.meleeCd = KNIFE_TICKS;
  p.reloading = false;
  p.reloadCd = 0;
  p.scoped = false;
  return true;
}

/** Tirar una granada (G): si tiene y no está ocupado. Devuelve si salió. */
export function tryThrow(p: PlayerState, canAct: boolean): boolean {
  if (!canAct || !p.alive || p.down || p.grenades <= 0 || p.reloading || p.meleeCd > 0 || p.fireCd > 2) return false;
  p.grenades--;
  p.fireCd = 14;
  return true;
}

export function spreadOf(p: PlayerState, w: WeaponDef, recoilBefore: number): number {
  if (p.scoped) return SCOPED_SPREAD + w.spreadShot * recoilBefore * 0.25;
  let s = w.spread;
  if (p.crouch >= CROUCH_TICKS) s *= 0.6;
  s += w.spreadShot * recoilBefore;
  const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  s += w.spreadMove * Math.min(1, speed / Math.max(0.1, w.speed));
  if (!p.onGround) s += AIR_SPREAD;
  return s;
}

export function recoilOffset(w: WeaponDef, n: number): { x: number; y: number } {
  if (n <= 0 || w.recoilUp === 0) return { x: 0, y: 0 };
  const climb = 1 - Math.exp(-n / 4);
  const y = w.recoilUp * climb;
  const side = n < 3 ? 0 : Math.sin((n - 2) * 0.8) * Math.min(1, (n - 2) / 4);
  return { x: w.recoilSide * side, y };
}

/** Hacia dónde sale cada perdigón de un tiro. Determinista: el cliente y el servidor sacan lo mismo. */
export function shotDirections(p: PlayerState, wid: number, seq: number): Vec3[] {
  const w = weapon(wid);
  const fwd = viewDir(p.yaw, p.pitch, { x: 0, y: 0, z: 0 });
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const ux = -rz * fwd.y;
  const uy = rz * fwd.x - rx * fwd.z;
  const uz = rx * fwd.y;
  const n = Math.max(0, p.recoil - 1);
  const spread = spreadOf(p, w, n);
  const recoil = p.scoped ? { x: 0, y: 0 } : recoilOffset(w, n);
  const out: Vec3[] = [];
  for (let i = 0; i < w.pellets; i++) {
    const u = hashUnit(p.id, seq, i * 2 + 1);
    const v = hashUnit(p.id, seq, i * 2 + 2);
    const r = spread * Math.sqrt(u);
    const a = v * Math.PI * 2;
    const ox = Math.cos(a) * r + recoil.x;
    const oy = Math.sin(a) * r + recoil.y;
    let dx = fwd.x + rx * ox + ux * oy;
    let dy = fwd.y + uy * oy;
    let dz = fwd.z + rz * ox + uz * oy;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= len;
    dy /= len;
    dz /= len;
    out.push({ x: dx, y: dy, z: dz });
  }
  return out;
}

// ------------------------------------------------------------ compensación de lag

function trailSlot(tick: number): number {
  return (((tick % TRAIL_LENGTH) + TRAIL_LENGTH) % TRAIL_LENGTH) * 3;
}

export function recordTrail(b: Body, tick: number): void {
  const i = trailSlot(tick);
  b.trail[i] = b.x;
  b.trail[i + 1] = b.y;
  b.trail[i + 2] = b.z;
}

export function resetTrail(b: Body): void {
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    b.trail[i * 3] = b.x;
    b.trail[i * 3 + 1] = b.y;
    b.trail[i * 3 + 2] = b.z;
  }
}

export function pastPosition(b: Body, tick: number, rewind: number, out: Vec3): Vec3 {
  if (rewind <= 0) {
    out.x = b.x;
    out.y = b.y;
    out.z = b.z;
    return out;
  }
  const t = tick - rewind;
  const t0 = Math.floor(t);
  const f = t - t0;
  const a = trailSlot(t0);
  const c = trailSlot(t0 + 1);
  out.x = lerp(b.trail[a]!, b.trail[c]!, f);
  out.y = lerp(b.trail[a + 1]!, b.trail[c + 1]!, f);
  out.z = lerp(b.trail[a + 2]!, b.trail[c + 2]!, f);
  return out;
}

export function shotRewind(tick: number, view: number): number {
  if (view < 0) return 0;
  const r = tick - view;
  return r < 0 ? 0 : r > LAG_COMP_MAX_TICKS ? LAG_COMP_MAX_TICKS : r;
}

// ------------------------------------------------------------ puntos

export function givePoints(state: GameState, p: PlayerState, amount: number, x: number, y: number, z: number, events: SimEvent[]): void {
  if (amount <= 0) return;
  const total = state.doublePoints > 0 ? amount * 2 : amount;
  p.points = Math.min(MAX_POINTS, p.points + total);
  events.push({ t: "points", id: p.id, amount: total, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 });
}

// ------------------------------------------------------------ el tiro

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/** Zona del impacto en un cuerpo de altura `h`: cabeza, cuerpo o piernas. */
function zoneOfHit(rel: number, h: number): number {
  return rel > h - HEAD_HEIGHT ? ZONE_HEAD : rel < LEG_HEIGHT ? ZONE_LEGS : ZONE_BODY;
}

/**
 * Resuelve un tiro en el servidor: cada perdigón contra el mapa y contra los
 * zombis tal como los veía el que disparó (rebobinados `rewind` ticks). Si el
 * arma es explosiva (la Ray Gun), además estalla donde termina.
 */
export function resolveShot(state: GameState, shooter: PlayerState, wid: number, seq: number, rewind: number, boxes: readonly Box[], events: SimEvent[]): void {
  const w = weapon(wid);
  const stats = weaponStats(wid, (shooter.pap[shooter.active] ?? 0) === 1 && shooter.slots[shooter.active] === wid);
  const dirs = shotDirections(shooter, wid, seq);
  const ox = shooter.x;
  const oy = shooter.y + eyeHeightOf(shooter);
  const oz = shooter.z;
  const hits: number[] = [];
  const doubleTap = hasPerk(shooter, PERK_DOUBLETAP) ? 2 : 1;
  const hit: RayHit = { t: 0, exit: 0, nx: 0, ny: 0, nz: 0 };

  for (const d of dirs) {
    const tWorld = raycastBoxes(ox, oy, oz, d.x, d.y, d.z, boxes, MAX_RANGE, hit);
    let best = tWorld < 0 ? MAX_RANGE : tWorld;
    let kind = tWorld < 0 ? HIT_NONE : HIT_WORLD;
    let target: ZombieState | null = null;
    let zone = ZONE_BODY;
    for (const z of state.zombies) {
      pastPosition(z, state.tick, rewind, scratch);
      const t = rayAabb(ox, oy, oz, d.x, d.y, d.z, scratch.x, scratch.y + ZOMBIE_HEIGHT / 2, scratch.z, ZOMBIE_HALF_W, ZOMBIE_HEIGHT / 2, ZOMBIE_HALF_W, best);
      if (t < 0 || t >= best) continue;
      best = t;
      target = z;
      zone = zoneOfHit(oy + d.y * t - scratch.y, ZOMBIE_HEIGHT);
      kind = zone === ZONE_HEAD ? HIT_HEAD : HIT_BODY;
    }
    const ex = ox + d.x * best;
    const ey = oy + d.y * best;
    const ez = oz + d.z * best;
    hits.push(Math.round(ex * 100) / 100, Math.round(ey * 100) / 100, Math.round(ez * 100) / 100, kind);

    if (stats.explosive > 0 && kind !== HIT_NONE) {
      // Estalla ahí: a todos los que estén cerca (el que disparó también, un poco).
      explodeAt(state, shooter, ex, ey, ez, stats.explosive, stats.damage * doubleTap, wid, boxes, events, target);
      continue;
    }
    if (target) {
      const zoneMul = zone === ZONE_HEAD ? w.head : zone === ZONE_LEGS ? 0.8 : 1;
      const dmg = Math.max(1, Math.round(stats.damage * zoneMul * Math.pow(w.range, best / 10) * doubleTap));
      damageZombie(state, target, shooter, dmg, zone, wid, ex, ey, ez, events);
    }
  }

  events.push({ t: "shot", byId: shooter.id, seq, weapon: wid, x: Math.round(ox * 100) / 100, y: Math.round(oy * 100) / 100, z: Math.round(oz * 100) / 100, hits });
}

/**
 * Una explosión: daño que cae con la distancia a los zombis a la vista desde el
 * punto (el que pegó de lleno, entero), y un poco a los jugadores cerca.
 */
export function explodeAt(
  state: GameState,
  by: PlayerState,
  x: number,
  y: number,
  z: number,
  radius: number,
  damage: number,
  wid: number,
  boxes: readonly Box[],
  events: SimEvent[],
  direct: ZombieState | null = null,
  playerDamage = 30,
): void {
  for (const zb of state.zombies.slice()) {
    const cy = zb.y + ZOMBIE_HEIGHT * 0.5;
    const dist = Math.hypot(zb.x - x, cy - y, zb.z - z);
    if (zb !== direct && dist > radius) continue;
    if (zb !== direct && !segmentClear(x, y, z, zb.x, cy, zb.z, boxes) && !segmentClear(x, y, z, zb.x, zb.y + 0.3, zb.z, boxes)) continue;
    const dmg = zb === direct ? damage : Math.max(1, Math.round(damage * (1 - (dist / radius) * 0.7)));
    damageZombie(state, zb, by, dmg, ZONE_BODY, wid, zb.x, cy, zb.z, events);
  }
  if (playerDamage > 0) {
    for (const q of state.players) {
      if (!q.alive || !q.connected || q.down) continue;
      const cy = q.y + heightOf(q) * 0.5;
      const dist = Math.hypot(q.x - x, cy - y, q.z - z);
      if (dist > radius) continue;
      damagePlayer(state, q, Math.max(1, Math.round(playerDamage * (1 - dist / radius))), -1, events);
    }
  }
}

/** El tajo del cuchillo: al zombi más cercano delante, a mano. */
export function resolveMelee(state: GameState, p: PlayerState, seq: number, events: SimEvent[]): void {
  const fwd = viewDir(p.yaw, p.pitch, { x: 0, y: 0, z: 0 });
  const ex = p.x;
  const ey = p.y + eyeHeightOf(p);
  const ez = p.z;
  let best: ZombieState | null = null;
  let bestD = KNIFE_RANGE + ZOMBIE_HALF_W;
  for (const z of state.zombies) {
    const dx = z.x - ex;
    const dz = z.z - ez;
    const d = Math.hypot(dx, dz);
    if (d > bestD || Math.abs(z.y + ZOMBIE_HEIGHT * 0.5 - ey) > 1.6) continue;
    // Delante: el ángulo con la mirada menor a ~50°.
    const dot = (dx * fwd.x + dz * fwd.z) / Math.max(0.001, d);
    if (dot < 0.6) continue;
    bestD = d;
    best = z;
  }
  if (best) {
    const dmg = state.instaKill > 0 ? best.hp : KNIFE_DAMAGE;
    damageZombie(state, best, p, dmg, ZONE_BODY, KNIFE, best.x, best.y + 1.2, best.z, events);
  }
  events.push({ t: "melee", byId: p.id, seq, hit: best !== null });
}

export function damageZombie(state: GameState, z: ZombieState, by: PlayerState, dmg: number, zone: number, wid: number, x: number, y: number, zz: number, events: SimEvent[]): void {
  if (state.instaKill > 0) dmg = z.hp;
  const applied = Math.min(dmg, z.hp);
  z.hp -= applied;
  events.push({ t: "zhit", zombieId: z.id, byId: by.id, amount: applied, zone, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(zz * 100) / 100 });
  if (z.hp > 0) {
    givePoints(state, by, HIT_POINTS, x, y, zz, events);
    return;
  }
  killZombie(state, z, by, wid, zone === ZONE_HEAD, events);
}

export function killZombie(state: GameState, z: ZombieState, by: PlayerState | null, wid: number, headshot: boolean, events: SimEvent[]): void {
  const idx = state.zombies.indexOf(z);
  if (idx >= 0) state.zombies.splice(idx, 1);
  state.round.killed++;
  if (by) {
    by.kills++;
    if (headshot) by.headshots++;
    const pts = wid === KNIFE ? MELEE_POINTS : headshot ? HEADSHOT_POINTS : weapon(wid).cls === "grenade" ? EXPLOSIVE_POINTS : KILL_POINTS;
    givePoints(state, by, pts, z.x, z.y + 1.2, z.z, events);
    // De vez en cuando, un power-up donde cayó.
    const rng = state.rng ?? Math.random;
    if (state.round.powerUps < POWERUP_MAX_PER_ROUND && rng() < POWERUP_CHANCE) dropPowerUp(state, z.x, z.y, z.z, rng, events);
  }
  events.push({ t: "zkill", zombieId: z.id, byId: by?.id ?? -1, weapon: wid, headshot, x: Math.round(z.x * 100) / 100, y: Math.round(z.y * 100) / 100, z: Math.round(z.z * 100) / 100 });
}

/** Un zombi (o una explosión) le pega a alguien. */
export function damagePlayer(state: GameState, p: PlayerState, amount: number, zombieId: number, events: SimEvent[]): void {
  if (!p.alive || p.down) return;
  const applied = Math.min(amount, p.hp);
  p.hp -= applied;
  p.regenAt = state.tick + REGEN_DELAY_TICKS;
  p.tagged = TAG_TICKS;
  events.push({ t: "hurt", targetId: p.id, zombieId, amount: applied });
  if (p.hp <= 0) downPlayer(state, p, events);
}

/** Caído: se queda en el piso, pierde las bebidas y se desangra hasta que lo levanten. */
export function downPlayer(state: GameState, p: PlayerState, events: SimEvent[]): void {
  p.hp = 0;
  p.down = true;
  p.downs++;
  p.scoped = false;
  p.reloading = false;
  p.reloadCd = 0;
  p.reviveTicks = 0;
  p.reviveBy = -1;
  const humans = state.players.filter((q) => q.connected).length;
  p.selfRevive = humans === 1 && hasPerk(p, PERK_QUICK);
  p.bleedTicks = p.selfRevive ? SOLO_REVIVE_TICKS : DOWN_BLEED_TICKS;
  p.perks = 0;
  p.maxHp = MAX_HP;
  // Sin Mule Kick, la tercera arma se pierde.
  if ((p.slots[2] ?? -1) >= 0) {
    p.slots[2] = -1;
    p.ammo[2] = 0;
    p.reserve[2] = 0;
    p.pap[2] = 0;
    if (p.active === 2) switchTo(p, firstUsableSlot(p));
  }
  events.push({ t: "down", id: p.id });
}

export function revivePlayer(state: GameState, p: PlayerState, by: PlayerState | null, hp: number, events: SimEvent[]): void {
  p.down = false;
  p.selfRevive = false;
  p.hp = Math.min(p.maxHp, hp);
  p.regenAt = state.tick + REGEN_DELAY_TICKS;
  p.bleedTicks = 0;
  p.reviveTicks = 0;
  p.reviveBy = -1;
  if (by && by !== p) by.revives++;
  events.push({ t: "revive", id: p.id, byId: by?.id ?? p.id });
}

/** Aplica una bebida recién comprada. */
export function applyPerk(p: PlayerState, perk: number): void {
  p.perks |= 1 << perk;
  if (perk === PERK_JUGG) {
    p.maxHp = JUGG_HP;
    p.hp = JUGG_HP;
  }
}

export { MAX_HP, PLAYER_HALF_W };
