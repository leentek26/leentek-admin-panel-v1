// End-to-end verification of the four simple-confirm delete flows.
// Each test seeds a throwaway record via the API, then drives the UI to
// delete it and asserts it's gone from the list. Screenshots land in
// tests/verify-screens/delete-flows/ for visual review.
const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ADMIN_EMAIL = 'info@leentek.com';
const ADMIN_PASSWORD = 'Leentek@2026';
const API = 'http://127.0.0.1:3001';
const OUT = path.join(__dirname, 'verify-screens', 'delete-flows');
fs.mkdirSync(OUT, { recursive: true });

// Short timestamp suffix so seeded fixtures are unique across runs.
const stamp = () => Date.now().toString(36).slice(-6);

async function getToken(request) {
  const r = await request.post(`${API}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!r.ok()) throw new Error(`login failed: ${r.status()} ${await r.text()}`);
  return (await r.json()).accessToken;
}

async function uiLogin(page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(ADMIN_EMAIL);
  await page.locator('input[type=password]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(?:|dashboard)?$/, { timeout: 15_000 });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

// ─── 1) CUSTOMER DELETE ────────────────────────────────
test('customer delete: simple confirm + row disappears', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const token = await getToken(request);
  const id_suffix = stamp();
  const seedEmail = `del-cust-${id_suffix}@test.local`;
  const seedName = `DelTest Customer ${id_suffix}`;

  // Seed a fresh customer via API
  const create = await request.post(`${API}/api/customers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: seedName,
      company: 'DelTest Co',
      email: seedEmail,
      phone: '+1234567890',
      country_code: 'US',
      product_code: 'CNC',
      city: 'Testville',
      status: 'active',
    },
  });
  expect(create.ok()).toBeTruthy();
  const seeded = await create.json();

  await uiLogin(page);
  await page.goto('/customers');
  // Filter to the seeded row to make selection unambiguous
  await page.locator('input[placeholder*="Search"]').fill(seeded.display_code);
  await page.getByRole('button', { name: /^Apply$/ }).click();
  await page.getByText(seeded.display_code).first().waitFor();
  await shot(page, 'customer-1-before');

  // Open the simple confirm modal
  await page.getByRole('button', { name: `Delete ${seeded.display_code}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Are you sure you want to delete/i)).toBeVisible();
  await expect(dialog.getByText(seedName)).toBeVisible();
  // No "type the name" input should be present anymore
  await expect(dialog.getByText(/Type .* to confirm/i)).toHaveCount(0);
  await shot(page, 'customer-2-confirm-modal');

  // Confirm delete
  await page.getByRole('dialog').getByRole('button', { name: /^Delete$/ }).click();
  await page.getByText(/Customer deleted/).waitFor({ timeout: 10_000 });
  await shot(page, 'customer-3-success');

  // Close the result view (use the in-dialog "Close" button, not the X icon
  // which shares the same accessible name)
  await page.getByRole('dialog').getByRole('button', { name: /^Close$/ }).last().click();
  await page.waitForTimeout(300);
  await page.locator('input[placeholder*="Search"]').fill(seeded.display_code);
  await page.getByRole('button', { name: /^Apply$/ }).click();
  await page.waitForTimeout(500);
  await expect(page.getByText(seeded.display_code)).toHaveCount(0);
  await shot(page, 'customer-4-after-empty');

  // API confirms hard delete (404 on lookup)
  const lookup = await request.get(`${API}/api/customers/${seeded.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(lookup.status()).toBe(404);
});

// ─── 2a) PRODUCT DELETE — NO UNITS (hard delete) ───────
test('product delete (no units): hard delete + card disappears', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const token = await getToken(request);
  const id_suffix = stamp().toUpperCase().slice(0, 4);
  const code = `Z${id_suffix}`; // unique, won't collide with seed CNC/PLC/etc.

  const create = await request.post(`${API}/api/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      code,
      name: `Throwaway ${code}`,
      type: 'SOFTWARE',
      category: 'Test',
      version: '1.0',
      warranty_months: 12,
      has_license: true,
      status: 'active',
    },
  });
  expect(create.ok()).toBeTruthy();
  const seeded = await create.json();

  await uiLogin(page);
  await page.goto('/products');
  await page.getByText(code).first().waitFor();
  await shot(page, 'product-empty-1-before');

  await page.getByRole('button', { name: `Discontinue ${code}` }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/Are you sure you want to delete/i)).toBeVisible();
  // Should NOT yet show the "Cannot delete" block-state
  await expect(page.getByText(/Cannot delete:/i)).toHaveCount(0);
  await shot(page, 'product-empty-2-confirm-modal');

  await page.getByRole('dialog').getByRole('button', { name: /^Delete$/ }).click();
  // Modal closes on success
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(500);
  // Card must be gone — assert via the unique discontinue-button aria-label
  await expect(
    page.getByRole('button', { name: `Discontinue ${code}` })
  ).toHaveCount(0);
  await shot(page, 'product-empty-3-after');

  const lookup = await request.get(`${API}/api/products/${seeded.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(lookup.status()).toBe(404);
});

// ─── 2b) PRODUCT DELETE — WITH UNITS (blocked → Discontinue) ───
test('product delete (with units): blocked + Discontinue fallback', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const token = await getToken(request);
  const id_suffix = stamp().toUpperCase().slice(0, 4);
  const code = `W${id_suffix}`;

  // Create a product
  const create = await request.post(`${API}/api/products`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      code,
      name: `WithUnits ${code}`,
      type: 'HARDWARE',
      category: 'Test',
      version: '1.0',
      warranty_months: 12,
      has_license: true,
      status: 'active',
    },
  });
  expect(create.ok()).toBeTruthy();
  const seeded = await create.json();

  // Seed 1 unit for this product via /api/units/generate-batch
  const gen = await request.post(`${API}/api/units/generate-batch`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { product_id: seeded.id, count: 1 },
  });
  expect(gen.ok()).toBeTruthy();

  await uiLogin(page);
  await page.goto('/products');
  await page.getByText(code).first().waitFor();
  await page.getByRole('button', { name: `Discontinue ${code}` }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // First click on "Delete" — server returns 409, modal flips to block state
  await page.getByRole('dialog').getByRole('button', { name: /^Delete$/ }).click();
  await page.getByText(/Cannot delete: this product has/i).waitFor({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /^Discontinue$/ })).toBeVisible();
  await shot(page, 'product-units-1-blocked');

  // Click Discontinue → product status changes, card stays visible
  await page.getByRole('dialog').getByRole('button', { name: /^Discontinue$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(500);
  // Card still visible: assert via the card-internal product-code badge
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  // And the status badge should now show Discontinued for this product
  await expect(
    page.locator('div.bg-cardAlt', { hasText: code }).getByText(/Discontinued/i)
  ).toBeVisible();
  await shot(page, 'product-units-2-discontinued');

  // Verify via API
  const after = await request.get(`${API}/api/products/${seeded.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await after.json();
  expect(body.status).toBe('discontinued');
  // No cleanup: seeded fixtures have unique codes, so future runs won't collide.
});

// ─── 3) EMPLOYEE DELETE ────────────────────────────────
test('employee delete: simple confirm + row disappears', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const token = await getToken(request);
  const id_suffix = stamp();
  const seedEmail = `del-emp-${id_suffix}@test.local`;
  const seedName = `DelTest Employee ${id_suffix}`;

  const create = await request.post(`${API}/api/employees`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: seedName,
      email: seedEmail,
      password: 'TestPass123',
      role_id: 'role-viewer',
      department: 'QA',
      status: 'active',
    },
  });
  expect(create.ok()).toBeTruthy();
  const seeded = await create.json();

  await uiLogin(page);
  await page.goto('/employees');
  await page.getByText(seedEmail).first().waitFor();
  await shot(page, 'employee-1-before');

  // The row's Delete is a plain text link (no aria-label). Locate the row by
  // email cell, then click the Delete button inside it.
  const row = page.locator('tr', { hasText: seedEmail });
  await row.getByRole('button', { name: /^Delete$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Are you sure you want to delete/i)).toBeVisible();
  await expect(dialog.getByText(seedName)).toBeVisible();
  await shot(page, 'employee-2-confirm-modal');

  await page.getByRole('dialog').getByRole('button', { name: /^Delete$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(page.getByText(seedEmail)).toHaveCount(0);
  await shot(page, 'employee-3-after');

  const lookup = await request.get(`${API}/api/employees/${seeded.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(lookup.status()).toBe(404);
});

// ─── 4) LICENSE DELETE ─────────────────────────────────
test('license delete: simple confirm + row disappears', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const token = await getToken(request);
  const id_suffix = stamp();

  // Seed a customer + license to delete
  const cust = await request.post(`${API}/api/customers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: `LicHost ${id_suffix}`,
      company: 'LicHost Co',
      email: `lic-host-${id_suffix}@test.local`,
      phone: '+1234567890',
      country_code: 'US',
      product_code: 'CNC',
      status: 'active',
    },
  });
  expect(cust.ok()).toBeTruthy();
  const customer = await cust.json();

  const lic = await request.post(`${API}/api/licenses/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      customer_id: customer.id,
      product_code: 'CNC',
      tier: 'TRIAL',
      dongle_type: 'SOFT',
      activation_limit: 1,
      expires_at: 'PERMANENT',
    },
  });
  expect(lic.ok()).toBeTruthy();
  const license = await lic.json();

  await uiLogin(page);
  await page.goto('/licenses');
  // Filter by this customer so we only see our seeded license
  await page.locator('input[placeholder*="Customer"]').fill(customer.id);
  await page.getByRole('button', { name: /^Apply$/ }).click();
  await page.getByText(license.id).first().waitFor();
  await shot(page, 'license-1-before');

  const row = page.locator('tr', { hasText: license.id });
  await row.getByRole('button', { name: /^Delete$/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/Are you sure you want to delete/i)).toBeVisible();
  await shot(page, 'license-2-confirm-modal');

  await page.getByRole('dialog').getByRole('button', { name: /^Delete$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(500);
  // After refresh the license must be gone
  await expect(page.getByText(license.id)).toHaveCount(0);
  await shot(page, 'license-3-after');

  // API confirms hard delete
  const lookup = await request.get(`${API}/api/licenses/${license.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(lookup.status()).toBe(404);

  // Cleanup: delete the host customer
  await request.delete(`${API}/api/customers/${customer.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
});
