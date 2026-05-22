const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const Joi = require('joi');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { checkPermission, requireAdminRole } = require('../middleware/checkPermission');
const { audit } = require('../middleware/audit');

const router = express.Router();

const passwordRule = Joi.string()
  .min(8)
  .max(200)
  .pattern(/[A-Z]/, 'uppercase')
  .pattern(/[a-z]/, 'lowercase')
  .pattern(/[0-9]/, 'number');

const createSchema = Joi.object({
  name: Joi.string().min(1).max(120).required(),
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  phone: Joi.string().max(40).allow('', null),
  password: passwordRule.required(),
  role_id: Joi.string().required(),
  department: Joi.string().max(120).allow('', null),
  status: Joi.string().valid('active', 'suspended', 'inactive').default('active'),
});

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(120),
  email: Joi.string().email({ tlds: { allow: false } }),
  phone: Joi.string().max(40).allow('', null),
  role_id: Joi.string(),
  department: Joi.string().max(120).allow('', null),
  status: Joi.string().valid('active', 'suspended', 'inactive'),
}).min(1);

const resetPasswordSchema = Joi.object({
  new_password: passwordRule.required(),
});

function nextEmployeeCode() {
  const row = db
    .prepare(
      `SELECT employee_code FROM employees
        WHERE employee_code LIKE 'EMP-%'
        ORDER BY employee_code DESC LIMIT 1`
    )
    .get();
  const last = row ? parseInt(row.employee_code.split('-')[1], 10) : 0;
  return 'EMP-' + String(last + 1).padStart(4, '0');
}

function roleLevelOf(roleId) {
  return db.prepare('SELECT role_level FROM roles WHERE id = ?').get(roleId)?.role_level ?? 0;
}

function loadEmployeeRow(id) {
  return db
    .prepare(
      `SELECT e.id, e.employee_code, e.name, e.email, e.phone, e.role_id,
              e.department, e.status, e.last_login, e.created_at, e.updated_at,
              r.name AS role_name, r.name_ar AS role_name_ar,
              r.is_system AS role_is_system, r.role_level AS role_level
         FROM employees e
         LEFT JOIN roles r ON r.id = e.role_id
        WHERE e.id = ?`
    )
    .get(id);
}

router.use(requireAuth);

// ─── LIST ────────────────────────────────────────────
router.get('/', checkPermission('employees.view'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT e.id, e.employee_code, e.name, e.email, e.phone, e.role_id,
              e.department, e.status, e.last_login, e.created_at,
              r.name AS role_name, r.name_ar AS role_name_ar, r.role_level AS role_level
         FROM employees e
         LEFT JOIN roles r ON r.id = e.role_id
        ORDER BY e.created_at DESC`
    )
    .all();
  res.json(rows);
});

// ─── GET ONE ─────────────────────────────────────────
router.get('/:id', checkPermission('employees.view'), (req, res) => {
  const row = loadEmployeeRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// ─── CREATE ──────────────────────────────────────────
router.post('/', checkPermission('employees.create'), (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const role = db.prepare('SELECT id, role_level FROM roles WHERE id = ?').get(value.role_id);
  if (!role) return res.status(400).json({ error: 'invalid role_id' });

  // Cannot create an employee with a role at your level or above.
  if (role.role_level >= req.user.role_level) {
    return res.status(403).json({
      error: 'cannot assign a role equal to or higher than your own',
    });
  }

  const dup = db.prepare('SELECT id FROM employees WHERE email = ?').get(value.email);
  if (dup) return res.status(409).json({ error: 'email already in use' });

  const id = 'EMP-' + crypto.randomBytes(6).toString('hex');
  const code = nextEmployeeCode();
  const hash = bcrypt.hashSync(value.password, 12);

  db.prepare(
    `INSERT INTO employees
       (id, employee_code, name, email, phone, password_hash, role_id, department, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    code,
    value.name,
    value.email,
    value.phone || null,
    hash,
    value.role_id,
    value.department || null,
    value.status,
    req.user.sub
  );

  audit(req, 'employee.create', 'employee', id, {
    employee_code: code,
    role_id: value.role_id,
  });

  res.status(201).json(loadEmployeeRow(id));
});

