import { describe, expect, it } from "vitest";
import { PLAYER_HEIGHT } from "../constants.js";
import { collisionBoxes, moveBody, overlapsAny } from "../sim/movement.js";
import { findPath, hasFloorNear, navGridFor, nodeAt, nodesOfBox } from "../sim/nav.js";
import { openZones } from "../sim/zombies.js";
import { ROCA } from "./roca.js";
import { zoneAt } from "./types.js";

describe("La Roca", () => {
  const map = ROCA;
  const grid = navGridFor(map);
  const start = map.spawns[0]!;
  const all = (1 << map.doors.length) - 1;
  const openBoxes = collisionBoxes({ doorsOpen: all }, map);

  /** ¿Se llega caminando de la sala de arranque a este lugar con todas las puertas abiertas? */
  const reachable = (x: number, y: number, z: number) => findPath(grid, start.x, start.z, x, z, start.y, y);

  it("el lugar de cada puerta es su número, y entran en la máscara de bits", () => {
    map.doors.forEach((d, i) => expect(d.id).toBe(i));
    expect(map.doors.length).toBeLessThan(31);
  });

  it("todas las zonas se abren desde Broadway por sus puertas", () => {
    expect(openZones({ doorsOpen: all }, map).size).toBe(map.zones.length);
    expect(openZones({ doorsOpen: 0 }, map).size).toBe(1);
  });

  it("los spawns están parados en Broadway, sin nada encima", () => {
    for (const s of map.spawns) {
      expect(zoneAt(map, s.x, s.z, s.y)).toBe(map.startZone);
      expect(overlapsAny(s.x, s.y + 0.01, s.z, PLAYER_HEIGHT, openBoxes)).toBeNull();
    }
  });

  it("con las puertas cerradas no se sale de Broadway", () => {
    const blocked = new Set<number>();
    for (const d of map.doors) for (const c of nodesOfBox(grid, d.box)) blocked.add(c);
    for (const [name, x, y, z] of [["Times Square", -27.5, 0, 0], ["Control", 27, 0, 0], ["la galería", 6, 2.8, -2.45]] as const) {
      expect(findPath(grid, start.x, start.z, x, z, 0, y, blocked), name).toBeNull();
    }
    // Pero sí se recorre Broadway.
    expect(findPath(grid, start.x, start.z, -20, 0, 0, 0, blocked)).not.toBeNull();
  });

  it("una puerta del segundo piso no corta el paso en la planta baja", () => {
    const d = map.doors.find((q) => q.name === "Entrada al hospital")!;
    const blocked = new Set(nodesOfBox(grid, d.box));
    expect(blocked.size).toBeGreaterThan(0);
    expect(findPath(grid, -27.5, 0, -27.5, 12, 0, 0, blocked)).not.toBeNull();
  });

  it("se llega a cada zona y a cada altura: la galería, el hospital, la azotea, la ciudadela y el muelle", () => {
    for (const [name, x, y, z] of [
      ["galería sur", 6, 2.8, 2.45],
      ["galería norte", 6, 2.8, -2.45],
      ["comedor", -45, 0, 0],
      ["cocina", -70, 0, 0],
      ["patio", -45, 0, 30],
      ["hospital", -45, 5.6, 0],
      ["terraza", -50, 9.3, 0],
      ["techo", 10, 11.4, 5],
      ["ciudadela", 5, -4, 12],
      ["administración", 40, 0, 0],
      ["muelle", 25, -8, 60],
      ["espigón", 25, -8, 85],
    ] as const) {
      const path = reachable(x, y, z);
      expect(path, name).not.toBeNull();
      expect(Math.abs(path![path!.length - 1]!.y - y), `${name}: llega a la altura`).toBeLessThan(0.3);
    }
  });

  it("cada ventana y celda tapiada tiene el adentro pisable y el afuera fuera de la zona", () => {
    expect(map.barriers.length).toBeGreaterThanOrEqual(25);
    for (const b of map.barriers) {
      const y = b.y ?? 0;
      expect(zoneAt(map, b.inside.x, b.inside.z, y), `${b.id} adentro`).toBe(b.zone);
      expect(zoneAt(map, b.outside.x, b.outside.z, y), `${b.id} afuera`).toBe(-1);
      const node = nodeAt(grid, b.inside.x, y, b.inside.z);
      expect(node, `${b.id} piso adentro`).toBeGreaterThanOrEqual(0);
    }
  });

  it("los spawners tienen ventana o piso, y están en su zona", () => {
    for (const s of map.spawners) {
      if (s.barrier !== undefined) {
        expect(map.barriers[s.barrier]?.zone).toBe(s.zone);
        expect(overlapsAny(s.x, s.y + 0.02, s.z, PLAYER_HEIGHT, map.boxes), `spawner ${s.x},${s.z}`).toBeNull();
      } else {
        expect(zoneAt(map, s.x, s.z, s.y), `spawner ${s.x},${s.y},${s.z}`).toBe(s.zone);
        expect(reachable(s.x, s.y, s.z), `spawner ${s.x},${s.y},${s.z}`).not.toBeNull();
      }
    }
  });

  it("se alcanza cada cosa que se compra, parado a su altura", () => {
    const check = (name: string, x: number, y: number, z: number) => {
      // Alguna celda a menos de 2 m tiene piso a esa altura y se llega caminando.
      let ok = false;
      for (let a = 0; a < 16 && !ok; a++) {
        for (const r of [0.8, 1.2, 1.6, 2]) {
          const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
          const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
          if (overlapsAny(px, y + 0.02, pz, PLAYER_HEIGHT, openBoxes)) continue;
          const p = reachable(px, y, pz);
          if (p && Math.abs(p[p.length - 1]!.y - y) < 0.3) {
            ok = true;
            break;
          }
        }
      }
      expect(ok, name).toBe(true);
    };
    for (const m of map.perks) check(`bebida ${m.perk}`, m.x, m.y ?? 0, m.z);
    for (const s of map.boxSpots) check(`caja ${s.x},${s.z}`, s.x, s.y ?? 0, s.z);
    for (const w of map.wallWeapons) check(`pared ${w.weapon}`, w.x, w.y - 1.5, w.z);
    check("pack-a-punch", map.pap.x, map.pap.y ?? 0, map.pap.z);
    check("la luz", map.power.x, map.power.y ?? 0, map.power.z);
    check("el banco", map.bench.x, map.bench.y ?? 0, map.bench.z);
    check("el horno", map.furnace.x, map.furnace.y ?? 0, map.furnace.z);
    const radioFloors = [5.6, -4, 11.4];
    map.radios.forEach((r, i) => check(`radio ${i}`, r.x, radioFloors[i]!, r.z));
  });

  it("la escalera de Broadway se sube y se baja caminando, sin saltar", () => {
    const body = { x: -23.2, y: 0.01, z: 2.45, vx: 0, vy: 0, vz: 0, yaw: 0, crouch: 0, trail: [], onGround: true };
    for (let i = 0; i < 90; i++) moveBody(body, 1, 0, 4, false, PLAYER_HEIGHT, openBoxes);
    expect(body.y).toBeGreaterThan(2.7);
    expect(body.x).toBeGreaterThan(-18);
    for (let i = 0; i < 90; i++) moveBody(body, -1, 0, 4, false, PLAYER_HEIGHT, openBoxes);
    expect(body.y).toBeLessThan(0.2);
  });

  it("no hay máquinas ni armas de pared metidas adentro de algo", () => {
    for (const m of map.perks) expect(hasFloorNear(grid, m.x, m.z, 4), `bebida ${m.perk}`).toBe(true);
    for (const b of map.barriers) expect(b.box.maxX).toBeGreaterThan(b.box.minX);
  });
});
