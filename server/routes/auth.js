const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Joi = require('joi');
const db = require('../db');
const {
  signAccess,
  signRefresh,
  verifyRefresh,
  requireAuth,
  loadEmployeeContext,
} = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { checkPermission } = require('../middleware/checkPermission');
const { sha256 } = require('../utils/ids');

const router = express.Router();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const loginSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  password: Joi.string().min(1).max(200).required(),
});

const changePasswordSchema = Joi.object({
  current_password: Joi.string().min(1).max(200).required(),
  new_password: Joi.string()
    .min(8)
    .max(200)
    .pattern(/[A-Z]/, 'uppercase')
    .pattern(/[a-z]/, 'lowercase')
    .pattern(/[0-9]/, 'number')
    .required(),
});

const updateProfileSchema = Joi.object({
  name: Joi.string().min(1).max(120),
  email: Joi.string().email({ tlds: { allow: false } }),
}).min(1);

const REFRESH_COOKIE = 'refreshToken';
const refreshCookieOpts = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function buildUserPayload(emp) {
  const ctx = loadEmployeeContext(emp.id);
  const role = db.prepare('SELECT name, name_ar FROM roles WHERE id = ?').get(emp.role_id);
  return {
    id: emp.id,
    employee_code: emp.employee_code,
    name: emp.name,
    email: emp.email,
    role_id: emp.role_id,
    role_name: role?.name || null,
    role_name_ar: role?.name_ar || null,
    permissions: ctx?.permissions || [],
  };
}

function createSession(req, employeeId, refreshToken) {
  const id = 'SES-' + crypto.randomBytes(8).toString('hex');
  const ip = (req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '')
    .toString()
    .split(',')[0]
    .trim();
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 500);
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO employee_sessions
       (id, employee_id, token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, employeeId, sha256(refreshToken), ip, ua, expires);
  return id;
}

