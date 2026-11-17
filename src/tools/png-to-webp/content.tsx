// Search content below the PNG to WebP page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { formatContent } from '../_shared/seo-content';

export const content = formatContent(
  'PNG',
  'WebP',
  'WebP is already chosen. Transparent areas stay transparent.',
  [
    {
      q: 'Why convert PNG to WebP?',
      a: 'For photos and detailed images, WebP files are usually much smaller than PNG, and WebP keeps transparency, so pages load faster.',
    },
    {
      q: 'Will my images look worse?',
      a: 'WebP images are saved at quality 85 by default, and each result is checked so it stays crisp. Screenshots, logos and text can stay sharper as PNG.',
    },
    {
      q: 'Does WebP keep transparency?',
      a: 'Yes. See-through areas of your PNG stay see-through in the WebP.',
    },
  ],
);

export default function Content() {
  return <ToolSeoContent howToTitle="How to convert PNG to WebP" content={content} />;
}
