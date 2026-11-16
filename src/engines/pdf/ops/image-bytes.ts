/** Image type from the first bytes (never from the file name). */
export function sniffImageType(bytes: Uint8Array): 'jpeg' | 'png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return 'png';
  return null;
}

/**
 * EXIF orientation (1–8) of a JPEG, read from the APP1 "Exif" segment; 1 when there is none or
 * it can't be read. PDF viewers ignore EXIF, so the PDF has to apply it when drawing.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // after SOI
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1] ?? 0;
    // Start of scan / end of image: no more metadata segments.
    if (marker === 0xda || marker === 0xd9) return 1;
    // Standalone markers without a length.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (length < 2) return 1;
    if (marker === 0xe1) {
      const found = exifOrientation(view, offset + 4, Math.min(offset + 2 + length, bytes.length));
      if (found) return found;
    }
    offset += 2 + length;
  }
  return 1;
}

function exifOrientation(view: DataView, start: number, end: number): number | null {
  // "Exif\0\0"
  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  if (end - start < 14 || header.some((b, i) => view.getUint8(start + i) !== b)) return null;
  const tiff = start + 6;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 42) return null;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return null;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}
