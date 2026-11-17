/**
 * Übersichtskarte unten links: Gelände, Bäume, Felsen, Gebäude und Einheiten aus dem Zustand,
 * als Raute in derselben Drehung wie die Kamera (toView mit view().r). 2 px pro Tile, höchstens ~3× pro Sekunde neu gezeichnet.
 * Darüber der Sichtbereich der Kamera (bridge.camera().corners) als Rahmen; Klicken oder Ziehen setzt die Kamera (lookAt).
 */
import type { UiBridge } from "../app/contract";
import type { TerrainKey } from "../data";
import { toView, type Rot } from "../sim/geom";
import type { SimState } from "../sim/types";
import { h } from "./dom";

const TERRAIN_RGB: Record<TerrainKey, [number, number, number]> = {
  gras: [92, 134, 58], wiese: [118, 150, 68], waldboden: [66, 96, 46], erde: [150, 118, 78], fels: [134, 128, 120], wasser: [52, 98, 132],
};
const TREE: [number, number, number] = [34, 66, 30];
const ROCK: [number, number, number] = [176, 170, 160];
const OWN_BUILDING: [number, number, number] = [196, 158, 102];
const FORT: [number, number, number] = [214, 208, 196];
const ENEMY_BUILDING: [number, number, number] = [160, 60, 50];
const S = 2;

export interface Minimap { el: HTMLElement; update(s: SimState, force?: boolean): void }

const SVG_NS = "http://www.w3.org/2000/svg";

/** Umkehrung von toView: Ansicht (u, v) → Welt (x, y). */
function fromView(u: number, v: number, r: Rot, W: number, H: number): [number, number] {
  switch (r) {
    case 1: return [v, H - u];
    case 2: return [W - u, H - v];
    case 3: return [W - v, u];
    default: return [u, v];
  }
}

