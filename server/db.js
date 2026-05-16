const path = require('path');
const fs = require('fs');
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_display ON customers(display_code);
CREATE INDEX IF NOT EXISTS idx_customers_product ON customers(product_code);
CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(country_code);
CREATE INDEX IF NOT EXISTS idx_licenses_customer ON licenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);
`;

db.exec(SCHEMA);

function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@leentek.local';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const existing = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  if (existing > 0) return;
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run(email, hash);
  logger.info(`Bootstrap admin created: ${email}`);
}

bootstrapAdmin();

module.exports = db;
