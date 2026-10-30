const { execSync } = require('child_process');
const fs = require('fs');

// Harte Quelle: Repo + Branch, aus dem gepullt wird (GitHub -> KataBump).
const REPO_URL = 'https://github.com/Teufel2211/Discord-Bots.git';
const BRANCH = 'master';

function sh(cmd) {
  return execSync(cmd, { stdio: 'inherit' });
}

try {
  // 1) Sind wir in einem Git-Repo?
  let isRepo = true;
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch {
    isRepo = false;
  }

  if (!isRepo) {
    console.log('[INITIAL-SYNC] Kein Git-Repo gefunden - initialisiere Repo ...');
    sh('git init');
  }

  // 2) Remote 'origin' hart auf GitHub setzen (funktioniert auch, wenn keiner existiert).
  try {
    sh('git remote remove origin');
  } catch {
    // kein Remote vorhanden - egal
  }
  sh(`git remote add origin ${REPO_URL}`);

  // 3) Branch holen und Working-Tree hart auf GitHub-Stand setzen.
  //    Untracked Dateien (.env, node_modules) bleiben erhalten.
  sh(`git fetch origin ${BRANCH}`);
  sh(`git checkout -f -B ${BRANCH} origin/${BRANCH}`);

  console.log('[INITIAL-SYNC] Pull erfolgreich: GitHub -> KataBump.');
} catch (e) {
  console.log('[INITIAL-SYNC] Git-Pull fehlgeschlagen - ueberspringe.');
}

// Danach die Initial-Sync-Datei selbst loeschen (war ein einmaliger Bootstrap).
try {
  fs.unlinkSync(__filename);
} catch {
  // bereits geloescht / anderer Pfad
}

console.log('[INITIAL-SYNC] Initial-Sync abgeschlossen.');

// In KataBump-Haltung weiterlaufen lassen - Server nicht beenden.
setInterval(() => {}, 60_000);

console.log('[INITIAL-SYNC] Server laeuft weiter.');
