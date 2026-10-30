# Discord Bots

Sammlung der Discord- und Twitch-Bots.

## Bots und KataBump-Abkürzungen

| KataBump-Variable | Bot | Startdatei |
|---|---|---|
| `BOT_ABBR=BWW` | Bundeswehr Waldstädt | `bww/src/index.js` |
| `BOT_ABBR=VC` | Voice-Chat-Holder | `current/index.js` |
| `BOT_ABBR=TTV` | Twitch-Chatbot | `twitch-chatbot/src/index.js` |

## KataBump: separater GitHub-Sync pro Bot

Jeder KataBump-Server verwendet dasselbe GitHub-Repository, aber eine eigene `BOT_ABBR`-Variable. Beim Start lädt `bot-sync.js` den aktuellen Stand des konfigurierten Branches und startet anschließend ausschließlich den zugehörigen Bot.

**KataBump-Startbefehl für alle drei Server:**
```bash
npm start
```

**Umgebungsvariablen pro KataBump-Server:**

BWW-Server:
```env
BOT_ABBR=BWW
GITHUB_BRANCH=master
SYNC_REQUIRED=true
```

VC-Server:
```env
BOT_ABBR=VC
GITHUB_BRANCH=master
SYNC_REQUIRED=true
```

Twitch-Server:
```env
BOT_ABBR=TTV
GITHUB_BRANCH=master
SYNC_REQUIRED=true
```

Die vorhandenen Bot-Secrets und Konfigurationsvariablen bleiben jeweils im zugehörigen KataBump-Server. Nicht dieselbe `.env`-Datei zwischen den Servern teilen.

**Wichtig:** Der Sync führt `git fetch` und danach einen Hard-Reset auf `origin/<Branch>` aus. Änderungen an versionierten Dateien direkt im KataBump-Dateisystem werden damit verworfen. Nicht versionierte Dateien wie `.env` und `node_modules` bleiben erhalten. Bei fehlgeschlagenem Sync startet der Bot mit `SYNC_REQUIRED=false` ersatzweise mit dem vorhandenen lokalen Stand; mit `true` wird der Start abgebrochen.

## Bots

| Bot | Beschreibung | Ordner |
|---|---|---|
| **BWW** | Welcome, Verify, Tickets, Giveaways | `bww/` |
| **VC** | Voice-Chat-Holder (24/7 VC-Holder, Leave-Grund, Warte-Büro) | `current/` |
| **TTV** | Twitch-Chatbot: Commands, Giveaways, Watchtime | `twitch-chatbot/` |

## Deployment

Alle drei Bots laufen als getrennte KataBump-Server. Jeder Server synchronisiert beim Start aus dem GitHub-Repository, wählt anhand von `BOT_ABBR` nur seine eigene Startdatei und behält seine eigenen Secrets.

## Secrets

- `.env`-Dateien sind nicht im Repository (via `.gitignore` ausgeschlossen).
- Tokens und Secrets niemals in GitHub committen.
