/**
 * Tool registry (P10): every tool page and format page, in display order.
 * Read by the routes, the prerender list, the home page and each tool page's <head>.
 * P22 fills in the SEO fields (title, description, howTo, faq); ids, groups and routes stay as they are.
 *
 * SEO copy rules (P22): plain words for people, no keyword stuffing, spelling that reads the same in
 * British and American English, and never a promise the tool doesn't keep (docs/03-features.md).
 * Titles ≤ 60 characters, descriptions ≤ 155, 3–5 how-to steps and 4–6 questions per working tool
 * (checked by registry.seo.test.ts). Phase 2 tools only get an honest "coming soon" title and description.
 *
 * Imported by react-router.config.ts at build time, so keep this file free of React and browser code.
 */
import type { FileKind } from '../core/contracts/intake';
import type { ImageFormat } from '../core/contracts/image';
import type { ToolGroup, ToolMeta } from '../core/contracts/tools';

/** Image kinds most image tools take (HEIC is decoded by the image engine). */
const IMAGES: FileKind[] = ['image', 'heic'];
const PDFS: FileKind[] = ['pdf'];

type Faq = { q: string; a: string };

// ---------- Answers shared by several pages ----------

/** "Is it free?" and "Are my files uploaded?" in one answer, for pages that need room for more. */
const freeAndPrivate = (files: string): Faq => ({
  q: 'Is it free, and are my files uploaded?',
  a: `It is free, with no sign-up, no watermark, no limits and no ads. Your ${files} are processed by your own browser and never leave your device. Snap Convert sets no cookies and only keeps anonymous usage counts, never anything about your files.`,
});

const isFree: Faq = {
  q: 'Is it really free?',
  a: 'Yes. Snap Convert is free and open source, with no sign-up, no watermark, no daily limit and no ads.',
};

const notUploaded = (files: string): Faq => ({
  q: `Are my ${files} uploaded?`,
  a: `No. Your ${files} are processed by your own browser, on your device, and are never sent to a server. Snap Convert sets no cookies and only keeps anonymous usage counts, never anything about your files.`,
});

const noSizeLimit = (files: string): Faq => ({
  q: 'Is there a file-size limit?',
  a: `No. There is no limit on the size or number of ${files}. The only limit is your device's memory, so very large files can be slow on an older phone.`,
});

const worksOnPhones = (extra: string): Faq => ({
  q: 'Does it work on my phone?',
  a: `Yes. It works in current browsers on Android phones, iPhones and iPads, as well as on computers. ${extra}`,
});

const imageFormats: Faq = {
  q: 'Which formats can I use?',
  a: 'You can add JPG, PNG, WebP, AVIF, GIF (first frame), BMP and HEIC images. Results are saved as JPG, PNG, WebP or AVIF.',
};

const pdfLinksNote =
  "Bookmarks, form fields and links from one page to another aren't carried over. Links to websites are kept.";

const pdfPassword: Faq = {
  q: 'Can I use a password-protected PDF?',
  a: 'Not yet. Remove the password in your PDF app first, then add the file again.',
};

/** FAQ for a format page (PNG to JPG …): the page's own questions, then privacy and phones. */
const formatFaq = (own: Faq[]): Faq[] => [
  ...own,
  freeAndPrivate('images'),
  worksOnPhones('You can pick images straight from your photo library.'),
];

// ---------- Tools ----------

