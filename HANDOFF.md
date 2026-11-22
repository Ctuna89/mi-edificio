# Handoff — Mi Edificio

Este archivo resume el contexto del proyecto para que otra persona (o un asistente de IA) pueda continuar sin leer la conversación original.

## Qué es

App web para la comunidad de un edificio: residentes, conserjería, comité, administración y empresas de mantención. Se instala en un computador del propio edificio; una instalación = un edificio.

## Stack y por qué

- **Frontend**: HTML + JS vanilla, sin framework ni build (dos librerías de QR copiadas en `web/vendor/`). `web/app.js` contiene todas las vistas; `web/xlsx.js` genera Excel sin dependencias; `web/sw.js` es el service worker de notificaciones. Decisión: simplicidad de despliegue (se sube una carpeta) y cero dependencias que mantener.
- **Backend local** (`local/`): un programa Node que sirve `web/`, guarda la base de datos en una carpeta con Postgres embebido (PGlite) y reemplaza lo que entregaba Supabase: cuentas y sesiones (cookie HttpOnly), consultas (`/api/db`, traducidas a SQL con `jsonb_populate_record`), funciones (`/api/rpc`), archivos en disco con enlaces firmados, avisos de cambios por SSE, tareas programadas, push y respaldos. Aplica `base.sql` y `supabase/schema.sql` en cada arranque. `local/cliente.js` implementa en el navegador la parte de la interfaz de `supabase-js` que usa `app.js`.
- **Backend alternativo**: un proyecto Supabase con el mismo `schema.sql` (Auth, Storage, Realtime y la Edge Function `push`). Nunca se ha desplegado.
- **Seguridad**: toda en RLS (`supabase/schema.sql`). El frontend solo decide qué mostrar; lo que cada rol puede leer/escribir lo decide la base de datos.
- **Roles** (`usuarios.rol`): residente, propietario, conserje, comite, admin, mantencion. Estado: pendiente / activo / bloqueado. Quien crea un edificio (`crear_edificio()`) queda como su admin; los demás quedan pendientes (trigger `usuarios_antes_insert`).

## Decisiones tomadas

