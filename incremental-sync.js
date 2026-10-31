const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = __dirname;
const REPO_URL = 'https://github.com/Teufel2211/Discord-Bots.git';
const GIT_BRANCH = process.env.GITHUB_BRANCH || 'master';

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || 'pipe',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = result.stderr ? String(result.stderr).trim() : '';
    throw new Error('git ' + args.join(' ') + ' fehlgeschlagen (Code ' + result.status + ')' + (details ? ': ' + details : ''));
  }
  return result.stdout;
}

function isProtectedPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.includes('.git') || parts.includes('node_modules')) return true;
  const name = parts[parts.length - 1];
  if (name === '.env') return true;
  if (name.startsWith('.env.') && name !== '.env.example' && name !== '.env.sample') return true;
  return false;
}

function syncRepository(label = 'SYNC') {
  const isRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true
  }).status === 0;

  if (!isRepo) {
    console.log('[' + label + '] Git-Repository initialisieren …');
    git(['init', '-b', GIT_BRANCH]);
  }

  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true
  });
  if (remote.status === 0) git(['remote', 'set-url', 'origin', REPO_URL]);
  else git(['remote', 'add', 'origin', REPO_URL]);

  console.log('[' + label + '] Prüfe GitHub-Branch ' + GIT_BRANCH + ' …');
  git(['fetch', '--prune', 'origin', GIT_BRANCH]);
  const remoteRef = 'origin/' + GIT_BRANCH;
  const hasHead = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true
  }).status === 0;

  if (!hasHead) {
    console.log('[' + label + '] Erster Sync – lade Repository-Dateien …');
    git(['checkout', '-f', '-B', GIT_BRANCH, remoteRef]);
    git(['reset', '--hard', remoteRef]);
    console.log('[' + label + '] Initialer GitHub-Sync abgeschlossen.');
    return { changedPaths: [], initial: true };
  }

  const raw = git(['diff', '--name-only', '-z', '--no-renames', 'HEAD', remoteRef], { encoding: 'buffer' });
  const allPaths = raw.toString('utf8').split('\0').filter(Boolean);
  const changedPaths = allPaths.filter(file => !isProtectedPath(file));

  if (changedPaths.length === 0) {
    // HEAD trotzdem nachziehen, damit ignorierte lokale .env-Dateien nicht bei jedem Scan erneut auftauchen.
    git(['reset', '--mixed', remoteRef]);
    return { changedPaths: [], initial: false };
  }

  console.log('[' + label + '] ' + changedPaths.length + ' geänderte Datei(en) gefunden.');
  for (const relativePath of changedPaths) {
    const existsInRemote = spawnSync('git', ['cat-file', '-e', remoteRef + ':' + relativePath], {
      cwd: ROOT, stdio: 'ignore', windowsHide: true
    }).status === 0;

    if (existsInRemote) {
      const directory = path.dirname(path.join(ROOT, relativePath));
      require('node:fs').mkdirSync(directory, { recursive: true });
      git(['checkout', '-f', remoteRef, '--', relativePath]);
      console.log('[' + label + '] Aktualisiert/neu: ' + relativePath);
    } else {
      git(['rm', '-f', '--', relativePath]);
      console.log('[' + label + '] Gelöscht: ' + relativePath);
    }
  }

  // Verschiebt HEAD und Index auf den neuen Commit, ohne weitere Arbeitsdateien anzufassen.
  git(['reset', '--mixed', remoteRef]);
  console.log('[' + label + '] Inkrementeller Sync abgeschlossen.');
  return { changedPaths, initial: false };
}

function affectedBots(changedPaths) {
  const result = new Set();
  for (const file of changedPaths) {
    const normalized = file.replace(/\\/g, '/');
    const name = normalized.split('/').pop();
    if (/\.(md|txt|zip)$/i.test(name) || name === '.env.example' || name === '.env.sample') continue;
    if (normalized.startsWith('bww/')) result.add('BWW');
    else if (normalized.startsWith('current/')) result.add('VC');
    else if (normalized.startsWith('twitch-chatbot/')) result.add('TTV');
    else if (normalized === 'package.json' || normalized === 'package-lock.json') {
      result.add('BWW'); result.add('VC'); result.add('TTV');
    }
  }
  return [...result];
}

function dependenciesChanged(changedPaths) {
  return changedPaths.some(file => /(^|\/)package(-lock)?\.json$/i.test(file));
}

function supervisorChanged(changedPaths) {
  return changedPaths.some(file => ['start-all.js', 'bot-sync.js', 'incremental-sync.js'].includes(file));
}

module.exports = {
  syncRepository,
  affectedBots,
  dependenciesChanged,
  supervisorChanged,
  intervalMs: 60_000
};
