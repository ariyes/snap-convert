// Search content below the PNG to JPG page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { formatContent, transparencyToJpg } from '../_shared/seo-content';

export const content = formatContent(
  'PNG',
  'JPG',
  'JPG is already chosen. Pick a background for transparent areas (white by default).',
  [
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
);

export default function Content() {
  return <ToolSeoContent howToTitle="How to convert PNG to JPG" content={content} />;
}
