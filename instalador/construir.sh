#!/usr/bin/env bash
# Construye el instalador de Windows:  dist/MiEdificio-Instalar-<versión>.exe
# Requiere: nsis (makensis), node y npm, curl.   En Ubuntu: sudo apt-get install -y nsis
# El instalador incluye Node.js para Windows y las dependencias, así que quien instala no
# necesita internet ni nada más.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(tr -d '[:space:]' < VERSION)"
# Node.js para Windows que se incluye. Al cambiar la versión, actualiza también la suma
# (está en https://nodejs.org/dist/<versión>/SHASUMS256.txt, línea win-x64/node.exe).
NODE_VERSION="v22.12.0"
NODE_SHA256="b3b117a08ee61efee09e6fd523ab33c0c018da1b570bde08e4fd914dc1170ed6"

OBRA="instalador/obra"; ETAPA="$OBRA/etapa"; CACHE="instalador/cache"
rm -rf "$OBRA"; mkdir -p "$ETAPA/local" "$ETAPA/supabase" "$CACHE" dist

# 1. Node.js para Windows, verificado
NODE_EXE="$CACHE/node-$NODE_VERSION.exe"
if [ ! -f "$NODE_EXE" ]; then
  echo "Descargando Node.js $NODE_VERSION para Windows…"
  curl -fsSL -o "$NODE_EXE.tmp" "https://nodejs.org/dist/$NODE_VERSION/win-x64/node.exe" && mv "$NODE_EXE.tmp" "$NODE_EXE"
fi
echo "$NODE_SHA256  $NODE_EXE" | sha256sum -c - >/dev/null || { echo "La suma de node.exe no coincide: no se usa." >&2; exit 1; }
cp "$NODE_EXE" "$ETAPA/node.exe"

# 2. La app y el servidor, con sus dependencias (son JavaScript y WebAssembly: sirven en cualquier sistema)
cp -r web "$ETAPA/web"
cp supabase/schema.sql "$ETAPA/supabase/"
cp local/server.mjs local/lanzar.mjs local/cliente.js local/base.sql local/package.json local/package-lock.json "$ETAPA/local/"
(cd "$ETAPA/local" && npm ci --omit=dev --silent)
cp LICENSE "$ETAPA/LICENSE.txt"
cp instalador/windows/*.vbs instalador/windows/LEEME.txt "$ETAPA/"
echo "$VERSION" > "$ETAPA/instalado.txt"
# los archivos de texto que abre Windows van con saltos de línea de Windows
sed -i 's/\r$//; s/$/\r/' "$ETAPA"/*.vbs "$ETAPA/LEEME.txt" "$ETAPA/LICENSE.txt"
node instalador/icono.mjs "$ETAPA/icono.ico"

# 3. El instalador
makensis -V2 -DVERSION="$VERSION" -DETAPA="$(pwd)/$ETAPA" -DSALIDA="$(pwd)/dist/MiEdificio-Instalar-$VERSION.exe" instalador/mi-edificio.nsi
rm -rf "$OBRA"
ls -la "dist/MiEdificio-Instalar-$VERSION.exe"
sha256sum "dist/MiEdificio-Instalar-$VERSION.exe"
