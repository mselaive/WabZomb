import { describe, expect, it } from "vitest";
import { DRINK_TICKS, EGG_BUILT, EGG_FURNACE, EGG_PART_A, EGG_PART_B, EGG_PART_C, EGG_SONG, EGG_SOULS, PERK_QUICK, REVIVE_INVULN_TICKS, SOLO_REVIVE_TICKS, SPRINT_FACTOR, TRAIL_LENGTH, ZOMBIE_WAIT_RANGE } from "../constants.js";
import { M1911, THUNDERGUN, weapon } from "../weapons.js";
import { applyPerk, downPlayer, resolveShot } from "./combat.js";
import { harness } from "./helpers.test-util.js";
import { findInteraction } from "./interact.js";
import { collisionBoxes, stepPlayerMovement } from "./movement.js";
import { Z_HUNT, Z_TEARING } from "./types.js";
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
    for (let i = 0; i < 20; i++) stepPlayerMovement(p, { seq: i, fwd: 1, side: 0, yaw: Math.PI, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, sprint: false, scope: false, use: false, melee: false, act: 0, view: -1 }, boxes, true);
    const walkSpeed = Math.hypot(p.vx, p.vz);
    Object.assign(p, base, { vx: 0, vz: 0 });
    for (let i = 0; i < 20; i++) stepPlayerMovement(p, { seq: i, fwd: 1, side: 0, yaw: Math.PI, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, sprint: true, scope: false, use: false, melee: false, act: 0, view: -1 }, boxes, true);
    const sprintSpeed = Math.hypot(p.vx, p.vz);
    expect(sprintSpeed).toBeGreaterThan(walkSpeed * 1.2);
    expect(sprintSpeed).toBeCloseTo(weapon(M1911).speed * SPRINT_FACTOR, 1);
    const ammo = p.ammo[0];
    h.run(3, { 1: { fwd: 1, sprint: true, shoot: true } });
    expect(p.ammo[0]).toBe(ammo);
    h.tick({ 1: { shoot: false } });
    h.tick({ 1: { shoot: true } });
    expect(p.ammo[0]).toBe(ammo! - 1);
  });

  it("tomando una bebida no se corre", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const boxes = collisionBoxes(h.state, h.map);
    p.drinkTicks = 40;
    for (let i = 0; i < 20; i++) stepPlayerMovement(p, { seq: i, fwd: 1, side: 0, yaw: Math.PI, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, sprint: true, scope: false, use: false, melee: false, act: 0, view: -1 }, boxes, true);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(weapon(M1911).speed, 1);
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
    expect(Math.hypot(zb.x - p.x, zb.z - p.z)).toBeLessThanOrEqual(ZOMBIE_WAIT_RANGE + 0.3);
    expect(h.events.some((e) => e.t === "hurt")).toBe(false);
    h.run(3);
    expect(p.down).toBe(false);
    expect(p.invulnTicks).toBeGreaterThan(REVIVE_INVULN_TICKS - 5);
    expect(Math.hypot(zb.x - p.x, zb.z - p.z)).toBeGreaterThan(3);
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

describe("alturas", () => {
  const jumpAt = (h: ReturnType<typeof harness>, x: number, z: number, yaw: number) => {
    const p = h.state.players[0]!;
    const boxes = collisionBoxes(h.state, h.map);
    p.x = x;
    p.z = z;
    p.y = 0;
    p.vx = p.vy = p.vz = 0;
    p.onGround = true;
    let top = 0;
    for (let i = 0; i < 80; i++) {
      stepPlayerMovement(p, { seq: i, fwd: 1, side: 0, yaw, pitch: 0, shoot: false, reload: false, jump: true, crouch: false, sprint: false, scope: false, use: false, melee: false, act: 0, view: -1 }, boxes, true);
      if (p.onGround) top = Math.max(top, p.y);
    }
    return top;
  };

  it("no se puede subir a los muebles: mesadas del laboratorio, barril y lockers", () => {
    const h = harness(1);
    expect(jumpAt(h, 0, -3.2, 0)).toBeLessThan(0.1);
    expect(jumpAt(h, -4, -4.3, 0)).toBeLessThan(0.1);
    expect(jumpAt(h, -30.5, -5.5, 0)).toBeLessThan(0.1);
    expect(jumpAt(h, -36, -6.5, 0)).toBeLessThan(0.1);
    expect(jumpAt(h, 13.5, 3, Math.PI / 2)).toBeLessThan(0.1);
  });

  it("a la plataforma de carga se sigue subiendo: ahí los zombis también llegan", () => {
    const h = harness(1);
    expect(jumpAt(h, 26, 11, 0)).toBeGreaterThan(0.7);
  });

  it("las paredes invisibles no se dibujan ni frenan balas", () => {
    const h = harness(1);
    expect(h.map.boxes.some((b) => b.clip)).toBe(true);
    expect(h.map.boxes.filter((b) => b.clip).every((b) => b.thin && b.hidden)).toBe(true);
  });
});

describe("cuchillo", () => {
  it("llega al zombi que arranca tablas, pegado a la ventana desde adentro", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    h.state.round.ticksLeft = 100_000;
    const w = h.map.barriers[1]!;
    p.x = w.inside.x;
    p.z = 17.69;
    const zb = zombieAt(h, w.outside.x, w.outside.z);
    zb.barrier = w.id;
    zb.state = Z_TEARING;
    zb.stateTicks = 30;
    h.tick({ 1: { melee: true, yaw: Math.PI, pitch: 0 } });
    expect(h.state.zombies).not.toContain(zb);
  });
});

