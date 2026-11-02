import { PLAYER_HALF_W, PLAYER_HEIGHT, STEP_HEIGHT } from "../constants.js";
import type { Box, GameMap } from "../map/types.js";

/**
 * Una grilla de caminos para los zombis: celdas de medio metro, y en cada
 * celda uno o más "nodos", uno por nivel donde alguien parado no choca con
 * nada. De un nodo se pasa al de la celda vecina si se sube un escalón como
 * mucho o se baja hasta MAX_DROP. Las puertas no están en la grilla: se las
 * bloquea al buscar el camino según estén cerradas (`blocked`).
 */
export interface NavGrid {
  cell: number;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  start: Int32Array;
  nodeFloor: Float32Array;
  nodeCell: Int32Array;
  walk: Uint8Array;
  floor: Float32Array;
}

const MAX_DROP = 3.6;
const DROP_COST = 6;

const cache = new WeakMap<GameMap, NavGrid>();

function blockedAt(boxes: readonly Box[], x: number, y: number, z: number): boolean {
  const top = y + PLAYER_HEIGHT;
  for (const b of boxes) {
    if (b.decal) continue;
    if (x + PLAYER_HALF_W > b.minX && x - PLAYER_HALF_W < b.maxX && y < b.maxY && top > b.minY && z + PLAYER_HALF_W > b.minZ && z - PLAYER_HALF_W < b.maxZ)
      return true;
  }
  return false;
}

function floorsAt(boxes: readonly Box[], x: number, z: number): number[] {
  const tops: number[] = [];
  for (const b of boxes) {
    if (b.decal) continue;
    if (x + PLAYER_HALF_W > b.minX && x - PLAYER_HALF_W < b.maxX && z + PLAYER_HALF_W > b.minZ && z - PLAYER_HALF_W < b.maxZ) {
      if (!tops.some((t) => Math.abs(t - b.maxY) < 0.01)) tops.push(b.maxY);
    }
  }
  tops.sort((a, b) => a - b);
  return tops.filter((t) => !blockedAt(boxes, x, t + 0.02, z));
}

export function buildNavGrid(map: GameMap, cell = 0.5): NavGrid {
  const minX = map.bounds.minX;
  const minZ = map.bounds.minZ;
  const cols = Math.ceil((map.bounds.maxX - minX) / cell);
  const rows = Math.ceil((map.bounds.maxZ - minZ) / cell);
  const cells = cols * rows;
  const start = new Int32Array(cells + 1);
  const floors: number[] = [];
  const cellOfNode: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      start[i] = floors.length;
      const x = minX + (c + 0.5) * cell;
      const z = minZ + (r + 0.5) * cell;
      for (const f of floorsAt(map.boxes, x, z)) {
        floors.push(f);
        cellOfNode.push(i);
      }
    }
  }
  start[cells] = floors.length;
  const grid: NavGrid = {
    cell, minX, minZ, cols, rows, start,
    nodeFloor: Float32Array.from(floors),
    nodeCell: Int32Array.from(cellOfNode),
    walk: new Uint8Array(cells),
    floor: new Float32Array(cells).fill(NaN),
  };

  // Sólo lo que se alcanza desde los spawns de los jugadores (con todas las
  // puertas abiertas): afuera del muro no hay grilla, los zombis de afuera
  // caminan derecho a su ventana.
  const n = floors.length;
  const reached = new Uint8Array(n);
  const queue: number[] = [];
  for (const s of map.spawns) {
    const node = nodeAt(grid, s.x, s.y, s.z);
    if (node >= 0 && !reached[node]) {
      reached[node] = 1;
      queue.push(node);
    }
  }
  while (queue.length > 0) {
    const a = queue.pop()!;
    forEachNeighbor(grid, a, (b) => {
      if (!reached[b]) {
        reached[b] = 1;
        queue.push(b);
      }
    });
  }
  const keepFloors: number[] = [];
  const keepCells: number[] = [];
  const newStart = new Int32Array(cells + 1);
  for (let i = 0; i < cells; i++) {
    newStart[i] = keepFloors.length;
    for (let k = start[i]!; k < start[i + 1]!; k++) {
      if (!reached[k]) continue;
      keepFloors.push(floors[k]!);
      keepCells.push(i);
    }
    if (keepFloors.length > newStart[i]!) {
      grid.walk[i] = 1;
      grid.floor[i] = keepFloors[newStart[i]!]!;
    }
  }
  newStart[cells] = keepFloors.length;
  grid.start = newStart;
  grid.nodeFloor = Float32Array.from(keepFloors);
  grid.nodeCell = Int32Array.from(keepCells);
  return grid;
}

