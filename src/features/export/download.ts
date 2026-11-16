import { safeFileName } from './names';

/**
 * How long the object URL stays valid after the click. Browsers start the download from the URL
 * asynchronously (Safari on iOS noticeably later, after its download prompt), so revoking it right
 * away can cancel the download. One minute is generous and only keeps a reference to the blob.
 */
export const REVOKE_DELAY_MS = 60_000;

/**
 * Saves a blob to the user's device as a download. The name is made safe first.
 * Uses an object URL and a temporary link (works in Chrome, Edge, Firefox and Safari incl. iOS 13+).
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(name);
  link.rel = 'noopener';
  link.style.display = 'none';
  // Safari and older Firefox only follow links that are in the document.
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}
