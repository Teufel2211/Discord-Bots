const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  syncRepository,
  affectedBots,
  dependenciesChanged,
  supervisorChanged,
  intervalMs
} = require('./incremental-sync');

const ROOT = __dirname;
const bots = [
  { name: 'VC', entry: 'current/index.js' },
  { name: 'BWW', entry: 'bww/src/index.js' },
  { name: 'TTV', entry: 'twitch-chatbot/src/index.js' }
];

const children = new Map();
const restarting = new Set();
let syncing = false;
let shuttingDown = false;

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: ROOT, stdio: 'inherit', windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(label + ' fehlgeschlagen (Exit-Code ' + result.status + ').');
}

function installDependencies() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('[START-ALL] Installiere geänderte Abhängigkeiten …');
  run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], 'npm install');
}

function startBot(name, entry) {
  if (shuttingDown) return;
  const entryPath = path.join(ROOT, entry);
  const child = spawn(process.execPath, [entryPath], {
    cwd: ROOT,
    env: { ...process.env, BOT_ABBR: name },
    stdio: 'inherit',
    windowsHide: true
  });

  children.set(name, child);
  child.on('error', error => {
    console.error('[START-ALL] ' + name + ' konnte nicht gestartet werden: ' + error.message);
  });
  child.on('exit', (code, signal) => {
    console.log('[START-ALL] Bot ' + name + ' beendet (Code=' + code + ', Signal=' + (signal || 'none') + ')');
    if (children.get(name) === child) children.delete(name);
    if (restarting.has(name)) {
      restarting.delete(name);
      startBot(name, entry);
    }
  });
}

function restartBot(name) {
  const config = bots.find(bot => bot.name === name);
  if (!config || shuttingDown) return;
  const child = children.get(name);
  if (!child || child.exitCode !== null) {
    startBot(config.name, config.entry);
    return;
  }
  if (restarting.has(name)) return;
  console.log('[START-ALL] Starte ' + name + ' wegen geänderter Dateien neu …');
  restarting.add(name);
  child.kill('SIGTERM');
  const forceKill = setTimeout(() => {
    if (restarting.has(name) && child.exitCode === null) child.kill('SIGKILL');
  }, 10_000);
  forceKill.unref();
}

function scanAndSync() {
  if (syncing || shuttingDown) return;
  syncing = true;
  try {
    const result = syncRepository('AUTO-SYNC');
    if (result.changedPaths.length === 0) {
      console.log('[AUTO-SYNC] Keine Änderungen gefunden.');
      return;
    }

    if (dependenciesChanged(result.changedPaths)) installDependencies();

    const targets = affectedBots(result.changedPaths);
    for (const name of targets) restartBot(name);

    if (supervisorChanged(result.changedPaths)) {
      console.warn('[AUTO-SYNC] Die Start-/Sync-Steuerdatei wurde aktualisiert. Ein einmaliger KataBump-Neustart ist nötig, damit der neue Supervisor-Code geladen wird.');
    }
    if (targets.length === 0) console.log('[AUTO-SYNC] Änderungen benötigen keinen Bot-Neustart.');
  } catch (error) {
    console.error('[AUTO-SYNC] Synchronisierung fehlgeschlagen: ' + error.message);
  } finally {
    syncing = false;
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(syncTimer);
  for (const child of children.values()) {
    if (child.exitCode === null) child.kill(signal);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  syncRepository('START-ALL');
  installDependencies();
} catch (error) {
  console.error('[START-ALL] Start abgebrochen: ' + error.message);
  process.exit(1);
}

console.log('[START-ALL] Starte alle Bots: ' + bots.map(bot => bot.name).join(', '));
for (const bot of bots) startBot(bot.name, bot.entry);

const syncTimer = setInterval(scanAndSync, intervalMs);
console.log('[AUTO-SYNC] Automatische GitHub-Prüfung alle 60 Sekunden aktiviert.');
