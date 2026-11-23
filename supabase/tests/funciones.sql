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

-- ---------- medidores, lecturas y reparto por consumo ----------
\set a4 '00000000-0000-0000-0000-0000000000a4'
reset role; insert into auth.users (id) values (:'a4');
select t.soy(:'a4'); insert into usuarios (id, edificio_id, nombre, rol) values (:'a4', :'ea', 'Carla Conserje', 'conserje');
select t.soy(:'a1'); update usuarios set estado = 'activo', rol = 'conserje' where id = :'a4';
insert into unidades (depto, alicuota) values ('103', 0);   -- unidad sin alícuota (p. ej. un local), con consumo propio
update edificios set medidores = '[{"id":"acs","nombre":"Agua caliente","unidad":"m³"},{"id":"cal","nombre":"Calefacción","unidad":"kWh"}]';
select t.soy(:'a4');
insert into lecturas (periodo, medidor, depto, anterior, actual) values ('2030-01', 'acs', '101', 100, 110), ('2030-01', 'acs', '102', 50, 55), ('2030-01', 'acs', '103', 0, 5);
insert into lecturas (periodo, medidor, depto, actual) values ('2030-02', 'acs', '101', 112);
select t.ok((select anterior = 110 from lecturas where periodo = '2030-02' and depto = '101'), 'la lectura anterior se completa con la del período previo');
select t.falla($$insert into lecturas (periodo, medidor, depto, actual) values ('2030-02', 'acs', '102', 40)$$, 'lectura actual menor que la anterior');
select t.falla($$insert into lecturas (periodo, medidor, depto, actual) values ('2030-02', 'gas', '101', 1)$$, 'medidor que no existe');
select t.falla($$insert into lecturas (periodo, medidor, depto, actual) values ('2030-02', 'acs', '999', 1)$$, 'unidad que no existe');
insert into lecturas (periodo, medidor, depto, anterior, actual) values ('2030-02', 'acs', '103', 999, 7);
select t.ok((select anterior = 5 and consumo = 2 from lecturas where periodo = '2030-02' and depto = '103'), 'la lectura anterior siempre es la del mes pasado, aunque se envíe otra');
-- cambio de medidor en 102: el viejo marcaba 55 el mes pasado y 58 al retirarlo; el nuevo partió en 0 y hoy marca 4
select t.falla($$insert into lecturas (periodo, medidor, depto, actual, cambio, inicial_nuevo) values ('2030-02', 'acs', '102', 4, true, 0)$$, 'cambio de medidor sin la última lectura del retirado');
select t.falla($$insert into lecturas (periodo, medidor, depto, actual, cambio, final_retirado) values ('2030-02', 'acs', '102', 4, true, 50)$$, 'medidor retirado con lectura menor que la del mes pasado');
select t.falla($$insert into lecturas (periodo, medidor, depto, actual, cambio, final_retirado, inicial_nuevo) values ('2030-02', 'acs', '102', 4, true, 58, 10)$$, 'medidor nuevo con lectura menor que la inicial');
insert into lecturas (periodo, medidor, depto, actual, cambio, final_retirado, inicial_nuevo) values ('2030-02', 'acs', '102', 4, true, 58, 0);
select t.ok((select consumo = 7 from lecturas where periodo = '2030-02' and depto = '102'), 'cambio de medidor: (58 − 55) + (4 − 0) = 7');
insert into lecturas (periodo, medidor, depto, actual) values ('2030-03', 'acs', '102', 10);
select t.ok((select anterior = 4 and consumo = 6 from lecturas where periodo = '2030-03' and depto = '102'), 'el mes siguiente parte de la lectura del medidor nuevo');
update lecturas set actual = 5 where periodo = '2030-02' and depto = '102';
select t.ok((select anterior = 5 and consumo = 5 from lecturas where periodo = '2030-03' and depto = '102'), 'corregir una lectura actualiza la anterior del mes siguiente');
select t.falla($$update lecturas set cambio = false where periodo = '2030-02' and depto = '102'$$, 'quitar el cambio de medidor dejaría un consumo negativo');
select t.soy(:'a2');
select t.ok((select count(*) = 2 and bool_and(depto = '101') from lecturas), 'cada unidad ve solo sus lecturas');
select t.falla($$insert into lecturas (periodo, medidor, depto, actual) values ('2030-03', 'acs', '101', 200)$$, 'un residente ingresa lecturas');
select t.soy(:'a1');
-- 1.000.001 de agua caliente: 30 % fijo por alícuota, 70 % según consumo (10 + 5 + 5 = 20 m³).
-- Exacto: 101 = 180.000,18 + 350.000,35 = 530.000,53 · 102 = 295.000,30 · 103 = 175.000,18; el peso que sobra va al 101.
-- Conserjería 2.000 / 3 = 666,67: los dos pesos de redondeo van a 101 y 102.
insert into gastos (periodo, total, publicado, items) values ('2030-01', 1003001, false, '[
  {"categoria":"Agua caliente","monto":1000001,"prorrateo":"consumo","medidor":"acs","fijo":30},
  {"categoria":"Conserjería","monto":2000,"prorrateo":"iguales"},
  {"categoria":"Multa ruidos 102","monto":1000,"prorrateo":"unidades","deptos":["102"]}]');
