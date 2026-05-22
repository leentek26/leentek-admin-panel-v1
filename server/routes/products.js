const express = require('express');
const Joi = require('joi');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { checkPermission, requireAdminRole } = require('../middleware/checkPermission');
const { audit } = require('../middleware/audit');

const router = express.Router();

router.use(requireAuth);

const TYPES = ['HARDWARE', 'SOFTWARE', 'HYBRID'];
const STATUSES = ['active', 'discontinued', 'development'];

const productSchema = Joi.object({
  code: Joi.string().trim().min(2).max(8).pattern(/^[A-Z0-9]+$/).required(),
  name: Joi.string().trim().min(2).max(120).required(),
  name_ar: Joi.string().trim().max(120).allow('', null),
  type: Joi.string().valid(...TYPES).required(),
  category: Joi.string().trim().min(2).max(80).required(),
  category_ar: Joi.string().trim().max(80).allow('', null),
  description: Joi.string().max(2000).allow('', null),
  description_ar: Joi.string().max(2000).allow('', null),
  version: Joi.string().max(20).allow('', null),
  manufacturer_prefix: Joi.string().uppercase().min(2).max(4).default('LT'),
  warranty_months: Joi.number().integer().min(0).max(120).default(12),
  has_license: Joi.boolean().truthy(1).falsy(0).default(true),
  status: Joi.string().valid(...STATUSES).default('active'),
  image_url: Joi.string().uri().allow('', null),
});

// PUT accepts the same fields but all optional.
const productUpdateSchema = productSchema.fork(
  Object.keys(productSchema.describe().keys),
  (s) => s.optional()
);

// ─── LIST ────────────────────────────────────────────
router.get('/', (req, res) => {
  const { status } = req.query;
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const sql = `
    SELECT id, code, name, name_ar, type, category, category_ar,
           description, description_ar, version, manufacturer_prefix,
           warranty_months, has_license, status, image_url,
           created_at, updated_at
    FROM products
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY code ASC`;
  res.json(db.prepare(sql).all(...params));
});

// ─── GET ONE ─────────────────────────────────────────
router.get('/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM products WHERE id = ? OR code = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// ─── CREATE ──────────────────────────────────────────
router.post('/', (req, res) => {
  const { error, value } = productSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const existing = db.prepare('SELECT id FROM products WHERE code = ?').get(value.code);
  if (existing) return res.status(409).json({ error: `product code "${value.code}" already exists` });

  const id = 'PRD-' + crypto.randomBytes(6).toString('hex');
  db.prepare(
    `INSERT INTO products
       (id, code, name, name_ar, type, category, category_ar,
        description, description_ar, version, manufacturer_prefix,
        warranty_months, has_license, status, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    value.code,
    value.name,
    value.name_ar || null,
    value.type,
    value.category,
    value.category_ar || null,
    value.description || null,
    value.description_ar || null,
    value.version || '1.0',
    value.manufacturer_prefix || 'LT',
    value.warranty_months,
    value.has_license ? 1 : 0,
    value.status,
    value.image_url || null
  );

  audit(req, 'product.create', 'product', id, { code: value.code, name: value.name });
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

// ─── UPDATE ──────────────────────────────────────────
router.put('/:id', (req, res) => {
  const { error, value } = productUpdateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const existing = db
    .prepare('SELECT * FROM products WHERE id = ? OR code = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  if (value.code && value.code !== existing.code) {
    const clash = db
      .prepare('SELECT id FROM products WHERE code = ? AND id != ?')
      .get(value.code, existing.id);
    if (clash) return res.status(409).json({ error: `product code "${value.code}" already exists` });
  }

  const fields = [
    'code', 'name', 'name_ar', 'type', 'category', 'category_ar',
    'description', 'description_ar', 'version', 'manufacturer_prefix',
    'warranty_months', 'status', 'image_url',
  ];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (value[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(value[f] === '' ? null : value[f]);
    }
  }
  if (value.has_license !== undefined) {
    sets.push('has_license = ?');
    params.push(value.has_license ? 1 : 0);
  }
  if (sets.length === 0) return res.json(existing);

  sets.push("updated_at = CURRENT_TIMESTAMP");
  params.push(existing.id);
  db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id);
  audit(req, 'product.update', 'product', existing.id, {
    code_before: existing.code,
    code_after: updated.code,
    status_before: existing.status,
    status_after: updated.status,
  });
  res.json(updated);
});

// ─── DELETE — HARD delete when no units exist; otherwise 409 ───
// If product has zero product_units rows: row is removed entirely (audit logged
// first inside the same txn). If units exist: returns 409 with {unit_count} so
// the UI can offer "Discontinue instead" (PUT status='discontinued').
// Destructive: requires Admin / Super Admin role + products.manage perm.
router.delete('/:id', requireAdminRole, checkPermission('products.manage'), (req, res) => {
  const existing = db
    .prepare('SELECT * FROM products WHERE id = ? OR code = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const unitCount = db
    .prepare('SELECT COUNT(*) AS c FROM product_units WHERE product_id = ?')
    .get(existing.id).c;

  if (unitCount > 0) {
    return res.status(409).json({
      error: `Cannot delete: this product has ${unitCount} unit${unitCount === 1 ? '' : 's'}. Discontinue instead?`,
      reason: 'units_exist',
      unit_count: unitCount,
      product_id: existing.id,
      product_code: existing.code,
    });
  }

  // No units — safe to hard-delete. licenses.product_code is a plain TEXT
  // column (not a real FK to products), so we snapshot any orphaned licenses
  // for the audit row but leave them in place.
  const orphanLicenses = db
    .prepare(
      `SELECT id, license_key, tier, status, customer_id
         FROM licenses WHERE product_code = ?`
    )
    .all(existing.code);

  const deleteProduct = db.prepare('DELETE FROM products WHERE id = ?');

  const trx = db.transaction(() => {
    audit(req, 'product.delete', 'product', existing.id, {
      hard_delete: true,
      code: existing.code,
      name: existing.name,
      type: existing.type,
      category: existing.category,
      status_before: existing.status,
      orphan_licenses: orphanLicenses.map((l) => ({
        id: l.id,
        license_key: l.license_key,
        tier: l.tier,
        status: l.status,
        customer_id: l.customer_id,
      })),
      orphan_license_count: orphanLicenses.length,
    });
    deleteProduct.run(existing.id);
  });
  trx();

  res.json({ ok: true, product_id: existing.id, product_code: existing.code });
});

module.exports = router;
