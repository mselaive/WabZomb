import { describe, expect, it } from "vitest";
import { MS_PER_TICK, packZombie, type SnapshotMsg, type ZombieState } from "@wabzomb/shared";
import { SnapshotBuffer } from "./interpolation.js";

/** Un zombi que camina en línea recta a 3 m/s, visto en el tick `tick`. */
function snapshot(tick: number): SnapshotMsg {
  const z = { id: 1, type: 0, x: tick * 0.15, y: 0, z: 0, yaw: 0, state: 1, stateTicks: 0, hp: 100, maxHp: 100, vx: 3, vz: 0 } as unknown as ZombieState;
  return { t: "s", tick, now: 0, phase: "playing", left: 0, rd: [1, 1, 0, 6, 1, 0], players: [], z: [packZombie(z)], doors: 0, boards: [], power: 0, box: [0, 0, 0, 0] as never, pap: [0, 0, 0, 0] as never, fx: [0, 0, 0, 0], radios: 0, egg: 0, souls: 0, q: [0, -1, 0, 0, 0, 0, 0, -1], st: [], reached: 0 };
}

/** Azar repetible. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Lo dibujado a 60 cuadros por segundo con snapshots que llegan demorados y a destiempo, pero en orden. */
function play(jitter: number): { speeds: number[]; ticks: number[] } {
  const buf = new SnapshotBuffer();
  const rand = rng(7);
  const arrivals: [number, number][] = [];
  let last = 0;
  for (let tick = 1; tick <= 240; tick++) {
    last = Math.max(last, tick * MS_PER_TICK + 80 + rand() * jitter);
    arrivals.push([last, tick]);
  }
  const speeds: number[] = [];
  const ticks: number[] = [];
  let next = 0;
  let prevX = Number.NaN;
  for (let now = 200; now < 240 * MS_PER_TICK; now += 1000 / 60) {
    while (next < arrivals.length && arrivals[next]![0] <= now) buf.push(snapshot(arrivals[next]![1]), arrivals[next++]![0]);
    const f = buf.sample(now);
    if (!f) continue;
    const x = f.zombies[0]!.x;
    // Los primeros dos segundos, el reloj se está acomodando.
    if (now > 2500 && Number.isFinite(prevX)) speeds.push((x - prevX) / (1 / 60));
    if (now > 2500) ticks.push(f.tick);
    prevX = x;
  }
  return { speeds, ticks };
}

describe("el reloj de los snapshots", () => {
  for (const jitter of [0, 40, 100]) {
    it(`con ${jitter} ms de jitter el zombi se dibuja caminando parejo`, () => {
      const { speeds, ticks } = play(jitter);
      const off = speeds.filter((v) => Math.abs(v - 3) > 0.6).length;
      expect(off / speeds.length, "cuadros con la velocidad corrida más de 20 %").toBeLessThan(0.05);
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    });
  }

  it("una partida nueva (el tick vuelve a cero) empieza de cero, y un snapshot viejo se ignora", () => {
    const buf = new SnapshotBuffer();
    for (let t = 100; t <= 110; t++) buf.push(snapshot(t), t * MS_PER_TICK);
    buf.push(snapshot(108), 111 * MS_PER_TICK);
    expect(buf.latest!.tick).toBe(110);
    buf.push(snapshot(1), 112 * MS_PER_TICK);
    expect(buf.latest!.tick).toBe(1);
    expect(buf.sample(112 * MS_PER_TICK)!.tick).toBe(1);
  });
});
