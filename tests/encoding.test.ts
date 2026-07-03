import { describe, it, expect } from 'vitest';
import { encodingFor } from '../src/tree';

describe('encodingFor', () => {
  it('treats html as utf-8', () => {
    expect(encodingFor('a.html')).toBe('utf-8');
  });

  it('treats json as base64 (not in the app text-storage set)', () => {
    expect(encodingFor('a.json')).toBe('base64');
  });

  it('treats the extension-less _headers file as utf-8', () => {
    expect(encodingFor('_headers')).toBe('utf-8');
  });

  it('treats images as base64', () => {
    expect(encodingFor('img.png')).toBe('base64');
  });
});
