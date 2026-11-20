-- Pruebas de aislamiento entre edificios, encuestas y notificaciones.
-- Requiere stubs.sql + schema.sql ya aplicados en una base vacía. Falla con error si algo no calza.
\set ON_ERROR_STOP on
\set a1 '00000000-0000-0000-0000-0000000000a1'
\set a2 '00000000-0000-0000-0000-0000000000a2'
\set a3 '00000000-0000-0000-0000-0000000000a3'
\set a4 '00000000-0000-0000-0000-0000000000a4'
\set b1 '00000000-0000-0000-0000-0000000000b1'
\set b2 '00000000-0000-0000-0000-0000000000b2'

create schema if not exists t;
grant usage on schema t to authenticated, anon;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLÓ: %', msg; end if; end $$;
-- ejecuta sql y exige que falle (o que no afecte filas)
create or replace function t.falla(sql text, msg text) returns void language plpgsql as $$
declare n bigint;
begin
  begin execute sql; get diagnostics n = row_count; exception when others then return; end;
  if n > 0 then raise exception 'FALLÓ (debía rechazarse): %', msg; end if;
end $$;
create or replace function t.soy(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, false), set_config('role', 'authenticated', false)
$$;

insert into auth.users (id) values (:'a1'),(:'a2'),(:'a3'),(:'a4'),(:'b1'),(:'b2');

-- ---------- creación de edificios ----------
select t.soy(:'a1');
select t.ok(public.puede_crear_edificio(), 'el primer edificio siempre se puede crear');
select public.crear_edificio('Torre A', 'Ana Admin') as ea \gset
select t.ok((select rol = 'admin' and estado = 'activo' from usuarios where id = :'a1'), 'quien crea el edificio es admin activo');
select t.soy(:'b1');
select t.ok(not public.puede_crear_edificio(), 'el segundo edificio está cerrado por defecto');
select t.falla($$select public.crear_edificio('Torre B','Beto')$$, 'crear edificio con creación cerrada');
select t.ok((select count(*) = 1 from public.buscar_edificio()), 'con un solo edificio se encuentra sin código');
reset role;
update plataforma set creacion_abierta = true, push_url = 'https://ejemplo.test/push', push_secret = 's3creto';
select t.soy(:'b1');
select public.crear_edificio('Torre B', 'Beto Admin') as eb \gset
reset role;
select codigo as ca from edificios where id = :'ea' \gset

-- ---------- unirse con código ----------
select t.soy(:'a2');
select t.ok((select count(*) = 0 from public.buscar_edificio()), 'con dos edificios hace falta código');
select t.ok((select nombre = 'Torre A' from public.buscar_edificio(lower(:'ca'))), 'buscar por código');
insert into usuarios (id, edificio_id, nombre, depto, rol, estado) values (:'a2', :'ea', 'Rita Residente', '101', 'admin', 'activo');
select t.ok((select rol = 'residente' and estado = 'pendiente' from usuarios where id = :'a2'), 'quien se une queda residente pendiente');
select t.ok((select count(*) = 1 from edificios), 'pendiente ve solo su edificio');
select t.ok((select count(*) = 0 from unidades) and public.mi_edificio() is null, 'pendiente no ve datos');
update usuarios set estado = 'activo', rol = 'admin' where id = auth.uid();
select t.ok((select estado = 'pendiente' and rol = 'residente' from usuarios where id = :'a2'), 'no puede auto-activarse ni subirse el rol');
select t.soy(:'a3'); insert into usuarios (id, edificio_id, nombre, depto, rol) values (:'a3', :'ea', 'Pedro Propietario', '102', 'propietario');
select t.soy(:'a4'); insert into usuarios (id, edificio_id, nombre, rol) values (:'a4', :'ea', 'Carla Conserje', 'conserje');
select t.soy(:'b2'); insert into usuarios (id, edificio_id, nombre, depto, rol) values (:'b2', :'eb', 'Bruno Residente', '101', 'residente');

select t.soy(:'a1');
select t.ok((select count(*) = 4 from usuarios), 'admin A ve solo usuarios de A');
update usuarios set estado = 'activo' where id in (:'a2', :'a3', :'a4');
select t.falla(format($$update usuarios set estado = 'activo' where id = %L returning 1$$, :'b2'), 'admin A activa usuario de B');
update usuarios set edificio_id = :'eb' where id = :'a2';
select t.ok((select edificio_id = :'ea' from usuarios where id = :'a2'), 'nadie cambia de edificio desde la app');
select t.falla(format($$update edificios set nombre = 'x' where id = %L returning 1$$, :'eb'), 'admin A edita edificio B');
select t.soy(:'b1'); update usuarios set estado = 'activo' where id = :'b2';

