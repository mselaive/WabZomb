/**
 * Baja de Poly Haven (todo CC0) las texturas y modelos de La Roca y los deja
 * listos para el juego en apps/client/public/roca: WebP a 1024/512 y GLB con
 * pocos polígonos comprimidos con meshopt. Corre a mano; lo que genera se
 * commitea. Vuelve a usar lo que ya bajó (tools/.cache).
 *
 *   cd tools && npm i && npm run assets
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, ".cache");
const out = join(here, "..", "apps", "client", "public", "roca");
const UA = { "User-Agent": "WabZomb-assets" };

/** nombre en el juego → asset de Poly Haven, y cuántos metros cubre un tile. */
export const TEXTURES = {
  wall: "concrete_wall_008",
  wallgreen: "painted_concrete",
  plaster: "painted_plaster_wall",
  floor: "concrete_floor_worn_001",
  floordark: "hangar_concrete_floor",
  floorbad: "damaged_concrete_floor",
  steel: "metal_plate_02",
  rust: "rusty_metal_02",
  steelgreen: "green_metal_rust",
  tread: "metal_plate",
  stone: "old_stone_wall",
  brick: "castle_brick_07",
  rock: "rock_face",
  tilewall: "long_white_tiles",
  tilefloor: "worn_tile_floor",
  planks: "weathered_planks",
  woodfloor: "old_wood_floor",
  asphalt: "asphalt_02",
  corrugated: "corrugated_iron_02",
  raw: "concrete_layers",
  yard: "gravel_concrete_03",
};

/** nombre → [asset, triángulos que se quiere como máximo]. */
export const MODELS = {
  bed: ["old_bed_frame", 2500],
  wheelchair: ["wheelchair_01", 3000],
  desk: ["metal_office_desk", 1500],
  hanging: ["caged_hanging_light", 1500],
  lamp: ["hanging_industrial_lamp", 1500],
  seclight: ["security_light", 1000],
  sconce: ["industrial_wall_sconce", 1200],
  breaker: ["power_box_01", 1500],
  radio: ["vintage_radio_transceiver", 3000],
  barrel: ["barrel_03", 1000],
  crate: ["wooden_crate_01", 1000],
  crate2: ["old_military_crate", 1000],
  clock: ["wall_clock", 500],
  rack: ["worn_metal_rack", 1200],
  medbox: ["medical_box", 500],
  crutches: ["vintage_crutches_01", 500],
  drill: ["old_drill_press", 2500],
  toolcart: ["tool_cart", 1800],
  toolchest: ["metal_tool_chest", 1500],
  searchlight: ["portable_searchlight", 2500],
  lifebuoy: ["lifebuoy", 800],
  trash: ["metal_trash_can", 1200],
  alarm: ["fire_alarm", 400],
  utility: ["utility_box_01", 800],
  schooldesk: ["SchoolDesk_01", 800],
  gasmask: ["old_gas_mask", 800],
  driftwood: ["dead_tree_trunk", 1200],
  cliff: ["coastal_cliff_01", 6000],
  rocks: ["coast_rocks_01", 3000],
};

async function fetchTo(url, path) {
  if (existsSync(path) && statSync(path).size > 0) return;
  mkdirSync(dirname(path), { recursive: true });
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  writeFileSync(path, Buffer.from(await r.arrayBuffer()));
}

async function filesOf(id) {
  const r = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA });
  if (!r.ok) throw new Error(`${id}: ${r.status}`);
  return r.json();
}

async function texture(name, id) {
  const dir = join(cache, "tex", id);
  const f = await filesOf(id);
  const get = async (key) => {
    const p = join(dir, `${key}.jpg`);
    await fetchTo(f[key]["1k"].jpg.url, p);
    return p;
  };
  mkdirSync(join(out, "tex"), { recursive: true });
  await sharp(await get("Diffuse")).resize(1024, 1024).webp({ quality: 78, effort: 6 }).toFile(join(out, "tex", `${name}_c.webp`));
  await sharp(await get("nor_gl")).resize(1024, 1024).webp({ quality: 82, effort: 6 }).toFile(join(out, "tex", `${name}_n.webp`));
  await sharp(await get("arm")).resize(512, 512).webp({ quality: 75, effort: 6 }).toFile(join(out, "tex", `${name}_r.webp`));
  console.log("tex", name, id);
}

async function model(name, id, tris, polycount) {
  const dir = join(cache, "models", id);
  const f = (await filesOf(id)).gltf["1k"].gltf;
  const main = join(dir, `${id}.gltf`);
  await fetchTo(f.url, main);
  for (const [rel, info] of Object.entries(f.include)) await fetchTo(info.url, join(dir, rel));
  mkdirSync(join(out, "models"), { recursive: true });
  const target = join(out, "models", `${name}.glb`);
  const ratio = Math.min(1, tris / Math.max(1, polycount));
  const cli = join(here, "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
  const big = name === "cliff" || name === "rocks";
  execFileSync(process.execPath, [
    cli, "optimize", main, target,
    "--compress", "meshopt",
    "--texture-compress", "webp",
    "--texture-size", big ? "1024" : "512",
    "--simplify", ratio < 1 ? "true" : "false",
    "--simplify-ratio", String(ratio),
    "--simplify-error", "0.02",
    "--instance", "false",
    "--join", "true",
    "--palette", "false",
  ], { stdio: ["ignore", "ignore", "inherit"] });
  console.log("model", name, id, `${polycount}→~${Math.round(polycount * ratio)}`, `${(statSync(target).size / 1024).toFixed(0)} KB`);
}

const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);
const meta = await (await fetch("https://api.polyhaven.com/assets?t=models", { headers: UA })).json();
for (const [name, id] of Object.entries(TEXTURES)) if (want(name)) await texture(name, id);
for (const [name, [id, tris]] of Object.entries(MODELS)) {
  if (!want(name)) continue;
  try {
    await model(name, id, tris, meta[id]?.polycount ?? tris);
  } catch (e) {
    console.log("FALLÓ", name, id, String(e.message).slice(0, 300));
  }
}

const credits = [
  "# Créditos de los assets de La Roca",
  "",
  "Todo viene de [Poly Haven](https://polyhaven.com), con licencia [CC0](https://polyhaven.com/license): dominio público, sin atribución obligatoria. Se listan igual porque se lo merecen.",
  "",
  "Los generó `tools/assets.mjs` (reducidos y convertidos a WebP y GLB).",
  "",
  "## Texturas",
  ...Object.entries(TEXTURES).map(([n, id]) => `- \`tex/${n}_*.webp\`: [${id}](https://polyhaven.com/a/${id})`),
  "",
  "## Modelos",
  ...Object.entries(MODELS).map(([n, [id]]) => `- \`models/${n}.glb\`: [${id}](https://polyhaven.com/a/${id})`),
  "",
];
writeFileSync(join(out, "CREDITOS.md"), credits.join("\n"));
void readFileSync;
