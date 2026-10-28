import { planHandler } from "./_lib/plan.js";

// POST {weekStart, days[7], matchDayBefore, context} → {proposal: {summary, days}}.
// Requires Authorization: Bearer <APP_ACCESS_CODE>. Hard rules are enforced server-side.
export default planHandler();
