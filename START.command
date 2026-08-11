#!/bin/bash
# Double-click in Finder → starts Gamemaster chat
cd "$(dirname "$0")" || exit 1
clear
./start
status=$?
if [[ $status -ne 0 ]]; then
  echo ""
  read -r -p "Error — press Enter to close…"
  exit $status
fi
