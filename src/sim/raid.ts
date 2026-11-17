/**
 * Überfälle: Wellen von Angreifern (Team 1) vom Kartenrand und ihre einfache KI.
 *
 * Ein Angreifer sucht das nächste Ziel: eine erreichbare Einheit in Sichtweite, sonst das nächste Gebäude
 * (Wirtschaftsbauten zuerst, dann der Bergfried, Befestigungen samt Treppen zuletzt). Fällt der Bergfried, ist die
 * Partie verloren. Er läuft im Belagerungsmodus der Pfadsuche:
 * Mauern und Tore sind dort teuer, aber passierbar. Steht er vor einem solchen Hindernis, greift er es an, bis es fällt.
 *
 * Rückzug: Wer unter TUNING.retreatHp seiner Lebenspunkte fällt oder als Letzter seiner Welle übrig ist, nachdem
 * andere gefallen sind, und dabei unter TUNING.retreatLoneHp liegt, zieht sich zum Anmarschpunkt am Kartenrand zurück
 * und verlässt die Karte. Er kämpft dabei nicht mehr. Ist der Rückweg versperrt, stellt er sich und kämpft bis zuletzt.
 * Ist kein Angreifer mehr auf der Karte, gilt die Welle als abgewehrt.
 */
import { BUILDINGS, RAID_SIEGE, START, TUNING, UNITS, type BuildingKey, type UnitKey } from "../data";
import { inRangeBuilding, inRangeUnit, isRanged, isSoldier, meleeReachable, nearestEnemy, strikeBuilding, strikeUnit, vanish } from "./combat";
import { center } from "./geom";
import { blockedNode, goalAround, lineClear, stepToward, stop, tileGoal, travel, type TravelResult } from "./move";
import { TPS, setAnim, type SUnit, type World } from "./world";
import { fillDitch, hasLadderWall, siegeAct, viaLadder } from "./belagerung";

/** Vorwarnung vor einer Welle (Sekunden). */
export const RAID_WARNING_SECONDS = 30;

export function raidTick(w: World): void {
  const s = w.s;
  // Nach der Niederlage (Bergfried gefallen) keine Vorwarnung und keine neuen Wellen mehr
  const due = w.meta.raidsEnabled && !s.outcome;
  if (due && s.tick === s.raid.next - RAID_WARNING_SECONDS * TPS) {
    w.msg("Späher melden Krieger auf dem Weg. In 30 Sekunden sind sie hier.", "kampf", "ueberfall-bald", 20, "ueberfall_bald");
  }
  if (due && s.tick >= s.raid.next) {
    spawnWave(w);
    s.raid.next = s.tick + START.raid.everySeconds * TPS;
  }
  let active = false;
  for (const u of s.units) if (u.team === 1 && !u.dead) { active = true; break; }
  if (w.meta.raidRunning && !active) {
    w.meta.raidRunning = false;
    w.msg("Der Überfall ist abgewehrt!", "kampf", undefined, 20, "abgewehrt");
  }
  s.raid.active = active;
}

