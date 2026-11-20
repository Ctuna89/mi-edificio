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
-- Cada instalación puede alojar varios edificios. Todas las tablas llevan edificio_id
-- y las políticas RLS lo comparan con el edificio del usuario (public.mi_edificio()).
create table if not exists public.edificios (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)), -- código de invitación
  nombre        text not null default 'Mi Edificio',
  direccion     text default '',
  comuna        text default '',
  telefono      text default '',
  email         text default '',
  logo          text default '',          -- path en storage bucket "fotos"
  color         text default '#1e5eff',
  datos_bancarios text default '',
  espacios      jsonb not null default '[]'::jsonb,  -- [{id,nombre,capacidad,desde,hasta,maxHoras,anticipacionDias,aprobacion,costo}]
  privacidad    text default '',          -- aviso de privacidad que se muestra al registrarse
  retencion     jsonb not null default '{}'::jsonb,  -- plazos de conservación en meses, por tipo de dato
  creado_por    uuid,
  creado        timestamptz default now(),
  actualizado   timestamptz default now()
);
alter table public.edificios add column if not exists privacidad text default '';
-- Plazos de conservación en meses, definidos por la administración de cada edificio.
-- Claves: visitas, registros, encomiendas, mensajes, reservas, incidencias. Sin clave o 0 = no se borra.
alter table public.edificios add column if not exists retencion jsonb not null default '{}'::jsonb;

-- Ajustes de la instalación (1 fila). Sin políticas RLS: solo se edita desde el SQL Editor.
create table if not exists public.plataforma (
  id               int primary key default 1 check (id = 1),
  creacion_abierta boolean not null default false,  -- true: cualquier cuenta nueva puede crear otro edificio
  push_url         text default '',                 -- URL de la Edge Function "push"
  push_secret      text default ''                  -- mismo valor que el secreto PUSH_SECRET de la función
);
insert into public.plataforma (id) values (1) on conflict do nothing;
alter table public.plataforma enable row level security;

create table if not exists public.empresas (
  id        uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  nombre    text not null,
  rubro     text default '',
  contacto  text default '',
  telefono  text default '',
  email     text default '',
  creado    timestamptz default now()
);

create table if not exists public.usuarios (
  id         uuid primary key references auth.users(id) on delete cascade,
  edificio_id uuid references public.edificios(id) on delete cascade,
  nombre     text not null default '',
  depto      text default '',
  telefono   text default '',
  rol        rol_t not null default 'residente',
  estado     estado_usuario_t not null default 'pendiente',
  empresa_id uuid references public.empresas(id) on delete set null,
  privacidad_at timestamptz,               -- cuándo aceptó el aviso de privacidad (al registrarse)
  creado     timestamptz default now()
);
alter table public.usuarios add column if not exists privacidad_at timestamptz;

create table if not exists public.unidades (
  edificio_id uuid references public.edificios(id) on delete cascade,
  depto     text not null,
  alicuota  numeric(8,4) not null default 0,
  prop      text default '',
  primary key (edificio_id, depto)
);

create table if not exists public.gastos (
  edificio_id uuid references public.edificios(id) on delete cascade,
  periodo    text not null,                -- 'YYYY-MM'
  vence      date,
  items      jsonb not null default '[]'::jsonb,   -- [{categoria,descripcion,monto}]
  total      numeric(14,2) not null default 0,
  publicado  boolean not null default false,
  actualizado timestamptz default now(),
  primary key (edificio_id, periodo)
);

create table if not exists public.gasto_unidades (
  edificio_id uuid references public.edificios(id) on delete cascade,
  periodo   text not null,
  depto     text not null,
  alicuota  numeric(8,4) not null default 0,
  monto     numeric(14,2) not null default 0,
  pagado    boolean not null default false,
  pagado_at timestamptz,
  primary key (edificio_id, periodo, depto),
  constraint gasto_unidades_gasto_fkey foreign key (edificio_id, periodo) references public.gastos(edificio_id, periodo) on delete cascade
);

create table if not exists public.reservas (
  id             uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
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
  edificio_id uuid references public.edificios(id) on delete cascade,
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
  edificio_id        uuid references public.edificios(id) on delete cascade,
  id                 text not null,           -- canal_depto
  canal              text not null,           -- conserjeria|comite|administracion
  depto              text not null,
  ultimo             text default '',
  ultimo_ts          timestamptz default now(),
  ultimo_uid         uuid,
  no_leido_staff     boolean default false,
  no_leido_residente boolean default false,
  primary key (edificio_id, id)
);

create table if not exists public.mensajes (
  id        uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  conv_id   text not null,
  texto     text not null,
  uid       uuid not null references public.usuarios(id),
  rol       rol_t not null,
  ts        timestamptz default now(),
  constraint mensajes_conv_fkey foreign key (edificio_id, conv_id) references public.conversaciones(edificio_id, id) on delete cascade
);
create index if not exists mensajes_conv_idx on public.mensajes(conv_id, ts);

