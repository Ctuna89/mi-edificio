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

insert into auth.users (id) values (:'a1'),(:'a2'),(:'a3'); update auth.users set email = 'u' || replace(id::text, '-', '') || '@ejemplo.cl' where email is null;
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
reset role; insert into auth.users (id) values (:'a4'); update auth.users set email = 'u' || replace(id::text, '-', '') || '@ejemplo.cl' where email is null;
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
select t.falla($$insert into cargos (depto, periodo, tipo, descripcion, monto) values ('102', '2030-04', 'multa', 'Ruidos', 25000)$$, 'una multa directa, sin caso de infracción');
insert into cargos (depto, periodo, tipo, descripcion, monto) values ('102', '2030-04', 'otro', 'Reposición de control del portón', 25000) returning id as multa \gset
select t.ok((select monto = 400 + 25000 and detalle->1->>'tipo' = 'otro' from gasto_unidades where periodo = '2030-04' and depto = '102'), 'el cargo se suma al cobro de la unidad');
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

-- ---------- multas con debido proceso ----------
\set a5 '00000000-0000-0000-0000-0000000000a5'
\set a6 '00000000-0000-0000-0000-0000000000a6'
reset role; insert into auth.users (id) values (:'a5'), (:'a6'); update auth.users set email = 'u' || replace(id::text, '-', '') || '@ejemplo.cl' where email is null;
select t.soy(:'a5'); insert into usuarios (id, edificio_id, nombre, rol) values (:'a5', :'ea', 'Cora Comité', 'comite');
select t.soy(:'a6'); insert into usuarios (id, edificio_id, nombre, rol) values (:'a6', :'ea', 'Cata Comité', 'comite');
select t.soy(:'a1'); update usuarios set estado = 'activo', rol = 'comite' where id in (:'a5', :'a6');
reset role; select t.ok(privado.dias_habiles(:'ea', '2026-12-04', 5) = '2026-12-14', '5 días hábiles saltan el fin de semana y el feriado del 8 de diciembre'); select t.soy(:'a1');
update edificios set multas = multas || '{"aprobaciones_comite":2}';
select public.cargar_catalogo_ejemplo();
select t.falla($$select public.cargar_catalogo_ejemplo()$$, 'cargar el ejemplo sobre un catálogo con conductas');
select id as c_ruido from multas_catalogo where conducta like 'Ruidos de mascota%' \gset
select id as c_jpl from multas_catalogo where jpl \gset
select id as c_obra from multas_catalogo where permanente limit 1 \gset
select t.falla($$insert into multas_catalogo (conducta, monto) values ('Sin monto', null)$$, 'conducta sin monto que no es del Juzgado de Policía Local');
-- conserjería abre un caso; la unidad aún no lo ve
select t.soy(:'a4');
select public.abrir_infraccion('Perro ladrando de 23 a 02 h, 3 noches seguidas', '101') as caso \gset
select t.ok((select folio = 1 and estado = 'abierto' and origen = 'conserjeria' from infracciones where id = :'caso'), 'conserjería abre el caso nº 1');
select t.soy(:'a2');
select t.ok((select count(*) = 0 from infracciones), 'antes de los cargos la unidad no ve el caso');
select t.falla(format($$select public.formular_cargos(%L, %L, '101', 'x', true)$$, :'caso', :'c_ruido'), 'un residente formula cargos');
select t.soy(:'a1');
select t.falla(format($$select public.formular_cargos(%L, %L, '101', 'Cargos', false)$$, :'caso', :'c_ruido'), 'cargos sin confirmar la evidencia mínima');
select t.falla(format($$select public.formular_cargos(%L, %L, '101', 'Cargos', true)$$, :'caso', :'c_jpl'), 'multar una conducta del Juzgado de Policía Local');
select t.falla(format($$select public.formular_cargos(%L, %L, '101', 'Cargos', true)$$, :'caso', :'c_ruido'), 'cargos sin el valor de la UTM');
insert into indicadores (codigo, desde, valor) values ('UTM', '2026-01-01', 69500), ('UF', '2026-01-01', 39800);
select public.formular_cargos(:'caso', :'c_ruido', '101', 'Se le notifican cargos por ruidos de mascota persistentes.', true);
reset role; select t.ok((select estado = 'cargos' and descargos_hasta = privado.dias_habiles(edificio_id, public.hoy(), 5) from infracciones where id = :'caso'), 'cargos notificados, con plazo de descargos en días hábiles'); select t.soy(:'a1');
select t.falla(format($$select public.resolver_infraccion(%L, true, 'Fundamentos')$$, :'caso'), 'resolver mientras corre el plazo de descargos sin descargos');
select t.soy(:'a3');
select t.falla(format($$select public.presentar_descargos(%L, 'No es mi perro')$$, :'caso'), 'otra unidad presenta descargos');
select t.soy(:'a2');
select t.ok((select count(*) = 1 from infracciones), 'con cargos, la unidad ve su caso');
select public.presentar_descargos(:'caso', 'El perro estaba enfermo, ya fue al veterinario.');
select t.soy(:'a1');
select t.falla(format($$select public.resolver_infraccion(%L, true, '')$$, :'caso'), 'resolución sin fundamentos');
select public.resolver_infraccion(:'caso', true, 'Se consideraron 3 constancias de conserjería y los descargos; la conducta está acreditada.');
select t.ok((select estado = 'en_comite' and multa_monto = 1 and multa_unidad = 'UTM' from infracciones where id = :'caso'), 'la sanción espera al comité');
select t.ok((select count(*) = 0 from cargos where infraccion_id = :'caso'), 'sin aprobación del comité no hay cobro');
select t.falla(format($$select public.votar_multa(%L, true)$$, :'caso'), 'la administración vota como comité');
select t.soy(:'a5'); select public.votar_multa(:'caso', true);
select t.falla(format($$select public.votar_multa(%L, true)$$, :'caso'), 'votar dos veces');
select t.soy(:'a6'); select public.votar_multa(:'caso', true);
select t.ok((select estado = 'resuelto' and multa_clp = 69500 from infracciones where id = :'caso'), 'con 2 aprobaciones se aplica: 1 UTM = $69.500');
select t.ok((select count(*) = 1 and bool_and(tipo = 'multa' and monto = 69500 and estado = 'vigente') from cargos where infraccion_id = :'caso'), 'la multa queda como cargo en el gasto común de la unidad');
select t.ok((select count(*) >= 6 from infraccion_eventos where infraccion_id = :'caso'), 'el expediente guarda cada paso');
-- reincidencia: misma conducta en 6 meses → el doble (no tiene categoría)
select t.soy(:'a1');
select public.abrir_infraccion('De nuevo ladridos nocturnos', '101') as caso2 \gset
select t.ok((select reincidencia and monto = 2 from public.propuesta_multa(:'caso2', :'c_ruido')), 'reincidencia en 6 meses propone el doble');
-- rechazo del comité: vuelve a la administración
select public.formular_cargos(:'caso2', :'c_ruido', '101', 'Cargos', true);
select public.presentar_descargos(:'caso2', 'Descargos entregados en papel');
select public.resolver_infraccion(:'caso2', true, 'Fundamentos', false);
select t.soy(:'a5');
select t.falla(format($$select public.votar_multa(%L, false)$$, :'caso2'), 'rechazar sin motivo');
select public.votar_multa(:'caso2', false, 'Falta evidencia de esta vez');
select t.soy(:'a6'); select public.votar_multa(:'caso2', false, 'Concuerdo');
select t.ok((select estado = 'cargos' and multa_monto is null from infracciones where id = :'caso2'), 'rechazada por el comité, vuelve a la administración');
select t.soy(:'a1');
select public.resolver_infraccion(:'caso2', false, 'No se acreditó esta vez');
select t.ok((select estado = 'absuelto' from infracciones where id = :'caso2'), 'absuelto con resolución fundada');
-- archivar y derivar
select public.abrir_infraccion('Reporte sin antecedentes suficientes') as caso3 \gset
select t.falla(format($$select public.archivar_infraccion(%L, '')$$, :'caso3'), 'archivar sin motivo');
select public.archivar_infraccion(:'caso3', 'No se pudo identificar la unidad');
select public.abrir_infraccion('Se negó a la revisión del gas', '102') as caso4 \gset
select public.derivar_jpl(:'caso4', 'Art. 77: corresponde al Juzgado de Policía Local');
select t.ok((select estado from infracciones where id = :'caso3') = 'archivado' and (select estado from infracciones where id = :'caso4') = 'derivado_jpl', 'archivar y derivar al Juzgado de Policía Local');
-- infracción permanente: se repite cada mes hasta restituir
update edificios set multas = multas || '{"aprobaciones_comite":0}';
select public.abrir_infraccion('Cierre de terraza sin autorización', '102') as caso5 \gset
select public.formular_cargos(:'caso5', :'c_obra', '102', 'Cargos', true);
select public.presentar_descargos(:'caso5', 'Lo retiraré');
select t.falla(format($$select public.resolver_infraccion(%L, true, 'Fundamentos')$$, :'caso5'), 'permanente sin plazo para restituir');
select public.resolver_infraccion(:'caso5', true, 'Fundamentos', true, public.hoy() + 30);
select t.ok((select estado = 'resuelto' from infracciones where id = :'caso5'), 'sin aprobaciones del comité configuradas se aplica de inmediato');
reset role;
select t.ok(privado.multas_permanentes() = 0, 'la repetición no duplica la multa del mes en curso');
alter table cargos disable trigger cargos_antes; update cargos set periodo = '2001-01' where infraccion_id = :'caso5'; alter table cargos enable trigger cargos_antes;
select t.ok(privado.multas_permanentes() = 1, 'el mes siguiente, la multa permanente se repite');
select t.soy(:'a1'); select public.marcar_restituido(:'caso5', public.hoy());
reset role; alter table cargos disable trigger cargos_antes; update cargos set periodo = '2001-02' where infraccion_id = :'caso5' and periodo <> '2001-01'; alter table cargos enable trigger cargos_antes;
select t.ok(privado.multas_permanentes() = 0, 'restituida, deja de repetirse');
-- multas al fondo de reserva al publicar el período
select t.soy(:'a1');
select periodo as pmulta from cargos where infraccion_id = :'caso' \gset
insert into gastos (periodo, total, publicado, items) values (:'pmulta', 1000, false, '[{"categoria":"Aseo","monto":1000}]') on conflict (edificio_id, periodo) do nothing;
select public.recalcular_prorrateo(:'pmulta');
update gastos set publicado = true where periodo = :'pmulta';
select t.ok((select count(*) = 1 and sum(monto) = 69500 from fondo_movimientos where periodo = :'pmulta' and descripcion like 'Multas%' and fondo_id = :'fres'), 'al publicar, las multas del período van al fondo de reserva');
select t.soy(:'a3');
select t.ok((select count(*) = 0 from infracciones where depto <> '102') and (select count(*) = 2 from infracciones), 'el 102 ve solo sus casos (con cargos o cerrados), no los de otra unidad');
\echo 'OK: multas con debido proceso'

