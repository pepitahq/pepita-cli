import { describe, it, expect } from 'vitest';
import { UsageError } from '../src/api.js';
import { run } from '../src/commands/email.js';

describe('pepita email', () => {
  it('refuses a bare `email` with no sub-noun', async () => {
    await expect(run([])).rejects.toThrow(UsageError);
  });

  it('refuses an unknown sub-noun and names `template`', async () => {
    await expect(run(['log'])).rejects.toThrow(/template/);
  });

  it('refuses the old flat form, so `email list` cannot look like it worked', async () => {
    await expect(run(['list', '--site', 'acme'])).rejects.toThrow(UsageError);
  });
});
