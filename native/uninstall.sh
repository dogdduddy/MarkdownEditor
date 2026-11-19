#!/bin/bash
# Removes the MD Lens save helper.
set -euo pipefail
NAME="com.mdlens.saver"
case "$(uname -s)" in
  Darwin)
    HOME_DIR="$HOME/Library/Application Support/MDLens"
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
    HOME_DIR="$HOME/.local/share/mdlens"
    BROWSERS=("$HOME/.config/google-chrome" "$HOME/.config/chromium") ;;
esac
for dir in "${BROWSERS[@]}"; do
  rm -fv "$dir/NativeMessagingHosts/$NAME.json"
done
rm -fv "$HOME_DIR/mdlens_host.py"
rmdir "$HOME_DIR" 2>/dev/null || true
echo "Removed."
