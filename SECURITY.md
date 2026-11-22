# Seguridad

## Reportar una vulnerabilidad

No abras un issue público. Usa **Security → Report a vulnerability** en GitHub (reporte privado). Incluye qué rol necesitas para reproducirla y qué datos quedan expuestos o alterados. Prueba solo contra tu propia instalación, nunca contra la de una comunidad real.

## Modelo de seguridad

- **Los permisos viven en la base de datos.** Políticas por fila y triggers de `supabase/schema.sql` deciden qué lee y escribe cada rol; el navegador solo decide qué mostrar. El servidor local ejecuta cada petición con el usuario de la sesión, así que rigen las mismas reglas que prueba `supabase/tests/rls.sql`.
- **Reglas de negocio fuera del navegador**: quién aprueba reservas y órdenes de trabajo, el rol con que se firma un mensaje, los estados iniciales, los montos pagados, las horas de estacionamiento.
- **Servidor local** (`local/server.mjs`):
  - Contraseñas con scrypt y sal; sesión en una cookie `HttpOnly`, `SameSite=Lax` (y `Secure` detrás de HTTPS), que el JavaScript de la página no puede leer.
  - Ocho intentos fallidos de inicio de sesión bloquean ese correo desde esa dirección por 5 minutos.
  - La app solo puede nombrar tablas y funciones del esquema `public`; los nombres se validan y los valores van siempre como parámetros.
  - Las peticiones que cambian datos deben venir del mismo origen.
- **Respaldo en la nube**: cada archivo sale del computador cifrado con AES-256-GCM, con una llave derivada (scrypt) de la contraseña del respaldo. La nube solo ve archivos cifrados y nombres de ruta sin datos personales.
- **Archivos**: se guardan en disco y se entregan solo con un enlace firmado de 1 hora, que el servidor da a quien puede leer ese archivo (`puede_ver_archivo()`). Lo subido nunca se ejecuta: se sirve en modo aislado (`sandbox`) y, salvo imágenes y PDF, como descarga.
- **Navegador**: todo dato se escapa antes de insertarse en el HTML y la página aplica una política CSP sin scripts en línea. En modo local no carga código de terceros.

## Limitaciones conocidas

- **El computador del edificio es el punto único.** Quien tenga acceso a ese equipo o a la carpeta `local/datos` (o a un respaldo) tiene todos los datos, incluidas las claves de la instalación. La base de datos no está cifrada en disco.
- **Sin HTTPS, la sesión viaja en claro.** Dentro de la red del edificio la app funciona por HTTP; cualquiera en esa red podría interceptarla. Para uso real, publica con HTTPS (túnel) y entra siempre por esa dirección.
- **No hay segundo factor ni verificación de correo.** Una cuenta nueva no accede a nada hasta que la administración la aprueba, pero cualquiera que conozca la dirección puede crear cuentas y solicitudes.
- **Contraseñas olvidadas** las restablece la administración, que por un momento conoce la contraseña nueva. Si el único administrador olvida la suya, no hay recuperación desde la app.
- **Un enlace firmado sirve 1 hora para quien lo tenga**, aunque no tenga sesión.
- **Los Documentos los lee todo residente del edificio** (no las empresas de mantención).
- **El historial de incidencias y órdenes lo escribe el navegador** de quien tiene permiso de edición; no es un registro de auditoría inalterable.
- **Comité y conserjería ven nombre, unidad y teléfono de todos los usuarios.**
- PGlite, la base de datos embebida, es un proyecto joven.

## Lista de verificación para quien opera una instalación

1. El computador: sistema actualizado, sesión con contraseña, sin uso compartido para navegar o instalar programas.
2. Publica con HTTPS (ver "Acceso desde internet" en el README) y comparte solo esa dirección.
3. Ten al menos dos cuentas de administración.
4. Configura el respaldo en la nube, guarda su contraseña fuera del computador y prueba una restauración. La llave del respaldo queda en `local/datos/config.json` para poder cifrar cada noche: quien acceda al computador puede leerla.
5. No compartas `local/datos/config.json`.
6. Aprueba solo a personas que reconozcas y asígnales el rol mínimo necesario.
7. Actualiza a cada versión nueva.

Si usas la instalación alternativa en Supabase: activa la confirmación de correo, el CAPTCHA y los límites de frecuencia en Authentication, usa MFA en tu cuenta, activa `pg_cron` y `pg_net`, y nunca pongas la clave `service_role`, la clave privada VAPID ni `PUSH_SECRET` en el repositorio ni en `web/config.js`.
