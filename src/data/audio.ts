/**
 * Musik und Sprecheransagen als Daten. Die Dateien erzeugt tools/audio/audio-gen.py
 * (Musik: Lyria 3.5, Ansagen: Gemini 3.8 Flash TTS, beides über Google AI Studio), siehe tools/audio/README.md.
 * Pfade relativ zur Basis-URL (publicDir = assets/). Fehlt eine Datei, bleibt es still (kein Ersatzton).
 */

export type MusicMood = "aufbau" | "kampf" | "sieg";
export type MusicKey = "aufbau_tal" | "aufbau_markt" | "aufbau_abend" | "kampf_sturm" | "sieg_abgewehrt";

export interface MusicDef {
  file: string;
  /** Anzeigename (Deutsch). */
  title: string;
  mood: MusicMood;
  /** In Schleife spielen (Kampf) oder einmal mit Pause danach (Aufbau, Sieg). */
  loop: boolean;
  /** Prompt für Lyria (Englisch, ohne Bezug auf bestehende Spiele, Künstler oder Werke). */
  prompt: string;
}

const STYLE = "Instrumental only, no vocals, no lyrics. Authentic high-medieval European instrumentation, warm acoustic room sound, clean mix, no modern drums, no synths, no electric guitar.";

export const MUSIC: Record<MusicKey, MusicDef> = {
  aufbau_tal: {
    file: "audio/musik/aufbau_tal.mp3", title: "Morgen über dem Tal", mood: "aufbau", loop: false,
    prompt: `Calm pastoral medieval folk piece for a peaceful village building at dawn. Lute and recorder carry a gentle modal melody in D dorian, soft frame drum, a quiet hurdy-gurdy drone, occasional harp arpeggios. About 84 BPM, unhurried and hopeful, slowly building and gently fading at the end. ${STYLE}`,
  },
  aufbau_markt: {
    file: "audio/musik/aufbau_markt.mp3", title: "Markttag", mood: "aufbau", loop: false,
    prompt: `Lively but relaxed medieval market-day dance in 6/8. Fiddle and shawm trade a cheerful tune in G mixolydian, tambourine and frame drum keep a light pulse, citole strums, a bagpipe drone enters in the middle section. About 100 BPM, busy workers and traders, friendly and bright. ${STYLE}`,
  },
  aufbau_abend: {
    file: "audio/musik/aufbau_abend.mp3", title: "Abend am Feuer", mood: "aufbau", loop: false,
    prompt: `Quiet reflective medieval evening piece by the hearth. Solo lute with a soft vielle countermelody in A aeolian, sparse harp, very light hand percussion, a distant low drone. About 72 BPM, calm, a little melancholic, spacious. ${STYLE}`,
  },
  kampf_sturm: {
    file: "audio/musik/kampf_sturm.mp3", title: "Sturm auf die Mauern", mood: "kampf", loop: true,
    prompt: `Tense driving medieval battle music for defending a castle wall. Large war drums and pounding taiko-like frame drums, low droning hurdy-gurdy, aggressive fiddle ostinato in D phrygian, bursts of natural horns and a low wordless male drone choir hum (no words). About 128 BPM, urgent and relentless, loopable with a steady energy and no fade-out. ${STYLE.replace("no vocals, no lyrics", "no sung words, no lyrics")}`,
  },
  sieg_abgewehrt: {
    file: "audio/musik/sieg_abgewehrt.mp3", title: "Abgewehrt", mood: "sieg", loop: false,
    prompt: `Short triumphant medieval fanfare and relieved coda after a battle is won. Natural horns and trumpets call a bright motif in D major, timpani and frame drum roll, then lute and recorder settle into a warm, calm ending. About 30 seconds, ends cleanly. ${STYLE}`,
  },
};

/**
 * Sprecheransagen des Vogts. Die Simulation hängt den Schlüssel an Meldungen (Message.voice) bzw. Befehlsergebnisse
 * (CommandResult.voice); die App spielt sie mit Mindestabstand und Vorrang (kampf vor warnung vor info).
 */
export type VoiceKey =
  | "willkommen" | "bau_fertig" | "mauer_fertig" | "lager_voll" | "hof_voll" | "material_fehlt" | "rohstoff_leer"
  | "zuzug" | "wohnraum" | "keine_waffe" | "ausgebildet" | "ueberfall_bald" | "ueberfall" | "abgewehrt"
  | "gebaeude_angriff" | "arbeiter_angriff" | "mauer_faellt" | "zerstoert" | "gefallen" | "stationiert"
  | "kein_posten" | "zu_teuer" | "kein_platz";

export interface VoiceDef {
  file: string;
  text: string;
  /** Vorrang beim gleichzeitigen Auslösen (höher gewinnt). */
  priority: 1 | 2 | 3;
  /** Diese Ansage frühestens nach so vielen Sekunden wiederholen. */
  repeatSeconds: number;
  /** Wann sie fällt (für Simulation und App). */
  when: string;
}

