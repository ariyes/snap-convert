// Makes the "Try with 12 sample files" images off the main thread (OffscreenCanvas). Without
// OffscreenCanvas in workers it says so, and the page draws them itself (sample-specs.ts).

import { makeSampleOffscreen } from './sample-draw';
import { SAMPLE_SPECS, type SampleFile, type SampleResponse } from './sample-specs';

self.onmessage = async () => {
  let response: SampleResponse;
  if (typeof OffscreenCanvas === 'undefined') {
    response = { type: 'no-canvas' };
  } else {
    try {
      const files: SampleFile[] = [];
      for (const spec of SAMPLE_SPECS) files.push(await makeSampleOffscreen(spec));
      response = { type: 'done', files };
    } catch (error) {
      response = { type: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }
  self.postMessage(response);
};
