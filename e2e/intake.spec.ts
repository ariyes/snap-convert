// File intake on the home page (P11 DropZone, wired in by P13b): pick, drop and paste, with each
// file's kind read from its first bytes, never from its name.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

interface Fixture {
  /** Name the file gets in the test (may differ from the fixture's own name). */
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** A file from tests/fixtures/, optionally under another name and MIME type. */
function fixture(file: string, name = path.basename(file), mimeType = ''): Fixture {
  return { name, mimeType, buffer: readFileSync(path.resolve('tests/fixtures', file)) };
}

const photo = (name = 'photo.jpg') => fixture('images/no-exif.jpg', name, 'image/jpeg');
const png = (name = 'logo.png') => fixture('images/alpha.png', name, 'image/png');
const pdf = (name = 'doc.pdf') => fixture('intake/sample.pdf', name, 'application/pdf');

const dropZone = (page: Page) => page.getByRole('button', { name: /^Drop any files here/ });
const question = (page: Page) => page.getByText(/^What do you want to do with/);
const chips = (page: Page) =>
  page.getByRole('list', { name: 'Suggested tools' }).getByRole('button');
const received = (page: Page) =>
  page.getByRole('list', { name: /ready from the home page/ }).getByRole('listitem');

const IMAGE_CHIPS = [
  'Compress',
  'Resize',
  'Convert',
  'Optimize for web',
  'Make a PDF',
  'Remove backgroundSoon',
];
const PDF_CHIPS = ['Merge', 'Split', 'Organize pages', 'Resize pages'];

async function pick(page: Page, files: Fixture[]) {
  const chooser = page.waitForEvent('filechooser');
  await dropZone(page).click();
  await (await chooser).setFiles(files);
}

/** Serialisable form of the fixtures, to rebuild them as File objects inside the page. */
const forPage = (files: Fixture[]) =>
  files.map((f) => ({ name: f.name, type: f.mimeType, base64: f.buffer.toString('base64') }));

/** A real DataTransfer holding these files, created in the page. */
function dataTransfer(page: Page, files: Fixture[]) {
  return page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    return dt;
  }, forPage(files));
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  // The pre-rendered drop box takes files once its code has loaded and hydrated.
  await expect(page.getByTestId('home-drop')).toHaveAttribute('data-live', 'true');
});

test('picked files lead to the tools for them', async ({ page }) => {
  await pick(page, [photo('one.jpg'), png('two.png'), pdf('three.pdf')]);
  await expect(question(page)).toHaveText('What do you want to do with 2 images and 1 PDF?');
  await expect(chips(page)).toHaveText([...IMAGE_CHIPS, ...PDF_CHIPS]);

  await chips(page).filter({ hasText: 'Make a PDF' }).click();
  await expect(page).toHaveURL(/\/images-to-pdf$/);
  await expect(received(page)).toHaveText(['one.jpg', 'two.png']);
});

test('the drop button is named by its own text, and takes clicks anywhere in the box', async ({
  page,
}) => {
  const zone = dropZone(page);
  // WCAG 2.5.3: the name is the button's visible text; the formats and paste hint describe it.
  await expect(zone).toHaveAccessibleName('Drop any files here Choose files');
  await expect(zone).toHaveAccessibleDescription(
    /^JPG · PNG · WebP · AVIF · HEIC · PDF · RAW or paste with (Ctrl|Command) \+ V$/,
  );
  // The formats line and paste hint sit outside the button but inside the box: the button's
  // overlay still takes clicks there, and in the box's corners, so the whole box opens the picker.
  const hits = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="home-drop"] [role="button"]');
    const box = button?.parentElement?.getBoundingClientRect();
    const sub = button?.nextElementSibling?.getBoundingClientRect();
    const hint = button?.nextElementSibling?.nextElementSibling?.getBoundingClientRect();
    if (!box || !sub || !hint) return 'missing';
    const points: Array<[number, number]> = [
      [sub.x + sub.width / 2, sub.y + sub.height / 2],
      [hint.x + 4, hint.y + hint.height / 2],
      [box.x + 8, box.y + 8],
      [box.right - 8, box.bottom - 8],
    ];
    return points.map(([x, y]) => document.elementFromPoint(x, y) === button);
  });
  expect(hits).toEqual([true, true, true, true]);
});

