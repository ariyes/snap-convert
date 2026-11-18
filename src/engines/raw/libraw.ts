// LibRaw (WebAssembly build, LGPL-2.1/CDDL; wrapper MIT), the fallback for files FlashRaw rejects
// (D40). Runs only inside the RAW worker and loads only when a file needs it. Develops to linear
// 16-bit sRGB and goes through the same tone table as FlashRaw, so both look alike.

import type { LibRaw } from '@colorhythm/libraw-wasm';
import wasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url';
import type { DevelopRequest, DevelopResult, RawFileInfo } from './protocol';
import { BASE_EXPOSURE, buildLinearLut, developPixels, toneWhite } from './tone';
import { absoluteUrl } from './worker-url';

type LibRawClass = typeof LibRaw;
type LibRawInstance = InstanceType<LibRawClass>;

let loaded: Promise<LibRawClass> | undefined;

function loadLibRaw(): Promise<LibRawClass> {
  loaded ??= (async () => {
    const [{ LibRaw }, response] = await Promise.all([
      import('@colorhythm/libraw-wasm'),
      fetch(absoluteUrl(wasmUrl)),
    ]);
    if (!response.ok) throw new Error(`libraw.wasm: HTTP ${response.status}`);
    await LibRaw.initialize(await response.arrayBuffer());
    return LibRaw;
  })().catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

/** LibRaw's `flip` → EXIF orientation. */
export function flipToOrientation(flip: number): number {
  switch (flip) {
    case 3:
      return 3;
    case 5:
      return 8;
    case 6:
      return 6;
    default:
      return 1;
  }
}

async function open(file: Blob): Promise<LibRawInstance> {
  const LibRaw = await loadLibRaw();
  const decoder = new LibRaw();
  await decoder.waitUntilReady();
  try {
    decoder.open(await file.arrayBuffer());
  } catch (error) {
    decoder.dispose();
    throw error;
  }
  return decoder;
}

function info(decoder: LibRawInstance, format: string): RawFileInfo {
  const params = decoder.getIParams();
  const make = params.normalized_make || params.make;
  const model = params.normalized_model || params.model;
  const camera = [make, model].filter(Boolean).join(' ').trim();
  const result: RawFileInfo = {
    width: decoder.getActiveWidth(),
    height: decoder.getActiveHeight(),
    orientation: flipToOrientation(decoder.getFlip()),
    previews: [],
    format,
    decoder: 'libraw',
    embedded: [],
    hasLocation: false,
    baselineExposure: 0,
  };
  if (camera) result.camera = camera;
  return result;
}

export async function libRawInfo(file: Blob, format: string): Promise<RawFileInfo> {
  const decoder = await open(file);
  try {
    return info(decoder, format);
  } finally {
    decoder.dispose();
  }
}

export async function libRawDevelop(
  file: Blob,
  format: string,
  request: DevelopRequest,
): Promise<DevelopResult> {
  const decoder = await open(file);
  try {
    const fileInfo = info(decoder, format);
    decoder.unpack();
    // LibRaw has no "auto" white balance setter in this build: as shot either way.
    decoder.setUseCameraWb(1);
    decoder.setOutputColor(1); // sRGB primaries
    decoder.setOutputBps(16);
    decoder.setNoAutoBright(1);
    decoder.setGamma(0, 1); // linear: our tone table adds the sRGB curve
    decoder.setGamma(1, 1);
    decoder.setHalfSize(request.halfSize ? 1 : 0);
    // 0 clips every channel to white (no magenta); 5 rebuilds highlights.
    const highlight = request.highlights === 'recover' ? 5 : 0;
    decoder.setHighlight(highlight);
    decoder.dcrawProcess();
    // With any highlight mode but clip, dcraw scales by the largest white-balance multiplier
    // instead of the smallest, which darkens the whole picture by their ratio: undo that.
    const multipliers = [0, 1, 2, 3].map((i) => decoder.getPreMul(i)).filter((m) => m > 0);
    const headroom =
      highlight && multipliers.length
        ? Math.log2(Math.max(...multipliers) / Math.min(...multipliers))
        : 0;
    const image = decoder.dcrawMakeMemImage();
    if (image.colors !== 3 || image.bits !== 16) throw new Error('unexpected LibRaw output');
    const bytes = image.data.byteOffset % 2 ? image.data.slice() : image.data;
    const samples = new Uint16Array(bytes.buffer, bytes.byteOffset, image.width * image.height * 3);
    const exposure = BASE_EXPOSURE + request.exposure + headroom;
    const lut = buildLinearLut({ exposure, white: toneWhite(exposure, request.highlights) });
    // LibRaw's memory image is already upright.
    const out = developPixels(samples, image.width, image.height, 1, lut);
    return { info: fileInfo, pixels: out.data.buffer, width: out.width, height: out.height };
  } finally {
    decoder.dispose();
  }
}
