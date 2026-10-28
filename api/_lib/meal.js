import Anthropic from "@anthropic-ai/sdk";
import { accessDenied } from "./access.js";

// Meal photo → estimated components, kcal and protein (Claude vision + structured output).
// The photo is analysed and discarded; only the numbers go back to the app.
export const MEAL_MODEL = "claude-opus-5-5";
const MAX_IMAGE_BASE64 = 3_000_000; // ~2.2 MB JPEG; the app sends ~1280 px images
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const MEAL_SYSTEM_PROMPT = `You estimate the nutrition of a meal from one photo for the food log of an amateur footballer in Switzerland. Your numbers are saved automatically, so give your single best estimate; the player can correct it later but usually won't.

Method:
- Identify each visible component (also drinks, sauces, dressings, bread on the side).
- Estimate the portion in grams from visual cues: a standard dinner plate is about 26–28 cm, cutlery, glasses, packaging, hands. Use cooked or ready-to-eat weights.
- Include fat that is typical for the preparation but hard to see (frying oil, butter, cream sauces, dressing) as its own component when it matters.
- Use standard nutrition values per 100 g for that preparation, then compute kcal and protein per component. If a packaging label or nutrition table is readable, use its values.
- Assume typical Swiss portions when the size is ambiguous; do not systematically under- or over-estimate.
- kcalLow/kcalHigh: a realistic range for the whole meal given what cannot be seen. confidence: high only when components and portions are clear.
- If the photo shows no food or drink, set isFood to false and leave items empty.

Language: names and title in German with Swiss spelling (ss, never ß). title: at most 40 characters, e.g. "Poulet mit Reis und Gemüse".`;

const MEAL_SCHEMA = {
  type: "object",
  properties: {
    isFood: { type: "boolean" },
    title: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          grams: { type: "number" },
          kcal: { type: "number" },
          proteinGrams: { type: "number" },
        },
        required: ["name", "grams", "kcal", "proteinGrams"],
        additionalProperties: false,
      },
    },
    kcalLow: { type: "number" },
    kcalHigh: { type: "number" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["isFood", "title", "items", "kcalLow", "kcalHigh", "confidence"],
  additionalProperties: false,
};

export class MealError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const text = (v, max) => (typeof v === "string" ? v.trim().replace(/ß/g, "ss").slice(0, max) : "");

// Totals are recomputed from the components so the numbers always add up.
export function normalizeMeal(raw) {
  if (!raw || typeof raw !== "object") throw new MealError("meal_unreadable", 502);
  if (raw.isFood === false) throw new MealError("no_food", 422);
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 12).map((i) => ({
    name: text(i?.name, 60) || "Unbekannt",
    grams: Math.round(clamp(i?.grams, 0, 2000) ?? 0),
    kcal: Math.round(clamp(i?.kcal, 0, 3000) ?? 0),
    protein: Math.round((clamp(i?.proteinGrams, 0, 200) ?? 0) * 10) / 10,
  })).filter((i) => i.kcal > 0 || i.protein > 0);
  if (!items.length) throw new MealError("no_food", 422);
  const kcal = Math.min(5000, items.reduce((n, i) => n + i.kcal, 0));
  const protein = Math.min(300, Math.round(items.reduce((n, i) => n + i.protein, 0)));
  let low = Math.round(clamp(raw.kcalLow, 0, 5000) ?? kcal), high = Math.round(clamp(raw.kcalHigh, 0, 6000) ?? kcal);
  if (low > kcal) low = kcal;
  if (high < kcal) high = kcal;
  return {
    title: text(raw.title, 40) || items.map((i) => i.name).slice(0, 2).join(", ").slice(0, 40),
    items, kcal, protein, kcalLow: low, kcalHigh: high,
    confidence: ["low", "medium", "high"].includes(raw.confidence) ? raw.confidence : "medium",
  };
}

export async function analyzeMeal(client, { image, mediaType }) {
  const response = await client.beta.messages.create({
    model: MEAL_MODEL,
    max_tokens: 16000,
    // Thinking is always on for Opus 5.5; medium effort balances accuracy and wait time.
    output_config: { effort: "medium", format: { type: "json_schema", schema: MEAL_SCHEMA } },
    // Server-side fallback in case a safety classifier declines (very unlikely for food photos).
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: MEAL_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
        { type: "text", text: "Schätze diese Mahlzeit." },
      ],
    }],
  });
  if (response.stop_reason === "refusal") throw new MealError("meal_refused", 422);
  if (response.stop_reason === "max_tokens") throw new MealError("meal_unreadable", 502);
  const block = response.content.find((b) => b.type === "text");
  let parsed;
  try { parsed = JSON.parse(block?.text || ""); } catch { throw new MealError("meal_unreadable", 502); }
  return normalizeMeal(parsed);
}

const bodyOf = (req) => {
  if (typeof req.body !== "string") return req.body || {};
  try { return JSON.parse(req.body); } catch { return {}; }
};

export function mealHandler(deps = {}) {
  return async function handler(req, res) {
    const env = deps.env || process.env;
    res.setHeader?.("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    // Spends API credits: the access code is mandatory here.
    if (!env.APP_ACCESS_CODE) return res.status(503).json({ error: "access_code_not_configured" });
    if (accessDenied(req, env)) return res.status(401).json({ error: "access_denied" });
    if (!env.ANTHROPIC_API_KEY && !deps.client) return res.status(503).json({ error: "model_not_configured" });
    const { image, mediaType = "image/jpeg" } = bodyOf(req);
    if (typeof image !== "string" || image.length < 100 || image.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(image) || !MEDIA_TYPES.has(mediaType))
      return res.status(400).json({ error: "invalid_image" });
    try {
      const client = deps.client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      return res.status(200).json({ meal: await analyzeMeal(client, { image, mediaType }) });
    } catch (err) {
      if (err instanceof MealError) return res.status(err.status).json({ error: err.code });
      if (err instanceof Anthropic.RateLimitError) return res.status(503).json({ error: "meal_busy" });
      console.error("Meal analysis failed:", err?.message);
      return res.status(502).json({ error: "meal_unavailable" });
    }
  };
}
