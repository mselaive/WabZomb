import PartySocket from "partysocket";
import { PROTOCOL_VERSION, decodeServer, encodeClient, type ClientMsg, type ServerMsg } from "@wabzomb/shared";

export interface NetOptions {
  room: string;
  name: string;
  onMessage: (msg: ServerMsg) => void;
  onOpen?: () => void;
  /** `code` es el del cierre: 4001 = otra pestaña se quedó con el asiento. */
  onClose?: (code: number) => void;
  onError?: (err: unknown) => void;
}

/**
 * Con qué vuelve esta pestaña a su asiento si se le corta la conexión. Vive en
 * sessionStorage: sobrevive a recargar la página pero es de esta pestaña sola.
 */
function reconnectToken(room: string): string {
  const key = `wabzomb:token:${room}`;
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * `?lag=200` simula 200 ms de ida y vuelta sin salir de tu máquina, y
 * `&jitter=60` le suma hasta 60 ms al azar a cada mensaje, como una red de verdad.
 */
function msFromUrl(name: string): number {
  const raw = new URLSearchParams(location.search).get(name);
  const v = raw ? Number(raw) : 0;
  return Number.isFinite(v) && v > 0 ? Math.min(v, 2000) : 0;
}

/**
 * Demora cada mensaje medio lag más algo al azar, sin desordenarlos: un
 * WebSocket nunca entrega uno antes que el anterior, así que el que llega tarde
 * arrastra a los de atrás, y salen de a varios juntos.
 */
class LagLine {
  private queue: { at: number; fn: () => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly oneWay: number, private readonly jitter: number) {}
  get active(): boolean {
    return this.oneWay > 0 || this.jitter > 0;
  }
  run(fn: () => void): void {
    const tail = this.queue[this.queue.length - 1]?.at ?? 0;
    this.queue.push({ at: Math.max(tail, performance.now() + this.oneWay + Math.random() * this.jitter), fn });
    if (!this.timer) this.schedule();
  }
  // Un solo temporizador que los saca en fila: con uno por mensaje, el redondeo al
  // milisegundo de setTimeout a veces adelanta uno al anterior.
  private schedule(): void {
    const next = this.queue[0];
    this.timer = next ? setTimeout(() => this.drain(), Math.max(0, next.at - performance.now())) : null;
  }
  private drain(): void {
    const now = performance.now() + 0.5;
    while (this.queue.length > 0 && this.queue[0]!.at <= now) this.queue.shift()!.fn();
    this.schedule();
  }
}

function serverHost(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured && configured.trim()) return configured.trim();
  return `${location.hostname}:8788`;
}

function serverBase(): string {
  const host = serverHost().replace(/^(https?|wss?):\/\//, "");
  const local =
    host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host.startsWith("192.168.") || host.startsWith("10.");
  return `${local ? "http" : "https"}://${host}`;
}

/**
 * Por qué falló la conexión, preguntando por HTTP. El navegador no deja leer
 * el código de estado de un upgrade de WebSocket fallido: un 403 por origen
 * se ve igual que un servidor apagado.
 */
export async function diagnoseConnection(room: string): Promise<string> {
  const base = serverBase();
  try {
    const salud = await fetch(`${base}/health`, { cache: "no-store" });
    if (!salud.ok) return "El servidor respondió mal. Probá de nuevo en un rato.";
  } catch {
    return "No se pudo conectar. ¿El servidor está andando?";
  }
  try {
    const r = await fetch(`${base}/parties/game-room/${encodeURIComponent(room)}`, { cache: "no-store" });
    if (r.status === 403) {
      return `El servidor está andando pero no acepta conexiones desde ${location.origin}. Hay que agregar ese dominio a ALLOWED_ORIGINS.`;
    }
  } catch {
    return `El servidor está andando pero rechazó este dominio (${location.origin}).`;
  }
  return "El servidor está andando pero no se pudo entrar a la sala. Probá de nuevo.";
}

/** Conexión con la sala: PartySocket, ping, y latencia artificial para probar. */
export class Net {
  private socket: PartySocket;
  private readonly lag = msFromUrl("lag");
  private readonly jitter = msFromUrl("jitter");
  private readonly down = new LagLine(this.lag / 2, this.jitter);
  private readonly up = new LagLine(this.lag / 2, this.jitter);
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  /** RTT suavizado en ms. */
  rtt = 0;
  /** Offset estimado entre el reloj del servidor y el local. */
  clockOffset = 0;

  constructor(private readonly opts: NetOptions) {
    this.socket = new PartySocket({
      host: serverHost(),
      party: "game-room",
      room: opts.room,
      query: {
        name: opts.name,
        token: reconnectToken(opts.room),
        v: String(PROTOCOL_VERSION),
      },
    });

    this.socket.addEventListener("open", () => {
      this.startPing();
      opts.onOpen?.();
    });

    this.socket.addEventListener("message", (event: MessageEvent) => {
      const deliver = () => {
        if (this.closed) return;
        const msg = decodeServer(String(event.data));
        if (!msg) return;
        if (msg.t === "pong") {
          this.onPong(msg.c, msg.s);
          return;
        }
        opts.onMessage(msg);
      };
      if (this.down.active) this.down.run(deliver);
      else deliver();
    });

    this.socket.addEventListener("close", (e: CloseEvent) => opts.onClose?.(e.code));
    this.socket.addEventListener("error", (e) => opts.onError?.(e));
  }

  get simulatedLagMs(): number {
    return this.lag;
  }

  send(msg: ClientMsg): void {
    if (this.closed) return;
    const raw = encodeClient(msg);
    const push = () => {
      if (this.closed) return;
      if (this.socket.readyState === WebSocket.OPEN) this.socket.send(raw);
    };
    if (this.up.active) this.up.run(push);
    else push();
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.socket.close();
  }

  private startPing(): void {
    if (this.pingTimer) return;
    const ping = () => this.send({ t: "ping", c: Date.now() });
    ping();
    this.pingTimer = setInterval(ping, 1000);
  }

  private onPong(clientSent: number, serverNow: number): void {
    const rtt = Date.now() - clientSent;
    this.rtt = this.rtt === 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
    const offset = serverNow + rtt / 2 - Date.now();
    this.clockOffset = this.clockOffset === 0 ? offset : this.clockOffset * 0.9 + offset * 0.1;
  }
}
