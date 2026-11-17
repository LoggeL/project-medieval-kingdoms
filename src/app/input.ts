/**
 * Eingabe: Maus und Tastatur → Kamera, Auswahl, Werkzeuge und Befehle an die Simulation.
 *
 * Kamera: WASD/Pfeile, Bildschirmrand (Fensterrand, auch über den Leisten), mittlere oder rechte Maustaste ziehen,
 * Mausrad (zur Maus hin), Q dreht nach links (rotate −1), E nach rechts (rotate +1), wie die Knöpfe ⟲/⟳.
 * Leertaste: Pause/Weiter (global, auch wenn ein Knopf den Fokus hat).
 * Auswahl: Linksklick (pixelgenau, oberstes Objekt), Rahmen ziehen (eigene Einheiten), Shift ergänzt,
 * Doppelklick wählt alle sichtbaren gleicher Art. Rechtsklick: Feind angreifen, sonst bewegen (auch auf den Wehrgang).
 * T stationieren, H halten, Strg+Ziffer Gruppe speichern, Ziffer Gruppe wählen. F9 Debug-Anzeige.
 * Tastenbelegung aus src/data/hotkeys.ts (APP_KEYS). Die Tasten der Knöpfe unten und im Auswahlpanel (Reiter, Baukarten,
 * Ausbilden, Abriss) wertet die Oberfläche aus (src/ui/hotkeys.ts). Keine Taste wirkt, solange ein Eingabefeld den Fokus
 * hat oder eine Tafel (z. B. die Hilfe) offen ist.
 * Bauen: Vorschau, R dreht, Linksklick baut, Shift hält das Werkzeug, Esc/Rechtsklick bricht ab. Ist die gewählte
 * Ausrichtung an der Mausposition ungültig, eine andere aber gültig (z. B. Mauertreppe: Rückseite zur Mauer), nimmt die
 * Vorschau die nächste gültige in Drehrichtung; R dreht von dort weiter. Der Zeiger-Hinweis nennt R, wenn Drehen hilft.
 * Mauer: von Start- zu End-Tile ziehen, Loslassen baut. Abriss: Klick auf ein eigenes Gebäude.
 *
 * Leistung: Treffer und Vorschau unter der Maus werden nur neu berechnet, wenn sich Maus, Kamera, Werkzeug, Auswahl
 * oder der Tick ändern; der Mauszeiger (CSS cursor) wird nur bei Änderung gesetzt.
 */
import { BUILDINGS, UNITS, levelDef, type BuildingKey } from "../data";
import { APP_KEYS, type AppAction } from "../data/hotkeys";
import { keyBlocked } from "../ui/hotkeys";
import { footprint } from "../sim/geom";
import type { CommandResult, Game, PlacementCheck } from "../sim/types";
import type { FrameInput, GameRenderer, Marker, Preview } from "../render";
import type { Tool, UiBridge } from "./contract";
import type { PointerHint } from "./notify";
import type { AppStore } from "./store";

const DRAG_PX = 5;
const EDGE_PX = 6;
const PAN_SPEED = 900; // Bildschirmpixel je Sekunde
const DBL_MS = 320;
/** Umkreis (Felder) um die Maus, in dem gültige Bauplätze enger Baubänder markiert werden. */
const ANCHOR_R = 6;

export interface InputContext {
  canvas: HTMLCanvasElement;
  game: Game;
  store: AppStore;
  renderer: GameRenderer;
  bridge: UiBridge;
  hint: PointerHint;
  toggleDebug: () => void;
}

type HoverOut = Pick<FrameInput, "danger" | "highlight" | "preview">;

