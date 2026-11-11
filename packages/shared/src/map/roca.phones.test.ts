import { describe, expect, it } from "vitest";
import { PHONE_FIRST_TICKS, PHONE_RING_TICKS } from "../constants.js";
import { harness } from "../sim/helpers.test-util.js";
import { findInteraction } from "../sim/interact.js";
import { ROCA } from "./roca.js";

describe("los teléfonos de la sala de visitas", () => {
  const phones = ROCA.quest!.phones!;

  it("hay uno de cada lado de cada mostrador, y se alcanzan parado al lado", () => {
    expect(phones.length).toBe(8);
    const h = harness(1, 5, ROCA);
    const p = h.state.players[0]!;
    phones.forEach((ph, i) => {
      p.x = ph.x;
      p.y = 0.01;
      p.z = ph.z + Math.sign(ph.z) * 0.5;
      const it = findInteraction(h.state, p, ROCA);
      expect(it?.kind, `teléfono ${i}`).toBe("quest");
      expect(it?.label).toBe("Levantar el tubo");
    });
  });

  it("sin luz no suena nunca; con luz suena uno, y si nadie atiende corta solo", () => {
    const h = harness(1, 5, ROCA);
    h.state.round.ticksLeft = 1_000_000;
    h.state.players[0]!.hp = 1_000_000;
    h.run(PHONE_FIRST_TICKS + 20);
    expect(h.state.phoneRing).toBe(-1);
    h.state.power = true;
    h.run(PHONE_FIRST_TICKS + 5);
    expect(h.state.phoneRing).toBeGreaterThanOrEqual(0);
    h.run(PHONE_RING_TICKS + 5);
    expect(h.state.phoneRing).toBe(-1);
  });

  it("atender el que suena deja un power-up; levantar otro sólo da la pista", () => {
    const h = harness(1, 5, ROCA);
    h.state.power = true;
    h.state.round.ticksLeft = 1_000_000;
    const p = h.state.players[0]!;
    p.hp = 1_000_000;
    h.state.phoneRing = 2;
    h.state.phoneTicks = PHONE_RING_TICKS;
    const use = (i: number) => {
      const ph = phones[i]!;
      p.x = ph.x;
      p.y = 0.01;
      p.z = ph.z + Math.sign(ph.z) * 0.5;
      h.events.length = 0;
      h.tick({ 1: { use: false } });
      h.tick({ 1: { use: true } });
      h.tick({ 1: { use: false } });
      return h.events.filter((e) => e.t === "egg" || (e.t === "powerup" && (e as { what: string }).what === "drop")).map((e) => (e.t === "egg" ? (e as { step: number }).step : -1));
    };
    const lift = use(5);
    expect(lift).toContain(42);
    expect(lift, "sin power-up").not.toContain(-1);
    expect(h.state.phoneRing).toBe(2);
    const answer = use(2);
    expect(answer).toContain(41);
    expect(answer, "cayó un power-up").toContain(-1);
    expect(h.state.phoneRing).toBe(-1);
  });
});
