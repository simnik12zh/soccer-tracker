import { createHash } from "node:crypto";
import { redisConfig, createRedis } from "./redis.js";
import { accessDenied } from "./access.js";

// Garmin Connect Personal API (read-only, own account). The personal key from
// Garmin Connect is exchanged for a bearer token (a JWT); the token is cached in
// Redis when available. Activity data is passed through, never stored here.
// Endpoints and token exchange follow Garmin's official client:
// https://github.com/garmin/connect-personal-api-python
const BASE_URL = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const REFRESH_WINDOW_SECONDS = 3600;
const MAX_RANGE_DAYS = 28; // daily steps endpoint limit

export class GarminError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const validDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"))
  && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export function rangeDays(from, to) {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
}

export function jwtExpiry(token) {
  try {
    const part = token.split(".")[1];
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return Number.isFinite(json.exp) ? json.exp : null;
  } catch { return null; }
}

// Only the fields the app needs; everything else stays at Garmin.
// GPS top speeds above 40 km/h are treated as glitches (faster than any footballer).
const MAX_PLAUSIBLE_KMH = 40;
const round1 = (v) => Math.round(v * 10) / 10;
function highHrMinutes(a) {
  const z4 = a.hrTimeInZone_4, z5 = a.hrTimeInZone_5;
  if (!Number.isFinite(z4) && !Number.isFinite(z5)) return null;
  return Math.round(((Number.isFinite(z4) ? z4 : 0) + (Number.isFinite(z5) ? z5 : 0)) / 60);
}
export function normalizeActivities(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((a) => a && a.activityId != null && typeof a.startTimeLocal === "string" && validDate(a.startTimeLocal.slice(0, 10)))
    .map((a) => ({
      id: String(a.activityId),
      date: a.startTimeLocal.slice(0, 10),
      start: a.startTimeLocal.slice(11, 16),
      type: typeof a.activityType?.typeKey === "string" ? a.activityType.typeKey : "other",
      name: typeof a.activityName === "string" ? a.activityName.slice(0, 80) : "",
      minutes: Number.isFinite(a.duration) ? Math.round(a.duration / 60) : null,
      calories: Number.isFinite(a.calories) ? Math.round(a.calories) : null,
      avgHr: Number.isFinite(a.averageHR) ? Math.round(a.averageHR) : null,
      distanceKm: Number.isFinite(a.distance) && a.distance > 0 ? round1(a.distance / 1000) : null,
      maxSpeedKmh: Number.isFinite(a.maxSpeed) && a.maxSpeed > 0 && a.maxSpeed * 3.6 <= MAX_PLAUSIBLE_KMH ? round1(a.maxSpeed * 3.6) : null,
      load: Number.isFinite(a.activityTrainingLoad) ? Math.round(a.activityTrainingLoad) : null,
      highHrMin: highHrMinutes(a),
    }));
}
export function normalizeSteps(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((d) => d && validDate(d.calendarDate) && Number.isInteger(d.totalSteps) && d.totalSteps >= 0)
    .map((d) => ({ date: d.calendarDate, steps: d.totalSteps }));
}

export function createGarminClient({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const key = env.GARMIN_PERSONAL_API_KEY;
  const config = redisConfig(env), redis = config ? createRedis(config, fetchImpl) : null;
  const fingerprint = key ? createHash("sha256").update(key).digest("hex").slice(0, 16) : null;
  let memo = null, pending = null;

  const exchange = async () => {
    const res = await fetchImpl(BASE_URL + TOKEN_PATH, { method: "POST", headers: { Accept: "*/*", Authorization: `ApiKey ${key}` } });
    if (res.status === 401 || res.status === 403) throw new GarminError("garmin_key_invalid", 502);
    if (!res.ok) throw new GarminError("garmin_unavailable", 502);
    const token = (await res.text()).trim(), exp = jwtExpiry(token);
    if (!exp) throw new GarminError("garmin_unavailable", 502);
    memo = { token, exp, fp: fingerprint };
    if (redis) await redis("SET", "garmin:token", JSON.stringify(memo), "EX", String(Math.max(60, Math.floor(exp - now() / 1000))));
    return token;
  };
  const token = async (force = false) => {
    const fresh = (t) => t && t.fp === fingerprint && t.exp - now() / 1000 > REFRESH_WINDOW_SECONDS;
    if (!force && fresh(memo)) return memo.token;
    if (!force && redis) {
      const cached = await redis("GET", "garmin:token").then((v) => (v ? JSON.parse(v) : null)).catch(() => null);
      if (fresh(cached)) { memo = cached; return cached.token; }
    }
    // Parallel requests share one exchange.
    if (!pending) pending = exchange().finally(() => { pending = null; });
    return pending;
  };
  // One retry with a new token: Garmin tokens can stop working before they expire.
  const get = async (path) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchImpl(BASE_URL + path, { headers: { Accept: "application/json", Authorization: `Bearer ${await token(attempt > 0)}` } });
      if (res.status === 401 && attempt === 0) continue;
      if (res.status === 429) throw new GarminError("garmin_rate_limited", 503);
      if (!res.ok) throw new GarminError(res.status === 401 || res.status === 403 ? "garmin_key_invalid" : "garmin_unavailable", 502);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
    throw new GarminError("garmin_key_invalid", 502);
  };

  return {
    configured: !!key,
    async fetchRange(from, to) {
      const q = new URLSearchParams({ start: "0", limit: "99", startDate: from, endDate: to, sortOrder: "asc" });
      const [activities, steps] = await Promise.all([
        get(`/activitylist-service/activities/search/activities?${q}`),
        get(`/usersummary-service/stats/steps/daily/${from}/${to}`),
      ]);
      return { activities: normalizeActivities(activities), steps: normalizeSteps(steps) };
    },
  };
}

export function garminHandler(deps = {}) {
  return async function handler(req, res) {
    const env = deps.env || process.env;
    res.setHeader?.("Cache-Control", "no-store");
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    // Personal data: a configured access code is mandatory here.
    if (!env.APP_ACCESS_CODE) return res.status(503).json({ error: "access_code_not_configured" });
    if (accessDenied(req, env)) return res.status(401).json({ error: "access_denied" });
    const client = createGarminClient({ ...deps, env });
    if (!client.configured) return res.status(503).json({ error: "garmin_not_configured" });
    const { from, to } = req.query || {};
    if (!validDate(from) || !validDate(to) || from > to || rangeDays(from, to) > MAX_RANGE_DAYS) return res.status(400).json({ error: "invalid_range" });
    try {
      return res.status(200).json({ ...(await client.fetchRange(from, to)), from, to });
    } catch (err) {
      if (!(err instanceof GarminError)) console.error("Garmin sync failed:", err?.message);
      return res.status(err instanceof GarminError ? err.status : 502).json({ error: err instanceof GarminError ? err.code : "garmin_unavailable" });
    }
  };
}
