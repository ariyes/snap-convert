// Fixture loading for the intake unit tests (Node side of Vitest; not used by app code).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Bytes of a file under tests/fixtures/. */
export function fixtureBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures', path)));
}

/** A File named after the fixture (or `name`), with the fixture's bytes. */
export function fixtureFile(path: string, name = path.split('/').pop() ?? path): File {
  return new File([fixtureBytes(path) as Uint8Array<ArrayBuffer>], name);
}
