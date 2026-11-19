#!/bin/bash
# Installs the MD Lens save helper so the extension can save a document straight
# back to the file it was opened from, without a file picker.
#
#   bash native/install.sh <extension-id>
#
# The extension id is shown in MD Lens settings (and on chrome://extensions).
set -euo pipefail

NAME="com.mdlens.saver"
ID="${1:-}"
if ! [[ "$ID" =~ ^[a-p]{32}$ ]]; then
  echo "usage: bash native/install.sh <extension-id>   (32 letters, see MD Lens settings)" >&2
  exit 1
fi

PYTHON="$(command -v python3 || true)"
if [ -z "$PYTHON" ]; then
  echo "python3 was not found. On macOS run: xcode-select --install" >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -s)" in
  Darwin)
    HOME_DIR="${MDLENS_HOME:-$HOME/Library/Application Support/MDLens}"
    BROWSERS=(
      "$HOME/Library/Application Support/Google/Chrome"
      "$HOME/Library/Application Support/Google/Chrome Beta"
      "$HOME/Library/Application Support/Google/Chrome Canary"
      "$HOME/Library/Application Support/Chromium"
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
      "$HOME/Library/Application Support/Microsoft Edge"
      "$HOME/Library/Application Support/Arc/User Data"
    ) ;;
  *)
    HOME_DIR="${MDLENS_HOME:-$HOME/.local/share/mdlens}"
    BROWSERS=("$HOME/.config/google-chrome" "$HOME/.config/chromium") ;;
esac

mkdir -p "$HOME_DIR"
HOST="$HOME_DIR/mdlens_host.py"
{ echo "#!$PYTHON"; tail -n +2 "$HERE/mdlens_host.py"; } > "$HOST"
chmod 755 "$HOST"

manifest() {
  cat <<JSON
{
  "name": "$NAME",
  "description": "MD Lens save helper",
  "path": "$HOST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
JSON
}

installed=0
if [ -n "${MDLENS_HOSTS_DIR:-}" ]; then
  mkdir -p "$MDLENS_HOSTS_DIR"
  manifest > "$MDLENS_HOSTS_DIR/$NAME.json"
  echo "installed: $MDLENS_HOSTS_DIR/$NAME.json"
  installed=1
else
  for dir in "${BROWSERS[@]}"; do
    [ -d "$dir" ] || continue
    mkdir -p "$dir/NativeMessagingHosts"
    manifest > "$dir/NativeMessagingHosts/$NAME.json"
    echo "installed: $dir/NativeMessagingHosts/$NAME.json"
    installed=1
  done
fi

if [ "$installed" = 0 ]; then
  echo "No supported browser profile folder was found." >&2
  exit 1
fi
echo "helper:    $HOST"
echo "Done. Reload the document tab and save again."
