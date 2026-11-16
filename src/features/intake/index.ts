// M2 file intake (P11): drop, pick, paste and camera roll; real file type from the first bytes;
// quick image size from the header; one file list per tool.
//
//   const { files, add, remove } = useFileList('compress-image');
//   <DropZone accept={['image', 'heic']} multiple pasteHint onFiles={add} />

export { DropZone, type DropZoneProps } from './DropZone';
export {
  createFileListStore,
  fileListStore,
  PHONE_WARN_LIMITS,
  resetFileLists,
  useFileList,
  type AddOptions,
  type FileListState,
  type FileListStoreOptions,
} from './file-list';
export {
  DETECT_BYTES,
  detectKind,
  extensionOf,
  RAW_EXTENSIONS,
  sniffKind,
  TIFF_RAW_EXTENSIONS,
} from './detect';
export {
  HEADER_READ_BYTES,
  headerSizeFromBytes,
  readExifOrientation,
  readHeaderSize,
  type HeaderSize,
} from './header';
export {
  acceptAttribute,
  keepAccepted,
  namePastedFile,
  partitionByKind,
  toIntakeFile,
  toIntakeFiles,
  type Partitioned,
} from './intake';
export { filesFromDataTransfer, filesFromEntry, isHiddenName } from './folder';
export {
  filesFromClipboard,
  registerPasteTarget,
  usePasteTarget,
  type PasteHandler,
} from './paste';
export { isApplePlatform } from './platform';
export { intakeStrings, kindWords } from './strings';
