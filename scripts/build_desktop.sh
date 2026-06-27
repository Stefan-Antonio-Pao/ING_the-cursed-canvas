#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
./scripts/build_backend.sh
npm install
npm run desktop:dist
