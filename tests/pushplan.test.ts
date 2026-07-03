import { describe, it, expect } from 'vitest';
import { computePushPlan } from '../src/tree';

type F = { content: string; encoding: 'utf-8' | 'base64' };
const m = (o: Record<string, string>) =>
  new Map<string, F>(Object.entries(o).map(([k, v]) => [k, { content: v, encoding: 'utf-8' as const }]));

describe('computePushPlan', () => {
  it('writes new + changed, deletes removed, skips identical', () => {
    const local = m({ 'a.html': '1', 'b.css': 'new', 'c.js': 'same' });
    const remote = m({ 'a.html': '0', 'c.js': 'same', 'old.txt': 'x' });
    const plan = computePushPlan(local, remote);
    expect(plan.writes.sort()).toEqual(['a.html', 'b.css']); // a changed, b new
    expect(plan.deletes).toEqual(['old.txt']);
  });
  it('treats an encoding change as a write', () => {
    const local = new Map([['x.png', { content: 'AAAA', encoding: 'base64' as const }]]);
    const remote = new Map([['x.png', { content: 'AAAA', encoding: 'utf-8' as const }]]);
    expect(computePushPlan(local, remote).writes).toEqual(['x.png']);
  });
  it('empty local against non-empty remote deletes everything', () => {
    expect(computePushPlan(new Map(), m({ 'a': '1' })).deletes).toEqual(['a']);
  });
});
