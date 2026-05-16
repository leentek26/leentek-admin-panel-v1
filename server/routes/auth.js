const express = require('express');
const bcrypt = require('bcrypt');
const Joi = require('joi');
const db = require('../db');
const { signAccess, signRefresh, verifyRefresh } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const router = express.Router();

const loginSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  password: Joi.string().min(1).max(200).required(),
});

const REFRESH_COOKIE = 'refreshToken';
const refreshCookieOpts = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.post('/login', (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(value.email);
  if (!admin) {
    audit(req, 'login.fail', 'admin', value.email, { reason: 'no-such-user' });
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const ok = bcrypt.compareSync(value.password, admin.password_hash);
  if (!ok) {
    audit(req, 'login.fail', 'admin', value.email, { reason: 'bad-password' });
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const claims = { sub: admin.id, email: admin.email, role: 'admin' };
  const accessToken = signAccess(claims);
  const refreshToken = signRefresh(claims);

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOpts);
  audit(req, 'login.success', 'admin', admin.email, {});
  res.json({ accessToken, admin: { email: admin.email } });
});

router.post('/refresh', (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ error: 'no refresh token' });
  try {
    const claims = verifyRefresh(token);
    const accessToken = signAccess({
      sub: claims.sub,
      email: claims.email,
      role: claims.role,
    });
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: 'invalid refresh token' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
});

module.exports = router;
