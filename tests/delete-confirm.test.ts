import { describe, expect, it } from 'vitest';
import { confirmMatchesSlug } from '../src/commands/delete.js';

describe('confirmMatchesSlug', () => {
  it('exact slug confirms; trimmed', () => {
    expect(confirmMatchesSlug('docs-1a2b', 'docs-1a2b')).toBe(true);
    expect(confirmMatchesSlug('  docs-1a2b  ', 'docs-1a2b')).toBe(true);
  });
  it('anything else does not', () => {
    expect(confirmMatchesSlug('y', 'docs-1a2b')).toBe(false);
    expect(confirmMatchesSlug('', 'docs-1a2b')).toBe(false);
    expect(confirmMatchesSlug('docs', 'docs-1a2b')).toBe(false);
  });
});
