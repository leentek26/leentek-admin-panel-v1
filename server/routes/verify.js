const express = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireApiKey } = require('../middleware/apiKey');
const { audit } = require('../middleware/audit');
const { verifyLicenseKey } = require('../crypto/licenseEngine');

const router = express.Router();

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate limit exceeded — 30 req/min' },
});

const verifySchema = Joi.object({
  license_key: Joi.string().required(),
  hwid: Joi.string().allow('', null),
  product_code: Joi.string().allow('', null),
});

router.post('/', verifyLimiter, requireApiKey, (req, res) => {
  const { error, value } = verifySchema.validate(req.body);
  if (error) return res.status(400).json({ valid: false, reason: error.message });

  // Optional: enforce that API key product matches request
  if (value.product_code && req.apiKey.product_code !== value.product_code) {
    audit(req, 'verify.product-mismatch', 'license', value.license_key, {
      api_key_product: req.apiKey.product_code,
      requested_product: value.product_code,
    });
    return res.status(403).json({ valid: false, reason: 'api key not authorized for this product' });
  }

  const lic = db
    .prepare('SELECT * FROM licenses WHERE license_key = ?')
    .get(value.license_key);

  if (!lic) {
    audit(req, 'verify.unknown', 'license', value.license_key, {});
    return res.json({ valid: false, reason: 'مفتاح غير معروف / Unknown key' });
  }

  if (lic.status !== 'active') {
    audit(req, `verify.${lic.status}`, 'license', lic.id, {});
    return res.json({ valid: false, reason: `license is ${lic.status}` });
  }

  // HWID lock
  if (lic.hwid && lic.hwid !== 'ANY' && value.hwid && lic.hwid !== value.hwid) {
    audit(req, 'verify.hwid-mismatch', 'license', lic.id, {
      expected: lic.hwid,
      presented: value.hwid,
    });
    return res.json({ valid: false, reason: 'HWID mismatch' });
  }

  const check = verifyLicenseKey(lic.license_key, lic.encrypted_payload);
  if (!check.valid) {
    audit(req, 'verify.invalid', 'license', lic.id, { reason: check.reason });
    return res.json({ valid: false, reason: check.reason });
  }

  // Lookup customer for response — Primary Key from decrypted payload
  const customer = db
    .prepare('SELECT * FROM customers WHERE id = ?')
    .get(check.data.pid);

  audit(req, 'verify.success', 'license', lic.id, {
    primary_id: check.data.pid,
    display_code: customer?.display_code,
  });

  res.json({
    valid: true,
    primary_id: check.data.pid,
    display_code: customer?.display_code || null,
    customer: customer?.name || null,
    company: customer?.company || null,
    product: lic.product_code,
    tier: lic.tier,
    expires_at: lic.expires_at,
    activations: lic.activations,
    activation_limit: lic.activation_limit,
    dongle_type: lic.dongle_type,
  });
});

module.exports = router;
