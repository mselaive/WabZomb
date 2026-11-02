import { generateRoomCode, normalizeRoomCode } from "@wabzomb/shared";
import { Game } from "./game.js";
import { UI } from "./ui.js";

let game!: Game;

function enterRoom(code: string, name: string): void {
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  history.replaceState(null, "", url);
  game.connect(code, name);
}

const ui = new UI({
  // Jugar solo: una sala propia que arranca sola al entrar.
  onSolo: (name) => {
    enterRoom(generateRoomCode(), name);
    game.soloOnJoinRequested();
  },
  onCreate: (name) => enterRoom(generateRoomCode(), name),
  onJoin: (name, code) => {
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      ui.showError("Ese código no existe. Son 6 caracteres, sin vocales.");
      return;
    }
    enterRoom(normalized, name);
  },
  onReady: (ready) => game.setReady(ready),
  onStart: () => game.requestStart(),
  onKick: (id) => game.kick(id),
  onMap: (map) => game.setMap(map),
  onChat: (text) => game.chat(text),
  onVolume: (volume) => game?.setVolume(volume),
  onSensitivity: (value) => game?.setSensitivity(value),
  onFullscreen: (on) => game?.setFullscreen(on),
  onResume: () => game.resume(),
  onExitFullscreen: () => game.exitFullscreen(),
  onLeave: () => {
    game.disconnect();
    ui.setPause(false);
    ui.showScreen("menu");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  },
});

game = new Game(ui);
game.setVolume(ui.volume);
game.setSensitivity(ui.sensitivity);
game.setFullscreen(ui.fullscreen);
// Para mirar el estado desde la consola del navegador: `wabzomb.debugState()`.
(window as unknown as { wabzomb: Game }).wabzomb = game;

/*
 * OJO: acá NO puede ir `await game.init()` en el nivel superior del módulo: en
 * el bundle de producción puede armarse un abrazo mortal con los chunks que
 * dependen de él. Se encadena con then().
 */
ui.setEntryEnabled(false);
game.init().then(
  () => {
    ui.setEntryEnabled(true);
    ui.showScreen("menu");
  },
  (err) => {
    console.error("No arrancó el juego:", err);
    ui.showError("No se pudo iniciar el juego. Probá recargar la página.");
  },
);