-- ---------- datos personales (Ley 21.719) ----------
\set a7 '00000000-0000-0000-0000-0000000000a7'
reset role; insert into auth.users (id) values (:'a7'); update auth.users set email = 'u' || replace(id::text, '-', '') || '@ejemplo.cl' where email is null;
select t.soy(:'a7'); insert into usuarios (id, edificio_id, nombre, depto, telefono, privacidad_at) values (:'a7', :'ea', 'Sara Sánchez', '103', '+56 9 1111 2222', now());
select t.soy(:'a1'); update usuarios set estado = 'activo', rol = 'propietario' where id = :'a7';
select t.ok((select count(*) = 1 and bool_and(tipo = 'privacidad' and length(texto) > 10) from consentimientos where uid = :'a7'), 'aceptar el aviso de privacidad queda como consentimiento, con su texto');
select t.ok((select telefono = '' from usuarios where id = :'a7') and (select telefono = '+56 9 1111 2222' from contactos where uid = :'a7'), 'el teléfono se guarda aparte, no en usuarios, y la administración lo ve');
select t.soy(:'a4');
select t.ok((select count(*) = 0 from contactos), 'conserjería no recibe los teléfonos');
select t.falla($$select * from public.ver_telefonos('103', '')$$, 'consultar teléfonos sin motivo');
select t.ok((select telefono = '+56 9 1111 2222' from public.ver_telefonos('103', 'Encomienda refrigerada sin retirar')), 'con motivo, conserjería consulta el teléfono de la unidad');
select t.soy(:'a5');
select t.ok((select count(*) = 0 from contactos), 'el comité no recibe los teléfonos');
select t.soy(:'a2');
select t.ok((select count(*) = 0 from contactos), 'un residente no ve teléfonos de otros');
select t.falla($$select * from public.ver_telefonos('103', 'curiosidad')$$, 'un residente consulta teléfonos');
select t.ok((select count(*) = 0 from auditoria), 'la bitácora no la ve un residente');
select t.soy(:'a1');
select t.ok((select count(*) = 1 from auditoria where accion = 'consultar' and tabla = 'contactos' and motivo = 'Encomienda refrigerada sin retirar' and uid = :'a4'), 'la consulta queda en la bitácora con quién y por qué');
select t.ok((select count(*) >= 1 from auditoria where tabla = 'pagos' and accion = 'crear'), 'los pagos quedan en la bitácora');
select t.ok((select count(*) = 0 from auditoria where tabla = 'votos'), 'los votos no van a la bitácora (el sondeo es secreto)');
select t.falla($$delete from auditoria$$, 'borrar la bitácora');
select t.falla($$update auditoria set motivo = 'x'$$, 'modificar la bitácora');
-- solicitudes de derechos
select t.soy(:'a7');
insert into solicitudes_datos (tipo, detalle, estado, vence) values ('acceso', 'Quiero saber qué datos tienen de mí', 'respondida', '2099-01-01') returning id as sol \gset
select t.ok((select estado = 'recibida' and vence = public.hoy() + 30 from solicitudes_datos where id = :'sol'), 'la solicitud parte recibida con 30 días corridos de plazo');
select t.falla(format($$update solicitudes_datos set estado = 'respondida', respuesta = 'x' where id = %L$$, :'sol'), 'quien solicita se responde a sí mismo');
select t.soy(:'a2'); select t.ok((select count(*) = 0 from solicitudes_datos), 'no se ven las solicitudes de otros');
select t.soy(:'a1');
select t.falla(format($$update solicitudes_datos set estado = 'respondida' where id = %L$$, :'sol'), 'responder sin texto');
update solicitudes_datos set estado = 'respondida', respuesta = 'Adjuntamos el detalle; también puede descargarlo en Mi cuenta.' where id = :'sol';
select t.ok((select respondido_at is not null and respondido_por = :'a1' from solicitudes_datos where id = :'sol'), 'respuesta registrada con fecha y autor');
-- eliminar la cuenta borra el teléfono y los datos de la bitácora
select t.soy(:'a7'); select public.eliminar_mi_cuenta();
select t.soy(:'a1');
select t.ok((select count(*) = 0 from contactos where uid = :'a7'), 'al eliminar la cuenta se borra su teléfono');
select t.ok((select count(*) = 0 from auditoria where registro = :'a7' and (antes::text like '%Sánchez%' or despues::text like '%Sánchez%' or antes::text like '%1111%' or despues::text like '%1111%')), 'y sus datos desaparecen de la bitácora');
reset role; update edificios set retencion = retencion || '{"auditoria": 1}'; select set_config('mi_edificio.interno', '1', false); update auditoria set ts = now() - interval '2 months' where id = (select min(id) from auditoria); select set_config('mi_edificio.interno', '', false);
select privado.depurar_edificio(:'ea');
select t.ok((select count(*) = 0 from auditoria where ts < now() - interval '1 month'), 'la bitácora respeta el plazo de conservación que fija la administración');
\echo 'OK: datos personales'

