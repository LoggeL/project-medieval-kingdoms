/**
 * Einstieg: Simulation erzeugen, Pixi starten, Oberfläche einhängen, Sprites laden, Spielschleife, Eingabe und Audio verbinden.
 * Davor und währenddessen: Ladebildschirm mit Fortschritt (boot), danach der Titelbildschirm. Die Simulation tickt erst
 * nach „Neues Spiel“ (src/ui/start).
 */
import { Application, TextureSource } from "pixi.js";
import { GameRenderer } from "../render";
import { loadSheets } from "../render/assets";
import { center, createGame } from "../sim";
import { mountUi } from "../ui";
import { Startbildschirm } from "../ui/start";
import { AudioDirector } from "./audio";
import { createBridge, loadAudioSettings } from "./bridge";
import { DebugOverlay } from "./debug";
import { Input } from "./input";
import { FixedLoop } from "./loop";
import { NotifyHub, PointerHint } from "./notify";
import { AppStore } from "./store";
import "./style.css";

const TICK_EVENT_MS = 200;
/** Kamerabewegung höchstens so oft als "view" melden (Übersichtskarte). */
const VIEW_EVENT_MS = 100;

async function start(boot: Startbildschirm): Promise<void> {
  TextureSource.defaultOptions.scaleMode = "nearest";
  const host = document.getElementById("game")!;
  const uiRoot = document.getElementById("ui")!;
  boot.fertig("code");
  const nebenbei = boot.nebenbei();

  const game = await boot.schritt("welt", () => createGame());
  if (import.meta.env.DEV) Object.assign(window, { mkStart: { boot, tick: () => game.state.tick } });
  const store = new AppStore();
  const hub = new NotifyHub();
  let renderer: GameRenderer | null = null;
  const loop = new FixedLoop(game);
  let lastTickEmit = 0;
  const emitTick = () => { lastTickEmit = performance.now(); loop.ticksSinceEmit = 0; store.prune(game.state); store.emit("tick"); };

  const audioSettings = loadAudioSettings();
  let audio: AudioDirector | null = null;
  const bridge = createBridge({
    game, store, hub, renderer: () => renderer, afterDispatch: emitTick, say: (k) => audio?.say(k),
    track: () => audio?.current() ?? null,
  }, audioSettings);
  audio = new AudioDirector(() => audioSettings, () => game.state, () => store.speed);
  mountUi(uiRoot, bridge);

  const app = new Application();
  await boot.schritt("grafik", () => app.init({
    resizeTo: window,
    background: "#17140f",
    antialias: false,
    roundPixels: true,
    // Auflösung 1: ein Canvas-Pixel je CSS-Pixel. Der Browser skaliert pixelscharf auf die Gerätepixel hoch
    // (style.css: image-rendering: pixelated). Gleiches Bild bei ganzzahligem Zoom, aber bei devicePixelRatio 2
    // nur ein Viertel der Füllarbeit; das hält Maus und Bildrate flüssig.
    resolution: 1,
    autoDensity: true,
    preference: "webgl",
  }));
  app.ticker.stop(); // bis „Neues Spiel“ nichts zeichnen
  app.canvas.classList.add("mk-canvas");
  host.prepend(app.canvas);

  const sheets = await loadSheets(boot.datei);
  boot.fertig("gebaeude", "figuren", "gelaende");
  renderer = new GameRenderer(app, sheets, game.state);
  // Start: Blick auf das eigene Lager
  const home = game.state.buildings.find((b) => b.team === 0 && b.key === "lager") ?? game.state.buildings.find((b) => b.team === 0);
  if (home) renderer.camera.lookAt(...center(home.key, home.x, home.y, home.o));
  else renderer.camera.lookAt(game.state.w / 2, game.state.h / 2);

  await nebenbei;
  // Titelbildschirm; erst danach Eingabe, Spielschleife und Audio-Regie
  await boot.titel(bridge);

  const debug = new DebugOverlay();
  const hint = new PointerHint();
  const input = new Input({ canvas: app.canvas, game, store, renderer, bridge, hint, toggleDebug: () => debug.toggle() });
  store.emit("assets");
  store.emit("view");
  // Nur im Entwicklungsmodus: Zugriff für Tests im Browser (window.mk).
  if (import.meta.env.DEV) Object.assign(window, { mk: { game, bridge, store, renderer, app, hub, audio } });

  let last = performance.now(), fps = 60;
  const t0 = last;
  let viewKey = "", lastViewEmit = 0;
  let lastTrack: string | null = null;
  const selected = new Set<number>();
  let selRef = store.selection;
  let soft = false, frameStart = 0, jsMs = 0;
  app.ticker.add(() => {
    const now = performance.now();
    frameStart = now;
    const dt = now - last;
    last = now;
    const r = renderer!;
    const alpha = loop.advance(dt, store.speed);
    if (loop.ticksSinceEmit > 0 && now - lastTickEmit >= TICK_EVENT_MS) emitTick();
    const time = (now - t0) / 1000;
    const f = input.frame(dt / 1000, time);
    const sel = store.selection;
    if (sel !== selRef) { selRef = sel; selected.clear(); for (const id of sel.units) selected.add(id); }
    r.frame(game.state, alpha, time, { ...f, selectedUnits: selected, selectedBuilding: sel.building });
    // Kamerabewegung (Ziehen, Rand, Tasten) gedrosselt melden
    const cam = r.camera;
    const vk = `${Math.round(cam.x)},${Math.round(cam.y)},${cam.r},${cam.zoom},${cam.sw},${cam.sh}`;
    if (vk !== viewKey && now - lastViewEmit >= VIEW_EVENT_MS) { viewKey = vk; lastViewEmit = now; store.emit("view"); }
    audio!.update();
    const tr = audio!.current();
    if (tr !== lastTrack) { lastTrack = tr; store.emit("audio"); }
    // Bildschirmauflösung folgt der Zoomstufe: Übersicht (0,5×) darf weich sein
    const weich = cam.zoom < 1;
    if (weich !== soft) { soft = weich; app.canvas.classList.toggle("mk-weich", weich); }
    fps = fps * 0.95 + (1000 / Math.max(1, dt)) * 0.05;
    const st = r.stats;
    debug.update({
      fps, frameMs: jsMs, tickMs: loop.tickAvg, sprites: st.sprites, items: st.items, pairs: st.pairs, chunks: st.chunks,
      units: game.state.units.length, objects: game.state.buildings.length + game.state.trees.length + game.state.rocks.length + game.state.units.length,
      r: cam.r, zoom: cam.zoom, tick: game.state.tick, silhouettes: st.silhouettes, resolution: app.renderer.resolution,
    });
  });
  // JS-Zeit des ganzen Bildes einschließlich Pixi-Zeichnen (läuft mit niedrigerer Priorität nach dem Callback oben)
  app.ticker.add(() => { jsMs = jsMs * 0.9 + (performance.now() - frameStart) * 0.1; }, null, -100);
  app.ticker.start();
  void boot.insSpiel();
}

const boot = new Startbildschirm();
start(boot).catch((e) => {
  console.error(e);
  boot.fehler(e);
});
