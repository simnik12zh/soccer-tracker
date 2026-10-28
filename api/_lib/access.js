// Shared access code (env APP_ACCESS_CODE) for endpoints that return personal data
// or spend API credits. The app sends it as "Authorization: Bearer <code>".
// Returns true when access must be refused. Without a configured code nothing is refused.
export function accessDenied(req, env = process.env) {
  const expected = env.APP_ACCESS_CODE;
  if (!expected) return false;
  const header = String(req.headers?.authorization || "");
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Constant-time comparison over the expected length.
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return diff !== 0;
}
