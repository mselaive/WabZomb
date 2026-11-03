import {
  BOARD_MAX,
  BOARD_PAID_PER_ROUND,
  BOARD_POINTS,
  BOARD_RANGE,
  BOARD_REPAIR_TICKS,
  BOX_FIRE_SALE_PRICE,
  BOX_PRICE,
  BOX_SPIN_TICKS,
  BOX_TAKE_TICKS,
  BOX_TEDDY_FREE_USES,
  AXE_PRICE,
  BOARD_RADIUS,
  BREAKER_TICKS,
  EGG_BOSS_DEAD,
  EGG_BREAKERS,
  EGG_SAFE,
  FORGE_TICKS,
  TICK_RATE,
  EGG_BEACON,
  EGG_BOAT,
  EGG_BOAT_PARTS,
  EGG_ESCAPED,
  EGG_KEY,
  EGG_READY,
  ESCAPE_SIEGE_TICKS,
  DRINK_TICKS,
  EGG_BUILT,
  EGG_FURNACE,
  EGG_PART_A,
  EGG_PART_B,
  EGG_PART_C,
  EGG_PART_NAMES,
  EGG_RADIOS,
  EGG_SONG,
  EGG_SONG_TICKS,
  EGG_SOULS,
  FRAG_MAX,
  PAP_AMMO_PRICE,
  PAP_PRICE,
  PAP_TAKE_TICKS,
  PAP_TICKS,
  PERK_COUNT,
  PERK_MAX,
  PERK_NAMES,
  PERK_PRICES,
  PERK_QUICK,
  PERK_QUICK_SOLO_PRICE,
  REVIVE_HP,
  REVIVE_RANGE,
  REVIVE_TICKS,
  SOLO_REVIVE_MAX,
  USE_RANGE,
  WALL_AMMO_FACTOR,
} from "../constants.js";
import type { Box, GameMap } from "../map/types.js";
import { BRASAS, FRAG, KNIFE, SLOT_COUNT, THUNDERGUN, TRABUCO, rollBox, weapon, weaponStats } from "../weapons.js";
import { applyPerk, givePoints, revivePlayer, slotLimit, switchTo } from "./combat.js";
import { hasPerk } from "./movement.js";
import type { GameState, PlayerInput, PlayerState, SimEvent } from "./types.js";

export type InteractionKind = "revive" | "boxTake" | "papTake" | "box" | "pap" | "perk" | "wall" | "ammo" | "grenades" | "door" | "power" | "radio" | "part" | "bench" | "barrier" | "quest";

/** Lo que haría E ahora: para el servidor (aplicarlo) y para el HUD (el cartel). */
export interface Interaction {
  kind: InteractionKind;
  /** Puerta, ventana, bebida, arma de pared, radio, jugador a revivir. */
  id: number;
  label: string;
  price: number;
  /** Se puede (alcanza la plata, la luz está, etc.). Si no, el cartel lo dice en `why`. */
  ok: boolean;
  why?: string;
  /** Se sostiene (revivir, reparar) o se aprieta. */
  hold: boolean;
}

/** ¿La altura de un cuerpo parado en `y` alcanza esta caja? */
function atHeightOf(b: Box, y: number): boolean {
  return y + 1.8 > b.minY - 0.5 && y < b.maxY + 0.5;
}

/** Distancia en el plano de un punto a una caja (0 si está adentro). */
function distToBox(b: Box, x: number, z: number): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

export function perkPrice(state: GameState, perk: number): number {
  const humans = state.players.filter((p) => p.connected).length;
  if (perk === PERK_QUICK && humans === 1) return PERK_QUICK_SOLO_PRICE;
  return PERK_PRICES[perk] ?? 0;
}

export function boxPrice(state: GameState): number {
  return state.fireSale > 0 ? BOX_FIRE_SALE_PRICE : BOX_PRICE;
}

/** Cuántas armas lleva (ranuras ocupadas). */
export function weaponCount(p: PlayerState): number {
  let n = 0;
  for (let s = 0; s < SLOT_COUNT; s++) if ((p.slots[s] ?? -1) >= 0) n++;
  return n;
}

export function hasWeapon(p: PlayerState, wid: number): number {
  for (let s = 0; s < SLOT_COUNT; s++) if (p.slots[s] === wid) return s;
  return -1;
}

