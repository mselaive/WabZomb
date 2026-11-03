import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  ACT_MAX,
  EGG_BUILT,
  BTN_CROUCH,
  BTN_JUMP,
  BTN_MELEE,
  BTN_RELOAD,
  BTN_SCOPE,
  BTN_SHOOT,
  BTN_USE,
  BTN_SPRINT,
  COUNTDOWN_TICKS,
  EMPTY_ROOM_SHUTDOWN_TICKS,
  InputQueue,
  MAPS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MS_PER_TICK,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  createGameState,
  createPlayer,
  decodeClient,
  encodeServer,
  findPlayer,
  mapByIndex,
  navGridFor,
  packBox,
  packGrenade,
  packPap,
  packPlayer,
  packPowerUp,
  packRound,
  packStandings,
  packZombie,
  sanitizeChat,
  sanitizeName,
  sanitizeToken,
  startMatch,
  step,
  unpackAngle,
  type ClientMsg,
  type GameState,
  type PlayerInput,
  type PlayerMeta,
  type ServerMsg,
  type SimEvent,
} from "@wabzomb/shared";

export interface Env {
  GameRoom: DurableObjectNamespace<GameRoom>;
  ALLOWED_ORIGINS?: string;
  DO_LOCATION_HINT?: string;
}

interface ConnState {
  playerId: number;
}

/** Todo lo que el servidor sabe de un jugador sentado en la sala. */
interface Seat {
  playerId: number;
  connId: string | null;
  token: string | null;
  goneAt: number;
  meta: PlayerMeta;
  inputs: InputQueue;
  lastChatAt: number;
}

const PUMP_INTERVAL_MS = 10;
const MAX_CATCHUP_MS = 250;
const MAX_TICKS_PER_PUMP = 5;
/** Cuánto se espera después de una partida antes de arrancar la siguiente sola. */
const NEXT_MATCH_MS = 15_000;
const CHAT_INTERVAL_MS = 1200;
const YAW_LIMIT = 3142;
const PITCH_LIMIT = 1571;

/**
 * Una sala = un Durable Object. Mantiene el estado autoritativo y corre el
 * loop de simulación a 20 Hz mientras haya alguien conectado. Es cooperativo:
 * todos ven lo mismo, así que el snapshot es uno solo (con los datos propios
 * de cada uno agregados a su tupla).
 */
export class GameRoom extends Server<Env> {
  static override options = { hibernate: false };

  private state: GameState = createGameState();
  private seats = new Map<number, Seat>();
  private byToken = new Map<string, number>();
  private events: SimEvent[] = [];
  private nextPlayerId = 1;
  private hostId = -1;
  private kicked = new Set<string>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private emptyTicks = 0;
  private nextMatchAt = 0;
  private lastPumpAt = 0;
  private accumulator = 0;
  private mapIndex = 0;
  private map = mapByIndex(0);

  // ------------------------------------------------------------ conexiones

  override onConnect(conn: Connection<ConnState>, ctx: ConnectionContext): void {
    const url = new URL(ctx.request.url);

    const version = url.searchParams.get("v");
    if (version !== null && version !== String(PROTOCOL_VERSION)) {
      this.sendTo(conn, { t: "err", code: "version", message: "Hay una versión nueva del juego: recargá la página." });
      conn.close(4002, "version");
      return;
    }

    const token = sanitizeToken(url.searchParams.get("token"));
    const known = token === null ? undefined : this.byToken.get(token);
    const back = known === undefined ? undefined : this.seats.get(known);
    if (back) {
      this.reattach(conn, back);
      return;
    }

    if (this.seats.size >= MAX_PLAYERS) {
      this.sendTo(conn, { t: "err", code: "room_full", message: `La sala está llena (${MAX_PLAYERS} jugadores).` });
      conn.close(4000, "room full");
      return;
    }

    const name = sanitizeName(url.searchParams.get("name"));
    if (this.kicked.has(name.trim().toLowerCase())) {
      this.sendTo(conn, { t: "err", code: "kicked", message: "El host te sacó de esta sala." });
      conn.close(4000, "kicked");
      return;
    }

    const playerId = this.nextPlayerId++;
    const seat: Seat = {
      playerId,
      connId: conn.id,
      token,
      goneAt: 0,
      meta: { id: playerId, name, ready: false },
      inputs: new InputQueue(),
      lastChatAt: 0,
    };
    this.seats.set(playerId, seat);
    if (token !== null) this.byToken.set(token, playerId);
    conn.setState({ playerId });

    // Quien entra en plena partida mira hasta la próxima ronda, y ahí aparece.
    const p = createPlayer(playerId);
    p.alive = false;
    this.state.players.push(p);
    if (this.hostId === -1) this.hostId = playerId;

    this.sendTo(conn, this.welcome(playerId));
    if (this.state.phase === "playing") this.sendTo(conn, { t: "start", seed: this.state.seed, map: this.mapIndex });
    this.broadcastRoster();
    this.ensureLoop();
  }