-- ---------- seguros ----------
select t.soy(:'a1');
select t.ok((select public.polizas_faltantes() = '{incendio}'), 'sin póliza de incendio vigente hay alerta');
select t.falla($$insert into polizas (tipo, aseguradora, numero, desde, hasta) values ('incendio', 'X', '1', '2026-01-01', '2025-01-01')$$, 'póliza que termina antes de empezar');
insert into polizas (tipo, aseguradora, numero, desde, hasta, cubre_unidades) values ('incendio', 'Seguros Sur', 'INC-001', public.hoy() - 300, public.hoy() + 30, false) returning id as pol \gset
select t.ok((select public.polizas_faltantes() = '{}'), 'con la póliza vigente desaparece la alerta');
reset role; select t.ok(privado.avisos_seguros() >= 1, 'a 30 días del vencimiento se avisa'); select t.ok(privado.avisos_seguros() = 0, 'el mismo aviso no se repite'); select t.soy(:'a1');
select t.ok((select avisos = '{30}' from polizas where id = :'pol'), 'queda anotado qué aviso se envió');
select t.soy(:'a4'); select t.ok((select count(*) = 0 from polizas), 'conserjería no ve las pólizas');
select t.soy(:'a5'); select t.ok((select count(*) = 1 from polizas), 'el comité ve las pólizas');
-- documentos de unidad
select t.soy(:'a3');
select t.falla(format($$insert into unidad_documentos (depto, tipo, archivo, vence) values ('101', 'poliza_incendio', %L, '2027-01-01')$$, :'ea' || '/seguros/x.pdf'), 'subir documentos de otra unidad');
select t.falla(format($$insert into unidad_documentos (depto, tipo, archivo) values ('102', 'poliza_incendio', %L)$$, :'ea' || '/seguros/x.pdf'), 'póliza sin fecha de vencimiento');
insert into unidad_documentos (depto, tipo, archivo, vence, estado) values ('102', 'poliza_incendio', :'ea' || '/seguros/2026/p102.pdf', public.hoy() + 20, 'aceptado') returning id as doc \gset
select t.ok((select estado = 'en_revision' from unidad_documentos where id = :'doc'), 'el documento queda en revisión, aunque se envíe aceptado');
select t.falla(format($$update unidad_documentos set estado = 'aceptado' where id = %L$$, :'doc'), 'un propietario acepta su propio documento');
select t.soy(:'a2'); select t.ok((select count(*) = 0 from unidad_documentos), 'otra unidad no ve el documento');
select t.soy(:'a1');
select t.falla(format($$update unidad_documentos set estado = 'rechazado' where id = %L$$, :'doc'), 'rechazar sin motivo');
update unidad_documentos set estado = 'aceptado' where id = :'doc';
select t.ok((select revisado_por = :'a1' and revisado_at is not null from unidad_documentos where id = :'doc'), 'la revisión queda con autor y fecha');
reset role; select t.ok(privado.avisos_seguros() = 1, 'al propietario se le avisa que su póliza vence en menos de 30 días'); select t.ok(privado.avisos_seguros() = 0, 'una sola vez');
\echo 'OK: seguros'

