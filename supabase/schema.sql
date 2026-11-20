-- =====================================================================
--  Mi Edificio — esquema Supabase (Postgres + RLS + Storage + Realtime)
--  Ejecutar completo en: Supabase → SQL Editor → New query → Run
--  Idempotente: se puede volver a ejecutar.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type rol_t as enum ('residente','propietario','conserje','comite','admin','mantencion');
exception when duplicate_object then null; end $$;
do $$ begin
  create type estado_usuario_t as enum ('pendiente','activo','bloqueado');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.config (
  id            int primary key default 1 check (id = 1),
  nombre        text not null default 'Mi Edificio',
  direccion     text default '',
  comuna        text default '',
  telefono      text default '',
  email         text default '',
  logo          text default '',          -- path en storage bucket "fotos"
  color         text default '#1e5eff',
  datos_bancarios text default '',
  espacios      jsonb not null default '[]'::jsonb,  -- [{id,nombre,capacidad,desde,hasta,maxHoras,anticipacionDias,aprobacion,costo}]
  actualizado   timestamptz default now()
);
insert into public.config (id) values (1) on conflict do nothing;

create table if not exists public.empresas (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  rubro     text default '',
  contacto  text default '',
  telefono  text default '',
  email     text default '',
  creado    timestamptz default now()
);

create table if not exists public.usuarios (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null default '',
  depto      text default '',
  telefono   text default '',
  rol        rol_t not null default 'residente',
  estado     estado_usuario_t not null default 'pendiente',
  empresa_id uuid references public.empresas(id) on delete set null,
  creado     timestamptz default now()
);

create table if not exists public.unidades (
  depto     text primary key,
  alicuota  numeric(8,4) not null default 0,
  prop      text default ''
);

create table if not exists public.gastos (
  periodo    text primary key,             -- 'YYYY-MM'
  vence      date,
  items      jsonb not null default '[]'::jsonb,   -- [{categoria,descripcion,monto}]
  total      numeric(14,2) not null default 0,
  publicado  boolean not null default false,
  actualizado timestamptz default now()
);

create table if not exists public.gasto_unidades (
  periodo   text references public.gastos(periodo) on delete cascade,
  depto     text not null,
  alicuota  numeric(8,4) not null default 0,
  monto     numeric(14,2) not null default 0,
  pagado    boolean not null default false,
  pagado_at timestamptz,
  primary key (periodo, depto)
);

create table if not exists public.reservas (
  id             uuid primary key default gen_random_uuid(),
  espacio_id     text not null,
  espacio_nombre text not null,
  fecha          date not null,
  h_ini          int not null,
  h_fin          int not null,
  depto          text not null,
  uid            uuid not null references public.usuarios(id),
  nota           text default '',
  estado         text not null default 'pendiente', -- pendiente|aprobada|rechazada|cancelada
  motivo_rechazo text,
  aprobado_por   uuid,
  ts             timestamptz default now()
);
create index if not exists reservas_fecha_idx on public.reservas(fecha);

create table if not exists public.incidencias (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  ubicacion   text default '',
  descripcion text not null,
  prioridad   text not null default 'media',
  fotos       text[] not null default '{}',
  depto       text not null default '',
  uid         uuid not null references public.usuarios(id),
  estado      text not null default 'abierta',  -- abierta|en_curso|resuelta|cerrada
  asignado_a  uuid references public.usuarios(id),
  ot_id       uuid,
  historial   jsonb not null default '[]'::jsonb,
  ts          timestamptz default now()
);

create table if not exists public.conversaciones (
  id                 text primary key,        -- canal_depto
  canal              text not null,           -- conserjeria|comite|administracion
  depto              text not null,
  ultimo             text default '',
  ultimo_ts          timestamptz default now(),
  ultimo_uid         uuid,
  no_leido_staff     boolean default false,
  no_leido_residente boolean default false
);

