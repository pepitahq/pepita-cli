import { describe, expect, it } from 'vitest';
import { formatPreflightError } from '../src/tree.js';

describe('formatPreflightError', () => {
  it('lists per-file violations and the total overflow with MB figures', () => {
    const msg = formatPreflightError({
      ok: false,
      currentTotal: 19 * 1024 * 1024,
      projectedTotal: 22 * 1024 * 1024,
      budget: { totalBytes: 20 * 1024 * 1024, perFileBytes: 5 * 1024 * 1024 },
      perFileViolations: [{ path: 'big.jpg', size: 6 * 1024 * 1024 }],
      blockedPaths: []
    });
    expect(msg).toContain('big.jpg');
    expect(msg).toContain('6.0 MB');
    expect(msg).toContain('5 MB per file');
    expect(msg).toContain('22.0 MB');
    expect(msg).toContain('20 MB per site');
  });
});
