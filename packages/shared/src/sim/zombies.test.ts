import { describe, expect, it } from "vitest";
import { BOARD_MAX, MAX_HP, ROUND_INTERMISSION_TICKS, TICK_RATE, ZOMBIE_DAMAGE, zombieCount, zombieHp } from "../constants.js";
import { zoneAt } from "../map/types.js";
import { harness, skipIntermission } from "./helpers.test-util.js";
import { Z_HUNT, Z_OUTSIDE, Z_RISING, Z_TEARING, Z_VAULT } from "./types.js";

describe("rondas y zombis", () => {
  it("la ronda 1 se anuncia, después salen todos los zombis por las ventanas de la oficina", () => {
    const h = harness(1);
    expect(h.state.round.phase).toBe("intermission");
    h.run(ROUND_INTERMISSION_TICKS);
    expect(h.state.round.phase).toBe("live");
    expect(h.state.round.total).toBe(zombieCount(1, 1));
    h.run(20 * TICK_RATE);
    expect(h.state.round.spawned).toBe(h.state.round.total);
    // Todos vinieron de afuera (la oficina no tiene spawners adentro) y están entrando o adentro.
    for (const z of h.state.zombies) expect([Z_OUTSIDE, Z_TEARING, Z_VAULT, Z_HUNT, 5]).toContain(z.state);
    expect(h.state.zombies.every((z) => z.barrier >= 0)).toBe(true);
    expect(h.state.zombies.every((z) => z.hp === zombieHp(1))).toBe(true);
  });

  it("arrancan tablas, pasan la ventana y llegan al jugador, que cae a los dos manotazos", () => {
    const h = harness(1);
    skipIntermission(h);
    const p = h.state.players[0]!;
    let torn = false;
    let hurt = 0;
    let down = false;
    for (let i = 0; i < 90 * TICK_RATE && h.state.phase === "playing"; i++) {
      h.tick();
      for (const e of h.events.splice(0)) {
        if (e.t === "board" && e.byId === -1) torn = true;
        if (e.t === "hurt") hurt++;
        if (e.t === "down" && e.id === 1) down = true;
      }
    }
    expect(torn).toBe(true);
    expect(hurt).toBeGreaterThanOrEqual(2);
    expect(down).toBe(true);
    expect(p.hp).toBe(0);
    expect(MAX_HP / ZOMBIE_DAMAGE).toBe(2);
    // Hay al menos una ventana con menos tablas.
    expect(h.state.boards.some((b) => b < BOARD_MAX)).toBe(true);
    // Solo y caído sin Quick Revive: se termina la partida.
    expect(h.state.phase).toBe("ended");
    expect(h.state.reachedRound).toBe(1);
  });

  it("tirándoles a todos se termina la ronda y empieza la siguiente", () => {
    const h = harness(1, 3);
    skipIntermission(h);
    const p = h.state.players[0]!;
    const kills: number[] = [];
    for (let i = 0; i < 400 * TICK_RATE && h.state.round.number === 1 && p.alive && !p.down; i++) {
      // Sin balas en el cargador, recargar un rato.
      if ((p.ammo[p.active] ?? 0) === 0) h.tick({ 1: { reload: true } });
      else h.shootNearest();
      for (const e of h.events.splice(0)) if (e.t === "zkill") kills.push(e.zombieId);
      // Munición infinita para la prueba: lo que importa es la ronda.
      p.reserve[p.active] = 500;
    }
    expect(p.down).toBe(false);
    expect(kills.length).toBe(zombieCount(1, 1));
    expect(h.state.round.number).toBe(2);
    expect(h.state.round.phase).toBe("intermission");
    expect(p.points).toBeGreaterThan(500);
    expect(p.kills).toBe(zombieCount(1, 1));
  });

  it("los zombis de adentro salen del piso en zonas donde hay alguien, y no en zonas cerradas", () => {
    const h = harness(1, 5);
    // Abrir la puerta del depósito y pararse adentro.
    h.state.doorsOpen = 1;
    const p = h.state.players[0]!;
    p.x = -18;
    p.z = 5;
    skipIntermission(h);
    h.run(25 * TICK_RATE);
    const inside = h.state.zombies.filter((z) => z.barrier < 0);
    expect(inside.length).toBeGreaterThan(0);
    for (const z of h.state.zombies) {
      const zone = z.barrier >= 0 ? h.map.barriers[z.barrier]!.zone : zoneAt(h.map, z.x, z.z);
      expect([0, 1]).toContain(zone);
    }
    expect(inside.some((z) => z.state === Z_RISING || z.state === Z_HUNT)).toBe(true);
  });

  it("la vida y la cantidad suben con la ronda", () => {
    expect(zombieHp(1)).toBe(150);
    expect(zombieHp(9)).toBe(950);
    expect(zombieHp(10)).toBe(1045);
    expect(zombieCount(1, 1)).toBeLessThan(zombieCount(5, 1));
    expect(zombieCount(5, 1)).toBeLessThan(zombieCount(5, 4));
  });
});
