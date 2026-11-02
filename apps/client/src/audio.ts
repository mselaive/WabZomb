import { KNIFE, RAYGUN, THUNDERGUN, weapon } from "@wabzomb/shared";

/**
 * Sonido generado por código (sin archivos): tiros por clase de arma, zombis
 * que gruñen y arrancan tablas, las máquinas, los power-ups y la ronda.
 * Posicional a lo pobre: paneo según de qué lado está y volumen por distancia.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private songNodes: AudioNode[] = [];
  private songTimer: ReturnType<typeof setInterval> | null = null;
  volume = 0.8;
  listenerYaw = 0;
  listenerX = 0;
  listenerZ = 0;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  private spatial(x: number | null, z: number | null, refDist: number): { gain: number; pan: number } {
    if (x === null || z === null) return { gain: 1, pan: 0 };
    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    const dist = Math.hypot(dx, dz);
    const gain = Math.min(1, refDist / Math.max(refDist, dist));
    const rx = Math.cos(this.listenerYaw);
    const rz = -Math.sin(this.listenerYaw);
    const pan = dist > 0.01 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist)) * 0.8 : 0;
    return { gain, pan };
  }

  private out(gain: number, pan: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(this.master!);
    return g;
  }

  private noise(duration: number, filterHz: number, gain: number, pan: number, type: BiquadFilterType = "lowpass", q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterHz;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(f);
    f.connect(env);
    env.connect(this.out(1, pan));
    src.start();
    src.stop(ctx.currentTime + duration + 0.02);
  }

  private tone(freq: number, duration: number, gain: number, pan: number, type: OscillatorType = "sine", slideTo?: number, delay = 0): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    o.connect(env);
    env.connect(this.out(1, pan));
    o.start(t0);
    o.stop(t0 + duration + 0.02);
  }

  /** Un disparo de `weaponId` en (x, z); null = el propio, en la oreja. */
  shot(weaponId: number, x: number | null, z: number | null, pap = false): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 6);
    const own = x === null;
    const g = (own ? 0.55 : 0.8) * gain;
    if (weaponId === THUNDERGUN) {
      // Un trueno: grave, con un soplido largo.
      this.noise(0.6, 300, g * 1.3, pan);
      this.tone(50, 0.7, g * 0.8, pan, "sawtooth", 25);
      this.noise(0.9, 1800, g * 0.5, pan, "bandpass", 0.6);
      return;
    }
    if (weaponId === RAYGUN) {
      this.tone(pap ? 420 : 520, 0.22, g * 0.5, pan, "sawtooth", pap ? 90 : 140);
      this.tone(1400, 0.1, g * 0.2, pan, "square", 300);
      return;
    }
    const cls = weapon(weaponId).cls;
    switch (cls) {
      case "pistol":
        this.noise(0.1, 2400, g * 0.75, pan);
        this.tone(200, 0.06, g * 0.35, pan, "square", 70);
        break;
      case "smg":
        this.noise(0.07, 2200, g * 0.6, pan);
        this.tone(300, 0.04, g * 0.2, pan, "square", 120);
        break;
      case "ar":
        this.noise(0.11, 1600, g * 0.9, pan);
        this.tone(170, 0.08, g * 0.5, pan, "sawtooth", 60);
        break;
      case "lmg":
        this.noise(0.12, 1300, g * 1.0, pan);
        this.tone(150, 0.09, g * 0.55, pan, "sawtooth", 50);
        break;
      case "shotgun":
        this.noise(0.22, 900, g * 1.1, pan);
        this.tone(100, 0.15, g * 0.6, pan, "sawtooth", 40);
        break;
      case "sniper":
        this.noise(0.3, 700, g * 1.2, pan);
        this.tone(90, 0.25, g * 0.7, pan, "sawtooth", 30);
        break;
      default:
        this.noise(0.1, 1500, g, pan);
    }
    if (pap) this.tone(900, 0.08, g * 0.12, pan, "triangle", 500);
  }

  reload(x: number | null, z: number | null): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 4);
    this.noise(0.03, 3000, 0.25 * gain, pan, "highpass");
    setTimeout(() => this.ctx && this.noise(0.04, 2200, 0.3 * gain, pan, "bandpass", 3), 180);
    setTimeout(() => this.ctx && this.noise(0.03, 3500, 0.25 * gain, pan, "highpass"), 700);
  }

  ownStep(left: boolean): void {
    if (!this.ctx) return;
    this.noise(0.05, left ? 420 : 520, 0.16, left ? -0.15 : 0.15);
  }

  land(hard: boolean): void {
    if (!this.ctx) return;
    this.noise(hard ? 0.12 : 0.07, 300, hard ? 0.45 : 0.25, 0);
  }

  draw(): void {
    if (!this.ctx) return;
    this.noise(0.03, 2800, 0.18, 0.2, "highpass");
  }

  dryFire(): void {
    if (!this.ctx) return;
    this.tone(1400, 0.03, 0.12, 0.2, "square");
  }

  hitmarker(head: boolean): void {
    if (!this.ctx) return;
    if (head) this.tone(1800, 0.12, 0.25, 0, "triangle", 1400);
    else this.tone(900, 0.05, 0.2, 0, "square");
  }

  /** El cuchillo: un silbido corto y, si pegó, un golpe húmedo. */
  knife(hit: boolean): void {
    if (!this.ctx) return;
    this.noise(0.08, 2500, 0.25, 0, "bandpass", 2);
    if (hit) this.noise(0.12, 500, 0.5, 0);
  }

  throwNade(x: number | null, z: number | null): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 5);
    this.noise(0.04, 2400, 0.2 * gain, pan, "highpass");
  }

  explosion(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 14);
    this.noise(0.5, 500, 1.2 * gain, pan);
    this.tone(60, 0.5, 0.9 * gain, pan, "sine", 25);
  }

  /** Te pegó un zombi. */
  hurt(): void {
    if (!this.ctx) return;
    this.noise(0.12, 600, 0.5, 0);
    this.tone(120, 0.15, 0.3, 0, "sine", 60);
  }

  impact(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 5);
    this.noise(0.05, 1500, 0.3 * gain, pan, "bandpass", 2);
  }

  /** Sangre: un zombi que recibe un tiro. */
  flesh(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 8);
    this.noise(0.08, 700, 0.35 * gain, pan);
  }

  // ------------------------------------------------------------ zombis

  /** Un gruñido: ruido grave modulado, distinto cada vez. */
  groan(x: number, z: number, intensity = 1): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 7);
    if (gain < 0.08) return;
    const ctx = this.ctx;
    const base = 70 + Math.random() * 60;
    const dur = 0.5 + Math.random() * 0.6;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(base, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.6), ctx.currentTime + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 18 + Math.random() * 14;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = base * 0.35;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 500 + Math.random() * 400;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.35 * gain * intensity, ctx.currentTime + 0.12);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(f);
    f.connect(env);
    env.connect(this.out(1, pan));
    o.start();
    lfo.start();
    o.stop(ctx.currentTime + dur + 0.02);
    lfo.stop(ctx.currentTime + dur + 0.02);
  }

  /** El grito corto al pegar. */
  zombieAttack(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 6);
    this.tone(220, 0.25, 0.4 * gain, pan, "sawtooth", 110);
    this.noise(0.2, 900, 0.3 * gain, pan);
  }

  /** Una tabla que se arranca (o se pone). */
  board(x: number, z: number, tear: boolean): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 7);
    if (tear) {
      this.noise(0.12, 1200, 0.45 * gain, pan, "bandpass", 1.5);
      this.tone(180, 0.1, 0.2 * gain, pan, "square", 90);
    } else {
      this.noise(0.05, 1800, 0.3 * gain, pan, "bandpass", 2);
      this.tone(600, 0.04, 0.12 * gain, pan, "square");
    }
  }

  /** Un zombi que pasa la ventana. */
  vault(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 7);
    this.noise(0.25, 600, 0.35 * gain, pan);
  }

  /** Sale del piso: tierra que se mueve. */
  rise(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 7);
    this.noise(0.5, 350, 0.3 * gain, pan);
  }

  /** Un zombi muerto: un quejido que baja. */
  zombieDie(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 7);
    this.tone(180, 0.35, 0.3 * gain, pan, "sawtooth", 50);
    this.noise(0.15, 500, 0.3 * gain, pan);
  }

  // ------------------------------------------------------------ máquinas y avisos

  /** Compra: el "ca-ching". */
  buy(): void {
    if (!this.ctx) return;
    this.tone(1200, 0.08, 0.2, 0, "triangle");
    this.tone(1600, 0.1, 0.2, 0, "triangle", undefined, 0.08);
  }

  /** La bebida: la lata que cae y el sorbo (una melodía corta). */
  perk(): void {
    if (!this.ctx) return;
    this.noise(0.1, 2000, 0.3, 0, "bandpass", 3);
    [523, 659, 784, 659, 1047].forEach((f, i) => this.tone(f, 0.16, 0.18, 0, "triangle", undefined, 0.15 + i * 0.12));
  }

  /** La caja que abre: la musiquita mientras gira. */
  boxOpen(): void {
    if (!this.ctx) return;
    this.noise(0.15, 800, 0.4, 0);
    const notes = [392, 440, 494, 523, 587, 659, 698, 784];
    for (let i = 0; i < 16; i++) this.tone(notes[i % notes.length]!, 0.14, 0.12, 0, "triangle", undefined, 0.2 + i * 0.2);
  }

  boxTeddy(): void {
    if (!this.ctx) return;
    [784, 659, 523, 392].forEach((f, i) => this.tone(f, 0.3, 0.2, 0, "sine", undefined, i * 0.25));
  }

  /** El Pack-a-Punch trabajando: un zumbido con golpes. */
  pap(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 8; i++) this.noise(0.08, 400 + i * 150, 0.35, 0, "bandpass", 2);
    this.tone(110, 2.5, 0.15, 0, "sawtooth", 180);
    this.tone(1200, 0.3, 0.15, 0, "square", undefined, 2.8);
  }

  door(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 10);
    this.noise(0.6, 700, 0.6 * gain, pan);
    this.tone(90, 0.5, 0.3 * gain, pan, "sawtooth", 50);
  }

  power(): void {
    if (!this.ctx) return;
    this.noise(0.4, 1200, 0.5, 0, "bandpass", 1.5);
    this.tone(60, 1.6, 0.25, 0, "sawtooth", 110);
    [440, 554, 659].forEach((f, i) => this.tone(f, 0.4, 0.18, 0, "triangle", undefined, 0.8 + i * 0.2));
  }

  /** Un power-up agarrado: acorde corto hacia arriba. */
  powerUp(): void {
    if (!this.ctx) return;
    [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.25, 0.2, 0, "triangle", undefined, i * 0.07));
  }

  /** Un alma que entra al horno: un golpe grave con un soplo; más agudo a medida que se llena. */
  soul(n: number): void {
    if (!this.ctx) return;
    this.tone(70 + n * 6, 0.5, 0.35, 0, "sine", 40);
    this.noise(0.4, 500 + n * 40, 0.3, 0, "bandpass", 1.2);
  }

  /** Una radio que se prende: estática y un silbido de sintonía. */
  radio(): void {
    if (!this.ctx) return;
    this.noise(0.5, 2500, 0.25, 0, "bandpass", 0.8);
    this.tone(1800, 0.5, 0.12, 0, "sine", 600, 0.2);
    this.tone(440, 0.3, 0.1, 0, "triangle", undefined, 0.7);
  }

  /** Puntos: un clic suave. */
  points(): void {
    if (!this.ctx) return;
    this.tone(1500, 0.03, 0.08, 0.1, "square");
  }

  down(): void {
    if (!this.ctx) return;
    this.tone(220, 0.6, 0.35, 0, "sawtooth", 60);
    this.noise(0.4, 400, 0.4, 0);
  }

  revive(): void {
    if (!this.ctx) return;
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 0.2, 0, "triangle", undefined, i * 0.1));
  }

  /** Empieza la ronda: dos notas graves y un acorde. */
  roundStart(): void {
    if (!this.ctx) return;
    this.tone(110, 0.7, 0.3, 0, "sawtooth", 100);
    this.tone(165, 0.7, 0.25, 0, "sawtooth", 150, 0.5);
    [220, 277, 330].forEach((f) => this.tone(f, 1.2, 0.12, 0, "triangle", undefined, 1.0));
  }

  /** Terminó la ronda: tres notas que suben. */
  roundEnd(): void {
    if (!this.ctx) return;
    [330, 415, 494].forEach((f, i) => this.tone(f, 0.45, 0.2, 0, "triangle", undefined, i * 0.22));
  }

  gameOver(): void {
    if (!this.ctx) return;
    [392, 349, 311, 262, 196].forEach((f, i) => this.tone(f, 0.7, 0.25, 0, "sawtooth", undefined, i * 0.3));
  }

  /** La canción del easter egg: un loop de sintetizador de un minuto, hecho de notas. */
  startSong(): void {
    if (!this.ctx || this.songTimer) return;
    const bass = [110, 110, 131, 98, 110, 110, 147, 131];
    const lead = [440, 523, 587, 523, 440, 392, 440, 0, 523, 587, 659, 587, 523, 440, 392, 0];
    let step = 0;
    const tickMs = 170;
    this.songTimer = setInterval(() => {
      if (!this.ctx) return;
      const b = bass[Math.floor(step / 2) % bass.length]!;
      if (step % 2 === 0) this.tone(b, 0.3, 0.18, 0, "sawtooth");
      const l = lead[step % lead.length]!;
      if (l > 0) this.tone(l, 0.22, 0.12, 0, "square");
      if (step % 4 === 0) this.noise(0.08, 300, 0.3, 0);
      if (step % 4 === 2) this.noise(0.04, 4000, 0.15, 0, "highpass");
      step++;
    }, tickMs);
  }

  stopSong(): void {
    if (this.songTimer) clearInterval(this.songTimer);
    this.songTimer = null;
    for (const n of this.songNodes) n.disconnect();
    this.songNodes = [];
  }

  get songPlaying(): boolean {
    return this.songTimer !== null;
  }
}

export { KNIFE };
