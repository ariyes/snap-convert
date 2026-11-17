// Search content below the JPG to PNG page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { formatContent } from '../_shared/seo-content';

export const content = formatContent(
  'JPG',
  'PNG',
  'PNG is already chosen. You can also resize the images if you need to.',
  [
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
);

export default function Content() {
  return <ToolSeoContent howToTitle="How to convert JPG to PNG" content={content} />;
}
