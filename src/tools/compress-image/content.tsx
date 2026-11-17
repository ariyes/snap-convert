// Search content below the Compress image page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import {
  isFree,
  noSizeLimit,
  notUploaded,
  worksOnPhones,
  type SeoContent,
} from '../_shared/seo-content';

export const content: SeoContent = {
  howTo: [
    'Drop your images on the page, choose them from your device, or paste with Ctrl/⌘ + V.',
    'Keep the quality at 80, tap a quick preset such as WordPress or Email, or set a target size such as 200 KB.',
    'Drag the before/after slider to compare, and see how much smaller each file is.',
    'Download each image, or all of them as a ZIP.',
  ],
  faq: [
    isFree,
    notUploaded('images'),
    {
      q: 'Will my images look worse?',
      a: 'At the default quality of 80, most photos look the same as the original. Every result is checked with a visual similarity score, and very detailed or grainy photos get a higher quality to stay sharp. If you keep the size and format and your image was already well compressed, you get the original back instead of a bigger file. If a target size can only be reached by making the image look worse, Snap Convert says so and suggests smaller dimensions.',
    },
    {
      q: 'Which formats can I compress?',
      a: 'JPG, PNG, WebP, AVIF, GIF (first frame), BMP and HEIC. By default each image keeps its format; GIF, BMP and HEIC are saved as JPG. A target file size works with JPG, WebP and AVIF.',
    },
    noSizeLimit('images'),
    worksOnPhones('You can pick photos straight from your photo library.'),
  ],
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to compress images" content={content} />;
}
