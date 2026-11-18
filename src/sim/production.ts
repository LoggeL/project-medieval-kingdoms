/**
 * Verarbeitung nach Rezept (BRIEF §5.2, §5.5; ADR 0011).
 *
 * Ein Verarbeitungsgebäude (BuildingDef.production) hat ab Fertigstellung einen Zustand Building.proc: gewähltes
 * Rezept (src/data/recipes.ts), Eingangspuffer `in`, Ausgabestapel `out`, laufender Arbeitsgang und Stillstandsgrund.
 * Die Waren wechseln nur durch Figuren den Ort:
 *
 * 1. Anliefern: Der Disponent (economy.ts) gibt Tagelöhnern Aufträge "supply" mit pk: Ware aus einem Lager des
 *    passenden Typs holen (Reservierung im Fach, Zählung in proc.enroute/picked) und vor der Tür in den Puffer legen.
 *    Angeliefert wird bis zum Puffer (Rezeptmenge × production.buffer), nie mehr, als frei im Lager liegt (Baustellen
 *    und Forschung haben ihre Waren schon verplant, storage.committed).
 * 2. Verarbeiten: Der Arbeiter (Zyklus [{ do: "process" }], angestellt wie in jeder Werkstatt) geht durch die Tür an
 *    seinen Arbeitsplatz (u.inside, im Schnittbild sichtbar). Liegt genug im Puffer und passt die Ausgabe auf den
 *    Stapel, nimmt er die Eingänge (proc.busy), arbeitet `seconds` mit der Rezept-Animation und legt die Ausgänge auf
 *    den Ausgabestapel.
 * 3. Abholen: Der Disponent lässt Träger den Ausgabestapel ins Lager des passenden Typs bringen (Auftrag "haul").
 *    Ist dort kein Platz, bleibt die Ware liegen, der Stapel läuft voll und die Arbeit ruht (Grund „ausgang“).
 *
 * Lesende Funktionen (procReason, inputCap …) arbeiten nur auf SimState bzw. Building, damit die Oberfläche dieselben
 * Regeln zeigt, die die Simulation anwendet.
 */
import { BUILDINGS, GOODS, RECIPES, STORES, TECHS, UNITS, recipesOf, storeOf, type BuildingKey, type Good, type RecipeDef, type RecipeKey } from "../data";
import { modelToWorld, polyAt, polyLength, workWalk } from "./geom";
import { goalEntrance, stop, travel } from "./move";
import { workFactor } from "./research";
import { available, hasRoom, storeDirect } from "./storage";
import type { Building, CommandResult, Delivery, ProcState, ProcWhy, SimState } from "./types";
import { TPS, face, setAnim, type Job, type SBuilding, type SUnit, type World } from "./world";

type CycleJob = Extract<Job, { k: "cycle" }>;
type Stock = Partial<Record<Good, number>>;

const goodsIn = (rec: Stock): [Good, number][] => (Object.entries(rec) as [Good, number][]).filter(([, n]) => n > 0);
const add = (rec: Stock, g: Good, n: number) => { const v = (rec[g] ?? 0) + n; if (v > 0) rec[g] = v; else delete rec[g]; };

// ---------------------------------------------------------------- Lesen (Building, SimState)
/** Neuer Zustand für ein fertiges Verarbeitungsgebäude (erstes Rezept des Gebäudes). */
export function newProc(key: BuildingKey): ProcState | undefined {
  if (!BUILDINGS[key].production) return undefined;
  const recipe = recipesOf(key)[0];
  if (!recipe) return undefined;
  return { recipe, in: {}, enroute: {}, picked: {}, out: {}, res: {}, busy: false, t: 0, done: 0, why: { k: "kein_arbeiter" } };
}

export const recipeOf = (b: Building): RecipeDef | null => (b.proc ? RECIPES[b.proc.recipe] : null);

/** Puffergröße einer Eingangsware (Rezeptmenge × production.buffer), 0 = gehört nicht zum Rezept. */
export function inputCap(b: Building, g: Good): number {
  const r = recipeOf(b), pd = BUILDINGS[b.key].production;
  return r && pd ? (r.inputs[g] ?? 0) * pd.buffer : 0;
}

/** Größe des Ausgabestapels einer Ware (Rezeptmenge × production.stock), mindestens die Menge eines Arbeitsgangs. */
export function outputCap(b: Building, g: Good): number {
  const r = recipeOf(b), pd = BUILDINGS[b.key].production;
  if (!pd) return 0;
  const per = r?.outputs[g] ?? 0;
  return Math.max(per * pd.stock, b.proc?.out[g] ?? 0);
}

