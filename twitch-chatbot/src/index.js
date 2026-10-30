const path = require("node:path");
const envPath = path.resolve(__dirname, "../.env");
const envResult = require("dotenv").config({ path: envPath });

if (envResult.error && envResult.error.code !== "ENOENT") {
  console.error("[TTV] Bot-.env konnte nicht geladen werden:", envResult.error.message);
}
console.log(`[TTV] Eigene .env: ${envResult.error ? 'nicht gefunden' : 'geladen'}`);

const tmi = require("tmi.js");
const { commands } = require("./commands");
const { createGiveawayManager, DEFAULT_ROLE_SETTINGS } = require("./giveaway");
const relay = require("./giveaway-relay");
const watchtime = require("./watchtime-relay");
const twitchApi = require("./twitch-api");

const required = ["BOT_USERNAME", "TWITCH_CHANNEL", "TWITCH_OAUTH", "GIVEAWAY_API_URL", "GIVEAWAY_BOT_SECRET", "WATCHTIME_API_URL"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Fehlende Konfiguration in .env: ${missing.join(", ")}`);
  console.error("Kopiere .env.example nach .env und trage deine Twitch-Daten ein.");
  process.exit(1);
}

const username = process.env.BOT_USERNAME.trim().toLowerCase();
const channel = process.env.TWITCH_CHANNEL.trim().replace(/^#/, "").toLowerCase();
const password = process.env.TWITCH_OAUTH.trim();

if (!password.startsWith("oauth:")) {
  console.error("TWITCH_OAUTH muss mit 'oauth:' beginnen. Prüfe deinen Zugriffstoken.");
  process.exit(1);
}

const client = new tmi.Client({
  options: { debug: false },
  connection: { reconnect: true, secure: true },
  identity: { username, password },
  channels: [channel]
});

const cooldowns = new Map();
const COMMAND_COOLDOWN_MS = 3000;
const DEFAULT_JOIN_WORD = "giveaway";
const RESERVED_WORDS = new Set(["giveawaystart", "hilfe", "help", "discord", "dc", "socials", "würfel", "timer", "latenz", "wt", "watchtime"]);
let joinWord = DEFAULT_JOIN_WORD;
let roleSettings = { ...DEFAULT_ROLE_SETTINGS };
let activeTimer = null;

function roleFromContext(context) {
  const badges = context.badges || {};
  if (badges.broadcaster === "1") return "broadcaster";
  if (badges.moderator === "1" || context.mod === true || context.mod === "1") return "moderator";
  if (badges.vip === "1") return "vip";
  if (badges.subscriber || context.subscriber === true || context.subscriber === "1") return "subscriber";
  if (badges.follower === "1") return "follower";
  return "viewer";
}

function normalizeJoinWord(value) {
  const word = String(value || "").trim().replace(/^!+/, "").toLowerCase();
  if (!/^[a-z0-9äöüß_-]{2,24}$/.test(word)) return null;
  if (RESERVED_WORDS.has(word)) return null;
  return word;
}

const giveaway = createGiveawayManager(
  (message) => client.say(channel, message),
  (state) => relay.sync({ ...state, joinWord })
);


const activeChatters = new Map();
function trackChatActivity(context) {
  const userId = context["user-id"] || context.username;
  if (!userId) return;
  activeChatters.set(String(userId), { username: context["display-name"] || context.username || userId, lastSeen: Date.now() });
}
async function creditWatchtime() {
  const users = [];
  const now = Date.now();
  for (const [userId, user] of activeChatters) {
    if (now - user.lastSeen <= 5 * 60_000) users.push({ userId, username: user.username, seconds: 60 });
    else activeChatters.delete(userId);
  }
  if (users.length) await watchtime.addMany(users);
}
setInterval(creditWatchtime, 60_000);

commands.giveawaystart = ({ context, args }) => {
  const isBroadcaster = context.username?.toLowerCase() === channel || context.badges?.broadcaster === "1";
  if (!isBroadcaster) return "";

  const minutes = Number.parseInt(args[0], 10);
  const prize = args.slice(1).join(" ").trim();
  if (!Number.isFinite(minutes) || !prize) return "Verwendung: !giveawaystart <Minuten> <Preis>";
  return giveaway.start({ minutes, prize, joinWord, roleSettings });
};

let commandCursor = Date.now();
async function restoreGiveawayState() {
  const state = await relay.state();
  if (!state) return;
  const restoredWord = normalizeJoinWord(state.joinWord);
  if (restoredWord) joinWord = restoredWord;
  if (state.roleSettings) roleSettings = state.roleSettings;
  if (state.status === "active" && giveaway.restore(state)) {
    commandCursor = Date.now();
    console.log(`[GIVEAWAY] Aktives Giveaway wiederhergestellt: ${state.prize} (Teilnahme: !${joinWord})`);
  }
}
async function pollGiveawayCommands() {
  const result = await relay.poll(commandCursor);
  for (const command of result?.commands || []) {
    commandCursor = Math.max(commandCursor, command.createdAt);
    if (command.type === "start") {
      const incomingWord = normalizeJoinWord(command.joinWord);
      if (incomingWord) joinWord = incomingWord;
      if (command.roleSettings) roleSettings = command.roleSettings;
      const response = giveaway.start({ minutes: command.minutes, prize: command.prize, joinWord, roleSettings, participantsData: command.participantsData, persistentMode: command.persistentMode });
      if (response) client.say(channel, response);
    } else if (command.type === "keyword") {
      const nextWord = normalizeJoinWord(command.joinWord);
      if (nextWord && nextWord !== joinWord) {
        joinWord = nextWord;
        console.log(`[GIVEAWAY] Teilnahme-Wort geändert: !${joinWord}`);
        if (giveaway.isActive()) client.say(channel, `📣 Teilnahme ab jetzt mit ${joinWord} (oder !${joinWord})`);
      }
    } else if (command.type === "end") {
      giveaway.finish();
    } else if (command.type === "reroll" && command.winner) {
      client.say(channel, `🎉 Reroll-Gewinner: @${command.winner}${command.prize ? ` – Preis: ${command.prize}` : ""}`);
    }
  }
  setTimeout(pollGiveawayCommands, 2000);
}
restoreGiveawayState().catch((error) => console.error("Giveaway-Status konnte nicht wiederhergestellt werden:", error.message));
pollGiveawayCommands();

client.connect().catch((error) => {
  console.error("Verbindung zu Twitch fehlgeschlagen:", error.message);
  process.exitCode = 1;
});

client.on("connected", (address, port) => {
  console.log(`Verbunden mit Twitch: ${address}:${port}`);
  console.log(`Bot-Konto: ${username} | Kanal: #${channel}`);
  console.log(`Befehle: !help, !hilfe, !discord, !dc, !socials, !würfel, !timer, !latenz, !wt, !giveawaystart, ${joinWord} / !${joinWord} (Teilnahme)`);
});

