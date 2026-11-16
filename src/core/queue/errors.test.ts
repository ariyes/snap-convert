import { describe, expect, it } from 'vitest';
import { isOutOfMemoryError, jobErrorMessage } from './errors';
import { queueStrings } from './strings';

describe('job errors', () => {
  it('recognises out-of-memory errors', () => {
    expect(isOutOfMemoryError(new RangeError('Array buffer allocation failed'))).toBe(true);
    expect(isOutOfMemoryError(new RangeError('WebAssembly.Memory(): could not allocate memory'))).toBe(true);
    expect(isOutOfMemoryError(new RangeError('Invalid typed array length: 99999999999'))).toBe(true);
    expect(isOutOfMemoryError(new Error('out of memory'))).toBe(true);
    expect(isOutOfMemoryError(new Error('Unsupported file'))).toBe(false);
    expect(isOutOfMemoryError('out of memory?')).toBe(false);
  });

  it('turns errors into readable text', () => {
    expect(jobErrorMessage(new Error('This PDF is password-protected'))).toBe(
      'This PDF is password-protected',
    );
    expect(jobErrorMessage({ message: 'Plain object message' })).toBe('Plain object message');
    expect(jobErrorMessage('A string')).toBe('A string');
    expect(jobErrorMessage(new RangeError('Array buffer allocation failed'))).toBe(
      queueStrings.tooLarge,
    );
  });

  it('falls back to a generic message', () => {
    expect(jobErrorMessage(42)).toBe(queueStrings.failed);
    expect(jobErrorMessage(undefined)).toBe(queueStrings.failed);
    expect(jobErrorMessage(new Error('   '))).toBe(queueStrings.failed);
  });
});
