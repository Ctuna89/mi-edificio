# Cambios

## Sin publicar

- **Reparto por ítem**: cada ítem del gasto común se reparte por alícuota, en partes iguales, según consumo (con un % fijo opcional por alícuota) o solo entre algunas unidades. La suma cuadra al peso.
- **Lecturas de medidores**: agua caliente, calefacción, gas u otros. Conserjería y administración las ingresan o pegan desde Excel; la app avisa consumos raros y faltantes, y bloquea las lecturas de un período publicado.
- **Fondos**: fondo de reserva, mantención y otros, con aporte sugerido en %, aportes automáticos al publicar el período, usos (con egreso en el flujo de caja) y ajustes. La comunidad ve los saldos.
- **Cargos individuales**: multas, arriendo de espacios comunes y otros cobros que se suman al gasto común de la unidad. El arriendo se carga solo al aprobarse una reserva con costo. Rebajas y condonaciones con motivo.
- El residente ve el desglose de su cobro con sus consumos y cargos; el Excel del período trae el prorrateo ítem por ítem.

## 0.2.1 — 2026-11-23

- **Votaciones de asamblea**: al crear una encuesta se elige si es un sondeo (un voto por unidad, secreto) o materia de asamblea, donde el voto pesa según la alícuota y se ve qué votó cada unidad. Detalle descargable en Excel.
- **Horas bloqueadas en los espacios**: bloqueos semanales por aseo, mantención u otro motivo, varios por día, y opción de espacio abierto las 24 horas.
- **Interés por mora**: tasa mensual definida por la administración, calculada por día sobre lo impago; se paga o se condona, y queda registrado.
- Capturas de pantalla en el README.

## 0.2.0 — 2026-11-22

- **Instalación local**: un solo programa (`local/`) sirve la app y guarda la base de datos y los archivos en una carpeta del computador del edificio, sin servicios en la nube. Incluye cuentas, permisos, archivos con enlaces firmados, avisos en vivo, notificaciones, tareas programadas y respaldo diario. Supabase queda como instalación alternativa.
- **Un solo edificio por instalación**: se elimina el soporte multi-edificio y los códigos de invitación. La primera cuenta crea el edificio; las siguientes piden acceso.
- **Actualizaciones seguras**: copia automática antes de actualizar, cambios de la base de datos "todo o nada", página de mantención con instrucciones si algo falla, y bloqueo de versiones antiguas sobre datos más nuevos. La app avisa cuando hay una versión nueva y, en Windows, se actualiza con un clic.
- **Acceso desde internet integrado**: desde la app se conecta una dirección fija con el dominio del edificio, pegando el token de un túnel de Cloudflare. El servidor maneja el túnel y lo reconecta solo.
- **Instalador para Windows**: asistente que instala todo (incluye Node.js), incluye el programa del túnel, crea accesos para abrir y detener, y puede dejarlo iniciando con Windows. Su primer paso pregunta si la app va a funcionar en este computador (simple, debe quedar encendido) o en la nube (más complejo; muestra la guía y no instala nada). Se adjunta a cada versión publicada.
- En local, la administración restablece las contraseñas olvidadas.
- **Respaldo en la nube**: copia diaria cifrada de base de datos y archivos en una carpeta de OneDrive, Google Drive u otra nube, con advertencia si la carpeta no parece sincronizada, hora del respaldo elegida por la administración, paso propio en el asistente y restauración en un computador nuevo.

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
