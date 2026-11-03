import { describe, expect, it } from "vitest";
import { EGG_FURNACE, EGG_SONG, PLAYER_HEIGHT } from "../constants.js";
import { harness } from "../sim/helpers.test-util.js";
import { findInteraction } from "../sim/interact.js";
import { collisionBoxes, moveBody, overlapsAny } from "../sim/movement.js";
import { findPath, navGridFor } from "../sim/nav.js";
import { Z_HUNT } from "../sim/types.js";
import { createZombie } from "../sim/zombies.js";
import { ROCA } from "./roca.js";

/** Se juega de verdad en La Roca: comprar, subir, y que los zombis lleguen. */
describe("jugando en La Roca", () => {
  const all = (1 << ROCA.doors.length) - 1;

  it("se compra la reja de Broadway y se pasa a Times Square", () => {
    const h = harness(1, 7, ROCA);
    h.state.round.ticksLeft = 100_000;
    const p = h.state.players[0]!;
    p.points = 750;
    p.x = -22.5;
    p.z = 0;
    const it0 = findInteraction(h.state, p, ROCA);
    expect(it0?.kind).toBe("door");
    expect(it0?.price).toBe(750);
    h.tick({ 1: { use: false } });
    h.tick({ 1: { use: true } });
    expect(h.state.doorsOpen & 1).toBe(1);
    h.run(40, { 1: { fwd: 1, yaw: Math.PI / 2, use: false } });
    expect(p.x).toBeLessThan(-25);
  });

  it("una máquina del piso de abajo no se usa desde la galería de arriba", () => {
    const h = harness(1, 7, ROCA);
    const p = h.state.players[0]!;
    const qr = ROCA.perks[0]!;
    p.x = qr.x;
    p.z = 2.45;
    p.y = 0;
    expect(findInteraction(h.state, p, ROCA)?.kind).toBe("perk");
    p.y = 2.8;
    expect(findInteraction(h.state, p, ROCA)?.kind).not.toBe("perk");
  });

  it("un zombi sube la escalera hasta la galería y llega al jugador", () => {
    const h = harness(1, 7, ROCA);
    h.state.doorsOpen = all;
    h.state.round.ticksLeft = 1;
    const p = h.state.players[0]!;
    p.x = 6;
    p.y = 2.81;
    p.z = -2.45;
    p.hp = 100_000;
    // Hasta que aparezca uno, y que camine.
    let reached = false;
    for (let t = 0; t < 2400 && !reached; t++) {
      h.tick();
      p.hp = 100_000;
      if (h.state.zombies.some((z) => z.state === Z_HUNT && Math.abs(z.y - p.y) < 0.5 && Math.hypot(z.x - p.x, z.z - p.z) < 2)) reached = true;
    }
    expect(reached).toBe(true);
  });

  it("los zombis salen de las celdas tapiadas: arrancan las tablas y entran al pasillo", () => {
    const h = harness(1, 3, ROCA);
    h.state.round.ticksLeft = 1;
    const p = h.state.players[0]!;
    p.hp = 100_000;
    let inCorridor = false;
    for (let t = 0; t < 2400 && !inCorridor; t++) {
      h.tick();
      p.hp = 100_000;
      inCorridor = h.state.zombies.some((z) => z.state === Z_HUNT && Math.abs(z.z) < 2.9);
    }
    expect(inCorridor).toBe(true);
    expect(h.events.some((e) => e.t === "board")).toBe(true);
  });

  it("el horno sólo junta las almas de los que mueren a su altura: los de la calle D, justo arriba, no cuentan", () => {
    const killAt = (px: number, py: number, pz: number, zx: number, zz: number): number => {
      const h = harness(1, 7, ROCA);
      h.state.egg = EGG_SONG;
      h.state.doorsOpen = all;
      h.state.round.ticksLeft = 100_000;
      const p = h.state.players[0]!;
      p.x = px;
      p.y = py;
      p.z = pz;
      p.onGround = true;
      const z = createZombie(h.state, { zone: 6, x: zx, y: py, z: zz }, ROCA, () => 0.5);
      z.x = zx;
      z.z = zz;
      z.hp = 1;
      z.state = Z_HUNT;
      h.state.zombies.push(z);
      h.shootNearest();
      h.shootNearest();
      expect(h.events.some((e) => e.t === "zkill"), "lo mató").toBe(true);
      return h.state.eggSouls;
    };
    expect(killAt(9, 0.01, 14, 13, 14)).toBe(0);
    expect(killAt(9, ROCA.furnace.y! + 0.01, 14, 13, 14)).toBe(1);
  });
});

