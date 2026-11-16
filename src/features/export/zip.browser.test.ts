import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { ExportError } from './errors';
import { zipFiles } from './zip';
import { buildZip, FLUSH_BYTES, MAX_ZIP_ENTRIES } from './zip-core';

interface CentralEntry {
  name: string;
  method: number;
  utf8: boolean;
  size: number;
  crc: number;
  offset: number;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** Independent CRC-32, to check what fflate wrote. */
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Reads a stored entry's data via its local header and checks it against the central CRC. */
async function expectStoredDataMatchesCrc(zip: Blob, entry: CentralEntry): Promise<Uint8Array> {
  expect(entry.method).toBe(0);
  const local = new DataView(await zip.slice(entry.offset, entry.offset + 30).arrayBuffer());
  expect(local.getUint32(0, true)).toBe(0x04034b50);
  const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const data = new Uint8Array(await zip.slice(start, start + entry.size).arrayBuffer());
  expect(crc32(data)).toBe(entry.crc);
  return data;
}

/** Reads the central directory, the part of a ZIP that Explorer and Archive Utility list from. */
async function readCentralDirectory(
  zip: Blob,
): Promise<{ entries: CentralEntry[]; count: number }> {
  const tail = new DataView(await zip.slice(zip.size - 22).arrayBuffer());
  expect(tail.getUint32(0, true)).toBe(0x06054b50); // end of central directory
  const count = tail.getUint16(10, true);
  const cdSize = tail.getUint32(12, true);
  const cdOffset = tail.getUint32(16, true);
  expect(cdOffset + cdSize).toBe(zip.size - 22);

  const cd = new Uint8Array(await zip.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const view = new DataView(cd.buffer);
  const decoder = new TextDecoder();
  const entries: CentralEntry[] = [];
  for (let p = 0; p < cd.length;) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const flags = view.getUint16(p + 8, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    entries.push({
      name: decoder.decode(cd.subarray(p + 46, p + 46 + nameLength)),
      method: view.getUint16(p + 10, true),
      utf8: (flags & 0x800) !== 0,
      size: view.getUint32(p + 24, true),
      crc: view.getUint32(p + 16, true),
      offset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, count };
}

async function unzip(zip: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await zip.arrayBuffer()));
}

const text = (s: string, type = 'text/plain') => new Blob([s], { type });

describe('zipFiles (real browser, in a worker)', () => {
  it('zips files with safe, unique names and the right content', async () => {
    const zip = await zipFiles([
      { blob: text('one'), name: 'photo.jpg' },
      { blob: text('two'), name: 'Photo.JPG' },
      { blob: text('three'), name: '../../etc/con.txt' },
      { blob: text('four'), name: 'a\u0000b<c>.txt' },
    ]);
    expect(zip.type).toBe('application/zip');
    const files = await unzip(zip);
    const decode = (name: string) => new TextDecoder().decode(files[name]);
    expect(Object.keys(files)).toEqual(['photo.jpg', 'Photo (2).JPG', 'etccon.txt', 'abc.txt']);
    expect(decode('photo.jpg')).toBe('one');
    expect(decode('Photo (2).JPG')).toBe('two');
    expect(decode('etccon.txt')).toBe('three');
    expect(decode('abc.txt')).toBe('four');
  });

  it('stores already-compressed formats and deflates the rest', async () => {
    const repetitive = 'abc'.repeat(10_000);
    const zip = await zipFiles([
      { blob: text(repetitive, 'image/jpeg'), name: 'a.jpg' },
      { blob: text(repetitive), name: 'b.png' },
      { blob: text(repetitive), name: 'c.webp' },
      { blob: text(repetitive), name: 'd.avif' },
      { blob: text(repetitive, 'application/pdf'), name: 'e.pdf' },
      { blob: text(repetitive), name: 'f.txt' },
      { blob: text(repetitive, 'image/png'), name: 'no-extension' },
    ]);
    const { entries } = await readCentralDirectory(zip);
    expect(entries.map((e) => [e.name, e.method])).toEqual([
      ['a.jpg', 0],
      ['b.png', 0],
      ['c.webp', 0],
      ['d.avif', 0],
      ['e.pdf', 0],
      ['f.txt', 8],
      ['no-extension', 0],
    ]);
    const files = await unzip(zip);
    expect(new TextDecoder().decode(files['f.txt'])).toBe(repetitive);
  });

  it('reports progress from 0 to 1, never going backwards', async () => {
    const progress: number[] = [];
    const big = new Uint8Array(3 * 1024 * 1024 + 7);
    await zipFiles(
      [
        { blob: new Blob([big], { type: 'image/png' }), name: 'a.png' },
        { blob: new Blob([big], { type: 'image/png' }), name: 'b.png' },
        { blob: new Blob([]), name: 'empty.png' },
      ],
      (p) => progress.push(p),
    );
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeGreaterThan(2);
    progress.slice(1).forEach((p, i) => expect(p).toBeGreaterThanOrEqual(progress[i] ?? 0));
  });

  it('zips 200 files with every name intact (UTF-8 flagged)', async () => {
    const names = Array.from({ length: 200 }, (_, i) => {
      const samples = [
        'photo',
        'café',
        '写真',
        'фото',
        'party 🎉',
        'a + b (c) [d] #e',
        'long'.repeat(30),
      ];
      return `${samples[i % samples.length]} ${i}.jpg`;
    });
    const zip = await zipFiles(names.map((name, i) => ({ blob: text(`file ${i}`), name })));
    const { entries, count } = await readCentralDirectory(zip);
    expect(count).toBe(200);
    expect(entries.map((e) => e.name)).toEqual(names);
    for (const entry of entries) {
      // Non-ASCII names must carry the UTF-8 flag or Explorer/Archive Utility show mojibake.
      expect(entry.utf8).toBe(/[^\x20-\x7e]/.test(entry.name));
    }
    for (const [i, entry] of entries.entries()) {
      const data = await expectStoredDataMatchesCrc(zip, entry);
      expect(new TextDecoder().decode(data)).toBe(`file ${i}`);
    }
    const files = await unzip(zip);
    expect(Object.keys(files)).toEqual(names);
    expect(new TextDecoder().decode(files[names[123] ?? ''])).toBe('file 123');
  });

  it('makes an empty but valid ZIP from no files', async () => {
    const zip = await zipFiles([]);
    expect(zip.size).toBe(22);
    expect(await unzip(zip)).toEqual({});
  });

  it('passes limit errors from the worker as ExportError codes', async () => {
    const files = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, () => ({
      blob: new Blob([]),
      name: 'a.txt',
    }));
    const result = zipFiles(files);
    await expect(result).rejects.toBeInstanceOf(ExportError);
    await expect(result).rejects.toMatchObject({ code: 'zip-too-many-files' });
  });
});

describe('buildZip limits', () => {
  it('refuses more than 65,535 files', async () => {
    const files = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, () => ({
      blob: new Blob([]),
      name: 'a.txt',
    }));
    await expect(buildZip(files)).rejects.toMatchObject({ code: 'zip-too-many-files' });
  });

  it('refuses archives over 4 GiB (no ZIP64)', async () => {
    const huge = { size: 4.5 * 1024 ** 3, type: 'image/jpeg' } as Blob;
    await expect(buildZip([{ blob: huge, name: 'big.jpg' }])).rejects.toMatchObject({
      code: 'zip-too-large',
    });
  });
});

