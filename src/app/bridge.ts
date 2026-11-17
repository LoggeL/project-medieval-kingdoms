/**
 * UiBridge: die einzige Verbindung der DOM-Oberfläche (src/ui) zu Simulation und Darstellung.
 */
import type { Game } from "../sim/types";
import type { GameRenderer } from "../render";
import { makeIcon } from "../render/icons";
import { ZOOMS, ZOOM_DEFAULT } from "../data/view";
import type { MusicKey, VoiceKey } from "../data/audio";
import type { AudioSettings } from "./audio";
import type { IconKind, Selection, Tool, UiBridge } from "./contract";
import type { NotifyHub } from "./notify";
import type { AppStore } from "./store";

export interface BridgeContext {
  game: Game;
  store: AppStore;
  hub: NotifyHub;
  renderer: () => GameRenderer | null;
  /** Nach einem Befehl die Oberfläche sofort auffrischen. */
  afterDispatch: () => void;
  /** Sprecheransage zu einem Befehlsergebnis. */
  say: (key: VoiceKey | undefined) => void;
  /** Laufendes Musikstück für die Anzeige in der Oberfläche. */
  track: () => MusicKey | null;
}

const AUDIO_KEY = "mk-audio";
const AUDIO_DEFAULT: AudioSettings = { music: 0.6, voice: 0.9, muted: false };

/** Lautstärken aus dem Browser lesen (jeder Zugriff abgesichert: privater Modus, gesperrter Speicher). */
export function loadAudioSettings(): AudioSettings {
  try {
    const raw = window.localStorage.getItem(AUDIO_KEY);
    if (!raw) return { ...AUDIO_DEFAULT };
    const v = JSON.parse(raw) as Partial<AudioSettings>;
    const num = (x: unknown, d: number) => (typeof x === "number" && isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
    return { music: num(v.music, AUDIO_DEFAULT.music), voice: num(v.voice, AUDIO_DEFAULT.voice), muted: typeof v.muted === "boolean" ? v.muted : AUDIO_DEFAULT.muted };
  } catch {
    return { ...AUDIO_DEFAULT };
  }
}

function saveAudioSettings(a: AudioSettings): void {
  try { window.localStorage.setItem(AUDIO_KEY, JSON.stringify(a)); } catch { /* Speicher nicht verfügbar: nur für diese Sitzung */ }
}

export function createBridge(ctx: BridgeContext, audio: AudioSettings): UiBridge {
  const { game, store } = ctx;
  return {
    state: () => game.state,
    dispatch(cmd) {
      const res = game.dispatch(cmd);
      ctx.say(res.voice);
      ctx.afterDispatch();
      return res;
    },
    selection: (): Selection => store.selection,
    select: (sel) => store.select(sel),
    tool: (): Tool => store.tool,
    setTool: (t) => store.setTool(t),
    view() {
      const r = ctx.renderer();
      return r ? { r: r.camera.r, zoom: r.camera.targetZoom } : { r: 0, zoom: ZOOMS[ZOOM_DEFAULT] };
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
      if (s === 0) store.resumeSpeed = store.speed;
      store.speed = s;
      store.emit("tick");
    },
    icon(kind: IconKind, key: string, size: number, team: 0 | 1 = 0) {
      const r = ctx.renderer();
      return r ? makeIcon(r.sheets, kind, key, size, team) : null;
    },
    camera() {
      const r = ctx.renderer();
      if (r) return r.visibleGround();
      const s = game.state;
      return { x: s.w / 2, y: s.h / 2, corners: [] };
    },
    lookAt(x, y) {
      const r = ctx.renderer();
      if (!r) return;
      r.camera.lookAt(x, y);
      store.emit("view");
    },
    audio: () => ({ ...audio, track: ctx.track() }),
    setAudio(a) {
      const num = (x: number | undefined, d: number) => (typeof x === "number" && isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
      audio.music = num(a.music, audio.music);
      audio.voice = num(a.voice, audio.voice);
      if (typeof a.muted === "boolean") audio.muted = a.muted;
      saveAudioSettings(audio);
      store.emit("audio");
    },
    on: (ev, fn) => store.on(ev, fn),
    notify: (text, kind = "info") => ctx.hub.emit(text, kind),
    onNotify: (fn) => ctx.hub.subscribe(fn),
  };
}
