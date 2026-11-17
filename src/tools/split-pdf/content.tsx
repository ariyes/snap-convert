// Search content below the Split PDF page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import {
  freeAndPrivate,
  pdfLinksNote,
  pdfPassword,
  worksOnPhones,
  type SeoContent,
} from '../_shared/seo-content';

export const content: SeoContent = {
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
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to split a PDF" content={content} />;
}
