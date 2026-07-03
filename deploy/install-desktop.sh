#!/usr/bin/env bash
# Install the "Voip.ms text" desktop entry + icon so GNOME notifications are
# attributed to "Voip.ms text" (instead of "notify-send") with the phone icon.
# Safe to re-run; copies into XDG_DATA_HOME (default ~/.local/share).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
ICONS="$DATA/icons/hicolor/scalable/apps"
APPS="$DATA/applications"

mkdir -p "$ICONS" "$APPS"
cp -f "$ROOT/assets/icon.svg" "$ICONS/voipms-sms.svg"
cp -f "$ROOT/deploy/voipms-sms.desktop" "$APPS/voipms-sms.desktop"

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f "$DATA/icons/hicolor" 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS" 2>/dev/null || true
fi

echo "Installed 'Voip.ms text' desktop entry and icon to $DATA"
