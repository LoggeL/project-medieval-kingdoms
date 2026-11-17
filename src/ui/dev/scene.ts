/**
 * Prüfstand: einfache Canvas-Szene der Platzhalter-Welt hinter der Oberfläche (keine echte Darstellung!).
 * Flache Geländerauten, Gebäude- und Figuren-Sprites in der richtigen Ansicht, Drehung über toView/viewOf.
 * Dient nur dazu, die Oberfläche über einem spielähnlichen Bild zu beurteilen und per Klick etwas auszuwählen.
 */
import type { UiBridge } from "../../app/contract";
import type { TerrainKey } from "../../data";
import { center, toView, viewOf, type Rot } from "../../sim/geom";
import type { Building, SimState } from "../../sim/types";
import type { Sprites } from "./sprites";

const COL: Record<TerrainKey, string[]> = {
  gras: ["#6d9440", "#678e3c", "#729a45", "#6a9140"], wiese: ["#86a24c", "#7f9b47", "#8aa750", "#83a04a"],
  waldboden: ["#4f6e33", "#4a6930", "#537336", "#4d6c31"], erde: ["#a7835a", "#a07d55", "#ac8960", "#a48058"],
  fels: ["#8f8a82", "#88837b", "#958f86", "#8b867e"], wasser: ["#3f74a0", "#3b6f9a", "#4479a6", "#3d719c"],
};

export function createScene(canvas: HTMLCanvasElement, bridge: UiBridge, sprites: () => Sprites | null) {
  const g = canvas.getContext("2d")!;
  let ox = 0, oy = 0, k = 1;

  function resize(): void {
    canvas.width = innerWidth; canvas.height = innerHeight;
  }
  addEventListener("resize", resize);
  resize();

  function screen(s: SimState, x: number, y: number, r: Rot): [number, number] {
    const [u, v] = toView(x, y, r, s.w, s.h);
    return [ox + (u - v) * 32 * k, oy + (u + v) * 16 * k];
  }

  function draw(): void {
    const s = bridge.state();
    const { r: rr, zoom } = bridge.view();
    const r = (rr & 3) as Rot;
    k = zoom;
    // Bildmitte = Kamerapunkt der Mock-Brücke (lookAt aus der Übersichtskarte)
    const cam = bridge.camera();
    const [cu, cv] = toView(cam.x, cam.y, r, s.w, s.h);
    ox = canvas.width / 2 - (cu - cv) * 32 * k;
    oy = canvas.height / 2 - (cu + cv) * 16 * k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#24331b";
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const t = s.tiles[y * s.w + x];
      const [cx, cy] = screen(s, x + 0.5, y + 0.5, r);
      g.fillStyle = COL[t.terrain][t.variant & 3];
      g.beginPath();
      g.moveTo(cx, cy - 16 * k); g.lineTo(cx + 32 * k, cy); g.lineTo(cx, cy + 16 * k); g.lineTo(cx - 32 * k, cy);
      g.closePath(); g.fill();
    }
    const sp = sprites();
    if (!sp) { requestAnimationFrame(draw); return; }
    g.imageSmoothingEnabled = false;
    type Item = { d: number; f: () => void };
    const items: Item[] = [];
    const [cw, ch] = sp.buildings.cell, [ax, ay] = sp.buildings.anchor;
    const blit = (key: string, view: number, variant: number | undefined, wx: number, wy: number, d: number, alpha = 1) => {
      const b = sp.building(key, view, variant);
      if (!b) return;
      const [sx, sy] = screen(s, wx, wy, r);
      items.push({ d, f: () => { g.globalAlpha = alpha; g.drawImage(b.img, b.sx, b.sy, cw, ch, sx - ax * k, sy - ay * k, cw * k, ch * k); g.globalAlpha = 1; } });
    };
    const depth = (x: number, y: number) => { const [u, v] = toView(x, y, r, s.w, s.h); return u + v; };
    for (const t of s.trees) if (t.state === "stehend") blit(t.kind, 0, t.variant, t.x + 0.5, t.y + 0.5, depth(t.x + 0.5, t.y + 0.5));
    const sel = bridge.selection();
    for (const b of s.buildings) {
      const key = sp.bimg.has(b.key) ? b.key : "mauer";
      const [cx, cy] = center(b.key, b.x, b.y, b.o);
      const variant = b.key === "lager" ? 4 : undefined;
      blit(key, viewOf(b.o, r), variant, cx, cy, depth(cx, cy) + 0.5, b.built < 1 ? 0.55 : 1);
      if (sel.building === b.id) outline(s, b, r);
    }
    const fc = sp.figures.cell, [fax, fay] = sp.figures.anchor;
    for (const u of s.units) {
      const fig = sp.figure(u.key === "tageloehner" && u.carry ? "traeger" : u.key);
      if (!fig) continue;
      const row = fig.row;
      const [sx, sy0] = screen(s, u.x, u.y, r);
      const sy = sy0 - u.z * 8 * k;
      const frame = u.anim === "gehen" ? 1 + (Math.floor(u.animT * 8) % 8) : 0;
      const ang = Math.atan2(u.fy, u.fx) - (r * Math.PI) / 2;
      const dir = ((Math.round((ang / (Math.PI / 4)) + 2) % 8) + 8) % 8;
      items.push({ d: depth(u.x, u.y) + 0.6 + u.z, f: () => {
        if (sel.units.includes(u.id)) { g.strokeStyle = u.team ? "#ff6a4a" : "#ffe08a"; g.lineWidth = 2; g.beginPath(); g.ellipse(sx, sy, 12 * k, 6 * k, 0, 0, 7); g.stroke(); }
        g.drawImage(fig.img, frame * fc, (row + dir) * fc, fc, fc, sx - fax * k, sy - fay * k, fc * k, fc * k);
        if (u.team) { g.fillStyle = "#e03a2e"; g.fillRect(sx - 2, sy - 52 * k, 4, 4); }
      } });
    }
    items.sort((a, b) => a.d - b.d).forEach((i) => i.f());
    requestAnimationFrame(draw);
  }

  function outline(s: SimState, b: Building, r: Rot): void {
    const tiles = s.tiles.map((t, i) => (t.building === b.id ? i : -1)).filter((i) => i >= 0);
    g.strokeStyle = "#ffe08a"; g.lineWidth = 2;
    for (const i of tiles) {
      const [cx, cy] = screen(s, (i % s.w) + 0.5, Math.floor(i / s.w) + 0.5, r);
      g.beginPath();
      g.moveTo(cx, cy - 16 * k); g.lineTo(cx + 32 * k, cy); g.lineTo(cx, cy + 16 * k); g.lineTo(cx - 32 * k, cy);
      g.closePath(); g.stroke();
    }
  }

  /** Bildschirm → Welt (Boden). */
  function pick(px: number, py: number): [number, number] {
    const s = bridge.state();
    const r = (bridge.view().r & 3) as Rot;
    const a = (px - ox) / (32 * k), b = (py - oy) / (16 * k);
    const u = (a + b) / 2, v = (b - a) / 2;
    switch (r) {
      case 1: return [v, s.h - u];
      case 2: return [s.w - u, s.h - v];
      case 3: return [s.w - v, u];
      default: return [u, v];
    }
  }

  /** Ecken des sichtbaren Bereichs in Welt-Tiles, im Uhrzeigersinn ab oben links (wie UiBridge.camera). */
  function corners(): [number, number][] {
    const W = canvas.width, H = canvas.height;
    return [pick(0, 0), pick(W, 0), pick(W, H), pick(0, H)];
  }

  requestAnimationFrame(draw);
  return { pick, corners };
}
