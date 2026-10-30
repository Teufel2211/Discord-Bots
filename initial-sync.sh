#!/bin/bash
# [INITIAL-SYNC] Erst-Sync: alles wichtige von GitHub auf Katabump bringen

echo "[INITIAL-SYNC] Starte initialen Sync (GitHub -> Katabump) ..."

git pull origin master
if [ $? -ne 0 ]; then
  echo "[INITIAL-SYNC] Git-Pull fehlgeschlagen - Sync abgebrochen."
  exit 1
fi

git push origin master >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "[INITIAL-SYNC] Push fehlgeschlagen - Katabump-Sync nicht ausloesbar."
fi

echo "[INITIAL-SYNC] Initial-Sync abgeschlossen."