/** Noch anzuliefernde Menge einer Eingangsware (Puffer minus vorhanden minus unterwegs). */
export function inputNeed(b: Building, g: Good): number {
  const p = b.proc;
  if (!p) return 0;
  return Math.max(0, inputCap(b, g) - (p.in[g] ?? 0) - (p.enroute[g] ?? 0));
}

/** Eingänge, von denen für einen Arbeitsgang zu wenig im Puffer liegt. */
export function missingInputs(b: Building): Good[] {
  const r = recipeOf(b), p = b.proc;
  if (!r || !p) return [];
  return goodsIn(r.inputs).filter(([g, n]) => (p.in[g] ?? 0) < n).map(([g]) => g);
}

/** Ausgänge, die nicht mehr auf den Ausgabestapel passen. */
export function blockedOutputs(b: Building): Good[] {
  const r = recipeOf(b), p = b.proc, pd = BUILDINGS[b.key].production;
  if (!r || !p || !pd) return [];
  return goodsIn(r.outputs).filter(([g, n]) => (p.out[g] ?? 0) + n > n * pd.stock).map(([g]) => g);
}

/** Kann ein neuer Arbeitsgang beginnen (Eingänge da, Platz auf dem Stapel, nicht angehalten)? */
export const canStart = (b: Building): boolean => !!b.proc && !b.proc.paused && !missingInputs(b).length && !blockedOutputs(b).length;

/** Fortschritt des laufenden Arbeitsgangs 0..1 (für die Oberfläche). */
export function procProgress(s: SimState, b: Building): number {
  const r = recipeOf(b), p = b.proc;
  if (!r || !p || !p.busy) return 0;
  return Math.min(1, p.t / Math.max(1e-6, r.seconds * workFactor(s, r.anim)));
}

const list = (gs: Good[]) => gs.map((g) => GOODS[g].name).join(" und ");

/** Stillstandsgrund als Spielertext (null = es wird gearbeitet). */
export function procReason(_s: SimState, b: Building): string | null {
  const why = b.proc?.why;
  if (!why) return null;
  switch (why.k) {
    case "angehalten": return "Angehalten.";
    case "kein_arbeiter": return `Kein ${UNITS[BUILDINGS[b.key].workers?.unit ?? "tageloehner"].name}: Es fehlt ein freier Tagelöhner.`;
    case "unterwegs": return `Der ${UNITS[BUILDINGS[b.key].workers?.unit ?? "tageloehner"].name} geht an die Arbeit.`;
    case "eingang": return `Es fehlt ${list(why.goods)}: Träger bringen es aus dem Lager, sobald dort welches liegt.`;
    case "ausgang": {
      const kinds = [...new Set(why.goods.map(storeOf))].map((k) => STORES[k].building);
      return why.full
        ? `${list(why.goods)}-Stapel voll und kein Platz mehr im Lager (${kinds.join(", ")}): Die Arbeit ruht.`
        : `${list(why.goods)}-Stapel voll: Die Arbeit ruht, bis Träger ihn abholen.`;
    }
  }
}

// ---------------------------------------------------------------- Ausgabestapel (Hof oder Verarbeitung)
/** Abholbare Ausgänge eines Gebäudes (Hofstapel einer Werkstatt bzw. Ausgabestapel der Verarbeitung), je Ware frei. */
export function haulable(b: Building): [Good, number][] {
  if (b.proc) return goodsIn(b.proc.out).map(([g, n]) => [g, n - (b.proc!.res[g] ?? 0)] as [Good, number]).filter(([, n]) => n > 0);
  if (b.output && b.output.amount - b.output.reserved > 0) return [[b.output.good, b.output.amount - b.output.reserved]];
  return [];
}

/** Ein Stück einer Ausgabe für einen Träger reservieren. */
export function reserveOutput(b: Building, g: Good): void {
  if (b.proc) add(b.proc.res, g, 1);
  else if (b.output) b.output.reserved++;
}

/** Reservierung zurückgeben (Auftrag kam nicht zustande oder wurde abgebrochen). */
export function unreserveOutput(b: Building, g: Good): void {
  if (b.proc) add(b.proc.res, g, -1);
  else if (b.output) b.output.reserved--;
}

/** Ein reserviertes Stück abholen (der Träger steht vor der Tür). false = nichts mehr da. */
export function takeOutput(b: Building, g: Good): boolean {
  if (b.proc) {
    if ((b.proc.out[g] ?? 0) <= 0) return false;
    add(b.proc.out, g, -1); add(b.proc.res, g, -1);
    return true;
  }
  if (!b.output || b.output.good !== g || b.output.amount <= 0) return false;
  b.output.amount--; b.output.reserved--;
  return true;
}

