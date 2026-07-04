#!/usr/bin/env bash
#
# Build standalone `pepita` binaries for every platform with `deno compile`.
# The result is a single self-contained executable per OS/arch — end users
# need NO Node, NO npm, NO deno: download one file, chmod +x, run.
#
# Why the perl step: tsup/esbuild emits BARE Node built-in specifiers
# (`from 'fs'`). Node accepts those, but `deno compile` rejects them — it
# requires the `node:` prefix. We add the prefix to a copy of the bundle
# before compiling. (The npm build keeps the bare form; both are valid.)
#
# Usage:  ./scripts/build-binaries.sh        # -> dist-bin/pepita-*
#
set -euo pipefail
cd "$(dirname "$0")/.."   # -> packages/cli

echo "==> tsup bundle (dist/index.js)"
pnpm build

echo "==> patch node: prefixes for deno (dist/index.bin.js)"
cp dist/index.js dist/index.bin.js
perl -i -pe "s{from'(child_process|readline/promises|readline|http|https|fs|os|path|net|crypto|url|util|stream|events|zlib|tty|buffer|assert|process|dns|tls|http2|dgram|worker_threads|perf_hooks|string_decoder|querystring|punycode|v8|vm|cluster)'}{from'node:\$1'}g" dist/index.bin.js

rm -rf dist-bin && mkdir -p dist-bin
compile() { # <deno-target> <output-name>
  echo "==> compile $2  ($1)"
  deno compile -A --no-check --node-modules-dir=auto --target "$1" --output "dist-bin/$2" dist/index.bin.js
}
compile x86_64-apple-darwin       pepita-macos-x64
compile aarch64-apple-darwin      pepita-macos-arm64
compile x86_64-unknown-linux-gnu  pepita-linux-x64
compile aarch64-unknown-linux-gnu pepita-linux-arm64
compile x86_64-pc-windows-msvc    pepita-windows-x64.exe

rm -f dist/index.bin.js
echo "==> done"
ls -lh dist-bin
