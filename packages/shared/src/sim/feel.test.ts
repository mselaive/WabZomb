import { describe, expect, it } from "vitest";
import { PLAYER_HEIGHT, zombieHp } from "../constants.js";
import { FABRICA } from "../map/fabrica.js";
import { ROCA } from "../map/roca.js";
import { viewDir } from "../math.js";
import { BRASAS, L96, M16, MP40, OLYMPIA, TRABUCO, weapon, weaponStats } from "../weapons.js";
import { shotDirections } from "./combat.js";
import { harness } from "./helpers.test-util.js";
import { findInteraction } from "./interact.js";
import { findWeaponByName, runTestCommand } from "./testCommands.js";
import { collisionBoxes, overlapsAny } from "./movement.js";
import { createPlayer } from "./step.js";

/** El yaw que mira de (x, z) hacia (tx, tz). */
function yawTo(x: number, z: number, tx: number, tz: number): number {
  let best = 0;
  let bestDot = -2;
  const len = Math.hypot(tx - x, tz - z);
  for (let i = 0; i < 720; i++) {
    const yaw = (i / 720) * Math.PI * 2;
    const f = viewDir(yaw, 0, { x: 0, y: 0, z: 0 });
    const dot = (f.x * (tx - x) + f.z * (tz - z)) / len;
    if (dot > bestDot) {
      bestDot = dot;
      best = yaw;
    }
  }
  return best;
}

describe("las armas pegan como en CoD", () => {
  it("la bala va al centro de la mira aunque se venga disparando seguido", () => {
    const p = createPlayer(1);
    p.onGround = true;
    p.yaw = 0.7;
    p.pitch = 0.1;
    const fwd = viewDir(p.yaw, p.pitch, { x: 0, y: 0, z: 0 });
    for (const recoil of [1, 6, 15]) {
      p.recoil = recoil;
      // El promedio de muchos tiros: la dispersión se cancela, un corrimiento no.
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let seq = 1; seq <= 400; seq++) {
        const d = shotDirections(p, MP40, seq)[0]!;
        sx += d.x;
        sy += d.y;
        sz += d.z;
      }
      const len = Math.hypot(sx, sy, sz);
      const off = Math.acos(Math.min(1, (sx * fwd.x + sy * fwd.y + sz * fwd.z) / len));
      expect(off, `con ${recoil} tiros seguidos`).toBeLessThan(0.004);
    }
  });

  it("en la ronda 10 alcanza con lo que se espera de cada arma", () => {
    const hp = zombieHp(10);
    expect(Math.ceil(hp / weapon(MP40).damage), "balas de MP40 al cuerpo").toBeLessThanOrEqual(15);
    expect(Math.ceil(hp / weapon(M16).damage), "balas de M16 al cuerpo").toBeLessThanOrEqual(12);
    expect(weapon(OLYMPIA).damage * weapon(OLYMPIA).pellets, "un escopetazo de Olympia, entero").toBeGreaterThanOrEqual(hp * 0.75);
    expect(weapon(L96).damage, "la L96 al cuerpo").toBeGreaterThanOrEqual(hp);
    expect(weaponStats(L96, true).damage * weapon(L96).head, "la L96 mejorada, a la cabeza, en la 20").toBeGreaterThanOrEqual(zombieHp(20));
  });
});

