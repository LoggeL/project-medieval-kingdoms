/**
 * Wirtschaft: Disponent (2× pro Sekunde), Bäume, Zuzug und untätige Tagelöhner.
 *
 * Der Disponent verteilt freie Tagelöhner auf Aufgaben, in dieser Reihenfolge: Werkstätten besetzen,
 * Rekruten (Waffe holen), Baustellen bauen (sobald Material dort liegt), dann abwechselnd Material anliefern (Baustellen und
 * Forschung im Wechsel) und Hofstapel ins Lager tragen. Jede Aufgabe reserviert Ware bzw. Platz sofort, damit nichts doppelt vergeben wird.
 */
import { BUILDINGS, GOODS, LIFE, TUNING, UNITS, equipmentOf, levelDef, storeOf, type AnimKey, type Good, type StoreKey, type TechKey } from "../data";
import { canWork } from "./build";
import { center, entrance } from "./geom";
import { nearestEnemy } from "./combat";
import { goalAround, goalEntrance, goalSlot, tileGoal, travel, unitNode, type TravelGoal } from "./move";
import { fullMessage, hasRoom, reservePut, reserveTake, tidy } from "./storage";
import { haulable, inputAvailable, inputOrders, reserveOutput } from "./production";
import { isSite, levelOf } from "./research";
import { hungerBlocks, immigrationFactor } from "./food";
import type { StorageSlot } from "./types";
import { TPS, face, setAnim, type SBuilding, type SUnit, type World } from "./world";

export const DISPATCH_EVERY = TPS / 2;

export function isFreePeasant(u: SUnit, tick = -1): boolean {
  return !u.dead && u.team === 0 && u.key === "tageloehner" && !u.ai.job && !u.inside && !(tick >= 0 && (u.ai.noJob ?? 0) > tick);
}

/** Kann u das Ziel ohne Einreißen erreichen? (Komponenten-Vorprüfung, keine Suche.) Unbekannt (gesperrtes Startfeld) zählt als ja. */
export function canReach(w: World, u: SUnit, g: TravelGoal): boolean {
  const c = w.nav.comp[0][unitNode(w, u)];
  return c < 0 || w.nav.goalInComp(g, 0, c);
}

