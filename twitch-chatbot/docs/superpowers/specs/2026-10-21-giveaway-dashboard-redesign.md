# Giveaway-Dashboard-Redesign

## Ziel

Das öffentliche Vercel-Dashboard soll den aktuellen Giveaway-Status klar zeigen. Zuschauer sehen Preis, Live-Status, verbleibende Zeit und Teilnehmerzahl. Administratoren melden sich oben rechts mit `GIVEAWAY_ADMIN_SECRET` an und können danach Giveaways starten, stoppen und neu auslosen.

## Oberfläche

- Große Live-Karte im Mittelpunkt mit Preis, Status und Countdown.
- Teilnehmerzahl direkt unter dem Countdown.
- Gewinner und letzter Aktualisierungszeitpunkt im Statusbereich.
- Login-Schaltfläche oben rechts.
- Admin-Steuerung erst nach erfolgreicher Anmeldung sichtbar.
- Admin-Aktionen: Start mit Minuten/Preis, Stoppen und Reroll.
- Responsive Darstellung für Desktop und mobile Geräte.

## Datenfluss und Sicherheit

- Das Frontend ruft ausschließlich `/api/giveaway` auf.
- Der Admin-Login sendet `GIVEAWAY_ADMIN_SECRET` nur als Bearer-Header an die API.
- `GIVEAWAY_BOT_SECRET` bleibt ausschließlich für KataBump-Bot-Synchronisierung und wird nie im Frontend gespeichert.
- Supabase bleibt die persistente Datenquelle über `tw_giveaway_state` und `tw_giveaway_commands`.
- Reroll wird serverseitig validiert und darf nur bei einem beendeten Giveaway ausgeführt werden.

## API-Erweiterungen

- `POST action=start`: startet ein Giveaway.
- `POST action=end`: stoppt ein aktives Giveaway.
- `POST action=reroll`: wählt serverseitig einen neuen Gewinner aus den gespeicherten Teilnehmern.
- Der öffentliche `GET` liefert weiterhin den aktuellen Status ohne Geheimnisse.

## Fehler und Tests

- Falsches Passwort zeigt eine verständliche Fehlermeldung.
- Aktionen bei falschem Status werden abgewiesen.
- Countdown läuft lokal jede Sekunde weiter und synchronisiert den Status regelmäßig.
- API-, JavaScript-Syntax- und Giveaway-Flusstests werden nach der Umsetzung ausgeführt.
