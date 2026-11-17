/**
 * Objektebene: Gebäude, Baustellen, Lagerstapel, Bäume, Felsen, Figuren und die Bauvorschau aus dem Simulationszustand.
 * Jedes Bild: sichtbare Objekte sammeln (Culling), gemeinsam tiefensortieren (depth.ts), Sprites aus dem Pool belegen.
 * Figuren auf Mauer, Turm oder Treppe gehören zum Gebäude unter ihnen und werden zwischen Gebäude und Vorderteil
 * gezeichnet (wie in tools/konzeptseite/bauten.js), in jeder Drehung. Der vordere Lagerzaun ist ein eigenes Objekt nach
 * Stapeln und Figuren im Hof. Figuren, die von Gebäuden oder Bäumen verdeckt sind, bekommen eine dezente Silhouette
 * in Teamfarbe über allem (und bleiben dort anklickbar). Verarbeitungsgebäude (ADR 0011) zeigen Eingangspuffer und
 * Ausgabestapel als eigene Warenstapel, ihr Arbeitsbild (Mühlenflügel) läuft nur, solange gearbeitet wird.
 */
import { Container, type Texture } from "pixi.js";
import { BUILDINGS, GOODS, RECIPES, RESOURCE_TAGS, TICKS_PER_SECOND, TUNING, UNITS, levelDef, type AnimKey, type BuildingKey, type Good } from "../data";
import { center, gateOrientation, modelToWorld, shelfWorld, toView, viewOf, wallPiece, type Rot } from "../sim/geom";
import type { Building, Rock, SimState, Tree, Unit } from "../sim/types";
import { warnOnce, type BuildingSheet, type FigureSheet } from "./assets";
import { DepthSorter, type DepthItem } from "./depth";
import { pileTexture, ringTexture, rockTexture } from "./fallbacks";
import { axisOrientation, figureDir, vecToScreen, viewToScreen } from "./iso";
import { SpritePool } from "./pool";
import { CHIMNEYS, chimneyWorld, type Emitter } from "./smoke";
import { RUBBLE_LIFE, type DustMat, type RubbleEmitter, type StrikeEmitter } from "./dust";

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
  /**
   * Teil einer Gruppe (Mauerzug beim Ziehen): nicht einzeln halbtransparent in der Tiefensortierung, sondern deckend in
   * der eigenen Ebene ghostGroup, die als Ganzes einheitlich transparent ist (keine sich addierenden Überlappungen).
   */
  group?: boolean;
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
  /** Innenansicht je Gebäude-ID (0 = zu, 1 = ganz offen); fehlt = überall zu. */
  interiors?: ReadonlyMap<number, number>;
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
/**
 * Deckende Sprite-Pixel: Die Gebäudeblätter backen den Schlagschatten mit Alpha 105 (Saum 55) ein, der Körper hat 255.
 * Verdeckung (Silhouetten) und Treffer zählen nur Körperpixel, sonst bekommt eine Figur im Schatten eines Baums eine
 * Silhouette oder ein Klick auf sie träfe den Baum.
 */
export const SOLID_ALPHA = 200;
/** Stichproben im Figurenbild relativ zum Fußpunkt (Körpermitte von unten nach oben). */
const SAMPLES: [number, number][] = [[0, -3], [0, -9], [0, -15], [0, -21], [0, -27], [-3, -14], [3, -14], [-2, -22], [2, -22]];
/** Farbton des noch nicht gebauten Teils einer Baustelle (Holz/Gerüst statt eines kühlen Geisterumrisses). */
const SITE_TINT = 0xd9a86a;
const FALL_STEP = 1 / (TUNING.fallSeconds * TICKS_PER_SECOND);
/** Grundmauern eines abgerissenen Gebäudes bleiben so lange sichtbar (s), die letzten 1,5 s blenden sie aus. */
const DEBRIS_SECONDS = 4.5;
/** Gerüst: so viele Pixel ragt es über den schon gebauten Teil hinaus. */
const SCAFFOLD_LEAD = 14;

/**
 * Sichtbarer Anteil des wachsenden Baus (0..1) beim Baufortschritt built: das erste Stück (foundation) ist Fundament,
 * danach wächst der Bau gleichmäßig, mit courses in so vielen Lagen (Stein für Stein), sonst in 48 feinen Stufen.
 */
export function siteGrowth(built: number, foundation: number, courses?: number): number {
  if (built >= 1) return 1;
  const g = Math.max(0, Math.min(1, (built - foundation) / Math.max(1e-6, 1 - foundation)));
  const n = courses ?? 48;
  return Math.floor(g * n + 1e-9) / n;
}

/** Stapelstufe (1..4) für n Stück, wenn insgesamt total davon verbaut werden. */
export function pileLevel(n: number, total: number): number {
  if (n <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((n / Math.max(1, total)) * 4)));
}

/** Füllstand des ganzen Lagers als Variante 0..frames−1 (0 nur, wenn wirklich leer). */
export function fillFrame(b: Building, frames: number): number {
  const st = BUILDINGS[b.key].storage;
  if (!st || frames <= 1) return 0;
  const sum = b.slots.reduce((n, q) => n + q.amount, 0);
  if (sum <= 0) return 0;
  return Math.max(1, Math.min(frames - 1, Math.ceil((sum / Math.max(1, st.slots * st.perSlot)) * (frames - 1))));
}

