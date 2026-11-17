// Search content below the Resize image page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import {
  freeAndPrivate,
  imageFormats,
  worksOnPhones,
  type SeoContent,
} from '../_shared/seo-content';

export const content: SeoContent = {
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
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to resize images" content={content} />;
}