create table if not exists public.mensajes (
  id        uuid primary key default gen_random_uuid(),
  conv_id   text not null references public.conversaciones(id) on delete cascade,
  texto     text not null,
  uid       uuid not null references public.usuarios(id),
  rol       rol_t not null,
  ts        timestamptz default now()
);
create index if not exists mensajes_conv_idx on public.mensajes(conv_id, ts);

create table if not exists public.comunicados (
  id      uuid primary key default gen_random_uuid(),
  titulo  text not null,
  cuerpo  text not null,
  adjunto text default '',
  uid     uuid references public.usuarios(id),
  rol     rol_t,
  ts      timestamptz default now(),
  editado timestamptz
);

create table if not exists public.documentos (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null,
  cat    text not null default 'Otros',
  path   text not null,
  tipo   text default '',
  uid    uuid references public.usuarios(id),
  ts     timestamptz default now()
);

create table if not exists public.encomiendas (
  id           uuid primary key default gen_random_uuid(),
  depto        text not null,
  descripcion  text not null,
  courier      text default '',
  foto         text default '',
  recibido_por uuid references public.usuarios(id),
  entregado    boolean not null default false,
  entregado_at timestamptz,
  entregado_por uuid,
  retirado_por text,
  ts           timestamptz default now()
);

create table if not exists public.visitas (
  id         uuid primary key default gen_random_uuid(),
  depto      text not null,
  nombre     text not null,
  rut        text default '',
  patente    text default '',
  fecha      date not null,
  hora       text default '',
  nota       text default '',
  estado     text not null default 'anunciada', -- anunciada|ingreso|salida|no_llego
  ingreso_at timestamptz,
  salida_at  timestamptz,
  uid        uuid references public.usuarios(id),
  ts         timestamptz default now()
);

create table if not exists public.activos (
  id                uuid primary key default gen_random_uuid(),
  icono             text default '📍',
  nombre            text not null,
  ubicacion         text default '',
  nfc_tag           text default '',
  requisitos        jsonb not null default '[]'::jsonb, -- [{tipo,frecuenciaHoras,descripcion,fotoObligatoria}]
  plan_dias         int default 0,
  empresa_id        uuid references public.empresas(id) on delete set null,
  ultima_mantencion date
);

create table if not exists public.registros (
  id        uuid primary key default gen_random_uuid(),
  activo_id uuid references public.activos(id) on delete set null,
  tipo      text not null,     -- checkpoint|lectura|foto|incidencia
  valor     text default '',
  nota      text default '',
  foto      text default '',
  uid       uuid references public.usuarios(id),
  via_nfc   boolean default false,
  ts        timestamptz default now()
);
create index if not exists registros_ts_idx on public.registros(ts);

create table if not exists public.ot (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  descripcion    text not null,
  empresa_id     uuid references public.empresas(id),
  activo_id      uuid references public.activos(id) on delete set null,
  incidencia_id  uuid references public.incidencias(id) on delete set null,
  prioridad      text default 'media',
  limite         date,
  preventiva     boolean default false,
  estado         text not null default 'asignada', -- asignada|aceptada|agendada|en_terreno|cierre_tecnico|aprobada|rechazada
  fecha_agendada date,
  hora_agendada  text,
  llegada        timestamptz,
  salida         timestamptz,
  informe        text,
  costo          numeric(14,2) default 0,
  fotos_antes    text[] not null default '{}',
  fotos_despues  text[] not null default '{}',
  factura        text default '',
  historial      jsonb not null default '[]'::jsonb,
  uid            uuid references public.usuarios(id),
  ts             timestamptz default now(),
  aprobado_at    timestamptz
);

-- ---------------------------------------------------------------------
-- Funciones auxiliares (SECURITY DEFINER para evitar recursión en RLS)
-- ---------------------------------------------------------------------
create or replace function public.mi_rol() returns rol_t
language sql stable security definer set search_path = public as $$
  select rol from public.usuarios where id = auth.uid() and estado = 'activo'
$$;
create or replace function public.mi_depto() returns text
language sql stable security definer set search_path = public as $$
  select depto from public.usuarios where id = auth.uid() and estado = 'activo'
