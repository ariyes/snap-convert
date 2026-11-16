import { expect, test } from '@playwright/test';

test('home page renders and is cross-origin isolated', async ({ page }) => {
  const response = await page.goto('./');
  expect(response?.status()).toBe(200);

  const headers = response?.headers() ?? {};
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cross-origin-embedder-policy']).toBe('credentialless');

  await expect(page).toHaveTitle('Snap Convert');
  await expect(page.getByRole('heading', { level: 1, name: 'Snap Convert' })).toBeVisible();
});
