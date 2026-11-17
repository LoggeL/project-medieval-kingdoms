/**
 * UiBridge: die einzige Verbindung der DOM-Oberfläche (src/ui) zu Simulation und Darstellung.
 */
import type { Game } from "../sim/types";
import type { GameRenderer } from "../render";
import { makeIcon } from "../render/icons";
import type { IconKind, Selection, Tool, UiBridge } from "./contract";
import type { Notifier } from "./notify";
import type { AppStore } from "./store";

export interface BridgeContext {
  game: Game;
  store: AppStore;
  notifier: Notifier;
  renderer: () => GameRenderer | null;
  /** Nach einem Befehl die Oberfläche sofort auffrischen. */
  afterDispatch: () => void;
}

export function createBridge(ctx: BridgeContext): UiBridge {
  const { game, store } = ctx;
  return {
    state: () => game.state,
    dispatch(cmd) {
      const res = game.dispatch(cmd);
      ctx.afterDispatch();
      return res;
    },
    selection: (): Selection => store.selection,
    select: (sel) => store.select(sel),
    tool: (): Tool => store.tool,
    setTool: (t) => store.setTool(t),
    view() {
      const r = ctx.renderer();
      return r ? { r: r.camera.r, zoom: r.camera.zoom } : { r: 0, zoom: 2 };
    },
    rotate(dir) {
      const r = ctx.renderer();
      if (!r) return;
      r.rotate(dir);
      store.emit("view");
    },
    zoom(dir) {
      const r = ctx.renderer();
      if (r && r.zoom(dir)) store.emit("view");
    },
    speed: () => store.speed,
    setSpeed(v) {
      const s = Math.max(0, Math.min(2, Math.round(v)));
      if (s === store.speed) return;
      store.speed = s;
      store.emit("tick");
    },
    icon(kind: IconKind, key: string, size: number) {
      const r = ctx.renderer();
      return r ? makeIcon(r.sheets, kind, key, size) : null;
    },
    on: (ev, fn) => store.on(ev, fn),
    notify: (text, kind = "info") => ctx.notifier.show(text, kind),
    // Vorläufig (Vertrag erweitert, Umsetzung folgt): Kamera für die Übersichtskarte, Audio, Hinweis-Abo
    camera() {
      const r = ctx.renderer();
      return r ? { x: r.camera.x, y: r.camera.y, corners: [] } : { x: 0, y: 0, corners: [] };
    },
    lookAt(x, y) { ctx.renderer()?.camera.lookAt(x, y); store.emit("view"); },
    audio: () => ({ music: 0.6, voice: 0.9, muted: false }),
    setAudio() { store.emit("audio"); },
    onNotify: () => () => undefined,
  };
}
