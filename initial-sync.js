const { execSync } = require('child_process');
const fs = require('fs');

// Harte Quelle: Repo + Branch, aus dem gepullt wird (GitHub -> KataBump).
const REPO_URL = 'https://github.com/Teufel2211/Discord-Bots.git';
const BRANCH = 'master';

function sh(cmd) {
  return execSync(cmd, { stdio: 'inherit' });
}

function shOk(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

try {
  // 1) Git-Repo existiert? Wenn nicht, mit Branch 'master' anlegen.
  if (!shOk('git rev-parse --is-inside-work-tree')) {
    console.log('[INITIAL-SYNC] Kein Git-Repo gefunden - initialisiere Repo ...');
    if (!shOk('git init -b master')) {
      sh('git init'); // Aeltere Git-Version ohne -b
    }
  }

  // 2) Remote 'origin' hart auf GitHub setzen (ohne stoerende Fehlermeldung).
  if (shOk('git remote get-url origin')) {
    sh(`git remote set-url origin ${REPO_URL}`);
  } else {
    sh(`git remote add origin ${REPO_URL}`);
  }
  console.log(`[INITIAL-SYNC] Remote 'origin' -> ${REPO_URL}`);

  // 3) Branch holen und Working-Tree hart auf GitHub-Stand setzen.
  //    Untracked Dateien (.env, node_modules) bleiben erhalten.
  sh(`git fetch origin ${BRANCH}`);
  sh(`git checkout -f -B ${BRANCH} origin/${BRANCH}`);

  console.log(`[INITIAL-SYNC] Pull erfolgreich: GitHub -> KataBump (Branch '${BRANCH}').`);
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
