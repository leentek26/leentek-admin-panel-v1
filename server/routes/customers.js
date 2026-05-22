const express = require('express');
const Joi = require('joi');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { checkPermission, requireAdminRole } = require('../middleware/checkPermission');
const { audit } = require('../middleware/audit');
const { generatePrimaryId } = require('../utils/ids');
const {
  generateDisplayCode,
  regenerateDisplayCode,
} = require('../utils/displayCode');

const router = express.Router();

const PRODUCT_CODES = ['CNC', 'PLC', 'IOT', 'ERP', 'CAD', 'DRV'];
const STATUSES = ['active', 'pending', 'inactive', 'deleted'];

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

// ─── HARD DELETE ────────────────────────────────────────────────────────
// Single transaction, in order:
//   1. audit_log row written FIRST (full snapshot of blast radius)
//   2. product_units unassigned (customer_id → NULL, license_id → NULL, status → 'in_stock')
//   3. licenses deleted (FK customer_id is NOT NULL, so they can't survive)
//   4. customer row deleted
// Units must be unassigned BEFORE licenses are deleted so the
// product_units.license_id FK doesn't block the license delete.
router.delete('/:id', requireAdminRole, checkPermission('customers.delete'), (req, res) => {
  const existing = db
    .prepare('SELECT * FROM customers WHERE id = ? OR display_code = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  // Snapshot everything we're about to destroy so the audit row captures it.
  const licenseRows = db
    .prepare(
      `SELECT id, license_key, product_code, tier, status
         FROM licenses WHERE customer_id = ?`
    )
    .all(existing.id);
  const unitRows = db
    .prepare(
      `SELECT id, serial_number, serial_short, status, license_id
         FROM product_units WHERE customer_id = ?`
    )
    .all(existing.id);

  const unassignUnit = db.prepare(
    `UPDATE product_units
        SET customer_id = NULL,
            license_id = NULL,
            status = 'in_stock'
      WHERE id = ?`
  );
  const deleteLicense = db.prepare(`DELETE FROM licenses WHERE id = ?`);
  const deleteCustomer = db.prepare(`DELETE FROM customers WHERE id = ?`);

  const trx = db.transaction(() => {
    audit(req, 'customer.delete', 'customer', existing.id, {
      hard_delete: true,
      display_code: existing.display_code,
      name: existing.name,
      company: existing.company,
      email: existing.email,
      phone: existing.phone,
      country_code: existing.country_code,
      product_code: existing.product_code,
      status_before: existing.status,
      revoked_licenses: licenseRows.map((l) => ({
        id: l.id,
        license_key: l.license_key,
        product_code: l.product_code,
        tier: l.tier,
        status_before: l.status,
      })),
      unassigned_units: unitRows.map((u) => ({
        id: u.id,
        serial_number: u.serial_number,
        serial_short: u.serial_short,
        status_before: u.status,
        status_after: 'in_stock',
      })),
      revoked_count: licenseRows.length,
      unassigned_count: unitRows.length,
    });
    for (const u of unitRows) unassignUnit.run(u.id);
    for (const l of licenseRows) deleteLicense.run(l.id);
    deleteCustomer.run(existing.id);
  });
  trx();

  res.json({
    ok: true,
    customer_id: existing.id,
    revoked_license_ids: licenseRows.map((l) => l.id),
    unassigned_unit_serials: unitRows.map((u) => u.serial_number),
  });
});

module.exports = router;
