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
-- Una instalación = un edificio. La fila única de esta tabla guarda su configuración.
-- (Las tablas conservan la columna edificio_id y las políticas la comparan con
-- public.mi_edificio(); es un detalle interno: la base de datos no admite un segundo edificio.)
create table if not exists public.edificios (
  id            uuid primary key default gen_random_uuid(),
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
  visita_patente boolean not null default false,     -- exigir patente a visitas con estacionamiento
  est_alerta_min int not null default 0,             -- estacionamiento de visita: minutos para avisar al residente
  est_aviso_min  int not null default 0,             -- ... y para informar a administración y comité
  configurado_at timestamptz,                        -- cuándo se completó el asistente de configuración inicial
  creado_por    uuid,
  creado        timestamptz default now(),
  actualizado   timestamptz default now()
);
alter table public.edificios add column if not exists privacidad text default '';
alter table public.edificios add column if not exists medidores jsonb not null default '[]'::jsonb;   -- tipos de medidor: [{id, nombre, unidad}]
-- Feriados de Chile (editables) para los plazos en días hábiles; sábado y domingo nunca cuentan.
alter table public.edificios add column if not exists feriados jsonb not null default jsonb_build_array('2026-01-01','2026-04-03','2026-04-04','2026-05-01','2026-05-21','2026-06-21','2026-06-29','2026-07-16','2026-08-15','2026-09-18','2026-09-19','2026-10-12','2026-10-31','2026-11-01','2026-12-08','2026-12-25','2027-01-01','2027-03-26','2027-03-27','2027-05-01','2027-05-21','2027-06-21','2027-06-28','2027-07-16','2027-08-15','2027-09-18','2027-09-19','2027-10-11','2027-10-31','2027-11-01','2027-12-08','2027-12-25');
-- Procedimiento de multas: plazos en días hábiles, aprobaciones del comité (0 = no se requieren) y destino del cobro
alter table public.edificios add column if not exists multas jsonb not null default
  '{"plazo_decision":5,"plazo_descargos":5,"aprobaciones_comite":1,"destino":"fondo_reserva"}'::jsonb;
alter table public.edificios add column if not exists mora_tasa numeric(6,3) not null default 0;   -- interés por mora, % mensual (0 = no se cobra)
alter table public.edificios add column if not exists mora_desde date;                             -- la mora se cuenta desde esta fecha (o desde el vencimiento, si es posterior)
alter table public.edificios drop column if exists codigo;   -- los códigos de invitación eran de la versión multi-edificio
-- Un solo edificio por instalación
do $$ begin
  if (select count(*) from public.edificios) > 1 then
    raise notice 'Esta instalación tiene más de un edificio (versión anterior). Se conservan, pero no se podrán crear más.';
  else
    create unique index if not exists edificios_unico on public.edificios ((true));
  end if;
end $$;
-- Asistente de configuración inicial: los edificios que ya existían se dan por configurados
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'edificios' and column_name = 'configurado_at') then
    alter table public.edificios add column configurado_at timestamptz;
    update public.edificios set configurado_at = now();
  end if;
end $$;
-- true: una visita que necesita estacionamiento debe indicar su patente (p. ej. acceso con lectura de patentes, LPR)
alter table public.edificios add column if not exists visita_patente boolean not null default false;
-- Estacionamientos de visita: minutos tras los cuales se avisa al residente y, después, a
-- administración y comité (0 = sin aviso)
alter table public.edificios add column if not exists est_alerta_min int not null default 0;
alter table public.edificios add column if not exists est_aviso_min int not null default 0;
-- Plazos de conservación en meses, definidos por la administración de cada edificio.
-- Claves: visitas, registros, encomiendas, mensajes, reservas, incidencias, estacionamientos. Sin clave o 0 = no se borra.
alter table public.edificios add column if not exists retencion jsonb not null default '{}'::jsonb;

-- Ajustes de la instalación (1 fila). Sin políticas RLS: solo se edita desde el SQL Editor.
create table if not exists public.plataforma (
  id               int primary key default 1 check (id = 1),
  push_url         text default '',                 -- URL de la Edge Function "push"
  push_secret      text default ''                  -- mismo valor que el secreto PUSH_SECRET de la función
);
alter table public.plataforma drop column if exists creacion_abierta;
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
  pagado    boolean not null default false,   -- lo calcula la base de datos a partir de los pagos
  pagado_at timestamptz,
  pagado_monto numeric(14,2) not null default 0,  -- suma de pagos aplicados a este cobro
  convenio_id uuid,                               -- convenio de pago que incluye este cobro
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
  estacionamiento boolean not null default false,   -- la visita necesita estacionamiento
  fecha      date not null,
  hora       text default '',
  nota       text default '',
  estado     text not null default 'anunciada', -- anunciada|ingreso|salida|no_llego
  codigo     text not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)), -- va en el QR de acceso
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
-- sondeo: un voto por unidad, solo se ven los totales.
-- asamblea: el voto pesa según la alícuota de la unidad y es nominal (se ve qué votó cada unidad).
alter table public.encuestas add column if not exists tipo text not null default 'sondeo';

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

-- Estacionamientos de visita y su ocupación (un uso abierto = fin nulo)
create table if not exists public.estacionamientos (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  nombre      text not null,
  reservado   text default '',          -- p. ej. 'Discapacidad'; vacío = uso general
  orden       int default 0,
  creado      timestamptz default now()
);

create table if not exists public.estacionamiento_usos (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  estacionamiento_id uuid references public.estacionamientos(id) on delete set null,
  est_nombre  text default '',          -- copia del nombre, para el historial
  depto       text not null default '',
  patente     text default '',
  visita_id   uuid references public.visitas(id) on delete set null,
  nota        text default '',
  inicio      timestamptz not null default now(),
  fin         timestamptz,
  registrado_por uuid references public.usuarios(id),
  liberado_por   uuid,
  alerta_residente_at timestamptz,      -- cuándo se avisó al residente
  aviso_admin_at      timestamptz       -- cuándo se informó a administración y comité
);
create unique index if not exists est_usos_abierto_idx on public.estacionamiento_usos (estacionamiento_id) where fin is null;

-- Convenios de pago: acuerdo entre la administración y una unidad para saldar cobros
-- atrasados en cuotas. propuesto → vigente (al aceptarlo) → cumplido; o anulado.
create table if not exists public.convenios (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  depto       text not null,
  periodos    text[] not null default '{}',     -- períodos de gastos comunes incluidos
  monto_total numeric(14,2) not null,
  cuotas      int not null,
  nota        text default '',
  estado      text not null default 'propuesto',
  creado_por  uuid references public.usuarios(id),
  ts          timestamptz default now(),
  aceptado_at timestamptz,
  aceptado_por uuid,
  anulado_at  timestamptz,
  anulado_motivo text
);

create table if not exists public.convenio_cuotas (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  convenio_id uuid not null references public.convenios(id) on delete cascade,
  depto       text not null,
  n           int not null,
  vence       date not null,
  monto       numeric(14,2) not null,
  pagado_monto numeric(14,2) not null default 0
);

-- Pagos registrados a mano por la administración. Cada pago va a un período o a un convenio.
-- No se editan ni se borran: se anulan.
create table if not exists public.pagos (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  depto       text not null,
  periodo     text,
  convenio_id uuid references public.convenios(id),
  monto       numeric(14,2) not null check (monto > 0),
  fecha       date not null default current_date,
  medio       text not null default 'transferencia',  -- transferencia|efectivo|cheque|otro
  referencia  text default '',
  nota        text default '',
  anulado     boolean not null default false,
  anulado_motivo text,
  registrado_por uuid references public.usuarios(id),
  ts          timestamptz default now(),
  check ((periodo is null) <> (convenio_id is null))
);
create index if not exists pagos_depto_idx on public.pagos (depto);

-- Otros movimientos de caja (egresos reales y otros ingresos) para el flujo de caja
create table if not exists public.caja_movimientos (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  tipo        text not null check (tipo in ('ingreso','egreso')),
  fecha       date not null default current_date,
  categoria   text not null default '',
  descripcion text default '',
  monto       numeric(14,2) not null check (monto > 0),
  registrado_por uuid references public.usuarios(id),
  ts          timestamptz default now()
);

-- Lecturas de medidores individuales (agua caliente, calefacción, gas…) por período. Cada mes se anota
-- el número que marca el medidor; el consumo es la diferencia con la lectura del mes anterior.
-- Si en el período se cambió el medidor, el consumo suma los dos tramos:
--   (última lectura del medidor retirado − lectura del mes anterior) + (lectura actual − lectura inicial del nuevo)
-- Con ellas se reparten los ítems "según consumo". El consumo nunca es negativo.
create table if not exists public.lecturas (
  edificio_id uuid references public.edificios(id) on delete cascade,
  periodo     text not null,                -- 'YYYY-MM', el período de gastos comunes en que se cobra
  medidor     text not null,                -- id del tipo de medidor (edificios.medidores)
  depto       text not null,
  anterior    numeric(14,3) not null,       -- lectura del mes anterior: la pone el trigger (solo la primera se ingresa)
  actual      numeric(14,3) not null,
  nota        text default '',
  registrado_por uuid references public.usuarios(id),
  ts          timestamptz default now(),
  primary key (edificio_id, periodo, medidor, depto)
);
alter table public.lecturas add column if not exists cambio boolean not null default false;     -- se cambió el medidor en el período
alter table public.lecturas add column if not exists final_retirado numeric(14,3);              -- última lectura del medidor retirado
alter table public.lecturas add column if not exists inicial_nuevo numeric(14,3) not null default 0;  -- lectura del medidor nuevo al instalarlo
alter table public.lecturas add column if not exists consumo numeric(14,3) generated always as (
  case when cambio then (coalesce(final_retirado, anterior) - anterior) + (actual - inicial_nuevo) else actual - anterior end) stored;
alter table public.lecturas drop constraint if exists lecturas_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lecturas_sin_negativos') then
    alter table public.lecturas add constraint lecturas_sin_negativos check (
      case when cambio then final_retirado is not null and final_retirado >= anterior and actual >= inicial_nuevo else actual >= anterior end);
  end if;
end $$;

-- Fondos (reserva, mantención, otros). Se provisionan con ítems del gasto común marcados con items[].fondo
-- (al publicar el período se anota el aporte) y se usan con movimientos registrados por la administración.
create table if not exists public.fondos (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  nombre      text not null,
  reserva     boolean not null default false,       -- es el fondo común de reserva que exige la ley
  pct         numeric(6,2) not null default 0,      -- aporte sugerido, % sobre los gastos del período
  saldo_inicial numeric(14,2) not null default 0,
  descripcion text default '',
  activo      boolean not null default true,
  creado      timestamptz default now()
);
create table if not exists public.fondo_movimientos (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  fondo_id    uuid not null references public.fondos(id) on delete cascade,
  tipo        text not null check (tipo in ('aporte','uso','ajuste')),
  fecha       date not null default current_date,
  monto       numeric(14,2) not null,               -- positivo; un ajuste puede ser negativo
  descripcion text default '',
  periodo     text,                                 -- aportes automáticos: el período de gastos comunes que los cobró
  caja_id     uuid references public.caja_movimientos(id) on delete set null,
  registrado_por uuid references public.usuarios(id),
  ts          timestamptz default now()
);

-- Cargos individuales: multas, arriendo de espacios comunes y otros cobros a una unidad. Se suman a su
-- gasto común del período indicado. No se borran: se anulan (condonación) o se rebajan, con motivo.
create table if not exists public.cargos (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  depto       text not null,
  periodo     text not null,
  tipo        text not null default 'otro' check (tipo in ('multa','arriendo','otro')),
  descripcion text not null default '',
  monto       numeric(14,2) not null check (monto >= 0),
  monto_original numeric(14,2),
  estado      text not null default 'vigente' check (estado in ('vigente','anulado')),
  motivo      text,                                  -- de la rebaja o la anulación
  reserva_id  uuid references public.reservas(id) on delete set null,
  registrado_por uuid references public.usuarios(id),
  ts          timestamptz default now()
);
create unique index if not exists cargos_reserva_idx on public.cargos (reserva_id) where reserva_id is not null and estado = 'vigente';

