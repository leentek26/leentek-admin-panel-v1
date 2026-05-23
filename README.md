# Leentek License Admin Panel

Admin panel for customer registration, encrypted license/dongle key generation, and real-time product verification. Built around a **Hybrid ID** model that separates internal identity from human-facing display codes.

---

## Hybrid ID system

Every customer carries two identifiers — and they are **not interchangeable**.

| | Primary Key (`id`) | Display Code (`display_code`) |
|---|---|---|
| **Shape** | `CUS-7f3a9b2e1d4c` | `QA-CNC-0042-26` |
| **How it's made** | `crypto.randomBytes(6)` | `<countryISO>-<productCode>-<seq4>-<yy>` |
| **Mutable?** | No, ever | Yes — regenerates when country or product changes |
| **Used by** | Foreign keys, license payloads, API responses, all internal references | Admin UI, support tickets, invoices, customer-facing communication |

### Rules

- Licenses bind to `id` — **never** to `display_code`.
- The license encryption payload contains `pid` (Primary Key). `display_code` is never inside ciphertext.
- When a customer's country or product changes, `display_code` is regenerated; `id` stays forever.
- The sequence number inside `display_code` is per-product-category (e.g. `CNC-0001`, `PLC-0001`).
- API `/verify` returns **both** `id` and `display_code`.

```javascript
// Primary Key — crypto-secure, opaque, immutable
const id = 'CUS-' + crypto.randomBytes(6).toString('hex');
// → CUS-7f3a9b2e1d4c

// Display Code — human-readable, mutable
const display_code = `${countryISO}-${productCode}-${seqPadded}-${yearShort}`;
// → QA-CNC-0042-26
```

---

## Tech stack

- **Backend:** Node.js 20+, Express 4, better-sqlite3
- **Frontend:** React 18, Vite, Tailwind CSS
- **Auth:** JWT (`jsonwebtoken` + `bcrypt`); 15-min access + 7-day refresh (httpOnly cookie)
- **Encryption:** Node `crypto` (AES-256-GCM)
- **Validation:** Joi
- **Logging:** Winston
- **Security:** Helmet, CORS, `express-rate-limit`

---

## Getting started

```bash
# 1. Install dependencies (root + client)
npm install
npm --prefix client install

# 2. Configure environment
cp .env.example .env   # then edit with real secrets

# 3. Run dev (Express on :3001, Vite on :5173)
npm run dev
```

### Required env vars

```ini
# Server
PORT=3001
CORS_ORIGIN=http://localhost:5173

# JWT — minimum 64 characters
JWT_SECRET=replace-me-with-a-long-random-secret
JWT_REFRESH_SECRET=replace-me-with-a-different-long-random-secret

# Bootstrap admin (created on first boot if employees table is empty)
ADMIN_EMAIL=admin@leentek.local
ADMIN_PASSWORD=ChangeMe123!

# License encryption key
LICENSE_KEY=replace-me-with-a-strong-secret
```

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts server (3001) and client (5173) together |
| `npm run server` | Express only |
| `npm run client` | Vite only |
| `npm run build` | Builds React for production |
| `npm test` | Jest integration tests |

---

## Database schema (SQLite)

