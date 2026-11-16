// AVIF fallback for browsers that can't decode AVIF themselves: jSquash's libavif build,
// loaded only when needed. It returns raw pixels without the container's rotation/mirroring
// and without colour management; the caller applies both.

export async function decodeAvif(bytes: Uint8Array): Promise<ImageData | undefined> {
  const { default: decode } = await import('@jsquash/avif/decode.js');
  const copy = bytes.slice().buffer; // the decoder takes an ArrayBuffer of exactly the file
  const result = await decode(copy);
  if (!result) return undefined;
  if (result instanceof ImageData) return result;
  const { data, width, height } = result as { data: Uint8ClampedArray; width: number; height: number };
  return new ImageData(new Uint8ClampedArray(data), width, height);
}
