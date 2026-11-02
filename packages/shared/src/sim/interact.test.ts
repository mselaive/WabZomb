import { describe, expect, it } from "vitest";
import { BOX_PRICE, BOX_SPIN_TICKS, JUGG_HP, PAP_PRICE, PAP_TICKS, PERK_JUGG, PERK_QUICK, PERK_QUICK_SOLO_PRICE, PERK_SPEED, SOLO_REVIVE_TICKS } from "../constants.js";
import { M14, M1911, MP40, weapon, weaponStats } from "../weapons.js";
import { downPlayer } from "./combat.js";
import { harness } from "./helpers.test-util.js";
import { findInteraction } from "./interact.js";
import { hasPerk } from "./movement.js";

/** Lleva al jugador al lado de un punto y aprieta E una vez (dos ticks: suelto y apretado). */
function pressAt(h: ReturnType<typeof harness>, x: number, z: number, id = 1): void {
  const p = h.state.players.find((q) => q.id === id)!;
  p.x = x;
  p.z = z;
  h.tick({ [id]: { use: false } });
  h.tick({ [id]: { use: true } });
  h.tick({ [id]: { use: false } });
}

describe("comprar y usar", () => {
  it("una puerta se compra con E si alcanza la plata, y abre la zona", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const door = h.map.doors[0]!;
    const near = { x: door.box.maxX + 0.8, z: (door.box.minZ + door.box.maxZ) / 2 };
    p.points = 700;
    pressAt(h, near.x, near.z);
    expect(h.state.doorsOpen).toBe(0);
    p.points = 800;
    p.x = near.x;
    p.z = near.z;
    const it = findInteraction(h.state, p, h.map);
    expect(it?.kind).toBe("door");
    expect(it?.price).toBe(750);
    pressAt(h, near.x, near.z);
    expect(h.state.doorsOpen).toBe(1);
    expect(p.points).toBe(50);
    expect(h.events.some((e) => e.t === "door" && e.id === 0)).toBe(true);
  });

  it("cada puerta abre la suya y se puede pasar: vestuarios y estacionamiento", () => {
    for (const [name, x, z, yaw, past] of [
      ["Puerta de los vestuarios", -28, 7.1, Math.PI / 2, (v: number) => v < -30.5],
      ["Portón del estacionamiento", 28, 2.1, -Math.PI / 2, (v: number) => v > 30.5],
    ] as const) {
      const h = harness(1);
      const p = h.state.players[0]!;
      h.state.round.ticksLeft = 100_000;
      const door = h.map.doors.find((d) => d.name === name)!;
      h.state.doorsOpen = 0b11;
      const before = h.state.doorsOpen;
      p.points = 1000;
      pressAt(h, x, z);
      expect(h.state.doorsOpen, name).toBe(before | (1 << door.id));
      expect(p.points, name).toBe(0);
      h.run(30, { 1: { fwd: 1, yaw } });
      expect(past(p.x), name + " " + p.x).toBe(true);
    }
  });

  it("el lugar de cada puerta en la lista es su número", () => {
    const h = harness(1);
    h.map.doors.forEach((d, i) => expect(d.id).toBe(i));
  });

  it("un arma de pared: se compra, y la segunda vez es munición a mitad de precio", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const ww = h.map.wallWeapons.find((w) => w.weapon === M14)!;
    p.points = 1000;
    pressAt(h, ww.x + 0.6, ww.z);
    expect(p.slots).toContain(M14);
    expect(p.points).toBe(500);
    expect(p.slots[p.active]).toBe(M14);
    p.reserve[p.active] = 0;
    pressAt(h, ww.x + 0.6, ww.z);
    expect(p.points).toBe(250);
    expect(p.reserve[p.active]).toBe(weapon(M14).reserve);
    // Con las dos ranuras llenas, una tercera compra reemplaza la que tiene en la mano.
    const mp = h.map.wallWeapons.find((w) => w.weapon === MP40)!;
    h.state.doorsOpen = 1;
    p.points = 5000;
    pressAt(h, mp.x + 0.6, mp.z);
    expect(p.slots.filter((s) => s >= 0).length).toBe(2);
    expect(p.slots).toContain(MP40);
    expect(p.slots).toContain(M1911);
  });

  it("las bebidas necesitan la luz (menos Quick Revive), y Juggernog da 250 de vida", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const jug = h.map.perks.find((m) => m.perk === PERK_JUGG)!;
    const qr = h.map.perks.find((m) => m.perk === PERK_QUICK)!;
    p.points = 10000;
    h.state.doorsOpen = 0xff;
    pressAt(h, jug.x + 0.8, jug.z);
    expect(hasPerk(p, PERK_JUGG)).toBe(false);
    h.state.power = true;
    pressAt(h, jug.x + 0.8, jug.z);
    expect(hasPerk(p, PERK_JUGG)).toBe(true);
    expect(p.hp).toBe(JUGG_HP);
    expect(p.points).toBe(7500);
    pressAt(h, qr.x - 0.8, qr.z - 0.8);
    expect(hasPerk(p, PERK_QUICK)).toBe(true);
    expect(p.points).toBe(7500 - PERK_QUICK_SOLO_PRICE);
    // Caer las saca todas; solo con Quick Revive, se levanta él.
    downPlayer(h.state, p, h.events);
    expect(p.perks).toBe(0);
    expect(p.selfRevive).toBe(true);
    h.run(SOLO_REVIVE_TICKS + 1);
    expect(p.down).toBe(false);
    expect(p.alive).toBe(true);
    expect(h.state.phase).toBe("playing");
  });

  it("la caja gira, ofrece un arma distinta de las que se tienen, y se la agarra con E", () => {
    const h = harness(1, 11);
    const p = h.state.players[0]!;
    const spot = h.map.boxSpots[h.state.box.spot]!;
    h.state.doorsOpen = 0xff;
    p.points = BOX_PRICE;
    pressAt(h, spot.x + 1, spot.z);
    expect(h.state.box.phase).toBe(1);
    expect(p.points).toBe(0);
    h.run(BOX_SPIN_TICKS);
    expect(h.state.box.phase).toBe(2);
    const offered = h.state.box.weapon;
    expect(offered).not.toBe(M1911);
    expect(weapon(offered).box).toBeGreaterThan(0);
    pressAt(h, spot.x + 1, spot.z);
    expect(p.slots).toContain(offered);
    expect(h.state.box.phase).toBe(0);
  });

  it("el Pack-a-Punch se lleva el arma, la devuelve mejorada y con el nombre nuevo", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    h.state.doorsOpen = 0xff;
    h.state.power = true;
    p.points = PAP_PRICE;
    pressAt(h, h.map.pap.x, h.map.pap.z + 1.5);
    expect(h.state.pap.phase).toBe(1);
    expect(p.slots[0]).toBe(-1);
    h.run(PAP_TICKS);
    expect(h.state.pap.phase).toBe(2);
    pressAt(h, h.map.pap.x, h.map.pap.z + 1.5);
    expect(p.slots[0]).toBe(M1911);
    expect(p.pap[0]).toBe(1);
    expect(p.ammo[0]).toBe(weaponStats(M1911, true).mag);
    expect(weaponStats(M1911, true).name).toBe("Mustang & Sally");
    expect(weaponStats(M1911, true).explosive).toBeGreaterThan(0);
  });

  it("se reparan las tablas sosteniendo E y pagan hasta un tope por ronda", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const b = h.map.barriers[0]!;
    h.state.boards[0] = 0;
    p.x = b.inside.x;
    p.z = b.inside.z;
    const before = p.points;
    h.run(200, { 1: { use: true } });
    expect(h.state.boards[0]).toBe(6);
    expect(p.points).toBe(before + 60);
    h.state.boards[0] = 0;
    h.run(200, { 1: { use: true } });
    // Sólo diez tablas pagan por ronda.
    expect(p.points).toBe(before + 100);
  });

  it("la luz se prende una vez y habilita Speed Cola", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    h.state.doorsOpen = 0xff;
    pressAt(h, h.map.power.x, h.map.power.z + 1.2);
    expect(h.state.power).toBe(true);
    const sc = h.map.perks.find((m) => m.perk === PERK_SPEED)!;
    p.points = 3000;
    pressAt(h, sc.x - 0.8, sc.z);
    expect(hasPerk(p, PERK_SPEED)).toBe(true);
  });
});