select public.recalcular_prorrateo('2030-01');
select t.ok((select monto = 530668 from gasto_unidades where periodo = '2030-01' and depto = '101'), '101: 60 % del fijo + la mitad del consumo + un tercio de iguales (' || (select monto from gasto_unidades where periodo = '2030-01' and depto = '101') || ')');
select t.ok((select monto = 296667 from gasto_unidades where periodo = '2030-01' and depto = '102'), '102: incluye el cargo solo a su unidad (' || (select monto from gasto_unidades where periodo = '2030-01' and depto = '102') || ')');
select t.ok((select sum(monto) = 1003001 from gasto_unidades where periodo = '2030-01'), 'la suma de las unidades cuadra al peso con el total');
select t.ok((select detalle->0->>'consumo' = '10.000' and (detalle->0->>'monto')::int = 530001 from gasto_unidades where periodo = '2030-01' and depto = '101'), 'el desglose guarda el consumo y el monto de cada ítem');
select t.ok((select monto = 175000 + 666 from gasto_unidades where periodo = '2030-01' and depto = '103'), 'una unidad sin alícuota paga solo su consumo y su parte igual');
update gastos set items = items || '[{"categoria":"Calefacción","monto":5000,"prorrateo":"consumo","medidor":"cal"}]', total = total + 5000, publicado = true where periodo = '2030-01';
select t.falla($$select public.recalcular_prorrateo('2030-01')$$, 'publicar sin lecturas de un ítem según consumo');
update gastos set items = items - 3, total = total - 5000 where periodo = '2030-01';
select public.recalcular_prorrateo('2030-01');
select t.soy(:'a4');
select t.falla($$update lecturas set actual = 111 where periodo = '2030-01' and depto = '101'$$, 'corregir una lectura de un período publicado');
select t.soy(:'a1');

-- ---------- fondos ----------
insert into fondos (nombre, reserva, pct, saldo_inicial) values ('Fondo de reserva', true, 5, 100000) returning id as fres \gset
insert into fondos (nombre, pct) values ('Fondo de mantención', 0) returning id as fman \gset
insert into gastos (periodo, total, publicado, items) values ('2030-03', 1100, false, format('[{"categoria":"Aseo","monto":1000},{"categoria":"Fondo de reserva","monto":100,"fondo":"%s"}]', :'fres')::jsonb);
select public.recalcular_prorrateo('2030-03');
select t.ok((select saldo = 100000 from public.saldos_fondos() where fondo_id = :'fres'), 'un período en borrador no aporta al fondo');
update gastos set publicado = true where periodo = '2030-03';
select t.ok((select aportes = 100 and saldo = 100100 from public.saldos_fondos() where fondo_id = :'fres'), 'al publicar, el ítem del fondo se anota como aporte');
select t.falla(format($$insert into fondo_movimientos (fondo_id, tipo, monto, periodo) values (%L, 'aporte', 5, '2030-04')$$, :'fres'), 'anotar a mano un aporte de gastos comunes');
select public.usar_fondo(:'fres', 30000, '2030-03-15', 'Reparación bomba de agua');
select t.ok((select usos = 30000 and saldo = 70100 from public.saldos_fondos() where fondo_id = :'fres'), 'usar el fondo baja su saldo');
select t.ok((select count(*) = 1 from caja_movimientos where categoria = 'Fondo de reserva' and tipo = 'egreso' and monto = 30000), 'el uso queda como egreso en el flujo de caja');
select t.falla(format($$select public.usar_fondo(%L, 1, null, 'x')$$, :'fman'), 'usar un fondo sin saldo');
update gastos set publicado = false where periodo = '2030-03';
select t.ok((select aportes = 0 from public.saldos_fondos() where fondo_id = :'fres'), 'al despublicar, el aporte se quita');
update gastos set publicado = true where periodo = '2030-03';
select t.soy(:'a2');
select t.ok((select count(*) = 2 from public.saldos_fondos()), 'la comunidad ve los saldos de los fondos');
select t.falla(format($$select public.usar_fondo(%L, 1, null, 'x')$$, :'fres'), 'un residente usa un fondo');

