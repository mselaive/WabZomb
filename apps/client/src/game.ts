import * as THREE from "three";
import {
  ACT_SLOT_0,
  BOARD_REPAIR_TICKS,
  BTN_CROUCH,
  BTN_JUMP,
  BTN_MELEE,
  BTN_RELOAD,
  BTN_SCOPE,
  BTN_SHOOT,
  BTN_USE,
  BTN_SPRINT,
  FOV,
  FOV_SCOPED,
  HEAD_HEIGHT,
  HIT_BODY,
  HIT_HEAD,
  HIT_WORLD,
  MS_PER_TICK,
  EGG_BEACON,
  EGG_BOAT,
  EGG_BOAT_PARTS,
  EGG_BOSS_DEAD,
  EGG_BREAKERS,
  EGG_BUILT,
  EGG_ESCAPED,
  EGG_KEY,
  EGG_READY,
  EGG_SAFE,
  EGG_FURNACE,
  EGG_PART_NAMES,
  EGG_RADIO_NOTES,
  EGG_SONG,
  EGG_SOULS,
  EGG_STEP_NOTES,
  PERK_COLORS,
  PERK_QUICK,
  PERK_SPEED,
  THUNDERGUN,
  TRABUCO,
  BRASAS,
  POWERUP_NAMES,
  SP_ID,
  ZOMBIE_HALF_W,
  ZOMBIE_HEIGHT,
  Z_ATTACK,
  ZONE_HEAD,
  collisionBoxes,
  createGameState,
  createPlayer,
  eyeHeightOf,
  findInteraction,
  hasPerk,
  heightOf,
  mapByIndex,
  rayAabb,
  raycastBoxes,
  slotLimit,
  spreadOf,
  unpackBox,
  unpackPap,
  unpackPlayer,
  unpackRound,
  weapon,
  weaponStats,
  type Box,
  type GameMap,
  type GameState,
  type Interaction,
  type MatchPhase,
  type PlayerMeta,
  type RayHit,
  type ServerMsg,
  type SimEvent,
  type SnapshotMsg,
  type SnapStanding,
  type UnpackedPlayer,
  type UnpackedRound,
  type UnpackedZombie,
  TICK_RATE,
  ZTYPE_BOSS,
  zoneAt,
} from "@wabzomb/shared";
import { Audio } from "./audio.js";
import { InputController } from "./input.js";
import { Net, diagnoseConnection } from "./net/connection.js";
import { SnapshotBuffer, type InterpolatedFrame } from "./net/interpolation.js";
import { Predictor, type PredictedShot } from "./net/prediction.js";
import { Effects } from "./render/effects.js";
import { PlayerAvatar } from "./render/players.js";
import { ViewModel, buildAxeMesh, muzzleOffset } from "./render/viewmodel.js";
import { Post } from "./render/post.js";
import { WardenAvatar } from "./render/zombies.js";
import { World } from "./render/world.js";
import { ZombieAvatar, buildZombieCorpse, buildZombieGibs } from "./render/zombies.js";
import type { UI } from "./ui.js";

const TRACER_MAX = 120;
const LOBBY_CAMERA = new THREE.Vector3(0, 14, 30);
/** Cuánto se quedan los zombis muertos en el piso (ms). */
const CORPSE_MS = 12_000;

