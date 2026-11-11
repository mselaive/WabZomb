import {
  ACT_GRENADE,
  ACT_NONE,
  applySlotAction,
  createPlayer,
  shotDirections,
  stepMelee,
  stepPlayerMovement,
  stepWeaponState,
  tryThrow,
  type Box,
  type PlayerInput,
  type PlayerState,
  type UnpackedPlayer,
  type Vec3,
} from "@wabzomb/shared";

const SNAP_THRESHOLD = 2.0;
const IGNORE_THRESHOLD = 0.02;
const ERROR_DECAY_TAU = 0.08;

/** Un disparo propio, decidido acá sin esperar al servidor. */
export interface PredictedShot {
  seq: number;
  /** Arma (id), o -1 para el cuchillo, -2 para la granada. */
  weapon: number;
  dirs: Vec3[];
}

/**
 * Predicción y reconciliación del jugador local: el input se aplica al toque y
 * cuando llega el snapshot se vuelve al estado del servidor y se re-ejecutan
 * los inputs que todavía no había procesado.
 */
export class Predictor {
  readonly state: PlayerState;
  private pending: PlayerInput[] = [];
  private errX = 0;
  private errY = 0;
  private errZ = 0;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevCrouch = 0;
  private replaying = false;
  corrections = 0;

  constructor(id: number) {
    this.state = createPlayer(id);
  }

  reset(from: UnpackedPlayer): void {
    this.pending.length = 0;
    this.errX = this.errY = this.errZ = 0;
    this.load(from);
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.prevZ = this.state.z;
    this.prevCrouch = this.state.crouch;
  }

  /** Un input nuevo: se aplica ya mismo y se guarda hasta que el servidor lo confirme. */
  apply(input: PlayerInput, boxes: readonly Box[], canAct: boolean): PredictedShot | null {
    this.pending.push(input);
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.prevZ = this.state.z;
    this.prevCrouch = this.state.crouch;
    return this.step(input, boxes, canAct);
  }

  private step(input: PlayerInput, boxes: readonly Box[], canAct: boolean): PredictedShot | null {
    const s = this.state;
    s.lastSeq = input.seq;
    stepPlayerMovement(s, input, boxes, canAct);
    if (!s.alive) return null;
    // E (usar) y el estado de "ya apretado" se llevan igual que el servidor (la compra la decide él).
    s.useHeld = input.use;
    let out: PredictedShot | null = null;
    if (input.act !== ACT_NONE && !s.down) {
      if (input.act === ACT_GRENADE) {
        if (tryThrow(s, canAct)) out = { seq: input.seq, weapon: -2, dirs: [] };
      } else applySlotAction(s, input.act);
    }
    if (stepMelee(s, input, canAct)) out = { seq: input.seq, weapon: -1, dirs: [] };
    // Caído también se dispara, igual que en el servidor (con la pistola).
    const fired = stepWeaponState(s, input, canAct);
    if (fired >= 0) out = { seq: input.seq, weapon: fired, dirs: shotDirections(s, fired, input.seq) };
    return out;
  }

  private load(server: UnpackedPlayer): void {
    const s = this.state;
    s.alive = server.alive;
    s.down = server.down;
    s.selfRevive = server.selfRevive;
    s.x = server.x;
    s.y = server.y;
    s.z = server.z;
    s.vx = server.vx;
    s.vz = server.vz;
    s.onGround = server.onGround;
    s.crouch = server.crouch;
    s.hp = server.hp;
    s.maxHp = server.maxHp;
    s.slots = [server.slots[0], server.slots[1], server.slots[2]];
    s.active = server.active;
    s.reloading = server.reloading;
    s.scoped = server.scoped;
    s.shootHeld = server.shootHeld;
    s.useHeld = server.useHeld;
    s.points = server.points;
    s.perks = server.perks;
    s.bleedTicks = server.bleed;
    s.reviveTicks = Math.round(server.revive * 60);
    if (server.own) {
      s.vy = server.own.vy;
      s.ammo = [server.own.ammo[0], server.own.ammo[1], server.own.ammo[2]];
      s.reserve = [server.own.reserve[0], server.own.reserve[1], server.own.reserve[2]];
      s.pap = [server.own.pap[0], server.own.pap[1], server.own.pap[2]];
      s.grenades = server.own.grenades;
      s.tagged = server.own.tagged;
      s.fireCd = server.own.fireCd;
      s.reloadCd = server.own.reloadCd;
      s.drawCd = server.own.drawCd;
      s.recoil = server.own.recoil;
      s.meleeCd = server.own.meleeCd;
      s.quickRevives = server.own.quickRevives;
      s.invulnTicks = server.own.invulnTicks;
      s.drinkTicks = server.own.drinkTicks;
      s.axeCd = server.own.axeCd;
      s.hasAxe = server.hasAxe;
    }
  }

  /** Llega el estado autoritativo: rebobinar y volver a aplicar lo no confirmado. */
  reconcile(server: UnpackedPlayer, boxes: readonly Box[], canAct: boolean): void {
    while (this.pending.length > 0 && this.pending[0]!.seq <= server.lastSeq) this.pending.shift();

    const beforeX = this.state.x;
    const beforeY = this.state.y;
    const beforeZ = this.state.z;

    this.load(server);

    this.replaying = true;
    for (const input of this.pending) {
      this.prevX = this.state.x;
      this.prevY = this.state.y;
      this.prevZ = this.state.z;
      this.prevCrouch = this.state.crouch;
      this.step(input, boxes, canAct);
    }
    this.replaying = false;

    const dx = beforeX - this.state.x;
    const dy = beforeY - this.state.y;
    const dz = beforeZ - this.state.z;
    const d2 = dx * dx + dy * dy + dz * dz;

    if (d2 > SNAP_THRESHOLD * SNAP_THRESHOLD) {
      this.errX = this.errY = this.errZ = 0;
      this.prevX = this.state.x;
      this.prevY = this.state.y;
      this.prevZ = this.state.z;
      this.corrections++;
    } else if (d2 > IGNORE_THRESHOLD * IGNORE_THRESHOLD) {
      this.errX = dx;
      this.errY = dy;
      this.errZ = dz;
      this.corrections++;
    }
  }

  renderPosition(dtSeconds: number, alpha: number): { x: number; y: number; z: number; crouch: number } {
    const k = Math.exp(-dtSeconds / ERROR_DECAY_TAU);
    this.errX *= k;
    this.errY *= k;
    this.errZ *= k;
    if (Math.abs(this.errX) < 0.001) this.errX = 0;
    if (Math.abs(this.errY) < 0.001) this.errY = 0;
    if (Math.abs(this.errZ) < 0.001) this.errZ = 0;
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    return {
      x: this.prevX + (this.state.x - this.prevX) * t + this.errX,
      y: this.prevY + (this.state.y - this.prevY) * t + this.errY,
      z: this.prevZ + (this.state.z - this.prevZ) * t + this.errZ,
      crouch: this.prevCrouch + (this.state.crouch - this.prevCrouch) * t,
    };
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get isReplaying(): boolean {
    return this.replaying;
  }
}
