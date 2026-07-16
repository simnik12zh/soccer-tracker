# Body Composition Tracking — Weight & Body Fat %

Add optional weight + body fat % logging, with trend-first display. The player uses a smart scale a few times a week (not daily), which gives both numbers together. Goal: 16% → 13–14% body fat, sustained over months.

**Design principle:** smart-scale readings are directionally useful but individually noisy (bioimpedance reads hydration as much as fat). A single day's number means little; the multi-week trend is the real signal. The app must therefore lean on trend display and treat gaps in logging as completely normal — never as a missed target or broken streak.

---

## 1. Entry point — Today view (lightweight)

Add a discreet, optional entry line on the Today view. **Not a card, not a target, no nagging.**

- A small muted line, e.g. "＋ Log weight" (styled like the existing "📝 Add note" affordance).
- Tapping opens a minimal input for two fields:
  - **Weight** (kg, one decimal — e.g. 78.4)
  - **Body fat %** (one decimal — e.g. 15.8) — optional, since not every reading includes it
- If a value is already logged for today, the line shows it instead (e.g. "78.4 kg · 15.8%") and tapping allows editing.
- If nothing is logged, the line stays quiet and unobtrusive. **Never show a "0" or an empty-state that implies failure.**
- This must not appear as a weekly target, must not affect the Weekly Targets card, and must not contribute to any streak or completion logic.

---

## 2. Display — Journey view (the real home)

Add a body composition trend section to the Journey view, where long-horizon framing already belongs.

**A line chart showing:**
- **Primary line: 7-day rolling average of body fat %** — this is the hero. Computed from whatever entries exist in the trailing 7 days (do not require 7 entries; average whatever is present; if no entries in the window, the line simply has a gap).
- **Target line: a horizontal reference at 14%** (the upper end of the 13–14% goal), visually distinct — e.g. a dashed muted line — so the player sees the gap closing over time.
- **Raw daily readings**: shown as small, de-emphasized dots behind the average line, so the noise is visible but clearly secondary. Optional — if it clutters on mobile, drop the dots and keep the average line only.
- **X-axis spans the season phases** where practical, so the Winter Break (the prime body-comp window, mid Nov → early Apr) is visible as the long stretch it is. If phase-banding the chart is complex, a simple date axis is acceptable for v1.

**A weight trend** should be available too — either as a second chart or a toggle between "Body fat %" and "Weight" on the same chart. Weight uses the same 7-day rolling average treatment. No target line for weight (the goal is expressed in body fat %, not kg).

**Summary line above the chart**, e.g.: "15.8% · trending down · 1.8% to goal" — computed from the rolling average, not the latest raw reading.

---

## 3. Data model note

Body comp values are **new optional fields on the existing per-day entry**:

```
{ date: "2026-07-07", sessions: ["gym"], completed: true, readiness: {...}, weight: 78.4, bodyFat: 15.8 }
```

Both `weight` and `bodyFat` are optional and independent — a day may have one, both, or neither. Days with neither are the normal case.

**Treat these as optional fields with safe handling of missing values** (missing = no reading that day, not zero). Old entries without these fields must render fine. If implemented as optional fields, **no storage key bump is needed** — confirm which approach was taken.

Note that a body comp entry can exist on a day with **no session logged** (e.g. a rest day weigh-in). Ensure the data model and any "is this day empty?" logic handles a day that has body comp data but no session — it should not be treated as a fully empty day, and logging weight must not accidentally mark a day as having a completed session.

---

## 4. Explicit non-goals

- **No daily weigh-in target, streak, or reminder.** The player logs a few times a week; gaps are expected and fine.
- **No judgement in the copy.** No "you haven't logged in X days," no red states, no nudging.
- **Do not put this in the readiness row.** Readiness (hip/legs) is for today's training decisions; body comp is a slow background metric and belongs in Journey.
- **Do not lead with the raw daily number anywhere.** The rolling average is always the headline; a single reading is never presented as meaningful progress.

---

## Acceptance checks

- "＋ Log weight" appears on Today as a quiet, optional line; shows logged values when present; never shows a zero or failure state when empty.
- Weight and body fat % can be entered independently (either alone is valid).
- Journey shows a body fat % trend using a 7-day rolling average, with a 14% target reference line.
- Rolling average computes correctly with sparse data (e.g. 3 entries in the trailing 7 days) and gracefully handles windows with no entries.
- Weight trend is viewable (second chart or toggle).
- Summary line reflects the rolling average, not the latest raw reading.
- Body comp data can be logged on a day with no session, without marking that day as having a completed session.
- Old day entries lacking weight/bodyFat render without error.
- Weekly Targets, streak logic, and completion logic are all unaffected by body comp entries.
- Confirm whether a storage key bump was needed (it should not be, if fields are optional).