// ─── LOGIN ───────────────────────────────────────────
router.post('/login', (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const emp = db.prepare('SELECT * FROM employees WHERE email = ?').get(value.email);
  if (!emp) {
    audit(req, 'login.fail', 'employee', value.email, { reason: 'no-such-user' });
    return res.status(401).json({ error: 'invalid credentials' });
  }

  if (emp.status !== 'active') {
    audit(req, 'login.fail', 'employee', emp.id, { reason: 'inactive', status: emp.status });
    return res.status(403).json({ error: 'account is ' + emp.status });
  }

  if (emp.locked_until && new Date(emp.locked_until) > new Date()) {
    audit(req, 'login.fail', 'employee', emp.id, {
      reason: 'locked',
      locked_until: emp.locked_until,
    });
    return res.status(423).json({
      error: 'حساب مؤقت مغلق / Account temporarily locked',
      locked_until: emp.locked_until,
    });
  }

  const ok = bcrypt.compareSync(value.password, emp.password_hash);
  if (!ok) {
    const attempts = (emp.login_attempts || 0) + 1;
    let lockedUntil = null;
    if (attempts >= MAX_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
    }
    db.prepare(
      `UPDATE employees SET login_attempts = ?, locked_until = ? WHERE id = ?`
    ).run(attempts, lockedUntil, emp.id);
    audit(req, 'login.fail', 'employee', emp.id, {
      reason: 'bad-password',
      attempts,
      locked_until: lockedUntil,
    });
    if (lockedUntil) {
      return res.status(423).json({
        error: `Too many failed attempts — locked for ${LOCK_MINUTES} minutes`,
        locked_until: lockedUntil,
      });
    }
    return res.status(401).json({ error: 'invalid credentials', attempts_left: MAX_ATTEMPTS - attempts });
  }

  // success — reset attempts, update last_login
  db.prepare(
    `UPDATE employees SET login_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(emp.id);

  const claims = { sub: emp.id, email: emp.email };
  const accessToken = signAccess(claims);
  const refreshToken = signRefresh(claims);
  createSession(req, emp.id, refreshToken);

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOpts);
  audit(req, 'login.success', 'employee', emp.id, { email: emp.email });
  res.json({ accessToken, user: buildUserPayload(emp) });
});

// ─── REFRESH ─────────────────────────────────────────
router.post('/refresh', (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ error: 'no refresh token' });
  try {
    const claims = verifyRefresh(token);
    // Confirm the session row still exists (lets Super Admin force-terminate)
    const sess = db
      .prepare('SELECT id FROM employee_sessions WHERE token_hash = ? AND employee_id = ?')
      .get(sha256(token), claims.sub);
    if (!sess) return res.status(401).json({ error: 'session terminated' });

    const ctx = loadEmployeeContext(claims.sub);
    if (!ctx) return res.status(401).json({ error: 'employee no longer active' });

    const accessToken = signAccess({ sub: claims.sub, email: claims.email });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'invalid refresh token' });
  }
});

// ─── LOGOUT ──────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      db.prepare('DELETE FROM employee_sessions WHERE token_hash = ?').run(sha256(token));
    } catch {
      /* ignore */
    }
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
});

// ─── ME ──────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.user.sub);
  if (!emp) return res.status(404).json({ error: 'not found' });
  res.json(buildUserPayload(emp));
});

// ─── CHANGE OWN PASSWORD ─────────────────────────────
router.post('/change-password', requireAuth, (req, res) => {
  const { error, value } = changePasswordSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.user.sub);
  if (!emp) return res.status(404).json({ error: 'not found' });

  if (!bcrypt.compareSync(value.current_password, emp.password_hash)) {
    audit(req, 'password.change.fail', 'employee', emp.id, { reason: 'bad-current' });
    return res.status(401).json({ error: 'current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(value.new_password, 12);
  const currentToken = req.cookies?.[REFRESH_COOKIE];
  const trx = db.transaction(() => {
    db.prepare(
      `UPDATE employees SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(newHash, emp.id);
    // Invalidate every other session — keep the current one
    if (currentToken) {
      db.prepare(
        'DELETE FROM employee_sessions WHERE employee_id = ? AND token_hash != ?'
      ).run(emp.id, sha256(currentToken));
    } else {
      db.prepare('DELETE FROM employee_sessions WHERE employee_id = ?').run(emp.id);
    }
  });
  trx();

  audit(req, 'password.change', 'employee', emp.id, {});
  res.json({ ok: true });
});

// ─── UPDATE OWN PROFILE ──────────────────────────────
router.post('/update-profile', requireAuth, (req, res) => {
  const { error, value } = updateProfileSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  if (value.email) {
    const dup = db
      .prepare('SELECT id FROM employees WHERE email = ? AND id != ?')
      .get(value.email, req.user.sub);
    if (dup) return res.status(409).json({ error: 'email already in use' });
  }

  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.user.sub);
  const merged = { ...emp, ...value };
  db.prepare(
    `UPDATE employees SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(merged.name, merged.email, emp.id);

  audit(req, 'profile.update', 'employee', emp.id, { changed: Object.keys(value) });
  res.json(buildUserPayload({ ...emp, ...value }));
});

// ─── SESSIONS (Super Admin) ──────────────────────────
router.get('/sessions', requireAuth, checkPermission('settings.manage'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.employee_id, s.ip_address, s.user_agent, s.expires_at, s.created_at,
              e.name AS employee_name, e.email AS employee_email, e.employee_code
         FROM employee_sessions s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.expires_at > CURRENT_TIMESTAMP
        ORDER BY s.created_at DESC`
    )
    .all();
  res.json(rows);
});

router.delete('/sessions/:id', requireAuth, checkPermission('settings.manage'), (req, res) => {
  const r = db.prepare('DELETE FROM employee_sessions WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'not found' });
  audit(req, 'session.terminate', 'employee_session', req.params.id, {});
  res.json({ ok: true });
});

module.exports = router;
