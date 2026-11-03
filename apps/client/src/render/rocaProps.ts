import * as THREE from "three";
import type { Barrier, Box } from "@wabzomb/shared";

/**
 * Lo que tiene estado en La Roca, en su versión producida: las máquinas de
 * bebidas (gabinetes viejos con el cartel iluminado), la caja de la suerte, la
 * prensa del Pack-a-Punch, el horno de ladrillo, los marcos de las ventanas y
 * las puertas. Son diseños propios, con piezas simples y carteles pintados en
 * canvas.
 */

export function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Un gabinete de bebidas: chapa esmaltada del color de la bebida, frente de vidrio con botellas y marquesina. */
export function buildPerkCabinet(name: string, price: string, color: number): { group: THREE.Group; glow: THREE.MeshStandardMaterial[] } {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const enamel = new THREE.MeshStandardMaterial({
    map: canvasTexture(256, 512, (ctx) => {
      ctx.fillStyle = hex(c.clone().multiplyScalar(0.62).getHex());
      ctx.fillRect(0, 0, 256, 512);
      // Óxido y golpes de muchos años.
      for (let i = 0; i < 60; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 512;
        const r = 2 + Math.random() * 22;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(70,40,20,${0.35 + Math.random() * 0.45})`);
        grad.addColorStop(1, "rgba(60,30,10,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const base = ctx.createLinearGradient(0, 380, 0, 512);
      base.addColorStop(0, "rgba(0,0,0,0)");
      base.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx.fillStyle = base;
      ctx.fillRect(0, 380, 256, 132);
    }),
    roughness: 0.48,
    metalness: 0.3,
    envMapIntensity: 0.8,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.5, metalness: 0.7 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // El frente es -Z: como las otras máquinas.
  add(new THREE.BoxGeometry(0.95, 1.72, 0.72), enamel, 0, 0.92, 0);
  add(new THREE.BoxGeometry(1.0, 0.08, 0.78), dark, 0, 0.04, 0);
  add(new THREE.BoxGeometry(0.98, 0.04, 0.76), dark, 0, 1.79, 0);
  // Marquesina con el nombre.
  const marqueeMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: 0xffffff,
    emissiveMap: canvasTexture(512, 128, (ctx) => {
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = hex(color);
      ctx.lineWidth = 4;
      ctx.strokeRect(8, 8, 496, 112);
      ctx.fillStyle = hex(color);
      ctx.shadowColor = hex(color);
      ctx.shadowBlur = 22;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 58px Rajdhani, ui-sans-serif, sans-serif";
      ctx.fillText(name.toUpperCase(), 256, 64, 480);
    }),
    emissiveIntensity: 0.05,
    roughness: 0.3,
  });
  const marquee = add(new THREE.BoxGeometry(1.0, 0.26, 0.2), [dark, dark, dark, dark, dark, marqueeMat] as unknown as THREE.Material, 0, 2.0, -0.2);
  marquee.rotation.x = 0.0;
  // El vidrio: botellas en tres estantes, iluminadas desde atrás.
  const shelfMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    emissive: 0xffffff,
    emissiveMap: canvasTexture(256, 384, (ctx) => {
      const back = ctx.createLinearGradient(0, 0, 0, 384);
      back.addColorStop(0, hex(c.clone().multiplyScalar(0.8).getHex()));
      back.addColorStop(1, hex(c.clone().multiplyScalar(0.25).getHex()));
      ctx.fillStyle = back;
      ctx.fillRect(0, 0, 256, 384);
      for (let row = 0; row < 3; row++) {
        const y = 118 + row * 124;
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillRect(0, y, 256, 8);
        for (let i = 0; i < 5; i++) {
          const x = 26 + i * 51;
          ctx.fillStyle = "rgba(10,14,12,0.92)";
          ctx.fillRect(x - 11, y - 62, 22, 62);
          ctx.fillRect(x - 5, y - 92, 10, 32);
          ctx.fillStyle = hex(color);
          ctx.fillRect(x - 11, y - 44, 22, 20);
        }
      }
    }),
    emissiveIntensity: 0.05,
    roughness: 0.12,
    metalness: 0,
  });
  add(new THREE.BoxGeometry(0.72, 1.0, 0.02), shelfMat, 0, 1.2, -0.37);
  // Marco, boca de la bebida y la ranura de la moneda.
  for (const [x, y, w, h] of [[0, 1.72, 0.8, 0.05], [0, 0.68, 0.8, 0.05], [-0.385, 1.2, 0.05, 1.05], [0.385, 1.2, 0.05, 1.05]] as const) add(new THREE.BoxGeometry(w, h, 0.05), dark, x, y, -0.375);
  add(new THREE.BoxGeometry(0.6, 0.22, 0.05), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }), 0, 0.42, -0.375);
  add(new THREE.BoxGeometry(0.1, 0.16, 0.04), dark, 0.36, 0.56, -0.375);
  // El precio pintado.
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.11),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(204, 66, (ctx) => {
        ctx.fillStyle = "#d8cfa8";
        ctx.fillRect(0, 0, 204, 66);
        ctx.fillStyle = "#26211a";
        ctx.font = "bold 44px Rajdhani, ui-sans-serif, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(price, 102, 36);
      }),
    }),
  );
  plate.position.set(-0.2, 0.56, -0.378);
  plate.rotation.y = Math.PI;
  g.add(plate);
  return { group: g, glow: [shelfMat, marqueeMat] };
}

/** Una prensa de fundición vieja: el Pack-a-Punch. Cuerpo de hierro, rodillos y una boca que brilla. */
export function buildPapMachine(): { group: THREE.Group; glow: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x35343a, roughness: 0.55, metalness: 0.7, envMapIntensity: 1 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a30, roughness: 0.4, metalness: 0.9, envMapIntensity: 1 });
  const glow = new THREE.MeshStandardMaterial({
    color: 0x120a20,
    emissive: 0xffffff,
    emissiveMap: canvasTexture(256, 96, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 0, 96);
      grad.addColorStop(0, "#2a0f58");
      grad.addColorStop(0.55, "#7a34d8");
      grad.addColorStop(1, "#c88aff");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 96);
      ctx.fillStyle = "rgba(6,3,12,0.92)";
      for (let i = 0; i < 12; i++) ctx.fillRect(10 + i * 20.5, 0, 7, 96);
    }),
    emissiveIntensity: 0.05,
    roughness: 0.3,
  });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.9, 0.22, 1.25), iron, 0, 0.11, 0);
  add(new THREE.BoxGeometry(1.5, 0.75, 1.0), iron, 0, 0.6, 0);
  add(new THREE.BoxGeometry(1.0, 0.34, 0.1), glow, 0, 0.72, -0.5);
  add(new THREE.BoxGeometry(1.7, 0.1, 1.1), brass, 0, 1.02, 0);
  // Los dos rodillos de arriba, sus engranajes y las columnas.
  add(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 16), iron, 0, 1.27, -0.2, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 16), iron, 0, 1.27, 0.24, 0, Math.PI / 2);
  for (const x of [-0.85, 0.85]) {
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 14), brass, x, 1.27, -0.2, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 14), brass, x, 1.27, 0.24, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 10), brass, x, 1.0, 0.48);
  }
  add(new THREE.BoxGeometry(1.9, 0.12, 0.3), iron, 0, 1.92, 0.48);
  // Las tuberías de vapor, y la palanca.
  add(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8), brass, -0.55, 1.1, 0.68);
  add(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), brass, 0.55, 0.9, 0.68);
  add(new THREE.BoxGeometry(0.05, 0.7, 0.05), iron, 0.98, 0.9, -0.1, 0, -0.35);
  add(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0x7a1818, roughness: 0.4 }), 1.1, 1.22, -0.1);
  return { group: g, glow };
}

/** El horno: un arco de ladrillo con puerta de hierro y chimenea. */
export function buildFurnaceFront(brick: THREE.Material, iron: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
  };
  add(0.5, 1.9, 0.5, -1.05, 0.95, 0, brick);
  add(0.5, 1.9, 0.5, 1.05, 0.95, 0, brick);
  add(2.6, 0.5, 0.6, 0, 2.05, 0, brick);
  add(1.7, 0.08, 0.06, 0, 1.72, -0.22, iron);
  add(1.7, 0.08, 0.06, 0, 0.3, -0.22, iron);
  return g;
}

/** La boca del horno: brasas que se ven por la reja. */
export function furnaceEmbers(): THREE.Texture {
  return canvasTexture(256, 192, (ctx) => {
    ctx.fillStyle = "#050201";
    ctx.fillRect(0, 0, 256, 192);
    const flame = ctx.createLinearGradient(0, 192, 0, 20);
    flame.addColorStop(0, "#ffd47a");
    flame.addColorStop(0.3, "#ff7a1a");
    flame.addColorStop(0.7, "#7a1c04");
    flame.addColorStop(1, "rgba(30,6,0,0)");
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 256;
      const w = 18 + Math.random() * 34;
      const h = 60 + Math.random() * 120;
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, 192);
      ctx.quadraticCurveTo(x - w / 4, 192 - h * 0.6, x, 192 - h);
      ctx.quadraticCurveTo(x + w / 4, 192 - h * 0.6, x + w / 2, 192);
      ctx.fill();
    }
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(255,${150 + Math.random() * 90},60,${0.4 + Math.random() * 0.6})`;
      ctx.fillRect(Math.random() * 256, 160 + Math.random() * 32, 3 + Math.random() * 7, 2 + Math.random() * 4);
    }
  });
}

/** Un marco de acero alrededor del hueco de una ventana. */
export function buildWindowFrame(b: Barrier, steel: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const bx = b.box;
  const alongX = bx.maxX - bx.minX > bx.maxZ - bx.minZ;
  const w = alongX ? bx.maxX - bx.minX : bx.maxZ - bx.minZ;
  const h = bx.maxY - bx.minY;
  const cx = (bx.minX + bx.maxX) / 2;
  const cz = (bx.minZ + bx.maxZ) / 2;
  const cy = (bx.minY + bx.maxY) / 2;
  const add = (lw: number, lh: number, u: number, v: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? lw : 0.66, lh, alongX ? 0.66 : lw), steel);
    m.position.set(cx + (alongX ? u : 0), cy + v, cz + (alongX ? 0 : u));
    g.add(m);
  };
  add(w + 0.2, 0.1, 0, h / 2);
  add(w + 0.2, 0.1, 0, -h / 2);
  add(0.1, h, -w / 2, 0);
  add(0.1, h, w / 2, 0);
  return g;
}

