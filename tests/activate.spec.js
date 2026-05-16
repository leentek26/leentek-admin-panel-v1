const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = 'admin@leentek.local';
const ADMIN_PASSWORD = 'ChangeMe123!';

// Unique per run — avoids "email already registered" collisions across reruns
function uniq() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function login(page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(ADMIN_EMAIL);
  await page.locator('input[type=password]').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/');
}

async function registerCustomer(page, { name, company, email, phone, country, product }) {
  await page.goto('/register');
  await page.locator('input').nth(0).fill(name);     // Name
  await page.locator('input').nth(1).fill(company);  // Company
  await page.locator('input[type=email]').fill(email);
  await page.locator('input').nth(3).fill(phone);    // Phone
  await page.locator('select').nth(0).selectOption(country);
  await page.locator('select').nth(1).selectOption(product);
  await page.getByRole('button', { name: /^Register/ }).click();

  // The "Created · تم الإنشاء" card shows the assigned Primary Key
  const createdCard = page.locator('div.card', { hasText: 'Created' });
  await expect(createdCard).toBeVisible();
  const primaryId = (await createdCard.locator('.primary-id').first().textContent()).trim();
  expect(primaryId).toMatch(/^CUS-[0-9a-f]{12}$/);
  return primaryId;
}

async function generateLicense(page, { customerPrimaryId, limit }) {
  await page.goto('/generate');
  // Wait for customer dropdown to be populated, then pick by Primary Key suffix in <option> text
  await page.waitForFunction(
    (pid) => Array.from(document.querySelectorAll('select option')).some((o) => o.value === pid),
    customerPrimaryId
  );
  await page.locator('select').first().selectOption(customerPrimaryId);
  // activation_limit is the only number input in the form
  const limitInput = page.locator('input[type=number]');
  await limitInput.fill(String(limit));
  await page.getByRole('button', { name: /Generate license/i }).click();

  // Issued card displays "License ID" → next sibling has the LIC-…
  const issued = page.locator('div.card', { hasText: 'License issued' });
  await expect(issued).toBeVisible();
  const licId = (await issued.locator('.primary-id').first().textContent()).trim();
  expect(licId).toMatch(/^LIC-[0-9A-F]{12}$/);
  return licId;
}

test.describe('Activate button — increment, flash, disabled at limit', () => {
  test('clicks 3 times, asserts counter increments and disables at limit', async ({ page }) => {
    await login(page);

    const tag = uniq();
    const customerId = await registerCustomer(page, {
      name: `PW Tester ${tag}`,
      company: `PW Co ${tag}`,
      email: `pw-${tag}@example.test`,
      phone: '+97455550000',
      country: 'QA',
      product: 'CNC',
    });

    const licId = await generateLicense(page, { customerPrimaryId: customerId, limit: 3 });

    // Navigate to Licenses and find the row for our license
    await page.goto('/licenses');
    const row = page.locator(`tr:has(.primary-id:text-is("${licId}"))`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('0/3');

    const activateBtn = row.getByRole('button', { name: 'Activate' });
    await expect(activateBtn).toBeEnabled();

    // Click #1 → 1/3
    await activateBtn.click();
    await expect(page.getByText(`Activated ${licId} · 1/3`)).toBeVisible();
    await expect(row).toContainText('1/3');
    await expect(activateBtn).toBeEnabled();

    // Click #2 → 2/3
    await activateBtn.click();
    await expect(page.getByText(`Activated ${licId} · 2/3`)).toBeVisible();
    await expect(row).toContainText('2/3');
    await expect(activateBtn).toBeEnabled();

    // Click #3 → 3/3 — counter now amber, button now disabled
    await activateBtn.click();
    await expect(page.getByText(`Activated ${licId} · 3/3`)).toBeVisible();
    await expect(row).toContainText('3/3');
    await expect(activateBtn).toBeDisabled();

    // The amber text color is applied to the activations span when at the limit
    const activations = row.locator('td').filter({ hasText: /^\d+\/\d+$/ }).first();
    await expect(activations.locator('span').first()).toHaveClass(/text-amber-400/);
  });

  test('audit log records each activation', async ({ page }) => {
    await login(page);

    const tag = uniq();
    const customerId = await registerCustomer(page, {
      name: `Audit Tester ${tag}`,
      company: `Audit Co ${tag}`,
      email: `audit-${tag}@example.test`,
      phone: '+97455550001',
      country: 'QA',
      product: 'PLC',
    });

    const licId = await generateLicense(page, { customerPrimaryId: customerId, limit: 2 });

    await page.goto('/licenses');
    const row = page.locator(`tr:has(.primary-id:text-is("${licId}"))`);
    const activateBtn = row.getByRole('button', { name: 'Activate' });

    await activateBtn.click();
    await expect(row).toContainText('1/2');
    await activateBtn.click();
    await expect(row).toContainText('2/2');
    await expect(activateBtn).toBeDisabled();

    // Audit log should contain two license.activate rows for this license
    await page.goto('/audit');
    // Filter by entity_type=license to narrow results
    await page.locator('select').first().selectOption('license');
    await page.getByRole('button', { name: /Apply/i }).click();

    const activateRows = page.locator(`tr:has-text("${licId}"):has-text("license.activate")`);
    await expect(activateRows).toHaveCount(2);
    // Most-recent first: details JSON includes the final 2/2 counter
    await expect(activateRows.first()).toContainText('"activations":2');
    await expect(activateRows.first()).toContainText('"activation_limit":2');
  });
});