describe('ZIP memory use', () => {
  // Chrome's performance.memory is coarse and cached unless Chrome runs with
  // --enable-precise-memory-info, so exact figures come from the DevTools protocol: the JS heap
  // plus the ArrayBuffer backing stores (where file chunks live) plus the DOM heap.
  // The figures cover the whole tab, so test files running at the same time can add noise;
  // the limits leave room for that and the tests retry.
  const heapUsed = async () => {
    const h = await cdp().send('Runtime.getHeapUsage');
    return h.usedSize + h.embedderHeapUsedSize + h.backingStorageSize;
  };
  const collectGarbage = () => cdp().send('HeapProfiler.collectGarbage');

  it('sees ArrayBuffer memory (calibration)', { retry: 2 }, async () => {
    await collectGarbage();
    const before = await heapUsed();
    const held = new Uint8Array(32 * 1024 * 1024).fill(1);
    await collectGarbage();
    const after = await heapUsed();
    expect(after - before).toBeGreaterThan(0.75 * held.length);
    expect(held[held.length - 1]).toBe(1); // keeps the buffer alive until here
  });

  it(
    'zipping 500 MB of blobs raises memory by less than 1.2x the input',
    { retry: 2, timeout: 180_000 },
    async () => {
      const MB = 1024 * 1024;
      const fileSize = 10 * MB;
      const fileCount = 50; // 500 MB in total
      const block = new Uint8Array(MB);
      for (let i = 0; i < block.length; i += 1) block[i] = Math.imul(i, 2654435761) >>> 24; // noisy bytes
      const files = Array.from({ length: fileCount }, (_, i) => ({
        blob: new Blob(
          Array.from({ length: fileSize / MB }, () => block),
          { type: 'image/jpeg' },
        ),
        name: `photo-${i}.jpg`,
      }));
      const input = fileCount * fileSize;

      await cdp().send('HeapProfiler.collectGarbage');
      const baseline = await heapUsed();
      const legacyBaseline = performanceMemory();
      let peak = baseline;
      let legacyPeak = legacyBaseline;
      const samples: Array<Promise<void>> = [];
      const zip = await buildZip(files, () => {
        legacyPeak = Math.max(legacyPeak, performanceMemory());
        samples.push(heapUsed().then((used) => void (peak = Math.max(peak, used))));
      });
      await Promise.all(samples);

      // Stored data is referenced from the input blobs, not copied, so the only extra memory is the
      // JS working set (read buffers waiting for garbage collection) plus the ZIP's own headers.
      const workingSet = peak - baseline;
      const headers = zip.size - input;
      const raise = workingSet + headers;
      console.warn(
        `ZIP memory: input ${input / MB} MB, ZIP ${(zip.size / MB).toFixed(1)} MB ` +
          `(${(headers / 1024).toFixed(1)} KB of headers, data referenced from the input); ` +
          `peak JS heap + ArrayBuffer growth ${(workingSet / MB).toFixed(1)} MB ` +
          `(performance.memory says ${((legacyPeak - legacyBaseline) / MB).toFixed(1)} MB); ` +
          `raise ${(raise / input).toFixed(3)}x input; ${samples.length} samples`,
      );
      expect(samples.length).toBeGreaterThan(50);
      expect(raise).toBeLessThan(0.3 * input);
      // Even counting the ZIP as a full second copy, the total stays under 1.2x the input.
      expect(workingSet + zip.size).toBeLessThan(1.2 * input + FLUSH_BYTES);

      const { entries, count } = await readCentralDirectory(zip);
      expect(count).toBe(fileCount);
      expect(entries.every((e) => e.method === 0 && e.size === fileSize)).toBe(true);
      for (const entry of [entries[0], entries[24], entries[49]]) {
        if (entry) await expectStoredDataMatchesCrc(zip, entry);
      }
    },
  );
});

/** Chrome-only and coarse; logged next to the exact figure for comparison. */
function performanceMemory(): number {
  const { memory } = performance as Performance & { memory?: { usedJSHeapSize: number } };
  return memory?.usedJSHeapSize ?? 0;
}
