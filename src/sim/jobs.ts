/**
 * Aufträge der Arbeiter ausführen: Arbeitszyklen aus den Gebäudedaten (reserveNearest, walkTo, work, deposit),
 * Tragen (Hof → Lager, Lager → Baustelle, Waffe → Kaserne), Bauen und Anstellen.
 * Jede Ware wechselt nur dann den Ort, wenn die Figur am Ziel steht; unterwegs trägt sie sie sichtbar (carry).
 */
import { BUILDINGS, TUNING, UNITS, type CycleStep, type Good } from "../data";
import { center, entrance, footprintTiles } from "./geom";
import { buildCap, canWork, completeBuilding, useMaterial } from "./build";
import { goalAround, goalEntrance, goalSlot, stop, tileGoal, travel, unitNode, type TravelGoal } from "./move";
import { reservePut, tidy } from "./storage";
import type { Rock, Tree } from "./types";
import { TPS, face, setAnim, type Job, type SBuilding, type SUnit, type World } from "./world";

type CycleJob = Extract<Job, { k: "cycle" }>;

export function runJob(w: World, u: SUnit): void {
  const j = u.ai.job!;
  switch (j.k) {
    case "cycle": return runCycle(w, u, j);
    case "employ": return runEmploy(w, u, j);
    case "haul": return runHaul(w, u, j);
    case "supply": return runSupply(w, u, j);
    case "build": return runBuild(w, u, j);
    case "recruit": return runRecruit(w, u, j);
  }
}

// ---------------------------------------------------------------- Arbeitszyklus
function runCycle(w: World, u: SUnit, j: CycleJob): void {
  const home = w.buildings.get(u.home);
  if (!home || home.built < 1) { toPeasant(w, u); return; }
  const def = BUILDINGS[home.key];
  const cycle = def.workers!.cycle;
  const step = cycle[j.step];
  const next = () => {
    j.step = (j.step + 1) % cycle.length; j.t = 0;
    if (j.step === 0) releaseTarget(w, u, j);
  };
  const restart = (waitTicks = 0) => { releaseTarget(w, u, j); j.step = 0; j.t = 0; j.wait = waitTicks; };

  switch (step.do) {
    case "reserveNearest": {
      if (j.tgt && targetOf(w, j, step.tag)) { next(); return; }
      if (j.wait > 0) { j.wait--; idleAt(w, u, home); return; }
      const t = findTarget(w, home, step.tag, step.radius, u);
      if (!t) {
        j.wait = 3 * TPS;
        idleAt(w, u, home);
        w.msg(step.tag === "tree" ? `${def.name}: keine Bäume mehr in Reichweite.` : `${def.name}: kein Fels mehr in Reichweite.`, "warnung", `leer-${home.id}`, 60, "rohstoff_leer");
        return;
      }
      t.reservedBy = u.id; j.tgt = t.id;
      next();
      return;
    }
    case "walkTo": {
      let goal;
      if (step.target === "home") goal = goalEntrance(w, home);
      else {
        const t = targetOf(w, j);
        if (!t) { restart(); return; }
        goal = tileGoal(t.x, t.y, 0, 1);
      }
      const r = travel(w, u, goal);
      if (r === "arrived") next();
      else if (r === "unreachable") restart(2 * TPS);
      return;
    }
    case "work": return runWork(w, u, j, step, home, next, restart);
    case "deposit": {
      if (!u.carry) { next(); return; }
      const out = home.output, cap = def.output?.capacity ?? 0;
      if (out && out.good === u.carry && out.amount < cap) { out.amount++; u.carry = null; next(); return; }
      // Hof voll: sichtbar warten, jeder Arbeiter an seinem eigenen Fleck neben dem Eingang
      if (travel(w, u, waitGoal(w, home, u)) !== "moving") setAnim(u, "stehen");
      w.msg(`${def.name}: der Hof ist voll, die Arbeit ruht.`, "warnung", `hofvoll-${home.id}`, 45, "hof_voll");
      return;
    }
  }
}