const v = (key: VoiceKey, text: string, priority: 1 | 2 | 3, repeatSeconds: number, when: string): VoiceDef =>
  ({ file: `audio/stimme/${key}.mp3`, text, priority, repeatSeconds, when });

export const VOICE: Record<VoiceKey, VoiceDef> = {
  willkommen: v("willkommen", "Willkommen, Herr. Das Tal gehört Euch. Eine Holzfällerhütte am Waldrand und ein Steinbruch am Fels wären ein guter Anfang.", 1, 99999, "Spielbeginn"),
  bau_fertig: v("bau_fertig", "Der Bau ist fertig, Herr.", 1, 20, "Wirtschafts-, Wohn- oder Militärgebäude fertiggestellt"),
  mauer_fertig: v("mauer_fertig", "Die Mauer steht.", 1, 30, "Mauer, Tor, Turm oder Treppe fertiggestellt"),
  lager_voll: v("lager_voll", "Das Lager ist voll. Ohne einen weiteren Lagerplatz ruht die Arbeit.", 2, 60, "Lager voll, Ware bleibt im Hof"),
  hof_voll: v("hof_voll", "Die Höfe laufen über, die Träger kommen nicht nach.", 2, 90, "Hofstapel einer Werkstatt voll"),
  material_fehlt: v("material_fehlt", "Für die Baustelle fehlt uns Material.", 2, 60, "Baustelle wartet auf Ware, die nicht im Lager ist"),
  rohstoff_leer: v("rohstoff_leer", "Hier gibt es nichts mehr zu holen. Baut näher an Wald oder Fels.", 2, 90, "Holzfäller oder Steinbruch ohne Baum bzw. Fels in Reichweite"),
  zuzug: v("zuzug", "Neue Leute ziehen in die Siedlung.", 1, 90, "Tagelöhner zugezogen"),
  wohnraum: v("wohnraum", "Es fehlt an Wohnraum, Herr. Ohne Häuser kommt niemand mehr.", 2, 120, "Bevölkerung hat den Wohnraum erreicht"),
  keine_waffe: v("keine_waffe", "Im Lager liegt keine passende Waffe.", 2, 30, "Rekrutieren ohne Waffe im Lager"),
  ausgebildet: v("ausgebildet", "Ein neuer Soldat steht bereit.", 1, 15, "Einheit fertig ausgebildet"),
  ueberfall_bald: v("ueberfall_bald", "Späher melden Krieger auf dem Weg hierher. Bald sind sie da.", 3, 60, "30 Sekunden vor einer Welle"),
  ueberfall: v("ueberfall", "Zu den Waffen! Der Feind ist da!", 3, 30, "Welle erscheint am Kartenrand"),
  abgewehrt: v("abgewehrt", "Der Angriff ist abgewehrt. Die Siedlung steht.", 3, 30, "Letzter Angreifer der Welle tot"),
  gebaeude_angriff: v("gebaeude_angriff", "Unsere Gebäude werden angegriffen!", 3, 30, "Eigenes Gebäude nimmt Schaden"),
  arbeiter_angriff: v("arbeiter_angriff", "Die Arbeiter werden angegriffen!", 3, 30, "Eigener Arbeiter nimmt Schaden"),
  mauer_faellt: v("mauer_faellt", "Die Mauer ist durchbrochen!", 3, 20, "Mauer, Tor oder Turm zerstört"),
  zerstoert: v("zerstoert", "Wir haben ein Gebäude verloren.", 3, 20, "Anderes eigenes Gebäude zerstört"),
  gefallen: v("gefallen", "Ein Soldat ist gefallen.", 2, 15, "Eigener Soldat tot"),
  stationiert: v("stationiert", "Die Männer beziehen die Mauern.", 1, 10, "Befehl Stationieren angenommen"),
  kein_posten: v("kein_posten", "Auf den Mauern ist kein Platz mehr.", 2, 10, "Stationieren ohne freien erreichbaren Posten"),
  zu_teuer: v("zu_teuer", "Dafür reichen unsere Vorräte nicht.", 2, 8, "Bauen oder Rekrutieren scheitert an Kosten"),
  kein_platz: v("kein_platz", "Dort lässt sich nicht bauen.", 1, 8, "Bauen scheitert an Platz oder Gelände"),
};

/** Sprecher-Anweisung für die Sprachsynthese (Stil, nicht vorgelesen). */
export const VOICE_STYLE =
  "Sprich auf Deutsch als erfahrener, ruhiger Burgvogt mittleren Alters: tiefe, warme, klare Stimme, " +
  "würdevoll und knapp, leicht erzählend wie ein Herold. Bei Alarm dringlich und laut, sonst gelassen.";
