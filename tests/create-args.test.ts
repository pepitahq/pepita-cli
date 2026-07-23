import { describe, expect, it } from 'vitest';
import { parseCreateArgs } from '../src/commands/create.js';

// The flags decide a brand-new site's security posture (embedding) and AI
// visibility — a silently mis-parsed flag ships the wrong site, so unknown
// and retired flags must FAIL rather than fall through (the pull-args rule).

describe('create args', () => {
  it('defaults: embedding denied, AI visible — matching the server defaults', () => {
    expect(parseCreateArgs(['my-site'])).toEqual({
      name: 'my-site',
      embeddable: false,
      aiVisible: true,
      from: undefined
    });
  });

  it('--allow-embedding turns embedding on', () => {
    expect(parseCreateArgs(['my-site', '--allow-embedding']).embeddable).toBe(true);
  });

  it('--block-ai-crawlers turns AI visibility off', () => {
    expect(parseCreateArgs(['my-site', '--block-ai-crawlers']).aiVisible).toBe(false);
  });

  it('--from takes a path and its value is never mistaken for the name', () => {
    const r = parseCreateArgs(['--from', './dir', 'my-site']);
    expect(r.name).toBe('my-site');
    expect(r.from).toBe('./dir');
    expect(() => parseCreateArgs(['my-site', '--from'])).toThrow(/--from <dir>/);
    expect(() => parseCreateArgs(['my-site', '--from', '--allow-embedding'])).toThrow(/--from <dir>/);
  });

  it('rejects the retired --no-analytics loudly instead of silently ignoring it', () => {
    // 0.9.x shipped it. A script still passing it must not create a site
    // while believing analytics is off.
    expect(() => parseCreateArgs(['my-site', '--no-analytics'])).toThrow(/always on at creation/);
  });

  it('rejects typos, a missing name, and two names', () => {
    expect(() => parseCreateArgs(['my-site', '--alow-embedding'])).toThrow(/unknown flag/);
    expect(() => parseCreateArgs([])).toThrow(/usage/);
    expect(() => parseCreateArgs(['a', 'b'])).toThrow(/usage/);
  });
});
