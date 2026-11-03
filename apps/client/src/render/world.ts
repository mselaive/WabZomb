import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  BOARD_MAX,
  BOX_PRICE,
  BOX_SPIN_TICKS,
  FRAG,
  PAP_PRICE,
  PERK_COLORS,
  PERK_NAMES,
  PERK_PRICES,
  POWERUP_NAMES,
  TEX_COUNT,
  TEX_FENCE,
  TEX_METAL,
  TEX_WOOD,
  BOX_POOL,
  AXE_PRICE,
  EGG_BEACON,
  EGG_BOAT,
  EGG_BOAT_PARTS,
  EGG_BREAKERS,
  EGG_KEY,
  EGG_SAFE,
  EGG_SOULS,
  weapon,
  weaponStats,
  type Box,
  type GameMap,
  type GameState,
  type PowerUpState,
  type UnpackedGrenade,
} from "@wabzomb/shared";
import { makeAllMaterials, makeChalkTexture, makeLabelTexture, makePuffTexture } from "./textures.js";
import { RocaArt } from "./roca.js";
import { buildBoat, buildBreaker, buildFurnaceFront, buildPapMachine, buildQuestItem, buildSafe, buildWoodDoor, chalkDigit, furnaceEmbers, powerPanelFace, buildPerkCabinet, buildSteelDoor, buildWindowFrame } from "./rocaProps.js";
import { buildAxeMesh, buildGrenadeMesh, buildWeaponMesh, setWeaponEnvironment } from "./viewmodel.js";

function cylinderGeometry(b: Box): THREE.BufferGeometry {
  const r = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const h = b.maxY - b.minY;
  const g = new THREE.CylinderGeometry(r, r, h, 18, 1);
  g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const around = Math.PI * 2 * r;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * h);
  return g;
}

/** Una caja del mapa como geometría con los UV escalados a metros. */
export function boxGeometry(b: Box): THREE.BufferGeometry {
  if (b.shape === "cyl") return cylinderGeometry(b);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const d = b.maxZ - b.minZ;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2 + (b.decal ? 0.004 : 0), (b.minZ + b.maxZ) / 2);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const scales: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const offsets: [number, number][] = [[b.minZ, b.minY], [b.minZ, b.minY], [b.minX, b.minZ], [b.minX, b.minZ], [b.minX, b.minY], [b.minX, b.minY]];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = scales[face]!;
    const [ou, ov] = offsets[face]!;
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
    }
  }
  return g;
}

/** Un cielo de noche: degradé oscuro, estrellas y una luna. */
function makeSky(top: THREE.Color, horizon: THREE.Color): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: { top: { value: top }, horizon: { value: horizon }, moonDir: { value: new THREE.Vector3(-0.4, 0.5, -0.6).normalize() } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 moonDir;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.6));
        // Estrellas: puntos al azar en una grilla del cielo.
        vec3 cell = floor(d * 90.0);
        float s = hash(cell);
        if (s > 0.985 && d.y > 0.05) col += vec3(0.8, 0.85, 1.0) * (s - 0.985) * 40.0 * h;
        float m = max(dot(d, moonDir), 0.0);
        col += vec3(0.9, 0.9, 0.75) * (smoothstep(0.9985, 0.9992, m) * 1.0 + pow(m, 24.0) * 0.08);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16), material);
  sky.renderOrder = -1;
  return sky;
}

/** Silueta de tiza de cada tipo de arma (muy esquemática: es tiza). */
function chalkSilhouette(cls: string): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  return (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2 + 10;
    ctx.beginPath();
    if (cls === "pistol") {
      ctx.moveTo(cx - 90, cy - 30);
      ctx.lineTo(cx + 90, cy - 30);
      ctx.lineTo(cx + 90, cy + 10);
      ctx.lineTo(cx - 10, cy + 10);
      ctx.lineTo(cx - 30, cy + 70);
      ctx.lineTo(cx - 75, cy + 70);
      ctx.lineTo(cx - 60, cy + 10);
      ctx.lineTo(cx - 90, cy + 10);
      ctx.closePath();
    } else if (cls === "grenade") {
      ctx.arc(cx, cy + 10, 50, 0, Math.PI * 2);
      ctx.moveTo(cx - 12, cy - 40);
      ctx.lineTo(cx + 12, cy - 40);
      ctx.lineTo(cx + 12, cy - 60);
      ctx.lineTo(cx - 12, cy - 60);
      ctx.closePath();
    } else {
      const shotgun = cls === "shotgun";
      ctx.moveTo(cx - 200, cy - 10);
      ctx.lineTo(cx - 120, cy - 30);
      ctx.lineTo(cx + 40, cy - 30);
      ctx.lineTo(cx + 40, cy - 40);
      ctx.lineTo(cx + 230, cy - 40);
      ctx.lineTo(cx + 230, cy - 20);
      ctx.lineTo(cx + 60, cy - 20);
      ctx.lineTo(cx + 60, cy + 5);
      if (!shotgun) {
        ctx.lineTo(cx + 10, cy + 5);
        ctx.lineTo(cx, cy + 60);
        ctx.lineTo(cx - 30, cy + 60);
        ctx.lineTo(cx - 25, cy + 5);
      }
      ctx.lineTo(cx - 60, cy + 5);
      ctx.lineTo(cx - 80, cy + 50);
      ctx.lineTo(cx - 105, cy + 50);
      ctx.lineTo(cx - 100, cy + 5);
      ctx.lineTo(cx - 120, cy + 5);
      ctx.lineTo(cx - 200, cy + 25);
      ctx.closePath();
    }
    ctx.stroke();
  };
}

interface Machine {
  group: THREE.Group;
  light: THREE.Mesh;
  lamp: THREE.PointLight | null;
  /** Más materiales que se prenden junto con la luz. */
  extra?: THREE.MeshStandardMaterial[];
}

