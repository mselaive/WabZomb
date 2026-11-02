import type { GameMap } from "../map/types.js";
import { FABRICA } from "../map/fabrica.js";
import { eyeHeightOf } from "./movement.js";
import { startMatch } from "./rounds.js";
import { createGameState, createPlayer, step } from "./step.js";
import type { GameState, PlayerInput, SimEvent } from "./types.js";

export const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1,
  fwd: 0,
  side: 0,
  yaw: 0,
  pitch: 0,
  shoot: false,
  reload: false,
  jump: false,
  crouch: false,
  sprint: false,
  scope: false,
  use: false,
  melee: false,
  act: 0,
  view: -1,
  ...over,
});

export interface Harness {
  state: GameState;
  events: SimEvent[];
  map: GameMap;
  seq: number;
  /** Un tick con estos inputs (uno por jugador, por id). */
  tick: (inputs?: Record<number, Partial<PlayerInput>>) => void;
  /** Varios ticks iguales. */
  run: (n: number, inputs?: Record<number, Partial<PlayerInput>>) => void;
  /** Apunta al pecho del zombi más cercano y aprieta el gatillo (un tick). */
  shootNearest: (id?: number) => void;
}

/** Una partida arrancada con `players` jugadores, en la ronda 1 anunciándose. */
export function harness(players = 1, seed = 7, map: GameMap = FABRICA): Harness {
  const state = createGameState();
  for (let i = 1; i <= players; i++) state.players.push(createPlayer(i));
  const events: SimEvent[] = [];
  startMatch(state, seed, map, events);
  const h: Harness = {
    state,
    events,
    map,
    seq: 1,
    tick(inputs = {}) {
      const m = new Map<number, PlayerInput[]>();
      for (const p of state.players) m.set(p.id, [input({ seq: h.seq, yaw: p.yaw, pitch: p.pitch, ...(inputs[p.id] ?? {}) })]);
      h.seq++;
      step(state, m, events, map);
    },
    run(n, inputs) {
      for (let i = 0; i < n; i++) h.tick(inputs);
    },
    shootNearest(id = 1) {
      const p = state.players.find((q) => q.id === id)!;
      let best = null as (typeof state.zombies)[number] | null;
      let bestD = Infinity;
      for (const z of state.zombies) {
        const d = Math.hypot(z.x - p.x, z.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = z;
        }
      }
      if (!best) {
        h.tick();
        return;
      }
      const ex = p.x;
      const ey = p.y + eyeHeightOf(p);
      const ez = p.z;
      const dx = best.x - ex;
      const dy = best.y + 1.0 - ey;
      const dz = best.z - ez;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      // Dos inputs: uno sin gatillo (para las semiautomáticas) y uno con.
      h.tick({ [id]: { yaw, pitch, shoot: false } });
      h.tick({ [id]: { yaw, pitch, shoot: true } });
    },
  };
  return h;
}

/** Salta la espera entre rondas. */
export function skipIntermission(h: Harness): void {
  h.state.round.ticksLeft = 1;
  h.tick();
}