export function dispatcher(w: World): void {
  const free = w.s.units.filter((u) => isFreePeasant(u, w.s.tick));
  /** Nächster freier Tagelöhner, der alle Ziele erreicht. */
  const take = (x: number, y: number, ...goals: TravelGoal[]): SUnit | null => {
    let bi = -1, bd = Infinity;
    free.forEach((u, i) => {
      const d = (u.x - x) ** 2 + (u.y - y) ** 2;
      if (d < bd && goals.every((g) => canReach(w, u, g))) { bd = d; bi = i; }
    });
    return bi < 0 ? null : free.splice(bi, 1)[0];
  };
  const own = w.s.buildings.filter((b) => b.team === 0);

  // 1. Werkstätten besetzen
  for (const b of own) {
    const wk = BUILDINGS[b.key].workers;
    if (!wk || b.built < 1) continue;
    while (b.workers.length < wk.count && free.length) {
      const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
      const u = take(ex, ey, goalEntrance(w, b));
      if (!u) break;
      u.ai.job = { k: "employ", b: b.id }; u.order = { t: "job" };
      b.workers.push(u.id);
    }
  }
  // 2. Rekruten: Waffe (und weitere Ausrüstung wie die Rüstung) aus dem Lager holen; alle Stücke werden gleich reserviert
  for (const b of own) {
    if (!free.length) return;
    if (b.built < 1 || !b.queue.length || b.ai.recruit || b.training) continue;
    const unit = b.queue[0];
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    const refs: { b: SBuilding; k: number; good: Good }[] = [];
    let lack: Good | null = null;
    for (const g of equipmentOf(UNITS[unit])) {
      const ref = reserveTake(w, g, cx, cy);
      if (!ref) { lack = g; break; }
      refs.push({ b: ref.b, k: ref.k, good: g });
    }
    const undo = () => { for (const r of refs) unreserveTake(r.b.slots[r.k]); };
    if (lack) { undo(); w.msg(`Keine ${goodName(lack)} im Lager für die Ausbildung.`, "warnung", `waffe-${lack}`, 30, "keine_waffe"); continue; }
    const first = refs[0];
    const u = take(cx, cy, first ? goalSlot(w, first.b, first.k) : goalEntrance(w, b), goalEntrance(w, b));
    if (!u) { undo(); continue; }
    u.ai.job = {
      k: "recruit", b: b.id, from: first?.b.id ?? 0, slot: first?.k ?? 0, good: first?.good, unit, ph: first ? 0 : 1,
      ...(refs.length > 1 ? { more: refs.slice(1).map((r) => ({ from: r.b.id, slot: r.k, good: r.good })) } : {}),
    };
    u.order = { t: "job" };
    b.ai.recruit = u.id; b.ai.recruitPicked = !first; b.ai.recruitGot = 0;
  }
  // 3. Baustellen bauen, sobald Material dort liegt (verbaut wird Stück für Stück, jobs.ts runBuild)
  for (const b of own) {
    if (!free.length) return;
    // Ausbau (Bergfried): erst bauen, wenn alles angeliefert ist; neue Baustelle: sobald Material dort liegt
    if (!isSite(b) || b.ai.builder || (b.upgrade ? Object.keys(b.needs).length > 0 : !canWork(b))) continue;
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    const u = take(cx, cy, goalAround(b));
    if (!u) { if (!BUILDINGS[b.key].road?.bridge) w.msg(`${BUILDINGS[b.key].name}: Die Baustelle ist nicht erreichbar.`, "warnung", `unerreichbar-${b.id}`, 60); continue; }
    u.ai.job = { k: "build", site: b.id, spot: b.ai.nextSpot ?? 0 }; u.order = { t: "job" };
    b.ai.builder = u.id;
  }
  // 4. Anliefern und Abholen abwechselnd. Anlieferungen kommen aus drei Quellen, die sich reihum abwechseln
  //    (Forschung, Baustelle, Verarbeitung, Forschung …), damit keine bei vielen Aufträgen der anderen leer ausgeht.
  //    Baustellen werden in der Reihenfolge des Setzens beliefert, die Verarbeitungsgebäude und beim Abholen die
  //    Ausgabestapel wechseln sich ab.
  type Supply = { site: SBuilding; good: Good; rk?: TechKey; pk?: true };
  const build: Supply[][] = [], study: Supply[] = [], proc: Supply[][] = [];
  for (const b of own) {
    if (!isSite(b)) continue;
    const mine: Supply[] = [];
    for (const [g, n] of Object.entries(b.needs) as [Good, number][]) {
      for (let k = n - (b.ai.enroute[g] ?? 0); k > 0; k--) mine.push({ site: b, good: g });
    }
    if (mine.length) build.push(mine);
  }
  const cur = w.s.research.cur;
  const seat = cur ? own.find((b) => b.built >= 1 && BUILDINGS[b.key].seat) : undefined;
  if (cur && seat) {
    for (const [g, n] of Object.entries(cur.needs) as [Good, number][]) {
      for (let k = n - (cur.enroute[g] ?? 0); k > 0; k--) study.push({ site: seat, good: g, rk: cur.key });
    }
  }
  for (const b of own) {
    const orders = inputOrders(b);
    if (orders.length) proc.push(orders.map((g) => ({ site: b, good: g, pk: true as const })));
  }
  // Reihum mit wechselndem Anfang (je Durchgang): Sind weniger Tagelöhner frei als Gebäude Waren abzugeben haben, käme
  // sonst immer dasselbe erste Gebäude zum Zug und das letzte nie (ADR 0013: Hof, Mühle, Bäckerei geben gleichzeitig ab).
  // Ebenso bei den Eingangspuffern: Teilen sich mehrere Werkstätten eine knappe Ware (Eisen für Waffen-, Rüstungsschmiede
  // und Bognerei), bekäme sonst die zuerst gebaute jedes einzelne Stück (ADR 0014).
  const turn = Math.floor(w.s.tick / DISPATCH_EVERY);
  const supplies = interleave([study, build.flat(), interleave(rotate(proc, turn))]);
  const hauls = interleave(rotate(own.filter((b) => b.built >= 1).map((b) => {
    const out: { b: SBuilding; good: Good }[] = [];
    for (const [g, n] of haulable(b)) for (let k = 0; k < n; k++) out.push({ b, good: g });
    return out;
  }).filter((l) => l.length), turn));
  const noStock = new Set<Good>();
  const noReach = new Set<number>();
  const full = new Set<StoreKey>();
  for (let i = 0; free.length && (i < supplies.length || i < hauls.length); i++) {
    const sp = supplies[i];
    // Werkstätten nehmen nur, was frei im Lager liegt (Baustellen und Forschung haben ihre Waren schon verplant)
    if (sp && !noStock.has(sp.good) && !(sp.pk && !inputAvailable(w, sp.good))) {
      const [cx, cy] = center(sp.site.key, sp.site.x, sp.site.y, sp.site.o);
      const ref = noReach.has(sp.site.id) ? null : reserveTake(w, sp.good, cx, cy);
      if (!ref) { if (!noReach.has(sp.site.id) && !sp.pk) noStock.add(sp.good); }
      else {
        const u = take(cx, cy, goalSlot(w, ref.b, ref.k), sp.rk || sp.pk ? goalEntrance(w, sp.site) : goalAround(sp.site));
        if (!u) {
          unreserveTake(ref.b.slots[ref.k]);
          noReach.add(sp.site.id);
          // Brückenfelder werden vom Ufer aus Feld für Feld erreichbar: dort keine Warnung
          if (!BUILDINGS[sp.site.key].road?.bridge) w.msg(`${BUILDINGS[sp.site.key].name}: ${sp.pk ? "Das Gebäude" : "Die Baustelle"} ist nicht erreichbar.`, "warnung", `unerreichbar-${sp.site.id}`, 60);
        } else {
          u.ai.job = { k: "supply", site: sp.site.id, from: ref.b.id, slot: ref.k, good: sp.good, ph: 0 }; u.order = { t: "job" };
          if (sp.rk && cur) { u.ai.job.rk = sp.rk; cur.enroute[sp.good] = (cur.enroute[sp.good] ?? 0) + 1; }
          else if (sp.pk && sp.site.proc) { u.ai.job.pk = true; sp.site.proc.enroute[sp.good] = (sp.site.proc.enroute[sp.good] ?? 0) + 1; }
          else sp.site.ai.enroute[sp.good] = (sp.site.ai.enroute[sp.good] ?? 0) + 1;
        }
      }
    }
    const hl = hauls[i];
    if (hl && free.length && !full.has(storeOf(hl.good))) {
      const hb = hl.b;
      const [ex, ey] = entrance(hb.key, hb.x, hb.y, hb.o);
      const ref = reservePut(w, hl.good, ex, ey);
      if (!ref) { if (!hasRoom(w, hl.good)) { full.add(storeOf(hl.good)); fullMessage(w, hl.good); } }
      else {
        const u = take(ex, ey, goalEntrance(w, hb), goalSlot(w, ref.b, ref.k));
        if (!u) { const sl = ref.b.slots[ref.k]; sl.incoming--; tidy(sl); }
        else {
          u.ai.job = { k: "haul", from: hb.id, to: ref.b.id, slot: ref.k, good: hl.good, ph: 0 }; u.order = { t: "job" };
          reserveOutput(hb, hl.good);
        }
      }
    }
  }
  for (const g of noStock) w.msg(`Für die Baustelle fehlt ${goodName(g)} im Lager.`, "warnung", `fehlt-${g}`, 45, "material_fehlt");
}

