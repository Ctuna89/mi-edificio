-- Datos de una instalación en la versión 0.1.1, cargados ANTES de aplicar el esquema actual.
-- versiones/revisar-0.1.1.sql comprueba que siguen ahí después de actualizar.
\set ON_ERROR_STOP on
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2');
insert into edificios (id, nombre, color, configurado_at) values ('00000000-0000-0000-0000-00000000ed01', 'Edificio en 0.1.1', '#aa5500', now());
insert into usuarios (id, edificio_id, nombre, depto, rol, estado) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000ed01', 'Admin', '', 'admin', 'activo'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000ed01', 'Vecina', '7', 'propietario', 'activo');
insert into unidades (edificio_id, depto, alicuota) values ('00000000-0000-0000-0000-00000000ed01', '7', 60), ('00000000-0000-0000-0000-00000000ed01', '8', 40);
insert into gastos (edificio_id, periodo, total, publicado, vence) values ('00000000-0000-0000-0000-00000000ed01', '2026-10', 1000, true, '2026-10-05');
insert into gasto_unidades (edificio_id, periodo, depto, alicuota, monto) values ('00000000-0000-0000-0000-00000000ed01', '2026-10', '7', 60, 600), ('00000000-0000-0000-0000-00000000ed01', '2026-10', '8', 40, 400);
insert into pagos (edificio_id, depto, periodo, monto, fecha, referencia) values ('00000000-0000-0000-0000-00000000ed01', '7', '2026-10', 250, '2026-10-03', 'TRX-7');
insert into visitas (edificio_id, depto, nombre, fecha, estacionamiento, patente) values ('00000000-0000-0000-0000-00000000ed01', '7', 'Visita previa', '2026-10-10', true, 'ABCD12');
insert into conversaciones (edificio_id, id, canal, depto) values ('00000000-0000-0000-0000-00000000ed01', 'comite_7', 'comite', '7');
insert into mensajes (edificio_id, conv_id, texto, uid, rol) values ('00000000-0000-0000-0000-00000000ed01', 'comite_7', 'hola', '00000000-0000-0000-0000-0000000000d2', 'propietario');
insert into encuestas (id, edificio_id, titulo, opciones) values ('00000000-0000-0000-0000-00000000e0c1', '00000000-0000-0000-0000-00000000ed01', '¿Pintamos?', '["Sí","No"]');
insert into votos (edificio_id, encuesta_id, depto, opcion) values ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-00000000e0c1', '7', 0);
insert into estacionamientos (edificio_id, nombre, reservado) values ('00000000-0000-0000-0000-00000000ed01', 'V1', 'Discapacidad');
