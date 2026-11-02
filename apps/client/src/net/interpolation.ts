import {
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

const MAX_FRAMES = 40;
const TELEPORT_M = 3;

/**
 * Los snapshots llegan 20 veces por segundo y la pantalla dibuja 60 o más: se
 * guarda un historial corto y se dibuja ~100 ms en el pasado, interpolando.
 */
export class SnapshotBuffer {
  private frames: Frame[] = [];

  push(msg: SnapshotMsg, recvAt: number): void {
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
  }

  clear(): void {
    this.frames.length = 0;
  }

  get latest(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  sample(renderTime: number): InterpolatedFrame | null {
    const last = this.frames[this.frames.length - 1];
    if (!last) return null;
    const first = this.frames[0]!;
    const whole = (f: Frame): InterpolatedFrame => ({ tick: f.tick, players: [...f.players.values()], zombies: [...f.zombies.values()], grenades: [...f.grenades.values()], powerUps: f.powerUps, round: f.round });
    if (renderTime >= last.recvAt) return whole(last);
    if (renderTime <= first.recvAt) return whole(first);

    let a = first;
    let b = last;
    for (let i = 0; i < this.frames.length - 1; i++) {
      const cur = this.frames[i]!;
      const next = this.frames[i + 1]!;
      if (cur.recvAt <= renderTime && renderTime <= next.recvAt) {
        a = cur;
        b = next;
        break;
      }
    }
    const span = b.recvAt - a.recvAt;
    const t = span > 0 ? (renderTime - a.recvAt) / span : 1;

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
    return { tick: lerp(a.tick, b.tick, t), players, zombies, grenades, powerUps: b.powerUps, round: b.round };
  }
}
