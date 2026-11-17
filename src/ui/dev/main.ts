/**
 * Prüfstand der Oberfläche (ui-test.html): Mock-Brücke, einfache Szene dahinter, Tastatur wie im Spiel
 * (hier im Prüfstand nachgebildet, im Spiel macht das src/app) und ein Bedienfeld zum Auswählen und Auslösen.
 */
import { mountUi } from "../index";
import { createMockBridge } from "./mock";
import { createScene } from "./scene";

const mock = createMockBridge();
const { bridge } = mock;
const s = bridge.state();
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const scene = createScene(canvas, bridge, mock.sprites);
mock.setCorners(scene.corners);
mountUi(document.getElementById("ui")!, bridge);

// ------------------------------------------------------------ Maus: Auswahl in der Szene
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const [wx, wy] = scene.pick(e.clientX, e.clientY);
  const tool = bridge.tool();
  const near = s.units.filter((u) => !u.dead && Math.hypot(u.x - wx, u.y - wy) < 0.9).sort((a, b) => Math.hypot(a.x - wx, a.y - wy) - Math.hypot(b.x - wx, b.y - wy));
  const bid = s.tiles[Math.floor(wy) * s.w + Math.floor(wx)]?.building ?? 0;
  if (tool.t === "bauen" || tool.t === "mauer") {
    const r = bridge.dispatch(tool.t === "bauen" ? { t: "bauen", key: tool.key, x: Math.floor(wx), y: Math.floor(wy), o: tool.o } : { t: "mauer", x0: Math.floor(wx), y0: Math.floor(wy), x1: Math.floor(wx), y1: Math.floor(wy) });
    if (!r.ok) bridge.notify(r.reason ?? "Hier nicht möglich.", "warnung");
    return;
  }
  if (tool.t === "abriss") {
    if (bid) bridge.dispatch({ t: "abreissen", id: bid });
    else bridge.notify("Hier steht nichts zum Abreißen.", "warnung");
    return;
  }
  if (near.length) bridge.select({ units: [near[0].id], building: null });
  else if (bid) bridge.select({ units: [], building: bid });
  else bridge.select({ units: [], building: null });
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ------------------------------------------------------------ Tastatur (im Spiel: src/app)
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const sel = bridge.selection();
  switch (e.key.toLowerCase()) {
    case "q": bridge.rotate(-1); break;
    case "e": bridge.rotate(1); break;
    case "r": { const t = bridge.tool(); if (t.t === "bauen") bridge.setTool({ ...t, o: (t.o + 1) % 4 }); break; }
    case "t": if (sel.units.length) bridge.dispatch({ t: "stationieren", units: sel.units }); break;
    case "h": if (sel.units.length) bridge.dispatch({ t: "halten", units: sel.units }); break;
    case " ": e.preventDefault(); bridge.setSpeed(bridge.speed() === 0 ? 1 : 0); break;
    case "escape":
      if (bridge.tool().t !== "auswahl") bridge.setTool({ t: "auswahl" });
      else bridge.select({ units: [], building: null });
      break;
    default: return;
  }
});
addEventListener("wheel", (e) => { if (e.target === canvas) bridge.zoom(e.deltaY < 0 ? 1 : -1); }, { passive: true });

// ------------------------------------------------------------ Bedienfeld
const panel = document.getElementById("dev")!;
const byKey = (k: string) => s.buildings.find((b) => b.key === k);
const own = () => s.units.filter((u) => u.team === 0 && !u.dead);
const actions: [string, () => void][] = [
  ["Lager", () => bridge.select({ units: [], building: byKey("lager")?.id ?? null })],
  ["Kaserne", () => bridge.select({ units: [], building: byKey("kaserne")?.id ?? null })],
  ["Holzfäller", () => bridge.select({ units: [], building: byKey("holzfaeller")?.id ?? null })],
  ["Baustelle", () => bridge.select({ units: [], building: s.buildings.find((b) => b.built < 1)?.id ?? null })],
  ["Turm", () => bridge.select({ units: [], building: byKey("turm")?.id ?? null })],
  ["Bogenschütze", () => bridge.select({ units: [own().find((u) => u.key === "bogen")!.id], building: null })],
  ["Träger", () => bridge.select({ units: [own().find((u) => u.carry)!.id], building: null })],
  ["Gruppe", () => bridge.select({ units: own().filter((u) => u.key !== "tageloehner").map((u) => u.id), building: null })],
  ["Feind", () => bridge.select({ units: s.units.filter((u) => u.team === 1).map((u) => u.id), building: null })],
  ["Nichts", () => bridge.select({ units: [], building: null })],
  ["Meldung", () => mock.message("Ein Tagelöhner ist zugezogen.", "info")],
  ["Warnung", () => mock.message("Das Lagerhaus ist fast voll.", "warnung")],
  ["Kampf", () => mock.message("Ein Speerträger ist gefallen.", "kampf")],
  ["Hinweis", () => bridge.notify("Muss an Fels grenzen.", "warnung")],
  ["Überfall", () => bridge.dispatch({ t: "ueberfall" })],
];
const btns = document.createElement("div");
btns.className = "dev-btns";
for (const [label, fn] of actions) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = fn;
  btns.append(b);
}
const logEl = document.createElement("ol");
logEl.className = "dev-log";
mock.onLog(() => {
  logEl.textContent = "";
  for (const c of mock.log.slice(-5).reverse()) {
    const li = document.createElement("li");
    const { result, ...cmd } = c;
    li.textContent = `${JSON.stringify(cmd)} → ${result.ok ? "ok" : result.reason}`;
    logEl.append(li);
  }
});
panel.append(btns, logEl);
document.getElementById("dev-toggle")!.onclick = () => panel.classList.toggle("dev-closed");
(window as unknown as { mk: unknown }).mk = mock;

// ------------------------------------------------------------ Zustand per Adresse (für Bildschirmfotos): ?sel=lager&tab=militaer&detail=armbrust&help=1
const q = new URLSearchParams(location.search);
setTimeout(() => {
  if (q.get("rec")) {
    const k = byKey("kaserne");
    if (k) { bridge.dispatch({ t: "rekrutieren", building: k.id, unit: "bogen" }); bridge.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" }); }
  }
  const a = actions.find(([l]) => l.toLowerCase() === q.get("sel"));
  if (a) a[1]();
  const tab = q.get("tab");
  if (tab) (document.querySelector(`.mk-tab[data-cat="${tab}"]`) as HTMLElement | null)?.click();
  const det = q.get("detail");
  if (det) setTimeout(() => (document.querySelector(`.mk-ucard[data-unit="${det}"]`) as HTMLElement | null)?.click(), 300);
  if (q.get("help")) dispatchEvent(new KeyboardEvent("keydown", { key: "F1" }));
  if (q.get("toast")) bridge.notify("Muss an Fels grenzen.", "warnung");
}, 500);
