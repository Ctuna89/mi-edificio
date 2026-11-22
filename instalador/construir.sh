#!/usr/bin/env bash
# Construye el instalador de Windows:  dist/MiEdificio-Instalar-<versión>.exe
# Requiere: nsis (makensis), node y npm, curl.   En Ubuntu: sudo apt-get install -y nsis
# El instalador incluye Node.js para Windows, cloudflared (túnel para el acceso desde internet) y
# las dependencias, así que quien instala no necesita descargar nada más.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(tr -d '[:space:]' < VERSION)}"   # se puede indicar otra versión como argumento (para pruebas)
# Node.js para Windows que se incluye. Al cambiar la versión, actualiza también la suma
# (está en https://nodejs.org/dist/<versión>/SHASUMS256.txt, línea win-x64/node.exe).
NODE_VERSION="v22.12.0"
NODE_SHA256="b3b117a08ee61efee09e6fd523ab33c0c018da1b570bde08e4fd914dc1170ed6"

# cloudflared para Windows (acceso desde internet). Suma: sha256 del .exe publicado en
# https://github.com/cloudflare/cloudflared/releases/tag/<versión>
CF_VERSION="2026.11.1"
CF_SHA256="341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35"

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

# 1b. cloudflared para Windows, verificado
CF_EXE="$CACHE/cloudflared-$CF_VERSION.exe"
if [ ! -f "$CF_EXE" ]; then
  echo "Descargando cloudflared $CF_VERSION para Windows…"
  curl -fsSL -o "$CF_EXE.tmp" "https://github.com/cloudflare/cloudflared/releases/download/$CF_VERSION/cloudflared-windows-amd64.exe" && mv "$CF_EXE.tmp" "$CF_EXE"
fi
echo "$CF_SHA256  $CF_EXE" | sha256sum -c - >/dev/null || { echo "La suma de cloudflared.exe no coincide: no se usa." >&2; exit 1; }
cp "$CF_EXE" "$ETAPA/cloudflared.exe"

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
# suma de verificación: la usa la actualización con un clic para comprobar la descarga
(cd dist && sha256sum "MiEdificio-Instalar-$VERSION.exe" > "MiEdificio-Instalar-$VERSION.exe.sha256" && cat "MiEdificio-Instalar-$VERSION.exe.sha256")
