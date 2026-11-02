import * as THREE from "three";
import { CROUCH_TICKS, type UnpackedPlayer } from "@wabzomb/shared";
import { makeLabelTexture } from "./textures.js";
import { buildWeaponMesh, muzzleOffset } from "./viewmodel.js";

interface Look {
  shirt: number;
  pants: number;
  vest: number;
  boots: number;
  head: number;
  hat: number;
}

/** Cuatro sobrevivientes con ropa distinta, por orden de llegada. */
const LOOKS: Look[] = [
  { shirt: 0x5b6e4a, pants: 0x3b3a35, vest: 0x6a5a3a, boots: 0x2e2520, head: 0xdfb08a, hat: 0x3b3a35 },
  { shirt: 0x7a3a3a, pants: 0x2b2f3a, vest: 0x2e2e2e, boots: 0x1c222a, head: 0xc9966e, hat: 0x7a3a3a },
  { shirt: 0x3a5a7a, pants: 0x3a3a3a, vest: 0x5a4a3a, boots: 0x1c222a, head: 0xe3b593, hat: 0x2a3a4a },
  { shirt: 0x8a7a4a, pants: 0x4a3a2a, vest: 0x3a3a2a, boots: 0x2e2520, head: 0xa87a5a, hat: 0x6a5a2a },
];
const SKIN_HANDS = 0xd9a877;

const matCache = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number): THREE.MeshStandardMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    matCache.set(color, m);
  }
  return m;
}

