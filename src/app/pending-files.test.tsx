import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingFiles,
  setPendingFiles,
  takePendingFiles,
  usePendingFiles,
} from './pending-files';

const a = new File(['a'], 'a.jpg');
const b = new File(['b'], 'b.jpg');

afterEach(clearPendingFiles);

describe('pending files', () => {
  it('hands files to the chosen tool once', () => {
    setPendingFiles('compress-image', [a, b]);
    expect(takePendingFiles('merge-pdf')).toEqual([]);
    expect(takePendingFiles('compress-image')).toEqual([a, b]);
    expect(takePendingFiles('compress-image')).toEqual([]);
  });

  it('replaces files that were never picked up', () => {
    setPendingFiles('compress-image', [a]);
    setPendingFiles('merge-pdf', [b]);
    expect(takePendingFiles('compress-image')).toEqual([]);
    expect(takePendingFiles('merge-pdf')).toEqual([b]);
  });

  it('usePendingFiles delivers on mount, only to the matching tool', () => {
    setPendingFiles('compress-image', [a]);
    const other = vi.fn();
    const mine = vi.fn();
    function Tool({ id, onFiles }: { id: string; onFiles: (files: File[]) => void }) {
      usePendingFiles(id, onFiles);
      return null;
    }
    render(<Tool id="merge-pdf" onFiles={other} />);
    render(<Tool id="compress-image" onFiles={mine} />);
    expect(other).not.toHaveBeenCalled();
    expect(mine).toHaveBeenCalledExactlyOnceWith([a]);
  });
});