// ---------------------------------------------------------------- Anliefern
/** Lieferbuchhaltung des Eingangspuffers für Aufträge "supply" mit pk (needs ist hier ohne Bedeutung). */
export function procDelivery(b: SBuilding | undefined): Delivery | null {
  return b?.proc ? { needs: {}, enroute: b.proc.enroute, picked: b.proc.picked } : null;
}

/** Braucht das aktuelle Rezept diese Ware (Rezeptwechsel, während Träger noch die alte bringen)? */
export function usesInput(b: Building, g: Good): boolean {
  return (recipeOf(b)?.inputs[g] ?? 0) > 0;
}

/** Eine angelieferte Ware in den Puffer legen. */
export function deliverInput(b: SBuilding, g: Good): void {
  if (b.proc) add(b.proc.in, g, 1);
}

/** Offene Anlieferungen eines Verarbeitungsgebäudes: je fehlendem Stück ein Eintrag, Waren im Wechsel. */
export function inputOrders(b: SBuilding): Good[] {
  const r = recipeOf(b);
  if (!r || !b.proc || b.proc.paused || b.built < 1) return [];
  const need = goodsIn(r.inputs).map(([g]) => [g, inputNeed(b, g)] as [Good, number]);
  const out: Good[] = [];
  for (let k = 0; need.some(([, n]) => n > k); k++) for (const [g, n] of need) if (n > k) out.push(g);
  return out;
}

/** Ist von dieser Ware etwas frei im Lager (nicht für Baustellen, Forschung oder andere Werkstätten verplant)? */
export const inputAvailable = (w: World, g: Good): boolean => available(w, g) > 0;

// ---------------------------------------------------------------- Arbeiter
/** Strecke von der Tür bis zum Arbeitsplatz (Tiles). */
function walkOf(b: SBuilding): [number, number][] {
  return workWalk(b.key, b.x, b.y, b.o, BUILDINGS[b.key].production!.spot);
}

/** Steht der Arbeiter u an seinem Arbeitsplatz im Gebäude? */
export function atWorkplace(w: World, u: SUnit): boolean {
  const j = u.ai.job, b = w.buildings.get(u.home);
  if (!b || j?.k !== "cycle" || j.ins === undefined || !BUILDINGS[b.key].production) return false;
  return j.ins >= polyLength(walkOf(b)) - 1e-9;
}

/** Arbeitet u (Arbeiter einer Verarbeitung) gerade im Gebäude (auf dem Weg zum Platz oder dort)? */
export function worksInside(u: SUnit): boolean {
  const j = u.ai.job;
  return !!u.inside && j?.k === "cycle" && j.ins !== undefined;
}

/**
 * Arbeitsschritt { do: "process" }: zur Tür, hinein bis an den Arbeitsplatz, dort Arbeitsgänge nach Rezept.
 * Der Arbeiter bleibt drinnen, solange er angestellt ist (toPeasant holt ihn heraus).
 */
export function runProcess(w: World, u: SUnit, j: CycleJob, home: SBuilding): void {
  const def = BUILDINGS[home.key], pd = def.production, p = home.proc;
  if (!pd || !p) { setAnim(u, "stehen"); return; }
  if (j.ins === undefined) {
    if (j.wait > 0) { j.wait--; setAnim(u, "stehen"); return; }
    const r = travel(w, u, goalEntrance(w, home));
    if (r === "unreachable") { j.wait = 2 * TPS; setAnim(u, "stehen"); return; }
    if (r !== "arrived") return;
    j.ins = 0; u.inside = home.id;
    stop(u);
  }
  const pts = walkOf(home), L = polyLength(pts);
  if (j.ins < L) {
    j.ins = Math.min(L, j.ins + UNITS[u.key].speed / TPS);
    const q = polyAt(pts, j.ins);
    u.x = q.x; u.y = q.y; u.z = 0;
    face(u, q.dx, q.dy);
    setAnim(u, "gehen");
    return;
  }
  const [fx, fy] = modelToWorld(pd.face[0], pd.face[1], home.o);
  face(u, fx, fy);
  const r = RECIPES[p.recipe];
  if (!p.busy) {
    if (!canStart(home)) { setAnim(u, "stehen"); return; }
    for (const [g, n] of goodsIn(r.inputs)) add(p.in, g, -n);
    p.busy = true; p.t = 0;
  }
  setAnim(u, r.anim);
  p.t += 1 / TPS;
  if (p.t < r.seconds * workFactor(w.s, r.anim) - 1e-9) return;
  for (const [g, n] of goodsIn(r.outputs)) add(p.out, g, n);
  p.busy = false; p.t = 0; p.done++;
}

