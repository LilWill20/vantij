// Reads the authenticated user that Azure Static Web Apps injects into every
// API request as the base64 "x-ms-client-principal" header. Locally, the SWA
// CLI injects the same header, so this works in dev and in the cloud.
function getUser(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    const p = JSON.parse(decoded);
    return {
      id: p.userId,
      name: p.userDetails,
      roles: p.userRoles || [],           // e.g. ["authenticated", "creator"]
      provider: p.identityProvider
    };
  } catch (e) {
    return null;
  }
}

const isAuthenticated = (u) => !!(u && u.id);
const hasRole = (u, role) => !!(u && u.roles && u.roles.includes(role));

module.exports = { getUser, isAuthenticated, hasRole };
