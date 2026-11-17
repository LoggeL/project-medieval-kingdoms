/**
 * Objektebene: Gebäude, Baustellen, Lagerstapel, Bäume, Felsen, Figuren und die Bauvorschau aus dem Simulationszustand.
 * Jedes Bild: sichtbare Objekte sammeln (Culling), gemeinsam tiefensortieren (depth.ts), Sprites aus dem Pool belegen.
 * Figuren auf Mauer, Turm oder Treppe gehören zum Gebäude unter ihnen und werden zwischen Gebäude und Vorderteil
 * gezeichnet (wie in tools/konzeptseite/bauten.js), in jeder Drehung. Der vordere Lagerzaun ist ein eigenes Objekt nach
 * Stapeln und Figuren im Hof. Figuren, die von Gebäuden oder Bäumen verdeckt sind, bekommen eine dezente Silhouette
 * in Teamfarbe über allem (und bleiben dort anklickbar).
 */
import { Container, type Texture } from "pixi.js";
import { BUILDINGS, GOODS, TICKS_PER_SECOND, TUNING, UNITS, type AnimKey, type Good } from "../data";
import { center, entrance, modelToWorld, slotTile, toView, viewOf, wallPiece, type Rot } from "../sim/geom";
import type { Building, Rock, SimState, Tree, Unit } from "../sim/types";
import { warnOnce, type BuildingSheet, type FigureSheet } from "./assets";
import { DepthSorter, type DepthItem } from "./depth";
import { pileTexture, ringTexture, rockTexture } from "./fallbacks";
import { axisOrientation, figureDir, vecToScreen, viewToScreen } from "./iso";
import { SpritePool } from "./pool";

/** Treffer-Eintrag für die Mausauswahl (in Zeichenreihenfolge). Gepoolt: nur im selben Bild gültig. */
export interface Hit {
  kind: "unit" | "building";
  id: number;
  team: number;
  src: "b" | "f";
  key: string;
  view: number;
  frame: number;
  /** Linke obere Ecke der Zelle in Welt-Pixeln. */
  x: number;
  y: number;
}

/** Halbtransparentes Vorschau-Sprite (Bauvorschau), wird mit den Objekten tiefensortiert. */
export interface Ghost {
  /** Sprite-Schlüssel im Gebäudeblatt und Ausrichtung (Welt), Variante. */
  key: string; o: number; frame: number;
  /** Welt-Rechteck des Grundrisses (Tiles) und Mittelpunkt. */
  x0: number; y0: number; x1: number; y1: number;
  cx: number; cy: number;
  alpha: number; tint: number;
}

interface Part {
  tex: Texture;
  x: number; y: number;        // Pivot-Punkt in Welt-Pixeln
  px: number; py: number;      // Pivot in der Textur
  rot: number; sx: number; sy: number;
  alpha: number; tint: number;
  hit: Hit | null;
  /** Verdeckt Figuren dahinter (Gebäudeblatt-Sprite ohne Drehung): Schlüssel, Ansicht, Variante. */
  occKey: string | null; occView: number; occFrame: number;
  /** Figur: Einheit (für Silhouette und Verdeckung). */
  unit: Unit | null; figKey: string; figDir: number; figFrame: number;
}

interface Item extends DepthItem { p0: number; p1: number }

export interface SceneOptions {
  selectedUnits: ReadonlySet<number>;
  /** Gebäude, das rot hervorgehoben wird (Abriss-Werkzeug). */
  danger: number | null;
  /** Gebäude, das hell hervorgehoben wird (Auswahl/Maus). */
  highlight: number | null;
  /** Bauvorschau. */
  ghosts: readonly Ghost[];
}

export interface UnitOnScreen { id: number; team: number; x: number; y: number; hp: number; maxHp: number; selected: boolean; top: number }

const FIG_FPS = 10;
const hash4 = (id: number) => (Math.imul(id, 2654435761) >>> 28) & 3;
/** Arbeitsanimationen, auf die eine fehlende Animation zurückfällt (vor den Gehbildern), nie auf das Stehbild. */
const WORK_ANIMS: AnimKey[] = ["bauen", "hacken", "abbauen", "angriff", "schiessen"];
/** Silhouette: Teamfarbe und Deckkraft; Anteil verdeckter Stichproben, ab dem sie erscheint. */
const SIL_COLOR = [0x8fc4ff, 0xff7a64];
const SIL_ALPHA = 0.5;
const SIL_MIN = 0.5;
/** Stichproben im Figurenbild relativ zum Fußpunkt (Körpermitte von unten nach oben). */
const SAMPLES: [number, number][] = [[0, -3], [0, -9], [0, -15], [0, -21], [0, -27], [-3, -14], [3, -14], [-2, -22], [2, -22]];
const FALL_STEP = 1 / (TUNING.fallSeconds * TICKS_PER_SECOND);

