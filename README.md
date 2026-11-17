# Schachbrett
Ein leichtgewichtiges, browserbasiertes Schachbrett mit PGN-Replay und optionaler Engine.

Die PGN-Wiedergabe öffnet einzelne Partien und PGN-Sammlungen. Bei Sammlungen wählst du eine Partie per Nummer. Die Zugliste springt direkt zu einer Stellung der Hauptvariante.

Aktiviere den **Aufgabenmodus** vor dem PGN-Import, um die Lösung verdeckt zu halten. Das Brett prüft deine Züge gegen die gespeicherte Hauptvariante und spielt die Gegenzüge. Mit **Lösung anzeigen** öffnest du die Zugliste wieder.

Die Zugprüfung verwendet [chess.js 1.4.0](https://www.npmjs.com/package/chess.js/v/1.4.0). Die Bibliothek liegt lokal im Ordner `vendor`; der Browser lädt sie zusammen mit dem Brett.

## Live-Demo
https://runlevel-labs.github.io/schachbrett
