# Twitch-Chatbot (Windows 11)

Ein einfacher Node.js-Bot mit Chat-Befehlen. Er verbindet sich mit Twitch über `tmi.js`.

## Voraussetzungen
- Windows 11
- Node.js LTS (Version 20 oder neuer empfohlen)
- Twitch-Konto für den Bot. Du kannst auch dein eigenes Konto verwenden, ein separates Bot-Konto ist aber übersichtlicher.

## Installation
1. Installiere Node.js LTS von https://nodejs.org/ und lasse die Option zum Hinzufügen zum PATH aktiviert.
2. Entpacke den Projektordner an einen Ort, z. B. `C:\TwitchBot`.
3. Öffne den Ordner im Explorer, klicke in die Adressleiste, tippe `cmd` und drücke Enter.
4. Führe aus:
   ```bat
   npm install
   ```
5. Kopiere `.env.example` zu `.env`.
   - Im Explorer: `.env.example` kopieren und die Kopie `.env` nennen.
   - Falls Windows Dateiendungen ausblendet, aktiviere im Explorer **Ansicht > Anzeigen > Dateinamenerweiterungen**.
6. Erstelle einen Twitch-Zugriffstoken für das Bot-Konto. Eine einfache Möglichkeit ist https://twitchtokengenerator.com/ . Wähle nur die für Chat-Schreiben nötigen Berechtigungen, insbesondere `chat:read` und `chat:write`, und prüfe den angezeigten OAuth-Token. Verwende nur einen Dienst, dem du vertraust. Gib Token niemals weiter und committe `.env` nicht in Git.
7. Trage in `.env` ein:
   ```env
   BOT_USERNAME=dein_bot_account
   TWITCH_CHANNEL=dein_twitch_kanal
   TWITCH_OAUTH=oauth:DEIN_TOKEN_HIER
   TWITCH_CLIENT_ID=deine_twitch_client_id
   TWITCH_BROADCASTER_ID=deine_broadcaster_id
   DEBUG_TIMER=false
   DISCORD_INVITE=https://discord.gg/DEININVITE
   SOCIALS_URL=https://example.com
   TIMEZONE=Europe/Berlin
   GIVEAWAY_API_URL=https://DEIN-PROJEKT.vercel.app/api/giveaway
   GIVEAWAY_BOT_SECRET=ein-langes-geheimes-bot-passwort
   ```
   - `BOT_USERNAME` ist der Twitch-Benutzername, zu dem der Token gehört.
   - `TWITCH_CHANNEL` ist der Kanal, in den der Bot schreiben soll.
   - `TWITCH_OAUTH` muss `oauth:` vor dem Token enthalten. Wenn der Token-Dienst bereits `oauth:` ausgibt, nicht doppelt hinzufügen.
8. Starte den Bot:
   ```bat
   npm start
   ```

Wenn die Verbindung klappt, zeigt die Konsole „Verbunden mit Twitch“. Lass dieses Fenster offen, solange der Bot laufen soll.

## Giveaway-Seiten

Nach dem Vercel-Deployment gibt es zwei getrennte Seiten:

```text
https://DEIN-PROJEKT.vercel.app/giveaway        # öffentliche Live-Seite
https://DEIN-PROJEKT.vercel.app/giveaway/admin  # Admin-Dashboard
```

Vercel verwendet Supabase als gemeinsame Datenbank. Führe zuerst [`supabase/schema.sql`](supabase/schema.sql) im Supabase SQL Editor aus. Die Giveaway-Tabellen heißen `tw_giveaway_state` und `tw_giveaway_commands`, sind mit RLS geschützt und werden nur serverseitig über den Secret-Key angesprochen. Die Datei ist idempotent: Bei einem Update einfach erneut ausführen, dann werden neue Spalten und Constraints ergänzt.

Setze anschließend in Vercel diese Umgebungsvariablen:

```env
GIVEAWAY_SUPABASE_URL=https://DEIN-PROJEKT.supabase.co
GIVEAWAY_SUPABASE_SECRET_KEY=dein-supabase-secret-key
GIVEAWAY_ADMIN_SECRET=ein-langes-admin-passwort
GIVEAWAY_BOT_SECRET=ein-langes-geheimes-bot-passwort
```

`GIVEAWAY_BOT_SECRET` muss mit der gleichnamigen KATABUMP-Variable übereinstimmen. `GIVEAWAY_ADMIN_SECRET` wird nur im Dashboard als Passwort verwendet und gehört nicht in KATABUMP.
Den `GIVEAWAY_SUPABASE_SECRET_KEY` niemals in `public/`, im Browser oder in KATABUMP eintragen.

## Befehle im Twitch-Chat
- `!help` oder `!hilfe` — zeigt die Befehle
- `!discord` — zeigt den Discord-Link, falls `DISCORD_INVITE` in `.env` gesetzt ist
- `!socials` — zeigt den Socials-Link, falls `SOCIALS_URL` gesetzt ist
- `!würfel` — würfelt von 1 bis 6
- `!würfel 20` — würfelt von 1 bis 20 (maximal 100)
- `!timer 10 Giveaway startet jetzt` — erstellt einen Timer bis zu 24 Stunden und pinnt ihn im Chat
- `!timer stop` — beendet den Timer und entfernt den Pin
- `!latenz` — zeigt die gemessene Chat-Latenz des Bot-Empfangs; die Video-Latenz ist nur über Twitch Video Stats sichtbar
- `!wt` oder `!watchtime` — zeigt die gespeicherte Chat-Watchtime des Nutzers
- `!giveawaystart 10 Preis` — startet als Broadcaster ein Giveaway für 10 Minuten
- `giveaway` oder `!giveaway` — nimmt einmalig am aktiven Giveaway teil (Standard-Teilnahme-Wort, im Dashboard änderbar)

