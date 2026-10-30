const { spawn } = require('child_process');

const bots = [
  { name: 'current', entry: 'current/index.js' },
  { name: 'bww', entry: 'bww/src/index.js' },
  { name: 'twitch-chatbot', entry: 'twitch-chatbot/src/index.js' },
];

const children = new Map();

function startBot(name, entry) {
  const child = spawn(process.execPath, [entry], { cwd: process.cwd(), stdio: 'inherit' });
  children.set(name, child);
  child.on('exit', (code, signal) => {
    console.log(`[START-ALL] Bot ${name} exited (code=${code}, signal=${signal})`);
  });
}

for (const bot of bots) startBot(bot.name, bot.entry);

function shutdown(signal) {
  for (const child of children.values()) {
    try { child.kill(signal); } catch {}
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`[START-ALL] Starte alle Bots: ${bots.map((b) => b.name).join(', ')}`);
