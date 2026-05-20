const db = require('../db');

const stmt = db.prepare(
  `INSERT INTO audit_log (action, entity_type, entity_id, details, ip_address, user_agent)
   VALUES (?, ?, ?, ?, ?, ?)`
);

function audit(req, action, entityType, entityId, details = {}) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '')
    .toString()
    .split(',')[0]
    .trim();
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 500);
  // Auto-stamp actor (employee performing the action). Caller-supplied actor_id wins
  // if they passed one explicitly — but normally we read it off req.user.
  const enriched = req.user?.sub
    ? { actor_id: req.user.sub, ...details }
    : details;
  stmt.run(
    action,
    entityType,
    entityId ? String(entityId) : null,
    JSON.stringify(enriched),
    ip,
    ua
  );
}

module.exports = { audit };
