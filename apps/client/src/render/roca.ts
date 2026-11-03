import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { makeStainAtlas, stencil } from "./rocaProps.js";
import { LM_RANGE, ROCA_TEX, TEX_ALL, TEX_COUNT, lightmapLayout, raycastBoxes, segmentClear, type Box, type GameMap, type LmLayout, type MapArt, type MapLight } from "@wabzomb/shared";

/**
 * Lo que hace a La Roca verse como se ve: materiales PBR bajados de Poly Haven,
 * luz horneada en dos lightmaps (apagada y prendida), celdas y barrotes con
 * instancias, modelos, mar, ciudad a lo lejos, faro y lluvia. Todo lo que no sea
 * mapa de colisión vive acá. Los assets están en public/roca (ver CREDITOS.md).
 */

const BASE = `${import.meta.env.BASE_URL}roca/`;

/** Cuánta luz horneada les toca a las instancias: 0 apagada, 1 prendida; y el parpadeo. */
const probeUniforms = { uProbeMix: { value: 0 }, uProbeGain: { value: 1 } };

/**
 * Lo que no está en el lightmap (celdas, barrotes, barandas, modelos) lleva su luz
 * horneada por instancia: dos colores (apagada y prendida), con sombra incluida.
 */
function patchProbe(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }): void {
  shader.uniforms.uProbeMix = probeUniforms.uProbeMix;
  shader.uniforms.uProbeGain = probeUniforms.uProbeGain;
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
      attribute vec3 aLmOff;
      attribute vec3 aLmOn;
      uniform float uProbeMix;
      uniform float uProbeGain;
      varying vec3 vProbe;`,
    )
    .replace("#include <begin_vertex>", `#include <begin_vertex>
      vProbe = mix(aLmOff, aLmOn, uProbeMix) * uProbeGain;`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
      varying vec3 vProbe;`)
    .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += vProbe * diffuseColor.rgb;`);
}

/** Lo que se agrega a cada material: variación a gran escala, para que no se note que la textura se repite. */
function patchMaterial(m: THREE.MeshStandardMaterial, opts: { wainscot?: boolean; damp?: number; desat?: number; probe?: boolean } = {}): void {
  m.onBeforeCompile = (shader) => {
    if (opts.probe) patchProbe(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        vWPos = (modelMatrix * wp4).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWPos;
        float rocaHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rocaNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rocaHash(i), rocaHash(i + vec2(1.0, 0.0)), f.x), mix(rocaHash(i + vec2(0.0, 1.0)), rocaHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float rocaFbm(vec2 p) { return rocaNoise(p) * 0.6 + rocaNoise(p * 2.3 + 7.1) * 0.3 + rocaNoise(p * 5.1 + 3.3) * 0.1; }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec2 macroUv = vWPos.xz * 0.21 + vWPos.y * vec2(0.17, 0.11);
          float macro = rocaFbm(macroUv);
          diffuseColor.rgb *= mix(0.8, 1.12, macro);
          ${opts.desat ? `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1))), ${opts.desat.toFixed(2)});` : ""}
          ${
            opts.wainscot
              ? `// La pintura de las paredes de la prisión: verde pálido hasta la cintura, crema arriba, con una línea oscura.
          float y = vWPos.y;
          float below = 1.0 - smoothstep(1.38, 1.4, y);
          float groundLevel = 1.0 - step(5.0, y) * 1.0;
          below *= step(-0.1, y) * groundLevel;
          vec3 tone = mix(vec3(0.9, 0.88, 0.82), vec3(0.6, 0.72, 0.66), below);
          diffuseColor.rgb *= tone;
          float line = (smoothstep(1.38, 1.4, y) - smoothstep(1.46, 1.48, y)) * groundLevel;
          diffuseColor.rgb *= 1.0 - line * 0.55;
          // Chorreaduras: el agua de los tragaluces baja por las paredes.
          float streak = rocaNoise(vec2((vWPos.x + vWPos.z) * 2.4, y * 0.12));
          diffuseColor.rgb *= mix(1.0, 0.72, smoothstep(0.62, 0.92, streak) * smoothstep(0.0, 6.0, y));
          // Mugre a ras del piso.
          diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 0.55, y));`
              : ""
          }
          ${opts.damp ? `diffuseColor.rgb *= mix(1.0, ${opts.damp.toFixed(2)}, smoothstep(0.55, 0.9, rocaFbm(vWPos.xz * 0.6 + vWPos.y)));` : ""}
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        // Charcos y piso gastado: más brillante donde el ruido baja.
        if (vNormal.y > 0.5 || (vViewPosition.y < 1e9 && false)) roughnessFactor *= mix(0.55, 1.05, rocaFbm(vWPos.xz * 0.35));`,
      );
  };
  m.customProgramCacheKey = () => `roca-${opts.wainscot ? 1 : 0}-${opts.damp ?? 0}-${opts.desat ?? 0}-${opts.probe ? 1 : 0}`;
}

/** Los materiales de cada TEX_R_*: arrancan con un color parejo y les llegan las imágenes cuando bajan. */
export function makeRocaMaterials(manager: THREE.LoadingManager): THREE.MeshStandardMaterial[] {
  const loader = new THREE.TextureLoader(manager);
  const load = (url: string, srgb: boolean, metres: number): THREE.Texture => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.repeat.set(1 / metres, 1 / metres);
    return t;
  };
  const out: THREE.MeshStandardMaterial[] = [];
  ROCA_TEX.forEach((tex, i) => {
    const arm = load(`${BASE}tex/${tex.name}_r.webp`, false, tex.metres);
    const m = new THREE.MeshStandardMaterial({
      map: load(`${BASE}tex/${tex.name}_c.webp`, true, tex.metres),
      normalMap: load(`${BASE}tex/${tex.name}_n.webp`, false, tex.metres),
      roughnessMap: arm,
      metalnessMap: arm,
      roughness: 1,
      // Con metal puro la luz horneada no se vería (el metal no tiene color difuso): queda mitad y mitad.
      metalness: tex.metal ? 0.45 : 0,
      envMapIntensity: tex.metal ? 0.8 : 0.25,
    });
    m.normalScale.set(0.9, 0.9);
    if (tex.name === "floordark") m.color.setScalar(1.7);
    if (tex.name === "floorbad") m.color.setScalar(1.4);
    if (tex.name === "steel") m.color.setScalar(1.5);
    if (tex.name === "wallgreen") m.color.set(0xb4c8ba);
    patchMaterial(m, {
      wainscot: tex.name === "wall",
      damp: tex.name === "stone" || tex.name === "raw" ? 0.7 : tex.name === "floor" ? 0.82 : undefined,
      desat: tex.name === "wallgreen" ? 0.72 : tex.name === "raw" ? 0.55 : tex.name === "wall" ? 0.4 : tex.name === "brick" ? 0.3 : undefined,
    });
    out[TEX_COUNT + i] = m;
  });
  return out;
}

/** Una caja del mapa: UV en metros para la textura, y el rincón que le toca en el lightmap. */
function boxGeometryLm(b: Box, rects: LmLayout["faces"][number], size: number): THREE.BufferGeometry {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const d = b.maxZ - b.minZ;
  if (b.shape === "cyl") {
    const r = Math.min(w, d) / 2;
    const g = new THREE.CylinderGeometry(r, r, h, 20, 1);
    g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const nor = g.getAttribute("normal") as THREE.BufferAttribute;
    const uv1 = new Float32Array(uv.count * 2);
    const side = rects[0];
    const cap = rects[2];
    for (let i = 0; i < uv.count; i++) {
      const isCap = Math.abs(nor.getY(i)) > 0.5;
      const rect = isCap ? cap : side;
      if (rect) {
        const u = isCap ? (pos.getX(i) - b.minX) / w : uv.getX(i);
        const v = isCap ? (pos.getZ(i) - b.minZ) / d : uv.getY(i);
        uv1[i * 2] = (rect.x + 0.5 + u * (rect.w - 1)) / size;
        uv1[i * 2 + 1] = (rect.y + 0.5 + v * (rect.h - 1)) / size;
      }
      uv.setXY(i, isCap ? pos.getX(i) : uv.getX(i) * Math.PI * 2 * r, isCap ? pos.getZ(i) : uv.getY(i) * h);
    }
    g.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
    return g;
  }
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2 + (b.decal ? 0.004 : 0), (b.minZ + b.maxZ) / 2);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const uv1 = new Float32Array(uv.count * 2);
  const scales: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const offsets: [number, number][] = [[b.minZ, b.minY], [b.minZ, b.minY], [b.minX, b.minZ], [b.minX, b.minZ], [b.minX, b.minY], [b.minX, b.minY]];
  for (let face = 0; face < 6; face++) {
    const rect = rects[face];
    const [su, sv] = scales[face]!;
    const [ou, ov] = offsets[face]!;
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      const tu = uv.getX(i);
      const tv = uv.getY(i);
      if (rect) {
        uv1[i * 2] = (rect.x + 0.5 + tu * (rect.w - 1)) / size;
        uv1[i * 2 + 1] = (rect.y + 0.5 + tv * (rect.h - 1)) / size;
      }
      uv.setXY(i, tu * su + ou, tv * sv + ov);
    }
  }
  g.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
  return g;
}