/**
 * El mundo: el mapa como una malla por textura, las luces, el cielo, y todo lo
 * que tiene estado: puertas, tablas, la caja, el Pack-a-Punch, las máquinas de
 * bebidas, la llave de la luz, las radios, los power-ups y las granadas.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly materials: THREE.MeshStandardMaterial[] = makeAllMaterials();
  /** La dirección de arte del mapa, si tiene (materiales, luz horneada, modelos, mar...). */
  art: RocaArt | null = null;
  private readonly hemi: THREE.HemisphereLight;
  onAssets: ((k: number) => void) | null = null;
  onThunder: ((delay: number) => void) | null = null;
  private mapGroup = new THREE.Group();
  private propGroup = new THREE.Group();
  private doorMeshes: THREE.Group[] = [];
  private boardMeshes: THREE.Mesh[][] = [];
  private grenadeMeshes = new Map<number, THREE.Group>();
  private grenadeGroup = new THREE.Group();
  private powerUpMeshes = new Map<number, THREE.Group>();
  private powerUpGroup = new THREE.Group();
  private zoneLamps: THREE.PointLight[] = [];
  private perkMachines: Machine[] = [];
  private papMachine: Machine | null = null;
  private papWeapon: THREE.Group | null = null;
  private boxGroup: THREE.Group | null = null;
  private boxLid: THREE.Mesh | null = null;
  private boxBeam: THREE.Mesh | null = null;
  private boxWeapon: THREE.Group | null = null;
  private boxWeaponId = -99;
  private boxTeddy: THREE.Group | null = null;
  private powerLever: THREE.Mesh | null = null;
  private radioMeshes: THREE.Group[] = [];
  private partMeshes: THREE.Group[] = [];
  private benchGroup: THREE.Group | null = null;
  private furnaceMouth: THREE.Mesh | null = null;
  private furnaceLight: THREE.PointLight | null = null;
  private questItems: THREE.Group[] = [];
  private safe: ReturnType<typeof buildSafe> | null = null;
  private dialShown = -1;
  private breakers: ReturnType<typeof buildBreaker>[] = [];
  private clues: THREE.Mesh[] = [];
  private cluesShown = -1;
  private boat: { group: THREE.Group; lamp: THREE.MeshStandardMaterial; engine: THREE.Object3D; baseY: number } | null = null;
  readonly moon: THREE.DirectionalLight;
  private sky: THREE.Mesh | null = null;
  private map: GameMap | null = null;
  private powerOn = false;
  private readonly puffTex = makePuffTexture();

  constructor() {
    this.hemi = new THREE.HemisphereLight(0x3c4c6a, 0x241e18, 0.95);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9fb4e0, 1.3);
    this.moon.position.set(-18, 30, -26);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(4096, 4096);
    this.moon.shadow.camera.near = 1;
    this.moon.shadow.camera.far = 120;
    this.moon.shadow.camera.left = -45;
    this.moon.shadow.camera.right = 45;
    this.moon.shadow.camera.top = 40;
    this.moon.shadow.camera.bottom = -40;
    this.moon.shadow.bias = -0.0008;
    this.moon.shadow.normalBias = 0.03;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);
    this.scene.add(this.mapGroup);
    this.scene.add(this.propGroup);
    this.scene.add(this.grenadeGroup);
    this.scene.add(this.powerUpGroup);
  }

  setEnvironment(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    setWeaponEnvironment(env);
    this.scene.environmentIntensity = 0.18;
    pmrem.dispose();
  }

  load(map: GameMap): void {
    this.map = map;
    this.mapGroup.clear();
    this.propGroup.clear();
    if (this.art) {
      this.art.dispose();
      this.art = null;
    }
    const sky = new THREE.Color(map.sky);
    const horizon = sky.clone().lerp(new THREE.Color(0x3a2e3a), 0.5);
    const top = sky.clone().lerp(new THREE.Color(0x02030a), 0.6);
    this.scene.background = horizon;
    this.scene.fog = new THREE.Fog(horizon, 30, 95);
    if (this.sky) this.scene.remove(this.sky);
    this.sky = makeSky(top, horizon);
    this.scene.add(this.sky);

    this.sky.visible = true;
    this.hemi.color.set(0x3c4c6a);
    this.hemi.groundColor.set(0x241e18);
    this.hemi.intensity = 0.95;
    this.moon.intensity = 1.3;
    this.moon.castShadow = true;
    this.moon.position.set(-18, 30, -26);

    if (map.art) {
      this.scene.background = new THREE.Color(0x1a222c);
      this.sky.visible = false;
      this.art = new RocaArt(this.scene, map, this.hemi, this.moon, this.materials);
      this.art.onProgress = (k) => this.onAssets?.(k);
      this.art.onThunder = (d) => this.onThunder?.(d);
      this.mapGroup.add(this.art.group);
      this.buildDoors(map);
      this.buildBarriers(map);
      this.buildWallWeapons(map);
      this.buildPerks(map);
      this.buildPap(map);
      this.buildBox(map);
      this.buildPower(map);
      this.buildRadios(map);
      this.buildEgg(map);
      this.zoneLamps = [];
      this.setPower(false, true);
      return;
    }

    const byTex: THREE.BufferGeometry[][] = Array.from({ length: TEX_COUNT }, () => []);
    for (const b of map.boxes) {
      if (b.hidden) continue;
      byTex[b.tex]?.push(boxGeometry(b));
    }
    byTex.forEach((list, tex) => {
      if (list.length === 0) return;
      const merged = mergeGeometries(list, false);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, this.materials[tex]);
      mesh.castShadow = tex !== TEX_FENCE;
      mesh.receiveShadow = true;
      this.mapGroup.add(mesh);
    });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x2a2822, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.52;
    ground.receiveShadow = true;
    this.mapGroup.add(ground);

    this.buildDoors(map);
    this.buildBarriers(map);
    this.buildWallWeapons(map);
    this.buildPerks(map);
    this.buildPap(map);
    this.buildBox(map);
    this.buildPower(map);
    this.buildRadios(map);
    this.buildEgg(map);
    this.buildLamps(map);
  }

  // ------------------------------------------------------------ lo fijo con estado

  private buildDoors(map: GameMap): void {
    this.doorMeshes = [];
    for (const d of map.doors) {
      const g = new THREE.Group();
      const b = d.box;
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const dd = b.maxZ - b.minZ;
      const alongX = w > dd;
      if (d.style === "bars") {
        this.buildBarsDoor(g, b, alongX);
      } else if (d.style === "wood") {
        buildWoodDoor(g, b, this.materials[34]!, this.materials[26]!);
      } else if (d.style === "steel") {
        buildSteelDoor(g, b, this.materials[25] ?? this.materials[TEX_METAL]!);
      } else if (d.box.tex === TEX_WOOD || d.box.tex === 2) {
        // Escombros: tablones cruzados y cajones.
        for (let i = 0; i < 5; i++) {
          const plank = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w * 0.95 : 0.1, 0.18, alongX ? 0.1 : dd * 0.95), this.materials[TEX_WOOD]);
          plank.position.set((b.minX + b.maxX) / 2, b.minY + 0.3 + i * 0.45, (b.minZ + b.maxZ) / 2);
          plank.rotation.set(alongX ? 0 : (i % 2 ? 0.2 : -0.25), 0, alongX ? (i % 2 ? 0.2 : -0.25) : 0);
          plank.castShadow = true;
          g.add(plank);
        }
        const crate = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.9, w * 0.6), 0.9, Math.min(0.9, dd * 0.6)), this.materials[2]);
        crate.position.set((b.minX + b.maxX) / 2, b.minY + 0.45, (b.minZ + b.maxZ) / 2);
        g.add(crate);
      } else {
        const mesh = new THREE.Mesh(boxGeometry(b), this.materials[b.tex]);
        mesh.castShadow = true;
        g.add(mesh);
        // Barrotes si es una reja.
        if (b.tex === TEX_FENCE) {
          for (let i = 0; i < 6; i++) {
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h, 6), this.materials[TEX_METAL]);
            bar.position.set(alongX ? b.minX + (w * (i + 0.5)) / 6 : (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, alongX ? (b.minZ + b.maxZ) / 2 : b.minZ + (dd * (i + 0.5)) / 6);
            g.add(bar);
          }
        }
      }
      // Con luz horneada: la que le toca a la puerta. Se la mira del lado de donde se viene, así que se toma del medio.
      this.art?.bakeLight(g, (b.minX + b.maxX) / 2 + (alongX ? 0 : 0.5), b.minY + 1.5, (b.minZ + b.maxZ) / 2 + (alongX ? 0.5 : 0), 0, 1, 0);
      // El precio flotando.
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(d.locked ? `${d.name} · con llave` : `${d.name} · ${d.price}`, "#ffd27a", 512, 30), transparent: true, depthTest: true }));
      label.scale.set(2.6, 0.33, 1);
      label.position.set((b.minX + b.maxX) / 2, b.maxY + 0.3, (b.minZ + b.maxZ) / 2);
      g.add(label);
      this.propGroup.add(g);
      this.doorMeshes.push(g);
    }
  }

  /** Una reja: barrotes redondos entre dos travesaños y un marco. */
  private buildBarsDoor(g: THREE.Group, b: Box, alongX: boolean): void {
    const steel = this.materials[25] ?? this.materials[TEX_METAL]!;
    const w = alongX ? b.maxX - b.minX : b.maxZ - b.minZ;
    const h = b.maxY - b.minY;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const n = Math.max(3, Math.round(w / 0.13));
    const bar = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, h, 6, 1, true), steel, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const k = ((i + 0.5) / n - 0.5) * w;
      m.makeTranslation(cx + (alongX ? k : 0), b.minY + h / 2, cz + (alongX ? 0 : k));
      bar.setMatrixAt(i, m);
    }
    bar.frustumCulled = false;
    g.add(bar);
    const rails = [0.06, 1.05, h - 0.06];
    for (const y of rails) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : 0.05, 0.07, alongX ? 0.05 : w), steel);
      r.position.set(cx, b.minY + y, cz);
      g.add(r);
    }
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.08 : 0.12, h, alongX ? 0.12 : 0.08), steel);
      post.position.set(cx + (alongX ? (s * w) / 2 : 0), b.minY + h / 2, cz + (alongX ? 0 : (s * w) / 2));
      g.add(post);
    }
    // La cerradura.
    const lock = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.24 : 0.09, 0.3, alongX ? 0.09 : 0.24), new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.8, roughness: 0.5 }));
    lock.position.set(cx, b.minY + 1.1, cz);
    g.add(lock);
  }

  private buildBarriers(map: GameMap): void {
    this.boardMeshes = [];
    const boardMat = this.materials[34] ?? this.materials[18]!;
    for (const b of map.barriers) {
      const box = b.box;
      if (map.art && b.kind === "window") this.propGroup.add(buildWindowFrame(b, this.materials[25]!));
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const alongX = box.maxX - box.minX > box.maxZ - box.minZ;
      const width = alongX ? box.maxX - box.minX : box.maxZ - box.minZ;
      const list: THREE.Mesh[] = [];
      for (let i = 0; i < BOARD_MAX; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(alongX ? width + 0.3 : 0.08, 0.16, alongX ? 0.08 : width + 0.3), boardMat);
        const y = box.minY + 0.12 + (i * (box.maxY - box.minY - 0.24)) / (BOARD_MAX - 1);
        plank.position.set(cx, y, cz);
        const tilt = (i % 2 === 0 ? 1 : -1) * (0.08 + (i % 3) * 0.05);
        plank.rotation.set(alongX ? 0 : tilt, 0, alongX ? tilt : 0);
        plank.castShadow = true;
        this.art?.bakeLight(plank, b.inside.x, box.minY + 1, b.inside.z);
        this.propGroup.add(plank);
        list.push(plank);
      }
      // El marco de la ventana.
      if (!map.art) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(alongX ? width + 0.2 : 0.14, 0.08, alongX ? 0.14 : width + 0.2), this.materials[TEX_WOOD]);
        frame.position.set(cx, box.minY - 0.02, cz);
        this.propGroup.add(frame);
      }
      this.boardMeshes.push(list);
    }
  }

  private buildWallWeapons(map: GameMap): void {
    for (const ww of map.wallWeapons) {
      const w = weapon(ww.weapon);
      const price = ww.weapon === FRAG ? 250 : w.wall;
      const tex = makeChalkTexture(w.name, price, chalkSilhouette(w.cls));
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      plane.position.set(ww.x, ww.y, ww.z);
      // El plano mira a +Z de su espacio: se lo gira para que mire hacia la sala.
      plane.rotation.y = ww.yaw + Math.PI;
      this.propGroup.add(plane);
      if (map.art) {
        // En La Roca va en un tablón colgado: muchas caen sobre una reja, y la tiza sola no se apoyaría en nada.
        const board = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.92, 0.04), this.materials[34]!);
        const fx = -Math.sin(ww.yaw);
        const fz = -Math.cos(ww.yaw);
        board.position.set(ww.x - fx * 0.03, ww.y, ww.z - fz * 0.03);
        board.rotation.y = plane.rotation.y;
        this.propGroup.add(board);
        this.art?.bakeLight(board, ww.x + fx * 0.8, ww.y, ww.z + fz * 0.8);
      }
    }
  }

  private machine(x: number, z: number, yaw: number, color: number, label: string, sub: string, w = 0.9, h = 1.9, d = 0.7, y = 0): Machine {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }));
    body.position.y = h / 2;
    body.castShadow = true;
    g.add(body);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.5, 0.03), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0, roughness: 0.3 }));
    panel.position.set(0, h * 0.62, -d / 2 - 0.01);
    g.add(panel);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    slot.position.set(0, h * 0.25, -d / 2 - 0.01);
    g.add(slot);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(label, "#ffffff", 384, 36), transparent: true, depthTest: true }));
    sprite.scale.set(1.8, 0.3, 1);
    sprite.position.y = h + 0.35;
    g.add(sprite);
    const sub2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(sub, "#ffd27a", 384, 30), transparent: true, depthTest: true }));
    sub2.scale.set(1.5, 0.25, 1);
    sub2.position.y = h + 0.1;
    g.add(sub2);
    // Con luz horneada, el brillo de alrededor ya está en el lightmap.
    let lamp: THREE.PointLight | null = null;
    if (!this.art) {
      lamp = new THREE.PointLight(color, 0, 5, 1.8);
      lamp.position.set(0, h * 0.7, -d);
      g.add(lamp);
    }
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.propGroup.add(g);
    return { group: g, light: panel, lamp };
  }

  private buildPerks(map: GameMap): void {
    this.perkMachines = [];
    for (const m of map.perks) {
      const price = PERK_PRICES[m.perk] ?? 0;
      if (map.art) {
        const { group, glow } = buildPerkCabinet(PERK_NAMES[m.perk] ?? "", `${price}`, PERK_COLORS[m.perk] ?? 0xffffff);
        group.position.set(m.x, m.y ?? 0, m.z);
        group.rotation.y = m.yaw;
        const title = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`${PERK_NAMES[m.perk] ?? ""} · ${price}`, "#ffffff", 512, 34), transparent: true, depthTest: true }));
        title.scale.set(2.2, 0.28, 1);
        title.position.y = 2.42;
        group.add(title);
        this.propGroup.add(group);
        this.perkMachines.push({ group, light: new THREE.Mesh(undefined, glow[0]), lamp: null, extra: glow.slice(1) });
        continue;
      }
      this.perkMachines.push(this.machine(m.x, m.z, m.yaw, PERK_COLORS[m.perk] ?? 0xffffff, PERK_NAMES[m.perk] ?? "", `${price}`, 0.9, 1.9, 0.7, m.y ?? 0));
    }
  }

  private buildPap(map: GameMap): void {
    const p = map.pap;
    if (map.art) {
      const { group, glow } = buildPapMachine();
      group.position.set(p.x, p.y ?? 0, p.z);
      group.rotation.y = p.yaw;
      const title = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`Pack-a-Punch · ${PAP_PRICE}`, "#d8b8ff", 512, 34), transparent: true, depthTest: true }));
      title.scale.set(2.4, 0.3, 1);
      title.position.y = 2.4;
      group.add(title);
      this.propGroup.add(group);
      this.papMachine = { group, light: new THREE.Mesh(undefined, glow), lamp: null };
      this.papWeapon = null;
      return;
    }
    this.papMachine = this.machine(p.x, p.z, p.yaw, 0x3a2a5a, "Pack-a-Punch", `${PAP_PRICE}`, 1.6, 1.4, 1.0, p.y ?? 0);
    // Las luces de colores en el frente.
    const colors = [0xff2a6a, 0x2affd0, 0xffe02a, 0x7a2aff];
    colors.forEach((c, i) => {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0 }));
      bulb.position.set(-0.6 + i * 0.4, 1.2, -0.52);
      bulb.name = "bulb";
      this.papMachine!.group.add(bulb);
    });
    this.papWeapon = null;
  }

  private buildBox(map: GameMap): void {
    const g = new THREE.Group();
    const woodMat = this.materials[34] ?? this.materials[TEX_WOOD]!;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 0.7), woodMat);
    chest.position.y = 0.3;
    chest.castShadow = true;
    g.add(chest);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.08, 0.74), this.materials[26] ?? this.materials[TEX_METAL]!);
    trim.position.y = 0.56;
    g.add(trim);
    // Signos de interrogación en los costados.
    const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture("?", "#ffd27a", 64, 50), transparent: true }));
    mark.scale.set(0.4, 0.4, 1);
    mark.position.set(0, 0.35, -0.37);
    g.add(mark);
    // Cinchas de hierro y las esquinas.
    if (map.art) {
      const iron = this.materials[26]!;
      for (const x of [-0.42, 0.42]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.62, 0.74), iron);
        band.position.set(x, 0.3, 0);
        g.add(band);
      }
      for (const [x, z] of [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]] as const) {
        const corner = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.64, 0.08), iron);
        corner.position.set(x, 0.3, z);
        g.add(corner);
      }
    }
    this.boxLid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.7), woodMat);
    this.boxLid.position.set(0, 0.6, 0.35);
    this.boxLid.geometry.translate(0, 0.05, -0.35);
    g.add(this.boxLid);
    // El haz de luz azul que sale hacia arriba.
    this.boxBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.45, 9, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x5ab0ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.boxBeam.position.y = 4.8;
    g.add(this.boxBeam);
    const glow = new THREE.PointLight(0x5ab0ff, 1.2, 6, 1.5);
    glow.position.y = 1.2;
    g.add(glow);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`Caja misteriosa · ${BOX_PRICE}`, "#ffd27a", 512, 30), transparent: true, depthTest: true }));
    label.scale.set(2.4, 0.3, 1);
    label.position.y = 1.5;
    g.add(label);
    this.boxGroup = g;
    this.propGroup.add(g);
    if (this.art) {
      const s0 = map.boxSpots[0]!;
      this.art.bakeLight(g, s0.x, (s0.y ?? 0) + 1, s0.z);
    }
    this.boxWeapon = null;
    this.boxTeddy = null;
    this.placeBox(map, 0);
  }

  private placeBox(map: GameMap, spot: number): void {
    const s = map.boxSpots[spot] ?? map.boxSpots[0]!;
    this.boxGroup!.position.set(s.x, s.y ?? 0, s.z);
    this.boxGroup!.rotation.y = s.yaw;
  }

  private buildPower(map: GameMap): void {
    const g = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.3), this.materials[27] ?? this.materials[TEX_METAL]!);
    panel.position.y = 1.1;
    g.add(panel);
    this.powerLever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5 }));
    this.powerLever.position.set(0, 1.3, -0.2);
    this.powerLever.geometry.translate(0, 0.2, 0);
    this.powerLever.rotation.x = -0.9;
    g.add(this.powerLever);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture("La luz", "#ffd27a", 256, 34), transparent: true, depthTest: true }));
    label.scale.set(1.2, 0.3, 1);
    label.position.y = 2.1;
    g.add(label);
    if (map.art) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.36), new THREE.MeshStandardMaterial({ map: powerPanelFace(), roughness: 0.6, metalness: 0.3 }));
      face.position.set(0, 1.1, -0.152);
      face.rotation.y = Math.PI;
      g.add(face);
      // Una caja de conexiones arriba y los caños que suben al techo.
      for (const x of [-0.25, 0, 0.25]) {
        const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 8), this.materials[26]!);
        conduit.position.set(x, 2.45, 0);
        g.add(conduit);
      }
      this.powerLever!.scale.setScalar(1.5);
      this.powerLever!.position.set(0.56, 1.1, -0.1);
    }
    g.position.set(map.power.x, map.power.y ?? 0, map.power.z);
    this.art?.bakeLight(g, map.power.x, (map.power.y ?? 0) + 1.2, map.power.z - 0.5, 0, 0, -1);
    g.rotation.y = map.power.yaw;
    this.propGroup.add(g);
  }

  private buildRadios(map: GameMap): void {
    this.radioMeshes = [];
    for (const r of map.radios) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.14), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.7 }));
      g.add(body);
      const grill = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.02), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      grill.position.set(-0.06, 0, -0.075);
      g.add(grill);
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), new THREE.MeshStandardMaterial({ color: 0xd8c8a0 }));
      dial.rotation.x = Math.PI / 2;
      dial.position.set(0.1, 0.02, -0.075);
      g.add(dial);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8 }));
      antenna.position.set(0.14, 0.28, 0.02);
      antenna.rotation.z = -0.25;
      g.add(antenna);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshStandardMaterial({ color: 0x33ff55, emissive: 0x33ff55, emissiveIntensity: 0 }));
      led.name = "led";
      led.position.set(0.04, 0.05, -0.075);
      g.add(led);
      g.position.set(r.x, r.y, r.z);
      g.rotation.y = r.yaw;
      this.propGroup.add(g);
      this.radioMeshes.push(g);
      this.art?.attachModel(g, "radio", 0.6, () => {
        body.visible = grill.visible = dial.visible = antenna.visible = false;
      });
    }
  }

  /** Las piezas de la Thunder Gun que están en el mapa, y el banco con su cartel. */
  private buildEgg(map: GameMap): void {
    this.partMeshes = [];
    map.eggParts.forEach((p, i) => {
      const g = buildPart(i, this.puffTex);
      g.position.set(p.x, p.y, p.z);
      g.userData.baseY = p.y;
      this.propGroup.add(g);
      this.partMeshes.push(g);
    });
    const b = map.bench;
    const g = new THREE.Group();
    const vise = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), this.materials[TEX_METAL]);
    vise.position.set(0.4, 1.0, 0);
    g.add(vise);
    const tools = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 }));
    tools.position.set(-0.35, 0.93, 0);
    g.add(tools);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture("Banco de trabajo", "#ffd27a", 384, 32), transparent: true, depthTest: true }));
    label.scale.set(1.7, 0.28, 1);
    label.position.y = 1.6;
    g.add(label);
    if (map.art) {
      this.art?.attachModel(g, "toolcart", 1, () => {
        vise.visible = tools.visible = false;
      });
      label.position.y = 1.85;
    }
    g.position.set(b.x, b.y ?? 0, b.z - 1.0);
    g.rotation.y = b.yaw;
    this.propGroup.add(g);
    this.benchGroup = g;
    this.buildFurnace(map);
    this.buildQuest(map);
  }

  /** La fuga: la lancha, la llave y las piezas. */
  private buildQuest(map: GameMap): void {
    const q = map.quest;
    this.questItems = [];
    this.boat = null;
    if (!q) return;
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3c, metalness: 0.85, roughness: 0.35, envMapIntensity: 1 });
    const iron = this.materials[26]!;
    const wood = this.materials[34]!;
    [q.key, ...q.parts].forEach((item, i) => {
      const g = buildQuestItem(i, this.puffTex, brass, iron, wood);
      g.position.set(item.x, item.y + item.h, item.z);
      g.userData.baseY = item.y + item.h;
      g.visible = false;
      this.propGroup.add(g);
      this.questItems.push(g);
    });
    const { group, lamp, engine } = buildBoat(wood, this.materials[25]!, iron);
    group.position.set(q.boat.x, (map.art?.seaY ?? -13) - 0.25, q.boat.z + 5.2);
    this.propGroup.add(group);
    this.art?.bakeLight(group, q.boat.x, q.boat.y + 2, q.boat.z);
    this.boat = { group, lamp, engine, baseY: group.position.y };

    // La caja fuerte, en la pared de la oficina del alcaide.
    const safe = buildSafe(this.materials[25]!, q.safeWheels, q.safe.x);
    safe.group.position.set(q.safe.x, q.safe.y, q.safe.z);
    this.propGroup.add(safe.group);
    this.art?.bakeLight(safe.group, q.safe.x, q.safe.y + 1.4, q.safe.z + 1, 0, 0, 1);
    this.safe = safe;
    this.dialShown = -1;

    // Las llaves de corte: se ven desde el principio, pero no hacen nada hasta el final.
    this.breakers = q.breakers.map((b) => {
      const x = buildBreaker(this.materials[27]!);
      x.group.position.set(b.x, b.y + b.h, b.z);
      // Miran hacia la sala: desde la pared hacia donde se para el jugador.
      x.group.rotation.y = Math.abs(b.x) > 29 ? (b.x > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.PI;
      this.propGroup.add(x.group);
      this.art?.bakeLight(x.group, b.x * 0.97, b.y + 1.5, b.z, 0, 1, 0);
      return x;
    });

    // El hacha en su caja de vidrio, con el precio.
    const axeCase = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.92, 0.62), this.materials[26]!);
    axeCase.add(frame);
    const axe = buildAxeMesh();
    axe.scale.setScalar(1.45);
    axe.position.set(-0.09, -0.03, 0.03);
    axe.rotation.x = 0.28;
    axeCase.add(axe);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.86, 0.56), new THREE.MeshStandardMaterial({ color: 0xa8c0d0, transparent: true, opacity: 0.16, roughness: 0.08 }));
    glass.position.x = -0.14;
    axeCase.add(glass);
    const axeLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(`Hacha de incendios · ${AXE_PRICE}`, "#ffd27a", 512, 30), transparent: true, depthTest: true }));
    axeLabel.scale.set(2.2, 0.28, 1);
    axeLabel.position.set(-0.2, 0.68, 0);
    axeCase.add(axeLabel);
    axeCase.position.set(q.axe.x + 0.26, q.axe.y + q.axe.h, q.axe.z);
    this.propGroup.add(axeCase);
    this.art?.bakeLight(axeCase, q.axe.x - 0.8, q.axe.y + 1.5, q.axe.z);
    this.clues = [];
    this.cluesShown = -1;
  }

  /** Los tres números en tiza: aparecen cuando se puede leer la combinación. */
  private updateClues(map: GameMap, code: number): void {
    const q = map.quest;
    if (!q || code === this.cluesShown) return;
    this.cluesShown = code;
    for (const c of this.clues) this.propGroup.remove(c);
    this.clues = [];
    if (code < 0) return;
    q.clues.forEach((c, i) => {
      const digit = Math.floor(code / (i === 0 ? 100 : i === 1 ? 10 : 1)) % 10;
      const mesh = chalkDigit(i, digit);
      mesh.position.set(c.x, c.y, c.z);
      mesh.rotation.y = c.yaw + Math.PI;
      this.propGroup.add(mesh);
      this.clues.push(mesh);
    });
  }

  private updateQuest(egg: number, map: GameMap, qs: readonly number[]): void {
    const q = map.quest;
    if (!q) return;
    const t = performance.now() / 1000;
    this.updateClues(map, qs[1] ?? -1);
    // La caja fuerte: las ruedas marcan lo que dice el servidor, y la puerta se abre.
    if (this.safe) {
      const dial = qs[2] ?? 0;
      if (dial !== this.dialShown) {
        this.dialShown = dial;
        this.safe.dials.forEach((d, i) => {
          const digit = Math.floor(dial / (i === 0 ? 100 : i === 1 ? 10 : 1)) % 10;
          d.rotation.y = (digit / 10) * Math.PI * 2;
        });
      }
      const open = (egg & EGG_SAFE) !== 0 ? -1.75 : 0;
      this.safe.door.rotation.y += (open - this.safe.door.rotation.y) * 0.08;
    }
    this.breakers.forEach((b, i) => {
      const down = (egg & EGG_BREAKERS) !== 0 || ((qs[3] ?? 0) & (1 << i)) !== 0;
      b.lever.rotation.x = down ? 2.3 : 0.5;
      b.lamp.emissiveIntensity = down ? 3 : (egg & EGG_BOAT) !== 0 ? 0.5 + Math.sin(t * 5) * 0.4 : 0.1;
      b.lamp.emissive.set(down ? 0x60ff60 : 0xff5a2a);
    });
    this.questItems.forEach((g, i) => {
      const taken = i === 0 ? (egg & EGG_KEY) !== 0 : (egg & (EGG_BOAT_PARTS[i - 1] ?? 0)) !== 0;
      const visible = i === 0 ? (egg & EGG_SAFE) !== 0 && !taken : (egg & EGG_KEY) !== 0 && !taken;
      g.visible = visible;
      if (!visible) return;
      g.rotation.y = t * 1.1;
      g.position.y = g.userData.baseY + Math.sin(t * 2 + i) * 0.03;
    });
    if (this.boat) {
      this.boat.group.position.y = this.boat.baseY + Math.sin(t * 0.8) * 0.09;
      this.boat.group.rotation.z = Math.sin(t * 0.6) * 0.018;
      this.boat.group.rotation.x = Math.sin(t * 0.47) * 0.012;
      const fixed = (egg & EGG_BOAT) !== 0;
      this.boat.engine.visible = !fixed;
      this.boat.lamp.emissiveIntensity = fixed ? 2.4 : 0;
    }
    this.art?.setBeacon((egg & EGG_BEACON) !== 0);
  }

  /** La salida de la fuga: la lancha arranca hacia la ciudad. Devuelve dónde está, para la cámara. */
  sailBoat(dt: number): THREE.Vector3 | null {
    if (!this.boat) return null;
    const g = this.boat.group;
    g.position.z += dt * 7;
    g.rotation.y += (-Math.PI / 2 - g.rotation.y) * Math.min(1, dt * 0.5);
    return g.position;
  }

  /** Lo que ya se agarró desaparece. */
  updateEgg(egg: number, souls = 0, qs: readonly number[] = []): void {
    if (this.map?.quest) this.updateQuest(egg, this.map, qs);
    const bits = [2, 4, 8];
    // El gatillo recién aparece cuando el horno se llenó (bit 32).
    this.partMeshes.forEach((g, i) => (g.visible = (egg & (bits[i] ?? 0)) === 0 && (i !== 2 || (egg & 32) !== 0)));
    const t = performance.now() / 1000;
    for (const g of this.partMeshes) {
      if (!g.visible) continue;
      g.rotation.y = t * 1.2;
      g.position.y = g.userData.baseY + Math.sin(t * 2) * 0.04;
    }
    // El horno: la boca brilla más cuanto más lleno, y llama cuando ya escupió.
    if (this.furnaceMouth && this.furnaceLight) {
      const k = (egg & 32) !== 0 ? 1 : Math.min(1, souls / EGG_SOULS);
      const flicker = 0.85 + Math.sin(t * 17) * 0.08 + Math.sin(t * 31) * 0.07;
      (this.furnaceMouth.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + 2.4 * k * flicker;
      this.furnaceLight.intensity = (0.3 + 3.5 * k) * flicker;
    }
  }

  /** La boca del horno: una rejilla que brilla naranja en el frente de la segunda caldera. */
  private buildFurnace(map: GameMap): void {
    const f = map.furnace;
    const g = new THREE.Group();
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.9, 0.12),
      new THREE.MeshStandardMaterial(map.art ? { color: 0x120804, emissive: 0xffffff, emissiveMap: furnaceEmbers(), emissiveIntensity: 0.2, roughness: 0.9 } : { color: 0x331a08, emissive: 0xff6a1a, emissiveIntensity: 0.2, roughness: 0.6 }),
    );
    mouth.position.set(0, 1.0, 0);
    g.add(mouth);
    if (map.art) g.add(buildFurnaceFront(this.materials[30]!, this.materials[26]!));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.08), this.materials[26] ?? this.materials[TEX_METAL]!);
    frame.position.set(0, 1.0, 0.06);
    g.add(frame);
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), this.materials[26] ?? this.materials[TEX_METAL]!);
      bar.position.set(-0.45 + i * 0.3, 1.0, -0.06);
      g.add(bar);
    }
    const light = new THREE.PointLight(0xff7a2a, 0.3, this.art ? 9 : 7, 1.6);
    light.position.set(0, 1.0, -0.8);
    g.add(light);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture("El horno", "#ff9a5a", 256, 34), transparent: true, depthTest: true }));
    label.scale.set(1.2, 0.3, 1);
    label.position.set(0, 2.6, map.art ? -0.5 : 0);
    g.add(label);
    g.position.set(f.x, f.y ?? 0, f.z);
    g.rotation.y = f.yaw;
    this.propGroup.add(g);
    this.furnaceMouth = mouth;
    this.furnaceLight = light;
  }

  private buildLamps(map: GameMap): void {
    this.zoneLamps = [];
    for (const zn of map.zones) {
      const cx = (zn.minX + zn.maxX) / 2;
      const cz = (zn.minZ + zn.maxZ) / 2;
      const wide = zn.maxX - zn.minX > 16;
      const spots = wide ? [cx - 5, cx + 5] : [cx];
      for (const x of spots) {
        const lamp = new THREE.PointLight(0xff5a3a, 1.0, 18, 1.5);
        lamp.position.set(x, 4.0, cz);
        this.scene.add(lamp);
        this.zoneLamps.push(lamp);
        // La lámpara colgada.
        const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6 }));
        fixture.position.set(x, 4.3, cz);
        this.propGroup.add(fixture);
      }
    }
    this.setPower(false, true);
  }

  // ------------------------------------------------------------ actualizar con el estado

  setPower(on: boolean, force = false): void {
    if (on === this.powerOn && !force) return;
    this.powerOn = on;
    this.art?.setPower(on, force);
    for (const l of this.zoneLamps) {
      l.color.set(on ? 0xffe2b0 : 0xff5a3a);
      l.intensity = on ? 3.2 : 1.0;
    }
    for (const m of this.perkMachines) {
      (m.light.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.4 : 0.05;
      for (const e of m.extra ?? []) e.emissiveIntensity = on ? 1.9 : 0.04;
      if (m.lamp) m.lamp.intensity = on ? 1.4 : 0;
    }
    if (this.papMachine) {
      (this.papMachine.light.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.2 : 0;
      if (this.papMachine.lamp) this.papMachine.lamp.intensity = on ? 2 : 0;
      for (const b of this.papMachine.group.children) if (b.name === "bulb") ((b as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2.5 : 0;
    }
    if (this.powerLever) this.powerLever.rotation.x = on ? 0.9 : -0.9;
    this.scene.environmentIntensity = this.art ? (on ? 0.14 : 0.08) : on ? 0.3 : 0.18;
  }

  /** Quick Revive se prende siempre (anda sin luz). */
  lightQuickRevive(index: number): void {
    const m = this.perkMachines[index];
    if (!m) return;
    (m.light.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4;
    for (const e of m.extra ?? []) e.emissiveIntensity = 1.9;
    if (m.lamp) m.lamp.intensity = 1.2;
  }

  updateDoors(doorsOpen: number): void {
    this.doorMeshes.forEach((g, i) => (g.visible = (doorsOpen & (1 << i)) === 0));
  }

  updateBoards(boards: readonly number[]): void {
    this.boardMeshes.forEach((list, i) => {
      const n = boards[i] ?? 0;
      list.forEach((m, k) => (m.visible = k < n));
    });
  }

  updateRadios(radios: number, song: boolean): void {
    this.radioMeshes.forEach((g, i) => {
      const led = g.getObjectByName("led") as THREE.Mesh | undefined;
      if (led) (led.material as THREE.MeshStandardMaterial).emissiveIntensity = (radios & (1 << i)) !== 0 ? (song ? 2 + Math.sin(performance.now() / 120) : 1.5) : 0;
    });
  }

  updateBox(box: GameState["box"], map: GameMap, dt: number): void {
    if (!this.boxGroup || !this.boxLid) return;
    this.placeBox(map, box.spot);
    const open = box.phase === 1 || box.phase === 2;
    this.boxLid.rotation.x += ((open ? -1.6 : 0) - this.boxLid.rotation.x) * Math.min(1, dt * 8);
    if (this.boxBeam) (this.boxBeam.material as THREE.MeshBasicMaterial).opacity = box.phase === 3 ? 0.02 : 0.14 + Math.sin(performance.now() / 400) * 0.04;
    // El arma que gira mientras decide, y la que ofrece.
    if (box.phase === 1) {
      const idx = Math.floor((performance.now() / 110) % BOX_POOL.length);
      const wid = BOX_POOL[idx]!.id;
      if (wid !== this.boxWeaponId) this.showBoxWeapon(wid);
      if (this.boxWeapon) {
        const k = 1 - box.ticksLeft / BOX_SPIN_TICKS;
        this.boxWeapon.position.y = 0.6 + Math.min(1, k * 1.6) * 0.8;
        this.boxWeapon.rotation.y += dt * 6;
      }
    } else if (box.phase === 2) {
      if (box.weapon !== this.boxWeaponId) this.showBoxWeapon(box.weapon);
      if (this.boxWeapon) {
        this.boxWeapon.position.y = 1.35 + Math.sin(performance.now() / 350) * 0.04;
        this.boxWeapon.rotation.y += dt * 1.2;
      }
    } else if (this.boxWeapon) {
      this.boxGroup.remove(this.boxWeapon);
      this.boxWeapon = null;
      this.boxWeaponId = -99;
    }
    // El osito: sube y se va.
    if (box.phase === 3) {
      if (!this.boxTeddy) {
        this.boxTeddy = buildTeddy();
        this.boxGroup.add(this.boxTeddy);
      }
      this.boxTeddy.position.y += dt * 1.2;
      this.boxTeddy.rotation.y += dt * 2;
    } else if (this.boxTeddy) {
      this.boxGroup.remove(this.boxTeddy);
      this.boxTeddy = null;
    }
  }

  private showBoxWeapon(wid: number): void {
    if (this.boxWeapon) this.boxGroup!.remove(this.boxWeapon);
    this.boxWeapon = buildWeaponMesh(wid, false);
    this.boxWeapon.scale.setScalar(1.3);
    this.boxWeapon.position.set(0, 0.8, 0);
    this.boxWeapon.rotation.z = 0.2;
    this.boxGroup!.add(this.boxWeapon);
    this.boxWeaponId = wid;
  }

  updatePap(pap: GameState["pap"], dt: number): void {
    if (!this.papMachine) return;
    const g = this.papMachine.group;
    if (pap.phase === 0) {
      if (this.papWeapon) {
        g.remove(this.papWeapon);
        this.papWeapon = null;
      }
      return;
    }
    if (!this.papWeapon || this.papWeapon.userData.id !== pap.weapon || this.papWeapon.userData.phase !== pap.phase) {
      if (this.papWeapon) g.remove(this.papWeapon);
      this.papWeapon = buildWeaponMesh(pap.weapon, false, pap.phase === 2);
      this.papWeapon.userData.id = pap.weapon;
      this.papWeapon.userData.phase = pap.phase;
      this.papWeapon.scale.setScalar(1.3);
      this.papWeapon.position.set(0, 1.15, -0.75);
      this.papWeapon.rotation.y = Math.PI / 2;
      g.add(this.papWeapon);
    }
    if (pap.phase === 1) {
      // Entra en la máquina y gira.
      this.papWeapon.position.z += (0.2 - this.papWeapon.position.z) * Math.min(1, dt * 3);
      this.papWeapon.rotation.y += dt * 5;
    } else {
      this.papWeapon.position.z += (-0.75 - this.papWeapon.position.z) * Math.min(1, dt * 3);
      this.papWeapon.position.y = 1.15 + Math.sin(performance.now() / 350) * 0.03;
    }
  }

  updatePowerUps(list: readonly PowerUpState[], dt: number): void {
    const seen = new Set<number>();
    for (const pu of list) {
      seen.add(pu.id);
      let g = this.powerUpMeshes.get(pu.id);
      if (!g) {
        g = buildPowerUp(pu.kind, this.puffTex);
        this.powerUpMeshes.set(pu.id, g);
        this.powerUpGroup.add(g);
      }
      const t = performance.now() / 1000;
      g.position.set(pu.x, pu.y + 0.9 + Math.sin(t * 2 + pu.id) * 0.08, pu.z);
      g.rotation.y += dt * 1.5;
      // Se apaga parpadeando en los últimos segundos.
      g.visible = pu.ticksLeft > 100 || Math.floor(t * 6) % 2 === 0;
    }
    for (const [id, g] of this.powerUpMeshes) {
      if (seen.has(id)) continue;
      this.powerUpGroup.remove(g);
      this.powerUpMeshes.delete(id);
    }
  }

  updateGrenades(grenades: readonly UnpackedGrenade[], dt: number): void {
    const seen = new Set<number>();
    for (const g of grenades) {
      seen.add(g.id);
      let m = this.grenadeMeshes.get(g.id);
      if (!m) {
        m = buildGrenadeMesh();
        this.grenadeMeshes.set(g.id, m);
        this.grenadeGroup.add(m);
      }
      m.position.set(g.x, g.y, g.z);
      if (Math.hypot(g.vx, g.vy, g.vz) > 0.5) {
        m.rotation.x += dt * 9;
        m.rotation.z += dt * 5;
      }
    }
    for (const [id, m] of this.grenadeMeshes) {
      if (seen.has(id)) continue;
      this.grenadeGroup.remove(m);
      this.grenadeMeshes.delete(id);
    }
  }

  clearDynamic(): void {
    this.grenadeGroup.clear();
    this.grenadeMeshes.clear();
    this.powerUpGroup.clear();
    this.powerUpMeshes.clear();
  }

  get currentMap(): GameMap | null {
    return this.map;
  }
}

/** Un power-up: una esfera que brilla con el nombre encima. */
function buildPowerUp(kind: number, puff: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const colors = [0x4af0ff, 0xff4a4a, 0xffd04a, 0x8aff4a, 0xd0a060, 0xff8ad0];
  const c = colors[kind] ?? 0xffffff;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.3 }));
  g.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: c, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(1.3);
  g.add(halo);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(POWERUP_NAMES[kind] ?? "", "#ffffff", 320, 40), transparent: true, depthTest: false }));
  label.scale.set(1.4, 0.28, 1);
  label.position.y = 0.45;
  g.add(label);
  const light = new THREE.PointLight(c, 1.5, 5, 1.6);
  g.add(light);
  return g;
}

