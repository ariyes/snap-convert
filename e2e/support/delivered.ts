// Confirms that files picked on the home page reached a tool, without depending on how each tool
// page shows its files. `usePendingFiles` fires a local `snapconvert:files-delivered` event.
import { expect, type Page } from '@playwright/test';

interface Delivery {
  toolId: string;
  names: string[];
}

/** Call after `page.goto('./')` and before choosing a tool. */
export async function watchDeliveries(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __delivered: Delivery[] };
    w.__delivered = [];
    window.addEventListener('snapconvert:files-delivered', (e) => {
      w.__delivered.push((e as CustomEvent<Delivery>).detail);
    });
  });
}

/** Waits until `toolId` received exactly these files (strings or patterns), in this order. */
export async function expectDelivered(
  page: Page,
  toolId: string,
  names: Array<string | RegExp>,
): Promise<void> {
  await expect
    .poll(async () => {
      const all = await page.evaluate(
        () => (window as unknown as { __delivered?: Delivery[] }).__delivered ?? [],
      );
      const got = all.find((d) => d.toolId === toolId)?.names;
      if (!got || got.length !== names.length) return false;
      return names.every((n, i) =>
        typeof n === 'string' ? got[i] === n : n.test(got[i] ?? ''),
      );
    })
    .toBe(true);
}
