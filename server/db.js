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
  status TEXT DEFAULT 'active' CHECK(status IN ('active','pending','inactive','deleted')),
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
  role_level INTEGER DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  type TEXT NOT NULL CHECK(type IN ('HARDWARE','SOFTWARE','HYBRID')),
  category TEXT NOT NULL,
  category_ar TEXT,
  description TEXT,
  description_ar TEXT,
  version TEXT DEFAULT '1.0',
  manufacturer_prefix TEXT DEFAULT 'LT',
  warranty_months INTEGER DEFAULT 12,
  has_license INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','discontinued','development')),
  image_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_units (
  id TEXT PRIMARY KEY,
  serial_number TEXT UNIQUE NOT NULL,
  serial_short TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  customer_id TEXT REFERENCES customers(id),
  license_id TEXT REFERENCES licenses(id),
  batch_id TEXT,
  status TEXT DEFAULT 'manufactured' CHECK(status IN (
    'manufactured','in_stock','reserved','sold','activated','returned','defective','retired'
  )),
  manufactured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sold_at DATETIME,
  activated_at DATETIME,
  warranty_until DATETIME,
  hwid TEXT,
  firmware_version TEXT,
  location TEXT,
  notes TEXT,
  seq_num INTEGER
);

CREATE TABLE IF NOT EXISTS product_serial_counters (
  product_id TEXT NOT NULL REFERENCES products(id),
  year       INTEGER NOT NULL,
  last_seq   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, year)
);

CREATE TABLE IF NOT EXISTS serial_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT REFERENCES product_units(id),
  serial_number TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('valid','invalid','counterfeit','expired_warranty')),
  ip_address TEXT,
  hwid TEXT,
  user_agent TEXT,
  location TEXT,
  details TEXT,
  verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_units_serial ON product_units(serial_number);
CREATE INDEX IF NOT EXISTS idx_units_product ON product_units(product_id);
CREATE INDEX IF NOT EXISTS idx_units_customer ON product_units(customer_id);
CREATE INDEX IF NOT EXISTS idx_units_status ON product_units(status);
CREATE INDEX IF NOT EXISTS idx_units_batch ON product_units(batch_id);
CREATE INDEX IF NOT EXISTS idx_verifications_serial ON serial_verifications(serial_number);
CREATE INDEX IF NOT EXISTS idx_verifications_unit ON serial_verifications(unit_id);

CREATE TABLE IF NOT EXISTS product_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  parent_id TEXT REFERENCES product_categories(id),
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON product_categories(parent_id);

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

// ─── Migration: product_units.seq_num + product_serial_counters backfill ──
// Adds the seq_num column to older DBs and seeds counter rows from existing
// units so freshly-issued serials never collide with — or reuse — a number
// that was already minted. Idempotent: re-running is a no-op.
(function migrateSerialCounters() {
  const cols = db.prepare('PRAGMA table_info(product_units)').all().map((c) => c.name);
  if (!cols.includes('seq_num')) {
    db.exec('ALTER TABLE product_units ADD COLUMN seq_num INTEGER');
    logger.info('migration: added product_units.seq_num');
  }

  // Backfill seq_num on legacy rows from the digits embedded in the serial.
  const stale = db
    .prepare('SELECT id, serial_number FROM product_units WHERE seq_num IS NULL')
    .all();
  if (stale.length > 0) {
    const update = db.prepare('UPDATE product_units SET seq_num = ? WHERE id = ?');
    const trx = db.transaction(() => {
      for (const r of stale) {
        const parts = (r.serial_number || '').split('-');
        // Format: PREFIX-CODE-TYPE-YEAR-NNNNN-XXXX-C
        const s = parts.length >= 5 ? parseInt(parts[4], 10) : NaN;
        if (!Number.isNaN(s)) update.run(s, r.id);
      }
    });
    trx();
    logger.info(`migration: backfilled seq_num on ${stale.length} unit row(s)`);
  }

  // Seed counter table from existing units so the next mint can't reuse a number.
  const allUnits = db
    .prepare('SELECT product_id, serial_number, seq_num FROM product_units WHERE seq_num IS NOT NULL')
    .all();
  if (allUnits.length > 0) {
    const maxByKey = new Map();
    for (const u of allUnits) {
      const parts = (u.serial_number || '').split('-');
      const year = parts.length >= 4 ? parseInt(parts[3], 10) : NaN;
      if (Number.isNaN(year)) continue;
      const key = `${u.product_id}|${year}`;
      const cur = maxByKey.get(key) || { product_id: u.product_id, year, max: 0 };
      if (u.seq_num > cur.max) cur.max = u.seq_num;
      maxByKey.set(key, cur);
    }
    const upsert = db.prepare(`
      INSERT INTO product_serial_counters (product_id, year, last_seq)
      VALUES (?, ?, ?)
      ON CONFLICT(product_id, year) DO UPDATE SET
        last_seq = CASE WHEN excluded.last_seq > last_seq
                        THEN excluded.last_seq ELSE last_seq END
    `);
    const trx = db.transaction(() => {
      for (const v of maxByKey.values()) upsert.run(v.product_id, v.year, v.max);
    });
    trx();
  }
})();

