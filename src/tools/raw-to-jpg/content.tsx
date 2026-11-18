// Search content below the RAW to JPG page (P30): how-to and FAQ. Loads only on this page.
import { ToolSeoContent } from '../_shared/content';
import { freeAndPrivate, worksOnPhones, type SeoContent } from '../_shared/seo-content';

export const content: SeoContent = {
  howTo: [
    'Drop your RAW photos on the page, or choose them from your device. A whole memory card works.',
    'Keep Fast to use the JPG your camera made, or choose Full quality to develop the RAW data.',
    'Pick JPG, PNG, WebP or AVIF, and resize if you need smaller photos.',
    'Convert, then download each photo or all of them as a ZIP.',
  ],
  faq: [
    {
      q: 'Which cameras and RAW formats work?',
      a: 'Canon CR2 and CR3, Nikon NEF, Sony ARW, Adobe DNG, Fujifilm RAF, Olympus ORF, Panasonic RW2, Pentax PEF and Samsung SRW, from most camera models. A file that can’t be read says so on its own row, and the rest still convert.',
    },
    {
      q: 'What is the difference between Fast and Full quality?',
      a: 'Most cameras store a full-size JPG inside each RAW file. Fast uses that JPG, so it looks just like the camera’s own JPG and is quick. Full quality develops the RAW sensor data instead: slower, with more detail kept in shadows and bright skies, plus white balance, exposure and highlight recovery. If a camera stores only a small JPG, Fast develops the RAW data too.',
    },
    {
      q: 'Are my photos kept sharp and the right way up?',
      a: 'Yes. Photos keep their full size unless you choose to resize, they are never stretched, and the camera’s rotation is applied. JPGs are checked so they stay crisp. By default the date, camera and lens details are kept and the GPS location is removed.',
    },
    freeAndPrivate('photos'),
    worksOnPhones(
      'Very large RAW files can be slow on a phone, and some are developed at half size to fit its memory; the page tells you before you start. A computer is faster.',
    ),
  ],
};

export default function Content() {
  return <ToolSeoContent howToTitle="How to convert RAW photos to JPG" content={content} />;
}
