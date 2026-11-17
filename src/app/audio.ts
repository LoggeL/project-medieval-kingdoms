/**
 * Audio-Regie: Musik nach Stimmung und Sprecheransagen (Daten in src/data/audio.ts).
 *
 * Musik: Im Frieden laufen die Aufbau-Stücke abwechselnd, dazwischen 20–60 s Stille. Beginnt ein Überfall
 * (state.raid.active), wird in 2 s auf „kampf_sturm“ (Schleife) übergeblendet; nach der Abwehr einmal „sieg_abgewehrt“,
 * dann wieder Aufbau. In der Pause läuft die Musik leise weiter.
 * Ansagen: neue Meldungen mit voice und CommandResult.voice. Nie zwei gleichzeitig, Vorrang nach VOICE.priority,
 * Wiederholsperre VOICE.repeatSeconds, die Musik wird während einer Ansage abgesenkt (Ducking).
 * Start erst nach einer Nutzergeste, die der Browser als Aktivierung wertet (Autoplay-Regeln; Escape zählt nicht).
 * Freigeschaltet ist die Regie erst, wenn ein play() tatsächlich gelingt (AudioGate). Lehnt der Browser ab
 * (NotAllowedError), gilt nichts als gespielt: Musik beginnt von vorn, abgewiesene Ansagen werden nicht verbraucht,
 * und die nächste Geste versucht es erneut. Dateien werden erst bei Bedarf geladen. Fehlt eine Datei, bleibt es still,
 * und die Konsole meldet das einmal als Info.
 *
 * MusicDirector, VoiceScheduler und AudioGate sind reine Logik (ohne DOM) und werden in tests/app/audio.test.ts geprüft.
 */
import { MUSIC, VOICE, type MusicKey, type VoiceKey } from "../data/audio";
import { TICKS_PER_SECOND } from "../data";
import type { Message, SimState } from "../sim/types";

export interface AudioSettings { music: number; voice: number; muted: boolean }

export const FADE_SECONDS = 2;
export const SILENCE: [number, number] = [20, 60];
/** Musik-Pegel während einer Ansage und in der Pause (Faktor). */
export const DUCK = 0.4;
export const PAUSED = 0.5;
/** Wartende Ansagen verfallen nach so vielen Sekunden. */
export const VOICE_STALE = 8;

const PEACE: MusicKey[] = (Object.keys(MUSIC) as MusicKey[]).filter((k) => MUSIC[k].mood === "aufbau");
const BATTLE: MusicKey = (Object.keys(MUSIC) as MusicKey[]).find((k) => MUSIC[k].mood === "kampf") ?? "kampf_sturm";
const VICTORY: MusicKey = (Object.keys(MUSIC) as MusicKey[]).find((k) => MUSIC[k].mood === "sieg") ?? "sieg_abgewehrt";

// ---------------------------------------------------------------- Musik (Logik)

export type MusicCommand = { play: MusicKey; fade: number; loop: boolean } | { stop: true; fade: number };

/**
 * Entscheidet, welches Stück läuft. step() bekommt die Zeit (s), ob ein Überfall läuft und ob das laufende Stück zu Ende
 * ist, und liefert höchstens einen Befehl.
 */
export class MusicDirector {
  mode: "aufbau" | "kampf" | "sieg" = "aufbau";
  current: MusicKey | null = null;
  /** Nächster Start eines Aufbau-Stücks (während der Stille). */
  nextAt = 0;
  private last: MusicKey | null = null;
  private started = false;

  constructor(private rand: () => number = Math.random) {}

  private pickPeace(): MusicKey {
    const choices = PEACE.filter((k) => k !== this.last);
    const list = choices.length ? choices : PEACE;
    return list[Math.min(list.length - 1, Math.floor(this.rand() * list.length))];
  }

  private silence(now: number): number {
    return now + SILENCE[0] + this.rand() * (SILENCE[1] - SILENCE[0]);
  }

  step(now: number, raid: boolean, ended: boolean): MusicCommand | null {
    if (raid && this.mode !== "kampf") {
      this.mode = "kampf";
      this.current = BATTLE;
      return { play: BATTLE, fade: FADE_SECONDS, loop: true };
    }
    if (!raid && this.mode === "kampf") {
      this.mode = "sieg";
      this.current = VICTORY;
      return { play: VICTORY, fade: FADE_SECONDS, loop: false };
    }
    // Kampfmusik läuft in Schleife, bis der Überfall vorbei ist
    if (this.mode === "kampf") return null;
    if (this.mode === "sieg") {
      if (!ended) return null;
      this.mode = "aufbau";
      this.current = null;
      this.nextAt = this.silence(now);
      return { stop: true, fade: 0 };
    }
    // Aufbau
    if (!this.started) {
      this.started = true;
      return this.playPeace();
    }
    if (this.current && ended) {
      this.current = null;
      this.nextAt = this.silence(now);
      return { stop: true, fade: 0 };
    }
    if (!this.current && now >= this.nextAt) return this.playPeace();
    return null;
  }

