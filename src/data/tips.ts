/**
 * Tipps für den Ladebildschirm und die Tastenübersicht des Titelbildschirms.
 *
 * Jeder Tipp beschreibt etwas, das es im Prototyp wirklich gibt (geprüft gegen src/app/input.ts, src/sim und src/data,
 * Stand 17.11.2026). Zahlen stammen aus den Daten in src/data/index.ts; ändern sich die Werte dort, hier mitziehen
 * (tests/data/tips.test.ts prüft die wichtigsten Zahlen gegen die Daten).
 */

export interface Tip {
  text: string;
  /** Grobe Einordnung, nur zur Pflege der Liste. */
  thema: "steuerung" | "wirtschaft" | "burgenbau" | "militaer";
}

export const TIPS: Tip[] = [
  { thema: "steuerung", text: "Q und E drehen die Ansicht um 90°. Gebäude, Figuren und die Bauvorschau drehen richtig mit." },
  { thema: "steuerung", text: "Das Mausrad zoomt sanft zur Maus hin, in acht Stufen von der ganzen Karte bis zur Nahansicht. + und − gehen auch." },
  { thema: "steuerung", text: "WASD, die Pfeiltasten oder der Bildschirmrand bewegen die Kamera. Mit gedrückter rechter oder mittlerer Maustaste ziehst du die Karte." },
  { thema: "steuerung", text: "Leertaste oder P hält das Spiel an. Auch in der Pause kannst du bauen und Befehle geben." },
  { thema: "steuerung", text: "Strg und eine Ziffer speichern die Auswahl als Gruppe, die Ziffer allein wählt sie wieder." },
  { thema: "steuerung", text: "Ein Doppelklick auf eine eigene Einheit wählt alle sichtbaren Einheiten derselben Art." },
  { thema: "steuerung", text: "F2 bis F8 öffnen die Bau-Reiter, Y bis M wählen darin ein Gebäude, F öffnet den Forschungsbaum. Jeder Knopf zeigt seine Taste, F1 alle." },
  { thema: "wirtschaft", text: "Die Holzfällerhütte braucht Wald: Mindestens vier Bäume müssen in der Nähe stehen." },
  { thema: "wirtschaft", text: "Geforscht wird im Bergfried. Gold zahlst du sofort, die Waren tragen Tagelöhner hinein, erst dann läuft die Zeit." },
  { thema: "wirtschaft", text: "Holzfäller und Steinmetze legen ihre Ware auf den eigenen Hof. Tagelöhner tragen sie von dort durch das Tor ins Lagerhaus." },
  { thema: "wirtschaft", text: "Im Lagerhaus liegt jede Ware sichtbar in ihrem Fach: acht Fächer mit je 20 Stück. Mit der Maus darüber schaust du hinein." },
  { thema: "wirtschaft", text: "Ist das Lager voll, bleibt die Ware auf dem Hof. Ist auch der Hof voll, ruht die Arbeit. Dann hilft ein weiteres Lagerhaus." },
  { thema: "wirtschaft", text: "Ein Wohnhaus bietet vier Bewohnern Platz. Solange Wohnraum frei ist, zieht etwa alle 20 Sekunden ein Tagelöhner zu." },
  { thema: "burgenbau", text: "Beim Bauen dreht R das Gebäude, Shift und R dreht zurück. So setzt du die Mauertreppe mit der Rückseite an die Mauer." },
  { thema: "burgenbau", text: "Eine Mauer ziehst du: Startfeld anklicken, mit gedrückter Maustaste zum Endfeld ziehen, loslassen. Jedes Stück kostet 3 Stein." },
  { thema: "burgenbau", text: "Ein Tor passt nur in ein gerades Mauerstück. Es öffnet sich für deine Leute, Angreifer müssen es einreißen." },
  { thema: "burgenbau", text: "Eine Mauertreppe führt auf den Wehrgang. Steht sie außen an der Mauer, können auch Angreifer hinaufsteigen." },
  { thema: "burgenbau", text: "Der Bergfried ist dein Sitz. Fällt er, ist die Burg verloren. Mit Steinbaukunst und Festungsbau baust du ihn aus." },
  { thema: "militaer", text: "T stationiert die ausgewählten Soldaten auf freien Posten von Mauer, Turm und steinernem Bergfried." },
  { thema: "militaer", text: "Rechtsklick auf einen Feind greift an, Rechtsklick auf den Wehrgang schickt deine Soldaten hinauf." },
  { thema: "militaer", text: "Wer auf Mauer oder Turm steht, nimmt von unten weniger Schaden. Bogenschützen schießen von dort auch weiter." },
  { thema: "militaer", text: "Die Kaserne bildet sechs Truppen aus, Pikeniere und Armbrustschützen erst nach Forschung. Jeder Soldat kostet Gold und Ausrüstung aus dem Lager." },
  { thema: "militaer", text: "Überfälle kommen aus dem Osten über die Furt im Fluss. Dort lohnt sich eine Mauer mit Tor." },
  { thema: "militaer", text: "Der erste Überfall kommt nach etwa fünf Minuten, dann alle vier Minuten, und jede Welle ist größer. Späher warnen 30 Sekunden vorher." },
  { thema: "militaer", text: "Angreifer haben keine Leitern. Sie reißen ein, was ihnen im Weg steht. Jeder besiegte Angreifer bringt 4 Gold." },
];

/** Kompakte Tastenübersicht für den Titelbildschirm (Taste, Wirkung). */
export const STEUERUNG: [string, string][] = [
  ["Linksklick", "Auswählen, Bauen, Abreißen"],
  ["Ziehen", "Auswahlrahmen, beim Mauerbau die Mauerlinie"],
  ["Rechtsklick", "Bewegen, Angreifen, auf den Wehrgang steigen"],
  ["Q / E", "Ansicht um 90° drehen"],
  ["Mausrad / + −", "Zoomen (acht Stufen, 0,25× bis 4×)"],
  ["WASD / Pfeile", "Kamera bewegen"],
  ["R", "Gebäude beim Bauen drehen"],
  ["T", "Soldaten auf Mauer, Turm und Bergfried stationieren"],
  ["F", "Forschungsbaum öffnen"],
  ["G", "Gewählten Bergfried ausbauen"],
  ["H", "Halten"],
  ["Strg + Ziffer", "Gruppe speichern, Ziffer wählt sie"],
  ["Leertaste / P", "Pause"],
  ["Esc", "Werkzeug oder Auswahl aufheben"],
  ["F2 – F8", "Bau-Reiter (Wirtschaft bis Wege)"],
  ["Y X C V B N M", "Gebäude im offenen Reiter wählen"],
  ["U / I / O / J / K / L", "In der gewählten Kaserne ausbilden"],
  ["Entf", "Abriss-Werkzeug, bei gewähltem Gebäude abreißen"],
  ["F1", "Hilfe im Spiel"],
];