/** Una pieza de la Thunder Gun: el núcleo (esfera), la bobina (anillos) o el gatillo (una caja con palanca), con su brillo. */
function buildPart(kind: number, puff: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const c = 0x9ad0ff;
  const glow = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.4 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.4, metalness: 0.8 });
  if (kind === 0) {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), glow));
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.015, 8, 20), metal);
    cage.rotation.x = Math.PI / 2;
    g.add(cage);
  } else if (kind === 1) {
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 18), i % 2 ? glow : metal);
      ring.position.y = -0.12 + i * 0.08;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), metal));
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.22), metal);
    g.add(body);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), glow);
    lever.position.set(0, 0.1, -0.05);
    lever.rotation.x = 0.4;
    g.add(lever);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: c, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(0.9);
  g.add(halo);
  g.userData.baseY = 0;
  return g;
}

/** El osito de la caja. */
function buildTeddy(): THREE.Group {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), fur);
  body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), fur);
  head.position.y = 1.22;
  g.add(body, head);
  for (const x of [-0.12, 0.12]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), fur);
    ear.position.set(x, 1.36, 0);
    g.add(ear);
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), fur);
    arm.position.set(x * 2.2, 0.95, 0);
    g.add(arm);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    eye.position.set(x * 0.5, 1.25, -0.15);
    g.add(eye);
  }
  return g;
}

export { weaponStats };