-- ---------- suspensión de luz por morosidad ----------
\set a8 '00000000-0000-0000-0000-0000000000a8'
reset role; insert into auth.users (id) values (:'a8'); update auth.users set email = 'u' || replace(id::text, '-', '') || '@ejemplo.cl' where email is null;
select t.soy(:'a8'); insert into usuarios (id, edificio_id, nombre, depto) values (:'a8', :'ea', 'Tomás Torres', '104');
select t.soy(:'a1'); insert into unidades (depto, alicuota) values ('104', 0); update usuarios set estado = 'activo', rol = 'propietario' where id = :'a8';
insert into gastos (periodo, total, publicado, items) select p, 1000, false, '[{"categoria":"Reparación","monto":1000,"prorrateo":"unidades","deptos":["104"]}]' from unnest(array['2031-01','2031-02','2031-03']) p;
select public.recalcular_prorrateo(p) from unnest(array['2031-01','2031-02','2031-03']) p;
update gastos set publicado = true where periodo in ('2031-01','2031-02','2031-03');
select t.ok((select cuotas = 3 and deuda = 3000 and not protegida from public.unidades_morosas() where depto = '104'), 'el 104 tiene 3 cuotas de gasto común impagas');
select t.falla($$select public.proponer_suspension('103')$$, 'proponer una unidad con menos de 3 cuotas impagas (el 103 tiene 1)');
select public.proponer_suspension('104') as susp \gset
select t.falla($$select public.proponer_suspension('104')$$, 'dos procesos a la vez para la misma unidad');
select t.soy(:'a8'); select t.ok((select count(*) = 0 from suspensiones), 'antes del aviso la unidad no ve el proceso');
select t.soy(:'a1'); select t.falla(format($$select public.avisar_suspension(%L, public.hoy() + 10)$$, :'susp'), 'avisar sin aprobación del comité');
select t.soy(:'a5'); select public.votar_suspension(:'susp', true);
select t.soy(:'a1');
select t.ok((select estado = 'aprobada' from suspensiones where id = :'susp'), 'aprobada por el comité');
select t.falla(format($$select public.avisar_suspension(%L, public.hoy() + 2)$$, :'susp'), 'aviso con menos de 5 días corridos');
select public.avisar_suspension(:'susp', public.hoy() + 5);
select t.soy(:'a8'); select t.ok((select count(*) = 1 from suspensiones), 'con el aviso previo, la unidad ve el proceso');
select t.soy(:'a1');
select t.falla(format($$select public.solicitar_suspension(%L)$$, :'susp'), 'solicitar el corte antes de la fecha prevista');
reset role; update suspensiones set fecha_prevista = public.hoy() where id = :'susp'; select t.soy(:'a1');
select public.solicitar_suspension(:'susp');
select public.confirmar_suspension(:'susp', public.hoy());
select t.ok((select estado = 'suspendida' from suspensiones where id = :'susp'), 'suspendida tras aviso, aprobación y plazo');
select public.regularizar_suspension(:'susp', 'pago');
reset role; select t.ok((select estado = 'por_reponer' and reponer_antes = privado.dias_habiles(edificio_id, public.hoy(), 1) from suspensiones where id = :'susp'), 'tras el pago, reponer a más tardar el día hábil siguiente'); select t.soy(:'a1');
select public.confirmar_reposicion(:'susp', public.hoy());
select t.ok((select estado = 'repuesta' from suspensiones where id = :'susp'), 'suministro repuesto');
-- electrodependencia: se cancela el proceso y ya no se puede proponer
select public.proponer_suspension('104') as susp2 \gset
select t.soy(:'a8');
select t.falla($$select public.declarar_condicion('electrodependiente', 'Concentrador de oxígeno nocturno', '')$$, 'declarar sin consentimiento expreso');
select public.declarar_condicion('electrodependiente', 'Ventilador mecánico nocturno', 'Autorizo a la administración a registrar esta condición de salud para resguardos en emergencias y frente a cortes de luz.') as cond \gset
select t.soy(:'a1');
select t.ok((select estado = 'cancelada' and motivo_cierre like 'No procede%' from suspensiones where id = :'susp2'), 'al registrar un electrodependiente, el proceso se cancela solo');
select t.falla($$select public.proponer_suspension('104')$$, 'proponer la suspensión de una unidad con electrodependiente');
select t.ok((select protegida from public.unidades_morosas() where depto = '104'), 'la lista de morosos marca la unidad como protegida');
select t.soy(:'a5'); select t.ok((select count(*) = 0 from condiciones_especiales), 'el comité no ve el registro reservado');
select t.soy(:'a2'); select t.ok((select count(*) = 0 from condiciones_especiales), 'otra unidad no lo ve');
select t.soy(:'a4');
select t.falla($$select * from public.ver_condiciones('')$$, 'conserjería consulta sin motivo');
select t.ok((select count(*) = 1 from public.ver_condiciones('Corte de luz general: verificar equipos de apoyo') where depto = '104'), 'conserjería consulta con motivo (emergencia)');
select t.soy(:'a1'); select t.ok((select count(*) = 1 from auditoria where tabla = 'condiciones_especiales' and accion = 'consultar'), 'la consulta queda en la bitácora');
-- revocar el consentimiento deja la condición sin efecto
select t.soy(:'a8'); select public.revocar_consentimiento((select consentimiento_id from condiciones_especiales where id = :'cond'));
select t.soy(:'a1'); select t.ok((select hasta is not null from condiciones_especiales where id = :'cond'), 'revocado el consentimiento, la condición termina');
-- períodos excluidos (estado de catástrofe)
update edificios set suspension = suspension || '{"periodos_excluidos":["2031-01"]}';
select t.ok((select cuotas = 2 from public.unidades_morosas() where depto = '104'), 'las cuotas de un período excluido no cuentan');
select t.falla($$select public.proponer_suspension('104')$$, 'con el período excluido ya no alcanza el umbral');
\echo 'OK: suspensión de luz'

