# Seguridad

## Reportar una vulnerabilidad

No abras un issue público. Usa **Security → Report a vulnerability** en GitHub (reporte privado). Incluye qué rol necesitas para reproducirla y qué datos quedan expuestos o alterados. Prueba solo contra tu propia instalación, nunca contra la de una comunidad real.

## Modelo de seguridad

- **Los permisos viven en la base de datos.** Políticas por fila y triggers de `supabase/schema.sql` deciden qué lee y escribe cada rol; el navegador solo decide qué mostrar. El servidor local ejecuta cada petición con el usuario de la sesión, así que rigen las mismas reglas que prueba `supabase/tests/rls.sql`.
- **Reglas de negocio fuera del navegador**: quién aprueba reservas y órdenes de trabajo, el rol con que se firma un mensaje, los estados iniciales, los montos pagados, las horas de estacionamiento.
- **Servidor local** (`local/server.mjs`):
  - **Nada viaja sin cifrar por la red.** La app se atiende solo a conexiones del mismo computador (que no salen de él); desde cualquier otro equipo, incluso dentro del edificio, únicamente por la dirección HTTPS del túnel (`cloudflared` corre en el mismo equipo). A una conexión por la red local sin cifrar solo se le muestra cómo entrar: ni la app, ni la API, ni cookies. El correo sale siempre cifrado (TLS 1.2 o más).
  - Contraseñas de 12 caracteres o más, guardadas con scrypt y sal; a quien tenga una más corta (de versiones anteriores) la app le pide cambiarla. Sesión en una cookie `HttpOnly`, `SameSite=Lax` (y `Secure` detrás de HTTPS), que el JavaScript de la página no puede leer.
  - **Verificación en dos pasos voluntaria** (TOTP, compatible con cualquier app de autenticación): el secreto se guarda cifrado; cada código sirve una vez; hay 10 códigos de respaldo de un solo uso (guardados como hash); el segundo paso vence a los 5 minutos o a los 5 intentos. La administración puede quitarla a quien perdió el teléfono: queda en la bitácora y se cierran sus sesiones.
  - Ocho intentos fallidos de inicio de sesión (o de código) bloquean ese correo desde esa dirección por 5 minutos.
  - Cada persona puede cerrar su sesión en los demás dispositivos, y la administración puede cerrar todas las de una cuenta. Bloquear una cuenta cierra sus sesiones al instante.
  - **Claves de la configuración cifradas**: la contraseña del correo, el token del túnel, la llave del respaldo, la clave privada de las notificaciones y el secreto de la instalación se guardan en `config.json` cifrados (AES-256-GCM) con una llave que vive fuera de la carpeta de datos; en Windows la protege DPAPI con la cuenta de Windows.
  - La app solo puede nombrar tablas y funciones del esquema `public`; los nombres se validan y los valores van siempre como parámetros.
  - Las peticiones que cambian datos deben venir del mismo origen.
- **Respaldo en la nube**: cada archivo sale del computador cifrado con AES-256-GCM, con una llave derivada (scrypt) de la contraseña del respaldo. La nube solo ve archivos cifrados y nombres de ruta sin datos personales.
- **Acceso desde internet**: el servidor lanza `cloudflared` y le pasa el token del túnel por variable de entorno; el token se guarda cifrado en `config.json` y nunca vuelve al navegador. El tráfico va cifrado hasta Cloudflare y de Cloudflare al computador, pero **no es de extremo a extremo**: Cloudflare termina el HTTPS y podría ver el contenido, como cualquier CDN.
- **Archivos**: se guardan en disco y se entregan solo con un enlace firmado de 1 hora, que el servidor da a quien puede leer ese archivo (`puede_ver_archivo()`). Lo subido nunca se ejecuta: se sirve en modo aislado (`sandbox`) y, salvo imágenes y PDF, como descarga.
- **Navegador**: todo dato se escapa antes de insertarse en el HTML y la página aplica una política CSP sin scripts en línea. En modo local no carga código de terceros.

## Limitaciones conocidas

- **El computador del edificio es el punto único.** La base de datos, las fotos y los documentos no están cifrados por la app: quien acceda a ese equipo con la sesión de Windows abierta, o se lleve un disco sin cifrar, puede leerlos. Cifra el disco (BitLocker o cifrado de dispositivo): Administración → Edificio → Seguridad indica si lo está y cómo activarlo. Con la sesión de Windows abierta, también se puede abrir la llave de la configuración.
- **Sin el túnel, solo se usa en el computador del edificio.** Es a propósito (nada sin cifrar por la red). Si internet se cae, los demás equipos no pueden entrar hasta que vuelva.
- **La verificación en dos pasos es voluntaria** y no hay verificación de correo. Una cuenta nueva no accede a nada hasta que la administración la aprueba, pero cualquiera que conozca la dirección puede crear cuentas y solicitudes.
- **Si se pierde la llave de la configuración** (por ejemplo, se borra el perfil de Windows), hay que volver a ingresar la contraseña del correo, el token del túnel y el respaldo, y quien tenga la verificación en dos pasos debe entrar con un código de respaldo y volver a activarla. El respaldo en la nube permite restaurar en otro equipo.
- **Contraseñas olvidadas** las restablece la administración, que por un momento conoce la contraseña nueva. Si el único administrador olvida la suya, no hay recuperación desde la app.
- **Un enlace firmado sirve 1 hora para quien lo tenga**, aunque no tenga sesión.
- **Los Documentos los lee todo residente del edificio** (no las empresas de mantención).
- **El historial de incidencias y órdenes lo escribe el navegador** de quien tiene permiso de edición; no es un registro de auditoría inalterable.
- **Comité y conserjería ven nombre, unidad y teléfono de todos los usuarios.**
- **Las actualizaciones confían en GitHub.** La actualización con un clic descarga el instalador solo desde las publicaciones del repositorio y comprueba su suma, lo que detecta descargas dañadas pero no una publicación hecha por alguien que tomara control del repositorio.
- **El instalador de Windows no está firmado.** Windows advierte al abrirlo y no hay forma automática de comprobar que no fue alterado: descárgalo solo desde Releases de este repositorio.
- PGlite, la base de datos embebida, es un proyecto joven.

## Lista de verificación para quien opera una instalación

1. El computador: disco cifrado (BitLocker), sistema actualizado, una cuenta de Windows con contraseña solo para Mi Edificio, bloqueo de pantalla, sin uso compartido para navegar o instalar programas.
2. Activa el acceso desde internet: es la única forma de entrar desde otros equipos.
3. Ten al menos dos cuentas de administración, ambas con verificación en dos pasos.
4. Configura el respaldo en la nube, guarda su contraseña fuera del computador y prueba una restauración.
5. No compartas `local/datos/config.json`.
6. Aprueba solo a personas que reconozcas y asígnales el rol mínimo necesario.
7. Actualiza a cada versión nueva.

Si usas la instalación alternativa en Supabase: en Authentication fija el largo mínimo de contraseña en 12, activa la confirmación de correo, el CAPTCHA, los límites de frecuencia y MFA (TOTP) para que las personas puedan activar la verificación en dos pasos en Mi cuenta; usa MFA en tu propia cuenta de Supabase, activa `pg_cron` y `pg_net`, y nunca pongas la clave `service_role`, la clave privada VAPID ni `PUSH_SECRET` en el repositorio ni en `web/config.js`.
