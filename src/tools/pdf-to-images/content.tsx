// Search content below the PDF to images page (P31): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import {
  freeAndPrivate,
  pdfPassword,
  worksOnPhones,
  type SeoContent,
} from '../_shared/seo-content';

export const content: SeoContent = {
  howTo: [
    'Drop one PDF on the page.',
    'Keep all pages, or choose the ones you want, such as 1-3, 5.',
    'Pick JPG or PNG and a resolution: 150 dpi suits most uses, 300 dpi is for printing.',
    'Press Save, then download one image or all of them as a ZIP.',
  ],
  faq: [
    {
      q: 'Which resolution should I choose?',
      a: '150 dpi is sharp on screen and fine for printing at home: an A4 page becomes 1240 × 1754 pixels. Choose 300 dpi for professional printing or to zoom in on small print, and 72 dpi for small files.',
    },
    {
      q: 'JPG or PNG?',
      a: 'JPG makes much smaller files and keeps text sharp: each page is checked so it looks the same as the original. PNG is lossless, so the image is exactly as drawn, but the files are larger.',
    },
    {
      q: 'Are pages stretched or cut off?',
      a: 'Never. Every page keeps its own shape, so landscape and rotated pages come out landscape. Very large pages, such as posters, are saved at the highest resolution your device can draw, and the result tells you which.',
    },
    pdfPassword,
    freeAndPrivate('PDFs'),
    worksOnPhones('Long PDFs work too: pages are saved a few at a time, so memory use stays low.'),
  ],
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to save PDF pages as images" content={content} />;
}