  private playPeace(): MusicCommand {
    const k = this.pickPeace();
    this.last = k;
    this.current = k;
    return { play: k, fade: 0, loop: false };
  }
}

// ---------------------------------------------------------------- Ansagen (Logik)

interface Pending { key: VoiceKey; t: number }

/** Warteschlange der Ansagen: Vorrang, Wiederholsperre, nie zwei gleichzeitig. */
export class VoiceScheduler {
  private pending: Pending[] = [];
  private last = new Map<VoiceKey, number>();

  /** Ansage anbieten; false, wenn sie wegen der Wiederholsperre oder als Doppel verworfen wurde. */
  offer(key: VoiceKey, now: number): boolean {
    const def = VOICE[key];
    if (!def) return false;
    const l = this.last.get(key);
    if (l !== undefined && now - l < def.repeatSeconds) return false;
    if (this.pending.some((p) => p.key === key)) return false;
    this.pending.push({ key, t: now });
    return true;
  }

  /** Nächste Ansage, wenn gerade keine läuft (busy = false). Höchster Vorrang zuerst, bei Gleichstand die ältere. */
  next(now: number, busy: boolean): VoiceKey | null {
    this.pending = this.pending.filter((p) => now - p.t <= VOICE_STALE);
    if (busy || !this.pending.length) return null;
    let best = 0;
    for (let i = 1; i < this.pending.length; i++) {
      const a = this.pending[i], b = this.pending[best];
      if (VOICE[a.key].priority > VOICE[b.key].priority) best = i;
    }
    const { key } = this.pending.splice(best, 1)[0];
    const l = this.last.get(key);
    if (l !== undefined && now - l < VOICE[key].repeatSeconds) return this.next(now, busy);
    this.last.set(key, now);
    return key;
  }

  /** Ansage gilt als nicht gespielt (Browser hat abgelehnt): Wiederholsperre aufheben. */
  forget(key: VoiceKey): void { this.last.delete(key); }

  get size(): number { return this.pending.length; }
}

// ---------------------------------------------------------------- Freischalten (Logik)

/**
 * Zustand der Wiedergabe-Erlaubnis: „gesperrt“ (warten auf Geste), „versuch“ (Geste mit Aktivierung, die ersten play()
 * laufen) und „frei“ (ein play() ist gelungen). Eine Ablehnung führt aus jedem Zustand zurück nach „gesperrt“.
 */
export class AudioGate {
  state: "gesperrt" | "versuch" | "frei" = "gesperrt";

  /**
   * Nutzergeste. activation: ob der Browser die Seite als aktiviert führt (navigator.userActivation), undefined, wenn er
   * das nicht verrät. Liefert true, wenn jetzt ein Versuch beginnt.
   */
  gesture(activation: boolean | undefined): boolean {
    if (this.state !== "gesperrt" || activation === false) return false;
    this.state = "versuch";
    return true;
  }

  /** Ein play() ist gelungen. Liefert true beim ersten Erfolg (Übergang nach „frei“). */
  played(): boolean {
    if (this.state === "frei") return false;
    this.state = "frei";
    return true;
  }

  /** Der Browser hat abgelehnt (NotAllowedError). Liefert true, wenn vorher nicht gesperrt war. */
  refused(): boolean {
    if (this.state === "gesperrt") return false;
    this.state = "gesperrt";
    return true;
  }

  /** Regie läuft (Versuch oder frei). */
  get running(): boolean { return this.state !== "gesperrt"; }
}

const notAllowed = (e: unknown) => (e as { name?: string } | null)?.name === "NotAllowedError";

// ---------------------------------------------------------------- Wiedergabe (Browser)

const missing = new Set<string>();
function reportMissing(file: string): void {
  if (missing.has(file)) return;
  missing.add(file);
  console.info(`[Audio] ${file} fehlt oder lässt sich nicht abspielen, bleibt still.`);
}

function url(file: string): string {
  const b = import.meta.env.BASE_URL || "./";
  return (b.endsWith("/") ? b : b + "/") + file;
}

