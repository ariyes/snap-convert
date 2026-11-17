// The 12 sample files (prototype SAMPLE_BULK), at smaller sizes so they're made and processed fast.
// File names are sample data, not interface text.

export interface SampleSpec {
  name: string;
  width: number;
  height: number;
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  hue: number;
  /** Flat colours and text (a logo) instead of a photo. */
  graphic?: boolean;
  /** Not a real image: shows how a broken file fails, with a reason. */
  broken?: boolean;
}

export const SAMPLE_SPECS: readonly SampleSpec[] = [
  { name: 'IMG_2041.jpg', width: 2400, height: 1800, type: 'image/jpeg', hue: 200 },
  { name: 'IMG_2042.jpg', width: 1800, height: 2400, type: 'image/jpeg', hue: 20 },
  {
    name: 'product-front.png',
    width: 1500,
    height: 1500,
    type: 'image/png',
    hue: 160,
    graphic: true,
  },
  { name: 'panorama-beach.jpg', width: 4800, height: 1200, type: 'image/jpeg', hue: 190 },
  { name: 'team-photo.jpg', width: 3000, height: 2000, type: 'image/jpeg', hue: 40 },
  { name: 'logo-old.png', width: 800, height: 600, type: 'image/png', hue: 280, graphic: true },
  { name: 'DSC_0192.jpg', width: 3008, height: 2008, type: 'image/jpeg', hue: 100 },
  { name: 'hero-banner.webp', width: 2560, height: 1440, type: 'image/webp', hue: 320 },
  { name: 'scan-receipt.jpg', width: 1240, height: 1754, type: 'image/jpeg', hue: 50 },
  { name: 'corrupt-download.jpg', width: 0, height: 0, type: 'image/jpeg', hue: 0, broken: true },
  { name: 'IMG_2050.jpg', width: 2400, height: 1800, type: 'image/jpeg', hue: 240 },
  { name: 'thumb-small.jpg', width: 400, height: 300, type: 'image/jpeg', hue: 10 },
];

export interface SampleFile {
  name: string;
  type: string;
  blob: Blob;
}

export type SampleResponse =
  { type: 'done'; files: SampleFile[] } | { type: 'error'; message: string };

/** Makes the sample files in a worker. Rejects if the browser can't (no OffscreenCanvas). */
export function makeSampleFiles(): Promise<File[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./sample.worker.ts', import.meta.url), {
        type: 'module',
        name: 'samples',
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const now = Date.now();
    worker.onmessage = (event: MessageEvent<SampleResponse>) => {
      worker.terminate();
      const message = event.data;
      if (message.type === 'error') {
        reject(new Error(message.message));
        return;
      }
      resolve(
        message.files.map(
          (f, i) => new File([f.blob], f.name, { type: f.type, lastModified: now - i }),
        ),
      );
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new Error(event.message || 'sample worker failed'));
    };
    worker.postMessage('make');
  });
}