export class ObjectLayer {
  readonly container = new Container();
  /** Silhouetten verdeckter Figuren (über der Objektebene). */
  readonly silhouettes = new Container();
  private pool = new SpritePool(this.container);
  private silPool = new SpritePool(this.silhouettes);
  private sorter = new DepthSorter();
  private items: Item[] = [];
  private nItems = 0;
  private parts: Part[] = [];
  private nParts = 0;
  private order: number[] = [];
  /** Gezeichnete Teile in Zeichenreihenfolge (Indizes in parts). */
  private drawn: number[] = [];
  private occList: number[] = [];
  private candList: Part[] = [];
  private byId = new Map<number, Building>();
  private attached = new Map<number, { u: Unit; x: number; y: number; z: number }[]>();
  private hitPool: Hit[] = [];
  private nHits = 0;
  private unitPool: UnitOnScreen[] = [];
  /** Treffer in Zeichenreihenfolge (letzter = oberster). */
  hits: Hit[] = [];
  /** Figuren dieses Bildes (Rahmenauswahl, Lebensbalken). */
  units: UnitOnScreen[] = [];
  stats = { items: 0, sprites: 0, pairs: 0, silhouettes: 0 };

  private r: Rot = 0;
  private W = 0;
  private H = 0;
  private alpha = 1;
  private view = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor(private bs: BuildingSheet | null, private fs: FigureSheet | null) {}

  update(state: SimState, r: Rot, alpha: number, view: { x0: number; y0: number; x1: number; y1: number }, opt: SceneOptions): void {
    this.r = r; this.W = state.w; this.H = state.h; this.view = view; this.alpha = alpha;
    this.nItems = 0; this.nParts = 0; this.nHits = 0;
    this.hits.length = 0;
    this.units.length = 0;
    this.byId.clear();
    for (const b of state.buildings) this.byId.set(b.id, b);
    for (const list of this.attached.values()) list.length = 0;

    // Figuren: interpolieren, auf Gebäuden einhängen oder als eigenes Objekt
    for (const u of state.units) {
      let x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha, z = u.pz + (u.z - u.pz) * alpha;
      if (Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 2) { x = u.x; y = u.y; z = u.z; }
      if (z > 0.2 || u.layer > 0) {
        const bid = state.tiles[Math.floor(y) * state.w + Math.floor(x)]?.building ?? 0;
        if (bid && this.byId.has(bid)) {
          let list = this.attached.get(bid);
          if (!list) { list = []; this.attached.set(bid, list); }
          list.push({ u, x, y, z });
          continue;
        }
      }
      this.unitItem(u, x, y, z, opt);
    }
    for (const b of state.buildings) this.buildingItems(b, state, opt);
    for (const t of state.trees) this.treeItem(t);
    for (const k of state.rocks) this.rockItem(k);
    for (const g of opt.ghosts) this.ghostItem(g);

    // Sortieren und Sprites belegen
    const items = this.items;
    this.sorter.sort(items, this.order, this.nItems);
    this.pool.reset();
    const drawn = this.drawn;
    drawn.length = 0;
    for (const i of this.order) {
      const it = items[i];
      for (let p = it.p0; p < it.p1; p++) {
        const part = this.parts[p];
        this.emit(part);
        drawn.push(p);
        if (part.hit) this.hits.push(part.hit);
      }
    }
    this.pool.finish();
    this.silhouetteFigures();
    this.stats.items = this.nItems;
    this.stats.sprites = this.pool.count;
    this.stats.pairs = this.sorter.pairs;
  }

  // ---------------------------------------------------------------- Hilfen

  private newItem(u0: number, u1: number, v0: number, v1: number, flat = false, fig = false, bias = 0, cover = false): Item {
    let it = this.items[this.nItems];
    if (!it) { it = { u0, u1, v0, v1, x0: 0, y0: 0, x1: 0, y1: 0, flat, fig, bias, cover, p0: 0, p1: 0 }; this.items.push(it); }
    it.u0 = u0; it.u1 = u1; it.v0 = v0; it.v1 = v1; it.flat = flat; it.fig = fig; it.bias = bias; it.cover = cover;
    it.x0 = Infinity; it.y0 = Infinity; it.x1 = -Infinity; it.y1 = -Infinity;
    it.p0 = it.p1 = this.nParts;
    this.nItems++;
    return it;
  }