$$;
create or replace function public.mi_empresa() returns uuid
language sql stable security definer set search_path = public as $$
  select empresa_id from public.usuarios where id = auth.uid() and estado = 'activo'
$$;
create or replace function public.es_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('conserje','comite','admin'), false)
$$;
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() = 'admin', false)
$$;
create or replace function public.es_residente() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('residente','propietario'), false)
$$;
create or replace function public.canal_de_rol(r rol_t) returns text
language sql immutable as $$
  select case r when 'conserje' then 'conserjeria' when 'comite' then 'comite' when 'admin' then 'administracion' else null end
$$;

-- Primer usuario registrado = administrador activo. Los demás quedan pendientes.
create or replace function public.usuarios_antes_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id <> auth.uid() and not public.es_admin() then
    raise exception 'Solo puedes crear tu propio perfil';
  end if;
  if (select count(*) from public.usuarios) = 0 then
    new.rol := 'admin'; new.estado := 'activo';
  elsif not public.es_admin() then
    new.estado := 'pendiente';
    if new.rol in ('admin','comite') then new.rol := 'residente'; end if;
  end if;
  return new;
end $$;
drop trigger if exists usuarios_antes_insert on public.usuarios;
create trigger usuarios_antes_insert before insert on public.usuarios
for each row execute function public.usuarios_antes_insert();

-- Un no-admin solo puede cambiar nombre y teléfono de su propio perfil.
create or replace function public.usuarios_antes_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then
    if old.id <> auth.uid() then raise exception 'Sin permiso'; end if;
    new.rol := old.rol; new.estado := old.estado; new.depto := old.depto; new.empresa_id := old.empresa_id;
  end if;
  return new;
end $$;
drop trigger if exists usuarios_antes_update on public.usuarios;
create trigger usuarios_antes_update before update on public.usuarios
for each row execute function public.usuarios_antes_update();

-- Recalcular prorrateo de un período con las alícuotas actuales
create or replace function public.recalcular_prorrateo(p_periodo text) returns void
language plpgsql security definer set search_path = public as $$
declare t numeric;
begin
  if not public.es_admin() then raise exception 'Solo administración'; end if;
  select total into t from public.gastos where periodo = p_periodo;
  insert into public.gasto_unidades (periodo, depto, alicuota, monto)
  select p_periodo, u.depto, u.alicuota, round(t * u.alicuota / 100.0)
  from public.unidades u
  on conflict (periodo, depto) do update set alicuota = excluded.alicuota, monto = excluded.monto;
  delete from public.gasto_unidades g where g.periodo = p_periodo and not exists (select 1 from public.unidades u where u.depto = g.depto);
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.config         enable row level security;
alter table public.empresas       enable row level security;
alter table public.usuarios       enable row level security;
alter table public.unidades       enable row level security;
alter table public.gastos         enable row level security;
alter table public.gasto_unidades enable row level security;
alter table public.reservas       enable row level security;
alter table public.incidencias    enable row level security;
alter table public.conversaciones enable row level security;
alter table public.mensajes       enable row level security;
alter table public.comunicados    enable row level security;
alter table public.documentos     enable row level security;
alter table public.encomiendas    enable row level security;
alter table public.visitas        enable row level security;
alter table public.activos        enable row level security;
alter table public.registros      enable row level security;
alter table public.ot             enable row level security;

-- helper para (re)crear políticas sin errores
create or replace function public._pol(tbl text, nombre text, cmd text, usando text, con text default null) returns void
language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', nombre, tbl);
  if cmd = 'insert' then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', nombre, tbl, coalesce(con, usando));
  elsif cmd = 'update' then
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', nombre, tbl, usando, coalesce(con, usando));
  else
    execute format('create policy %I on public.%I for %s to authenticated using (%s)', nombre, tbl, cmd, usando);
  end if;
end $$;

-- config: todos los autenticados leen; admin edita
select public._pol('config','config_sel','select','true');
select public._pol('config','config_upd','update','public.es_admin()');

