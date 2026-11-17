# 02 – Welt und Karten

> Status: **Entwurf v1** (16.11.2026)

## Raster und Höhe

- Die Karte ist ein **Tile-Raster mit Höhenstufen 0–4**. Jede Stufe ist eine halbe Tile-Höhe hoch. Übergänge entstehen über **Hänge** (begehbar, langsamer) oder **Klippen** (nicht begehbar).
- Gebäude stehen nur auf ebenem Grund (alle Tiles des Grundrisses auf gleicher Höhe). Mauern dürfen Höhen folgen und bekommen dafür Stufen-Varianten.
- Höhe hat Spielwirkung: **+1 Reichweite für Fernkämpfer pro Stufe Höhenvorteil**, Sichtschutz hinter Kuppen für Belagerungsgerät.
- Im ersten Prototyp ist die Karte überwiegend flach mit einem Plateau. Das Datenmodell kennt die Höhe aber von Anfang an, weil ein späterer Einbau teuer wäre.

## Kartengrößen

| Größe | Tiles | Spieler | Zweck |
|---|---|---|---|
| Klein | 128 × 128 | 1–2 | Szenarien, Prototyp |
| Mittel | 192 × 192 | 2–3 | Standard-Gefecht |
| Groß | 256 × 256 | 3–4 | Große Gefechte, Leistungsgrenze |

## Gelände und Rohstoffe

| Gelände | Spielwirkung | Rohstoff / Gebäude |
|---|---|---|
| **Wiese** | Fruchtbarkeit 0–3 pro Tile (sichtbar an Grasfarbe, Blumen) | Äcker, Weiden, Obstgärten brauchen Fruchtbarkeit ≥ 2 |
| **Wald** (Laub / Nadel) | Bewegung ×0,8, blockiert Bau | Holz (Holzfäller), Wild (Jäger), Holzkohle (Köhler), Pech (Pechsieder, Nadelwald) |
| **Fels** | nicht begehbar, Steinbrüche nur direkt am Fels | Stein, nimmt beim Abbau sichtbar ab |
| **Erzader** | im Fels oder an Hängen, sichtbar an Färbung | Eisenerz (Mine). Später: Salpeter-Erde für Pulver |
| **Sumpf** | Bewegung ×0,5, kein Bau außer Spezialgebäuden | Torf (Brennstoff), Schilf (Dächer), Pech |
| **Fluss / See** | nicht begehbar außer an Furten (Bewegung ×0,4) | Fisch (Fischer), Wassermühle, Brücken baubar |
| **Küste** | wie Wasser, dazu Strand | Fisch, später Hafen und Seehandel |
| **Straße** | Bewegung ×1,4 (Schotter) bzw. ×1,7 (Pflaster, Forschung) | Karren fahren nur auf Straßen mit voller Geschwindigkeit |

## Erneuerbar oder endlich

- **Wald wächst nach**, langsam von allein, schneller durch den Förster, der sichtbar Setzlinge pflanzt. Baumstümpfe bleiben stehen, bis sie überwachsen sind.
- **Stein und Erz sind endlich**, aber großzügig. Ein abgebauter Fels schrumpft sichtbar in mehreren Stufen.
- **Fruchtbarkeit** sinkt bei Dauernutzung leicht. Forschung „Dreifelderwirtschaft“ hebt das auf.
- **Wild** wandert in Herden und vermehrt sich, wenn man es nicht überjagt.

## Wasser

Flüsse sind die wichtigsten strategischen Linien: natürliche Gräben, Hindernisse für Angreifer, aber auch Grenzen für die eigene Logistik. Übergänge entstehen über **Furten** (natürlich, langsam), **Holzbrücken** (billig, brennbar) und **Steinbrücken** (Forschung). Ein Burggraben, der an einen Fluss angeschlossen wird, flutet sich selbst. Flößerei und Schiffe sind spätere Erweiterungen.

## Jahreszeiten

| Jahreszeit | Optik | Spielwirkung |
|---|---|---|
| Frühling | frisches Grün, Blüten | Aussaat, Tiere werfen Junge |
| Sommer | sattes Grün, Staub auf Wegen | Getreide wächst sichtbar in Stufen |
| Herbst | Gold und Rot, Laub fällt | Ernte. Getreide nicht rechtzeitig geerntet verdirbt |
| Winter | Schnee, gefrorene Seen | Keine Feldarbeit, Vorräte zählen. Gefrorene Gewässer sind begehbar |

Jahreszeiten sind pro Partie abschaltbar („ewiger Sommer“) für Spieler, die nur bauen wollen.

## Kein Nebel des Krieges

Die gesamte Karte ist immer sichtbar. Das passt zu einer Welt, in der man den Rauch der gegnerischen Schmieden am Horizont sieht. Taktische Überraschung entsteht über **Deckung** (Wald, Kuppen, Mauern verdecken Ziele für Fernkampf) und nicht über Unsichtbarkeit.

## Kartenquellen

- **Handgebaute Karten** für Szenarien und Kampagne, gebaut mit einem einfachen internen Editor (Gelände malen, Höhe heben und senken, Rohstoffe setzen). Der Editor entsteht aus dem Debug-Werkzeug des Prototyps.
- **Zufallskarten** für Gefechte: Höhenrauschen, Flüsse entlang des Gefälles, Wälder und Rohstoffe nach Regeln, faire Startplätze.

## Die Prototyp-Karte

128 × 128 Tiles: ein Flusstal mit Furt, Mischwald im Norden, Felsen mit Steinbruchplatz im Osten, fruchtbare Wiesen im Süden, ein kleines Plateau als natürlicher Burgplatz, ein Weg von der Kartenkante, über den der Überfall kommt.
