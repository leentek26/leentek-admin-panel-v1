const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { checkPermission } = require('../middleware/checkPermission');

const router = express.Router();

router.use(requireAuth);

router.get('/', checkPermission('audit.view'), (req, res) => {
  const { action, entity_type, from, to } = req.query;
  const where = [];
  const params = [];
  if (action) {
    where.push('action LIKE ?');
    params.push(`${action}%`);
  }
  if (entity_type) {
    where.push('entity_type = ?');
    params.push(entity_type);
  }
  if (from) {
    where.push('timestamp >= ?');
    params.push(from);
  }
  if (to) {
    where.push('timestamp <= ?');
    params.push(to);
  }
  const sql =
    'SELECT * FROM audit_log' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY timestamp DESC LIMIT 1000';
  res.json(db.prepare(sql).all(...params));
});

// Dashboard stats — counts for everyone; recent activity only for audit.view holders.
router.get('/stats', (req, res) => {
  const customers = db.prepare("SELECT COUNT(*) AS c FROM customers WHERE status != 'inactive'").get().c;
  const licenses = db.prepare("SELECT COUNT(*) AS c FROM licenses WHERE status = 'active'").get().c;
  const revoked = db.prepare("SELECT COUNT(*) AS c FROM licenses WHERE status = 'revoked'").get().c;
  const apikeys = db.prepare("SELECT COUNT(*) AS c FROM api_keys WHERE active = 1").get().c;
  const byProduct = db
    .prepare(
      `SELECT product_code, COUNT(*) AS c FROM customers WHERE status != 'inactive' GROUP BY product_code`
    )
    .all();
  const byTier = db
    .prepare(`SELECT tier, COUNT(*) AS c FROM licenses WHERE status='active' GROUP BY tier`)
    .all();

  const canViewAudit =
    req.user?.role === 'role-superadmin' ||
    (req.user?.permissions || []).includes('audit.view');
  const recent = canViewAudit
    ? db.prepare(`SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 20`).all()
    : [];

  res.json({ customers, licenses, revoked, apikeys, byProduct, byTier, recent });
});

module.exports = router;