/** The 14 tools from docs/05-architecture.md (URLs). Phase 2 tools show a "Coming soon" page. */
export const tools: readonly ToolMeta[] = [
  {
    id: 'compress-image',
    group: 'Images',
    name: 'Compress image',
    short: 'Smaller files, same look. Set quality or a target size.',
    icon: 'shrink',
    phase: 1,
    accepts: IMAGES,
    title: 'Compress Images and Keep Them Sharp — Free | Snap Convert',
    description:
      'Make JPG, PNG, WebP and AVIF images smaller without making them look worse. Set a quality or a target size in KB. Free, no sign-up, nothing uploaded.',
    howTo: [
      'Drop your images on the page, choose them from your device, or paste with Ctrl/⌘ + V.',
      'Keep the quality at 80, tap a quick preset such as WordPress or Email, or set a target size such as 200 KB.',
      'Drag the before/after slider to compare, and see how much smaller each file is.',
      'Download each image, or all of them as a ZIP.',
    ],
    faq: [
      isFree,
      notUploaded('images'),
      {
        q: 'Will my images look worse?',
        a: 'At the default quality of 80, most photos look the same as the original. Every result is checked with a visual similarity score, and very detailed or grainy photos get a higher quality to stay sharp. If you keep the size and format and your image was already well compressed, you get the original back instead of a bigger file. If a target size can only be reached by making the image look worse, Snap Convert says so and suggests smaller dimensions.',
      },
      {
        q: 'Which formats can I compress?',
        a: 'JPG, PNG, WebP, AVIF, GIF (first frame), BMP and HEIC. By default each image keeps its format; GIF, BMP and HEIC are saved as JPG. A target file size works with JPG, WebP and AVIF.',
      },
      noSizeLimit('images'),
      worksOnPhones('You can pick photos straight from your photo library.'),
    ],
  },
  {
    id: 'resize-image',
    group: 'Images',
    name: 'Resize image',
    short: 'Change width or height. Proportions always kept.',
    icon: 'scaling',
    phase: 1,
    accepts: IMAGES,
    title: 'Resize Images Without Stretching — Free | Snap Convert',
    description:
      'Resize images by width, height, longest side or percentage. Proportions are always kept, and exact sizes use fit or fill. Free and private.',
    howTo: [
      'Drop your images on the page, choose them from your device, or paste with Ctrl/⌘ + V.',
      'Choose how to resize: longest side, max width, max height, percentage or exact size.',
      'For an exact size, choose Fit (the whole image, with padding) or Fill (covers the box, edges trimmed), and which part to keep.',
      'Download each image, or all of them as a ZIP.',
    ],
    faq: [
      {
        q: 'Will my image be stretched or squashed?',
        a: 'Never. Width and height always change together, so the proportions stay the same. For an exact size such as 1080 × 1080, Fit adds padding around the image and Fill trims the edges that don’t fit. Neither one distorts the picture.',
      },
      {
        q: 'Can it make small images bigger?',
        a: 'Only if you turn on "Enlarge smaller images". By default, images that are already smaller than your size are left as they are, because enlarged images can look soft.',
      },
      {
        q: 'Will resized images stay sharp?',
        a: 'Yes. Images are scaled down with a high-quality filter so edges stay crisp, and phone photos are turned the right way up first.',
      },
      freeAndPrivate('images'),
      imageFormats,
      worksOnPhones('To resize hundreds of images at once, use Bulk resize & compress.'),
    ],
  },
  {
    id: 'convert-image',
    group: 'Images',
    name: 'Convert image',
    short: 'JPG, PNG, WebP, AVIF and HEIC.',
    icon: 'arrow-left-right',
    phase: 1,
    accepts: IMAGES,
    title: 'Convert Images to JPG, PNG, WebP, AVIF — Free | Snap Convert',
    description:
      'Convert JPG, PNG, WebP, AVIF, HEIC, GIF and BMP images to JPG, PNG, WebP or AVIF in your browser. Free, no sign-up, and your images are never uploaded.',
    howTo: [
      'Drop your images on the page, choose them from your device, or paste with Ctrl/⌘ + V.',
      'Choose the format to save as: JPG, PNG, WebP or AVIF.',
      'Converting see-through images to JPG? Pick what fills the transparent areas (white by default).',
      'Download each image, or all of them as a ZIP.',
    ],
    faq: [
      {
        q: 'Which format should I choose?',
        a: 'JPG for photos that need to open everywhere. PNG for screenshots, logos and text, or when you need transparency. WebP for smaller files that work in all modern browsers. AVIF for the smallest files; it takes longer to make, and very old browsers can’t show it.',
      },
      {
        q: 'What happens to transparent areas?',
        a: 'PNG, WebP and AVIF keep them. JPG can’t store transparency, so see-through areas are filled with the background you pick.',
      },
      {
        q: 'Will converting make my images look worse?',
        a: 'PNG keeps every pixel. JPG, WebP and AVIF are saved at quality 85 by default, and each result is checked so it stays crisp.',
      },
      {
        q: 'Can I convert animated GIFs?',
        a: 'Only the first frame of a GIF is converted, as a still image.',
      },
      freeAndPrivate('images'),
      worksOnPhones('You can pick images straight from your photo library.'),
    ],
  },
  {
    id: 'optimize-for-web',
    group: 'Images',
    name: 'Optimize for web',
    short: 'One click for fast-loading website images.',
    icon: 'gauge',
    phase: 1,
    accepts: IMAGES,
    title: 'Optimize Images for Your Website — Free | Snap Convert',
    description:
      'Small, sharp images for WordPress, Shopify, blogs and email in one click: resized, compressed and stripped of location data. Free and private.',
    howTo: [
      'Pick where the images are going: a website, WordPress, Shopify, a blog hero, email or a thumbnail.',
      'Drop your images. Each one is resized, compressed and cleaned up straight away.',
      'Keep JPG, or choose WebP for smaller files (AVIF is under Advanced).',
      'Download each image, or all of them as a ZIP.',
    ],
    faq: [
      {
        q: 'What does it do to my images?',
        a: 'It shrinks each image to fit the place it’s going, converts it to sRGB so it looks right in every browser, saves it at quality 80 (as a progressive JPG unless you choose WebP or AVIF), and removes location and camera details. Images are never enlarged or stretched.',
      },
      {
        q: 'What sizes are used?',
        a: 'The longest side becomes 1920 px for a general website, 2048 px for WordPress and Shopify, 1600 px for a blog hero, 800 px for email and 400 px for a thumbnail. These are big enough to look sharp on high-resolution screens. You’ll see a warning if an image is small for its use.',
      },
      {
        q: 'Should I use JPG, WebP or AVIF?',
        a: 'JPG works everywhere. WebP is about 25% smaller and works in all modern browsers. AVIF makes the smallest files, but takes longer to make.',
      },
      {
        q: 'Will my images look worse?',
        a: 'No. Every result is checked with a visual similarity score, and very grainy photos get a higher quality to stay sharp. If an image was already well compressed, you get the original back with its location data removed.',
      },
      freeAndPrivate('images'),
      worksOnPhones('You can optimize many images at once.'),
    ],
  },
  {
    id: 'bulk-resize',
    group: 'Images',
    name: 'Bulk resize & compress',
    short: 'Hundreds of images at once, downloaded as a ZIP.',
    icon: 'layers',
    phase: 1,
    accepts: IMAGES,
    title: 'Bulk Resize and Compress Images — Free | Snap Convert',
    description:
      'Resize and compress hundreds of images at once with one set of settings, then download them as a ZIP. No limits, no upload, never stretched.',
    howTo: [
      'Drop as many images as you like, or a whole folder.',
      'Choose one size, format and quality for all of them, and a file-name pattern such as {name}-{width}w.',
      'Press Resize. Each file shows its progress, with an estimate of the time left.',
      'Download everything as one ZIP, or use Save to folder in Chrome or Edge on a computer.',
    ],
    faq: [
      {
        q: 'How many images can I resize at once?',
        a: 'Hundreds. There is no limit on the number or size of images; the speed depends on your device. Computers work on several images at the same time, phones on two, so the page stays responsive.',
      },
      {
        q: 'Is there a limit on the ZIP?',
        a: 'One ZIP can hold up to 4 GB and 65,535 files. For more than that, download in smaller groups or use Save to folder.',
      },
      {
        q: 'Will my images be stretched or enlarged?',
        a: 'Never. Proportions are always kept, and images already smaller than your size are left as they are unless you turn on enlarging.',
      },
      {
        q: 'What if a file fails?',
        a: 'It is marked with the reason, the rest carry on, and you can retry it on its own.',
      },
      freeAndPrivate('images'),
      worksOnPhones('Keep the page open while a big batch runs.'),
    ],
  },
  {
    id: 'heic-to-jpg',
    group: 'Images',
    name: 'HEIC to JPG',
    short: 'Open iPhone photos anywhere.',
    icon: 'smartphone',
    phase: 1,
    accepts: ['heic'],
    title: 'HEIC to JPG Converter — Free and Private | Snap Convert',
    description:
      'Turn iPhone and iPad HEIC photos into JPGs that open anywhere. Photos stay upright and full size, and are never uploaded. Free, no sign-up.',
    howTo: [
      'Drop your HEIC or HEIF photos on the page, or choose them from your device.',
      'Keep JPG, or choose PNG.',
      'Download each photo, or all of them as a ZIP.',
    ],
    faq: [
      {
        q: 'What is a HEIC file?',
        a: 'iPhones and iPads save photos as HEIC because it takes about half the space of JPG. Many apps and websites can’t open it, so converting to JPG makes your photos work everywhere.',
      },
      {
        q: 'Will my photos stay the right way up?',
        a: 'Yes. The rotation saved by the camera is applied, so photos come out upright.',
      },
      {
        q: 'Do I lose quality or size?',
        a: 'Photos keep their full size. JPGs are saved at quality 90 by default and checked so they stay crisp.',
      },
      {
        q: 'What happens to the location and other photo details?',
        a: 'By default the GPS location is removed and other details, such as the date taken, stay in the JPG. You can also remove everything or keep everything. PNG files don’t keep these details.',
      },
      notUploaded('photos'),
      worksOnPhones('It is free, with no sign-up and no limit on the number of photos.'),
    ],
  },
  {
    id: 'images-to-pdf',
    group: 'PDF',
    name: 'Images to PDF',
    short: 'Turn photos or scans into one PDF.',
    icon: 'file-image',
    phase: 1,
    accepts: IMAGES,
    title: 'Images to PDF — Turn Photos into One PDF | Snap Convert',
    description:
      'Combine JPG, PNG, HEIC and other images into one PDF, in the order you choose. A4, Letter or fit to image, never stretched. Free and private.',
    howTo: [
      'Add your images: JPG, PNG, HEIC, WebP, AVIF, GIF or BMP. Each image becomes one page.',
      'Drag the images into the order you want.',
      'Choose the page size (A4, Letter, A5, Legal or Fit to image), the margin and the image quality.',
      'Press Make PDF, then download it.',
    ],
    faq: [
      {
        q: 'Will my images be stretched to fit the page?',
        a: 'Never. Each image is fitted inside the margins and placed in the middle of the page. With Auto orientation, each page turns to match its image.',
      },
      {
        q: 'Which quality should I pick?',
        a: 'Original puts your images in as they are, for the best quality. Smaller file resizes them to 2480 px (A4 at 300 dpi) and compresses them, which suits email.',
      },
      {
        q: 'Which page size should I use?',
        a: 'A4 or Letter is chosen for you based on your region. Fit to image makes each page exactly the size of its image, with no margins needed.',
      },
      noSizeLimit('images'),
      freeAndPrivate('images'),
      worksOnPhones('Add photos from your photo library and reorder them with the move buttons.'),
    ],
  },
  {
    id: 'merge-pdf',
    group: 'PDF',
    name: 'Merge PDF',
    short: 'Combine several PDFs into one, in any order.',
    icon: 'combine',
    phase: 1,
    accepts: PDFS,
    title: 'Merge PDF Files — Free, No Upload | Snap Convert',
    description:
      'Combine several PDF files into one, in any order, right in your browser. Pages keep their size and quality. Free, no sign-up, never uploaded.',
    howTo: [
      'Drop two or more PDF files on the page.',
      'Drag the files into the order you want.',
      'Name the merged file and press Merge.',
      'Download your merged PDF.',
    ],
    faq: [
      {
        q: 'Will my pages change?',
        a: 'No. Pages keep their original size, quality and rotation. To make every page the same paper size, use Resize PDF afterwards.',
      },
      { q: 'Is everything carried over?', a: pdfLinksNote },
      pdfPassword,
      noSizeLimit('PDFs'),
      freeAndPrivate('PDFs'),
      worksOnPhones('Press and hold a file to drag it into place.'),
    ],
  },
  {
    id: 'split-pdf',
    group: 'PDF',
    name: 'Split PDF',
    short: 'Split by page, range or every N pages.',
    icon: 'split',
    phase: 1,
    accepts: PDFS,
    title: 'Split PDF by Pages or Ranges — Free | Snap Convert',
    description:
      'Split a PDF into single pages, every N pages, or custom ranges like 1-3, 5, 8-10. Download the parts as a ZIP. Free, and nothing is uploaded.',
    howTo: [
      'Drop one PDF on the page.',
      'Choose how to split it: every page, every N pages, or custom ranges such as 1-3, 5, 8-10.',
      'Press Split.',
      'Download each part, or all of them as a ZIP.',
    ],
    faq: [
      {
        q: 'How do custom ranges work?',
        a: 'Each range becomes its own PDF. Separate ranges with commas: 1-3, 5, 8-10 makes three PDFs, with pages 1 to 3, page 5, and pages 8 to 10.',
      },
      {
        q: 'Do the pages lose quality?',
        a: 'No. Pages are copied as they are, so text and images stay exactly the same.',
      },
      { q: 'Is everything carried over?', a: pdfLinksNote },
      pdfPassword,
      freeAndPrivate('PDFs'),
      worksOnPhones('Long PDFs work too; there is no page or file-size limit.'),
    ],
  },
  {
    id: 'organize-pdf',
    group: 'PDF',
    name: 'Organize pages',
    short: 'Reorder, rotate or delete pages.',
    icon: 'layout-grid',
    phase: 1,
    accepts: PDFS,
    title: 'Reorder, Rotate and Delete PDF Pages — Free | Snap Convert',
    description:
      'See every page of a PDF, then drag to reorder, rotate or delete pages, with undo. Save the new PDF in seconds. Free, and nothing is uploaded.',
    howTo: [
      'Drop a PDF on the page to see every page as a thumbnail.',
      'Select pages: click, Ctrl/⌘-click to add, Shift-click for a range, or press and hold on a touch screen.',
      'Drag to reorder, rotate left or right, or delete. Undo and redo any step.',
      'Press Save PDF, then download it.',
    ],
    faq: [
      {
        q: 'Can I undo a change?',
        a: 'Yes. Every move, rotation and deletion can be undone and redone (Ctrl/⌘ + Z) until you save. Your original file is never changed.',
      },
      {
        q: 'Can I use the keyboard?',
        a: 'Yes. Arrow keys move between pages, Space selects, Alt + arrows move the selected pages, and Delete removes them.',
      },
      {
        q: 'Do rotated or moved pages lose quality?',
        a: 'No. Pages are not redrawn, so text stays sharp and selectable.',
      },
      { q: 'Is everything kept?', a: pdfLinksNote },
      freeAndPrivate('PDFs'),
      worksOnPhones('Press and hold a page to select it, then tap more pages.'),
    ],
  },
  {
    id: 'resize-pdf',
    group: 'PDF',
    name: 'Resize PDF',
    short: 'Change page size, e.g. A4 to Letter.',
    icon: 'scan',
    phase: 1,
    accepts: PDFS,
    title: 'Resize PDF Pages to A4 or Letter — Free | Snap Convert',
    description:
      'Change the page size of a PDF to A4, Letter, A5, Legal or a custom size. Content is scaled to fit, never stretched, and text stays selectable.',
    howTo: [
      'Drop one or more PDF files on the page.',
      'Choose a page size: A4, Letter, A5, Legal, or a custom width and height in mm or inches.',
      'Choose the orientation: Auto keeps each page’s own, or make every page portrait or landscape.',
      'Press Resize, then download each PDF, or all of them as a ZIP.',
    ],
    faq: [
      {
        q: 'Will my pages be stretched?',
        a: 'Never. The content is scaled evenly to fit the new page and placed in the middle, so nothing is squashed. The preview shows the result before you resize.',
      },
      {
        q: 'Does text stay sharp and selectable?',
        a: 'Yes. Pages are scaled, not turned into pictures, so text stays sharp and you can still select and search it.',
      },
      {
        q: 'What about PDFs with mixed page sizes?',
        a: 'Every page gets the paper size you choose. With Auto orientation, portrait pages stay portrait and landscape pages stay landscape.',
      },
      {
        q: 'Is everything kept?',
        a: 'Links and form fields are not kept. Password-protected PDFs need the password removed first.',
      },
      freeAndPrivate('PDFs'),
      worksOnPhones('You can resize several PDFs at once.'),
    ],
  },
  {
    id: 'remove-background',
    group: 'Power tools',
    name: 'Remove background',
    short: 'Clean cut-outs at full resolution.',
    icon: 'eraser',
    phase: 2,
    accepts: IMAGES,
    title: 'Remove Background from Images — Coming Soon | Snap Convert',
    description:
      'Coming soon: remove the background from photos at full resolution, right in your browser. Until then, Snap Convert’s image and PDF tools are ready.',
  },
  {
    id: 'raw-to-jpg',
    group: 'Power tools',
    name: 'RAW to JPG',
    short: 'Camera RAW photos (CR3, NEF, ARW, DNG…) to JPG.',
    icon: 'camera',
    phase: 2,
    accepts: ['raw'],
    title: 'RAW to JPG Converter — Coming Soon | Snap Convert',
    description:
      'Coming soon: turn camera RAW photos (CR2, CR3, NEF, ARW, DNG and more) into JPGs in your browser. Until then, the image and PDF tools are ready.',
  },
  {
    id: 'pdf-to-images',
    group: 'Power tools',
    name: 'PDF to images',
    short: 'Every page as a JPG or PNG.',
    icon: 'images',
    phase: 2,
    accepts: PDFS,
    title: 'PDF to JPG or PNG Images — Coming Soon | Snap Convert',
    description:
      'Coming soon: save every page of a PDF as a JPG or PNG image, right in your browser. Until then, Merge, Split and the other PDF tools are ready.',
  },
];

