\set ON_ERROR_STOP on
do $$
declare e uuid; t text; n bigint;
begin
  select id into strict e from edificios;
  if (select nombre <> 'Edificio Antiguo' or color <> '#123456' from edificios) then raise exception 'config no migró a edificios'; end if;
  if to_regclass('public.config') is not null then raise exception 'config sigue existiendo'; end if;
  foreach t in array array['usuarios','unidades','gastos','gasto_unidades','conversaciones','mensajes','encomiendas'] loop
    execute format('select count(*) from %I where edificio_id = $1', t) into n using e;
    if n < 1 then raise exception 'filas de % sin migrar', t; end if;
  end loop;
  if (select rol <> 'admin' from usuarios where nombre = 'Admin Antiguo') then raise exception 'se perdió el admin'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
  set local role authenticated;
  if (select count(*) from gasto_unidades) <> 1 or (select count(*) from mensajes) <> 1 or (select count(*) from encomiendas) <> 1 then
    raise exception 'la residente no ve sus datos migrados';
  end if;
end $$;
\echo 'OK: migración desde un solo edificio'
