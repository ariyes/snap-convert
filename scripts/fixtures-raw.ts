// `pnpm fixtures:raw` (P29): downloads the camera RAW test files into tests/fixtures/raw/cache/
// (git-ignored; 12–62 MB each, ~250 MB in all). Every file is CC0 (public domain) on raw.pixls.us,
// pinned by URL and SHA-256; see tests/fixtures/raw/SOURCES.md. Files already in the cache with the
// right hash are skipped. Tests that need a file skip with a message when it is missing.
//
// raw.pixls.us asks for landscape shots, so none of its samples is a portrait. Two "portrait"
// fixtures are made here from downloaded ones by changing only the EXIF Orientation tag (CC0
// allows it), to test that RAW files come out upright.
//
//   pnpm fixtures:raw                 all files
//   pnpm fixtures:raw canon-m50.cr3   only the named files (and what is derived from them)
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RawFixture {
  /** Name in the cache folder. */
  file: string;
  camera: string;
  /** raw.pixls.us mode column (bit depth, compression, aspect). */
  mode: string;
  url: string;
  sha256: string;
}

/** One file per brand (+ a CR3 with a HEIF preview, a high-efficiency NEF and a 61 MP ARW). */
export const RAW_FIXTURES: readonly RawFixture[] = [
  { file: 'canon-1100d.cr2', camera: 'Canon EOS 1100D', mode: 'RAW (3:2)', url: 'https://raw.pixls.us/getfile.php/1744/nice/Canon%20-%20EOS%201100D%20-%20RAW%20(3:2).CR2', sha256: '8f0ff8956ecf58de9fddda4b20d32f61576c46fa36460d358b83c42eee8d5fa8' },
  { file: 'canon-m50.cr3', camera: 'Canon EOS M50', mode: '3:2', url: 'https://raw.pixls.us/getfile.php/4656/nice/Canon%20-%20EOS%20M50%20-%203:2.CR3', sha256: '27a88fdae82516ba136e12c2cc9b934f25dbaaac24d64ab4e5517f8524463594' },
  { file: 'canon-r8.cr3', camera: 'Canon EOS R8', mode: '3:2', url: 'https://raw.pixls.us/getfile.php/6587/nice/Canon%20-%20EOS%20R8%20-%203:2.CR3', sha256: 'df33cf394573645ce03dea1b2e9f0b5cc2b7734e9e3391ee7114151414cf2812' },
  { file: 'nikon-d500.nef', camera: 'Nikon D500', mode: '12bit 12bit compressed (Lossy (type 2)) (3:2)', url: 'https://raw.pixls.us/getfile.php/2504/nice/Nikon%20-%20D500%20-%2012bit%2012bit%20compressed%20(Lossy%20(type%202))%20(3:2).NEF', sha256: '33c96a2ba7167f780928767c0545719737d601883e5f98e5edba4f71bdc99d83' },
  { file: 'nikon-zf.nef', camera: 'Nikon Z f', mode: '8bit 8bit lossy compressed (3:2)', url: 'https://raw.pixls.us/getfile.php/6887/nice/Nikon%20-%20Z%20f%20-%208bit%208bit%20lossy%20compressed%20(3:2).NEF', sha256: '98d6ca8e6c98048ca7ffed68ccaeda7b2b9f03807f0d320d97d5678db21748c2' },
  { file: 'sony-a6400.arw', camera: 'Sony ILCE-6400', mode: '12bit 12bit compressed (3:2)', url: 'https://raw.pixls.us/getfile.php/3406/nice/Sony%20-%20ILCE-6400%20-%2012bit%2012bit%20compressed%20(3:2).ARW', sha256: '8a37c80fc47c6026efa2e55279220e79460e2f470b1aa48b440f8f2d47873aa6' },
  { file: 'sony-a7r4-61mp.arw', camera: 'Sony ILCE-7RM4', mode: '12bit 12bit compressed (3:2)', url: 'https://raw.pixls.us/getfile.php/3479/nice/Sony%20-%20ILCE-7RM4%20-%2012bit%2012bit%20compressed%20(3:2).ARW', sha256: '3421b919ee81224d59f78872ee099a021bff0e2a47ae5fbbac385b182ac7241e' },
  { file: 'ricoh-gr.dng', camera: 'Ricoh GR', mode: '12bit (4:3)', url: 'https://raw.pixls.us/getfile.php/996/nice/Ricoh%20-%20GR%20-%2012bit%20(4:3).DNG', sha256: '7ceec1ea31c56b6e0414202504581b915f17818ffe018b4c8bba1393332c405e' },
  { file: 'fuji-xs10.raf', camera: 'Fujifilm X-S10', mode: '14bit 14bit compressed (3:2)', url: 'https://raw.pixls.us/getfile.php/4190/nice/Fujifilm%20-%20X-S10%20-%2014bit%2014bit%20compressed%20(3:2).RAF', sha256: '9419d1408ebf850395e5dd563beb96309466546252caf541466034c9cb7e9724' },
  { file: 'olympus-ep5.orf', camera: 'Olympus E-P5', mode: '16bit (4:3)', url: 'https://raw.pixls.us/getfile.php/1090/nice/Olympus%20-%20E-P5%20-%2016bit%20(4:3).ORF', sha256: 'a1345ebe8d8722e791cbd52778e73257c5ff457ee13988fd78eac61eec841c21' },
  { file: 'panasonic-g81.rw2', camera: 'Panasonic DMC-G81', mode: '4:3', url: 'https://raw.pixls.us/getfile.php/1518/nice/Panasonic%20-%20DMC-G81%20-%204:3.RW2', sha256: 'baf6d4697eb81e1b4c8e3374c21ee9ae5869970c73bc14a2e8485d7c481a5f20' },
  { file: 'pentax-k5iis.pef', camera: 'Pentax K-5 II s', mode: '14bit (3:2)', url: 'https://raw.pixls.us/getfile.php/1198/nice/Pentax%20-%20K-5%20II%20s%20-%2014bit%20(3:2).PEF', sha256: 'e579e7360c35e512f9c3a5c0eb9519575b87b489c6f86be82590f7706a7ed17b' },
  { file: 'samsung-nx500.srw', camera: 'Samsung NX500', mode: '12bit 12bit normal compression (3:2)', url: 'https://raw.pixls.us/getfile.php/3668/nice/Samsung%20-%20NX500%20-%2012bit%2012bit%20normal%20compression%20(3:2).SRW', sha256: '156e43118811bcecb6fcc600b5f41ee1773c4f00b6a5b2dd72e177e35f6596ab' },
];

