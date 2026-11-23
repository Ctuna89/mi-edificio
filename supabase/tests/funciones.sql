-- Pruebas de votaciones de asamblea, bloqueos de espacios e interés por mora.
-- Requiere stubs.sql + schema.sql ya aplicados en una base vacía. Falla con error si algo no calza.
\set ON_ERROR_STOP on
\set a1 '00000000-0000-0000-0000-0000000000a1'
\set a2 '00000000-0000-0000-0000-0000000000a2'
\set a3 '00000000-0000-0000-0000-0000000000a3'

create schema if not exists t;
grant usage on schema t to authenticated, anon;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLÓ: %', msg; end if; end $$;
create or replace function t.falla(sql text, msg text) returns void language plpgsql as $$
declare n bigint;
begin
  begin execute sql; get diagnostics n = row_count; exception when others then return; end;
  if n > 0 then raise exception 'FALLÓ (debía rechazarse): %', msg; end if;
end $$;
create or replace function t.soy(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, false), set_config('role', 'authenticated', false)
$$;

insert into auth.users (id) values (:'a1'),(:'a2'),(:'a3');
select t.soy(:'a1');
select public.crear_edificio('Torre A', 'Ana Admin') as ea \gset
select t.soy(:'a2'); insert into usuarios (id, edificio_id, nombre, depto, rol) values (:'a2', :'ea', 'Rita', '101', 'propietario');
select t.soy(:'a3'); insert into usuarios (id, edificio_id, nombre, depto, rol) values (:'a3', :'ea', 'Pedro', '102', 'propietario');
select t.soy(:'a1');
update usuarios set estado = 'activo', rol = 'propietario' where id in (:'a2', :'a3');
insert into unidades (depto, alicuota) values ('101', 60), ('102', 40);

-- ---------- votación de asamblea: por alícuota y nominal ----------
insert into encuestas (titulo, opciones, tipo, uid) values ('Cambio de ascensores', '["Apruebo","Rechazo"]', 'asamblea', :'a1') returning id as asm \gset
insert into encuestas (titulo, opciones, uid) values ('Color de la cerámica', '["Gris","Beige"]', :'a1') returning id as son \gset
select t.falla(format($$insert into encuestas (titulo, opciones, tipo, uid) values ('x', '["a","b"]', 'otro', %L)$$, :'a1'), 'tipo de votación inválido');
select t.soy(:'a3');
select t.ok((select count(*) = 0 from public.votos_asamblea()), 'sin votar no se ve el voto nominal de una asamblea abierta');
select t.soy(:'a2');
insert into votos (encuesta_id, depto, opcion, uid) values (:'asm', '101', 0, :'a2'), (:'son', '101', 1, :'a2');
select t.ok((select count(*) = 1 and bool_and(depto = '101' and opcion = 0 and alicuota = 60) from public.votos_asamblea()), 'asamblea: se ve la unidad, su opción y su alícuota');
select t.ok((select alicuota = 60 from public.resultados_encuestas() where encuesta_id = :'asm' and opcion = 0), 'asamblea: resultado ponderado por alícuota');
select t.soy(:'a3');
insert into votos (encuesta_id, depto, opcion, uid) values (:'asm', '102', 1, :'a3');
select t.ok((select count(*) = 2 from public.votos_asamblea() where encuesta_id = :'asm'), 'al votar se ven los votos de todas las unidades');
select t.ok((select count(*) = 0 from public.votos_asamblea() where encuesta_id = :'son'), 'un sondeo nunca muestra votos por unidad');
select t.soy(:'a1');
update encuestas set tipo = 'asamblea' where id = :'son';
select t.ok((select tipo = 'sondeo' from encuestas where id = :'son'), 'un sondeo no se puede volver nominal después de publicado');

-- ---------- bloqueos recurrentes de espacios ----------
update edificios set espacios = '[{"id":"gym","nombre":"Gimnasio","desde":"06:00","hasta":"23:00","maxHoras":2,"aprobacion":false,
  "bloqueos":[{"dias":[1,2,3,4,5],"desde":11,"hasta":12,"motivo":"Aseo"}]}]';