function runWork(w: World, u: SUnit, j: CycleJob, step: Extract<CycleStep, { do: "work" }>, home: SBuilding, next: () => void, restart: (t?: number) => void): void {
  const t = j.tgt ? targetOf(w, j) : null;
  if (step.effect) {
    if (!t) { restart(); return; }
    if (step.effect === "fellTree") {
      const tree = t as Tree;
      if (tree.state === "liegt") { next(); return; } // liegt schon: gleich zerlegen
      if (tree.state !== "stehend") { restart(); return; }
    } else if (step.effect === "cutTree") {
      const tree = t as Tree;
      if (tree.state === "faellt") { setAnim(u, "stehen"); return; } // abwarten, bis er liegt
      if (tree.state !== "liegt" || tree.logs <= 0) { restart(); return; }
    } else if ((t as Rock).amount <= 0) { restart(); return; }
    face(u, t.x + 0.5 - u.x, t.y + 0.5 - u.y);
  }
  setAnim(u, step.anim);
  if (j.t < step.seconds * TPS) { j.t++; return; }
  // Fertig: Ware erzeugen (getragen oder in den Hof); bei vollem Hof warten
  const produce = Object.entries(step.produce ?? {}) as [Good, number][];
  if (produce.length && !step.carry) {
    const out = home.output, cap = BUILDINGS[home.key].output?.capacity ?? 0;
    const n = produce.reduce((a, [, k]) => a + k, 0);
    if (!out || out.amount + n > cap) { setAnim(u, "stehen"); return; }
    out.amount += n;
  }
  if (step.effect && t) applyEffect(w, u, step.effect, t);
  if (produce.length && step.carry) u.carry = produce[0][0];
  next();
}

function applyEffect(w: World, u: SUnit, effect: NonNullable<Extract<CycleStep, { do: "work" }>["effect"]>, t: Tree | Rock): void {
  if (effect === "fellTree") {
    const tree = t as Tree;
    let dx = tree.x + 0.5 - u.x, dy = tree.y + 0.5 - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    tree.state = "faellt"; tree.progress = 0; tree.fallX = dx; tree.fallY = dy; tree.logs = TUNING.treeLogs;
  } else if (effect === "cutTree") {
    const tree = t as Tree;
    tree.logs--;
    tree.progress = 1 - tree.logs / TUNING.treeLogs;
    if (tree.logs <= 0) { tree.state = "stumpf"; tree.reservedBy = 0; tree.progress = 1; }
  } else {
    const rock = t as Rock;
    rock.amount--;
    if (rock.amount <= 0) {
      w.s.rocks = w.s.rocks.filter((r) => r !== rock);
      w.nav.rebuild();
    }
  }
}

function targetOf(w: World, j: CycleJob, tag?: "tree" | "rock"): Tree | Rock | null {
  if (!j.tgt) return null;
  if (tag !== "rock") { const t = w.s.trees.find((x) => x.id === j.tgt); if (t) return t.state === "stumpf" ? null : t; }
  if (tag !== "tree") { const r = w.s.rocks.find((x) => x.id === j.tgt); if (r) return r.amount > 0 ? r : null; }
  return null;
}

function releaseTarget(w: World, u: SUnit, j: CycleJob): void {
  if (!j.tgt) return;
  for (const t of w.s.trees) if (t.id === j.tgt && t.reservedBy === u.id) t.reservedBy = 0;
  for (const r of w.s.rocks) if (r.id === j.tgt && r.reservedBy === u.id) r.reservedBy = 0;
  j.tgt = 0;
}