-- empresas: todos activos leen; admin escribe
select public._pol('empresas','emp_sel','select','public.mi_rol() is not null');
select public._pol('empresas','emp_ins','insert','public.es_admin()');
select public._pol('empresas','emp_upd','update','public.es_admin()');
select public._pol('empresas','emp_del','delete','public.es_admin()');

-- usuarios: cada uno ve el suyo; staff ve todos; mantención ve a sus colegas; insert propio; update por trigger
-- (residentes ven además a conserjes/comité/admin para mostrar nombres en chats e historiales)
select public._pol('usuarios','usu_sel','select','id = auth.uid() or public.es_staff() or (public.mi_rol() is not null and rol in (''conserje'',''comite'',''admin'')) or (public.mi_rol() = ''mantencion'' and empresa_id = public.mi_empresa())');
select public._pol('usuarios','usu_ins','insert','id = auth.uid() or public.es_admin()');
select public._pol('usuarios','usu_upd','update','id = auth.uid() or public.es_admin()');
select public._pol('usuarios','usu_del','delete','public.es_admin()');

-- unidades: activos leen; admin escribe
select public._pol('unidades','uni_sel','select','public.mi_rol() is not null');
select public._pol('unidades','uni_ins','insert','public.es_admin()');
select public._pol('unidades','uni_upd','update','public.es_admin()');
select public._pol('unidades','uni_del','delete','public.es_admin()');

-- gastos: residentes ven publicados; comité/admin todo; admin escribe
select public._pol('gastos','gas_sel','select','(publicado and public.mi_rol() is not null) or public.mi_rol() in (''comite'',''admin'')');
select public._pol('gastos','gas_ins','insert','public.es_admin()');
select public._pol('gastos','gas_upd','update','public.es_admin()');
select public._pol('gastos','gas_del','delete','public.es_admin()');
select public._pol('gasto_unidades','gu_sel','select','depto = public.mi_depto() or public.mi_rol() in (''comite'',''admin'')');
select public._pol('gasto_unidades','gu_ins','insert','public.es_admin()');
select public._pol('gasto_unidades','gu_upd','update','public.es_admin()');
select public._pol('gasto_unidades','gu_del','delete','public.es_admin()');

-- reservas: todos activos ven la agenda; residentes crean para su depto; cancelan las suyas; comité/admin gestionan
select public._pol('reservas','res_sel','select','public.mi_rol() is not null and public.mi_rol() <> ''mantencion''');
select public._pol('reservas','res_ins','insert','uid = auth.uid() and depto = public.mi_depto() and public.es_residente()');
select public._pol('reservas','res_upd','update','uid = auth.uid() or public.mi_rol() in (''comite'',''admin'')');

-- incidencias: residente ve su depto; staff todo; mantención las ligadas a sus OT
select public._pol('incidencias','inc_sel','select','depto = public.mi_depto() or public.es_staff() or (public.mi_rol() = ''mantencion'' and exists (select 1 from public.ot o where o.incidencia_id = incidencias.id and o.empresa_id = public.mi_empresa()))');
select public._pol('incidencias','inc_ins','insert','uid = auth.uid() and (public.es_staff() or depto = public.mi_depto())');
select public._pol('incidencias','inc_upd','update','uid = auth.uid() or public.es_staff()');

-- conversaciones / mensajes
select public._pol('conversaciones','conv_sel','select','(depto = public.mi_depto() and public.es_residente()) or public.es_admin() or canal = public.canal_de_rol(public.mi_rol())');
select public._pol('conversaciones','conv_ins','insert','(depto = public.mi_depto() and public.es_residente()) or public.es_admin() or canal = public.canal_de_rol(public.mi_rol())');
select public._pol('conversaciones','conv_upd','update','(depto = public.mi_depto() and public.es_residente()) or public.es_admin() or canal = public.canal_de_rol(public.mi_rol())');
select public._pol('mensajes','msg_sel','select','exists (select 1 from public.conversaciones c where c.id = mensajes.conv_id)');
select public._pol('mensajes','msg_ins','insert','uid = auth.uid() and exists (select 1 from public.conversaciones c where c.id = mensajes.conv_id)');