/**
 * Le da un arma: en una ranura libre si hay, si no en lugar de la que tiene en
 * la mano. Cargada y con la reserva llena. Devuelve la ranura.
 */
export function giveWeapon(p: PlayerState, wid: number, pap = false): number {
  const limit = slotLimit(p);
  let slot = -1;
  for (let s = 0; s < limit; s++) {
    if ((p.slots[s] ?? -1) < 0) {
      slot = s;
      break;
    }
  }
  if (slot < 0) slot = p.active < limit ? p.active : 0;
  const stats = weaponStats(wid, pap);
  p.slots[slot] = wid;
  p.ammo[slot] = stats.mag;
  p.reserve[slot] = stats.reserve;
  p.pap[slot] = pap ? 1 : 0;
  switchTo(p, slot);
  return slot;
}

/** Qué hay a mano de este jugador, por prioridad. null si nada. */
export function findInteraction(state: GameState, p: PlayerState, map: GameMap): Interaction | null {
  if (!p.alive) return null;
  const x = p.x;
  const z = p.z;
  const near = (px: number, pz: number, range = USE_RANGE, py = 0) => Math.hypot(px - x, pz - z) <= range && Math.abs(py - p.y) < 2.2;
  const humans = state.players.filter((q) => q.connected).length;

  // Un compañero caído: lo primero.
  if (!p.down) {
    for (const q of state.players) {
      if (q === p || !q.connected || !q.alive || !q.down || q.selfRevive) continue;
      if (near(q.x, q.z, REVIVE_RANGE, q.y)) return { kind: "revive", id: q.id, label: "Revivir", price: 0, ok: true, hold: true };
    }
  }
  if (p.down) return null;

  // La caja con un arma esperando (para el que pagó).
  const spot = map.boxSpots[state.box.spot];
  if (spot && near(spot.x, spot.z, USE_RANGE, spot.y ?? 0)) {
    const b = state.box;
    if (b.phase === 2 && b.forId === p.id) return { kind: "boxTake", id: b.weapon, label: `Agarrar ${weapon(b.weapon).name}`, price: 0, ok: true, hold: false };
    if (b.phase === 0) {
      const price = boxPrice(state);
      return { kind: "box", id: 0, label: "Caja misteriosa", price, ok: p.points >= price, why: p.points < price ? "No te alcanza" : undefined, hold: false };
    }
    if (b.phase === 2) return { kind: "box", id: 0, label: `${weapon(b.weapon).name} (de otro)`, price: 0, ok: false, why: "Esperá que la agarre", hold: false };
    return { kind: "box", id: 0, label: "Caja misteriosa", price: 0, ok: false, why: b.phase === 3 ? "El osito se la lleva" : "Girando...", hold: false };
  }

  // El Pack-a-Punch.
  if (near(map.pap.x, map.pap.z, USE_RANGE + 0.6, map.pap.y ?? 0)) {
    const pp = state.pap;
    if (pp.phase === 2 && pp.forId === p.id) return { kind: "papTake", id: pp.weapon, label: `Agarrar ${weaponStats(pp.weapon, true).name}`, price: 0, ok: true, hold: false };
    if (pp.phase !== 0) return { kind: "pap", id: 0, label: "Pack-a-Punch", price: 0, ok: false, why: pp.phase === 2 ? "Hay un arma esperando a otro" : "Trabajando...", hold: false };
    const wid = p.slots[p.active] ?? -1;
    if (!state.power) return { kind: "pap", id: 0, label: "Pack-a-Punch", price: PAP_PRICE, ok: false, why: "Hace falta la luz", hold: false };
    if (wid < 0) return { kind: "pap", id: 0, label: "Pack-a-Punch", price: PAP_PRICE, ok: false, why: "Sin arma en la mano", hold: false };
    if ((p.pap[p.active] ?? 0) === 1) return { kind: "pap", id: 0, label: "Pack-a-Punch", price: PAP_PRICE, ok: false, why: "Ya está mejorada", hold: false };
    return { kind: "pap", id: wid, label: `Mejorar ${weapon(wid).name}`, price: PAP_PRICE, ok: p.points >= PAP_PRICE, why: p.points < PAP_PRICE ? "No te alcanza" : undefined, hold: false };
  }

  // Las bebidas.
  for (const m of map.perks) {
    if (!near(m.x, m.z, USE_RANGE + 0.4, m.y ?? 0)) continue;
    const price = perkPrice(state, m.perk);
    const name = PERK_NAMES[m.perk] ?? "Bebida";
    if (hasPerk(p, m.perk)) return { kind: "perk", id: m.perk, label: name, price, ok: false, why: "Ya la tenés", hold: false };
    if (!state.power && m.perk !== PERK_QUICK) return { kind: "perk", id: m.perk, label: name, price, ok: false, why: "Hace falta la luz", hold: false };
    if (m.perk === PERK_QUICK && humans === 1 && p.quickRevives >= SOLO_REVIVE_MAX) return { kind: "perk", id: m.perk, label: name, price, ok: false, why: "Ya la usaste tres veces", hold: false };
    let n = 0;
    for (let k = 0; k < PERK_COUNT; k++) if (hasPerk(p, k)) n++;
    if (n >= PERK_MAX) return { kind: "perk", id: m.perk, label: name, price, ok: false, why: "Ya tenés cuatro", hold: false };
    return { kind: "perk", id: m.perk, label: name, price, ok: p.points >= price, why: p.points < price ? "No te alcanza" : undefined, hold: false };
  }

  // Las armas de la pared.
  for (let i = 0; i < map.wallWeapons.length; i++) {
    const ww = map.wallWeapons[i]!;
    if (!near(ww.x, ww.z, USE_RANGE, ww.y - 1.4)) continue;
    const w = weapon(ww.weapon);
    if (ww.weapon === FRAG) {
      const price = 250;
      if (p.grenades >= FRAG_MAX) return { kind: "grenades", id: i, label: "Granadas", price, ok: false, why: "Ya tenés cuatro", hold: false };
      return { kind: "grenades", id: i, label: "Granadas", price, ok: p.points >= price, why: p.points < price ? "No te alcanza" : undefined, hold: false };
    }
    const slot = hasWeapon(p, ww.weapon);
    if (slot >= 0) {
      const upgraded = (p.pap[slot] ?? 0) === 1;
      const price = upgraded ? PAP_AMMO_PRICE : Math.round(w.wall * WALL_AMMO_FACTOR);
      const full = (p.reserve[slot] ?? 0) >= weaponStats(ww.weapon, upgraded).reserve;
      return { kind: "ammo", id: i, label: `Munición de ${w.name}`, price, ok: !full && p.points >= price, why: full ? "Ya la tenés llena" : p.points < price ? "No te alcanza" : undefined, hold: false };
    }
    return { kind: "wall", id: i, label: w.name, price: w.wall, ok: p.points >= w.wall, why: p.points < w.wall ? "No te alcanza" : undefined, hold: false };
  }

  // Las piezas de la Thunder Gun que están en el mapa, y el banco donde se arma.
  const partBits = [EGG_PART_A, EGG_PART_B, EGG_PART_C];
  for (let i = 0; i < map.eggParts.length && i < partBits.length; i++) {
    const part = map.eggParts[i]!;
    if ((state.egg & partBits[i]!) !== 0 || !near(part.x, part.z, 2.0, p.y) || Math.abs(part.y - (p.y + 1.2)) > 2.2) continue;
    // Adentro de un armario cerrado no se agarra nada; el horno sólo la entrega cuando se llenó.
    if (part.door !== undefined && (state.doorsOpen & (1 << part.door)) === 0) continue;
    if (part.souls && (state.egg & EGG_FURNACE) === 0) continue;
    return { kind: "part", id: i, label: `Agarrar ${EGG_PART_NAMES[i]}`, price: 0, ok: true, hold: false };
  }
  // El horno: el cartel de cuántas almas lleva (se alimenta matando al lado, no con E).
  if (near(map.furnace.x, map.furnace.z, USE_RANGE + 0.6, map.furnace.y ?? 0) && (state.egg & EGG_FURNACE) === 0) {
    if ((state.egg & EGG_SONG) === 0) return { kind: "bench", id: 1, label: "El horno", price: 0, ok: false, why: "Frío. Primero las radios", hold: false };
    return { kind: "bench", id: 1, label: "El horno", price: 0, ok: false, why: `Almas: ${state.eggSouls} de ${EGG_SOULS}. Matá zombis acá al lado`, hold: false };
  }
  if (near(map.bench.x, map.bench.z, USE_RANGE + 0.4, map.bench.y ?? 0)) {
    const parts = (state.egg & EGG_PART_A ? 1 : 0) + (state.egg & EGG_PART_B ? 1 : 0) + (state.egg & EGG_PART_C ? 1 : 0);
    if ((state.egg & EGG_BUILT) !== 0) return { kind: "bench", id: 0, label: "Thunder Gun", price: 0, ok: hasWeapon(p, THUNDERGUN) < 0, why: hasWeapon(p, THUNDERGUN) >= 0 ? "Ya la tenés" : undefined, hold: false };
    if (parts === 3) return { kind: "bench", id: 0, label: "Armar la Thunder Gun", price: 0, ok: true, hold: false };
    return { kind: "bench", id: 0, label: "Banco de trabajo", price: 0, ok: false, why: `Faltan piezas (${parts} de 3)`, hold: false };
  }

  // La fuga.
  const fuga = findQuest(state, p, map, near);
  if (fuga) return fuga;

  // Las puertas.
  for (const d of map.doors) {
    if ((state.doorsOpen & (1 << d.id)) !== 0) continue;
    if (distToBox(d.box, x, z) > USE_RANGE || !atHeightOf(d.box, p.y)) continue;
    if (d.locked) return { kind: "door", id: d.id, label: d.name, price: 0, ok: false, why: "Cerrado con llave. Algo lo abre...", hold: false };
    return { kind: "door", id: d.id, label: d.name, price: d.price, ok: p.points >= d.price, why: p.points < d.price ? "No te alcanza" : undefined, hold: false };
  }

  // La luz.
  if (!state.power && near(map.power.x, map.power.z, USE_RANGE, map.power.y ?? 0)) return { kind: "power", id: 0, label: "Prender la luz", price: 0, ok: true, hold: false };

  // Las radios escondidas.
  for (let i = 0; i < map.radios.length; i++) {
    const r = map.radios[i]!;
    if ((state.radios & (1 << i)) !== 0 || !near(r.x, r.z, 1.8, p.y) || Math.abs(r.y - (p.y + 1.2)) > 1.6) continue;
    if (!state.power) return { kind: "radio", id: i, label: "Una radio vieja", price: 0, ok: false, why: "Sin corriente: primero la luz", hold: false };
    return { kind: "radio", id: i, label: "Una radio vieja", price: 0, ok: true, hold: false };
  }

  // Las ventanas: reparar.
  for (const b of map.barriers) {
    if (distToBox(b.box, x, z) > BOARD_RANGE || !atHeightOf(b.box, p.y)) continue;
    const boards = state.boards[b.id] ?? 0;
    if (boards >= BOARD_MAX) return { kind: "barrier", id: b.id, label: "Ventana", price: 0, ok: false, why: "Entera", hold: true };
    return { kind: "barrier", id: b.id, label: "Reparar", price: 0, ok: true, hold: true };
  }
  return null;
}

