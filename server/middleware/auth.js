const jwt = require('jsonwebtoken');
const db = require('../db');

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

/**
 * Hydrate role + permissions for an employee id.
 * Returns { role, permissions, employee } or null if employee missing/suspended.
 */
function loadEmployeeContext(employeeId) {
  const emp = db
    .prepare(
      `SELECT id, employee_code, name, email, role_id, status
         FROM employees WHERE id = ?`
    )
    .get(employeeId);
  if (!emp) return null;
  if (emp.status !== 'active') return null;

  const role = db
    .prepare('SELECT role_level FROM roles WHERE id = ?')
    .get(emp.role_id);
  const role_level = role?.role_level ?? 0;

  const perms = db
    .prepare(
      `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?`
    )
    .all(emp.role_id)
    .map((r) => r.code);

  return { role: emp.role_id, role_level, permissions: perms, employee: emp };
}

/** Express middleware — requires a valid Bearer access token. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });

  let claims;
  try {
    claims = verifyAccess(token);
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }

  const ctx = loadEmployeeContext(claims.sub);
  if (!ctx) return res.status(401).json({ error: 'employee no longer active' });

  req.user = {
    ...claims,
    role: ctx.role,
    role_level: ctx.role_level,
    permissions: ctx.permissions,
    employee: ctx.employee,
  };
  next();
}

module.exports = {
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  requireAuth,
  loadEmployeeContext,
};