Für die Twitch-Login-Fehlersuche kannst du in KataBump `DEBUG_TWITCH=true` setzen und den Bot neu starten. Der Bot prüft dann den Token über Twitch, vergleicht den Token-Login mit `BOT_USERNAME`, zeigt die gewährten Scopes und protokolliert Twitch-Notices sowie Verbindungsfehler. Der Token selbst wird niemals ausgegeben. Setze die Variable nach der Fehlersuche wieder auf `false`.\n\nFür die Timer-Fehlersuche kannst du in KataBump `DEBUG_TIMER=true` setzen und den Bot neu starten. Im Log erscheinen fehlende Variablen, IDs, API-Pfade und Twitch-Fehler, aber niemals der OAuth-Token. Danach wieder auf `false` setzen.

Im Admin-Dashboard unter `/giveaway/admin` meldest du dich mit `GIVEAWAY_ADMIN_SECRET` an. Dort kannst du Giveaways starten, stoppen, nach dem Ende einen neuen Gewinner ziehen und die Twitch-Namen aller Teilnehmer sehen. Die Namen sind nur im Admin-Bereich sichtbar. `GIVEAWAY_BOT_SECRET` bleibt ausschließlich für die Verbindung zwischen KataBump und Vercel.

Vor dem Start kannst du für Broadcaster, Moderator, VIP, Subscriber, Follower und Viewer jeweils die Teilnahme erlauben oder sperren und eine Gewinnchance als Ticket-Gewicht setzen. Es wird ausschließlich die höchste passende Rolle verwendet; Rollen werden nicht addiert.

Die Anmeldung bleibt 30 Tage bestehen: Der Server setzt ein `HttpOnly`-Session-Cookie (`SameSite=Strict`, auf HTTPS zusätzlich `Secure`), das Passwort selbst wird nicht im Browser gespeichert. Über „Abmelden“ wird die Sitzung beendet und das Cookie gelöscht. Wird `GIVEAWAY_ADMIN_SECRET` geändert, werden alle bestehenden Sitzungen ungültig.

Im Admin-Bereich kannst du außerdem das **Teilnahme-Wort** ändern. Standard ist `giveaway`; das Wort funktioniert mit und ohne `!`, Zuschauer können also `giveaway` oder `!giveaway` in den Chat schreiben. Erlaubt sind 2 bis 24 Zeichen (Buchstaben, Zahlen, `_` und `-`, kein Leerzeichen). Das Wort gilt sofort, auch für ein laufendes Giveaway, und wird vom Bot automatisch übernommen. Bereits vergebene Chat-Befehle wie `!würfel` sind gesperrt.

Ein Giveaway läuft maximal 120 Minuten. Nach Ablauf wird automatisch zufällig ein Gewinner ausgewählt und im Twitch-Chat bekannt gegeben. Pro Kanal kann nur ein Giveaway gleichzeitig laufen.

Für ein dauerhaftes Giveaway aktivierst du im Admin-Dashboard die Option „Dauerhaftes Giveaway“. Die Dauer bleibt dabei leer bzw. wird ignoriert: Die Runde endet nur, wenn du sie manuell beendest. Danach startest du die nächste Runde ebenfalls manuell. Die bisherigen Teilnehmer werden übernommen, der Gewinner der letzten Runde wird automatisch ausgeschlossen.

Die Watchtime wird als aktive Chat-Zeit berechnet: Nutzer, die im Chat schreiben, erhalten ungefähr eine Minute pro aktiver Minute. Nach fünf Minuten ohne Chat-Aktivität wird die Zeit pausiert. Die Daten werden in Supabase gespeichert.

## Häufige Probleme
- **Login-Fehler / Login authentication failed:** Prüfe, ob Token und `BOT_USERNAME` zum selben Twitch-Konto gehören. Erstelle ggf. einen neuen Token.
- **Bot verbindet sich, schreibt aber nicht:** Prüfe die Berechtigungen `chat:read` und `chat:write`, den Kanalnamen und ob der Bot im Kanal schreiben darf.
- **`npm` wird nicht erkannt:** Installiere Node.js LTS erneut und aktiviere „Add to PATH“. Danach ein neues CMD-Fenster öffnen.
- **Befehl wird ignoriert:** Mit `!hilfe` testen und sicherstellen, dass die Nachricht mit `!` beginnt.

## Sicherheit
- `.env` enthält deinen Zugriffstoken. Teile diese Datei nicht und poste den Token nicht in Screenshots oder Chats.
- Falls der Token versehentlich offengelegt wird, widerrufe ihn beim Anbieter und erstelle einen neuen.
- Der Bot ist lokal: Er ist nur online, solange dein PC läuft und der Prozess aktiv ist.
