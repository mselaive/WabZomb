import { FRAG, KNIFE, WEAPONS, weaponStats } from "../weapons.js";
import { giveWeapon } from "./interact.js";
import type { PlayerState } from "./types.js";

/** Minúsculas, sin tildes ni signos: "Blúndergat-de brasas" y "blundergatdebrasas" son lo mismo. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** El arma que más se parece a lo escrito: nombre exacto, el corto, o que empiece o contenga eso. */
export function findWeaponByName(text: string): number | null {
  const q = norm(text);
  if (!q) return null;
  const list = WEAPONS.filter((w) => w.id !== KNIFE && w.id !== FRAG);
  const by = (test: (n: string) => boolean) => list.find((w) => test(norm(w.name)) || test(norm(w.short)) || (w.pap ? test(norm(w.pap.name)) : false));
  return (by((n) => n === q) ?? by((n) => n.startsWith(q)) ?? by((n) => n.includes(q)))?.id ?? null;
}

const HELP = "Comandos (sólo jugando solo): /arma <nombre> [pap] · /armas · /puntos <cantidad> · /municion";

/**
 * Para probar armas sin jugar diez rondas: se escriben en el chat. El servidor
 * los acepta sólo con un jugador en la sala, así no sirven para hacer trampa con
 * amigos. Devuelve la respuesta, o null si el texto no es un comando.
 */
export function runTestCommand(p: PlayerState, text: string): string | null {
  if (!text.startsWith("/")) return null;
  const [cmd = "", ...rest] = text.slice(1).trim().split(" ");
  const arg = rest.join(" ").trim();
  switch (norm(cmd)) {
    case "arma": {
      const pap = /\s+pap$/i.test(arg);
      const name = pap ? arg.replace(/\s+pap$/i, "") : arg;
      const wid = findWeaponByName(name);
      if (wid === null) return `No conozco "${name}". Probá /armas para ver la lista.`;
      if (!p.alive || p.down) return "Primero levantate.";
      giveWeapon(p, wid, pap);
      return `Te di ${weaponStats(wid, pap).name}.`;
    }
    case "armas":
      return WEAPONS.filter((w) => w.id !== KNIFE && w.id !== FRAG)
        .map((w) => w.short)
        .join(", ");
    case "puntos": {
      const n = Math.round(Number(arg));
      if (!Number.isFinite(n) || n < 0) return "Uso: /puntos 50000";
      p.points = Math.min(n, 9_999_999);
      return `Ahora tenés ${p.points} puntos.`;
    }
    case "municion": {
      for (let s = 0; s < p.slots.length; s++) {
        const wid = p.slots[s] ?? -1;
        if (wid < 0) continue;
        const st = weaponStats(wid, (p.pap[s] ?? 0) === 1);
        p.ammo[s] = st.mag;
        p.reserve[s] = st.reserve;
      }
      return "Munición llena.";
    }
    default:
      return HELP;
  }
}