-- Multas con debido proceso (adaptado del módulo E2 de CactusOne). Solo se aplican multas del catálogo, en
-- UTM o UF. Un caso pasa por: apertura con la evidencia → cargos (conducta del catálogo, notificación escrita)
-- → descargos dentro del plazo → resolución fundada (absolver o sancionar) → aprobación del comité si así se
-- configura → cargo en el gasto común de la unidad. Los casos y su historial son permanentes.
create table if not exists public.indicadores (
  edificio_id uuid references public.edificios(id) on delete cascade,
  codigo      text not null check (codigo in ('UTM','UF')),
  desde       date not null,
  valor       numeric(12,2) not null check (valor > 0),
  primary key (edificio_id, codigo, desde)
);
create table if not exists public.multas_catalogo (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  conducta    text not null,
  articulo    text not null default '',
  categoria   text check (categoria in ('leve','grave','gravisima')),   -- para subir de categoría si reincide
  monto       numeric(6,2),
  unidad      text not null default 'UTM' check (unidad in ('UTM','UF')),
  por_evento  boolean not null default false,
  permanente  boolean not null default false,   -- se repite cada mes hasta restituir
  jpl         boolean not null default false,   -- la conoce el Juzgado de Policía Local, no el comité
  evidencia   text,                             -- evidencia mínima exigida
  nota        text,
  plantilla   text not null default '',         -- borrador de la notificación de cargos
  retirado    date,
  creado      timestamptz default now(),
  check (jpl or coalesce(monto, 0) > 0)
);
create table if not exists public.infracciones (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  folio       int not null,
  depto       text,
  origen      text not null default 'administracion' check (origen in ('administracion','comite','conserjeria','estacionamiento','reclamo')),
  descripcion text not null,
  evidencias  text[] not null default '{}',
  estado      text not null default 'abierto' check (estado in ('abierto','cargos','en_comite','resuelto','absuelto','archivado','derivado_jpl')),
  decidir_antes date not null,
  catalogo_id uuid references public.multas_catalogo(id),
  cargos_texto text,
  cargos_at   timestamptz,
  descargos_hasta date,
  descargos_texto text,
  descargos_at timestamptz,
  descargos_fotos text[] not null default '{}',
  reincidencia boolean not null default false,
  resolucion_texto text,
  resuelto_at timestamptz,
  resuelto_por uuid,
  ronda       int not null default 0,           -- veces que pasó al comité
  multa_monto numeric(8,2),
  multa_unidad text check (multa_unidad in ('UTM','UF')),
  multa_clp   numeric(14,0),
  restituir_antes date,
  restituido_el date,
  creado_por  uuid default auth.uid(),
  ts          timestamptz default now(),
  unique (edificio_id, folio)
);
create table if not exists public.infraccion_eventos (
  id          uuid primary key default gen_random_uuid(),
  edificio_id uuid references public.edificios(id) on delete cascade,
  infraccion_id uuid not null references public.infracciones(id) on delete cascade,
  tipo        text not null check (tipo in ('apertura','evidencia','cargos','descargos','resolucion','voto','cobro','derivacion','restitucion','archivo')),
  texto       text,
  fotos       text[] not null default '{}',
  uid         uuid default auth.uid(),
  ts          timestamptz default now()
);
create table if not exists public.infraccion_votos (
  infraccion_id uuid not null references public.infracciones(id) on delete cascade,
  edificio_id uuid references public.edificios(id) on delete cascade,
  ronda       int not null,
  uid         uuid not null default auth.uid(),
  aprueba     boolean not null,
  comentario  text,
  ts          timestamptz default now(),
  primary key (infraccion_id, ronda, uid)
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
      execute 'insert into public.edificios (nombre,direccion,comuna,telefono,email,logo,color,datos_bancarios,espacios,configurado_at)
               select nombre,direccion,comuna,telefono,email,logo,color,datos_bancarios,espacios,now() from public.config where id = 1';
    end if;
    begin
      execute 'alter publication supabase_realtime drop table public.config';
    exception when others then null;
    end;
    execute 'drop table public.config';
  end if;

  select id into def from public.edificios order by creado, id limit 1;
  foreach t in array array['empresas','usuarios','unidades','gastos','gasto_unidades','reservas','incidencias','conversaciones','mensajes','comunicados','documentos','encomiendas','visitas','activos','registros','ot','encuestas','votos','push_subs','archivos_por_borrar','estacionamientos','estacionamiento_usos','pagos','convenios','convenio_cuotas','caja_movimientos','lecturas','fondos','fondo_movimientos','cargos','indicadores','multas_catalogo','infracciones','infraccion_eventos','infraccion_votos']
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

-- Registro de pagos: los cobros que ya estaban marcados como pagados pasan a tener su pago
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gasto_unidades' and column_name = 'pagado_monto') then
    alter table public.gasto_unidades add column pagado_monto numeric(14,2) not null default 0, add column convenio_id uuid;
    insert into public.pagos (edificio_id, depto, periodo, monto, fecha, medio, nota)
    select edificio_id, depto, periodo, monto, coalesce(pagado_at::date, current_date), 'otro', 'Pago marcado antes de existir el registro de pagos'
    from public.gasto_unidades where pagado and monto > 0;
    update public.gasto_unidades set pagado_monto = monto where pagado;
  end if;
end $$;

-- Interés por mora. interes: null = se calcula al día; con valor = quedó fijo cuando se pagó el capital.
-- Los cobros que ya estaban pagados antes de existir esta función quedan sin interés.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'gasto_unidades' and column_name = 'interes') then
    alter table public.gasto_unidades add column interes numeric(14,2), add column interes_pagado numeric(14,2) not null default 0;
    update public.gasto_unidades set interes = 0 where pagado;
  end if;
end $$;
-- Desglose del cobro de cada unidad: [{i: índice del ítem, monto, consumo?}]. Vacío en períodos anteriores
-- a esta función (se repartían solo por alícuota).
alter table public.gasto_unidades add column if not exists detalle jsonb not null default '[]'::jsonb;
alter table public.cargos add column if not exists infraccion_id uuid references public.infracciones(id);
alter table public.pagos add column if not exists concepto text not null default 'gasto';   -- gasto (capital) | interes

-- Código del QR de acceso de cada visita (las visitas ya existentes reciben uno)
alter table public.visitas add column if not exists codigo text not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
create unique index if not exists visitas_codigo_idx on public.visitas (edificio_id, codigo);
alter table public.visitas add column if not exists estacionamiento boolean not null default false;

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
  foreach t in array array['empresas','unidades','gastos','gasto_unidades','reservas','incidencias','conversaciones','mensajes','comunicados','documentos','encomiendas','visitas','activos','registros','ot','encuestas','votos','push_subs','archivos_por_borrar','estacionamientos','estacionamiento_usos','pagos','convenios','convenio_cuotas','caja_movimientos','lecturas','fondos','fondo_movimientos','cargos','indicadores','multas_catalogo','infracciones','infraccion_eventos','infraccion_votos']
  loop
    execute format('alter table public.%I alter column edificio_id set default public.mi_edificio()', t);
  end loop;
end $$;

-- ¿Puede esta cuenta crear el edificio? Solo si la instalación aún no tiene uno.
create or replace function public.puede_crear_edificio() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not exists (select 1 from public.edificios)
$$;

-- El edificio de la instalación, para que una cuenta nueva pueda pedir acceso
drop function if exists public.buscar_edificio(text);
create or replace function public.buscar_edificio()
returns table (id uuid, nombre text, logo text, color text, email text, privacidad text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.logo, e.color, e.email, e.privacidad
  from public.edificios e
  where auth.uid() is not null
  order by e.creado, e.id limit 1
$$;

-- Crea el edificio de la instalación y deja a quien lo crea como su administrador activo.
create or replace function public.crear_edificio(p_edificio text, p_nombre text, p_telefono text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if exists (select 1 from public.usuarios where id = auth.uid()) then raise exception 'Tu cuenta ya pertenece a un edificio'; end if;
  if not public.puede_crear_edificio() then raise exception 'Esta instalación ya tiene su edificio'; end if;
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
declare esp jsonb; blq text;
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
    -- bloqueos recurrentes del espacio (aseo, mantención): [{dias:[0-6, 0 = domingo], desde, hasta, motivo}]
    if jsonb_typeof(esp->'bloqueos') = 'array' then
      select coalesce(nullif(b->>'motivo', ''), 'no disponible') into blq from jsonb_array_elements(esp->'bloqueos') b
      where jsonb_typeof(b->'dias') = 'array' and (b->'dias') @> to_jsonb(extract(dow from new.fecha)::int)
        and (b->>'desde')::int < new.h_fin and new.h_ini < (b->>'hasta')::int limit 1;
      if blq is not null then raise exception 'Ese horario está bloqueado: %', blq; end if;
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

-- Visitas: el código del QR lo genera siempre la base de datos. La patente se guarda normalizada
-- (mayúsculas, solo letras y números) y es obligatoria con estacionamiento si el edificio lo exige.
create or replace function public.visitas_antes_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.patente := upper(regexp_replace(coalesce(new.patente, ''), '[^A-Za-z0-9]', '', 'g'));
  if new.estacionamiento and new.patente = ''
     and coalesce((select visita_patente from public.edificios where id = new.edificio_id), false) then
    raise exception 'Indica la patente del vehículo: el edificio la exige para usar estacionamiento de visitas';
  end if;
  if auth.uid() is not null then new.codigo := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)); end if;
  return new;
end $$;
drop trigger if exists visitas_antes_insert on public.visitas;
create trigger visitas_antes_insert before insert on public.visitas
for each row execute function public.visitas_antes_insert();

-- Uso de estacionamientos: la hora de inicio y de término las pone la base de datos, y los
-- avisos solo los marca la revisión periódica (privado.revisar_estacionamientos)
create or replace function public.est_usos_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.estacionamientos;
begin
  if auth.uid() is null or current_setting('mi_edificio.interno', true) = '1' then return new; end if;
  if tg_op = 'INSERT' then
    select * into e from public.estacionamientos where id = new.estacionamiento_id and edificio_id = new.edificio_id;
    if not found then raise exception 'Estacionamiento no válido'; end if;
    if exists (select 1 from public.estacionamiento_usos where estacionamiento_id = e.id and fin is null) then
      raise exception 'Ese estacionamiento ya está ocupado';
    end if;
    if coalesce(trim(new.depto), '') = '' then raise exception 'Indica el departamento que recibe la visita'; end if;
    new.est_nombre := e.nombre; new.inicio := now(); new.fin := null; new.liberado_por := null;
    new.registrado_por := auth.uid(); new.alerta_residente_at := null; new.aviso_admin_at := null;
    new.depto := trim(new.depto); new.patente := upper(regexp_replace(coalesce(new.patente, ''), '[^A-Za-z0-9]', '', 'g'));
  else
    new.inicio := old.inicio; new.estacionamiento_id := old.estacionamiento_id; new.est_nombre := old.est_nombre;
    new.depto := old.depto; new.registrado_por := old.registrado_por;
    new.alerta_residente_at := old.alerta_residente_at; new.aviso_admin_at := old.aviso_admin_at;
    if old.fin is not null then new.fin := old.fin; new.liberado_por := old.liberado_por;
    elsif new.fin is not null then new.fin := now(); new.liberado_por := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists est_usos_antes on public.estacionamiento_usos;
create trigger est_usos_antes before insert or update on public.estacionamiento_usos
for each row execute function public.est_usos_antes();

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

-- ---------------------------------------------------------------------
-- Pagos y convenios
-- ---------------------------------------------------------------------
create schema if not exists privado;

