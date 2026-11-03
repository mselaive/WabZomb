/**
 * Las armas. Tres ranuras de arma (la tercera sólo con Mule Kick); el cuchillo
 * y las granadas no ocupan ranura: van con V y con G.
 */
export const SLOT_COUNT = 3;

export type WeaponClass = "pistol" | "smg" | "ar" | "shotgun" | "lmg" | "sniper" | "wonder" | "melee" | "grenade";

/**
 * Cómo se dibuja (el cliente arma cada una con cajas y cilindros a partir de
 * esto, sin modelos externos). Medidas en metros.
 */
export interface WeaponLook {
  /** Largo del cuerpo (cajón) y del caño que asoma adelante. */
  body: number;
  barrel: number;
  /** Color del cuerpo, de la madera/polímero y del cargador. */
  color: number;
  wood: number;
  magColor?: number;
  /** Cargador: recto, curvo, de tambor, de caja (ametralladoras), tubo (escopetas) o ninguno. */
  mag: "straight" | "curved" | "drum" | "box" | "tube" | "none" | "cylinder";
  /** Largo del cargador. */
  magLen: number;
  /** Culata: de madera, plegable (esqueleto), de polímero, o ninguna (pistolas, subfusiles chicos). */
  stock: "wood" | "skeleton" | "poly" | "none";
  /** Mira telescópica encima. */
  scope?: boolean;
  /** Asa de transporte (M16, AUG, G11). */
  handle?: boolean;
  /** Bípode (ametralladoras). */
  bipod?: boolean;
  /** Dos caños (Olympia). */
  double?: boolean;
  /** Brilla (la Ray Gun). */
  glow?: number;
  /** Un haz de caños acampanados que gira (el trabuco). */
  rotary?: boolean;
}

export interface WeaponDef {
  id: number;
  name: string;
  short: string;
  cls: WeaponClass;
  /** Precio en la pared, o 0 si no está en ninguna pared. */
  wall: number;
  /** Sale de la caja (y con qué peso: la Ray Gun es rara). */
  box: number;
  damage: number;
  /** Multiplicador en la cabeza. */
  head: number;
  /** Factor de daño cada 10 m (1 no pierde nada). */
  range: number;
  mag: number;
  reserve: number;
  /** Ticks entre tiros (50 ms cada uno). */
  fireTicks: number;
  reloadTicks: number;
  drawTicks: number;
  auto: boolean;
  pellets: number;
  spread: number;
  spreadShot: number;
  spreadMove: number;
  /** Velocidad máxima con ella en la mano (m/s). */
  speed: number;
  /** 0 sin mira; si no, el factor de zoom. */
  zoom: number;
  kick: number;
  recoilUp: number;
  recoilSide: number;
  /** Radio de la explosión de cada tiro (la Ray Gun), o 0. */
  explosive: number;
  /** Un soplido en cono que mata a todos los que agarra (la Thunder Gun): hasta dónde llega, o 0. */
  blast?: number;
  /** La versión mejorada (Pack-a-Punch). */
  pap: {
    name: string;
    damage: number;
    mag: number;
    reserve: number;
    explosive?: number;
    auto?: boolean;
    fireTicks?: number;
    blast?: number;
  };
  look: WeaponLook;
}

const STEEL = 0x3c424a;
const DARK = 0x1f2226;
const BLACK = 0x15171a;
const WOOD = 0x7d4b22;
const WOOD_LIGHT = 0x9a6230;
const OLIVE = 0x4e5a3f;
const TAN = 0xb2a07c;
const SILVER = 0x8d9096;
const GREEN_RAY = 0x2fbf6a;

const W = (d: WeaponDef): WeaponDef => d;