/** Una puerta de chapa con remaches, marco y mirilla con rejita. */
export function buildSteelDoor(g: THREE.Group, b: Box, steel: THREE.Material): void {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const h = b.maxY - b.minY;
  const alongX = w > d;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = alongX ? w : d;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : 0.14, h, alongX ? 0.14 : d), steel);
  plate.position.set(cx, b.minY + h / 2, cz);
  g.add(plate);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.6, metalness: 0.7 });
  // Dos hojas: la juntura, los remaches, y una mirilla en cada una.
  const seam = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.03 : 0.17, h, alongX ? 0.17 : 0.03), dark);
  seam.position.set(cx, b.minY + h / 2, cz);
  g.add(seam);
  for (const s of [-0.25, 0.25]) {
    const u = s * span;
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.3 : 0.17, 0.18, alongX ? 0.17 : 0.3), dark);
    hatch.position.set(cx + (alongX ? u : 0), b.minY + h * 0.68, cz + (alongX ? 0 : u));
    g.add(hatch);
  }
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : 0.17, 0.07, alongX ? 0.17 : d), dark);
    band.position.set(cx, b.minY + 0.25 + i * (h * 0.4), cz);
    g.add(band);
  }
}

/** Una puerta de madera de dos hojas, con marco, tablas y su ventanita con reja. */
export function buildWoodDoor(g: THREE.Group, b: Box, wood: THREE.Material, iron: THREE.Material): void {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const h = b.maxY - b.minY;
  const alongX = w > d;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = alongX ? w : d;
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : 0.12, h, alongX ? 0.12 : d), wood);
  leaf.position.set(cx, b.minY + h / 2, cz);
  g.add(leaf);
  const part = (lw: number, lh: number, u: number, y: number, thick: number, m: THREE.Material) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(alongX ? lw : thick, lh, alongX ? thick : lw), m);
    p.position.set(cx + (alongX ? u : 0), b.minY + y, cz + (alongX ? 0 : u));
    g.add(p);
  };
  // La juntura de las dos hojas, los herrajes y las ventanitas.
  part(0.04, h, 0, h / 2, 0.16, iron);
  for (const y of [0.35, h * 0.5, h - 0.35]) part(span, 0.07, 0, y, 0.15, iron);
  for (const s of [-0.25, 0.25]) {
    part(0.5, 0.42, s * span, h * 0.72, 0.15, iron);
    part(0.42, 0.34, s * span, h * 0.72, 0.17, new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.3, metalness: 0.2 }));
    for (let i = 0; i < 4; i++) part(0.025, 0.36, s * span + (i - 1.5) * 0.09, h * 0.72, 0.19, iron);
  }
}