/** Listen reihum zusammenführen: erstes Element jeder Liste, dann das zweite … (leere Listen fallen weg). */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** Liste um k Stellen drehen (Anfang wechselt reihum). */
export function rotate<T>(list: T[], k: number): T[] {
  if (list.length < 2) return list;
  const i = ((k % list.length) + list.length) % list.length;
  return [...list.slice(i), ...list.slice(0, i)];
}

/** Reservierung zum Abholen zurückgeben (Auftrag kam nicht zustande). */
function unreserveTake(slot: StorageSlot): void { slot.reserved--; tidy(slot); }

const goodName = (g: Good) => GOODS[g].name;

// ---------------------------------------------------------------- Untätige Tagelöhner
const SPOTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx, dy]);
  return out;
})();

/** Untätige Tagelöhner warten am Sammelplatz (jeder an seinem Fleck) und laufen vor Angreifern davon. */
export function idlePeasant(w: World, u: SUnit): void {
  const ai = u.ai;
  if (ai.flee > 0) {
    ai.flee--;
    u.run = true; // fliehende Tagelöhner rennen (ADR 0016)
    const r = travel(w, u, tileGoal(ai.cx, ai.cy, 0, 1));
    if (r !== "moving" && r !== "waiting") ai.flee = 0;
    if (ai.flee <= 0) delete u.run;
    return;
  }
  if ((w.s.tick + u.id) % 5 === 0) {
    const e = nearestEnemy(w, u, 5);
    if (e) {
      const dx = u.x - e.x, dy = u.y - e.y, d = Math.hypot(dx, dy) || 1;
      const nav = w.nav, c = nav.comp[0][nav.node(u.layer, Math.floor(u.x), Math.floor(u.y))];
      const n = c < 0 ? -1 : nav.nearestInComp(0, c, Math.floor(u.x + (dx / d) * 7), Math.floor(u.y + (dy / d) * 7), 0, 5);
      if (n >= 0) { ai.cx = nav.tileX(n); ai.cy = nav.tileY(n); ai.flee = 4 * TPS; ai.think = 0; return; }
    }
  }
  if (ai.think > 0) { ai.think--; setAnim(u, idlePose(w, u)); return; }
  const [x, y] = campSpot(w, u);
  const r = travel(w, u, tileGoal(x, y, 0, 0));
  if (r === "arrived" || r === "unreachable") { setAnim(u, idlePose(w, u)); ai.think = 2 * TPS; ai.fresh = false; }
}