-- Interés por mora de un cobro, calculado a una fecha: interés simple diario (tasa mensual / 30) sobre el
-- capital impago, desde el vencimiento (o desde edificios.mora_desde, si es posterior). Cada abono al
-- capital reduce la base desde su fecha. Mientras el cobro está en un convenio, deja de sumar desde el
-- día en que se propuso. (Los abonos de un convenio anulado no reducen la base: se corrige condonando.)
create or replace function privado.interes_cobro(p_e uuid, p_depto text, p_periodo text, p_hasta date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare tasa numeric; desde date; g record; p record; d date; f date; tope date; cap numeric; total numeric := 0;
begin
  select mora_tasa, mora_desde into tasa, desde from public.edificios where id = p_e;
  if coalesce(tasa, 0) <= 0 then return 0; end if;
  select u.monto, u.convenio_id, x.vence, x.publicado into g
  from public.gasto_unidades u join public.gastos x on x.edificio_id = u.edificio_id and x.periodo = u.periodo
  where u.edificio_id = p_e and u.depto = p_depto and u.periodo = p_periodo;
  if not found or g.vence is null or not g.publicado or g.monto <= 0 then return 0; end if;
  tope := p_hasta;
  if g.convenio_id is not null then
    tope := coalesce((select least(p_hasta, c.ts::date) from public.convenios c where c.id = g.convenio_id and c.estado in ('propuesto','vigente','cumplido')), p_hasta);
  end if;
  d := greatest(g.vence, coalesce(desde, g.vence)); cap := g.monto;
  for p in select fecha, monto from public.pagos
           where edificio_id = p_e and depto = p_depto and periodo = p_periodo and convenio_id is null and concepto = 'gasto' and not anulado order by fecha, ts loop
    f := least(greatest(p.fecha, d), greatest(tope, d));
    total := total + cap * tasa / 100 / 30 * (f - d); d := f; cap := greatest(cap - p.monto, 0);
  end loop;
  if cap > 0 and tope > d then total := total + cap * tasa / 100 / 30 * (tope - d); end if;
  return round(total);
end $$;

-- Intereses por mora de cada cobro: total devengado y cuánto se ha pagado o condonado.
-- Comité y administración ven todos; cada unidad, los suyos.
create or replace function public.intereses_mora()
returns table (depto text, periodo text, interes numeric, pagado numeric)
language sql stable security definer set search_path = public as $$
  select t.depto, t.periodo, t.interes, t.interes_pagado from (
    select g.depto, g.periodo, g.interes_pagado,
           coalesce(g.interes, privado.interes_cobro(g.edificio_id, g.depto, g.periodo, public.hoy())) as interes
    from public.gasto_unidades g
    where g.edificio_id = public.mi_edificio()
      and (public.mi_rol() in ('comite','admin') or (public.es_residente() and g.depto = public.mi_depto()))) t
  where t.interes > 0 or t.interes_pagado > 0
$$;

-- Recalcula cuánto está pagado de cada cobro y cuota de una unidad, a partir de sus pagos vigentes.
-- Lo abonado a un convenio se reparte entre sus períodos y sus cuotas, del más antiguo al más nuevo.
create or replace function privado.recalc_unidad(p_e uuid, p_depto text) returns void
language plpgsql security definer set search_path = public as $$
declare c record; r record; abonado numeric; rest numeric; x numeric;
begin
  update public.gasto_unidades g set pagado_monto = coalesce((
      select sum(p.monto) from public.pagos p
      where p.edificio_id = p_e and p.depto = p_depto and p.periodo = g.periodo and p.convenio_id is null and p.concepto = 'gasto' and not p.anulado), 0),
    interes_pagado = coalesce((
      select sum(p.monto) from public.pagos p
      where p.edificio_id = p_e and p.depto = p_depto and p.periodo = g.periodo and p.concepto = 'interes' and not p.anulado), 0)
  where g.edificio_id = p_e and g.depto = p_depto;

  for c in select * from public.convenios where edificio_id = p_e and depto = p_depto order by ts loop
    abonado := coalesce((select sum(monto) from public.pagos where convenio_id = c.id and not anulado), 0);
    rest := abonado;
    for r in select periodo, monto, pagado_monto from public.gasto_unidades
             where edificio_id = p_e and depto = p_depto and periodo = any(c.periodos) order by periodo loop
      x := least(rest, greatest(r.monto - r.pagado_monto, 0));
      update public.gasto_unidades set pagado_monto = pagado_monto + x where edificio_id = p_e and depto = p_depto and periodo = r.periodo;
      rest := rest - x;
    end loop;
    rest := abonado;
    for r in select id, monto from public.convenio_cuotas where convenio_id = c.id order by n loop
      x := least(rest, r.monto);
      update public.convenio_cuotas set pagado_monto = x where id = r.id;
      rest := rest - x;
    end loop;
    if c.estado = 'vigente' and abonado >= c.monto_total then update public.convenios set estado = 'cumplido' where id = c.id;
    elsif c.estado = 'cumplido' and abonado < c.monto_total then update public.convenios set estado = 'vigente' where id = c.id;
    end if;
  end loop;

  update public.gasto_unidades set
    pagado = (monto > 0 and pagado_monto >= monto),
    pagado_at = case when monto > 0 and pagado_monto >= monto then coalesce(pagado_at, now()) end,
    -- al quedar pagado el capital, el interés devengado queda fijo; si deja de estarlo, vuelve a calcularse al día
    interes = case when monto > 0 and pagado_monto >= monto
                   then coalesce(case when pagado then interes end, privado.interes_cobro(p_e, p_depto, periodo, public.hoy())) end
  where edificio_id = p_e and depto = p_depto;
end $$;

create or replace function public.pagos_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare g public.gasto_unidades; c public.convenios; saldo numeric; ret public.pagos;
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor / service role
  if tg_op = 'UPDATE' then
    if old.anulado then raise exception 'El pago ya está anulado'; end if;
    if not new.anulado then raise exception 'Un pago no se modifica: anúlalo y regístralo de nuevo'; end if;
    ret := old; ret.anulado := true; ret.anulado_motivo := new.anulado_motivo;
    return ret;
  end if;
  new.registrado_por := auth.uid(); new.anulado := false; new.anulado_motivo := null; new.depto := trim(new.depto);
  new.concepto := coalesce(new.concepto, 'gasto');
  if new.concepto not in ('gasto','interes') then raise exception 'Concepto no válido'; end if;
  if new.medio = 'condonacion' and new.concepto <> 'interes' then raise exception 'Solo se pueden condonar intereses por mora'; end if;
  if new.concepto = 'interes' then
    if new.periodo is null then raise exception 'El interés se paga por período'; end if;
    select * into g from public.gasto_unidades where edificio_id = new.edificio_id and periodo = new.periodo and depto = new.depto;
    if not found then raise exception 'Esa unidad no tiene cobro en ese período'; end if;
    saldo := coalesce(g.interes, privado.interes_cobro(new.edificio_id, new.depto, new.periodo, public.hoy())) - g.interes_pagado;
  elsif new.periodo is not null then
    select * into g from public.gasto_unidades where edificio_id = new.edificio_id and periodo = new.periodo and depto = new.depto;
    if not found then raise exception 'Esa unidad no tiene cobro en ese período'; end if;
    if exists (select 1 from public.convenios where id = g.convenio_id and estado in ('propuesto','vigente')) then
      raise exception 'Ese período está en un convenio de pago: registra el pago en el convenio';
    end if;
    saldo := case when g.pagado then 0 else g.monto - g.pagado_monto end;
  else
    select * into c from public.convenios where id = new.convenio_id and edificio_id = new.edificio_id and depto = new.depto;
    if not found then raise exception 'Convenio no válido'; end if;
    if c.estado <> 'vigente' then raise exception 'El convenio no está vigente'; end if;
    saldo := c.monto_total - coalesce((select sum(monto) from public.pagos where convenio_id = c.id and not anulado), 0);
  end if;
  if new.monto > saldo then raise exception 'El monto supera el saldo pendiente ($%)', saldo::bigint; end if;
  return new;
end $$;
drop trigger if exists pagos_antes on public.pagos;
create trigger pagos_antes before insert or update on public.pagos
for each row execute function public.pagos_antes();

create or replace function public.pagos_despues() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform privado.recalc_unidad(new.edificio_id, new.depto);
  return null;
end $$;
drop trigger if exists pagos_despues on public.pagos;
create trigger pagos_despues after insert or update on public.pagos
for each row execute function public.pagos_despues();

-- Crea un convenio por los períodos indicados: total = saldo pendiente de esos cobros,
-- dividido en cuotas mensuales desde p_primera. Queda "propuesto" hasta que se acepte.
create or replace function public.crear_convenio(p_depto text, p_periodos text[], p_cuotas int, p_primera date, p_nota text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare e uuid := public.mi_edificio(); total numeric; n int; cid uuid; cuota numeric; i int;
begin
  if not public.es_admin() then raise exception 'Solo administración'; end if;
  if p_cuotas is null or p_cuotas < 1 or p_cuotas > 60 then raise exception 'Las cuotas deben estar entre 1 y 60'; end if;
  if p_primera is null then raise exception 'Indica la fecha de la primera cuota'; end if;
  select count(*), coalesce(sum(g.monto - g.pagado_monto), 0) into n, total
  from public.gasto_unidades g join public.gastos x on x.edificio_id = g.edificio_id and x.periodo = g.periodo
  where g.edificio_id = e and g.depto = p_depto and g.periodo = any(p_periodos) and x.publicado and not g.pagado
    and not exists (select 1 from public.convenios c where c.id = g.convenio_id and c.estado in ('propuesto','vigente'));
  if n = 0 or n <> cardinality(p_periodos) or total <= 0 then raise exception 'Algún período no tiene deuda o ya está en otro convenio'; end if;
  insert into public.convenios (edificio_id, depto, periodos, monto_total, cuotas, nota, creado_por)
  values (e, p_depto, p_periodos, total, p_cuotas, coalesce(trim(p_nota), ''), auth.uid()) returning id into cid;
  update public.gasto_unidades set convenio_id = cid where edificio_id = e and depto = p_depto and periodo = any(p_periodos);
  cuota := floor(total / p_cuotas);
  for i in 1..p_cuotas loop
    insert into public.convenio_cuotas (edificio_id, convenio_id, depto, n, vence, monto)
    values (e, cid, p_depto, i, (p_primera + make_interval(months => i - 1))::date, case when i = p_cuotas then total - cuota * (p_cuotas - 1) else cuota end);
  end loop;
  return cid;
end $$;

-- Lo acepta alguien de la unidad desde la app, o la administración si se firmó en papel
create or replace function public.aceptar_convenio(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.convenios;
begin
  select * into c from public.convenios where id = p_id and edificio_id = public.mi_edificio();
  if not found or not (public.es_admin() or (public.es_residente() and c.depto = public.mi_depto())) then raise exception 'Sin permiso'; end if;
  if c.estado <> 'propuesto' then raise exception 'El convenio ya no está pendiente de aceptación'; end if;
  update public.convenios set estado = 'vigente', aceptado_at = now(), aceptado_por = auth.uid() where id = p_id;
end $$;

-- La administración puede anularlo siempre; la unidad, solo rechazarlo mientras está propuesto.
-- Lo ya abonado sigue aplicado a los períodos; el resto vuelve a ser deuda corriente.
create or replace function public.anular_convenio(p_id uuid, p_motivo text default '') returns void
language plpgsql security definer set search_path = public as $$
declare c public.convenios;
begin
  select * into c from public.convenios where id = p_id and edificio_id = public.mi_edificio();
  if not found or not (public.es_admin() or (public.es_residente() and c.depto = public.mi_depto() and c.estado = 'propuesto')) then raise exception 'Sin permiso'; end if;
  if c.estado not in ('propuesto','vigente') then raise exception 'El convenio ya está cerrado'; end if;
  update public.convenios set estado = 'anulado', anulado_at = now(), anulado_motivo = coalesce(trim(p_motivo), '') where id = p_id;
  update public.gasto_unidades set convenio_id = null where edificio_id = c.edificio_id and convenio_id = p_id;
  perform privado.recalc_unidad(c.edificio_id, c.depto);
end $$;

-- Recalcular prorrateo de un período con las alícuotas actuales
-- Reparte el total de un período entre las unidades. Cada ítem dice cómo se reparte (items[].prorrateo):
--   alicuota (o vacío)  según la alícuota de cada unidad
--   iguales             en partes iguales entre todas las unidades
--   consumo             según las lecturas del medidor items[].medidor; items[].fijo (0–100) es el % que
--                       se reparte igual por alícuota (pérdidas, mantención del equipo, áreas comunes)
--   unidades            solo entre las unidades de items[].deptos, en partes iguales (cargos directos)
-- Cada ítem se redondea al peso y la diferencia de redondeo se asigna a las unidades con mayor fracción,
-- así la suma de las unidades cuadra exactamente con el ítem.
create or replace function public.recalcular_prorrateo(p_periodo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo administración'; end if;
  perform privado.repartir(public.mi_edificio(), p_periodo);
end $$;

create or replace function privado.repartir(e uuid, p_periodo text) returns void
language plpgsql security definer set search_path = public as $$
declare g public.gastos; it record; med jsonb; n int; c numeric; k int; its jsonb;
begin
  select * into g from public.gastos where edificio_id = e and periodo = p_periodo;
  if not found then raise exception 'Período no encontrado'; end if;
  select count(*) into n from public.unidades where edificio_id = e;
  -- sin ítems (períodos creados por fuera de la app), el total se reparte por alícuota
  its := case when jsonb_array_length(coalesce(g.items, '[]'::jsonb)) = 0 then jsonb_build_array(jsonb_build_object('monto', g.total)) else g.items end;

  for it in select x, i from jsonb_array_elements(its) with ordinality t(x, i) loop
    if coalesce(it.x->>'prorrateo', 'alicuota') = 'consumo' then
      select m into med from public.edificios ed, jsonb_array_elements(ed.medidores) m where ed.id = e and m->>'id' = it.x->>'medidor';
      if med is null then raise exception 'El ítem "%" usa un medidor que no existe', it.x->>'categoria'; end if;
      select coalesce(sum(l.consumo), 0) into c from public.lecturas l
      where l.edificio_id = e and l.periodo = p_periodo and l.medidor = it.x->>'medidor'
        and exists (select 1 from public.unidades u where u.edificio_id = e and u.depto = l.depto);
      if c <= 0 and g.publicado and coalesce((it.x->>'fijo')::numeric, 0) < 100 and coalesce((it.x->>'monto')::numeric, 0) > 0 then
        raise exception 'Faltan las lecturas de % del período: sin ellas no se puede repartir "%"', med->>'nombre', it.x->>'categoria';
      end if;
    end if;
    if it.x ? 'fondo' and coalesce(it.x->>'fondo', '') <> '' and not exists (select 1 from public.fondos f where f.id::text = it.x->>'fondo' and f.edificio_id = e) then
      raise exception 'El ítem "%" va a un fondo que no existe', it.x->>'categoria';
    end if;
    if it.x->>'prorrateo' = 'unidades' then
      select count(*) into k from public.unidades u
      where u.edificio_id = e and u.depto in (select jsonb_array_elements_text(coalesce(it.x->'deptos', '[]'::jsonb)));
      if k = 0 then raise exception 'El ítem "%" no indica ninguna unidad existente', it.x->>'categoria'; end if;
    end if;
  end loop;

  with u as (select depto, alicuota from public.unidades where edificio_id = e),
  itm as (select i, x, coalesce((x->>'monto')::numeric, 0) as m, coalesce(nullif(x->>'prorrateo', ''), 'alicuota') as modo,
                least(greatest(coalesce((x->>'fijo')::numeric, 0), 0), 100) as fijo,
                array(select jsonb_array_elements_text(coalesce(x->'deptos', '[]'::jsonb))) as deptos
         from jsonb_array_elements(its) with ordinality t(x, i)),
  lec as (select medidor, depto, consumo as c from public.lecturas where edificio_id = e and periodo = p_periodo),
  tot as (select l.medidor, sum(l.c) as c from lec l join u on u.depto = l.depto group by l.medidor),
  sel as (select itm.i, count(u.depto) as k from itm join u on u.depto = any(itm.deptos) group by itm.i),
  exacto as (
    select u.depto, itm.i, l.c as consumo,
      case itm.modo
        when 'iguales'  then itm.m / nullif(n, 0)
        when 'unidades' then case when u.depto = any(itm.deptos) then itm.m / nullif(s.k, 0) else 0 end
        when 'consumo'  then itm.m * itm.fijo / 100 * u.alicuota / 100
                             + case when coalesce(t.c, 0) > 0 then itm.m * (100 - itm.fijo) / 100 * coalesce(l.c, 0) / t.c else 0 end
        else itm.m * u.alicuota / 100
      end as v,
      itm.modo
    from u cross join itm
    left join lec l on itm.modo = 'consumo' and l.medidor = itm.x->>'medidor' and l.depto = u.depto
    left join tot t on itm.modo = 'consumo' and t.medidor = itm.x->>'medidor'
    left join sel s on s.i = itm.i),
  red as (
    select depto, i, consumo, modo, floor(coalesce(v, 0)) as piso,
      row_number() over (partition by i order by coalesce(v, 0) - floor(coalesce(v, 0)) desc, depto) as orden,
      round(sum(coalesce(v, 0)) over (partition by i)) - sum(floor(coalesce(v, 0))) over (partition by i) as resto
    from exacto),
  final as (select depto, i, consumo, modo, piso + case when orden <= resto then 1 else 0 end as monto from red)
  insert into public.gasto_unidades (edificio_id, periodo, depto, alicuota, monto, detalle)
  select e, p_periodo, u.depto, u.alicuota, coalesce(sum(f.monto), 0),
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('i', f.i - 1, 'monto', f.monto, 'consumo', case when f.modo = 'consumo' then coalesce(f.consumo, 0) end)) order by f.i)
                  filter (where f.i is not null), '[]'::jsonb)
  from u left join final f on f.depto = u.depto
  group by u.depto, u.alicuota
  on conflict (edificio_id, periodo, depto) do update set alicuota = excluded.alicuota, monto = excluded.monto, detalle = excluded.detalle;

  if jsonb_array_length(coalesce(g.items, '[]'::jsonb)) = 0 then
    update public.gasto_unidades set detalle = '[]'::jsonb where edificio_id = e and periodo = p_periodo;
  end if;
  -- cargos individuales vigentes del período: se suman al cobro de su unidad
  update public.gasto_unidades x set monto = x.monto + c.total, detalle = x.detalle || c.lineas
  from (select depto, sum(round(monto)) as total,
               jsonb_agg(jsonb_build_object('c', id, 'tipo', tipo, 'descripcion', descripcion, 'monto', round(monto)) order by ts) as lineas
        from public.cargos where edificio_id = e and periodo = p_periodo and estado = 'vigente' group by depto) c
  where x.edificio_id = e and x.periodo = p_periodo and x.depto = c.depto;

  delete from public.gasto_unidades x where x.edificio_id = e and x.periodo = p_periodo
    and not exists (select 1 from public.unidades u where u.edificio_id = e and u.depto = x.depto);
  perform privado.recalc_unidad(e, x.depto) from public.gasto_unidades x where x.edificio_id = e and x.periodo = p_periodo;
end $$;

-- Primer período aún no publicado desde p_desde ('YYYY-MM'): ahí se cobran los cargos nuevos.
create or replace function privado.periodo_abierto(p_e uuid, p_desde text) returns text
language plpgsql stable security definer set search_path = public as $$
declare d date := to_date(p_desde || '-01', 'YYYY-MM-DD'); p text;
begin
  for k in 0..36 loop
    p := to_char(d + make_interval(months => k), 'YYYY-MM');
    if not exists (select 1 from public.gastos where edificio_id = p_e and periodo = p and publicado) then return p; end if;
  end loop;
  return p;
end $$;

-- Cargos: solo se agregan o suben en períodos no publicados; rebajar o anular se puede siempre, con motivo.
-- Si el período ya tiene gasto común, se recalcula el reparto.
create or replace function public.cargos_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare pub boolean;
begin
  if tg_op = 'DELETE' then raise exception 'Los cargos no se borran: anúlalos con un motivo'; end if;
  new.depto := trim(new.depto); new.descripcion := trim(coalesce(new.descripcion, ''));
  if tg_op = 'INSERT' then
    if new.periodo is null or new.periodo = '' then new.periodo := privado.periodo_abierto(new.edificio_id, to_char(public.hoy(), 'YYYY-MM')); end if;
    if new.periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Período no válido'; end if;
    if not exists (select 1 from public.unidades where edificio_id = new.edificio_id and depto = new.depto) then raise exception 'La unidad % no existe', new.depto; end if;
    if new.tipo = 'multa' and new.infraccion_id is null then
      raise exception 'Las multas se aplican desde un caso de infracción (módulo Multas), con cargos, descargos y resolución';
    end if;
    if exists (select 1 from public.gastos where edificio_id = new.edificio_id and periodo = new.periodo and publicado) then
      raise exception 'El período % ya está publicado: el cargo debe ir en un período siguiente', new.periodo;
    end if;
    new.monto_original := new.monto; new.estado := 'vigente'; new.motivo := null;
    new.registrado_por := coalesce(auth.uid(), new.registrado_por); new.ts := now();
    return new;
  end if;
  new.depto := old.depto; new.periodo := old.periodo; new.tipo := old.tipo; new.monto_original := old.monto_original;
  new.reserva_id := old.reserva_id; new.infraccion_id := old.infraccion_id; new.registrado_por := old.registrado_por; new.ts := old.ts;
  if old.estado = 'anulado' then raise exception 'El cargo ya está anulado'; end if;
  pub := exists (select 1 from public.gastos where edificio_id = old.edificio_id and periodo = old.periodo and publicado);
  if new.estado = 'anulado' or new.monto < old.monto then
    if coalesce(trim(new.motivo), '') = '' and auth.uid() is not null then raise exception 'Indica el motivo de la rebaja o anulación'; end if;
    if new.estado = 'anulado' then new.monto := old.monto; end if;
  elsif new.monto > old.monto and pub then
    raise exception 'El período % ya está publicado: no se puede subir el cargo', old.periodo;
  elsif pub and new.descripcion <> old.descripcion then
    null;
  end if;
  return new;
end $$;
drop trigger if exists cargos_antes on public.cargos;
create trigger cargos_antes before insert or update or delete on public.cargos
for each row execute function public.cargos_antes();

create or replace function public.cargos_despues() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.gastos where edificio_id = new.edificio_id and periodo = new.periodo) then
    perform set_config('mi_edificio.interno', '1', true);
    perform privado.repartir(new.edificio_id, new.periodo);
    perform privado.sync_aportes(new.edificio_id, new.periodo);
    perform set_config('mi_edificio.interno', '', true);
  end if;
  return null;
