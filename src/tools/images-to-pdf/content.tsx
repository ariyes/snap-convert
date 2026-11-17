// Search content below the Images to PDF page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import {
  freeAndPrivate,
  noSizeLimit,
  worksOnPhones,
  type SeoContent,
} from '../_shared/seo-content';

export const content: SeoContent = {
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
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to turn images into a PDF" content={content} />;
}