client.on("disconnected", (reason) => {
  console.warn("Twitch-Verbindung getrennt:", reason);
});

function attemptJoin(target, context, userId) {
  if (!giveaway.isActive()) return;
  const key = `${userId}:join`;
  const now = Date.now();
  if (now - (cooldowns.get(key) || 0) < COMMAND_COOLDOWN_MS) return;
  cooldowns.set(key, now);
  const response = giveaway.join({ username: context.username || "Zuschauer", userId, role: roleFromContext(context) });
  if (typeof response === "string" && response.length) client.say(target, response.slice(0, 450));
}

client.on("message", async (target, context, message, self) => {
  if (self) return;

  const trimmed = message.trim();
  trackChatActivity(context);
  if (!trimmed) return;

  const userId = context["user-id"] || context.username || "unknown";

  if (trimmed.toLowerCase() === joinWord) {
    attemptJoin(target, context, userId);
    return;
  }

  if (!trimmed.startsWith("!")) return;

  const parts = trimmed.slice(1).split(/\s+/);
  const commandName = (parts.shift() || "").toLowerCase();
  const args = parts;

  if (commandName === joinWord) {
    attemptJoin(target, context, userId);
    return;
  }

  const handler = commands[commandName];
  if (commandName === "wt" || commandName === "watchtime") {
    watchtime.get(userId, context["display-name"] || context.username || userId).then((data) => {
      const seconds = Number(data?.watchSeconds || 0);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      client.say(target, `@${context.username || userId} deine Watchtime: ${hours} Std. ${minutes} Min.`);
    });
    return;
  }
  if (commandName === "latenz") {
    const receivedAt = Number(context["tmi-sent-ts"] || 0);
    const latency = receivedAt > 0 ? Math.max(0, Date.now() - receivedAt) : null;
    const latencyText = latency == null ? "nicht verfügbar" : `${latency} ms Chat-Latenz`;
    client.say(target, `@${context.username || userId} ${latencyText}. Die echte Video-Latenz zwischen Streamer und Stream kann der Bot nicht direkt messen; bitte Twitch Video Stats verwenden.`);
    return;
  }
  if (commandName === "timer") {
    const isStaff = context.badges?.broadcaster === "1" || context.badges?.moderator === "1" || context.mod === true || context.mod === "1";
    if (!isStaff) return;
    if (args[0]?.toLowerCase() === "stop") {
      const previous = activeTimer;
      activeTimer = null;
      if (previous?.timeout) clearTimeout(previous.timeout);
      twitchApi.unpinMessage(previous?.messageId).catch((error) => console.error("Timer konnte nicht entfernt werden:", error.message));
      twitchApi.deleteChatMessage(previous?.messageId).catch((error) => console.error("Timer-Nachricht konnte nicht gelöscht werden:", error.message));
      client.say(target, previous ? "⏱️ Timer beendet und Pin entfernt." : "Aktuell läuft kein Timer.");
      return;
    }
    const minutes = Number.parseInt(args[0], 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      client.say(target, "Verwendung: !timer <1–1440 Minuten> [Text] oder !timer stop");
      return;
    }
    const text = args.slice(1).join(" ").trim().slice(0, 280) || "Timer läuft";
    const previous = activeTimer;
    if (previous?.timeout) clearTimeout(previous.timeout);
    if (previous?.messageId) {
      twitchApi.unpinMessage(previous.messageId).catch(() => {});
      twitchApi.deleteChatMessage(previous.messageId).catch(() => {});
    }
    const endsAt = Date.now() + minutes * 60_000;
    try {
      const messageId = await twitchApi.sendPinnedMessage(`⏱️ ${text} · endet um ${new Intl.DateTimeFormat("de-DE", { timeZone: process.env.TIMEZONE || "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(endsAt))}`, minutes * 60);
      const timeout = setTimeout(() => {
        if (activeTimer?.messageId !== messageId) return;
        activeTimer = null;
        twitchApi.unpinMessage(messageId).catch((error) => console.error("Timer-Pin konnte nicht entfernt werden:", error.message));
        twitchApi.deleteChatMessage(messageId).catch((error) => console.error("Timer-Nachricht konnte nicht gelöscht werden:", error.message));
        client.say(target, `⏱️ Timer beendet: ${text}`);
      }, minutes * 60_000);
      activeTimer = { messageId, timeout };
      client.say(target, `⏱️ Timer für ${minutes} Minuten wurde angepinnt.`);
    } catch (error) {
      client.say(target, `Timer konnte nicht angepinnt werden: ${error.message}`);
    }
    return;
  }
  if (!handler) return;

  const key = `${userId}:${commandName}`;
  const now = Date.now();
  const lastUsed = cooldowns.get(key) || 0;

  if (now - lastUsed < COMMAND_COOLDOWN_MS) return;
  cooldowns.set(key, now);

  try {
    const response = handler({ context, args, channel, username, joinWord });
    if (typeof response === "string" && response.length) {
      client.say(target, response.slice(0, 450));
    }
  } catch (error) {
    console.error(`Fehler bei !${commandName}:`, error);
  }
});

process.once("SIGINT", () => {
  giveaway.stop();
  client.disconnect();
  process.exit(0);
});
