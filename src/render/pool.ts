/**
 * Sprite-Pool: Sprites werden nie pro Bild neu erzeugt. Jedes Bild beginnt mit reset(), holt der Reihe nach
 * Sprites mit next() (Reihenfolge der Kinder = Zeichenreihenfolge) und blendet am Ende den Rest aus.
 */
import { Container, Sprite, Texture } from "pixi.js";

export class SpritePool {
  private sprites: Sprite[] = [];
  private used = 0;
  constructor(readonly container: Container) {}

  reset(): void { this.used = 0; }

  next(tex: Texture): Sprite {
    let s = this.sprites[this.used];
    if (!s) {
      s = new Sprite(Texture.EMPTY);
      this.sprites.push(s);
      this.container.addChild(s);
    }
    this.used++;
    s.texture = tex;
    s.visible = true;
    s.alpha = 1;
    s.tint = 0xffffff;
    s.rotation = 0;
    s.scale.set(1, 1);
    s.pivot.set(0, 0);
    return s;
  }

  finish(): void {
    for (let i = this.used; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      if (!s.visible) break; // dahinter ist schon alles aus
      s.visible = false;
    }
  }

  get count(): number { return this.used; }
}
