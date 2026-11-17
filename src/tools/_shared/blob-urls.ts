// Object URLs for result blobs, made when first shown and revoked when no longer needed.
import { useEffect, useState } from 'react';

class BlobUrlCache {
  private readonly urls = new Map<Blob, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  get(blob: Blob): string {
    let url = this.urls.get(blob);
    if (url === undefined) {
      url = URL.createObjectURL(blob);
      this.urls.set(blob, url);
    }
    return url;
  }

  /** Revokes the URLs of blobs that are no longer shown. */
  keepOnly(blobs: ReadonlySet<Blob>): void {
    for (const [blob, url] of this.urls) {
      if (blobs.has(blob)) continue;
      URL.revokeObjectURL(url);
      this.urls.delete(blob);
    }
  }

  hold(): void {
    clearTimeout(this.timer);
  }

  /** Revokes everything shortly after unmount, unless the component mounts again (dev StrictMode). */
  releaseSoon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.keepOnly(new Set()), 1000);
  }
}

/**
 * `url(blob)` gives a stable object URL for a blob shown on screen. Pass every blob currently shown
 * as `shown`; URLs of the others are revoked after the render.
 */
export function useBlobUrls(shown: ReadonlySet<Blob>): (blob: Blob) => string {
  const [cache] = useState(() => new BlobUrlCache());
  useEffect(() => {
    cache.hold();
    return () => cache.releaseSoon();
  }, [cache]);
  useEffect(() => {
    cache.keepOnly(shown);
  }, [cache, shown]);
  return (blob) => cache.get(blob);
}
