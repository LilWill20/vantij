// Identity for Vantij.
//
// The university tenant does not allow application registrations, so an Entra
// sign-in could not be used. Accounts are held in Cosmos instead: the password
// is stored as a scrypt hash and never in the clear, and a successful sign-in
// returns a signed token that the browser sends on every later request.
//
// Only node:crypto is used, so the API keeps its two Azure SDKs and nothing
// else.
const crypto = require("node:crypto");

const SECRET = process.env.AUTH_SECRET || "development-only-secret";
const TOKEN_HOURS = Number(process.env.TOKEN_HOURS || 12);

/* ------------------------------------------------------------- passwords */

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(plain, salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plain, stored) {
  if (typeof stored !== "string") return false;
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(plain, salt, 32).toString("hex");
  // constant time, so a wrong password cannot be found a character at a time
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------------------------------------------------------- tokens */

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  const body = base64url(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function issueToken(user) {
  return sign({
    sub: user.id,
    name: user.name,
    role: user.role,
    exp: Date.now() + TOKEN_HOURS * 3600 * 1000,
  });
}

function readToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const given = Buffer.from(mac || "", "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

/* ------------------------------------------------------------- requests */

function getUser(req) {
  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const payload = readToken(header.slice(7).trim());
  if (!payload) return null;
  return { id: payload.sub, name: payload.name, role: payload.role, roles: [payload.role] };
}

const isAuthenticated = (u) => !!(u && u.id);
const hasRole = (u, role) => !!(u && u.role === role);

module.exports = {
  hashPassword, verifyPassword, issueToken, readToken,
  getUser, isAuthenticated, hasRole, TOKEN_HOURS,
};
