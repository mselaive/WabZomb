import * as THREE from "three";
import { Z_ATTACK, Z_RISING, Z_TEARING, ZOMBIE_RISE_TICKS, ZOMBIE_WINDUP_TICKS, ZTYPE_RUN, ZTYPE_WALK, type UnpackedZombie } from "@wabzomb/shared";

/**
 * Los zombis: presos muertos hace rato. Camisa de trabajo azul con el número
 * cosido, pantalón gris, piel gastada y los ojos que brillan. Todo generado acá:
 * unas texturas pintadas en canvas y cápsulas articuladas en cadera, rodilla,
 * hombro, codo y mandíbula. Se reparten por id, para que no sean todos iguales.
 */

interface Look {
  skin: string;
  shirt: string;
  pants: string;
  eyes: number;
  blood: number;
  shaved: boolean;
}

const LOOKS: Look[] = [
  { skin: "#7f8a70", shirt: "#3f5468", pants: "#3a3d42", eyes: 0xffa21a, blood: 0.35, shaved: true },
  { skin: "#8d8a74", shirt: "#4d6072", pants: "#34373c", eyes: 0xffa21a, blood: 0.7, shaved: false },
  { skin: "#6f7c68", shirt: "#35485c", pants: "#44464a", eyes: 0xff7a1a, blood: 0.15, shaved: true },
  { skin: "#94907c", shirt: "#5a6a78", pants: "#2f3238", eyes: 0xffc21a, blood: 0.9, shaved: false },
  { skin: "#74806e", shirt: "#44566a", pants: "#3c3a38", eyes: 0xff8a1a, blood: 0.5, shaved: true },
  { skin: "#868674", shirt: "#3a4c60", pants: "#46484c", eyes: 0xffb01a, blood: 0.25, shaved: false },
];