-- comunicados / documentos: todos activos (menos mantención en documentos) leen; comité/admin escriben
select public._pol('comunicados','com_sel','select','public.mi_rol() is not null');
select public._pol('comunicados','com_ins','insert','public.mi_rol() in (''comite'',''admin'')');
select public._pol('comunicados','com_upd','update','public.mi_rol() in (''comite'',''admin'')');
select public._pol('comunicados','com_del','delete','public.mi_rol() in (''comite'',''admin'')');
select public._pol('documentos','doc_sel','select','public.mi_rol() is not null and public.mi_rol() <> ''mantencion''');
select public._pol('documentos','doc_ins','insert','public.mi_rol() in (''comite'',''admin'')');
select public._pol('documentos','doc_del','delete','public.mi_rol() in (''comite'',''admin'')');

-- encomiendas: residente ve su depto; conserje/admin gestionan
select public._pol('encomiendas','enc_sel','select','depto = public.mi_depto() or public.mi_rol() in (''conserje'',''admin'')');
select public._pol('encomiendas','enc_ins','insert','public.mi_rol() in (''conserje'',''admin'')');
select public._pol('encomiendas','enc_upd','update','public.mi_rol() in (''conserje'',''admin'')');

-- visitas: residente anuncia para su depto y cancela las anunciadas; conserje/admin registran
select public._pol('visitas','vis_sel','select','depto = public.mi_depto() or public.mi_rol() in (''conserje'',''admin'')');
select public._pol('visitas','vis_ins','insert','(public.es_residente() and depto = public.mi_depto() and uid = auth.uid()) or public.mi_rol() in (''conserje'',''admin'')');
select public._pol('visitas','vis_upd','update','public.mi_rol() in (''conserje'',''admin'')');
select public._pol('visitas','vis_del','delete','(uid = auth.uid() and estado = ''anunciada'') or public.mi_rol() in (''conserje'',''admin'')');

-- activos: staff y mantención leen; admin escribe
select public._pol('activos','act_sel','select','public.es_staff() or public.mi_rol() = ''mantencion''');
select public._pol('activos','act_ins','insert','public.es_admin()');
select public._pol('activos','act_upd','update','public.es_admin()');
select public._pol('activos','act_del','delete','public.es_admin()');

-- registros (rondas): staff lee; conserje/admin inserta
select public._pol('registros','reg_sel','select','public.es_staff()');
select public._pol('registros','reg_ins','insert','uid = auth.uid() and public.mi_rol() in (''conserje'',''admin'')');

-- OT: comité/admin ven todo; mantención ve las de su empresa; admin crea; admin o empresa asignada actualizan
select public._pol('ot','ot_sel','select','public.mi_rol() in (''comite'',''admin'') or (public.mi_rol() = ''mantencion'' and empresa_id = public.mi_empresa())');
select public._pol('ot','ot_ins','insert','public.es_admin()');
select public._pol('ot','ot_upd','update','public.es_admin() or (public.mi_rol() = ''mantencion'' and empresa_id = public.mi_empresa())');

-- ---------------------------------------------------------------------
-- Storage: bucket público de lectura "fotos" (logo, incidencias, rondas, documentos)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('fotos','fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "fotos_read"   on storage.objects;
drop policy if exists "fotos_insert" on storage.objects;
drop policy if exists "fotos_delete" on storage.objects;
create policy "fotos_read"   on storage.objects for select using (bucket_id = 'fotos');
create policy "fotos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and public.mi_rol() is not null);
create policy "fotos_delete" on storage.objects for delete to authenticated using (bucket_id = 'fotos' and (public.es_admin() or public.mi_rol() = 'comite'));

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['config','empresas','usuarios','unidades','gastos','gasto_unidades','reservas','incidencias','conversaciones','mensajes','comunicados','documentos','encomiendas','visitas','activos','registros','ot']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Listo. Siguiente paso: crea tu usuario desde la app (el primero queda como administrador).
