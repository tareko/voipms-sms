#!/usr/bin/env bash
# Desktop subscriber: listen on the shared ntfy topic and fire a GNOME
# notification ("Voip.ms text" identity) for each new message.
#
# Configure per machine via ~/.config/voipms-ntfy.env:
#   NTFY_URL=http://192.168.1.12:8090
#   NTFY_TOPIC=voipms-XXXXXXXX
#   NTFY_TOKEN=            # optional publish/subscribe token
#
# Enable popups on this machine:
#   systemctl --user enable --now ntfy-voipms-subscriber.service
# Silence on this machine:
#   systemctl --user disable --now ntfy-voipms-subscriber.service
set -euo pipefail

CFG="${XDG_CONFIG_HOME:-$HOME/.config}/voipms-ntfy.env"
[ -f "$CFG" ] && . "$CFG"

: "${NTFY_URL:?set NTFY_URL in $CFG}"
: "${NTFY_TOPIC:?set NTFY_TOPIC in $CFG}"

NTFY="${NTFY_BIN:-$HOME/.local/bin/ntfy}"
AUTH=()
[ -n "${NTFY_TOKEN:-}" ] && AUTH=(--header "Authorization: Bearer $NTFY_TOKEN")

# ntfy subscribe prints one JSON object per event to stdout.
exec "$NTFY" subscribe "${AUTH[@]}" "$NTFY_URL/$NTFY_TOPIC" | while IFS= read -r line; do
  title=$(printf '%s' "$line" | jq -r '.title // "Voip.ms text"' 2>/dev/null || echo "Voip.ms text")
  msg=$(printf '%s' "$line" | jq -r '.message // "New message"' 2>/dev/null || echo "New message")
  notify-send \
    --app-name="Voip.ms text" \
    --icon=voipms-sms \
    --hint=string:desktop-entry:voipms-sms \
    --urgency=normal \
    "$title" "$msg" 2>/dev/null || true
done