/** Ein Musikstück mit eigener Lautstärke für Überblendungen. */
interface Track { key: MusicKey; el: HTMLAudioElement; gain: number; target: number; rate: number; ended: boolean }

export class AudioDirector {
  private music = new MusicDirector();
  private voices = new VoiceScheduler();
  private tracks: Track[] = [];
  private voiceEl: HTMLAudioElement | null = null;
  private duck = 1;
  private gate = new AudioGate();
  private seen = new WeakSet<Message>();
  private lastNow = 0;
  /** Vom Browser abgelehnte Ansagen, die beim nächsten Versuch noch einmal angeboten werden. */
  private retry: VoiceKey[] = [];
  private listening = false;
  /** Zähler der Versuche: eine späte Ablehnung aus einem früheren Versuch sperrt den laufenden nicht. */
  private attempt = 0;
  private readonly onGesture = () => this.gesture(true);

  /** Wiedergabe ist tatsächlich erlaubt (ein play() ist gelungen). */
  get unlocked(): boolean { return this.gate.state === "frei"; }
  /** Zustand der Freigabe (für Tests und Diagnose). */
  get gateState(): AudioGate["state"] { return this.gate.state; }

  /** Gerade laufendes Musikstück (null in der Pause zwischen zwei Stücken). */
  current(): MusicKey | null {
    const t = this.tracks.find((x) => x.target > 0 && !x.ended);
    return t ? t.key : null;
  }

  private armed = false;

  constructor(private settings: () => AudioSettings, private state: () => SimState, private speed: () => number) {}