// ─── UPDATE ──────────────────────────────────────────
router.put('/:id', checkPermission('employees.edit'), (req, res) => {
  const { error, value } = updateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const targetLevel = roleLevelOf(existing.role_id);
  // Cannot edit anyone at your level or above (this includes Super Admin and yourself).
  if (targetLevel >= req.user.role_level) {
    return res.status(403).json({
      error: 'cannot edit a user at your level or above',
    });
  }

  // Cannot promote into a role >= your own level.
  if (value.role_id) {
    const role = db.prepare('SELECT id, role_level FROM roles WHERE id = ?').get(value.role_id);
    if (!role) return res.status(400).json({ error: 'invalid role_id' });
    if (role.role_level >= req.user.role_level) {
      return res
        .status(403)
        .json({ error: 'cannot assign a role equal to or higher than your own' });
    }
  }

  if (value.email && value.email !== existing.email) {
    const dup = db
      .prepare('SELECT id FROM employees WHERE email = ? AND id != ?')
      .get(value.email, existing.id);
    if (dup) return res.status(409).json({ error: 'email already in use' });
  }

  const merged = { ...existing, ...value };
  db.prepare(
    `UPDATE employees SET
       name = ?, email = ?, phone = ?, role_id = ?, department = ?, status = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    merged.name,
    merged.email,
    merged.phone,
    merged.role_id,
    merged.department,
    merged.status,
    existing.id
  );

  audit(req, 'employee.update', 'employee', existing.id, {
    changed: Object.keys(value),
  });
  res.json(loadEmployeeRow(existing.id));
});

// ─── SUSPEND ─────────────────────────────────────────
router.post('/:id/suspend', checkPermission('employees.delete'), (req, res) => {
  const existing = db
    .prepare('SELECT id, role_id FROM employees WHERE id = ?')
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.id === req.user.sub) return res.status(403).json({ error: 'cannot suspend yourself' });
  if (roleLevelOf(existing.role_id) >= req.user.role_level) {
    return res.status(403).json({ error: 'cannot suspend a user at your level or above' });
  }

  db.prepare(`UPDATE employees SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(existing.id);
  db.prepare('DELETE FROM employee_sessions WHERE employee_id = ?').run(existing.id);
  audit(req, 'employee.suspend', 'employee', existing.id, {});
  res.json({ ok: true });
});

// ─── ACTIVATE ────────────────────────────────────────
router.post('/:id/activate', checkPermission('employees.delete'), (req, res) => {
  const existing = db
    .prepare('SELECT id, role_id FROM employees WHERE id = ?')
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (roleLevelOf(existing.role_id) >= req.user.role_level) {
    return res.status(403).json({ error: 'cannot activate a user at your level or above' });
  }
  db.prepare(
    `UPDATE employees SET status = 'active', login_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(existing.id);
  audit(req, 'employee.activate', 'employee', existing.id, {});
  res.json({ ok: true });
});

// ─── HARD DELETE ─────────────────────────────────────
// Restrictions:
//   • requires Admin / Super Admin role (on top of employees.delete perm)
//   • cannot delete yourself
//   • cannot delete anyone at your level or above (so Super Admin is always protected)
// Audit row is written first, inside the same transaction, so the record
// captures the full snapshot even if a later step fails and rolls back.
router.delete('/:id', requireAdminRole, checkPermission('employees.delete'), (req, res) => {
  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.id === req.user.sub) return res.status(403).json({ error: 'cannot delete yourself' });
  if (roleLevelOf(existing.role_id) >= req.user.role_level) {
    return res.status(403).json({ error: 'cannot delete a user at your level or above' });
  }

  // employee_sessions has FK ON DELETE CASCADE — explicit deletes kept for clarity.
  const trx = db.transaction(() => {
    audit(req, 'employee.delete', 'employee', existing.id, {
      hard_delete: true,
      employee_code: existing.employee_code,
      name: existing.name,
      email: existing.email,
      phone: existing.phone,
      role_id: existing.role_id,
      department: existing.department,
      status_before: existing.status,
      created_at: existing.created_at,
    });
    db.prepare('DELETE FROM employee_sessions WHERE employee_id = ?').run(existing.id);
    db.prepare('DELETE FROM employees WHERE id = ?').run(existing.id);
  });
  trx();

  res.json({ ok: true });
});

// ─── RESET PASSWORD ──────────────────────────────────
router.post('/:id/reset-password', checkPermission('employees.edit'), (req, res) => {
  const { error, value } = resetPasswordSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const existing = db
    .prepare('SELECT id, role_id FROM employees WHERE id = ?')
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (roleLevelOf(existing.role_id) >= req.user.role_level) {
    return res
      .status(403)
      .json({ error: 'cannot reset password of a user at your level or above' });
  }

  const hash = bcrypt.hashSync(value.new_password, 12);
  db.prepare(
    `UPDATE employees SET password_hash = ?, login_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(hash, existing.id);
  // Password reset invalidates all sessions for the target employee.
  db.prepare('DELETE FROM employee_sessions WHERE employee_id = ?').run(existing.id);
  audit(req, 'employee.password_reset', 'employee', existing.id, {});
  res.json({ ok: true });
});

module.exports = router;
