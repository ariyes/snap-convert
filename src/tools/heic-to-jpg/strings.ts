// User-facing text of HEIC to JPG (P15).
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const heicStrings = {
  description:
    'iPhones save photos as HEIC because it takes about half the space of JPG, but many apps and websites can’t open it. Turn them into JPGs that open anywhere.',
  dropTitle: 'Drop HEIC photos here',
  dropSubtitle: 'HEIC · HEIF photos from iPhone and iPad — any size',
  panelTitle: 'Settings for all photos',
  upright: 'Photos stay the right way up.',
  notHeic: (n: number) =>
    `${n} ${plural(n, 'file isn’t a HEIC photo', 'files aren’t HEIC photos')}. Convert image handles JPG, PNG, WebP, AVIF and more.`,
  openInConvert: 'Open in Convert image',
  dismiss: 'Dismiss',
} as const;
