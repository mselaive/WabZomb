import * as THREE from "three";
import {
  TEX_ASPHALT,
  TEX_BARREL,
  TEX_BOARDS,
  TEX_BRICK,
  TEX_CONCRETE,
  TEX_CONTAINER,
  TEX_COUNT,
  TEX_CRATE,
  TEX_DIRT,
  TEX_FENCE,
  TEX_FLOOR,
  TEX_GRATE,
  TEX_LAB,
  TEX_METAL,
  TEX_PLASTER,
  TEX_ROOF,
  TEX_RUST,
  TEX_SANDBAG,
  TEX_TILES,
  TEX_WOOD,
} from "@wabzomb/shared";

/**
 * Texturas generadas por código: nada que descargar. Un tile = 1 m del mundo.
 * Todo está sucio y gastado a propósito: es una fábrica abandonada de noche.
 */

const SIZE = 512;

interface Style {
  base: string;
  line: string;
  fine: string;
  deco?: "planks" | "rivets" | "tiles" | "bricks" | "asphalt" | "plaster" | "ribs" | "sacks" | "barrel" | "dirt" | "fence" | "grate" | "checker" | "rust" | "boards";
  bevel: number;
  grime: number;
}

const STYLES: Record<number, Style> = {
  [TEX_FLOOR]: { base: "#6d6f6e", line: "#4a4c4b", fine: "#626463", deco: "tiles", bevel: 0.3, grime: 1.1 },
  [TEX_CONCRETE]: { base: "#7c7f80", line: "#55585a", fine: "#737677", bevel: 0.35, grime: 1.0 },
  [TEX_CRATE]: { base: "#8a6238", line: "#4f341a", fine: "#7d582f", deco: "planks", bevel: 0.3, grime: 0.8 },
  [TEX_METAL]: { base: "#4f565e", line: "#2c3136", fine: "#484e55", deco: "rivets", bevel: 0.6, grime: 0.7 },
  [TEX_BRICK]: { base: "#6e4034", line: "#36201a", fine: "#653a2f", deco: "bricks", bevel: 0.5, grime: 1.0 },
  [TEX_PLASTER]: { base: "#9b958a", line: "#6b665c", fine: "#908a7f", deco: "plaster", bevel: 0.15, grime: 1.3 },
  [TEX_WOOD]: { base: "#9a7850", line: "#5e4528", fine: "#8c6c46", deco: "planks", bevel: 0.25, grime: 0.7 },
  [TEX_ROOF]: { base: "#3b4046", line: "#23272b", fine: "#363b40", deco: "rivets", bevel: 0.4, grime: 0.9 },
  [TEX_ASPHALT]: { base: "#3e4145", line: "#282a2d", fine: "#3a3d40", deco: "asphalt", bevel: 0, grime: 1.1 },
  [TEX_TILES]: { base: "#8f8b80", line: "#5a574f", fine: "#85817a", deco: "checker", bevel: 0.3, grime: 1.0 },
  [TEX_RUST]: { base: "#6b4a30", line: "#3a2616", fine: "#62432b", deco: "rust", bevel: 0.3, grime: 1.0 },
  [TEX_DIRT]: { base: "#4e4a3c", line: "#33302a", fine: "#48453a", deco: "dirt", bevel: 0, grime: 1.2 },
  [TEX_FENCE]: { base: "#8d949a", line: "#55595e", fine: "#8d949a", deco: "fence", bevel: 0, grime: 0 },
  [TEX_BARREL]: { base: "#5a4a2a", line: "#2c2415", fine: "#524426", deco: "barrel", bevel: 0.3, grime: 1.0 },
  [TEX_SANDBAG]: { base: "#8d8160", line: "#5a523b", fine: "#847857", deco: "sacks", bevel: 0.2, grime: 0.8 },
  [TEX_CONTAINER]: { base: "#4b6a4a", line: "#263a26", fine: "#466345", deco: "ribs", bevel: 0.3, grime: 1.1 },
  [TEX_GRATE]: { base: "#45494c", line: "#1f2224", fine: "#404447", deco: "grate", bevel: 0.2, grime: 0.9 },
  [TEX_LAB]: { base: "#b9bcb6", line: "#7d8079", fine: "#afb2ac", deco: "tiles", bevel: 0.25, grime: 1.2 },
  [TEX_BOARDS]: { base: "#7d5a35", line: "#3e2a15", fine: "#70502f", deco: "boards", bevel: 0.3, grime: 0.9 },
};

