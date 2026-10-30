const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const MAX_MINUTES = 120;
const STATE_ID = 1;
const DEFAULT_JOIN_WORD = "giveaway";
const ADMIN_COOKIE = "gw_admin";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const RESERVED_WORDS = new Set(["giveawaystart", "hilfe", "help", "discord", "dc", "socials", "würfel", "timer", "latenz", "wt", "watchtime"]);
const ROLE_ORDER = ["broadcaster", "moderator", "vip", "subscriber", "follower", "viewer"];
const DEFAULT_ROLE_SETTINGS = { broadcaster: { enabled: true, weight: 1 }, moderator: { enabled: true, weight: 3 }, vip: { enabled: true, weight: 2 }, subscriber: { enabled: true, weight: 2 }, follower: { enabled: true, weight: 1 }, viewer: { enabled: true, weight: 1 } };

function normalizeRoleSettings(input = {}) {
  return Object.fromEntries(ROLE_ORDER.map((role) => {
    const value = input[role] || DEFAULT_ROLE_SETTINGS[role];
    return [role, { enabled: value.enabled !== false, weight: Math.max(1, Math.min(100, Number.parseInt(value.weight, 10) || 1)) }];
  }));
}

function weightedWinner(participants) {
  const total = participants.reduce((sum, entry) => sum + Math.max(1, Number(entry.weight) || 1), 0);
  let cursor = Math.random() * total;
  return participants.find((entry) => { cursor -= Math.max(1, Number(entry.weight) || 1); return cursor < 0; }) || participants.at(-1);
}

function carriedParticipants(state, roleSettings) {
  if (!state || state.status !== "ended") return [];
  const lastWinner = String(state.winner || "").trim().toLowerCase();
  return (Array.isArray(state.participantsData) ? state.participantsData : [])
    .filter((entry) => {
      const username = String(entry.username || "").trim().toLowerCase();
      const userId = String(entry.userId || "").trim().toLowerCase();
      return !lastWinner || (username !== lastWinner && userId !== lastWinner);
    })
    .map((entry) => {
      const role = ROLE_ORDER.includes(entry.role) ? entry.role : "viewer";
      const settings = roleSettings[role] || DEFAULT_ROLE_SETTINGS.viewer;
      return { ...entry, role, weight: settings.weight };
    })
    .filter((entry) => roleSettings[entry.role]?.enabled !== false);
}

function normalizeJoinWord(value) {
  const word = String(value || "").trim().replace(/^!+/, "").toLowerCase();
  if (!/^[a-z0-9äöüß_-]{2,24}$/.test(word)) return null;
  if (RESERVED_WORDS.has(word)) return null;
  return word;
}

