/**
 * Hilfsebenen über und unter den Objekten: Bodenmarkierungen (Grundriss grün/rot, Mauerweg, Auswahl, Ziel),
 * Bauvorschau (halbtransparente Sprites), Pfeile in der Luft, Lebensbalken.
 */
import { Container, Graphics } from "pixi.js";
import { BUILDINGS, type BuildingKey } from "../data";
import { NEIGHBOURS, center, footprintTiles, toView, viewOf, wallPiece, type Rot } from "../sim/geom";
import type { PlacementCheck, Projectile, SimState } from "../sim/types";
import type { BuildingSheet } from "./assets";
import { viewToScreen } from "./iso";
import { SpritePool } from "./pool";
import type { UnitOnScreen } from "./scene";

export type Preview =
  | { kind: "bauen"; key: BuildingKey; x: number; y: number; o: number; check: PlacementCheck }
  | { kind: "mauer"; check: PlacementCheck }
  | { kind: "kachel"; x: number; y: number; z: number; color: number };

export interface Marker { x: number; y: number; z: number; t0: number; color: number }

export class Overlays {
  /** Unter den Objekten (Boden). */
  readonly ground = new Graphics();
  /** Bauvorschau über den Objekten. */
  readonly ghost = new Container();
  /** Ganz oben: Pfeile, Lebensbalken. */
  readonly top = new Graphics();
  private ghostPool = new SpritePool(this.ghost);
  private r: Rot = 0;
  private W = 0;
  private H = 0;

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

  /** Umriss eines Rechtecks von Tiles (Auswahl eines Gebäudes). */
  private outline(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number): void {
    const pts = [this.scr(x0, y0), this.scr(x1, y0), this.scr(x1, y1), this.scr(x0, y1)].flat();
    g.poly(pts).stroke({ width: 2, color, alpha: 0.95, alignment: 0.5 });
  }

  update(state: SimState, r: Rot, time: number, o: {
    preview: Preview | null;
    selectedBuilding: number | null;
    markers: Marker[];
    units: UnitOnScreen[];
  }): void {
    this.r = r; this.W = state.w; this.H = state.h;
    const g = this.ground, t = this.top;
    g.clear(); t.clear();
    this.ghostPool.reset();

    // ausgewähltes Gebäude
    if (o.selectedBuilding) {
      const b = state.buildings.find((q) => q.id === o.selectedBuilding);
      if (b) {
        const tiles = footprintTiles(b.key, b.x, b.y, b.o);
        const xs = tiles.map((p) => p[0]), ys = tiles.map((p) => p[1]);
        this.outline(g, Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1, 0xf2e6a0);
      }
    }

    // Vorschau
    const p = o.preview;
    if (p?.kind === "bauen") {
      for (const tl of p.check.tiles) this.diamond(g, tl.x, tl.y, 0, tl.ok ? 0x6fdc5a : 0xe0503c, 0.38, tl.ok ? 0x9cf08a : 0xff8a70);
      this.ghostBuilding(p.key, p.x, p.y, p.o, p.check.ok);
    } else if (p?.kind === "mauer") {
      const set = new Set(p.check.tiles.map((q) => q.x + "," + q.y));
      const fort = (x: number, y: number) => {
        if (set.has(x + "," + y)) return true;
        const id = state.tiles[y * state.w + x]?.building;
        if (!id) return false;
        const b = state.buildings.find((q) => q.id === id);
        return !!b && (b.key === "mauer" || b.key === "tor" || b.key === "turm");
      };
      // hinten zuerst, damit sich die Vorschau-Stücke richtig überdecken
      const depth = (q: { x: number; y: number }) => { const [u, v] = toView(q.x + 0.5, q.y + 0.5, this.r, this.W, this.H); return u + v; };
      for (const tl of [...p.check.tiles].sort((a, b) => depth(a) - depth(b))) {
        this.diamond(g, tl.x, tl.y, 0, tl.ok ? 0x6fdc5a : 0xe0503c, 0.38, tl.ok ? 0x9cf08a : 0xff8a70);
        let mask = 0;
        NEIGHBOURS.forEach(([dx, dy], bit) => { if (fort(tl.x + dx, tl.y + dy)) mask |= 1 << bit; });
        this.ghostWall(tl.x, tl.y, mask, tl.ok);
      }
    } else if (p?.kind === "kachel") {
      this.diamond(g, p.x, p.y, p.z, p.color, 0.22, p.color);
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

    this.projectiles(state.projectiles);
    this.healthBars(o.units);
    this.ghostPool.finish();
  }

  private ghostBuilding(key: BuildingKey, x: number, y: number, o: number, ok: boolean): void {
    const bs = this.bs;
    if (!bs) return;
    let sk = BUILDINGS[key].sprite;
    if (!bs.has(sk)) sk = key === "lager" ? "lager" : key === "tor" ? "mauer" : sk;
    const tex = bs.texture(sk, viewOf(o, this.r), 0);
    if (!tex) return;
    const [cx, cy] = center(key, x, y, o);
    const [X, Y] = this.scr(cx, cy);
    const s = this.ghostPool.next(tex);
    s.pivot.set(bs.anchor[0], bs.anchor[1]);
    s.position.set(Math.round(X), Math.round(Y));
    s.alpha = 0.62;
    s.tint = ok ? 0xffffff : 0xff7a6a;
  }

  private ghostWall(x: number, y: number, mask: number, ok: boolean): void {
    const bs = this.bs;
    if (!bs) return;
    const { piece, o } = wallPiece(mask);
    const keys: [string, number][] = bs.has(piece) ? [[piece, o]]
      : piece === "mauer_ecke" || piece === "mauer_t" || piece === "mauer_kreuz" ? [["mauer", o], ["mauer", o + 1]] : [["mauer", o]];
    const [X, Y] = this.scr(x + 0.5, y + 0.5);
    for (const [k, ko] of keys) {
      const tex = bs.texture(k, viewOf(ko, this.r), 0);
      if (!tex) continue;
      const s = this.ghostPool.next(tex);
      s.pivot.set(bs.anchor[0], bs.anchor[1]);
      s.position.set(Math.round(X), Math.round(Y));
      s.alpha = 0.55;
      s.tint = ok ? 0xffffff : 0xff7a6a;
    }
  }

  /** Pfeile als kurze Linie entlang der Flugbahn (Bogen nach t), kurz vor dem Ziel ein Funke. */
  private projectiles(list: Projectile[]): void {
    const g = this.top;
    for (const p of list) {
      const dist = Math.hypot(p.x1 - p.x0, p.y1 - p.y0);
      const arc = Math.min(4, dist * 0.3);
      const at = (t: number): [number, number] => {
        const tt = Math.max(0, Math.min(1, t));
        const x = p.x0 + (p.x1 - p.x0) * tt, y = p.y0 + (p.y1 - p.y0) * tt;
        const z = p.z0 + (p.z1 - p.z0) * tt + arc * 4 * tt * (1 - tt);
        return this.scr(x, y, z);
      };
      const [x1, y1] = at(p.t), [x0, y0] = at(p.t - 0.07);
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const k = Math.min(1, 10 / len); // feste Länge von etwa 10 Pixeln
      const xs = x1 - (x1 - x0) * k, ys = y1 - (y1 - y0) * k;
      g.moveTo(xs, ys).lineTo(x1, y1).stroke({ width: 1.5, color: 0x3a2a1a, alpha: 0.95 });
      g.rect(Math.round(x1) - 1, Math.round(y1) - 1, 2, 2).fill({ color: 0xd8d8d0 });
      if (p.t > 0.92) {
        const k2 = (p.t - 0.92) / 0.08;
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
