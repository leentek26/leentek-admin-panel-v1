const jwt = require('jsonwebtoken');

const ACCESS_SECRET = () => process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET;
const ACCESS_TTL = () => process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL = () => process.env.JWT_REFRESH_TTL || '7d';

function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET(), { expiresIn: ACCESS_TTL() });
}

function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET(), { expiresIn: REFRESH_TTL() });
}

function verifyAccess(token) {
  return jwt.verify(token, ACCESS_SECRET());
}

function verifyRefresh(token) {
  return jwt.verify(token, REFRESH_SECRET());
}

/** Express middleware — requires a valid Bearer access token. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.user = verifyAccess(token);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

module.exports = {
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  requireAuth,
};
