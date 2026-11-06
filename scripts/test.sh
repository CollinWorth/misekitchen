#!/bin/bash
# One command to check everything: backend tests (fake in-memory MongoDB) and frontend tests.
# Usage: bash scripts/test.sh [backend|frontend]   (no argument runs both)
# Needs: python deps from backend/requirements-dev.txt on PATH (the issue worker provides them).
cd "$(dirname "$0")/.." || exit 1
PY="${PYTHON:-python3}"
fail=0
if [ "$1" != "frontend" ]; then
  echo "== backend =="
  (cd backend && "$PY" -m pytest -q -p no:cacheprovider -W ignore) || fail=1
fi
if [ "$1" != "backend" ]; then
  echo "== frontend =="
  CI=true npx react-scripts test --watchAll=false || fail=1
fi
[ $fail -eq 0 ] && echo "ALL TESTS PASSED" || echo "TESTS FAILED"
exit $fail