/** Copies of downloaded files with only the IFD0 Orientation tag changed. */
export const DERIVED_FIXTURES: ReadonlyArray<{ file: string; from: string; orientation: number }> = [
  // DNG: develops upright (full decode path). 6 = rotate 90° clockwise.
  { file: 'ricoh-gr-portrait.dng', from: 'ricoh-gr.dng', orientation: 6 },
  // PEF with a full-size camera JPEG: the fast path is upright too. 8 = rotate 90° anticlockwise.
  { file: 'pentax-k5iis-portrait.pef', from: 'pentax-k5iis.pef', orientation: 8 },
];

export const RAW_CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'raw', 'cache');

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function cached(f: RawFixture): Promise<boolean> {
  const path = join(RAW_CACHE, f.file);
  if (!existsSync(path)) return false;
  return sha256(await readFile(path)) === f.sha256;
}

async function download(f: RawFixture): Promise<void> {
  const response = await fetch(f.url, { headers: { 'User-Agent': 'snap-convert-test-fixtures' } });
  if (!response.ok) throw new Error(`${f.file}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = sha256(bytes);
  if (hash !== f.sha256) throw new Error(`${f.file}: SHA-256 ${hash}, expected ${f.sha256}`);
  const path = join(RAW_CACHE, f.file);
  await writeFile(`${path}.part`, bytes);
  await rename(`${path}.part`, path);
}

/** Sets the Orientation tag (0x0112, SHORT) of a TIFF-based file's first IFD, in place. */
export function setTiffOrientation(bytes: Uint8Array, orientation: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
  if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF-based file');
  const little = order === 'II';
  const ifd = view.getUint32(4, little);
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    if (view.getUint16(at, little) === 0x0112 && view.getUint16(at + 2, little) === 3) {
      view.setUint16(at + 8, orientation, little);
      return;
    }
  }
  throw new Error('no Orientation tag in IFD0');
}

async function derive(d: (typeof DERIVED_FIXTURES)[number]): Promise<void> {
  const bytes = new Uint8Array(await readFile(join(RAW_CACHE, d.from)));
  setTiffOrientation(bytes, d.orientation);
  await writeFile(join(RAW_CACHE, d.file), bytes);
}

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const known = [...RAW_FIXTURES.map((f) => f.file), ...DERIVED_FIXTURES.map((d) => d.file)];
  const unknown = only.filter((name) => !known.includes(name));
  if (unknown.length) throw new Error(`Unknown fixture(s): ${unknown.join(', ')}`);
  const sources = new Set(
    only.flatMap((name) => [name, ...DERIVED_FIXTURES.filter((d) => d.file === name).map((d) => d.from)]),
  );
  const wanted = only.length ? RAW_FIXTURES.filter((f) => sources.has(f.file)) : RAW_FIXTURES;
  await mkdir(RAW_CACHE, { recursive: true });
  let failed = 0;
  for (const f of wanted) {
    if (await cached(f)) {
      console.warn(`ok      ${f.file}`);
      continue;
    }
    try {
      await download(f);
      console.warn(`fetched ${f.file}`);
    } catch (error) {
      failed++;
      console.error(error instanceof Error ? error.message : String(error));
    }
  }
  for (const d of DERIVED_FIXTURES) {
    if (!wanted.some((f) => f.file === d.from) || !existsSync(join(RAW_CACHE, d.from))) continue;
    await derive(d);
    console.warn(`made    ${d.file}`);
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