  private welcome(playerId: number): ServerMsg {
    return { t: "welcome", you: playerId, room: this.name, hostId: this.hostId, roster: this.roster(), phase: this.state.phase, map: this.mapIndex };
  }

  override onMessage(conn: Connection<ConnState>, raw: WSMessage): void {
    if (typeof raw !== "string") return;
    const msg = decodeClient(raw);
    if (!msg) return;
    const playerId = conn.state?.playerId;
    if (playerId === undefined) return;
    const seat = this.seats.get(playerId);
    if (!seat) return;
    this.handle(conn, seat, msg);
  }

  override onClose(conn: Connection<ConnState>): void {
    this.dropConnection(conn);
  }

  override onError(conn: Connection<ConnState>): void {
    this.dropConnection(conn);
  }

  private dropConnection(conn: Connection<ConnState>): void {
    const playerId = conn.state?.playerId;
    if (playerId === undefined) return;
    const seat = this.seats.get(playerId);
    if (!seat || seat.connId !== conn.id) return;

    const inMatch = this.state.phase === "playing" || this.state.phase === "countdown";
    if (!inMatch || seat.token === null) {
      this.removeSeat(playerId);
      return;
    }
    seat.connId = null;
    seat.goneAt = Date.now();
    seat.meta.away = true;
    if (this.hostId === playerId) {
      const next = [...this.seats.values()].find((s) => s.connId !== null);
      if (next) this.hostId = next.playerId;
    }
    this.broadcastRoster();
  }

  private reattach(conn: Connection<ConnState>, seat: Seat): void {
    const previous = seat.connId;
    seat.connId = conn.id;
    seat.goneAt = 0;
    seat.meta.away = false;
    seat.inputs.clear();
    conn.setState({ playerId: seat.playerId });

    if (previous !== null) {
      for (const c of this.getConnections<ConnState>()) {
        if (c.id === previous) c.close(4001, "replaced");
      }
    }

    this.sendTo(conn, this.welcome(seat.playerId));
    if (this.state.phase === "playing") this.sendTo(conn, { t: "start", seed: this.state.seed, map: this.mapIndex });
    this.broadcastRoster();
    this.ensureLoop();
  }

  private expireAbsent(now: number): void {
    for (const seat of [...this.seats.values()]) {
      if (seat.goneAt > 0 && now - seat.goneAt > RECONNECT_GRACE_MS) this.removeSeat(seat.playerId);
    }
  }

  override onRequest(): Response {
    return Response.json({ room: this.name, phase: this.state.phase, players: this.seats.size, max: MAX_PLAYERS, round: this.state.round.number });
  }

  // ------------------------------------------------------------ mensajes

