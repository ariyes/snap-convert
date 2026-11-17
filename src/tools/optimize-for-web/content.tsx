// Search content below the Optimize for web page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { freeAndPrivate, worksOnPhones, type SeoContent } from '../_shared/seo-content';

export const content: SeoContent = {
  howTo: [
    'Pick where the images are going: a website, WordPress, Shopify, a blog hero, email or a thumbnail.',
    'Drop your images. Each one is resized, compressed and cleaned up straight away.',
    'Keep JPG, or choose WebP for smaller files (AVIF is under Advanced).',
    'Download each image, or all of them as a ZIP.',
  ],
  faq: [
    {
      q: 'What does it do to my images?',
      a: 'It shrinks each image to fit the place it’s going, converts it to sRGB so it looks right in every browser, saves it at quality 80 (as a progressive JPG unless you choose WebP or AVIF), and removes location and camera details. Images are never enlarged or stretched.',
    },
    {
      q: 'What sizes are used?',
      a: 'The longest side becomes 1920 px for a general website, 2048 px for WordPress and Shopify, 1600 px for a blog hero, 800 px for email and 400 px for a thumbnail. These are big enough to look sharp on high-resolution screens. You’ll see a warning if an image is small for its use.',
    },
    {
      q: 'Should I use JPG, WebP or AVIF?',
      a: 'JPG works everywhere. WebP is about 25% smaller and works in all modern browsers. AVIF makes the smallest files, but takes longer to make.',
    },
    {
      q: 'Will my images look worse?',
      a: 'No. Every result is checked with a visual similarity score, and very grainy photos get a higher quality to stay sharp. If an image was already well compressed, you get the original back with its location data removed.',
    },
    freeAndPrivate('images'),
    worksOnPhones('You can optimize many images at once.'),
  ],
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to optimize images for the web" content={content} />;
}
