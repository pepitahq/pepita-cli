import { describe, it, expect } from 'vitest';
import { isSafeRelPath } from '../src/tree';

describe('isSafeRelPath', () => {
  it('accepts plain relative paths', () => {
    expect(isSafeRelPath('a/b.html')).toBe(true);
    expect(isSafeRelPath('index.html')).toBe(true);
  });

  it('rejects paths containing a .. segment', () => {
    expect(isSafeRelPath('../x')).toBe(false);
    expect(isSafeRelPath('a/../../x')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(isSafeRelPath('/etc/passwd')).toBe(false);
  });

  it('rejects empty paths', () => {
    expect(isSafeRelPath('')).toBe(false);
  });
});