-- ---------- gastos comunes: mismo depto y período en dos edificios ----------
select t.soy(:'a1');
insert into unidades (depto, alicuota) values ('101', 60), ('102', 40);
insert into gastos (periodo, total, publicado) values ('2026-11', 1000, true);
select public.recalcular_prorrateo('2026-11');
select t.soy(:'b1');
insert into unidades (depto, alicuota) values ('101', 100);
insert into gastos (periodo, total, publicado) values ('2026-11', 5000, true);
select public.recalcular_prorrateo('2026-11');
select t.ok((select count(*) = 1 and sum(monto) = 5000 from gasto_unidades), 'prorrateo de B no mezcla unidades de A');
select t.ok((select count(*) = 1 from gastos) and (select count(*) = 1 from unidades), 'admin B ve solo lo suyo');
select t.falla(format($$insert into unidades (edificio_id, depto, alicuota) values (%L, '999', 1)$$, :'ea'), 'admin B inserta unidad en A');
select t.soy(:'a2');
select t.ok((select count(*) = 1 and sum(monto) = 600 from gasto_unidades), 'residente ve solo el cobro de su unidad');
select t.ok((select count(*) = 2 from unidades), 'residente ve unidades de su edificio');

-- ---------- mensajes ----------
insert into conversaciones (id, canal, depto) values ('conserjeria_101', 'conserjeria', '101');
insert into mensajes (conv_id, texto, uid, rol) values ('conserjeria_101', 'Hola desde A', :'a2', 'residente');
select t.soy(:'b2');
insert into conversaciones (id, canal, depto) values ('conserjeria_101', 'conserjeria', '101');
select t.ok((select count(*) = 0 from mensajes), 'B no lee mensajes de A aunque la conversación se llame igual');
select t.falla(format($$insert into mensajes (edificio_id, conv_id, texto, uid, rol) values (%L, 'conserjeria_101', 'intruso', %L, 'residente')$$, :'ea', :'b2'), 'B escribe en conversación de A');

-- ---------- encuestas ----------
select t.soy(:'a1');
insert into encuestas (titulo, opciones, uid) values ('¿Pintamos la fachada?', '["Sí","No"]', :'a1') returning id as enc \gset
insert into encuestas (titulo, opciones, solo_propietarios, uid) values ('Cuota extraordinaria', '["Apruebo","Rechazo"]', true, :'a1') returning id as encp \gset
select t.soy(:'a2');
insert into votos (encuesta_id, depto, opcion, uid) values (:'enc', '101', 0, :'a2');
select t.ok((select n = 1 and alicuota = 60 from public.resultados_encuestas() where encuesta_id = :'enc' and opcion = 0), 'resultado ponderado por alícuota');
update votos set opcion = 1 where encuesta_id = :'enc' and depto = '101';
select t.falla(format($$update votos set opcion = 7 where encuesta_id = %L returning 1$$, :'enc'), 'opción inexistente');
select t.falla(format($$insert into votos (encuesta_id, depto, opcion, uid) values (%L, '102', 0, %L)$$, :'enc', :'a2'), 'votar por otra unidad');
select t.falla(format($$insert into votos (encuesta_id, depto, opcion, uid) values (%L, '101', 0, %L)$$, :'encp', :'a2'), 'arrendatario vota encuesta de propietarios');
select t.soy(:'a3');
select t.ok((select count(*) = 0 from public.resultados_encuestas() where encuesta_id = :'enc'), 'sin votar no se ven resultados de una encuesta abierta');
select t.ok((select count(*) = 0 from votos), 'no se ve el voto de otra unidad');
insert into votos (encuesta_id, depto, opcion, uid) values (:'encp', '102', 0, :'a3');
select t.soy(:'a4');
select t.falla(format($$insert into votos (encuesta_id, depto, opcion, uid) values (%L, '', 0, %L)$$, :'enc', :'a4'), 'conserje vota');
select t.soy(:'b2');
select t.ok((select count(*) = 0 from encuestas), 'B no ve encuestas de A');
select t.falla(format($$insert into votos (edificio_id, encuesta_id, depto, opcion, uid) values (%L, %L, '101', 0, %L)$$, :'ea', :'enc', :'b2'), 'B vota encuesta de A');
select t.soy(:'a1');
select t.ok((select sum(n) = 1 from public.resultados_encuestas() where encuesta_id = :'enc'), 'el comité/admin ve resultados');
update encuestas set estado = 'cerrada' where id = :'enc';
select t.soy(:'a2');
select t.falla(format($$update votos set opcion = 0 where encuesta_id = %L returning 1$$, :'enc'), 'votar encuesta cerrada');
select t.soy(:'a3');
select t.ok((select count(*) = 1 from public.resultados_encuestas() where encuesta_id = :'enc'), 'cerrada: resultados visibles para todos');