- **Local primero**: el feedback fue que mantener una cuenta en la nube era el mismo problema que pagar un servicio. Se probó que `schema.sql` corre sin cambios en PGlite (pasa `tests/rls.sql` completo), así que el modo local reutiliza todas las reglas en vez de reescribirlas.
- **Un solo edificio**: se eliminó el soporte multi-edificio (códigos de invitación, apertura de creación). Un índice único impide un segundo edificio. Las tablas conservan la columna `edificio_id` y las políticas la siguen comparando con `mi_edificio()`: es un vestigio interno que se podría retirar.
- **Respaldo en la nube sin integraciones**: en vez de OAuth con Google o Microsoft (que exige registrar la aplicación), el servidor escribe una copia cifrada (`base/*.meb` + espejo `archivos/*.enc`, AES-256-GCM, llave por scrypt) en una carpeta que la app de escritorio de la nube sincroniza. `pareceNube()` solo mira el nombre de la ruta para advertir. Restauración con `--restaurar-nube`.
- **Acceso desde internet**: `server.mjs` administra un proceso `cloudflared` (`tunnel run` con `TUNNEL_TOKEN`, para un túnel con dominio creado en la cuenta Cloudflare del edificio). A propósito no se ofrecen los túneles temporales `trycloudflare.com`: la gente los usaría como definitivos y fallan. Marca "conectado" al ver `Registered tunnel connection`, reintenta con espera creciente y expone el estado en `/api/tunel/*`. Las pruebas usan un cloudflared simulado.
- **Instalador de Windows** (`instalador/`): NSIS, se construye en Linux con `construir.sh` e incluye Node.js y cloudflared para Windows (sumas verificadas) y las dependencias. Instala por usuario sin permisos de administrador; programa en `%LOCALAPPDATA%\Programs\Mi Edificio`, datos en `%LOCALAPPDATA%\MiEdificio\datos`. Los accesos directos ejecutan `.vbs` que llaman a `local/lanzar.mjs` sin ventana. El servidor se detiene con un archivo bandera (`detener`) porque en Windows no hay SIGTERM, y avisa su cierre real borrando `servidor.pid`. El workflow `Release` lo adjunta a cada versión.
- **Sin correo**: en local no hay verificación ni recuperación por correo; la administración restablece contraseñas (`/api/auth/restablecer`).
- **Encuestas**: un voto por unidad (`votos` con PK `encuesta_id, depto`). El voto individual solo lo ve su unidad; los totales salen de `resultados_encuestas()` (SECURITY DEFINER). Los plazos se evalúan en hora de Chile (`hoy()`).
- **Exportación** de gastos: `.xlsx` generado en el navegador y PDF mediante impresión (`@media print` + `#printArea`). Sin librerías.
- **Push**: triggers en el esquema `privado` (no expuesto por la API) calculan destinatarios y llaman con `pg_net` a la Edge Function, autenticada con `plataforma.push_secret`. Si `push_url` está vacío no hacen nada; un fallo de envío nunca bloquea la operación.
- **Reglas fuera del navegador**: triggers `reservas_antes`, `incidencias_antes`, `ot_antes_update` y `mensajes_antes_insert` fijan estados iniciales, impiden auto-aprobaciones y la suplantación de rol. El bucket `fotos` es privado: `puede_ver_archivo()` (usada por la política de lectura de `storage.objects`) decide quién lee cada archivo según su carpeta y la fila que lo referencia, y el frontend resuelve `data-f="ruta"` a URLs firmadas de 1 hora (`firmarPendientes()` con un MutationObserver).
- **Datos personales**: aviso de privacidad por edificio (`edificios.privacidad`, aceptación en `usuarios.privacidad_at`), descarga de datos propios y `eliminar_mi_cuenta()` (anonimiza el perfil). Plazos de conservación por edificio (`edificios.retencion`, en meses, los fija el admin): `privado.depurar()` corre a diario con `pg_cron` y `depurar_ahora()` desde la app; las fotos de filas borradas pasan por la cola `archivos_por_borrar`, que vacía el navegador del admin.
- **Visitas con QR**: `visitas.codigo` (8 caracteres, lo genera la base de datos) va en un QR que el residente comparte como imagen; conserjería lo lee con `BarcodeDetector` o, donde no existe, con `web/vendor/jsQR.js` (carga diferida). Generación con `web/vendor/qrcode.js`. Son las únicas librerías de terceros incluidas en el repositorio. `visitas.estacionamiento` marca si la visita necesita estacionamiento; con `edificios.visita_patente = true` la patente pasa a ser obligatoria en ese caso (lo exige el trigger `visitas_antes_insert`, que además normaliza la patente). No hay integración con sistemas LPR.
- **Estacionamientos de visita**: `estacionamientos` (los define el admin, con `reservado`) y `estacionamiento_usos` (un uso abierto por estacionamiento; horas puestas por el trigger `est_usos_antes`). `edificios.est_alerta_min` / `est_aviso_min` fijan los plazos; `privado.revisar_estacionamientos()` (pg_cron cada 5 min, o la app de conserjería vía `revisar_estacionamientos()`) envía cada aviso una sola vez y marca `alerta_residente_at` / `aviso_admin_at`. No hay cálculo ni cobro de multas.
- **Asistente de configuración**: `asistente()` en `app.js`, modal de 7 pasos que guarda en cada avance y marca `edificios.configurado_at` al terminar. Se abre solo una vez por sesión en Inicio mientras ese campo sea nulo; los edificios anteriores a esta función se marcan como configurados al migrar.
- **Finanzas**: `pagos` (los registra el admin; cada uno va a un período o a un convenio; se anulan, no se editan), `convenios` + `convenio_cuotas` (propuesto → vigente → cumplido, o anulado; se crean y cambian solo con `crear_convenio`, `aceptar_convenio`, `anular_convenio`) y `caja_movimientos` (egresos y otros ingresos). `privado.recalc_unidad()` recalcula `gasto_unidades.pagado_monto`/`pagado` y las cuotas tras cada pago, repartiendo lo abonado a un convenio en cascada. El frontend arma deuda, vencido y morosidad en `finDatos()`. Sin intereses ni multas.
- **Sin pago en línea** de gastos comunes. Se muestran datos bancarios y el admin registra cada pago. Si se agrega, debe ir en una Edge Function, no en el navegador.
- **Rondas NFC** integradas en la misma app. Web NFC solo funciona en Chrome Android; hay fallback por código o lista.
- **Perfil empresa de mantención**: externo, solo ve sus OT y los activos; flujo asignada → aceptada → agendada → en terreno → cierre técnico → aprobada por admin.

