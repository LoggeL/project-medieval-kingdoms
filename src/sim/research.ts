/**
 * Forschung und Ausbau des Bergfrieds.
 *
 * Forschung läuft im Bergfried (BuildingDef.seat), eine Technik nach der anderen: Gold wird beim Start bezahlt, die
 * Waren tragen Tagelöhner aus dem Lager in den Bergfried (Disponent, Auftrag "supply" mit rk). Erst wenn alles da ist,
 * läuft die Zeit (Fortschritt je Tick). Danach gelten die Effekte (TechDef.effects) und die Freischaltungen
 * (BuildingDef.tech, UnitDef.tech, BuildingLevel.upgrade.tech).
 *
 * Ausbau: Gold sofort, Waren wie auf einer Baustelle (needs, site), dann baut ein Tagelöhner mit Bauanimation
 * (Building.upgrade.t). Das Gebäude bleibt dabei in Betrieb; mit der neuen Stufe wachsen Trefferpunkte, Wohnraum,
 * Steuern, und ab Stufe 2 trägt der Bergfried eine Wehrplattform mit Posten.
 *
 * Die lesenden Prüfungen (techStatus, techMissing, upgradeMissing …) arbeiten nur auf SimState, damit die Oberfläche
 * dieselben Regeln anzeigt, die die Simulation anwendet.
 */
import { BUILDINGS, GOODS, TECHS, TECH_KEYS, UNITS, levelDef, maxLevel, type AnimKey, type BuildingKey, type BuildingLevel, type Cost, type Good, type TechKey, type UnitKey } from "../data";
import type { Building, CommandResult, Delivery, SimState, Unit } from "./types";
import { available, storeDirect } from "./storage";
import { TPS, type SBuilding, type SUnit, type World } from "./world";

// ---------------------------------------------------------------- Lesen (nur SimState)
export const levelOf = (b: Building): number => b.level ?? 1;
export const hasTech = (s: SimState, k: TechKey): boolean => s.research.done.includes(k);

/** Eigener, fertiger Sitz des Burgherrn (Bergfried). */
export function seatOf(s: SimState): Building | undefined {
  return s.buildings.find((b) => b.team === 0 && b.built >= 1 && BUILDINGS[b.key].seat);
}

export type TechStatus = "erforscht" | "laeuft" | "verfuegbar" | "gesperrt";

export function techStatus(s: SimState, k: TechKey): TechStatus {
  if (hasTech(s, k)) return "erforscht";
  if (s.research.cur?.key === k) return "laeuft";
  return techMissing(s, k).length ? "gesperrt" : "verfuegbar";
}

/** Fehlende Voraussetzungen einer Technik als Spielertexte (leer = erfüllt). Kosten zählen hier nicht. */
export function techMissing(s: SimState, k: TechKey): string[] {
  const req = TECHS[k].requires ?? {};
  const out: string[] = [];
  for (const t of req.techs ?? []) if (!hasTech(s, t)) out.push(`Forschung: ${TECHS[t].name}`);
  for (const bk of req.buildings ?? []) {
    if (!s.buildings.some((b) => b.team === 0 && b.key === bk && b.built >= 1)) out.push(`Gebäude: ${BUILDINGS[bk].name}`);
  }
  if (req.level) {
    const seat = seatOf(s);
    if (!seat || levelOf(seat) < req.level) out.push(`Bergfried Stufe ${req.level} (${levelDef("bergfried", req.level).name})`);
  }
  return out;
}

/** Was eine Technik freischaltet (Namen), aus den Daten der Gebäude, Einheiten und Ausbaustufen gelesen. */
export function unlocksOf(k: TechKey): string[] {
  const out: string[] = [];
  for (const key of Object.keys(BUILDINGS) as BuildingKey[]) {
    const def = BUILDINGS[key];
    if (def.tech === k) out.push(def.name);
    def.levels?.forEach((lv, i) => { if (lv.upgrade?.tech === k) out.push(`${BUILDINGS[key].name}: Ausbau zur Stufe ${i + 1} (${lv.name})`); });
  }
  for (const key of Object.keys(UNITS) as UnitKey[]) if (UNITS[key].tech === k) out.push(UNITS[key].name);
  return out;
}

/** Nötige, noch fehlende Forschung für ein Gebäude oder eine Einheit (null = frei). */
export function lockedBy(s: SimState, def: { tech?: TechKey }): TechKey | null {
  return def.tech && !hasTech(s, def.tech) ? def.tech : null;
}

/** Nächste Ausbaustufe eines Gebäudes oder null. */
export function nextLevel(b: Building): BuildingLevel | null {
  const lv = BUILDINGS[b.key].levels;
  return lv && levelOf(b) < lv.length ? lv[levelOf(b)] : null;
}

