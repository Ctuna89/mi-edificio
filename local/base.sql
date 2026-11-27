-- Base del modo local: lo que en Supabase viene de fábrica y aquí provee el servidor
-- (local/server.mjs). Se ejecuta en cada arranque, antes de supabase/schema.sql.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;

-- Cuentas y sesiones. Solo el servidor las lee: los usuarios de la app no tienen permiso.
create schema if not exists auth;
create table if not exists auth.users (
  id     uuid primary key default gen_random_uuid(),
  email  text not null unique,
  clave  text not null,                  -- scrypt: sal:hash
  creado timestamptz default now()
);
-- Verificación en dos pasos (voluntaria): secreto TOTP cifrado, códigos de respaldo (sha256) y el último
-- intervalo usado, para que un código no sirva dos veces
alter table auth.users add column if not exists totp_secreto text;
alter table auth.users add column if not exists totp_pendiente text;
alter table auth.users add column if not exists totp_activo boolean not null default false;
alter table auth.users add column if not exists totp_respaldo text[] not null default '{}';
alter table auth.users add column if not exists totp_paso bigint not null default 0;
create table if not exists auth.sesiones (
  token_hash text primary key,           -- sha256 del token de la cookie
  user_id    uuid not null references auth.users(id) on delete cascade,
  expira     timestamptz not null,
  creado     timestamptz default now()
);
-- El servidor fija este valor al inicio de cada petición, con el usuario de la sesión
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Archivos: los bytes viven en la carpeta datos/archivos; esta tabla lleva el registro y
-- sobre ella se aplican las políticas de schema.sql (quién puede subir, leer y borrar).
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name      text not null unique,
  creado    timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- Avisos push: schema.sql los "envía" con net.http_post; aquí quedan en una cola que el
-- servidor despacha después de cada operación.
create schema if not exists net;
create table if not exists net.cola (id bigserial primary key, body jsonb, creado timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint
language sql security definer as $$ insert into net.cola (body) values (body) returning id $$;

do $$ begin create publication supabase_realtime; exception when others then null; end $$;

grant usage on schema public, auth, storage to anon, authenticated;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;
grant all on storage.objects, storage.buckets to authenticated;
