#!/bin/bash
# Double-click in Finder. Keep this window open while you chat.
cd "$(dirname "$0")" || exit 1
clear
echo "Gamemaster — this window must stay open. Ctrl+C to stop."
echo ""
./start
status=$?
echo ""
if [[ $status -ne 0 ]]; then
  echo "Failed (exit $status)."
fi
read -r -p "Press Enter to close…"
exit "$status"