export function spawnWave(w: World): number[] {
  const s = w.s, nav = w.nav;
  const n = START.raid.baseSize + START.raid.growth * s.raid.wave;
  const mix = START.raid.mix;
  s.raid.wave++;
  w.meta.raidLosses = 0;
  // Belagerungswerkzeug (RAID_SIEGE, ADR 0017): Sturmknechte mit Leitern und Rammböcke samt Mannschaft ersetzen Krieger.
  // Leitern nur, wenn es eine Mauer mit Wehrgang gibt (sonst kommen Krieger an ihrer Stelle).
  const siege = siegeFor(s.raid.wave);
  const crew = UNITS.rammbock.vehicle?.crew ?? 0;
  const ladders = hasLadderWall(w) ? Math.min(siege.ladders, n) : 0;
  const plan: { key: UnitKey; gear?: "leiter"; ram?: number }[] = [];
  for (let k = 0; k < Math.max(0, n - ladders - siege.rams * crew); k++) plan.push({ key: mix[k % mix.length] });
  for (let k = 0; k < ladders; k++) plan.push({ key: "sturmknecht", gear: "leiter" });
  for (let r = 0; r < siege.rams; r++) {
    plan.push({ key: "rammbock" });
    for (let c = 0; c < crew; c++) plan.push({ key: "sturmknecht", ram: r });
  }
  const [sx, sy] = w.meta.raidSpawn;
  const ids: number[] = [];
  const rams: number[] = [];
  for (let r = 0; r <= 8 && ids.length < plan.length; r++) {
    for (let dy = -r; dy <= r && ids.length < plan.length; dy++) for (let dx = -r; dx <= r && ids.length < plan.length; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = sx + dx, y = sy + dy;
      if (!w.inMap(x, y) || !nav.open(nav.node(0, x, y), 1)) continue;
      const p = plan[ids.length];
      const u = w.addUnit(p.key, 1, x + 0.5, y + 0.5);
      u.ai.think = ids.length % TPS;
      if (p.gear) u.gear = p.gear;
      if (UNITS[p.key].vehicle) rams.push(u.id);
      if (p.ram !== undefined) u.ai.ram = rams[p.ram] ?? 0;
      ids.push(u.id);
    }
  }
  w.meta.raidRunning = true;
  const men = ids.filter((id) => !UNITS[w.units.get(id)!.key].vehicle).length;
  w.msg(`Angreifer aus dem ${side(w)}! ${men} Krieger rücken an (Welle ${s.raid.wave}).`, "kampf", undefined, 20, "ueberfall");
  if (ladders || rams.length) w.msg(rams.length ? "Sie bringen Sturmleitern und einen Rammbock mit!" : "Sie tragen Sturmleitern!", "kampf");
  return ids;
}

/** Belagerungswerkzeug der Welle (höchste passende Zeile aus RAID_SIEGE, vor der ersten keines). */
export function siegeFor(wave: number): { ladders: number; rams: number } {
  let out = { ladders: 0, rams: 0 };
  for (const r of RAID_SIEGE) if (wave >= r.wave) out = r;
  return out;
}

function side(w: World): string {
  const [x, y] = w.meta.raidSpawn;
  const dx = x / w.s.w - 0.5, dy = y / w.s.h - 0.5;
  // Welt-Achsen: x nach rechts unten, y nach links unten (Ansicht 0); Himmelsrichtungen wie geom.NEIGHBOURS
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "Osten" : "Westen";
  return dy > 0 ? "Süden" : "Norden";
}

// ---------------------------------------------------------------- KI
export function raiderAct(w: World, u: SUnit): void {
  const ai = u.ai;
  if (siegeAct(w, u)) return; // Rammbock, seine Mannschaft, Sturmknecht mit Leiter (belagerung.ts)
  if (ai.retreat) { retreatAct(w, u); return; }
  if (--ai.think <= 0) {
    ai.think = TPS;
    if (shouldRetreat(w, u)) { startRetreat(w, u); return; }
    chooseTarget(w, u);
  }
  const t = w.aliveUnit(ai.target);
  if (t?.inside) ai.target = 0; // im Lagerhaus verschwunden: nicht durch die Wand hinterher
  else if (t) {
    if (inRangeUnit(u, t)) { strikeUnit(w, u, t); return; }
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    if (t.layer === u.layer && d < 3 && lineClear(w, u, t.x, t.y) && stepToward(w, u, t.x, t.y, isRanged(u.key) ? 3 : 0.6)) { ai.goal = ""; return; }
    const tx = Math.floor(t.x), ty = Math.floor(t.y);
    if (!ai.goal || Math.hypot(tx - ai.cx, ty - ai.cy) > 1.5) { ai.cx = tx; ai.cy = ty; }
    const r = travel(w, u, viaLadder(w, u, { ...tileGoal(ai.cx, ai.cy, t.layer, 1), breach: true }));
    if (r === "unreachable") ai.target = 0;
    else if (r === "blocked") breakThrough(w, u);
    return;
  }
  ai.target = 0;
  const b = ai.targetB ? w.buildings.get(ai.targetB) : undefined;
  if (b && b.team !== u.team) {
    if (inRangeBuilding(u, b)) { strikeBuilding(w, u, b); return; }
    const r: TravelResult = travel(w, u, viaLadder(w, u, goalAround(b, true)));
    if (r === "unreachable") ai.targetB = 0;
    else if (r === "blocked") breakThrough(w, u);
    return;
  }
  ai.targetB = 0;
  setAnim(u, "stehen");
}