-- ---------- cargos individuales ----------
select t.soy(:'a1');
insert into gastos (periodo, total, publicado, items) values ('2030-04', 1000, false, '[{"categoria":"Aseo","monto":1000}]');
select public.recalcular_prorrateo('2030-04');
insert into cargos (depto, periodo, tipo, descripcion, monto) values ('102', '2030-04', 'multa', 'Ruidos molestos', 25000) returning id as multa \gset
select t.ok((select monto = 400 + 25000 and detalle->1->>'tipo' = 'multa' from gasto_unidades where periodo = '2030-04' and depto = '102'), 'el cargo se suma al cobro de la unidad');
select t.falla($$insert into cargos (depto, periodo, tipo, monto) values ('101', '2030-03', 'otro', 5000)$$, 'cargo en un período publicado');
reset role; select t.ok(privado.periodo_abierto(:'ea', '2030-03') = '2030-04', 'el primer período abierto salta los publicados'); select t.soy(:'a1');
select t.falla(format($$update cargos set monto = 20000 where id = %L$$, :'multa'), 'rebajar sin motivo');
update cargos set monto = 20000, motivo = 'Primera vez' where id = :'multa';
select t.ok((select monto = 20000 and monto_original = 25000 from cargos where id = :'multa') and (select monto = 400 + 20000 from gasto_unidades where periodo = '2030-04' and depto = '102'), 'rebaja con motivo: queda el monto original y se recalcula el cobro');
update cargos set estado = 'anulado', motivo = 'Condonada por el comité' where id = :'multa';
select t.ok((select monto = 400 from gasto_unidades where periodo = '2030-04' and depto = '102'), 'la anulación saca el cargo del cobro');
select t.falla(format($$delete from cargos where id = %L$$, :'multa'), 'borrar un cargo');
select t.soy(:'a3');
select t.ok((select count(*) = 1 from cargos), 'cada unidad ve sus cargos');
select t.falla($$insert into cargos (depto, periodo, monto) values ('101', '2030-05', 1)$$, 'un residente registra cargos');
-- arriendo de espacio común con costo
select t.soy(:'a1');
update edificios set espacios = espacios || '[{"id":"quincho","nombre":"Quincho","desde":"10:00","hasta":"23:00","maxHoras":5,"aprobacion":false,"costo":15000}]';
select t.soy(:'a3');
insert into reservas (espacio_id, espacio_nombre, fecha, h_ini, h_fin, depto, uid) values ('quincho', 'x', '2030-04-20', 13, 17, '102', :'a3') returning id as rq \gset
select t.ok((select count(*) = 1 and bool_and(tipo = 'arriendo' and monto = 15000 and periodo = '2030-04') from cargos where reserva_id = :'rq'), 'una reserva aprobada de un espacio con costo genera su cargo');
select t.ok((select monto = 400 + 15000 from gasto_unidades where periodo = '2030-04' and depto = '102'), 'el arriendo se suma al gasto común');
update reservas set estado = 'cancelada' where id = :'rq';
select t.ok((select estado = 'anulado' from cargos where reserva_id = :'rq') and (select monto = 400 from gasto_unidades where periodo = '2030-04' and depto = '102'), 'al cancelar la reserva el cargo se anula solo');
\echo 'OK: medidores, reparto por consumo, fondos y cargos'
