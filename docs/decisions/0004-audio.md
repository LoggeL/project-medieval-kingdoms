# 0004 – Musik und Sprecheransagen

**Status:** entschieden (17.11.2026, Vorgabe Logge: Musik mit Lyria 3.5, Sprecher mit Gemini 3.8 Flash TTS über Google AI Studio).

## Entscheidung
- **Erzeugung offline**, nicht zur Laufzeit. `tools/audio/audio-gen.py` erzeugt MP3-Dateien in `assets/audio/`, das Spiel lädt fertige Dateien. Keine API-Aufrufe aus dem Browser, kein Schlüssel im Client.
- **Inhalte als Daten:** `src/data/audio.ts` mit `MUSIC` (Stimmung aufbau, kampf oder sieg; Schleife; Prompt) und `VOICE` (Text, Vorrang 1–3, Wiederholsperre, Auslöser).
- **Auslöser:** Die Simulation hängt Ansage-Schlüssel an Meldungen (`Message.voice`) und Befehlsergebnisse (`CommandResult.voice`). Sie kennt kein Audio. Die App (`src/app/audio.ts`) entscheidet, was spielt:
  - Musik nach Stimmung: Aufbau-Stücke mit Pausen dazwischen, bei laufendem Überfall das Kampfstück in Schleife, nach der Abwehr einmal das Siegstück.
  - Ansagen nach Vorrang und Wiederholsperre, nie zwei gleichzeitig, die Musik wird währenddessen leiser.
  - Erst nach der ersten Nutzergeste.
- **Bedienung:** Lautstärke für Musik und Sprecher sowie Stumm über die UiBridge (`audio()` / `setAudio()`), gespeichert im Browser.
- **Prüfpflicht** wie bei Grafik: Eine Datei gilt erst nach bestandener automatischer Prüfung als vorhanden (Ansage: Rücktranskription; Musik: Beschreibung ohne Gesang mit Worten und ohne Defekt). Fehlt eine Datei, bleibt es still. Es gibt keinen Ersatzton.

## Folgen
Neue Ansagen bestehen aus einem Datensatz, einem Simulationsauslöser und einem Lauf des Skripts. Der Ton der Ansagen ist nur über Stimme und Formulierung steuerbar, denn das TTS-Modell liest Stilanweisungen mit vor (siehe `tools/audio/README.md`). Geräusche wie Axt, Hammer und Schritte sind noch nicht enthalten.