/** Was dem Ausbau fehlt (Forschung, laufender Ausbau, Baustelle); Kosten zählen hier nicht. */
export function upgradeMissing(s: SimState, b: Building): string[] {
  const nx = nextLevel(b);
  if (!nx?.upgrade) return ["Höchste Stufe erreicht"];
  const out: string[] = [];
  if (b.built < 1) out.push("Erst fertig bauen");
  if (b.upgrade) out.push("Der Ausbau läuft schon");
  if (!hasTech(s, nx.upgrade.tech)) out.push(`Forschung: ${TECHS[nx.upgrade.tech].name}`);
  return out;
}

/** Faktor auf die Arbeitszeit einer Arbeitsanimation aus der Forschung. */
export function workFactor(s: SimState, anim: AnimKey): number {
  let f = 1;
  for (const k of s.research.done) f *= TECHS[k].effects?.work?.[anim] ?? 1;
  return f;
}

/** Tempo-Faktor für eigene Figuren mit Last. */
export function carryFactor(s: SimState): number {
  let f = 1;
  for (const k of s.research.done) f *= TECHS[k].effects?.carrySpeed ?? 1;
  return f;
}

/** Steuern des Bergfrieds in Gold je Spielminute (Stufe × Forschung). */
export function incomeOf(s: SimState): number {
  const seat = seatOf(s);
  if (!seat) return 0;
  let f = 1;
  for (const k of s.research.done) f *= TECHS[k].effects?.income ?? 1;
  return (levelDef(seat.key, levelOf(seat)).income ?? 0) * f;
}

/** Boni einer Einheitenart aus der Forschung. */
export function unitBoost(s: SimState, key: UnitKey): { range?: number; armor?: number } | undefined {
  let range = 0, armor = 0;
  for (const k of s.research.done) {
    const e = TECHS[k].effects?.units;
    if (!e || !e.keys.includes(key)) continue;
    range += e.range ?? 0; armor += e.armor ?? 0;
  }
  if (!range && !armor) return undefined;
  const out: { range?: number; armor?: number } = {};
  if (range) out.range = range;
  if (armor) out.armor = armor;
  return out;
}

/** Reichweite und Rüstung einer Einheit mit Forschungsboni. */
export const unitRange = (u: Unit): number => (UNITS[u.key].range ?? 1) + (u.boost?.range ?? 0);
export const unitArmor = (u: Unit): number => UNITS[u.key].armor + (u.boost?.armor ?? 0);

/** Waren einer Kostenangabe (ohne Gold). */
export function goodsOf(cost: Cost): [Good, number][] {
  return (Object.entries(cost) as [Good | "gold", number][]).filter(([g, n]) => g !== "gold" && n > 0) as [Good, number][];
}

// ---------------------------------------------------------------- Ändern (World)
function costReason(w: World, cost: Cost): string | null {
  if ((cost.gold ?? 0) > w.s.gold) return "Nicht genug Gold";
  for (const [g, n] of goodsOf(cost)) if (available(w, g) < n) return `Nicht genug ${GOODS[g].name} im Lager`;
  return null;
}

export function startResearch(w: World, k: TechKey): CommandResult {
  const s = w.s, def = TECHS[k];
  if (!def) return { ok: false, reason: "Unbekannte Forschung" };
  if (!seatOf(s)) return { ok: false, reason: "Ohne Bergfried keine Forschung" };
  if (hasTech(s, k)) return { ok: false, reason: `${def.name} ist schon erforscht` };
  if (s.research.cur) return { ok: false, reason: `Im Bergfried wird schon geforscht (${TECHS[s.research.cur.key].name})` };
  const miss = techMissing(s, k);
  if (miss.length) return { ok: false, reason: `Voraussetzung fehlt: ${miss.join(", ")}` };
  const why = costReason(w, def.cost);
  if (why) return { ok: false, reason: why, voice: "zu_teuer" };
  s.gold -= def.cost.gold ?? 0;
  s.research.cur = { key: k, t: 0, dur: def.seconds, needs: Object.fromEntries(goodsOf(def.cost)), enroute: {}, picked: {}, got: {} };
  w.msg(goodsOf(def.cost).length ? `Forschung ${def.name} beginnt, sobald die Waren im Bergfried sind.` : `Forschung ${def.name} beginnt.`);
  return { ok: true, ids: [] };
}

/** Laufende Forschung abbrechen: Gold zurück, angelieferte Waren zurück ins Lager, Träger bringen ihre Last zurück. */
export function cancelResearch(w: World, release: (u: SUnit, carryBack: boolean) => void): CommandResult {
  const cur = w.s.research.cur;
  if (!cur) return { ok: false, reason: "Es läuft keine Forschung" };
  const def = TECHS[cur.key];
  w.s.research.cur = null;
  w.s.gold += def.cost.gold ?? 0;
  for (const [g, n] of Object.entries(cur.got) as [Good, number][]) if (n > 0) storeDirect(w, g, n);
  for (const u of w.s.units) {
    const j = u.ai.job;
    if (j?.k === "supply" && j.rk === cur.key) release(u, j.ph === 1);
  }
  w.msg(`Forschung ${def.name} abgebrochen.`);
  return { ok: true, ids: [] };
}

