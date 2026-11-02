import { describe, expect, it } from "vitest";
import { BOX_PART_ITEM, BOX_PRICE, BOX_SPIN_TICKS, EGG_BUILT, EGG_PART_A, EGG_PART_B, EGG_PART_C, EGG_SONG, REVIVE_INVULN_TICKS, SOLO_REVIVE_TICKS, SPRINT_FACTOR, TRAIL_LENGTH, ZOMBIE_WAIT_RANGE, PERK_QUICK, DRINK_TICKS } from "../constants.js";
import { M1911, THUNDERGUN, weapon } from "../weapons.js";
import { applyPerk, downPlayer, resolveShot } from "./combat.js";
import { harness } from "./helpers.test-util.js";
import { collisionBoxes, stepPlayerMovement } from "./movement.js";
import { Z_HUNT } from "./types.js";
import { createZombie } from "./zombies.js";

function pressAt(h: ReturnType<typeof harness>, x: number, z: number, id = 1): void {
  const p = h.state.players.find((q) => q.id === id)!;
  p.x = x;
  p.z = z;
  h.tick({ [id]: { use: false } });
  h.tick({ [id]: { use: true } });
  h.tick({ [id]: { use: false } });
}

function zombieAt(h: ReturnType<typeof harness>, x: number, z: number) {
  const zb = createZombie(h.state, { zone: 0, x, y: 0, z }, h.map, () => 0.5);
  zb.state = Z_HUNT;
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    zb.trail[i * 3] = zb.x;
    zb.trail[i * 3 + 1] = zb.y;
    zb.trail[i * 3 + 2] = zb.z;
  }
  h.state.zombies.push(zb);
  return zb;
}

describe("correr", () => {
  it("con Shift hacia adelante se va más rápido, y no se dispara", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const boxes = collisionBoxes(h.state, h.map);
    const base = { ...p };
    for (let i = 0; i < 20; i++) stepPlayerMovement(p, { ...h.state.players[0]!, seq: i, fwd: 1, side: 0, yaw: Math.PI, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, sprint: false, scope: false, use: false, melee: false, act: 0, view: -1 } as never, boxes, true);
    const walkSpeed = Math.hypot(p.vx, p.vz);
    Object.assign(p, base, { vx: 0, vz: 0 });
    for (let i = 0; i < 20; i++) stepPlayerMovement(p, { seq: i, fwd: 1, side: 0, yaw: Math.PI, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, sprint: true, scope: false, use: false, melee: false, act: 0, view: -1 }, boxes, true);
    const sprintSpeed = Math.hypot(p.vx, p.vz);
    expect(sprintSpeed).toBeGreaterThan(walkSpeed * 1.2);
    expect(sprintSpeed).toBeCloseTo(weapon(M1911).speed * SPRINT_FACTOR, 1);
    // Corriendo, el gatillo no hace nada.
    const ammo = p.ammo[0];
    h.run(3, { 1: { fwd: 1, sprint: true, shoot: true } });
    expect(p.ammo[0]).toBe(ammo);
    h.tick({ 1: { shoot: false } });
    h.tick({ 1: { shoot: true } });
    expect(p.ammo[0]).toBe(ammo! - 1);
  });
});

describe("caído con Quick Revive", () => {
  it("los zombis esperan a distancia, y al levantarse salen empujados y no pegan un rato", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    h.state.round.ticksLeft = 100_000;
    h.state.power = true;
    applyPerk(p, PERK_QUICK);
    const zb = zombieAt(h, p.x + 2.6, p.z);
    downPlayer(h.state, p, h.events);
    expect(p.selfRevive).toBe(true);
    h.run(SOLO_REVIVE_TICKS - 2);
    expect(p.down).toBe(true);
    expect(p.hp).toBe(0);
    // Se quedó cerca, sin pegar.
    expect(Math.hypot(zb.x - p.x, zb.z - p.z)).toBeLessThanOrEqual(ZOMBIE_WAIT_RANGE + 0.3);
    expect(h.events.some((e) => e.t === "hurt")).toBe(false);
    h.run(3);
    expect(p.down).toBe(false);
    expect(p.invulnTicks).toBeGreaterThan(REVIVE_INVULN_TICKS - 5);
    expect(Math.hypot(zb.x - p.x, zb.z - p.z)).toBeGreaterThan(3);
    // Mientras dura la gracia no le pegan.
    h.run(REVIVE_INVULN_TICKS - 10);
    expect(p.hp).toBeGreaterThan(0);
    expect(h.events.some((e) => e.t === "hurt")).toBe(false);
  });

  it("caído se puede seguir disparando con la pistola", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    h.state.round.ticksLeft = 100_000;
    applyPerk(p, PERK_QUICK);
    downPlayer(h.state, p, h.events);
    expect(p.selfRevive).toBe(true);
    const ammo = p.ammo[p.active]!;
    h.tick({ 1: { shoot: false } });
    h.tick({ 1: { shoot: true } });
    expect(p.ammo[p.active]).toBe(ammo - 1);
  });
});