export class ObjectLayer {
  readonly container = new Container();
  /** Silhouetten verdeckter Figuren (über der Objektebene). */
  readonly silhouettes = new Container();
  /** Gruppenvorschau (Mauerzug): deckend gezeichnet; die Darstellung gibt dem Container eine gemeinsame Transparenz. */
  readonly ghostGroup = new Container();
  private groupPool = new SpritePool(this.ghostGroup);
  private groupList: Ghost[] = [];
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
  /** Figuren im Inneren (Unit.inside) je Gebäude, nur in der Innenansicht sichtbar. */
  private insideUnits = new Map<number, { u: Unit; x: number; y: number; z: number }[]>();
  /** Im Bergfried wird gerade geforscht (Schnittbild mit dem Gelehrten am Pult). */
  private researching = false;
  /** Bewohner je Wohnhaus (Bevölkerung der Reihe nach auf die Häuser verteilt), für das Schnittbild. */
  readonly residents = new Map<number, number>();
  private contents: { d: number; draw: () => void }[] = [];
  private hitPool: Hit[] = [];
  private nHits = 0;
  private unitPool: UnitOnScreen[] = [];
  /** Treffer in Zeichenreihenfolge (letzter = oberster). */
  hits: Hit[] = [];
  /** Figuren dieses Bildes (Rahmenauswahl, Lebensbalken). */
  units: UnitOnScreen[] = [];
  /** Schornsteine sichtbarer, fertiger Gebäude in diesem Bild (Welt-Pixel), für die Rauchebene. */
  emitters: Emitter[] = [];
  private emitterPool: Emitter[] = [];
  /** Hämmernde Bauarbeiter und Staubwolken abgerissener Gebäude in diesem Bild, für die Staubebene (dust.ts). */
  strikes: StrikeEmitter[] = [];
  rubble: RubbleEmitter[] = [];
  private strikePool: StrikeEmitter[] = [];
  private rubblePool: RubbleEmitter[] = [];
  /** Gebäude des letzten Bildes (Abriss erkennen) und Grundmauern verschwundener Gebäude mit Zeitpunkt (Spielsekunden). */
  private prevB = new Map<number, { key: BuildingKey; x: number; y: number; o: number; built: number }>();
  private prevSeen = false;
  private debris: { id: number; key: BuildingKey; x: number; y: number; o: number; built: number; t0: number }[] = [];
  /** Arbeitszeit je Verarbeitungsgebäude mit workAnim (Spielsekunden, nur solange proc.busy): Phase der Flügel. */
  private workPhase = new Map<number, number>();
  private lastTime = -1;
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
    this.emitters.length = 0;
    this.strikes.length = 0;
    this.rubble.length = 0;
    this.byId.clear();
    for (const b of state.buildings) this.byId.set(b.id, b);
    const time = (state.tick + alpha) / TICKS_PER_SECOND;
    this.trackDebris(state, time);
    this.advanceWork(state, time);
    for (const list of this.attached.values()) list.length = 0;
    for (const list of this.insideUnits.values()) list.length = 0;
    this.countResidents(state);
    const cur = state.research?.cur;
    this.researching = !!cur && !Object.keys(cur.needs).length;

    // Figuren: interpolieren, auf Gebäuden einhängen oder als eigenes Objekt
    for (const u of state.units) {
      let x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha, z = u.pz + (u.z - u.pz) * alpha;
      if (Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 2) { x = u.x; y = u.y; z = u.z; }
      if (u.inside) {
        // im Gebäude: von außen verdeckt, gezeichnet nur mit der Innenansicht
        if (!this.byId.has(u.inside)) continue;
        let list = this.insideUnits.get(u.inside);
        if (!list) { list = []; this.insideUnits.set(u.inside, list); }
        list.push({ u, x, y, z });
        continue;
      }
      if (z > 0.2 || u.layer > 0) {
        const bid = state.tiles[Math.floor(y) * state.w + Math.floor(x)]?.building ?? 0;
        if (bid && this.byId.has(bid)) {
          let list = this.attached.get(bid);
          if (!list) { list = []; this.attached.set(bid, list); }
          list.push({ u, x, y, z });
          continue;
        }
      }
      this.safe(u.key, () => this.unitItem(u, x, y, z, opt));
    }
    for (const b of state.buildings) this.safe(b.key, () => this.buildingItems(b, state, opt));
    for (const d of this.debris) this.safe(d.key, () => this.debrisItem(d, time));
    for (const u of state.units) if (u.anim === "bauen" && !u.dead) this.strikeAt(u, state, alpha);
    for (const t of state.trees) this.safe(t.kind, () => this.treeItem(t));
    for (const k of state.rocks) this.safe("fels", () => this.rockItem(k));
    this.groupList.length = 0;
    for (const g of opt.ghosts) {
      if (g.group) this.groupList.push(g);
      else this.safe(g.key, () => this.ghostItem(g));
    }
    this.groupGhosts();

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

