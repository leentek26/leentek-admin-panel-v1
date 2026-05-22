const express = require('express');
const Joi = require('joi');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { generateSerialNumber } = require('../utils/serialEngine');

const router = express.Router();

router.use(requireAuth);

const generateSchema = Joi.object({
  product_id: Joi.string().required(),
  batch_id: Joi.string().max(80).allow('', null),
  notes: Joi.string().max(500).allow('', null),
});

const batchSchema = generateSchema.keys({
  count: Joi.number().integer().min(1).max(1000).required(),
});

function resolveProduct(idOrCode) {
  return db
    .prepare('SELECT * FROM products WHERE id = ? OR code = ?')
    .get(idOrCode, idOrCode);
}

function unitId() {
  return 'UNIT-' + crypto.randomBytes(6).toString('hex');
}

function warrantyEnd(months) {
  const m = Number(months);
  if (!m) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d.toISOString();
}

const insertUnit = db.prepare(
  `INSERT INTO product_units
     (id, serial_number, serial_short, product_id, batch_id, seq_num,
      status, manufactured_at, warranty_until, notes)
   VALUES (?, ?, ?, ?, ?, ?, 'manufactured', CURRENT_TIMESTAMP, ?, ?)`
);

// ─── LIST units (filter by product / status / batch) ──
router.get('/', (req, res) => {
  const { product_id, status, batch_id, limit } = req.query;
  const where = [];
  const params = [];
  if (product_id) {
    const p = resolveProduct(product_id);
    if (!p) return res.json([]);
    where.push('u.product_id = ?');
    params.push(p.id);
  }
  if (status) {
    where.push('u.status = ?');
    params.push(status);
  }
  if (batch_id) {
    where.push('u.batch_id = ?');
    params.push(batch_id);
  }
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const sql = `
    SELECT u.*,
           p.code AS product_code, p.name AS product_name, p.type AS product_type,
           c.name AS customer_name, c.company AS customer_company,
           c.display_code AS customer_display_code
    FROM product_units u
    JOIN products p ON p.id = u.product_id
    LEFT JOIN customers c ON c.id = u.customer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY u.manufactured_at DESC, u.id DESC
    LIMIT ${cap}`;
  res.json(db.prepare(sql).all(...params));
});

// ─── STATUS COUNTS — used by the inventory tabs (declared before `/:id`) ──
router.get('/status-counts', (req, res) => {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS count FROM product_units GROUP BY status')
    .all();
  const total = rows.reduce((n, r) => n + r.count, 0);
  const out = { total };
  for (const r of rows) out[r.status] = r.count;
  res.json(out);
});

// ─── DETAIL — single unit + linked product/customer/license + verification log ───
router.get('/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT u.*,
              p.code AS product_code, p.name AS product_name, p.name_ar AS product_name_ar,
              p.type AS product_type, p.version AS product_version,
              p.manufacturer_prefix, p.warranty_months,
              c.name AS customer_name, c.company AS customer_company,
              c.email AS customer_email, c.country_code AS customer_country,
              c.display_code AS customer_display_code,
              l.license_key, l.tier AS license_tier, l.dongle_type AS license_dongle,
              l.status AS license_status, l.expires_at AS license_expires_at,
              l.activations AS license_activations, l.activation_limit AS license_activation_limit
       FROM product_units u
       JOIN products p ON p.id = u.product_id
       LEFT JOIN customers c ON c.id = u.customer_id
       LEFT JOIN licenses  l ON l.id = u.license_id
       WHERE u.id = ? OR u.serial_number = ?`
    )
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const verifications = db
    .prepare(
      `SELECT id, result, ip_address, hwid, location, verified_at, details
       FROM serial_verifications
       WHERE unit_id = ? OR serial_number = ?
       ORDER BY verified_at DESC
       LIMIT 25`
    )
    .all(row.id, row.serial_number);

  const verificationSummary = db
    .prepare(
      `SELECT result, COUNT(*) AS count
       FROM serial_verifications
       WHERE unit_id = ? OR serial_number = ?
       GROUP BY result`
    )
    .all(row.id, row.serial_number);

  res.json({ ...row, verifications, verification_summary: verificationSummary });
});

// ─── UPDATE — status transitions + assignment + metadata ───
const UNIT_STATUSES = [
  'manufactured', 'in_stock', 'reserved', 'sold',
  'activated', 'returned', 'defective', 'retired',
];

const unitUpdateSchema = Joi.object({
  status: Joi.string().valid(...UNIT_STATUSES),
  customer_id: Joi.string().allow(null),
  license_id: Joi.string().allow(null),
  batch_id: Joi.string().max(80).allow('', null),
  hwid: Joi.string().max(120).allow('', null),
  firmware_version: Joi.string().max(80).allow('', null),
  location: Joi.string().max(120).allow('', null),
  notes: Joi.string().max(2000).allow('', null),
}).min(1);

router.put('/:id', (req, res) => {
  const { error, value } = unitUpdateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const existing = db
    .prepare('SELECT * FROM product_units WHERE id = ? OR serial_number = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  // Validate FK targets when assignment is being changed.
  if (value.customer_id) {
    const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(value.customer_id);
    if (!c) return res.status(400).json({ error: 'customer_id does not exist' });
  }
  if (value.license_id) {
    const l = db.prepare('SELECT id FROM licenses WHERE id = ?').get(value.license_id);
    if (!l) return res.status(400).json({ error: 'license_id does not exist' });
  }

  // Auto-stamp lifecycle dates on status transitions.
  const patch = { ...value };
  if (value.status === 'sold' && !existing.sold_at) {
    patch.sold_at = new Date().toISOString();
  }
  if (value.status === 'activated' && !existing.activated_at) {
    patch.activated_at = new Date().toISOString();
  }

  const fields = [
    'status', 'customer_id', 'license_id', 'batch_id',
    'hwid', 'firmware_version', 'location', 'notes',
    'sold_at', 'activated_at',
  ];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (patch[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(patch[f] === '' ? null : patch[f]);
    }
  }
  if (sets.length === 0) return res.json(existing);
  params.push(existing.id);
  db.prepare(`UPDATE product_units SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const updated = db
    .prepare('SELECT * FROM product_units WHERE id = ?')
    .get(existing.id);

  audit(req, 'unit.update', 'unit', existing.id, {
    serial_number: existing.serial_number,
    changed: Object.keys(value),
    status_before: existing.status,
    status_after: updated.status,
    customer_id_before: existing.customer_id,
    customer_id_after: updated.customer_id,
    license_id_before: existing.license_id,
    license_id_after: updated.license_id,
  });
  res.json(updated);
});