describe("el easter egg", () => {
  it("radios, armario, bobina, la pieza de la caja y el banco: sale la Thunder Gun", () => {
    const h = harness(1, 4);
    const p = h.state.players[0]!;
    h.state.round.ticksLeft = 100_000;
    h.state.doorsOpen = 0b111111;
    p.points = 20000;
    const locker = h.map.doors.find((d) => d.locked)!;
    expect(locker).toBeDefined();
    // Con llave: no se compra.
    pressAt(h, locker.box.maxX + 0.6, (locker.box.minZ + locker.box.maxZ) / 2);
    expect(h.state.doorsOpen & (1 << locker.id)).toBe(0);
    // Las tres radios.
    for (const r of h.map.radios) {
      p.y = Math.max(0, r.y - 1.2);
      pressAt(h, r.x + 0.5, r.z);
    }
    p.y = 0;
    expect(h.state.egg & EGG_SONG).toBe(EGG_SONG);
    expect(h.state.doorsOpen & (1 << locker.id)).not.toBe(0);
    expect(h.state.songTicks).toBeGreaterThan(0);
    // La primera pieza, adentro del armario.
    const a = h.map.eggParts[0]!;
    pressAt(h, a.x + 0.5, a.z + 0.5);
    expect(h.state.egg & EGG_PART_A).toBe(EGG_PART_A);
    // La segunda, arriba del contenedor.
    const b = h.map.eggParts[1]!;
    p.y = b.y - 0.1;
    pressAt(h, b.x, b.z + 0.5);
    p.y = 0;
    expect(h.state.egg & EGG_PART_B).toBe(EGG_PART_B);
    // El banco todavía no arma nada.
    pressAt(h, h.map.bench.x, h.map.bench.z + 0.5);
    expect(h.state.egg & EGG_BUILT).toBe(0);
    // La caja da el gatillo.
    const spot = h.map.boxSpots[h.state.box.spot]!;
    pressAt(h, spot.x + 1, spot.z);
    expect(h.state.box.phase).toBe(1);
    h.run(BOX_SPIN_TICKS);
    expect(h.state.box.weapon).toBe(BOX_PART_ITEM);
    pressAt(h, spot.x + 1, spot.z);
    expect(h.state.egg & EGG_PART_C).toBe(EGG_PART_C);
    expect(p.slots).not.toContain(BOX_PART_ITEM);
    // Al banco: Thunder Gun.
    pressAt(h, h.map.bench.x, h.map.bench.z + 0.5);
    expect(h.state.egg & EGG_BUILT).toBe(EGG_BUILT);
    expect(p.slots).toContain(THUNDERGUN);
    expect(p.points).toBe(20000 - BOX_PRICE);
  });

  it("la Thunder Gun se lleva a todos los que tenga adelante, y a los de atrás no", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    p.slots = [THUNDERGUN, -1, -1];
    p.ammo = [2, 0, 0];
    p.active = 0;
    p.yaw = 0;
    p.pitch = 0;
    const front = [zombieAt(h, p.x, p.z - 3), zombieAt(h, p.x + 1.5, p.z - 5), zombieAt(h, p.x - 1, p.z - 7)];
    const behind = zombieAt(h, p.x, p.z + 3);
    const far = zombieAt(h, p.x, p.z - 14);
    for (const z of [...front, behind, far]) z.hp = 50000;
    resolveShot(h.state, p, THUNDERGUN, 1, 0, collisionBoxes(h.state, h.map), h.events);
    for (const z of front) expect(h.state.zombies).not.toContain(z);
    expect(h.state.zombies).toContain(behind);
    expect(h.state.zombies).toContain(far);
    expect(p.kills).toBe(3);
  });

  it("la caja arranca en cualquiera de sus lugares según la semilla", () => {
    const spots = new Set<number>();
    for (let seed = 1; seed < 30; seed++) spots.add(harness(1, seed).state.box.spot);
    expect(spots.size).toBeGreaterThan(1);
  });

  it("la bebida tarda en tomarse: mientras tanto no se dispara", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    h.state.round.ticksLeft = 100_000;
    h.state.doorsOpen = 0xff;
    const qr = h.map.perks.find((m) => m.perk === PERK_QUICK)!;
    p.points = 1000;
    pressAt(h, qr.x - 0.8, qr.z - 0.8);
    expect(p.drinkTicks).toBeGreaterThan(DRINK_TICKS - 5);
    const ammo = p.ammo[0]!;
    h.tick({ 1: { shoot: true } });
    expect(p.ammo[0]).toBe(ammo);
    h.run(DRINK_TICKS, { 1: { shoot: false } });
    h.tick({ 1: { shoot: true } });
    expect(p.ammo[0]).toBe(ammo - 1);
  });
});