-- ---------- notificaciones push ----------
select t.soy(:'a2'); select public.guardar_push('https://fcm.googleapis.com/fcm/send/a2', 'k', 'a');
select t.falla($$select public.guardar_push('http://interno/x', 'k', 'a')$$, 'endpoint sin https');
reset role; truncate net.llamadas;
select t.soy(:'a4'); insert into encomiendas (depto, descripcion, courier, recibido_por) values ('101', 'Caja', 'Correos', :'a4');
reset role;
select t.ok((select count(*) = 1 and bool_and(body->'uids' = to_jsonb(array[:'a2'::uuid]) and headers->>'x-push-secret' = 's3creto') from net.llamadas), 'encomienda avisa solo al residente del depto, con el secreto');
select t.soy(:'b1'); insert into encomiendas (depto, descripcion) values ('101', 'Sobre');
reset role;
select t.ok((select count(*) = 1 from net.llamadas), 'encomienda del depto 101 de B no avisa al 101 de A');
select t.soy(:'a1'); select public.guardar_push('https://fcm.googleapis.com/fcm/send/a1', 'k', 'a');
update edificios set espacios = '[{"id":"quincho","nombre":"Quincho","aprobacion":true},{"id":"gym","nombre":"Gimnasio","aprobacion":false}]' where id = :'ea';
select t.soy(:'a2');
insert into reservas (espacio_id, espacio_nombre, fecha, h_ini, h_fin, depto, uid) values ('quincho', 'Quincho', '2026-12-24', 18, 22, '101', :'a2') returning id as res \gset
select t.soy(:'a1'); update reservas set estado = 'aprobada' where id = :'res';
select t.soy(:'a4'); insert into mensajes (conv_id, texto, uid, rol) values ('conserjeria_101', 'Llegó su pedido', :'a4', 'conserje');
reset role;
select t.ok((select array_agg(body->>'titulo' order by id) = array['📦 Tienes una encomienda','📅 Reserva por aprobar','✅ Reserva aprobada','💬 Conserjería'] from net.llamadas), 'secuencia de avisos');
select t.ok((select body->'uids' = to_jsonb(array[:'a1'::uuid]) from net.llamadas where body->>'titulo' = '📅 Reserva por aprobar'), 'la reserva pendiente avisa a quien aprueba');
select t.ok(not has_schema_privilege('authenticated', 'privado', 'usage'), 'el esquema privado no es accesible desde la API');
select t.soy(:'a3');
select t.ok((select count(*) = 0 from plataforma) and (select count(*) = 0 from push_subs), 'ni la plataforma ni las suscripciones ajenas se leen');