  /**
   * Erst wenn das Spiel wirklich beginnt (nach Titel und Laden): auf Gesten horchen und gleich einen Versuch wagen –
   * die Wahl „Neues Spiel“ war schon eine Geste. Lehnt der Browser ab (z. B. Safari), schaltet die nächste Geste im
   * Spiel frei. Vorher (Titel, Ladebildschirm) bleibt die Regie still, damit Begrüßung und Aufbaumusik nicht über dem
   * Menü oder dem Ladebildschirm verbraucht werden.
   */
  arm(): void {
    if (this.armed) return;
    this.armed = true;
    this.listen(true);
    this.gesture(false);
  }

  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    const f = on ? window.addEventListener.bind(window) : window.removeEventListener.bind(window);
    for (const ev of ["pointerdown", "keydown", "pointerup"] as const) f(ev, this.onGesture, true);
  }

  /**
   * Geste: nur mit Aktivierung durch den Browser (Escape und Tasten, die er nicht als Aktivierung zählt, schalten nicht
   * frei). Wird die Aktivierung erst nach den Ereignis-Handlern gesetzt, prüft ein zweiter Blick kurz danach.
   */
  private gesture(again: boolean): void {
    if (this.gate.running) return;
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean; hasBeenActive: boolean } }).userActivation;
    const active = ua ? ua.isActive || ua.hasBeenActive : undefined;
    if (!this.gate.gesture(active)) {
      if (again && active === false) window.setTimeout(() => this.gesture(false), 0);
      return;
    }
    this.attempt++;
    // Meldungen der letzten Sekunden (z. B. Begrüßung) noch ansagen, ältere nicht
    const s = this.state();
    for (const m of s.messages) if (s.tick - m.tick > 15 * TICKS_PER_SECOND) this.seen.add(m);
    const now = performance.now() / 1000;
    for (const k of this.retry.splice(0)) this.voices.offer(k, now);
    // gleich innerhalb der Geste starten (manche Browser erlauben play() nur dort)
    this.update();
  }

  /** play() ist gelungen: endgültig frei, Gesten-Listener entfernen. */
  private played(): void {
    if (this.gate.played()) this.listen(false);
  }

  /**
   * Browser hat play() abgelehnt: nichts gilt als gespielt. Musik beginnt beim nächsten Versuch von vorn (statt 20–60 s
   * Stille), laufende Stücke werden verworfen, die Listener bleiben bzw. kommen zurück.
   */
  private refused(attempt: number): void {
    if (attempt !== this.attempt || !this.gate.refused()) return;
    for (const t of this.tracks) { t.el.pause(); t.el.removeAttribute("src"); t.el.load(); }
    this.tracks = [];
    this.music = new MusicDirector();
    this.voiceEl = null;
    this.lastNow = 0;
    this.listen(true);
  }

  /** Ansage aus einem Befehlsergebnis. */
  say(key: VoiceKey | undefined): void {
    if (key && this.gate.running) this.voices.offer(key, performance.now() / 1000);
  }

  /** Jedes Bild (oder seltener): Meldungen prüfen, Musik steuern, Pegel nachführen. */
  update(): void {
    if (!this.gate.running) return;
    const now = performance.now() / 1000;
    const dt = Math.min(0.25, Math.max(0, now - (this.lastNow || now)));
    this.lastNow = now;
    const s = this.state();
    // neue Meldungen mit Ansage
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const m = s.messages[i];
      if (this.seen.has(m)) break;
      this.seen.add(m);
      if (m.voice) this.voices.offer(m.voice, now);
    }
    // Ansagen
    const busy = !!this.voiceEl && !this.voiceEl.ended && !this.voiceEl.paused;
    const next = this.voices.next(now, busy);
    if (next) this.playVoice(next);
    // Musik
    const cur = this.tracks.find((t) => t.target > 0);
    const cmd = this.music.step(now, !!s.raid?.active, cur ? cur.ended : false);
    if (cmd) this.apply(cmd);
    this.levels(dt);
  }

  private playVoice(key: VoiceKey): void {
    const file = VOICE[key].file;
    if (missing.has(file)) return;
    const el = new Audio(url(file));
    el.preload = "auto";
    el.addEventListener("error", () => { reportMissing(file); if (this.voiceEl === el) this.voiceEl = null; }, { once: true });
    this.voiceEl = el;
    this.volume(el, this.voiceLevel());
    const attempt = this.attempt;
    el.play().then(() => this.played(), (e) => {
      if (this.voiceEl === el) this.voiceEl = null;
      if (notAllowed(e)) {
        // nicht verbraucht: Wiederholsperre aufheben und beim nächsten Versuch erneut anbieten
        this.voices.forget(key);
        if (!this.retry.includes(key)) this.retry.push(key);
        this.refused(attempt);
      }
    });
  }

  private apply(cmd: MusicCommand): void {
    if ("stop" in cmd) {
      for (const t of this.tracks) { t.target = 0; t.rate = cmd.fade > 0 ? 1 / cmd.fade : Infinity; }
      return;
    }
    const rate = cmd.fade > 0 ? 1 / cmd.fade : Infinity;
    for (const t of this.tracks) { t.target = 0; t.rate = rate; }
    const file = MUSIC[cmd.play].file;
    const el = new Audio(url(file));
    el.preload = "auto";
    el.loop = cmd.loop;
    const track: Track = { key: cmd.play, el, gain: cmd.fade > 0 ? 0 : 1, target: 1, rate, ended: false };
    el.addEventListener("ended", () => { track.ended = true; });
    el.addEventListener("error", () => { reportMissing(file); track.ended = true; }, { once: true });
    this.tracks.push(track);
    this.volume(el, 0);
    if (missing.has(file)) { track.ended = true; return; }
    const attempt = this.attempt;
    el.play().then(() => this.played(), (e) => {
      if (notAllowed(e)) this.refused(attempt);
      else track.ended = true;
    });
  }

  private voiceLevel(): number {
    const a = this.settings();
    return a.muted ? 0 : a.voice;
  }

  /** Pegel: Überblendung, Ducking während einer Ansage, leiser in der Pause. */
  private levels(dt: number): void {
    const a = this.settings();
    const speaking = !!this.voiceEl && !this.voiceEl.ended && !this.voiceEl.paused;
    const duckTarget = speaking ? DUCK : 1;
    this.duck += Math.sign(duckTarget - this.duck) * Math.min(Math.abs(duckTarget - this.duck), dt / 0.3);
    const base = (a.muted ? 0 : a.music) * this.duck * (this.speed() === 0 ? PAUSED : 1);
    for (const t of this.tracks) {
      if (t.gain !== t.target) {
        const step = t.rate === Infinity ? 1 : dt * t.rate;
        t.gain += Math.sign(t.target - t.gain) * Math.min(Math.abs(t.target - t.gain), step);
      }
      this.volume(t.el, base * t.gain);
    }
    // ausgeblendete Stücke freigeben
    this.tracks = this.tracks.filter((t) => {
      if (t.target === 0 && t.gain <= 0) { t.el.pause(); t.el.removeAttribute("src"); t.el.load(); return false; }
      return true;
    });
    if (this.voiceEl) this.volume(this.voiceEl, this.voiceLevel());
  }

  private volume(el: HTMLAudioElement, v: number): void {
    const x = Math.max(0, Math.min(1, v));
    if (Math.abs(el.volume - x) > 0.002) el.volume = x;
  }
}
