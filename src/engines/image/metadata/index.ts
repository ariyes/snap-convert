// M4 metadata (P06): what details an output keeps (IMG-07), plus safe JPEG/EXIF parsing.
export { applyMetadata, applyMetadataDetailed, type MetadataResult } from './apply';
export {
  chromaSubsampling,
  JpegFormatError,
  parseJpeg,
  readFrame,
  writeJpeg,
  type FrameInfo,
  type JpegSegment,
  type ParsedJpeg,
} from './jpeg-segments';
export { exifToTiff, ExifFormatError, prepareExif, readExifInfo, type ExifInfo } from './exif';
export { isSrgbProfile } from './icc';
export { sniffFormat } from './sniff';