function send(response, status, body, headers = {}) {
  response.status(status).setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("access-control-allow-origin", "*");
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

function secretFrom(request) { return (request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); }

function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function sessionToken(secret) {
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  const signature = crypto.createHmac("sha256", secret).update(`v1:${expiresAt}`).digest("hex");
  return `v1.${expiresAt}.${signature}`;
}

function validSession(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = crypto.createHmac("sha256", secret).update(`v1:${expiresAt}`).digest("hex");
  const given = Buffer.from(parts[2], "hex");
  const wanted = Buffer.from(expected, "hex");
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

function adminAuthorized(request) {
  const secret = process.env.GIVEAWAY_ADMIN_SECRET;
  if (!secret) return false;
  if (secretFrom(request) === secret) return true;
  return validSession(parseCookies(request)[ADMIN_COOKIE], secret);
}

function adminCookie(request, value, maxAge) {
  const secure = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() === "https";
  return `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
function database() {
  const url = String(process.env.GIVEAWAY_SUPABASE_URL || "").trim();
  const key = String(process.env.GIVEAWAY_SUPABASE_SECRET_KEY || "").trim();
  if (!url || !key) throw new Error("Supabase-Umgebungsvariablen fehlen");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
function publicState(row) {
  if (!row) return { status: "idle", participants: 0, joinWord: DEFAULT_JOIN_WORD };
  return { status: row.status, prize: row.prize || "", endsAt: row.ends_at ? new Date(row.ends_at).getTime() : null, participants: Number(row.participants || 0), winner: row.winner || null, joinWord: row.join_word || DEFAULT_JOIN_WORD, roleSettings: normalizeRoleSettings(row.role_settings), persistentMode: Boolean(row.persistent_mode), updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now() };
}
async function readState(supabase) {
  const { data, error } = await supabase.from("tw_giveaway_state").select("*").eq("id", STATE_ID).maybeSingle();
  if (error) throw error;
  return publicState(data);
}
async function readAdminState(supabase) {
  const { data, error } = await supabase.from("tw_giveaway_state").select("*").eq("id", STATE_ID).maybeSingle();
  if (error) throw error;
  return { ...publicState(data), participantsData: Array.isArray(data?.participants_data) ? data.participants_data : [] };
}
async function writeState(supabase, state) {
  const { error } = await supabase.from("tw_giveaway_state").upsert({ id: STATE_ID, status: state.status || "idle", prize: state.prize || null, ends_at: state.endsAt ? new Date(state.endsAt).toISOString() : null, participants: Number(state.participants || 0), participants_data: Array.isArray(state.participantsData) ? state.participantsData : [], winner: state.winner || null, join_word: state.joinWord || DEFAULT_JOIN_WORD, role_settings: normalizeRoleSettings(state.roleSettings), persistent_mode: Boolean(state.persistentMode), updated_at: new Date(state.updatedAt || Date.now()).toISOString() });
  if (error) throw error;
}
async function addCommand(supabase, command) {
  const { error } = await supabase.from("tw_giveaway_commands").insert({ id: command.id, command_type: command.type, minutes: command.minutes || null, prize: command.prize || null, winner: command.winner || null, join_word: command.joinWord || null, role_settings: command.roleSettings ? normalizeRoleSettings(command.roleSettings) : null, participants_data: Array.isArray(command.participantsData) ? command.participantsData : null, persistent_mode: command.persistentMode == null ? null : Boolean(command.persistentMode), created_at: new Date(command.createdAt).toISOString() });
  if (error) throw error;
}

module.exports = async function handler(request, response) {
  if (request.method === "OPTIONS") return send(response, 204, {});
  try {
    const supabase = database();
    const mode = request.query?.mode || "public";
    if (request.method === "GET" && mode === "bot") {
      if (secretFrom(request) !== process.env.GIVEAWAY_BOT_SECRET) return send(response, 401, { error: "Nicht autorisiert" });
      const after = Number(request.query?.after || 0);
      const afterIso = new Date(Number.isFinite(after) && after > 0 ? after : 0).toISOString();
      const { data, error } = await supabase.from("tw_giveaway_commands").select("id, command_type, minutes, prize, winner, join_word, role_settings, participants_data, persistent_mode, created_at").gt("created_at", afterIso).order("created_at", { ascending: true }).limit(50);
      if (error) throw error;
      const commands = (data || []).map((command) => ({ id: command.id, type: command.command_type, minutes: command.minutes, prize: command.prize, winner: command.winner, joinWord: command.join_word || null, roleSettings: normalizeRoleSettings(command.role_settings), participantsData: Array.isArray(command.participants_data) ? command.participants_data : [], persistentMode: Boolean(command.persistent_mode), createdAt: new Date(command.created_at).getTime() }));
      return send(response, 200, { commands });
    }
    if (request.method === "GET" && mode === "botstate") {
      if (secretFrom(request) !== process.env.GIVEAWAY_BOT_SECRET) return send(response, 401, { error: "Nicht autorisiert" });
      return send(response, 200, await readAdminState(supabase));
    }
    if (request.method === "GET" && mode === "session") {
      return send(response, 200, { authenticated: adminAuthorized(request) });
    }
    if (request.method === "GET" && mode === "admin") {
      if (!adminAuthorized(request)) return send(response, 401, { error: "Admin-Passwort falsch" });
      return send(response, 200, await readAdminState(supabase));
    }
    if (request.method === "GET") return send(response, 200, await readState(supabase));
    if (request.method !== "POST") { response.setHeader("allow", "GET, POST, OPTIONS"); return send(response, 405, { error: "Methode nicht erlaubt" }); }

    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    if (body.action === "check") {
      if (!adminAuthorized(request)) return send(response, 401, { error: "Admin-Passwort falsch" });
      const token = sessionToken(process.env.GIVEAWAY_ADMIN_SECRET);
      return send(response, 200, { authenticated: true }, { "set-cookie": adminCookie(request, token, SESSION_SECONDS) });
    }
    if (body.action === "logout") {
      return send(response, 200, { authenticated: false }, { "set-cookie": adminCookie(request, "", 0) });
    }
    if (body.action === "sync") {
      if (secretFrom(request) !== process.env.GIVEAWAY_BOT_SECRET) return send(response, 401, { error: "Nicht autorisiert" });
      let joinWord = normalizeJoinWord(body.state?.joinWord);
      if (!joinWord) {
        const currentState = await readAdminState(supabase);
        joinWord = currentState.joinWord;
      }
      await writeState(supabase, { ...(body.state || {}), joinWord });
      return send(response, 202, { accepted: true });
    }

    if (!adminAuthorized(request)) return send(response, 401, { error: "Admin-Passwort falsch" });
    const current = await readState(supabase);
    if (body.action === "keyword") {
      const joinWord = normalizeJoinWord(body.joinWord);
      if (!joinWord) return send(response, 400, { error: "Ungültiges Teilnahme-Wort: 2–24 Zeichen, keine Leerzeichen" });
      const currentState = await readAdminState(supabase);
      const updatedAt = Date.now();
      await writeState(supabase, { ...currentState, joinWord, updatedAt });
      await addCommand(supabase, { id: `${updatedAt}-${Math.random()}`, type: "keyword", joinWord, createdAt: updatedAt });
      return send(response, 202, { accepted: true, joinWord });
    }
    if (body.action === "start") {
      if (current.status === "active") return send(response, 409, { error: "Es läuft bereits ein Giveaway" });
      const prize = String(body.prize || "").trim().slice(0, 200);
      const currentAdmin = await readAdminState(supabase);
      const joinWord = currentAdmin.joinWord || DEFAULT_JOIN_WORD;
      const roleSettings = normalizeRoleSettings(body.roleSettings);
      const persistentMode = Boolean(body.persistentMode);
      const minutesRaw = Number.parseInt(body.minutes, 10);
      const minutes = persistentMode ? null : Math.min(MAX_MINUTES, Math.max(1, minutesRaw));
      if (!persistentMode && (!Number.isFinite(minutesRaw) || !prize)) return send(response, 400, { error: "Minuten und Preis sind erforderlich" });
      const participantsData = persistentMode ? carriedParticipants(currentAdmin, roleSettings) : [];
      const createdAt = Date.now();
      await addCommand(supabase, { id: `${createdAt}-${Math.random()}`, type: "start", minutes, prize, joinWord, roleSettings, participantsData, persistentMode, createdAt });
      await writeState(supabase, { status: "active", prize, endsAt: minutes ? createdAt + minutes * 60_000 : null, participants: participantsData.length, participantsData, joinWord, roleSettings, persistentMode, updatedAt: createdAt });
      return send(response, 202, { accepted: true, joinWord, participants: participantsData.length, persistentMode });
    }
    if (body.action === "end") {
      if (current.status !== "active") return send(response, 409, { error: "Kein aktives Giveaway" });
      await addCommand(supabase, { id: `${Date.now()}-${Math.random()}`, type: "end", createdAt: Date.now() });
      return send(response, 202, { accepted: true });
    }
    if (body.action === "reroll") {
      if (current.status !== "ended") return send(response, 409, { error: "Reroll ist erst nach einem beendeten Giveaway möglich" });
      const { data: row, error } = await supabase.from("tw_giveaway_state").select("*").eq("id", STATE_ID).single();
      if (error) throw error;
      const participants = Array.isArray(row.participants_data) ? row.participants_data : [];
      if (!participants.length) return send(response, 409, { error: "Es gibt keine Teilnehmer für einen Reroll" });
      const winner = weightedWinner(participants);
      const updatedAt = Date.now();
      await writeState(supabase, { ...publicState(row), status: "ended", winner: winner.username, participantsData: participants, updatedAt });
      await addCommand(supabase, { id: `${updatedAt}-${Math.random()}`, type: "reroll", prize: row.prize, winner: winner.username, createdAt: updatedAt });
      return send(response, 202, { accepted: true, winner: winner.username });
    }
    return send(response, 400, { error: "Unbekannte Aktion" });
  } catch (error) {
    console.error("Giveaway-API-Fehler:", error);
    return send(response, 500, { error: "Interner Giveaway-Fehler" });
  }
};
