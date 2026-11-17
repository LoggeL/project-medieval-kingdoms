/**
 * Kampf: Reichweiten, Schaden, Geschosse, Tod.
 *
 * Nahkampf trifft sofort, Fernkampf schießt ein Geschoss, das nach seiner Flugzeit am Zielpunkt (mit Vorhalt)
 * einschlägt; ist das Ziel nicht mehr dort, geht der Schuss daneben. Schützen auf Wehrgang oder Turm reichen
 * pro Höhenstufe weiter (WALL_BONUS.rangePerStep), und wer oben steht, nimmt von unten weniger Schaden
 * (WALL_BONUS.damageTakenFactor); ihr Schuss nach unten trifft härter (WALL_BONUS.damageDealtFactor).
 * Nahkämpfer treffen nur auf gleicher Höhe und Gebäude nur aus dem Nachbarfeld (nicht durch eine Mauer hindurch).
 *
 * Zielwahl der Schützen (pickTarget): Gefahr vor Nähe. Wer selbst schießen kann und den Schützen erreicht, wer gerade
 * Tor, Mauer oder Treppe angreift und wen die eigenen Pfeile schnell erledigen, kommt zuerst. Ein gewähltes Ziel wird
 * TUNING.targetHoldSeconds gehalten, damit niemand zwischen zwei Gegnern hin- und herwechselt.
 */
import { BUILDINGS, DAMAGE_TYPES, TUNING, UNITS, WALL_BONUS, hitFactor, levelDef, type UnitKey } from "../data";
import { removeBuilding } from "./build";
import { footprint } from "./geom";
import { releaseJob } from "./jobs";
import { levelOf, unitArmor, unitRange } from "./research";
import { stop } from "./move";
import { TPS, dist, distToRect, face, setAnim, type SBuilding, type SProjectile, type SUnit, type World } from "./world";

export const isRanged = (key: UnitKey): boolean => UNITS[key].role === "fernkampf";
export const isSoldier = (key: UnitKey): boolean => UNITS[key].role !== "arbeiter";

/** Höhenunterschied, bis zu dem Nahkämpfer sich treffen. */
export const MELEE_DZ = 1.2;
/** Nahkampf gegen Gebäude: höchstens so weit vom Grundriss (Felder), also aus dem Nachbarfeld, nicht durch eine Mauer. */
const MELEE_BUILDING_REACH = 0.95;

export function rangeOf(u: SUnit): number {
  const r = unitRange(u);
  return isRanged(u.key) ? r + WALL_BONUS.rangePerStep * Math.max(0, u.z) : r;
}

export function inRangeUnit(u: SUnit, t: SUnit): boolean {
  const d = dist(u.x, u.y, t.x, t.y);
  if (isRanged(u.key)) return d <= rangeOf(u);
  return d <= rangeOf(u) + 0.25 && Math.abs(u.z - t.z) < MELEE_DZ;
}

export function inRangeBuilding(u: SUnit, b: SBuilding): boolean {
  const [fw, fh] = footprint(b.key, b.o);
  const d = distToRect(u.x, u.y, b.x, b.y, b.x + fw, b.y + fh);
  if (isRanged(u.key)) return d <= rangeOf(u);
  // Wer auf dem Grundriss steht (Treppe), erreicht ihn in jeder Höhe
  return d <= Math.min(rangeOf(u) + 0.35, MELEE_BUILDING_REACH) && (u.z < MELEE_DZ || d === 0);
}

/** Kann u das Ziel im Nahkampf erreichen (gleiche Höhe oder über Wege verbunden)? */
export function meleeReachable(w: World, u: SUnit, t: SUnit): boolean {
  if (Math.abs(u.z - t.z) < MELEE_DZ && u.layer === t.layer) return true;
  const nav = w.nav, comp = nav.comp[u.team];
  const a = comp[nav.node(u.layer, Math.floor(u.x), Math.floor(u.y))];
  const b = comp[nav.node(t.layer, Math.floor(t.x), Math.floor(t.y))];
  return a >= 0 && a === b;
}

/** Nächster lebender Gegner im Umkreis, der den Filter erfüllt. */
export function nearestEnemy(w: World, u: SUnit, radius: number, ok?: (t: SUnit) => boolean): SUnit | null {
  let best: SUnit | null = null, bd = radius;
  w.grid.query(u.x, u.y, radius, (o) => {
    const t = o as SUnit;
    if (t.team === u.team || t.dead || t.inside) return;
    const d = dist(u.x, u.y, t.x, t.y);
    if (d < bd || (d === bd && best && t.id < best.id)) { if (!ok || ok(t)) { best = t; bd = d; } }
  });
  return best;
}

