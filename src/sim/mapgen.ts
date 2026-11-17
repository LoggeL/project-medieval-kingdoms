/**
 * Kartengenerator (deterministisch aus dem Seed).
 *
 * Aufbau der Standardkarte (Welt-Achsen, x nach Osten, y nach Süden im Sinne von geom.NEIGHBOURS):
 *   Westen  dichter Wald (Laub und Tannen) auf Waldboden, ein Waldweg führt hindurch zum Kartenrand
 *   Norden  Felsfeld mit Felsbrocken (je 8–16 Blöcke), ein Weg führt hinunter zur Hauptstraße; am Südwestrand des
 *           Felsfelds einige rostrote Erzbrocken (je 18–28 Erz) für die Erzmine
 *   Mitte   Wiesen und Gras, das Startlager an der Straße, viel Baufläche zwischen Wald und Fels
 *   Osten   Fluss von Nord nach Süd (unpassierbar) mit einer Furt, über die die Straße zum Ostrand führt
 * Die Angreifer kommen von Osten (dem Wald abgewandt) über die Furt: ein natürlicher Engpass für Mauern.
 *
 * Landschaft nach BRIEF §3 (ADR 0012, Lage in LANDSCHAFT): Über den Grundaufbau legt landscape() mit eigenem Zufall
 * aus dem Seed ein Felsmassiv im Nordwesten (Gebirge, nicht begehbar) mit Geröllhalde und Hügelsaum, zwei Hügelkuppen
 * mit Felskopf, einen See mit Sandufer am Waldrand, die Küste im Süden, Sumpf an der Flussmündung und fruchtbaren Boden
 * in den Auen. Der Grundaufbau zieht dabei genau dieselben Zufallszahlen wie vorher; um die Startsiedlung, an Straße,
 * Furt und Steinbruchweg bleibt alles unverändert.
 */
import { LANDSCHAFT, STEIN, type TerrainKey } from "../data";
import { nextRandom, seedState } from "./rng";
import type { Rock, Tile, Tree } from "./types";

export interface MapResult {
  tiles: Tile[];
  trees: Tree[];
  rocks: Rock[];
  /**
   * Bäume und Brocken der Landschaft (ADR 0012) ohne ID: createGame vergibt sie erst nach der Startaufstellung, damit
   * Gebäude und Figuren dieselben IDs behalten wie auf der Karte ohne Landschaft.
   */
  late?: (Tree | Rock)[];
  /** Linke obere Ecke des Startlagers (Ausrichtung 0, Eingang an der Straße). */
  lager: [number, number];
  camp: [number, number];
  entry: [number, number];
  raidSpawn: [number, number];
}

type Rand = () => number;

