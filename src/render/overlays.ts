/**
 * Hilfsebenen über und unter den Objekten: Bodenmarkierungen (Grundriss grün/rot, Mauerweg, Auswahl, Ziel),
 * Pfeile in der Luft, Lebensbalken. Die Bauvorschau (halbtransparente Sprites) wird hier nur berechnet (ghosts) und
 * von der Objektebene mit einsortiert, damit Figuren davor nicht eingefärbt werden.
 */
import { Graphics } from "pixi.js";
import { BUILDINGS, TICKS_PER_SECOND, TUNING, type BuildingKey } from "../data";
import { NEIGHBOURS, center, footprint, footprintTiles, toView, wallPiece, type Rot } from "../sim/geom";
import type { PlacementCheck, Projectile, SimState } from "../sim/types";
import type { BuildingSheet } from "./assets";
import { viewToScreen } from "./iso";
import { gateOrientation, type Ghost, type UnitOnScreen } from "./scene";

export type Preview =
  | {
    kind: "bauen"; key: BuildingKey; x: number; y: number; o: number; check: PlacementCheck;
    /** Mausfelder in der Nähe, an denen die Platzierung gültig wäre (enge Baubänder, z. B. Steinbruch am Fels). */
    anchors?: readonly { x: number; y: number }[];
  }
  | { kind: "mauer"; check: PlacementCheck }
  | { kind: "kachel"; x: number; y: number; z: number; color: number };

export interface Marker { x: number; y: number; z: number; t0: number; color: number }

const OK_FILL = 0x6fdc5a, OK_LINE = 0x9cf08a;
const BAD_FILL = 0xe0503c, BAD_LINE = 0xff8a70;
/** Regelverstoß, der nicht an einer Kachel hängt (z. B. „Zu wenige Bäume“): alle Rauten orange. */
const RULE_FILL = 0xe89a3a, RULE_LINE = 0xffc070;
const FORT = new Set<string>(["mauer", "tor", "turm"]);

export class Overlays {
  /** Unter den Objekten (Boden). */
  readonly ground = new Graphics();
  /** Ganz oben: Pfeile, Lebensbalken, Zielmarken auf dem Wehrgang. */
  readonly top = new Graphics();
  private r: Rot = 0;
  private W = 0;
  private H = 0;
  private ghostList: Ghost[] = [];
  private ghostPool: Ghost[] = [];
  /** Letzter gesehener Stand je Pfeil (für die Schrittweite zwischen zwei Ticks). */
  private seen = new Map<number, { t: number; tick: number; dt: number }>();

  constructor(private bs: BuildingSheet | null) {}

  private scr(x: number, y: number, z = 0): [number, number] {
    const [u, v] = toView(x, y, this.r, this.W, this.H);
    return viewToScreen(u, v, z);
  }

  private diamond(g: Graphics, x: number, y: number, z: number, color: number, alpha: number, line = 0): void {
    const pts = [this.scr(x, y, z), this.scr(x + 1, y, z), this.scr(x + 1, y + 1, z), this.scr(x, y + 1, z)].flat();
    g.poly(pts).fill({ color, alpha });
    if (line) g.poly(pts).stroke({ width: 1, color: line, alpha: 0.9, alignment: 0.5 });
  }

  /** Dezente Marke für ein gültiges Mausfeld (kleinere Raute mit zartem Rand). */
  private anchorMark(g: Graphics, x: number, y: number): void {
    const m = 0.22;
    const pts = [this.scr(x + m, y + m), this.scr(x + 1 - m, y + m), this.scr(x + 1 - m, y + 1 - m), this.scr(x + m, y + 1 - m)].flat();
    g.poly(pts).fill({ color: OK_FILL, alpha: 0.2 }).stroke({ width: 1, color: OK_LINE, alpha: 0.45, alignment: 0.5 });
  }

  /** Umriss eines Rechtecks von Tiles (Auswahl eines Gebäudes). */
  private outline(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number): void {
    const pts = [this.scr(x0, y0), this.scr(x1, y0), this.scr(x1, y1), this.scr(x0, y1)].flat();
    g.poly(pts).stroke({ width: 2, color, alpha: 0.95, alignment: 0.5 });
  }

  private fort(state: SimState, x: number, y: number): boolean {
    const id = state.tiles[y * state.w + x]?.building;
    if (!id) return false;
    const b = state.buildings.find((q) => q.id === id);
    return !!b && FORT.has(b.key);
  }

