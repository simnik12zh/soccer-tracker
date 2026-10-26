import webpush from "web-push";
import { createHash } from "node:crypto";

// Daily reminders via Web Push. The server never sees training data: a push only
// says which slot it is, and the service worker builds the text from the app's
// locally stored status. Files under api/_lib are not deployed as functions.

const MAX_SUBSCRIPTIONS = 5;
const TTL_SECONDS = 3600;
// Europe/Zurich local hour → slot. Cron runs at two UTC hours per slot so both
// summer and winter time hit these hours; every other run is skipped.
export const REMINDER_SLOTS = { 12: "midday", 21: "evening" };
const PUSH_HOSTS = /^(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)$/;

// The Vercel Marketplace integration may use either naming scheme.
export function redisConfig(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function zurichNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function reminderSlot(date = new Date()) {
  const now = zurichNow(date), slot = REMINDER_SLOTS[now.hour];
  return slot ? { ...now, slot } : null;
}

// Only real push services are accepted, so the server never posts to arbitrary URLs.
export function validSubscription(sub) {
  if (!sub || typeof sub !== "object" || typeof sub.endpoint !== "string" || sub.endpoint.length > 1000) return false;
  let url;
  try { url = new URL(sub.endpoint); } catch { return false; }
  const key = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{8,200}={0,2}$/.test(v);
  return url.protocol === "https:" && PUSH_HOSTS.test(url.hostname) && key(sub.keys?.p256dh) && key(sub.keys?.auth);
}

export const subscriptionId = (endpoint) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

export function createPushService({ env = process.env, fetchImpl = globalThis.fetch, push = webpush } = {}) {
  const config = redisConfig(env);
  const redis = async (...command) => {
    const res = await fetchImpl(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error("Redis request failed");
    return data.result;
  };

  // Generated once and kept in Redis, so no key setup is needed in Vercel.
  const vapidKeys = async () => {
    const stored = await redis("GET", "push:vapid");
    if (stored) return JSON.parse(stored);
    await redis("SET", "push:vapid", JSON.stringify(push.generateVAPIDKeys()), "NX");
    return JSON.parse(await redis("GET", "push:vapid"));
  };

  const list = async () => {
    const flat = (await redis("HGETALL", "push:subs")) || [];
    const out = [];
    for (let i = 0; i < flat.length; i += 2) {
      try { out.push({ id: flat[i], ...JSON.parse(flat[i + 1]) }); } catch { /* skip corrupt entry */ }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  };
  const remove = (id) => redis("HDEL", "push:subs", id);

  const send = async (entry, payload, subject) => {
    const vapid = await vapidKeys();
    try {
      await push.sendNotification(entry.subscription, JSON.stringify(payload), {
        TTL: TTL_SECONDS, urgency: "normal",
        vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      });
      return "sent";
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) { await remove(entry.id); return "expired"; }
      return "failed";
    }
  };

  return {
    configured: !!config,
    publicKey: async () => (await vapidKeys()).publicKey,
    async subscribe(subscription) {
      const { endpoint, keys } = subscription;
      await redis("HSET", "push:subs", subscriptionId(endpoint),
        JSON.stringify({ subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, createdAt: Date.now() }));
      const extra = (await list()).slice(MAX_SUBSCRIPTIONS);
      for (const entry of extra) await remove(entry.id);
    },
    unsubscribe: (endpoint) => remove(subscriptionId(endpoint)),
    async test(endpoint, subject) {
      const id = subscriptionId(endpoint), entry = (await list()).find((e) => e.id === id);
      if (!entry) return "unknown";
      if (!(await redis("SET", `push:test:${id}`, "1", "NX", "EX", "20"))) return "rate_limited";
      return send(entry, { slot: "test" }, subject);
    },
    // Idempotent per day and slot: duplicate or manual cron calls send nothing.
    async remind(slotInfo, subject) {
      if (!(await redis("SET", `push:sent:${slotInfo.date}:${slotInfo.slot}`, "1", "NX", "EX", "172800"))) return { skipped: "already_sent" };
      const results = [];
      for (const entry of await list()) results.push(await send(entry, { slot: slotInfo.slot, date: slotInfo.date }, subject));
      return { slot: slotInfo.slot, date: slotInfo.date, results };
    },
  };
}

const subjectFor = (req, env) => env.VAPID_SUBJECT || `https://${req.headers?.["x-forwarded-host"] || req.headers?.host || "soccer-tracker.vercel.app"}`;
const bodyOf = (req) => {
  if (typeof req.body !== "string") return req.body;
  try { return JSON.parse(req.body); } catch { return null; }
};

export function pushHandler(deps = {}) {
  return async function handler(req, res) {
    const env = deps.env || process.env, service = createPushService({ ...deps, env });
    try {
      if (req.method === "GET") {
        if (!service.configured) return res.status(200).json({ configured: false });
        return res.status(200).json({ configured: true, publicKey: await service.publicKey() });
      }
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      if (!service.configured) return res.status(503).json({ error: "not_configured" });
      const body = bodyOf(req);
      if (!body || typeof body !== "object" || JSON.stringify(body).length > 4000) return res.status(400).json({ error: "invalid_body" });
      if (body.action === "subscribe") {
        if (!validSubscription(body.subscription)) return res.status(400).json({ error: "invalid_subscription" });
        await service.subscribe(body.subscription);
        return res.status(200).json({ ok: true });
      }
      if (typeof body.endpoint !== "string" || body.endpoint.length > 1000) return res.status(400).json({ error: "invalid_endpoint" });
      if (body.action === "unsubscribe") { await service.unsubscribe(body.endpoint); return res.status(200).json({ ok: true }); }
      if (body.action === "test") {
        const result = await service.test(body.endpoint, subjectFor(req, env));
        return res.status(result === "sent" ? 200 : result === "rate_limited" ? 429 : result === "unknown" ? 404 : 502).json({ result });
      }
      return res.status(400).json({ error: "unknown_action" });
    } catch (err) {
      console.error("Push request failed:", err?.message);
      return res.status(502).json({ error: "push_failed" });
    }
  };
}

export function remindHandler(deps = {}) {
  return async function handler(req, res) {
    const env = deps.env || process.env;
    if (env.CRON_SECRET && req.headers?.authorization !== `Bearer ${env.CRON_SECRET}`) return res.status(401).json({ ok: false });
    const slot = reminderSlot(deps.now ? deps.now() : new Date());
    if (!slot) return res.status(200).json({ skipped: "outside_window" });
    const service = createPushService({ ...deps, env });
    if (!service.configured) return res.status(200).json({ skipped: "not_configured" });
    try {
      return res.status(200).json(await service.remind(slot, subjectFor(req, env)));
    } catch (err) {
      console.error("Reminder run failed:", err?.message);
      return res.status(502).json({ error: "remind_failed" });
    }
  };
}