create table if not exists public.comunicados (
  id      uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
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
  edificio_id uuid references public.edificios(id) on delete cascade,
  nombre text not null,
  cat    text not null default 'Otros',
  path   text not null,
  tipo   text default '',
  uid    uuid references public.usuarios(id),
  ts     timestamptz default now()
);

create table if not exists public.encomiendas (
  id           uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
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
  edificio_id uuid references public.edificios(id) on delete cascade,
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
  edificio_id uuid references public.edificios(id) on delete cascade,
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
  edificio_id uuid references public.edificios(id) on delete cascade,
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
  edificio_id uuid references public.edificios(id) on delete cascade,
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

-- Encuestas del comité: un voto por unidad (depto), modificable mientras esté abierta
create table if not exists public.encuestas (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  titulo      text not null,
  descripcion text default '',
  opciones    jsonb not null default '[]'::jsonb,   -- ["Sí","No",...]
  solo_propietarios boolean not null default false,
  cierra      date,                                  -- último día para votar (null = sin plazo)
  estado      text not null default 'abierta',       -- abierta|cerrada
  uid         uuid references public.usuarios(id),
  ts          timestamptz default now()
);

create table if not exists public.votos (
  encuesta_id uuid not null references public.encuestas(id) on delete cascade,
  depto       text not null,
  edificio_id uuid references public.edificios(id) on delete cascade,
  opcion      int not null,                          -- índice en encuestas.opciones
  uid         uuid references public.usuarios(id),
  ts          timestamptz default now(),
  primary key (encuesta_id, depto)
);

-- Suscripciones Web Push (una por navegador/dispositivo)
create table if not exists public.push_subs (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  uid         uuid not null references public.usuarios(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  ua          text default '',
  creado      timestamptz default now()
);

-- Archivos de filas borradas por plazo de conservación, pendientes de eliminar del bucket.
-- Los elimina la app de la administración (la base de datos no puede borrar archivos de Storage).
create table if not exists public.archivos_por_borrar (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  path        text not null,
  creado      timestamptz default now()
);

-- ---------------------------------------------------------------------
-- Migración desde la versión de un solo edificio (no hace nada en instalaciones nuevas)
-- ---------------------------------------------------------------------
create or replace function public._pk_cols(tbl text) returns text
language sql as $$
  select string_agg(a.attname, ',' order by k.ord)
  from pg_index i
  join unnest(i.indkey) with ordinality k(attnum, ord) on true
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where i.indrelid = ('public.' || tbl)::regclass and i.indisprimary
$$;

do $$
declare t text; def uuid; n bigint;
begin
  -- la fila única de "config" pasa a ser el primer edificio
  if to_regclass('public.config') is not null then
    if not exists (select 1 from public.edificios) then
      execute 'insert into public.edificios (nombre,direccion,comuna,telefono,email,logo,color,datos_bancarios,espacios)
               select nombre,direccion,comuna,telefono,email,logo,color,datos_bancarios,espacios from public.config where id = 1';
    end if;
    begin
      execute 'alter publication supabase_realtime drop table public.config';
    exception when others then null;
    end;
    execute 'drop table public.config';
  end if;

  select id into def from public.edificios order by creado, id limit 1;
  foreach t in array array['empresas','usuarios','unidades','gastos','gasto_unidades','reservas','incidencias','conversaciones','mensajes','comunicados','documentos','encomiendas','visitas','activos','registros','ot','encuestas','votos','push_subs','archivos_por_borrar']
  loop
    execute format('alter table public.%I add column if not exists edificio_id uuid references public.edificios(id) on delete cascade', t);
    execute format('select count(*) from public.%I where edificio_id is null', t) into n;
    if n > 0 then
      if def is null then raise exception 'Hay filas en % sin edificio y no existe ningún edificio', t; end if;
      execute format('update public.%I set edificio_id = $1 where edificio_id is null', t) using def;
    end if;
    execute format('alter table public.%I alter column edificio_id set not null', t);
    execute format('create index if not exists %I on public.%I (edificio_id)', t || '_edificio_idx', t);
  end loop;

  -- claves primarias y foráneas compuestas (depto, período y conversación se repiten entre edificios)
  if public._pk_cols('unidades') <> 'edificio_id,depto' then
    alter table public.unidades drop constraint unidades_pkey, add primary key (edificio_id, depto);
  end if;
  if public._pk_cols('gastos') <> 'edificio_id,periodo' then
    alter table public.gasto_unidades drop constraint if exists gasto_unidades_periodo_fkey;
    alter table public.gasto_unidades drop constraint gasto_unidades_pkey, add primary key (edificio_id, periodo, depto);
    alter table public.gastos drop constraint gastos_pkey, add primary key (edificio_id, periodo);
    alter table public.gasto_unidades add constraint gasto_unidades_gasto_fkey
      foreign key (edificio_id, periodo) references public.gastos(edificio_id, periodo) on delete cascade;
  end if;
  if public._pk_cols('conversaciones') <> 'edificio_id,id' then
    alter table public.mensajes drop constraint if exists mensajes_conv_id_fkey;
    alter table public.conversaciones drop constraint conversaciones_pkey, add primary key (edificio_id, id);
    alter table public.mensajes add constraint mensajes_conv_fkey
      foreign key (edificio_id, conv_id) references public.conversaciones(edificio_id, id) on delete cascade;
  end if;
end $$;
drop function public._pk_cols(text);

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
-- Edificio del usuario activo (null si está pendiente o bloqueado)
create or replace function public.mi_edificio() returns uuid
language sql stable security definer set search_path = public as $$
  select edificio_id from public.usuarios where id = auth.uid() and estado = 'activo'
$$;
-- Edificio al que pertenece la cuenta, aunque siga pendiente (para mostrar nombre y logo)
create or replace function public.mi_edificio_asignado() returns uuid
language sql stable security definer set search_path = public as $$
  select edificio_id from public.usuarios where id = auth.uid()
$$;
-- "Hoy" en hora de Chile (plazos de encuestas)
create or replace function public.hoy() returns date
language sql stable as $$
  select (now() at time zone 'America/Santiago')::date
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

-- edificio_id se completa solo con el edificio de quien inserta
do $$
declare t text;
begin
  foreach t in array array['empresas','unidades','gastos','gasto_unidades','reservas','incidencias','conversaciones','mensajes','comunicados','documentos','encomiendas','visitas','activos','registros','ot','encuestas','votos','push_subs','archivos_por_borrar']
  loop
    execute format('alter table public.%I alter column edificio_id set default public.mi_edificio()', t);
  end loop;
end $$;

-- ¿Puede esta cuenta crear un edificio? Siempre el primero; los siguientes solo si
-- plataforma.creacion_abierta = true.
create or replace function public.puede_crear_edificio() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and (not exists (select 1 from public.edificios)
          or coalesce((select creacion_abierta from public.plataforma where id = 1), false))
$$;

-- Busca un edificio por código de invitación. Sin código, devuelve el edificio solo si
-- la instalación tiene exactamente uno (caso típico: un edificio, se comparte la URL).
drop function if exists public.buscar_edificio(text);
create or replace function public.buscar_edificio(p_codigo text default null)
returns table (id uuid, nombre text, logo text, color text, email text, privacidad text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.logo, e.color, e.email, e.privacidad
  from public.edificios e
  where auth.uid() is not null
    and case when coalesce(trim(p_codigo), '') <> ''
             then e.codigo = upper(trim(p_codigo))
             else (select count(*) from public.edificios) = 1 end
$$;

-- Crea un edificio y deja a quien lo crea como su administrador activo.
create or replace function public.crear_edificio(p_edificio text, p_nombre text, p_telefono text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if exists (select 1 from public.usuarios where id = auth.uid()) then raise exception 'Tu cuenta ya pertenece a un edificio'; end if;
  if not public.puede_crear_edificio() then raise exception 'La creación de edificios está cerrada en esta instalación'; end if;
  if coalesce(trim(p_edificio), '') = '' or coalesce(trim(p_nombre), '') = '' then raise exception 'Faltan el nombre del edificio o tu nombre'; end if;
  insert into public.edificios (nombre, creado_por) values (trim(p_edificio), auth.uid()) returning id into eid;
  insert into public.usuarios (id, edificio_id, nombre, telefono, rol, estado)
  values (auth.uid(), eid, trim(p_nombre), coalesce(trim(p_telefono), ''), 'admin', 'activo');
  return eid;
end $$;

-- Quien crea un edificio queda como administrador activo. Los demás quedan pendientes.
create or replace function public.usuarios_antes_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.edificios;
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor / service role
  new.privacidad_at := now();
  select * into e from public.edificios where id = new.edificio_id;
  if not found then raise exception 'Edificio no válido'; end if;
  if public.es_admin() and new.edificio_id = public.mi_edificio() then return new; end if;
  if new.id <> auth.uid() then raise exception 'Solo puedes crear tu propio perfil'; end if;
  if not exists (select 1 from public.usuarios where edificio_id = new.edificio_id)
     and (e.creado_por is null or e.creado_por = auth.uid()) then
    new.rol := 'admin'; new.estado := 'activo';
  else
    new.estado := 'pendiente'; new.empresa_id := null;
    if new.rol in ('admin','comite') then new.rol := 'residente'; end if;
  end if;
  return new;
end $$;
drop trigger if exists usuarios_antes_insert on public.usuarios;
create trigger usuarios_antes_insert before insert on public.usuarios
for each row execute function public.usuarios_antes_insert();

-- Un no-admin solo puede cambiar nombre y teléfono de su propio perfil. Nadie cambia de edificio desde la app.
create or replace function public.usuarios_antes_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor / service role
  if current_setting('mi_edificio.baja', true) = '1' then return new; end if;   -- eliminar_mi_cuenta()
  new.edificio_id := old.edificio_id; new.privacidad_at := old.privacidad_at;
  if not (public.es_admin() and old.edificio_id = public.mi_edificio()) then
    if old.id <> auth.uid() then raise exception 'Sin permiso'; end if;
    new.rol := old.rol; new.estado := old.estado; new.depto := old.depto; new.empresa_id := old.empresa_id;
  end if;
  return new;
end $$;
drop trigger if exists usuarios_antes_update on public.usuarios;
create trigger usuarios_antes_update before update on public.usuarios
for each row execute function public.usuarios_antes_update();

-- Derecho de supresión: borra los datos personales del perfil y bloquea la cuenta.
-- Lo que la persona escribió (mensajes, incidencias) queda sin su nombre. El correo sigue
-- en Supabase Auth hasta que quien opera la instalación elimine el usuario ahí.
create or replace function public.eliminar_mi_cuenta() returns void
language plpgsql security definer set search_path = public as $$
declare u public.usuarios;
begin
  select * into u from public.usuarios where id = auth.uid();
  if not found then raise exception 'Tu cuenta no tiene perfil'; end if;
  if u.rol = 'admin' and u.estado = 'activo' and not exists (
       select 1 from public.usuarios where edificio_id = u.edificio_id and rol = 'admin' and estado = 'activo' and id <> u.id) then
    raise exception 'Eres la única persona administradora: nombra a otra antes de eliminar tu cuenta';
  end if;
  delete from public.push_subs where uid = u.id;
  perform set_config('mi_edificio.baja', '1', true);
  update public.usuarios set nombre = 'Cuenta eliminada', telefono = '', depto = '', empresa_id = null, estado = 'bloqueado' where id = u.id;
  perform set_config('mi_edificio.baja', '', true);
end $$;

-- Reservas: el estado inicial lo decide la configuración del espacio (no el navegador), no se
-- aceptan horarios traslapados y quien reserva solo puede cancelar; aprobar es del comité/admin.
create or replace function public.reservas_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare esp jsonb;
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor / service role
  if tg_op = 'INSERT' then
    select x into esp from public.edificios e, jsonb_array_elements(e.espacios) x
    where e.id = new.edificio_id and x->>'id' = new.espacio_id;
    if esp is null then raise exception 'Espacio no válido'; end if;
    if new.h_fin <= new.h_ini then raise exception 'Horario no válido'; end if;
    if exists (select 1 from public.reservas r where r.edificio_id = new.edificio_id and r.espacio_id = new.espacio_id
               and r.fecha = new.fecha and r.estado in ('pendiente','aprobada') and r.h_ini < new.h_fin and new.h_ini < r.h_fin) then
      raise exception 'Ese horario ya está reservado';
    end if;
    new.espacio_nombre := coalesce(esp->>'nombre', new.espacio_nombre);
    new.estado := case when coalesce((esp->>'aprobacion')::boolean, false) then 'pendiente' else 'aprobada' end;
    new.aprobado_por := null; new.motivo_rechazo := null;
  elsif coalesce(public.mi_rol() in ('comite','admin'), false) then
    null;
  else
    if new.estado <> 'cancelada' or old.estado not in ('pendiente','aprobada') then raise exception 'Solo puedes cancelar tu reserva'; end if;
    new := old; new.estado := 'cancelada';
  end if;
  return new;
end $$;
drop trigger if exists reservas_antes on public.reservas;
create trigger reservas_antes before insert or update on public.reservas
for each row execute function public.reservas_antes();

-- Mensajes: el rol del autor lo pone la base de datos (no se puede escribir "como conserjería")
create or replace function public.mensajes_antes_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.rol := public.mi_rol(); end if;
  return new;
end $$;
drop trigger if exists mensajes_antes_insert on public.mensajes;
create trigger mensajes_antes_insert before insert on public.mensajes
for each row execute function public.mensajes_antes_insert();

-- Incidencias: quien reporta no se asigna ni cambia prioridad; solo confirma o reabre una resuelta
create or replace function public.incidencias_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.es_staff() then return new; end if;
  if tg_op = 'INSERT' then
    new.estado := 'abierta'; new.asignado_a := null; new.ot_id := null;
  else
    if new.estado is distinct from old.estado and not (old.estado = 'resuelta' and new.estado in ('cerrada','abierta')) then
      raise exception 'No puedes cambiar el estado de la incidencia';
    end if;
    new.asignado_a := old.asignado_a; new.ot_id := old.ot_id; new.depto := old.depto; new.uid := old.uid;
    new.prioridad := old.prioridad; new.titulo := old.titulo; new.descripcion := old.descripcion;
  end if;
  return new;
end $$;
drop trigger if exists incidencias_antes on public.incidencias;
create trigger incidencias_antes before insert or update on public.incidencias
for each row execute function public.incidencias_antes();

-- Órdenes de trabajo: la empresa avanza su flujo, pero no aprueba su propio trabajo,
-- no se reasigna la orden ni la modifica una vez cerrada
create or replace function public.ot_antes_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.es_admin() then return new; end if;
  if old.estado in ('aprobada','rechazada') then raise exception 'La orden ya está cerrada'; end if;
  if new.estado is distinct from old.estado and new.estado not in ('aceptada','rechazada','agendada','en_terreno','cierre_tecnico') then
    raise exception 'Solo la administración puede dejar la orden en ese estado';
  end if;
  new.empresa_id := old.empresa_id; new.titulo := old.titulo; new.descripcion := old.descripcion; new.uid := old.uid;
  new.incidencia_id := old.incidencia_id; new.activo_id := old.activo_id; new.preventiva := old.preventiva;
  new.prioridad := old.prioridad; new.limite := old.limite; new.aprobado_at := old.aprobado_at;
  return new;
end $$;
drop trigger if exists ot_antes_update on public.ot;
create trigger ot_antes_update before update on public.ot
for each row execute function public.ot_antes_update();

-- Recalcular prorrateo de un período con las alícuotas actuales
create or replace function public.recalcular_prorrateo(p_periodo text) returns void
language plpgsql security definer set search_path = public as $$
declare t numeric; e uuid := public.mi_edificio();
begin
  if not public.es_admin() then raise exception 'Solo administración'; end if;
  select total into t from public.gastos where edificio_id = e and periodo = p_periodo;
  insert into public.gasto_unidades (edificio_id, periodo, depto, alicuota, monto)
  select e, p_periodo, u.depto, u.alicuota, round(t * u.alicuota / 100.0)
  from public.unidades u where u.edificio_id = e
  on conflict (edificio_id, periodo, depto) do update set alicuota = excluded.alicuota, monto = excluded.monto;
  delete from public.gasto_unidades g where g.edificio_id = e and g.periodo = p_periodo
    and not exists (select 1 from public.unidades u where u.edificio_id = e and u.depto = g.depto);
end $$;

-- Encuestas: ¿puede mi unidad votar esta opción ahora?
create or replace function public.puede_votar(p_encuesta uuid, p_opcion int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.encuestas e
    where e.id = p_encuesta and e.edificio_id = public.mi_edificio()
      and e.estado = 'abierta' and (e.cierra is null or e.cierra >= public.hoy())
      and p_opcion >= 0 and p_opcion < jsonb_array_length(e.opciones)
      and case when e.solo_propietarios then public.mi_rol() = 'propietario' else public.es_residente() end)
$$;

-- Resultados agregados (nadie ve el voto de otra unidad). Comité y administración los ven
-- siempre; los residentes, cuando su unidad ya votó o la encuesta terminó.
create or replace function public.resultados_encuestas()
returns table (encuesta_id uuid, opcion int, n int, alicuota numeric)
language sql stable security definer set search_path = public as $$
  select v.encuesta_id, v.opcion, count(*)::int, coalesce(sum(u.alicuota), 0)::numeric
  from public.votos v
  join public.encuestas e on e.id = v.encuesta_id
  left join public.unidades u on u.edificio_id = v.edificio_id and u.depto = v.depto
  where e.edificio_id = public.mi_edificio()
    and public.mi_rol() in ('residente','propietario','comite','admin')
    and (public.mi_rol() in ('comite','admin')
         or e.estado = 'cerrada' or (e.cierra is not null and e.cierra < public.hoy())
         or exists (select 1 from public.votos m where m.encuesta_id = e.id and m.depto = public.mi_depto()))
  group by v.encuesta_id, v.opcion
$$;

-- ---------------------------------------------------------------------
-- Notificaciones push: los triggers arman el aviso y lo envían a la Edge Function "push"
-- (supabase/functions/push) usando pg_net. Sin plataforma.push_url no hacen nada.
-- ---------------------------------------------------------------------
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net no disponible: las notificaciones push quedan desactivadas';
end $$;

-- Esquema no expuesto por la API: estas funciones no se pueden llamar desde el navegador
create schema if not exists privado;

create or replace function privado.push(p_edificio uuid, p_uids uuid[], p_titulo text, p_cuerpo text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if p_uids is null or cardinality(p_uids) = 0 then return; end if;
  select push_url, push_secret into c from public.plataforma where id = 1;
  if coalesce(c.push_url, '') = '' then return; end if;
  if not exists (select 1 from public.push_subs where uid = any(p_uids)) then return; end if;
  perform net.http_post(
    url := c.push_url,
    body := jsonb_build_object('edificio_id', p_edificio, 'uids', to_jsonb(p_uids), 'titulo', p_titulo, 'cuerpo', coalesce(p_cuerpo, ''), 'url', p_url),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', coalesce(c.push_secret, '')));
exception when others then
  raise warning 'push no enviado: %', sqlerrm;   -- un fallo de notificación nunca bloquea la operación
end $$;

create or replace function privado.usuarios_de(p_edificio uuid, p_roles rol_t[], p_depto text default null, p_empresa uuid default null, p_excepto uuid default null) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.usuarios
  where edificio_id = p_edificio and estado = 'activo' and rol = any(p_roles)
    and (p_depto is null or depto = p_depto)
    and (p_empresa is null or empresa_id = p_empresa)
    and (p_excepto is null or id <> p_excepto)
$$;

create or replace function privado.tg_push_encomienda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{residente,propietario}', new.depto),
    '📦 Tienes una encomienda', concat_ws(' · ', new.descripcion, nullif(new.courier, '')), '#encomiendas');
  return null;
end $$;

create or replace function privado.tg_push_mensaje() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversaciones;
begin
  select * into c from public.conversaciones where edificio_id = new.edificio_id and id = new.conv_id;
  if not found then return null; end if;
  if new.rol in ('residente','propietario') then
    perform privado.push(new.edificio_id,
      array(select id from public.usuarios where edificio_id = new.edificio_id and estado = 'activo' and id <> new.uid and public.canal_de_rol(rol) = c.canal),
      '💬 Depto ' || c.depto, left(new.texto, 140), '#mensajes');
  else
    perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{residente,propietario}', c.depto, null, new.uid),
      '💬 ' || case c.canal when 'conserjeria' then 'Conserjería' when 'comite' then 'Comité' else 'Administración' end,
      left(new.texto, 140), '#mensajes');
  end if;
  return null;
end $$;

create or replace function privado.tg_push_reserva() returns trigger
language plpgsql security definer set search_path = public as $$
declare det text := new.espacio_nombre || ' · ' || to_char(new.fecha, 'DD/MM') || ' ' || lpad(new.h_ini::text, 2, '0') || ':00';
begin
  if tg_op = 'INSERT' and new.estado = 'pendiente' then
    perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{comite,admin}', null, null, new.uid),
      '📅 Reserva por aprobar', 'Depto ' || new.depto || ' · ' || det, '#reservas');
  elsif tg_op = 'UPDATE' and old.estado = 'pendiente' and new.estado in ('aprobada','rechazada') then
    perform privado.push(new.edificio_id, array[new.uid],
      case new.estado when 'aprobada' then '✅ Reserva aprobada' else '❌ Reserva rechazada' end,
      concat_ws(' · ', det, nullif(new.motivo_rechazo, '')), '#reservas');
  end if;
  return null;
end $$;

create or replace function privado.tg_push_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'pendiente' then
    perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{admin}'),
      '👤 Solicitud de acceso por aprobar', concat_ws(' · ', new.nombre, nullif(new.depto, '')), '#admin--usuarios');
  end if;
  return null;
end $$;

create or replace function privado.tg_push_ot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.empresa_id is distinct from old.empresa_id then
    if new.empresa_id is not null then
      perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{mantencion}', null, new.empresa_id),
        '🔧 Nueva orden de trabajo', new.titulo, '#mantencion--' || new.id);
    end if;
  elsif new.estado is distinct from old.estado then
    if new.estado = 'cierre_tecnico' then
      perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{admin}'),
        '🔧 Orden de trabajo por aprobar', new.titulo, '#mantencion--' || new.id);
    elsif new.estado = 'rechazada' then
      perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{admin}'),
        '🔧 La empresa rechazó la orden', new.titulo, '#mantencion--' || new.id);
    elsif new.estado = 'aprobada' and new.empresa_id is not null then
      perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{mantencion}', null, new.empresa_id),
        '✅ Orden de trabajo aprobada', new.titulo, '#mantencion--' || new.id);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists push_encomienda on public.encomiendas;