/** El frente del tablero de la luz: llaves, relojes y el cartel de peligro. */
export function powerPanelFace(): THREE.Texture {
  return canvasTexture(256, 400, (ctx) => {
    ctx.fillStyle = "#2c3430";
    ctx.fillRect(0, 0, 256, 400);
    ctx.fillStyle = "#1a1f1c";
    ctx.fillRect(14, 14, 228, 372);
    // Dos relojes.
    for (const x of [78, 178]) {
      ctx.fillStyle = "#d8d2bc";
      ctx.beginPath();
      ctx.arc(x, 66, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#101010";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, 66);
      ctx.lineTo(x + 20, 46);
      ctx.stroke();
    }
    // Filas de llaves.
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        const x = 34 + i * 40;
        const y = 136 + row * 44;
        ctx.fillStyle = "#3e4640";
        ctx.fillRect(x, y, 26, 32);
        ctx.fillStyle = "#b8b09a";
        ctx.fillRect(x + 8, (row + i) % 2 === 0 ? y + 4 : y + 16, 10, 12);
      }
    }
    // Peligro.
    ctx.fillStyle = "#d8b020";
    ctx.fillRect(30, 286, 196, 76);
    ctx.fillStyle = "#141414";
    ctx.font = "800 30px Rajdhani, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ALTA", 128, 308);
    ctx.fillText("TENSIÓN", 128, 340);
  });
}

