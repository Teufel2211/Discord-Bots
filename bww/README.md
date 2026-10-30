# BWW-Bot (bots/bww/)

Quelle: `Teufel2211/bww` (privat, Stand 2026-09) – nur der Bot-Teil (`src/`) liegt hier.
Einstieg für den Loader: `src/index.js` (CommonJS via eigenem `package.json` mit `type: commonjs`).
`sync.js` (Auto-Updater) und `website/` werden NICHT verwendet.

## Env (alle mit `BOT_BWW_`-Prefix im Panel, Loader mappt sie um)

- `BOT_BWW_DISCORD_TOKEN` → zweiter Discord-Bot-Token (eigene App im Developer Portal!)
- `BOT_BWW_SUPABASE_URL` + `BOT_BWW_SUPABASE_SECRET_KEY` → Supabase-Projekt (Migration vorher ausführen, sonst läuft der Bot ohne DB)
- Optional: `BOT_BWW_LOG_WEBHOOK_URL`

## Intents

BWW braucht zusätzlich **Server Members Intent** in seiner Discord-App (Developer Portal → Bot).

## State-Dateien

`config/*.json` (Giveaways, Panels, Polls) legt der Bot selbst an – Ordner existiert, Dateien kommen zur Laufzeit.
