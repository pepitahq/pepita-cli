import { describe, it, expect } from 'vitest';
import { parseFormArgs, runGet, runList } from '../src/commands/form.js';

// Epoch SECONDS, which is what the column stores. A millisecond-scale fixture
// makes a missing ×1000 look correct.
const SECS = 1_785_000_000; // 2026-07-25T17:20:00.000Z

const rec = (i: number) => ({
  id: `r${i}`,
  data: { email: `p${i}@example.com` },
  branch: 'main',
  createdAt: SECS + i
});

function fakeApi(over: Record<string, unknown> = {}) {
  return {
    listFormCollections: async () => [{ name: 'contact', count: 2, lastAt: 2, firstAt: 1 }],
    // The whole collection, every source at once — the shape the endpoint now
    // returns. Two sources on purpose: filtering is the CLI's job now, so a fake
    // with only one source could not catch a filter that does nothing.
    getFormRecords: async () => ({
      fields: ['email'],
      records: [rec(1), { ...rec(2), branch: 'editor' }]
    }),
    ...over
  } as never;
}

describe('parseFormArgs', () => {
  it('requires --site', () => {
    expect(() => parseFormArgs(['contact'])).toThrow(/--site/);
  });

  it('reads the form name positionally, even after flags', () => {
    expect(parseFormArgs(['--site', 's', 'contact']).name).toBe('contact');
  });

  it('refuses --live and --preview together', () => {
    expect(() => parseFormArgs(['contact', '--site', 's', '--live', '--preview', 'k4t9'])).toThrow(
      /both/i
    );
  });

  // A valueless --preview used to parse as "no preview", which means the EDITOR
  // source — the founder asks for a preview link's submissions and silently
  // gets their own test rows.
  it('refuses --preview with no name rather than reading the editor', () => {
    expect(() => parseFormArgs(['contact', '--site', 's', '--preview'])).toThrow(/preview name/i);
    expect(() =>
      parseFormArgs(['contact', '--site', 's', '--preview', '--csv', 'out.csv'])
    ).toThrow(/preview name/i);
  });

  // Otherwise --live would win the both-flags check by default, which is the
  // silent winner that check exists to prevent.
  it('refuses a valueless --preview even when --live is also given', () => {
    expect(() => parseFormArgs(['contact', '--site', 's', '--live', '--preview'])).toThrow(
      /preview name/i
    );
  });

  it('reads --csv as a path', () => {
    expect(parseFormArgs(['contact', '--site', 's', '--csv', 'out.csv']).csv).toBe('out.csv');
  });

  // --csv's value is a positional-looking token: if it were not on VALUE_FLAGS
  // the form name would resolve to the file path.
  it('does not mistake the --csv path for the form name', () => {
    const a = parseFormArgs(['--site', 's', '--csv', 'out.csv', 'contact']);
    expect(a.name).toBe('contact');
    expect(a.csv).toBe('out.csv');
  });

  it('leaves csv undefined when the flag is absent', () => {
    expect(parseFormArgs(['contact', '--site', 's']).csv).toBeUndefined();
  });

  it('reads --xlsx as a path', () => {
    expect(parseFormArgs(['contact', '--site', 's', '--xlsx', 'out.xlsx']).xlsx).toBe('out.xlsx');
  });

  it('does not mistake the --xlsx path for the form name', () => {
    const a = parseFormArgs(['--site', 's', '--xlsx', 'out.xlsx', 'contact']);
    expect(a.name).toBe('contact');
    expect(a.xlsx).toBe('out.xlsx');
  });

  it('leaves xlsx undefined when the flag is absent', () => {
    expect(parseFormArgs(['contact', '--site', 's']).xlsx).toBeUndefined();
  });

  it('reads --json as a path', () => {
    expect(parseFormArgs(['contact', '--site', 's', '--json', 'out.json']).json).toBe('out.json');
  });

  // --json's value is a positional-looking token: if it were not on VALUE_FLAGS
  // the form name would resolve to the file path.
  it('does not mistake the --json path for the form name', () => {
    const a = parseFormArgs(['--site', 's', '--json', 'out.json', 'contact']);
    expect(a.name).toBe('contact');
    expect(a.json).toBe('out.json');
  });

  it('leaves json undefined when the flag is absent', () => {
    expect(parseFormArgs(['contact', '--site', 's']).json).toBeUndefined();
  });
});

