/**
 * Kompass: In welche Bildrichtung zeigt Norden (Welt −y) bei Kameradrehung r? Gerechnet mit derselben
 * Drehung wie die Darstellung (geom.toView) und der 2:1-Iso-Projektion (Ansicht (u, v) → Bild (u − v, (u + v) / 2)).
 */
import { toView, type Rot } from "../sim/geom";

const WHERE: Record<string, string> = {
  "1,-1": "oben rechts", "1,1": "unten rechts", "-1,1": "unten links", "-1,-1": "oben links",
  "0,-1": "oben", "1,0": "rechts", "0,1": "unten", "-1,0": "links",
};

/** Bildvektor (x nach rechts, y nach unten) für Norden, Winkel im Uhrzeigersinn ab „oben“ und Beschreibung. */
export function northOnScreen(r: number): { x: number; y: number; deg: number; where: string } {
  const rot = (((r % 4) + 4) % 4) as Rot;
  const [u0, v0] = toView(8, 8, rot, 16, 16);
  const [u1, v1] = toView(8, 7, rot, 16, 16);
  const du = u1 - u0, dv = v1 - v0;
  const x = du - dv, y = (du + dv) / 2;
  const deg = Math.round((Math.atan2(x, -y) * 180) / Math.PI);
  return { x, y, deg, where: WHERE[`${Math.sign(x)},${Math.sign(y)}`] ?? "oben" };
}
