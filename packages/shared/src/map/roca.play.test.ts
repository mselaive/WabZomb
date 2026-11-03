import { describe, expect, it } from "vitest";
import { BREAKER_TICKS, EGG_FURNACE, EGG_SONG, PLAYER_HEIGHT, TICK_RATE } from "../constants.js";
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

describe("lo que no se podía usar", () => {
  const boxes = collisionBoxes({ doorsOpen: (1 << ROCA.doors.length) - 1 }, ROCA);
  const bodyAt = (x: number, y: number, z: number) => ({ x, y: y + 0.01, z, vx: 0, vy: 0, vz: 0, yaw: 0, crouch: 0, trail: [] as number[], onGround: true });

  it("la escalera de incendios se sube desde el patio y se llega a la terraza", () => {
    const b = bodyAt(-54, 0, 14.3);
    for (let i = 0; i < 260 && b.x < -34; i++) moveBody(b, 1, 0, 4.6, false, PLAYER_HEIGHT, boxes);
    expect(b.x, "llegó al descanso").toBeGreaterThanOrEqual(-34);
    expect(b.y).toBeGreaterThan(9.2);
    // Del descanso, por el hueco del pretil, a la terraza.
    for (let i = 0; i < 60 && b.z > 11; i++) moveBody(b, 0, -1, 4.6, false, PLAYER_HEIGHT, boxes);
    expect(b.z, "pasó el pretil").toBeLessThan(11);
    expect(b.y).toBeGreaterThan(9.2);
    // Y baja igual.
    for (let i = 0; i < 60 && b.z < 14.3; i++) moveBody(b, 0, 1, 4.6, false, PLAYER_HEIGHT, boxes);
    for (let i = 0; i < 260 && b.x > -53; i++) moveBody(b, -1, 0, 4.6, false, PLAYER_HEIGHT, boxes);
    expect(b.y).toBeLessThan(0.3);
  });

  it("no hay pared invisible en el medio del patio: se salta sin chocar arriba, y un zombi sube la escalera", () => {
    const z = bodyAt(-45, 0, 30);
    expect(overlapsAny(-45, 6.8, 30, PLAYER_HEIGHT, boxes)).toBeNull();
    void z;
    const grid = navGridFor(ROCA);
    const path = findPath(grid, -54, 14.3, -50, 0, 0, 9.3);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]!.y).toBeGreaterThan(9);
  });

  it("la bajada a la ciudadela se camina desde la calle D hasta el piso de abajo", () => {
    const b = bodyAt(23, 0, 10.7);
    for (let i = 0; i < 200 && b.x > 12.5; i++) moveBody(b, -1, 0, 4.6, false, PLAYER_HEIGHT, boxes);
    expect(b.x).toBeLessThanOrEqual(12.5);
    expect(b.y).toBeLessThan(-3.9);
  });

  it("el hueco de esa bajada no está tapado por el piso de arriba", () => {
    for (const b of ROCA.boxes) {
      if (!b.decal || b.maxY > 0.1 || b.minY < -0.1) continue;
      const overlap = b.minX < 20 && b.maxX > 15.6 && b.minZ < 11.4 && b.maxZ > 10;
      expect(overlap, `un piso tapa el hueco: ${b.minX},${b.minZ}`).toBe(false);
    }
  });

  it("solo, corriendo, las tres llaves de corte entran holgadas en sus 45 segundos", () => {
    const q = ROCA.quest!;
    const grid = navGridFor(ROCA);
    let metres = 0;
    for (let i = 0; i + 1 < q.breakers.length; i++) {
      const a = q.breakers[i]!;
      const c = q.breakers[i + 1]!;
      const offA = Math.abs(a.x) > 29 ? -Math.sign(a.x) * 0.8 : 0;
      const offC = Math.abs(c.x) > 29 ? -Math.sign(c.x) * 0.8 : 0;
      const path = findPath(grid, a.x + offA, a.z + (offA ? 0 : 0.8), c.x + offC, c.z + (offC ? 0 : 0.8), a.y, c.y);
      expect(path, `de ${a.name} a ${c.name}`).not.toBeNull();
      let x = a.x + offA;
      let z = a.z + (offA ? 0 : 0.8);
      for (const n of path!) {
        metres += Math.hypot(n.x - x, n.z - z);
        x = n.x;
        z = n.z;
      }
    }
    // Corriendo se hacen unos 6,6 m/s; se cuenta caminando a 5 para dejar margen.
    expect(metres / 5).toBeLessThan(BREAKER_TICKS / TICK_RATE - 8);
  });
});