create trigger push_encomienda after insert on public.encomiendas for each row execute function privado.tg_push_encomienda();
drop trigger if exists push_mensaje on public.mensajes;
create trigger push_mensaje after insert on public.mensajes for each row execute function privado.tg_push_mensaje();
drop trigger if exists push_reserva on public.reservas;
create trigger push_reserva after insert or update on public.reservas for each row execute function privado.tg_push_reserva();
drop trigger if exists push_usuario on public.usuarios;
create trigger push_usuario after insert on public.usuarios for each row execute function privado.tg_push_usuario();
drop trigger if exists push_ot on public.ot;
create trigger push_ot after insert or update on public.ot for each row execute function privado.tg_push_ot();

-- ---------------------------------------------------------------------
-- Conservación de datos: borra lo que supera el plazo que definió la administración del edificio
-- ---------------------------------------------------------------------
create or replace function privado.meses(r jsonb, k text) returns int
language sql immutable as $$
  select case when (r->>k) ~ '^[0-9]{1,3}$' then (r->>k)::int else 0 end
$$;

create or replace function privado.encolar_archivos(p_e uuid, p_paths text[]) returns void
language sql security definer set search_path = public as $$
  insert into public.archivos_por_borrar (edificio_id, path)
  select p_e, x from unnest(coalesce(p_paths, '{}')) x where coalesce(x, '') <> ''