export function createMinimap(bridge: UiBridge): Minimap {
  const canvas = h("canvas.mk-mini-canvas", { "aria-label": "Übersichtskarte", role: "img" });
  const grid = document.createElement("canvas");
  const north = h("span.mk-mini-north", { "aria-hidden": "true", text: "N" });
  // Sichtbereich als Vieleck über der Karte (gleiches Koordinatensystem wie das Canvas über viewBox)
  const frame = document.createElementNS(SVG_NS, "svg");
  frame.classList.add("mk-mini-view");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("preserveAspectRatio", "none");
  const poly = document.createElementNS(SVG_NS, "polygon");
  frame.append(poly);
  const el = h("div.mk-mini", { title: "Übersichtskarte: klicken oder ziehen, um dorthin zu blicken (dreht mit der Kamera)" }, canvas, frame, north);
  let last = 0;
  let geo = { w: 0, h: 0, gh: 0, cw: 0, ch: 0, r: 0 as Rot };

  /** Welt (Tiles) → Kartenpixel. */
  const toMap = (x: number, y: number): [number, number] => {
    const [a, b] = toView(x, y, geo.r, geo.w, geo.h);
    return [(a - b) * S + geo.gh * S, ((a + b) * S) / 2];
  };
  /** Bildschirmpunkt über der Karte → Welt (Tiles), auf die Karte begrenzt. */
  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const rc = canvas.getBoundingClientRect();
    const X = ((clientX - rc.left) / Math.max(1, rc.width)) * geo.cw, Y = ((clientY - rc.top) / Math.max(1, rc.height)) * geo.ch;
    const a = X / S - geo.gh, b = (2 * Y) / S;
    const [x, y] = fromView((a + b) / 2, (b - a) / 2, geo.r, geo.w, geo.h);
    return [Math.max(0, Math.min(geo.w, x)), Math.max(0, Math.min(geo.h, y))];
  };

  // ------------------------------------------------------------ Sichtbereich nachführen (nur bei Änderung)
  let lastPts = "", lastPoll = 0;
  const pollView = (now: number) => {
    requestAnimationFrame(pollView);
    if (now - lastPoll < 40 || !geo.cw || !el.isConnected) return;
    lastPoll = now;
    const cam = bridge.camera();
    const pts = cam.corners.length >= 3 ? cam.corners.map(([x, y]) => toMap(x, y).map((v) => v.toFixed(1)).join(",")).join(" ") : "";
    if (pts === lastPts) return;
    lastPts = pts;
    poly.setAttribute("points", pts);
    frame.style.display = pts ? "" : "none";
  };
  requestAnimationFrame(pollView);

  // ------------------------------------------------------------ Klicken und Ziehen
  let dragging = false, pendingLook: [number, number] | null = null;
  const look = (e: PointerEvent) => {
    if (!geo.cw) return;
    const first = !pendingLook;
    pendingLook = toWorld(e.clientX, e.clientY);
    if (first) requestAnimationFrame(() => { if (pendingLook) bridge.lookAt(pendingLook[0], pendingLook[1]); pendingLook = null; });
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add("mk-dragging");
    look(e);
  });
  el.addEventListener("pointermove", (e) => { if (dragging) look(e); });
  const stop = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("mk-dragging");
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);

  function draw(s: SimState): void {
    const r = (bridge.view().r & 3) as Rot;
    const odd = r % 2 === 1;
    const gw = odd ? s.h : s.w, gh = odd ? s.w : s.h;
    if (grid.width !== gw || grid.height !== gh) { grid.width = gw; grid.height = gh; }
    const cw = (gw + gh) * S, ch = ((gw + gh) * S) / 2;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    if (geo.cw !== cw || geo.ch !== ch) frame.setAttribute("viewBox", `0 0 ${cw} ${ch}`);
    if (geo.r !== r || geo.cw !== cw) lastPts = "";
    geo = { w: s.w, h: s.h, gh, cw, ch, r };

    const g = grid.getContext("2d")!;
    const img = g.createImageData(gw, gh);
    const px = img.data;
    const cell = (x: number, y: number): number => {
      const [u, v] = toView(x + 0.5, y + 0.5, r, s.w, s.h);
      return (Math.floor(v) * gw + Math.floor(u)) * 4;
    };
    const put = (i: number, c: [number, number, number], k = 1) => { px[i] = c[0] * k; px[i + 1] = c[1] * k; px[i + 2] = c[2] * k; px[i + 3] = 255; };
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const t = s.tiles[y * s.w + x];
      put(cell(x, y), TERRAIN_RGB[t.terrain], 0.94 + (t.variant % 4) * 0.03);
    }
    for (const t of s.trees) if (t.state === "stehend" || t.state === "faellt") put(cell(t.x, t.y), TREE);
    for (const k of s.rocks) if (k.amount > 0) put(cell(k.x, k.y), ROCK);
    const byId = new Map(s.buildings.map((b) => [b.id, b]));
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const id = s.tiles[y * s.w + x].building;
      if (!id) continue;
      const b = byId.get(id);
      if (!b) continue;
      const fort = b.key === "mauer" || b.key === "tor" || b.key === "turm" || b.key === "treppe";
      put(cell(x, y), b.team !== 0 ? ENEMY_BUILDING : fort ? FORT : OWN_BUILDING, b.built < 1 ? 0.7 : 1);
    }
    g.putImageData(img, 0, 0);

    const c = canvas.getContext("2d")!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cw, ch);
    c.imageSmoothingEnabled = false;
    // Raute: (u, v) → ((u − v)·S + gh·S, (u + v)·S/2)
    c.setTransform(S, S / 2, -S, S / 2, gh * S, 0);
    c.drawImage(grid, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (const u of s.units) {
      if (u.dead) continue;
      const [a, b] = toView(u.x, u.y, r, s.w, s.h);
      const x = (a - b) * S + gh * S, y = ((a + b) * S) / 2;
      c.fillStyle = u.team === 0 ? "#3b6fe0" : "#e03a2e";
      c.fillRect(Math.round(x) - 1, Math.round(y) - 2, 3, 3);
    }
    // Norden (Welt −y) als Markierung am Rand
    const [nu, nv] = toView(s.w / 2, -2, r, s.w, s.h);
    const nx = ((nu - nv) * S + gh * S) / cw, ny = (((nu + nv) * S) / 2) / ch;
    north.style.left = `${Math.max(4, Math.min(96, nx * 100))}%`;
    north.style.top = `${Math.max(6, Math.min(94, ny * 100))}%`;
  }

  return {
    el,
    update(s, force = false) {
      const now = performance.now();
      // force (Ansicht gewechselt): sofort neu zeichnen, wenn sich die Drehung geändert hat; Verschieben/Zoomen
      // ändert nur den Rahmen, den pollView nachführt.
      const turned = ((bridge.view().r & 3) as Rot) !== geo.r || !geo.cw;
      if (!(force && turned) && now - last < 330) return;
      last = now;
      draw(s);
    },
  };
}