select (date_trunc('week', public.hoy()::timestamp) + interval '7 days')::date as lunes, (date_trunc('week', public.hoy()::timestamp) + interval '12 days')::date as sabado \gset
select t.soy(:'a2');
select t.falla(format($$insert into reservas (espacio_id, espacio_nombre, fecha, h_ini, h_fin, depto, uid) values ('gym', 'x', %L, 11, 12, '101', %L)$$, :'lunes', :'a2'), 'reservar en la hora de aseo');
select t.falla(format($$insert into reservas (espacio_id, espacio_nombre, fecha, h_ini, h_fin, depto, uid) values ('gym', 'x', %L, 10, 12, '101', %L)$$, :'lunes', :'a2'), 'reservar un tramo que pisa la hora de aseo');
insert into reservas (espacio_id, espacio_nombre, fecha, h_ini, h_fin, depto, uid) values ('gym', 'x', :'lunes', 10, 11, '101', :'a2'), ('gym', 'x', :'lunes', 12, 13, '101', :'a2');
insert into reservas (espacio_id, espacio_nombre, fecha, h_ini, h_fin, depto, uid) values ('gym', 'x', :'sabado', 11, 12, '101', :'a2');
select t.ok((select count(*) = 3 from reservas), 'fuera del bloqueo (otra hora u otro día) se reserva normal');

-- ---------- interés por mora ----------
select t.soy(:'a1');
select to_char(public.hoy() - 100, 'YYYY-MM') as per, public.hoy() - 60 as vence, public.hoy() as hoy \gset
insert into gastos (periodo, total, publicado, vence) values (:'per', 100000, true, :'vence');
select public.recalcular_prorrateo(:'per');   -- 101: 60.000 · 102: 40.000, vencidos hace 60 días
select t.ok((select count(*) = 0 from public.intereses_mora()), 'sin tasa definida no hay intereses');
update edificios set mora_tasa = 1.5;         -- 1,5 % mensual = 0,05 % diario
select t.ok((select interes = 1800 from public.intereses_mora() where depto = '101') and (select interes = 1200 from public.intereses_mora() where depto = '102'), 'interés simple diario sobre el capital vencido');
select t.soy(:'a2');
select t.ok((select count(*) = 1 and bool_and(depto = '101') from public.intereses_mora()), 'cada unidad ve solo sus intereses');
select t.soy(:'a1');
insert into pagos (depto, periodo, monto, fecha) values ('101', :'per', 30000, (:'vence'::date + 30));
select t.ok((select interes = 1350 from public.intereses_mora() where depto = '101'), 'un abono reduce la base desde su fecha (900 + 450)');
select t.falla(format($$insert into pagos (depto, periodo, monto, concepto) values ('101', %L, 1351, 'interes')$$, :'per'), 'pagar más interés del devengado');
select t.falla(format($$insert into pagos (depto, periodo, monto, medio) values ('101', %L, 100, 'condonacion')$$, :'per'), 'condonar capital');
insert into pagos (depto, periodo, monto, fecha) values ('101', :'per', 30000, :'hoy');
select t.ok((select pagado and interes = 1350 and interes_pagado = 0 from gasto_unidades where depto = '101' and periodo = :'per'), 'al pagar el capital el interés queda fijo');
update edificios set mora_tasa = 3;
select t.ok((select interes = 1350 from public.intereses_mora() where depto = '101') and (select interes = 2400 from public.intereses_mora() where depto = '102'), 'cambiar la tasa no altera cobros ya pagados; sí los pendientes');
insert into pagos (depto, periodo, monto, concepto) values ('101', :'per', 1000, 'interes');
insert into pagos (depto, periodo, monto, concepto, medio, nota) values ('101', :'per', 350, 'interes', 'condonacion', 'Acuerdo del comité');
select t.ok((select interes = 1350 and pagado = 1350 from public.intereses_mora() where depto = '101'), 'interés pagado y condonado');
select t.ok((select pagado and pagado_monto = 60000 from gasto_unidades where depto = '101' and periodo = :'per'), 'los pagos de interés no cuentan como capital');
select t.falla(format($$insert into pagos (depto, periodo, monto, concepto) values ('101', %L, 1, 'interes')$$, :'per'), 'pagar interés ya saldado');
update edificios set mora_desde = public.hoy() - 10;
select t.ok((select interes = 400 from public.intereses_mora() where depto = '102'), 'la mora se cuenta desde la fecha definida por la administración');
update edificios set mora_desde = null;
select public.crear_convenio('102', array[:'per'], 2, (:'hoy'::date + 30)) as conv \gset
select t.ok((select interes = 2400 from public.intereses_mora() where depto = '102'), 'en convenio se conserva lo devengado');
reset role; update convenios set ts = ts - interval '20 days' where id = :'conv'; select t.soy(:'a1');
select t.ok((select interes = 1600 from public.intereses_mora() where depto = '102'), 'en convenio el interés deja de sumar desde que se propuso');
\echo 'OK: votaciones de asamblea, bloqueos e interés por mora'