/** Códigos de la fuga en `Interaction.id`: 0 la llave, 1 a 4 las piezas, 5 arreglar la lancha, 6 el faro, 7 subir. */
function findQuest(state: GameState, p: PlayerState, map: GameMap, near: (x: number, z: number, range?: number, y?: number) => boolean): Interaction | null {
  const q = map.quest;
  if (!q) return null;
  const e = state.egg;
  const info = (label: string, why: string): Interaction => ({ kind: "quest", id: -1, label, price: 0, ok: false, why, hold: false });
  const act = (id: number, label: string): Interaction => ({ kind: "quest", id, label, price: 0, ok: true, hold: false });

  // El hacha, en su caja de vidrio: se compra cuando se quiera.
  if (near(q.axe.x, q.axe.z, 1.7, q.axe.y) && !p.hasAxe) return { kind: "quest", id: 8, label: `Romper el vidrio: ${q.axe.name}`, price: AXE_PRICE, ok: p.points >= AXE_PRICE, why: p.points < AXE_PRICE ? "No te alcanza" : undefined, hold: false };

  // El horno templa el trabuco, cuando ya escupió el gatillo.
  if ((e & EGG_FURNACE) !== 0 && near(map.furnace.x, map.furnace.z, USE_RANGE + 0.6, map.furnace.y ?? 0)) {
    if (state.forgeBy >= 0) {
      if (state.forgeTicks > 0) return info("El horno", `Templando: faltan ${Math.ceil(state.forgeTicks / TICK_RATE)} s`);
      if (state.forgeBy === p.id) return act(10, `Sacar el ${weapon(BRASAS).name}`);
      return info("El horno", "Hay un arma esperando a otro");
    }
    if ((p.slots[p.active] ?? -1) === TRABUCO) return act(9, "Meter el trabuco en el horno");
  }

  // La caja fuerte: tres ruedas, y se elige la que está enfrente.
  if ((e & EGG_SAFE) === 0 && near(q.safe.x, q.safe.z, 2.4, q.safe.y)) {
    if ((e & EGG_BUILT) === 0) return info("Una caja fuerte", "No se te ocurre la combinación");
    const w = wheelAt(q, p.x);
    return act(20 + w, `Girar la rueda ${"I".repeat(w + 1)}: ${dialDigit(state.eggDial, w)}`);
  }
  if ((e & EGG_SAFE) !== 0 && (e & EGG_KEY) === 0 && near(q.key.x, q.key.z, 2.2, q.key.y)) return act(0, `Agarrar ${q.key.name}`);
  if ((e & EGG_KEY) !== 0) {
    for (let i = 0; i < q.parts.length; i++) {
      const part = q.parts[i]!;
      if ((e & EGG_BOAT_PARTS[i]!) === 0 && near(part.x, part.z, 2.0, part.y)) return act(1 + i, `Agarrar ${part.name}`);
    }
  }
  if (near(q.boat.x, q.boat.z, USE_RANGE + 1.2, q.boat.y)) {
    if ((e & EGG_KEY) === 0) return info("Una lancha rota", "No arranca. Le faltan piezas");
    if ((e & EGG_BOAT) === 0) {
      const have = EGG_BOAT_PARTS.filter((b) => (e & b) !== 0).length;
      if (have < EGG_BOAT_PARTS.length) return info("La lancha", `Faltan piezas (${have} de ${EGG_BOAT_PARTS.length})`);
      return act(5, "Arreglar la lancha");
    }
    if ((e & EGG_BEACON) === 0) return info("La lancha", "Sin el faro no se cruza la niebla");
    if ((e & EGG_READY) === 0) return info("La lancha", "Todavía no se abre la niebla: aguantá");
    if ((e & EGG_BOSS_DEAD) === 0) return info("La lancha", "El alcaide no deja salir a nadie");
    const missing = state.players.some((o) => o.connected && o.alive && !o.down && Math.hypot(o.x - q.boat.x, o.z - q.boat.z) > BOARD_RADIUS);
    if (missing) return info("Subir a la lancha", "Faltan compañeros");
    return act(7, "Subir a la lancha");
  }
  // Las llaves de corte: con la lancha lista, las tres en menos de BREAKER_TICKS.
  if ((e & EGG_BOAT) !== 0 && (e & EGG_BREAKERS) === 0) {
    for (let i = 0; i < q.breakers.length; i++) {
      const b = q.breakers[i]!;
      if (!near(b.x, b.z, 1.8, b.y)) continue;
      if ((state.breakers & (1 << i)) !== 0) return info(b.name, `Bajada. Quedan ${Math.ceil(state.breakerTicks / TICK_RATE)} s para las otras`);
      return act(30 + i, `Bajar ${b.name}`);
    }
  }
  if ((e & EGG_BEACON) === 0 && near(q.beacon.x, q.beacon.z, USE_RANGE + 0.6, q.beacon.y)) {
    if ((e & EGG_BOAT) === 0) return info("El reflector del faro", "Primero tiene que andar la lancha");
    if ((e & EGG_BREAKERS) === 0) return info("El reflector del faro", "No tiene corriente: faltan las llaves de corte");
    return act(6, "Prender el faro");
  }
  return null;
}

