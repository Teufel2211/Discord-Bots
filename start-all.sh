#!/bin/bash
# Startet alle Bots der Sammlung (Discord + Twitch) — Einsatz via Katabump

cd "$(dirname "$0")"

start_bot() {
  local name="$1"
  local entry="$2"
  echo "[START-ALL] Starte Bot: ${name}"
  nohup node "${entry}" > "/tmp/${name}-bot.log" 2>&1 &
}

start_bot "current" "current/index.js"
start_bot "bww" "bww/src/index.js"
start_bot "twitch-chatbot" "twitch-chatbot/src/index.js"

echo "[START-ALL] Alle Bots wurden gestartet."