// ─── GENERATE single ─────────────────────────────────
router.post('/generate', (req, res) => {
  const { error, value } = generateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const product = resolveProduct(value.product_id);
  if (!product) return res.status(404).json({ error: 'product not found' });
  if (product.status === 'discontinued')
    return res.status(409).json({ error: 'cannot generate serials for a discontinued product' });

  const id = unitId();
  const warranty = warrantyEnd(product.warranty_months);

  // Counter bump + unit insert must be atomic — a failed insert must not
  // burn a sequence number.
  let serial;
  db.transaction(() => {
    serial = generateSerialNumber(db, product);
    insertUnit.run(
      id,
      serial.full,
      serial.short,
      product.id,
      value.batch_id || null,
      serial.seq,
      warranty,
      value.notes || null
    );
  })();

  audit(req, 'unit.generate', 'unit', id, {
    product_code: product.code,
    serial_number: serial.full,
    batch_id: value.batch_id || null,
  });

  res.status(201).json({
    id,
    serial_number: serial.full,
    serial_short: serial.short,
    product_id: product.id,
    product_code: product.code,
    product_name: product.name,
    product_type: product.type,
    status: 'manufactured',
    batch_id: value.batch_id || null,
    warranty_until: warranty,
  });
});

// ─── GENERATE batch ──────────────────────────────────
router.post('/generate-batch', (req, res) => {
  const { error, value } = batchSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const product = resolveProduct(value.product_id);
  if (!product) return res.status(404).json({ error: 'product not found' });
  if (product.status === 'discontinued')
    return res.status(409).json({ error: 'cannot generate serials for a discontinued product' });

  const warranty = warrantyEnd(product.warranty_months);
  const results = [];
  const trx = db.transaction(() => {
    for (let i = 0; i < value.count; i++) {
      const serial = generateSerialNumber(db, product);
      const id = unitId();
      insertUnit.run(
        id,
        serial.full,
        serial.short,
        product.id,
        value.batch_id || null,
        serial.seq,
        warranty,
        value.notes || null
      );
      results.push({
        id,
        serial_number: serial.full,
        serial_short: serial.short,
        seq_num: serial.seq,
      });
    }
  });
  trx();

  audit(req, 'unit.generate-batch', 'product', product.id, {
    product_code: product.code,
    count: value.count,
    batch_id: value.batch_id || null,
    first_serial: results[0]?.serial_number,
    last_serial: results[results.length - 1]?.serial_number,
  });

  res.status(201).json({
    product_id: product.id,
    product_code: product.code,
    product_name: product.name,
    batch_id: value.batch_id || null,
    count: results.length,
    warranty_until: warranty,
    units: results,
  });
});

module.exports = router;