describe("zombis perdidos", () => {
  it("un zombi que no se acerca a nadie en 40 s vuelve a la cola", () => {
    const h = harness(1);
    h.state.round.phase = "live";
    h.state.round.total = 1;
    h.state.round.spawned = 1;
    h.state.round.nextSpawnAt = 1e9;
    const p = h.state.players[0]!;
    // Lejos, en el estacionamiento cerrado: sin camino hasta la oficina.
    const zb = zombieAt(h, 40, 12);
    zb.engagedAt = h.state.tick;
    h.run(41 * 20);
    expect(h.state.zombies).not.toContain(zb);
    expect(h.state.round.spawned).toBe(0);
    expect(p.alive).toBe(true);
  });
});

describe("el easter egg", () => {
  it("luz, radios con notas, armario, bobina, almas en el horno, gatillo, banco: la Thunder Gun", () => {
    const h = harness(1, 4);
    const p = h.state.players[0]!;
    h.state.round.ticksLeft = 100_000;
    h.state.doorsOpen = 0b111111 | (1 << 7) | (1 << 8);
    p.points = 20000;
    const locker = h.map.doors.find((d) => d.locked)!;
    expect(locker).toBeDefined();
    // Con llave: no se compra, y adentro no se agarra nada.
    pressAt(h, locker.box.maxX + 0.6, (locker.box.minZ + locker.box.maxZ) / 2);
    expect(h.state.doorsOpen & (1 << locker.id)).toBe(0);
    const a = h.map.eggParts[0]!;
    pressAt(h, a.x + 0.9, a.z + 0.5);
    expect(h.state.egg & EGG_PART_A).toBe(0);
    // Sin luz, las radios no hacen nada.
    // Todas se alcanzan parado en el piso, al lado del mueble.
    const radioSpots = [[-27, 14.1], [24, -3.2], [-4.5, -12.6]] as const;
    p.x = radioSpots[0][0];
    p.z = radioSpots[0][1];
    expect(findInteraction(h.state, p, h.map)?.ok).toBe(false);
    h.state.power = true;
    for (const [x, z] of radioSpots) pressAt(h, x, z);
    expect(h.state.egg & EGG_SONG).toBe(EGG_SONG);
    expect(h.state.doorsOpen & (1 << locker.id)).not.toBe(0);
    expect(h.state.songTicks).toBeGreaterThan(0);
    // Ahora sí, el núcleo.
    pressAt(h, a.x + 0.9, a.z + 0.5);
    expect(h.state.egg & EGG_PART_A).toBe(EGG_PART_A);
    // La bobina, arriba del contenedor: se agarra desde el piso.
    const b = h.map.eggParts[1]!;
    pressAt(h, 13.4, b.z);
    expect(h.state.egg & EGG_PART_B).toBe(EGG_PART_B);
    // El gatillo no está hasta que el horno se llena.
    const c = h.map.eggParts[2]!;
    pressAt(h, c.x, c.z + 0.6);
    expect(h.state.egg & EGG_PART_C).toBe(0);
    expect(findInteraction(h.state, p, h.map)?.why).toContain("Almas");
    // Matar zombis al lado del horno (lejos no cuenta).
    // Parado a 4,5 m del horno mirando hacia él: los zombis caen a 2 m de la boca.
    p.x = h.map.furnace.x;
    p.z = h.map.furnace.z + 4.5;
    p.yaw = 0;
    p.pitch = Math.atan2(1.0 - 1.62, 2.5);
    for (let i = 0; i < EGG_SOULS + 2; i++) {
      const zb = zombieAt(h, p.x, p.z - 2.5);
      zb.hp = 1;
      // Que no lo tiren mientras tanto: son 40 y pegan.
      p.invulnTicks = 1000;
      // Y sin retroceso acumulado: cuarenta tiros seguidos abren mucho la dispersión.
      p.recoil = 0;
      // La cadencia de la pistola: soltar el gatillo unos ticks entre tiro y tiro.
      h.run(4, { 1: { shoot: false, yaw: 0, pitch: p.pitch } });
      h.tick({ 1: { shoot: true, yaw: 0, pitch: p.pitch } });
      expect(h.state.zombies).not.toContain(zb);
      p.reserve[p.active] = 100;
      p.ammo[p.active] = 8;
    }
    expect(h.state.eggSouls).toBe(EGG_SOULS);
    expect(h.state.egg & EGG_FURNACE).toBe(EGG_FURNACE);
    pressAt(h, c.x, c.z + 0.6);
    expect(h.state.egg & EGG_PART_C).toBe(EGG_PART_C);
    // Al banco: Thunder Gun.
    pressAt(h, h.map.bench.x, h.map.bench.z + 0.5);
    expect(h.state.egg & EGG_BUILT).toBe(EGG_BUILT);
    expect(p.slots).toContain(THUNDERGUN);
  });

  it("las almas lejos del horno no cuentan", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    h.state.round.ticksLeft = 100_000;
    h.state.egg |= EGG_SONG;
    p.yaw = 0;
    p.pitch = Math.atan2(1.0 - 1.62, 2.5);
    const zb = zombieAt(h, p.x, p.z - 2.5);
    zb.hp = 1;
    h.tick({ 1: { shoot: false } });
    h.tick({ 1: { shoot: true } });
    expect(h.state.zombies).not.toContain(zb);
    expect(h.state.eggSouls).toBe(0);
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
    expect(spots.size).toBeGreaterThan(2);
  });

  it("la bebida tarda en tomarse: mientras tanto no se dispara", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    h.state.round.ticksLeft = 100_000;
    h.state.doorsOpen = 0xffff;
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
