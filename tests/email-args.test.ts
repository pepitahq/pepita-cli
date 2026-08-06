import { describe, it, expect } from 'vitest';
import { PepitaHttpError } from '../src/api.js';
import { parseTemplateArgs, runPut, runRead } from '../src/commands/email.js';

const T = { id: 'a1', name: 'contact', sha: 'sha-1', subject: 'S', from: 'info', fromName: 'Acme', toField: 'email' };

function fakeApi(overrides: Partial<Record<string, any>> = {}) {
  return {
    listTemplates: async () => [T],
    readTemplate: async () => ({ ...T, html: '<p>old</p>' }),
    createTemplate: async () => ({ ...T, sha: 'sha-new' }),
    updateTemplate: async (_s: string, _id: string, body: any) => ({ ok: true, sha: 'sha-2', _body: body }),
    deleteTemplate: async () => {},
    ...overrides
  } as any;
}

describe('parseTemplateArgs', () => {
  it('requires --site', () => {
    expect(() => parseTemplateArgs(['contact'])).toThrow(/--site/);
  });
  it('rejects a --to-field flag outright, in either spelling', () => {
    expect(() => parseTemplateArgs(['contact', '--site', 's', '--to-field', 'x'])).toThrow(/email/);
    // `--to-field=x` is one argv entry, so a bare includes() would wave it
    // through — silently ignored, the exact outcome the refusal exists to stop.
    expect(() => parseTemplateArgs(['contact', '--site', 's', '--to-field=x'])).toThrow(/email/);
  });
  it('finds the form name after the flags, like `asset info` does', () => {
    expect(parseTemplateArgs(['--site', 'acme', 'contact']).name).toBe('contact');
    // A flag's VALUE is never the form name, even one that looks like a name.
    expect(parseTemplateArgs(['--site', 'acme', '--from-name', 'Acme Ltd', 'contact']).name).toBe('contact');
  });
});

describe('runPut', () => {
  it('updates an existing template with the sha it just read (CAS)', async () => {
    let put: any;
    const client = fakeApi({ updateTemplate: async (_s: string, _i: string, b: any) => { put = b; return { ok: true, sha: 'sha-2' }; } });
    await runPut(client, { site: 's', name: 'contact', html: '<p>new</p>', subject: 'Hello' });
    expect(put.expectedSha).toBe('sha-1');
    expect(put.content).toBe('<p>new</p>');
    expect(put.subject).toBe('Hello');
    expect('toField' in put).toBe(false);
  });
  it('envelope-only put re-sends the current body (full-overwrite PUT)', async () => {
    let put: any;
    const client = fakeApi({ updateTemplate: async (_s: string, _i: string, b: any) => { put = b; return { ok: true, sha: 'sha-2' }; } });
    await runPut(client, { site: 's', name: 'contact', subject: 'Hello' });
    expect(put.content).toBe('<p>old</p>');
  });
  it('creates when the name is new, then applies envelope flags', async () => {
    const calls: string[] = [];
    const puts: any[] = [];
    const client = fakeApi({
      listTemplates: async () => [],
      createTemplate: async () => { calls.push('create'); return { ...T, sha: 'sha-new' }; },
      readTemplate: async () => ({ ...T, sha: 'sha-new', html: '<p>seeded</p>' }),
      updateTemplate: async (_s: string, _i: string, b: any) => { calls.push('update'); puts.push(b); return { ok: true, sha: 'sha-3' }; }
    });
    const out = await runPut(client, { site: 's', name: 'newform', subject: 'Hi' });
    expect(calls).toEqual(['create', 'update']);
    // The envelope PUT is a FULL OVERWRITE with no --file, so it must restate
    // the body the server just seeded. Sending '' here would blank a brand-new
    // template while reporting success.
    expect(puts[0].content).toBe('<p>seeded</p>');
    // No --from-name → the stored display name is the site's own name, which is
    // exactly what an inbox should not show. Say so instead of staying silent.
    expect(out).toMatch(/defaulted/i);
    expect(out).toContain('--from-name');
  });
  it('a create rejected for its name becomes a plain sentence, not a raw 400', async () => {
    const client = fakeApi({
      listTemplates: async () => [],
      createTemplate: async () => { throw new PepitaHttpError(400, 'POST /api/sites/s/templates → 400 {"message":"invalid template name"}'); }
    });
    await expect(runPut(client, { site: 's', name: 'new form' })).rejects.toThrow(/matched to a form BY NAME/);
  });
  it('a create race becomes a re-run instruction, not a raw 409', async () => {
    const client = fakeApi({
      listTemplates: async () => [],
      createTemplate: async () => { throw new PepitaHttpError(409, 'POST /api/sites/s/templates → 409 {"message":"already exists"}'); }
    });
    await expect(runPut(client, { site: 's', name: 'contact2' })).rejects.toThrow(/already exists.*Re-run/s);
  });
  it('a CAS conflict surfaces as a plain retry instruction', async () => {
    const client = fakeApi({ updateTemplate: async () => ({ ok: false, conflict: { currentSha: 'sha-9', currentSubject: 'Q' } }) });
    await expect(runPut(client, { site: 's', name: 'contact', html: 'x' })).rejects.toThrow(/changed .*retry|re-run/i);
  });
});

describe('runRead', () => {
  it('prints envelope + body and errors helpfully on an unknown form', async () => {
    const out = await runRead(fakeApi(), 's', 'contact');
    expect(out).toContain('<p>old</p>');
    await expect(runRead(fakeApi({ listTemplates: async () => [] }), 's', 'nope')).rejects.toThrow(/No template/);
  });
});