-- ---------- registro de copropietarios ----------
select t.soy(:'a1');
select t.ok(public.rut_normalizado('12.345.678-5') = '12345678-5' and public.rut_normalizado('12345678-9') is null and public.rut_normalizado('10.000.013-k') = '10000013-K', 'el RUT se normaliza y se valida el dígito verificador');
select t.falla($$insert into registro_personas (depto, relacion, nombre, rut) values ('101', 'copropietario', 'Rita Rojas', '12345678-9')$$, 'RUT inválido');
select t.falla($$insert into registro_personas (depto, relacion, nombre) values ('101', 'copropietario', 'Sin RUT')$$, 'copropietario sin RUT');
select t.falla($$insert into registro_personas (depto, relacion, nombre, rut, persona_juridica) values ('101', 'copropietario', 'Inmobiliaria X', '76.086.428-5', true)$$, 'persona jurídica sin representante');
insert into registro_personas (depto, relacion, nombre, rut, correo, domicilio) values ('101', 'copropietario', 'Rita Rojas', '12.345.678-5', 'RITA@correo.cl', 'Los Olmos 1234, depto 101');
select t.ok((select prop = 'Rita Rojas' from unidades where depto = '101'), 'el nombre del copropietario se refleja en la unidad');
select t.ok((select rut = '12345678-5' and correo = 'rita@correo.cl' from registro_personas where nombre = 'Rita Rojas'), 'RUT y correo quedan normalizados');
select t.ok((select faltantes = '{}' and not confirmado from public.registro_estado() where depto = '101'), 'el 101 tiene lo mínimo, pero aún no confirma este año');
select t.ok((select 'Sin copropietario registrado' = any(faltantes) from public.registro_estado() where depto = '103'), 'el 103 aparece sin copropietario');
-- el propietario informa un arrendatario: queda pendiente
select t.soy(:'a3');
insert into registro_personas (depto, relacion, nombre, rut, correo, domicilio, arriendo_hasta, estado) values ('102', 'arrendatario', 'Ana Arriendo', '11.111.111-1', 'ana@correo.cl', 'Los Olmos 1234, depto 102', public.hoy() + 300, 'vigente') returning id as rp \gset
select t.ok((select estado = 'pendiente' from registro_personas where id = :'rp'), 'lo que informa el propietario queda pendiente de revisión');
select t.falla($$insert into registro_personas (depto, relacion, nombre) values ('101', 'ocupante', 'Intruso')$$, 'informar cambios de otra unidad');
select t.falla(format($$delete from registro_personas where id = %L$$, :'rp'), 'borrar del registro');
select t.soy(:'a2'); select t.ok((select count(*) = 0 from registro_personas where depto = '102'), 'otra unidad no ve el registro del 102');
select t.soy(:'a1'); update registro_personas set estado = 'vigente' where id = :'rp';
select t.soy(:'a3'); update registro_personas set hasta = public.hoy() where id = :'rp';
select t.ok((select baja_solicitada and hasta is null from registro_personas where id = :'rp'), 'el propietario solo pide la baja; la aplica la administración');
select public.confirmar_registro(false);
select t.ok((select confirmado from public.registro_estado() where depto = '102') and (select not arrendatario_representa from unidades where depto = '102'), 'confirma el registro y declara que el arrendatario no lo representa');
select t.soy(:'a1'); update registro_personas set hasta = public.hoy() where id = :'rp';
select t.falla(format($$update registro_personas set hasta = null where id = %L$$, :'rp'), 'reabrir una relación terminada');
select t.ok(public.requerir_registro() >= 1, 'requerimiento anual a los propietarios');
select t.soy(:'a5'); select t.ok((select count(*) >= 2 from registro_personas), 'el comité ve el registro');
select t.soy(:'a4'); select t.ok((select count(*) = 0 from registro_personas), 'conserjería no ve el registro');
\echo 'OK: registro de copropietarios'