export const KNIFE = 0;
export const M1911 = 1;
export const PYTHON = 2;
export const CZ75 = 3;
export const OLYMPIA = 4;
export const STAKEOUT = 5;
export const SPAS = 6;
export const M14 = 7;
export const M16 = 8;
export const MP40 = 9;
export const MP5K = 10;
export const AK74U = 11;
export const PM63 = 12;
export const SPECTRE = 13;
export const GALIL = 14;
export const COMMANDO = 15;
export const FAMAS = 16;
export const AUG = 17;
export const G11 = 18;
export const RPK = 19;
export const HK21 = 20;
export const L96 = 21;
export const DRAGUNOV = 22;
export const RAYGUN = 23;
export const FRAG = 24;
/** Se arma con las piezas del easter egg: no está en la pared ni en la caja. */
export const THUNDERGUN = 25;
/** Un trabuco de seis caños con manivela: abre todo lo que tiene adelante. Sale de la caja, poco. */
export const TRABUCO = 26;
export const THOMPSON = 27;
export const BAR = 28;
export const WINCHESTER = 29;
export const LUGER = 30;
export const GARAND = 31;
export const SPRINGFIELD = 32;
export const PPSH = 33;
/** Pseudoarmas de los eventos: caída y manotazo de zombi. */
export const FALL_WEAPON = 60;
export const ZOMBIE_WEAPON = 61;

const pistolLook = (color: number, body: number, barrel: number, wood = DARK): WeaponLook => ({ body, barrel, color, wood, mag: "none", magLen: 0, stock: "none" });

