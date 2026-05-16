/**
 * License Engine — AES-256-GCM
 *
 * Payload ALWAYS contains `pid` (Primary Key, e.g. CUS-7f3a9b2e1d4c).
 * NEVER store display_code inside the encrypted payload — display_code is mutable.
 *
 * License key format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-CHECKSUM
 * The 5 blocks are the base32 of (IV || authTag || ciphertext);
 * CHECKSUM is the first 8 hex of sha256(payload + LICENSE_SECRET).
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;
const KEY_LEN = 32;
const BLOCK_LEN = 5;
const NUM_BLOCKS = 5;

function deriveKey(secret, salt) {
  // scryptSync is intentional — slow KDF, deterministic for the same (secret, salt)
  return crypto.scryptSync(secret, salt, KEY_LEN);
}

function getKey() {
  const secret = process.env.LICENSE_SECRET || 'CMPNY-AES256-PROD-KEY-2026';
  const salt = process.env.LICENSE_SALT || 'leentek-license-salt';
  return deriveKey(secret, salt);
}

/** Encrypts a JS object → { iv, encrypted, authTag } as hex strings. */
function encrypt(payload) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(json), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encrypted: encrypted.toString('hex'),
  };
}

/** Decrypts a { iv, encrypted, authTag } record back to the original object. */
function decrypt({ iv, encrypted, authTag }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString('utf8'));
}

// ─── Base32-Crockford-ish for license key blocks ────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s.toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function blockify(str) {
  const blocks = [];
  for (let i = 0; i < str.length; i += BLOCK_LEN) {
    blocks.push(str.substring(i, i + BLOCK_LEN).padEnd(BLOCK_LEN, '2'));
  }
  while (blocks.length < NUM_BLOCKS) {
    const pad = crypto.randomBytes(4).toString('hex').toUpperCase().substring(0, BLOCK_LEN);
    blocks.push(pad);
  }
  return blocks.slice(0, NUM_BLOCKS);
}

function checksum(payloadStr) {
  const secret = process.env.LICENSE_SECRET || 'CMPNY-AES256-PROD-KEY-2026';
  return crypto
    .createHash('sha256')
    .update(payloadStr + secret)
    .digest('hex')
    .substring(0, 8)
    .toUpperCase();
}

/**
 * Generates a license key bound to the Primary Key (NOT display_code).
 * Returns { licenseKey, encryptedPayload, payload }.
 */
function generateLicenseKey(primaryId, productCode, tier, expiry, hwid = 'ANY') {
  const payload = {
    pid: primaryId, // ← Primary Key, not display_code
    prd: productCode,
    tier,
    exp: expiry || 'PERMANENT',
    hwid: hwid || 'ANY',
    iat: Date.now(),
    nonce: crypto.randomBytes(4).toString('hex'),
  };
  const payloadStr = JSON.stringify(payload);
  const enc = encrypt(payload);

  // Pack (iv || authTag || encrypted) into base32 for the visible key
  const packed = Buffer.concat([
    Buffer.from(enc.iv, 'hex'),
    Buffer.from(enc.authTag, 'hex'),
    Buffer.from(enc.encrypted, 'hex'),
  ]);
  const b32 = toBase32(packed);
  const blocks = blockify(b32);
  const chk = checksum(payloadStr);
  const licenseKey = `${blocks.join('-')}-${chk}`;

  return {
    licenseKey,
    encryptedPayload: JSON.stringify(enc),
    payload,
  };
}

/**
 * Verifies a license key from its on-disk encrypted_payload (stored on the server)
 * and confirms the visible key's checksum matches.
 */
function verifyLicenseKey(licenseKey, encryptedPayloadJson) {
  try {
    if (!licenseKey || typeof licenseKey !== 'string') {
      return { valid: false, reason: 'مفتاح غير صالح / Invalid key' };
    }
    const parts = licenseKey.trim().split('-');
    if (parts.length < 2) {
      return { valid: false, reason: 'تنسيق غير صالح / Invalid format' };
    }
    const presentedChecksum = parts[parts.length - 1].toUpperCase();

    if (!encryptedPayloadJson) {
      return { valid: false, reason: 'مفتاح غير معروف / Unknown key' };
    }
    const enc = JSON.parse(encryptedPayloadJson);
    const data = decrypt(enc);
    const expected = checksum(JSON.stringify(data));
    if (presentedChecksum !== expected) {
      return { valid: false, reason: 'الرمز محرّف / Tampered key' };
    }
    if (data.exp && data.exp !== 'PERMANENT' && new Date(data.exp) < new Date()) {
      return { valid: false, reason: 'منتهي الصلاحية / Expired', data };
    }
    return { valid: true, data };
  } catch (e) {
    return { valid: false, reason: 'فشل فك التشفير / Decryption failed' };
  }
}

/** Builds a .lic dongle file payload (JSON) — Primary Key only. */
function generateDongleFile(license) {
  return {
    format: 'leentek-dongle/1.0',
    license_id: license.id,
    primary_id: license.customer_id, // Primary Key — never display_code
    product_code: license.product_code,
    tier: license.tier,
    dongle_type: license.dongle_type,
    license_key: license.license_key,
    encrypted_payload: license.encrypted_payload, // server-only verification material
    hwid: license.hwid,
    activation_limit: license.activation_limit,
    expires_at: license.expires_at,
    issued_at: license.issued_at,
  };
}

module.exports = {
  encrypt,
  decrypt,
  generateLicenseKey,
  verifyLicenseKey,
  generateDongleFile,
};