-- ---------- asambleas ----------
\set a9 '00000000-0000-0000-0000-0000000000a9'
reset role; insert into auth.users (id) values (:'a9'); update auth.users set email = 'u' || replace(id::text, '-', '') || '@ejemplo.cl' where email is null;
select t.soy(:'a9'); insert into usuarios (id, edificio_id, nombre, depto) values (:'a9', :'ea', 'Ana Arrendataria', '103');
select t.soy(:'a1'); update usuarios set estado = 'activo', rol = 'residente' where id = :'a9';
select public.crear_asamblea('ordinaria', 'mixta', now() + interval '3 days', 'Cuenta anual') as asm_pronto \gset
select t.falla(format($$select public.citar_asamblea(%L)$$, :'asm_pronto'), 'citar con menos de 5 días de anticipación');
select public.crear_asamblea('ordinaria', 'mixta', now() + interval '7 days', '1. Cuenta anual\n2. Presupuesto') as asm \gset
select t.soy(:'a2'); select t.ok((select count(*) = 0 from asambleas where id = :'asm'), 'una asamblea en borrador no la ven los residentes');
select t.soy(:'a1'); select public.citar_asamblea(:'asm');
select t.soy(:'a2'); select t.ok((select count(*) = 1 from asambleas where id = :'asm'), 'citada, la ven los residentes');
-- poder del 102 a un miembro del comité
select t.soy(:'a3');
select t.falla(format($$select public.otorgar_poder(%L, 'Cora', '12345678-9')$$, :'asm'), 'poder con RUT inválido');
select public.otorgar_poder(:'asm', 'Cora Comité', '11.111.111-1', '', :'a5') as poder \gset
select t.soy(:'a2'); select t.falla(format($$select public.revocar_poder(%L)$$, :'poder'), 'revocar el poder de otra unidad');
select t.falla(format($$select public.registrar_asistencia(%L, '101')$$, :'asm'), 'registrar asistencia antes de que empiece');
select t.soy(:'a1'); select public.iniciar_asamblea(:'asm');
select t.soy(:'a3'); select t.falla(format($$select public.revocar_poder(%L)$$, :'poder'), 'revocar el poder con la asamblea en curso');
select t.falla(format($$select public.registrar_asistencia(%L, '102')$$, :'asm'), 'el copropietario que dio poder no se registra');
select t.soy(:'a2'); select public.registrar_asistencia(:'asm', '101');
select t.ok((select presentes = 60 and constituida from public.quorum_asamblea(:'asm')), 'con el 60 % de los derechos presentes se constituye (ordinaria: 33 %)');
select t.falla(format($$select public.registrar_asistencia(%L, '102')$$, :'asm'), 'registrarse por otra unidad');
select t.soy(:'a5'); select public.registrar_asistencia(:'asm', '102');
select t.ok((select calidad = 'apoderado' from asamblea_asistencia where asamblea_id = :'asm' and depto = '102'), 'el apoderado registra la asistencia de la unidad');
select t.soy(:'a9'); select public.registrar_asistencia(:'asm', '103');
select t.ok((select calidad = 'arrendatario' from asamblea_asistencia where asamblea_id = :'asm' and depto = '103'), 'el arrendatario representa a la unidad si el dueño no asiste ni da poder');
select t.soy(:'a1');
select public.agregar_mocion(:'asm', 'Aprobar el presupuesto 2027') as moc \gset
select public.abrir_mocion(:'moc');
select t.soy(:'a2'); select t.falla(format($$select public.votar_mocion(%L, '101', 'si')$$, :'moc'), 'una unidad con cuotas impagas no vota');
reset role; update asamblea_asistencia set habil = true where asamblea_id = :'asm';
select t.soy(:'a2'); select public.votar_mocion(:'moc', '101', 'si');
select t.falla(format($$select public.votar_mocion(%L, '102', 'si')$$, :'moc'), 'votar por otra unidad');
select t.soy(:'a5'); select public.votar_mocion(:'moc', '102', 'no');
select t.ok((select calidad = 'apoderado' from asamblea_votos where mocion_id = :'moc' and depto = '102'), 'el voto queda con quién representó a la unidad');
select t.soy(:'a2'); select t.ok((select count(*) = 2 from asamblea_votos where mocion_id = :'moc'), 'el voto de asamblea es nominal: la comunidad ve qué votó cada unidad');
select t.falla(format($$update asamblea_votos set opcion = 'no' where mocion_id = %L$$, :'moc'), 'cambiar un voto');
select t.soy(:'a1');
select t.ok(public.cerrar_mocion(:'moc') = 'aprobada', 'ordinaria: 60 % de sí sobre el 100 % presente, aprobada');
select t.ok((select si = 60 and no = 40 and base = 100 from asamblea_mociones where id = :'moc'), 'quedan los derechos a favor y en contra');
select public.terminar_asamblea(:'asm');
select t.ok((select acta_hasta = public.hoy() + 30 from asambleas where id = :'asm'), 'al terminar, el acta tiene 30 días para firmarse');
select public.guardar_acta(:'asm', 'Acta de la asamblea ordinaria…', true);
select t.falla(format($$select public.guardar_acta(%L, 'otra', false)$$, :'asm'), 'modificar un acta firmada');
-- extraordinaria reforzada: el arrendatario necesita poder; acuerdo con 66 % de todos los derechos
select public.crear_asamblea('extraordinaria_reforzada', 'presencial', now() + interval '6 days', 'Cambio del reglamento') as ref \gset
select public.citar_asamblea(:'ref'); select public.iniciar_asamblea(:'ref');
select t.soy(:'a9'); select t.falla(format($$select public.registrar_asistencia(%L, '103')$$, :'ref'), 'en reforzada el arrendatario sin poder no representa');
select t.soy(:'a1'); select public.registrar_asistencia(:'ref', '101', 'propietario', 'Rita Rojas', 'presencial');
select t.ok((select not constituida from public.quorum_asamblea(:'ref')), 'con 60 % no se constituye una reforzada (66 %)');
select t.falla(format($$select public.abrir_mocion(%L)$$, (select public.agregar_mocion(:'ref', 'Modificar el reglamento'))), 'votar sin quórum');
\echo 'OK: asambleas'


