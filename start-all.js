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
  { name: 'TTV', entry: 'twitch-chatbot/src/index.js' },
  { name: 'SC', entry: 'servercore/start.js' }
];

const children = new Map();
const restarting = new Set();
const restartAttempts = new Map();
const restartTimers = new Map();
const startupTimers = new Set();
const START_STAGGER_MS = Math.max(0, Number(process.env.BOT_START_STAGGER_MS) || 2500);
let syncing = false;
let shuttingDown = false;

function clearScheduledRestart(name) {
  const timer = restartTimers.get(name);
  if (timer) clearTimeout(timer);
  restartTimers.delete(name);
}

function scheduleCrashRestart(name, entry, code, signal) {
  if (shuttingDown || restartTimers.has(name)) return;
  const attempts = (restartAttempts.get(name) || 0) + 1;
  restartAttempts.set(name, attempts);
  const delay = Math.min(60_000, 3_000 * (2 ** Math.min(attempts - 1, 4)));
  console.error(
    '[START-ALL] ' + name + ' wurde unerwartet beendet (Code=' + code +
    ', Signal=' + (signal || 'none') + '). Neustart in ' +
    Math.ceil(delay / 1000) + ' Sekunden (Versuch ' + attempts + ').'
  );
  const timer = setTimeout(() => {
    restartTimers.delete(name);
    startBot(name, entry);
  }, delay);
  timer.unref();
  restartTimers.set(name, timer);
}

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
  const existing = children.get(name);
  if (existing && existing.exitCode === null) return;
  clearScheduledRestart(name);

  const entryPath = path.join(ROOT, entry);
  const child = spawn(process.execPath, [entryPath], {
    cwd: ROOT,
    env: { ...process.env, BOT_ABBR: name },
    stdio: 'inherit',
    windowsHide: true
  });

  children.set(name, child);
  const stableTimer = setTimeout(() => restartAttempts.delete(name), 5 * 60_000);
  stableTimer.unref();

  child.on('error', error => {
    console.error('[START-ALL] ' + name + ' konnte nicht gestartet werden: ' + error.message);
  });
  child.on('exit', (code, signal) => {
    clearTimeout(stableTimer);
    console.log('[START-ALL] Bot ' + name + ' beendet (Code=' + code + ', Signal=' + (signal || 'none') + ')');
    if (children.get(name) === child) children.delete(name);

    if (restarting.has(name)) {
      restarting.delete(name);
      restartAttempts.delete(name);
      startBot(name, entry);
      return;
    }

    if (!shuttingDown) scheduleCrashRestart(name, entry, code, signal);
  });
}

function restartBot(name) {
  const config = bots.find(bot => bot.name === name);
  if (!config || shuttingDown) return;
  clearScheduledRestart(name);
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
  for (const timer of startupTimers) clearTimeout(timer);
  startupTimers.clear();
  for (const name of restartTimers.keys()) clearScheduledRestart(name);
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

console.log('[START-ALL] Starte alle Bots gestaffelt: ' + bots.map(bot => bot.name).join(', '));
bots.forEach((bot, index) => {
  const timer = setTimeout(() => {
    startupTimers.delete(timer);
    startBot(bot.name, bot.entry);
  }, index * START_STAGGER_MS);
  startupTimers.add(timer);
});

const syncTimer = setInterval(scanAndSync, intervalMs);
console.log('[AUTO-SYNC] Automatische GitHub-Prüfung alle 60 Sekunden aktiviert.');
