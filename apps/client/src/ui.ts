import {
  JUGG_HP,
  MAPS,
  PERK_COLORS,
  PERK_COUNT,
  PERK_NAMES,
  PERK_SHORT,
  POWERUP_NAMES,
  ZOMBIE_WEAPON,
  weapon,
  weaponStats,
  type Interaction,
  type PlayerMeta,
  type SnapStanding,
  type UnpackedPlayer,
} from "@wabzomb/shared";

export type Screen = "menu" | "lobby" | "result" | "connecting";

export interface UICallbacks {
  onSolo: (name: string) => void;
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onKick: (id: number) => void;
  onMap: (map: number) => void;
  onChat: (text: string) => void;
  onLeave: () => void;
  onVolume: (volume: number) => void;
  onSensitivity: (value: number) => void;
  onFullscreen: (on: boolean) => void;
  onResume: () => void;
  onExitFullscreen: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en index.html`);
  return el as T;
};

const NAME_KEY = "wabzomb:name";
const VOLUME_KEY = "wabzomb:volume";
const FULLSCREEN_KEY = "wabzomb:fullscreenOn";
const CROSS_KEY = "wabzomb:crosshair";
const CROSS_COLOR_KEY = "wabzomb:crosscolor";
const SENS_KEY = "wabzomb:sens";

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento: no se recuerda, nada más.
  }
}

/** Todo lo que es HTML: menú, sala, HUD, tabla, resultado. */
export class UI {
  private readonly overlay = $("overlay");
  private readonly screens: Record<Screen, HTMLElement> = {
    menu: $("screenMenu"),
    lobby: $("screenLobby"),
    result: $("screenResult"),
    connecting: $("screenConnecting"),
  };
  private readonly nameInput = $<HTMLInputElement>("nameInput");
  private readonly codeInput = $<HTMLInputElement>("codeInput");
  private readonly menuError = $("menuError");
  private readonly inviteHint = $("inviteHint");
  private readonly roomCode = $<HTMLButtonElement>("roomCode");
  private readonly playerList = $("playerList");
  private readonly btnReady = $<HTMLButtonElement>("btnReady");
  private readonly btnStart = $<HTMLButtonElement>("btnStart");
  private readonly lobbyHint = $("lobbyHint");
  private readonly nextMatch = $("nextMatch");
  private readonly chatLog = $("chatLog");
  private readonly hud = $("hud");
  private readonly scoreboard = $("scoreboard");
  private readonly banner = $("banner");
  private readonly subBanner = $("subBanner");
  private readonly teamChatLog = $("teamChatLog");
  private readonly teamChatInput = $<HTMLInputElement>("teamChatInput");
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private ready = false;
  private roster: PlayerMeta[] = [];
  private myId = -1;
  private lastRound = -1;
  private lastPoints = -1;
  private lastPerks = -1;
  private lastSlots = "";
  private lastPrompt = "";
  private lastFx = "";
  private lastMates = "";
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private deltaAcc = 0;

  constructor(private readonly cb: UICallbacks) {
    const savedName = load(NAME_KEY);
    if (savedName) this.nameInput.value = savedName;

    const volumeInputs = [$<HTMLInputElement>("volumeInput"), $<HTMLInputElement>("pauseVolumeInput")];
    const volumeValues = [$("volumeValue"), $("pauseVolumeValue")];
    const applyVolume = (v: string) => {
      for (const i of volumeInputs) i.value = v;
      for (const el of volumeValues) el.textContent = `${v}%`;
      save(VOLUME_KEY, v);
      cb.onVolume(Number(v) / 100);
    };
    for (const i of volumeInputs) i.addEventListener("input", () => applyVolume(i.value));
    applyVolume(load(VOLUME_KEY) ?? volumeInputs[0]!.value);

    const sensInputs = [$<HTMLInputElement>("sensInput"), $<HTMLInputElement>("pauseSensInput")];
    const sensValues = [$("sensValue"), $("pauseSensValue")];
    const applySens = (v: string) => {
      for (const i of sensInputs) i.value = v;
      for (const el of sensValues) el.textContent = `${(Number(v) / 10).toFixed(1)}`;
      save(SENS_KEY, v);
      cb.onSensitivity(Number(v) / 10);
    };
    for (const i of sensInputs) i.addEventListener("input", () => applySens(i.value));
    applySens(load(SENS_KEY) ?? sensInputs[0]!.value);

    const fsInputs = [$<HTMLInputElement>("fullscreenInput"), $<HTMLInputElement>("pauseFullscreen")];
    const applyFullscreen = (on: boolean) => {
      for (const i of fsInputs) i.checked = on;
      save(FULLSCREEN_KEY, on ? "1" : "0");
      cb.onFullscreen(on);
    };
    for (const i of fsInputs) i.addEventListener("change", () => applyFullscreen(i.checked));
    applyFullscreen(load(FULLSCREEN_KEY) === "1");

    this.crossStyle = load(CROSS_KEY) ?? "dynamic";
    this.crossColor = load(CROSS_COLOR_KEY) ?? "#7cff9b";
    const applyCross = () => {
      for (const b of document.querySelectorAll<HTMLButtonElement>("[data-crosshair]")) b.setAttribute("aria-checked", String(b.dataset.crosshair === this.crossStyle));
      for (const b of document.querySelectorAll<HTMLButtonElement>("[data-crosscolor]")) b.setAttribute("aria-checked", String(b.dataset.crosscolor === this.crossColor));
      const ch = $("crosshair");
      ch.classList.toggle("dot", this.crossStyle === "dot");
      ch.style.setProperty("--cross-color", this.crossColor);
      this.lastGap = -1;
      save(CROSS_KEY, this.crossStyle);
      save(CROSS_COLOR_KEY, this.crossColor);
    };
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-crosshair]")) {
      b.addEventListener("click", () => {
        this.crossStyle = b.dataset.crosshair ?? "dynamic";
        applyCross();
      });
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-crosscolor]")) {
      b.addEventListener("click", () => {
        this.crossColor = b.dataset.crosscolor ?? "#7cff9b";
        applyCross();
      });
    }
    applyCross();

    $("btnResume").addEventListener("click", () => cb.onResume());
    $("btnFullscreenOff").addEventListener("click", () => cb.onExitFullscreen());
    document.addEventListener("fullscreenchange", () => {
      if (!$("pausePanel").hidden) this.setPause(true, this.pauseRetry);
    });
    $("btnPauseLeave").addEventListener("click", () => cb.onLeave());

    $("btnSolo").addEventListener("click", () => cb.onSolo(this.name()));
    $("btnCreate").addEventListener("click", () => cb.onCreate(this.name()));
    $("btnJoin").addEventListener("click", () => cb.onJoin(this.name(), this.codeInput.value));
    this.codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") cb.onJoin(this.name(), this.codeInput.value);
    });
    this.nameInput.addEventListener("change", () => save(NAME_KEY, this.name()));

    this.btnReady.addEventListener("click", () => {
      this.ready = !this.ready;
      this.btnReady.textContent = this.ready ? "No estoy listo" : "Estoy listo";
      this.btnReady.classList.toggle("btn-primary", !this.ready);
      cb.onReady(this.ready);
    });
    this.btnStart.addEventListener("click", () => cb.onStart());
    $("btnLeave").addEventListener("click", () => cb.onLeave());

    const mapRow = $("mapRow");
    MAPS.forEach((m, i) => {
      const btn = document.createElement("button");
      btn.className = "mode-btn";
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.dataset.map = String(i);
      btn.textContent = m.name;
      btn.addEventListener("click", () => cb.onMap(i));
      mapRow.append(btn);
    });

    this.roomCode.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.set("room", this.roomCode.textContent ?? "");
      void navigator.clipboard?.writeText(url.toString()).then(() => {
        this.lobbyHint.textContent = "Link copiado. Pegáselo a tus amigos.";
      });
    });

    const chatForm = $<HTMLFormElement>("chatForm");
    const chatInput = $<HTMLInputElement>("chatInput");
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      cb.onChat(text);
      chatInput.value = "";
    });

    this.teamChatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const text = this.teamChatInput.value.trim();
        if (text) cb.onChat(text);
        this.closeTeamChat();
      } else if (e.key === "Escape") {
        this.closeTeamChat();
      }
      e.stopPropagation();
    });

    const room = new URLSearchParams(location.search).get("room");
    if (room) {
      this.codeInput.value = room.toUpperCase();
      this.inviteHint.textContent = `Te invitaron a la sala ${room.toUpperCase()}. Poné tu nombre y entrá.`;
      this.inviteHint.hidden = false;
      $("btnJoin").classList.add("btn-primary");
      $("btnSolo").classList.remove("btn-primary");
    }
  }

  private name(): string {
    const n = this.nameInput.value.trim().slice(0, 14);
    return n || "Jugador";
  }

  // ------------------------------------------------------------ pantallas

  showScreen(screen: Screen): void {
    this.overlay.hidden = false;
    for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== screen;
    if (screen !== "lobby") {
      this.ready = false;
      this.btnReady.textContent = "Estoy listo";
      this.btnReady.classList.add("btn-primary");
    }
  }

  hideScreens(): void {
    this.overlay.hidden = true;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
  }

  showError(message: string): void {
    this.menuError.textContent = message;
    this.menuError.hidden = false;
    this.showScreen("menu");
  }

  setEntryEnabled(enabled: boolean): void {
    for (const b of $("menuActions").querySelectorAll<HTMLButtonElement>("button")) b.disabled = !enabled;
  }

  setHud(visible: boolean): void {
    this.hud.hidden = !visible;
    if (!visible) {
      this.scoreboard.hidden = true;
      this.lastRound = -1;
      this.lastPoints = -1;
      this.lastPerks = -1;
      this.lastSlots = "";
      this.lastMates = "";
    }
  }

  // ------------------------------------------------------------ sala

  setRoom(code: string): void {
    this.roomCode.textContent = code;
  }

  updateLobby(roster: PlayerMeta[], hostId: number, myId: number, map = 0, nextIn?: number): void {
    this.roster = roster;
    this.myId = myId;
    const me = roster.find((p) => p.id === myId);
    if (me) {
      this.ready = me.ready;
      this.btnReady.textContent = this.ready ? "No estoy listo" : "Estoy listo";
      this.btnReady.classList.toggle("btn-primary", !this.ready);
    }
    const isHost = hostId === myId;
    this.playerList.replaceChildren();
    for (const p of roster) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = `${p.id === hostId ? "★ " : ""}${p.name}${p.id === myId ? " (vos)" : ""}`;
      li.append(name);
      if (p.played) {
        const tally = document.createElement("span");
        tally.className = "tally";
        tally.textContent = `mejor: ronda ${p.bestRound ?? 0} · ${p.totalKills ?? 0} bajas`;
        li.append(tally);
      }
      if (p.away) {
        const away = document.createElement("span");
        away.className = "away";
        away.textContent = "sin conexión";
        li.append(away);
      } else if (p.ready) {
        const ready = document.createElement("span");
        ready.className = "ready";
        ready.textContent = "listo";
        li.append(ready);
      }
      if (isHost && p.id !== myId) {
        const kick = document.createElement("button");
        kick.className = "kick";
        kick.title = "Echar de la sala";
        kick.textContent = "✕";
        kick.addEventListener("click", () => this.cb.onKick(p.id));
        li.append(kick);
      }
      this.playerList.append(li);
    }
    for (const btn of $("mapRow").querySelectorAll<HTMLButtonElement>("[data-map]")) {
      btn.setAttribute("aria-checked", String(Number(btn.dataset.map) === map));
      btn.disabled = !isHost;
    }
    this.btnStart.hidden = !isHost;
    this.lobbyHint.textContent = isHost ? "Arranca cuando todos estén listos, o apretá Empezar ya." : "Arranca cuando todos estén listos.";
    if (nextIn !== undefined && nextIn > 0) {
      this.nextMatch.hidden = false;
      this.nextMatch.textContent = `Siguiente partida en ${Math.ceil(nextIn / 1000)} s`;
    } else {
      this.nextMatch.hidden = true;
    }
  }

  addChat(name: string, text: string, inMatch: boolean): void {
    const li = document.createElement("li");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = name;
    li.append(who, document.createTextNode(text));
    const log = inMatch ? this.teamChatLog : this.chatLog;
    log.append(li);
    while (log.children.length > 6) log.firstElementChild?.remove();
    if (inMatch) setTimeout(() => li.remove(), 9000);
  }

  nameOf(id: number): string {
    return this.roster.find((p) => p.id === id)?.name ?? "alguien";
  }

  indexOf(id: number): number {
    const i = this.roster.findIndex((p) => p.id === id);
    return i < 0 ? 0 : i;
  }

  // ------------------------------------------------------------ HUD

  setVitals(hp: number, maxHp: number, down: boolean): void {
    const fill = $("hpFill");
    fill.style.width = `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
    $("hpText").textContent = `${Math.max(0, Math.ceil(hp))}`;
    document.querySelector(".hp-bar")?.classList.toggle("jugg", maxHp >= JUGG_HP);
    $("lowHp").hidden = down || !(hp > 0 && hp <= maxHp * 0.3);
    $("downOverlay").hidden = !down;
  }

  setPoints(points: number): void {
    if (points === this.lastPoints) return;
    if (this.lastPoints >= 0 && points > this.lastPoints) {
      // Lo que sumó, flotando al lado.
      this.deltaAcc += points - this.lastPoints;
      const d = $("pointsDelta");
      d.textContent = `+${this.deltaAcc}`;
      d.classList.remove("show");
      void d.offsetWidth;
      d.classList.add("show");
      if (this.deltaTimer) clearTimeout(this.deltaTimer);
      this.deltaTimer = setTimeout(() => (this.deltaAcc = 0), 900);
    }
    this.lastPoints = points;
    $("points").textContent = String(points);
  }

  setPerks(perks: number): void {
    if (perks === this.lastPerks) return;
    this.lastPerks = perks;
    const el = $("perks");
    el.replaceChildren();
    for (let k = 0; k < PERK_COUNT; k++) {
      if ((perks & (1 << k)) === 0) continue;
      const s = document.createElement("span");
      s.className = "perk";
      s.title = PERK_NAMES[k] ?? "";
      s.textContent = PERK_SHORT[k] ?? "";
      s.style.setProperty("--c", `#${(PERK_COLORS[k] ?? 0xffffff).toString(16).padStart(6, "0")}`);
      el.append(s);
    }
  }

  setAmmo(weaponId: number, pap: boolean, mag: number, reserve: number, slots: readonly number[], paps: readonly number[], active: number, grenades: number, slotLimit: number): void {
    const nameEl = $("weaponName");
    if (weaponId < 0) {
      nameEl.textContent = "Manos vacías";
      nameEl.classList.remove("pap");
      $("ammoMag").textContent = "—";
      $("ammoReserve").textContent = "";
    } else {
      const s = weaponStats(weaponId, pap);
      nameEl.textContent = s.name;
      nameEl.classList.toggle("pap", pap);
      const magEl = $("ammoMag");
      magEl.textContent = String(mag);
      magEl.classList.toggle("low", mag <= Math.ceil(s.mag * 0.25));
      $("ammoReserve").textContent = String(reserve);
    }
    const key = `${slots.join(",")}|${paps.join(",")}|${active}|${grenades}|${slotLimit}`;
    if (key !== this.lastSlots) {
      this.lastSlots = key;
      const slotsEl = $("slots");
      slotsEl.replaceChildren();
      for (let i = 0; i < slotLimit; i++) {
        const id = slots[i] ?? -1;
        const s = document.createElement("span");
        s.className = `slot${i === active ? " active" : ""}${id < 0 ? " empty" : ""}`;
        s.textContent = `${i + 1} ${id >= 0 ? weaponStats(id, (paps[i] ?? 0) === 1).name : "—"}`;
        slotsEl.append(s);
      }
      $("nades").textContent = `G ✸ ${grenades}`;
    }
  }

  /** La ronda, con el número que se agranda al cambiar. */
  setRound(number: number, phase: "intermission" | "live" | "over", total: number, killed: number, alive: number): void {
    const el = $("roundNumber");
    if (number !== this.lastRound) {
      this.lastRound = number;
      el.textContent = String(number);
      el.classList.remove("changing");
      void el.offsetWidth;
      el.classList.add("changing");
    }
    const left = phase === "live" ? Math.max(0, total - killed) : 0;
    $("zombiesLeft").textContent = phase === "live" ? `${left} zombis (${alive} a la vista)` : phase === "over" ? "ronda terminada" : "se vienen...";
  }

  /** Los efectos activos: Insta-Kill, Double Points, Fire Sale (ticks que quedan). */
  setEffects(insta: number, double: number, fire: number): void {
    const key = `${insta > 0 ? 1 : 0}${double > 0 ? 1 : 0}${fire > 0 ? 1 : 0}${insta < 100 && insta > 0 ? "a" : ""}${double < 100 && double > 0 ? "b" : ""}${fire < 100 && fire > 0 ? "c" : ""}`;
    if (key === this.lastFx) return;
    this.lastFx = key;
    const el = $("fxBar");
    el.replaceChildren();
    const add = (kind: number, ticks: number) => {
      if (ticks <= 0) return;
      const s = document.createElement("span");
      s.className = `fx${ticks < 100 ? " ending" : ""}`;
      s.textContent = POWERUP_NAMES[kind] ?? "";
      el.append(s);
    };
    add(1, insta);
    add(2, double);
    add(5, fire);
  }

  /** Los compañeros: nombre, vida, caído / revive. */
  setMates(mates: readonly UnpackedPlayer[]): void {
    const key = mates.map((m) => `${m.id}:${Math.round(m.hp / 10)}:${m.down ? 1 : 0}:${m.alive ? 1 : 0}:${Math.round(m.revive * 10)}:${Math.round(m.bleed / 20)}`).join("|");
    if (key === this.lastMates) return;
    this.lastMates = key;
    const el = $("mates");
    el.replaceChildren();
    for (const m of mates) {
      const row = document.createElement("div");
      row.className = `mate${m.down ? " down" : ""}`;
      const name = document.createElement("span");
      name.textContent = this.nameOf(m.id);
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("div");
      fill.style.width = `${m.down ? Math.round((m.bleed / 900) * 100) : Math.round((m.hp / m.maxHp) * 100)}%`;
      bar.append(fill);
      const st = document.createElement("span");
      st.className = "st";
      st.textContent = !m.alive ? "muerto" : m.down ? (m.revive > 0 ? `reviviendo ${Math.round(m.revive * 100)}%` : `caído · ${Math.ceil(m.bleed / 20)} s`) : `${m.points} pts`;
      row.append(name, bar, st);
      el.append(row);
    }
  }

  /** El cartel de E: qué haría y cuánto cuesta. */
  setPrompt(it: Interaction | null, holding: number): void {
    const el = $("usePrompt");
    const key = it ? `${it.kind}|${it.id}|${it.label}|${it.price}|${it.ok}|${it.why ?? ""}` : "";
    if (key !== this.lastPrompt) {
      this.lastPrompt = key;
      el.hidden = !it;
      if (it) {
        el.className = `use-prompt${it.ok ? "" : " cant"}`;
        const verb = it.hold ? "Sostené" : "Apretá";
        const price = it.price > 0 ? `<span class="price">${it.price}</span>` : "";
        const why = it.why ? `<small>${escapeHtml(it.why)}</small>` : "";
        el.innerHTML = `${verb} <b>E</b>: ${escapeHtml(it.label)}${price}${why}`;
      }
    }
    const bar = $("useBar");
    if (it && it.hold && it.ok && holding > 0) {
      bar.hidden = false;
      $("useFill").style.width = `${Math.round(Math.min(1, holding) * 100)}%`;
      $("useText").textContent = it.label;
    } else {
      bar.hidden = true;
    }
  }

  private lastGap = -1;
  private crossStyle = "dynamic";
  private crossColor = "#7cff9b";

  setCrosshair(visible: boolean, spread: number): void {
    const ch = $("crosshair");
    ch.hidden = !visible;
    const gap = this.crossStyle === "dynamic" ? Math.round(Math.min(60, 3 + spread * 700)) : 4;
    if (gap !== this.lastGap) {
      this.lastGap = gap;
      ch.style.setProperty("--gap", `${gap}px`);
    }
  }

  setScope(on: boolean): void {
    $("scope").hidden = !on;
  }

  private pauseRetry = false;

  get volume(): number {
    return Number($<HTMLInputElement>("volumeInput").value) / 100;
  }

  get sensitivity(): number {
    return Number($<HTMLInputElement>("sensInput").value) / 10;
  }

  get fullscreen(): boolean {
    return $<HTMLInputElement>("fullscreenInput").checked;
  }

  setPause(visible: boolean, retry = false): void {
    this.pauseRetry = retry;
    $("pausePanel").hidden = !visible;
    const fs = document.fullscreenElement !== null;
    $("btnFullscreenOff").hidden = !fs;
    $("pauseHint").textContent = retry
      ? "No se pudo capturar el mouse (pasa si se acaba de soltar o al cambiar de pantalla): hacé click de nuevo."
      : fs
        ? "Esc otra vez sale de pantalla completa. Para seguir, click en Seguir jugando."
        : "Esc suelta el mouse; hacé click en Seguir para volver. Con pantalla completa, Esc abre esta pausa sin soltarlo.";
  }

  setSpectating(html: string | null): void {
    const el = $("spectating");
    el.hidden = html === null;
    if (html !== null) el.innerHTML = html;
  }

  hitmarker(head: boolean): void {
    const el = $("hitmarker");
    el.classList.remove("show");
    el.classList.toggle("head", head);
    void el.offsetWidth;
    el.classList.add("show");
  }

  private damageTimer: ReturnType<typeof setTimeout> | null = null;

  damageFlash(angle: number): void {
    const el = $("damageVignette");
    el.style.opacity = "1";
    setTimeout(() => (el.style.opacity = "0"), 150);
    const dir = $("damageDir");
    dir.hidden = true;
    dir.style.setProperty("--angle", `${(-angle * 180) / Math.PI}deg`);
    void dir.offsetWidth;
    dir.hidden = false;
    if (this.damageTimer) clearTimeout(this.damageTimer);
    this.damageTimer = setTimeout(() => (dir.hidden = true), 650);
  }

  showBanner(text: string, cls: "" | "blood" | "gold", ms: number, sub?: string): void {
    this.banner.textContent = text;
    this.banner.className = `banner ${cls}`;
    this.banner.hidden = false;
    this.subBanner.hidden = !sub;
    if (sub) this.subBanner.textContent = sub;
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.banner.hidden = true;
      this.subBanner.hidden = true;
    }, ms);
  }

  // ------------------------------------------------------------ tabla y resultado

  setScoreboard(visible: boolean): void {
    this.scoreboard.hidden = !visible;
  }

  get scoreboardHidden(): boolean {
    return this.scoreboard.hidden;
  }

  updateScoreboard(standings: SnapStanding[], myId: number, round: number): void {
    $("scoreboardTitle").textContent = `Ronda ${round}`;
    const tbody = $("sbBody");
    tbody.replaceChildren();
    const head = document.createElement("tr");
    head.innerHTML = `<td style="color:var(--muted);font-size:12px">nombre</td><td class="num" style="font-size:12px">bajas</td><td class="num" style="font-size:12px">cabezas</td><td class="num" style="font-size:12px">caídas</td><td class="num" style="font-size:12px">revividas</td><td class="num" style="font-size:12px">puntos</td>`;
    tbody.append(head);
    for (const s of [...standings].sort((a, b) => b[1] - a[1])) {
      const tr = document.createElement("tr");
      tr.className = `${s[6] ? "" : "dead"}${s[0] === myId ? " me" : ""}`;
      const cells = [this.nameOf(s[0]), String(s[1]), String(s[2]), String(s[3]), String(s[4]), String(s[5])];
      cells.forEach((c, i) => {
        const td = document.createElement("td");
        td.textContent = c;
        if (i > 0) td.className = "num";
        tr.append(td);
      });
      tbody.append(tr);
    }
  }

  showResult(round: number, standings: SnapStanding[], myId: number): void {
    $("resultTitle").textContent = `Llegaron a la ronda ${round}`;
    const mine = standings.find((s) => s[0] === myId);
    $("resultSubtitle").textContent = mine ? `${mine[1]} bajas · ${mine[2]} en la cabeza · ${mine[3]} veces caído · ${mine[4]} revividas` : "";
    const table = document.createElement("table");
    const head = document.createElement("tr");
    head.innerHTML = "<th>Jugador</th><th class='num'>Bajas</th><th class='num'>Cabezas</th><th class='num'>Caídas</th><th class='num'>Revividas</th>";
    table.append(head);
    for (const s of [...standings].sort((a, b) => b[1] - a[1])) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(this.nameOf(s[0]))}</td><td class="num">${s[1]}</td><td class="num">${s[2]}</td><td class="num">${s[3]}</td><td class="num">${s[4]}</td>`;
      table.append(tr);
    }
    $("resultTable").replaceChildren(table);
    this.showScreen("result");
  }

  // ------------------------------------------------------------ chat en partida

  openTeamChat(): void {
    this.teamChatInput.hidden = false;
    this.teamChatInput.focus();
  }

  closeTeamChat(): void {
    this.teamChatInput.value = "";
    this.teamChatInput.hidden = true;
    this.teamChatInput.blur();
  }

  get isTeamChatOpen(): boolean {
    return !this.teamChatInput.hidden;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export { ZOMBIE_WEAPON, weapon };
