import { FABRICA } from "./fabrica.js";
import type { GameMap } from "./types.js";

export * from "./types.js";
export * from "./raycast.js";

/** Los mapas, por índice (el host elige en la sala). */
export const MAPS: readonly GameMap[] = [FABRICA];

export function mapByIndex(i: number): GameMap {
  return MAPS[i] ?? MAPS[0]!;
}
