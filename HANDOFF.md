# Handoff — Mi Edificio

Este archivo resume el contexto del proyecto para que otra persona (o un asistente de IA) pueda continuar sin leer la conversación original.

## Qué es

App web para la comunidad de un edificio: residentes, conserjería, comité, administración y empresas de mantención. Una instalación puede alojar varios edificios; cada usuario pertenece a uno solo.

## Stack y por qué

- **Frontend**: HTML + JS vanilla, sin framework ni build (dos librerías de QR copiadas en `web/vendor/`). `web/app.js` contiene todas las vistas; `web/xlsx.js` genera Excel sin dependencias; `web/sw.js` es el service worker de notificaciones. Decisión: simplicidad de despliegue (se sube una carpeta) y cero dependencias que mantener.
- **Backend**: Supabase. Auth por email/contraseña, Postgres con Row Level Security, Storage (bucket `fotos`), Realtime, y una Edge Function opcional (`supabase/functions/push`).
- **Seguridad**: toda en RLS (`supabase/schema.sql`). El frontend solo decide qué mostrar; lo que cada rol puede leer/escribir lo decide la base de datos.
- **Roles** (`usuarios.rol`): residente, propietario, conserje, comite, admin, mantencion. Estado: pendiente / activo / bloqueado. Quien crea un edificio (`crear_edificio()`) queda como su admin; los demás quedan pendientes (trigger `usuarios_antes_insert`).

## Decisiones tomadas

- **Multi-edificio por columna**: todas las tablas llevan `edificio_id` (por defecto `mi_edificio()`), y el helper `_pol` de `schema.sql` antepone `edificio_id = mi_edificio()` a cada política. `mi_edificio()` solo responde para usuarios activos. Claves compuestas donde el identificador se repite entre edificios: `unidades (edificio_id, depto)`, `gastos (edificio_id, periodo)`, `gasto_unidades`, `conversaciones (edificio_id, id)`.
- **Alta de edificios**: el primero es libre; los siguientes requieren `plataforma.creacion_abierta = true` (tabla de ajustes sin políticas RLS, editable solo desde el SQL Editor). Unirse: código/enlace de invitación (`edificios.codigo`, `buscar_edificio()`).
- **Encuestas**: un voto por unidad (`votos` con PK `encuesta_id, depto`). El voto individual solo lo ve su unidad; los totales salen de `resultados_encuestas()` (SECURITY DEFINER). Los plazos se evalúan en hora de Chile (`hoy()`).
- **Exportación** de gastos: `.xlsx` generado en el navegador y PDF mediante impresión (`@media print` + `#printArea`). Sin librerías.
- **Push**: triggers en el esquema `privado` (no expuesto por la API) calculan destinatarios y llaman con `pg_net` a la Edge Function, autenticada con `plataforma.push_secret`. Si `push_url` está vacío no hacen nada; un fallo de envío nunca bloquea la operación.
- **Reglas fuera del navegador**: triggers `reservas_antes`, `incidencias_antes`, `ot_antes_update` y `mensajes_antes_insert` fijan estados iniciales, impiden auto-aprobaciones y la suplantación de rol. El bucket no se puede listar y los archivos llevan nombres aleatorios, pero siguen siendo públicos por URL.
- **Datos personales**: aviso de privacidad por edificio (`edificios.privacidad`, aceptación en `usuarios.privacidad_at`), descarga de datos propios y `eliminar_mi_cuenta()` (anonimiza el perfil). Plazos de conservación por edificio (`edificios.retencion`, en meses, los fija el admin): `privado.depurar()` corre a diario con `pg_cron` y `depurar_ahora()` desde la app; las fotos de filas borradas pasan por la cola `archivos_por_borrar`, que vacía el navegador del admin.
- **Visitas con QR**: `visitas.codigo` (8 caracteres, lo genera la base de datos) va en un QR que el residente comparte como imagen; conserjería lo lee con `BarcodeDetector` o, donde no existe, con `web/vendor/jsQR.js` (carga diferida). Generación con `web/vendor/qrcode.js`. Son las únicas librerías de terceros incluidas en el repositorio. `visitas.estacionamiento` marca si la visita necesita estacionamiento; con `edificios.visita_patente = true` la patente pasa a ser obligatoria en ese caso (lo exige el trigger `visitas_antes_insert`, que además normaliza la patente). No hay integración con sistemas LPR.
- **Estacionamientos de visita**: `estacionamientos` (los define el admin, con `reservado`) y `estacionamiento_usos` (un uso abierto por estacionamiento; horas puestas por el trigger `est_usos_antes`). `edificios.est_alerta_min` / `est_aviso_min` fijan los plazos; `privado.revisar_estacionamientos()` (pg_cron cada 5 min, o la app de conserjería vía `revisar_estacionamientos()`) envía cada aviso una sola vez y marca `alerta_residente_at` / `aviso_admin_at`. No hay cálculo ni cobro de multas.
- **Asistente de configuración**: `asistente()` en `app.js`, modal de 7 pasos que guarda en cada avance y marca `edificios.configurado_at` al terminar. Se abre solo una vez por sesión en Inicio mientras ese campo sea nulo; los edificios anteriores a esta función se marcan como configurados al migrar.
- **Sin pago en línea** de gastos comunes. Se muestran datos bancarios y el admin marca pagado a mano. Si se agrega, debe ir en una Edge Function, no en el navegador.
- **Rondas NFC** integradas en la misma app. Web NFC solo funciona en Chrome Android; hay fallback por código o lista.
- **Perfil empresa de mantención**: externo, solo ve sus OT y los activos; flujo asignada → aceptada → agendada → en terreno → cierre técnico → aprobada por admin.

