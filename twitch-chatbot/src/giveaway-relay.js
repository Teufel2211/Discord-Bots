const apiUrl = (process.env.GIVEAWAY_API_URL || "").trim().replace(/\/$/, "");
const botSecret = (process.env.GIVEAWAY_BOT_SECRET || "").trim();
let lastErrorAt = 0;

function request(path, options = {}) {
  if (!apiUrl || !botSecret) return Promise.resolve(null);
  return fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", authorization: `Bearer ${botSecret}`, ...(options.headers || {}) }
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Giveaway-API HTTP ${response.status}`);
    return response.json();
  }).catch((error) => {
    const now = Date.now();
    if (now - lastErrorAt > 10_000) { console.error("Giveaway-API nicht erreichbar:", error.message); lastErrorAt = now; }
    return null;
  });
}

function sync(state) { return request("", { method: "POST", body: JSON.stringify({ action: "sync", state }) }); }
function poll(after) { return request(`?mode=bot&after=${encodeURIComponent(after)}`); }
function state() { return request("?mode=botstate"); }

module.exports = { poll, state, sync };
