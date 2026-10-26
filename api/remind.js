import { remindHandler } from "./_lib/push.js";

// Called by Vercel Cron (see vercel.json). Sends at most one push per slot and day.
export default remindHandler();
