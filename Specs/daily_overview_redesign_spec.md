# Daily Overview Redesign — Readiness-First Structure

Redesign the Today view's top section. The current three-stat row (Streak / This Week / July) doesn't help the user decide what to do today and can be demotivating (showing 0s). Replace it with a readiness check-in row that's uniquely relevant to this player (35+, longevity focus, known left hip issue) and feeds real context to the coach.

Keep everything below the stat row largely intact — the Weekly Targets card, the session card, the tactical focus card, and the coach button are all working well.

---

## What changes

### 1. Remove the three-stat row
Delete the current Streak / This Week / July stat cards from the Today view.

### 2. Add a Readiness check-in row (the new top strip)
A row of tap-to-set readiness indicators, directly below the phase header. Each is a one-tap cycle through three states, color-coded:

- 🟢 Green = good / fresh
- 🟡 Amber = okay / slightly off
- 🔴 Red = poor / sore

**Two indicators (keep it to two for low friction):**
- **Hip** — "How's the left hip?" (the player's known gluteus medius niggle — the single most important daily signal)
- **Legs** — general leg freshness / energy

Each indicator:
- Tapping cycles green → amber → red → (back to unset/green)
- Shows a small label ("Hip", "Legs") and the current color state
- Defaults to unset or green at the start of each day
- Is stored per-day (see data model note below)

Design should match the existing card system — same corner radius, same palette family. The colors here are functional (traffic-light readiness), so they can sit alongside the pink/red brand without clashing; use clear, accessible green/amber/red with a non-color cue too (e.g. a small label like "good / ok / sore") so state isn't conveyed by color alone.

### 3. Add a "Next up" line
A single thin line under the phase header showing the next scheduled session, e.g. "Next: Team Training · Thursday". Derived from the existing phase templates — just surface the next non-rest day's session. Keep it small and secondary (muted text), not a card.

### 4. Feed readiness into the coach
When the user taps "Ask the coach", include the day's readiness values in the context sent to the coach (e.g. "Hip: amber, Legs: green"). This makes the coach's advice responsive to how the player actually feels today — if the hip is red, the coach should factor that in. This is the highest-value part of the feature: the check-in isn't just a log, it changes the coaching.

---

## Data model note (important)

These readiness check-ins are **new stored values per day**. A daily entry currently looks roughly like:

```
{ date: "2026-07-07", sessions: ["gym"], completed: true }
```

It would gain optional fields:

```
{ date: "2026-07-07", sessions: ["gym"], completed: true, readiness: { hip: "amber", legs: "green" } }
```

**Handle this as an optional field** — existing entries without a `readiness` object must still render fine (readiness simply shows as unset for old days). If added as an optional field with safe defaults (missing = unset), **no storage key bump is needed** and existing logged data is preserved. Only bump the storage key if the implementation can't cleanly treat readiness as optional.

---

## What stays unchanged
- Phase header (ring + phase name + days-to-next-phase)
- Weekly Targets card (this is the player's favorite element — keep it prominent, directly below the readiness row)
- Today's session card (session type, LOG button, add note, swap)
- This week's focus / tactical prompt card
- Ask the coach button (though per the earlier UX audit, this should be visible on rest days too, not gated behind having a session)

---

## Final layout, top to bottom
1. Phase header (unchanged) + new thin "Next up" line
2. **Readiness row (new)** — Hip · Legs, tap to set
3. Weekly Targets (unchanged, now sits higher up)
4. Today's session card (unchanged)
5. This week's focus (unchanged)
6. Ask the coach (unchanged; make always-visible if not already)

---

## Acceptance checks
- The three old stat cards (Streak/This Week/July) are gone.
- Readiness row renders with two tappable indicators; tapping cycles through green/amber/red with a visible non-color label.
- Readiness is stored per-day and persists across app reloads.
- Old day entries with no readiness data render without error (optional-field safety).
- "Next up" line correctly shows the next scheduled non-rest session from the phase template.
- Tapping "Ask the coach" includes the day's readiness in the coach's context.
- No storage key bump required unless readiness couldn't be made optional — confirm which was done.
- Layout matches existing card styling (radius, spacing, palette).
