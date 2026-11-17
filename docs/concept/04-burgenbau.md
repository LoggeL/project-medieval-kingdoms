# 04 – Siedlungs- und Burgenbau

> Status: **Entwurf v1** (16.11.2026)

## Gebäude platzieren

- Jedes Gebäude hat einen **Grundriss in Welt-Tiles** (z. B. 2 × 2, 3 × 4), einen **Eingangs-Tile** und eine **Ausrichtung** (N, O, S, W). Mit `R` dreht man das Gebäude vor dem Platzieren.
- **Platzierungsregeln** stehen in den Gebäudedaten: ebener Grund, kein Überlappen, erlaubte Geländearten, Zusatzbedingungen. Beispiele:
  - Holzfäller: mindestens 8 Bäume im Radius 10
  - Steinbruch: Grundriss muss an Fels grenzen
  - Mine: auf einer Erzader
  - Wassermühle: am Fluss
- Die **Bauvorschau** zeigt grün und rot pro Tile, Wirkungsradien (Holzfäller-Radius, Turm-Reichweite), den Eingang und die Kosten.
- **Straßenanbindung** ist nicht Pflicht, aber spürbar: Träger und Karren sind auf Straßen schneller, Fuhrwerke brauchen sie. Straßen werden per Ziehen gebaut und verbinden sich automatisch.

## Bauen dauert und ist sichtbar

1. **Baustelle:** abgesteckter Grundriss mit Pflöcken und Schnur
2. **Material:** Tagelöhner bringen Holz und Stein, das sichtbar neben der Baustelle liegt
3. **Rohbau:** Fundament, Gerüst, Bauarbeiter hämmern
4. **Fertig:** Gerüst verschwindet, Rauch steigt auf, der Arbeiter zieht ein

Bauzeit hängt von Material und Gebäudegröße ab. Fehlt Material, steht die Baustelle still.

## Ausbaustufen

Wohngebäude und viele Werkstätten haben 2–3 Stufen mit eigener Optik und mehr Kapazität, freigeschaltet durch Forschung:

| Stufe | Wohnen | Optik |
|---|---|---|
| 1 | Hütte (4 Bewohner) | Flechtwerk, Strohdach |
| 2 | Fachwerkhaus (8) | Fachwerk, Schindeldach |
| 3 | Bürgerhaus (12) | Stein-Erdgeschoss, Ziegeldach, Erker |

## Befestigungen

### Bausteine

| Baustein | Material | Begehbar | Besonderheit | Freischaltung |
|---|---|---|---|---|
| **Palisade** | Holz | nein | billig, schnell, brennbar | Start |
| **Palisade mit Wehrgang** | Holz | ja (Holzsteg) | Fernkämpfer stehen ungedeckt | Forschung |
| **Steinmauer** | Stein | ja | Grundmauer, Wehrgang oben | Start (teuer) |
| **Zinnen** | Stein | – | Aufwertung einer Mauer: Deckung gegen Fernkampf | Forschung |
| **Verstärkte Mauer** | Stein, Eisen | ja | mehr Haltbarkeit, 2 Posten pro Tile | Forschung |
| **Treppe** | Holz / Stein | ja | Zugang zum Wehrgang, an die Mauer angesetzt | Start |
| **Mauerturm, klein / groß** | Stein | ja | 4 bzw. 8 Posten, +1 Höhe, innenliegende Treppe | Start / Forschung |
| **Wachturm** | Holz | ja | freistehend, 2 Posten, großes Sichtfeld | Start |
| **Schießscharten** | – | – | Aufwertung für Turm oder Mauer: Schützen fast unverwundbar, aber kleiner Schusswinkel | Forschung |
| **Tor** | Holz | – | öffnet für eigene Einheiten automatisch | Start |
| **Torhaus** | Stein | ja | Tor mit Fallgatter und Posten darüber | Forschung |
| **Fallgatter** | Eisen | – | sperrt das Tor auch für eigene Einheiten (manuell) | Torhaus |
| **Graben** | – | – | von Tagelöhnern ausgehoben. Trocken: Bewegung ×0,3, flutbar bei Wasseranschluss | Start |
| **Zugbrücke** | Holz, Eisen | – | überbrückt den Graben vor einem Tor, kann hochgezogen werden | Forschung |
| **Pechnase** | Stein, Pech | – | über Toren: verbrüht Angreifer am Tor | Forschung |
| **Turmgeschütz** | Holz, Eisen | – | Balliste bzw. Springald, später Hakenbüchse auf Türmen | Forschung |
| **Erdwall / Bastion** | Erde, Stein | ja | niedrig und dick: nimmt Kanonen kaum Schaden | Pulver-Zweig |

### Mauern ziehen

- Mauern werden **Tile für Tile per Ziehen** gebaut, gerade und diagonal. Diagonalen werden als Treppenstufen mit passenden Eck-Sprites dargestellt.
- **Autotiling:** Jeder Mauer-Tile wählt sein Sprite aus der Nachbarschaft (gerade, Ecke, T-Stück, Kreuzung, Ende, Anschluss an Turm oder Tor). Die Nachbarschaft wird in Welt-Richtungen gespeichert und erst beim Zeichnen in die Kameraansicht umgerechnet.
- Türme und Tore werden **in** eine Mauerlinie gesetzt und ersetzen die Mauer-Tiles darunter.

