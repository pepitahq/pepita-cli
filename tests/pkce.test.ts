import { describe, it, expect } from 'vitest';
import { sha256Base64Url, sha256Hex, verifyPkce } from '@pepitahq/shared';

describe('pkce/hash helpers', () => {
  // RFC 7636 A.1 test vector: verifier → challenge.
  it('matches the RFC7636 challenge vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await sha256Base64Url(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('verifyPkce accepts the matching pair and rejects mismatches', async () => {
    const v = 'a-verifier-string-of-sufficient-length-123456';
    const c = await sha256Base64Url(v);
    expect(await verifyPkce(v, c)).toBe(true);
    expect(await verifyPkce('wrong', c)).toBe(false);
  });
  it('sha256Hex is 64 lowercase hex chars', async () => {
    const h = await sha256Hex('token');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