let seed = 4242;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function canvas(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Mugre y sangre seca sobre lo que ya esté pintado. */
function stain(ctx: CanvasRenderingContext2D, w: number, h: number, blood: number): void {
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 6 + rnd() * (w / 5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(10,8,6,${0.1 + rnd() * 0.22})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 16 * blood; i++) {
    const x = rnd() * w;
    const y = rnd() * h * 0.8;
    const r = 3 + rnd() * (w / 7);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(60,8,6,${0.55 + rnd() * 0.3})`);
    g.addColorStop(0.7, "rgba(50,6,4,0.35)");
    g.addColorStop(1, "rgba(40,4,4,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // Chorreado.
    ctx.fillStyle = "rgba(55,8,6,0.5)";
    ctx.fillRect(x, y, 1 + rnd() * 2, 6 + rnd() * 30);
  }
  // Grano de la tela.
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);
}

interface LookMaterials {
  shirt: THREE.MeshStandardMaterial;
  pants: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  face: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  mouth: THREE.MeshStandardMaterial;
  boot: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
}

const lookCache = new Map<number, LookMaterials>();

function materialsOf(index: number): LookMaterials {
  const cached = lookCache.get(index);
  if (cached) return cached;
  const look = LOOKS[index]!;
  const shirt = canvas(256, 256, (ctx) => {
    ctx.fillStyle = look.shirt;
    ctx.fillRect(0, 0, 256, 256);
    // La tela: tramado fino, tapeta con botones y el número cosido en el pecho.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 256; i += 3) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(122, 0, 4, 256);
    for (let y = 30; y < 240; y += 50) {
      ctx.fillStyle = "#c8c0a8";
      ctx.beginPath();
      ctx.arc(130, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#d8d2bc";
    ctx.fillRect(150, 44, 62, 24);
    ctx.fillStyle = "#23262a";
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(100 + Math.floor(rnd() * 899)), 181, 56);
    stain(ctx, 256, 256, look.blood);
    // Desgarros: se ve la piel por debajo.
    ctx.fillStyle = look.skin;
    for (let i = 0; i < 4; i++) {
      const x = 20 + rnd() * 210;
      const y = 120 + rnd() * 120;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 8 + rnd() * 16, y + 14 + rnd() * 22);
      ctx.lineTo(x - 6 - rnd() * 12, y + 10 + rnd() * 22);
      ctx.closePath();
      ctx.fill();
    }
  });
  const pants = canvas(128, 128, (ctx) => {
    ctx.fillStyle = look.pants;
    ctx.fillRect(0, 0, 128, 128);
    stain(ctx, 128, 128, look.blood * 0.5);
  });
  const skin = canvas(128, 128, (ctx) => {
    ctx.fillStyle = look.skin;
    ctx.fillRect(0, 0, 128, 128);
    // Venas y moretones.
    ctx.strokeStyle = "rgba(50,40,70,0.35)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      let x = rnd() * 128;
      let y = rnd() * 128;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rnd() - 0.5) * 26;
        y += rnd() * 16;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    stain(ctx, 128, 128, look.blood * 0.8);
  });
  const face = canvas(256, 256, (ctx) => {
    // Se pinta el frente de la cabeza: u = 0,5 es la nariz.
    ctx.fillStyle = look.skin;
    ctx.fillRect(0, 0, 256, 256);
    stain(ctx, 256, 256, look.blood * 0.6);
    const cx = 128;
    // Órbitas hundidas.
    for (const s of [-1, 1]) {
      const g = ctx.createRadialGradient(cx + s * 24, 98, 2, cx + s * 24, 98, 24);
      g.addColorStop(0, "rgba(8,6,6,0.98)");
      g.addColorStop(0.6, "rgba(20,14,14,0.75)");
      g.addColorStop(1, "rgba(30,20,20,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx + s * 24 - 26, 72, 52, 52);
    }
    // La nariz, gastada.
    ctx.fillStyle = "rgba(25,16,16,0.85)";
    ctx.beginPath();
    ctx.moveTo(cx - 8, 140);
    ctx.lineTo(cx + 8, 140);
    ctx.lineTo(cx, 124);
    ctx.closePath();
    ctx.fill();
    // Pómulos marcados.
    ctx.strokeStyle = "rgba(20,14,12,0.45)";
    ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 44, 132);
      ctx.quadraticCurveTo(cx + s * 34, 160, cx + s * 16, 172);
      ctx.stroke();
    }
    if (!look.shaved) {
      ctx.fillStyle = "rgba(30,26,22,0.9)";
      ctx.fillRect(0, 0, 256, 52);
    }
  });
  const std = (map: THREE.Texture, roughness = 0.92): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ map, roughness, metalness: 0, envMapIntensity: 0.25 });
  const m: LookMaterials = {
    shirt: std(shirt),
    pants: std(pants),
    skin: std(skin, 0.72),
    face: std(face, 0.68),
    eye: new THREE.MeshStandardMaterial({ color: look.eyes, emissive: look.eyes, emissiveIntensity: 3.2 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x241010, roughness: 0.5 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x1d1a18, roughness: 0.85 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x1e1a16, roughness: 1 }),
  };
  lookCache.set(index, m);
  return m;
}

// Geometrías compartidas: son 24 zombis con las mismas piezas.
const geo = {
  thigh: new THREE.CapsuleGeometry(0.095, 0.3, 4, 10),
  shin: new THREE.CapsuleGeometry(0.075, 0.3, 4, 10),
  boot: new THREE.BoxGeometry(0.14, 0.09, 0.28),
  torso: new THREE.CapsuleGeometry(0.2, 0.3, 6, 14),
  hips: new THREE.CapsuleGeometry(0.17, 0.08, 4, 12),
  upperArm: new THREE.CapsuleGeometry(0.062, 0.22, 4, 8),
  foreArm: new THREE.CapsuleGeometry(0.052, 0.22, 4, 8),
  hand: new THREE.BoxGeometry(0.075, 0.1, 0.05),
  finger: new THREE.BoxGeometry(0.015, 0.06, 0.015),
  neck: new THREE.CylinderGeometry(0.055, 0.07, 0.12, 8),
  skull: new THREE.SphereGeometry(0.125, 16, 12),
  jaw: new THREE.BoxGeometry(0.15, 0.05, 0.13),
  eye: new THREE.SphereGeometry(0.016, 8, 6),
  ear: new THREE.SphereGeometry(0.025, 6, 5),
  teeth: new THREE.BoxGeometry(0.12, 0.016, 0.012),
  rag: new THREE.PlaneGeometry(0.12, 0.2),
};

function part(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

interface Limb {
  root: THREE.Group;
  joint: THREE.Group;
}

let blobMat: THREE.MeshBasicMaterial | null = null;
const blobGeo = new THREE.PlaneGeometry(1.15, 1.15);
blobGeo.rotateX(-Math.PI / 2);

/** La sombra de contacto: una mancha oscura y blanda a los pies. Es lo que lo apoya en el piso. */
function contactShadow(): THREE.Mesh {
  if (!blobMat) {
    const map = canvas(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
      g.addColorStop(0, "rgba(0,0,0,0.62)");
      g.addColorStop(0.55, "rgba(0,0,0,0.3)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    });
    blobMat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  }
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.position.y = 0.03;
  m.renderOrder = 2;
  return m;
}

export class ZombieAvatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly shadow = contactShadow();
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly legL: Limb;
  private readonly legR: Limb;
  private walk = Math.random() * 6;
  private lastX = 0;
  private lastZ = 0;
  private lastHp = 1;
  /** Cada uno rengo a su manera: cuánto arrastra una pierna. */
  private readonly limp: number;
  private readonly tilt: number;
  readonly type: number;
  /** Para el sonido: cuándo gruñó por última vez. */
  groanAt = 0;

  constructor(id: number, type: number) {
    this.type = type;
    const m = materialsOf(id % LOOKS.length);
    const look = LOOKS[id % LOOKS.length]!;
    this.limp = 0.15 + ((id * 7) % 5) * 0.12;
    this.tilt = ((id * 13) % 7) / 7 - 0.5;

    const leg = (x: number): Limb => {
      const root = new THREE.Group();
      root.position.set(x, 0.92, 0);
      root.add(part(geo.thigh, m.pants, 0, -0.22, 0));
      const joint = new THREE.Group();
      joint.position.set(0, -0.45, 0);
      joint.add(part(geo.shin, m.pants, 0, -0.2, 0));
      joint.add(part(geo.boot, m.boot, 0, -0.43, -0.05));
      root.add(joint);
      return { root, joint };
    };
    this.legL = leg(-0.11);
    this.legR = leg(0.11);
    this.root.add(this.legL.root, this.legR.root, this.shadow);

    const torso = part(geo.torso, m.shirt, 0, 0.3, 0);
    torso.scale.set(1.12, 1, 0.74);
    const hips = part(geo.hips, m.pants, 0, 0, 0);
    hips.scale.set(1.05, 1, 0.8);
    hips.rotation.z = Math.PI / 2;
    this.body.add(torso, hips);

    // La cabeza: cráneo apenas alargado, mandíbula que se abre, ojos que brillan en las órbitas.
    const neck = part(geo.neck, m.skin, 0, 0.05, 0);
    const skull = part(geo.skull, m.face, 0, 0.22, -0.01);
    skull.scale.set(0.95, 1.14, 1.02);
    // La cara de la textura mira hacia -Z.
    skull.rotation.y = -Math.PI / 2;
    const eyeL = part(geo.eye, m.eye, -0.043, 0.245, -0.118);
    const eyeR = part(geo.eye, m.eye, 0.043, 0.245, -0.118);
    this.jaw.position.set(0, 0.148, -0.04);
    const chin = part(geo.jaw, m.skin, 0, -0.015, -0.03);
    const mouth = part(geo.jaw, m.mouth, 0, 0.012, -0.03);
    mouth.scale.set(0.82, 0.5, 0.82);
    const lower = part(geo.teeth, new THREE.MeshStandardMaterial({ color: 0x8a8468, roughness: 0.6 }), 0, 0.016, -0.09);
    this.jaw.add(chin, mouth, lower);
    const upper = part(geo.teeth, lower.material as THREE.Material, 0, 0.158, -0.117);
    this.head.add(neck, skull, eyeL, eyeR, this.jaw, upper, part(geo.ear, m.skin, -0.12, 0.22, 0), part(geo.ear, m.skin, 0.12, 0.22, 0));
    if (!look.shaved) {
      const hair = part(geo.skull, m.hair, 0, 0.255, 0.018);
      hair.scale.set(0.98, 0.86, 1.03);
      this.head.add(hair);
    }
    this.head.position.y = 0.6;
    this.head.rotation.x = 0.25;
    this.body.add(this.head);

    const arm = (x: number, side: number): Limb => {
      const root = new THREE.Group();
      root.position.set(x, 0.55, 0);
      root.add(part(geo.upperArm, m.shirt, 0, -0.14, 0));
      const joint = new THREE.Group();
      joint.position.set(0, -0.3, 0);
      // La manga rota: del codo para abajo, piel.
      joint.add(part(geo.foreArm, m.skin, 0, -0.14, 0));
      const hand = part(geo.hand, m.skin, 0, -0.33, 0);
      joint.add(hand);
      for (let i = 0; i < 3; i++) {
        const f = part(geo.finger, m.skin, -0.024 + i * 0.024, -0.4, 0);
        f.rotation.x = -0.4 - i * 0.1;
        joint.add(f);
      }
      // Un jirón de la manga colgando.
      const rag = part(geo.rag, m.shirt, side * 0.03, -0.06, 0.03);
      rag.rotation.y = side * 0.6;
      (rag.material as THREE.Material).side = THREE.DoubleSide;
      joint.add(rag);
      root.add(joint);
      return { root, joint };
    };
    this.armL = arm(-0.27, -1);
    this.armR = arm(0.27, 1);
    this.body.add(this.armL.root, this.armR.root);

    this.body.position.y = 0.94;
    // Encorvado: más los que caminan.
    this.body.rotation.x = type === ZTYPE_WALK ? 0.35 : type === ZTYPE_RUN ? 0.5 : 0.3;
    this.body.rotation.z = this.tilt * 0.12;
    this.root.add(this.body);
  }

  update(z: UnpackedZombie, dt: number, now: number): void {
    this.root.position.set(z.x, z.y, z.z);
    this.root.rotation.y = z.yaw;
    const t = now / 1000;

    // Saliendo del piso: hundido, subiendo, los brazos primero.
    if (z.state === Z_RISING) {
      const k = 1 - z.stateTicks / ZOMBIE_RISE_TICKS;
      this.root.position.y = z.y - 1.9 * (1 - k) * (1 - k);
      this.shadow.position.y = z.y - this.root.position.y + 0.03;
      this.armL.root.rotation.x = -2.6;
      this.armR.root.rotation.x = -2.6;
      this.armL.joint.rotation.x = -0.3;
      this.armR.joint.rotation.x = -0.5;
      this.body.rotation.x = 0.1;
      return;
    }

    this.shadow.position.y = 0.03;
    const moved = Math.hypot(z.x - this.lastX, z.z - this.lastZ);
    this.lastX = z.x;
    this.lastZ = z.z;
    const speed = dt > 0 ? Math.min(8, moved / dt) : 0;
    if (speed > 0.3) this.walk += moved * (this.type === ZTYPE_WALK ? 5 : 4);
    const amount = Math.min(0.85, 0.3 + speed / 6);
    const swing = Math.sin(this.walk) * amount;
    const swingBack = Math.sin(this.walk + Math.PI);

    // Las piernas: la cadera va y viene; la rodilla dobla al traer la pierna. La rengueante hace menos.
    const limp = this.type === ZTYPE_WALK ? this.limp : this.limp * 0.3;
    this.legL.root.rotation.x = swing * (1 - limp);
    this.legR.root.rotation.x = -swing;
    this.legL.joint.rotation.x = Math.max(0, swingBack) * amount * 1.2 * (1 - limp) + 0.12;
    this.legR.joint.rotation.x = Math.max(0, -swingBack) * amount * 1.3 + 0.12;

    // Trotando o corriendo, el cuerpo se inclina más.
    const lean = this.type === ZTYPE_WALK ? 0.32 : 0.3 + Math.min(0.32, speed / 11);
    this.body.rotation.x = lean + Math.sin(this.walk * 2) * 0.035;
    this.body.position.y = 0.94 + Math.abs(Math.sin(this.walk)) * 0.035 - lean * 0.06;
    this.body.rotation.z = this.tilt * 0.12 + Math.sin(this.walk) * 0.04;
    this.body.rotation.y = Math.sin(this.walk) * 0.08;

    if (z.state === Z_ATTACK) {
      // Levanta el brazo y lo baja de golpe.
      const k = 1 - z.stateTicks / ZOMBIE_WINDUP_TICKS;
      const raise = k < 0.7 ? k / 0.7 : 1 - (k - 0.7) / 0.3;
      this.armR.root.rotation.x = -1.2 - raise * 1.7;
      this.armR.root.rotation.z = 0.3 * raise;
      this.armR.joint.rotation.x = -0.9 * raise - 0.2;
      this.armL.root.rotation.x = -1.3;
      this.armL.joint.rotation.x = -0.4;
      this.jaw.rotation.x = 0.55;
    } else if (z.state === Z_TEARING) {
      // Tironeando de las tablas.
      const pull = Math.sin(t * 9);
      this.armL.root.rotation.x = -1.6 + pull * 0.4;
      this.armR.root.rotation.x = -1.6 - pull * 0.4;
      this.armL.joint.rotation.x = -0.5 - pull * 0.35;
      this.armR.joint.rotation.x = -0.5 + pull * 0.35;
      this.jaw.rotation.x = 0.3 + pull * 0.15;
    } else if (this.type === ZTYPE_WALK) {
      // Los brazos adelante, colgando, cada uno a su ritmo.
      this.armL.root.rotation.x = -1.15 + Math.sin(t * 2.2 + this.tilt) * 0.12;
      this.armR.root.rotation.x = -1.0 + Math.cos(t * 1.9) * 0.14;
      this.armL.joint.rotation.x = -0.35 + Math.sin(t * 1.7) * 0.1;
      this.armR.joint.rotation.x = -0.55 + Math.cos(t * 2.3) * 0.1;
      this.armL.root.rotation.z = -0.08;
      this.armR.root.rotation.z = 0.08;
      this.jaw.rotation.x = 0.2 + Math.sin(t * 1.6 + this.tilt * 4) * 0.14;
    } else {
      // Corriendo: los brazos van y vienen, doblados.
      this.armL.root.rotation.x = -0.6 - swing * 0.75;
      this.armR.root.rotation.x = -0.6 + swing * 0.75;
      this.armL.joint.rotation.x = -1.0;
      this.armR.joint.rotation.x = -1.0;
      this.jaw.rotation.x = 0.42 + Math.sin(t * 7) * 0.1;
    }
    this.head.rotation.x = 0.2 + Math.sin(t * 1.3 + this.walk) * 0.08 - (this.type === ZTYPE_WALK ? 0 : 0.2);
    this.head.rotation.z = Math.sin(t * 0.7 + this.tilt * 5) * 0.14 + this.tilt * 0.2;
    this.lastHp = z.hp;
  }

  get hp(): number {
    return this.lastHp;
  }
}

/**
 * El alcaide: un viejo larguísimo y flaco, de sobretodo gris hasta los tobillos,
 * sombrero de ala y un farol de luz azul en la mano. Camina derecho, sin apuro.
 */
export class WardenAvatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly coat: THREE.Mesh;
  private walk = 0;
  private lastX = 0;
  private lastZ = 0;
  readonly type: number;
  groanAt = 0;
  hp = 1;

  constructor(type: number) {
    this.type = type;
    const coat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.92, map: canvas(128, 256, (ctx) => {
      ctx.fillStyle = "#6f7276";
      ctx.fillRect(0, 0, 128, 256);
      stain(ctx, 128, 256, 0.3);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(60, 0, 5, 256);
    }) });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.75 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xa8a48e, roughness: 0.7 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x7ad0ff, emissive: 0x7ad0ff, emissiveIntensity: 4 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x6ab8ff, emissive: 0x6ab8ff, emissiveIntensity: 3.2 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a30, metalness: 0.85, roughness: 0.4 });
    // El sobretodo: un cono largo y angosto, del hombro a los tobillos.
    this.coat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.42, 1.62, 14, 3), coat);
    this.coat.position.y = 0.92;
    this.coat.scale.z = 0.72;
    this.root.add(this.coat);
    // Las botas asomando.
    for (const x of [-0.13, 0.13]) {
      const boot = new THREE.Mesh(geo.boot, dark);
      boot.position.set(x, 0.05, -0.06);
      this.root.add(boot);
    }
    this.body.position.y = 1.72;
    this.root.add(this.body);
    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 4, 10), coat);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.scale.z = 0.8;
    this.body.add(shoulders);
    // El cuello alto, la cara hundida y el sombrero.
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.16, 12, 1, true), dark);
    collar.position.y = 0.14;
    (collar.material as THREE.Material).side = THREE.DoubleSide;
    this.body.add(collar);
    this.head.position.y = 0.24;
    const skull = new THREE.Mesh(geo.skull, skin);
    skull.scale.set(0.74, 1.2, 0.84);
    skull.position.y = 0.1;
    const sockets = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.04), dark);
    sockets.position.set(0, 0.13, -0.09);
    const eyeL = new THREE.Mesh(geo.eye, eye);
    eyeL.position.set(-0.038, 0.13, -0.112);
    const eyeR = new THREE.Mesh(geo.eye, eye);
    eyeR.position.set(0.038, 0.13, -0.112);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.02, 18), dark);
    brim.position.y = 0.2;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.16, 14), dark);
    crown.position.y = 0.29;
    this.head.add(skull, sockets, eyeL, eyeR, brim, crown);
    this.body.add(this.head);
    // Brazos largos: en la derecha el farol, en la izquierda el llavero.
    const arm = (g: THREE.Group, x: number) => {
      g.position.set(x, 0, 0);
      const upper = new THREE.Mesh(geo.upperArm, coat);
      upper.position.y = -0.2;
      upper.scale.y = 1.35;
      const fore = new THREE.Mesh(geo.foreArm, coat);
      fore.position.y = -0.58;
      fore.scale.y = 1.35;
      const hand = new THREE.Mesh(geo.hand, skin);
      hand.position.y = -0.82;
      g.add(upper, fore, hand);
      this.body.add(g);
    };
    arm(this.armR, 0.32);
    arm(this.armL, -0.32);
    const lantern = new THREE.Group();
    lantern.position.set(0, -1.02, 0);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.16, 10), blue);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.06, 10), brass);
    top.position.y = 0.11;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 12), brass);
    ring.position.y = 0.17;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.025, 10), brass);
    base.position.y = -0.09;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: wardenHalo(), color: 0x6ab8ff, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(1.5);
    lantern.add(glass, top, ring, base, halo);
    this.armR.add(lantern);
    for (let i = 0; i < 4; i++) {
      const key = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.08, 0.004), brass);
      key.position.set(-0.025 + i * 0.016, -0.94, 0);
      key.rotation.z = -0.4 + i * 0.28;
      this.armL.add(key);
    }
    this.root.add(contactShadow());
    this.root.scale.setScalar(1.08);
  }

  update(z: UnpackedZombie, dt: number, now: number): void {
    this.root.position.set(z.x, z.y, z.z);
    this.root.rotation.y = z.yaw;
    this.hp = z.hp;
    const t = now / 1000;
    const moved = Math.hypot(z.x - this.lastX, z.z - this.lastZ);
    this.lastX = z.x;
    this.lastZ = z.z;
    this.walk += moved * 3.2;
    const sway = Math.sin(this.walk);
    // No camina: se desliza con un balanceo, como si el sobretodo no tuviera piernas.
    this.coat.rotation.z = sway * 0.035;
    this.body.rotation.z = -sway * 0.05;
    this.body.position.y = 1.72 + Math.abs(Math.cos(this.walk)) * 0.03;
    this.head.rotation.y = Math.sin(t * 0.8) * 0.3;
    if (z.state === Z_ATTACK) {
      const k = 1 - z.stateTicks / ZOMBIE_WINDUP_TICKS;
      const raise = k < 0.65 ? k / 0.65 : 1 - (k - 0.65) / 0.35;
      this.armL.rotation.x = -0.5 - raise * 2.4;
      this.armR.rotation.x = -0.9;
    } else {
      this.armL.rotation.x = 0.05 + Math.sin(t * 1.1) * 0.05;
      // El farol siempre adelante, como buscando.
      this.armR.rotation.x = -0.95 + Math.sin(t * 1.4) * 0.06;
    }
    void dt;
  }
}

let wardenHaloTex: THREE.Texture | null = null;
function wardenHalo(): THREE.Texture {
  wardenHaloTex ??= canvas(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,0.3)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  return wardenHaloTex;
}

/** Un zombi caído donde cayó: se queda un rato y se hunde en el piso. */
export function buildZombieCorpse(id: number, x: number, y: number, z: number, yaw: number): THREE.Group {
  const m = materialsOf(id % LOOKS.length);
  const g = new THREE.Group();
  const torso = part(geo.torso, m.shirt, 0, 0.13, 0.22);
  torso.rotation.x = Math.PI / 2;
  torso.scale.set(1.1, 1, 0.65);
  const skull = part(geo.skull, m.face, 0.06, 0.12, 0.72);
  skull.rotation.set(-Math.PI / 2, 0, 0.5);
  const legL = part(geo.thigh, m.pants, -0.12, 0.09, -0.3);
  legL.rotation.x = Math.PI / 2;
  const shinL = part(geo.shin, m.pants, -0.13, 0.08, -0.72);
  shinL.rotation.x = Math.PI / 2;
  const legR = part(geo.thigh, m.pants, 0.16, 0.09, -0.26);
  legR.rotation.set(Math.PI / 2, 0, 0.3);
  const shinR = part(geo.shin, m.pants, 0.33, 0.08, -0.62);
  shinR.rotation.set(Math.PI / 2, 0, 0.5);
  const armL = part(geo.upperArm, m.shirt, -0.32, 0.07, 0.34);
  armL.rotation.set(Math.PI / 2, 0, -0.6);
  const foreL = part(geo.foreArm, m.skin, -0.5, 0.06, 0.52);
  foreL.rotation.set(Math.PI / 2, 0, -0.9);
  const armR = part(geo.upperArm, m.shirt, 0.33, 0.07, 0.14);
  armR.rotation.set(Math.PI / 2, 0, 0.5);
  const foreR = part(geo.foreArm, m.skin, 0.48, 0.06, -0.06);
  foreR.rotation.set(Math.PI / 2, 0, 0.3);
  g.add(torso, skull, legL, shinL, legR, shinR, armL, foreL, armR, foreR, contactShadow());
  g.position.set(x, y, z);
  g.rotation.y = yaw + Math.PI;
  return g;
}
