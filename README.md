# Mi Edificio

[![CI](https://github.com/Ctuna89/mi-edificio/actions/workflows/ci.yml/badge.svg)](https://github.com/Ctuna89/mi-edificio/actions/workflows/ci.yml) [![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

App web para residentes, conserjería, comité, administración y empresas de mantención de un edificio. Gratis y de código abierto.

Se instala **en un computador del propio edificio**: un solo programa sirve la app, guarda la base de datos y los archivos en una carpeta, y no depende de ningún servicio en la nube. Una instalación = un edificio.

```
mi-edificio/
├── local/               ← servidor local: lo único que hay que ejecutar
│   ├── server.mjs       ← sirve la app, la base de datos, las cuentas y los archivos
│   ├── cliente.js       ← conexión del navegador con el servidor
│   ├── base.sql         ← cuentas, archivos y cola de avisos
│   ├── iniciar.bat / iniciar.sh
│   └── datos/           ← se crea al iniciar: base de datos, archivos, respaldos (no va al repositorio)
├── web/                 ← la app (HTML y JS sin build)
└── supabase/
    ├── schema.sql       ← tablas, permisos por rol y reglas de negocio (se aplica solo al iniciar)
    ├── functions/push/  ← solo para la instalación alternativa en Supabase
    └── tests/           ← pruebas de permisos
```

## 1. Instalar en un computador del edificio

Necesitas un computador que quede encendido (el de conserjería o administración sirve) con [Node.js](https://nodejs.org) 20 o superior.

1. Descarga este repositorio (botón **Code → Download ZIP**, o `git clone`).
2. Inicia el servidor:
   - **Windows**: doble clic en `local/iniciar.bat`.
   - **Mac o Linux**:

     ```bash
     ./local/iniciar.sh
     ```

   La primera vez descarga sus dependencias (necesita internet) y crea la carpeta `local/datos`.
3. Abre la dirección que muestra, por ejemplo `http://localhost:8080`.

Con eso la app ya funciona en ese computador y, por la dirección de red que también muestra, en los equipos conectados a la red del edificio. Para que residentes y conserjes entren desde sus teléfonos, sigue con el paso 2.

Para cambiar el puerto, define la variable `PUERTO`; para guardar los datos en otra carpeta, `MI_EDIFICIO_DATOS`.

## 2. Acceso desde internet

Los residentes entran desde fuera del edificio, y la cámara (QR de visitas) y las notificaciones exigen una dirección **HTTPS**. Lo más simple es un túnel: un programa en el mismo computador que publica el servidor en una dirección segura, sin abrir puertos del router. Los datos siguen en tu computador; el túnel solo los transporta.

Con [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (gratis):

- **Para probar**, sin cuenta: instala `cloudflared` y ejecuta

  ```bash
  cloudflared tunnel --url http://localhost:8080
  ```

  Entrega una dirección `https://….trycloudflare.com` que cambia cada vez que lo reinicias.
- **Para uso permanente**: crea una cuenta en Cloudflare, agrega un dominio propio (unos US$10 al año) y configura un túnel con nombre hacia `http://localhost:8080`, instalado como servicio para que parta con el computador. La dirección queda fija, por ejemplo `https://app.miedificio.cl`.

Esta parte no está probada por el proyecto con un túnel real; si la configuras, cuéntanos cómo te fue. Cualquier otro túnel o proxy inverso con HTTPS sirve, siempre que reenvíe la cabecera `X-Forwarded-Proto`.

Abrir un puerto del router rara vez es opción: muchos proveedores no entregan una IP pública propia.

## 3. Primer uso

1. Abre la app → **Crear cuenta** → **Configura tu edificio**. La primera cuenta crea el edificio y queda como su **administrador**.
2. Se abre el **asistente de configuración**, 8 pasos que se guardan al avanzar: datos del edificio, unidades y alícuotas, datos bancarios, espacios comunes, visitas y estacionamientos, datos personales, respaldo en la nube e invitación. Puedes dejarlo y retomarlo desde Inicio o Administración → Edificio.
3. Comparte la dirección de la app con residentes y conserjes. Cada persona crea su cuenta y queda **pendiente**: aparece en Administración → Usuarios, donde le asignas depto y rol y la activas.

Como administrador tienes el selector **"Ver como"** para revisar la interfaz de cada rol (solo cambia la vista, no tus permisos).

**Contraseñas olvidadas.** No hay correo de recuperación: la administración fija una nueva en Administración → Usuarios → "Nueva contraseña" y se la entrega a la persona, que después la cambia en Mi cuenta. Si quien la olvida es el único administrador, no hay forma de recuperarla desde la app: conviene tener dos.

## 4. Respaldos y mantención

Todo lo de tu edificio está en `local/datos`:

| Carpeta | Contenido |
|---|---|
| `db/` | Base de datos |
| `archivos/` | Fotos y documentos subidos |
| `respaldos/` | Copia local de la base de datos de cada día (últimos 14), a la hora del respaldo, y una al detener el servidor |
| `config.json` | Claves propias de esta instalación (no lo compartas) |

### Respaldo en la nube

Para que una falla del computador no se lleve todo, Mi Edificio deja cada día una copia **cifrada** de la base de datos, las fotos y los documentos en una carpeta que tú eliges. Si esa carpeta pertenece a una nube, su aplicación la sube sola:

1. Instala en el computador del edificio la app de **OneDrive**, **Google Drive**, Dropbox o iCloud e inicia sesión en ella.
2. En el asistente inicial (paso "Respaldo en la nube") o en **Administración → Edificio → Respaldo en la nube**, elige la carpeta. La app propone las carpetas de nube que encuentra en el computador; también puedes escribir la ruta, por ejemplo `C:\Users\Conserjeria\OneDrive\Respaldo Mi Edificio`.
3. Define la **contraseña del respaldo** y anótala fuera del computador. Sin ella el respaldo no se puede abrir, y nadie puede restablecerla.
4. Elige la **hora del respaldo diario** (por defecto 03:00, según el reloj del computador). Mientras se respalda, la app puede dejar de responder unos minutos, así que conviene una hora de poco uso. Si el computador está apagado a esa hora, el respaldo se hace cuando vuelva a encenderse ese mismo día.

Si la carpeta no parece estar dentro de una nube, la app lo advierte: el respaldo se haría igual, pero quedaría solo en ese computador. La advertencia se basa en el nombre de la ruta, así que confirma en la app de tu nube que la carpeta realmente se está sincronizando. Inicio avisa a la administración si no hay respaldo configurado, si el último falló o si lleva más de 3 días sin hacerse.

**Restaurar en un computador nuevo**: instala Mi Edificio y la app de tu nube, espera a que baje la carpeta y ejecuta

```bash
./local/iniciar.sh --restaurar-nube "/ruta/a/Respaldo Mi Edificio"
```

(en Windows, `local\iniciar.bat --restaurar-nube "C:\ruta\Respaldo Mi Edificio"`). Pide la contraseña del respaldo y recupera cuentas, datos y archivos. Después vuelve a configurar el respaldo en Administración.

### Otras tareas

- **Copia manual**: con el servidor detenido, la carpeta `local/datos` completa es un respaldo sin cifrar.
- **Restaurar solo la base de datos** desde una copia diaria local: con la carpeta `db/` vacía,

  ```bash
  ./local/iniciar.sh --restaurar local/datos/respaldos/mi-edificio-AAAA-MM-DD.tar.gz
  ```

- **Actualizar**: detén el servidor, reemplaza los archivos del repositorio por la versión nueva (sin tocar `local/datos`) e inícialo. Los cambios de la base de datos se aplican solos.
- **Si el computador se apaga** o se corta internet, la app deja de responder hasta que vuelva. Conviene configurar que el servidor parta al encender el equipo.

Límites: está pensada para un edificio. La base de datos atiende una consulta a la vez, lo que alcanza de sobra para ese tamaño, y usa PGlite, un Postgres embebido todavía joven.

## Módulos

| Módulo | Residente / Propietario | Conserje | Comité | Admin | Empresa mantención |
|---|---|---|---|---|---|
| Gastos comunes (desglose, prorrateo, estado de pago, PDF/Excel) | ve y descarga su aviso de cobro | – | ve todo y exporta | edita, registra pagos, exporta | – |
| Finanzas: pagos, morosidad, convenios y flujo de caja | ve su estado de cuenta, acepta convenios | – | ve todo | registra pagos, propone convenios, anota egresos | – |
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
| Administración (edificio, usuarios, unidades, espacios, estacionamientos, activos, empresas) | – | – | – | ✔ | – |

La seguridad está en la base de datos (permisos por rol y reglas en `schema.sql`), no en el navegador: aunque alguien modifique el JS, solo puede leer y escribir lo que su rol permite.

## Pagos, convenios y flujo de caja

**Pagos.** No hay pago en línea: la administración registra cada pago al recibirlo (Finanzas → Pagos, o el botón "Registrar pago" de la unidad). Se indica a qué se aplica, el monto, la fecha, el medio y el comprobante. Puede ser un abono parcial; el cobro queda pagado cuando los abonos completan su monto. Un pago no se edita ni se borra: se anula con un motivo y queda en el historial.

**Convenios de pago.** Para una unidad morosa, la administración elige los cobros atrasados, el número de cuotas mensuales y la fecha de la primera. El convenio queda *propuesto* hasta que alguien de la unidad lo acepta en la app (o la administración registra la aceptación, si se firmó en papel). Mientras está vigente y al día, esos cobros no cuentan como vencidos. Lo que se abona al convenio salda las cuotas en orden y los períodos del más antiguo al más nuevo. Si se anula, lo abonado se conserva y el resto vuelve a ser deuda corriente. El total es la deuda de los cobros incluidos: no calcula intereses ni multas.

**Estado económico.** La administración y el comité ven en Finanzas → Estado lo por cobrar, lo vencido, lo que está en convenio, cuántas unidades están morosas, lo recaudado en el mes y la lista de unidades con deuda. Cada residente ve en Gastos comunes el estado de cuenta de su unidad.

**Flujo de caja.** Finanzas → Flujo de caja muestra, por mes y con totales del año, los ingresos por gastos comunes (tomados de los pagos registrados), otros ingresos, egresos, flujo neto y saldo acumulado; se exporta a Excel. Los egresos y otros ingresos los anota la administración; para partir con la caja real, anota un ingreso de categoría "Saldo inicial". Los ítems de un período de gastos comunes son lo que se cobra, no egresos: no entran solos al flujo.

## Visitas con QR

Al anunciar una visita, el residente obtiene un QR (con el nombre del edificio, la fecha y un código) que comparte como imagen, por ejemplo por WhatsApp. En conserjería se escanea con **Escanear QR**, o se escribe el código de 8 caracteres, y se abre la ficha de la visita para registrar el ingreso; al salir se escanea de nuevo para registrar la salida.

Al anunciar la visita se puede marcar que **necesita estacionamiento**. En Administración → Edificio se decide si en ese caso la patente es obligatoria, pensado para accesos con lectura automática de patentes (LPR). La patente se guarda normalizada (mayúsculas, sin espacios ni guiones). La app no se conecta a ningún sistema LPR: deja el dato disponible en la tabla `visitas`.

El QR no contiene datos personales, solo un código aleatorio. La lectura usa el lector de códigos del navegador cuando existe (Chrome en Android) y, si no (iPhone, Firefox), una librería incluida en `web/vendor/`. La cámara requiere HTTPS (paso 2).

## Estacionamientos de visita

- **Administración → Estacionamientos**: se crean los estacionamientos de visita (por ejemplo V1…V6), se indica cuáles están reservados (discapacidad, carga y descarga, etc.) y se configuran dos tiempos en minutos.
- **Conserjería** ve el tablero en el módulo Estacionamientos: toca uno libre para marcarlo ocupado y uno ocupado para liberarlo. Cada casilla muestra cuánto tiempo lleva y cambia de color al superar cada tiempo. Si una visita anunciada con estacionamiento registra su ingreso, la app lleva directo a elegirle un lugar.
- **Avisos**: al ocupar se avisa al residente con el tiempo máximo; al cumplirse el primer tiempo recibe una alerta; al cumplirse el segundo se informa a administración y comité, y el uso queda en la pestaña **Excedidos** como respaldo para cursar una multa según el reglamento. La app no calcula ni cobra multas.

La hora de inicio y de término las pone el servidor, no el teléfono de conserjería. Los tiempos se revisan cada 5 minutos.

## Encuestas

El comité o la administración publican una pregunta con opciones, plazo opcional y, si corresponde, restringida a propietarios. Cada **unidad** emite un voto y puede cambiarlo mientras la encuesta esté abierta. Nadie ve el voto de otra unidad: la app solo muestra totales (cantidad de votos y suma de alícuotas por opción).

## Notificaciones

Avisos en el teléfono o computador cuando llega una encomienda o una visita, hay un mensaje nuevo, se registra un pago o algo queda por aprobar. Cada persona las activa en **Mi cuenta → Notificaciones**, en cada dispositivo. El servidor genera sus claves solo; no hay nada que configurar.

Requieren que la app esté publicada con HTTPS (paso 2) y que el computador del edificio tenga internet. En iPhone/iPad solo funcionan con la app agregada a la pantalla de inicio (iOS 16.4 o superior). El envío real a teléfonos no está probado por el proyecto.

## Fotos y archivos

Se guardan en `local/datos/archivos`. Nadie puede abrirlos sin sesión: la app pide al servidor un enlace firmado que dura 1 hora, y el servidor solo lo entrega a quien puede leer ese archivo según su rol (por ejemplo, la foto de una encomienda la ven conserjería, administración y la unidad destinataria). Las imágenes se comprimen en el navegador a 1280 px antes de subir; el máximo por archivo es 15 MB.

## NFC

El escaneo de rondas usa **Web NFC**, disponible solo en Chrome para Android. Graba en cada tag un registro de texto con el código que pusiste en el activo (p. ej. `CHK-P12`). En otros dispositivos el conserje puede escribir el código o elegir el activo de la lista.

## Seguridad

El modelo de seguridad y sus limitaciones están en [`SECURITY.md`](SECURITY.md). Lo esencial: el computador que ejecuta el servidor guarda los datos de toda la comunidad, así que mantenlo actualizado, con contraseña y con acceso restringido, y respalda `local/datos`.

## Datos personales (Chile)

La app trata datos personales de residentes, trabajadores y visitas: nombre, teléfono, correo, unidad, RUT y patente de visitas, fotos, mensajes, votos y estado de pago de gastos comunes. En Chile eso está regulado por la Ley 19.628, reformada por la **Ley 21.719** (crea la Agencia de Protección de Datos Personales y multas de hasta 20.000 UTM). Su entrada en vigencia estaba fijada para el 1 de diciembre de 2026 y a noviembre de 2026 se tramitaba una postergación a octubre de 2027: verifica la fecha vigente.

Esto no es asesoría legal. El **responsable de los datos** es la comunidad de copropietarios (a través de su comité y administración), no este proyecto. Con la instalación local, los datos quedan en un equipo del edificio y no se entregan a un tercero.

Lo que la app ya trae para cumplir:

| Obligación | Cómo se cubre |
|---|---|
| Informar al titular | Aviso de privacidad del edificio (Administración → Edificio), mostrado y aceptado al registrarse y disponible en Mi cuenta. Se guarda la fecha de aceptación. |
| Acceso y portabilidad | Mi cuenta → **Descargar mis datos** (JSON). |
| Rectificación | Cada persona edita su nombre y teléfono; unidad y rol los corrige la administración. |
| Supresión | Mi cuenta → **Eliminar mi cuenta**: borra nombre, teléfono y unidad y bloquea el acceso. |
| Conservación limitada | Administración → Edificio → **Conservación de datos**: la administración fija cuántos meses se guardan visitas, rondas, encomiendas entregadas, mensajes, reservas, incidencias cerradas y uso de estacionamientos. Lo que supera el plazo se borra a diario, con sus fotos. |
| Seguridad y mínimo acceso | Permisos por rol; cada unidad ve solo sus cobros, encomiendas, visitas y voto. |

Lo que debe resolver cada comunidad (no lo hace el software):

1. Redactar su aviso de privacidad: quién es el responsable y cómo contactarlo, para qué se usan los datos, por cuánto tiempo se guardan y cómo ejercer los derechos. El texto por defecto es genérico.
2. Definir sus **plazos de conservación**. Mientras no se definan, nada se borra. Gastos comunes, pagos, comunicados, documentos, encuestas y órdenes de trabajo no tienen borrado automático.
3. Pedir a las visitas solo los datos necesarios; RUT y patente son opcionales en el formulario.
4. Tener un procedimiento para responder solicitudes de los titulares y para avisar a la Agencia y a los afectados si hay una filtración.
5. Decidir qué se sube a Documentos: todo residente del edificio puede leer lo que se publique ahí.
6. Cuidar el computador y los respaldos: quien tenga la carpeta `local/datos` tiene todos los datos. El respaldo en la nube va cifrado, pero queda en la cuenta personal o institucional de quien inició sesión en esa nube: decide de quién es esa cuenta.

## Instalación alternativa: Supabase

La misma app puede funcionar sobre un proyecto de [Supabase](https://supabase.com) en vez del servidor local, para quien prefiera no mantener un computador encendido:

1. Crea un proyecto, ejecuta `supabase/schema.sql` completo en el SQL Editor y habilita el proveedor *Email* en Authentication.
2. Copia *Project URL* y *anon public key* en `web/config.js` y sube la carpeta `web/` a un hosting estático (Vercel, Netlify, Cloudflare Pages).
3. Para notificaciones push: genera claves VAPID (`npx web-push generate-vapid-keys`), pon la pública en `config.js`, despliega `supabase/functions/push` con sus secretos (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_SECRET`) e indica su URL y secreto en la tabla `plataforma` (`push_url`, `push_secret`). Activa las extensiones `pg_net` y `pg_cron`.

Este modo comparte el esquema y sus pruebas con el modo local, pero **nunca se ha desplegado en un proyecto Supabase real**. Si tu Supabase es autoalojado, agrega su dominio en la política `connect-src` de `web/index.html`.

## Pruebas

- **Permisos y reglas** (`supabase/tests/run.sh`): aplica el esquema en un Postgres y verifica instalación nueva, re-ejecución, permisos por rol y unidad, pagos y convenios, encuestas, avisos, archivos y migración desde versiones anteriores.

  ```bash
  PGHOST=localhost PGUSER=postgres supabase/tests/run.sh
  ```

- **Servidor local** (`local/test.mjs`): levanta el servidor con datos temporales y lo usa por HTTP: cuentas, consultas, permisos, archivos, avisos de cambios y persistencia.

  ```bash
  cd local && npm install && npm test
  ```

La CI ejecuta ambas en cada push.

## Versiones

La versión vigente está en el archivo [`VERSION`](VERSION) y los cambios de cada una en [`CHANGELOG.md`](CHANGELOG.md). Al fusionar una versión nueva en `main`, el workflow `Release` crea la etiqueta y el release en GitHub.

## Próximos pasos sugeridos

1. Probarla en un edificio real, con túnel y notificaciones en teléfonos.
2. Instalador de doble clic para Windows que incluya Node.js y deje el servidor como servicio.
3. Respaldo con inicio de sesión directo en Google Drive o OneDrive, sin instalar su aplicación.
4. Pagos en línea e intereses por mora.

## Contribuir

Mi Edificio es software libre: úsalo, adáptalo a tu comunidad y envía mejoras. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) para conocer las reglas del proyecto. Las vulnerabilidades se reportan en privado desde *Security → Report a vulnerability*.

## Licencia

[MIT](LICENSE). El código de terceros incluido está descrito en [`web/vendor/README.md`](web/vendor/README.md).
