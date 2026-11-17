// The RAW worker's work: read a RAW file's details, hand out its embedded JPEG, or develop its
// sensor data to upright 8-bit sRGB. FlashRaw first; LibRaw for files FlashRaw rejects (D40).
// Errors are thrown as RawEngineError with a kind the caller turns into a plain message.

import { compactExif } from './exif';
import type * as LibRawModule from './libraw';
import { loadFlashRaw, type FlashRawFile } from './flashraw';
import type {
  DevelopRequest,
  DevelopResult,
  PreviewResult,
  RawFailure,
  RawFileInfo,
} from './protocol';
import { BASE_EXPOSURE, buildToneLut, developPixels, toneWhite } from './tone';

export class RawEngineError extends Error {
  constructor(readonly failure: RawFailure) {
    super(failure.detail ?? failure.kind);
    this.name = 'RawEngineError';
  }
}

/**
 * FlashRaw error kinds that LibRaw might still handle. Not CorruptFile: a damaged file is damaged
 * for LibRaw too, which would only fill the missing part with grey.
 */
const TRY_LIBRAW = new Set([
  'UnsupportedFormat',
  'UnsupportedCompression',
  'CameraUnsupported',
  'InvalidMetadata',
]);

/** Extensions of formats FlashRaw reads: such a file it can't recognise at all is damaged. */
const KNOWN_FORMATS = new Set(
  'DNG CR2 CR3 CRW NEF NRW ARW SR2 SRF ARQ RAF RW2 RWL ORF ORI PEF SRW MRW IIQ MOS 3FR FFF KDC DCR DCS ERF MEF X3F ARI'.split(
    ' ',
  ),
);

/** What is known about a file's format when a decoder fails on it. */
interface FormatClue {
  /** Container format FlashRaw recognised from the bytes, if any. */
  detected?: string;
  /** Upper-case file extension, if any. */
  extension: string;
  make?: string;
}

function errorKind(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const kind = error.kind;
    if (typeof kind === 'string') return kind;
  }
  return undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Out of memory, wherever it surfaced: FlashRaw's own error, a failed allocation or a WebAssembly trap. */
export function isOutOfMemory(error: unknown): boolean {
  const kind = errorKind(error);
  if (kind === 'OutOfMemory' || kind === 'LimitExceeded') return true;
  if (error instanceof RangeError) return /alloc|memory|buffer/i.test(error.message);
  if (
    kind === 'Internal' ||
    (typeof WebAssembly !== 'undefined' && error instanceof WebAssembly.RuntimeError)
  ) {
    return /memory|alloc|unreachable/i.test(message(error));
  }
  return false;
}

/** "Sigma X3F", "Nikon NEF", or just the format when the camera is unknown. */
function formatLabel(clue: FormatClue): string | undefined {
  const format = clue.detected ?? clue.extension;
  if (!format) return undefined;
  return clue.make ? `${clue.make} ${format}` : format;
}

/** The kind of failure for an error that LibRaw couldn't rescue either. */
export function failureFor(error: unknown, clue: FormatClue): RawFailure {
  const detail = message(error);
  if (isOutOfMemory(error)) return { kind: 'out-of-memory', detail };
  const kind = errorKind(error);
  if (kind === 'UnsupportedCompression' || kind === 'CameraUnsupported') {
    return { kind: 'unsupported', format: formatLabel(clue), detail };
  }
  if (kind === 'UnsupportedFormat' && !clue.detected) {
    // Nothing recognised the bytes: a format we don't know, or a known one that is broken.
    const known = !clue.extension || KNOWN_FORMATS.has(clue.extension);
    if (!known) return { kind: 'unsupported', format: formatLabel(clue), detail };
  }
  return { kind: 'damaged', detail };
}

function extensionOf(file: Blob): string {
  const name = typeof File !== 'undefined' && file instanceof File ? file.name : '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
}

/** FlashRaw's capture time without fractional seconds ("2021-05-10T20:11:06+00:00"). */
export function isoDate(captureTime: string | null): string | undefined {
  if (!captureTime) return undefined;
  const m = captureTime.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}:\d{2}|Z)?$/,
  );
  return m ? `${m[1]}${m[2] ?? ''}` : undefined;
}

async function describe(raw: FlashRawFile): Promise<RawFileInfo> {
  const m = raw.metadata;
  const embedded = m.previews.map((p) => ({
    index: p.index,
    width: p.width,
    height: p.height,
    encoding: p.encoding,
    orientation: p.orientation,
  }));
  const jpegs = embedded
    .filter((p) => p.encoding === 'jpeg')
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .map(({ width, height }) => ({ width, height }));
  const info: RawFileInfo = {
    width: m.width,
    height: m.height,
    orientation: m.orientation,
    previews: jpegs,
    format: m.format === 'other' ? '' : m.format,
    decoder: 'flashraw',
    embedded,
    hasLocation: !!m.gps && (m.gps.latitude !== null || m.gps.longitude !== null),
    baselineExposure: m.dng?.baselineExposure ?? 0,
  };
  if (m.camera.name) info.camera = m.camera.name;
  const takenAt = isoDate(m.captureTime);
  if (takenAt) info.takenAt = takenAt;
  try {
    const exif = await raw.exifBytes();
    const compact = exif ? compactExif(exif) : undefined;
    if (compact) info.exif = compact;
  } catch {
    // Details are a bonus; the pixels matter.
  }
  return info;
}