/** La lancha del muelle: casco de madera, cabina chica y motor abierto hasta que se arregla. */
export function buildBoat(planks: THREE.Material, steel: THREE.Material, rust: THREE.Material): { group: THREE.Group; lamp: THREE.MeshStandardMaterial; engine: THREE.Object3D } {
  const g = new THREE.Group();
  // El casco: una planta de lancha extruida, angosta adelante.
  const L = 8.4;
  const B = 2.8;
  const plan = new THREE.Shape();
  plan.moveTo(-L / 2, -B / 2);
  plan.lineTo(L * 0.18, -B / 2);
  plan.quadraticCurveTo(L * 0.42, -B * 0.32, L / 2, 0);
  plan.quadraticCurveTo(L * 0.42, B * 0.32, L * 0.18, B / 2);
  plan.lineTo(-L / 2, B / 2);
  plan.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(plan, { depth: 1.5, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.14, bevelSegments: 2 });
  hullGeo.rotateX(-Math.PI / 2);
  // Los UV de la extrusión están en metros, que es lo que espera la textura.
  const paint = new THREE.MeshStandardMaterial({ color: 0x8c8676, roughness: 0.75, metalness: 0.05, envMapIntensity: 0.3 });
  const hull = new THREE.Mesh(hullGeo, paint);
  g.add(hull);
  // La línea de flotación, pintada de rojo óxido, y la borda clara.
  const waterline = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: 0x5a2018, roughness: 0.85 }));
  waterline.scale.set(1.012, 0.34, 1.012);
  g.add(waterline);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.72, 0.08, B - 0.34), planks);
  deck.position.set(-L * 0.1, 1.66, 0);
  g.add(deck);
  // Bordas, la proa y unos salvavidas colgados.
  for (const z of [-(B - 0.24) / 2, (B - 0.24) / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L * 0.72, 0.16, 0.12), paint);
    rail.position.set(-L * 0.1, 1.76, z);
    g.add(rail);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 8, 18), new THREE.MeshStandardMaterial({ color: 0xb04a20, roughness: 0.7 }));
    ring.position.set(-1.8, 1.05, z * 1.14);
    g.add(ring);
  }
  const stern = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, B - 0.2), paint);
  stern.position.set(-L / 2 + 0.06, 1.76, 0);
  g.add(stern);
  // El mástil corto con su antena.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.8, 8), steel);
  mast.position.set(0.3, 3.9, 0);
  g.add(mast);
  // La cabina con sus ventanas.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.35, 1.9), paint);
  cabin.position.set(0.3, 2.3, 0);
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 2.2), steel);
  roof.position.set(0.3, 3.02, 0);
  g.add(roof);
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.15, metalness: 0.6 });
  for (const z of [-0.96, 0.96]) {
    for (const x of [-0.3, 0.9]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.02), glass);
      w.position.set(x, 2.5, z);
      g.add(w);
    }
  }
  // La luz de proa: apagada hasta que anda.
  const lamp = new THREE.MeshStandardMaterial({ color: 0x1a1810, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), lamp);
  bulb.position.set(1.5, 3.2, 0);
  g.add(bulb);
  // El motor, afuera: se va cuando se arregla la lancha.
  const engine = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.7), rust);
  block.position.set(-2.8, 1.9, 0);
  engine.add(block);
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8), steel);
    c.position.set(-3.05 + i * 0.25, 2.28, 0);
    engine.add(c);
  }
  g.add(engine);
  return { group: g, lamp, engine };
}

