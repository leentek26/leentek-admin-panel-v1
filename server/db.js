const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const logger = require('./utils/logger');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'data', 'license.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  display_code TEXT UNIQUE NOT NULL,
  seq_num INTEGER NOT NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  country_code TEXT NOT NULL,
  product_code TEXT NOT NULL,
  city TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','pending','inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_code TEXT NOT NULL,
  product_name TEXT,
  tier TEXT NOT NULL CHECK(tier IN ('TRIAL','BASIC','PRO','ENT','OEM')),
  dongle_type TEXT NOT NULL CHECK(dongle_type IN ('SOFT','USB','CLOUD','NODE')),
  license_key TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  hwid TEXT DEFAULT 'ANY',
  activation_limit INTEGER DEFAULT 1,
  activations INTEGER DEFAULT 0,
  expires_at TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  issued_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL,
  product_code TEXT NOT NULL,
  label TEXT,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  description TEXT,
  is_system INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  category TEXT NOT NULL,
  category_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  employee_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role_id TEXT REFERENCES roles(id),
  department TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','inactive')),
  last_login DATETIME,
  login_attempts INTEGER DEFAULT 0,
  locked_until DATETIME,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_sessions (
  id TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_display ON customers(display_code);
CREATE INDEX IF NOT EXISTS idx_customers_product ON customers(product_code);
CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(country_code);
CREATE INDEX IF NOT EXISTS idx_licenses_customer ON licenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_sessions_employee ON employee_sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON employee_sessions(expires_at);
`;

db.exec(SCHEMA);

// ─── RBAC seed: roles ─────────────────────────────────
const ROLE_SEEDS = [
  ['role-superadmin', 'Super Admin', 'مدير عام', 'Full unrestricted access to all features', 1],
  ['role-admin', 'Admin', 'مدير', 'Manage customers, licenses, and employees', 1],
  ['role-license-mgr', 'License Manager', 'مدير تراخيص', 'Generate, revoke, and verify licenses only', 1],
  ['role-support', 'Support', 'دعم فني', 'View customers and verify licenses only', 1],
  ['role-viewer', 'Viewer', 'مشاهد', 'View dashboard and reports only', 1],
];

// ─── RBAC seed: permissions ───────────────────────────
const PERMISSION_SEEDS = [
  ['p-cust-view', 'customers.view', 'View Customers', 'عرض العملاء', 'Customers', 'العملاء'],
  ['p-cust-create', 'customers.create', 'Create Customers', 'إضافة عملاء', 'Customers', 'العملاء'],
  ['p-cust-edit', 'customers.edit', 'Edit Customers', 'تعديل عملاء', 'Customers', 'العملاء'],
  ['p-cust-delete', 'customers.delete', 'Delete Customers', 'حذف عملاء', 'Customers', 'العملاء'],
  ['p-lic-view', 'licenses.view', 'View Licenses', 'عرض التراخيص', 'Licenses', 'التراخيص'],
  ['p-lic-generate', 'licenses.generate', 'Generate Licenses', 'إنشاء تراخيص', 'Licenses', 'التراخيص'],
  ['p-lic-revoke', 'licenses.revoke', 'Revoke Licenses', 'إلغاء تراخيص', 'Licenses', 'التراخيص'],
  ['p-lic-export', 'licenses.export', 'Export Licenses', 'تصدير تراخيص', 'Licenses', 'التراخيص'],
  ['p-verify', 'verify.check', 'Verify License Keys', 'التحقق من الرخص', 'Verification', 'التحقق'],
  ['p-emp-view', 'employees.view', 'View Employees', 'عرض الموظفين', 'Employees', 'الموظفين'],
  ['p-emp-create', 'employees.create', 'Create Employees', 'إضافة موظفين', 'Employees', 'الموظفين'],
  ['p-emp-edit', 'employees.edit', 'Edit Employees', 'تعديل موظفين', 'Employees', 'الموظفين'],
  ['p-emp-delete', 'employees.delete', 'Delete/Suspend Employees', 'حذف/تعليق موظفين', 'Employees', 'الموظفين'],
  ['p-role-view', 'roles.view', 'View Roles', 'عرض الأدوار', 'Roles', 'الأدوار'],
  ['p-role-manage', 'roles.manage', 'Manage Roles & Permissions', 'إدارة الأدوار والصلاحيات', 'Roles', 'الأدوار'],
  ['p-api-view', 'apikeys.view', 'View API Keys', 'عرض مفاتيح API', 'API Keys', 'مفاتيح API'],
  ['p-api-manage', 'apikeys.manage', 'Manage API Keys', 'إدارة مفاتيح API', 'API Keys', 'مفاتيح API'],
  ['p-audit-view', 'audit.view', 'View Audit Log', 'عرض سجل المراجعة', 'Audit', 'المراجعة'],
  ['p-settings', 'settings.manage', 'System Settings', 'إعدادات النظام', 'Settings', 'الإعدادات'],
];

// ─── RBAC seed: role → permission mapping ─────────────
const ROLE_PERMISSION_MAP = {
  'role-superadmin': PERMISSION_SEEDS.map((p) => p[1]),
  'role-admin': PERMISSION_SEEDS.map((p) => p[1]).filter(
    (c) => c !== 'roles.manage' && c !== 'settings.manage'
  ),
  'role-license-mgr': [
    'customers.view',
    'licenses.view',
    'licenses.generate',
    'licenses.revoke',
    'licenses.export',
    'verify.check',
  ],
  'role-support': ['customers.view', 'licenses.view', 'verify.check'],
  'role-viewer': ['customers.view', 'licenses.view', 'audit.view'],
};

function seedRBAC() {
  const roleCount = db.prepare('SELECT COUNT(*) AS c FROM roles').get().c;
  const permCount = db.prepare('SELECT COUNT(*) AS c FROM permissions').get().c;

  const insertRole = db.prepare(
    'INSERT OR IGNORE INTO roles (id, name, name_ar, description, is_system) VALUES (?, ?, ?, ?, ?)'
  );
  const insertPerm = db.prepare(
    'INSERT OR IGNORE INTO permissions (id, code, name, name_ar, category, category_ar) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertRP = db.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
  );
  const permIdByCode = (code) =>
    db.prepare('SELECT id FROM permissions WHERE code = ?').get(code)?.id;

  const trx = db.transaction(() => {
    for (const r of ROLE_SEEDS) insertRole.run(...r);
    for (const p of PERMISSION_SEEDS) insertPerm.run(...p);
    for (const [roleId, codes] of Object.entries(ROLE_PERMISSION_MAP)) {
      for (const code of codes) {
        const pid = permIdByCode(code);
        if (pid) insertRP.run(roleId, pid);
      }
    }
  });
  trx();

  if (roleCount === 0 || permCount === 0) {
    logger.info('RBAC roles & permissions seeded');
  }
}

seedRBAC();

// ─── Bootstrap: migrate .env admin → employees table as Super Admin ───
function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@leentek.local';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  const existing = db.prepare('SELECT COUNT(*) AS c FROM employees').get().c;
  if (existing > 0) return;

  // Carry over hash from legacy admins table if present; otherwise hash the env password.
  let hash;
  try {
    const legacy = db
      .prepare('SELECT password_hash FROM admins WHERE email = ?')
      .get(email);
    hash = legacy?.password_hash || bcrypt.hashSync(password, 12);
  } catch {
    hash = bcrypt.hashSync(password, 12);
  }

  const id = 'EMP-' + crypto.randomBytes(6).toString('hex');
  const code = 'EMP-0001';
  db.prepare(
    `INSERT INTO employees
       (id, employee_code, name, email, phone, password_hash, role_id, department, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'role-superadmin', ?, 'active', ?)`
  ).run(id, code, 'Super Admin', email, null, hash, 'Administration', id);
  logger.info(`Bootstrap Super Admin employee created: ${email} (${code})`);
}

bootstrapAdmin();

module.exports = db;
