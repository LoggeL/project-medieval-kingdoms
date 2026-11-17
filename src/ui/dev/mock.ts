/**
 * Prüfstand: Mock-Brücke über createDemoGame(). Liefert den Zustand der Platzhalter-Welt, protokolliert Befehle
 * und spielt ein paar davon grob nach (Rekrutieren mit Rekruten auf dem Weg und Warteschlange, Abreißen, Stationieren,
 * Halten), damit sich die Oberfläche bedienen lässt. Keine echte Spiellogik. Icons kommen aus den echten Blättern (sprites.ts).
 * Ausbildungszeiten in Sekunden wie in der Simulation; Kamera, Sichtbereich, Audio und Hinweise wie im Vertrag.
 */
import type { IconKind, Selection, Tool, UiBridge } from "../../app/contract";
import { BUILDINGS, TICKS_PER_SECOND, UNITS, equipmentOf, type BuildingKey, type Good, type UnitKey } from "../../data";
import type { MusicKey } from "../../data/audio";
import { ZOOMS } from "../../data/view";
import { createDemoGame } from "../../sim/demo";
import type { Building, Command, CommandResult, Game, Message, Unit, UnitActivity } from "../../sim/types";
import { cropToAlpha, fitIcon, loadSprites, type Sprites } from "./sprites";

type Ev = "tick" | "selection" | "tool" | "view" | "assets" | "audio";

/** Gebäude ohne eigenes Sprite im Blatt (kommt vom Grafik-Agenten) → nächstes vorhandenes. */
const BUILDING_FALLBACK: Record<string, string> = { tor: "mauer" };
/** Waren ohne Stapel-Sprite: Figur, die sie trägt (nur Prüfstand). */
const GOOD_FALLBACK: Partial<Record<Good, string>> = { holz: "traeger" };
const GOOD_TINT: Record<Good, string> = { holz: "#8a5a2b", stein: "#9a958c", eisen: "#5c6670", speer: "#b08a50", schwert: "#c9ccd2", bogen: "#7a4a22", getreide: "#d0ae5c", mehl: "#e6ddc8", brot: "#b07a3e", erz: "#8c3f22", armbrust: "#9c7040", pike: "#b08a50", ruestung: "#8f969c" };

export interface MockBridge {
  bridge: UiBridge; game: Game; log: (Command & { result: CommandResult })[]; onLog(fn: () => void): void;
  message(text: string, kind: Message["kind"]): void; sprites(): Sprites | null;
  /** Prüfstand-Szene liefert die Ecken des sichtbaren Bereichs (Welt-Tiles). */
  setCorners(fn: () => [number, number][]): void;
}