export class Input {
  private mx = -1;
  private my = -1;
  /** Zeiger in Fensterkoordinaten (für den Randbildlauf) und ob er im Fenster ist. */
  private cx = -1;
  private cy = -1;
  private inWindow = false;
  private over = false;
  private keys = new Set<string>();
  private left: { sx: number; sy: number; drag: boolean; shift: boolean } | null = null;
  private pan: { sx: number; sy: number; moved: boolean; button: number } | null = null;
  private wallStart: { x: number; y: number } | null = null;
  private markers: Marker[] = [];
  private wheelAcc = 0;
  private lastClick = { t: 0, id: 0 };
  private check: { id: string; tick: number; res: PlacementCheck } | null = null;
  /** Platzierungsprüfungen je Gebäude, Lage und Ausrichtung (bis zu vier je Mausstellung), verfallen nach 5 Ticks. */
  private checks = new Map<string, { tick: number; res: PlacementCheck }>();
  /** Tatsächlich gezeigte Ausrichtung der Bauvorschau (kann von tool.o abweichen, s. orient). */
  private shownO: { key: BuildingKey; o: number } | null = null;
  /** Gültige Mausfelder um die Maus für enge Baubänder (Schlüssel: Gebäude, Ausrichtung, Mausfeld, Tick-Abschnitt). */
  private anchorCache: { id: string; list: { x: number; y: number }[] } | null = null;
  private time = 0;
  private cursor = "";
  /** Zwischenspeicher der Mausauswertung (Treffer, Vorschau) und ihr Schlüssel. */
  private hover: HoverOut = { danger: null, highlight: null, preview: null };
  private hoverKey = "";
  private moved = true;

