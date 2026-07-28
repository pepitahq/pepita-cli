import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VERSION, CLIENT_ID } from '../src/version.js';

describe('VERSION', () => {
  // The runtime constant and package.json are two places holding one fact.
  // This is what makes that safe: drift fails here instead of shipping a binary
  // that misreports itself to the server's version handshake.
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });

  it('is the kind/version shape the server parses', () => {
    expect(CLIENT_ID).toBe(`cli/${VERSION}`);
    expect(CLIENT_ID.split('/')).toHaveLength(2);
  });
});
