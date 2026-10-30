# Discord Bots

Sammlung der Discord- und Twitch-Bots.

## KataBump-Betrieb

Es gibt zwei unterstützte Betriebsarten:

### Eine KataBump-Instanz für alle drei Bots

Wenn alle drei Bots in EINER KataBump-Instanz laufen sollen:

- **Startbefehl:** `node start-all.js`
- **GitHub-Branch:** optional `GITHUB_BRANCH=master` (Standard: `master`)
- Beim Start wird zuerst das GitHub-Repository synchronisiert.
- Danach werden die Root-Abhängigkeiten installiert.
- Erst anschließend werden VC, BWW und TTV gestartet.

Damit werden Änderungen aus GitHub bei jedem Neustart übernommen, ohne dass drei einzelne KataBump-Instanzen benötigt werden.

### Drei getrennte KataBump-Instanzen

Wenn jeder Bot einen eigenen KataBump-Server haben soll:

| KataBump-Variable | Bot | Startdatei |
|---|---|---|
| `BOT_ABBR=BWW` | Bundeswehr Waldstädt | `bww/src/index.js` |
| `BOT_ABBR=VC` | Voice-Chat-Holder | `current/index.js` |
| `BOT_ABBR=TTV` | Twitch-Chatbot | `twitch-chatbot/src/index.js` |

Auf jeder Instanz lautet der Startbefehl `npm start`. Setze zusätzlich `GITHUB_BRANCH=master` und `SYNC_REQUIRED=true`. `bot-sync.js` synchronisiert dann den Branch und startet nur den ausgewählten Bot.

## Wichtige Hinweise

- Der Sync führt einen Hard-Reset auf `origin/<Branch>` aus. Lokale Änderungen an versionierten Dateien werden dadurch verworfen.
- Nicht versionierte Dateien wie die jeweilige `.env` bleiben erhalten.
- Tokens und Secrets niemals in GitHub committen.
- Die Abhängigkeiten aller Bots werden zentral über die Root-`package.json` installiert.
- `current/package.json` markiert den VC-Bot als ES-Modul, damit seine `import`-Anweisungen korrekt ausgeführt werden.

## Bots

| Bot | Beschreibung | Ordner |
|---|---|---|
| **BWW** | Welcome, Verify, Tickets, Giveaways | `bww/` |
| **VC** | Voice-Chat-Holder | `current/` |
| **TTV** | Twitch-Chatbot | `twitch-chatbot/` |
