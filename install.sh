#!/bin/sh
#
# Install the pepita CLI standalone binary (no Node required).
#
#   curl -fsSL https://github.com/pepitahq/pepita-cli/releases/latest/download/install.sh | sh
#
# Downloads the right binary for your OS/arch from the latest GitHub release
# into ~/.local/bin (override with PEPITA_INSTALL_DIR). To avoid installing at
# all, download a single binary directly instead — see the README.
#
set -e
REPO="pepitahq/pepita-cli"
BASE="https://github.com/$REPO/releases/latest/download"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) o="macos" ;;
  Linux)  o="linux" ;;
  *) echo "Unsupported OS '$os'. On Windows, download pepita-windows-x64.exe from $BASE" >&2; exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) a="arm64" ;;
  x86_64|amd64)  a="x64" ;;
  *) echo "Unsupported architecture '$arch'." >&2; exit 1 ;;
esac

asset="pepita-$o-$a"
dest="${PEPITA_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dest"

echo "Downloading $asset -> $dest/pepita"
curl -fsSL "$BASE/$asset" -o "$dest/pepita"
chmod +x "$dest/pepita"

echo ""
echo "Installed pepita to $dest/pepita"
case ":$PATH:" in
  *":$dest:"*) echo "Run:  pepita login" ;;
  *)
    echo "Add it to your PATH, e.g.:"
    echo "  export PATH=\"$dest:\$PATH\""
    echo "Then run:  pepita login"
    ;;
esac
