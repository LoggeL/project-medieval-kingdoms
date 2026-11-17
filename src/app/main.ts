/**
 * Einstieg: Simulation erzeugen, Pixi starten, Oberfläche einhängen, Sprites laden, Spielschleife und Eingabe verbinden.
 */
import { Application, TextureSource } from "pixi.js";
import { BUILDINGS } from "../data";
import { GameRenderer } from "../render";
import { loadSheets } from "../render/assets";
import { center, createGame } from "../sim";
import { mountUi } from "../ui";
import { createBridge } from "./bridge";
import { DebugOverlay } from "./debug";
import { Input } from "./input";
import { FixedLoop } from "./loop";
import { Notifier } from "./notify";
import { AppStore } from "./store";
import "./style.css";

const TICK_EVENT_MS = 200;

async function start(): Promise<void> {
  TextureSource.defaultOptions.scaleMode = "nearest";
  const host = document.getElementById("game")!;
  const uiRoot = document.getElementById("ui")!;

  const game = createGame();
  const store = new AppStore();
  const notifier = new Notifier(host);
  let renderer: GameRenderer | null = null;
  const loop = new FixedLoop(game);
  let lastTickEmit = 0;
  const emitTick = () => { lastTickEmit = performance.now(); loop.ticksSinceEmit = 0; store.prune(game.state); store.emit("tick"); };

  const bridge = createBridge({ game, store, notifier, renderer: () => renderer, afterDispatch: emitTick });
  mountUi(uiRoot, bridge);

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: "#17140f",
    antialias: false,
    roundPixels: true,
    autoDensity: true,
    resolution: Math.max(1, window.devicePixelRatio || 1),
    preference: "webgl",
  });
  app.canvas.classList.add("mk-canvas");
  host.prepend(app.canvas);

  const sheets = await loadSheets();
  renderer = new GameRenderer(app, sheets, game.state);
  // Start: Blick auf das eigene Lager
  const home = game.state.buildings.find((b) => b.team === 0 && b.key === "lager") ?? game.state.buildings.find((b) => b.team === 0);
  if (home) renderer.camera.lookAt(...center(home.key, home.x, home.y, home.o));
  else renderer.camera.lookAt(game.state.w / 2, game.state.h / 2);

  const debug = new DebugOverlay(host);
  const input = new Input({
    canvas: app.canvas, game, store, renderer,
    dispatch: (cmd) => bridge.dispatch(cmd),
    notify: (t, k) => notifier.show(t, k),
    toggleDebug: () => debug.toggle(),
  });
  store.emit("assets");
  store.emit("view");

  let last = performance.now(), fps = 60;
  const t0 = last;
  app.ticker.add(() => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    const alpha = loop.advance(dt, store.speed);
    if (loop.ticksSinceEmit > 0 && now - lastTickEmit >= TICK_EVENT_MS) emitTick();
    const time = (now - t0) / 1000;
    const f = input.frame(dt / 1000, time);
    const sel = store.selection;
    renderer!.frame(game.state, alpha, time, {
      ...f, selectedUnits: new Set(sel.units), selectedBuilding: sel.building,
    });
    fps = fps * 0.95 + (1000 / Math.max(1, dt)) * 0.05;
    const st = renderer!.stats;
    debug.update({
      fps, frameMs: performance.now() - now, tickMs: loop.tickAvg, sprites: st.sprites, items: st.items, pairs: st.pairs, chunks: st.chunks,
      units: game.state.units.length, objects: game.state.buildings.length + game.state.trees.length + game.state.rocks.length + game.state.units.length,
      r: renderer!.camera.r, zoom: renderer!.camera.zoom, tick: game.state.tick,
    });
  });

  if (import.meta.env.DEV) Object.assign(window, { __mk: { game, bridge, renderer, store, app, BUILDINGS } });
}

start().catch((e) => {
  console.error(e);
  const host = document.getElementById("game");
  if (host) host.textContent = "Das Spiel konnte nicht starten: " + (e instanceof Error ? e.message : String(e));
});