  /**
   * Ein Objekt aufbauen; wirft es (z. B. weil ein Sprite fehlt und ein Sonderfall das übersieht), wird nur dieses Objekt
   * ausgelassen und der Fehler einmal gemeldet. Ein einzelnes kaputtes Objekt darf nie das ganze Bild abbrechen.
   */
  private safe(what: string, fn: () => void): void {
    const ni = this.nItems, np = this.nParts, nh = this.nHits, nu = this.units.length, ne = this.emitters.length;
    try { fn(); } catch (e) {
      this.nItems = ni; this.nParts = np; this.nHits = nh; this.units.length = nu; this.emitters.length = ne;
      warnOnce(`Objekt „${what}“ lässt sich nicht zeichnen und wird ausgelassen (${e instanceof Error ? e.message : String(e)})`);
    }
  }

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
    // Trägerbild nur beim Gehen und Stehen; bei Arbeit, Kampf und Tod bleibt die eigene Figur (z. B. Steinmetz beim Abbauen).
    const carrying = !!u.carry && (u.anim === "gehen" || u.anim === "stehen");
    const want = carrying ? GOODS[u.carry!].carrier : UNITS[u.key].sprite;
    if (fs.has(want)) return want;
    const chain = carrying ? ["traeger", UNITS[u.key].sprite, "tageloehner"] : ["tageloehner", "traeger"];
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
            if (sp.pixels.alpha(o.occFrame * bs.cell[0] + lx, o.occView * bs.cell[1] + ly) > SOLID_ALPHA) { covered++; break; }
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

