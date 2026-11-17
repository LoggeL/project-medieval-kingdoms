# 10 – Offene Fragen an Sebastian

> Stand: 16.11.2026. Die Antworten fließen in die Kapitel und die ADRs ein.

## Muss vor dem Prototyp geklärt sein

1. **Grafik-Pipeline:** Ist der Hybrid in Ordnung, also einfache 3D-Modelle als *Werkzeug*, gerendert zu Pixelart (siehe [07](07-art-direction.md))? Im Spiel ist alles 2D-Pixelart. Ohne diesen Weg sind vier Drehansichten pro Gebäude und acht Richtungen pro Figur kaum zu schaffen.
2. **Plattform, entschieden am 17.11.2026:** vorerst Browser, ein Desktop-Build ist später möglich. Siehe [ADR 0001](../decisions/0001-engine.md).
3. **Figurengröße:** Etwa 30 px hohe Figuren auf 64 × 32-Tiles, also eher kleinteilig-detailliert. Oder lieber größere Figuren mit weniger Übersicht?
4. **Kann jemand im Team Blender oder Aseprite?** Davon hängt ab, wie viel prozedural und wie viel von Hand entsteht.

## Spielerisch zu entscheiden

5. **Setting:** Fiktives Reich „Kronmark“ mit historischem Vorbild, oder ein echter historischer Raum?
6. **Doktrinen:** Sollen Forschungs-Gabelungen wirklich Wege sperren (Langbogen *oder* schwere Armbrust), oder soll man langfristig alles bekommen können?
7. **Zufriedenheit:** Passt das Stronghold-nahe Modell (Nahrung, Steuern, Glaube, Bier, Ordnung)? Oder lieber Bevölkerungsschichten mit eigenen Bedürfnissen wie in Siedler- und Anno-Spielen?
8. **Jahreszeiten mit Spielwirkung** (Winter ohne Ernte), oder nur optisch?
9. **Höhenstufen:** echte Geländehöhe mit Hängen und Klippen (mehr Taktik, mehr Aufwand), oder flach mit Hügeln als Hindernis?
10. **Mehrspieler:** irgendwann gewünscht? Dann wird die Simulation von Anfang an streng deterministisch gebaut (ist ohnehin geplant, erhöht aber den Testaufwand).
11. **Kampagne:** Wie wichtig ist eine Geschichte gegenüber freiem Spiel und Gefechten?

## Umfang und Rahmen

12. **Ziel des Projekts:** Hobby und Lernprojekt, Vorzeige-Prototyp oder ernsthafter Release (Steam)? Das bestimmt, wie viel Handarbeit in die Grafik fließt.
13. **Sound und Musik:** selbst erzeugt, frei lizenziert oder ein Musiker im Freundeskreis?
14. **Name:** „PROJECT: MEDIEVAL KINGDOMS“ als Arbeitsname, oder schon der Endtitel?