/** Nächster freier Baum (liegende zuerst) bzw. Felsbrocken im Umkreis des Gebäudes, der erreichbar ist. */
function findTarget(w: World, home: SBuilding, tag: "tree" | "rock", radius: number, u: SUnit): Tree | Rock | null {
  const [cx, cy] = center(home.key, home.x, home.y, home.o);
  const nav = w.nav;
  const myComp = nav.comp[0][nav.node(u.layer, Math.floor(u.x), Math.floor(u.y))];
  const reach = (x: number, y: number) => myComp < 0 || nav.goalInComp(tileGoal(x, y, 0, 1), 0, myComp);
  let best: Tree | Rock | null = null, bestScore = Infinity;
  const list: (Tree | Rock)[] = tag === "tree" ? w.s.trees : w.s.rocks;
  for (const t of list) {
    if (t.reservedBy && t.reservedBy !== u.id) continue;
    let score = Math.hypot(t.x + 0.5 - cx, t.y + 0.5 - cy);
    if (score > radius) continue;
    if (tag === "tree") {
      const tree = t as Tree;
      if (tree.state === "liegt" && tree.logs > 0) score -= 100;
      else if (tree.state !== "stehend") continue;
    } else if ((t as Rock).amount <= 0) continue;
    if (score < bestScore && reach(t.x, t.y)) { best = t; bestScore = score; }
  }
  return best;
}

function idleAt(w: World, u: SUnit, home: SBuilding): void {
  const r = travel(w, u, waitGoal(w, home, u));
  if (r !== "moving") setAnim(u, "stehen");
}

/**
 * Wartefleck eines Arbeiters an seiner Werkstatt: der erste Arbeiter vor der Tür, jeder weitere auf einem freien
 * Nachbarfeld des Eingangs (außerhalb des Grundrisses), damit wartende Figuren nicht deckungsgleich stehen.
 */
export function waitGoal(w: World, home: SBuilding, u: SUnit): TravelGoal {
  const i = Math.max(0, home.workers.indexOf(u.id));
  const door = goalEntrance(w, home);
  if (i === 0 || door.x0 !== door.x1 || door.y0 !== door.y1) return door;
  const [ex, ey] = entrance(home.key, home.x, home.y, home.o);
  const fp = new Set(footprintTiles(home.key, home.x, home.y, home.o).map(([x, y]) => `${x},${y}`));
  const spots: [number, number][] = [];
  for (const [dx, dy] of WAIT_OFFSETS) {
    const x = ex + dx, y = ey + dy;
    if (!w.inMap(x, y) || fp.has(`${x},${y}`) || !w.nav.open(w.nav.node(0, x, y), 0)) continue;
    spots.push([x, y]);
  }
  if (!spots.length) return door;
  const [x, y] = spots[(i - 1) % spots.length];
  return tileGoal(x, y);
}
const WAIT_OFFSETS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

// ---------------------------------------------------------------- Anstellen, Tragen, Bauen, Rekrutieren
function runEmploy(w: World, u: SUnit, j: Extract<Job, { k: "employ" }>): void {
  const b = w.buildings.get(j.b);
  if (!b || b.built < 1) { releaseJob(w, u); return; }
  const r = travel(w, u, goalEntrance(w, b));
  if (r === "unreachable") { giveUp(w, u); return; }
  if (r !== "arrived") return;
  const key = BUILDINGS[b.key].workers!.unit;
  const frac = u.hp / u.maxHp;
  u.key = key; u.maxHp = UNITS[key].hp; u.hp = Math.max(1, Math.round(u.maxHp * frac));
  u.home = b.id; u.order = { t: "job" };
  u.ai.job = { k: "cycle", step: 0, t: 0, tgt: 0, wait: 0 };
}

function runHaul(w: World, u: SUnit, j: Extract<Job, { k: "haul" }>): void {
  if (j.ph === 0) {
    const src = w.buildings.get(j.from);
    if (!src || !src.output) { releaseJob(w, u); return; }
    const r = travel(w, u, goalEntrance(w, src));
    if (r === "unreachable") { giveUp(w, u); return; }
    if (r !== "arrived") return;
    src.output.amount--; src.output.reserved--;
    u.carry = j.good; j.ph = 1;
    return;
  }
  const dst = w.buildings.get(j.to);
  if (!dst || !dst.slots[j.slot]) { retargetHaul(w, u, j); return; }
  const r = travel(w, u, goalSlot(dst, j.slot));
  if (r === "unreachable") { const s = dst.slots[j.slot]; s.incoming--; tidy(s); j.to = 0; retargetHaul(w, u, j); return; }
  if (r !== "arrived") return;
  const s = dst.slots[j.slot];
  s.incoming--; s.amount++;
  if (s.good !== j.good) s.good = j.good;
  u.carry = null; u.ai.job = null; u.order = { t: "idle" };
}