  /** Tor offen: Simulationsfeld gateOpen, sonst eine eigene Bodenfigur auf dem Tor oder direkt daneben. */
  private gateOpen(b: Building, state: SimState): boolean {
    if (typeof b.gateOpen === "boolean") return b.gateOpen;
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
    if (def.storage) {
      // Lagerhaus: Variante = Füllstand des ganzen Lagers (Kisten und Fässer vor dem Tor); Ersatz: alter Lagerplatz
      const k = this.bkey(def.sprite, "lager");
      if (!k) return null;
      return { keys: [[k, b.o]], frame: fillFrame(b, this.bs!.get(k)!.frames) };
    }
    // Ausbaustufen (Bergfried): eigenes Sprite je Stufe, Ersatz die niedrigere Stufe
    const lv = BUILDINGS[b.key].levels;
    const k = lv ? this.bkey(levelDef(b.key, b.level ?? 1).sprite, ...lv.slice(0, (b.level ?? 1) - 1).reverse().map((x) => x.sprite)) : this.bkey(def.sprite);
    if (!k) return null;
    let frame = 0;
    const sp = this.bs!.get(k)!;
    if (b.output && def.output && sp.frames > 1) {
      const a = b.output.amount, cap = def.output.capacity;
      frame = a <= 0 ? 0 : Math.min(sp.frames - 1, 1 + Math.floor(((a - 1) / cap) * (sp.frames - 1)));
    }
    // Arbeitsbild (Mühlenflügel): Varianten der Reihe nach, nur weiter, solange gearbeitet wird; sonst stehen sie still
    if (def.workAnim && sp.frames > 1 && b.built >= 1) {
      const ph = Math.floor((this.workPhase.get(b.id) ?? 0) * def.workAnim.fps);
      const idle = def.workAnim.idle;
      // mit Ruhebild (Schmelzhütte: kalter Ofen): ruhend dieses, bei der Arbeit reihum die übrigen Varianten
      frame = idle === undefined ? ph % sp.frames : b.proc?.busy ? (idle + 1 + (ph % (sp.frames - 1))) % sp.frames : idle;
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
    const it = this.newItem(u0, u1, v0, v1, false, false);
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    const [X, Y] = this.scr(cx, cy);
    const [ax, ay] = bs.anchor;
    const tint = opt.danger === b.id ? 0xff8070 : opt.highlight === b.id ? 0xfff2c8 : 0xffffff;
    // Innenansicht: Schnittbild, Inhalt, niedrige Vorderwände; darüber das Außenbild mit Deckkraft 1 − f
    const f = b.built >= 1 && spr ? Math.max(0, Math.min(1, opt.interiors?.get(b.id) ?? 0)) : 0;
    let open = 0;
    if (f > 0) {
      const inner = this.interiorFrame(b, spr!.frame);
      const view = viewOf(b.o, this.r);
      const tex = inner && bs.texture(inner.key, view, inner.frame, b.team);
      if (inner && tex) {
        open = f;
        const p = this.part(it, tex, X, Y, ax, ay, { tint });
        if (f >= 0.5) this.occluder(p, inner.key, view, inner.frame);
        this.interiorContents(it, b, opt, f >= 0.5);
        const ft = bs.texture(inner.key, view, inner.frame, b.team, "front");
        if (ft) this.part(it, ft, X, Y, ax, ay, { tint });
      }
    }
    // Baustelle in Bauphasen (siteParts), fertiges Gebäude als Außenbild
    if (spr && b.built < 1) this.siteParts(it, b, spr, X, Y, tint, opt);
    else if (spr) {
      for (const [key, o] of spr.keys) {
        const view = viewOf(o, this.r);
        const tex = bs.texture(key, view, spr.frame, b.team);
        if (!tex) continue;
        const frame = Math.min(spr.frame, bs.get(key)!.frames - 1);
        const hit = this.hit("building", b.id, b.team, "b", key, view, frame, X - ax, Y - ay);
        // ganz offen: Außenbild unsichtbar, bleibt aber Treffer (gleiche Fläche, kein Flackern beim Überfahren)
        const p = this.part(it, tex, X, Y, ax, ay, { tint, hit, alpha: 1 - open });
        if (open < 0.5) this.occluder(p, key, view, frame);
      }
    }
    // Ausbau: die nächste Stufe wächst wie eine Baustelle über dem stehenden Gebäude (Umriss im Gerüstton, von unten
    // nach oben aufgedeckt); das Material liegt an den vorderen Ecken neben der Tür (upgradeItems)
    if (b.upgrade && b.built >= 1 && open < 0.5) {
      const key = this.bs?.has(levelDef(b.key, b.upgrade.level).sprite) ? levelDef(b.key, b.upgrade.level).sprite : null;
      if (key) {
        const view = viewOf(b.o, this.r);
        const tex = bs.texture(key, view, 0, b.team);
        const bb = bs.get(key)!.bbox[view]?.[0];
        if (tex) this.part(it, tex, X, Y, ax, ay, { alpha: 0.32, tint: SITE_TINT });
        if (bb && b.upgrade.t > 0) {
          const q = Math.round(b.upgrade.t * 48) / 48;
          const cut = Math.round(bb.y1 - q * (bb.y1 - bb.y0));
          const crop = bs.crop(key, view, 0, b.team, cut, bs.cell[1]);
          if (crop) this.part(it, crop, X, Y, ax, ay - cut, { tint });
        }
      }
    }
    // Figuren auf Wehrgang, Turm und Treppe, dann das Vorderteil. Im Schnittbild (Bergfried) fehlt die Plattform:
    // dann keine Figuren oben und kein äußeres Vorderteil.
    const on = open < 0.5 ? this.attached.get(b.id) : undefined;
    if (on && on.length) {
      if (on.length > 1) on.sort((p, q) => {
        const [pu, pv] = toView(p.x, p.y, this.r, this.W, this.H), [qu, qv] = toView(q.x, q.y, this.r, this.W, this.H);
        return pu + pv - (qu + qv) || p.z - q.z;
      });
      for (const a of on) this.figureParts(it, a.u, a.x, a.y, a.z, opt);
      if (spr && b.built >= 1) for (const [key, o] of spr.keys) {
        const ft = bs.texture(key, viewOf(o, this.r), spr.frame, b.team, "front");
        if (ft) this.part(it, ft, X, Y, ax, ay, { tint, alpha: 1 - open });
      }
    }
    const before = this.nItems;
    this.closeItem(it);
    // offen: kein Rauch aus dem (nicht gezeichneten) Schornstein; Werkstätten rauchen nur, solange gearbeitet wird
    const fire = !def.production || !!b.proc?.busy;
    if (spr && b.built >= 1 && this.nItems === before && open < 0.5 && fire) this.chimneys(b, spr.keys[0][0], cx, cy);
    // Ohne jedes Lagerbild bleiben wenigstens die Warenstapel sichtbar (Ersatzstapel, falls auch die fehlen)
    if (def.storage && !spr) this.stackItems(b);
    if (b.built < 1) this.siteItems(b);
    else if (b.upgrade) this.upgradeItems(b);
    else if (b.proc) this.procItems(b);
  }

  /** Arbeitszeit der Werkstätten mit Arbeitsbild weiterzählen (nur bei laufendem Arbeitsgang). */
  private advanceWork(state: SimState, time: number): void {
    const dt = this.lastTime < 0 ? 0 : Math.max(0, Math.min(0.5, time - this.lastTime));
    this.lastTime = time;
    for (const b of state.buildings) {
      if (!b.proc?.busy || !BUILDINGS[b.key].workAnim) continue;
      this.workPhase.set(b.id, (this.workPhase.get(b.id) ?? 0) + dt);
    }
    if (this.workPhase.size > state.buildings.length) for (const id of [...this.workPhase.keys()]) if (!this.byId.has(id)) this.workPhase.delete(id);
  }

  /**
   * Verarbeitung (ADR 0011): Eingangspuffer und Ausgabestapel als Warenstapel an production.inputPiles bzw. outputPiles
   * (Modellachsen, gedreht wie der Grundriss), Stufe 1–4 nach Menge im Verhältnis zur Obergrenze aus den Daten
   * (Rezeptmenge × buffer bzw. × stock). Eigene Objekte in der Tiefensortierung wie die Baustoffe einer Baustelle.
   */
  private procItems(b: Building): void {
    const pd = BUILDINGS[b.key].production, p = b.proc;
    if (!pd || !p) return;
    const r = RECIPES[p.recipe];
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    const pile = (g: Good, n: number, cap: number, at: readonly [number, number]) => {
      if (n <= 0) return;
      const [dx, dy] = modelToWorld(at[0], at[1], b.o);
      const x = cx + dx, y = cy + dy;
      const [cu, cv] = toView(x, y, this.r, this.W, this.H);
      const it = this.newItem(cu - 0.3, cu + 0.3, cv - 0.3, cv + 0.3, false, false, 0.05);
      const [X, Y] = this.scr(x, y);
      const st = this.stackTexture(g, pileLevel(n, cap), b.o);
      this.part(it, st.tex, X, Y, st.px, st.py);
      this.closeItem(it);
    };
    (Object.keys(r.inputs) as Good[]).forEach((g, i) => pile(g, p.in[g] ?? 0, (r.inputs[g] ?? 1) * pd.buffer, pd.inputPiles[i % pd.inputPiles.length]));
    (Object.keys(r.outputs) as Good[]).forEach((g, i) => pile(g, p.out[g] ?? 0, (r.outputs[g] ?? 1) * pd.stock, pd.outputPiles[i % pd.outputPiles.length]));
  }

  /** Schnittbild und Variante: Wohnhaus nach Bewohnern, sonst wie das Außenbild (Hof, Füllstand vor dem Tor). */
  private interiorFrame(b: Building, outer: number): { key: string; frame: number } | null {
    const def = levelDef(b.key, b.level ?? 1);
    const key = def.interior?.sprite;
    if (!key || !this.bs!.has(key)) return null;
    const frames = this.bs!.get(key)!.frames;
    // Bergfried: Variante 1 = der Gelehrte sitzt am Pult, solange geforscht wird (Waren angeliefert, Zeit läuft)
    const want = def.seat ? (this.researching ? 1 : 0)
      : def.housing ? this.residents.get(b.id) ?? 0 : def.storage ? fillFrame(b, frames) : outer;
    return { key, frame: Math.max(0, Math.min(frames - 1, want)) };
  }

  /** Bevölkerung der Reihe nach (Gebäude-ID) auf die fertigen eigenen Wohnhäuser verteilen. */
  private countResidents(state: SimState): void {
    this.residents.clear();
    let left = state.population;
    for (const b of state.buildings) {
      // Der Bergfried bringt eigenen Wohnraum (Burgherr, Gesinde); verteilt wird auf die Wohnhäuser
      const cap = BUILDINGS[b.key].seat ? 0 : BUILDINGS[b.key].housing;
      if (!cap || b.team !== 0 || b.built < 1) continue;
      const n = Math.max(0, Math.min(cap, left));
      this.residents.set(b.id, n);
      left -= n;
    }
  }

  /**
   * Inhalt im Schnittbild, von hinten nach vorn: Warenstapel je Fach, Figuren im Inneren, Rekrut in der Ausbildung.
   * Solange das Außenbild noch überwiegt (shown = false), bekommen Figuren drinnen keine Silhouette.
   */
  private interiorContents(it: Item, b: Building, opt: SceneOptions, shown: boolean): void {
    const def = BUILDINGS[b.key];
    const list = this.contents;
    list.length = 0;
    const depth = (x: number, y: number) => { const [u, v] = toView(x, y, this.r, this.W, this.H); return u + v; };
    const st = def.storage;
    if (st) {
      b.slots.forEach((s, k) => {
        if (!s.good || s.amount <= 0 || k >= st.shelves.length) return;
        const level = Math.max(1, Math.min(4, Math.ceil((s.amount / st.perSlot) * 4)));
        const [x, y] = shelfWorld(b.key, b.x, b.y, b.o, k);
        const good = s.good;
        list.push({ d: depth(x, y), draw: () => {
          const [X, Y] = this.scr(x, y);
          const tx = this.stackTexture(good, level, b.o);
          this.part(it, tx.tex, X, Y, tx.px, tx.py);
        } });
      });
    }
    for (const a of this.insideUnits.get(b.id) ?? []) {
      list.push({ d: depth(a.x, a.y) + 0.01, draw: () => {
        const n0 = this.nParts;
        this.figureParts(it, a.u, a.x, a.y, a.z, opt);
        if (!shown) for (let i = n0; i < this.nParts; i++) this.parts[i].unit = null;
      } });
    }
    const spot = def.interior?.spots?.[0];
    if (b.training && spot) {
      const [cx, cy] = center(b.key, b.x, b.y, b.o);
      const [dx, dy] = modelToWorld(spot[0], spot[1], b.o);
      const x = cx + dx, y = cy + dy;
      list.push({ d: depth(x, y), draw: () => this.traineeParts(it, b, x, y) });
    }
    list.sort((p, q) => p.d - q.d);
    for (const e of list) e.draw();
    list.length = 0;
  }

  /** Rekrut in der Ausbildung: die künftige Einheit übt zum Strohmann hin (Modell +x), Schützen spannen den Bogen. */
  private traineeParts(it: Item, b: Building, x: number, y: number): void {
    const fs = this.fs, tr = b.training;
    if (!fs || !tr) return;
    const want = UNITS[tr.unit].sprite;
    const key = fs.has(want) ? want : fs.has("tageloehner") ? "tageloehner" : null;
    if (!key) return;
    const [fx, fy] = modelToWorld(1, 0.35, b.o);
    const anim: AnimKey = (UNITS[tr.unit].range ?? 0) > 1.5 ? "schiessen" : "angriff";
    const { frame } = this.figFrame(key, { anim, animT: tr.t } as Unit);
    const tex = fs.texture(key, figureDir(fx, fy, this.r), frame, b.team);
    if (!tex) return;
    const [X, Y] = this.scr(x, y);
    this.part(it, tex, X, Y, fs.anchor[0], fs.anchor[1]);
  }

  /** Abriss und Zerstörung erkennen: verschwundene Gebäude (nicht ersetzte) lassen kurz Grundmauern und Staub zurück. */
  private trackDebris(state: SimState, time: number): void {
    if (this.prevSeen) for (const [id, p] of this.prevB) {
      if (this.byId.has(id)) continue;
      if (state.tiles[p.y * state.w + p.x]?.building) continue; // ersetzt (Mauer unter einem Tor)
      if (p.built <= 0) continue; // nur abgesteckt: Pflöcke ziehen hinterlässt keinen Schutt
      this.debris.push({ id, key: p.key, x: p.x, y: p.y, o: p.o, built: p.built, t0: time });
    }
    this.prevB.clear();
    for (const b of state.buildings) this.prevB.set(b.id, { key: b.key, x: b.x, y: b.y, o: b.o, built: b.built });
    this.prevSeen = true;
    this.debris = this.debris.filter((d) => time - d.t0 >= 0 && time - d.t0 < DEBRIS_SECONDS);
  }

  private debrisItem(d: { id: number; key: BuildingKey; x: number; y: number; o: number; built: number; t0: number }, time: number): void {
    const bs = this.bs;
    if (!bs) return;
    const t = time - d.t0;
    const fp = BUILDINGS[d.key].footprint;
    const [w, h] = d.o % 2 === 0 ? fp : [fp[1], fp[0]];
    const [cx, cy] = center(d.key, d.x, d.y, d.o);
    const [X, Y] = this.scr(cx, cy);
    const [u0, u1, v0, v1] = this.box(d.x, d.y, d.x + w, d.y + h);
    if (t < RUBBLE_LIFE) {
      let e = this.rubblePool[this.rubble.length];
      if (!e) { e = { x: 0, y: 0, w: 0, t: 0, seed: 0 }; this.rubblePool.push(e); }
      e.x = X; e.y = Y; e.w = Math.max(w, h) * 18; e.t = t; e.seed = d.id;
      this.rubble.push(e);
    }
    const key = BUILDINGS[d.key].construction.ground;
    const tex = bs.has(key) ? bs.texture(key, viewOf(d.o, this.r), 1, 0) : null;
    if (!tex) return;
    const it = this.newItem(u0, u1, v0, v1, true, false);
    const fade = t < DEBRIS_SECONDS - 1.5 ? 1 : (DEBRIS_SECONDS - t) / 1.5;
    this.part(it, tex, X, Y, bs.anchor[0], bs.anchor[1], { alpha: Math.max(0, fade), tint: 0xb8b0a4 });
    this.closeItem(it);
  }

  /** Trefferpunkt eines hämmernden Bauarbeiters (vor ihm, in Hammerhöhe) und das Material der Baustelle daneben. */
  private strikeAt(u: Unit, state: SimState, alpha: number): void {
    const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
    const [X, Y] = this.scr(x, y);
    const v = this.view;
    if (X < v.x0 || X > v.x1 || Y < v.y0 || Y > v.y1) return;
    let mat = 0;
    const tx = Math.floor(x), ty = Math.floor(y);
    for (let dy = -1; dy <= 1 && !mat; dy++) for (let dx = -1; dx <= 1 && !mat; dx++) {
      const b = this.byId.get(state.tiles[(ty + dy) * state.w + tx + dx]?.building ?? 0);
      if (!b || b.built >= 1) continue;
      const cost = BUILDINGS[b.key].cost;
      mat = ((cost.holz ?? 0) > 0 ? 1 : 0) | ((cost.stein ?? 0) > 0 ? 2 : 0);
    }
    if (!mat) mat = 1;
    const [sx, sy] = vecToScreen(u.fx, u.fy, this.r);
    const l = Math.hypot(sx, sy) || 1;
    let e = this.strikePool[this.strikes.length];
    if (!e) { e = { x: 0, y: 0, t: 0, seed: 0, mat: 1, dir: 1 }; this.strikePool.push(e); }
    e.x = Math.round(X + (sx / l) * 7); e.y = Math.round(Y + (sy / l) * 4 - 4);
    e.t = u.animT; e.seed = u.id; e.mat = mat as DustMat; e.dir = sx >= 0 ? 1 : -1;
    this.strikes.push(e);
  }

  /** Schornsteinöffnungen eines sichtbaren Gebäudes als Rauchquellen (gleiche Drehung wie Grundriss und Sprite). */
  private chimneys(b: Building, key: string, cx: number, cy: number): void {
    const list = CHIMNEYS[key];
    if (!list) return;
    list.forEach((m, k) => {
      const [wx, wy, z] = chimneyWorld(m, b.o);
      const [X, Y] = this.scr(cx + wx, cy + wy, z);
      let e = this.emitterPool[this.emitters.length];
      if (!e) { e = { x: 0, y: 0, seed: 0 }; this.emitterPool.push(e); }
      e.x = X; e.y = Y; e.seed = b.id * 7 + k;
      this.emitters.push(e);
    });
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

  /** Ersatz ohne jedes Lagerbild: Stapel als eigene Objekte an den Fächern (immer sichtbar). */
  private stackItems(b: Building): void {
    const st = BUILDINGS[b.key].storage;
    if (!st) return;
    b.slots.forEach((s, k) => {
      if (!s.good || k >= st.shelves.length) return;
      const level = s.amount <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((s.amount / st.perSlot) * 4)));
      if (level === 0 && !this.bs!.has(GOODS[s.good].stack)) return;
      const [x, y] = shelfWorld(b.key, b.x, b.y, b.o, k);
      const [cu, cv] = toView(x, y, this.r, this.W, this.H);
      const it = this.newItem(cu - 0.45, cu + 0.45, cv - 0.45, cv + 0.45);
      const [X, Y] = this.scr(x, y);
      const tx = this.stackTexture(s.good, level, b.o);
      this.part(it, tx.tex, X, Y, tx.px, tx.py);
      this.closeItem(it);
    });
  }