$$;

create or replace function privado.depurar_edificio(p_e uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; m int; n int; res jsonb := '{}'; rec record; ps text[];
begin
  select retencion into r from public.edificios where id = p_e;
  if r is null then return res; end if;

  m := privado.meses(r, 'visitas');
  if m > 0 then
    delete from public.visitas where edificio_id = p_e and fecha < (public.hoy() - make_interval(months => m))::date;
    get diagnostics n = row_count; res := res || jsonb_build_object('visitas', n);
  end if;

  m := privado.meses(r, 'registros');
  if m > 0 then
    with d as (delete from public.registros where edificio_id = p_e and ts < now() - make_interval(months => m) returning foto)
    select count(*), array_agg(foto) into n, ps from d;
    perform privado.encolar_archivos(p_e, ps); res := res || jsonb_build_object('registros', n);
  end if;

  m := privado.meses(r, 'encomiendas');
  if m > 0 then
    with d as (delete from public.encomiendas where edificio_id = p_e and entregado and entregado_at < now() - make_interval(months => m) returning foto)
    select count(*), array_agg(foto) into n, ps from d;
    perform privado.encolar_archivos(p_e, ps); res := res || jsonb_build_object('encomiendas', n);
  end if;

  m := privado.meses(r, 'mensajes');
  if m > 0 then
    delete from public.mensajes where edificio_id = p_e and ts < now() - make_interval(months => m);
    get diagnostics n = row_count; res := res || jsonb_build_object('mensajes', n);
    delete from public.conversaciones c where c.edificio_id = p_e and c.ultimo_ts < now() - make_interval(months => m)
      and not exists (select 1 from public.mensajes x where x.edificio_id = c.edificio_id and x.conv_id = c.id);
  end if;

  m := privado.meses(r, 'reservas');
  if m > 0 then
    delete from public.reservas where edificio_id = p_e and fecha < (public.hoy() - make_interval(months => m))::date;
    get diagnostics n = row_count; res := res || jsonb_build_object('reservas', n);
  end if;

  m := privado.meses(r, 'incidencias');
  if m > 0 then
    n := 0;
    for rec in delete from public.incidencias where edificio_id = p_e and estado = 'cerrada' and ts < now() - make_interval(months => m) returning fotos, historial
    loop
      n := n + 1;
      perform privado.encolar_archivos(p_e, rec.fotos);
      perform privado.encolar_archivos(p_e, array(
        select jsonb_array_elements_text(h->'fotos') from jsonb_array_elements(rec.historial) h where jsonb_typeof(h->'fotos') = 'array'));
    end loop;
    res := res || jsonb_build_object('incidencias', n);
  end if;
  return res;
end $$;

-- Todos los edificios (tarea diaria). Un error en un edificio no detiene a los demás.
create or replace function privado.depurar() returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  for e in select id from public.edificios where retencion <> '{}'::jsonb loop
    begin
      perform privado.depurar_edificio(e.id);
    exception when others then
      raise warning 'depurar %: %', e.id, sqlerrm;
    end;
  end loop;
end $$;

-- Botón "Aplicar ahora" de la administración
create or replace function public.depurar_ahora() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo administración'; end if;
  return privado.depurar_edificio(public.mi_edificio());
end $$;

-- Ejecución diaria con pg_cron (07:23 UTC, madrugada en Chile)
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('mi-edificio-depurar', '23 7 * * *', 'select privado.depurar()');
exception when others then
  raise notice 'pg_cron no disponible: el borrado por plazo solo corre con el botón "Aplicar ahora" de la administración';
end $$;

-- Registrar el navegador de quien llama para recibir notificaciones
create or replace function public.guardar_push(p_endpoint text, p_p256dh text, p_auth text, p_ua text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.mi_edificio() is null then raise exception 'Sin permiso'; end if;
  if p_endpoint !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Suscripción no válida'; end if;
  delete from public.push_subs where endpoint = p_endpoint;
  delete from public.push_subs where id in (select id from public.push_subs where uid = auth.uid() order by creado desc offset 9);
  insert into public.push_subs (edificio_id, uid, endpoint, p256dh, auth, ua)
  values (public.mi_edificio(), auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_ua, ''), 200));
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.edificios      enable row level security;
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
alter table public.encuestas      enable row level security;
alter table public.votos          enable row level security;
alter table public.push_subs      enable row level security;
alter table public.archivos_por_borrar enable row level security;

