import { describe, expect, it } from "vitest";
import { ACT_AXE, AXE_PRICE, BREAKER_TICKS, EGG_BEACON, EGG_BOAT, EGG_BOAT_PARTS, EGG_BOSS_DEAD, EGG_BREAKERS, EGG_BUILT, EGG_ESCAPED, EGG_FURNACE, EGG_KEY, EGG_PART_C, EGG_READY, EGG_SAFE, ESCAPE_SIEGE_TICKS, FORGE_TICKS, PLAYER_HEIGHT, ZTYPE_BOSS } from "../constants.js";
import { damageZombie } from "../sim/combat.js";
import { harness } from "../sim/helpers.test-util.js";
import { findInteraction } from "../sim/interact.js";
import { overlapsAny } from "../sim/movement.js";
import { packPlayer, unpackPlayer } from "../protocol/codec.js";
import { Z_HUNT } from "../sim/types.js";
import { createZombie } from "../sim/zombies.js";
import { BRASAS, LUGER, M1911, PPSH, REFLECTOR, SPRINGFIELD, THOMPSON, THUNDERGUN, TRABUCO, WEAPONS, rollBox, weapon } from "../weapons.js";
import { ROCA } from "./roca.js";
import type { QuestItem } from "./types.js";

type H = ReturnType<typeof harness>;

