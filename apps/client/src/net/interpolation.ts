import {
  INTERP_DELAY_MS,
  MS_PER_TICK,
  lerp,
  lerpAngle,
  unpackGrenade,
  unpackPlayer,
  unpackPowerUp,
  unpackRound,
  unpackZombie,
  type PowerUpState,
  type SnapshotMsg,
  type SnapStanding,
  type UnpackedGrenade,
  type UnpackedPlayer,
  type UnpackedRound,
  type UnpackedZombie,
} from "@wabzomb/shared";

export interface Frame {
  tick: number;
  recvAt: number;
  players: Map<number, UnpackedPlayer>;
  zombies: Map<number, UnpackedZombie>;
  grenades: Map<number, UnpackedGrenade>;
  powerUps: PowerUpState[];
  round: UnpackedRound;
  standings: SnapStanding[];
}

export interface InterpolatedFrame {
  tick: number;
  players: UnpackedPlayer[];
  zombies: UnpackedZombie[];
  grenades: UnpackedGrenade[];
  powerUps: PowerUpState[];
  round: UnpackedRound;
}

/** Cómo viene la red, para el panel de F3. */
export interface NetTiming {
  /** Cuánto en el pasado se dibuja, en ms. */
  delayMs: number;
  /** Cuánto se atrasan los snapshots respecto del más puntual (p90 de los últimos 3 s). */
  jitterMs: number;
  /** De cada 100 frames, en cuántos faltó el snapshot siguiente y hubo que adivinar. */
  extrapolatedPct: number;
  /** De cada 100 frames, en cuántos se acabó lo que se podía adivinar y todo quedó quieto. */
  frozenPct: number;
}

const MAX_FRAMES = 40;
const TELEPORT_M = 3;
/** Cuántas llegadas se miran para medir la red: 3 s. */
const CLOCK_WINDOW = 60;
/** Lo más que se espera por un snapshot atrasado. Más que esto se nota al apuntar. */
const MAX_DELAY_MS = 200;
/** Si falta el snapshot siguiente, se sigue con la velocidad que traía, hasta esto. */
const MAX_EXTRAPOLATE_TICKS = 3;
/** Un snapshot con el tick tan atrás es de otra partida, no uno demorado. */
const RESTART_TICKS = 20;
/** Si el reloj estimado se va más que esto, se salta en vez de acomodarse despacio. */
const SNAP_CLOCK_MS = 400;

/**
 * Los snapshots llegan 20 veces por segundo y la pantalla dibuja 60 o más: se
 * guarda un historial corto y se dibuja un poco en el pasado, interpolando.
 *
 * El tiempo es el del servidor (el tick de cada snapshot), no la hora en que
 * llegó: por internet llegan a destiempo, de a dos juntos o con un hueco, y si se
 * interpolara por hora de llegada los zombis caminarían a los saltos. Con las
 * llegadas se estima a qué hora local corresponde cada tick (con la más
 * puntual de las últimas, que es la que menos se demoró en el camino) y cuánto
 * se atrasan las demás, y se dibuja con ese colchón.
 */
export class SnapshotBuffer {
  private frames: Frame[] = [];
  /** recvAt - tick * MS_PER_TICK de las últimas llegadas. */
  private arrivals: number[] = [];
  /** El desfasaje con el que se dibuja (hora local menos tiempo de servidor), ya suavizado. */
  private offset = Number.NaN;
  private lastSampleAt = 0;
  private delay = INTERP_DELAY_MS;
  private jitter = 0;
  private samples = 0;
  private extrapolated = 0;
  private frozen = 0;

  push(msg: SnapshotMsg, recvAt: number): void {
    const prev = this.frames[this.frames.length - 1];
    if (prev && msg.tick <= prev.tick) {
      // El tick vuelve a cero al arrancar otra partida: lo anterior ya no sirve. Uno
      // apenas más viejo que el último (no debería pasar por WebSocket) se descarta.
      if (msg.tick > prev.tick - RESTART_TICKS) return;
      this.clear();
    }
    const players = new Map<number, UnpackedPlayer>();
    for (const raw of msg.players) {
      const p = unpackPlayer(raw);
      players.set(p.id, p);
    }
    const zombies = new Map<number, UnpackedZombie>();
    for (const raw of msg.z) {
      const z = unpackZombie(raw);
      zombies.set(z.id, z);
    }
    this.frames.push({
      tick: msg.tick,
      recvAt,
      players,
      zombies,
      grenades: new Map((msg.gr ?? []).map(unpackGrenade).map((g) => [g.id, g])),
      powerUps: (msg.pu ?? []).map(unpackPowerUp),
      round: unpackRound(msg.rd),
      standings: msg.st,
    });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();

    this.arrivals.push(recvAt - msg.tick * MS_PER_TICK);
    if (this.arrivals.length > CLOCK_WINDOW) this.arrivals.shift();
    const best = Math.min(...this.arrivals);
    const late = this.arrivals.map((a) => a - best).sort((a, b) => a - b);
    this.jitter = late[Math.floor(late.length * 0.9)] ?? 0;
  }

  clear(): void {
    this.frames.length = 0;
    this.arrivals.length = 0;
    this.offset = Number.NaN;
    this.lastSampleAt = 0;
  }