end $$;
drop trigger if exists cargos_despues on public.cargos;
create trigger cargos_despues after insert or update on public.cargos
for each row execute function public.cargos_despues();

-- Arriendo de espacios comunes: al aprobarse una reserva de un espacio con costo, se carga a la unidad en el
-- primer período abierto desde la fecha de la reserva; si se cancela o rechaza, el cargo se anula solo.
create or replace function privado.tg_cargo_reserva() returns trigger
language plpgsql security definer set search_path = public as $$
declare costo numeric;
begin
  if new.estado = 'aprobada' and (tg_op = 'INSERT' or old.estado <> 'aprobada') then
    select coalesce((x->>'costo')::numeric, 0) into costo from public.edificios e, jsonb_array_elements(e.espacios) x
    where e.id = new.edificio_id and x->>'id' = new.espacio_id;
    if coalesce(costo, 0) > 0 and not exists (select 1 from public.cargos where reserva_id = new.id and estado = 'vigente') then
      insert into public.cargos (edificio_id, depto, periodo, tipo, descripcion, monto, reserva_id)
      values (new.edificio_id, new.depto, privado.periodo_abierto(new.edificio_id, to_char(greatest(new.fecha, public.hoy()), 'YYYY-MM')), 'arriendo',
              new.espacio_nombre || ' · ' || to_char(new.fecha, 'DD-MM-YYYY') || ' ' || lpad(new.h_ini::text, 2, '0') || ':00–' || lpad(new.h_fin::text, 2, '0') || ':00', costo, new.id);
    end if;
  elsif tg_op = 'UPDATE' and old.estado = 'aprobada' and new.estado in ('cancelada','rechazada') then
    update public.cargos set estado = 'anulado', motivo = 'Reserva ' || new.estado where reserva_id = new.id and estado = 'vigente';
  end if;
  return null;
end $$;
drop trigger if exists cargo_reserva on public.reservas;
create trigger cargo_reserva after insert or update on public.reservas for each row execute function privado.tg_cargo_reserva();

