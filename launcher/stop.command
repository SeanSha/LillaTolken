#!/bin/zsh
# Stops the translator (backend 8787, web 5173) and the whisper.cpp server started by local:start.
# Ollama is left running (it is a shared app); quit it from the menu bar if you want it closed.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
for port in 5173 8787; do
  pids=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null)
  [ -n "$pids" ] && kill $pids 2>/dev/null && echo "stopped :$port"
done
if [ -f "$REPO/apps/server/data/whisper-server.pid" ]; then
  kill "$(cat "$REPO/apps/server/data/whisper-server.pid")" 2>/dev/null && echo "stopped whisper-server"
else
  pids=$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t 2>/dev/null)
  [ -n "$pids" ] && ps -p $pids -o comm= 2>/dev/null | grep -q whisper && kill $pids && echo "stopped whisper-server"
fi
echo "done."; sleep 2