/** Zu schwer verwundet, oder als Letzter übrig, nachdem andere der Welle gefallen oder geflohen sind? */
function shouldRetreat(w: World, u: SUnit): boolean {
  if (u.ai.cornered) return false;
  if (u.hp < TUNING.retreatHp * u.maxHp) return true;
  if (!w.meta.raidLosses || u.hp >= TUNING.retreatLoneHp * u.maxHp) return false;
  for (const o of w.s.units) if (o !== u && o.team === u.team && !o.dead && !o.ai.retreat) return false;
  return true;
}

function startRetreat(w: World, u: SUnit): void {
  const ai = u.ai;
  ai.retreat = true;
  ai.target = 0; ai.targetB = 0;
  stop(u);
  w.meta.raidLosses = (w.meta.raidLosses ?? 0) + 1;
  w.msg("Die Angreifer weichen zurück!", "kampf", "rueckzug", 15);
}

/** Zurück zum Anmarschpunkt; am Kartenrand verlässt der Angreifer die Karte. Versperrt eine Mauer den Weg, reißt er sie ein. */
function retreatAct(w: World, u: SUnit): void {
  const [sx, sy] = w.meta.raidSpawn;
  const r = travel(w, u, { ...tileGoal(sx, sy, 0, 1), breach: true });
  const edge = u.x < 1 || u.y < 1 || u.x > w.s.w - 1 || u.y > w.s.h - 1;
  if (r === "arrived" || (edge && u.layer === 0)) { vanish(u); return; }
  if (r === "blocked") breakThrough(w, u);
  else if (r === "unreachable") {
    // Kein Weg zurück (z. B. Treppe hinter ihm zerstört): Er stellt sich und kämpft weiter, sonst endete die Welle nie.
    u.ai.retreat = false; u.ai.cornered = true;
  }
}

/** Das Gebäude, das den Weg versperrt, angreifen. */
function breakThrough(w: World, u: SUnit): void {
  const n = blockedNode(u);
  if (n < 0) return;
  const b = w.buildingAt(w.nav.tileX(n), w.nav.tileY(n));
  if (!b || b.team === u.team) return;
  if (BUILDINGS[b.key].ditch) { fillDitch(w, u, b); return; }
  if (inRangeBuilding(u, b)) strikeBuilding(w, u, b);
  else { const [cx, cy] = center(b.key, b.x, b.y, b.o); if (!stepToward(w, u, cx, cy, 0.5)) setAnim(u, "stehen"); }
}

/** Soldaten in Sichtweite, Arbeiter nur aus der Nähe (flüchtenden Tagelöhnern läuft niemand quer über die Karte nach). */
function worthChasing(w: World, u: SUnit, t: SUnit, slack: number): boolean {
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  if (d > (isSoldier(t.key) ? TUNING.raiderSight : TUNING.raiderWorkerReach) + slack) return false;
  return isRanged(u.key) || meleeReachable(w, u, t);
}

function chooseTarget(w: World, u: SUnit): void {
  const ai = u.ai;
  const cur = w.aliveUnit(ai.target);
  if (cur && worthChasing(w, u, cur, 2)) return;
  const e = nearestEnemy(w, u, TUNING.raiderSight, (t) => worthChasing(w, u, t, 0));
  if (e) { ai.target = e.id; ai.goal = ""; return; }
  ai.target = 0;
  const b = ai.targetB ? w.buildings.get(ai.targetB) : undefined;
  if (b) return;
  // Nächstes Gebäude: Wirtschaft, Wohnen und Kaserne zuerst, dann der Bergfried, Befestigungen (Mauer, Tor, Turm,
  // Treppe) nur, wenn sonst nichts steht
  const rank = (key: BuildingKey) => BUILDINGS[key].seat ? 1 : BUILDINGS[key].category === "befestigung" ? 2 : 0;
  let best = 0, bd = Infinity;
  for (const pass of [0, 1, 2]) {
    for (const x of w.s.buildings) {
      if (x.team === u.team || rank(x.key) !== pass || BUILDINGS[x.key].road || BUILDINGS[x.key].ditch) continue; // Wege, Brücken und Gräben sind kein Ziel
      const [cx, cy] = center(x.key, x.x, x.y, x.o);
      const d = Math.hypot(cx - u.x, cy - u.y);
      if (d < bd) { bd = d; best = x.id; }
    }
    if (best) break;
  }
  ai.targetB = best;
  ai.goal = "";
}
