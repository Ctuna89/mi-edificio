-- Datos de una instalación de un solo edificio (esquema v1). Se cargan ANTES de aplicar
-- el schema.sql actual; migracion_check.sql verifica el resultado.
\set ON_ERROR_STOP on
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2');
update config set nombre = 'Edificio Antiguo', color = '#123456';
insert into usuarios (id, nombre, depto) values ('00000000-0000-0000-0000-0000000000c1', 'Admin Antiguo', ''), ('00000000-0000-0000-0000-0000000000c2', 'Vecina', '5');
alter table usuarios disable trigger user; update usuarios set estado = 'activo'; alter table usuarios enable trigger user;
insert into unidades (depto, alicuota) values ('5', 100);
insert into gastos (periodo, total) values ('2026-10', 900);
insert into gasto_unidades (periodo, depto, alicuota, monto, pagado, pagado_at) values ('2026-10', '5', 100, 900, true, '2026-10-20');
insert into conversaciones (id, canal, depto) values ('comite_5', 'comite', '5');
insert into mensajes (conv_id, texto, uid, rol) values ('comite_5', 'hola', '00000000-0000-0000-0000-0000000000c2', 'residente');
insert into encomiendas (depto, descripcion) values ('5', 'Paquete');