-- Fondos: al publicar un período se anota el aporte de cada ítem que va a un fondo; al despublicarlo, se quita.
create or replace function privado.sync_aportes(p_e uuid, p_periodo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.fondo_movimientos where edificio_id = p_e and periodo = p_periodo and tipo = 'aporte';
  insert into public.fondo_movimientos (edificio_id, fondo_id, tipo, fecha, monto, descripcion, periodo)
  select p_e, (x->>'fondo')::uuid, 'aporte', coalesce(g.vence, to_date(p_periodo || '-01', 'YYYY-MM-DD')), sum((x->>'monto')::numeric),
         'Aporte de gastos comunes ' || p_periodo, p_periodo
  from public.gastos g, jsonb_array_elements(g.items) x
  where g.edificio_id = p_e and g.periodo = p_periodo and g.publicado and coalesce(x->>'fondo', '') <> '' and coalesce((x->>'monto')::numeric, 0) > 0
    and exists (select 1 from public.fondos f where f.id::text = x->>'fondo' and f.edificio_id = p_e)
  group by x->>'fondo', g.vence;
  -- multas cobradas en el período, al fondo de reserva si así está configurado
  insert into public.fondo_movimientos (edificio_id, fondo_id, tipo, fecha, monto, descripcion, periodo)
  select p_e, f.id, 'aporte', coalesce(g.vence, to_date(p_periodo || '-01', 'YYYY-MM-DD')), sum(c.monto), 'Multas cobradas en gastos comunes ' || p_periodo, p_periodo
  from public.gastos g
  join public.edificios ed on ed.id = g.edificio_id and coalesce(ed.multas->>'destino', 'fondo_reserva') = 'fondo_reserva'
  join lateral (select id from public.fondos where edificio_id = p_e and reserva and activo order by creado limit 1) f on true
  join public.cargos c on c.edificio_id = p_e and c.periodo = p_periodo and c.tipo = 'multa' and c.estado = 'vigente'
  where g.edificio_id = p_e and g.periodo = p_periodo and g.publicado
  group by f.id, g.vence having sum(c.monto) > 0;
end $$;
create or replace function privado.tg_gastos_fondos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('mi_edificio.interno', '1', true);
  perform privado.sync_aportes(coalesce(new.edificio_id, old.edificio_id), coalesce(new.periodo, old.periodo));
  perform set_config('mi_edificio.interno', '', true);
  return null;
end $$;
drop trigger if exists gastos_fondos on public.gastos;
create trigger gastos_fondos after insert or update or delete on public.gastos for each row execute function privado.tg_gastos_fondos();

create or replace function public.fondo_mov_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare saldo numeric;
begin
  if current_setting('mi_edificio.interno', true) = '1' or auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.tipo = 'aporte' and old.periodo is not null then raise exception 'Los aportes de gastos comunes se quitan despublicando el período'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then raise exception 'Un movimiento no se modifica: elimínalo y regístralo de nuevo'; end if;
  if new.periodo is not null then raise exception 'Los aportes de gastos comunes se anotan solos al publicar el período'; end if;
  if new.tipo <> 'ajuste' and new.monto <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  if new.tipo = 'uso' then
    select f.saldo_inicial + coalesce((select sum(case when m.tipo = 'uso' then -m.monto else m.monto end) from public.fondo_movimientos m where m.fondo_id = f.id), 0)
    into saldo from public.fondos f where f.id = new.fondo_id;
    if new.monto > saldo then raise exception 'El fondo no tiene saldo suficiente (saldo $%)', saldo::bigint; end if;
  end if;
  new.registrado_por := auth.uid(); new.ts := now();
  return new;
end $$;
drop trigger if exists fondo_mov_antes on public.fondo_movimientos;
create trigger fondo_mov_antes before insert or update or delete on public.fondo_movimientos
for each row execute function public.fondo_mov_antes();

-- Usar un fondo: anota el uso y, si se pide, el egreso en el flujo de caja (una sola operación).
create or replace function public.usar_fondo(p_fondo uuid, p_monto numeric, p_fecha date, p_descripcion text, p_egreso boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare f public.fondos; cid uuid; mid uuid;
begin
  if not public.es_admin() then raise exception 'Solo administración'; end if;
  select * into f from public.fondos where id = p_fondo and edificio_id = public.mi_edificio();
  if not found then raise exception 'Fondo no válido'; end if;
  if coalesce(trim(p_descripcion), '') = '' then raise exception 'Indica en qué se usó el fondo'; end if;
  if p_egreso then
    insert into public.caja_movimientos (edificio_id, tipo, fecha, categoria, descripcion, monto, registrado_por)
    values (f.edificio_id, 'egreso', coalesce(p_fecha, public.hoy()), f.nombre, trim(p_descripcion), p_monto, auth.uid()) returning id into cid;
  end if;
  insert into public.fondo_movimientos (edificio_id, fondo_id, tipo, fecha, monto, descripcion, caja_id)
  values (f.edificio_id, f.id, 'uso', coalesce(p_fecha, public.hoy()), p_monto, trim(p_descripcion), cid) returning id into mid;
  return mid;
end $$;

-- Saldo de cada fondo
create or replace function public.saldos_fondos()
returns table (fondo_id uuid, aportes numeric, usos numeric, ajustes numeric, saldo numeric)
language sql stable security definer set search_path = public as $$
  select f.id,
    coalesce(sum(m.monto) filter (where m.tipo = 'aporte'), 0),
    coalesce(sum(m.monto) filter (where m.tipo = 'uso'), 0),
    coalesce(sum(m.monto) filter (where m.tipo = 'ajuste'), 0),
    f.saldo_inicial + coalesce(sum(case when m.tipo = 'uso' then -m.monto else m.monto end), 0)
  from public.fondos f left join public.fondo_movimientos m on m.fondo_id = f.id
  where f.edificio_id = public.mi_edificio() and public.mi_rol() in ('residente','propietario','comite','admin')
  group by f.id
$$;

-- ---------- Multas con debido proceso ----------
-- Fecha que resulta de sumar p_n días hábiles (sin sábados, domingos ni feriados del edificio)
create or replace function privado.dias_habiles(p_e uuid, p_desde date, p_n int) returns date
language plpgsql stable security definer set search_path = public as $$
declare d date := p_desde; quedan int := p_n; fer text[];
begin
  select coalesce(array(select jsonb_array_elements_text(feriados)), '{}') into fer from public.edificios where id = p_e;
  while quedan > 0 loop
    d := d + 1;
    if extract(isodow from d) < 6 and not (d::text = any(fer)) then quedan := quedan - 1; end if;
  end loop;
  return d;
end $$;

create or replace function privado.multas_cfg(p_e uuid, k text, def int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (multas->>k)::int from public.edificios where id = p_e), def)
$$;

create or replace function privado.indicador(p_e uuid, p_codigo text, p_fecha date) returns numeric
language sql stable security definer set search_path = public as $$
  select valor from public.indicadores where edificio_id = p_e and codigo = p_codigo and desde <= p_fecha order by desde desc limit 1
$$;

create or replace function privado.evento_infraccion(p_id uuid, p_tipo text, p_texto text, p_fotos text[] default '{}') returns void
language sql security definer set search_path = public as $$
  insert into public.infraccion_eventos (edificio_id, infraccion_id, tipo, texto, fotos)
  select edificio_id, id, p_tipo, p_texto, coalesce(p_fotos, '{}') from public.infracciones where id = p_id
$$;

create or replace function privado.fotos_validas(p_e uuid, p_fotos text[]) returns boolean
language sql immutable as $$
  select not exists (select 1 from unnest(coalesce(p_fotos, '{}')) x where x not like p_e::text || '/multas/%')
$$;

create or replace function public.abrir_infraccion(p_descripcion text, p_depto text default null, p_evidencias text[] default '{}', p_origen text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e uuid := public.mi_edificio(); r rol_t := public.mi_rol(); f int; nid uuid;
begin
  if r is null or r not in ('admin','comite','conserje') then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_descripcion), '') = '' then raise exception 'Describe lo constatado: qué, cuándo y dónde'; end if;
  if not privado.fotos_validas(e, p_evidencias) then raise exception 'Evidencia no válida'; end if;
  if nullif(trim(p_depto), '') is not null and not exists (select 1 from public.unidades where edificio_id = e and depto = trim(p_depto)) then
    raise exception 'La unidad % no existe', p_depto;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('infracciones:' || e::text, 0));
  select coalesce(max(folio), 0) + 1 into f from public.infracciones where edificio_id = e;
  insert into public.infracciones (edificio_id, folio, depto, origen, descripcion, evidencias, decidir_antes)
  values (e, f, nullif(trim(p_depto), ''),
          coalesce(p_origen, case r when 'conserje' then 'conserjeria' when 'comite' then 'comite' else 'administracion' end),
          trim(p_descripcion), coalesce(p_evidencias, '{}'), privado.dias_habiles(e, public.hoy(), privado.multas_cfg(e, 'plazo_decision', 5)))
  returning id into nid;
  perform privado.evento_infraccion(nid, 'apertura', trim(p_descripcion), p_evidencias);
  perform privado.push(e, privado.usuarios_de(e, '{admin}', null, null, auth.uid()), '⚖️ Caso de infracción nº ' || f,
    'Decidir si se formulan cargos: ' || left(trim(p_descripcion), 120), '#multas');
  return nid;
end $$;