-- ============ correos ============
select t.soy(:'a1');
select t.ok((select count(*) > 0 from correos where referencia like 'infracciones/%' and asunto like 'Notificación de cargos%'), 'formular cargos encola el correo de notificación');
select t.ok((select count(*) > 0 from correos where referencia like 'infracciones/%' and asunto like 'Resolución%'), 'la resolución se notifica por correo');
select t.ok((select count(*) > 0 from correos where referencia like 'asambleas/%' and asunto like 'Citación%'), 'citar a asamblea encola las citaciones');
select t.ok((select bool_and(para ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and estado = 'pendiente') from correos), 'solo se encolan correos válidos, pendientes');
select t.ok((select count(*) = count(distinct (para, referencia, asunto)) from correos where referencia like 'asambleas/%'), 'un correo por persona aunque esté en el registro y tenga cuenta');
select id as cor from correos limit 1 \gset
reset role; update correos set estado = 'error', intentos = 5 where id = :'cor';
select t.soy(:'a1'); select public.reintentar_correo(:'cor');
select t.ok((select estado = 'pendiente' and intentos = 0 from correos where id = :'cor'), 'la administración reintenta un correo con error');
select t.soy(:'a2');
select t.ok((select count(*) = 0 from correos), 'un residente no ve la cola de correos');
select t.falla(format($$select public.reintentar_correo(%L)$$, :'cor'), 'un residente reintenta correos');
\echo 'OK: correos'