/** Träger mit Ware ohne Ziel sucht ein neues Lager (alle Sekunde), sonst wartet er mit der Last. */
function retargetHaul(w: World, u: SUnit, j: Extract<Job, { k: "haul" }>): void {
  setAnim(u, "stehen");
  if ((w.s.tick + u.id) % TPS !== 0) return;
  const ref = reservePut(w, j.good, u.x, u.y);
  if (ref) { j.to = ref.b.id; j.slot = ref.k; }
  else w.msg("Das Lager ist voll! Baue einen weiteren Lagerplatz.", "warnung", "lagervoll", 30, "lager_voll");
}

function runSupply(w: World, u: SUnit, j: Extract<Job, { k: "supply" }>): void {
  const site = w.buildings.get(j.site);
  if (j.ph === 0) {
    const st = w.buildings.get(j.from);
    if (!site || !st || !st.slots[j.slot]) { releaseJob(w, u); return; }
    const r = travel(w, u, goalSlot(st, j.slot));
    if (r === "unreachable") { giveUp(w, u); return; }
    if (r !== "arrived") return;
    const s = st.slots[j.slot];
    s.amount--; s.reserved--; tidy(s);
    u.carry = j.good; j.ph = 1;
    site.ai.picked[j.good] = (site.ai.picked[j.good] ?? 0) + 1;
    return;
  }
  if (!site) { carryBack(w, u); return; }
  const r = travel(w, u, goalAround(site));
  if (r === "unreachable") { releaseJob(w, u, true); carryBack(w, u); return; }
  if (r !== "arrived") return;
  dec(site.needs, j.good); dec(site.ai.enroute, j.good); dec(site.ai.picked, j.good);
  site.site[j.good] = (site.site[j.good] ?? 0) + 1;
  u.carry = null; u.ai.job = null; u.order = { t: "idle" };
}

/** Arbeitszeit an einem Standplatz, bevor der Bauarbeiter auf eine andere Seite der Baustelle wechselt. */
const SPOT_TICKS = 5 * TPS;

/**
 * Bauen: Der Bauarbeiter hämmert an einem Standplatz neben dem Grundriss und wechselt alle paar Sekunden die Seite.
 * Jeder Tick Arbeit bringt 1 / (buildSeconds · TPS) Fortschritt, aber nie mehr, als das verbaute Material erlaubt
 * (buildCap). Ist die Grenze erreicht, verbaut er das nächste Stück von der Baustelle; liegt keines da, wartet er nicht
 * untätig, sondern gibt den Auftrag zurück (der Disponent holt ihn wieder, sobald Material geliefert ist).
 */
function runBuild(w: World, u: SUnit, j: Extract<Job, { k: "build" }>): void {
  const site = w.buildings.get(j.site);
  if (!site || site.built >= 1 || !canWork(site)) { releaseJob(w, u); return; }
  const r = travel(w, u, buildSpot(w, u, site, j));
  if (r === "unreachable") {
    if ((j.spot ?? 0) >= 0) { j.spot = -1; return; } // Standplatz versperrt: irgendwo daneben
    giveUp(w, u); return;
  }
  if (r !== "arrived") return;
  const def = BUILDINGS[site.key];
  const [cx, cy] = center(site.key, site.x, site.y, site.o);
  face(u, cx - u.x, cy - u.y);
  const step = 1 / (def.buildSeconds * TPS);
  if (site.built + step > buildCap(site) + 1e-9) useMaterial(site);
  const cap = buildCap(site);
  if (site.built >= cap - 1e-9 && cap < 1) { releaseJob(w, u); setAnim(u, "stehen"); return; }
  setAnim(u, "bauen");
  site.built = Math.min(1, cap, site.built + step);
  if (site.built > cap - 1e-6) site.built = cap; // Rundung: an der Materialgrenze genau einrasten (sonst 0,99999…)
  site.hp = Math.max(site.hp, Math.round(def.hp * (0.2 + 0.8 * site.built)));
  j.t = (j.t ?? 0) + 1;
  if (j.t >= SPOT_TICKS) { j.t = 0; j.spot = (j.spot ?? 0) + 1; } // nächste Seite
  if (site.built >= 1) {
    completeBuilding(w, site);
    u.ai.job = null; u.order = { t: "idle" };
    setAnim(u, "stehen");
  }
}

