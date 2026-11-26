# Cambios

## Sin publicar

- **Comunicados por correo y con lectura registrada**: al publicar se puede enviar también por correo a toda la comunidad (cuentas y Registro de copropietarios, una vez por persona); la app registra qué unidades lo abrieron, y en los importantes cada unidad confirma con "Lo leí" y el inicio se lo recuerda. La administración y el comité ven qué unidades faltan.

## 0.3.0 — 2026-11-26

- **Libro de novedades** de conserjería que no se puede editar ni borrar, con turnos: entrega con pendientes y resumen automático, y recepción registrada.
- **Fichas de las unidades**: vehículos y mascotas registrados por cada unidad, bodegas y estacionamientos asignados por la administración, con buscador para conserjería.
- **Emergencias**: plan con teléfonos, punto de encuentro, instrucciones y documento; responsables por zona; consulta registrada de quienes necesitan ayuda para evacuar; simulacros; resumen imprimible.
- **Proveedores y contratos**: contratos, certificaciones, mantenciones y garantías con vencimiento, aviso configurable, renovación y costo mensual comprometido.
- **Cartola bancaria**: importación desde Excel o CSV, unidad sugerida por RUT, unidad mencionada, nombre, monto o pagador conocido; al confirmar se registran los pagos con un solo comprobante; los cargos pasan al flujo de caja; sin duplicados y con deshacer.
- **Presupuesto anual** por categoría y mes, comparado con lo gastado.
- **Rendición de cuentas mensual** imprimible: gastos, caja, fondos, morosidad, presupuesto y conciliación.
- **Correo en la instalación con Supabase**: Edge Function `correos` que envía la cola por SMTP (puerto 465) o Resend, llamada cada minuto por pg_cron.
- **Avisos de cobro por correo**: al publicar el gasto común, a cada unidad su monto, vencimiento y saldo anterior; recordatorio antes del vencimiento y aviso de atraso configurables; comprobante por cada pago.
- **Comprobante de pago** imprimible con número, para la unidad y la administración.
- **Certificados de deuda o de no deuda** con folio correlativo y detalle, emitidos por la administración y visibles para la unidad.
- **Envío de correos** (instalación local): la administración conecta una cuenta de Gmail, Outlook o el correo del edificio y la app envía sola las notificaciones formales (multas, suspensión de luz, citaciones a asamblea, registro de copropietarios, solicitudes de datos), con constancia de cada envío, reintentos y correo de prueba.
- **Asambleas** (adaptado de CactusOne): citación con plazo, poderes simples revocables, representación del arrendatario, asistencia y quórum en vivo ponderado por alícuota, votaciones por moción con la mayoría de cada tipo de sesión (solo unidades hábiles), votos inmodificables, acta con plazo de firma y casos por inasistencia.
- **Registro de copropietarios, arrendatarios y ocupantes** (Ley 21.442 y Decreto 7; adaptado de CactusOne): RUT validado, correo para notificaciones, permanencia y arriendo; los propietarios informan cambios y confirman cada año; requerimiento anual, panel de faltantes, exportación registrada y declaración de representación en asambleas.
- **Módulos activables**: cada módulo opcional puede estar activo, solo para el personal o apagado.
- **Suspensión de luz por morosidad** (adaptado de CactusOne): solo con 3 o más cuotas de gasto común impagas, nunca a unidades con electrodependientes u oxígeno medicinal, con aprobación del comité, aviso previo de 5 días corridos y reposición al día hábil siguiente del pago o convenio; avisos y cartas imprimibles. **Registro reservado de condiciones especiales** con consentimiento expreso, consultable por conserjería en emergencias con motivo registrado.
- **Seguros** (adaptado de CactusOne): pólizas del edificio con alerta si falta la de incendio obligatoria, avisos a 60, 30 y 15 días y cada día la última semana, y registro de siniestros; documentos de cada unidad (póliza propia, certificado de dominio) revisados por la administración, con panel de cumplimiento y aviso al propietario 30 días antes del vencimiento.
- **Ley 21.719 de datos personales** (adaptado de CactusOne): bitácora de auditoría que no se puede modificar, teléfonos visibles solo para la persona y la administración (conserjería y comité los consultan con un motivo registrado), consentimientos con el texto aceptado, y solicitudes de acceso, rectificación, supresión, oposición, portabilidad o bloqueo con plazo de 30 días.
- **Multas con debido proceso** (adaptado de CactusOne): catálogo de conductas en UTM o UF, caso con evidencia, notificación de cargos, descargos en días hábiles, resolución fundada, aprobación del comité, reincidencia, infracciones permanentes y derivación al Juzgado de Policía Local. Lo cobrado va al fondo de reserva. Las multas ya no se pueden cargar a mano.
- **Reparto por ítem**: cada ítem del gasto común se reparte por alícuota, en partes iguales, según consumo (con un % fijo opcional por alícuota) o solo entre algunas unidades. La suma cuadra al peso.
- **Lecturas de medidores**: agua caliente, calefacción, gas u otros. Cada mes se anota lo que marca el medidor y el consumo es la diferencia con el mes anterior (nunca negativo). Cambio de medidor: consumo = (última del retirado − mes anterior) + (actual − inicial del nuevo). Conserjería y administración las ingresan o pegan desde Excel; la app avisa consumos raros y faltantes, y bloquea las lecturas de un período publicado.
- **Fondos**: fondo de reserva, mantención y otros, con aporte sugerido en %, aportes automáticos al publicar el período, usos (con egreso en el flujo de caja) y ajustes. La comunidad ve los saldos.
- **Cargos individuales**: multas, arriendo de espacios comunes y otros cobros que se suman al gasto común de la unidad. El arriendo se carga solo al aprobarse una reserva con costo. Rebajas y condonaciones con motivo.
- El residente ve el desglose de su cobro con sus consumos y cargos; el Excel del período trae el prorrateo ítem por ítem.
- **Inicio según el rol**: el residente ve de entrada su gasto común del mes (monto, vencimiento, estado y deuda anterior) y lo que tiene pendiente; administración, comité y conserjería ven lo que requiere su atención (solicitudes, reservas por aprobar, morosidad, borradores, lecturas faltantes, encomiendas, estacionamientos excedidos…) con enlace directo.
- **Montos y decimales a la chilena** en los formularios: punto de miles al escribir montos y coma decimal en alícuotas, tasas y lecturas. Los períodos se eligen con los meses escritos en español.
- **Accesibilidad**: texto secundario más oscuro (cumple contraste AA) y más grande, botones y campos de al menos 44 px en pantallas táctiles, y acciones como anular o rebajar convertidas en botones.

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