/** Erwarteter Schaden eines Treffers von a gegen t (ohne Streuung), wie damageUnit rechnet. */
export function expectedDamage(a: SUnit, t: SUnit): number {
  const ad = UNITS[a.key], td = UNITS[t.key];
  let dmg = (ad.damage ?? 1) * hitFactor(ad, td);
  if (isRanged(a.key) && a.z >= 2 && t.z < 1) dmg *= WALL_BONUS.damageDealtFactor;
  dmg = Math.max(1, dmg - unitArmor(t) * DAMAGE_TYPES[ad.damageType ?? "hieb"].armor);
  if (t.z >= 2 && a.z < 1) dmg *= WALL_BONUS.damageTakenFactor;
  return dmg;
}

/** Greift t gerade ein Gebäude an (letzter Schlag vor höchstens 3 Sekunden)? */
export function assaulting(w: World, t: SUnit): boolean {
  return t.ai.hitB !== undefined && w.s.tick - t.ai.hitB <= 3 * TPS;
}

/**
 * Gefahrenwert eines Ziels für u (kleiner = zuerst bekämpfen): Treffer bis zum Fall, geteilt durch die Gefahr.
 * Gefährlich ist, wer selbst schießt und u erreicht, wer gerade ein Gebäude angreift, und wer auf dem Wehrgang steht.
 */
export function threatScore(w: World, u: SUnit, t: SUnit): number {
  const hits = t.hp / expectedDamage(u, t);
  let danger = 1;
  if (isRanged(t.key) && dist(u.x, u.y, t.x, t.y) <= rangeOf(t) + 1) danger += 1.5;
  if (assaulting(w, t)) danger += 1;
  if (t.layer > 0 && u.team === 0) danger += 1;
  return hits / danger + 0.15 * dist(u.x, u.y, t.x, t.y);
}

/**
 * Ziel für u wählen: das aktuelle halten, solange es gültig ist und die Haltezeit läuft, sonst das gefährlichste
 * Ziel im Umkreis, das `ok` erfüllt. Ein neues Ziel löst das alte nur ab, wenn es deutlich gefährlicher ist.
 */
export function pickTarget(w: World, u: SUnit, radius: number, ok: (t: SUnit) => boolean): SUnit | null {
  const ai = u.ai;
  const cur = w.aliveUnit(ai.target);
  const curOk = !!cur && cur.team !== u.team && ok(cur);
  if (curOk && (ai.lock ?? 0) > w.s.tick) return cur!;
  let best: SUnit | null = null, bs = Infinity;
  w.grid.query(u.x, u.y, radius, (o) => {
    const t = o as SUnit;
    if (t.team === u.team || t.dead || dist(u.x, u.y, t.x, t.y) > radius || !ok(t)) return;
    const sc = threatScore(w, u, t);
    if (sc < bs - 1e-9 || (Math.abs(sc - bs) <= 1e-9 && best && t.id < best.id)) { best = t; bs = sc; }
  });
  const pick: SUnit | null = curOk && (!best || threatScore(w, u, cur!) <= bs * 1.3) ? cur! : best;
  if (pick && pick.id !== ai.target) ai.lock = w.s.tick + Math.round(TUNING.targetHoldSeconds * TPS);
  ai.target = pick ? pick.id : 0;
  return pick;
}

// ---------------------------------------------------------------- Angriffe
/** Angriff ausführen, wenn die Abklingzeit vorbei ist. */
export function strikeUnit(w: World, u: SUnit, t: SUnit): void {
  face(u, t.x - u.x, t.y - u.y);
  if (u.ai.cd > 0) { calmDown(u); return; }
  const def = UNITS[u.key];
  u.ai.cd = Math.round((def.cooldown ?? 1) * TPS);
  if (isRanged(u.key)) {
    setAnim(u, "schiessen", true);
    shoot(w, u, t.x, t.y, t.z, t.x - t.px, t.y - t.py, t.id, "unit");
  } else {
    setAnim(u, "angriff", true);
    damageUnit(w, u.key, u.z, t, u.id);
  }
}

