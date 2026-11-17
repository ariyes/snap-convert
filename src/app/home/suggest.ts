/**
 * Home page suggestion logic (D16): what to offer for the files someone dropped.
 * Pure functions, so they are easy to test and independent of the drop zone.
 */
import type { FileKind, IntakeFile } from '@/core/contracts/intake';
import { getTool } from '@/tools/registry';
import { appStrings } from '../strings';

/**
 * A dropped file with its kind, as P11's DropZone detected it from the file's first bytes
 * (so a JPEG renamed .png is an image, and a text file renamed .jpg is 'unknown').
 */
export type DroppedFile = Pick<IntakeFile, 'file' | 'kind'>;

/** Every kind, so the home drop box takes anything and the suggestions sort it out. */
export const ALL_KINDS: readonly FileKind[] = ['image', 'heic', 'pdf', 'raw', 'unknown'];

/** Keeps only what the suggestions need from the DropZone's IntakeFiles. */
export function toDroppedFiles(files: readonly IntakeFile[]): DroppedFile[] {
  return files.map(({ file, kind }) => ({ file, kind }));
}

export interface KindCounts {
  /** Images, HEIC included. */
  images: number;
  pdfs: number;
  raws: number;
  others: number;
}

export function countKinds(kinds: readonly FileKind[]): KindCounts {
  const counts: KindCounts = { images: 0, pdfs: 0, raws: 0, others: 0 };
  for (const kind of kinds) {
    if (kind === 'image' || kind === 'heic') counts.images++;
    else if (kind === 'pdf') counts.pdfs++;
    else if (kind === 'raw') counts.raws++;
    else counts.others++;
  }
  return counts;
}

/** "3 images and 1 PDF" */
export function describeCounts(counts: KindCounts): string {
  const { fileCount, joinList } = appStrings;
  const parts: string[] = [];
  if (counts.images) parts.push(fileCount.images(counts.images));
  if (counts.pdfs) parts.push(fileCount.pdfs(counts.pdfs));
  if (counts.raws) parts.push(fileCount.raws(counts.raws));
  if (counts.others) parts.push(fileCount.others(counts.others));
  return joinList(parts);
}

export interface Suggestion {
  /** Tool id (route) to open. */
  toolId: string;
  label: string;
  /** Lucide icon name. */
  icon: string;
  /** Phase 2+ tool: shown with a "coming soon" marker. */
  soon: boolean;
}

const { chip } = appStrings;

function suggestion(toolId: string, label: string, icon?: string): Suggestion {
  const tool = getTool(toolId);
  if (!tool) throw new Error(`Unknown tool in suggestions: ${toolId}`);
  return { toolId, label, icon: icon ?? tool.icon, soon: tool.phase !== 1 };
}

/** Chips in the prototype's order: images, then PDFs, then RAW. Empty when nothing fits. */
export function suggestTools(counts: KindCounts): Suggestion[] {
  const chips: Suggestion[] = [];
  if (counts.images) {
    chips.push(
      suggestion('compress-image', chip.compress),
      // One image → Resize image; several → Bulk resize (the prototype's chip opens Bulk).
      counts.images === 1
        ? suggestion('resize-image', chip.resize)
        : suggestion('bulk-resize', chip.resize),
      suggestion('convert-image', chip.convert),
      suggestion('optimize-for-web', chip.optimize),
      suggestion('images-to-pdf', chip.makePdf),
      suggestion('remove-background', chip.removeBackground),
    );
  }
  if (counts.pdfs) {
    chips.push(
      suggestion('merge-pdf', chip.merge),
      suggestion('split-pdf', chip.split),
      suggestion('organize-pdf', chip.organize),
      suggestion('resize-pdf', chip.resizePages),
    );
  }
  if (counts.raws) chips.push(suggestion('raw-to-jpg', chip.rawToJpg));
  return chips;
}

/** The dropped files a tool can take, by the kinds in its registry entry. */
export function filesForTool(toolId: string, dropped: readonly DroppedFile[]): File[] {
  const accepts = getTool(toolId)?.accepts ?? [];
  return dropped.filter((d) => accepts.includes(d.kind)).map((d) => d.file);
}
