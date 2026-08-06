import { describe, it, expect } from 'vitest';
import { UsageError } from '../src/api.js';
import {
  parseContentArgs,
  resolveRecordId,
  runAdd,
  runGet,
  runList,
  runPut
} from '../src/commands/content.js';

function fakeApi(over: Record<string, unknown>) {
  return new Proxy({} as never, {
    get: (_t, prop) =>
      prop in over
        ? over[prop as string]
        : () => {
            throw new Error(`unexpected call: ${String(prop)}`);
          }
  });
}

const wire = (id: string, slug: string | null, title: string) => ({
  id,
  slug,
  data: { title },
  createdAtMs: 1_754_300_000_000,
  updatedAtMs: 1_754_300_000_000
});

describe('parseContentArgs', () => {
  it('requires --site', () => {
    expect(() => parseContentArgs(['blog'])).toThrow(UsageError);
  });

  it('refuses --id and --content-slug together, naming both', () => {
    expect(() =>
      parseContentArgs(['blog', '--site', 'acme', '--id', 'r1', '--content-slug', 'a-1111'])
    ).toThrow(/--id.*--content-slug/);
  });

  it('accepts either address on its own', () => {
    expect(parseContentArgs(['blog', '--site', 'acme', '--id', 'r1']).id).toBe('r1');
    expect(parseContentArgs(['blog', '--site', 'acme', '--content-slug', 'a-1111']).contentSlug).toBe(
      'a-1111'
    );
  });

  it('never mistakes a flag value for the collection name', () => {
    expect(parseContentArgs(['--site', 'acme', '--content-slug', 'a-1111', 'blog']).name).toBe('blog');
    expect(parseContentArgs(['--site', 'acme', '--limit', '25', 'blog']).name).toBe('blog');
  });

  it('parses --limit as a number and leaves it undefined when absent', () => {
    expect(parseContentArgs(['blog', '--site', 'acme', '--limit', '25']).limit).toBe(25);
    expect(parseContentArgs(['blog', '--site', 'acme']).limit).toBeUndefined();
  });
});

describe('resolveRecordId', () => {
  it('returns an --id unchanged, without a lookup', async () => {
    const api = fakeApi({});
    expect(await resolveRecordId(api, 'acme', 'blog', { id: 'r1' })).toBe('r1');
  });

  it('finds an item by slug, since there is no by-slug endpoint', async () => {
    const api = fakeApi({
      getContentRecords: async () => ({
        records: [wire('r1', 'soup-1111', 'Soup'), wire('r2', 'stew-2222', 'Stew')],
        total: 2,
        oldestFirst: false
      })
    });
    expect(await resolveRecordId(api, 'acme', 'blog', { contentSlug: 'stew-2222' })).toBe('r2');
  });

  it('cannot reach a null-slug item by slug, and says to use --id', async () => {
    const api = fakeApi({
      getContentRecords: async () => ({ records: [wire('r1', null, 'Old')], total: 1, oldestFirst: false })
    });
    await expect(resolveRecordId(api, 'acme', 'blog', { contentSlug: 'old-1111' })).rejects.toThrow(
      /--id/
    );
  });

  it('requires exactly one address', async () => {
    const api = fakeApi({});
    await expect(resolveRecordId(api, 'acme', 'blog', {})).rejects.toThrow(UsageError);
  });
});

describe('runAdd', () => {
  it('refuses a file whose root is not an array', async () => {
    const api = fakeApi({});
    await expect(runAdd(api, 'acme', 'blog', '{"title":"x"}')).rejects.toThrow(/array/i);
  });

  it('refuses invalid JSON, carrying the parser reason through', async () => {
    const api = fakeApi({});
    await expect(runAdd(api, 'acme', 'blog', '[{')).rejects.toThrow(/not valid JSON/);
  });

  it('prints the server-minted address for every created item', async () => {
    const api = fakeApi({
      addContentRecords: async () => [
        { id: 'r1', slug: 'soup-1111' },
        { id: 'r2', slug: 'stew-2222' }
      ]
    });
    const out = await runAdd(api, 'acme', 'blog', '[{"title":"Soup"},{"title":"Stew"}]');
    expect(out).toContain('soup-1111');
    expect(out).toContain('r2');
    expect(out).toMatch(/2 items/);
  });

  it('passes the parsed array straight through, unwrapped', async () => {
    let seen: unknown;
    const api = fakeApi({
      addContentRecords: async (_s: string, _n: string, records: unknown[]) => {
        seen = records;
        return [{ id: 'r1', slug: 'a-1111' }];
      }
    });
    await runAdd(api, 'acme', 'blog', '[{"title":"Soup"}]');
    expect(seen).toEqual([{ title: 'Soup' }]);
  });
});

describe('runPut', () => {
  it('refuses an array — put addresses ONE item', async () => {
    const api = fakeApi({});
    await expect(runPut(api, 'acme', 'blog', 'r1', '[{"title":"x"}]')).rejects.toThrow(/ONE item/);
  });
});

describe('runGet', () => {
  it('prints one line per item, address first', async () => {
    const api = fakeApi({
      getContentRecords: async () => ({
        records: [wire('r1', 'soup-1111', 'Soup')],
        total: 1,
        oldestFirst: false
      })
    });
    const out = await runGet(api, 'acme', 'blog', {});
    expect(out).toContain('soup-1111');
    expect(out).toContain('title=Soup');
  });

  it('marks an item that has no address rather than printing an empty column', async () => {
    const api = fakeApi({
      getContentRecords: async () => ({ records: [wire('r1', null, 'Old')], total: 1, oldestFirst: false })
    });
    expect(await runGet(api, 'acme', 'blog', {})).toContain('(no address)');
  });

  it('wraps the machine-readable form, keeping fields out of the address space', async () => {
    const api = fakeApi({
      getContentRecords: async () => ({
        records: [wire('r1', 'soup-1111', 'Soup')],
        total: 1,
        oldestFirst: false
      })
    });
    const out = await runGet(api, 'acme', 'blog', { asJson: true });
    expect(JSON.parse(out)).toEqual([
      {
        id: 'r1',
        slug: 'soup-1111',
        createdAtMs: 1_754_300_000_000,
        updatedAtMs: 1_754_300_000_000,
        fields: { title: 'Soup' }
      }
    ]);
  });

  it('forwards limit and oldest to the client', async () => {
    let seen: unknown;
    const api = fakeApi({
      getContentRecords: async (_s: string, _n: string, opts: unknown) => {
        seen = opts;
        return { records: [], total: 0, oldestFirst: true };
      }
    });
    await runGet(api, 'acme', 'blog', { limit: 25, oldest: true });
    expect(seen).toEqual({ limit: 25, oldest: true });
  });
});

describe('runList', () => {
  it('shows a collection that has a template but no items', async () => {
    const api = fakeApi({ listContentCollections: async () => [{ name: 'blog', count: 0 }] });
    expect(await runList(api, 'acme')).toContain('blog');
  });

  it('points at the template command when there is nothing at all', async () => {
    const api = fakeApi({ listContentCollections: async () => [] });
    expect(await runList(api, 'acme')).toMatch(/content template put/);
  });
});
