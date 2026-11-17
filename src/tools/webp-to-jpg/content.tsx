// Search content below the WebP to JPG page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { formatContent, jpgQuality, transparencyToJpg } from '../_shared/seo-content';

export const content = formatContent(
  'WebP',
  'JPG',
  'JPG is already chosen. Pick a background for transparent areas (white by default).',
  [
    {
      q: 'Why convert WebP to JPG?',
      a: 'WebP is common on websites, but some apps, editors and older software can’t open it. JPG opens everywhere.',
    },
    transparencyToJpg,
    jpgQuality,
  ],
);

export default function Content() {
  return <ToolSeoContent howToTitle="How to convert WebP to JPG" content={content} />;
}
