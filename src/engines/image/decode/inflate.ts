// zlib inflate for PNG image data and iCCP profiles. Uses the browser's own DecompressionStream;
// browsers without it (Safari before 16.4 — the same ones without OffscreenCanvas in workers) and
// streams it refuses (e.g. stray bytes after the end) fall back to fflate, loaded only then.
// Output stops once `maxBytes` are inflated, so a tiny file can't expand into gigabytes.

/** Inflates zlib data. Resolves with at least `maxBytes` bytes when the stream holds that many. Throws if unreadable. */
export async function inflate(data: Uint8Array, maxBytes = Infinity): Promise<Uint8Array> {
  let partial: Uint8Array | undefined;
  if (typeof DecompressionStream === 'function') {
    try {
      return await withStream(data, maxBytes);
    } catch (error) {
      if (error instanceof PartialInflate) partial = error.bytes;
    }
  }
  try {
    return await withFflate(data, maxBytes);
  } catch (error) {
    // fflate may stop earlier than the browser did; keep whichever got further.
    if (partial && partial.length >= maxBytes) return partial;
    throw error;
  }
}

class PartialInflate extends Error {
  constructor(readonly bytes: Uint8Array) {
    super('inflate failed');
  }
}

async function withStream(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const reader = input.pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch {
    const bytes = join(chunks, total);
    // Everything needed arrived before the error (e.g. junk after the end): that's fine.
    if (total >= maxBytes) return bytes;
    throw new PartialInflate(bytes);
  }
  if (total >= maxBytes) reader.cancel().catch(() => undefined);
  return join(chunks, total);
}

async function withFflate(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const { Unzlib } = await import('fflate');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Unzlib((chunk) => {
    chunks.push(chunk);
    total += chunk.length;
  });
  const STEP = 1 << 16;
  for (let at = 0; at < data.length && total < maxBytes; at += STEP) {
    const end = Math.min(at + STEP, data.length);
    stream.push(data.subarray(at, end), end === data.length);
  }
  return join(chunks, total);
}

function join(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1 && chunks[0]) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
