const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = __dirname;
const REPO_URL = 'https://github.com/Teufel2211/Discord-Bots.git';
const GIT_BRANCH = process.env.GITHUB_BRANCH || 'master';
const bots = [
  { name: 'VC', entry: 'current/index.js' },
  { name: 'BWW', entry: 'bww/src/index.js' },
  { name: 'TTV', entry: 'twitch-chatbot/src/index.js' }
];

const children = new Map();

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} fehlgeschlagen (Exit-Code ${result.status}).`);
  }
}

function runGit(args) {
  run('git', args, `git ${args.join(' ')}`);
}

function syncRepository() {
  const isRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true
  }).status === 0;

  if (!isRepo) {
    console.log('[START-ALL] Initialisiere Git-Repository …');
    runGit(['init', '-b', GIT_BRANCH]);
  }

  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });

  if (remote.status === 0) runGit(['remote', 'set-url', 'origin', REPO_URL]);
  else runGit(['remote', 'add', 'origin', REPO_URL]);

  console.log(`[START-ALL] Synchronisiere GitHub-Branch ${GIT_BRANCH} …`);
  runGit(['fetch', '--prune', 'origin', GIT_BRANCH]);
  runGit(['checkout', '-f', '-B', GIT_BRANCH, `origin/${GIT_BRANCH}`]);
  runGit(['reset', '--hard', `origin/${GIT_BRANCH}`]);
  console.log('[START-ALL] GitHub-Sync erfolgreich.');
}

function installDependencies() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('[START-ALL] Installiere Root-Abhängigkeiten …');
  run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], 'npm install');
}

function startBot(name, entry) {
  const entryPath = path.join(ROOT, entry);
  const child = spawn(process.execPath, [entryPath], {
    cwd: ROOT,
    env: { ...process.env, BOT_ABBR: name },
    stdio: 'inherit',
    windowsHide: true
  });

  children.set(name, child);
  child.on('error', error => {
    console.error(`[START-ALL] ${name} konnte nicht gestartet werden: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    console.log(`[START-ALL] Bot ${name} beendet (Code=${code}, Signal=${signal || 'none'})`);
  });
}

function shutdown(signal) {
  for (const child of children.values()) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  syncRepository();
  installDependencies();
} catch (error) {
  console.error(`[START-ALL] Start abgebrochen: ${error.message}`);
  process.exit(1);
}

console.log(`[START-ALL] Starte alle Bots: ${bots.map(bot => bot.name).join(', ')}`);
for (const bot of bots) startBot(bot.name, bot.entry);
