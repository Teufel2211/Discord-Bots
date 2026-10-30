const API_URL = "https://api.twitch.tv/helix";

function debug(message, details = {}) {
  if (String(process.env.DEBUG_TIMER || "").toLowerCase() === "true") console.log(`[TIMER DEBUG] ${message}`, details);
}

async function validateToken() {
  const accessToken = token();
  if (!accessToken) return;
  const response = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${accessToken}` } });
  const data = await response.json().catch(() => ({}));
  debug("OAuth-Token validiert", { status: response.status, tokenClientId: data.client_id || null, configuredClientId: String(process.env.TWITCH_CLIENT_ID || "").trim() || null, tokenLogin: data.login || null, tokenUserId: data.user_id || null, matchesConfiguredClient: Boolean(data.client_id && data.client_id === String(process.env.TWITCH_CLIENT_ID || "").trim()) });
}

function token() {
  return String(process.env.TWITCH_OAUTH || "").trim().replace(/^oauth:/i, "");
}

async function twitchRequest(path, options = {}) {
  const clientId = String(process.env.TWITCH_CLIENT_ID || "").trim();
  const accessToken = token();
  debug("API-Anfrage vorbereitet", { path, method: options.method || "GET", clientIdPresent: Boolean(clientId), clientIdLength: clientId.length, oauthPresent: Boolean(accessToken), oauthLength: accessToken.length });
  if (!clientId || !accessToken) throw new Error("TWITCH_CLIENT_ID oder TWITCH_OAUTH fehlt");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Client-Id": clientId, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  debug("API-Antwort erhalten", { path, status: response.status, ok: response.ok, message: data?.message || null });
  if (!response.ok) throw new Error(data?.message || `Twitch API HTTP ${response.status}`);
  return data;
}

async function resolveUserId(login) {
  debug("Twitch-Bot-ID wird über Login gesucht", { login });
  const data = await twitchRequest(`/users?login=${encodeURIComponent(login)}`);
  const user = data?.data?.[0];
  if (!user?.id) throw new Error(`Twitch-Konto nicht gefunden: ${login}`);
  return user.id;
}

async function sendPinnedMessage(message, durationSeconds) {
  const broadcasterId = String(process.env.TWITCH_BROADCASTER_ID || "").trim();
  debug("Pin wird vorbereitet", { broadcasterIdPresent: Boolean(broadcasterId), broadcasterIdLength: broadcasterId.length, botUserIdConfigured: Boolean(process.env.TWITCH_BOT_USER_ID), moderatorIdConfigured: Boolean(process.env.TWITCH_MODERATOR_ID), durationSeconds, messageLength: String(message || "").length });
  if (!broadcasterId) throw new Error("TWITCH_BROADCASTER_ID fehlt");
  if (String(process.env.DEBUG_TIMER || "").toLowerCase() === "true") {
    try { await validateToken(); } catch (error) { debug("OAuth-Validierung fehlgeschlagen", { message: error.message }); }
  }
  const senderId = String(process.env.TWITCH_BOT_USER_ID || await resolveUserId(process.env.BOT_USERNAME)).trim();
  const data = await twitchRequest("/chat/messages", {
    method: "POST",
    body: JSON.stringify({ broadcaster_id: broadcasterId, sender_id: senderId, message, pin: true })
  });
  const messageId = data?.data?.[0]?.message_id;
  debug("Chat-Nachricht gesendet", { messageIdPresent: Boolean(messageId), isSent: data?.data?.[0]?.is_sent ?? null });
  if (!messageId) throw new Error("Twitch hat keine Message-ID zurückgegeben");
  const pinQuery = `broadcaster_id=${encodeURIComponent(broadcasterId)}&moderator_id=${encodeURIComponent(senderId)}&message_id=${encodeURIComponent(messageId)}`;
  const durationQuery = durationSeconds <= 1800 ? `&duration_seconds=${durationSeconds}` : "";
  await twitchRequest(`/chat/pins?${pinQuery}${durationQuery}`, { method: "PATCH" });
  return messageId;
}

async function unpinMessage(messageId) {
  if (!messageId) return;
  debug("Pin wird entfernt", { messageIdPresent: true });
  const broadcasterId = String(process.env.TWITCH_BROADCASTER_ID || "").trim();
  const moderatorId = String(process.env.TWITCH_MODERATOR_ID || process.env.TWITCH_BOT_USER_ID || await resolveUserId(process.env.BOT_USERNAME)).trim();
  if (!broadcasterId || !moderatorId) return;
  await twitchRequest(`/chat/pins?broadcaster_id=${encodeURIComponent(broadcasterId)}&moderator_id=${encodeURIComponent(moderatorId)}&message_id=${encodeURIComponent(messageId)}`, { method: "DELETE" });
}

async function deleteChatMessage(messageId) {
  if (!messageId) return;
  const broadcasterId = String(process.env.TWITCH_BROADCASTER_ID || "").trim();
  const moderatorId = String(process.env.TWITCH_MODERATOR_ID || process.env.TWITCH_BOT_USER_ID || await resolveUserId(process.env.BOT_USERNAME)).trim();
  if (!broadcasterId || !moderatorId) throw new Error("TWITCH_BROADCASTER_ID oder TWITCH_MODERATOR_ID fehlt");
  debug("Timer-Nachricht wird gelöscht", { messageIdPresent: true });
  await twitchRequest(`/moderation/chat?broadcaster_id=${encodeURIComponent(broadcasterId)}&moderator_id=${encodeURIComponent(moderatorId)}&message_id=${encodeURIComponent(messageId)}`, { method: "DELETE" });
}

module.exports = { sendPinnedMessage, unpinMessage, deleteChatMessage };