  /** Bauvorschau als Sprites (für die Objektebene). Gilt bis zum nächsten Aufruf. */
  ghosts(state: SimState, preview: Preview | null): readonly Ghost[] {
    this.ghostList.length = 0;
    const bs = this.bs;
    if (!bs || !preview) return this.ghostList;
    if (preview.kind === "bauen") {
      const { key, x, y, check } = preview;
      let o = preview.o;
      let sk = BUILDINGS[key].sprite;
      if (!bs.has(sk)) sk = key === "lager" ? "lager" : key === "tor" ? "mauer" : sk;
      if (key === "tor") {
        // dieselbe Regel wie beim Setzen in eine Mauer und in der Darstellung des fertigen Tors
        let mask = 0;
        NEIGHBOURS.forEach(([dx, dy], bit) => { if (this.fort(state, x + dx, y + dy)) mask |= 1 << bit; });
        o = gateOrientation(mask, o);
      }
      const [w, h] = footprint(key, o);
      const [cx, cy] = center(key, x, y, o);
      this.addGhost(sk, o, 0, x, y, x + w, y + h, cx, cy, 0.62, check.ok ? 0xffffff : 0xff7a6a);
    } else if (preview.kind === "mauer") {
      const set = new Set(preview.check.tiles.map((q) => q.x + "," + q.y));
      const fort = (x: number, y: number) => set.has(x + "," + y) || this.fort(state, x, y);
      for (const tl of preview.check.tiles) {
        let mask = 0;
        NEIGHBOURS.forEach(([dx, dy], bit) => { if (fort(tl.x + dx, tl.y + dy)) mask |= 1 << bit; });
        const { piece, o } = wallPiece(mask);
        const keys: [string, number][] = bs.has(piece) ? [[piece, o]]
          : piece === "mauer_ecke" || piece === "mauer_t" || piece === "mauer_kreuz" ? [["mauer", o], ["mauer", o + 1]] : [["mauer", o]];
        for (const [k, ko] of keys) this.addGhost(k, ko, 0, tl.x, tl.y, tl.x + 1, tl.y + 1, tl.x + 0.5, tl.y + 0.5, 0.55, tl.ok ? 0xffffff : 0xff7a6a);
      }
    }
    return this.ghostList;
  }

  private addGhost(key: string, o: number, frame: number, x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, alpha: number, tint: number): void {
    let g = this.ghostPool[this.ghostList.length];
    if (!g) { g = { key, o, frame, x0, y0, x1, y1, cx, cy, alpha, tint }; this.ghostPool.push(g); }
    g.key = key; g.o = o; g.frame = frame; g.x0 = x0; g.y0 = y0; g.x1 = x1; g.y1 = y1; g.cx = cx; g.cy = cy; g.alpha = alpha; g.tint = tint;
    this.ghostList.push(g);
  }

  update(state: SimState, r: Rot, time: number, alpha: number, o: {
    preview: Preview | null;
    selectedBuilding: number | null;
    markers: Marker[];
    units: UnitOnScreen[];
  }): void {
    this.r = r; this.W = state.w; this.H = state.h;
    const g = this.ground, t = this.top;
    g.clear(); t.clear();

    // ausgewähltes Gebäude
    if (o.selectedBuilding) {
      const b = state.buildings.find((q) => q.id === o.selectedBuilding);
      if (b) {
        const tiles = footprintTiles(b.key, b.x, b.y, b.o);
        const xs = tiles.map((p) => p[0]), ys = tiles.map((p) => p[1]);
        this.outline(g, Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1, 0xf2e6a0);
      }
    }

    // Vorschau (Rauten; die Sprites zeichnet die Objektebene)
    const p = o.preview;
    if (p?.kind === "bauen" || p?.kind === "mauer") {
      if (p.kind === "bauen" && p.anchors) for (const a of p.anchors) this.anchorMark(g, a.x, a.y);
      const rule = !p.check.ok && p.check.tiles.every((q) => q.ok);
      for (const tl of p.check.tiles) {
        const [fill, line] = rule ? [RULE_FILL, RULE_LINE] : tl.ok ? [OK_FILL, OK_LINE] : [BAD_FILL, BAD_LINE];
        // Rote Felder liegen auf einem Hindernis (z. B. dem Boden eines Lagers): über den Objekten zeichnen, sonst
        // verschwinden sie darunter. Grüne und orange bleiben am Boden unter der Vorschau.
        this.diamond(!rule && !tl.ok ? t : g, tl.x, tl.y, 0, fill, 0.38, line);
      }
    } else if (p?.kind === "kachel") {
      // Ziel auf dem Wehrgang: über den Objekten, sonst verdeckt es die Mauer
      this.diamond(p.z > 0 ? t : g, p.x, p.y, p.z, p.color, 0.3, p.color);
    }

    // Zielmarken (Bewegungsbefehl)
    for (const m of o.markers) {
      const age = time - m.t0;
      if (age > 0.7) continue;
      const k = 1 - age / 0.7;
      const [X, Y] = this.scr(m.x, m.y, m.z);
      const rx = 6 + 10 * k;
      (m.z > 0 ? t : g).ellipse(X, Y, rx, rx / 2).stroke({ width: 1.5, color: m.color, alpha: k });
    }

    this.projectiles(state, alpha);
    this.healthBars(o.units);
  }