  /** Objekt wieder verwerfen, wenn es ganz außerhalb des Bildes liegt. */
  private closeItem(it: Item): void {
    const v = this.view;
    if (it.p1 === it.p0 || it.x1 < v.x0 || it.x0 > v.x1 || it.y1 < v.y0 || it.y0 > v.y1) {
      this.nItems--;
      this.nParts = it.p0;
    }
  }

  private part(it: Item, tex: Texture, x: number, y: number, px: number, py: number, o: Partial<Pick<Part, "rot" | "sx" | "sy" | "alpha" | "tint" | "hit">> = {}): Part {
    let p = this.parts[this.nParts];
    if (!p) {
      p = { tex, x: 0, y: 0, px: 0, py: 0, rot: 0, sx: 1, sy: 1, alpha: 1, tint: 0xffffff, hit: null, occKey: null, occView: 0, occFrame: 0, unit: null, figKey: "", figDir: 0, figFrame: 0 };
      this.parts.push(p);
    }
    p.tex = tex; p.x = Math.round(x); p.y = Math.round(y); p.px = px; p.py = py;
    p.rot = o.rot ?? 0; p.sx = o.sx ?? 1; p.sy = o.sy ?? 1; p.alpha = o.alpha ?? 1; p.tint = o.tint ?? 0xffffff; p.hit = o.hit ?? null;
    p.occKey = null; p.unit = null;
    this.nParts++;
    it.p1 = this.nParts;
    // Bildrechteck
    const w = tex.frame.width, h = tex.frame.height;
    let x0: number, y0: number, x1: number, y1: number;
    if (p.rot !== 0) {
      const R = Math.max(w, h) * Math.max(Math.abs(p.sx), Math.abs(p.sy));
      x0 = p.x - R; x1 = p.x + R; y0 = p.y - R; y1 = p.y + R;
    } else {
      const ax = p.x - px * p.sx, ay = p.y - py * p.sy, bx = ax + w * p.sx, by = ay + h * p.sy;
      x0 = Math.min(ax, bx); x1 = Math.max(ax, bx); y0 = Math.min(ay, by); y1 = Math.max(ay, by);
    }
    if (x0 < it.x0) it.x0 = x0; if (y0 < it.y0) it.y0 = y0;
    if (x1 > it.x1) it.x1 = x1; if (y1 > it.y1) it.y1 = y1;
    return p;
  }

  /** Teil als Verdecker für Figuren markieren (nur unverzerrte, deckende Gebäudeblatt-Sprites). */
  private occluder(p: Part, key: string, view: number, frame: number): void {
    p.occKey = key; p.occView = view; p.occFrame = frame;
  }

  private emit(p: Part): void {
    const s = this.pool.next(p.tex);
    s.pivot.set(p.px, p.py);
    s.position.set(p.x, p.y);
    if (p.rot) s.rotation = p.rot;
    if (p.sx !== 1 || p.sy !== 1) s.scale.set(p.sx, p.sy);
    if (p.alpha !== 1) s.alpha = p.alpha;
    if (p.tint !== 0xffffff) s.tint = p.tint;
  }

  private scr(x: number, y: number, z = 0): [number, number] {
    const [u, v] = toView(x, y, this.r, this.W, this.H);
    return viewToScreen(u, v, z);
  }

  /** Bodenbox eines Welt-Rechtecks in Ansichtskoordinaten. */
  private box(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    const [a, b] = toView(x0, y0, this.r, this.W, this.H), [c, d] = toView(x1, y1, this.r, this.W, this.H);
    return [Math.min(a, c), Math.max(a, c), Math.min(b, d), Math.max(b, d)];
  }

  private hit(kind: Hit["kind"], id: number, team: number, src: Hit["src"], key: string, view: number, frame: number, x: number, y: number): Hit {
    let h = this.hitPool[this.nHits];
    if (!h) { h = { kind, id, team, src, key, view, frame, x: 0, y: 0 }; this.hitPool.push(h); }
    this.nHits++;
    h.kind = kind; h.id = id; h.team = team; h.src = src; h.key = key; h.view = view; h.frame = frame;
    h.x = Math.round(x); h.y = Math.round(y);
    return h;
  }

  /** Sprite-Schlüssel mit Ersatz; meldet Ersatz einmal. */
  private bkey(key: string, ...fallback: string[]): string | null {
    if (this.bs?.has(key)) return key;
    for (const f of fallback) if (this.bs?.has(f)) { warnOnce(`Sprite „${key}“ fehlt im Gebäudeblatt, Ersatz „${f}“`); return f; }
    warnOnce(`Sprite „${key}“ fehlt im Gebäudeblatt`);
    return null;
  }

  // ---------------------------------------------------------------- Figuren