-- ---------- reglas que no dependen del navegador ----------
select t.soy(:'a3');
insert into reservas (espacio_id, espacio_nombre, fecha, h_ini, h_fin, depto, uid, estado) values ('quincho', 'x', '2026-12-25', 18, 20, '102', :'a3', 'aprobada') returning id as res2 \gset
select t.ok((select estado = 'pendiente' and espacio_nombre = 'Quincho' from reservas where id = :'res2'), 'el estado inicial de la reserva lo decide el espacio');
select t.falla(format($$update reservas set estado = 'aprobada' where id = %L returning 1$$, :'res2'), 'aprobar la propia reserva');
select t.falla(format($$insert into reservas (espacio_id, espacio_nombre, fecha, h_ini, h_fin, depto, uid) values ('quincho', 'x', '2026-12-24', 20, 23, '102', %L)$$, :'a3'), 'reserva traslapada');
select t.falla(format($$insert into reservas (espacio_id, espacio_nombre, fecha, h_ini, h_fin, depto, uid) values ('piscina', 'x', '2026-12-26', 10, 11, '102', %L)$$, :'a3'), 'espacio inexistente');
update reservas set estado = 'cancelada', fecha = '2030-01-01' where id = :'res2';
select t.ok((select estado = 'cancelada' and fecha = '2026-12-25' from reservas where id = :'res2'), 'quien reserva solo puede cancelar');
insert into conversaciones (id, canal, depto) values ('comite_102', 'comite', '102');
insert into mensajes (conv_id, texto, uid, rol) values ('comite_102', 'Soy el comité (mentira)', :'a3', 'comite');
select t.ok((select rol = 'propietario' from mensajes where conv_id = 'comite_102'), 'no se puede suplantar el rol en un mensaje');
insert into incidencias (titulo, descripcion, depto, uid, estado, asignado_a) values ('Gotera', 'En el pasillo', '102', :'a3', 'cerrada', :'a3') returning id as inc \gset
select t.ok((select estado = 'abierta' and asignado_a is null from incidencias where id = :'inc'), 'la incidencia nace abierta y sin asignar');
select t.falla(format($$update incidencias set estado = 'resuelta' where id = %L returning 1$$, :'inc'), 'el residente marca resuelta su incidencia');
select t.falla(format($$insert into visitas (depto, nombre, fecha, estado, uid) values ('102', 'Falso', '2026-12-01', 'ingreso', %L)$$, :'a3'), 'residente registra un ingreso');
select t.falla($$select count(*) from storage.objects having count(*) > 0$$, 'residente lista archivos antes de subir');
-- empresa de mantención
reset role;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a5');
select t.soy(:'a1');
insert into empresas (nombre) values ('Ascensores SpA') returning id as emp \gset
select t.soy('00000000-0000-0000-0000-0000000000a5'); insert into usuarios (id, edificio_id, nombre, rol) values ('00000000-0000-0000-0000-0000000000a5', :'ea', 'Tito Técnico', 'mantencion');
select t.soy(:'a1'); update usuarios set estado = 'activo', empresa_id = :'emp' where id = '00000000-0000-0000-0000-0000000000a5';
insert into ot (titulo, descripcion, empresa_id, uid) values ('Revisar ascensor', 'Ruido', :'emp', :'a1') returning id as ot \gset
select t.soy('00000000-0000-0000-0000-0000000000a5');
update ot set estado = 'aceptada', titulo = 'otro título' where id = :'ot';
select t.ok((select estado = 'aceptada' and titulo = 'Revisar ascensor' from ot where id = :'ot'), 'la empresa avanza la orden sin poder reescribirla');
select t.falla(format($$update ot set estado = 'aprobada', costo = 999999 where id = %L returning 1$$, :'ot'), 'la empresa aprueba su propia orden');
-- derecho de supresión
select t.soy(:'a1');
select t.falla($$select public.eliminar_mi_cuenta()$$, 'la única administradora elimina su cuenta');
select t.soy(:'a3'); select public.eliminar_mi_cuenta();
reset role;
select t.ok((select nombre = 'Cuenta eliminada' and telefono = '' and depto = '' and estado = 'bloqueado' from usuarios where id = :'a3'), 'eliminar cuenta borra los datos del perfil y bloquea');
select t.ok((select privacidad_at is not null from usuarios where id = :'a2'), 'queda registrada la aceptación del aviso de privacidad');
select t.soy(:'a3'); select t.ok((select count(*) = 0 from mensajes) and (select count(*) = 0 from unidades), 'la cuenta eliminada ya no accede a nada');

-- ---------- storage ----------
select t.soy(:'a2');
insert into storage.objects (bucket_id, name) values ('fotos', :'ea' || '/incidencias/2026-11-20/x.jpg');
select t.falla(format($$insert into storage.objects (bucket_id, name) values ('fotos', %L)$$, :'eb' || '/incidencias/x.jpg'), 'subir a la carpeta de otro edificio');
select t.ok((select count(*) = 1 from storage.objects), 'cada edificio lista solo su carpeta');
select t.soy(:'b2'); select t.ok((select count(*) = 0 from storage.objects), 'otro edificio no puede listar esos archivos');
set role anon; select t.ok((select count(*) = 0 from storage.objects), 'sin sesión no se puede enumerar el bucket');
reset role;
\echo 'OK: todas las pruebas de RLS pasaron'
