/**
 * Bewegung entlang von Pfaden. Einheiten laufen von Knotenmitte zu Knotenmitte, die Höhe z gleitet linear
 * zur Höhe des nächsten Knotens (so steigt sie sichtbar entlang der Treppe). Pfadsuchen sind pro Tick
 * begrenzt (World.budget); wer keine bekommt, wartet einen Tick.
 */
import { UNITS } from "../data";
import { BUILDINGS } from "../data";
import { entrance, footprint, slotTile } from "./geom";
import type { Goal } from "./nav";
import { TPS, face, setAnim, type SBuilding, type SUnit, type World } from "./world";

export interface TravelGoal extends Goal {
  /** Genaue Endposition (z. B. Posten), sonst Tile-Mitte. */
  endX?: number; endY?: number;
  /** Belagerungsmodus: Gebäude sind (teuer) passierbar, travel meldet "blocked" davor. */
  breach?: boolean;
}

export type TravelResult = "arrived" | "moving" | "waiting" | "unreachable" | "blocked";

export function goalKey(g: TravelGoal): string {
  return `${g.layer},${g.x0},${g.y0},${g.x1},${g.y1},${g.d}` + (g.endX !== undefined ? `@${g.endX},${g.endY}` : "") + (g.breach ? "b" : "");
}

export function tileGoal(x: number, y: number, layer = 0, d = 0): TravelGoal {
  return { layer, x0: x, y0: y, x1: x, y1: y, d };
}

/** Knoten, auf dem die Einheit gerade steht. */
export function unitNode(w: World, u: SUnit): number {
  const x = Math.min(w.s.w - 1, Math.max(0, Math.floor(u.x)));
  const y = Math.min(w.s.h - 1, Math.max(0, Math.floor(u.y)));
  return w.nav.node(u.layer, x, y);
}

export function stop(u: SUnit): void {
  u.ai.path = null; u.ai.pi = 0; u.ai.goal = "";
}

/**
 * Einen Tick in Richtung Ziel gehen. Gibt "arrived" zurück, sobald das Ziel erreicht ist (und bleibt dabei,
 * solange dasselbe Ziel angefragt wird).
 */
export function travel(w: World, u: SUnit, g: TravelGoal): TravelResult {
  const ai = u.ai, nav = w.nav;
  const key = goalKey(g);
  if (ai.goal !== key) { ai.goal = key; ai.path = null; ai.pi = 0; ai.wait = 0; }
  if (ai.path && ai.navV !== w.meta.navVersion) {
    // Raster hat sich geändert: Rest des Wegs prüfen
    ai.navV = w.meta.navVersion;
    for (let i = ai.pi; i < ai.path.length; i++) {
      if (nav.pass(ai.path[i], u.team, !!g.breach) < 0) { ai.path = null; break; }
    }
  }
  if (!ai.path) {
    if (ai.wait > 0) { ai.wait--; setAnim(u, "stehen"); return "waiting"; }
    if (w.budget <= 0) { setAnim(u, "stehen"); return "waiting"; }
    w.budget--;
    const path = nav.route(u.team, !!g.breach, unitNode(w, u), g);
    if (!path) { ai.wait = 2 * TPS; setAnim(u, "stehen"); return "unreachable"; }
    ai.path = path; ai.pi = 0; ai.navV = w.meta.navVersion;
    ai.hasEnd = g.endX !== undefined; ai.endX = g.endX ?? 0; ai.endY = g.endY ?? 0;
  }
  // Belagerung: vor einem Gebäude stehen bleiben, das erst eingerissen werden muss
  if (g.breach && ai.pi < ai.path.length) {
    const n = ai.path[ai.pi];
    if (!nav.open(n, u.team)) {
      const cx = nav.tileX(n) + 0.5, cy = nav.tileY(n) + 0.5;
      if (Math.hypot(cx - u.x, cy - u.y) <= 1.5) { setAnim(u, "stehen"); return "blocked"; }
    }
  }
  return advance(w, u) ? "arrived" : "moving";
}

/** Nächster Knoten, an dem eine Einheit im Belagerungsmodus steht (oder −1). */
export function blockedNode(u: SUnit): number {
  const ai = u.ai;
  return ai.path && ai.pi < ai.path.length ? ai.path[ai.pi] : -1;
}

