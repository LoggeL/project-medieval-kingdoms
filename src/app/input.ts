/**
 * Eingabe: Maus und Tastatur → Kamera, Auswahl, Werkzeuge und Befehle an die Simulation.
 *
 * Kamera: WASD/Pfeile, Bildschirmrand, mittlere oder rechte Maustaste ziehen, Mausrad (zur Maus hin), Q/E drehen.
 * Auswahl: Linksklick (pixelgenau, oberstes Objekt), Rahmen ziehen (eigene Einheiten), Shift ergänzt,
 * Doppelklick wählt alle sichtbaren gleicher Art. Rechtsklick: Feind angreifen, sonst bewegen (auch auf den Wehrgang).
 * T stationieren, H halten, Strg+Ziffer Gruppe speichern, Ziffer Gruppe wählen.
 * Bauen: Vorschau, R dreht, Linksklick baut, Shift hält das Werkzeug, Esc/Rechtsklick bricht ab.
 * Mauer: von Start- zu End-Tile ziehen, Loslassen baut. Abriss: Klick auf ein eigenes Gebäude.
 */
import { BUILDINGS, UNITS, type BuildingKey } from "../data";
import { footprint } from "../sim/geom";
import type { Command, CommandResult, Game, PlacementCheck } from "../sim/types";
import type { FrameInput, GameRenderer, Marker, Preview } from "../render";
import type { Tool } from "./contract";
import type { AppStore } from "./store";

const DRAG_PX = 5;
const EDGE_PX = 6;
const PAN_SPEED = 900; // Bildschirmpixel je Sekunde
const DBL_MS = 320;

export interface InputContext {
  canvas: HTMLCanvasElement;
  game: Game;
  store: AppStore;
  renderer: GameRenderer;
  dispatch: (cmd: Command) => CommandResult;
  notify: (text: string, kind?: "info" | "warnung") => void;
  toggleDebug: () => void;
}

export class Input {
  private mx = -1;
  private my = -1;
  private over = false;
  private keys = new Set<string>();
  private left: { sx: number; sy: number; drag: boolean; shift: boolean } | null = null;
  private pan: { sx: number; sy: number; moved: boolean; button: number } | null = null;
  private wallStart: { x: number; y: number } | null = null;
  private markers: Marker[] = [];
  private wheelAcc = 0;
  private lastClick = { t: 0, id: 0 };
  private check: { id: string; tick: number; res: PlacementCheck } | null = null;
  private time = 0;

