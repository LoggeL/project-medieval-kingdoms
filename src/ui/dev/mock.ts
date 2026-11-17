/**
 * Prüfstand: Mock-Brücke über createDemoGame(). Liefert den Zustand der Platzhalter-Welt, protokolliert Befehle
 * und spielt ein paar davon grob nach (Rekrutieren mit Warteschlange, Abreißen, Stationieren, Halten), damit sich
 * die Oberfläche bedienen lässt. Keine echte Spiellogik. Icons kommen aus den echten Blättern (sprites.ts).
 */
import type { IconKind, Selection, Tool, UiBridge } from "../../app/contract";
import { BUILDINGS, TICKS_PER_SECOND, UNITS, type BuildingKey, type Good, type UnitKey } from "../../data";
import { createDemoGame } from "../../sim/demo";
import type { Command, CommandResult, Game, Message } from "../../sim/types";
import { cropToAlpha, fitIcon, loadSprites, type Sprites } from "./sprites";

type Ev = "tick" | "selection" | "tool" | "view" | "assets";

/** Gebäude ohne eigenes Sprite im Blatt (kommt vom Grafik-Agenten) → nächstes vorhandenes. */
const BUILDING_FALLBACK: Record<string, string> = { tor: "mauer" };
/** Waren ohne Stapel-Sprite: Figur, die sie trägt (nur Prüfstand). */
const GOOD_FALLBACK: Partial<Record<Good, string>> = { holz: "traeger" };
const GOOD_TINT: Record<Good, string> = { holz: "#8a5a2b", stein: "#9a958c", eisen: "#5c6670", speer: "#b08a50", schwert: "#c9ccd2", bogen: "#7a4a22" };

export interface MockBridge { bridge: UiBridge; game: Game; log: (Command & { result: CommandResult })[]; onLog(fn: () => void): void; message(text: string, kind: Message["kind"]): void; sprites(): Sprites | null }

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
        if ((s.stock[t.equipment] ?? 0) < 1) return { ok: false, reason: "Keine passende Waffe im Lager." };
        s.gold -= t.gold;
        s.stock[t.equipment]--;
        if (b.training) b.queue.push(cmd.unit);
        else b.training = { unit: cmd.unit, recruit: 0, t: 0, dur: t.seconds * TICKS_PER_SECOND };
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
        if (!n) return { ok: false, reason: "Keine freien Posten." };
        message(`${n} Soldaten stationiert.`);
        return { ok: true };
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

  function step(): void {
    game.tick();
    for (const b of s.buildings) {
      const tr = b.training;
      if (!tr) continue;
      tr.t++;
      if (tr.t >= tr.dur) {
        message(`${UNITS[tr.unit].name} ist ausgebildet.`);
        const c = s.units.find((u) => u.key === "speer" && u.team === 0);
        if (c) s.units.push({ ...c, id: 1000 + s.units.length, key: tr.unit, x: b.x + 1, y: b.y + 4, px: b.x + 1, py: b.y + 4, order: { t: "idle" } });
        const next = b.queue.shift();
        b.training = next ? { unit: next, recruit: 0, t: 0, dur: (UNITS[next].train?.seconds ?? 8) * TICKS_PER_SECOND } : null;
      }
    }
    if (!s.raid.active && s.tick >= s.raid.next) {
      s.raid.active = true; s.raid.wave++;
      message(`Angreifer im Westen! Welle ${s.raid.wave}.`, "kampf");
    } else if (s.raid.active && s.tick >= s.raid.next + 30 * TICKS_PER_SECOND) {
      s.raid.active = false;
      s.raid.next = s.tick + 240 * TICKS_PER_SECOND;
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
    rotate(dir) { view.r = (view.r + dir + 4) % 4; emit("view"); },
    zoom(dir) { view.zoom = Math.max(0.5, Math.min(3, view.zoom + dir * 0.5)); emit("view"); },
    speed: () => speed,
    setSpeed(v) { speed = v; },
    icon(kind, key, size) {
      const k = `${kind}:${key}:${size}`;
      if (!iconCache.has(k)) { const c = makeIcon(kind, String(key), size); if (!sprites) return null; iconCache.set(k, c); }
      return iconCache.get(k) ?? null;
    },
    on(ev, fn) {
      if (!subs.has(ev)) subs.set(ev, new Set());
      subs.get(ev)!.add(fn);
      return () => subs.get(ev)!.delete(fn);
    },
    notify(text, kind) { notifySubs.forEach((f) => f(text, kind)); },
    onNotify(fn) { notifySubs.add(fn); return () => notifySubs.delete(fn); },
  };

  return { bridge, game, log, onLog: (fn) => logSubs.add(fn), message: (t, k) => { message(t, k); emit("tick"); }, sprites: () => sprites };
}
