# PROJECT: MEDIEVAL KINGDOMS – Arbeitsregeln für Agenten

Ein eigenständiges, isometrisches 2D-Pixelart-RTS mit sichtbarer Wirtschaft und begehbaren Befestigungen. Zuerst [BRIEF.md](BRIEF.md) lesen, dann [docs/concept/README.md](docs/concept/README.md).

## Grundsätze

- **Keine Kernmechanik nur kosmetisch.** Waren werden von Figuren getragen, Lager zeigen ihren Bestand sichtbar, Mauern sind begehbar und militärisch nutzbar. Was nur eine Zahl hochzählt, erfüllt die Anforderung nicht.
- **Simulation und Darstellung strikt trennen.** Die Spiellogik läuft ohne Renderer und ist automatisiert testbar. Darstellung, UI und Daten sind eigene Schichten.
- **Datengetrieben.** Einheiten, Gebäude, Ressourcen, Rezepte und Technologien sind Daten-Definitionen, keine Sonderfälle im Code.
- **Drehung ist echte Logik.** 90°-Rotation betrifft Raster, Sortierung, Sprite-Ansichten und Platzierung, nicht nur die Kamera.
- **Eigenständige Spielidentität.** Stronghold und Age of Empires sind Referenzen für Mechanik und Spielgefühl. Keine Namen, Grafiken, Texte, Sounds oder Code daraus übernehmen.
- Spielertexte auf Deutsch.

## Dokumentation

- Entscheidungen mit Tragweite (Engine, Koordinatensystem, Art-Pipeline, Save-Format …) als ADR in `docs/decisions/` festhalten.
- `docs/STATUS.md` aktuell halten und dabei auseinanderhalten: Konzept, implementierter Code, automatisierte Tests, im Browser bzw. Spiel geprüft.
- Grenzen und offene Punkte ehrlich benennen.

## Grafik

- Bildgenerierung über `tools/codex-imagegen.py` (siehe [tools/IMAGEGEN.md](tools/IMAGEGEN.md)). Einen fehlgeschlagenen Bildauftrag nicht stillschweigend durch programmatisch gezeichnete Grafik ersetzen.
- Ein Bild gilt erst als vorhanden, wenn es geprüft wurde (Maße, Transparenz, Stil).

## Grenzen

Nur in diesem Projekt arbeiten. Keine anderen Projekte, globalen Einstellungen, Zugangsdaten oder Infrastruktur verändern. Lokale Pakete, lokale Server, Tests, Screenshots und lokale Commits sind erlaubt. Nichts veröffentlichen, keine Remote-Repositories anlegen und keine Nachrichten verschicken ohne ausdrückliche Freigabe.

Das Repo `LoggeL/project-medieval-kingdoms` ist **öffentlich**, jeder Push auf `main` geht per Dokploy live auf medieval-kingdoms.logge.top (siehe [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). Pushen nur mit Freigabe. Keine Zugangsdaten, Klarnamen Dritter oder privaten Nachrichten einchecken.
