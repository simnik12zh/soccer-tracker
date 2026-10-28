import { withingsHandler } from "./_lib/withings.js";

// GET ?from&to (max 400 days): daily weight and body fat. POST {action: connect|disconnect}.
// Requires Authorization: Bearer <APP_ACCESS_CODE>. Nothing but OAuth tokens is stored.
export default withingsHandler();