  /** Flugfortschritt zwischen zwei Ticks fortschreiben (Schrittweite aus der Beobachtung, sonst wie in der Simulation). */
  private progress(p: Projectile, tick: number, alpha: number): number {
    let s = this.seen.get(p.id);
    if (!s) {
      const d = Math.hypot(p.x1 - p.x0, p.y1 - p.y0);
      s = { t: p.t, tick, dt: 1 / Math.max(3, Math.round((d / TUNING.projectileSpeed) * TICKS_PER_SECOND)) };
      this.seen.set(p.id, s);
    } else if (tick > s.tick) {
      if (p.t > s.t) s.dt = (p.t - s.t) / (tick - s.tick);
      s.t = p.t; s.tick = tick;
    }
    return Math.min(1, p.t + alpha * s.dt);
  }

  /** Pfeile als kurze Linie entlang der Flugbahn (Bogen nach t), kurz vor dem Ziel ein Funke. */
  private projectiles(state: SimState, alpha: number): void {
    const g = this.top, list = state.projectiles;
    if (this.seen.size > list.length * 2 + 16) {
      const live = new Set(list.map((q) => q.id));
      for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
    }
    for (const p of list) {
      const dist = Math.hypot(p.x1 - p.x0, p.y1 - p.y0);
      const arc = Math.min(4, dist * 0.3);
      const at = (t: number): [number, number] => {
        const tt = Math.max(0, Math.min(1, t));
        const x = p.x0 + (p.x1 - p.x0) * tt, y = p.y0 + (p.y1 - p.y0) * tt;
        const z = p.z0 + (p.z1 - p.z0) * tt + arc * 4 * tt * (1 - tt);
        return this.scr(x, y, z);
      };
      const pt = this.progress(p, state.tick, alpha);
      const dt = this.seen.get(p.id)!.dt;
      const [x1, y1] = at(pt), [x0, y0] = at(pt - 0.07);
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const k = Math.min(1, 10 / len); // feste Länge von etwa 10 Pixeln
      const xs = x1 - (x1 - x0) * k, ys = y1 - (y1 - y0) * k;
      g.moveTo(xs, ys).lineTo(x1, y1).stroke({ width: 1.5, color: 0x3a2a1a, alpha: 0.95 });
      g.rect(Math.round(x1) - 1, Math.round(y1) - 1, 2, 2).fill({ color: 0xd8d8d0 });
      // Funke im letzten Tick vor dem Einschlag (das Geschoss verschwindet mit t = 1 im selben Tick)
      const s0 = 1 - Math.max(0.08, dt);
      if (pt > s0) {
        const k2 = Math.min(1, (pt - s0) / (1 - s0));
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7 + p.id;
          g.rect(Math.round(x1 + Math.cos(a) * 4 * k2), Math.round(y1 + Math.sin(a) * 3 * k2), 1, 1).fill({ color: 0xffe08a, alpha: 1 - k2 * 0.6 });
        }
      }
    }
  }

  private healthBars(units: UnitOnScreen[]): void {
    const g = this.top;
    for (const u of units) {
      if (!u.selected && u.hp >= u.maxHp) continue;
      const f = Math.max(0, Math.min(1, u.hp / Math.max(1, u.maxHp)));
      const x = u.x - 8, y = u.top - 4;
      g.rect(x - 1, y - 1, 18, 4).fill({ color: 0x1a140e, alpha: 0.85 });
      const col = u.team === 1 ? 0xd2452f : f > 0.6 ? 0x6fcf4a : f > 0.3 ? 0xe0b43a : 0xd2452f;
      g.rect(x, y, Math.max(1, Math.round(16 * f)), 2).fill({ color: col });
    }
  }
}
