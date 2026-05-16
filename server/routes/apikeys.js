const express = require('express');
const crypto = require('crypto');
const Joi = require('joi');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { sha256 } = require('../utils/ids');

const router = express.Router();

const createSchema = Joi.object({
  product_code: Joi.string().min(2).max(10).required(),
  label: Joi.string().max(120).allow('', null),
});

router.use(requireAuth);

router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      'SELECT id, product_code, label, active, created_at FROM api_keys ORDER BY created_at DESC'
    )
    .all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  // Plaintext is shown ONCE. Server stores only the SHA-256 hash.
  const plain = 'lk_' + crypto.randomBytes(24).toString('hex');
  const hash = sha256(plain);
  const result = db
    .prepare('INSERT INTO api_keys (key_hash, product_code, label, active) VALUES (?, ?, ?, 1)')
    .run(hash, value.product_code, value.label || null);

  audit(req, 'apikey.create', 'api_key', result.lastInsertRowid, {
    product_code: value.product_code,
    label: value.label || null,
  });

  res.status(201).json({
    id: result.lastInsertRowid,
    product_code: value.product_code,
    label: value.label || null,
    key: plain, // ← shown once, never persisted in plaintext
  });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('UPDATE api_keys SET active = 0 WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  audit(req, 'apikey.revoke', 'api_key', id, {});
  res.json({ ok: true });
});

module.exports = router;
