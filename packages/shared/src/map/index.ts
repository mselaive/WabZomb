import { FABRICA } from "./fabrica.js";
import { ROCA } from "./roca.js";
import type { GameMap } from "./types.js";

export * from "./types.js";
export * from "./raycast.js";
export * from "./lightmap.js";

/** Los mapas, por índice (el host elige en la sala). */
export const MAPS: readonly GameMap[] = [ROCA, FABRICA];

export function mapByIndex(i: number): GameMap {
  return MAPS[i] ?? MAPS[0]!;
}
