# Cómo contribuir a Mi Edificio

¡Gracias por tu interés! Este proyecto es software libre (licencia MIT) y recibe aportes de cualquier persona.

## Principios del proyecto

Antes de proponer un cambio, ten presentes las decisiones de diseño (más detalle en `HANDOFF.md`):

- **Sin frameworks ni build.** El frontend es HTML + JS vanilla en `web/`. No agregues dependencias ni pasos de compilación.
- **La seguridad vive en la base de datos.** Todo permiso se expresa como política RLS en `supabase/schema.sql`. El frontend solo decide qué mostrar.
- **`schema.sql` es idempotente** y debe seguir siéndolo: se tiene que poder ejecutar completo varias veces sin error ni pérdida de datos.
- **Cada fila pertenece a un edificio.** Toda tabla nueva lleva `edificio_id` y sus políticas se crean con el helper `_pol`, que las limita al edificio del usuario.
- **UI en español de Chile.**

## Entorno de desarrollo

1. Crea un proyecto gratuito en [Supabase](https://supabase.com) y ejecuta `supabase/schema.sql` en el SQL Editor (ver `README.md`).
2. Pon la URL y la anon key de **tu** proyecto en `web/config.js`.
3. Sirve la carpeta `web/` con cualquier servidor estático:

   ```bash
   npx serve web
   ```

> **No subas tus claves.** La anon key es pública por diseño, pero `web/config.js` debe quedar en el repositorio con los valores de ejemplo. Para evitar subirla por accidente:
>
> ```bash
> git update-index --skip-worktree web/config.js
> ```
>
> Nunca incluyas la clave `service_role` en ningún archivo.

## Flujo de trabajo

1. Abre un *issue* describiendo el problema o la idea antes de un cambio grande.
2. Haz un *fork*, crea una rama (`feat/encuestas`, `fix/reserva-solapada`, …) y envía un *pull request*.
3. En el PR indica qué roles probaste (residente, conserje, comité, admin, mantención) y, si tocaste `schema.sql`, que lo ejecutaste dos veces seguidas sin errores.
4. La CI verifica la sintaxis de los archivos JS y ejecuta las pruebas del esquema; debe pasar.

## Pruebas del esquema

Si tocas `supabase/schema.sql`, ejecuta las pruebas en un Postgres local (16 o superior) y agrega casos a `supabase/tests/rls.sql` para los permisos nuevos:

```bash
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh
```

Crea y borra las bases `mi_edificio_test` y `mi_edificio_mig`; no lo apuntes a un servidor con datos reales.

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
