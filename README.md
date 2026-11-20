# Mi Edificio

[![CI](https://github.com/Ctuna89/mi-edificio/actions/workflows/ci.yml/badge.svg)](https://github.com/Ctuna89/mi-edificio/actions/workflows/ci.yml) [![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

App web para residentes, conserjería, comité, administración y empresas de mantención de un edificio.
Frontend estático (HTML/JS, sin build) + Supabase (Auth, Postgres con RLS, Storage, Realtime).
Una misma instalación puede alojar varios edificios, aislados entre sí por las políticas RLS.

```
mi-edificio/
├── web/                 ← sitio estático (súbelo tal cual a Vercel / Netlify / Cloudflare Pages)
│   ├── index.html
│   ├── app.js           ← todas las vistas
│   ├── xlsx.js          ← generador de Excel sin dependencias
│   ├── sw.js            ← service worker (notificaciones push)
│   ├── config.js        ← URL y anon key de tu proyecto Supabase (+ clave VAPID opcional)
│   ├── manifest.webmanifest
│   └── icon.svg
└── supabase/
    ├── schema.sql       ← tablas, políticas RLS, bucket de fotos, realtime y triggers
    ├── functions/push/  ← Edge Function que envía las notificaciones push (opcional)
    └── tests/           ← pruebas del esquema en un Postgres local
```

## 1. Crear el proyecto Supabase (10 min)

1. Entra a https://supabase.com → **New project** (región: South America / São Paulo es la más cercana a Chile).
2. **SQL Editor → New query** → pega el contenido completo de `supabase/schema.sql` → **Run**.
   El script es idempotente: puedes volver a correrlo si cambias algo.
3. **Authentication → Providers → Email**: deja habilitado *Email*.
   - Para pruebas rápidas desactiva **Confirm email** (los usuarios entran de inmediato).
   - En producción déjalo activado y configura un SMTP propio en *Authentication → SMTP Settings* (el SMTP de Supabase tiene límite de ~3 correos/hora).
4. **Authentication → URL Configuration**: en *Site URL* pon la URL donde quedará la app (p. ej. `https://miedificio.vercel.app`) y agrégala también en *Redirect URLs*.
5. **Project Settings → API**: copia **Project URL** y **anon public key** y pégalos en `web/config.js`.

## 2. Publicar el sitio

Cualquier hosting de archivos estáticos sirve. Opciones sin costo:

- **Vercel**: `vercel deploy web/` o arrastra la carpeta `web` en vercel.com/new.
- **Netlify**: arrastra la carpeta `web` en app.netlify.com/drop.
- **Cloudflare Pages**: crea un proyecto "Direct upload" y sube `web`.
- **GitHub Pages**: sube `web/` a un repo y activa Pages.

No hay paso de build. Si cambias `config.js` solo vuelve a subir la carpeta.

## 3. Primer uso

1. Abre la app → **Crear cuenta** con tu correo → **Crear un edificio nuevo** (nombre del edificio y tu nombre).
   Quien crea el edificio queda como su **Administrador activo**.
2. Entra a **Administración → Edificio**: logo, dirección, color, datos bancarios. Ahí mismo está el **enlace de invitación** del edificio.
3. **Unidades**: carga los departamentos con su alícuota (hay carga masiva pegando `depto;alícuota;propietario` por línea). La suma debe dar 100 %.
4. **Espacios**: botón "Cargar ejemplos" crea quincho, salón, gimnasio y sala de juegos; edita reglas (horario, máx. horas, anticipación, si requiere aprobación).
5. **Empresas** y **Activos** (para rondas NFC y mantención preventiva).
6. Comparte el enlace de invitación con residentes y conserjes. Cuando se registren, aparecerán en **Administración → Usuarios** como pendientes: asígnales depto y rol y actívalos.

Como administrador tienes el selector **"Ver como"** para revisar la interfaz de cada rol (sigues teniendo permisos de admin en la base de datos; solo cambia la vista).

## Módulos

| Módulo | Residente / Propietario | Conserje | Comité | Admin | Empresa mantención |
|---|---|---|---|---|---|
| Gastos comunes (desglose, prorrateo, estado de pago, PDF/Excel) | ve y descarga su aviso de cobro | – | ve todo y exporta | edita, marca pagos, exporta | – |
| Reservas de áreas comunes | reserva / cancela | ve agenda | aprueba | aprueba, configura | – |
| Incidencias con fotos | reporta, cierra las suyas | gestiona, se asigna | gestiona | gestiona, crea OT | ve las ligadas a sus OT |
| Mensajes (canales conserjería / comité / administración) | chat por canal | canal conserjería | canal comité | todos | – |
| Comunicados | lee | lee | publica | publica | lee |
| Encuestas (un voto por unidad) | vota, ve totales | – | crea, cierra, ve totales | crea, cierra, ve totales | – |
| Documentos (reglamento, actas, balances) | lee | lee | sube | sube | – |
| Encomiendas | ve las suyas | registra / entrega | – | registra / entrega | – |
| Visitas | anuncia | registra ingreso/salida | – | registra | – |
| Rondas NFC y bitácora (cumplimiento diario) | – | registra | ve | registra, ve | – |
| Mantención: activos, plan preventivo, OT | – | – | ve | crea, aprueba | acepta, agenda, ejecuta, cierra |
| Administración (edificio, usuarios, unidades, espacios, activos, empresas) | – | – | – | ✔ | – |

La seguridad está en la base de datos (políticas RLS en `schema.sql`), no en el frontend: aunque alguien modifique el JS, solo puede leer y escribir lo que su rol permite, y solo dentro de su edificio.

## Varios edificios

- Cada tabla lleva `edificio_id` y toda política RLS exige que coincida con el edificio del usuario. Un usuario pertenece a un solo edificio.
- **Unirse**: cada edificio tiene un enlace y un código de invitación (Administración → Edificio). Si la instalación tiene un solo edificio, quien se registra lo encuentra sin código, como antes.
- **Crear más edificios**: por seguridad, solo el primer edificio se puede crear libremente. Para permitir que cuentas nuevas creen otros edificios, ejecuta en el SQL Editor:

  ```sql
  update public.plataforma set creacion_abierta = true;
  ```

  Vuelve a ponerlo en `false` cuando termines si no quieres que cualquiera con la URL cree edificios.
- Las fotos y documentos de cada edificio se guardan bajo la carpeta `<edificio_id>/` del bucket.

## Encuestas

El comité o la administración publican una pregunta con opciones, plazo opcional y, si corresponde, restringida a propietarios. Cada **unidad** emite un voto y puede cambiarlo mientras la encuesta esté abierta. Nadie ve el voto de otra unidad: la app solo muestra totales (cantidad de votos y suma de alícuotas por opción). Los residentes ven los resultados cuando su unidad ya votó o la encuesta terminó.

## Exportar gastos comunes

- **Comité / administración**: en el detalle de un período, botones **PDF** y **Excel** con los ítems y el prorrateo por unidad (alícuota, monto, estado de pago).
- **Residentes**: descargan su aviso de cobro del período vigente en PDF o Excel.

El Excel es un `.xlsx` real generado en el navegador (`web/xlsx.js`, sin dependencias). El PDF usa el diálogo de impresión del navegador: elige "Guardar como PDF".

## Notificaciones push (opcional)

Avisos en el teléfono o computador cuando llega una encomienda, hay un mensaje nuevo o algo queda por aprobar o se resuelve (reservas, solicitudes de acceso, órdenes de trabajo). Sin esta configuración la app funciona igual, solo que sin avisos.

1. Genera un par de claves VAPID:

   ```bash
   npx web-push generate-vapid-keys
   ```

2. Pon la clave **pública** en `web/config.js` (`VAPID_PUBLIC_KEY`) y vuelve a publicar el sitio.
3. Despliega la función con la [CLI de Supabase](https://supabase.com/docs/guides/cli) y define sus secretos (inventa un `PUSH_SECRET` largo y aleatorio):

   ```bash
   supabase functions deploy push --no-verify-jwt --project-ref TU-PROYECTO
   ```

   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:tu@correo.cl PUSH_SECRET=... --project-ref TU-PROYECTO
   ```

4. En el SQL Editor, indica a la base de datos dónde está la función (mismo `PUSH_SECRET`):

   ```sql
   update public.plataforma
   set push_url = 'https://TU-PROYECTO.supabase.co/functions/v1/push', push_secret = 'EL_MISMO_PUSH_SECRET';
   ```

5. Cada persona activa los avisos en **Mi cuenta → Notificaciones**, en cada dispositivo.

Cómo funciona: triggers de `schema.sql` deciden a quién avisar y llaman a la función con la extensión `pg_net` (si `schema.sql` avisó que no pudo activarla, habilítala en *Database → Extensions*). La función solo acepta llamadas con el secreto y envía a los servicios de push de los navegadores. La clave privada VAPID y el secreto nunca van en el repositorio ni en `config.js`.

Limitaciones: en iPhone/iPad las notificaciones web solo funcionan con la app agregada a la pantalla de inicio (iOS 16.4 o superior).

## Fotos y archivos

Se guardan en el bucket `fotos` de Supabase Storage (lectura pública por URL, escritura solo de usuarios activos en la carpeta de su edificio). Las imágenes se comprimen en el navegador a 1280 px antes de subir. El plan gratuito incluye 1 GB.

## NFC

El escaneo usa **Web NFC**, disponible solo en Chrome para Android. Graba en cada tag un registro de texto con el código que pusiste en el activo (p. ej. `CHK-P12`). En otros dispositivos el conserje puede escribir el código o elegir el activo de la lista.

## Pagos en línea

No incluidos por decisión de alcance. Si más adelante se agrega (Webpay, Khipu, Fintoc), lo correcto es hacerlo en una **Edge Function** de Supabase que reciba la confirmación del proveedor y marque `gasto_unidades.pagado`, nunca desde el navegador.

## Actualizar una instalación anterior (un solo edificio)

Vuelve a ejecutar `supabase/schema.sql` completo en el SQL Editor y publica de nuevo la carpeta `web/`. El script migra solo: la fila de `config` pasa a ser el primer edificio (tabla `edificios`) y todos los datos existentes quedan asociados a él. Haz un respaldo antes (*Database → Backups*).

Los archivos subidos antes de la actualización siguen visibles, pero quedan fuera de la carpeta del edificio: desde la app ya no se pueden borrar del bucket (sí desde el panel de Supabase).

## Pruebas

`supabase/tests/run.sh` aplica el esquema en un Postgres local (con sustitutos mínimos de `auth`, `storage` y `pg_net`) y verifica instalación nueva, idempotencia, aislamiento entre edificios, encuestas, avisos y la migración desde la versión de un solo edificio:

```bash
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh
```

La CI lo ejecuta en cada push junto con la verificación de sintaxis del frontend.

## Costos estimados

- Supabase Free: 500 MB base de datos, 1 GB storage, 50.000 usuarios auth. Suficiente para un edificio. Pro: US$25/mes.
- Hosting estático: gratis en Vercel / Netlify / Cloudflare Pages.

## Próximos pasos sugeridos

1. Desplegar y probar de punta a punta en un proyecto Supabase real (en especial las notificaciones push).
2. Administradoras con varios edificios: que una misma cuenta pueda pertenecer a más de un edificio y cambiar entre ellos.
3. Pagos en línea mediante Edge Function.
4. Avisos push para comunicados y encuestas nuevas.

## Contribuir

Mi Edificio es software libre: úsalo, adáptalo a tu comunidad y envía mejoras. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) para preparar el entorno y conocer las reglas del proyecto (sin frameworks, seguridad en RLS, `schema.sql` idempotente). Las vulnerabilidades se reportan en privado desde *Security → Report a vulnerability*.

## Licencia

[MIT](LICENSE).
