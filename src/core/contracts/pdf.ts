// Shared contract — copied from prompts/01-contracts.md. Only the governor changes this file.
// `declare function` lines from the contract are exported as function types here.

export type NamedPageSize = 'a4' | 'a5' | 'letter' | 'legal';
export type PageSize = NamedPageSize | 'fit-image' | { width: number; height: number }; // points
export type PageOrientation = 'auto' | 'portrait' | 'landscape';

export interface NamedBlob { blob: Blob; name: string }

export interface ImagesToPdfInput { images: NamedBlob[]; pageSize: PageSize; orientation: PageOrientation; marginMm: number; outName: string }
export interface MergeInput { files: NamedBlob[]; outName: string }
export interface SplitInput { file: NamedBlob; mode: 'every-page' | 'every-n' | 'ranges'; n?: number; ranges?: string }
export interface OrganizeInput { file: NamedBlob; pages: Array<{ index: number; rotate: 0 | 90 | 180 | 270 }>; outName: string } // array order = new order; missing pages = deleted
export interface ResizePagesInput { file: NamedBlob; pageSize: NamedPageSize | { width: number; height: number }; orientation: PageOrientation; outName: string }

export interface PdfOutput { blob: Blob; name: string; pages: number }
export interface PdfResult { files: PdfOutput[] }

// P07 (pdf-lib, inside the pdf worker)
export type ImagesToPdf = (i: ImagesToPdfInput) => Promise<PdfResult>;
export type MergePdfs = (i: MergeInput) => Promise<PdfResult>;
export type SplitPdf = (i: SplitInput) => Promise<PdfResult>;
export type OrganizePdf = (i: OrganizeInput) => Promise<PdfResult>;
export type ResizePages = (i: ResizePagesInput) => Promise<PdfResult>;
/** "1-3, 5, 8-10" → [[1,2,3],[5],[8,9,10]] (1-based). Throws RangeError with a user-readable message. */
export type ParseRanges = (spec: string, pageCount: number) => number[][];

// P08 (pdf.js, main thread + pdf.js worker)
export interface PdfInfo { pages: number; encrypted: boolean; pageSizes: Array<{ width: number; height: number }> }
export type ReadPdfInfo = (file: Blob) => Promise<PdfInfo>;
export type RenderThumbnails = (file: Blob, maxSize: number, onPage: (index: number, bitmap: ImageBitmap) => void, signal?: AbortSignal) => Promise<void>;
