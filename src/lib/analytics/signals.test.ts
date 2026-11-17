import { describe, expect, it } from 'vitest';
import { countingBlocked } from './signals';

describe('countingBlocked', () => {
  it('is false with no privacy signal', () => {
    expect(countingBlocked({}, {})).toBe(false);
    expect(countingBlocked({ doNotTrack: '0', globalPrivacyControl: false }, {})).toBe(false);
    expect(countingBlocked({ doNotTrack: 'unspecified' }, {})).toBe(false);
    expect(countingBlocked({ doNotTrack: null }, { doNotTrack: null })).toBe(false);
  });

  it('honours Global Privacy Control', () => {
    expect(countingBlocked({ globalPrivacyControl: true }, {})).toBe(true);
  });

  it('honours Do Not Track in all its browser spellings', () => {
    expect(countingBlocked({ doNotTrack: '1' }, {})).toBe(true);
    expect(countingBlocked({ doNotTrack: 'yes' }, {})).toBe(true); // old Firefox
    expect(countingBlocked({}, { doNotTrack: '1' })).toBe(true); // old Safari / Edge
    expect(countingBlocked({ msDoNotTrack: '1' }, {})).toBe(true); // IE
  });

  it('is false where there is no navigator (pre-rendering)', () => {
    expect(countingBlocked(undefined, undefined)).toBe(false);
  });
});