  private handle(conn: Connection<ConnState>, seat: Seat, msg: ClientMsg): void {
    switch (msg.t) {
      case "in": {
        if (typeof msg.seq !== "number" || !Number.isFinite(msg.seq)) return;
        const btn = typeof msg.btn === "number" ? msg.btn | 0 : 0;
        seat.inputs.push({
          seq: msg.seq,
          fwd: clampAxis(msg.f),
          side: clampAxis(msg.s),
          yaw: unpackAngle(clampInt(msg.yaw, -YAW_LIMIT, YAW_LIMIT)),
          pitch: unpackAngle(clampInt(msg.pit, -PITCH_LIMIT, PITCH_LIMIT)),
          shoot: (btn & BTN_SHOOT) !== 0,
          reload: (btn & BTN_RELOAD) !== 0,
          jump: (btn & BTN_JUMP) !== 0,
          crouch: (btn & BTN_CROUCH) !== 0,
          sprint: (btn & BTN_SPRINT) !== 0,
          scope: (btn & BTN_SCOPE) !== 0,
          use: (btn & BTN_USE) !== 0,
          melee: (btn & BTN_MELEE) !== 0,
          view: typeof msg.vt === "number" && Number.isFinite(msg.vt) && msg.vt >= 0 ? msg.vt / 10 : -1,
          act: typeof msg.act === "number" && Number.isInteger(msg.act) && msg.act >= 0 && msg.act <= ACT_MAX ? msg.act : 0,
        });
        return;
      }

      case "ready": {
        seat.meta.ready = msg.ready === true;
        this.broadcastRoster();
        return;
      }

      case "start": {
        if (seat.playerId !== this.hostId) return;
        if (this.state.phase !== "lobby") return;
        if (!this.canStart()) return;
        this.state.phase = "countdown";
        this.state.phaseTicksLeft = COUNTDOWN_TICKS;
        return;
      }

      case "kick": {
        if (seat.playerId !== this.hostId) return;
        if (this.state.phase !== "lobby") return;
        if (typeof msg.id !== "number" || msg.id === this.hostId) return;
        const target = this.seats.get(msg.id);
        if (!target) return;
        this.kicked.add(target.meta.name.trim().toLowerCase());
        for (const c of this.getConnections<ConnState>()) {
          if (c.state?.playerId !== msg.id) continue;
          this.sendTo(c, { t: "err", code: "kicked", message: "El host te sacó de la sala." });
          c.close(4000, "kicked");
        }
        this.removeSeat(msg.id);
        return;
      }

      case "map": {
        if (seat.playerId !== this.hostId || this.state.phase !== "lobby") return;
        if (!Number.isInteger(msg.map) || msg.map < 0 || msg.map >= MAPS.length) return;
        this.mapIndex = msg.map;
        this.map = mapByIndex(msg.map);
        this.state.mapIndex = msg.map;
        this.broadcastRoster();
        return;
      }

      case "ping": {
        this.sendTo(conn, { t: "pong", c: msg.c, s: Date.now() });
        return;
      }

      case "chat": {
        const now = Date.now();
        if (now - seat.lastChatAt < CHAT_INTERVAL_MS) return;
        const text = sanitizeChat(msg.text);
        if (!text) return;
        seat.lastChatAt = now;
        this.broadcast(encodeServer({ t: "chat", by: seat.playerId, text }));
        return;
      }
    }
  }

  private canStart(): boolean {
    return this.seats.size >= MIN_PLAYERS;
  }

  // ------------------------------------------------------------ loop

  private ensureLoop(): void {
    if (this.loop) return;
    this.emptyTicks = 0;
    this.lastPumpAt = Date.now();
    this.accumulator = 0;
    this.loop = setInterval(() => {
      try {
        this.pump();
      } catch (err) {
        console.error("tick error", err);
      }
    }, PUMP_INTERVAL_MS);
  }

  private stopLoop(): void {
    if (!this.loop) return;
    clearInterval(this.loop);
    this.loop = null;
  }

  private pump(): void {
    const now = Date.now();
    let delta = now - this.lastPumpAt;
    this.lastPumpAt = now;
    this.expireAbsent(now);

    if (delta > MAX_CATCHUP_MS) delta = MAX_CATCHUP_MS;
    this.accumulator += delta;
    if (this.accumulator < MS_PER_TICK) return;

    let ran = 0;
    while (this.accumulator >= MS_PER_TICK && ran < MAX_TICKS_PER_PUMP) {
      this.accumulator -= MS_PER_TICK;
      ran++;
      if (!this.tick()) return;
    }
    if (this.accumulator > MS_PER_TICK) this.accumulator = 0;

    this.broadcastSnapshot();
  }

  /** Un tick de simulación. Devuelve false si la sala se apagó. */
  private tick(): boolean {
    const s = this.state;

    if (this.seats.size === 0) {
      if (++this.emptyTicks > EMPTY_ROOM_SHUTDOWN_TICKS) {
        this.stopLoop();
        this.resetToLobby();
        return false;
      }
      return true;
    }
    this.emptyTicks = 0;

    if (s.phase === "lobby" && this.canStart() && Date.now() >= this.nextMatchAt) {
      let allReady = true;
      for (const seat of this.seats.values()) if (!seat.meta.ready) allReady = false;
      if (allReady) {
        s.phase = "countdown";
        s.phaseTicksLeft = COUNTDOWN_TICKS;
      }
    }

    const inputs = new Map<number, PlayerInput[]>();
    for (const seat of this.seats.values()) {
      if (seat.goneAt > 0) continue;
      inputs.set(seat.playerId, seat.inputs.take());
    }

    const wasPlaying = s.phase === "playing";
    step(s, inputs, this.events, this.map);
    if (wasPlaying && s.phase === "ended") this.addToTally();

    if (s.phase === "countdown" && s.phaseTicksLeft <= 0) {
      navGridFor(this.map);
      startMatch(s, (Date.now() ^ (this.seats.size << 16)) | 1, this.map, this.events);
      this.broadcast(encodeServer({ t: "start", seed: s.seed, map: this.mapIndex }));
    } else if (s.phase === "ended" && s.phaseTicksLeft <= 0) {
      this.resetToLobby();
    }

    return true;
  }

