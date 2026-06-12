import { describe, it, expect } from 'vitest';
import { formatTimecode } from './timecode';

describe('formatTimecode', () => {
  it('reads m:ss under an hour', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(9)).toBe('0:09');
    expect(formatTimecode(75)).toBe('1:15');
    expect(formatTimecode(3599)).toBe('59:59');
  });

  it('grows to h:mm:ss past an hour, so a film does not read as 143:12', () => {
    expect(formatTimecode(3600)).toBe('1:00:00');
    expect(formatTimecode(8592)).toBe('2:23:12');
  });

  it('floors rather than rounds, so a stamp never reads ahead of the frame', () => {
    expect(formatTimecode(59.99)).toBe('0:59');
  });

  it('renders a placeholder for nothing playing, rather than a fake zero', () => {
    expect(formatTimecode(null)).toBe('--:--');
    expect(formatTimecode(undefined)).toBe('--:--');
    expect(formatTimecode(NaN)).toBe('--:--');
    expect(formatTimecode(Infinity)).toBe('--:--');
  });

  it('clamps a negative position instead of printing a minus sign', () => {
    expect(formatTimecode(-5)).toBe('0:00');
  });
});
