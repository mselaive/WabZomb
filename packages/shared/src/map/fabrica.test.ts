import { describe, expect, it } from "vitest";
import { BOARD_MAX } from "../constants.js";
import { buildNavGrid, findPath, hasFloorNear, navGridFor, nodesOfBox } from "../sim/nav.js";
import { createGameState } from "../sim/step.js";
import { openZones } from "../sim/zombies.js";
import { FABRICA } from "./fabrica.js";
import { zoneAt } from "./types.js";

describe("La Fábrica", () => {
  const map = FABRICA;
  const grid = navGridFor(map);

  it("tiene ocho zonas conectadas por las puertas, con la oficina de arranque", () => {
    expect(map.zones.length).toBe(8);
    const all = openZones({ doorsOpen: (1 << map.doors.length) - 1 }, map);
    expect(all.size).toBe(8);
    expect(openZones({ doorsOpen: 0 }, map).size).toBe(1);
    // Por el depósito o por el patio se llega al laboratorio: dos caminos.
    expect(openZones({ doorsOpen: (1 << 0) | (1 << 2) | (1 << 4) }, map).has(5)).toBe(true);
    expect(openZones({ doorsOpen: (1 << 1) | (1 << 3) | (1 << 5) }, map).has(5)).toBe(true);
  });

  it("los spawns están en la oficina y de ahí se camina a cada zona con las puertas abiertas", () => {
    for (const s of map.spawns) expect(zoneAt(map, s.x, s.z)).toBe(map.startZone);
    const s = map.spawns[0]!;
    for (const zn of map.zones) {
      const cx = (zn.minX + zn.maxX) / 2;
      const cz = (zn.minZ + zn.maxZ) / 2;
      // Al centro de la zona o cerca (puede haber una caja justo ahí).
      const path = findPath(grid, s.x, s.z, cx, cz, 0, NaN);
      expect(path, `camino a ${zn.name}`).not.toBeNull();
    }
  });

  it("con las puertas cerradas no se pasa de la oficina", () => {
    const state = createGameState();
    const blocked = new Set<number>();
    for (const d of map.doors) for (const c of nodesOfBox(grid, d.box)) blocked.add(c);
    expect(blocked.size).toBeGreaterThan(0);
    const s = map.spawns[0]!;
    const dep = map.zones[1]!;
    expect(findPath(grid, s.x, s.z, (dep.minX + dep.maxX) / 2, (dep.minZ + dep.maxZ) / 2, 0, NaN, blocked)).toBeNull();
    void state;
  });

  it("cada ventana tiene su hueco en la zona correcta, con el adentro pisable", () => {
    expect(map.barriers.length).toBeGreaterThanOrEqual(12);
    for (const b of map.barriers) {
      expect(zoneAt(map, b.inside.x, b.inside.z), `ventana ${b.id} adentro`).toBe(b.zone);
      expect(zoneAt(map, b.outside.x, b.outside.z), `ventana ${b.id} afuera`).toBe(-1);
      expect(hasFloorNear(grid, b.inside.x, b.inside.z), `ventana ${b.id} piso adentro`).toBe(true);
    }
  });

  it("los spawners de afuera tienen ventana y los de adentro, piso", () => {
    for (const s of map.spawners) {
      if (s.barrier !== undefined) {
        expect(map.barriers[s.barrier]?.zone).toBe(s.zone);
        expect(zoneAt(map, s.x, s.z)).toBe(-1);
      } else {
        expect(zoneAt(map, s.x, s.z)).toBe(s.zone);
        expect(hasFloorNear(grid, s.x, s.z), `spawner en ${s.x},${s.z}`).toBe(true);
      }
    }
    for (const zn of map.zones) expect(map.spawners.some((s) => s.zone === zn.id), `spawners de ${zn.name}`).toBe(true);
  });

  it("lo que se compra está en su zona y al lado de piso caminable", () => {
    for (const w of map.wallWeapons) {
      expect(zoneAt(map, w.x, w.z), `arma ${w.weapon}`).toBe(w.zone);
      expect(hasFloorNear(grid, w.x, w.z, 3)).toBe(true);
    }
    for (const m of map.perks) {
      expect(zoneAt(map, m.x, m.z), `bebida ${m.perk}`).toBe(m.zone);
      expect(hasFloorNear(grid, m.x, m.z, 3)).toBe(true);
    }
    for (const b of map.boxSpots) {
      expect(zoneAt(map, b.x, b.z)).toBe(b.zone);
      expect(hasFloorNear(grid, b.x, b.z, 3)).toBe(true);
    }
    expect(zoneAt(map, map.pap.x, map.pap.z)).toBe(map.pap.zone);
    expect(zoneAt(map, map.power.x, map.power.z)).toBe(map.power.zone);
    for (const d of map.doors) {
      const [a, b] = d.zones;
      if (!d.locked) expect(a).not.toBe(b);
    }
    expect(new Set(map.perks.map((m) => m.perk)).size).toBe(6);
    expect(BOARD_MAX).toBe(6);
  });

  it("ninguna máquina, caja ni lugar de aparición queda adentro de un mueble", () => {
    // Lo bajo (tarimas, hasta un escalón) no cuenta: se pisa.
    const inside = (x: number, z: number, hw: number, hd: number) =>
      map.boxes.filter((b) => !b.decal && !b.hidden && b.maxY > 0.45 && b.minY < 2 && x + hw > b.minX && x - hw < b.maxX && z + hd > b.minZ && z - hd < b.maxZ);
    for (const m of map.perks) expect(inside(m.x, m.z, 0.6, 0.6), `bebida ${m.perk}`).toEqual([]);
    for (const b of map.boxSpots) expect(inside(b.x, b.z, 0.7, 0.7), `caja en ${b.x},${b.z}`).toEqual([]);
    expect(inside(map.pap.x, map.pap.z, 0.9, 0.7), "Pack-a-Punch").toEqual([]);
    expect(inside(map.power.x, map.power.z, 0.5, 0.3), "la luz").toEqual([]);
    for (const s of map.spawners) if (s.barrier === undefined) expect(inside(s.x, s.z, 0.35, 0.35), `spawner en ${s.x},${s.z}`).toEqual([]);
    // Donde cae el zombi al pasar la ventana no puede haber nada, ni bajo: quedaría metido adentro.
    for (const b of map.barriers) {
      const low = map.boxes.filter((o) => !o.decal && !o.hidden && o.maxY > 0.05 && o.minY < 2 && b.inside.x + 0.35 > o.minX && b.inside.x - 0.35 < o.maxX && b.inside.z + 0.35 > o.minZ && b.inside.z - 0.35 < o.maxZ);
      expect(low, `ventana ${b.id}`).toEqual([]);
    }
  });

  it("la grilla se arma en un tiempo razonable", () => {
    const t0 = performance.now();
    buildNavGrid(map);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});