/** Läuft den Weg einen Tick weiter. true = Ende erreicht. */
function advance(w: World, u: SUnit): boolean {
  const ai = u.ai, nav = w.nav, path = ai.path!;
  let budget = speedOf(w, u) / TPS;
  while (budget > 1e-6) {
    let tx: number, ty: number, tz: number, layer: number;
    if (ai.pi < path.length) {
      const n = path[ai.pi];
      layer = nav.layerOf(n);
      tz = nav.z[n];
      if (ai.pi === path.length - 1 && ai.hasEnd) { tx = ai.endX; ty = ai.endY; }
      else { tx = nav.tileX(n) + 0.5; ty = nav.tileY(n) + 0.5; }
    } else if (ai.hasEnd && (Math.abs(u.x - ai.endX) > 1e-6 || Math.abs(u.y - ai.endY) > 1e-6)) {
      tx = ai.endX; ty = ai.endY; tz = u.z; layer = u.layer;
    } else break;
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    face(u, dx, dy);
    if (d <= budget) {
      u.x = tx; u.y = ty; u.z = tz; u.layer = layer;
      budget -= d;
      if (ai.pi < path.length) ai.pi++;
      else break;
    } else {
      const f = budget / d;
      u.x += dx * f; u.y += dy * f; u.z += (tz - u.z) * f;
      budget = 0;
    }
  }
  const done = ai.pi >= path.length && (!ai.hasEnd || (Math.abs(u.x - ai.endX) < 1e-6 && Math.abs(u.y - ai.endY) < 1e-6));
  setAnim(u, done ? "stehen" : "gehen");
  return done;
}

/** Felder pro Sekunde am aktuellen Ort (Wege schneller, Wald und Fels langsamer). */
export function speedOf(w: World, u: SUnit): number {
  const base = UNITS[u.key].speed;
  if (u.layer > 0) return base;
  const x = Math.floor(u.x), y = Math.floor(u.y);
  if (!w.inMap(x, y)) return base;
  const c = w.nav.cost[y * w.s.w + x];
  return base * Math.min(1.45, Math.max(0.55, 1 / c));
}

/** Direkt (ohne Pfad) auf einen Punkt zugehen; nur für kurze, freie Strecken auf derselben Ebene. */
export function stepToward(w: World, u: SUnit, tx: number, ty: number, keep = 0): void {
  const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
  face(u, dx, dy);
  if (d <= keep) return;
  const step = Math.min(d - keep, speedOf(w, u) / TPS);
  const nx = u.x + (dx / d) * step, ny = u.y + (dy / d) * step;
  if (!w.nav.open(w.nav.node(u.layer, Math.floor(nx), Math.floor(ny)), u.team)) return;
  u.x = nx; u.y = ny;
  setAnim(u, "gehen");
}

/** Freie Sicht/Strecke am Boden bzw. auf derselben Ebene (Raster abtasten). */
export function lineClear(w: World, u: SUnit, tx: number, ty: number): boolean {
  const d = Math.hypot(tx - u.x, ty - u.y);
  const steps = Math.ceil(d * 2);
  for (let i = 1; i <= steps; i++) {
    const x = u.x + ((tx - u.x) * i) / steps, y = u.y + ((ty - u.y) * i) / steps;
    if (!w.nav.open(w.nav.node(u.layer, Math.floor(x), Math.floor(y)), u.team)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- Ziele an Gebäuden
/** Rund um den Grundriss (Nachbar-Tiles am Boden). */
export function goalAround(b: SBuilding, breach = false): TravelGoal {
  const [fw, fh] = footprint(b.key, b.o);
  return { layer: 0, x0: b.x, y0: b.y, x1: b.x + fw - 1, y1: b.y + fh - 1, d: 1, breach };
}

/** Vor die Tür; wenn der Eingang zugebaut ist, irgendwo an den Grundriss. */
export function goalEntrance(w: World, b: SBuilding): TravelGoal {
  const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
  if (w.inMap(ex, ey) && w.nav.open(w.nav.node(0, ex, ey), 0)) return tileGoal(ex, ey);
  return goalAround(b);
}

/** An einen Lager-Slot (daneben stehen). */
export function goalSlot(b: SBuilding, k: number): TravelGoal {
  const [x, y] = slotTile(b.x, b.y, b.o, k);
  return tileGoal(x, y, 0, 1);
}

export function isWorkshop(b: SBuilding): boolean { return !!BUILDINGS[b.key].workers; }
