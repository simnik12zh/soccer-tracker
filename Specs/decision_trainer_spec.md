# Decision Trainer — Claude Code Build Spec

A 5th view for the Soccer Tracker app: a tactical decision trainer for a right back / centre back. Claude generates a game situation rendered on a pitch, the player describes their scan and their decision, and Claude assesses both. The whole point is to train *pre-scanning* — deciding before the ball arrives.

This was prototyped as an artifact and the interaction loop is validated. The only change for production is that the two AI calls must go through server-side `/api/` routes (like the existing `api/coach.js`), **not** a browser-side fetch to `api.anthropic.com`. That browser path does not work in deployment — it must be server-side.

---

## 1. Where it fits

- Add as a 5th view alongside Today / Week / Month / Journey.
- Reuse the existing pink/red palette, card styling, bottom-nav, and phase logic.
- Suggested nav label: "Trainer" or "IQ". Icon: a target or brain icon consistent with the existing icon set.
- Mobile-first, same as the rest of the app.

---

## 2. The interaction loop (state machine)

Five states:

1. `idle` — intro card + "Generate situation" button.
2. `gen` — loading while the situation is fetched.
3. `scan` — pitch is shown; player types what they see *before* the ball arrives.
4. `decide` — player types their decision (with a back button to revise the scan).
5. `assessing` → `done` — Claude's assessment streams in; then "Next situation" / "Start over".

State shape:

```js
{
  step: 'idle' | 'gen' | 'scan' | 'decide' | 'assessing' | 'done',
  situation: null | SituationObject,
  scanText: '',
  decision: '',
  assessment: '',
  error: null,
  count: 0   // increments each generated situation, shown as "#3" badge
}
```

Persisting `count` (and optionally a history of past situations + assessments) to localStorage would let the player track reps over time — nice-to-have, not required for v1.

---

## 3. Two API endpoints (server-side, mirror `api/coach.js`)

Both read `ANTHROPIC_API_KEY` server-side only. Never expose the key; never `VITE_`-prefix it.

### 3a. `POST /api/generate-situation`

Generates the tactical scenario. Returns JSON the front end renders onto the pitch.

- Model: `claude-sonnet-4-6`
- `max_tokens`: 1000
- Not streamed (single JSON object).
- Request body from client: `{ count: number }` (just for variety/numbering).

**System prompt:**

```
You generate soccer game situations for a right back / centre back in Swiss
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
Include 5-6 teammates and 3-5 opponents.
```

**Server must defensively parse the response** (the model occasionally adds stray text). Extraction order:
1. `JSON.parse` the trimmed text.
2. Strip ```` ``` ```` fences, parse again.
3. Regex the first `{...}` block (`/\{[\s\S]*\}/`), parse that.
4. If all fail, return HTTP 502 with a clear error so the client can show "Couldn't generate, try again."

Return the parsed object as JSON to the client.

### 3b. `POST /api/assess-decision` (streaming)

Assesses the player's scan + decision. Streams like the coach.

- Model: `claude-sonnet-4-6`
- `max_tokens`: 1000
- `stream: true` — pipe the stream through to the client (same approach as `api/coach.js`).
- Request body from client: `{ description, key_pressure, scanText, decision }`.

**System prompt:**

```
You coach a 35-year-old right back / centre back in Swiss amateur football.
His core weakness: he receives the ball and THEN decides, instead of deciding
before it arrives. Push him hard on pre-scanning. Be direct, specific, no
filler. Under 180 words.

Use exactly this format:

👁 SCAN [★★★☆☆] — What he noticed vs what he missed. 2 sentences.
⚽ DECISION — Good / Risky / Wrong — Why. 1 sentence.
✅ IDEAL PLAY — What he should have done and why. 2 sentences.
🧠 CARRY THIS — One sharp habit cue for his next game.

Fill the star rating (★ filled, ☆ empty, out of 5) to reflect scan quality.
```

**User message** (assembled server-side or passed from client):

```
Situation: {description}
Key dilemma: {key_pressure}
What he saw (scan): "{scanText or '(not stated)'}"
His decision: "{decision}"
Assess.
```

---

## 4. Pitch rendering (front end)

A horizontal SVG pitch, `viewBox="0 0 105 68"`, attacking left → right. This code is already working from the prototype — port it directly.

Markers:
- **You** — yellow `#ffbe0b` filled circle (r≈3.2), white stroke, "YOU" label in dark text.
- **Teammates** — blue `#4895ef` circles (r≈2.8), white position label.
- **Opponents** — red `#e63946` circles (r≈2.8), white position label.
- **Ball** — small white circle (r≈1.8) at `ball.x/ball.y`.

Pitch markings to draw (all in `rgba(255,255,255,0.85)`, stripe the grass with two greens `#2c7a43` / `#277a3d`):
- Outer boundary, halfway line, centre circle (r≈9.15) + centre spot.
- Both penalty boxes (16.5 deep × 40.32 wide) and six-yard boxes (5.5 × 18.32).
- Penalty spots at x≈11 and x≈94.
- Goals as thin rects just outside each goal line.
- Faint "YOUR GOAL" / "OPP GOAL" labels in the corners.

Under the pitch: a small legend row (You / Team / Opp / Ball) plus a muted right-aligned tag showing `phase · ball_with`.

Defensive rendering: guard against missing arrays (`teammates = []`, `opponents = []`) and missing `ball`/`player_you` so a malformed response can't crash the view.

---

## 5. UI per step (reuse existing card styles)

**idle**
- Intro card: title "Tactical decision trainer", one line on what it does.
- "The loop" card: the 4 steps (situation → scan → decide → feedback).
- Primary button: "Generate situation".
- If `error`, show a danger-styled card above the button.

**scan**
- Pitch + legend.
- "Situation" card: `description` plus a `→ key_pressure` accent line.
- Input card: label "Before the ball arrives — what do you see?", hint "Pressure direction, free teammates, space available.", textarea bound to `scanText`.
- Primary button "Next: make your decision →", disabled until `scanText` is non-empty.

**decide**
- Same pitch + situation card stay visible (don't make him re-read from memory).
- Input card: label "What do you do?", hint "Be specific — where, to whom, body shape, timing.", textarea bound to `decision`.
- Primary "Get assessment →" (disabled until non-empty) + secondary "← Back to scan" (preserves typed text).

**assessing / done**
- Assessment card with the streamed text (preserve line breaks / `white-space: pre-wrap`).
- On `done`: primary "Next situation →" (calls generate) + secondary "Start over".

---

## 6. Acceptance checks

- Generate works repeatedly without manual retries; malformed model output is caught server-side and surfaces a clean error, never a crash.
- Streaming assessment renders progressively on mobile Safari and Chrome.
- Scan text is required before decision; decision required before assessment; back button preserves both.
- Pitch renders correctly with the player on the right-back side, attacking left → right, and never breaks on a partial/odd response.
- API key stays server-side; nothing key-related ships to the browser.
- View matches the existing four in palette, spacing, nav, and card styling.

---

## 7. Why server-side (context for the build)

In the artifact prototype, the browser called `api.anthropic.com` directly and failed with "Failed to fetch" in every environment — that path isn't available client-side in production. The app already solves this correctly with `api/coach.js`: the browser calls a same-origin `/api/` route, and the server holds the key and talks to Claude. The two endpoints above follow that exact pattern. Model for both: `claude-sonnet-4-6`.