/** Junta cajas de colores en una sola geometría. */
function shaded(geos: { w: number; h: number; d: number; x: number; y: number; z: number; shade: number }[]): THREE.BufferGeometry {
  const parts = geos.map((g) => {
    const b = new THREE.BoxGeometry(g.w, g.h, g.d);
    b.translate(g.x, g.y, g.z);
    const colors = new Float32Array(b.getAttribute("position").count * 3).fill(g.shade);
    b.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    // UV en metros, aproximados: la pared de una celda no se mira de cerca.
    const uv = b.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(g.w, g.d) * 0.4, uv.getY(i) * g.h * 0.4);
    return b;
  });
  return mergeGeometries(parts, false)!;
}

interface PoolLight {
  light: THREE.PointLight;
  /** Qué luz del mapa muestra, y a cuánto va. */
  source: MapLight | null;
  target: number;
}

/** Los colores horneados de un juego de instancias. */
class Probes {
  private readonly off: Float32Array;
  private readonly on: Float32Array;
  constructor(count: number) {
    this.off = new Float32Array(count * 3);
    this.on = new Float32Array(count * 3);
  }
  set(i: number, v: { off: number[]; on: number[] }): void {
    this.off.set(v.off, i * 3);
    this.on.set(v.on, i * 3);
  }
  attach(g: THREE.BufferGeometry): void {
    g.setAttribute("aLmOff", new THREE.InstancedBufferAttribute(this.off, 3));
    g.setAttribute("aLmOn", new THREE.InstancedBufferAttribute(this.on, 3));
  }
}

const POOL = 6;
const DOCK_LEVEL = -8;
const BLOCK_END_W = -24;
const BLOCK_END_E = 24;
const HALO_CANVAS_SIZE = 128;

