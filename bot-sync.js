const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const REPO_URL = 'https://github.com/Teufel2211/Discord-Bots.git';
const GIT_BRANCH = process.env.GITHUB_BRANCH || 'master';
const BOT_MAP = Object.freeze({
  BWW: { label: 'BWW', entry: 'bww/src/index.js' },
  VC: { label: 'VC', entry: 'current/index.js' },
  TTV: { label: 'TTV', entry: 'twitch-chatbot/src/index.js' }
});

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    stdio: options.quiet ? 'ignore' : 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} wurde mit Code ${result.status} beendet.`);
}

function syncRepository(botAbbr) {
  const isRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true
  }).status === 0;

  if (!isRepo) {
    console.log(`[SYNC:${botAbbr}] Git-Repository initialisieren …`);
    runGit(['init', '-b', GIT_BRANCH]);
  }

  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true
  });
  if (remote.status === 0) runGit(['remote', 'set-url', 'origin', REPO_URL]);
  else runGit(['remote', 'add', 'origin', REPO_URL]);

  console.log(`[SYNC:${botAbbr}] Hole GitHub-Stand (Branch ${GIT_BRANCH}) …`);
  runGit(['fetch', '--prune', 'origin', GIT_BRANCH]);
  runGit(['checkout', '-f', '-B', GIT_BRANCH, `origin/${GIT_BRANCH}`]);
  runGit(['reset', '--hard', `origin/${GIT_BRANCH}`]);
  console.log(`[SYNC:${botAbbr}] GitHub-Sync erfolgreich.`);
}

function main() {
  const rawAbbr = String(process.env.BOT_ABBR || '').trim().toUpperCase();
  const bot = BOT_MAP[rawAbbr];
  if (!bot) {
    console.error('[BOT-SYNC] BOT_ABBR fehlt oder ist ungültig.');
    console.error('[BOT-SYNC] Setze in KataBump pro Server genau einen Wert: BWW, VC oder TTV.');
    process.exit(1);
  }

  const entryPath = path.join(ROOT, bot.entry);
  if (!fs.existsSync(entryPath)) {
    console.error(`[SYNC:${bot.label}] Startdatei fehlt nach dem Sync: ${bot.entry}`);
    process.exit(1);
  }

  try {
    syncRepository(bot.label);
  } catch (error) {
    console.error(`[SYNC:${bot.label}] GitHub-Sync fehlgeschlagen: ${error.message}`);
    if (process.env.SYNC_REQUIRED === 'true') {
      console.error('[BOT-SYNC] SYNC_REQUIRED=true – Bot wird aus Sicherheitsgründen nicht gestartet.');
      process.exit(1);
    }
    console.warn('[BOT-SYNC] Starte den zuletzt vorhandenen lokalen Stand.');
  }

  console.log(`[SYNC:${bot.label}] Starte ${bot.entry} …`);
  const child = spawn(process.execPath, [entryPath], {
    cwd: ROOT,
    env: { ...process.env, BOT_ABBR: bot.label },
    stdio: 'inherit',
    windowsHide: true
  });

  child.on('error', error => {
    console.error(`[SYNC:${bot.label}] Bot konnte nicht gestartet werden: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    console.log(`[SYNC:${bot.label}] Bot beendet (Code ${code}, Signal ${signal || 'none'}).`);
    process.exitCode = code ?? (signal ? 1 : 0);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }
}

main();