/** Lo que dice el que llama a la sala de visitas cuando alguien atiende. */
const PHONE_LINES = [
  "—¿Arrieta? No... no sos él. Igual te dejé algo del lado de ustedes.",
  "Una respiración, una risa, y alguien cuelga. Algo cayó detrás tuyo.",
  "«Los que bajan al horno no vuelven. Tomá, por si acaso.»",
  "Una voz de mujer: «Hace años que llamo a este número». Corta. Te dejó algo.",
  "«El alcaide escucha todas las líneas. Rápido: agarrá lo que te dejé.»",
];

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 3400);
  private post: Post | null = null;
  private questState: readonly number[] = [];
  private beamHumAt = 0;
  /** El final de la fuga: cuándo arrancó la escena de la lancha (0, nada). */
  private escapeAt = 0;
  /** Se apaga para sacar capturas desde otro lado. */
  lobbyDrift = true;
  private readonly world = new World();
  private effects!: Effects;
  private viewModel!: ViewModel;
  private readonly avatars = new Map<number, PlayerAvatar>();
  private readonly avatarGroup = new THREE.Group();
  private readonly zombieAvatars = new Map<number, ZombieAvatar | WardenAvatar>();
  private readonly zombieGroup = new THREE.Group();
  private readonly corpseGroup = new THREE.Group();
  private readonly corpses: { mesh: THREE.Group; at: number }[] = [];
  private map: GameMap = mapByIndex(0);
  private boxes: Box[] = [];
  readonly input = new InputController();
  readonly audio = new Audio();

  private net: Net | null = null;
  private myId = -1;
  private hostId = -1;
  private roster: PlayerMeta[] = [];
  private phase: MatchPhase = "lobby";
  private readonly buffer = new SnapshotBuffer();
  private predictor: Predictor | null = null;
  /** Una sombra del estado del servidor con lo que hace falta para los carteles de E. */
  private readonly shadow: GameState = createGameState();
  private seq = 1;
  private inputAcc = 0;
  private viewTick = -1;
  private netPanel: HTMLPreElement | null = null;
  private netPanelAt = 0;
  private netFrames = 0;
  private netCorrections = 0;
  private lastFrame = performance.now();
  private roomCode = "";
  private leaving = false;
  private latestStandings: SnapStanding[] = [];
  private latestRound: UnpackedRound | null = null;
  private latestDoors = -1;
  private wasReloading = false;
  private prevActive = -1;
  private lastSlot = 0;
  private deathInfo: string | null = null;
  private spectateIndex = 0;
  private freeCam = false;
  private readonly freePos = new THREE.Vector3();
  private stage!: HTMLElement;
  private punchPitch = 0;
  private punchYaw = 0;
  private lastInterp: InterpolatedFrame | null = null;
  private predictedHits = 0;
  private stepDist = 1.2;
  private stepLeft = false;
  private wasOnGround = true;
  private lastVy = 0;
  private landDip = 0;
  private prevYaw = 0;
  private prevPitch = 0;
  private prevShoot = false;
  private soloOnJoin = false;
  private holdSince = 0;
  private lastPrompt: Interaction | null = null;
  private songOn = false;
  private roundBannerAt = 0;

  constructor(private readonly ui: UI) {}

  async init(): Promise<void> {
    this.stage = document.getElementById("stage")!;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.stage.appendChild(this.renderer.domElement);

    this.camera.rotation.order = "YXZ";
    this.world.scene.add(this.camera);
    this.world.scene.add(this.avatarGroup);
    this.world.scene.add(this.zombieGroup);
    this.world.scene.add(this.corpseGroup);
    this.effects = new Effects(this.world.scene);
    this.viewModel = new ViewModel(this.camera);
    this.viewModel.setHidden(true);
    this.world.setEnvironment(this.renderer);
    this.loadMap(0);
    this.lobbyCamera();

    this.input.attach(this.stage);
    document.addEventListener("pointerlockchange", () => {
      this.input.onLockChange();
      this.onLockChange();
    });
    window.addEventListener("mousedown", () => this.audio.unlock(), { passive: true });
    window.addEventListener("keydown", () => this.audio.unlock(), { passive: true });
    // F3: el panel de la red, para saber si lo que se traba es la conexión o la máquina.
    window.addEventListener("keydown", (e) => {
      if (e.code !== "F3") return;
      e.preventDefault();
      this.toggleNetPanel();
    });
    if (new URLSearchParams(location.search).has("net")) this.toggleNetPanel();
    window.addEventListener("resize", () => this.resize());
    this.resize();

    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  debugState(): Record<string, unknown> {
    const s = this.predictor?.state;
    return {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
      yaw: this.input.yaw,
      pitch: this.input.pitch,
      alive: s?.alive ?? false,
      down: s?.down ?? false,
      hp: s?.hp ?? 0,
      points: s?.points ?? 0,
      phase: this.phase,
      round: this.latestRound?.number ?? 0,
      zombies: this.lastInterp?.zombies.length ?? 0,
      pending: this.predictor?.pendingCount ?? 0,
      corrections: this.predictor?.corrections ?? 0,
    };
  }

  setVolume(v: number): void {
    this.audio.setVolume(v);
  }

  setSensitivity(v: number): void {
    this.input.sensitivity = v * 0.0002;
  }

  private resize(): void {
    const w = this.stage.clientWidth || window.innerWidth;
    const h = this.stage.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private lobbyCamera(): void {
    if (this.map?.art) {
      // Broadway, de punta a punta: el plano del menú.
      this.camera.position.set(20, 1.6, 0.6);
      this.camera.lookAt(-24, 3.4, 0);
      return;
    }
    this.camera.position.copy(LOBBY_CAMERA);
    this.camera.lookAt(0, 0, -4);
  }

  // ------------------------------------------------------------ conexión

  connect(code: string, name: string): void {
    this.disconnect();
    this.leaving = false;
    this.roomCode = code;
    this.ui.showScreen("connecting");
    this.ui.setRoom(code);
    this.net = new Net({
      room: code,
      name,
      onMessage: (msg) => this.onMessage(msg),
      onOpen: () => {
        document.getElementById("reconnecting")!.hidden = true;
      },
      onClose: (closeCode) => {
        if (this.leaving) return;
        if (closeCode === 4001) {
          this.disconnect();
          this.ui.showError("Abriste la sala en otra pestaña: esa se quedó con tu lugar.");
          return;
        }
        if (closeCode === 4000 || closeCode === 4002) return;
        if (this.phase === "playing" || this.phase === "countdown") {
          document.getElementById("reconnecting")!.hidden = false;
        } else if (this.phase === "lobby" && this.myId === -1) {
          void diagnoseConnection(code).then((why) => {
            this.disconnect();
            this.ui.showError(why);
          });
        }
      },
      onError: () => {},
    });
  }

  disconnect(): void {
    this.leaving = true;
    this.soloOnJoin = false;
    this.net?.close();
    this.net = null;
    this.myId = -1;
    this.predictor = null;
    this.phase = "lobby";
    this.buffer.clear();
    this.clearMatchScene();
    this.ui.setHud(false);
    this.input.enabled = false;
    this.input.watching = false;
    this.input.releaseLock();
    this.viewModel.setHidden(true);
    this.audio.stopSong();
    this.songOn = false;
    this.lobbyCamera();
    document.getElementById("reconnecting")!.hidden = true;
  }

  setReady(ready: boolean): void {
    this.net?.send({ t: "ready", ready });
  }

  requestStart(): void {
    this.net?.send({ t: "start" });
  }

  kick(id: number): void {
    this.net?.send({ t: "kick", id });
  }

  /** Al entrar a la sala, marcar listo: jugando solo arranca sola. */
  soloOnJoinRequested(): void {
    this.soloOnJoin = true;
  }

  setMap(map: number): void {
    this.net?.send({ t: "map", map });
  }

  chat(text: string): void {
    this.net?.send({ t: "chat", text });
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome":
        this.myId = msg.you;
        this.hostId = msg.hostId;
        this.roster = msg.roster;
        this.loadMap(msg.map);
        this.ui.setRoom(msg.room);
        this.ui.updateLobby(this.roster, this.hostId, this.myId, msg.map);
        if (msg.phase === "lobby") this.ui.showScreen("lobby");
        document.getElementById("reconnecting")!.hidden = true;
        if (this.soloOnJoin && msg.phase === "lobby") this.setReady(true);
        this.soloOnJoin = false;
        return;
      case "roster":
        this.roster = msg.roster;
        this.hostId = msg.hostId;
        if (this.phase === "lobby") this.loadMap(msg.map);
        this.ui.updateLobby(this.roster, this.hostId, this.myId, msg.map, msg.nextIn);
        return;
      case "start":
        this.loadMap(msg.map);
        this.beginMatch();
        return;
      case "s":
        this.onSnapshot(msg);
        return;
      case "err":
        this.disconnect();
        this.ui.showError(msg.message);
        return;
      case "chat":
        this.ui.addChat(msg.by < 0 ? "Juego" : this.ui.nameOf(msg.by), msg.text, this.phase === "playing");
        return;
    }
  }

  /** Lo que sigue de la fuga, para la tabla: nada hasta que se la empieza. */
  private nextRingAt = 0;

  /** El teléfono que suena, con su timbre cada tres segundos. */
  private updatePhones(now: number): void {
    const ringing = this.questState[7] ?? -1;
    this.world.updatePhones(ringing);
    const ph = ringing >= 0 ? this.map.quest?.phones?.[ringing] : undefined;
    if (!ph) {
      this.nextRingAt = 0;
      return;
    }
    if (now < this.nextRingAt) return;
    this.nextRingAt = now + 3000;
    this.audio.phoneRing(ph.x, ph.z);
  }

  /** Lo que se escucha al levantar un tubo que no sonaba: una pista de lo que sigue. */
  private phoneHint(): string {
    if (!this.shadow.power) return "Sin tono. La línea no tiene corriente: primero la luz, abajo en la ciudadela.";
    const next = this.journalText().replace(/^La fuga: /, "");
    if (!next) return "Estática, y muy lejos una voz: «Las radios. Buscá las radios viejas».";
    return `Estática, y una voz cansada: «${next}»`;
  }

  private journalText(): string {
    const q = this.map.quest;
    if (!q) return "";
    const e = this.shadow.egg;
    const r = this.shadow.radios;
    if ((e & EGG_ESCAPED) !== 0) return "";
    if (r === 0 && (e & EGG_SONG) === 0) return "";
    const has = (bit: number) => (e & bit) !== 0;
    let text: string;
    if (!has(EGG_SONG)) text = "Hay más radios viejas en la isla.";
    else if (!has(EGG_BUILT)) text = "El núcleo, la bobina y lo que escupa el horno: al banco de la armería.";
    else if (!has(EGG_SAFE)) text = "La caja fuerte del alcaide. La combinación está en tiza: bloque A, ciudadela y sala de operaciones.";
    else if (!has(EGG_KEY)) text = "La llave está en la caja fuerte abierta.";
    else if (!has(EGG_BOAT)) text = `Las piezas de la lancha: ${q.parts.filter((_, i) => !has(EGG_BOAT_PARTS[i]!)).map((p) => p.name).join(", ") || "ya están: al muelle"}.`;
    else if (!has(EGG_BREAKERS)) text = "Las tres llaves de corte, en menos de 45 segundos: Control, Michigan y Times Square.";
    else if (!has(EGG_BEACON)) text = "El faro: desde el techo de los bloques.";
    else if (!has(EGG_READY)) text = "Aguantar hasta que se abra la niebla.";
    else if (!has(EGG_BOSS_DEAD)) text = "El alcaide. No se va a ir solo.";
    else text = "Todos a la lancha.";
    return `La fuga: ${text}`;
  }

  private mapLoaded = -1;
  private assetsBar: HTMLElement | null = null;

  /** Lo que tarda en bajar un mapa con assets: se avisa abajo, y se puede jugar igual mientras tanto. */
  private showAssets(k: number): void {
    if (!this.assetsBar) {
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:40;padding:6px 14px;border-radius:6px;background:rgba(10,12,16,.82);color:#e8e2cc;font:600 13px Rajdhani,ui-sans-serif,sans-serif;letter-spacing:.04em;pointer-events:none";
      document.body.append(el);
      this.assetsBar = el;
    }
    this.assetsBar.textContent = `Cargando la prisión · ${Math.round(k * 100)} %`;
    this.assetsBar.hidden = k >= 1;
  }

  private loadMap(index: number): void {
    if (index === this.mapLoaded) return;
    this.mapLoaded = index;
    this.map = mapByIndex(index);
    this.showAssets(this.map.art ? 0 : 1);
    this.world.onAssets = (k) => this.showAssets(k);
    this.world.onThunder = (d) => this.audio.thunder(d);
    this.world.load(this.map);
    this.latestDoors = -1;
    this.boxes = collisionBoxes({ doorsOpen: 0 }, this.map);
  }

  private beginMatch(): void {
    this.buffer.clear();
    this.predictor = null;
    this.seq = 1;
    this.viewTick = -1;
    this.inputAcc = 0;
    this.deathInfo = null;
    this.spectateIndex = 0;
    this.freeCam = false;
    this.latestDoors = -1;
    this.clearMatchScene();
    this.world.setPower(false, true);
    this.world.lightQuickRevive(this.map.perks.findIndex((m) => m.perk === PERK_QUICK));
  }

  private clearMatchScene(): void {
    for (const a of this.avatars.values()) {
      this.avatarGroup.remove(a.root);
      a.dispose();
    }
    this.avatars.clear();
    for (const z of this.zombieAvatars.values()) this.zombieGroup.remove(z.root);
    this.zombieAvatars.clear();
    this.corpseGroup.clear();
    this.corpses.length = 0;
    this.effects.clear();
    this.world.clearDynamic();
  }

  // ------------------------------------------------------------ snapshots

  private onSnapshot(msg: SnapshotMsg): void {
    const now = performance.now();
    this.buffer.push(msg, now);
    this.latestStandings = msg.st;
    this.latestRound = unpackRound(msg.rd);

    // Lo fijo del mundo: puertas, tablas, luz, caja, Pack-a-Punch, efectos, radios.
    if (msg.doors !== this.latestDoors) {
      this.latestDoors = msg.doors;
      this.boxes = collisionBoxes({ doorsOpen: msg.doors }, this.map);
      this.world.updateDoors(msg.doors);
    }
    this.shadow.doorsOpen = msg.doors;
    this.shadow.boards = msg.boards;
    this.shadow.power = msg.power === 1;
    this.shadow.box = unpackBox(msg.box);
    this.shadow.pap = unpackPap(msg.pap);
    this.shadow.instaKill = msg.fx[0];
    this.shadow.doublePoints = msg.fx[1];
    this.shadow.fireSale = msg.fx[2];
    this.shadow.songTicks = msg.fx[3];
    this.shadow.radios = msg.radios;
    this.shadow.egg = msg.egg;
    this.shadow.eggSouls = msg.souls;
    this.shadow.eggTicks = msg.q[0];
    this.questState = msg.q;
    this.world.updateEgg(msg.egg, msg.souls, msg.q);
    this.shadow.phase = msg.phase;
    this.shadow.round.number = this.latestRound.number;
    this.world.updateBoards(msg.boards);
    this.world.setPower(msg.power === 1);
    this.syncShadowPlayers(msg);

    if (msg.phase !== this.phase) this.setPhase(msg.phase, msg);

    if (msg.phase === "countdown") {
      this.ui.showBanner(`Empieza en ${Math.max(1, Math.ceil(msg.left / 20))}`, "gold", 1200);
    }

    if (msg.phase === "playing") {
      const mine = msg.players.find((t) => t[SP_ID] === this.myId);
      if (mine) {
        const me = unpackPlayer(mine);
        if (!this.predictor) {
          this.predictor = new Predictor(this.myId);
          this.predictor.reset(me);
          this.input.setView(me.yaw, me.pitch);
          this.prevActive = me.active;
        } else if (!this.predictor.state.alive && me.alive) {
          this.predictor.reset(me);
          this.input.setView(me.yaw, me.pitch);
          this.deathInfo = null;
          this.ui.setSpectating(null);
          this.freeCam = false;
        } else {
          this.predictor.reconcile(me, this.boxes, true);
        }
      }
      for (const ev of msg.ev ?? []) this.onEvent(ev);
    }
  }

  /** Los demás jugadores, en la sombra del estado: para saber a quién se puede revivir. */
  private syncShadowPlayers(msg: SnapshotMsg): void {
    const seen = new Set<number>();
    for (const raw of msg.players) {
      const u = unpackPlayer(raw);
      seen.add(u.id);
      let p = this.shadow.players.find((q) => q.id === u.id);
      if (!p) {
        p = createPlayer(u.id);
        this.shadow.players.push(p);
      }
      p.x = u.x;
      p.y = u.y;
      p.z = u.z;
      p.alive = u.alive;
      p.down = u.down;
      p.selfRevive = u.selfRevive;
      p.connected = u.connected;
    }
    this.shadow.players = this.shadow.players.filter((p) => seen.has(p.id));
  }

  private setPhase(phase: MatchPhase, msg: SnapshotMsg): void {
    this.phase = phase;
    switch (phase) {
      case "lobby":
        this.predictor = null;
        this.clearMatchScene();
        this.ui.setHud(false);
        this.ui.setSpectating(null);
        this.input.releaseLock();
        this.viewModel.setHidden(true);
        this.audio.stopSong();
        this.songOn = false;
        this.lobbyCamera();
        this.ui.showScreen("lobby");
        break;
      case "countdown":
      case "playing":
        this.ui.hideScreens();
        this.ui.setHud(true);
        this.lockHintShown = false;
        this.refreshLockHint();
        break;
      case "ended": {
        this.input.releaseLock();
        this.ui.setHud(false);
        this.ui.setSpectating(null);
        this.viewModel.setHidden(true);
        this.audio.stopSong();
        this.songOn = false;
        if ((msg.egg & EGG_ESCAPED) !== 0) {
          // La lancha se va: se ve desde arriba unos segundos, y recién ahí el resultado.
          this.escapeAt = performance.now();
          this.audio.boatHorn();
          window.setTimeout(() => {
            if (this.phase === "ended") this.ui.showResult(msg.reached, msg.st, this.myId, true);
            this.escapeAt = 0;
          }, 8500);
        } else {
          this.ui.showResult(msg.reached, msg.st, this.myId, false);
        }
        break;
      }
    }
  }

  private onEvent(ev: SimEvent): void {
    const me = this.predictor?.state;
    switch (ev.t) {
      case "axe": {
        if (ev.byId === this.myId) this.audio.axeThrow();
        this.effects.axeFlight(buildAxeMesh(), ev.path);
        return;
      }
      case "shot":
        this.onShotEvent(ev);
        return;
      case "zhit": {
        const at = new THREE.Vector3(ev.x, ev.y, ev.z);
        if (ev.byId !== this.myId) this.effects.blood(at, ev.zone === ZONE_HEAD);
        if (ev.byId === this.myId) {
          if (this.predictedHits > 0) this.predictedHits--;
          else {
            this.ui.hitmarker(ev.zone === ZONE_HEAD);
            this.audio.hitmarker(ev.zone === ZONE_HEAD);
          }
        }
        return;
      }
      case "zkill": {
        const avatar = this.zombieAvatars.get(ev.zombieId);
        if (ev.weapon === TRABUCO || ev.weapon === BRASAS) {
          // La Blundergat lo revienta: los pedazos salen para el lado del tiro.
          const from = ev.byId === this.myId ? this.camera.position : this.avatars.get(ev.byId)?.root.position;
          const away = new THREE.Vector3(ev.x - (from?.x ?? ev.x), 0, ev.z - (from?.z ?? ev.z - 1));
          if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
          away.normalize();
          this.effects.gibs(buildZombieGibs(ev.zombieId), new THREE.Vector3(ev.x, ev.y, ev.z), away, ev.weapon === BRASAS);
          this.audio.zombieDie(ev.x, ev.z);
          this.audio.gore(ev.x, ev.z);
          if (avatar) {
            this.zombieGroup.remove(avatar.root);
            this.zombieAvatars.delete(ev.zombieId);
          }
          return;
        }
        const yaw = avatar ? avatar.root.rotation.y : Math.random() * 6;
        const corpse = buildZombieCorpse(ev.zombieId, ev.x, ev.y, ev.z, yaw);
        this.corpseGroup.add(corpse);
        this.corpses.push({ mesh: corpse, at: performance.now() });
        this.effects.blood(new THREE.Vector3(ev.x, ev.y + 1, ev.z), true);
        this.audio.zombieDie(ev.x, ev.z);
        if (avatar) {
          this.zombieGroup.remove(avatar.root);
          this.zombieAvatars.delete(ev.zombieId);
        }
        return;
      }
      case "hurt":
        if (ev.targetId === this.myId) {
          const z = this.lastInterp?.zombies.find((q) => q.id === ev.zombieId);
          const s = me;
          const fx = (z?.x ?? (s?.x ?? 0)) - (s?.x ?? 0);
          const fz = (z?.z ?? (s?.z ?? 0)) - (s?.z ?? 0);
          const toward = Math.atan2(-fx, -fz);
          let rel = toward - this.input.yaw;
          while (rel > Math.PI) rel -= Math.PI * 2;
          while (rel < -Math.PI) rel += Math.PI * 2;
          this.ui.damageFlash(rel);
          this.audio.hurt();
          this.punchPitch += 0.03;
        }
        if (ev.zombieId >= 0) {
          const z = this.lastInterp?.zombies.find((q) => q.id === ev.zombieId);
          if (z) this.audio.zombieAttack(z.x, z.z);
        }
        return;
      case "down":
        if (ev.id === this.myId) {
          this.audio.down();
          this.ui.showBanner("Caíste", "blood", 2500, me?.selfRevive ? "Quick Revive te levanta en unos segundos" : this.roster.length > 1 ? "Que te levante un compañero (E)" : "Se terminó");
        } else {
          this.ui.showBanner(`${this.ui.nameOf(ev.id)} cayó`, "blood", 2500, "Revivilo con E antes de que se desangre");
          this.audio.down();
        }
        return;
      case "revive":
        this.audio.revive();
        if (ev.id === this.myId) this.ui.showBanner("De vuelta", "gold", 1500);
        return;
      case "bleedout":
        if (ev.id === this.myId) this.deathInfo = "Te desangraste. Volvés en la próxima ronda.";
        return;
      case "round":
        this.onRoundEvent(ev.phase, ev.number);
        return;
      case "points":
        if (ev.id === this.myId) this.audio.points();
        return;
      case "door": {
        const d = this.map.doors[ev.id];
        if (d) {
          this.audio.door((d.box.minX + d.box.maxX) / 2, (d.box.minZ + d.box.maxZ) / 2);
          if (this.map.art && d.style === "bars") this.audio.buzzer((d.box.minX + d.box.maxX) / 2, (d.box.minZ + d.box.maxZ) / 2);
        }
        return;
      }
      case "power":
        this.audio.power();
        this.ui.showBanner("Luz", "gold", 2500, "Las bebidas y el Pack-a-Punch ya andan");
        return;
      case "buy":
        if (ev.byId !== this.myId) return;
        if (ev.what === "perk") {
          this.audio.perk();
          this.viewModel.drink(PERK_COLORS[ev.which] ?? 0xffffff);
          this.ui.showBanner(weaponPerkName(ev.which), "gold", 1800);
        } else if (ev.what === "weapon" && ev.which === THUNDERGUN) {
          this.audio.powerUp();
          this.ui.showBanner("Thunder Gun", "gold", 2500, "Un soplido que se lleva todo lo que tenga adelante");
        } else this.audio.buy();
        return;
      case "egg":
        if (ev.step === 4) {
          // Un alma más en el horno: un golpe grave, y el número cada tanto.
          this.audio.soul(ev.souls ?? 0);
          if ((ev.souls ?? 0) % 10 === 0 || (ev.souls ?? 0) <= 2) this.ui.showBanner(`Almas: ${ev.souls ?? 0} de ${EGG_SOULS}`, "blood", 1400);
          return;
        }
        this.audio.powerUp();
        {
          const q = this.map.quest;
          const steps = q?.notes.steps ?? EGG_STEP_NOTES;
          if (q && ev.step >= 10) {
            if (ev.step === 12) {
              this.audio.dialClick();
              return;
            }
            if (ev.step === 11) {
              this.audio.door(q.safe.x, q.safe.z);
              this.ui.showBanner("La caja fuerte se abrió", "gold", 5000, "Adentro está la llave maestra.");
              return;
            }
            if (ev.step === 34) {
              this.ui.showBanner("El alcaide cayó", "gold", 8000, q.notes.bossDown);
              return;
            }
            if (ev.step === 35) {
              this.audio.breaker();
              this.ui.showBanner(`Llave de corte ${ev.souls ?? 1} de ${q.breakers.length}`, "gold", 2500);
              return;
            }
            if (ev.step === 36) {
              this.ui.showBanner("Se levantaron las llaves", "blood", 5000, q.notes.breakersFail);
              return;
            }
            if (ev.step === 37) {
              this.audio.breaker();
              this.ui.showBanner("El faro tiene corriente", "gold", 6000, "Ahora, al techo: prendelo.");
              return;
            }
            if (ev.step === 38) {
              this.ui.showBanner("La Blundergat se está templando", "gold", 3500, "Va a tardar. Aguantá cerca del horno.");
              return;
            }
            if (ev.step === 39) {
              this.ui.showBanner("El horno devolvió algo", "gold", 4000, "La Blundergat de brasas ya está lista.");
              return;
            }
            if (ev.step === 41) {
              this.audio.phonePick();
              const line = PHONE_LINES[Math.floor(Math.random() * PHONE_LINES.length)]!;
              this.ui.showBanner(ev.byId === this.myId ? "Atendiste" : `${this.ui.nameOf(ev.byId)} atendió`, "gold", 6000, line);
              return;
            }
            if (ev.step === 42) {
              if (ev.byId !== this.myId) return;
              this.audio.phonePick();
              this.ui.showBanner("El teléfono", "gold", 6000, this.phoneHint());
              return;
            }
            if (ev.step === 40) {
              this.ui.showBanner("El hacha de incendios", "gold", 4000, "Con X se tira, rebota entre ellos y vuelve sola.");
              return;
            }
            if (ev.step === 10) this.ui.showBanner(`${q.key.name[0]!.toUpperCase()}${q.key.name.slice(1)}`, "gold", 9000, q.notes.key);
            else if (ev.step >= 20 && ev.step < 30) {
              const have = EGG_BOAT_PARTS.filter((b) => (this.shadow.egg & b) !== 0).length + 1;
              this.ui.showBanner(`${q.parts[ev.step - 20]?.name ?? "Una pieza"} (${have} de ${EGG_BOAT_PARTS.length})`, "gold", 4000, q.notes.part);
            } else if (ev.step === 30) this.ui.showBanner("La lancha arranca", "gold", 9000, `${q.notes.boat} ${q.notes.breakers}`);
            else if (ev.step === 31) {
              this.audio.siren();
              this.ui.showBanner("El faro", "blood", 7000, q.notes.beacon);
            } else if (ev.step === 32) {
              this.audio.boatHorn();
              this.audio.wardenToll();
              this.ui.showBanner("Se abrió la niebla", "blood", 8000, q.notes.ready);
            } else if (ev.step === 33) this.audio.boatHorn();
            return;
          }
          if (ev.step === 5) this.ui.showBanner("El horno se llenó", "blood", 3500, steps[2]);
          else if (ev.step === 3) this.ui.showBanner("Thunder Gun armada", "gold", 9000, q ? `${steps[3]} ${q.notes.safeHint}` : steps[3]);
          else this.ui.showBanner(`Una pieza: ${EGG_PART_NAMES[ev.step] ?? ""}`, "gold", 4000, steps[ev.step]);
        }
        return;
      case "box":
        if (ev.what === "open") this.audio.boxOpen();
        else if (ev.what === "teddy") {
          this.audio.boxTeddy();
          this.ui.showBanner("El osito", "gold", 2500, "La caja se mudó. Te devuelve la plata");
        } else if (ev.what === "take" && ev.byId === this.myId) this.audio.buy();
        return;
      case "pap":
        if (ev.what === "start") this.audio.pap();
        else if (ev.what === "take" && ev.byId === this.myId) {
          this.audio.buy();
          this.ui.showBanner(weaponStats(ev.weapon, true).name, "gold", 2000);
        }
        return;
      case "board": {
        const b = this.map.barriers[ev.barrier];
        if (b) this.audio.board((b.box.minX + b.box.maxX) / 2, (b.box.minZ + b.box.maxZ) / 2, ev.byId === -1);
        return;
      }
      case "powerup":
        if (ev.what === "take") {
          this.audio.powerUp();
          this.ui.showBanner(POWERUP_NAMES[ev.kind] ?? "", "gold", 2000);
        }
        return;
      case "reload":
        if (ev.byId !== this.myId) this.audio.reload(ev.x, ev.z);
        return;
      case "throw": {
        const who = this.buffer.latest?.players.get(ev.byId);
        if (ev.byId !== this.myId && who) this.audio.throwNade(who.x, who.z);
        return;
      }
      case "explode": {
        const at = new THREE.Vector3(ev.x, ev.y, ev.z);
        this.effects.explosion(at);
        this.audio.explosion(ev.x, ev.z);
        if (me && Math.hypot(me.x - ev.x, me.z - ev.z) < 8) this.punchPitch += 0.05;
        return;
      }
      case "melee":
        if (ev.byId !== this.myId) {
          const who = this.buffer.latest?.players.get(ev.byId);
          if (who) this.audio.knife(ev.hit);
        } else if (ev.hit) {
          this.ui.hitmarker(false);
        }
        return;
      case "zombie":
        if (ev.what === "rise") this.audio.rise(ev.x, ev.z);
        else if (ev.what === "tear") this.audio.board(ev.x, ev.z, true);
        else if (ev.what === "vault") this.audio.vault(ev.x, ev.z);
        return;
      case "radio":
        this.audio.radio();
        // El diario del ingeniero, una entrada por radio; con las tres, la canción y el armario.
        this.ui.showBanner(ev.all ? "Las tres radios" : `Radio ${(this.shadow.radios.toString(2).split("1").length - 1)} de 3`, "gold", 9000, (this.map.quest?.notes.radios ?? EGG_RADIO_NOTES)[ev.which] ?? "");
        return;
      case "gameover":
        this.audio.gameOver();
        return;
    }
  }

  private onRoundEvent(phase: "intermission" | "live" | "over", number: number): void {
    if (phase === "intermission") {
      this.ui.showBanner(`Ronda ${number}`, "blood", 3200, number === 1 ? "Vienen por las ventanas: reparalas con E" : undefined);
      this.audio.roundStart();
      this.roundBannerAt = performance.now();
    } else if (phase === "over") {
      this.audio.roundEnd();
    }
  }

  /** Un tiro de otro (o la confirmación del propio): trazador, polvo o sangre. */
  private onShotEvent(ev: Extract<SimEvent, { t: "shot" }>): void {
    const own = ev.byId === this.myId;
    if (weapon(ev.weapon).beam) {
      // El reflector de otro: una línea de luz breve.
      if (!own && ev.hits.length >= 3) this.effects.tracer(new THREE.Vector3(ev.x, ev.y - 0.2, ev.z), new THREE.Vector3(ev.hits[0]!, ev.hits[1]!, ev.hits[2]!), 60);
      return;
    }
    const shooter = this.buffer.latest?.players.get(ev.byId);
    const pap = false;
    if (!own) this.audio.shot(ev.weapon, ev.x, ev.z, pap);
    const avatar = this.avatars.get(ev.byId);
    const from = avatar && avatar.root.visible ? avatar.muzzle.clone() : new THREE.Vector3(ev.x, ev.y, ev.z);
    if (!own) this.effects.flash(from, 10);
    for (let i = 0; i + 3 < ev.hits.length; i += 4) {
      const to = new THREE.Vector3(ev.hits[i]!, ev.hits[i + 1]!, ev.hits[i + 2]!);
      const kind = ev.hits[i + 3]!;
      if (!own) this.effects.tracer(from, to);
      if (kind === HIT_WORLD) {
        this.effects.dust(to);
        if (!own) {
          this.holeAt(ev.x, ev.y, ev.z, to);
          this.audio.impact(to.x, to.z);
        }
      } else if (kind === HIT_BODY || kind === HIT_HEAD) {
        if (!own) this.effects.blood(to, kind === HIT_HEAD);
      }
    }
    void shooter;
  }

  private holeAt(ox: number, oy: number, oz: number, to: THREE.Vector3): void {
    const dx = to.x - ox;
    const dy = to.y - oy;
    const dz = to.z - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return;
    const hit: RayHit = { t: 0, exit: 0, nx: 0, ny: 0, nz: 0 };
    if (raycastBoxes(ox, oy, oz, dx / len, dy / len, dz / len, this.boxes, len + 0.05, hit) < 0) return;
    this.effects.bulletHole(to, new THREE.Vector3(hit.nx, hit.ny, hit.nz));
  }

  // ------------------------------------------------------------ cuadro a cuadro

  private toggleNetPanel(): void {
    if (this.netPanel) {
      this.netPanel.remove();
      this.netPanel = null;
      return;
    }
    const el = document.createElement("pre");
    el.style.cssText = "position:fixed;top:8px;right:8px;z-index:50;margin:0;padding:6px 8px;background:rgba(0,0,0,.6);color:#cfe;font:12px/1.35 ui-monospace,monospace;pointer-events:none;white-space:pre";
    document.body.append(el);
    this.netPanel = el;
    this.netPanelAt = 0;
  }

  /** Cada medio segundo: cuadros por segundo, ping, y cómo vienen los snapshots. */
  private updateNetPanel(now: number): void {
    if (!this.netPanel) return;
    this.netFrames++;
    if (now - this.netPanelAt < 500) return;
    const secs = this.netPanelAt > 0 ? (now - this.netPanelAt) / 1000 : 0;
    const fps = secs > 0 ? Math.round(this.netFrames / secs) : 0;
    const t = this.buffer.takeTiming();
    const corrections = this.predictor?.corrections ?? 0;
    const lag = this.net?.simulatedLagMs ? `  (simulado ${this.net.simulatedLagMs})` : "";
    this.netPanel.textContent = [
      `FPS ${fps}`,
      `ping ${Math.round(this.net?.rtt ?? 0)} ms${lag}`,
      `jitter ${t.jitterMs} ms · colchón ${t.delayMs} ms`,
      `adivinado ${t.extrapolatedPct}% · quieto ${t.frozenPct}%`,
      `correcciones ${corrections - this.netCorrections} · sin confirmar ${this.predictor?.pendingCount ?? 0}`,
    ].join("\n");
    this.netCorrections = corrections;
    this.netFrames = 0;
    this.netPanelAt = now;
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.updateNetPanel(now);

    this.handleIntents();
    this.refreshLockHint();
    if (this.phase === "playing") this.updatePlaying(now, dt);
    else if (this.phase === "countdown") {
      const frame = this.buffer.sample(now);
      if (frame) this.updateOthers(frame, dt);
    }

    // Los muertos se hunden y se van.
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i]!;
      const age = now - c.at;
      if (age > CORPSE_MS) {
        this.corpseGroup.remove(c.mesh);
        this.corpses.splice(i, 1);
      } else if (age > CORPSE_MS - 2000) {
        c.mesh.position.y -= dt * 0.3;
      }
    }

    this.effects.update(dt);
    this.audio.listenerYaw = this.camera.rotation.y;
    this.audio.listenerX = this.camera.position.x;
    this.audio.listenerZ = this.camera.position.z;
    if (this.escapeAt > 0) {
      const boat = this.world.sailBoat(dt);
      if (boat) {
        const k = (now - this.escapeAt) / 8500;
        this.camera.position.set(boat.x + 9 - k * 4, boat.y + 3.2 + k * 2.4, boat.z + 16 + k * 7);
        this.camera.lookAt(boat.x, boat.y + 3 + k * 3, boat.z - 8);
      }
    }
    if (this.world.art) {
      // El menú y la sala: la cámara avanza despacio por Broadway.
      if (this.lobbyDrift && this.phase === "lobby") {
        const k = ((now / 1000) * 0.45) % 34;
        this.camera.position.set(17 - k, 1.7, 0.7 * Math.sin(k * 0.13));
        this.camera.lookAt(-24, 3.2 + Math.sin(k * 0.2) * 0.4, 0);
      }
      const zone = zoneAt(this.map, this.camera.position.x, this.camera.position.z, this.camera.position.y - 1.6);
      const outdoor = zone < 0 || this.map.zones[zone]?.outdoor === true;
      this.world.art.update(dt, this.camera.position, outdoor);
      this.audio.setAmbience(outdoor);
      if (!this.post) {
        this.post = new Post(this.renderer, this.world.scene, this.camera);
        this.post.setSize(this.stage.clientWidth || window.innerWidth, this.stage.clientHeight || window.innerHeight);
      }
      this.post.render(dt);
      if (this.world.art && this.post.lowQuality) this.world.art.rainOff = true;
    } else {
      this.audio.stopAmbience();
      this.renderer.render(this.world.scene, this.camera);
    }
  }

  private handleIntents(): void {
    for (const intent of this.input.takeIntents()) {
      switch (intent) {
        case "pause":
          this.input.releaseLock();
          break;
        case "exitFullscreen":
          this.input.exitFullscreen();
          break;
        case "inspect":
          if (this.predictor?.state.alive && !this.predictor.state.reloading) this.viewModel.inspect();
          break;
        case "scoreboardOn":
          this.ui.setScoreboard(true);
          if (this.latestRound) this.ui.updateScoreboard(this.latestStandings, this.myId, this.latestRound.number);
          break;
        case "scoreboardOff":
          this.ui.setScoreboard(false);
          break;
        case "chat":
          if (this.phase === "playing" && !this.ui.isTeamChatOpen) this.ui.openTeamChat();
          break;
        case "lastWeapon": {
          const s = this.predictor?.state;
          if (s && s.alive && this.lastSlot !== s.active && (s.slots[this.lastSlot] ?? -1) >= 0) this.input.queueAction(ACT_SLOT_0 + this.lastSlot);
          break;
        }
        case "spectateNext":
          this.spectateIndex++;
          break;
      }
    }
  }

  private onLockChange(): void {
    if (!this.input.locked) this.input.releaseAll();
    this.refreshLockHint();
  }

  private lockHintShown = false;
  private lockRetryShown = false;

  private refreshLockHint(): void {
    const show = (this.phase === "playing" || this.phase === "countdown") && !this.input.active;
    const retry = this.input.lockRetryHint;
    if (show === this.lockHintShown && retry === this.lockRetryShown) return;
    this.lockHintShown = show;
    this.lockRetryShown = retry;
    this.ui.setPause(show, retry);
  }

  setFullscreen(on: boolean): void {
    this.input.fullscreenWanted = on;
  }

  resume(): void {
    this.input.requestLock(this.stage);
  }

  exitFullscreen(): void {
    this.input.exitFullscreen();
  }

  private updatePlaying(now: number, dt: number): void {
    const frame = this.buffer.sample(now);
    if (frame) {
      this.viewTick = frame.tick;
      this.lastInterp = frame;
      this.updateOthers(frame, dt);
      this.updateZombies(frame, dt, now);
      this.world.updateGrenades(frame.grenades, dt);
      this.world.updatePowerUps(frame.powerUps, dt);
      this.world.updateBox(this.shadow.box, this.map, dt);
      this.world.updatePap(this.shadow.pap, dt);
      this.world.updateRadios(this.shadow.radios, this.shadow.songTicks > 0);
      this.updatePhones(now);
      this.ui.setRound(frame.round.number, frame.round.phase, frame.round.total, frame.round.killed, frame.zombies.length);
      const soulsOn = (this.shadow.egg & EGG_SONG) !== 0 && (this.shadow.egg & EGG_FURNACE) === 0;
      const siege = this.shadow.eggTicks;
      const clock = (ticks: number) => `${Math.floor(ticks / TICK_RATE / 60)}:${String(Math.floor(ticks / TICK_RATE) % 60).padStart(2, "0")}`;
      const boss = frame.zombies.find((zb) => zb.type === ZTYPE_BOSS);
      const forge = this.questState[5] ?? 0;
      const brk = this.questState[4] ?? 0;
      const note = boss
        ? `El alcaide ${Math.round(boss.hp * 100)} %`
        : siege > 0
          ? `Aguantá ${clock(siege)}`
          : brk > 0
            ? `Llaves de corte ${clock(brk)}`
            : forge > 0
              ? `Horno ${clock(forge)}`
              : "";
      this.ui.setEffects(this.shadow.instaKill, this.shadow.doublePoints, this.shadow.fireSale, soulsOn ? this.shadow.eggSouls : -1, note);
      this.ui.setMates(frame.players.filter((p) => p.id !== this.myId && p.connected));
      this.ui.setJournal(this.journalText());
      const mine = this.predictor?.state;
      if (mine) this.ui.setAxe(mine.hasAxe, Math.ceil(mine.axeCd / TICK_RATE));
    }
    // La canción del easter egg.
    const song = this.shadow.songTicks > 0;
    if (song !== this.songOn) {
      this.songOn = song;
      if (song) this.audio.startSong();
      else this.audio.stopSong();
    }

    const me = this.predictor;
    const alive = me?.state.alive ?? false;
    this.input.uiBusy = this.ui.isTeamChatOpen;
    this.input.enabled = alive && !this.ui.isTeamChatOpen;
    this.input.watching = !alive;

    if (me && alive) {
      this.inputAcc += dt * 1000;
      if (this.input.takeShotTrigger() && this.inputAcc < MS_PER_TICK && !this.input.uiBusy) {
        this.sendInput();
        this.inputAcc -= MS_PER_TICK;
      }
      let ran = 0;
      while (this.inputAcc >= MS_PER_TICK && ran < 4) {
        this.inputAcc -= MS_PER_TICK;
        this.sendInput();
        ran++;
      }
      if (this.inputAcc > MS_PER_TICK) this.inputAcc = 0;

      const s = me.state;
      if (s.active !== this.prevActive) {
        this.lastSlot = this.prevActive >= 0 ? this.prevActive : this.lastSlot;
        this.prevActive = s.active;
        this.audio.draw();
      }

      if (s.onGround && !this.wasOnGround) {
        const hard = this.lastVy < -6;
        this.audio.land(hard);
        this.viewModel.land(hard ? 1 : 0.5);
        this.landDip = hard ? 1 : 0.5;
      }
      this.wasOnGround = s.onGround;
      this.lastVy = s.vy;
      this.landDip = Math.max(0, this.landDip - dt * 6);

      const horiz = Math.hypot(s.vx, s.vz);
      if (s.onGround && horiz > 3.2) {
        this.stepDist += horiz * dt;
        if (this.stepDist >= 1.7) {
          this.stepDist = 0;
          this.stepLeft = !this.stepLeft;
          this.audio.ownStep(this.stepLeft);
        }
      } else if (horiz < 0.5) {
        this.stepDist = 1.2;
      }

      const pos = me.renderPosition(dt, this.inputAcc / MS_PER_TICK);
      // Caído: la cámara baja casi al piso, ladeada.
      const eye = s.down ? 0.55 : eyeHeightOf({ crouch: pos.crouch });
      this.camera.position.set(pos.x, pos.y + eye - this.landDip * 0.09, pos.z);
      const decay = Math.exp(-dt * 9);
      this.punchPitch *= decay;
      this.punchYaw *= decay;
      this.camera.rotation.set(this.input.pitch + this.punchPitch, this.input.yaw + this.punchYaw, s.down ? 0.18 : 0);

      const wid = s.slots[s.active] ?? -1;
      const pap = (s.pap[s.active] ?? 0) === 1;
      const reloadSeconds = wid >= 0 ? weapon(wid).reloadTicks * 0.05 * (hasPerk(s, PERK_SPEED) ? 0.5 : 1) : 1;
      if (s.reloading && !this.wasReloading) {
        this.viewModel.reload(reloadSeconds);
        this.audio.reload(null, null);
      }
      this.wasReloading = s.reloading;

      this.viewModel.setWeapon(wid, pap);
      this.viewModel.setHidden(s.scoped);
      let lookDx = this.input.yaw - this.prevYaw;
      if (lookDx > Math.PI) lookDx -= Math.PI * 2;
      if (lookDx < -Math.PI) lookDx += Math.PI * 2;
      const lookDy = this.input.pitch - this.prevPitch;
      this.prevYaw = this.input.yaw;
      this.prevPitch = this.input.pitch;
      const sprinting = this.input.sprintingNow(s);
      this.viewModel.update(dt, horiz, s.onGround, s.reloading, reloadSeconds, lookDx, lookDy, sprinting);
      this.input.scoped = s.scoped;
      this.applyFov(s.scoped ? FOV_SCOPED : sprinting ? FOV + 7 : FOV, dt);
      this.ui.setScope(s.scoped);
      this.ui.setCrosshair(!s.scoped && wid >= 0 && !sprinting && s.drinkTicks === 0, wid >= 0 ? spreadOf(s, weapon(wid), s.recoil) : 0);

      this.ui.setVitals(s.hp, s.maxHp, s.down);
      this.ui.setPoints(s.points);
      this.ui.setPerks(s.perks);
      this.ui.setAmmo(wid, pap, s.ammo[s.active] ?? 0, s.reserve[s.active] ?? 0, s.slots, s.pap, s.active, s.grenades, slotLimit(s));
      this.updatePrompt(s, now);
      this.ui.setSpectating(s.down ? (s.selfRevive ? `<b>Caíste.</b><small>Quick Revive te levanta en ${Math.ceil(s.bleedTicks / 20)} s</small>` : `<b>Caíste.</b><small>${this.roster.length > 1 ? `Que te levanten antes de ${Math.ceil(s.bleedTicks / 20)} s` : "Se terminó"}</small>`) : null);
    } else {
      this.viewModel.setHidden(true);
      this.ui.setScope(false);
      this.ui.setCrosshair(false, 0);
      this.ui.setPrompt(null, 0);
      this.applyFov(FOV, dt);
      this.spectate(frame, dt);
    }

    if (!this.ui.scoreboardHidden && this.latestRound) this.ui.updateScoreboard(this.latestStandings, this.myId, this.latestRound.number);
  }

  /** El cartel de E: lo mismo que decide el servidor, calculado acá con lo que se sabe. */
  private updatePrompt(s: Predictor["state"], now: number): void {
    this.shadow.phase = "playing";
    const it = findInteraction(this.shadow, s, this.map);
    const changed = !it || !this.lastPrompt || it.kind !== this.lastPrompt.kind || it.id !== this.lastPrompt.id;
    if (changed) this.holdSince = now;
    this.lastPrompt = it;
    let holding = 0;
    if (it && it.hold && it.ok && s.useHeld) {
      if (it.kind === "revive") {
        const q = this.lastInterp?.players.find((p) => p.id === it.id);
        holding = q?.revive ?? 0;
      } else {
        const ms = BOARD_REPAIR_TICKS * MS_PER_TICK;
        holding = ((now - this.holdSince) % ms) / ms;
      }
    } else if (!s.useHeld) this.holdSince = now;
    this.ui.setPrompt(it, holding);
  }

  private applyFov(target: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 18);
    const next = this.camera.fov + (target - this.camera.fov) * k;
    if (Math.abs(next - this.camera.fov) > 0.01) {
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }
  }

  private sendInput(): void {
    const me = this.predictor;
    if (!me || !this.net) return;
    const input = this.input.sample(this.seq++, this.viewTick);
    if (input.shoot && !this.prevShoot) {
      const s = me.state;
      const wid = s.slots[s.active] ?? -1;
      if (wid >= 0 && (s.ammo[s.active] ?? 0) === 0 && (s.reserve[s.active] ?? 0) === 0) this.audio.dryFire();
    }
    this.prevShoot = input.shoot;
    const shot = me.apply(input, this.boxes, true);
    let btn = 0;
    if (input.shoot) btn |= BTN_SHOOT;
    if (input.reload) btn |= BTN_RELOAD;
    if (input.jump) btn |= BTN_JUMP;
    if (input.crouch) btn |= BTN_CROUCH;
    if (input.sprint) btn |= BTN_SPRINT;
    if (input.scope) btn |= BTN_SCOPE;
    if (input.use) btn |= BTN_USE;
    if (input.melee) btn |= BTN_MELEE;
    this.net.send({
      t: "in",
      seq: input.seq,
      f: input.fwd,
      s: input.side,
      yaw: Math.round(input.yaw * 1000),
      pit: Math.round(input.pitch * 1000),
      btn,
      act: input.act,
      ...(this.viewTick >= 0 ? { vt: Math.round(this.viewTick * 10) } : {}),
    });
    if (shot) this.onPredictedShot(shot);
  }

  /** Mi tiro, dibujado en el mismo input en que apreté: fogonazo, trazador, sangre. */
  private onPredictedShot(shot: PredictedShot): void {
    const s = this.predictor!.state;
    if (shot.weapon === -2) {
      this.viewModel.throwAnim();
      this.audio.throwNade(null, null);
      return;
    }
    if (shot.weapon === -1) {
      this.viewModel.melee();
      this.audio.knife(false);
      return;
    }
    const w = weapon(shot.weapon);
    const pap = (s.pap[s.active] ?? 0) === 1;
    if (w.beam) {
      this.viewModel.beamOn();
      const nowMs = performance.now();
      if (nowMs >= this.beamHumAt) {
        this.beamHumAt = nowMs + 130;
        this.audio.beamHum();
      }
      return;
    }
    this.viewModel.fire();
    this.audio.shot(shot.weapon, null, null, pap);
    // La bala va al centro de la mira: la sacudida es sólo para que se sienta, y chica.
    this.punchPitch = Math.min(0.045, this.punchPitch + w.kick * 0.6);
    this.punchYaw += (Math.random() - 0.5) * w.kick * 0.2;
    const ox = s.x;
    const oy = s.y + eyeHeightOf(s);
    const oz = s.z;
    const from = muzzleOffset(shot.weapon).add(this.viewModel.root.position);
    this.camera.updateMatrixWorld();
    this.camera.localToWorld(from);
    this.effects.flash(from, 14);
    if (w.cls !== "wonder") {
      const right = new THREE.Vector3(Math.cos(this.input.yaw), 0, -Math.sin(this.input.yaw));
      this.effects.shell(this.viewModel.ejectPoint(this.camera, new THREE.Vector3()), right);
    }

    const zombies = this.lastInterp?.zombies ?? [];
    let anyHit = false;
    let anyHead = false;
    for (const d of shot.dirs) {
      const hit: RayHit = { t: 0, exit: 0, nx: 0, ny: 0, nz: 0 };
      const tWorld = raycastBoxes(ox, oy, oz, d.x, d.y, d.z, this.boxes, TRACER_MAX, hit);
      let t = tWorld < 0 ? TRACER_MAX : tWorld;
      let victim: UnpackedZombie | null = null;
      let head = false;
      for (const z of zombies) {
        const tz = rayAabb(ox, oy, oz, d.x, d.y, d.z, z.x, z.y + ZOMBIE_HEIGHT / 2, z.z, ZOMBIE_HALF_W, ZOMBIE_HEIGHT / 2, ZOMBIE_HALF_W, t);
        if (tz < 0 || tz >= t) continue;
        t = tz;
        victim = z;
        head = oy + d.y * tz - z.y > ZOMBIE_HEIGHT - HEAD_HEIGHT;
      }
      const to = new THREE.Vector3(ox + d.x * t, oy + d.y * t, oz + d.z * t);
      if (shot.weapon === THUNDERGUN) {
        // El soplido: una nube que se abre hacia adelante; los zombis vuelan cuando lo confirme el servidor.
        this.effects.shockwave(from, new THREE.Vector3(d.x, d.y, d.z), pap);
        this.punchPitch += 0.06;
        continue;
      }
      if (w.cls === "wonder") this.effects.rayBeam(from, to, pap);
      else this.effects.tracer(from, to);
      if (victim) {
        this.effects.blood(to, head);
        anyHit = true;
        anyHead ||= head;
      } else if (tWorld >= 0) {
        this.effects.dust(to);
        if (hit.nx !== 0 || hit.ny !== 0 || hit.nz !== 0) this.effects.bulletHole(to, new THREE.Vector3(hit.nx, hit.ny, hit.nz));
      }
      if (w.cls === "wonder") this.effects.explosion(to, 0.5);
    }
    if (anyHit) {
      this.predictedHits++;
      this.ui.hitmarker(anyHead);
      this.audio.hitmarker(anyHead);
    }
  }

  private updateOthers(frame: InterpolatedFrame, dt: number): void {
    const present = new Set<number>();
    for (const p of frame.players) {
      if (p.id === this.myId || !p.alive || !p.connected) continue;
      present.add(p.id);
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        avatar = new PlayerAvatar(this.ui.nameOf(p.id), this.ui.indexOf(p.id));
        this.avatars.set(p.id, avatar);
        this.avatarGroup.add(avatar.root);
      }
      avatar.root.visible = true;
      avatar.update(p, dt);
    }
    for (const [id, avatar] of this.avatars) if (!present.has(id)) avatar.root.visible = false;
  }

  private updateZombies(frame: InterpolatedFrame, dt: number, now: number): void {
    const present = new Set<number>();
    const me = this.predictor?.state;
    for (const z of frame.zombies) {
      present.add(z.id);
      let avatar = this.zombieAvatars.get(z.id);
      if (!avatar) {
        avatar = z.type === ZTYPE_BOSS ? new WardenAvatar(z.type) : new ZombieAvatar(z.id, z.type);
        this.zombieAvatars.set(z.id, avatar);
        this.zombieGroup.add(avatar.root);
        avatar.groanAt = now + Math.random() * 3000;
      }
      avatar.update(z, dt, now);
      // Gruñen de a ratos, más si están cerca o por pegar.
      if (now >= avatar.groanAt) {
        const near = me ? Math.hypot(z.x - me.x, z.z - me.z) : 50;
        if (near < 24) this.audio.groan(z.x, z.z, z.state === Z_ATTACK ? 1.4 : 1);
        avatar.groanAt = now + 2500 + Math.random() * 5000;
      }
    }
    for (const [id, avatar] of this.zombieAvatars) {
      if (present.has(id)) continue;
      this.zombieGroup.remove(avatar.root);
      this.zombieAvatars.delete(id);
    }
  }

  /** Muerto (desangrado): con los ojos de un compañero, o una cámara libre. */
  private spectate(frame: InterpolatedFrame | null, dt: number): void {
    const mates = frame ? frame.players.filter((p) => p.alive && p.connected && p.id !== this.myId) : [];
    const info = this.deathInfo ?? "Esperando la próxima ronda";
    if (mates.length > 0 && !this.freeCam) {
      const target = mates[this.spectateIndex % mates.length]!;
      this.camera.position.set(target.x, target.y + eyeHeightOf(target), target.z);
      this.camera.rotation.set(target.pitch, target.yaw, 0);
      const av = this.avatars.get(target.id);
      if (av) av.root.visible = false;
      this.ui.setSpectating(`${info}<small>Mirando a ${this.ui.nameOf(target.id)} · click para cambiar</small>`);
      return;
    }
    if (!this.freeCam) {
      this.freeCam = true;
      this.freePos.copy(this.camera.position);
      if (this.predictor) {
        const s = this.predictor.state;
        this.freePos.set(s.x, s.y + eyeHeightOf(s), s.z);
        this.input.setView(s.yaw, s.pitch);
      }
    }
    const mv = this.input.freeMove();
    const speed = (mv.fast ? 14 : 7) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.input.yaw), 0, -Math.cos(this.input.yaw));
    const right = new THREE.Vector3(Math.cos(this.input.yaw), 0, -Math.sin(this.input.yaw));
    this.freePos.addScaledVector(fwd, mv.fwd * speed).addScaledVector(right, mv.side * speed);
    this.freePos.y = Math.max(0.3, this.freePos.y + mv.up * speed);
    this.camera.position.copy(this.freePos);
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0);
    this.ui.setSpectating(`${info}<small>Cámara libre: WASD para moverte</small>`);
  }
}

function weaponPerkName(perk: number): string {
  return ["Juggernog", "Speed Cola", "Double Tap", "Quick Revive", "Stamin-Up", "Mule Kick"][perk] ?? "";
}

export { heightOf, type UnpackedPlayer };
