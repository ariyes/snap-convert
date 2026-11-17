// Search content below the Merge PDF page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import {
  freeAndPrivate,
  noSizeLimit,
  pdfLinksNote,
  pdfPassword,
  worksOnPhones,
  type SeoContent,
} from '../_shared/seo-content';

export const content: SeoContent = {
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
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to merge PDF files" content={content} />;
}
