const crypto = require('crypto');

// Opaque Primary Key — CUS-7f3a9b2e1d4c (12 hex)
function generatePrimaryId(prefix = 'CUS') {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

// Opaque License ID — LIC-XXXXXXXXXXXX (12 hex upper)
function generateLicenseId() {
  return 'LIC-' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

// Hash an API key with SHA-256
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

module.exports = { generatePrimaryId, generateLicenseId, sha256 };
