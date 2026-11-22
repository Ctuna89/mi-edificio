#!/usr/bin/env bash
# Prueba schema.sql en un Postgres local (no en Supabase): instalación nueva, idempotencia,
# políticas RLS y migración desde la versión de un solo edificio.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
q() { psql -X -q -o /dev/null -v ON_ERROR_STOP=1 "$@"; }
nueva() { q -d postgres -c "drop database if exists $1" -c "create database $1"; q -d "$1" -f tests/stubs.sql; }

nueva mi_edificio_test
q -d mi_edificio_test -f schema.sql
q -d mi_edificio_test -f schema.sql          # idempotente
q -d mi_edificio_test -f tests/rls.sql
q -d mi_edificio_test -f schema.sql          # idempotente también con datos
echo "OK: schema.sql se puede volver a ejecutar"

if [ -f tests/schema_v1.sql ]; then
  nueva mi_edificio_mig
  q -d mi_edificio_mig -f tests/schema_v1.sql
  q -d mi_edificio_mig -f tests/migracion.sql
  q -d mi_edificio_mig -f schema.sql
  q -d mi_edificio_mig -f schema.sql
  q -d mi_edificio_mig -f tests/migracion_check.sql
fi

# Actualización desde cada versión publicada: su esquema congelado está en tests/versiones/.
# Con datos (si hay tests/versiones/datos-<v>.sql) se comprueba además que no se pierde nada.
for viejo in tests/versiones/schema-*.sql; do
  v="$(basename "$viejo" .sql)"; v="${v#schema-}"
  nueva mi_edificio_mig
  q -d mi_edificio_mig -f "$viejo"
  if [ -f "tests/versiones/datos-$v.sql" ]; then q -d mi_edificio_mig -f "tests/versiones/datos-$v.sql"; fi
  q -d mi_edificio_mig -f schema.sql
  q -d mi_edificio_mig -f schema.sql
  if [ -f "tests/versiones/revisar-$v.sql" ]; then q -d mi_edificio_mig -f "tests/versiones/revisar-$v.sql"; else echo "OK: actualización desde $v (base vacía)"; fi
done