export function strikeBuilding(w: World, u: SUnit, b: SBuilding): void {
  const [fw, fh] = footprint(b.key, b.o);
  const cx = Math.max(b.x, Math.min(b.x + fw, u.x)), cy = Math.max(b.y, Math.min(b.y + fh, u.y));
  face(u, b.x + fw / 2 - u.x, b.y + fh / 2 - u.y);
  if (u.ai.cd > 0) { calmDown(u); return; }
  u.ai.cd = Math.round((UNITS[u.key].cooldown ?? 1) * TPS);
  u.ai.hitB = w.s.tick;
  if (isRanged(u.key)) {
    setAnim(u, "schiessen", true);
    shoot(w, u, cx, cy, b.built >= 1 && levelDef(b.key, levelOf(b)).walkway ? 2.5 : 1, 0, 0, b.id, "building");
  } else {
    setAnim(u, "angriff", true);
    damageBuilding(w, u.key, b);
  }
}

/** Zwischen zwei Schlägen nach der Schlaganimation wieder in Grundhaltung. */
function calmDown(u: SUnit): void {
  if ((u.anim === "angriff" || u.anim === "schiessen") && u.animT >= 0.6) setAnim(u, "stehen");
  else if (u.anim === "gehen") setAnim(u, "stehen");
}

function shoot(w: World, u: SUnit, tx: number, ty: number, tz: number, vx: number, vy: number, target: number, kind: "unit" | "building"): void {
  const d = dist(u.x, u.y, tx, ty);
  const dur = Math.max(3, Math.round((d / TUNING.projectileSpeed) * TPS));
  // Vorhalt: wohin das Ziel bei gleichbleibender Bewegung läuft (höchstens 1,5 Tiles)
  let lx = vx * dur, ly = vy * dur;
  const ll = Math.hypot(lx, ly);
  if (ll > 1.5) { lx *= 1.5 / ll; ly *= 1.5 / ll; }
  const p: SProjectile = {
    id: w.newId(), team: u.team,
    x0: u.x, y0: u.y, z0: u.z + 1.1, x1: tx + lx, y1: ty + ly, z1: tz + 0.8, t: 0,
    target, akey: u.key, az: u.z, dur, kind, from: u.id,
  };
  w.s.projectiles.push(p);
}

export function updateProjectiles(w: World): void {
  const s = w.s;
  if (!s.projectiles.length) return;
  const keep: SProjectile[] = [];
  for (const p of s.projectiles) {
    p.t = Math.min(1, p.t + 1 / p.dur);
    if (p.t < 1) { keep.push(p); continue; }
    if (p.kind === "unit") {
      const t = w.aliveUnit(p.target);
      if (t && dist(t.x, t.y, p.x1, p.y1) <= 0.8) damageUnit(w, p.akey, p.az, t, p.from);
    } else {
      const b = w.buildings.get(p.target);
      if (b) damageBuilding(w, p.akey, b);
    }
  }
  s.projectiles = keep;
}

// ---------------------------------------------------------------- Schaden
export function damageUnit(w: World, akey: UnitKey, az: number, t: SUnit, from: number): void {
  const a = UNITS[akey], d = UNITS[t.key];
  const type = a.damageType ?? "hieb";
  // Konter-Bonus und Schadensart gegen Rüstungsklasse (hitFactor, Konzept 05), dann Rüstungspunkte
  let dmg = (a.damage ?? 1) * (1 + (w.rand() * 2 - 1) * TUNING.damageSpread) * hitFactor(a, d);
  if (a.role === "fernkampf" && az >= 2 && t.z < 1) dmg *= WALL_BONUS.damageDealtFactor; // Schuss von der Mauer
  dmg = Math.max(1, dmg - unitArmor(t) * DAMAGE_TYPES[type].armor);
  if (t.z >= 2 && az < 1) dmg *= WALL_BONUS.damageTakenFactor; // Deckung hinter den Zinnen
  t.hp -= dmg;
  t.hitT = w.s.tick; // Zusammenzucken in der Darstellung (ADR 0016)
  t.ai.hurtT = w.s.tick;
  if (t.hp <= 0) { kill(w, t); return; }
  // Untätige Soldaten wehren sich
  if (isSoldier(t.key) && t.order.t === "idle" && !t.ai.target && t.team === 0) t.ai.target = from;
  if (t.team === 0 && !isSoldier(t.key)) w.msg("Deine Arbeiter werden angegriffen!", "kampf", "arbeiter-angriff", 20, "arbeiter_angriff");
}

