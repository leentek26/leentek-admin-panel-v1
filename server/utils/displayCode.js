/**
 * Display Code generator — human-readable, MUTABLE alias.
 * Format: {CC}-{PRD}-{SEQ4}-{YY}
 * Example: QA-CNC-0042-26
 *
 * Sequential number is per-product-category — CNC-0001, CNC-0002, PLC-0001…
 * Bound to customers.seq_num column.
 */

function pad4(n) {
  return String(n).padStart(4, '0');
}

function yearShort(date = new Date()) {
  return date.getFullYear().toString().slice(-2);
}

/**
 * Allocates next seq_num for productCode and returns full display_code.
 * Transactional caller is responsible for inserting in the same tx.
 */
function generateDisplayCode(db, countryCode, productCode) {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(seq_num), 0) + 1 AS next FROM customers WHERE product_code = ?'
    )
    .get(productCode);
  const seq = row.next;
  return {
    displayCode: `${countryCode}-${productCode}-${pad4(seq)}-${yearShort()}`,
    seqNum: seq,
  };
}

/**
 * Rebuilds display_code from existing customer fields.
 * Called when country_code or product_code changes — seq_num stays.
 */
function regenerateDisplayCode(customer) {
  return `${customer.country_code}-${customer.product_code}-${pad4(customer.seq_num)}-${yearShort()}`;
}

module.exports = { generateDisplayCode, regenerateDisplayCode };
