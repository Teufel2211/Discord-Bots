const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  syncRepository,
  affectedBots,
  dependenciesChanged,
  intervalMs
} = require('./incremental-sync');

const ROOT = __dirname;
const BOT_MAP = Object.freeze({
  BWW: { label: 'BWW', entry: 'bww/src/index.js' },
  VC: { label: 'VC', entry: 'current/index.js' },
  TTV: { label: 'TTV', entry: 'twitch-chatbot/src/index.js' }
});

let child = null;
let syncing = false;
let restarting = false;
let shuttingDown = false;

function installDependencies() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: ROOT, stdio: 'inherit', windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('npm install fehlgeschlagen (Code ' + result.status + ').');
}

function startBot(bot) {
  if (shuttingDown) return;
  const entryPath = path.join(ROOT, bot.entry);
  if (!require('node:fs').existsSync(entryPath)) {
    console.error('[SYNC:' + bot.label + '] Startdatei fehlt: ' + bot.entry);
    return;
  }
  child = spawn(process.execPath, [entryPath], {
    cwd: ROOT,
    env: { ...process.env, BOT_ABBR: bot.label },
    stdio: 'inherit',
    windowsHide: true
  });
  const currentChild = child;
  currentChild.on('error', error => console.error('[SYNC:' + bot.label + '] Startfehler: ' + error.message));
  currentChild.on('exit', (code, signal) => {
    console.log('[SYNC:' + bot.label + '] Bot beendet (Code ' + code + ', Signal ' + (signal || 'none') + ').');
    if (child === currentChild) child = null;
    if (restarting && !shuttingDown) {
      restarting = false;
      startBot(bot);
    }
  });
}

function scanAndSync(bot) {
  if (syncing || shuttingDown) return;
  syncing = true;
  try {
    const result = syncRepository('SYNC:' + bot.label);
    if (result.changedPaths.length === 0) {
      console.log('[SYNC:' + bot.label + '] Keine Änderungen gefunden.');
      return;
    }
    if (dependenciesChanged(result.changedPaths)) installDependencies();
    if (affectedBots(result.changedPaths).includes(bot.label) && child && child.exitCode === null) {
      console.log('[SYNC:' + bot.label + '] Änderungen am eigenen Bot gefunden – starte neu …');
      restarting = true;
      child.kill('SIGTERM');
    } else if (affectedBots(result.changedPaths).includes(bot.label)) {
      startBot(bot);
    } else {
      console.log('[SYNC:' + bot.label + '] Keine Änderungen am eigenen Bot.');
    }
  } catch (error) {
    console.error('[SYNC:' + bot.label + '] GitHub-Sync fehlgeschlagen: ' + error.message);
  } finally {
    syncing = false;
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(syncTimer);
  if (child && child.exitCode === null) child.kill(signal);
}

function main() {
  const rawAbbr = String(process.env.BOT_ABBR || '').trim().toUpperCase();
  const bot = BOT_MAP[rawAbbr];
  if (!bot) {
    console.error('[BOT-SYNC] BOT_ABBR fehlt oder ist ungültig. Setze BWW, VC oder TTV.');
    process.exit(1);
  }

  try {
    syncRepository('SYNC:' + bot.label);
    startBot(bot);
  } catch (error) {
    console.error('[SYNC:' + bot.label + '] Initialer Sync fehlgeschlagen: ' + error.message);
    if (process.env.SYNC_REQUIRED === 'true') process.exit(1);
    console.warn('[BOT-SYNC] Starte den zuletzt vorhandenen lokalen Stand.');
    startBot(bot);
  }

  const syncTimer = setInterval(() => scanAndSync(bot), intervalMs);
  console.log('[AUTO-SYNC:' + bot.label + '] Automatische GitHub-Prüfung alle 60 Sekunden aktiviert.');
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