function block(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Un compañero: muñeco de cajas con su arma, y el nombre arriba. Caído, queda sentado contra el piso. */
export class PlayerAvatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly arms = new THREE.Group();
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private weaponGroup: THREE.Group | null = null;
  private weaponId = -99;
  private weaponPap = false;
  private readonly label: THREE.Sprite;
  private walk = 0;
  private breath = Math.random() * 6;
  private lastX = 0;
  private lastZ = 0;
  readonly muzzle = new THREE.Vector3();

  constructor(name: string, index: number) {
    const look = LOOKS[index % LOOKS.length]!;
    const leg = (x: number): THREE.Group => {
      const g = new THREE.Group();
      const thigh = block(0.2, 0.72, 0.24, look.pants);
      thigh.position.y = -0.36;
      const boot = block(0.22, 0.12, 0.3, look.boots);
      boot.position.set(0, -0.76, -0.02);
      g.add(thigh, boot);
      g.position.set(x, 0.82, 0);
      return g;
    };
    this.legL = leg(-0.12);
    this.legR = leg(0.12);
    this.root.add(this.legL, this.legR);

    const torso = block(0.46, 0.6, 0.26, look.shirt);
    torso.position.set(0, 0.3, 0);
    const vest = block(0.4, 0.34, 0.3, look.vest);
    vest.position.set(0, 0.3, 0);
    const belt = block(0.47, 0.06, 0.27, look.boots);
    belt.position.set(0, 0.02, 0);
    const shoulderL = block(0.14, 0.12, 0.26, look.shirt);
    shoulderL.position.set(-0.28, 0.54, 0);
    const shoulderR = block(0.14, 0.12, 0.26, look.shirt);
    shoulderR.position.set(0.28, 0.54, 0);
    const pack = block(0.3, 0.3, 0.12, look.vest);
    pack.position.set(0, 0.3, 0.19);
    this.body.add(torso, vest, belt, shoulderL, shoulderR, pack);

    this.head = new THREE.Group();
    const neck = block(0.12, 0.1, 0.12, look.head);
    neck.position.y = 0.05;
    const skull = block(0.26, 0.28, 0.26, look.head);
    skull.position.y = 0.24;
    const eyes = block(0.2, 0.05, 0.03, 0x1b1b1b);
    eyes.position.set(0, 0.27, -0.13);
    const hat = block(0.28, 0.08, 0.28, look.hat);
    hat.position.y = 0.36;
    this.head.add(neck, skull, eyes, hat);
    this.head.position.y = 0.6;
    this.body.add(this.head);

    this.arms.position.set(0, 0.5, 0);
    const upperL = block(0.12, 0.12, 0.3, look.shirt);
    upperL.position.set(-0.24, -0.02, -0.14);
    upperL.rotation.y = 0.5;
    const foreL = block(0.1, 0.1, 0.3, look.shirt);
    foreL.position.set(-0.08, -0.04, -0.38);
    foreL.rotation.y = 0.2;
    const handL = block(0.1, 0.1, 0.1, SKIN_HANDS);
    handL.position.set(-0.02, -0.04, -0.52);
    const upperR = block(0.12, 0.12, 0.26, look.shirt);
    upperR.position.set(0.22, -0.02, -0.08);
    upperR.rotation.y = -0.35;
    const foreR = block(0.1, 0.1, 0.22, look.shirt);
    foreR.position.set(0.14, -0.06, -0.26);
    const handR = block(0.1, 0.1, 0.1, SKIN_HANDS);
    handR.position.set(0.12, -0.06, -0.38);
    this.arms.add(upperL, foreL, handL, upperR, foreR, handR);
    this.body.add(this.arms);

    this.body.position.y = 0.82;
    this.root.add(this.body);

    const labelMat = new THREE.SpriteMaterial({ map: makeLabelTexture(name, "#f0e0b0"), transparent: true, depthTest: false });
    this.label = new THREE.Sprite(labelMat);
    this.label.scale.set(1.2, 0.3, 1);
    this.label.position.y = 2.15;
    this.root.add(this.label);
  }

  setLabel(text: string, color: string): void {
    const m = this.label.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.map = makeLabelTexture(text, color);
    m.needsUpdate = true;
  }

  setWeapon(id: number, pap: boolean): void {
    if (id === this.weaponId && pap === this.weaponPap) return;
    if (this.weaponGroup) this.arms.remove(this.weaponGroup);
    this.weaponGroup = buildWeaponMesh(id, false, pap);
    this.weaponGroup.position.set(0.12, 0.0, -0.4);
    this.arms.add(this.weaponGroup);
    this.weaponId = id;
    this.weaponPap = pap;
  }

  update(p: UnpackedPlayer, dt: number, pap = false): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    this.setWeapon(p.weapon, pap);

    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    const speed = dt > 0 ? moved / dt : 0;
    if (speed > 0.3 && p.onGround) this.walk += moved * 4.5;
    else this.walk *= 0.8;
    const swing = Math.sin(this.walk) * Math.min(0.7, speed / 5);
    this.breath += dt;

    if (p.down) {
      // Caído: sentado, apoyado en un brazo.
      this.legL.scale.y = 0.4;
      this.legR.scale.y = 0.4;
      this.legL.position.y = 0.3;
      this.legR.position.y = 0.3;
      this.legL.rotation.x = -1.2;
      this.legR.rotation.x = -1.0;
      this.body.position.y = 0.32;
      this.body.rotation.x = -0.35;
      this.arms.rotation.x = 0.3;
      this.head.rotation.x = 0.3;
      return;
    }

    const c = p.crouch / CROUCH_TICKS;
    const legScale = 1 - c * 0.45;
    this.legL.scale.y = legScale;
    this.legR.scale.y = legScale;
    this.legL.position.y = 0.82 * legScale;
    this.legR.position.y = 0.82 * legScale;
    this.legL.rotation.x = p.onGround ? swing : 0.45;
    this.legR.rotation.x = p.onGround ? -swing : -0.25;
    this.body.position.y = 0.82 * legScale + Math.sin(this.breath * 2) * 0.004;
    this.body.rotation.x = c * 0.3;
    this.arms.rotation.x = -p.pitch * 0.9;
    this.head.rotation.x = -p.pitch * 0.5;

    if (this.weaponGroup) {
      this.weaponGroup.updateWorldMatrix(true, false);
      this.muzzle.copy(muzzleOffset(this.weaponId)).applyMatrix4(this.weaponGroup.matrixWorld);
    }
  }

  dispose(): void {
    (this.label.material as THREE.SpriteMaterial).map?.dispose();
  }
}
