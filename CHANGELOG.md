# Cambios

## 0.1.1 — 2026-11-22

- Finanzas: pagos registrados por la administración (con abonos parciales y anulación), convenios de pago para unidades morosas con aceptación del residente, panel de estado económico y flujo de caja mensual y anual con exportación a Excel.
- Estado de cuenta de la unidad en Gastos comunes.

## 0.1.0 — 2026-11-22

Primera versión publicada. Probada con pruebas automáticas locales; aún no se ha desplegado en un proyecto Supabase real.

### Módulos

- Gastos comunes con prorrateo por alícuota, estado de pago y exportación a PDF y Excel.
- Reservas de espacios comunes, incidencias con fotos, mensajes por canal, comunicados, documentos y encomiendas.
- Encuestas del comité: un voto por unidad, resultados solo como totales.
- Visitas con QR de acceso, lectura con cámara en conserjería y opción de estacionamiento con patente obligatoria configurable.
- Estacionamientos de visita: tablero de ocupación, tiempos configurables, aviso al residente y luego a administración y comité.
- Rondas NFC y bitácora; mantención con activos, plan preventivo y órdenes de trabajo para empresas externas.
- Asistente de configuración inicial en 7 pasos para un edificio nuevo.

### Plataforma

- Varios edificios por instalación, aislados por políticas RLS; se unen con enlace o código de invitación.
- Notificaciones push (Web Push) mediante triggers y una Edge Function opcional.
- Fotos y documentos en un bucket privado, con URLs firmadas y permisos por archivo.
- Reglas de negocio impuestas en la base de datos: aprobaciones, estados iniciales, horas y avisos.
- Protección de datos personales: aviso de privacidad por edificio, descarga de datos propios, eliminación de cuenta y plazos de conservación definidos por la administración.
- Política CSP, `supabase-js` con versión fija e integridad, y pruebas del esquema en CI.
- `schema.sql` migra solo las instalaciones anteriores de un solo edificio.
