// PLACEHOLDER — owned by P23 (cookie-free counting). Working no-op until P23 replaces it.
import type { Track, TrackEvent } from '@/core/contracts';

/** Cookie-free usage counting. Does nothing until P23 lands, so tool pages can call it already. */
export const track: Track = (_event: TrackEvent): void => {};
