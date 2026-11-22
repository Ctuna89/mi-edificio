# Cómo contribuir a Mi Edificio

¡Gracias por tu interés! Este proyecto es software libre (licencia MIT) y recibe aportes de cualquier persona.

## Principios del proyecto

Antes de proponer un cambio, ten presentes las decisiones de diseño (más detalle en `HANDOFF.md`):

- **Sin frameworks ni build.** El frontend es HTML + JS vanilla en `web/`. No agregues dependencias ni pasos de compilación. El servidor local (`local/`) tiene dos dependencias; agregar otra necesita una buena razón.
- **La seguridad vive en la base de datos.** Todo permiso se expresa como política RLS en `supabase/schema.sql`. El frontend solo decide qué mostrar.
- **`schema.sql` es idempotente** y debe seguir siéndolo: se tiene que poder ejecutar completo varias veces sin error ni pérdida de datos.
- **Una instalación = un edificio.** Las tablas llevan una columna `edificio_id` por razones históricas: toda tabla nueva la incluye y crea sus políticas con el helper `_pol`.
- **Dos formas de instalar, un solo código.** La app corre sobre el servidor local o sobre Supabase. Lo que agregues debe funcionar en ambos: `web/app.js` usa la interfaz de `supabase-js`, que en local implementa `local/cliente.js`; si usas un método nuevo de esa interfaz, agrégalo ahí y en `local/server.mjs`.
- **UI en español de Chile.**

## Entorno de desarrollo

Con Node.js 20 o superior:

```bash
cd local && npm install && npm start
```

Abre `http://localhost:8080`. Los datos quedan en `local/datos` (fuera del repositorio); bórrala para partir de cero. El servidor aplica `supabase/schema.sql` en cada arranque, así que basta reiniciarlo para probar un cambio del esquema.

`web/config.js` solo se usa en la instalación alternativa sobre Supabase y debe quedar en el repositorio con sus valores de ejemplo.

## Flujo de trabajo

1. Abre un *issue* describiendo el problema o la idea antes de un cambio grande.
2. Haz un *fork*, crea una rama (`feat/encuestas`, `fix/reserva-solapada`, …) y envía un *pull request*.
3. En el PR indica qué roles probaste (residente, conserje, comité, admin, mantención) y, si tocaste `schema.sql`, que lo ejecutaste dos veces seguidas sin errores.
4. La CI verifica la sintaxis de los archivos JS y ejecuta las pruebas del esquema y del servidor local; debe pasar.

## Cambios en la base de datos

Las instalaciones se actualizan solas al arrancar una versión nueva, así que todo cambio de `schema.sql` tiene que poder aplicarse sobre los datos de cualquier versión ya publicada:

- Agrega, no reemplaces: columnas nuevas con valor por defecto, `create … if not exists`, `alter table … add column if not exists`. Si hay que transformar datos, hazlo en un bloque `do $$ … $$` que detecte si ya se hizo.
- No borres ni renombres columnas con datos sin migrarlos antes en el mismo script.
- El script se ejecuta dentro de una transacción: no uses nada que no pueda ir en una (`create index concurrently`, `vacuum`).
- `supabase/tests/run.sh` actualiza desde el esquema congelado de cada versión publicada. Si tu cambio afecta datos existentes, agrega el caso a `supabase/tests/versiones/datos-<versión>.sql` y `revisar-<versión>.sql`.

**Al publicar una versión**, en el mismo commit que sube `VERSION`:

```bash
supabase/tests/congelar.sh
```

Guarda el esquema de esa versión en `supabase/tests/versiones/`, para que las versiones futuras se prueben contra ella.

## Pruebas

Si tocas `supabase/schema.sql`, ejecuta las pruebas en un Postgres local (16 o superior) y agrega casos a `supabase/tests/rls.sql` para los permisos nuevos:

```bash
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh
```

Crea y borra las bases `mi_edificio_test` y `mi_edificio_mig`; no lo apuntes a un servidor con datos reales.

Si tocas `instalador/`, constrúyelo (necesita `nsis`) y pruébalo en Windows o con Wine:

```bash
./instalador/construir.sh
```

Si tocas `local/`, ejecuta sus pruebas (usan una carpeta de datos temporal):

```bash
cd local && npm test
```

## Reglas de seguridad al programar

- Todo dato que venga de la base de datos se pasa por `esc()` antes de entrar a una plantilla HTML, también dentro de atributos. `fotoUrl()` ya devuelve la URL escapada.
- Sin `onclick=` ni scripts en línea: la política CSP de `index.html` los bloquea. Usa `addEventListener`.
- Una regla que importa (quién aprueba, qué estado es válido) se impone en `schema.sql` con política o trigger, y se prueba en `supabase/tests/rls.sql`. Validarla solo en el navegador no cuenta.
- Para actualizar `supabase-js`, cambia la versión en `index.html` y recalcula el hash de integridad:

  ```bash
  curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@VERSION/dist/umd/supabase.js | openssl dgst -sha384 -binary | openssl base64 -A
  ```

## Reportar vulnerabilidades

Ver [`SECURITY.md`](SECURITY.md).

Si encuentras un problema de seguridad (por ejemplo, una política RLS que permite leer datos de otro departamento), **no abras un issue público**. Usa *Security → Report a vulnerability* en GitHub.

## Ideas para aportar

Revisa la sección "Próximos pasos sugeridos" del `README.md`.
