import { appendFileSync } from "node:fs";
import { describe, it } from "vitest";
import { harness } from "../sim/helpers.test-util.js";
import { Z_HUNT } from "../sim/types.js";
import { ROCA } from "./roca.js";

/**
 * No prueba una regla: mide. Deja al jugador quieto en cada zona con todas las
 * puertas abiertas y cuenta dónde se traban los zombis (quietos cazando) y a cuántos
 * hay que reciclar. Sólo corre con ROCA_QA=1:
 *
 *   ROCA_QA=1 npx vitest run packages/shared/src/map/roca.qa.test.ts
 */
const QA = process.env.ROCA_QA === "1";

describe.runIf(QA)("medición de zombis trabados", () => {
  const places: [string, number, number, number][] = [
    ["Broadway", 0, 0, 0],
    ["Galería", 6, 2.81, -2.45],
    ["Times Square", -27.5, 0, 12],
    ["Control", 27, 0, -12],
    ["Michigan", 0, 0, -12.4],
    ["Calle D", 8, 0, 12.4],
    ["Biblioteca", 20, 0, 14.5],
    ["Ciudadela", 8, -3.99, 12.5],
    ["Horno", 14, -3.99, 15.5],
    ["Comedor", -45, 0, 0],
    ["Cocina", -70, 0, 0],
    ["Patio", -45, 0, 30],
    ["Hospital", -45, 5.61, 0],
    ["Terraza", -50, 9.31, 0],
    ["Techo", 10, 11.41, 5],
    ["Administración", 40, 0, 0],
    ["Muelle", 25, -7.99, 60],
    ["Espigón", 25, -7.99, 86],
  ];
  for (const [name, x, y, z] of places) {
    it(name, () => {
      const h = harness(1, 11, ROCA);
      h.state.doorsOpen = (1 << ROCA.doors.length) - 1;
      h.state.power = true;
      h.state.round.number = 6;
      h.state.round.ticksLeft = 1;
      const p = h.state.players[0]!;
      const stuck = new Map<string, number>();
      let reached = 0;
      let hunted = 0;
      const seen = new Set<number>();
      const before = () => h.state.zombies.length;
      let recycled = 0;
      for (let t = 0; t < 1800; t++) {
        p.x = x;
        p.y = y;
        p.z = z;
        p.vx = p.vy = p.vz = 0;
        p.hp = 1_000_000;
        p.down = false;
        p.alive = true;
        const n = before();
        const spawned = h.state.round.spawned;
        h.tick();
        if (h.state.round.spawned < spawned) recycled += spawned - h.state.round.spawned;
        void n;
        for (const zb of h.state.zombies) {
          if (zb.state !== Z_HUNT) continue;
          hunted++;
          if (Math.hypot(zb.x - x, zb.z - z) < 2 && Math.abs(zb.y - y) < 1.5 && !seen.has(zb.id)) {
            seen.add(zb.id);
            reached++;
          }
          if (zb.stuck >= 25) {
            const key = `${Math.round(zb.x)},${Math.round(zb.y)},${Math.round(zb.z)}`;
            stuck.set(key, (stuck.get(key) ?? 0) + 1);
          }
        }
      }
      const top = [...stuck.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join(" ");
      appendFileSync(process.env.ROCA_QA_OUT ?? "roca-qa.txt", `${name.padEnd(16)} llegaron ${String(reached).padStart(3)}  reciclados ${String(recycled).padStart(3)}  trabados ${top || "-"}
`);
      void hunted;
    }, 300_000);
  }
});
