#!/usr/bin/env bash
# Inicia Mi Edificio en este computador (Mac o Linux). Requiere Node.js 20 o superior.
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --omit=dev
exec node server.mjs "$@"