export const WEAPONS: readonly WeaponDef[] = [
  W({
    id: KNIFE, name: "Cuchillo", short: "Cuchillo", cls: "melee", wall: 0, box: 0,
    damage: 150, head: 1, range: 1, mag: 0, reserve: 0, fireTicks: 12, reloadTicks: 0, drawTicks: 4, auto: false, pellets: 1,
    spread: 0, spreadShot: 0, spreadMove: 0, speed: 5.0, zoom: 0, kick: 0, recoilUp: 0, recoilSide: 0, explosive: 0,
    pap: { name: "Cuchillo", damage: 150, mag: 0, reserve: 0 },
    look: { body: 0.1, barrel: 0, color: STEEL, wood: DARK, mag: "none", magLen: 0, stock: "none" },
  }),
  W({
    id: M1911, name: "M1911", short: "M1911", cls: "pistol", wall: 0, box: 0,
    damage: 30, head: 3, range: 0.84, mag: 8, reserve: 80, fireTicks: 4, reloadTicks: 36, drawTicks: 6, auto: false, pellets: 1,
    spread: 0.011, spreadShot: 0.008, spreadMove: 0.035, speed: 5.0, zoom: 0, kick: 0.014, recoilUp: 0.035, recoilSide: 0.012, explosive: 0,
    pap: { name: "Mustang & Sally", damage: 250, mag: 6, reserve: 60, explosive: 2.2, fireTicks: 6 },
    look: pistolLook(SILVER, 0.2, 0.03, WOOD),
  }),
  W({
    id: PYTHON, name: "Python", short: "Python", cls: "pistol", wall: 1200, box: 1,
    damage: 110, head: 3, range: 0.9, mag: 6, reserve: 60, fireTicks: 6, reloadTicks: 56, drawTicks: 6, auto: false, pellets: 1,
    spread: 0.009, spreadShot: 0.014, spreadMove: 0.04, speed: 5.0, zoom: 0, kick: 0.035, recoilUp: 0.08, recoilSide: 0.02, explosive: 0,
    pap: { name: "Cobra", damage: 300, mag: 12, reserve: 96 },
    look: { ...pistolLook(STEEL, 0.22, 0.14, WOOD), mag: "cylinder", magLen: 0.05 },
  }),
  W({
    id: CZ75, name: "CZ75", short: "CZ75", cls: "pistol", wall: 0, box: 1,
    damage: 35, head: 3, range: 0.84, mag: 15, reserve: 120, fireTicks: 3, reloadTicks: 36, drawTicks: 6, auto: false, pellets: 1,
    spread: 0.011, spreadShot: 0.007, spreadMove: 0.035, speed: 5.0, zoom: 0, kick: 0.013, recoilUp: 0.035, recoilSide: 0.012, explosive: 0,
    pap: { name: "Calamity", damage: 90, mag: 20, reserve: 200, auto: true, fireTicks: 2 },
    look: pistolLook(BLACK, 0.19, 0.02),
  }),
  W({
    id: OLYMPIA, name: "Olympia", short: "Olympia", cls: "shotgun", wall: 500, box: 1,
    damage: 25, head: 1.5, range: 0.5, mag: 2, reserve: 38, fireTicks: 7, reloadTicks: 44, drawTicks: 8, auto: false, pellets: 8,
    spread: 0.05, spreadShot: 0.01, spreadMove: 0.03, speed: 4.8, zoom: 0, kick: 0.05, recoilUp: 0.03, recoilSide: 0.01, explosive: 0,
    pap: { name: "Hades", damage: 55, mag: 2, reserve: 60 },
    look: { body: 0.22, barrel: 0.6, color: STEEL, wood: WOOD_LIGHT, mag: "none", magLen: 0, stock: "wood", double: true },
  }),
  W({
    id: STAKEOUT, name: "Stakeout", short: "Stakeout", cls: "shotgun", wall: 1500, box: 1,
    damage: 30, head: 1.5, range: 0.5, mag: 6, reserve: 54, fireTicks: 16, reloadTicks: 70, drawTicks: 8, auto: false, pellets: 8,
    spread: 0.045, spreadShot: 0.01, spreadMove: 0.03, speed: 4.7, zoom: 0, kick: 0.05, recoilUp: 0.03, recoilSide: 0.01, explosive: 0,
    pap: { name: "Raid", damage: 50, mag: 10, reserve: 70 },
    look: { body: 0.24, barrel: 0.5, color: DARK, wood: WOOD, mag: "tube", magLen: 0.45, stock: "wood" },
  }),
  W({
    id: SPAS, name: "SPAS-12", short: "SPAS", cls: "shotgun", wall: 0, box: 1,
    damage: 22, head: 1.5, range: 0.52, mag: 8, reserve: 32, fireTicks: 8, reloadTicks: 76, drawTicks: 8, auto: false, pellets: 8,
    spread: 0.045, spreadShot: 0.01, spreadMove: 0.03, speed: 4.7, zoom: 0, kick: 0.045, recoilUp: 0.03, recoilSide: 0.01, explosive: 0,
    pap: { name: "SPAZ-24", damage: 35, mag: 24, reserve: 72 },
    look: { body: 0.26, barrel: 0.46, color: BLACK, wood: BLACK, mag: "tube", magLen: 0.42, stock: "skeleton" },
  }),
  W({
    id: M14, name: "M14", short: "M14", cls: "ar", wall: 500, box: 1,
    damage: 70, head: 3.5, range: 0.96, mag: 8, reserve: 96, fireTicks: 3, reloadTicks: 40, drawTicks: 8, auto: false, pellets: 1,
    spread: 0.004, spreadShot: 0.012, spreadMove: 0.05, speed: 4.8, zoom: 0, kick: 0.02, recoilUp: 0.07, recoilSide: 0.02, explosive: 0,
    pap: { name: "Mnesia", damage: 200, mag: 16, reserve: 192 },
    look: { body: 0.3, barrel: 0.5, color: STEEL, wood: WOOD_LIGHT, mag: "straight", magLen: 0.1, stock: "wood" },
  }),
  W({
    id: M16, name: "M16", short: "M16", cls: "ar", wall: 1200, box: 1,
    damage: 40, head: 3.5, range: 0.97, mag: 30, reserve: 180, fireTicks: 2, reloadTicks: 44, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.004, spreadShot: 0.004, spreadMove: 0.055, speed: 4.8, zoom: 0, kick: 0.012, recoilUp: 0.08, recoilSide: 0.03, explosive: 0,
    pap: { name: "Skullcrusher", damage: 110, mag: 30, reserve: 270 },
    look: { body: 0.3, barrel: 0.48, color: BLACK, wood: BLACK, mag: "straight", magLen: 0.16, stock: "poly", handle: true },
  }),
  W({
    id: MP40, name: "MP40", short: "MP40", cls: "smg", wall: 1000, box: 1,
    damage: 32, head: 3, range: 0.86, mag: 32, reserve: 192, fireTicks: 2, reloadTicks: 50, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.008, spreadShot: 0.0024, spreadMove: 0.03, speed: 5.0, zoom: 0, kick: 0.009, recoilUp: 0.055, recoilSide: 0.02, explosive: 0,
    pap: { name: "The Afterburner", damage: 70, mag: 64, reserve: 192 },
    look: { body: 0.3, barrel: 0.3, color: STEEL, wood: DARK, mag: "straight", magLen: 0.22, stock: "skeleton" },
  }),
  W({
    id: MP5K, name: "MP5K", short: "MP5K", cls: "smg", wall: 1000, box: 1,
    damage: 30, head: 3, range: 0.86, mag: 30, reserve: 150, fireTicks: 2, reloadTicks: 44, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.008, spreadShot: 0.0022, spreadMove: 0.03, speed: 5.0, zoom: 0, kick: 0.008, recoilUp: 0.05, recoilSide: 0.02, explosive: 0,
    pap: { name: "MP115 Kollider", damage: 70, mag: 40, reserve: 200 },
    look: { body: 0.3, barrel: 0.12, color: BLACK, wood: BLACK, mag: "curved", magLen: 0.2, stock: "none" },
  }),
  W({
    id: AK74U, name: "AK74u", short: "AK74u", cls: "smg", wall: 1200, box: 1,
    damage: 36, head: 3, range: 0.9, mag: 20, reserve: 160, fireTicks: 2, reloadTicks: 46, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.007, spreadShot: 0.003, spreadMove: 0.04, speed: 5.0, zoom: 0, kick: 0.011, recoilUp: 0.07, recoilSide: 0.03, explosive: 0,
    pap: { name: "AK74fu2", damage: 90, mag: 40, reserve: 280 },
    look: { body: 0.28, barrel: 0.22, color: STEEL, wood: WOOD, mag: "curved", magLen: 0.2, stock: "skeleton" },
  }),
  W({
    id: PM63, name: "PM63", short: "PM63", cls: "smg", wall: 1000, box: 1,
    damage: 28, head: 3, range: 0.84, mag: 20, reserve: 200, fireTicks: 2, reloadTicks: 36, drawTicks: 6, auto: true, pellets: 1,
    spread: 0.01, spreadShot: 0.003, spreadMove: 0.03, speed: 5.0, zoom: 0, kick: 0.009, recoilUp: 0.05, recoilSide: 0.03, explosive: 0,
    pap: { name: "Tokyo & Rose", damage: 60, mag: 50, reserve: 300 },
    look: { body: 0.22, barrel: 0.1, color: DARK, wood: DARK, mag: "straight", magLen: 0.14, stock: "none" },
  }),
  W({
    id: SPECTRE, name: "Spectre", short: "Spectre", cls: "smg", wall: 0, box: 1,
    damage: 30, head: 3, range: 0.86, mag: 30, reserve: 180, fireTicks: 2, reloadTicks: 44, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.008, spreadShot: 0.0022, spreadMove: 0.03, speed: 5.0, zoom: 0, kick: 0.008, recoilUp: 0.05, recoilSide: 0.02, explosive: 0,
    pap: { name: "Phantom", damage: 70, mag: 45, reserve: 315 },
    look: { body: 0.32, barrel: 0.1, color: BLACK, wood: BLACK, mag: "box", magLen: 0.16, stock: "skeleton" },
  }),
  W({
    id: GALIL, name: "Galil", short: "Galil", cls: "ar", wall: 0, box: 1,
    damage: 48, head: 3.5, range: 0.97, mag: 35, reserve: 315, fireTicks: 2, reloadTicks: 50, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.0045, spreadShot: 0.0036, spreadMove: 0.055, speed: 4.7, zoom: 0, kick: 0.013, recoilUp: 0.085, recoilSide: 0.035, explosive: 0,
    pap: { name: "Lamentation", damage: 110, mag: 35, reserve: 490 },
    look: { body: 0.32, barrel: 0.42, color: BLACK, wood: DARK, mag: "curved", magLen: 0.22, stock: "skeleton", bipod: true },
  }),
  W({
    id: COMMANDO, name: "Commando", short: "Commando", cls: "ar", wall: 0, box: 1,
    damage: 45, head: 3.5, range: 0.97, mag: 30, reserve: 270, fireTicks: 2, reloadTicks: 46, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.0042, spreadShot: 0.0034, spreadMove: 0.055, speed: 4.8, zoom: 0, kick: 0.012, recoilUp: 0.075, recoilSide: 0.03, explosive: 0,
    pap: { name: "Predator", damage: 100, mag: 40, reserve: 360 },
    look: { body: 0.32, barrel: 0.4, color: BLACK, wood: BLACK, mag: "straight", magLen: 0.18, stock: "poly", handle: true },
  }),
  W({
    id: FAMAS, name: "FAMAS", short: "FAMAS", cls: "ar", wall: 0, box: 1,
    damage: 40, head: 3.5, range: 0.96, mag: 30, reserve: 150, fireTicks: 1, reloadTicks: 48, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.005, spreadShot: 0.0032, spreadMove: 0.055, speed: 4.8, zoom: 0, kick: 0.011, recoilUp: 0.09, recoilSide: 0.04, explosive: 0,
    pap: { name: "G16-GL35", damage: 90, mag: 45, reserve: 225 },
    look: { body: 0.44, barrel: 0.28, color: OLIVE, wood: OLIVE, mag: "straight", magLen: 0.14, stock: "poly", handle: true },
  }),
  W({
    id: AUG, name: "AUG", short: "AUG", cls: "ar", wall: 0, box: 1,
    damage: 45, head: 3.5, range: 0.97, mag: 30, reserve: 270, fireTicks: 2, reloadTicks: 44, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.004, spreadShot: 0.003, spreadMove: 0.05, speed: 4.8, zoom: 1.6, kick: 0.012, recoilUp: 0.07, recoilSide: 0.03, explosive: 0,
    pap: { name: "AUG-50M3", damage: 100, mag: 42, reserve: 378 },
    look: { body: 0.42, barrel: 0.32, color: OLIVE, wood: OLIVE, mag: "curved", magLen: 0.18, stock: "poly", scope: true },
  }),
  W({
    id: G11, name: "G11", short: "G11", cls: "ar", wall: 0, box: 1,
    damage: 55, head: 3.5, range: 0.98, mag: 48, reserve: 144, fireTicks: 2, reloadTicks: 60, drawTicks: 8, auto: true, pellets: 1,
    spread: 0.0035, spreadShot: 0.0028, spreadMove: 0.05, speed: 4.8, zoom: 2, kick: 0.012, recoilUp: 0.06, recoilSide: 0.02, explosive: 0,
    pap: { name: "G115 Generator", damage: 140, mag: 48, reserve: 288 },
    look: { body: 0.5, barrel: 0.14, color: DARK, wood: DARK, mag: "none", magLen: 0, stock: "poly", scope: true, handle: true },
  }),
  W({
    id: RPK, name: "RPK", short: "RPK", cls: "lmg", wall: 0, box: 1,
    damage: 55, head: 3, range: 0.98, mag: 100, reserve: 400, fireTicks: 2, reloadTicks: 110, drawTicks: 12, auto: true, pellets: 1,
    spread: 0.006, spreadShot: 0.0036, spreadMove: 0.07, speed: 4.4, zoom: 0, kick: 0.014, recoilUp: 0.09, recoilSide: 0.04, explosive: 0,
    pap: { name: "R115 Resonator", damage: 130, mag: 125, reserve: 500 },
    look: { body: 0.34, barrel: 0.52, color: STEEL, wood: WOOD, mag: "drum", magLen: 0.2, stock: "wood", bipod: true },
  }),
  W({
    id: HK21, name: "HK21", short: "HK21", cls: "lmg", wall: 0, box: 1,
    damage: 60, head: 3, range: 0.98, mag: 125, reserve: 500, fireTicks: 2, reloadTicks: 120, drawTicks: 12, auto: true, pellets: 1,
    spread: 0.0055, spreadShot: 0.0034, spreadMove: 0.07, speed: 4.3, zoom: 0, kick: 0.014, recoilUp: 0.085, recoilSide: 0.04, explosive: 0,
    pap: { name: "H115 Oscillator", damage: 150, mag: 150, reserve: 750 },
    look: { body: 0.38, barrel: 0.46, color: BLACK, wood: BLACK, mag: "box", magLen: 0.22, stock: "poly", bipod: true },
  }),
  W({
    id: L96, name: "L96A1", short: "L96", cls: "sniper", wall: 0, box: 1,
    damage: 400, head: 5, range: 0.99, mag: 5, reserve: 45, fireTicks: 26, reloadTicks: 70, drawTicks: 12, auto: false, pellets: 1,
    spread: 0.08, spreadShot: 0.02, spreadMove: 0.08, speed: 4.3, zoom: 4, kick: 0.06, recoilUp: 0.02, recoilSide: 0, explosive: 0,
    pap: { name: "L115 Isolator", damage: 1200, mag: 8, reserve: 72 },
    look: { body: 0.32, barrel: 0.6, color: OLIVE, wood: OLIVE, mag: "straight", magLen: 0.08, stock: "wood", scope: true },
  }),
  W({
    id: DRAGUNOV, name: "Dragunov", short: "Dragunov", cls: "sniper", wall: 0, box: 1,
    damage: 250, head: 4, range: 0.99, mag: 10, reserve: 40, fireTicks: 8, reloadTicks: 60, drawTicks: 12, auto: false, pellets: 1,
    spread: 0.07, spreadShot: 0.03, spreadMove: 0.08, speed: 4.4, zoom: 4, kick: 0.05, recoilUp: 0.04, recoilSide: 0.01, explosive: 0,
    pap: { name: "D115 Disassembler", damage: 700, mag: 10, reserve: 80 },
    look: { body: 0.3, barrel: 0.62, color: STEEL, wood: WOOD_LIGHT, mag: "curved", magLen: 0.14, stock: "skeleton", scope: true },
  }),
  W({
    id: RAYGUN, name: "Ray Gun", short: "Ray Gun", cls: "wonder", wall: 0, box: 0.35,
    damage: 1000, head: 1, range: 1, mag: 20, reserve: 160, fireTicks: 8, reloadTicks: 60, drawTicks: 8, auto: false, pellets: 1,
    spread: 0.004, spreadShot: 0.002, spreadMove: 0.02, speed: 5.0, zoom: 0, kick: 0.02, recoilUp: 0.02, recoilSide: 0, explosive: 1.6,
    pap: { name: "Porter's X2 Ray Gun", damage: 2000, mag: 40, reserve: 200, explosive: 2.2 },
    look: { body: 0.24, barrel: 0.18, color: 0x8a2f2f, wood: 0x3a2a2a, mag: "none", magLen: 0, stock: "none", glow: GREEN_RAY },
  }),
  W({
    id: FRAG, name: "Granada", short: "Granada", cls: "grenade", wall: 0, box: 0,
    damage: 0, head: 1, range: 1, mag: 0, reserve: 0, fireTicks: 16, reloadTicks: 0, drawTicks: 8, auto: false, pellets: 1,
    spread: 0, spreadShot: 0, spreadMove: 0, speed: 5.0, zoom: 0, kick: 0, recoilUp: 0, recoilSide: 0, explosive: 0,
    pap: { name: "Granada", damage: 0, mag: 0, reserve: 0 },
    look: { body: 0.1, barrel: 0, color: OLIVE, wood: OLIVE, mag: "none", magLen: 0, stock: "none" },
  }),
  W({
    id: THUNDERGUN, name: "Thunder Gun", short: "Thunder", cls: "wonder", wall: 0, box: 0,
    damage: 0, head: 1, range: 1, mag: 2, reserve: 12, fireTicks: 16, reloadTicks: 70, drawTicks: 10, auto: false, pellets: 1,
    spread: 0, spreadShot: 0, spreadMove: 0, speed: 4.8, zoom: 0, kick: 0.08, recoilUp: 0.05, recoilSide: 0, explosive: 0, blast: 9,
    pap: { name: "Zeus Cannon", damage: 0, mag: 4, reserve: 24, blast: 13 },
    look: { body: 0.36, barrel: 0.3, color: 0x6b6f75, wood: 0x2a2d31, mag: "none", magLen: 0, stock: "poly", glow: 0x9ad0ff },
  }),
  W({
    id: TRABUCO, name: "Trabuco giratorio", short: "Trabuco", cls: "shotgun", wall: 0, box: 0.5,
    damage: 55, head: 1.5, range: 0.45, mag: 6, reserve: 60, fireTicks: 7, reloadTicks: 64, drawTicks: 10, auto: false, pellets: 12,
    spread: 0.075, spreadShot: 0.012, spreadMove: 0.03, speed: 4.6, zoom: 0, kick: 0.08, recoilUp: 0.05, recoilSide: 0.015, explosive: 0,
    pap: { name: "El Sepulturero", damage: 120, mag: 12, reserve: 96, fireTicks: 5 },
    look: { body: 0.2, barrel: 0.34, color: 0x8a6a30, wood: WOOD, mag: "none", magLen: 0, stock: "wood", rotary: true },
  }),
  W({
    id: THOMPSON, name: "Thompson M1928", short: "Thompson", cls: "smg", wall: 1200, box: 1,
    damage: 50, head: 2.2, range: 0.8, mag: 50, reserve: 300, fireTicks: 2, reloadTicks: 66, drawTicks: 7, auto: true, pellets: 1,
    spread: 0.025, spreadShot: 0.006, spreadMove: 0.02, speed: 5.1, zoom: 0, kick: 0.018, recoilUp: 0.012, recoilSide: 0.008, explosive: 0,
    pap: { name: "La Máquina de Escribir", damage: 110, mag: 75, reserve: 450 },
    look: { body: 0.3, barrel: 0.24, color: STEEL, wood: WOOD, mag: "drum", magLen: 0.1, stock: "wood" },
  }),
  W({
    id: BAR, name: "BAR M1918", short: "BAR", cls: "ar", wall: 0, box: 1,
    damage: 90, head: 2.5, range: 0.92, mag: 20, reserve: 200, fireTicks: 3, reloadTicks: 58, drawTicks: 9, auto: true, pellets: 1,
    spread: 0.018, spreadShot: 0.008, spreadMove: 0.03, speed: 4.5, zoom: 0, kick: 0.028, recoilUp: 0.024, recoilSide: 0.01, explosive: 0,
    pap: { name: "El Bramido", damage: 180, mag: 40, reserve: 320 },
    look: { body: 0.34, barrel: 0.5, color: DARK, wood: WOOD, mag: "straight", magLen: 0.12, stock: "wood", bipod: true },
  }),
  W({
    id: WINCHESTER, name: "Winchester 1897", short: "Winchester", cls: "shotgun", wall: 1500, box: 1,
    damage: 38, head: 1.5, range: 0.55, mag: 6, reserve: 60, fireTicks: 14, reloadTicks: 66, drawTicks: 8, auto: false, pellets: 8,
    spread: 0.04, spreadShot: 0.01, spreadMove: 0.03, speed: 4.8, zoom: 0, kick: 0.055, recoilUp: 0.035, recoilSide: 0.01, explosive: 0,
    pap: { name: "La Barredora", damage: 75, mag: 12, reserve: 96 },
    look: { body: 0.22, barrel: 0.56, color: STEEL, wood: WOOD_LIGHT, mag: "tube", magLen: 0.46, stock: "wood" },
  }),
  W({
    id: LUGER, name: "Luger P08", short: "Luger", cls: "pistol", wall: 0, box: 1,
    damage: 70, head: 3, range: 0.84, mag: 8, reserve: 96, fireTicks: 4, reloadTicks: 40, drawTicks: 5, auto: false, pellets: 1,
    spread: 0.012, spreadShot: 0.004, spreadMove: 0.015, speed: 5.3, zoom: 0, kick: 0.018, recoilUp: 0.016, recoilSide: 0.004, explosive: 0,
    pap: { name: "La Condesa", damage: 240, mag: 16, reserve: 128 },
    look: pistolLook(DARK, 0.21, 0.06, WOOD_LIGHT),
  }),
  W({
    id: GARAND, name: "M1 Garand", short: "Garand", cls: "ar", wall: 1000, box: 1,
    damage: 130, head: 3, range: 0.95, mag: 8, reserve: 120, fireTicks: 5, reloadTicks: 44, drawTicks: 8, auto: false, pellets: 1,
    spread: 0.012, spreadShot: 0.008, spreadMove: 0.03, speed: 4.8, zoom: 0, kick: 0.032, recoilUp: 0.028, recoilSide: 0.008, explosive: 0,
    pap: { name: "El Clavo", damage: 320, mag: 12, reserve: 156 },
    look: { body: 0.32, barrel: 0.54, color: DARK, wood: WOOD_LIGHT, mag: "none", magLen: 0, stock: "wood" },
  }),
  W({
    id: SPRINGFIELD, name: "Springfield 1903", short: "Springfield", cls: "sniper", wall: 0, box: 1,
    damage: 350, head: 5, range: 0.99, mag: 5, reserve: 50, fireTicks: 24, reloadTicks: 64, drawTicks: 11, auto: false, pellets: 1,
    spread: 0.07, spreadShot: 0.02, spreadMove: 0.08, speed: 4.5, zoom: 3, kick: 0.055, recoilUp: 0.02, recoilSide: 0, explosive: 0,
    pap: { name: "La Última Palabra", damage: 1100, mag: 8, reserve: 72 },
    look: { body: 0.3, barrel: 0.62, color: STEEL, wood: WOOD, mag: "none", magLen: 0, stock: "wood", scope: true },
  }),
  W({
    id: PPSH, name: "PPSh-41", short: "PPSh", cls: "smg", wall: 0, box: 1,
    damage: 42, head: 2, range: 0.74, mag: 71, reserve: 355, fireTicks: 1, reloadTicks: 74, drawTicks: 7, auto: true, pellets: 1,
    spread: 0.03, spreadShot: 0.005, spreadMove: 0.02, speed: 5.1, zoom: 0, kick: 0.012, recoilUp: 0.009, recoilSide: 0.008, explosive: 0,
    pap: { name: "El Enjambre", damage: 85, mag: 142, reserve: 568 },
    look: { body: 0.28, barrel: 0.3, color: DARK, wood: WOOD, mag: "drum", magLen: 0.1, stock: "wood" },
  }),
];