/**
 * Standplatz j.spot rund um den Grundriss: die freien Felder im Abstand 1 (ohne Ecken), reihum; −1 oder keiner frei =
 * irgendwo daneben. Reihenfolge über die Seiten verteilt (Nachbarseiten im Wechsel), damit er sichtbar herumgeht.
 */
function buildSpot(w: World, u: SUnit, site: SBuilding, j: Extract<Job, { k: "build" }>): TravelGoal {
  const around = goalAround(site);
  const k = j.spot ?? 0;
  if (k < 0) return around;
  const spots: [number, number][] = [];
  const comp = w.nav.comp[0][unitNode(w, u)];
  const { x0, y0, x1, y1 } = around;
  const sides: [number, number][][] = [[], [], [], []];
  for (let x = x0; x <= x1; x++) { sides[0].push([x, y0 - 1]); sides[2].push([x, y1 + 1]); }
  for (let y = y0; y <= y1; y++) { sides[1].push([x1 + 1, y]); sides[3].push([x0 - 1, y]); }
  for (const side of [0, 1, 2, 3].map((i) => sides[(i * 3 + site.id) % 4])) {
    const free = side.filter(([x, y]) => w.inMap(x, y) && w.nav.open(w.nav.node(0, x, y), 0)
      && (comp < 0 || w.nav.comp[0][w.nav.node(0, x, y)] === comp)); // nur von hier erreichbare Seiten
    if (free.length) spots.push(free[(site.id + k) % free.length]);
  }
  if (!spots.length) return around;
  const [x, y] = spots[k % spots.length];
  return tileGoal(x, y);
}

function runRecruit(w: World, u: SUnit, j: Extract<Job, { k: "recruit" }>): void {
  const b = w.buildings.get(j.b);
  if (j.ph === 0) {
    const st = w.buildings.get(j.from);
    if (!b || !st || !st.slots[j.slot]) { releaseJob(w, u); return; }
    const r = travel(w, u, goalSlot(st, j.slot));
    if (r === "unreachable") { giveUp(w, u); return; }
    if (r !== "arrived") return;
    const s = st.slots[j.slot];
    s.amount--; s.reserved--; tidy(s);
    u.carry = j.good; j.ph = 1;
    b.ai.recruitPicked = true;
    return;
  }
  if (!b) { carryBack(w, u); return; }
  const r = travel(w, u, goalEntrance(w, b));
  if (r === "unreachable") { releaseJob(w, u, true); carryBack(w, u); return; }
  if (r !== "arrived") return;
  // Eintreten: der Tagelöhner verschwindet in der Kaserne und kommt als Soldat wieder heraus
  const qi = b.queue.indexOf(j.unit);
  if (qi >= 0) b.queue.splice(qi, 1);
  b.training = { unit: j.unit, recruit: u.id, t: 0, dur: UNITS[j.unit].train!.seconds };
  b.ai.recruit = 0; b.ai.recruitPicked = false;
  u.carry = null; u.ai.job = null; stop(u);
  b.ai.inside = u;
  w.removeUnit(u);
}

// ---------------------------------------------------------------- Aufräumen
/** Ziel unerreichbar: Auftrag zurückgeben und eine Weile keinen neuen bekommen (der Disponent nimmt einen anderen). */
function giveUp(w: World, u: SUnit): void {
  releaseJob(w, u);
  u.ai.noJob = w.s.tick + 5 * TPS;
}

const dec = (rec: Partial<Record<Good, number>>, g: Good) => { const n = (rec[g] ?? 0) - 1; if (n > 0) rec[g] = n; else delete rec[g]; };

