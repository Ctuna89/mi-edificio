\set ON_ERROR_STOP on
do $$
declare n int;
begin
  if (select count(*) <> 1 or min(nombre) <> 'Edificio en 0.1.1' or min(color) <> '#aa5500' from edificios) then raise exception 'se perdió la configuración del edificio'; end if;
  if (select count(*) from usuarios) <> 2 or (select count(*) from unidades) <> 2 then raise exception 'se perdieron usuarios o unidades'; end if;
  if (select monto <> 250 or referencia <> 'TRX-7' from pagos) then raise exception 'se alteró el pago'; end if;
  if (select pagado_monto <> 250 or pagado from gasto_unidades where depto = '7') then raise exception 'se alteró lo abonado al cobro'; end if;
  if (select codigo is null or patente <> 'ABCD12' or not estacionamiento from visitas) then raise exception 'se alteró la visita'; end if;
  if (select count(*) from votos) <> 1 or (select reservado <> 'Discapacidad' from estacionamientos) then raise exception 'se perdieron votos o estacionamientos'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'edificios' and column_name = 'codigo') then raise exception 'sigue el código de invitación'; end if;
  begin insert into edificios (nombre) values ('Otro'); raise exception 'admite un segundo edificio';
  exception when unique_violation then null; end;
  -- y con sus permisos, la vecina sigue viendo lo suyo
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
  set local role authenticated;
  if (select count(*) from gasto_unidades) <> 1 or (select count(*) from pagos) <> 1 or (select count(*) from mensajes) <> 1 or (select count(*) from visitas) <> 1 then
    raise exception 'la vecina no ve sus datos después de actualizar';
  end if;
end $$;
\echo 'OK: actualización desde 0.1.1 con datos'
