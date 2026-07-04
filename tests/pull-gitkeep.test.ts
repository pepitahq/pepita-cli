import { describe, expect, it } from 'vitest';
import { shouldWriteToDisc } from '../src/tree.js';

describe('shouldWriteToDisc', () => {
  it('skips .gitkeep markers, keeps everything else', () => {
    expect(shouldWriteToDisc('assets/.gitkeep')).toBe(false);
    expect(shouldWriteToDisc('.gitkeep')).toBe(false);
    expect(shouldWriteToDisc('assets/logo.png')).toBe(true);
    expect(shouldWriteToDisc('index.html')).toBe(true);
    expect(shouldWriteToDisc('.well-known/security.txt')).toBe(true);
  });
});
