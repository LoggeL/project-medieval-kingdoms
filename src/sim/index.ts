/**
 * Einstieg der Simulation: createGame({ seed, size }) startet eine Partie, loadGame(json) lädt einen Spielstand.
 * Beide liefern ein Game (types.ts). Die Platzhalter-Welt aus demo.ts bleibt für Darstellungsversuche erhalten.
 */
export * from "./types";
export * from "./geom";
export { createGame, loadGame, type GameOptions } from "./game";
export { createDemoGame } from "./demo";
