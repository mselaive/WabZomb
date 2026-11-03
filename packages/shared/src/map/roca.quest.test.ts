import { describe, expect, it } from "vitest";
import { EGG_BEACON, EGG_BOAT, EGG_BOAT_PARTS, EGG_BUILT, EGG_ESCAPED, EGG_KEY, EGG_READY, ESCAPE_SIEGE_TICKS, PLAYER_HEIGHT } from "../constants.js";
import { harness } from "../sim/helpers.test-util.js";
import { findInteraction } from "../sim/interact.js";
import { overlapsAny } from "../sim/movement.js";
import { packPlayer, unpackPlayer } from "../protocol/codec.js";
import { Z_HUNT } from "../sim/types.js";
import { createZombie } from "../sim/zombies.js";
import { LUGER, PPSH, SPRINGFIELD, THOMPSON, TRABUCO, WEAPONS, rollBox, weapon } from "../weapons.js";
import { ROCA } from "./roca.js";
import type { QuestItem } from "./types.js";

type H = ReturnType<typeof harness>;

/** Lo para al lado de un objeto de la fuga, en un lugar libre, y aprieta E. */
function pressAt(h: H, item: QuestItem): void {
  const p = h.state.players[0]!;
  let placed = false;
  for (let a = 0; a < 32 && !placed; a++) {
    for (const r of [0.8, 1.2, 1.6, 1.9]) {
      const x = item.x + Math.cos((a / 32) * Math.PI * 2) * r;
      const z = item.z + Math.sin((a / 32) * Math.PI * 2) * r;
      if (overlapsAny(x, item.y + 0.02, z, PLAYER_HEIGHT, ROCA.boxes)) continue;
      p.x = x;
      p.y = item.y + 0.01;
      p.z = z;
      placed = true;
      break;
    }
  }
  expect(placed, `lugar libre al lado de ${item.name}`).toBe(true);
  h.tick({ 1: { use: false } });
  h.tick({ 1: { use: true } });
  h.tick({ 1: { use: false } });
}

describe("la fuga de La Roca", () => {
  const quest = ROCA.quest!;

  function start(): H {
    const h = harness(1, 7, ROCA);
    h.state.doorsOpen = (1 << ROCA.doors.length) - 1;
    h.state.power = true;
    h.state.round.ticksLeft = 100_000;
    h.state.players[0]!.hp = 1_000_000;
    return h;
  }

  it("sin armar la Thunder Gun, la llave no aparece", () => {
    const h = start();
    pressAt(h, quest.key);
    expect(h.state.egg & EGG_KEY).toBe(0);
  });

  it("las piezas sólo se agarran con la llave, y la lancha pide las cuatro", () => {
    const h = start();
    h.state.egg = EGG_BUILT;
    pressAt(h, quest.parts[0]!);
    expect(h.state.egg & EGG_BOAT_PARTS[0]).toBe(0);
    pressAt(h, quest.key);
    expect(h.state.egg & EGG_KEY).toBe(EGG_KEY);
    pressAt(h, quest.boat);
    expect(h.state.egg & EGG_BOAT).toBe(0);
    quest.parts.forEach((part, i) => {
      pressAt(h, part);
      expect(h.state.egg & EGG_BOAT_PARTS[i]!, part.name).toBe(EGG_BOAT_PARTS[i]);
    });
    pressAt(h, quest.boat);
    expect(h.state.egg & EGG_BOAT).toBe(EGG_BOAT);
  });

  it("de punta a punta: faro, asedio sin descanso, y se escapa", () => {
    const h = start();
    h.state.egg = EGG_BUILT | EGG_KEY | EGG_BOAT_PARTS.reduce((a, b) => a | b, 0) | EGG_BOAT;
    // Sin el faro, la lancha no sale.
    pressAt(h, quest.boat);
    expect(h.state.phase).toBe("playing");
    pressAt(h, quest.beacon);
    expect(h.state.egg & EGG_BEACON).toBe(EGG_BEACON);
    expect(h.state.eggTicks).toBeGreaterThan(0);
    // Aguantar: nada de intermedios, y los zombis siguen saliendo más allá de lo que tenía la ronda.
    const p = h.state.players[0]!;
    const number = h.state.round.number;
    let spawnedMax = 0;
    for (let t = 0; t < ESCAPE_SIEGE_TICKS - 4; t++) {
      p.hp = 1_000_000;
      p.down = false;
      p.alive = true;
      if (t % 10 === 0) for (const z of h.state.zombies) z.hp = 1;
      h.tick();
      spawnedMax = Math.max(spawnedMax, h.state.zombies.length);
      expect(h.state.round.phase).toBe("live");
    }
    expect(h.state.round.number).toBe(number);
    expect(spawnedMax).toBeGreaterThan(5);
    // Antes de que termine, todavía no.
    pressAt(h, quest.boat);
    h.run(10);
    expect(h.state.egg & EGG_READY).toBe(EGG_READY);
    expect(h.state.phase).toBe("playing");
    pressAt(h, quest.boat);
    expect(h.state.egg & EGG_ESCAPED).toBe(EGG_ESCAPED);
    expect(h.state.phase).toBe("ended");
    expect(h.state.reachedRound).toBe(number);
    expect(h.events.some((e) => e.t === "gameover")).toBe(true);
  }, 120_000);

  it("no se escapa nadie dejando a los compañeros atrás", () => {
    const h = harness(2, 7, ROCA);
    h.state.egg = EGG_BUILT | EGG_KEY | EGG_BOAT | EGG_BEACON | EGG_READY;
    h.state.round.ticksLeft = 100_000;
    const p = h.state.players[0]!;
    const mate = h.state.players[1]!;
    p.x = quest.boat.x;
    p.y = quest.boat.y + 0.01;
    p.z = quest.boat.z - 1;
    mate.x = 0;
    mate.z = 0;
    const it0 = findInteraction(h.state, p, ROCA);
    expect(it0?.kind).toBe("quest");
    expect(it0?.ok).toBe(false);
    mate.x = quest.boat.x + 3;
    mate.y = quest.boat.y + 0.01;
    mate.z = quest.boat.z - 2;
    expect(findInteraction(h.state, p, ROCA)?.ok).toBe(true);
  });

  it("La Fábrica no tiene fuga", () => {
    const h = harness(1);
    h.state.egg = EGG_BUILT | EGG_KEY;
    expect(h.map.quest).toBeUndefined();
  });
});

