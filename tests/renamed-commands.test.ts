import { describe, it, expect } from 'vitest';
import { RENAMED, renameNotice } from '../src/renamed.js';

describe('RENAMED', () => {
  it('maps every retired site verb to the site group', () => {
    for (const verb of ['list', 'create', 'pull', 'apply', 'preview', 'previews', 'publish', 'delete']) {
      expect(RENAMED[verb]).toEqual({ phrase: `site ${verb}`, cmd: 'site', prepend: [verb] });
    }
  });

  it('leaves `status` alone — the account half belongs top-level', () => {
    expect(RENAMED.status).toBeUndefined();
  });

  it('forwards `asset` to `video` with the same arguments', () => {
    expect(RENAMED.asset).toEqual({ phrase: 'video', cmd: 'video', prepend: [] });
  });

  it('forwards `template` to `email template`, prepending the sub-noun', () => {
    expect(RENAMED.template).toEqual({ phrase: 'email template', cmd: 'email', prepend: ['template'] });
  });

  it('names the new spelling in the notice, and nothing else', () => {
    expect(renameNotice('list', 'site list')).toBe(
      'pepita: `list` is now `site list` — use `pepita site list`.'
    );
    expect(renameNotice('asset', 'video')).toBe('pepita: `asset` is now `video` — use `pepita video`.');
    expect(renameNotice('template', 'email template')).toBe(
      'pepita: `template` is now `email template` — use `pepita email template`.'
    );
  });
});
