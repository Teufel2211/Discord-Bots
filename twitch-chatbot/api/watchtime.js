const BACKEND_ORIGIN = String(process.env.GIVEAWAY_BACKEND_URL || "https://bww-nu.vercel.app").replace(/\/$/, "");

module.exports = async function handler(request, response) {
  try {
    const target = new URL(request.url || "/api/watchtime", BACKEND_ORIGIN);
    target.pathname = "/api/watchtime";

    const headers = {};
    for (const name of ["authorization", "cookie", "content-type", "accept", "x-forwarded-proto"]) {
      const value = request.headers?.[name];
      if (value) headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }

    const method = String(request.method || "GET").toUpperCase();
    let body;
    if (method !== "GET" && method !== "HEAD") {
      if (typeof request.body === "string") body = request.body;
      else if (request.body !== undefined) body = JSON.stringify(request.body);
    }

    const upstream = await fetch(target.toString(), {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(15000)
    });

    response.status(upstream.status);
    for (const name of [
      "content-type",
      "cache-control",
      "set-cookie",
      "access-control-allow-origin",
      "access-control-allow-headers",
      "access-control-allow-methods",
      "vary"
    ]) {
      const value = upstream.headers.get(name);
      if (value) response.setHeader(name, value);
    }

    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error("[Twitch API Proxy] /api/watchtime:", error?.stack || error);
    response.status(502).setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify({ error: "Giveaway-Backend nicht erreichbar" }));
  }
};
