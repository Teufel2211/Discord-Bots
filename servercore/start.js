const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = path.join(__dirname, 'src', 'index.ts');

if (!require('node:fs').existsSync(cli)) {
  console.error('[SC] tsx fehlt. Bitte im Repository npm install ausführen.');
  process.exit(1);
}

const child = spawn(process.execPath, [cli, entry], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true
});

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) child.kill(signal);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
child.on('error', error => {
  console.error('[SC] Startfehler:', error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal && !stopping) console.error('[SC] Prozess beendet durch', signal);
  process.exitCode = code ?? (stopping ? 0 : 1);
});
