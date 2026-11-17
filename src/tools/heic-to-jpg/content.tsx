// Search content below the HEIC to JPG page (P22): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { notUploaded, worksOnPhones, type SeoContent } from '../_shared/seo-content';

export const content: SeoContent = {
  howTo: [
    'Drop your HEIC or HEIF photos on the page, or choose them from your device.',
    'Keep JPG, or choose PNG.',
    'Download each photo, or all of them as a ZIP.',
  ],
  faq: [
    {
      q: 'What is a HEIC file?',
      a: 'iPhones and iPads save photos as HEIC because it takes about half the space of JPG. Many apps and websites can’t open it, so converting to JPG makes your photos work everywhere.',
    },
    {
      q: 'Will my photos stay the right way up?',
      a: 'Yes. The rotation saved by the camera is applied, so photos come out upright.',
    },
    {
      q: 'Do I lose quality or size?',
      a: 'Photos keep their full size. JPGs are saved at quality 90 by default and checked so they stay crisp.',
    },
    {
      q: 'What happens to the location and other photo details?',
      a: 'By default the GPS location is removed and other details, such as the date taken, stay in the JPG. You can also remove everything or keep everything. PNG files don’t keep these details.',
    },
    notUploaded('photos'),
    worksOnPhones('It is free, with no sign-up and no limit on the number of photos.'),
  ],
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to convert HEIC to JPG" content={content} />;
}