/** Lo para al lado de un objeto de la fuga, en un lugar libre, y aprieta E. */
function pressAt(h: H, item: QuestItem): void {
  const p = h.state.players[0]!;
  let placed = false;
  for (let a = 0; a < 32 && !placed; a++) {
    for (const r of [0.8, 1.2, 1.6]) {
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

  it("sin armar la Thunder Gun, la caja fuerte no se puede abrir ni aparece la llave", () => {
    const h = start();
    const p = h.state.players[0]!;
    p.x = quest.safe.x;
    p.y = 0.01;
    p.z = quest.safe.z + 1;
    const it0 = findInteraction(h.state, p, ROCA);
    expect(it0?.kind).toBe("quest");
    expect(it0?.ok).toBe(false);
    pressAt(h, quest.key);
    expect(h.state.egg & EGG_KEY).toBe(0);
  });

  it("la caja fuerte se abre girando las ruedas hasta la combinación, y recién ahí está la llave", () => {
    const h = start();
    h.state.egg = EGG_BUILT;
    h.state.eggCode = 305;
    const p = h.state.players[0]!;
    const press = (wheel: number) => {
      p.x = quest.safeWheels[wheel]!;
      p.y = 0.01;
      p.z = quest.safe.z + 1;
      h.tick({ 1: { use: false } });
      h.tick({ 1: { use: true } });
      h.tick({ 1: { use: false } });
    };
    pressAt(h, quest.key);
    expect(h.state.egg & EGG_KEY).toBe(0);
    h.state.eggDial = 0;
    for (let i = 0; i < 3; i++) press(0);
    expect(h.state.eggDial).toBe(300);
    expect(h.state.egg & EGG_SAFE).toBe(0);
    for (let i = 0; i < 5; i++) press(2);
    expect(h.state.egg & EGG_SAFE).toBe(EGG_SAFE);
    pressAt(h, quest.key);
    expect(h.state.egg & EGG_KEY).toBe(EGG_KEY);
  });

  it("una rueda da la vuelta: del 9 pasa al 0", () => {
    const h = start();
    h.state.egg = EGG_BUILT;
    h.state.eggCode = 111;
    h.state.eggDial = 900;
    const p = h.state.players[0]!;
    p.x = quest.safeWheels[0]!;
    p.y = 0.01;
    p.z = quest.safe.z + 1;
    h.tick({ 1: { use: false } });
    h.tick({ 1: { use: true } });
    expect(h.state.eggDial).toBe(0);
  });

  it("las llaves de corte: las tres a tiempo dan corriente; tarde, se levantan solas", () => {
    const h = start();
    h.state.egg = EGG_BUILT | EGG_SAFE | EGG_KEY | EGG_BOAT;
    // Sin corriente el faro no se prende.
    pressAt(h, quest.beacon);
    expect(h.state.egg & EGG_BEACON).toBe(0);
    pressAt(h, quest.breakers[0]!);
    expect(h.state.breakers).toBe(1);
    expect(h.state.breakerTicks).toBeGreaterThan(0);
    h.run(BREAKER_TICKS + 2);
    expect(h.state.breakers).toBe(0);
    expect(h.state.egg & EGG_BREAKERS).toBe(0);
    for (const b of quest.breakers) pressAt(h, b);
    expect(h.state.egg & EGG_BREAKERS).toBe(EGG_BREAKERS);
    pressAt(h, quest.beacon);
    expect(h.state.egg & EGG_BEACON).toBe(EGG_BEACON);
  }, 60_000);

  it("las piezas sólo se agarran con la llave, y la lancha pide las cuatro", () => {
    const h = start();
    h.state.egg = EGG_BUILT | EGG_SAFE;
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

  it("de punta a punta: faro, asedio sin descanso, el alcaide y se escapa", () => {
    const h = start();
    h.state.egg = EGG_BUILT | EGG_SAFE | EGG_KEY | EGG_BOAT_PARTS.reduce((a, b) => a | b, 0) | EGG_BOAT | EGG_BREAKERS;
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
    // Con el alcaide en pie no se sale, y mientras tanto siguen viniendo.
    const boss = h.state.zombies.find((z) => z.type === ZTYPE_BOSS)!;
    expect(boss).toBeDefined();
    expect(boss.hp).toBeGreaterThan(20_000);
    pressAt(h, quest.boat);
    expect(h.state.egg & EGG_ESCAPED).toBe(0);
    // Lo que mata de una, a él no.
    h.state.instaKill = 200;
    damageZombie(h.state, boss, p, 10, 0, THUNDERGUN, boss.x, boss.y, boss.z, h.events);
    expect(h.state.zombies).toContain(boss);
    h.state.instaKill = 0;
    damageZombie(h.state, boss, p, boss.hp, 0, M1911, boss.x, boss.y, boss.z, h.events);
    expect(h.state.egg & EGG_BOSS_DEAD).toBe(EGG_BOSS_DEAD);
    pressAt(h, quest.boat);
    expect(h.state.egg & EGG_ESCAPED).toBe(EGG_ESCAPED);
    expect(h.state.phase).toBe("ended");
    expect(h.state.reachedRound).toBe(number);
    expect(h.events.some((e) => e.t === "gameover")).toBe(true);
  }, 120_000);

  it("no se escapa nadie dejando a los compañeros atrás", () => {
    const h = harness(2, 7, ROCA);
    h.state.egg = EGG_BUILT | EGG_KEY | EGG_BOAT | EGG_BEACON | EGG_READY | EGG_BOSS_DEAD;
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

describe("las armas especiales", () => {
  const quest = ROCA.quest!;
  const zombieAt = (h: H, x: number, y: number, z: number, hp: number) => {
    const zb = createZombie(h.state, { zone: 0, x, y, z }, ROCA, () => 0.5);
    zb.x = x;
    zb.z = z;
    zb.hp = zb.maxHp = hp;
    zb.state = Z_HUNT;
    h.state.zombies.push(zb);
    return zb;
  };

  it("el hacha se compra y rebota: alcanza a varios y después hay que esperarla", () => {
    const h = harness(1, 7, ROCA);
    h.state.round.ticksLeft = 100_000;
    const p = h.state.players[0]!;
    p.points = AXE_PRICE;
    pressAt(h, quest.axe);
    expect(p.hasAxe).toBe(true);
    expect(p.points).toBe(0);
    p.x = 0;
    p.y = 0.01;
    p.z = 0;
    p.yaw = 0;
    p.pitch = 0;
    const zs = [zombieAt(h, 0, 0, -3, 200), zombieAt(h, 1.5, 0, -2.4, 200), zombieAt(h, -1.5, 0, -2.4, 200)];
    h.tick({ 1: { act: ACT_AXE, yaw: 0, pitch: 0 } });
    for (const z of zs) expect(h.state.zombies).not.toContain(z);
    expect(h.events.some((e) => e.t === "axe")).toBe(true);
    expect(p.axeCd).toBeGreaterThan(0);
    // Sin el hacha en la mano no sale otra.
    const after = zombieAt(h, 0, 0, -3, 200);
    h.tick({ 1: { act: ACT_AXE, yaw: 0, pitch: 0 } });
    expect(h.state.zombies).toContain(after);
  });

  it("el reflector quema y frena a los que tiene adelante, y no a los de atrás", () => {
    const h = harness(1, 7, ROCA);
    h.state.round.ticksLeft = 100_000;
    const p = h.state.players[0]!;
    p.slots[0] = REFLECTOR;
    p.active = 0;
    p.ammo[0] = weapon(REFLECTOR).mag;
    p.x = 0;
    p.y = 0.01;
    p.z = 0;
    const front = zombieAt(h, 0, 0, -6, 1000);
    const back = zombieAt(h, 0, 0, 2.5, 1000);
    h.run(20);
    front.x = 0;
    front.z = -6;
    back.x = 0;
    back.z = 2.5;
    const dy = front.y + 1 - (p.y + 1.6);
    h.run(8, { 1: { shoot: true, yaw: 0, pitch: Math.atan2(dy, 6) } });
    expect(front.hp).toBeLessThan(1000);
    expect(front.slowTicks).toBeGreaterThan(0);
    expect(back.hp).toBe(1000);
  });

  it("el trabuco entra al horno ya lleno y sale de brasas; las brasas no lastiman al que dispara", () => {
    const h = harness(1, 7, ROCA);
    h.state.round.ticksLeft = 100_000;
    h.state.doorsOpen = (1 << ROCA.doors.length) - 1;
    h.state.egg = EGG_FURNACE | EGG_PART_C;
    const p = h.state.players[0]!;
    p.slots[1] = TRABUCO;
    p.active = 1;
    p.ammo[1] = 6;
    p.drawCd = 0;
    const f = { name: "el horno", x: ROCA.furnace.x, y: ROCA.furnace.y!, z: ROCA.furnace.z - 1.1, h: 0 };
    pressAt(h, f);
    expect(p.slots).not.toContain(TRABUCO);
    expect(h.state.forgeBy).toBe(p.id);
    h.run(FORGE_TICKS + 2);
    expect(h.state.forgeTicks).toBe(0);
    pressAt(h, f);
    expect(p.slots).toContain(BRASAS);
    expect(weapon(BRASAS).box).toBe(0);
    // A quemarropa: el que dispara no se quema.
    p.x = 0;
    p.y = 0.01;
    p.z = 0;
    p.hp = 100;
    p.invulnTicks = 0;
    const victim = createZombie(h.state, { zone: 0, x: 0, y: 0, z: -1.2 }, ROCA, () => 0.5);
    victim.x = 0;
    victim.z = -1.2;
    victim.hp = victim.maxHp = 100_000;
    victim.state = Z_HUNT;
    h.state.zombies.push(victim);
    h.run(14);
    victim.x = p.x;
    victim.z = p.z - 1.2;
    h.shootNearest();
    expect(victim.hp).toBeLessThan(100_000);
    expect(p.hp).toBeGreaterThanOrEqual(50);
  }, 60_000);

  it("el reparto de interacciones: ninguna cosa de la fuga queda tapada por algo que se compra al lado", () => {
    const h = harness(1, 7, ROCA);
    h.state.doorsOpen = (1 << ROCA.doors.length) - 1;
    h.state.power = true;
    h.state.egg = EGG_BUILT | EGG_SAFE | EGG_KEY | EGG_BOAT;
    const p = h.state.players[0]!;
    quest.breakers.forEach((b, i) => {
      p.x = b.x + (Math.abs(b.x) > 29 ? Math.sign(-b.x) * 0.9 : 0);
      p.y = b.y + 0.01;
      p.z = b.z + (Math.abs(b.x) > 29 ? 0 : 0.9);
      const it0 = findInteraction(h.state, p, ROCA);
      expect(it0?.kind, b.name).toBe("quest");
      expect(it0?.label, b.name).toContain(b.name);
      void i;
    });
    quest.parts.forEach((part) => {
      let ok = false;
      for (let a = 0; a < 24 && !ok; a++) {
        p.x = part.x + Math.cos((a / 24) * 6.283) * 1.3;
        p.y = part.y + 0.01;
        p.z = part.z + Math.sin((a / 24) * 6.283) * 1.3;
        if (overlapsAny(p.x, p.y, p.z, PLAYER_HEIGHT, ROCA.boxes)) continue;
        ok = findInteraction(h.state, p, ROCA)?.label.includes(part.name) ?? false;
      }
      expect(ok, part.name).toBe(true);
    });
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

describe("el alcaide se puede matar", () => {
  it("en cualquier ronda alcanza la munición de dos armas de pared mejoradas por jugador", () => {
    const totals = WEAPONS.filter((w) => w.wall > 0 && w.mag > 0)
      .map((w) => {
        const st = weaponStats(w.id, true);
        return st.damage * w.pellets * (st.mag + st.reserve);
      })
      .sort((a, b) => b - a);
    const twoGuns = totals[0]! + totals[1]!;
    for (const players of [1, 2, 3, 4]) {
      for (const round of [1, 10, 20, 30, 60, 200]) {
        expect(bossHp(round, players), `ronda ${round}, ${players} jugadores`).toBeLessThanOrEqual(twoGuns * players);
      }
    }
    // Y no sigue la curva de los zombis.
    expect(bossHp(200, 1)).toBe(bossHp(30, 1));
    expect(bossHp(1, 1)).toBe(bossHp(10, 1));
  });
});

import { bossHp } from "../constants.js";
import { weaponStats } from "../weapons.js";