// ---------- Format pages ----------

/** A landing page for one conversion (e.g. PNG to JPG) that opens Convert image with the target pre-set. */
export interface FormatPageMeta extends ToolMeta {
  /** The tool this page reuses. */
  tool: 'convert-image';
  from: ImageFormat;
  to: ImageFormat;
}

const formatLabel: Record<ImageFormat, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
};

const formatSlug: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

/** The SEO copy each format page brings (title and how-to are built from the formats). */
interface FormatSeo {
  description: string;
  /** Middle how-to step, e.g. the background for transparent areas. */
  step: string;
  faq: Faq[];
}

function formatPage(from: ImageFormat, to: ImageFormat, seo: FormatSeo): FormatPageMeta {
  const a = formatLabel[from];
  const b = formatLabel[to];
  return {
    id: `${formatSlug[from]}-to-${formatSlug[to]}`,
    group: 'Images',
    name: `${a} to ${b}`,
    short: `Convert ${a} images to ${b}, right in your browser.`,
    icon: 'arrow-left-right',
    phase: 1,
    accepts: ['image'],
    tool: 'convert-image',
    from,
    to,
    title: `${a} to ${b} Converter — Free, No Upload | Snap Convert`,
    description: seo.description,
    howTo: [
      `Drop your ${a} images on the page, choose them from your device, or paste with Ctrl/⌘ + V.`,
      seo.step,
      `Download each ${b}, or all of them as a ZIP.`,
    ],
    faq: formatFaq(seo.faq),
  };
}

