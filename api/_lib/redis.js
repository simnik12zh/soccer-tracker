// Minimal Upstash Redis client over REST. The Vercel Marketplace integration may
// name the variables either way, so accept both.
export function redisConfig(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function createRedis(config, fetchImpl = globalThis.fetch) {
  return async (...command) => {
    const res = await fetchImpl(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error("Redis request failed");
    return data.result;
  };
}
