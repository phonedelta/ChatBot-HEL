#!/bin/sh
set -eu

# Railway volumes are mounted as root and replace /app/storage at runtime.
# Ensure the process can always write session + CRM + dashboard auth files.
mkdir -p /app/storage/sessions /app/storage/voice-nlu-logs /app/storage/logs /tmp/iadis-wa-media
chmod -R u+rwX /app/storage 2>/dev/null || true

exec "$@"