/** Los objetos de la fuga: la llave y las cuatro piezas de la lancha. */
export function buildQuestItem(kind: number, puff: THREE.Texture, brass: THREE.Material, iron: THREE.Material, wood: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    g.add(mesh);
    return mesh;
  };
  if (kind === 0) {
    // La llave: argolla, caña y dientes.
    add(new THREE.TorusGeometry(0.07, 0.016, 8, 18), brass);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), brass, 0, -0.16, 0);
    add(new THREE.BoxGeometry(0.06, 0.022, 0.016), brass, 0.03, -0.24, 0);
    add(new THREE.BoxGeometry(0.045, 0.022, 0.016), brass, 0.024, -0.2, 0);
  } else if (kind === 1) {
    // Las bujías: un cajoncito con cuatro.
    add(new THREE.BoxGeometry(0.34, 0.06, 0.16), wood);
    for (let i = 0; i < 4; i++) {
      add(new THREE.CylinderGeometry(0.018, 0.022, 0.12, 8), iron, -0.12 + i * 0.08, 0.08, 0);
      add(new THREE.CylinderGeometry(0.01, 0.014, 0.05, 8), brass, -0.12 + i * 0.08, 0.16, 0);
    }
  } else if (kind === 2) {
    // La hélice: tres palas.
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), brass, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(new THREE.BoxGeometry(0.1, 0.24, 0.018), brass, Math.sin(a) * 0.15, Math.cos(a) * 0.15, 0, 0.3, 0, -a);
    }
  } else if (kind === 3) {
    // El bidón: chapa roja, manija y tapa.
    add(new THREE.BoxGeometry(0.24, 0.32, 0.12), new THREE.MeshStandardMaterial({ color: 0x6a1a14, roughness: 0.55, metalness: 0.5 }));
    add(new THREE.BoxGeometry(0.12, 0.022, 0.03), iron, 0, 0.19, 0);
    add(new THREE.CylinderGeometry(0.024, 0.024, 0.05, 8), brass, 0.08, 0.18, 0);
  } else {
    // El timón: aro de madera con rayos.
    add(new THREE.TorusGeometry(0.17, 0.018, 8, 22), wood);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.34, 0.02, 0.02), brass, 0, 0, 0, 0, 0, (i / 3) * Math.PI);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10), brass, 0, 0, 0, Math.PI / 2);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xffd9a0, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(0.85);
  g.add(halo);
  return g;
}

/** Un cartel pintado a plantilla en la pared. */
export function stencil(text: string, width: number, color = "rgba(30,28,24,0.82)", size = 120): THREE.Mesh {
  const w = 1024;
  const h = 192;
  const tex = canvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.font = `800 ${size}px "Special Elite", Rajdhani, Impact, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2, w - 40);
    // Gastada: se le comen pedazos de pintura.
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.7})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 7, 1 + Math.random() * 5);
    }
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, (width * h) / w), mat);
}

/** Las manchas del piso: atlas de cuatro (dos de sangre, una de agua y una de hollín). */
export function makeStainAtlas(): THREE.Texture {
  const S = 512;
  return canvasTexture(S, S, (ctx) => {
    ctx.clearRect(0, 0, S, S);
    const cell = S / 2;
    const blob = (cx: number, cy: number, n: number, spread: number, rMax: number, color: string) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.pow(Math.random(), 1.6) * spread;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const r = 2 + Math.random() * rMax * (1 - d / spread);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    };
    blob(cell * 0.5, cell * 0.5, 90, cell * 0.42, 40, "rgba(48,6,5,0.75)");
    blob(cell * 1.5, cell * 0.5, 160, cell * 0.46, 14, "rgba(52,6,5,0.8)");
    blob(cell * 0.5, cell * 1.5, 40, cell * 0.42, 62, "rgba(6,8,8,0.42)");
    blob(cell * 1.5, cell * 1.5, 70, cell * 0.46, 46, "rgba(5,4,3,0.6)");
  });
}
