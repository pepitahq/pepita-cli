import { defineConfig } from 'tsup';

// Bundle the CLI into a single self-contained dist/index.js. Only the INTERNAL
// workspace packages (@pepitahq/*) are inlined (tree-shaken + minified), so just
// the helper code the CLI actually uses ships; unused internal modules are
// dropped, and those packages never publish on their own.
// Third-party deps (fflate) stay external (declared in dependencies).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  minify: true,
  treeshake: true,
  splitting: false,
  clean: true,
  dts: false,
  noExternal: [/^@pepitahq\//],
  banner: { js: '#!/usr/bin/env node' }
});
