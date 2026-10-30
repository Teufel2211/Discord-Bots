const { execSync } = require('child_process');
const fs = require('fs');

try {
  execSync('git pull origin master', { stdio: 'inherit' });
} catch {
  console.log('[INITIAL-SYNC] Git-Pull fehlgeschlagen - ueberspringe.');
}

try {
  fs.unlinkSync(__filename);
} catch {
  // Datei bereits geloescht / anderer Pfad
}

console.log('[INITIAL-SYNC] Initial-Sync abgeschlossen.');

// In KataBump-Haltung weiterlaufen lassen - Server nicht beenden.
setInterval(() => {}, 60_000);

console.log('[INITIAL-SYNC] Server laeuft weiter.');
