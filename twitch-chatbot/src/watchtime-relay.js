const apiUrl = (process.env.WATCHTIME_API_URL || "").trim().replace(/\/$/, "");
const botSecret = (process.env.GIVEAWAY_BOT_SECRET || "").trim();
let lastErrorAt = 0;

function request(path, options = {}) {
  if (!apiUrl || !botSecret) return Promise.resolve(null);
  return fetch(`${apiUrl}${path}`, { ...options, headers: { "content-type": "application/json", authorization: `Bearer ${botSecret}`, ...(options.headers || {}) } })
    .then(async (response) => { if (!response.ok) throw new Error(`Watchtime-API HTTP ${response.status}`); return response.json(); })
    .catch((error) => { if (Date.now() - lastErrorAt > 10000) { console.error("Watchtime-API nicht erreichbar:", error.message); lastErrorAt = Date.now(); } return null; });
}

function get(userId, username) { return request(`?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username || "")}`); }
function addMany(users) { return request("", { method: "POST", body: JSON.stringify({ action: "addMany", users }) }); }

module.exports = { get, addMany };
