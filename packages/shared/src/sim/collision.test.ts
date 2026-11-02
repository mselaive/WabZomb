import { describe, expect, it } from "vitest";
import { FABRICA as map } from "../map/fabrica.js";
import { collisionBoxes, overlapsAny, stepPlayerMovement } from "./movement.js";
import { createPlayer } from "./step.js";
import type { PlayerInput } from "./types.js";

const input = (seq: number, yaw: number, over: Partial<PlayerInput>): PlayerInput => ({ seq, fwd: 1, side: 0, yaw, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, sprint: true, scope: false, use: false, melee: false, act: 0, view: -1, ...over });

describe("chocar contra los muebles", () => {
  const boxes = collisionBoxes({ doorsOpen: 0xffff }, map);
  const furniture = map.boxes.filter((b) => !b.decal && !b.hidden && !b.thin && b.maxY < 4 && b.maxY > 0.1 && b.maxX - b.minX < 10 && b.maxZ - b.minZ < 10);

  it("corriendo y saltando desde todos los ángulos: nunca te teletransporta ni te deja adentro", () => {
    const bad: string[] = [];
    for (const f of furniture) {
      const cx = (f.minX + f.maxX) / 2;
      const cz = (f.minZ + f.maxZ) / 2;
      const r = Math.max(f.maxX - f.minX, f.maxZ - f.minZ) / 2 + 1.2;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const sx = cx + Math.cos(ang) * r;
        const sz = cz + Math.sin(ang) * r;
        if (overlapsAny(sx, 0.01, sz, 1.8, boxes)) continue;
        for (const [jump, rounded] of [[false, false], [true, false], [false, true], [true, true]] as const) {
          const p = createPlayer(1);
          p.alive = true;
          p.x = sx;
          p.z = sz;
          p.y = 0.001;
          const yaw = Math.atan2(-(cx - sx), -(cz - sz)) + (a % 3 - 1) * 0.5;
          for (let i = 0; i < 50; i++) {
            const prev = { x: p.x, y: p.y, z: p.z };
            stepPlayerMovement(p, input(i, yaw, { jump }), boxes, true);
            // Como llega por la red: redondeado a centímetros.
            if (rounded) {
              p.x = Math.round(p.x * 100) / 100;
              p.y = Math.round(p.y * 100) / 100;
              p.z = Math.round(p.z * 100) / 100;
            }
            const jumpTp = Math.hypot(p.x - prev.x, p.z - prev.z) > 1 || Math.abs(p.y - prev.y) > 1;
            const inside = !rounded && overlapsAny(p.x, p.y, p.z, 1.8, boxes);
            if (jumpTp || inside || p.y > 2.6 || p.y < -0.05) {
              bad.push(`caja ${f.minX},${f.minZ} a=${a} jump=${jump} rounded=${rounded} i=${i} pos=${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}${inside ? " adentro" : ""}`);
              break;
            }
          }
        }
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
  }, 60_000);

  it("rozando un mueble con unos milímetros de redondeo no salta a la otra punta", () => {
    // El mostrador de la oficina: x -1,4..1,4, z 13,6..14,4. Parado 5 mm adentro, caminando a lo largo.
    const p = createPlayer(1);
    p.alive = true;
    p.x = -1.695;
    p.z = 13.8;
    p.y = 0.001;
    let last = p.z;
    for (let i = 0; i < 12; i++) {
      stepPlayerMovement(p, input(i, Math.PI, { sprint: false }), boxes, true);
      expect(Math.abs(p.z - last)).toBeLessThan(0.5);
      expect(p.x).toBeLessThan(-1.6);
      last = p.z;
    }
    expect(p.z).toBeGreaterThan(14.7);
  });

  it("con la posición redondeada a centímetros, como llega por la red, no se atraviesa nada", () => {
    // Contra la pared del fondo de la oficina (z 18) y contra un cajón, redondeando en cada paso.
    for (const [sx, sz, yaw, limit] of [
      [2, 16, Math.PI, (p: { z: number }) => p.z < 17.72],
      [-2, 11.5, 0, (p: { z: number }) => p.z >= 9.58],
    ] as const) {
      const p = createPlayer(1);
      p.alive = true;
      p.x = sx;
      p.z = sz;
      p.y = 0.001;
      for (let i = 0; i < 80; i++) {
        stepPlayerMovement(p, input(i, yaw, {}), boxes, true);
        p.x = Math.round(p.x * 100) / 100;
        p.y = Math.round(p.y * 100) / 100;
        p.z = Math.round(p.z * 100) / 100;
        expect(limit(p), "z=" + p.z).toBe(true);
      }
    }
  });
});