export function navGridFor(map: GameMap): NavGrid {
  let g = cache.get(map);
  if (!g) {
    g = buildNavGrid(map);
    cache.set(map, g);
  }
  return g;
}

export function cellOf(g: NavGrid, x: number, z: number): [number, number] {
  return [
    Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.minX) / g.cell))),
    Math.max(0, Math.min(g.rows - 1, Math.floor((z - g.minZ) / g.cell))),
  ];
}

export function cellIndexOf(g: NavGrid, x: number, z: number): number {
  const [c, r] = cellOf(g, x, z);
  return r * g.cols + c;
}

export function cellCenter(g: NavGrid, c: number, r: number): { x: number; z: number } {
  return { x: g.minX + (c + 0.5) * g.cell, z: g.minZ + (r + 0.5) * g.cell };
}

export function walkable(g: NavGrid, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.walk[r * g.cols + c] === 1;
}

/** Las celdas que tapa una caja (para bloquear las puertas cerradas). */
export function cellsOfBox(g: NavGrid, b: Box): number[] {
  const out: number[] = [];
  const [c0, r0] = cellOf(g, b.minX + 0.01, b.minZ + 0.01);
  const [c1, r1] = cellOf(g, b.maxX - 0.01, b.maxZ - 0.01);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * g.cols + c);
  return out;
}

function nodeFrom(g: NavGrid, cell: number, from: number, maxDrop: number): number {
  let best = -1;
  let bestDiff = Infinity;
  for (let k = g.start[cell]!; k < g.start[cell + 1]!; k++) {
    const f = g.nodeFloor[k]!;
    const climb = f - from;
    if (climb > STEP_HEIGHT + 0.01 || -climb > maxDrop) continue;
    const diff = Math.abs(climb);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
}

export function nodeAt(g: NavGrid, x: number, y: number, z: number): number {
  const [c, r] = cellOf(g, x, z);
  const cell = r * g.cols + c;
  let best = -1;
  let bestDiff = Infinity;
  for (let k = g.start[cell]!; k < g.start[cell + 1]!; k++) {
    const diff = Math.abs(g.nodeFloor[k]! - y);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
}

function forEachNeighbor(g: NavGrid, a: number, fn: (b: number, cost: number) => void, blocked?: ReadonlySet<number>): void {
  const cell = g.nodeCell[a]!;
  const c = cell % g.cols;
  const r = (cell - c) / g.cols;
  const from = g.nodeFloor[a]!;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue;
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const ncell = nr * g.cols + nc;
      if (blocked?.has(ncell)) continue;
      const diagonal = dc !== 0 && dr !== 0;
      if (diagonal) {
        const sideA = r * g.cols + (c + dc);
        const sideB = (r + dr) * g.cols + c;
        if (blocked?.has(sideA) || blocked?.has(sideB)) continue;
        if (nodeFrom(g, sideA, from, STEP_HEIGHT) < 0 || nodeFrom(g, sideB, from, STEP_HEIGHT) < 0) continue;
      }
      const b = nodeFrom(g, ncell, from, MAX_DROP);
      if (b < 0) continue;
      const drop = from - g.nodeFloor[b]!;
      fn(b, (diagonal ? 1.41 : 1) + (drop > STEP_HEIGHT + 0.01 ? DROP_COST : 0));
    }
  }
}

function nearestNode(g: NavGrid, x: number, y: number, z: number): number {
  const direct = nodeAt(g, x, y, z);
  if (direct >= 0) return direct;
  const [c0, r0] = cellOf(g, x, z);
  for (let radius = 1; radius < 8; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (!walkable(g, c, r)) continue;
        const center = cellCenter(g, c, r);
        return nodeAt(g, center.x, y, center.z);
      }
    }
  }
  return -1;
}

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * A* de (fromX, fromY, fromZ) a (toX, toY, toZ). `blocked` son celdas por las
 * que no se pasa (las puertas cerradas). Devuelve los puntos del camino sin el
 * de partida, simplificado; null si no hay camino.
 */
