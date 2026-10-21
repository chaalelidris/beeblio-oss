#!/usr/bin/env bash
set -e

# Ensure data directory exists with write permissions
DATA_DIR="${BEEBLIO_DATA_DIR:-/app/.beeblio}"
mkdir -p "$DATA_DIR"

exec "$@"