/** Camina de verdad, con la física de los jugadores, siguiendo el camino de la grilla. */
function walkTo(toX: number, toY: number, toZ: number): { x: number; y: number; z: number; ok: boolean } {
  const grid = navGridFor(ROCA);
  const boxes = collisionBoxes({ doorsOpen: (1 << ROCA.doors.length) - 1 }, ROCA);
  const s = ROCA.spawns[0]!;
  const body = { x: s.x, y: s.y + 0.01, z: s.z, vx: 0, vy: 0, vz: 0, yaw: 0, crouch: 0, trail: [] as number[], onGround: true };
  const path = findPath(grid, body.x, body.z, toX, toZ, body.y, toY);
  if (!path) return { x: body.x, y: body.y, z: body.z, ok: false };
  let i = 0;
  let stuck = 0;
  for (let t = 0; t < 6000 && i < path.length; t++) {
    const n = path[i]!;
    const dx = n.x - body.x;
    const dz = n.z - body.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) {
      i++;
      stuck = 0;
      continue;
    }
    const bx = body.x;
    const bz = body.z;
    moveBody(body, dx / d, dz / d, 4, false, PLAYER_HEIGHT, boxes);
    stuck = Math.hypot(body.x - bx, body.z - bz) < 0.01 ? stuck + 1 : 0;
    if (stuck > 40) break;
  }
  return { x: body.x, y: body.y, z: body.z, ok: i >= path.length };
}

describe("las piezas y las radios de La Roca", () => {
  it("cada pieza se alcanza parado en un lugar al que se llega caminando", () => {
    const floors = [5.6, -8, -4];
    ROCA.eggParts.forEach((part, i) => {
      const y = floors[i]!;
      const h = harness(1, 7, ROCA);
      h.state.round.ticksLeft = 100_000;
      h.state.doorsOpen = (1 << ROCA.doors.length) - 1;
      h.state.egg = EGG_SONG | EGG_FURNACE;
      const p = h.state.players[0]!;
      let ok = false;
      for (let a = 0; a < 24 && !ok; a++) {
        for (const r of [0.7, 1.1, 1.5, 1.9]) {
          p.x = part.x + Math.cos((a / 24) * Math.PI * 2) * r;
          p.z = part.z + Math.sin((a / 24) * Math.PI * 2) * r;
          p.y = y;
          if (overlapsAny(p.x, y + 0.02, p.z, PLAYER_HEIGHT, h.map.boxes)) continue;
          const it = findInteraction(h.state, p, ROCA);
          if (it?.kind === "part" && it.id === i) {
            ok = true;
            break;
          }
        }
      }
      expect(ok, `pieza ${i}`).toBe(true);
    });
  });
});

describe("recorriendo La Roca a pie", () => {
  for (const [name, x, y, z] of [
    ["Times Square", -27.5, 0, 12],
    ["Control", 27, 0, -12],
    ["galería", 6, 2.8, 2.45],
    ["puente", -11.4, 2.8, 0],
    ["descanso del hospital", -30.2, 5.6, -8],
    ["hospital", -45, 5.6, 0],
    ["terraza", -50, 9.3, 0],
    ["techo", 10, 11.4, 5],
    ["comedor", -45, 0, 0],
    ["cocina", -70, 0, 0],
    ["patio", -45, 0, 30],
    ["ciudadela", 5, -4, 12],
    ["Michigan", 0, 0, -12.4],
    ["calle D", 0, 0, 12.4],
    ["biblioteca", 20, 0, 15],
    ["administración", 40, 0, -10],
    ["muelle", 25, -8, 60],
    ["espigón", 25, -8, 86],
  ] as const) {
    it(`se llega caminando a ${name}`, () => {
      const r = walkTo(x, y, z);
      expect(r.ok, `se trabó en ${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.z.toFixed(1)}`).toBe(true);
      expect(Math.abs(r.y - y), `quedó a altura ${r.y.toFixed(2)}`).toBeLessThan(0.6);
    });
  }
});
