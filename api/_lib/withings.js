import { createHash, randomBytes } from "node:crypto";
import { redisConfig, createRedis } from "./redis.js";
import { accessDenied } from "./access.js";

// Withings Public API (own account, OAuth 2.0). Tokens live in Redis; measurements
// are passed through to the app, never stored here.
// Reference: https://developer.withings.com/llms.md
const API = "https://wbsapi.withings.net";
const AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2";
const MAX_RANGE_DAYS = 400;
const MAX_PAGES = 10;
const TOKEN_KEY = "withings:tokens";

export class WithingsError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const validDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const rangeDays = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
const zurichFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" });
export function zurichDate(unixSeconds) {
  const p = Object.fromEntries(zurichFormat.formatToParts(new Date(unixSeconds * 1000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const decode = (m) => (m && Number.isFinite(m.value) && Number.isFinite(m.unit) ? m.value * 10 ** m.unit : null);
const plausible = (v, lo, hi) => (v != null && v > lo && v < hi ? Math.round(v * 10) / 10 : null);

// One reading per Zurich day: the earliest weigh-in (usually the morning), with body
// fat taken from the same group or, if missing there, from another group that day.
export function normalizeMeasures(groups, from, to) {
  const days = new Map();
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g || !Number.isFinite(g.date) || !Array.isArray(g.measures) || (g.category != null && g.category !== 1)) continue;
    const date = zurichDate(g.date);
    if (date < from || date > to) continue;
    const weight = plausible(decode(g.measures.find((m) => m?.type === 1)), 20, 300);
    const bodyFat = plausible(decode(g.measures.find((m) => m?.type === 6)), 2, 70);
    if (weight == null && bodyFat == null) continue;
    const prev = days.get(date);
    if (!prev) days.set(date, { date, time: g.date, weight, bodyFat });
    else if (g.date < prev.time) days.set(date, { date, time: g.date, weight: weight ?? prev.weight, bodyFat: bodyFat ?? prev.bodyFat });
    else days.set(date, { ...prev, weight: prev.weight ?? weight, bodyFat: prev.bodyFat ?? bodyFat });
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map(({ date, weight, bodyFat }) => ({ date, weight, bodyFat }));
}

export function createWithingsClient({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const clientId = env.WITHINGS_CLIENT_ID, secret = env.WITHINGS_CLIENT_SECRET;
  const config = redisConfig(env), redis = config ? createRedis(config, fetchImpl) : null;

  const post = async (path, params, token) => {
    const res = await fetchImpl(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) throw new WithingsError("withings_unavailable", 502);
    const json = await res.json().catch(() => null);
    if (!json || typeof json.status !== "number") throw new WithingsError("withings_unavailable", 502);
    if (json.status === 601) throw new WithingsError("withings_rate_limited", 503);
    return json;
  };
  const saveTokens = async (body) => {
    const tokens = {
      access_token: body.access_token, refresh_token: body.refresh_token,
      expires_at: Math.floor(now() / 1000) + (Number(body.expires_in) || 10800), userid: String(body.userid ?? ""),
    };
    await redis("SET", TOKEN_KEY, JSON.stringify(tokens));
    return tokens;
  };
  const requestToken = async (params) => {
    const json = await post("/v2/oauth2", { action: "requesttoken", client_id: clientId, client_secret: secret, ...params });
    if (json.status !== 0 || !json.body?.access_token || !json.body?.refresh_token) throw new WithingsError("withings_reconnect", 409);
    return saveTokens(json.body);
  };
  const storedTokens = async () => {
    const raw = await redis("GET", TOKEN_KEY);
    if (!raw) throw new WithingsError("withings_not_connected", 409);
    try { return JSON.parse(raw); } catch { throw new WithingsError("withings_not_connected", 409); }
  };
  // Refresh a few minutes before expiry; Withings rotates the refresh token every time.
  const accessToken = async (force = false) => {
    const tokens = await storedTokens();
    if (!force && tokens.expires_at - now() / 1000 > 300) return tokens.access_token;
    return (await requestToken({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })).access_token;
  };

  return {
    configured: !!(clientId && secret),
    storage: !!redis,
    // The redirect URI is stored with the one-time state so the callback uses the same value.
    async startConnect(redirectUri) {
      const state = randomBytes(24).toString("hex");
      await redis("SET", `withings:state:${state}`, redirectUri, "EX", "600");
      return `${AUTHORIZE_URL}?${new URLSearchParams({ response_type: "code", client_id: clientId, scope: "user.metrics", redirect_uri: redirectUri, state })}`;
    },
    async finishConnect(code, state) {
      if (typeof state !== "string" || !/^[a-f0-9]{48}$/.test(state) || typeof code !== "string" || !code) throw new WithingsError("withings_state_invalid", 400);
      const redirectUri = await redis("GETDEL", `withings:state:${state}`);
      if (!redirectUri) throw new WithingsError("withings_state_invalid", 400);
      await requestToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    },
    async connected() { return !!(await redis("GET", TOKEN_KEY)); },
    disconnect: () => redis("DEL", TOKEN_KEY),
    async fetchRange(from, to) {
      // Pad by a day on each side; groups are then filtered by their Zurich date.
      const base = { action: "getmeas", meastypes: "1,6", category: "1",
        startdate: String(Date.parse(from + "T00:00:00Z") / 1000 - 86400), enddate: String(Date.parse(to + "T23:59:59Z") / 1000 + 86400) };
      const groups = [];
      // Which Withings account the values belong to (hashed), so the app notices a switch.
      const account = createHash("sha256").update(String((await storedTokens()).userid || "")).digest("hex").slice(0, 12);
      let offset = null, token = await accessToken(), retried = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const json = await post("/measure", offset != null ? { ...base, offset: String(offset) } : base, token);
        if (json.status === 343 && !retried) { retried = true; token = await accessToken(true); page--; continue; }
        if (json.status === 100) break; // no data in range
        if (json.status !== 0) throw new WithingsError(json.status === 343 ? "withings_reconnect" : "withings_unavailable", json.status === 343 ? 409 : 502);
        groups.push(...(Array.isArray(json.body?.measuregrps) ? json.body.measuregrps : []));
        if (json.body?.more && json.body?.offset != null) offset = json.body.offset; else break;
      }
      return { days: normalizeMeasures(groups, from, to), account };
    },
  };
}

const bodyOf = (req) => {
  if (typeof req.body !== "string") return req.body || {};
  try { return JSON.parse(req.body); } catch { return {}; }
};
const originOf = (req) => `https://${req.headers?.["x-forwarded-host"] || req.headers?.host}`;

export function withingsHandler(deps = {}) {
  return async function handler(req, res) {
    const env = deps.env || process.env;
    res.setHeader?.("Cache-Control", "no-store");
    if (!env.APP_ACCESS_CODE) return res.status(503).json({ error: "access_code_not_configured" });
    if (accessDenied(req, env)) return res.status(401).json({ error: "access_denied" });
    const client = createWithingsClient({ ...deps, env });
    if (!client.storage) return res.status(503).json({ error: "storage_not_configured" });
    if (!client.configured) return res.status(503).json({ error: "withings_not_configured" });
    try {
      if (req.method === "POST") {
        const { action } = bodyOf(req);
        if (action === "connect") {
          const redirectUri = env.WITHINGS_REDIRECT_URI || `${originOf(req)}/api/withings-callback`;
          return res.status(200).json({ url: await client.startConnect(redirectUri) });
        }
        if (action === "disconnect") { await client.disconnect(); return res.status(200).json({ ok: true }); }
        return res.status(400).json({ error: "unknown_action" });
      }
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
      const { from, to } = req.query || {};
      if (!validDate(from) || !validDate(to) || from > to || rangeDays(from, to) > MAX_RANGE_DAYS) return res.status(400).json({ error: "invalid_range" });
      return res.status(200).json({ ...(await client.fetchRange(from, to)), from, to });
    } catch (err) {
      if (!(err instanceof WithingsError)) console.error("Withings request failed:", err?.message);
      return res.status(err instanceof WithingsError ? err.status : 502).json({ error: err instanceof WithingsError ? err.code : "withings_unavailable" });
    }
  };
}

// Withings redirects the browser here after consent. Protected by the one-time state.
export function withingsCallbackHandler(deps = {}) {
  return async function handler(req, res) {
    const env = deps.env || process.env;
    const back = (result) => { res.statusCode = 302; res.setHeader("Location", `/?withings=${result}`); res.setHeader("Cache-Control", "no-store"); res.end(); };
    const { code, state, error } = req.query || {};
    // A plain request (e.g. Withings checking the callback URL) just gets 200.
    if (!code && !state && !error) { res.statusCode = 200; res.setHeader("Content-Type", "text/plain"); res.end("ok"); return; }
    if (error) return back("denied");
    try {
      const client = createWithingsClient({ ...deps, env });
      if (!client.storage || !client.configured) return back("error");
      await client.finishConnect(code, state);
      return back("connected");
    } catch (err) {
      if (!(err instanceof WithingsError)) console.error("Withings callback failed:", err?.message);
      return back("error");
    }
  };
}
