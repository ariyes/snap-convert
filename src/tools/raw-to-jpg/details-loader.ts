// Reads a RAW file's details and makes its list thumbnail, from the main thread through the RAW
// worker (FlashRaw runs there, never here). Loaded on demand by the page, one file at a time.
// The thumbnail comes from the smallest useful JPEG the camera stored in the file, so no RAW data
// is developed and no big image is decoded just for a 44 px picture.

import { readContainer } from '@/engines/image/decode/container';
import { orientPixels, swapsAxes } from '@/engines/image/decode/orientation';
import { closeRawWorker, rawInfo, rawPreview, RawWorkerError } from '@/engines/raw/client';
import { readExifOrientation } from '@/features/intake/header';
import { detailsError, thumbSize, thumbSource, toDetails, type RawFileDetails } from './details';

export { closeRawWorker };

/** EXIF orientation stored in the JPEG itself (1 when none). */
async function ownOrientation(jpeg: Uint8Array): Promise<number> {
  try {
    const info = await readContainer(jpeg);
    return readExifOrientation(info.exif) ?? 1;
  } catch {
    return 1;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  return img.decode().then(() => img);
}

/**
 * A small upright JPEG thumbnail of an embedded camera JPEG. The browser applies the JPEG's own
 * EXIF orientation when drawing it; otherwise the RAW file's orientation is applied here.
 */
async function makeThumb(jpeg: ArrayBuffer, rawOrientation: number): Promise<string | undefined> {
  const bytes = new Uint8Array(jpeg);
  const own = await ownOrientation(bytes);
  const source = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
  try {
    const img = await loadImage(source);
    const turn = own === 1 ? rawOrientation : 1;
    // Drawn as stored (browser-upright for the JPEG's own orientation), then turned for the RAW's.
    const stored = { width: img.naturalWidth, height: img.naturalHeight };
    if (!(stored.width > 0 && stored.height > 0)) return undefined;
    const upright = swapsAxes(turn) ? { width: stored.height, height: stored.width } : stored;
    const target = thumbSize(upright);
    const drawn = swapsAxes(turn) ? { width: target.height, height: target.width } : target;
    const canvas = document.createElement('canvas');
    canvas.width = drawn.width;
    canvas.height = drawn.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, drawn.width, drawn.height);
    if (turn > 1 && turn <= 8) {
      const turned = orientPixels(ctx.getImageData(0, 0, drawn.width, drawn.height), turn);
      canvas.width = turned.width;
      canvas.height = turned.height;
      ctx.putImageData(turned, 0, 0);
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    return blob ? URL.createObjectURL(blob) : undefined;
  } catch {
    return undefined; // no thumbnail: the row shows the photo's shape instead
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** Details of one RAW file, with a thumbnail when the file has a camera JPEG. Never throws. */
export async function loadRawDetails(file: Blob): Promise<RawFileDetails> {
  let info;
  try {
    info = await rawInfo(file);
  } catch (error) {
    return detailsError(error instanceof RawWorkerError ? error.failure : undefined);
  }
  let thumbUrl: string | undefined;
  const source = thumbSource(info.embedded, info);
  if (source) {
    try {
      const preview = await rawPreview(file, source.index);
      if (preview) thumbUrl = await makeThumb(preview.jpeg, preview.orientation);
    } catch {
      // A thumbnail is a bonus; the file can still be converted.
    }
  }
  return toDetails(info, thumbUrl);
}