  private figKey(u: Unit): string | null {
    const fs = this.fs;
    if (!fs) return null;
    const want = u.carry ? GOODS[u.carry].carrier : UNITS[u.key].sprite;
    if (fs.has(want)) return want;
    const chain = u.carry ? ["traeger", UNITS[u.key].sprite, "tageloehner"] : ["tageloehner", "traeger"];
    for (const k of chain) if (fs.has(k)) { warnOnce(`Figur „${want}“ fehlt im Figurenblatt, Ersatz „${k}“`); return k; }
    return null;
  }

  /**
   * Bild aus Animation: Blatt-Animation; fehlt eine Arbeitsanimation, eine andere Arbeitsanimation derselben Figur,
   * sonst die Gehbilder (bewegt, nie das Stehbild). Gehen = Bilder 1..8, Stehen = Bild 0.
   */
  private figFrame(key: string, u: Unit): { frame: number; dead: boolean } {
    const anims = this.fs!.get(key)!.anims;
    const t = u.animT;
    const loop = (a: [number, number]) => a[0] + (Math.floor(t * FIG_FPS) % Math.max(1, a[1]));
    const once = (a: [number, number]) => a[0] + Math.min(a[1] - 1, Math.floor(t * FIG_FPS));
    switch (u.anim) {
      case "gehen": return { frame: loop(anims.gehen ?? [1, 8]), dead: false };
      case "stehen": return { frame: anims.stehen ? loop(anims.stehen) : 0, dead: false };
      case "sterben": return anims.sterben ? { frame: once(anims.sterben), dead: false } : { frame: 0, dead: true };
      case "tot":
        if (anims.tot) return { frame: loop(anims.tot), dead: false };
        if (anims.sterben) return { frame: anims.sterben[0] + anims.sterben[1] - 1, dead: false };
        return { frame: 0, dead: true };
      default: {
        const a = anims[u.anim];
        if (a) return { frame: loop(a), dead: false };
        const alt = WORK_ANIMS.find((k) => anims[k]);
        warnOnce(`Figur „${key}“ hat keine Animation „${u.anim}“, Ersatz „${alt ?? "gehen"}“`);
        return { frame: loop(alt ? anims[alt] : anims.gehen ?? [1, 8]), dead: false };
      }
    }
  }

  /** Teile einer Figur an Weltposition (x, y, z) in ein Objekt schreiben. */
  private figureParts(it: Item, u: Unit, x: number, y: number, z: number, opt: SceneOptions): void {
    const key = this.figKey(u);
    if (!key) return;
    const fs = this.fs!;
    const [X, Y] = this.scr(x, y, z);
    const dir = figureDir(u.fx, u.fy, this.r);
    const { frame, dead } = this.figFrame(key, u);
    const tex = fs.texture(key, dir, frame, u.team);
    if (!tex) return;
    const selected = opt.selectedUnits.has(u.id);
    if (selected) this.part(it, ringTexture(u.team === 0 ? "eigen" : "feind"), X, Y, 15, 7);
    const [ax, ay] = fs.anchor;
    if (dead) {
      // Ersatz ohne Sterbe-Animation: Stehbild ausgegraut und gekippt, blendet nach einigen Sekunden aus
      const fade = Math.max(0, 1 - Math.max(0, u.animT - 4) / 2);
      this.part(it, tex, X, Y - 3, ax, ay - 4, { rot: dir < 4 ? Math.PI / 2 : -Math.PI / 2, tint: 0x8c8c8c, alpha: fade });
      return;
    }
    const p = this.part(it, tex, X, Y, ax, ay, { hit: u.dead ? null : this.hit("unit", u.id, u.team, "f", key, dir, frame, Math.round(X) - ax, Math.round(Y) - ay) });
    if (u.dead) return;
    p.unit = u; p.figKey = key; p.figDir = dir; p.figFrame = frame;
    let os = this.unitPool[this.units.length];
    if (!os) { os = { id: 0, team: 0, x: 0, y: 0, hp: 0, maxHp: 0, selected: false, top: 0 }; this.unitPool.push(os); }
    os.id = u.id; os.team = u.team; os.x = Math.round(X); os.y = Math.round(Y); os.hp = u.hp; os.maxHp = u.maxHp;
    os.selected = selected; os.top = Math.round(Y) - 34;
    this.units.push(os);
  }

  private unitItem(u: Unit, x: number, y: number, z: number, opt: SceneOptions): void {
    const [cu, cv] = toView(x, y, this.r, this.W, this.H);
    const it = this.newItem(cu - 0.2, cu + 0.2, cv - 0.2, cv + 0.2, false, true, z * 0.01);
    this.figureParts(it, u, x, y, z, opt);
    this.closeItem(it);
  }