export function findPath(g: NavGrid, fromX: number, fromZ: number, toX: number, toZ: number, fromY = 0, toY = NaN, blocked?: ReadonlySet<number>): NavPoint[] | null {
  const si = nearestNode(g, fromX, fromY, fromZ);
  const gi = nearestNode(g, toX, Number.isNaN(toY) ? -1e6 : toY, toZ);
  if (si < 0 || gi < 0) return null;
  if (si === gi) return [pointOf(g, gi)];

  const n = g.nodeFloor.length;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  gScore[si] = 0;
  const heapF: number[] = [];
  const heapI: number[] = [];
  const push = (f: number, i: number) => {
    heapF.push(f);
    heapI.push(i);
    let k = heapF.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p]! <= heapF[k]!) break;
      [heapF[p], heapF[k]] = [heapF[k]!, heapF[p]!];
      [heapI[p], heapI[k]] = [heapI[k]!, heapI[p]!];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heapI[0]!;
    const lastF = heapF.pop()!;
    const lastI = heapI.pop()!;
    if (heapF.length > 0) {
      heapF[0] = lastF;
      heapI[0] = lastI;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heapF.length && heapF[l]! < heapF[m]!) m = l;
        if (r < heapF.length && heapF[r]! < heapF[m]!) m = r;
        if (m === k) break;
        [heapF[m], heapF[k]] = [heapF[k]!, heapF[m]!];
        [heapI[m], heapI[k]] = [heapI[k]!, heapI[m]!];
        k = m;
      }
    }
    return top;
  };
  const gCell = g.nodeCell[gi]!;
  const gc = gCell % g.cols;
  const gr = (gCell - gc) / g.cols;
  const h = (i: number) => {
    const cell = g.nodeCell[i]!;
    const c = cell % g.cols;
    const r = (cell - c) / g.cols;
    const dx = Math.abs(c - gc);
    const dz = Math.abs(r - gr);
    return Math.max(dx, dz) + 0.41 * Math.min(dx, dz);
  };
  push(h(si), si);

  let found = false;
  while (heapF.length > 0) {
    const cur = pop();
    if (cur === gi) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    forEachNeighbor(
      g,
      cur,
      (ni, stepCost) => {
        if (closed[ni]) return;
        const cost = gScore[cur]! + stepCost;
        if (cost < gScore[ni]!) {
          gScore[ni] = cost;
          came[ni] = cur;
          push(cost + h(ni), ni);
        }
      },
      blocked,
    );
  }
  if (!found) return null;

  const nodes: number[] = [];
  for (let i = gi; i !== si && i !== -1; i = came[i]!) nodes.push(i);
  nodes.reverse();
  const out: NavPoint[] = [];
  let prevDir = "";
  for (let k = 0; k < nodes.length; k++) {
    const i = nodes[k]!;
    const cell = g.nodeCell[i]!;
    const c = cell % g.cols;
    const r = (cell - c) / g.cols;
    const prev = k === 0 ? si : nodes[k - 1]!;
    const pCell = g.nodeCell[prev]!;
    const pc = pCell % g.cols;
    const pr = (pCell - pc) / g.cols;
    const dir = `${c - pc},${r - pr},${Math.abs(g.nodeFloor[i]! - g.nodeFloor[prev]!) > 0.01 ? "^" : ""}`;
    if (dir === prevDir && out.length > 0) out.pop();
    out.push(pointOf(g, i));
    prevDir = dir;
  }
  return out;
}

function pointOf(g: NavGrid, node: number): NavPoint {
  const cell = g.nodeCell[node]!;
  const c = cell % g.cols;
  const r = (cell - c) / g.cols;
  const { x, z } = cellCenter(g, c, r);
  return { x, y: g.nodeFloor[node]!, z };
}

/** ¿Hay un nodo caminable (piso) cerca de este punto? Para validar spawners y lugares del mapa. */
export function hasFloorNear(g: NavGrid, x: number, z: number, radiusCells = 1): boolean {
  const [c0, r0] = cellOf(g, x, z);
  for (let dc = -radiusCells; dc <= radiusCells; dc++) for (let dr = -radiusCells; dr <= radiusCells; dr++) if (walkable(g, c0 + dc, r0 + dr)) return true;
  return false;
}
