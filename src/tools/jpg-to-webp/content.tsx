// Search content below the JPG to WebP page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { formatContent } from '../_shared/seo-content';

export const content = formatContent(
  'JPG',
  'WebP',
  'WebP is already chosen. You can also resize the images to the size your site needs.',
  [
    {
      q: 'Why convert JPG to WebP?',
      a: 'WebP files are usually about 25% smaller than JPGs that look the same, so pages load faster. All modern browsers show WebP.',
    },
    {
      q: 'Will my images look worse?',
      a: 'WebP images are saved at quality 85 by default, and each result is checked so it stays crisp.',
    },
    {
      q: 'Can my website use WebP?',
      a: 'Most website builders, including WordPress and Shopify, accept WebP images. If yours doesn’t, keep JPG.',
    },
  ],
);

export default function Content() {
  return <ToolSeoContent howToTitle="How to convert JPG to WebP" content={content} />;
}
