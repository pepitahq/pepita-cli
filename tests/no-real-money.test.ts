import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The CLI is a user surface, same as the app: real dollars (pre-markup
 * balance / AI spend / video spend) and the real↔display conversion never
 * appear in it. It receives DISPLAY amounts from the API and divides them by
 * DISPLAY prices — nothing here knows the markup exists.
 * Mirror of the app-side guard (apps/app/src/lib/client/no-real-money.test.ts).
 */
const FORBIDDEN = [
  'displayMicroUsd',
  'realFromNet',
  'SPEND_MARKUP_PCT',
  'VIDEO_RATE_MICRO_USD_PER_MIN',
  'videoChargeMicroUsd',
  'computeTopUp',
  'computeClawback',
];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('real money never reaches the CLI', () => {
  it('no CLI source references a real amount or a real↔display conversion', () => {
    const offenders: string[] = [];
    for (const file of sources(join(__dirname, '..', 'src'))) {
      const src = readFileSync(file, 'utf-8');
      for (const symbol of FORBIDDEN) {
        if (src.includes(symbol)) offenders.push(`${file} → ${symbol}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the scan sees the CLI sources (not vacuously green)', () => {
    const files = sources(join(__dirname, '..', 'src'));
    expect(files.some((f) => f.endsWith('status.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('pull.ts'))).toBe(true);
  });
});