  /**
   * Verdeckte Figuren: Stichproben im Figurenbild gegen später gezeichnete Gebäude- und Baumsprites prüfen.
   * Ist mindestens die Hälfte verdeckt, kommt eine Silhouette in Teamfarbe über die Objektebene, mit Treffer ganz oben.
   */
  private silhouetteFigures(): void {
    this.silPool.reset();
    let n = 0;
    const fs = this.fs, bs = this.bs;
    const drawn = this.drawn, parts = this.parts;
    if (fs && bs) {
      const [ax, ay] = fs.anchor;
      // Verdecker in Zeichenreihenfolge (Position in drawn)
      const occ = this.occList;
      occ.length = 0;
      for (let j = 0; j < drawn.length; j++) if (parts[drawn[j]].occKey) occ.push(j);
      const cand = this.candList;
      let first = 0;
      for (let i = 0; i < drawn.length; i++) {
        const f = parts[drawn[i]];
        while (first < occ.length && occ[first] <= i) first++;
        if (!f.unit) continue;
        const fx0 = f.x - ax, fy0 = f.y - ay, fx1 = fx0 + fs.cell, fy1 = fy0 + fs.cell;
        cand.length = 0;
        for (let k = first; k < occ.length; k++) {
          const o = parts[drawn[occ[k]]];
          const ox = o.x - o.px, oy = o.y - o.py;
          if (ox > fx1 || oy > fy1 || ox + o.tex.frame.width < fx0 || oy + o.tex.frame.height < fy0) continue;
          cand.push(o);
        }
        if (!cand.length) continue;
        let total = 0, covered = 0;
        for (const [sx, sy] of SAMPLES) {
          if (fs.alpha(f.figKey, f.figDir, f.figFrame, ax + sx, ay + sy) <= 40) continue;
          total++;
          const wx = f.x + sx, wy = f.y + sy;
          for (const o of cand) {
            const sp = bs.get(o.occKey!);
            if (!sp) continue;
            const lx = wx - (o.x - o.px), ly = wy - (o.y - o.py);
            if (lx < 0 || ly < 0 || lx >= bs.cell[0] || ly >= bs.cell[1]) continue;
            if (sp.pixels.alpha(o.occFrame * bs.cell[0] + lx, o.occView * bs.cell[1] + ly) > 100) { covered++; break; }
          }
        }
        if (!total || covered / total < SIL_MIN) continue;
        const tex = fs.silhouette(f.figKey, f.figDir, f.figFrame);
        if (!tex) continue;
        const s = this.silPool.next(tex);
        s.pivot.set(ax, ay);
        s.position.set(f.x, f.y);
        s.tint = SIL_COLOR[f.unit.team] ?? SIL_COLOR[0];
        s.alpha = SIL_ALPHA;
        n++;
        const h = f.hit;
        if (h) this.hits.push(this.hit("unit", h.id, h.team, "f", h.key, h.view, h.frame, h.x, h.y));
      }
    }
    this.silPool.finish();
    this.stats.silhouettes = n;
  }

  // ---------------------------------------------------------------- Gebäude

  /** Tor offen: eine eigene Bodenfigur steht auf dem Tor oder direkt daneben. */
  private gateOpen(b: Building, state: SimState): boolean {
    const cx = b.x + 0.5, cy = b.y + 0.5;
    for (const u of state.units) {
      if (u.team !== b.team || u.dead || u.layer > 0 || u.z > 0.2) continue;
      if (Math.abs(u.x - cx) < 1.4 && Math.abs(u.y - cy) < 1.4) return true;
    }
    return false;
  }

