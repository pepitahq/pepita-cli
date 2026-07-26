import { describe, it, expect } from 'vitest';
import { parseFormArgs, runGet, runList } from '../src/commands/form.js';

const rec = (i: number) => ({
  id: `r${i}`,
  data: { email: `p${i}@example.com` },
  branch: 'main',
  createdAt: 1_700_000_000_000 + i
});

function fakeApi(over: Record<string, unknown> = {}) {
  return {
    listFormCollections: async () => [{ name: 'contact', count: 2, lastAt: 2, firstAt: 1 }],
    getFormRecords: async () => ({
      fields: ['email'],
      branches: [{ branch: 'editor', count: 1 }],
      records: [rec(1)],
      nextCursor: null
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
});

describe('runList', () => {
  it('shows each form and its count', async () => {
    const out = await runList(fakeApi(), 's');
    expect(out).toContain('contact');
    expect(out).toContain('2');
  });
});

describe('runGet', () => {
  it('reads the editor source by default', async () => {
    let branch = '';
    const api = fakeApi({
      getFormRecords: async (_s: string, _n: string, o: { branch: string }) => {
        branch = o.branch;
        return {
          fields: ['email'],
          branches: [{ branch: 'editor', count: 1 }],
          records: [rec(1)],
          nextCursor: null
        };
      }
    });
    await runGet(api, { site: 's', name: 'contact', live: false, preview: undefined, csv: undefined });
    expect(branch).toBe('editor');
  });

  it('refuses to truncate: over the limit without --csv it errors and names the count', async () => {
    const api = fakeApi({
      getFormRecords: async () => ({
        fields: ['email'],
        branches: [{ branch: 'main', count: 250 }],
        records: Array.from({ length: 50 }, (_, i) => rec(i)),
        nextCursor: 'more'
      })
    });
    await expect(
      runGet(api, { site: 's', name: 'contact', live: true, preview: undefined, csv: undefined })
    ).rejects.toThrow(/250[\s\S]*--csv/);
  });

  it('does NOT refuse a small source just because another one is large', async () => {
    // 300 live rows, 3 editor rows; the default read is the editor source.
    const api = fakeApi({
      getFormRecords: async () => ({
        fields: ['email'],
        branches: [
          { branch: 'main', count: 300 },
          { branch: 'editor', count: 3 }
        ],
        records: [rec(1), rec(2), rec(3)],
        nextCursor: null
      })
    });
    const out = await runGet(api, {
      site: 's',
      name: 'contact',
      live: false,
      preview: undefined,
      csv: undefined
    });
    expect(out.split('\n')).toHaveLength(3);
  });

  it('with --csv it walks every page, past the limit', async () => {
    let calls = 0;
    const api = fakeApi({
      getFormRecords: async () => {
        calls++;
        return {
          fields: ['email'],
          branches: [{ branch: 'main', count: 150 }],
          records: Array.from({ length: 50 }, (_, i) => rec(i)),
          nextCursor: calls < 3 ? 'more' : null
        };
      }
    });
    const written: Record<string, string> = {};
    await runGet(
      api,
      { site: 's', name: 'contact', live: true, preview: undefined, csv: '/tmp/out.csv' },
      async (p, c) => {
        written[p] = c;
      }
    );
    expect(calls).toBe(3);
    expect(written['/tmp/out.csv'].split('\n')).toHaveLength(151); // header + 150
  });

  it('writes a header even when the form is empty, so the file is still a table', async () => {
    const api = fakeApi({
      getFormRecords: async () => ({
        fields: ['email'],
        branches: [],
        records: [],
        nextCursor: null
      })
    });
    const written: Record<string, string> = {};
    await runGet(
      api,
      { site: 's', name: 'contact', live: true, preview: undefined, csv: '/tmp/e.csv' },
      async (p, c) => {
        written[p] = c;
      }
    );
    expect(written['/tmp/e.csv']).toBe('submitted_at,email');
  });
});
