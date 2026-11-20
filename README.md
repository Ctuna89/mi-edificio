# Mi Edificio

[![CI](https://github.com/Ctuna89/mi-edificio/actions/workflows/ci.yml/badge.svg)](https://github.com/Ctuna89/mi-edificio/actions/workflows/ci.yml) [![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

App web para residentes, conserjería, comité, administración y empresas de mantención de un edificio.
Frontend estático (HTML/JS, sin build) + Supabase (Auth, Postgres con RLS, Storage, Realtime).

```
mi-edificio/
├── web/                 ← sitio estático (súbelo tal cual a Vercel / Netlify / Cloudflare Pages)
│   ├── index.html
│   ├── app.js
│   ├── config.js        ← URL y anon key de tu proyecto Supabase
│   ├── manifest.webmanifest
│   └── icon.svg
└── supabase/
    └── schema.sql       ← tablas, políticas RLS, bucket de fotos y realtime
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

1. Abre la app → **Crear cuenta** con tu correo → completa tu perfil.
   **El primer usuario que se registra queda como Administrador activo** (lo decide un trigger en la base de datos). Todos los siguientes quedan *pendientes* hasta que un administrador los active.
2. Entra a **Administración → Edificio**: nombre, logo, dirección, color, datos bancarios.
3. **Unidades**: carga los departamentos con su alícuota (hay carga masiva pegando `depto;alícuota;propietario` por línea). La suma debe dar 100 %.
4. **Espacios**: botón "Cargar ejemplos" crea quincho, salón, gimnasio y sala de juegos; edita reglas (horario, máx. horas, anticipación, si requiere aprobación).
5. **Empresas** y **Activos** (para rondas NFC y mantención preventiva).
6. Comparte la URL con residentes y conserjes. Cuando se registren, aparecerán en **Administración → Usuarios** como pendientes: asígnales depto y rol y actívalos.

Como administrador tienes el selector **"Ver como"** para revisar la interfaz de cada rol (sigues teniendo permisos de admin en la base de datos; solo cambia la vista).

## Módulos

| Módulo | Residente / Propietario | Conserje | Comité | Admin | Empresa mantención |
|---|---|---|---|---|---|
| Gastos comunes (desglose, prorrateo, estado de pago) | ve su unidad | – | ve todo | edita, marca pagos | – |
| Reservas de áreas comunes | reserva / cancela | ve agenda | aprueba | aprueba, configura | – |
| Incidencias con fotos | reporta, cierra las suyas | gestiona, se asigna | gestiona | gestiona, crea OT | ve las ligadas a sus OT |
| Mensajes (canales conserjería / comité / administración) | chat por canal | canal conserjería | canal comité | todos | – |
| Comunicados | lee | lee | publica | publica | lee |
| Documentos (reglamento, actas, balances) | lee | lee | sube | sube | – |
| Encomiendas | ve las suyas | registra / entrega | – | registra / entrega | – |
| Visitas | anuncia | registra ingreso/salida | – | registra | – |
| Rondas NFC y bitácora (cumplimiento diario) | – | registra | ve | registra, ve | – |
| Mantención: activos, plan preventivo, OT | – | – | ve | crea, aprueba | acepta, agenda, ejecuta, cierra |
| Administración (edificio, usuarios, unidades, espacios, activos, empresas) | – | – | – | ✔ | – |

La seguridad está en la base de datos (políticas RLS en `schema.sql`), no en el frontend: aunque alguien modifique el JS, solo puede leer y escribir lo que su rol permite.

## Fotos y archivos

Se guardan en el bucket `fotos` de Supabase Storage (lectura pública por URL, escritura solo autenticados). Las imágenes se comprimen en el navegador a 1280 px antes de subir. El plan gratuito incluye 1 GB.

## NFC

El escaneo usa **Web NFC**, disponible solo en Chrome para Android. Graba en cada tag un registro de texto con el código que pusiste en el activo (p. ej. `CHK-P12`). En otros dispositivos el conserje puede escribir el código o elegir el activo de la lista.

## Pagos en línea

No incluidos por decisión de alcance. Si más adelante se agrega (Webpay, Khipu, Fintoc), lo correcto es hacerlo en una **Edge Function** de Supabase que reciba la confirmación del proveedor y marque `gasto_unidades.pagado`, nunca desde el navegador.

## Costos estimados

- Supabase Free: 500 MB base de datos, 1 GB storage, 50.000 usuarios auth. Suficiente para un edificio. Pro: US$25/mes.
- Hosting estático: gratis en Vercel / Netlify / Cloudflare Pages.

## Próximos pasos sugeridos

1. Notificaciones push (Web Push) para encomiendas, mensajes y aprobaciones.
2. Multi-edificio: agregar `edificio_id` a cada tabla y a `usuarios`; las políticas RLS pasan a comparar también ese campo.
3. Exportar gastos comunes a PDF / Excel.
4. Encuestas del comité.

## Contribuir

Mi Edificio es software libre: úsalo, adáptalo a tu comunidad y envía mejoras. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) para preparar el entorno y conocer las reglas del proyecto (sin frameworks, seguridad en RLS, `schema.sql` idempotente). Las vulnerabilidades se reportan en privado desde *Security → Report a vulnerability*.

## Licencia

[MIT](LICENSE).