describe("las armas nuevas", () => {
  it("todas viajan bien por la red: la ranura y la activa llegan como salieron", () => {
    const h = harness(1, 7, ROCA);
    const p = h.state.players[0]!;
    for (const id of [TRABUCO, THOMPSON, PPSH, SPRINGFIELD, LUGER]) {
      p.slots[0] = id;
      p.slots[1] = PPSH;
      p.slots[2] = TRABUCO;
      p.active = 0;
      const out = unpackPlayer(packPlayer(p, true));
      expect(out.slots, weapon(id).name).toEqual([id, PPSH, TRABUCO]);
      expect(out.weapon).toBe(id);
    }
  });

  it("el trabuco de cerca hace mucho más que un perdigón: pegan varios", () => {
    const h = harness(1, 7, ROCA);
    h.state.round.ticksLeft = 100_000;
    const p = h.state.players[0]!;
    p.slots[0] = TRABUCO;
    p.active = 0;
    p.ammo[0] = weapon(TRABUCO).mag;
    p.x = 0;
    p.y = 0.01;
    p.z = 0;
    const z = createZombie(h.state, { zone: 0, x: 0, y: 0, z: -2 }, ROCA, () => 0.5);
    z.x = 0;
    z.z = -2;
    z.hp = 100_000;
    z.maxHp = 100_000;
    z.state = Z_HUNT;
    h.state.zombies.push(z);
    h.run(20);
    z.x = p.x;
    z.z = p.z - 2;
    h.shootNearest();
    expect(p.ammo[0]).toBe(weapon(TRABUCO).mag - 1);
    expect(100_000 - z.hp).toBeGreaterThan(weapon(TRABUCO).damage * 3);
  });

  it("el número de cada arma es su lugar en la lista", () => {
    WEAPONS.forEach((w, i) => expect(w.id, w.name).toBe(i));
    expect(WEAPONS.length).toBeLessThan(60);
  });

  it("el trabuco sale de la caja, y con menos frecuencia que un arma común", () => {
    let trabuco = 0;
    let thompson = 0;
    let seed = 1;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 20_000; i++) {
      const id = rollBox(rng, []);
      if (id === TRABUCO) trabuco++;
      if (weapon(id).name.startsWith("Thompson")) thompson++;
    }
    expect(trabuco).toBeGreaterThan(0);
    expect(trabuco).toBeLessThan(thompson);
  });

  it("cada arma de pared y cada máquina de La Roca miran hacia un lugar donde se puede estar", () => {
    const forward = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
    for (const w of ROCA.wallWeapons) {
      const f = forward(w.yaw);
      const y = w.y - 1.5 + 0.02;
      expect(overlapsAny(w.x + f.x * 0.6, y, w.z + f.z * 0.6, PLAYER_HEIGHT, ROCA.boxes), `pared ${weapon(w.weapon).name}`).toBeNull();
    }
    for (const m of ROCA.perks) {
      const f = forward(m.yaw);
      const y = (m.y ?? 0) + 0.02;
      expect(overlapsAny(m.x + f.x * 1.0, y, m.z + f.z * 1.0, PLAYER_HEIGHT, ROCA.boxes), `bebida ${m.perk}`).toBeNull();
    }
  });
});
