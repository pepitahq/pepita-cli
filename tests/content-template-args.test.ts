import { describe, it, expect } from 'vitest';
import { UsageError } from '../src/api.js';
import {
  parseContentTemplateArgs,
  runList,
  runRead,
  runPut,
  runRm,
  runSave
} from '../src/commands/content-template.js';

/** Any method not overridden throws — so "it called an endpoint it should not
 *  have" is a hard failure rather than an undefined read. */
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

const meta = (name: string, id = 'i1') => ({ id, name, sha: 's', sizeBytes: 10, cssKey: null });

describe('parseContentTemplateArgs', () => {
  it('requires --site', () => {
    expect(() => parseContentTemplateArgs(['blog'])).toThrow(UsageError);
  });

  it('requires a collection name unless told otherwise', () => {
    expect(() => parseContentTemplateArgs(['--site', 'acme'])).toThrow(UsageError);
    expect(parseContentTemplateArgs(['--site', 'acme'], { needName: false }).name).toBeUndefined();
  });

  it('takes the collection name from any position', () => {
    expect(parseContentTemplateArgs(['--site', 'acme', 'blog']).name).toBe('blog');
    expect(parseContentTemplateArgs(['blog', '--site', 'acme']).name).toBe('blog');
  });

  it('never mistakes a flag value for the collection name', () => {
    expect(parseContentTemplateArgs(['--site', 'acme', '--file', 'x.html', 'blog']).name).toBe('blog');
    expect(parseContentTemplateArgs(['--site', 'acme', '--out', 'y.html', 'blog']).name).toBe('blog');
  });
});

describe('runRead', () => {
  it('reads the SOURCE through readContentTemplateSource, never a render body', async () => {
    const calls: string[] = [];
    const api = fakeApi({
      listContentTemplates: async () => {
        calls.push('list');
        return [meta('blog')];
      },
      readContentTemplateSource: async (_s: string, id: string) => {
        calls.push(`source:${id}`);
        return '<!doctype html><head><style>a{}</style></head><body><article/></body>';
      }
    });
    const out = await runRead(api, 'acme', 'blog');
    expect(out).toContain('<style>');
    expect(calls).toEqual(['list', 'source:i1']);
  });

  it('names the collections that do exist when one is missing', async () => {
    const api = fakeApi({ listContentTemplates: async () => [meta('menu'), meta('team', 'i2')] });
    await expect(runRead(api, 'acme', 'blog')).rejects.toThrow(/menu, team/);
  });

  it('says the site has none rather than listing an empty set', async () => {
    const api = fakeApi({ listContentTemplates: async () => [] });
    await expect(runRead(api, 'acme', 'blog')).rejects.toThrow(/no content templates yet/i);
  });
});

describe('runPut', () => {
  it('creates AND saves a new collection in one call', async () => {
    const calls: string[] = [];
    const api = fakeApi({
      listContentTemplates: async () => [],
      createContentTemplate: async (_s: string, name: string, html?: string) => {
        calls.push(`create:${name}:${html ?? 'none'}`);
        return { id: 'i9', sha: 's9' };
      }
    });
    const out = await runPut(api, { site: 'acme', name: 'blog', html: '<article/>' });
    expect(calls).toEqual(['create:blog:<article/>']);
    expect(out).toMatch(/created and saved/i);
    // It must NOT tell the user to save something that is already saved.
    expect(out).not.toMatch(/content template save/);
  });

  it('does not promote after a create even under --save — nothing is pending', async () => {
    const calls: string[] = [];
    const api = fakeApi({
      listContentTemplates: async () => [],
      createContentTemplate: async () => {
        calls.push('create');
        return { id: 'i9', sha: 's9' };
      }
      // saveContentTemplate is deliberately NOT provided: calling it would throw.
    });
    const out = await runPut(api, { site: 'acme', name: 'blog', html: '<article/>', save: true });
    expect(calls).toEqual(['create']);
    expect(out).toMatch(/created and saved/i);
  });

  it('promotes after an update when --save is set, in one message', async () => {
    const calls: string[] = [];
    const api = fakeApi({
      listContentTemplates: async () => [meta('blog')],
      writeContentTemplate: async () => {
        calls.push('write');
      },
      saveContentTemplate: async () => {
        calls.push('save');
        return { saved: true, sha: 's2' };
      }
    });
    const out = await runPut(api, { site: 'acme', name: 'blog', html: '<article/>', save: true });
    expect(calls).toEqual(['write', 'save']);
    expect(out).toMatch(/render it now/i);
    // One message, not the update's "run save" line followed by the save's own.
    expect(out).not.toMatch(/pepita content template save/);
  });

  it('reports a --save that found nothing pending as an outcome', async () => {
    const api = fakeApi({
      listContentTemplates: async () => [meta('blog')],
      writeContentTemplate: async () => undefined,
      saveContentTemplate: async () => ({ saved: false })
    });
    const out = await runPut(api, { site: 'acme', name: 'blog', html: '<article/>', save: true });
    expect(out).toMatch(/nothing to save/i);
  });

  it('writes only the working copy for an existing collection, and says so', async () => {
    const calls: string[] = [];
    const api = fakeApi({
      listContentTemplates: async () => [meta('blog')],
      writeContentTemplate: async (_s: string, id: string) => {
        calls.push(`write:${id}`);
      }
    });
    const out = await runPut(api, { site: 'acme', name: 'blog', html: '<article/>' });
    expect(calls).toEqual(['write:i1']);
    expect(out).toMatch(/working copy/);
    expect(out).toMatch(/pepita content template save/);
  });
});

describe('runSave', () => {
  it('reports nothing-pending as a normal outcome', async () => {
    const api = fakeApi({
      listContentTemplates: async () => [meta('blog')],
      saveContentTemplate: async () => ({ saved: false })
    });
    expect(await runSave(api, 'acme', 'blog')).toMatch(/no unsaved/i);
  });

  it('confirms a real save', async () => {
    const api = fakeApi({
      listContentTemplates: async () => [meta('blog')],
      saveContentTemplate: async () => ({ saved: true, sha: 's2' })
    });
    expect(await runSave(api, 'acme', 'blog')).toMatch(/render it now/i);
  });
});

describe('runRm', () => {
  it('says the items survive and the page section stops rendering', async () => {
    const api = fakeApi({
      listContentTemplates: async () => [meta('blog')],
      deleteContentTemplate: async () => undefined
    });
    const out = await runRm(api, 'acme', 'blog');
    expect(out).toMatch(/items are KEPT/);
    expect(out).toContain('<pepita-content name="blog">');
  });
});

describe('runList', () => {
  it('says so plainly when there are none', async () => {
    const api = fakeApi({ listContentTemplates: async () => [] });
    expect(await runList(api, 'acme')).toMatch(/no content templates yet/i);
  });

  it('shows the stylesheet name only when there is one', async () => {
    const api = fakeApi({
      listContentTemplates: async () => [
        { id: 'i1', name: 'blog', sha: 's', sizeBytes: 10, cssKey: 'style-abcd1234.css' },
        meta('menu', 'i2')
      ]
    });
    const out = await runList(api, 'acme');
    expect(out).toContain('css: style-abcd1234.css');
    expect(out.split('\n')[1]).not.toContain('css:');
  });
});
