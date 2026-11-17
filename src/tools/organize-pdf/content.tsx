// Search content below the Organize pages page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import {
  freeAndPrivate,
  pdfLinksNote,
  worksOnPhones,
  type SeoContent,
} from '../_shared/seo-content';

export const content: SeoContent = {
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
};

export default function Content() {
  return (
    <ToolSeoContent howToTitle="How to reorder, rotate and delete PDF pages" content={content} />
  );
}
