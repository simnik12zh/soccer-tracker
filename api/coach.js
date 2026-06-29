import Anthropic from "@anthropic-ai/sdk";

// Sonnet 4.6 is fast enough for a mobile chat bubble while giving strong
// coaching quality. Bump to "claude-opus-4-8" for maximum quality / more latency.
const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a personal soccer performance coach for a 35-year-old amateur defender (right back / centre back) playing in the 4th and 5th Liga Schweiz.

Your player's goals:
- Be a soccer athlete for life — playing into his 40s and 50s
- Build a more muscular, explosive, athletic body (current ~16% body fat, target 13-14%)
- Improve pre-scanning and decision-making (key tactical weakness)
- Protect the body, especially left hip/glute med area
- Gym consistency (historically on/off pattern)

Your coaching style:
- Direct and honest, not a cheerleader
- Evidence-based — refer to sports science where relevant
- Soccer-specific — relate fitness work back to on-pitch performance
- Age-aware — 35 going on 36, recovery matters more than it used to
- Tactical awareness — regularly reinforce the scanning/decision-making focus

You have full context of the player's training history, current phase, upcoming sessions, and recent logs. Use this to give specific, relevant advice — not generic fitness tips.

Keep replies concise and practical — two to four short paragraphs written for a phone screen. No markdown headers, no long bullet lists. Address the player directly as "you", and use his first name naturally now and then if you're told it. Don't start with "Here is..." or restate the question — just talk to him. Never give medical advice; if he mentions pain or injury, steer him toward rest and a professional.`;

// Build the context block appended to the system prompt so the coach always has
// the same view of the season the player does, however long the chat grows.
function buildContextBlock(ctx) {
  const lines = [];
  lines.push("Here is the player's current training context. Ground your advice in it; don't invent details you weren't given.");
  lines.push("");
  if (ctx.playerName) lines.push(`The player's name is ${ctx.playerName}.`);

  if (ctx.phase) {
    lines.push("");
    lines.push(`Current season phase: ${ctx.phase.name}.`);
    if (ctx.phase.description) lines.push(`Phase focus: ${ctx.phase.description}`);
  }
  if (ctx.daysToNextPhase != null) {
    lines.push(ctx.nextPhase
      ? `Days until the next phase (${ctx.nextPhase}): ${ctx.daysToNextPhase}.`
      : `Days until the season ends: ${ctx.daysToNextPhase}.`);
  }

  const d = ctx.today || {};
  lines.push("");
  lines.push("The session currently in view (what the player is most likely asking about):");
  lines.push(`- Date: ${d.label || d.date || "today"}`);
  lines.push(`- Session: ${d.workout || "Rest day"}`);
  if (d.completed) {
    lines.push(`- Status: completed${d.feeling ? ` (felt "${d.feeling}")` : ""}`);
  } else {
    lines.push(`- Status: not done yet`);
  }

  const recent = Array.isArray(ctx.recentSessions) ? ctx.recentSessions : [];
  if (recent.length) {
    lines.push("");
    lines.push(`Completed sessions in the last 14 days (oldest first) — ${recent.length} total:`);
    for (const h of recent) {
      const parts = [`- ${h.date}: ${h.workout}`];
      if (h.feeling) parts.push(`· felt "${h.feeling}"`);
      if (h.notes) parts.push(`· note: ${h.notes}`);
      lines.push(parts.join(" "));
    }
  } else {
    lines.push("");
    lines.push("No sessions completed in the last 14 days.");
  }

  if (ctx.week) {
    lines.push("");
    lines.push(`This week so far: ${ctx.week.done} of ${ctx.week.planned} planned sessions done.`);
  }

  if (ctx.tactical) {
    lines.push("");
    lines.push(`This week's tactical focus: "${ctx.tactical.focus}" — ${ctx.tactical.detail}`);
    lines.push("Reinforce this focus when it's relevant to what the player asks.");
  }

  return lines.join("\n");
}

// Keep only well-formed {role, content} turns to send to the model.
function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
}

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

  let ctx;
  try {
    ctx = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  if (!ctx || typeof ctx !== "object") {
    res.status(400).json({ error: "Missing context" });
    return;
  }

  const messages = sanitizeMessages(ctx.messages);
  if (!messages.length) {
    res.status(400).json({ error: "No messages provided" });
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: "disabled" }, // snappy, chat-style replies — no thinking latency
      system: `${SYSTEM_PROMPT}\n\n${buildContextBlock(ctx)}`,
      messages,
    });

    // Plain-text streaming: the client reads the body incrementally and appends
    // each chunk straight into the chat bubble.
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");

    stream.on("text", (delta) => res.write(delta));
    await stream.finalMessage();
    res.end();
  } catch (err) {
    console.error("Coach request failed:", err);
    if (!res.headersSent) {
      res.status(502).json({ error: "Coach request failed" });
    } else {
      res.end();
    }
  }
}
