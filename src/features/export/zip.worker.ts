import { ExportError } from './errors';
import { buildZip } from './zip-core';
import type { ZipRequest, ZipResponse } from './zip-protocol';

const post = (message: ZipResponse) => self.postMessage(message);

self.onmessage = (event: MessageEvent<ZipRequest>) => {
  buildZip(event.data.files, (progress) => post({ type: 'progress', progress })).then(
    (blob) => post({ type: 'done', blob }),
    (err: unknown) =>
      post({
        type: 'error',
        code: err instanceof ExportError ? err.code : 'zip-failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  );
};