-- helper para (re)crear políticas sin errores. Salvo que se indique lo contrario, toda
-- política queda además limitada a las filas del edificio del usuario.
drop function if exists public._pol(text, text, text, text, text);
create or replace function public._pol(tbl text, nombre text, cmd text, usando text, con text default null, por_edificio boolean default true) returns void
language plpgsql as $$
declare pre text := case when por_edificio then 'edificio_id = public.mi_edificio() and ' else '' end;
begin
  execute format('drop policy if exists %I on public.%I', nombre, tbl);
  if cmd = 'insert' then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s(%s))', nombre, tbl, pre, coalesce(con, usando));
  elsif cmd = 'update' then
    execute format('create policy %I on public.%I for update to authenticated using (%s(%s)) with check (%s(%s))', nombre, tbl, pre, usando, pre, coalesce(con, usando));
  else
    execute format('create policy %I on public.%I for %s to authenticated using (%s(%s))', nombre, tbl, cmd, pre, usando);
  end if;
end $$;

-- edificios: cada cuenta lee el suyo (aunque esté pendiente); su admin lo edita.
-- Se crean solo con crear_edificio().
select public._pol('edificios','edi_sel','select','id = public.mi_edificio_asignado()', null, false);
select public._pol('edificios','edi_upd','update','id = public.mi_edificio() and public.es_admin()', null, false);