export class RocaArt {
  readonly group = new THREE.Group();
  private art: MapArt;
  private map: GameMap;
  private mapMaterials: THREE.MeshStandardMaterial[] = [];
  private lmOn: THREE.Texture | null = null;
  private lmOff: THREE.Texture | null = null;
  private powered = false;
  private flicker = 0;
  private pool: PoolLight[] = [];
  private fill: THREE.PointLight | null = null;
  private mist: { sprite: THREE.Sprite; x: number; z: number; phase: number }[] = [];
  private lit: { material: THREE.MeshStandardMaterial; off: number[]; on: number[] }[] = [];
  private poolCheck = 0;
  private halos: { sprite: THREE.Sprite; light: MapLight; base: number; flick: number }[] = [];
  private fixtureMats: { mesh: THREE.Object3D; light: MapLight }[] = [];
  private beam: THREE.Group | null = null;
  private lantern: THREE.MeshBasicMaterial | null = null;
  private readonly beamArms: { arm: THREE.Group; sheet: THREE.Mesh }[] = [];
  private readonly camLocal = new THREE.Vector3();
  private sea: THREE.ShaderMaterial | null = null;
  private skyMat: THREE.ShaderMaterial | null = null;
  private dust: THREE.Points | null = null;
  private rain: THREE.LineSegments | null = null;
  private shafts: THREE.ShaderMaterial | null = null;
  private lightning = 0;
  private nextLightning = 12;
  private time = 0;
  private readonly occluders: Box[];
  private modelLoader!: GLTFLoader;
  private readonly fog: THREE.FogExp2;
  /** Se llama con un número de 0 a 1 mientras bajan los assets. */
  onProgress: ((k: number) => void) | null = null;
  /** Para el sonido del trueno. */
  onThunder: ((delay: number) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    map: GameMap,
    private readonly hemi: THREE.HemisphereLight,
    private readonly moon: THREE.DirectionalLight,
    private readonly materials: THREE.Material[],
  ) {
    this.map = map;
    this.art = map.art!;
    this.occluders = map.boxes.filter((b) => !b.thin && !b.clip && !b.decal);
    this.fog = new THREE.FogExp2(0x1a222c, 0.0105);
    scene.fog = this.fog;
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, done, total) => this.onProgress?.(done / total);
    const made = makeRocaMaterials(manager);
    for (let i = TEX_COUNT; i < TEX_ALL; i++) materials[i] = made[i]!;
    this.buildMapMesh(manager);
    this.buildCells(manager);
    this.buildRails();
    this.buildWindows();
    this.buildRamps();
    this.buildSkylights();
    this.buildIsland();
    this.buildSky();
    this.buildSea();
    this.buildBay();
    this.buildLighthouse();
    this.buildParticles();
    this.buildPool();
    this.buildModels(manager);
    this.buildHalos();
    this.buildDressing();
    scene.add(this.group);
    hemi.intensity = 0.34;
    hemi.color.set(0x8fa6c8);
    hemi.groundColor.set(0x3a3430);
    moon.intensity = 0.3;
    moon.castShadow = false;
    moon.position.set(-42, 78, -46);
    this.applyPower(false);
  }

  /** Cuánta luz llega a un punto: apagada y prendida. Lo mismo que hornea tools/bake.ts, sin rebotes (se los aproxima). */
  private sample(x: number, y: number, z: number, nx = 0, ny = 1, nz = 0): { off: number[]; on: number[] } {
    const off = [0.05, 0.058, 0.08];
    const on = [0.05, 0.058, 0.08];
    for (const l of this.art.lights) {
      const dx = l.x - x;
      const dy = l.y - y;
      const dz = l.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > l.range * l.range) continue;
      if (!segmentClear(x, y, z, l.x, l.y - 0.2, l.z, this.occluders)) continue;
      const d = Math.sqrt(d2);
      const fall = 1 - Math.pow(d / l.range, 4);
      // Medio lambert: lo que no recibe de frente igual se ve por el rebote.
      const wrap = 0.55 + 0.45 * ((nx * dx + ny * dy + nz * dz) / (d || 1));
      const e = (l.power / (d2 + 1)) * fall * fall * Math.max(0.1, wrap);
      const c = new THREE.Color(l.color);
      for (const [i, v] of [c.r, c.g, c.b].entries()) {
        if (l.when !== "grid") off[i]! += e * v;
        if (l.when !== "off") on[i]! += e * v;
      }
    }
    // El rebote: una parte de lo directo vuelve de todos lados. Y una curva suave, para que
    // lo que está pegado a una lámpara no se queme.
    for (let i = 0; i < 3; i++) {
      off[i] = (off[i]! * 1.25) / (1 + off[i]! * 1.3);
      on[i] = (on[i]! * 1.25) / (1 + on[i]! * 1.3);
    }
    return { off, on };
  }

  /**
   * Lo que tiene estado (puertas, tablas, la caja) no lleva lightmap: se lo ilumina con la
   * luz horneada de donde está, como emisivo multiplicado por su propia textura.
   */
  bakeLight(root: THREE.Object3D, x: number, y: number, z: number, nx = 0, ny = 1, nz = 0): void {
    const probe = this.sample(x, y, z, nx, ny, nz);
    const clones = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material): THREE.Material => {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial || std.emissive.getHex() !== 0) return m;
        let c = clones.get(m);
        if (!c) {
          c = std.clone();
          c.onBeforeCompile = std.onBeforeCompile;
          c.customProgramCacheKey = std.customProgramCacheKey;
          if (std.map) c.emissiveMap = std.map;
          c.emissive.copy(std.map ? new THREE.Color(0xffffff) : std.color);
          clones.set(m, c);
          this.lit.push({ material: c, off: probe.off, on: probe.on });
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    this.refreshLit();
  }

  private refreshLit(): void {
    for (const l of this.lit) {
      const v = this.powered ? l.on : l.off;
      // El emisivo es parejo por canal; el color de la luz va en la mezcla de los tres.
      const k = (v[0]! + v[1]! + v[2]!) / 3;
      l.material.emissiveIntensity = k * 0.42;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const p of this.pool) this.scene.remove(p.light);
    if (this.fill) this.scene.remove(this.fill);
  }

  // ------------------------------------------------------------ el mapa con su luz horneada

  private buildMapMesh(manager: THREE.LoadingManager): void {
    const layout = lightmapLayout(this.map);
    const byTex = new Map<number, THREE.BufferGeometry[]>();
    this.map.boxes.forEach((b, i) => {
      if (b.hidden) return;
      const list = byTex.get(b.tex) ?? [];
      list.push(boxGeometryLm(b, layout.faces[i]!, layout.size));
      byTex.set(b.tex, list);
    });
    const loader = new THREE.TextureLoader(manager);
    const lm = (url: string, onLoad: () => void): THREE.Texture => {
      const t = loader.load(url, onLoad);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.channel = 1;
      return t;
    };
    this.lmOff = lm(`${BASE}lightmap_off.webp`, () => this.applyPower(this.powered));
    this.lmOn = lm(`${BASE}lightmap_on.webp`, () => this.applyPower(this.powered));
    for (const [tex, list] of byTex) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const base = this.materials[tex] as THREE.MeshStandardMaterial;
      const mat = base.clone();
      mat.onBeforeCompile = base.onBeforeCompile;
      mat.customProgramCacheKey = base.customProgramCacheKey;
      mat.lightMap = this.lmOff;
      mat.lightMapIntensity = LM_RANGE * Math.PI;
      this.mapMaterials.push(mat);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      this.group.add(mesh);
    }
  }

  // ------------------------------------------------------------ las celdas

  private buildCells(manager: THREE.LoadingManager): void {
    const rows = this.art.cells;
    if (rows.length === 0) return;
    const r0 = rows[0]!;
    const W = r0.pitch;
    const D = r0.depth;
    const H = r0.tierH;
    // Una celda con su fondo hacia +Z, origen en el centro del frente al nivel del piso.
    // Lo de adentro va más oscuro cuanto más al fondo: no hay luz horneada en las instancias.
    const shell = shaded([
      { w: W, h: 0.06, d: D, x: 0, y: 0.02, z: D / 2, shade: 0.42 },
      { w: W, h: 0.1, d: D, x: 0, y: H - 0.1, z: D / 2, shade: 0.16 },
      { w: W, h: H, d: 0.08, x: 0, y: H / 2, z: D, shade: 0.2 },
      { w: 0.1, h: H, d: D, x: -W / 2, y: H / 2, z: D / 2, shade: 0.3 },
      { w: 0.1, h: H, d: D, x: W / 2, y: H / 2, z: D / 2, shade: 0.3 },
      // La cucheta, la mesita y el inodoro.
      { w: 0.72, h: 0.08, d: 1.85, x: -W / 2 + 0.42, y: 0.5, z: D - 1.05, shade: 0.5 },
      { w: 0.72, h: 0.14, d: 1.75, x: -W / 2 + 0.42, y: 0.58, z: D - 1.05, shade: 0.72 },
      { w: 0.06, h: 0.5, d: 0.06, x: -W / 2 + 0.74, y: 0.25, z: D - 0.2, shade: 0.34 },
      { w: 0.06, h: 0.5, d: 0.06, x: -W / 2 + 0.74, y: 0.25, z: D - 1.9, shade: 0.34 },
      { w: 0.5, h: 0.05, d: 0.3, x: W / 2 - 0.3, y: 0.82, z: 0.9, shade: 0.42 },
      { w: 0.36, h: 0.2, d: 0.3, x: W / 2 - 0.25, y: 0.72, z: D - 0.2, shade: 0.56 },
      { w: 0.3, h: 0.36, d: 0.4, x: W / 2 - 0.25, y: 0.18, z: D - 0.32, shade: 0.5 },
    ]);
    const loader = new THREE.TextureLoader(manager);
    const wallTex = loader.load(`${BASE}tex/wallgreen_c.webp`);
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.colorSpace = THREE.SRGBColorSpace;
    const cellMat = new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.05 });
    patchMaterial(cellMat, { probe: true, desat: 0.7 });
    // Barrotes: una fila vertical, travesaños, marco y cerradura.
    const barMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.5, metalness: 0.4, envMapIntensity: 1.1 });
    patchMaterial(barMat, { probe: true });
    const barParts: THREE.BufferGeometry[] = [];
    const barH = H - 0.2;
    for (let i = 0; i < 10; i++) {
      const b = new THREE.CylinderGeometry(0.014, 0.014, barH, 6, 1, true);
      b.translate(-W / 2 + 0.12 + i * ((W - 0.24) / 9), barH / 2 + 0.03, 0);
      barParts.push(b);
    }
    const hbar = (y: number, h = 0.05): THREE.BufferGeometry => {
      const b = new THREE.BoxGeometry(W - 0.12, h, 0.03);
      b.translate(0, y, 0);
      return b;
    };
    barParts.push(hbar(0.08), hbar(1.0), hbar(barH), hbar(barH - 0.7));
    const post = (x: number): THREE.BufferGeometry => {
      const b = new THREE.BoxGeometry(0.1, H, 0.12);
      b.translate(x, H / 2, 0);
      return b;
    };
    barParts.push(post(-W / 2), post(W / 2));
    const lock = new THREE.BoxGeometry(0.16, 0.26, 0.07);
    lock.translate(W / 2 - 0.22, 1.1, 0);
    barParts.push(lock);
    const lintel = new THREE.BoxGeometry(W, 0.22, 0.16);
    lintel.translate(0, H - 0.1, 0);
    barParts.push(lintel);
    const bars = mergeGeometries(barParts.map((g) => g.toNonIndexed()), false)!;
    // La puerta maciza del aislamiento: chapa con una mirilla.
    const plate = new THREE.BoxGeometry(W - 0.08, H - 0.15, 0.06);
    plate.translate(0, (H - 0.15) / 2, 0);
    const solidFront = mergeGeometries([plate.toNonIndexed(), post(-W / 2).toNonIndexed(), post(W / 2).toNonIndexed(), lintel.toNonIndexed()], false)!;

    let shells = 0;
    let fronts = 0;
    let solids = 0;
    for (const r of rows) {
      shells += r.count * r.tiers;
      for (let t = 0; t < r.tiers; t++) for (let i = 0; i < r.count; i++) if (!r.noFront.includes(`${t}:${i}`)) { if (r.solid) solids++; else fronts++; }
    }
    const shellMesh = new THREE.InstancedMesh(shell, cellMat, shells);
    const frontMesh = new THREE.InstancedMesh(bars, barMat, fronts);
    const solidMesh = new THREE.InstancedMesh(solidFront, barMat, Math.max(1, solids));
    const probes = { shell: new Probes(shells), front: new Probes(fronts), solid: new Probes(Math.max(1, solids)) };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    let a = 0;
    let b = 0;
    let c = 0;
    const tint = new THREE.Color();
    for (const r of rows) {
      q.setFromAxisAngle(up, r.dir > 0 ? 0 : Math.PI);
      for (let t = 0; t < r.tiers; t++) {
        for (let i = 0; i < r.count; i++) {
          pos.set(r.x0 + r.pitch * (i + 0.5), t * r.tierH, r.z);
          m.compose(pos, q, one);
          shellMesh.setMatrixAt(a, m);
          // La luz que le llega al frente de la celda, un poco del lado del pasillo.
          const probe = this.sample(pos.x, pos.y + 1.2, pos.z - r.dir * 0.3, 0, 0, -r.dir);
          probes.shell.set(a, probe);
          // Cada celda un poco distinta.
          const v = 0.8 + ((i * 7 + t * 13 + Math.floor(r.z)) % 5) * 0.09;
          shellMesh.setColorAt(a, tint.setScalar(v));
          a++;
          if (r.noFront.includes(`${t}:${i}`)) continue;
          if (r.solid) {
            probes.solid.set(c, probe);
            solidMesh.setMatrixAt(c++, m);
          } else {
            probes.front.set(b, probe);
            frontMesh.setMatrixAt(b++, m);
          }
        }
      }
    }
    probes.shell.attach(shell);
    probes.front.attach(bars);
    probes.solid.attach(solidFront);
    shellMesh.frustumCulled = false;
    frontMesh.frustumCulled = false;
    solidMesh.frustumCulled = false;
    this.group.add(shellMesh, frontMesh, solidMesh);
  }

  // ------------------------------------------------------------ barandas, ventanas, rampas, tragaluces

  private buildRails(): void {
    const rails = this.art.rails;
    const steel = new THREE.MeshStandardMaterial({ color: 0x6f7a72, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.7 });
    patchMaterial(steel, { probe: true });
    const unit = new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1, true);
    const posts: THREE.Matrix4[] = [];
    const light: { off: number[]; on: number[] }[] = [];
    let current = { off: [0, 0, 0], on: [0, 0, 0] };
    const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dy, dz);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
      posts.push(new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, new THREE.Vector3(1, len, 1)));
      light.push(current);
    };
    for (const r of rails) {
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      if (len < 0.2) continue;
      current = this.sample((r.x0 + r.x1) / 2, r.y + 1, (r.z0 + r.z1) / 2);
      add(r.x0, r.y + 1.05, r.z0, r.x1, r.y + 1.05, r.z1);
      add(r.x0, r.y + 0.55, r.z0, r.x1, r.y + 0.55, r.z1);
      const n = Math.max(1, Math.round(len / 1.3));
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const x = r.x0 + (r.x1 - r.x0) * k;
        const z = r.z0 + (r.z1 - r.z0) * k;
        add(x, r.y, z, x, r.y + 1.05, z);
      }
    }
    const mesh = new THREE.InstancedMesh(unit, steel, posts.length);
    posts.forEach((m, i) => mesh.setMatrixAt(i, m));
    const probes = new Probes(posts.length);
    light.forEach((l, i) => probes.set(i, l));
    probes.attach(unit);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private buildWindows(): void {
    const steel = this.materials[TEX_COUNT + ROCA_TEX.findIndex((t) => t.name === "steel")] as THREE.MeshStandardMaterial;
    const barGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6, 1, true);
    const horizontal = new THREE.BoxGeometry(1, 0.04, 0.04);
    const verticals: THREE.Matrix4[] = [];
    const horizontals: THREE.Matrix4[] = [];
    const glass = new THREE.MeshBasicMaterial({ color: 0x6a86a8, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const w of this.art.windows) {
      const dx = w.maxX - w.minX;
      const dz = w.maxZ - w.minZ;
      const h = w.maxY - w.minY;
      const alongX = dx > dz;
      const len = alongX ? dx : dz;
      const cx = (w.minX + w.maxX) / 2;
      const cz = (w.minZ + w.maxZ) / 2;
      const cy = (w.minY + w.maxY) / 2;
      const n = Math.max(2, Math.round(len / 0.24));
      for (let i = 0; i <= n; i++) {
        const k = (i / n - 0.5) * len;
        verticals.push(new THREE.Matrix4().compose(new THREE.Vector3(cx + (alongX ? k : 0), cy, cz + (alongX ? 0 : k)), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
      }
      const rows = Math.max(2, Math.round(h / 0.8));
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? 0 : Math.PI / 2);
      for (let i = 0; i <= rows; i++) horizontals.push(new THREE.Matrix4().compose(new THREE.Vector3(cx, w.minY + (i / rows) * h, cz), q, new THREE.Vector3(len, 1, 1)));
      if (w.tex !== TEX_COUNT + ROCA_TEX.findIndex((t) => t.name === "rust")) {
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, h), glass);
        pane.position.set(cx, cy, cz);
        if (!alongX) pane.rotation.y = Math.PI / 2;
        this.group.add(pane);
      }
    }
    const vm = new THREE.InstancedMesh(barGeo, steel, verticals.length);
    verticals.forEach((m, i) => vm.setMatrixAt(i, m));
    const hm = new THREE.InstancedMesh(horizontal, steel, horizontals.length);
    horizontals.forEach((m, i) => hm.setMatrixAt(i, m));
    vm.frustumCulled = hm.frustumCulled = false;
    this.group.add(vm, hm);
  }

  private buildRamps(): void {
    for (const r of this.art.ramps) {
      const dx = r.x1 - r.x0;
      const dz = r.z1 - r.z0;
      const dy = r.y1 - r.y0;
      const len = Math.hypot(dx, dz);
      const nx = (-dz / len) * (r.width / 2);
      const nz = (dx / len) * (r.width / 2);
      const g = new THREE.BufferGeometry();
      const lift = 0.03;
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [r.x0 + nx, r.y0 + lift, r.z0 + nz, r.x0 - nx, r.y0 + lift, r.z0 - nz, r.x1 + nx, r.y1 + lift, r.z1 + nz, r.x1 - nx, r.y1 + lift, r.z1 - nz],
          3,
        ),
      );
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, r.width, 0, 0, Math.hypot(len, dy), r.width, Math.hypot(len, dy)], 2));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      g.computeVertexNormals();
      const mat = this.materials[r.tex] as THREE.MeshStandardMaterial;
      const mesh = new THREE.Mesh(g, mat);
      (mesh.material as THREE.Material).side = THREE.DoubleSide;
      this.group.add(mesh);
    }
  }

  /** El vidrio de los tragaluces y los rayos de luna que entran por ahí. */
  private buildSkylights(): void {
    const glass = new THREE.MeshBasicMaterial({ color: 0x9fb8d8, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    const steel = this.materials[TEX_COUNT + ROCA_TEX.findIndex((t) => t.name === "steel")] as THREE.MeshStandardMaterial;
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 0.35 } },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform float uPower;
        varying vec2 vUv;
        varying vec3 vW;
        float h(float x) { return fract(sin(x * 91.17) * 43758.5); }
        void main() {
          // Más fuerte arriba, y se apaga antes de tocar el piso; bandas de polvo que se mueven.
          float fade = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
          float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
          float bands = 0.7 + 0.3 * sin(vW.x * 1.3 + vW.z * 0.9 + uTime * 0.12) * sin(vW.y * 0.8 - uTime * 0.09);
          gl_FragColor = vec4(vec3(0.52, 0.66, 0.9) * fade * edge * bands * uPower * 0.09, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shafts = shaftMat;
    const shaftGeo = new THREE.PlaneGeometry(1, 1);
    const matrices: THREE.Matrix4[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const lean = new THREE.Vector3(0.42, -0.78, 0.46).normalize();
    for (const s of this.art.skylights) {
      const w = s.maxX - s.minX;
      const d = s.maxZ - s.minZ;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), glass);
      pane.rotation.x = -Math.PI / 2;
      pane.position.set((s.minX + s.maxX) / 2, s.y, (s.minZ + s.maxZ) / 2);
      this.group.add(pane);
      const n = Math.round(w / 2);
      for (let i = 0; i <= n; i++) {
        const mull = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, d), steel);
        mull.position.set(s.minX + (i / n) * w, s.y, (s.minZ + s.maxZ) / 2);
        this.group.add(mull);
      }
      // Los rayos: láminas inclinadas bajando del tragaluz.
      const length = 10.4;
      for (let x = s.minX + 1.5; x < s.maxX - 1; x += 3) {
        for (const offset of [-0.5, 0.5]) {
          const c = new THREE.Vector3(x, s.y, (s.minZ + s.maxZ) / 2 + offset).addScaledVector(lean, length / 2);
          const q = new THREE.Quaternion().setFromUnitVectors(up, lean.clone().negate());
          // Se tuerce un poco cada lámina, para que no se note el truco desde ningún ángulo.
          q.multiply(new THREE.Quaternion().setFromAxisAngle(up, (x * 0.7 + offset) * 0.9));
          matrices.push(new THREE.Matrix4().compose(c, q, new THREE.Vector3(2.4, length, 1)));
        }
      }
    }
    const shafts = new THREE.InstancedMesh(shaftGeo, shaftMat, matrices.length);
    matrices.forEach((m, i) => shafts.setMatrixAt(i, m));
    shafts.frustumCulled = false;
    shafts.renderOrder = 5;
    this.group.add(shafts);
  }

  // ------------------------------------------------------------ afuera: la isla, el mar, la bahía

  /** El terreno alrededor de la meseta: baja en rocas hasta el mar. */
  private buildIsland(): void {
    const rock = this.materials[TEX_COUNT + ROCA_TEX.findIndex((t) => t.name === "rock")] as THREE.MeshStandardMaterial;
    const size = 340;
    const n = 170;
    const g = new THREE.PlaneGeometry(size, size, n, n);
    g.rotateX(-Math.PI / 2);
    g.translate(-10, 0, 26);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const noise = (x: number, z: number) =>
      Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.13 - 0.6) * 0.5 + Math.sin(x * 0.27 + z * 0.19) * 0.28 + Math.sin(x * 0.61 - z * 0.47 + 2.1) * 0.14 + Math.sin(x * 1.3 + z * 1.1) * 0.06;
    /** Distancia a un rectángulo (0 adentro). */
    const dist = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Por encima de la meseta y del muelle no hay terreno: se esconde bajo el agua.
      const onIsland = dist(x, z, -95, -45, 75, 46) + dist(x, z, -95, 46, -31, 58) * 0;
      const dIsland = Math.min(dist(x, z, -95, -45, 75, 46), dist(x, z, -95, 46, -31, 58));
      const dDock = Math.min(dist(x, z, -1, 46, 60, 72), dist(x, z, 18, 72, 32, 92));
      void onIsland;
      let y: number;
      if (dIsland <= 0.01 || dDock <= 0.01) {
        y = -20;
      } else {
        const curve = (d: number, top: number) => {
          const k = Math.min(1, Math.max(0, (d + noise(x * 0.8, z * 0.8) * 5) / 30));
          return top - k * k * (3 - 2 * k) * (top + 16);
        };
        // La barranca: cae hasta el mar desde la meseta, y más bajo al lado del muelle.
        y = Math.min(curve(dIsland, -0.8), dDock < 26 ? -9.5 - dDock * 0.25 : 99) + noise(x, z) * 1.6;
      }
      pos.setY(i, y);
      uv.setXY(i, x, z);
      const shade = 0.72 + noise(x * 2.1, z * 2.1) * 0.26;
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade * 0.96;
      colors[i * 3 + 2] = shade * 0.9;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const mat = rock.clone();
    mat.vertexColors = true;
    mat.onBeforeCompile = rock.onBeforeCompile;
    mat.customProgramCacheKey = () => "roca-terrain";
    this.group.add(new THREE.Mesh(g, mat));
  }

  /** Un cielo cubierto: nubes bajas que se mueven, con la luna atrás. */
  private buildSky(): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFog: { value: this.fog.color }, uFlash: { value: 0 }, uMoon: { value: new THREE.Vector3(-0.42, 0.78, -0.46).normalize() } },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uFog;
        uniform float uFlash;
        uniform vec3 uMoon;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float a = 0.5;
          float s = 0.0;
          for (int i = 0; i < 5; i++) {
            s += noise(p) * a;
            p = p * 2.03 + 11.3;
            a *= 0.5;
          }
          return s;
        }
        void main() {
          vec3 d = normalize(vDir);
          float up = max(d.y, 0.0);
          vec2 uv = d.xz / (up + 0.18) * 1.1;
          float clouds = fbm(uv + vec2(uTime * 0.006, uTime * 0.003));
          float m = max(dot(d, uMoon), 0.0);
          // La luna se adivina atrás de las nubes.
          float glow = pow(m, 26.0) * 0.5 + pow(m, 220.0) * 1.1;
          float thin = smoothstep(0.34, 0.72, clouds);
          vec3 col = mix(vec3(0.018, 0.026, 0.04), vec3(0.075, 0.095, 0.13), thin);
          col += vec3(0.5, 0.6, 0.8) * glow * (1.0 - thin * 0.7);
          col += vec3(0.75, 0.82, 1.0) * uFlash * (0.25 + thin);
          // Abajo, todo se funde con la niebla.
          float horizon = smoothstep(0.26, 0.0, d.y);
          col = mix(col, uFog, horizon);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.skyMat = mat;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 14), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -2;
    this.group.add(sky);
  }

  private buildSea(): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFog: { value: this.fog.color },
        uMoon: { value: new THREE.Vector3(-0.42, 0.78, -0.46).normalize() },
        uCam: { value: new THREE.Vector3() },
      },
      vertexShader: `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uFog;
        uniform vec3 uMoon;
        uniform vec3 uCam;
        varying vec3 vW;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float waves(vec2 p) {
          float t = uTime * 0.35;
          return noise(p * 0.18 + vec2(t, t * 0.6)) * 0.55 + noise(p * 0.5 - vec2(t * 1.3, -t)) * 0.3 + noise(p * 1.4 + vec2(-t * 2.0, t * 1.4)) * 0.15;
        }
        void main() {
          vec2 p = vW.xz;
          float e = 0.35;
          float h = waves(p);
          vec3 n = normalize(vec3(h - waves(p + vec2(e, 0.0)), 0.16, h - waves(p + vec2(0.0, e))));
          vec3 v = normalize(uCam - vW);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
          vec3 r = reflect(-v, n);
          float spec = pow(max(dot(r, uMoon), 0.0), 90.0);
          vec3 deep = vec3(0.012, 0.03, 0.045);
          vec3 sky = vec3(0.07, 0.1, 0.15);
          vec3 col = mix(deep, sky, fres) + vec3(0.6, 0.72, 0.95) * spec * 0.7;
          // Espuma contra la costa de la isla.
          float shore = smoothstep(150.0, 70.0, length(vW.xz - vec2(-10.0, 26.0)));
          col += vec3(0.1, 0.12, 0.13) * smoothstep(0.62, 0.8, h) * shore * 0.4;
          float dist = length(uCam - vW);
          float fog = 1.0 - exp(-pow(dist * 0.0052, 1.5));
          gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sea = mat;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 1, 1), mat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = this.art.seaY;
    sea.renderOrder = -0.5;
    this.group.add(sea);
  }

  /** La ciudad y el puente del otro lado de la bahía: siluetas con lucecitas, entre la niebla. */
  private buildBay(): void {
    const silhouette = new THREE.MeshBasicMaterial({ color: 0x141b24, fog: false });
    const towers: THREE.Matrix4[] = [];
    const lamps: number[] = [];
    let seed = 91;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    // La ciudad: al sur, a un kilómetro y medio.
    for (let i = 0; i < 180; i++) {
      const x = -900 + rnd() * 1800;
      const z = 1100 + rnd() * 240;
      const center = 1 - Math.min(1, Math.abs(x - 120) / 620);
      const h = 14 + rnd() * rnd() * (40 + 170 * center * center);
      const w = 14 + rnd() * 26;
      towers.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2 + this.art.seaY, z), new THREE.Quaternion(), new THREE.Vector3(w, h, w)));
      const windows = Math.floor(h / 7);
      for (let k = 0; k < windows; k++) {
        if (rnd() < 0.55) continue;
        lamps.push(x + (rnd() - 0.5) * w, this.art.seaY + 6 + (k / windows) * h, z - w / 2 - 0.5);
      }
    }
    const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), silhouette, towers.length);
    towers.forEach((m, i) => city.setMatrixAt(i, m));
    city.frustumCulled = false;
    this.group.add(city);
    // Las colinas de atrás.
    const hills = new THREE.Mesh(new THREE.CylinderGeometry(1800, 1800, 70, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0x10161e, fog: false, side: THREE.BackSide }));
    hills.position.set(0, this.art.seaY + 24, 0);
    this.group.add(hills);
    // El puente: dos torres, tablero y cables, al oeste.
    const bridgeMat = new THREE.MeshBasicMaterial({ color: 0x1c1c22, fog: false });
    const bx = -1150;
    const parts: THREE.BufferGeometry[] = [];
    const piece = (x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.rotateZ(rz);
      g.rotateY(ry);
      g.translate(x, y, z);
      parts.push(g);
    };
    const zA = -260;
    const zB = 260;
    for (const z of [zA, zB]) {
      piece(bx - 10, this.art.seaY + 100, z, 7, 210, 8);
      piece(bx + 10, this.art.seaY + 100, z, 7, 210, 8);
      for (const y of [60, 110, 160, 205]) piece(bx, this.art.seaY + y, z, 22, 6, 6);
    }
    piece(bx, this.art.seaY + 48, 0, 20, 3, 1400);
    const cable = (z0: number, z1: number, y0: number, y1: number, drop: number) => {
      const steps = 22;
      for (let i = 0; i < steps; i++) {
        const a = i / steps;
        const b = (i + 1) / steps;
        const f = (t: number) => y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * drop;
        const za = z0 + (z1 - z0) * a;
        const zb = z0 + (z1 - z0) * b;
        const g = new THREE.BoxGeometry(1.2, 1.2, Math.hypot(zb - za, f(b) - f(a)) + 0.3);
        g.rotateX(-Math.atan2(f(b) - f(a), zb - za));
        g.translate(bx, this.art.seaY + (f(a) + f(b)) / 2, (za + zb) / 2);
        parts.push(g);
        if (i % 3 === 0) piece(bx, this.art.seaY + (f(a) + 48) / 2, za, 0.5, f(a) - 48, 0.5);
      }
    };
    cable(zA, zB, 210, 210, 150);
    cable(zA, -700, 210, 58, 20);
    cable(zB, 700, 210, 58, 20);
    const bridge = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!, bridgeMat);
    this.group.add(bridge);
    for (let z = -660; z <= 660; z += 44) lamps.push(bx, this.art.seaY + 51, z);
    const lampGeo = new THREE.BufferGeometry();
    lampGeo.setAttribute("position", new THREE.Float32BufferAttribute(lamps, 3));
    const lampMat = new THREE.PointsMaterial({ color: 0xffc98a, size: 2.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    const lightsObj = new THREE.Points(lampGeo, lampMat);
    lightsObj.frustumCulled = false;
    this.group.add(lightsObj);
    // Las balizas rojas de las torres.
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute("position", new THREE.Float32BufferAttribute([bx, this.art.seaY + 212, zA, bx, this.art.seaY + 212, zB], 3));
    this.group.add(new THREE.Points(bGeo, new THREE.PointsMaterial({ color: 0xff3020, size: 4, sizeAttenuation: false, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  }

  private buildLighthouse(): void {
    const l = this.art.lighthouse;
    if (!l) return;
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vView;
        varying vec3 vAxis;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          vAxis = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vView;
        varying vec3 vAxis;
        void main() {
          // vUv.x va del faro hacia afuera: se abre y se pierde. vUv.y atraviesa el rayo: blando en los bordes.
          float along = pow(max(1.0 - vUv.x, 0.0), 2.4);
          float widen = mix(0.05, 1.0, vUv.x);
          float across = 1.0 - smoothstep(0.0, widen, abs(vUv.y - 0.5) * 2.0);
          // Mirando a lo largo del rayo las láminas se apilan y hacen una estrella: ahí se apagan.
          float side = 1.0 - pow(abs(dot(normalize(vView), normalize(vAxis))), 6.0);
          gl_FragColor = vec4(vec3(1.0, 0.94, 0.78) * along * across * side * 0.2, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const g = new THREE.Group();
    // Dos brazos, cada uno una sola lámina que gira sobre su eje para mirar siempre a la cámara.
    for (const dir of [0, Math.PI]) {
      const arm = new THREE.Group();
      arm.rotation.y = dir;
      arm.rotation.z = -0.03;
      const sheet = new THREE.PlaneGeometry(190, 22);
      sheet.translate(95, 0, 0);
      const mesh = new THREE.Mesh(sheet, beamMat);
      mesh.frustumCulled = false;
      arm.add(mesh);
      g.add(arm);
      this.beamArms.push({ arm, sheet: mesh });
    }
    g.position.set(l.x, l.y, l.z);
    g.visible = false;
    this.beam = g;
    this.group.add(g);
    this.lantern = new THREE.MeshBasicMaterial({ color: 0x241c10 });
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), this.lantern);
    lantern.position.copy(g.position);
    this.group.add(lantern);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 2, 16), this.materials[TEX_COUNT + ROCA_TEX.findIndex((t) => t.name === "steel")] as THREE.Material);
    roof.position.set(l.x, l.y + 2, l.z);
    this.group.add(roof);
  }

  // ------------------------------------------------------------ polvo y lluvia

  private buildParticles(): void {
    const n = 420;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < n * 3; i++) pos[i] = (rnd() - 0.5) * 24;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xb4c0d0, size: 0.022, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    const drops = 900;
    const rp = new Float32Array(drops * 6);
    for (let i = 0; i < drops; i++) {
      const x = (rnd() - 0.5) * 34;
      const y = rnd() * 22;
      const z = (rnd() - 0.5) * 34;
      rp.set([x, y, z, x + 0.03, y - 0.42, z + 0.03], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x8fa8c8, transparent: true, opacity: 0.09, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  private buildPool(): void {
    // Un relleno suave alrededor del jugador: en la oscuridad se tiene que poder ver al que viene.
    this.fill = new THREE.PointLight(0xc8d4e8, 0.85, 14, 1);
    this.scene.add(this.fill);
    for (let i = 0; i < POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 2);
      this.scene.add(light);
      this.pool.push({ light, source: null, target: 0 });
    }
  }

  // ------------------------------------------------------------ los modelos

  private buildModels(manager: THREE.LoadingManager): void {
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.modelLoader = loader;
    const placements = new Map<string, { x: number; y: number; z: number; yaw: number; scale: number }[]>();
    const put = (model: string, x: number, y: number, z: number, yaw = 0, scale = 1) => {
      const list = placements.get(model) ?? [];
      list.push({ x, y, z, yaw, scale });
      placements.set(model, list);
    };
    for (const p of this.art.props) put(p.model, p.x, p.y, p.z, p.yaw ?? 0, p.scale ?? 1);
    for (const l of this.art.lights) {
      // Los artefactos: cada uno colgado o amurado donde está su luz.
      if (l.fixture === "lamp") put("lamp", l.x, l.y - 0.9, l.z, l.x);
      else if (l.fixture === "hanging") put("hanging", l.x, l.y - 0.1, l.z, Math.PI / 2, 1);
      else if (l.fixture === "seclight") put("seclight", l.x, l.y - 0.3, l.z, l.yaw ?? 0);
    }
    // Las lámparas se ven prendidas por sí mismas; el resto, según lo que les llega.
    const lightOf = (model: string, p: { x: number; y: number; z: number }) => {
      if (model === "lamp" || model === "hanging" || model === "seclight") return this.sample(p.x, p.y - 0.8, p.z);
      return this.sample(p.x, p.y + 0.9, p.z);
    };
    for (const [model, list] of placements) {
      loader.load(`${BASE}models/${model}.glb`, (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const material = (mesh.material as THREE.MeshStandardMaterial).clone();
          material.onBeforeCompile = patchProbe as never;
          material.customProgramCacheKey = () => "roca-probe";
          material.envMapIntensity = 0.5;
          const geometry = mesh.geometry.clone();
          const inst = new THREE.InstancedMesh(geometry, material, list.length);
          const probes = new Probes(list.length);
          const local = mesh.matrixWorld.clone();
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const up = new THREE.Vector3(0, 1, 0);
          list.forEach((p, i) => {
            q.setFromAxisAngle(up, p.yaw);
            m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
            inst.setMatrixAt(i, m.clone().multiply(local));
            probes.set(i, lightOf(model, p));
          });
          probes.attach(geometry);
          inst.frustumCulled = false;
          this.group.add(inst);
        });
      });
    }
    // Los reflectores de afuera, en su poste: hasta lo primero que haya abajo.
    const lamps = this.art.lights.filter((l) => l.fixture === "seclight");
    const pole = new THREE.CylinderGeometry(0.07, 0.09, 1, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3e4246, roughness: 0.7, metalness: 0.4 });
    patchMaterial(poleMat, { probe: true });
    const poles = new THREE.InstancedMesh(pole, poleMat, Math.max(1, lamps.length));
    const poleProbes = new Probes(Math.max(1, lamps.length));
    lamps.forEach((l, i) => {
      const down = raycastBoxes(l.x, l.y - 0.4, l.z, 0, -1, 0, this.occluders, 40);
      const len = down < 0 ? 12 : down;
      poles.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y - 0.4 - len / 2, l.z), new THREE.Quaternion(), new THREE.Vector3(1, len, 1)));
      poleProbes.set(i, this.sample(l.x, l.y - 1.5, l.z));
    });
    poleProbes.attach(pole);
    poles.frustumCulled = false;
    this.group.add(poles);

    // Los cables de las lámparas colgadas: del artefacto al techo.
    const cord = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
    const cords = this.art.lights.filter((l) => l.fixture === "lamp");
    const mesh = new THREE.InstancedMesh(cord, new THREE.MeshBasicMaterial({ color: 0x0a0a0a }), Math.max(1, cords.length));
    cords.forEach((l, i) => {
      const top = 11;
      const len = top - l.y + 0.2;
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y + len / 2, l.z), new THREE.Quaternion(), new THREE.Vector3(1, len, 1)));
    });
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  /** Un modelo colgado de otro objeto (la radio, el banco). `done` se llama cuando llegó, para sacar el reemplazo. */
  attachModel(parent: THREE.Object3D, model: string, scale: number, done: () => void): void {
    this.modelLoader.load(`${BASE}models/${model}.glb`, (gltf) => {
      gltf.scene.scale.setScalar(scale);
      parent.add(gltf.scene);
      const at = parent.getWorldPosition(new THREE.Vector3());
      this.bakeLight(gltf.scene, at.x, at.y + 0.9, at.z);
      done();
    });
  }

  /** Lo que no cambia nada pero hace al lugar: caños, carteles, manchas, alambre de púas, las ventanas del edificio. */
  private buildDressing(): void {
    // --- Caños: corren por arriba de los bloques y bajan por las puntas.
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x4a4e4c, roughness: 0.6, metalness: 0.5, envMapIntensity: 0.8 });
    patchMaterial(pipeMat, { probe: true, damp: 0.6 });
    const unit = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    const list: { a: number[]; b: number[]; r: number }[] = [];
    const pipe = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0.05) => list.push({ a: [x0, y0, z0], b: [x1, y1, z1], r });
    for (const z of [-3.2, 3.2, -9.2, 9.2]) {
      pipe(-24, 8.72, z, 24, 8.72, z, 0.07);
      pipe(-24, 8.9, z + 0.25, 24, 8.9, z + 0.25, 0.04);
    }
    for (const z of [-18.6, 18.6]) pipe(-31, 6, z, 30, 6, z, 0.08);
    for (const x of [-24.45, 24.45]) for (const z of [-4, 4, -8.4, 8.4]) pipe(x, 0, z, x, 8.72, z, 0.045);
    for (const z of [-12, 0, 12]) pipe(-59.5, 4.6, z, -31.5, 4.6, z, 0.06);
    pipe(-31, 3.2, 12.4, -60, 3.2, 12.4, 0.04);
    for (const x of [-4, 6, 16]) pipe(x, -1.1, 5.9, x, -1.1, 18.8, 0.06);
    pipe(-5.9, -1.3, 6, -5.9, -1.3, 18.8, 0.07);
    pipe(-73, 4.2, -13, -73, 4.2, 13, 0.07);
    const up = new THREE.Vector3(0, 1, 0);
    const pipes = new THREE.InstancedMesh(unit, pipeMat, list.length);
    const pipeProbes = new Probes(list.length);
    list.forEach((p, i) => {
      const d = new THREE.Vector3(p.b[0]! - p.a[0]!, p.b[1]! - p.a[1]!, p.b[2]! - p.a[2]!);
      const len = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize());
      const c = new THREE.Vector3((p.a[0]! + p.b[0]!) / 2, (p.a[1]! + p.b[1]!) / 2, (p.a[2]! + p.b[2]!) / 2);
      pipes.setMatrixAt(i, new THREE.Matrix4().compose(c, q, new THREE.Vector3(p.r, len, p.r)));
      pipeProbes.set(i, this.sample(c.x, c.y - 0.2, c.z));
    });
    pipeProbes.attach(unit);
    pipes.frustumCulled = false;
    this.group.add(pipes);

    // --- Los carteles pintados de los pasillos.
    const sign = (text: string, width: number, x: number, y: number, z: number, yaw: number, color?: string) => {
      const m = stencil(text, width, color);
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      this.group.add(m);
    };
    sign("BROADWAY", 4.2, BLOCK_END_W - 0.42, 6.6, 0, -Math.PI / 2);
    sign("BROADWAY", 4.2, BLOCK_END_E + 0.42, 6.6, 0, Math.PI / 2);
    sign("BLOQUE B", 3.2, BLOCK_END_W - 0.42, 4.4, -6.2, -Math.PI / 2);
    sign("BLOQUE C", 3.2, BLOCK_END_W - 0.42, 4.4, 6.2, -Math.PI / 2);
    sign("BLOQUE A", 2.4, BLOCK_END_W - 0.42, 4.4, -17.2, -Math.PI / 2);
    sign("AISLAMIENTO", 2.8, BLOCK_END_W - 0.42, 4.4, 17.2, -Math.PI / 2);
    sign("TIMES SQUARE", 4.6, -30.9, 6.6, 0, Math.PI / 2);
    sign("COMEDOR", 2.4, -30.9, 3.5, 0, Math.PI / 2);
    sign("MICHIGAN AVE", 3.4, BLOCK_END_E + 0.42, 6.6, -12.4, Math.PI / 2);
    sign("CALLE D", 2.4, BLOCK_END_E + 0.42, 6.6, 12.4, Math.PI / 2);
    sign("SILENCIO", 3.6, -45.5, 3.8, -12.93, 0);
    sign("HOSPITAL", 3, -45, 8.1, -2.04, 0, "rgba(40,30,26,0.8)");
    sign("NO PASAR", 2.4, 22, 2, 18.94, Math.PI);
    sign("CIUDADELA  1859", 3, 9, -1.6, 18.94, Math.PI, "rgba(20,18,16,0.75)");
    sign("CONTROL", 2.6, 29.92, 5.6, 0, -Math.PI / 2);
    sign("ALCAIDE", 2, 40, 3.2, -5.1, Math.PI);
    sign("VISITAS", 2, 40, 3.2, -4.92, 0);
    sign("ARMERÍA", 2, 40, 3.2, 4.92, Math.PI);

    // --- Manchas por el piso: sangre, agua y hollín.
    const stainMat = new THREE.MeshBasicMaterial({ map: makeStainAtlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true });
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    const uvOffset: number[] = [];
    const spots: THREE.Matrix4[] = [];
    let seed = 311;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const areas: { zone: [number, number, number, number]; y: number; n: number }[] = [
      { zone: [-24, -3, 24, 3], y: 0.018, n: 26 },
      { zone: [-24, -15.4, 24, -9.4], y: 0.018, n: 22 },
      { zone: [-24, 9.4, 24, 15.4], y: 0.018, n: 22 },
      { zone: [-31, -19, -24.4, 19], y: 0.022, n: 18 },
      { zone: [24.4, -19, 30, 19], y: 0.022, n: 12 },
      { zone: [-60, -13, -31, 13], y: 0.018, n: 26 },
      { zone: [-74, -13, -60.6, 13], y: 0.018, n: 12 },
      { zone: [-60, -13, -31, 13], y: 5.618, n: 18 },
      { zone: [30.6, -16, 50, 16], y: 0.018, n: 10 },
      { zone: [-6, 6, 24, 19], y: -3.982, n: 18 },
      { zone: [-66, 13.6, -31.6, 44], y: 0.03, n: 12 },
    ];
    for (const a of areas) {
      for (let i = 0; i < a.n; i++) {
        const x = a.zone[0] + rnd() * (a.zone[2] - a.zone[0]);
        const z = a.zone[1] + rnd() * (a.zone[3] - a.zone[1]);
        const s = 0.7 + rnd() * 2.4;
        spots.push(new THREE.Matrix4().compose(new THREE.Vector3(x, a.y, z), new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6.28), new THREE.Vector3(s, 1, s)));
        const k = Math.floor(rnd() * 4);
        uvOffset.push((k % 2) * 0.5, k < 2 ? 0.5 : 0);
      }
    }
    quad.setAttribute("aOffset", new THREE.InstancedBufferAttribute(new Float32Array(uvOffset), 2));
    stainMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aOffset;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = uv * 0.5 + aOffset;");
    };
    const stains = new THREE.InstancedMesh(quad, stainMat, spots.length);
    spots.forEach((m, i) => stains.setMatrixAt(i, m));
    stains.frustumCulled = false;
    stains.renderOrder = 1;
    this.group.add(stains);

    // --- Papeles y cascotes por el piso: no chocan.
    const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x8a867a, roughness: 0.95 });
    patchMaterial(rubbleMat, { probe: true });
    const rubbleGeo = new THREE.BoxGeometry(1, 1, 1);
    const rubble: { m: THREE.Matrix4; x: number; y: number; z: number }[] = [];
    for (const a of areas) {
      for (let i = 0; i < a.n * 2; i++) {
        const x = a.zone[0] + rnd() * (a.zone[2] - a.zone[0]);
        const z = a.zone[1] + rnd() * (a.zone[3] - a.zone[1]);
        const paper = rnd() < 0.6;
        const s = paper ? 0.2 + rnd() * 0.12 : 0.05 + rnd() * 0.12;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * (paper ? 0.12 : 1.5), rnd() * 6.28, (rnd() - 0.5) * (paper ? 0.12 : 1.5)));
        const y = a.y + (paper ? 0.003 : s * 0.3);
        rubble.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, paper ? 0.003 : s * 0.7, s * (paper ? 1.35 : 0.8))), x, y, z });
      }
    }
    const rubbleMesh = new THREE.InstancedMesh(rubbleGeo, rubbleMat, rubble.length);
    const rubbleProbes = new Probes(rubble.length);
    rubble.forEach((r, i) => {
      rubbleMesh.setMatrixAt(i, r.m);
      rubbleProbes.set(i, this.sample(r.x, r.y + 0.3, r.z));
    });
    rubbleProbes.attach(rubbleGeo);
    rubbleMesh.frustumCulled = false;
    this.group.add(rubbleMesh);

    // --- Alambre de púas sobre las paredes del patio.
    const wireMat = new THREE.LineBasicMaterial({ color: 0x24262a });
    const coil = (x0: number, z0: number, x1: number, z1: number, y: number) => {
      const pts: number[] = [];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.round(len * 5);
      const dx = (x1 - x0) / len;
      const dz = (z1 - z0) / len;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = i * 1.3;
        const px = x0 + (x1 - x0) * t + -dz * Math.cos(a) * 0.22;
        const pz = z0 + (z1 - z0) * t + dx * Math.cos(a) * 0.22;
        pts.push(px, y + 0.24 + Math.sin(a) * 0.22, pz);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const line = new THREE.Line(g, wireMat);
      line.frustumCulled = false;
      this.group.add(line);
    };
    coil(-66.3, 14, -66.3, 44.3, 6.5);
    coil(-66.3, 44.3, -31.3, 44.3, 6.5);
    coil(-31.3, 19.6, -31.3, 44.3, 6.5);

    // --- Las ventanas del edificio de los guardias: oscuras, salvo alguna.
    const paneDark = new THREE.MeshStandardMaterial({ color: 0x0c1014, roughness: 0.2, metalness: 0.6 });
    const paneLit = new THREE.MeshBasicMaterial({ color: 0xffc27a });
    const pane = new THREE.PlaneGeometry(1.2, 1.7);
    const darks: THREE.Matrix4[] = [];
    const lits: THREE.Matrix4[] = [];
    for (let floor = 0; floor < 3; floor++) {
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Matrix4().makeTranslation(12 + i * 2.45, 1.8 + floor * 3.3, 45.92);
        if (rnd() < 0.14) lits.push(m);
        else darks.push(m);
      }
    }
    const dm = new THREE.InstancedMesh(pane, paneDark, darks.length);
    darks.forEach((m, i) => dm.setMatrixAt(i, m));
    const lm = new THREE.InstancedMesh(pane, paneLit, Math.max(1, lits.length));
    lits.forEach((m, i) => lm.setMatrixAt(i, m));
    dm.frustumCulled = lm.frustumCulled = false;
    this.group.add(dm, lm);

    // --- El tanque de agua sobre patas, del lado norte: la silueta de la isla.
    const rust = this.materials[TEX_COUNT + ROCA_TEX.findIndex((t) => t.name === "rust")] as THREE.Material;
    const tower = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 7, 20), rust);
    tank.position.y = 26;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2, 20), rust);
    cap.position.y = 30.5;
    tower.add(tank, cap);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 24, 6), rust);
      leg.position.set(Math.cos(a) * 5.4, 11, Math.sin(a) * 5.4);
      tower.add(leg);
    }
    tower.position.set(-10, -1, -36);
    this.group.add(tower);

    // --- Mugre y sangre en las paredes, al lado de las celdas tapiadas.
    const wallStains = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), stainMat.clone(), this.map.barriers.filter((b) => b.kind === "cell").length * 2);
    const wallGeo = wallStains.geometry;
    const wallOffset: number[] = [];
    let w = 0;
    for (const b of this.map.barriers) {
      if (b.kind !== "cell") continue;
      const cx = (b.box.minX + b.box.maxX) / 2;
      const cz = (b.box.minZ + b.box.maxZ) / 2;
      // Se mira desde el pasillo: la mancha va pegada al frente de la celda de al lado.
      const toward = b.inside.z > cz ? 1 : -1;
      for (const side of [-1, 1]) {
        const s = 0.9 + rnd() * 1.3;
        const q = new THREE.Quaternion().setFromAxisAngle(up, toward > 0 ? 0 : Math.PI);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rnd() * 6.28));
        wallStains.setMatrixAt(w++, new THREE.Matrix4().compose(new THREE.Vector3(cx + side * 1.1, (b.y ?? 0) + 0.5 + rnd() * 1.5, cz + toward * 0.03), q, new THREE.Vector3(s, s, 1)));
        const k = Math.floor(rnd() * 2);
        wallOffset.push(k * 0.5, 0.5);
      }
    }
    wallGeo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(new Float32Array(wallOffset), 2));
    wallStains.frustumCulled = false;
    this.group.add(wallStains);

    // --- La niebla baja que se mueve afuera: unas pocas manchas grandes y blandas.
    const mistTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const ctx = c.getContext("2d")!;
      for (let i = 0; i < 26; i++) {
        const x = 34 + rnd() * 60;
        const y = 34 + rnd() * 60;
        const r = 16 + rnd() * 30;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.16)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const spots2: [number, number, number, number][] = [
      [10, DOCK_LEVEL + 1.6, 60, 26], [38, DOCK_LEVEL + 1.4, 66, 30], [25, DOCK_LEVEL + 1.2, 86, 24], [52, DOCK_LEVEL + 2.2, 54, 26], [2, DOCK_LEVEL + 2, 40, 22], [56, -3, 28, 22],
      [-50, 1.8, 30, 28], [-38, 2.2, 22, 24], [-60, 1.6, 38, 24], [-16, -2, 31, 22],
      [-45, 10.4, 0, 30], [0, 12.6, 6, 34], [20, 12.8, -8, 30], [-20, 12.4, 14, 32],
      [90, -8, 30, 80], [-120, -8, 20, 90], [20, -9, 130, 90], [0, -8, -90, 90],
    ];
    for (const [x, y, z, s] of spots2) {
      const mat = new THREE.SpriteMaterial({ map: mistTex, color: 0x8a97a8, transparent: true, opacity: 0.2, depthWrite: false, fog: true });
      const m = new THREE.Sprite(mat);
      m.scale.set(s, s * 0.34, 1);
      m.position.set(x, y, z);
      this.group.add(m);
      this.mist.push({ sprite: m, x, z, phase: rnd() * 6.28 });
    }
  }

  /** El brillo alrededor de cada lámpara: un sprite aditivo. Se apaga con la luz. */
  private buildHalos(): void {
    const c = document.createElement("canvas");
    c.width = c.height = HALO_CANVAS_SIZE;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(HALO_CANVAS_SIZE / 2, HALO_CANVAS_SIZE / 2, 0, HALO_CANVAS_SIZE / 2, HALO_CANVAS_SIZE / 2, HALO_CANVAS_SIZE / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,0.42)");
    g.addColorStop(0.5, "rgba(255,255,255,0.08)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, HALO_CANVAS_SIZE, HALO_CANVAS_SIZE);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    let i = 0;
    for (const l of this.art.lights) {
      if (!l.fixture) continue;
      const mat = new THREE.SpriteMaterial({ map: tex, color: l.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
      const sprite = new THREE.Sprite(mat);
      const size = l.fixture === "bulb" ? 1.1 : l.fixture === "seclight" ? 1.5 : 2.6;
      sprite.scale.setScalar(size);
      sprite.position.set(l.x, l.y - (l.fixture === "lamp" ? 1.25 : 0.1), l.z);
      this.group.add(sprite);
      this.halos.push({ sprite, light: l, base: l.fixture === "bulb" ? 0.8 : 0.62, flick: i++ * 1.37 });
    }
    // Una foquito de verdad en las lámparas simples.
    const bulbs = this.art.lights.filter((l) => l.fixture === "bulb");
    const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe8c0 }), Math.max(1, bulbs.length));
    bulbs.forEach((l, k) => bulbMesh.setMatrixAt(k, new THREE.Matrix4().makeTranslation(l.x, l.y - 0.1, l.z)));
    this.group.add(bulbMesh);
  }

  // ------------------------------------------------------------ el estado

  private isLit(l: MapLight): boolean {
    return l.when === "always" || (l.when === "grid" && this.powered) || (l.when === "off" && !this.powered);
  }

  private applyPower(on: boolean): void {
    this.powered = on;
    const tex = on ? this.lmOn : this.lmOff;
    for (const m of this.mapMaterials) {
      m.lightMap = tex;
      m.needsUpdate = false;
    }
    probeUniforms.uProbeMix.value = on ? 1 : 0;
    this.refreshLit();
    this.poolCheck = 0;
  }

  /** El faro: apagado hasta que la fuga llega a ese paso. */
  setBeacon(on: boolean): void {
    if (!this.beam || this.beam.visible === on) return;
    this.beam.visible = on;
    this.lantern?.color.set(on ? 0xfff1cc : 0x241c10);
  }

  /** Se prende o se apaga: cuando es al prenderla, parpadea unos segundos como un tubo viejo. */
  setPower(on: boolean, instant = false): void {
    if (on === this.powered) return;
    this.applyPower(on);
    if (on && !instant) this.flicker = 2.2;
  }

  /** Un tick visual. `outdoor`: si la cámara está a cielo abierto. */
  update(dt: number, cam: THREE.Vector3, outdoor: boolean): void {
    this.time += dt;
    const t = this.time;
    this.fill?.position.set(cam.x, cam.y + 1.3, cam.z);
    if (this.sea) {
      this.sea.uniforms.uTime!.value = t;
      (this.sea.uniforms.uCam!.value as THREE.Vector3).copy(cam);
    }
    if (this.skyMat) {
      this.skyMat.uniforms.uTime!.value = t;
      this.skyMat.uniforms.uFlash!.value = this.lightning * (0.55 + 0.45 * Math.sin(t * 60));
    }
    if (this.shafts) {
      this.shafts.uniforms.uTime!.value = t;
      this.shafts.uniforms.uPower!.value = 0.8 + Math.sin(t * 0.17) * 0.2;
    }
    if (this.beam?.visible) {
      this.beam.rotation.y = t * 0.32;
      this.beam.updateMatrixWorld(true);
      for (const { arm, sheet } of this.beamArms) {
        this.camLocal.copy(cam);
        arm.worldToLocal(this.camLocal);
        sheet.rotation.x = Math.atan2(-this.camLocal.y, this.camLocal.z);
      }
    }

    // La niebla: más cerrada afuera, y un toque más clara cuando hay relámpago.
    const wanted = outdoor ? 0.0085 : 0.0125;
    this.fog.density += (wanted - this.fog.density) * Math.min(1, dt * 0.9);

    // El parpadeo de la luz al prenderse.
    let flick = 1;
    if (this.flicker > 0) {
      this.flicker -= dt;
      const k = Math.max(0, this.flicker / 2.2);
      flick = Math.sin(t * 57) * Math.sin(t * 23) > 0.1 - k * 0.7 ? 1 : 0.12;
      flick = 1 - (1 - flick) * Math.min(1, k * 1.6);
    }
    for (const m of this.mapMaterials) m.lightMapIntensity = LM_RANGE * Math.PI * flick;
    probeUniforms.uProbeGain.value = flick;

    // Los halos: los que corresponden, con un temblor en alguno.
    for (const h of this.halos) {
      const lit = this.isLit(h.light);
      const shake = h.light.when === "grid" ? 1 : 0.82 + Math.sin(t * 3 + h.flick) * 0.18;
      (h.sprite.material as THREE.SpriteMaterial).opacity = lit ? h.base * shake * flick : 0;
    }

    // Las luces de verdad: las más cercanas que estén prendidas, para que el relieve brille cerca del jugador.
    this.poolCheck -= dt;
    if (this.poolCheck <= 0) {
      this.poolCheck = 0.3;
      const near = this.art.lights
        .filter((l) => this.isLit(l) && Math.abs(l.y - cam.y) < 9)
        .map((l) => ({ l, d: (l.x - cam.x) ** 2 + (l.y - cam.y) ** 2 + (l.z - cam.z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, POOL);
      this.pool.forEach((p, i) => {
        const pick = near[i]?.l ?? null;
        p.source = pick;
        if (pick) {
          p.light.position.set(pick.x, pick.y - 0.15, pick.z);
          p.light.color.set(pick.color);
          p.light.distance = pick.range;
          p.target = pick.power * 0.32;
        } else p.target = 0;
      });
    }
    for (const p of this.pool) p.light.intensity += (p.target * flick - p.light.intensity) * Math.min(1, dt * 7);

    // Relámpagos, de vez en cuando: un fogonazo en todo lo que da afuera.
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) {
      this.nextLightning = 16 + Math.random() * 28;
      this.lightning = 1;
      this.onThunder?.(1 + Math.random() * 2.4);
    }
    if (this.lightning > 0) {
      this.lightning = Math.max(0, this.lightning - dt * 2.4);
      const f = this.lightning * (0.55 + 0.45 * Math.sin(t * 60));
      this.moon.intensity = 0.3 + f * (outdoor ? 7 : 1.6);
      this.hemi.intensity = 0.34 + f * (outdoor ? 1.2 : 0.35);
      this.fog.color.setRGB(0.012 + f * 0.25, 0.018 + f * 0.27, 0.028 + f * 0.33);
    } else {
      this.moon.intensity = 0.3;
      this.hemi.intensity = 0.34;
      this.fog.color.setRGB(0.012, 0.018, 0.028);
    }
    (this.scene.background as THREE.Color | null)?.copy(this.fog.color);

    // La niebla se corre despacio.
    for (const m of this.mist) {
      m.sprite.position.x = m.x + Math.sin(t * 0.05 + m.phase) * 7;
      m.sprite.position.z = m.z + Math.cos(t * 0.04 + m.phase) * 5;
    }

    // Polvo que acompaña; lluvia sólo a cielo abierto.
    if (this.dust) {
      const size = 24;
      this.dust.position.set(Math.floor(cam.x / size) * size, Math.floor(cam.y / size) * size, Math.floor(cam.z / size) * size);
      this.dust.rotation.y = t * 0.012;
      this.dust.visible = !outdoor;
    }
    if (this.rain) {
      this.rain.visible = outdoor;
      if (outdoor) this.rain.position.set(cam.x, cam.y - 10 - ((t * 26) % 22) + 22, cam.z);
    }
  }
}