function valueNoise(W: number, H: number, cell: number, rand: Rand): Float32Array {
  const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2;
  const g = Array.from({ length: gw * gh }, rand);
  const out = new Float32Array(W * H);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = sm(fx - ix), ty = sm(fy - iy);
    const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
    out[y * W + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  return out;
}

export function generateMap(W: number, H: number, rand: Rand, nextId: () => number, seed = 1): MapResult {
  const n1 = valueNoise(W, H, 7, rand), n2 = valueNoise(W, H, 4, rand), n3 = valueNoise(W, H, 11, rand);
  const roadY = Math.floor(H * 0.5) + 2;
  const lager: [number, number] = [Math.floor(W * 0.45) - 1, roadY - 3];
  const quarryX = Math.round(W * 0.56);
  const fels = { cx: W * 0.56, cy: H * 0.14, rx: W * 0.15, ry: H * 0.11 };
  const terrain: TerrainKey[] = new Array(W * H);
  const forestEdge = (y: number) => W * 0.22 + (n3[y * W] - 0.5) * 8;
  const riverX = (y: number) => W * 0.8 + Math.sin((y / H) * Math.PI * 2.2) * W * 0.035 + (n3[y * W + W - 1] - 0.5) * 2;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let t: TerrainKey = n1[i] > 0.6 ? "wiese" : "gras";
    if (x < forestEdge(y) + (n2[i] - 0.5) * 3) t = "waldboden";
    const e = ((x - fels.cx) / fels.rx) ** 2 + ((y - fels.cy) / fels.ry) ** 2 + (n2[i] - 0.5) * 0.7;
    if (e < 1) t = "fels";
    if (Math.abs(x + 0.5 - riverX(y)) < 1.6) t = Math.abs(y - roadY) <= 1 ? "erde" : "wasser"; // Furt
    if (y === roadY && t !== "wasser") t = "erde";
    terrain[i] = t;
  }
  // Weg vom Felsfeld zur Straße (endet am Fels)
  for (let y = roadY - 1; y >= 0; y--) {
    const i = y * W + quarryX;
    if (terrain[i] === "fels" || terrain[i] === "wasser") break;
    terrain[i] = "erde";
  }

  const tiles: Tile[] = terrain.map((t) => ({ terrain: t, variant: Math.floor(rand() * 4), building: 0 }));

  // Bäume: dichter Wald im Westen, ein paar einzelne Bäume in der Ebene
  const trees: Tree[] = [];
  const [lx, ly] = lager;
  const clear = (x: number, y: number) => Math.max(Math.abs(x - (lx + 1)), Math.abs(y - (ly + 1))) <= 7;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = terrain[i];
    const r = rand(), r2 = rand();
    let place = false;
    if (t === "waldboden") place = r < 0.45 + (n2[i] - 0.5) * 0.3;
    else if ((t === "gras" || t === "wiese") && !clear(x, y) && Math.abs(y - roadY) > 1 && Math.abs(x + 0.5 - riverX(y)) > 3) place = r < 0.012;
    if (!place) continue;
    const tanne = n1[i] > 0.45 ? r2 < 0.65 : r2 < 0.25;
    trees.push({
      id: nextId(), x, y, kind: tanne ? "tanne" : "baum", variant: Math.floor(rand() * 2),
      state: "stehend", progress: 0, fallX: 0, fallY: 0, logs: 0, reservedBy: 0,
    });
  }

  // Felsbrocken im Inneren des Felsfelds, mit Abstand zueinander
  const rocks: Rock[] = [];
  const isFels = (x: number, y: number) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && terrain[y * W + x] === "fels";
  const cand: [number, number][] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let inner = true;
    for (let dy = -1; dy <= 1 && inner; dy++) for (let dx = -1; dx <= 1; dx++) if (!isFels(x + dx, y + dy)) { inner = false; break; }
    if (inner) cand.push([x, y]);
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const maxRocks = Math.max(8, Math.round((W * H) / 4096 * 13));
  for (const [x, y] of cand) {
    if (rocks.length >= maxRocks) break;
    if (rocks.some((r) => Math.max(Math.abs(r.x - x), Math.abs(r.y - y)) < 3)) continue;
    const max = STEIN.field[0] + Math.floor(rand() * (STEIN.field[1] - STEIN.field[0] + 1));
    rocks.push({ id: nextId(), x, y, amount: max, max, reservedBy: 0 });
  }

  // Erzvorkommen (ADR 0014): ein paar Erzbrocken am Südwestrand des Felsfelds (zur Siedlung hin), höchstens drei Felder vom Bauland, damit
  // eine Erzmine sie erreicht. Eigener Zufall aus dem Rauschen: Die Zufallsfolge der übrigen Karte bleibt unverändert.
  let oreSeed = (Math.floor(n3[0] * 0x7fffffff) | 1) >>> 0;
  const oreRand = () => ((oreSeed = (Math.imul(oreSeed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const nearLand = (x: number, y: number) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!isFels(x + dx, y + dy)) return true;
    return false;
  };
  const maxOre = Math.max(3, Math.round((W * H) / 4096 * 5));
  let ores = 0;
  for (const [x, y] of cand) {
    if (ores >= maxOre) break;
    if (x > fels.cx || y < fels.cy - 0.3 * fels.ry || !nearLand(x, y)) continue;
    if (rocks.some((r) => Math.max(Math.abs(r.x - x), Math.abs(r.y - y)) < 2)) continue;
    const max = 18 + Math.floor(oreRand() * 11); // ergiebiger als Stein: Erz ist knapp und geht in Eisen 2 : 1 auf
    rocks.push({ id: nextId(), x, y, amount: max, max, reservedBy: 0, kind: "erz" });
    ores++;
  }

  const map: MapResult = {
    tiles, trees, rocks, lager,
    camp: [lx + 5, roadY + 2],
    entry: [0, roadY],
    raidSpawn: [W - 1, roadY],
  };
  landscape(map, W, H, seed, { roadY, quarryX, riverX });
  return map;
}

// ---------------------------------------------------------------- Landschaft (ADR 0012)

/** Kacheln, die zum Gebirge zählen oder außerhalb der Karte liegen (Höhenklasse der Massivteile, Halde). */
export function isMountain(tiles: Tile[], W: number, H: number, x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= W || y >= H || tiles[y * W + x].terrain === "gebirge";
}

/**
 * Höhenklasse eines Gebirgsfelds für die Darstellung: 0 Rand (an Nicht-Gebirge), 1 Hang, 2 Gipfel (Abstand ≥ 3 zum
 * Rand). Außerhalb der Karte zählt als Gebirge, das Massiv läuft über den Kartenrand weiter.
 */
export function mountainClass(tiles: Tile[], W: number, H: number, x: number, y: number): number {
  for (let r = 1; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (!isMountain(tiles, W, H, x + dx, y + dy)) return r - 1;
    }
  }
  return 2;
}