```sql
CREATE TABLE customers (
  id            TEXT PRIMARY KEY,        -- CUS-7f3a9b2e1d4c (immutable)
  display_code  TEXT UNIQUE NOT NULL,    -- QA-CNC-0042-26 (mutable)
  seq_num       INTEGER NOT NULL,        -- per product category
  name          TEXT NOT NULL,
  company       TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  phone         TEXT NOT NULL,
  country_code  TEXT NOT NULL,           -- ISO 3166-1 Alpha-2
  product_code  TEXT NOT NULL,           -- CNC, PLC, IOT, ERP, CAD, DRV
  city          TEXT,
  status        TEXT DEFAULT 'active'
                CHECK(status IN ('active','pending','inactive')),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE licenses (
  id                TEXT PRIMARY KEY,                    -- LIC-XXXXXX
  customer_id       TEXT NOT NULL REFERENCES customers(id),  -- always Primary Key, never display_code
  product_code      TEXT NOT NULL,
  product_name      TEXT,
  tier              TEXT NOT NULL CHECK(tier IN ('TRIAL','BASIC','PRO','ENT','OEM')),
  dongle_type       TEXT NOT NULL CHECK(dongle_type IN ('SOFT','USB','CLOUD','NODE')),
  license_key       TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,        -- AES-256-GCM ciphertext
  hwid              TEXT DEFAULT 'ANY',
  activation_limit  INTEGER DEFAULT 1,
  activations       INTEGER DEFAULT 0,
  expires_at        TEXT,
  status            TEXT DEFAULT 'active'
                    CHECK(status IN ('active','revoked','expired')),
  issued_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash     TEXT NOT NULL,             -- SHA-256
  product_code TEXT NOT NULL,
  label        TEXT,
  active       INTEGER DEFAULT 1,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     TEXT,                       -- JSON
  ip_address  TEXT,
  user_agent  TEXT,
  timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Indexes: `customers(display_code)` unique; `customers(product_code, country_code)`; `licenses(customer_id, license_key, status)`; `audit_log(timestamp)`; `api_keys(key_hash)`.

---

## API

### Auth
- `POST /api/auth/login` — returns `{ accessToken }` + httpOnly refresh cookie
- `POST /api/auth/refresh` — returns `{ accessToken }`

### Customers (JWT)
- `GET    /api/customers?search=&status=&product_code=&country_code=`
- `GET    /api/customers/:id` — accepts either `id` or `display_code`
- `POST   /api/customers` — server generates `id` + `display_code`
- `PUT    /api/customers/:id` — regenerates `display_code` if country/product changed
- `DELETE /api/customers/:id` — soft-delete (`status='inactive'`)

### Licenses (JWT)
- `GET    /api/licenses?customer_id=&product_code=&status=`
- `POST   /api/licenses/generate` — binds to `customer.id`, not `display_code`
- `POST   /api/licenses/:id/revoke`
- `POST   /api/licenses/:id/activate` — increments counter, enforces limit
- `GET    /api/licenses/export/csv`

### Verify (API key in `X-API-Key` header)
- `POST   /api/verify` — rate-limited to 30/min

  ```json
  // request
  { "license_key": "...", "hwid": "...", "product_code": "CNC" }

  // response
  {
    "valid": true,
    "primary_id": "CUS-7f3a9b2e1d4c",
    "display_code": "QA-CNC-0042-26",
    "customer": "Ahmed",
    "company": "TechCo",
    "product": "CNC",
    "tier": "PRO",
    "expires_at": "2027-05-17",
    "activations": 1,
    "activation_limit": 3
  }
  ```

### API keys (JWT)
- `GET    /api/apikeys`
- `POST   /api/apikeys` — returned **once**; stored as SHA-256
- `DELETE /api/apikeys/:id`

### Audit log (JWT)
- `GET    /api/audit?action=&entity_type=&from=&to=`

Rate limits: 100/min on admin endpoints, 30/min on `/api/verify`.

---

## Encryption engine

`server/crypto/licenseEngine.js` — AES-256-GCM with a random 16-byte IV per encryption, an auth tag for tamper detection, and `crypto.scryptSync` for key derivation. The ciphertext payload always contains `pid` (Primary Key), never the display code.

```javascript
encrypt(payload, secretKey)            // → { iv, encrypted, authTag }
decrypt(data, secretKey)               // → payload object
generateLicenseKey(primaryId, productCode, tier, expiry, hwid)
verifyLicenseKey(key, secretKey)       // → { valid, data } | { valid: false, reason }
generateDongleFile(license)            // → JSON for .lic file
```

License key format: `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-CHECKSUM`.

---

## Architecture rules

1. All routes validate input with Joi.
2. All DB queries use parameterised statements — never string concat.
3. License keys are AES-256-GCM with random IV + auth tag.
4. The encrypted payload contains `pid` (Primary Key) — never `display_code`.
5. Admin auth uses JWT: 15-min access + 7-day refresh (httpOnly cookie).
6. Product verification uses an API key in the `X-API-Key` header.
7. Every mutation writes a row to `audit_log` with IP.
8. Rate limits: 100/min admin, 30/min verify.
9. CORS is restricted to `CORS_ORIGIN`.
10. All secrets come from `.env`.

---

## Security checklist

- [x] Helmet headers
- [x] CORS allowlist
- [x] Per-endpoint rate limiting
- [x] Joi validation on all inputs
- [x] Parameterised SQL only
- [x] JWT secret minimum 64 characters
- [x] API keys stored as SHA-256 hash
- [x] Refresh tokens in httpOnly secure cookies
- [x] Audit log for every mutation
- [x] HTTPS enforced in production
- [x] No `display_code` inside license ciphertext — Primary Key only
- [x] Content-Security-Policy header