  // ------------------------------------------------------------ snapshots

  private broadcastSnapshot(): void {
    const s = this.state;
    const base = {
      t: "s" as const,
      tick: s.tick,
      now: Date.now(),
      phase: s.phase,
      left: s.phaseTicksLeft,
      rd: packRound(s),
      z: s.zombies.map(packZombie),
      ...(s.grenades.length > 0 ? { gr: s.grenades.map(packGrenade) } : {}),
      ...(s.powerUps.length > 0 ? { pu: s.powerUps.map(packPowerUp) } : {}),
      doors: s.doorsOpen,
      boards: s.boards,
      power: s.power ? 1 : 0,
      box: packBox(s),
      pap: packPap(s),
      fx: [s.instaKill, s.doublePoints, s.fireSale, s.songTicks] as [number, number, number, number],
      radios: s.radios,
      egg: s.egg,
      souls: s.eggSouls,
      q: [s.eggTicks, (s.egg & EGG_BUILT) !== 0 ? s.eggCode : -1, s.eggDial, s.breakers, s.breakerTicks, s.forgeTicks, s.forgeBy] as [number, number, number, number, number, number, number],
      st: packStandings(s),
      reached: s.reachedRound,
      ...(this.events.length > 0 ? { ev: this.events } : {}),
    };
    const others = s.players.filter((p) => p.connected);
    for (const conn of this.getConnections<ConnState>()) {
      const viewerId = conn.state?.playerId ?? -1;
      conn.send(encodeServer({ ...base, players: others.map((p) => packPlayer(p, p.id === viewerId)) }));
    }
    this.events = [];
  }

  // ------------------------------------------------------------ sala

  private addToTally(): void {
    const s = this.state;
    for (const seat of this.seats.values()) {
      const p = findPlayer(s, seat.playerId);
      if (!p) continue;
      const m = seat.meta;
      m.played = (m.played ?? 0) + 1;
      m.totalKills = (m.totalKills ?? 0) + p.kills;
      m.bestRound = Math.max(m.bestRound ?? 0, s.reachedRound);
    }
    this.broadcastRoster();
  }

  private resetToLobby(): void {
    const s = this.state;
    s.players = s.players.filter((p) => this.seats.has(p.id));
    s.phase = "lobby";
    s.phaseTicksLeft = 0;
    s.zombies = [];
    s.grenades = [];
    s.powerUps = [];
    s.tick = 0;
    s.round.number = 0;
    for (const p of s.players) {
      p.alive = false;
      p.down = false;
      p.diedAtTick = -1;
    }
    const played = s.players.some((p) => p.kills > 0 || p.downs > 0);
    for (const seat of this.seats.values()) {
      seat.meta.ready = played && seat.goneAt === 0;
      seat.inputs.clear();
    }
    this.nextMatchAt = played ? Date.now() + NEXT_MATCH_MS : 0;
    this.broadcastRoster();
  }

  private removeSeat(playerId: number): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    this.seats.delete(playerId);
    if (seat.token !== null) this.byToken.delete(seat.token);

    const player = findPlayer(this.state, playerId);
    if (player) {
      player.connected = false;
      player.alive = false;
      player.down = false;
    }
    if (this.state.phase !== "playing") this.state.players = this.state.players.filter((p) => p.id !== playerId);

    if (this.hostId === playerId) {
      const next = [...this.seats.values()][0];
      this.hostId = next ? next.playerId : -1;
    }
    this.broadcastRoster();
  }

  private roster(): PlayerMeta[] {
    return [...this.seats.values()].map((s) => ({ ...s.meta }));
  }

  private broadcastRoster(): void {
    this.broadcast(
      encodeServer({
        t: "roster",
        roster: this.roster(),
        hostId: this.hostId,
        map: this.mapIndex,
        ...(this.nextMatchAt > Date.now() ? { nextIn: this.nextMatchAt - Date.now() } : {}),
      }),
    );
  }

  private sendTo(conn: Connection<ConnState>, msg: ServerMsg): void {
    conn.send(encodeServer(msg));
  }
}

function clampAxis(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function clampInt(v: unknown, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
