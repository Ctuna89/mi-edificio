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
│   ├── vendor/          ← librerías de QR de terceros (ver vendor/README.md)
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
2. Se abre el **asistente de configuración**, una ventana de 7 pasos: datos del edificio, unidades y alícuotas, datos bancarios, espacios comunes, visitas y estacionamientos, datos personales (plazos de conservación y aviso de privacidad) e invitación a la comunidad. Cada paso se guarda al avanzar, así que puedes dejarlo y retomarlo desde Inicio o desde Administración → Edificio.

Todo lo que configura el asistente también se puede ajustar a mano después:

1. **Administración → Edificio**: logo, dirección, color, datos bancarios. Ahí mismo está el **enlace de invitación** del edificio.
2. **Unidades**: carga los departamentos con su alícuota (hay carga masiva pegando `depto;alícuota;propietario` por línea; la alícuota admite coma decimal). La suma debe dar 100 %.
3. **Espacios**: botón "Cargar ejemplos" crea quincho, salón, gimnasio y sala de juegos; edita reglas (horario, máx. horas, anticipación, si requiere aprobación).
4. **Empresas** y **Activos** (para rondas NFC y mantención preventiva).
5. Comparte el enlace de invitación con residentes y conserjes. Cuando se registren, aparecerán en **Administración → Usuarios** como pendientes: asígnales depto y rol y actívalos.

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
| Visitas con QR | anuncia y comparte el QR | escanea, registra ingreso/salida | – | escanea, registra | – |
| Estacionamientos de visita | ve el de su visita | ocupa / libera | ve, recibe excesos | define, ocupa / libera, recibe excesos | – |
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

Avisos en el teléfono o computador cuando llega una encomienda o una visita, hay un mensaje nuevo o algo queda por aprobar o se resuelve (reservas, solicitudes de acceso, órdenes de trabajo). Sin esta configuración la app funciona igual, solo que sin avisos.

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

## Seguridad

El modelo de seguridad, las limitaciones conocidas y una lista de verificación para configurar Supabase están en [`SECURITY.md`](SECURITY.md). Lo esencial: activa la confirmación de correo y el CAPTCHA en Supabase Auth, protege con MFA tu cuenta de Supabase, y limita quién tiene acceso al proyecto.

## Datos personales (Chile)

La app trata datos personales de residentes, trabajadores y visitas: nombre, teléfono, correo, unidad, RUT y patente de visitas, fotos, mensajes, votos y estado de pago de gastos comunes. En Chile eso está regulado por la Ley 19.628, reformada por la **Ley 21.719** (crea la Agencia de Protección de Datos Personales y multas de hasta 20.000 UTM). Su entrada en vigencia estaba fijada para el 1 de diciembre de 2026 y a noviembre de 2026 se tramitaba una postergación a octubre de 2027: verifica la fecha vigente.

Esto no es asesoría legal. Quién responde por qué:

- **Responsable de los datos**: la comunidad de copropietarios (a través de su comité y administración), no este proyecto. Si operas la instalación para comunidades ajenas, actúas como encargado y conviene un contrato que lo regule.
- **Supabase y el hosting** son proveedores que tratan los datos por cuenta del responsable, normalmente fuera de Chile (transferencia internacional): revisa sus condiciones de tratamiento de datos.

Lo que la app ya trae para cumplir:

| Obligación | Cómo se cubre |
|---|---|
| Informar al titular | Aviso de privacidad por edificio (Administración → Edificio), mostrado y aceptado al registrarse y disponible en Mi cuenta. Se guarda la fecha de aceptación. |
| Acceso y portabilidad | Mi cuenta → **Descargar mis datos** (JSON). |
| Rectificación | Cada persona edita su nombre y teléfono; unidad y rol los corrige la administración. |
| Supresión | Mi cuenta → **Eliminar mi cuenta**: borra nombre, teléfono y unidad y bloquea el acceso. El correo queda en Supabase Auth hasta que el operador elimine el usuario en *Authentication → Users*. |
| Conservación limitada | Administración → Edificio → **Conservación de datos**: la administración fija cuántos meses se guardan visitas, rondas, encomiendas entregadas, mensajes, reservas, incidencias cerradas y uso de estacionamientos. Lo que supera el plazo se borra a diario. |
| Seguridad y mínimo acceso | RLS por rol y por edificio; cada unidad ve solo sus cobros, encomiendas, visitas y voto. |

Lo que debe resolver cada comunidad (no lo hace el software):

1. Redactar su aviso de privacidad: quién es el responsable y cómo contactarlo, para qué se usan los datos, a quién se comunican, por cuánto tiempo se guardan y cómo ejercer los derechos. El texto por defecto es genérico.
2. Definir sus **plazos de conservación** en Administración → Edificio. Mientras no se definan, nada se borra: visitas (con RUT y patente de terceros), rondas, encomiendas y mensajes se acumulan indefinidamente. Gastos comunes, comunicados, documentos, encuestas y órdenes de trabajo no tienen borrado automático.
3. Pedir a las visitas solo los datos necesarios; RUT y patente son opcionales en el formulario.
4. Tener un procedimiento para responder solicitudes de los titulares y para avisar a la Agencia y a los afectados si hay una filtración.
5. Decidir qué se sube a Documentos: todo residente del edificio puede leer lo que se publique ahí (listados de morosidad o contratos con RUT no deberían ir).

### Cómo funciona el borrado por plazo