/**
 * Stillstandsgrund aller Verarbeitungsgebäude (einmal je Tick nach dem Handeln der Figuren) und eine Meldung, wenn
 * eine Werkstatt auf eine Ware wartet, die nirgends frei im Lager liegt.
 */
export function updateProduction(w: World): void {
  for (const b of w.s.buildings) {
    const p = b.proc;
    if (!p || b.team !== 0) continue;
    p.why = whyOf(w, b);
    if (p.why?.k === "eingang" && w.s.tick % TPS === 0) {
      for (const g of p.why.goods) {
        if ((p.enroute[g] ?? 0) > 0 || inputAvailable(w, g)) continue;
        w.msg(`${BUILDINGS[b.key].name}: Es fehlt ${GOODS[g].name} im Lager (${STORES[storeOf(g)].building}).`, "warnung", `eingang-${b.key}-${g}`, 60);
      }
    }
  }
}

function whyOf(w: World, b: SBuilding): ProcWhy | null {
  const p = b.proc!;
  if (p.paused) return { k: "angehalten" };
  const u = b.workers.map((id) => w.units.get(id)).find((x) => x && !x.dead && x.home === b.id);
  if (!u) return { k: "kein_arbeiter" };
  if (!atWorkplace(w, u)) return { k: "unterwegs" };
  if (p.busy) return null;
  const miss = missingInputs(b);
  if (miss.length) return { k: "eingang", goods: miss };
  const blocked = blockedOutputs(b);
  if (blocked.length) return { k: "ausgang", goods: blocked, full: blocked.some((g) => !hasRoom(w, g)) };
  return null;
}

// ---------------------------------------------------------------- Befehle, Abriss
/** Rezept wählen: Puffer-Waren, die das neue Rezept nicht braucht, und ein laufender Arbeitsgang gehen ins Lager zurück. */
export function setRecipe(w: World, id: number, key: RecipeKey): CommandResult {
  const b = w.buildings.get(id);
  if (!b || b.team !== 0 || !b.proc) return { ok: false, reason: "Kein eigenes Verarbeitungsgebäude" };
  const r = RECIPES[key];
  if (!r || r.building !== b.key) return { ok: false, reason: "Dieses Rezept gibt es hier nicht" };
  if (r.tech && !w.s.research.done.includes(r.tech)) return { ok: false, reason: `Erst erforschen: ${TECHS[r.tech].name}` };
  if (b.proc.recipe === key) return { ok: true, ids: [id] };
  const p = b.proc;
  if (p.busy) for (const [g, n] of goodsIn(RECIPES[p.recipe].inputs)) storeDirect(w, g, n);
  p.busy = false; p.t = 0;
  for (const [g, n] of goodsIn(p.in)) if (!r.inputs[g]) { storeDirect(w, g, n); delete p.in[g]; }
  p.recipe = key;
  w.msg(`${BUILDINGS[b.key].name}: ${r.name}.`);
  return { ok: true, ids: [id] };
}

/** Verarbeitung anhalten oder fortsetzen. Angehalten beginnt kein neuer Arbeitsgang und es wird nichts angeliefert; ein laufender wird noch fertig. */
export function setPaused(w: World, id: number, on: boolean): CommandResult {
  const b = w.buildings.get(id);
  if (!b || b.team !== 0 || !b.proc) return { ok: false, reason: "Kein eigenes Verarbeitungsgebäude" };
  if (on) delete b.proc.paused; else b.proc.paused = true;
  return { ok: true, ids: [id] };
}

/**
 * Abriss: Puffer, Ausgabestapel und die Eingänge eines laufenden Arbeitsgangs kommen ins Lager zurück (sofort, wie
 * die Kostenerstattung; reicht der Platz nicht, verfällt der Rest). Waren in Trägerhänden bringen diese selbst zurück.
 */
export function returnProcGoods(w: World, b: SBuilding): void {
  const p = b.proc;
  if (!p) return;
  const back: Stock = {};
  for (const [g, n] of goodsIn(p.in)) add(back, g, n);
  for (const [g, n] of goodsIn(p.out)) add(back, g, n);
  if (p.busy) for (const [g, n] of goodsIn(RECIPES[p.recipe].inputs)) add(back, g, n);
  for (const [g, n] of goodsIn(back)) storeDirect(w, g, n);
}
