import type { Box, GameMap } from "./types.js";

/**
 * Dónde va cada cara de cada caja en el lightmap. Lo calculan igual el cliente y
 * la herramienta que hornea (tools/bake.ts), así la imagen no necesita ningún
 * dato aparte: cambia el mapa, se vuelve a hornear.
 */
export interface LmRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LmLayout {
  size: number;
  density: number;
  /** Por índice de caja en map.boxes: las seis caras (+x, -x, +y, -y, +z, -z). null si no lleva. */
  faces: (LmRect | null)[][];
}

/** Lo más brillante que entra en la imagen: el cliente lo multiplica de vuelta. */
export const LM_RANGE = 4;

const PAD = 1;

function faceSizes(b: Box): [number, number][] {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const d = b.maxZ - b.minZ;
  if (b.shape === "cyl") return [[Math.PI * Math.min(w, d), h], [0, 0], [w, d], [0, 0], [0, 0], [0, 0]];
  return [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
}

function tryLayout(map: GameMap, size: number, density: number): LmLayout | null {
  const items: { box: number; face: number; w: number; h: number }[] = [];
  map.boxes.forEach((b, box) => {
    if (b.hidden) return;
    const d = density * (b.lm ?? 1);
    faceSizes(b).forEach(([fw, fh], face) => {
      if (fw <= 0 || fh <= 0) return;
      // Sin caras que nunca se ven: la de abajo de lo que está apoyado.
      if (face === 3 && (b.minY <= -0.5 || b.decal)) return;
      items.push({ box, face, w: Math.max(2, Math.min(size - 2, Math.ceil(fw * d))), h: Math.max(2, Math.min(size - 2, Math.ceil(fh * d))) });
    });
  });
  items.sort((a, b) => b.h - a.h || b.w - a.w || a.box - b.box || a.face - b.face);
  const faces: (LmRect | null)[][] = map.boxes.map(() => [null, null, null, null, null, null]);
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const it of items) {
    if (x + it.w + PAD * 2 > size) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    if (y + it.h + PAD * 2 > size) return null;
    faces[it.box]![it.face] = { x: x + PAD, y: y + PAD, w: it.w, h: it.h };
    x += it.w + PAD * 2;
    shelf = Math.max(shelf, it.h + PAD * 2);
  }
  return { size, density, faces };
}

export function lightmapLayout(map: GameMap, size = 2048, startDensity = 7): LmLayout {
  for (let density = startDensity; density > 0.5; density *= 0.94) {
    const layout = tryLayout(map, size, density);
    if (layout) return layout;
  }
  throw new Error("El lightmap no alcanza");
}

/**
 * El punto de una cara de una caja, con (u, v) de 0 a 1, en el mismo orden que
 * los UV de THREE.BoxGeometry. También devuelve la normal.
 */
export function lmFacePoint(b: Box, face: number, u: number, v: number, out: { x: number; y: number; z: number; nx: number; ny: number; nz: number }): void {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const d = b.maxZ - b.minZ;
  out.nx = out.ny = out.nz = 0;
  switch (face) {
    case 0:
      out.x = b.maxX;
      out.y = b.minY + v * h;
      out.z = b.maxZ - u * d;
      out.nx = 1;
      break;
    case 1:
      out.x = b.minX;
      out.y = b.minY + v * h;
      out.z = b.minZ + u * d;
      out.nx = -1;
      break;
    case 2:
      out.x = b.minX + u * w;
      out.y = b.maxY;
      out.z = b.minZ + (1 - v) * d;
      out.ny = 1;
      break;
    case 3:
      out.x = b.minX + u * w;
      out.y = b.minY;
      out.z = b.maxZ - (1 - v) * d;
      out.ny = -1;
      break;
    case 4:
      out.x = b.minX + u * w;
      out.y = b.minY + v * h;
      out.z = b.maxZ;
      out.nz = 1;
      break;
    default:
      out.x = b.maxX - u * w;
      out.y = b.minY + v * h;
      out.z = b.minZ;
      out.nz = -1;
      break;
  }
}
