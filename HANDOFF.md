# Handoff — Mi Edificio

Este archivo resume el contexto del proyecto para que otra persona (o un asistente de IA) pueda continuar sin leer la conversación original.

## Qué es

App web para la comunidad de un edificio: residentes, conserjería, comité, administración y empresas de mantención. Un solo edificio por instalación (fase 1); multi-edificio está previsto pero no implementado.

## Stack y por qué

- **Frontend**: HTML + JS vanilla, sin framework ni build. Un archivo `web/app.js` (~2.000 líneas) con todas las vistas. Decisión: simplicidad de despliegue (se sube una carpeta) y cero dependencias que mantener.
- **Backend**: Supabase. Auth por email/contraseña, Postgres con Row Level Security, Storage (bucket `fotos`), Realtime.
- **Seguridad**: toda en RLS (`supabase/schema.sql`). El frontend solo decide qué mostrar; lo que cada rol puede leer/escribir lo decide la base de datos.
- **Roles** (`usuarios.rol`): residente, propietario, conserje, comite, admin, mantencion. Estado: pendiente / activo / bloqueado. El primer usuario registrado queda admin (trigger `usuarios_antes_insert`).

## Decisiones de alcance tomadas

- **Sin pago en línea** de gastos comunes (demasiado complejo para esta fase). Se muestran datos bancarios y el admin marca pagado a mano. Si se agrega, debe ir en una Edge Function, no en el navegador.
- **Rondas NFC** integradas en la misma app (antes existía un prototipo separado "Bitácora del edificio"). Web NFC solo funciona en Chrome Android; hay fallback por código o lista.
- **Perfil empresa de mantención**: externo, solo ve sus OT y los activos; flujo asignada → aceptada → agendada → en terreno → cierre técnico → aprobada por admin.
- Encuestas, citofonía digital y pagos quedaron para fases posteriores.

## Modelo de datos (resumen)

`config` (1 fila: nombre, logo, dirección, color, datos bancarios, `espacios` jsonb) · `usuarios` · `unidades` (depto, alícuota %) · `gastos` + `gasto_unidades` (prorrateo por período) · `reservas` · `incidencias` (fotos[], historial jsonb) · `conversaciones` + `mensajes` (un hilo por depto y canal) · `comunicados` · `documentos` · `encomiendas` · `visitas` · `activos` (nfc_tag, requisitos jsonb, plan preventivo) · `registros` (rondas) · `ot` · `empresas`.

Función RPC: `recalcular_prorrateo(periodo)`.

## Estado

- Código completo y probado con pruebas automatizadas simuladas (jsdom + cliente Supabase falso) y el SQL validado en Postgres 16 con usuarios simulados por rol.
- **No ha sido desplegado aún en un proyecto Supabase real**: la primera tarea es seguir el README, desplegar y probar en teléfono.

## Pendientes sugeridos (en orden)

1. Desplegar y probar end-to-end (auth, subida de fotos, realtime).
2. Notificaciones push (Web Push + Edge Function) para encomiendas, mensajes y aprobaciones.
3. Exportar gastos comunes a PDF/Excel.
4. Encuestas del comité.
5. Multi-edificio: columna `edificio_id` en todas las tablas y en `usuarios`; las políticas RLS comparan también ese campo.

## Prompt para pegar en Claude (o similar)

> Adjunto el proyecto "Mi Edificio" (carpeta `web/` con un frontend estático en JS vanilla y `supabase/schema.sql` con el backend). Lee primero `HANDOFF.md` y `README.md`. Es una app para residentes, conserjería, comité, administración y empresas de mantención de un edificio, sobre Supabase con RLS. Mantén el estilo actual: sin frameworks, sin build, toda la seguridad en políticas RLS, UI en español de Chile. Antes de cambiar el schema, recuerda que `schema.sql` es idempotente y debe seguir siéndolo. Mi primera tarea es: [describe aquí].
