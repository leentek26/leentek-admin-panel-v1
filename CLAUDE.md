# CLAUDE.md

## Project: License Admin Panel — Hybrid Architecture
Admin panel for customer registration with Hybrid ID system (opaque Primary Key + human-readable Display Code), encrypted license/dongle key generation, and real-time product verification API.

## CRITICAL ARCHITECTURE: Hybrid ID System
Every customer has TWO identifiers. This is the core design decision — never violate it.

1. **Primary Key** `id` = `CUS-7f3a9b2e1d4c` — crypto.randomBytes(6), IMMUTABLE, used by:
   - All foreign keys (licenses, audit_log, api_keys)
   - License encryption payload (pid field inside AES ciphertext)
   - API responses and verification results
   - Internal system references

2. **Display Code** `display_code` = `QA-CNC-0042-26` — MUTABLE, used by:
   - Human interfaces (admin panel, support tickets, invoices)
   - Customer-facing communications
   - Quick visual identification of country + product + sequence

### Rules:
- Licenses ALWAYS bind to `id`, NEVER to `display_code`
- When customer changes country or product, `display_code` is regenerated — `id` stays forever
- `display_code` is a convenience alias, not an identity
- API verify endpoint returns both `id` and `display_code`
- Sequential number in display_code is per-product-category (CNC-0001, PLC-0001)

### ID Generation:
```javascript
// Primary Key — crypto-secure, opaque
const id = 'CUS-' + crypto.randomBytes(6).toString('hex');
// Result: CUS-7f3a9b2e1d4c

// Display Code — human-readable, mutable
const display_code = `${countryISO}-${productCode}-${seqPadded}-${yearShort}`;
// Result: QA-CNC-0042-26
```

## Tech Stack
- Backend: Node.js 20+ / Express 4 / better-sqlite3
- Frontend: React 18 / Vite / Tailwind CSS
- Auth: JWT (jsonwebtoken + bcrypt)
- Encryption: Node.js native crypto (AES-256-GCM)
- Validation: Joi
- Logging: Winston
- Security: Helmet, cors, express-rate-limit

## Commands
- `npm run dev` — starts both server (3001) and client (5173)
- `npm run server` — starts Express only
- `npm run client` — starts Vite only
- `npm run build` — builds React for production
- `npm test` — runs Jest integration tests

## Database Schema (SQLite)

```sql
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,                    -- CUS-7f3a9b2e1d4c (immutable)
  display_code TEXT UNIQUE NOT NULL,      -- QA-CNC-0042-26 (mutable)
  seq_num INTEGER NOT NULL,              -- sequential per product category
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  country_code TEXT NOT NULL,            -- ISO 3166-1 Alpha-2
  product_code TEXT NOT NULL,            -- CNC, PLC, IOT, ERP, CAD, DRV
  city TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','pending','inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,                    -- LIC-XXXXXX
  customer_id TEXT NOT NULL REFERENCES customers(id),  -- ALWAYS primary key, NEVER display_code
  product_code TEXT NOT NULL,
  product_name TEXT,
  tier TEXT NOT NULL CHECK(tier IN ('TRIAL','BASIC','PRO','ENT','OEM')),
  dongle_type TEXT NOT NULL CHECK(dongle_type IN ('SOFT','USB','CLOUD','NODE')),
  license_key TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,        -- AES-256-GCM encrypted JSON
  hwid TEXT DEFAULT 'ANY',
  activation_limit INTEGER DEFAULT 1,
  activations INTEGER DEFAULT 0,
  expires_at TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  issued_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL,                -- SHA-256 hash
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
  details TEXT,                          -- JSON
  ip_address TEXT,
  user_agent TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE UNIQUE INDEX idx_customers_display ON customers(display_code);
CREATE INDEX idx_customers_product ON customers(product_code);
CREATE INDEX idx_customers_country ON customers(country_code);
CREATE INDEX idx_licenses_customer ON licenses(customer_id);
CREATE INDEX idx_licenses_key ON licenses(license_key);
CREATE INDEX idx_licenses_status ON licenses(status);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_apikeys_hash ON api_keys(key_hash);
```