  constructor(private ctx: InputContext) {
    const c = ctx.canvas;
    c.addEventListener("pointerdown", (e) => this.down(e));
    window.addEventListener("pointermove", (e) => this.move(e), { passive: true });
    window.addEventListener("pointerup", (e) => this.up(e));
    c.addEventListener("pointerenter", () => { this.over = true; this.moved = true; });
    c.addEventListener("pointerleave", () => { this.over = false; this.moved = true; });
    document.addEventListener("mouseleave", () => { this.inWindow = false; this.over = false; });
    document.addEventListener("mouseenter", () => { this.inWindow = true; });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    // Leertaste vor allen anderen (Knöpfe der Oberfläche sollen sie nicht erneut auslösen)
    window.addEventListener("keydown", (e) => this.space(e), true);
    window.addEventListener("keyup", (e) => { if (e.code === "Space" && !keyBlocked(e)) e.preventDefault(); }, true);
    window.addEventListener("keydown", (e) => this.keydown(e));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.left = null; this.pan = null; this.inWindow = false; });
  }

  private get r(): GameRenderer { return this.ctx.renderer; }
  private get tool(): Tool { return this.ctx.store.tool; }

  private pos(e: { clientX: number; clientY: number }): [number, number] {
    const b = this.ctx.canvas.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  }

  private notify(text: string, kind: "info" | "warnung" = "info"): void {
    this.ctx.bridge.notify(text, kind);
  }

  /** Ergebnis eines Befehls melden: Ablehnung als Warnung, Teil-Erfolg (ok mit Grund) als Info. */
  private report(res: CommandResult, fallback: string): void {
    if (!res.ok) this.notify(res.reason ?? fallback, "warnung");
    else if (res.reason) this.notify(res.reason, "info");
  }

  private setCursor(c: string): void {
    if (c === this.cursor) return;
    this.cursor = c;
    this.ctx.canvas.style.cursor = c;
  }

  // ---------------------------------------------------------------- Maus

  private down(e: PointerEvent): void {
    const [x, y] = this.pos(e);
    this.mx = x; this.my = y; this.over = true; this.moved = true;
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
    this.cx = e.clientX; this.cy = e.clientY; this.inWindow = true;
    const [x, y] = this.pos(e);
    if (this.pan) {
      const dx = x - this.mx, dy = y - this.my;
      if (Math.abs(x - this.pan.sx) + Math.abs(y - this.pan.sy) > DRAG_PX) this.pan.moved = true;
      if (this.pan.moved) this.r.camera.pan(-dx, -dy);
    }
    if (this.left && !this.left.drag && Math.abs(x - this.left.sx) + Math.abs(y - this.left.sy) > DRAG_PX && this.tool.t === "auswahl") this.left.drag = true;
    if (x !== this.mx || y !== this.my) this.moved = true;
    this.mx = x; this.my = y;
  }

  private up(e: PointerEvent): void {
    const [x, y] = this.pos(e);
    this.mx = x; this.my = y; this.moved = true;
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
      const key = this.dragKey();
      const res = this.ctx.bridge.dispatch({ t: "mauer", x0: s.x, y0: s.y, x1: end.x, y1: end.y, ...(key !== "mauer" ? { key } : {}) });
      this.check = null;
      this.report(res, key === "mauer" ? "Hier kann keine Mauer stehen." : "Hier kann nicht gebaut werden.");
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
      const id = hit.id, team = hit.team;
      const dbl = now - this.lastClick.t < DBL_MS && this.lastClick.id === id;
      this.lastClick = { t: now, id };
      if (dbl && team === 0) {
        // alle sichtbaren eigenen Einheiten gleicher Art
        const key = game.state.units.find((u) => u.id === id)?.key;
        const ids = this.r.unitsInRect(0, 0, this.r.camera.sw, this.r.camera.sh, 0)
          .filter((uid) => game.state.units.find((u) => u.id === uid)?.key === key);
        store.select({ units: shift ? [...store.selection.units, ...ids] : ids, building: null });
        return;
      }
      if (shift && team === 0) {
        const cur = store.selection.units;
        const units = cur.includes(id) ? cur.filter((u) => u !== id) : [...cur, id];
        store.select({ units, building: null });
      } else store.select({ units: [id], building: null });
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
    const { store, bridge } = this.ctx;
    if (this.tool.t !== "auswahl") { store.setTool({ t: "auswahl" }); this.wallStart = null; return; }
    const units = this.ownSelected();
    if (!units.length) return;
    const enemy = this.r.pick(x, y, (h) => h.team !== 0);
    if (enemy) {
      const res = bridge.dispatch({ t: "angreifen", units, target: enemy.id });
      this.report(res, "Angriff nicht möglich.");
      if (res.ok) this.marker(x, y, 0xe0503c);
      return;
    }
    const tile = this.r.tileAt(x, y, (tx, ty) => this.ctx.game.walkLayerAt(tx, ty));
    const res = bridge.dispatch({ t: "bewegen", units, x: tile.x, y: tile.y });
    this.report(res, "Dort kommen sie nicht hin.");
    if (res.ok) this.markers.push({ x: tile.x + 0.5, y: tile.y + 0.5, z: tile.z, t0: this.time, color: tile.layer ? 0x8fd0ff : 0x9fe07a });
  }

  private marker(x: number, y: number, color: number): void {
    const tile = this.r.tileAt(x, y, (tx, ty) => this.ctx.game.walkLayerAt(tx, ty));
    this.markers.push({ x: tile.x + 0.5, y: tile.y + 0.5, z: tile.z, t0: this.time, color });
  }

  // ---------------------------------------------------------------- Bauen und Abriss

  /** Linke obere Ecke so, dass der Grundriss um den Maus-Tile liegt. */
  private buildOrigin(key: BuildingKey, o: number, x: number, y: number): [number, number] {
    const tile = this.r.tileAt(x, y);
    return originAt(key, o, tile.x, tile.y);
  }

  /**
   * Enges Bauband (Gebäude muss an ein Gelände grenzen, z. B. Steinbruch am Fels): Mausfelder im Umkreis, an denen die
   * Vorschau in irgendeiner Ausrichtung gültig wäre (wie orient, über die Platzierungsprüfung der Simulation).
   */
  private anchors(key: BuildingKey, o0: number, mx: number, my: number): { x: number; y: number }[] | undefined {
    if (!BUILDINGS[key].placement?.adjacentTerrain) return undefined;
    const tile = this.r.tileAt(mx, my);
    const id = `${key}:${o0}:${tile.x}:${tile.y}:${Math.floor(this.ctx.game.state.tick / 20)}`;
    if (this.anchorCache?.id === id) return this.anchorCache.list;
    const { w, h } = this.ctx.game.state;
    const list: { x: number; y: number }[] = [];
    for (let dy = -ANCHOR_R; dy <= ANCHOR_R; dy++) for (let dx = -ANCHOR_R; dx <= ANCHOR_R; dx++) {
      if (dx * dx + dy * dy > ANCHOR_R * ANCHOR_R) continue;
      const x = tile.x + dx, y = tile.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      for (let k = 0; k < 4; k++) {
        const o = (o0 + k) % 4;
        const [bx, by] = originAt(key, o, x, y);
        if (this.ctx.game.canPlace(key, bx, by, o).ok) { list.push({ x, y }); break; }
      }
    }
    this.anchorCache = { id, list };
    return list;
  }

  private placement(key: BuildingKey, bx: number, by: number, o: number): PlacementCheck {
    const id = `${key}:${bx}:${by}:${o}`;
    const tick = this.ctx.game.state.tick;
    const c = this.checks.get(id);
    if (c && tick - c.tick <= 5 && tick >= c.tick) return c.res;
    if (this.checks.size > 64) this.checks.clear();
    const res = this.ctx.game.canPlace(key, bx, by, o);
    this.checks.set(id, { tick, res });
    return res;
  }

  /**
   * Ausrichtung für die Bauvorschau an Bildschirmpunkt (x, y): die gewählte, wenn sie gültig ist, sonst die nächste
   * gültige in Drehrichtung. turnHelps: Eine andere Ausrichtung ergäbe einen anderen Befund (Hinweis „R dreht“).
   */
  private orient(key: BuildingKey, o0: number, x: number, y: number): { o: number; bx: number; by: number; check: PlacementCheck; turnHelps: boolean } {
    const at = (o: number) => {
      const [bx, by] = this.buildOrigin(key, o, x, y);
      return { o, bx, by, check: this.placement(key, bx, by, o) };
    };
    const first = at(o0);
    if (first.check.ok) return { ...first, turnHelps: false };
    // Treppe: Ausrichtung ist die Bauregel selbst (Rückseite zur Mauer), R immer nennen
    let turnHelps = !!BUILDINGS[key].stairs;
    for (let k = 1; k < 4; k++) {
      const c = at((o0 + k) % 4);
      if (c.check.ok) return { ...c, turnHelps: true };
      if (c.check.reason !== first.check.reason) turnHelps = true;
    }
    return { ...first, turnHelps };
  }

  private build(t: Extract<Tool, { t: "bauen" }>, x: number, y: number, shift: boolean): void {
    const { bx, by, o } = this.orient(t.key, t.o, x, y);
    // Auch bei roter Vorschau an die Simulation schicken: Sie nennt den Grund und die passende Ansage.
    const res = this.ctx.bridge.dispatch({ t: "bauen", key: t.key, x: bx, y: by, o });
    this.check = null;
    this.checks.clear();
    // gewählte Ausrichtung merken (bei Shift baut der nächste Klick in derselben weiter)
    if (res.ok && o !== t.o && shift) this.ctx.store.setTool({ ...t, o });
    this.report(res, "Hier kann nicht gebaut werden.");
    if (res.ok && !shift) this.ctx.store.setTool({ t: "auswahl" });
  }

  private demolish(x: number, y: number, shift: boolean): void {
    const hit = this.r.pick(x, y, (h) => h.kind === "building" && h.team === 0);
    if (!hit) return;
    const res = this.ctx.bridge.dispatch({ t: "abreissen", id: hit.id });
    this.report(res, "Das lässt sich nicht abreißen.");
    if (res.ok && !shift) this.ctx.store.setTool({ t: "auswahl" });
  }

  // ---------------------------------------------------------------- Tastatur

  /** Leertaste: Pause/Weiter, global und vor den Knöpfen der Oberfläche. */
  private space(e: KeyboardEvent): void {
    if (e.code !== "Space" || keyBlocked(e)) return;
    e.preventDefault();
    if (e.repeat) return;
    const { bridge, store } = this.ctx;
    bridge.setSpeed(store.speed ? 0 : store.resumeSpeed || 1);
  }

  private keydown(e: KeyboardEvent): void {
    if (keyBlocked(e) || e.code === "Space") return;
    const { store, bridge } = this.ctx;
    this.keys.add(e.code);
    const is = (a: AppAction) => (APP_KEYS[a] as readonly string[]).includes(e.code);
    if (is("debug")) { e.preventDefault(); this.ctx.toggleDebug(); return; }
    if (e.ctrlKey || e.metaKey) {
      const n = digit(e.code);
      if (n !== null && e.ctrlKey) {
        e.preventDefault();
        store.groups.set(n, this.ownSelected());
        this.notify(`Gruppe ${n} gespeichert`);
      }
      return;
    }
    const n = digit(e.code);
    if (n !== null) {
      const g = store.groups.get(n);
      if (g?.length) store.select({ units: g, building: null });
      return;
    }
    const action = (Object.keys(APP_KEYS) as AppAction[]).find(is);
    switch (action) {
      case "drehenLinks": bridge.rotate(-1); break;
      case "drehenRechts": bridge.rotate(1); break;
      case "bauDrehen": {
        const t = store.tool;
        // von der gezeigten Ausrichtung aus weiterdrehen (sie kann automatisch gewählt sein)
        const base = t.t === "bauen" && this.shownO?.key === t.key ? this.shownO.o : t.t === "bauen" ? t.o : 0;
        if (t.t === "bauen") store.setTool({ ...t, o: (base + (e.shiftKey ? 3 : 1)) % 4 });
        break;
      }
      case "stationieren": {
        const units = this.ownSelected().filter((id) => {
          const u = this.ctx.game.state.units.find((q) => q.id === id);
          return u && UNITS[u.key].canStation;
        });
        if (!units.length) { this.notify("Keine Soldaten ausgewählt, die auf die Mauer können.", "warnung"); break; }
        this.report(bridge.dispatch({ t: "stationieren", units }), "Kein freier Posten.");
        break;
      }
      case "halten": {
        const units = this.ownSelected();
        if (units.length) this.report(bridge.dispatch({ t: "halten", units }), "Halten nicht möglich.");
        break;
      }
      case "abbrechen":
        if (store.tool.t !== "auswahl") { store.setTool({ t: "auswahl" }); this.wallStart = null; }
        else store.select({ units: [], building: null });
        break;
      case "zoomRein": bridge.zoom(1); break;
      case "zoomRaus": bridge.zoom(-1); break;
      case "pause": bridge.setSpeed(store.speed ? 0 : store.resumeSpeed || 1); break;
      default: return;
    }
  }

  // ---------------------------------------------------------------- jedes Bild

  /** Kamerafahrt, Vorschau und Hervorhebungen für dieses Bild. */
  frame(dt: number, time: number): Omit<FrameInput, "selectedUnits" | "selectedBuilding"> {
    this.time = time;
    const cam = this.r.camera;
    // Tastatur und Fensterrand (auch über Kopf- und Fußleiste)
    let dx = 0, dy = 0;
    const held = (a: AppAction) => APP_KEYS[a].some((c) => this.keys.has(c));
    if (held("kameraLinks")) dx -= 1;
    if (held("kameraRechts")) dx += 1;
    if (held("kameraHoch")) dy -= 1;
    if (held("kameraRunter")) dy += 1;
    if (this.inWindow && this.cx >= 0 && !this.pan && !this.left?.drag && document.hasFocus()) {
      if (this.cx < EDGE_PX) dx -= 1;
      if (this.cx > window.innerWidth - 1 - EDGE_PX) dx += 1;
      if (this.cy < EDGE_PX) dy -= 1;
      if (this.cy > window.innerHeight - 1 - EDGE_PX) dy += 1;
    }
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      const sp = PAN_SPEED * Math.min(0.05, dt) * Math.max(1, cam.zoom / 2);
      cam.pan((dx / len) * sp, (dy / len) * sp);
    }
    if (this.markers.length && time - this.markers[0].t0 >= 0.8) this.markers = this.markers.filter((m) => time - m.t0 < 0.8);

    // Treffer und Vorschau nur bei Änderungen neu auswerten
    const t = this.tool;
    const store = this.ctx.store;
    const key = `${this.mx},${this.my},${this.over ? 1 : 0},${this.pan ? 1 : 0},${this.ctx.game.state.tick},${cam.x},${cam.y},${cam.r},${cam.zoom},` +
      `${t.t === "bauen" ? t.key + t.o : t.t},${this.wallStart ? this.wallStart.x + ":" + this.wallStart.y : ""},${store.selection.units.length}`;
    if (this.moved || key !== this.hoverKey) {
      this.hoverKey = key;
      this.moved = false;
      this.hover = this.evaluate();
    }
    const l = this.left;
    return {
      ...this.hover, markers: this.markers,
      dragRect: l?.drag ? { x0: l.sx, y0: l.sy, x1: this.mx, y1: this.my } : null,
    };
  }

  /** Gezogene Linie: Mauer, Palisade oder Graben (Werkzeug „mauer“ mit key, oder ein Bauwerkzeug für ein Ziehstück). */
  private dragKey(): BuildingKey {
    const t = this.tool;
    return t.t === "mauer" ? t.key ?? "mauer" : t.t === "bauen" && BUILDINGS[t.key].drag ? t.key : "mauer";
  }

  /** Mausauswertung: Bauvorschau, Abriss-Ziel, Hervorhebung, Zielkachel auf dem Wehrgang; Zeiger und Zeiger-Hinweis. */
  private evaluate(): HoverOut {
    let preview: Preview | null = null;
    let danger: number | null = null;
    let highlight: number | null = null;
    let reason = "";
    const t = this.tool;
    const inside = this.over && this.mx >= 0;
    if ((t.t === "mauer" || (t.t === "bauen" && BUILDINGS[t.key].drag)) && inside) {
      const end = this.r.tileAt(this.mx, this.my);
      const s = this.wallStart ?? end;
      const key = this.dragKey();
      const id = `wall:${key}:${s.x}:${s.y}:${end.x}:${end.y}`;
      const tick = this.ctx.game.state.tick;
      if (!this.check || this.check.id !== id || tick - this.check.tick > 5) this.check = { id, tick, res: this.ctx.game.wallPath(s.x, s.y, end.x, end.y, key) };
      const res = this.check.res;
      preview = { kind: "mauer", key, check: res.tiles.length ? res : { ...res, tiles: [{ x: end.x, y: end.y, ok: res.ok }] } };
      if (!res.ok) reason = res.reason ?? (key === "mauer" ? "Hier kann keine Mauer stehen." : "Hier kann nicht gebaut werden.");
      this.setCursor("crosshair");
    } else if (t.t === "bauen" && inside) {
      const { bx, by, o, check, turnHelps } = this.orient(t.key, t.o, this.mx, this.my);
      this.shownO = { key: t.key, o };
      preview = { kind: "bauen", key: t.key, x: bx, y: by, o, check, anchors: this.anchors(t.key, t.o, this.mx, this.my) };
      if (!check.ok) reason = (check.reason ?? "Hier kann nicht gebaut werden.") + (turnHelps ? " – R dreht" : "");
      this.setCursor("crosshair");
    } else if (t.t === "abriss" && inside) {
      danger = this.r.pick(this.mx, this.my, (h) => h.kind === "building" && h.team === 0)?.id ?? null;
      this.setCursor(danger ? "pointer" : "not-allowed");
    } else if (inside && !this.pan) {
      const hit = this.r.pick(this.mx, this.my);
      const sel = this.ownSelected().length > 0;
      let wall = false;
      if (sel && (!hit || (hit.kind === "building" && hit.team === 0 && this.walkable(hit.id)))) {
        // Ziel auf dem Wehrgang (oder Boden ohne Treffer) als Kachel zeigen statt das Gebäude hervorzuheben
        const tile = this.r.tileAt(this.mx, this.my, (tx, ty) => this.ctx.game.walkLayerAt(tx, ty));
        if (tile.layer > 0) { preview = { kind: "kachel", x: tile.x, y: tile.y, z: tile.z, color: 0x8fd0ff }; wall = true; }
      }
      if (hit?.kind === "building" && !wall) highlight = hit.id;
      this.setCursor(wall ? "crosshair" : hit ? (sel && hit.team !== 0 ? "crosshair" : "pointer") : "default");
    } else if (this.pan?.moved) this.setCursor("grabbing");
    if (reason && inside) {
      const b = this.ctx.canvas.getBoundingClientRect();
      this.ctx.hint.set(reason, this.mx + b.left, this.my + b.top);
    } else this.ctx.hint.hide();
    return { danger, highlight, preview };
  }

  /** Gebäude mit Wehrgang oder Turmplattform? */
  private walkable(id: number): boolean {
    const b = this.ctx.game.state.buildings.find((q) => q.id === id);
    return !!b && b.built >= 1 && !!levelDef(b.key, b.level ?? 1).walkway; // Bergfried: erst ab Stufe 2
  }
}

/** Linke obere Ecke des Grundrisses, wenn die Maus auf Feld (tx, ty) steht. */
function originAt(key: BuildingKey, o: number, tx: number, ty: number): [number, number] {
  const [w, h] = footprint(key, o);
  return [tx - Math.floor((w - 1) / 2), ty - Math.floor((h - 1) / 2)];
}

function digit(code: string): number | null {
  const m = /^Digit([0-9])$/.exec(code);
  return m ? Number(m[1]) : null;
}
