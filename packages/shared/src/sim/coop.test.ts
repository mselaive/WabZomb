import { describe, expect, it } from "vitest";
import { DOWN_BLEED_TICKS, REVIVE_HP, REVIVE_TICKS, ROUND_INTERMISSION_TICKS, TICK_RATE, zombieCount } from "../constants.js";
import { downPlayer } from "./combat.js";
import { harness, skipIntermission } from "./helpers.test-util.js";

describe("de a varios", () => {
  it("con dos jugadores vienen más zombis y los dos arrancan en la oficina", () => {
    const h = harness(2);
    skipIntermission(h);
    expect(h.state.round.total).toBe(zombieCount(1, 2));
    for (const p of h.state.players) {
      expect(p.alive).toBe(true);
      expect(p.z).toBeGreaterThan(4);
    }
  });

  it("al caído lo levanta el compañero sosteniendo E al lado; solo, se desangra", () => {
    const h = harness(2);
    const [a, b] = h.state.players as [typeof h.state.players[0], typeof h.state.players[0]];
    // Que no empiece la ronda mientras tanto: sin zombis en el medio.
    h.state.round.ticksLeft = 100_000;
    downPlayer(h.state, a, h.events);
    expect(a.down).toBe(true);
    expect(a.selfRevive).toBe(false);
    b.x = a.x + 0.8;
    b.z = a.z;
    h.run(REVIVE_TICKS + 2, { 2: { use: true } });
    expect(a.down).toBe(false);
    expect(a.hp).toBe(REVIVE_HP);
    expect(b.revives).toBe(1);
    // Otra vez caído, sin ayuda: muere, y vuelve en la próxima ronda.
    downPlayer(h.state, a, h.events);
    b.x = 0;
    b.z = 15;
    h.run(DOWN_BLEED_TICKS + 1);
    expect(a.alive).toBe(false);
    expect(h.state.phase).toBe("playing");
    h.state.round.phase = "over";
    h.state.round.ticksLeft = 1;
    h.tick();
    expect(h.state.round.number).toBe(2);
    expect(a.alive).toBe(true);
    expect(a.points).toBeGreaterThan(0);
  });

  it("si caen todos se termina, y queda la ronda alcanzada", () => {
    const h = harness(2);
    h.run(ROUND_INTERMISSION_TICKS);
    for (const p of h.state.players) downPlayer(h.state, p, h.events);
    h.tick();
    expect(h.state.phase).toBe("ended");
    expect(h.state.reachedRound).toBe(1);
    expect(h.events.some((e) => e.t === "gameover")).toBe(true);
  });

  it("una partida de dos rondas con munición infinita no deja zombis trabados", () => {
    const h = harness(1, 21);
    const p = h.state.players[0]!;
    let ticks = 0;
    while (h.state.round.number < 3 && ticks < 600 * TICK_RATE && p.alive && !p.down) {
      if (h.state.round.phase !== "live") h.tick();
      else if ((p.ammo[p.active] ?? 0) === 0) h.tick({ 1: { reload: true } });
      else h.shootNearest();
      p.reserve[p.active] = 500;
      p.hp = p.maxHp;
      ticks++;
      h.events.length = 0;
    }
    expect(h.state.round.number).toBe(3);
  });
});
