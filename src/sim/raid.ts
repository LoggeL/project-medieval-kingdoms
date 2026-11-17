/**
 * Überfälle: Wellen von Angreifern (Team 1) vom Kartenrand und ihre einfache KI.
 *
 * Ein Angreifer sucht das nächste Ziel: eine erreichbare Einheit in Sichtweite, sonst das nächste Gebäude
 * (Wirtschaftsbauten zuerst). Er läuft im Belagerungsmodus der Pfadsuche: Mauern und Tore sind dort teuer,
 * aber passierbar. Steht er vor einem solchen Hindernis, greift er es an, bis es fällt.
 */
import { START, TUNING, type UnitKey } from "../data";
import { isFort } from "./build";
import { inRangeBuilding, inRangeUnit, isRanged, meleeReachable, nearestEnemy, strikeBuilding, strikeUnit } from "./combat";
import { center } from "./geom";
import { blockedNode, goalAround, lineClear, stepToward, tileGoal, travel, type TravelResult } from "./move";
import { TPS, setAnim, type SUnit, type World } from "./world";

const MIX: UnitKey[] = ["schwert", "speer", "bogen", "speer", "schwert", "bogen", "speer"];

/** Vorwarnung vor einer Welle (Sekunden). */
export const RAID_WARNING_SECONDS = 30;

export function raidTick(w: World): void {
  const s = w.s;
  if (w.meta.raidsEnabled && s.tick === s.raid.next - RAID_WARNING_SECONDS * TPS) {
    w.msg("Späher melden Krieger auf dem Weg. In 30 Sekunden sind sie hier.", "kampf", "ueberfall-bald", 20, "ueberfall_bald");
  }
  if (w.meta.raidsEnabled && s.tick >= s.raid.next) {
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
  s.raid.wave++;
  const [sx, sy] = w.meta.raidSpawn;
  const ids: number[] = [];
  let k = 0;
  for (let r = 0; r <= 8 && ids.length < n; r++) {
    for (let dy = -r; dy <= r && ids.length < n; dy++) for (let dx = -r; dx <= r && ids.length < n; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = sx + dx, y = sy + dy;
      if (!w.inMap(x, y) || !nav.open(nav.node(0, x, y), 1)) continue;
      const u = w.addUnit(MIX[k++ % MIX.length], 1, x + 0.5, y + 0.5);
      u.ai.think = ids.length % TPS;
      ids.push(u.id);
    }
  }
  w.meta.raidRunning = true;
  w.msg(`Angreifer aus dem ${side(w)}! ${ids.length} Krieger rücken an (Welle ${s.raid.wave}).`, "kampf", undefined, 20, "ueberfall");
  return ids;
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
  if (--ai.think <= 0) { ai.think = TPS; chooseTarget(w, u); }
  const t = w.aliveUnit(ai.target);
  if (t) {
    if (inRangeUnit(u, t)) { strikeUnit(w, u, t); return; }
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    if (t.layer === u.layer && d < 3 && lineClear(w, u, t.x, t.y) && stepToward(w, u, t.x, t.y, isRanged(u.key) ? 3 : 0.6)) { ai.goal = ""; return; }
    const tx = Math.floor(t.x), ty = Math.floor(t.y);
    if (!ai.goal || Math.hypot(tx - ai.cx, ty - ai.cy) > 1.5) { ai.cx = tx; ai.cy = ty; }
    const r = travel(w, u, { ...tileGoal(ai.cx, ai.cy, t.layer, 1), breach: true });
    if (r === "unreachable") ai.target = 0;
    else if (r === "blocked") breakThrough(w, u);
    return;
  }
  ai.target = 0;
  const b = ai.targetB ? w.buildings.get(ai.targetB) : undefined;
  if (b && b.team !== u.team) {
    if (inRangeBuilding(u, b)) { strikeBuilding(w, u, b); return; }
    const r: TravelResult = travel(w, u, goalAround(b, true));
    if (r === "unreachable") ai.targetB = 0;
    else if (r === "blocked") breakThrough(w, u);
    return;
  }
  ai.targetB = 0;
  setAnim(u, "stehen");
}

/** Das Gebäude, das den Weg versperrt, angreifen. */
function breakThrough(w: World, u: SUnit): void {
  const n = blockedNode(u);
  if (n < 0) return;
  const b = w.buildingAt(w.nav.tileX(n), w.nav.tileY(n));
  if (!b || b.team === u.team) return;
  if (inRangeBuilding(u, b)) strikeBuilding(w, u, b);
  else { const [cx, cy] = center(b.key, b.x, b.y, b.o); if (!stepToward(w, u, cx, cy, 0.5)) setAnim(u, "stehen"); }
}

function chooseTarget(w: World, u: SUnit): void {
  const ai = u.ai;
  const cur = w.aliveUnit(ai.target);
  if (cur && Math.hypot(cur.x - u.x, cur.y - u.y) <= TUNING.raiderSight + 2 && (isRanged(u.key) || meleeReachable(w, u, cur))) return;
  const e = nearestEnemy(w, u, TUNING.raiderSight, (t) => isRanged(u.key) || meleeReachable(w, u, t));
  if (e) { ai.target = e.id; ai.goal = ""; return; }
  ai.target = 0;
  const b = ai.targetB ? w.buildings.get(ai.targetB) : undefined;
  if (b) return;
  // Nächstes Gebäude: Wirtschaft und Wohnen zuerst, Befestigungen nur, wenn sonst nichts steht
  let best = 0, bd = Infinity;
  for (const pass of [false, true]) {
    for (const x of w.s.buildings) {
      if (x.team === u.team || isFort(x.key) !== pass) continue;
      const [cx, cy] = center(x.key, x.x, x.y, x.o);
      const d = Math.hypot(cx - u.x, cy - u.y);
      if (d < bd) { bd = d; best = x.id; }
    }
    if (best) break;
  }
  ai.targetB = best;
  ai.goal = "";
}