/** Nicht 8-benachbart zu einer anderen Stelle der Liste. */
function spaced(list: { x: number; y: number }[], x: number, y: number, d: number): boolean {
  return !list.some((r) => Math.max(Math.abs(r.x - x), Math.abs(r.y - y)) < d);
}

function landscape(
  map: MapResult, W: number, H: number, seed: number,
  base: { roadY: number; quarryX: number; riverX: (y: number) => number },
): void {
  const late: (Tree | Rock)[] = map.late = [];
  const L = LANDSCHAFT;
  const holder = { rng: seedState(seed) ^ 0x2c1b3c6d };
  const lr = () => nextRandom(holder);
  const m1 = valueNoise(W, H, 6, lr), m2 = valueNoise(W, H, 3, lr), m3 = valueNoise(W, H, 5, lr);
  const { tiles } = map;
  const [lx, ly] = map.lager;
  const { roadY, quarryX, riverX } = base;
  // Startsiedlung (Kornkammer, Bergfried, Lagerhaus nebeneinander), Straße, Steinbruchweg und Fluss bleiben unberührt
  const sx = lx - 3, sy = ly + 1;
  const nearStart = (x: number, y: number) => Math.max(Math.abs(x - sx) - 3, Math.abs(y - sy));
  const guarded = (x: number, y: number) => {
    if (nearStart(x, y) <= L.schutz) return true;
    if (Math.abs(y - roadY) <= 1) return true;
    const t = tiles[y * W + x].terrain;
    return t === "erde" || t === "wasser" || x === quarryX;
  };
  const set = (x: number, y: number, t: TerrainKey) => { if (!guarded(x, y)) tiles[y * W + x].terrain = t; };
  const open = (x: number, y: number) => { const t = tiles[y * W + x].terrain; return t === "gras" || t === "wiese"; };
  const ell = (x: number, y: number, c: { cx: number; cy: number; rx: number; ry: number }, n = 0) =>
    ((x + 0.5 - c.cx * W) / (c.rx * W)) ** 2 + ((y + 0.5 - c.cy * H) / (c.ry * H)) ** 2 + n;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    // Felsmassiv mit Geröllhalde und Hügelsaum
    const e = ell(x, y, L.massiv, (m2[i] - 0.5) * 0.7);
    if (e < 1) set(x, y, "gebirge");
    else if (e < 1 + L.halde) set(x, y, "fels");
    else if (e < 1 + L.halde + L.huegelsaum && open(x, y)) set(x, y, "huegel");
    // Hügelkuppen mit Felskopf
    for (const k of L.kuppen) {
      const ek = ell(x, y, k, (m3[i] - 0.5) * 0.5);
      if (ek < k.kopf) set(x, y, "fels");
      else if (ek < 1 && open(x, y)) set(x, y, "huegel");
    }
    // See mit Sandufer
    const es = ell(x, y, L.see, (m3[i] - 0.5) * 0.5);
    if (es < 1) set(x, y, "wasser");
    else if (es < 1 + L.see.ufer && tiles[i].terrain !== "fels") set(x, y, "sand");
    // Küste: Meer und Strand im Süden östlich der Mitte (der Fluss mündet hinein)
    if (x >= L.kueste.x0 * W) {
      const shore = H * (1 - L.kueste.tiefe) + (m1[i] - 0.5) * 3;
      if (y >= shore) set(x, y, "wasser");
      else if (y >= shore - L.kueste.strand * H - m2[i] * 1.5 && tiles[i].terrain !== "wasser") set(x, y, "sand");
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!open(x, y) || guarded(x, y)) continue;
    const dr = Math.abs(x + 0.5 - riverX(y));
    // Sumpf an der Flussmündung (nicht direkt am Ufer, dort bleibt ein Streifen festes Land)
    if (y >= L.sumpf.y0 * H && dr > 3 && dr <= L.sumpf.breite * W && m3[i] > L.sumpf.schwelle) { tiles[i].terrain = "sumpf"; continue; }
    // Fruchtbarer Boden in den Auen am Fluss, am See und als Flecken im Grasland
    let nearLake = false;
    for (let dy = -4; dy <= 4 && !nearLake; dy++) for (let dx = -4; dx <= 4; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && tiles[yy * W + xx].terrain === "sand") { nearLake = true; break; }
    }
    const aue = (dr > 2.5 && dr <= L.fruchtbar.auenbreite * W) || nearLake;
    if (m1[i] > (aue ? L.fruchtbar.aue : L.fruchtbar.feld)) tiles[i].terrain = "fruchtbar";
  }

  // Bäume und Felsbrocken des Grundaufbaus, die jetzt auf Gebirge, Fels, Wasser oder Sand stünden, entfallen
  const treeOk = (t: TerrainKey) => t === "waldboden" || t === "gras" || t === "wiese" || t === "huegel" || t === "fruchtbar" || t === "sumpf";
  map.trees = map.trees.filter((t) => treeOk(tiles[t.y * W + t.x].terrain));
  map.rocks = map.rocks.filter((r) => tiles[r.y * W + r.x].terrain === "fels");

  // Neue Bäume: lichte Tannen und Buchen auf den Hügeln, Erlen im Sumpf
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = tiles[y * W + x].terrain, r = lr(), r2 = lr();
    const p = t === "huegel" ? 0.07 : t === "sumpf" ? 0.05 : 0;
    if (r >= p || guarded(x, y) || nearStart(x, y) <= L.schutz + 9 || map.trees.some((tr) => tr.x === x && tr.y === y)) continue;
    const tree: Tree = {
      id: 0, x, y, kind: t === "huegel" && r2 < 0.6 ? "tanne" : "baum", variant: Math.floor(lr() * 2),
      state: "stehend", progress: 0, fallX: 0, fallY: 0, logs: 0, reservedBy: 0,
    };
    map.trees.push(tree);
    late.push(tree);
  }

  // Neue Felsbrocken: auf den Felsköpfen der Kuppen und auf der Geröllhalde am Massiv
  const fels = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && tiles[y * W + x].terrain === "fels";
  const slope = (x: number, y: number) => {
    for (let dy = -STEIN.reach; dy <= STEIN.reach; dy++) for (let dx = -STEIN.reach; dx <= STEIN.reach; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && tiles[yy * W + xx].terrain === "gebirge") return true;
    }
    return false;
  };
  const head = (x: number, y: number) => L.kuppen.some((k) => ell(x, y, k) < 1.2);
  const cand: [number, number, boolean][] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!fels(x, y) || guarded(x, y)) continue;
    const onSlope = slope(x, y);
    if (!onSlope && !head(x, y)) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (fels(x + dx, y + dy)) n++;
    // Felskopf: fast rundum Fels; Halde: am Gebirge, mindestens zwei Felsnachbarn
    const ok = onSlope ? n >= 3 && !isMountain(tiles, W, H, x, y + 1) : n >= 6;
    if (ok) cand.push([x, y, onSlope]);
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(lr() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  // die Halde startet voll (STEIN.slideMax Brocken): nachgerutscht wird erst, wenn dort abgebaut wurde
  let onSlope = 0;
  for (const [x, y, sl] of cand) {
    if (sl && onSlope >= STEIN.slideMax) continue;
    if (!spaced(map.rocks, x, y, sl ? 3 : 2) || map.trees.some((t) => t.x === x && t.y === y)) continue;
    const max = STEIN.amount[0] + Math.floor(lr() * (STEIN.amount[1] - STEIN.amount[0] + 1));
    const rock: Rock = { id: 0, x, y, amount: max, max, reservedBy: 0 };
    map.rocks.push(rock);
    late.push(rock);
    if (sl) onSlope++;
  }
}

/** Leere Wiese (für Tests und Versuche). */
export function emptyMap(W: number, H: number): MapResult {
  const tiles: Tile[] = Array.from({ length: W * H }, () => ({ terrain: "gras" as TerrainKey, variant: 0, building: 0 }));
  const cy = Math.floor(H / 2);
  return { tiles, trees: [], rocks: [], lager: [Math.floor(W / 2) - 1, cy - 1], camp: [Math.floor(W / 2), cy], entry: [0, cy], raidSpawn: [W - 1, cy] };
}