-- empresas: todos activos leen; admin escribe
select public._pol('empresas','emp_sel','select','public.mi_rol() is not null');
select public._pol('empresas','emp_ins','insert','public.es_admin()');
select public._pol('empresas','emp_upd','update','public.es_admin()');
select public._pol('empresas','emp_del','delete','public.es_admin()');

-- usuarios: cada uno ve el suyo; staff ve todos; mantención ve a sus colegas; insert propio; update por trigger
-- (residentes ven además a conserjes/comité/admin para mostrar nombres en chats e historiales)
-- (su propia fila se ve siempre, también pendiente; por eso estas políticas llevan el edificio a mano)
select public._pol('usuarios','usu_sel','select','id = auth.uid() or (edificio_id = public.mi_edificio() and (public.es_staff() or (public.mi_rol() is not null and rol in (''conserje'',''comite'',''admin'')) or (public.mi_rol() = ''mantencion'' and empresa_id = public.mi_empresa())))', null, false);
select public._pol('usuarios','usu_ins','insert','id = auth.uid() or (public.es_admin() and edificio_id = public.mi_edificio())', null, false);
select public._pol('usuarios','usu_upd','update','id = auth.uid() or (public.es_admin() and edificio_id = public.mi_edificio())', null, false);
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
select public._pol('mensajes','msg_sel','select','exists (select 1 from public.conversaciones c where c.edificio_id = mensajes.edificio_id and c.id = mensajes.conv_id)');
select public._pol('mensajes','msg_ins','insert','uid = auth.uid() and exists (select 1 from public.conversaciones c where c.edificio_id = mensajes.edificio_id and c.id = mensajes.conv_id)');

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
select public._pol('visitas','vis_ins','insert','(public.es_residente() and depto = public.mi_depto() and uid = auth.uid() and estado = ''anunciada'' and ingreso_at is null) or public.mi_rol() in (''conserje'',''admin'')');
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

