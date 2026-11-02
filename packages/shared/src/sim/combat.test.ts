import { describe, expect, it } from "vitest";
import { HIT_POINTS, KILL_POINTS, HEADSHOT_POINTS, PERK_DOUBLETAP, TRAIL_LENGTH, ZOMBIE_HEIGHT } from "../constants.js";
import { M1911, weapon, weaponStats } from "../weapons.js";
import { collisionBoxes } from "./movement.js";
import { harness } from "./helpers.test-util.js";
import { createZombie } from "./zombies.js";
import { resolveShot, resolveMelee, applyPerk } from "./combat.js";
import { Z_HUNT } from "./types.js";

/** Un zombi quieto delante del jugador, a `dist` metros. */
function zombieAhead(h: ReturnType<typeof harness>, dist: number) {
  const p = h.state.players[0]!;
  const z = createZombie(h.state, { zone: 0, x: p.x, y: 0, z: p.z - dist }, h.map, () => 0.5);
  z.state = Z_HUNT;
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    z.trail[i * 3] = z.x;
    z.trail[i * 3 + 1] = z.y;
    z.trail[i * 3 + 2] = z.z;
  }
  h.state.zombies.push(z);
  return z;
}

describe("tiros contra zombis", () => {
  it("un tiro al cuerpo saca el daño del arma y paga 10; el que lo mata paga 60 (100 en la cabeza)", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const z = zombieAhead(h, 5);
    p.yaw = 0;
    p.pitch = Math.atan2(1.0 - 1.62, 5);
    const pts = p.points;
    resolveShot(h.state, p, M1911, 1, 0, collisionBoxes(h.state, h.map), h.events);
    // A ~4,7 m (la cara de la caja), la bala perdió un poco por la distancia.
    expect(z.hp).toBeGreaterThanOrEqual(150 - weapon(M1911).damage);
    expect(z.hp).toBeLessThan(150 - weapon(M1911).damage * 0.85);
    expect(p.points).toBe(pts + HIT_POINTS);
    z.hp = 1;
    resolveShot(h.state, p, M1911, 2, 0, collisionBoxes(h.state, h.map), h.events);
    expect(h.state.zombies.length).toBe(0);
    expect(p.points).toBe(pts + HIT_POINTS + KILL_POINTS);
    expect(p.kills).toBe(1);
    expect(h.events.some((e) => e.t === "zkill" && e.byId === 1)).toBe(true);
  });

  it("a la cabeza multiplica el daño y paga más", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const z = zombieAhead(h, 4);
    z.hp = 10000;
    z.maxHp = 10000;
    p.yaw = 0;
    p.pitch = Math.atan2(ZOMBIE_HEIGHT - 0.12 - 1.62, 4);
    resolveShot(h.state, p, M1911, 1, 0, collisionBoxes(h.state, h.map), h.events);
    expect(10000 - z.hp).toBe(Math.round(weapon(M1911).damage * weapon(M1911).head * Math.pow(weapon(M1911).range, 0.4)));
    z.hp = 1;
    const pts = p.points;
    resolveShot(h.state, p, M1911, 2, 0, collisionBoxes(h.state, h.map), h.events);
    expect(p.points).toBe(pts + HEADSHOT_POINTS);
    expect(p.headshots).toBe(1);
  });

  it("Double Tap duplica el daño de cada bala", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const z = zombieAhead(h, 5);
    z.hp = 10000;
    p.yaw = 0;
    p.pitch = Math.atan2(1.0 - 1.62, 5);
    applyPerk(p, PERK_DOUBLETAP);
    resolveShot(h.state, p, M1911, 1, 0, collisionBoxes(h.state, h.map), h.events);
    expect(10000 - z.hp).toBe(Math.round(weapon(M1911).damage * 2 * Math.pow(weapon(M1911).range, 0.5)));
  });

  it("el cuchillo mata de uno en la ronda 1 y paga 130", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    zombieAhead(h, 1.1);
    p.yaw = 0;
    const pts = p.points;
    resolveMelee(h.state, p, 1, h.events);
    expect(h.state.zombies.length).toBe(0);
    expect(p.points).toBe(pts + 130);
  });

  it("la Ray Gun estalla donde pega y lastima a los de alrededor", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const a = zombieAhead(h, 6);
    const b = zombieAhead(h, 6);
    b.x += 1;
    for (let i = 0; i < TRAIL_LENGTH; i++) b.trail[i * 3] = b.x;
    a.hp = b.hp = 100000;
    p.yaw = 0;
    p.pitch = Math.atan2(1.0 - 1.62, 6);
    resolveShot(h.state, p, 23, 1, 0, collisionBoxes(h.state, h.map), h.events);
    expect(100000 - a.hp).toBe(weaponStats(23, false).damage);
    expect(b.hp).toBeLessThan(100000);
    expect(p.hp).toBe(100);
  });

  it("insta-kill mata de un tiro", () => {
    const h = harness(1);
    const p = h.state.players[0]!;
    const z = zombieAhead(h, 5);
    z.hp = 99999;
    h.state.instaKill = 100;
    p.yaw = 0;
    p.pitch = Math.atan2(1.0 - 1.62, 5);
    resolveShot(h.state, p, M1911, 1, 0, collisionBoxes(h.state, h.map), h.events);
    expect(h.state.zombies.length).toBe(0);
  });
});