## Modelo de datos (resumen)

`edificios` (nombre, logo, dirección, color, datos bancarios, `espacios` jsonb, plazos y ajustes) · `plataforma` (ajustes de la instalación) · `usuarios` · `unidades` (depto, alícuota %) · `gastos` + `gasto_unidades` (prorrateo por período) · `pagos` · `convenios` + `convenio_cuotas` · `caja_movimientos` · `reservas` · `incidencias` (fotos[], historial jsonb) · `conversaciones` + `mensajes` (un hilo por depto y canal) · `comunicados` · `encuestas` + `votos` · `documentos` · `encomiendas` · `visitas` · `estacionamientos` + `estacionamiento_usos` · `activos` (nfc_tag, requisitos jsonb, plan preventivo) · `registros` (rondas) · `ot` · `empresas` · `push_subs`.

Funciones RPC: `crear_edificio`, `buscar_edificio`, `puede_crear_edificio`, `recalcular_prorrateo(periodo)`, `resultados_encuestas`, `guardar_push`.

## Estado

- `schema.sql` probado con `supabase/tests/run.sh` en Postgres 16 y, manualmente, sobre PGlite: instalación nueva, re-ejecución, permisos por rol y unidad, pagos y convenios, encuestas, avisos, archivos y migración.
- Servidor local probado con `local/test.mjs` (por HTTP) y con una prueba en Chromium de punta a punta contra el servidor real: cuentas, asistente, gastos, pago, incidencia con foto, visita con QR, avisos en vivo, restablecer contraseña, reinicio. También respaldo al cerrar y restauración.
- La prueba en navegador y las de interfaz con cliente simulado no están en el repositorio.
- Instalador y servidor probados con Wine (Node para Windows): instalación silenciosa, accesos directos, arranque por `iniciar.vbs`, archivos, respaldo en una carpeta OneDrive, detener, actualizar encima y desinstalar. Las páginas del asistente se revisaron por captura.
- **Sin probar**: un Windows real (SmartScreen, Firewall, antivirus, inicio con la sesión), un túnel de Cloudflare conectado de verdad (el entorno de desarrollo bloqueaba esa red), envío de notificaciones push a teléfonos, y cualquier uso en un edificio real. La instalación en Supabase nunca se ha desplegado.

## Pendientes sugeridos (en orden)

1. Usarla en un edificio real con túnel y teléfonos.
2. Probar el instalador en Windows real; firmarlo; arranque como servicio.
3. Respaldo automático fuera del computador.
4. Retirar la columna `edificio_id`.
5. Pagos en línea e intereses por mora.

## Prompt para pegar en Claude (o similar)

> Adjunto el proyecto "Mi Edificio" (carpeta `web/` con un frontend estático en JS vanilla y `supabase/schema.sql` con el backend). Lee primero `HANDOFF.md` y `README.md`. Es una app para residentes, conserjería, comité, administración y empresas de mantención de un edificio, que se instala en un computador del edificio (`local/`) y cuyas reglas viven en políticas RLS de Postgres. Mantén el estilo actual: sin frameworks, sin build, toda la seguridad en políticas RLS, UI en español de Chile. Antes de cambiar el schema, recuerda que `schema.sql` es idempotente y debe seguir siéndolo, y que `supabase/tests/run.sh` y `npm test` en `local/` deben seguir pasando. Mi primera tarea es: [describe aquí].
