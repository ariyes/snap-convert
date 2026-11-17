import { expect, test } from './support/test';

test('home page renders and is cross-origin isolated', async ({ page }) => {
  const response = await page.goto('./');
  expect(response?.status()).toBe(200);

  const headers = response?.headers() ?? {};
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
  // Every browser, Safari included (D43): Safari doesn't support credentialless isolation.
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await expect(page).toHaveTitle(/^Snap Convert/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
