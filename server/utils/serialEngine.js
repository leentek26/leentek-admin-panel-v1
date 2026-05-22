const crypto = require('crypto');

const TYPE_MAP = { HARDWARE: 'H', SOFTWARE: 'S', HYBRID: 'X' };
const TYPE_REVERSE = { H: 'HARDWARE', S: 'SOFTWARE', X: 'HYBRID' };

function luhnCheck(str) {
  const clean = str.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  let sum = 0;
  for (let i = 0; i < clean.length; i++) {
    const val = parseInt(clean[i], 36);
    if (Number.isNaN(val)) continue;
    sum += i % 2 === 0 ? val : val * 2;
  }
  return (sum % 36).toString(36).toUpperCase();
}

// Allocates the next sequence number for (product, year) by bumping a row in
// product_serial_counters. The counter is monotonic — deleting a unit does
// NOT free its number, which is what guarantees no-reuse. Within a single
// outer transaction (see generateBatch / route handlers) sequential calls
// observe each other's increment, so a batch of N mints N strictly
// consecutive numbers with no gaps.
function generateSerialNumber(db, product) {
  const year = new Date().getFullYear();
  const typeChar = TYPE_MAP[product.type] || 'X';
  const prefix = `${product.manufacturer_prefix || 'LT'}-${product.code}-${typeChar}-${year}-`;

  db.prepare(
    `INSERT OR IGNORE INTO product_serial_counters (product_id, year, last_seq)
     VALUES (?, ?, 0)`
  ).run(product.id, year);
  db.prepare(
    `UPDATE product_serial_counters
        SET last_seq = last_seq + 1
      WHERE product_id = ? AND year = ?`
  ).run(product.id, year);
  const seq = db
    .prepare(
      `SELECT last_seq FROM product_serial_counters
        WHERE product_id = ? AND year = ?`
    )
    .get(product.id, year).last_seq;

  const seqStr = String(seq).padStart(5, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  const body = `${prefix}${seqStr}-${rand}`;
  const check = luhnCheck(body);
  return {
    full: `${body}-${check}`,
    short: `${product.code}-${seqStr}`,
    seq,
  };
}

function validateSerial(serialNumber) {
  if (typeof serialNumber !== 'string') return { valid: false, reason: 'Invalid input' };
  const parts = serialNumber.trim().split('-');
  if (parts.length !== 7) return { valid: false, reason: 'Invalid format' };
  const check = parts[6];
  const body = parts.slice(0, 6).join('-');
  const expected = luhnCheck(body);
  if (check !== expected) {
    return { valid: false, reason: 'Check digit mismatch — possible counterfeit', counterfeit: true };
  }
  return {
    valid: true,
    parsed: {
      manufacturer: parts[0],
      product: parts[1],
      type: TYPE_REVERSE[parts[2]] || 'UNKNOWN',
      year: parseInt(parts[3], 10),
      sequence: parseInt(parts[4], 10),
      crypto: parts[5],
    },
  };
}

function generateBatch(db, product, count) {
  const serials = [];
  const trx = db.transaction(() => {
    for (let i = 0; i < count; i++) serials.push(generateSerialNumber(db, product));
  });
  trx();
  return serials;
}

module.exports = { generateSerialNumber, validateSerial, generateBatch, luhnCheck };