// ─── Migration: allow customers.status='deleted' ──────────────────────
// SQLite can't modify a CHECK constraint in place, so the table is rebuilt
// when the old constraint is detected. Runs once per process; idempotent.
(function migrateCustomersDeletedStatus() {
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'")
    .get();
  if (!existing || !existing.sql) return;
  if (/'deleted'/.test(existing.sql)) return; // already migrated

  logger.info("migration: rebuilding customers table to allow status='deleted'");

  // FK enforcement must be off while we rename the referenced table.
  db.pragma('foreign_keys = OFF');
  const trx = db.transaction(() => {
    db.exec(`
      CREATE TABLE customers_new (
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
        status TEXT DEFAULT 'active'
          CHECK(status IN ('active','pending','inactive','deleted')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.exec('INSERT INTO customers_new SELECT * FROM customers');
    db.exec('DROP TABLE customers');
    db.exec('ALTER TABLE customers_new RENAME TO customers');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_display ON customers(display_code)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_product ON customers(product_code)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(country_code)');
  });
  trx();
  db.pragma('foreign_keys = ON');
})();

// ─── RBAC seed: roles (id, name, name_ar, description, is_system, role_level) ───
// `name_ar` is kept for schema compatibility (NOT NULL column) but mirrors
// the English name now that the UI is English-only.
const ROLE_SEEDS = [
  ['role-superadmin', 'Super Admin',     'Super Admin',     'Full unrestricted access to all features', 1, 100],
  ['role-admin',      'Admin',           'Admin',           'Manage customers, licenses, and employees', 1, 80],
  ['role-license-mgr','License Manager', 'License Manager', 'Generate, revoke, and verify licenses only', 1, 60],
  ['role-support',    'Support',         'Support',         'View customers and verify licenses only', 1, 40],
  ['role-viewer',     'Viewer',          'Viewer',          'View dashboard and reports only', 1, 20],
];

// ─── RBAC seed: permissions ───────────────────────────
// `name_ar` / `category_ar` are kept for schema compatibility (NOT NULL columns)
// but mirror the English name now that the UI is English-only.
const PERMISSION_SEEDS = [
  ['p-cust-view',    'customers.view',   'View Customers',           'View Customers',           'Customers',    'Customers'],
  ['p-cust-create',  'customers.create', 'Create Customers',         'Create Customers',         'Customers',    'Customers'],
  ['p-cust-edit',    'customers.edit',   'Edit Customers',           'Edit Customers',           'Customers',    'Customers'],
  ['p-cust-delete',  'customers.delete', 'Delete Customers',         'Delete Customers',         'Customers',    'Customers'],
  ['p-lic-view',     'licenses.view',    'View Licenses',            'View Licenses',            'Licenses',     'Licenses'],
  ['p-lic-generate', 'licenses.generate','Generate Licenses',        'Generate Licenses',        'Licenses',     'Licenses'],
  ['p-lic-revoke',   'licenses.revoke',  'Revoke Licenses',          'Revoke Licenses',          'Licenses',     'Licenses'],
  ['p-lic-export',   'licenses.export',  'Export Licenses',          'Export Licenses',          'Licenses',     'Licenses'],
  ['p-verify',       'verify.check',     'Verify License Keys',      'Verify License Keys',      'Verification', 'Verification'],
  ['p-emp-view',     'employees.view',   'View Employees',           'View Employees',           'Employees',    'Employees'],
  ['p-emp-create',   'employees.create', 'Create Employees',         'Create Employees',         'Employees',    'Employees'],
  ['p-emp-edit',     'employees.edit',   'Edit Employees',           'Edit Employees',           'Employees',    'Employees'],
  ['p-emp-delete',   'employees.delete', 'Delete/Suspend Employees', 'Delete/Suspend Employees', 'Employees',    'Employees'],
  ['p-role-view',    'roles.view',       'View Roles',               'View Roles',               'Roles',        'Roles'],
  ['p-role-manage',  'roles.manage',     'Manage Roles & Permissions','Manage Roles & Permissions','Roles',      'Roles'],
  ['p-api-view',     'apikeys.view',     'View API Keys',            'View API Keys',            'API Keys',     'API Keys'],
  ['p-api-manage',   'apikeys.manage',   'Manage API Keys',          'Manage API Keys',          'API Keys',     'API Keys'],
  ['p-audit-view',   'audit.view',       'View Audit Log',           'View Audit Log',           'Audit',        'Audit'],
  ['p-settings',     'settings.manage',  'System Settings',          'System Settings',          'Settings',     'Settings'],
  // ─── Products / Units / Inventory ───────────────────────────
  ['p-prod-view',    'products.view',    'View Products',            'View Products',            'Products',     'Products'],
  ['p-prod-manage',  'products.manage',  'Manage Products',          'Manage Products',          'Products',     'Products'],
  ['p-unit-view',    'units.view',       'View Units/Serials',       'View Units/Serials',       'Products',     'Products'],
  ['p-unit-generate','units.generate',   'Generate Serials',         'Generate Serials',         'Products',     'Products'],
  ['p-unit-manage',  'units.manage',     'Manage Units',             'Manage Units',             'Products',     'Products'],
  ['p-inv-view',     'inventory.view',   'View Inventory',           'View Inventory',           'Products',     'Products'],
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
    // view-only access to the Products / Units / Inventory surface
    'products.view',
    'units.view',
    'inventory.view',
  ],
  'role-support': [
    'customers.view',
    'licenses.view',
    'verify.check',
    'products.view',
    'units.view',
    'inventory.view',
  ],
  'role-viewer': [
    'customers.view',
    'licenses.view',
    'audit.view',
    // view-only access to Products / Units / Inventory
    'products.view',
    'units.view',
    'inventory.view',
  ],
};

function ensureRoleLevelColumn() {
  // Idempotent migration: SQLite has no IF NOT EXISTS for ADD COLUMN.
  const cols = db.prepare('PRAGMA table_info(roles)').all().map((c) => c.name);
  if (!cols.includes('role_level')) {
    db.exec('ALTER TABLE roles ADD COLUMN role_level INTEGER DEFAULT 0');
    logger.info('migration: added roles.role_level');
  }
}

function seedRBAC() {
  ensureRoleLevelColumn();

  const roleCount = db.prepare('SELECT COUNT(*) AS c FROM roles').get().c;
  const permCount = db.prepare('SELECT COUNT(*) AS c FROM permissions').get().c;

  const insertRole = db.prepare(
    'INSERT OR IGNORE INTO roles (id, name, name_ar, description, is_system, role_level) VALUES (?, ?, ?, ?, ?, ?)'
  );
  // Keep canonical levels in sync on every boot — even for DBs seeded before the column existed.
  const updateRoleLevel = db.prepare('UPDATE roles SET role_level = ? WHERE id = ?');
  const insertPerm = db.prepare(
    'INSERT OR IGNORE INTO permissions (id, code, name, name_ar, category, category_ar) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertRP = db.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
  );
  const permIdByCode = (code) =>
    db.prepare('SELECT id FROM permissions WHERE code = ?').get(code)?.id;

  const trx = db.transaction(() => {
    for (const r of ROLE_SEEDS) {
      insertRole.run(...r);
      // r[0] = id, r[5] = role_level
      updateRoleLevel.run(r[5], r[0]);
    }
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

// ─── Seed: products catalog (replaces hardcoded PRODUCTS array) ───
// `name_ar` / `category_ar` columns are nullable on products — we leave them
// empty now that the UI is English-only.
const INITIAL_PRODUCTS = [
  { code: 'CNC', name: 'CNC Controller',         type: 'HARDWARE', category: 'Industrial Automation' },
  { code: 'PLC', name: 'PLC Programming IDE',    type: 'SOFTWARE', category: 'Industrial Automation' },
  { code: 'IOT', name: 'IoT Monitoring System',  type: 'HYBRID',   category: 'IoT Solutions' },
  { code: 'ERP', name: 'ERP System',             type: 'SOFTWARE', category: 'Enterprise Software' },
  { code: 'CAD', name: 'Engineering CAD System', type: 'SOFTWARE', category: 'Design Tools' },
  { code: 'DRV', name: 'Industrial Drive',       type: 'HARDWARE', category: 'Industrial Automation' },
];

function seedProducts() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO products
       (id, code, name, name_ar, type, category, category_ar, manufacturer_prefix, warranty_months, has_license, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'LT', 12, 1, 'active')`
  );
  const trx = db.transaction(() => {
    for (const p of INITIAL_PRODUCTS) {
      const id = 'PRD-' + crypto.randomBytes(6).toString('hex');
      insert.run(id, p.code, p.name, p.name_ar || null, p.type, p.category, p.category_ar || null);
    }
  });
  trx();
  logger.info(`Products catalog seeded with ${INITIAL_PRODUCTS.length} entries`);
}

seedProducts();

// ─── Seed: product_categories from values already on products.category ─
// Idempotent: only inserts categories that aren't in the table yet, so
// future runs (and manual category creates) survive.
function seedProductCategories() {
  const distinct = db
    .prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''")
    .all()
    .map((r) => r.category);
  if (distinct.length === 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO product_categories (id, name, sort_order) VALUES (?, ?, ?)`
  );
  let inserted = 0;
  const trx = db.transaction(() => {
    distinct.forEach((name, i) => {
      const exists = db
        .prepare('SELECT id FROM product_categories WHERE name = ?')
        .get(name);
      if (exists) return;
      const id = 'CAT-' + crypto.randomBytes(6).toString('hex');
      insert.run(id, name, i * 10);
      inserted++;
    });
  });
  trx();
  if (inserted > 0) {
    logger.info(`product_categories seeded with ${inserted} new categor${inserted === 1 ? 'y' : 'ies'}`);
  }
}

seedProductCategories();

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