let seed = 12345;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function noise(ctx: CanvasRenderingContext2D, amount: number): void {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (rnd() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);
}

function grime(ctx: CanvasRenderingContext2D, amount: number): void {
  for (let i = 0; i < 14 * amount; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const r = 20 + rnd() * 110;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.75;
    g.addColorStop(0, dark ? `rgba(0,0,0,${0.14 * amount})` : `rgba(255,255,255,${0.06 * amount})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Chorreaduras de humedad desde arriba.
  if (amount > 0.9) {
    for (let i = 0; i < 5; i++) {
      const x = rnd() * SIZE;
      const w = 6 + rnd() * 20;
      const g = ctx.createLinearGradient(0, 0, 0, SIZE * (0.4 + rnd() * 0.6));
      g.addColorStop(0, "rgba(0,0,0,0.25)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, SIZE);
    }
  }
}

function bevel(ctx: CanvasRenderingContext2D, cells: number, strength: number): void {
  if (strength <= 0) return;
  const s = SIZE / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = i * s;
      const y = j * s;
      ctx.fillStyle = `rgba(255,255,255,${0.2 * strength})`;
      ctx.fillRect(x, y, s, 3);
      ctx.fillRect(x, y, 3, s);
      ctx.fillStyle = `rgba(0,0,0,${0.3 * strength})`;
      ctx.fillRect(x, y + s - 3, s, 3);
      ctx.fillRect(x + s - 3, y, 3, s);
    }
  }
}

function shade(hex: string, delta: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + delta));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + delta));
  const b = Math.max(0, Math.min(255, (n & 255) + delta));
  return `rgb(${r},${g},${b})`;
}

function bricks(ctx: CanvasRenderingContext2D, rows: number, perRow: number, style: Style): void {
  const h = SIZE / rows;
  const w = SIZE / perRow;
  ctx.fillStyle = style.line;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 0 ? 0 : w / 2;
    for (let c = -1; c <= perRow; c++) {
      const x = c * w + off + 3;
      const y = r * h + 3;
      ctx.fillStyle = shade(style.base, (rnd() - 0.5) * 36);
      ctx.fillRect(x, y, w - 6, h - 6);
      ctx.fillStyle = `rgba(255,255,255,${0.14 * style.bevel})`;
      ctx.fillRect(x, y, w - 6, 2);
      ctx.fillStyle = `rgba(0,0,0,${0.3 * style.bevel})`;
      ctx.fillRect(x, y + h - 8, w - 6, 2);
      // Algún ladrillo roto.
      if (rnd() < 0.08) {
        ctx.fillStyle = style.line;
        ctx.fillRect(x + (w - 6) * 0.5, y, (w - 6) * 0.5, h - 6);
      }
    }
  }
}

function planks(ctx: CanvasRenderingContext2D, style: Style, count: number, nails = true): void {
  noise(ctx, 18);
  grime(ctx, style.grime);
  ctx.strokeStyle = style.line;
  ctx.lineWidth = 4;
  for (let i = 0; i < count; i++) {
    const y = (SIZE / count) * i + SIZE / (count * 2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const y = rnd() * SIZE;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(SIZE / 3, y + (rnd() - 0.5) * 12, (SIZE * 2) / 3, y + (rnd() - 0.5) * 12, SIZE, y);
    ctx.stroke();
  }
  if (nails) {
    ctx.fillStyle = style.line;
    for (let i = 0; i < count; i++) {
      const y = (SIZE / count) * i + SIZE / (count * 2);
      ctx.fillRect(28, y - 5, 7, 7);
      ctx.fillRect(SIZE - 36, y - 5, 7, 7);
    }
  }
}

export function makeTexture(tex: number): THREE.Texture {
  const style = STYLES[tex] ?? STYLES[TEX_CONCRETE]!;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  seed = 12345 + tex * 977;

  if (style.deco !== "fence") {
    ctx.fillStyle = style.base;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  switch (style.deco) {
    case "bricks":
      bricks(ctx, 8, 4, style);
      noise(ctx, 16);
      grime(ctx, style.grime);
      break;
    case "planks":
      planks(ctx, style, 4);
      bevel(ctx, 1, style.bevel);
      break;
    case "boards":
      planks(ctx, style, 3);
      break;
    case "rivets": {
      noise(ctx, 18);
      grime(ctx, style.grime);
      bevel(ctx, 2, style.bevel);
      ctx.fillStyle = style.line;
      for (const x of [22, SIZE / 2 - 4, SIZE - 30]) for (const y of [22, SIZE / 2 - 4, SIZE - 30]) ctx.fillRect(x, y, 8, 8);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      for (const x of [22, SIZE / 2 - 4, SIZE - 30]) for (const y of [22, SIZE / 2 - 4, SIZE - 30]) ctx.fillRect(x + 1, y + 1, 3, 3);
      break;
    }
    case "tiles": {
      noise(ctx, 18);
      grime(ctx, style.grime);
      bevel(ctx, 4, style.bevel);
      // Alguna baldosa rota.
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = style.line;
        const cx = Math.floor(rnd() * 4) * (SIZE / 4);
        const cy = Math.floor(rnd() * 4) * (SIZE / 4);
        ctx.beginPath();
        ctx.moveTo(cx + 10, cy + 20);
        ctx.lineTo(cx + 60, cy + 40);
        ctx.lineTo(cx + 110, cy + 110);
        ctx.lineWidth = 3;
        ctx.strokeStyle = style.line;
        ctx.stroke();
      }
      break;
    }
    case "checker": {
      const n = 4;
      const s = SIZE / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? shade(style.base, (rnd() - 0.5) * 20) : shade(style.line, (rnd() - 0.5) * 20 + 30);
          ctx.fillRect(i * s, j * s, s, s);
        }
      }
      noise(ctx, 14);
      grime(ctx, style.grime);
      bevel(ctx, n, style.bevel);
      break;
    }
    case "asphalt": {
      noise(ctx, 26);
      grime(ctx, style.grime);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        let x = rnd() * SIZE;
        let y = rnd() * SIZE;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 8; k++) {
          x += (rnd() - 0.5) * 60;
          y += (rnd() - 0.5) * 60;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      for (let i = 0; i < 300; i++) ctx.fillRect(rnd() * SIZE, rnd() * SIZE, 2, 2);
      break;
    }
    case "dirt": {
      noise(ctx, 30);
      grime(ctx, style.grime);
      // Pastos secos y piedras.
      ctx.strokeStyle = "rgba(120,110,60,0.35)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 120; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rnd() - 0.5) * 14, y - 8 - rnd() * 14);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let i = 0; i < 60; i++) ctx.fillRect(rnd() * SIZE, rnd() * SIZE, 3 + rnd() * 4, 2 + rnd() * 3);
      break;
    }
    case "plaster": {
      noise(ctx, 12);
      for (let i = 0; i < 40; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        const r = 6 + rnd() * 22;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${0.05 + rnd() * 0.06})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // Revoque saltado: se ve el ladrillo.
      for (let i = 0; i < 3; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        const w = 40 + rnd() * 80;
        const h = 30 + rnd() * 60;
        ctx.fillStyle = "#5b3a30";
        ctx.beginPath();
        ctx.moveTo(x, y + h * 0.3);
        ctx.lineTo(x + w * 0.4, y);
        ctx.lineTo(x + w, y + h * 0.4);
        ctx.lineTo(x + w * 0.7, y + h);
        ctx.lineTo(x + w * 0.2, y + h * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#2e1c15";
        ctx.lineWidth = 2;
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(x, y + (h * k) / 4);
          ctx.lineTo(x + w, y + (h * k) / 4);
          ctx.stroke();
        }
      }
      const base = ctx.createLinearGradient(0, SIZE - 90, 0, SIZE);
      base.addColorStop(0, "rgba(0,0,0,0)");
      base.addColorStop(1, "rgba(0,0,0,0.3)");
      ctx.fillStyle = base;
      ctx.fillRect(0, SIZE - 90, SIZE, 90);
      grime(ctx, style.grime);
      break;
    }
    case "ribs": {
      noise(ctx, 10);
      grime(ctx, style.grime);
      const n = 8;
      const w = SIZE / n;
      for (let i = 0; i < n; i++) {
        const x = i * w;
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(x, 0, w * 0.3, SIZE);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(x + w * 0.55, 0, w * 0.3, SIZE);
      }
      for (let i = 0; i < 14; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        const r = 10 + rnd() * 50;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(130,60,20,0.55)");
        g.addColorStop(1, "rgba(130,60,20,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      break;
    }
    case "rust": {
      noise(ctx, 22);
      for (let i = 0; i < 30; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        const r = 10 + rnd() * 70;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rnd() < 0.5 ? "rgba(160,70,20,0.5)" : "rgba(40,20,10,0.5)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      grime(ctx, style.grime);
      bevel(ctx, 1, style.bevel);
      break;
    }
    case "sacks": {
      noise(ctx, 16);
      const rows = 3;
      const h = SIZE / rows;
      const w = SIZE / 2;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 === 0 ? 0 : w / 2;
        for (let c = -1; c <= 2; c++) {
          const cx = c * w + off + w / 2;
          const cy = r * h + h / 2;
          ctx.fillStyle = shade(style.base, (rnd() - 0.5) * 24);
          ctx.beginPath();
          ctx.ellipse(cx, cy, w / 2 - 4, h / 2 - 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = style.line;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
      grime(ctx, style.grime);
      break;
    }
    case "barrel": {
      noise(ctx, 18);
      grime(ctx, style.grime);
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, SIZE * 0.3, SIZE, 14);
      ctx.fillRect(0, SIZE * 0.7, SIZE, 14);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(0, SIZE * 0.3 - 4, SIZE, 4);
      ctx.fillRect(0, SIZE * 0.7 - 4, SIZE, 4);
      break;
    }
    case "grate": {
      // Rejilla metálica: franjas con huecos oscuros.
      noise(ctx, 14);
      const n = 8;
      const s = SIZE / n;
      ctx.fillStyle = style.line;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ctx.fillRect(i * s + 6, j * s + 6, s - 12, s - 12);
      grime(ctx, style.grime);
      break;
    }
    case "fence": {
      // Alambrado: transparente, con el tejido en rombos.
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = style.base;
      ctx.lineWidth = 4;
      const s = SIZE / 8;
      for (let i = -8; i < 16; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s, 0);
        ctx.lineTo(i * s + SIZE, SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(i * s, SIZE);
        ctx.lineTo(i * s + SIZE, 0);
        ctx.stroke();
      }
      // Postes cada metro.
      ctx.fillStyle = style.line;
      ctx.fillRect(0, 0, 14, SIZE);
      ctx.fillRect(0, 0, SIZE, 10);
      break;
    }
    default:
      noise(ctx, 18);
      grime(ctx, style.grime);
      bevel(ctx, 2, style.bevel);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (tex === TEX_SANDBAG) texture.repeat.set(2, 2);
  return texture;
}

export function makeAllMaterials(): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < TEX_COUNT; i++) {
    const metal = i === TEX_METAL || i === TEX_CONTAINER || i === TEX_BARREL || i === TEX_RUST || i === TEX_GRATE || i === TEX_ROOF;
    const fence = i === TEX_FENCE;
    out.push(
      new THREE.MeshStandardMaterial({
        map: makeTexture(i),
        roughness: metal ? 0.6 : 0.9,
        metalness: metal ? 0.4 : 0.0,
        envMapIntensity: metal ? 0.7 : 0.3,
        ...(fence ? { transparent: true, alphaTest: 0.4, side: THREE.DoubleSide } : {}),
      }),
    );
  }
  return out;
}

/** Una textura redonda suave para chispas, polvo y sangre. */
export function makePuffTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeBulletHoleTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(20,16,12,1)");
  g.addColorStop(0.35, "rgba(30,24,18,0.95)");
  g.addColorStop(0.6, "rgba(60,50,40,0.5)");
  g.addColorStop(1, "rgba(80,70,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Un cartelito con texto (nombres sobre los compañeros, carteles de las máquinas). */
export function makeLabelTexture(text: string, color: string, width = 256, size = 34): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = `bold ${size}px Rajdhani, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(text, width / 2, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * La tiza de un arma de pared: el contorno del arma en blanco sobre la pared,
 * con el nombre y el precio debajo. Es una textura plana que se pega al muro.
 */
export function makeChalkTexture(name: string, price: number, silhouette: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 256);
  ctx.strokeStyle = "rgba(240,240,235,0.92)";
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  silhouette(ctx, 512, 170);
  ctx.font = "bold 46px Rajdhani, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(240,240,235,0.92)";
  ctx.fillText(name.toUpperCase(), 256, 212);
  ctx.font = "bold 36px Rajdhani, ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,210,120,0.95)";
  ctx.fillText(`${price}`, 256, 248);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
