const { execSync } = require('child_process');
const fs = require('fs');

// [INITIAL-SYNC] Erst-Sync: alles wichtige von GitHub pullen
execSync('git pull origin master', { stdio: 'inherit' });

// Danach die Initial-Sync-Datei wieder selbst löschen
fs.unlinkSync(__filename);

console.log('[INITIAL-SYNC] Initial-Sync abgeschlossen: GitHub -> Katabump.');
