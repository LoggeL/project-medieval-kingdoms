# Audio: Musik und Sprecheransagen

Musik kommt von **Lyria 3.5** (`models/lyria-3.5`), die Ansagen des Vogts von **Gemini 3.8 Flash TTS** (`models/gemini-3.8-flash-tts`), beides über die Gemini API von Google AI Studio. Geprüft wird mit **Gemini 3.8 Flash** (`models/gemini-3.8-flash`).

```sh
python3 tools/audio/audio-gen.py stimme --alle        # fehlende Ansagen erzeugen
python3 tools/audio/audio-gen.py stimme lager_voll --ersetzen
python3 tools/audio/audio-gen.py musik --alle         # fehlende Musikstücke erzeugen
python3 tools/audio/audio-gen.py pruefen              # Bestand und Längen auflisten
```

- **Quelle der Inhalte:** `src/data/audio.ts`. `MUSIC` enthält Titel, Stimmung, Schleife und Lyria-Prompt, `VOICE` enthält Text, Vorrang, Wiederholsperre und Auslöser, `VOICE_SPEAKER` die Sprecherstimme. Das Skript liest die Datei über Node (Typ-Stripping, Node ≥ 23.6).
- **Ziel:** `assets/audio/musik/<key>.mp3` (Stereo, 128 kbit/s, Lautheit −18 LUFS) und `assets/audio/stimme/<key>.mp3` (Mono, 96 kbit/s, −16 LUFS, Stille an den Rändern entfernt). `assets/audio/manifest.json` hält Dauer, Modell, Sprecher und Prüfergebnis fest.
- **Schlüssel:** aus dem macOS-Schlüsselbund, Dienst `google-api-key`, oder aus `GEMINI_API_KEY`. Er wird nie ausgegeben. Der Schlüsselbund-Eintrag „gemini“ ist kein Google-Schlüssel.
- **Vorhandene Dateien** werden nur mit `--ersetzen` überschrieben.
- **Rohdaten und Berichte** liegen in `.local/audio-runs/` (von git ignoriert): Rohaudio, jeder Versuch, `bericht.json`.

## Prüfung: Eine Datei gilt erst als vorhanden, wenn sie bestanden hat

Ohne bestandene Prüfung schreibt das Skript nichts nach `assets/`. Es gibt bis zu 3 Versuche, danach meldet es „abgelehnt“. Ein Fehlschlag wird nie durch etwas anderes ersetzt; das Spiel bleibt an der Stelle still.

- **Ansage:** Gemini 3.8 Flash transkribiert die MP3. Der Text muss dem Soll-Text entsprechen (Ähnlichkeit ≥ 0,9 nach Normalisierung), und die Länge muss plausibel sein: nicht leer und nicht deutlich länger als der Satz. So fällt auf, wenn das Modell etwas dazuspricht.
- **Musik:** Gemini 3.8 Flash beschreibt das Stück als JSON. Es muss zur gewünschten Stimmung passen (aufbau, kampf oder sieg). Abgelehnt wird es außerdem bei Gesang mit Worten, Stille oder Defekt, modernen Elementen oder wenn es nicht mittelalterlich klingt, und bei einer Dauer unter 15 s.

Abhören ersetzt das nicht. Die automatische Prüfung findet grobe Fehler, beurteilt aber nicht, ob ein Stück gut ist.

## Erkenntnisse zu den Modellen (17.11.2026)

- **Gemini 3.8 Flash TTS liest Stilanweisungen mit vor**, auch kurze Präfixe („Sag ruhig: …“) und Tags in eckigen Klammern. Eine `systemInstruction` lehnt das Modell ab („Developer instruction is not enabled“). Deshalb geht nur der reine Satz an das Modell. Den Ton bestimmen Stimme und Text: Mit der Stimme „Charon“ klingt der Sprecher wie ein Mann mittleren Alters mit tiefer Stimme, gemessen und respektvoll; Alarmrufe („Zu den Waffen!“) kommen von selbst laut und drängend.
- **Ausgabe TTS:** `audio/wav`, PCM 16 bit, 24 kHz, mono.
- **Lyria 3.5** antwortet über `generateContent` mit `audio/mpeg` (44,1 kHz, Stereo, 192 kbit/s, etwa 60 s), dazu einem Textteil mit Abschnittsmarken. Längenangaben im Prompt hält es nicht genau ein.

## Rechtliches und Eigenständigkeit

Die Prompts nennen keine bestehenden Spiele, Künstler oder Werke. Die Texte der Ansagen sind eigens für dieses Spiel geschrieben (siehe AGENTS.md: keine Texte oder Sounds aus Referenzspielen).