/** Lieferbedarf eines Versorgungsauftrags: laufende Forschung (rk) oder Baustelle bzw. Ausbau `site`. */
export function deliveryOf(w: World, site: SBuilding | undefined, rk: TechKey | undefined): Delivery | null {
  if (rk) { const cur = w.s.research.cur; return cur && cur.key === rk && site && BUILDINGS[site.key].seat ? cur : null; }
  return site ? { needs: site.needs, enroute: site.ai.enroute, picked: site.ai.picked } : null;
}

/** Forschung voranbringen (je Tick), sobald alle Waren angeliefert sind. */
export function updateResearch(w: World): void {
  const s = w.s, cur = s.research.cur;
  if (!cur || Object.keys(cur.needs).length || !seatOf(s)) return;
  cur.t = Math.min(cur.dur, cur.t + 1 / TPS);
  if (cur.t < cur.dur - 1e-9) return;
  s.research.cur = null;
  s.research.done.push(cur.key);
  const def = TECHS[cur.key];
  if (def.effects?.units) for (const u of s.units) if (u.team === 0 && !u.dead) applyBoost(w, u);
  const un = unlocksOf(cur.key);
  w.msg(`Forschung abgeschlossen: ${def.name}.${un.length ? ` Neu: ${un.join(", ")}.` : ""}`, "info", undefined, 20, "bau_fertig");
}

/** Forschungsboni auf eine eigene Einheit legen (nach der Ausbildung und nach jeder Forschung). */
export function applyBoost(w: World, u: SUnit): void {
  if (u.team !== 0) return;
  const b = unitBoost(w.s, u.key);
  if (b) u.boost = b; else delete u.boost;
}

/** Steuern des Bergfrieds (Bruchteile sammeln sich in meta.tax). */
export function updateIncome(w: World): void {
  const per = incomeOf(w.s);
  if (per <= 0) return;
  // in Gold·Ticks/Minute zählen, damit sich keine Rundungsfehler sammeln (4 Gold je Minute = genau 4 Gold je 1200 Ticks)
  const m = w.meta, full = 60 * TPS;
  m.tax = (m.tax ?? 0) + per;
  if (m.tax >= full) { const k = Math.floor(m.tax / full); w.s.gold += k; m.tax -= k * full; }
}

export function startUpgrade(w: World, id: number): CommandResult {
  const b = w.buildings.get(id);
  if (!b || b.team !== 0) return { ok: false, reason: "Kein eigenes Gebäude" };
  const nx = nextLevel(b);
  const miss = upgradeMissing(w.s, b);
  if (!nx?.upgrade || miss.length) return { ok: false, reason: miss[0] ?? "Kein Ausbau möglich" };
  const why = costReason(w, nx.upgrade.cost);
  if (why) return { ok: false, reason: why, voice: "zu_teuer" };
  w.s.gold -= nx.upgrade.cost.gold ?? 0;
  b.upgrade = { level: levelOf(b) + 1, t: 0 };
  b.needs = Object.fromEntries(goodsOf(nx.upgrade.cost));
  b.site = {};
  b.ai.enroute = {}; b.ai.picked = {}; b.ai.builder = 0;
  w.msg(`Ausbau zum ${nx.name} beginnt: Träger bringen das Material.`);
  return { ok: true, ids: [b.id] };
}

/** Bauzeit des laufenden Ausbaus in Sekunden. */
export function upgradeSeconds(b: Building): number {
  const lv = b.upgrade ? BUILDINGS[b.key].levels?.[b.upgrade.level - 1] : undefined;
  return lv?.upgrade?.seconds ?? 1;
}

/** Ausbau abschließen: neue Stufe, Trefferpunkte wachsen um den Unterschied, Laufraster neu (Wehrplattform). */
export function completeUpgrade(w: World, b: SBuilding, refresh: () => void): void {
  if (!b.upgrade) return;
  const old = levelDef(b.key, levelOf(b));
  b.level = Math.min(maxLevel(b.key), b.upgrade.level);
  const def = levelDef(b.key, b.level);
  b.hp = Math.min(def.hp, b.hp + (def.hp - old.hp));
  delete b.upgrade;
  b.needs = {}; b.site = {};
  b.ai.enroute = {}; b.ai.picked = {}; b.ai.builder = 0;
  refresh();
  w.msg(`${BUILDINGS[b.key].name} ausgebaut: ${def.name}.${def.posts?.length ? ` ${def.posts.length} Posten auf der Wehrplattform (Taste T).` : ""}`, "info", undefined, 20, "bau_fertig");
}

/** Liegt eine Baustelle oder ein Ausbau vor (Material anliefern, bauen)? */
export const isSite = (b: Building): boolean => b.built < 1 || !!b.upgrade;

/** Alle Techniken in Datenreihenfolge (für Tests und Oberfläche). */
export const ALL_TECHS = TECH_KEYS;
