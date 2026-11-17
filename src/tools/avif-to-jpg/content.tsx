// Search content below the AVIF to JPG page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { formatContent, jpgQuality, transparencyToJpg } from '../_shared/seo-content';

export const content = formatContent(
  'AVIF',
  'JPG',
  'JPG is already chosen. Pick a background for transparent areas (white by default).',
  [
    {
      q: 'Why convert AVIF to JPG?',
      a: 'AVIF makes very small files, but many apps, editors and older devices can’t open it yet. JPG opens everywhere.',
    },
    transparencyToJpg,
    jpgQuality,
  ],
);

export default function Content() {
  return <ToolSeoContent howToTitle="How to convert AVIF to JPG" content={content} />;
}