## Die Mauer als Ort

Das ist das Herzstück der Befestigung.

### Laufebenen
Die Welt hat für Bewegung mehrere Ebenen:

| Ebene | Was | Verbindungen |
|---|---|---|
| 0 – Boden | Gelände, Straßen, Höfe | Treppe, Turm, Torhaus, Sturmleiter, Bresche |
| 1 – Wehrgang | Mauerkronen, Palisaden-Stege | Treppe, Turm, Torhaus, Leiter |
| 2 – Turmplattform | Turmspitzen | nur über das Turminnere |

Einheiten auf dem Wehrgang sind für Nahkämpfer am Boden **unerreichbar**, bis diese eine Treppe, ein offenes Tor, eine angelegte Leiter oder eine Bresche finden. Die Pfadsuche kennt diese Übergänge.

### Posten und automatische Verteilung
- Jeder Wehrgang-Tile hat **1 Posten** (verstärkte Mauer: 2), jeder Turm 4 oder 8.
- Befehl **„Auf Mauer stationieren“**: Der Spieler wählt Truppen und klickt einen Mauerabschnitt oder zieht eine Linie entlang der Mauer. Die Verteilung:
  1. Fernkämpfer bevorzugen Posten mit Zinnen bzw. Scharten **auf der Feindseite** und Türme
  2. Nahkämpfer bevorzugen **Treppenköpfe, Torhäuser und Leiterstellen**, also Engstellen
  3. Innerhalb der Gruppe gilt der kürzeste Weg, bereits besetzte Posten werden übersprungen
- Ohne Ziel-Abschnitt verteilt `Strg + Klick` auf die nächstgelegene Mauer.
- Eine Einheit auf einem Posten bleibt dort (Haltung „Posten halten“), bis sie neue Befehle bekommt. Stirbt ein Nachbar, rückt optional ein Nahkämpfer nach.

### Boni auf der Mauer

| Effekt | Wert (Start) |
|---|---|
| Reichweite Fernkampf | +1 pro Höhenstufe (Wehrgang +1, Turm +2) |
| Deckung durch Zinnen | –50 % erlittener Fernkampfschaden |
| Deckung durch Scharten | –80 % erlittener Fernkampfschaden, Schusswinkel 90° |
| Verteidigung am Leiterkopf | Erstschlag und +50 % Schaden gegen Kletternde |
| Moral | Verteidiger auf Mauern verlieren langsamer Moral |

### Angriff auf Mauern
- **Sturmleitern:** Leiterträger legen sie an. Damit entsteht eine Verbindung Boden ↔ Wehrgang, über die Einheiten einzeln und langsam klettern. Verteidiger können Leitern umstoßen (Animation, Kletternde fallen).
- **Rammbock** gegen Tore.
- **Belagerungsturm:** wird an die Mauer geschoben und schafft einen breiten Übergang.
- **Wurfmaschinen und Bombarden** beschädigen Mauern. Jeder Mauer-Tile hat Haltbarkeit und **3 Schadensstufen** (Risse, zerstörte Zinnen, Loch). Bei 0 entsteht eine **Bresche**: Trümmer-Tile auf Ebene 0, begehbar mit Kletter-Malus. Der Wehrgang ist an der Stelle unterbrochen.
- **Mineure** untergraben Mauern (langsam, gegen Gräben machtlos).
- **Feuer:** Palisaden und Holztürme können brennen. Brandpfeile kommen über Forschung.
- **Reparatur:** Maurer bringen Stein und flicken Schäden außerhalb des Kampfes sichtbar mit Gerüst.

### Tore
Eigene Tore öffnen sich automatisch für eigene Einheiten und Träger. Der Spieler kann ein Tor **verriegeln**. Das Fallgatter sperrt auch dann, wenn das Tor zerstört ist. Die Zugbrücke kann hochgezogen werden und unterbricht den Weg über den Graben komplett.

## Lesbarkeit trotz Mauern

Mauern verdecken in der Isometrie alles dahinter. Deshalb:
- **Silhouetten:** Eigene und gegnerische Einheiten hinter Gebäuden und Mauern werden als farbige Umrisse durchgezeichnet.
- **Ausblenden:** Um den Mauszeiger herum werden Dächer und Mauern auf Wunsch abgesenkt bzw. halbtransparent (Taste `Tab`).
- **Drehen:** Die 90°-Drehung ist das wichtigste Werkzeug, um hinter die eigene Mauer zu schauen. Deshalb muss sie schnell sein (Tastendruck, kurze Überblendung).

## Umfang im ersten Prototyp

Palisade, Steinmauer, Treppe, kleiner Mauerturm, Holztor. Laufebenen 0 und 1 (ohne Turmplattform), Stationierung mit automatischer Verteilung, Reichweiten- und Deckungsbonus, Sturmleitern beim geskripteten Überfall. Keine Breschen, kein Feuer.
