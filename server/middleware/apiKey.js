const db = require('../db');
const { sha256 } = require('../utils/ids');

/**
 * Product verification middleware — checks X-API-Key header.
 * On success, attaches req.apiKey = { id, product_code, label }.
 */
function requireApiKey(req, res, next) {
  const presented = req.headers['x-api-key'];
  if (!presented) return res.status(401).json({ error: 'missing X-API-Key header' });
  const hash = sha256(presented);
  const row = db
    .prepare('SELECT id, product_code, label, active FROM api_keys WHERE key_hash = ?')
    .get(hash);
  if (!row || !row.active) return res.status(401).json({ error: 'invalid api key' });
  req.apiKey = row;
  next();
}

module.exports = { requireApiKey };