  /**
   * Baustelle in Bauphasen (Daten: BUILDINGS[key].construction, Ablauf in docs/decisions/0009-baustellen.md):
   * abgesteckt (Pflöcke und Schnur, solange noch nichts verbaut ist) → Fundament → Gerüst und Bau, der von unten nach
   * oben wächst (bei Mauern, Tor, Treppe und Turm in sichtbaren Lagen). Reihenfolge im Objekt: Boden, Gerüst (ganz),
   * aufgedeckter Bau, Vorderteil des Gerüsts. Bei Maus/Auswahl zeigt ein blasser Umriss, was hier entsteht.
   */
  private siteParts(it: Item, b: Building, spr: { keys: [string, number][]; frame: number }, X: number, Y: number, tint: number, opt: SceneOptions): void {
    const bs = this.bs!;
    const [ax, ay] = bs.anchor;
    const con = BUILDINGS[b.key].construction;
    const [key0, o0] = spr.keys[0];
    const view0 = viewOf(o0, this.r);
    const frame0 = Math.min(spr.frame, bs.get(key0)!.frames - 1);
    // Treffer: die Fläche des fertigen Baus (so ist die Baustelle dort anklickbar, wo das Gebäude entsteht)
    const hit = this.hit("building", b.id, b.team, "b", key0, view0, frame0, X - ax, Y - ay);
    const sview = viewOf(b.o, this.r);
    const ground = bs.has(con.ground) ? bs.texture(con.ground, sview, b.built > 0 ? 1 : 0, b.team) : null;
    if (ground) this.part(it, ground, X, Y, ax, ay, { tint, hit });
    const plan = opt.highlight === b.id || opt.danger === b.id;
    for (const [key, o] of spr.keys) {
      const tex = bs.texture(key, viewOf(o, this.r), spr.frame, b.team);
      if (tex && (plan || !ground)) this.part(it, tex, X, Y, ax, ay, { alpha: plan ? 0.3 : 0.18, tint: opt.danger === b.id ? tint : SITE_TINT, hit: ground ? null : hit });
    }
    const grow = siteGrowth(b.built, con.foundation, con.courses);
    if (grow <= 0) return;
    const bb0 = bs.get(key0)!.bbox[view0]?.[frame0];
    const cut0 = bb0 ? Math.round(bb0.y1 - grow * (bb0.y1 - bb0.y0)) : bs.cell[1];
    const sc = con.scaffold && bs.has(con.scaffold) ? con.scaffold : null;
    // Gerüst steht etwas höher als der Bau gerade ist (die nächste Lage wird von dort aus gemauert)
    const scut = Math.max(0, cut0 - SCAFFOLD_LEAD);
    if (sc) {
      const t = bs.crop(sc, sview, 0, b.team, scut, bs.cell[1]);
      if (t) this.part(it, t, X, Y, ax, ay - scut, { tint });
    }
    for (const [key, o] of spr.keys) {
      const view = viewOf(o, this.r);
      const frame = Math.min(spr.frame, bs.get(key)!.frames - 1);
      const bb = bs.get(key)!.bbox[view]?.[frame];
      if (!bb) continue;
      const cut = Math.round(bb.y1 - grow * (bb.y1 - bb.y0));
      const crop = bs.crop(key, view, spr.frame, b.team, cut, bs.cell[1]);
      if (crop) this.part(it, crop, X, Y, ax, ay - cut, { tint });
    }
    if (sc) {
      const t = bs.crop(sc, sview, 0, b.team, scut, bs.cell[1], "front");
      if (t) this.part(it, t, X, Y, ax, ay - scut, { tint });
    }
  }

