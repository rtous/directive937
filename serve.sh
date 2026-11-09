#!/bin/sh
# Serve the game locally so the 3D models load (browsers block them when opening index.html directly).
# Usage: ./serve.sh [port]    (default port 8000), then stop it with Ctrl+C.

PORT="${1:-8000}"
cd "$(dirname "$0")" || exit 1

URL="http://localhost:$PORT"
echo "Serving the game at $URL  (Ctrl+C to stop)"

# Open the browser once the server has had a moment to start.
(sleep 1 && open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null) &

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v npx >/dev/null 2>&1; then
  exec npx --yes http-server -p "$PORT" -a 127.0.0.1 -c-1
else
  echo "Need python3 or Node.js (npx) installed to run a local server." >&2
  exit 1
fi
