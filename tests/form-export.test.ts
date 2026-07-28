import { describe, test, expect } from 'vitest';
import { runGet } from '../src/commands/form.js';

/**
 * `--csv`/`--xlsx` no longer walk pages and build the file in the CLI — both
 * now go through the server's export endpoint (`client.exportFormRecords`),
 * so the file a founder downloads in the editor and the one the CLI writes
 * cannot diverge. See form-args.test.ts for the plain-text (no format) path,
 * which is unchanged.
 */
function fakeClient(over: Record<string, unknown> = {}) {
  return {
    exportFormRecords: async () => ({ bytes: new Uint8Array(), truncated: false }),
    ...over
  } as never;
}

describe('runGet — export formats', () => {
  test('--xlsx writes the server bytes verbatim', async () => {
    const written: { path: string; bytes: Uint8Array }[] = [];
    const client = fakeClient({
      exportFormRecords: async () => ({ bytes: new Uint8Array([1, 2, 3]), truncated: false })
    });
    const msg = await runGet(
      client,
      { site: 's', name: 'contact', live: true, xlsx: 'out.xlsx' },
      async (p, b) => void written.push({ path: p, bytes: b })
    );
    expect(written[0].path).toBe('out.xlsx');
    expect(Array.from(written[0].bytes)).toEqual([1, 2, 3]);
    expect(msg).toContain('out.xlsx');
  });

  test('--csv goes through the export endpoint, not a client-side build', async () => {
    let calledWith: unknown = null;
    const client = fakeClient({
      exportFormRecords: async (_s: string, _n: string, o: unknown) => {
        calledWith = o;
        return { bytes: new TextEncoder().encode('submitted_at\n'), truncated: false };
      }
    });
    await runGet(client, { site: 's', name: 'contact', live: true, csv: 'out.csv' }, async () => {});
    expect(calledWith).toMatchObject({ format: 'csv' });
  });

  // The escape hatch for a collection too wide for xlsx/csv (`form_fields_too_wide`)
  // — json has no columns to merge, so it must route through the same export call.
  test('--json goes through the export endpoint with format json', async () => {
    let calledWith: unknown = null;
    const client = fakeClient({
      exportFormRecords: async (_s: string, _n: string, o: unknown) => {
        calledWith = o;
        return { bytes: new TextEncoder().encode('[]'), truncated: false };
      }
    });
    const msg = await runGet(
      client,
      { site: 's', name: 'contact', live: true, json: 'out.json' },
      async () => {}
    );
    expect(calledWith).toMatchObject({ format: 'json' });
    expect(msg).toContain('out.json');
  });

  test('a truncated export says so rather than reporting success', async () => {
    const client = fakeClient({
      exportFormRecords: async () => ({ bytes: new Uint8Array([1]), truncated: true })
    });
    const msg = await runGet(
      client,
      { site: 's', name: 'contact', live: true, xlsx: 'out.xlsx' },
      async () => {}
    );
    expect(msg.toLowerCase()).toContain('partial');
  });

  // A founder who gets the wrong format silently would not notice until they
  // opened the file — this must throw rather than pick one.
  test('--csv and --xlsx together throw, naming both', async () => {
    const client = fakeClient();
    await expect(
      runGet(
        client,
        { site: 's', name: 'contact', live: true, csv: 'out.csv', xlsx: 'out.xlsx' },
        async () => {}
      )
    ).rejects.toThrow(/out\.csv[\s\S]*out\.xlsx|out\.xlsx[\s\S]*out\.csv/);
  });

  // Same guard, the other pair — the error must name whichever two flags were
  // actually passed, not a hardcoded --csv/--xlsx pair.
  test('--json and --xlsx together throw, naming both', async () => {
    const client = fakeClient();
    await expect(
      runGet(
        client,
        { site: 's', name: 'contact', live: true, json: 'out.json', xlsx: 'out.xlsx' },
        async () => {}
      )
    ).rejects.toThrow(/out\.json[\s\S]*out\.xlsx|out\.xlsx[\s\S]*out\.json/);
  });

  test('the branch/source is forwarded to the export call', async () => {
    let calledWith: { branch?: string } | null = null;
    const client = fakeClient({
      exportFormRecords: async (_s: string, _n: string, o: { branch?: string }) => {
        calledWith = o;
        return { bytes: new Uint8Array(), truncated: false };
      }
    });
    await runGet(
      client,
      { site: 's', name: 'contact', live: false, xlsx: 'out.xlsx' },
      async () => {}
    );
    expect(calledWith).toMatchObject({ branch: 'editor' });
  });
});
