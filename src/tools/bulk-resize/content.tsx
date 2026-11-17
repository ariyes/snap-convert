// Search content below the Bulk resize & compress page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { freeAndPrivate, worksOnPhones, type SeoContent } from '../_shared/seo-content';

export const content: SeoContent = {
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
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to resize images in bulk" content={content} />;
}