test('dropped files lead to the tools for them', async ({ page }) => {
  // In-memory files: WebKit's entries for them can't be opened, so this also covers the fallback
  // to the plain file in filesFromDataTransfer.
  const dt = await dataTransfer(page, [pdf('a.pdf'), pdf('b.pdf'), photo('c.jpg')]);
  const zone = dropZone(page);
  await zone.dispatchEvent('dragenter', { dataTransfer: dt });
  await zone.dispatchEvent('dragover', { dataTransfer: dt });
  await expect(zone).toHaveAttribute('data-over', 'true');
  await zone.dispatchEvent('drop', { dataTransfer: dt });

  await expect(zone).not.toHaveAttribute('data-over');
  await expect(question(page)).toHaveText('What do you want to do with 1 image and 2 PDFs?');
  await expect(chips(page)).toHaveText([...IMAGE_CHIPS, ...PDF_CHIPS]);

  await chips(page).filter({ hasText: 'Merge' }).click();
  await expect(page).toHaveURL(/\/merge-pdf$/);
  await expect(received(page)).toHaveText(['a.pdf', 'b.pdf']);
});

test('a pasted image leads to the image tools, with a useful name', async ({ page }) => {
  const dt = await dataTransfer(page, [png('image.png')]);
  await page.evaluate((clipboardData) => {
    // Some engines ignore `clipboardData` in the constructor; set it on the event directly then.
    let event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    if (!event.clipboardData) {
      event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    }
    document.body.dispatchEvent(event);
  }, dt);

  await expect(page.getByText('Pasted 1 file')).toBeVisible();
  await expect(question(page)).toHaveText('What do you want to do with 1 image?');
  await expect(chips(page)).toHaveText(IMAGE_CHIPS);

  await chips(page).filter({ hasText: 'Compress' }).click();
  await expect(page).toHaveURL(/\/compress-image$/);
  await expect(received(page)).toHaveText([/^pasted-\d{4}-\d{2}-\d{2}-\d+\.png$/]);
});

test('a JPEG renamed .png counts as an image', async ({ page }) => {
  await pick(page, [fixture('intake/jpeg-renamed.png', 'jpeg-renamed.png', 'image/png')]);
  await expect(question(page)).toHaveText('What do you want to do with 1 image?');
  await expect(chips(page)).toHaveText(IMAGE_CHIPS);

  await chips(page).filter({ hasText: 'Convert' }).click();
  await expect(page).toHaveURL(/\/convert-image$/);
  await expect(received(page)).toHaveText(['jpeg-renamed.png']);
});

test('a text file renamed .jpg is "unknown"', async ({ page }) => {
  await pick(page, [fixture('intake/text-renamed.jpg', 'text-renamed.jpg', 'image/jpeg')]);
  await expect(question(page)).toHaveText('What do you want to do with 1 other file?');
  await expect(page.getByText("Snap Convert doesn't handle this file type yet.")).toBeVisible();
  await expect(chips(page)).toHaveCount(0);
});

test('a PDF renamed .jpg is a PDF, and RAW photos are recognised by their bytes', async ({
  page,
}) => {
  await pick(page, [
    fixture('intake/pdf-renamed.jpg', 'pdf-renamed.jpg', 'image/jpeg'),
    fixture('intake/sample.cr3'),
  ]);
  await expect(question(page)).toHaveText('What do you want to do with 1 PDF and 1 RAW photo?');
  await expect(chips(page)).toHaveText([...PDF_CHIPS, 'RAW to JPGSoon']);

  await chips(page).filter({ hasText: 'Split' }).click();
  await expect(page).toHaveURL(/\/split-pdf$/);
  await expect(received(page)).toHaveText(['pdf-renamed.jpg']);
});
