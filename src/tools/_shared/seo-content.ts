/**
 * How-to and FAQ data for the search content under tool pages (P22): the answers several pages
 * share, and the builder for format pages. Only `src/tools/<id>/content.tsx` files import this, and
 * those load lazily on their own page, so none of this text is in the home page's startup code.
 * Titles and descriptions stay in the registry, because every page's <head> needs them.
 *
 * Copy rules: plain words for people, no keyword stuffing, spelling that reads the same in British
 * and American English, and never a promise the tool doesn't keep (docs/03-features.md). 3–5 steps
 * and 4–6 questions per page (checked by registry.seo.test.ts).
 */

export interface Faq {
  q: string;
  a: string;
}

/** What one page's content.tsx shows: the how-to steps and the FAQ. */
export interface SeoContent {
  howTo: readonly string[];
  faq: readonly Faq[];
}

// ---------- Answers shared by several pages ----------

/** "Is it free?" and "Are my files uploaded?" in one answer, for pages that need room for more. */
export const freeAndPrivate = (files: string): Faq => ({
  q: 'Is it free, and are my files uploaded?',
  a: `It is free, with no sign-up, no watermark, no limits and no ads. Your ${files} are processed by your own browser and never leave your device. Snap Convert sets no cookies and only keeps anonymous usage counts, never anything about your files.`,
});

export const isFree: Faq = {
  q: 'Is it really free?',
  a: 'Yes. Snap Convert is free and open source, with no sign-up, no watermark, no daily limit and no ads.',
};

export const notUploaded = (files: string): Faq => ({
  q: `Are my ${files} uploaded?`,
  a: `No. Your ${files} are processed by your own browser, on your device, and are never sent to a server. Snap Convert sets no cookies and only keeps anonymous usage counts, never anything about your files.`,
});

export const noSizeLimit = (files: string): Faq => ({
  q: 'Is there a file-size limit?',
  a: `No. There is no limit on the size or number of ${files}. The only limit is your device's memory, so very large files can be slow on an older phone.`,
});

export const worksOnPhones = (extra: string): Faq => ({
  q: 'Does it work on my phone?',
  a: `Yes. It works in current browsers on Android phones, iPhones and iPads, as well as on computers. ${extra}`,
});

export const imageFormats: Faq = {
  q: 'Which formats can I use?',
  a: 'You can add JPG, PNG, WebP, AVIF, GIF (first frame), BMP and HEIC images. Results are saved as JPG, PNG, WebP or AVIF.',
};

export const pdfLinksNote =
  "Bookmarks, form fields and links from one page to another aren't carried over. Links to websites are kept.";

export const pdfPassword: Faq = {
  q: 'Can I use a password-protected PDF?',
  a: 'Not yet. Remove the password in your PDF app first, then add the file again.',
};

// ---------- Format pages (PNG to JPG …) ----------

export const transparencyToJpg: Faq = {
  q: 'What happens to transparent areas?',
  a: 'JPG can’t store transparency, so see-through areas are filled with the background you pick. White is the default.',
};

export const jpgQuality: Faq = {
  q: 'Will my images look worse?',
  a: 'JPGs are saved at quality 85 by default, and each result is checked so it stays crisp.',
};

/**
 * Content of a format page: three steps around the page's own middle step, then the page's own
 * questions followed by privacy and phones. `from`/`to` are format names as users know them ("PNG").
 */
export function formatContent(from: string, to: string, step: string, own: Faq[]): SeoContent {
  return {
    howTo: [
      `Drop your ${from} images on the page, choose them from your device, or paste with Ctrl/⌘ + V.`,
      step,
      `Download each ${to}, or all of them as a ZIP.`,
    ],
    faq: [
      ...own,
      freeAndPrivate('images'),
      worksOnPhones('You can pick images straight from your photo library.'),
    ],
  };
}
