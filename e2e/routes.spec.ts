// P24 smoke: every pre-rendered page loads, hydrates and settles with no console errors, no page
// errors and no failed requests, and has no serious or critical axe issues.
import AxeBuilder from '@axe-core/playwright';
import { prerenderRoutes } from '../src/app/prerender-routes';
import { expect, test } from './support/test';

test('every page is in the list', () => {
  expect(prerenderRoutes.length).toBeGreaterThanOrEqual(23);
});

for (const route of prerenderRoutes) {
  test(`${route} loads cleanly and has no serious accessibility issues`, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
    });
    page.on('requestfailed', (r) => problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`));

    const response = await page.goto(`.${route}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(problems).toEqual([]);

    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
}
