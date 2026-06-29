import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You generate soccer game situations for a right back / centre back in Swiss
amateur football (4th/5th Liga). Vary the scenario type each call: defending
deep, building out from the back, defensive transition, receiving under
pressure, overlapping into attack, dealing with a switch of play, etc.

Respond with ONLY a raw JSON object — no text before or after, no markdown,
no code fences:

{
  "description": "2-3 vivid sentences from the player's perspective, specific about where opponents and teammates are",
  "phase": "defending" | "building" | "transition",
  "player_you": { "x": number, "y": number },
  "ball": { "x": number, "y": number },
  "ball_with": "GK" | "CB" | "you" | "CDM" | "opponent",
  "teammates": [ { "x": number, "y": number, "label": "GK|CB|LB|CDM|CM|RW|LW|ST" } ],
  "opponents": [ { "x": number, "y": number, "label": "ST|LW|RW|CAM|CM" } ],
  "key_pressure": "One sentence naming the specific decision the right back faces right now"
}

Coordinate system: x=0 is own goal, x=105 is opponent goal. y=0 top touchline,
y=68 bottom touchline. The player's team attacks left to right.
Typical positions (vary within these):
- Right back (YOU): x 18-32, y 8-20
- GK: x 3-5, y 32-36
- CB: x 12-25, y 28-44
- LB: x 14-28, y 50-62
- CDM: x 38-52, y 30-42
- Wingers/forwards: x 45-80
Include 5-6 teammates and 3-5 opponents.`;

// The model occasionally wraps the JSON in stray prose or code fences. Try a
// series of increasingly forgiving extraction strategies before giving up.
function parseSituation(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  // 1. Straight parse.
  try { return JSON.parse(trimmed); } catch {}
  // 2. Strip ``` / ```json fences, parse again.
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(unfenced); } catch {}
  // 3. Regex the first {...} block.
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
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

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  const count = Number.isFinite(body?.count) ? body.count : 0;

  const client = new Anthropic({ apiKey });

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: `Generate situation #${count + 1}. Make it distinct from typical scenarios — vary the phase and scenario type.` },
      ],
    });

    const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const situation = parseSituation(text);
    if (!situation || typeof situation !== "object") {
      res.status(502).json({ error: "Couldn't generate a situation, try again." });
      return;
    }
    res.status(200).json(situation);
  } catch (err) {
    console.error("generate-situation failed:", err);
    res.status(502).json({ error: "Couldn't generate a situation, try again." });
  }
}
