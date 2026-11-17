// The app's image worker with OffscreenCanvas switched off (test only, P12b): the same code the
// job queue runs, as it behaves in older Safari. Used by the quality report's fallback mode
// (VITE_IMAGE_NO_CANVAS=1 pnpm quality) and the fallback pipeline tests.
import './no-canvas';
import '../worker';
