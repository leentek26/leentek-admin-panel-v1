const express = require('express');
const Joi = require('joi');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { checkPermission } = require('../middleware/checkPermission');
const { audit } = require('../middleware/audit');
const { generatePrimaryId } = require('../utils/ids');
const {
  generateDisplayCode,
  regenerateDisplayCode,
} = require('../utils/displayCode');

const router = express.Router();

const PRODUCT_CODES = ['CNC', 'PLC', 'IOT', 'ERP', 'CAD', 'DRV'];
const STATUSES = ['active', 'pending', 'inactive'];

const createSchema = Joi.object({
  name: Joi.string().min(1).max(120).required(),
  company: Joi.string().min(1).max(160).required(),
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  phone: Joi.string().min(3).max(40).required(),
  country_code: Joi.string()
    .length(2)
    .uppercase()
    .pattern(/^[A-Z]{2}$/)
    .required(),
  product_code: Joi.string()
    .valid(...PRODUCT_CODES)
    .required(),
  city: Joi.string().max(120).allow('', null),
  status: Joi.string()
    .valid(...STATUSES)
    .default('active'),
});

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(120),
  company: Joi.string().min(1).max(160),
  email: Joi.string().email({ tlds: { allow: false } }),
  phone: Joi.string().min(3).max(40),
  country_code: Joi.string()
    .length(2)
    .uppercase()
    .pattern(/^[A-Z]{2}$/),
  product_code: Joi.string().valid(...PRODUCT_CODES),
  city: Joi.string().max(120).allow('', null),
  status: Joi.string().valid(...STATUSES),
}).min(1);

router.use(requireAuth);

// ─── LIST ────────────────────────────────────────────
router.get('/', checkPermission('customers.view'), (req, res) => {
  const { search, status, product_code, country_code } = req.query;
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (product_code) {
    where.push('product_code = ?');
    params.push(product_code);
  }
  if (country_code) {
    where.push('country_code = ?');
    params.push(country_code.toUpperCase());
  }
  if (search) {
    where.push(
      '(name LIKE ? OR company LIKE ? OR email LIKE ? OR display_code LIKE ? OR id LIKE ?)'
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  const sql =
    'SELECT * FROM customers' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY created_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// ─── GET ONE (by primary id OR display_code) ─────────
router.get('/:id', checkPermission('customers.view'), (req, res) => {
  const { id } = req.params;
  const row = db
    .prepare('SELECT * FROM customers WHERE id = ? OR display_code = ?')
    .get(id, id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// ─── CREATE ─────────────────────────────────────────
router.post('/', checkPermission('customers.create'), (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const existingEmail = db
    .prepare('SELECT id FROM customers WHERE email = ?')
    .get(value.email);
  if (existingEmail)
    return res.status(409).json({ error: 'email already registered' });

  const trx = db.transaction((c) => {
    const { displayCode, seqNum } = generateDisplayCode(
      db,
      c.country_code,
      c.product_code
    );
    const id = generatePrimaryId('CUS');
    db.prepare(
      `INSERT INTO customers
       (id, display_code, seq_num, name, company, email, phone, country_code, product_code, city, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      displayCode,
      seqNum,
      c.name,
      c.company,
      c.email,
      c.phone,
      c.country_code,
      c.product_code,
      c.city || null,
      c.status || 'active'
    );
    return { id, displayCode, seqNum };
  });

  const result = trx(value);
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.id);
  audit(req, 'customer.create', 'customer', result.id, {
    display_code: result.displayCode,
  });
  res.status(201).json(row);
});

// ─── UPDATE — regenerates display_code if country/product changed ───
router.put('/:id', checkPermission('customers.edit'), (req, res) => {
  const { error, value } = updateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const existing = db
    .prepare('SELECT * FROM customers WHERE id = ? OR display_code = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const merged = { ...existing, ...value };
  const countryChanged =
    value.country_code && value.country_code !== existing.country_code;
  const productChanged =
    value.product_code && value.product_code !== existing.product_code;

  // If product changed, seq_num must be re-issued from the new category
  if (productChanged) {
    const next = db
      .prepare(
        'SELECT COALESCE(MAX(seq_num),0)+1 AS next FROM customers WHERE product_code = ?'
      )
      .get(merged.product_code).next;
    merged.seq_num = next;
  }

  let newDisplay = existing.display_code;
  if (countryChanged || productChanged) {
    newDisplay = regenerateDisplayCode(merged);
  }

  db.prepare(
    `UPDATE customers SET
       name = ?, company = ?, email = ?, phone = ?,
       country_code = ?, product_code = ?, city = ?, status = ?,
       display_code = ?, seq_num = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    merged.name,
    merged.company,
    merged.email,
    merged.phone,
    merged.country_code,
    merged.product_code,
    merged.city,
    merged.status,
    newDisplay,
    merged.seq_num,
    existing.id
  );

  audit(req, 'customer.update', 'customer', existing.id, {
    changed: Object.keys(value),
    display_code_regenerated: newDisplay !== existing.display_code,
    old_display_code: existing.display_code,
    new_display_code: newDisplay,
  });

  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(existing.id));
});

// ─── SOFT DELETE ──────────────────────────────────────
router.delete('/:id', checkPermission('customers.delete'), (req, res) => {
  const existing = db
    .prepare('SELECT id FROM customers WHERE id = ? OR display_code = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.prepare(
    `UPDATE customers SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(existing.id);
  audit(req, 'customer.delete', 'customer', existing.id, {});
  res.json({ ok: true });
});

module.exports = router;
