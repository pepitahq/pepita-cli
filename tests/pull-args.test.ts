import { describe, expect, it } from 'vitest';
import { parsePullArgs } from '../src/commands/pull.js';

// `pull` overwrites a local directory, so which state it resolves to is not a
// cosmetic detail — getting it wrong destroys the user's copy of the other one.

describe('pull target resolution', () => {
  it('defaults to the working copy — the one target that is not a committed ref', () => {
    expect(parsePullArgs(['foo']).target).toEqual({ kind: 'working' });
  });

  it('--live picks the published site', () => {
    expect(parsePullArgs(['foo', '--live']).target).toEqual({ kind: 'live' });
  });

  it('--preview picks one link by name, wherever the flag sits', () => {
    expect(parsePullArgs(['foo', '--preview', 'a3k9']).target).toEqual({
      kind: 'preview',
      name: 'a3k9'
    });
    expect(parsePullArgs(['foo', '--dir', './out', '--preview', 'a3k9']).target).toEqual({
      kind: 'preview',
      name: 'a3k9'
    });
  });

  it('refuses two targets at once instead of silently ranking them', () => {
    expect(() => parsePullArgs(['foo', '--live', '--preview', 'a3k9'])).toThrow(/not both/);
  });

  it('refuses --preview with no name, rather than reading the next flag as one', () => {
    expect(() => parsePullArgs(['foo', '--preview'])).toThrow(/--preview <name>/);
    expect(() => parsePullArgs(['foo', '--preview', '--live'])).toThrow(/--preview <name>/);
  });
});

describe('flags that must FAIL rather than fall through', () => {
  // Every rejection below would otherwise resolve to `{kind:'working'}` and
  // overwrite the directory with the working copy — the wrong state, silently.

  it('rejects the retired `--state live` with the new spelling', () => {
    // 0.8.x shipped `--state live`. Left unhandled, a script still passing it
    // would fetch the working copy while believing it fetched live.
    expect(() => parsePullArgs(['foo', '--state', 'live'])).toThrow(/`--state live` is now just `--live`/);
  });

  it('rejects a typo instead of pulling the wrong thing', () => {
    expect(() => parsePullArgs(['foo', '--liev'])).toThrow(/unknown flag '--liev'/);
    expect(() => parsePullArgs(['foo', '--previews', 'a3k9'])).toThrow(/unknown flag '--previews'/);
  });

  it('rejects --dir with no path, rather than defaulting under a flag-shaped name', () => {
    expect(() => parsePullArgs(['foo', '--dir'])).toThrow(/--dir <path>/);
    expect(() => parsePullArgs(['foo', '--dir', '--live'])).toThrow(/--dir <path>/);
  });

  it('needs a slug, and never mistakes a flag for one', () => {
    expect(() => parsePullArgs([])).toThrow(/usage/);
    expect(() => parsePullArgs(['--live'])).toThrow(/usage/);
  });
});

describe('output directory', () => {
  it('defaults to ./<slug> and is overridden by --dir', () => {
    expect(parsePullArgs(['foo']).dir).toBe('./foo');
    expect(parsePullArgs(['foo', '--dir', '/tmp/out']).dir).toBe('/tmp/out');
  });

  it('a preview name is never mistaken for the directory', () => {
    const r = parsePullArgs(['foo', '--preview', 'a3k9']);
    expect(r.dir).toBe('./foo');
  });
});