-- encuestas: residentes, comité y admin leen; comité/admin crean, cierran y eliminan
select public._pol('encuestas','enc_sel','select','public.mi_rol() in (''residente'',''propietario'',''comite'',''admin'')');
select public._pol('encuestas','enc_ins','insert','public.mi_rol() in (''comite'',''admin'')');
select public._pol('encuestas','enc_upd','update','public.mi_rol() in (''comite'',''admin'')');
select public._pol('encuestas','enc_del','delete','public.mi_rol() in (''comite'',''admin'')');
-- votos: cada unidad ve y emite solo el suyo; los totales salen de resultados_encuestas()
select public._pol('votos','vot_sel','select','depto = public.mi_depto()');
select public._pol('votos','vot_ins','insert','uid = auth.uid() and length(depto) > 0 and depto = public.mi_depto() and public.puede_votar(encuesta_id, opcion)');
select public._pol('votos','vot_upd','update','depto = public.mi_depto()','uid = auth.uid() and length(depto) > 0 and depto = public.mi_depto() and public.puede_votar(encuesta_id, opcion)');

-- push_subs: cada usuario ve y borra las suyas; se guardan con guardar_push()
select public._pol('push_subs','push_sel','select','uid = auth.uid()');
select public._pol('push_subs','push_del','delete','uid = auth.uid()');

