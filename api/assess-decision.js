import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You coach a 35-year-old right back / centre back in Swiss amateur football.
His core weakness: he receives the ball and THEN decides, instead of deciding
before it arrives. Push him hard on pre-scanning. Be direct, specific, no
filler. Under 180 words.

Use exactly this format:

👁 SCAN [★★★☆☆] — What he noticed vs what he missed. 2 sentences.
⚽ DECISION — Good / Risky / Wrong — Why. 1 sentence.
✅ IDEAL PLAY — What he should have done and why. 2 sentences.
🧠 CARRY THIS — One sharp habit cue for his next game.

Fill the star rating (★ filled, ☆ empty, out of 5) to reflect scan quality.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Missing body" });
    return;
  }

  const description = (body.description || "").toString().trim() || "(not stated)";
  const keyPressure = (body.key_pressure || "").toString().trim() || "(not stated)";
  const scanText = (body.scanText || "").toString().trim() || "(not stated)";
  const decision = (body.decision || "").toString().trim() || "(not stated)";

  const userMessage =
    `Situation: ${description}\n` +
    `Key dilemma: ${keyPressure}\n` +
    `What he saw (scan): "${scanText}"\n` +
    `His decision: "${decision}"\n` +
    `Assess.`;

  const client = new Anthropic({ apiKey });

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1000,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");

    stream.on("text", (delta) => res.write(delta));
    await stream.finalMessage();
    res.end();
  } catch (err) {
    console.error("assess-decision failed:", err);
    if (!res.headersSent) {
      res.status(502).json({ error: "Assessment failed" });
    } else {
      res.end();
    }
  }
}