  /** Sprite, Ausrichtung (für die Ansicht) und Variante eines Gebäudes. */
  private buildingSprite(b: Building, state: SimState): { keys: [string, number][]; frame: number } | null {
    const def = BUILDINGS[b.key];
    if (b.key === "mauer") {
      const { piece, o } = wallPiece(b.wallMask);
      if (this.bs?.has(piece)) return { keys: [[piece, o]], frame: 0 };
      const k = this.bkey(piece, "mauer");
      if (!k) return null;
      // Ersatz mit dem geraden Stück: Ecken, T und Kreuz als zwei gekreuzte Stücke
      const cross = piece === "mauer_ecke" || piece === "mauer_t" || piece === "mauer_kreuz";
      return { keys: cross ? [[k, o], [k, o + 1]] : [[k, o]], frame: 0 };
    }
    if (b.key === "tor") {
      const k = this.bkey("tor", "mauer");
      const open = k === "tor" && b.built >= 1 && this.gateOpen(b, state);
      return k ? { keys: [[k, gateOrientation(b.wallMask, b.o)]], frame: open ? 1 : 0 } : null;
    }
    if (b.key === "lager") {
      const k = this.bkey(def.sprite, "lager");
      if (!k) return null;
      if (k === "lager") {
        // Ersatz ohne Stapel: Füllstufe des ganzen Lagers
        const cap = (def.storage?.slots ?? 8) * (def.storage?.perSlot ?? 8);
        const sum = b.slots.reduce((s, q) => s + q.amount, 0);
        return { keys: [[k, b.o]], frame: Math.round((sum / Math.max(1, cap)) * 4) };
      }
      return { keys: [[k, b.o]], frame: 0 };
    }
    const k = this.bkey(def.sprite);
    if (!k) return null;
    let frame = 0;
    const sp = this.bs!.get(k)!;
    if (b.output && def.output && sp.frames > 1) {
      const a = b.output.amount, cap = def.output.capacity;
      frame = a <= 0 ? 0 : Math.min(sp.frames - 1, 1 + Math.floor(((a - 1) / cap) * (sp.frames - 1)));
    }
    return { keys: [[k, b.o]], frame };
  }

  private buildingItems(b: Building, state: SimState, opt: SceneOptions): void {
    const bs = this.bs;
    if (!bs) return;
    const def = BUILDINGS[b.key];
    const fp = def.footprint;
    const [w, h] = b.o % 2 === 0 ? fp : [fp[1], fp[0]];
    const [u0, u1, v0, v1] = this.box(b.x, b.y, b.x + w, b.y + h);
    const spr = this.buildingSprite(b, state);
    const lagerFlat = b.key === "lager" && spr?.keys[0][0] !== "lager";
    const it = this.newItem(u0, u1, v0, v1, lagerFlat, false);
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    const [X, Y] = this.scr(cx, cy);
    const [ax, ay] = bs.anchor;
    const tint = opt.danger === b.id ? 0xff8070 : opt.highlight === b.id ? 0xfff2c8 : 0xffffff;
    if (spr) {
      for (const [key, o] of spr.keys) {
        const view = viewOf(o, this.r);
        const tex = bs.texture(key, view, spr.frame, b.team);
        if (!tex) continue;
        const frame = Math.min(spr.frame, bs.get(key)!.frames - 1);
        const hit = this.hit("building", b.id, b.team, "b", key, view, frame, X - ax, Y - ay);
        if (b.built >= 1) {
          const p = this.part(it, tex, X, Y, ax, ay, { tint, hit });
          if (!lagerFlat) this.occluder(p, key, view, frame);
        } else {
          // Baustelle: voller Umriss halbtransparent, darüber von unten nach oben aufgedeckt
          this.part(it, tex, X, Y, ax, ay, { alpha: 0.28, tint: 0xc8d4ff, hit });
          const bb = bs.get(key)!.bbox[view]?.[frame];
          if (bb && b.built > 0) {
            const q = Math.round(b.built * 48) / 48;
            const cut = Math.round(bb.y1 - q * (bb.y1 - bb.y0));
            const crop = bs.crop(key, view, spr.frame, b.team, cut, bs.cell[1]);
            if (crop) this.part(it, crop, X, Y, ax, ay - cut, { tint });
          }
        }
      }
    }
    // Figuren auf Wehrgang, Turm und Treppe, dann das Vorderteil
    const on = this.attached.get(b.id);
    if (on && on.length) {
      if (on.length > 1) on.sort((p, q) => {
        const [pu, pv] = toView(p.x, p.y, this.r, this.W, this.H), [qu, qv] = toView(q.x, q.y, this.r, this.W, this.H);
        return pu + pv - (qu + qv) || p.z - q.z;
      });
      for (const a of on) this.figureParts(it, a.u, a.x, a.y, a.z, opt);
      if (spr && b.built >= 1) for (const [key, o] of spr.keys) {
        const ft = bs.texture(key, viewOf(o, this.r), spr.frame, b.team, "front");
        if (ft) this.part(it, ft, X, Y, ax, ay, { tint });
      }
    }
    this.closeItem(it);
    if (b.key === "lager" && lagerFlat) {
      this.stackItems(b);
      // Vorderer Zaun als eigenes Objekt nach Stapeln und Figuren im Hof (lager_boden → Stapel/Figuren → Front)
      const key = spr!.keys[0][0], view = viewOf(spr!.keys[0][1], this.r);
      const ft = b.built >= 1 ? bs.texture(key, view, 0, b.team, "front") : null;
      if (ft) {
        const fit = this.newItem(u0, u1, v0, v1, false, false, 0, true);
        // kein Verdecker: der Zaun ist niedrig (und seine Alphadaten wären die des Bodens)
        this.part(fit, ft, X, Y, ax, ay, { tint });
        this.closeItem(fit);
      }
    }
    if (b.built < 1) this.siteItems(b);
  }