export function damageBuilding(w: World, akey: UnitKey, b: SBuilding): void {
  if (BUILDINGS[b.key].ditch) return; // Gräben werden zugeschüttet, nicht zerschlagen (belagerung.fillDitch)
  b.ai.hitT = w.s.tick;
  const a = UNITS[akey];
  const dmg = (a.damage ?? 1) * DAMAGE_TYPES[a.damageType ?? "hieb"].building * (1 + (w.rand() * 2 - 1) * TUNING.damageSpread);
  b.hp -= dmg;
  if (b.team === 0) w.msg(`${BUILDINGS[b.key].name} wird angegriffen!`, "kampf", `angriff-${b.key}`, 15, "gebaeude_angriff");
  if (b.hp <= 0) removeBuilding(w, b, "zerstoert");
}

export function kill(w: World, u: SUnit): void {
  if (u.dead) return;
  releaseJob(w, u);
  u.dead = true; u.hp = 0;
  u.order = { t: "idle" };
  u.ai.deadT = 0; u.ai.target = 0; u.ai.targetB = 0;
  stop(u);
  setAnim(u, "sterben", true);
  if (u.team === 1) {
    w.s.gold += TUNING.bounty; w.meta.raidLosses = (w.meta.raidLosses ?? 0) + 1;
    if (UNITS[u.key].vehicle) w.msg(`Der ${UNITS[u.key].name} ist zerstört!`, "kampf", "ramme-zerstoert", 5);
  }
  else if (isSoldier(u.key)) w.msg(`Ein ${UNITS[u.key].name} ist gefallen.`, "kampf", "gefallen", 8, "gefallen");
}

/** Einheit ohne Tod aus der Welt nehmen (Angreifer hat den Kartenrand erreicht); entfernt am Ende des Ticks. */
export function vanish(u: SUnit): void {
  u.dead = true; u.hp = 0;
  u.order = { t: "idle" };
  u.ai.target = 0; u.ai.targetB = 0;
  u.ai.deadT = Math.ceil((TUNING.dyingSeconds + TUNING.corpseSeconds) * TPS);
  stop(u);
}

/** Sterbeanimation, liegen bleiben, dann entfernen. */
export function updateDeaths(w: World): void {
  const dying = TUNING.dyingSeconds * TPS, gone = (TUNING.dyingSeconds + TUNING.corpseSeconds) * TPS;
  let remove = false;
  for (const u of w.s.units) {
    if (!u.dead) continue;
    u.ai.deadT++;
    if (u.ai.deadT >= dying && u.anim !== "tot") setAnim(u, "tot");
    if (u.ai.deadT >= gone) remove = true;
  }
  if (!remove) return;
  for (const u of w.s.units.filter((x) => x.dead && x.ai.deadT >= gone)) w.removeUnit(u);
}

// ---------------------------------------------------------------- Abstand halten
/** Stehende Soldaten schieben sich leicht auseinander, damit Gruppen nicht in einem Punkt kleben. */
export function separate(w: World): void {
  const R = 0.42;
  for (const u of w.s.units) {
    if (u.dead || !isSoldier(u.key) || u.anim === "gehen" || u.order.t === "station") continue;
    let px = 0, py = 0;
    w.grid.query(u.x, u.y, R, (o) => {
      if (o === u || o.dead || o.layer !== u.layer) return;
      let dx = u.x - o.x, dy = u.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d >= R) return;
      if (d < 1e-4) { dx = u.id < o.id ? 1 : -1; dy = 0; } else { dx /= d; dy /= d; }
      const f = (R - Math.max(d, 1e-4)) * 0.2;
      px += dx * f; py += dy * f;
    });
    if (!px && !py) continue;
    const nx = u.x + px, ny = u.y + py;
    if (Math.floor(nx) === Math.floor(u.x) && Math.floor(ny) === Math.floor(u.y)) { u.x = nx; u.y = ny; continue; }
    const fx = Math.floor(nx), fy = Math.floor(ny), ox = Math.floor(u.x), oy = Math.floor(u.y);
    if (!w.inMap(fx, fy) || !w.nav.open(w.nav.node(u.layer, fx, fy), u.team)) continue;
    // nicht diagonal an einer gesperrten Ecke vorbei
    if (fx !== ox && fy !== oy && (!w.nav.open(w.nav.node(u.layer, fx, oy), u.team) || !w.nav.open(w.nav.node(u.layer, ox, fy), u.team))) continue;
    u.x = nx; u.y = ny;
  }
}