/** Auftrag abbrechen und alle Reservierungen zurückgeben. keepCarry: Ware bleibt in der Hand. */
export function releaseJob(w: World, u: SUnit, keepCarry = false): void {
  const j = u.ai.job;
  if (j) {
    switch (j.k) {
      case "cycle": releaseTarget(w, u, j); break;
      case "employ": { const b = w.buildings.get(j.b); if (b) b.workers = b.workers.filter((id) => id !== u.id); break; }
      case "haul": {
        const src = w.buildings.get(j.from);
        if (j.ph === 0 && src?.output) src.output.reserved--;
        const s = w.buildings.get(j.to)?.slots[j.slot];
        if (s) { s.incoming--; tidy(s); }
        break;
      }
      case "supply": {
        const s = w.buildings.get(j.from)?.slots[j.slot];
        if (j.ph === 0 && s) { s.reserved--; tidy(s); }
        const site = w.buildings.get(j.site);
        if (site) { dec(site.ai.enroute, j.good); if (j.ph === 1) dec(site.ai.picked, j.good); }
        break;
      }
      case "build": { const site = w.buildings.get(j.site); if (site && site.ai.builder === u.id) site.ai.builder = 0; break; }
      case "recruit": {
        const s = w.buildings.get(j.from)?.slots[j.slot];
        if (j.ph === 0 && s) { s.reserved--; tidy(s); }
        const b = w.buildings.get(j.b);
        if (b && b.ai.recruit === u.id) { b.ai.recruit = 0; b.ai.recruitPicked = false; }
        break;
      }
    }
  }
  u.ai.job = null;
  if (!keepCarry) u.carry = null;
  if (u.order.t === "job" && UNITS[u.key].role === "arbeiter" && u.key === "tageloehner") u.order = { t: "idle" };
}

/** Getragene Ware zurück ins Lager bringen (Auftrag ohne Ziel, wenn gerade kein Platz ist). */
function carryBack(w: World, u: SUnit): void {
  const good = u.carry;
  u.ai.job = null;
  if (!good) return;
  const ref = reservePut(w, good, u.x, u.y);
  u.ai.job = { k: "haul", from: 0, to: ref ? ref.b.id : 0, slot: ref ? ref.k : 0, good, ph: 1 };
  u.order = { t: "job" };
}

/** Arbeiter verliert seine Werkstatt: wird wieder Tagelöhner, getragene Ware geht ins Lager. */
export function toPeasant(w: World, u: SUnit): void {
  const j = u.ai.job;
  if (j?.k === "cycle") releaseTarget(w, u, j);
  u.ai.job = null;
  const frac = u.hp / u.maxHp;
  u.key = "tageloehner"; u.maxHp = UNITS.tageloehner.hp; u.hp = Math.max(1, Math.round(u.maxHp * frac));
  u.home = 0; u.order = { t: "idle" };
  stop(u);
  if (u.carry) carryBack(w, u);
}

/** Ein Gebäude verschwindet: alle Aufträge, die es betreffen, abbrechen oder umleiten. */
export function abortJobsAt(w: World, b: SBuilding): void {
  for (const u of w.s.units) {
    if (u.dead) continue;
    if (u.home === b.id) { toPeasant(w, u); continue; }
    const j = u.ai.job;
    if (!j) continue;
    switch (j.k) {
      case "employ": if (j.b === b.id) releaseJob(w, u); break;
      case "build": if (j.site === b.id) releaseJob(w, u); break;
      case "haul":
        if (j.ph === 0 && (j.from === b.id || j.to === b.id)) releaseJob(w, u);
        else if (j.ph === 1 && j.to === b.id) { j.to = 0; }
        break;
      case "supply":
        if (j.ph === 0 && (j.site === b.id || j.from === b.id)) releaseJob(w, u);
        else if (j.ph === 1 && j.site === b.id) { u.ai.job = null; carryBack(w, u); }
        break;
      case "recruit":
        if (j.ph === 0 && (j.b === b.id || j.from === b.id)) releaseJob(w, u);
        else if (j.ph === 1 && j.b === b.id) { u.ai.job = null; carryBack(w, u); }
        break;
      case "cycle": break;
    }
  }
}