  private stackTexture(good: Good, level: number, o: number): { tex: Texture; px: number; py: number } {
    const key = GOODS[good].stack;
    const bs = this.bs!;
    if (bs.has(key)) {
      const tex = bs.texture(key, viewOf(o, this.r), level, 0);
      if (tex) return { tex, px: bs.anchor[0], py: bs.anchor[1] };
    }
    warnOnce(`Sprite „${key}“ fehlt im Gebäudeblatt, Ersatz: kleiner Stapel`);
    return { tex: pileTexture(good, Math.max(1, level)), px: 16, py: 22 };
  }

  private stackItems(b: Building): void {
    const per = BUILDINGS.lager.storage?.perSlot ?? 8;
    b.slots.forEach((s, k) => {
      if (!s.good || k >= 8) return;
      const level = s.amount <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((s.amount / per) * 4)));
      if (level === 0 && !this.bs!.has(GOODS[s.good].stack)) return;
      const [tx, ty] = slotTile(b.x, b.y, b.o, k);
      const [u0, u1, v0, v1] = this.box(tx, ty, tx + 1, ty + 1);
      const it = this.newItem(u0 + 0.05, u1 - 0.05, v0 + 0.05, v1 - 0.05);
      const [X, Y] = this.scr(tx + 0.5, ty + 0.5);
      const st = this.stackTexture(s.good, level, b.o);
      this.part(it, st.tex, X, Y, st.px, st.py);
      this.closeItem(it);
    });
  }

  private siteItems(b: Building): void {
    const goods = (Object.keys(b.site) as Good[]).filter((g) => (b.site[g] ?? 0) > 0);
    if (!goods.length) return;
    const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
    const [lx, ly] = modelToWorld(1, 0, b.o);
    goods.forEach((g, k) => {
      const off = (k - (goods.length - 1) / 2) * 0.7;
      const x = ex + 0.5 + lx * off, y = ey + 0.5 + ly * off;
      const [cu, cv] = toView(x, y, this.r, this.W, this.H);
      const it = this.newItem(cu - 0.3, cu + 0.3, cv - 0.3, cv + 0.3);
      const [X, Y] = this.scr(x, y);
      const level = Math.max(1, Math.min(4, Math.ceil((b.site[g] ?? 0) / 3)));
      const st = this.stackTexture(g, level, b.o);
      this.part(it, st.tex, X, Y, st.px, st.py);
      this.closeItem(it);
    });
  }

  /** Bauvorschau als halbtransparentes Objekt in der Tiefensortierung (Figuren davor bleiben unverdeckt). */
  private ghostItem(g: Ghost): void {
    const bs = this.bs;
    if (!bs) return;
    const view = viewOf(g.o, this.r);
    const tex = bs.texture(g.key, view, g.frame);
    if (!tex) return;
    const [u0, u1, v0, v1] = this.box(g.x0, g.y0, g.x1, g.y1);
    const it = this.newItem(u0, u1, v0, v1);
    const [X, Y] = this.scr(g.cx, g.cy);
    this.part(it, tex, X, Y, bs.anchor[0], bs.anchor[1], { alpha: g.alpha, tint: g.tint });
    this.closeItem(it);
  }

  // ---------------------------------------------------------------- Bäume und Felsen

  private treeItem(t: Tree): void {
    const bs = this.bs;
    if (!bs) return;
    const [u0, u1, v0, v1] = this.box(t.x, t.y, t.x + 1, t.y + 1);
    const it = this.newItem(u0 + 0.1, u1 - 0.1, v0 + 0.1, v1 - 0.1);
    const [X, Y] = this.scr(t.x + 0.5, t.y + 0.5);
    const [ax, ay] = bs.anchor;
    const key = this.bkey(t.kind, "baum");
    if (!key) { this.closeItem(it); return; }
    const sp = bs.get(key)!;
    const view = viewOf(hash4(t.id), this.r);
    const frame = t.variant % sp.frames;
    const tex = bs.texture(key, view, frame);
    if (!tex) { this.closeItem(it); return; }
    const fallen = (e: number) => {
      // Kippen in Fallrichtung: Drehung nach links/rechts, Verkürzung nach vorn/hinten (zur Kamera hin gespiegelt)
      const [sx, sy] = vecToScreen(t.fallX || 1, t.fallY, this.r);
      const len = Math.hypot(sx, sy) || 1, nx = sx / len, ny = sy / len;
      const scaleY = ny > 0 ? 1 - e * 1.45 * ny : 1 - e * 0.6 * -ny;
      this.part(it, tex, X, Y, ax, ay, { rot: e * (Math.PI / 2) * nx, sy: scaleY });
    };
    switch (t.state) {
      case "stehend": this.occluder(this.part(it, tex, X, Y, ax, ay), key, view, frame); break;
      case "faellt": {
        // zwischen den Ticks weiterlaufen lassen (wie Figuren und Pfeile)
        const p = Math.min(1, t.progress + this.alpha * FALL_STEP);
        fallen(p * p);
        break;
      }
      case "liegt": {
        if (bs.has("baum_liegt")) {
          // Varianten: 3, 2, 1 Stämme
          const o = axisOrientation(t.fallX, t.fallY);
          const v = Math.max(0, Math.min(bs.get("baum_liegt")!.frames - 1, TUNING.treeLogs - t.logs));
          const lt = bs.texture("baum_liegt", viewOf(o, this.r), v);
          if (lt) { this.part(it, lt, X, Y, ax, ay); break; }
        }
        warnOnce("Sprite „baum_liegt“ fehlt im Gebäudeblatt, Ersatz: gekippter Baum");
        fallen(1);
        break;
      }
      case "stumpf": {
        if (bs.has("baum_stumpf")) {
          // Varianten: Laubbaum, Tanne
          const st = bs.texture("baum_stumpf", view, t.kind === "tanne" ? 1 : 0);
          if (st) { this.part(it, st, X, Y, ax, ay); break; }
        }
        warnOnce("Sprite „baum_stumpf“ fehlt im Gebäudeblatt, Ersatz: unterster Stammteil des Baums");
        const crop = bs.crop(key, view, frame, 0, ay - 9, ay + 7);
        if (crop) this.part(it, crop, X, Y, ax, 9);
        break;
      }
    }
    this.closeItem(it);
  }

  private rockItem(k: Rock): void {
    const [u0, u1, v0, v1] = this.box(k.x, k.y, k.x + 1, k.y + 1);
    const it = this.newItem(u0 + 0.05, u1 - 0.05, v0 + 0.05, v1 - 0.05);
    const [X, Y] = this.scr(k.x + 0.5, k.y + 0.5);
    const used = 1 - k.amount / Math.max(1, k.max);
    const bs = this.bs;
    if (bs?.has("fels")) {
      const sp = bs.get("fels")!;
      const stage = Math.max(0, Math.min(sp.frames - 1, Math.floor(used * sp.frames)));
      const view = viewOf(hash4(k.id), this.r);
      const tex = bs.texture("fels", view, stage);
      if (tex) this.occluder(this.part(it, tex, X, Y, bs.anchor[0], bs.anchor[1]), "fels", view, stage);
    } else {
      warnOnce("Sprite „fels“ fehlt im Gebäudeblatt, Ersatz: einfacher Felsbrocken");
      this.part(it, rockTexture(Math.max(0, Math.min(4, Math.floor(used * 5)))), X, Y, 32, 40);
    }
    this.closeItem(it);
  }

  /** Pixelgenauer Treffer: oberstes Objekt unter dem Welt-Pixel (wx, wy). Figuren mit etwas Spielraum. */
  pick(wx: number, wy: number, filter?: (h: Hit) => boolean): Hit | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (filter && !filter(h)) continue;
      const lx = Math.floor(wx - h.x), ly = Math.floor(wy - h.y);
      if (h.src === "f") {
        const fs = this.fs!;
        if (lx < -2 || ly < -2 || lx > fs.cell + 2 || ly > fs.cell + 2) continue;
        let hitPx = false;
        for (let dy = -2; dy <= 2 && !hitPx; dy++) for (let dx = -2; dx <= 2 && !hitPx; dx++) {
          if (fs.alpha(h.key, h.view, h.frame, lx + dx, ly + dy) > 40) hitPx = true;
        }
        if (hitPx) return h;
      } else {
        const bs = this.bs!;
        const [cw, ch] = bs.cell;
        if (lx < 0 || ly < 0 || lx >= cw || ly >= ch) continue;
        const sp = bs.get(h.key);
        if (sp && sp.pixels.alpha(h.frame * cw + lx, h.view * ch + ly) > 40) return h;
      }
    }
    return null;
  }
}

/**
 * Ausrichtung eines Tors aus der Mauer-Nachbarschaft (wie placeSite in sim/build.ts): Nachbarn in O/W → o = 0,
 * in N/S → o = 1, sonst die gewünschte Ausrichtung.
 */
export function gateOrientation(mask: number, o: number): number {
  return mask & 0b1010 ? 0 : mask & 0b0101 ? 1 : o;
}