  constructor(private ctx: InputContext) {
    const c = ctx.canvas;
    c.addEventListener("pointerdown", (e) => this.down(e));
    window.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", (e) => this.up(e));
    c.addEventListener("pointerenter", () => { this.over = true; });
    c.addEventListener("pointerleave", () => { this.over = false; });
    document.addEventListener("mouseleave", () => { this.over = false; });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    window.addEventListener("keydown", (e) => this.keydown(e));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.left = null; this.pan = null; });
  }

  private get r(): GameRenderer { return this.ctx.renderer; }
  private get tool(): Tool { return this.ctx.store.tool; }

  private pos(e: { clientX: number; clientY: number }): [number, number] {
    const b = this.ctx.canvas.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  }

  // ---------------------------------------------------------------- Maus

  private down(e: PointerEvent): void {
    const [x, y] = this.pos(e);
    this.mx = x; this.my = y; this.over = true;
    try { this.ctx.canvas.setPointerCapture(e.pointerId); } catch { /* Zeiger nicht aktiv (z. B. synthetisch) */ }
    if (e.button === 1 || e.button === 2) {
      this.pan = { sx: x, sy: y, moved: false, button: e.button };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const t = this.tool;
    if (t.t === "mauer" || (t.t === "bauen" && BUILDINGS[t.key].drag)) {
      const tile = this.r.tileAt(x, y);
      this.wallStart = { x: tile.x, y: tile.y };
      return;
    }
    this.left = { sx: x, sy: y, drag: false, shift: e.shiftKey };
  }

  private move(e: PointerEvent): void {
    const [x, y] = this.pos(e);
    if (this.pan) {
      const dx = x - this.mx, dy = y - this.my;
      if (Math.abs(x - this.pan.sx) + Math.abs(y - this.pan.sy) > DRAG_PX) this.pan.moved = true;
      if (this.pan.moved) this.r.camera.pan(-dx, -dy);
    }
    if (this.left && !this.left.drag && Math.abs(x - this.left.sx) + Math.abs(y - this.left.sy) > DRAG_PX && this.tool.t === "auswahl") this.left.drag = true;
    this.mx = x; this.my = y;
  }

  private up(e: PointerEvent): void {
    const [x, y] = this.pos(e);
    this.mx = x; this.my = y;
    if (this.pan && (e.button === 1 || e.button === 2)) {
      const p = this.pan;
      this.pan = null;
      if (!p.moved && p.button === 2) this.rightClick(x, y, e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (this.wallStart) {
      const s = this.wallStart;
      this.wallStart = null;
      const end = this.r.tileAt(x, y);
      const res = this.ctx.dispatch({ t: "mauer", x0: s.x, y0: s.y, x1: end.x, y1: end.y });
      if (!res.ok) this.ctx.notify(res.reason ?? "Hier kann keine Mauer stehen.", "warnung");
      return;
    }
    const l = this.left;
    this.left = null;
    if (!l) return;
    const t = this.tool;
    if (t.t === "auswahl") {
      if (l.drag) this.boxSelect(l.sx, l.sy, x, y, e.shiftKey);
      else this.clickSelect(x, y, e.shiftKey);
    } else if (t.t === "bauen") this.build(t, x, y, e.shiftKey);
    else if (t.t === "abriss") this.demolish(x, y, e.shiftKey);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const step = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    this.wheelAcc += step;
    if (Math.abs(this.wheelAcc) < 50) return;
    const dir = this.wheelAcc < 0 ? 1 : -1;
    this.wheelAcc = 0;
    const [x, y] = this.pos(e);
    if (this.r.zoom(dir, x, y)) this.ctx.store.emit("view");
  }

  // ---------------------------------------------------------------- Auswahl und Befehle

  private clickSelect(x: number, y: number, shift: boolean): void {
    const { store, game } = this.ctx;
    const hit = this.r.pick(x, y);
    const now = performance.now();
    if (hit?.kind === "unit") {
      const dbl = now - this.lastClick.t < DBL_MS && this.lastClick.id === hit.id;
      this.lastClick = { t: now, id: hit.id };
      if (dbl && hit.team === 0) {
        // alle sichtbaren eigenen Einheiten gleicher Art
        const key = game.state.units.find((u) => u.id === hit.id)?.key;
        const ids = this.r.unitsInRect(0, 0, this.r.camera.sw, this.r.camera.sh, 0)
          .filter((id) => game.state.units.find((u) => u.id === id)?.key === key);
        store.select({ units: shift ? [...store.selection.units, ...ids] : ids, building: null });
        return;
      }
      if (shift && hit.team === 0) {
        const cur = store.selection.units;
        const units = cur.includes(hit.id) ? cur.filter((id) => id !== hit.id) : [...cur, hit.id];
        store.select({ units, building: null });
      } else store.select({ units: [hit.id], building: null });
      return;
    }
    this.lastClick = { t: now, id: 0 };
    if (hit?.kind === "building") { store.select({ units: [], building: hit.id }); return; }
    if (!shift) store.select({ units: [], building: null });
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, shift: boolean): void {
    const { store } = this.ctx;
    const ids = this.r.unitsInRect(x0, y0, x1, y1, 0);
    store.select({ units: shift ? [...store.selection.units, ...ids] : ids, building: shift ? store.selection.building : null });
  }

  private ownSelected(): number[] {
    const st = this.ctx.game.state;
    return this.ctx.store.selection.units.filter((id) => st.units.some((u) => u.id === id && u.team === 0 && !u.dead));
  }

  private rightClick(x: number, y: number, _shift: boolean): void {
    const { store, dispatch, notify } = this.ctx;
    if (this.tool.t !== "auswahl") { store.setTool({ t: "auswahl" }); this.wallStart = null; return; }
    const units = this.ownSelected();
    if (!units.length) return;
    const enemy = this.r.pick(x, y, (h) => h.team !== 0);
    if (enemy) {
      const res = dispatch({ t: "angreifen", units, target: enemy.id });
      if (!res.ok) notify(res.reason ?? "Angriff nicht möglich.", "warnung");
      else this.marker(x, y, 0xe0503c);
      return;
    }
    const tile = this.r.tileAt(x, y, (tx, ty) => this.ctx.game.walkLayerAt(tx, ty));
    const res = dispatch({ t: "bewegen", units, x: tile.x, y: tile.y });
    if (!res.ok) notify(res.reason ?? "Dort kommen sie nicht hin.", "warnung");
    else this.markers.push({ x: tile.x + 0.5, y: tile.y + 0.5, z: tile.z, t0: this.time, color: tile.layer ? 0x8fd0ff : 0x9fe07a });
  }

  private marker(x: number, y: number, color: number): void {
    const tile = this.r.tileAt(x, y, (tx, ty) => this.ctx.game.walkLayerAt(tx, ty));
    this.markers.push({ x: tile.x + 0.5, y: tile.y + 0.5, z: tile.z, t0: this.time, color });
  }

  // ---------------------------------------------------------------- Bauen und Abriss

  /** Linke obere Ecke so, dass der Grundriss um den Maus-Tile liegt. */
  private buildOrigin(key: BuildingKey, o: number, x: number, y: number): [number, number] {
    const tile = this.r.tileAt(x, y);
    const [w, h] = footprint(key, o);
    return [tile.x - Math.floor((w - 1) / 2), tile.y - Math.floor((h - 1) / 2)];
  }

  private placement(key: BuildingKey, bx: number, by: number, o: number): PlacementCheck {
    const id = `${key}:${bx}:${by}:${o}`;
    const tick = this.ctx.game.state.tick;
    if (!this.check || this.check.id !== id || tick - this.check.tick > 5) this.check = { id, tick, res: this.ctx.game.canPlace(key, bx, by, o) };
    return this.check.res;
  }

  private build(t: Extract<Tool, { t: "bauen" }>, x: number, y: number, shift: boolean): void {
    const [bx, by] = this.buildOrigin(t.key, t.o, x, y);
    const check = this.placement(t.key, bx, by, t.o);
    if (!check.ok) { this.ctx.notify(check.reason ?? "Hier kann nicht gebaut werden.", "warnung"); return; }
    const res = this.ctx.dispatch({ t: "bauen", key: t.key, x: bx, y: by, o: t.o });
    this.check = null;
    if (!res.ok) { this.ctx.notify(res.reason ?? "Hier kann nicht gebaut werden.", "warnung"); return; }
    if (!shift) this.ctx.store.setTool({ t: "auswahl" });
  }

  private demolish(x: number, y: number, shift: boolean): void {
    const hit = this.r.pick(x, y, (h) => h.kind === "building" && h.team === 0);
    if (!hit) return;
    const res = this.ctx.dispatch({ t: "abreissen", id: hit.id });
    if (!res.ok) this.ctx.notify(res.reason ?? "Das lässt sich nicht abreißen.", "warnung");
    else if (!shift) this.ctx.store.setTool({ t: "auswahl" });
  }

  // ---------------------------------------------------------------- Tastatur

  private keydown(e: KeyboardEvent): void {
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT" || tg.isContentEditable)) return;
    const { store, dispatch, notify } = this.ctx;
    this.keys.add(e.code);
    if (e.code === "F3") { e.preventDefault(); this.ctx.toggleDebug(); return; }
    if (e.ctrlKey || e.metaKey) {
      const n = digit(e.code);
      if (n !== null && e.ctrlKey) {
        e.preventDefault();
        store.groups.set(n, this.ownSelected());
        notify(`Gruppe ${n} gespeichert`);
      }
      return;
    }
    const n = digit(e.code);
    if (n !== null) {
      const g = store.groups.get(n);
      if (g?.length) store.select({ units: g, building: null });
      return;
    }
    switch (e.code) {
      case "KeyQ": this.r.rotate(1); store.emit("view"); break;
      case "KeyE": this.r.rotate(-1); store.emit("view"); break;
      case "KeyR": {
        const t = store.tool;
        if (t.t === "bauen") store.setTool({ ...t, o: (t.o + (e.shiftKey ? 3 : 1)) % 4 });
        break;
      }
      case "KeyT": {
        const units = this.ownSelected().filter((id) => {
          const u = this.ctx.game.state.units.find((q) => q.id === id);
          return u && UNITS[u.key].canStation;
        });
        if (!units.length) { notify("Keine Soldaten ausgewählt, die auf die Mauer können.", "warnung"); break; }
        const res = dispatch({ t: "stationieren", units });
        if (!res.ok) notify(res.reason ?? "Kein freier Posten.", "warnung");
        break;
      }
      case "KeyH": {
        const units = this.ownSelected();
        if (units.length) dispatch({ t: "halten", units });
        break;
      }
      case "Escape":
        if (store.tool.t !== "auswahl") { store.setTool({ t: "auswahl" }); this.wallStart = null; }
        else store.select({ units: [], building: null });
        break;
      case "Equal": case "NumpadAdd": case "BracketRight": if (this.r.zoom(1)) store.emit("view"); break;
      case "Minus": case "NumpadSubtract": case "Slash": if (this.r.zoom(-1)) store.emit("view"); break;
      case "KeyP": case "Pause": store.speed = store.speed ? 0 : 1; store.emit("tick"); break;
      default: return;
    }
  }

  // ---------------------------------------------------------------- jedes Bild

  /** Kamerafahrt, Vorschau und Hervorhebungen für dieses Bild. */
  frame(dt: number, time: number): Omit<FrameInput, "selectedUnits" | "selectedBuilding"> {
    this.time = time;
    const cam = this.r.camera;
    // Tastatur und Bildschirmrand
    let dx = 0, dy = 0;
    const k = this.keys;
    if (k.has("KeyA") || k.has("ArrowLeft")) dx -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) dx += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) dy -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) dy += 1;
    if (this.over && !this.pan && document.hasFocus()) {
      if (this.mx >= 0 && this.mx < EDGE_PX) dx -= 1;
      if (this.mx > cam.sw - EDGE_PX) dx += 1;
      if (this.my >= 0 && this.my < EDGE_PX) dy -= 1;
      if (this.my > cam.sh - EDGE_PX) dy += 1;
    }
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      const sp = PAN_SPEED * Math.min(0.05, dt) * Math.max(1, cam.zoom / 2);
      cam.pan((dx / len) * sp, (dy / len) * sp);
    }
    this.markers = this.markers.filter((m) => time - m.t0 < 0.8);

    let preview: Preview | null = null;
    let danger: number | null = null;
    let highlight: number | null = null;
    const t = this.tool;
    const canvas = this.ctx.canvas;
    const inside = this.over && this.mx >= 0;
    if ((t.t === "mauer" || (t.t === "bauen" && BUILDINGS[t.key].drag)) && inside) {
      const end = this.r.tileAt(this.mx, this.my);
      const s = this.wallStart ?? end;
      const id = `wall:${s.x}:${s.y}:${end.x}:${end.y}`;
      const tick = this.ctx.game.state.tick;
      if (!this.check || this.check.id !== id || tick - this.check.tick > 5) this.check = { id, tick, res: this.ctx.game.wallPath(s.x, s.y, end.x, end.y) };
      const res = this.check.res;
      preview = { kind: "mauer", check: res.tiles.length ? res : { ...res, tiles: [{ x: end.x, y: end.y, ok: res.ok }] } };
      canvas.style.cursor = "crosshair";
    } else if (t.t === "bauen" && inside) {
      const [bx, by] = this.buildOrigin(t.key, t.o, this.mx, this.my);
      preview = { kind: "bauen", key: t.key, x: bx, y: by, o: t.o, check: this.placement(t.key, bx, by, t.o) };
      canvas.style.cursor = "crosshair";
    } else if (t.t === "abriss" && inside) {
      danger = this.r.pick(this.mx, this.my, (h) => h.kind === "building" && h.team === 0)?.id ?? null;
      canvas.style.cursor = danger ? "pointer" : "not-allowed";
    } else if (inside && !this.pan) {
      const hit = this.r.pick(this.mx, this.my);
      const sel = this.ownSelected().length > 0;
      if (hit?.kind === "building") highlight = hit.id;
      canvas.style.cursor = hit ? (sel && hit.team !== 0 ? "crosshair" : "pointer") : "default";
      if (sel && !hit) {
        const tile = this.r.tileAt(this.mx, this.my, (tx, ty) => this.ctx.game.walkLayerAt(tx, ty));
        if (tile.layer > 0) preview = { kind: "kachel", x: tile.x, y: tile.y, z: tile.z, color: 0x8fd0ff };
      }
    } else if (this.pan?.moved) canvas.style.cursor = "grabbing";
    const l = this.left;
    return {
      danger, highlight, preview, markers: this.markers,
      dragRect: l?.drag ? { x0: l.sx, y0: l.sy, x1: this.mx, y1: this.my } : null,
    };
  }
}

function digit(code: string): number | null {
  const m = /^Digit([0-9])$/.exec(code);
  return m ? Number(m[1]) : null;
}
