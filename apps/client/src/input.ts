import { ACT_GRENADE, ACT_NONE, ACT_SLOT_0, ACT_SLOT_1, ACT_SLOT_2, type PlayerInput } from "@wabzomb/shared";

/** Tecla -> acción puntual. Se manda una sola vez, en el tick en que se aprieta. */
const ACTION_KEYS: Record<string, number> = {
  Digit1: ACT_SLOT_0,
  Digit2: ACT_SLOT_1,
  Digit3: ACT_SLOT_2,
  KeyG: ACT_GRENADE,
};

const FWD = new Set(["KeyW", "ArrowUp"]);
const BACK = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const JUMP = new Set(["Space"]);
const CROUCH = new Set(["ControlLeft", "ControlRight", "KeyC"]);
const SPRINT = new Set(["ShiftLeft", "ShiftRight"]);
const MELEE = new Set(["KeyV"]);

export type UiIntent = "scoreboardOn" | "scoreboardOff" | "chat" | "lastWeapon" | "spectateNext" | "pause" | "exitFullscreen" | "inspect";

const keyboardLock = (): { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void } | undefined =>
  (navigator as unknown as { keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void } }).keyboard;

const MAX_PITCH = Math.PI / 2 - 0.02;

/**
 * Teclado y mouse. Con el puntero capturado el mouse gira la cámara; sin
 * capturar, hacer click en el canvas lo captura. El input se arma cada tick.
 */
export class InputController {
  private keys = new Set<string>();
  private shooting = false;
  private scoping = false;
  private shotQueued = false;
  private shotTrigger = false;
  private reloadQueued = false;
  private jumpQueued = false;
  private meleeQueued = false;
  private pendingAction = ACT_NONE;
  private intents: UiIntent[] = [];

  yaw = 0;
  pitch = 0;
  sensitivity = 0.0022;
  scopedFactor = 0.35;
  scoped = false;
  enabled = false;
  watching = false;
  uiBusy = false;

  private lockFailed = false;
  fullscreenWanted = false;
  lockRetryHint = false;

  get locked(): boolean {
    return document.pointerLockElement !== null;
  }

  get active(): boolean {
    return this.locked || this.lockFailed;
  }

  requestLock(target: HTMLElement): void {
    if (this.active) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();

    const failed = (err: unknown) => {
      if (err instanceof DOMException && err.name === "WrongDocumentError") this.lockFailed = true;
      else this.lockRetryHint = true;
    };
    const lockPointer = () => {
      this.lockRetryHint = false;
      try {
        const p = target.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown;
        if (p instanceof Promise) {
          p.catch(() => {
            try {
              const again = target.requestPointerLock() as unknown;
              if (again instanceof Promise) again.catch(failed);
            } catch (e) {
              failed(e);
            }
          });
        }
      } catch (e) {
        failed(e);
      }
    };

    if (this.fullscreenWanted && !document.fullscreenElement && document.fullscreenEnabled) {
      document.documentElement.requestFullscreen({ navigationUI: "hide" }).then(
        () => keyboardLock()?.lock?.(["Escape"])?.catch(() => {}),
        () => {},
      );
    } else if (document.fullscreenElement) {
      keyboardLock()?.lock?.(["Escape"])?.catch(() => {});
    }
    lockPointer();
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  onLockChange(): void {
    if (this.locked) {
      this.lockFailed = false;
      this.lockRetryHint = false;
    }
  }

  exitFullscreen(): void {
    keyboardLock()?.unlock?.();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  setView(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  attach(target: HTMLElement): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.enabled && !this.watching) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body) focused.blur();

      if (e.code === "Escape") {
        e.preventDefault();
        if (this.uiBusy || e.repeat) return;
        if (this.lockFailed) {
          this.lockFailed = false;
          return;
        }
        this.intents.push(this.active ? "pause" : "exitFullscreen");
        return;
      }
      if (e.code === "Tab") {
        e.preventDefault();
        if (!e.repeat) this.intents.push("scoreboardOn");
        return;
      }
      if (this.uiBusy) return;
      if ((e.code === "Enter" || e.code === "KeyY") && !e.repeat) {
        this.intents.push("chat");
        e.preventDefault();
        return;
      }
      if (this.watching && !this.enabled) {
        if ((e.code === "Space" || e.code === "KeyE") && !e.repeat) this.intents.push("spectateNext");
        if (e.code === "Space") e.preventDefault();
        return;
      }
      if (!this.enabled) return;

      if (e.code === "KeyR") this.reloadQueued = true;
      if (e.code === "KeyQ" && !e.repeat) this.intents.push("lastWeapon");
      if (e.code === "KeyF" && !e.repeat) this.intents.push("inspect");
      if (JUMP.has(e.code) && !e.repeat) this.jumpQueued = true;
      if (MELEE.has(e.code) && !e.repeat) this.meleeQueued = true;
      const action = ACTION_KEYS[e.code];
      if (action !== undefined && !e.repeat) this.pendingAction = action;
      this.keys.add(e.code);
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Tab") this.intents.push("scoreboardOff");
      if (e.code === "Space" && (this.enabled || this.watching) && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
      this.keys.delete(e.code);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.active) return;
      const k = this.sensitivity * (this.scoped ? this.scopedFactor : 1);
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k;
      if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
      if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;
      while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(".pause")) return;
      if (!this.active) {
        if (this.enabled || this.watching) this.requestLock(target);
        return;
      }
      if (this.watching && !this.enabled) {
        if (e.button === 0) this.intents.push("spectateNext");
        return;
      }
      if (!this.enabled || this.uiBusy) return;
      if (e.button === 0) {
        this.shooting = true;
        this.shotQueued = true;
        this.shotTrigger = true;
      }
      if (e.button === 2) this.scoping = true;
      // La rueda / botón del medio: cuchillo, como en el original.
      if (e.button === 1) {
        this.meleeQueued = true;
        e.preventDefault();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.shooting = false;
      if (e.button === 2) this.scoping = false;
    };