create or replace function public.agregar_evidencia(p_id uuid, p_nota text, p_fotos text[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare c public.infracciones;
begin
  select * into c from public.infracciones where id = p_id and edificio_id = public.mi_edificio();
  if not found or not (public.mi_rol() in ('admin','comite') or (public.mi_rol() = 'conserje' and c.creado_por = auth.uid())) then raise exception 'No autorizado'; end if;
  if c.estado not in ('abierto','cargos') then raise exception 'El caso ya está cerrado'; end if;
  if coalesce(trim(p_nota), '') = '' and cardinality(coalesce(p_fotos, '{}')) = 0 then raise exception 'Agrega una nota o una foto'; end if;
  if not privado.fotos_validas(c.edificio_id, p_fotos) then raise exception 'Evidencia no válida'; end if;
  update public.infracciones set evidencias = evidencias || coalesce(p_fotos, '{}') where id = p_id;
  perform privado.evento_infraccion(p_id, 'evidencia', nullif(trim(p_nota), ''), p_fotos);
end $$;

-- Monto propuesto: el del catálogo, o si la unidad fue sancionada por la misma conducta en los 6 meses
-- anteriores, la categoría superior (si tiene categoría) o el doble.
create or replace function public.propuesta_multa(p_id uuid, p_catalogo uuid)
returns table (reincidencia boolean, monto numeric, unidad text, clp numeric, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare c public.infracciones; i public.multas_catalogo; rep boolean; m numeric;
begin
  select * into c from public.infracciones where id = p_id and edificio_id = public.mi_edificio();
  select * into i from public.multas_catalogo where id = p_catalogo and edificio_id = c.edificio_id;
  if c.id is null or i.id is null or not public.es_admin() then raise exception 'No autorizado'; end if;
  rep := c.depto is not null and exists (select 1 from public.infracciones x where x.edificio_id = c.edificio_id and x.depto = c.depto
          and x.catalogo_id = p_catalogo and x.estado = 'resuelto' and x.id <> c.id and x.resuelto_at > now() - interval '6 months');
  m := i.monto;
  if rep and not i.jpl then
    m := case when i.categoria in ('leve','grave') then (case i.categoria when 'leve' then 1 else 2 end) * 1.0 else i.monto * 2 end;
  end if;
  return query select rep, m, i.unidad, round(m * privado.indicador(c.edificio_id, i.unidad, public.hoy())),
    case when rep then case when i.categoria in ('leve','grave') then 'Reincidencia en 6 meses: categoría superior' else 'Reincidencia en 6 meses: el doble' end end;
end $$;

create or replace function public.formular_cargos(p_id uuid, p_catalogo uuid, p_depto text, p_texto text, p_evidencia_ok boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c public.infracciones; i public.multas_catalogo;
begin
  select * into c from public.infracciones where id = p_id and edificio_id = public.mi_edificio() for update;
  if not found or not public.es_admin() then raise exception 'No autorizado'; end if;
  if c.estado <> 'abierto' then raise exception 'Los cargos ya se formularon'; end if;
  select * into i from public.multas_catalogo where id = p_catalogo and edificio_id = c.edificio_id and retirado is null;
  if not found then raise exception 'Elige una conducta del catálogo'; end if;
  if i.jpl then raise exception 'Esta conducta no la multa el comité: derívala al Juzgado de Policía Local'; end if;
  if i.evidencia is not null and not p_evidencia_ok then raise exception 'Confirma que se cumple la evidencia mínima: %', i.evidencia; end if;
  if not exists (select 1 from public.unidades where edificio_id = c.edificio_id and depto = trim(p_depto)) then raise exception 'Indica la unidad'; end if;
  if coalesce(trim(p_texto), '') = '' then raise exception 'Escribe la notificación de cargos'; end if;
  if privado.indicador(c.edificio_id, i.unidad, public.hoy()) is null then raise exception 'Falta el valor de la % (Multas → Catálogo)', i.unidad; end if;
  update public.infracciones set estado = 'cargos', catalogo_id = p_catalogo, depto = trim(p_depto), cargos_texto = trim(p_texto), cargos_at = now(),
    descargos_hasta = privado.dias_habiles(c.edificio_id, public.hoy(), privado.multas_cfg(c.edificio_id, 'plazo_descargos', 5))
  where id = p_id returning * into c;
  perform privado.evento_infraccion(p_id, 'cargos', trim(p_texto));
  perform privado.push(c.edificio_id, privado.usuarios_de(c.edificio_id, '{residente,propietario}', c.depto), '⚖️ Notificación de cargos nº ' || c.folio,
    'Puedes presentar descargos hasta el ' || to_char(c.descargos_hasta, 'DD-MM-YYYY') || '.', '#multas');
end $$;

-- Descargos: la unidad en la app dentro del plazo, o la administración registra los presentados por escrito
create or replace function public.presentar_descargos(p_id uuid, p_texto text, p_fotos text[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare c public.infracciones; adm boolean := public.es_admin();
begin
  select * into c from public.infracciones where id = p_id and edificio_id = public.mi_edificio() for update;
  if not found or not (adm or (public.es_residente() and c.depto = public.mi_depto())) then raise exception 'No autorizado'; end if;
  if c.estado <> 'cargos' then raise exception 'El caso no está en plazo de descargos'; end if;
  if not adm and public.hoy() > c.descargos_hasta then raise exception 'El plazo de descargos venció el %', to_char(c.descargos_hasta, 'DD-MM-YYYY'); end if;
  if coalesce(trim(p_texto), '') = '' then raise exception 'Escribe los descargos'; end if;
  if not privado.fotos_validas(c.edificio_id, p_fotos) then raise exception 'Archivo no válido'; end if;
  update public.infracciones set descargos_texto = coalesce(descargos_texto || E'\n\n', '') || trim(p_texto), descargos_at = now(),
    descargos_fotos = descargos_fotos || coalesce(p_fotos, '{}') where id = p_id;
  perform privado.evento_infraccion(p_id, 'descargos', case when adm then '(Presentados por escrito) ' else '' end || trim(p_texto), p_fotos);
  if not adm then
    perform privado.push(c.edificio_id, privado.usuarios_de(c.edificio_id, '{admin}'), '⚖️ Descargos recibidos: caso nº ' || c.folio, left(trim(p_texto), 120), '#multas');
  end if;
end $$;

create or replace function privado.aplicar_multa(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.infracciones; i public.multas_catalogo; v numeric; per text;
begin
  select * into c from public.infracciones where id = p_id for update;
  select * into i from public.multas_catalogo where id = c.catalogo_id;
  v := privado.indicador(c.edificio_id, c.multa_unidad, public.hoy());
  if v is null then raise exception 'Falta el valor de la % (Multas → Catálogo)', c.multa_unidad; end if;
  per := privado.periodo_abierto(c.edificio_id, to_char(public.hoy(), 'YYYY-MM'));
  update public.infracciones set estado = 'resuelto', multa_clp = round(c.multa_monto * v) where id = p_id returning * into c;
  insert into public.cargos (edificio_id, depto, periodo, tipo, descripcion, monto, infraccion_id)
  values (c.edificio_id, c.depto, per, 'multa', 'Multa caso nº ' || c.folio || ': ' || i.conducta, c.multa_clp, c.id);
  perform privado.evento_infraccion(p_id, 'cobro', 'Multa de ' || trim(to_char(c.multa_monto, 'FM999990.##')) || ' ' || c.multa_unidad || ' ($' || c.multa_clp
    || ') en el gasto común de ' || per || '.');
  perform privado.push(c.edificio_id, privado.usuarios_de(c.edificio_id, '{residente,propietario}', c.depto), '⚖️ Resolución del caso nº ' || c.folio,
    'Multa de ' || trim(to_char(c.multa_monto, 'FM999990.##')) || ' ' || c.multa_unidad || ', se cobra con los gastos comunes.', '#multas');
end $$;

-- Resolución fundada: absolver, o sancionar con el monto del catálogo (o el de reincidencia)
create or replace function public.resolver_infraccion(p_id uuid, p_sancion boolean, p_texto text, p_reincidencia boolean default true, p_restituir date default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.infracciones; i public.multas_catalogo; pr record; n int;
begin
  select * into c from public.infracciones where id = p_id and edificio_id = public.mi_edificio() for update;
  if not found or not public.es_admin() then raise exception 'No autorizado'; end if;
  if c.estado <> 'cargos' then raise exception 'Primero se formulan cargos'; end if;
  if c.descargos_at is null and public.hoy() <= c.descargos_hasta then
    raise exception 'Aún corre el plazo de descargos (hasta el %)', to_char(c.descargos_hasta, 'DD-MM-YYYY');
  end if;
  if coalesce(trim(p_texto), '') = '' then raise exception 'La resolución debe ser fundada: indica los antecedentes considerados'; end if;
  update public.infracciones set resolucion_texto = trim(p_texto), resuelto_at = now(), resuelto_por = auth.uid() where id = p_id;
  if not p_sancion then
    update public.infracciones set estado = 'absuelto' where id = p_id;
    perform privado.evento_infraccion(p_id, 'resolucion', 'Absuelto. ' || trim(p_texto));
    perform privado.push(c.edificio_id, privado.usuarios_de(c.edificio_id, '{residente,propietario}', c.depto), '⚖️ Resolución del caso nº ' || c.folio, 'Sin multa.', '#multas');
    return;
  end if;
  select * into i from public.multas_catalogo where id = c.catalogo_id;
  if i.permanente and p_restituir is null then raise exception 'Infracción permanente: indica el plazo para restituir'; end if;
  select * into pr from public.propuesta_multa(p_id, c.catalogo_id);
  if pr.clp is null then raise exception 'Falta el valor de la % (Multas → Catálogo)', i.unidad; end if;
  update public.infracciones set reincidencia = pr.reincidencia and p_reincidencia,
    multa_monto = case when pr.reincidencia and p_reincidencia then pr.monto else i.monto end, multa_unidad = i.unidad,
    restituir_antes = case when i.permanente then p_restituir end
  where id = p_id;
  perform privado.evento_infraccion(p_id, 'resolucion', 'Sanción. ' || trim(p_texto));
  n := privado.multas_cfg(c.edificio_id, 'aprobaciones_comite', 1);
  if n > 0 then
    update public.infracciones set estado = 'en_comite', ronda = ronda + 1 where id = p_id;
    perform privado.push(c.edificio_id, privado.usuarios_de(c.edificio_id, '{comite}'), '⚖️ Multa por aprobar: caso nº ' || c.folio, i.conducta, '#multas');
  else
    perform privado.aplicar_multa(p_id);
  end if;
end $$;

create or replace function public.votar_multa(p_id uuid, p_aprueba boolean, p_comentario text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.infracciones; n int; si int; no_ int;
begin
  select * into c from public.infracciones where id = p_id and edificio_id = public.mi_edificio() for update;
  if not found or public.mi_rol() is distinct from 'comite' then raise exception 'Solo el comité aprueba multas'; end if;
  if c.estado <> 'en_comite' then raise exception 'La multa no está esperando al comité'; end if;
  if not p_aprueba and coalesce(trim(p_comentario), '') = '' then raise exception 'Indica el motivo del rechazo'; end if;
  if exists (select 1 from public.infraccion_votos where infraccion_id = p_id and ronda = c.ronda and uid = auth.uid()) then raise exception 'Ya votaste esta multa'; end if;
  insert into public.infraccion_votos (infraccion_id, edificio_id, ronda, aprueba, comentario) values (p_id, c.edificio_id, c.ronda, p_aprueba, nullif(trim(p_comentario), ''));
  perform privado.evento_infraccion(p_id, 'voto', case when p_aprueba then 'Aprueba' else 'Rechaza: ' || trim(p_comentario) end);
  n := privado.multas_cfg(c.edificio_id, 'aprobaciones_comite', 1);
  select count(*) filter (where aprueba), count(*) filter (where not aprueba) into si, no_ from public.infraccion_votos where infraccion_id = p_id and ronda = c.ronda;
  if si >= n then
    perform privado.aplicar_multa(p_id);
  elsif no_ >= n then
    update public.infracciones set estado = 'cargos', multa_monto = null, multa_unidad = null, resolucion_texto = null, resuelto_at = null, resuelto_por = null, reincidencia = false
    where id = p_id;
    perform privado.push(c.edificio_id, privado.usuarios_de(c.edificio_id, '{admin}'), '⚖️ El comité no aprobó la multa del caso nº ' || c.folio, nullif(trim(p_comentario), ''), '#multas');
  end if;
end $$;

create or replace function public.derivar_jpl(p_id uuid, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.infracciones;
begin
  select * into c from public.infracciones where id = p_id and edificio_id = public.mi_edificio() for update;
  if not found or not public.es_admin() then raise exception 'No autorizado'; end if;
  if c.estado not in ('abierto','cargos') then raise exception 'El caso ya está cerrado'; end if;
  update public.infracciones set estado = 'derivado_jpl', resolucion_texto = nullif(trim(p_nota), ''), resuelto_at = now(), resuelto_por = auth.uid() where id = p_id;
  perform privado.evento_infraccion(p_id, 'derivacion', coalesce(nullif(trim(p_nota), ''), 'Derivado al Juzgado de Policía Local.'));
end $$;

create or replace function public.archivar_infraccion(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.infracciones;
begin
  select * into c from public.infracciones where id = p_id and edificio_id = public.mi_edificio() for update;
  if not found or not public.es_admin() then raise exception 'No autorizado'; end if;
  if c.estado <> 'abierto' then raise exception 'Solo se archiva un caso sin cargos'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo'; end if;
  update public.infracciones set estado = 'archivado', resolucion_texto = trim(p_motivo), resuelto_at = now(), resuelto_por = auth.uid() where id = p_id;
  perform privado.evento_infraccion(p_id, 'archivo', trim(p_motivo));
end $$;

create or replace function public.marcar_restituido(p_id uuid, p_fecha date, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.infracciones;
begin
  select * into c from public.infracciones where id = p_id and edificio_id = public.mi_edificio() for update;
  if not found or not public.es_admin() or c.restituir_antes is null then raise exception 'No autorizado'; end if;
  update public.infracciones set restituido_el = coalesce(p_fecha, public.hoy()) where id = p_id;
  perform privado.evento_infraccion(p_id, 'restitucion', coalesce(nullif(trim(p_nota), ''), 'Restituido'));
end $$;

-- Infracciones permanentes sin restituir: la multa se repite cada mes (tarea diaria; una vez por período)
create or replace function privado.multas_permanentes() returns int
language plpgsql security definer set search_path = public as $$
declare c record; per text; v numeric; n int := 0;
begin
  for c in select x.*, i.conducta from public.infracciones x join public.multas_catalogo i on i.id = x.catalogo_id
           where x.estado = 'resuelto' and x.restituir_antes is not null and x.restituido_el is null loop
    per := privado.periodo_abierto(c.edificio_id, to_char(public.hoy(), 'YYYY-MM'));
    continue when exists (select 1 from public.cargos where infraccion_id = c.id and periodo >= per);
    v := privado.indicador(c.edificio_id, c.multa_unidad, public.hoy());
    continue when v is null;
    insert into public.cargos (edificio_id, depto, periodo, tipo, descripcion, monto, infraccion_id)
    values (c.edificio_id, c.depto, per, 'multa', 'Multa mensual caso nº ' || c.folio || ': ' || c.conducta, round(c.multa_monto * v), c.id);
    perform privado.evento_infraccion(c.id, 'cobro', 'Multa mensual por infracción permanente sin restituir, en el gasto común de ' || per || '.');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Tareas diarias (pg_cron en Supabase; el servidor local llama a esta misma función)
create or replace function privado.tareas_diarias() returns void
language plpgsql security definer set search_path = public as $$
begin
  begin perform privado.multas_permanentes(); exception when others then raise warning 'multas_permanentes: %', sqlerrm; end;
  perform privado.depurar();
end $$;

-- Catálogo de ejemplo: el de Los Cactus (borrador de su reglamento, oct-2026). Hay que ajustarlo al reglamento propio.
create or replace function public.cargar_catalogo_ejemplo() returns int
language plpgsql security definer set search_path = public as $$
declare e uuid := public.mi_edificio(); n int;
begin
  if not public.es_admin() then raise exception 'Solo administración'; end if;
  if exists (select 1 from public.multas_catalogo where edificio_id = e) then raise exception 'El catálogo ya tiene conductas'; end if;
  insert into public.multas_catalogo (edificio_id, conducta, articulo, categoria, monto, unidad, por_evento, permanente, jpl, evidencia, nota, plantilla)
  select e, v.c, v.a, v.cat, v.m, v.u, v.pe, v.pm, v.j, v.ev, v.nt,
    'Se le notifican cargos por: ' || lower(v.c) || ', conducta prohibida por el artículo ' || v.a || ' del reglamento de copropiedad. '
    || '[Describa aquí los hechos: fecha, hora, lugar y evidencia.] La multa posible es '
    || case when v.j then 'la que determine el Juzgado de Policía Local' else trim(to_char(v.m, 'FM990.##')) || ' ' || v.u end
    || '. Puede presentar sus descargos dentro del plazo indicado en esta notificación. Infractor y propietario responden solidariamente.'
  from (values
    ('Ruidos de mascota persistentes', '15 nº 24', null, 1, 'UTM', false, false, false, 'Denuncia de 2 unidades, o 1 residente + constatación de conserjería', '2 UTM si reincide en 6 meses'),
    ('Ataque de mascota con lesiones o daño a otro animal', '15 nº 24', null, 3, 'UTM', false, false, false, null, null),
    ('Otras obligaciones de mascotas (correa, fecas, suelta)', '15 nº 24', null, 1, 'UTM', false, false, false, null, null),
    ('Exceso de velocidad en estacionamientos', '15 nº 25', null, 1, 'UTM', false, false, false, null, null),
    ('Mudanza sin cumplir requisitos', '15 nº 26', null, 3, 'UTM', false, false, false, null, null),
    ('Sala de basura: envases sin lavar, cajas sin desarmar, bolsas fuera del ducto', '15 nº 28', null, 1, 'UTM', true, false, false, null, null),
    ('Sala de basura: vidrios, aceite, pilas, escombros u otros', '15 nº 28', null, 3, 'UTM', true, false, false, null, 'Además debe retirar los residuos'),
    ('Violencia contra personal, comité o administración', '15 nº 31', null, 3, 'UTM', false, false, false, null, null),
    ('Uso indebido de estacionamiento de visita', '15', 'grave', 1, 'UTM', true, false, false, null, null),
    ('Arriendo temporal menor a 30 días', '19', null, 3, 'UTM', true, false, false, null, 'Por cada arriendo'),
    ('No actualizar el registro de copropietarios', '20', 'leve', 0.5, 'UTM', false, false, false, null, null),
    ('Inasistencia injustificada a la asamblea', '49', null, 2, 'UF', false, false, false, 'Previo descargo', null),
    ('Negarse a revisiones o certificaciones', '77', null, null, 'UTM', false, false, true, null, 'Juzgado de Policía Local'),
    ('Obras, cierres o instalaciones no autorizadas en bienes comunes o fachada', '15', 'grave', 1, 'UTM', false, true, false, null, 'Se repite cada mes hasta restituir'),
    ('Resto de prohibiciones del reglamento (ruidos, fachadas, etc.)', '15', 'grave', 1, 'UTM', false, false, false, null, null),
    ('Otras obligaciones sin monto propio', 'varios', 'leve', 0.5, 'UTM', false, false, false, null, null)
  ) as v(c, a, cat, m, u, pe, pm, j, ev, nt);
  get diagnostics n = row_count;
  return n;
end $$;

-- Lecturas: la anterior se completa sola con la última lectura de ese medidor y unidad. Una vez publicado
-- el período, sus lecturas ya no cambian (para corregir, se despublica, se corrige y se recalcula).
create or replace function public.lecturas_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev numeric;
begin
  if tg_op in ('UPDATE', 'DELETE') and exists (select 1 from public.gastos where edificio_id = old.edificio_id and periodo = old.periodo and publicado) then
    raise exception 'El período % ya está publicado: para corregir una lectura, despublícalo primero', old.periodo;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if exists (select 1 from public.gastos where edificio_id = new.edificio_id and periodo = new.periodo and publicado) then
    raise exception 'El período % ya está publicado: para agregar una lectura, despublícalo primero', new.periodo;
  end if;
  if new.periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Período no válido'; end if;
  if not exists (select 1 from public.edificios ed, jsonb_array_elements(ed.medidores) m where ed.id = new.edificio_id and m->>'id' = new.medidor) then
    raise exception 'Medidor no válido';
  end if;
  if not exists (select 1 from public.unidades where edificio_id = new.edificio_id and depto = new.depto) then raise exception 'La unidad % no existe', new.depto; end if;
  -- la lectura anterior es siempre la del último período con lectura; solo la primera de una unidad se ingresa a mano
  select l.actual into prev from public.lecturas l where l.edificio_id = new.edificio_id and l.medidor = new.medidor
    and l.depto = new.depto and l.periodo < new.periodo order by l.periodo desc limit 1;
  if found then new.anterior := prev; else new.anterior := coalesce(new.anterior, 0); end if;
  if new.anterior < 0 or new.actual < 0 then raise exception 'Unidad %: las lecturas no pueden ser negativas', new.depto; end if;
  if new.cambio then
    new.inicial_nuevo := coalesce(new.inicial_nuevo, 0);
    if new.final_retirado is null then raise exception 'Unidad %: indica la última lectura del medidor retirado', new.depto; end if;
    if new.final_retirado < new.anterior then
      raise exception 'Unidad %: la última lectura del medidor retirado (%) es menor que la del mes anterior (%)', new.depto, new.final_retirado, new.anterior;
    end if;
    if new.actual < new.inicial_nuevo then
      raise exception 'Unidad %: la lectura actual (%) es menor que la inicial del medidor nuevo (%)', new.depto, new.actual, new.inicial_nuevo;
    end if;
  else
    new.final_retirado := null; new.inicial_nuevo := 0;
    if new.actual < new.anterior then
      raise exception 'Unidad %: la lectura actual (%) es menor que la del mes anterior (%). Si se cambió el medidor, márcalo como cambio de medidor', new.depto, new.actual, new.anterior;
    end if;
  end if;
  new.registrado_por := auth.uid(); new.ts := now();
  return new;
end $$;
drop trigger if exists lecturas_antes on public.lecturas;
create trigger lecturas_antes before insert or update or delete on public.lecturas
for each row execute function public.lecturas_antes();

-- Si cambia o se borra una lectura, la del período siguiente (si aún no está publicado) toma la nueva
-- lectura anterior. Si el siguiente ya está publicado, el cambio no se permite.
create or replace function public.lecturas_despues() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.lecturas; sig text;
begin
  r := coalesce(new, old);
  if tg_op = 'UPDATE' and new.actual = old.actual then return null; end if;
  select periodo into sig from public.lecturas where edificio_id = r.edificio_id and medidor = r.medidor and depto = r.depto and periodo > r.periodo order by periodo limit 1;
  if sig is null then return null; end if;
  if exists (select 1 from public.gastos where edificio_id = r.edificio_id and periodo = sig and publicado) then
    raise exception 'Unidad %: la lectura de % ya se usó como anterior en el período publicado %', r.depto, r.periodo, sig;
  end if;
  update public.lecturas set anterior = anterior where edificio_id = r.edificio_id and medidor = r.medidor and depto = r.depto and periodo = sig;
  return null;
end $$;
drop trigger if exists lecturas_despues on public.lecturas;
create trigger lecturas_despues after insert or update or delete on public.lecturas
for each row execute function public.lecturas_despues();

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

-- El tipo de una votación no cambia después de publicarla (un sondeo secreto no puede volverse nominal).
create or replace function public.encuestas_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.tipo := old.tipo;
  elsif new.tipo not in ('sondeo','asamblea') then raise exception 'Tipo de votación no válido';
  end if;
  return new;
end $$;
drop trigger if exists encuestas_antes on public.encuestas;
create trigger encuestas_antes before insert or update on public.encuestas
for each row execute function public.encuestas_antes();

-- Votaciones de asamblea: voto de cada unidad con su alícuota. Lo ve la comunidad con la misma
-- regla que los resultados (comité y administración siempre; residentes al votar o al cierre).
create or replace function public.votos_asamblea()
returns table (encuesta_id uuid, depto text, opcion int, alicuota numeric, ts timestamptz)
language sql stable security definer set search_path = public as $$
  select v.encuesta_id, v.depto, v.opcion, coalesce(u.alicuota, 0)::numeric, v.ts
  from public.votos v
  join public.encuestas e on e.id = v.encuesta_id
  left join public.unidades u on u.edificio_id = v.edificio_id and u.depto = v.depto
  where e.edificio_id = public.mi_edificio() and e.tipo = 'asamblea'
    and public.mi_rol() in ('residente','propietario','comite','admin')
    and (public.mi_rol() in ('comite','admin')
         or e.estado = 'cerrada' or (e.cierra is not null and e.cierra < public.hoy())
         or exists (select 1 from public.votos m where m.encuesta_id = e.id and m.depto = public.mi_depto()))
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

create or replace function privado.tg_push_visita() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'ingreso' and (tg_op = 'INSERT' or old.estado is distinct from 'ingreso') then
    perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{residente,propietario}', new.depto),
      '🚪 Llegó tu visita', new.nombre, '#visitas');
  end if;
  return null;
end $$;

drop trigger if exists push_visita on public.visitas;
create trigger push_visita after insert or update on public.visitas for each row execute function privado.tg_push_visita();
-- Estacionamientos de visita -------------------------------------------------------
create or replace function privado.dur(m int) returns text
language sql immutable as $$
  select case when m < 60 then m || ' min'
              else (m / 60) || ' h' || case when m % 60 > 0 then ' ' || (m % 60) || ' min' else '' end end
$$;

create or replace function privado.tg_push_est_uso() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select est_aviso_min into lim from public.edificios where id = new.edificio_id;
  perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{residente,propietario}', new.depto),
    '🅿️ Tu visita ocupa el estacionamiento ' || new.est_nombre,
    concat_ws(' · ', nullif(new.patente, ''), case when lim > 0 then 'Tiempo máximo: ' || privado.dur(lim) end), '#visitas');
  return null;
end $$;
drop trigger if exists push_est_uso on public.estacionamiento_usos;
create trigger push_est_uso after insert on public.estacionamiento_usos for each row execute function privado.tg_push_est_uso();

-- Revisa los estacionamientos ocupados: al cumplirse el primer plazo avisa al residente; al
-- cumplirse el segundo informa a administración y comité. Cada aviso se envía una sola vez.
create or replace function privado.revisar_estacionamientos(p_e uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; mins int; n int := 0;
begin
  perform set_config('mi_edificio.interno', '1', true);
  for r in select u.*, e.est_alerta_min a, e.est_aviso_min m
           from public.estacionamiento_usos u join public.edificios e on e.id = u.edificio_id
           where u.fin is null and (p_e is null or u.edificio_id = p_e) and (e.est_alerta_min > 0 or e.est_aviso_min > 0)
  loop
    mins := floor(extract(epoch from now() - r.inicio) / 60);
    if r.a > 0 and mins >= r.a and r.alerta_residente_at is null then
      update public.estacionamiento_usos set alerta_residente_at = now() where id = r.id; n := n + 1;
      perform privado.push(r.edificio_id, privado.usuarios_de(r.edificio_id, '{residente,propietario}', r.depto),
        '🅿️ Tu visita lleva ' || privado.dur(mins) || ' estacionada',
        'Estacionamiento ' || r.est_nombre || case when r.m > r.a then '. Al cumplir ' || privado.dur(r.m) || ' se informará a la administración.' else '' end, '#visitas');
    end if;
    if r.m > 0 and mins >= r.m and r.aviso_admin_at is null then
      update public.estacionamiento_usos set aviso_admin_at = now() where id = r.id; n := n + 1;
      perform privado.push(r.edificio_id, privado.usuarios_de(r.edificio_id, '{comite,admin}'),
        '🅿️ Estacionamiento de visita excedido',
        concat_ws(' · ', r.est_nombre, 'Depto ' || r.depto, nullif(r.patente, ''), privado.dur(mins)), '#estacionamientos');
    end if;
  end loop;
  perform set_config('mi_edificio.interno', '', true);
  return n;
end $$;

-- La app de conserjería la llama mientras está abierta (respaldo si no hay pg_cron)
create or replace function public.revisar_estacionamientos() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_staff() then raise exception 'Sin permiso'; end if;
  return privado.revisar_estacionamientos(public.mi_edificio());
end $$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('mi-edificio-estacionamientos', '*/5 * * * *', 'select privado.revisar_estacionamientos()');
exception when others then
  raise notice 'pg_cron no disponible: los avisos de estacionamiento solo se revisan mientras conserjería tiene la app abierta';
end $$;

create or replace function privado.clp(m numeric) returns text
language sql immutable as $$ select '$' || replace(to_char(round(m), 'FM999,999,999,990'), ',', '.') $$;

create or replace function privado.tg_push_pago() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{residente,propietario}', new.depto),
    '💳 Pago registrado', privado.clp(new.monto) || ' · ' || coalesce('gastos comunes ' || new.periodo, 'convenio de pago'), '#gastos');
  return null;
end $$;
drop trigger if exists push_pago on public.pagos;
create trigger push_pago after insert on public.pagos for each row execute function privado.tg_push_pago();

create or replace function privado.tg_push_convenio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{residente,propietario}', new.depto),
      '🤝 Convenio de pago por aceptar', privado.clp(new.monto_total) || ' en ' || new.cuotas || ' cuotas', '#gastos');
  elsif new.estado is distinct from old.estado and new.estado in ('vigente','anulado') and old.estado = 'propuesto' then
    perform privado.push(new.edificio_id, privado.usuarios_de(new.edificio_id, '{admin}', null, null, auth.uid()),
      case new.estado when 'vigente' then '🤝 Convenio aceptado' else '🤝 Convenio rechazado' end, 'Depto ' || new.depto || ' · ' || privado.clp(new.monto_total), '#finanzas');
  end if;
  return null;
end $$;
drop trigger if exists push_convenio on public.convenios;
create trigger push_convenio after insert or update on public.convenios for each row execute function privado.tg_push_convenio();

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

  m := privado.meses(r, 'estacionamientos');
  if m > 0 then
    delete from public.estacionamiento_usos where edificio_id = p_e and fin is not null and fin < now() - make_interval(months => m);
    get diagnostics n = row_count; res := res || jsonb_build_object('estacionamientos', n);
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
  perform cron.schedule('mi-edificio-depurar', '23 7 * * *', 'select privado.tareas_diarias()');
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
alter table public.estacionamientos enable row level security;
alter table public.estacionamiento_usos enable row level security;
alter table public.pagos            enable row level security;
alter table public.convenios        enable row level security;
alter table public.convenio_cuotas  enable row level security;
alter table public.caja_movimientos enable row level security;
alter table public.lecturas         enable row level security;
alter table public.fondos           enable row level security;
alter table public.fondo_movimientos enable row level security;
alter table public.cargos           enable row level security;
alter table public.indicadores      enable row level security;
alter table public.multas_catalogo  enable row level security;
alter table public.infracciones     enable row level security;
alter table public.infraccion_eventos enable row level security;
alter table public.infraccion_votos enable row level security;

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

-- estacionamientos de visita: el personal los ve; la administración los define.
-- usos: conserjería/admin ocupan y liberan; cada unidad ve los de sus visitas
select public._pol('estacionamientos','est_sel','select','public.es_staff()');
select public._pol('estacionamientos','est_ins','insert','public.es_admin()');
select public._pol('estacionamientos','est_upd','update','public.es_admin()');
select public._pol('estacionamientos','est_del','delete','public.es_admin()');
select public._pol('estacionamiento_usos','eu_sel','select','public.es_staff() or (public.es_residente() and depto = public.mi_depto())');
select public._pol('estacionamiento_usos','eu_ins','insert','public.mi_rol() in (''conserje'',''admin'')');
select public._pol('estacionamiento_usos','eu_upd','update','public.mi_rol() in (''conserje'',''admin'')');

-- pagos, convenios y cuotas: comité y administración ven todo; cada unidad, lo suyo.
-- Los pagos los registra y anula la administración; los convenios se crean y cambian con sus funciones.
select public._pol('pagos','pag_sel','select','public.mi_rol() in (''comite'',''admin'') or (public.es_residente() and depto = public.mi_depto())');
select public._pol('pagos','pag_ins','insert','public.es_admin()');
select public._pol('pagos','pag_upd','update','public.es_admin()');
select public._pol('convenios','cv_sel','select','public.mi_rol() in (''comite'',''admin'') or (public.es_residente() and depto = public.mi_depto())');
select public._pol('convenio_cuotas','cc_sel','select','public.mi_rol() in (''comite'',''admin'') or (public.es_residente() and depto = public.mi_depto())');
-- caja: comité y administración leen; la administración registra
select public._pol('caja_movimientos','cj_sel','select','public.mi_rol() in (''comite'',''admin'')');
select public._pol('caja_movimientos','cj_ins','insert','public.es_admin()');
select public._pol('caja_movimientos','cj_upd','update','public.es_admin()');
select public._pol('caja_movimientos','cj_del','delete','public.es_admin()');
-- lecturas: conserjería y administración las ingresan; comité las ve; cada unidad ve las suyas
select public._pol('lecturas','lec_sel','select','public.mi_rol() in (''conserje'',''comite'',''admin'') or (public.es_residente() and depto = public.mi_depto())');
select public._pol('lecturas','lec_ins','insert','public.mi_rol() in (''conserje'',''admin'')');
select public._pol('lecturas','lec_upd','update','public.mi_rol() in (''conserje'',''admin'')');
select public._pol('lecturas','lec_del','delete','public.mi_rol() in (''conserje'',''admin'')');
-- fondos: la comunidad ve fondos y saldos (es su plata); la administración los gestiona
select public._pol('fondos','fon_sel','select','public.mi_rol() in (''residente'',''propietario'',''comite'',''admin'')');
select public._pol('fondos','fon_ins','insert','public.es_admin()');
select public._pol('fondos','fon_upd','update','public.es_admin()');
select public._pol('fondo_movimientos','fm_sel','select','public.mi_rol() in (''residente'',''propietario'',''comite'',''admin'')');
select public._pol('fondo_movimientos','fm_ins','insert','public.es_admin()');
select public._pol('fondo_movimientos','fm_del','delete','public.es_admin()');
-- cargos: la administración los registra; el comité los ve; cada unidad ve los suyos
select public._pol('cargos','car_sel','select','public.mi_rol() in (''comite'',''admin'') or (public.es_residente() and depto = public.mi_depto())');
select public._pol('cargos','car_ins','insert','public.es_admin()');
select public._pol('cargos','car_upd','update','public.es_admin()');
-- multas: catálogo e indicadores visibles para la comunidad; los casos, para administración y comité, para quien
-- los abrió, y para la unidad una vez formulados los cargos. Los casos solo cambian por las funciones del procedimiento.
select public._pol('indicadores','ind_sel','select','public.mi_rol() is not null');
select public._pol('indicadores','ind_ins','insert','public.es_admin()');
select public._pol('indicadores','ind_upd','update','public.es_admin()');
select public._pol('indicadores','ind_del','delete','public.es_admin()');
select public._pol('multas_catalogo','mc_sel','select','public.mi_rol() is not null and public.mi_rol() <> ''mantencion''');
select public._pol('multas_catalogo','mc_ins','insert','public.es_admin()');
select public._pol('multas_catalogo','mc_upd','update','public.es_admin()');
select public._pol('infracciones','inf_sel','select','public.mi_rol() in (''comite'',''admin'') or creado_por = auth.uid() or (public.es_residente() and depto = public.mi_depto() and estado not in (''abierto'',''archivado''))');
select public._pol('infraccion_eventos','ie_sel','select','exists (select 1 from public.infracciones i where i.id = infraccion_id)');
select public._pol('infraccion_votos','iv_sel','select','public.mi_rol() in (''comite'',''admin'')');

-- archivos_por_borrar: la administración los lee y los quita de la cola al borrarlos del bucket
select public._pol('archivos_por_borrar','apb_sel','select','public.es_admin()');
select public._pol('archivos_por_borrar','apb_del','delete','public.es_admin()');

drop function public._pol(text, text, text, text, text, boolean);

-- ---------------------------------------------------------------------
-- Storage: bucket privado "fotos". Los archivos se abren con URLs firmadas de corta duración,
-- que solo puede pedir quien tiene permiso de lectura sobre el archivo (logo, incidencias, rondas, documentos)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('fotos','fotos', false)
on conflict (id) do update set public = false;

-- ¿Puede quien llama leer este archivo? Rutas: <edificio_id>/<carpeta>/<fecha>/<archivo>.
-- Cada carpeta sigue la misma regla que la tabla que referencia sus archivos: p. ej. la foto de
-- una encomienda la ven conserjería, administración y la unidad destinataria.
-- (Los archivos de la versión de un solo edificio no llevan <edificio_id>: pertenecen al primer edificio.)
create or replace function public.puede_ver_archivo(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare seg text[] := storage.foldername(p_name); e uuid := public.mi_edificio(); r rol_t := public.mi_rol(); c text;
begin
  if e is null or r is null or seg is null or cardinality(seg) < 1 then return false; end if;
  if seg[1] = e::text then c := seg[2];
  elsif seg[1] in ('logo','comunicados','documentos','encomiendas','rondas','incidencias','ot','img')
        and e = (select id from public.edificios order by creado, id limit 1) then c := seg[1];
  else return false;
  end if;
  if c in ('logo','comunicados') then return true; end if;
  if c = 'documentos' then return r <> 'mantencion'; end if;
  if c = 'rondas' then return r in ('conserje','comite','admin'); end if;
  if c = 'encomiendas' then
    return r in ('conserje','admin') or exists (
      select 1 from public.encomiendas x where x.edificio_id = e and x.foto = p_name and r in ('residente','propietario') and x.depto = public.mi_depto());
  end if;
  if c = 'incidencias' then
    return r in ('conserje','comite','admin')
      or exists (select 1 from public.incidencias i
                 where i.edificio_id = e and r in ('residente','propietario') and i.depto = public.mi_depto()
                   and (p_name = any(i.fotos) or exists (
                         select 1 from jsonb_array_elements(i.historial) h where jsonb_typeof(h->'fotos') = 'array' and h->'fotos' ? p_name)))
      or (r = 'mantencion' and exists (select 1 from public.ot o where o.edificio_id = e and o.empresa_id = public.mi_empresa() and p_name = any(o.fotos_antes)));
  end if;
  if c = 'multas' then
    return r in ('comite','admin') or exists (select 1 from public.infracciones x where x.edificio_id = e
      and (p_name = any(x.evidencias) or p_name = any(x.descargos_fotos))
      and (x.creado_por = auth.uid() or (r in ('residente','propietario') and x.depto = public.mi_depto() and x.estado not in ('abierto','archivado'))));
  end if;
  if c = 'ot' then
    return r in ('comite','admin') or (r = 'mantencion' and exists (
      select 1 from public.ot o where o.edificio_id = e and o.empresa_id = public.mi_empresa()
        and (p_name = any(o.fotos_antes) or p_name = any(o.fotos_despues) or o.factura = p_name)));
  end if;
  return r in ('conserje','comite','admin');
end $$;

drop policy if exists "fotos_read"   on storage.objects;
drop policy if exists "fotos_insert" on storage.objects;
drop policy if exists "fotos_delete" on storage.objects;
-- Leer (firmar una URL, listar) exige permiso sobre el archivo concreto
create policy "fotos_read"   on storage.objects for select to authenticated using (bucket_id = 'fotos' and public.puede_ver_archivo(name));
-- Los archivos de cada edificio viven bajo la carpeta <edificio_id>/
create policy "fotos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mi_edificio()::text);
create policy "fotos_delete" on storage.objects for delete to authenticated using (bucket_id = 'fotos' and (storage.foldername(name))[1] = public.mi_edificio()::text and public.mi_rol() in ('admin','comite'));

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['edificios','empresas','usuarios','unidades','gastos','gasto_unidades','reservas','incidencias','conversaciones','mensajes','comunicados','documentos','encomiendas','visitas','activos','registros','ot','encuestas','votos','estacionamientos','estacionamiento_usos','pagos','convenios','convenio_cuotas','caja_movimientos','lecturas','fondos','fondo_movimientos','cargos','indicadores','multas_catalogo','infracciones','infraccion_eventos','infraccion_votos']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Listo. Siguiente paso: crea tu cuenta desde la app y crea el edificio (quedarás como su administrador).