  get latest(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  /** Qué tan bien viene la red, y se empieza a contar de nuevo. */
  takeTiming(): NetTiming {
    const n = Math.max(1, this.samples);
    const out = { delayMs: Math.round(this.delay), jitterMs: Math.round(this.jitter), extrapolatedPct: Math.round((100 * this.extrapolated) / n), frozenPct: Math.round((100 * this.frozen) / n) };
    this.samples = this.extrapolated = this.frozen = 0;
    return out;
  }

  /** El tick (con fracción) que se dibuja ahora. */
  private renderTick(now: number): number {
    const best = Math.min(...this.arrivals);
    // Un tick de margen más lo que se atrasan las llegadas, como mínimo lo de siempre.
    const wantDelay = Math.min(MAX_DELAY_MS, Math.max(INTERP_DELAY_MS, MS_PER_TICK + this.jitter));
    const dt = this.lastSampleAt > 0 ? Math.min(0.25, (now - this.lastSampleAt) / 1000) : 0;
    this.lastSampleAt = now;
    // El colchón crece rápido (se nota un hueco) y se achica despacio (se nota que vuelva a crecer).
    this.delay += (wantDelay - this.delay) * (1 - Math.exp(-dt / (wantDelay > this.delay ? 0.25 : 3)));
    const want = best + this.delay;
    if (!Number.isFinite(this.offset) || Math.abs(want - this.offset) > SNAP_CLOCK_MS) this.offset = want;
    // Despacio: así el mundo apenas se acelera o se frena, y nunca vuelve atrás.
    else this.offset += (want - this.offset) * (1 - Math.exp(-dt / 0.6));
    return (now - this.offset) / MS_PER_TICK;
  }

  sample(now: number): InterpolatedFrame | null {
    const last = this.frames[this.frames.length - 1];
    if (!last) return null;
    const first = this.frames[0]!;
    const whole = (f: Frame): InterpolatedFrame => ({ tick: f.tick, players: [...f.players.values()], zombies: [...f.zombies.values()], grenades: [...f.grenades.values()], powerUps: f.powerUps, round: f.round });
    const tick = this.renderTick(now);
    this.samples++;
    if (tick <= first.tick) return whole(first);
    if (tick >= last.tick) return this.extrapolate(last, tick);

    let a = first;
    let b = last;
    for (let i = 0; i < this.frames.length - 1; i++) {
      const cur = this.frames[i]!;
      const next = this.frames[i + 1]!;
      if (cur.tick <= tick && tick <= next.tick) {
        a = cur;
        b = next;
        break;
      }
    }
    const span = b.tick - a.tick;
    const t = span > 0 ? (tick - a.tick) / span : 1;

    const players: UnpackedPlayer[] = [];
    for (const [id, target] of b.players) {
      const prev = a.players.get(id);
      if (!prev || prev.alive !== target.alive || Math.hypot(target.x - prev.x, target.y - prev.y, target.z - prev.z) > TELEPORT_M) {
        players.push(target);
        continue;
      }
      players.push({ ...target, x: lerp(prev.x, target.x, t), y: lerp(prev.y, target.y, t), z: lerp(prev.z, target.z, t), yaw: lerpAngle(prev.yaw, target.yaw, t), pitch: lerp(prev.pitch, target.pitch, t), crouch: lerp(prev.crouch, target.crouch, t) });
    }
    const zombies: UnpackedZombie[] = [];
    for (const [id, target] of b.zombies) {
      const prev = a.zombies.get(id);
      if (!prev || Math.hypot(target.x - prev.x, target.z - prev.z) > TELEPORT_M) {
        zombies.push(target);
        continue;
      }
      zombies.push({ ...target, x: lerp(prev.x, target.x, t), y: lerp(prev.y, target.y, t), z: lerp(prev.z, target.z, t), yaw: lerpAngle(prev.yaw, target.yaw, t) });
    }
    const grenades: UnpackedGrenade[] = [];
    for (const [id, target] of b.grenades) {
      const prev = a.grenades.get(id);
      grenades.push(prev ? { ...target, x: lerp(prev.x, target.x, t), y: lerp(prev.y, target.y, t), z: lerp(prev.z, target.z, t) } : target);
    }
    return { tick: a.tick + span * t, players, zombies, grenades, powerUps: b.powerUps, round: b.round };
  }

  /**
   * Se acabaron los snapshots: el siguiente viene atrasado. En vez de dejar todo
   * quieto y después saltar, cada uno sigue un poco con la velocidad que traía.
   */
  private extrapolate(last: Frame, tick: number): InterpolatedFrame {
    const ahead = tick - last.tick;
    if (ahead > 0.05) this.extrapolated++;
    if (ahead > MAX_EXTRAPOLATE_TICKS) this.frozen++;
    const s = (Math.min(ahead, MAX_EXTRAPOLATE_TICKS) * MS_PER_TICK) / 1000;
    const players = [...last.players.values()].map((p) => (p.alive && !p.down ? { ...p, x: p.x + p.vx * s, z: p.z + p.vz * s } : p));
    const zombies = [...last.zombies.values()].map((z) => ({ ...z, x: z.x + z.vx * s, z: z.z + z.vz * s }));
    return { tick: last.tick + Math.min(ahead, MAX_EXTRAPOLATE_TICKS), players, zombies, grenades: [...last.grenades.values()], powerUps: last.powerUps, round: last.round };
  }
}
