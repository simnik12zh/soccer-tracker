import { garminHandler } from "./_lib/garmin.js";

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (max 28 days), Authorization: Bearer <APP_ACCESS_CODE>.
// Returns recent Garmin activities and daily steps; nothing is stored server-side.
export default garminHandler();
