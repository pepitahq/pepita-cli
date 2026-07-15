import { describe, expect, it } from 'vitest';
import {
  flagValue,
  positional,
  formatBytes,
  formatDuration,
  formatTimestamp,
  renderTable
} from '../src/commands/asset.js';

describe('asset arg parsing', () => {
  it('reads a flag value, ignoring a missing or flag-shaped one', () => {
    expect(flagValue(['list', '--site', 'docs-1a2b'], '--site')).toBe('docs-1a2b');
    expect(flagValue(['list', '--site'], '--site')).toBeUndefined();
    expect(flagValue(['list', '--site', '--yes'], '--site')).toBeUndefined();
    expect(flagValue(['list'], '--site')).toBeUndefined();
  });

  it("takes the positional and never a flag's value", () => {
    expect(positional(['--site', 'docs', 'clip.mp4'], ['--site'])).toBe('clip.mp4');
    expect(positional(['clip.mp4', '--site', 'docs'], ['--site'])).toBe('clip.mp4');
    expect(positional(['--site', 'docs'], ['--site'])).toBeUndefined();
    expect(positional(['abc', '--site', 'docs', '--out', 'x.mp4'], ['--site', '--out'])).toBe('abc');
  });
});

describe('asset formatting', () => {
  it('formats bytes and duration, with an em dash for null', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024 * 1024 * 4)).toBe('4.0 MB');
    expect(formatBytes(null)).toBe('—');
    expect(formatDuration(93_000)).toBe('1:33');
    expect(formatDuration(null)).toBe('—');
  });

  it('pads table columns', () => {
    const out = renderTable([
      ['ID', 'STATUS'],
      ['a', 'ready'],
      ['longer-id', 'processing']
    ]);
    expect(out.split('\n')[1]).toBe('a          ready');
  });
});

describe('asset timestamps', () => {
  it('renders unix SECONDS (what D1 unixepoch() gives), not milliseconds', () => {
    // 2026-07-14T00:00:00Z as unix seconds — must not read as 1970.
    expect(formatTimestamp(1_783_987_200)).toBe('2026-07-14T00:00:00.000Z');
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp(undefined)).toBe('—');
  });

  it('keeps duration in MILLISECONDS (duration_ms really is ms)', () => {
    expect(formatDuration(93_000)).toBe('1:33');
  });
});