  /**
   * Gelieferte Baustoffe auf der Baustelle: je Ware ein Stapel an ihrem Ablageplatz im Grundriss (construction.piles),
   * so groß wie der Rest (Stufe 1–4 von dem, was insgesamt davon verbaut wird). Eigene Objekte in der Tiefensortierung:
   * vor dem Bau sichtbar, hinter ihm verdeckt.
   */
  private siteItems(b: Building): void {
    const def = BUILDINGS[b.key];
    const piles = def.construction.piles;
    if (!piles.length) return;
    const goods = (Object.keys(def.cost) as (Good | "gold")[]).filter((g): g is Good => g !== "gold");
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    goods.forEach((g, k) => {
      const n = b.site[g] ?? 0;
      if (n <= 0) return;
      const [px, py] = piles[k % piles.length];
      const [dx, dy] = modelToWorld(px, py, b.o);
      const x = cx + dx, y = cy + dy;
      const [cu, cv] = toView(x, y, this.r, this.W, this.H);
      const it = this.newItem(cu - 0.3, cu + 0.3, cv - 0.3, cv + 0.3, false, false, 0.05);
      const [X, Y] = this.scr(x, y);
      const level = pileLevel(n, def.cost[g] ?? n);
      const st = this.sitePileTexture(g, level, b.o);
      this.part(it, st.tex, X, Y, st.px, st.py);
      this.closeItem(it);
    });
  }