export function weapon(id: number): WeaponDef {
  return WEAPONS[id] ?? WEAPONS[M1911]!;
}

/** Las que están en la caja, con su peso. */
export const BOX_POOL: readonly { id: number; weight: number }[] = WEAPONS.filter((w) => w.box > 0).map((w) => ({ id: w.id, weight: w.box }));

/** Un arma de la caja al azar (que no sea una que ya se tiene). */
export function rollBox(rng: () => number, owned: readonly number[]): number {
  const pool = BOX_POOL.filter((e) => !owned.includes(e.id));
  const total = pool.reduce((a, e) => a + e.weight, 0);
  let u = rng() * total;
  for (const e of pool) {
    u -= e.weight;
    if (u <= 0) return e.id;
  }
  return pool[pool.length - 1]?.id ?? M14;
}

/** Los números efectivos de un arma: la normal o la mejorada. */
export interface WeaponStats {
  name: string;
  damage: number;
  mag: number;
  reserve: number;
  explosive: number;
  auto: boolean;
  fireTicks: number;
  blast: number;
}

export function weaponStats(id: number, pap: boolean): WeaponStats {
  const w = weapon(id);
  if (!pap) return { name: w.name, damage: w.damage, mag: w.mag, reserve: w.reserve, explosive: w.explosive, auto: w.auto, fireTicks: w.fireTicks, blast: w.blast ?? 0 };
  return {
    name: w.pap.name,
    damage: w.pap.damage,
    mag: w.pap.mag,
    reserve: w.pap.reserve,
    explosive: w.pap.explosive ?? w.explosive,
    auto: w.pap.auto ?? w.auto,
    fireTicks: w.pap.fireTicks ?? w.fireTicks,
    blast: w.pap.blast ?? w.blast ?? 0,
  };
}

/** Lo que se tira al apretar G, y el disparo de la Ray Gun: "explosivos" para los puntos. */
export function isExplosiveShot(id: number, pap: boolean): boolean {
  return weaponStats(id, pap).explosive > 0;
}