/** Qué rueda de la caja fuerte tiene enfrente quien está parado en `x`. */
export function wheelAt(q: NonNullable<GameMap["quest"]>, x: number): number {
  let best = 0;
  q.safeWheels.forEach((w, i) => {
    if (Math.abs(w - x) < Math.abs(q.safeWheels[best]! - x)) best = i;
  });
  return best;
}

/** El dígito de una rueda: la primera es la de las centenas. */
export function dialDigit(dial: number, wheel: number): number {
  return Math.floor(dial / (wheel === 0 ? 100 : wheel === 1 ? 10 : 1)) % 10;
}

function stepQuest(state: GameState, p: PlayerState, id: number, byId: number, map: GameMap, events: SimEvent[]): void {
  const q = map.quest;
  if (!q) return;
  if (id >= 20 && id <= 22) {
    // Una vuelta de la rueda; cuando las tres coinciden, se abre sola.
    const w = id - 20;
    const unit = w === 0 ? 100 : w === 1 ? 10 : 1;
    const digit = dialDigit(state.eggDial, w);
    state.eggDial += (digit === 9 ? -9 : 1) * unit;
    events.push({ t: "egg", byId, step: 12 });
    if (state.eggDial === state.eggCode) {
      state.egg |= EGG_SAFE;
      events.push({ t: "egg", byId, step: 11 });
    }
  } else if (id >= 30 && id <= 32) {
    if ((state.breakers & (1 << (id - 30))) !== 0) return;
    if (state.breakers === 0) state.breakerTicks = BREAKER_TICKS;
    state.breakers |= 1 << (id - 30);
    let n = 0;
    for (let i = 0; i < q.breakers.length; i++) if ((state.breakers & (1 << i)) !== 0) n++;
    events.push({ t: "egg", byId, step: 35, souls: n });
    if (n === q.breakers.length) {
      state.egg |= EGG_BREAKERS;
      state.breakerTicks = 0;
      events.push({ t: "egg", byId, step: 37 });
    }
  } else if (id === 8) {
    if (!pay(p, AXE_PRICE)) return;
    p.hasAxe = true;
    p.axeCd = 0;
    events.push({ t: "egg", byId, step: 40 });
  } else if (id === 9) {
    // El trabuco se va al horno: la ranura queda vacía, como en el Pack-a-Punch.
    const slot = p.active;
    state.forgeTicks = FORGE_TICKS;
    state.forgeBy = p.id;
    p.slots[slot] = -1;
    p.ammo[slot] = 0;
    p.reserve[slot] = 0;
    p.pap[slot] = 0;
    let other = -1;
    for (let s = 0; s < SLOT_COUNT; s++) if ((p.slots[s] ?? -1) >= 0) other = s;
    switchTo(p, other >= 0 ? other : slot);
    events.push({ t: "egg", byId, step: 38 });
  } else if (id === 10) {
    giveWeapon(p, BRASAS);
    state.forgeBy = -1;
    events.push({ t: "buy", byId, what: "weapon", which: BRASAS });
  } else if (id === 0) {
    state.egg |= EGG_KEY;
    events.push({ t: "egg", byId, step: 10 });
  } else if (id >= 1 && id <= 4) {
    state.egg |= EGG_BOAT_PARTS[id - 1]!;
    events.push({ t: "egg", byId, step: 20 + (id - 1) });
  } else if (id === 5) {
    state.egg |= EGG_BOAT;
    events.push({ t: "egg", byId, step: 30 });
  } else if (id === 6) {
    state.egg |= EGG_BEACON;
    state.eggTicks = ESCAPE_SIEGE_TICKS;
    events.push({ t: "egg", byId, step: 31 });
  } else if (id === 7) {
    // De acá se encarga stepRound: termina la partida.
    state.egg |= EGG_ESCAPED;
    events.push({ t: "egg", byId, step: 33 });
  }
}

