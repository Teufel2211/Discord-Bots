const { createClient } = require("@supabase/supabase-js");

function send(response, status, body) {
  response.status(status).setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("access-control-allow-origin", "*");
  response.end(JSON.stringify(body));
}

function secretFrom(request) { return (request.headers.authorization || "").replace(/^Bearer\s+/i, ""); }
function database() {
  const url = String(process.env.GIVEAWAY_SUPABASE_URL || "").trim();
  const key = String(process.env.GIVEAWAY_SUPABASE_SECRET_KEY || "").trim();
  if (!url || !key) throw new Error("Supabase-Umgebungsvariablen fehlen");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
function format(row) {
  return { userId: row.user_id, username: row.username, watchSeconds: Number(row.watch_seconds || 0) };
}

module.exports = async function handler(request, response) {
  if (request.method === "OPTIONS") return send(response, 204, {});
  try {
    if (secretFrom(request) !== process.env.GIVEAWAY_BOT_SECRET) return send(response, 401, { error: "Nicht autorisiert" });
    const supabase = database();
    if (request.method === "GET") {
      const userId = String(request.query?.userId || "").trim();
      if (!userId) return send(response, 400, { error: "userId fehlt" });
      const { data, error } = await supabase.from("tw_watchtime").select("user_id, username, watch_seconds").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return send(response, 200, data ? format(data) : { userId, username: request.query?.username || userId, watchSeconds: 0 });
    }
    if (request.method !== "POST") return send(response, 405, { error: "Methode nicht erlaubt" });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    if (body.action !== "addMany" || !Array.isArray(body.users)) return send(response, 400, { error: "Ungültige Watchtime-Aktion" });
    for (const user of body.users.slice(0, 100)) {
      const userId = String(user.userId || "").trim();
      const seconds = Math.max(0, Math.min(300, Number(user.seconds || 0)));
      if (!userId || !seconds) continue;
      const { data: current, error: readError } = await supabase.from("tw_watchtime").select("watch_seconds").eq("user_id", userId).maybeSingle();
      if (readError) throw readError;
      const { error } = await supabase.from("tw_watchtime").upsert({ user_id: userId, username: String(user.username || userId).slice(0, 100), watch_seconds: Number(current?.watch_seconds || 0) + seconds, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    return send(response, 202, { accepted: true });
  } catch (error) {
    console.error("Watchtime-API-Fehler:", error);
    return send(response, 500, { error: "Interner Watchtime-Fehler" });
  }
};
