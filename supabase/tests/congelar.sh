#!/usr/bin/env bash
# Al publicar una versión: guarda su esquema para que las pruebas comprueben, de ahí en adelante,
# que toda versión futura puede actualizar una instalación que quedó en esta.
set -euo pipefail
cd "$(dirname "$0")/../.."
v="$(tr -d '[:space:]' < VERSION)"; f="supabase/tests/versiones/schema-$v.sql"
{ echo "-- COPIA CONGELADA del esquema publicado en la versión $v. Solo la usan las pruebas de"; echo "-- actualización (tests/run.sh). No ejecutar en una instalación real."; cat supabase/schema.sql; } > "$f"
echo "Esquema de la versión $v congelado en $f"
