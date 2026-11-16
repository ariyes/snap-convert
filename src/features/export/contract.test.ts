import { describe, expectTypeOf, it } from 'vitest';
import type {
  ApplyNamePattern,
  CanSaveToFolder,
  DownloadBlob,
  SaveToFolder,
  UniqueNames,
  ZipFiles,
} from '@/core/contracts/export';
import {
  applyNamePattern,
  canSaveToFolder,
  downloadBlob,
  saveToFolder,
  uniqueNames,
  zipFiles,
} from './index';

// Checked by `pnpm typecheck`: the module implements the shared contract exactly.
describe('export contract', () => {
  it('matches src/core/contracts/export.ts', () => {
    expectTypeOf(applyNamePattern).toExtend<ApplyNamePattern>();
    expectTypeOf(uniqueNames).toExtend<UniqueNames>();
    expectTypeOf(downloadBlob).toExtend<DownloadBlob>();
    expectTypeOf(zipFiles).toExtend<ZipFiles>();
    expectTypeOf(canSaveToFolder).toExtend<CanSaveToFolder>();
    expectTypeOf(saveToFolder).toExtend<SaveToFolder>();
  });
});
