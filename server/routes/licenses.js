const express = require('express');
const Joi = require('joi');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { checkPermission } = require('../middleware/checkPermission');
const { audit } = require('../middleware/audit');
const { generateLicenseId } = require('../utils/ids');
const {
  generateLicenseKey,
  generateDongleFile,
} = require('../crypto/licenseEngine');

const router = express.Router();

const TIERS = ['TRIAL', 'BASIC', 'PRO', 'ENT', 'OEM'];
const DONGLES = ['SOFT', 'USB', 'CLOUD', 'NODE'];
const STATUS = ['active', 'revoked', 'expired'];

const generateSchema = Joi.object({
  customer_id: Joi.string().required(), // Primary Key OR display_code (resolved server-side)
  product_code: Joi.string().min(2).max(10).required(),
  product_name: Joi.string().max(120).allow('', null),
  tier: Joi.string()
    .valid(...TIERS)
    .required(),
  dongle_type: Joi.string()
    .valid(...DONGLES)
    .required(),
  hwid: Joi.string().max(120).default('ANY'),
  activation_limit: Joi.number().integer().min(1).max(10000).default(1),
  expires_at: Joi.alternatives()
    .try(Joi.string().isoDate(), Joi.string().valid('PERMANENT'))
    .default('PERMANENT'),
});

router.use(requireAuth);

// ─── LIST ────────────────────────────────────────────
router.get('/', checkPermission('licenses.view'), (req, res) => {
  const { customer_id, product_code, status } = req.query;
  const where = [];
  const params = [];
  if (customer_id) {
    // Allow filtering by primary id OR display_code
    const cust = db
      .prepare('SELECT id FROM customers WHERE id = ? OR display_code = ?')
      .get(customer_id, customer_id);
    if (cust) {
      where.push('l.customer_id = ?');
      params.push(cust.id);
    } else {
      return res.json([]);
    }
  }
  if (product_code) {
    where.push('l.product_code = ?');
    params.push(product_code);
  }
  if (status) {
    where.push('l.status = ?');
    params.push(status);
  }
  const sql = `
    SELECT l.*, c.display_code, c.name AS customer_name, c.company AS customer_company
    FROM licenses l
    JOIN customers c ON c.id = l.customer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY l.issued_at DESC
    LIMIT 1000`;
  res.json(db.prepare(sql).all(...params));
});

// ─── GET ONE ────────────────────────────────────────
router.get('/:id', checkPermission('licenses.view'), (req, res) => {
  const row = db
    .prepare(
      `SELECT l.*, c.display_code, c.name AS customer_name, c.company AS customer_company
       FROM licenses l JOIN customers c ON c.id = l.customer_id
       WHERE l.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// ─── GENERATE — binds to customer.id (Primary Key) ───
router.post('/generate', checkPermission('licenses.generate'), (req, res) => {
  const { error, value } = generateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  // Resolve customer — accept Primary Key OR display_code, store Primary Key only
  const customer = db
    .prepare('SELECT * FROM customers WHERE id = ? OR display_code = ?')
    .get(value.customer_id, value.customer_id);
  if (!customer) return res.status(404).json({ error: 'customer not found' });
  if (customer.status === 'inactive')
    return res.status(409).json({ error: 'customer is inactive' });

  const id = generateLicenseId();
  const { licenseKey, encryptedPayload } = generateLicenseKey(
    customer.id, // ← Primary Key, NEVER display_code
    value.product_code,
    value.tier,
    value.expires_at,
    value.hwid
  );

  db.prepare(
    `INSERT INTO licenses
      (id, customer_id, product_code, product_name, tier, dongle_type,
       license_key, encrypted_payload, hwid, activation_limit, activations, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active')`
  ).run(
    id,
    customer.id,
    value.product_code,
    value.product_name || null,
    value.tier,
    value.dongle_type,
    licenseKey,
    encryptedPayload,
    value.hwid || 'ANY',
    value.activation_limit,
    value.expires_at
  );

  audit(req, 'license.generate', 'license', id, {
    customer_primary_id: customer.id,
    customer_display_code: customer.display_code,
    tier: value.tier,
    product: value.product_code,
  });

  const row = db
    .prepare(
      `SELECT l.*, c.display_code, c.name AS customer_name
       FROM licenses l JOIN customers c ON c.id = l.customer_id WHERE l.id = ?`
    )
    .get(id);
  res.status(201).json(row);
});

// ─── REVOKE ──────────────────────────────────────────
router.post('/:id/revoke', checkPermission('licenses.revoke'), (req, res) => {
  const existing = db.prepare('SELECT id, status FROM licenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.status === 'revoked')
    return res.status(409).json({ error: 'already revoked' });
  db.prepare(`UPDATE licenses SET status = 'revoked' WHERE id = ?`).run(existing.id);
  audit(req, 'license.revoke', 'license', existing.id, {});
  res.json({ ok: true });
});

// ─── ACTIVATE — increments activations, enforces limit ──
router.post('/:id/activate', checkPermission('licenses.generate'), (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'not found' });
  if (lic.status !== 'active') return res.status(409).json({ error: `license is ${lic.status}` });
  if (lic.activations >= lic.activation_limit)
    return res.status(409).json({ error: 'activation limit reached' });
  db.prepare('UPDATE licenses SET activations = activations + 1 WHERE id = ?').run(lic.id);
  audit(req, 'license.activate', 'license', lic.id, {
    activations: lic.activations + 1,
    activation_limit: lic.activation_limit,
  });
  res.json({ ok: true, activations: lic.activations + 1, activation_limit: lic.activation_limit });
});

// ─── DONGLE FILE ─────────────────────────────────────
router.get('/:id/dongle', checkPermission('licenses.export'), (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${lic.id}.lic"`
  );
  res.send(JSON.stringify(generateDongleFile(lic), null, 2));
});

// ─── CSV EXPORT ──────────────────────────────────────
router.get('/export/csv', checkPermission('licenses.export'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.id, l.customer_id, c.display_code, c.name, c.company,
              l.product_code, l.tier, l.dongle_type, l.license_key,
              l.activations, l.activation_limit, l.expires_at, l.status, l.issued_at
       FROM licenses l JOIN customers c ON c.id = l.customer_id
       ORDER BY l.issued_at DESC`
    )
    .all();
  const header = [
    'license_id',
    'customer_primary_id',
    'customer_display_code',
    'customer_name',
    'company',
    'product',
    'tier',
    'dongle',
    'license_key',
    'activations',
    'activation_limit',
    'expires_at',
    'status',
    'issued_at',
  ];
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.customer_id,
        r.display_code,
        r.name,
        r.company,
        r.product_code,
        r.tier,
        r.dongle_type,
        r.license_key,
        r.activations,
        r.activation_limit,
        r.expires_at,
        r.status,
        r.issued_at,
      ]
        .map(escape)
        .join(',')
    );
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="licenses.csv"');
  res.send(lines.join('\n'));
});

module.exports = router;