Una tarea diaria (`pg_cron`, 07:23 UTC) borra en cada edificio lo que supera sus plazos. Si al ejecutar `schema.sql` aparece el aviso de que `pg_cron` no está disponible, actívalo en *Database → Extensions* y vuelve a ejecutar el script; mientras tanto el borrado solo corre con el botón **Aplicar ahora**. El borrado es definitivo. Las fotos asociadas se eliminan del bucket la siguiente vez que alguien de la administración abre la app.

## Fotos y archivos

Se guardan en el bucket privado `fotos` de Supabase Storage. Nadie puede abrirlos sin sesión: la app pide a Supabase una URL firmada que dura 1 hora, y Supabase solo la entrega a quien puede leer ese archivo según su rol (por ejemplo, la foto de una encomienda la ven conserjería, administración y la unidad destinataria; las fotos de una orden de trabajo, la administración y la empresa asignada). Solo se puede subir a la carpeta del propio edificio. Las imágenes se comprimen en el navegador a 1280 px antes de subir. El plan gratuito incluye 1 GB.

## Visitas con QR

Al anunciar una visita, el residente obtiene un QR (con el nombre del edificio, la fecha y un código) que comparte como imagen, por ejemplo por WhatsApp. En conserjería se escanea con **Escanear QR**, o se escribe el código de 8 caracteres, y se abre la ficha de la visita para registrar el ingreso; al salir se escanea de nuevo para registrar la salida. Si las notificaciones push están configuradas, el residente recibe un aviso cuando su visita ingresa.

Al anunciar la visita se puede marcar que **necesita estacionamiento**. En Administración → Edificio, la administración decide si en ese caso la patente es obligatoria, pensado para accesos con lectura automática de patentes (LPR). La patente se guarda normalizada (mayúsculas, sin espacios ni guiones) para poder compararla con lo que lea la cámara. La app no se conecta a ningún sistema LPR: deja el dato disponible en la tabla `visitas`.

El QR no contiene datos personales, solo un código aleatorio: para saber a qué visita corresponde hay que tener sesión de conserjería o administración en ese edificio. La lectura usa el lector de códigos del navegador cuando existe (Chrome en Android) y, si no (iPhone, Firefox), una librería incluida en `web/vendor/`. La cámara requiere que la app esté publicada con HTTPS.

## Estacionamientos de visita

- **Administración → Estacionamientos**: se crean los estacionamientos de visita (por ejemplo V1…V6), se indica cuáles están reservados (discapacidad, carga y descarga, etc.) y se configuran dos tiempos en minutos.
- **Conserjería** ve el tablero en el módulo Estacionamientos: toca uno libre para marcarlo ocupado (departamento, patente y, si corresponde, la visita anunciada) y uno ocupado para liberarlo. Cada casilla muestra cuánto tiempo lleva y cambia de color al superar cada tiempo. Si una visita anunciada con estacionamiento registra su ingreso, la app lleva directo a elegirle un lugar.
- **Avisos**: al ocupar se avisa al residente con el tiempo máximo; al cumplirse el primer tiempo recibe una alerta; al cumplirse el segundo se informa a administración y comité, y el uso queda en la pestaña **Excedidos** como respaldo para cursar una multa según el reglamento. La app no calcula ni cobra multas.
- Los avisos al teléfono requieren las notificaciones push configuradas; sin ellas, los colores, la pestaña Excedidos y el aviso en la pantalla Visitas del residente funcionan igual.
- Los tiempos los revisa una tarea cada 5 minutos (`pg_cron`). Sin esa extensión, se revisan solo mientras conserjería o administración tienen abierto el módulo.

La hora de inicio y de término las pone la base de datos, no el teléfono de conserjería, y no se pueden editar desde la app.

## NFC

El escaneo usa **Web NFC**, disponible solo en Chrome para Android. Graba en cada tag un registro de texto con el código que pusiste en el activo (p. ej. `CHK-P12`). En otros dispositivos el conserje puede escribir el código o elegir el activo de la lista.

## Pagos en línea

No incluidos por decisión de alcance. Si más adelante se agrega (Webpay, Khipu, Fintoc), lo correcto es hacerlo en una **Edge Function** de Supabase que reciba la confirmación del proveedor y marque `gasto_unidades.pagado`, nunca desde el navegador.

## Actualizar una instalación anterior (un solo edificio)

Vuelve a ejecutar `supabase/schema.sql` completo en el SQL Editor y publica de nuevo la carpeta `web/`. El script migra solo: la fila de `config` pasa a ser el primer edificio (tabla `edificios`) y todos los datos existentes quedan asociados a él. Haz un respaldo antes (*Database → Backups*).

Los archivos subidos antes de la actualización quedan fuera de la carpeta del edificio: se siguen viendo con las mismas reglas por rol, pero desde la app ya no se pueden borrar del bucket (sí desde el panel de Supabase). Si tu bucket `fotos` era público, el script lo deja privado: cualquier enlace directo a un archivo que se haya compartido antes deja de funcionar.

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

## Versiones

La versión vigente está en el archivo [`VERSION`](VERSION) y los cambios de cada una en [`CHANGELOG.md`](CHANGELOG.md). Al fusionar una versión nueva en `main`, el workflow `Release` crea la etiqueta y el release en GitHub.

## Contribuir

Mi Edificio es software libre: úsalo, adáptalo a tu comunidad y envía mejoras. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) para preparar el entorno y conocer las reglas del proyecto (sin frameworks, seguridad en RLS, `schema.sql` idempotente). Las vulnerabilidades se reportan en privado desde *Security → Report a vulnerability*.

## Licencia

[MIT](LICENSE).