const transparencyToJpg: Faq = {
  q: 'What happens to transparent areas?',
  a: 'JPG can’t store transparency, so see-through areas are filled with the background you pick. White is the default.',
};

const jpgQuality: Faq = {
  q: 'Will my images look worse?',
  a: 'JPGs are saved at quality 85 by default, and each result is checked so it stays crisp.',
};

/** Format pages (served by Convert image with preset settings). */
export const formatPages: readonly FormatPageMeta[] = [
  formatPage('png', 'jpeg', {
    description:
      'Convert PNG images to smaller JPGs in your browser. Pick a background for transparent areas. Free, no sign-up, and your images are never uploaded.',
    step: 'JPG is already chosen. Pick a background for transparent areas (white by default).',
    faq: [
      {
        q: 'Why convert PNG to JPG?',
        a: 'Photos saved as PNG are often several times larger than they need to be. JPG makes them much smaller and opens everywhere.',
      },
      transparencyToJpg,
      {
        q: 'Will my images look worse?',
        a: 'JPGs are saved at quality 85 by default, and each result is checked so it stays crisp. Screenshots, logos and text often stay sharper as PNG.',
      },
    ],
  }),
  formatPage('jpeg', 'png', {
    description:
      'Convert JPG photos to lossless PNG files in your browser, ready for editing and apps that need PNG. Free, no sign-up, and nothing is uploaded.',
    step: 'PNG is already chosen. You can also resize the images if you need to.',
    faq: [
      {
        q: 'Why convert JPG to PNG?',
        a: 'PNG is lossless: nothing more is lost when you edit and save it again, and some apps and print services ask for PNG files.',
      },
      {
        q: 'Will converting improve the quality?',
        a: 'No. Converting can’t bring back detail the JPG already lost, but the PNG keeps every pixel that is there. PNG files are usually larger than JPGs.',
      },
      {
        q: 'Will the PNG have a transparent background?',
        a: 'No. A JPG has no transparency, so the PNG looks exactly like the original. To cut out the subject, Remove background is coming soon.',
      },
    ],
  }),
  formatPage('webp', 'jpeg', {
    description:
      'Convert WebP images to JPGs that open in every app and on every device. Runs in your browser: free, no sign-up, and your images are never uploaded.',
    step: 'JPG is already chosen. Pick a background for transparent areas (white by default).',
    faq: [
      {
        q: 'Why convert WebP to JPG?',
        a: 'WebP is common on websites, but some apps, editors and older software can’t open it. JPG opens everywhere.',
      },
      transparencyToJpg,
      jpgQuality,
    ],
  }),
  formatPage('jpeg', 'webp', {
    description:
      'Convert JPG photos to WebP for smaller files and faster web pages. Works in all modern browsers. Free, no sign-up, and nothing is uploaded.',
    step: 'WebP is already chosen. You can also resize the images to the size your site needs.',
    faq: [
      {
        q: 'Why convert JPG to WebP?',
        a: 'WebP files are usually about 25% smaller than JPGs that look the same, so pages load faster. All modern browsers show WebP.',
      },
      {
        q: 'Will my images look worse?',
        a: 'WebP images are saved at quality 85 by default, and each result is checked so it stays crisp.',
      },
      {
        q: 'Can my website use WebP?',
        a: 'Most website builders, including WordPress and Shopify, accept WebP images. If yours doesn’t, keep JPG.',
      },
    ],
  }),
  formatPage('png', 'webp', {
    description:
      'Convert PNG images to WebP: much smaller files that keep transparency, for faster websites. Free, in your browser, and nothing is uploaded.',
    step: 'WebP is already chosen. Transparent areas stay transparent.',
    faq: [
      {
        q: 'Why convert PNG to WebP?',
        a: 'For photos and detailed images, WebP files are usually much smaller than PNG, and WebP keeps transparency, so pages load faster.',
      },
      {
        q: 'Will my images look worse?',
        a: 'WebP images are saved at quality 85 by default, and each result is checked so it stays crisp. Screenshots, logos and text can stay sharper as PNG.',
      },
      {
        q: 'Does WebP keep transparency?',
        a: 'Yes. See-through areas of your PNG stay see-through in the WebP.',
      },
    ],
  }),
  formatPage('avif', 'jpeg', {
    description:
      'Convert AVIF images to JPGs that open in any app or device. Runs in your browser, so it’s free, needs no sign-up and nothing is uploaded.',
    step: 'JPG is already chosen. Pick a background for transparent areas (white by default).',
    faq: [
      {
        q: 'Why convert AVIF to JPG?',
        a: 'AVIF makes very small files, but many apps, editors and older devices can’t open it yet. JPG opens everywhere.',
      },
      transparencyToJpg,
      jpgQuality,
    ],
  }),
];

