import { describe, expect, it } from "vitest";
import { EGG_BEACON, EGG_BOAT, EGG_BOSS_DEAD, EGG_BOSS_ON, EGG_BREAKERS, EGG_BUILT, EGG_ESCAPED, EGG_FURNACE, EGG_KEY, EGG_PART_A, EGG_PART_B, EGG_PART_C, EGG_READY, EGG_SAFE, EGG_SONG, EGG_SOULS, ESCAPE_SIEGE_TICKS, PLAYER_HEIGHT, ZTYPE_BOSS } from "../constants.js";
import { damageZombie, killZombie } from "../sim/combat.js";
import { harness } from "../sim/helpers.test-util.js";
import { findInteraction, wheelAt } from "../sim/interact.js";
import { overlapsAny } from "../sim/movement.js";
import { THUNDERGUN } from "../weapons.js";
import { ROCA } from "./roca.js";

/**
 * La cadena entera, de punta a punta, con las mismas teclas que un jugador: en
 * cada paso se para al lado de la cosa, mira qué ofrece E y lo aprieta. Si algo
 * queda tapado por otra cosa, o un paso no habilita el siguiente, esto se rompe.
 */
describe("La Roca de punta a punta", () => {
  it("de prender la luz a escapar en la lancha", () => {
    const h = harness(1, 21, ROCA);
    const q = ROCA.quest!;
    const p = h.state.players[0]!;
    h.state.doorsOpen = 0;
    h.state.round.ticksLeft = 1_000_000;
    p.hp = 1_000_000;
    // Las puertas también se compran: hay plata de sobra para no depender de los puntos.
    p.points = 1_000_000;

    /** Se para cerca de (x, y, z), en un lugar libre desde el que E ofrezca lo que pide `want`. */
    const use = (name: string, x: number, y: number, z: number, want: (label: string) => boolean): void => {
      for (let a = 0; a < 48; a++) {
        for (const r of [0, 0.7, 1.0, 1.3, 1.6, 1.9, 2.2]) {
          const px = x + Math.cos((a / 48) * Math.PI * 2) * r;
          const pz = z + Math.sin((a / 48) * Math.PI * 2) * r;
          if (overlapsAny(px, y + 0.02, pz, PLAYER_HEIGHT, h.state.zombies.length >= 0 ? ROCA.boxes : [])) continue;
          p.x = px;
          p.y = y + 0.01;
          p.z = pz;
          const it0 = findInteraction(h.state, p, ROCA);
          if (it0 && it0.ok && want(it0.label)) {
            h.tick({ 1: { use: false } });
            h.tick({ 1: { use: true } });
            h.tick({ 1: { use: false } });
            return;
          }
        }
      }
      throw new Error(`no se pudo usar: ${name}`);
    };
    const has = (bit: number) => (h.state.egg & bit) !== 0;

    // 1. La luz.
    expect(h.state.power).toBe(false);
    use("la luz", ROCA.power.x, ROCA.power.y!, ROCA.power.z, (l) => l.includes("luz"));
    expect(h.state.power).toBe(true);

    // 2. Las radios: las tres, en orden.
    const radioFloors = [5.6, -4, 11.4];
    ROCA.radios.forEach((r, i) => use(`radio ${i}`, r.x, radioFloors[i]!, r.z, (l) => l.includes("radio")));
    expect(has(EGG_SONG)).toBe(true);
    expect(h.state.doorsOpen & (1 << 16)).toBe(1 << 16);

    // 3. Las piezas de la Thunder Gun.
    const floorsParts = [5.6, -8, -4];
    use("núcleo", ROCA.eggParts[0]!.x, floorsParts[0]!, ROCA.eggParts[0]!.z, (l) => l.includes("núcleo"));
    use("bobina", ROCA.eggParts[1]!.x, floorsParts[1]!, ROCA.eggParts[1]!.z, (l) => l.includes("bobina"));
    expect(has(EGG_PART_A) && has(EGG_PART_B)).toBe(true);
    // El horno: las almas, matando al lado, a su altura.
    p.x = ROCA.furnace.x;
    p.y = ROCA.furnace.y! + 0.01;
    p.z = ROCA.furnace.z - 2;
    // A tiros de verdad: el horno cuenta lo que muere durante el tick.
    let shots = 0;
    while (!has(EGG_FURNACE) && shots++ < EGG_SOULS * 12) {
      p.x = ROCA.furnace.x - 1;
      p.y = ROCA.furnace.y! + 0.01;
      p.z = ROCA.furnace.z - 4;
      p.hp = 1_000_000;
      p.ammo[p.active] = 8;
      p.reloading = false;
      p.reloadCd = 0;
      if (h.state.zombies.length === 0) {
        const victim = spawnNear(h, ROCA.furnace.x + 0.5, ROCA.furnace.y!, ROCA.furnace.z - 4);
        victim.hp = victim.maxHp = 1;
        victim.state = Z_HUNT;
      }
      h.run(5);
      h.shootNearest();
    }
    expect(h.state.eggSouls).toBeGreaterThanOrEqual(EGG_SOULS);
    expect(has(EGG_FURNACE)).toBe(true);
    use("gatillo", ROCA.eggParts[2]!.x, floorsParts[2]!, ROCA.eggParts[2]!.z, (l) => l.includes("gatillo"));
    expect(has(EGG_PART_C)).toBe(true);

    // 4. La Thunder Gun.
    use("banco", ROCA.bench.x, ROCA.bench.y ?? 0, ROCA.bench.z, (l) => l.includes("Thunder Gun"));
    expect(has(EGG_BUILT)).toBe(true);
    expect(p.slots).toContain(THUNDERGUN);

    // 5. La caja fuerte: rueda por rueda, hasta la combinación de esta partida.
    const code = h.state.eggCode;
    expect(code).toBeGreaterThanOrEqual(0);
    const target = [Math.floor(code / 100) % 10, Math.floor(code / 10) % 10, code % 10];
    target.forEach((digit, w) => {
      for (let n = 0; n < digit; n++) {
        p.x = q.safeWheels[w]!;
        p.y = 0.01;
        p.z = q.safe.z + 1.2;
        expect(wheelAt(q, p.x)).toBe(w);
        const it0 = findInteraction(h.state, p, ROCA);
        expect(it0?.label, `rueda ${w}`).toContain("rueda");
        h.tick({ 1: { use: false } });
        h.tick({ 1: { use: true } });
        h.tick({ 1: { use: false } });
      }
    });
    // Si la combinación era 000, ya estaba: se la fuerza con una vuelta entera.
    if (!has(EGG_SAFE)) {
      for (let n = 0; n < 10 && !has(EGG_SAFE); n++) {
        p.x = q.safeWheels[0]!;
        p.y = 0.01;
        p.z = q.safe.z + 1.2;
        h.tick({ 1: { use: false } });
        h.tick({ 1: { use: true } });
        h.tick({ 1: { use: false } });
      }
    }
    expect(has(EGG_SAFE)).toBe(true);
    use("la llave", q.key.x, q.key.y, q.key.z, (l) => l.includes(q.key.name));
    expect(has(EGG_KEY)).toBe(true);

    // 6. La lancha.
    for (const part of q.parts) use(part.name, part.x, part.y, part.z, (l) => l.includes(part.name));
    use("arreglar la lancha", q.boat.x, q.boat.y, q.boat.z, (l) => l.includes("Arreglar"));
    expect(has(EGG_BOAT)).toBe(true);

    // 7. Las llaves de corte.
    for (const b of q.breakers) use(b.name, b.x, b.y, b.z, (l) => l.includes(b.name));
    expect(has(EGG_BREAKERS)).toBe(true);

    // 8. El faro y el asedio.
    use("el faro", q.beacon.x, q.beacon.y, q.beacon.z, (l) => l.includes("faro"));
    expect(has(EGG_BEACON)).toBe(true);
    for (let t = 0; t < ESCAPE_SIEGE_TICKS + 2 && !has(EGG_READY); t++) {
      p.hp = 1_000_000;
      for (const z of h.state.zombies.slice()) if (t % 40 === 0 && z.type !== ZTYPE_BOSS) killZombie(h.state, z, p, 1, false, h.events);
      h.tick();
    }
    expect(has(EGG_READY)).toBe(true);
    expect(has(EGG_BOSS_ON)).toBe(true);

    // 9. El alcaide.
    const boss = h.state.zombies.find((z) => z.type === ZTYPE_BOSS)!;
    expect(boss).toBeDefined();
    let safety = 0;
    while (h.state.zombies.includes(boss) && safety++ < 500) damageZombie(h.state, boss, p, 500, 0, 1, boss.x, boss.y, boss.z, h.events);
    expect(has(EGG_BOSS_DEAD)).toBe(true);

    // 10. La lancha.
    use("la lancha", q.boat.x, q.boat.y, q.boat.z, (l) => l.includes("Subir"));
    expect(has(EGG_ESCAPED)).toBe(true);
    expect(h.state.phase).toBe("ended");
  }, 180_000);
});

/** Un zombi quieto en un lugar, para matarlo. */
function spawnNear(h: ReturnType<typeof harness>, x: number, y: number, z: number) {
  const zb = createZombie(h.state, { zone: 13, x, y, z }, ROCA, () => 0.5);
  zb.x = x;
  zb.z = z;
  zb.y = y;
  h.state.zombies.push(zb);
  h.state.round.spawned++;
  return zb;
}

import { Z_HUNT } from "../sim/types.js";
import { createZombie } from "../sim/zombies.js";
