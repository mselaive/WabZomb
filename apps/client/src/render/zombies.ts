import * as THREE from "three";
import { Z_ATTACK, Z_RISING, Z_TEARING, ZOMBIE_RISE_TICKS, ZOMBIE_WINDUP_TICKS, ZTYPE_RUN, ZTYPE_WALK, type UnpackedZombie } from "@wabzomb/shared";

interface Look {
  skin: number;
  shirt: number;
  pants: number;
  eyes: number;
}

/** Variantes de piel y ropa, para que no sean todos iguales (se eligen por id). */
const LOOKS: Look[] = [
  { skin: 0x7d8a6a, shirt: 0x3b3a44, pants: 0x2b2a2e, eyes: 0xffa21a },
  { skin: 0x8a8a74, shirt: 0x4a3328, pants: 0x25262a, eyes: 0xffa21a },
  { skin: 0x6e7d66, shirt: 0x2f3d4a, pants: 0x332a26, eyes: 0xff7a1a },
  { skin: 0x90907c, shirt: 0x58483a, pants: 0x2a2e33, eyes: 0xffc21a },
];

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, emissive = 0, rough = 0.9): THREE.MeshStandardMaterial {
  const key = `${color}-${emissive}-${rough}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, emissive, emissiveIntensity: emissive ? 2 : 0 });
    matCache.set(key, m);
  }
  return m;
}

function block(w: number, h: number, d: number, color: number, emissive = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, emissive));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Un zombi de cajas: encorvado, con la ropa rota, los brazos hacia adelante y
 * los ojos que brillan. Camina, trota o corre según el tipo; sale del piso al
 * aparecer; levanta el brazo antes de pegar.
 */
export class ZombieAvatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private walk = Math.random() * 6;
  private lastX = 0;
  private lastZ = 0;
  private lastHp = 1;
  readonly type: number;
  /** Para el sonido: cuándo gruñó por última vez. */
  groanAt = 0;

  constructor(id: number, type: number) {
    this.type = type;
    const look = LOOKS[id % LOOKS.length]!;
    const leg = (x: number): THREE.Group => {
      const g = new THREE.Group();
      const thigh = block(0.19, 0.7, 0.22, look.pants);
      thigh.position.y = -0.35;
      // Pantalón roto: se ve la piel abajo.
      const shin = block(0.16, 0.2, 0.18, look.skin);
      shin.position.y = -0.74;
      const foot = block(0.2, 0.1, 0.28, 0x1e1a18);
      foot.position.set(0, -0.86, -0.03);
      g.add(thigh, shin, foot);
      g.position.set(x, 0.9, 0);
      return g;
    };
    this.legL = leg(-0.12);
    this.legR = leg(0.12);
    this.root.add(this.legL, this.legR);

    const torso = block(0.46, 0.58, 0.26, look.shirt);
    torso.position.set(0, 0.29, 0);
    const rip = block(0.2, 0.22, 0.27, look.skin);
    rip.position.set(0.1, 0.2, 0);
    const belt = block(0.47, 0.05, 0.27, 0x1e1a18);
    belt.position.set(0, 0.0, 0);
    this.body.add(torso, rip, belt);

    this.head = new THREE.Group();
    const neck = block(0.12, 0.1, 0.12, look.skin);
    neck.position.y = 0.05;
    const skull = block(0.26, 0.28, 0.26, look.skin);
    skull.position.y = 0.24;
    const jaw = block(0.2, 0.08, 0.1, 0x3a1f1f);
    jaw.position.set(0, 0.12, -0.1);
    const eyeL = block(0.06, 0.05, 0.03, look.eyes, look.eyes);
    eyeL.position.set(-0.07, 0.27, -0.135);
    const eyeR = block(0.06, 0.05, 0.03, look.eyes, look.eyes);
    eyeR.position.set(0.07, 0.27, -0.135);
    const hair = block(0.27, 0.06, 0.2, 0x2a241f);
    hair.position.set(0, 0.4, 0.03);
    this.head.add(neck, skull, jaw, eyeL, eyeR, hair);
    this.head.position.y = 0.58;
    this.head.rotation.x = 0.25;
    this.body.add(this.head);

    const arm = (x: number): THREE.Group => {
      const g = new THREE.Group();
      const upper = block(0.12, 0.3, 0.12, look.shirt);
      upper.position.y = -0.15;
      const fore = block(0.1, 0.3, 0.1, look.skin);
      fore.position.y = -0.42;
      const hand = block(0.11, 0.12, 0.08, look.skin);
      hand.position.y = -0.6;
      g.add(upper, fore, hand);
      g.position.set(x, 0.52, 0);
      return g;
    };
    this.armL = arm(-0.3);
    this.armR = arm(0.3);
    this.body.add(this.armL, this.armR);

    this.body.position.y = 0.9;
    // Encorvado: más los que caminan.
    this.body.rotation.x = type === ZTYPE_WALK ? 0.35 : type === ZTYPE_RUN ? 0.5 : 0.3;
    this.root.add(this.body);
  }

  update(z: UnpackedZombie, dt: number, now: number): void {
    this.root.position.set(z.x, z.y, z.z);
    this.root.rotation.y = z.yaw;

    // Saliendo del piso: hundido y subiendo.
    if (z.state === Z_RISING) {
      const k = 1 - z.stateTicks / ZOMBIE_RISE_TICKS;
      this.root.position.y = z.y - 1.9 * (1 - k) * (1 - k);
      this.armL.rotation.x = -2.6;
      this.armR.rotation.x = -2.6;
      this.body.rotation.x = 0.1;
      return;
    }

    const moved = Math.hypot(z.x - this.lastX, z.z - this.lastZ);
    this.lastX = z.x;
    this.lastZ = z.z;
    const speed = dt > 0 ? Math.min(8, moved / dt) : 0;
    if (speed > 0.3) this.walk += moved * (this.type === ZTYPE_WALK ? 5 : 4);
    const swing = Math.sin(this.walk) * Math.min(0.9, 0.35 + speed / 6);
    const t = now / 1000;

    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    // Trotando o corriendo, el cuerpo se inclina más y los brazos van hacia adelante.
    const lean = this.type === ZTYPE_WALK ? 0.35 : 0.3 + Math.min(0.3, speed / 12);
    this.body.rotation.x = lean + Math.sin(this.walk * 2) * 0.03;
    this.body.position.y = 0.9 + Math.abs(Math.sin(this.walk)) * 0.03;

    if (z.state === Z_ATTACK) {
      // Levanta el brazo y lo baja de golpe.
      const k = 1 - z.stateTicks / ZOMBIE_WINDUP_TICKS;
      const raise = k < 0.7 ? k / 0.7 : 1 - (k - 0.7) / 0.3;
      this.armR.rotation.x = -1.2 - raise * 1.6;
      this.armR.rotation.z = -0.3 * raise;
      this.armL.rotation.x = -1.4;
    } else if (z.state === Z_TEARING) {
      // Tironeando de las tablas.
      const pull = Math.sin(t * 9);
      this.armL.rotation.x = -1.6 + pull * 0.4;
      this.armR.rotation.x = -1.6 - pull * 0.4;
    } else if (this.type === ZTYPE_WALK) {
      // Los brazos adelante, colgando.
      this.armL.rotation.x = -1.3 + Math.sin(t * 2.2) * 0.1;
      this.armR.rotation.x = -1.2 + Math.cos(t * 1.9) * 0.1;
      this.armL.rotation.z = 0.1;
      this.armR.rotation.z = -0.1;
    } else {
      // Corriendo: los brazos se balancean.
      this.armL.rotation.x = -0.8 - swing * 0.6;
      this.armR.rotation.x = -0.8 + swing * 0.6;
    }
    this.head.rotation.x = 0.25 + Math.sin(t * 1.3 + this.walk) * 0.08;
    this.head.rotation.z = Math.sin(t * 0.7) * 0.12;
    this.lastHp = z.hp;
  }

  get hp(): number {
    return this.lastHp;
  }
}

/** Un zombi caído donde cayó: se queda un rato y se hunde en el piso. */
export function buildZombieCorpse(id: number, x: number, y: number, z: number, yaw: number): THREE.Group {
  const look = LOOKS[id % LOOKS.length]!;
  const g = new THREE.Group();
  const torso = block(0.46, 0.24, 0.58, look.shirt);
  torso.position.set(0, 0.12, 0.2);
  const head = block(0.26, 0.24, 0.28, look.skin);
  head.position.set(0.04, 0.12, 0.64);
  const legL = block(0.19, 0.2, 0.72, look.pants);
  legL.position.set(-0.13, 0.1, -0.38);
  const legR = block(0.19, 0.2, 0.72, look.pants);
  legR.position.set(0.14, 0.1, -0.34);
  legR.rotation.y = 0.25;
  const armL = block(0.12, 0.12, 0.5, look.skin);
  armL.position.set(-0.36, 0.07, 0.3);
  armL.rotation.y = -0.5;
  const armR = block(0.12, 0.12, 0.45, look.skin);
  armR.position.set(0.36, 0.07, 0.1);
  armR.rotation.y = 0.4;
  g.add(torso, head, legL, legR, armL, armR);
  g.position.set(x, y, z);
  g.rotation.y = yaw + Math.PI;
  return g;
}
