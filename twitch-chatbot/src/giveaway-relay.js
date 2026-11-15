const { createClient } = require("@supabase/supabase-js");

const apiUrl = (process.env.GIVEAWAY_API_URL || "").trim().replace(/\/$/, "");
const botSecret = (process.env.GIVEAWAY_BOT_SECRET || "").trim();

// Realtime only exposes a public signal row. Actual giveaway commands are
// still fetched from the Vercel API using GIVEAWAY_BOT_SECRET.
const realtimeUrl = (process.env.GIVEAWAY_SUPABASE_URL || "https://hfreshlzwukfaeyveddv.supabase.co").trim().replace(/\/$/, "");
const realtimeKey = (
  process.env.GIVEAWAY_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_mMNhPZgSP6GSFKWiyrRbgg_FF8Lhc4m"
).trim();
let lastErrorAt = 0;

function request(path, options = {}) {
  if (!apiUrl || !botSecret) return Promise.resolve(null);
  return fetch(apiUrl + path, {
    ...options,
    headers: { "content-type": "application/json", authorization: "Bearer " + botSecret, ...(options.headers || {}) }
  }).then(async (response) => {
    if (!response.ok) throw new Error("Giveaway-API HTTP " + response.status);
    return response.json();
  }).catch((error) => {
    const now = Date.now();
    if (now - lastErrorAt > 10_000) {
      console.error("Giveaway-API nicht erreichbar:", error.message);
      lastErrorAt = now;
    }
    return null;
  });
}

function subscribeToCommands(onInsert = () => {}, onStatus = () => {}) {
  const supabase = createClient(realtimeUrl, realtimeKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    realtime: { params: { eventsPerSecond: 10 } }
  });

  const channel = supabase
    .channel("twitch-giveaway-signal-listener")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "tw_giveaway_signals" },
      (payload) => {
        try {
          onInsert(payload);
        } catch (error) {
          console.error("Giveaway-Realtime-Handler fehlgeschlagen:", error.message);
        }
      }
    )
    .subscribe((status, error) => {
      try {
        onStatus(status, error);
      } catch (callbackError) {
        console.error("Giveaway-Realtime-Statushandler fehlgeschlagen:", callbackError.message);
      }
    });

  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    await supabase.removeChannel(channel);
  };
}

function sync(state) {
  return request("", { method: "POST", body: JSON.stringify({ action: "sync", state }) });
}

function poll(after) {
  return request("?mode=bot&after=" + encodeURIComponent(after));
}

function state() {
  return request("?mode=botstate");
}

module.exports = { poll, state, sync, subscribeToCommands };