interface Opened {
  raw: FlashRawFile;
  info: RawFileInfo;
}

/** Opens with FlashRaw, or returns the error for the LibRaw fallback to judge. */
async function openFlashRaw(file: Blob): Promise<Opened | { error: unknown }> {
  let raw: FlashRawFile;
  try {
    const fr = await loadFlashRaw();
    raw = await fr.FlashRaw.open(file);
  } catch (error) {
    return { error };
  }
  try {
    return { raw, info: await describe(raw) };
  } catch (error) {
    raw.close();
    return { error };
  }
}

async function clueFor(file: Blob, info?: RawFileInfo): Promise<FormatClue> {
  const clue: FormatClue = { extension: extensionOf(file) };
  if (info?.format) clue.detected = info.format;
  else {
    try {
      const detected = await (await loadFlashRaw()).detectFormat(file);
      if (detected && detected !== 'other') clue.detected = detected;
    } catch {
      // unknown
    }
  }
  const make = info?.camera?.split(' ')[0];
  if (make) clue.make = make;
  return clue;
}

/** Hands a file FlashRaw failed on to LibRaw, if LibRaw might do better; otherwise reports the failure. */
async function withLibRaw<T>(
  file: Blob,
  flashError: unknown,
  run: (lib: typeof LibRawModule, format: string) => Promise<T>,
  info?: RawFileInfo,
): Promise<T> {
  const clue = await clueFor(file, info);
  if (isOutOfMemory(flashError) || !TRY_LIBRAW.has(errorKind(flashError) ?? '')) {
    throw new RawEngineError(failureFor(flashError, clue));
  }
  try {
    const lib = await import('./libraw');
    return await run(lib, clue.detected ?? clue.extension);
  } catch (error) {
    throw new RawEngineError(failureFor(isOutOfMemory(error) ? error : flashError, clue));
  }
}

export async function inspect(file: Blob): Promise<RawFileInfo> {
  const opened = await openFlashRaw(file);
  if ('error' in opened) {
    return withLibRaw(file, opened.error, (lib, format) => lib.libRawInfo(file, format));
  }
  opened.raw.close();
  return opened.info;
}

/** The embedded JPEG at `index` (default: the largest JPEG), or null if there is none. */
export async function preview(file: Blob, index?: number): Promise<PreviewResult | null> {
  const opened = await openFlashRaw(file);
  if ('error' in opened) {
    // A file only LibRaw can open: no camera JPEG from us (the caller develops it instead).
    await withLibRaw(file, opened.error, (lib, format) => lib.libRawInfo(file, format));
    return null;
  }
  const { raw, info } = opened;
  try {
    const largest = info.embedded
      .filter((p) => p.encoding === 'jpeg')
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const chosen = index !== undefined ? info.embedded.find((p) => p.index === index) : largest;
    if (!chosen || chosen.encoding !== 'jpeg') return null;
    const p = await raw.preview({ index: chosen.index });
    if (!p || p.mimeType !== 'image/jpeg') return null;
    const whole = p.data.byteOffset === 0 && p.data.byteLength === p.data.buffer.byteLength;
    const jpeg = whole ? p.data.buffer : p.data.slice().buffer;
    return { info, jpeg, width: p.width, height: p.height, orientation: p.orientation };
  } catch (error) {
    throw new RawEngineError(failureFor(error, await clueFor(file, info)));
  } finally {
    raw.close();
  }
}

export async function develop(file: Blob, request: DevelopRequest): Promise<DevelopResult> {
  if (request.decoder === 'libraw') {
    const lib = await import('./libraw');
    const clue = await clueFor(file);
    try {
      return await lib.libRawDevelop(file, clue.detected ?? clue.extension, request);
    } catch (error) {
      throw new RawEngineError(failureFor(error, clue));
    }
  }
  const opened = await openFlashRaw(file);
  if ('error' in opened) {
    return withLibRaw(file, opened.error, (lib, format) =>
      lib.libRawDevelop(file, format, request),
    );
  }
  const { raw, info } = opened;
  let frame;
  try {
    frame = await raw.decode({
      output: 'linear-rgb-f16',
      zeroCopy: true,
      demosaic: request.halfSize ? 'half-size' : 'auto',
      whiteBalance: request.whiteBalance,
      // Lateral colour fringes (as cameras remove them from their JPEGs); measured from the frame,
      // ~no extra time. Bayer sensors only (FlashRaw ignores it for others).
      chromaticAberration: !request.halfSize,
      // "Clip" still fades clipped highlights to white (no magenta skies); "recover" rebuilds them.
      highlights: request.highlights === 'recover' ? 'reconstruct' : 'neutral',
      corruptionPolicy: 'strict',
    });
  } catch (error) {
    raw.close();
    return withLibRaw(file, error, (lib, format) => lib.libRawDevelop(file, format, request), info);
  }
  try {
    const exposure = BASE_EXPOSURE + info.baselineExposure + request.exposure;
    const lut = buildToneLut({ exposure, white: toneWhite(exposure, request.highlights) });
    const out = developPixels(frame.data, frame.width, frame.height, frame.orientation, lut);
    return { info, pixels: out.data.buffer, width: out.width, height: out.height };
  } catch (error) {
    throw new RawEngineError(failureFor(error, await clueFor(file, info)));
  } finally {
    frame.free();
    raw.close();
  }
}
