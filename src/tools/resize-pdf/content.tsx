// Search content below the Resize PDF page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { freeAndPrivate, worksOnPhones, type SeoContent } from '../_shared/seo-content';

export const content: SeoContent = {
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
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to resize PDF pages" content={content} />;
}