function pay(p: PlayerState, price: number): boolean {
  if (p.points < price) return false;
  p.points -= price;
  return true;
}

/**
 * Lo que hace E en este tick para un jugador. Lo que se aprieta pasa una vez
 * por apretada; lo que se sostiene acumula `useTicks`.
 */
export function stepUse(state: GameState, p: PlayerState, input: PlayerInput, map: GameMap, events: SimEvent[]): void {
  const pressed = input.use && !p.useHeld;
  p.useHeld = input.use;
  if (!input.use) {
    p.useTicks = 0;
    return;
  }
  const it = findInteraction(state, p, map);
  if (!it) {
    p.useTicks = 0;
    return;
  }
  if (it.hold) {
    if (!it.ok) return;
    p.useTicks++;
    if (it.kind === "revive") {
      const q = state.players.find((o) => o.id === it.id);
      if (!q || !q.down) return;
      q.reviveBy = p.id;
      q.reviveTicks += hasPerk(p, PERK_QUICK) ? 2 : 1;
      if (q.reviveTicks >= REVIVE_TICKS) revivePlayer(state, q, p, REVIVE_HP, events, map.boxes);
      return;
    }
    if (it.kind === "barrier" && p.useTicks >= BOARD_REPAIR_TICKS) {
      p.useTicks = 0;
      const boards = state.boards[it.id] ?? 0;
      if (boards >= BOARD_MAX) return;
      state.boards[it.id] = boards + 1;
      events.push({ t: "board", barrier: it.id, boards: boards + 1, byId: p.id });
      if (p.boardsPaid < BOARD_PAID_PER_ROUND) {
        p.boardsPaid++;
        const b = map.barriers[it.id]!;
        givePoints(state, p, BOARD_POINTS, (b.box.minX + b.box.maxX) / 2, 1.5, (b.box.minZ + b.box.maxZ) / 2, events);
      }
    }
    return;
  }
  if (!pressed || !it.ok) return;

  switch (it.kind) {
    case "door": {
      const d = map.doors[it.id]!;
      if (d.locked || !pay(p, d.price)) return;
      state.doorsOpen |= 1 << d.id;
      events.push({ t: "door", id: d.id, byId: p.id });
      return;
    }
    case "quest":
      stepQuest(state, p, it.id, p.id, map, events);
      return;
    case "power":
      state.power = true;
      events.push({ t: "power", byId: p.id });
      return;
    case "radio": {
      state.radios |= 1 << it.id;
      const all = state.radios === (1 << EGG_RADIOS) - 1;
      if (all) {
        state.songTicks = EGG_SONG_TICKS;
        state.egg |= EGG_SONG;
        // La canción abre lo que estaba cerrado con llave: el armario de la primera pieza.
        for (const d of map.doors) {
          if (!d.locked || (state.doorsOpen & (1 << d.id)) !== 0) continue;
          state.doorsOpen |= 1 << d.id;
          events.push({ t: "door", id: d.id, byId: -1 });
        }
      }
      events.push({ t: "radio", byId: p.id, which: it.id, all });
      return;
    }
    case "part": {
      const bit = it.id === 0 ? EGG_PART_A : it.id === 1 ? EGG_PART_B : EGG_PART_C;
      if ((state.egg & bit) !== 0) return;
      state.egg |= bit;
      events.push({ t: "egg", byId: p.id, step: it.id });
      return;
    }
    case "bench": {
      if (it.id === 1) return;
      if ((state.egg & EGG_BUILT) === 0) {
        state.egg |= EGG_BUILT;
        events.push({ t: "egg", byId: p.id, step: 3 });
      } else if (hasWeapon(p, THUNDERGUN) >= 0) return;
      giveWeapon(p, THUNDERGUN);
      events.push({ t: "buy", byId: p.id, what: "weapon", which: THUNDERGUN });
      return;
    }
    case "wall": {
      const ww = map.wallWeapons[it.id]!;
      if (!pay(p, it.price)) return;
      giveWeapon(p, ww.weapon);
      events.push({ t: "buy", byId: p.id, what: "weapon", which: ww.weapon });
      return;
    }
    case "ammo": {
      const ww = map.wallWeapons[it.id]!;
      const slot = hasWeapon(p, ww.weapon);
      if (slot < 0 || !pay(p, it.price)) return;
      p.reserve[slot] = weaponStats(ww.weapon, (p.pap[slot] ?? 0) === 1).reserve;
      events.push({ t: "buy", byId: p.id, what: "ammo", which: ww.weapon });
      return;
    }
    case "grenades":
      if (!pay(p, it.price)) return;
      p.grenades = FRAG_MAX;
      events.push({ t: "buy", byId: p.id, what: "grenades", which: FRAG });
      return;
    case "perk": {
      if (!pay(p, it.price)) return;
      applyPerk(p, it.id);
      p.drinkTicks = DRINK_TICKS;
      if (it.id === PERK_QUICK) p.quickRevives++;
      events.push({ t: "buy", byId: p.id, what: "perk", which: it.id });
      return;
    }
    case "box": {
      if (state.box.phase !== 0 || !pay(p, it.price)) return;
      state.box.phase = 1;
      state.box.ticksLeft = BOX_SPIN_TICKS;
      state.box.forId = p.id;
      state.box.uses++;
      events.push({ t: "box", what: "open", byId: p.id, weapon: -1, spot: state.box.spot });
      return;
    }
    case "boxTake": {
      const b = state.box;
      if (b.phase !== 2 || b.forId !== p.id) return;
      giveWeapon(p, b.weapon);
      events.push({ t: "box", what: "take", byId: p.id, weapon: b.weapon, spot: b.spot });
      b.phase = 0;
      b.ticksLeft = 0;
      b.forId = -1;
      return;
    }
    case "pap": {
      const pp = state.pap;
      if (pp.phase !== 0 || !pay(p, PAP_PRICE)) return;
      const slot = p.active;
      pp.phase = 1;
      pp.ticksLeft = PAP_TICKS;
      pp.weapon = it.id;
      pp.forId = p.id;
      // El arma se va a la máquina: la ranura queda vacía hasta que la devuelve.
      p.slots[slot] = -1;
      p.ammo[slot] = 0;
      p.reserve[slot] = 0;
      p.pap[slot] = 0;
      let other = -1;
      for (let s = 0; s < SLOT_COUNT; s++) if ((p.slots[s] ?? -1) >= 0) other = s;
      switchTo(p, other >= 0 ? other : slot);
      events.push({ t: "pap", what: "start", byId: p.id, weapon: it.id });
      return;
    }
    case "papTake": {
      const pp = state.pap;
      if (pp.phase !== 2 || pp.forId !== p.id) return;
      giveWeapon(p, pp.weapon, true);
      events.push({ t: "pap", what: "take", byId: p.id, weapon: pp.weapon });
      pp.phase = 0;
      pp.forId = -1;
      return;
    }
  }
}

