const express = require('express');
const crypto = require('crypto');
const Joi = require('joi');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { checkPermission } = require('../middleware/checkPermission');
const { audit } = require('../middleware/audit');

const router = express.Router();

const createSchema = Joi.object({
  name: Joi.string().min(1).max(80).required(),
  name_ar: Joi.string().min(1).max(80).required(),
  description: Joi.string().max(500).allow('', null),
  permission_ids: Joi.array().items(Joi.string()).default([]),
});

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(80),
  name_ar: Joi.string().min(1).max(80),
  description: Joi.string().max(500).allow('', null),
}).min(1);

const setPermsSchema = Joi.object({
  permission_ids: Joi.array().items(Joi.string()).required(),
});

function permsForRole(roleId) {
  return db
    .prepare(
      `SELECT p.id, p.code, p.name, p.name_ar, p.category, p.category_ar
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?
        ORDER BY p.category, p.code`
    )
    .all(roleId);
}

router.use(requireAuth);

// ─── LIST ────────────────────────────────────────────
router.get('/', checkPermission('roles.view'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.id) AS permission_count,
              (SELECT COUNT(*) FROM employees WHERE role_id = r.id) AS employee_count
         FROM roles r
        ORDER BY r.is_system DESC, r.name`
    )
    .all();
  res.json(rows);
});

// ─── LIST ALL PERMISSIONS (catalogue) ────────────────
router.get('/permissions/all', checkPermission('roles.view'), (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM permissions ORDER BY category, code')
    .all();
  res.json(rows);
});

// ─── GET ONE ─────────────────────────────────────────
router.get('/:id', checkPermission('roles.view'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'not found' });
  res.json({ ...role, permissions: permsForRole(role.id) });
});

// ─── CREATE ──────────────────────────────────────────
router.post('/', checkPermission('roles.manage'), (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const dup = db.prepare('SELECT id FROM roles WHERE name = ?').get(value.name);
  if (dup) return res.status(409).json({ error: 'role name already exists' });

  const id = 'role-' + crypto.randomBytes(4).toString('hex');
  const trx = db.transaction(() => {
    db.prepare(
      `INSERT INTO roles (id, name, name_ar, description, is_system) VALUES (?, ?, ?, ?, 0)`
    ).run(id, value.name, value.name_ar, value.description || null);
    const ins = db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
    );
    for (const pid of value.permission_ids) {
      const exists = db.prepare('SELECT id FROM permissions WHERE id = ?').get(pid);
      if (exists) ins.run(id, pid);
    }
  });
  trx();

  audit(req, 'role.create', 'role', id, { name: value.name });
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  res.status(201).json({ ...role, permissions: permsForRole(id) });
});

// ─── UPDATE ──────────────────────────────────────────
router.put('/:id', checkPermission('roles.manage'), (req, res) => {
  const { error, value } = updateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.is_system && value.name && value.name !== existing.name) {
    return res.status(403).json({ error: 'cannot rename a system role' });
  }

  const merged = { ...existing, ...value };
  db.prepare(
    `UPDATE roles SET name = ?, name_ar = ?, description = ? WHERE id = ?`
  ).run(merged.name, merged.name_ar, merged.description, existing.id);

  audit(req, 'role.update', 'role', existing.id, { changed: Object.keys(value) });
  res.json(db.prepare('SELECT * FROM roles WHERE id = ?').get(existing.id));
});

// ─── DELETE ──────────────────────────────────────────
router.delete('/:id', checkPermission('roles.manage'), (req, res) => {
  const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.is_system) return res.status(403).json({ error: 'cannot delete a system role' });
  const inUse = db
    .prepare('SELECT COUNT(*) AS c FROM employees WHERE role_id = ?')
    .get(existing.id).c;
  if (inUse > 0)
    return res
      .status(409)
      .json({ error: `role is assigned to ${inUse} employee(s) — reassign first` });

  db.prepare('DELETE FROM roles WHERE id = ?').run(existing.id);
  audit(req, 'role.delete', 'role', existing.id, {});
  res.json({ ok: true });
});

// ─── REPLACE PERMISSIONS ─────────────────────────────
router.put('/:id/permissions', checkPermission('roles.manage'), (req, res) => {
  const { error, value } = setPermsSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  // Don't allow stripping the Super Admin's permissions
  if (existing.id === 'role-superadmin') {
    return res
      .status(403)
      .json({ error: 'Super Admin permissions are immutable' });
  }

  const trx = db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(existing.id);
    const ins = db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
    );
    for (const pid of value.permission_ids) {
      const exists = db.prepare('SELECT id FROM permissions WHERE id = ?').get(pid);
      if (exists) ins.run(existing.id, pid);
    }
  });
  trx();

  audit(req, 'role.permissions.update', 'role', existing.id, {
    count: value.permission_ids.length,
  });
  res.json({ ok: true, permissions: permsForRole(existing.id) });
});

module.exports = router;
