# Discord Bots

Sammlung der Discord- und Twitch-Bots.

## Bots

| Bot | Beschreibung | Ordner |
|-----|--------------|--------|
| **bww** | BBW-Bot (Teufel2211/bww): Welcome, Verify, Tickets, Giveaways | `bww/` |
| **current** | Voice-Chat-Holder Bot (24/7 VC-Holder, Leave-Grund, Warte-Büro) | `current/` |
| **twitch-chatbot** | Twitch-Chatbot: Commands, Giveaways, Watchtime | `twitch-chatbot/` |

## Struktur

```
Discord Bots/
├── .gitignore
├── README.md
├── bww/
├── current/
└── twitch-chatbot/
```

## Setup

- **bww:** siehe `bww/README.md`
- **current:** siehe `current/` + Multibot-Loader (`discord-vc-timer-bot`)
- **twitch-chatbot:** siehe `twitch-chatbot/README.md` + `twitch-chatbot/.env.example`

## Deployment

- **twitch-chatbot:** Vercel (`vercel.json` im Ordner `twitch-chatbot/`)
- **Discord-Bots:** Multibot-Loader / KataBump Startup

## Secrets

- `.env` Dateien sind **nicht** im Repo (via `.gitignore` ausgeschlossen).
- Twitch-Chatbot: `.env.example` ist Vorlage.
