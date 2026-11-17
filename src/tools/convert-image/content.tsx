// Search content below the Convert image page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { freeAndPrivate, worksOnPhones, type SeoContent } from '../_shared/seo-content';

export const content: SeoContent = {
  howTo: [
    'Drop your images on the page, choose them from your device, or paste with Ctrl/⌘ + V.',
    'Choose the format to save as: JPG, PNG, WebP or AVIF.',
    'Converting see-through images to JPG? Pick what fills the transparent areas (white by default).',
    'Download each image, or all of them as a ZIP.',
  ],
  faq: [
    {
      q: 'Which format should I choose?',
      a: 'JPG for photos that need to open everywhere. PNG for screenshots, logos and text, or when you need transparency. WebP for smaller files that work in all modern browsers. AVIF for the smallest files; it takes longer to make, and very old browsers can’t show it.',
    },
    {
      q: 'What happens to transparent areas?',
      a: 'PNG, WebP and AVIF keep them. JPG can’t store transparency, so see-through areas are filled with the background you pick.',
    },
    {
      q: 'Will converting make my images look worse?',
      a: 'PNG keeps every pixel. JPG, WebP and AVIF are saved at quality 85 by default, and each result is checked so it stays crisp.',
    },
    {
      q: 'Can I convert animated GIFs?',
      a: 'Only the first frame of a GIF is converted, as a still image.',
    },
    freeAndPrivate('images'),
    worksOnPhones('You can pick images straight from your photo library.'),
  ],
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to convert images" content={content} />;
}