    const onBlur = () => this.releaseAll();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    target.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onBlur);
    target.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      target.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onBlur);
    };
  }

  queueAction(action: number): void {
    this.pendingAction = action;
  }

  /** ¿Está corriendo ahora mismo (Shift y adelante, de pie, sin la mira)? Para la pose del arma. */
  sprintingNow(s: { crouch: number; scoped: boolean; down: boolean; alive: boolean; drinkTicks: number }): boolean {
    return this.enabled && !this.uiBusy && this.any(SPRINT) && this.axis(BACK, FWD) > 0 && s.crouch === 0 && !s.scoped && !s.down && s.alive && s.drinkTicks === 0;
  }

  takeShotTrigger(): boolean {
    const t = this.shotTrigger;
    this.shotTrigger = false;
    return t;
  }

  takeIntents(): UiIntent[] {
    if (this.intents.length === 0) return [];
    const out = this.intents;
    this.intents = [];
    return out;
  }

  private axis(neg: Set<string>, pos: Set<string>): number {
    let v = 0;
    for (const key of this.keys) {
      if (neg.has(key)) v -= 1;
      if (pos.has(key)) v += 1;
    }
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }

  private any(set: Set<string>): boolean {
    for (const key of this.keys) if (set.has(key)) return true;
    return false;
  }

  freeMove(): { fwd: number; side: number; up: number; fast: boolean } {
    return {
      fwd: this.axis(BACK, FWD),
      side: this.axis(LEFT, RIGHT),
      up: (this.any(JUMP) ? 1 : 0) - (this.any(CROUCH) ? 1 : 0),
      fast: this.any(SPRINT),
    };
  }

  /** Arma el input de este tick. `view` es el tick del servidor que se está dibujando. */
  sample(seq: number, view: number): PlayerInput {
    const busy = this.uiBusy;
    const input: PlayerInput = {
      seq,
      fwd: busy ? 0 : this.axis(BACK, FWD),
      side: busy ? 0 : this.axis(LEFT, RIGHT),
      yaw: Math.round(this.yaw * 1000) / 1000,
      pitch: Math.round(this.pitch * 1000) / 1000,
      shoot: !busy && (this.shooting || this.shotQueued),
      reload: this.reloadQueued,
      jump: !busy && (this.jumpQueued || this.any(JUMP)),
      crouch: !busy && this.any(CROUCH),
      sprint: !busy && this.any(SPRINT),
      scope: !busy && this.scoping,
      use: !busy && this.keys.has("KeyE"),
      melee: !busy && (this.meleeQueued || this.any(MELEE)),
      act: this.pendingAction,
      view,
    };
    this.reloadQueued = false;
    this.shotQueued = false;
    this.shotTrigger = false;
    this.jumpQueued = false;
    this.meleeQueued = false;
    this.pendingAction = ACT_NONE;
    return input;
  }

  releaseAll(): void {
    this.keys.clear();
    this.shooting = false;
    this.scoping = false;
    this.shotQueued = false;
    this.jumpQueued = false;
    this.meleeQueued = false;
    this.pendingAction = ACT_NONE;
  }
}