describe('runList', () => {
  it('shows each form and its count', async () => {
    const out = await runList(fakeApi(), 's');
    expect(out).toContain('contact');
    expect(out).toContain('2');
  });

  // Without this, a founder reads "contact 40", runs `form get contact`, is
  // told there are none, and concludes the data is lost.
  it('says the counts are cross-source and that get reads the editor by default', async () => {
    const out = await runList(fakeApi(), 's');
    expect(out).toMatch(/every source together/i);
    expect(out).toMatch(/--live/);
  });

  it('says so when the listing came back at the cap', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      name: `f${i}`,
      count: 1,
      lastAt: 2,
      firstAt: 1
    }));
    const out = await runList(fakeApi({ listFormCollections: async () => many }), 's');
    expect(out).toMatch(/capped/i);
  });

  it('does not claim a cap on a short listing', async () => {
    expect(await runList(fakeApi(), 's')).not.toMatch(/capped/i);
  });
});

describe('runGet', () => {
  it('reads the editor source by default', async () => {
    // Unchanged guarantee, new mechanism: the source is no longer a query
    // parameter, so this now asserts the LOCAL filter picked the right rows.
    const out = await runGet(fakeApi(), {
      site: 's',
      name: 'contact',
      live: false,
      preview: undefined,
      csv: undefined
    });
    expect(out).toContain('p2@example.com'); // the editor row
    expect(out).not.toContain('p1@example.com'); // the live row
  });

  it('reads the live source with --live', async () => {
    const out = await runGet(fakeApi(), {
      site: 's',
      name: 'contact',
      live: true,
      preview: undefined,
      csv: undefined
    });
    expect(out).toContain('p1@example.com');
    expect(out).not.toContain('p2@example.com');
  });

  it('fetches exactly once — there is no paging left', async () => {
    let calls = 0;
    const api = fakeApi({
      getFormRecords: async () => {
        calls++;
        return { fields: ['email'], records: [rec(1)] };
      }
    });
    await runGet(api, { site: 's', name: 'contact', live: true, preview: undefined, csv: undefined });
    expect(calls).toBe(1);
  });

  it('prints EVERY record, with no cap and no refusal', async () => {
    // The old FORM_RECORDS_PAGE gate refused rather than truncate, because a
    // collection could be arbitrarily large. Ingest now caps a form at 1000, and
    // a terminal has room for 1000 lines — so printing everything IS the
    // behaviour, and a refusal would be the bug.
    const many = Array.from({ length: 150 }, (_, i) => rec(i));
    const api = fakeApi({
      getFormRecords: async () => ({ fields: ['email'], records: many })
    });
    const out = await runGet(api, {
      site: 's',
      name: 'contact',
      live: true,
      preview: undefined,
      csv: undefined
    });
    expect(out.split('\n')).toHaveLength(150);
    expect(out).toContain('p149@example.com');
  });

  it('says so plainly when this source has none', async () => {
    const api = fakeApi({
      getFormRecords: async () => ({ fields: ['email'], records: [rec(1)] })
    });
    // rec(1) is on 'main'; the default source is the editor.
    const out = await runGet(api, {
      site: 's',
      name: 'contact',
      live: false,
      preview: undefined,
      csv: undefined
    });
    expect(out).toMatch(/No records/i);
  });

  it('prints the stored timestamp as a present-day instant, not January 1970', async () => {
    // createdAt is epoch SECONDS. `new Date(seconds)` does not fail — it yields
    // a 1970 date, and every submission lands within twenty days of every other,
    // so the column reads as plausible-but-wrong rather than broken.
    const out = await runGet(fakeApi(), {
      site: 's',
      name: 'contact',
      live: true,
      preview: undefined,
      csv: undefined
    });
    expect(out).toContain('2026-');
    expect(out).not.toContain('1970-');
  });
});