  /**
   * Ausbau (Bergfried): Das Gebäude steht und bleibt in Betrieb. Das gelieferte Material liegt im Grundriss an den
   * vorderen Ecken links und rechts der Tür (ADR 0010: nicht auf der Zugangskachel, sonst liefen die Träger durch die
   * Stapel), als Baustoffstapel im Verhältnis zu den Kosten der neuen Stufe.
   */
  private upgradeItems(b: Building): void {
    const goods = (Object.keys(b.site) as Good[]).filter((g) => (b.site[g] ?? 0) > 0);
    if (!goods.length || !b.upgrade) return;
    const cost = BUILDINGS[b.key].levels?.[b.upgrade.level - 1]?.upgrade?.cost ?? {};
    const [fw, fd] = BUILDINGS[b.key].footprint;
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    goods.forEach((g, k) => {
      const side = k % 2 ? 1 : -1, row = Math.floor(k / 2);
      const [dx, dy] = modelToWorld(side * (fw / 2 - 0.5), -(fd / 2 - 0.5) + row * 0.7, b.o);
      const x = cx + dx, y = cy + dy;
      const [cu, cv] = toView(x, y, this.r, this.W, this.H);
      const it = this.newItem(cu - 0.3, cu + 0.3, cv - 0.3, cv + 0.3, false, false, 0.05);
      const [X, Y] = this.scr(x, y);
      const n = b.site[g] ?? 0;
      const st = this.sitePileTexture(g, pileLevel(n, cost[g] ?? n), b.o);
      this.part(it, st.tex, X, Y, st.px, st.py);
      this.closeItem(it);
    });
  }