## Architecture Rules
1. All API routes validate input with Joi schemas
2. All DB queries use parameterized statements — NEVER string concat
3. License keys encrypted with AES-256-GCM + random IV + auth tag
4. License payload contains `pid` (Primary Key) — NEVER display_code
5. Admin auth via JWT: 15min access + 7day refresh (httpOnly cookie)
6. Product verification via API Key (X-API-Key header)
7. Every mutation logged to audit_log with IP
8. Rate limit: 100/min admin, 30/min verify
9. CORS restricted to CORS_ORIGIN env var
10. All secrets from .env

## API Endpoints

### Auth
- POST /api/auth/login → { accessToken } + httpOnly refreshToken cookie
- POST /api/auth/refresh → { accessToken }

### Customers (JWT protected)
- GET    /api/customers?search=&status=&product_code=&country_code=
- GET    /api/customers/:id (accepts both primary id and display_code)
- POST   /api/customers → generates id + display_code, returns both
- PUT    /api/customers/:id → regenerates display_code if country/product changed
- DELETE /api/customers/:id → soft-delete (status='inactive')

### Licenses (JWT protected)
- GET    /api/licenses?customer_id=&product_code=&status=
- POST   /api/licenses/generate → binds to customer.id, NOT display_code
- POST   /api/licenses/:id/revoke
- POST   /api/licenses/:id/activate → increments activations, checks limit
- GET    /api/licenses/export/csv

### Verify (API Key protected)
- POST   /api/verify
  Body: { license_key, hwid?, product_code? }
  Response: {
    valid: true,
    primary_id: "CUS-7f3a9b2e1d4c",
    display_code: "QA-CNC-0042-26",
    customer: "Ahmed",
    company: "TechCo",
    product: "CNC",
    tier: "PRO",
    expires_at: "2027-05-17",
    activations: 1,
    activation_limit: 3
  }
  Rate limit: 30/min

### API Keys (JWT protected)
- GET    /api/apikeys
- POST   /api/apikeys → returns key once, stores SHA-256 hash
- DELETE /api/apikeys/:id

### Audit (JWT protected)
- GET    /api/audit?action=&entity_type=&from=&to=

## Encryption Engine: server/crypto/licenseEngine.js

AES-256-GCM with:
- Random 16-byte IV per encryption
- Auth tag for tamper detection
- crypto.scryptSync for key derivation
- Payload always contains `pid` (Primary Key)
- License key format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-CHECKSUM

```javascript
function encrypt(payload, secretKey)     // → { iv, encrypted, authTag }
function decrypt(data, secretKey)        // → payload object
function generateLicenseKey(primaryId, productCode, tier, expiry, hwid)
function verifyLicenseKey(key, secretKey) // → { valid, data } | { valid: false, reason }
function generateDongleFile(license)     // → JSON for .lic file
```

## Display Code Generator: server/utils/displayCode.js

```javascript
function generateDisplayCode(db, countryCode, productCode) {
  const seq = db.prepare(
    'SELECT COALESCE(MAX(seq_num),0)+1 AS next FROM customers WHERE product_code=?'
  ).get(productCode).next;
  const yy = new Date().getFullYear().toString().slice(-2);
  return {
    displayCode: `${countryCode}-${productCode}-${String(seq).padStart(4,'0')}-${yy}`,
    seqNum: seq
  };
}

function regenerateDisplayCode(customer) {
  // Called when customer.country_code or product_code changes
  const yy = new Date().getFullYear().toString().slice(-2);
  return `${customer.country_code}-${customer.product_code}-${String(customer.seq_num).padStart(4,'0')}-${yy}`;
}
```

## Frontend Pages
1. LoginPage
2. DashboardPage — stats + recent activity
3. RegisterPage — customer form with live ID preview showing both Primary + Display
4. CustomersPage — table showing both IDs, edit triggers display_code regeneration
5. GeneratePage — license form, shows binding to Primary Key explicitly
6. LicensesPage — list with both IDs visible, expand for details
7. VerifyPage — paste key, shows decrypted Primary Key → DB lookup → Display Code
8. ApiKeysPage
9. AuditLogPage

## Security Checklist
- [ ] Helmet.js headers
- [ ] CORS whitelist
- [ ] Rate limiting per endpoint
- [ ] Joi validation on all inputs
- [ ] Parameterized SQL only
- [ ] JWT secret min 64 chars
- [ ] API keys stored as SHA-256 hash
- [ ] Refresh tokens in httpOnly secure cookies
- [ ] Audit log for all mutations
- [ ] HTTPS enforced in production
- [ ] No display_code in license encryption — only Primary Key
- [ ] Content-Security-Policy header