-- archivos_por_borrar: la administración los lee y los quita de la cola al borrarlos del bucket
select public._pol('archivos_por_borrar','apb_sel','select','public.es_admin()');
select public._pol('archivos_por_borrar','apb_del','delete','public.es_admin()');

drop function public._pol(text, text, text, text, text, boolean);

-- ---------------------------------------------------------------------
-- Storage: bucket "fotos", de lectura pública por URL (logo, incidencias, rondas, documentos)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('fotos','fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "fotos_read"   on storage.objects;
drop policy if exists "fotos_insert" on storage.objects;
drop policy if exists "fotos_delete" on storage.objects;
-- Los archivos se abren por su URL pública (bucket público). Esta política solo controla el
-- LISTADO vía API: cada edificio lista su carpeta; nadie puede enumerar el bucket completo.
create policy "fotos_read"   on storage.objects for select to authenticated using (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mi_edificio()::text);
-- Los archivos de cada edificio viven bajo la carpeta <edificio_id>/
create policy "fotos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mi_edificio()::text);
create policy "fotos_delete" on storage.objects for delete to authenticated using (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mi_edificio()::text and public.mi_rol() in ('admin','comite'));

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['edificios','empresas','usuarios','unidades','gastos','gasto_unidades','reservas','incidencias','conversaciones','mensajes','comunicados','documentos','encomiendas','visitas','activos','registros','ot','encuestas','votos']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Listo. Siguiente paso: crea tu cuenta desde la app y crea el edificio (quedarás como su administrador).