/** Tool groups in the order the home page lists them. */
export const toolGroups: readonly ToolGroup[] = ['Images', 'PDF', 'Power tools'];

export type PageMeta = ToolMeta | FormatPageMeta;

const pagesById = new Map<string, PageMeta>([...tools, ...formatPages].map((p) => [p.id, p]));

/** A tool or format page by its URL slug. */
export function getPage(id: string | undefined): PageMeta | undefined {
  return id === undefined ? undefined : pagesById.get(id);
}

/** A tool (not a format page) by its id. */
export function getTool(id: string | undefined): ToolMeta | undefined {
  return tools.find((t) => t.id === id);
}

export function isFormatPage(page: PageMeta): page is FormatPageMeta {
  return 'tool' in page && 'from' in page && 'to' in page;
}

/** Tools available now (phase 1). */
export function isAvailable(page: PageMeta): boolean {
  return page.phase === 1;
}

export function toolsInGroup(group: ToolGroup): ToolMeta[] {
  return tools.filter((t) => t.group === group);
}

/** Public address of the app; canonical URLs are built from it. */
export const SITE_URL = 'https://crkayes.com/snap-convert/';

/** Canonical URL for a page id, or the home page when no id is given. */
export function canonicalUrl(id?: string): string {
  return id ? `${SITE_URL}${id}` : SITE_URL;
}

// ---------- Social previews and structured data (P22) ----------

/** Size of every Open Graph image in public/og/. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * Absolute URL of the social preview image for a page: one per group (Images, PDF) and one for the
 * home page, which the "Coming soon" tools also use. Omit the page for the home page.
 */
export function ogImageUrl(page?: Pick<ToolMeta, 'group' | 'phase'>): string {
  const name = page && page.phase === 1 ? (page.group === 'PDF' ? 'pdf' : 'images') : 'home';
  return `${SITE_URL}og/${name}.png`;
}

/**
 * schema.org `SoftwareApplication` for the home page (JSON-LD). Only facts: free, runs on the web.
 * No ratings or reviews (Snap Convert has none to show), so Google treats it as plain structured
 * data rather than a rating rich result. `HowTo` and `FAQPage` are not used: Google dropped both
 * rich results (HowTo in 2023, FAQ in 2026), so the FAQ is plain HTML.
 */
export const homeStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Snap Convert',
  url: SITE_URL,
  description:
    'Free, open-source image and PDF converter that runs in your browser. Compress, resize and convert images, and merge, split and organize PDFs, without uploading anything.',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  image: ogImageUrl(),
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
} as const;