  private sitePileTexture(good: Good, level: number, o: number): { tex: Texture; px: number; py: number } {
    const key = GOODS[good].sitePile;
    const bs = this.bs!;
    if (key && bs.has(key)) {
      const tex = bs.texture(key, viewOf(o, this.r), level, 0);
      if (tex) return { tex, px: bs.anchor[0], py: bs.anchor[1] };
    }
    if (key) warnOnce(`Sprite „${key}“ fehlt im Gebäudeblatt, Ersatz: Lagerstapel`);
    return this.stackTexture(good, level, o);
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

  /** Gruppenvorschau: von hinten nach vorn (Ansicht u + v, dann u) deckend in ghostGroup. */
  private groupGhosts(): void {
    this.groupPool.reset();
    const bs = this.bs;
    const list = this.groupList;
    if (bs && list.length) {
      const key = (g: Ghost) => {
        const [u, v] = toView(g.cx, g.cy, this.r, this.W, this.H);
        return [u + v, u];
      };
      const keyed = list.map((g) => ({ g, k: key(g) }));
      keyed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1]);
      for (const { g } of keyed) {
        const tex = bs.texture(g.key, viewOf(g.o, this.r), g.frame);
        if (!tex) continue;
        const [X, Y] = this.scr(g.cx, g.cy);
        const s = this.groupPool.next(tex);
        s.pivot.set(bs.anchor[0], bs.anchor[1]);
        s.position.set(Math.round(X), Math.round(Y));
        if (g.tint !== 0xffffff) s.tint = g.tint;
      }
    }
    this.groupPool.finish();
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
    // Sprite nach Art des Brockens (RESOURCE_TAGS: Stein „fels“, Erz „fels_erz“), Ersatz der Steinbrocken
    const want = RESOURCE_TAGS[k.kind ?? "rock"].sprite ?? "fels";
    const key = bs?.has(want) ? want : "fels";
    if (want !== key) warnOnce(`Sprite „${want}“ fehlt im Gebäudeblatt, Ersatz: „fels“`);
    if (bs?.has(key)) {
      const sp = bs.get(key)!;
      const stage = Math.max(0, Math.min(sp.frames - 1, Math.floor(used * sp.frames)));
      const view = viewOf(hash4(k.id), this.r);
      const tex = bs.texture(key, view, stage);
      if (tex) this.occluder(this.part(it, tex, X, Y, bs.anchor[0], bs.anchor[1]), key, view, stage);
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
        if (sp && sp.pixels.alpha(h.frame * cw + lx, h.view * ch + ly) > SOLID_ALPHA) return h;
      }
    }
    return null;
  }
}

/** Ausrichtung eines Tors: gemeinsame Regel aus src/sim/geom.ts (auch von der Simulation benutzt). */
export { gateOrientation };