describe("comprar sin querer", () => {
  it("con un arma y una ventana al lado, E ofrece lo que se mira", () => {
    // La M16 de La Fábrica queda a menos de 2 m de una ventana.
    const ww = FABRICA.wallWeapons.find((w) => w.weapon === M16)!;
    const win = FABRICA.barriers.reduce((a, b) => {
      const da = Math.hypot((a.box.minX + a.box.maxX) / 2 - ww.x, (a.box.minZ + a.box.maxZ) / 2 - ww.z);
      const db = Math.hypot((b.box.minX + b.box.maxX) / 2 - ww.x, (b.box.minZ + b.box.maxZ) / 2 - ww.z);
      return db < da ? b : a;
    });
    const h = harness(1, 3, FABRICA);
    h.state.doorsOpen = (1 << FABRICA.doors.length) - 1;
    const p = h.state.players[0]!;
    p.y = 0.01;
    h.state.boards[win.id] = 0;
    const wx = (win.box.minX + win.box.maxX) / 2;
    const wz = (win.box.minZ + win.box.maxZ) / 2;
    const boxes = collisionBoxes(h.state, FABRICA);
    const toWin = (x: number, z: number) => Math.hypot(Math.max(win.box.minX - x, 0, x - win.box.maxX), Math.max(win.box.minZ - z, 0, z - win.box.maxZ));
    // Un lugar libre desde donde se alcanzan las dos cosas, y en el que se mira a cada una para lados distintos.
    let spot: { x: number; z: number } | null = null;
    for (let dx = -2; dx <= 2 && !spot; dx += 0.1) {
      for (let dz = -2; dz <= 2 && !spot; dz += 0.1) {
        const x = ww.x + dx;
        const z = ww.z + dz;
        const dw = Math.hypot(ww.x - x, ww.z - z);
        if (dw > 2.0 || dw < 1 || toWin(x, z) > 2.0 || overlapsAny(x, 0.02, z, PLAYER_HEIGHT, boxes)) continue;
        const a = viewDir(yawTo(x, z, wx, wz), 0, { x: 0, y: 0, z: 0 });
        const b = viewDir(yawTo(x, z, ww.x, ww.z), 0, { x: 0, y: 0, z: 0 });
        if (a.x * b.x + a.z * b.z < 0.3) spot = { x, z };
      }
    }
    expect(spot, "un lugar entre la ventana y el arma").not.toBeNull();
    p.x = spot!.x;
    p.z = spot!.z;
    p.yaw = yawTo(p.x, p.z, wx, wz);
    expect(findInteraction(h.state, p, FABRICA)?.kind, "mirando la ventana").toBe("barrier");
    p.yaw = yawTo(p.x, p.z, ww.x, ww.z);
    expect(findInteraction(h.state, p, FABRICA)?.kind, "mirando el arma").toBe("wall");
  });

  it("en La Roca ninguna arma de la pared queda encima de una ventana o una puerta", () => {
    const d2box = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
    for (const ww of ROCA.wallWeapons) {
      for (const b of ROCA.barriers) if (Math.abs(b.box.minY - (ww.y - 1.5)) < 2.5) expect(d2box(b.box, ww.x, ww.z), `${weapon(ww.weapon).name} y la ventana ${b.id}`).toBeGreaterThan(2.5);
      for (const d of ROCA.doors) if (Math.abs(d.box.minY - (ww.y - 1.5)) < 2.5) expect(d2box(d.box, ww.x, ww.z), `${weapon(ww.weapon).name} y ${d.name}`).toBeGreaterThan(2.5);
    }
  });
});

describe("los comandos para probar armas", () => {
  it("encuentra las armas por nombre, sin importar tildes ni mayúsculas", () => {
    expect(findWeaponByName("blundergat")).toBe(TRABUCO);
    expect(findWeaponByName("Blundergat de brasas")).toBe(BRASAS);
    expect(findWeaponByName("l96")).toBe(L96);
    expect(findWeaponByName("cualquier cosa")).toBeNull();
  });

  it("/arma da el arma, mejorada si se pide, y /puntos cambia los puntos", () => {
    const p = createPlayer(1);
    p.alive = true;
    expect(runTestCommand(p, "/arma blundergat pap")).toContain(weaponStats(TRABUCO, true).name);
    expect(p.slots[p.active]).toBe(TRABUCO);
    expect(p.pap[p.active]).toBe(1);
    runTestCommand(p, "/puntos 50000");
    expect(p.points).toBe(50000);
    expect(runTestCommand(p, "hola")).toBeNull();
    expect(runTestCommand(p, "/nada")).toContain("/arma");
  });
});