-- ============ cobro por correo, comprobantes y certificados ============
select t.soy(:'a1');
insert into gastos (periodo, total, publicado, vence) values ('2035-07', 50000, true, public.hoy() + 2);
select public.recalcular_prorrateo('2035-07');
select t.ok((select count(*) > 0 from correos where referencia = 'gastos/2035-07' and texto like '%Monto de la unidad 101: $30.000%'), 'al publicar, cada unidad recibe su aviso de cobro con el monto');
select count(*) as n_cobro from correos where referencia = 'gastos/2035-07' \gset
select public.recalcular_prorrateo('2035-07');
select t.ok((select count(*) = :n_cobro from correos where referencia = 'gastos/2035-07'), 'volver a calcular no reenvía el aviso');
reset role; select privado.recordatorios_cobro(); select privado.recordatorios_cobro();
select t.soy(:'a1');
select t.ok((select count(*) = (select count(distinct para) from correos where referencia = 'gastos/2035-07' and texto like '%unidad 102%') from correos where referencia = 'recordatorio/2035-07/102'), 'recordatorio antes del vencimiento, una sola vez');
reset role; update gastos set vence = public.hoy() - 6 where periodo = '2035-07'; select privado.recordatorios_cobro();
select t.soy(:'a1');
select t.ok((select count(*) > 0 from correos where referencia = 'atraso/2035-07/102'), 'aviso de atraso pasados los días configurados');
insert into pagos (depto, periodo, monto, fecha, medio) values ('102', '2035-07', 15000, public.hoy(), 'transferencia') returning id as pago \gset
select t.ok((select count(*) > 0 from correos where referencia = 'pagos/' || :'pago' and asunto like 'Comprobante de pago nº%' and texto like '%Monto: $15.000%'), 'cada pago genera su comprobante por correo');
update edificios set correo_avisos = correo_avisos || '{"comprobante": false}' where id = public.mi_edificio();
insert into pagos (depto, periodo, monto, fecha, medio) values ('102', '2035-07', 1000, public.hoy(), 'efectivo') returning id as pago2 \gset
select t.ok((select count(*) = 0 from correos where referencia = 'pagos/' || :'pago2'), 'los comprobantes se pueden apagar');
select public.emitir_certificado('102', 'Venta de la unidad') as cert \gset
select t.ok((select folio = 1 and deuda > 0 and jsonb_array_length(detalle->'periodos') > 0 from certificados where id = :'cert'), 'certificado de deuda con folio y detalle por período');
select public.emitir_certificado('104') as cert2 \gset
select t.ok((select folio = 2 from certificados where id = :'cert2'), 'el folio es correlativo');
select t.falla($$select public.emitir_certificado('999')$$, 'certificado de una unidad que no existe');
select t.soy(:'a2');
select t.falla($$select public.emitir_certificado('101')$$, 'un residente emite certificados');
select t.ok((select count(*) = 0 from certificados where depto = '102'), 'un residente no ve certificados de otras unidades');
\echo 'OK: cobro por correo, comprobantes y certificados'