export function createMockBridge(): MockBridge {
  const game = createDemoGame();
  const s = game.state;
  const subs = new Map<Ev, Set<() => void>>();
  const notifySubs = new Set<(t: string, k?: "info" | "warnung") => void>();
  const emit = (e: Ev) => subs.get(e)?.forEach((f) => f());
  let selection: Selection = { units: [], building: null };
  let tool: Tool = { t: "auswahl" };
  const view = { r: 0, zoom: 1 };
  let speed = 1;
  let sprites: Sprites | null = null;
  const iconCache = new Map<string, HTMLCanvasElement | null>();
  const log: MockBridge["log"] = [];
  const logSubs = new Set<() => void>();

  loadSprites().then((sp) => { sprites = sp; iconCache.clear(); emit("assets"); })
    .catch((e) => console.warn("Prüfstand: Sprites nicht geladen", e));

  const message = (text: string, kind: Message["kind"] = "info") => { s.messages.push({ tick: s.tick, text, kind }); };

  // ------------------------------------------------------------ grobe Nachbildung einiger Befehle
  function run(cmd: Command): CommandResult {
    switch (cmd.t) {
      case "rekrutieren": {
        const b = s.buildings.find((q) => q.id === cmd.building);
        const t = UNITS[cmd.unit].train;
        if (!b || !t) return { ok: false, reason: "Keine Kaserne." };
        if (s.gold < t.gold) return { ok: false, reason: `Nicht genug Gold (${t.gold} nötig).` };
        const eq = equipmentOf(UNITS[cmd.unit]);
        if (eq.some((g) => (s.stock[g] ?? 0) < eq.filter((x) => x === g).length)) return { ok: false, reason: "Keine passende Ausrüstung im Lager." };
        s.gold -= t.gold;
        for (const g of eq) s.stock[g]--;
        // wie die Simulation: Auftrag in die Warteschlange, ein Tagelöhner holt die Waffe und tritt dann ein
        b.queue.push(cmd.unit);
        return { ok: true };
      }
      case "abreissen": {
        const i = s.buildings.findIndex((q) => q.id === cmd.id);
        if (i < 0) return { ok: false, reason: "Gebäude nicht gefunden." };
        const [b] = s.buildings.splice(i, 1);
        for (const t of s.tiles) if (t.building === b.id) t.building = 0;
        message(`${BUILDINGS[b.key].name} abgerissen.`);
        return { ok: true };
      }
      case "stationieren": {
        const posts = s.buildings.filter((b) => BUILDINGS[b.key].posts?.length);
        let n = 0;
        for (const id of cmd.units) {
          const u = s.units.find((q) => q.id === id);
          if (!u || !UNITS[u.key].canStation || !posts.length) continue;
          const b = posts[n % posts.length];
          u.order = { t: "station", building: b.id, post: n };
          u.layer = BUILDINGS[b.key].walkway ?? 1;
          n++;
        }
        if (!n) return { ok: false, reason: "Keine freien Posten.", voice: "kein_posten" };
        message(`${n} Soldaten stationiert.`);
        return n < cmd.units.length ? { ok: true, reason: "Nicht genug freie Posten für alle.", voice: "stationiert" } : { ok: true, voice: "stationiert" };
      }
      case "halten":
        for (const id of cmd.units) { const u = s.units.find((q) => q.id === id); if (u) u.order = { t: "hold" }; }
        return { ok: true };
      case "ueberfall":
        s.raid.next = s.tick;
        return { ok: true };
      default:
        return game.dispatch(cmd);
    }
  }

  // Rekrut auf dem Weg je Kaserne: 3 s Waffe holen, 3 s zur Kaserne tragen, dann Ausbildung (Sekunden)
  const underway = new Map<number, { unit: UnitKey; t: number }>();
  const dt = 1 / TICKS_PER_SECOND;
  function stepBarracks(b: Building): void {
    const tr = b.training;
    if (tr) {
      tr.t += dt;
      if (tr.t >= tr.dur) {
        message(`${UNITS[tr.unit].name} ist ausgebildet.`);
        const c = s.units.find((u) => u.key === "speer" && u.team === 0);
        if (c) s.units.push({ ...c, id: 1000 + s.units.length, key: tr.unit, x: b.x + 1, y: b.y + 4, px: b.x + 1, py: b.y + 4, order: { t: "idle" }, activity: "wartet" });
        b.training = null;
      }
    }
    let w = underway.get(b.id);
    if (!w && b.queue.length) { w = { unit: b.queue[0], t: 0 }; underway.set(b.id, w); }
    if (w) {
      w.t += dt;
      if (w.t >= 6 && !b.training) {
        const i = b.queue.indexOf(w.unit);
        if (i >= 0) b.queue.splice(i, 1);
        b.training = { unit: w.unit, recruit: 0, t: 0, dur: UNITS[w.unit].train?.seconds ?? 8 };
        underway.delete(b.id);
        w = undefined;
      }
    }
    b.recruits = w ? [{ unit: w.unit, stage: w.t < 3 ? "waffe" : "weg" }] : [];
  }
  /** Tätigkeit grob aus Befehl und Animation (in der echten Simulation pflegt sie die Simulation). */
  function activity(u: Unit): UnitActivity {
    if (u.order.t === "station") return "wache";
    if (u.order.t === "hold") return "haelt";
    if (u.order.t === "attack") return "kaempft";
    if (u.carry) return "traegt";
    if (u.key === "holzfaeller") return "faellt";
    if (u.key === "steinmetz") return "baut_ab";
    if (u.team === 1) return "unterwegs";
    return u.anim === "gehen" ? "unterwegs" : "wartet";
  }

  let raidEnd = 0;
  function step(): void {
    game.tick();
    for (const b of s.buildings) if (BUILDINGS[b.key].trains) stepBarracks(b);
    for (const u of s.units) u.activity = activity(u);
    // wie die Simulation: raid.next ist immer der Tick der nächsten Welle, auch während eine Welle läuft
    if (s.tick >= s.raid.next) {
      s.raid.active = true; s.raid.wave++;
      raidEnd = s.tick + 30 * TICKS_PER_SECOND;
      s.raid.next = s.tick + 240 * TICKS_PER_SECOND;
      message(`Angreifer im Westen! Welle ${s.raid.wave}.`, "kampf");
    } else if (s.raid.active && s.tick >= raidEnd) {
      s.raid.active = false;
      message("Die Angreifer ziehen sich zurück.", "info");
    }
    if (s.tick % (45 * TICKS_PER_SECOND) === 0) message("Ein Tagelöhner ist zugezogen.");
  }

  let acc = 0;
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    acc += ((now - last) / 1000) * TICKS_PER_SECOND * speed;
    last = now;
    let n = 0;
    while (acc >= 1 && n < 10) { step(); acc--; n++; }
    if (n) emit("tick");
  }, 1000 / TICKS_PER_SECOND);

  // ------------------------------------------------------------ Icons aus den echten Blättern
  function makeIcon(kind: IconKind, key: string, size: number): HTMLCanvasElement | null {
    if (!sprites) return null;
    if (kind === "gebaeude") {
      const k = sprites.bimg.has(key) ? key : BUILDING_FALLBACK[key] ?? (BUILDINGS[key as BuildingKey]?.sprite ?? key);
      const b = sprites.building(k, 0);
      if (!b) return placeholder(key, size, "#6b4a2b");
      const [cw, ch] = sprites.buildings.cell;
      return fitIcon(cropToAlpha(b.img, b.sx, b.sy, cw, ch), size);
    }
    if (kind === "einheit") {
      const sprite = (UNITS[key as UnitKey]?.sprite ?? key);
      const f = sprites.figure(sprite);
      if (!f) return placeholder(key, size, "#3b5fb0");
      const c = sprites.figures.cell;
      return fitIcon(cropToAlpha(f.img, 0, (f.row + 1) * c, c, c), size);
    }
    // Ware: Stapel aus dem Gebäudeblatt, sonst Ersatz
    if (key === "leer") return null;
    const stack = sprites.building(`stapel_${key}`, 0);
    if (stack) { const [cw, ch] = sprites.buildings.cell; return fitIcon(cropToAlpha(stack.img, stack.sx, stack.sy, cw, ch), size); }
    const fig = GOOD_FALLBACK[key as Good];
    const f = fig ? sprites.figure(fig) : null;
    if (f) { const c = sprites.figures.cell; return fitIcon(cropToAlpha(f.img, 0, (f.row + 2) * c, c, c), size); }
    return placeholder(key, size, GOOD_TINT[key as Good] ?? "#777");
  }

  /** Prüfstand: Angreifer-Icon grob rot einfärben (im Spiel liefert die Darstellung die echte Teamfarbe). */
  function tint(src: HTMLCanvasElement): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const g = c.getContext("2d")!;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "rgba(200, 40, 30, 0.45)";
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  /** Ersatz für fehlende Sprites im Prüfstand: Farbfeld mit Anfangsbuchstabe (deutlich als Ersatz erkennbar). */
  function placeholder(key: string, size: number, color: string): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const g = c.getContext("2d")!;
    g.fillStyle = color;
    g.fillRect(size * 0.15, size * 0.15, size * 0.7, size * 0.7);
    g.strokeStyle = "rgba(0,0,0,.6)";
    g.strokeRect(size * 0.15 + 0.5, size * 0.15 + 0.5, size * 0.7 - 1, size * 0.7 - 1);
    g.fillStyle = "#fff";
    g.font = `bold ${Math.round(size * 0.45)}px sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(key[0].toUpperCase(), size / 2, size / 2 + 1);
    return c;
  }

  const audio: { music: number; voice: number; muted: boolean; track: MusicKey | null } = { music: 0.6, voice: 0.9, muted: false, track: "aufbau_tal" };
  const cam = { x: s.w / 2, y: s.h / 2 };
  let corners: () => [number, number][] = () => [];
  const bridge: UiBridge = {
    state: () => s,
    dispatch(cmd) {
      const result = run(cmd);
      log.push({ ...cmd, result });
      logSubs.forEach((f) => f());
      if (cmd.t !== "rekrutieren" || result.ok) emit("tick");
      return result;
    },
    selection: () => selection,
    select(sel) { selection = { units: [...sel.units], building: sel.building }; emit("selection"); },
    tool: () => tool,
    setTool(t) { tool = t; emit("tool"); },
    view: () => view,
    rotate(dir) { view.r = (((view.r + dir) % 4) + 4) % 4; emit("view"); },
    zoom(dir) { const i = ZOOMS.indexOf(view.zoom as (typeof ZOOMS)[number]); view.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 3 : i) + dir))]; emit("view"); },
    speed: () => speed,
    setSpeed(v) { speed = v; },
    icon(kind, key, size, team = 0) {
      const k = `${kind}:${key}:${size}:${team}`;
      if (!iconCache.has(k)) {
        const c = makeIcon(kind, String(key), size);
        if (!sprites) return null;
        iconCache.set(k, c && team === 1 ? tint(c) : c);
      }
      return iconCache.get(k) ?? null;
    },
    on(ev, fn) {
      if (!subs.has(ev)) subs.set(ev, new Set());
      subs.get(ev)!.add(fn);
      return () => subs.get(ev)!.delete(fn);
    },
    notify(text, kind) { notifySubs.forEach((f) => f(text, kind)); },
    onNotify(fn) { notifySubs.add(fn); return () => { notifySubs.delete(fn); }; },
    camera: () => ({ x: cam.x, y: cam.y, corners: corners() }),
    lookAt(x, y) { cam.x = x; cam.y = y; emit("view"); },
    audio: () => ({ ...audio }),
    setAudio(a) { Object.assign(audio, a); emit("audio"); },
  };

  return {
    bridge, game, log, onLog: (fn) => logSubs.add(fn), message: (t, k) => { message(t, k); emit("tick"); }, sprites: () => sprites,
    setCorners: (fn) => { corners = fn; },
  };
}