/** Un tick de la caja y del Pack-a-Punch: giran, ofrecen, se cansan de esperar. */
export function stepMachines(state: GameState, map: GameMap, events: SimEvent[]): void {
  const rng = state.rng ?? Math.random;
  const b = state.box;
  if (b.phase === 1 && --b.ticksLeft <= 0) {
    // Poco frecuente: después de las vueltas gratis, 10 % y sube 5 % por vuelta hasta 35 %.
    const teddyChance = b.uses <= BOX_TEDDY_FREE_USES ? 0 : Math.min(0.35, 0.1 + 0.05 * (b.uses - BOX_TEDDY_FREE_USES - 1));
    const buyer = state.players.find((q) => q.id === b.forId);
    if (rng() < teddyChance && map.boxSpots.length > 1) {
      b.phase = 3;
      b.ticksLeft = 60;
      if (buyer) buyer.points = Math.min(999_999, buyer.points + BOX_PRICE);
      events.push({ t: "box", what: "teddy", byId: b.forId, weapon: -1, spot: b.spot });
    } else {
      const owned: number[] = buyer ? buyer.slots.filter((w) => w >= 0) : [];
      b.weapon = rollBox(rng, owned);
      b.phase = 2;
      b.ticksLeft = BOX_TAKE_TICKS;
      events.push({ t: "box", what: "offer", byId: b.forId, weapon: b.weapon, spot: b.spot });
    }
  } else if (b.phase === 2 && --b.ticksLeft <= 0) {
    b.phase = 0;
    b.forId = -1;
    events.push({ t: "box", what: "close", byId: -1, weapon: b.weapon, spot: b.spot });
  } else if (b.phase === 3 && --b.ticksLeft <= 0) {
    let next = b.spot;
    while (next === b.spot) next = Math.floor(rng() * map.boxSpots.length);
    b.spot = next;
    b.uses = 0;
    b.phase = 0;
    b.forId = -1;
    events.push({ t: "box", what: "close", byId: -1, weapon: -1, spot: b.spot });
  }

  const pp = state.pap;
  if (pp.phase === 1 && --pp.ticksLeft <= 0) {
    pp.phase = 2;
    pp.ticksLeft = PAP_TAKE_TICKS;
    events.push({ t: "pap", what: "ready", byId: pp.forId, weapon: pp.weapon });
  } else if (pp.phase === 2 && --pp.ticksLeft <= 0) {
    // Nadie la retiró: se perdió.
    pp.phase = 0;
    pp.forId = -1;
  }

  if (state.songTicks > 0) state.songTicks--;
}

export { KNIFE };
