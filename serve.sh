#!/bin/sh
# Serve the game locally so the 3D models load (browsers block them when opening the pages directly).
# Usage: ./serve.sh [port]    (default port 8000), then stop it with Ctrl+C.

PORT="${1:-8000}"
cd "$(dirname "$0")" || exit 1

URL="http://localhost:$PORT"
echo "Serving the game at $URL  (Ctrl+C to stop)"

# Open the browser once the server has had a moment to start.
(sleep 1 && open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null) &

if command -v python3 >/dev/null 2>&1; then
  # no caching: after an update the browser always gets the current scripts, never a mix of old and new
  exec python3 - "$PORT" <<'PY'
import http.server, sys
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), NoCache).serve_forever()
PY
elif command -v npx >/dev/null 2>&1; then
  exec npx --yes http-server -p "$PORT" -a 127.0.0.1 -c-1 # -c-1: no caching
else
  echo "Need python3 or Node.js (npx) installed to run a local server." >&2
  exit 1
fi