/**
 * Ruhebild eines Tagelöhners ohne Auftrag (ADR 0016): wechselt alle LIFE.idle.switchSeconds zwischen Stehen, Sitzen und
 * Plaudern; geplaudert wird nur mit einem anderen untätigen Tagelöhner daneben (beide drehen sich zueinander).
 * Rein aus Tick und ID, ohne Zufall.
 */
export function idlePose(w: World, u: SUnit): AnimKey {
  const I = LIFE.idle;
  const phase = (Math.floor((w.s.tick + u.id * 53) / (I.switchSeconds * TPS)) + u.id) % 3;
  if (phase === 0) return "stehen";
  if (phase === 2) {
    let mate: SUnit | null = null;
    w.grid.query(u.x, u.y, I.chatRadius, (o) => {
      const m = o as SUnit;
      if (m === u || m.dead || m.team !== u.team || m.key !== "tageloehner" || m.ai.job || m.ai.flee > 0) return;
      if (Math.hypot(m.x - u.x, m.y - u.y) > I.chatRadius) return;
      mate = m;
      return true;
    });
    const m = mate as SUnit | null;
    if (m) { face(u, m.x - u.x, m.y - u.y); return "plaudern"; }
  }
  return "sitzen";
}

function campSpot(w: World, u: SUnit): [number, number] {
  const [cx, cy] = w.meta.camp;
  for (let k = 0; k < SPOTS.length; k++) {
    const [dx, dy] = SPOTS[(u.id * 7 + k) % SPOTS.length];
    const x = cx + dx, y = cy + dy;
    if (w.inMap(x, y) && w.nav.open(w.nav.node(0, x, y), 0)) return [x, y];
  }
  // Sammelplatz zugebaut: nächster freie Tile weiter draußen
  const n = w.nav.nearestOpen(0, cx, cy, 0, 16);
  return n >= 0 ? [w.nav.tileX(n), w.nav.tileY(n)] : [cx, cy];
}

// ---------------------------------------------------------------- Bäume
export function updateTrees(w: World): void {
  const step = 1 / (TUNING.fallSeconds * TPS);
  for (const t of w.s.trees) {
    if (t.state !== "faellt") continue;
    t.progress = Math.min(1, t.progress + step);
    if (t.progress >= 1) { t.state = "liegt"; t.progress = 0; }
  }
}

// ---------------------------------------------------------------- Bevölkerung
export function updatePopulation(w: World): void {
  const s = w.s;
  let housing = TUNING.baseHousing;
  for (const b of s.buildings) if (b.team === 0 && b.built >= 1) housing += levelDef(b.key, levelOf(b)).housing ?? 0;
  let pop = 0;
  for (const u of s.units) if (u.team === 0 && !u.dead) pop++;
  for (const b of s.buildings) if (b.ai.inside) pop++;
  s.housing = housing; s.population = pop;
  if (!w.meta.immigration || s.outcome || s.tick < w.meta.nextImmigrant) return; // nach der Niederlage kein Zuzug
  // Abstand nach Ration und Vielfalt der Nahrung (ADR 0013); eine hungernde Siedlung bekommt keinen Zuzug
  w.meta.nextImmigrant = s.tick + Math.round(TUNING.immigrantSeconds * immigrationFactor(w) * TPS);
  if (pop >= housing) {
    w.msg("Kein Wohnraum mehr: Baue Wohnhäuser, damit weitere Leute zuziehen.", "warnung", "wohnraum", 120, "wohnraum");
    return;
  }
  const hungry = hungerBlocks(w);
  if (hungry) { w.msg(hungry, "warnung", "hunger-zuzug", 120); return; }
  const [ex, ey] = w.meta.entry;
  const u = w.addUnit("tageloehner", 0, ex + 0.5, ey + 0.5);
  u.ai.fresh = true;
  w.msg("Ein neuer Tagelöhner ist zugezogen.", "info", "zuzug", 60, "zuzug");
}

/** Werkstätten mit Arbeitern, die weg sind (gestorben), freigeben. */
export function pruneWorkers(w: World): void {
  for (const b of w.s.buildings) {
    if (!b.workers.length) continue;
    b.workers = b.workers.filter((id) => {
      const u = w.units.get(id);
      return !!u && !u.dead && (u.home === b.id || (u.ai.job?.k === "employ" && u.ai.job.b === b.id));
    });
  }
}