## Modelo de datos (resumen)

`edificios` (nombre, logo, dirección, color, datos bancarios, `espacios` jsonb, `codigo` de invitación) · `plataforma` (ajustes de la instalación) · `usuarios` · `unidades` (depto, alícuota %) · `gastos` + `gasto_unidades` (prorrateo por período) · `reservas` · `incidencias` (fotos[], historial jsonb) · `conversaciones` + `mensajes` (un hilo por depto y canal) · `comunicados` · `encuestas` + `votos` · `documentos` · `encomiendas` · `visitas` · `estacionamientos` + `estacionamiento_usos` · `activos` (nfc_tag, requisitos jsonb, plan preventivo) · `registros` (rondas) · `ot` · `empresas` · `push_subs`.

Funciones RPC: `crear_edificio`, `buscar_edificio`, `puede_crear_edificio`, `recalcular_prorrateo(periodo)`, `resultados_encuestas`, `guardar_push`.

## Estado

- `schema.sql` probado en Postgres 16 local con `supabase/tests/run.sh`: instalación nueva, idempotencia, aislamiento entre edificios por rol, encuestas, disparo de avisos y migración desde la versión de un solo edificio.
- Frontend probado con una prueba de humo en Chromium contra un cliente Supabase simulado (crear edificio, invitación, gastos y exportaciones, encuestas, tarjeta de notificaciones).
- **No ha sido desplegado aún en un proyecto Supabase real.** En particular, la Edge Function `push` y el envío real de notificaciones no se han ejecutado nunca: es lo primero que hay que validar.

## Pendientes sugeridos (en orden)

1. Desplegar y probar end-to-end (auth, subida de fotos, realtime, push en Android/iOS/escritorio).
2. Cuentas con varios edificios (administradoras): tabla de membresías y selector de edificio.
3. Pagos en línea mediante Edge Function.
4. Avisos push para comunicados y encuestas.

## Prompt para pegar en Claude (o similar)

> Adjunto el proyecto "Mi Edificio" (carpeta `web/` con un frontend estático en JS vanilla y `supabase/schema.sql` con el backend). Lee primero `HANDOFF.md` y `README.md`. Es una app para residentes, conserjería, comité, administración y empresas de mantención de un edificio, sobre Supabase con RLS y soporte para varios edificios. Mantén el estilo actual: sin frameworks, sin build, toda la seguridad en políticas RLS, UI en español de Chile. Antes de cambiar el schema, recuerda que `schema.sql` es idempotente y debe seguir siéndolo, y que `supabase/tests/run.sh` debe seguir pasando. Mi primera tarea es: [describe aquí].
